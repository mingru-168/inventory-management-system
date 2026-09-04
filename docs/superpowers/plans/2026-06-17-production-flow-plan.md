# 生产流程优化实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 执行此计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 实现销售订单审核后自动配货、无库存自动进入生产流程、工序配置与完工确认的完整闭环。

**架构：** 基于现有 Express + JSON 文件存储系统，新增计划订单和工序数据结构，扩展销售订单审核逻辑实现自动配货，添加生产看板页面。

**技术栈：** Node.js + Express（后端）, 原生 JavaScript + Tailwind CSS（前端）, JSON 文件存储

---

## 文件结构

```
e:\生产力\
├── server/
│   └── index.js          # 后端API（修改）
├── public/
│   └── app.js            # 前端页面（修改）
└── docs/superpowers/specs/
    └── 2026-06-17-production-flow-design.md  # 设计文档（已存在）
```

---

## Phase 1: 数据结构与基础API

### Task 1: 添加数据结构

**Files:**
- Modify: `server/index.js:15-57` (initialData)

- [ ] **Step 1: 在 initialData 中添加 planOrders 和 processes 数组**

在 `initialData` 中添加空数组用于存储计划订单和工序：

```javascript
const initialData = {
  // ... 现有数据 ...
  planOrders: [],  // 新增：计划订单
  processes: [],   // 新增：工序
};
```

- [ ] **Step 2: 在 loadData 中确保新数组存在**

在 `loadData()` 函数返回时添加空数组检查：

```javascript
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(content);
      // 确保新数组存在
      if (!loaded.planOrders) loaded.planOrders = [];
      if (!loaded.processes) loaded.processes = [];
      return loaded;
    }
  } catch (error) {
    console.error('Failed to load data file:', error);
  }
  const result = JSON.parse(JSON.stringify(initialData));
  result.planOrders = [];
  result.processes = [];
  return result;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add planOrders and processes data structure"
```

---

### Task 2: 实现计划订单API

**Files:**
- Modify: `server/index.js` (在文件末尾添加新API)

- [ ] **Step 1: 添加计划订单GET API**

```javascript
// 获取计划订单列表
app.get('/api/plan-orders', (req, res) => {
  const { status, orderId } = req.query;
  let result = data.planOrders || [];
  if (status) {
    result = result.filter(o => o.status === status);
  }
  if (orderId) {
    result = result.filter(o => o.orderId === orderId);
  }
  res.json(result);
});

// 获取单个计划订单详情
app.get('/api/plan-orders/:id', (req, res) => {
  const planOrder = data.planOrders.find(o => o.id === req.params.id);
  if (planOrder) {
    // 关联工序信息
    const processes = data.processes.filter(p => p.planOrderId === planOrder.id)
      .sort((a, b) => a.sequence - b.sequence);
    res.json({ ...planOrder, processes });
  } else {
    res.status(404).json({ error: 'Plan order not found' });
  }
});

// 创建计划订单
app.post('/api/plan-orders', (req, res) => {
  const { orderId, productId, quantity } = req.body;
  
  // 获取产品信息
  const product = data.products.find(p => String(p.id) === String(productId));
  const order = data.salesOrders.find(o => o.id === orderId);
  
  const planOrder = {
    id: 'po_' + Date.now(),
    orderId,
    productId,
    productName: product?.type || product?.name || '',
    productModel: product?.model || product?.sku || '',
    quantity: Number(quantity) || 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  data.planOrders.push(planOrder);
  
  // 更新销售订单状态为生产中
  if (order) {
    order.status = 'in_production';
    order.updatedAt = new Date().toISOString();
  }
  
  saveData();
  res.json(planOrder);
});

// 更新计划订单状态
app.put('/api/plan-orders/:id/status', (req, res) => {
  const planOrder = data.planOrders.find(o => o.id === req.params.id);
  if (planOrder) {
    planOrder.status = req.body.status;
    planOrder.updatedAt = new Date().toISOString();
    saveData();
    res.json(planOrder);
  } else {
    res.status(404).json({ error: 'Plan order not found' });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/index.js
git commit -m "feat: add plan-orders API endpoints"
```

