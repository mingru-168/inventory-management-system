'use strict';

/**
 * 生产流与销售流财务凭证自动生成（P0 M1 第二步）集成测试。
 * 目标：
 *   - 销售发货 → 生成销售收入凭证（type='income'、direction='应收'、accountCode='1122 应收账款'）
 *   - 销售按单收款 → paidAmount 累加，生成"销售收现"流水但不再计 income，收满置订单 state=paid，超收 400
 *   - 工序完工(入库) → 生成生产成本凭证（type='expense'、accountCode='1405 存货'、金额=单位成本×数量），计入支出
 * 方式：require 真实 server，临时数据/会话文件 + 随机端口，HTTP 黑盒断言。
 * 运行：node --test test/sales-voucher.test.js（纳入 npm run check 自动发现）
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// --- 隔离环境：临时数据/会话文件，避免污染真实 data.json / sessions.json ---
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-voucher-test-'));
process.env.DATA_FILE = path.join(TMP, 'data.json');
process.env.SESSION_FILE = path.join(TMP, 'sessions.json');

const { app, getData } = require('../server/index.js');

let server;
let baseUrl;
let adminToken;

async function api(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  const r = await fetch(baseUrl + p, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
  return { status: r.status, json };
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.on('listening', res));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/login', { username: 'admin', password: 'admin' });
  adminToken = login.json.token;
  assert.ok(adminToken, '管理员登录成功');

  // 隔离：清空财务记录，注入有成本的产品 + 库存，供销售发货/工序完工
  const d = getData();
  d.financeRecords = [];
  d.products.push({ id: 'p9', name: '凭证销售产品', model: 'SV1', price: 200, cost: 50, unit: '件' });
  d.inventory.push({ id: 'invSV', productId: 'p9', quantity: 500, minStock: 0, warehouse: '主仓库' });
  // 无线成本产品（测试无 cost 不生成生产凭证）
  d.products.push({ id: 'p10', name: '无成本产品', model: 'SV2', unit: '件' });
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
});

function vouchers(orderId) {
  return (getData().financeRecords || []).filter(r => r.relatedOrderId === orderId);
}

// ==================== 创建订单 → 收入凭证；发货 → 更新凭证状态 ====================
test('创建销售订单 → 生成销售收入凭证；发货 → 凭证状态置 allocated（不新增 income）', async () => {
  const so = await api('POST', '/api/sales-orders', {
    customerName: '测试客户', orderNo: 'SVTEST-SO1', totalAmount: 2000,
    items: [{ productId: 'p9', productName: '凭证销售产品', quantity: 10, price: 200 }]
  }, adminToken);
  assert.strictEqual(so.status, 200, '创建销售订单成功');
  const orderId = so.json.id;

  const v0 = vouchers(orderId).find(v => v.eventType === 'sales_order');
  assert.ok(v0, '创建订单生成 sales_order 收入凭证');
  assert.strictEqual(v0.type, 'income');
  assert.strictEqual(v0.category, '销售收入');
  assert.strictEqual(v0.amount, 2000, '金额=订单总额');
  assert.strictEqual(v0.direction, '应收');
  assert.strictEqual(v0.accountCode, '1122 应收账款');
  assert.strictEqual(v0.status, 'created');
  const incomeAtCreate = (getData().financeRecords || []).filter(r => r.type === 'income').length;

  const alloc = await api('POST', `/api/allocate-order/${orderId}`, {}, adminToken);
  assert.strictEqual(alloc.status, 200, '销售发货成功');

  const v = vouchers(orderId).find(v => v.eventType === 'sales_order');
  assert.ok(v, '发货后仍为该收入凭证');
  assert.strictEqual(v.status, 'allocated', '发货后凭证状态置 allocated');
  const incomeAtAlloc = (getData().financeRecords || []).filter(r => r.type === 'income').length;
  assert.strictEqual(incomeAtAlloc, incomeAtCreate, '发货不新增 income（避免与创建订单确认收入重复）');
});

// ==================== 按单收款 ====================
test('按单收款 → paidAmount 累加，收现流水不重复计收入，收满置 paid', async () => {
  const so = await api('POST', '/api/sales-orders', {
    customerName: '收款客户', orderNo: 'SVTEST-SO2', totalAmount: 1000,
    items: [{ productId: 'p9', productName: '凭证销售产品', quantity: 5, price: 200 }]
  }, adminToken);
  const orderId = so.json.id;
  await api('POST', `/api/allocate-order/${orderId}`, {}, adminToken);
  const incomeBefore = (getData().financeRecords || []).filter(r => r.type === 'income').length;

  // 部分收款 400
  const p1 = await api('POST', `/api/sales-orders/${orderId}/receive-payment`, { amount: 400, method: '现金' }, adminToken);
  assert.strictEqual(p1.status, 200, '部分收款成功');
  assert.strictEqual(p1.json.paidAmount, 400, 'paidAmount 累加为 400');
  assert.strictEqual((getData().salesOrders.find(o => o.id === orderId)).paidAmount, 400);

  // 收满
  const p2 = await api('POST', `/api/sales-orders/${orderId}/receive-payment`, { amount: 600, method: '银行转账' }, adminToken);
  assert.strictEqual(p2.status, 200, '收满成功');
  const order = getData().salesOrders.find(o => o.id === orderId);
  assert.strictEqual(order.paidAmount, 1000, 'paidAmount 收满 1000');
  assert.strictEqual(order.status, 'paid', '收满后订单状态为 paid');

  // 收现流水不新增 income（income 数与发货后一致）
  const incomeAfter = (getData().financeRecords || []).filter(r => r.type === 'income').length;
  assert.strictEqual(incomeAfter, incomeBefore, '收款不重复计收入');

  const rc = vouchers(orderId).filter(v => v.eventType === 'sales_received');
  assert.strictEqual(rc.length, 2, '生成两条收现流水');
  assert.ok(rc.every(v => v.direction === '收现' && v.status === 'received' && v.type === '' && v.amount > 0), '收现流水为不计收入的资金明细');
  // 银行转账 → 银行存款科目
  assert.ok(rc.some(v => v.accountCode === '1002 银行存款'), '银行转账记入银行存款科目');
});

test('按单收款 → 超收拒绝 400', async () => {
  const so = await api('POST', '/api/sales-orders', {
    customerName: '超收客户', orderNo: 'SVTEST-SO3', totalAmount: 100,
    items: [{ productId: 'p9', productName: '凭证销售产品', quantity: 1, price: 100 }]
  }, adminToken);
  const orderId = so.json.id;
  const r = await api('POST', `/api/sales-orders/${orderId}/receive-payment`, { amount: 200, method: '现金' }, adminToken);
  assert.strictEqual(r.status, 400, '超收应返回 400');
  assert.strictEqual(Number(getData().salesOrders.find(o => o.id === orderId).paidAmount) || 0, 0, '未收款时超收不改动 paidAmount');
});

// ==================== 工序完工 → 生产成本凭证 ====================
test('工序完工(入库) → 生成生产成本凭证（计入支出，金额=单位成本×数量）', async () => {
  const po = await api('POST', '/api/plan-orders', {
    orderNo: 'PVTEST-PO', productName: '凭证销售产品', productId: 'p9', quantity: 2
  }, adminToken);
  assert.strictEqual(po.status, 200, '创建计划订单成功');
  const planOrderId = po.json.id;

  const pr = await api('PUT', `/api/plan-orders/${planOrderId}/processes`, {
    processes: [{ name: '入库', sequence: 1 }]
  }, adminToken);
  assert.strictEqual(pr.status, 200, '配置入库工序成功');
  const procs = await api('GET', '/api/processes', undefined, adminToken);
  const proc = procs.json.find(p => p.planOrderId === planOrderId && p.name === '入库');
  assert.ok(proc, '入库工序已生成');

  const cp = await api('PUT', `/api/processes/${proc.id}/complete`, {}, adminToken);
  assert.strictEqual(cp.status, 200, '完工成功');

  const v = (getData().financeRecords || []).find(v => v.eventType === 'production_complete' && v.relatedOrderId === planOrderId);
  assert.ok(v, '生成 production_complete 成本凭证');
  assert.strictEqual(v.type, 'expense', '计入支出');
  assert.strictEqual(v.accountCode, '1405 存货');
  assert.strictEqual(v.direction, '成本');
  assert.strictEqual(v.amount, 100, '金额=单位成本50×数量2');
});

// ==================== 聚合口径 ====================
test('聚合口径：income 仅含创建订单收入，不含收款与发货重复；expense 含生产成本', async () => {
  const recs = getData().financeRecords || [];
  const income = recs.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const orderIncome = recs.filter(r => r.type === 'income' && r.eventType === 'sales_order').reduce((s, r) => s + r.amount, 0);
  assert.strictEqual(income, orderIncome, 'income 全部来自创建订单确认的收入');
  assert.strictEqual(income, 3100, '订单收入合计 2000+1000+100');
  assert.strictEqual(recs.filter(r => r.type === 'income' && r.eventType === 'sales_received').length, 0, '收款不计入 income');
  const prodCost = recs.filter(r => r.type === 'expense' && r.eventType === 'production_complete').reduce((s, r) => s + r.amount, 0);
  assert.strictEqual(prodCost, 100, '生产成本 100 已计入 expense');
});