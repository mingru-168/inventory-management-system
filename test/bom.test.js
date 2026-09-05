'use strict';

/**
 * BOM 配置模块集成测试。
 * 目标：server/index.js 中 /api/bom-configs 的 CRUD 与权限端点。
 * 方式：require 真实 server（不监听 3000），用临时数据文件 + 临时会话文件 + 随机端口启动，
 *       通过 HTTP 黑盒断言。纳入 CI（node --test 自动发现，Node 18/20/22）。
 * 运行：node --test test/bom.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// --- 隔离环境：临时数据/会话文件，避免污染真实 data.json / sessions.json ---
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bom-test-'));
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
  assert.ok(adminToken, '管理员登录成功');

  // 受限角色/用户：仅库存查询权限，无材料审核权限（用于 403 校验）
  const d = getData();
  d.roles.push({ id: 'r-bom', name: '无BOM权限', permissions: ['库存管理-库存查询-查看'] });
  d.users.push({ id: 'u-bom', username: 'nobom', name: '无BOM权限用户', role: '无BOM权限', password: 'nobom', status: '启用' });

  const l2 = await api('POST', '/api/login', { username: 'nobom', password: 'nobom' });
  limitedToken = l2.json.token;
  assert.ok(limitedToken, '受限用户登录成功');
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }
});

function sampleBom(overrides = {}) {
  return Object.assign({
    productModel: 'T-BOM1',
    productName: '测试台',
    color: '黑色',
    spec: '80cm',
    tabletopColor: '纳秋绿',
    version: 'v1 初始版',
    materials: [
      { seq: 1, name: '板材', model: '18mm', type: '木质', process: '开料', spec: '1220x2440', color: '白', quantity: 2, unit: '张' },
      { seq: 2, name: '五金件', model: '', type: '配件', process: '安装', spec: '', color: '', quantity: 4, unit: '套' }
    ]
  }, overrides);
}

// ==================== 列表 ====================
test('BOM：GET 列表返回数组（含默认空集合）', async () => {
  const r = await api('GET', '/api/bom-configs', undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json));
});

// ==================== 新增 ====================
test('BOM：POST 有效配置创建并规范化材料', async () => {
  const r = await api('POST', '/api/bom-configs', sampleBom(), adminToken);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.id, '生成 id');
  assert.strictEqual(r.json.productModel, 'T-BOM1');
  assert.strictEqual(r.json.productName, '测试台');
  assert.strictEqual(r.json.color, '黑色');
  assert.strictEqual(r.json.tabletopColor, '纳秋绿');
  assert.strictEqual(r.json.version, 'v1 初始版');
  assert.ok(r.json.creator, '记录 creator');
  assert.ok(r.json.createdAt, '记录 createdAt');
  assert.strictEqual(r.json.materials.length, 2);
  assert.strictEqual(r.json.materials[0].seq, 1);
  assert.strictEqual(r.json.materials[0].name, '板材');
  assert.strictEqual(r.json.materials[0].quantity, 2);
  assert.strictEqual(r.json.materials[0].unit, '张');
  assert.strictEqual(r.json.materials[1].quantity, 4);
  // 记录 id 供后续编辑/删除
  getData().__testBomId = r.json.id;
});

test('BOM：POST 缺产品型号 -> 400', async () => {
  const body = sampleBom({ productModel: '   ' });
  const r = await api('POST', '/api/bom-configs', body, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /型号/);
});

test('BOM：POST 缺产品名称 -> 400', async () => {
  const body = sampleBom({ productName: '' });
  const r = await api('POST', '/api/bom-configs', body, adminToken);
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error || '', /名称/);
});

test('BOM：POST 材料数量为空串时存为空字符串', async () => {
  const body = sampleBom({
    productModel: 'T-BOM-EMPTYQTY',
    materials: [{ seq: 1, name: '板材', quantity: '', unit: '张' }]
  });
  const r = await api('POST', '/api/bom-configs', body, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.materials[0].quantity, '');
});

// ==================== 编辑 ====================
test('BOM：PUT 更新字段并写入 modifier/updatedAt', async () => {
  const id = getData().__testBomId;
  assert.ok(id, '前置测试已创建');
  const r = await api('PUT', '/api/bom-configs/' + id, {
    productModel: 'T-BOM1',
    productName: '测试台',
    version: 'v2 调整用量',
    color: '白色',
    materials: [{ seq: 1, name: '板材', quantity: 3, unit: '张' }]
  }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.version, 'v2 调整用量');
  assert.strictEqual(r.json.color, '白色');
  assert.strictEqual(r.json.materials.length, 1);
  assert.strictEqual(r.json.materials[0].quantity, 3);
  assert.ok(r.json.modifier, 'modifier 已写入');
  assert.ok(r.json.updatedAt, 'updatedAt 已写入');
});

test('BOM：PUT 不存在的 BOM -> 404', async () => {
  const r = await api('PUT', '/api/bom-configs/not-exist', sampleBom(), adminToken);
  assert.strictEqual(r.status, 404);
});

test('BOM：PUT 编辑时型号为空 -> 400', async () => {
  const id = getData().__testBomId;
  const r = await api('PUT', '/api/bom-configs/' + id, { productModel: '  ' }, adminToken);
  assert.strictEqual(r.status, 400);
});

// ==================== 删除 ====================
test('BOM：DELETE 删除并更新列表', async () => {
  const id = getData().__testBomId;
  const r = await api('DELETE', '/api/bom-configs/' + id, undefined, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.id, id);
  const list = await api('GET', '/api/bom-configs', undefined, adminToken);
  assert.ok(!list.json.some(b => b.id === id), '删除后列表不存在');
});

test('BOM：DELETE 不存在的 BOM -> 404', async () => {
  const r = await api('DELETE', '/api/bom-configs/not-exist', undefined, adminToken);
  assert.strictEqual(r.status, 404);
});

// ==================== 权限 ====================
test('BOM：无 token 访问 -> 401', async () => {
  const r = await api('GET', '/api/bom-configs', undefined, undefined);
  assert.strictEqual(r.status, 401);
});

test('BOM：受限用户可读列表（已登录鉴权端点）', async () => {
  const r = await api('GET', '/api/bom-configs', undefined, limitedToken);
  assert.strictEqual(r.status, 200);
});

test('BOM：受限用户新增 -> 403（无材料审核添加权限）', async () => {
  const r = await api('POST', '/api/bom-configs', sampleBom(), limitedToken);
  assert.strictEqual(r.status, 403);
  assert.match(r.json.message || '', /权限|添加/);
});

test('BOM：受限用户编辑 -> 403', async () => {
  const id = getData().__testBomId;
  // 先由管理员创建一个用于编辑校验的对象
  const created = await api('POST', '/api/bom-configs', sampleBom({ productModel: 'T-PERM' }), adminToken);
  const r = await api('PUT', '/api/bom-configs/' + created.json.id, sampleBom(), limitedToken);
  assert.strictEqual(r.status, 403);
});

test('BOM：受限用户删除 -> 403', async () => {
  const created = await api('POST', '/api/bom-configs', sampleBom({ productModel: 'T-PERM-DEL' }), adminToken);
  const r = await api('DELETE', '/api/bom-configs/' + created.json.id, undefined, limitedToken);
  assert.strictEqual(r.status, 403);
});