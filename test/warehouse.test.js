'use strict';

/**
 * 仓库与条码模块集成测试（批次5）。
 * 目标：server/index.js 中新增的 仓位/调拨/出库/盘点/条码 API 端点。
 * 方式：require 真实 server（不监听 3000），用临时数据文件 + 临时会话文件 + 随机端口启动，
 *       通过 HTTP 黑盒断言。纳入 CI（node --test 自动发现，Node 18/20/22）。
 * 运行：node --test test/warehouse.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// --- 隔离环境：临时数据/会话文件，避免污染真实 data.json / sessions.json ---
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
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

  // 注入测试夹具（直接改内存 data，聚焦本模块端点）
  const d = getData();
  d.products.push(
    { id: 'p100', name: '调拨产品', model: 'T1', stock: 60, unit: '张' },
    { id: 'p101', name: '出库产品', model: 'O1', stock: 30, unit: '件' },
    { id: 'p102', name: '盘点产品', model: 'S1', stock: 10, unit: '个' },
    { id: 'p103', name: '条码产品', model: 'B1', stock: 0, unit: '个' }
  );
  d.warehouses.push(
    { id: 'whA', code: 'WHA', name: '一号仓', isActive: true },
    { id: 'whB', code: 'WHB', name: '二号仓', isActive: true }
  );
  d.inventory.push(
    { id: 'invA', productId: 'p100', quantity: 60, minStock: 5, warehouse: '一号仓' },
    { id: 'invB', productId: 'p100', quantity: 0, minStock: 5, warehouse: '二号仓' },
    { id: 'invC', productId: 'p101', quantity: 30, minStock: 5, warehouse: '一号仓' },
    { id: 'invD', productId: 'p102', quantity: 10, minStock: 5, warehouse: '二号仓' }
  );
  // 受限角色/用户：仅库存查询权限（用于 403 校验）
  d.roles.push({ id: 'r1', name: '仓库只读', permissions: ['库存管理-库存查询-查看'] });
  d.users.push({ id: 'u2', username: 'limited', name: '受限用户', role: '仓库只读', password: 'limited', status: '启用' });

  const l2 = await api('POST', '/api/login', { username: 'limited', password: 'limited' });
  limitedToken = l2.json.token;
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
});

// ==================== 仓位管理 ====================
test('仓位：GET 列表返回数组且种子仓位已生成', async () => {
  const r = await api('GET', '/api/warehouse-locations', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json));
  // 种子数据：w1 主仓库 -> A001/A002，w2 配件仓 -> B001/B002
  const names = r.json.map(l => l.name);
  assert.ok(names.includes('A001') && names.includes('A002'), '主仓库种子仓位存在');
});

test('仓位：POST 空名称 -> 400', async () => {
  const r = await api('POST', '/api/warehouse-locations', { name: '   ' }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /不能为空/);
});

test('仓位：POST 有效仓位按 warehouseId 解析仓库名', async () => {
  const r = await api('POST', '/api/warehouse-locations', { name: 'C-101', warehouseId: 'whA', remark: '测试仓位' }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.name, 'C-101');
  assert.strictEqual(r.json.warehouse, '一号仓');
  assert.strictEqual(r.json.remark, '测试仓位');
  // 记录 id 供后续编辑/删除
  getData().__testLocId = r.json.id;
});

test('仓位：POST 未指定仓库时回退默认仓库', async () => {
  const r = await api('POST', '/api/warehouse-locations', { name: 'D-101' }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.warehouse, '仓库名不为空');
  assert.strictEqual(r.json.isDefault, false);
});

test('仓位：PUT 编辑更新字段并写入 modifier', async () => {
  const id = getData().__testLocId;
  assert.ok(id, '前置测试已创建仓位');
  const r = await api('PUT', '/api/warehouse-locations/' + id, { name: 'C-101-改', status: '停用', remark: '已编辑' }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.name, 'C-101-改');
  assert.strictEqual(r.json.status, '停用');
  assert.strictEqual(r.json.remark, '已编辑');
  assert.ok(r.json.modifier, 'modifier 已写入');
});

test('仓位：PUT 不存在的仓位 -> 404', async () => {
  const r = await api('PUT', '/api/warehouse-locations/not-exist', { name: 'x' }, adminToken);
  assert.strictEqual(r.status, 404);
});

test('仓位：DELETE 删除仓位', async () => {
  const id = getData().__testLocId;
  const r = await api('DELETE', '/api/warehouse-locations/' + id, undefined, adminToken);
  assert.strictEqual(r.status, 200);
  const list = await api('GET', '/api/warehouse-locations', undefined, adminToken);
  assert.ok(!list.json.some(l => l.id === id), '删除后列表中不存在');
});

test('仓位：DELETE 不存在的仓位 -> 404', async () => {
  const r = await api('DELETE', '/api/warehouse-locations/not-exist', undefined, adminToken);
  assert.strictEqual(r.status, 404);
});

// ==================== 仓库调拨 ====================
test('调拨：有效调拨扣源仓、加目标仓并生成 DB 单号', async () => {
  const r = await api('POST', '/api/warehouse-transfers', {
    productId: 'p100', quantity: 5, fromWarehouse: '一号仓', toWarehouse: '二号仓', type: '调拨', remark: '测试调拨'
  }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.match(r.json.transferNo || '', /^DB\d{8}\d{3}$/, '调拨单号 DB+日期+序号');
  assert.strictEqual(r.json.productName, '调拨产品');
  assert.strictEqual(r.json.quantity, 5);
  const d = getData();
  const a = d.inventory.find(i => i.productId === 'p100' && i.warehouse === '一号仓');
  const b = d.inventory.find(i => i.productId === 'p100' && i.warehouse === '二号仓');
  assert.strictEqual(a.quantity, 55, '源仓 60-5=55');
  assert.strictEqual(b.quantity, 5, '目标仓 0+5=5');
});

test('调拨：自动生成调拨出库记录', async () => {
  const outs = getData().stockOutRecords.filter(o => o.productId === 'p100' && o.type === '调拨出库');
  assert.ok(outs.length >= 1, '存在调拨出库记录');
  assert.strictEqual(outs[outs.length - 1].quantity, 5);
  assert.strictEqual(outs[outs.length - 1].targetWarehouse, '二号仓');
  assert.match(outs[outs.length - 1].stockOutNo || '', /^CK\d{8}\d{3}$/);
});

test('调拨：库存不足 -> 400 且不扣减', async () => {
  const r = await api('POST', '/api/warehouse-transfers', {
    productId: 'p100', quantity: 99999, fromWarehouse: '一号仓', toWarehouse: '二号仓'
  }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /库存不足/);
  const a = getData().inventory.find(i => i.productId === 'p100' && i.warehouse === '一号仓');
  assert.strictEqual(a.quantity, 55, '失败后库存不变');
});

test('调拨：源仓与目标仓相同 -> 400', async () => {
  const r = await api('POST', '/api/warehouse-transfers', {
    productId: 'p100', quantity: 1, fromWarehouse: '一号仓', toWarehouse: '一号仓'
  }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /不能相同/);
});

test('调拨：产品不存在 -> 404', async () => {
  const r = await api('POST', '/api/warehouse-transfers', {
    productId: 'nope', quantity: 1, fromWarehouse: '一号仓', toWarehouse: '二号仓'
  }, adminToken);
  assert.strictEqual(r.status, 404);
});

test('调拨：源仓库不存在 -> 400', async () => {
  const r = await api('POST', '/api/warehouse-transfers', {
    productId: 'p100', quantity: 1, fromWarehouse: '不存在仓', toWarehouse: '二号仓'
  }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /源仓库不存在/);
});

test('调拨：GET 列表包含新调拨记录', async () => {
  const r = await api('GET', '/api/warehouse-transfers', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.some(t => t.productId === 'p100' && t.fromWarehouse === '一号仓'));
});

// ==================== 出库记录 ====================
test('出库：有效出库扣减库存并生成 CK 单号', async () => {
  const r = await api('POST', '/api/stock-out-records', {
    productId: 'p101', quantity: 3, warehouse: '一号仓', type: '领用出库', remark: '测试出库'
  }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.match(r.json.stockOutNo || '', /^CK\d{8}\d{3}$/);
  const inv = getData().inventory.find(i => i.productId === 'p101' && i.warehouse === '一号仓');
  assert.strictEqual(inv.quantity, 27, '30-3=27');
  const p = getData().products.find(x => x.id === 'p101');
  assert.strictEqual(p.stock, 27, '产品总库存 30-3=27');
});

test('出库：库存不足 -> 400', async () => {
  const r = await api('POST', '/api/stock-out-records', {
    productId: 'p101', quantity: 99999, warehouse: '一号仓'
  }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /库存不足/);
});

test('出库：产品不存在 -> 404', async () => {
  const r = await api('POST', '/api/stock-out-records', { productId: 'nope', quantity: 1 }, adminToken);
  assert.strictEqual(r.status, 404);
});

// ==================== 盘点 ====================
test('盘点：有效盘点计算差异并更新库存', async () => {
  const r = await api('POST', '/api/stocktakes', {
    productId: 'p102', warehouse: '二号仓', countedQty: 14, remark: '测试盘点'
  }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.match(r.json.stocktakeNo || '', /^PD\d{8}\d{3}$/);
  assert.strictEqual(r.json.currentQty, 10);
  assert.strictEqual(r.json.countedQty, 14);
  assert.strictEqual(r.json.diff, 4);
  assert.strictEqual(r.json.status, 'done');
  const inv = getData().inventory.find(i => i.productId === 'p102' && i.warehouse === '二号仓');
  assert.strictEqual(inv.quantity, 14, '盘点后库存=14');
  const p = getData().products.find(x => x.id === 'p102');
  assert.strictEqual(p.stock, 14, '产品总库存 10+4=14');
});

test('盘点：数量为负 -> 400', async () => {
  const r = await api('POST', '/api/stocktakes', { productId: 'p102', warehouse: '二号仓', countedQty: -1 }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /不能为负数/);
});

test('盘点：GET 列表与详情', async () => {
  const list = await api('GET', '/api/stocktakes', undefined, adminToken);
  assert.strictEqual(list.status, 200);
  const rec = list.json.find(t => t.productId === 'p102');
  assert.ok(rec, '列表包含盘点记录');
  const detail = await api('GET', '/api/stocktakes/' + rec.id, undefined, adminToken);
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.json.id, rec.id);
});

// ==================== 条码 ====================
test('条码：种子产品自动回填 barcode=P+id', async () => {
  const r = await api('GET', '/api/products', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  const p1 = r.json.find(p => String(p.id) === 'p1');
  assert.strictEqual(p1.barcode, 'Pp1');
});

test('条码：GET /api/products?barcode= 过滤', async () => {
  const r = await api('GET', '/api/products?barcode=Pp1', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.length === 1 && String(r.json[0].id) === 'p1', '精确匹配唯一产品');
  const miss = await api('GET', '/api/products?barcode=NO-SUCH', undefined, adminToken);
  assert.strictEqual(miss.json.length, 0);
});

test('条码：POST 自定义可打印 ASCII 条码', async () => {
  const r = await api('POST', '/api/products/p103/barcode', { barcode: 'BARCODE-103' }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.barcode, 'BARCODE-103');
});

test('条码：跨产品重复 -> 400', async () => {
  const r = await api('POST', '/api/products/p100/barcode', { barcode: 'BARCODE-103' }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /占用/);
});

test('条码：非 ASCII 字符 -> 400', async () => {
  const r = await api('POST', '/api/products/p100/barcode', { barcode: '中文条码' }, adminToken);
  assert.strictEqual(r.status, 400);
});

test('条码：POST 缺省重置为 P+id', async () => {
  const r = await api('POST', '/api/products/p100/barcode', {}, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.barcode, 'Pp100');
});

test('条码：产品不存在 -> 404', async () => {
  const r = await api('POST', '/api/products/nope/barcode', { barcode: 'X' }, adminToken);
  assert.strictEqual(r.status, 404);
});

test('扫码查询：GET /api/barcode/:code 命中返回产品+库存', async () => {
  await api('POST', '/api/products/p103/barcode', { barcode: 'BARCODE-103' }, adminToken);
  const r = await api('GET', '/api/barcode/BARCODE-103', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.product.name, '条码产品');
  assert.ok(Array.isArray(r.json.inventory), '返回库存行数组');
});

test('扫码查询：未知条码 -> 404', async () => {
  const r = await api('GET', '/api/barcode/NO-SUCH-CODE', undefined, adminToken);
  assert.strictEqual(r.status, 404);
});

// ==================== 权限 ====================
test('权限：无 token 访问受保护端点 -> 401', async () => {
  const r = await api('GET', '/api/warehouse-transfers', undefined, undefined);
  assert.strictEqual(r.status, 401);
});

test('权限：受限用户可读（仅鉴权端点）', async () => {
  const r = await api('GET', '/api/warehouse-locations', undefined, limitedToken);
  assert.strictEqual(r.status, 200);
});

test('权限：受限用户执行调拨 -> 403', async () => {
  const r = await api('POST', '/api/warehouse-transfers', {
    productId: 'p100', quantity: 1, fromWarehouse: '一号仓', toWarehouse: '二号仓'
  }, limitedToken);
  assert.strictEqual(r.status, 403);
  assert.match(r.json.message || '', /调拨/);
});

test('权限：受限用户出库 -> 403', async () => {
  const r = await api('POST', '/api/stock-out-records', { productId: 'p101', quantity: 1, warehouse: '一号仓' }, limitedToken);
  assert.strictEqual(r.status, 403);
});

test('权限：受限用户盘点 -> 403', async () => {
  const r = await api('POST', '/api/stocktakes', { productId: 'p102', warehouse: '二号仓', countedQty: 1 }, limitedToken);
  assert.strictEqual(r.status, 403);
});
