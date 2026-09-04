async function goToShippingPage() {
  try {
    salesSubTab = 'sales-order-shipping';
    saveSalesSubTab('sales-order-shipping');
    await navigateTo('sales');
  } catch (e) {
    console.error('Error navigating to shipping page:', e);
    // 如果导航失败，尝试刷新页面
    location.reload();
  }
}

// ==================== 配货功能 ====================
function closeModal() {
  // 关闭所有可能的弹窗
  const modalIds = ['modal', 'allocateModal', 'allocationModal', 'allocateConfirmModal', 'successModal'];
  modalIds.forEach(id => {
    const m = document.getElementById(id);
    if (m) {
      try {
        m.remove();
      } catch (e) {
        m.style.display = 'none';
      }
    }
  });
  // 关闭所有带fixed类的遮罩层
  const modals = document.querySelectorAll('.fixed.inset-0');
  modals.forEach(m => {
    try {
      m.remove();
    } catch (e) {
      m.style.display = 'none';
    }
  });
}

function showSuccessModalWithRedirect(message) {
  const modalHtml = `
    <div id="successModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl w-80 shadow-xl overflow-hidden animate-fade-in">
        <div class="bg-gradient-to-r from-green-500 to-green-600 px-6 py-4">
          <h3 class="text-lg font-semibold text-white text-center">操作成功</h3>
        </div>
        <div class="p-6">
          <div class="flex items-center justify-center py-4">
            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
          </div>
          <p class="text-slate-600 text-center text-sm leading-relaxed">${message}</p>
        </div>
        <div class="px-6 py-4 bg-slate-50 flex justify-center">
          <button onclick="handleSuccessRedirect()" class="px-8 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-md hover:shadow-lg">确定</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function handleSuccessRedirect() {
  const successModal = document.getElementById('successModal');
  if (successModal) {
    successModal.remove();
  }
  
  // 刷新销售订单列表，显示更新后的订单状态
  try {
    if (typeof renderSalesOrdersList === 'function') {
      renderSalesOrdersList();
    } else {
      // 如果找不到渲染函数，重新加载页面
      location.reload();
    }
  } catch (e) {
    console.error('Error refreshing page:', e);
    location.reload();
  }
}

function showAllocateModal(orderId) {
  const order = data.salesOrders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAlertModal('提示', '未找到订单数据');
    return;
  }
  
  const customer = data.customers.find(c => String(c.id) === String(order.customerId || order.customer_id));
  
  let itemsHtml = '';
  let totalAllocated = 0;
  let totalInStock = 0;
  let hasShortage = false;
  
  (order.items || []).forEach((item, idx) => {
    const product = data.products.find(p => String(p.id) === String(item.productId) || p.model === item.model);
    const inventoryRecord = (data.inventory || []).find(s => String(s.productId) === String(item.productId));
    const inStock = inventoryRecord ? (Number(inventoryRecord.quantity) || 0) : 0;
    const orderQty = item.quantity || 0;
    const shortage = Math.max(0, orderQty - inStock);
    
    totalAllocated += orderQty;
    totalInStock += inStock;
    if (shortage > 0) hasShortage = true;
    
    itemsHtml += `
      <tr class="hover:bg-slate-50 ${shortage > 0 ? 'bg-red-50' : ''}">
        <td class="px-3 py-2 text-center border-b border-slate-100">${idx + 1}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.model || product?.model || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.name || product?.type || product?.name || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.color || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.spec || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.tabletopColor || item.countertopColor || item.tabletop_color || product?.tabletopColor || product?.countertopColor || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100 font-medium">${orderQty}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100 ${inStock >= orderQty ? 'text-green-600' : 'text-red-600'} font-medium">${inStock}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">
          ${shortage > 0 ? `<span class="text-red-600 font-medium">缺${shortage}</span>` : '<span class="text-green-600">充足</span>'}
        </td>
        <td class="px-3 py-2 text-center border-b border-slate-100">
          <input type="checkbox" ${shortage === 0 ? 'checked' : ''} class="allocate-item w-4 h-4 rounded border-slate-300 text-teal-500" data-order-id="${orderId}" data-item-index="${idx}">
        </td>
      </tr>
    `;
  });
  
  const modalHtml = `
    <div id="modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-orange-500 to-orange-600">
          <h3 class="text-lg font-semibold text-white">配货确认</h3>
          <button onclick="closeModal()" class="text-white/80 hover:text-white text-xl font-bold">&times;</button>
        </div>
        
        <div class="flex-1 overflow-y-auto">
          <div class="px-6 py-5 bg-slate-50">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div class="bg-white rounded-lg p-3 shadow-sm">
                <div class="text-slate-500 text-xs mb-1">订单号</div>
                <div class="text-slate-800 font-medium">${order.orderNo || order.orderNumber || '-'}</div>
              </div>
              <div class="bg-white rounded-lg p-3 shadow-sm">
                <div class="text-slate-500 text-xs mb-1">客户名称</div>
                <div class="text-slate-800 font-medium">${customer?.name || '-'}</div>
              </div>
              <div class="bg-white rounded-lg p-3 shadow-sm">
                <div class="text-slate-500 text-xs mb-1">收货人</div>
                <div class="text-slate-800 font-medium">${order.contactName || order.contact || '-'}</div>
              </div>
              <div class="bg-white rounded-lg p-3 shadow-sm">
                <div class="text-slate-500 text-xs mb-1">联系电话</div>
                <div class="text-slate-800 font-medium">${order.contactPhone || order.phone || '-'}</div>
              </div>
            </div>
          </div>
          
          <div class="px-6 py-4">
            <div class="flex items-center justify-between mb-4">
              <h4 class="text-sm font-semibold text-slate-700 flex items-center">
                <span class="w-1.5 h-1.5 bg-orange-500 rounded-full mr-2"></span>
                产品库存信息
              </h4>
              <div class="text-xs text-slate-500">
                订单总数量: <span class="font-medium text-slate-800">${totalAllocated}</span> | 
                库存总数量: <span class="font-medium ${totalInStock >= totalAllocated ? 'text-green-600' : 'text-red-600'}">${totalInStock}</span>
              </div>
            </div>
            
            <div class="overflow-x-auto">
              <table class="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead class="bg-slate-100">
                  <tr>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">序号</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">产品型号</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">产品名称</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">颜色</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">规格</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">台面颜色</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">订单数量</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">库存数量</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">库存状态</th>
                    <th class="px-3 py-2 text-center text-xs font-semibold text-slate-600">选择</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </div>
            
            ${hasShortage ? `
              <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <div class="flex items-center text-red-700 text-sm">
                  <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                  </svg>
                  <span>部分产品库存不足，库存充足的产品将直接配货，库存不足的产品将自动创建生产工单</span>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
        
        <div class="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
          <button onclick="closeModal()" class="px-5 py-2 text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors">取消</button>
          <button onclick="confirmAllocate('${orderId}')" class="px-5 py-2 text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors">确认配货</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function confirmAllocate(orderId) {
  // 关闭配货确认弹窗 - 使用更全面的方式关闭所有可能的弹窗
  const modal = document.getElementById('modal');
  if (modal) {
    modal.style.display = 'none';
    modal.remove();
  }
  // 同时关闭其他可能的弹窗ID
  const otherModals = ['allocateModal', 'allocationModal', 'allocateConfirmModal', 'successModal'];
  otherModals.forEach(id => {
    const m = document.getElementById(id);
    if (m) {
      m.style.display = 'none';
      m.remove();
    }
  });
  // 关闭所有带fixed类的遮罩层
  document.querySelectorAll('.fixed.inset-0').forEach(el => {
    el.style.display = 'none';
    el.remove();
  });
  
  try {
    const response = await fetch(`/api/allocate-order/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('配货失败');
    }

    const result = await response.json();
    
    // 处理缺货产品，创建生产计划
    if (result.unallocatedItems && result.unallocatedItems.length > 0) {
      const order = data.salesOrders.find(o => String(o.id) === String(orderId));
      if (order) {
        createProductionPlanFromSalesOrder(order, result.unallocatedItems);
      }
    }
    
    // 添加配货跟踪记录
    let trackContent = '订单已配货';
    if (result.allocatedItems && result.allocatedItems.length > 0) {
      trackContent += `，已锁定库存 ${result.allocatedItems.length} 个产品`;
    }
    if (result.unallocatedItems && result.unallocatedItems.length > 0) {
      trackContent += `，${result.unallocatedItems.length} 个产品库存不足已自动创建生产工单`;
    }
    
    if (typeof addOrderTracking === 'function') {
      await addOrderTracking(orderId, '配货完成', trackContent);
    }
    
    // 重新加载数据
    if (typeof fetchData === 'function') {
      await fetchData();
    }

    let message = '配货成功！';
    if (result.allocatedItems && result.allocatedItems.length > 0) {
      message += `<br/>已锁定库存：${result.allocatedItems.length} 个产品`;
    }
    if (result.unallocatedItems && result.unallocatedItems.length > 0) {
      message += `<br/>未能锁定库存（已加入生产排产单）${result.unallocatedItems.length} 个产品`;
    }

    showSuccessModalWithRedirect(message);
  } catch (error) {
    console.error('配货失败:', error);
    showAlertModal('配货失败', error.message);
  }
}

