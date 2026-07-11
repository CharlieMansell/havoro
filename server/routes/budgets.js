const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, c.name as category_name, c.color as category_color, c.parent_id
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    ORDER BY b.start_month DESC, c.name
  `).all();
  res.json(rows);
});

// GET /api/budgets/summary?month=YYYY-MM
router.get('/summary', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const [year, mon] = month.split('-');
  const dateFrom = `${year}-${mon}-01`;
  const dateTo = `${year}-${mon}-31`;

  // Get budgets applicable for this month
  const budgets = db.prepare(`
    SELECT b.*, c.name as category_name, c.color as category_color, c.kind
    FROM budgets b
    JOIN categories c ON c.id = b.category_id
    WHERE b.start_month <= ?
    GROUP BY b.category_id
    HAVING b.start_month = MAX(b.start_month)
    ORDER BY c.name
  `).all(month);

  // Actual spend per category this month (expenses only, excluding transfers)
  const actuals = db.prepare(`
    SELECT category_id, SUM(amount_cents) as total
    FROM transactions
    WHERE date >= ? AND date <= ? AND is_transfer = 0
    GROUP BY category_id
  `).all(dateFrom, dateTo);

  const actualMap = {};
  actuals.forEach(a => { actualMap[a.category_id] = a.total; });

  // Total income this month
  const income = db.prepare(`
    SELECT SUM(t.amount_cents) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND c.kind = 'income' AND t.is_transfer = 0
  `).get(dateFrom, dateTo);

  // Total spend (expenses) this month
  const spend = db.prepare(`
    SELECT SUM(t.amount_cents) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND c.kind = 'expense' AND t.is_transfer = 0
  `).get(dateFrom, dateTo);

  // Uncategorised spend (excluding transfers)
  const uncategorised = db.prepare(`
    SELECT SUM(amount_cents) as total
    FROM transactions
    WHERE date >= ? AND date <= ? AND category_id IS NULL AND is_transfer = 0 AND amount_cents < 0
  `).get(dateFrom, dateTo);

  const budgetRows = budgets.map(b => ({
    ...b,
    spent_cents: -(actualMap[b.category_id] || 0), // expenses are negative; flip sign for display
    remaining_cents: b.amount_cents - (-(actualMap[b.category_id] || 0)),
  }));

  const totalBudgeted = budgetRows.reduce((s, b) => s + b.amount_cents, 0);
  const totalSpent = budgetRows.reduce((s, b) => s + b.spent_cents, 0);

  res.json({
    month,
    budgets: budgetRows,
    summary: {
      total_income_cents: income.total || 0,
      total_spend_cents: -(spend.total || 0),
      total_budgeted_cents: totalBudgeted,
      total_spent_cents: totalSpent,
      uncategorised_spend_cents: -(uncategorised.total || 0),
      safe_to_spend_cents: (income.total || 0) + (spend.total || 0) - totalBudgeted,
    }
  });
});

router.post('/', (req, res) => {
  const { category_id, amount_cents, rollover = 0, start_month } = req.body;
  if (!category_id || amount_cents === undefined) {
    return res.status(400).json({ error: 'category_id and amount_cents required' });
  }
  const month = start_month || new Date().toISOString().slice(0, 7);
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO budgets (category_id, amount_cents, rollover, start_month) VALUES (?, ?, ?, ?)'
  ).run(category_id, amount_cents, rollover ? 1 : 0, month);

  res.status(201).json(db.prepare('SELECT * FROM budgets WHERE id = ?').get(lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const allowed = ['amount_cents','rollover','start_month'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

  const set = fields.map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE budgets SET ${set} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.id);
  res.json(db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM budgets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
