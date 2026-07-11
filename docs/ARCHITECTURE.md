# Architecture

How Havoro is put together, for contributors and for anyone who wants to scrutinise the design before trusting it with their finances. Diagrams are [Mermaid](https://mermaid.js.org/) and render directly on GitHub.

If you spot a design problem, please open an issue — scrutiny is the point of publishing this.

---

## System overview

One Node.js/Express server owns a single SQLite file. Everything else is a client of that server. The same server code runs in every deployment mode — the only thing that changes is what starts it and where the database file lives.

```mermaid
flowchart LR
    subgraph clients [Clients]
        SPA["React SPA<br/>(Vite build, Tailwind, Recharts)"]
        PWA["PWA on phone<br/>(installed from browser)"]
    end

    subgraph server [Node.js server]
        API["Express API<br/>/api/*"]
        AUTH["Auth middleware<br/>JWT in httpOnly cookie"]
        SVC["Services<br/>CSV import · price fetch · backup cron"]
    end

    DB[("SQLite<br/>(better-sqlite3, WAL)")]

    EXT["External price APIs<br/>Yahoo Finance · CoinGecko · ExchangeRate<br/>(tickers only, no personal data)"]

    SPA -->|"fetch /api/*"| API
    PWA -->|"fetch /api/*"| API
    API --> AUTH --> DB
    SVC --> DB
    SVC -.->|outbound only| EXT
```

Key properties:

- **No ORM** — hand-written SQL via `better-sqlite3` (synchronous, in-process, WAL mode). No connection pool, no network hop to the database.
- **No accounts server, no telemetry** — the only outbound traffic is share/crypto price lookups (ticker symbols only) and the user-initiated update check against the GitHub releases API.
- **Auth** is a JWT in an httpOnly cookie, verified by middleware on every `/api` route except `/api/health` and login.
- **Money is integer cents everywhere** — no floats in the database or the API.

## Deployment modes

```mermaid
flowchart TB
    subgraph desktop ["Desktop app (Windows / Linux)"]
        EM["Electron main process<br/>single-instance lock · tray icon"]
        ES["Server child process<br/>spawned with ELECTRON_RUN_AS_NODE=1"]
        EW["BrowserWindow<br/>loads http://localhost:PORT"]
        ED[("SQLite in user data dir<br/>+ backup once per day on launch")]
        EM -->|spawns| ES
        EM -->|creates| EW
        EW -->|HTTP| ES
        ES --> ED
    end

    subgraph selfhost ["Self-hosted (Pi / NAS / Docker)"]
        DC["Docker container<br/>node server/index.js<br/>serves built client from /client/dist"]
        DV[("SQLite in named volume<br/>havoro-data")]
        BR["Any browser / PWA<br/>on the home network"]
        BR -->|"http://pi:3000"| DC
        DC --> DV
    end

    subgraph dev ["Development"]
        VITE["Vite dev server :5173<br/>proxies /api → :3000"]
        NS["node --watch server :3000"]
        VITE -->|proxy| NS
    end
```

The Electron wrapper is deliberately thin: it spawns the same server as a child process (with `ELECTRON_RUN_AS_NODE=1` so the Electron binary behaves as plain Node.js), waits for `/api/health`, then opens a window pointed at localhost. All app logic lives in the server and SPA, so the desktop and self-hosted experiences can't drift apart.

The one exception is `electron/preload.js` — a small `contextBridge` boundary (`nodeIntegration: false`, `contextIsolation: true` throughout) that exposes exactly two things to the renderer: downloading an update installer with progress, and handing the downloaded file to the OS to run. Everything else the renderer needs comes from the same HTTP API as self-hosted mode.

## Database schema

```mermaid
erDiagram
    users {
        int id PK
        text email UK
        text password_hash "random, unused on desktop — no password there"
        int is_admin
        text theme "light/dark/system"
    }

    accounts {
        int id PK
        text name
        text type "transaction/savings/offset/credit_card/super/property/share_portfolio/other_asset/liability"
        int current_balance_cents
        int include_in_net_worth
        int linked_loan_account_id FK
        int archived
    }

    categories {
        int id PK
        text name
        int parent_id FK
        text kind "income/expense/transfer"
    }

    category_rules {
        int id PK
        text match_type "contains/startswith/regex"
        text pattern
        int category_id FK
        int priority
    }

    transactions {
        int id PK
        int account_id FK
        text date
        text description
        int amount_cents
        int category_id FK
        int is_transfer
        text import_hash UK "dedupe on re-import"
    }

    budgets {
        int id PK
        int category_id FK
        int amount_cents
        int rollover
        text start_month
    }

    goals {
        int id PK
        text kind "goal/sinking_fund"
        int target_amount_cents
        int current_amount_cents
        int linked_account_id FK
    }

    transfer_plans {
        int id PK
        text name
        int to_account_id FK
        int amount_cents
        text cadence "weekly...annual, normalised to monthly"
    }

    holdings {
        int id PK
        int portfolio_account_id FK
        text ticker
        real units
        int current_price_cents
    }

    trades {
        int id PK
        int holding_id FK
        text type "buy/sell"
    }

    price_history {
        int id PK
        int holding_id FK
        text date
        int close_cents
    }

    property_valuations {
        int id PK
        int account_id FK
        int value_cents
        text source "manual/domain/vg_land"
    }

    balance_snapshots {
        int id PK
        text snapshot_date
        int account_id FK
        int balance_cents
    }

    check_ins {
        int id PK
        text date
    }

    accounts ||--o{ transactions : has
    accounts ||--o{ holdings : "portfolio holds"
    accounts ||--o{ property_valuations : "valued by"
    accounts ||--o{ balance_snapshots : "snapshotted in"
    accounts ||--o{ transfer_plans : "receives"
    accounts |o--o| accounts : "offset links loan"
    categories ||--o{ transactions : categorises
    categories ||--o{ budgets : budgeted
    categories ||--o{ category_rules : "matched by"
    categories |o--o{ categories : "parent of"
    holdings ||--o{ trades : records
    holdings ||--o{ price_history : tracks
    check_ins ||--o{ balance_snapshots : groups
    goals }o--o| accounts : "optionally linked"
```

Schema lives in [`server/db/schema.sql`](../server/db/schema.sql) (idempotent `CREATE TABLE IF NOT EXISTS`), with additive live migrations in [`server/db/db.js`](../server/db/db.js) so existing databases upgrade in place on every start. Categories, starter rules, and the admin user are seeded on first run.

## CSV import pipeline

The feature most likely to touch users' trust — bank data — never leaves the machine:

```mermaid
sequenceDiagram
    actor U as User
    participant C as React client
    participant I as /api/import
    participant R as Rules engine
    participant DB as SQLite

    U->>C: Upload bank CSV (file picker)
    C->>I: POST multipart (file + account)
    I->>I: Detect bank profile<br/>(ANZ/NAB/Westpac/CommBank column maps)
    I->>I: Parse rows → normalise dates/amounts to cents
    I->>I: Hash each row (import_hash)
    I->>DB: INSERT OR IGNORE (dupes skipped by unique hash)
    I->>R: Run category_rules by priority,<br/>first match wins
    R->>DB: Set category_id where matched
    I-->>C: {imported, skipped, categorised}
    C-->>U: Badge shows count still needing review
```

Re-importing an overlapping date range is safe — the `import_hash` unique constraint makes import idempotent.

## Release pipeline

```mermaid
flowchart LR
    TAG["git tag v1.x.x<br/>pushed to public repo"] --> GHA["GitHub Actions<br/>release.yml"]
    GHA --> W["windows-latest<br/>electron-builder → NSIS .exe"]
    GHA --> L["ubuntu-latest<br/>electron-builder → .AppImage"]
    W --> REL["GitHub Release<br/>artifacts attached"]
    L --> REL
    REL --> UPD["In-app 'Check for updates'<br/>compares running version<br/>to latest release tag"]
```

Version source of truth: the `version` field in the four `package.json` files (root, `server/`, `client/`, `electron/`), kept in lockstep with the release tag. The Settings → About panel reads the server's copy at runtime.

## Security model (summary)

Full detail in [SECURITY.md](SECURITY.md). The short version:

- Passwords: bcrypt (cost 12). Sessions: JWT in httpOnly cookie, `JWT_SECRET` required or the server refuses to boot.
- Helmet security headers; JSON body limit; CORS locked to the dev origin outside production.
- The desktop app generates and stores its own random JWT secret on first run.
- SQLite file permissions are the user's own; Docker runs as a non-root user.
- No secrets in the repository — configuration via environment variables only.

## Planned: device sync

Sync between the desktop app and the upcoming iPhone app is designed (hub-and-spoke over LAN, row-timestamp change tracking, last-write-wins) but not yet built. The full design, including the schema groundwork shipping ahead of the phone app, is in [SYNC-DESIGN.md](SYNC-DESIGN.md).
