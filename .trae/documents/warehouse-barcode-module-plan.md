# 仓库与条码模块开发计划（批次 5）

## Context
前四批功能增强（采购/供应商、报表统计、消息待办、系统稳定）已完成并提交、CI 通过。用户选择继续开发「仓库与条码模块」。

现状盘点（已探明）：
- **仓位数据存 localStorage**（`LOCATION_DATA_KEY`），后端无对应集合 —— 数据一致性隐患（记忆中的教训：跨页面字段不一致导致数据丢失）。
- 后端有 `/api/warehouses` CRUD、`/api/inventory` GET/PUT、`/api/stock-in-records` CRUD、`/api/common-stock-in`（入库模式：写 stockInRecords + 联动 inventory + products.stock）。
- **无** stockOutRecords 集合、**无**调拨/移库端点、**无**盘点端点、**无**任何条码/扫码代码。
- 前端「库存管理」菜单部分子项为死菜单（`switchInventoryTab` 无对应 case）：盘点库存清单(product-check)、打印产品库存标签(product-label)、材料移库(material-transfer)。
- `switchInventoryTab` 位于 app.js L8380；仓位函数 L17626-17882；`ensureDataIntegrity` server L142；CSP L62；产品白名单 L480/L497。

## 范围（用户已确认，全部实现）
1. 仓位数据上后端（修复 localStorage 不一致）
2. 仓库调拨/移库 + 出库记录
3. 盘点
4. 产品条码 + 标签打印
5. 扫码查询
6. 扫码出入库

不在本批次：库存统计、产品出入库查询（未选择，保持现状）。

---

## 一、后端 `server/index.js`

### 1.1 新数据集合 + 完整性
新增 4 个数组集合，均注册到 `ensureDataIntegrity` 的 collections 列表（L143-149）与 `initialData`：
- `warehouseLocations`：`{ id, warehouseId, warehouse(名称), name, isDefault, status(启用/停用), creator, createTime, modifier, modifyTime, remark, createdAt, updatedAt }`
- `stockOutRecords`：`{ id, stockOutNo('CK'+generateOrderNo), productId, productName, productModel, quantity, warehouse, location, type(出库/领用出库/调拨出库/盘点出库), targetWarehouse, color, spec, unit, remark, operator, createdAt }`
- `warehouseTransfers`：`{ id, transferNo('DB'+generateOrderNo), productId, productName, productModel, quantity, fromWarehouse, toWarehouse, fromLocation, toLocation, type(调拨/移库), operator, remark, createdAt }`
- `stocktakes`：`{ id, stocktakeNo('PD'+generateOrderNo), productId, productName, productModel, warehouse, currentQty, countedQty, diff, status('done'), operator, remark, createdAt }`

### 1.2 仓位 API（requirePerm('库存管理','仓位',...)）
- `GET /api/warehouse-locations`（仅鉴权）→ 列表
- `POST /api/warehouse-locations`（'添加'）：校验 name 非空；warehouseId→解析仓库名（回退 body.warehouse，再回退首个启用仓库）；写 creator/createTime。
- `PUT /api/warehouse-locations/:id`（'编辑'）：pick() 白名单更新，写 modifier/modifyTime/updatedAt。
- `DELETE /api/warehouse-locations/:id`（'删除'）：splice。
- 均 saveData() + logAudit()。

### 1.3 调拨/移库 + 出库
- `POST /api/warehouse-transfers`（requirePerm('库存管理','调拨','调拨')）：
  1. qty>0、productId 存在、from≠to 仓库（按名称或 id 解析，均须存在于 warehouses）
  2. 源仓 inventory 行必须存在且 `quantity >= qty`，否则 400「库存不足」，不扣减
  3. 扣源仓 quantity、加目标仓（无则新建 inventory 行）；**不**改 products.stock（总量守恒）
  4. 写 warehouseTransfers + stockOutRecords(type='调拨出库')
  5. saveData + logAudit('仓库调拨',...)
- `GET /api/warehouse-transfers`（仅鉴权）→ 列表
- `POST /api/stock-out-records`（requirePerm('库存管理','扫码出入库','出库')）：qty>0、产品存在；若有对应 inventory 行则校验库存充足并扣减；`products.stock = max(0, stock-qty)`；写记录。saveData + audit。
- `GET /api/stock-out-records`（仅鉴权）→ 列表

