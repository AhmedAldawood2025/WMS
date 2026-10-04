'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const S = require('../src/services');
const { createServer } = require('../src/server');
const F = require('../src/finance');
const M = require('../src/maintenance');

function setup() {
  const { db } = openDb(':memory:');
  const user = (email) => db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const item = (code) => db.prepare('SELECT id FROM items WHERE item_code=?').get(code).id;
  const branch = (name) => db.prepare('SELECT id FROM branches WHERE branch_name=?').get(name).id;
  const driver = (name) => db.prepare('SELECT id FROM drivers WHERE name=?').get(name).id;
  return { db, mgr: user('warehouse@spicymeal.sa'), fmgr: user('factory@spicymeal.sa'), acc: user('accounts@spicymeal.sa'), cfo: user('cfo@spicymeal.sa'), sup: user('maintenance@spicymeal.sa'), tech: user('tech1@spicymeal.sa'), tech2: user('tech2@spicymeal.sa'), user, item, branch, driver };
}
const D = S.today(); // tests run on the current business date

test('master data: 87 warehouse items, 33 factory items + raw, 17 branches', () => {
  const { db } = setup();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items WHERE warehouse_id=1 AND active=1').get().n, 87);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items WHERE warehouse_id=2 AND orderable=1 AND active=1').get().n, 33);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items WHERE warehouse_id=2 AND orderable=0').get().n, 1);
  assert.equal(db.prepare("SELECT item_name_ar FROM items WHERE item_code='F0035'").get().item_name_ar, 'صوص ساموراي');
  assert.equal(db.prepare("SELECT item_code FROM items WHERE warehouse_id=1 ORDER BY sort_order DESC LIMIT 1").get().item_code, 'W0084');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM branches').get().n, 17);
  assert.equal(db.prepare("SELECT category FROM items WHERE item_code='W0057'").get().category, 'Cleaning');
  assert.equal(db.prepare("SELECT item_name FROM items WHERE item_code='W0088'").get().item_name, 'Macaroni order bag');
  assert.equal(db.prepare("SELECT warehouse_id FROM items WHERE item_code='W0087'").get().warehouse_id, 1, 'mayonnaise is a warehouse item');
});

test('Section 24 — complete day', () => {
  const { db, mgr, acc, user, item, branch, driver } = setup();
  const FF = item('W0001');
  S.confirmStockCount(db, mgr, { date: D, reason: 'Opening balance', lines: [{ item_id: FF, physical_quantity: 100 }] });
  assert.equal(S.stockOf(db, FF), 100);

  const jish = user('jish@spicymeal.sa'), awjam = user('awjam@spicymeal.sa'), dha = user('dhahiyah@spicymeal.sa');
  const o1 = S.saveBranchOrder(db, jish, { date: D, submit: true, lines: [{ item_id: FF, quantity: 20 }] });
  const o2 = S.saveBranchOrder(db, awjam, { date: D, submit: true, lines: [{ item_id: FF, quantity: 15 }] });
  const o3 = S.saveBranchOrder(db, dha, { date: D, submit: true, lines: [{ item_id: FF, quantity: 30 }] });
  assert.equal(S.stockOf(db, FF), 100, 'Rule 1: requested does not reduce stock');

  S.acceptOrder(db, mgr, o1.id, { lines: [{ item_id: FF, accepted_quantity: 20 }] });
  S.acceptOrder(db, mgr, o2.id, { lines: [{ item_id: FF, accepted_quantity: 15 }] });
  S.acceptOrder(db, mgr, o3.id, { lines: [{ item_id: FF, accepted_quantity: 25 }] });
  assert.equal(S.stockOf(db, FF), 40);

  S.assignOrder(db, mgr, o1.id, { driver_id: driver('Driver 1'), sequence: 1 });
  S.assignOrder(db, mgr, o2.id, { driver_id: driver('Driver 1'), sequence: 2 });
  S.assignOrder(db, mgr, o3.id, { driver_id: driver('Driver 2'), sequence: 1 });
  const pk = S.picking(db, mgr, D);
  const d1 = pk.drivers.find((d) => d.name === 'Driver 1');
  assert.deepEqual(d1.orders.map((o) => o.branch_name), ['Jish', 'Awjam']);
  assert.equal(d1.item_totals[0].quantity, 35);

  S.dispatch(db, mgr, { order_ids: [o1.id, o2.id, o3.id] });
  assert.equal(S.stockOf(db, FF), 40, 'dispatch posts nothing');

  S.confirmReceiving(db, jish, o1.id, { lines: [{ item_id: FF, received_quantity: 20 }] });
  S.confirmReceiving(db, awjam, o2.id, { lines: [{ item_id: FF, received_quantity: 14 }] });
  S.confirmReceiving(db, dha, o3.id, { lines: [{ item_id: FF, received_quantity: 25 }] });
  assert.equal(S.stockOf(db, FF), 40, 'Rule 4: receiving does not deduct again');

  const a = S.getOrder(db, mgr, o2.id).lines[0];
  assert.deepEqual([a.requested_quantity, a.accepted_quantity, a.received_quantity], [15, 15, 14]);
  const d = S.getOrder(db, mgr, o3.id).lines[0];
  assert.deepEqual([d.requested_quantity, d.accepted_quantity, d.received_quantity], [30, 25, 25]);
  assert.equal(S.managerHome(db, mgr).discrepancies.length, 1);
  assert.equal(S.managerHome(db, mgr).counts.receiving_differences, 1);
  assert.deepEqual(S.listOrders(db, mgr, { status: 'RECEIVED', diff: '1' }).map((o) => o.branch_name), ['Awjam']);
  assert.equal(S.listOrders(db, awjam, {})[0].discrepancies, 1, 'branch sees its own difference');

  const rep = S.acceptedReport(db, acc, { branch_id: branch('Awjam'), from: D, to: D });
  assert.equal(rep.items.length, 1);
  assert.equal(rep.items[0].item_code, 'W0001');
  assert.equal(rep.items[0].accepted_quantity, 15, 'Rule 10: accepted, not received');
});

test('Rule 6 — revising an accepted order posts only the delta', () => {
  const { db, mgr, user, item } = setup();
  const FF = item('W0001');
  S.confirmStockCount(db, mgr, { date: D, reason: 'Opening', lines: [{ item_id: FF, physical_quantity: 100 }] });
  const o = S.saveBranchOrder(db, user('jish@spicymeal.sa'), { date: D, submit: true, lines: [{ item_id: FF, quantity: 20 }] });
  S.acceptOrder(db, mgr, o.id, { lines: [{ item_id: FF, accepted_quantity: 20 }] });
  assert.equal(S.stockOf(db, FF), 80);
  S.acceptOrder(db, mgr, o.id, { lines: [{ item_id: FF, accepted_quantity: 15 }] });
  assert.equal(S.stockOf(db, FF), 85);
  S.acceptOrder(db, mgr, o.id, { lines: [{ item_id: FF, accepted_quantity: 18 }] });
  assert.equal(S.stockOf(db, FF), 82);
  const led = S.itemLedger(db, mgr, FF);
  assert.equal(led.transactions.length, 4, 'opening + accept + 2 revisions, nothing overwritten');
  assert.equal(led.stock, 82);
});

test('Rule 5 / drafts, stock guard, supplier receipt, stock count variance', () => {
  const { db, mgr, user, item } = setup();
  const FF = item('W0001'), OIL = item('W0009');
  const jish = user('jish@spicymeal.sa');
  S.saveBranchOrder(db, jish, { date: D, submit: false, lines: [{ item_id: FF, quantity: 5 }] });
  const draft = S.saveBranchOrder(db, jish, { date: D, submit: false, lines: [{ item_id: FF, quantity: 7 }, { item_id: OIL, quantity: 2 }] });
  assert.equal(draft.status, 'DRAFT');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, 0);
  assert.equal(S.listOrders(db, mgr, { date: D }).length, 0, 'manager does not see drafts');
  const sub = S.saveBranchOrder(db, jish, { date: D, submit: true, lines: [{ item_id: FF, quantity: 7 }, { item_id: OIL, quantity: 2 }] });

  // no stock yet → acceptance allowed, stock goes negative and is reported
  S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: D, lines: [{ item_id: OIL, quantity: 10 }] });
  const acc = S.acceptOrder(db, mgr, sub.id, { lines: [{ item_id: FF, accepted_quantity: 7 }, { item_id: OIL, accepted_quantity: 0 }] });
  assert.equal(S.stockOf(db, FF), -7);
  assert.deepEqual(acc.negative_stock.map((x) => x.item_code), ['W0001']);
  assert.equal(S.stockOf(db, OIL), 10, 'removed line posts nothing');
  S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: D, lines: [{ item_id: FF, quantity: 100 }] });
  assert.equal(S.stockOf(db, FF), 93);
  S.supplierReceipt(db, mgr, { supplier_name: 'abc food', date: D, lines: [{ item_id: FF, quantity: 87 }] });
  assert.equal(S.stockOf(db, FF), 180);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM suppliers').get().n, 1, 'supplier matched case-insensitively');

  const c = S.confirmStockCount(db, mgr, { date: D, reason: 'Monthly count', lines: [{ item_id: FF, physical_quantity: 174 }] });
  assert.equal(c.results[0].variance, -6);
  assert.equal(S.stockOf(db, FF), 174);

  assert.equal(S.setItemUnit(db, mgr, FF, { unit: 'carton' }).unit, 'carton');
  assert.throws(() => S.setItemUnit(db, mgr, FF, { unit: '' }), /Unit is required/);
  assert.throws(() => db.prepare('UPDATE inventory_transactions SET quantity=1').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM inventory_transactions').run(), /append-only/);
});

