'use strict';

/**
 * 密码安全集成测试（P2：弱密码检测 + 改密强度校验）。
 * 目标：验证 /api/login 返回 weakPassword 标志，/api/users/me 改密强度校验生效。
 * 方式：require 真实 server（不监听 3000），临时数据/会话文件 + 随机端口，HTTP 黑盒断言。
 * 运行：node --test test/password.test.js（纳入 npm run check 自动发现）
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-test-'));
process.env.DATA_FILE = path.join(TMP, 'data.json');
process.env.SESSION_FILE = path.join(TMP, 'sessions.json');

const { app, getData } = require('../server/index.js');

let server;
let baseUrl;
let adminToken;
let strongUserToken;
let strongUser = { username: 'stronguser', password: 'Strong#2026' };

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

  // 管理员登录（种子数据 admin/admin 为明文弱密码）
  const login = await api('POST', '/api/login', { username: 'admin', password: 'admin' });
  adminToken = login.json.token;
  assert.ok(adminToken, '管理员登录成功');

  // 创建一个使用强密码的用户，供"强密码登录不提示"用例使用
  const d = getData();
  d.users.push({
    id: 'u-pwd', username: strongUser.username, name: '强密码用户',
    role: '系统管理员', password: strongUser.password, status: '启用'
  });
  const l2 = await api('POST', '/api/login', { username: strongUser.username, password: strongUser.password });
  strongUserToken = l2.json.token;
  assert.ok(strongUserToken, '强密码用户登录成功');
});

after(async () => {
  if (server) await new Promise(res => server.close(res));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});

// ---------- 弱密码检测 ----------
test('密码：登录使用常见弱密码（admin/admin）→ 返回 weakPassword=true', async () => {
  const r = await api('POST', '/api/login', { username: 'admin', password: 'admin' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.weakPassword, true, '弱密码应标记 weakPassword');
});

test('密码：登录使用强密码 → weakPassword=false', async () => {
  const r = await api('POST', '/api/login', { username: strongUser.username, password: strongUser.password });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.weakPassword, false, '强密码不应标记 weakPassword');
});

// ---------- 改密强度校验 ----------
test('密码：改密原密码错误 -> 拒绝', async () => {
  const r = await api('PUT', '/api/users/me', {
    name: '强密码用户', email: 'x@x.com',
    oldPassword: 'wrong', newPassword: 'NewPass#2026'
  }, strongUserToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.success, false);
});

test('密码：改密新密码不足8位 -> 拒绝', async () => {
  const r = await api('PUT', '/api/users/me', {
    name: '强密码用户', email: 'x@x.com',
    oldPassword: strongUser.password, newPassword: 'Abc1234'
  }, strongUserToken);
  assert.strictEqual(r.json.success, false, '7位密码应被拒绝');
});

test('密码：改密新密码为常见弱密码 -> 拒绝', async () => {
  const r = await api('PUT', '/api/users/me', {
    name: '强密码用户', email: 'x@x.com',
    oldPassword: strongUser.password, newPassword: '12345678'
  }, strongUserToken);
  assert.strictEqual(r.json.success, false, '12345678 应被拒绝');
});

test('密码：改密新密码纯字母 -> 拒绝', async () => {
  const r = await api('PUT', '/api/users/me', {
    name: '强密码用户', email: 'x@x.com',
    oldPassword: strongUser.password, newPassword: 'abcdefgh'
  }, strongUserToken);
  assert.strictEqual(r.json.success, false, '纯字母密码应被拒绝');
});

test('密码：改密为强密码 -> 成功，新密码可登录且不提示弱密码', async () => {
  const r = await api('PUT', '/api/users/me', {
    name: '强密码用户', email: 'x@x.com',
    oldPassword: strongUser.password, newPassword: 'NewPass#2026'
  }, strongUserToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.success, true, '强密码改密应成功');

  // 旧密码失效
  const old = await api('POST', '/api/login', { username: strongUser.username, password: strongUser.password });
  assert.strictEqual(old.status, 401, '旧密码应无法登录');

  // 新密码可用且非弱密码
  const fresh = await api('POST', '/api/login', { username: strongUser.username, password: 'NewPass#2026' });
  assert.strictEqual(fresh.status, 200, '新密码应可登录');
  assert.strictEqual(fresh.json.weakPassword, false);
});
