'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { verifyPassword, hashPassword, newToken } = require('./crypto');
const S = require('./services');
const F = require('./finance');
const M = require('./maintenance');

const PUBLIC = path.join(__dirname, '..', 'public');
const SESSION_HOURS = 12;
const MGR = 'WAREHOUSE_MANAGER', BR = 'BRANCH', ACC = 'ACCOUNTANT', DRV = 'DRIVER', CFO = 'CFO', SUP = 'MAINT_SUPERVISOR', TEC = 'TECHNICIAN';

// ───── tiny router ─────
const routes = [];
function route(method, pattern, roles, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, roles, handler });
}

// Public
route('POST', '/api/login', null, ({ db, body, res }) => {
  const u = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(body.email || '').trim());
  if (!u || !verifyPassword(body.password || '', u.password_hash)) throw new S.AppError(401, 'Wrong email or password');
  const token = newToken();
  const exp = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, u.id, exp);
  res.setHeader('Set-Cookie', `wms_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
  return publicUser(db, u);
});
route('POST', '/api/logout', [], ({ db, token, res }) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', 'wms_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return { ok: true };
});
route('GET', '/api/me', [], ({ db, user }) => ({ ...publicUser(db, user), today: S.today() }));
route('POST', '/api/me/password', [], ({ db, user, body }) => {
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
  if (!verifyPassword(body.current_password || '', u.password_hash)) throw new S.AppError(400, 'Current password is wrong');
  const pw = String(body.new_password || '');
  if (pw.length < 8) throw new S.AppError(400, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(pw), user.id);
  return { ok: true };
});

// Shared reference data
route('GET', '/api/sources', [BR, MGR, ACC, CFO], ({ db }) => S.listSources(db));
route('GET', '/api/items', [BR, MGR, ACC, CFO], ({ db, user, query }) => (
  user.role === BR ? S.listItems(db, { warehouse_id: Number(query.source) || 1, orderableOnly: true })
    : user.role === MGR ? S.listItems(db, { warehouse_id: user.warehouse_id || 1 })
      : S.listItems(db)));
route('GET', '/api/branches', [MGR, ACC, CFO], ({ db, query }) => S.listBranches(db, { withRoutes: query.routes === '1' }));
route('GET', '/api/orders', [BR, MGR, ACC, CFO], ({ db, user, query }) => S.listOrders(db, user, query));
route('GET', '/api/orders/:id', [BR, MGR, ACC, CFO], ({ db, user, params }) => S.getOrder(db, user, params.id));

// Branch
route('GET', '/api/branch/home', [BR], ({ db, user }) => S.branchHome(db, user));
route('GET', '/api/branch/order', [BR], ({ db, user, query }) => S.branchOrderForDate(db, user, branchDate(query.date), query.source));
route('PUT', '/api/branch/order', [BR], ({ db, user, body }) => S.saveBranchOrder(db, user, body.order_id ? { ...body, date: undefined } : { ...body, date: branchDate(body.date) }));
route('GET', '/api/branch/new-order', [BR], ({ db, user, query }) => S.newOrderInfo(db, user, query.source));

// Branches may order for today or up to 7 days ahead — never for a past date.
function branchDate(d) {
  const t = S.today();
  if (!d) return t;
  const max = new Date(t + 'T00:00:00Z'); max.setUTCDate(max.getUTCDate() + 7);
  if (typeof d !== 'string' || d < t || d > max.toISOString().slice(0, 10)) throw new S.AppError(400, 'Orders can be placed for today or up to 7 days ahead');
  return d;
}
route('POST', '/api/branch/orders/:id/receive', [BR], ({ db, user, params, body }) => S.confirmReceiving(db, user, params.id, body));

// Warehouse manager
route('GET', '/api/manager/home', [MGR], ({ db, user }) => S.managerHome(db, user));
route('POST', '/api/orders/:id/accept', [MGR], ({ db, user, params, body }) => S.acceptOrder(db, user, params.id, body));
route('POST', '/api/orders/:id/reject', [MGR], ({ db, user, params, body }) => S.rejectOrder(db, user, params.id, body));
route('POST', '/api/orders/:id/assign', [MGR], ({ db, user, params, body }) => S.assignOrder(db, user, params.id, body));
route('POST', '/api/dispatch', [MGR], ({ db, user, body }) => S.dispatch(db, user, body));
route('GET', '/api/picking', [MGR], ({ db, user, query }) => S.picking(db, user, query.date || S.today()));
route('POST', '/api/picking/apply-defaults', [MGR], ({ db, user, body }) => S.applyDefaultRoutes(db, user, body.date || S.today()));
route('GET', '/api/drivers', [MGR, 'MAINT_SUPERVISOR'], ({ db }) => S.listDrivers(db));
route('POST', '/api/drivers', [MGR], ({ db, user, body }) => S.addDriver(db, user, body));
route('GET', '/api/drivers/:id/tasks', [MGR], ({ db, user, params }) => { whOnly(user); return S.listTasks(db, user, { driver_id: params.id }); });
route('PUT', '/api/branches/:id/route', [MGR], ({ db, user, params, body }) => S.setBranchRoute(db, user, params.id, body));
route('GET', '/api/suppliers', [MGR], ({ db }) => S.listSuppliers(db));
route('GET', '/api/supplier-receipts', [MGR], ({ db, user, query }) => S.listReceipts(db, user, query));
route('POST', '/api/supplier-receipts', [MGR], ({ db, user, body }) => S.supplierReceipt(db, user, body));
route('GET', '/api/inventory', [MGR], ({ db, user }) => S.inventory(db, user));
route('PUT', '/api/items/:id/reorder', [MGR], ({ db, user, params, body }) => S.setReorderLevel(db, user, params.id, body));
route('GET', '/api/reorder-count', [MGR], ({ db, user }) => ({ count: S.managerHome(db, user).counts.to_reorder }));
route('PUT', '/api/items/:id/unit', [MGR], ({ db, user, params, body }) => S.setItemUnit(db, user, params.id, body));
route('GET', '/api/inventory/:id', [MGR], ({ db, user, params }) => S.itemLedger(db, user, params.id));
route('GET', '/api/stock-counts', [MGR], ({ db, user }) => S.listStockCounts(db, user));
route('GET', '/api/production', [MGR], ({ db, user }) => S.listProduction(db, user));
route('POST', '/api/production', [MGR], ({ db, user, body }) => S.recordProduction(db, user, body));
route('POST', '/api/stock-counts', [MGR], ({ db, user, body }) => S.confirmStockCount(db, user, body));

// Driver
route('GET', '/api/driver/route', [DRV], ({ db, user }) => S.driverRoute(db, user));
route('POST', '/api/driver/pickup', [DRV], ({ db, user, body }) => S.driverPickup(db, user, body));
route('POST', '/api/driver/orders/:id/delivered', [DRV], ({ db, user, params }) => S.driverDeliver(db, user, params.id));
route('GET', '/api/driver/tasks', [DRV], ({ db, user }) => S.listTasks(db, user));
route('POST', '/api/driver/tasks/:id/done', [DRV], ({ db, user, params, body }) => S.completeTask(db, user, params.id, body));

// Driver tracking & tasks (warehouse manager)
const whOnly = (user) => { if ((user.warehouse_id || 1) !== 1) throw new S.AppError(403, 'Driver tracking is managed by the warehouse manager'); };
route('GET', '/api/drivers/stats', [MGR], ({ db, user, query }) => { whOnly(user); return S.driverStats(db, user, query); });
route('GET', '/api/drivers/:id/profile', [MGR], ({ db, user, params, query }) => { whOnly(user); return S.driverProfile(db, user, params.id, query); });
route('PUT', '/api/drivers/:id', [MGR], ({ db, user, params, body }) => { whOnly(user); return S.updateDriver(db, user, params.id, body); });
route('POST', '/api/tasks', [MGR], ({ db, user, body }) => S.createTask(db, user, body));
route('POST', '/api/tasks/:id/cancel', [MGR], ({ db, user, params }) => S.cancelTask(db, user, params.id));

// Accountant (manager can view too)
route('GET', '/api/reports/accepted', [ACC, MGR, CFO], ({ db, user, query }) => F.valueAcceptedReport(db, user, S.acceptedReport(db, user, query)));

// Accounts (accountant writes; CFO reads) — role checks are repeated inside finance.js
const FIN = [ACC, CFO];
route('GET', '/api/finance/home', FIN, ({ db, user }) => F.financeHome(db, user));
route('GET', '/api/finance/company', [...FIN, MGR], ({ db }) => F.getCompany(db));
route('PUT', '/api/finance/company', [ACC], ({ db, user, body }) => F.setCompany(db, user, body));
route('GET', '/api/finance/suppliers', FIN, ({ db, user }) => F.listSuppliersFull(db, user));
route('POST', '/api/finance/suppliers', [ACC], ({ db, user, body }) => F.saveSupplier(db, user, null, body));
route('PUT', '/api/finance/suppliers/:id', [ACC], ({ db, user, params, body }) => F.saveSupplier(db, user, params.id, body));
route('GET', '/api/finance/costs', FIN, ({ db, user, query }) => F.listItemCosts(db, user, query));
route('POST', '/api/finance/costs', [ACC], ({ db, user, body }) => F.setItemCosts(db, user, body));
route('GET', '/api/finance/costs/:id', FIN, ({ db, user, params }) => F.costHistory(db, user, params.id));
route('GET', '/api/finance/summary', FIN, ({ db, user, query }) => F.branchesSummary(db, user, query));
route('GET', '/api/finance/statement', FIN, ({ db, user, query }) => F.branchStatement(db, user, query));
route('GET', '/api/finance/stock-value', FIN, ({ db, user, query }) => F.stockValue(db, user, query));
route('GET', '/api/finance/invoices', FIN, ({ db, user, query }) => F.listSupplierInvoices(db, user, query));
route('GET', '/api/finance/invoices/:id', FIN, ({ db, user, params }) => F.getSupplierInvoice(db, user, params.id));
route('PUT', '/api/finance/invoices/:id', [ACC], ({ db, user, params, body }) => F.updateSupplierInvoice(db, user, params.id, body));
route('POST', '/api/finance/invoices/:id/check', [ACC], ({ db, user, params, body }) => F.setInvoiceMatched(db, user, params.id, body));
route('GET', '/api/finance/yield', FIN, ({ db, user, query }) => F.factoryYield(db, user, query));
route('GET', '/api/finance/periods', FIN, ({ db, user }) => F.listPeriods(db, user));
route('POST', '/api/finance/periods/lock', [ACC], ({ db, user, body }) => F.lockPeriod(db, user, body));
route('POST', '/api/finance/periods/unlock', [ACC], ({ db, user, body }) => F.unlockPeriod(db, user, body));
route('GET', '/api/finance/audit', FIN, ({ db, user, query }) => F.listAudit(db, user, query));
route('GET', '/api/finance/payable', [ACC], ({ db, user, query }) => F.payableReceipts(db, user, query));
route('GET', '/api/finance/payable-jobs', [ACC], ({ db, user, query }) => F.payableJobs(db, user, query));
route('GET', '/api/finance/requests', FIN, ({ db, user, query }) => F.listPaymentRequests(db, user, query));
route('POST', '/api/finance/requests', [ACC], ({ db, user, body }) => F.createPaymentRequest(db, user, body));
route('GET', '/api/finance/requests/:id', FIN, ({ db, user, params }) => F.getPaymentRequest(db, user, params.id));
route('POST', '/api/finance/requests/:id/cancel', [ACC], ({ db, user, params }) => F.cancelRequest(db, user, params.id));
route('POST', '/api/finance/requests/:id/approve', [CFO], ({ db, user, params }) => F.approveRequest(db, user, params.id));
route('POST', '/api/finance/requests/:id/reject', [CFO], ({ db, user, params, body }) => F.rejectRequest(db, user, params.id, body));
route('POST', '/api/finance/requests/:id/paid', [CFO], ({ db, user, params, body }) => F.markPaid(db, user, params.id, body));
// Maintenance — role checks are repeated inside maintenance.js (location scoping, supervisor-only actions)
const ANY = [BR, MGR, DRV, SUP, TEC, ACC, CFO];
const REQ = [BR, MGR, DRV, SUP];
const SEE = [SUP, ACC, CFO];
route('GET', '/api/maint/meta', ANY, ({ db, user }) => M.meta(db, user));
route('GET', '/api/maint/home', SEE, ({ db, user }) => M.supervisorHome(db, user));
route('GET', '/api/maint/jobs', ANY, ({ db, user, query }) => M.listJobs(db, user, query));
route('POST', '/api/maint/jobs', REQ, ({ db, user, body }) => M.createJob(db, user, body));
route('GET', '/api/maint/jobs/:id', ANY, ({ db, user, params }) => M.getJob(db, user, params.id));
route('PUT', '/api/maint/jobs/:id', [SUP], ({ db, user, params, body }) => M.updateJob(db, user, params.id, body));
route('POST', '/api/maint/jobs/:id/note', [BR, MGR, DRV, SUP, TEC], ({ db, user, params, body }) => M.addNote(db, user, params.id, body));
route('POST', '/api/maint/jobs/:id/start', [SUP, TEC], ({ db, user, params }) => M.startJob(db, user, params.id));
route('POST', '/api/maint/jobs/:id/done', [SUP, TEC], ({ db, user, params, body }) => M.finishJob(db, user, params.id, body));
route('POST', '/api/maint/jobs/:id/close', [SUP], ({ db, user, params, body }) => M.closeJob(db, user, params.id, body));
route('POST', '/api/maint/jobs/:id/send-back', [SUP], ({ db, user, params, body }) => M.sendBack(db, user, params.id, body));
route('POST', '/api/maint/jobs/:id/reject', [SUP], ({ db, user, params, body }) => M.rejectJob(db, user, params.id, body));
route('POST', '/api/maint/jobs/:id/cancel', REQ, ({ db, user, params, body }) => M.cancelJob(db, user, params.id, body));
route('PUT', '/api/maint/jobs/:id/cost', [SUP, ACC], ({ db, user, params, body }) => M.setJobCost(db, user, params.id, body));
route('POST', '/api/maint/jobs/:id/check', [ACC], ({ db, user, params, body }) => M.checkJobBill(db, user, params.id, body));
route('GET', '/api/maint/schedules', SEE, ({ db, user }) => M.listSchedules(db, user));
route('POST', '/api/maint/schedules', [SUP], ({ db, user, body }) => M.saveSchedule(db, user, null, body));
route('PUT', '/api/maint/schedules/:id', [SUP], ({ db, user, params, body }) => M.saveSchedule(db, user, params.id, body));
route('GET', '/api/maint/documents', SEE, ({ db, user }) => M.listDocuments(db, user));
route('POST', '/api/maint/documents', [SUP], ({ db, user, body }) => M.saveDocument(db, user, null, body));
route('PUT', '/api/maint/documents/:id', [SUP], ({ db, user, params, body }) => M.saveDocument(db, user, params.id, body));
route('POST', '/api/maint/documents/:id/renew', [SUP], ({ db, user, params, body }) => M.renewDocument(db, user, params.id, body));
route('POST', '/api/maint/documents/:id/job', [SUP], ({ db, user, params, body }) => M.renewalJob(db, user, params.id, body));
route('GET', '/api/maint/assets', SEE, ({ db, user }) => M.listAssets(db, user));
route('POST', '/api/maint/assets', [SUP], ({ db, user, body }) => M.saveAsset(db, user, null, body));
route('PUT', '/api/maint/assets/:id', [SUP], ({ db, user, params, body }) => M.saveAsset(db, user, params.id, body));
route('GET', '/api/maint/technicians', SEE, ({ db, user }) => M.listTechnicians(db, user));
route('POST', '/api/maint/technicians', [SUP], ({ db, user, body }) => M.addTechnician(db, user, body));
route('PUT', '/api/maint/technicians/:id', [SUP], ({ db, user, params, body }) => M.setTechnicianActive(db, user, params.id, body));
route('GET', '/api/maint/costs', SEE, ({ db, user, query }) => M.costReport(db, user, query));
route('GET', '/api/maint/bills', SEE, ({ db, user, query }) => M.contractorBills(db, user, query));

function publicUser(db, u) {
  const b = u.branch_id ? db.prepare('SELECT branch_code, branch_name FROM branches WHERE id=?').get(u.branch_id) : null;
  const w = u.role === MGR ? db.prepare('SELECT id, name, code FROM warehouses WHERE id=?').get(u.warehouse_id || 1) : null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, branch_id: u.branch_id, branch_name: b?.branch_name ?? null,
    warehouse_id: w?.id ?? null, warehouse_name: w?.name ?? null, warehouse_code: w?.code ?? null, driver_id: u.driver_id ?? null };
}

function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new S.AppError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new S.AppError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html'); // SPA fallback
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function createServer({ dbFile }) {
  const { db, seeded, migrated } = openDb(dbFile);
  const tick = () => { try { M.generateDue(db); } catch (e) { console.error('Maintenance schedule check failed:', e.message); } };
  tick();
  const timer = setInterval(tick, 3600e3);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      let match, params = {};
      const r = routes.find((x) => x.method === req.method && (match = x.re.exec(url.pathname)));
      if (!r) return send(404, { error: 'Not found' });
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(match[i + 1]); });

      if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) {
        throw new S.AppError(415, 'Content-Type must be application/json'); // blocks cross-site form posts
      }
      const token = cookie(req, 'wms_session');
      let user = null;
      if (r.roles !== null) {
        const s = token && db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token=? AND s.expires_at > ? AND u.active=1`).get(token, new Date().toISOString());
        if (!s) throw new S.AppError(401, 'Please sign in');
        if (r.roles.length && !r.roles.includes(s.role)) throw new S.AppError(403, 'You do not have access to this');
        user = s;
      }
      const body = req.method === 'GET' ? {} : await readBody(req);
      const query = Object.fromEntries(url.searchParams);
      const out = r.handler({ db, user, body, query, params, token, req, res });
      send(200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof S.AppError) return send(e.status, { error: e.message });
      if (/CHECK constraint|FOREIGN KEY/.test(e.message)) return send(400, { error: 'Invalid data' });
      console.error(e);
      send(500, { error: 'Unexpected server error' });
    }
  });
  return { server, db, seeded, migrated };
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'wms.db');
  const { server, seeded, migrated } = createServer({ dbFile });
  server.listen(port, () => {
    console.log(`SpicyMeal WMS running on http://localhost:${port}`);
    if (seeded) console.log('Database created and master data loaded (warehouse: 83 items, factory: 36 items, 17 branches). See README for logins.');
    if (migrated) console.log('Database upgraded: factory added. Existing data kept.');
  });
}