### 1.4 盘点
- `POST /api/stocktakes`（requirePerm('库存管理','盘点','盘点')）：产品存在、countedQty≥0；currentQty=对应 inventory 行数量；diff=counted-current；改 inventory.quantity=counted；`products.stock = max(0, stock+diff)`；写记录(status='done')。saveData + audit。
- `GET /api/stocktakes`、`GET /api/stocktakes/:id`（仅鉴权）

### 1.5 条码
- 产品创建/编辑白名单（L480/L497）加 `barcode: 'string'`；创建时缺省 `barcode = 'P'+id`（唯一、Code128 兼容）。
- `loadData()` 内一次性回填：无 barcode 的产品赋 `'P'+id`；仅在有赋值时 saveData。
- `POST /api/products/:id/barcode`（requirePerm('库存管理','条码','生成')）：body.barcode 可选——给出则校验可打印 ASCII 且不与其它产品重复（400「条码已被占用」）；缺省重生成 `'P'+id`。saveData + audit。
- `GET /api/products` 增加 `?barcode=` 过滤（精确匹配）。
- `GET /api/barcode/:code`（仅鉴权）→ `{ product, inventory: 该产品的库存行 }`（未知 404），供扫码页单次查询。

### 1.6 CSP（JsBarcode CDN 必需）
server L62：`script-src` 追加 `https://cdn.jsdelivr.net`。

---

## 二、前端 `public/app.js` + `public/index.html`

### 2.1 数据层
- `fetchData()`（L1656）：Promise.all 增加 4 个拉取（/api/warehouse-locations、/api/stock-out-records、/api/warehouse-transfers、/api/stocktakes）并入 data。
- 加载成功后执行 `migrateLocalStorageLocations()`（见 3.1），并 `locationData = data.warehouseLocations || []`。

### 2.2 仓位 localStorage → API
- `loadLocationData()` 改为 `loadWarehouseLocations()`：fetch API；`renderMaterialsWarehouseLocation()`（L17665）改为 async，渲染前先加载。
- 增 API 包装：`saveWarehouseLocationToApi`(POST) / `updateWarehouseLocationToApi`(PUT) / `deleteWarehouseLocationFromApi`(DELETE) / `toggleWarehouseLocationStatusApi`(PUT)。
- 改造 handlers：`saveLocation`→POST、`saveEditedLocation`→PUT、`deleteLocation`→DELETE、`toggleLocationStatus`→PUT；失败 showAlertModal。
- 新增仓位表单（L17726）加**仓库下拉**（来自 fetchWarehouses），使仓位绑定仓库。
- 修正 `renderProductStockInList()`（L8464）里的 `loadLocationData()` 调用。
- 删除 `saveLocationData()`（localStorage 写）不再使用。

### 2.3 switchInventoryTab 新增 case（L8380-8390）
`product-check → renderStocktake()`；`product-label → renderBarcodeLabel()`；`material-transfer → renderWarehouseTransfer()`；`scan-query → renderScanQuery()`；`scan-inout → renderScanInOut()`。

### 2.4 新页面函数（均用 esc()，标准 page-title/page-content 模式）
- `renderWarehouseTransfer()`（材料移库/仓库调拨）：产品选择、数量、源/目标仓库下拉（排除相同）、仓位下拉（按仓库过滤 locationData）、备注；提交按钮 `data-perm="库存管理-调拨-调拨"` → POST /api/warehouse-transfers；下方调拨记录表。
- `renderStocktake()`（盘点库存清单）：产品、仓库、盘点数量、备注；提交 `data-perm="库存管理-盘点-盘点"` → POST /api/stocktakes；盘点记录表（currentQty/countedQty/diff，差异着色）。
- `renderBarcodeLabel()`（打印产品库存标签）：产品表含条码列；行内「生成条码」`data-perm="库存管理-条码-生成"` → POST /api/products/:id/barcode；「打印标签」打开打印弹层：产品名/型号/展厅价/仓库/单位 + `JsBarcode('#barcodeSvg', code, {format:'CODE128',...})`（guard `typeof JsBarcode!=='undefined'`）；打印按钮 `window.print()`；注入 `@media print` 样式仅显示标签区。
- `renderScanQuery()`（扫码查询）：自动聚焦输入框，Enter 触发 `handleBarcodeScan(code)` → GET /api/barcode/:code → 渲染产品卡片 + 各仓库库存；扫完清空并重新聚焦（扫码枪 Enter 结尾）。
- `renderScanInOut()`（扫码出入库）：扫码填产品；模式切换 入库/出库/调拨 + 数量 + 仓库(+目标仓库/仓位) + 备注；提交分别调 `/api/common-stock-in`、`/api/stock-out-records`（`data-perm="库存管理-扫码出入库-出库"`）、`/api/warehouse-transfers`（`data-perm="库存管理-扫码出入库-调拨"`）；成功后刷新并复位。
- 共享辅助 `handleBarcodeScan(code)`：GET /api/barcode/:code → `{product, inventory}`。

