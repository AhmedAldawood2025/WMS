'use strict';
// Business rules for SpicyMeal WMS. HTTP-agnostic: every function takes (db, user, input).

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new AppError(400, m);
const notFound = (m = 'Not found') => new AppError(404, m);
const conflict = (m) => new AppError(409, m);

const TZ = 'Asia/Riyadh';
const DEFAULT_WH = 1;
const COMMITTED = ['ACCEPTED', 'ASSIGNED', 'DISPATCHED', 'RECEIVED'];
const MAX_QTY = 1_000_000;

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const now = () => new Date().toISOString();

function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)); }
function reqDate(s, field = 'date') { if (!isDate(s)) throw bad(`Invalid ${field}`); return s; }
function qty(v, field = 'quantity') {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw bad(`Invalid ${field}: ${v}`);
  return n;
}
function id(v, field = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`Invalid ${field}`);
  return n;
}
function arr(v, field = 'lines') { if (!Array.isArray(v)) throw bad(`${field} must be a list`); return v; }
const IN = (a) => a.map(() => '?').join(',');

// ───── money: stored as integer halalas (1 SAR = 100) ─────
function money(v, field = 'price') {
  if (v === '' || v === null || v === undefined) return null;
  const s = String(v).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad(`Invalid ${field}: ${v} (use SAR, up to 2 decimals)`);
  const [w, f = ''] = s.split('.');
  const h = Number(w) * 100 + Number((f + '00').slice(0, 2));
  if (h > 100_000_000_00) throw bad(`${field} is too large`);
  return h;
}

// ───── change log (append-only) ─────
function audit(db, user, action, entity, entityId, summary, details) {
  db.prepare('INSERT INTO audit_log (at, user_id, action, entity, entity_id, summary, details) VALUES (?,?,?,?,?,?,?)')
    .run(now(), user?.id ?? null, action, entity, entityId ?? null, String(summary).slice(0, 500), details === undefined ? null : JSON.stringify(details));
}

// ───── month-end lock: no quantity / stock / price changes dated in a locked month ─────
function isLocked(db, date) {
  return !!db.prepare('SELECT 1 FROM periods WHERE month=? AND locked=1').get(String(date).slice(0, 7));
}
function assertOpen(db, date) {
  if (isLocked(db, date)) throw conflict(`${String(date).slice(0, 7)} is closed by accounts (month-end lock) — changes for that month are not allowed`);
}

// ───────────────────────── inventory ledger ─────────────────────────

// Each item belongs to exactly one source (warehouse or factory), so stock is simply the item's ledger sum.
function stockOf(db, itemId) {
  return db.prepare('SELECT COALESCE(SUM(direction*quantity),0) s FROM inventory_transactions WHERE item_id=?').get(itemId).s;
}

function stockMap(db, whId) {
  const m = new Map();
  const rows = whId
    ? db.prepare('SELECT item_id, SUM(direction*quantity) s FROM inventory_transactions WHERE warehouse_id=? GROUP BY item_id').all(whId)
    : db.prepare('SELECT item_id, SUM(direction*quantity) s FROM inventory_transactions GROUP BY item_id').all();
  for (const r of rows) m.set(r.item_id, r.s);
  return m;
}

// ───── sources (warehouse / factory) ─────
// A manager works on exactly one source; branches and accountants can see all.
const whOf = (user) => user.warehouse_id || DEFAULT_WH;
const isMgr = (user) => user.role === 'WAREHOUSE_MANAGER';

function listSources(db) {
  return db.prepare('SELECT id, name, code FROM warehouses WHERE active=1 ORDER BY id').all();
}
function sourceId(db, v) {
  const n = v === undefined || v === null || v === '' ? DEFAULT_WH : id(v, 'source');
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(n)) throw bad('Unknown source');
  return n;
}
function requireOwnItem(user, item) {
  if (!item || (isMgr(user) && item.warehouse_id !== whOf(user))) throw notFound('Item not found');
  return item;
}

