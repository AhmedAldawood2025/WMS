'use strict';
// Loads realistic demo activity: opening stock, 10 days of history, and today's Section 24 scenario.
// Usage: npm run demo   (only on an empty/new database)
const path = require('node:path');
const { openDb } = require('../src/db');
const S = require('../src/services');
const F = require('../src/finance');

const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'wms.db');
const { db } = openDb(dbFile);
if (db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n > 0) {
  console.error('Database already has transactions — demo not loaded.');
  process.exit(1);
}

const mgr = db.prepare("SELECT * FROM users WHERE email='warehouse@spicymeal.sa'").get();
const fmgr = db.prepare("SELECT * FROM users WHERE email='factory@spicymeal.sa'").get();
const branchUser = (name) => db.prepare('SELECT u.* FROM users u JOIN branches b ON b.id=u.branch_id WHERE b.branch_name=?').get(name);
const items = S.listItems(db, { warehouse_id: 1 });
const fItems = S.listItems(db, { warehouse_id: 2 });
const byCode = Object.fromEntries([...items, ...fItems].map((i) => [i.item_code, i.id]));
const today = S.today();
const dayOffset = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Deterministic pseudo-random
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (n, max) => Array.from({ length: n }, () => Math.ceil(rnd() * max));

// Opening stock (11 days ago) — generous so history accepts cleanly
const start = dayOffset(-11);
S.confirmStockCount(db, mgr, {
  date: start, reason: 'Opening balance',
  lines: items.map((i) => ({ item_id: i.id, physical_quantity: i.item_code === 'W0001' ? 900 : 400 })),
});
const rcpt = {};
rcpt.abc1 = S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: dayOffset(-9), invoice_no: 'ABC-10412', lines: [
  { item_id: byCode.W0003, quantity: 80, unit_price: '64.00' }, { item_id: byCode.W0011, quantity: 40, unit_price: '38.50' },
] });
rcpt.abc2 = S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: dayOffset(-6), invoice_no: 'ABC-10477', lines: [
  { item_id: byCode.W0001, quantity: 300, unit_price: '52.00' }, { item_id: byCode.W0002, quantity: 120, unit_price: '48.75' }, { item_id: byCode.W0009, quantity: 60 },
] });
rcpt.rabie = S.supplierReceipt(db, mgr, { supplier_name: 'Al Rabie Beverages', date: dayOffset(-4), invoice_no: 'RB-88231', lines: [
  { item_id: byCode.W0014, quantity: 200, unit_price: '21.00' }, { item_id: byCode.W0019, quantity: 240, unit_price: '18.50' }, { item_id: byCode.W0025, quantity: 300, unit_price: '9.25' },
] });

const common = ['W0001', 'W0002', 'W0003', 'W0009', 'W0011', 'W0012', 'W0014', 'W0019', 'W0025', 'W0026', 'W0028', 'W0040', 'W0042', 'W0056', 'W0072'];
const historyBranches = ['Jish', 'Awjam', 'Dhahiyah', 'Safwa', 'Alsaif', 'Qurtuba'];
const drivers = Object.fromEntries(S.listDrivers(db).map((d) => [d.name, d.id]));

for (let off = -10; off <= -1; off++) {
  const date = dayOffset(off);
  const ids = [];
  for (const b of historyBranches) {
    const u = branchUser(b);
    const codes = common.filter(() => rnd() > 0.45);
    const qtys = pick(codes.length, 12);
    const o = S.saveBranchOrder(db, u, { date, source: 1, submit: true, lines: codes.map((c, k) => ({ item_id: byCode[c], quantity: qtys[k] })) });
    S.acceptOrder(db, mgr, o.id, { lines: o.lines.map((l) => ({ item_id: l.item_id, accepted_quantity: rnd() > 0.85 ? Math.max(0, l.requested_quantity - 2) : l.requested_quantity })) });
    ids.push({ o, u });
  }
  S.applyDefaultRoutes(db, mgr, date);
  S.dispatch(db, mgr, { order_ids: ids.map((x) => x.o.id) });
  for (const { o, u } of ids) {
    const full = S.getOrder(db, u, o.id);
    S.confirmReceiving(db, u, o.id, { lines: full.lines.filter((l) => l.accepted_quantity > 0).map((l) => ({ item_id: l.item_id, received_quantity: rnd() > 0.95 ? l.accepted_quantity - 1 : l.accepted_quantity })) });
  }
}

