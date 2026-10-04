# SpicyMeal WMS — Design Document

Version 2.0 · 15 Sep 2026 — adds the Factory as a second supply source

This document covers the eight design items requested before build:
architecture, database schema, roles & permissions, workflow, screens,
inventory logic, order state transitions, and sample data. A final section
lists decisions made where the brief was silent, and recommendations that
were deliberately **not** built.

---

## 1. System architecture

```
 Browser (branch tablet / warehouse desktop / accountant PC)
        │  HTTPS (JSON API + static files)
        ▼
 ┌──────────────────────────────────────────────┐
 │ Node.js server (single process, no deps)     │
 │  src/server.js   HTTP, routes, login, roles   │
 │  src/services.js business rules + ledger      │
 │  src/db.js       schema + master data seed    │
 └──────────────────────────────────────────────┘
        │  node:sqlite (synchronous, transactional)
        ▼
 data/wms.db  (SQLite file — one file to back up)
```

* **Runtime:** Node.js ≥ 22.13. No npm packages — the built-in `node:http`
  server and `node:sqlite` are used. Nothing to install; nothing to patch.
* **Frontend:** a single-page app in plain HTML/CSS/JS (`public/`). No build
  step. Branch screens are touch-first (tablet/phone); warehouse screens are
  desktop-first with dense tables.
* **Database:** SQLite. Right-sized for one warehouse and ~20 branches (tens
  of thousands of transactions per year). Every write that touches inventory
  runs inside a single DB transaction, so a failure never leaves half an order
  posted. The schema is plain SQL and ports to PostgreSQL unchanged if the
  business outgrows SQLite.
* **Auth:** email + password (scrypt hash), server-side sessions in the DB,
  `HttpOnly; SameSite=Strict` cookie. Every API route declares its allowed
  roles; branch routes are additionally scoped to the user's `branch_id`
  server-side (never trusted from the client).
* **Time zone:** business dates are computed in Asia/Riyadh.

## 2. Database schema

Full DDL lives in `src/db.js`. Summary:

| Table | Key columns | Notes |
|---|---|---|
| `warehouses` | id, name | One row today ("Central Warehouse"); ready for more. |
| `branches` | id, branch_code, branch_name, default_driver_id, default_sequence, active | Default driver/sequence = the usual route; used to pre-fill assignment. |
| `drivers` | id, name, phone, active | |
| `users` | id, name, email, password_hash, role, branch_id, active | role ∈ BRANCH, WAREHOUSE_MANAGER, ACCOUNTANT. branch_id required for BRANCH. |
| `sessions` | token, user_id, expires_at | |
| `items` | id, item_code (unique), item_name, item_name_ar, category, unit, sort_order, active | W0001–W0083 seeded from the order sheet. |
| `suppliers` | id, supplier_name (unique), active | Minimal. Created on first use. |
| `orders` | id, branch_id, order_date, status, submitted_at, created_by, accepted_by, accepted_at, dispatched_at, reject_reason | Unique (branch_id, order_date). |
| `order_items` | id, order_id, item_id, requested_quantity, accepted_quantity | `requested_quantity` is never changed after submission. |
| `driver_assignments` | id, order_id (unique), driver_id, sequence, assigned_by, assigned_at | Order status is the single source of truth for the lifecycle. |
| `receivings` | id, order_id (unique), branch_id, received_by, received_at, notes | |
| `receiving_items` | id, receiving_id, item_id, accepted_quantity, received_quantity | Accepted is snapshotted; discrepancy = accepted − received. |
| `supplier_receipts` | id, supplier_id, received_date, received_by, created_at, notes | |
| `supplier_receipt_items` | id, receipt_id, item_id, quantity | |
| `stock_counts` | id, count_date, item_id, system_quantity, physical_quantity, variance, reason, created_by, status, created_at | Rows written on confirmation (status CONFIRMED). |
| `inventory_transactions` | id, item_id, transaction_type, quantity, direction, reference_type, reference_id, warehouse_id, branch_id, note, created_by, created_at | **Append-only ledger.** `quantity` > 0, `direction` ∈ {+1, −1}. |

