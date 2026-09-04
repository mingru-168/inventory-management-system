const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.disable('x-powered-by'); // 隐藏框架标识，降低指纹信息泄露

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// ===== 安全加固：请求体消毒（body 边界类型校验 + 原型污染防护） =====
// 全局拦截：只允许 JSON 对象 body；深度剔除原型污染/危险键，防止注入任意字段
const POLLUTION_KEYS = ['__proto__', 'prototype', 'constructor'];
function deepClean(value, depth) {
  if (depth > 6 || value == null) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(deepClean(value[i], depth + 1));
    return out;
  }
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (POLLUTION_KEYS.includes(k)) continue; // 剔除原型污染键
      out[k] = deepClean(value[k], depth + 1);
    }
    return out;
  }
  return undefined; // function/symbol 等一律丢弃
}
function sanitizeBody(req, res, next) {
  const head = String(req.headers['content-type'] || '');
  if (!/application\/json|json/i.test(head)) return next();
  let body = req.body;
  if (body == null) { req.body = {}; return next(); }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ success: false, message: '请求体必须是 JSON 对象' });
  }
  req.body = deepClean(body, 0) || {};
  next();
}
app.use(sanitizeBody);

// ===== 安全响应头：点击劫持 / MIME 嗅探 / 信息泄露防护 =====
// CSP 需兼容现有 CDN（tailwind/google fonts）与内联 onclick 处理器，故脚本/样式允许 unsafe-inline，但禁止 object 与跨站框架嵌入。
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com; " +
    "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com data:; " +
    "img-src 'self' data: blob: https: http:; " +
    "connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  next();
});

// ===== 安全加固：字段白名单助手（仅允许指定字段，并对基础类型做校验） =====
// pick(body, allowed)：返回仅含 allowed 中已有键的对象；allowed 值可为 true（任意）或类型数组
function pick(body, allowed) {
  const src = body || {};
  const out = {};
  for (const key of Object.keys(allowed)) {
    if (key in src && src[key] !== undefined) {
      const spec = allowed[key];
      const val = src[key];
      if (spec === true) { out[key] = val; continue; }
      if (Array.isArray(spec)) { // 允许的类型白名单
        if (spec.includes(typeof val)) out[key] = val;
        continue;
      }
      if (typeof val === spec) out[key] = val;
    }
  }
  return out;
}

const initialData = {
  products: [
    { id: 'p1', name: '茶几', model: '6351', type: '茶几', color: '灰色', spec: '130*70cm,120*60cm', tabletopColor: '雪山白', unit: '套', packageCount: 1, price: 800, cost: 400, stock: 10, warehouse: '主仓库' },
    { id: 'p2', name: '电视柜', model: '6351', type: '电视柜', color: '灰色', spec: '180*40cm', tabletopColor: '雪山白', unit: '套', packageCount: 1, price: 850, cost: 450, stock: 5, warehouse: '主仓库' },
    { id: 'p3', name: '电子产品 A', model: 'PROD-001', type: '电子产品', color: '黑色', spec: '标准款', tabletopColor: '', unit: '个', packageCount: 10, price: 2999, cost: 1500, stock: 150, warehouse: '主仓库' },
    { id: 'p4', name: '电子产品 B', model: 'PROD-002', type: '电子产品', color: '白色', spec: '豪华款', tabletopColor: '', unit: '个', packageCount: 10, price: 4999, cost: 2500, stock: 80, warehouse: '主仓库' },
    { id: 'p5', name: '配件 C', model: 'ACC-001', type: '配件', color: '银色', spec: '通用型', tabletopColor: '', unit: '套', packageCount: 50, price: 299, cost: 120, stock: 500, warehouse: '配件仓' },
    { id: 'p6', name: '茶几', model: '351', type: '茶几', color: '黑色', spec: '80cm', tabletopColor: '纳秋绿', unit: '套', packageCount: 1, price: 950, cost: 500, stock: 8, warehouse: '主仓库' }
  ],
  productSpecPrices: [],
  inventory: [
    { id: 'i1', productId: 'p1', quantity: 150, minStock: 50, warehouse: '主仓库' },
    { id: 'i2', productId: 'p2', quantity: 80, minStock: 30, warehouse: '主仓库' },
    { id: 'i3', productId: 'p3', quantity: 500, minStock: 200, warehouse: '配件仓' }
  ],
  warehouses: [
    { id: 'w1', code: 'WH001', name: '主仓库', isDefault: true, isActive: true, type: '主仓库', manager: '张三' },
    { id: 'w2', code: 'WH002', name: '配件仓', isDefault: false, isActive: true, type: '分仓库', manager: '李四' }
  ],
  customers: [
    { id: 'c1', name: '科技有限公司', contact: '张经理', phone: '13800138001', email: 'zhang@tech.com', address: '北京市朝阳区' },
    { id: 'c2', name: '贸易商行', contact: '李总', phone: '13800138002', email: 'li@trade.com', address: '上海市浦东新区' }
  ],
  suppliers: [
    { id: 's1', name: '原材料供应商', contact: '赵经理', phone: '13900139001', email: 'zhao@supplier.com', address: '深圳市南山区' }
  ],
  salesOrders: [
    { id: 'so1', orderNo: 'SO20240115001', customerId: 'c1', orderDate: '2024-01-15', items: [{ productId: 'p1', quantity: 10, price: 2999 }], totalAmount: 29990, status: 'completed' }
  ],
  planOrders: [],
  processes: [],
  stockInRecords: [],
  productionOrders: [],
  financeRecords: [
    { id: 'f1', type: 'income', category: '销售收入', amount: 29990, date: '2024-01-15', description: '销售订单 SO20240115001' }
  ],
  users: [
    { id: 1, username: 'admin', name: '管理员', role: '系统管理员', password: 'admin', status: '启用', createdAt: '2024-01-01' }
  ],
  roles: [
    { id: 1, name: '系统管理员', description: '拥有系统所有权限', type: 'admin', userCount: 1, createdAt: '2024-01-01', permissions: [] },
    { id: 2, name: '管理员', description: '拥有部分管理权限', type: 'normal', userCount: 0, createdAt: '2024-01-02', permissions: [] },
    { id: 3, name: '操作员', description: '拥有基础操作权限', type: 'normal', userCount: 0, createdAt: '2024-01-03', permissions: [] }
  ],
  allocationRecords: [],
  orderTrackingRecords: [],
  inventoryLocks: [],
  auditLogs: [],
  exchangeRecords: []
};

// ===== 数据完整性检查：确保所有核心集合存在，防止旧数据缺字段导致崩溃 =====
function ensureDataIntegrity(obj) {
  const collections = [
    'products', 'inventory', 'warehouses', 'customers', 'suppliers', 'salesOrders',
    'purchaseOrders', 'planOrders', 'processes', 'productionOrders', 'financeRecords',
    'stockInRecords', 'productSpecPrices', 'users', 'roles', 'allocationRecords',
    'orderTrackingRecords', 'inventoryLocks', 'auditLogs', 'exchangeRecords', 'purchaseReturns',
    'notifications'
  ];
  collections.forEach(k => {
    if (!Array.isArray(obj[k])) obj[k] = [];
  });
  return obj;
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(content);
      ensureDataIntegrity(loaded);
      return loaded;
    }
  } catch (error) {
    // 数据文件损坏时尝试从备份恢复，避免静默丢数据
    console.error('Failed to load data file:', error);
    try {
      const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).sort();
      if (backups.length > 0) {
        const latest = backups[backups.length - 1];
        const content = fs.readFileSync(path.join(BACKUP_DIR, latest), 'utf8');
        const loaded = JSON.parse(content);
        ensureDataIntegrity(loaded);
        console.error('数据文件损坏，已从备份恢复:', latest);
        return loaded;
      }
    } catch (backupError) {
      console.error('Failed to recover from backup:', backupError);
    }
  }
  const result = JSON.parse(JSON.stringify(initialData));
  ensureDataIntegrity(result);
  return result;
}

// ===== 原子写入：先写临时文件再重命名，避免写一半崩溃导致文件损坏 =====
function atomicWriteFile(filePath, content) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ===== 串行化保存队列：多用户并发写不互相覆盖 =====
let saveQueue = Promise.resolve();
function saveData() {
  const snapshot = JSON.stringify(data, null, 2);
  saveQueue = saveQueue.then(() => {
    try {
      atomicWriteFile(DATA_FILE, snapshot);
    } catch (error) {
      console.error('Failed to save data file:', error);
    }
  }).catch(err => console.error('Save queue error:', err));
  return saveQueue;
}

// ===== 自动备份：启动/每日备份，保留最近 N 份 =====
const BACKUP_DIR = path.join(__dirname, 'backups');
const MAX_BACKUPS = 20;
function createBackup() {
  const result = { ok: false, file: '', error: '' };
  try {
    if (!fs.existsSync(DATA_FILE)) { result.error = '数据文件不存在'; return result; }
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `data-${stamp}.json`;
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, file));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('data-')).sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
    result.ok = true;
    result.file = file;
  } catch (error) {
    result.error = error.message || String(error);
    console.error('Failed to create backup:', error);
  }
  return result;
}
function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('data-') && f.endsWith('.json'))
      .sort()
      .map(f => {
        try {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { file: f, size: st.size, modifiedAt: st.mtime.toISOString() };
        } catch (e) { return { file: f, size: 0, modifiedAt: '' }; }
      })
      .reverse();
  } catch (e) {
    return [];
  }
}

let data = loadData();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ===== 订单号防重复生成：按当天已有最大序号递增，避免并发重复 =====
function generateOrderNo(prefix, collection) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let maxSeq = 0;
  (collection || []).forEach(o => {
    const no = String(o.orderNo || '');
    if (no.startsWith(prefix + today)) {
      const seq = parseInt(no.slice(prefix.length + 8), 10) || 0;
      if (seq > maxSeq) maxSeq = seq;
    }
  });
  return prefix + today + String(maxSeq + 1).padStart(3, '0');
}

// ===== 密码安全：scrypt 哈希（零依赖） =====
const SCRYPT_PREFIX = 'scrypt$';
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${SCRYPT_PREFIX}${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored) return false;
  if (String(stored).startsWith(SCRYPT_PREFIX)) {
    try {
      const parts = String(stored).split('$'); // ['scrypt', salt, hash]
      const salt = parts[1];
      const expected = parts[2];
      const actual = crypto.scryptSync(String(password), salt, 32).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
    } catch (e) {
      return false;
    }
  }
  // 兼容旧版明文密码（首次登录成功后自动迁移为哈希）
  return stored === String(password);
}
function isHashedPassword(stored) {
  return typeof stored === 'string' && stored.startsWith(SCRYPT_PREFIX);
}

// ===== 服务端会话管理：登录生成真实 token，登出失效；会话持久化到文件，服务重启不掉线 =====
const SESSION_FILE = path.join(__dirname, 'sessions.json');
const sessions = new Map(); // token -> { username, createdAt, expiresAt, lastActive }
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 单次有效期 12 小时
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 滑动窗口上限 7 天

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const obj = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    for (const k of Object.keys(obj || {})) {
      const s = obj[k];
      if (s && s.username && typeof s.expiresAt === 'number' && now < s.expiresAt) {
        sessions.set(k, s);
      }
    }
  } catch (e) { /* 无会话文件或损坏时忽略 */ }
}
function saveSessions() {
  try {
    const obj = {};
    for (const [k, v] of sessions) obj[k] = v;
    fs.writeFileSync(SESSION_FILE + '.tmp', JSON.stringify(obj), 'utf8');
    fs.renameSync(SESSION_FILE + '.tmp', SESSION_FILE);
  } catch (e) { /* 忽略写入失败（不影响主流程） */ }
}
function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  sessions.set(token, { username, createdAt: now, expiresAt: now + SESSION_TTL_MS, lastActive: now });
  saveSessions();
  return token;
}
function getSessionUser(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now >= s.expiresAt) {
    sessions.delete(token);
    saveSessions();
    return null;
  }
  // 滑动续期：活跃会话顺延有效期，但不超过 7 天上限
  if (now - s.createdAt < SESSION_MAX_MS) {
    s.expiresAt = now + SESSION_TTL_MS;
    s.lastActive = now;
  }
  return s.username;
}
function destroySession(token) {
  if (token && sessions.delete(token)) saveSessions();
}

