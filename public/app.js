'use strict';
/* SpicyMeal WMS — single-page frontend (no build step). */

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US'));
const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS_LABEL = { DRAFT: 'Draft', SUBMITTED: 'Submitted', ACCEPTED: 'Accepted', ASSIGNED: 'Assigned', DISPATCHED: 'Dispatched', RECEIVED: 'Received', REJECTED: 'Rejected' };
const badge = (s, diffs = 0) => (!s ? '<span class="badge">Not started</span>'
  : s === 'RECEIVED' && diffs > 0 ? `<span class="badge b-DIFF">Received · ${diffs} difference${diffs > 1 ? 's' : ''}</span>`
    : `<span class="badge b-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`);
const TX_LABEL = { PRODUCTION_INPUT: 'Production — used', PRODUCTION_OUTPUT: 'Production — produced', SUPPLIER_RECEIPT: 'Supplier receipt', BRANCH_ORDER_ACCEPTED: 'Branch order accepted', BRANCH_ORDER_REVISION: 'Accepted qty revised', STOCK_ADJUSTMENT: 'Stock count adjustment' };
// Categories in the order items arrive (items are pre-sorted by the server).
const categoriesOf = (list) => [...new Set(list.map((i) => i.category))];
const SOURCE_SHORT = { WH: 'Warehouse', FAC: 'Factory' };
const srcLabel = (code, name) => SOURCE_SHORT[code] || name || '';
const srcTag = (code, name) => `<span class="src src-${esc(code || '')}">${esc(srcLabel(code, name))}</span>`;
const ROLE_LABEL = { BRANCH: 'Branch', WAREHOUSE_MANAGER: 'Warehouse Manager', ACCOUNTANT: 'Accountant', DRIVER: 'Driver', CFO: 'CFO', MAINT_SUPERVISOR: 'Maintenance Supervisor', TECHNICIAN: 'Technician' };

async function api(method, path, body) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/api/login') { state.me = null; renderLogin(); throw new Error('Please sign in'); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
const GET = (p) => api('GET', p);
const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))).toString();

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 3000);
}

function modal({ title, body, ok = 'Confirm', okClass = 'primary', cancel = 'Cancel', input }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="mb">${body || ''}
      ${input ? `<label class="f" style="margin-top:10px">${esc(input)}<textarea class="input" rows="2" id="m-in"></textarea></label>` : ''}</div>
      <div class="mf">${cancel ? `<button class="btn" data-x>${esc(cancel)}</button>` : ''}<button class="btn ${okClass}" data-ok>${esc(ok)}</button></div></div>`;
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') close(false); };
    bg.addEventListener('click', (e) => {
      if (e.target === bg || e.target.hasAttribute('data-x')) close(false);
      if (e.target.hasAttribute('data-ok')) close(input ? ($('#m-in', bg).value.trim() || null) : true);
    });
    document.addEventListener('keydown', key);
    document.body.appendChild(bg);
    ($('#m-in', bg) || $('[data-ok]', bg)).focus();
  });
}

async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}

const ICON = {
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  order: '<path d="M9 4h6v3H9zM6 5h2m8 0h2v16H6V5"/><path d="M9 12h6M9 16h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  truck: '<path d="M2 6h11v10H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v7H2v-7z"/>',
  count: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M5 12h14"/>',
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

// ───────────────────────── app state & routing ─────────────────────────
const state = { me: null, items: null, dirty: false };
async function items(source = '') {
  state.items = state.items || {};
  if (!state.items[source]) state.items[source] = await GET('/api/items' + (source ? '?source=' + source : ''));
  return state.items[source];
}
async function sources() { if (!state.sources) state.sources = await GET('/api/sources'); return state.sources; }
const isFactoryMgr = () => state.me?.role === 'WAREHOUSE_MANAGER' && state.me.warehouse_code === 'FAC';
const roleLabel = (me) => (me.role === 'WAREHOUSE_MANAGER' ? `${srcLabel(me.warehouse_code, me.warehouse_name)} Manager` : ROLE_LABEL[me.role]);

const NAV = {
  BRANCH: [['#/home', 'Home', 'home'], ['#/order', 'Daily Order', 'order'], ['#/receiving', 'Receiving', 'check'], ['#/orders', 'My Orders', 'list'], ['#/maintenance', 'Maintenance', 'tool']],
  WAREHOUSE_MANAGER: [['#/home', 'Home', 'home'], ['#/orders', 'Daily Orders', 'order'], ['#/picking', 'Drivers & Picking', 'truck'], ['#/supplier', 'Supplier Receiving', 'inbox'], ['#/inventory', 'Inventory', 'box'], ['#/count', 'Stock Count', 'count'], ['#/report', 'Accepted Report', 'report'], ['#/maintenance', 'Maintenance', 'tool']],
  ACCOUNTANT: [['#/home', 'Home', 'home'], ['#/invoices', 'Supplier Invoices', 'file'], ['#/requests', 'Payment Requests', 'money'], ['#/summary', 'All Branches', 'grid'], ['#/report', 'Accepted Quantities', 'report'], ['#/costs', 'Item Costs', 'tag'], ['#/stock-value', 'Stock Value', 'box'], ['#/yield', 'Factory Yield', 'cut'], ['#/periods', 'Month-End', 'lock'], ['#/maint-bills', 'Maintenance Bills', 'tool'], ['#/audit', 'Change Log', 'clock'], ['#/settings', 'Company & Suppliers', 'gear']],
  CFO: [['#/home', 'Home', 'home'], ['#/requests', 'Payment Requests', 'money'], ['#/summary', 'All Branches', 'grid'], ['#/report', 'Accepted Quantities', 'report'], ['#/invoices', 'Supplier Invoices', 'file'], ['#/stock-value', 'Stock Value', 'box'], ['#/costs', 'Item Costs', 'tag'], ['#/yield', 'Factory Yield', 'cut'], ['#/periods', 'Month-End', 'lock'], ['#/maint-costs', 'Maintenance Costs', 'tool'], ['#/audit', 'Change Log', 'clock'], ['#/settings', 'Company & Suppliers', 'gear']],
  DRIVER: [['#/home', 'Today', 'truck'], ['#/tasks', 'My Tasks', 'check'], ['#/maintenance', 'Maintenance', 'tool']],
  MAINT_SUPERVISOR: [['#/home', 'Home', 'home'], ['#/jobs', 'Jobs', 'tool'], ['#/schedules', 'Schedules', 'cal'], ['#/documents', 'Licenses & Documents', 'file'], ['#/assets', 'Vehicles & Equipment', 'car'], ['#/technicians', 'Technicians', 'user'], ['#/maint-costs', 'Costs', 'money']],
  TECHNICIAN: [['#/home', 'My Jobs', 'tool']],
};

const ROUTES = {
  BRANCH: { home: BranchHome, order: BranchOrder, 'order/new': OrderEditor, 'order/:id': OrderEditor, orders: BranchOrders, 'orders/:id': OrderDetail, receiving: BranchReceivingList, 'receive/:id': BranchReceive, maintenance: MaintRequests, 'maintenance/new': MaintNew, 'maintenance/:id': MaintJob, account: Account },
  WAREHOUSE_MANAGER: { home: ManagerHome, orders: ManagerOrders, 'orders/:id': OrderDetail, picking: Picking, drivers: Drivers, 'drivers/:id': DriverProfile, supplier: SupplierReceiving, production: Production, inventory: Inventory, 'inventory/:id': ItemLedger, count: StockCount, report: Report, maintenance: MaintRequests, 'maintenance/new': MaintNew, 'maintenance/:id': MaintJob, account: Account },
  ACCOUNTANT: null, CFO: null,
  DRIVER: { home: DriverToday, tasks: DriverTasks, maintenance: MaintRequests, 'maintenance/new': MaintNew, 'maintenance/:id': MaintJob, account: Account },
  MAINT_SUPERVISOR: { home: SupHome, jobs: Jobs, 'maintenance/new': MaintNew, 'maintenance/:id': MaintJob, schedules: Schedules, documents: Documents, assets: Assets, technicians: Technicians, 'maint-costs': MaintCosts, account: Account },
  TECHNICIAN: { home: TechHome, 'maintenance/:id': MaintJob, account: Account },
};

const FIN_ROUTES = { home: FinanceHome, report: Report, 'orders/:id': OrderDetail, summary: BranchSummary, statement: Statement, 'stock-value': StockValue, costs: ItemCosts,
  invoices: Invoices, 'invoices/:id': InvoiceDetail, requests: Requests, 'requests/new': NewRequest, 'requests/:id': RequestDetail, yield: Yield, periods: Periods, audit: AuditLog, settings: Settings,
  'maint-bills': MaintBills, 'maint-costs': MaintCosts, 'maintenance/:id': MaintJob, account: Account };
ROUTES.ACCOUNTANT = FIN_ROUTES;
ROUTES.CFO = FIN_ROUTES;
const isFin = () => ['ACCOUNTANT', 'CFO'].includes(state.me?.role);

function parseHash() {
  const [path, q] = (location.hash.slice(2) || 'home').split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(q || '')) };
}

async function router() {
  if (!state.me) return;
  const { path, query } = parseHash();
  const table = ROUTES[state.me.role];
  let page = null, params = {};
  for (const [pat, fn] of Object.entries(table)) {
    const re = new RegExp('^' + pat.replace(/:(\w+)/g, '([^/]+)') + '$');
    const m = re.exec(path);
    if (m) { page = fn; const keys = [...pat.matchAll(/:(\w+)/g)].map((k) => k[1]); keys.forEach((k, i) => { params[k] = m[i + 1]; }); break; }
  }
  if (!page) { location.hash = '#/home'; return; }
  state.dirty = false;
  renderShell(path);
  const old = $('#main');
  const main = old.cloneNode(false); // fresh element → no stale listeners from the previous page
  old.replaceWith(main);
  main.innerHTML = '<div class="muted">Loading…</div>';
  try { await page(main, params, query); } catch (e) { main.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}

function renderShell(path) {
  const me = state.me;
  let nav = NAV[me.role];
  if (isFactoryMgr()) {
    nav = nav.map((n) => (n[0] === '#/supplier' ? ['#/supplier', 'Purchases', 'inbox'] : n));
    nav.splice(4, 0, ['#/production', 'Production', 'cut']);
  } else if (me.role === 'WAREHOUSE_MANAGER') {
    nav = [...nav.slice(0, 3), ['#/drivers', 'Drivers', 'user'], ...nav.slice(3)];
  }
  const top = path.split('/')[0];
  const isOn = (href) => href.slice(2) === top || (top === 'receive' && href === '#/receiving') || (top === 'orders' && href === '#/orders' && !isFin()) || (top === 'statement' && href === '#/summary') || (top === 'maintenance' && href === (isSupv() ? '#/jobs' : isFin() ? '#/maint-bills' : '#/maintenance')) || (top === 'inventory' && href === '#/inventory') || (top === 'drivers' && href === '#/drivers');
  if (!$('.shell')) {
    $('#app').innerHTML = `<div class="shell">
      <aside class="side">
        <div class="brand"><img src="/logo.png" alt="SpicyMeal"><div>SpicyMeal<br><small>${esc(me.role === 'WAREHOUSE_MANAGER' ? srcLabel(me.warehouse_code, me.warehouse_name) : me.role === 'BRANCH' ? 'Branch' : me.role === 'DRIVER' ? 'Driver' : me.role === 'CFO' ? 'CFO' : me.role === 'MAINT_SUPERVISOR' || me.role === 'TECHNICIAN' ? 'Maintenance' : 'Accounts')}</small></div></div>
        <nav class="nav" id="nav"></nav>
        <div class="side-foot"><b>${esc(me.name)}</b>${esc(roleLabel(me))}${me.branch_name ? ' · ' + esc(me.branch_name) : ''}
          <div class="links"><a href="#/account">Password</a><button id="logout">Sign out</button></div></div>
      </aside>
      <div>
        <header class="topbar"><img src="/logo.png" alt="SpicyMeal"><b>SpicyMeal</b>
          <div class="who">${esc(me.branch_name || roleLabel(me))}</div><button id="logout2">Sign out</button></header>
        <main class="main" id="main"></main>
      </div>
      <nav class="tabbar" id="tabbar"></nav>
    </div>`;
    const out = async () => { await api('POST', '/api/logout', {}).catch(() => {}); state.me = null; state.items = null; state.sources = null; state.mmeta = null; location.hash = ''; renderLogin(); };
    $('#logout').onclick = out; $('#logout2').onclick = out;
  }
  const links = nav.map(([h, l, i]) => `<a href="${h}" class="${isOn(h) ? 'on' : ''}">${icon(i)}<span>${esc(l)}</span>${h === '#/inventory' ? '<span class="badge count" data-reorder hidden></span>' : ''}</a>`).join('');
  $('#nav').innerHTML = links;
  $('#tabbar').innerHTML = links;
  if (me.role === 'WAREHOUSE_MANAGER') {
    GET('/api/reorder-count').then((r) => $$('[data-reorder]').forEach((b) => { b.hidden = !r.count; b.textContent = r.count; b.title = `${r.count} item(s) to reorder`; })).catch(() => {});
  }
}

function renderLogin() {
  $('#app').innerHTML = `<div class="login">
    <div class="login-art">
      <img class="login-logo" src="/logo.png" alt="SpicyMeal logo">
      <div style="position:relative;z-index:1"><h1><span>SpicyMeal</span><br>Warehouse Management</h1><p>Daily branch orders, picking, deliveries and stock — in one place.</p>
      <div class="ar-line">نظام إدارة مستودع سبايسي ميل</div></div>
    </div>
    <div class="login-form"><form id="lf" autocomplete="on">
      <div><h2 style="margin:0 0 4px">Sign in</h2><div class="muted">Use the account provided by the warehouse.</div></div>
      <label class="f">Email<input class="input" name="email" type="email" autocomplete="username" required autofocus></label>
      <label class="f">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div id="lerr" class="note bad" hidden></div>
      <button class="btn primary lg">Sign in</button>
    </form></div></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      await api('POST', '/api/login', { email: f.get('email'), password: f.get('password') });
      state.me = await GET('/api/me');
      if (!location.hash || location.hash === '#/') location.hash = '#/home';
      router();
    } catch (err) { $('#lerr').hidden = false; $('#lerr').textContent = err.message; btn.disabled = false; }
  };
}

