// On-device backend for the iOS proof-of-concept.
//
// Replaces the Express server with the same API surface implemented against
// a local SQLite database (sql.js WASM). Installed by main.jsx when
// VITE_LOCAL_BACKEND=1 — it wraps window.fetch and answers /api/* requests
// locally, so the React app runs unchanged with no server.
//
// Where the database is kept is storage.js's problem: localStorage in a
// browser, a file in the app's data directory on iOS.
//
// SQL is ported from server/routes/* — keep the two in sync when routes change.

import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { SCHEMA_SQL } from './schema.js';
import { migrate } from './migrate.js';
import { BANK_PROFILES, parseBankFile, importHash } from './csvImport.js';
import {
  loadDatabase, saveDatabase, schedulePersist, flushPending,
  isNative, listBackups, writeBackup, readBackup, exportDatabase,
} from './storage.js';

const LOCAL_USER = { id: 1, name: 'You', email: 'on-this-device', is_admin: 1 };

// Injected by vite.config.js from the root package.json, so a build on a phone
// reports the same version as the release it came from. The fallback only
// applies if something builds this without the define.
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

let SQL = null;
let db = null;

// ── sqlite helpers ──────────────────────────────────────────────────────────
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
const get = (sql, params = []) => all(sql, params)[0];

function run(sql, params = []) {
  db.run(sql, params);
  const lastInsertRowid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  persist();
  return { lastInsertRowid };
}

// Handing the export to storage.js rather than writing it here — on a device
// the destination is a file and the write is async, which this call site
// (invoked from synchronous query helpers) can't wait on. See storage.js.
function persist() {
  try {
    schedulePersist(db.export());
  } catch (e) {
    console.warn('[local] export failed:', e);
  }
}

// ── seed (categories + starter rules, mirrors server/db/seed.js) ───────────
function seed() {
  const groups = {
    Income:    { kind: 'income',   color: '#10b981', children: ['Salary', 'Interest', 'Dividends', 'Other Income'] },
    Housing:   { kind: 'expense',  color: '#6366f1', children: ['Mortgage', 'Rent', 'Utilities', 'Internet', 'Home Maintenance', 'Insurance – Home'] },
    Food:      { kind: 'expense',  color: '#f59e0b', children: ['Groceries', 'Dining Out', 'Takeaway', 'Coffee'] },
    Transport: { kind: 'expense',  color: '#3b82f6', children: ['Fuel', 'Car Registration', 'Car Maintenance', 'Insurance – Car', 'Public Transport', 'Parking & Tolls'] },
    Health:    { kind: 'expense',  color: '#ec4899', children: ['Medical', 'Pharmacy', 'Gym & Fitness'] },
    Lifestyle: { kind: 'expense',  color: '#8b5cf6', children: ['Subscriptions', 'Entertainment', 'Shopping', 'Clothing', 'Holidays', 'Pets'] },
    Finance:   { kind: 'expense',  color: '#64748b', children: ['Bank Fees', 'Loan Repayment', 'Super', 'Tax'] },
    Family:    { kind: 'expense',  color: '#f97316', children: ['Kids', 'School Fees', 'Gifts', 'Christmas'] },
    Transfers: { kind: 'transfer', color: '#94a3b8', children: ['Internal Transfer'] },
  };
  for (const [name, g] of Object.entries(groups)) {
    const { lastInsertRowid: gid } = run(
      'INSERT INTO categories (name, parent_id, kind, color) VALUES (?, NULL, ?, ?)', [name, g.kind, g.color]);
    for (const child of g.children) {
      run('INSERT INTO categories (name, parent_id, kind, color) VALUES (?, ?, ?, ?)', [child, gid, g.kind, g.color]);
    }
  }
  const rules = [
    ['woolworths', 'Groceries'], ['coles', 'Groceries'], ['aldi', 'Groceries'],
    ['mcdonald', 'Takeaway'], ['uber eats', 'Takeaway'],
    ['netflix', 'Subscriptions'], ['spotify', 'Subscriptions'],
    ['bp ', 'Fuel'], ['caltex', 'Fuel'], ['ampol', 'Fuel'],
    ['salary', 'Salary'], ['payroll', 'Salary'],
  ];
  for (const [pattern, cat] of rules) {
    const c = get('SELECT id FROM categories WHERE name = ?', [cat]);
    if (c) run('INSERT INTO category_rules (match_type, pattern, category_id, priority) VALUES (?, ?, ?, ?)', ['contains', pattern, c.id, 10]);
  }
  run("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_growth_cash','0.045'),('default_growth_shares','0.09'),('default_growth_property','0.05'),('default_growth_super','0.08')");
}

// Which month a transaction counts toward — mirrors server/services/budgetMonth.js
const BUDGET_MONTH_SQL = "COALESCE(t.budget_month, substr(t.date, 1, 7))";
const SHIFT_DAYS = 3;

