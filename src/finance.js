'use strict';
// Accounts & CFO features: item costs, valued reports, statements, stock value, supplier invoices,
// factory yield, month-end lock, change log, payment requests.
// All money is integer halalas (1 SAR = 100).

const S = require('./services');
const { AppError, money, audit, assertOpen, id, qty, reqDate, bad, notFound, conflict, IN, COMMITTED, now, today, addDays } = S;

const ACC = 'ACCOUNTANT';
const CFO = 'CFO';
const canRead = (u) => [ACC, CFO].includes(u.role);
const readOnly = (u) => { if (!canRead(u)) throw new AppError(403, 'Accounts access only'); };
const accOnly = (u) => { if (u.role !== ACC) throw new AppError(403, 'Only the accountant can do this'); };
const cfoOnly = (u) => { if (u.role !== CFO) throw new AppError(403, 'Only the CFO can do this'); };
const str = (v, max) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
// End of a Riyadh business day (UTC+3) as a UTC timestamp — ledger rows before this belong to the day or earlier.
const endOfDayUtc = (d) => new Date(Date.parse(`${d}T00:00:00+03:00`) + 86400000).toISOString();

// Cost of an item on a date (latest cost effective on or before it).
const COST_AT = (itemCol, dateCol) => `(SELECT c.unit_cost_h FROM item_costs c WHERE c.item_id=${itemCol} AND c.effective_from<=${dateCol}
  ORDER BY c.effective_from DESC, c.id DESC LIMIT 1)`;

// ───────────────────────── company & suppliers ─────────────────────────
const COMPANY_KEYS = ['company_name', 'company_name_ar', 'cr_number', 'vat_number', 'address', 'phone', 'email', 'vat_rate_bp'];

function getCompany(db) {
  const out = {};
  for (const r of db.prepare("SELECT key, value FROM app_meta WHERE key LIKE 'company.%'").all()) out[r.key.slice(8)] = r.value;
  out.vat_rate_bp = Number(out.vat_rate_bp ?? 1500);
  try { out.bank_accounts = JSON.parse(out.bank_accounts || '[]'); } catch { out.bank_accounts = []; }
  return out;
}

function setCompany(db, user, body) {
  accOnly(user);
  const up = db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.tx(() => {
    if (body.bank_accounts !== undefined) {
      if (!Array.isArray(body.bank_accounts)) throw bad('Bank accounts must be a list');
      const list = body.bank_accounts.map((a) => ({ bank: str(a?.bank, 80), iban: (str(a?.iban, 40) || '').replace(/\s+/g, '').toUpperCase() || null }))
        .filter((a) => a.bank || a.iban);
      for (const a of list) {
        if (!a.bank) throw bad('Each company account needs a bank name');
        if (a.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(a.iban)) throw bad(`IBAN looks wrong: ${a.iban}`);
      }
      if (list.length > 20) throw bad('Too many bank accounts');
      up.run('company.bank_accounts', JSON.stringify(list));
    }
    for (const k of COMPANY_KEYS) {
      if (body[k] === undefined) continue;
      let v = String(body[k] ?? '').trim().slice(0, 300);
      if (k === 'vat_rate_bp') {
        const pct = Number(v);
        if (!(pct >= 0 && pct <= 100)) throw bad('VAT rate must be between 0 and 100');
        v = String(Math.round(pct * 100));
      }
      if (k === 'company_name' && !v) throw bad('Company name is required');
      up.run('company.' + k, v);
    }
    audit(db, user, 'COMPANY_UPDATED', 'company', null, 'Company details updated');
  });
  return getCompany(db);
}

const SUPPLIER_FIELDS = ['supplier_name', 'vat_number', 'cr_number', 'contact_name', 'phone', 'email', 'address', 'bank_name', 'iban', 'payment_terms_days'];

function listSuppliersFull(db, user) {
  readOnly(user);
  return db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM supplier_receipts r WHERE r.supplier_id=s.id) AS receipts
    FROM suppliers s ORDER BY s.active DESC, s.supplier_name`).all();
}

function saveSupplier(db, user, supplierId, body) {
  accOnly(user);
  const vals = {};
  for (const f of SUPPLIER_FIELDS) if (body[f] !== undefined) vals[f] = str(body[f], f === 'address' ? 300 : 120);
  if (vals.iban) {
    vals.iban = vals.iban.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(vals.iban)) throw bad('IBAN looks wrong (e.g. SA0380000000608010167519)');
  }
  if (vals.payment_terms_days !== undefined && vals.payment_terms_days !== null) vals.payment_terms_days = qty(vals.payment_terms_days, 'payment terms');
  if (body.active !== undefined) vals.active = body.active ? 1 : 0;
  return db.tx(() => {
    let sid = supplierId ? id(supplierId) : null;
    if (sid) {
      if (!db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(sid)) throw notFound('Supplier not found');
      if ('supplier_name' in vals && !vals.supplier_name) throw bad('Supplier name is required');
    } else {
      if (!vals.supplier_name) throw bad('Supplier name is required');
      try { sid = Number(db.prepare('INSERT INTO suppliers (supplier_name) VALUES (?)').run(vals.supplier_name).lastInsertRowid); } catch (e) {
        if (/UNIQUE/.test(e.message)) throw conflict('A supplier with that name already exists'); throw e;
      }
    }
    const keys = Object.keys(vals);
    if (keys.length) {
      try { db.prepare(`UPDATE suppliers SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map((k) => vals[k]), sid); } catch (e) {
        if (/UNIQUE/.test(e.message)) throw conflict('A supplier with that name already exists'); throw e;
      }
    }
    audit(db, user, supplierId ? 'SUPPLIER_UPDATED' : 'SUPPLIER_ADDED', 'supplier', sid, `Supplier ${db.prepare('SELECT supplier_name n FROM suppliers WHERE id=?').get(sid).n} ${supplierId ? 'updated' : 'added'}`);
    return db.prepare('SELECT * FROM suppliers WHERE id=?').get(sid);
  });
}

