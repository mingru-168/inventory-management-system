'use strict';

/**
 * 新增财务端点集成测试：
 *   - POST /api/finance/advance-receive  客户预收款（type='' 负债类不影响利润）
 *   - POST /api/finance/advance-refund   预收款退款（余额校验 + 红冲凭证）
 *   - POST /api/finance/expenses         费用单（type='expense' 影响利润）
 *   - POST /api/finance/other-income     其他收入（type='income' 影响利润）
 *   - POST /api/finance/transfers        内部转账（双凭证同 transferId，type=''）
 * 方式：require 真实 server，临时数据/会话文件 + 随机端口，HTTP 黑盒断言。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-new-test-'));
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

  // 注入测试客户，供预收/退款测试
  const d = getData();
  d.customers.push({ id: 'c-fin-1', name: '预收测试客户', contact: '王经理', phone: '13800000000' });
  d.financeRecords = [];
  d.advanceReceipts = [];
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
});

// ==================== 客户预收款 ====================
test('客户预收款：POST 成功生成 advance_receive 凭证 + 预收记录；GET 列表可查', async () => {
  const before = getData().financeRecords.length;

  const r = await api('POST', '/api/finance/advance-receive', {
    customerId: 'c-fin-1', amount: 10000, method: '银行转账', remark: '首笔预收'
  }, adminToken);
  assert.strictEqual(r.status, 200, '预收接口成功');
  assert.ok(r.json.success);
  assert.ok(r.json.record.receiptNo, '生成 receiptNo');
  assert.strictEqual(r.json.record.amount, 10000);

  // 凭证端断言
  const fr = getData().financeRecords;
  assert.strictEqual(fr.length, before + 1, '新增 1 条凭证');
  const v = fr[fr.length - 1];
  assert.strictEqual(v.eventType, 'advance_receive');
  assert.strictEqual(v.type, '', '预收款是负债类，不走利润口径');
  assert.strictEqual(v.amount, 10000);
  assert.strictEqual(v.accountCode, '1002 银行存款', '银行方式对应银行存款科目');
  assert.strictEqual(v.direction, '收现');

  // 列表查询
  const gl = await api('GET', '/api/finance/advance-receipts?customerId=c-fin-1', undefined, adminToken);
  assert.strictEqual(gl.status, 200);
  assert.ok(Array.isArray(gl.json));
  assert.ok(gl.json.some(x => x.receiptNo === r.json.record.receiptNo), '列表可查到新记录');
});

test('客户预收款：缺客户/金额非法 → 400', async () => {
  const r1 = await api('POST', '/api/finance/advance-receive', { amount: 1000 }, adminToken);
  assert.strictEqual(r1.status, 400, '缺客户 ID → 400');

  const r2 = await api('POST', '/api/finance/advance-receive', { customerId: 'c-fin-1', amount: -1 }, adminToken);
  assert.strictEqual(r2.status, 400, '金额非法 → 400');
});

// ==================== 预收款退款 ====================
test('预收款退款：余额充足 → 红冲凭证 + 预收余额减少；超退 → 400', async () => {
  // 先预收 5000
  await api('POST', '/api/finance/advance-receive', {
    customerId: 'c-fin-1', amount: 5000, method: '现金'
  }, adminToken);

  const before = getData().financeRecords.length;
  const r = await api('POST', '/api/finance/advance-refund', {
    customerId: 'c-fin-1', amount: 3000, method: '银行'
  }, adminToken);
  assert.strictEqual(r.status, 200, '退款成功');
  const v = getData().financeRecords[before];
  assert.strictEqual(v.eventType, 'advance_refund');
  assert.strictEqual(v.type, '', '退款同属负债类，不走利润口径');
  assert.strictEqual(v.amount, -3000, '退款为负值');
  assert.strictEqual(v.direction, '红冲');

  // 超退测试
  const r2 = await api('POST', '/api/finance/advance-refund', {
    customerId: 'c-fin-1', amount: 999999
  }, adminToken);
  assert.strictEqual(r2.status, 400, '预收款余额不足 → 400');
  assert.match(String(r2.json.message), /余额不足/);
});

// ==================== 费用单 ====================
test('费用单：POST 生成 expense_form 凭证，type=expense 计入利润口径；GET 按分类/日期过滤', async () => {
  const r = await api('POST', '/api/finance/expenses', {
    amount: 800, category: '管理费用', method: '现金',
    description: '办公用品', department: '行政部'
  }, adminToken);
  assert.strictEqual(r.status, 200, '费用单提交成功');
  const v = getData().financeRecords.find(x => x.eventType === 'expense_form' && x.amount === -800);
  assert.ok(v, '生成 expense_form 凭证');
  assert.strictEqual(v.type, 'expense', '费用单走利润口径');
  assert.strictEqual(v.accountCode, '6602 管理费用');
  assert.strictEqual(v.amount, -800, '支出为负值');

  // 聚合口径验证：expense 总额增加
  const totalExp = getData().financeRecords.filter(x => x.type === 'expense').reduce((s, x) => s + (x.amount || 0), 0);
  assert.strictEqual(totalExp, -800, '利润口径 expense 累计 -800');

  // 非法分类
  const r2 = await api('POST', '/api/finance/expenses', {
    amount: 100, category: '垃圾费用'
  }, adminToken);
  assert.strictEqual(r2.status, 400, '非法分类 → 400');

  // GET 列表
  const gl = await api('GET', '/api/finance/expenses?category=管理费用', undefined, adminToken);
  assert.strictEqual(gl.status, 200);
  assert.ok(gl.json.some(x => x.amount === 800), '列表可查到新记录');
});

// ==================== 其他收入 ====================
test('其他收入：POST 生成 other_income 凭证，type=income 计入利润口径；不影响销售收入累计（不同 category）', async () => {
  const r = await api('POST', '/api/finance/other-income', {
    amount: 2500, category: '营业外收入', method: '银行', description: '废品出售'
  }, adminToken);
  assert.strictEqual(r.status, 200);
  const v = getData().financeRecords.find(x => x.eventType === 'other_income');
  assert.ok(v);
  assert.strictEqual(v.type, 'income');
  assert.strictEqual(v.category, '营业外收入');
  assert.strictEqual(v.amount, 2500);
  assert.strictEqual(v.accountCode, '1002 银行存款');
  assert.strictEqual(v.direction, '收现');

  // 非法分类
  const r2 = await api('POST', '/api/finance/other-income', {
    amount: 100, category: '虚构分类'
  }, adminToken);
  assert.strictEqual(r2.status, 400, '非法分类 → 400');
});

// ==================== 内部转账 ====================
test('内部转账：POST 生成双凭证同 transferId，一正一负 type=""；GET 列表可查', async () => {
  const before = getData().financeRecords.length;
  const r = await api('POST', '/api/finance/transfers', {
    amount: 3000, fromAccount: '现金', toAccount: '银行', remark: '现金存银行'
  }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.record.transferNo);

  const fr = getData().financeRecords;
  assert.strictEqual(fr.length, before + 2, '新增 2 条凭证');
  const [out, in_] = fr.slice(before, before + 2).sort((a, b) => (a.amount < b.amount ? -1 : 1));
  assert.strictEqual(out.amount, -3000, '转出凭证负值');
  assert.strictEqual(out.direction, '转出');
  assert.strictEqual(out.accountCode, '1001 现金');
  assert.strictEqual(in_.amount, 3000, '转入凭证正值');
  assert.strictEqual(in_.direction, '转入');
  assert.strictEqual(in_.accountCode, '1002 银行存款');
  assert.strictEqual(out.relatedOrderId, r.json.record.id, '双凭证同 transferId');
  assert.strictEqual(out.relatedOrderId, in_.relatedOrderId);
  assert.strictEqual(out.type, '', '转账不影响利润');
  assert.strictEqual(in_.type, '');

  // 同账户/空值 → 400
  const r2 = await api('POST', '/api/finance/transfers', {
    amount: 1000, fromAccount: '现金', toAccount: '现金'
  }, adminToken);
  assert.strictEqual(r2.status, 400, '转出/转入账户相同 → 400');

  const r3 = await api('POST', '/api/finance/transfers', {
    amount: 1000, fromAccount: '不存在的账户', toAccount: '现金'
  }, adminToken);
  assert.strictEqual(r3.status, 400, '非法账户类型 → 400');
});

// ==================== 通用财务查询 + 资金聚合 ====================
test('通用财务查询 GET /api/finance/query：支持 eventType/type/relatedOrderId/日期过滤 + 倒序', async () => {
  // 先创建几笔不同 eventType 的记录（通过新端点）
  await api('POST', '/api/finance/expenses', {
    amount: 666, category: '管理费用', method: '现金', description: '查询测试'
  }, adminToken);

  // 按 eventType 过滤
  const r1 = await api('GET', '/api/finance/query?eventType=expense_form', undefined, adminToken);
  assert.strictEqual(r1.status, 200);
  assert.ok(r1.json.some(x => x.eventType === 'expense_form' && x.amount === -666));
  assert.ok(r1.json.every(x => x.eventType === 'expense_form'));

  // 按 type 过滤
  const r2 = await api('GET', '/api/finance/query?type=expense', undefined, adminToken);
  assert.ok(r2.json.every(x => x.type === 'expense'));

  // 按日期范围过滤
  const today = new Date().toISOString().slice(0, 10);
  const r3 = await api('GET', `/api/finance/query?dateFrom=${today}`, undefined, adminToken);
  assert.ok(r3.json.length > 0, '今天有记录');

  // 无过滤 → 返回全部
  const r4 = await api('GET', '/api/finance/query', undefined, adminToken);
  const total = (getData().financeRecords || []).length;
  assert.strictEqual(r4.json.length, total, '无过滤时返回全部');

  // 倒序：createdAt 最大的在前
  for (let i = 0; i < r4.json.length - 1; i++) {
    const a = r4.json[i].createdAt || '';
    const b = r4.json[i + 1].createdAt || '';
    assert.ok(a >= b, `${a} >= ${b}`);
  }
});

test('资金余额聚合 GET /api/finance/balances：客户/供应商维度汇总 + 预收款余额计算', async () => {
  // 给 c-fin-1 加一张销售订单
  const d = getData();
  d.salesOrders.push({
    id: 'soFin1', orderNo: 'FIN-SO-001', customerId: 'c-fin-1',
    status: 'pending', totalAmount: 5000, paidAmount: 2000,
    items: [{ productId: 'p2', quantity: 5, price: 1000 }]
  });

  const r = await api('GET', '/api/finance/balances', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json.customers));
  assert.ok(Array.isArray(r.json.suppliers));
  assert.ok(r.json.summary);

  const cust = r.json.customers.find(c => c.id === 'c-fin-1');
  assert.ok(cust, 'c-fin-1 客户在聚合结果中');
  assert.strictEqual(cust.totalReceivable, 5000);
  assert.strictEqual(cust.totalReceived, 2000);
  assert.strictEqual(cust.outstanding, 3000);
  // 累计预收 = 第一笔 10000 + 退款测试中先存的 5000 = 15000
  assert.strictEqual(cust.advancePaid, 15000, '累计预收 15000（10000 + 5000）');
  assert.strictEqual(cust.advanceRefunded, 3000, '累计退款 3000');
  assert.strictEqual(cust.advanceBalance, 12000, '预收余额 = 15000 - 3000 = 12000');
});

// ==================== 销售订单作废端点 ====================
test('销售订单作废 DELETE /api/sales-orders/:id：仅 pending 可删，已收款禁止，清理关联凭证', async () => {
  const d = getData();

  // 1. 创建一张 pending 订单 + 关联凭证
  d.salesOrders.push({
    id: 'soDel1', orderNo: 'DEL-SO-001', customerId: 'c-fin-1',
    status: 'pending', totalAmount: 8888, items: []
  });
  d.financeRecords.push({
    id: 'vDel1', type: 'income', amount: 8888,
    relatedOrderId: 'soDel1', eventType: 'sales_order'
  });

  const beforeSales = d.salesOrders.length;
  const beforeFin = d.financeRecords.length;

  const r = await api('DELETE', '/api/sales-orders/soDel1', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.success);
  assert.strictEqual(getData().salesOrders.length, beforeSales - 1, '订单已删除');
  assert.strictEqual(
    getData().financeRecords.filter(v => v.relatedOrderId === 'soDel1').length,
    0, '关联凭证已清理'
  );

  // 2. 已收款的 pending 订单 → 400
  d.salesOrders.push({
    id: 'soDel2', orderNo: 'DEL-SO-002', customerId: 'c-fin-1',
    status: 'pending', totalAmount: 5000, paidAmount: 1000, items: []
  });
  const r2 = await api('DELETE', '/api/sales-orders/soDel2', undefined, adminToken);
  assert.strictEqual(r2.status, 400);
  assert.match(r2.json.message, /已收款|退款/);

  // 3. 非 pending 状态 → 400
  d.salesOrders.push({
    id: 'soDel3', orderNo: 'DEL-SO-003', customerId: 'c-fin-1',
    status: 'allocated', totalAmount: 5000, items: []
  });
  const r3 = await api('DELETE', '/api/sales-orders/soDel3', undefined, adminToken);
  assert.strictEqual(r3.status, 400);
  assert.match(r3.json.message, /不允许作废|待处理/);

  // 4. 不存在 → 404
  const r4 = await api('DELETE', '/api/sales-orders/NONEXIST', undefined, adminToken);
  assert.strictEqual(r4.status, 404);
});
