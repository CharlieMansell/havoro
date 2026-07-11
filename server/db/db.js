const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'havoro.db');

const db = new Database(DB_PATH);

// Apply schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Live migrations
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'"); } catch {}
db.exec("UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role = 'member'");
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
  ];
  defaults.forEach(([k, v]) => insert.run(k, v));
}

module.exports = db;