// ───────────────────────── item costs ─────────────────────────
function listItemCosts(db, user, { date } = {}) {
  readOnly(user);
  const d = date ? reqDate(date) : today();
  return db.prepare(`
    SELECT i.id, i.item_code, i.item_name, i.item_name_ar, i.category, i.unit, i.orderable, w.name AS source_name, w.code AS source_code,
      ${COST_AT('i.id', '?')} AS unit_cost_h,
      (SELECT c.effective_from FROM item_costs c WHERE c.item_id=i.id AND c.effective_from<=? ORDER BY c.effective_from DESC, c.id DESC LIMIT 1) AS cost_from,
      (SELECT c.unit_cost_h FROM item_costs c WHERE c.item_id=i.id AND c.effective_from>? ORDER BY c.effective_from, c.id LIMIT 1) AS next_cost_h,
      (SELECT c.effective_from FROM item_costs c WHERE c.item_id=i.id AND c.effective_from>? ORDER BY c.effective_from, c.id LIMIT 1) AS next_cost_from,
      (SELECT ri.unit_cost_h FROM supplier_receipt_items ri JOIN supplier_receipts r ON r.id=ri.receipt_id
        WHERE ri.item_id=i.id AND ri.unit_cost_h IS NOT NULL ORDER BY r.received_date DESC, r.id DESC LIMIT 1) AS last_purchase_h
    FROM items i JOIN warehouses w ON w.id=i.warehouse_id
    WHERE i.active=1 ORDER BY i.warehouse_id, i.sort_order`).all(d, d, d, d);
}

function setItemCosts(db, user, { effective_from, lines, note }) {
  accOnly(user);
  const eff = effective_from ? reqDate(effective_from, 'effective date') : today();
  if (!Array.isArray(lines) || !lines.length) throw bad('Nothing to save');
  const clean = lines.map((l) => ({ item_id: id(l.item_id, 'item'), cost: money(l.unit_cost, 'unit cost') })).filter((l) => l.cost !== null);
  if (!clean.length) throw bad('Enter at least one cost');
  return db.tx(() => {
    const closed = db.prepare('SELECT month FROM periods WHERE locked=1 AND month>=? ORDER BY month LIMIT 1').get(eff.slice(0, 7));
    if (closed) throw conflict(`${closed.month} is closed — a cost starting ${eff} would change its figures. Use a date after the last closed month.`);
    const ins = db.prepare('INSERT INTO item_costs (item_id, unit_cost_h, effective_from, note, created_by, created_at) VALUES (?,?,?,?,?,?)');
    const prev = db.prepare(`SELECT ${COST_AT('?', '?')} AS c`);
    const changed = [];
    for (const l of clean) {
      const it = db.prepare('SELECT item_code FROM items WHERE id=?').get(l.item_id);
      if (!it) throw bad('Unknown item');
      const before = prev.get(l.item_id, eff).c;
      if (before === l.cost) continue;
      ins.run(l.item_id, l.cost, eff, str(note, 200), user.id, now());
      changed.push({ item: it.item_code, from: before, to: l.cost });
    }
    if (changed.length) {
      audit(db, user, 'COST_CHANGED', 'item_cost', null, `Cost change from ${eff}: ` + changed.slice(0, 12).map((c) => `${c.item} ${c.from == null ? '—' : (c.from / 100).toFixed(2)}→${(c.to / 100).toFixed(2)}`).join(', ') + (changed.length > 12 ? ` (+${changed.length - 12} more)` : ''), changed);
    }
    return { saved: changed.length, effective_from: eff };
  });
}

function costHistory(db, user, itemId) {
  readOnly(user);
  return db.prepare(`SELECT c.id, c.unit_cost_h, c.effective_from, c.note, c.created_at, u.name AS created_by_name
    FROM item_costs c JOIN users u ON u.id=c.created_by WHERE c.item_id=? ORDER BY c.effective_from DESC, c.id DESC`).all(id(itemId));
}

// ───────────────────────── valued reports ─────────────────────────
// Adds SAR values to the accepted-quantities report (accountant / CFO only).
function valueAcceptedReport(db, user, rep) {
  if (!canRead(user)) return rep;
  const wh = rep.source?.id || null;
  const rows = db.prepare(`
    SELECT i.item_code, SUM(oi.accepted_quantity * ${COST_AT('oi.item_id', 'o.order_date')}) AS value_h,
      SUM(CASE WHEN ${COST_AT('oi.item_id', 'o.order_date')} IS NULL THEN 1 ELSE 0 END) AS missing
    FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN items i ON i.id=oi.item_id
    WHERE o.branch_id=? AND o.order_date BETWEEN ? AND ? AND o.status IN (${IN(COMMITTED)}) AND oi.accepted_quantity>0 ${wh ? 'AND o.warehouse_id=?' : ''}
    GROUP BY i.id`).all(rep.branch.id, rep.from, rep.to, ...COMMITTED, ...(wh ? [wh] : []));
  const byCode = new Map(rows.map((r) => [r.item_code, r]));
  for (const it of rep.items) {
    const v = byCode.get(it.item_code);
    it.value_h = v?.value_h ?? null;
    it.missing_cost = !!v?.missing;
    it.avg_unit_cost_h = it.value_h != null && it.accepted_quantity ? Math.round(it.value_h / it.accepted_quantity) : null;
  }
  const ov = db.prepare(`SELECT SUM(oi.accepted_quantity * ${COST_AT('oi.item_id', 'o.order_date')}) v FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.id=?`);
  for (const o of rep.orders) o.value_h = ov.get(o.id).v;
  rep.total_value_h = rep.items.reduce((a, i) => a + (i.value_h || 0), 0);
  rep.missing_costs = rep.items.filter((i) => i.missing_cost).length;
  return rep;
}

