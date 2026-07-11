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
      connectSrc: ["'self'"],
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

// Health check (unauthenticated — used by Docker and Electron)
app.get('/api/health', (req, res) => res.json({ ok: true }));

// General API throttle — /api/auth/login has its own tighter limiter on top of this
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

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
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
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
