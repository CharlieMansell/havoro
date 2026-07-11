const db = require('../db/db');

// Same shape rejected at rule-creation time (routes/rules.js) — kept here too
// so a rule inserted any other way can't hang the event loop during import.
const DANGEROUS_REGEX_SHAPE = /\([^()]*[+*][^()]*\)[+*]/;

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
      if (rule.pattern.length > 100 || DANGEROUS_REGEX_SHAPE.test(rule.pattern)) { match = false; }
      else { try { match = new RegExp(rule.pattern, 'i').test(description); } catch { match = false; } }
    }
    if (match) return rule.category_id;
  }
  return null;
}

module.exports = { categorise };