function closeAllModals() {
  // 关闭配货确认弹窗
  const modal = document.getElementById('modal');
  if (modal) {
    try {
      modal.remove();
    } catch (e) {
      modal.style.display = 'none';
    }
  }
  
  // 关闭可能存在的其他弹窗
  const successModal = document.getElementById('successModal');
  if (successModal) {
    try {
      successModal.remove();
    } catch (e) {
      successModal.style.display = 'none';
    }
  }
  
  // 关闭所有带fixed inset-0类的遮罩层
  const overlays = document.querySelectorAll('.fixed.inset-0');
  overlays.forEach(o => {
    try {
      o.remove();
    } catch (e) {
      o.style.display = 'none';
    }
  });
}

function createProductionPlanFromSalesOrder(salesOrder, items) {
  const now = new Date();
  const planOrder = {
    id: Date.now(),
    orderNo: `PP${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(data.planOrders?.length + 1).padStart(3, '0')}`,
    customerId: salesOrder.customerId,
    customerName: (data.customers.find(c => String(c.id) === String(salesOrder.customerId)) || {}).name,
    orderDate: now.toISOString().split('T')[0],
    items: items.map(item => {
      const product = data.products.find(p => String(p.id) === String(item.productId) || p.model === item.model);
      const followUpNo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${Math.floor(1000 + Math.random() * 9000)}`;
      return {
        ...item,
        followUpNo,
        productCode: product?.code || '',
        model: item.model || product?.model || '',
        productName: item.name || product?.type || product?.name || '',
        productionMethod: '生产',
        followMethod: item.quantity > 1 ? '按批' : '按个',
        packageCount: product?.packageCount || item.packageCount || 0,
        unit: product?.unit || '个',
        completionStatus: 'pending'
      };
    }),
    createdAt: now.toISOString(),
    status: 'pending',
    type: 'production'
  };
  
  if (!data.planOrders) data.planOrders = [];
  data.planOrders.push(planOrder);
  saveDataToStorage();
}

// ==================== 发货通知单功能 ====================
function showDeliveryNote(orderId) {
  const order = data.salesOrders.find(o => String(o.id) === String(orderId));
  if (!order) {
    showAlertModal('提示', '未找到订单数据');
    return;
  }
  
  const customer = data.customers.find(c => String(c.id) === String(order.customerId || order.customer_id));
  
  let itemsHtml = '';
  let totalAmount = 0;
  
  (order.items || []).forEach((item, idx) => {
    const product = data.products.find(p => String(p.id) === String(item.productId) || p.model === item.model);
    const unitPrice = item.unitPrice || item.price || product?.unitPrice || product?.price || 0;
    const amount = (item.quantity || 0) * unitPrice;
    totalAmount += amount;
    
    itemsHtml += `
      <tr class="hover:bg-slate-50">
        <td class="px-3 py-2 text-center border-b border-slate-100">
          <input type="checkbox" checked class="w-4 h-4 rounded border-slate-300 text-teal-500 delivery-item" data-item-index="${idx}">
        </td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${idx + 1}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${order.orderNo || order.orderNumber || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.followUpNo || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.model || product?.model || '-'}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">${item.quantity || 0}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">
          <input type="number" class="w-16 px-2 py-1 border border-slate-300 rounded text-xs text-center delivery-qty" data-item-index="${idx}" value="${item.quantity || 0}">
        </td>
        <td class="px-4 py-3 text-center border-b border-slate-100 text-slate-600 max-w-[192px] whitespace-normal">
          ${item.color || item.productColor || product?.color || ''}${(item.color || item.productColor || product?.color) && (item.spec || item.productSpec || product?.spec) ? '、' : ''}${item.spec || item.productSpec || product?.spec || ''}${((item.color || item.productColor || product?.color) || (item.spec || item.productSpec || product?.spec)) && (item.tabletopColor || item.countertopColor || product?.tabletopColor || product?.countertopColor) ? '、' : ''}${item.tabletopColor || item.countertopColor || product?.tabletopColor || product?.countertopColor || ''}
        </td>
        <td class="px-3 py-2 text-center border-b border-slate-100">
          <input type="number" class="w-16 px-2 py-1 border border-slate-300 rounded text-xs text-center package-count" data-item-index="${idx}" value="${item.packageCount || product?.packageCount || 1}">
        </td>
        <td class="px-3 py-2 text-center border-b border-slate-100">成品仓库</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">-</td>
        <td class="px-4 py-3 text-center border-b border-slate-100 truncate" title="S${order.orderNo}${String(idx + 1).padStart(4, '0')}">S${order.orderNo}${String(idx + 1).padStart(4, '0')}</td>
        <td class="px-3 py-2 text-center border-b border-slate-100">已配货</td>
        <td class="px-3 py-2 border-b border-slate-100">
          <input type="text" class="w-full px-2 py-1 border border-slate-300 rounded text-xs delivery-remark" data-item-index="${idx}" placeholder="请输入备注">
        </td>
      </tr>
    `;
  });
  
  const modalHtml = `
    <div id="modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-[90vw] min-w-[1200px] max-h-[95vh] overflow-hidden flex flex-col">
        <div class="flex items-center justify-between px-8 py-4 border-b border-slate-200 bg-gradient-to-r from-teal-500 to-teal-600">
          <h3 class="text-xl font-semibold text-white">发货通知单</h3>
          <button onclick="closeModal()" class="text-white/80 hover:text-white text-2xl font-bold w-8 h-8 flex items-center justify-center">&times;</button>
        </div>
        
        <div class="flex-1 overflow-y-auto">
          <div class="px-8 py-4 border-b border-slate-100">
            <div class="grid grid-cols-3 gap-6 text-sm">
              <div>
                <span class="text-slate-500 text-xs">客户信息</span>
                <div class="text-slate-800 font-medium">客户名称：${customer?.name || '-'}</div>
              </div>
              <div>
                <span class="text-slate-500 text-xs">提货方式</span>
                <div class="text-slate-800 font-medium">
                  <select id="delivery-method" class="px-3 py-1.5 border border-slate-300 rounded text-sm">
                    <option value="delivery">送到物流</option>
                    <option value="pickup">自提</option>
                    <option value="express">快递</option>
                  </select>
                </div>
              </div>
              <div>
                <span class="text-slate-500 text-xs">结算方式</span>
                <div class="text-slate-800 font-medium flex items-center gap-2">
                  按单收款
                  <button class="px-4 py-1.5 bg-green-500 text-white text-sm rounded hover:bg-green-600">收款</button>
                </div>
              </div>
            </div>
          </div>
          
          <div class="px-8 py-4 border-b border-slate-100 bg-slate-50">
            <div class="grid grid-cols-3 gap-6 text-sm">
              <div>
                <span class="text-slate-500 text-xs">收货信息</span>
                <div class="text-slate-800 font-medium">*收货人：${order.contactName || order.contact || '-'}</div>
              </div>
              <div>
                <span class="text-slate-500 text-xs">联系电话</span>
                <div class="text-slate-800 font-medium">${order.contactPhone || order.phone || '-'}</div>
              </div>
              <div>
                <span class="text-slate-500 text-xs">收货地址</span>
                <input type="text" id="delivery-address" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" placeholder="请输入收货地址">
              </div>
            </div>
          </div>
          
          <div class="px-8 py-4 border-b border-slate-100">
            <div class="grid grid-cols-4 gap-6 text-sm">
              <div>
                <span class="text-slate-500 text-xs">物流信息</span>
                <select id="logistics-name" class="w-full px-4 py-2 border border-slate-300 rounded text-sm">
                  <option value="">请选择物流</option>
                  <option value="SF">顺丰</option>
                  <option value="JD">京东物流</option>
                  <option value="YTO">圆通</option>
                  <option value="ZTO">中通</option>
                  <option value="EMS">EMS</option>
                </select>
              </div>
              <div>
                <span class="text-slate-500 text-xs">电话</span>
                <input type="text" id="logistics-phone" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" placeholder="物流电话">
              </div>
              <div>
                <span class="text-slate-500 text-xs">物流地址</span>
                <input type="text" id="logistics-address" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" placeholder="物流地址">
              </div>
              <div>
                <span class="text-slate-500 text-xs">物流分区</span>
                <select id="logistics-zone" class="w-full px-4 py-2 border border-slate-300 rounded text-sm">
                  <option value="">请选择分区</option>
                  <option value="A">A区</option>
                  <option value="B">B区</option>
                  <option value="C">C区</option>
                </select>
              </div>
            </div>
          </div>
          
          <div class="px-8 py-4 border-b border-slate-100 bg-slate-50">
            <div class="grid grid-cols-6 gap-4 text-sm">
              <div class="text-center">
                <div class="text-slate-500 text-xs">订单金额</div>
                <div class="text-slate-800 font-medium text-base">${totalAmount.toFixed(2)}</div>
              </div>
              <div class="text-center">
                <div class="text-slate-500 text-xs">已收金额</div>
                <div class="text-slate-800 font-medium text-base">0.00</div>
              </div>
              <div class="text-center">
                <div class="text-slate-500 text-xs">优惠金额</div>
                <div class="text-slate-800 font-medium text-base">0.00</div>
              </div>
              <div class="text-center">
                <div class="text-slate-500 text-xs">未收金额</div>
                <div class="text-red-600 font-medium text-base">${totalAmount.toFixed(2)}</div>
              </div>
              <div class="text-center">
                <div class="text-slate-500 text-xs">已发货金额</div>
                <div class="text-slate-800 font-medium text-base">0.00</div>
              </div>
              <div class="text-center">
                <div class="text-slate-500 text-xs">待审核收款金额</div>
                <div class="text-slate-800 font-medium text-base">0.00</div>
              </div>
            </div>
          </div>
          
          <div class="px-8 py-4 border-b border-slate-100">
            <div class="grid grid-cols-5 gap-6 text-sm">
              <div>
                <span class="text-slate-500 text-xs">发货信息</span>
                <input type="date" id="delivery-date" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" value="${new Date().toISOString().split('T')[0]}">
              </div>
              <div>
                <span class="text-slate-500 text-xs">送货人</span>
                <input type="text" id="delivery-person" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" placeholder="送货人">
              </div>
              <div>
                <span class="text-slate-500 text-xs">送货费</span>
                <input type="number" id="delivery-fee" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" value="0">
              </div>
              <div>
                <span class="text-slate-500 text-xs">物流费</span>
                <input type="number" id="logistics-fee" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" value="0">
              </div>
              <div>
                <span class="text-slate-500 text-xs">发货人</span>
                <select id="shipper" class="w-full px-4 py-2 border border-slate-300 rounded text-sm">
                  <option value="">请选择</option>
                  ${data.users.filter(u => u.role && (u.role.includes('仓管') || u.role.includes('管理'))).map(u => `<option value="${u.name}">${u.name}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-6 text-sm mt-4">
              <div>
                <span class="text-slate-500 text-xs">发货说明</span>
                <input type="text" id="delivery-note" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" placeholder="发货说明">
              </div>
              <div>
                <span class="text-slate-500 text-xs">快递单号</span>
                <input type="text" id="tracking-number" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" placeholder="快递单号">
              </div>
            </div>
          </div>
          
          <div class="px-8 py-4 border-b border-slate-100 bg-slate-50">
            <div class="grid grid-cols-3 gap-6 text-sm">
              <div>
                <span class="text-slate-500 text-xs">业务员</span>
                <input type="text" id="salesman" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" placeholder="业务员">
              </div>
              <div>
                <span class="text-slate-500 text-xs">跟单员</span>
                <input type="text" id="follower" class="w-full px-4 py-2 border border-slate-300 rounded text-sm" value="${order.follower || '-'}">
              </div>
              <div></div>
            </div>
          </div>
          
          <div class="px-8 py-4">
            <div class="overflow-x-auto">
              <table class="w-full text-sm border border-slate-200 rounded-lg overflow-hidden min-w-[1100px]">
                <thead class="bg-slate-100">
                  <tr>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-12">选择</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-12">序号</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-32">订单号</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-24">跟单号</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-20">产品型号</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-16">数量</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-20">发货数量</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-48">订单要求</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-20">包装件数</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-20">仓库</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-16">仓位</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-24 truncate">库存编码</th>
                    <th class="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-20">生产状态</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-slate-600 w-32">行备注</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div class="flex justify-end gap-4 px-8 py-4 bg-slate-50 border-t border-slate-200">
          <button onclick="closeModal()" class="px-6 py-2.5 text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors text-sm">取消</button>
          <button onclick="showAlertModal('提示', '设置功能开发中')" class="px-6 py-2.5 text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors text-sm">设置</button>
          <button onclick="submitDeliveryNote('${orderId}')" class="px-6 py-2.5 text-white bg-teal-500 rounded-lg hover:bg-teal-600 transition-colors text-sm">提交</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function submitDeliveryNote(orderId) {
  const order = data.salesOrders.find(o => String(o.id) === String(orderId));
  if (!order) return;
  
  order.status = 'shipped';
  order.shippedDate = new Date().toISOString().split('T')[0];
  order.shipper = document.getElementById('shipper')?.value || '';
  order.trackingNumber = document.getElementById('tracking-number')?.value || '';
  order.deliveryMethod = document.getElementById('delivery-method')?.value || '';
  
  saveDataToStorage();
  closeModal();
  
  showSuccessModal('发货成功！');
  
  setTimeout(() => {
    renderShippingByOrder();
  }, 1500);
}