function post(db, user, { itemId, type, delta, refType, refId, branchId = null, note = null }) {
  if (!delta) return;
  db.prepare(`INSERT INTO inventory_transactions
    (item_id, transaction_type, quantity, direction, reference_type, reference_id, warehouse_id, branch_id, note, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(itemId, type, Math.abs(delta), delta > 0 ? 1 : -1, refType, refId,
      db.prepare('SELECT warehouse_id FROM items WHERE id=?').get(itemId).warehouse_id, branchId, note, user.id, now());
}

function itemsById(db) {
  const m = new Map();
  for (const r of db.prepare('SELECT * FROM items').all()) m.set(r.id, r);
  return m;
}

function listItems(db, { warehouse_id, orderableOnly = false } = {}) {
  return db.prepare(`SELECT id, item_code, item_name, item_name_ar, category, unit, warehouse_id, orderable, reorder_level FROM items
    WHERE active=1 ${warehouse_id ? 'AND warehouse_id=?' : ''} ${orderableOnly ? 'AND orderable=1' : ''}
    ORDER BY warehouse_id, sort_order, item_code`).all(...(warehouse_id ? [warehouse_id] : []));
}

function setItemUnit(db, user, itemId, { unit }) {
  const u = String(unit || '').trim();
  if (!u || u.length > 30) throw bad('Unit is required (max 30 characters)');
  itemId = id(itemId);
  requireOwnItem(user, db.prepare('SELECT * FROM items WHERE id=?').get(itemId));
  const before = db.prepare('SELECT item_code, unit FROM items WHERE id=?').get(itemId);
  db.prepare('UPDATE items SET unit=? WHERE id=?').run(u, itemId);
  if (before.unit !== u) audit(db, user, 'ITEM_UNIT', 'item', itemId, `${before.item_code} unit ${before.unit} → ${u}`);
  return { ok: true, unit: u };
}

// Reorder level: when stock falls to this number or below, the item needs to be ordered. null = no alert.
function setReorderLevel(db, user, itemId, { reorder_level }) {
  itemId = id(itemId);
  requireOwnItem(user, db.prepare('SELECT * FROM items WHERE id=?').get(itemId));
  const v = reorder_level === '' || reorder_level === null || reorder_level === undefined ? null : qty(reorder_level, 'reorder level');
  const before = db.prepare('SELECT item_code, reorder_level FROM items WHERE id=?').get(itemId);
  db.prepare('UPDATE items SET reorder_level=? WHERE id=?').run(v, itemId);
  if (before.reorder_level !== v) audit(db, user, 'REORDER_LEVEL', 'item', itemId, `${before.item_code} reorder level ${before.reorder_level ?? '—'} → ${v ?? '—'}`);
  return { ok: true, reorder_level: v };
}

const needsReorder = (stock, level) => level !== null && level !== undefined && stock <= level;

function inventory(db, user) {
  const wh = whOf(user);
  const stock = stockMap(db, wh);
  const last = new Map(db.prepare('SELECT item_id, MAX(created_at) t FROM inventory_transactions WHERE warehouse_id=? GROUP BY item_id').all(wh).map((r) => [r.item_id, r.t]));
  return listItems(db, { warehouse_id: wh }).map((i) => {
    const st = stock.get(i.id) ?? 0;
    return { ...i, stock: st, last_movement: last.get(i.id) ?? null, needs_reorder: needsReorder(st, i.reorder_level) };
  });
}

function itemLedger(db, user, itemId) {
  const item = requireOwnItem(user, db.prepare('SELECT id, item_code, item_name, item_name_ar, category, unit, warehouse_id, reorder_level FROM items WHERE id=?').get(id(itemId)));
  const rows = db.prepare(`
    SELECT t.id, t.created_at, t.transaction_type, t.quantity, t.direction, t.reference_type, t.reference_id, t.note,
           b.branch_name, u.name AS created_by_name,
           CASE WHEN t.reference_type='SUPPLIER_RECEIPT' THEN (SELECT s.supplier_name FROM supplier_receipts r JOIN suppliers s ON s.id=r.supplier_id WHERE r.id=t.reference_id) END AS supplier_name
    FROM inventory_transactions t
    LEFT JOIN branches b ON b.id=t.branch_id
    JOIN users u ON u.id=t.created_by
    WHERE t.item_id=? ORDER BY t.id`).all(item.id);
  let bal = 0;
  for (const r of rows) { bal += r.direction * r.quantity; r.balance = bal; }
  return { item, stock: bal, transactions: rows.reverse() };
}

// ───────────────────────── orders ─────────────────────────

function orderHeader(db, orderId) {
  return db.prepare(`
    SELECT o.*, b.branch_name, b.branch_code, w.name AS source_name, w.code AS source_code,
           ua.name AS accepted_by_name, uc.name AS created_by_name,
           da.driver_id, da.sequence, d.name AS driver_name,
           udisp.name AS dispatched_by_name, udel.name AS delivered_by_name,
           r.received_at, ur.name AS received_by_name, r.notes AS receiving_notes
    FROM orders o JOIN branches b ON b.id=o.branch_id JOIN warehouses w ON w.id=o.warehouse_id
    LEFT JOIN users ua ON ua.id=o.accepted_by
    LEFT JOIN users uc ON uc.id=o.created_by
    LEFT JOIN driver_assignments da ON da.order_id=o.id
    LEFT JOIN drivers d ON d.id=da.driver_id
    LEFT JOIN receivings r ON r.order_id=o.id
    LEFT JOIN users ur ON ur.id=r.received_by
    LEFT JOIN users udisp ON udisp.id=o.dispatched_by
    LEFT JOIN users udel ON udel.id=o.delivered_by
    WHERE o.id=?`).get(orderId);
}

function orderLines(db, orderId) {
  return db.prepare(`
    SELECT oi.item_id, i.item_code, i.item_name, i.item_name_ar, i.category, i.unit, i.reorder_level,
           oi.requested_quantity, oi.accepted_quantity,
           ri.received_quantity
    FROM order_items oi JOIN items i ON i.id=oi.item_id
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN receivings r ON r.order_id=o.id
    LEFT JOIN receiving_items ri ON ri.receiving_id=r.id AND ri.item_id=oi.item_id
    WHERE oi.order_id=? ORDER BY i.sort_order`).all(orderId);
}

function getOrder(db, user, orderId) {
  const o = orderHeader(db, id(orderId));
  if (!o) throw notFound('Order not found');
  if (user.role === 'BRANCH' && o.branch_id !== user.branch_id) throw notFound('Order not found');
  if (isMgr(user) && o.warehouse_id !== whOf(user)) throw notFound('Order not found');
  const lines = orderLines(db, o.id);
  const committed = COMMITTED.includes(o.status);
  if (user.role === 'BRANCH' && !committed) lines.forEach((l) => { l.accepted_quantity = null; });
  if (user.role === 'WAREHOUSE_MANAGER') {
    const stock = stockMap(db, o.warehouse_id);
    lines.forEach((l) => { l.stock = stock.get(l.item_id) ?? 0; });
  }
  const totals = lines.reduce((t, l) => ({
    requested: t.requested + l.requested_quantity,
    accepted: t.accepted + (l.accepted_quantity ?? 0),
    received: t.received + (l.received_quantity ?? 0),
  }), { requested: 0, accepted: 0, received: 0 });
  const discrepancies = o.status === 'RECEIVED'
    ? lines.filter((l) => (l.accepted_quantity ?? 0) !== (l.received_quantity ?? 0)).length : 0;
  return { ...o, lines, totals, discrepancies };
}

// Branch: fetch (or return empty shell for) the branch's order on a date
function branchOrderForDate(db, user, date, source) {
  reqDate(date);
  const wh = sourceId(db, source);
  const o = db.prepare('SELECT id FROM orders WHERE branch_id=? AND order_date=? AND warehouse_id=?').get(user.branch_id, date, wh);
  if (!o) return { id: null, order_date: date, warehouse_id: wh, status: null, lines: [] };
  return getOrder(db, user, o.id);
}

const OPEN = ['DRAFT', 'SUBMITTED']; // branch can still edit
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function openOrderFor(db, branchId, wh) {
  return db.prepare(`SELECT id, order_date, status FROM orders WHERE branch_id=? AND warehouse_id=? AND status IN ('DRAFT','SUBMITTED')
    ORDER BY order_date LIMIT 1`).get(branchId, wh);
}

// Branch: what happens when "Start new order" is pressed for a source.
function newOrderInfo(db, user, source) {
  const wh = sourceId(db, source);
  const open = openOrderFor(db, user.branch_id, wh);
  const t = today();
  const taken = new Set(db.prepare('SELECT order_date d FROM orders WHERE branch_id=? AND warehouse_id=? AND order_date BETWEEN ? AND ?')
    .all(user.branch_id, wh, t, addDays(t, 7)).map((r) => r.d));
  const free = [];
  for (let i = 0; i <= 7; i++) if (!taken.has(addDays(t, i))) free.push(addDays(t, i));
  return { source: db.prepare('SELECT id, name, code FROM warehouses WHERE id=?').get(wh), open_order: open || null, free_dates: free, suggested_date: free[0] || null };
}

// Branch: create or edit an order. Editing is allowed while DRAFT or SUBMITTED (until the manager accepts it).
// A new order for a source is refused while another order for that source is still open.
function saveBranchOrder(db, user, { order_id, date, lines, submit, source }) {
  const clean = new Map();
  for (const l of arr(lines)) {
    const q = qty(l.quantity);
    if (q > 0) clean.set(id(l.item_id, 'item'), q);
  }
  const items = itemsById(db);

  return db.tx(() => {
    let o;
    if (order_id) {
      o = db.prepare('SELECT * FROM orders WHERE id=?').get(id(order_id, 'order'));
      if (!o || o.branch_id !== user.branch_id) throw notFound('Order not found');
    } else {
      reqDate(date);
      const wh = sourceId(db, source);
      o = db.prepare('SELECT * FROM orders WHERE branch_id=? AND order_date=? AND warehouse_id=?').get(user.branch_id, date, wh);
      if (o && !OPEN.includes(o.status)) throw conflict(`There is already an order for ${date} (${o.status.toLowerCase()}) — choose another date`);
      if (!o) {
        const open = openOrderFor(db, user.branch_id, wh);
        if (open) throw conflict(`You already have an open order (${open.order_date}) waiting for approval — edit that one instead`);
      }
    }
    if (o && !OPEN.includes(o.status)) throw conflict(`This order is already ${o.status.toLowerCase()} and can no longer be changed`);
    assertOpen(db, o ? o.order_date : date);
    const wh = o ? o.warehouse_id : sourceId(db, source);
    for (const itemId of clean.keys()) {
      const it = items.get(itemId);
      if (!it || !it.active || !it.orderable) throw bad('Unknown or inactive item');
      if (it.warehouse_id !== wh) throw bad(`${it.item_code} is not supplied by this source`);
    }
    const willBeSubmitted = submit || o?.status === 'SUBMITTED';
    if (willBeSubmitted && clean.size === 0) throw bad('Enter at least one quantity');
    if (!o) {
      const r = db.prepare('INSERT INTO orders (branch_id, warehouse_id, order_date, status, created_by, created_at) VALUES (?,?,?,?,?,?)')
        .run(user.branch_id, wh, date, 'DRAFT', user.id, now());
      o = { id: Number(r.lastInsertRowid), status: 'DRAFT' };
    }
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(o.id);
    const ins = db.prepare('INSERT INTO order_items (order_id, item_id, requested_quantity) VALUES (?,?,?)');
    for (const [itemId, q] of clean) ins.run(o.id, itemId, q);
    if (submit && o.status === 'DRAFT') db.prepare("UPDATE orders SET status='SUBMITTED', submitted_at=? WHERE id=?").run(now(), o.id);
    return getOrder(db, user, o.id);
  });
}

function listOrders(db, user, { date, from, to, branch_id, status, diff, source } = {}) {
  const where = [];
  const p = [];
  if (isMgr(user)) { where.push('o.warehouse_id=?'); p.push(whOf(user)); }
  else if (source) { where.push('o.warehouse_id=?'); p.push(sourceId(db, source)); }
  if (user.role === 'BRANCH') { where.push('o.branch_id=?'); p.push(user.branch_id); }
  else if (branch_id) { where.push('o.branch_id=?'); p.push(id(branch_id, 'branch')); }
  if (date) { where.push('o.order_date=?'); p.push(reqDate(date)); }
  if (from) { where.push('o.order_date>=?'); p.push(reqDate(from, 'from')); }
  if (to) { where.push('o.order_date<=?'); p.push(reqDate(to, 'to')); }
  if (status) {
    const s = String(status).split(',');
    where.push(`o.status IN (${IN(s)})`); p.push(...s);
  }
  if (user.role !== 'BRANCH') where.push("o.status <> 'DRAFT'");
  const rows = db.prepare(`
    SELECT o.id, o.order_date, o.status, o.submitted_at, o.accepted_at, o.branch_id, b.branch_name, b.branch_code,
           o.warehouse_id, w.name AS source_name, w.code AS source_code,
           d.name AS driver_name,
           COUNT(oi.id) AS line_count,
           COALESCE(SUM(oi.requested_quantity),0) AS requested_total,
           COALESCE(SUM(oi.accepted_quantity),0) AS accepted_total,
           (SELECT COALESCE(SUM(ri.received_quantity),0) FROM receivings r JOIN receiving_items ri ON ri.receiving_id=r.id WHERE r.order_id=o.id) AS received_total,
           (SELECT COUNT(*) FROM receivings r JOIN receiving_items ri ON ri.receiving_id=r.id WHERE r.order_id=o.id AND ri.received_quantity<>ri.accepted_quantity) AS discrepancies
    FROM orders o JOIN branches b ON b.id=o.branch_id JOIN warehouses w ON w.id=o.warehouse_id
    LEFT JOIN order_items oi ON oi.order_id=o.id
    LEFT JOIN driver_assignments da ON da.order_id=o.id
    LEFT JOIN drivers d ON d.id=da.driver_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY o.id ${diff === '1' ? 'HAVING discrepancies > 0' : ''} ORDER BY o.order_date DESC, b.branch_code, o.warehouse_id`).all(...p);
  if (user.role === 'BRANCH') rows.forEach((r) => { if (!COMMITTED.includes(r.status)) r.accepted_total = null; });
  return rows;
}

function ownOrder(db, user, orderId, cols = '*') {
  const o = db.prepare(`SELECT ${cols}, warehouse_id FROM orders WHERE id=?`).get(orderId);
  if (!o || (isMgr(user) && o.warehouse_id !== whOf(user))) throw notFound('Order not found');
  return o;
}

// Manager: accept a SUBMITTED order, or revise accepted quantities on an ACCEPTED/ASSIGNED order.
function acceptOrder(db, user, orderId, { lines }) {
  orderId = id(orderId);
  const input = new Map();
  for (const l of arr(lines)) input.set(id(l.item_id, 'item'), qty(l.accepted_quantity, 'accepted quantity'));

  return db.tx(() => {
    const o = ownOrder(db, user, orderId);
    assertOpen(db, o.order_date);
    const first = o.status === 'SUBMITTED';
    if (!first && !['ACCEPTED', 'ASSIGNED'].includes(o.status)) {
      throw conflict(`Order is ${o.status.toLowerCase()}; accepted quantities can only be changed before dispatch`);
    }
    const existing = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
    const known = new Set(existing.map((e) => e.item_id));
    for (const k of input.keys()) if (!known.has(k)) throw conflict('The branch changed this order while you were reviewing it — reload the page');

    const items = itemsById(db);
    const plan = existing.map((e) => {
      const oldQ = first ? 0 : (e.accepted_quantity ?? 0);
      const newQ = input.has(e.item_id) ? input.get(e.item_id) : (first ? e.requested_quantity : (e.accepted_quantity ?? 0));
      return { e, oldQ, newQ, delta: newQ - oldQ };
    });
    if (plan.reduce((s, x) => s + x.newQ, 0) === 0) throw bad('All accepted quantities are zero — reject the order instead');

    // Stock may go negative (business decision 15/09/2026). Shortages are reported, not blocked.

    const upd = db.prepare('UPDATE order_items SET accepted_quantity=? WHERE id=?');
    let changes = 0;
    for (const x of plan) {
      if (first || x.delta !== 0) upd.run(x.newQ, x.e.id);
      if (x.delta === 0) continue;
      changes++;
      post(db, user, first
        ? { itemId: x.e.item_id, type: 'BRANCH_ORDER_ACCEPTED', delta: -x.newQ, refType: 'ORDER', refId: orderId, branchId: o.branch_id }
        : { itemId: x.e.item_id, type: 'BRANCH_ORDER_REVISION', delta: -x.delta, refType: 'ORDER', refId: orderId, branchId: o.branch_id,
            note: `Accepted changed ${x.oldQ} → ${x.newQ}` });
    }
    if (first) {
      db.prepare("UPDATE orders SET status='ACCEPTED', accepted_by=?, accepted_at=? WHERE id=?").run(user.id, now(), orderId);
    }
    const codeOf = (iid) => items.get(iid).item_code;
    const diffs = plan.filter((x) => (first ? x.newQ !== x.e.requested_quantity : x.delta !== 0))
      .map((x) => ({ item: codeOf(x.e.item_id), requested: x.e.requested_quantity, from: first ? null : x.oldQ, to: x.newQ }));
    if (first) audit(db, user, 'ORDER_ACCEPTED', 'order', orderId, `Accepted order #${orderId}${diffs.length ? ` (${diffs.length} line(s) changed from requested)` : ''}`, diffs.length ? diffs : undefined);
    else if (changes) audit(db, user, 'ORDER_REVISED', 'order', orderId, `Changed accepted quantities on order #${orderId}: ` + diffs.map((d) => `${d.item} ${d.from}→${d.to}`).join(', '), diffs);
    const out = getOrder(db, user, orderId);
    out.changes = changes;
    out.negative_stock = out.lines.filter((l) => l.stock < 0).map((l) => ({ item_code: l.item_code, item_name: l.item_name, stock: l.stock }));
    return out;
  });
}

