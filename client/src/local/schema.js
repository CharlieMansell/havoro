// Copy of server/db/schema.sql for the on-device (local) backend.
// Keep in sync with the server schema when tables change.
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL,
  type                  TEXT    NOT NULL CHECK (type IN (
                          'transaction','savings','offset','credit_card',
                          'super','property','share_portfolio',
                          'other_asset','liability')),
  institution           TEXT,
  is_manual_balance     INTEGER NOT NULL DEFAULT 0,
  current_balance_cents INTEGER NOT NULL DEFAULT 0,
  include_in_net_worth  INTEGER NOT NULL DEFAULT 1,
  linked_loan_account_id INTEGER REFERENCES accounts(id),
  address               TEXT,
  domain_property_id    TEXT,
  lvr_ceiling           REAL    NOT NULL DEFAULT 0.80,
  archived              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  kind      TEXT    NOT NULL CHECK (kind IN ('income','expense','transfer')),
  color     TEXT,
  icon      TEXT
);

CREATE TABLE IF NOT EXISTS category_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_type  TEXT    NOT NULL CHECK (match_type IN ('contains','startswith','regex')),
  pattern     TEXT    NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  priority    INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES accounts(id),
  date              TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  description_clean TEXT,
  amount_cents      INTEGER NOT NULL,
  category_id       INTEGER REFERENCES categories(id),
  notes             TEXT,
  is_transfer       INTEGER NOT NULL DEFAULT 0,
  transfer_pair_id  INTEGER,
  import_hash       TEXT    NOT NULL UNIQUE,
  source_file       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  amount_cents  INTEGER NOT NULL,
  rollover      INTEGER NOT NULL DEFAULT 0,
  start_month   TEXT    NOT NULL DEFAULT (strftime('%Y-%m', 'now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  kind                 TEXT    NOT NULL CHECK (kind IN ('goal','sinking_fund')),
  target_amount_cents  INTEGER NOT NULL,
  current_amount_cents INTEGER NOT NULL DEFAULT 0,
  target_date          TEXT,
  cadence              TEXT    CHECK (cadence IN ('weekly','fortnightly','monthly')),
  priority             INTEGER NOT NULL DEFAULT 100,
  linked_account_id    INTEGER REFERENCES accounts(id),
  archived             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recurring_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  direction     TEXT    NOT NULL CHECK (direction IN ('income','expense')),
  amount_cents  INTEGER NOT NULL,
  cadence       TEXT    NOT NULL CHECK (cadence IN ('weekly','fortnightly','monthly','quarterly','annual')),
  next_date     TEXT,
  category_id   INTEGER REFERENCES categories(id),
  auto_detected INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS holdings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_account_id INTEGER NOT NULL REFERENCES accounts(id),
  ticker               TEXT    NOT NULL,
  exchange             TEXT    NOT NULL DEFAULT 'ASX',
  yahoo_symbol         TEXT,
  units                REAL    NOT NULL DEFAULT 0,
  avg_cost_cents       INTEGER NOT NULL DEFAULT 0,
  current_price_cents  INTEGER NOT NULL DEFAULT 0,
  price_updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  holding_id INTEGER NOT NULL REFERENCES holdings(id),
  date       TEXT    NOT NULL,
  type       TEXT    NOT NULL CHECK (type IN ('buy','sell')),
  units      REAL    NOT NULL,
  price_cents INTEGER NOT NULL,
  fee_cents  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  holding_id INTEGER NOT NULL REFERENCES holdings(id),
  date       TEXT    NOT NULL,
  close_cents INTEGER NOT NULL,
  UNIQUE (holding_id, date)
);

CREATE TABLE IF NOT EXISTS property_valuations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  date       TEXT    NOT NULL,
  value_cents INTEGER NOT NULL,
  source     TEXT    NOT NULL CHECK (source IN ('manual','domain','vg_land')),
  confidence TEXT,
  UNIQUE (account_id, date)
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT    NOT NULL,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  balance_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS check_ins (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  date  TEXT    NOT NULL DEFAULT (date('now')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_plans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  amount_cents  INTEGER NOT NULL,
  cadence       TEXT    NOT NULL DEFAULT 'monthly'
                CHECK (cadence IN ('weekly','fortnightly','monthly','quarterly','annual')),
  notes         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 100
);
`;
