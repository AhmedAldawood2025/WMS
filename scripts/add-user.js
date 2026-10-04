'use strict';
// Add a user or reset a password.
//   node scripts/add-user.js --name "Ali" --email ali@spicymeal.sa --role WAREHOUSE_MANAGER --password "..."
//   node scripts/add-user.js --name "Omar" --email omar@spicymeal.sa --role WAREHOUSE_MANAGER --source factory --password "..."
//   node scripts/add-user.js --name "Jish 2" --email jish2@spicymeal.sa --role BRANCH --branch Jish --password "..."
//   node scripts/add-user.js --email jish@spicymeal.sa --password "new-password"      (reset)
const path = require('node:path');
const { openDb } = require('../src/db');
const { hashPassword } = require('../src/crypto');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const { db } = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'wms.db'));

if (!args.email || !args.password || args.password.length < 8) {
  console.error('Required: --email and --password (min 8 characters)');
  process.exit(1);
}
const existing = db.prepare('SELECT id FROM users WHERE email=?').get(args.email);
if (existing && !args.role) {
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(args.password), existing.id);
  console.log('Password updated.');
  process.exit(0);
}
if (existing) { console.error('A user with that email already exists.'); process.exit(1); }
if (!['BRANCH', 'WAREHOUSE_MANAGER', 'ACCOUNTANT', 'CFO', 'MAINT_SUPERVISOR', 'TECHNICIAN'].includes(args.role) || !args.name) {
  console.error('Required for new users: --name and --role (BRANCH | WAREHOUSE_MANAGER | ACCOUNTANT | CFO | MAINT_SUPERVISOR | TECHNICIAN)');
  process.exit(1);
}
let branchId = null;
if (args.role === 'BRANCH') {
  const b = db.prepare('SELECT id FROM branches WHERE branch_name=? OR branch_code=?').get(args.branch, args.branch);
  if (!b) { console.error('BRANCH users need --branch <name or code>'); process.exit(1); }
  branchId = b.id;
}
// Managers: --source warehouse (default) or --source factory
const whId = args.role === 'WAREHOUSE_MANAGER' ? (String(args.source || 'warehouse').toLowerCase().startsWith('f') ? 2 : 1) : null;
db.prepare('INSERT INTO users (name, email, password_hash, role, branch_id, warehouse_id) VALUES (?,?,?,?,?,?)')
  .run(args.name, args.email, hashPassword(args.password), args.role, branchId, whId);
console.log('User created.');