test('factory: separate orders, isolation between managers, production, accountant filter', () => {
  const { db, mgr, fmgr, acc, user, item, branch, driver } = setup();
  const jish = user('jish@spicymeal.sa');
  const FF = item('W0001'), WINGS = item('F0006'), NUG = item('F0010'), RAW = item('FR001');

  // Branch: one order per source on the same day; items must match the source; raw is not orderable
  const wo = S.saveBranchOrder(db, jish, { date: D, source: 1, submit: true, lines: [{ item_id: FF, quantity: 5 }] });
  assert.throws(() => S.saveBranchOrder(db, jish, { date: D, source: 2, submit: true, lines: [{ item_id: FF, quantity: 5 }] }), /not supplied by this source/);
  assert.throws(() => S.saveBranchOrder(db, jish, { date: D, source: 2, submit: true, lines: [{ item_id: RAW, quantity: 5 }] }), /Unknown or inactive/);
  const fo = S.saveBranchOrder(db, jish, { date: D, source: 2, submit: true, lines: [{ item_id: WINGS, quantity: 30 }, { item_id: NUG, quantity: 10 }] });
  assert.notEqual(wo.id, fo.id);
  assert.equal(fo.source_name, 'Factory');
  assert.equal(S.listItems(db, { warehouse_id: 2, orderableOnly: true }).length, 33);

  // Isolation: each manager sees and touches only his own source
  assert.deepEqual(S.listOrders(db, mgr, { date: D }).map((o) => o.id), [wo.id]);
  assert.deepEqual(S.listOrders(db, fmgr, { date: D }).map((o) => o.id), [fo.id]);
  assert.throws(() => S.getOrder(db, mgr, fo.id), /not found/i);
  assert.throws(() => S.acceptOrder(db, mgr, fo.id, { lines: [] }), /not found/i);
  assert.throws(() => S.rejectOrder(db, fmgr, wo.id, { reason: 'x' }), /not found/i);
  assert.throws(() => S.itemLedger(db, mgr, WINGS), /not found/i);
  assert.throws(() => S.supplierReceipt(db, mgr, { supplier_name: 'X', date: D, lines: [{ item_id: RAW, quantity: 1 }] }), /Unknown/);
  assert.throws(() => S.confirmStockCount(db, fmgr, { date: D, reason: 'r', lines: [{ item_id: FF, physical_quantity: 1 }] }), /Unknown/);

  // Factory buys raw chicken, cuts it, stock updates
  S.supplierReceipt(db, fmgr, { supplier_name: 'Al Watania Poultry', date: D, lines: [{ item_id: RAW, quantity: 100 }] });
  assert.equal(S.stockOf(db, RAW), 100);
  const p = S.recordProduction(db, fmgr, { date: D, notes: 'Morning cut', inputs: [{ item_id: RAW, quantity: 40 }], outputs: [{ item_id: WINGS, quantity: 160 }, { item_id: NUG, quantity: 50 }] });
  assert.deepEqual([p.used, p.produced], [1, 2]);
  assert.equal(S.stockOf(db, RAW), 60);
  assert.equal(S.stockOf(db, WINGS), 160);
  assert.throws(() => S.recordProduction(db, fmgr, { date: D, inputs: [{ item_id: RAW, quantity: 1 }], outputs: [] }), /at least one produced/);
  assert.throws(() => S.recordProduction(db, mgr, { date: D, outputs: [{ item_id: WINGS, quantity: 1 }] }), /Unknown/);
  assert.equal(S.listProduction(db, fmgr).length, 1);
  assert.equal(S.listProduction(db, mgr).length, 0);
  assert.equal(S.inventory(db, fmgr).length, 34);
  assert.equal(S.inventory(db, mgr).length, 87);

  // Factory flow to the branch — same drivers, own picking list
  S.acceptOrder(db, fmgr, fo.id, { lines: [{ item_id: WINGS, accepted_quantity: 25 }] });
  assert.equal(S.stockOf(db, WINGS), 135);
  assert.equal(S.stockOf(db, NUG), 40, 'untouched line accepted at requested qty');
  const l = S.itemLedger(db, fmgr, WINGS);
  assert.equal(l.transactions[0].warehouse_id ?? 2, 2);
  assert.equal(db.prepare('SELECT DISTINCT warehouse_id w FROM inventory_transactions WHERE item_id=?').get(WINGS).w, 2);
  S.applyDefaultRoutes(db, fmgr, D);
  assert.equal(S.getOrder(db, fmgr, fo.id).driver_id, driver('Driver 1'));
  assert.equal(S.getOrder(db, mgr, wo.id).status, 'SUBMITTED', 'factory routes did not touch warehouse order');
  assert.equal(S.picking(db, mgr, D).drivers.flatMap((d) => d.orders).length, 0);
  assert.throws(() => S.dispatch(db, mgr, { order_ids: [fo.id] }), /not found/i);
  S.dispatch(db, fmgr, { order_ids: [fo.id] });
  S.confirmReceiving(db, jish, fo.id, { lines: [{ item_id: WINGS, received_quantity: 24 }, { item_id: NUG, received_quantity: 0 }] });
  assert.equal(S.managerHome(db, fmgr).counts.receiving_differences, 1);
  assert.equal(S.managerHome(db, mgr).counts.receiving_differences, 0);

  // Accountant: both sources or one
  S.acceptOrder(db, mgr, wo.id, { lines: [] });
  const all = S.acceptedReport(db, acc, { branch_id: branch('Jish'), from: D, to: D });
  assert.deepEqual(all.items.map((i) => [i.item_code, i.accepted_quantity]), [['W0001', 5], ['F0006', 25], ['F0010', 10]]);
  const fac = S.acceptedReport(db, acc, { branch_id: branch('Jish'), from: D, to: D, source: 2 });
  assert.deepEqual(fac.items.map((i) => i.item_code), ['F0006', 'F0010']);
  assert.equal(fac.orders.length, 1);
  const home = S.branchHome(db, jish);
  assert.deepEqual(home.today_orders.map((t) => t.order?.status), ['ACCEPTED', 'RECEIVED']);
});

