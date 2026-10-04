'use strict';
/* Maintenance screens: requests (branch / managers / drivers), supervisor, technician, accounts bills. Loaded before app.js. */

const M_STATE = { OPEN: ['New', 'b-SUBMITTED'], ASSIGNED: ['Assigned', 'b-ACCEPTED'], IN_PROGRESS: ['In progress', 'b-DISPATCHED'], DONE: ['Done — to check', 'b-REORDER'],
  CLOSED: ['Closed', 'b-RECEIVED'], REJECTED: ['Rejected', 'b-REJECTED'], CANCELLED: ['Cancelled', 'b-DRAFT'] };
const mBadge = (s) => `<span class="badge ${M_STATE[s]?.[1] || ''}">${M_STATE[s]?.[0] || esc(s)}</span>`;
const P_CLASS = { URGENT: 'b-DIFF', HIGH: 'b-REORDER', NORMAL: '', LOW: 'b-DRAFT' };
const pBadge = (p) => (p === 'NORMAL' ? '' : `<span class="badge ${P_CLASS[p] || ''}">${esc(p[0] + p.slice(1).toLowerCase())}</span>`);
const kindTag = (k) => (k === 'MANDATORY' ? '<span class="badge b-ASSIGNED">Mandatory</span>' : '');
const DOC_STATE = { VALID: ['Valid', 'b-RECEIVED'], EXPIRING: ['Expiring soon', 'b-REORDER'], EXPIRED: ['Expired', 'b-DIFF'], INACTIVE: ['Inactive', 'b-DRAFT'] };
const docBadge = (s) => `<span class="badge ${DOC_STATE[s]?.[1] || ''}">${DOC_STATE[s]?.[0] || esc(s)}</span>`;
const BILL_STATE = { INCOMPLETE: ['Needs invoice no.', 'b-DRAFT'], TO_CHECK: ['To check', 'b-SUBMITTED'], MATCHED: ['Checked', 'b-ACCEPTED'], IN_REQUEST: ['In payment request', 'b-DISPATCHED'], PAID: ['Paid', 'b-RECEIVED'] };
const billBadge = (s) => (s ? `<span class="badge ${BILL_STATE[s]?.[1] || ''}">${BILL_STATE[s]?.[0] || esc(s)}</span>` : '');
const LOC_LABEL = { BRANCH: 'Branch', WAREHOUSE: 'Warehouse', FACTORY: 'Factory', COMPANY: 'Company / head office' };
const CAT_ICON = { VEHICLE: '🚚', HARDWARE: '🖨️', SOFTWARE: '💻', LIGHTING: '💡', SWITCHES: '🔌', ELECTRICAL: '⚡', PLUMBING: '🚰', GOVERNMENT: '📋', OTHER: '🛠️' };
const isSupv = () => state.me?.role === 'MAINT_SUPERVISOR';
const isTech = () => state.me?.role === 'TECHNICIAN';
async function mMeta(force) { if (!state.mmeta || force) state.mmeta = await GET('/api/maint/meta'); return state.mmeta; }
const assetLabel = (a) => `${a.name}${a.tag ? ` (${a.tag})` : ''}`;
const everyLabel = (s) => `Every ${s.every_n === 1 ? '' : s.every_n + ' '}${{ DAY: 'day', WEEK: 'week', MONTH: 'month' }[s.every_unit]}${s.every_n === 1 ? '' : 's'}`;
const whereCell = (j) => `${esc(j.location_name || LOC_LABEL[j.location_type])}${j.asset_name ? `<div class="muted">${esc(j.asset_name)}${j.asset_tag ? ` · ${esc(j.asset_tag)}` : ''}</div>` : ''}`;

function jobRow(j, opts = {}) {
  return `<tr class="click" data-href="#/maintenance/${j.id}">
    <td><b>${esc(j.number)}</b><div class="muted">${fmtDate(j.requested_at.slice(0, 10))}</div></td>
    <td><div class="iname">${CAT_ICON[j.category] || ''} ${esc(j.title)}</div><div class="muted">${esc(j.category_label)} ${kindTag(j.kind)}</div></td>
    ${opts.noWhere ? '' : `<td>${whereCell(j)}</td>`}
    <td>${mBadge(j.status)} ${pBadge(j.priority)}</td>
    <td class="${j.overdue ? 'neg' : ''}">${j.due_date ? fmtDate(j.due_date) : '—'}${j.overdue ? '<div><b>Overdue</b></div>' : ''}</td>
    <td>${esc(j.tech_name || j.contractor_name || '—')}${j.tech_name && j.contractor_name ? `<div class="muted">${esc(j.contractor_name)}</div>` : ''}</td>
    ${opts.cost ? `<td class="num">${j.cost_h == null ? '—' : sar(j.cost_h)}</td>` : ''}</tr>`;
}
const jobHead = (opts = {}) => `<thead><tr><th>Job</th><th>Problem</th>${opts.noWhere ? '' : '<th>Where</th>'}<th>Status</th><th>Due</th><th>Who</th>${opts.cost ? '<th class="num">Cost SAR</th>' : ''}</tr></thead>`;

// ───────────────────────── requesters (branch / managers / drivers) ─────────────────────────
async function MaintRequests(main, _p, query) {
  const show = query.show || 'open';
  const list = await GET('/api/maint/jobs?' + qs({ status: show === 'open' ? 'OPEN,ASSIGNED,IN_PROGRESS,DONE' : '' }));
  main.innerHTML = head('Maintenance', 'Report a problem and follow it until it is fixed', '<a class="btn primary" href="#/maintenance/new">Report a problem</a>') + `<div class="stack">
    <div class="seg"><a href="#/maintenance?show=open" class="${show === 'open' ? 'on' : ''}">Open</a><a href="#/maintenance?show=all" class="${show === 'all' ? 'on' : ''}">All</a></div>
    <div class="card"><div class="tbl-wrap"><table class="t">${jobHead({ noWhere: state.me.role === 'BRANCH' })}<tbody>
      ${list.map((j) => jobRow(j, { noWhere: state.me.role === 'BRANCH' })).join('') || `<tr><td colspan="6" class="empty">${show === 'open' ? 'No open maintenance requests.' : 'No requests yet.'}</td></tr>`}
    </tbody></table></div></div></div>`;
  clickRows(main);
}

