# 移动端重新设计布局（简易化）实施计划

## Context（背景）

当前移动端（≤768px）只是 PC 版缩小板：侧边栏变抽屉、表格横向滚动、弹窗缩窄，但功能逻辑全是 PC 端设计（宽表格、多字段表单、复杂报表），手机体验差。用户要求**重新设计移动端布局**，功能适配移动端、移动端需简易。

已与用户确认的方向：
1. **主导航**：底部 Tab（首页/销售/采购/库存/我的）+ 保留汉堡抽屉（完整功能入口）
2. **复杂功能**（报表/成本/条码打印/财务账户/看板/BOM 等）：移动端显示友好提示「建议在电脑端操作」，保留入口
3. **卡片化范围**：高频 4 页面——销售订单、采购单、产品库存、材料库存 → 手机卡片式列表 + 全屏底部 sheet 表单

目标：手机端有专属简易体验，桌面端零回归。

## 总体策略

- **两条导航轨并行**：底部 Tab → 移动端专属卡片视图；抽屉菜单 → 完整桌面页面（含复杂功能提示）。互不替换。
- **桌面零回归**：新 CSS 追加为新 `@media (max-width:768px)` 块（置于现有块之后，级联覆盖）；新 JS 全部追加到 app.js 末尾（文件 22010 行，追加最安全）。
- **不动 4 个巨型列表函数**（renderSalesOrdersList L2917 / renderPurchaseOrder L8260 / renderInventoryProduct L9169 / renderInventoryMaterial L11119）：移动端卡片视图用**独立新函数**读取同一全局 `data` 对象，复用其底部动作函数（viewOrderDetails / editSalesOrder / approveOrder / viewPurchaseDetail / receivePurchase / completePurchase / deletePurchase / showStockInModal 等）。
- **对既有代码侵入仅限**：① 约 10 个叶子函数顶部加 2-3 行移动端提示守卫；② DOMContentLoaded / startAutoRefresh / navigateTo 三处各加几行联动。

## 改动清单

### 1. public/index.html

1. **桌面基态**：在 `.mobile-hamburger { display: none; }`（L231 附近）旁追加 `#mobile-tabbar { display: none; }`。
2. **新增底部 Tab 栏 HTML**（`#app` 闭合后、`#sidebar-backdrop` L852 之前）：`<nav id="mobile-tabbar">`，5 个 `<button data-mtab=...>`（首页/销售/采购/库存/我的），内联 SVG 图标，`onclick="switchMobileTab('xxx')"`，与现有内联事件风格一致。
3. **新增第二个移动端媒体查询块**（L307 后、`</style>` 前），内容见下方 CSS 详单。

### 2. public/app.js（全部新函数追加到文件末尾 L22010 之后）

**基础层**
- `isMobile()` — `window.matchMedia('(max-width: 768px)').matches`
- `loadMobileTab()/saveMobileTab(tab)` — localStorage 键 `mobile-tab`，默认 `home`（参照现有 loadSalesSubTab/saveSalesSubTab 的 try/catch 写法）
- `setMobileTabActive(tab)` — 仅切 tabbar 激活样式，不渲染
- `switchMobileTab(tab)` — 主调度：关抽屉 → 存 tab → 高亮 → 设标题 → 分发 `renderMobileHome/Sales/Purchase/Inventory/Me`。**严禁写 saveCurrentPage**（currentPage 是桌面导航恢复键，Tab 独立持久化，否则手机重载会被拉回桌面全页）

**移动端首页 `renderMobileHome()`**
- 数据源：`/api/dashboard`（salesTrend 末项=今日销售额、pendingOrders、stockAlertCount）、`notifState.count`、`/api/alerts` 前 3 条
- 布局：2×2 KPI 大数字卡片 → 2 列高频操作大按钮（新增销售订单/新增采购单/手动入库/产品库存/销售订单/全部功能→开抽屉）→ 最近订单卡片列表（data.salesOrders 倒序取 5，点击 viewOrderDetails）→ 智能预警精简列表
- 高频操作全部复用现有函数，零新逻辑

