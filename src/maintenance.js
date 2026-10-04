'use strict';
// Maintenance: requests (anyone) and mandatory jobs (supervisor), technicians / contractors,
// repeating schedules, government documents with expiry dates, and costs that feed payment requests.

const S = require('./services');
const { AppError, money, audit, assertOpen, id, reqDate, bad, notFound, conflict, IN, now, today, addDays, whOf } = S;

const SUP = 'MAINT_SUPERVISOR';
const TECH = 'TECHNICIAN';
const ACC = 'ACCOUNTANT';
const CFO = 'CFO';

const CATEGORIES = [
  ['VEHICLE', 'Cars & vehicles'], ['HARDWARE', 'Hardware & equipment'], ['SOFTWARE', 'Software & systems'],
  ['LIGHTING', 'Lights'], ['SWITCHES', 'Switches & sockets'], ['ELECTRICAL', 'Electricity'],
  ['PLUMBING', 'Plumbing'], ['GOVERNMENT', 'Government requirements'], ['OTHER', 'Other'],
];
const CAT = new Map(CATEGORIES);
const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
const DOC_TYPES = ['Municipality license (Baladiya)', 'Civil Defense certificate', 'Commercial Registration (CR)', 'Chamber of Commerce',
  'Health certificates', 'Vehicle registration (Istimara)', 'Vehicle insurance', 'Periodic vehicle inspection (Fahas)', 'Operating card', 'Other'];
const LOCS = ['BRANCH', 'WAREHOUSE', 'FACTORY', 'COMPANY'];
const OPEN_STATES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE'];
const ACTIVE_PR = "('SUBMITTED','APPROVED','PAID')";

const str = (v, max) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const isSup = (u) => u.role === SUP;
const canSeeAll = (u) => [SUP, ACC, CFO].includes(u.role);
const supOnly = (u) => { if (!isSup(u)) throw new AppError(403, 'Only the maintenance supervisor can do this'); };
const riyadhDate = (col) => `date(${col}, '+3 hours')`;

const LOC_NAME = `CASE j.location_type WHEN 'BRANCH' THEN b.branch_name WHEN 'WAREHOUSE' THEN 'Warehouse' WHEN 'FACTORY' THEN 'Factory' ELSE 'Company' END`;
const JOB_SELECT = `
  SELECT j.*, ${LOC_NAME} AS location_name, a.name AS asset_name, a.tag AS asset_tag,
    ur.name AS requested_by_name, ur.role AS requested_by_role, ut.name AS tech_name, s.supplier_name AS contractor_name,
    ud.name AS done_by_name, uc.name AS closed_by_name, um.name AS matched_by_name,
    (SELECT pr.number FROM payment_request_jobs x JOIN payment_requests pr ON pr.id=x.request_id WHERE x.job_id=j.id AND pr.status IN ${ACTIVE_PR} ORDER BY pr.id DESC LIMIT 1) AS request_number,
    (SELECT pr.status FROM payment_request_jobs x JOIN payment_requests pr ON pr.id=x.request_id WHERE x.job_id=j.id AND pr.status IN ${ACTIVE_PR} ORDER BY pr.id DESC LIMIT 1) AS request_status,
    (SELECT pr.id FROM payment_request_jobs x JOIN payment_requests pr ON pr.id=x.request_id WHERE x.job_id=j.id AND pr.status IN ${ACTIVE_PR} ORDER BY pr.id DESC LIMIT 1) AS request_id
  FROM maint_jobs j
  LEFT JOIN branches b ON b.id=j.branch_id
  LEFT JOIN maint_assets a ON a.id=j.asset_id
  JOIN users ur ON ur.id=j.requested_by
  LEFT JOIN users ut ON ut.id=j.tech_id
  LEFT JOIN suppliers s ON s.id=j.contractor_id
  LEFT JOIN users ud ON ud.id=j.done_by
  LEFT JOIN users uc ON uc.id=j.closed_by
  LEFT JOIN users um ON um.id=j.matched_by`;

// Which jobs a user may see.
function scope(user) {
  if (canSeeAll(user)) return { sql: '1=1', p: [] };
  if (user.role === TECH) return { sql: 'j.tech_id=?', p: [user.id] };
  if (user.role === 'BRANCH') return { sql: "(j.location_type='BRANCH' AND j.branch_id=?)", p: [user.branch_id] };
  if (user.role === 'WAREHOUSE_MANAGER') return { sql: '(j.location_type=? OR j.requested_by=?)', p: [whOf(user) === 2 ? 'FACTORY' : 'WAREHOUSE', user.id] };
  if (user.role === 'DRIVER') return { sql: '(j.requested_by=? OR a.driver_id=?)', p: [user.id, user.driver_id || -1] };
  throw new AppError(403, 'No access to maintenance');
}

function billState(j) {
  if (!j.contractor_id || j.cost_h == null) return null;
  if (j.request_status === 'PAID') return 'PAID';
  if (j.request_status) return 'IN_REQUEST';
  if (j.matched_at) return 'MATCHED';
  if (!j.invoice_no || !['DONE', 'CLOSED'].includes(j.status)) return 'INCOMPLETE';
  return 'TO_CHECK';
}
const decorate = (j, t = today()) => {
  j.category_label = CAT.get(j.category) || j.category;
  j.overdue = !!(j.due_date && j.due_date < t && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(j.status));
  j.bill_state = billState(j);
  return j;
};

// ───────────────────────── reference data ─────────────────────────
function assetsFor(db, user) {
  const rows = db.prepare(`SELECT a.*, b.branch_name, d.name AS driver_name FROM maint_assets a
    LEFT JOIN branches b ON b.id=a.branch_id LEFT JOIN drivers d ON d.id=a.driver_id
    WHERE a.active=1 ORDER BY a.kind DESC, a.name`).all();
  if (canSeeAll(user) || user.role === TECH) return rows;
  if (user.role === 'BRANCH') return rows.filter((a) => a.location_type === 'BRANCH' && a.branch_id === user.branch_id);
  if (user.role === 'WAREHOUSE_MANAGER') return rows.filter((a) => a.kind === 'VEHICLE' || a.location_type === (whOf(user) === 2 ? 'FACTORY' : 'WAREHOUSE'));
  if (user.role === 'DRIVER') return rows.filter((a) => a.kind === 'VEHICLE').sort((x, y) => (y.driver_id === user.driver_id) - (x.driver_id === user.driver_id));
  return [];
}