function branchesSummary(db, user, { from, to }) {
  readOnly(user);
  reqDate(from, 'from date'); reqDate(to, 'to date');
  if (from > to) throw bad('"From" date must be on or before "To" date');
  const rows = db.prepare(`
    SELECT b.id AS branch_id, b.branch_code, b.branch_name,
      COUNT(DISTINCT CASE WHEN o.warehouse_id=1 THEN o.id END) AS wh_orders,
      COUNT(DISTINCT CASE WHEN o.warehouse_id=2 THEN o.id END) AS fac_orders,
      COALESCE(SUM(CASE WHEN o.warehouse_id=1 THEN oi.accepted_quantity END),0) AS wh_qty,
      COALESCE(SUM(CASE WHEN o.warehouse_id=2 THEN oi.accepted_quantity END),0) AS fac_qty,
      COALESCE(SUM(CASE WHEN o.warehouse_id=1 THEN oi.accepted_quantity * ${COST_AT('oi.item_id', 'o.order_date')} END),0) AS wh_value_h,
      COALESCE(SUM(CASE WHEN o.warehouse_id=2 THEN oi.accepted_quantity * ${COST_AT('oi.item_id', 'o.order_date')} END),0) AS fac_value_h,
      SUM(CASE WHEN oi.accepted_quantity>0 AND ${COST_AT('oi.item_id', 'o.order_date')} IS NULL THEN 1 ELSE 0 END) AS missing
    FROM branches b
    LEFT JOIN orders o ON o.branch_id=b.id AND o.order_date BETWEEN ? AND ? AND o.status IN (${IN(COMMITTED)})
    LEFT JOIN order_items oi ON oi.order_id=o.id AND oi.accepted_quantity>0
    WHERE b.active=1 GROUP BY b.id ORDER BY b.branch_name`).all(from, to, ...COMMITTED);
  for (const r of rows) r.total_value_h = r.wh_value_h + r.fac_value_h;
  const t = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { from, to, branches: rows, totals: { wh_orders: t('wh_orders'), fac_orders: t('fac_orders'), wh_value_h: t('wh_value_h'), fac_value_h: t('fac_value_h'), total_value_h: t('total_value_h') }, missing_costs: t('missing') };
}

function branchStatement(db, user, { branch_id, month }) {
  readOnly(user);
  if (!isMonth(month)) throw bad('Choose a month');
  const b = db.prepare('SELECT id, branch_code, branch_name FROM branches WHERE id=?').get(id(branch_id, 'branch'));
  if (!b) throw notFound('Branch not found');
  const from = `${month}-01`, to = monthEnd(month);
  const orders = db.prepare(`
    SELECT o.id, o.order_date, o.status, w.name AS source_name, w.code AS source_code, d.name AS driver_name, o.delivered_at, r.received_at
    FROM orders o JOIN warehouses w ON w.id=o.warehouse_id
    LEFT JOIN driver_assignments da ON da.order_id=o.id LEFT JOIN drivers d ON d.id=da.driver_id
    LEFT JOIN receivings r ON r.order_id=o.id
    WHERE o.branch_id=? AND o.order_date BETWEEN ? AND ? AND o.status IN (${IN(COMMITTED)})
    ORDER BY o.order_date, o.warehouse_id`).all(b.id, from, to, ...COMMITTED);
  const lines = db.prepare(`
    SELECT i.item_code, i.item_name, i.item_name_ar, i.unit, oi.accepted_quantity, ri.received_quantity,
      ${COST_AT('oi.item_id', 'o.order_date')} AS unit_cost_h
    FROM order_items oi JOIN items i ON i.id=oi.item_id JOIN orders o ON o.id=oi.order_id
    LEFT JOIN receivings r ON r.order_id=o.id LEFT JOIN receiving_items ri ON ri.receiving_id=r.id AND ri.item_id=oi.item_id
    WHERE oi.order_id=? AND oi.accepted_quantity>0 ORDER BY i.sort_order`);
  const totals = { wh_h: 0, fac_h: 0, total_h: 0, diff_lines: 0, diff_value_h: 0, missing: 0 };
  for (const o of orders) {
    o.lines = lines.all(o.id);
    o.value_h = 0;
    for (const l of o.lines) {
      l.value_h = l.unit_cost_h == null ? null : l.unit_cost_h * l.accepted_quantity;
      if (l.unit_cost_h == null) totals.missing++;
      o.value_h += l.value_h || 0;
      if (l.received_quantity != null && l.received_quantity !== l.accepted_quantity) {
        totals.diff_lines++;
        totals.diff_value_h += (l.accepted_quantity - l.received_quantity) * (l.unit_cost_h || 0);
      }
    }
    if (o.source_code === 'FAC') totals.fac_h += o.value_h; else totals.wh_h += o.value_h;
  }
  totals.total_h = totals.wh_h + totals.fac_h;
  return { company: getCompany(db), branch: b, month, from, to, orders, totals, locked: S.isLocked(db, from), generated_at: now() };
}

