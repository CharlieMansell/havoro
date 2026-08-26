// Where the on-device database file lives.
//
// In a browser the whole SQLite image is base64'd into localStorage, which is
// fine for a proof-of-concept and hopeless on a real device: localStorage caps
// out around 5MB and base64 adds a third on top, so a couple of years of
// transactions would silently fail to save. On iOS the same bytes go to a file
// on disk instead, which has no such ceiling and is covered by device backup.
//
// ── Which directory, and why it matters ────────────────────────────────────
//
// Capacitor's Directory.Data and Directory.Documents are the *same place* on
// iOS — both fall through to the Documents directory (see getDirectory() in
// the plugin's LegacyFilesystemImplementation.swift). Documents is the one
// directory UIFileSharingEnabled exposes in the Files app, so anything kept
// there is visible to the user and deletable by hand.
//
// That is right for a copy someone asked to export, and wrong for the live
// database and its automatic restore points: losing the ledger to a stray
// swipe in Files is not a recovery story. Apple's data-storage guidance says
// much the same about re-creatable files — ten rotating copies of a database
// have no business inflating someone's iCloud backup.
//
// So: Library for the working files, Documents only for deliberate exports.
// Library is still covered by device backup; it simply isn't browsable.
//
// Not Caches, despite sounding like the obvious home for backups: iOS purges
// Caches under storage pressure without asking, and a backup that can vanish
// silently is worse than none, because you would believe you had one.
//
// Both paths store the same thing — the raw sql.js export — so a database
// written by one can be read by the other.

import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'hl_local_db_v1';
const FILE_NAME = 'havoro.db';

// Restore points, kept beside the live database in the app's private data
// directory. Named the same way the server names its own backups so a file
// taken off a desktop install and a file taken on the phone are
// interchangeable — see server/services/backup.js.
const BACKUP_DIR = 'backups';
const BACKUP_NAME_RE = /^havoro-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;

// The server keeps 30 days' worth. A phone has less room to spare and these
// are full copies of the database, so keep a fixed small number instead.
const KEEP_BACKUPS = 10;

export const isNative = () => Capacitor.isNativePlatform();

// Imported lazily so the browser build never pulls the plugin in.
async function filesystem() {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  return { Filesystem, Directory };
}

function bytesToBase64(bytes) {
  let binary = '';
  // Chunked because String.fromCharCode blows the argument limit on anything
  // larger than a few tens of thousands of bytes.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Earlier builds kept the database and its backups in Documents. Anyone who
// installed one has files sitting where the Files app can see — and delete —
// them, so move rather than abandon: read from the old location once, write to
// the new one, then remove the original so it stops being deletable.
//
// Best-effort throughout. A migration that throws would make the app look
// empty on launch, which is far worse than a stale copy left in Documents.
async function migrateFromDocuments() {
  const { Filesystem, Directory } = await filesystem();

  const move = async (path) => {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Documents });
    await Filesystem.writeFile({ path, directory: Directory.Library, data, recursive: true });
    await Filesystem.deleteFile({ path, directory: Directory.Documents });
  };

  try {
    await move(FILE_NAME);
    console.log('[local] migrated database out of Documents');
  } catch {
    // Nothing there, which is the normal case on a fresh or already-migrated
    // install.
  }

  try {
    const { files } = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Documents });
    for (const f of files.filter(f => BACKUP_NAME_RE.test(f.name))) {
      try { await move(`${BACKUP_DIR}/${f.name}`); } catch { /* skip this one */ }
    }
    try { await Filesystem.rmdir({ path: BACKUP_DIR, directory: Directory.Documents }); } catch { /* not empty, fine */ }
  } catch {
    // No old backups directory.
  }
}

export async function loadDatabase() {
  try {
    if (isNative()) {
      const { Filesystem, Directory } = await filesystem();
      try {
        const { data } = await Filesystem.readFile({ path: FILE_NAME, directory: Directory.Library });
        return base64ToBytes(data);
      } catch {
        // Not in the new location — an install from before the move, or a
        // first run. Migrating is cheap and does nothing when there's nothing
        // to move.
        await migrateFromDocuments();
      }
      const { data } = await Filesystem.readFile({ path: FILE_NAME, directory: Directory.Library });
      return base64ToBytes(data);
    }
    const b64 = localStorage.getItem(STORAGE_KEY);
    return b64 ? base64ToBytes(b64) : null;
  } catch {
    // No database yet (first run), or an unreadable one — either way the
    // caller seeds a fresh database rather than failing to start.
    return null;
  }
}

export async function saveDatabase(bytes) {
  const b64 = bytesToBase64(bytes);
  if (isNative()) {
    const { Filesystem, Directory } = await filesystem();
    await Filesystem.writeFile({ path: FILE_NAME, directory: Directory.Library, data: b64 });
    return;
  }
  localStorage.setItem(STORAGE_KEY, b64);
}

