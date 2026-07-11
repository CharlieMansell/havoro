const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/transactions
router.get('/', (req, res) => {
  const {
    account_id, category_id, needs_review, is_transfer,
    date_from, date_to, search, page = 1, limit = 50,
  } = req.query;

  const where = [];
  const params = [];

  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }
  if (category_id) { where.push('t.category_id = ?'); params.push(category_id); }
  if (needs_review === 'true') { where.push('t.category_id IS NULL AND t.is_transfer = 0'); }
  if (is_transfer !== undefined) { where.push('t.is_transfer = ?'); params.push(is_transfer === 'true' ? 1 : 0); }
  if (date_from) { where.push('t.date >= ?'); params.push(date_from); }
  if (date_to) { where.push('t.date <= ?'); params.push(date_to); }
  if (search) {
    where.push("(t.description LIKE ? OR t.description_clean LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (Number(page) - 1) * Number(limit);

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM transactions t ${whereClause}
  `).get(...params);

  const rows = db.prepare(`
    SELECT t.*,
      a.name as account_name,
      c.name as category_name, c.color as category_color, c.kind as category_kind
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ${whereClause}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  res.json({ total: total.n, page: Number(page), limit: Number(limit), rows });
});

// GET /api/transactions/needs-review/count
router.get('/needs-review/count', (req, res) => {
  const { n } = db.prepare(
    'SELECT COUNT(*) as n FROM transactions WHERE category_id IS NULL AND is_transfer = 0'
  ).get();
  res.json({ count: n });
});

// PUT /api/transactions/:id
router.put('/:id', (req, res) => {
  const allowed = ['category_id','notes','description_clean','is_transfer'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

  const set = fields.map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE transactions SET ${set} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.id);

  const tx = db.prepare(`
    SELECT t.*, a.name as account_name,
      c.name as category_name, c.color as category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.id = ?
  `).get(req.params.id);

  res.json(tx);
});

// POST /api/transactions/:id/suggest-rule
// After manually categorising, suggest creating a rule
router.post('/:id/suggest-rule', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx || !tx.category_id) return res.status(400).json({ error: 'Transaction has no category' });

  const desc = (tx.description_clean || tx.description).toLowerCase().trim();
  // suggest a 'contains' rule based on first meaningful word cluster
  const words = desc.split(/\s+/).slice(0, 3).join(' ');

  res.json({
    suggested: {
      match_type: 'contains',
      pattern: words,
      category_id: tx.category_id,
      priority: 50,
    }
  });
});

module.exports = router;
