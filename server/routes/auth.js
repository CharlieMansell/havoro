const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const { rateLimit } = require('express-rate-limit');

const SECRET = () => process.env.JWT_SECRET;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function makeToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin, role: user.role || (user.is_admin ? 'admin' : 'member') },
    SECRET(),
    { expiresIn: '7d' }
  );
}

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.cookie('token', makeToken(user), COOKIE_OPTS)
     .json({ id: user.id, name: user.name, email: user.email, is_admin: user.is_admin, theme: user.theme });
});

// GET /api/auth/needs-setup — true until the very first admin account is created.
// There is no default account anymore: a fresh install has zero users, and the
// first person to open the app creates the admin account themselves.
router.get('/needs-setup', (req, res) => {
  const { n } = db.prepare('SELECT COUNT(*) as n FROM users').get();
  res.json({ needsSetup: n === 0, localMode: process.env.LOCAL_MODE === 'true' });
});

// POST /api/auth/setup — create the first admin account (server / self-hosted mode).
// Only works while the users table is empty; every install goes through this
// exactly once.
router.post('/setup', loginLimiter, (req, res) => {
  const { n } = db.prepare('SELECT COUNT(*) as n FROM users').get();
  if (n > 0) return res.status(403).json({ error: 'Setup has already been completed' });

  const { name, email, password } = req.body;
  if (!name?.trim() || !email || !password) {
    return res.status(400).json({ error: 'name, email and password required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash = bcrypt.hashSync(password, 12);
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO users (name, email, password_hash, is_admin, role) VALUES (?, ?, ?, 1, 'admin')"
  ).run(name.trim(), email.toLowerCase(), hash);
  const user = db.prepare('SELECT id, name, email, is_admin, role, theme FROM users WHERE id = ?').get(lastInsertRowid);

  res.cookie('token', makeToken(user), COOKIE_OPTS).json(user);
});

// POST /api/auth/local-setup — desktop only. Creates the single local account
// from just a first name; email and password are never seen by the user, since
// there's nothing to log into on a single-machine install (see local-login).
router.post('/local-setup', (req, res) => {
  if (process.env.LOCAL_MODE !== 'true') return res.status(404).json({ error: 'Not found' });
  const { n } = db.prepare('SELECT COUNT(*) as n FROM users').get();
  if (n > 0) return res.status(403).json({ error: 'Setup has already been completed' });

  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const hash = bcrypt.hashSync(require('crypto').randomBytes(32).toString('hex'), 12);
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO users (name, email, password_hash, is_admin, role) VALUES (?, 'admin@havoro.local', ?, 1, 'admin')"
  ).run(name.trim(), hash);
  const user = db.prepare('SELECT id, name, email, is_admin, role, theme FROM users WHERE id = ?').get(lastInsertRowid);

  res.cookie('token', makeToken(user), COOKIE_OPTS).json(user);
});

// POST /api/auth/local-login — desktop only. Silently signs in as the single
// local account with no password, since the OS session is the actual security
// boundary on a single-machine install. The server only binds to 127.0.0.1 in
// this mode (see index.js), so this can never be reached over the network.
router.post('/local-login', (req, res) => {
  if (process.env.LOCAL_MODE !== 'true') return res.status(404).json({ error: 'Not found' });

  const user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
  if (!user) return res.status(404).json({ error: 'No local account yet' });

  res.cookie('token', makeToken(user), COOKIE_OPTS)
     .json({ id: user.id, name: user.name, email: user.email, is_admin: user.is_admin, theme: user.theme });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token').json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, is_admin, role, theme FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.user.id);
  const user = db.prepare('SELECT id, name, email, is_admin, role, theme FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// PUT /api/auth/theme — persists to the account, so it follows you across devices
router.put('/theme', requireAuth, (req, res) => {
  const { theme } = req.body;
  if (!['light', 'dark', 'system'].includes(theme)) {
    return res.status(400).json({ error: "theme must be 'light', 'dark', or 'system'" });
  }
  db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.user.id);
  res.json({ ok: true, theme });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password required' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