async function MaintNew(main) {
  const m = await mMeta(true);
  const sup = isSupv();
  const drv = state.me.role === 'DRIVER';
  const assets = drv ? m.assets.filter((a) => a.kind === 'VEHICLE') : m.assets;
  const back = sup ? '#/jobs' : '#/maintenance';
  main.innerHTML = head(sup ? 'New maintenance job' : 'Report a problem', sup ? 'A request or a mandatory job' : `Your request goes to the maintenance supervisor${state.me.branch_name ? ` · ${esc(state.me.branch_name)}` : ''}`, `<a class="btn" href="${back}">Back</a>`) + `
    <form class="stack" id="mf">
      <div class="card card-b"><div class="k-label">What kind of problem?</div>
        <div class="cat-grid">${m.categories.map((c) => `<label class="cat"><input type="radio" name="category" value="${c.code}" required ${drv && c.code === 'VEHICLE' ? 'checked' : ''}><span>${CAT_ICON[c.code] || ''}</span><b>${esc(c.label)}</b></label>`).join('')}</div></div>
      <div class="card card-b form-grid">
        <label class="f full">Short description<input class="input" name="title" maxlength="150" required placeholder="e.g. Freezer door light not working"></label>
        <label class="f full">Details (optional)<textarea class="input" name="description" rows="3" placeholder="Where exactly, since when, anything already tried"></textarea></label>
        <label class="f">Priority<select class="input" name="priority">${m.priorities.map((p) => opt(p, p === 'URGENT' ? 'Urgent — stops work' : p[0] + p.slice(1).toLowerCase(), 'NORMAL')).join('')}</select></label>
        ${assets.length || drv ? `<label class="f">${drv ? 'Vehicle' : 'Vehicle / equipment (optional)'}<select class="input" name="asset_id" ${drv ? 'required' : ''}>${opt('', drv ? 'Select vehicle ▾' : '—', '')}${assets.map((a) => opt(a.id, `${assetLabel(a)}${a.driver_name ? ` · ${a.driver_name}` : ''}${sup && a.branch_name ? ` · ${a.branch_name}` : ''}`, drv && assets[0]?.driver_id === state.me.driver_id ? assets[0].id : '')).join('')}</select></label>` : ''}
        ${sup ? `
        <label class="f">Type<select class="input" name="kind">${opt('REQUEST', 'Request', 'REQUEST')}${opt('MANDATORY', 'Mandatory (supervisor)', '')}</select></label>
        <label class="f">Where<select class="input" name="location_type" required>${Object.entries(LOC_LABEL).map(([k, l]) => opt(k, l, 'BRANCH')).join('')}</select></label>
        <label class="f" id="brf">Branch<select class="input" name="branch_id">${opt('', 'Select branch ▾', '')}${m.branches.map((b) => opt(b.id, b.branch_name, '')).join('')}</select></label>
        <label class="f">Technician<select class="input" name="tech_id">${opt('', '— none —', '')}${m.technicians.filter((t) => t.active).map((t) => opt(t.id, t.name, '')).join('')}</select></label>
        <label class="f">Outside contractor<input class="input" name="contractor_name" list="con-dl" placeholder="Name (optional)"></label>
        <datalist id="con-dl">${m.contractors.map((c) => `<option value="${esc(c.supplier_name)}">`).join('')}</datalist>
        <label class="f">Due date<input class="input" type="date" name="due_date"></label>` : ''}
      </div>
      <div class="actionbar"><div class="grow muted">${sup ? 'Assigning a technician or contractor sets the job to Assigned.' : 'You can follow the progress under Maintenance.'}</div><button class="btn primary lg">${sup ? 'Create job' : 'Send request'}</button></div>
    </form>`;
  const f = $('#mf', main);
  if (sup) {
    const sync = () => { $('#brf', main).hidden = f.location_type.value !== 'BRANCH'; };
    f.location_type.onchange = sync; sync();
  }
  main.addEventListener('input', () => { state.dirty = true; });
  f.onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    busy(e.submitter, async () => {
      const j = await api('POST', '/api/maint/jobs', body);
      state.dirty = false; toast(`${j.number} sent`); location.hash = '#/maintenance/' + j.id;
    });
  };
}