test('migration from the warehouse-only database keeps data', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-mig-'));
  const file = path.join(dir, 'v1.db');
  // Build a minimal v1 database: old orders table (unique branch+date), old ledger CHECK, no warehouse columns.
  const v1 = new DatabaseSync(file);
  v1.exec(`
    CREATE TABLE warehouses (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE drivers (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, phone TEXT, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, branch_code TEXT NOT NULL UNIQUE, branch_name TEXT NOT NULL UNIQUE, default_driver_id INTEGER, default_sequence INTEGER, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL, branch_id INTEGER, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE items (id INTEGER PRIMARY KEY, item_code TEXT NOT NULL UNIQUE, item_name TEXT NOT NULL, item_name_ar TEXT, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'unit', sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE suppliers (id INTEGER PRIMARY KEY, supplier_name TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id), order_date TEXT NOT NULL, status TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, submitted_at TEXT, accepted_by INTEGER, accepted_at TEXT, dispatched_at TEXT, reject_reason TEXT, UNIQUE (branch_id, order_date));
    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), item_id INTEGER NOT NULL, requested_quantity INTEGER NOT NULL, accepted_quantity INTEGER, UNIQUE (order_id, item_id));
    CREATE TABLE supplier_receipts (id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL, received_date TEXT NOT NULL, received_by INTEGER NOT NULL, created_at TEXT NOT NULL, notes TEXT);
    CREATE TABLE inventory_transactions (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, transaction_type TEXT NOT NULL CHECK (transaction_type IN ('SUPPLIER_RECEIPT','BRANCH_ORDER_ACCEPTED','BRANCH_ORDER_REVISION','STOCK_ADJUSTMENT')), quantity INTEGER NOT NULL, direction INTEGER NOT NULL, reference_type TEXT NOT NULL, reference_id INTEGER NOT NULL, warehouse_id INTEGER NOT NULL, branch_id INTEGER, note TEXT, created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TRIGGER tx_no_delete BEFORE DELETE ON inventory_transactions BEGIN SELECT RAISE(ABORT, 'inventory_transactions is append-only'); END;
    INSERT INTO warehouses VALUES (1, 'Central Warehouse', 1);
    INSERT INTO branches (id, branch_code, branch_name) VALUES (1, 'B16', 'Jish');
    INSERT INTO users VALUES (1, 'Warehouse Manager', 'warehouse@spicymeal.sa', 'x', 'WAREHOUSE_MANAGER', NULL, 1), (2, 'Jish Branch', 'jish@spicymeal.sa', 'x', 'BRANCH', 1, 1);
    INSERT INTO items (id, item_code, item_name, category) VALUES (1, 'W0001', 'French fries', 'Frozen Items');
    INSERT INTO orders VALUES (7, 1, '${D}', 'ACCEPTED', 2, 'now', 'now', 1, 'now', NULL, NULL);
    INSERT INTO order_items VALUES (1, 7, 1, 20, 15);
    INSERT INTO inventory_transactions VALUES (1, 1, 'STOCK_ADJUSTMENT', 100, 1, 'STOCK_COUNT', 1, 1, NULL, 'Opening', 1, 'now'), (2, 1, 'BRANCH_ORDER_ACCEPTED', 15, -1, 'ORDER', 7, 1, 1, NULL, 1, 'now');`);
  v1.close();
  const { db, migrated } = openDb(file);
  assert.equal(migrated, true);
  const mgr = db.prepare("SELECT * FROM users WHERE email='warehouse@spicymeal.sa'").get();
  assert.equal(mgr.warehouse_id, 1);
  assert.equal(S.stockOf(db, 1), 85);
  assert.equal(S.getOrder(db, mgr, 7).lines[0].accepted_quantity, 15);
  assert.equal(S.getOrder(db, mgr, 7).source_name, 'Central Warehouse');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items WHERE warehouse_id=2 AND active=1').get().n, 34);
  assert.throws(() => db.prepare('DELETE FROM inventory_transactions').run(), /append-only/);
  // Jish can now also order from the factory on the same date
  const jish = db.prepare("SELECT * FROM users WHERE email='jish@spicymeal.sa'").get();
  const wings = db.prepare("SELECT id FROM items WHERE item_code='F0006'").get().id;
  S.saveBranchOrder(db, jish, { date: D, source: 2, submit: true, lines: [{ item_id: wings, quantity: 3 }] });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 2);
  db.close();
  assert.equal(openDb(file).migrated, false, 'second start does not migrate again');
});