// Writing the entire database image after every statement is wasteful, and on
// the native side it's also async while its callers are not. Coalescing means
// a burst of inserts (a CSV import) costs one write instead of hundreds.
const FLUSH_DELAY_MS = 300;
let pending = null;
let timer = null;
let inFlight = Promise.resolve();

function flush() {
  timer = null;
  const bytes = pending;
  pending = null;
  if (!bytes) return inFlight;
  inFlight = saveDatabase(bytes).catch(e => console.warn('[local] persist failed:', e));
  return inFlight;
}

export function schedulePersist(bytes) {
  pending = bytes;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, FLUSH_DELAY_MS);
}

// A coalesced write that hasn't fired yet would be lost if the app is
// backgrounded or closed in that window, so force it out on the way down.
export function flushPending() {
  if (timer) clearTimeout(timer);
  return flush();
}

// ── restore points ──────────────────────────────────────────────────────────
// Native only. In a browser the database already lives in localStorage under a
// 5MB cap, and storing whole extra copies of it there is the quickest way to
// hit that ceiling; the browser build reports no backups rather than pretending.

export function backupName(now = new Date()) {
  // Matches the server's format exactly, including the time of day — two
  // backups on the same day must not collide.
  return `havoro-${now.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '')}.db`;
}

export async function listBackups() {
  if (!isNative()) return [];
  const { Filesystem, Directory } = await filesystem();
  try {
    const { files } = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Library });
    return files
      .filter(f => BACKUP_NAME_RE.test(f.name))
      .map(f => ({ filename: f.name, size: f.size, mtime: f.mtime }))
      .sort((a, b) => b.filename.localeCompare(a.filename));
  } catch {
    return []; // directory doesn't exist yet — no backups have been taken
  }
}

// A restore point per day, taken when the app opens.
//
// The desktop build does the same thing for the same reason: a clock-based
// schedule only fires if the app happens to be running at that moment, which
// for something you open a few times a month it rarely is. Launch is the one
// moment we know we're running.
//
// Once per day, not once per launch — otherwise opening the app five times in
// an afternoon rotates the entire history out and leaves five copies of today.
const DAY_MS = 24 * 60 * 60 * 1000;

export async function backupIfDue(bytes) {
  if (!isNative()) return null;

  const existing = await listBackups(); // newest first
  if (existing.length) {
    // Parse the timestamp out of havoro-YYYY-MM-DD-HHMMSS.db rather than
    // trusting mtime, which a restore or a file copy can move.
    const m = /^havoro-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/.exec(existing[0].filename);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const last = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
      if (Date.now() - last < DAY_MS) return null;
    }
  }

  try {
    return await writeBackup(bytes);
  } catch (e) {
    console.warn('[local] launch backup failed:', e);
    return null;
  }
}

export async function writeBackup(bytes, name = backupName()) {
  if (!isNative()) throw new Error('Backups need the app, not the browser build');
  const { Filesystem, Directory } = await filesystem();
  await Filesystem.writeFile({
    path: `${BACKUP_DIR}/${name}`,
    directory: Directory.Library,
    data: bytesToBase64(bytes),
    recursive: true, // creates backups/ on the first run
  });
  await pruneBackups();
  return name;
}

export async function readBackup(name) {
  if (!BACKUP_NAME_RE.test(name)) throw new Error('Not a backup file name');
  const { Filesystem, Directory } = await filesystem();
  const { data } = await Filesystem.readFile({ path: `${BACKUP_DIR}/${name}`, directory: Directory.Library });
  return base64ToBytes(data);
}

async function pruneBackups() {
  const existing = await listBackups(); // newest first
  const { Filesystem, Directory } = await filesystem();
  for (const b of existing.slice(KEEP_BACKUPS)) {
    try {
      await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${b.filename}`, directory: Directory.Library });
    } catch { /* another write may have removed it already */ }
  }
}

// ── getting a copy off the device ───────────────────────────────────────────
// Documents is the one directory iOS will show to the user, and only because
// UIFileSharingEnabled is set in Info.plist. Without that key this writes
// somewhere real but invisible, which is worse than not writing at all.
export async function exportDatabase(bytes, name = backupName()) {
  if (isNative()) {
    const { Filesystem, Directory } = await filesystem();
    const { uri } = await Filesystem.writeFile({
      path: name, directory: Directory.Documents, data: bytesToBase64(bytes), recursive: true,
    });
    return { filename: name, uri, where: 'files-app' };
  }

  // Browser build: an ordinary download.
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { filename: name, uri: null, where: 'download' };
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending();
  });
  window.addEventListener('pagehide', () => { flushPending(); });
}
