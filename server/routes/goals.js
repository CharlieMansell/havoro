const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM goals WHERE archived = 0 ORDER BY priority, id'
  ).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, kind, target_amount_cents, current_amount_cents = 0, target_date, cadence, priority = 100, linked_account_id } = req.body;
  if (!name || !kind || !target_amount_cents) {
    return res.status(400).json({ error: 'name, kind and target_amount_cents required' });
  }
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO goals (name, kind, target_amount_cents, current_amount_cents, target_date, cadence, priority, linked_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, kind, target_amount_cents, current_amount_cents, target_date || null, cadence || null, priority, linked_account_id || null);
  res.status(201).json(db.prepare('SELECT * FROM goals WHERE id = ?').get(lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const goal = db.prepare('SELECT id FROM goals WHERE id = ?').get(req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const { name, kind, target_amount_cents, current_amount_cents, target_date, cadence, priority, linked_account_id } = req.body;
  db.prepare(
    `UPDATE goals SET
      name = COALESCE(?, name),
      kind = COALESCE(?, kind),
      target_amount_cents = COALESCE(?, target_amount_cents),
      current_amount_cents = COALESCE(?, current_amount_cents),
      target_date = ?,
      cadence = ?,
      priority = COALESCE(?, priority),
      linked_account_id = ?
     WHERE id = ?`
  ).run(name, kind, target_amount_cents, current_amount_cents, target_date || null, cadence || null, priority, linked_account_id || null, req.params.id);
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const goal = db.prepare('SELECT id FROM goals WHERE id = ?').get(req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  db.prepare('UPDATE goals SET archived = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