test('branch open-order rules: edit until accepted, one open order per source', () => {
  const { db, mgr, fmgr, user, item } = setup();
  const jish = user('jish@spicymeal.sa');
  const FF = item('W0001'), OIL = item('W0009'), WINGS = item('F0006');
  const T = S.today();
  const next = (n) => { const x = new Date(T + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  let info = S.newOrderInfo(db, jish, 1);
  assert.equal(info.open_order, null);
  assert.equal(info.suggested_date, T);

  const o = S.saveBranchOrder(db, jish, { date: T, source: 1, submit: true, lines: [{ item_id: FF, quantity: 10 }] });
  assert.equal(o.status, 'SUBMITTED');
  // Edit a submitted order: stays submitted, lines replaced, no stock movement
  const e = S.saveBranchOrder(db, jish, { order_id: o.id, lines: [{ item_id: FF, quantity: 12 }, { item_id: OIL, quantity: 3 }] });
  assert.equal(e.status, 'SUBMITTED');
  assert.deepEqual(e.lines.map((l) => l.requested_quantity), [12, 3]);
  assert.throws(() => S.saveBranchOrder(db, jish, { order_id: o.id, lines: [] }), /at least one/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, 0);
  // Cannot add items from the other source to it
  assert.throws(() => S.saveBranchOrder(db, jish, { order_id: o.id, lines: [{ item_id: WINGS, quantity: 1 }] }), /not supplied/);

  // A new warehouse order is refused while this one is open (any date)…
  info = S.newOrderInfo(db, jish, 1);
  assert.equal(info.open_order.id, o.id);
  assert.throws(() => S.saveBranchOrder(db, jish, { date: next(1), source: 1, submit: false, lines: [{ item_id: FF, quantity: 1 }] }), /open order/);
  // …but the factory is still free
  assert.equal(S.newOrderInfo(db, jish, 2).open_order, null);
  const f = S.saveBranchOrder(db, jish, { date: T, source: 2, submit: false, lines: [{ item_id: WINGS, quantity: 4 }] });
  assert.equal(f.status, 'DRAFT');
  assert.equal(S.newOrderInfo(db, jish, 2).open_order.id, f.id, 'a draft also counts as open');

  // Another branch's order cannot be edited
  assert.throws(() => S.saveBranchOrder(db, user('awjam@spicymeal.sa'), { order_id: o.id, lines: [{ item_id: FF, quantity: 1 }] }), /not found/i);

  // After acceptance: locked, and a new warehouse order is allowed — today is taken, so tomorrow is suggested
  S.confirmStockCount(db, mgr, { date: T, reason: 'Opening', lines: [{ item_id: FF, physical_quantity: 50 }, { item_id: OIL, physical_quantity: 50 }] });
  S.acceptOrder(db, mgr, o.id, { lines: [] });
  assert.throws(() => S.saveBranchOrder(db, jish, { order_id: o.id, lines: [{ item_id: FF, quantity: 1 }] }), /already accepted/);
  info = S.newOrderInfo(db, jish, 1);
  assert.equal(info.open_order, null);
  assert.equal(info.suggested_date, next(1));
  assert.throws(() => S.saveBranchOrder(db, jish, { date: T, source: 1, lines: [{ item_id: FF, quantity: 1 }] }), /choose another date/);
  const o2 = S.saveBranchOrder(db, jish, { date: next(1), source: 1, submit: true, lines: [{ item_id: FF, quantity: 2 }] });
  assert.equal(o2.status, 'SUBMITTED');

  // Manager accepting while the branch changed the lines gets a clear message
  S.saveBranchOrder(db, jish, { order_id: o2.id, lines: [{ item_id: OIL, quantity: 2 }] });
  assert.throws(() => S.acceptOrder(db, mgr, o2.id, { lines: [{ item_id: FF, accepted_quantity: 2 }] }), /branch changed this order/);
  assert.ok(fmgr);
});

test('drivers: route, pickup, delivery, tasks, tracking', () => {
  const { db, mgr, fmgr, user, item, driver } = setup();
  const T = S.today();
  const d1 = user('driver1@spicymeal.sa'), d2 = user('driver2@spicymeal.sa');
  assert.equal(d1.driver_id, driver('Driver 1'));
  const jish = user('jish@spicymeal.sa'), awjam = user('awjam@spicymeal.sa');
  const FF = item('W0001'), WINGS = item('F0006');
  S.confirmStockCount(db, mgr, { date: T, reason: 'Opening', lines: [{ item_id: FF, physical_quantity: 100 }] });
  const a = S.saveBranchOrder(db, jish, { date: T, source: 1, submit: true, lines: [{ item_id: FF, quantity: 10 }] });
  const b = S.saveBranchOrder(db, awjam, { date: T, source: 1, submit: true, lines: [{ item_id: FF, quantity: 5 }] });
  const f = S.saveBranchOrder(db, jish, { date: T, source: 2, submit: true, lines: [{ item_id: WINGS, quantity: 8 }] });
  [a, b].forEach((o) => S.acceptOrder(db, mgr, o.id, { lines: [] }));
  S.acceptOrder(db, fmgr, f.id, { lines: [] });
  S.applyDefaultRoutes(db, mgr, T);   // Jish + Awjam → Driver 1
  S.applyDefaultRoutes(db, fmgr, T);  // Jish factory → Driver 1

  let r = S.driverRoute(db, d1);
  assert.equal(r.stops.length, 3);
  assert.deepEqual(r.pickups.map((p) => p.source_code).sort(), ['FAC', 'WH']);
  const whPick = r.pickups.find((p) => p.source_code === 'WH');
  assert.equal(whPick.totals.find((x) => x.item_code === 'W0001').quantity, 15);
  assert.equal(S.driverRoute(db, d2).stops.length, 0, 'other driver sees nothing');

  // cannot deliver before loading; cannot touch another driver's stop
  assert.throws(() => S.driverDeliver(db, d1, a.id), /Load this order/);
  assert.throws(() => S.driverDeliver(db, d2, a.id), /not found/i);
  assert.throws(() => S.driverPickup(db, d2, { source: 1, date: T }), /Nothing to load/);
  assert.equal(S.driverPickup(db, d1, { source: 1, date: T }).loaded, 2);
  assert.equal(S.getOrder(db, mgr, a.id).status, 'DISPATCHED');
  assert.equal(S.getOrder(db, mgr, a.id).dispatched_by_name, 'Driver 1');
  assert.equal(S.getOrder(db, fmgr, f.id).status, 'ASSIGNED', 'factory not loaded yet');
  S.driverDeliver(db, d1, a.id);
  assert.throws(() => S.driverDeliver(db, d1, a.id), /Already/);
  assert.ok(S.getOrder(db, mgr, a.id).delivered_at);
  assert.equal(S.getOrder(db, mgr, a.id).status, 'DISPATCHED', 'branch still has to confirm');
  r = S.driverRoute(db, d1);
  assert.deepEqual(r.stops.map((x) => x.stage).sort(), ['DELIVERED', 'ON_THE_WAY', 'TO_LOAD']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, 4, 'driver actions post no stock (opening + 3 acceptances)');

  // branch receives with a shortage → counted against the driver
  S.confirmReceiving(db, jish, a.id, { lines: [{ item_id: FF, received_quantity: 8 }] });
  S.driverDeliver(db, d1, b.id);
  S.confirmReceiving(db, awjam, b.id, { lines: [{ item_id: FF, received_quantity: 5 }] });

  // tasks: warehouse manager only
  assert.throws(() => S.createTask(db, fmgr, { driver_id: d1.driver_id, title: 'x' }), /warehouse manager/);
  assert.throws(() => S.createTask(db, mgr, { driver_id: d1.driver_id, title: '' }), /title/);
  const yesterday = (() => { const x = new Date(T + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); })();
  const t1 = S.createTask(db, mgr, { driver_id: d1.driver_id, title: 'Pick up cups from ABC Food', due_date: T });
  const t2 = S.createTask(db, mgr, { driver_id: d1.driver_id, title: 'Car wash', due_date: yesterday });
  const t3 = S.createTask(db, mgr, { driver_id: d1.driver_id, title: 'Fuel' });
  assert.equal(S.listTasks(db, d1).length, 3);
  assert.equal(S.listTasks(db, d2).length, 0);
  assert.throws(() => S.completeTask(db, d2, t1.id), /not found/i);
  S.completeTask(db, d1, t1.id, { note: '2 cartons' });
  assert.throws(() => S.completeTask(db, d1, t1.id), /already done/);
  S.cancelTask(db, mgr, t3.id);
  assert.throws(() => S.cancelTask(db, mgr, t3.id), /Only open/);

  const st = S.driverStats(db, mgr, {}).drivers.find((x) => x.id === d1.driver_id);
  assert.equal(st.stops, 2);
  assert.equal(st.delivered, 2);
  assert.equal(st.diff_orders, 1);
  assert.equal(st.units_short, 2);
  assert.deepEqual([st.tasks_assigned, st.tasks_done, st.tasks_open, st.tasks_overdue], [2, 1, 1, 1]);
  assert.equal(st.login, 'driver1@spicymeal.sa');
  const prof = S.driverProfile(db, mgr, d1.driver_id, {});
  assert.equal(prof.deliveries.find((x) => x.id === a.id).net_short, 2);
  assert.equal(prof.tasks.find((x) => x.id === t2.id).overdue, 1);
  assert.throws(() => S.driverRoute(db, mgr), /Driver login required/);

  // add a driver with a login; rename keeps login in sync
  const nd = S.addDriver(db, mgr, { name: 'Driver 4', phone: '0550000000', email: 'driver4@spicymeal.sa', password: 'Secret123' });
  assert.equal(user('driver4@spicymeal.sa').driver_id, nd.id);
  assert.throws(() => S.addDriver(db, mgr, { name: 'Driver 5', email: 'driver4@spicymeal.sa', password: 'Secret123' }), /already used/);
  S.updateDriver(db, mgr, nd.id, { name: 'Faisal', phone: '0551111111' });
  assert.equal(user('driver4@spicymeal.sa').name, 'Faisal');
});

test('item master sync: renames by code, deactivates removed codes, keeps units and history', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wms-items-')), 'x.db');
  let { db } = openDb(file);
  const mgr = db.prepare("SELECT * FROM users WHERE email='warehouse@spicymeal.sa'").get();
  // simulate an older list: an extra code that no longer exists, an old name, a manager-set unit
  db.prepare("INSERT INTO items (item_code, item_name, category, warehouse_id) VALUES ('W0016','Mixed fruit juice','Beverages',1)").run();
  const oldId = db.prepare("SELECT id FROM items WHERE item_code='W0016'").get().id;
  S.confirmStockCount(db, mgr, { date: D, reason: 'Opening', lines: [{ item_id: oldId, physical_quantity: 5 }] });
  db.prepare("UPDATE items SET item_name='Clorox OLD', unit='carton' WHERE item_code='W0057'").run();
  db.prepare("UPDATE app_meta SET value='old' WHERE key='items_version'").run();
  db.close();
  ({ db } = openDb(file));
  const w16 = db.prepare("SELECT * FROM items WHERE item_code='W0016'").get();
  assert.equal(w16.active, 0);
  assert.equal(S.stockOf(db, w16.id), 5, 'history kept');
  assert.ok(!S.listItems(db, { warehouse_id: 1 }).some((i) => i.item_code === 'W0016'));
  const clorox = db.prepare("SELECT * FROM items WHERE item_code='W0057'").get();
  assert.equal(clorox.item_name, 'Clorox');
  assert.equal(clorox.unit, 'carton', 'unit kept');
  db.close();
});

test('reorder level alerts', () => {
  const { db, mgr, fmgr, user, item } = setup();
  const FF = item('W0001'), OIL = item('W0009'), SALT = item('W0011'), WINGS = item('F0011');
  S.confirmStockCount(db, mgr, { date: D, reason: 'Opening', lines: [{ item_id: FF, physical_quantity: 100 }, { item_id: OIL, physical_quantity: 50 }, { item_id: SALT, physical_quantity: 0 }] });
  assert.equal(S.setReorderLevel(db, mgr, FF, { reorder_level: 30 }).reorder_level, 30);
  S.setReorderLevel(db, mgr, OIL, { reorder_level: 10 });
  S.setReorderLevel(db, mgr, SALT, { reorder_level: 5 });
  assert.throws(() => S.setReorderLevel(db, fmgr, FF, { reorder_level: 5 }), /not found/i, 'factory manager cannot set warehouse levels');
  assert.throws(() => S.setReorderLevel(db, mgr, FF, { reorder_level: -1 }), /Invalid/);
  let h = S.managerHome(db, mgr);
  assert.deepEqual(h.alerts.map((a) => [a.item_code, a.kind]), [['W0011', 'OUT']]);
  assert.equal(h.counts.to_reorder, 1);

  // accepting an order takes fries from 100 to 25 → at/below 30 → REORDER
  const o = S.saveBranchOrder(db, user('jish@spicymeal.sa'), { date: D, source: 1, submit: true, lines: [{ item_id: FF, quantity: 75 }] });
  S.acceptOrder(db, mgr, o.id, { lines: [] });
  h = S.managerHome(db, mgr);
  assert.deepEqual(h.alerts.map((a) => [a.item_code, a.kind]), [['W0011', 'OUT'], ['W0001', 'REORDER']]);
  assert.equal(h.alerts[1].reorder_level, 30);
  assert.equal(h.counts.to_reorder, 2);
  const inv = S.inventory(db, mgr);
  assert.equal(inv.find((i) => i.id === FF).needs_reorder, true);
  assert.equal(inv.find((i) => i.id === OIL).needs_reorder, false);
  // exactly at the level also alerts
  S.confirmStockCount(db, mgr, { date: D, reason: 'Count', lines: [{ item_id: OIL, physical_quantity: 10 }] });
  assert.ok(S.managerHome(db, mgr).alerts.some((a) => a.item_code === 'W0009' && a.kind === 'REORDER'));
  // receiving stock clears it; clearing the level removes the alert
  S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: D, lines: [{ item_id: FF, quantity: 100 }] });
  S.setReorderLevel(db, mgr, OIL, { reorder_level: '' });
  assert.deepEqual(S.managerHome(db, mgr).alerts.map((a) => a.item_code), ['W0011']);
  assert.equal(S.managerHome(db, mgr).counts.to_reorder, 1);
  // factory alerts are separate
  S.setReorderLevel(db, fmgr, WINGS, { reorder_level: 20 });
  S.confirmStockCount(db, fmgr, { date: D, reason: 'Opening', lines: [{ item_id: WINGS, physical_quantity: 12 }] });
  assert.deepEqual(S.managerHome(db, fmgr).alerts.map((a) => [a.item_code, a.kind]), [['F0011', 'REORDER']]);
  assert.ok(!S.managerHome(db, mgr).alerts.some((a) => a.item_code === 'F0011'));
});

