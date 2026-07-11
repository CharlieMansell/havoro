# Havoro — Technical Reference

Architecture, database schema, API reference, and configuration details.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker container                      │
│                                                         │
│  ┌──────────────────────┐   ┌───────────────────────┐  │
│  │   React + Vite SPA   │   │   Express API server   │  │
│  │  (pre-built static)  │   │    Node.js 20 LTS      │  │
│  │   served by Express  │   │    PORT 3000            │  │
│  └──────────────────────┘   └──────────┬──────────────┘  │
│                                        │                 │
│                               ┌────────▼────────┐       │
│                               │  SQLite 3 (WAL) │       │
│                               │  /app/data/     │       │
│                               │  havoro.db  │       │
│                               └─────────────────┘       │
└─────────────────────────────────────────────────────────┘
         │ host port (HOST_PORT, default 3000)
         ▼
   Browser / PWA
```

- **Frontend:** React 18, React Router v6, Recharts, TailwindCSS, Vite, vite-plugin-pwa
- **Backend:** Express 4, better-sqlite3, jsonwebtoken, bcryptjs, multer, node-cron, csv-parse
- **Database:** SQLite 3 with WAL journaling and foreign keys enabled
- **Container:** Node 20 Bookworm Slim, two-stage Docker build (client compiled separately, output copied into server image)
- **Auth:** httpOnly JWT cookie, 7-day expiry, rotated on each request

---

## Directory structure

```
havoro/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/      # Shared UI (Layout, Modal, Card, etc.)
│   │   ├── contexts/        # React context (AuthContext, ToastContext, etc.)
│   │   ├── pages/           # One file per route
│   │   └── main.jsx         # Entry point
│   ├── public/              # Static assets (icon.svg, PWA icons)
│   ├── index.html
│   └── vite.config.js       # Vite + PWA plugin config
│
├── server/
│   ├── index.js             # Express app entry point
│   ├── routes/              # One file per API group
│   │   ├── auth.js
│   │   ├── accounts.js
│   │   ├── categories.js
│   │   ├── rules.js
│   │   ├── transactions.js
│   │   ├── budgets.js
│   │   ├── import.js
│   │   ├── dashboard.js
│   │   ├── checkin.js
│   │   ├── holdings.js
│   │   ├── goals.js
│   │   ├── users.js
│   │   └── settings.js
│   ├── services/
│   │   └── priceService.js  # Share price fetching (Stooq + Yahoo Finance fallback)
│   ├── db/
│   │   ├── schema.sql       # Full database schema + seed data
│   │   └── index.js         # DB connection + initialisation
│   ├── middleware/
│   │   └── auth.js          # JWT verification middleware
│   └── bank-profiles/       # CSV column mapping JSONs
│       ├── anz.json
│       ├── nab.json
│       ├── westpac.json
│       └── commbank.json
│
├── .github/workflows/
│   └── deploy.yml           # Self-hosted runner: pull + docker compose up
│
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## Database schema

Engine: SQLite 3, WAL mode, foreign keys ON.

### users
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| name | TEXT NOT NULL | Display name |
| email | TEXT UNIQUE NOT NULL | Login identifier |
| password_hash | TEXT NOT NULL | bcrypt, cost 12 |
| is_admin | INTEGER | 0/1 boolean |
| role | TEXT | `admin` or `member` |
| created_at | TEXT | ISO timestamp |

No row is seeded on first run — the table starts empty, and `POST /api/auth/setup` (server mode) or `POST /api/auth/local-setup` (desktop, name only) creates the first admin account. Both routes refuse to run again once any user exists.

---

### accounts
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT NOT NULL | |
| type | TEXT | `transaction`, `savings`, `offset`, `credit_card`, `super`, `property`, `share_portfolio`, `other_asset`, `liability` |
| institution | TEXT | Bank/institution name |
| current_balance_cents | INTEGER | Balance in cents |
| is_manual_balance | INTEGER | 1 = balance is set directly, not derived from transactions |
| include_in_net_worth | INTEGER | 1 = included in net worth calculations |
| linked_loan_account_id | INTEGER FK | Points to another account (used for property→mortgage LVR) |
| address | TEXT | For property accounts |
| domain_property_id | TEXT | For Domain valuation integration |
| lvr_ceiling | REAL | Warning threshold for LVR (e.g. 0.8 = 80%) |
| archived | INTEGER | Soft delete flag |
| created_at | TEXT | |

---

### categories
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT NOT NULL | |
| parent_id | INTEGER FK | Self-referencing; NULL for top-level |
| kind | TEXT | `income`, `expense`, `transfer` |
| color | TEXT | Hex colour (e.g. `#16a34a`) |
| icon | TEXT | Emoji or icon name |

30+ categories seeded on first run across 9 parent groups: Income, Housing, Food, Transport, Health, Lifestyle, Finance, Family, Transfers.

