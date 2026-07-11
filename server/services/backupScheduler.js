const cron = require('node-cron');
const { runBackup } = require('./backup');

let currentTask = null;

function getSchedule() {
  try {
    const db = require('../db/db');
    const row = db.prepare("SELECT value FROM settings WHERE key = 'backup_cron'").get();
    if (row?.value && cron.validate(row.value)) return row.value;
  } catch {}
  return process.env.BACKUP_CRON || '0 2 * * *';
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
}

function reschedule(newCron) {
  if (!cron.validate(newCron)) throw new Error('Invalid cron expression');
  if (currentTask) { currentTask.stop(); currentTask.destroy(); }
  const db = require('../db/db');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_cron', ?)").run(newCron);
  start();
}

module.exports = { start, reschedule, getSchedule };
