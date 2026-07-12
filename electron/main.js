const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const PORT = 3727;

let serverProcess = null;
let mainWindow = null;
let tray = null;

// ── Paths ─────────────────────────────────────────────────────────────────────

function resourceBase() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function userData() { return app.getPath('userData'); }

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); return p; }

function getOrCreateSecret() {
  const f = path.join(userData(), 'jwt_secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, secret, { mode: 0o600 });
  return secret;
}

// ── Server ────────────────────────────────────────────────────────────────────

function startServer() {
  const dataDir = ensureDir(path.join(userData(), 'data'));
  const backupDir = ensureDir(path.join(userData(), 'backups'));

  serverProcess = spawn(process.execPath, [path.join(resourceBase(), 'server', 'index.js')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',  // run as plain Node.js, not a new Electron app
      NODE_ENV: 'production',
      LOCAL_MODE: 'true',
      PORT: String(PORT),
      DB_PATH: path.join(dataDir, 'havoro.db'),
      BACKUP_DIR: backupDir,
      JWT_SECRET: getOrCreateSecret(),
      CLIENT_DIST: path.join(resourceBase(), 'client', 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', d => console.log('[server]', d.toString().trim()));
  serverProcess.stderr.on('data', d => console.error('[server]', d.toString().trim()));
  serverProcess.on('exit', (code, signal) => {
    if (app.isQuiting || signal === 'SIGTERM') return; // we asked it to stop
    if (code === 0) {
      // A clean exit we didn't ask for is the server's own restart-after-restore
      // signal (see server/routes/settings.js performRestore) — bring it back
      // instead of leaving the window stuck talking to a dead backend.
      startServer();
      waitForServer()
        .then(() => mainWindow?.loadURL(`http://localhost:${PORT}`))
        .catch(() => dialog.showErrorBox('Havoro', 'The server restarted but did not come back up. Please restart Havoro.'));
      return;
    }
    dialog.showErrorBox('Havoro', `The server stopped unexpectedly (code ${code}). Please restart the app.`);
  });
}

// 90 x 1s = 90s. First launch after install can be much slower than normal
// startup because antivirus scans the newly-written server files the first
// time they're read — give that room instead of failing fast.
function waitForServer(retries = 90) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      http.get(`http://localhost:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else if (n <= 0) reject(new Error('Server health check failed'));
        else setTimeout(() => check(n - 1), 1000);
      }).on('error', () => {
        if (n <= 0) reject(new Error('Server did not start in time'));
        else setTimeout(() => check(n - 1), 1000);
      });
    };
    check(retries);
  });
}

// ── Loading window ────────────────────────────────────────────────────────────

function createLoadingWindow() {
  const w = new BrowserWindow({
    width: 320,
    height: 200,
    frame: false,
    resizable: false,
    center: true,
    transparent: false,
    backgroundColor: '#f8fafc',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  w.loadURL(`data:text/html,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8">
    <style>
      body { margin:0; display:flex; flex-direction:column; align-items:center;
             justify-content:center; height:100vh; font-family:-apple-system,sans-serif;
             background:#f8fafc; color:#475569; user-select:none; }
      .logo { font-size:32px; font-weight:700; color:#1f6b45; margin-bottom:8px; }
      .sub  { font-size:13px; color:#94a3b8; }
      .dots { display:inline-block; }
      .dot  { animation:blink 1.4s infinite both; display:inline-block; }
      .dot:nth-child(2) { animation-delay:.2s }
      .dot:nth-child(3) { animation-delay:.4s }
      @keyframes blink { 0%,80%,100%{opacity:0} 40%{opacity:1} }
    </style></head>
    <body>
      <div class="logo">Havoro</div>
      <div class="sub">Starting<span class="dots">
        <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
      </span></div>
    </body></html>
  `)}`);
  return w;
}

// ── Main window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'Havoro',
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // The app has no reason to navigate anywhere but its own local server —
  // this blocks the window itself being redirected off it (e.g. by a
  // malicious link or a compromised dependency), on top of
  // setWindowOpenHandler above already covering new-window/target=_blank.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'win32') {
        tray?.displayBalloon({
          title: 'Havoro',
          content: 'Still running in the system tray. Right-click the tray icon to quit.',
        });
      }
    }
  });
}

// ── In-app update download ────────────────────────────────────────────────────

function downloadToFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (u) => {
      https.get(u, { headers: { 'User-Agent': 'Havoro' } }, (res) => {
        // GitHub release assets redirect to a signed S3-style URL
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) onProgress(Math.round((received / total) * 100));
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      }).on('error', reject);
    };
    request(url);
  });
}