// Today — Section 24: bring French fries to exactly 100 before orders
const ff = byCode.W0001;
S.confirmStockCount(db, mgr, { date: today, reason: 'Morning count', lines: [{ item_id: ff, physical_quantity: 100 }] });
const day = [['Jish', 20, 20, 20, 'Driver 1', 1], ['Awjam', 15, 15, 14, 'Driver 1', 2], ['Dhahiyah', 30, 25, 25, 'Driver 2', 1]];
const extra = { Jish: [['W0009', 5, 3], ['W0014', 10, 10]], Awjam: [['W0002', 8, 8]], Dhahiyah: [['W0009', 5, 5]] };
const placed = day.map(([b, req, acc, rec, drv, seq]) => {
  const u = branchUser(b);
  const lines = [{ item_id: ff, quantity: req }, ...extra[b].map(([c, r]) => ({ item_id: byCode[c], quantity: r }))];
  const o = S.saveBranchOrder(db, u, { date: today, source: 1, submit: true, lines });
  S.acceptOrder(db, mgr, o.id, { lines: [{ item_id: ff, accepted_quantity: acc }, ...extra[b].map(([c, , a]) => ({ item_id: byCode[c], accepted_quantity: a }))] });
  S.assignOrder(db, mgr, o.id, { driver_id: drivers[drv], sequence: seq });
  return { o, u, rec, b };
});
S.dispatch(db, mgr, { order_ids: placed.map((p) => p.o.id) });
for (const p of placed) {
  const full = S.getOrder(db, p.u, p.o.id);
  S.confirmReceiving(db, p.u, p.o.id, { lines: full.lines.map((l) => ({ item_id: l.item_id, received_quantity: l.item_id === ff ? p.rec : l.accepted_quantity })) });
}
console.log(`French fries stock after Section 24 day: ${S.stockOf(db, ff)} (expected 40)`);

// Today — more branches waiting for the manager (so the queue isn't empty)
for (const b of ['Safwa', 'Alsaif', 'Qurtuba', 'Murooj', 'Taroot']) {
  const u = branchUser(b);
  const codes = common.filter((c) => c !== 'W0001' && rnd() > 0.5);
  const q = pick(codes.length, 10);
  S.saveBranchOrder(db, u, { date: today, source: 1, submit: true, lines: codes.map((c, k) => ({ item_id: byCode[c], quantity: q[k] })) });
}
S.saveBranchOrder(db, branchUser('Zuhoor'), { date: today, source: 1, submit: false, lines: [{ item_id: byCode.W0003, quantity: 4 }] });
// ───── Factory ─────
const fDay = dayOffset(-3);
S.confirmStockCount(db, fmgr, { date: fDay, reason: 'Opening balance',
  lines: fItems.filter((i) => i.orderable).map((i) => ({ item_id: i.id, physical_quantity: i.category === 'Chicken' ? 60 : 40 })) });
rcpt.watania = S.supplierReceipt(db, fmgr, { supplier_name: 'Al Watania Poultry', date: fDay, invoice_no: 'WP-5521', lines: [{ item_id: byCode.FR001, quantity: 300, unit_price: '11.40' }] });
S.recordProduction(db, fmgr, { date: dayOffset(-2), notes: 'Morning cut', inputs: [{ item_id: byCode.FR001, quantity: 120 }],
  outputs: [['F0002', 90], ['F0003', 90], ['F0006', 120], ['F0007', 60], ['F0008', 60], ['F0011', 70], ['F0012', 70]].map(([c, q]) => ({ item_id: byCode[c], quantity: q })) });
