const path = require('path');
const fs = require('fs');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../../data/backups');
const KEEP_DAYS = parseInt(process.env.BACKUP_KEEP_DAYS || '30', 10);

async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Includes time-of-day, not just the date — a date-only name meant a second
  // backup on the same day silently overwrote the first, since better-sqlite3's
  // .backup() clobbers an existing destination file rather than erroring.
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
  const dest = path.join(BACKUP_DIR, `havoro-${stamp}.db`);

  const db = require('../db/db');
  await db.backup(dest);

  // Prune backups older than KEEP_DAYS
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.match(/^havoro-\d{4}-\d{2}-\d{2}-\d{6}\.db$/)) continue;
    const full = path.join(BACKUP_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }

  return dest;
}

module.exports = { runBackup, BACKUP_DIR };
