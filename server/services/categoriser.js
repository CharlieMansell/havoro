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

// What a rule can match against. Banks differ in what they give us: NAB
// exports a merchant name and its own category, ANZ a payment reference,
// CommBank nothing but the statement line — so a rule says which field it
// applies to rather than every rule guessing at one blob of text.
const MATCH_FIELDS = ['description', 'merchant', 'bank_category'];

function fieldText(tx, field) {
  if (field === 'merchant') return tx.merchant || '';
  if (field === 'bank_category') return tx.bank_category || '';
  return tx.description || '';
}

// Takes the transaction, not a string: import and "apply rules" used to pass
// different text (raw description vs cleaned), so the same rule could match
// on one path and miss on the other. One argument, one behaviour.
function categorise(transaction) {
  const tx = typeof transaction === 'string' ? { description: transaction } : transaction;
  const rules = getRules();

  for (const rule of rules) {
    // A rule with no account applies everywhere; one scoped to an account
    // only fires on that account's transactions. Without this, a bank
    // category as generic as "PAYMENT" would catch other banks' rows too.
    if (rule.account_id != null && Number(rule.account_id) !== Number(tx.account_id)) continue;

    const description = fieldText(tx, rule.match_field);
    if (!description) continue;

    const lower = description.toLowerCase();
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

module.exports = { categorise, MATCH_FIELDS };
