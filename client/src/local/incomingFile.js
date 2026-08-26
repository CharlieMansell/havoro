// Files handed to Havoro from outside — a statement shared out of Safari, or
// tapped in the Files app.
//
// iOS delivers these as a file:// URL through Capacitor's appUrlOpen event,
// which fires whenever it likes: before React has mounted on a cold start,
// or mid-session when the app is already open. So the file is parked here and
// the Import page collects it whenever it gets there, rather than the event
// needing to know anything about routing or component lifecycles.

let pending = null;
const listeners = new Set();

/** Hands over the waiting file, if any, and clears it. */
export function takeIncomingFile() {
  const file = pending;
  pending = null;
  return file;
}

/** Whether a file is waiting, without consuming it. */
export function hasIncomingFile() {
  return pending !== null;
}

export function onIncomingFile(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function publish(file) {
  pending = file;
  for (const fn of listeners) {
    try { fn(file); } catch (e) { console.warn('[local] incoming file listener failed:', e); }
  }
}

// iOS percent-encodes and may hand back a path inside Inbox/ — the readable
// name is the last segment, decoded.
function nameFromUrl(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return path.split('/').filter(Boolean).pop() || 'statement';
  } catch {
    return 'statement';
  }
}

async function readSharedFile(url) {
  const { Filesystem } = await import('@capacitor/filesystem');
  // No `directory` — the URL is already absolute, and the file sits outside
  // any of Capacitor's named directories (typically the app's Inbox, or the
  // original location when it's opened in place).
  const { data } = await Filesystem.readFile({ path: url });

  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // A File is what the import form already works with, so wrapping the bytes
  // here means nothing downstream needs a second code path.
  return new File([bytes], nameFromUrl(url));
}

/** Starts listening for files opened into the app. Native builds only. */
export async function installFileHandler() {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;

  const { App } = await import('@capacitor/app');

  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith('file://')) return;
    try {
      publish(await readSharedFile(url));
    } catch (e) {
      console.warn('[local] could not read the shared file:', e);
    }
  });

  // A cold start delivers the file through the launch URL rather than the
  // event above, so ask for it once at startup too.
  try {
    const { url } = await App.getLaunchUrl() ?? {};
    if (url?.startsWith('file://')) publish(await readSharedFile(url));
  } catch {
    // No launch URL — the ordinary way to open an app.
  }
}
