/**
 * perm-core.js — 角色权限判定核心（前后端共用，仅含纯逻辑，无 I/O）
 *
 * 供三方使用：
 *  - 浏览器端：<script src="perm-core.js"></script>，挂载为 window.PERMCORE
 *  - 后端 Node：const P = require('../public/perm-core.js')
 *  - 单元测试：node --test test/permissions.test.js
 *
 * 约定（与权限配置面板保持一致）：
 *  1. 权限串形如 `模块名-功能名[-动作名]`，例如 `销售管理-待审核订单-审核`。
 *  2. permissions 为 null / 非数组 / 空数组 均视为「无任何权限」（fail-closed；未配置权限的角色需管理员在权限配置面板授权）。
 *  3. admin 与名称含「管理员 / 系统管理员 / 超级管理员」的角色视为超管，拥有全部权限。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();          // Node / CommonJS
  } else {
    root.PERMCORE = factory();           // 浏览器全局
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 是否为超管（admin 账号或角色名含管理员/系统管理员/超级管理员） */
  function isFullAccess(username, roleName) {
    if (username === 'admin') return true;
    return /管理员|系统管理员|超级管理员/.test(String(roleName || ''));
  }

  /**
   * 解析某个角色的权限列表。
   * 返回 [] 表示「无任何权限」（找不到角色、或未配置权限数组，fail-closed）。
   * 返回数组表示细分的权限串列表。
   */
  function rolePermsList(roles, roleName) {
    const role = (roles || []).find(r => String(r.name) === String(roleName));
    if (!role) return [];
    const perms = role.permissions;
    if (!Array.isArray(perms) || perms.length === 0) return [];
    return perms;
  }

  /**
   * 是否拥有 模块-功能[-动作] 权限。
   * action 省略时只需该模块-功能下存在任一权限（前缀匹配）。
   * perms 为 null 表示全权限，恒返回 true。
   */
  function hasPerm(perms, module, item, action) {
    if (perms === null) return true;
    const prefix = module + '-' + item;
    if (action) return perms.indexOf(prefix + '-' + action) !== -1;
    return perms.some(function (p) { return p.indexOf(prefix + '-') === 0; });
  }

  /** 是否可进入某个一级模块（该模块下有任一权限即可） */
  function hasModuleAccess(perms, module) {
    if (perms === null) return true;
    return perms.some(function (p) { return p.indexOf(module + '-') === 0; });
  }

  /**
   * data-perm / data-modper 属性的解析。
   * 例：`销售管理-待审核订单-审核`（≥3 段，按动作判定）；`销售管理-销售订单`（2 段按「查看」）。
   * 空值视为放行。
   */
  function checkPermSpec(perms, spec) {
    if (!spec) return true;
    var parts = String(spec).split('-');
    if (parts.length >= 3) return hasPerm(perms, parts[0], parts[1], parts[2]);
    if (parts.length === 2) return hasPerm(perms, parts[0], parts[1], '查看');
    return true;
  }

  return {
    isFullAccess: isFullAccess,
    rolePermsList: rolePermsList,
    hasPerm: hasPerm,
    hasModuleAccess: hasModuleAccess,
    checkPermSpec: checkPermSpec
  };
});