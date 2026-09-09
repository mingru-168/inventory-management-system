'use strict';

/**
 * 销售退货 + 生产领料端点集成测试。
 * 目标：
 *   - POST /api/sales-returns：回补库存 + 生成红冲收入凭证(eventType='sales_return'、amount<0) + 写 salesReturns 记录
 *   - 销售退货权限隔离：无「销售管理-销售退货-退货」权限的角色 → 403
 *   - 销售退货缺字段校验：无 productId 或 quantity<=0 → 400
 *   - POST /api/material-requisitions：按 BOM 推导材料需求、扣减材料库存、生成 materialRequisitions + stockOutRecords(type='生产领料')
 *   - 材料库存不足 → 400 且不产生部分扣减/记录（原子校验）
 * 方式：require 真实 server，临时数据/会话文件 + 随机端口，HTTP 黑盒断言。
 * 运行：node --test test/sales-return-materials.test.js（自动纳入 npm run check）
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// --- 隔离环境：临时数据/会话文件，避免污染真实 data.json / sessions.json ---
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-test-'));
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

  const d = getData();
  // 销售退货测试夹具：产品 + 库存
  d.products.push({ id: 'pSR', name: '退货产品', model: 'SR1', price: 300, cost: 100, unit: '件' });
  d.inventory.push({ id: 'invSR', productId: 'pSR', quantity: 20, minStock: 0, warehouse: '主仓库' });
  // 生产领料测试夹具：材料产品 + 库存 + BOM（产品模型 6351TF 包含两种材料）
  d.products.push({ id: 'mBoard', name: '板材', model: 'BRD', unit: '张' });
  d.products.push({ id: 'mFoot', name: '桌腿', model: 'FT', unit: '根' });
  d.inventory.push(
    { id: 'invBrd', productId: 'mBoard', productName: '板材', productModel: 'BRD', quantity: 100, minStock: 0, warehouse: '主仓库' },
    { id: 'invFoot', productId: 'mFoot', productName: '桌腿', productModel: 'FT', quantity: 100, minStock: 0, warehouse: '主仓库' }
  );
  d.bomConfigs.push({
    id: 'bom1', productModel: '6351TF', productName: '台面产品',
    materials: [
      { name: '板材', model: 'BRD', quantity: 2, unit: '张' },
      { name: '桌腿', model: 'FT', quantity: 4, unit: '根' }
    ]
  });
  // 受限角色：仅有销售退货查看权限（无「退货」动作）→ 用于 403 校验
  d.roles.push({ id: 'rSR', name: '退货只读', permissions: ['销售管理-销售退货-查看'] });
  d.users.push({ id: 'uSR', username: 'srlimited', name: '退货只读用户', role: '退货只读', password: 'srlimited', status: '启用' });

  const l2 = await api('POST', '/api/login', { username: 'srlimited', password: 'srlimited' });
  limitedToken = l2.json.token;
  assert.ok(limitedToken, '受限用户登录成功');
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
});

// ==================== 销售退货 ====================
test('销售退货：回补库存 + 红冲收入凭证 + 退货记录', async () => {
  const beforeInv = (getData().inventory.find(i => String(i.productId) === 'pSR') || {}).quantity;
  const r = await api('POST', '/api/sales-returns', { productId: 'pSR', quantity: 5, unitPrice: 300 }, adminToken);
  assert.strictEqual(r.status, 200, '销售退货成功');
  assert.strictEqual(r.json.success, true);
  assert.strictEqual(r.json.record.quantity, 5);

  const d = getData();
  const afterInv = (d.inventory.find(i => String(i.productId) === 'pSR') || {}).quantity;
  assert.strictEqual(afterInv, Number(beforeInv) + 5, '库存回补 5');

  const voucher = (d.financeRecords || []).find(v => v.eventType === 'sales_return');
  assert.ok(voucher, '生成红冲凭证');
  assert.strictEqual(voucher.amount, -1500, '红冲金额为负值 -1500');
  assert.strictEqual(voucher.accountCode, '1122 应收账款');

  const rec = (d.salesReturns || [])[0];
  assert.ok(rec, '写入销售退货记录');
  assert.strictEqual(rec.productId, 'pSR');
});

test('销售退货：无退货权限 → 403', async () => {
  const r = await api('POST', '/api/sales-returns', { productId: 'pSR', quantity: 1 }, limitedToken);
  assert.strictEqual(r.status, 403, '受限用户无退货权限被拦截');
});

test('销售退货：缺产品或数量非法 → 400', async () => {
  const r1 = await api('POST', '/api/sales-returns', { quantity: 2 }, adminToken);
  assert.strictEqual(r1.status, 400);
  const r2 = await api('POST', '/api/sales-returns', { productId: 'pSR', quantity: 0 }, adminToken);
  assert.strictEqual(r2.status, 400);
});

test('销售退货：GET 列表返回数组', async () => {
  const r = await api('GET', '/api/sales-returns', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json));
});

// ==================== 生产领料 ====================
test('生产领料：按 BOM 推导用料、扣减材料库存、生成领料单与出库记录', async () => {
  const d0 = getData();
  const brd0 = d0.inventory.find(i => i.id === 'invBrd').quantity;
  const ft0 = d0.inventory.find(i => i.id === 'invFoot').quantity;

  const r = await api('POST', '/api/material-requisitions', {
    productModel: '6351TF', quantity: 3, warehouse: '主仓库'
  }, adminToken);
  assert.strictEqual(r.status, 200, '生产领料成功');
  assert.strictEqual(r.json.success, true);

  const d = getData();
  const brd1 = d.inventory.find(i => i.id === 'invBrd').quantity;
  const ft1 = d.inventory.find(i => i.id === 'invFoot').quantity;
  assert.strictEqual(brd1, brd0 - 6, '板材 2×3=6 被扣减');
  assert.strictEqual(ft1, ft0 - 12, '桌腿 4×3=12 被扣减');

  const req = (d.materialRequisitions || [])[0];
  assert.ok(req, '生成领料单');
  assert.strictEqual(req.items.length, 2);

  const outs = (d.stockOutRecords || []).filter(o => o.type === '生产领料' && o.requisitionNo === req.requisitionNo);
  assert.strictEqual(outs.length, 2, '生成 2 条生产领料出库记录');
  assert.strictEqual(outs[0].quantity, 6);
  assert.strictEqual(outs[1].quantity, 12);
});

test('生产领料：材料库存不足 → 400 且不产生部分扣减/记录', async () => {
  const d0 = getData();
  const brd0 = d0.inventory.find(i => i.id === 'invBrd').quantity;
  const recCount0 = (d0.materialRequisitions || []).length;
  const outCount0 = (d0.stockOutRecords || []).length;

  // 板材需求 2×60=120，当前仅 94 → 库存不足
  const r = await api('POST', '/api/material-requisitions', {
    productModel: '6351TF', quantity: 60, warehouse: '主仓库'
  }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.message || r.json.error || '', /库存不足/);

  const d = getData();
  assert.strictEqual(d.inventory.find(i => i.id === 'invBrd').quantity, brd0, '板材库存未扣减');
  assert.strictEqual((d.materialRequisitions || []).length, recCount0, '未生成领料单');
  assert.strictEqual((d.stockOutRecords || []).length, outCount0, '未生成出库记录');
});

test('生产领料：无 BOM → 400', async () => {
  const r = await api('POST', '/api/material-requisitions', { productModel: 'NO_BOM_MODEL', quantity: 1 }, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.message || r.json.error || '', /BOM/);
});

test('生产领料：GET 列表返回数组', async () => {
  const r = await api('GET', '/api/material-requisitions', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json));
});