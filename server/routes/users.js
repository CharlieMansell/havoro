const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

const SELECT_USER = 'SELECT id, name, email, is_admin, role, created_at FROM users';

router.get('/', requireAdmin, (req, res) => {
  res.json(db.prepare(`${SELECT_USER} ORDER BY created_at`).all());
});

router.post('/', requireAdmin, (req, res) => {
  const { name, email, password, role = 'member' } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'role must be admin or member' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(400).json({ error: 'Email already in use' });

  const hash = bcrypt.hashSync(password, 12);
  const isAdmin = role === 'admin' ? 1 : 0;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (name, email, password_hash, is_admin, role) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email.toLowerCase(), hash, isAdmin, role);

  res.status(201).json(db.prepare(`${SELECT_USER} WHERE id = ?`).get(lastInsertRowid));
});

router.put('/:id', requireAdmin, (req, res) => {
  const { name, role, new_password } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (name !== undefined) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.params.id);
  }
  if (role !== undefined) {
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'role must be admin or member' });
    // Prevent removing the last admin
    if (role === 'member') {
      const adminCount = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'").get();
      const thisUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
      if (adminCount.n <= 1 && thisUser.role === 'admin') {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }
    db.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?').run(role, role === 'admin' ? 1 : 0, req.params.id);
  }
  if (new_password) {
    if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 12), req.params.id);
  }

  res.json(db.prepare(`${SELECT_USER} WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  const total = db.prepare('SELECT COUNT(*) as n FROM users').get();
  if (total.n <= 1) return res.status(400).json({ error: 'Cannot delete the last user' });

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
