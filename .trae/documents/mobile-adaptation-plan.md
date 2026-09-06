# 移动端适配计划

## Context（背景）

当前系统是桌面优先的单页应用（`public/index.html` + 巨型 `public/app.js`，约 1146KB），布局为 `#app` 的 `flex h-screen` 左右结构：左侧固定 176px 侧边栏（含 hover 下拉子菜单）、右侧主内容区。在手机（375px）上存在：侧边栏占用过多宽度、hover 下拉在触屏无法使用、宽表格溢出、弹窗超宽、header 元素拥挤等问题。

目标：让系统在手机/平板竖屏（≤768px）上可正常使用，桌面端（>768px）行为完全不变。

**策略：全局 CSS 媒体查询 + 少量 JS 交互收口，不触碰任何页面渲染函数**（app.js 中几十个 innerHTML 渲染函数不改动，降低风险）。改动集中在两个文件：
- `public/index.html`：追加移动端 CSS 媒体查询块 + 汉堡按钮/遮罩 HTML + 尾部新 `<script>` 交互块
- `public/app.js`：仅 `navigateTo()` 顶部加 1 行关抽屉

## 断点

- 移动端断点：**768px**（与 Tailwind `md:` 一致；iPad 竖屏 768px 纯触屏也走移动端分支）
- 所有新增 CSS 均包在 `@media screen and (max-width: 768px)` 内，桌面零影响
- 已核实 CSP（server/index.js）`style-src 'unsafe-inline'`、`script-src 'unsafe-inline'`，内联样式/脚本合法，**无需改服务端**

## 实现步骤

### 1. `public/index.html` — Header 加汉堡按钮（约 L720-725）

把 header 左半区（`<div><h2 id="page-title">…</h2><p id="page-subtitle">…</p></div>`）改为：

```html
<div class="flex items-center gap-2 min-w-0">
  <button id="sidebar-toggle-btn" class="mobile-hamburger p-2 rounded-lg text-slate-600 hover:bg-slate-100" aria-label="打开菜单">
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
    </svg>
  </button>
  <div class="min-w-0">
    <h2 id="page-title" class="text-sm font-semibold text-slate-800 truncate">仪表盘</h2>
    <p class="text-xs text-slate-500" id="page-subtitle">…</p>
  </div>
</div>
```

### 2. `public/index.html` — 加遮罩层

在 `#app` 闭合 `</div>`（约 L764）之后、`#modal`（L766）之前插入 `<div id="sidebar-backdrop"></div>`。

### 3. `public/index.html` — 追加移动端 CSS

在 `<style>` 末尾（`@media print` 块之后、`</style>` 前）追加两条桌面基态规则 + 一个完整媒体查询块：

```css
/* 桌面默认隐藏移动端控件 */
.mobile-hamburger { display: none; }
#sidebar-backdrop { display: none; }

/* ===== 移动端适配（≤768px） ===== */
@media screen and (max-width: 768px) {
  #app { height: 100dvh; }
  /* 侧边栏抽屉化 */
  aside {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: 240px; z-index: 45;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 16px rgba(0,0,0,0.08);
  }
  body.sidebar-open aside { transform: translateX(0); }
  /* 遮罩 */
  #sidebar-backdrop {
    position: fixed; inset: 0; background: rgba(15,23,42,0.45); z-index: 40;
    display: none;
  }
  body.sidebar-open #sidebar-backdrop { display: block; }
  .mobile-hamburger { display: inline-flex !important; }
  /* header 精简 */
  header { padding: 10px 12px !important; }
  #page-subtitle, #user-name, #user-email { display: none !important; }
  header button[onclick="handleLogout()"] span { display: none !important; }
  /* 内容区减内边距 + 横向滚动兜底 */
  #page-content { padding: 12px !important; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  /* 表格横向滚动：白卡片自身成滚动容器（覆盖 overflow-hidden 裁剪） */
  #page-content .bg-white { overflow-x: auto; }
  #page-content table { min-width: max-content; }
  /* 弹窗窄屏适配 */
  .fixed.inset-0 > div { max-width: calc(100vw - 32px); overflow-x: auto; }
  /* 下拉菜单：移动端内联展开 + 点击切换（覆盖桌面 fixed/hover） */
  .sidebar-dropdown-menu-wrapper {
    position: static !important; left: auto !important; top: auto !important;
    width: auto !important; min-width: 0 !important; transform: none !important;
  }
  .sidebar-dropdown-menu { box-shadow: none; border: none; border-radius: 0; transform: none; }
  .sidebar-dropdown:hover .sidebar-dropdown-menu-wrapper,
  .sidebar-dropdown-menu-wrapper:hover,
  .sidebar-dropdown:hover .sidebar-dropdown-menu { pointer-events: none; opacity: 0; visibility: hidden; }
  .sidebar-dropdown-tabs, .sidebar-dropdown-tabs-2, .sidebar-dropdown-tabs-3,
  .sidebar-dropdown-tabs-6, .sidebar-dropdown-tabs-7 { display: none; }
  .sidebar-dropdown-content-wrapper, .sidebar-dropdown-content-wrapper-2,
  .sidebar-dropdown-content-wrapper-3, .sidebar-dropdown-content-wrapper-6,
  .sidebar-dropdown-content-wrapper-7 { grid-template-columns: 1fr; border-top: none; }
  .sidebar-dropdown-content { border-right: none; padding: 0; }
  .sidebar-dropdown.open .sidebar-dropdown-menu-wrapper,
  .sidebar-dropdown.open .sidebar-dropdown-menu { pointer-events: auto; opacity: 1; visibility: visible; transform: none; }
  /* 可选增强：3-7 列表格压成 2 列（验证时抽查，异常则移除） */
  #page-content .grid-cols-3, #page-content .grid-cols-4, #page-content .grid-cols-5,
  #page-content .grid-cols-6, #page-content .grid-cols-7 { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
```