---

### category_rules
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| match_type | TEXT | `contains`, `startswith`, `regex` |
| pattern | TEXT | String or regex to match against transaction description |
| category_id | INTEGER FK | |
| priority | INTEGER | Lower = higher priority; first match wins |
| active | INTEGER | 1 = enabled |

20 starter rules seeded (Woolworths→Groceries, Netflix→Subscriptions, etc.).

---

### transactions
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| account_id | INTEGER FK | |
| date | TEXT | `YYYY-MM-DD` |
| description | TEXT | Raw from CSV |
| description_clean | TEXT | User-edited clean description |
| amount_cents | INTEGER | Signed (negative = debit) |
| category_id | INTEGER FK | NULL = uncategorised |
| notes | TEXT | User notes |
| is_transfer | INTEGER | 1 = excluded from budget/category |
| transfer_pair_id | INTEGER | ID of the paired transaction |
| import_hash | TEXT UNIQUE | SHA hash for deduplication |
| source_file | TEXT | Original CSV filename |
| created_at | TEXT | |

Indexes: `(account_id, date)`, `(category_id)`, `(date)`, `(category_id, date)`, plus a partial index on uncategorised transactions.

---

### budgets
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| category_id | INTEGER FK | |
| amount_cents | INTEGER | Monthly budget in cents |
| rollover | INTEGER | 1 = unspent amount carries to next month |
| start_month | TEXT | `YYYY-MM` |

---

### goals
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT NOT NULL | |
| kind | TEXT | `goal` or `sinking_fund` |
| target_amount_cents | INTEGER | |
| current_amount_cents | INTEGER | |
| target_date | TEXT | Optional `YYYY-MM-DD` |
| cadence | TEXT | `weekly`, `fortnightly`, `monthly`, or NULL |
| priority | INTEGER | Lower = shown first |
| linked_account_id | INTEGER FK | Optional link to an account |
| archived | INTEGER | Soft delete |

---

### holdings
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| portfolio_account_id | INTEGER FK | Parent share portfolio account |
| ticker | TEXT | e.g. `BHP`, `VAS`, `AAPL` |
| exchange | TEXT | Default `ASX`; also `NYSE`, `NASDAQ`, etc. |
| yahoo_symbol | TEXT | Yahoo Finance ticker (e.g. `BHP.AX`, `AAPL`) — used for price fetching |
| units | REAL | Number of units/shares held |
| avg_cost_cents | INTEGER | Average cost per unit in cents |
| current_price_cents | INTEGER | Last known price in cents |
| price_updated_at | TEXT | Timestamp of last price update |

---

### trades
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| holding_id | INTEGER FK | |
| date | TEXT | `YYYY-MM-DD` |
| type | TEXT | `buy` or `sell` |
| units | REAL | |
| price_cents | INTEGER | Per-unit price |
| fee_cents | INTEGER | Brokerage fee |

---

### price_history
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| holding_id | INTEGER FK | |
| date | TEXT | `YYYY-MM-DD` |
| close_cents | INTEGER | Closing price in cents |

Unique constraint on `(holding_id, date)`.

---

### property_valuations
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| account_id | INTEGER FK | |
| date | TEXT | |
| value_cents | INTEGER | |
| source | TEXT | `manual`, `domain`, `vg_land` |
| confidence | TEXT | Optional confidence level |

Unique constraint on `(account_id, date)`.

---

### balance_snapshots
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| snapshot_date | TEXT | `YYYY-MM-DD` |
| account_id | INTEGER FK | |
| balance_cents | INTEGER | |

Index on `snapshot_date`. Populated when a check-in is recorded.

---

### check_ins
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| date | TEXT | Default: today's date |
| notes | TEXT | Optional free-text notes |

One check-in per day (enforced by the route, not a DB constraint).

---

### settings
| Column | Type | Notes |
|---|---|---|
| key | TEXT PK | Setting name |
| value | TEXT | Setting value |

Seeded defaults:
- `default_growth_cash` = `4.5`
- `default_growth_shares` = `9`
- `default_growth_property` = `5`
- `default_growth_super` = `8`

---

### recurring_items
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | |
| direction | TEXT | `income` or `expense` |
| amount_cents | INTEGER | |
| cadence | TEXT | `weekly`, `fortnightly`, `monthly`, `quarterly`, `annual` |
| next_date | TEXT | `YYYY-MM-DD` |
| category_id | INTEGER FK | |
| auto_detected | INTEGER | 1 = surfaced automatically |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | — | **Required.** 48+ byte random hex string. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | `3000` | Internal port the Express server listens on |
| `HOST_PORT` | `3000` | Port exposed on the Docker host |
| `NODE_ENV` | `development` | Set to `production` in Docker |
| `COOKIE_SECURE` | `false` | Set `true` only when serving over HTTPS (behind a reverse proxy) |
| `DB_PATH` | `/app/data/havoro.db` | Path to the SQLite database file inside the container |
| `BACKUP_DIR` | `/app/backups` | Backup destination inside the container |
| `BACKUP_HOST_DIR` | `./backups` | Host path for backup volume mount (set in docker-compose.yml) |
| `BACKUP_CRON` | `0 2 * * *` | Cron schedule for automatic backups |
| `BACKUP_KEEP_DAYS` | `30` | How many daily backups to retain before pruning |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS origin (dev only; not relevant in Docker where client is served by Express) |

