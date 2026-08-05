const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { BUDGET_MONTH_SQL } = require('../services/budgetMonth');

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
  // Actuals are scoped by the month a transaction counts toward rather than
  // its raw date, so a salary paid on the 31st lands in the month it funds.

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
    FROM transactions t
    WHERE ${BUDGET_MONTH_SQL} = ? AND is_transfer = 0
    GROUP BY category_id
  `).all(month);

  const actualMap = {};
  actuals.forEach(a => { actualMap[a.category_id] = a.total; });

  // Total income this month
  const income = db.prepare(`
    SELECT SUM(t.amount_cents) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${BUDGET_MONTH_SQL} = ? AND c.kind = 'income' AND t.is_transfer = 0
  `).get(month);

  // Total spend (expenses) this month
  const spend = db.prepare(`
    SELECT SUM(t.amount_cents) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${BUDGET_MONTH_SQL} = ? AND c.kind = 'expense' AND t.is_transfer = 0
  `).get(month);

  // Uncategorised spend (excluding transfers)
  const uncategorised = db.prepare(`
    SELECT SUM(amount_cents) as total
    FROM transactions t
    WHERE ${BUDGET_MONTH_SQL} = ? AND category_id IS NULL AND is_transfer = 0 AND amount_cents < 0
  `).get(month);

  // Income budgets are an expectation, not a commitment — a $8,000 salary
  // target is money coming in, and folding it into the spending maths below
  // would have it eating the very budget it funds. Kept apart throughout.
  const allBudgetRows = budgets.map(b => ({
    ...b,
    spent_cents: -(actualMap[b.category_id] || 0), // expenses are negative; flip sign for display
    remaining_cents: b.amount_cents - (-(actualMap[b.category_id] || 0)),
  }));

  const budgetRows = allBudgetRows.filter(b => b.kind !== 'income');

  // Income rows read the other way round: received against expected, and
  // beating the target is good rather than an overspend.
  const incomeBudgetRows = allBudgetRows
    .filter(b => b.kind === 'income')
    .map(b => ({
      ...b,
      received_cents: actualMap[b.category_id] || 0,
      expected_cents: b.amount_cents,
      remaining_cents: b.amount_cents - (actualMap[b.category_id] || 0),
    }));

  const totalBudgeted = budgetRows.reduce((s, b) => s + b.amount_cents, 0);
  const totalSpent = budgetRows.reduce((s, b) => s + b.spent_cents, 0);
  const totalIncomeBudgeted = incomeBudgetRows.reduce((s, b) => s + b.expected_cents, 0);
  const totalIncomeReceived = incomeBudgetRows.reduce((s, b) => s + b.received_cents, 0);

  const totalSpend = -(spend.total || 0);
  const uncategorisedSpend = -(uncategorised.total || 0);

  // Where the unbudgeted money actually went, so the figure is a list you can
  // act on — budget the category, or go and recategorise what's in it —
  // rather than a total with no way in. Uncategorised is its own line at the
  // end, since it needs recategorising rather than a budget.
  const budgetedIds = new Set(allBudgetRows.map(b => b.category_id));
  const unbudgeted = db.prepare(`
    SELECT c.id as category_id, c.name as category_name, c.color as category_color,
           SUM(t.amount_cents) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${BUDGET_MONTH_SQL} = ? AND c.kind = 'expense' AND t.is_transfer = 0
    GROUP BY c.id
    ORDER BY total ASC
  `).all(month)
    .filter(r => !budgetedIds.has(r.category_id))
    .map(r => ({ ...r, spent_cents: -r.total, total: undefined }));

  // The same question on the income side: money arriving that no expected
  // figure accounts for — a bonus, a refund, or something in the wrong
  // category entirely.
  const unbudgetedIncome = db.prepare(`
    SELECT c.id as category_id, c.name as category_name, c.color as category_color,
           SUM(t.amount_cents) as received_cents
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${BUDGET_MONTH_SQL} = ? AND c.kind = 'income' AND t.is_transfer = 0
    GROUP BY c.id
    ORDER BY received_cents DESC
  `).all(month).filter(r => !budgetedIds.has(r.category_id));

  if (uncategorisedSpend > 0) {
    unbudgeted.push({
      category_id: null,
      category_name: 'Uncategorised',
      category_color: null,
      spent_cents: uncategorisedSpend,
    });
  }

  // What a budgeted category still commits you to. Money already spent inside
  // one is what the budget was *for*, so counting both the spend and the whole
  // budget charges it twice — a paid mortgage would eat its own budget again.
  // Whichever is larger is the honest figure: below budget, the rest is still
  // expected to go out; over budget, the real spend is the commitment.
  const committedToBudgets = budgetRows.reduce(
    (s, b) => s + Math.max(b.amount_cents, b.spent_cents), 0
  );

  // Spending no budget accounted for, which nothing above has charged yet.
  // Clamped because a budget set against an income category would otherwise
  // make this negative and inflate what's left.
  const unbudgetedSpend = Math.max(0, totalSpend - totalSpent) + uncategorisedSpend;

  // What the month looks like once the pay you're still owed arrives. Safe to
  // spend counts money actually in, which on the 5th charges a whole month of
  // commitments against a fraction of the income meant to cover them — true,
  // but not the number you plan with.
  //
  // Per category, whichever is larger: still short of expected, the rest is
  // still coming; already past it, the extra is real. Income no expectation
  // accounted for is added as-is, since it has already arrived.
  const projectedIncome =
    incomeBudgetRows.reduce((s, b) => s + Math.max(b.expected_cents, b.received_cents), 0) +
    unbudgetedIncome.reduce((s, r) => s + r.received_cents, 0);

  res.json({
    month,
    budgets: budgetRows,
    income_budgets: incomeBudgetRows,
    unbudgeted,
    unbudgeted_income: unbudgetedIncome,
    summary: {
      total_income_cents: income.total || 0,
      total_spend_cents: totalSpend,
      total_budgeted_cents: totalBudgeted,
      total_spent_cents: totalSpent,
      uncategorised_spend_cents: uncategorisedSpend,
      unbudgeted_spend_cents: unbudgetedSpend,
      total_income_budgeted_cents: totalIncomeBudgeted,
      total_income_received_cents: totalIncomeReceived,
      unbudgeted_income_cents: unbudgetedIncome.reduce((s, r) => s + r.received_cents, 0),
      safe_to_spend_cents: (income.total || 0) - committedToBudgets - unbudgetedSpend,
      projected_income_cents: projectedIncome,
      projected_safe_to_spend_cents: projectedIncome - committedToBudgets - unbudgetedSpend,
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