window.addEventListener('hashchange', router);
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
(async function boot() {
  try { state.me = await GET('/api/me'); router(); } catch { renderLogin(); }
})();

const head = (title, sub = '', actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="row no-print">${actions}</div></div>`;
const itemCell = (l) => `<div class="iname">${esc(l.item_name)}</div><div class="ar">${esc(l.item_name_ar || '')}</div>`;

// ───────────────────────── shared: order detail ─────────────────────────
function lifecycle(o) {
  const steps = [['Requested', o.submitted_at], ['Accepted', o.accepted_at], [`Loaded${o.dispatched_by_name ? ' · ' + o.dispatched_by_name : ''}`, o.dispatched_at],
    ...(o.delivered_at ? [['Delivered (driver)', o.delivered_at]] : []), ['Received', o.received_at]];
  if (o.status === 'REJECTED') return `<div class="note bad"><b>Rejected</b> ${fmtTime(o.accepted_at)} — ${esc(o.reject_reason)}</div>`;
  return `<div class="summary">${steps.map(([k, t]) => `<div><div class="k">${esc(k)}</div><div style="font-weight:600;color:${t ? 'var(--ink)' : 'var(--ink-3)'}">${t ? fmtTime(t) : 'Pending'}</div></div>`).join('')}
    ${o.driver_name ? `<div><div class="k">Driver</div><div style="font-weight:600">${esc(o.driver_name)} · stop ${o.sequence}</div></div>` : ''}</div>`;
}

async function OrderDetail(main, { id }) {
  const o = await GET(`/api/orders/${id}`);
  const role = state.me.role;
  const editable = role === 'WAREHOUSE_MANAGER' && ['SUBMITTED', 'ACCEPTED', 'ASSIGNED'].includes(o.status);
  const back = role === 'BRANCH' ? '#/orders' : isFin() ? 'javascript:history.back()' : `#/orders?date=${o.order_date}`;
  main.innerHTML = head(`${esc(o.branch_name)} — ${fmtDate(o.order_date)} ${badge(o.status, o.discrepancies)}`, `${srcTag(o.source_code, o.source_name)} Order #${o.id} · ${esc(o.branch_code)}`,
    `<a class="btn" href="${back}">Back</a>${role === 'BRANCH' && o.status === 'DISPATCHED' ? `<a class="btn primary" href="#/receive/${o.id}">Confirm receiving</a>` : ''}${role === 'BRANCH' && ['DRAFT', 'SUBMITTED'].includes(o.status) ? `<a class="btn primary" href="#/order/${o.id}">${o.status === 'DRAFT' ? 'Continue editing' : 'Edit order'}</a>` : ''}`)
    + `<div class="stack"><div class="card card-b">${lifecycle(o)}</div><div id="lines"></div></div>`;
  if (editable) return ManagerReview(main, o);

  if (o.discrepancies) {
    $('.stack', main).insertAdjacentHTML('afterbegin', `<div class="note bad"><b>${o.discrepancies} receiving difference${o.discrepancies > 1 ? 's' : ''}</b> — ${role === 'BRANCH' ? 'reported to the warehouse.' : 'the branch received a different quantity than was sent. Accepted quantities and stock are unchanged.'}${o.receiving_notes ? ` Branch note: “${esc(o.receiving_notes)}”` : ''}</div>`);
  }
  const showAcc = o.status !== 'DRAFT' && o.status !== 'SUBMITTED' && o.status !== 'REJECTED';
  const showRec = o.status === 'RECEIVED';
  $('#lines', main).innerHTML = `<div class="card"><div class="card-h"><h3>Items</h3>
    ${o.discrepancies ? `<span class="badge b-REJECTED">${o.discrepancies} receiving difference${o.discrepancies > 1 ? 's' : ''}</span>` : ''}</div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Code</th><th>Item</th><th class="num">Requested</th>
    ${showAcc ? '<th class="num">Accepted</th>' : ''}${showRec ? '<th class="num">Received</th><th class="num">Difference</th>' : ''}</tr></thead>
    <tbody>${o.lines.map((l) => {
      const diff = showRec ? (l.received_quantity ?? 0) - (l.accepted_quantity ?? 0) : 0;
      return `<tr class="${diff ? 'flag' : ''} ${showAcc && !l.accepted_quantity ? 'dim' : ''}"><td class="code">${esc(l.item_code)}</td><td>${itemCell(l)}</td>
      <td class="num">${n0(l.requested_quantity)}</td>${showAcc ? `<td class="num"><b>${n0(l.accepted_quantity)}</b></td>` : ''}
      ${showRec ? `<td class="num">${n0(l.received_quantity)}</td><td class="num ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}">${diff ? (diff > 0 ? '+' : '') + diff : '—'}</td>` : ''}</tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td></td><td>Total</td><td class="num">${n0(o.totals.requested)}</td>${showAcc ? `<td class="num">${n0(o.totals.accepted)}</td>` : ''}
    ${showRec ? `<td class="num">${n0(o.totals.received)}</td><td class="num">${n0(o.totals.received - o.totals.accepted)}</td>` : ''}</tr></tfoot></table></div>
    ${o.receiving_notes ? `<div class="card-b"><b>Receiving note:</b> ${esc(o.receiving_notes)}</div>` : ''}
    ${showRec ? `<div class="card-b muted">Received by ${esc(o.received_by_name)} on ${fmtTime(o.received_at)}</div>` : ''}</div>`;
}

// Manager: edit accepted quantities, accept / reject / revise
function ManagerReview(main, o) {
  const first = o.status === 'SUBMITTED';
  const val = new Map(o.lines.map((l) => [l.item_id, first ? l.requested_quantity : l.accepted_quantity]));
  // available to this order = current stock (+ what this order already holds, when revising)
  const avail = (l) => l.stock + (first ? 0 : l.accepted_quantity);

  $('#lines', main).innerHTML = `<div class="card">
    <div class="card-h"><h3>${first ? 'Review & accept' : 'Adjust accepted quantities'}</h3>
      <div class="row">${first ? '<button class="btn sm" id="all-req">Set all to requested</button>' : ''}
      <span class="muted">${first ? 'Accepted quantities are deducted from stock when you accept.' : 'Changes post only the difference to stock. Locked after dispatch.'}</span></div></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Code</th><th>Item</th><th class="num">Available</th><th class="num">Requested</th><th class="num">Accepted</th><th class="num">Stock after</th><th></th></tr></thead>
    <tbody>${o.lines.map((l) => `<tr data-id="${l.item_id}"><td class="code">${esc(l.item_code)}</td><td>${itemCell(l)}</td>
      <td class="num">${n0(avail(l))}</td><td class="num">${n0(l.requested_quantity)}</td>
      <td class="num"><input class="qty" inputmode="numeric" pattern="[0-9]*" value="${val.get(l.item_id)}" aria-label="Accepted ${esc(l.item_name)}"></td>
      <td class="num after"></td><td><button class="btn sm ghost zero" title="Don't send this item">Remove</button></td></tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td>Total</td><td></td><td class="num">${n0(o.totals.requested)}</td><td class="num" id="acc-total"></td><td></td><td></td></tr></tfoot></table></div></div>
    <div class="actionbar"><div class="grow" id="bar-msg"></div>
      ${first ? '<button class="btn danger lg" id="reject">Reject order</button><button class="btn primary lg" id="accept">Accept & finalize</button>'
    : '<button class="btn primary lg" id="save" disabled>Save changes</button>'}</div>`;

  const recalc = () => {
    let total = 0, invalid = 0, short = 0, changed = 0;
    for (const tr of $$('tbody tr[data-id]', main)) {
      const l = o.lines.find((x) => x.item_id === Number(tr.dataset.id));
      const inp = $('.qty', tr);
      const raw = inp.value.trim();
      const v = raw === '' ? 0 : Number(raw);
      const okNum = Number.isInteger(v) && v >= 0;
      const after = avail(l) - (okNum ? v : 0);
      $('.after', tr).textContent = n0(after);
      $('.after', tr).className = 'num after ' + (after < 0 ? 'neg' : '');
      if (after >= 0 && l.reorder_level !== null && l.reorder_level !== undefined && after <= l.reorder_level) {
        $('.after', tr).innerHTML = `${n0(after)} <span class="badge b-REORDER" title="Reorder level ${l.reorder_level}">Reorder</span>`;
      }
      inp.classList.toggle('err', !okNum);
      tr.classList.toggle('flag', okNum && after < 0);
      inp.classList.toggle('has', okNum && v !== l.requested_quantity);
      tr.classList.toggle('dim', okNum && v === 0);
      if (!okNum) invalid++;
      else if (after < 0) short++;
      if (okNum) total += v;
      if (!first && okNum && v !== l.accepted_quantity) changed++;
    }
    $('#acc-total', main).textContent = n0(total);
    const msg = $('#bar-msg', main);
    msg.innerHTML = invalid ? `<span class="note bad">${invalid} invalid quantit${invalid > 1 ? 'ies' : 'y'} — whole numbers only</span>`
      : (short ? `<span class="note warn">${short} line${short > 1 ? 's' : ''} will take stock below zero</span> ` : '') + `Accepting <b>${n0(total)}</b> units across <b>${o.lines.length}</b> lines` + (!first ? ` · ${changed} change${changed === 1 ? '' : 's'}` : '');
    const b = $('#accept, #save', main);
    b.disabled = !!invalid || total === 0 || (!first && !changed);
    if (!first) state.dirty = changed > 0;
    return { total, short, lines: $$('tbody tr[data-id]', main).map((tr) => ({ item_id: Number(tr.dataset.id), accepted_quantity: $('.qty', tr).value.trim() || 0 })) };
  };
  main.addEventListener('input', (e) => { if (e.target.matches('.qty')) recalc(); });
  main.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.matches('.zero')) { $('.qty', t.closest('tr')).value = 0; recalc(); }
    if (t.id === 'all-req') { $$('tbody tr[data-id]', main).forEach((tr) => { $('.qty', tr).value = o.lines.find((x) => x.item_id === Number(tr.dataset.id)).requested_quantity; }); recalc(); }
    if (t.id === 'accept' || t.id === 'save') {
      const { total, short, lines } = recalc();
      const warn = short ? `<p class="note warn"><b>${short} item${short > 1 ? 's' : ''} will go below zero.</b> Record the supplier receipt or a stock count later to correct it.</p>` : '';
      const ok = await modal({ title: first ? `Accept ${o.branch_name}'s order?` : 'Save changes?', body: warn + (first ? `<p><b>${n0(total)}</b> units will be deducted from warehouse stock and the order will be ready for picking.</p>` : '<p>Stock will be corrected by the difference for each changed line.</p>'), ok: first ? 'Accept & finalize' : 'Save' });
      if (!ok) return;
      await busy(t, async () => {
        await api('POST', `/api/orders/${o.id}/accept`, { lines });
        state.dirty = false;
        toast(first ? 'Order accepted — stock updated' : 'Changes saved — stock corrected');
        router();
      });
    }
    if (t.id === 'reject') {
      const reason = await modal({ title: `Reject ${o.branch_name}'s order?`, body: '<p>No stock will move. The branch will see the reason.</p>', ok: 'Reject order', okClass: 'danger', input: 'Reason (required)' });
      if (reason === false) return;
      if (!reason) return toast('A reason is required', true);
      await busy(t, async () => { await api('POST', `/api/orders/${o.id}/reject`, { reason }); toast('Order rejected'); router(); });
    }
  });
  recalc();
}

// ───────────────────────── BRANCH ─────────────────────────
async function BranchHome(main) {
  const h = await GET('/api/branch/home');
  const la = h.last_accepted;
  const card = ({ source, order: t }) => {
    const src = srcLabel(source.code, source.name);
    const link = t && ['DRAFT', 'SUBMITTED'].includes(t.status) ? `#/order/${t.id}` : `#/order/new?source=${source.id}`;
    return `<div class="card"><div class="card-h"><h2>${srcTag(source.code, source.name)} Today's ${esc(src.toLowerCase())} order</h2>${badge(t?.status, t?.discrepancies)}</div><div class="card-b">
      ${!t ? `<p>Not started yet.</p><a class="btn primary lg" href="${link}">Order from ${esc(src)}</a>`
    : t.status === 'DRAFT' ? `<p>Draft with ${t.lines.length} item${t.lines.length === 1 ? '' : 's'} — <b>not sent yet</b>.</p><a class="btn primary lg" href="${link}">Continue & submit</a>`
      : `<div class="summary"><div><div class="k">Items</div><div class="v">${t.lines.length}</div></div><div><div class="k">Requested</div><div class="v">${n0(t.totals.requested)}</div></div>
          ${t.accepted_at && t.status !== 'REJECTED' ? `<div><div class="k">Accepted</div><div class="v">${n0(t.totals.accepted)}</div></div>` : ''}</div>
          ${t.status === 'REJECTED' ? `<p class="note bad">Rejected: ${esc(t.reject_reason)}</p>` : ''}
          <p class="row"><a class="btn" href="#/orders/${t.id}">View details</a>${t.status === 'SUBMITTED' ? `<a class="btn primary" href="${link}">Edit order</a>` : ''}</p>`}
    </div></div>`;
  };
  main.innerHTML = head(`${esc(h.branch.branch_name)} Branch`, `Today · ${fmtDate(h.today)}`) + `<div class="stack">
    ${h.to_receive.length ? `<div class="note warn row"><b class="grow">${h.to_receive.length} deliver${h.to_receive.length > 1 ? 'ies' : 'y'} on the way — confirm what you receive.</b>
      ${h.to_receive.map((r) => `<a class="btn primary" href="#/receive/${r.id}">Receive ${esc(srcLabel(r.source_code, r.source_name))} · ${fmtDate(r.order_date)}</a>`).join('')}</div>` : ''}
    <div class="grid2">${h.today_orders.map(card).join('')}</div>
    <div class="card"><div class="card-h"><h2>Last accepted order</h2>${la ? badge(la.status, la.discrepancies) : ''}</div>
      ${la ? `<div class="card-b"><div class="row">${srcTag(la.source_code, la.source_name)}<b>${fmtDate(la.order_date)}</b><span class="muted">${la.lines.filter((l) => l.accepted_quantity).length} items · ${n0(la.totals.accepted)} units accepted</span><span class="grow"></span><a class="btn sm" href="#/orders/${la.id}">Open</a></div></div>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Requested</th><th class="num">Accepted</th><th class="num">Received</th></tr></thead><tbody>
      ${la.lines.slice(0, 8).map((l) => `<tr><td>${esc(l.item_name)}</td><td class="num">${n0(l.requested_quantity)}</td><td class="num"><b>${n0(l.accepted_quantity)}</b></td><td class="num">${n0(l.received_quantity)}</td></tr>`).join('')}
      ${la.lines.length > 8 ? `<tr><td colspan="4" class="muted">+ ${la.lines.length - 8} more</td></tr>` : ''}</tbody></table></div>` : '<div class="empty">No accepted orders yet.</div>'}
    </div></div>`;
}

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayName = (d) => (d === state.me.today ? 'Today' : d === addDays(state.me.today, 1) ? 'Tomorrow' : new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }));