test('finance: costs, valued reports, statement, stock value, history of prices', () => {
  const { db, mgr, fmgr, acc, cfo, user, item, branch } = setup();
  const FF = item('W0001'), OIL = item('W0009'), WINGS = item('F0011');
  const jish = user('jish@spicymeal.sa');
  const prev = S.addDays(D, -1);
  assert.equal(S.money('12.5'), 1250);
  assert.equal(S.money('1,234.05'), 123405);
  assert.throws(() => S.money('1.234'), /Invalid/);
  // only the accountant sets costs
  assert.throws(() => F.setItemCosts(db, cfo, { lines: [{ item_id: FF, unit_cost: '1' }] }), /Only the accountant/);
  assert.throws(() => F.listItemCosts(db, mgr, {}), /Accounts access/);
  F.setItemCosts(db, acc, { effective_from: prev, lines: [{ item_id: FF, unit_cost: '40' }, { item_id: OIL, unit_cost: '12.50' }, { item_id: WINGS, unit_cost: '18' }] });
  F.setItemCosts(db, acc, { effective_from: D, lines: [{ item_id: FF, unit_cost: '45' }] });
  assert.equal(F.setItemCosts(db, acc, { effective_from: D, lines: [{ item_id: FF, unit_cost: '45' }] }).saved, 0, 'unchanged cost not duplicated');
  const costs = F.listItemCosts(db, acc, {});
  assert.equal(costs.find((c) => c.id === FF).unit_cost_h, 4500);
  assert.equal(F.listItemCosts(db, acc, { date: prev }).find((c) => c.id === FF).unit_cost_h, 4000, 'old cost kept by date');
  assert.equal(F.costHistory(db, acc, FF).length, 2);

  S.confirmStockCount(db, mgr, { date: prev, reason: 'Opening', lines: [{ item_id: FF, physical_quantity: 100 }, { item_id: OIL, physical_quantity: 50 }] });
  S.confirmStockCount(db, fmgr, { date: prev, reason: 'Opening', lines: [{ item_id: WINGS, physical_quantity: 80 }] });
  // yesterday: 10 fries at 40; today: 5 fries at 45 + 2 oil at 12.50; factory 4 wings at 18
  const o1 = S.saveBranchOrder(db, jish, { date: prev, source: 1, submit: true, lines: [{ item_id: FF, quantity: 10 }] });
  S.acceptOrder(db, mgr, o1.id, { lines: [] });
  const o2 = S.saveBranchOrder(db, jish, { date: D, source: 1, submit: true, lines: [{ item_id: FF, quantity: 5 }, { item_id: OIL, quantity: 2 }] });
  S.acceptOrder(db, mgr, o2.id, { lines: [] });
  const o3 = S.saveBranchOrder(db, jish, { date: D, source: 2, submit: true, lines: [{ item_id: WINGS, quantity: 4 }] });
  S.acceptOrder(db, fmgr, o3.id, { lines: [] });

  const rep = F.valueAcceptedReport(db, acc, S.acceptedReport(db, acc, { branch_id: branch('Jish'), from: prev, to: D }));
  assert.equal(rep.items.find((i) => i.item_code === 'W0001').value_h, 10 * 4000 + 5 * 4500);
  assert.equal(rep.total_value_h, 62500 + 2 * 1250 + 4 * 1800);
  const mrep = F.valueAcceptedReport(db, mgr, S.acceptedReport(db, mgr, { branch_id: branch('Jish'), from: prev, to: D }));
  assert.equal(mrep.total_value_h, undefined, 'managers do not see values');

  const sum = F.branchesSummary(db, cfo, { from: prev, to: D });
  const j = sum.branches.find((b) => b.branch_name === 'Jish');
  assert.deepEqual([j.wh_value_h, j.fac_value_h, j.total_value_h, j.wh_orders, j.fac_orders], [65000, 7200, 72200, 2, 1]);
  assert.equal(sum.totals.total_value_h, 72200);

  const st = F.branchStatement(db, acc, { branch_id: branch('Jish'), month: D.slice(0, 7) });
  assert.equal(st.company.company_name, 'SpicyMeal');
  assert.ok(st.orders.length >= 2);

  const sv = F.stockValue(db, acc, { date: D, source: 1 });
  assert.equal(sv.items.find((i) => i.id === FF).quantity, 85);
  assert.equal(sv.items.find((i) => i.id === FF).value_h, 85 * 4500);
  const svPrev = F.stockValue(db, acc, { date: S.addDays(D, -2), source: 1 });
  assert.equal(svPrev.items.find((i) => i.id === FF).quantity, 0, 'stock before the opening count');
  assert.throws(() => F.stockValue(db, mgr, {}), /Accounts access/);
});

test('finance: supplier invoices, payment requests and CFO workflow', () => {
  const { db, mgr, fmgr, acc, cfo, item } = setup();
  const FF = item('W0001'), RAW = item('FR001');
  F.saveSupplier(db, acc, null, { supplier_name: 'Al Watania Poultry', vat_number: '300000000000003', iban: 'SA03 8000 0000 6080 1016 7519', payment_terms_days: 30 });
  assert.throws(() => F.saveSupplier(db, acc, null, { supplier_name: 'X', iban: '123' }), /IBAN/);
  assert.throws(() => F.saveSupplier(db, mgr, null, { supplier_name: 'Y' }), /Only the accountant/);
  // manager receives with invoice + prices; another without prices
  const r1 = S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', invoice_no: 'INV-100', date: D, lines: [{ item_id: FF, quantity: 10, unit_price: '40' }] });
  const r2 = S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: D, lines: [{ item_id: FF, quantity: 5 }] });
  const r3 = S.supplierReceipt(db, fmgr, { supplier_name: 'Al Watania Poultry', invoice_no: 'W-9', date: D, lines: [{ item_id: RAW, quantity: 100, unit_price: '9.75' }] });
  assert.throws(() => S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: D, lines: [{ item_id: FF, quantity: 1, unit_price: 'abc' }] }), /Invalid unit price/);
  const inv = F.listSupplierInvoices(db, acc, { from: D, to: D });
  assert.deepEqual(inv.receipts.map((r) => [r.id, r.state]).sort(), [[r1.id, 'TO_CHECK'], [r2.id, 'INCOMPLETE'], [r3.id, 'TO_CHECK']].sort());
  assert.equal(inv.receipts.find((r) => r.id === r1.id).total_h, 40000);

  // cannot check an incomplete invoice; accountant completes it
  assert.throws(() => F.setInvoiceMatched(db, acc, r2.id, { matched: true }), /invoice number/);
  F.updateSupplierInvoice(db, acc, r2.id, { invoice_no: 'INV-101', lines: [{ item_id: FF, unit_price: '41.50' }] });
  F.setInvoiceMatched(db, acc, r1.id, { matched: true });
  F.setInvoiceMatched(db, acc, r2.id, { matched: true, note: 'Price per invoice' });
  assert.throws(() => F.updateSupplierInvoice(db, acc, r2.id, { invoice_no: 'X' }), /Un-check/);

  const abc = db.prepare("SELECT id FROM suppliers WHERE supplier_name='ABC Food'").get().id;
  const wat = db.prepare("SELECT id FROM suppliers WHERE supplier_name='Al Watania Poultry'").get().id;
  assert.equal(F.payableReceipts(db, acc, { supplier_id: abc }).filter((r) => r.ready).length, 2);
  assert.throws(() => F.createPaymentRequest(db, acc, { supplier_id: abc, receipt_ids: [r3.id] }), /not available/);
  assert.throws(() => F.createPaymentRequest(db, acc, { supplier_id: wat, receipt_ids: [r3.id] }), /checked/);
  assert.throws(() => F.createPaymentRequest(db, cfo, { supplier_id: abc, receipt_ids: [r1.id] }), /Only the accountant/);

  const pr = F.createPaymentRequest(db, acc, { supplier_id: abc, receipt_ids: [r1.id, r2.id], add_vat: true, notes: 'September' });
  assert.match(pr.number, /^PR-\d{4}-0001$/);
  assert.equal(pr.subtotal_h, 40000 + 5 * 4150);
  assert.equal(pr.vat_h, Math.round(pr.subtotal_h * 0.15));
  assert.equal(pr.total_h, pr.subtotal_h + pr.vat_h);
  assert.equal(pr.receipts.length, 2);
  assert.equal(pr.receipts[0].lines[0].item_code, 'W0001');
  assert.equal(pr.company.company_name, 'SpicyMeal');
  // receipts are locked into the request
  assert.throws(() => F.createPaymentRequest(db, acc, { supplier_id: abc, receipt_ids: [r1.id] }), /not available/);
  assert.throws(() => F.updateSupplierInvoice(db, acc, r1.id, { invoice_no: 'Z' }), /payment request/);
  assert.equal(F.listSupplierInvoices(db, acc, { from: D, to: D }).receipts.find((r) => r.id === r1.id).state, 'IN_REQUEST');

  // CFO: approve → paid; accountant cannot approve; paid needs a reference
  assert.throws(() => F.approveRequest(db, acc, pr.id), /Only the CFO/);
  assert.throws(() => F.markPaid(db, cfo, pr.id, { payment_ref: 'T1', paid_from: 'X' }), /submitted/);
  F.approveRequest(db, cfo, pr.id);
  assert.throws(() => F.cancelRequest(db, acc, pr.id), /approved/);
  assert.throws(() => F.markPaid(db, cfo, pr.id, { paid_from: 'X' }), /reference/);
  assert.throws(() => F.markPaid(db, cfo, pr.id, { payment_ref: 'TRF-555' }), /bank account/);
  const paid = F.markPaid(db, cfo, pr.id, { payment_ref: 'TRF-555', paid_date: D, paid_from: 'Al Rajhi Bank · SA12' });
  assert.equal(paid.paid_from, 'Al Rajhi Bank · SA12');
  assert.equal(paid.status, 'PAID');
  assert.deepEqual(paid.history.map((h) => h.action), ['PAYMENT_REQUESTED', 'PAYMENT_APPROVED', 'PAYMENT_PAID']);
  assert.equal(F.listSupplierInvoices(db, acc, { from: D, to: D }).receipts.find((r) => r.id === r1.id).state, 'PAID');

  // rejection releases receipts
  F.setInvoiceMatched(db, acc, r3.id, { matched: true });
  const pr2 = F.createPaymentRequest(db, acc, { supplier_id: wat, receipt_ids: [r3.id], add_vat: false });
  assert.equal(pr2.vat_h, 0);
  assert.equal(pr2.number.endsWith('0002'), true);
  assert.equal(pr2.due_date, S.addDays(S.today(), 30), 'due date from supplier payment terms');
  assert.throws(() => F.rejectRequest(db, cfo, pr2.id, {}), /reason/);
  F.rejectRequest(db, cfo, pr2.id, { reason: 'Wrong invoice amount' });
  assert.equal(F.payableReceipts(db, acc, { supplier_id: wat }).length, 1, 'receipt available again');
  const home = F.financeHome(db, cfo);
  assert.equal(home.paid_this_month_h > 0 || D.slice(0, 7) !== S.today().slice(0, 7), true);
});

