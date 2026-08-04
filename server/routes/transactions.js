const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { categorise } = require('../services/categoriser');

const router = express.Router();
router.use(requireAuth);

// Shared by the list and the ids-only endpoint below so the two can never
// drift: "select all matching these filters" in the UI has to mean exactly
// the set the list would have shown, or a bulk action hits the wrong rows.
function buildFilters(query) {
  const { account_id, category_id, needs_review, is_transfer, date_from, date_to, search, bank_category } = query;

  const where = [];
  const params = [];

  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }
  if (category_id) { where.push('t.category_id = ?'); params.push(category_id); }
  if (needs_review === 'true') { where.push('t.category_id IS NULL AND t.is_transfer = 0'); }
  if (is_transfer !== undefined) { where.push('t.is_transfer = ?'); params.push(is_transfer === 'true' ? 1 : 0); }
  if (date_from) { where.push('t.date >= ?'); params.push(date_from); }
  if (date_to) { where.push('t.date <= ?'); params.push(date_to); }
  if (bank_category) { where.push('t.bank_category = ?'); params.push(bank_category); }
  if (search) {
    where.push("(t.description LIKE ? OR t.description_clean LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  return { whereClause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// GET /api/transactions
router.get('/', (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const { whereClause, params } = buildFilters(req.query);
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

// GET /api/transactions/ids
// Every id matching the current filters, ignoring pagination — what "select
// all N" in the UI selects. The bulk endpoints take explicit ids rather than
// a filter, so the client needs the whole set, not just the page it can see.
router.get('/ids', (req, res) => {
  const { whereClause, params } = buildFilters(req.query);
  const rows = db.prepare(`SELECT t.id FROM transactions t ${whereClause}`).all(...params);
  res.json({ ids: rows.map(r => r.id) });
});

// GET /api/transactions/bank-categories
// The distinct categories the banks themselves assigned, for the filter on
// the transactions list. Only some banks export one, so this is empty until
// something that does has been imported — which is what the UI keys off.
router.get('/bank-categories', (req, res) => {
  const rows = db.prepare(
    'SELECT DISTINCT bank_category FROM transactions WHERE bank_category IS NOT NULL AND bank_category != \'\' ORDER BY bank_category'
  ).all();
  res.json(rows.map(r => r.bank_category));
});

// GET /api/transactions/needs-review/count
router.get('/needs-review/count', (req, res) => {
  const { n } = db.prepare(
    'SELECT COUNT(*) as n FROM transactions WHERE category_id IS NULL AND is_transfer = 0'
  ).get();
  res.json({ count: n });
});

// POST /api/transactions/bulk-categorize
// Applies one category_id (or is_transfer flag) to a batch of transaction ids at once.
router.post('/bulk-categorize', (req, res) => {
  const { ids, category_id, is_transfer, budget_month } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (category_id === undefined && is_transfer === undefined && budget_month === undefined) {
    return res.status(400).json({ error: 'category_id, is_transfer or budget_month required' });
  }
  if (budget_month !== undefined && budget_month !== null && budget_month !== '' && !/^\d{4}-\d{2}$/.test(budget_month)) {
    return res.status(400).json({ error: 'budget_month must be YYYY-MM' });
  }

  const fields = [];
  const values = [];
  if (category_id !== undefined) { fields.push('category_id = ?'); values.push(category_id || null); }
  if (is_transfer !== undefined) { fields.push('is_transfer = ?'); values.push(is_transfer ? 1 : 0); }
  // '' clears the override, putting the rows back on their own date's month.
  if (budget_month !== undefined) { fields.push('budget_month = ?'); values.push(budget_month || null); }

  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id IN (${placeholders})`);
  const result = stmt.run(...values, ...ids);

  res.json({ updated: result.changes });
});

// POST /api/transactions/bulk-delete
// Deletes a batch of transaction ids in one request. Same shape as
// bulk-categorize above, and the same reasoning as DELETE /:id below for why
// removing rows outright is safe.
router.post('/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  // Chunked because SQLite caps how many parameters one statement can bind
  // (SQLITE_MAX_VARIABLE_NUMBER), which a big selection would otherwise blow
  // past. The whole thing is one db.transaction, so a failure part-way
  // through rolls every chunk back rather than leaving half a selection gone.
  const CHUNK_SIZE = 500;
  let deleted = 0;
  const deleteAll = db.transaction((allIds) => {
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
      const chunk = allIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      deleted += db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...chunk).changes;
    }
  });
  deleteAll(ids);

  res.json({ deleted });
});

// POST /api/transactions/apply-rules
// Re-runs categorisation rules against transactions that don't have a
// category yet — covers the case where a rule is created or edited after
// the matching transactions were already imported, since rules otherwise
// only ever run once, at import time (see services/categoriser.js).
// Only ever touches uncategorised rows, so it can never clobber a category
// someone picked by hand.
router.post('/apply-rules', (req, res) => {
  const rows = db.prepare(
    'SELECT id, account_id, description, merchant, bank_category FROM transactions WHERE category_id IS NULL AND is_transfer = 0'
  ).all();

  const update = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  let updated = 0;
  const applyAll = db.transaction((txs) => {
    for (const tx of txs) {
      const categoryId = categorise(tx);
      if (categoryId) { update.run(categoryId, tx.id); updated++; }
    }
  });
  applyAll(rows);

  res.json({ checked: rows.length, updated });
});

// PUT /api/transactions/:id
router.put('/:id', (req, res) => {
  const allowed = ['category_id','notes','description_clean','is_transfer','budget_month'];
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

// DELETE /api/transactions/:id
// A real delete, not an archive flag: account balances are tracked on the
// account itself (check-ins / manual entry), never summed from transactions,
// and nothing else references a transaction row, so there's nothing left
// dangling. Dropping the row also frees its import_hash, which means
// re-importing the same statement brings the transaction back rather than
// skipping it as a duplicate — the way out if someone deletes one by mistake.
router.delete('/:id', (req, res) => {
  const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/transactions/:id/suggest-rule
// After manually categorising, suggest creating a rule
router.post('/:id/suggest-rule', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx || !tx.category_id) return res.status(400).json({ error: 'Transaction has no category' });

  // Prefer the bank's own fields when it gave us one: a rule on "Woolworths"
  // matches the merchant column exactly but would miss the raw statement
  // line it came from ("WW 1234 MELBOURNE"), so the field the pattern is
  // taken from has to be the field the rule matches against.
  let match_field = 'description';
  let source = tx.description;
  if (tx.bank_category) { match_field = 'bank_category'; source = tx.bank_category; }
  else if (tx.merchant) { match_field = 'merchant'; source = tx.merchant; }

  const desc = source.toLowerCase().trim();
  // A whole bank category is one value, not a phrase to trim down.
  const pattern = match_field === 'bank_category' ? desc : desc.split(/\s+/).slice(0, 3).join(' ');

  res.json({
    suggested: {
      match_type: 'contains',
      match_field,
      pattern,
      category_id: tx.category_id,
      priority: 50,
    }
  });
});

module.exports = router;