Indexes: ledger on (item_id), (reference_type, reference_id); orders on
(order_date), (status); order_items on (order_id).

## 3. Roles & permissions

| Capability | Branch | Warehouse Manager | Accountant |
|---|:-:|:-:|:-:|
| Create / submit own daily order | ✔ (own branch) | – | – |
| See own order status & accepted qty | ✔ | ✔ (all) | – |
| Confirm receiving | ✔ (own, DISPATCHED only) | – | – |
| Review, edit accepted qty, accept, reject | – | ✔ | – |
| Driver assignment, picking, dispatch | – | ✔ | – |
| Supplier receiving | – | ✔ | – |
| Inventory view & item ledger | – | ✔ | – |
| Stock count & adjustment | – | ✔ | – |
| Accepted-quantity search (branch + dates) | – | ✔ | ✔ |
| Order drill-down (read-only history) | – | ✔ | ✔ |

Branch users never see stock levels, other branches, suppliers or reports.
Accountants have no write endpoint at all.

## 4. Complete workflow

```
BRANCH                       WAREHOUSE MANAGER                     ACCOUNTANT
──────                       ─────────────────                     ──────────
Daily Order: enter qty
Save draft (optional)
Submit ───────────────────▶  Daily Orders: open order
                             Edit accepted qty (default = requested)
                             Accept ──▶ ledger: −accepted per item
                             (or Reject whole order)
                             Drivers & Picking:
                               assign order → driver (+ sequence)
                               print picking sheet per driver
                               Dispatch driver's orders
Receiving: enter received ◀─
Confirm ───────────────────▶ Discrepancy visible on order + home
                                                                   Search: branch + dates
                                                                   → accepted qty per item
Anytime: Supplier Receiving (+ledger), Stock Count (± ledger), Inventory view
```

## 5. Screens

**Branch** (tablet-first)
1. *Home* — today's order & status, last accepted order, pending receiving.
2. *Daily Order* — items grouped by category, EN + AR names, big numeric
   inputs, search box, "only items with quantity" toggle, Save / Submit.
3. *My Orders* — history with requested / accepted / received per item.
4. *Receiving* — accepted qty pre-filled into received; adjust; confirm.

**Warehouse Manager** (desktop-first)
1. *Home* — counters: submitted, waiting approval, accepted-unassigned,
   waiting dispatch, waiting receiving, discrepancies; stock alerts.
2. *Daily Orders* — date + branch + status filters; open order → edit
   accepted qty with live available-stock column → Accept / Reject.
3. *Drivers & Picking* — accepted orders for a date grouped Driver → Branch;
   change driver & sequence; "apply default routes"; per-driver picking sheet
   (branch → item → qty, plus driver total per item); Dispatch.
4. *Supplier Receiving* — supplier name, date, item lines → Confirm.
5. *Inventory* — current stock per item (search, category filter);
   click item → full ledger with running balance.
6. *Stock Count* — enter physical counts, see variance live, reason,
   Confirm → adjustments posted.
7. *Accepted Report* — same screen the accountant uses.

**Accountant**
1. *Accepted Quantities* — Branch dropdown, From, To → table (code, item,
   accepted qty) with total, plus the list of orders in range (drill-down).

## 6. Inventory calculation logic

```
Current stock(item) = Σ (direction × quantity) over inventory_transactions
```

| Event | Transaction type | Direction | Quantity |
|---|---|:-:|---|
| Opening balance / count adjustment | STOCK_ADJUSTMENT | ± | abs(variance) |
| Supplier receipt confirmed | SUPPLIER_RECEIPT | +1 | received |
| Branch order accepted | BRANCH_ORDER_ACCEPTED | −1 | accepted |
| Accepted qty changed later | BRANCH_ORDER_REVISION | ± | abs(new − old) |