function meta(db, user) {
  const out = { categories: CATEGORIES.map(([code, label]) => ({ code, label })), priorities: PRIORITIES, doc_types: DOC_TYPES, assets: assetsFor(db, user) };
  if (canSeeAll(user)) {
    out.branches = db.prepare('SELECT id, branch_name FROM branches WHERE active=1 ORDER BY branch_name').all();
    out.technicians = db.prepare(`SELECT id, name, email, active FROM users WHERE role='TECHNICIAN' ORDER BY active DESC, name`).all();
    out.contractors = db.prepare('SELECT id, supplier_name, phone, active FROM suppliers ORDER BY active DESC, supplier_name').all();
  }
  return out;
}

// Location: requesters are pinned to their own place; the supervisor chooses.
function resolveLocation(db, user, body) {
  let asset = null;
  if (body.asset_id) {
    asset = db.prepare('SELECT * FROM maint_assets WHERE id=? AND active=1').get(id(body.asset_id, 'asset'));
    if (!asset) throw bad('Unknown vehicle / equipment');
    if (!isSup(user) && !assetsFor(db, user).some((a) => a.id === asset.id)) throw bad('You cannot report on that vehicle / equipment');
  }
  let loc, branchId = null;
  if (user.role === 'BRANCH') { loc = 'BRANCH'; branchId = user.branch_id; }
  else if (user.role === 'WAREHOUSE_MANAGER') {
    if (asset && asset.kind === 'VEHICLE') { loc = asset.location_type; branchId = asset.branch_id; }
    else loc = whOf(user) === 2 ? 'FACTORY' : 'WAREHOUSE';
  } else if (user.role === 'DRIVER') {
    if (!asset) throw bad('Choose the vehicle');
    loc = asset.location_type; branchId = asset.branch_id;
  } else {
    loc = body.location_type || asset?.location_type;
    if (!LOCS.includes(loc)) throw bad('Choose where the work is');
    if (loc === 'BRANCH') {
      branchId = body.branch_id ? id(body.branch_id, 'branch') : asset?.branch_id;
      if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id=?').get(branchId)) throw bad('Choose the branch');
    }
  }
  return { location_type: loc, branch_id: loc === 'BRANCH' ? branchId : null, asset_id: asset?.id ?? null };
}

function contractorId(db, user, { contractor_id, contractor_name }) {
  if (contractor_id) {
    const cid = id(contractor_id, 'contractor');
    if (!db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(cid)) throw bad('Unknown contractor');
    return cid;
  }
  const n = str(contractor_name, 120);
  if (!n) return null;
  const ex = db.prepare('SELECT id FROM suppliers WHERE supplier_name=?').get(n);
  if (ex) return ex.id;
  const cid = Number(db.prepare('INSERT INTO suppliers (supplier_name) VALUES (?)').run(n).lastInsertRowid);
  audit(db, user, 'SUPPLIER_ADDED', 'supplier', cid, `Contractor ${n} added from maintenance`);
  return cid;
}
function techId(db, v) {
  if (!v) return null;
  const t = db.prepare("SELECT id FROM users WHERE id=? AND role='TECHNICIAN' AND active=1").get(id(v, 'technician'));
  if (!t) throw bad('Unknown technician');
  return t.id;
}

function nextNumber(db) {
  const y = today().slice(0, 4);
  const last = db.prepare('SELECT number FROM maint_jobs WHERE number LIKE ? ORDER BY id DESC LIMIT 1').get(`MJ-${y}-%`);
  return `MJ-${y}-${String(last ? Number(last.number.split('-')[2]) + 1 : 1).padStart(4, '0')}`;
}
const note = (db, user, jobId, text) => db.prepare('INSERT INTO maint_job_notes (job_id, user_id, at, note) VALUES (?,?,?,?)').run(jobId, user?.id ?? null, now(), String(text).slice(0, 1000));

