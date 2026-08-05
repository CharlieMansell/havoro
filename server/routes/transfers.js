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

// GET /api/transfers/from-budget?month=YYYY-MM
// The transfers your budget implies: every expense budget tagged with a
// destination account, grouped by that account. Derived rather than stored,
// so changing a budget changes the transfer instead of leaving the planner
// holding a stale second copy of the same numbers.
router.get('/from-budget', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  const rows = db.prepare(`
    SELECT b.to_account_id, b.amount_cents, c.name as category_name, c.color as category_color,
           a.name as account_name
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    LEFT JOIN accounts a ON a.id = b.to_account_id
    WHERE b.start_month <= ? AND c.kind = 'expense'
    GROUP BY b.category_id
    HAVING b.start_month = MAX(b.start_month)
    ORDER BY b.amount_cents DESC
  `).all(month);

  const groups = new Map();
  let untagged = { to_account_id: null, account_name: null, monthly_cents: 0, items: [] };

  for (const r of rows) {
    // Budgets with no destination still matter — they're the ones you haven't
    // decided about yet, and hiding them would make the totals look complete.
    const group = r.to_account_id == null
      ? untagged
      : groups.get(r.to_account_id) ?? { to_account_id: r.to_account_id, account_name: r.account_name, monthly_cents: 0, items: [] };

    group.items.push({ category_name: r.category_name, category_color: r.category_color, amount_cents: r.amount_cents });
    group.monthly_cents += r.amount_cents;
    if (r.to_account_id != null) groups.set(r.to_account_id, group);
  }

  const tagged = [...groups.values()].sort((a, b) => b.monthly_cents - a.monthly_cents);

  res.json({
    month,
    groups: tagged,
    untagged: untagged.items.length ? untagged : null,
    total_monthly_cents: tagged.reduce((s, g) => s + g.monthly_cents, 0),
  });
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