Rules implemented:

* Requested qty and drafts/edits before acceptance create **no** ledger rows (Rules 1, 5).
* Acceptance posts one −accepted row per item, referencing the order (Rules 1, 8).
* Changing an accepted order (allowed while ACCEPTED or ASSIGNED — before
  dispatch) posts only the **delta**: 20 → 15 posts +5, so 80 → 85 (Rule 6).
  The original row is never edited (Rule 9).
* Dispatch and branch receiving post **nothing** (Rule 4). Received qty is
  stored separately; accepted is never changed by receiving (Rule 2).
* Stock count posts an adjustment only on confirm, with system qty
  re-computed server-side at that moment (Rule 7).
* Stock **may go negative** (confirmed 15/09/2026). The review screen warns
  which lines will go below zero; the next supplier receipt or stock count
  brings it back. Negative items appear in the manager's stock alerts.
* Accountant report = Σ `order_items.accepted_quantity` for orders in
  ACCEPTED, ASSIGNED, DISPATCHED, RECEIVED status, filtered by branch and
  `order_date` (Rule 10).

## 7. Order state transitions

```
DRAFT ──submit──▶ SUBMITTED ──accept──▶ ACCEPTED ──assign──▶ ASSIGNED ──dispatch──▶ DISPATCHED ──confirm receipt──▶ RECEIVED
                      │                    ▲   │                 │
                      └──reject──▶ REJECTED│   └── edit qty ─────┘ (delta posted)
                                           └──unassign── ASSIGNED
```

| From | Action | By | To | Ledger |
|---|---|---|---|---|
| — / DRAFT | save | Branch | DRAFT | none |
| DRAFT | submit | Branch | SUBMITTED | none |
| SUBMITTED | accept | Manager | ACCEPTED | −accepted |
| SUBMITTED | reject | Manager | REJECTED | none |
| ACCEPTED / ASSIGNED | edit accepted | Manager | unchanged | ±delta |
| ACCEPTED | assign driver | Manager | ASSIGNED | none |
| ASSIGNED | unassign | Manager | ACCEPTED | none |
| ASSIGNED | dispatch | Manager | DISPATCHED | none |
| DISPATCHED | confirm receiving | Branch | RECEIVED | none |

An accepted order where every accepted qty is 0 cannot be accepted — reject it instead.

## 8. Sample data

* **83 items** W0001–W0083 exactly as on the SpicyMeal order sheet, with
  English and Arabic names and the sheet's nine categories.
* **17 branches:** Safwa, Awamiyah, Qudaih, Nasserah, Shubailiy, Murooj,
  Taroot, CityMall, Majediyah, Jaroodiyah, Awjam, Qurtuba, Zuhoor, Malath,
  Dhahiyah, Jish, Alsaif (codes B01–B17).
* **3 drivers** with placeholder default routes (edit in *Drivers & Picking*).
* **Users:** one manager, one accountant, one login per branch.
* **Suppliers:** ABC Food (sample).
* Optional demo (`npm run demo`) replays the Section 24 day: 100 French fries
  opening stock, Jish/Awjam/Dahyah orders, accept 20/15/25, assign, dispatch,
  receive 20/14/25.

## 9. Decisions (confirmed 15/09/2026)

1. **Report date = order date.** In practice this is the same day the order is accepted.
2. **Opening stock is entered with a Stock Count** (system 0 → physical N),
   so there is no separate "opening balance" feature.
3. **Order date:** branches can order for today or up to 7 days ahead; never for a past date. Branches can edit a submitted order until it is accepted (see §11). If a change is needed, the
   warehouse adjusts the accepted quantity.
4. **One order per branch per day.**
5. **Accepted qty can still be edited until dispatch**, with delta posting.
6. **Units** are not on the order sheet; every item defaults to "unit". The
   manager can change it from the item's page in Inventory.
