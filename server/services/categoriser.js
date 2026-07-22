const safeRegex = require('safe-regex');
const db = require('../db/db');

// Same shape rejected at rule-creation time (routes/rules.js) — kept here
// too so a rule inserted any other way can't hang the event loop. safe-regex
// only catches star-height > 1; quantified alternation needs this as well.
const DANGEROUS_ALTERNATION_SHAPE = /\([^()]*\|[^()]*\)[+*]/;
// Bounds worst-case backtracking time on any pattern that still slips past
// the checks above — matching happens against every imported transaction
// description, so this caps the input rather than the pattern.
const MAX_DESCRIPTION_LENGTH = 500;

function getRules() {
  return db.prepare(
    'SELECT * FROM category_rules WHERE active = 1 ORDER BY priority ASC, id ASC'
  ).all();
}

function categorise(description) {
  const rules = getRules();
  const lower = description.toLowerCase();
  for (const rule of rules) {
    const pat = rule.pattern.toLowerCase();
    let match = false;
    if (rule.match_type === 'contains') {
      match = lower.includes(pat);
    } else if (rule.match_type === 'startswith') {
      match = lower.startsWith(pat);
    } else if (rule.match_type === 'regex') {
      const tooComplex = rule.pattern.length > 100 || !safeRegex(rule.pattern) || DANGEROUS_ALTERNATION_SHAPE.test(rule.pattern);
      if (tooComplex) {
        match = false;
      } else {
        try { match = new RegExp(rule.pattern, 'i').test(description.slice(0, MAX_DESCRIPTION_LENGTH)); }
        catch { match = false; }
      }
    }
    if (match) return rule.category_id;
  }
  return null;
}

module.exports = { categorise };
