const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/summary', (req, res) => {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const [year, mon] = month.split('-');
  const dateFrom = `${year}-${mon}-01`;
  const dateTo = `${year}-${mon}-31`;

  // Net worth: sum of all include_in_net_worth accounts
  const netWorthRow = db.prepare(`
    SELECT SUM(CASE WHEN type = 'liability' THEN -ABS(current_balance_cents) ELSE current_balance_cents END) as net_worth
    FROM accounts
    WHERE include_in_net_worth = 1 AND archived = 0
  `).get();

  // Per account-type breakdown
  const breakdown = db.prepare(`
    SELECT
      CASE type
        WHEN 'transaction' THEN 'cash'
        WHEN 'savings' THEN 'cash'
        WHEN 'offset' THEN 'cash'
        WHEN 'credit_card' THEN 'cash'
        WHEN 'super' THEN 'super'
        WHEN 'property' THEN 'property'
        WHEN 'share_portfolio' THEN 'shares'
        WHEN 'liability' THEN 'mortgage'
        ELSE 'other'
      END as asset_class,
      SUM(CASE WHEN type = 'liability' THEN -ABS(current_balance_cents) ELSE current_balance_cents END) as balance
    FROM accounts
    WHERE include_in_net_worth = 1 AND archived = 0
    GROUP BY asset_class
  `).all();

  // Last check-in net worth for delta
  const lastCheckin = db.prepare(`
    SELECT date as snapshot_date FROM check_ins ORDER BY date DESC LIMIT 1
  `).get();

  let netWorthDelta = null;
  if (lastCheckin) {
    const prevSnap = db.prepare(`
      SELECT SUM(CASE WHEN a.type = 'liability' THEN -ABS(s.balance_cents) ELSE s.balance_cents END) as nw
      FROM balance_snapshots s
      JOIN accounts a ON a.id = s.account_id
      WHERE s.snapshot_date = ? AND a.include_in_net_worth = 1
    `).get(lastCheckin.snapshot_date);
    if (prevSnap?.nw != null) {
      netWorthDelta = (netWorthRow.net_worth || 0) - prevSnap.nw;
    }
  }

  // This month income & expenses
  const income = db.prepare(`
    SELECT COALESCE(SUM(t.amount_cents), 0) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND c.kind = 'income' AND t.is_transfer = 0
  `).get(dateFrom, dateTo);

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(t.amount_cents), 0) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND c.kind = 'expense' AND t.is_transfer = 0
  `).get(dateFrom, dateTo);

  const incomeTotal = income.total || 0;
  const expensesTotal = Math.abs(expenses.total || 0);
  const savingsRate = incomeTotal > 0 ? ((incomeTotal - expensesTotal) / incomeTotal) * 100 : 0;

  // Top spending categories this month
  const topCategories = db.prepare(`
    SELECT c.name, c.color, c.id, ABS(SUM(t.amount_cents)) as total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.date >= ? AND t.date <= ? AND c.kind = 'expense' AND t.is_transfer = 0
    GROUP BY c.id
    ORDER BY total DESC
    LIMIT 6
  `).all(dateFrom, dateTo);

  // Needs review count
  const needsReview = db.prepare(
    'SELECT COUNT(*) as n FROM transactions WHERE category_id IS NULL AND is_transfer = 0'
  ).get();

  // Active goals
  const goals = db.prepare(
    'SELECT * FROM goals WHERE archived = 0 ORDER BY priority LIMIT 4'
  ).all();

  // Recent snapshots for mini net-worth history (last 6)
  const snapshots = db.prepare(`
    SELECT ci.date,
      SUM(CASE WHEN a.type = 'liability' THEN -ABS(s.balance_cents) ELSE s.balance_cents END) as net_worth
    FROM check_ins ci
    JOIN balance_snapshots s ON s.snapshot_date = ci.date
    JOIN accounts a ON a.id = s.account_id
    WHERE a.include_in_net_worth = 1
    GROUP BY ci.date
    ORDER BY ci.date ASC
  `).all();

  // Setup progress — drives the "Getting started" checklist on a fresh install
  const setup = {
    accounts:      db.prepare('SELECT COUNT(*) as n FROM accounts WHERE archived = 0').get().n,
    transactions:  db.prepare('SELECT COUNT(*) as n FROM transactions').get().n,
    budgets:       db.prepare('SELECT COUNT(*) as n FROM budgets').get().n,
    transfer_plans: db.prepare('SELECT COUNT(*) as n FROM transfer_plans').get().n,
  };

  res.json({
    net_worth_cents: netWorthRow.net_worth || 0,
    net_worth_delta_cents: netWorthDelta,
    asset_breakdown: breakdown,
    month_income_cents: incomeTotal,
    month_expenses_cents: expensesTotal,
    savings_rate: Math.round(savingsRate * 10) / 10,
    top_categories: topCategories,
    needs_review_count: needsReview.n,
    goals,
    net_worth_history: snapshots,
    setup,
  });
});

module.exports = router;
