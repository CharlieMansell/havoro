const express = require('express');
const safeRegex = require('safe-regex');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { MATCH_FIELDS } = require('../services/categoriser');

const router = express.Router();
router.use(requireAuth);

const MAX_PATTERN_LENGTH = 100;
// safe-regex only rejects star-height > 1 (e.g. (a+)+) and has known
// false negatives on quantified alternation — (a|a)+, (a|ab)* pass it but
// can still backtrack badly, so that shape is caught separately.
const DANGEROUS_ALTERNATION_SHAPE = /\([^()]*\|[^()]*\)[+*]/;

// '' from an unset <select> means "every account", same as omitting it.
function normaliseAccountId(value) {
  if (value === '' || value === null || value === undefined) return null;
  return Number(value);
}

function accountError(accountId) {
  if (accountId === null) return null;
  if (!Number.isInteger(accountId)) return 'account_id must be an account id or null';
  const exists = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
  return exists ? null : 'account_id does not match an account';
}

function validatePattern(match_type, pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return 'pattern is required';
  if (pattern.length > MAX_PATTERN_LENGTH) return `pattern must be ${MAX_PATTERN_LENGTH} characters or fewer`;
  if (match_type === 'regex') {
    // Cheap defense against a ReDoS rule hanging the server's single event
    // loop on every future CSV import. Kept as separate guard clauses
    // (rather than combined with ||) so each is its own simple barrier.
    if (!safeRegex(pattern)) return 'pattern is too complex and could hang on some inputs (e.g. nested repetition like (a+)+) — simplify it';
    if (DANGEROUS_ALTERNATION_SHAPE.test(pattern)) return 'pattern contains alternation that could hang on some inputs (e.g. (a|a)+) — simplify it';
    try { new RegExp(pattern); } catch { return 'pattern is not a valid regular expression'; }
  }
  return null;
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, c.name as category_name, c.color as category_color,
           a.name as account_name
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    LEFT JOIN accounts a ON a.id = r.account_id
    ORDER BY r.priority, r.id
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { match_type, pattern, category_id, priority = 100, active = 1, match_field = 'description' } = req.body;
  const account_id = normaliseAccountId(req.body.account_id);
  if (!match_type || !pattern || !category_id) {
    return res.status(400).json({ error: 'match_type, pattern and category_id required' });
  }
  if (!MATCH_FIELDS.includes(match_field)) {
    return res.status(400).json({ error: `match_field must be one of: ${MATCH_FIELDS.join(', ')}` });
  }
  const patternError = validatePattern(match_type, pattern);
  if (patternError) return res.status(400).json({ error: patternError });
  const accountIdError = accountError(account_id);
  if (accountIdError) return res.status(400).json({ error: accountIdError });

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO category_rules (match_type, pattern, category_id, priority, active, match_field, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(match_type, pattern, category_id, priority, active ? 1 : 0, match_field, account_id);

  res.status(201).json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT match_type, pattern FROM category_rules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const allowed = ['match_type','pattern','category_id','priority','active','match_field','account_id'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

  if (fields.includes('match_field') && !MATCH_FIELDS.includes(req.body.match_field)) {
    return res.status(400).json({ error: `match_field must be one of: ${MATCH_FIELDS.join(', ')}` });
  }

  if (fields.includes('match_type') || fields.includes('pattern')) {
    const nextMatchType = req.body.match_type ?? existing.match_type;
    const nextPattern = req.body.pattern ?? existing.pattern;
    const patternError = validatePattern(nextMatchType, nextPattern);
    if (patternError) return res.status(400).json({ error: patternError });
  }

  if (fields.includes('account_id')) {
    const accountIdError = accountError(normaliseAccountId(req.body.account_id));
    if (accountIdError) return res.status(400).json({ error: accountIdError });
  }

  const value = f => (f === 'account_id' ? normaliseAccountId(req.body[f]) : req.body[f]);
  const set = fields.map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE category_rules SET ${set} WHERE id = ?`).run(...fields.map(value), req.params.id);
  res.json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