function stockValue(db, user, { date, source }) {
  readOnly(user);
  const d = date ? reqDate(date) : today();
  const wh = source ? Number(source) : null;
  const cutoff = endOfDayUtc(d);
  const rows = db.prepare(`
    SELECT i.id, i.item_code, i.item_name, i.item_name_ar, i.category, i.unit, w.name AS source_name, w.code AS source_code,
      COALESCE((SELECT SUM(t.direction*t.quantity) FROM inventory_transactions t WHERE t.item_id=i.id AND t.created_at < ?), 0) AS quantity,
      ${COST_AT('i.id', '?')} AS unit_cost_h
    FROM items i JOIN warehouses w ON w.id=i.warehouse_id
    WHERE (i.active=1 OR EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.item_id=i.id)) ${wh ? 'AND i.warehouse_id=?' : ''}
    ORDER BY i.warehouse_id, i.sort_order`).all(cutoff, d, ...(wh ? [wh] : []));
  const sums = {};
  let total = 0, missing = 0;
  for (const r of rows) {
    r.value_h = r.unit_cost_h == null ? null : r.unit_cost_h * r.quantity;
    if (r.unit_cost_h == null && r.quantity !== 0) missing++;
    total += r.value_h || 0;
    const k = r.source_name;
    sums[k] = sums[k] || { source_name: k, source_code: r.source_code, value_h: 0, categories: {} };
    sums[k].value_h += r.value_h || 0;
    sums[k].categories[r.category] = (sums[k].categories[r.category] || 0) + (r.value_h || 0);
  }
  return { date: d, items: rows, by_source: Object.values(sums), total_value_h: total, missing_costs: missing };
}

// ───────────────────────── supplier invoices (receipts) ─────────────────────────
const ACTIVE_PR = "('SUBMITTED','APPROVED','PAID')";

function receiptTotalsSql() {
  return `(SELECT SUM(ri.quantity * ri.unit_cost_h) FROM supplier_receipt_items ri WHERE ri.receipt_id=r.id) AS total_h,
    (SELECT COUNT(*) FROM supplier_receipt_items ri WHERE ri.receipt_id=r.id AND ri.unit_cost_h IS NULL) AS unpriced,
    (SELECT pr.number FROM payment_request_receipts x JOIN payment_requests pr ON pr.id=x.request_id WHERE x.receipt_id=r.id AND pr.status IN ${ACTIVE_PR} ORDER BY pr.id DESC LIMIT 1) AS request_number,
    (SELECT pr.status FROM payment_request_receipts x JOIN payment_requests pr ON pr.id=x.request_id WHERE x.receipt_id=r.id AND pr.status IN ${ACTIVE_PR} ORDER BY pr.id DESC LIMIT 1) AS request_status,
    (SELECT pr.id FROM payment_request_receipts x JOIN payment_requests pr ON pr.id=x.request_id WHERE x.receipt_id=r.id AND pr.status IN ${ACTIVE_PR} ORDER BY pr.id DESC LIMIT 1) AS request_id`;
}

function listSupplierInvoices(db, user, { from, to, supplier_id, source, status } = {}) {
  readOnly(user);
  const f = from ? reqDate(from, 'from') : addDays(today(), -30);
  const t = to ? reqDate(to, 'to') : today();
  const where = ['r.received_date BETWEEN ? AND ?']; const p = [f, t];
  if (supplier_id) { where.push('r.supplier_id=?'); p.push(id(supplier_id, 'supplier')); }
  if (source) { where.push('r.warehouse_id=?'); p.push(id(source, 'source')); }
  let rows = db.prepare(`
    SELECT r.id, r.received_date, r.invoice_no, r.notes, r.matched_at, r.match_note, r.supplier_id, s.supplier_name,
      w.name AS source_name, w.code AS source_code, u.name AS received_by_name, um.name AS matched_by_name, ${receiptTotalsSql()}
    FROM supplier_receipts r JOIN suppliers s ON s.id=r.supplier_id JOIN warehouses w ON w.id=r.warehouse_id
    JOIN users u ON u.id=r.received_by LEFT JOIN users um ON um.id=r.matched_by
    WHERE ${where.join(' AND ')} ORDER BY r.received_date DESC, r.id DESC LIMIT 500`).all(...p);
  for (const r of rows) {
    r.state = r.request_status === 'PAID' ? 'PAID' : r.request_status ? 'IN_REQUEST' : r.matched_at ? 'MATCHED' : r.unpriced || !r.invoice_no ? 'INCOMPLETE' : 'TO_CHECK';
  }
  if (status) rows = rows.filter((r) => String(status).split(',').includes(r.state));
  const bySupplierMonth = {};
  for (const r of rows) {
    const k = `${r.supplier_name}|${r.received_date.slice(0, 7)}`;
    bySupplierMonth[k] = bySupplierMonth[k] || { supplier_name: r.supplier_name, month: r.received_date.slice(0, 7), receipts: 0, total_h: 0, unpriced: 0 };
    bySupplierMonth[k].receipts++;
    bySupplierMonth[k].total_h += r.total_h || 0;
    bySupplierMonth[k].unpriced += r.unpriced ? 1 : 0;
  }
  return { from: f, to: t, receipts: rows, by_supplier_month: Object.values(bySupplierMonth).sort((a, b) => b.month.localeCompare(a.month) || a.supplier_name.localeCompare(b.supplier_name)) };
}

function getSupplierInvoice(db, user, receiptId) {
  if (!canRead(user)) throw new AppError(403, 'Accounts access only');
  const r = db.prepare(`SELECT r.*, s.supplier_name, w.name AS source_name, w.code AS source_code, u.name AS received_by_name, um.name AS matched_by_name, ${receiptTotalsSql()}
    FROM supplier_receipts r JOIN suppliers s ON s.id=r.supplier_id JOIN warehouses w ON w.id=r.warehouse_id
    JOIN users u ON u.id=r.received_by LEFT JOIN users um ON um.id=r.matched_by WHERE r.id=?`).get(id(receiptId));
  if (!r) throw notFound('Receipt not found');
  r.lines = db.prepare(`SELECT ri.item_id, i.item_code, i.item_name, i.item_name_ar, i.unit, ri.quantity, ri.unit_cost_h,
      ${COST_AT('ri.item_id', '?')} AS standard_cost_h
    FROM supplier_receipt_items ri JOIN items i ON i.id=ri.item_id WHERE ri.receipt_id=? ORDER BY i.sort_order`).all(r.received_date, r.id);
  return r;
}

