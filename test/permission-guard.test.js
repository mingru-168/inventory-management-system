/**
 * 写端点权限防护集成测试（P1：requirePerm 补齐）。
 * 目标：验证 2026-09 新增的 requirePerm 端点对受限用户返回 403，且管理员操作不受影响。
 * 方式：require 真实 server，临时数据/会话文件 + 随机端口，HTTP 黑盒断言。
 * 运行：node --test test/permission-guard.test.js（纳入 npm run check 自动发现）
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// --- 隔离环境 ---
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'permguard-test-'));
process.env.DATA_FILE = path.join(TMP, 'data.json');
process.env.SESSION_FILE = path.join(TMP, 'sessions.json');

const { app, getData } = require('../server/index.js');

let server;
let baseUrl;
let adminToken;
let limitedToken;

async function api(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  const r = await fetch(baseUrl + p, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
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

  // 受限用户：仅「库存查询-查看」，无任何写权限
  const d = getData();
  d.roles.push({ id: 'r-guard', name: '只读受限', permissions: ['库存管理-库存查询-查看'] });
  d.users.push({ id: 'u-guard', username: 'readonly', name: '只读用户', role: '只读受限', password: 'readonly', status: '启用' });

  const l2 = await api('POST', '/api/login', { username: 'readonly', password: 'readonly' });
  limitedToken = l2.json.token;
  assert.ok(limitedToken, '受限用户登录成功');

  // 准备一条销售订单、一条计划订单与一条工序，供受限用户越权操作
  const so = await api('POST', '/api/sales-orders', {
    orderNo: 'PGTEST-SO',
    customerName: '测试客户',
    items: [{ productId: 'p1', productName: '测试产品', quantity: 1, price: 100 }]
  }, adminToken);
  assert.strictEqual(so.status, 200, '管理员创建销售订单成功');
  global.__guardSalesOrderId = so.json.id;

  const po = await api('POST', '/api/plan-orders', {
    orderNo: 'PGTEST-PO', productName: '测试产品', quantity: 1
  }, adminToken);
  assert.strictEqual(po.status, 200, '管理员创建计划订单成功');
  global.__guardPlanOrderId = po.json.id;

  // 给计划订单配置一条工序
  const pr = await api('PUT', `/api/plan-orders/${po.json.id}/processes`, {
    processes: [{ name: '木工', sequence: 1 }]
  }, adminToken);
  assert.strictEqual(pr.status, 200, '管理员配置工序成功');
  const procs = await api('GET', '/api/processes', null, adminToken);
  global.__guardProcessId = procs.json.find(p => p.planOrderId === po.json.id)?.id;
  assert.ok(global.__guardProcessId, '工序已生成');
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});

// ---------- 受限用户（只读角色）越权写操作全部 403 ----------
test('权限：受限用户修改销售订单 -> 403', async () => {
  const r = await api('PUT', `/api/sales-orders/${global.__guardSalesOrderId}`, { remark: '越权' }, limitedToken);
  assert.strictEqual(r.status, 403);
});

test('权限：受限用户添加订单跟踪 -> 403', async () => {
  const r = await api('POST', `/api/sales-orders/${global.__guardSalesOrderId}/tracking`, { content: '越权' }, limitedToken);
  assert.strictEqual(r.status, 403);
});

test('权限：受限用户配货扣库存 -> 403', async () => {
  const r = await api('POST', `/api/allocate-order/${global.__guardSalesOrderId}`, {}, limitedToken);
  assert.strictEqual(r.status, 403);
});

test('权限：受限用户创建采购订单 -> 403', async () => {
  const r = await api('POST', '/api/purchase-orders', { supplierName: '越权供应商' }, limitedToken);
  assert.strictEqual(r.status, 403);
});

test('权限：受限用户修改采购订单 -> 403', async () => {
  const r = await api('PUT', '/api/purchase-orders/nonexist', { remark: '越权' }, limitedToken);
  assert.strictEqual(r.status, 403);
});

test('权限：受限用户手动入库 -> 403', async () => {
  const r = await api('POST', '/api/stock-records', { productId: 'p1', quantity: 1 }, limitedToken);
  assert.strictEqual(r.status, 403);
  const r2 = await api('POST', '/api/stock-in-records', { productId: 'p1', quantity: 1 }, limitedToken);
  assert.strictEqual(r2.status, 403);
});

test('权限：受限用户删除/修改库存记录 -> 403', async () => {
  const r = await api('DELETE', '/api/stock-in-records/nonexist', null, limitedToken);
  assert.strictEqual(r.status, 403);
  const r2 = await api('PUT', '/api/stock-records/nonexist', { quantity: 9 }, limitedToken);
  assert.strictEqual(r2.status, 403);
});

test('权限：受限用户维护规格价格 -> 403', async () => {
  const r = await api('POST', '/api/product-spec-prices', { productId: 'p1', spec: 'X', price: 1 }, limitedToken);
  assert.strictEqual(r.status, 403);
  const r2 = await api('PUT', '/api/product-spec-prices/nonexist', { price: 9 }, limitedToken);
  assert.strictEqual(r2.status, 403);
  const r3 = await api('DELETE', '/api/product-spec-prices/nonexist', null, limitedToken);
  assert.strictEqual(r3.status, 403);
});

test('权限：受限用户删除/改状态计划订单 -> 403', async () => {
  const r = await api('DELETE', `/api/plan-orders/${global.__guardPlanOrderId}`, null, limitedToken);
  assert.strictEqual(r.status, 403);
  const r2 = await api('PUT', `/api/plan-orders/${global.__guardPlanOrderId}`, { remark: '越权' }, limitedToken);
  assert.strictEqual(r2.status, 403);
  const r3 = await api('PUT', `/api/plan-orders/${global.__guardPlanOrderId}/status`, { status: 'done' }, limitedToken);
  assert.strictEqual(r3.status, 403);
  const r4 = await api('PUT', `/api/plan-orders/${global.__guardPlanOrderId}/processes`, { processes: [] }, limitedToken);
  assert.strictEqual(r4.status, 403);
});

test('权限：受限用户工序完工 -> 403', async () => {
  const r = await api('PUT', `/api/processes/${global.__guardProcessId}/complete`, null, limitedToken);
  assert.strictEqual(r.status, 403);
});

// ---------- 管理员正例：确认权限补齐未锁死合法操作 ----------
test('权限：管理员创建/修改采购订单正常', async () => {
  const r = await api('POST', '/api/purchase-orders', { supplierName: '正例供应商' }, adminToken);
  assert.strictEqual(r.status, 200);
  const r2 = await api('PUT', `/api/purchase-orders/${r.json.id}`, { remark: '正例' }, adminToken);
  assert.strictEqual(r2.status, 200);
});

test('权限：管理员工序完工正常（流程未被锁死）', async () => {
  const r = await api('PUT', `/api/processes/${global.__guardProcessId}/complete`, null, adminToken);
  assert.strictEqual(r.status, 200);
});

test('权限：受限用户仅可读（库存查询查看）不受影响', async () => {
  const r = await api('GET', '/api/stock-in-records', null, limitedToken);
  assert.strictEqual(r.status, 200);
});