// 周期性落盘一次，让滑动后的有效期在重启后仍生效（避免高频写盘）
setInterval(() => { if (sessions.size) { try { saveSessions(); } catch (e) {} } }, 5 * 60 * 1000).unref();
loadSessions();

// ===== 登录防爆破：连续失败锁定 =====
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
function isLoginLocked(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return false;
  if (rec.lockedUntil && Date.now() > rec.lockedUntil) {
    loginAttempts.delete(key);
    return false;
  }
  return rec.count >= MAX_LOGIN_ATTEMPTS;
}
function recordLoginFailure(key) {
  const rec = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_LOGIN_ATTEMPTS) rec.lockedUntil = Date.now() + LOCKOUT_MS;
  loginAttempts.set(key, rec);
}
function resetLoginAttempts(key) {
  loginAttempts.delete(key);
}

// ===== 审计日志：记录关键操作 =====
const AUDIT_LOG_MAX = 2000;
function logAudit(action, detail, operator) {
  try {
    if (!data.auditLogs) data.auditLogs = [];
    data.auditLogs.push({
      id: generateId(),
      action,
      detail: detail || '',
      operator: operator || '系统',
      createdAt: new Date().toISOString()
    });
    if (data.auditLogs.length > AUDIT_LOG_MAX) {
      data.auditLogs = data.auditLogs.slice(-AUDIT_LOG_MAX);
    }
    saveData();
  } catch (e) {
    console.error('审计日志写入失败:', e);
  }
}

// ===== 认证中间件：有效 token 时填充 req.user，不阻断现有无 token 请求（保持兼容） =====
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'] || req.headers['x-access-token'] || '';
  if (token && token !== 'null' && token !== 'undefined') {
    const username = getSessionUser(token);
    if (username) {
      const user = data.users.find(u => u.username === username);
      req.user = user || { username };
      req.token = token;
    }
  }
  next();
}
app.use(authMiddleware);

// ============== 安全加固：所有 /api 接口默认需登录（反转白名单） ==============
// 仅登录、登出、登录态校验、健康检查始终放行；其余读取/写接口一律要求有效会话
const AUTH_FREE_PATHS = [/^\/api\/login$/i, /^\/api\/logout$/i, /^\/api\/auth\/check$/i, /^\/api\/health$/i];
function requireAuth(req, res, next) {
  const path = req.path || (req.url || '').split('?')[0];
  if (!path.startsWith('/api/')) return next(); // 静态资源/登录页不拦截
  if (AUTH_FREE_PATHS.some(r => r.test(path))) return next();
  if (!req.user) {
    return res.status(401).json({ success: false, message: '未登录或会话已过期，请重新登录后再操作' });
  }
  next();
}
// 仅管理员可执行（用于高危接口，如 /api/reset）
function requireAdmin(req, res, next) {
  const u = req.user;
  const role = (u && (u.role || (u.roles && u.roles[0]) || '')) || '';
  const isAdmin = u && (u.username === 'admin' || role === '系统管理员' || role === 'admin');
  if (!isAdmin) return res.status(403).json({ success: false, message: '仅管理员可执行该操作' });
  next();
}

// 细粒度权限校验：与前端配置的「模块-功能-动作」权限对应。
// 设计原则：管理员/超级管理员拥有全部权限；
const P = require('../public/perm-core.js');

// 角色的权限数组为空或未能匹配角色时视为拥有全部权限（兜底，保护现有工作流）；
// 仅当角色在「角色管理」中配置了具体权限时才按权限收紧。
function requirePerm(module, item, action) {
  return function (req, res, next) {
    const u = req.user;
    if (!u) return res.status(401).json({ success: false, message: '未登录' });
    const roleName = String(u.role || '');
    const perms = P.isFullAccess(u.username, roleName)
      ? null
      : P.rolePermsList(data.roles, roleName);
    if (perms === null) return next();
    if (P.hasPerm(perms, module, item, action)) return next();
    return res.status(403).json({ success: false, message: `没有「${module}·${item}·${action}」的操作权限，请联系管理员分配` });
  };
}
app.use(requireAuth);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/data', (req, res) => {
  // 脱敏：不向前端暴露密码等敏感字段
  const copy = JSON.parse(JSON.stringify(data));
  if (Array.isArray(copy.users)) {
    copy.users = copy.users.map(u => {
      const { password, ...safeUser } = u;
      return safeUser;
    });
  }
  res.json(copy);
});

app.get('/api/products', (req, res) => {
  res.json(data.products);
});

app.post('/api/products', requirePerm('资料管理', '产品资料', '添加'), (req, res) => {
  const allowed = { name: 'string', model: 'string', type: 'string', color: 'string', spec: 'string', tabletopColor: 'string', unit: 'string', packageCount: true, price: true, cost: true, stock: true, warehouse: 'string', minStock: true, sku: 'string', description: 'string', image: 'string', category: 'string', brand: 'string', remark: 'string' };
  const product = {
    id: req.body.id || generateId(),
    ...pick(req.body, allowed)
  };
  console.log('创建新产品:', product);
  data.products.push(product);
  saveData();
  res.json(product);
});

app.put('/api/products/:id', requirePerm('资料管理', '产品资料', '编辑'), (req, res) => {
  console.log('收到更新请求，产品ID:', req.params.id);
  console.log('当前产品列表:', data.products.map(p => ({ id: p.id, model: p.model })));
  const index = data.products.findIndex(p => String(p.id) === String(req.params.id));
  console.log('找到的索引:', index);
  if (index !== -1) {
    const allowed = { name: 'string', model: 'string', type: 'string', color: 'string', spec: 'string', tabletopColor: 'string', unit: 'string', packageCount: true, price: true, cost: true, stock: true, warehouse: 'string', minStock: true, sku: 'string', description: 'string', image: 'string', category: 'string', brand: 'string', remark: 'string' };
    data.products[index] = {
      ...data.products[index],
      ...pick(req.body, allowed)
    };
    saveData();
    console.log('更新成功:', data.products[index]);
    res.json(data.products[index]);
  } else {
    console.log('未找到产品');
    res.status(404).json({ error: 'Product not found' });
  }
});

app.delete('/api/products/:id', requirePerm('资料管理', '产品资料', '删除'), (req, res) => {
  console.log('收到删除请求，产品ID:', req.params.id);
  console.log('当前产品列表:', data.products.map(p => p.id));
  const index = data.products.findIndex(item => item.id == req.params.id);
  console.log('找到的索引:', index);
  
  if (index !== -1) {
    const deleted = data.products.splice(index, 1)[0];
    saveData();
    console.log('成功删除产品:', deleted);
    res.json(deleted);
  } else {
    console.log('未找到产品，返回404');
    res.status(404).json({ error: 'Product not found' });
  }
});

app.get('/api/inventory', (req, res) => {
  res.json(data.inventory);
});

app.put('/api/inventory/:id', requirePerm('库存管理', '库存调整', '调整'), (req, res) => {
  const invId = req.params.id;
  const index = data.inventory.findIndex(i => String(i.id) === String(invId));
  if (index !== -1) {
    data.inventory[index] = { ...data.inventory[index], ...pick(req.body, { productId: 'string', productName: 'string', quantity: true, minStock: true, warehouse: 'string', location: 'string', cost: true, remark: 'string' }), id: data.inventory[index].id };
    saveData();
    res.json(data.inventory[index]);
  } else {
    res.status(404).json({ error: 'Inventory not found' });
  }
});

app.get('/api/customers', (req, res) => {
  res.json(data.customers);
});

app.post('/api/customers', (req, res) => {
  const allowed = { name: 'string', contact: 'string', phone: 'string', email: 'string', address: 'string', type: 'string', level: 'string', category: 'string', region: 'string', taxId: 'string', creditLevel: 'string', remark: 'string' };
  const customer = {
    id: generateId(),
    ...pick(req.body, allowed),
    createdAt: new Date().toISOString().split('T')[0]
  };
  data.customers.push(customer);
  saveData();
  res.json({ success: true, message: '客户添加成功', data: customer });
});

app.put('/api/customers/:id', (req, res) => {
  const customerId = req.params.id;
  const index = data.customers.findIndex(c => String(c.id) === String(customerId));
  if (index !== -1) {
    data.customers[index] = { ...data.customers[index], ...pick(req.body, { name: 'string', contact: 'string', phone: 'string', email: 'string', address: 'string', type: 'string', level: 'string', category: 'string', region: 'string', taxId: 'string', creditLevel: 'string', remark: 'string' }) };
    saveData();
    res.json({ success: true, message: '客户更新成功', data: data.customers[index] });
  } else {
    res.status(404).json({ success: false, message: '客户不存在' });
  }
});

app.delete('/api/customers/:id', (req, res) => {
  const customerId = req.params.id;
  const index = data.customers.findIndex(c => String(c.id) === String(customerId));
  if (index !== -1) {
    const deleted = data.customers.splice(index, 1)[0];
    saveData();
    res.json({ success: true, message: '客户删除成功', data: deleted });
  } else {
    res.status(404).json({ success: false, message: '客户不存在' });
  }
});

app.get('/api/suppliers', (req, res) => {
  res.json(data.suppliers);
});

// 创建供应商
app.post('/api/suppliers', (req, res) => {
  if (!data.suppliers) data.suppliers = [];
  
  const maxId = data.suppliers.length > 0 ? Math.max(...data.suppliers.map(s => Number(s.id) || 0)) : 0;
  const supplier = {
    id: maxId + 1,
    type: '生产商',
    ...pick(req.body, { name: 'string', type: 'string', phone: 'string', contact: 'string', email: 'string', address: 'string', remark: 'string' }),
    createdAt: new Date().toISOString().split('T')[0]
  };
  data.suppliers.push(supplier);
  saveData();
  res.json(supplier);
});

// 更新供应商
app.put('/api/suppliers/:id', (req, res) => {
  const supplierId = req.params.id;
  const index = data.suppliers.findIndex(s => String(s.id) === String(supplierId));
  if (index !== -1) {
    data.suppliers[index] = {
      ...data.suppliers[index],
      ...pick(req.body, { name: 'string', type: 'string', phone: 'string', contact: 'string', email: 'string', address: 'string', remark: 'string' }),
      id: data.suppliers[index].id
    };
    saveData();
    res.json(data.suppliers[index]);
  } else {
    res.status(404).json({ error: 'Supplier not found' });
  }
});

// 删除供应商
app.delete('/api/suppliers/:id', (req, res) => {
  const supplierId = req.params.id;
  const index = data.suppliers.findIndex(s => String(s.id) === String(supplierId));
  if (index !== -1) {
    const deleted = data.suppliers.splice(index, 1)[0];
    saveData();
    res.json({ success: true, message: '删除成功', data: deleted });
  } else {
    res.status(404).json({ error: 'Supplier not found' });
  }
});

app.get('/api/sales-orders', (req, res) => {
  res.json(data.salesOrders);
});

app.get('/api/sales-orders/:id', (req, res) => {
  const id = req.params.id;
  const order = data.salesOrders.find(o => String(o.id) === String(id) || o.orderNo === id);
  if (order) {
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

app.get('/api/purchase-orders', (req, res) => {
  res.json(data.purchaseOrders);
});

app.get('/api/production-orders', (req, res) => {
  res.json(data.productionOrders);
});

// 作废派工单
app.post('/api/scheduling-orders/cancel', (req, res) => {
  const { orderNo } = req.body;
  const orderIndex = data.productionOrders.findIndex(o => o.orderNo === orderNo);
  if (orderIndex !== -1) {
    data.productionOrders[orderIndex].status = 'cancelled';
    data.productionOrders[orderIndex].updatedAt = new Date().toISOString();
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Production order not found' });
  }
});

// 删除派工单（按订单号）
app.delete('/api/scheduling-orders/:orderNo', (req, res) => {
  const { orderNo } = req.params;
  const orderIndex = data.productionOrders.findIndex(o => o.orderNo === orderNo);
  if (orderIndex !== -1) {
    data.productionOrders.splice(orderIndex, 1);
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Production order not found' });
  }
});

// 修改派工单某一工序项（改单/改数）
// 仅允许白名单字段，避免原型污染与越权字段注入；quantity 必须为正数。
const SCHEDULING_ITEM_FIELDS = ['model', 'productName', 'name', 'color', 'spec', 'size', 'tableColor', 'counterColor', 'followWay', 'receiver', 'followNo', 'quantity'];
app.put('/api/scheduling-orders/:orderNo/items/:itemIndex', function (req, res) {
  const orderNo = String(req.params.orderNo || '');
  const itemIndex = Number(req.params.itemIndex);
  const order = data.productionOrders.find(o => String(o.orderNo) === orderNo);
  if (!order) return res.status(404).json({ success: false, message: '未找到该派工单' });
  if (!Array.isArray(order.items)) return res.status(400).json({ success: false, message: '派工单无工序项' });
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
    return res.status(400).json({ success: false, message: '工序序号无效' });
  }
  const item = order.items[itemIndex];
  const changes = {};
  SCHEDULING_ITEM_FIELDS.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      let val = req.body[key];
      if (key === 'quantity') {
        const n = Number(val);
        if (!(n > 0)) return; // 非法数量：忽略，不落库
        val = n;
      } else if (typeof val === 'number') {
        val = String(val);
      }
      changes[key] = val;
    }
  });
  if (Object.keys(changes).length === 0) {
    return res.status(400).json({ success: false, message: '没有可更新的有效字段' });
  }
  Object.assign(item, changes);
  order.updatedAt = new Date().toISOString();
  saveData();
  res.json({ success: true, order });
});