function updateSupplierInvoice(db, user, receiptId, { invoice_no, lines }) {
  accOnly(user);
  return db.tx(() => {
    const r = getSupplierInvoice(db, user, receiptId);
    if (r.request_status) throw conflict(`This receipt is in payment request ${r.request_number} — cancel or reject that request first`);
    if (r.matched_at) throw conflict('Un-check this invoice before changing it');
    assertOpen(db, r.received_date);
    const changes = [];
    if (invoice_no !== undefined) {
      const inv = str(invoice_no, 60);
      if (inv !== r.invoice_no) { db.prepare('UPDATE supplier_receipts SET invoice_no=? WHERE id=?').run(inv, r.id); changes.push(`invoice ${r.invoice_no || '—'}→${inv || '—'}`); }
    }
    if (Array.isArray(lines)) {
      const up = db.prepare('UPDATE supplier_receipt_items SET unit_cost_h=? WHERE receipt_id=? AND item_id=?');
      for (const l of lines) {
        const cur = r.lines.find((x) => x.item_id === Number(l.item_id));
        if (!cur) throw bad('Item is not on this receipt');
        const v = money(l.unit_price, 'unit price');
        if (v !== cur.unit_cost_h) { up.run(v, r.id, cur.item_id); changes.push(`${cur.item_code} ${cur.unit_cost_h == null ? '—' : (cur.unit_cost_h / 100).toFixed(2)}→${v == null ? '—' : (v / 100).toFixed(2)}`); }
      }
    }
    if (changes.length) audit(db, user, 'RECEIPT_PRICED', 'supplier_receipt', r.id, `Receipt #${r.id} (${r.supplier_name}) updated: ${changes.join(', ')}`);
    return getSupplierInvoice(db, user, r.id);
  });
}

function setInvoiceMatched(db, user, receiptId, { matched, note }) {
  accOnly(user);
  return db.tx(() => {
    const r = getSupplierInvoice(db, user, receiptId);
    if (r.request_status) throw conflict(`This receipt is in payment request ${r.request_number}`);
    if (matched) {
      if (!r.invoice_no) throw bad('Enter the supplier invoice number first');
      if (r.unpriced) throw bad('Enter a unit price for every line first');
      db.prepare('UPDATE supplier_receipts SET matched_at=?, matched_by=?, match_note=? WHERE id=?').run(now(), user.id, str(note, 300), r.id);
      audit(db, user, 'INVOICE_MATCHED', 'supplier_receipt', r.id, `Invoice ${r.invoice_no} (${r.supplier_name}) checked against receipt #${r.id}: SAR ${(r.total_h / 100).toFixed(2)}`);
    } else {
      db.prepare('UPDATE supplier_receipts SET matched_at=NULL, matched_by=NULL, match_note=NULL WHERE id=?').run(r.id);
      audit(db, user, 'INVOICE_UNMATCHED', 'supplier_receipt', r.id, `Invoice ${r.invoice_no || ''} check removed on receipt #${r.id}`);
    }
    return getSupplierInvoice(db, user, r.id);
  });
}

// ───────────────────────── factory yield ─────────────────────────
function factoryYield(db, user, { from, to }) {
  readOnly(user);
  const f = from ? reqDate(from, 'from') : addDays(today(), -30);
  const t = to ? reqDate(to, 'to') : today();
  const batches = db.prepare(`SELECT p.id, p.production_date, p.notes, u.name AS created_by_name FROM production_batches p JOIN users u ON u.id=p.created_by
    WHERE p.production_date BETWEEN ? AND ? ORDER BY p.production_date DESC, p.id DESC`).all(f, t);
  const lines = db.prepare(`SELECT l.item_id, i.item_code, i.item_name, i.item_name_ar, i.orderable, l.direction, l.quantity,
      ${COST_AT('l.item_id', 'p.production_date')} AS unit_cost_h
    FROM production_lines l JOIN items i ON i.id=l.item_id JOIN production_batches p ON p.id=l.batch_id WHERE l.batch_id=? ORDER BY l.direction, i.sort_order`);
  const inputs = new Map(), outputs = new Map();
  let inValue = 0, outValue = 0;
  for (const b of batches) {
    b.lines = lines.all(b.id);
    b.used = b.lines.filter((l) => l.direction < 0).reduce((a, l) => a + l.quantity, 0);
    b.produced = b.lines.filter((l) => l.direction > 0).reduce((a, l) => a + l.quantity, 0);
    b.per_unit = b.used ? Math.round((b.produced / b.used) * 100) / 100 : null;
    for (const l of b.lines) {
      const m = l.direction < 0 ? inputs : outputs;
      const x = m.get(l.item_id) || { item_code: l.item_code, item_name: l.item_name, item_name_ar: l.item_name_ar, quantity: 0, value_h: 0 };
      x.quantity += l.quantity; x.value_h += (l.unit_cost_h || 0) * l.quantity;
      m.set(l.item_id, x);
      if (l.direction < 0) inValue += (l.unit_cost_h || 0) * l.quantity; else outValue += (l.unit_cost_h || 0) * l.quantity;
    }
  }
  const used = [...inputs.values()].reduce((a, x) => a + x.quantity, 0);
  const out = [...outputs.values()].sort((a, b) => a.item_code.localeCompare(b.item_code));
  for (const o of out) o.per_raw_unit = used ? Math.round((o.quantity / used) * 1000) / 1000 : null;
  return { from: f, to: t, batches, inputs: [...inputs.values()], outputs: out,
    totals: { used, produced: out.reduce((a, x) => a + x.quantity, 0), per_raw_unit: used ? Math.round((out.reduce((a, x) => a + x.quantity, 0) / used) * 100) / 100 : null, input_value_h: inValue, output_value_h: outValue } };
}

