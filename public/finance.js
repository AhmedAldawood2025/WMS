'use strict';
/* Accounts & CFO screens. Loaded before app.js; uses app.js helpers at call time. */

// ───────────────────────── helpers ─────────────────────────
const sar = (h) => (h === null || h === undefined ? '—' : (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sarNum = (h) => (h === null || h === undefined ? '' : Math.round(h) / 100); // for Excel
const sarIn = (h) => (h === null || h === undefined ? '' : (h / 100).toFixed(2));
const parseSar = (v) => { const s = String(v ?? '').trim().replace(/,/g, ''); if (!s) return null; return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN; };
const isAcc = () => state.me?.role === 'ACCOUNTANT';
const isCfo = () => state.me?.role === 'CFO';
const monthNow = () => state.me.today.slice(0, 7);
const monthName = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthEndC = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); };
const exportBtns = (print = true) => `<button class="btn" data-xlsx>Excel</button>${print ? '<button class="btn" data-print>Print / PDF</button>' : ''}`;
function wireExport(main, fileName, sheetsFn) {
  const x = $('[data-xlsx]', main);
  if (x) x.onclick = () => { try { XLSX.download(fileName, sheetsFn()); } catch (e) { toast(e.message, true); } };
  const p = $('[data-print]', main);
  if (p) p.onclick = () => window.print();
}
const acctLabel = (a) => [a.bank, a.iban].filter(Boolean).join(' · ');
const INV_STATE = { INCOMPLETE: ['Needs details', 'b-DRAFT'], TO_CHECK: ['To check', 'b-SUBMITTED'], MATCHED: ['Checked', 'b-ACCEPTED'], IN_REQUEST: ['In payment request', 'b-DISPATCHED'], PAID: ['Paid', 'b-RECEIVED'] };
const invBadge = (s) => `<span class="badge ${INV_STATE[s]?.[1] || ''}">${INV_STATE[s]?.[0] || esc(s)}</span>`;
const PR_STATE = { SUBMITTED: ['Waiting for CFO', 'b-SUBMITTED'], APPROVED: ['Approved — to pay', 'b-ACCEPTED'], PAID: ['Paid', 'b-RECEIVED'], REJECTED: ['Returned', 'b-REJECTED'], CANCELLED: ['Cancelled', 'b-DRAFT'] };
const prBadge = (s) => `<span class="badge ${PR_STATE[s]?.[1] || ''}">${PR_STATE[s]?.[0] || esc(s)}</span>`;
const filterForm = (id, fields, btn = 'Show') => `<form class="card card-b filters no-print" id="${id}">${fields}<button class="btn primary">${btn}</button></form>`;
const onFilter = (main, id, base) => { $('#' + id, main).onsubmit = (e) => { e.preventDefault(); location.hash = base + '?' + qs(Object.fromEntries(new FormData(e.target))); }; };
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
const srcSelect = (srcs, cur, all = 'Warehouse + Factory') => `<label class="f">Source<select class="input" name="source">${opt('', all, cur)}${srcs.map((x) => opt(x.id, srcLabel(x.code, x.name), cur)).join('')}</select></label>`;
const docHead = (c, title, right = '') => `<div class="doc-head">
  <div class="doc-co"><img src="/logo.png" alt=""><div><b>${esc(c.company_name || 'SpicyMeal')}</b>${c.company_name_ar ? `<span class="ar">${esc(c.company_name_ar)}</span>` : ''}
    <div class="muted">${[c.address, c.phone, c.email].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="muted">${c.cr_number ? `CR ${esc(c.cr_number)}` : ''}${c.cr_number && c.vat_number ? ' · ' : ''}${c.vat_number ? `VAT ${esc(c.vat_number)}` : ''}</div></div></div>
  <div class="doc-title"><h2>${title}</h2>${right}</div></div>`;

// Simple form in a modal. fields: [{name,label,value,type,options:[[v,l]],required,full,readonly}]
function formModal({ title, fields, ok = 'Save', note = '' }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const input = (f) => f.options
      ? `<select class="input" name="${f.name}" ${f.required ? 'required' : ''}>${f.options.map(([v, l]) => opt(v, l, f.value)).join('')}</select>`
      : f.type === 'textarea' ? `<textarea class="input" name="${f.name}" rows="2" ${f.required ? 'required' : ''}>${esc(f.value ?? '')}</textarea>`
      : `<input class="input" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.attrs || ''}>`;
    bg.innerHTML = `<form class="modal wide" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="mb">${note}<div class="form-grid">
      ${fields.map((f) => `<label class="f ${f.full ? 'full' : ''}">${esc(f.label)}${input(f)}</label>`).join('')}</div></div>
      <div class="mf"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${esc(ok)}</button></div></form>`;
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') close(null); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.hasAttribute('data-x')) close(null); });
    $('form', bg).onsubmit = (e) => { e.preventDefault(); close(Object.fromEntries(new FormData(e.target))); };
    document.addEventListener('keydown', key);
    document.body.appendChild(bg);
    $('input, select, textarea', bg)?.focus();
  });
}

