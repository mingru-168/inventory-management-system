# 功能增强实施计划

## Context
上一批功能增强（看板可视化 / 打印导出 / 调换货审批 / 财务清洗）已完成并提交、CI 通过。
用户选择继续增强四个方向：**采购与供应商模块、报表与统计中心、消息与待办提醒、系统稳定与体验**。

现状盘点（已探明）：
- 后端已具备：`/api/suppliers` CRUD、`/api/purchase-orders` GET/POST/PUT（POST 联动财务支出、PUT completed 回补库存）、`/api/purchase-suggestions` 采购建议。
- 前端采购菜单（采购单/材料收货/成品收货/退货）与部分报表（采购/财务/排名）目前是**占位**（显示“功能开发中”）。
- 系统无通知/待办集合；断言已记录 `auditLogs`；`saveData` 已有串行写队列、`ensureDataIntegrity` 保集合完整、会话持久化。
- 数据为真实样本（6 产品、7 销售订单、7 财务记录），足以支撑报表聚合。
- 权限三位一体 `requirePerm(模块,功能,动作)` 集中在 `public/perm-core.js`，前后端统一。

交付节奏：**分批交付**，每次完成一个方向即提交一次、并行验证。本计划文件为全局路线图，最终执行经批准后从批次 1 开始。

---

## 批次 1：采购与供应商模块（本次执行的起点）

目标：把采购闭环从占位补成可用的业务模块——供应商基础资料 → 采购下单 → 材料/成品收货入库 → 采购退货，并与库存、财务、采购建议联动。

### 后端 `server/index.js`
1. 采购单状态机与去重：定状态 `pending(下单)→received(收货确认)→completed(结算)`。明确收货时才回补库存/生成支出，避免与现有 `completed 入库` 双写重复。保留 `items` 明细白名单。
2. 新增 `/api/purchase-orders/:id` DELETE：作废待收采购单（仅 pending 可删），关联支出财务记录作废/标记。
3. 新增 `/api/purchase-orders/:id/receive`（材料/成品收货接口，`requirePerm('采购管理',...,'收货')`）：按 items 增加 `data.inventory.quantity`、写入 `data.stockInRecords`、推进采购单状态。
4. 新增 `/api/purchase-returns`：红冲库存与采购支出财务记录（`/api/purchase-returns` POST）。
5. 校验 reuse：`pick()` 字段白名单、`generateOrderNo('PO', ...)`、`saveData()`、`logAudit`、`ensureDataIntegrity` 均复用现有实现。
6. 权限：为采购收货/退货等在 `perm-core.js` 或 roles 补充 `采购管理-*` 权限维度（如已有则复用）。

### 前端 `public/app.js` + `public/index.html`
1. `renderPurchase()` 作为采购模块路由，子页 `renderPurchaseOrder` / `renderPurchaseReceive` / `renderPurchaseReceiveProduct` / `renderPurchaseReturn` 从占位改为真实渲染：
   - 采购单列表 + 创建采购单表单（选供应商、产品明细、金额）+ 状态操作（收货/结算/作废）。
   - 材料收货 / 成品收货：待收采购单列表 + 收货确认，成功后刷新库存。
   - 退货：退货单列表 + 创建退货（选择产品，联动库存与财务）。
2. 供应商基础资料：确认 `renderMaterialsSupplierList/Create` 现状，缺失则补齐（列表/新增/编辑/删除，接 `/api/suppliers`）。
3. 采购建议：采购下单页内嵌 `/api/purchase-suggestions` 推荐（可选）。
4. 菜单 `data-perm` 标记与 `applyMenuPermissions` 保持一致。

### 数据
`server/data.json`：`suppliers` 示例供应商数据（1~2 条）、验收用采购单在测试后清理；`ensureDataIntegrity` 保证 `purchaseOrders/stockInRecords` 集合存在。

---

## 批次 2：报表与统计中心
- 后端增加 `/api/reports` 聚合（或按前端调用拆分）：销量(日/月、状态)、生产、库存(出入库明细/月报)、采购(供应商供货柱状图/未付款/采购金额)、财务(收支/资金日报月报/客户收款)、排名(产品订货/发货、客户、供应商采购排名)。
- 前端补齐 `renderReportsSales/Production/Inventory/Purchase/Finance/Ranking` 真实图表，复用 `trendBarsHTML`/`statusDonutHTML`/SVG 辅助函数与既有 `switchReportsTab` 路由骨架。
- 数据来自现有 `salesOrders/financeRecords/purchaseOrders/stockInRecords/inventory`。

## 批次 3：消息与待办提醒（站内）
- 后端新增 `notifications` 集合与生成逻辑：审批待办（待审核订单、调换货、排产）、库存预警、交货临期、采购单待收货；`/api/notifications` 读 + 标记已读。
- 前端顶部铃铛角标 + 待办下拉 + 待办通知页面，点击跳转对应业务页；`renderDashboard` 复用已有 alerts 数据接入角标。
- 复用 `ensureDataIntegrity` 初始化 `notifications`。

## 批次 4：系统稳定与体验
- 数据自动备份：每日快照到 `server/backup/`，保留 N 份；新增 `/api/admin/backup` 手动备份（admin 权限）。
- 操作日志查询界面：`auditLogs` 按用户/时间/模块筛选。
- 输入校验强化、加载/空态、列表分页或性能优化、接口错误提示统一。

---

## Verification（每个批次）
1. `npm run check` → 语法检查 + 16 个权限单测通过。
2. 用 Node 脚本直连 API 走通关键链路并验证联动：
   - 采购：创建供应商→创建采购单→收货→断言 `inventory.quantity` 增加、`financeRecords` 出现采购支出、`stockInRecords` 新增。
   - 退货：红冲后断言库存回减、财务支出调整。
3. 登录 admin 用浏览器(前端)验证页面渲染、按钮权限、菜单跳转。
4. 服务重启后 `/api/health` 200、数据持久化无丢失。
5. 无回归：既有看板、订单、财务页面仍正常。