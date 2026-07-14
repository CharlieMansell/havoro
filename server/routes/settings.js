const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { runBackup, BACKUP_DIR } = require('../services/backup');
const { reschedule, getSchedule } = require('../services/backupScheduler');

const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii'); // 16-byte header every SQLite db file starts with

function isSqliteFile(buf) {
  return buf.length > SQLITE_MAGIC.length && buf.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);
}

const router = express.Router();
router.use(requireAuth);

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

router.get('/version', (req, res) => {
  res.json({ version: require('../package.json').version });
});

router.put('/', requireAdmin, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const update = db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      upsert.run(String(k), String(v));
    }
  });
  update();
  res.json({ ok: true });
});

// POST /api/settings/backup — manual backup
router.post('/backup', requireAdmin, async (req, res) => {
  try {
    const dest = await runBackup();
    res.json({ ok: true, path: dest, dir: BACKUP_DIR });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/settings/backups — list available backups
router.get('/backups', requireAdmin, (req, res) => {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^havoro-\d{4}-\d{2}-\d{2}-\d{6}\.db$/.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Shared by both restore routes below. `getDbBuffer` is called just before the
// swap so a bad read (missing file, bad upload) can still fail the request
// cleanly instead of after we've already closed the live database.
// Docker's restart: unless-stopped (or Electron's own exit handler, in local
// mode) brings the process back up with the restored file in place.
let restoring = false;
function performRestore(res, getDbBuffer) {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/havoro.db');
  restoring = true;
  res.json({ ok: true, restarting: true });

  setTimeout(async () => {
    let buf;
    try {
      buf = getDbBuffer();
    } catch {
      restoring = false;
      return;
    }
    try { await runBackup(); } catch {} // best-effort snapshot of the pre-restore state
    try {
      db.close();
      fs.writeFileSync(dbPath, buf);
      for (const ext of ['-wal', '-shm']) {
        try { fs.unlinkSync(dbPath + ext); } catch {}
      }
    } finally {
      process.exit(0);
    }
  }, 1000);
}

// POST /api/settings/restore/:filename — restore from one of this machine's own automatic backups
router.post('/restore/:filename', requireAdmin, (req, res) => {
  if (restoring) return res.status(409).json({ error: 'Restore already in progress' });

  const { filename } = req.params;
  if (!/^havoro-\d{4}-\d{2}-\d{2}-\d{6}\.db$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  // The regex above is the actual protection here (it admits no '/' or '..'),
  // not a resolve/join comparison — those are always equal for any input and
  // don't guard against traversal (see server/routes/import.js history).
  const src = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Backup not found' });

  performRestore(res, () => fs.readFileSync(src));
});

// POST /api/settings/restore-upload — restore from a backup file the user picked
// from disk (e.g. one moved over from another machine or an old install)
router.post('/restore-upload', requireAdmin, backupUpload.single('file'), (req, res) => {
  if (restoring) return res.status(409).json({ error: 'Restore already in progress' });
  if (!req.file) return res.status(400).json({ error: 'file required' });
  if (!isSqliteFile(req.file.buffer)) {
    return res.status(400).json({ error: "That doesn't look like a Havoro backup file (.db)" });
  }

  performRestore(res, () => req.file.buffer);
});

// GET /api/settings/backup-schedule — get current schedule (admin)
router.get('/backup-schedule', requireAdmin, (req, res) => {
  res.json({ cron: getSchedule() });
});

// PUT /api/settings/backup-schedule — update schedule (admin)
router.put('/backup-schedule', requireAdmin, (req, res) => {
  const { cron } = req.body;
  if (!cron) return res.status(400).json({ error: 'cron required' });
  try {
    reschedule(cron);
    res.json({ ok: true, cron });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