---

### Task 3: 实现工序API

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 添加工序API**

```javascript
// 获取工序列表（支持筛选）
app.get('/api/processes', (req, res) => {
  const { status, planOrderId } = req.query;
  let result = data.processes || [];
  if (status) {
    result = result.filter(p => p.status === status);
  }
  if (planOrderId) {
    result = result.filter(p => p.planOrderId === planOrderId);
  }
  // 按顺序排序
  result = result.sort((a, b) => a.sequence - b.sequence);
  res.json(result);
});

// 获取待确认工序（看板用）
app.get('/api/processes/pending', (req, res) => {
  const pendingProcesses = data.processes
    .filter(p => p.status === 'pending' || p.status === 'in_progress')
    .sort((a, b) => a.sequence - b.sequence);
  
  // 关联计划订单和产品信息
  const result = pendingProcesses.map(process => {
    const planOrder = data.planOrders.find(po => po.id === process.planOrderId);
    const order = planOrder ? data.salesOrders.find(o => o.id === planOrder.orderId) : null;
    return {
      ...process,
      orderNo: order?.orderNo || '-',
      productName: planOrder?.productName || '-',
      quantity: planOrder?.quantity || 0
    };
  });
  
  res.json(result);
});

// 配置工序（批量添加/更新）
app.put('/api/plan-orders/:id/processes', (req, res) => {
  const { processes } = req.body;
  const planOrderId = req.params.id;
  
  const planOrder = data.planOrders.find(o => o.id === planOrderId);
  if (!planOrder) {
    res.status(404).json({ error: 'Plan order not found' });
    return;
  }
  
  // 删除旧的工序
  data.processes = data.processes.filter(p => p.planOrderId !== planOrderId);
  
  // 添加新工序
  const newProcesses = processes.map((p, index) => ({
    id: 'proc_' + Date.now() + '_' + index,
    planOrderId,
    name: p.name,
    sequence: p.sequence,
    status: 'pending',
    assignee: p.assignee || '',
    completedAt: null,
    createdAt: new Date().toISOString()
  }));
  
  // 确保最后一道是入库工序
  const hasStockIn = newProcesses.some(p => p.name === '入库');
  if (!hasStockIn) {
    newProcesses.push({
      id: 'proc_' + Date.now() + '_stockin',
      planOrderId,
      name: '入库',
      sequence: newProcesses.length + 1,
      status: 'pending',
      assignee: '',
      completedAt: null,
      createdAt: new Date().toISOString()
    });
  }
  
  data.processes.push(...newProcesses);
  
  // 更新计划订单状态为进行中
  planOrder.status = 'in_progress';
  planOrder.updatedAt = new Date().toISOString();
  
  saveData();
  res.json({ success: true, processes: newProcesses });
});

// 派工
app.put('/api/processes/:id/assign', (req, res) => {
  const { assignee } = req.body;
  const process = data.processes.find(p => p.id === req.params.id);
  
  if (process) {
    process.assignee = assignee;
    process.status = 'in_progress';
    saveData();
    res.json({ success: true, process });
  } else {
    res.status(404).json({ error: 'Process not found' });
  }
});

// 工序完工确认
app.put('/api/processes/:id/complete', (req, res) => {
  const process = data.processes.find(p => p.id === req.params.id);
  
  if (!process) {
    res.status(404).json({ error: 'Process not found' });
    return;
  }
  
  if (process.status === 'completed') {
    res.status(400).json({ error: 'Process already completed' });
    return;
  }
  
  process.status = 'completed';
  process.completedAt = new Date().toISOString();
  
  // 检查是否为入库工序
  const isStockIn = process.name === '入库';
  const planOrder = data.planOrders.find(po => po.id === process.planOrderId);
  
  if (isStockIn && planOrder) {
    // 入库工序完成，触发自动配货
    const order = data.salesOrders.find(o => o.id === planOrder.orderId);
    
    // 创建入库记录
    const inventoryRecord = {
      id: 'inv_' + Date.now(),
      productId: planOrder.productId,
      productName: planOrder.productName,
      productModel: planOrder.productModel,
      quantity: planOrder.quantity,
      warehouse: '主仓库',
      location: '',
      createdAt: new Date().toISOString()
    };
    data.inventory.push(inventoryRecord);
    
    // 更新库存
    const inv = data.inventory.find(i => i.productId === planOrder.productId);
    if (inv) {
      inv.quantity = (inv.quantity || 0) + planOrder.quantity;
    }
    const product = data.products.find(p => String(p.id) === String(planOrder.productId));
    if (product) {
      product.stock = (product.stock || 0) + planOrder.quantity;
    }
    
    // 自动配货
    if (order) {
      const product = data.products.find(p => String(p.id) === String(planOrder.productId));
      const allocationRecord = {
        id: 'alloc_' + Date.now(),
        orderId: order.id,
        orderNo: order.orderNo,
        productId: planOrder.productId,
        productName: planOrder.productName,
        productModel: planOrder.productModel,
        quantity: planOrder.quantity,
        allocatedAt: new Date().toISOString()
      };
      data.allocationRecords.push(allocationRecord);
      
      order.status = 'allocated';
      order.allocatedAt = new Date().toISOString();
    }
    
    // 更新计划订单状态
    planOrder.status = 'completed';
    planOrder.updatedAt = new Date().toISOString();
  }
  
  saveData();
  res.json({ 
    success: true, 
    process,
    isLastProcess: isStockIn,
    planOrder
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add server/index.js
git commit -m "feat: add processes API endpoints"
```

