require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}
if (process.env.JWT_SECRET === 'change-me-to-a-long-random-secret') {
  console.error('FATAL: JWT_SECRET is still the example placeholder from .env.example. Refusing to start.');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET is too short (must be at least 32 characters). Refusing to start.');
  process.exit(1);
}

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const backupScheduler = require('./services/backupScheduler');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // inline style="" attrs used for dynamic category colors
      imgSrc: ["'self'", 'data:'],
      // The one legitimate cross-origin call the app makes: Settings' "Check
      // for updates" queries GitHub's API directly from the renderer.
      connectSrc: ["'self'", 'https://api.github.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? false
  : [process.env.CLIENT_ORIGIN || 'http://localhost:5173'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Auth is entirely cookie-based (see routes/auth.js), so every mutating
// request needs an explicit CSRF defense on top of the SameSite=Lax cookie
// above. A custom header can't be attached to a cross-origin request without
// a CORS preflight succeeding, and the origin lock above means it never
// does — so requiring it here is a check only same-origin JS can pass.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || req.headers['x-havoro-csrf']) return next();
  res.status(403).json({ error: 'Missing CSRF header' });
});

// Health check (unauthenticated — used by Docker and Electron)
app.get('/api/health', (req, res) => res.json({ ok: true }));

// General API throttle — /api/auth/login has its own tighter limiter on top of this
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', generalLimiter);

// Routes
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/accounts',     require('./routes/accounts'));
app.use('/api/categories',   require('./routes/categories'));
app.use('/api/rules',        require('./routes/rules'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/budgets',      require('./routes/budgets'));
app.use('/api/import',       require('./routes/import'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/checkin',      require('./routes/checkin'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/users',        require('./routes/users'));
app.use('/api/goals',        require('./routes/goals'));
app.use('/api/holdings',     require('./routes/holdings'));
app.use('/api/transfers',    require('./routes/transfers'));

// Serve built client in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = process.env.CLIENT_DIST || path.join(__dirname, '../client/dist');
  // Any request that reaches here already fell through every /api route
  // above without a response being sent, so reusing the same limiter/store
  // just means static assets and the SPA fallback below share one budget
  // with the API instead of being unthrottled.
  app.use(generalLimiter);
  // index: false — otherwise express.static serves index.html itself for
  // any directory-style request (including "/"), with its own default
  // caching, before the no-store route below ever runs.
  app.use(express.static(clientDist, { index: false }));
  // Express 5's router (path-to-regexp v8) rejects a bare '*' — wildcards
  // must be named. '/*splat' alone doesn't match the bare root path though
  // (unlike the old '*'), so '/' needs to be listed explicitly alongside it.
  app.get(['/', '/*splat'], (req, res) => {
    // Electron's disk cache lives in userData and survives app upgrades by
    // design (that's what keeps your data safe) — but without this, a
    // cached copy of the app shell (including whatever CSP/security headers
    // were attached at the time) can get stuck indefinitely across version
    // upgrades, since nothing tells the browser the old one is invalid. The
    // hashed JS/CSS asset files under express.static above are unaffected
    // and stay cacheable — their filenames change whenever their content
    // does, so there's nothing to go stale there.
    // cacheControl: false stops sendFile from setting its own Cache-Control
    // (public, max-age=0 by default), which would otherwise silently
    // override the header set here.
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(clientDist, 'index.html'), { cacheControl: false });
  });
}

// Without this, any error a route doesn't catch itself (e.g. Multer
// rejecting an oversized upload) falls through to Express's default
// handler, which sends an HTML error page — every client fetch call here
// expects JSON back and throws trying to parse it.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
const LOCAL_MODE = process.env.LOCAL_MODE === 'true';

// Desktop mode has a no-password local-login route (see routes/auth.js), so
// it must never be reachable from the network — bind to loopback only.
// Docker/self-host mode keeps listening on all interfaces (default).
const listenArgs = LOCAL_MODE ? [PORT, '127.0.0.1'] : [PORT];
app.listen(...listenArgs, () => {
  console.log(`Havoro server running on port ${PORT}${LOCAL_MODE ? ' (127.0.0.1 only — local mode)' : ''}`);
  backupScheduler.start();
});