### 2.5 工具栏与菜单接线（index.html）
- `renderInventoryProduct()` 工具栏（L8402-8408）新增「扫码查询」「扫码出入库」按钮（`data-perm` 标记）。
- 产品库存 tab（L414-421）：盘点库存清单 → `switchInventoryTab('product-check')`+`data-perm="库存管理-盘点-查看"`；打印产品库存标签 → `switchInventoryTab('product-label')`+`data-perm="库存管理-条码-查看"`；新增扫码查询/扫码出入库项。
- 变更 tab（L427-434）：材料移库 → `switchInventoryTab('material-transfer')`+`data-perm="库存管理-调拨-查看"`；新增仓库调拨项。
- 仓库资料 tab（L621-625）：仓位清单保留（已 API 化），可加 `data-perm="库存管理-仓位-查看"`；新增按钮加 `data-perm="库存管理-仓位-添加"`。
- `SUBMENU_ITEM_MAP['库存管理']`（L202-205）补充新菜单文案，保证权限过滤一致。
- index.html `<head>` 加 `<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>`（依赖 1.6 CSP）。

### 2.6 权限面板（L16218-16222 库存管理组）
新增子项（字符串与 requirePerm 完全一致）：
`仓位[查看/添加/编辑/删除]`、`调拨[查看/调拨]`、`盘点[查看/盘点]`、`条码[查看/生成/打印]`、`扫码出入库[查看/入库/出库/调拨]`。

---

## 三、数据迁移
- **localStorage 仓位 → 后端**（客户端，服务端读不到浏览器 localStorage）：`migrateLocalStorageLocations()` 在 fetchData 成功后调用——若后端为空且 localStorage 有数据，则逐条 POST（仓库取首个启用仓库名，保留 name/isDefault/status/creator/createTime），随后清 localStorage 并设迁移标记；若后端已有数据则直接清 localStorage。
- **服务端 seed**：loadData 内，当 `warehouseLocations` 为空时按每个启用仓库生成 2 个示例仓位（如 A001/A002、B001/B002），creator='系统'。
- **条码回填**：见 1.5。
- **不做** stockOutRecords/warehouseTransfers/stocktakes 种子数据；测试数据在验证后清理。

---

## 四、验证（每阶段后 `npm run check`：node --check 三文件 + 16 单测）
1. **API 链路**（Node http 脚本直连 localhost:3000，admin/admin123，x-access-token）：
   - GET /api/warehouse-locations（≥2 条）；POST/PUT/DELETE 仓位 → 200
   - POST /api/products/:id/barcode → 200；GET /api/products?barcode= → 命中；GET /api/barcode/:code → product+inventory
   - POST /api/warehouse-transfers（qty 充足）→ 源仓减/目标仓加/出库记录生成；库存不足/同仓 → 400
   - POST /api/stock-out-records → stockOutRecords 增、products.stock 减
   - POST /api/stocktakes（counted 与 current 不同）→ diff 正确、库存调整
   - GET 各列表；data.json 持久化确认
   - 清理测试记录 / 从备份恢复
2. **浏览器冒烟**（admin）：仓位清单 CRUD 反映后端；盘点/标签打印（JsBarcode SVG + 打印预览）/扫码查询/扫码出入库（输入条码+Enter→出库/调拨）走通；受限角色仅见授权菜单（抽查仅授 `库存管理-盘点-盘点` 的角色）。
3. 服务重启 `/api/health` 200、无数据丢失；既有页面无回归。

## 关键文件
- server/index.js：ensureDataIntegrity(L142)、CSP(L62)、产品白名单(L480/L497)、loadData(L156)、新端点（仓位/调拨/出库/盘点/条码）
- public/app.js：fetchData(L1656)、switchInventoryTab(L8380)、工具栏(L8402)、仓位块(L17626-17882)、权限面板(L16218)、SUBMENU_ITEM_MAP(L202)
- public/index.html：库存管理下拉(L395-439)、变更 tab(L427-434)、仓库资料 tab(L621-625)、JsBarcode script(L7)