// ───────────────────────── jobs ─────────────────────────
function insertJob(db, user, f) {
  const number = nextNumber(db);
  const assigned = f.tech_id || f.contractor_id;
  const jid = Number(db.prepare(`INSERT INTO maint_jobs (number, kind, category, priority, title, description, location_type, branch_id, asset_id,
      schedule_id, document_id, status, requested_by, requested_at, due_date, tech_id, contractor_id, assigned_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, f.kind, f.category, f.priority, f.title, f.description, f.location_type, f.branch_id,
    f.asset_id, f.schedule_id ?? null, f.document_id ?? null, assigned ? 'ASSIGNED' : 'OPEN', f.requested_by, now(), f.due_date,
    f.tech_id, f.contractor_id, assigned ? now() : null).lastInsertRowid);
  audit(db, user, f.kind === 'MANDATORY' ? 'MAINT_SCHEDULED' : 'MAINT_REQUESTED', 'maint_job', jid, `${number} ${f.kind === 'MANDATORY' ? 'mandatory job' : 'request'}: ${f.title}`);
  return jid;
}

function createJob(db, user, body) {
  scope(user);
  if (user.role === TECH) throw new AppError(403, 'Technicians cannot open jobs — ask the supervisor');
  if ([ACC, CFO].includes(user.role)) throw new AppError(403, 'Accounts cannot open maintenance jobs');
  const category = String(body.category || '');
  if (!CAT.has(category)) throw bad('Choose a category');
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'NORMAL';
  const title = str(body.title, 150);
  if (!title) throw bad('Describe the problem in a few words');
  const kind = isSup(user) && body.kind === 'MANDATORY' ? 'MANDATORY' : 'REQUEST';
  return db.tx(() => {
    const loc = resolveLocation(db, user, body);
    const f = { kind, category, priority, title, description: str(body.description, 2000), ...loc, requested_by: user.id,
      due_date: body.due_date ? reqDate(body.due_date, 'due date') : null, tech_id: null, contractor_id: null };
    if (isSup(user)) { f.tech_id = techId(db, body.tech_id); f.contractor_id = contractorId(db, user, body); }
    if (body.document_id && isSup(user)) f.document_id = id(body.document_id, 'document');
    const jid = insertJob(db, user, f);
    return getJob(db, user, jid);
  });
}

function listJobs(db, user, q = {}) {
  const sc = scope(user);
  if (isSup(user)) generateDue(db);
  const where = [sc.sql]; const p = [...sc.p];
  if (q.status) { const st = String(q.status).split(','); where.push(`j.status IN (${IN(st)})`); p.push(...st); }
  if (q.category) { where.push('j.category=?'); p.push(q.category); }
  if (q.kind) { where.push('j.kind=?'); p.push(q.kind); }
  if (q.location) {
    const [t, bid] = String(q.location).split(':');
    where.push('j.location_type=?'); p.push(t);
    if (bid) { where.push('j.branch_id=?'); p.push(Number(bid)); }
  }
  if (q.tech_id) { where.push('j.tech_id=?'); p.push(Number(q.tech_id)); }
  if (q.asset_id) { where.push('j.asset_id=?'); p.push(Number(q.asset_id)); }
  if (q.q) { where.push('(j.title LIKE ? OR j.number LIKE ? OR j.description LIKE ?)'); const s = `%${String(q.q).slice(0, 60)}%`; p.push(s, s, s); }
  if (q.overdue === '1') { where.push("j.due_date < ? AND j.status IN ('OPEN','ASSIGNED','IN_PROGRESS')"); p.push(today()); }
  if (q.from) { where.push(`${riyadhDate('j.requested_at')} >= ?`); p.push(reqDate(q.from, 'from')); }
  if (q.to) { where.push(`${riyadhDate('j.requested_at')} <= ?`); p.push(reqDate(q.to, 'to')); }
  const order = user.role === TECH || q.sort === 'work'
    ? `CASE j.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'ASSIGNED' THEN 1 WHEN 'OPEN' THEN 2 WHEN 'DONE' THEN 3 ELSE 4 END,
       CASE j.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, COALESCE(j.due_date,'9999'), j.id`
    : 'j.id DESC';
  const t = today();
  return db.prepare(`${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`).all(...p).map((j) => decorate(j, t));
}

function loadJob(db, user, jobId) {
  const sc = scope(user);
  const j = db.prepare(`${JOB_SELECT} WHERE j.id=? AND ${sc.sql}`).get(id(jobId), ...sc.p);
  if (!j) throw notFound('Job not found');
  return decorate(j);
}

function getJob(db, user, jobId) {
  const j = loadJob(db, user, jobId);
  j.notes = db.prepare(`SELECT n.at, n.note, u.name AS user_name, u.role AS user_role FROM maint_job_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.job_id=? ORDER BY n.id`).all(j.id);
  j.history = db.prepare(`SELECT a.at, a.summary, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.entity='maint_job' AND a.entity_id=? ORDER BY a.id`).all(j.id);
  if (j.document_id) j.document = db.prepare('SELECT id, doc_type, title, reference_no, expires_on FROM maint_documents WHERE id=?').get(j.document_id);
  const sup = isSup(user);
  const mineTech = user.role === TECH && j.tech_id === user.id;
  const locked = !!j.request_status || !!j.matched_at;
  j.can = {
    edit: sup && OPEN_STATES.includes(j.status),
    start: (sup || mineTech) && j.status === 'ASSIGNED',
    finish: (sup || mineTech) && ['ASSIGNED', 'IN_PROGRESS'].includes(j.status),
    close: sup && j.status === 'DONE',
    send_back: sup && j.status === 'DONE',
    reject: sup && ['OPEN', 'ASSIGNED'].includes(j.status),
    cancel: (sup && ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(j.status)) || (j.requested_by === user.id && j.status === 'OPEN'),
    note: !['REJECTED', 'CANCELLED'].includes(j.status) && ![ACC, CFO].includes(user.role),
    cost: (sup || user.role === ACC) && !['REJECTED', 'CANCELLED'].includes(j.status) && !locked,
    check: user.role === ACC && !!j.contractor_id && j.cost_h != null && ['DONE', 'CLOSED'].includes(j.status) && !j.request_status,
  };
  return j;
}

function transition(db, user, jobId, from, to, fields, action, summary, noteText) {
  return db.tx(() => {
    const j = loadJob(db, user, jobId);
    if (!from.includes(j.status)) throw conflict(`This job is ${j.status.toLowerCase().replace('_', ' ')}`);
    const keys = Object.keys(fields);
    db.prepare(`UPDATE maint_jobs SET status=?${keys.map((k) => `, ${k}=?`).join('')} WHERE id=?`).run(to, ...keys.map((k) => fields[k]), j.id);
    if (noteText) note(db, user, j.id, noteText);
    audit(db, user, action, 'maint_job', j.id, `${j.number} ${summary}`);
    return j;
  });
}

function updateJob(db, user, jobId, body) {
  supOnly(user);
  return db.tx(() => {
    const j = loadJob(db, user, jobId);
    if (!OPEN_STATES.includes(j.status)) throw conflict('This job is finished');
    const set = {}; const changes = [];
    if (body.priority !== undefined) { if (!PRIORITIES.includes(body.priority)) throw bad('Invalid priority'); if (body.priority !== j.priority) { set.priority = body.priority; changes.push(`priority ${j.priority}→${body.priority}`); } }
    if (body.category !== undefined) { if (!CAT.has(body.category)) throw bad('Invalid category'); if (body.category !== j.category) { set.category = body.category; changes.push(`category → ${CAT.get(body.category)}`); } }
    if (body.title !== undefined) { const t = str(body.title, 150); if (!t) throw bad('Title is required'); if (t !== j.title) set.title = t; }
    if (body.description !== undefined) set.description = str(body.description, 2000);
    if (body.due_date !== undefined) { const d = body.due_date ? reqDate(body.due_date, 'due date') : null; if (d !== j.due_date) { set.due_date = d; changes.push(`due ${d || 'none'}`); } }
    if (body.tech_id !== undefined) { const t = techId(db, body.tech_id); if (t !== j.tech_id) { set.tech_id = t; changes.push(`technician → ${t ? db.prepare('SELECT name FROM users WHERE id=?').get(t).name : 'none'}`); } }
    if (body.contractor_id !== undefined || body.contractor_name !== undefined) {
      const c = contractorId(db, user, body);
      if (c !== j.contractor_id) {
        if (j.request_status || j.matched_at) throw conflict('The contractor bill is already checked / requested — cannot change the contractor');
        set.contractor_id = c; changes.push(`contractor → ${c ? db.prepare('SELECT supplier_name n FROM suppliers WHERE id=?').get(c).n : 'none'}`);
      }
    }
    const tech = 'tech_id' in set ? set.tech_id : j.tech_id;
    const con = 'contractor_id' in set ? set.contractor_id : j.contractor_id;
    if (j.status === 'OPEN' && (tech || con)) { set.status = 'ASSIGNED'; set.assigned_at = now(); }
    if (j.status === 'ASSIGNED' && !tech && !con) { set.status = 'OPEN'; set.assigned_at = null; }
    const keys = Object.keys(set);
    if (keys.length) db.prepare(`UPDATE maint_jobs SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map((k) => set[k]), j.id);
    if (changes.length) audit(db, user, set.status === 'ASSIGNED' ? 'MAINT_ASSIGNED' : 'MAINT_UPDATED', 'maint_job', j.id, `${j.number}: ${changes.join(', ')}`);
    return getJob(db, user, j.id);
  });
}