async function MaintJob(main, { id }) {
  const j = await GET('/api/maint/jobs/' + id);
  const role = state.me.role;
  const sup = isSupv();
  const m = sup ? await mMeta() : null;
  const back = sup ? '#/jobs' : isTech() ? '#/home' : ['ACCOUNTANT', 'CFO'].includes(role) ? 'javascript:history.back()' : '#/maintenance';
  const acts = [];
  if (j.can.start) acts.push('<button class="btn primary" data-a="start">Start work</button>');
  if (j.can.finish) acts.push('<button class="btn primary" data-a="finish">Mark as done</button>');
  if (j.can.close) acts.push('<button class="btn primary" data-a="close">Check &amp; close</button>');
  if (j.can.send_back) acts.push('<button class="btn" data-a="back">Send back</button>');
  if (j.can.reject) acts.push('<button class="btn danger" data-a="reject">Reject</button>');
  if (j.can.cancel) acts.push('<button class="btn danger" data-a="cancel">Cancel</button>');
  const nextStep = { OPEN: sup ? 'Assign a technician or contractor.' : 'Waiting for the maintenance supervisor.', ASSIGNED: 'Waiting for the work to start.', IN_PROGRESS: 'Work in progress.',
    DONE: sup ? 'Work is done — check it and close the job.' : 'Work is done — the supervisor will check it.', CLOSED: 'Finished.', REJECTED: `Rejected: ${esc(j.reject_reason || '')}`, CANCELLED: 'Cancelled.' }[j.status];
  const info = (k, v) => `<div><div class="k">${k}</div><div>${v}</div></div>`;
  main.innerHTML = head(`${esc(j.number)} · ${esc(j.title)}`, `${CAT_ICON[j.category] || ''} ${esc(j.category_label)} ${kindTag(j.kind)} ${mBadge(j.status)} ${pBadge(j.priority)}`, `<a class="btn" href="${back}">Back</a>`) + `<div class="stack">
    <div class="card card-b row"><div class="grow ${j.overdue ? 'neg' : ''}">${j.overdue ? '<b>Overdue.</b> ' : ''}${nextStep}</div>${acts.join('')}</div>
    <div class="card card-b info-grid">
      ${info('Where', whereCell(j))}
      ${info('Reported by', `${esc(j.requested_by_name)}<div class="muted">${fmtTime(j.requested_at)}</div>`)}
      ${info('Due', j.due_date ? `<span class="${j.overdue ? 'neg' : ''}">${fmtDate(j.due_date)}</span>` : '—')}
      ${info('Technician', esc(j.tech_name || '—'))}
      ${info('Contractor', esc(j.contractor_name || '—'))}
      ${j.started_at ? info('Started', fmtTime(j.started_at)) : ''}
      ${j.done_at ? info('Done', `${fmtTime(j.done_at)}<div class="muted">${esc(j.done_by_name || '')}</div>`) : ''}
      ${j.closed_at ? info(j.status === 'CLOSED' ? 'Closed' : 'Ended', `${fmtTime(j.closed_at)}<div class="muted">${esc(j.closed_by_name || '')}</div>`) : ''}
      ${j.document ? info('Document', `${esc(j.document.title)}<div class="muted">${esc(j.document.doc_type)} · expires ${fmtDate(j.document.expires_on)}</div>`) : ''}
    </div>
    ${j.description ? `<div class="card card-b"><div class="k">Details</div><div class="pre">${esc(j.description)}</div></div>` : ''}
    ${j.work_note ? `<div class="note ok"><b>Work done:</b> ${esc(j.work_note)}</div>` : ''}
    ${j.can.edit ? `<form class="card" id="ef"><div class="card-h"><h2>Assign &amp; plan</h2></div><div class="card-b form-grid">
      <label class="f">Technician<select class="input" name="tech_id">${opt('', '— none —', j.tech_id)}${m.technicians.filter((t) => t.active || t.id === j.tech_id).map((t) => opt(t.id, t.name, j.tech_id)).join('')}</select></label>
      <label class="f">Outside contractor<select class="input" name="contractor_id">${opt('', '— none —', j.contractor_id)}${m.contractors.filter((c) => c.active || c.id === j.contractor_id).map((c) => opt(c.id, c.supplier_name, j.contractor_id)).join('')}</select></label>
      <label class="f">…or new contractor<input class="input" name="contractor_name" placeholder="Name"></label>
      <label class="f">Due date<input class="input" type="date" name="due_date" value="${j.due_date || ''}"></label>
      <label class="f">Priority<select class="input" name="priority">${m.priorities.map((p) => opt(p, p[0] + p.slice(1).toLowerCase(), j.priority)).join('')}</select></label>
      <label class="f">Category<select class="input" name="category">${m.categories.map((c) => opt(c.code, c.label, j.category)).join('')}</select></label>
    </div><div class="card-b"><button class="btn primary">Save</button></div></form>` : ''}
    ${(j.can.cost || j.cost_h != null) && ['MAINT_SUPERVISOR', 'ACCOUNTANT', 'CFO'].includes(role) ? `<form class="card" id="cf"><div class="card-h"><h2>Cost</h2>${billBadge(j.bill_state)}</div><div class="card-b form-grid">
      <label class="f">Cost excl. VAT (SAR)<input class="input" name="cost" inputmode="decimal" value="${sarIn(j.cost_h)}" ${j.can.cost ? '' : 'readonly'} placeholder="0.00"></label>
      <label class="f">Contractor invoice no.<input class="input" name="invoice_no" value="${esc(j.invoice_no || '')}" ${j.can.cost ? '' : 'readonly'} ${j.contractor_id ? '' : 'placeholder="Only for contractors"'}></label>
      ${j.request_number ? `<div><div class="k">Payment request</div><a href="#/requests/${j.request_id}">${esc(j.request_number)}</a></div>` : ''}
      ${j.matched_at ? `<div><div class="k">Checked by accounts</div>${esc(j.matched_by_name)}<div class="muted">${fmtTime(j.matched_at)}</div></div>` : ''}
    </div><div class="card-b row">${j.can.cost ? '<button class="btn primary">Save cost</button>' : ''}
      ${j.can.check && !j.matched_at ? '<button type="button" class="btn" data-a="check">Mark bill as checked</button>' : ''}
      ${j.can.check && j.matched_at ? `<button type="button" class="btn" data-a="uncheck">Remove check</button><a class="btn primary" href="#/requests/new?supplier_id=${j.contractor_id}">Add to payment request</a>` : ''}
      ${j.contractor_id ? '<span class="muted">Contractor bills go to accounts for checking and payment.</span>' : '<span class="muted">Own technician cost (parts, materials).</span>'}</div></form>` : ''}
    <div class="card"><div class="card-h"><h2>Notes</h2></div>
      <div class="card-b"><ul class="timeline">${j.notes.map((n) => `<li><div class="muted">${fmtTime(n.at)} · ${esc(n.user_name || 'System')} <span class="muted">${esc(ROLE_LABEL[n.user_role] || '')}</span></div><div class="pre">${esc(n.note)}</div></li>`).join('') || '<li class="muted">No notes yet.</li>'}</ul>
      ${j.can.note ? '<form id="nf" class="row" style="margin-top:10px"><input class="input grow" name="note" placeholder="Add a note or update" maxlength="1000" required><button class="btn">Add note</button></form>' : ''}</div></div>
    <div class="card"><div class="card-h"><h2>History</h2></div><div class="card-b"><ul class="timeline hist">
      ${j.history.map((h) => `<li><div class="muted">${fmtTime(h.at)} · ${esc(h.user_name || 'System')}</div><div>${esc(h.summary.replace(j.number + ' ', '').replace(j.number + ': ', ''))}</div></li>`).join('')}</ul></div></div>
  </div>`;
  const post = (btn, path, body, msg) => busy(btn, async () => { await api('POST', `/api/maint/jobs/${j.id}/${path}`, body); toast(msg); router(); });
  main.addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (!a) return;
    const b = e.target;
    if (a === 'start') post(b, 'start', {}, 'Work started');
    if (a === 'finish') {
      const v = await formModal({ title: `Finish ${j.number}`, ok: 'Mark as done', fields: [{ name: 'work_note', label: 'What was done?', type: 'textarea', required: true, full: true }] });
      if (v) post(b, 'done', v, 'Marked as done');
    }
    if (a === 'close') {
      const fields = [{ name: 'note', label: 'Note (optional)', full: true }];
      if (j.document) fields.push({ name: 'new_expires_on', label: `New expiry of ${j.document.title}`, type: 'date' }, { name: 'new_reference_no', label: 'New reference no. (optional)' });
      const v = await formModal({ title: `Close ${j.number}?`, ok: 'Close job', note: j.document ? '<p>Enter the new expiry date to update the document register.</p>' : '<p>Confirm the work was checked and is complete.</p>', fields });
      if (v) post(b, 'close', v, 'Job closed');
    }
    if (a === 'back') { const r = await modal({ title: 'Send back to the technician?', input: 'What still needs doing?', ok: 'Send back' }); if (r) post(b, 'send-back', { reason: r }, 'Sent back'); }
    if (a === 'reject') { const r = await modal({ title: `Reject ${j.number}?`, input: 'Reason (the requester will see it)', ok: 'Reject', okClass: 'danger' }); if (r) post(b, 'reject', { reason: r }, 'Rejected'); }
    if (a === 'cancel') { if (await modal({ title: `Cancel ${j.number}?`, ok: 'Cancel job', okClass: 'danger', cancel: 'Keep' })) post(b, 'cancel', {}, 'Cancelled'); }
    if (a === 'check') post(b, 'check', { matched: true }, 'Bill checked');
    if (a === 'uncheck') post(b, 'check', { matched: false }, 'Check removed');
  });
  const ef = $('#ef', main);
  if (ef) ef.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api('PUT', '/api/maint/jobs/' + j.id, Object.fromEntries(new FormData(ef))); state.mmeta = null; toast('Saved'); router(); }); };
  const cf = $('#cf', main);
  if (cf) cf.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api('PUT', `/api/maint/jobs/${j.id}/cost`, Object.fromEntries(new FormData(cf))); toast('Cost saved'); router(); }); };
  const nf = $('#nf', main);
  if (nf) nf.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api('POST', `/api/maint/jobs/${j.id}/note`, Object.fromEntries(new FormData(nf))); router(); }); };
}

