const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { refreshHoldingPrices } = require('../services/priceService');

const router = express.Router();
router.use(requireAuth);

// POST /api/holdings/refresh-prices?portfolio_id=X  — force-refresh live prices
router.post('/refresh-prices', async (req, res) => {
  const { portfolio_id } = req.query;
  if (!portfolio_id) return res.status(400).json({ error: 'portfolio_id required' });
  const rawHoldings = db.prepare(
    'SELECT * FROM holdings WHERE portfolio_account_id = ? ORDER BY ticker'
  ).all(Number(portfolio_id));
  try {
    const holdings = await refreshHoldingPrices(rawHoldings, { force: true });

    // Sync computed portfolio value back to the account balance
    const portfolioValue = holdings.reduce(
      (sum, h) => sum + Math.round((h.units ?? 0) * (h.current_price_cents ?? 0)), 0
    );
    db.prepare('UPDATE accounts SET current_balance_cents = ? WHERE id = ?')
      .run(portfolioValue, Number(portfolio_id));

    const anyError = holdings.some(h => h.price_error);
    res.json({ holdings, portfolio_value_cents: portfolioValue, any_error: anyError });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/holdings?portfolio_id=X
router.get('/', (req, res) => {
  const { portfolio_id } = req.query;
  if (!portfolio_id) return res.status(400).json({ error: 'portfolio_id required' });
  const rows = db.prepare(
    'SELECT * FROM holdings WHERE portfolio_account_id = ? ORDER BY ticker'
  ).all(Number(portfolio_id));
  res.json(rows);
});

// POST /api/holdings
router.post('/', (req, res) => {
  const { portfolio_account_id, ticker, exchange, yahoo_symbol, units, avg_cost_cents, current_price_cents } = req.body;
  if (!portfolio_account_id || !ticker) {
    return res.status(400).json({ error: 'portfolio_account_id and ticker are required' });
  }
  const priceCents = current_price_cents != null ? Number(current_price_cents) : 0;
  const priceUpdatedAt = priceCents > 0 ? new Date().toISOString() : null;
  const result = db.prepare(
    `INSERT INTO holdings (portfolio_account_id, ticker, exchange, yahoo_symbol, units, avg_cost_cents, current_price_cents, price_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    portfolio_account_id,
    ticker.trim().toUpperCase(),
    exchange || 'ASX',
    yahoo_symbol || null,
    Number(units) || 0,
    Number(avg_cost_cents) || 0,
    priceCents,
    priceUpdatedAt
  );
  const row = db.prepare('SELECT * FROM holdings WHERE id = ?').get(result.lastInsertRowid);
  res.json(row);
});

// PUT /api/holdings/:id
router.put('/:id', (req, res) => {
  const { ticker, exchange, yahoo_symbol, units, avg_cost_cents, current_price_cents } = req.body;
  const existing = db.prepare('SELECT portfolio_account_id, current_price_cents, price_updated_at FROM holdings WHERE id = ?').get(req.params.id);
  const priceChanged = current_price_cents != null && Number(current_price_cents) !== existing?.current_price_cents;
  db.prepare(
    `UPDATE holdings SET ticker = ?, exchange = ?, yahoo_symbol = ?, units = ?, avg_cost_cents = ?,
     current_price_cents = ?, price_updated_at = ? WHERE id = ?`
  ).run(
    ticker?.trim().toUpperCase(),
    exchange,
    yahoo_symbol || null,
    Number(units) || 0,
    Number(avg_cost_cents) || 0,
    current_price_cents != null ? Number(current_price_cents) : existing?.current_price_cents,
    priceChanged ? new Date().toISOString() : existing?.price_updated_at,
    req.params.id
  );

  // Recalculate portfolio balance when units or price change
  if (existing?.portfolio_account_id) {
    const { total } = db.prepare(
      'SELECT COALESCE(SUM(CAST(units AS REAL) * current_price_cents), 0) AS total FROM holdings WHERE portfolio_account_id = ?'
    ).get(existing.portfolio_account_id);
    db.prepare('UPDATE accounts SET current_balance_cents = ? WHERE id = ?')
      .run(Math.round(total), existing.portfolio_account_id);
  }

  res.json({ ok: true });
});

// DELETE /api/holdings/:id
router.delete('/:id', (req, res) => {
  const holding = db.prepare('SELECT portfolio_account_id FROM holdings WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM trades WHERE holding_id = ?').run(req.params.id);
  db.prepare('DELETE FROM price_history WHERE holding_id = ?').run(req.params.id);
  db.prepare('DELETE FROM holdings WHERE id = ?').run(req.params.id);

  // Recalculate and sync portfolio balance after removal
  if (holding) {
    const { total } = db.prepare(
      'SELECT COALESCE(SUM(CAST(units AS REAL) * current_price_cents), 0) AS total FROM holdings WHERE portfolio_account_id = ?'
    ).get(holding.portfolio_account_id);
    db.prepare('UPDATE accounts SET current_balance_cents = ? WHERE id = ?')
      .run(Math.round(total), holding.portfolio_account_id);
  }

  res.json({ ok: true });
});

module.exports = router;