function addNote(db, user, jobId, { note: text }) {
  const t = str(text, 1000);
  if (!t) throw bad('Write a note');
  const j = getJob(db, user, jobId);
  if (!j.can.note) throw conflict('Notes cannot be added to this job');
  note(db, user, j.id, t);
  return getJob(db, user, j.id);
}

const startJob = (db, user, jobId) => {
  const j = getJob(db, user, jobId);
  if (!j.can.start) throw new AppError(403, 'You cannot start this job');
  transition(db, user, j.id, ['ASSIGNED'], 'IN_PROGRESS', { started_at: now() }, 'MAINT_STARTED', 'work started');
  return getJob(db, user, j.id);
};

function finishJob(db, user, jobId, { work_note }) {
  const j = getJob(db, user, jobId);
  if (!j.can.finish) throw new AppError(403, 'You cannot finish this job');
  const w = str(work_note, 1000);
  if (!w) throw bad('Write what was done');
  transition(db, user, j.id, ['ASSIGNED', 'IN_PROGRESS'], 'DONE', { done_at: now(), done_by: user.id, work_note: w, started_at: j.started_at || now() }, 'MAINT_DONE', 'work done', `Work done: ${w}`);
  return getJob(db, user, j.id);
}

function closeJob(db, user, jobId, { note: text, new_expires_on, new_reference_no }) {
  supOnly(user);
  return db.tx(() => {
    const j = loadJob(db, user, jobId);
    if (j.document_id && new_expires_on) renewDocument(db, user, j.document_id, { expires_on: new_expires_on, reference_no: new_reference_no, note: `Renewed by ${j.number}` });
    transition(db, user, j.id, ['DONE'], 'CLOSED', { closed_at: now(), closed_by: user.id }, 'MAINT_CLOSED', 'checked and closed', str(text, 500) && `Closed: ${str(text, 500)}`);
    return getJob(db, user, j.id);
  });
}
function sendBack(db, user, jobId, { reason }) {
  supOnly(user);
  const r = str(reason, 500);
  if (!r) throw bad('Say what still needs doing');
  transition(db, user, jobId, ['DONE'], 'IN_PROGRESS', { done_at: null, done_by: null }, 'MAINT_SENT_BACK', `sent back: ${r}`, `Sent back: ${r}`);
  return getJob(db, user, jobId);
}
function rejectJob(db, user, jobId, { reason }) {
  supOnly(user);
  const r = str(reason, 500);
  if (!r) throw bad('A reason is required');
  transition(db, user, jobId, ['OPEN', 'ASSIGNED'], 'REJECTED', { reject_reason: r, closed_at: now(), closed_by: user.id }, 'MAINT_REJECTED', `rejected: ${r}`);
  return getJob(db, user, jobId);
}
function cancelJob(db, user, jobId, { reason } = {}) {
  const j = getJob(db, user, jobId);
  if (!j.can.cancel) throw new AppError(403, 'You cannot cancel this job');
  transition(db, user, j.id, ['OPEN', 'ASSIGNED', 'IN_PROGRESS'], 'CANCELLED', { closed_at: now(), closed_by: user.id }, 'MAINT_CANCELLED', `cancelled${str(reason, 300) ? `: ${str(reason, 300)}` : ''}`);
  return getJob(db, user, j.id);
}

function setJobCost(db, user, jobId, { cost, invoice_no }) {
  if (![SUP, ACC].includes(user.role)) throw new AppError(403, 'Only the supervisor or accounts can enter costs');
  return db.tx(() => {
    const j = getJob(db, user, jobId);
    if (!j.can.cost) throw conflict(j.request_status ? `This bill is in payment request ${j.request_number}` : j.matched_at ? 'Remove the accounts check first' : 'Costs cannot be changed on this job');
    assertOpen(db, (j.done_at ? new Date(Date.parse(j.done_at) + 3 * 3600e3).toISOString() : today()).slice(0, 10));
    const c = cost === undefined ? j.cost_h : money(cost, 'cost');
    const inv = invoice_no === undefined ? j.invoice_no : str(invoice_no, 60);
    if (c === j.cost_h && inv === j.invoice_no) return j;
    db.prepare('UPDATE maint_jobs SET cost_h=?, invoice_no=? WHERE id=?').run(c, inv, j.id);
    audit(db, user, 'MAINT_COST', 'maint_job', j.id, `${j.number} cost ${j.cost_h == null ? '—' : (j.cost_h / 100).toFixed(2)}→${c == null ? '—' : (c / 100).toFixed(2)}${inv ? ` (invoice ${inv})` : ''}`);
    return getJob(db, user, j.id);
  });
}

