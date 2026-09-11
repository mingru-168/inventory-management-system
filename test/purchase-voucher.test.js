'use strict';

/**
 * 采购流财务凭证自动生成（P0 M1 第一步）集成测试。
 * 目标：验证 采购单创建/收货/退货 三处凭证化逻辑。
 *   - 创建采购单 → 生成 eventType='purchase_order' 的应付凭证（保持 type='expense' 统计口径）
 *   - 删除采购单   → 关联凭证被移除
 *   - 采购收货     → 原凭证 status 更新为 received，不新增金额流水
 *   - 采购退货     → 生成红冲凭证（负金额，同科目），聚合口径净额正确
 * 方式：require 真实 server，临时数据/会话文件 + 随机端口，HTTP 黑盒断言。
 * 运行：node --test test/purchase-voucher.test.js（纳入 npm run check 自动发现）
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// --- 隔离环境：临时数据/会话文件，避免污染真实 data.json / sessions.json ---
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'purchase-voucher-test-'));
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
    method,
    headers,
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

  // 管理员登录（种子数据 admin/admin 明文）
  const login = await api('POST', '/api/login', { username: 'admin', password: 'admin' });
  adminToken = login.json.token;
  assert.ok(adminToken, '管理员登录成功');

  // 隔离：清空财务记录，注入一个可收货/退货的库存行
  const d = getData();
  d.financeRecords = [];
  d.products.push({ id: 'p200', name: '采购凭证测试产品', model: 'PV1', unit: '个' });
  d.inventory.push({ id: 'invPV', productId: 'p200', quantity: 100, minStock: 0, warehouse: '主仓库' });
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
});

// 便捷：取某采购单关联的凭证
function vouchersOf(orderId) {
  return (getData().financeRecords || []).filter(r => r.relatedOrderId === orderId);
}

// ==================== 创建采购单 ====================
test('创建采购单 → 生成应付凭证，保持 expense 统计口径且含完整凭证字段', async () => {
  const r = await api('POST', '/api/purchase-orders', {
    supplierName: '供应商A',
    totalAmount: 1000,
    items: [{ productId: 'p200', quantity: 5, unitPrice: 200 }]
  }, adminToken);
  assert.strictEqual(r.status, 200, '创建采购单成功');
  const orderId = r.json.id;
  assert.ok(orderId, '返回采购单 id');

  const v = vouchersOf(orderId).find(v => v.eventType === 'purchase_order');
  assert.ok(v, '应生成 purchase_order 凭证');
  assert.strictEqual(v.type, 'expense', '统计口径 type 保持 expense');
  assert.strictEqual(v.category, '采购支出');
  assert.strictEqual(v.amount, 1000, '金额为采购单总额');
  assert.strictEqual(v.direction, '应付');
  assert.strictEqual(v.accountCode, '2202 应付账款');
  assert.strictEqual(v.status, 'created');
  assert.ok(v.voucherNo && String(v.voucherNo).startsWith('VJ'), 'vueckNo 以 VJ 开头');
});

// ==================== 删除采购单 ====================
test('删除待收货采购单 → 关联应付凭证被移除', async () => {
  const r = await api('POST', '/api/purchase-orders', {
    supplierName: '供应商B', totalAmount: 500
  }, adminToken);
  const orderId = r.json.id;
  assert.ok(r.json && vouchersOf(orderId).length === 1, '创建时已有 1 条凭证');

  const del = await api('DELETE', `/api/purchase-orders/${orderId}`, undefined, adminToken);
  assert.strictEqual(del.status, 200, '删除待收采购单成功');
  assert.strictEqual(vouchersOf(orderId).length, 0, '关联凭证应被移除');
});

// ==================== 采购收货 ====================
test('采购收货 → 原凭证更新为 received，且不新增金额流水', async () => {
  const r = await api('POST', '/api/purchase-orders', {
    supplierName: '供应商C',
    totalAmount: 800,
    items: [{ productId: 'p200', quantity: 8, unitPrice: 100 }]
  }, adminToken);
  const orderId = r.json.id;
  const beforeLen = vouchersOf(orderId).length;
  assert.strictEqual(beforeLen, 1, '收货前 1 条凭证');

  const rc = await api('POST', `/api/purchase-orders/${orderId}/receive`, { warehouse: '主仓库' }, adminToken);
  assert.strictEqual(rc.status, 200, '收货成功');

  const v = vouchersOf(orderId).find(v => v.eventType === 'purchase_order');
  assert.ok(v, '存在 purchase_order 凭证');
  assert.strictEqual(v.status, 'received', '收货后凭证状态为 received');
  assert.ok(v.receivedAt, '记录收货时间');
  assert.strictEqual(vouchersOf(orderId).length, beforeLen, '未新增金额流水');
});

// ==================== 采购退货 ====================
test('采购退货 → 生成红冲凭证（负金额），同科目聚合净额正确', async () => {
  const r = await api('POST', '/api/purchase-orders', {
    supplierName: '供应商D', totalAmount: 1200
  }, adminToken);
  const orderId = r.json.id;

  const ret = await api('POST', '/api/purchase-returns', {
    productId: 'p200', quantity: 3, purchaseOrderId: orderId, amount: 400
  }, adminToken);
  assert.strictEqual(ret.status, 200, '退货成功');

  const v = vouchersOf(orderId).find(v => v.eventType === 'purchase_return');
  assert.ok(v, '应生成 purchase_return 凭证');
  assert.strictEqual(v.direction, '红冲');
  assert.strictEqual(v.accountCode, '2202 应付账款');
  assert.strictEqual(v.status, 'returned');
  assert.ok(v.amount < 0, '红冲金额为负');

  // 聚合口径：该采购单下 expense 应付(1200) 与 红冲(-1200) 合计为 0，净额为 0
  const sum = vouchersOf(orderId).filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
  assert.strictEqual(sum, 0, '创建 1200 与红冲全额抵消，净额 0');
});

// ==================== 采购付款 ====================
test('采购付款 → 记录付现金流(负值、type 为空)且不重复计入支出口径，收满更新状态', async () => {
  const r = await api('POST', '/api/purchase-orders', {
    supplierName: '供应商E', totalAmount: 600
  }, adminToken);
  const orderId = r.json.id;
  const expenseBefore = vouchersOf(orderId).filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
  assert.strictEqual(expenseBefore, 600, '创建时已计采购成本 600');

  // 部分付款 400（现金），检查累计与状态
  const p1 = await api('POST', `/api/purchase-orders/${orderId}/pay-payment`, { amount: 400, method: '现金' }, adminToken);
  assert.strictEqual(p1.status, 200, '付款成功');
  assert.strictEqual(p1.json.paidAmount, 400, '累计已付 400');
  assert.notStrictEqual(p1.json.order.status, 'paid', '未付清不标记 paid');

  // 超额付款 → 400
  const over = await api('POST', `/api/purchase-orders/${orderId}/pay-payment`, { amount: 300, method: '现金' }, adminToken);
  assert.strictEqual(over.status, 400, '超额付款被拦截');

  // 付清尾款 200（银行），应标记 paid
  const p2 = await api('POST', `/api/purchase-orders/${orderId}/pay-payment`, { amount: 200, method: '银行转账' }, adminToken);
  assert.strictEqual(p2.status, 200);
  assert.strictEqual(p2.json.paidAmount, 600);
  assert.strictEqual(p2.json.order.status, 'paid', '付清后标记 paid');

  const paidVouchers = vouchersOf(orderId).filter(v => v.eventType === 'purchase_paid');
  assert.strictEqual(paidVouchers.length, 2, '生成两条付现凭证');
  assert.strictEqual(paidVouchers[0].category, '采购付现');
  assert.strictEqual(paidVouchers[0].amount, -400, '付现金额为负值（资金流出）');
  assert.strictEqual(paidVouchers[0].accountCode, '1001 现金');
  assert.strictEqual(paidVouchers[1].accountCode, '1002 银行存款');
  assert.strictEqual(paidVouchers[0].type, '', '付现凭证 type 为空，不重复计入支出口径');
  // expense 口径不变（仍为采购成本 600）
  const expenseAfter = vouchersOf(orderId).filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
  assert.strictEqual(expenseAfter, 600, '支出口径未被付款重复计数');
});

test('采购付款：无该权限角色 → 403', async () => {
  const d = getData();
  // 仅授「创建采购单」、无「付款」的受限角色
  d.roles.push({ id: 'rpv', name: '采购受限', permissions: ['采购管理-采购订单-创建采购单'] });
  d.users.push({ id: 'upv', username: 'pvlimited', name: '采购受限用户', role: '采购受限', password: 'pvlimited', status: '启用' });
  const login = await api('POST', '/api/login', { username: 'pvlimited', password: 'pvlimited' });
  assert.ok(login.json.token, '受限用户登录成功');

  const r = await api('POST', '/api/purchase-orders', { supplierName: '供应商F', totalAmount: 300 }, adminToken);
  const orderId = r.json.id;
  const resp = await api('POST', `/api/purchase-orders/${orderId}/pay-payment`, { amount: 300 }, login.json.token);
  assert.strictEqual(resp.status, 403, '无付款权限被拦截');
});

test('采购付款：非法金额 → 400', async () => {
  const r = await api('POST', '/api/purchase-orders', { supplierName: '供应商G', totalAmount: 300 }, adminToken);
  const orderId = r.json.id;
  const bad = await api('POST', `/api/purchase-orders/${orderId}/pay-payment`, { amount: 0 }, adminToken);
  assert.strictEqual(bad.status, 400, '金额 0 被拦截');
  const nonexist = await api('POST', `/api/purchase-orders/nope/pay-payment`, { amount: 100 }, adminToken);
  assert.strictEqual(nonexist.status, 404, '订单不存在返回 404');
});

// ==================== 采购订单金额变更同步凭证 ====================
test('采购订单修改 totalAmount → 关联 purchase_order 凭证金额同步更新', async () => {
  const r = await api('POST', '/api/purchase-orders', { supplierName: '供应商Z', totalAmount: 500 }, adminToken);
  const orderId = r.json.id;
  let v = vouchersOf(orderId).find(x => x.eventType === 'purchase_order');
  assert.ok(v && v.amount === 500, '初始凭证金额 500');

  const upd = await api('PUT', `/api/purchase-orders/${orderId}`, { totalAmount: 700 }, adminToken);
  assert.strictEqual(upd.status, 200);

  v = vouchersOf(orderId).find(x => x.eventType === 'purchase_order');
  assert.ok(v && v.amount === 700, '凭证金额已同步为 700');
  assert.ok(v.updatedAt, '凭证更新时间已写入');

  // 未变更时再次 PUT：不触发更新（幂等）
  const upd2 = await api('PUT', `/api/purchase-orders/${orderId}`, { remark: '仅改备注' }, adminToken);
  assert.strictEqual(upd2.status, 200);
  const vAfterNote = (getData().financeRecords).find(x => x.relatedOrderId === orderId && x.eventType === 'purchase_order');
  assert.strictEqual(vAfterNote.amount, 700, '仅改备注不影响凭证金额');
});