7. **Item names** were kept as on the sheet, with light spacing/spelling
   clean-up in English (e.g. "Jalapenosticks" → "Jalapeno sticks",
   "Chooclate" → "Chocolate"). Codes are unchanged.
8. **Driver routes** are placeholders, editable in Drivers & Picking; the real routes will be set after demo testing.

## 10. Factory (second supply source) — added v2.0

* **Sources** are rows in `warehouses`: 1 = Central Warehouse (WH), 2 = Factory (FAC).
  Every item, order, supplier receipt, production batch and ledger row belongs to one source.
  No item exists in both.
* **Items:** 36 factory items F0001–F0036 (codes assigned in the order given; English names are
  translations to review) plus **FR001 Whole chicken (raw)**, which is internal stock and cannot be
  ordered by branches (`items.orderable = 0`).
* **Branches** pick Warehouse or Factory on Daily Order and see only that source's items.
  One order per branch per day **per source** (unique branch + date + source).
* **Managers:** `users.warehouse_id` ties each manager to one source. Every manager query and
  action is filtered by it; another source's orders and items return "not found".
  Factory manager: `factory@spicymeal.sa`.
* **Factory stock in:** *Purchases* (supplier receipt of raw chicken, etc.) and *Production*
  (used items go out as `PRODUCTION_INPUT`, cut/produced items come in as `PRODUCTION_OUTPUT`, in one
  confirmed step, stored in `production_batches` / `production_lines`). Stock count works as before.
* **Drivers** are shared. Each manager assigns and dispatches his own orders; default routes are shared.
* **Accountant** report gains a Source filter (both / warehouse / factory) with subtotals per source.
* **Upgrade:** an existing v1 database is migrated automatically on start (`PRAGMA user_version = 2`);
  orders are rebuilt with the new unique key, the ledger is rebuilt to allow the new types, all rows kept.

## 11. Branch Daily Order flow — v2.1

* **Daily Order** lists the branch's *open* orders (Draft or Submitted) with an Edit button, plus one **Start new order** button.
* **Start new order** → pop-up: Warehouse or Factory. If one source already has an open order, the branch goes straight to the other.
  If both have open orders, a message says no new order is possible.
* **Submitted orders can be edited until the manager accepts them.** After acceptance they are locked (move to My Orders).
* **One open order per source** (enforced on the server). The order date defaults to the first free date (today, else tomorrow…, up to 7 days).
* If a branch changes an order while the manager is reviewing it, the manager's accept is refused with "reload the page".

## 12. Drivers — v3.0

* **Driver login** (`users.role = 'DRIVER'`, `users.driver_id`). Phone-first screens:
  * *Today* — pickups to load (per source and date, with a total per item) and stops in order.
    **Loaded** turns his ASSIGNED orders at that source into DISPATCHED (`dispatched_at`, `dispatched_by`).
    **Delivered** records `delivered_at` / `delivered_by` on the stop; the order stays DISPATCHED until the branch confirms quantities.
  * *My Tasks* — open tasks with due date (overdue highlighted); **Mark done** with an optional note.
* Drivers see only their own stops and tasks. Driver actions post no stock transactions.
  The managers' Dispatch button remains as a fallback (records who dispatched).
* **Tasks** (`driver_tasks`: OPEN → DONE / CANCELLED) are created and cancelled by the **warehouse manager only**.
* **Tracking** (warehouse manager → *Drivers*): per driver and date range — stops, delivered, orders with receiving
  differences (and % of received), units short (sent − received), tasks done / assigned, open, overdue, average hours to finish.
  Driver profile: task list, assign task, edit name/phone/active, and every delivery with load/deliver times and differences.
* **Upgrade:** v2 → v3 migration rebuilds `users` (new role + driver link, ids kept), adds the tracking columns to `orders`,
  creates `driver_tasks`, and creates a login for each existing driver.