// Daily Order landing: open (not yet accepted) orders + "Start new order".
async function BranchOrder(main) {
  const [srcs, open] = await Promise.all([sources(), GET('/api/orders?status=DRAFT,SUBMITTED')]);
  const openBySrc = new Map();
  open.slice().sort((x, y) => x.order_date.localeCompare(y.order_date)).forEach((o) => { if (!openBySrc.has(o.warehouse_id)) openBySrc.set(o.warehouse_id, o); });
  main.innerHTML = head('Daily Order', `${esc(state.me.branch_name)} · orders you can still change`,
    '<button class="btn primary lg" id="start">+ Start new order</button>') + `<div class="stack">
    ${open.length ? open.map((o) => `<div class="card"><div class="card-b row">
        ${srcTag(o.source_code, o.source_name)}
        <div class="grow"><b style="font-size:16px">${dayName(o.order_date)} · ${fmtDate(o.order_date)}</b>
          <div class="muted">${o.line_count} item${o.line_count === 1 ? '' : 's'} · ${n0(o.requested_total)} units ·
          ${o.status === 'DRAFT' ? '<b style="color:var(--warn)">Draft — not sent yet</b>' : 'Sent — waiting for approval. You can still change it.'}</div></div>
        ${badge(o.status)}
        <a class="btn primary lg" href="#/order/${o.id}">${o.status === 'DRAFT' ? 'Continue' : 'Edit order'}</a>
      </div></div>`).join('')
    : '<div class="card empty" style="padding:48px 16px"><p style="font-size:16px;margin:0 0 14px">No open orders.</p><button class="btn primary lg" id="start2">+ Start new order</button></div>'}
    <div class="note">Once the ${srcs.map((x) => esc(srcLabel(x.code, x.name).toLowerCase())).join(' or ')} accepts an order it moves to <a href="#/orders">My Orders</a> and can no longer be changed.
      You can have one open order per source at a time.</div></div>`;

  const start = async () => {
    const free = srcs.filter((x) => !openBySrc.has(x.id));
    if (!free.length) {
      await modal({ title: 'No new order possible right now', cancel: null, ok: 'OK',
        body: `<p>You already have an order waiting for approval from ${srcs.map((x) => `<b>${esc(srcLabel(x.code, x.name))}</b>`).join(' and ')}. Edit those orders instead, or wait until they are accepted.</p>` });
      return;
    }
    if (free.length === 1) {
      const busySrc = srcs.find((x) => openBySrc.has(x.id));
      if (busySrc) toast(`${srcLabel(busySrc.code, busySrc.name)} order is still waiting — starting a ${srcLabel(free[0].code, free[0].name).toLowerCase()} order`);
      location.hash = `#/order/new?source=${free[0].id}`;
      return;
    }
    const pickSrc = await chooseSource(srcs);
    if (pickSrc) location.hash = `#/order/new?source=${pickSrc}`;
  };
  $('#start', main).onclick = start;
  if ($('#start2', main)) $('#start2', main).onclick = start;
}

function chooseSource(srcs) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>Order from?</h3>
      <div class="mb"><div class="choose">${srcs.map((x) => `<button class="choice choice-${esc(x.code)}" data-src="${x.id}">
        <span class="choice-t">${esc(srcLabel(x.code, x.name))}</span>
        <span class="choice-s">${x.code === 'FAC' ? 'Chicken, meat, sauces, vegetables' : 'Frozen, dry, drinks, packaging, cleaning'}</span></button>`).join('')}</div></div>
      <div class="mf"><button class="btn" data-x>Cancel</button></div></div>`;
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') close(null); };
    bg.addEventListener('click', (e) => {
      const c = e.target.closest('[data-src]');
      if (c) close(Number(c.dataset.src));
      else if (e.target === bg || e.target.hasAttribute('data-x')) close(null);
    });
    document.addEventListener('keydown', key);
    document.body.appendChild(bg);
    $('[data-src]', bg).focus();
  });
}

// Order editor: #/order/new?source=ID  or  #/order/:id (draft / submitted)
async function OrderEditor(main, params, query) {
  const t = state.me.today, max = addDays(t, 7);
  const srcs = await sources();
  let o = null, src, date, free = [];
  if (params.id) {
    o = await GET('/api/orders/' + params.id);
    if (!['DRAFT', 'SUBMITTED'].includes(o.status)) { location.replace(`#/orders/${o.id}`); return; }
    src = srcs.find((x) => x.id === o.warehouse_id);
    date = o.order_date;
  } else {
    const info = await GET('/api/branch/new-order?source=' + encodeURIComponent(query.source || ''));
    src = info.source;
    if (info.open_order) {
      toast(`You already have an open ${srcLabel(src.code, src.name).toLowerCase()} order — opening it`);
      location.replace(`#/order/${info.open_order.id}`);
      return;
    }
    if (!info.suggested_date) {
      main.innerHTML = head('Start new order') + '<div class="note warn">Every date in the next 7 days already has an order from this source.</div>';
      return;
    }
    free = info.free_dates;
    date = info.suggested_date;
  }
  const list = await items(src.id);
  const srcName = srcLabel(src.code, src.name);
  const submitted = o?.status === 'SUBMITTED';
  const q = new Map((o?.lines || []).map((l) => [l.item_id, l.requested_quantity]));
  const groups = categoriesOf(list).map((c) => [c, list.filter((i) => i.category === c)]);
  const dateCtl = o
    ? `<div class="summary"><div><div class="k">Order date</div><div class="v">${dayName(date)} · ${fmtDate(date)}</div></div><div><div class="k">Status</div><div class="v">${badge(o.status)}</div></div></div>`
    : `<label class="f">Order date<select class="input" id="odate" style="min-width:220px">${free.map((d) => `<option value="${d}">${dayName(d)} · ${fmtDate(d)}</option>`).join('')}</select></label>`;

  main.innerHTML = head(`${srcTag(src.code, src.name)} ${submitted ? 'Edit order' : 'New order'} — ${esc(srcName)}`, `${esc(state.me.branch_name)}`,
    '<a class="btn" href="#/order">Back</a>') + `<div class="stack">
    <div class="card card-b">${dateCtl}</div>
    ${submitted ? `<div class="note">This order is already with the ${esc(srcName.toLowerCase())} and waiting for approval. Your changes replace the current quantities.</div>` : ''}
    <div class="card"><div class="card-h no-print"><input class="input grow" id="search" placeholder="Search item or code… / بحث" style="min-width:180px">
      <label class="row" style="gap:6px;font-weight:600"><input type="checkbox" id="only"> Only items I entered</label></div>
    <div class="order-list">${groups.map(([c, arr]) => `<div class="grp"><div class="cat"><span>${esc(c)}</span></div>
      ${arr.map((i) => `<div class="irow" data-id="${i.id}" data-s="${esc((i.item_code + ' ' + i.item_name + ' ' + (i.item_name_ar || '')).toLowerCase())}">
        <div><div class="iname">${esc(i.item_name)} <span class="code">${esc(i.item_code)}</span></div><div class="ar">${esc(i.item_name_ar || '')}</div></div>
        <div class="stepper"><button type="button" data-d="-1" aria-label="Less">−</button>
        <input class="qty" inputmode="numeric" pattern="[0-9]*" value="${q.get(i.id) || ''}" placeholder="0" aria-label="${esc(i.item_name)} quantity">
        <button type="button" data-d="1" aria-label="More">+</button></div></div>`).join('')}</div>`).join('')}
    </div></div></div>
    <div class="actionbar"><div class="grow" id="sum"></div>
      ${submitted ? '<button class="btn primary lg" id="submit">Save changes</button>'
    : '<button class="btn lg" id="save">Save draft</button><button class="btn primary lg" id="submit">Submit order</button>'}</div>`;

  const read = () => {
    const lines = [];
    let bad = 0;
    for (const r of $$('.irow', main)) {
      const inp = $('.qty', r);
      const s = inp.value.trim();
      const v = s === '' ? 0 : Number(s);
      const ok = Number.isInteger(v) && v >= 0;
      inp.classList.toggle('err', !ok);
      inp.classList.toggle('has', ok && v > 0);
      r.classList.toggle('has', ok && v > 0);
      if (!ok) bad++; else if (v > 0) lines.push({ item_id: Number(r.dataset.id), quantity: v });
    }
    $('#sum', main).innerHTML = bad ? '<span class="note bad">Fix invalid quantities (whole numbers only)</span>'
      : `<b>${lines.length}</b> item${lines.length === 1 ? '' : 's'} · <b>${lines.reduce((a, l) => a + l.quantity, 0)}</b> units`;
    $('#submit', main).disabled = !!bad || !lines.length;
    if ($('#save', main)) $('#save', main).disabled = !!bad;
    return lines;
  };
  const filter = () => {
    const s = $('#search', main).value.trim().toLowerCase();
    const only = $('#only', main).checked;
    for (const r of $$('.irow', main)) r.hidden = (s && !r.dataset.s.includes(s)) || (only && !r.classList.contains('has'));
    for (const g of $$('.grp', main)) g.hidden = !$$('.irow', g).some((r) => !r.hidden);
  };
  main.addEventListener('input', (e) => { if (e.target.matches('.qty')) { state.dirty = true; read(); } if (e.target.id === 'search') filter(); });
  $('#only', main).onchange = filter;
  main.addEventListener('click', async (e) => {
    const d = e.target.dataset.d;
    if (d) {
      const inp = $('.qty', e.target.closest('.stepper'));
      inp.value = Math.max(0, (Number(inp.value) || 0) + Number(d)) || '';
      state.dirty = true; read();
      return;
    }
    if (e.target.id !== 'save' && e.target.id !== 'submit') return;
    const submit = e.target.id === 'submit';
    const lines = read();
    const chosenDate = o ? date : $('#odate', main).value;
    if (submit) {
      const ok = await modal({ title: submitted ? 'Save changes to this order?' : `Submit order to the ${srcName.toLowerCase()}?`, ok: submitted ? 'Save changes' : 'Submit order',
        body: `<p>${fmtDate(chosenDate)} · You can still change it until the ${esc(srcName.toLowerCase())} accepts it.</p><table class="t"><thead><tr><th>Item</th><th class="num">Qty</th></tr></thead><tbody>
        ${lines.map((l) => { const it = list.find((i) => i.id === l.item_id); return `<tr><td>${esc(it.item_name)} <span class="ar">${esc(it.item_name_ar || '')}</span></td><td class="num"><b>${l.quantity}</b></td></tr>`; }).join('')}</tbody></table>` });
      if (!ok) return;
    }
    await busy(e.target, async () => {
      const body = { submit, lines };
      if (o) body.order_id = o.id; else Object.assign(body, { date: chosenDate, source: src.id });
      const saved = await api('PUT', '/api/branch/order', body);
      state.dirty = false;
      if (submit) {
        toast(submitted ? 'Changes saved' : `Order submitted to the ${srcName.toLowerCase()}`);
        location.hash = '#/order';
      } else {
        toast('Draft saved — not sent yet');
        if (!o) location.replace(`#/order/${saved.id}`);
      }
    });
  });
  read();
}

async function BranchOrders(main) {
  const rows = await GET('/api/orders');
  main.innerHTML = head('My Orders', 'Requested, accepted and received quantities') + `<div class="card"><div class="tbl-wrap"><table class="t">
    <thead><tr><th>Date</th><th>From</th><th>Status</th><th class="num">Items</th><th class="num">Requested</th><th class="num">Accepted</th><th class="num">Received</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="click" data-href="#/orders/${r.id}"><td><b>${fmtDate(r.order_date)}</b></td><td>${srcTag(r.source_code, r.source_name)}</td><td>${badge(r.status, r.discrepancies)}</td>
      <td class="num">${r.line_count}</td><td class="num">${n0(r.requested_total)}</td><td class="num">${n0(r.accepted_total)}</td>
      <td class="num">${r.status === 'RECEIVED' ? n0(r.received_total) : '—'}</td>
      <td>${r.status === 'DISPATCHED' ? `<a class="btn sm primary" href="#/receive/${r.id}">Receive</a>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">No orders yet.</td></tr>'}</tbody></table></div></div>`;
  clickRows(main);
}