---

## API reference

All endpoints are prefixed `/api/`. Authentication is via an httpOnly cookie set on login.

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Login with email + password. Sets JWT cookie. |
| POST | `/api/auth/logout` | Yes | Clear auth cookie. |
| GET | `/api/auth/me` | Yes | Current user (id, name, email, is_admin, role). |
| PUT | `/api/auth/profile` | Yes | Update display name. |
| POST | `/api/auth/change-password` | Yes | Change password (requires current password). |

### Accounts

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/accounts` | Yes | List all non-archived accounts. Response includes `loan_name`, `loan_balance_cents` (for linked mortgage), and `portfolio_cost_cents` (total avg cost across all holdings, for share portfolios). |
| POST | `/api/accounts` | Yes | Create account. |
| PUT | `/api/accounts/:id` | Yes | Update account. |
| PATCH | `/api/accounts/:id/balance` | Yes | Update balance (manual accounts only). |
| DELETE | `/api/accounts/:id` | Yes | Archive account (soft delete). |

### Categories

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/categories` | Yes | List all categories with parent info. |
| POST | `/api/categories` | Yes | Create category. |
| PUT | `/api/categories/:id` | Yes | Update category. |
| DELETE | `/api/categories/:id` | Yes | Delete (only if unused). |

### Categorisation rules

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/rules` | Yes | List all rules. |
| POST | `/api/rules` | Yes | Create rule. |
| PUT | `/api/rules/:id` | Yes | Update rule. |
| DELETE | `/api/rules/:id` | Yes | Delete rule. |

### Transactions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/transactions` | Yes | Paginated list. Filters: `account_id`, `category_id`, `needs_review`, `is_transfer`, `date_from`, `date_to`, `search`, `page`, `limit` (default 50). |
| GET | `/api/transactions/needs-review/count` | Yes | Count of uncategorised non-transfer transactions. |
| PUT | `/api/transactions/:id` | Yes | Update category, notes, description_clean, is_transfer. |
| POST | `/api/transactions/:id/suggest-rule` | Yes | Return a suggested categorisation rule for this transaction. |

### Budgets

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/budgets` | Yes | List all budgets. |
| GET | `/api/budgets/summary?month=YYYY-MM` | Yes | Monthly summary: actuals vs budgets, safe-to-spend, income/expense totals. |
| POST | `/api/budgets` | Yes | Create budget. |
| PUT | `/api/budgets/:id` | Yes | Update budget. |
| DELETE | `/api/budgets/:id` | Yes | Delete budget. |

### Goals

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/goals` | Yes | List non-archived goals. |
| POST | `/api/goals` | Yes | Create goal. |
| PUT | `/api/goals/:id` | Yes | Update goal. |
| DELETE | `/api/goals/:id` | Yes | Archive goal (soft delete). |

### Import

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/import/profiles` | Yes | List available bank CSV profiles. |
| POST | `/api/import/preview` | Yes | Parse CSV, return sample rows. Multipart: `file`, `profileId`. |
| POST | `/api/import` | Yes | Import CSV into account. Multipart: `file`, `profileId`, `accountId`. |

### Dashboard

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard/summary` | Yes | Full dashboard data: net worth, asset breakdown, monthly snapshot, top categories, goals, check-in history. |

### Holdings

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/holdings?portfolio_id=X` | Yes | List holdings for a share portfolio account. |
| POST | `/api/holdings` | Yes | Create holding. Required: `portfolio_account_id`, `ticker`. Optional: `exchange` (default `ASX`), `yahoo_symbol`, `units`, `avg_cost_cents`, `current_price_cents`. |
| PUT | `/api/holdings/:id` | Yes | Update holding. Recalculates portfolio account balance. |
| DELETE | `/api/holdings/:id` | Yes | Delete holding (also deletes associated trades and price history). Recalculates portfolio account balance. |
| POST | `/api/holdings/refresh-prices?portfolio_id=X` | Yes | Force-fetch live prices for all holdings in a portfolio, update `accounts.current_balance_cents`, and return updated holdings. Response: `{ holdings, portfolio_value_cents, any_error }`. |

### Check-ins

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/checkin/prefill` | Yes | Pre-fill data for check-in modal: all net-worth accounts with current balances. For share portfolios, fetches live prices (cached 1 h) and syncs `current_balance_cents`. Returns `{ accounts, today_checkin_id }`. |
| POST | `/api/checkin` | Yes | Record a check-in (snapshots all net-worth account balances). |
| GET | `/api/checkin/history` | Yes | Last 24 check-ins with computed net worth per check-in. |

