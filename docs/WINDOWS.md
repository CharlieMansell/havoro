# Running Havoro on Windows

There are two ways to run Havoro on Windows:

| Option | Best for |
|---|---|
| **Download the `.exe`** | Using Havoro on your PC — double-click to install, no technical setup |
| **Docker Desktop** | Accessing Havoro from your phone or other devices on your network |

---

## Option 1 — Download the installer (recommended)

The GitHub Actions release workflow automatically builds a Windows installer every time a new version is tagged. You don't need to build anything yourself.

1. Go to the [Releases page](https://github.com/charliemansell/havoro/releases)
2. Download `Havoro Setup x.x.x.exe` from the latest release
3. Run the installer — Windows may show a **SmartScreen** warning ("Windows protected your PC") because the app isn't commercially code-signed. Click **More info → Run anyway** to proceed. This is normal for open-source software distributed outside the Microsoft Store.
4. Launch Havoro; the app opens in a window and also appears in the system tray

**Your data is stored at:** `%APPDATA%\Havoro\` — it survives updates and uninstalls.

### System tray behaviour

- Close the window → app keeps running in the system tray
- Double-click the tray icon to reopen the window
- Right-click the tray icon → **Quit** to fully exit

### Updating

Download and run the latest installer from the Releases page — it upgrades in place without touching your data.

---

## Option 2 — Docker Desktop (for phone access)

Want to check your finances from your phone? Run Havoro in Docker Desktop so it stays accessible on your local network. Open `http://<your-pc-ip>:3000` on your phone, or install it as a PWA (tap **Share → Add to Home Screen** on iOS, or **Install app** on Android).

### Prerequisites

- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) (free)

### Setup

1. Install Docker Desktop and make sure it's running (whale icon in the system tray).

2. Clone the repo (or download and extract the ZIP):
   ```powershell
   git clone https://github.com/charliemansell/havoro.git
   cd havoro
   ```

3. Copy the example env file:
   ```powershell
   copy .env.example .env
   ```

4. Open `.env` in Notepad and set `JWT_SECRET` to a long random string:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. Build and start:
   ```powershell
   docker compose up -d --build
   ```

6. Open `http://localhost:3000` in your browser — the first launch walks you through creating your admin account.

### Starting / stopping

```powershell
docker compose up -d          # start
docker compose down           # stop
docker compose up -d --build  # update after a git pull
```

### Data location

Your database lives in a Docker named volume (`havoro-data`) — it survives rebuilds and updates.

---

## Accessing from other devices on your network

**Electron app:** The server listens on `0.0.0.0` by default. Find your PC's local IP (`ipconfig` → IPv4 address) and open `http://192.168.x.x:3727` on your phone.

**Docker:** By default only `localhost` is exposed. To allow other devices, change the port binding in `docker-compose.yml`:
```yaml
ports:
  - "0.0.0.0:3000:3000"
```

> **Note:** exposing Havoro on your local network is fine for home use. Do not expose it directly to the internet without setting `COOKIE_SECURE=true` and putting it behind HTTPS.

---

## Building locally (contributors only)

If you're contributing to Havoro and need to build the Electron app yourself rather than waiting for a CI release, see the `electron/` folder — it contains a `package.json` with `build:win`, `build:mac`, and `build:linux` scripts. You'll need Node.js 20 and Windows Build Tools (Visual Studio C++ workload) to compile the native SQLite module.