function checkJobBill(db, user, jobId, { matched }) {
  if (user.role !== ACC) throw new AppError(403, 'Only the accountant can do this');
  return db.tx(() => {
    const j = getJob(db, user, jobId);
    if (j.request_status) throw conflict(`This bill is in payment request ${j.request_number}`);
    if (matched) {
      if (!j.contractor_id) throw bad('No contractor on this job');
      if (j.cost_h == null) throw bad('Enter the cost first');
      if (!j.invoice_no) throw bad('Enter the contractor invoice number first');
      if (!['DONE', 'CLOSED'].includes(j.status)) throw bad('The work is not finished yet');
      db.prepare('UPDATE maint_jobs SET matched_at=?, matched_by=? WHERE id=?').run(now(), user.id, j.id);
      audit(db, user, 'MAINT_BILL_CHECKED', 'maint_job', j.id, `${j.number} contractor bill ${j.invoice_no} checked: SAR ${(j.cost_h / 100).toFixed(2)}`);
    } else {
      db.prepare('UPDATE maint_jobs SET matched_at=NULL, matched_by=NULL WHERE id=?').run(j.id);
      audit(db, user, 'MAINT_BILL_UNCHECKED', 'maint_job', j.id, `${j.number} bill check removed`);
    }
    return getJob(db, user, j.id);
  });
}

// ───────────────────────── schedules (mandatory, repeating) ─────────────────────────
function addInterval(d, n, unit) {
  const x = new Date(d + 'T00:00:00Z');
  if (unit === 'DAY') x.setUTCDate(x.getUTCDate() + n);
  else if (unit === 'WEEK') x.setUTCDate(x.getUTCDate() + 7 * n);
  else { const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); x.setUTCDate(Math.min(day, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate())); }
  return x.toISOString().slice(0, 10);
}

// Creates the next job for every schedule that is due (one open job per schedule at a time).
function generateDue(db) {
  const t = today();
  let created = 0;
  const due = db.prepare('SELECT * FROM maint_schedules WHERE active=1 AND date(next_due, \'-\' || lead_days || \' days\') <= ?').all(t);
  if (!due.length) return 0;
  db.tx(() => {
    for (const s of due) {
      if (db.prepare(`SELECT 1 FROM maint_jobs WHERE schedule_id=? AND status IN (${IN(OPEN_STATES)})`).get(s.id, ...OPEN_STATES)) continue;
      const creator = { id: s.created_by };
      insertJob(db, creator, { kind: 'MANDATORY', category: s.category, priority: s.priority, title: s.title, description: s.details,
        location_type: s.location_type, branch_id: s.branch_id, asset_id: s.asset_id, schedule_id: s.id, due_date: s.next_due,
        requested_by: s.created_by, tech_id: s.tech_id, contractor_id: s.contractor_id });
      db.prepare('UPDATE maint_schedules SET next_due=? WHERE id=?').run(addInterval(s.next_due, s.every_n, s.every_unit), s.id);
      created++;
    }
  });
  return created;
}

function listSchedules(db, user) {
  if (!canSeeAll(user)) throw new AppError(403, 'Supervisor only');
  return db.prepare(`SELECT s.*, ${LOC_NAME.replace(/j\./g, 's.')} AS location_name, a.name AS asset_name, ut.name AS tech_name, sp.supplier_name AS contractor_name,
      (SELECT COUNT(*) FROM maint_jobs j WHERE j.schedule_id=s.id) AS jobs,
      (SELECT j.id FROM maint_jobs j WHERE j.schedule_id=s.id AND j.status IN (${IN(OPEN_STATES)}) ORDER BY j.id DESC LIMIT 1) AS open_job_id,
      (SELECT MAX(j.closed_at) FROM maint_jobs j WHERE j.schedule_id=s.id AND j.status='CLOSED') AS last_done
    FROM maint_schedules s LEFT JOIN branches b ON b.id=s.branch_id LEFT JOIN maint_assets a ON a.id=s.asset_id
    LEFT JOIN users ut ON ut.id=s.tech_id LEFT JOIN suppliers sp ON sp.id=s.contractor_id
    ORDER BY s.active DESC, s.next_due`).all(...OPEN_STATES).map((s) => ({ ...s, category_label: CAT.get(s.category) || s.category }));
}