---

## Phase 2: 核心流程实现

### Task 4: 实现审核订单自动配货API

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 添加审核订单API**

在 `/api/sales-orders/:id/status` 之后添加：

```javascript
// 审核订单（自动配货）
app.post('/api/sales-orders/:id/approve', (req, res) => {
  const order = data.salesOrders.find(o => o.id === req.params.id);
  
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  
  if (order.status !== 'pending') {
    res.status(400).json({ error: 'Order status cannot be approved', currentStatus: order.status });
    return;
  }
  
  const allocatedItems = [];
  const unallocatedItems = [];
  
  // 初始化配货记录数组
  if (!data.allocationRecords) {
    data.allocationRecords = [];
  }
  if (!data.inventory) {
    data.inventory = [];
  }
  
  order.items.forEach((item) => {
    const productId = item.productId || item.product_id;
    const requiredQty = Number(item.quantity) || 0;
    
    // 计算可用库存
    let availableStock = 0;
    const inventoryItem = data.inventory.find(inv => String(inv.productId) === String(productId));
    if (inventoryItem) {
      availableStock = Number(inventoryItem.quantity) || 0;
    }
    
    const product = data.products.find(p => String(p.id) === String(productId));
    const productName = item.productName || item.name || item.type || product?.type || product?.name || '';
    const productModel = item.productModel || item.model || product?.model || product?.sku || '';
    
    if (availableStock >= requiredQty) {
      // 库存充足，自动配货
      if (inventoryItem) {
        inventoryItem.quantity = availableStock - requiredQty;
      }
      if (product) {
        product.stock = (Number(product.stock) || 0) - requiredQty;
      }
      
      // 创建配货记录
      const allocationRecord = {
        id: 'alloc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        orderId: order.id,
        orderNo: order.orderNo,
        productId,
        productName,
        productModel,
        color: item.color || product?.color || '',
        spec: item.spec || product?.spec || '',
        tabletopColor: item.tabletopColor || product?.tabletopColor || '',
        quantity: requiredQty,
        allocatedAt: new Date().toISOString()
      };
      data.allocationRecords.push(allocationRecord);
      
      allocatedItems.push({
        productId,
        productName,
        productModel,
        quantity: requiredQty
      });
    } else {
      // 库存不足
      unallocatedItems.push({
        productId,
        productName,
        productModel,
        required: requiredQty,
        available: availableStock
      });
    }
  });
  
  if (unallocatedItems.length > 0) {
    // 有产品库存不足，订单进入生产流程
    order.status = 'in_production';
    order.inProductionAt = new Date().toISOString();
    saveData();
    res.json({
      success: false,
      reason: '库存不足，需要安排生产',
      allocatedItems,
      unallocatedItems,
      order
    });
  } else {
    // 全部配货成功
    order.status = 'allocated';
    order.allocatedAt = new Date().toISOString();
    saveData();
    res.json({
      success: true,
      allocatedItems,
      order
    });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/index.js
git commit -m "feat: add approve order API with auto-allocation"
```