// ───────────────────────── home ─────────────────────────
async function FinanceHome(main) {
  const h = await GET('/api/finance/home');
  const tile = (v, l, href, hot) => `<a class="card tile ${hot ? 'hot' : ''} ${String(v).length > 5 ? 'money-t' : ''}" href="${href}"><div class="v">${v}</div><div class="l">${l}</div></a>`;
  const cfo = isCfo();
  main.innerHTML = head(cfo ? 'CFO' : 'Accounts', `${monthName(h.month)} · today ${fmtDate(h.today)}`,
    cfo ? '<a class="btn primary" href="#/requests?status=SUBMITTED">Review payment requests</a>' : '<a class="btn primary" href="#/requests/new">New payment request</a>') + `<div class="stack">
    <div class="tiles">
      ${cfo ? tile(h.requests_waiting, 'Waiting for your approval', '#/requests?status=SUBMITTED', h.requests_waiting) : ''}
      ${cfo ? tile(h.requests_to_pay, 'Approved — to pay', '#/requests?status=APPROVED', h.requests_to_pay) : ''}
      ${tile(sar(h.month_value_h), 'Issued to branches this month (SAR)', `#/summary?from=${h.month}-01&to=${h.today}`)}
      ${tile(sar(h.month_wh_h), 'From warehouse (SAR)', `#/summary?from=${h.month}-01&to=${h.today}`)}
      ${tile(sar(h.month_fac_h), 'From factory (SAR)', `#/summary?from=${h.month}-01&to=${h.today}`)}
      ${!cfo ? tile(h.invoices_to_check, 'Supplier invoices to check (90 days)', '#/invoices?status=INCOMPLETE,TO_CHECK', h.invoices_to_check) : ''}
      ${!cfo ? tile(h.invoices_ready + h.maint_bills_ready, 'Checked — ready for a payment request', '#/requests/new', h.invoices_ready + h.maint_bills_ready) : ''}
      ${!cfo ? tile(h.maint_bills_to_check, 'Maintenance bills to check', '#/maint-bills', h.maint_bills_to_check) : ''}
      ${!cfo ? tile(h.requests_waiting, 'Requests waiting for CFO', '#/requests?status=SUBMITTED') : ''}
      ${tile(sar(h.to_pay_h), 'Open payment requests (SAR)', '#/requests?status=SUBMITTED,APPROVED')}
      ${tile(sar(h.paid_this_month_h), 'Paid this month (SAR)', '#/requests?status=PAID')}
      ${tile(h.items_without_cost, 'Items without a cost price', '#/costs?missing=1', !cfo && h.items_without_cost)}
      ${tile(h.last_closed ? monthName(h.last_closed) : 'None', 'Last closed month', '#/periods')}
    </div>
    <div class="card"><div class="card-h"><h2>Top branches this month</h2><a class="btn sm" href="#/summary">All branches</a></div>
      ${h.top_branches.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Branch</th><th class="num">Warehouse</th><th class="num">Factory</th><th class="num">Total SAR</th></tr></thead><tbody>
      ${h.top_branches.map((b) => `<tr class="click" data-href="#/statement?branch_id=${b.branch_id}&month=${h.month}"><td><b>${esc(b.branch_name)}</b></td><td class="num">${sar(b.wh_value_h)}</td><td class="num">${sar(b.fac_value_h)}</td><td class="num"><b>${sar(b.total_value_h)}</b></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No valued issues yet this month. Add item cost prices to see values.</div>'}</div>
  </div>`;
  clickRows(main);
}

// ───────────────────────── all-branches summary ─────────────────────────
async function BranchSummary(main, _p, query) {
  const t = state.me.today;
  const f = { from: query.from || t.slice(0, 8) + '01', to: query.to || t };
  const r = await GET('/api/finance/summary?' + qs(f));
  const month = f.from.slice(0, 7);
  main.innerHTML = head('All Branches', `Value of accepted quantities by branch · ${fmtDate(r.from)} – ${fmtDate(r.to)}`, exportBtns()) + `<div class="stack">
    ${filterForm('sf', `<label class="f">From<input class="input" type="date" name="from" value="${f.from}" required></label>
      <label class="f">To<input class="input" type="date" name="to" value="${f.to}" required></label>
      <div class="row"><a class="btn sm" href="#/summary?from=${monthNow()}-01&to=${t}">This month</a><a class="btn sm" href="#/summary?from=${prevMonth(monthNow())}-01&to=${monthEndC(prevMonth(monthNow()))}">Last month</a></div>`)}
    ${r.missing_costs ? `<div class="note warn">${r.missing_costs} accepted line(s) have no cost price for their date, so they count as 0. <a href="#/costs?missing=1">Set item costs</a></div>` : ''}
    <div class="card card-b summary"><div><div class="k">Warehouse</div><div class="v">${sar(r.totals.wh_value_h)}</div></div>
      <div><div class="k">Factory</div><div class="v">${sar(r.totals.fac_value_h)}</div></div>
      <div><div class="k">Total SAR</div><div class="v">${sar(r.totals.total_value_h)}</div></div>
      <div><div class="k">Orders</div><div class="v">${r.totals.wh_orders + r.totals.fac_orders}</div></div></div>
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Branch</th><th class="num">WH orders</th><th class="num">WH qty</th><th class="num">WH value</th><th class="num">Factory orders</th><th class="num">Factory qty</th><th class="num">Factory value</th><th class="num">Total SAR</th></tr></thead>
      <tbody>${r.branches.map((b) => `<tr class="click" data-href="#/statement?branch_id=${b.branch_id}&month=${month}"><td><b>${esc(b.branch_name)}</b></td>
        <td class="num">${b.wh_orders || '—'}</td><td class="num">${b.wh_qty ? n0(b.wh_qty) : '—'}</td><td class="num">${sar(b.wh_value_h)}</td>
        <td class="num">${b.fac_orders || '—'}</td><td class="num">${b.fac_qty ? n0(b.fac_qty) : '—'}</td><td class="num">${sar(b.fac_value_h)}</td><td class="num"><b>${sar(b.total_value_h)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${r.totals.wh_orders}</td><td></td><td class="num">${sar(r.totals.wh_value_h)}</td><td class="num">${r.totals.fac_orders}</td><td></td><td class="num">${sar(r.totals.fac_value_h)}</td><td class="num">${sar(r.totals.total_value_h)}</td></tr></tfoot>
    </table></div><div class="card-b muted no-print">Click a branch to open its statement for ${monthName(month)}.</div></div></div>`;
  onFilter(main, 'sf', '#/summary');
  clickRows(main);
  wireExport(main, `branches-${r.from}-to-${r.to}`, () => [{
    name: 'Branches', title: `All branches — accepted value, ${r.from} to ${r.to} (SAR)`,
    header: ['Branch', 'WH orders', 'WH qty', 'WH value', 'Factory orders', 'Factory qty', 'Factory value', 'Total'],
    rows: r.branches.map((b) => [b.branch_name, b.wh_orders, b.wh_qty, sarNum(b.wh_value_h), b.fac_orders, b.fac_qty, sarNum(b.fac_value_h), sarNum(b.total_value_h)]),
    footer: [['Total', r.totals.wh_orders, '', sarNum(r.totals.wh_value_h), r.totals.fac_orders, '', sarNum(r.totals.fac_value_h), sarNum(r.totals.total_value_h)]],
  }]);
}

// ───────────────────────── monthly branch statement ─────────────────────────
async function Statement(main, _p, query) {
  const branches = await GET('/api/branches');
  const f = { branch_id: query.branch_id || '', month: query.month || monthNow() };
  main.innerHTML = head('Branch Statement', 'Everything issued to one branch in a month, valued at cost', f.branch_id ? exportBtns() : '') + `<div class="stack">
    ${filterForm('stf', `<label class="f grow">Branch<select class="input" name="branch_id" required>${opt('', 'Select branch ▾', f.branch_id)}${branches.map((b) => opt(b.id, b.branch_name, f.branch_id)).join('')}</select></label>
      <label class="f">Month<input class="input" type="month" name="month" value="${f.month}" required></label>`)}<div id="res"></div></div>`;
  onFilter(main, 'stf', '#/statement');
  if (!f.branch_id) { $('#res', main).innerHTML = '<div class="card empty">Select a branch and month.</div>'; return; }
  const r = await GET('/api/finance/statement?' + qs(f));
  const T = r.totals;
  $('#res', main).innerHTML = `<div class="card card-b doc">
    ${docHead(r.company, 'Branch Statement', `<div><b>${esc(r.branch.branch_name)}</b> · ${esc(r.branch.branch_code)}</div><div>${monthName(r.month)}</div>
      <div class="muted">${r.locked ? 'Month closed' : 'Month open — figures may still change'}</div>`)}
    ${T.missing ? `<div class="note warn no-print">${T.missing} line(s) have no cost price and count as 0.</div>` : ''}
    <div class="summary" style="margin:14px 0"><div><div class="k">Orders</div><div class="v">${r.orders.length}</div></div>
      <div><div class="k">Warehouse</div><div class="v">${sar(T.wh_h)}</div></div><div><div class="k">Factory</div><div class="v">${sar(T.fac_h)}</div></div>
      <div><div class="k">Total SAR</div><div class="v">${sar(T.total_h)}</div></div>
      <div><div class="k">Receiving differences</div><div class="v">${T.diff_lines ? `${T.diff_lines} line(s) · ${sar(T.diff_value_h)}` : 'None'}</div></div></div>
    ${r.orders.map((o) => `<div class="doc-sec"><div class="row" style="justify-content:space-between"><div><b>${fmtDate(o.order_date)}</b> · Order #${o.id} · ${srcTag(o.source_code, o.source_name)}${o.driver_name ? ` · ${esc(o.driver_name)}` : ''}</div>
      <div>${badge(o.status)} <b>${sar(o.value_h)}</b></div></div>
      <div class="tbl-wrap"><table class="t compact"><thead><tr><th>Code</th><th>Item</th><th>Unit</th><th class="num">Accepted</th><th class="num">Received</th><th class="num">Unit cost</th><th class="num">Value</th></tr></thead><tbody>
      ${o.lines.map((l) => `<tr><td class="code">${esc(l.item_code)}</td><td>${itemCell(l)}</td><td class="muted">${esc(l.unit || '')}</td><td class="num"><b>${l.accepted_quantity}</b></td>
        <td class="num ${l.received_quantity != null && l.received_quantity !== l.accepted_quantity ? 'neg' : ''}">${l.received_quantity ?? '—'}</td><td class="num">${sar(l.unit_cost_h)}</td><td class="num">${sar(l.value_h)}</td></tr>`).join('')}
      </tbody></table></div></div>`).join('') || '<div class="empty">No accepted orders in this month.</div>'}
    <table class="t doc-total"><tbody><tr><td>Warehouse</td><td class="num">${sar(T.wh_h)}</td></tr><tr><td>Factory</td><td class="num">${sar(T.fac_h)}</td></tr><tr><th>Total (SAR, at cost)</th><th class="num">${sar(T.total_h)}</th></tr></tbody></table>
    <div class="muted" style="margin-top:10px">Values use the item cost price effective on each order date. Generated ${fmtTime(r.generated_at)} by ${esc(state.me.name)}.</div>
  </div>`;
  wireExport(main, `statement-${r.branch.branch_name}-${r.month}`, () => [{
    name: r.branch.branch_name, title: `${r.company.company_name} — ${r.branch.branch_name} statement ${r.month} (SAR at cost)`,
    header: ['Date', 'Order', 'Source', 'Code', 'Item', 'Item (AR)', 'Unit', 'Accepted', 'Received', 'Unit cost', 'Value'],
    rows: r.orders.flatMap((o) => o.lines.map((l) => [o.order_date, o.id, srcLabel(o.source_code, o.source_name), l.item_code, l.item_name, l.item_name_ar || '', l.unit || '', l.accepted_quantity, l.received_quantity ?? '', sarNum(l.unit_cost_h), sarNum(l.value_h)])),
    footer: [['Warehouse', '', '', '', '', '', '', '', '', '', sarNum(T.wh_h)], ['Factory', '', '', '', '', '', '', '', '', '', sarNum(T.fac_h)], ['Total', '', '', '', '', '', '', '', '', '', sarNum(T.total_h)]],
  }]);
}

// ───────────────────────── stock value ─────────────────────────
async function StockValue(main, _p, query) {
  const srcs = await sources();
  const f = { date: query.date || state.me.today, source: query.source || '', all: query.all || '' };
  const r = await GET('/api/finance/stock-value?' + qs({ date: f.date, source: f.source }));
  const rows = f.all ? r.items : r.items.filter((i) => i.quantity !== 0);
  main.innerHTML = head('Stock Value', `Quantity on hand at end of ${fmtDate(r.date)} × cost price`, exportBtns()) + `<div class="stack">
    ${filterForm('vf', `<label class="f">On date<input class="input" type="date" name="date" value="${f.date}" max="${state.me.today}" required></label>${srcSelect(srcs, f.source)}
      <label class="f row" style="align-self:end"><input type="checkbox" name="all" value="1" ${f.all ? 'checked' : ''}> Include zero stock</label>`)}
    ${r.missing_costs ? `<div class="note warn">${r.missing_costs} item(s) with stock have no cost price — they are valued at 0. <a href="#/costs?missing=1">Set item costs</a></div>` : ''}
    <div class="grid2">${r.by_source.map((s) => `<div class="card"><div class="card-h"><h2>${srcTag(s.source_code, s.source_name)}</h2><b>SAR ${sar(s.value_h)}</b></div>
      <table class="t compact"><tbody>${Object.entries(s.categories).filter(([, v]) => v).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${sar(v)}</td></tr>`).join('') || '<tr><td class="empty">No value</td></tr>'}</tbody></table></div>`).join('')}</div>
    <div class="card card-b summary"><div><div class="k">Total stock value</div><div class="v">SAR ${sar(r.total_value_h)}</div></div><div><div class="k">Items listed</div><div class="v">${rows.length}</div></div></div>
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Code</th><th>Item</th><th>From</th><th>Category</th><th class="num">Quantity</th><th class="num">Unit cost</th><th class="num">Value</th></tr></thead>
      <tbody>${rows.map((i) => `<tr><td class="code">${esc(i.item_code)}</td><td>${itemCell(i)}</td><td>${srcTag(i.source_code, i.source_name)}</td><td class="muted">${esc(i.category)}</td>
        <td class="num ${i.quantity < 0 ? 'neg' : ''}"><b>${n0(i.quantity)}</b></td><td class="num">${i.unit_cost_h == null ? '<span class="neg">no cost</span>' : sar(i.unit_cost_h)}</td><td class="num">${sar(i.value_h)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No stock.</td></tr>'}</tbody>
      <tfoot><tr><td></td><td>Total</td><td></td><td></td><td></td><td></td><td class="num">${sar(r.total_value_h)}</td></tr></tfoot></table></div></div></div>`;
  onFilter(main, 'vf', '#/stock-value');
  wireExport(main, `stock-value-${r.date}`, () => [{
    name: 'Stock value', title: `Stock value at end of ${r.date} (SAR)`,
    header: ['Code', 'Item', 'Item (AR)', 'Source', 'Category', 'Unit', 'Quantity', 'Unit cost', 'Value'],
    rows: rows.map((i) => [i.item_code, i.item_name, i.item_name_ar || '', srcLabel(i.source_code, i.source_name), i.category, i.unit || '', i.quantity, sarNum(i.unit_cost_h), sarNum(i.value_h)]),
    footer: [['Total', '', '', '', '', '', '', '', sarNum(r.total_value_h)]],
  }]);
}

// ───────────────────────── item costs ─────────────────────────
async function ItemCosts(main, _p, query) {
  const srcs = await sources();
  const list = await GET('/api/finance/costs');
  const acc = isAcc();
  const f = { source: query.source || '', q: query.q || '', missing: query.missing || '' };
  const qq = f.q.toLowerCase();
  const rows = list.filter((i) => (!f.source || String(srcs.find((s) => s.code === i.source_code)?.id) === f.source)
    && (!qq || `${i.item_code} ${i.item_name} ${i.item_name_ar || ''}`.toLowerCase().includes(qq))
    && (!f.missing || i.unit_cost_h == null));
  const missing = list.filter((i) => i.unit_cost_h == null).length;
  main.innerHTML = head('Item Costs', 'Standard cost price per unit (SAR). A new price applies from its start date — history is kept.', exportBtns(false)) + `<div class="stack">
    ${filterForm('cf', `${srcSelect(srcs, f.source, 'All')}<label class="f grow">Search<input class="input" name="q" value="${esc(f.q)}" placeholder="Code or name"></label>
      <label class="f row" style="align-self:end"><input type="checkbox" name="missing" value="1" ${f.missing ? 'checked' : ''}> Only items without a cost (${missing})</label>`)}
    ${acc ? `<div class="card card-b filters">
      <label class="f">New prices start on<input class="input" type="date" id="eff" value="${state.me.today}"></label>
      <label class="f grow">Note (optional)<input class="input" id="cnote" placeholder="e.g. Supplier price list Sept 2026"></label>
      <button class="btn" id="fill">Fill blanks with last purchase price</button></div>` : ''}
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Code</th><th>Item</th><th>From</th><th>Unit</th><th class="num">Current cost</th><th>Since</th><th class="num">Last purchase</th>${acc ? '<th class="num">New cost</th>' : ''}<th></th></tr></thead>
      <tbody>${rows.map((i) => `<tr data-id="${i.id}"><td class="code">${esc(i.item_code)}</td><td>${itemCell(i)}</td><td>${srcTag(i.source_code, i.source_name)}</td><td class="muted">${esc(i.unit || '')}</td>
        <td class="num">${i.unit_cost_h == null ? '<span class="neg">not set</span>' : `<b>${sar(i.unit_cost_h)}</b>`}${i.next_cost_h != null ? `<div class="muted">→ ${sar(i.next_cost_h)} from ${fmtDate(i.next_cost_from)}</div>` : ''}</td>
        <td class="muted">${fmtDate(i.cost_from)}</td>
        <td class="num">${i.last_purchase_h == null ? '—' : sar(i.last_purchase_h)}${i.last_purchase_h != null && i.unit_cost_h != null && Math.abs(i.last_purchase_h - i.unit_cost_h) > i.unit_cost_h * 0.05 ? ' <span class="badge b-REORDER" title="Differs from the cost price by more than 5%">≠</span>' : ''}</td>
        ${acc ? `<td class="num"><input class="money" inputmode="decimal" placeholder="0.00" data-last="${sarIn(i.last_purchase_h)}"></td>` : ''}
        <td><button class="btn sm ghost hist">History</button></td></tr>`).join('') || `<tr><td colspan="${acc ? 9 : 8}" class="empty">No items match.</td></tr>`}</tbody></table></div></div>
    ${acc ? '<div class="actionbar"><div class="grow" id="csum"></div><button class="btn primary lg" id="csave" disabled>Save new costs</button></div>' : ''}</div>`;
  onFilter(main, 'cf', '#/costs');
  const read = () => {
    const lines = []; let bad = 0;
    for (const inp of $$('input.money', main)) {
      const v = parseSar(inp.value);
      inp.classList.toggle('err', Number.isNaN(v));
      if (Number.isNaN(v)) bad++; else if (v !== null) lines.push({ item_id: Number(inp.closest('tr').dataset.id), unit_cost: inp.value.trim() });
    }
    if (acc) {
      $('#csum', main).innerHTML = bad ? '<span class="note bad">Use numbers like 12.50</span>' : `<b>${lines.length}</b> new price(s)`;
      $('#csave', main).disabled = !!bad || !lines.length;
    }
    return lines;
  };
  main.addEventListener('input', (e) => { if (e.target.matches('input.money')) { state.dirty = true; read(); } });
  main.addEventListener('click', async (e) => {
    if (!e.target.matches('.hist')) return;
    const tr = e.target.closest('tr');
    const it = list.find((i) => i.id === Number(tr.dataset.id));
    const h = await GET('/api/finance/costs/' + it.id);
    modal({ title: `${it.item_code} · ${it.item_name}`, ok: 'Close', cancel: null,
      body: h.length ? `<table class="t compact"><thead><tr><th>From</th><th class="num">Cost</th><th>Note</th><th>By</th></tr></thead><tbody>${h.map((c) => `<tr><td>${fmtDate(c.effective_from)}</td><td class="num"><b>${sar(c.unit_cost_h)}</b></td><td>${esc(c.note || '')}</td><td class="muted">${esc(c.created_by_name)}<div>${fmtTime(c.created_at)}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No cost set yet.</div>' });
  });
  if (acc) {
    $('#fill', main).onclick = () => {
      let n = 0;
      for (const inp of $$('input.money', main)) if (!inp.value && inp.dataset.last) { inp.value = inp.dataset.last; n++; }
      toast(n ? `${n} price(s) filled — review, then save` : 'No purchase prices to copy');
      read();
    };
    $('#csave', main).onclick = async (e) => {
      const lines = read();
      const eff = $('#eff', main).value;
      if (!(await modal({ title: `Save ${lines.length} new cost price(s)?`, body: `They apply to orders and stock from <b>${fmtDate(eff)}</b>. Earlier figures keep their old cost.`, ok: 'Save costs' }))) return;
      await busy(e.target, async () => {
        const r = await api('POST', '/api/finance/costs', { effective_from: eff, note: $('#cnote', main).value, lines });
        state.dirty = false; toast(r.saved ? `${r.saved} cost price(s) saved` : 'Nothing changed'); router();
      });
    };
  }
  wireExport(main, `item-costs-${state.me.today}`, () => [{
    name: 'Item costs', title: `Item cost prices on ${state.me.today} (SAR)`,
    header: ['Code', 'Item', 'Item (AR)', 'Source', 'Category', 'Unit', 'Cost', 'Since', 'Last purchase', 'Next cost', 'Next from'],
    rows: rows.map((i) => [i.item_code, i.item_name, i.item_name_ar || '', srcLabel(i.source_code, i.source_name), i.category, i.unit || '', sarNum(i.unit_cost_h), i.cost_from || '', sarNum(i.last_purchase_h), sarNum(i.next_cost_h), i.next_cost_from || '']),
  }]);
}

// ───────────────────────── supplier invoices ─────────────────────────
async function Invoices(main, _p, query) {
  const [srcs, sups] = await Promise.all([sources(), GET('/api/finance/suppliers')]);
  const t = state.me.today;
  const f = { from: query.from || addDays(t, -60), to: query.to || t, supplier_id: query.supplier_id || '', source: query.source || '', status: query.status || '' };
  const r = await GET('/api/finance/invoices?' + qs(f));
  const stOpts = [['', 'All'], ['INCOMPLETE,TO_CHECK', 'Needs checking'], ['INCOMPLETE', 'Needs details'], ['TO_CHECK', 'To check'], ['MATCHED', 'Checked'], ['IN_REQUEST', 'In payment request'], ['PAID', 'Paid']];
  main.innerHTML = head('Supplier Invoices', 'Goods received from suppliers — add the invoice number and prices, then check them against the invoice', exportBtns(false)) + `<div class="stack">
    ${filterForm('if', `<label class="f">From<input class="input" type="date" name="from" value="${f.from}"></label><label class="f">To<input class="input" type="date" name="to" value="${f.to}"></label>
      <label class="f">Supplier<select class="input" name="supplier_id">${opt('', 'All', f.supplier_id)}${sups.map((s) => opt(s.id, s.supplier_name, f.supplier_id)).join('')}</select></label>${srcSelect(srcs, f.source, 'All')}
      <label class="f">Status<select class="input" name="status">${stOpts.map(([v, l]) => opt(v, l, f.status)).join('')}</select></label>`)}
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Received</th><th>Supplier</th><th>Invoice no.</th><th>For</th><th>Status</th><th class="num">Amount (SAR)</th><th>Request</th></tr></thead>
      <tbody>${r.receipts.map((x) => `<tr class="click" data-href="#/invoices/${x.id}"><td>${fmtDate(x.received_date)}<div class="muted">#${x.id}</div></td><td><b>${esc(x.supplier_name)}</b><div class="muted">by ${esc(x.received_by_name)}</div></td>
        <td>${x.invoice_no ? esc(x.invoice_no) : '<span class="neg">missing</span>'}</td><td>${srcTag(x.source_code, x.source_name)}</td><td>${invBadge(x.state)}</td>
        <td class="num">${x.unpriced ? `<span class="neg">${x.unpriced} line(s) unpriced</span>${x.total_h ? `<div>${sar(x.total_h)}</div>` : ''}` : `<b>${sar(x.total_h)}</b>`}</td>
        <td>${x.request_number ? `<a href="#/requests/${x.request_id}">${esc(x.request_number)}</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No receipts in this period.</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-h"><h2>Totals by supplier and month</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Month</th><th>Supplier</th><th class="num">Receipts</th><th class="num">Amount (SAR)</th><th></th></tr></thead>
      <tbody>${r.by_supplier_month.map((s) => `<tr><td>${monthName(s.month)}</td><td><b>${esc(s.supplier_name)}</b></td><td class="num">${s.receipts}</td><td class="num"><b>${sar(s.total_h)}</b></td><td>${s.unpriced ? `<span class="neg">${s.unpriced} not fully priced</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">—</td></tr>'}</tbody></table></div></div></div>`;
  onFilter(main, 'if', '#/invoices');
  clickRows(main);
  wireExport(main, `supplier-invoices-${r.from}-to-${r.to}`, () => [
    { name: 'Receipts', title: `Supplier receipts ${r.from} to ${r.to} (SAR)`, header: ['Received', 'Receipt #', 'Supplier', 'Invoice no.', 'For', 'Status', 'Amount', 'Unpriced lines', 'Payment request'],
      rows: r.receipts.map((x) => [x.received_date, x.id, x.supplier_name, x.invoice_no || '', srcLabel(x.source_code, x.source_name), INV_STATE[x.state]?.[0] || x.state, sarNum(x.total_h), x.unpriced, x.request_number || '']) },
    { name: 'By supplier', header: ['Month', 'Supplier', 'Receipts', 'Amount'], rows: r.by_supplier_month.map((s) => [s.month, s.supplier_name, s.receipts, sarNum(s.total_h)]) },
  ]);
}

async function InvoiceDetail(main, { id }) {
  const r = await GET('/api/finance/invoices/' + id);
  const state_ = r.request_status === 'PAID' ? 'PAID' : r.request_status ? 'IN_REQUEST' : r.matched_at ? 'MATCHED' : r.unpriced || !r.invoice_no ? 'INCOMPLETE' : 'TO_CHECK';
  const editable = isAcc() && !r.matched_at && !r.request_status;
  main.innerHTML = head(`Receipt #${r.id} · ${esc(r.supplier_name)}`, `${fmtDate(r.received_date)} · received by ${esc(r.received_by_name)} · ${srcTag(r.source_code, r.source_name)}`,
    '<a class="btn" href="javascript:history.back()">Back</a>') + `<div class="stack">
    <div class="card card-b summary"><div><div class="k">Status</div><div class="v">${invBadge(state_)}</div></div>
      <div><div class="k">Invoice no.</div><div class="v">${editable ? `<input class="input" id="invno" value="${esc(r.invoice_no || '')}" placeholder="Supplier invoice number">` : esc(r.invoice_no || '—')}</div></div>
      <div><div class="k">Amount (SAR)</div><div class="v" id="tot">${sar(r.total_h)}</div></div>
      ${r.request_number ? `<div><div class="k">Payment request</div><div class="v"><a href="#/requests/${r.request_id}">${esc(r.request_number)}</a></div></div>` : ''}
      ${r.matched_at ? `<div><div class="k">Checked</div><div class="v" style="font-size:14px">${esc(r.matched_by_name)} · ${fmtTime(r.matched_at)}${r.match_note ? `<div class="muted">${esc(r.match_note)}</div>` : ''}</div></div>` : ''}</div>
    ${r.notes ? `<div class="note">Receiving note: ${esc(r.notes)}</div>` : ''}
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Code</th><th>Item</th><th>Unit</th><th class="num">Qty received</th><th class="num">Unit price</th><th class="num">Amount</th><th class="num">Cost price</th></tr></thead>
      <tbody>${r.lines.map((l) => `<tr data-item="${l.item_id}" data-q="${l.quantity}"><td class="code">${esc(l.item_code)}</td><td>${itemCell(l)}</td><td class="muted">${esc(l.unit || '')}</td><td class="num"><b>${l.quantity}</b></td>
        <td class="num">${editable ? `<input class="money" inputmode="decimal" value="${sarIn(l.unit_cost_h)}" placeholder="0.00">` : l.unit_cost_h == null ? '<span class="neg">—</span>' : sar(l.unit_cost_h)}</td>
        <td class="num amt">${l.unit_cost_h == null ? '—' : sar(l.unit_cost_h * l.quantity)}</td>
        <td class="num muted">${sar(l.standard_cost_h)}${l.standard_cost_h != null && l.unit_cost_h != null && Math.abs(l.unit_cost_h - l.standard_cost_h) > l.standard_cost_h * 0.05 ? ' <span class="badge b-REORDER" title="More than 5% from cost price">≠</span>' : ''}</td></tr>`).join('')}</tbody>
      </table></div></div>
    ${isAcc() ? `<div class="actionbar"><div class="grow" id="isum">${r.request_status ? `In ${esc(r.request_number)} — ${r.request_status === 'PAID' ? 'paid' : 'cancel or reject that request to change it'}` : r.matched_at ? 'Checked. Remove the check to edit.' : 'Enter the invoice number and every unit price, save, then mark as checked.'}</div>
      ${editable ? '<button class="btn" id="isave">Save</button><button class="btn primary" id="icheck">Save & mark as checked</button>' : ''}
      ${r.matched_at && !r.request_status ? '<button class="btn" id="iuncheck">Remove check</button><a class="btn primary" href="#/requests/new?supplier_id=' + r.supplier_id + '">Add to payment request</a>' : ''}</div>` : ''}
  </div>`;
  if (!editable) {
    const u = $('#iuncheck', main);
    if (u) u.onclick = (e) => busy(e.target, async () => { await api('POST', `/api/finance/invoices/${r.id}/check`, { matched: false }); toast('Check removed'); router(); });
    return;
  }
  const read = () => {
    let tot = 0, bad = 0;
    for (const tr of $$('tbody tr[data-item]', main)) {
      const inp = $('input.money', tr);
      const v = parseSar(inp.value);
      inp.classList.toggle('err', Number.isNaN(v));
      if (Number.isNaN(v)) { bad++; continue; }
      $('.amt', tr).textContent = v == null ? '—' : sar(v * Number(tr.dataset.q));
      tot += (v || 0) * Number(tr.dataset.q);
    }
    $('#tot', main).textContent = sar(tot);
    return bad;
  };
  main.addEventListener('input', () => { state.dirty = true; read(); });
  const save = async () => {
    if (read()) throw new Error('Use numbers like 12.50 for prices');
    await api('PUT', '/api/finance/invoices/' + r.id, { invoice_no: $('#invno', main).value,
      lines: $$('tbody tr[data-item]', main).map((tr) => ({ item_id: Number(tr.dataset.item), unit_price: $('input.money', tr).value.trim() })) });
    state.dirty = false;
  };
  $('#isave', main).onclick = (e) => busy(e.target, async () => { await save(); toast('Saved'); router(); });
  $('#icheck', main).onclick = async (e) => {
    const note = await formModal({ title: 'Mark invoice as checked', ok: 'Mark as checked', note: '<p>Confirm the supplier invoice matches the quantities received and the prices entered.</p>',
      fields: [{ name: 'note', label: 'Note (optional)', full: true }] });
    if (!note) return;
    await busy(e.target, async () => { await save(); await api('POST', `/api/finance/invoices/${r.id}/check`, { matched: true, note: note.note }); toast('Invoice checked'); router(); });
  };
}

// ───────────────────────── payment requests ─────────────────────────
async function Requests(main, _p, query) {
  const st = query.status ?? (isCfo() ? 'SUBMITTED' : '');
  const list = await GET('/api/finance/requests?' + qs({ status: st }));
  const tabs = [['', 'All'], ['SUBMITTED', 'Waiting for CFO'], ['APPROVED', 'Approved'], ['PAID', 'Paid'], ['REJECTED', 'Returned']];
  main.innerHTML = head('Payment Requests', isCfo() ? 'Supplier payments sent by accounts for your approval' : 'Combine checked supplier invoices and send them to the CFO for payment',
    (isAcc() ? '<a class="btn primary" href="#/requests/new">New payment request</a>' : '') + exportBtns(false)) + `<div class="stack">
    <div class="seg no-print">${tabs.map(([v, l]) => `<a href="#/requests?status=${v}" class="${v === st ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Request</th><th>Supplier</th><th>Status</th><th class="num">Invoices</th><th class="num">Total SAR</th><th>Due</th><th>Sent</th></tr></thead>
      <tbody>${list.map((p) => `<tr class="click" data-href="#/requests/${p.id}"><td><b>${esc(p.number)}</b></td><td>${esc(p.supplier_name)}</td><td>${prBadge(p.status)}${p.status === 'PAID' ? `<div class="muted">${fmtDate(p.paid_date)} · ${esc(p.payment_ref || '')}</div>${p.paid_from ? `<div class="muted">${esc(p.paid_from)}</div>` : ''}` : ''}</td>
        <td class="num">${p.invoices}</td><td class="num"><b>${sar(p.total_h)}</b></td>
        <td class="${p.due_date && p.due_date < state.me.today && ['SUBMITTED', 'APPROVED'].includes(p.status) ? 'neg' : ''}">${fmtDate(p.due_date)}</td><td class="muted">${fmtTime(p.created_at)}<div>${esc(p.created_by_name)}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No payment requests.</td></tr>'}</tbody>
      ${list.length ? `<tfoot><tr><td>Total</td><td></td><td></td><td></td><td class="num">${sar(list.reduce((a, p) => a + p.total_h, 0))}</td><td></td><td></td></tr></tfoot>` : ''}</table></div></div></div>`;
  clickRows(main);
  wireExport(main, `payment-requests-${state.me.today}`, () => [{ name: 'Payment requests', header: ['Request', 'Supplier', 'Status', 'Invoices', 'Subtotal', 'VAT', 'Total', 'Due', 'Sent', 'Paid on', 'Paid from', 'Payment ref'],
    rows: list.map((p) => [p.number, p.supplier_name, PR_STATE[p.status]?.[0] || p.status, p.invoices, sarNum(p.subtotal_h), sarNum(p.vat_h), sarNum(p.total_h), p.due_date || '', p.created_at.slice(0, 10), p.paid_date || '', p.paid_from || '', p.payment_ref || '']) }]);
}

async function NewRequest(main, _p, query) {
  const [sups, company] = await Promise.all([GET('/api/finance/suppliers'), GET('/api/finance/company')]);
  const sid = query.supplier_id || '';
  const sup = sups.find((s) => String(s.id) === sid);
  main.innerHTML = head('New Payment Request', 'Pick a supplier, tick the checked invoices to pay together, and send to the CFO') + `<div class="stack">
    <div class="card card-b filters"><label class="f grow">Supplier<select class="input" id="psup">${opt('', 'Select supplier ▾', sid)}${sups.filter((s) => s.active).map((s) => opt(s.id, s.supplier_name, sid)).join('')}</select></label></div>
    <div id="pbody"></div></div>`;
  $('#psup', main).onchange = (e) => { location.hash = '#/requests/new?' + qs({ supplier_id: e.target.value }); };
  if (!sup) { $('#pbody', main).innerHTML = '<div class="card empty">Select a supplier to see their invoices.</div>'; return; }
  const [rec, jobs] = await Promise.all([GET('/api/finance/payable?supplier_id=' + sup.id), GET('/api/finance/payable-jobs?supplier_id=' + sup.id)]);
  const due = sup.payment_terms_days != null ? addDays(state.me.today, sup.payment_terms_days) : '';
  const rate = company.vat_rate_bp / 100;
  $('#pbody', main).innerHTML = `
    ${!sup.iban ? `<div class="note warn">No IBAN saved for ${esc(sup.supplier_name)}. <a href="#/settings">Add bank details</a> so the CFO can pay.</div>` : ''}
    <div class="card"><div class="card-h"><h2>Invoices not yet requested</h2><button class="btn sm" id="pall">Select all ready</button></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th></th><th>Received</th><th>Invoice no.</th><th>For</th><th>Status</th><th class="num">Amount SAR</th></tr></thead>
      <tbody>${rec.map((x) => `<tr><td><input type="checkbox" class="pick" data-kind="r" value="${x.id}" data-amt="${x.total_h || 0}" ${x.ready ? '' : 'disabled'}></td>
        <td>${fmtDate(x.received_date)} <a class="muted" href="#/invoices/${x.id}">#${x.id}</a></td><td>${esc(x.invoice_no || '—')}</td><td>${srcTag(x.source_code, x.source_name)}</td>
        <td>${x.ready ? invBadge('MATCHED') : `<a href="#/invoices/${x.id}">${invBadge(x.invoice_no && !x.unpriced ? 'TO_CHECK' : 'INCOMPLETE')}</a>`}</td><td class="num"><b>${sar(x.total_h)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No open goods invoices for this supplier.</td></tr>'}</tbody></table></div>
      <div class="card-b muted">Only checked invoices can be requested. Open an invoice to add its number and prices.</div></div>
    ${jobs.length ? `<div class="card"><div class="card-h"><h2>Maintenance bills (contractor)</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th></th><th>Job</th><th>Invoice no.</th><th>Work</th><th>Status</th><th class="num">Amount SAR</th></tr></thead>
      <tbody>${jobs.map((j) => `<tr><td><input type="checkbox" class="pick" data-kind="j" value="${j.id}" data-amt="${j.cost_h || 0}" ${j.ready ? '' : 'disabled'}></td>
        <td><a href="#/maintenance/${j.id}">${esc(j.number)}</a><div class="muted">${j.done_at ? fmtDate(j.done_at.slice(0, 10)) : ''}</div></td><td>${esc(j.invoice_no || '—')}</td>
        <td>${esc(j.title)}<div class="muted">${esc(j.location_name)}</div></td><td><a href="#/maintenance/${j.id}">${billBadge(j.bill_state)}</a></td><td class="num"><b>${sar(j.cost_h)}</b></td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="card card-b filters">
      <label class="f row" style="align-self:end"><input type="checkbox" id="pvat" checked> Add VAT ${rate}%</label>
      <label class="f">Due date<input class="input" type="date" id="pdue" value="${due}"></label>
      <label class="f grow">Note to CFO<input class="input" id="pnote" placeholder="Optional"></label></div>
    <div class="actionbar"><div class="grow" id="ptot"></div><button class="btn primary lg" id="psend" disabled>Send to CFO</button></div>`;
  const calc = () => {
    const picked = $$('.pick:checked', main);
    const sub = picked.reduce((a, c) => a + Number(c.dataset.amt), 0);
    const vat = $('#pvat', main).checked ? Math.round((sub * company.vat_rate_bp) / 10000) : 0;
    $('#ptot', main).innerHTML = `<b>${picked.length}</b> invoice(s) · Subtotal ${sar(sub)} · VAT ${sar(vat)} · <b>Total SAR ${sar(sub + vat)}</b>`;
    $('#psend', main).disabled = !picked.length;
    return { ids: picked.filter((c) => c.dataset.kind === 'r').map((c) => Number(c.value)), jids: picked.filter((c) => c.dataset.kind === 'j').map((c) => Number(c.value)), total: sub + vat };
  };
  main.addEventListener('change', calc);
  $('#pall', main).onclick = () => { $$('.pick:not(:disabled)', main).forEach((c) => { c.checked = true; }); calc(); };
  $('#psend', main).onclick = async (e) => {
    const { ids, jids, total } = calc();
    if (!(await modal({ title: `Send ${ids.length + jids.length} invoice(s) to the CFO?`, body: `${esc(sup.supplier_name)} — <b>SAR ${sar(total)}</b>`, ok: 'Send to CFO' }))) return;
    await busy(e.target, async () => {
      const pr = await api('POST', '/api/finance/requests', { supplier_id: sup.id, receipt_ids: ids, job_ids: jids, add_vat: $('#pvat', main).checked, due_date: $('#pdue', main).value || null, notes: $('#pnote', main).value });
      toast(`${pr.number} sent to the CFO`); location.hash = '#/requests/' + pr.id;
    });
  };
  calc();
}

async function RequestDetail(main, { id }) {
  const p = await GET('/api/finance/requests/' + id);
  const c = p.company, s = p.supplier;
  const acts = [];
  if (isCfo() && p.status === 'SUBMITTED') acts.push('<button class="btn primary" id="ap">Approve</button>', '<button class="btn danger" id="rj">Return to accounts</button>');
  if (isCfo() && p.status === 'APPROVED') acts.push('<button class="btn primary" id="pd">Mark as paid</button>', '<button class="btn danger" id="rj">Return to accounts</button>');
  if (isAcc() && p.status === 'SUBMITTED') acts.push('<button class="btn danger" id="cx">Cancel request</button>');
  const qtyTotal = p.receipts.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.quantity, 0), 0);
  p.jobs = p.jobs || [];
  main.innerHTML = head(esc(p.number), `${esc(s.supplier_name)} · ${prBadge(p.status)}`, '<a class="btn" href="#/requests">All requests</a><button class="btn" data-xlsx>Excel</button><button class="btn" data-print>Print / PDF</button>') + `<div class="stack">
    ${p.status === 'REJECTED' ? `<div class="note bad">Returned by ${esc(p.rejected_by_name)} on ${fmtTime(p.rejected_at)}: ${esc(p.reject_reason)}. The invoices are free to be requested again.</div>` : ''}
    ${acts.length ? `<div class="card card-b row no-print"><div class="grow">${isCfo() ? (p.status === 'SUBMITTED' ? 'Review the invoices below, then approve or return.' : 'Approved. After the bank transfer, record the payment reference.') : 'Waiting for the CFO.'}</div>${acts.join('')}</div>` : ''}
    <div class="card card-b doc">
      ${docHead(c, 'Payment Request', `<div><b>${esc(p.number)}</b></div><div>Date ${fmtDate(p.created_at.slice(0, 10))}</div>${p.due_date ? `<div>Due ${fmtDate(p.due_date)}</div>` : ''}<div>${prBadge(p.status)}</div>`)}
      <div class="grid2 doc-parties">
        <div><div class="k">Pay to</div><b>${esc(s.supplier_name)}</b>
          ${s.contact_name ? `<div>${esc(s.contact_name)}</div>` : ''}${s.address ? `<div>${esc(s.address)}</div>` : ''}
          <div class="muted">${[s.phone, s.email].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="muted">${s.cr_number ? `CR ${esc(s.cr_number)}` : ''} ${s.vat_number ? `· VAT ${esc(s.vat_number)}` : ''}</div></div>
        <div><div class="k">Bank details</div>
          ${s.iban ? `<div>${esc(s.bank_name || '')}</div><div class="iban">${esc(s.iban.replace(/(.{4})/g, '$1 ').trim())}</div>` : '<div class="neg">No IBAN on file</div>'}
          ${s.payment_terms_days != null ? `<div class="muted">Terms: ${s.payment_terms_days} days</div>` : ''}</div></div>
      <table class="t compact" style="margin-top:14px"><thead><tr><th>Received</th><th>Supplier invoice</th><th>Reference</th><th>For</th><th class="num">Amount SAR</th></tr></thead><tbody>
        ${p.receipts.map((r) => `<tr><td>${fmtDate(r.received_date)}</td><td><b>${esc(r.invoice_no || '—')}</b></td><td>#${r.id} · ${esc(r.received_by_name)}</td><td>${srcTag(r.source_code, r.source_name)}</td><td class="num">${sar(r.amount_h)}</td></tr>`).join('')}
        ${p.jobs.map((j) => `<tr><td>${j.done_at ? fmtDate(j.done_at.slice(0, 10)) : '—'}</td><td><b>${esc(j.invoice_no || '—')}</b></td><td><a href="#/maintenance/${j.id}">${esc(j.number)}</a> · maintenance</td><td>${esc(j.location_name)}</td><td class="num">${sar(j.amount_h)}</td></tr>`).join('')}
      </tbody></table>
      ${p.jobs.length ? `<h3 style="margin:18px 0 6px">Maintenance work</h3><table class="t compact"><thead><tr><th>Job</th><th>Work</th><th>Where</th><th>Done</th><th class="num">Amount</th></tr></thead><tbody>
        ${p.jobs.map((j) => `<tr><td><b>${esc(j.number)}</b><div class="muted">Invoice ${esc(j.invoice_no || '—')}</div></td><td>${esc(j.title)}<div class="muted">${esc(j.category_label)}${j.work_note ? ` · ${esc(j.work_note)}` : ''}</div></td>
          <td>${esc(j.location_name)}${j.asset_name ? `<div class="muted">${esc(j.asset_name)}${j.asset_tag ? ` · ${esc(j.asset_tag)}` : ''}</div>` : ''}</td><td>${j.done_at ? fmtDate(j.done_at.slice(0, 10)) : '—'}</td><td class="num">${sar(j.amount_h)}</td></tr>`).join('')}
      </tbody></table>` : ''}
      ${p.receipts.length ? '<h3 style="margin:18px 0 6px">Products received</h3>' : ''}
      ${p.receipts.map((r) => `<div class="doc-sec"><div class="muted">Invoice <b>${esc(r.invoice_no || '—')}</b> · received ${fmtDate(r.received_date)}</div>
        <table class="t compact"><thead><tr><th>Code</th><th>Item</th><th>Unit</th><th class="num">Qty received</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>
        ${r.lines.map((l) => `<tr><td class="code">${esc(l.item_code)}</td><td>${itemCell(l)}</td><td class="muted">${esc(l.unit || '')}</td><td class="num"><b>${l.quantity}</b></td><td class="num">${sar(l.unit_cost_h)}</td><td class="num">${sar(l.amount_h)}</td></tr>`).join('')}
        </tbody></table></div>`).join('')}
      <table class="t doc-total"><tbody>
        <tr><td>Invoices</td><td class="num">${p.receipts.length + p.jobs.length}</td></tr>${p.receipts.length ? `<tr><td>Units received</td><td class="num">${n0(qtyTotal)}</td></tr>` : ''}
        <tr><td>Subtotal</td><td class="num">${sar(p.subtotal_h)}</td></tr>
        <tr><td>VAT ${p.add_vat ? `${p.vat_rate_bp / 100}%` : '(not added)'}</td><td class="num">${sar(p.vat_h)}</td></tr>
        <tr><th>Total to pay (SAR)</th><th class="num">${sar(p.total_h)}</th></tr></tbody></table>
      ${p.notes ? `<div class="note" style="margin-top:12px">Note: ${esc(p.notes)}</div>` : ''}
      <div class="signs">
        <div><div class="k">Prepared by (Accounts)</div><b>${esc(p.created_by_name)}</b><div class="muted">${fmtTime(p.created_at)}</div></div>
        <div><div class="k">Approved by (CFO)</div>${p.approved_at ? `<b>${esc(p.approved_by_name)}</b><div class="muted">${fmtTime(p.approved_at)}</div>` : '<div class="sign-line"></div>'}</div>
        <div><div class="k">Paid</div>${p.status === 'PAID' ? `<b>${fmtDate(p.paid_date)}</b><div>From ${esc(p.paid_from || '—')}</div><div class="muted">Ref ${esc(p.payment_ref)} · ${esc(p.paid_by_name)}</div>` : '<div class="sign-line"></div>'}</div></div>
    </div>
    <div class="card no-print"><div class="card-h"><h2>History</h2></div><table class="t compact"><tbody>
      ${p.history.map((h) => `<tr><td class="muted" style="white-space:nowrap">${fmtTime(h.at)}</td><td>${esc(h.user_name || '')}</td><td>${esc(h.summary)}</td></tr>`).join('')}</tbody></table></div>
  </div>`;
  const act = (sel, fn) => { const b = $(sel, main); if (b) b.onclick = (e) => fn(e.target); };
  const go = (b, path, body, msg) => busy(b, async () => { await api('POST', `/api/finance/requests/${p.id}/${path}`, body); toast(msg); router(); });
  act('#ap', async (b) => { if (await modal({ title: `Approve ${p.number}?`, body: `Pay <b>SAR ${sar(p.total_h)}</b> to ${esc(s.supplier_name)}.`, ok: 'Approve' })) go(b, 'approve', {}, 'Approved'); });
  act('#rj', async (b) => { const why = await modal({ title: `Return ${p.number} to accounts?`, input: 'Reason (required)', ok: 'Return', okClass: 'danger' }); if (why) go(b, 'reject', { reason: why }, 'Returned to accounts'); });
  act('#cx', async (b) => { if (await modal({ title: `Cancel ${p.number}?`, body: 'The invoices become free to request again.', ok: 'Cancel request', okClass: 'danger', cancel: 'Keep' })) go(b, 'cancel', {}, 'Request cancelled'); });
  act('#pd', async (b) => {
    const accts = c.bank_accounts || [];
    const v = await formModal({ title: `Record payment for ${p.number}`, ok: 'Mark as paid', note: `<p>SAR <b>${sar(p.total_h)}</b> to ${esc(s.supplier_name)}${s.iban ? ` · ${esc(s.iban)}` : ''}</p>${accts.length ? '' : '<p class="muted">Tip: accounts can save the company bank accounts in Company &amp; Suppliers so you can pick one here.</p>'}`,
      fields: [
        accts.length
          ? { name: 'paid_from', label: 'Paid from (our bank account)', full: true, required: true, value: accts.length === 1 ? acctLabel(accts[0]) : '', options: [['', 'Select bank account ▾'], ...accts.map((a) => [acctLabel(a), acctLabel(a)])] }
          : { name: 'paid_from', label: 'Paid from (our bank / account)', full: true, required: true, placeholder: 'e.g. Al Rajhi Bank · SA03…' },
        { name: 'paid_date', label: 'Payment date', type: 'date', value: state.me.today, required: true }, { name: 'payment_ref', label: 'Bank transfer reference', required: true }] });
    if (!v) return;
    if (!v.paid_from) { toast('Choose the bank account the payment was made from', true); return; }
    go(b, 'paid', v, 'Marked as paid');
  });
  wireExport(main, p.number, () => [{
    name: p.number, title: `${c.company_name} — Payment request ${p.number} — ${s.supplier_name}${s.iban ? ` — IBAN ${s.iban}` : ''}`,
    header: ['Received', 'Invoice no.', 'Code', 'Item', 'Item (AR)', 'Unit', 'Qty received', 'Unit price', 'Amount'],
    rows: [...p.receipts.flatMap((r) => r.lines.map((l) => [r.received_date, r.invoice_no || '', l.item_code, l.item_name, l.item_name_ar || '', l.unit || '', l.quantity, sarNum(l.unit_cost_h), sarNum(l.amount_h)])),
      ...p.jobs.map((j) => [j.done_at ? j.done_at.slice(0, 10) : '', j.invoice_no || '', j.number, `Maintenance: ${j.title}`, j.location_name, '', '', '', sarNum(j.amount_h)])],
    footer: [['Subtotal', '', '', '', '', '', qtyTotal, '', sarNum(p.subtotal_h)], ['VAT', '', '', '', '', '', '', '', sarNum(p.vat_h)], ['Total', '', '', '', '', '', '', '', sarNum(p.total_h)],
      ...(p.status === 'PAID' ? [[`Paid ${p.paid_date} from ${p.paid_from || '—'} · ref ${p.payment_ref}`]] : [])],
  }]);
}

// ───────────────────────── factory yield ─────────────────────────
async function Yield(main, _p, query) {
  const t = state.me.today;
  const f = { from: query.from || addDays(t, -30), to: query.to || t };
  const r = await GET('/api/finance/yield?' + qs(f));
  const T = r.totals;
  main.innerHTML = head('Factory Yield', 'What the factory produced from the raw chicken it used', exportBtns()) + `<div class="stack">
    ${filterForm('yf', `<label class="f">From<input class="input" type="date" name="from" value="${f.from}"></label><label class="f">To<input class="input" type="date" name="to" value="${f.to}"></label>`)}
    <div class="card card-b summary"><div><div class="k">Batches</div><div class="v">${r.batches.length}</div></div>
      <div><div class="k">Raw used</div><div class="v">${n0(T.used)}</div></div><div><div class="k">Produced</div><div class="v">${n0(T.produced)}</div></div>
      <div><div class="k">Produced per raw unit</div><div class="v">${T.per_raw_unit ?? '—'}</div></div>
      <div><div class="k">Raw cost</div><div class="v">${sar(T.input_value_h)}</div></div><div><div class="k">Output at cost</div><div class="v">${sar(T.output_value_h)}</div></div></div>
    <div class="grid2">
      <div class="card"><div class="card-h"><h2>Used</h2></div><table class="t compact"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Value</th></tr></thead><tbody>
        ${r.inputs.map((i) => `<tr><td><span class="code">${esc(i.item_code)}</span> ${esc(i.item_name)}</td><td class="num"><b>${n0(i.quantity)}</b></td><td class="num">${sar(i.value_h)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No production.</td></tr>'}</tbody></table></div>
      <div class="card"><div class="card-h"><h2>Produced</h2></div><table class="t compact"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Per raw unit</th><th class="num">Value</th></tr></thead><tbody>
        ${r.outputs.map((i) => `<tr><td><span class="code">${esc(i.item_code)}</span> ${esc(i.item_name)}</td><td class="num"><b>${n0(i.quantity)}</b></td><td class="num">${i.per_raw_unit ?? '—'}</td><td class="num">${sar(i.value_h)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">—</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-h"><h2>Batches</h2></div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Date</th><th>Batch</th><th>Used</th><th>Produced</th><th class="num">Per raw unit</th></tr></thead><tbody>
      ${r.batches.map((b) => `<tr><td>${fmtDate(b.production_date)}</td><td>#${b.id}<div class="muted">${esc(b.notes || '')} · ${esc(b.created_by_name)}</div></td>
        <td>${b.lines.filter((l) => l.direction < 0).map((l) => `<div>${esc(l.item_code)} ${esc(l.item_name)} — <b>${l.quantity}</b></div>`).join('')}</td>
        <td>${b.lines.filter((l) => l.direction > 0).map((l) => `<div>${esc(l.item_code)} ${esc(l.item_name)} — <b>${l.quantity}</b></div>`).join('')}</td><td class="num"><b>${b.per_unit ?? '—'}</b></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No batches.</td></tr>'}
      </tbody></table></div></div></div>`;
  onFilter(main, 'yf', '#/yield');
  wireExport(main, `factory-yield-${r.from}-to-${r.to}`, () => [
    { name: 'Produced', title: `Factory yield ${r.from} to ${r.to}`, header: ['Code', 'Item', 'Quantity', 'Per raw unit', 'Value'], rows: r.outputs.map((i) => [i.item_code, i.item_name, i.quantity, i.per_raw_unit ?? '', sarNum(i.value_h)]),
      footer: [['Total', '', T.produced, T.per_raw_unit ?? '', sarNum(T.output_value_h)]] },
    { name: 'Used', header: ['Code', 'Item', 'Quantity', 'Value'], rows: r.inputs.map((i) => [i.item_code, i.item_name, i.quantity, sarNum(i.value_h)]) },
    { name: 'Batches', header: ['Date', 'Batch', 'Direction', 'Code', 'Item', 'Quantity'], rows: r.batches.flatMap((b) => b.lines.map((l) => [b.production_date, b.id, l.direction < 0 ? 'Used' : 'Produced', l.item_code, l.item_name, l.quantity])) },
  ]);
}

// ───────────────────────── month-end ─────────────────────────
async function Periods(main) {
  const list = await GET('/api/finance/periods');
  main.innerHTML = head('Month-End', 'A closed month cannot be changed: no orders, receipts, counts, production, prices or costs dated in it') + `<div class="stack">
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Month</th><th>Status</th><th>Before closing</th><th>Closed / reopened</th><th></th></tr></thead><tbody>
      ${list.filter((p) => !p.future).map((p) => {
        const warn = [p.open_orders && `${p.open_orders} order(s) not accepted`, p.not_received && `${p.not_received} order(s) not received`, p.unchecked_invoices && `${p.unchecked_invoices} invoice(s) not checked`].filter(Boolean);
        return `<tr><td><b>${monthName(p.month)}</b>${p.current ? ' <span class="muted">(current)</span>' : ''}</td>
          <td>${p.locked ? '<span class="badge b-RECEIVED">Closed</span>' : '<span class="badge b-DRAFT">Open</span>'}</td>
          <td>${warn.length ? warn.map((w) => `<div class="neg">${w}</div>`).join('') : '<span class="muted">All clear</span>'}</td>
          <td class="muted">${p.locked_at ? `Closed by ${esc(p.locked_by_name)} · ${fmtTime(p.locked_at)}` : ''}${p.unlocked_at ? `<div>Reopened by ${esc(p.unlocked_by_name)} · ${fmtTime(p.unlocked_at)}: ${esc(p.unlock_reason)}</div>` : ''}</td>
          <td>${isAcc() ? (p.locked ? `<button class="btn sm" data-unlock="${p.month}">Reopen</button>` : `<button class="btn sm primary" data-lock="${p.month}" data-warn="${warn.length}">Close month</button>`) : ''}</td></tr>`;
      }).join('')}</tbody></table></div></div></div>`;
  main.addEventListener('click', async (e) => {
    const l = e.target.dataset.lock, u = e.target.dataset.unlock;
    if (l && await modal({ title: `Close ${monthName(l)}?`, ok: 'Close month', body: `${Number(e.target.dataset.warn) ? '<div class="note warn">This month still has open items (see the list).</div>' : ''}Nobody will be able to add or change anything dated in ${monthName(l)} until it is reopened.` })) {
      busy(e.target, async () => { await api('POST', '/api/finance/periods/lock', { month: l }); toast(`${monthName(l)} closed`); router(); });
    }
    if (u) {
      const why = await modal({ title: `Reopen ${monthName(u)}?`, input: 'Reason (required, kept in the change log)', ok: 'Reopen', okClass: 'danger' });
      if (why) busy(e.target, async () => { await api('POST', '/api/finance/periods/unlock', { month: u, reason: why }); toast(`${monthName(u)} reopened`); router(); });
    }
  });
}

// ───────────────────────── change log ─────────────────────────
const ACTION_LABEL = (a) => a.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
async function AuditLog(main, _p, query) {
  const t = state.me.today;
  const f = { from: query.from || addDays(t, -7), to: query.to || t, action: query.action || '', user_id: query.user_id || '', q: query.q || '' };
  const r = await GET('/api/finance/audit?' + qs(f));
  main.innerHTML = head('Change Log', 'Who changed what and when — entries cannot be edited or deleted', exportBtns(false)) + `<div class="stack">
    ${filterForm('af', `<label class="f">From<input class="input" type="date" name="from" value="${f.from}"></label><label class="f">To<input class="input" type="date" name="to" value="${f.to}"></label>
      <label class="f">Action<select class="input" name="action">${opt('', 'All', f.action)}${r.actions.map((a) => opt(a, ACTION_LABEL(a), f.action)).join('')}</select></label>
      <label class="f">User<select class="input" name="user_id">${opt('', 'All', f.user_id)}${r.users.map((u) => opt(u.id, u.name, f.user_id)).join('')}</select></label>
      <label class="f grow">Contains<input class="input" name="q" value="${esc(f.q)}" placeholder="e.g. W0001, Jish, PR-2026"></label>`)}
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
      ${r.entries.map((a) => `<tr><td class="muted" style="white-space:nowrap">${fmtTime(a.at)}</td><td>${esc(a.user_name || 'System')}<div class="muted">${esc(ROLE_LABEL[a.user_role] || '')}</div></td>
        <td><span class="badge">${esc(ACTION_LABEL(a.action))}</span></td><td>${esc(a.summary)}${a.entity === 'order' && a.entity_id ? ` <a href="#/orders/${a.entity_id}">open</a>` : a.entity === 'payment_request' ? ` <a href="#/requests/${a.entity_id}">open</a>` : a.entity === 'supplier_receipt' ? ` <a href="#/invoices/${a.entity_id}">open</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No changes in this period.</td></tr>'}
      </tbody></table></div>${r.entries.length >= 1000 ? '<div class="card-b muted">Showing the latest 1000 — narrow the filter.</div>' : ''}</div></div>`;
  onFilter(main, 'af', '#/audit');
  wireExport(main, `change-log-${r.from}-to-${r.to}`, () => [{ name: 'Change log', header: ['When', 'User', 'Role', 'Action', 'Details'],
    rows: r.entries.map((a) => [fmtTime(a.at), a.user_name || 'System', ROLE_LABEL[a.user_role] || '', ACTION_LABEL(a.action), a.summary]) }]);
}

// ───────────────────────── settings: company & suppliers ─────────────────────────
const bankRow = (a, edit) => (edit
  ? `<tr class="bacc"><td><input class="input bk" value="${esc(a.bank || '')}" placeholder="e.g. Al Rajhi Bank"></td><td><input class="input ib" value="${esc(a.iban || '')}" placeholder="SA…"></td><td><button type="button" class="btn sm ghost brm">Remove</button></td></tr>`
  : `<tr><td>${esc(a.bank)}</td><td class="iban">${esc(a.iban || '')}</td><td></td></tr>`);
async function Settings(main) {
  const [c, sups] = await Promise.all([GET('/api/finance/company'), GET('/api/finance/suppliers')]);
  const acc = isAcc();
  const F = [['company_name', 'Company name'], ['company_name_ar', 'Company name (Arabic)'], ['cr_number', 'CR number'], ['vat_number', 'VAT number'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address']];
  main.innerHTML = head('Company & Suppliers', 'Shown on statements and payment requests') + `<div class="stack">
    <form class="card" id="cof"><div class="card-h"><h2>Company</h2></div><div class="card-b form-grid">
      ${F.map(([k, l]) => `<label class="f ${k === 'address' ? 'full' : ''}">${l}<input class="input" name="${k}" value="${esc(c[k] || '')}" ${acc ? '' : 'readonly'} ${k === 'company_name' ? 'required' : ''}></label>`).join('')}
      <label class="f">VAT rate %<input class="input" name="vat_rate_bp" inputmode="decimal" value="${c.vat_rate_bp / 100}" ${acc ? '' : 'readonly'}></label>
    </div>
    <div class="card-b"><h3 style="margin:0 0 4px">Company bank accounts</h3><div class="muted" style="margin-bottom:8px">The CFO picks one of these as "Paid from" when recording a payment.</div>
      <table class="t compact"><thead><tr><th>Bank</th><th>IBAN</th><th></th></tr></thead><tbody id="baccs">
      ${(c.bank_accounts || []).map((a) => bankRow(a, acc)).join('') || (acc ? '' : '<tr><td colspan="3" class="empty">None saved.</td></tr>')}</tbody></table>
      ${acc ? '<button type="button" class="btn sm" id="badd" style="margin-top:8px">+ Add bank account</button>' : ''}</div>${acc ? '<div class="card-b"><button class="btn primary">Save company details</button></div>' : ''}</form>
    <div class="card"><div class="card-h"><h2>Suppliers</h2>${acc ? '<button class="btn primary sm" id="sadd">Add supplier</button>' : ''}</div><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Supplier</th><th>Contact</th><th>VAT / CR</th><th>Bank</th><th class="num">Terms</th><th class="num">Receipts</th><th></th></tr></thead><tbody>
      ${sups.map((s) => `<tr class="${s.active ? '' : 'muted'}"><td><b>${esc(s.supplier_name)}</b>${s.active ? '' : ' (inactive)'}</td><td>${esc(s.contact_name || '')}<div class="muted">${[s.phone, s.email].filter(Boolean).map(esc).join(' · ')}</div></td>
        <td class="muted">${esc(s.vat_number || '—')}<div>${esc(s.cr_number || '')}</div></td><td>${s.iban ? `${esc(s.bank_name || '')}<div class="iban">${esc(s.iban)}</div>` : '<span class="neg">No IBAN</span>'}</td>
        <td class="num">${s.payment_terms_days != null ? `${s.payment_terms_days} d` : '—'}</td><td class="num">${s.receipts}</td>
        <td>${acc ? `<button class="btn sm" data-edit="${s.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No suppliers yet — they are added when goods are received.</td></tr>'}
      </tbody></table></div></div></div>`;
  if (!acc) return;
  $('#badd', main).onclick = () => { $('#baccs', main).insertAdjacentHTML('beforeend', bankRow({}, true)); $('#baccs tr:last-child .bk', main).focus(); };
  $('#baccs', main).addEventListener('click', (e) => { if (e.target.matches('.brm')) e.target.closest('tr').remove(); });
  $('#cof', main).onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.bank_accounts = $$('#baccs tr.bacc', main).map((tr) => ({ bank: $('.bk', tr).value, iban: $('.ib', tr).value }));
    busy(e.submitter || $('button.primary', e.target), async () => { await api('PUT', '/api/finance/company', body); toast('Company details saved'); router(); });
  };
  const edit = async (s) => {
    const v = await formModal({ title: s ? `Edit ${s.supplier_name}` : 'Add supplier', ok: 'Save', fields: [
      { name: 'supplier_name', label: 'Name', value: s?.supplier_name, required: true, full: true },
      { name: 'contact_name', label: 'Contact person', value: s?.contact_name }, { name: 'phone', label: 'Phone', value: s?.phone },
      { name: 'email', label: 'Email', value: s?.email, type: 'email' }, { name: 'payment_terms_days', label: 'Payment terms (days)', value: s?.payment_terms_days, type: 'number', attrs: 'min="0" step="1"' },
      { name: 'vat_number', label: 'VAT number', value: s?.vat_number }, { name: 'cr_number', label: 'CR number', value: s?.cr_number },
      { name: 'bank_name', label: 'Bank', value: s?.bank_name }, { name: 'iban', label: 'IBAN', value: s?.iban, placeholder: 'SA…' },
      { name: 'address', label: 'Address', value: s?.address, full: true },
      ...(s ? [{ name: 'active', label: 'Status', value: s.active ? '1' : '', options: [['1', 'Active'], ['', 'Inactive']] }] : []),
    ] });
    if (!v) return;
    if (v.payment_terms_days === '') v.payment_terms_days = null;
    if (s) v.active = !!v.active;
    try { await api(s ? 'PUT' : 'POST', '/api/finance/suppliers' + (s ? '/' + s.id : ''), v); toast('Supplier saved'); router(); } catch (err) { toast(err.message, true); }
  };
  $('#sadd', main).onclick = () => edit(null);
  main.addEventListener('click', (e) => { const id = e.target.dataset.edit; if (id) edit(sups.find((s) => String(s.id) === id)); });
}