function saveSchedule(db, user, scheduleId, body) {
  supOnly(user);
  return db.tx(() => {
    const cur = scheduleId ? db.prepare('SELECT * FROM maint_schedules WHERE id=?').get(id(scheduleId)) : null;
    if (scheduleId && !cur) throw notFound('Schedule not found');
    const v = { ...(cur || {}), ...body };
    const title = str(v.title, 150);
    if (!title) throw bad('Title is required');
    if (!CAT.has(v.category)) throw bad('Choose a category');
    const n = Number(v.every_n);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw bad('Repeat every: 1–365');
    if (!['DAY', 'WEEK', 'MONTH'].includes(v.every_unit)) throw bad('Choose days, weeks or months');
    const lead = Number(v.lead_days ?? 7);
    if (!Number.isInteger(lead) || lead < 0 || lead > 90) throw bad('Create-ahead days: 0–90');
    const loc = resolveLocation(db, user, { location_type: v.location_type, branch_id: v.branch_id, asset_id: v.asset_id });
    const row = [title, v.category, loc.location_type, loc.branch_id, loc.asset_id, n, v.every_unit, reqDate(v.next_due, 'next due date'), lead,
      PRIORITIES.includes(v.priority) ? v.priority : 'NORMAL', techId(db, v.tech_id), contractorId(db, user, v), str(v.details, 1000), v.active === false || v.active === 0 ? 0 : 1];
    let sid = cur?.id;
    if (cur) {
      db.prepare(`UPDATE maint_schedules SET title=?, category=?, location_type=?, branch_id=?, asset_id=?, every_n=?, every_unit=?, next_due=?, lead_days=?,
        priority=?, tech_id=?, contractor_id=?, details=?, active=? WHERE id=?`).run(...row, sid);
    } else {
      sid = Number(db.prepare(`INSERT INTO maint_schedules (title, category, location_type, branch_id, asset_id, every_n, every_unit, next_due, lead_days,
        priority, tech_id, contractor_id, details, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...row, user.id, now()).lastInsertRowid);
    }
    audit(db, user, cur ? 'MAINT_SCHEDULE_UPDATED' : 'MAINT_SCHEDULE_ADDED', 'maint_schedule', sid, `Schedule "${title}" every ${n} ${v.every_unit.toLowerCase()}(s), next ${row[7]}${row[13] ? '' : ' (paused)'}`);
    generateDue(db);
    return listSchedules(db, user).find((s) => s.id === sid);
  });
}

// ───────────────────────── documents (licenses, certificates) ─────────────────────────
function docStatus(d, t = today()) {
  if (d.expires_on < t) return 'EXPIRED';
  if (d.expires_on <= addDays(t, d.remind_days)) return 'EXPIRING';
  return 'VALID';
}
function listDocuments(db, user) {
  if (!canSeeAll(user)) throw new AppError(403, 'Supervisor only');
  const t = today();
  return db.prepare(`SELECT d.*, ${LOC_NAME.replace(/j\./g, 'd.')} AS location_name, a.name AS asset_name, a.tag AS asset_tag, u.name AS updated_by_name,
      (SELECT j.id FROM maint_jobs j WHERE j.document_id=d.id AND j.status IN (${IN(OPEN_STATES)}) ORDER BY j.id DESC LIMIT 1) AS open_job_id,
      (SELECT j.number FROM maint_jobs j WHERE j.document_id=d.id AND j.status IN (${IN(OPEN_STATES)}) ORDER BY j.id DESC LIMIT 1) AS open_job_number
    FROM maint_documents d LEFT JOIN branches b ON b.id=d.branch_id LEFT JOIN maint_assets a ON a.id=d.asset_id LEFT JOIN users u ON u.id=d.updated_by
    ORDER BY d.active DESC, d.expires_on`).all(...OPEN_STATES, ...OPEN_STATES)
    .map((d) => ({ ...d, status: d.active ? docStatus(d, t) : 'INACTIVE', days_left: Math.round((Date.parse(d.expires_on) - Date.parse(t)) / 864e5) }));
}

function saveDocument(db, user, docId, body) {
  supOnly(user);
  return db.tx(() => {
    const cur = docId ? db.prepare('SELECT * FROM maint_documents WHERE id=?').get(id(docId)) : null;
    if (docId && !cur) throw notFound('Document not found');
    const v = { ...(cur || {}), ...body };
    const type = str(v.doc_type, 80);
    if (!type) throw bad('Choose the document type');
    const title = str(v.title, 150) || type;
    const loc = resolveLocation(db, user, { location_type: v.location_type, branch_id: v.branch_id, asset_id: v.asset_id });
    const remind = Number(v.remind_days ?? 30);
    if (!Number.isInteger(remind) || remind < 0 || remind > 365) throw bad('Remind days: 0–365');
    const row = [type, title, str(v.reference_no, 80), loc.location_type, loc.branch_id, loc.asset_id, v.issued_on ? reqDate(v.issued_on, 'issue date') : null,
      reqDate(v.expires_on, 'expiry date'), remind, str(v.notes, 1000), v.active === false || v.active === 0 ? 0 : 1, user.id, now()];
    let did = cur?.id;
    if (cur) {
      db.prepare(`UPDATE maint_documents SET doc_type=?, title=?, reference_no=?, location_type=?, branch_id=?, asset_id=?, issued_on=?, expires_on=?,
        remind_days=?, notes=?, active=?, updated_by=?, updated_at=? WHERE id=?`).run(...row, did);
    } else {
      did = Number(db.prepare(`INSERT INTO maint_documents (doc_type, title, reference_no, location_type, branch_id, asset_id, issued_on, expires_on,
        remind_days, notes, active, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...row).lastInsertRowid);
    }
    audit(db, user, cur ? 'MAINT_DOC_UPDATED' : 'MAINT_DOC_ADDED', 'maint_document', did, `${title} (${type}) expires ${row[7]}`);
    return listDocuments(db, user).find((d) => d.id === did);
  });
}

function renewDocument(db, user, docId, { expires_on, reference_no, issued_on, note: text }) {
  supOnly(user);
  return db.tx(() => {
    const d = db.prepare('SELECT * FROM maint_documents WHERE id=?').get(id(docId));
    if (!d) throw notFound('Document not found');
    const exp = reqDate(expires_on, 'new expiry date');
    if (exp <= d.expires_on) throw bad('The new expiry date must be after the current one');
    const ref = reference_no === undefined || reference_no === '' ? d.reference_no : str(reference_no, 80);
    db.prepare('UPDATE maint_documents SET expires_on=?, reference_no=?, issued_on=?, updated_by=?, updated_at=? WHERE id=?')
      .run(exp, ref, issued_on ? reqDate(issued_on, 'issue date') : today(), user.id, now(), d.id);
    audit(db, user, 'MAINT_DOC_RENEWED', 'maint_document', d.id, `${d.title} renewed: ${d.expires_on} → ${exp}${ref !== d.reference_no ? ` (ref ${ref})` : ''}${str(text, 200) ? ` — ${str(text, 200)}` : ''}`);
    return { ok: true };
  });
}

function renewalJob(db, user, docId, body = {}) {
  supOnly(user);
  return db.tx(() => {
    const d = db.prepare('SELECT * FROM maint_documents WHERE id=?').get(id(docId));
    if (!d) throw notFound('Document not found');
    if (db.prepare(`SELECT 1 FROM maint_jobs WHERE document_id=? AND status IN (${IN(OPEN_STATES)})`).get(d.id, ...OPEN_STATES)) throw conflict('A renewal job is already open for this document');
    const jid = insertJob(db, user, { kind: 'MANDATORY', category: d.asset_id && /vehicle|istimara|fahas/i.test(d.doc_type) ? 'VEHICLE' : 'GOVERNMENT',
      priority: d.expires_on < today() ? 'URGENT' : 'HIGH', title: `Renew ${d.title}`, description: `${d.doc_type}${d.reference_no ? ` · ref ${d.reference_no}` : ''} · expires ${d.expires_on}`,
      location_type: d.location_type, branch_id: d.branch_id, asset_id: d.asset_id, document_id: d.id, requested_by: user.id,
      due_date: d.expires_on < today() ? today() : d.expires_on, tech_id: techId(db, body.tech_id), contractor_id: contractorId(db, user, body) });
    return getJob(db, user, jid);
  });
}

// ───────────────────────── assets & technicians ─────────────────────────
function listAssets(db, user) {
  if (!canSeeAll(user)) throw new AppError(403, 'Supervisor only');
  return db.prepare(`SELECT a.*, b.branch_name, d.name AS driver_name,
      (SELECT COUNT(*) FROM maint_jobs j WHERE j.asset_id=a.id) AS jobs,
      (SELECT COALESCE(SUM(j.cost_h),0) FROM maint_jobs j WHERE j.asset_id=a.id AND j.status NOT IN ('REJECTED','CANCELLED')) AS cost_h
    FROM maint_assets a LEFT JOIN branches b ON b.id=a.branch_id LEFT JOIN drivers d ON d.id=a.driver_id ORDER BY a.active DESC, a.kind DESC, a.name`).all();
}
function saveAsset(db, user, assetId, body) {
  supOnly(user);
  return db.tx(() => {
    const cur = assetId ? db.prepare('SELECT * FROM maint_assets WHERE id=?').get(id(assetId)) : null;
    if (assetId && !cur) throw notFound('Not found');
    const v = { ...(cur || {}), ...body };
    const name = str(v.name, 100);
    if (!name) throw bad('Name is required');
    if (!['VEHICLE', 'EQUIPMENT'].includes(v.kind)) throw bad('Choose vehicle or equipment');
    if (!LOCS.includes(v.location_type)) throw bad('Choose where it is kept');
    const bid = v.location_type === 'BRANCH' ? id(v.branch_id, 'branch') : null;
    const did = v.kind === 'VEHICLE' && v.driver_id ? id(v.driver_id, 'driver') : null;
    const row = [name, v.kind, str(v.tag, 40), v.location_type, bid, did, str(v.notes, 500), v.active === false || v.active === 0 || v.active === '' ? 0 : 1];
    let aid = cur?.id;
    if (cur) db.prepare('UPDATE maint_assets SET name=?, kind=?, tag=?, location_type=?, branch_id=?, driver_id=?, notes=?, active=? WHERE id=?').run(...row, aid);
    else aid = Number(db.prepare('INSERT INTO maint_assets (name, kind, tag, location_type, branch_id, driver_id, notes, active) VALUES (?,?,?,?,?,?,?,?)').run(...row).lastInsertRowid);
    audit(db, user, cur ? 'MAINT_ASSET_UPDATED' : 'MAINT_ASSET_ADDED', 'maint_asset', aid, `${v.kind === 'VEHICLE' ? 'Vehicle' : 'Equipment'} ${name}${row[2] ? ` (${row[2]})` : ''} ${cur ? 'updated' : 'added'}`);
    return { id: aid };
  });
}

function listTechnicians(db, user) {
  if (!canSeeAll(user)) throw new AppError(403, 'Supervisor only');
  return db.prepare(`SELECT u.id, u.name, u.email, u.active,
      (SELECT COUNT(*) FROM maint_jobs j WHERE j.tech_id=u.id AND j.status IN ('ASSIGNED','IN_PROGRESS')) AS open_jobs,
      (SELECT COUNT(*) FROM maint_jobs j WHERE j.tech_id=u.id AND j.status IN ('ASSIGNED','IN_PROGRESS') AND j.due_date < ?) AS overdue,
      (SELECT COUNT(*) FROM maint_jobs j WHERE j.tech_id=u.id AND j.status IN ('DONE','CLOSED') AND j.done_at >= ?) AS done_30d
    FROM users u WHERE u.role='TECHNICIAN' ORDER BY u.active DESC, u.name`).all(today(), new Date(Date.now() - 30 * 864e5).toISOString());
}
function addTechnician(db, user, { name, email, password }) {
  supOnly(user);
  const n = str(name, 80);
  const em = String(email || '').trim().toLowerCase();
  if (!n) throw bad('Name is required');
  if (!/^[^\s@]+@[^\s@]+$/.test(em)) throw bad('Invalid email');
  if (String(password || '').length < 8) throw bad('Password must be at least 8 characters');
  return db.tx(() => {
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) throw conflict('That email is already used');
    const { hashPassword } = require('./crypto');
    const uid = Number(db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'TECHNICIAN')").run(n, em, hashPassword(String(password))).lastInsertRowid);
    audit(db, user, 'TECHNICIAN_ADDED', 'user', uid, `Technician ${n} added (login ${em})`);
    return { id: uid };
  });
}
function setTechnicianActive(db, user, techUserId, { active }) {
  supOnly(user);
  const t = db.prepare("SELECT * FROM users WHERE id=? AND role='TECHNICIAN'").get(id(techUserId));
  if (!t) throw notFound('Technician not found');
  db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, t.id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);
  audit(db, user, 'TECHNICIAN_UPDATED', 'user', t.id, `Technician ${t.name} ${active ? 'activated' : 'deactivated'}`);
  return { ok: true };
}

