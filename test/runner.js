'use strict';

/**
 * 通用多套件测试运行器（跨平台，兼容 Node 18/20/22）。
 *
 * 自动扫描 test/ 目录下所有 *.test.js 并以显式文件列表传给 node --test，
 * 规避 Windows 下 `node --test 目录` 的 MODULE_NOT_FOUND 问题，且无需随新增
 * 测试文件修改 package.json。
 *
 * 用法：node test/runner.js   （npm test）
 *   - 无测试文件 → 视为通过（exit 0）
 *   - 任一失败   → 非零退出（供 CI 判定）
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter(f => /\.test\.js$/i.test(f))
  .map(f => path.join(dir, f))
  .sort();

if (files.length === 0) {
  console.log('[runner] test/ 下未发现 *.test.js，视为通过');
  process.exit(0);
}

console.log(`[runner] 找到 ${files.length} 个测试文件：`);
files.forEach(f => console.log('  - ' + path.basename(f)));

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit'
});

process.exit(result.status === null ? 1 : result.status);