// ===== 入通用库：生产完成后成品进入通用库存 =====
// 与产品手动入库保持一致：写 stockInRecords 并联动 inventory 数量与 products.stock。
app.post('/api/common-stock-in', requirePerm('生产管理', '入通用库', '入库'), (req, res) => {
  const qty = Number(req.body.quantity);
  if (!(qty > 0)) return res.status(400).json({ success: false, message: '入库数量必须为正数' });
  const productId = String(req.body.productId || '');
  if (!productId) return res.status(400).json({ success: false, message: '请选择产品' });
  if (!data.stockInRecords) data.stockInRecords = [];
  const prod = data.products.find(p => String(p.id) === productId);
  const record = {
    id: req.body.id || generateId(),
    productId,
    productName: String(req.body.productName || prod?.type || prod?.name || ''),
    productModel: String(req.body.productModel || prod?.model || prod?.sku || ''),
    quantity: qty,
    warehouse: String(req.body.warehouse || '主仓库'),
    location: String(req.body.location || ''),
    color: String(req.body.color || ''),
    spec: String(req.body.spec || ''),
    tabletopColor: String(req.body.tabletopColor || ''),
    batchNo: String(req.body.batchNo || ''),
    unit: String(req.body.unit || ''),
    remark: String(req.body.remark || '通用库存入库'),
    type: '入通用库',
    operator: req.user ? (req.user.username || '') : '',
    createdAt: req.body.createdAt || new Date().toISOString()
  };
  data.stockInRecords.push(record);
  // 联动 inventory
  if (!data.inventory) data.inventory = [];
  const inv = data.inventory.find(i => String(i.productId) === productId);
  if (inv) {
    inv.quantity = (Number(inv.quantity) || 0) + qty;
    inv.warehouse = record.warehouse || inv.warehouse;
    inv.location = record.location || inv.location;
    inv.color = record.color || inv.color;
    inv.spec = record.spec || inv.spec;
    inv.tabletopColor = record.tabletopColor || inv.tabletopColor;
    inv.updatedAt = new Date().toISOString();
  } else {
    data.inventory.push({
      id: 'inv_' + Date.now(),
      productId,
      productModel: record.productModel,
      productName: record.productName,
      quantity: qty,
      minStock: 0,
      warehouse: record.warehouse,
      location: record.location,
      color: record.color,
      spec: record.spec,
      tabletopColor: record.tabletopColor,
      createdAt: new Date().toISOString()
    });
  }
  // 联动 products.stock
  if (prod) {
    prod.stock = (Number(prod.stock) || 0) + qty;
    prod.updatedAt = new Date().toISOString();
  }
  saveData();
  const freshRecords = (data.inventory || []).filter(i => String(i.productId) === productId);
  res.json({ success: true, stockInRecord: record, inventory: freshRecords });
});

// ===== 调换货：记录客户调换货申请 =====
app.get('/api/exchange-orders', (req, res) => {
  res.json(data.exchangeRecords || []);
});

app.post('/api/exchange-orders', requirePerm('生产管理', '调换货', '调换'), (req, res) => {
  if (!data.exchangeRecords) data.exchangeRecords = [];
  const qty = Number(req.body.quantity);
  if (!(qty > 0)) return res.status(400).json({ success: false, message: '调换数量必须为正数' });
  const record = {
    id: generateId(),
    exchangeNo: String(req.body.exchangeNo || ('EX' + Date.now())),
    orderNo: String(req.body.orderNo || ''),
    productName: String(req.body.productName || ''),
    productModel: String(req.body.productModel || ''),
    color: String(req.body.color || ''),
    spec: String(req.body.spec || ''),
    quantity: qty,
    reason: String(req.body.reason || ''),
    type: String(req.body.type || '换货'),
    status: 'pending',
    remark: String(req.body.remark || ''),
    operator: req.user ? (req.user.username || '') : '',
    createdAt: new Date().toISOString()
  };
  data.exchangeRecords.push(record);
  saveData();
  res.json({ success: true, record });
});

app.put('/api/exchange-orders/:id', requirePerm('生产管理', '调换货', '调换'), (req, res) => {
  if (!data.exchangeRecords) data.exchangeRecords = [];
  const idx = data.exchangeRecords.findIndex(r => String(r.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '未找到调换货单' });
  const rec = data.exchangeRecords[idx];
  const cur = rec.status || 'pending';

  // 允许的状态流转：pending→approved/rejected → done
  const next = String(req.body.status || '');
  const VALID_TRANSITIONS = {
    pending: ['approved', 'rejected'],
    approved: ['done', 'rejected', 'pending'],
    rejected: ['pending'],
    done: ['pending']
  };
  if (next && !(VALID_TRANSITIONS[cur] || []).includes(next)) {
    return res.status(400).json({ success: false, message: `状态不能从「${cur}」变更为「${next}」` });
  }

  // 更新备注字段（允许编辑）
  if (Object.prototype.hasOwnProperty.call(req.body, 'remark')) {
    rec.remark = String(req.body.remark);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'reason')) {
    rec.reason = String(req.body.reason);
  }

  // 记录审批/处理信息
  if (next) {
    rec.status = next;
    if (next === 'approved') {
      rec.approvedAt = new Date().toISOString();
      rec.approvedBy = req.user ? (req.user.username || req.user.name || '') : '';
      rec.approvalRemark = String(req.body.approvalRemark || req.body.remark || '');
    } else if (next === 'rejected') {
      rec.rejectedAt = new Date().toISOString();
      rec.rejectedBy = req.user ? (req.user.username || req.user.name || '') : '';
      rec.rejectRemark = String(req.body.approvalRemark || req.body.rejectRemark || '');
    } else if (next === 'done') {
      rec.completedAt = new Date().toISOString();
      rec.completedBy = req.user ? (req.user.username || req.user.name || '') : '';
    }
  }

  // 审批历史记录
  if (!rec.audit) rec.audit = [];
  const operator = req.user ? (req.user.username || req.user.name || '') : '';
  const time = new Date().toISOString();
  if (next && next !== cur) {
    rec.audit.push({ from: cur, to: next, operator, time, remark: String(req.body.auditRemark || '') });
  } else if (Object.prototype.hasOwnProperty.call(req.body, 'remark')) {
    rec.audit.push({ from: cur, to: cur, operator, time, remark: '更新备注：' + String(req.body.remark) });
  }

  rec.updatedAt = time;
  saveData();
  res.json({ success: true, record: rec });
});

app.get('/api/finance-records', (req, res) => {
  res.json(data.financeRecords);
});

app.get('/api/dashboard', (req, res) => {
  const totalIncome = data.financeRecords.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const totalExpense = data.financeRecords.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const pendingOrders = data.salesOrders.filter(o => o.status === 'pending').length;

  // ===== 销售趋势：按日汇总收入（最近 14 天，含空日补零） =====
  const trendMap = {};
  data.financeRecords.forEach(r => {
    if (r.type !== 'income') return;
    const day = String(r.date || '').slice(0, 10);
    if (!day) return;
    trendMap[day] = (trendMap[day] || 0) + (r.amount || 0);
  });
  const salesTrend = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    salesTrend.push({ date: key, amount: trendMap[key] || 0 });
  }

  // ===== 订单状态分布 =====
  const statusMap = {};
  data.salesOrders.forEach(o => {
    const st = o.status || 'unknown';
    statusMap[st] = (statusMap[st] || 0) + 1;
  });
  const orderStatusDist = Object.keys(statusMap).map(st => ({ status: st, count: statusMap[st] }));

  // ===== 库存预警统计 =====
  let lowStock = 0;       // 低于安全库存
  let outOfStock = 0;     // 已缺货（stock<=0 但有安全库存）
  let stockAlertCount = 0;
  data.inventory.forEach(i => {
    const min = Number(i.minStock) || 0;
    const qty = Number(i.quantity) || 0;
    if (min > 0 && qty < min) { lowStock++; stockAlertCount++; }
    else if (min > 0 && qty <= 0) { outOfStock++; stockAlertCount++; }
  });

  // ===== 品类占比：按产品 type 汇总库存数量 =====
  const typeMap = {};
  data.inventory.forEach(i => {
    const p = data.products.find(pp => String(pp.id) === String(i.productId));
    const type = (p && (p.type || p.name)) || (i.productName) || '未分类';
    typeMap[type] = (typeMap[type] || 0) + (Number(i.quantity) || 0);
  });
  const categoryDist = Object.keys(typeMap).map(t => ({ category: t, value: typeMap[t] })).sort((a, b) => b.value - a.value);

  res.json({
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
    productCount: data.products.length,
    pendingOrders,
    recentSalesOrders: data.salesOrders.slice(0, 3),
    salesTrend,
    orderStatusDist,
    lowStock,
    outOfStock,
    stockAlertCount,
    categoryDist
  });
});

// ===== 数据导出（CSV，带 UTF-8 BOM 兼容 Excel） =====
// 仅允许导出白名单集合，防止路径/任意键遍历；对 users 做脱敏（去除 password）
const EXPORTABLE_COLLECTIONS = ['products', 'inventory', 'warehouses', 'customers', 'suppliers', 'salesOrders', 'purchaseOrders', 'planOrders', 'financeRecords', 'stockInRecords', 'productSpecPrices', 'productionOrders', 'allocationRecords', 'orderTrackingRecords', 'users', 'roles'];
function toCsvCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    try { val = JSON.stringify(val); } catch (e) { val = String(val); }
  }
  const s = String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