function defaultBudgetMonth({ date, amount_cents, is_transfer }) {
  if (is_transfer || amount_cents <= 0) return null;
  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month || !day) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day <= daysInMonth - SHIFT_DAYS) return null;
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

// ── endpoint implementations ────────────────────────────────────────────────
const MONTHLY_FACTOR = { weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1, quarterly: 1 / 3, annual: 1 / 12 };

function monthRange(month) {
  const m = month || new Date().toISOString().slice(0, 7);
  return { month: m, from: `${m}-01`, to: `${m}-31` };
}

function dashboardSummary() {
  const { month, from, to } = monthRange();
  const netWorth = get(`SELECT SUM(CASE WHEN type = 'liability' THEN -ABS(current_balance_cents) ELSE current_balance_cents END) as nw
    FROM accounts WHERE include_in_net_worth = 1 AND archived = 0`);
  const breakdown = all(`SELECT CASE type
      WHEN 'super' THEN 'super' WHEN 'property' THEN 'property'
      WHEN 'share_portfolio' THEN 'shares' WHEN 'liability' THEN 'mortgage'
      ELSE 'cash' END as asset_class,
    SUM(CASE WHEN type = 'liability' THEN -ABS(current_balance_cents) ELSE current_balance_cents END) as balance
    FROM accounts WHERE include_in_net_worth = 1 AND archived = 0 GROUP BY asset_class`);
  const income = get(`SELECT COALESCE(SUM(t.amount_cents),0) as total FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${BUDGET_MONTH_SQL} = ? AND c.kind = 'income' AND t.is_transfer = 0`, [month]);
  const expenses = get(`SELECT COALESCE(SUM(t.amount_cents),0) as total FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${BUDGET_MONTH_SQL} = ? AND c.kind = 'expense' AND t.is_transfer = 0`, [month]);
  const incomeTotal = income.total || 0;
  const expensesTotal = Math.abs(expenses.total || 0);
  const top = all(`SELECT c.name, c.color, c.id, ABS(SUM(t.amount_cents)) as total FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${BUDGET_MONTH_SQL} = ? AND c.kind = 'expense' AND t.is_transfer = 0
    GROUP BY c.id ORDER BY total DESC LIMIT 6`, [month]);
  const needsReview = get('SELECT COUNT(*) as n FROM transactions WHERE category_id IS NULL AND is_transfer = 0');
  const goals = all('SELECT * FROM goals WHERE archived = 0 ORDER BY priority LIMIT 4');
  const history = all(`SELECT ci.date,
      SUM(CASE WHEN a.type = 'liability' THEN -ABS(s.balance_cents) ELSE s.balance_cents END) as net_worth
    FROM check_ins ci JOIN balance_snapshots s ON s.snapshot_date = ci.date
    JOIN accounts a ON a.id = s.account_id WHERE a.include_in_net_worth = 1
    GROUP BY ci.date ORDER BY ci.date ASC`);
  const setup = {
    accounts:       get('SELECT COUNT(*) as n FROM accounts WHERE archived = 0').n,
    transactions:   get('SELECT COUNT(*) as n FROM transactions').n,
    budgets:        get('SELECT COUNT(*) as n FROM budgets').n,
    transfer_plans: get('SELECT COUNT(*) as n FROM transfer_plans').n,
  };
  return {
    net_worth_cents: netWorth.nw || 0,
    net_worth_delta_cents: null,
    asset_breakdown: breakdown,
    month_income_cents: incomeTotal,
    month_expenses_cents: expensesTotal,
    savings_rate: incomeTotal > 0 ? Math.round(((incomeTotal - expensesTotal) / incomeTotal) * 1000) / 10 : 0,
    top_categories: top,
    needs_review_count: needsReview.n,
    goals,
    net_worth_history: history,
    setup,
  };
}