function rejectOrder(db, user, orderId, { reason }) {
  orderId = id(orderId);
  const r = String(reason || '').trim();
  if (!r) throw bad('A reason is required to reject an order');
  return db.tx(() => {
    const o = ownOrder(db, user, orderId, 'status, order_date');
    if (o.status !== 'SUBMITTED') throw conflict('Only submitted orders can be rejected');
    assertOpen(db, o.order_date);
    db.prepare("UPDATE orders SET status='REJECTED', reject_reason=?, accepted_by=?, accepted_at=? WHERE id=?").run(r.slice(0, 500), user.id, now(), orderId);
    audit(db, user, 'ORDER_REJECTED', 'order', orderId, `Rejected order #${orderId}: ${r.slice(0, 200)}`);
    return getOrder(db, user, orderId);
  });
}

// ───────────────────────── drivers & picking ─────────────────────────

function listDrivers(db) {
  return db.prepare('SELECT id, name, phone, active FROM drivers ORDER BY name').all();
}

function addDriver(db, user, { name, phone, email, password }) {
  const n = String(name || '').trim();
  if (!n) throw bad('Driver name is required');
  const em = String(email || '').trim().toLowerCase();
  if (em && !/^[^\s@]+@[^\s@]+$/.test(em)) throw bad('Invalid email');
  if (em && String(password || '').length < 8) throw bad('Password must be at least 8 characters');
  return db.tx(() => {
    if (db.prepare('SELECT 1 FROM drivers WHERE name=?').get(n)) throw conflict('A driver with that name already exists');
    if (em && db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) throw conflict('That email is already used');
    const did = Number(db.prepare('INSERT INTO drivers (name, phone) VALUES (?,?)').run(n.slice(0, 80), phone ? String(phone).slice(0, 30) : null).lastInsertRowid);
    if (em) {
      const { hashPassword } = require('./crypto');
      db.prepare("INSERT INTO users (name, email, password_hash, role, driver_id) VALUES (?,?,?,'DRIVER',?)").run(n.slice(0, 80), em, hashPassword(String(password)), did);
    }
    audit(db, user, 'DRIVER_ADDED', 'driver', did, `Added driver ${n}${em ? ` (login ${em})` : ''}`);
    return { id: did, name: n, login: em || null };
  });
}