// ───────────────────────── month-end lock ─────────────────────────
function listPeriods(db, user) {
  readOnly(user);
  const t = today();
  const months = new Set();
  for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 - i, 1)); months.add(d.toISOString().slice(0, 7)); }
  for (const r of db.prepare('SELECT month FROM periods').all()) months.add(r.month);
  const get = db.prepare(`SELECT p.*, ul.name AS locked_by_name, uu.name AS unlocked_by_name FROM periods p
    LEFT JOIN users ul ON ul.id=p.locked_by LEFT JOIN users uu ON uu.id=p.unlocked_by WHERE p.month=?`);
  const open = db.prepare(`SELECT
      (SELECT COUNT(*) FROM orders WHERE order_date BETWEEN ? AND ? AND status IN ('DRAFT','SUBMITTED')) AS open_orders,
      (SELECT COUNT(*) FROM orders WHERE order_date BETWEEN ? AND ? AND status IN ('ACCEPTED','ASSIGNED','DISPATCHED')) AS not_received,
      (SELECT COUNT(*) FROM supplier_receipts r WHERE r.received_date BETWEEN ? AND ? AND (r.invoice_no IS NULL OR r.matched_at IS NULL)) AS unchecked_invoices`);
  return [...months].sort().reverse().map((m) => {
    const p = get.get(m) || { month: m, locked: 0 };
    const f = `${m}-01`, e = monthEnd(m);
    return { ...p, month: m, locked: !!p.locked, current: m === t.slice(0, 7), future: m > t.slice(0, 7), ...open.get(f, e, f, e, f, e) };
  });
}

function lockPeriod(db, user, { month }) {
  accOnly(user);
  if (!isMonth(month)) throw bad('Invalid month');
  if (month > today().slice(0, 7)) throw bad('You cannot close a future month');
  return db.tx(() => {
    if (S.isLocked(db, `${month}-01`)) throw conflict(`${month} is already closed`);
    db.prepare(`INSERT INTO periods (month, locked, locked_by, locked_at) VALUES (?,1,?,?)
      ON CONFLICT(month) DO UPDATE SET locked=1, locked_by=excluded.locked_by, locked_at=excluded.locked_at`).run(month, user.id, now());
    audit(db, user, 'PERIOD_LOCKED', 'period', null, `Closed ${month}`);
    return { ok: true };
  });
}

function unlockPeriod(db, user, { month, reason }) {
  accOnly(user);
  if (!isMonth(month)) throw bad('Invalid month');
  const why = str(reason, 300);
  if (!why) throw bad('A reason is required to reopen a month');
  return db.tx(() => {
    if (!S.isLocked(db, `${month}-01`)) throw conflict(`${month} is not closed`);
    db.prepare('UPDATE periods SET locked=0, unlocked_by=?, unlocked_at=?, unlock_reason=? WHERE month=?').run(user.id, now(), why, month);
    audit(db, user, 'PERIOD_UNLOCKED', 'period', null, `Reopened ${month}: ${why}`);
    return { ok: true };
  });
}

// ───────────────────────── change log ─────────────────────────
function listAudit(db, user, { from, to, action, user_id, q } = {}) {
  readOnly(user);
  const f = from ? reqDate(from, 'from') : addDays(today(), -7);
  const t = to ? reqDate(to, 'to') : today();
  const where = ['a.at >= ?', 'a.at < ?']; const p = [new Date(Date.parse(`${f}T00:00:00+03:00`)).toISOString(), endOfDayUtc(t)];
  if (action) { const acts = String(action).split(','); where.push(`a.action IN (${IN(acts)})`); p.push(...acts); }
  if (user_id) { where.push('a.user_id=?'); p.push(id(user_id, 'user')); }
  if (q) { where.push('a.summary LIKE ?'); p.push(`%${String(q).slice(0, 60)}%`); }
  const rows = db.prepare(`SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.summary, a.details, u.name AS user_name, u.role AS user_role
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 1000`).all(...p);
  const actions = db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map((r) => r.action);
  const users = db.prepare('SELECT DISTINCT u.id, u.name FROM audit_log a JOIN users u ON u.id=a.user_id ORDER BY u.name').all();
  return { from: f, to: t, entries: rows, actions, users };
}

// ───────────────────────── payment requests (accountant → CFO) ─────────────────────────
function nextRequestNumber(db) {
  const y = today().slice(0, 4);
  const last = db.prepare("SELECT number FROM payment_requests WHERE number LIKE ? ORDER BY id DESC LIMIT 1").get(`PR-${y}-%`);
  const n = last ? Number(last.number.split('-')[2]) + 1 : 1;
  return `PR-${y}-${String(n).padStart(4, '0')}`;
}

function payableJobs(db, user, { supplier_id }) {
  readOnly(user);
  return require('./maintenance').payableJobs(db, id(supplier_id, 'supplier'));
}

function payableReceipts(db, user, { supplier_id }) {
  readOnly(user);
  const sid = id(supplier_id, 'supplier');
  return db.prepare(`SELECT r.id, r.received_date, r.invoice_no, r.matched_at, w.name AS source_name, w.code AS source_code, ${receiptTotalsSql()}
    FROM supplier_receipts r JOIN warehouses w ON w.id=r.warehouse_id
    WHERE r.supplier_id=? AND NOT EXISTS (SELECT 1 FROM payment_request_receipts x JOIN payment_requests pr ON pr.id=x.request_id
      WHERE x.receipt_id=r.id AND pr.status IN ${ACTIVE_PR})
    ORDER BY r.received_date, r.id`).all(sid).map((r) => ({ ...r, ready: !!(r.matched_at && r.invoice_no && !r.unpriced) }));
}

