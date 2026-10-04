# SpicyMeal WMS

A lean warehouse system for SpicyMeal: branches submit their daily orders, the
warehouse accepts them, assigns drivers and dispatches, branches confirm what
they received, and accountants look up accepted quantities. Stock is always
calculated from a transaction ledger.

The design document is in [`docs/DESIGN.md`](docs/DESIGN.md). It covers the
architecture, schema, permissions, workflow, screens, inventory logic, status
flow, sample data, open assumptions, and recommendations that were not built.

## Requirements

* Node.js **22.13 or newer**. No other software and no `npm install` are needed,
  because the app uses Node's built-in HTTP server and SQLite.

## Run

```bash
npm start                  # http://localhost:3000
```

The database file `data/wms.db` is created on first start. It comes loaded with
the official item list — 87 warehouse items (W0001–W0088) and 33 factory items
(F0001–F0036) plus raw whole chicken (FR001) — 17 branches, 3 drivers and the
user accounts. The item list lives in `src/seed-data.js`; when it changes, every
database is updated on the next start (matched by code; removed codes are
switched off, never deleted).

**Upgrading from an earlier version:** copy your old `data` folder into the new
project and run `npm start`. The database is upgraded automatically (factory,
driver logins and tasks are added) and all existing orders and stock are kept.

To see a working example, load the demo data **into a new database** before
the first start:

```bash
npm run demo               # 10 days of history + the Section 24 "complete day"
npm start
```

Settings (environment variables): `PORT` (default 3000), `DB_FILE` (default
`data/wms.db`), and `COOKIE_SECURE=1` when the app is served over HTTPS.

## Logins

Every account starts with the password **`SpicyMeal@2026`**. Change each one
after the first sign-in (sidebar → Password).

| Role | Email |
|---|---|
| Warehouse Manager | `warehouse@spicymeal.sa` |
| Factory Manager | `factory@spicymeal.sa` |
| Accountant | `accounts@spicymeal.sa` |
| CFO (approves and pays supplier payment requests) | `cfo@spicymeal.sa` |
| Maintenance Supervisor | `maintenance@spicymeal.sa` |
| Technicians | `tech1@spicymeal.sa`, `tech2@spicymeal.sa` (the supervisor adds more under Technicians) |
| Drivers | `driver1@spicymeal.sa`, `driver2@spicymeal.sa`, `driver3@spicymeal.sa` (new drivers get a login from Drivers → Add driver) |
| Branch (one per branch) | `<branch>@spicymeal.sa`, e.g. `jish@spicymeal.sa`, `awjam@spicymeal.sa`, `dhahiyah@spicymeal.sa`, `citymall@spicymeal.sa` |

To add users or reset passwords:

```bash
npm run add-user -- --name "Ali" --email ali@spicymeal.sa --role WAREHOUSE_MANAGER --password "********"
npm run add-user -- --name "Jish 2" --email jish2@spicymeal.sa --role BRANCH --branch Jish --password "********"
npm run add-user -- --name "Sara" --email sara@spicymeal.sa --role CFO --password "********"
npm run add-user -- --email jish@spicymeal.sa --password "new-password"
```

## Tests

```bash
npm test
```

The tests replay the Section 24 day (stock 100 → 40, Awjam report = 15, not
14). They also check Rule 6 (changing 20 → 15 brings stock back to 85), that
drafts and requests never move stock, the stock guard, supplier receipts,
stock-count variance, the append-only ledger, status guards, and HTTP role
permissions. Finance tests cover costs, valued reports, invoices, payment
requests (accounts → CFO), factory yield, month-end lock and the change log.

## Project layout

```
src/server.js     HTTP server, routes and role permissions
src/services.js   business rules (orders, ledger, picking, receiving, counts, report)
src/finance.js    accounts & CFO: costs, valued reports, invoices, payment requests, month-end, change log
src/maintenance.js  maintenance: requests, mandatory schedules, licenses & documents, technicians, contractor bills
src/db.js         schema and master-data seed
src/seed-data.js  items, branches and drivers from the SpicyMeal order sheet
public/           web app (plain HTML/CSS/JS, no build step; finance.js = accounts screens, xlsx.js = Excel export)
scripts/          demo data and user admin
test/             automated scenario and permission tests
docs/DESIGN.md    design document
```

## Production notes

* Put the app behind a reverse proxy (nginx or Caddy) with HTTPS, and set `COOKIE_SECURE=1`.
* Keep it running with systemd or pm2 (`node --disable-warning=ExperimentalWarning src/server.js`).
* Back up `data/wms.db` every day. It is a single file; use `sqlite3 data/wms.db ".backup backup.db"`.