const fBranches = ['Jish', 'Awjam', 'Dhahiyah', 'Safwa'];
const fCommon = ['F0002', 'F0003', 'F0006', 'F0008', 'F0010', 'F0012', 'F0020', 'F0021', 'F0025', 'F0030', 'F0032'];
for (const off of [-2, -1]) {
  const date = dayOffset(off);
  const placed2 = fBranches.map((b) => {
    const u = branchUser(b);
    const codes = fCommon.filter(() => rnd() > 0.4);
    const q = pick(codes.length, 15);
    const o = S.saveBranchOrder(db, u, { date, source: 2, submit: true, lines: codes.map((c, k) => ({ item_id: byCode[c], quantity: q[k] })) });
    S.acceptOrder(db, fmgr, o.id, { lines: [] });
    return { o, u };
  });
  S.applyDefaultRoutes(db, fmgr, date);
  S.dispatch(db, fmgr, { order_ids: placed2.map((x) => x.o.id) });
  for (const { o, u } of placed2) {
    const full = S.getOrder(db, u, o.id);
    S.confirmReceiving(db, u, o.id, { lines: full.lines.map((l) => ({ item_id: l.item_id, received_quantity: rnd() > 0.93 ? l.accepted_quantity - 1 : l.accepted_quantity })) });
  }
}
// Today: factory orders waiting for the factory manager
for (const b of ['Jish', 'Awjam', 'Safwa', 'Qurtuba']) {
  const codes = fCommon.filter(() => rnd() > 0.45);
  const q = pick(codes.length, 12);
  S.saveBranchOrder(db, branchUser(b), { date: today, source: 2, submit: true, lines: codes.map((c, k) => ({ item_id: byCode[c], quantity: q[k] })) });
}
// ───── Drivers ─────
// History: mark delivered ~40 minutes after loading (demo only)
db.exec(`UPDATE orders SET dispatched_at = order_date || 'T04:30:00.000Z',
  delivered_at = order_date || 'T05:' || printf('%02d', 10 + (id % 45)) || ':00.000Z',
  delivered_by = (SELECT u.id FROM driver_assignments da JOIN users u ON u.role='DRIVER' AND u.driver_id=da.driver_id WHERE da.order_id=orders.id)
  WHERE status='RECEIVED' AND delivered_at IS NULL`);
// Today: factory accepts Jish + Awjam and routes them → Driver 1 has a factory pickup waiting
const fToday = db.prepare(`SELECT o.id FROM orders o JOIN branches b ON b.id=o.branch_id
  WHERE o.warehouse_id=2 AND o.order_date=? AND b.branch_name IN ('Jish','Awjam')`).all(today);
fToday.forEach((o) => S.acceptOrder(db, fmgr, o.id, { lines: [] }));
S.applyDefaultRoutes(db, fmgr, today);
const drv = (n) => db.prepare("SELECT * FROM users WHERE role='DRIVER' AND driver_id=?").get(drivers[n]);
const t1 = S.createTask(db, mgr, { driver_id: drivers['Driver 1'], title: 'Pick up paper cups from ABC Food', details: '2 cartons — invoice 7781', due_date: dayOffset(-2) });
S.completeTask(db, drv('Driver 1'), t1.id, { note: 'Collected 2 cartons' });
S.createTask(db, mgr, { driver_id: drivers['Driver 1'], title: 'Take the van for oil change', due_date: dayOffset(-1) });
S.createTask(db, mgr, { driver_id: drivers['Driver 1'], title: 'Return empty crates from Jish', due_date: today });
const t4 = S.createTask(db, mgr, { driver_id: drivers['Driver 2'], title: 'Deliver cash envelope to accounts', due_date: dayOffset(-3) });
S.completeTask(db, drv('Driver 2'), t4.id, {});
S.createTask(db, mgr, { driver_id: drivers['Driver 3'], title: 'Fuel the truck', due_date: today });
// ───── Reorder levels (examples) ─────
[['W0001', 50], ['W0002', 60], ['W0009', 60], ['W0014', 120], ['W0019', 100], ['W0025', 150], ['W0026', 50], ['W0056', 50], ['W0037', 30]]
  .forEach(([c, n]) => S.setReorderLevel(db, mgr, byCode[c], { reorder_level: n }));