// ───────────────────────── technician ─────────────────────────
async function TechHome(main) {
  const list = await GET('/api/maint/jobs?status=ASSIGNED,IN_PROGRESS,DONE');
  const sec = (title, rows) => `<h2 class="sec">${title} <span class="muted">(${rows.length})</span></h2>${rows.map((j) => `<a class="card stop-card job-card ${j.overdue ? 'overdue' : ''}" href="#/maintenance/${j.id}">
      <div class="row"><b class="grow">${CAT_ICON[j.category] || ''} ${esc(j.title)}</b>${pBadge(j.priority)}</div>
      <div class="muted">${esc(j.number)} · ${esc(j.category_label)} ${kindTag(j.kind)}</div>
      <div>${esc(j.location_name)}${j.asset_name ? ` · ${esc(j.asset_name)}${j.asset_tag ? ` (${esc(j.asset_tag)})` : ''}` : ''}</div>
      <div class="${j.overdue ? 'neg' : 'muted'}">${j.due_date ? `Due ${fmtDate(j.due_date)}${j.overdue ? ' — overdue' : ''}` : 'No due date'}</div></a>`).join('') || '<div class="card empty">Nothing here.</div>'}`;
  main.innerHTML = head('My Jobs', `${esc(state.me.name)} · ${fmtDate(state.me.today)}`) + `<div class="stack">
    ${sec('In progress', list.filter((j) => j.status === 'IN_PROGRESS'))}
    ${sec('To do', list.filter((j) => j.status === 'ASSIGNED'))}
    ${sec('Done — waiting for the supervisor', list.filter((j) => j.status === 'DONE'))}</div>`;
}

// ───────────────────────── supervisor ─────────────────────────
async function SupHome(main) {
  const h = await GET('/api/maint/home');
  const c = h.counts;
  const tile = (v, l, href, hot) => `<a class="card tile ${hot && v ? 'hot' : ''}" href="${href}"><div class="v">${v}</div><div class="l">${l}</div></a>`;
  main.innerHTML = head('Maintenance', `Today · ${fmtDate(h.today)}`, '<a class="btn primary" href="#/maintenance/new">New job</a>') + `<div class="stack">
    <div class="tiles">
      ${tile(c.new, 'New requests to assign', '#/jobs?status=OPEN', true)}
      ${tile(c.urgent, 'Urgent and open', '#/jobs?status=OPEN,ASSIGNED,IN_PROGRESS&priority=URGENT', true)}
      ${tile(c.overdue, 'Overdue', '#/jobs?overdue=1', true)}
      ${tile(c.assigned, 'Assigned, not started', '#/jobs?status=ASSIGNED')}
      ${tile(c.in_progress, 'In progress', '#/jobs?status=IN_PROGRESS')}
      ${tile(c.to_close, 'Done — check & close', '#/jobs?status=DONE', true)}
      ${tile(c.docs_expired, 'Documents expired', '#/documents?status=EXPIRED', true)}
      ${tile(c.docs_expiring, 'Documents expiring soon', '#/documents?status=EXPIRING', true)}
      ${tile(c.closed_30d, 'Closed in the last 30 days', '#/jobs?status=CLOSED')}
    </div>
    <div class="card"><div class="card-h"><h2>Needs attention</h2><a class="btn sm" href="#/jobs">All jobs</a></div><div class="tbl-wrap"><table class="t">${jobHead()}<tbody>
      ${h.attention.map((j) => jobRow(j)).join('') || '<tr><td colspan="6" class="empty">Nothing needs attention.</td></tr>'}</tbody></table></div></div>
    <div class="grid2">
      <div class="card"><div class="card-h"><h2>Documents to renew</h2><a class="btn sm" href="#/documents">Register</a></div><div class="tbl-wrap"><table class="t compact"><tbody>
        ${h.documents.map((d) => `<tr class="click" data-href="#/documents"><td><b>${esc(d.title)}</b><div class="muted">${esc(d.location_name)}${d.asset_name ? ` · ${esc(d.asset_name)}` : ''}</div></td><td>${docBadge(d.status)}</td><td class="num ${d.days_left < 0 ? 'neg' : ''}">${fmtDate(d.expires_on)}<div class="muted">${d.days_left < 0 ? `${-d.days_left} days ago` : `in ${d.days_left} days`}</div></td></tr>`).join('') || '<tr><td class="empty">All documents are valid.</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Mandatory work — next 30 days</h2><a class="btn sm" href="#/schedules">Schedules</a></div><div class="tbl-wrap"><table class="t compact"><tbody>
        ${h.upcoming.map((s) => `<tr class="click" data-href="${s.open_job_id ? '#/maintenance/' + s.open_job_id : '#/schedules'}"><td><b>${esc(s.title)}</b><div class="muted">${esc(s.location_name)}${s.asset_name ? ` · ${esc(s.asset_name)}` : ''} · ${everyLabel(s)}</div></td><td class="num">${fmtDate(s.next_due)}</td><td>${s.open_job_id ? '<span class="badge b-ACCEPTED">Job open</span>' : ''}</td></tr>`).join('') || '<tr><td class="empty">Nothing scheduled.</td></tr>'}
      </tbody></table></div></div>
    </div>
    ${h.by_category.length ? `<div class="card"><div class="card-h"><h2>Open jobs by type</h2></div><div class="card-b row" style="flex-wrap:wrap">${h.by_category.map((x) => `<a class="btn" href="#/jobs?category=${x.category}">${CAT_ICON[x.category] || ''} ${esc(x.label)} <b>${x.n}</b></a>`).join('')}</div></div>` : ''}
  </div>`;
  clickRows(main);
}

