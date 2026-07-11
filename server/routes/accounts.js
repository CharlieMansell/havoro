const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*,
      loan.name as loan_name,
      loan.current_balance_cents as loan_balance_cents,
      h.portfolio_cost_cents
    FROM accounts a
    LEFT JOIN accounts loan ON loan.id = a.linked_loan_account_id
    LEFT JOIN (
      SELECT portfolio_account_id,
        SUM(CAST(units AS REAL) * avg_cost_cents) AS portfolio_cost_cents
      FROM holdings GROUP BY portfolio_account_id
    ) h ON h.portfolio_account_id = a.id
    WHERE a.archived = 0
    ORDER BY a.type, a.name
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const {
    name, type, institution, is_manual_balance = 0,
    current_balance_cents = 0, include_in_net_worth = 1,
    linked_loan_account_id, address, domain_property_id, lvr_ceiling = 0.80,
  } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO accounts (name, type, institution, is_manual_balance, current_balance_cents,
      include_in_net_worth, linked_loan_account_id, address, domain_property_id, lvr_ceiling)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, type, institution || null, is_manual_balance ? 1 : 0, current_balance_cents,
    include_in_net_worth ? 1 : 0, linked_loan_account_id || null, address || null,
    domain_property_id || null, lvr_ceiling);

  res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const allowed = [
    'name','type','institution','is_manual_balance','current_balance_cents',
    'include_in_net_worth','linked_loan_account_id','address','domain_property_id',
    'lvr_ceiling','archived',
  ];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' });

  const set = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => req.body[f]);
  db.prepare(`UPDATE accounts SET ${set} WHERE id = ?`).run(...vals, req.params.id);

  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id));
});

// PATCH balance only (quick update for manual accounts)
router.patch('/:id/balance', (req, res) => {
  const { balance_cents } = req.body;
  if (balance_cents === undefined) return res.status(400).json({ error: 'balance_cents required' });
  db.prepare('UPDATE accounts SET current_balance_cents = ? WHERE id = ?').run(balance_cents, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE accounts SET archived = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