---

### Task 5: 前端实现审核订单功能

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 添加审核订单按钮和逻辑**

在销售订单列表的"操作"列添加审核按钮：

```javascript
// 在 showSalesOrders 函数中，找到操作列，添加审核按钮
// 原代码类似：
const actions = `
  ${order.status === 'pending' ? `<button onclick="approveOrder('${order.id}')" class="text-teal-600 hover:text-teal-800">审核</button>` : ''}
  ${order.status === 'approved' || order.status === 'allocated' ? `<button onclick="shipOrder('${order.id}')" class="text-blue-600 hover:text-blue-800">发货</button>` : ''}
`;
```

- [ ] **Step 2: 添加 approveOrder 函数**

```javascript
// 审核订单
async function approveOrder(orderId) {
  if (!confirm('确认审核此订单？系统将自动检查库存并配货。')) return;
  
  try {
    const response = await fetch(`/api/sales-orders/${orderId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();
    
    if (result.success) {
      alert(`审核成功！已自动配货 ${result.allocatedItems.length} 个产品`);
    } else {
      alert(`库存不足，需要安排生产：\n${result.unallocatedItems.map(i => `${i.productName}: 需要${i.required}, 可用${i.available}`).join('\n')}`);
    }
    
    // 刷新订单列表
    showSalesOrders();
  } catch (error) {
    console.error('Approve order failed:', error);
    alert('审核失败：' + error.message);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add approve order button and function"
```

---

### Task 6: 前端实现"安排生产"功能

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 添加安排生产按钮**

在订单列表中，对于 in_production 状态的订单添加"安排生产"按钮：

```javascript
// 在操作列添加
${order.status === 'in_production' ? `
  <button onclick="arrangeProduction('${order.id}')" class="text-orange-600 hover:text-orange-800">安排生产</button>
` : ''}
```

- [ ] **Step 2: 添加 arrangeProduction 函数和弹窗**

```javascript
// 安排生产
async function arrangeProduction(orderId) {
  // 获取订单详情
  const order = await fetch(`/api/sales-orders/${orderId}`).then(r => r.json());
  
  if (!order.items || order.items.length === 0) {
    alert('订单没有产品，无法安排生产');
    return;
  }
  
  // 为每个产品创建计划订单
  for (const item of order.items) {
    const product = await fetch(`/api/products/${item.productId}`).then(r => r.json());
    
    await fetch('/api/plan-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity
      })
    });
  }
  
  alert('已创建计划订单，请配置工序');
  showSalesOrders();
  showPlanOrders();
}
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add arrange production feature"
```

---

## Phase 3: 生产看板与工序配置

### Task 7: 实现生产看板页面

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 添加生产看板标签页**

在导航栏添加"生产看板"标签页入口，然后实现看板页面：

```javascript
// 生产看板页面HTML
function showProductionBoard() {
  const content = `
    <div class="bg-white rounded-lg shadow p-6">
      <h2 class="text-xl font-bold mb-4">生产看板</h2>
      <div class="flex gap-2 mb-4">
        <button onclick="loadProductionBoard('pending')" class="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700">待确认</button>
        <button onclick="loadProductionBoard('in_progress')" class="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">进行中</button>
        <button onclick="loadProductionBoard('all')" class="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">全部</button>
      </div>
      <div id="production-board-content">
        <p class="text-gray-500">加载中...</p>
      </div>
    </div>
  `;
  document.getElementById('main-content').innerHTML = content;
  loadProductionBoard('pending');
}