## 13. Item master — v3.1 (official list of 15/09/2026)

* 87 warehouse items (W0001–W0088, no W0016) and 33 factory items (F0001–F0036, no F0022–F0024) + FR001 raw chicken.
* Cheese slices (W0086), liquid/creamy cheese (W0085) and mayonnaise (W0087) are now **warehouse** items.
* Several codes changed meaning compared with the first sheet (e.g. F0001 is now Spicy Dinner Bag; W0056 is now French fries packets).
* `syncItems` applies the list by code whenever `ITEMS_VERSION` changes: names, category, source and order are updated,
  manager-set units are kept, and codes that are no longer listed are deactivated (their history stays).
* Groups shown to branches — Warehouse: Frozen · Dry Items & Cheese · Beverages · Bags · Paper · Packaging · Cleaning · Plastics & Gloves · Misc.
  Factory: Chicken · Burgers, Seafood & Prepared · Dips & Salads · Flour · Staff Meals · Vegetables.

## 14. Reorder alerts — v3.2

* `items.reorder_level` (optional, whole number ≥ 0), set per item by that source's manager — inline in *Inventory*
  ("Reorder at" column) or on the item page. Empty = no alert. Not touched by the item-list sync.
* An item **needs reordering when current stock ≤ its reorder level**. Stock ≤ 0 shows as *Out of stock*.
* Shown on the manager's home (tile "Items to reorder" + *Stock alerts* table with stock, level and waiting requests),
  as a gold count on the *Inventory* menu item, as highlighted rows with an "Only items to reorder" filter in Inventory,
  and as a *Reorder* tag in the order review when accepting would bring stock to or below the level.
* Warehouse and factory alerts are separate (each manager sees his own).

## 15. Accounts & CFO — v4.0

Money is stored as whole halalas (1 SAR = 100). All values use the **standard cost** of the item on the relevant date.

* **Item costs** (`item_costs`): the accountant enters a cost price per item with a start date. The history is kept, and
  a new price never changes figures dated before it. The screen also shows the last purchase price and flags a gap over 5%.
* **Valued reports**: the Accepted Quantities report shows value columns for Accounts and the CFO only. There is also an
  **All Branches** summary (warehouse and factory), a printable **monthly Branch Statement** (company header, each order
  with accepted and received quantities, unit cost and value, plus receiving differences), and **Stock Value** at the end
  of any date (ledger quantity × cost, by source and category).
* **Supplier invoices**: the manager records the invoice number and unit prices on Supplier Receiving; both are optional.
  Accounts completes any missing details and marks the invoice **Checked**. States: Needs details → To check → Checked
  → In payment request → Paid. There are totals by supplier and month.
* **Payment requests** (`payment_requests`): Accounts combines one supplier's checked invoices into a request
  numbered PR-YYYY-NNNN. VAT is optional and uses the company rate, and the due date follows the supplier's payment
  terms. The request is a printable document with company and supplier details (CR, VAT, bank, IBAN), every product with
  its received quantity, unit price and amount, the subtotal, VAT and total, and signature blocks.
  **CFO** (`cfo@spicymeal.sa`): Approve → Mark as paid (**paid from** which company bank account — picked from the accounts saved under Company & Suppliers — plus payment date and transfer reference), or Return with a reason,
  which frees the invoices. Accounts can cancel a request while the CFO has not acted on it.
  An invoice can only be in one active request.
* **Factory yield**: raw chicken used versus portions produced (per raw unit), per batch and in total, with values.
* **Month-end lock** (`periods`): once Accounts closes a month, nothing dated in it can be added or changed (orders,
  acceptance, receiving, supplier receipts, counts, production, invoice prices, costs). Reopening needs a reason.
  The screen lists what is still open before closing.
