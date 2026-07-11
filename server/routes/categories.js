const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      p.name as parent_name
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    ORDER BY c.parent_id NULLS FIRST, c.name
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, parent_id, kind, color, icon } = req.body;
  if (!name || !kind) return res.status(400).json({ error: 'name and kind required' });

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO categories (name, parent_id, kind, color, icon) VALUES (?, ?, ?, ?, ?)'
  ).run(name, parent_id || null, kind, color || null, icon || null);

  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const allowed = ['name','parent_id','kind','color','icon'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

  const set = fields.map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE categories SET ${set} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) as n FROM transactions WHERE category_id = ?').get(req.params.id);
  if (used.n > 0) return res.status(400).json({ error: 'Category has transactions; reassign them first' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
