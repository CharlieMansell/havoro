# Havoro

A self-hosted personal finance tracker. Import bank transactions, set budgets, track goals, and watch your net worth grow — without sharing your data with anyone.

**No bank credentials stored. No screen-scraping. No cloud dependency. Your data stays on your hardware.**

![Dashboard](docs/images/dashboard.png)

---

## Installation

### Option 1 — Desktop app (Windows / Linux)

Download the latest installer from [**Releases**](../../releases/latest):

| Platform | File |
|---|---|
| Windows | `Havoro Setup x.x.x.exe` |
| Linux | `Havoro-x.x.x.AppImage` |

Run the installer — no Docker, no Node.js, nothing else required. Havoro runs as a native app with a system tray icon and stores your data in your home folder.

### Self-hosting

The desktop app is the primary, supported way to run Havoro. A Docker image is also published on every release for anyone who wants to run their own server instead — e.g. for phone access via PWA, or to build on the codebase. There's no guided setup: clone the repo, set `JWT_SECRET` in `.env`, and `docker compose up -d --build`. See [**docs/SERVER-SETUP.md**](docs/SERVER-SETUP.md) for details.

---

## Features

- **Dashboard** — Monthly snapshot: net worth, income vs expenses, savings rate, top categories, active goals, net-worth trend
- **Transactions** — Import bank CSVs, auto-categorise with rules, search and filter, mark transfers
- **Budget** — Set monthly category budgets, track actuals, see safe-to-spend
- **Goals & Sinking Funds** — Track savings targets and recurring expense pots with contribution cadence
- **Net Worth** — Asset-class breakdown (cash, super, property, shares, liabilities) with trend history
- **Accounts** — Manage bank accounts, super, property, share portfolios, loans
- **Assets** — Share portfolio holdings with live price fetching, property valuations, balance projections
- **Check-ins** — Snapshot all account balances at a point in time to build a net-worth history
- **CSV Import** — ANZ, NAB, Westpac, CommBank profiles included; easy to add more
- **Backups** — Back up with one click from Settings any time, restore from a backup file just as easily, last 30 days kept automatically
- **Theme** — Light, dark, or system, saved per account
- **Check for updates** — On desktop, downloads and installs an available update without leaving the app
- **Multi-user** *(self-hosted only)* — Admin and member roles, per-user passwords — desktop is a single local account with no password at all
- **PWA** *(self-hosted only)* — Installable on iOS/Android, auto-updates when you open the app

---

## Screenshots

| | |
|---|---|
| ![Transactions](docs/images/transactions.png) | ![Budget](docs/images/budget.png) |
| ![Assets](docs/images/assets.png) | ![Net Worth](docs/images/net-worth.png) |

---

## Documentation

| Document | Contents |
|---|---|
| [docs/FEATURES.md](docs/FEATURES.md) | Complete feature walkthrough |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design with diagrams — how it's all put together |
| [docs/SERVER-SETUP.md](docs/SERVER-SETUP.md) | Pi / NAS / VPS install, Docker, auto-deploy via GitHub Actions |
| [docs/WINDOWS.md](docs/WINDOWS.md) | Windows Docker Desktop and Electron build guide |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Database schema, API reference |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model, hardening, data privacy |
| [docs/CODE-SIGNING.md](docs/CODE-SIGNING.md) | Code signing policy — how releases are built, signed, and verified |
| [docs/SYNC-DESIGN.md](docs/SYNC-DESIGN.md) | Planned device sync for the upcoming iPhone app |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local dev setup, code structure, contributing |

---

## Environment variables

These are for self-hosted/Docker deployments — the desktop app doesn't use any of them (it generates its own secret, and backs up once per day on launch rather than on a schedule).

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | — | **Required.** Long random string for signing auth tokens |
| `HOST_PORT` | `3000` | Port exposed on the host machine |
| `COOKIE_SECURE` | `false` | Set `true` only when serving over HTTPS |
| `BACKUP_CRON` | `0 2 * * *` | Cron schedule for automatic backups (default: 2 AM daily) |
| `BACKUP_KEEP_DAYS` | `30` | Days of backups to retain |

See [docs/TECHNICAL.md](docs/TECHNICAL.md) for the full variable reference.

---

## Updating

**Desktop app:** download and run the new installer from Releases — your data is untouched.

**Self-hosted:**
```bash
git pull
docker compose up -d --build
```

Your data lives in the `havoro-data` Docker volume and is never touched by a rebuild.

---

## Contributing

Contributions are welcome — bug fixes, new bank CSV profiles, features, docs. Start with [CONTRIBUTING.md](CONTRIBUTING.md): it covers local dev setup (one `npm run install:all` + `npm run dev`), the project structure, code style, and what makes a good PR. New bank profiles are an especially easy first contribution — one small JSON file adds support for a whole bank.

If you'd rather report than build: [open an issue](../../issues) for bugs and feature requests, or use [private vulnerability reporting](../../security) for anything security-sensitive.

Curious how it all fits together first? Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — diagrams included, scrutiny invited.

---

## Support the project

Havoro is free and always will be — no subscription, no pro tier. If it's saved you one, you can [**☕ buy me a coffee**](https://buymeacoffee.com/charliemansell). Entirely optional; starring the repo and telling a friend helps just as much.

---

## Roadmap

- **iPhone app** — in the works, fully on-device (same no-cloud model)
- **Device sync** — desktop ↔ phone over your local network, no third-party servers ([design doc](docs/SYNC-DESIGN.md))

---

## Disclaimer

Havoro is free software provided **"as is"**, without warranty of any kind — see the [LICENSE](LICENSE) for the full terms. There is no dedicated support; help is community-based via [GitHub issues](../../issues), on a best-effort basis.

Havoro is a record-keeping and budgeting tool. Nothing it displays — including balance projections and growth assumptions — is financial advice. For decisions about your money, talk to a licensed financial adviser.

---

## License

[MIT](LICENSE) © Charlie Mansell
