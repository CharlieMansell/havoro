# Server Setup Guide

Run Havoro on a always-on machine (Raspberry Pi, NAS, VPS) so you can access it from your phone, tablet, or any device on your network — no PC required.

---

## Requirements

- Linux machine (Raspberry Pi 3B+/4/5, NAS with Docker support, Ubuntu/Debian VPS, etc.)
- Docker and Docker Compose
- Git
- A GitHub account (for the auto-deploy runner; optional)

> **Raspberry Pi:** Pi 4 or 5 with 64-bit Raspberry Pi OS recommended. Pi 3 with 32-bit OS works but is slower to build.

---

## 1. Install Docker

```bash
# Official Docker install script (works on Raspberry Pi OS, Ubuntu, Debian)
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group
sudo usermod -aG docker $USER

# Apply the group change (log out and back in, or run:)
newgrp docker

# Verify
docker run hello-world
```

---

## 2. Clone the repository

```bash
git clone https://github.com/<your-github-username>/havoro.git ~/havoro
cd ~/havoro
```

---

## 3. Configure environment

```bash
cp .env.example .env
nano .env
```

Set at minimum:

```bash
# Generate a secure secret:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

JWT_SECRET=<paste the output here>
HOST_PORT=3000
```

Leave everything else at defaults unless you have a specific need.

> **COOKIE_SECURE:** Leave this `false` unless you're running behind an HTTPS reverse proxy (e.g. Nginx + Let's Encrypt). For plain `http://` on your local network, `false` is correct.

---

## 4. Start the app

```bash
docker compose up -d --build
```

The first build takes several minutes (compiling native SQLite bindings, building the React app). Subsequent builds are faster thanks to Docker layer caching.

**Check it's running:**

```bash
docker compose ps
docker compose logs -f
```

Open `http://<your-server-ip>:3000` from any device on the same network.

**Find your server's IP:**

```bash
hostname -I
```

---

## 5. First login

- URL: `http://<server-ip>:3000`
- The first person to open it is prompted to create the admin account — name, email, and password. There is no default account.

---

## 6. Access from anywhere with Tailscale (optional)

[Tailscale](https://tailscale.com) creates a private WireGuard-based VPN. Once installed, your server gets a stable `100.x.x.x` address reachable from your phone or laptop anywhere — without opening firewall ports.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Then access Havoro at `http://<tailscale-ip>:3000`.

Tailscale is free for personal use (up to 100 devices).

---

## 7. Auto-deploy with GitHub Actions (optional)

This sets up automatic deployment: when you push to `main` on GitHub, the app on your server rebuilds and restarts automatically — no SSH needed.

### How it works

A self-hosted GitHub Actions runner runs on your server. When a push lands on `main`, GitHub triggers the runner, which runs `git pull` and `docker compose up -d --build` inside your app folder.

### Setup

**Step 1: Register the runner**

Go to your GitHub repository → **Settings → Actions → Runners → New self-hosted runner**.

Choose your OS and architecture (Linux ARM64 for Pi 4/5, Linux x64 for most VPS).

Follow the commands shown on the page. Run them in a **separate folder** from the app:

```bash
mkdir ~/actions-runner && cd ~/actions-runner
# paste the download + configure commands from GitHub here
```

When prompted for the runner folder during `./config.sh`, use something outside `~/havoro` (e.g. `~/actions-runner`). **Do not put the runner inside the app directory** — `git pull` during deployment would conflict.

**Step 2: Install as a system service**

```bash
cd ~/actions-runner
sudo ./svc.sh install
sudo ./svc.sh start
```

The runner now starts automatically on boot.

**Step 3: Add the runner to the docker group**

```bash
# Check which user the runner runs as:
cat ~/actions-runner/.runner | grep user

# Add that user to docker group:
sudo usermod -aG docker <runner-user>

# Restart the runner service:
sudo ./svc.sh stop
sudo ./svc.sh start
```

**Step 4: Set your deploy path**

Go to your GitHub repository → **Settings → Variables → Actions → New repository variable**:

| Name | Value |
|---|---|
| `DEPLOY_DIR` | `/home/<your-username>/havoro` |

**Step 5: Add the workflow**

This isn't shipped as an active workflow in the repo — a self-hosted runner wired into CI is a real risk on a public repo (see [section 10](#10-security-considerations-for-the-runner)), so it's opt-in only. Save this as `.github/workflows/server-deploy.yml` in your own fork/clone:

```yaml
name: Deploy to server

# Triggers on push to main.
# Only runs if you have a self-hosted runner registered
# (repo Settings → Actions → Runners). Silently skipped if not.
#
# Set DEPLOY_DIR in repo Settings → Variables → Actions
# to the absolute path where havoro is cloned on your server,
# e.g. /home/pi/havoro

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: self-hosted
    timeout-minutes: 20
    steps:
      - name: Pull and rebuild
        run: |
          cd ${{ vars.DEPLOY_DIR || '~/havoro' }}
          git pull origin main
          docker compose up -d --build
```

It triggers on every push to `main` and uses the `DEPLOY_DIR` variable you set above. If you haven't registered a runner, this job simply won't run — it won't cause errors.

**Step 6: Test it**

Make a small change, commit, and push to `main`. Watch the Actions tab on GitHub — you should see the job run and succeed within a few minutes.

---

## 8. Updates

**Manual update:**

```bash
cd ~/havoro
git pull
docker compose up -d --build
```

**With the GitHub Actions runner set up:** this happens automatically on every push to `main`.

Your data lives in the `havoro-data` Docker named volume and is never touched by a rebuild.

---

## 9. Backups

- **Schedule:** 2 AM daily (configurable in Settings → Database backups)
- **Location:** `~/havoro/backups/` on the host
- **Retention:** Last 30 days (configurable)
- **Format:** SQLite `.db` snapshot files

To restore, go to Settings → Database backups → Restore. The app restarts automatically.

```bash
# Off-device backup example:
cp ~/havoro/backups/*.db /media/usb/havoro-backups/
```

---

## 10. Security considerations for the runner

A self-hosted runner on a **public** repository is a security risk — anyone who can open a pull request can potentially run code on your machine.

If your repository is public, ensure:

- Branch protection is enabled on `main` (require PR reviews before merging)
- The workflow only triggers on `push` to `main` — not on PRs from forks (already the case)

See [SECURITY.md](SECURITY.md) for more detail.

---

## 11. Troubleshooting

**Permission denied on Docker:**
```bash
sudo usermod -aG docker $USER && newgrp docker
```

**Port already in use:** change `HOST_PORT` in `.env` and restart.

**Can't reach from another device:**
```bash
sudo ufw allow 3000/tcp
```

**Runner not picking up jobs:**
```bash
cd ~/actions-runner && sudo ./svc.sh status
```

**Database locked:** restart the container with `docker compose restart`. If it persists, restore from a backup via Settings.