**卡片化三页**
- `renderMobileSales()` — 订单卡片：订单号/客户/日期/状态徽章/金额/明细数；分段 chips（全部/待审核/进行中/已完成，用函数内 `_mobileSalesFilter` 内存变量）；最近 20 条 +「查看全部」→navigateTo('sales')。动作：详情 viewOrderDetails、待审核 mobileApproveOrder、编辑 editSalesOrder（按 hasPerm 门控）
- `renderMobilePurchase()` — 采购单卡片：单号/供应商/仓库/金额/状态/日期；chips（全部/待收货/已结算）；最近 20 条。动作：详情 viewPurchaseDetail、mobileReceivePurchase、mobileCompletePurchase、mobileDeletePurchase
- `renderMobileInventory()` — 顶部分段 产品/材料；产品卡片：类型/名称、型号、颜色/规格、**库存大字**（0 或低于阈值红色）、单位、展厅价、库存金额；顶部大按钮「手动入库」→showStockInModal()。材料段：复用现有 renderInventoryMaterial（后端无真实材料集合，不造数据）
- `renderMobileMe()` — 用户卡（currentUser）+ 菜单项（消息与待办→notifications、系统设置→settings、关于）+ 大号退出按钮 handleLogout()
- 工具：`mobileStatusBadge(status)` 状态徽章小工具

**动作包装函数**（操作后回到卡片视图，不碰既有函数）
- `mobileApproveOrder(id)` → await approveOrder(id); switchMobileTab('sales')
- `mobileReceivePurchase(id)` / `mobileCompletePurchase(id)` / `mobileDeletePurchase(id)` → 同理回 purchase

**复杂功能提示**
- `renderDesktopOnlyHint(featureName, backFn)` — 居中卡片：电脑图标 +「xx 功能建议在电脑端操作」+ 返回首页大按钮 + 打开全部功能（开抽屉）
- 在下列叶子函数顶部加 `if (isMobile()) { renderDesktopOnlyHint('...'); return; }`（**逐个 Read 首行确认 async 前缀后再插入**）：

| 函数 | 行号 | 文案 |
|---|---|---|
| renderReports() | L18090 | 报表管理 |
| renderFinanceCost() | L11300 | 成本管理 |
| renderFinanceAccount() | L11328 | 财务账户 |
| renderProductionKanban() | L14057 | 生产看板 |
| renderBarcodeLabel() | L8840 | 条码打印 |
| renderScanQuery() | L8940 | 扫码查询 |
| renderScanInOut() | L9011 | 扫码出入库 |
| renderStocktake() | L8762 | 盘点库存清单 |
| renderPurchaseBom() | L7958 | BOM-配置 |

**三处既有联动**
1. `navigateTo(page)` L21541：renderPage(page) 后加 `setMobileTabActive(映射[page] || mobileTab)`（仅视觉高亮）
2. `DOMContentLoaded` L21561：改为 `const savedTab = loadMobileTab(); if (isMobile() && savedTab) { switchMobileTab(savedTab); } else { renderPage(savedPage); }`
3. `startAutoRefresh` L21601：`before !== after` 分支内——`if (isMobile()) { const t = loadMobileTab(); if (t) { switchMobileTab(t); return; } } renderPage(page);`
4. 追加 breakpoint resize 监听：isMobile 翻转时——变手机→switchMobileTab(loadMobileTab())；变桌面→renderPage(loadCurrentPage() || 'dashboard')

### 3. 移动端 CSS 详单（新 @media 块）