function createPaymentRequest(db, user, { supplier_id, receipt_ids, job_ids, add_vat = true, due_date, notes }) {
  accOnly(user);
  const M = require('./maintenance');
  const sid = id(supplier_id, 'supplier');
  const ids = [...new Set((Array.isArray(receipt_ids) ? receipt_ids : []).map((x) => id(x, 'receipt')))];
  const jids = [...new Set((Array.isArray(job_ids) ? job_ids : []).map((x) => id(x, 'job')))];
  if (!ids.length && !jids.length) throw bad('Select at least one invoice');
  if (due_date) reqDate(due_date, 'due date');
  return db.tx(() => {
    const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(sid);
    if (!sup) throw notFound('Supplier not found');
    const avail = new Map(payableReceipts(db, user, { supplier_id: sid }).map((r) => [r.id, r]));
    let subtotal = 0;
    for (const rid of ids) {
      const r = avail.get(rid);
      if (!r) throw conflict(`Receipt #${rid} is not available for this supplier (already requested or belongs to another supplier)`);
      if (!r.ready) throw bad(`Receipt #${rid} must have an invoice number, prices on every line, and be checked before it can be requested`);
      subtotal += r.total_h;
    }
    const availJobs = new Map(M.payableJobs(db, sid).map((j) => [j.id, j]));
    for (const jid of jids) {
      const j = availJobs.get(jid);
      if (!j) throw conflict(`Maintenance job #${jid} is not available for this contractor (already requested, not finished, or another contractor)`);
      if (!j.ready) throw bad(`${j.number} must have an invoice number, a cost, and be checked before it can be requested`);
      subtotal += j.cost_h;
    }
    const rate = add_vat ? getCompany(db).vat_rate_bp : 0;
    const vat = Math.round((subtotal * rate) / 10000);
    const number = nextRequestNumber(db);
    const due = due_date || (sup.payment_terms_days != null ? addDays(today(), sup.payment_terms_days) : null);
    const prId = Number(db.prepare(`INSERT INTO payment_requests (number, supplier_id, status, add_vat, vat_rate_bp, subtotal_h, vat_h, total_h, due_date, notes, created_by, created_at)
      VALUES (?,?,'SUBMITTED',?,?,?,?,?,?,?,?,?)`).run(number, sid, add_vat ? 1 : 0, rate, subtotal, vat, subtotal + vat, due, str(notes, 500), user.id, now()).lastInsertRowid);
    const ins = db.prepare('INSERT INTO payment_request_receipts (request_id, receipt_id, amount_h) VALUES (?,?,?)');
    for (const rid of ids) ins.run(prId, rid, avail.get(rid).total_h);
    const insJ = db.prepare('INSERT INTO payment_request_jobs (request_id, job_id, amount_h) VALUES (?,?,?)');
    for (const jid of jids) insJ.run(prId, jid, availJobs.get(jid).cost_h);
    audit(db, user, 'PAYMENT_REQUESTED', 'payment_request', prId, `${number} sent to CFO: ${sup.supplier_name}, ${ids.length + jids.length} invoice(s), SAR ${((subtotal + vat) / 100).toFixed(2)}`);
    return getPaymentRequest(db, user, prId);
  });
}

function listPaymentRequests(db, user, { status } = {}) {
  readOnly(user);
  const st = status ? String(status).split(',') : null;
  return db.prepare(`SELECT pr.id, pr.number, pr.status, pr.subtotal_h, pr.vat_h, pr.total_h, pr.due_date, pr.created_at, pr.approved_at, pr.paid_date, pr.payment_ref, pr.paid_from,
      s.supplier_name, u.name AS created_by_name, (SELECT COUNT(*) FROM payment_request_receipts x WHERE x.request_id=pr.id) + (SELECT COUNT(*) FROM payment_request_jobs x WHERE x.request_id=pr.id) AS invoices
    FROM payment_requests pr JOIN suppliers s ON s.id=pr.supplier_id JOIN users u ON u.id=pr.created_by
    ${st ? `WHERE pr.status IN (${IN(st)})` : ''} ORDER BY pr.id DESC LIMIT 300`).all(...(st || []));
}

function getPaymentRequest(db, user, prId) {
  readOnly(user);
  const pr = db.prepare(`SELECT pr.*, uc.name AS created_by_name, ua.name AS approved_by_name, ur.name AS rejected_by_name, up.name AS paid_by_name
    FROM payment_requests pr JOIN users uc ON uc.id=pr.created_by LEFT JOIN users ua ON ua.id=pr.approved_by
    LEFT JOIN users ur ON ur.id=pr.rejected_by LEFT JOIN users up ON up.id=pr.paid_by WHERE pr.id=?`).get(id(prId));
  if (!pr) throw notFound('Payment request not found');
  pr.supplier = db.prepare('SELECT * FROM suppliers WHERE id=?').get(pr.supplier_id);
  pr.company = getCompany(db);
  pr.receipts = db.prepare(`SELECT r.id, r.received_date, r.invoice_no, x.amount_h, w.name AS source_name, w.code AS source_code, u.name AS received_by_name
    FROM payment_request_receipts x JOIN supplier_receipts r ON r.id=x.receipt_id JOIN warehouses w ON w.id=r.warehouse_id JOIN users u ON u.id=r.received_by
    WHERE x.request_id=? ORDER BY r.received_date, r.id`).all(pr.id);
  const lines = db.prepare(`SELECT i.item_code, i.item_name, i.item_name_ar, i.unit, ri.quantity, ri.unit_cost_h, ri.quantity * ri.unit_cost_h AS amount_h
    FROM supplier_receipt_items ri JOIN items i ON i.id=ri.item_id WHERE ri.receipt_id=? ORDER BY i.sort_order`);
  for (const r of pr.receipts) r.lines = lines.all(r.id);
  pr.jobs = db.prepare(`SELECT j.id, j.number, j.title, j.category, j.invoice_no, j.done_at, j.work_note, x.amount_h,
      CASE j.location_type WHEN 'BRANCH' THEN b.branch_name WHEN 'WAREHOUSE' THEN 'Warehouse' WHEN 'FACTORY' THEN 'Factory' ELSE 'Company' END AS location_name,
      a.name AS asset_name, a.tag AS asset_tag
    FROM payment_request_jobs x JOIN maint_jobs j ON j.id=x.job_id LEFT JOIN branches b ON b.id=j.branch_id LEFT JOIN maint_assets a ON a.id=j.asset_id
    WHERE x.request_id=? ORDER BY j.done_at, j.id`).all(pr.id);
  const cats = new Map(require('./maintenance').CATEGORIES);
  for (const j of pr.jobs) j.category_label = cats.get(j.category) || j.category;
  pr.history = db.prepare(`SELECT a.at, a.action, a.summary, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.entity='payment_request' AND a.entity_id=? ORDER BY a.id`).all(pr.id);
  return pr;
}