// 加载生产看板数据
async function loadProductionBoard(filter) {
  const url = filter === 'all' ? '/api/processes' : '/api/processes?status=' + filter;
  const processes = await fetch(url).then(r => r.json());
  
  const content = document.getElementById('production-board-content');
  if (processes.length === 0) {
    content.innerHTML = '<p class="text-gray-500">暂无待处理工序</p>';
    return;
  }
  
  let html = `
    <table class="w-full border-collapse">
      <thead>
        <tr class="bg-gray-100">
          <th class="px-4 py-2 text-left">序号</th>
          <th class="px-4 py-2 text-left">订单号</th>
          <th class="px-4 py-2 text-left">产品</th>
          <th class="px-4 py-2 text-left">数量</th>
          <th class="px-4 py-2 text-left">工序</th>
          <th class="px-4 py-2 text-left">执行人</th>
          <th class="px-4 py-2 text-left">状态</th>
          <th class="px-4 py-2 text-left">操作</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  processes.forEach((p, index) => {
    const statusClass = p.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700';
    const statusText = p.status === 'pending' ? '待派工' : '进行中';
    const actionBtn = p.assignee ? 
      `<button onclick="showCompleteDialog('${p.id}')" class="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700">确认完工</button>` :
      `<button onclick="showAssignDialog('${p.id}')" class="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-700">派工</button>`;
    
    html += `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-4 py-2">${index + 1}</td>
        <td class="px-4 py-2">${p.orderNo || '-'}</td>
        <td class="px-4 py-2">${p.productName || '-'}</td>
        <td class="px-4 py-2">${p.quantity || 0}</td>
        <td class="px-4 py-2">${p.name}</td>
        <td class="px-4 py-2">${p.assignee || '-'}</td>
        <td class="px-4 py-2"><span class="px-2 py-1 rounded ${statusClass}">${statusText}</span></td>
        <td class="px-4 py-2">${actionBtn}</td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  content.innerHTML = html;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: add production board page"
```

---

### Task 8: 实现派工和完工确认弹窗

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 添加派工弹窗**

```javascript
// 显示派工弹窗
function showAssignDialog(processId) {
  const dialog = document.createElement('div');
  dialog.id = 'assign-dialog';
  dialog.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  dialog.innerHTML = `
    <div class="bg-white rounded-lg p-6 w-96">
      <h3 class="text-lg font-bold mb-4">派工</h3>
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">执行人</label>
        <input type="text" id="assignee-input" class="w-full px-3 py-2 border rounded" placeholder="请输入执行人姓名">
      </div>
      <div class="flex justify-end gap-2">
        <button onclick="closeDialog('assign-dialog')" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">取消</button>
        <button onclick="assignProcess('${processId}')" class="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700">确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  document.getElementById('assignee-input').focus();
}

// 执行派工
async function assignProcess(processId) {
  const assignee = document.getElementById('assignee-input').value.trim();
  if (!assignee) {
    alert('请输入执行人');
    return;
  }
  
  try {
    await fetch(`/api/processes/${processId}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee })
    });
    closeDialog('assign-dialog');
    loadProductionBoard('pending');
  } catch (error) {
    alert('派工失败：' + error.message);
  }
}
```

- [ ] **Step 2: 添加完工确认弹窗**

```javascript
// 显示完工确认弹窗
async function showCompleteDialog(processId) {
  const processes = await fetch('/api/processes').then(r => r.json());
  const process = processes.find(p => p.id === processId);
  
  if (!process) {
    alert('工序不存在');
    return;
  }
  
  const isStockIn = process.name === '入库';
  const message = isStockIn ? 
    `确认入库后将自动完成配货，是否继续？` : 
    `确认完工后该工序将标记为完成，是否继续？`;
  
  const dialog = document.createElement('div');
  dialog.id = 'complete-dialog';
  dialog.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  dialog.innerHTML = `
    <div class="bg-white rounded-lg p-6 w-96">
      <h3 class="text-lg font-bold mb-2">确认完工</h3>
      <div class="mb-4 space-y-2">
        <p><strong>工序名称：</strong>${process.name}</p>
        <p><strong>关联订单：</strong>${process.orderNo || '-'}</p>
        <p><strong>关联产品：</strong>${process.productName || '-'}</p>
        <p><strong>执行人：</strong>${process.assignee || '-'}</p>
      </div>
      <p class="text-sm text-gray-600 mb-4">${message}</p>
      <div class="flex justify-end gap-2">
        <button onclick="closeDialog('complete-dialog')" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">取消</button>
        <button onclick="completeProcess('${processId}')" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">确认完工</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
}

// 执行完工确认
async function completeProcess(processId) {
  try {
    const response = await fetch(`/api/processes/${processId}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();
    
    closeDialog('complete-dialog');
    
    if (result.isLastProcess) {
      alert('入库完成！已自动配货，订单进入待发货状态');
    } else {
      alert('工序完工确认成功');
    }
    
    loadProductionBoard('pending');
  } catch (error) {
    alert('完工确认失败：' + error.message);
  }
}

