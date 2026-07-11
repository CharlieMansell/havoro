const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { runBackup, BACKUP_DIR } = require('./backup');

let currentTask = null;

function getSchedule() {
  try {
    const db = require('../db/db');
    const row = db.prepare("SELECT value FROM settings WHERE key = 'backup_cron'").get();
    if (row?.value && cron.validate(row.value)) return row.value;
  } catch {}
  return process.env.BACKUP_CRON || '0 2 * * *';
}

// A fixed cron time only fires if the app happens to be open at that exact
// moment — fine for an always-on server, but for a normal desktop usage
// pattern (open occasionally, closed most of the time) it may rarely or
// ever actually run. Desktop backs up once per day on launch instead,
// alongside the cron (which still fires as a bonus if it's ever open then).
async function backupIfStale() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const newest = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^havoro-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .map(f => fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs)
      .sort((a, b) => b - a)[0];
    if (newest && Date.now() - newest < 24 * 60 * 60 * 1000) return;
    const dest = await runBackup();
    console.log(`[backup] Daily on-launch backup saved to ${dest}`);
  } catch (e) {
    console.error('[backup] On-launch backup check failed:', e.message);
  }
}

function start() {
  const schedule = getSchedule();
  currentTask = cron.schedule(schedule, async () => {
    try {
      const dest = await runBackup();
      console.log(`[backup] Saved to ${dest}`);
    } catch (e) {
      console.error('[backup] Failed:', e.message);
    }
  });
  console.log(`[backup] Scheduled: ${schedule}`);

  if (process.env.LOCAL_MODE === 'true') backupIfStale();
}

function reschedule(newCron) {
  if (!cron.validate(newCron)) throw new Error('Invalid cron expression');
  if (currentTask) { currentTask.stop(); currentTask.destroy(); }
  const db = require('../db/db');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_cron', ?)").run(newCron);
  start();
}

module.exports = { start, reschedule, getSchedule };