```css
@media screen and (max-width: 768px) {
  /* 底部 Tab 栏 */
  #mobile-tabbar {
    display: flex; position: fixed; left:0; right:0; bottom:0;
    height: calc(56px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background:#fff; border-top:1px solid #e2e8f0; z-index:35;
  }
  #mobile-tabbar button { flex:1; display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:2px; min-height:44px; color:#64748b; font-size:11px; touch-action:manipulation; }
  #mobile-tabbar button svg { width:24px; height:24px; }
  #mobile-tabbar button.active { color:#0d9488; }
  body.sidebar-open #mobile-tabbar { transform: translateY(100%); }
  /* 内容区避让 */
  #page-content { padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important; }
  /* 全屏表单：所有 .fixed.inset-0 弹窗 → 底部 sheet（覆盖现有 L273 的缩窄规则） */
  .fixed.inset-0 { align-items:flex-end !important; padding:0 !important; }
  .fixed.inset-0 > div {
    max-width:100vw !important; width:100% !important; margin:0 !important;
    max-height:92dvh; border-radius:16px 16px 0 0 !important;
    overflow-y:auto; -webkit-overflow-scrolling:touch;
  }
  .fixed.inset-0 [class*="grid-cols-"] { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
  /* 触控友好（仅弹窗与新组件，不扫全站按钮） */
  .fixed.inset-0 button, .fixed.inset-0 input, .fixed.inset-0 select { min-height:44px; }
  #app, #page-content, #mobile-tabbar { touch-action: manipulation; }
  /* 可选：隐藏 header 用户区 */
  header .cursor-pointer[onclick="showUserInfoModal()"] { display:none; }
}
```

## 实施步骤

1. **index.html**：tabbar HTML + 桌面基态 CSS + 新 @media 块（含 sheet 覆盖）
2. **app.js 基础层**：isMobile/loadMobileTab/saveMobileTab/setMobileTabActive/switchMobileTab + renderMobileMe（先通链路）
3. **app.js 首页**：renderMobileHome
4. **app.js 卡片三页**：renderMobileSales/renderMobilePurchase/renderMobileInventory + mobileStatusBadge + 4 个动作包装
5. **复杂功能提示**：renderDesktopOnlyHint + 9 个叶子守卫（逐个 Read 确认首行）
6. **三处联动**：navigateTo 高亮、DOMContentLoaded 恢复、startAutoRefresh 刷新、breakpoint resize 监听
7. **验证**（见下）

## 验证

1. `node --check public/app.js`、`node --check server/index.js`
2. `npm run check`（66 测试全过——BOM 15 + 权限 16 + 仓库 35，均为 API 级，不受前端改动影响，但需确认 app.js 语法完好）
3. **浏览器实测（DevTools 375×667 移动端模拟）**：
   - 5 Tab 切换 → 对应卡片视图 + 激活态 + 标题
   - 首页 KPI/操作格子 → 销售创建全页表单、采购创建/手动入库出底部 sheet
   - 卡片列表操作闭环：详情/审核/收货后回到卡片视图
   - 全屏表单：贴底圆角、内部网格 2 列、可滚动、可关闭
   - 抽屉 → 报表/成本/财务账户/看板/BOM → 「建议电脑端」提示 + 返回按钮
   - 抽屉 → 销售订单列表完整页 → 表格滚动可用、tabbar 高亮正确
   - 重载页面 → 回到上次 Tab；拉宽到 >768px → 变回桌面视图（tabbar 消失）
4. **桌面回归（>768px）**：tabbar 不可见、弹窗居中不变、4 个巨型列表函数渲染不变

## 风险点

- 叶子守卫插入前逐个 Read 确认函数首行（async 前缀差异）
- switchMobileTab 严禁写 saveCurrentPage（否则手机重载被拉回桌面全页）
- sheet 覆盖仅限媒体查询内，不误伤桌面；#notif-dropdown 是 absolute 非 fixed，不受影响
- 新代码一律追加到 app.js 末尾，不插在文件中间
- renderMobileInventory 材料段直接复用现有空态页，不造数据
- 入库提交后落在桌面列表页（tabbar 仍在）——已知可接受，写入交付说明

## 关键文件

- e:\生产力\public\index.html（tabbar + CSS）
- e:\生产力\public\app.js（新函数追加末尾 + 3 处联动）
- e:\生产力\public\perm-core.js（hasPerm 供动作门控，只读）
- e:\生产力\server\index.js（/api/dashboard 数据源，只读，无需改动）