// ───────────────────────── dashboards & reports ─────────────────────────
function supervisorHome(db, user) {
  if (!canSeeAll(user)) throw new AppError(403, 'Supervisor only');
  if (isSup(user)) generateDue(db);
  const t = today();
  const c = (sql, ...p) => db.prepare(sql).get(...p).n;
  const docs = listDocuments(db, user).filter((d) => d.active && d.status !== 'VALID');
  return {
    today: t,
    counts: {
      new: c("SELECT COUNT(*) n FROM maint_jobs WHERE status='OPEN'"),
      assigned: c("SELECT COUNT(*) n FROM maint_jobs WHERE status='ASSIGNED'"),
      in_progress: c("SELECT COUNT(*) n FROM maint_jobs WHERE status='IN_PROGRESS'"),
      to_close: c("SELECT COUNT(*) n FROM maint_jobs WHERE status='DONE'"),
      overdue: c("SELECT COUNT(*) n FROM maint_jobs WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS') AND due_date < ?", t),
      urgent: c("SELECT COUNT(*) n FROM maint_jobs WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS') AND priority='URGENT'"),
      docs_expired: docs.filter((d) => d.status === 'EXPIRED').length,
      docs_expiring: docs.filter((d) => d.status === 'EXPIRING').length,
      closed_30d: c("SELECT COUNT(*) n FROM maint_jobs WHERE status='CLOSED' AND closed_at >= ?", new Date(Date.now() - 30 * 864e5).toISOString()),
    },
    by_category: db.prepare("SELECT category, COUNT(*) n FROM maint_jobs WHERE status IN ('OPEN','ASSIGNED','IN_PROGRESS','DONE') GROUP BY category ORDER BY n DESC").all()
      .map((r) => ({ ...r, label: CAT.get(r.category) || r.category })),
    attention: listJobs(db, user, { status: 'OPEN,ASSIGNED,IN_PROGRESS,DONE', sort: 'work' })
      .filter((j) => j.status === 'OPEN' || j.status === 'DONE' || j.overdue || j.priority === 'URGENT').slice(0, 12),
    documents: docs.slice(0, 10),
    upcoming: listSchedules(db, user).filter((s) => s.active && s.next_due <= addDays(t, 30)).slice(0, 10),
  };
}

