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

const isNative = () => Capacitor.isNativePlatform();

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

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPending();
  });
  window.addEventListener('pagehide', () => { flushPending(); });
}