async function BranchReceivingList(main) {
  const rows = await GET('/api/orders?status=DISPATCHED');
  if (rows.length === 1) { location.replace(`#/receive/${rows[0].id}`); return; }
  const recent = await GET('/api/orders?status=RECEIVED');
  main.innerHTML = head('Receiving', 'Confirm what actually arrived') + `<div class="stack">
    <div class="card"><div class="card-h"><h2>On the way</h2></div>${rows.length ? `<div class="tbl-wrap"><table class="t"><tbody>
      ${rows.map((r) => `<tr><td><b>${fmtDate(r.order_date)}</b></td><td>${srcTag(r.source_code, r.source_name)}</td><td>${esc(r.driver_name || '')}</td><td class="num">${n0(r.accepted_total)} units</td><td class="num"><a class="btn primary" href="#/receive/${r.id}">Receive</a></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Nothing to receive right now.</div>'}</div>
    <div class="card"><div class="card-h"><h2>Recently received</h2></div><div class="tbl-wrap"><table class="t"><tbody>
      ${recent.slice(0, 10).map((r) => `<tr class="click" data-href="#/orders/${r.id}"><td><b>${fmtDate(r.order_date)}</b></td><td>${srcTag(r.source_code, r.source_name)}</td><td class="num">Accepted ${n0(r.accepted_total)}</td><td class="num">Received ${n0(r.received_total)}</td><td>${badge(r.status, r.discrepancies)}</td></tr>`).join('') || '<tr><td class="empty">None yet.</td></tr>'}
    </tbody></table></div></div></div>`;
  clickRows(main);
}

async function BranchReceive(main, { id }) {
  const o = await GET(`/api/orders/${id}`);
  if (o.status !== 'DISPATCHED') { location.replace(`#/orders/${id}`); return; }
  const lines = o.lines.filter((l) => l.accepted_quantity > 0);
  main.innerHTML = head(`Receive ${esc(srcLabel(o.source_code, o.source_name).toLowerCase())} delivery — ${fmtDate(o.order_date)}`, `${o.driver_name ? 'Driver: ' + esc(o.driver_name) + ' · ' : ''}Enter what you physically received`) + `
    <div class="note" style="margin-bottom:14px">Received quantities are pre-filled with what the warehouse sent. Change only what's different.</div>
    <div class="card"><div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Sent</th><th class="num">Received</th><th class="num">Diff</th></tr></thead>
    <tbody>${lines.map((l) => `<tr data-id="${l.item_id}" data-acc="${l.accepted_quantity}"><td>${itemCell(l)}<span class="code">${esc(l.item_code)}</span></td>
      <td class="num"><b>${l.accepted_quantity}</b></td>
      <td class="num"><input class="qty" inputmode="numeric" pattern="[0-9]*" value="${l.accepted_quantity}" aria-label="Received ${esc(l.item_name)}"></td>
      <td class="num diff">—</td></tr>`).join('')}</tbody></table></div>
      <div class="card-b"><label class="f">Note (optional)<textarea class="input" id="notes" rows="2" placeholder="e.g. 1 oil carton damaged"></textarea></label></div></div>
    <div class="actionbar"><div class="grow" id="sum"></div><button class="btn primary lg" id="confirm">Confirm receiving</button></div>`;
  const read = () => {
    let bad = 0; const diffs = []; const out = [];
    for (const tr of $$('tbody tr', main)) {
      const inp = $('.qty', tr);
      const s = inp.value.trim();
      const v = s === '' ? NaN : Number(s);
      const ok = Number.isInteger(v) && v >= 0;
      const acc = Number(tr.dataset.acc);
      const d = ok ? v - acc : 0;
      inp.classList.toggle('err', !ok);
      tr.classList.toggle('flag', ok && d !== 0);
      $('.diff', tr).textContent = !ok ? '?' : d ? (d > 0 ? '+' : '') + d : '—';
      $('.diff', tr).className = 'num diff ' + (d < 0 ? 'neg' : d > 0 ? 'pos' : '');
      if (!ok) bad++;
      if (ok && d) diffs.push({ name: lines.find((l) => l.item_id === Number(tr.dataset.id)).item_name, acc, v });
      out.push({ item_id: Number(tr.dataset.id), received_quantity: v });
    }
    $('#sum', main).innerHTML = bad ? '<span class="note bad">Enter a whole number for every item</span>' : diffs.length ? `<span class="note warn">${diffs.length} difference${diffs.length > 1 ? 's' : ''}</span>` : '<span class="note ok">Everything matches</span>';
    $('#confirm', main).disabled = !!bad;
    return { out, diffs };
  };
  main.addEventListener('input', (e) => { if (e.target.matches('.qty')) { state.dirty = true; read(); } });
  $('#confirm', main).onclick = async (e) => {
    const { out, diffs } = read();
    const ok = await modal({ title: 'Confirm receiving?', ok: 'Confirm',
      body: diffs.length ? `<p>These differences will be reported to the warehouse:</p><ul>${diffs.map((d) => `<li><b>${esc(d.name)}</b>: sent ${d.acc}, received ${d.v}</li>`).join('')}</ul>` : '<p>All items received as sent.</p>' });
    if (!ok) return;
    await busy(e.target, async () => {
      await api('POST', `/api/branch/orders/${o.id}/receive`, { lines: out, notes: $('#notes', main).value });
      state.dirty = false;
      toast(diffs.length ? `Receiving confirmed — ${diffs.length} difference${diffs.length > 1 ? 's' : ''} reported to the warehouse` : 'Receiving confirmed');
      location.hash = `#/orders/${o.id}`;
    });
  };
  read();
}

// ───────────────────────── MANAGER ─────────────────────────
const alertBadge = (k) => ({ OUT: '<span class="badge b-DIFF">Out of stock</span>', REORDER: '<span class="badge b-REORDER">Reorder</span>',
  SHORT: '<span class="badge b-ACCEPTED">Requests exceed stock</span>' })[k] || '';

async function ManagerHome(main) {
  const h = await GET('/api/manager/home');
  const c = h.counts;
  const tile = (v, l, href, hot) => `<a class="card tile ${hot && v ? 'hot' : ''}" href="${href}"><div class="v">${v}</div><div class="l">${l}</div></a>`;
  main.innerHTML = head(esc(srcLabel(h.source.code, h.source.name)), `Today · ${fmtDate(h.today)}`, '<a class="btn primary" href="#/orders?status=SUBMITTED">Review orders</a>') + `<div class="stack">
    <div class="tiles">
      ${tile(c.submitted_today, "Today's submitted orders", `#/orders?date=${h.today}`)}
      ${tile(c.waiting_approval, 'Waiting for approval', '#/orders?status=SUBMITTED', true)}
      ${tile(c.accepted_today, 'Accepted today', `#/orders?date=${h.today}&status=ACCEPTED,ASSIGNED,DISPATCHED,RECEIVED`)}
      ${tile(c.waiting_assignment, 'Need a driver', '#/picking', true)}
      ${tile(c.waiting_dispatch, 'Waiting for dispatch', '#/picking', true)}
      ${tile(c.waiting_receiving, 'Waiting for branch receiving', '#/orders?status=DISPATCHED')}
      ${tile(c.receiving_differences, 'Received with differences (14 days)', '#/orders?status=RECEIVED&diff=1', true)}
      ${tile(c.branches_not_submitted, 'Branches not ordered today', `#/orders?date=${h.today}`)}
      ${tile(c.to_reorder, 'Items to reorder', '#/inventory?filter=reorder', true)}
    </div>
    <div class="grid2">
      <div class="card"><div class="card-h"><h2>Stock alerts</h2><a class="btn sm" href="#/inventory">Set reorder levels</a></div>
        ${h.alerts.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th>Alert</th><th class="num">Stock</th><th class="num">Reorder at</th><th class="num">Waiting requests</th></tr></thead><tbody>
        ${h.alerts.map((a) => `<tr class="click" data-href="#/inventory/${a.item_id}"><td><span class="code">${esc(a.item_code)}</span> ${esc(a.item_name)}</td><td>${alertBadge(a.kind)}</td>
          <td class="num ${a.stock <= 0 ? 'neg' : ''}"><b>${n0(a.stock)}</b></td><td class="num">${a.reorder_level ?? '—'}</td><td class="num">${a.pending_requested ? n0(a.pending_requested) : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No alerts. Set a reorder level on items in Inventory to be warned before they run out.</div>'}</div>
      <div class="card"><div class="card-h"><h2>Receiving differences</h2><span class="muted">Last 14 days</span></div>
        ${h.discrepancies.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Branch</th><th>Item</th><th class="num">Sent</th><th class="num">Received</th></tr></thead><tbody>
        ${h.discrepancies.map((d) => `<tr class="click" data-href="#/orders/${d.id}"><td>${fmtDate(d.order_date)}</td><td>${esc(d.branch_name)}</td><td>${esc(d.item_name)}</td><td class="num">${d.accepted_quantity}</td><td class="num neg">${d.received_quantity}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No differences reported.</div>'}</div>
    </div></div>`;
  clickRows(main);
}

async function ManagerOrders(main, _p, query) {
  const f = { date: query.date ?? (query.status ? 'all' : state.me.today), branch_id: query.branch_id || '', status: query.status || '', diff: query.diff || '' };
  const apiF = { ...f, date: f.date === 'all' ? '' : f.date };
  const [rows, branches] = await Promise.all([GET('/api/orders?' + qs(apiF)), GET('/api/branches')]);
  const statuses = [['', 'All statuses'], ['SUBMITTED', 'Submitted'], ['ACCEPTED', 'Accepted'], ['ASSIGNED', 'Assigned'], ['DISPATCHED', 'Dispatched'], ['RECEIVED', 'Received'], ['REJECTED', 'Rejected'], ['ACCEPTED,ASSIGNED,DISPATCHED,RECEIVED', 'All accepted'], ['RECEIVED|diff', 'Received with differences']];
  const missing = apiF.date && !f.branch_id && (!f.status) ? branches.filter((b) => !rows.some((r) => r.branch_id === b.id)) : [];
  main.innerHTML = head('Daily Orders', 'Review, adjust and accept branch orders') + `<div class="stack">
    <div class="card card-b filters no-print">
      <label class="f">Date<input class="input" type="date" id="f-date" value="${esc(apiF.date)}"></label>
      <label class="f">Branch<select class="input" id="f-branch"><option value="">All branches</option>${branches.map((b) => `<option value="${b.id}" ${String(b.id) === f.branch_id ? 'selected' : ''}>${esc(b.branch_name)}</option>`).join('')}</select></label>
      <label class="f">Status<select class="input" id="f-status">${statuses.map(([v, l]) => `<option value="${v}" ${v === (f.diff ? f.status + '|diff' : f.status) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn" id="f-any">Any date</button>
    </div>
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Branch</th><th>Date</th><th>Status</th><th class="num">Lines</th><th class="num">Requested</th><th class="num">Accepted</th><th class="num">Received</th><th>Driver</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="click" data-href="#/orders/${r.id}"><td><b>${esc(r.branch_name)}</b> <span class="code">${esc(r.branch_code)}</span></td>
        <td>${fmtDate(r.order_date)}</td><td>${badge(r.status, r.discrepancies)}</td><td class="num">${r.line_count}</td><td class="num">${n0(r.requested_total)}</td>
        <td class="num">${r.accepted_at ? n0(r.accepted_total) : '—'}</td><td class="num">${r.status === 'RECEIVED' ? n0(r.received_total) : '—'}</td>
        <td>${esc(r.driver_name || '')}</td><td>${r.status === 'SUBMITTED' ? '<span class="btn sm primary">Review</span>' : ''}</td></tr>`).join('')
        || '<tr><td colspan="9" class="empty">No orders match these filters.</td></tr>'}</tbody></table></div></div>
    ${missing.length ? `<div class="card card-b"><b>Not submitted for ${fmtDate(f.date)}:</b> <span class="muted">${missing.map((b) => esc(b.branch_name)).join(' · ')}</span></div>` : ''}
    </div>`;
  const go = (o) => { location.hash = '#/orders?' + qs({ ...f, ...o }); };
  $('#f-date', main).onchange = (e) => go({ date: e.target.value || 'all' });
  $('#f-branch', main).onchange = (e) => go({ branch_id: e.target.value });
  $('#f-status', main).onchange = (e) => { const [st, d] = e.target.value.split('|'); go({ status: st, diff: d ? '1' : '' }); };
  $('#f-any', main).onclick = () => go({ date: 'all' });
  clickRows(main);
}

async function Picking(main, _p, query) {
  const date = query.date || state.me.today;
  const [p, drivers, branches] = await Promise.all([GET('/api/picking?date=' + date), GET('/api/drivers'), GET('/api/branches?routes=1')]);
  const active = drivers.filter((d) => d.active);
  const driverSel = (cur, id) => `<select class="mini-sel" data-assign="${id}"><option value="">— Unassigned —</option>${active.map((d) => `<option value="${d.id}" ${d.id === cur ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
  const locked = (o) => ['DISPATCHED', 'RECEIVED'].includes(o.status);
  const stop = (o) => `<div class="stop"><div class="stop-h">
      ${o.driver_id ? `<span class="seq">${o.sequence}</span>` : ''}<b>${esc(o.branch_name)}</b> ${badge(o.status, o.discrepancies)}<span class="grow"></span>
      ${locked(o) ? '' : `<span class="no-print row" style="gap:6px">${o.driver_id ? `<input class="mini-num" type="number" min="1" value="${o.sequence}" data-seq="${o.id}" title="Stop number">` : ''}${driverSel(o.driver_id, o.id)}</span>`}
      <a class="btn sm ghost no-print" href="#/orders/${o.id}">Open</a></div>
    <ul>${o.lines.map((l) => `<li><span><span class="code">${esc(l.item_code)}</span> ${esc(l.item_name)}</span><b>${l.quantity}</b></li>`).join('')}</ul></div>`;

  main.innerHTML = head('Drivers & Picking', `Accepted orders for ${fmtDate(date)} · Driver → Branch → Items`,
    `<input class="input" type="date" id="pdate" value="${date}"><button class="btn" id="defaults" ${p.unassigned.length ? '' : 'disabled'}>Apply default routes</button><button class="btn" id="print-all">Print all</button>`)
    + `<div class="stack">
    ${p.unassigned.length ? `<div class="card"><div class="card-h"><h2>Needs a driver (${p.unassigned.length})</h2><span class="muted">Pick a driver for each branch, or apply default routes</span></div>${p.unassigned.map(stop).join('')}</div>` : ''}
    <div class="board">${p.drivers.map((d) => {
      const ready = d.orders.filter((o) => o.status === 'ASSIGNED');
      return `<div class="card driver-card" data-driver="${d.id}"><div class="card-h"><div><h2>${esc(d.name)}</h2>
        <div class="muted">${d.orders.length} branch${d.orders.length === 1 ? '' : 'es'} · ${d.item_totals.reduce((s, i) => s + i.quantity, 0)} units · ${fmtDate(date)}</div></div>
        <div class="row no-print"><button class="btn sm" data-print="${d.id}" ${d.orders.length ? '' : 'disabled'}>Print sheet</button>
        <button class="btn sm dark" data-dispatch="${d.id}" ${ready.length ? '' : 'disabled'}>Dispatch${ready.length ? ` (${ready.length})` : ''}</button></div></div>
        ${d.item_totals.length ? `<details class="card-b" open><summary><b>Load list — total per item</b></summary><table class="t" style="margin-top:6px"><tbody>
          ${d.item_totals.map((i) => `<tr><td class="code">${esc(i.item_code)}</td><td>${esc(i.item_name)}</td><td class="num"><b>${i.quantity}</b></td></tr>`).join('')}</tbody></table></details>` : ''}
        ${d.orders.map(stop).join('') || '<div class="empty">No branches assigned.</div>'}
        <div class="print-only card-b">Picked by: ____________ &nbsp; Driver signature: ____________</div></div>`;
    }).join('')}</div>
    ${!p.unassigned.length && !p.drivers.some((d) => d.orders.length) ? '<div class="card empty">No accepted orders for this date yet. Accept orders in Daily Orders first.</div>' : ''}
    <details class="card no-print"><summary class="card-h" style="cursor:pointer"><h3>Default routes & drivers</h3></summary>
      <div class="card-b"><div class="row"><input class="input" id="new-driver" placeholder="New driver name"><button class="btn" id="add-driver">Add driver</button></div></div>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>Branch</th><th>Default driver</th><th>Stop #</th></tr></thead><tbody>
      ${branches.map((b) => `<tr data-branch="${b.id}"><td><b>${esc(b.branch_name)}</b> <span class="code">${esc(b.branch_code)}</span></td>
        <td><select class="mini-sel rt-driver"><option value="">— None —</option>${active.map((d) => `<option value="${d.id}" ${d.id === b.default_driver_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></td>
        <td><input class="mini-num rt-seq" type="number" min="1" value="${b.default_sequence ?? ''}"></td></tr>`).join('')}
      </tbody></table></div></details></div>`;

  const reload = () => Picking(main, {}, { date });
  $('#pdate', main).onchange = (e) => { location.hash = '#/picking?date=' + e.target.value; };
  main.onchange = async (e) => {
    const t = e.target;
    if (t.dataset.assign) {
      const cur = p.unassigned.concat(...p.drivers.map((d) => d.orders)).find((o) => o.id === Number(t.dataset.assign));
      const nextSeq = t.value ? (p.drivers.find((d) => d.id === Number(t.value))?.orders.length || 0) + 1 : null;
      await busy(t, async () => { await api('POST', `/api/orders/${t.dataset.assign}/assign`, { driver_id: t.value || null, sequence: nextSeq }); toast(t.value ? `${cur.branch_name} assigned` : `${cur.branch_name} unassigned`); await reload(); });
    }
    if (t.dataset.seq) {
      const o = p.drivers.flatMap((d) => d.orders).find((x) => x.id === Number(t.dataset.seq));
      await busy(t, async () => { await api('POST', `/api/orders/${o.id}/assign`, { driver_id: o.driver_id, sequence: t.value }); await reload(); });
    }
    if (t.matches('.rt-driver, .rt-seq')) {
      const tr = t.closest('tr');
      await busy(t, async () => { await api('PUT', `/api/branches/${tr.dataset.branch}/route`, { driver_id: $('.rt-driver', tr).value || null, sequence: $('.rt-seq', tr).value || null }); toast('Default route saved'); });
    }
  };
  main.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'defaults') await busy(t, async () => { const r = await api('POST', '/api/picking/apply-defaults', { date }); toast(`${r.assigned} order${r.assigned === 1 ? '' : 's'} assigned`); await reload(); });
    if (t.id === 'print-all') { document.body.classList.remove('print-one'); window.print(); }
    if (t.dataset.print) {
      $$('.driver-card', main).forEach((c) => c.classList.toggle('print-me', c.dataset.driver === t.dataset.print));
      document.body.classList.add('print-one'); window.print(); document.body.classList.remove('print-one');
    }
    if (t.dataset.dispatch) {
      const d = p.drivers.find((x) => x.id === Number(t.dataset.dispatch));
      const ids = d.orders.filter((o) => o.status === 'ASSIGNED').map((o) => o.id);
      const ok = await modal({ title: `Dispatch ${d.name}?`, body: `<p>${ids.length} order${ids.length > 1 ? 's' : ''} will be marked as dispatched. Accepted quantities are locked after dispatch.</p>`, ok: 'Dispatch', okClass: 'dark' });
      if (ok) await busy(t, async () => { await api('POST', '/api/dispatch', { order_ids: ids }); toast(`${d.name} dispatched`); await reload(); });
    }
    if (t.id === 'add-driver') {
      const name = $('#new-driver', main).value.trim();
      if (!name) return;
      await busy(t, async () => { await api('POST', '/api/drivers', { name }); toast('Driver added'); await reload(); });
    }
  };
}

function itemPicker(list) {
  return `<datalist id="items-dl">${list.map((i) => `<option value="${esc(i.item_code)} · ${esc(i.item_name)}">${esc(i.item_name_ar || '')}</option>`).join('')}</datalist>`;
}
const findItem = (list, s) => {
  const code = String(s || '').trim().split(/[\s·]/)[0].toUpperCase();
  return list.find((i) => i.item_code === code) || list.find((i) => i.item_name.toLowerCase() === String(s).trim().toLowerCase());
};

async function SupplierReceiving(main) {
  const [list, suppliers, recent] = await Promise.all([items(), GET('/api/suppliers'), GET('/api/supplier-receipts')]);
  main.innerHTML = head(isFactoryMgr() ? 'Purchases' : 'Supplier Receiving', isFactoryMgr() ? 'Record raw chicken and other goods bought — stock increases on confirm' : 'Record goods received — stock increases on confirm') + `<div class="stack">
    <div class="card"><div class="card-b filters">
      <label class="f grow">Supplier<input class="input" id="sup" list="sup-dl" placeholder="e.g. ABC Food" autocomplete="off"></label>
      <datalist id="sup-dl">${suppliers.map((s) => `<option value="${esc(s.supplier_name)}">`).join('')}</datalist>
      <label class="f">Date received<input class="input" type="date" id="rdate" value="${state.me.today}"></label>
      <label class="f">Supplier invoice no.<input class="input" id="rinv" placeholder="If you have it"></label>
    </div>
    ${itemPicker(list)}
    <div class="tbl-wrap"><table class="t"><thead><tr><th style="width:50%">Item</th><th class="num">Quantity received</th><th class="num">Unit price SAR <span class="muted">(optional)</span></th><th></th></tr></thead><tbody id="rl"></tbody></table></div>
    <div class="card-b row"><button class="btn" id="addl">+ Add line</button><span class="grow"></span>
      <label class="f grow">Note (optional)<input class="input" id="rnote" placeholder="Delivery note number, remarks"></label></div></div>
    <div class="actionbar"><div class="grow" id="rsum"></div><button class="btn primary lg" id="rsave">Confirm receipt</button></div>
    <div class="card"><div class="card-h"><h2>Recent receipts</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th class="num">Amount SAR</th><th>By</th></tr></thead><tbody>
      ${recent.map((r) => { const priced = r.lines.every((l) => l.unit_cost_h != null); return `<tr><td>${fmtDate(r.received_date)}</td><td><b>${esc(r.supplier_name)}</b>${r.invoice_no ? `<div>Invoice ${esc(r.invoice_no)}</div>` : ''}${r.notes ? `<div class="muted">${esc(r.notes)}</div>` : ''}</td>
        <td>${r.lines.map((l) => `<div><span class="code">${esc(l.item_code)}</span> ${esc(l.item_name)} — <b>${l.quantity}</b>${l.unit_cost_h != null ? ` <span class="muted">× ${(l.unit_cost_h / 100).toFixed(2)}</span>` : ''}</div>`).join('')}</td>
        <td class="num">${priced ? (r.lines.reduce((a, l) => a + l.quantity * l.unit_cost_h, 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '<span class="muted">—</span>'}</td><td class="muted">${esc(r.received_by_name)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No receipts yet.</td></tr>'}
      </tbody></table></div></div></div>`;
  const addLine = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="input it" list="items-dl" placeholder="Type code or name…" style="width:100%"><div class="muted it-ok"></div></td>
      <td class="num"><input class="qty" inputmode="numeric" pattern="[0-9]*" placeholder="0"></td><td class="num"><input class="money price" inputmode="decimal" placeholder="0.00"></td><td><button class="btn sm ghost rm">Remove</button></td>`;
    $('#rl', main).appendChild(tr);
    $('.it', tr).focus();
  };
  const read = () => {
    const lines = []; let bad = 0;
    for (const tr of $$('#rl tr', main)) {
      const it = findItem(list, $('.it', tr).value);
      const qv = $('.qty', tr).value.trim();
      const q = Number(qv);
      const pv = $('.price', tr).value.trim().replace(/,/g, '');
      const priceOk = !pv || /^\d+(\.\d{1,2})?$/.test(pv);
      $('.price', tr).classList.toggle('err', !priceOk);
      const empty = !$('.it', tr).value.trim() && !qv && !pv;
      $('.it-ok', tr).innerHTML = it ? `<span class="ar">${esc(it.item_name_ar || '')}</span>` : ($('.it', tr).value.trim() ? '<span class="neg">Unknown item — pick from the list</span>' : '');
      const ok = empty || (it && Number.isInteger(q) && q > 0 && priceOk);
      $('.qty', tr).classList.toggle('err', !empty && !(Number.isInteger(q) && q > 0) && qv !== '');
      if (!ok) bad++; else if (!empty) lines.push({ item: it, item_id: it.id, quantity: q, unit_price: pv || null });
    }
    const supOk = $('#sup', main).value.trim();
    $('#rsum', main).innerHTML = bad ? '<span class="note bad">Complete or remove incomplete lines</span>' : `<b>${lines.length}</b> line${lines.length === 1 ? '' : 's'} · <b>${lines.reduce((s, l) => s + l.quantity, 0)}</b> units`;
    $('#rsave', main).disabled = !!bad || !lines.length || !supOk;
    return lines;
  };
  addLine();
  $('#addl', main).onclick = addLine;
  main.addEventListener('input', () => { state.dirty = true; read(); });
  main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('#rl .qty')) { e.preventDefault(); addLine(); } });
  main.addEventListener('click', (e) => { if (e.target.matches('.rm')) { e.target.closest('tr').remove(); read(); } });
  $('#rsave', main).onclick = async (e) => {
    const lines = read();
    const sup = $('#sup', main).value.trim();
    const ok = await modal({ title: `Confirm ${isFactoryMgr() ? 'purchase' : 'receipt'} from ${sup}?`, ok: 'Confirm & add to stock',
      body: `<table class="t"><tbody>${lines.map((l) => `<tr><td class="code">${esc(l.item.item_code)}</td><td>${esc(l.item.item_name)}</td><td class="num pos">+${l.quantity}</td><td class="num muted">${l.unit_price ? '× ' + esc(l.unit_price) : ''}</td></tr>`).join('')}</tbody></table>` });
    if (!ok) return;
    await busy(e.target, async () => {
      await api('POST', '/api/supplier-receipts', { supplier_name: sup, date: $('#rdate', main).value, notes: $('#rnote', main).value, invoice_no: $('#rinv', main).value, lines: lines.map(({ item_id, quantity, unit_price }) => ({ item_id, quantity, unit_price })) });
      state.dirty = false; toast('Receipt recorded — stock increased'); router();
    });
  };
  read();
}

async function Production(main) {
  if (!isFactoryMgr()) { location.replace('#/home'); return; }
  const [list, recent] = await Promise.all([items(), GET('/api/production')]);
  const raw = list.filter((i) => !i.orderable);
  main.innerHTML = head('Production', 'Record raw chicken used and the cuts produced — stock updates on confirm') + `<div class="stack">
    ${itemPicker(list)}
    <div class="card"><div class="card-b filters">
      <label class="f">Production date<input class="input" type="date" id="pdate" value="${state.me.today}"></label>
      <label class="f grow">Note (optional)<input class="input" id="pnote" placeholder="e.g. Morning cut — batch 1"></label></div></div>
    <div class="grid2">
      <div class="card"><div class="card-h"><h2>Used <span class="muted">(stock goes down)</span></h2></div>
        <div class="tbl-wrap"><table class="t"><thead><tr><th style="width:65%">Item</th><th class="num">Qty</th><th></th></tr></thead><tbody id="in"></tbody></table></div>
        <div class="card-b"><button class="btn" data-add="in">+ Add item used</button></div></div>
      <div class="card"><div class="card-h"><h2>Produced <span class="muted">(stock goes up)</span></h2></div>
        <div class="tbl-wrap"><table class="t"><thead><tr><th style="width:65%">Item</th><th class="num">Qty</th><th></th></tr></thead><tbody id="out"></tbody></table></div>
        <div class="card-b"><button class="btn" data-add="out">+ Add item produced</button></div></div>
    </div>
    <div class="actionbar"><div class="grow" id="psum"></div><button class="btn primary lg" id="psave">Confirm production</button></div>
    <div class="card"><div class="card-h"><h2>Recent production</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Date</th><th>#</th><th>Used</th><th>Produced</th><th>Note</th><th>By</th></tr></thead><tbody>
      ${recent.map((b) => `<tr><td>${fmtDate(b.production_date)}</td><td>${b.id}</td>
        <td>${b.lines.filter((l) => l.direction < 0).map((l) => `<div>${esc(l.item_name)} <b class="neg">−${l.quantity}</b></div>`).join('') || '—'}</td>
        <td>${b.lines.filter((l) => l.direction > 0).map((l) => `<div>${esc(l.item_name)} <b class="pos">+${l.quantity}</b></div>`).join('')}</td>
        <td class="muted">${esc(b.notes || '')}</td><td class="muted">${esc(b.created_by_name)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No production recorded yet.</td></tr>'}
      </tbody></table></div></div></div>`;
  const addLine = (where, preset) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="input it" list="items-dl" placeholder="Type code or name…" style="width:100%" value="${preset ? esc(preset.item_code + ' · ' + preset.item_name) : ''}"><div class="muted it-ok"></div></td>
      <td class="num"><input class="qty" inputmode="numeric" pattern="[0-9]*" placeholder="0"></td><td><button class="btn sm ghost rm">Remove</button></td>`;
    $('#' + where, main).appendChild(tr);
    return tr;
  };
  const readSide = (where) => {
    const lines = []; let bad = 0;
    for (const tr of $$(`#${where} tr`, main)) {
      const txt = $('.it', tr).value.trim();
      const it = findItem(list, txt);
      const qv = $('.qty', tr).value.trim();
      const q = Number(qv);
      const empty = !txt && !qv;
      $('.it-ok', tr).innerHTML = it ? `<span class="ar">${esc(it.item_name_ar || '')}</span>` : (txt ? '<span class="neg">Unknown item — pick from the list</span>' : '');
      const qtyBad = qv !== '' && !(Number.isInteger(q) && q > 0);
      $('.qty', tr).classList.toggle('err', qtyBad);
      if ((txt && !it) || qtyBad || (!txt && qv !== '')) bad++;
      else if (it && qv !== '') lines.push({ item: it, item_id: it.id, quantity: q }); // item with blank qty = ignored
    }
    return { lines, bad };
  };
  const read = () => {
    const i = readSide('in'), o = readSide('out');
    const bad = i.bad + o.bad;
    $('#psum', main).innerHTML = bad ? '<span class="note bad">Complete or remove incomplete lines</span>'
      : `Used <b>${i.lines.reduce((a, l) => a + l.quantity, 0)}</b> · Produced <b>${o.lines.reduce((a, l) => a + l.quantity, 0)}</b> across ${o.lines.length} item${o.lines.length === 1 ? '' : 's'}`;
    $('#psave', main).disabled = !!bad || !o.lines.length;
    return { i, o };
  };
  raw.forEach((r) => addLine('in', r));
  addLine('out');
  main.addEventListener('input', () => { state.dirty = true; read(); });
  main.addEventListener('click', (e) => {
    if (e.target.matches('.rm')) { e.target.closest('tr').remove(); read(); }
    if (e.target.dataset.add) { $('.it', addLine(e.target.dataset.add)).focus(); read(); }
  });
  main.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('#out .qty')) { e.preventDefault(); $('.it', addLine('out')).focus(); } });
  $('#psave', main).onclick = async (e) => {
    const { i, o } = read();
    const row = (l, sign) => `<tr><td class="code">${esc(l.item.item_code)}</td><td>${esc(l.item.item_name)}</td><td class="num ${sign < 0 ? 'neg' : 'pos'}">${sign < 0 ? '−' : '+'}${l.quantity}</td></tr>`;
    const ok = await modal({ title: 'Confirm production?', ok: 'Confirm & update stock',
      body: `<table class="t"><tbody>${i.lines.map((l) => row(l, -1)).join('')}${o.lines.map((l) => row(l, 1)).join('')}</tbody></table>${i.lines.length ? '' : '<p class="note warn" style="margin-top:10px">No raw material entered as used — only the produced items will be added.</p>'}` });
    if (!ok) return;
    await busy(e.target, async () => {
      await api('POST', '/api/production', { date: $('#pdate', main).value, notes: $('#pnote', main).value,
        inputs: i.lines.map(({ item_id, quantity }) => ({ item_id, quantity })), outputs: o.lines.map(({ item_id, quantity }) => ({ item_id, quantity })) });
      state.dirty = false; toast('Production recorded — stock updated'); router();
    });
  };
  read();
}

async function Inventory(main, _p, query) {
  const rows = await GET('/api/inventory');
  const nReorder = rows.filter((r) => r.needs_reorder).length;
  const status = (r) => (r.stock <= 0 && (r.last_movement || r.reorder_level !== null) ? alertBadge('OUT') : r.needs_reorder ? alertBadge('REORDER') : '');
  main.innerHTML = head('Inventory', 'Calculated from transactions — click an item to see why. Set “Reorder at” to be alerted before an item runs out.',
    `<a class="btn" href="#/count">Stock count</a><a class="btn" href="#/supplier">${isFactoryMgr() ? 'Purchases' : 'Receive goods'}</a>`) + `
    <div class="card"><div class="card-h no-print"><input class="input grow" id="s" placeholder="Search code or name…" value="${esc(query.q || '')}">
      <select class="input" id="cat"><option value="">All categories</option>${categoriesOf(rows).map((c) => `<option ${c === query.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="row" style="gap:6px;font-weight:600"><input type="checkbox" id="only" ${query.filter === 'reorder' ? 'checked' : ''}> Only items to reorder <span class="badge ${nReorder ? 'b-REORDER' : ''}" id="nre">${nReorder}</span></label></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Code</th><th>Item</th><th>Category</th><th class="num">Current stock</th><th class="num">Reorder at</th><th>Status</th><th>Last movement</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="click ${r.needs_reorder || r.stock < 0 ? 'warnrow' : ''}" data-id="${r.id}" data-stock="${r.stock}" data-href="#/inventory/${r.id}" data-cat="${esc(r.category)}" data-s="${esc((r.item_code + ' ' + r.item_name + ' ' + (r.item_name_ar || '')).toLowerCase())}">
      <td class="code">${esc(r.item_code)}</td><td>${itemCell(r)}${r.orderable ? '' : '<span class="badge">Internal — not orderable</span>'}</td><td class="muted">${esc(r.category)}</td>
      <td class="num ${r.stock <= 0 ? 'neg' : ''}" style="font-size:15px"><b>${n0(r.stock)}</b> <span class="muted">${esc(r.unit)}</span></td>
      <td class="num"><input class="qty rl" inputmode="numeric" pattern="[0-9]*" value="${r.reorder_level ?? ''}" placeholder="—" aria-label="Reorder level for ${esc(r.item_name)}" style="width:72px"></td>
      <td class="st">${status(r)}</td><td class="muted">${fmtTime(r.last_movement)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const filter = () => {
    const s = $('#s', main).value.trim().toLowerCase(); const c = $('#cat', main).value; const only = $('#only', main).checked;
    $$('tbody tr', main).forEach((tr) => { tr.hidden = (s && !tr.dataset.s.includes(s)) || (c && tr.dataset.cat !== c) || (only && !tr.classList.contains('warnrow')); });
  };
  $('#s', main).oninput = filter; $('#cat', main).onchange = filter; $('#only', main).onchange = filter;
  main.addEventListener('change', async (e) => {
    if (!e.target.matches('.rl')) return;
    const inp = e.target; const tr = inp.closest('tr'); const v = inp.value.trim();
    if (v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0)) { inp.classList.add('err'); return toast('Reorder level must be a whole number', true); }
    inp.classList.remove('err');
    await busy(inp, async () => {
      const r = await api('PUT', `/api/items/${tr.dataset.id}/reorder`, { reorder_level: v });
      const stock = Number(tr.dataset.stock);
      const need = r.reorder_level !== null && stock <= r.reorder_level;
      tr.classList.toggle('warnrow', need || stock < 0);
      $('.st', tr).innerHTML = stock <= 0 && r.reorder_level !== null ? alertBadge('OUT') : need ? alertBadge('REORDER') : '';
      $('#nre', main).textContent = $$('tbody tr.warnrow', main).length;
      toast(r.reorder_level === null ? 'Reorder alert removed' : `Alert when stock ≤ ${r.reorder_level}`);
      renderShell(parseHash().path);
    });
  });
  filter(); clickRows(main);
}

async function ItemLedger(main, { id }) {
  const l = await GET('/api/inventory/' + id);
  const ref = (t) => t.reference_type === 'ORDER' ? `<a href="#/orders/${t.reference_id}">Order #${t.reference_id}</a> · ${esc(t.branch_name)}`
    : t.reference_type === 'SUPPLIER_RECEIPT' ? `Receipt #${t.reference_id} · ${esc(t.supplier_name)}`
      : t.reference_type === 'PRODUCTION' ? `<a href="#/production">Production #${t.reference_id}</a>` : `Count #${t.reference_id}`;
  main.innerHTML = head(`${esc(l.item.item_name)} <span class="code" style="font-size:15px">${esc(l.item.item_code)}</span>`, `<span class="ar">${esc(l.item.item_name_ar || '')}</span> · ${esc(l.item.category)}`, '<a class="btn" href="#/inventory">Back to inventory</a>') + `
    <div class="stack"><div class="card card-b summary"><div><div class="k">Current stock</div><div class="v" style="font-size:28px">${n0(l.stock)}</div></div>
      <div><div class="k">Transactions</div><div class="v">${l.transactions.length}</div></div>
      <div class="grow"></div>
      <div class="row no-print" style="align-items:flex-end"><label class="f">Unit<input class="input" id="unit" list="units" value="${esc(l.item.unit)}" maxlength="30" style="width:140px"></label>
        <datalist id="units"><option value="unit"><option value="carton"><option value="box"><option value="pack"><option value="bag"><option value="bottle"><option value="can"><option value="roll"><option value="piece"><option value="kg"><option value="liter"></datalist>
        <button class="btn" id="save-unit">Save unit</button>
        <label class="f">Reorder at<input class="input" id="rlevel" inputmode="numeric" value="${l.item.reorder_level ?? ''}" placeholder="no alert" style="width:110px"></label>
        <button class="btn" id="save-rl">Save</button></div></div>
      ${l.item.reorder_level !== null && l.stock <= l.item.reorder_level ? `<div class="note warn"><b>Reorder now:</b> stock ${n0(l.stock)} is at or below the reorder level (${l.item.reorder_level}).</div>` : ''}
    <div class="card"><div class="card-h"><h2>Stock ledger</h2><span class="muted">Newest first · every change and its source</span></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Date & time</th><th>Type</th><th>Reference</th><th class="num">In</th><th class="num">Out</th><th class="num">Balance</th><th>By</th><th>Note</th></tr></thead>
      <tbody>${l.transactions.map((t) => `<tr><td>${fmtTime(t.created_at)}</td><td>${esc(TX_LABEL[t.transaction_type] || t.transaction_type)}</td><td>${ref(t)}</td>
        <td class="num pos">${t.direction > 0 ? '+' + t.quantity : ''}</td><td class="num neg">${t.direction < 0 ? '−' + t.quantity : ''}</td>
        <td class="num"><b>${n0(t.balance)}</b></td><td class="muted">${esc(t.created_by_name)}</td><td class="muted">${esc(t.note || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No movements yet.</td></tr>'}
      </tbody></table></div></div></div>`;
  $('#save-rl', main).onclick = (e) => busy(e.target, async () => {
    const r = await api('PUT', `/api/items/${l.item.id}/reorder`, { reorder_level: $('#rlevel', main).value.trim() });
    toast(r.reorder_level === null ? 'Reorder alert removed' : `Alert when stock ≤ ${r.reorder_level}`); router();
  });
  $('#save-unit', main).onclick = (e) => busy(e.target, async () => {
    await api('PUT', `/api/items/${l.item.id}/unit`, { unit: $('#unit', main).value });
    state.items = null; toast('Unit saved');
  });
}

async function StockCount(main) {
  const [rows, history] = await Promise.all([GET('/api/inventory'), GET('/api/stock-counts')]);
  main.innerHTML = head('Stock Count', 'Enter physical counts — adjustments are posted only when you confirm') + `<div class="stack">
    <div class="card"><div class="card-b filters">
      <label class="f">Count date<input class="input" type="date" id="cdate" value="${state.me.today}"></label>
      <label class="f grow">Reason (required)<input class="input" id="reason" list="reasons" placeholder="e.g. Monthly count"></label>
      <datalist id="reasons"><option value="Monthly count"><option value="Weekly count"><option value="Opening balance"><option value="Damaged goods"><option value="Expired goods"><option value="Correction"></datalist>
    </div>
    <div class="card-h no-print" style="border-top:1px solid var(--line)"><input class="input grow" id="s" placeholder="Search code or name…">
      <select class="input" id="cat"><option value="">All categories</option>${categoriesOf(rows).map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <label class="row" style="gap:6px;font-weight:600"><input type="checkbox" id="only"> Only counted</label></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Code</th><th>Item</th><th class="num">System</th><th class="num">Physical</th><th class="num">Variance</th></tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}" data-sys="${r.stock}" data-cat="${esc(r.category)}" data-s="${esc((r.item_code + ' ' + r.item_name + ' ' + (r.item_name_ar || '')).toLowerCase())}">
      <td class="code">${esc(r.item_code)}</td><td>${itemCell(r)}</td><td class="num">${n0(r.stock)}</td>
      <td class="num"><input class="qty" inputmode="numeric" pattern="[0-9]*" placeholder="—"></td><td class="num var">—</td></tr>`).join('')}</tbody></table></div></div>
    <div class="actionbar"><div class="grow" id="csum"></div><button class="btn primary lg" id="csave">Review & confirm</button></div>
    <div class="card"><div class="card-h"><h2>Recent counts</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Date</th><th>Item</th><th class="num">System</th><th class="num">Physical</th><th class="num">Variance</th><th>Reason</th><th>By</th></tr></thead><tbody>
      ${history.slice(0, 50).map((h) => `<tr><td>${fmtDate(h.count_date)}</td><td><span class="code">${esc(h.item_code)}</span> ${esc(h.item_name)}</td><td class="num">${n0(h.system_quantity)}</td><td class="num">${n0(h.physical_quantity)}</td>
        <td class="num ${h.variance < 0 ? 'neg' : h.variance > 0 ? 'pos' : ''}">${h.variance > 0 ? '+' : ''}${h.variance}</td><td>${esc(h.reason)}</td><td class="muted">${esc(h.created_by_name)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No counts yet.</td></tr>'}
      </tbody></table></div></div></div>`;
  const read = () => {
    const lines = []; let bad = 0;
    for (const tr of $$('tbody tr[data-id]', main)) {
      const inp = $('.qty', tr); const s = inp.value.trim();
      if (s === '') { $('.var', tr).textContent = '—'; $('.var', tr).className = 'num var'; inp.classList.remove('err', 'has'); tr.classList.remove('flag'); continue; }
      const v = Number(s); const ok = Number.isInteger(v) && v >= 0;
      inp.classList.toggle('err', !ok); inp.classList.toggle('has', ok);
      if (!ok) { bad++; continue; }
      const d = v - Number(tr.dataset.sys);
      $('.var', tr).textContent = d ? (d > 0 ? '+' : '') + d : '0';
      $('.var', tr).className = 'num var ' + (d < 0 ? 'neg' : d > 0 ? 'pos' : '');
      tr.classList.toggle('flag', d !== 0);
      lines.push({ item_id: Number(tr.dataset.id), physical_quantity: v, d, name: $('.iname', tr).textContent, code: $('.code', tr).textContent, sys: Number(tr.dataset.sys) });
    }
    const adj = lines.filter((l) => l.d).length;
    $('#csum', main).innerHTML = bad ? '<span class="note bad">Whole numbers only</span>' : `<b>${lines.length}</b> counted · <b>${adj}</b> with variance`;
    $('#csave', main).disabled = !!bad || !lines.length;
    return lines;
  };
  const filter = () => {
    const s = $('#s', main).value.trim().toLowerCase(); const c = $('#cat', main).value; const only = $('#only', main).checked;
    $$('tbody tr[data-id]', main).forEach((tr) => { tr.hidden = (s && !tr.dataset.s.includes(s)) || (c && tr.dataset.cat !== c) || (only && $('.qty', tr).value.trim() === ''); });
  };
  main.addEventListener('input', (e) => { if (e.target.matches('.qty')) { state.dirty = true; read(); } if (e.target.id === 's') filter(); });
  $('#cat', main).onchange = filter; $('#only', main).onchange = filter;
  $('#csave', main).onclick = async (e) => {
    const lines = read();
    const reason = $('#reason', main).value.trim();
    if (!reason) { $('#reason', main).focus(); return toast('Enter a reason for this count', true); }
    const adj = lines.filter((l) => l.d);
    const ok = await modal({ title: 'Confirm stock count?', ok: adj.length ? `Confirm & post ${adj.length} adjustment${adj.length > 1 ? 's' : ''}` : 'Confirm count',
      body: `<p>Reason: <b>${esc(reason)}</b>. System quantities are re-checked at confirmation.</p>${adj.length ? `<table class="t"><thead><tr><th>Item</th><th class="num">System</th><th class="num">Physical</th><th class="num">Variance</th></tr></thead><tbody>
      ${adj.map((l) => `<tr><td><span class="code">${esc(l.code)}</span> ${esc(l.name)}</td><td class="num">${l.sys}</td><td class="num">${l.physical_quantity}</td><td class="num ${l.d < 0 ? 'neg' : 'pos'}">${l.d > 0 ? '+' : ''}${l.d}</td></tr>`).join('')}</tbody></table>` : '<p>All counted items match the system.</p>'}` });
    if (!ok) return;
    await busy(e.target, async () => {
      const r = await api('POST', '/api/stock-counts', { date: $('#cdate', main).value, reason, lines: lines.map(({ item_id, physical_quantity }) => ({ item_id, physical_quantity })) });
      state.dirty = false; toast(`${r.counted} counted · ${r.adjusted} adjusted`); router();
    });
  };
  read();
}

// ───────────────────────── ACCOUNTANT (and manager) ─────────────────────────
async function Report(main, _p, query) {
  const [branches, srcs] = await Promise.all([GET('/api/branches'), sources()]);
  const t = state.me.today;
  const acc = isFin();
  const f = { branch_id: query.branch_id || '', source: acc ? (query.source || '') : '', from: query.from || t.slice(0, 8) + '01', to: query.to || t };
  main.innerHTML = head('Accepted Quantities', 'Quantities accepted and issued to a branch, by order date', acc && f.branch_id ? `<a class="btn" href="#/statement?branch_id=${f.branch_id}&month=${f.from.slice(0, 7)}">Monthly statement</a><button class="btn" data-xlsx>Excel</button><button class="btn" data-print>Print / PDF</button>` : '') + `<div class="stack">
    <form class="card card-b filters no-print" id="rf">
      <label class="f grow">Branch<select class="input" name="branch_id" required><option value="">Select branch ▾</option>${branches.map((b) => `<option value="${b.id}" ${String(b.id) === f.branch_id ? 'selected' : ''}>${esc(b.branch_name)}</option>`).join('')}</select></label>
      ${acc ? `<label class="f">Source<select class="input" name="source"><option value="">Warehouse + Factory</option>${srcs.map((x) => `<option value="${x.id}" ${String(x.id) === f.source ? 'selected' : ''}>${esc(srcLabel(x.code, x.name))} only</option>`).join('')}</select></label>` : ''}
      <label class="f">From<input class="input" type="date" name="from" value="${f.from}" required></label>
      <label class="f">To<input class="input" type="date" name="to" value="${f.to}" required></label>
      <button class="btn primary">Search</button>
    </form><div id="res"></div></div>`;
  $('#rf', main).onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    location.hash = '#/report?' + qs(d);
  };
  if (!f.branch_id) { $('#res', main).innerHTML = '<div class="card empty">Select a branch and date range, then search.</div>'; return; }
  const r = await GET('/api/reports/accepted?' + qs(f));
  $('#res', main).innerHTML = `
    <div class="card card-b summary"><div><div class="k">Branch</div><div class="v">${esc(r.branch.branch_name)}</div></div>
      <div><div class="k">Source</div><div class="v">${r.source ? esc(srcLabel(srcs.find((x) => x.id === r.source.id)?.code, r.source.name)) : 'All'}</div></div>
      <div><div class="k">Period</div><div class="v">${fmtDate(r.from)} – ${fmtDate(r.to)}</div></div>
      <div><div class="k">Orders</div><div class="v">${r.orders.length}</div></div>
      <div><div class="k">Items</div><div class="v">${r.items.length}</div></div>
      <div><div class="k">Total accepted</div><div class="v">${n0(r.total_quantity)}</div></div>
      ${acc ? `<div><div class="k">Value at cost (SAR)</div><div class="v">${sar(r.total_value_h)}</div></div>` : ''}</div>
    ${acc && r.missing_costs ? `<div class="note warn no-print" style="margin-top:12px">${r.missing_costs} item(s) have no cost price for some dates — counted as 0. <a href="#/costs?missing=1">Item costs</a></div>` : ''}
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Accepted by item</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Code</th><th>Item</th><th>From</th><th>Category</th><th class="num">Accepted quantity</th>${acc ? '<th class="num">Avg unit cost</th><th class="num">Value SAR</th>' : ''}</tr></thead>
      <tbody>${r.items.map((i) => `<tr><td class="code">${esc(i.item_code)}</td><td>${itemCell(i)}</td><td>${srcTag(i.source_code, i.source_name)}</td><td class="muted">${esc(i.category)}</td><td class="num" style="font-size:15px"><b>${n0(i.accepted_quantity)}</b></td>${acc ? `<td class="num">${i.missing_cost && i.value_h == null ? '<span class="neg">no cost</span>' : sar(i.avg_unit_cost_h)}</td><td class="num">${sar(i.value_h)}${i.missing_cost ? ' <span class="neg" title="Some dates have no cost">*</span>' : ''}</td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="empty">No accepted quantities in this period.</td></tr>'}</tbody>
      ${r.items.length ? `<tfoot>${r.source ? '' : [...new Set(r.items.map((i) => i.source_name))].map((sn) => `<tr><td></td><td>Subtotal — ${esc(sn === 'Central Warehouse' ? 'Warehouse' : sn)}</td><td></td><td></td><td class="num">${n0(r.items.filter((i) => i.source_name === sn).reduce((a, i) => a + i.accepted_quantity, 0))}</td>${acc ? `<td></td><td class="num">${sar(r.items.filter((i) => i.source_name === sn).reduce((a, i) => a + (i.value_h || 0), 0))}</td>` : ''}</tr>`).join('')}
        <tr><td></td><td>Total</td><td></td><td></td><td class="num">${n0(r.total_quantity)}</td>${acc ? `<td></td><td class="num">${sar(r.total_value_h)}</td>` : ''}</tr></tfoot>` : ''}</table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Orders in this period</h2><span class="muted">Click to see requested / accepted / received</span></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Date</th><th>Order</th><th>From</th><th>Status</th><th class="num">Requested</th><th class="num">Accepted</th><th class="num">Received</th>${acc ? '<th class="num">Value SAR</th>' : ''}</tr></thead>
      <tbody>${r.orders.map((o) => `<tr class="click" data-href="#/orders/${o.id}"><td>${fmtDate(o.order_date)}</td><td>#${o.id}</td><td>${srcTag(o.source_code, o.source_name)}</td><td>${badge(o.status, o.discrepancies)}</td>
        <td class="num">${n0(o.requested_total)}</td><td class="num"><b>${n0(o.accepted_total)}</b></td><td class="num">${o.status === 'RECEIVED' ? n0(o.received_total) : '—'}</td>${acc ? `<td class="num">${sar(o.value_h)}</td>` : ''}</tr>`).join('') || '<tr><td colspan="8" class="empty">No orders.</td></tr>'}</tbody></table></div></div>`;
  clickRows(main);
  if (acc) {
    wireExport(main, `accepted-${r.branch.branch_name}-${r.from}-to-${r.to}`, () => [
      { name: 'By item', title: `Accepted quantities — ${r.branch.branch_name} — ${r.from} to ${r.to}`, header: ['Code', 'Item', 'Item (AR)', 'Source', 'Category', 'Accepted', 'Avg unit cost', 'Value SAR'],
        rows: r.items.map((i) => [i.item_code, i.item_name, i.item_name_ar || '', srcLabel(i.source_code, i.source_name), i.category, i.accepted_quantity, sarNum(i.avg_unit_cost_h), sarNum(i.value_h)]),
        footer: [['Total', '', '', '', '', r.total_quantity, '', sarNum(r.total_value_h)]] },
      { name: 'Orders', header: ['Date', 'Order', 'Source', 'Status', 'Requested', 'Accepted', 'Received', 'Value SAR'],
        rows: r.orders.map((o) => [o.order_date, o.id, srcLabel(o.source_code, o.source_name), STATUS_LABEL[o.status] || o.status, o.requested_total, o.accepted_total, o.status === 'RECEIVED' ? o.received_total : '', sarNum(o.value_h)]) },
    ]);
  }
}

// ───────────────────────── DRIVER ─────────────────────────
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : '');
const STAGE = { TO_LOAD: ['To load', 'b-ACCEPTED'], ON_THE_WAY: ['On the way', 'b-DISPATCHED'], DELIVERED: ['Delivered', 'b-RECEIVED'] };

async function DriverToday(main) {
  const r = await GET('/api/driver/route');
  const lines = (ls) => `<ul class="plain">${ls.map((l) => `<li><span><span class="code">${esc(l.item_code)}</span> ${esc(l.item_name)} <span class="ar">${esc(l.item_name_ar || '')}</span></span><b>${l.quantity}</b></li>`).join('')}</ul>`;
  const todo = r.stops.filter((x) => x.stage !== 'DELIVERED');
  main.innerHTML = head(`Today's route`, `${esc(r.driver.name)} · ${fmtDate(r.today)}`, '<button class="btn" id="refresh">Refresh</button>') + `<div class="stack">
    ${r.open_tasks ? `<a class="note warn row" href="#/tasks" style="text-decoration:none"><b class="grow">You have ${r.open_tasks} open task${r.open_tasks > 1 ? 's' : ''}</b><span class="btn sm">View tasks</span></a>` : ''}
    ${r.pickups.length ? `<h2 class="sec">1 · Pick up</h2>` + r.pickups.map((p) => `<div class="card">
      <div class="card-h"><h2>${srcTag(p.source_code, p.source_name)} Load at the ${esc(srcLabel(p.source_code, p.source_name).toLowerCase())}</h2><span class="muted">${fmtDate(p.order_date)}</span></div>
      <div class="card-b"><div class="muted" style="margin-bottom:6px">For: ${p.branches.map(esc).join(' · ')}</div>${lines(p.totals)}</div>
      <div class="card-b" style="border-top:1px solid var(--line)"><button class="btn primary lg wide" data-load="${p.warehouse_id}" data-date="${p.order_date}" data-n="${p.order_ids.length}">✓ Loaded — ${p.order_ids.length} order${p.order_ids.length > 1 ? 's' : ''}</button></div>
    </div>`).join('') : ''}
    <h2 class="sec">${r.pickups.length ? '2 · ' : ''}Deliveries ${todo.length ? `<span class="muted">(${todo.length} to go)</span>` : ''}</h2>
    ${todo.length ? todo.map((o) => `<div class="card stop-card ${o.stage === 'DELIVERED' ? 'done' : ''}">
      <div class="card-h"><div class="row" style="gap:8px"><span class="seq">${o.sequence}</span><h2>${esc(o.branch_name)}</h2>${srcTag(o.source_code, o.source_name)}</div>
        <span class="badge ${STAGE[o.stage][1]}">${STAGE[o.stage][0]}${o.stage === 'DELIVERED' && o.delivered_at ? ' ' + hhmm(o.delivered_at) : ''}</span></div>
      <details class="card-b" ${o.stage === 'ON_THE_WAY' ? 'open' : ''}><summary>${o.lines.length} item${o.lines.length === 1 ? '' : 's'} · ${o.lines.reduce((a, l) => a + l.quantity, 0)} units${o.order_date !== r.today ? ` · ${fmtDate(o.order_date)}` : ''}</summary>${lines(o.lines)}</details>
      ${o.stage === 'ON_THE_WAY' ? `<div class="card-b" style="border-top:1px solid var(--line)"><button class="btn dark lg wide" data-deliver="${o.id}" data-branch="${esc(o.branch_name)}">Delivered to ${esc(o.branch_name)}</button></div>` : ''}
      ${o.stage === 'TO_LOAD' ? '<div class="card-b muted" style="border-top:1px solid var(--line)">Load it at the pickup first.</div>' : ''}
    </div>`).join('') : '<div class="card empty">Nothing left to deliver. 👍</div>'}
    ${r.stops.some((x) => x.stage === 'DELIVERED') ? `<div class="card"><div class="card-h"><h2>Delivered today</h2><span class="muted">${r.stops.filter((x) => x.stage === 'DELIVERED').length}</span></div>
      <div class="tbl-wrap"><table class="t"><tbody>${r.stops.filter((x) => x.stage === 'DELIVERED').map((o) => `<tr class="dim"><td><b>${esc(o.branch_name)}</b></td><td>${srcTag(o.source_code, o.source_name)}</td><td class="num">${o.delivered_at ? hhmm(o.delivered_at) : '✓'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  </div>`;
  $('#refresh', main).onclick = () => router();
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.load) {
      const ok = await modal({ title: 'Everything loaded?', ok: 'Yes, loaded', body: `<p>${b.dataset.n} order${b.dataset.n > 1 ? 's' : ''} will be marked as on the way.</p>` });
      if (ok) await busy(b, async () => { await api('POST', '/api/driver/pickup', { source: Number(b.dataset.load), date: b.dataset.date }); toast('Loaded — on the way'); router(); });
    }
    if (b.dataset.deliver) {
      const ok = await modal({ title: `Delivered to ${b.dataset.branch}?`, ok: 'Yes, delivered', okClass: 'dark', body: '<p>The branch will count and confirm the quantities.</p>' });
      if (ok) await busy(b, async () => { await api('POST', `/api/driver/orders/${b.dataset.deliver}/delivered`, {}); toast(`Delivered to ${b.dataset.branch}`); router(); });
    }
  });
}

async function DriverTasks(main) {
  const tasks = await GET('/api/driver/tasks');
  const open = tasks.filter((t) => t.status === 'OPEN');
  const done = tasks.filter((t) => t.status !== 'OPEN').slice(0, 20);
  main.innerHTML = head('My Tasks', `${open.length} open`) + `<div class="stack">
    ${open.map((t) => `<div class="card ${t.overdue ? 'overdue' : ''}"><div class="card-b stack">
      <div class="row"><b class="grow" style="font-size:16px">${esc(t.title)}</b>${t.due_date ? `<span class="badge ${t.overdue ? 'b-REJECTED' : ''}">${t.overdue ? 'Overdue · ' : 'Due '}${fmtDate(t.due_date)}</span>` : ''}</div>
      ${t.details ? `<div style="white-space:pre-wrap">${esc(t.details)}</div>` : ''}
      <div class="muted">From ${esc(t.created_by_name)} · ${fmtTime(t.created_at)}</div>
      <button class="btn primary lg wide" data-done="${t.id}" data-title="${esc(t.title)}">✓ Mark done</button></div></div>`).join('') || '<div class="card empty">No open tasks. 👍</div>'}
    ${done.length ? `<div class="card"><div class="card-h"><h2>Recently finished</h2></div><div class="tbl-wrap"><table class="t"><tbody>
      ${done.map((t) => `<tr class="dim"><td>${esc(t.title)}${t.done_note ? `<div class="muted">${esc(t.done_note)}</div>` : ''}</td><td class="num">${t.status === 'DONE' ? `<span class="badge b-RECEIVED">Done ${fmtTime(t.done_at)}</span>` : '<span class="badge">Cancelled</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}</div>`;
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-done]');
    if (!b) return;
    const note = await modal({ title: `Done: ${b.dataset.title}?`, ok: 'Mark done', input: 'Note (optional)' });
    if (note === false) return;
    await busy(b, async () => { await api('POST', `/api/driver/tasks/${b.dataset.done}/done`, { note: note || '' }); toast('Task done'); router(); });
  });
}

// ───────────────────────── MANAGER: drivers tracking ─────────────────────────
async function Drivers(main, _p, query) {
  const t = state.me.today;
  const f = { from: query.from || addDays(t, -30), to: query.to || t };
  const r = await GET('/api/drivers/stats?' + qs(f));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  main.innerHTML = head('Drivers', 'Deliveries, receiving differences and tasks per driver') + `<div class="stack">
    <form class="card card-b filters no-print" id="df">
      <label class="f">From<input class="input" type="date" name="from" value="${f.from}"></label>
      <label class="f">To<input class="input" type="date" name="to" value="${f.to}"></label>
      <button class="btn">Update</button></form>
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Driver</th><th>Login</th><th class="num">Stops</th><th class="num">Delivered</th><th class="num">Orders with differences</th><th class="num">Units short</th>
        <th class="num">Tasks done</th><th class="num">Open</th><th class="num">Overdue</th><th class="num">Avg task time</th></tr></thead>
      <tbody>${r.drivers.map((d) => `<tr class="click ${d.active ? '' : 'dim'}" data-href="#/drivers/${d.id}">
        <td style="white-space:nowrap"><b>${esc(d.name)}</b>${d.phone ? `<div class="muted">${esc(d.phone)}</div>` : ''}${d.active ? '' : ' <span class="badge">Inactive</span>'}</td>
        <td class="muted">${esc(d.login || '— no login')}</td>
        <td class="num">${d.stops}</td><td class="num">${d.delivered}</td>
        <td class="num ${d.diff_orders ? 'neg' : ''}">${d.diff_orders}${d.received ? ` <span class="muted">(${pct(d.diff_orders, d.received)})</span>` : ''}</td>
        <td class="num ${d.units_short ? 'neg' : ''}">${d.units_short}</td>
        <td class="num">${d.tasks_done} / ${d.tasks_assigned}</td><td class="num">${d.tasks_open}</td>
        <td class="num ${d.tasks_overdue ? 'neg' : ''}">${d.tasks_overdue}</td>
        <td class="num">${d.avg_task_hours == null ? '—' : d.avg_task_hours + ' h'}</td></tr>`).join('')}</tbody></table></div></div>
    <form class="card" id="nd"><div class="card-h"><h2>Add driver</h2><span class="muted">Email + password create his login</span></div>
      <div class="card-b filters">
        <label class="f grow">Name<input class="input" name="name" required></label>
        <label class="f">Phone<input class="input" name="phone" inputmode="tel"></label>
        <label class="f grow">Login email<input class="input" name="email" type="email" placeholder="driver4@spicymeal.sa"></label>
        <label class="f">Password<input class="input" name="password" type="text" minlength="8" placeholder="min 8 characters"></label>
        <button class="btn primary">Add driver</button></div></form></div>`;
  $('#df', main).onsubmit = (e) => { e.preventDefault(); location.hash = '#/drivers?' + qs(Object.fromEntries(new FormData(e.target))); };
  $('#nd', main).onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await busy($('button', e.target), async () => { await api('POST', '/api/drivers', d); toast('Driver added'); router(); });
  };
  clickRows(main);
}

async function DriverProfile(main, { id }, query) {
  const t = state.me.today;
  const f = { from: query.from || addDays(t, -30), to: query.to || t };
  const p = await GET(`/api/drivers/${id}/profile?` + qs(f));
  const d = p.driver;
  const tile = (v, l, bad) => `<div class="card tile ${bad ? 'hot' : ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const taskBadge = (x) => x.status === 'DONE' ? `<span class="badge b-RECEIVED">Done</span>` : x.status === 'CANCELLED' ? '<span class="badge">Cancelled</span>'
    : x.overdue ? '<span class="badge b-REJECTED">Overdue</span>' : '<span class="badge b-SUBMITTED">Open</span>';
  main.innerHTML = head(esc(d.name), `${d.phone ? esc(d.phone) + ' · ' : ''}${esc(d.login || 'no login')} · ${fmtDate(p.from)} – ${fmtDate(p.to)}`, '<a class="btn" href="#/drivers">All drivers</a>') + `<div class="stack">
    <div class="tiles">
      ${tile(d.delivered + ' / ' + d.stops, 'Stops delivered')}
      ${tile(d.diff_orders, 'Orders with receiving differences', d.diff_orders)}
      ${tile(d.units_short, 'Units short (sent − received)', d.units_short)}
      ${tile(d.tasks_done + ' / ' + d.tasks_assigned, 'Tasks done')}
      ${tile(d.tasks_overdue, 'Tasks overdue', d.tasks_overdue)}
      ${tile(d.avg_task_hours == null ? '—' : d.avg_task_hours + ' h', 'Avg time to finish a task')}
    </div>
    <div class="grid2">
      <form class="card" id="nt"><div class="card-h"><h2>Give a task</h2></div><div class="card-b stack">
        <label class="f">Task<input class="input" name="title" required maxlength="120" placeholder="e.g. Pick up cups from ABC Food"></label>
        <label class="f">Details (optional)<textarea class="input" name="details" rows="2"></textarea></label>
        <div class="row"><label class="f">Due date<input class="input" type="date" name="due_date" value="${t}"></label><span class="grow"></span><button class="btn primary">Assign task</button></div>
      </div></form>
      <form class="card" id="ed"><div class="card-h"><h2>Driver details</h2></div><div class="card-b stack">
        <label class="f">Name<input class="input" name="name" value="${esc(d.name)}" required></label>
        <label class="f">Phone<input class="input" name="phone" value="${esc(d.phone || '')}" inputmode="tel"></label>
        <div class="row"><label class="row" style="gap:6px;font-weight:600"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Active</label><span class="grow"></span><button class="btn">Save</button></div>
      </div></form>
    </div>
    <div class="card"><div class="card-h"><h2>Tasks</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Task</th><th>Status</th><th>Due</th><th>Given</th><th>Finished</th><th>Driver note</th><th></th></tr></thead>
      <tbody>${p.tasks.map((x) => `<tr><td><b>${esc(x.title)}</b>${x.details ? `<div class="muted">${esc(x.details)}</div>` : ''}</td><td>${taskBadge(x)}</td>
        <td>${x.due_date ? fmtDate(x.due_date) : '—'}</td><td class="muted">${fmtTime(x.created_at)}</td><td>${x.done_at ? fmtTime(x.done_at) : '—'}</td>
        <td class="muted">${esc(x.done_note || '')}</td><td>${x.status === 'OPEN' ? `<button class="btn sm danger" data-cancel="${x.id}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No tasks yet.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><div class="card-h"><h2>Deliveries</h2><span class="muted">Differences are what branches reported at receiving</span></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Date</th><th>Stop</th><th>Branch</th><th>From</th><th>Loaded</th><th>Delivered</th><th>Status</th><th class="num">Units short</th></tr></thead>
      <tbody>${p.deliveries.map((o) => `<tr class="click ${o.discrepancies ? 'flag' : ''}" data-href="#/orders/${o.id}"><td>${fmtDate(o.order_date)}</td><td>${o.sequence}</td><td><b>${esc(o.branch_name)}</b></td>
        <td>${srcTag(o.source_code, o.source_name)}</td><td>${o.dispatched_at ? hhmm(o.dispatched_at) : '—'}</td><td>${o.delivered_at ? hhmm(o.delivered_at) : '—'}</td>
        <td>${badge(o.status, o.discrepancies)}</td><td class="num ${o.net_short > 0 ? 'neg' : ''}">${o.status === 'RECEIVED' ? o.net_short : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No deliveries in this period.</td></tr>'}
      </tbody></table></div></div></div>`;
  $('#nt', main).onsubmit = async (e) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(e.target)), driver_id: d.id };
    await busy($('button', e.target), async () => { await api('POST', '/api/tasks', body); toast(`Task given to ${d.name}`); router(); });
  };
  $('#ed', main).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await busy($('button', e.target), async () => { await api('PUT', `/api/drivers/${d.id}`, { name: fd.get('name'), phone: fd.get('phone'), active: fd.get('active') === 'on' }); toast('Saved'); router(); });
  };
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]');
    if (!b) return;
    if (await modal({ title: 'Cancel this task?', ok: 'Cancel task', okClass: 'danger', cancel: 'Keep' })) {
      await busy(b, async () => { await api('POST', `/api/tasks/${b.dataset.cancel}/cancel`, {}); toast('Task cancelled'); router(); });
    }
  });
  clickRows(main);
}

async function Account(main) {
  main.innerHTML = head('Change password', esc(state.me.email)) + `<form class="card card-b stack" id="pf" style="max-width:420px">
    <label class="f">Current password<input class="input" type="password" name="current_password" autocomplete="current-password" required></label>
    <label class="f">New password (min 8 characters)<input class="input" type="password" name="new_password" minlength="8" autocomplete="new-password" required></label>
    <button class="btn primary">Update password</button></form>`;
  $('#pf', main).onsubmit = async (e) => {
    e.preventDefault();
    await busy($('button', e.target), async () => { await api('POST', '/api/me/password', Object.fromEntries(new FormData(e.target))); toast('Password updated'); e.target.reset(); });
  };
}

function clickRows(root) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select')) return;
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
}