['W0014', 'W0026', 'W0042'].forEach((c) => S.setReorderLevel(db, mgr, byCode[c], { reorder_level: S.stockOf(db, byCode[c]) + 5 }));
[['F0011', 150], ['F0006', 30], ['F0015', 25], ['FR001', 100], ['F0019', 20]]
  .forEach(([c, n]) => S.setReorderLevel(db, fmgr, byCode[c], { reorder_level: n }));
// ───── Accounts (finance) ─────
const acc = db.prepare("SELECT * FROM users WHERE email='accounts@spicymeal.sa'").get();
const cfo = db.prepare("SELECT * FROM users WHERE email='cfo@spicymeal.sa'").get();
const base = { 'Frozen Items': [40, 120], 'Dry Items & Cheese': [25, 140], Beverages: [8, 30], Bags: [15, 60], 'Paper Products': [20, 90],
  'Canned / Packaging Items': [12, 70], Cleaning: [10, 55], 'Plastics & Gloves': [12, 45], Miscellaneous: [5, 40],
  Chicken: [16, 32], 'Burgers, Seafood & Prepared': [20, 60], 'Dips & Salads': [6, 25], Flour: [30, 70], 'Staff Meals': [8, 20], Vegetables: [4, 15] };
const costFor = (i) => { const [lo, hi] = base[i.category] || [10, 50]; const v = lo + ((i.id * 37) % 100) / 100 * (hi - lo); return (Math.round(v * 4) / 4).toFixed(2); };
const allItems = [...items, ...fItems];
const noCost = new Set(['W0087', 'W0088']);
F.setItemCosts(db, acc, { effective_from: dayOffset(-40), note: 'Opening price list', lines: allItems.filter((i) => !noCost.has(i.item_code)).map((i) => ({ item_id: i.id, unit_cost: i.item_code === 'FR001' ? '11.00' : i.item_code === 'W0001' ? '50.00' : costFor(i) })) });
F.setItemCosts(db, acc, { effective_from: dayOffset(-3), note: 'ABC Food price increase', lines: [{ item_id: byCode.W0001, unit_cost: '52.00' }, { item_id: byCode.FR001, unit_cost: '11.40' }] });
const supId = (n) => db.prepare('SELECT id FROM suppliers WHERE supplier_name=?').get(n).id;
F.saveSupplier(db, acc, supId('ABC Food'), { contact_name: 'Khalid Al-Harbi', phone: '+966 13 812 4400', email: 'sales@abcfood.example', address: 'Dammam 2nd Industrial City', vat_number: '300112233400003', cr_number: '2050011223', bank_name: 'Al Rajhi Bank', iban: 'SA4480000123456789012345', payment_terms_days: 30 });
F.saveSupplier(db, acc, supId('Al Rabie Beverages'), { contact_name: 'Faisal Al-Qahtani', phone: '+966 13 855 1200', address: 'Khobar', vat_number: '300998877600003', cr_number: '2051099887', bank_name: 'Saudi National Bank', iban: 'SA0310000001234567890123', payment_terms_days: 15 });
F.saveSupplier(db, acc, supId('Al Watania Poultry'), { contact_name: 'Order desk', phone: '+966 11 400 9000', address: 'Qassim', vat_number: '300445566700003', bank_name: 'Riyad Bank', iban: 'SA6520000002480000123456', payment_terms_days: 7 });
// Check the priced invoices (ABC-10477 has one unpriced line → stays "needs details")
for (const k of ['abc1', 'rabie', 'watania']) F.setInvoiceMatched(db, acc, rcpt[k].id, { matched: true, note: 'Matches supplier invoice' });
// Watania: requested → approved → paid.  ABC: requested, waiting for CFO.  Rabie: checked, ready to request.
const pr1 = F.createPaymentRequest(db, acc, { supplier_id: supId('Al Watania Poultry'), receipt_ids: [rcpt.watania.id], add_vat: true, notes: 'Raw chicken for the factory' });
F.approveRequest(db, cfo, pr1.id);
F.setCompany(db, acc, { bank_accounts: [{ bank: 'Al Rajhi Bank', iban: 'SA0380000000608010167519' }, { bank: 'Saudi National Bank', iban: 'SA1510000012345678901234' }] });
F.markPaid(db, cfo, pr1.id, { paid_date: today, payment_ref: 'TRF-2026-00871', paid_from: 'Al Rajhi Bank · SA0380000000608010167519' });
F.createPaymentRequest(db, acc, { supplier_id: supId('ABC Food'), receipt_ids: [rcpt.abc1.id], add_vat: true });
// A fresh receipt today with no prices yet (shows up as "needs details")
S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: today, lines: [{ item_id: byCode.W0012, quantity: 50 }, { item_id: byCode.W0040, quantity: 30 }] });
// Close last month if it has no activity after this demo
const lastMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
if (start.slice(0, 7) > lastMonth) F.lockPeriod(db, acc, { month: lastMonth });
// ───── Maintenance ─────
const M = require('../src/maintenance');
const sup = db.prepare("SELECT * FROM users WHERE email='maintenance@spicymeal.sa'").get();
const tech1 = db.prepare("SELECT * FROM users WHERE email='tech1@spicymeal.sa'").get();
const tech2 = db.prepare("SELECT * FROM users WHERE email='tech2@spicymeal.sa'").get();
const bid = (n) => db.prepare('SELECT id FROM branches WHERE branch_name=?').get(n).id;
const vans = ['Driver 1', 'Driver 2', 'Driver 3'].map((d, k) => M.saveAsset(db, sup, null, { name: `Van ${k + 1}`, kind: 'VEHICLE', tag: `DEMO ${1000 + k}`, location_type: 'COMPANY', driver_id: drivers[d] }).id);
const freezer = M.saveAsset(db, sup, null, { name: 'Walk-in freezer', kind: 'EQUIPMENT', tag: 'WF-01', location_type: 'WAREHOUSE' }).id;
const cutter = M.saveAsset(db, sup, null, { name: 'Chicken cutting machine', kind: 'EQUIPMENT', tag: 'CM-02', location_type: 'FACTORY' }).id;
M.saveAsset(db, sup, null, { name: 'Jish POS terminal', kind: 'EQUIPMENT', tag: 'POS-JSH-1', location_type: 'BRANCH', branch_id: bid('Jish') });
// Requests from the field
const r1 = M.createJob(db, branchUser('Jish'), { category: 'LIGHTING', priority: 'HIGH', title: 'Two kitchen lights not working', description: 'Above the fryer station, since yesterday evening.' });
const r2 = M.createJob(db, branchUser('Awjam'), { category: 'PLUMBING', priority: 'URGENT', title: 'Sink drain blocked', description: 'Water not draining in the washing area.' });
const r3 = M.createJob(db, branchUser('Safwa'), { category: 'SOFTWARE', title: 'POS printer prints blank receipts' });
const r4 = M.createJob(db, mgr, { category: 'HARDWARE', priority: 'HIGH', title: 'Walk-in freezer door seal torn', asset_id: freezer });
const r5 = M.createJob(db, fmgr, { category: 'ELECTRICAL', title: 'Cutting machine breaker trips', asset_id: cutter });
const r6 = M.createJob(db, drv('Driver 2'), { category: 'VEHICLE', priority: 'URGENT', title: 'Brakes squeaking', asset_id: vans[1] });
M.createJob(db, branchUser('Dhahiyah'), { category: 'SWITCHES', title: 'Socket near the counter is loose' });
M.updateJob(db, sup, r1.id, { tech_id: tech1.id, due_date: dayOffset(-1) });
M.startJob(db, tech1, r1.id);
M.addNote(db, tech1, r1.id, { note: 'Starters replaced — one tube still needed, bringing it tomorrow.' });
M.updateJob(db, sup, r2.id, { contractor_name: 'Al Jazeera Plumbing', due_date: today });
M.finishJob(db, sup, r2.id, { work_note: 'Contractor cleared the drain and replaced the trap.' });
M.setJobCost(db, sup, r2.id, { cost: '350', invoice_no: 'AJP-4410' });
M.closeJob(db, sup, r2.id, { note: 'Branch confirmed' });
M.updateJob(db, sup, r4.id, { tech_id: tech2.id, due_date: dayOffset(2) });
M.startJob(db, tech2, r4.id); M.finishJob(db, tech2, r4.id, { work_note: 'New door seal fitted, temperature holding at -18.' });
M.setJobCost(db, sup, r4.id, { cost: '145.00' });
M.updateJob(db, sup, r5.id, { tech_id: tech2.id, due_date: dayOffset(1) });
M.updateJob(db, sup, r6.id, { contractor_name: 'Petromin Express', due_date: dayOffset(1) });
M.finishJob(db, sup, r6.id, { work_note: 'Front brake pads replaced.' });
M.setJobCost(db, sup, r6.id, { cost: '480', invoice_no: 'PX-99812' });
M.closeJob(db, sup, r6.id, {});
F.saveSupplier(db, acc, supId('Petromin Express'), { contact_name: 'Fleet desk', phone: '+966 13 000 0000', bank_name: 'Saudi National Bank', iban: 'SA7710000009876543210987', payment_terms_days: 30 });
M.checkJobBill(db, acc, r6.id, { matched: true });
M.rejectJob(db, sup, r3.id, { reason: 'Printer paper was loaded upside down — shown to the branch.' });
// Mandatory schedules
for (const [k, v] of vans.entries()) M.saveSchedule(db, sup, null, { title: `Van ${k + 1} oil change & service`, category: 'VEHICLE', location_type: 'COMPANY', asset_id: v, every_n: 3, every_unit: 'MONTH', next_due: dayOffset(4 + k * 20), lead_days: 7, contractor_name: 'Petromin Express' });
M.saveSchedule(db, sup, null, { title: 'Fire extinguisher check', category: 'GOVERNMENT', location_type: 'BRANCH', branch_id: bid('Jish'), every_n: 6, every_unit: 'MONTH', next_due: dayOffset(3), lead_days: 7, tech_id: tech1.id, details: 'Check pressure gauge, expiry tag and mounting of every extinguisher.' });
M.saveSchedule(db, sup, null, { title: 'Walk-in freezer service', category: 'HARDWARE', location_type: 'WAREHOUSE', asset_id: freezer, every_n: 1, every_unit: 'MONTH', next_due: dayOffset(20), lead_days: 5, tech_id: tech2.id });
// Licenses & documents
M.saveDocument(db, sup, null, { doc_type: 'Municipality license (Baladiya)', title: 'Jish Baladiya license', reference_no: 'DEMO-B-1', location_type: 'BRANCH', branch_id: bid('Jish'), expires_on: dayOffset(12) });
M.saveDocument(db, sup, null, { doc_type: 'Civil Defense certificate', title: 'Warehouse Civil Defense', reference_no: 'DEMO-CD-7', location_type: 'WAREHOUSE', expires_on: dayOffset(-5) });
M.saveDocument(db, sup, null, { doc_type: 'Vehicle registration (Istimara)', title: 'Van 1 Istimara', reference_no: 'DEMO-IS-1', location_type: 'COMPANY', asset_id: vans[0], expires_on: dayOffset(200) });
M.saveDocument(db, sup, null, { doc_type: 'Vehicle insurance', title: 'Fleet insurance', location_type: 'COMPANY', expires_on: dayOffset(25), remind_days: 45 });
M.saveDocument(db, sup, null, { doc_type: 'Municipality license (Baladiya)', title: 'Awjam Baladiya license', location_type: 'BRANCH', branch_id: bid('Awjam'), expires_on: dayOffset(300) });
console.log('Demo data loaded.');
