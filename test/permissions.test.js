'use strict';

/**
 * 权限过滤逻辑单元测试。
 * 目标模块：public/perm-core.js（前后端共用，测试即测真实实现）。
 * 运行：node --test test/permissions.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../public/perm-core.js');

// 财务角色权限样例（与系统预设保持一致）
const FINANCE_PERMS = [
  '财务管理-财务报表-查看',
  '财务管理-财务报表-导出',
  '报表管理-报表中心-查看',
  '报表管理-报表中心-导出',
  '销售管理-销售订单-查看',
  '销售管理-销售发货-结算',
  '销售管理-销售发货-预览',
  '采购管理-采购订单-查看',
  '库存管理-库存查询-查看'
];

//------ isFullAccess ------
test('isFullAccess：admin 账号恒为超管', () => {
  assert.strictEqual(P.isFullAccess('admin', '业务跟单'), true);
});

test('isFullAccess：角色名含管理员/系统管理员/超级管理员则超管', () => {
  assert.strictEqual(P.isFullAccess('a', '系统管理员'), true);
  assert.strictEqual(P.isFullAccess('b', '超级管理员'), true);
  assert.strictEqual(P.isFullAccess('c', '厂长-管理员'), true);
  assert.strictEqual(P.isFullAccess('d', '财务'), false);
  assert.strictEqual(P.isFullAccess('e', '生产工'), false);
});

test('isFullAccess：空/缺失角色名不越权', () => {
  assert.strictEqual(P.isFullAccess('f', ''), false);
  assert.strictEqual(P.isFullAccess('g', null), false);
  assert.strictEqual(P.isFullAccess('h', undefined), false);
});

//------ rolePermsList ------
const ROLES = [
  { name: '财务', permissions: FINANCE_PERMS },
  { name: '生产工', permissions: ['生产管理-完工确认-按单确认'] },
  { name: '满权限未配置', permissions: [] },
  { name: '未配置字段', } // 无 permissions 字段
];

test('rolePermsList：能找到角色且权限非空 → 返回权限数组', () => {
  assert.deepStrictEqual(P.rolePermsList(ROLES, '财务'), FINANCE_PERMS);
  assert.deepStrictEqual(P.rolePermsList(ROLES, '生产工'), ['生产管理-完工确认-按单确认']);
});

test('rolePermsList：permissions 为空数组/缺字段/角色不存在 → 返回 null（全权限兜底）', () => {
  assert.strictEqual(P.rolePermsList(ROLES, '满权限未配置'), null);
  assert.strictEqual(P.rolePermsList(ROLES, '未配置字段'), null);
  assert.strictEqual(P.rolePermsList(ROLES, '不存在的角色'), null);
  assert.strictEqual(P.rolePermsList(ROLES, ''), null);
  assert.strictEqual(P.rolePermsList(ROLES, undefined), null);
  assert.strictEqual(P.rolePermsList(null, '财务'), null);
  assert.strictEqual(P.rolePermsList([], '财务'), null);
});

//------ hasPerm ------
test('hasPerm：perms 为 null → 全部放行', () => {
  assert.strictEqual(P.hasPerm(null, '销售管理', '销售订单', '添加'), true);
  assert.strictEqual(P.hasPerm(null, '生产管理', '派工管理', '派工'), true);
});

test('hasPerm：精确动作匹配', () => {
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '销售管理', '销售订单', '查看'), true);
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '销售管理', '销售订单', '添加'), false);
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '销售管理', '销售发货', '结算'), true);
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '财务管理', '财务报表', '导出'), true);
});

test('hasPerm：不传 action → 功能前缀匹配（任一动作即可）', () => {
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '销售管理', '销售订单'), true, '有销售订单-查看');
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '销售管理', '待审核订单'), false, '无任何待审核权限');
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '生产管理', '完工确认'), false);
  assert.strictEqual(P.hasPerm(FINANCE_PERMS, '销售管理', '销售发货'), true);
});

test('hasPerm：前缀不应误判（相邻前缀隔离）', () => {
  // 只有 销售订单-查看，不应让 销售订单明细 也通过
  const perms = ['销售管理-销售订单-查看'];
  assert.strictEqual(P.hasPerm(perms, '销售管理', '销售订单'), true);
  assert.strictEqual(P.hasPerm(perms, '销售管理', '销售订单明细'), false, '前缀应精确到 - 分隔');
});

//------ hasModuleAccess ------
test('hasModuleAccess：perms 为 null → 可进入所有模块', () => {
  assert.strictEqual(P.hasModuleAccess(null, '系统管理'), true);
});

test('hasModuleAccess：财务有权限的模块可进，无权限模块不可进', () => {
  assert.strictEqual(P.hasModuleAccess(FINANCE_PERMS, '财务管理'), true);
  assert.strictEqual(P.hasModuleAccess(FINANCE_PERMS, '报表管理'), true);
  assert.strictEqual(P.hasModuleAccess(FINANCE_PERMS, '销售管理'), true);
  assert.strictEqual(P.hasModuleAccess(FINANCE_PERMS, '生产管理'), false);
  assert.strictEqual(P.hasModuleAccess(FINANCE_PERMS, '资料管理'), false);
  assert.strictEqual(P.hasModuleAccess(FINANCE_PERMS, '系统管理'), false);
});

test('hasModuleAccess：模块前缀隔离', () => {
  // 权限是 销售管理，不应让 销售开头的其它模块通过
  const perms = ['销售管理-销售订单-查看'];
  assert.strictEqual(P.hasModuleAccess(perms, '销售管理'), true);
  assert.strictEqual(P.hasModuleAccess(perms, '销售数据'), false);
});

//------ checkPermSpec ------
test('checkPermSpec：空属性放行', () => {
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, null), true);
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, ''), true);
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, undefined), true);
});

test('checkPermSpec：3 段按动作判定', () => {
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, '财务管理-财务报表-导出'), true);
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, '销售管理-销售订单-查看'), true);
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, '销售管理-销售订单-添加'), false);
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, '生产管理-派工管理-派工'), false);
});

test('checkPermSpec：2 段按「查看」判定', () => {
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, '销售管理-销售订单'), true, '有销售订单-查看');
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, '销售管理-待审核订单'), false);
  assert.strictEqual(P.checkPermSpec(FINANCE_PERMS, '财务管理-财务报表'), true);
});

//------ 前后端一致的端到端判定（模拟 requirePerm 中间件判定）------
test('模拟 requirePerm（后端）判定结果与前端一致', () => {
  function judge(username, roleName, roles, spec) {
    const perms = P.isFullAccess(username, roleName) ? null : P.rolePermsList(roles, roleName);
    if (perms === null) return true;
    return P.checkPermSpec(perms, spec);
  }
  // 财务越权创建销售订单 → 拒绝
  assert.strictEqual(judge('u1', '财务', ROLES, '销售管理-销售订单-添加'), false);
  // 财务查看销售订单 → 允许
  assert.strictEqual(judge('u1', '财务', ROLES, '销售管理-销售订单-查看'), true);
  // 生产工派工 → 拒绝
  assert.strictEqual(judge('u2', '生产工', ROLES, '生产管理-派工管理-派工'), false);
  // 生产工按单确认 → 允许
  assert.strictEqual(judge('u2', '生产工', ROLES, '生产管理-完工确认-按单确认'), true);
  // admin 恒允许
  assert.strictEqual(judge('admin', '任何', ROLES, '系统管理-用户管理-删除'), true);
  // 角色未配置权限（兜底）→ 允许
  assert.strictEqual(judge('u3', '未配置字段', ROLES, '任意模块-任意功能-任意动作'), true);
});