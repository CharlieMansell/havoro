const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { refreshHoldingPrices } = require('../services/priceService');

const router = express.Router();
router.use(requireAuth);

// GET /api/checkin/prefill — all net-worth accounts, live prices for share portfolios
router.get('/prefill', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todayCheckin = db.prepare('SELECT id FROM check_ins WHERE date = ?').get(today);

    const accounts = db.prepare(`
      SELECT id, name, type, institution, current_balance_cents
      FROM accounts WHERE include_in_net_worth = 1 AND archived = 0 ORDER BY type, name
    `).all();

    const result = await Promise.all(accounts.map(async (acc) => {
      if (acc.type !== 'share_portfolio') return acc;

      const rawHoldings = db.prepare(`
        SELECT id, ticker, exchange, yahoo_symbol, units, avg_cost_cents,
               current_price_cents, price_updated_at
        FROM holdings WHERE portfolio_account_id = ? ORDER BY ticker
      `).all(acc.id);

      const holdings = await refreshHoldingPrices(rawHoldings);
      const computed_balance_cents = holdings.reduce(
        (sum, h) => sum + Math.round((h.units ?? 0) * (h.current_price_cents ?? 0)), 0
      );

      // Keep account balance in sync so Assets / Net Worth pages reflect current value
      if (computed_balance_cents > 0) {
        db.prepare('UPDATE accounts SET current_balance_cents = ? WHERE id = ?')
          .run(computed_balance_cents, acc.id);
      }

      return { ...acc, holdings, computed_balance_cents };
    }));

    res.json({ accounts: result, today_checkin_exists: !!todayCheckin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/checkin — record check-in with optional per-account balance overrides
router.post('/', (req, res) => {
  const { notes, balances } = req.body;
  const today = new Date().toISOString().slice(0, 10);

  const existing = db.prepare('SELECT id FROM check_ins WHERE date = ?').get(today);
  if (existing) return res.status(400).json({ error: 'Check-in already done today' });

  const accounts = db.prepare(
    'SELECT id, current_balance_cents, type FROM accounts WHERE include_in_net_worth = 1 AND archived = 0'
  ).all();

  const doCheckin = db.transaction(() => {
    const ci = db.prepare('INSERT INTO check_ins (date, notes) VALUES (?, ?)').run(today, notes || null);
    const snap = db.prepare(
      'INSERT INTO balance_snapshots (snapshot_date, account_id, balance_cents) VALUES (?, ?, ?)'
    );
    for (const acc of accounts) {
      const balance = balances?.[acc.id] != null ? Number(balances[acc.id]) : acc.current_balance_cents;
      snap.run(today, acc.id, balance);
      if (balances?.[acc.id] != null) {
        db.prepare('UPDATE accounts SET current_balance_cents = ? WHERE id = ?').run(balance, acc.id);
      }
    }
    return ci.lastInsertRowid;
  });

  const id = doCheckin();

  const nw = accounts.reduce((s, acc) => {
    const balance = balances?.[acc.id] != null ? Number(balances[acc.id]) : acc.current_balance_cents;
    return s + (acc.type === 'liability' ? -Math.abs(balance) : balance);
  }, 0);

  res.json({ id, date: today, net_worth_cents: nw });
});

// GET /api/checkin/history
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT ci.*,
      SUM(CASE WHEN a.type = 'liability' THEN -ABS(s.balance_cents) ELSE s.balance_cents END) as net_worth_cents
    FROM check_ins ci
    JOIN balance_snapshots s ON s.snapshot_date = ci.date
    JOIN accounts a ON a.id = s.account_id AND a.include_in_net_worth = 1
    GROUP BY ci.id
    ORDER BY ci.date DESC
    LIMIT 24
  `).all();
  res.json(rows);
});

module.exports = router;