app.get('/api/export/:collection', requireAuth, (req, res) => {
  const name = req.params.collection;
  if (!EXPORTABLE_COLLECTIONS.includes(name)) {
    return res.status(400).json({ success: false, message: '不支持导出该数据' });
  }
  let rows = (data[name] || []).slice();
  if (name === 'users') rows = rows.map(u => { const { password, ...safe } = u; return safe; });
  let columns = [];
  rows.forEach(r => Object.keys(r || {}).forEach(k => { if (!columns.includes(k)) columns.push(k); }));
  const lines = [columns.map(toCsvCell).join(',')];
  rows.forEach(r => {
    lines.push(columns.map(k => toCsvCell(r ? r[k] : '')).join(','));
  });
  const csv = '\uFEFF' + lines.join('\r\n'); // BOM 让 Excel 正确识别中文
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

app.post('/api/sales-orders', requirePerm('销售管理', '销售订单', '添加'), (req, res) => {
  const allow = {
    orderNo: 'string', customerId: true, customer_id: true, customerName: 'string', customer_name: 'string',
    customer: 'string', company: 'string', contactName: 'string', contact_name: 'string', contactPhone: 'string', contact_phone: 'string',
    contact: 'string', phone: 'string', address: 'string', shippingAddress: 'string',
    orderDate: 'string', order_date: 'string', deliveryDate: 'string', delivery_date: 'string',
    totalAmount: true, total_amount: true, amount: true, paidAmount: true, payType: 'string', pay_type: 'string',
    remark: 'string', note: 'string', priority: 'string',
    productName: 'string', product_name: 'string', productModel: 'string', product_model: 'string', model: 'string', type: 'string',
    quantity: true, unit: 'string', unitPrice: true, price: true, productId: true, product_id: true,
    spec: 'string', color: 'string', tabletopColor: 'string', tabletop_color: 'string', countertopColor: 'string',
    packaging: 'string', woodworking: 'string', warehousing: 'string', followMethod: 'string', follow_method: 'string',
    items: true, status: 'string'
  };
  const order = {
    id: generateId(),
    orderNo: generateOrderNo('SO', data.salesOrders),
    ...pick(req.body, allow),
    status: 'pending'
  };
  data.salesOrders.push(order);
  
  data.financeRecords.push({
    id: generateId(),
    type: 'income',
    category: '销售收入',
    amount: Number(order.totalAmount ?? order.total_amount ?? order.final_amount ?? order.amount ?? 0),
    date: order.orderDate || order.order_date || new Date().toISOString().slice(0, 10),
    description: `销售订单 ${order.orderNo}`,
    relatedOrderId: order.id
  });
  
  order.items.forEach(item => {
    const inv = data.inventory.find(i => i.productId === item.productId);
    if (inv) {
      inv.quantity -= item.quantity;
    }
  });
  
  saveData();
  logAudit('创建销售订单', `销售订单 ${order.orderNo} 已创建，客户：${req.body.customerName || req.body.customer_name || ''}`, req.user?.name);
  res.json(order);
});

app.put('/api/sales-orders/:id', (req, res) => {
  const order = data.salesOrders.find(o => o.id === req.params.id);
  if (order) {
    Object.assign(order, pick(req.body, {
      orderNo: 'string', customerId: true, customer_id: true, customerName: 'string', customer_name: 'string',
      customer: 'string', company: 'string', contactName: 'string', contact_name: 'string', contactPhone: 'string', contact_phone: 'string',
      contact: 'string', phone: 'string', address: 'string', shippingAddress: 'string',
      orderDate: 'string', order_date: 'string', deliveryDate: 'string', delivery_date: 'string',
      totalAmount: true, total_amount: true, amount: true, paidAmount: true, payType: 'string', pay_type: 'string',
      remark: 'string', note: 'string', priority: 'string',
      productName: 'string', product_name: 'string', productModel: 'string', product_model: 'string', model: 'string', type: 'string',
      quantity: true, unit: 'string', unitPrice: true, price: true, productId: true, product_id: true,
      spec: 'string', color: 'string', tabletopColor: 'string', tabletop_color: 'string', countertopColor: 'string',
      packaging: 'string', woodworking: 'string', warehousing: 'string', followMethod: 'string', follow_method: 'string',
      items: true, status: 'string'
    }));
    saveData();
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

app.put('/api/sales-orders/:id/status', requirePerm('销售管理', '销售订单', '修改'), (req, res) => {
  const order = data.salesOrders.find(o => o.id === req.params.id);
  if (order) {
    order.status = req.body.status;
    saveData();
    logAudit('更新订单状态', `订单 ${order.orderNo || order.id} 状态变更为 ${req.body.status}`, req.user?.name);
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

// 审核订单（自动配货）
app.post('/api/sales-orders/:id/approve', requirePerm('销售管理', '待审核订单', '审核'), (req, res) => {
  const order = data.salesOrders.find(o => o.id === req.params.id);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  if (order.status !== 'pending') {
    return res.status(400).json({ error: 'Order status cannot be approved', currentStatus: order.status });
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
    
    // 为库存不足的产品自动创建计划订单
    unallocatedItems.forEach((item) => {
      const product = data.products.find(p => String(p.id) === String(item.productId));
      const salesOrderItem = order.items.find(i => String(i.productId) === String(item.productId));
      
      const planOrder = {
        id: 'po_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        orderNo: 'PP' + Date.now() + Math.floor(Math.random() * 100),
        orderId: order.id,
        sourceOrderNo: order.orderNo,
        customerId: order.customerId || '',
        customerName: order.customerName || '',
        contactName: order.contactName || '',
        contactPhone: order.contactPhone || '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        remark: '自动生成：销售订单库存不足',
        items: [{
          productId: item.productId,
          productName: item.productName,
          model: item.productModel,
          productType: product?.type || '',
          quantity: item.required,
          unit: product?.unit || '件',
          color: salesOrderItem?.color || product?.color || '',
          spec: salesOrderItem?.spec || '',
          countertopColor: salesOrderItem?.tabletopColor || salesOrderItem?.countertopColor || product?.tabletopColor || '',
          tabletopColor: salesOrderItem?.tabletopColor || salesOrderItem?.countertopColor || product?.tabletopColor || ''
        }],
        productId: item.productId,
        productName: item.productName,
        productModel: item.productModel,
        quantity: item.required,
        color: salesOrderItem?.color || product?.color || '',
        spec: salesOrderItem?.spec || '',
        countertopColor: salesOrderItem?.tabletopColor || salesOrderItem?.countertopColor || product?.tabletopColor || '',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      data.planOrders.push(planOrder);
    });
    
    saveData();
    logAudit('审核订单(自动配货)', `订单 ${order.orderNo} 库存不足，转入生产流程，待生产 ${unallocatedItems.length} 项`, req.user?.name);
    return res.json({
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
    logAudit('审核订单(自动配货)', `订单 ${order.orderNo} 全部配货成功，共 ${allocatedItems.length} 项`, req.user?.name);
    return res.json({
      success: true,
      allocatedItems,
      order
    });
  }
});

app.get('/api/sales-orders/:id/tracking', (req, res) => {
  const orderId = req.params.id;
  const trackingRecords = data.orderTrackingRecords?.filter(r => r.orderId === orderId) || [];
  res.json(trackingRecords);
});

app.post('/api/sales-orders/:id/tracking', (req, res) => {
  const orderId = req.params.id;
  const { action, content, operator } = req.body;
  
  if (!data.orderTrackingRecords) {
    data.orderTrackingRecords = [];
  }
  
  const newRecord = {
    id: generateId(),
    orderId,
    action: action || '跟踪',
    content: content || '',
    operator: operator || req.user?.name || '系统',
    createdAt: new Date().toISOString()
  };
  
  data.orderTrackingRecords.push(newRecord);
  saveData();
  res.json(newRecord);
});

app.post('/api/allocate-order/:id', (req, res) => {
  const order = data.salesOrders.find(o => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  
  const allocatedItems = [];
  const unallocatedItems = [];
  
  // 初始化配货记录数组
  if (!data.allocationRecords) {
    data.allocationRecords = [];
  }
  
  if (order.items && order.items.length > 0) {
    if (!data.inventory) {
      data.inventory = [];
    }
    
    order.items.forEach((item) => {
      const productId = item.productId || item.product_id;
      const requiredQty = Number(item.quantity) || 0;
      const inventoryItem = data.inventory.find(inv => String(inv.productId) === String(productId));
      const availableStock = inventoryItem ? (Number(inventoryItem.quantity) || 0) : 0;
      
      // 从产品数据中获取产品信息
      const product = data.products.find(p => String(p.id) === String(productId));
      
      // 获取产品名称 - 优先从订单明细(productName/name/type)，其次从产品数据
      const productName = item.productName || item.name || item.type || product?.type || product?.name || product?.title || '';
      // 获取产品型号 - 优先从订单明细(productModel/model)，其次从产品数据
      const productModel = item.productModel || item.model || product?.model || product?.sku || '';
      
      if (availableStock >= requiredQty) {
        inventoryItem.quantity = availableStock - requiredQty;
        inventoryItem.updatedAt = new Date().toISOString();
        // 同时更新 products.stock，确保前端显示的可用数量也同步减少
        if (product) {
          product.stock = (Number(product.stock) || 0) - requiredQty;
          product.updatedAt = new Date().toISOString();
        }
        
        // 创建配货记录
        const allocationRecord = {
          id: generateId(),
          orderId: order.id,
          orderNo: order.orderNo || order.orderNumber || order.order_number || '',
          productId,
          productModel,
          productName,
          color: item.color || product?.color || '',
          spec: item.spec || product?.spec || '',
          tabletopColor: item.tabletopColor || item.countertopColor || product?.tabletopColor || product?.countertopColor || '',
          quantity: requiredQty,
          stockSource: inventoryItem.id,
          stockWarehouse: inventoryItem.warehouse || '',
          stockLocation: inventoryItem.location || '',
          allocatedAt: new Date().toISOString()
        };
        data.allocationRecords.push(allocationRecord);
        
        allocatedItems.push({
          productId,
          model: productModel,
          name: productName,
          quantity: requiredQty
        });
      } else {
        unallocatedItems.push({
          productId,
          model: productModel,
          name: productName,
          required: requiredQty,
          available: availableStock
        });
      }
    });
  }
  
  order.status = 'allocated';
  order.allocatedAt = new Date().toISOString();
  
  saveData();
  res.json({
    allocatedItems,
    unallocatedItems,
    order
  });
});

app.get('/api/allocation-records', (req, res) => {
  res.json(data.allocationRecords || []);
});

app.get('/api/allocation-records/order/:orderId', (req, res) => {
  const orderId = req.params.orderId;
  const records = data.allocationRecords?.filter(r => r.orderId === orderId) || [];
  res.json(records);
});

app.get('/api/sales-orders/:id/inventory-locks', (req, res) => {
  const orderId = req.params.id;
  // 先从新的配货记录中获取
  const allocationRecords = data.allocationRecords?.filter(r => r.orderId === orderId) || [];
  
  // 将配货记录转换为inventory-locks格式
  const locks = allocationRecords.map(record => {
    // 从产品数据中补全信息（防止记录中字段缺失）
    const product = data.products?.find(p => String(p.id) === String(record.productId));
    return {
      id: record.id,
      orderId: record.orderId,
      productId: record.productId,
      productName: record.productName || product?.type || product?.name || product?.title || '-',
      productModel: record.productModel || product?.model || product?.sku || '-',
      color: record.color || product?.color || '-',
      spec: record.spec || product?.spec || '-',
      tabletopColor: record.tabletopColor || product?.tabletopColor || '-',
      lockedQuantity: record.quantity || 0,
      status: 'locked',
      lockedAt: record.allocatedAt,
      createdAt: record.allocatedAt,
      warehouse: record.stockWarehouse || product?.warehouse || '-',
      location: record.stockLocation || '-'
    };
  });
  
  // 同时兼容旧的inventoryLocks数据
  const oldLocks = data.inventoryLocks?.filter(l => l.orderId === orderId) || [];
  
  res.json([...locks, ...oldLocks]);
});

app.get('/api/products/:id/inventory-locks', (req, res) => {
  const productId = req.params.id;
  
  // 从配货记录中筛选该产品的锁定记录
  const allocationRecords = data.allocationRecords?.filter(r => String(r.productId) === String(productId)) || [];
  
  // 将配货记录转换为inventory-locks格式，并关联订单信息
  const locks = allocationRecords.map(record => {
    const product = data.products?.find(p => String(p.id) === String(record.productId));
    const order = data.salesOrders?.find(o => o.id === record.orderId);
    // 支持 customerId 和 customer_id 两种格式
    const customerId = order?.customerId || order?.customer_id;
    const customer = order ? (data.customers?.find(c => String(c.id) === String(customerId)) || {}) : {};
    
    // 优先从订单获取联系人信息，其次从客户表获取
    const contactName = order?.contact_name || order?.contactName || customer.contact || '-';
    const contactPhone = order?.contact_phone || order?.contactPhone || customer.phone || '-';
    const contactInfo = contactName && contactPhone ? `${contactName} (${contactPhone})` : (contactName || contactPhone || '-');
    
    return {
      id: record.id,
      orderId: record.orderId,
      orderNo: record.orderNo || order?.orderNo || order?.orderNumber || order?.order_number || '-',
      productId: record.productId,
      productName: record.productName || product?.type || product?.name || '-',
      productModel: record.productModel || product?.model || product?.sku || '-',
      customerName: customer.name || order?.customer_name || order?.customerName || '-',
      contact: contactInfo,
      lockedQuantity: record.quantity || 0,
      status: 'locked',
      lockedAt: record.allocatedAt,
      createdAt: record.allocatedAt,
      orderDate: order?.orderDate || '-'
    };
  });
  
  // 同时兼容旧的inventoryLocks数据
  const oldLocks = data.inventoryLocks?.filter(l => String(l.productId) === String(productId)) || [];
  
  res.json([...locks, ...oldLocks]);
});

app.post('/api/purchase-orders', (req, res) => {
  const order = {
    id: generateId(),
    orderNo: generateOrderNo('PO', data.purchaseOrders),
    ...pick(req.body, { supplierId: 'string', supplier_id: 'string', supplierName: 'string', supplier_name: 'string', supplier: 'string', contact: 'string', phone: 'string', address: 'string', items: true, orderDate: 'string', order_date: 'string', totalAmount: true, total_amount: true, remark: 'string', note: 'string', warehouse: 'string', expectedDate: 'string', status: 'string', productName: 'string', product_id: true, productId: true, quantity: true, unit: 'string', unitPrice: true, price: true, color: 'string', spec: 'string' }),
    status: 'pending'
  };
  data.purchaseOrders.push(order);
  
  data.financeRecords.push({
    id: generateId(),
    type: 'expense',
    category: '采购支出',
    amount: Number(order.totalAmount ?? order.total_amount ?? order.final_amount ?? order.amount ?? 0),
    date: order.orderDate || order.order_date || new Date().toISOString().slice(0, 10),
    description: `采购订单 ${order.orderNo}`,
    relatedOrderId: order.id
  });
  
  saveData();
  logAudit('创建采购订单', `采购订单 ${order.orderNo} 已创建`, req.user?.name);
  res.json(order);
});

app.put('/api/purchase-orders/:id', (req, res) => {
  const order = data.purchaseOrders.find(o => o.id === req.params.id);
  if (order) {
    Object.assign(order, pick(req.body, { supplierId: 'string', supplier_id: 'string', supplierName: 'string', supplier_name: 'string', supplier: 'string', contact: 'string', phone: 'string', address: 'string', items: true, orderDate: 'string', order_date: 'string', totalAmount: true, total_amount: true, remark: 'string', note: 'string', warehouse: 'string', expectedDate: 'string', status: 'string', productName: 'string', product_id: true, productId: true, quantity: true, unit: 'string', unitPrice: true, price: true, color: 'string', spec: 'string' }));
    
    // 状态推进到 completed 时回补库存（仅在未入库过时执行一次，避免与收货重复入库）
    if (req.body.status === 'completed' && order.stocked !== true) {
      if (!data.stockInRecords) data.stockInRecords = [];
      (order.items || []).forEach(item => {
        if (!item || !item.productId) return;
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) return;
        const inv = data.inventory.find(i => String(i.productId) === String(item.productId));
        if (inv) {
          inv.quantity = (Number(inv.quantity) || 0) + qty;
          inv.updatedAt = new Date().toISOString();
        } else {
          data.inventory.push({ id: generateId(), productId: item.productId, quantity: qty, minStock: 0, warehouse: order.warehouse || '主仓库' });
        }
        data.stockInRecords.push({
          id: generateId(),
          productId: item.productId,
          productName: String(item.productName || item.name || ''),
          productModel: String(item.productModel || item.model || ''),
          quantity: qty,
          warehouse: order.warehouse || '主仓库',
          color: String(item.color || ''),
          spec: String(item.spec || ''),
          unit: String(item.unit || ''),
          remark: `采购订单 ${order.orderNo || ''} 完成入库`,
          type: '采购入库',
          relatedOrderId: order.id,
          operator: req.user ? (req.user.username || '') : '',
          createdAt: new Date().toISOString()
        });
      });
      order.stocked = true;
    }
    
    saveData();
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

// 作废待收采购单（仅未收货/未结算的 pending 可删），同时移除其关联采购支出财务记录
app.delete('/api/purchase-orders/:id', requirePerm('采购管理', '采购订单', '删除'), (req, res) => {
  const order = data.purchaseOrders.find(o => String(o.id) === String(req.params.id));
  if (!order) return res.status(404).json({ success: false, message: '采购单不存在' });
  if (!['pending'].includes(order.status)) {
    return res.status(400).json({ success: false, message: '仅待收货的采购单可作废' });
  }
  // 移除关联的采购支出财务记录
  if (Array.isArray(data.financeRecords)) {
    data.financeRecords = data.financeRecords.filter(r => !(r.relatedOrderId === order.id && r.type === 'expense'));
  }
  data.purchaseOrders = data.purchaseOrders.filter(o => o.id !== order.id);
  saveData();
  logAudit('作废采购单', `采购单 ${order.orderNo} 已作废删除`, req.user?.name);
  res.json({ success: true });
});

// 采购收货：按明细回补库存并记录入库，推进采购单状态（pending→received/completed），避免重复入库
app.post('/api/purchase-orders/:id/receive', requirePerm('采购管理', '采购订单', '收货'), (req, res) => {
  const order = data.purchaseOrders.find(o => String(o.id) === String(req.params.id));
  if (!order) return res.status(404).json({ success: false, message: '采购单不存在' });
  if (order.stocked === true || ['completed'].includes(order.status)) {
    return res.status(400).json({ success: false, message: '该采购单已完成收货，请勿重复操作' });
  }
  if (!data.stockInRecords) data.stockInRecords = [];
  const warehouse = String(req.body.warehouse || order.warehouse || '主仓库');
  (order.items || []).forEach(item => {
    if (!item || !item.productId) return;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;
    const inv = data.inventory.find(i => String(i.productId) === String(item.productId));
    if (inv) {
      inv.quantity = (Number(inv.quantity) || 0) + qty;
      inv.updatedAt = new Date().toISOString();
    } else {
      data.inventory.push({ id: generateId(), productId: item.productId, quantity: qty, minStock: 0, warehouse });
    }
    data.stockInRecords.push({
      id: generateId(),
      productId: item.productId,
      productName: String(item.productName || item.name || ''),
      productModel: String(item.productModel || item.model || ''),
      quantity: qty,
      warehouse,
      color: String(item.color || ''),
      spec: String(item.spec || ''),
      unit: String(item.unit || ''),
      remark: `采购订单 ${order.orderNo || ''} 收货`,
      type: '采购收货',
      relatedOrderId: order.id,
      operator: req.user ? (req.user.username || '') : '',
      createdAt: new Date().toISOString()
    });
  });
  order.stocked = true;
  order.status = String(req.body.status || 'received') === 'completed' ? 'completed' : 'received';
  order.receivedAt = new Date().toISOString();
  order.receivedBy = req.user ? (req.user.username || '') : '';
  order.updatedAt = new Date().toISOString();
  saveData();
  logAudit('采购收货', `采购单 ${order.orderNo} 已收货入库`, req.user?.name);
  res.json({ success: true, order });
});

// 采购退货：红冲库存与采购支出财务记录
app.post('/api/purchase-returns', requirePerm('采购管理', '采购退货', '退货'), (req, res) => {
  const productId = String(req.body.productId || req.body.product_id || '');
  let qty = Number(req.body.quantity) || 0;
  if (!productId || qty <= 0) return res.status(400).json({ success: false, message: '请选择产品并填写正确的退货数量' });

  // 关联采购单单价，用于估算退货金额（负值冲减采购支出）
  let unitEstimate = Number(req.body.amount) || 0;
  if (!unitEstimate) {
    const po = data.purchaseOrders.find(o => String(o.id) === String(req.body.purchaseOrderId) && Array.isArray(o.items));
    const line = po && po.items.find(it => String(it.productId) === String(productId));
    if (line) unitEstimate = Number(line.unitPrice || line.price || 0);
  }
  if (!unitEstimate) unitEstimate = 0;

  // 红冲库存
  const inv = data.inventory.find(i => String(i.productId) === productId);
  if (inv) {
    const current = Number(inv.quantity) || 0;
    const back = Math.min(current, qty);
    inv.quantity = current - back;
    inv.updatedAt = new Date().toISOString();
    qty = back; // 实际冲减的数量（不超过现有库存）
  } else {
    return res.status(400).json({ success: false, message: '未找到对应库存记录，无法退货' });
  }

  const returnAmount = -1 * Math.abs(qty) * Math.abs(unitEstimate);
  data.financeRecords.push({
    id: generateId(),
    type: 'expense',
    category: '采购退货(红冲)',
    amount: returnAmount,
    date: new Date().toISOString().slice(0, 10),
    description: `采购退货 ${qty} 件`,
    relatedOrderId: String(req.body.purchaseOrderId || '')
  });

  const returnRec = {
    id: generateId(),
    productId,
    productName: String(req.body.productName || inv.productName || ''),
    quantity: qty,
    amount: returnAmount,
    returnReason: String(req.body.returnReason || req.body.remark || ''),
    operator: req.user ? (req.user.username || '') : '',
    createdAt: new Date().toISOString()
  };
  if (!data.purchaseReturns) data.purchaseReturns = [];
  data.purchaseReturns.push(returnRec);

  saveData();
  logAudit('采购退货', `产品 ${productId} 退货 ${qty} 件，红冲 ${-returnAmount} 元`, req.user?.name);
  res.json({ success: true, record: returnRec });
});

app.get('/api/purchase-returns', (req, res) => {
  res.json(data.purchaseReturns || []);
});

app.get('/api/warehouses', (req, res) => {
  res.json(data.warehouses);
});

app.post('/api/warehouses', (req, res) => {
  const warehouse = {
    id: generateId(),
    code: 'WH' + String(data.warehouses.length + 1).padStart(3, '0'),
    ...pick(req.body, { name: 'string', type: 'string', manager: 'string', phone: 'string', address: 'string', remark: 'string', isDefault: true, isActive: true, capacity: true })
  };
  data.warehouses.push(warehouse);
  saveData();
  res.json(warehouse);
});

app.put('/api/warehouses/:id', (req, res) => {
  const warehouse = data.warehouses.find(w => w.id === req.params.id);
  if (warehouse) {
    Object.assign(warehouse, pick(req.body, { name: 'string', type: 'string', manager: 'string', phone: 'string', address: 'string', remark: 'string', isDefault: true, isActive: true, capacity: true }));
    saveData();
    res.json(warehouse);
  } else {
    res.status(404).json({ error: 'Warehouse not found' });
  }
});

app.delete('/api/warehouses/:id', (req, res) => {
  const index = data.warehouses.findIndex(w => w.id === req.params.id);
  if (index !== -1) {
    const deleted = data.warehouses.splice(index, 1)[0];
    saveData();
    res.json(deleted);
  } else {
    res.status(404).json({ error: 'Warehouse not found' });
  }
});

app.post('/api/finance-records', (req, res) => {
  const record = {
    id: generateId(),
    ...pick(req.body, { type: 'string', category: 'string', amount: true, date: 'string', description: 'string', relatedOrderId: true, direction: 'string', payer: 'string', payee: 'string', bank: 'string', method: 'string', recordNo: 'string' })
  };
  data.financeRecords.push(record);
  saveData();
  res.json(record);
});

app.get('/api/product-spec-prices', (req, res) => {
  res.json(data.productSpecPrices);
});

app.get('/api/product-spec-prices/:productId', (req, res) => {
  const productSpecPrices = data.productSpecPrices.filter(item => item.productId === req.params.productId);
  res.json(productSpecPrices);
});

app.post('/api/product-spec-prices', (req, res) => {
  const specPrice = {
    id: generateId(),
    ...pick(req.body, { productId: 'string', spec: 'string', price: true, costPrice: true, color: 'string', tabletopColor: 'string', size: 'string', minQuantity: true, remark: 'string' })
  };
  data.productSpecPrices.push(specPrice);
  saveData();
  res.json(specPrice);
});

app.put('/api/product-spec-prices/:id', (req, res) => {
  const specPrice = data.productSpecPrices.find(item => item.id === req.params.id);
  if (specPrice) {
    Object.assign(specPrice, pick(req.body, { productId: 'string', spec: 'string', price: true, costPrice: true, color: 'string', tabletopColor: 'string', size: 'string', minQuantity: true, remark: 'string' }));
    saveData();
    res.json(specPrice);
  } else {
    res.status(404).json({ error: 'Product spec price not found' });
  }
});

app.delete('/api/product-spec-prices/:id', (req, res) => {
  const index = data.productSpecPrices.findIndex(item => item.id === req.params.id);
  if (index !== -1) {
    const deleted = data.productSpecPrices.splice(index, 1)[0];
    saveData();
    res.json(deleted);
  } else {
    res.status(404).json({ error: 'Product spec price not found' });
  }
});

// ==================== 用户认证 API ====================

// 登录接口（支持旧明文密码自动迁移为哈希 + 防爆破）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip || req.connection?.remoteAddress || '';
  const key = `${username || ''}|${ip}`;
  
  if (isLoginLocked(key)) {
    return res.status(429).json({ success: false, message: '登录失败次数过多，请15分钟后再试' });
  }
  
  // 从用户列表中查找用户
  const user = data.users.find(u => u.username === username);
  
  if (!user || !verifyPassword(password, user.password)) {
    recordLoginFailure(key);
    logAudit('登录失败', `用户「${username || '未知'}」登录失败`, username || '未知');
    return res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
  
  // 旧明文密码首次登录成功后自动迁移为哈希
  if (!isHashedPassword(user.password)) {
    user.password = hashPassword(user.password);
    saveData();
  }
  
  resetLoginAttempts(key);
  const token = createSession(username);
  logAudit('登录成功', `用户「${user.name || username}」登录系统`, username);
  
  res.json({
    success: true,
    message: '登录成功',
    token: token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email || '',
      avatar: user.avatar || ''
    }
  });
});

// 验证登录状态（真实服务端会话校验）
app.get('/api/auth/check', (req, res) => {
  const token = req.headers['authorization'] || req.headers['x-access-token'] || '';
  if (token && token !== 'null' && token !== 'undefined') {
    const username = getSessionUser(token);
    if (username) {
      const user = data.users.find(u => u.username === username);
      res.json({ loggedIn: true, message: '已登录', user: { username, name: user?.name || username } });
      return;
    }
  }
  res.json({ loggedIn: false, message: '未登录' });
});

// 登出接口（销毁服务端会话）
app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization'] || req.headers['x-access-token'] || '';
  const username = req.user?.username;
  if (token) destroySession(token);
  logAudit('退出登录', `用户「${username || '未知'}」退出系统`, username);
  res.json({ success: true, message: '登出成功' });
});

// 更新当前用户信息（仅能修改本人资料）
app.put('/api/users/me', (req, res) => {
  const { name, email, avatar, oldPassword, newPassword } = req.body;
  
  if (!name || !email) {
    return res.json({
      success: false,
      message: '用户名和邮箱不能为空'
    });
  }
  
  const myUsername = (req.user && req.user.username) || 'admin';
  const user = data.users.find(u => u.username === myUsername);
  
  if (!user) {
    return res.json({
      success: false,
      message: '用户不存在'
    });
  }
  
  if (newPassword) {
    if (!verifyPassword(oldPassword || '', user.password)) {
      return res.json({
        success: false,
        message: '原密码不正确'
      });
    }
    
    if (newPassword.length < 6) {
      return res.json({
        success: false,
        message: '新密码长度不能少于6位'
      });
    }
    
    user.password = hashPassword(newPassword);
  }
  
  user.name = name;
  user.email = email;
  user.avatar = avatar;
  
  saveData();
  
  res.json({
    success: true,
    message: '保存成功',
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role
    }
  });
});

// ==================== 用户认证 API 结束 ====================

// ==================== 用户管理 API ====================

// 获取所有用户（脱敏，不返回密码）
app.get('/api/users', (req, res) => {
  res.json((data.users || []).map(u => {
    const { password, ...safeUser } = u;
    return safeUser;
  }));
});

// 创建用户（仅管理员）
app.post('/api/users', requireAdmin, (req, res) => {
  if (!data.users) data.users = [];
  
  const { username, name, role, password } = req.body;
  
  if (!username || !name || !role || !password) {
    return res.json({
      success: false,
      message: '用户名、姓名、角色和密码不能为空'
    });
  }
  
  if (data.users.find(u => u.username === username)) {
    return res.json({
      success: false,
      message: '用户名已存在'
    });
  }
  
  const maxId = data.users.length > 0 ? Math.max(...data.users.map(u => parseInt(u.id))) : 0;
  const newUser = {
    id: maxId + 1,
    username,
    name,
    role,
    password: hashPassword(password),
    status: '启用',
    createdAt: new Date().toISOString().split('T')[0]
  };
  
  data.users.push(newUser);
  saveData();
  logAudit('创建用户', `创建用户「${username}」`, req.user?.name);
  
  res.json({
    success: true,
    message: '用户添加成功',
    user: { ...newUser, password: undefined }
  });
});

// 更新用户（仅管理员）
app.put('/api/users/:id', requireAdmin, (req, res) => {
  if (!data.users) data.users = [];
  
  const userId = parseInt(req.params.id);
  const { username, name, role, password, status } = req.body;
  
  const userIndex = data.users.findIndex(u => parseInt(u.id) === userId);
  
  if (userIndex === -1) {
    return res.json({
      success: false,
      message: '用户不存在'
    });
  }
  
  const existingUser = data.users.find(u => u.username === username && parseInt(u.id) !== userId);
  if (existingUser) {
    return res.json({
      success: false,
      message: '用户名已存在'
    });
  }
  
  const updatedUser = {
    ...data.users[userIndex],
    username,
    name,
    role
  };
  
  if (password) {
    updatedUser.password = hashPassword(password);
  }
  
  if (status !== undefined) {
    updatedUser.status = status;
  }
  
  data.users[userIndex] = updatedUser;
  saveData();
  logAudit('更新用户', `更新用户「${username}」`, req.user?.name);
  
  res.json({
    success: true,
    message: '用户更新成功',
    user: { ...updatedUser, password: undefined }
  });
});

// 删除用户（仅管理员）
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (!data.users) data.users = [];
  
  const userId = parseInt(req.params.id);
  
  if (userId === 1) {
    return res.json({
      success: false,
      message: '不能删除管理员账户'
    });
  }
  
  const userIndex = data.users.findIndex(u => parseInt(u.id) === userId);
  
  if (userIndex === -1) {
    return res.json({
      success: false,
      message: '用户不存在'
    });
  }
  
  const deleted = data.users[userIndex];
  data.users.splice(userIndex, 1);
  saveData();
  logAudit('删除用户', `删除用户「${deleted.username}」`, req.user?.name);
  
  res.json({
    success: true,
    message: '用户删除成功'
  });
});

// ==================== 用户管理 API 结束 ====================

// ==================== 角色管理 API ====================

// 获取所有角色
app.get('/api/roles', (req, res) => {
  res.json(data.roles || []);
});

// 获取单个角色
app.get('/api/roles/:id', (req, res) => {
  const role = (data.roles || []).find(r => String(r.id) === String(req.params.id));
  if (role) {
    res.json(role);
  } else {
    res.status(404).json({ error: 'Role not found' });
  }
});

// 创建角色（仅管理员）
app.post('/api/roles', requireAdmin, (req, res) => {
  if (!data.roles) data.roles = [];
  
  const maxId = data.roles.length > 0 ? Math.max(...data.roles.map(r => r.id)) : 0;
  const role = {
    id: req.body.id || (maxId + 1),
    name: req.body.name || '',
    description: req.body.description || '',
    type: req.body.type || 'normal',
    userCount: req.body.userCount || 0,
    createdAt: req.body.createdAt || new Date().toISOString().split('T')[0],
    permissions: req.body.permissions || []
  };
  data.roles.push(role);
  saveData();
  console.log('创建角色成功:', role);
  res.json(role);
});

// 更新角色（仅管理员，禁止透传注入任意字段）
app.put('/api/roles/:id', requireAdmin, (req, res) => {
  const index = (data.roles || []).findIndex(r => String(r.id) === String(req.params.id));
  if (index !== -1) {
    const allow = pick(req.body, { name: 'string', description: 'string', type: 'string', userCount: true, permissions: true });
    data.roles[index] = {
      ...data.roles[index],
      ...allow,
      id: data.roles[index].id // 保持ID不变
    };
    saveData();
    console.log('更新角色成功:', data.roles[index]);
    res.json(data.roles[index]);
  } else {
    res.status(404).json({ error: 'Role not found' });
  }
});

// 删除角色（仅管理员）
app.delete('/api/roles/:id', requireAdmin, (req, res) => {
  const index = (data.roles || []).findIndex(r => String(r.id) === String(req.params.id));
  if (index !== -1) {
    const deleted = data.roles.splice(index, 1)[0];
    saveData();
    console.log('删除角色成功:', deleted);
    res.json(deleted);
  } else {
    res.status(404).json({ error: 'Role not found' });
  }
});

// 更新角色权限（仅管理员）
app.put('/api/roles/:id/permissions', requireAdmin, (req, res) => {
  const role = (data.roles || []).find(r => String(r.id) === String(req.params.id));
  if (role) {
    role.permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    saveData();
    console.log('更新角色权限成功:', role);
    res.json(role);
  } else {
    res.status(404).json({ error: 'Role not found' });
  }
});

// ==================== 角色管理 API 结束 ====================

app.post('/api/reset', requireAdmin, (req, res) => {
  data = JSON.parse(JSON.stringify(initialData));
  saveData();
  logAudit('系统重置', '管理员执行了全部数据重置', req.user && req.user.username);
  res.json({ message: 'Data reset successfully' });
});

// 库存记录 API
app.get('/api/stock-in-records', (req, res) => {
  res.json(data.stockInRecords || []);
});

app.get('/api/stock-records', (req, res) => {
  res.json(data.stockInRecords || []);
});

app.post('/api/stock-records', (req, res) => {
  if (!data.stockInRecords) data.stockInRecords = [];
  const newRecord = {
    id: req.body.id || generateId(),
    ...pick(req.body, { productId: 'string', product_id: 'string', productName: 'string', product_name: 'string', productModel: 'string', product_model: 'string', quantity: true, warehouse: 'string', location: 'string', color: 'string', spec: 'string', tabletopColor: 'string', minStock: true, batchNo: 'string', unit: 'string', remark: 'string', orderNo: 'string', order_id: true, type: 'string', supplierId: 'string', operator: 'string', cost: true, price: true, updatedAt: 'string' }),
    createdAt: req.body.createdAt || new Date().toISOString()
  };
  data.stockInRecords.push(newRecord);
  saveData();
  res.json(newRecord);
});

app.post('/api/stock-in-records', (req, res) => {
  if (!data.stockInRecords) data.stockInRecords = [];
  const newRecord = {
    id: req.body.id || generateId(),
    ...pick(req.body, { productId: 'string', product_id: 'string', productName: 'string', product_name: 'string', productModel: 'string', product_model: 'string', quantity: true, warehouse: 'string', location: 'string', color: 'string', spec: 'string', tabletopColor: 'string', minStock: true, batchNo: 'string', unit: 'string', remark: 'string', orderNo: 'string', order_id: true, type: 'string', supplierId: 'string', operator: 'string', cost: true, price: true, updatedAt: 'string' }),
    createdAt: req.body.createdAt || new Date().toISOString()
  };
  data.stockInRecords.push(newRecord);
  
  // 同步更新 inventory 表和 products.stock
  if (newRecord.productId && newRecord.quantity) {
    if (!data.inventory) data.inventory = [];
    const existingInv = data.inventory.find(inv => String(inv.productId) === String(newRecord.productId));
    const qtyToAdd = Number(newRecord.quantity) || 0;
    if (existingInv) {
      existingInv.quantity = (Number(existingInv.quantity) || 0) + qtyToAdd;
      existingInv.warehouse = newRecord.warehouse || existingInv.warehouse || '主仓库';
      existingInv.location = newRecord.location || existingInv.location || '';
      existingInv.color = newRecord.color || existingInv.color || '';
      existingInv.spec = newRecord.spec || existingInv.spec || '';
      existingInv.tabletopColor = newRecord.tabletopColor || existingInv.tabletopColor || '';
      if (newRecord.productName) existingInv.productName = newRecord.productName;
      if (newRecord.productModel) existingInv.productModel = newRecord.productModel;
      existingInv.updatedAt = new Date().toISOString();
    } else {
      // 从产品数据获取产品名称和型号
      const prod = data.products.find(p => String(p.id) === String(newRecord.productId));
      const prodName = newRecord.productName || prod?.type || prod?.name || prod?.title || '';
      const prodModel = newRecord.productModel || prod?.model || prod?.sku || '';
      data.inventory.push({
        id: 'inv_' + Date.now(),
        productId: newRecord.productId,
        productModel: prodModel,
        productName: prodName,
        quantity: qtyToAdd,
        minStock: 0,
        warehouse: newRecord.warehouse || '主仓库',
        location: newRecord.location || '',
        color: newRecord.color || prod?.color || '',
        spec: newRecord.spec || prod?.spec || '',
        tabletopColor: newRecord.tabletopColor || prod?.tabletopColor || '',
        createdAt: new Date().toISOString()
      });
    }
    // 同步更新 products.stock，确保前端"可用数量"显示正确
    const productToUpdate = data.products.find(p => String(p.id) === String(newRecord.productId));
    if (productToUpdate) {
      productToUpdate.stock = (Number(productToUpdate.stock) || 0) + qtyToAdd;
      productToUpdate.updatedAt = new Date().toISOString();
    }
  }
  
  saveData();
  res.json(newRecord);
});

app.put('/api/stock-in-records/:id', (req, res) => {
  if (!data.stockInRecords) data.stockInRecords = [];
  const idx = data.stockInRecords.findIndex(r => String(r.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Record not found' });
  }
  const oldRecord = data.stockInRecords[idx];
  const updatedRecord = { ...oldRecord, ...pick(req.body, { productId: 'string', product_id: 'string', productName: 'string', product_name: 'string', productModel: 'string', product_model: 'string', quantity: true, warehouse: 'string', location: 'string', color: 'string', spec: 'string', tabletopColor: 'string', minStock: true, batchNo: 'string', unit: 'string', remark: 'string', orderNo: 'string', order_id: true, type: 'string', supplierId: 'string', operator: 'string', cost: true, price: true, updatedAt: 'string' }), id: oldRecord.id };
  data.stockInRecords[idx] = updatedRecord;
  
  // 同步更新 inventory 表和 products.stock
  if (oldRecord.productId && oldRecord.quantity) {
    const existingInv = data.inventory ? data.inventory.find(inv => String(inv.productId) === String(oldRecord.productId)) : null;
    const qtyDiff = (Number(updatedRecord.quantity) || 0) - (Number(oldRecord.quantity) || 0);
    if (existingInv) {
      existingInv.quantity = (Number(existingInv.quantity) || 0) + qtyDiff;
    }
    // 同步更新 products.stock
    const productToUpdate = data.products.find(p => String(p.id) === String(oldRecord.productId));
    if (productToUpdate) {
      productToUpdate.stock = (Number(productToUpdate.stock) || 0) + qtyDiff;
    }
  }
  
  saveData();
  res.json(updatedRecord);
});

app.put('/api/stock-records/:id', (req, res) => {
  if (!data.stockInRecords) data.stockInRecords = [];
  const idx = data.stockInRecords.findIndex(r => String(r.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Record not found' });
  }
  data.stockInRecords[idx] = { ...data.stockInRecords[idx], ...pick(req.body, { productId: 'string', product_id: 'string', productName: 'string', product_name: 'string', productModel: 'string', product_model: 'string', quantity: true, warehouse: 'string', location: 'string', color: 'string', spec: 'string', tabletopColor: 'string', minStock: true, batchNo: 'string', unit: 'string', remark: 'string', orderNo: 'string', order_id: true, type: 'string', supplierId: 'string', operator: 'string', cost: true, price: true, updatedAt: 'string' }), id: data.stockInRecords[idx].id };
  saveData();
  res.json(data.stockInRecords[idx]);
});

app.delete('/api/stock-in-records/:id', (req, res) => {
  if (!data.stockInRecords) data.stockInRecords = [];
  const idx = data.stockInRecords.findIndex(r => String(r.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Record not found' });
  }
  const deletedRecord = data.stockInRecords[idx];
  // 同步扣减 inventory 和 products.stock（作废 = 减少库存）
  if (deletedRecord.productId && deletedRecord.quantity) {
    const existingInv = data.inventory ? data.inventory.find(inv => String(inv.productId) === String(deletedRecord.productId)) : null;
    if (existingInv) {
      existingInv.quantity = Math.max(0, (Number(existingInv.quantity) || 0) - (Number(deletedRecord.quantity) || 0));
    }
    const productToUpdate = data.products.find(p => String(p.id) === String(deletedRecord.productId));
    if (productToUpdate) {
      productToUpdate.stock = Math.max(0, (Number(productToUpdate.stock) || 0) - (Number(deletedRecord.quantity) || 0));
    }
  }
  data.stockInRecords.splice(idx, 1);
  saveData();
  res.json({ message: 'Deleted successfully' });
});

app.delete('/api/stock-records/:id', (req, res) => {
  if (!data.stockInRecords) data.stockInRecords = [];
  const idx = data.stockInRecords.findIndex(r => String(r.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Record not found' });
  }
  data.stockInRecords.splice(idx, 1);
  saveData();
  res.json({ message: 'Deleted successfully' });
});

// ==================== 计划订单 API ====================

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
app.post('/api/plan-orders', requirePerm('生产管理', '计划订单', '添加'), (req, res) => {
  const { orderId, productId, quantity, customerId, customerName, contactName, contactPhone, startDate, endDate, remark, color, spec, countertopColor, model, productName, productType } = req.body;
  
  const product = data.products.find(p => String(p.id) === String(productId));
  const order = data.salesOrders.find(o => o.id === orderId);
  
  const planOrder = {
    id: 'po_' + Date.now(),
    orderNo: 'PP' + Date.now(),
    orderId,
    customerId: customerId || '',
    customerName: customerName || '',
    contactName: contactName || '',
    contactPhone: contactPhone || '',
    startDate: startDate || new Date().toISOString().split('T')[0],
    endDate: endDate || new Date().toISOString().split('T')[0],
    remark: remark || '',
    items: product ? [{
      productId,
      productName: productName || product?.type || product?.name || '',
      model: model || product?.model || product?.sku || '',
      productType: productType || product?.type || '',
      quantity: Number(quantity) || 0,
      unit: product?.unit || '件',
      color: color || product?.color || '',
      spec: spec || '',
      countertopColor: countertopColor || product?.tabletopColor || '',
      tabletopColor: countertopColor || product?.tabletopColor || ''
    }] : [],
    productId,
    productName: productName || product?.type || product?.name || '',
    productModel: model || product?.model || product?.sku || '',
    quantity: Number(quantity) || 0,
    color: color || product?.color || '',
    spec: spec || '',
    countertopColor: countertopColor || product?.tabletopColor || '',
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
  logAudit('创建计划订单', `计划单 ${planOrder.orderNo} 已创建，产品：${planOrder.productName || ''}，数量：${planOrder.quantity || 0}`, req.user?.name);
  res.json(planOrder);
});

// 删除计划订单
app.delete('/api/plan-orders/:id', (req, res) => {
  const index = data.planOrders.findIndex(o => o.id === req.params.id);
  if (index !== -1) {
    // 同时删除关联的工序
    const planOrderId = req.params.id;
    data.processes = data.processes.filter(p => p.planOrderId !== planOrderId);
    
    data.planOrders.splice(index, 1);
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Plan order not found' });
  }
});

// 更新计划订单（基本信息）
app.put('/api/plan-orders/:id', (req, res) => {
  const planOrder = data.planOrders.find(o => o.id === req.params.id);
  if (!planOrder) {
    res.status(404).json({ error: 'Plan order not found' });
    return;
  }
  
  const { customerId, customerName, contactName, contactPhone, startDate, endDate, remark, items } = req.body;
  
  if (customerId !== undefined) planOrder.customerId = customerId;
  if (customerName !== undefined) planOrder.customerName = customerName;
  if (contactName !== undefined) planOrder.contactName = contactName;
  if (contactPhone !== undefined) planOrder.contactPhone = contactPhone;
  if (startDate !== undefined) planOrder.startDate = startDate;
  if (endDate !== undefined) planOrder.endDate = endDate;
  if (remark !== undefined) planOrder.remark = remark;
  if (items !== undefined) planOrder.items = items;
  planOrder.updatedAt = new Date().toISOString();
  
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

// 获取计划订单关联的销售订单信息
app.get('/api/plan-orders/:id/order', (req, res) => {
  const planOrder = data.planOrders.find(o => o.id === req.params.id);
  if (!planOrder) {
    return res.status(404).json({ error: 'Plan order not found' });
  }
  const order = data.salesOrders.find(o => o.id === planOrder.orderId);
  if (order) {
    const customer = data.customers.find(c => String(c.id) === String(order.customerId || order.customer_id)) || {};
    res.json({ ...order, customerName: customer.name || '-' });
  } else {
    res.json(null);
  }
});

// ==================== 工序 API ====================

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
    sequence: p.sequence || (index + 1),
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
  logAudit('配置工序', `计划单 ${planOrder.orderNo} 配置了 ${newProcesses.length} 道工序：${newProcesses.map(p => p.name).join('、')}`, req.user?.name);
  res.json({ success: true, processes: newProcesses });
});

// 派工
app.put('/api/processes/:id/assign', requirePerm('生产管理', '派工管理', '派工'), (req, res) => {
  const { assignee } = req.body;
  const process = data.processes.find(p => p.id === req.params.id);
  
  if (process) {
    process.assignee = assignee;
    if (process.status === 'pending') {
      process.status = 'in_progress';
    }
    saveData();
    logAudit('派工', `工序「${process.name}」派工给「${assignee || '未指定'}」`, req.user?.name);
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
      type: 'production_in',
      relatedPlanOrderId: planOrder.id,
      createdAt: new Date().toISOString()
    };
    data.inventory.push(inventoryRecord);
    
    // 更新库存数量
    const inv = data.inventory.find(i => String(i.productId) === String(planOrder.productId) && !i.type);
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
        source: 'production',
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
  logAudit('工序完工', `工序「${process.name}」完工确认${isStockIn ? '（入库完成，已自动配货）' : ''}`, req.user?.name);
  res.json({ 
    success: true, 
    process,
    isLastProcess: isStockIn,
    planOrder
  });
});

// ==================== 智能预警中心 API ====================
app.get('/api/alerts', (req, res) => {
  const alerts = [];
  const now = new Date();
  const rank = { danger: 0, warning: 1, info: 2 };

  // 1. 低库存预警
  (data.inventory || []).forEach(inv => {
    const product = data.products.find(p => String(p.id) === String(inv.productId));
    const qty = Number(inv.quantity) || 0;
    const threshold = Number(inv.minStock) > 0 ? Number(inv.minStock) : (Number(product?.minStock) || 0);
    if (threshold > 0 && qty <= threshold) {
      const name = product?.name || product?.type || inv.productName || inv.productId;
      alerts.push({
        type: 'low_stock',
        level: qty === 0 ? 'danger' : 'warning',
        title: '库存不足',
        productId: inv.productId,
        productName: name,
        model: product?.model || inv.productModel || '',
        current: qty,
        threshold,
        target: 'inventory',
        message: `「${name}」库存 ${qty}，低于安全库存 ${threshold}`
      });
    }
  });

  // 2. 生产逾期预警（交期已过未完成）
  (data.planOrders || []).forEach(po => {
    if (po.status === 'completed' || po.status === 'cancelled') return;
    const end = po.endDate ? new Date(po.endDate + 'T23:59:59') : null;
    if (end && end < now) {
      const overdueDays = Math.ceil((now - end) / 86400000);
      alerts.push({
        type: 'overdue',
        level: 'danger',
        title: '生产逾期',
        planOrderId: po.id,
        orderNo: po.orderNo,
        productName: po.productName || po.productModel || '',
        dueDate: po.endDate,
        overdueDays,
        target: 'production',
        message: `生产单 ${po.orderNo} 已逾期 ${overdueDays} 天仍未完成`
      });
    }
  });

  // 3. 临近交期预警（3天内到期）
  (data.planOrders || []).forEach(po => {
    if (po.status === 'completed' || po.status === 'cancelled') return;
    const end = po.endDate ? new Date(po.endDate + 'T23:59:59') : null;
    if (end && end >= now) {
      const daysLeft = Math.ceil((end - now) / 86400000);
      if (daysLeft <= 3) {
        alerts.push({
          type: 'due_soon',
          level: 'info',
          title: '临近交期',
          planOrderId: po.id,
          orderNo: po.orderNo,
          productName: po.productName || '',
          daysLeft,
          dueDate: po.endDate,
          target: 'production',
          message: `生产单 ${po.orderNo} 将在 ${daysLeft} 天后到期，请关注进度`
        });
      }
    }
  });

  // 4. 待审核销售订单
  const pendingApproval = (data.salesOrders || []).filter(o => o.status === 'pending');
  if (pendingApproval.length > 0) {
    alerts.push({
      type: 'pending_approval',
      level: 'info',
      title: '待审核订单',
      count: pendingApproval.length,
      target: 'sales',
      message: `有 ${pendingApproval.length} 个销售订单待审核`
    });
  }

  // 5. 生产积压：已进入生产但无进行中计划单
  const activePlanOrderIds = new Set((data.planOrders || []).filter(p => p.status !== 'cancelled').map(p => p.orderId));
  const stuckOrders = (data.salesOrders || []).filter(o => o.status === 'in_production' && !activePlanOrderIds.has(o.id));
  if (stuckOrders.length > 0) {
    alerts.push({
      type: 'stuck_production',
      level: 'warning',
      title: '生产待安排',
      count: stuckOrders.length,
      target: 'production',
      message: `${stuckOrders.length} 个订单已进入生产但未安排计划单，请尽快排产`
    });
  }

  alerts.sort((a, b) => (rank[a.level] ?? 2) - (rank[b.level] ?? 2));
  res.json({ count: alerts.length, alerts });
});

// ==================== 站内消息与待办提醒 API ====================
// 重新生成当前活跃的待办通知，与已读状态合并；已解决的问题自动从已读记录中清理
function genNotifications() {
  const now = new Date();
  const items = [];
  const readMap = new Map((Array.isArray(data.notifications) ? data.notifications : []).map(n => [n.key, n]));

  // 低库存
  (data.inventory || []).forEach(inv => {
    const product = data.products.find(p => String(p.id) === String(inv.productId));
    const qty = Number(inv.quantity) || 0;
    const threshold = Number(inv.minStock) > 0 ? Number(inv.minStock) : (Number(product && product.minStock) || 0);
    if (threshold > 0 && qty <= threshold) {
      const name = (product && (product.name || product.type)) || inv.productName || inv.productId;
      items.push({
        key: 'low_stock:' + inv.productId, type: 'low_stock', level: qty === 0 ? 'danger' : 'warning',
        title: '库存不足', message: `「${name}」库存 ${qty}，低于安全库存 ${threshold}`,
        target: 'inventory', link: { page: 'materials', sub: 'warehouse-list' }, createdAt: now.toISOString()
      });
    }
  });

  // 生产逾期 / 临近交期
  (data.planOrders || []).forEach(po => {
    if (po.status === 'completed' || po.status === 'cancelled') return;
    const end = po.endDate ? new Date(po.endDate + 'T23:59:59') : null;
    if (!end) return;
    const days = Math.ceil((end - now) / 86400000);
    const pn = po.productName || po.productModel || po.orderNo;
    if (days < 0) {
      items.push({
        key: 'overdue:' + po.id, type: 'overdue', level: 'danger', title: '生产逾期',
        message: `生产单 ${po.orderNo}（${pn}）已逾期 ${Math.abs(days)} 天仍未完成`,
        target: 'production', link: { page: 'production', sub: '' }, createdAt: now.toISOString()
      });
    } else if (days <= 3) {
      items.push({
        key: 'due_soon:' + po.id, type: 'due_soon', level: 'info', title: '临近交期',
        message: `生产单 ${po.orderNo}（${pn}）将在 ${days} 天后到期`,
        target: 'production', link: { page: 'production', sub: '' }, createdAt: now.toISOString()
      });
    }
  });

  // 待审核销售订单
  const pendingApproval = (data.salesOrders || []).filter(o => o.status === 'pending');
  if (pendingApproval.length) {
    items.push({
      key: 'pending_approval', type: 'pending_approval', level: 'info', title: '待审核订单',
      message: `有 ${pendingApproval.length} 个销售订单待审核`, count: pendingApproval.length,
      target: 'sales', link: { page: 'sales', sub: '' }, createdAt: now.toISOString()
    });
  }

  // 采购单待收货
  const pendingPO = (data.purchaseOrders || []).filter(o => o.status === 'pending');
  if (pendingPO.length) {
    items.push({
      key: 'pending_purchase', type: 'pending_purchase', level: 'warning', title: '采购待收货',
      message: `有 ${pendingPO.length} 个采购单待收货`, count: pendingPO.length,
      target: 'purchase', link: { page: 'purchase', sub: '' }, createdAt: now.toISOString()
    });
  }

  // 余货调换/审批待办
  const pendingExchange = (data.exchangeRecords || []).filter(o => o.status === 'pending');
  if (pendingExchange.length) {
    items.push({
      key: 'pending_exchange', type: 'pending_exchange', level: 'warning', title: '调换货待审核',
      message: `有 ${pendingExchange.length} 个调换货申请待审核`, count: pendingExchange.length,
      target: 'exchange', link: { page: 'sales', sub: 'exchange' }, createdAt: now.toISOString()
    });
  }

  const rank = { danger: 0, warning: 1, info: 2 };
  items.sort((a, b) => (rank[a.level] ?? 2) - (rank[b.level] ?? 2));

  // 已读记录只保留仍活跃的项，已解决的问题移除
  const activeKeys = new Set(items.map(i => i.key));
  const pruned = (Array.isArray(data.notifications) ? data.notifications : []).filter(n => activeKeys.has(n.key));
  const changed = pruned.length !== (Array.isArray(data.notifications) ? data.notifications.length : 0);
  data.notifications = pruned;
  if (changed) saveData();

  const readStatus = new Set(data.notifications.map(n => n.key));
  const out = items.map(i => ({ ...i, read: readStatus.has(i.key) }));
  return { count: out.length, unread: out.filter(i => !i.read).length, items: out };
}

app.get('/api/notifications', (req, res) => {
  res.json(genNotifications());
});

app.post('/api/notifications/read', (req, res) => {
  genNotifications(); // 先清理已解决项，保证只标记当前活跃项
  const keys = req.body && req.body.all ? null : (Array.isArray(req.body.keys) ? req.body.keys : []);
  const existing = new Set(data.notifications.map(n => n.key));
  const push = k => { if (!existing.has(k)) { data.notifications.push({ key: k, readAt: new Date().toISOString() }); existing.add(k); } };
  if (keys === null) {
    genNotifications().items.forEach(i => push(i.key));
  } else {
    keys.forEach(push);
  }
  saveData();
  res.json(genNotifications());
});

// ===== 数据备份：手动备份 + 备份列表（管理员） =====
app.get('/api/admin/backups', requireAdmin, (req, res) => {
  res.json({ success: true, backups: listBackups() });
});

app.post('/api/admin/backup', requireAdmin, (req, res) => {
  // 先落盘当前数据（确保未排队写入也被持久化），再快照
  saveData().then(() => {
    const result = createBackup();
    if (!result.ok) {
      return res.status(500).json({ success: false, message: '备份失败：' + result.error });
    }
    logAudit('数据备份', `手动创建备份 ${result.file}`, req.user && (req.user.name || req.user.username));
    res.json({ success: true, message: '备份成功', file: result.file, backups: listBackups() });
  });
});

// ==================== 智能采购建议 API ====================
app.get('/api/purchase-suggestions', (req, res) => {
  const suggestions = [];
  const demandMap = new Map();

  // 汇总未完成销售订单的产品需求
  (data.salesOrders || []).forEach(o => {
    if (['pending', 'approved', 'in_production', 'allocated'].includes(o.status)) {
      (o.items || []).forEach(item => {
        const pid = item.productId || item.product_id;
        if (!pid) return;
        const qty = Number(item.quantity) || 0;
        demandMap.set(pid, (demandMap.get(pid) || 0) + qty);
      });
    }
  });

  const seen = new Set();
  // 库存商品：计算建议补货量
  (data.inventory || []).forEach(inv => {
    const product = data.products.find(p => String(p.id) === String(inv.productId));
    if (!product) return;
    const current = Number(inv.quantity) || 0;
    const min = Number(inv.minStock) > 0 ? Number(inv.minStock) : (Number(product.minStock) || 0);
    const demand = demandMap.get(inv.productId) || 0;
    const available = current - demand;
    const suggested = Math.max(0, min - available);
    if (suggested > 0 || available < 0) {
      seen.add(inv.productId);
      suggestions.push({
        productId: inv.productId,
        productName: product.name || product.type || inv.productName || '',
        model: product.model || inv.productModel || '',
        current,
        minStock: min,
        pendingDemand: demand,
        availableAfterDemand: available,
        suggestedQty: suggested,
        reason: available < 0 ? '有未满足的订单需求' : '低于安全库存'
      });
    }
  });

  // 有需求但完全没有库存记录的产品
  demandMap.forEach((demand, pid) => {
    if (seen.has(pid)) return;
    const product = data.products.find(p => String(p.id) === String(pid));
    const current = Number(product?.stock) || 0;
    const available = current - demand;
    const suggested = Math.max(0, -available);
    if (suggested > 0) {
      suggestions.push({
        productId: pid,
        productName: product?.name || product?.type || '',
        model: product?.model || '',
        current,
        minStock: 0,
        pendingDemand: demand,
        availableAfterDemand: available,
        suggestedQty: suggested,
        reason: '有未满足的订单需求'
      });
    }
  });

  suggestions.sort((a, b) => b.suggestedQty - a.suggestedQty);
  res.json({ count: suggestions.length, suggestions });
});

// ==================== 智能派工建议 API ====================
app.get('/api/dispatch-suggestions', (req, res) => {
  // 智能派工算法：统计每个执行人的在制(active)、待处理(pending)、已完成(done)工序量
  // 进行中工序负担更重(权重2)，待处理权重1；推荐评分最低（最空闲）的人。
  const workloadMap = new Map();
  (data.processes || []).forEach(p => {
    if (!p.assignee) return;
    const w = workloadMap.get(p.assignee) || { active: 0, pending: 0, total: 0, done: 0 };
    w.total += 1;
    if (p.status === 'in_progress') w.active += 1;
    else if (p.status === 'pending') w.pending += 1;
    else if (p.status === 'completed' || p.status === 'done') w.done += 1;
    workloadMap.set(p.assignee, w);
  });
  const workload = Array.from(workloadMap.entries())
    .map(([name, w]) => {
      const score = w.active * 2 + w.pending;
      return { name, active: w.active, pending: w.pending, total: w.total, done: w.done, busyRate: w.total ? Number((score / 10).toFixed(2)) : 0, score };
    })
    .sort((a, b) => a.score - b.score || a.total - b.total);
  const recommended = workload.length > 0 ? workload[0].name : '';
  res.json({ recommended, workload });
});

// ==================== 审计日志 & 健康检查 API ====================
app.get('/api/audit-logs', (req, res) => {
  const qOp = String(req.query.operator || '').trim();
  const qKeyword = String(req.query.q || '').trim();
  const qAction = String(req.query.action || '').trim();
  const start = req.query.start ? Date.parse(req.query.start) : null;
  const end = req.query.end ? Date.parse(req.query.end) : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(Number(req.query.pageSize) || 50, 500);

  const filtered = (data.auditLogs || []).filter(log => {
    if (qOp && !String(log.operator || '').includes(qOp)) return false;
    if (qAction && !String(log.action || '').includes(qAction)) return false;
    if (qKeyword) {
      const hay = String(log.action || '') + String(log.detail || '') + String(log.operator || '');
      if (!hay.includes(qKeyword)) return false;
    }
    const t = log.createdAt ? Date.parse(log.createdAt) : null;
    if (start && (!t || t < start)) return false;
    if (end && (!t || t > end)) return false;
    return true;
  }).reverse();

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const logs = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (req.query.page !== undefined && req.query.page != null) {
    // 分页模式
    return res.json({ success: true, total, page: safePage, pageSize, pageCount, logs });
  }
  // 兼容旧调用：直接返回日志数组
  res.json(logs);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    counts: {
      products: (data.products || []).length,
      salesOrders: (data.salesOrders || []).length,
      planOrders: (data.planOrders || []).length,
      processes: (data.processes || []).length,
      users: (data.users || []).length,
      auditLogs: (data.auditLogs || []).length
    }
  });
});

// ==================== 统一错误处理 & 404 ====================
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在', path: req.path });
  }
  next();
});

// 统一接口错误提示：JSON 解析失败返回 400；业务异常返回 500 且不泄露内部细节
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('Unhandled server error:', err);
  if (status === 400) {
    return res.status(400).json({ success: false, error: '请求格式错误', message: '请求体不是合法的 JSON 数据' });
  }
  res.status(500).json({ success: false, error: '服务器内部错误', message: '服务器处理请求时发生异常，请稍后重试' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Full-stack Inventory Management System is ready!');
  createBackup();
  // 每日自动备份（保留最近 N 份）
  setInterval(() => {
    createBackup();
  }, 24 * 60 * 60 * 1000).unref();
});
