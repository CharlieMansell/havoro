const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_PATTERN_LENGTH = 100;
// Rejects the classic catastrophic-backtracking shapes: nested quantifiers
// like (a+)+, (a*)*, (a+)*, (a*)+, and quantified alternation like (a|a)+,
// (a|ab)* — cheap defense against a ReDoS rule hanging the server's single
// event loop on every future CSV import.
const DANGEROUS_REGEX_SHAPE = /\([^()]*[+*][^()]*\)[+*]|\([^()]*\|[^()]*\)[+*]/;

function validatePattern(match_type, pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return 'pattern is required';
  if (pattern.length > MAX_PATTERN_LENGTH) return `pattern must be ${MAX_PATTERN_LENGTH} characters or fewer`;
  if (match_type === 'regex') {
    if (DANGEROUS_REGEX_SHAPE.test(pattern)) return 'pattern contains a nested quantifier that could hang on some inputs (e.g. (a+)+) — simplify it';
    try { new RegExp(pattern); } catch { return 'pattern is not a valid regular expression'; }
  }
  return null;
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, c.name as category_name, c.color as category_color
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    ORDER BY r.priority, r.id
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { match_type, pattern, category_id, priority = 100, active = 1 } = req.body;
  if (!match_type || !pattern || !category_id) {
    return res.status(400).json({ error: 'match_type, pattern and category_id required' });
  }
  const patternError = validatePattern(match_type, pattern);
  if (patternError) return res.status(400).json({ error: patternError });

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO category_rules (match_type, pattern, category_id, priority, active) VALUES (?, ?, ?, ?, ?)'
  ).run(match_type, pattern, category_id, priority, active ? 1 : 0);

  res.status(201).json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT match_type, pattern FROM category_rules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const allowed = ['match_type','pattern','category_id','priority','active'];
  const fields = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

  if (fields.includes('match_type') || fields.includes('pattern')) {
    const nextMatchType = req.body.match_type ?? existing.match_type;
    const nextPattern = req.body.pattern ?? existing.pattern;
    const patternError = validatePattern(nextMatchType, nextPattern);
    if (patternError) return res.status(400).json({ error: patternError });
  }

  const set = fields.map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE category_rules SET ${set} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.id);
  res.json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
