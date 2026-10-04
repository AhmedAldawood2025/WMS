'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./crypto');
const seed = require('./seed-data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  code TEXT
);
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  branch_code TEXT NOT NULL UNIQUE,
  branch_name TEXT NOT NULL UNIQUE,
  default_driver_id INTEGER REFERENCES drivers(id),
  default_sequence INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('BRANCH','WAREHOUSE_MANAGER','ACCOUNTANT','DRIVER','CFO','MAINT_SUPERVISOR','TECHNICIAN')),
  branch_id INTEGER REFERENCES branches(id),
  active INTEGER NOT NULL DEFAULT 1,
  warehouse_id INTEGER REFERENCES warehouses(id),
  driver_id INTEGER REFERENCES drivers(id),
  CHECK (role <> 'BRANCH' OR branch_id IS NOT NULL),
  CHECK (role <> 'DRIVER' OR driver_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  item_name_ar TEXT,
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id),
  orderable INTEGER NOT NULL DEFAULT 1,
  reorder_level INTEGER CHECK (reorder_level IS NULL OR reorder_level >= 0)
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  supplier_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','ACCEPTED','ASSIGNED','DISPATCHED','RECEIVED','REJECTED')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  dispatched_at TEXT,
  reject_reason TEXT,
  dispatched_by INTEGER REFERENCES users(id),
  delivered_at TEXT,
  delivered_by INTEGER REFERENCES users(id),
  UNIQUE (branch_id, order_date, warehouse_id)
);
CREATE INDEX IF NOT EXISTS ix_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS ix_orders_wh ON orders(warehouse_id);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity >= 0),
  accepted_quantity INTEGER CHECK (accepted_quantity >= 0),
  UNIQUE (order_id, item_id)
);
CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS driver_assignments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  sequence INTEGER NOT NULL DEFAULT 1,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT
);
CREATE TABLE IF NOT EXISTS receivings (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  received_by INTEGER NOT NULL REFERENCES users(id),
  received_at TEXT NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS receiving_items (
  id INTEGER PRIMARY KEY,
  receiving_id INTEGER NOT NULL REFERENCES receivings(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  accepted_quantity INTEGER NOT NULL,
  received_quantity INTEGER NOT NULL CHECK (received_quantity >= 0)
);
CREATE TABLE IF NOT EXISTS supplier_receipts (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  received_date TEXT NOT NULL,
  received_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  notes TEXT,
  warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id)
);
CREATE TABLE IF NOT EXISTS supplier_receipt_items (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES supplier_receipts(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY,
  count_date TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  system_quantity INTEGER NOT NULL,
  physical_quantity INTEGER NOT NULL CHECK (physical_quantity >= 0),
  variance INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS production_batches (
  id INTEGER PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  production_date TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS production_lines (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES production_batches(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  direction INTEGER NOT NULL CHECK (direction IN (1,-1)),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE TABLE IF NOT EXISTS driver_tasks (
  id INTEGER PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  title TEXT NOT NULL,
  details TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  done_at TEXT,
  done_note TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_tasks_driver ON driver_tasks(driver_id, status);
-- ───── finance (v4) ─────
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS item_costs (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  unit_cost_h INTEGER NOT NULL CHECK (unit_cost_h >= 0),   -- halalas (1 SAR = 100)
  effective_from TEXT NOT NULL,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_costs_item ON item_costs(item_id, effective_from);
CREATE TABLE IF NOT EXISTS periods (
  month TEXT PRIMARY KEY,               -- YYYY-MM
  locked INTEGER NOT NULL DEFAULT 1,
  locked_by INTEGER REFERENCES users(id),
  locked_at TEXT,
  unlocked_by INTEGER REFERENCES users(id),
  unlocked_at TEXT,
  unlock_reason TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TABLE IF NOT EXISTS payment_requests (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED','APPROVED','PAID','REJECTED','CANCELLED')),
  add_vat INTEGER NOT NULL DEFAULT 1,
  vat_rate_bp INTEGER NOT NULL DEFAULT 0,          -- basis points, 1500 = 15%
  subtotal_h INTEGER NOT NULL,
  vat_h INTEGER NOT NULL,
  total_h INTEGER NOT NULL,
  due_date TEXT,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  rejected_by INTEGER REFERENCES users(id),
  rejected_at TEXT,
  reject_reason TEXT,
  paid_by INTEGER REFERENCES users(id),
  paid_at TEXT,
  paid_date TEXT,
  payment_ref TEXT,
  cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_request_receipts (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES payment_requests(id),
  receipt_id INTEGER NOT NULL REFERENCES supplier_receipts(id),
  amount_h INTEGER NOT NULL,
  UNIQUE (request_id, receipt_id)
);

-- Maintenance (v5)
CREATE TABLE IF NOT EXISTS maint_assets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('VEHICLE','EQUIPMENT')),
  tag TEXT,                                   -- plate number / serial number
  location_type TEXT NOT NULL CHECK (location_type IN ('BRANCH','WAREHOUSE','FACTORY','COMPANY')),
  branch_id INTEGER REFERENCES branches(id),
  driver_id INTEGER REFERENCES drivers(id),
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  CHECK (location_type <> 'BRANCH' OR branch_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS maint_schedules (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK (location_type IN ('BRANCH','WAREHOUSE','FACTORY','COMPANY')),
  branch_id INTEGER REFERENCES branches(id),
  asset_id INTEGER REFERENCES maint_assets(id),
  every_n INTEGER NOT NULL CHECK (every_n > 0),
  every_unit TEXT NOT NULL CHECK (every_unit IN ('DAY','WEEK','MONTH')),
  next_due TEXT NOT NULL,
  lead_days INTEGER NOT NULL DEFAULT 7,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  tech_id INTEGER REFERENCES users(id),
  contractor_id INTEGER REFERENCES suppliers(id),
  details TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maint_documents (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  reference_no TEXT,
  location_type TEXT NOT NULL CHECK (location_type IN ('BRANCH','WAREHOUSE','FACTORY','COMPANY')),
  branch_id INTEGER REFERENCES branches(id),
  asset_id INTEGER REFERENCES maint_assets(id),
  issued_on TEXT,
  expires_on TEXT NOT NULL,
  remind_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS maint_jobs (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('REQUEST','MANDATORY')),
  category TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('URGENT','HIGH','NORMAL','LOW')),
  title TEXT NOT NULL,
  description TEXT,
  location_type TEXT NOT NULL CHECK (location_type IN ('BRANCH','WAREHOUSE','FACTORY','COMPANY')),
  branch_id INTEGER REFERENCES branches(id),
  asset_id INTEGER REFERENCES maint_assets(id),
  schedule_id INTEGER REFERENCES maint_schedules(id),
  document_id INTEGER REFERENCES maint_documents(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','DONE','CLOSED','REJECTED','CANCELLED')),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  due_date TEXT,
  tech_id INTEGER REFERENCES users(id),
  contractor_id INTEGER REFERENCES suppliers(id),
  assigned_at TEXT,
  started_at TEXT,
  done_at TEXT,
  done_by INTEGER REFERENCES users(id),
  work_note TEXT,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id),
  reject_reason TEXT,
  cost_h INTEGER,                              -- total cost excl. VAT (halalas)
  invoice_no TEXT,                             -- contractor invoice
  matched_at TEXT,
  matched_by INTEGER REFERENCES users(id),
  CHECK (location_type <> 'BRANCH' OR branch_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_mj_status ON maint_jobs(status);
CREATE INDEX IF NOT EXISTS ix_mj_branch ON maint_jobs(branch_id);
CREATE TABLE IF NOT EXISTS maint_job_notes (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES maint_jobs(id),
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_request_jobs (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES payment_requests(id),
  job_id INTEGER NOT NULL REFERENCES maint_jobs(id),
  amount_h INTEGER NOT NULL,
  UNIQUE (request_id, job_id)
);
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN
    ('SUPPLIER_RECEIPT','BRANCH_ORDER_ACCEPTED','BRANCH_ORDER_REVISION','STOCK_ADJUSTMENT','PRODUCTION_INPUT','PRODUCTION_OUTPUT')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  direction INTEGER NOT NULL CHECK (direction IN (1,-1)),
  reference_type TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  branch_id INTEGER REFERENCES branches(id),
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tx_item ON inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS ix_tx_ref ON inventory_transactions(reference_type, reference_id);

-- The ledger is append-only.
CREATE TRIGGER IF NOT EXISTS tx_no_update BEFORE UPDATE ON inventory_transactions
BEGIN SELECT RAISE(ABORT, 'inventory_transactions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS tx_no_delete BEFORE DELETE ON inventory_transactions
BEGIN SELECT RAISE(ABORT, 'inventory_transactions is append-only'); END;
`;

const DEFAULT_PASSWORD = 'SpicyMeal@2026';

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function seedMasterData(db) {
  const has = db.prepare('SELECT COUNT(*) n FROM branches').get().n;
  if (has) return false;
  const tx = transaction(db);
  tx(() => {
    db.prepare("INSERT INTO warehouses (id, name, code) VALUES (1, ?, 'WH')").run('Central Warehouse');

    const insDriver = db.prepare('INSERT INTO drivers (name) VALUES (?)');
    const driverOf = {};
    seed.DRIVERS.forEach((d) => {
      const id = Number(insDriver.run(d.name).lastInsertRowid);
      d.branches.forEach((b, i) => { driverOf[b] = { id, seq: i + 1 }; });
    });

    const insBranch = db.prepare('INSERT INTO branches (branch_code, branch_name, default_driver_id, default_sequence) VALUES (?,?,?,?)');
    const insUser = db.prepare('INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?,?,?,?,?)');
    const pw = hashPassword(DEFAULT_PASSWORD);
    seed.BRANCHES.forEach((name, i) => {
      const code = 'B' + String(i + 1).padStart(2, '0');
      const r = driverOf[name] || {};
      const id = Number(insBranch.run(code, name, r.id ?? null, r.seq ?? null).lastInsertRowid);
      insUser.run(`${name} Branch`, `${slug(name)}@spicymeal.sa`, pw, 'BRANCH', id);
    });
    insUser.run('Warehouse Manager', 'warehouse@spicymeal.sa', pw, 'WAREHOUSE_MANAGER', null);
    db.prepare("UPDATE users SET warehouse_id=1 WHERE email='warehouse@spicymeal.sa'").run();
    insUser.run('Accountant', 'accounts@spicymeal.sa', pw, 'ACCOUNTANT', null);
    db.prepare('INSERT INTO suppliers (supplier_name) VALUES (?)').run('ABC Food');
  });
  return true;
}

const FACTORY_ID = 2;

// Adds the factory (source #2), its items and its manager if they are missing. Safe to run repeatedly.
function seedFactory(db) {
  transaction(db)(() => {
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(FACTORY_ID)) {
      db.prepare("INSERT INTO warehouses (id, name, code) VALUES (?, 'Factory', 'FAC')").run(FACTORY_ID);
    }
    if (!db.prepare("SELECT 1 FROM users WHERE email='factory@spicymeal.sa'").get()) {
      db.prepare(`INSERT INTO users (name, email, password_hash, role, branch_id, warehouse_id)
        VALUES ('Factory Manager', 'factory@spicymeal.sa', ?, 'WAREHOUSE_MANAGER', NULL, ?)`).run(hashPassword(DEFAULT_PASSWORD), FACTORY_ID);
    }
  });
}

// Brings the item master in line with seed-data.js ITEMS (matched by code). Runs when ITEMS_VERSION changes.
// Names, category, source and order are updated; units set by the manager are kept.
// Codes no longer on the list are deactivated (history stays intact), never deleted.
function syncItems(db) {
  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)');
  const cur = db.prepare("SELECT value FROM app_meta WHERE key='items_version'").get()?.value;
  if (cur === seed.ITEMS_VERSION) return false;
  const whId = { WAREHOUSE: 1, FACTORY: FACTORY_ID };
  transaction(db)(() => {
    const up = db.prepare(`INSERT INTO items (item_code, item_name, item_name_ar, category, sort_order, warehouse_id, orderable, active)
      VALUES (?,?,?,?,?,?,?,1)
      ON CONFLICT(item_code) DO UPDATE SET item_name=excluded.item_name, item_name_ar=excluded.item_name_ar, category=excluded.category,
        sort_order=excluded.sort_order, warehouse_id=excluded.warehouse_id, orderable=excluded.orderable, active=1`);
    const keep = new Set();
    // warehouse rows first so a new database numbers W items before F items
    const ordered = seed.ITEMS.map((it, i) => [it, i]).sort((x, y) => (x[0][3] === y[0][3] ? x[1] - y[1] : x[0][3] === 'WAREHOUSE' ? -1 : 1));
    ordered.forEach(([[code, en, ar, src, cat], i]) => { up.run(code, en, ar, cat, i + 1, whId[src], 1); keep.add(code); });
    seed.FACTORY_RAW_ITEMS.forEach(([code, en, ar, src, cat], i) => { up.run(code, en, ar, cat, 9000 + i, whId[src], 0); keep.add(code); });
    const all = db.prepare('SELECT item_code FROM items WHERE active=1').all().map((r) => r.item_code);
    const off = db.prepare('UPDATE items SET active=0 WHERE item_code=?');
    for (const c of all) if (!keep.has(c)) off.run(c);
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('items_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(seed.ITEMS_VERSION);
  });
  return true;
}

const hasColumn = (db, table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
const hasTable = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);

// Upgrades a v1 database (warehouse only) to v2 (warehouse + factory). Keeps all existing data.
function migrateToV2(db) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db)(() => {
      if (!hasColumn(db, 'warehouses', 'code')) db.exec("ALTER TABLE warehouses ADD COLUMN code TEXT; UPDATE warehouses SET code='WH' WHERE id=1;");
      if (!hasColumn(db, 'items', 'warehouse_id')) db.exec('ALTER TABLE items ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id)');
      if (!hasColumn(db, 'items', 'orderable')) db.exec('ALTER TABLE items ADD COLUMN orderable INTEGER NOT NULL DEFAULT 1');
      if (!hasColumn(db, 'users', 'warehouse_id')) {
        db.exec("ALTER TABLE users ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id); UPDATE users SET warehouse_id=1 WHERE role='WAREHOUSE_MANAGER';");
      }
      if (!hasColumn(db, 'supplier_receipts', 'warehouse_id')) db.exec('ALTER TABLE supplier_receipts ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id)');
      if (!hasColumn(db, 'orders', 'warehouse_id')) {
        // New unique key (branch, date, source) needs a table rebuild.
        db.exec(`CREATE TABLE orders_v2 (
          id INTEGER PRIMARY KEY,
          branch_id INTEGER NOT NULL REFERENCES branches(id),
          warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id),
          order_date TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','ACCEPTED','ASSIGNED','DISPATCHED','RECEIVED','REJECTED')),
          created_by INTEGER NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL,
          submitted_at TEXT, accepted_by INTEGER REFERENCES users(id), accepted_at TEXT, dispatched_at TEXT, reject_reason TEXT,
          UNIQUE (branch_id, order_date, warehouse_id));
        INSERT INTO orders_v2 (id, branch_id, warehouse_id, order_date, status, created_by, created_at, submitted_at, accepted_by, accepted_at, dispatched_at, reject_reason)
          SELECT id, branch_id, 1, order_date, status, created_by, created_at, submitted_at, accepted_by, accepted_at, dispatched_at, reject_reason FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_v2 RENAME TO orders;`);
      }
      const ledgerSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='inventory_transactions'").get()?.sql || '';
      if (!ledgerSql.includes('PRODUCTION_INPUT')) {
        // Widen the allowed transaction types (CHECK constraint) — rebuild, copying every row unchanged.
        db.exec(`DROP TRIGGER IF EXISTS tx_no_update; DROP TRIGGER IF EXISTS tx_no_delete;
        ALTER TABLE inventory_transactions RENAME TO inventory_transactions_v1;
        CREATE TABLE inventory_transactions (
          id INTEGER PRIMARY KEY,
          item_id INTEGER NOT NULL REFERENCES items(id),
          transaction_type TEXT NOT NULL CHECK (transaction_type IN
            ('SUPPLIER_RECEIPT','BRANCH_ORDER_ACCEPTED','BRANCH_ORDER_REVISION','STOCK_ADJUSTMENT','PRODUCTION_INPUT','PRODUCTION_OUTPUT')),
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          direction INTEGER NOT NULL CHECK (direction IN (1,-1)),
          reference_type TEXT NOT NULL, reference_id INTEGER NOT NULL,
          warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
          branch_id INTEGER REFERENCES branches(id), note TEXT,
          created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
        INSERT INTO inventory_transactions SELECT * FROM inventory_transactions_v1;
        DROP TABLE inventory_transactions_v1;
        DROP INDEX IF EXISTS ix_tx_item; DROP INDEX IF EXISTS ix_tx_ref;`);
      }
      db.exec('PRAGMA user_version = 2');
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  const bad = db.prepare('PRAGMA foreign_key_check').all();
  if (bad.length) throw new Error('Database upgrade failed foreign key check');
}

// v2 → v3: driver logins, pickup/delivery tracking on orders, driver tasks.
function migrateToV3(db) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db)(() => {
      const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
      if (!usersSql.includes("'DRIVER'")) {
        db.exec(`CREATE TABLE users_v3 (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('BRANCH','WAREHOUSE_MANAGER','ACCOUNTANT','DRIVER')),
          branch_id INTEGER REFERENCES branches(id),
          active INTEGER NOT NULL DEFAULT 1,
          warehouse_id INTEGER REFERENCES warehouses(id),
          driver_id INTEGER REFERENCES drivers(id),
          CHECK (role <> 'BRANCH' OR branch_id IS NOT NULL),
          CHECK (role <> 'DRIVER' OR driver_id IS NOT NULL));
        INSERT INTO users_v3 (id, name, email, password_hash, role, branch_id, active, warehouse_id)
          SELECT id, name, email, password_hash, role, branch_id, active, warehouse_id FROM users;
        DROP TABLE users;
        ALTER TABLE users_v3 RENAME TO users;`);
      }
      for (const col of ['dispatched_by INTEGER REFERENCES users(id)', 'delivered_at TEXT', 'delivered_by INTEGER REFERENCES users(id)']) {
        if (!hasColumn(db, 'orders', col.split(' ')[0])) db.exec(`ALTER TABLE orders ADD COLUMN ${col}`);
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database upgrade (v3) failed foreign key check');
}

// One login per existing driver (driver1@spicymeal.sa …). Runs once, when the database reaches v3.
function seedDriverLogins(db) {
  transaction(db)(() => {
    const pw = hashPassword(DEFAULT_PASSWORD);
    const ins = db.prepare("INSERT OR IGNORE INTO users (name, email, password_hash, role, driver_id) VALUES (?,?,?,'DRIVER',?)");
    for (const d of db.prepare('SELECT id, name FROM drivers').all()) {
      if (!db.prepare("SELECT 1 FROM users WHERE role='DRIVER' AND driver_id=?").get(d.id)) ins.run(d.name, `${slug(d.name)}@spicymeal.sa`, pw, d.id);
    }
  });
}

// Wraps fn in BEGIN IMMEDIATE / COMMIT; rolls back on any throw. Nested calls join the outer tx.
function transaction(db) {
  return (fn) => {
    if (db.__inTx) return fn();
    db.exec('BEGIN IMMEDIATE');
    db.__inTx = true;
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.__inTx = false;
    }
  };
}

// Columns added after the first release; added to older databases on start.
const LATE_COLUMNS = {
  items: ['reorder_level INTEGER'],
  suppliers: ['vat_number TEXT', 'cr_number TEXT', 'contact_name TEXT', 'phone TEXT', 'email TEXT', 'address TEXT', 'bank_name TEXT', 'iban TEXT', 'payment_terms_days INTEGER'],
  supplier_receipts: ['invoice_no TEXT', 'matched_at TEXT', 'matched_by INTEGER REFERENCES users(id)', 'match_note TEXT'],
  supplier_receipt_items: ['unit_cost_h INTEGER'],
  payment_requests: ['paid_from TEXT'],
};
function ensureLateColumns(db) {
  let changed = false;
  for (const [t, cols] of Object.entries(LATE_COLUMNS)) {
    if (!hasTable(db, t)) continue;
    for (const c of cols) if (!hasColumn(db, t, c.split(' ')[0])) { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); changed = true; }
  }
  return changed;
}

// v3 → v4 (CFO) and v4 → v5 (maintenance roles): the users CHECK constraint needs a rebuild; ids kept.
const ALL_ROLES = "('BRANCH','WAREHOUSE_MANAGER','ACCOUNTANT','DRIVER','CFO','MAINT_SUPERVISOR','TECHNICIAN')";
function migrateToV4(db) {
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
  if (usersSql.includes("'TECHNICIAN'")) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db)(() => {
      db.exec(`CREATE TABLE users_v4 (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ${ALL_ROLES}),
        branch_id INTEGER REFERENCES branches(id),
        active INTEGER NOT NULL DEFAULT 1,
        warehouse_id INTEGER REFERENCES warehouses(id),
        driver_id INTEGER REFERENCES drivers(id),
        CHECK (role <> 'BRANCH' OR branch_id IS NOT NULL),
        CHECK (role <> 'DRIVER' OR driver_id IS NOT NULL));
      INSERT INTO users_v4 (id, name, email, password_hash, role, branch_id, active, warehouse_id, driver_id)
        SELECT id, name, email, password_hash, role, branch_id, active, warehouse_id, driver_id FROM users;
      DROP TABLE users;
      ALTER TABLE users_v4 RENAME TO users;`);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database upgrade (users roles) failed foreign key check');
}

function seedV5(db) {
  transaction(db)(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
    const pw = hashPassword(DEFAULT_PASSWORD);
    if (!db.prepare("SELECT 1 FROM users WHERE role='MAINT_SUPERVISOR'").get()) ins.run('Maintenance Supervisor', 'maintenance@spicymeal.sa', pw, 'MAINT_SUPERVISOR');
    if (!db.prepare("SELECT 1 FROM users WHERE role='TECHNICIAN'").get()) {
      ins.run('Technician 1', 'tech1@spicymeal.sa', pw, 'TECHNICIAN');
      ins.run('Technician 2', 'tech2@spicymeal.sa', pw, 'TECHNICIAN');
    }
  });
}

const COMPANY_DEFAULTS = {
  company_name: 'SpicyMeal', company_name_ar: 'سبايسي ميل', cr_number: '', vat_number: '',
  address: '', phone: '', email: '', vat_rate_bp: '1500',
};
function seedV4(db) {
  transaction(db)(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(COMPANY_DEFAULTS)) ins.run('company.' + k, v);
    if (!db.prepare("SELECT 1 FROM users WHERE role='CFO'").get()) {
      db.prepare("INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES ('CFO', 'cfo@spicymeal.sa', ?, 'CFO')").run(hashPassword(DEFAULT_PASSWORD));
    }
  });
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  let migrated = false;
  const existing = hasTable(db, 'items');
  if (version < 2 && existing) { migrateToV2(db); migrated = true; }
  if (version < 3 && existing) { migrateToV3(db); migrated = true; }
  if (version < 5 && existing) { migrateToV4(db); migrated = true; }
  if (existing && ensureLateColumns(db)) migrated = true;
  db.exec(SCHEMA);
  ensureLateColumns(db);
  const seeded = seedMasterData(db);
  seedFactory(db);
  const itemsSynced = syncItems(db);
  if (version < 3) seedDriverLogins(db);
  if (version < 4) seedV4(db);
  if (version < 5) { seedV5(db); db.exec('PRAGMA user_version = 5'); }
  db.tx = transaction(db);
  return { db, seeded, migrated, itemsSynced };
}

module.exports = { openDb, DEFAULT_PASSWORD, slug, FACTORY_ID, COMPANY_DEFAULTS };