function budgetsSummary(month) {
  const { month: m, from, to } = monthRange(month);
  const budgets = all(`SELECT b.*, c.name as category_name, c.color as category_color, c.kind
    FROM budgets b JOIN categories c ON c.id = b.category_id
    WHERE b.start_month <= ? GROUP BY b.category_id HAVING b.start_month = MAX(b.start_month)
    ORDER BY c.name`, [m]);
  const actuals = all(`SELECT category_id, SUM(amount_cents) as total FROM transactions
    WHERE date >= ? AND date <= ? AND is_transfer = 0 GROUP BY category_id`, [from, to]);
  const actualMap = Object.fromEntries(actuals.map(a => [a.category_id, a.total]));
  const income = get(`SELECT SUM(t.amount_cents) as total FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND c.kind = 'income' AND t.is_transfer = 0`, [from, to]);
  const spend = get(`SELECT SUM(t.amount_cents) as total FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND c.kind = 'expense' AND t.is_transfer = 0`, [from, to]);
  const uncategorised = get(`SELECT SUM(amount_cents) as total FROM transactions
    WHERE date >= ? AND date <= ? AND category_id IS NULL AND is_transfer = 0 AND amount_cents < 0`, [from, to]);
  const rows = budgets.map(b => ({
    ...b,
    spent_cents: -(actualMap[b.category_id] || 0),
    remaining_cents: b.amount_cents - (-(actualMap[b.category_id] || 0)),
  }));
  const totalBudgeted = rows.reduce((s, b) => s + b.amount_cents, 0);
  return {
    month: m,
    budgets: rows,
    summary: {
      total_income_cents: income.total || 0,
      total_spend_cents: -(spend.total || 0),
      total_budgeted_cents: totalBudgeted,
      total_spent_cents: rows.reduce((s, b) => s + b.spent_cents, 0),
      uncategorised_spend_cents: -(uncategorised.total || 0),
      safe_to_spend_cents: (income.total || 0) + (spend.total || 0) - totalBudgeted,
    },
  };
}