// Tracked here, not trusted from the renderer — see the comment on
// updater:install below for why.
let downloadedUpdatePath = null;

ipcMain.handle('updater:download', async (event, url) => {
  // The renderer only ever passes a URL it parsed out of GitHub's own API
  // response, so this never triggers today — but the IPC handler itself
  // shouldn't just trust whatever string it's given regardless. Restricting
  // the download to GitHub's own domain means this channel can't be turned
  // into a "fetch any URL" primitive even if the renderer were ever
  // compromised (e.g. by an XSS-class bug). GitHub's own redirect to the
  // signed asset host is followed as-is inside downloadToFile — that hop is
  // controlled by GitHub, not by renderer input.
  const parsed = new URL(url);
  if (parsed.hostname !== 'github.com') {
    throw new Error('Refusing to download from an untrusted host');
  }

  const fileName = decodeURIComponent(parsed.pathname.split('/').pop());
  const destPath = path.join(app.getPath('temp'), fileName);
  await downloadToFile(url, destPath, (percent) => {
    event.sender.send('updater:progress', { percent });
  });
  downloadedUpdatePath = destPath;
  return destPath;
});

ipcMain.handle('updater:install', async () => {
  // Deliberately ignores any path the renderer might pass — this only ever
  // runs the file updater:download itself just fetched, in this same
  // process, from a URL already validated above. Without that, this handler
  // would be a generic "execute any file on disk" primitive reachable from
  // the renderer, which is a much bigger blast radius than "run the update
  // we just downloaded" if the renderer were ever compromised.
  const filePath = downloadedUpdatePath;
  if (!filePath) throw new Error('No update has been downloaded yet');

  if (process.platform === 'linux') {
    // AppImages are portable executables, not installers — there's nothing
    // to "install over," just run the new one. The old file is left in
    // place (harmless; it's just an unused file at that point).
    fs.chmodSync(filePath, 0o755);
    spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Windows: run the NSIS installer like a normal double-click. Its
    // customInit force-close (see build/installer.nsh) handles the running
    // instance if our own quit below hasn't fully released it yet.
    shell.openPath(filePath);
  }
  app.isQuiting = true;
  app.quit();
});

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  // tray-icon.png is listed under `files` in electron-builder.yml, so it's
  // packed next to main.js (inside the asar) — not under extraResources like
  // server/client, which is what resourceBase() points at. __dirname resolves
  // correctly either way (dev or packaged).
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('Havoro');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Havoro',
      click: () => { if (mainWindow) mainWindow.show(); else createMainWindow(); },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuiting = true; app.quit(); },
    },
  ]));

  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
    else createMainWindow();
  });
}

// ── Single instance lock ──────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function attemptStartup(loading) {
  // Only respawn if the previous attempt's process actually died — if it's
  // still alive it may just be slow (e.g. still being antivirus-scanned),
  // and spawning a second one would fight it for the same port.
  if (!serverProcess || serverProcess.exitCode !== null) startServer();

  try {
    await waitForServer();
    createMainWindow();
    loading.close();
  } catch (err) {
    loading.close();
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Havoro — startup failed',
      message: 'Havoro is taking longer than expected to start.',
      detail: `${err.message}\n\nThis can happen the first time you launch after installing, while antivirus software scans the newly installed files. Trying again usually works.`,
      buttons: ['Try Again', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await attemptStartup(createLoadingWindow());
    else app.quit();
  }
}

app.whenReady().then(async () => {
  // A finance app has no legitimate use for camera/mic/geolocation/
  // notifications/etc — deny every permission request explicitly rather
  // than relying on Electron's own defaults, which vary by permission type.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));

  createTray();
  await attemptStartup(createLoadingWindow());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray — do not quit
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (serverProcess) { serverProcess.kill('SIGTERM'); serverProcess = null; }
});