function updateDriver(db, user, driverId, { name, phone, active }) {
  driverId = id(driverId);
  const d = db.prepare('SELECT * FROM drivers WHERE id=?').get(driverId);
  if (!d) throw notFound('Driver not found');
  const n = name === undefined ? d.name : String(name).trim();
  if (!n) throw bad('Driver name is required');
  try {
    db.prepare('UPDATE drivers SET name=?, phone=?, active=? WHERE id=?').run(n.slice(0, 80), phone === undefined ? d.phone : (String(phone).trim().slice(0, 30) || null), active === undefined ? d.active : (active ? 1 : 0), driverId);
  } catch (e) { if (/UNIQUE/.test(e.message)) throw conflict('A driver with that name already exists'); throw e; }
  db.prepare("UPDATE users SET name=? WHERE role='DRIVER' AND driver_id=?").run(n.slice(0, 80), driverId);
  audit(db, user, 'DRIVER_UPDATED', 'driver', driverId, `Driver ${d.name} updated${n !== d.name ? ` (renamed to ${n})` : ''}`);
  return { ok: true };
}

function listBranches(db, { withRoutes } = {}) {
  return db.prepare(`SELECT b.id, b.branch_code, b.branch_name${withRoutes ? ', b.default_driver_id, b.default_sequence, d.name AS default_driver_name' : ''}
    FROM branches b LEFT JOIN drivers d ON d.id=b.default_driver_id WHERE b.active=1 ORDER BY b.branch_name`).all();
}

function setBranchRoute(db, user, branchId, { driver_id, sequence }) {
  branchId = id(branchId);
  const d = driver_id ? id(driver_id, 'driver') : null;
  const s = sequence ? qty(sequence, 'sequence') : null;
  if (d && !db.prepare('SELECT 1 FROM drivers WHERE id=?').get(d)) throw bad('Unknown driver');
  const r = db.prepare('UPDATE branches SET default_driver_id=?, default_sequence=? WHERE id=?').run(d, s, branchId);
  if (!r.changes) throw notFound('Branch not found');
  return { ok: true };
}

function picking(db, user, date) {
  reqDate(date);
  const orders = db.prepare(`
    SELECT o.id, o.status, o.branch_id, b.branch_name, b.branch_code, b.default_driver_id, b.default_sequence,
           da.driver_id, da.sequence, d.name AS driver_name,
           (SELECT COUNT(*) FROM receivings r JOIN receiving_items ri ON ri.receiving_id=r.id WHERE r.order_id=o.id AND ri.received_quantity<>ri.accepted_quantity) AS discrepancies
    FROM orders o JOIN branches b ON b.id=o.branch_id
    LEFT JOIN driver_assignments da ON da.order_id=o.id
    LEFT JOIN drivers d ON d.id=da.driver_id
    WHERE o.order_date=? AND o.warehouse_id=? AND o.status IN ('ACCEPTED','ASSIGNED','DISPATCHED','RECEIVED')
    ORDER BY COALESCE(d.name,'~'), da.sequence, b.branch_name`).all(date, whOf(user));
  const lineStmt = db.prepare(`SELECT i.id AS item_id, i.item_code, i.item_name, i.item_name_ar, i.unit, oi.accepted_quantity AS quantity
    FROM order_items oi JOIN items i ON i.id=oi.item_id WHERE oi.order_id=? AND oi.accepted_quantity>0 ORDER BY i.sort_order`);
  for (const o of orders) o.lines = lineStmt.all(o.id);

  const drivers = listDrivers(db).filter((d) => d.active).map((d) => {
    const mine = orders.filter((o) => o.driver_id === d.id);
    const totals = new Map();
    for (const o of mine) for (const l of o.lines) {
      const t = totals.get(l.item_id) || { ...l, quantity: 0 };
      t.quantity += l.quantity; totals.set(l.item_id, t);
    }
    return { ...d, orders: mine, item_totals: [...totals.values()].sort((a, b) => a.item_code.localeCompare(b.item_code)) };
  });
  return { date, unassigned: orders.filter((o) => !o.driver_id), drivers };
}

function assignOrder(db, user, orderId, { driver_id, sequence }) {
  orderId = id(orderId);
  return db.tx(() => {
    const o = ownOrder(db, user, orderId, 'status');
    if (!['ACCEPTED', 'ASSIGNED'].includes(o.status)) throw conflict(`Order is ${o.status.toLowerCase()} and cannot be re-assigned`);
    if (!driver_id) {
      db.prepare('DELETE FROM driver_assignments WHERE order_id=?').run(orderId);
      db.prepare("UPDATE orders SET status='ACCEPTED' WHERE id=?").run(orderId);
      return { ok: true };
    }
    const d = id(driver_id, 'driver');
    if (!db.prepare('SELECT 1 FROM drivers WHERE id=? AND active=1').get(d)) throw bad('Unknown driver');
    const seq = sequence === undefined || sequence === null || sequence === '' ? 1 : Math.max(1, qty(sequence, 'sequence'));
    db.prepare(`INSERT INTO driver_assignments (order_id, driver_id, sequence, assigned_by, assigned_at) VALUES (?,?,?,?,?)
      ON CONFLICT(order_id) DO UPDATE SET driver_id=excluded.driver_id, sequence=excluded.sequence, assigned_by=excluded.assigned_by, assigned_at=excluded.assigned_at`)
      .run(orderId, d, seq, user.id, now());
    db.prepare("UPDATE orders SET status='ASSIGNED' WHERE id=?").run(orderId);
    return { ok: true };
  });
}

function applyDefaultRoutes(db, user, date) {
  reqDate(date);
  return db.tx(() => {
    const rows = db.prepare(`SELECT o.id, b.default_driver_id, b.default_sequence FROM orders o JOIN branches b ON b.id=o.branch_id
      WHERE o.order_date=? AND o.warehouse_id=? AND o.status='ACCEPTED' AND b.default_driver_id IS NOT NULL`).all(date, whOf(user));
    for (const r of rows) assignOrder(db, user, r.id, { driver_id: r.default_driver_id, sequence: r.default_sequence || 1 });
    return { assigned: rows.length };
  });
}

function dispatch(db, user, { order_ids }) {
  const ids = arr(order_ids, 'order_ids').map((x) => id(x));
  if (!ids.length) throw bad('Nothing to dispatch');
  return db.tx(() => {
    const rows = db.prepare(`SELECT id, status FROM orders WHERE id IN (${IN(ids)}) AND warehouse_id=?`).all(...ids, whOf(user));
    if (rows.length !== ids.length) throw notFound('Order not found');
    const notReady = rows.filter((r) => r.status !== 'ASSIGNED');
    if (notReady.length) throw conflict('Only orders assigned to a driver can be dispatched');
    db.prepare(`UPDATE orders SET status='DISPATCHED', dispatched_at=?, dispatched_by=? WHERE id IN (${IN(ids)})`).run(now(), user.id, ...ids);
    return { dispatched: ids.length };
  });
}

// ───────────────────────── branch receiving ─────────────────────────