function buildFilters(q) {
  const where = [];
  const params = [];
  if (q.get('account_id')) { where.push('t.account_id = ?'); params.push(q.get('account_id')); }
  if (q.get('category_id')) { where.push('t.category_id = ?'); params.push(q.get('category_id')); }
  if (q.get('needs_review') === 'true') where.push('t.category_id IS NULL AND t.is_transfer = 0');
  if (q.get('is_transfer') != null) { where.push('t.is_transfer = ?'); params.push(q.get('is_transfer') === 'true' ? 1 : 0); }
  if (q.get('date_from')) { where.push('t.date >= ?'); params.push(q.get('date_from')); }
  if (q.get('date_to')) { where.push('t.date <= ?'); params.push(q.get('date_to')); }
  if (q.get('bank_category')) { where.push('t.bank_category = ?'); params.push(q.get('bank_category')); }
  if (q.get('budget_month')) { where.push(`${BUDGET_MONTH_SQL} = ?`); params.push(q.get('budget_month')); }
  if (q.get('search')) {
    where.push('(t.description LIKE ? OR t.description_clean LIKE ?)');
    params.push(`%${q.get('search')}%`, `%${q.get('search')}%`);
  }
  return { whereClause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function listTransactions(q) {
  const { whereClause, params } = buildFilters(q);
  const page = Number(q.get('page') || 1);
  const limit = Number(q.get('limit') || 50);
  const total = get(`SELECT COUNT(*) as n FROM transactions t ${whereClause}`, params);
  const rows = all(`SELECT t.*, a.name as account_name,
      c.name as category_name, c.color as category_color, c.kind as category_kind
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ${whereClause} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]);
  return { total: total.n, page, limit, rows };
}

const updateAllowed = (table, id, body, allowed) => {
  const fields = Object.keys(body).filter(k => allowed.includes(k));
  if (!fields.length) return { error: 'No valid fields', status: 400 };
  run(`UPDATE ${table} SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...fields.map(f => body[f] === '' ? null : body[f]), id]);
  return get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
};

const transferWithMeta = id => {
  const row = get(`SELECT tp.*, a.name as account_name FROM transfer_plans tp
    LEFT JOIN accounts a ON a.id = tp.to_account_id WHERE tp.id = ?`, [id]);
  return { ...row, monthly_cents: Math.round(row.amount_cents * (MONTHLY_FACTOR[row.cadence] ?? 1)) };
};

// ── CSV import (ported from server/services/csvImporter.js) ────────────────
function fieldText(tx, field) {
  if (field === 'merchant') return tx.merchant || '';
  if (field === 'bank_category') return tx.bank_category || '';
  return tx.description || '';
}

function categorise(transaction) {
  const tx = typeof transaction === 'string' ? { description: transaction } : transaction;
  const rules = all('SELECT * FROM category_rules WHERE active = 1 ORDER BY priority ASC, id ASC');
  for (const rule of rules) {
    if (rule.account_id != null && Number(rule.account_id) !== Number(tx.account_id)) continue;
    const description = fieldText(tx, rule.match_field);
    if (!description) continue;
    const lower = description.toLowerCase();
    const pat = rule.pattern.toLowerCase();
    let match = false;
    if (rule.match_type === 'contains') match = lower.includes(pat);
    else if (rule.match_type === 'startswith') match = lower.startsWith(pat);
    else if (rule.match_type === 'regex') { try { match = new RegExp(rule.pattern, 'i').test(description); } catch { /* bad pattern */ } }
    if (match) return rule.category_id;
  }
  return null;
}

async function handleUpload(path, form) {
  const file = form.get('file');
  if (!file) return { error: 'file required', status: 400 };

  // Restoring a database file the user picked — a whole SQLite image, not a
  // CSV, so it never reaches the bank-profile parsing below.
  if (path === '/settings/restore-upload') {
    return restoreFromBytes(new Uint8Array(await file.arrayBuffer()));
  }

  const profileId = form.get('profile');
  if (!profileId) return { error: 'profile required', status: 400 };
  const profile = BANK_PROFILES[profileId];
  if (!profile) return { error: 'Profile not found', status: 404 };
  // Bytes, not text — an Excel download is a zip, and decoding it as UTF-8
  // first would corrupt it beyond recovery.
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (path === '/import/preview') {
    try {
      const rows = await parseBankFile(bytes, profile);
      return { ok: true, rowCount: rows.length, sample: rows.slice(0, 5) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (path !== '/import') return { error: `Unknown upload endpoint ${path}`, status: 404 };
  const accountId = Number(form.get('account_id'));
  if (!accountId) return { error: 'profile and account_id required', status: 400 };
  const parsed = await parseBankFile(bytes, profile);

  // Transfer detection: opposite amount in another account within ±3 days
  const otherAccounts = all('SELECT id FROM accounts WHERE archived = 0 AND id != ?', [accountId]);
  for (const row of parsed) {
    if (!otherAccounts.length) break;
    const match = get(`SELECT id FROM transactions
      WHERE account_id != ? AND amount_cents = ?
        AND date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
        AND is_transfer = 0 LIMIT 1`,
      [accountId, -row.amount_cents, row.date, row.date]);
    if (match) row.is_transfer = 1;
  }

  const results = { inserted: 0, duplicates: 0, needsReview: 0 };
  const occurrences = new Map();
  for (const row of parsed) {
    const key = `${row.date}|${row.description}|${row.amount_cents}`;
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const hash = await importHash(accountId, row.date, row.description, row.amount_cents, occurrence);
    if (get('SELECT id FROM transactions WHERE import_hash = ?', [hash])) { results.duplicates++; continue; }
    const catId = row.is_transfer ? null : categorise({ ...row, account_id: accountId });
    if (!catId && !row.is_transfer) results.needsReview++;
    // raw db.run in the loop; persist once at the end (persist() per row is slow)
    db.run(`INSERT OR IGNORE INTO transactions
        (account_id, date, description, description_clean, merchant, bank_category, amount_cents, category_id, is_transfer, budget_month, import_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [accountId, row.date, row.description, row.description_clean, row.merchant, row.bank_category,
       row.amount_cents, catId, row.is_transfer ? 1 : 0, defaultBudgetMonth(row), hash]);
    results.inserted++;
  }
  persist();
  return { ...results, total: parsed.length };
}

// ── taking a database file in ───────────────────────────────────────────────
// Every SQLite file starts with this, NUL included — 16 bytes exactly.
const SQLITE_MAGIC = 'SQLite format 3\0';

// Not the whole schema, just enough to tell a Havoro database from some other
// application's SQLite file before it replaces the user's data. Anything the
// file is missing beyond this, migrate() adds.
const REQUIRED_TABLES = ['accounts', 'transactions', 'categories', 'budgets', 'settings'];

// Validates a candidate database and returns it open, or an error to send back.
// Nothing here touches the live database — the caller swaps only on success.
function openDatabaseFile(input) {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (bytes.length < 100 || String.fromCharCode(...bytes.subarray(0, 16)) !== SQLITE_MAGIC) {
    return { error: "That doesn't look like a Havoro backup file (.db)", status: 400 };
  }

  // Bytes 18 and 19 are the file-format read and write versions: 2 means the
  // database was last used in WAL mode, which is how both the server and the
  // desktop app run, so every file a user brings over has this set.
  //
  // sql.js turns out to read one anyway — there is no -wal sidecar in its
  // in-memory VFS, so it sees an empty log and carries on. That is a property
  // of how this particular build was compiled rather than something SQLite
  // guarantees, and a build with SQLITE_OMIT_WAL refuses the file outright
  // with a bare "unable to open database file". Normalising the header costs
  // two bytes on a copy we already own and removes the variable: a
  // checkpointed WAL database is byte-for-byte an ordinary rollback-journal
  // one apart from these.
  //
  // A file whose WAL had *not* been checkpointed is missing pages either way,
  // and fails the integrity check below rather than loading half a ledger —
  // which is why the docs say to export from the desktop app rather than
  // copying havoro.db out from underneath a running one.
  if (bytes[18] === 2 && bytes[19] === 2) {
    bytes = bytes.slice();
    bytes[18] = 1;
    bytes[19] = 1;
  }

  let candidate;
  try {
    candidate = new SQL.Database(bytes);
  } catch (e) {
    return { error: `That file could not be opened as a database (${e.message})`, status: 400 };
  }

  try {
    const check = candidate.exec('PRAGMA quick_check')[0]?.values?.[0]?.[0];
    if (check !== 'ok') throw new Error('the file is damaged or incomplete');

    const names = new Set(
      (candidate.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map(r => r[0]));
    const missing = REQUIRED_TABLES.filter(t => !names.has(t));
    if (missing.length) throw new Error(`it has no ${missing.join(' or ')} table`);

    // The file may come from an older release than this build, so bring it up
    // to the schema the queries below expect before it goes anywhere near live.
    migrate(candidate);
  } catch (e) {
    try { candidate.close(); } catch { /* already gone */ }
    return { error: `That doesn't look like a Havoro database — ${e.message}`, status: 400 };
  }

  return { db: candidate };
}

// Swaps the live database for another one. The client reloads afterwards,
// which is what the server build does by restarting the process — every
// component is holding data from the old database and none of it is right.
async function restoreFromBytes(bytes) {
  const opened = openDatabaseFile(bytes);
  if (opened.error) return opened;

  // A restore is the one operation with nothing to undo it, so take a restore
  // point of what's about to be replaced. Best-effort: failing to snapshot
  // shouldn't block a user trying to recover from a database they can't use.
  if (isNative()) {
    try { await writeBackup(db.export()); } catch (e) { console.warn('[local] pre-restore backup failed:', e); }
  }

  // Any coalesced write still pending belongs to the old database. Landing it
  // after the swap would overwrite what was just restored.
  await flushPending();
  try { db.close(); } catch { /* already closed */ }

  db = opened.db;
  await saveDatabase(db.export()); // awaited, not scheduled — the reload is imminent
  return { ok: true, restarting: true };
}

// ── async routes ────────────────────────────────────────────────────────────
// Anything that touches the filesystem, which handle() below can't do because
// its callers are synchronous. Returns undefined when it doesn't own the route.
async function handleAsync(method, path) {
  if (path === '/settings/backups' && method === 'GET') return listBackups();

  if (path === '/settings/backup' && method === 'POST') {
    if (!isNative()) return { error: 'Backups need the app — the browser build has nowhere to put them', status: 501 };
    await flushPending();
    const filename = await writeBackup(db.export());
    return { ok: true, path: filename };
  }

  if (path === '/settings/export' && method === 'POST') {
    await flushPending();
    return exportDatabase(db.export());
  }

  const restore = /^\/settings\/restore\/(.+)$/.exec(path);
  if (restore && method === 'POST') {
    let bytes;
    try {
      bytes = await readBackup(decodeURIComponent(restore[1]));
    } catch (e) {
      return { error: `Backup not found (${e.message})`, status: 404 };
    }
    return restoreFromBytes(bytes);
  }

  return undefined;
}

// ── router ──────────────────────────────────────────────────────────────────
function handle(method, path, query, body) {
  const m = (re) => path.match(re);
  let match;

  // auth — always "logged in" on-device
  if (path === '/auth/me') return LOCAL_USER;
  if (path === '/auth/login') return LOCAL_USER;
  if (path === '/auth/logout') return {};

  if (path === '/dashboard/summary') return dashboardSummary();
  if (path === '/transactions/needs-review/count')
    return { count: get('SELECT COUNT(*) as n FROM transactions WHERE category_id IS NULL AND is_transfer = 0').n };

  if (path === '/transactions' && method === 'GET') return listTransactions(query);
  if (path === '/transactions/bank-categories' && method === 'GET')
    return all("SELECT DISTINCT bank_category FROM transactions WHERE bank_category IS NOT NULL AND bank_category != '' ORDER BY bank_category").map(r => r.bank_category);
  if (path === '/transactions/ids' && method === 'GET') {
    const { whereClause, params } = buildFilters(query);
    return { ids: all(`SELECT t.id FROM transactions t ${whereClause}`, params).map(r => r.id) };
  }
  if ((match = m(/^\/transactions\/(\d+)\/suggest-rule$/)) && method === 'POST') {
    const tx = get('SELECT * FROM transactions WHERE id = ?', [match[1]]);
    if (!tx || !tx.category_id) return { error: 'Transaction has no category', status: 400 };
    let match_field = 'description';
    let source = tx.description;
    if (tx.bank_category) { match_field = 'bank_category'; source = tx.bank_category; }
    else if (tx.merchant) { match_field = 'merchant'; source = tx.merchant; }
    const desc = source.toLowerCase().trim();
    const pattern = match_field === 'bank_category' ? desc : desc.split(/\s+/).slice(0, 3).join(' ');
    return { suggested: { match_type: 'contains', match_field, pattern, category_id: tx.category_id, priority: 50 } };
  }
  if ((match = m(/^\/transactions\/(\d+)$/)) && method === 'PUT')
    return updateAllowed('transactions', match[1], body, ['category_id', 'notes', 'is_transfer', 'description_clean', 'budget_month']);

  if ((match = m(/^\/transactions\/(\d+)$/)) && method === 'DELETE') {
    if (!get('SELECT id FROM transactions WHERE id = ?', [match[1]])) {
      return { error: 'Transaction not found', status: 404 };
    }
    run('DELETE FROM transactions WHERE id = ?', [match[1]]);
    return { ok: true };
  }

  if (path === '/transactions/bulk-categorize' && method === 'POST') {
    const { ids, category_id, is_transfer } = body;
    if (!Array.isArray(ids) || ids.length === 0) return { error: 'ids must be a non-empty array', status: 400 };
    if (category_id === undefined && is_transfer === undefined && body.budget_month === undefined) return { error: 'category_id, is_transfer or budget_month required', status: 400 };
    const fields = [];
    const values = [];
    if (category_id !== undefined) { fields.push('category_id = ?'); values.push(category_id || null); }
    if (is_transfer !== undefined) { fields.push('is_transfer = ?'); values.push(is_transfer ? 1 : 0); }
    if (body.budget_month !== undefined) { fields.push('budget_month = ?'); values.push(body.budget_month || null); }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`UPDATE transactions SET ${fields.join(', ')} WHERE id IN (${placeholders})`, [...values, ...ids]);
    persist();
    return { updated: ids.length };
  }

  if (path === '/transactions/bulk-delete' && method === 'POST') {
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) return { error: 'ids must be a non-empty array', status: 400 };
    const placeholders = ids.map(() => '?').join(',');
    run(`DELETE FROM transactions WHERE id IN (${placeholders})`, ids);
    return { deleted: ids.length };
  }

  if (path === '/transactions/apply-rules' && method === 'POST') {
    const rows = all('SELECT id, account_id, description, merchant, bank_category FROM transactions WHERE category_id IS NULL AND is_transfer = 0');
    let updated = 0;
    for (const tx of rows) {
      const categoryId = categorise(tx);
      if (categoryId) { db.run('UPDATE transactions SET category_id = ? WHERE id = ?', [categoryId, tx.id]); updated++; }
    }
    persist();
    return { checked: rows.length, updated };
  }

  if (path === '/accounts' && method === 'GET') return all('SELECT * FROM accounts WHERE archived = 0 ORDER BY type, name');
  if (path === '/accounts' && method === 'POST') {
    const { lastInsertRowid } = run(
      `INSERT INTO accounts (name, type, institution, is_manual_balance, current_balance_cents, include_in_net_worth, linked_loan_account_id, address, lvr_ceiling)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.name, body.type, body.institution || null, body.is_manual_balance ? 1 : 0,
       body.current_balance_cents || 0, body.include_in_net_worth === 0 ? 0 : 1,
       body.linked_loan_account_id || null, body.address || null, body.lvr_ceiling ?? 0.8]);
    return { ...get('SELECT * FROM accounts WHERE id = ?', [lastInsertRowid]), status: 201 };
  }
  if ((match = m(/^\/accounts\/(\d+)\/balance$/)) && method === 'PATCH') {
    run('UPDATE accounts SET current_balance_cents = ? WHERE id = ?', [body.current_balance_cents, match[1]]);
    return get('SELECT * FROM accounts WHERE id = ?', [match[1]]);
  }
  if ((match = m(/^\/accounts\/(\d+)$/)) && method === 'PUT')
    return updateAllowed('accounts', match[1], body,
      ['name', 'type', 'institution', 'is_manual_balance', 'current_balance_cents', 'include_in_net_worth', 'linked_loan_account_id', 'address', 'lvr_ceiling']);
  if ((match = m(/^\/accounts\/(\d+)$/)) && method === 'DELETE') {
    const hasTx = get('SELECT COUNT(*) as n FROM transactions WHERE account_id = ?', [match[1]]).n > 0;
    if (hasTx) run('UPDATE accounts SET archived = 1 WHERE id = ?', [match[1]]);
    else run('DELETE FROM accounts WHERE id = ?', [match[1]]);
    return { ok: true };
  }

  if (path === '/categories' && method === 'GET') return all('SELECT * FROM categories ORDER BY parent_id IS NOT NULL, name');
  if (path === '/categories' && method === 'POST') {
    const { lastInsertRowid } = run('INSERT INTO categories (name, parent_id, kind, color) VALUES (?, ?, ?, ?)',
      [body.name, body.parent_id || null, body.kind, body.color || null]);
    return get('SELECT * FROM categories WHERE id = ?', [lastInsertRowid]);
  }
  if ((match = m(/^\/categories\/(\d+)$/)) && method === 'PUT')
    return updateAllowed('categories', match[1], body, ['name', 'color']);
  if ((match = m(/^\/categories\/(\d+)$/)) && method === 'DELETE') {
    const used = get('SELECT COUNT(*) as n FROM transactions WHERE category_id = ?', [match[1]]).n > 0;
    if (used) return { error: 'Cannot delete — category has transactions', status: 400 };
    run('DELETE FROM categories WHERE parent_id = ?', [match[1]]);
    run('DELETE FROM categories WHERE id = ?', [match[1]]);
    return { ok: true };
  }

  if (path === '/budgets/summary') return budgetsSummary(query.get('month'));
  if (path === '/budgets' && method === 'POST') {
    const { lastInsertRowid } = run('INSERT INTO budgets (category_id, amount_cents, rollover, start_month) VALUES (?, ?, ?, ?)',
      [body.category_id, body.amount_cents, body.rollover ? 1 : 0, body.start_month || new Date().toISOString().slice(0, 7)]);
    return { ...get('SELECT * FROM budgets WHERE id = ?', [lastInsertRowid]), status: 201 };
  }
  if ((match = m(/^\/budgets\/(\d+)$/)) && method === 'PUT')
    return updateAllowed('budgets', match[1], body, ['amount_cents', 'rollover', 'start_month']);
  if ((match = m(/^\/budgets\/(\d+)$/)) && method === 'DELETE') { run('DELETE FROM budgets WHERE id = ?', [match[1]]); return { ok: true }; }

  if (path === '/goals' && method === 'GET') return all('SELECT * FROM goals WHERE archived = 0 ORDER BY priority, name');
  if (path === '/goals' && method === 'POST') {
    const { lastInsertRowid } = run(
      'INSERT INTO goals (name, kind, target_amount_cents, current_amount_cents, target_date, cadence, priority, linked_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [body.name, body.kind, body.target_amount_cents, body.current_amount_cents || 0,
       body.target_date || null, body.cadence || null, body.priority ?? 100, body.linked_account_id || null]);
    return { ...get('SELECT * FROM goals WHERE id = ?', [lastInsertRowid]), status: 201 };
  }
  if ((match = m(/^\/goals\/(\d+)$/)) && method === 'PUT')
    return updateAllowed('goals', match[1], body, ['name', 'kind', 'target_amount_cents', 'current_amount_cents', 'target_date', 'cadence', 'priority', 'linked_account_id']);
  if ((match = m(/^\/goals\/(\d+)$/)) && method === 'DELETE') { run('UPDATE goals SET archived = 1 WHERE id = ?', [match[1]]); return { ok: true }; }

  if (path === '/transfers' && method === 'GET')
    return all(`SELECT tp.*, a.name as account_name, a.type as account_type FROM transfer_plans tp
      LEFT JOIN accounts a ON a.id = tp.to_account_id
      ORDER BY COALESCE(tp.to_account_id, 999999), tp.sort_order, tp.name`)
      .map(r => ({ ...r, monthly_cents: Math.round(r.amount_cents * (MONTHLY_FACTOR[r.cadence] ?? 1)) }));
  if (path === '/transfers' && method === 'POST') {
    const { lastInsertRowid } = run(
      'INSERT INTO transfer_plans (name, to_account_id, amount_cents, cadence, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [body.name, body.to_account_id || null, body.amount_cents, body.cadence || 'monthly', body.notes || null, body.sort_order ?? 100]);
    return { ...transferWithMeta(lastInsertRowid), status: 201 };
  }
  if ((match = m(/^\/transfers\/(\d+)$/)) && method === 'PUT') {
    updateAllowed('transfer_plans', match[1], body, ['name', 'to_account_id', 'amount_cents', 'cadence', 'notes', 'sort_order']);
    return transferWithMeta(match[1]);
  }
  if ((match = m(/^\/transfers\/(\d+)$/)) && method === 'DELETE') { run('DELETE FROM transfer_plans WHERE id = ?', [match[1]]); return { ok: true }; }

  if (path === '/checkin/prefill') {
    const today = new Date().toISOString().slice(0, 10);
    return {
      accounts: all(`SELECT id, name, type, institution, current_balance_cents FROM accounts
        WHERE include_in_net_worth = 1 AND archived = 0 ORDER BY type, name`),
      today_checkin_exists: !!get('SELECT id FROM check_ins WHERE date = ?', [today]),
    };
  }
  if (path === '/checkin' && method === 'POST') {
    const today = new Date().toISOString().slice(0, 10);
    if (get('SELECT id FROM check_ins WHERE date = ?', [today])) return { error: 'Check-in already done today', status: 400 };
    const accounts = all('SELECT id, current_balance_cents, type FROM accounts WHERE include_in_net_worth = 1 AND archived = 0');
    const { lastInsertRowid: id } = run('INSERT INTO check_ins (date, notes) VALUES (?, ?)', [today, body.notes || null]);
    let nw = 0;
    for (const acc of accounts) {
      const balance = body.balances?.[acc.id] != null ? Number(body.balances[acc.id]) : acc.current_balance_cents;
      run('INSERT INTO balance_snapshots (snapshot_date, account_id, balance_cents) VALUES (?, ?, ?)', [today, acc.id, balance]);
      if (body.balances?.[acc.id] != null) run('UPDATE accounts SET current_balance_cents = ? WHERE id = ?', [balance, acc.id]);
      nw += acc.type === 'liability' ? -Math.abs(balance) : balance;
    }
    return { id, date: today, net_worth_cents: nw };
  }
  if (path === '/checkin/history')
    return all(`SELECT ci.*, SUM(CASE WHEN a.type = 'liability' THEN -ABS(s.balance_cents) ELSE s.balance_cents END) as net_worth_cents
      FROM check_ins ci JOIN balance_snapshots s ON s.snapshot_date = ci.date
      JOIN accounts a ON a.id = s.account_id AND a.include_in_net_worth = 1
      GROUP BY ci.id ORDER BY ci.date DESC`);

  if (path === '/rules' && method === 'GET')
    return all(`SELECT r.*, c.name as category_name, c.color as category_color, a.name as account_name
      FROM category_rules r JOIN categories c ON c.id = r.category_id
      LEFT JOIN accounts a ON a.id = r.account_id ORDER BY r.priority, r.id`);
  if (path === '/rules' && method === 'POST') {
    const { lastInsertRowid } = run('INSERT INTO category_rules (match_type, pattern, category_id, priority, match_field, account_id) VALUES (?, ?, ?, ?, ?, ?)',
      [body.match_type, body.pattern, body.category_id, body.priority ?? 50, body.match_field || 'description',
       body.account_id === '' || body.account_id == null ? null : Number(body.account_id)]);
    return get('SELECT * FROM category_rules WHERE id = ?', [lastInsertRowid]);
  }
  if ((match = m(/^\/rules\/(\d+)$/)) && method === 'PUT')
    return updateAllowed('category_rules', match[1], body, ['match_type', 'pattern', 'category_id', 'priority', 'active', 'match_field', 'account_id']);
  if ((match = m(/^\/rules\/(\d+)$/)) && method === 'DELETE') { run('DELETE FROM category_rules WHERE id = ?', [match[1]]); return { ok: true }; }

  if (path === '/settings' && method === 'GET')
    return Object.fromEntries(all('SELECT key, value FROM settings').map(r => [r.key, r.value]));
  if (path === '/settings' && method === 'PUT') {
    for (const [k, v] of Object.entries(body)) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]);
    return { ok: true };
  }
  if (path === '/settings/version') return { version: APP_VERSION };
  // No scheduler on-device — the app isn't running at 2am to fire one. The
  // Settings page hides the control in this build; this is here so a stale
  // client asking for it gets an answer rather than a 501.
  if (path === '/settings/backup-schedule') return { cron: null };

  if (path === '/holdings') return [];
  if (path === '/import/profiles')
    return Object.entries(BANK_PROFILES).map(([id, p]) =>
      ({ id, name: p.name, account_match: p.account_match, file: p.file || 'csv' }));
  if (path === '/users' && method === 'GET') return [LOCAL_USER];

  return { error: `Not available in the on-device proof-of-concept yet (${method} ${path})`, status: 501 };
}

// ── fetch interception ──────────────────────────────────────────────────────
export async function installLocalBackend() {
  SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadDatabase();
  db = saved ? new SQL.Database(saved) : null;
  if (db) {
    // An install that has been sitting on a phone since an earlier build still
    // has that build's schema. Bring it forward before the first query.
    migrate(db);
  } else {
    db = new SQL.Database();
    db.run(SCHEMA_SQL);
    seed();
    // Straight to disk: a fresh database with nothing in it still needs to
    // exist before the first query, or a crash on launch loses the seed.
    await flushPending();
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return nativeFetch(input, init);

    const u = new URL(url, window.location.origin);
    const path = u.pathname.replace(/^\/api/, '');
    const method = (init.method || 'GET').toUpperCase();

    const toResponse = (result) => {
      const status = result?.status && result?.error ? result.status : (result?.status === 201 ? 201 : 200);
      if (result && typeof result === 'object' && !Array.isArray(result)) delete result.status;
      return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
    };

    try {
      if (init.body instanceof FormData) return toResponse(await handleUpload(path, init.body));

      const fromAsync = await handleAsync(method, path);
      if (fromAsync !== undefined) return toResponse(fromAsync);

      let body = {};
      if (init.body && typeof init.body === 'string') {
        try { body = JSON.parse(init.body); } catch { /* non-JSON body */ }
      }
      return toResponse(handle(method, path, u.searchParams, body));
    } catch (e) {
      console.error('[local]', method, path, e);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  };

  console.log('[local] on-device backend installed — no server, data stays in this browser/device');
}