// 关闭弹窗
function closeDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (dialog) dialog.remove();
}
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add assign and complete process dialogs"
```

---

### Task 9: 实现工序配置页面

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 添加计划订单列表页面**

```javascript
// 显示计划订单列表
function showPlanOrders() {
  const content = `
    <div class="bg-white rounded-lg shadow p-6">
      <h2 class="text-xl font-bold mb-4">计划订单</h2>
      <div id="plan-orders-content">
        <p class="text-gray-500">加载中...</p>
      </div>
    </div>
  `;
  document.getElementById('main-content').innerHTML = content;
  loadPlanOrders();
}

// 加载计划订单列表
async function loadPlanOrders() {
  const planOrders = await fetch('/api/plan-orders').then(r => r.json());
  const content = document.getElementById('plan-orders-content');
  
  if (planOrders.length === 0) {
    content.innerHTML = '<p class="text-gray-500">暂无计划订单</p>';
    return;
  }
  
  let html = `
    <table class="w-full border-collapse">
      <thead>
        <tr class="bg-gray-100">
          <th class="px-4 py-2 text-left">序号</th>
          <th class="px-4 py-2 text-left">关联订单</th>
          <th class="px-4 py-2 text-left">产品</th>
          <th class="px-4 py-2 text-left">数量</th>
          <th class="px-4 py-2 text-left">状态</th>
          <th class="px-4 py-2 text-left">操作</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  planOrders.forEach((po, index) => {
    const statusMap = {
      'pending': { text: '待配置', class: 'bg-yellow-100 text-yellow-700' },
      'in_progress': { text: '生产中', class: 'bg-blue-100 text-blue-700' },
      'completed': { text: '已完成', class: 'bg-green-100 text-green-700' }
    };
    const status = statusMap[po.status] || statusMap['pending'];
    
    html += `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-4 py-2">${index + 1}</td>
        <td class="px-4 py-2">${po.orderId || '-'}</td>
        <td class="px-4 py-2">${po.productName || '-'}</td>
        <td class="px-4 py-2">${po.quantity}</td>
        <td class="px-4 py-2"><span class="px-2 py-1 rounded ${status.class}">${status.text}</span></td>
        <td class="px-4 py-2">
          <button onclick="showProcessConfig('${po.id}')" class="text-teal-600 hover:text-teal-800 mr-2">配置工序</button>
        </td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  content.innerHTML = html;
}
```

- [ ] **Step 2: 添加工序配置弹窗**

```javascript
// 显示工序配置弹窗
async function showProcessConfig(planOrderId) {
  const planOrder = await fetch(`/api/plan-orders/${planOrderId}`).then(r => r.json());
  
  const dialog = document.createElement('div');
  dialog.id = 'process-config-dialog';
  dialog.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  dialog.style.maxHeight = '80vh';
  dialog.style.overflowY = 'auto';
  
  const processesHtml = (planOrder.processes || []).map((p, i) => `
    <div class="flex gap-2 mb-2 process-item" data-index="${i}">
      <input type="text" value="${p.name}" class="process-name px-2 py-1 border rounded flex-1" placeholder="工序名称">
      <input type="number" value="${p.sequence}" class="process-sequence w-16 px-2 py-1 border rounded text-center" placeholder="#">
      <button onclick="removeProcessConfig(${i})" class="px-2 py-1 bg-red-500 text-white rounded">删除</button>
    </div>
  `).join('');
  
  dialog.innerHTML = `
    <div class="bg-white rounded-lg p-6 w-[600px]">
      <h3 class="text-lg font-bold mb-4">配置工序 - ${planOrder.productName}</h3>
      <p class="text-sm text-gray-500 mb-4">数量：${planOrder.quantity}</p>
      
      <div id="process-list" class="mb-4">
        ${processesHtml}
      </div>
      
      <button onclick="addProcessConfig()" class="mb-4 px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700">+ 添加工序</button>
      
      <p class="text-sm text-orange-500 mb-4">注意：最后一道工序将自动设为"入库"</p>
      
      <div class="flex justify-end gap-2">
        <button onclick="closeDialog('process-config-dialog')" class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">取消</button>
        <button onclick="saveProcessConfig('${planOrderId}')" class="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
}

// 添加工序配置行
function addProcessConfig() {
  const list = document.getElementById('process-list');
  const index = list.children.length;
  const html = `
    <div class="flex gap-2 mb-2 process-item" data-index="${index}">
      <input type="text" class="process-name px-2 py-1 border rounded flex-1" placeholder="工序名称">
      <input type="number" value="${index + 1}" class="process-sequence w-16 px-2 py-1 border rounded text-center" placeholder="#">
      <button onclick="removeProcessConfig(${index})" class="px-2 py-1 bg-red-500 text-white rounded">删除</button>
    </div>
  `;
  list.insertAdjacentHTML('beforeend', html);
}

// 删除工序配置行
function removeProcessConfig(index) {
  const items = document.querySelectorAll('.process-item');
  items[index]?.remove();
  // 重新编号
  document.querySelectorAll('.process-item').forEach((item, i) => {
    item.dataset.index = i;
    item.querySelector('.process-sequence').value = i + 1;
    item.querySelector('button').setAttribute('onclick', `removeProcessConfig(${i})`);
  });
}

// 保存工序配置
async function saveProcessConfig(planOrderId) {
  const items = document.querySelectorAll('.process-item');
  const processes = Array.from(items).map((item, i) => ({
    name: item.querySelector('.process-name').value,
    sequence: parseInt(item.querySelector('.process-sequence').value) || (i + 1)
  })).filter(p => p.name.trim());
  
  try {
    await fetch(`/api/plan-orders/${planOrderId}/processes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processes })
    });
    
    closeDialog('process-config-dialog');
    alert('工序配置保存成功');
    loadPlanOrders();
  } catch (error) {
    alert('保存失败：' + error.message);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add process configuration page"
```

---

## Phase 4: 流程贯通与测试

### Task 10: 添加导航入口

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 在导航栏添加生产看板和计划订单入口**

在现有的标签页导航中添加新标签：

```javascript
// 在导航栏HTML中添加
<button onclick="showSalesOrders()" class="tab-btn ${currentTab === 'sales' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600'} px-4 py-2 rounded-t">销售订单</button>
<button onclick="showProductionBoard()" class="tab-btn ${currentTab === 'production' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600'} px-4 py-2 rounded-t">生产看板</button>
<button onclick="showPlanOrders()" class="tab-btn ${currentTab === 'plan' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600'} px-4 py-2 rounded-t">计划订单</button>
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: add navigation tabs for production board"
```

---

### Task 11: 更新订单状态显示

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 更新订单状态标签**

确保销售订单列表中的状态标签正确显示：

```javascript
// 状态显示映射
const statusLabels = {
  'pending': { text: '待审核', class: 'bg-yellow-100 text-yellow-700' },
  'in_production': { text: '生产中', class: 'bg-orange-100 text-orange-700' },
  'allocated': { text: '已配货', class: 'bg-cyan-100 text-cyan-700' },
  'ready_to_ship': { text: '待发货', class: 'bg-purple-100 text-purple-700' },
  'shipped': { text: '已发货', class: 'bg-green-100 text-green-700' },
  'completed': { text: '已完成', class: 'bg-emerald-100 text-emerald-700' },
  'cancelled': { text: '已取消', class: 'bg-gray-100 text-gray-500' }
};
```

- [ ] **Step 2: 更新销售订单筛选标签**

添加"待审核"和"生产中"筛选：

```javascript
// 在 showSalesOrders 函数中添加筛选标签
<div class="flex gap-2 mb-4">
  <button onclick="filterOrders('all')" class="px-3 py-1 rounded ${orderFilter === 'all' ? 'bg-teal-600 text-white' : 'bg-gray-200'}">全部</button>
  <button onclick="filterOrders('pending')" class="px-3 py-1 rounded ${orderFilter === 'pending' ? 'bg-teal-600 text-white' : 'bg-gray-200'}">待审核</button>
  <button onclick="filterOrders('in_production')" class="px-3 py-1 rounded ${orderFilter === 'in_production' ? 'bg-teal-600 text-white' : 'bg-gray-200'}">生产中</button>
  <button onclick="filterOrders('allocated')" class="px-3 py-1 rounded ${orderFilter === 'allocated' ? 'bg-teal-600 text-white' : 'bg-gray-200'}">待发货</button>
  <button onclick="filterOrders('completed')" class="px-3 py-1 rounded ${orderFilter === 'completed' ? 'bg-teal-600 text-white' : 'bg-gray-200'}">已完成</button>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: update order status display and filters"
```

---

### Task 12: 完整流程测试

- [ ] **Step 1: 测试流程A（有库存）**

1. 创建销售订单
2. 点击"审核"按钮
3. 验证系统自动配货
4. 验证订单状态变为"已配货"
5. 点击"发货"
6. 验证订单状态变为"已发货"

- [ ] **Step 2: 测试流程B（无库存）**

1. 创建销售订单（选择库存不足的产品）
2. 点击"审核"按钮
3. 验证提示"库存不足，需要安排生产"
4. 验证订单状态变为"生产中"
5. 点击"安排生产"
6. 验证创建计划订单
7. 点击"配置工序"
8. 添加几道工序，保存
9. 打开"生产看板"
10. 点击"派工"，填写执行人
11. 点击"确认完工"
12. 验证最后一道"入库"工序完成
13. 验证自动配货
14. 验证订单状态变为"已配货"

- [ ] **Step 3: 提交测试结果**

```bash
git add .
git commit -m "test: production flow integration testing completed"
```

---

## 实施检查清单

- [ ] Phase 1 完成
  - [ ] planOrders 和 processes 数据结构已添加
  - [ ] 计划订单API已实现
  - [ ] 工序API已实现

- [ ] Phase 2 完成
  - [ ] 审核订单自动配货API已实现
  - [ ] 前端审核按钮已添加
  - [ ] 安排生产功能已实现

- [ ] Phase 3 完成
  - [ ] 生产看板页面已实现
  - [ ] 派工弹窗已实现
  - [ ] 完工确认弹窗已实现
  - [ ] 工序配置页面已实现

- [ ] Phase 4 完成
  - [ ] 导航入口已添加
  - [ ] 订单状态显示已更新
  - [ ] 完整流程测试通过
