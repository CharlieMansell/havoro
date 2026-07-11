# Contributing to Havoro

Thank you for your interest in contributing. This guide covers local development setup, code structure, and how to submit changes.

---

## Local development setup

### Requirements

- Node.js 20+
- npm 10+
- Git

### Clone and install

```bash
git clone https://github.com/<your-github-username>/havoro.git
cd havoro
npm run install:all
```

This installs dependencies for the root, `server/`, and `client/` in one step.

### Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
JWT_SECRET=any-string-works-for-local-dev
NODE_ENV=development
COOKIE_SECURE=false
```

### Start the dev servers

```bash
npm run dev
```

This starts:
- **Backend** on `http://localhost:3000` (auto-reloads via `node --watch`)
- **Frontend** on `http://localhost:5173` (Vite HMR)

The Vite dev server proxies `/api/*` requests to `localhost:3000`, so you only need to open `http://localhost:5173`.

### First run

There's no default account — the database starts empty, and opening `http://localhost:5173` for the first time prompts you to create the admin account (name, email, password). The database file itself is created automatically at the path in `DB_PATH` (default: `./data/havoro.db` in development).

---

## Project structure

```
havoro/
├── client/src/
│   ├── components/     # Shared UI components
│   │   ├── Layout.jsx  # Sidebar + header shell
│   │   ├── Modal.jsx
│   │   ├── Card.jsx
│   │   └── ...
│   ├── contexts/       # React context providers
│   │   ├── AuthContext.jsx
│   │   └── ToastContext.jsx
│   └── pages/          # One component per route
│       ├── Dashboard.jsx
│       ├── Transactions.jsx
│       └── ...
│
├── server/
│   ├── index.js        # Express app + middleware setup
│   ├── routes/         # One file per API group
│   ├── services/       # Price fetching, backup scheduler, CSV importer
│   ├── db/
│   │   ├── schema.sql  # Database schema + seed data
│   │   └── index.js    # DB initialisation + connection
│   └── middleware/
│       └── auth.js     # JWT verification
│
└── electron/           # Desktop app wrapper (builds .exe/.AppImage — no macOS build)
    ├── main.js         # Electron entry point
    ├── preload.js      # contextBridge: exposes just the update download/install API
    └── electron-builder.yml
```

---

## Adding a feature

### Backend (new API endpoint)

1. Add the route to the appropriate file in `server/routes/`, or create a new file
2. Register the router in `server/index.js`
3. If you need a new table, add it to `server/db/schema.sql` inside the `db.exec(...)` block — the schema runs with `CREATE TABLE IF NOT EXISTS`, so existing databases are not affected

### Frontend (new page)

1. Create `client/src/pages/YourPage.jsx`
2. Add the route to `client/src/main.jsx`
3. Add a nav item to the `nav` array in `client/src/components/Layout.jsx` if it should appear in the sidebar

### Adding a bank CSV profile

1. Export a sample CSV from the bank
2. Create `server/bank-profiles/yourbank.json`:
   ```json
   {
     "id": "yourbank",
     "name": "Your Bank",
     "account_match": "YOURBANK",
     "date_col": "Date",
     "date_format": "DD/MM/YYYY",
     "description_col": "Description",
     "amount_col": "Amount",
     "debit_col": null,
     "credit_col": null
   }
   ```
3. Add the profile to the `profiles` array in `server/routes/import.js`

---

## Code style

- **No TypeScript** — plain JavaScript throughout
- **No CSS files** — TailwindCSS utility classes only
- **Comments** — only when the _why_ is non-obvious; don't narrate what the code does
- **Components** — function components with hooks; no class components
- **State** — local `useState`/`useEffect` for component state; `AuthContext` for auth; no global state library
- **API calls** — use the `api` helper in `client/src/lib/api.js` (wraps fetch with auth cookie and error handling)
- **Money** — all monetary values are stored and passed as integer cents; format with a shared helper before display

---

## Submitting changes

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test on both mobile (Chrome DevTools → responsive) and desktop
5. Open a pull request with a clear description of what changed and why

### What makes a good PR

- Solves one clear problem or adds one coherent feature
- Works on mobile (390px wide) without horizontal overflow
- Doesn't introduce new dependencies unless genuinely necessary
- Doesn't break the existing API contract (other clients might depend on it)

---

## Running in Docker locally

To test the production Docker build:

```bash
docker compose up --build
```

This builds the React app and starts everything on `http://localhost:3000`. No Vite dev server — this is the exact environment that runs on the Pi.
