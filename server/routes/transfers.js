const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MONTHLY_FACTOR = {
  weekly:      52 / 12,
  fortnightly: 26 / 12,
  monthly:     1,
  quarterly:   1 / 3,
  annual:      1 / 12,
};

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT tp.*, a.name as account_name, a.type as account_type
    FROM transfer_plans tp
    LEFT JOIN accounts a ON a.id = tp.to_account_id
    ORDER BY COALESCE(tp.to_account_id, 999999), tp.sort_order, tp.name
  `).all();

  const withMonthly = rows.map(r => ({
    ...r,
    monthly_cents: Math.round(r.amount_cents * (MONTHLY_FACTOR[r.cadence] ?? 1)),
  }));

  res.json(withMonthly);
});

router.post('/', (req, res) => {
  const { name, to_account_id = null, amount_cents, cadence = 'monthly', notes = null, sort_order = 100 } = req.body;
  if (!name || amount_cents == null) {
    return res.status(400).json({ error: 'name and amount_cents are required' });
  }
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO transfer_plans (name, to_account_id, amount_cents, cadence, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, to_account_id, amount_cents, cadence, notes, sort_order);

  const row = db.prepare(`
    SELECT tp.*, a.name as account_name
    FROM transfer_plans tp LEFT JOIN accounts a ON a.id = tp.to_account_id
    WHERE tp.id = ?
  `).get(lastInsertRowid);
  res.status(201).json({ ...row, monthly_cents: Math.round(row.amount_cents * (MONTHLY_FACTOR[row.cadence] ?? 1)) });
});

router.put('/:id', (req, res) => {
  const allowed = ['name', 'to_account_id', 'amount_cents', 'cadence', 'notes', 'sort_order'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

  const set = fields.map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE transfer_plans SET ${set} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.id);

  const row = db.prepare(`
    SELECT tp.*, a.name as account_name
    FROM transfer_plans tp LEFT JOIN accounts a ON a.id = tp.to_account_id
    WHERE tp.id = ?
  `).get(req.params.id);
  res.json({ ...row, monthly_cents: Math.round(row.amount_cents * (MONTHLY_FACTOR[row.cadence] ?? 1)) });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM transfer_plans WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