function confirmReceiving(db, user, orderId, { lines, notes }) {
  orderId = id(orderId);
  const input = new Map();
  for (const l of arr(lines)) input.set(id(l.item_id, 'item'), qty(l.received_quantity, 'received quantity'));
  return db.tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!o || o.branch_id !== user.branch_id) throw notFound('Order not found');
    if (o.status !== 'DISPATCHED') throw conflict(o.status === 'RECEIVED' ? 'Receiving was already confirmed' : 'This order has not been dispatched yet');
    assertOpen(db, o.order_date);
    const expected = db.prepare('SELECT item_id, accepted_quantity FROM order_items WHERE order_id=? AND accepted_quantity>0').all(orderId);
    for (const e of expected) if (!input.has(e.item_id)) throw bad('Enter a received quantity for every item');
    const r = db.prepare('INSERT INTO receivings (order_id, branch_id, received_by, received_at, notes) VALUES (?,?,?,?,?)')
      .run(orderId, o.branch_id, user.id, now(), notes ? String(notes).slice(0, 500) : null);
    const rid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO receiving_items (receiving_id, item_id, accepted_quantity, received_quantity) VALUES (?,?,?,?)');
    for (const e of expected) ins.run(rid, e.item_id, e.accepted_quantity, input.get(e.item_id));
    db.prepare("UPDATE orders SET status='RECEIVED' WHERE id=?").run(orderId);
    const items = itemsById(db);
    const diffs = expected.filter((e) => input.get(e.item_id) !== e.accepted_quantity)
      .map((e) => ({ item: items.get(e.item_id).item_code, sent: e.accepted_quantity, received: input.get(e.item_id) }));
    audit(db, user, 'BRANCH_RECEIVED', 'order', orderId, `Branch confirmed receiving of order #${orderId}${diffs.length ? ' — differences: ' + diffs.map((d) => `${d.item} ${d.sent}→${d.received}`).join(', ') : ''}`, diffs.length ? diffs : undefined);
    // Rule 4: no inventory transaction on branch receiving.
    return getOrder(db, user, orderId);
  });
}

// ───────────────────────── supplier receiving ─────────────────────────

function listSuppliers(db) {
  return db.prepare('SELECT id, supplier_name FROM suppliers WHERE active=1 ORDER BY supplier_name').all();
}