function costReport(db, user, { from, to }) {
  if (!canSeeAll(user)) throw new AppError(403, 'Supervisor and accounts only');
  const f = from ? reqDate(from, 'from') : `${today().slice(0, 7)}-01`;
  const tt = to ? reqDate(to, 'to') : today();
  const jobs = db.prepare(`${JOB_SELECT} WHERE j.status IN ('DONE','CLOSED') AND ${riyadhDate('j.done_at')} BETWEEN ? AND ? ORDER BY j.done_at`).all(f, tt).map((j) => decorate(j));
  const group = (key, label) => {
    const m = new Map();
    for (const j of jobs) {
      const k = key(j);
      const g = m.get(k) || { key: k, label: label(j), jobs: 0, cost_h: 0 };
      g.jobs++; g.cost_h += j.cost_h || 0; m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.cost_h - a.cost_h);
  };
  return {
    from: f, to: tt, jobs,
    total_h: jobs.reduce((a, j) => a + (j.cost_h || 0), 0),
    contractor_h: jobs.filter((j) => j.contractor_id).reduce((a, j) => a + (j.cost_h || 0), 0),
    no_cost: jobs.filter((j) => j.cost_h == null).length,
    by_category: group((j) => j.category, (j) => j.category_label),
    by_location: group((j) => `${j.location_type}:${j.branch_id || ''}`, (j) => j.location_name),
    by_contractor: group((j) => j.contractor_id || 0, (j) => j.contractor_name || 'Own technicians'),
    by_asset: group((j) => j.asset_id || 0, (j) => (j.asset_name ? `${j.asset_name}${j.asset_tag ? ` (${j.asset_tag})` : ''}` : '—')).filter((g) => g.key),
  };
}

// Contractor bills for accounts (payment requests)
function contractorBills(db, user, { status, from, to } = {}) {
  if (![ACC, CFO, SUP].includes(user.role)) throw new AppError(403, 'Accounts only');
  const where = ['j.contractor_id IS NOT NULL', 'j.cost_h IS NOT NULL', "j.status NOT IN ('REJECTED','CANCELLED')"]; const p = [];
  if (from) { where.push(`COALESCE(${riyadhDate('j.done_at')}, ${riyadhDate('j.requested_at')}) >= ?`); p.push(reqDate(from, 'from')); }
  if (to) { where.push(`COALESCE(${riyadhDate('j.done_at')}, ${riyadhDate('j.requested_at')}) <= ?`); p.push(reqDate(to, 'to')); }
  let rows = db.prepare(`${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY j.id DESC LIMIT 500`).all(...p).map((j) => decorate(j));
  if (status) rows = rows.filter((j) => String(status).split(',').includes(j.bill_state));
  return rows;
}
function payableJobs(db, supplierId) {
  return db.prepare(`${JOB_SELECT} WHERE j.contractor_id=? AND j.cost_h IS NOT NULL AND j.status IN ('DONE','CLOSED')
    AND NOT EXISTS (SELECT 1 FROM payment_request_jobs x JOIN payment_requests pr ON pr.id=x.request_id WHERE x.job_id=j.id AND pr.status IN ${ACTIVE_PR})
    ORDER BY j.done_at`).all(supplierId).map((j) => ({ ...decorate(j), ready: !!(j.matched_at && j.invoice_no) }));
}

module.exports = {
  CATEGORIES, meta, createJob, listJobs, getJob, updateJob, addNote, startJob, finishJob, closeJob, sendBack, rejectJob, cancelJob,
  setJobCost, checkJobBill, generateDue, listSchedules, saveSchedule, listDocuments, saveDocument, renewDocument, renewalJob,
  listAssets, saveAsset, listTechnicians, addTechnician, setTechnicianActive, supervisorHome, costReport, contractorBills, payableJobs, addInterval,
};
