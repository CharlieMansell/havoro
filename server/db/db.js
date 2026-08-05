const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Only the fallback location — the packaged desktop app and Docker both set
// DB_PATH somewhere per-user/persistent instead. Create the directory the
// database is actually going to live in rather than this one unconditionally:
// creating it next to the source files fails with EPERM when the app is
// installed to a read-only location (an all-users Windows install under
// %ProgramFiles%, run unelevated), killing the server on startup even though
// DB_PATH pointed somewhere perfectly writable.
const DEFAULT_DATA_DIR = path.join(__dirname, '../../data');

const DB_PATH = process.env.DB_PATH || path.join(DEFAULT_DATA_DIR, 'havoro.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Apply schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Live migrations
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'"); } catch {}
db.exec("UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role = 'member'");
// Columns some bank exports provide beyond the raw statement line, and the
// field a rule matches against. No CHECK on match_field here — SQLite can't
// add one to an existing table, so routes/rules.js validates it instead;
// schema.sql has the constraint for fresh databases.
try { db.exec('ALTER TABLE transactions ADD COLUMN merchant TEXT'); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN bank_category TEXT'); } catch {}
try { db.exec("ALTER TABLE category_rules ADD COLUMN match_field TEXT NOT NULL DEFAULT 'description'"); } catch {}
// NULL = applies to every account, which is what every pre-existing rule
// becomes. No REFERENCES on the added column: SQLite can't add a foreign key
// to an existing table, so routes/rules.js checks the account exists instead.
try { db.exec('ALTER TABLE category_rules ADD COLUMN account_id INTEGER'); } catch {}
// NULL = counts toward the month of its own date; see services/budgetMonth.js.
try { db.exec('ALTER TABLE transactions ADD COLUMN budget_month TEXT'); } catch {}
// Which account this budget's money gets transferred to, so the transfer
// planner can derive itself from the budget instead of being a second copy.
try { db.exec('ALTER TABLE budgets ADD COLUMN to_account_id INTEGER'); } catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS transfer_plans (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    amount_cents  INTEGER NOT NULL,
    cadence       TEXT    NOT NULL DEFAULT 'monthly'
                  CHECK (cadence IN ('weekly','fortnightly','monthly','quarterly','annual')),
    notes         TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 100
  )`);
} catch {}

// Seed categories on first run
const { seedCategories } = require('./seed');
const catCount = db.prepare('SELECT COUNT(*) as n FROM categories').get();
if (catCount.n === 0) seedCategories(db);

// No default admin account is seeded — the first person to open the app
// creates it themselves via POST /api/auth/setup (or /local-setup on desktop).

// Seed default settings on first run
const settingsCount = db.prepare('SELECT COUNT(*) as n FROM settings').get();
if (settingsCount.n === 0) {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const defaults = [
    ['default_growth_cash', '0.045'],
    ['default_growth_shares', '0.09'],
    ['default_growth_property', '0.05'],
    ['default_growth_super', '0.08'],
    ['budget_income_shift_days', '3'],
  ];
  defaults.forEach(([k, v]) => insert.run(k, v));
}

module.exports = db;