* **Change log** (`audit_log`, append-only through triggers): order acceptance and revisions, rejections, receiving
  differences, receipts, counts, production, reorder levels, units, drivers, tasks, costs, invoices, payment requests,
  and month closing/reopening. It can be filtered by date, action, user and text.
* **Excel and PDF**: real .xlsx files are built in the browser (no library), and Print / PDF is available on the reports
  and documents.
* The CFO can see everything in Accounts but only acts on payment requests.
* **Not built, by decision:** a losses/waste report (#8). **Next week (owner's add-on):** costing and consumption.

## 16. Maintenance — v5.0

**Who**
* **Anyone in the field** (branches, the warehouse and factory managers, drivers) can *Report a problem* and follow it
  under **Maintenance**. A branch always reports for its own branch, a manager for the warehouse or factory (or a
  vehicle), and a driver for a vehicle.
* The **Maintenance Supervisor** (`maintenance@spicymeal.sa`, new role) sees everything, assigns work, creates
  **mandatory** jobs, closes finished work, and manages schedules, documents, vehicles and equipment, and technicians.
* **Technicians** (`tech1@`, `tech2@`, new role) see only their own jobs. They can start a job, add notes and mark it done
  with a description of the work.
* **Outside contractors** are kept in the same list as suppliers, so their bank details and payments go through accounts.

**Types:** Cars & vehicles, Hardware & equipment, Software & systems, Lights, Switches & sockets, Electricity, Plumbing,
Government requirements, Other. **Priority:** Urgent, High, Normal, Low. The supervisor can set a due date and see overdue jobs.

**Job life cycle:** New → Assigned (a technician and/or contractor is set) → In progress → Done → **Closed** (the supervisor
checks the work).
* The supervisor can *send a job back* (Done → In progress), *reject* a new or assigned job (with a reason), or
  *cancel* it.
* A requester can cancel their own request while it is still New.
* Every step is recorded in the job's notes and history and in the change log.

**Mandatory work**
* **Schedules** repeat every N days, weeks or months (for example van oil service, fire extinguisher checks, freezer
  service). A job is created automatically *lead days* before each due date, and the due date then moves to the next
  period. Only one open job exists per schedule. The check runs when the server starts, every hour, and whenever the
  supervisor opens a page.
* **Licenses & Documents register** holds Baladiya, Civil Defense, CR, health certificates, Istimara, insurance, Fahas and
  similar, each with a reference number and expiry date.
  * Status is *Valid*, *Expiring soon* (within the reminder days, 30 by default) or *Expired*.
  * *Start renewal job* opens a Government job linked to the document. Closing that job with a new expiry date renews
    the document.
  * *Renewed* updates a document directly.
* **Vehicles & Equipment** can be chosen on jobs, schedules and documents (a vehicle can be linked to its driver), with
  job count and cost per item.

**Costs**
* The supervisor enters a cost (SAR, excluding VAT) on a job, plus the contractor's invoice number for outside work.
* Contractor bills appear under **Accounts → Maintenance Bills**. The accountant checks them and adds them to a
  **payment request** for that contractor, next to or instead of goods invoices. The CFO then approves and pays as usual.
* A bill cannot be changed once it is checked or requested. The month-end lock also blocks cost changes.
* **Maintenance Costs** report (supervisor, accounts, CFO): by type, place, contractor and vehicle/equipment, with an
  Excel export.

## 17. Recommendations — NOT built (flagged per brief)

* Cutting yields (expected cuts per chicken) and decimal/kg quantities for the factory — to discuss.
* Admin screen to add users/branches/drivers/items (today: `npm run add-user` script and SQL).
* Order cut-off time for branches.
* Login rate limiting and HTTPS termination (put behind nginx/Caddy in production).
* Automated nightly backup of `data/wms.db`.
* Maintenance: photos on requests, an *Air conditioning & refrigeration* category (very common in restaurants), spare-parts stock, and email/WhatsApp alerts for urgent jobs and expiring documents.