async function Jobs(main, _p, query) {
  const m = await mMeta();
  const f = { status: query.status ?? 'OPEN,ASSIGNED,IN_PROGRESS,DONE', category: query.category || '', location: query.location || '', tech_id: query.tech_id || '', asset_id: query.asset_id || '', kind: query.kind || '', q: query.q || '', overdue: query.overdue || '', priority: query.priority || '' };
  let list = await GET('/api/maint/jobs?' + qs({ ...f, priority: '', sort: 'work' }));
  if (f.priority) list = list.filter((j) => j.priority === f.priority);
  const tabs = [['OPEN,ASSIGNED,IN_PROGRESS,DONE', 'Open'], ['OPEN', 'New'], ['ASSIGNED', 'Assigned'], ['IN_PROGRESS', 'In progress'], ['DONE', 'To close'], ['CLOSED', 'Closed'], ['', 'All']];
  const locs = [['', 'All places'], ['WAREHOUSE', 'Warehouse'], ['FACTORY', 'Factory'], ['COMPANY', 'Company'], ...m.branches.map((b) => [`BRANCH:${b.id}`, b.branch_name])];
  main.innerHTML = head('Maintenance Jobs', `${list.length} job(s)`, '<a class="btn primary" href="#/maintenance/new">New job</a>' + exportBtns(false)) + `<div class="stack">
    <div class="seg no-print">${tabs.map(([v, l]) => `<a href="#/jobs?${qs({ ...f, status: v, overdue: '' })}" class="${v === f.status && !f.overdue ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${f.asset_id ? `<div class="note">Showing one vehicle / equipment only. <a href="#/jobs?${qs({ ...f, asset_id: '' })}">Show all</a></div>` : ''}
    ${filterForm('jf', `<input type="hidden" name="status" value="${esc(f.status)}"><input type="hidden" name="asset_id" value="${esc(f.asset_id)}">
      <label class="f">Type<select class="input" name="category">${opt('', 'All', f.category)}${m.categories.map((c) => opt(c.code, c.label, f.category)).join('')}</select></label>
      <label class="f">Place<select class="input" name="location">${locs.map(([v, l]) => opt(v, l, f.location)).join('')}</select></label>
      <label class="f">Technician<select class="input" name="tech_id">${opt('', 'All', f.tech_id)}${m.technicians.map((t) => opt(t.id, t.name, f.tech_id)).join('')}</select></label>
      <label class="f">Kind<select class="input" name="kind">${opt('', 'All', f.kind)}${opt('REQUEST', 'Requests', f.kind)}${opt('MANDATORY', 'Mandatory', f.kind)}</select></label>
      <label class="f grow">Search<input class="input" name="q" value="${esc(f.q)}" placeholder="Number or words"></label>
      <label class="f row" style="align-self:end"><input type="checkbox" name="overdue" value="1" ${f.overdue ? 'checked' : ''}> Overdue only</label>`)}
    <div class="card"><div class="tbl-wrap"><table class="t">${jobHead({ cost: true })}<tbody>
      ${list.map((j) => jobRow(j, { cost: true })).join('') || '<tr><td colspan="7" class="empty">No jobs.</td></tr>'}</tbody></table></div></div></div>`;
  onFilter(main, 'jf', '#/jobs');
  clickRows(main);
  wireExport(main, `maintenance-jobs-${state.me.today}`, () => [{ name: 'Jobs', header: ['Job', 'Reported', 'Kind', 'Type', 'Problem', 'Where', 'Vehicle / equipment', 'Priority', 'Status', 'Due', 'Technician', 'Contractor', 'Done', 'Cost SAR', 'Invoice'],
    rows: list.map((j) => [j.number, j.requested_at.slice(0, 10), j.kind, j.category_label, j.title, j.location_name, j.asset_name || '', j.priority, M_STATE[j.status]?.[0] || j.status, j.due_date || '', j.tech_name || '', j.contractor_name || '', j.done_at ? j.done_at.slice(0, 10) : '', sarNum(j.cost_h), j.invoice_no || '']) }]);
}

function locFields(m, v = {}) {
  return [
    { name: 'location_type', label: 'Where', value: v.location_type || 'BRANCH', options: Object.entries(LOC_LABEL) },
    { name: 'branch_id', label: 'Branch (if Where = Branch)', value: v.branch_id, options: [['', '—'], ...m.branches.map((b) => [b.id, b.branch_name])] },
    { name: 'asset_id', label: 'Vehicle / equipment (optional)', value: v.asset_id, options: [['', '—'], ...m.assets.map((a) => [a.id, assetLabel(a)])] },
  ];
}

async function Schedules(main) {
  const [m, list] = await Promise.all([mMeta(true), GET('/api/maint/schedules')]);
  main.innerHTML = head('Mandatory Schedules', 'Repeating work — a job is created automatically before each due date', '<button class="btn primary" id="sadd">Add schedule</button>') + `<div class="stack">
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Work</th><th>Where</th><th>Repeats</th><th>Next due</th><th>Assigned to</th><th>Current job</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr class="${s.active ? '' : 'muted'}"><td><b>${CAT_ICON[s.category] || ''} ${esc(s.title)}</b><div class="muted">${esc(s.category_label)}${s.active ? '' : ' · paused'}</div></td>
        <td>${esc(s.location_name)}${s.asset_name ? `<div class="muted">${esc(s.asset_name)}</div>` : ''}</td><td>${everyLabel(s)}<div class="muted">job created ${s.lead_days} day(s) ahead</div></td>
        <td class="${s.next_due < state.me.today ? 'neg' : ''}">${fmtDate(s.next_due)}</td><td>${esc(s.tech_name || s.contractor_name || '—')}</td>
        <td>${s.open_job_id ? `<a href="#/maintenance/${s.open_job_id}">Open job</a>` : '<span class="muted">—</span>'}<div class="muted">${s.jobs} job(s) so far</div></td>
        <td>${isSupv() ? `<button class="btn sm" data-edit="${s.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No schedules yet. Add things like vehicle services, fire extinguisher checks, AC filter cleaning or pest control.</td></tr>'}
      </tbody></table></div></div></div>`;
  if (!isSupv()) { $('#sadd', main).remove(); return; }
  const edit = async (s) => {
    const v = await formModal({ title: s ? `Edit: ${s.title}` : 'Add schedule', ok: 'Save', fields: [
      { name: 'title', label: 'Work to do', value: s?.title, required: true, full: true, placeholder: 'e.g. Van oil change and service' },
      { name: 'category', label: 'Type', value: s?.category || 'VEHICLE', options: m.categories.map((c) => [c.code, c.label]) },
      { name: 'priority', label: 'Priority', value: s?.priority || 'NORMAL', options: m.priorities.map((p) => [p, p[0] + p.slice(1).toLowerCase()]) },
      ...locFields(m, s || {}),
      { name: 'every_n', label: 'Repeat every', type: 'number', value: s?.every_n || 3, required: true, attrs: 'min="1" max="365"' },
      { name: 'every_unit', label: 'Unit', value: s?.every_unit || 'MONTH', options: [['DAY', 'Days'], ['WEEK', 'Weeks'], ['MONTH', 'Months']] },
      { name: 'next_due', label: 'Next due date', type: 'date', value: s?.next_due || state.me.today, required: true },
      { name: 'lead_days', label: 'Create the job … days before', type: 'number', value: s?.lead_days ?? 7, attrs: 'min="0" max="90"' },
      { name: 'tech_id', label: 'Technician', value: s?.tech_id, options: [['', '— none —'], ...m.technicians.filter((t) => t.active).map((t) => [t.id, t.name])] },
      { name: 'contractor_id', label: 'Contractor', value: s?.contractor_id, options: [['', '— none —'], ...m.contractors.map((c) => [c.id, c.supplier_name])] },
      { name: 'details', label: 'Checklist / details', type: 'textarea', value: s?.details, full: true },
      ...(s ? [{ name: 'active', label: 'Status', value: s.active ? '1' : '', options: [['1', 'Active'], ['', 'Paused']] }] : []),
    ] });
    if (!v) return;
    if (s) v.active = !!v.active;
    try { await api(s ? 'PUT' : 'POST', '/api/maint/schedules' + (s ? '/' + s.id : ''), v); toast('Schedule saved'); router(); } catch (err) { toast(err.message, true); }
  };
  $('#sadd', main).onclick = () => edit(null);
  main.addEventListener('click', (e) => { const i = e.target.dataset.edit; if (i) edit(list.find((s) => String(s.id) === i)); });
}

async function Documents(main, _p, query) {
  const [m, all] = await Promise.all([mMeta(true), GET('/api/maint/documents')]);
  const st = query.status || '';
  const list = st ? all.filter((d) => d.status === st) : all;
  const tabs = [['', 'All'], ['EXPIRED', 'Expired'], ['EXPIRING', 'Expiring soon'], ['VALID', 'Valid']];
  main.innerHTML = head('Licenses & Documents', 'Government licenses, certificates and vehicle papers — with expiry reminders', (isSupv() ? '<button class="btn primary" id="dadd">Add document</button>' : '') + exportBtns(false)) + `<div class="stack">
    <div class="seg no-print">${tabs.map(([v, l]) => `<a href="#/documents?status=${v}" class="${v === st ? 'on' : ''}">${l} <span class="muted">${v ? all.filter((d) => d.status === v).length : all.length}</span></a>`).join('')}</div>
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Document</th><th>For</th><th>Reference</th><th>Status</th><th>Expires</th><th>Renewal</th><th></th></tr></thead><tbody>
      ${list.map((d) => `<tr><td><b>${esc(d.title)}</b><div class="muted">${esc(d.doc_type)}</div></td><td>${esc(d.location_name)}${d.asset_name ? `<div class="muted">${esc(d.asset_name)}${d.asset_tag ? ` · ${esc(d.asset_tag)}` : ''}</div>` : ''}</td>
        <td>${esc(d.reference_no || '—')}</td><td>${docBadge(d.status)}</td>
        <td class="${d.status === 'EXPIRED' ? 'neg' : ''}"><b>${fmtDate(d.expires_on)}</b><div class="muted">${d.days_left < 0 ? `${-d.days_left} days ago` : `in ${d.days_left} days`} · remind ${d.remind_days}d before</div></td>
        <td>${d.open_job_id ? `<a href="#/maintenance/${d.open_job_id}">${esc(d.open_job_number)}</a>` : isSupv() && d.active ? `<button class="btn sm" data-job="${d.id}">Start renewal job</button>` : '—'}</td>
        <td class="row">${isSupv() ? `<button class="btn sm" data-renew="${d.id}">Renewed</button><button class="btn sm ghost" data-edit="${d.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No documents.</td></tr>'}
      </tbody></table></div></div></div>`;
  wireExport(main, `documents-${state.me.today}`, () => [{ name: 'Documents', header: ['Document', 'Type', 'For', 'Vehicle / equipment', 'Reference', 'Issued', 'Expires', 'Days left', 'Status'],
    rows: list.map((d) => [d.title, d.doc_type, d.location_name, d.asset_name || '', d.reference_no || '', d.issued_on || '', d.expires_on, d.days_left, DOC_STATE[d.status]?.[0] || d.status]) }]);
  if (!isSupv()) return;
  const edit = async (d) => {
    const v = await formModal({ title: d ? `Edit: ${d.title}` : 'Add document', ok: 'Save', fields: [
      { name: 'doc_type', label: 'Type', value: d?.doc_type || m.doc_types[0], options: [...new Set([...m.doc_types, ...(d ? [d.doc_type] : [])])].map((t) => [t, t]) },
      { name: 'title', label: 'Name', value: d?.title, placeholder: 'e.g. Jish Baladiya license' },
      ...locFields(m, d || { location_type: 'BRANCH' }),
      { name: 'reference_no', label: 'Reference / license no.', value: d?.reference_no },
      { name: 'issued_on', label: 'Issued on', type: 'date', value: d?.issued_on },
      { name: 'expires_on', label: 'Expires on', type: 'date', value: d?.expires_on, required: true },
      { name: 'remind_days', label: 'Warn … days before', type: 'number', value: d?.remind_days ?? 30, attrs: 'min="0" max="365"' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: d?.notes, full: true },
      ...(d ? [{ name: 'active', label: 'Status', value: d.active ? '1' : '', options: [['1', 'Active'], ['', 'Inactive (no longer needed)']] }] : []),
    ] });
    if (!v) return;
    if (d) v.active = !!v.active;
    try { await api(d ? 'PUT' : 'POST', '/api/maint/documents' + (d ? '/' + d.id : ''), v); toast('Document saved'); router(); } catch (err) { toast(err.message, true); }
  };
  $('#dadd', main).onclick = () => edit(null);
  main.addEventListener('click', async (e) => {
    const t = e.target.dataset;
    const d = all.find((x) => String(x.id) === (t.edit || t.renew || t.job));
    if (!d) return;
    if (t.edit) edit(d);
    if (t.renew) {
      const v = await formModal({ title: `Renewed: ${d.title}`, ok: 'Save renewal', note: `<p>Current expiry ${fmtDate(d.expires_on)}.</p>`, fields: [
        { name: 'expires_on', label: 'New expiry date', type: 'date', required: true }, { name: 'reference_no', label: 'New reference no. (optional)', value: '' },
        { name: 'issued_on', label: 'Issued on', type: 'date', value: state.me.today }, { name: 'note', label: 'Note', full: true }] });
      if (v) busy(e.target, async () => { await api('POST', `/api/maint/documents/${d.id}/renew`, v); toast('Renewal saved'); router(); });
    }
    if (t.job) {
      const v = await formModal({ title: `Renewal job for ${d.title}`, ok: 'Create job', fields: [
        { name: 'tech_id', label: 'Technician / staff', options: [['', '— none —'], ...m.technicians.filter((x) => x.active).map((x) => [x.id, x.name])] },
        { name: 'contractor_id', label: 'Contractor / agent', options: [['', '— none —'], ...m.contractors.map((c) => [c.id, c.supplier_name])] }] });
      if (v) busy(e.target, async () => { const j = await api('POST', `/api/maint/documents/${d.id}/job`, v); toast(`${j.number} created`); location.hash = '#/maintenance/' + j.id; });
    }
  });
}

async function Assets(main) {
  const [m, list, drivers] = await Promise.all([mMeta(true), GET('/api/maint/assets'), isSupv() ? GET('/api/drivers') : []]);
  main.innerHTML = head('Vehicles & Equipment', 'Things that get maintained — pick them on jobs, schedules and documents', isSupv() ? '<button class="btn primary" id="aadd">Add</button>' : '') + `<div class="stack">
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Name</th><th>Type</th><th>Plate / serial</th><th>Where</th><th>Driver</th><th class="num">Jobs</th><th class="num">Cost SAR</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr class="${a.active ? '' : 'muted'}"><td><b>${esc(a.name)}</b>${a.active ? '' : ' (inactive)'}${a.notes ? `<div class="muted">${esc(a.notes)}</div>` : ''}</td><td>${a.kind === 'VEHICLE' ? '🚚 Vehicle' : '🖨️ Equipment'}</td>
        <td>${esc(a.tag || '—')}</td><td>${esc(a.location_type === 'BRANCH' ? a.branch_name : LOC_LABEL[a.location_type])}</td><td>${esc(a.driver_name || '—')}</td>
        <td class="num"><a href="#/jobs?status=&asset_id=${a.id}">${a.jobs}</a></td><td class="num">${sar(a.cost_h)}</td><td>${isSupv() ? `<button class="btn sm" data-edit="${a.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing added yet — add the delivery vans first.</td></tr>'}
      </tbody></table></div></div></div>`;
  if (!isSupv()) return;
  const edit = async (a) => {
    const v = await formModal({ title: a ? `Edit ${a.name}` : 'Add vehicle or equipment', ok: 'Save', fields: [
      { name: 'kind', label: 'Type', value: a?.kind || 'VEHICLE', options: [['VEHICLE', 'Vehicle'], ['EQUIPMENT', 'Equipment']] },
      { name: 'name', label: 'Name', value: a?.name, required: true, placeholder: 'e.g. Van 1 / Walk-in freezer' },
      { name: 'tag', label: 'Plate / serial no.', value: a?.tag },
      { name: 'location_type', label: 'Kept at', value: a?.location_type || 'COMPANY', options: Object.entries(LOC_LABEL) },
      { name: 'branch_id', label: 'Branch (if kept at a branch)', value: a?.branch_id, options: [['', '—'], ...m.branches.map((b) => [b.id, b.branch_name])] },
      { name: 'driver_id', label: 'Driver (vehicles)', value: a?.driver_id, options: [['', '—'], ...drivers.map((d) => [d.id, d.name])] },
      { name: 'notes', label: 'Notes', value: a?.notes, full: true },
      ...(a ? [{ name: 'active', label: 'Status', value: a.active ? '1' : '', options: [['1', 'Active'], ['', 'Inactive']] }] : []),
    ] });
    if (!v) return;
    if (a) v.active = !!v.active;
    try { await api(a ? 'PUT' : 'POST', '/api/maint/assets' + (a ? '/' + a.id : ''), v); state.mmeta = null; toast('Saved'); router(); } catch (err) { toast(err.message, true); }
  };
  $('#aadd', main).onclick = () => edit(null);
  main.addEventListener('click', (e) => { const i = e.target.dataset.edit; if (i) edit(list.find((a) => String(a.id) === i)); });
}

async function Technicians(main) {
  const list = await GET('/api/maint/technicians');
  main.innerHTML = head('Technicians', 'Own maintenance staff — each has a login to see and finish their jobs', '<button class="btn primary" id="tadd">Add technician</button>') + `<div class="stack">
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Name</th><th>Login</th><th class="num">Open jobs</th><th class="num">Overdue</th><th class="num">Done (30 days)</th><th></th></tr></thead><tbody>
      ${list.map((t) => `<tr class="${t.active ? '' : 'muted'}"><td><b>${esc(t.name)}</b>${t.active ? '' : ' (inactive)'}</td><td>${esc(t.email)}</td>
        <td class="num"><a href="#/jobs?status=ASSIGNED,IN_PROGRESS&tech_id=${t.id}">${t.open_jobs}</a></td><td class="num ${t.overdue ? 'neg' : ''}">${t.overdue}</td><td class="num">${t.done_30d}</td>
        <td><button class="btn sm ${t.active ? 'ghost' : ''}" data-act="${t.id}" data-on="${t.active ? '' : '1'}">${t.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No technicians.</td></tr>'}
      </tbody></table></div>
      <div class="card-b muted">Outside contractors are added on a job ("new contractor"). Their bank details are kept by accounts under Company &amp; Suppliers.</div></div></div>`;
  $('#tadd', main).onclick = async () => {
    const v = await formModal({ title: 'Add technician', ok: 'Create login', fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Login email', type: 'email', required: true, placeholder: 'name@spicymeal.sa' },
      { name: 'password', label: 'First password (min 8)', required: true, value: 'SpicyMeal@2026' }] });
    if (v) { try { await api('POST', '/api/maint/technicians', v); state.mmeta = null; toast('Technician added'); router(); } catch (err) { toast(err.message, true); } }
  };
  main.addEventListener('click', (e) => {
    const i = e.target.dataset.act;
    if (i) busy(e.target, async () => { await api('PUT', '/api/maint/technicians/' + i, { active: !!e.target.dataset.on }); state.mmeta = null; router(); });
  });
}

async function MaintCosts(main, _p, query) {
  const t = state.me.today;
  const f = { from: query.from || t.slice(0, 8) + '01', to: query.to || t };
  const r = await GET('/api/maint/costs?' + qs(f));
  const grp = (title, rows) => `<div class="card"><div class="card-h"><h2>${title}</h2></div><table class="t compact"><tbody>
    ${rows.map((g) => `<tr><td>${esc(g.label)}</td><td class="num muted">${g.jobs} job(s)</td><td class="num"><b>${sar(g.cost_h)}</b></td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</tbody></table></div>`;
  main.innerHTML = head('Maintenance Costs', `Finished jobs ${fmtDate(r.from)} – ${fmtDate(r.to)} · SAR excl. VAT`, exportBtns()) + `<div class="stack">
    ${filterForm('mcf', `<label class="f">From<input class="input" type="date" name="from" value="${f.from}"></label><label class="f">To<input class="input" type="date" name="to" value="${f.to}"></label>`)}
    ${r.no_cost ? `<div class="note warn">${r.no_cost} finished job(s) have no cost entered.</div>` : ''}
    <div class="card card-b summary"><div><div class="k">Total</div><div class="v">${sar(r.total_h)}</div></div><div><div class="k">Contractors</div><div class="v">${sar(r.contractor_h)}</div></div>
      <div><div class="k">Own technicians</div><div class="v">${sar(r.total_h - r.contractor_h)}</div></div><div><div class="k">Jobs finished</div><div class="v">${r.jobs.length}</div></div></div>
    <div class="grid2">${grp('By type', r.by_category)}${grp('By place', r.by_location)}${grp('By contractor', r.by_contractor)}${grp('By vehicle / equipment', r.by_asset)}</div>
    <div class="card"><div class="card-h"><h2>Jobs</h2></div><div class="tbl-wrap"><table class="t">${jobHead({ cost: true })}<tbody>
      ${r.jobs.map((j) => jobRow(j, { cost: true })).join('') || '<tr><td colspan="7" class="empty">No finished jobs in this period.</td></tr>'}</tbody></table></div></div></div>`;
  onFilter(main, 'mcf', '#/maint-costs');
  clickRows(main);
  wireExport(main, `maintenance-costs-${r.from}-to-${r.to}`, () => [
    { name: 'Jobs', title: `Maintenance costs ${r.from} to ${r.to} (SAR excl. VAT)`, header: ['Job', 'Done', 'Type', 'Problem', 'Where', 'Vehicle / equipment', 'Technician', 'Contractor', 'Invoice', 'Cost'],
      rows: r.jobs.map((j) => [j.number, j.done_at.slice(0, 10), j.category_label, j.title, j.location_name, j.asset_name || '', j.tech_name || '', j.contractor_name || '', j.invoice_no || '', sarNum(j.cost_h)]),
      footer: [['Total', '', '', '', '', '', '', '', '', sarNum(r.total_h)]] },
    { name: 'By type', header: ['Type', 'Jobs', 'Cost'], rows: r.by_category.map((g) => [g.label, g.jobs, sarNum(g.cost_h)]) },
    { name: 'By place', header: ['Place', 'Jobs', 'Cost'], rows: r.by_location.map((g) => [g.label, g.jobs, sarNum(g.cost_h)]) },
    { name: 'By contractor', header: ['Contractor', 'Jobs', 'Cost'], rows: r.by_contractor.map((g) => [g.label, g.jobs, sarNum(g.cost_h)]) },
  ]);
}

// ───────────────────────── accounts: contractor bills ─────────────────────────
async function MaintBills(main, _p, query) {
  const st = query.status ?? 'INCOMPLETE,TO_CHECK';
  const list = await GET('/api/maint/bills?' + qs({ status: st }));
  const tabs = [['INCOMPLETE,TO_CHECK', 'Needs checking'], ['MATCHED', 'Checked'], ['IN_REQUEST', 'In payment request'], ['PAID', 'Paid'], ['', 'All']];
  main.innerHTML = head('Maintenance Bills', 'Contractor bills from maintenance jobs — check them, then add them to a payment request', exportBtns(false)) + `<div class="stack">
    <div class="seg no-print">${tabs.map(([v, l]) => `<a href="#/maint-bills?status=${v}" class="${v === st ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="card"><div class="tbl-wrap"><table class="t">
      <thead><tr><th>Job</th><th>Contractor</th><th>Work</th><th>Where</th><th>Invoice no.</th><th>Status</th><th class="num">Amount SAR</th></tr></thead><tbody>
      ${list.map((j) => `<tr class="click" data-href="#/maintenance/${j.id}"><td><b>${esc(j.number)}</b><div class="muted">${j.done_at ? 'done ' + fmtDate(j.done_at.slice(0, 10)) : M_STATE[j.status][0]}</div></td>
        <td><b>${esc(j.contractor_name)}</b></td><td>${esc(j.title)}<div class="muted">${esc(j.category_label)}</div></td><td>${whereCell(j)}</td>
        <td>${j.invoice_no ? esc(j.invoice_no) : '<span class="neg">missing</span>'}</td><td>${billBadge(j.bill_state)}${j.request_number ? `<div><a href="#/requests/${j.request_id}">${esc(j.request_number)}</a></div>` : ''}</td>
        <td class="num"><b>${sar(j.cost_h)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No bills here.</td></tr>'}</tbody></table></div></div></div>`;
  clickRows(main);
  wireExport(main, `maintenance-bills-${state.me.today}`, () => [{ name: 'Bills', header: ['Job', 'Done', 'Contractor', 'Work', 'Type', 'Where', 'Invoice', 'Status', 'Amount', 'Payment request'],
    rows: list.map((j) => [j.number, j.done_at ? j.done_at.slice(0, 10) : '', j.contractor_name, j.title, j.category_label, j.location_name, j.invoice_no || '', BILL_STATE[j.bill_state]?.[0] || '', sarNum(j.cost_h), j.request_number || '']) }]);
}