### Users (admin only)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/users` | Admin | List all users. |
| POST | `/api/users` | Admin | Create user (name, email, password, role). |
| PUT | `/api/users/:id` | Admin | Update user (name, role, new_password). |
| DELETE | `/api/users/:id` | Admin | Delete user (cannot delete self or last user). |

### Settings (admin only)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/settings` | Yes | Fetch all settings as key-value pairs. |
| PUT | `/api/settings` | Admin | Upsert settings. |
| POST | `/api/settings/backup` | Admin | Trigger manual backup. |
| GET | `/api/settings/backups` | Admin | List available backup files. |
| POST | `/api/settings/restore/:filename` | Admin | Restore database from backup. |
| GET | `/api/settings/backup-schedule` | Admin | Get current backup cron schedule. |
| PUT | `/api/settings/backup-schedule` | Admin | Update backup cron schedule. |

---

## Bank CSV profiles

Profiles live in `server/bank-profiles/` as JSON files. Each profile defines how to map CSV columns to Havoro's fields.

**Example profile structure:**

```json
{
  "id": "anz",
  "name": "ANZ",
  "account_match": "ANZ",
  "date_col": "Date",
  "date_format": "DD/MM/YYYY",
  "description_col": "Description",
  "amount_col": "Amount",
  "debit_col": null,
  "credit_col": null
}
```

If your bank exports separate debit/credit columns (rather than a signed amount), use `debit_col` and `credit_col` instead of `amount_col`.

To add a new bank:
1. Export a sample CSV from your bank
2. Create a new JSON file in `server/bank-profiles/` matching the column names exactly
3. Add the profile to the `profiles` array in `server/routes/import.js`
4. Restart the server

---

## Share price fetching

Live prices are fetched by `server/services/priceService.js`, which is used by both the check-in prefill route and the holdings refresh-prices endpoint.

**Provider chain:**

1. **Stooq** (primary) — Free CSV feed, no API key required. Symbol format: `{ticker}.au` (ASX), `{ticker}.uk` (LSE), `{ticker}.us` (NYSE/NASDAQ). URL: `https://stooq.com/q/l/?s={symbol}&f=sd2t2ohlcv&h&e=csv`. Close price is parsed from column index 5.

2. **Yahoo Finance** (fallback) — Used only if Stooq fails and the holding has a `yahoo_symbol` set. Uses the `yahoo-finance2` npm package (`quote()` method). The Yahoo symbol is stored per-holding and can be customised (e.g. `BHP.AX`, `AAPL`, `HSBA.L`).

**Caching:** Prices are cached in the `holdings` table (`current_price_cents`, `price_updated_at`) for 1 hour. Calls with `{ force: true }` bypass the cache.

**Manual prices:** Any holding's price can be set manually via the Edit holding form. The price is stored in `current_price_cents` and used for all calculations until the next successful auto-fetch.

**Balance sync:** After any price update, the portfolio account's `current_balance_cents` is recalculated as `SUM(units × current_price_cents)` across all holdings.

---

## Authentication flow

1. Client POSTs credentials to `/api/auth/login`
2. Server verifies bcrypt hash, issues a JWT signed with `JWT_SECRET`
3. JWT is set as an httpOnly, SameSite=Lax cookie (Secure=true if `COOKIE_SECURE=true`)
4. All subsequent requests include the cookie automatically
5. Server middleware verifies the JWT on every protected route
6. Cookie expires after 7 days; login refreshes it

Passwords are hashed with bcrypt at cost factor 12.

---

## Docker build

Two-stage build:

**Stage 1 (client-builder):**
- `node:20-bookworm-slim`
- Install client dependencies, run `vite build`
- Output: `client/dist/`

**Stage 2 (production):**
- `node:20-bookworm-slim`
- Install native build tools for `better-sqlite3` (python3, make, g++)
- Install server production dependencies only (`npm ci --omit=dev`)
- Copy `client/dist/` from stage 1
- Serves static files from Express (`/api/*` → routes, everything else → `index.html`)

**Volumes:**
- `havoro-data` (Docker named volume) → `/app/data/` — contains the SQLite database
- `./server/bank-profiles` → `/app/server/bank-profiles` (read-only bind mount) — allows adding profiles without rebuilding
- `${BACKUP_HOST_DIR:-./backups}` → `/app/backups` — backup files on the host

---

## Development setup

See [CONTRIBUTING.md](../CONTRIBUTING.md).
