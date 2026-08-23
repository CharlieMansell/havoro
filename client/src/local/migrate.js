// Brings a database up to the schema this build expects.
//
// Mirrors the live migrations in server/db/db.js — keep the two in step, the
// same way schema.js is kept in step with server/db/schema.sql.
//
// Two callers, and both matter:
//
//   1. Opening the on-device database. Until this existed, an install that had
//      been sitting on a phone since an earlier build kept whatever schema it
//      was created with, and any query touching a newer column failed.
//   2. Importing a database file from a desktop or server install, which may
//      have been taken from an older version than the phone is running.
//
// Every statement is idempotent: CREATE ... IF NOT EXISTS, or an ALTER TABLE
// whose failure means the column is already there. That is exactly how the
// server does it — SQLite has no "ADD COLUMN IF NOT EXISTS".

import { SCHEMA_SQL } from './schema.js';

const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'",
  "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'",
  // Columns some bank exports provide beyond the raw statement line, and the
  // field a rule matches against.
  'ALTER TABLE transactions ADD COLUMN merchant TEXT',
  'ALTER TABLE transactions ADD COLUMN bank_category TEXT',
  "ALTER TABLE category_rules ADD COLUMN match_field TEXT NOT NULL DEFAULT 'description'",
  // NULL = applies to every account, which is what every pre-existing rule
  // becomes.
  'ALTER TABLE category_rules ADD COLUMN account_id INTEGER',
  // NULL = counts toward the month of its own date; see budgetMonth handling
  // in localBackend.js.
  'ALTER TABLE transactions ADD COLUMN budget_month TEXT',
  // Which account a budget's money gets transferred to.
  'ALTER TABLE budgets ADD COLUMN to_account_id INTEGER',
];

export function migrate(db) {
  db.run(SCHEMA_SQL);
  for (const sql of MIGRATIONS) {
    try {
      db.run(sql);
    } catch {
      // Already applied. Anything else would fail again on the next open and
      // is better surfaced by the query that needs the column than by killing
      // startup here.
    }
  }
}