test('finance: factory yield, month-end lock, change log', () => {
  const { db, mgr, fmgr, acc, cfo, user, item } = setup();
  const RAW = item('FR001'), WINGS = item('F0011'), DRUM = item('F0013'), FF = item('W0001');
  S.recordProduction(db, fmgr, { date: D, inputs: [{ item_id: RAW, quantity: 50 }], outputs: [{ item_id: WINGS, quantity: 200 }, { item_id: DRUM, quantity: 100 }] });
  const y = F.factoryYield(db, acc, { from: D, to: D });
  assert.equal(y.totals.used, 50);
  assert.equal(y.totals.produced, 300);
  assert.equal(y.totals.per_raw_unit, 6);
  assert.equal(y.outputs.find((o) => o.item_code === 'F0011').per_raw_unit, 4);

  // lock a past month
  const lastMonth = (() => { const d = new Date(D + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const inLast = `${lastMonth}-15`;
  S.confirmStockCount(db, mgr, { date: inLast, reason: 'Opening', lines: [{ item_id: FF, physical_quantity: 10 }] });
  assert.throws(() => F.lockPeriod(db, mgr, { month: lastMonth }), /Only the accountant/);
  assert.throws(() => F.lockPeriod(db, acc, { month: '2999-01' }), /future/);
  F.lockPeriod(db, acc, { month: lastMonth });
  assert.throws(() => F.lockPeriod(db, acc, { month: lastMonth }), /already closed/);
  assert.ok(F.listPeriods(db, cfo).find((p) => p.month === lastMonth).locked);
  // every quantity/stock/price change dated in that month is refused
  assert.throws(() => S.confirmStockCount(db, mgr, { date: inLast, reason: 'x', lines: [{ item_id: FF, physical_quantity: 1 }] }), /closed/);
  assert.throws(() => S.supplierReceipt(db, mgr, { supplier_name: 'ABC Food', date: inLast, lines: [{ item_id: FF, quantity: 1 }] }), /closed/);
  assert.throws(() => S.saveBranchOrder(db, user('jish@spicymeal.sa'), { date: inLast, source: 1, submit: true, lines: [{ item_id: FF, quantity: 1 }] }), /closed/);
  assert.throws(() => S.recordProduction(db, fmgr, { date: inLast, outputs: [{ item_id: WINGS, quantity: 1 }] }), /closed/);
  assert.throws(() => F.setItemCosts(db, acc, { effective_from: inLast, lines: [{ item_id: FF, unit_cost: '1' }] }), /closed/);
  assert.throws(() => F.setItemCosts(db, acc, { effective_from: `${lastMonth}-01`, lines: [{ item_id: FF, unit_cost: '1' }] }), /closed/);
  // today still works
  S.confirmStockCount(db, mgr, { date: D, reason: 'ok', lines: [{ item_id: FF, physical_quantity: 12 }] });
  // reopen needs a reason
  assert.throws(() => F.unlockPeriod(db, acc, { month: lastMonth }), /reason/);
  F.unlockPeriod(db, acc, { month: lastMonth, reason: 'Late supplier invoice' });
  S.confirmStockCount(db, mgr, { date: inLast, reason: 'late', lines: [{ item_id: FF, physical_quantity: 11 }] });

  const log = F.listAudit(db, cfo, { from: S.addDays(D, -60), to: D });
  const acts = log.entries.map((e) => e.action);
  for (const a of ['PRODUCTION', 'STOCK_COUNT', 'PERIOD_LOCKED', 'PERIOD_UNLOCKED']) assert.ok(acts.includes(a), a);
  assert.ok(log.entries.find((e) => e.action === 'PERIOD_UNLOCKED').summary.includes('Late supplier invoice'));
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
  assert.throws(() => F.listAudit(db, mgr, {}), /Accounts access/);
  // order revision is logged with before/after
  const o = S.saveBranchOrder(db, user('jish@spicymeal.sa'), { date: D, source: 1, submit: true, lines: [{ item_id: FF, quantity: 5 }] });
  S.acceptOrder(db, mgr, o.id, { lines: [] });
  S.acceptOrder(db, mgr, o.id, { lines: [{ item_id: FF, accepted_quantity: 3 }] });
  const rev = F.listAudit(db, acc, { action: 'ORDER_REVISED' }).entries[0];
  assert.match(rev.summary, /W0001 5→3/);
});

test('maintenance: requests, scoping, assignment, technician work, close', () => {
  const { db, mgr, fmgr, sup, tech, tech2, acc, user, branch, driver } = setup();
  const jish = user('jish@spicymeal.sa'), awjam = user('awjam@spicymeal.sa'), drv1 = user('driver1@spicymeal.sa');
  // branch request is pinned to its own branch whatever it sends
  const j1 = M.createJob(db, jish, { category: 'LIGHTING', priority: 'HIGH', title: 'Kitchen light flickering', location_type: 'WAREHOUSE', branch_id: branch('Awjam'), kind: 'MANDATORY' });
  assert.equal(j1.location_type, 'BRANCH');
  assert.equal(j1.branch_id, branch('Jish'));
  assert.equal(j1.kind, 'REQUEST', 'only the supervisor creates mandatory jobs');
  assert.equal(j1.status, 'OPEN');
  assert.match(j1.number, /^MJ-\d{4}-0001$/);
  assert.throws(() => M.createJob(db, jish, { category: 'NOPE', title: 'x' }), /category/);
  assert.throws(() => M.createJob(db, tech, { category: 'OTHER', title: 'x' }), /Technicians/);
  assert.throws(() => M.createJob(db, acc, { category: 'OTHER', title: 'x' }), /Accounts/);
  // factory manager request goes to factory; driver needs a vehicle
  const fj = M.createJob(db, fmgr, { category: 'ELECTRICAL', title: 'Cutting machine breaker trips' });
  assert.equal(fj.location_type, 'FACTORY');
  assert.throws(() => M.createJob(db, drv1, { category: 'VEHICLE', title: 'Brakes noisy' }), /vehicle/);
  const van = M.saveAsset(db, sup, null, { name: 'Van 1', kind: 'VEHICLE', tag: 'ABC 1234', location_type: 'COMPANY', driver_id: driver('Driver 1') });
  const dj = M.createJob(db, drv1, { category: 'VEHICLE', title: 'Brakes noisy', asset_id: van.id, priority: 'URGENT' });
  assert.equal(dj.asset_id, van.id);
  // visibility
  assert.equal(M.listJobs(db, jish).length, 1);
  assert.equal(M.listJobs(db, awjam).length, 0);
  assert.throws(() => M.getJob(db, awjam, j1.id), /not found/i);
  assert.equal(M.listJobs(db, mgr).length, 0, 'warehouse manager does not see factory jobs');
  assert.equal(M.listJobs(db, fmgr).length, 1);
  assert.equal(M.listJobs(db, drv1).length, 1);
  assert.equal(M.listJobs(db, sup).length, 3);
  assert.equal(M.listJobs(db, tech).length, 0);
  // requester cannot assign; supervisor assigns → ASSIGNED
  assert.throws(() => M.updateJob(db, jish, j1.id, { tech_id: tech.id }), /supervisor/);
  let j = M.updateJob(db, sup, j1.id, { tech_id: tech.id, due_date: S.addDays(D, -1) });
  assert.equal(j.status, 'ASSIGNED');
  assert.equal(j.overdue, true);
  assert.equal(M.listJobs(db, tech).length, 1);
  assert.throws(() => M.startJob(db, tech2, j1.id), /not found/i, 'other technician cannot see it');
  // requester can no longer cancel once assigned
  assert.throws(() => M.cancelJob(db, jish, j1.id), /cannot cancel/);
  j = M.startJob(db, tech, j1.id);
  assert.equal(j.status, 'IN_PROGRESS');
  M.addNote(db, tech, j1.id, { note: 'Starter replaced, need a new tube' });
  assert.throws(() => M.finishJob(db, tech, j1.id, {}), /what was done/);
  j = M.finishJob(db, tech, j1.id, { work_note: 'Replaced starter and tube' });
  assert.equal(j.status, 'DONE');
  assert.equal(j.can.close, false, 'technician cannot close');
  j = M.sendBack(db, sup, j1.id, { reason: 'Second light still off' });
  assert.equal(j.status, 'IN_PROGRESS');
  M.finishJob(db, tech, j1.id, { work_note: 'Both lights fixed' });
  j = M.closeJob(db, sup, j1.id, { note: 'Checked with branch' });
  assert.equal(j.status, 'CLOSED');
  assert.ok(j.notes.length >= 3);
  assert.ok(j.history.some((h) => /closed/.test(h.summary)));
  // own technician cost (no contractor) is not a bill
  j = M.setJobCost(db, sup, j1.id, { cost: '35.50' });
  assert.equal(j.cost_h, 3550);
  assert.equal(j.bill_state, null);
  // reject / cancel rules
  const j3 = M.createJob(db, jish, { category: 'OTHER', title: 'Paint the wall' });
  assert.throws(() => M.rejectJob(db, sup, j3.id, {}), /reason/);
  assert.equal(M.rejectJob(db, sup, j3.id, { reason: 'Not maintenance' }).status, 'REJECTED');
  const j4 = M.createJob(db, jish, { category: 'PLUMBING', title: 'Sink leak' });
  assert.equal(M.cancelJob(db, jish, j4.id).status, 'CANCELLED');
  const h = M.supervisorHome(db, sup);
  assert.equal(h.counts.new, 2, 'factory + driver requests are new');
  assert.ok(h.attention.some((x) => x.priority === 'URGENT'));
});

test('maintenance: schedules, documents, contractor bills into payment requests', () => {
  const { db, sup, tech, acc, cfo, branch } = setup();
  assert.equal(M.addInterval('2026-01-31', 1, 'MONTH'), '2026-02-28');
  assert.equal(M.addInterval('2026-01-01', 2, 'WEEK'), '2026-01-15');
  // schedule due within lead days creates one job and advances
  const sch = M.saveSchedule(db, sup, null, { title: 'Fire extinguisher check', category: 'GOVERNMENT', location_type: 'BRANCH', branch_id: branch('Jish'),
    every_n: 6, every_unit: 'MONTH', next_due: S.addDays(D, 3), lead_days: 7, tech_id: tech.id });
  assert.equal(sch.jobs, 1);
  assert.equal(sch.next_due, M.addInterval(S.addDays(D, 3), 6, 'MONTH'));
  const sj = M.listJobs(db, sup, { kind: 'MANDATORY' });
  assert.equal(sj.length, 1);
  assert.equal(sj[0].status, 'ASSIGNED');
  assert.equal(sj[0].due_date, S.addDays(D, 3));
  // not duplicated while open, even if the next period is due
  db.prepare('UPDATE maint_schedules SET next_due=? WHERE id=?').run(D, sch.id);
  assert.equal(M.generateDue(db), 0);
  M.finishJob(db, tech, sj[0].id, { work_note: 'All 4 extinguishers OK' });
  M.closeJob(db, sup, sj[0].id, {});
  assert.equal(M.generateDue(db), 1);
  assert.throws(() => M.saveSchedule(db, tech, null, {}), /supervisor/);
  // documents
  const doc = M.saveDocument(db, sup, null, { doc_type: 'Municipality license (Baladiya)', title: 'Jish Baladiya', reference_no: 'B-1', location_type: 'BRANCH', branch_id: branch('Jish'), expires_on: S.addDays(D, 10) });
  assert.equal(doc.status, 'EXPIRING');
  const old = M.saveDocument(db, sup, null, { doc_type: 'Civil Defense certificate', location_type: 'WAREHOUSE', expires_on: S.addDays(D, -1) });
  assert.equal(old.status, 'EXPIRED');
  assert.equal(M.supervisorHome(db, sup).counts.docs_expired, 1);
  const rj = M.renewalJob(db, sup, doc.id, { contractor_name: 'Tasheel Services' });
  assert.equal(rj.category, 'GOVERNMENT');
  assert.equal(rj.status, 'ASSIGNED');
  assert.throws(() => M.renewalJob(db, sup, doc.id), /already open/);
  M.finishJob(db, sup, rj.id, { work_note: 'Renewed at Balady' });
  assert.throws(() => M.closeJob(db, sup, rj.id, { new_expires_on: S.addDays(D, 5) }), /after the current/);
  M.closeJob(db, sup, rj.id, { new_expires_on: S.addDays(D, 365), new_reference_no: 'B-2' });
  const renewed = M.listDocuments(db, sup).find((d) => d.id === doc.id);
  assert.equal(renewed.status, 'VALID');
  assert.equal(renewed.reference_no, 'B-2');
  // contractor bill → accounts check → payment request → CFO paid
  let j = M.getJob(db, sup, rj.id);
  assert.equal(j.bill_state, null, 'no cost yet');
  j = M.setJobCost(db, sup, rj.id, { cost: '1200', invoice_no: 'TS-77' });
  assert.equal(j.bill_state, 'TO_CHECK');
  assert.throws(() => M.checkJobBill(db, sup, rj.id, { matched: true }), /accountant/);
  const contractor = j.contractor_id;
  assert.equal(F.payableJobs(db, acc, { supplier_id: contractor })[0].ready, false);
  assert.throws(() => F.createPaymentRequest(db, acc, { supplier_id: contractor, job_ids: [rj.id] }), /checked/);
  j = M.checkJobBill(db, acc, rj.id, { matched: true });
  assert.equal(j.bill_state, 'MATCHED');
  assert.throws(() => M.setJobCost(db, sup, rj.id, { cost: '1300' }), /check/);
  assert.equal(F.financeHome(db, acc).maint_bills_ready, 1);
  const pr = F.createPaymentRequest(db, acc, { supplier_id: contractor, job_ids: [rj.id], add_vat: true });
  assert.equal(pr.subtotal_h, 120000);
  assert.equal(pr.total_h, 138000);
  assert.equal(pr.jobs.length, 1);
  assert.equal(pr.jobs[0].invoice_no, 'TS-77');
  assert.equal(M.getJob(db, sup, rj.id).bill_state, 'IN_REQUEST');
  assert.throws(() => F.createPaymentRequest(db, acc, { supplier_id: contractor, job_ids: [rj.id] }), /not available/);
  F.approveRequest(db, cfo, pr.id);
  F.markPaid(db, cfo, pr.id, { payment_ref: 'T-1', paid_from: 'Bank' });
  assert.equal(M.getJob(db, acc, rj.id).bill_state, 'PAID');
  assert.equal(M.getJob(db, acc, rj.id).can.cost, false);
  const rep = M.costReport(db, acc, { from: S.addDays(D, -1), to: S.addDays(D, 1) });
  assert.equal(rep.total_h, 120000);
  assert.equal(rep.by_category.find((g) => g.key === 'GOVERNMENT').cost_h, 120000);
  // month lock blocks cost changes
  const j5 = M.createJob(db, sup, { category: 'OTHER', title: 'x', location_type: 'COMPANY' });
  db.prepare('INSERT INTO periods (month, locked, locked_by, locked_at) VALUES (?,1,?,?)').run(D.slice(0, 7), acc.id, new Date().toISOString());
  assert.throws(() => M.setJobCost(db, sup, j5.id, { cost: '5' }), /closed/);
});

test('status guards', () => {
  const { db, mgr, user, item, driver } = setup();
  const FF = item('W0001');
  S.confirmStockCount(db, mgr, { date: D, reason: 'Opening', lines: [{ item_id: FF, physical_quantity: 50 }] });
  const jish = user('jish@spicymeal.sa'), awjam = user('awjam@spicymeal.sa');
  const o = S.saveBranchOrder(db, jish, { date: D, submit: true, lines: [{ item_id: FF, quantity: 10 }] });
  assert.throws(() => S.dispatch(db, mgr, { order_ids: [o.id] }), /assigned/);
  assert.throws(() => S.confirmReceiving(db, jish, o.id, { lines: [{ item_id: FF, received_quantity: 10 }] }), /not been dispatched/);
  S.acceptOrder(db, mgr, o.id, { lines: [] });
  assert.throws(() => S.acceptOrder(db, mgr, o.id, { lines: [{ item_id: FF, accepted_quantity: 0 }] }), /reject/);
  S.applyDefaultRoutes(db, mgr, D);
  assert.equal(S.getOrder(db, mgr, o.id).driver_id, driver('Driver 1'));
  S.dispatch(db, mgr, { order_ids: [o.id] });
  assert.throws(() => S.acceptOrder(db, mgr, o.id, { lines: [{ item_id: FF, accepted_quantity: 5 }] }), /before dispatch/);
  assert.throws(() => S.getOrder(db, awjam, o.id), /not found/i, 'other branch cannot see it');
  assert.throws(() => S.confirmReceiving(db, awjam, o.id, { lines: [] }), /not found/i);
  assert.throws(() => S.confirmReceiving(db, jish, o.id, { lines: [] }), /every item/);
  S.confirmReceiving(db, jish, o.id, { lines: [{ item_id: FF, received_quantity: 9 }] });
  assert.throws(() => S.confirmReceiving(db, jish, o.id, { lines: [{ item_id: FF, received_quantity: 9 }] }), /already/);
  const o2 = S.saveBranchOrder(db, awjam, { date: D, submit: true, lines: [{ item_id: FF, quantity: 10 }] });
  assert.throws(() => S.rejectOrder(db, mgr, o2.id, {}), /reason/);
  assert.equal(S.rejectOrder(db, mgr, o2.id, { reason: 'Duplicate' }).status, 'REJECTED');
});

test('HTTP role permissions', async () => {
  const { server } = createServer({ dbFile: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email) => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'SpicyMeal@2026' }) });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const call = (c, method, p, body) => fetch(base + p, { method, headers: { cookie: c || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.status);
  try {
    const br = await login('jish@spicymeal.sa');
    const acc = await login('accounts@spicymeal.sa');
    const mgr = await login('warehouse@spicymeal.sa');
    assert.equal(await call(null, 'GET', '/api/me'), 401);
    assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"jish@spicymeal.sa","password":"x"}' })).status, 401);
    assert.equal(await call(br, 'GET', '/api/inventory'), 403);
    assert.equal(await call(br, 'GET', '/api/reports/accepted?branch_id=1&from=2026-09-01&to=2026-09-15'), 403);
    assert.equal(await call(br, 'POST', '/api/supplier-receipts', {}), 403);
    assert.equal(await call(br, 'POST', '/api/orders/1/accept', { lines: [] }), 403);
    assert.equal(await call(acc, 'GET', '/api/inventory'), 403);
    assert.equal(await call(acc, 'POST', '/api/stock-counts', {}), 403);
    assert.equal(await call(acc, 'POST', '/api/orders/1/accept', {}), 403);
    assert.equal(await call(acc, 'GET', '/api/reports/accepted?branch_id=1&from=2026-09-01&to=2026-09-15'), 200);
    assert.equal(await call(mgr, 'GET', '/api/inventory'), 200);
    const fac = await login('factory@spicymeal.sa');
    assert.equal(await call(fac, 'GET', '/api/production'), 200);
    assert.equal(await call(br, 'GET', '/api/production'), 403);
    assert.equal(await call(acc, 'POST', '/api/production', { date: '2026-09-15', outputs: [] }), 403);
    const items = await fetch(base + '/api/items?source=2', { headers: { cookie: br } }).then((r) => r.json());
    assert.equal(items.length, 33);
    assert.ok(items.every((i) => i.item_code.startsWith('F')));
    assert.equal(await call(mgr, 'PUT', '/api/branch/order', { lines: [] }), 403);
    assert.equal(await call(br, 'PUT', '/api/items/1/unit', { unit: 'box' }), 403);
    assert.equal(await call(acc, 'PUT', '/api/items/1/unit', { unit: 'box' }), 403);
    assert.equal(await call(mgr, 'PUT', '/api/items/1/unit', { unit: 'carton' }), 200);
    const drv = await login('driver1@spicymeal.sa');
    assert.equal(await call(drv, 'GET', '/api/driver/route'), 200);
    assert.equal(await call(drv, 'GET', '/api/orders'), 403);
    assert.equal(await call(drv, 'GET', '/api/inventory'), 403);
    assert.equal(await call(drv, 'POST', '/api/tasks', { driver_id: 1, title: 'x' }), 403);
    assert.equal(await call(br, 'GET', '/api/driver/route'), 403);
    assert.equal(await call(mgr, 'GET', '/api/driver/route'), 403);
    assert.equal(await call(mgr, 'GET', '/api/drivers/stats'), 200);
    assert.equal(await call(fac, 'GET', '/api/drivers/stats'), 403);
    assert.equal(await call(acc, 'GET', '/api/drivers/stats'), 403);
    const cfo = await login('cfo@spicymeal.sa');
    assert.equal(await call(cfo, 'GET', '/api/finance/home'), 200);
    assert.equal(await call(cfo, 'GET', '/api/finance/requests'), 200);
    assert.equal(await call(cfo, 'POST', '/api/finance/costs', { lines: [] }), 403);
    assert.equal(await call(cfo, 'POST', '/api/finance/periods/lock', { month: '2026-01' }), 403);
    assert.equal(await call(cfo, 'GET', '/api/inventory'), 403);
    assert.equal(await call(acc, 'GET', '/api/finance/costs'), 200);
    assert.equal(await call(acc, 'POST', '/api/finance/requests/1/approve', {}), 403);
    assert.equal(await call(mgr, 'GET', '/api/finance/costs'), 403);
    assert.equal(await call(mgr, 'GET', '/api/finance/company'), 200);
    assert.equal(await call(br, 'GET', '/api/finance/summary?from=2026-09-01&to=2026-09-10'), 403);
    assert.equal(await call(drv, 'GET', '/api/finance/audit'), 403);
    // maintenance
    const sup = await login('maintenance@spicymeal.sa');
    const tec = await login('tech1@spicymeal.sa');
    assert.equal(await call(br, 'POST', '/api/maint/jobs', { category: 'PLUMBING', title: 'Leak' }), 200);
    assert.equal(await call(br, 'GET', '/api/maint/jobs'), 200);
    assert.equal(await call(br, 'GET', '/api/maint/home'), 403);
    assert.equal(await call(br, 'PUT', '/api/maint/jobs/1', { priority: 'LOW' }), 403);
    assert.equal(await call(tec, 'POST', '/api/maint/jobs', { category: 'PLUMBING', title: 'x' }), 403);
    assert.equal(await call(tec, 'GET', '/api/maint/jobs/1'), 404);
    assert.equal(await call(sup, 'PUT', '/api/maint/jobs/1', { tech_id: 999 }), 400);
    assert.equal(await call(sup, 'GET', '/api/maint/home'), 200);
    assert.equal(await call(sup, 'GET', '/api/drivers'), 200);
    assert.equal(await call(sup, 'GET', '/api/inventory'), 403);
    assert.equal(await call(sup, 'GET', '/api/finance/home'), 403);
    assert.equal(await call(acc, 'GET', '/api/maint/costs'), 200);
    assert.equal(await call(acc, 'POST', '/api/maint/schedules', {}), 403);
    assert.equal(await call(cfo, 'POST', '/api/maint/jobs/1/check', { matched: true }), 403);
    assert.equal(await call(drv, 'GET', '/api/maint/documents'), 403);
    assert.equal(await call(tec, 'GET', '/api/maint/technicians'), 403);
    // branch order date window
    assert.equal(await call(br, 'PUT', '/api/branch/order', { date: '2020-01-01', lines: [] }), 400);
    assert.equal(await call(br, 'PUT', '/api/branch/order', { date: '2999-01-01', lines: [] }), 400);
    // content-type guard
    const r = await fetch(base + '/api/stock-counts', { method: 'POST', headers: { cookie: mgr, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(r.status, 415);
  } finally { server.close(); }
});
