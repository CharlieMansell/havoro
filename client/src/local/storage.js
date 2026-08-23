// Where the on-device database file lives.
//
// In a browser the whole SQLite image is base64'd into localStorage, which is
// fine for a proof-of-concept and hopeless on a real device: localStorage caps
// out around 5MB and base64 adds a third on top, so a couple of years of
// transactions would silently fail to save. On iOS the same bytes go to a file
// in the app's data directory instead, which has no such ceiling and is
// covered by the device backup.
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

export async function loadDatabase() {
  try {
    if (isNative()) {
      const { Filesystem, Directory } = await filesystem();
      const { data } = await Filesystem.readFile({ path: FILE_NAME, directory: Directory.Data });
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
    await Filesystem.writeFile({ path: FILE_NAME, directory: Directory.Data, data: b64 });
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
    const { files } = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Data });
    return files
      .filter(f => BACKUP_NAME_RE.test(f.name))
      .map(f => ({ filename: f.name, size: f.size, mtime: f.mtime }))
      .sort((a, b) => b.filename.localeCompare(a.filename));
  } catch {
    return []; // directory doesn't exist yet — no backups have been taken
  }
}

export async function writeBackup(bytes, name = backupName()) {
  if (!isNative()) throw new Error('Backups need the app, not the browser build');
  const { Filesystem, Directory } = await filesystem();
  await Filesystem.writeFile({
    path: `${BACKUP_DIR}/${name}`,
    directory: Directory.Data,
    data: bytesToBase64(bytes),
    recursive: true, // creates backups/ on the first run
  });
  await pruneBackups();
  return name;
}

export async function readBackup(name) {
  if (!BACKUP_NAME_RE.test(name)) throw new Error('Not a backup file name');
  const { Filesystem, Directory } = await filesystem();
  const { data } = await Filesystem.readFile({ path: `${BACKUP_DIR}/${name}`, directory: Directory.Data });
  return base64ToBytes(data);
}

async function pruneBackups() {
  const existing = await listBackups(); // newest first
  const { Filesystem, Directory } = await filesystem();
  for (const b of existing.slice(KEEP_BACKUPS)) {
    try {
      await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${b.filename}`, directory: Directory.Data });
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