function transition(db, user, prId, from, to, fields, action, summary) {
  return db.tx(() => {
    const pr = db.prepare('SELECT * FROM payment_requests WHERE id=?').get(id(prId));
    if (!pr) throw notFound('Payment request not found');
    if (!from.includes(pr.status)) throw conflict(`This request is ${pr.status.toLowerCase()}`);
    const keys = Object.keys(fields);
    db.prepare(`UPDATE payment_requests SET status=?${keys.map((k) => `, ${k}=?`).join('')} WHERE id=?`).run(to, ...keys.map((k) => fields[k]), pr.id);
    audit(db, user, action, 'payment_request', pr.id, `${pr.number} ${summary}`);
    return getPaymentRequest(db, user, pr.id);
  });
}

const approveRequest = (db, user, prId) => { cfoOnly(user); return transition(db, user, prId, ['SUBMITTED'], 'APPROVED', { approved_by: user.id, approved_at: now() }, 'PAYMENT_APPROVED', 'approved'); };

function rejectRequest(db, user, prId, { reason }) {
  cfoOnly(user);
  const why = str(reason, 300);
  if (!why) throw bad('A reason is required');
  return transition(db, user, prId, ['SUBMITTED', 'APPROVED'], 'REJECTED', { rejected_by: user.id, rejected_at: now(), reject_reason: why }, 'PAYMENT_REJECTED', `returned to accounts: ${why}`);
}

function markPaid(db, user, prId, { paid_date, payment_ref, paid_from }) {
  cfoOnly(user);
  const d = paid_date ? reqDate(paid_date, 'payment date') : today();
  const ref = str(payment_ref, 80);
  if (!ref) throw bad('Enter the payment / transfer reference');
  const from = str(paid_from, 120);
  if (!from) throw bad('Choose the bank account the payment was made from');
  return transition(db, user, prId, ['APPROVED'], 'PAID', { paid_by: user.id, paid_at: now(), paid_date: d, payment_ref: ref, paid_from: from }, 'PAYMENT_PAID', `paid on ${d} from ${from} (ref ${ref})`);
}

const cancelRequest = (db, user, prId) => { accOnly(user); return transition(db, user, prId, ['SUBMITTED'], 'CANCELLED', { cancelled_at: now() }, 'PAYMENT_CANCELLED', 'cancelled by accounts'); };

// ───────────────────────── accounts home ─────────────────────────
function financeHome(db, user) {
  readOnly(user);
  const t = today();
  const m = t.slice(0, 7);
  const c = (sql, ...p) => db.prepare(sql).get(...p).n;
  const monthSummary = branchesSummary(db, user, { from: `${m}-01`, to: t });
  const inv = listSupplierInvoices(db, user, { from: addDays(t, -90), to: t });
  return {
    today: t, month: m, role: user.role,
    month_value_h: monthSummary.totals.total_value_h,
    month_wh_h: monthSummary.totals.wh_value_h,
    month_fac_h: monthSummary.totals.fac_value_h,
    items_without_cost: c(`SELECT COUNT(*) n FROM items i WHERE i.active=1 AND NOT EXISTS (SELECT 1 FROM item_costs c WHERE c.item_id=i.id AND c.effective_from<=?)`, t),
    invoices_to_check: inv.receipts.filter((r) => r.state === 'TO_CHECK' || r.state === 'INCOMPLETE').length,
    invoices_ready: inv.receipts.filter((r) => r.state === 'MATCHED').length,
    maint_bills_to_check: require('./maintenance').contractorBills(db, user, { status: 'TO_CHECK,INCOMPLETE' }).length,
    maint_bills_ready: require('./maintenance').contractorBills(db, user, { status: 'MATCHED' }).length,
    requests_waiting: c("SELECT COUNT(*) n FROM payment_requests WHERE status='SUBMITTED'"),
    requests_to_pay: c("SELECT COUNT(*) n FROM payment_requests WHERE status='APPROVED'"),
    to_pay_h: db.prepare("SELECT COALESCE(SUM(total_h),0) n FROM payment_requests WHERE status IN ('SUBMITTED','APPROVED')").get().n,
    paid_this_month_h: db.prepare("SELECT COALESCE(SUM(total_h),0) n FROM payment_requests WHERE status='PAID' AND substr(paid_date,1,7)=?").get(m).n,
    last_closed: db.prepare('SELECT month FROM periods WHERE locked=1 ORDER BY month DESC LIMIT 1').get()?.month || null,
    top_branches: monthSummary.branches.filter((b) => b.total_value_h).sort((a, b) => b.total_value_h - a.total_value_h).slice(0, 5),
  };
}

module.exports = {
  getCompany, setCompany, listSuppliersFull, saveSupplier,
  listItemCosts, setItemCosts, costHistory,
  valueAcceptedReport, branchesSummary, branchStatement, stockValue,
  listSupplierInvoices, getSupplierInvoice, updateSupplierInvoice, setInvoiceMatched,
  factoryYield, listPeriods, lockPeriod, unlockPeriod, listAudit,
  payableReceipts, payableJobs, createPaymentRequest, listPaymentRequests, getPaymentRequest,
  approveRequest, rejectRequest, markPaid, cancelRequest, financeHome,
};