function supplierReceipt(db, user, { supplier_name, date, lines, notes, invoice_no }) {
  const name = String(supplier_name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw bad('Supplier name is required');
  reqDate(date);
  const clean = new Map();
  const prices = new Map();
  for (const l of arr(lines)) {
    const q = qty(l.quantity);
    if (q <= 0) continue;
    const it = id(l.item_id, 'item');
    if (clean.has(it)) throw bad('The same item is listed twice — combine it into one line');
    clean.set(it, q);
    prices.set(it, money(l.unit_price, 'unit price'));
  }
  if (!clean.size) throw bad('Add at least one item with a quantity');
  const items = itemsById(db);
  for (const k of clean.keys()) {
    const it = items.get(k);
    if (!it?.active || it.warehouse_id !== whOf(user)) throw bad('Unknown or inactive item');
  }

  return db.tx(() => {
    assertOpen(db, date);
    let s = db.prepare('SELECT id FROM suppliers WHERE supplier_name=?').get(name);
    if (!s) s = { id: Number(db.prepare('INSERT INTO suppliers (supplier_name) VALUES (?)').run(name.slice(0, 120)).lastInsertRowid) };
    const inv = invoice_no ? String(invoice_no).trim().slice(0, 60) || null : null;
    const rid = Number(db.prepare('INSERT INTO supplier_receipts (supplier_id, received_date, received_by, created_at, notes, warehouse_id, invoice_no) VALUES (?,?,?,?,?,?,?)')
      .run(s.id, date, user.id, now(), notes ? String(notes).slice(0, 500) : null, whOf(user), inv || null).lastInsertRowid);
    const ins = db.prepare('INSERT INTO supplier_receipt_items (receipt_id, item_id, quantity, unit_cost_h) VALUES (?,?,?,?)');
    let total = 0;
    for (const [itemId, q] of clean) {
      ins.run(rid, itemId, q, prices.get(itemId));
      total += q * (prices.get(itemId) || 0);
      post(db, user, { itemId, type: 'SUPPLIER_RECEIPT', delta: q, refType: 'SUPPLIER_RECEIPT', refId: rid, note: name });
    }
    audit(db, user, 'SUPPLIER_RECEIPT', 'supplier_receipt', rid, `Received from ${name}${inv ? ` (invoice ${inv})` : ''}: ${clean.size} item(s)${total ? `, SAR ${(total / 100).toFixed(2)}` : ''}`);
    return { id: rid, lines: clean.size };
  });
}

function listReceipts(db, user, { from, to } = {}) {
  const f = from ? reqDate(from, 'from') : '0000-01-01';
  const t = to ? reqDate(to, 'to') : '9999-12-31';
  const rows = db.prepare(`SELECT r.id, r.received_date, r.created_at, r.notes, r.invoice_no, s.supplier_name, u.name AS received_by_name
    FROM supplier_receipts r JOIN suppliers s ON s.id=r.supplier_id JOIN users u ON u.id=r.received_by
    WHERE r.warehouse_id=? AND r.received_date BETWEEN ? AND ? ORDER BY r.received_date DESC, r.id DESC LIMIT 200`).all(whOf(user), f, t);
  const lines = db.prepare(`SELECT i.item_code, i.item_name, ri.quantity, ri.unit_cost_h FROM supplier_receipt_items ri JOIN items i ON i.id=ri.item_id
    WHERE ri.receipt_id=? ORDER BY i.sort_order`);
  for (const r of rows) r.lines = lines.all(r.id);
  return rows;
}

// ───────────────────────── stock count ─────────────────────────

function confirmStockCount(db, user, { date, reason, lines }) {
  reqDate(date);
  const why = String(reason || '').trim();
  if (!why) throw bad('A reason is required for the stock count');
  const input = new Map();
  for (const l of arr(lines)) {
    if (l.physical_quantity === '' || l.physical_quantity === null || l.physical_quantity === undefined) continue;
    input.set(id(l.item_id, 'item'), qty(l.physical_quantity, 'physical quantity'));
  }
  if (!input.size) throw bad('Enter at least one physical count');
  const items = itemsById(db);
  for (const k of input.keys()) if (items.get(k)?.warehouse_id !== whOf(user)) throw bad('Unknown item');

  return db.tx(() => {
    assertOpen(db, date);
    const ins = db.prepare(`INSERT INTO stock_counts (count_date, item_id, system_quantity, physical_quantity, variance, reason, created_by, status, created_at)
      VALUES (?,?,?,?,?,?,?,'CONFIRMED',?)`);
    const results = [];
    for (const [itemId, physical] of input) {
      const system = stockOf(db, itemId); // re-computed at confirmation time
      const variance = physical - system;
      const cid = Number(ins.run(date, itemId, system, physical, variance, why.slice(0, 200), user.id, now()).lastInsertRowid);
      post(db, user, { itemId, type: 'STOCK_ADJUSTMENT', delta: variance, refType: 'STOCK_COUNT', refId: cid, note: why.slice(0, 200) });
      const it = items.get(itemId);
      results.push({ item_code: it.item_code, item_name: it.item_name, system_quantity: system, physical_quantity: physical, variance });
    }
    const adj = results.filter((r) => r.variance !== 0);
    audit(db, user, 'STOCK_COUNT', 'stock_count', null, `Stock count (${why.slice(0, 80)}): ${results.length} counted, ${adj.length} adjusted` + (adj.length ? ' — ' + adj.slice(0, 10).map((r) => `${r.item_code} ${r.system_quantity}→${r.physical_quantity}`).join(', ') : ''), adj);
    return { counted: results.length, adjusted: adj.length, results };
  });
}

function listStockCounts(db, user) {
  return db.prepare(`SELECT c.id, c.count_date, c.created_at, i.item_code, i.item_name, c.system_quantity, c.physical_quantity, c.variance, c.reason, u.name AS created_by_name
    FROM stock_counts c JOIN items i ON i.id=c.item_id JOIN users u ON u.id=c.created_by
    WHERE i.warehouse_id=? ORDER BY c.id DESC LIMIT 200`).all(whOf(user));
}

// ───────────────────────── production (factory) ─────────────────────────
// Raw material used goes out of stock (PRODUCTION_INPUT), cut/produced items come in (PRODUCTION_OUTPUT), in one step.
function recordProduction(db, user, { date, notes, inputs = [], outputs }) {
  reqDate(date);
  const collect = (list, field) => {
    const m = new Map();
    for (const l of arr(list, field)) {
      const q = qty(l.quantity);
      if (q <= 0) continue;
      const k = id(l.item_id, 'item');
      m.set(k, (m.get(k) || 0) + q);
    }
    return m;
  };
  const ins = collect(inputs, 'inputs');
  const outs = collect(outputs, 'outputs');
  if (!outs.size) throw bad('Enter at least one produced item');
  const items = itemsById(db);
  for (const k of [...ins.keys(), ...outs.keys()]) {
    const it = items.get(k);
    if (!it?.active || it.warehouse_id !== whOf(user)) throw bad('Unknown or inactive item');
  }
  return db.tx(() => {
    assertOpen(db, date);
    const bid = Number(db.prepare('INSERT INTO production_batches (warehouse_id, production_date, notes, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(whOf(user), date, notes ? String(notes).slice(0, 500) : null, user.id, now()).lastInsertRowid);
    const line = db.prepare('INSERT INTO production_lines (batch_id, item_id, direction, quantity) VALUES (?,?,?,?)');
    for (const [k, q] of ins) {
      line.run(bid, k, -1, q);
      post(db, user, { itemId: k, type: 'PRODUCTION_INPUT', delta: -q, refType: 'PRODUCTION', refId: bid, note: notes ? String(notes).slice(0, 200) : null });
    }
    for (const [k, q] of outs) {
      line.run(bid, k, 1, q);
      post(db, user, { itemId: k, type: 'PRODUCTION_OUTPUT', delta: q, refType: 'PRODUCTION', refId: bid, note: notes ? String(notes).slice(0, 200) : null });
    }
    audit(db, user, 'PRODUCTION', 'production', bid, `Production #${bid}: used ${[...ins.values()].reduce((a, b) => a + b, 0)}, produced ${[...outs.values()].reduce((a, b) => a + b, 0)} unit(s)`);
    return { id: bid, used: ins.size, produced: outs.size };
  });
}

function listProduction(db, user) {
  const rows = db.prepare(`SELECT p.id, p.production_date, p.notes, p.created_at, u.name AS created_by_name
    FROM production_batches p JOIN users u ON u.id=p.created_by WHERE p.warehouse_id=? ORDER BY p.production_date DESC, p.id DESC LIMIT 100`).all(whOf(user));
  const lines = db.prepare(`SELECT i.item_code, i.item_name, l.direction, l.quantity FROM production_lines l JOIN items i ON i.id=l.item_id
    WHERE l.batch_id=? ORDER BY l.direction, i.sort_order`);
  for (const r of rows) r.lines = lines.all(r.id);
  return rows;
}

// ───────────────────────── accountant report ─────────────────────────

function acceptedReport(db, user, { branch_id, from, to, source }) {
  const b = db.prepare('SELECT id, branch_code, branch_name FROM branches WHERE id=?').get(id(branch_id, 'branch'));
  if (!b) throw notFound('Branch not found');
  reqDate(from, 'from date'); reqDate(to, 'to date');
  if (from > to) throw bad('"From" date must be on or before "To" date');
  // Managers only ever see their own source; others may filter (empty = all sources).
  const wh = isMgr(user) ? whOf(user) : (source ? sourceId(db, source) : null);
  const items = db.prepare(`
    SELECT i.item_code, i.item_name, i.item_name_ar, i.category, i.unit, w.name AS source_name, w.code AS source_code, SUM(oi.accepted_quantity) AS accepted_quantity
    FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN items i ON i.id=oi.item_id JOIN warehouses w ON w.id=o.warehouse_id
    WHERE o.branch_id=? AND o.order_date BETWEEN ? AND ? AND o.status IN (${IN(COMMITTED)}) AND oi.accepted_quantity>0
      ${wh ? 'AND o.warehouse_id=?' : ''}
    GROUP BY i.id ORDER BY i.warehouse_id, i.sort_order`).all(b.id, from, to, ...COMMITTED, ...(wh ? [wh] : []));
  const orders = listOrders(db, user, { branch_id: b.id, from, to, status: COMMITTED.join(','), source: wh || '' });
  return {
    branch: b, from, to, items, orders, source: wh ? db.prepare('SELECT id, name FROM warehouses WHERE id=?').get(wh) : null,
    total_quantity: items.reduce((s, r) => s + r.accepted_quantity, 0),
  };
}

// ───────────────────────── home screens ─────────────────────────

function branchHome(db, user) {
  const d = today();
  const todayOrders = listSources(db).map((src) => {
    const o = db.prepare('SELECT id FROM orders WHERE branch_id=? AND order_date=? AND warehouse_id=?').get(user.branch_id, d, src.id);
    return { source: src, order: o ? getOrder(db, user, o.id) : null };
  });
  const lastAccepted = db.prepare(`SELECT id FROM orders WHERE branch_id=? AND status IN (${IN(COMMITTED)}) ORDER BY order_date DESC LIMIT 1`).get(user.branch_id, ...COMMITTED);
  const toReceive = db.prepare(`SELECT o.id, o.order_date, w.name AS source_name, w.code AS source_code FROM orders o JOIN warehouses w ON w.id=o.warehouse_id
    WHERE o.branch_id=? AND o.status='DISPATCHED' ORDER BY o.order_date, o.warehouse_id`).all(user.branch_id);
  const branch = db.prepare('SELECT branch_code, branch_name FROM branches WHERE id=?').get(user.branch_id);
  return {
    today: d, branch,
    today_orders: todayOrders,
    last_accepted: lastAccepted ? getOrder(db, user, lastAccepted.id) : null,
    to_receive: toReceive,
  };
}

function managerHome(db, user) {
  const d = today();
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  const wh = whOf(user);
  const stock = stockMap(db, wh);
  const items = itemsById(db);
  const pending = db.prepare(`SELECT oi.item_id, SUM(oi.requested_quantity) q FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.status='SUBMITTED' AND o.warehouse_id=? GROUP BY oi.item_id`).all(wh);
  // One alert per item: OUT (≤ 0) > REORDER (≤ reorder level) > SHORT (waiting requests exceed stock)
  const pend = new Map(pending.map((p) => [p.item_id, p.q]));
  const alerts = [];
  for (const it of items.values()) {
    if (!it.active || it.warehouse_id !== wh) continue;
    const s = stock.get(it.id) ?? 0;
    const q = pend.get(it.id) || 0;
    const kind = s <= 0 && (stock.has(it.id) || it.reorder_level !== null) ? 'OUT' : needsReorder(s, it.reorder_level) ? 'REORDER' : q > s ? 'SHORT' : null;
    if (kind) alerts.push({ item_id: it.id, item_code: it.item_code, item_name: it.item_name, unit: it.unit, stock: s, reorder_level: it.reorder_level, pending_requested: q, kind });
  }
  const rank = { OUT: 0, REORDER: 1, SHORT: 2 };
  alerts.sort((a, b) => rank[a.kind] - rank[b.kind] || a.item_code.localeCompare(b.item_code));
  const discrepancies = db.prepare(`
    SELECT o.id, o.order_date, b.branch_name, i.item_code, i.item_name, ri.accepted_quantity, ri.received_quantity
    FROM receiving_items ri JOIN receivings r ON r.id=ri.receiving_id JOIN orders o ON o.id=r.order_id
    JOIN branches b ON b.id=o.branch_id JOIN items i ON i.id=ri.item_id
    WHERE ri.accepted_quantity<>ri.received_quantity AND o.order_date >= date(?, '-14 days') AND o.warehouse_id=?
    ORDER BY o.order_date DESC, b.branch_name LIMIT 50`).all(d, wh);
  return {
    today: d,
    source: db.prepare('SELECT id, name, code FROM warehouses WHERE id=?').get(wh),
    counts: {
      submitted_today: count("SELECT COUNT(*) n FROM orders WHERE warehouse_id=? AND order_date=? AND status<>'DRAFT'", wh, d),
      waiting_approval: count("SELECT COUNT(*) n FROM orders WHERE warehouse_id=? AND status='SUBMITTED'", wh),
      accepted_today: count(`SELECT COUNT(*) n FROM orders WHERE warehouse_id=? AND order_date=? AND status IN (${IN(COMMITTED)})`, wh, d, ...COMMITTED),
      waiting_assignment: count("SELECT COUNT(*) n FROM orders WHERE warehouse_id=? AND status='ACCEPTED'", wh),
      waiting_dispatch: count("SELECT COUNT(*) n FROM orders WHERE warehouse_id=? AND status='ASSIGNED'", wh),
      waiting_receiving: count("SELECT COUNT(*) n FROM orders WHERE warehouse_id=? AND status='DISPATCHED'", wh),
      to_reorder: alerts.filter((a) => a.kind === 'OUT' || a.kind === 'REORDER').length,
      receiving_differences: count(`SELECT COUNT(DISTINCT r.order_id) n FROM receivings r JOIN receiving_items ri ON ri.receiving_id=r.id
        JOIN orders o ON o.id=r.order_id WHERE o.warehouse_id=? AND ri.received_quantity<>ri.accepted_quantity AND o.order_date >= date(?, '-14 days')`, wh, d),
      branches_not_submitted: count("SELECT COUNT(*) n FROM branches b WHERE b.active=1 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.branch_id=b.id AND o.warehouse_id=? AND o.order_date=? AND o.status<>'DRAFT')", wh, d),
    },
    alerts, discrepancies,
  };
}

// ───────────────────────── drivers: route, pickup, delivery, tasks, tracking ─────────────────────────

const myDriver = (user) => { if (user.role !== 'DRIVER' || !user.driver_id) throw new AppError(403, 'Driver login required'); return user.driver_id; };
const isWarehouseMgr = (user) => isMgr(user) && whOf(user) === DEFAULT_WH;

// Driver's work: everything assigned to him not yet delivered, plus what he delivered today.
function driverRoute(db, user) {
  const did = myDriver(user);
  const t = today();
  const orders = db.prepare(`
    SELECT o.id, o.order_date, o.status, o.warehouse_id, w.name AS source_name, w.code AS source_code,
           o.dispatched_at, o.delivered_at, b.branch_name, b.branch_code, da.sequence
    FROM orders o JOIN driver_assignments da ON da.order_id=o.id
    JOIN branches b ON b.id=o.branch_id JOIN warehouses w ON w.id=o.warehouse_id
    WHERE da.driver_id=? AND (
      (o.status IN ('ASSIGNED','DISPATCHED') AND o.delivered_at IS NULL)
      OR substr(o.delivered_at,1,10) = ? OR (o.delivered_at IS NULL AND o.status='RECEIVED' AND o.order_date = ?))
    ORDER BY o.order_date, da.sequence, b.branch_name, o.warehouse_id`).all(did, t, t);
  const lineStmt = db.prepare(`SELECT i.item_code, i.item_name, i.item_name_ar, i.unit, oi.accepted_quantity AS quantity
    FROM order_items oi JOIN items i ON i.id=oi.item_id WHERE oi.order_id=? AND oi.accepted_quantity>0 ORDER BY i.sort_order`);
  for (const o of orders) {
    o.lines = lineStmt.all(o.id);
    o.stage = o.status === 'ASSIGNED' ? 'TO_LOAD' : (o.delivered_at || o.status === 'RECEIVED') ? 'DELIVERED' : 'ON_THE_WAY';
  }
  // pickups: per date + source, the orders still to load, with total per item
  const pickups = [];
  for (const o of orders.filter((x) => x.stage === 'TO_LOAD')) {
    let p = pickups.find((x) => x.order_date === o.order_date && x.warehouse_id === o.warehouse_id);
    if (!p) pickups.push(p = { order_date: o.order_date, warehouse_id: o.warehouse_id, source_name: o.source_name, source_code: o.source_code, order_ids: [], branches: [], totals: new Map() });
    p.order_ids.push(o.id); p.branches.push(o.branch_name);
    for (const l of o.lines) { const k = l.item_code; const x = p.totals.get(k) || { ...l, quantity: 0 }; x.quantity += l.quantity; p.totals.set(k, x); }
  }
  pickups.forEach((p) => { p.totals = [...p.totals.values()]; });
  const driver = db.prepare('SELECT id, name, phone FROM drivers WHERE id=?').get(did);
  const openTasks = db.prepare("SELECT COUNT(*) n FROM driver_tasks WHERE driver_id=? AND status='OPEN'").get(did).n;
  return { today: t, driver, pickups, stops: orders, open_tasks: openTasks };
}

// "Loaded" at the warehouse/factory: his ASSIGNED orders for that source + date become DISPATCHED.
function driverPickup(db, user, { source, date }) {
  const did = myDriver(user);
  const wh = sourceId(db, source);
  reqDate(date);
  return db.tx(() => {
    const ids = db.prepare(`SELECT o.id FROM orders o JOIN driver_assignments da ON da.order_id=o.id
      WHERE da.driver_id=? AND o.warehouse_id=? AND o.order_date=? AND o.status='ASSIGNED'`).all(did, wh, date).map((r) => r.id);
    if (!ids.length) throw conflict('Nothing to load here — it may already be loaded or reassigned');
    db.prepare(`UPDATE orders SET status='DISPATCHED', dispatched_at=?, dispatched_by=? WHERE id IN (${IN(ids)})`).run(now(), user.id, ...ids);
    return { loaded: ids.length };
  });
}

// "Delivered" at the branch. Status stays DISPATCHED until the branch confirms quantities.
function driverDeliver(db, user, orderId) {
  const did = myDriver(user);
  orderId = id(orderId);
  return db.tx(() => {
    const o = db.prepare(`SELECT o.status, o.delivered_at FROM orders o JOIN driver_assignments da ON da.order_id=o.id WHERE o.id=? AND da.driver_id=?`).get(orderId, did);
    if (!o) throw notFound('Stop not found');
    if (o.status === 'ASSIGNED') throw conflict('Load this order at the pickup first');
    if (o.delivered_at) throw conflict('Already marked delivered');
    if (!['DISPATCHED', 'RECEIVED'].includes(o.status)) throw conflict(`Order is ${o.status.toLowerCase()}`);
    db.prepare('UPDATE orders SET delivered_at=?, delivered_by=? WHERE id=?').run(now(), user.id, orderId);
    return { ok: true };
  });
}

function listTasks(db, user, { driver_id, status } = {}) {
  const did = user.role === 'DRIVER' ? myDriver(user) : (driver_id ? id(driver_id, 'driver') : null);
  const where = []; const p = [];
  if (did) { where.push('t.driver_id=?'); p.push(did); }
  if (status) { const st = String(status).split(','); where.push(`t.status IN (${IN(st)})`); p.push(...st); }
  return db.prepare(`SELECT t.*, d.name AS driver_name, u.name AS created_by_name,
      CASE WHEN t.status='OPEN' AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END AS overdue
    FROM driver_tasks t JOIN drivers d ON d.id=t.driver_id JOIN users u ON u.id=t.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.status WHEN 'OPEN' THEN 0 ELSE 1 END, COALESCE(t.due_date, '9999'), t.id DESC LIMIT 300`).all(today(), ...p);
}

function createTask(db, user, { driver_id, title, details, due_date }) {
  if (!isWarehouseMgr(user)) throw new AppError(403, 'Only the warehouse manager can assign driver tasks');
  const did = id(driver_id, 'driver');
  if (!db.prepare('SELECT 1 FROM drivers WHERE id=? AND active=1').get(did)) throw bad('Unknown driver');
  const tt = String(title || '').trim();
  if (!tt) throw bad('Task title is required');
  if (due_date) reqDate(due_date, 'due date');
  const r = db.prepare('INSERT INTO driver_tasks (driver_id, title, details, due_date, created_by, created_at) VALUES (?,?,?,?,?,?)')
    .run(did, tt.slice(0, 120), details ? String(details).slice(0, 1000) : null, due_date || null, user.id, now());
  audit(db, user, 'TASK_CREATED', 'driver_task', Number(r.lastInsertRowid), `Task for driver #${did}: ${tt.slice(0, 120)}`);
  return { id: Number(r.lastInsertRowid) };
}

function cancelTask(db, user, taskId) {
  if (!isWarehouseMgr(user)) throw new AppError(403, 'Only the warehouse manager can cancel driver tasks');
  const r = db.prepare("UPDATE driver_tasks SET status='CANCELLED', cancelled_at=? WHERE id=? AND status='OPEN'").run(now(), id(taskId));
  if (!r.changes) throw conflict('Only open tasks can be cancelled');
  audit(db, user, 'TASK_CANCELLED', 'driver_task', Number(taskId), `Cancelled task #${taskId}`);
  return { ok: true };
}

function completeTask(db, user, taskId, { note } = {}) {
  const did = myDriver(user);
  const t = db.prepare('SELECT * FROM driver_tasks WHERE id=?').get(id(taskId));
  if (!t || t.driver_id !== did) throw notFound('Task not found');
  if (t.status !== 'OPEN') throw conflict(`Task is already ${t.status.toLowerCase()}`);
  db.prepare("UPDATE driver_tasks SET status='DONE', done_at=?, done_note=? WHERE id=?").run(now(), note ? String(note).slice(0, 500) : null, t.id);
  return { ok: true };
}

// Tracking for the warehouse manager: receiving differences and task completion per driver.
function driverStats(db, user, { from, to } = {}) {
  const t = today();
  const f = from ? reqDate(from, 'from') : addDays(t, -30);
  const e = to ? reqDate(to, 'to') : t;
  const drivers = db.prepare('SELECT id, name, phone, active FROM drivers ORDER BY name').all();
  const login = db.prepare("SELECT email FROM users WHERE role='DRIVER' AND driver_id=? AND active=1");
  const deliv = db.prepare(`SELECT COUNT(*) stops,
      SUM(CASE WHEN o.delivered_at IS NOT NULL THEN 1 ELSE 0 END) delivered,
      SUM(CASE WHEN o.status='RECEIVED' AND EXISTS (SELECT 1 FROM receivings r JOIN receiving_items ri ON ri.receiving_id=r.id WHERE r.order_id=o.id AND ri.received_quantity<>ri.accepted_quantity) THEN 1 ELSE 0 END) diff_orders,
      SUM(CASE WHEN o.status='RECEIVED' THEN 1 ELSE 0 END) received,
      COALESCE((SELECT SUM(ri.accepted_quantity - ri.received_quantity) FROM orders o2 JOIN driver_assignments da2 ON da2.order_id=o2.id
        JOIN receivings r ON r.order_id=o2.id JOIN receiving_items ri ON ri.receiving_id=r.id
        WHERE da2.driver_id=? AND o2.order_date BETWEEN ? AND ? AND ri.received_quantity < ri.accepted_quantity), 0) units_short
    FROM orders o JOIN driver_assignments da ON da.order_id=o.id
    WHERE da.driver_id=? AND o.order_date BETWEEN ? AND ? AND o.status IN ('DISPATCHED','RECEIVED')`);
  const tasks = db.prepare(`SELECT
      SUM(CASE WHEN status<>'CANCELLED' THEN 1 ELSE 0 END) assigned,
      SUM(CASE WHEN status='DONE' THEN 1 ELSE 0 END) done,
      SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END) open,
      SUM(CASE WHEN status='OPEN' AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN status='DONE' AND due_date IS NOT NULL AND substr(done_at,1,10) > due_date THEN 1 ELSE 0 END) done_late,
      AVG(CASE WHEN status='DONE' THEN (julianday(done_at) - julianday(created_at)) * 24 END) avg_hours
    FROM driver_tasks WHERE driver_id=? AND substr(created_at,1,10) BETWEEN ? AND ?`);
  return {
    from: f, to: e,
    drivers: drivers.map((d) => {
      const dl = deliv.get(d.id, f, e, d.id, f, e);
      const tk = tasks.get(t, d.id, f, e);
      return { ...d, login: login.get(d.id)?.email || null,
        stops: dl.stops || 0, delivered: dl.delivered || 0, received: dl.received || 0, diff_orders: dl.diff_orders || 0, units_short: dl.units_short || 0,
        tasks_assigned: tk.assigned || 0, tasks_done: tk.done || 0, tasks_open: tk.open || 0, tasks_overdue: tk.overdue || 0, tasks_done_late: tk.done_late || 0,
        avg_task_hours: tk.avg_hours == null ? null : Math.round(tk.avg_hours * 10) / 10 };
    }),
  };
}

function driverProfile(db, user, driverId, range = {}) {
  driverId = id(driverId);
  const stats = driverStats(db, user, range);
  const d = stats.drivers.find((x) => x.id === driverId);
  if (!d) throw notFound('Driver not found');
  const deliveries = db.prepare(`
    SELECT o.id, o.order_date, o.status, o.dispatched_at, o.delivered_at, b.branch_name, w.name AS source_name, w.code AS source_code, da.sequence,
      (SELECT COUNT(*) FROM receivings r JOIN receiving_items ri ON ri.receiving_id=r.id WHERE r.order_id=o.id AND ri.received_quantity<>ri.accepted_quantity) AS discrepancies,
      (SELECT COALESCE(SUM(ri.accepted_quantity - ri.received_quantity),0) FROM receivings r JOIN receiving_items ri ON ri.receiving_id=r.id WHERE r.order_id=o.id) AS net_short
    FROM orders o JOIN driver_assignments da ON da.order_id=o.id JOIN branches b ON b.id=o.branch_id JOIN warehouses w ON w.id=o.warehouse_id
    WHERE da.driver_id=? AND o.order_date BETWEEN ? AND ? AND o.status IN ('ASSIGNED','DISPATCHED','RECEIVED')
    ORDER BY o.order_date DESC, da.sequence LIMIT 300`).all(driverId, stats.from, stats.to);
  return { from: stats.from, to: stats.to, driver: d, deliveries, tasks: listTasks(db, user, { driver_id: driverId }) };
}

module.exports = {
  money, audit, assertOpen, isLocked, id, qty, reqDate, bad, notFound, conflict, IN, COMMITTED, whOf, addDays, now,
  driverRoute, driverPickup, driverDeliver, listTasks, createTask, cancelTask, completeTask, driverStats, driverProfile, updateDriver,
  AppError, today, stockOf, setReorderLevel, stockMap, listItems, listSources, recordProduction, listProduction, setItemUnit, inventory, itemLedger,
  getOrder, branchOrderForDate, saveBranchOrder, newOrderInfo, listOrders, acceptOrder, rejectOrder,
  listDrivers, addDriver, listBranches, setBranchRoute, picking, assignOrder, applyDefaultRoutes, dispatch,
  confirmReceiving, listSuppliers, supplierReceipt, listReceipts, confirmStockCount, listStockCounts,
  acceptedReport, branchHome, managerHome,
};