### 4. `public/index.html` — 尾部追加交互 `<script>` 块

在 `delivery.js`（L846）之后追加：

```html
<script>
// ===== 移动端交互层：抽屉导航 + 点击式下拉（仅 ≤768px 生效） =====
(function () {
  const MQ = window.matchMedia('(max-width: 768px)');
  function closeMobileSidebar() {
    document.body.classList.remove('sidebar-open');
    document.querySelectorAll('.sidebar-dropdown.open').forEach(d => d.classList.remove('open'));
  }
  window.closeMobileSidebar = closeMobileSidebar;

  const toggle = document.getElementById('sidebar-toggle-btn');
  if (toggle) toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!MQ.matches) return;
    document.body.classList.toggle('sidebar-open');
  });

  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeMobileSidebar);

  document.addEventListener('click', function (e) {
    if (!MQ.matches) return;
    if (document.body.classList.contains('sidebar-open')
        && !e.target.closest('aside')
        && !e.target.closest('#sidebar-toggle-btn')) {
      closeMobileSidebar();
      return;
    }
    const header = e.target.closest('.sidebar-dropdown > .sidebar-item');
    if (!header) return;
    e.preventDefault();
    e.stopPropagation(); // 捕获阶段拦截，阻止 app.js L1729 的 navigateTo
    const dd = header.closest('.sidebar-dropdown');
    const wasOpen = dd.classList.contains('open');
    document.querySelectorAll('.sidebar-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) dd.classList.add('open');
  }, true);

  window.addEventListener('resize', function () {
    if (!MQ.matches) closeMobileSidebar();
  });
})();
</script>
```

### 5. `public/app.js` — `navigateTo()` 顶部加 1 行

在 `async function navigateTo(page) {` 函数体第一行（`currentPage = page;` 之前）加：

```js
if (window.closeMobileSidebar) window.closeMobileSidebar(); // 移动端：导航即关抽屉
```

所有导航入口（菜单、子菜单内联 onclick、通知跳转、仪表盘快捷入口）最终都汇入 `navigateTo`，此为唯一收口点。

## 关键机制与风险

- **下拉拦截**：新 script 的 click 监听器注册在 `document` **捕获阶段**，先于 app.js 目标阶段的 `item.addEventListener('click')` 执行，`stopPropagation()` 可靠阻止导航；桌面（>768px）直接 return，零影响。
- **wrapper 定位**：桌面 JS mouseenter 会写入 inline `left/top`，移动端用 `position:static !important` 覆盖。
- **触屏误触 hover**：媒体查询内同级选择器源序在后，显式关闭 hover 显隐，仅 `.open` 类显示。
- **表格裁剪**：多数表格包在 `bg-white overflow-hidden` 卡片内，仅靠 `#page-content` 滚动无法露出被裁部分，故让卡片自身 `overflow-x:auto`；`min-width:max-content` 不压缩窄表。若个别百分比列宽异常，回退 `min-width:720px`。
- **权限联动**：抽屉只是位移，`applyRoleGating`/`applyMenuPermissions`/`perm-hidden` 对 DOM 生效，自动成立，无需额外代码。
- **打印样式**：新增规则全包在 `@media screen`，与 `@media print` 互不干扰。
- **缓存**：index.html 引用 `app.js?v=2026061702`，验证时硬刷新或版本号 +1。

## 验证方案

**桌面（≥1280px，回归）**
1. 汉堡按钮不显示；侧边栏正常。
2. 各下拉 hover 展开位置正确、点击标题仍跳模块主页。
3. 表格无横向滚动；弹窗居中正常。
4. `Ctrl+P` 打印单据仍正常。

**手机 375px（DevTools iPhone SE 模拟）**
5. 登录页正常。
6. 汉堡开抽屉（240px 侧滑 + 遮罩），点遮罩/外部/导航后关闭。
7. 非管理员看不到"系统管理"；无权限子菜单隐藏。
8. 点下拉标题展开内联子菜单，再点收起；点子菜单跳转并关抽屉。
9. 仪表盘统计卡 2 列；宽表格卡片内可左右滑。
10. 弹窗（确认/输入/条码打印）不超屏。
11. Header 精简，铃铛下拉不溢出。

**iPad 竖屏 768px**：走移动端分支，无横向残留滚动。

**跨断点**：375px 开抽屉 → 拉宽到 >768px 抽屉自动复位、桌面 hover 正常。

**回归**：`npm run check`（51 项测试）保持通过。
