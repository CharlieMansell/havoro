const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const db = require('../db/db');
const { categorise } = require('./categoriser');

function parseAmount(value) {
  if (!value && value !== 0) return null;
  const str = String(value).trim().replace(/[$,\s]/g, '');
  if (!str || str === '-') return null;
  // handle (1234.56) as negative
  const neg = str.startsWith('(') && str.endsWith(')');
  const num = parseFloat(neg ? str.slice(1, -1) : str);
  return isNaN(num) ? null : (neg ? -num : num);
}

function parseDate(value, format) {
  const str = String(value).trim();
  if (!str) return null;
  // supported formats: DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY, D/M/YYYY
  let d, m, y;
  if (format === 'DD/MM/YYYY' || format === 'D/M/YYYY') {
    [d, m, y] = str.split('/');
  } else if (format === 'MM/DD/YYYY') {
    [m, d, y] = str.split('/');
  } else if (format === 'YYYY-MM-DD') {
    [y, m, d] = str.split('-');
  } else {
    // attempt auto-detect
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) { [y, m, d] = str.split('-'); }
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) { [d, m, y] = str.split('/'); }
    else return str;
  }
  if (!d || !m || !y) return str;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function importHash(accountId, date, description, amountCents) {
  return crypto
    .createHash('sha256')
    .update(`${accountId}|${date}|${description}|${amountCents}`)
    .digest('hex');
}

function cleanDescription(raw) {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^(EFTPOS\s+|POS\s+|INTERNET\s+PURCHASE\s+|DIRECT\s+DEBIT\s+|BPAY\s+)/i, '')
    .replace(/\s+(AUS|AU|QLD|NSW|VIC|WA|SA|TAS|NT|ACT)\s*$/i, '')
    .trim();
}

function parseCSV(buffer, profile) {
  const records = parse(buffer, {
    skip_empty_lines: true,
    from_line: (profile.skip_rows || 1) + 1,
    relax_column_count: true,
    bom: true,
    trim: true,
  });

  const rows = [];
  for (const rec of records) {
    const rawDate = rec[profile.date.column];
    const rawDesc = rec[profile.description.column];

    if (!rawDate || !rawDesc) continue;

    const date = parseDate(rawDate, profile.date.format);
    const description = String(rawDesc).trim();

    let amountFloat;
    if (profile.amount) {
      const raw = parseAmount(rec[profile.amount.column]);
      if (raw === null) continue;
      amountFloat = profile.amount.negate ? -raw : raw;
    } else if (profile.debit_credit) {
      const debit = parseAmount(rec[profile.debit_credit.debit_column]);
      const credit = parseAmount(rec[profile.debit_credit.credit_column]);
      // debit = money out (negative), credit = money in (positive)
      if (debit) amountFloat = -Math.abs(debit);
      else if (credit) amountFloat = Math.abs(credit);
      else continue;
    } else {
      continue;
    }

    const amount_cents = Math.round(amountFloat * 100);
    if (!date || !description) continue;

    rows.push({ date, description, description_clean: cleanDescription(description), amount_cents });
  }
  return rows;
}

function detectTransfers(rows, accountId) {
  // Mark potential internal transfers: look for matching amounts across own accounts in ±3 day window
  const ownAccounts = db.prepare('SELECT id FROM accounts WHERE archived = 0').all().map(a => a.id);

  rows.forEach(row => {
    const match = db.prepare(`
      SELECT id FROM transactions
      WHERE account_id != ?
        AND account_id IN (${ownAccounts.map(() => '?').join(',')})
        AND amount_cents = ?
        AND date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
        AND is_transfer = 0
      LIMIT 1
    `).get(accountId, ...ownAccounts, -row.amount_cents, row.date, row.date);
    if (match) row.is_transfer = 1;
  });
}

function importCSV(buffer, profile, accountId) {
  const parsed = parseCSV(buffer, profile);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (account_id, date, description, description_clean, amount_cents,
       category_id, is_transfer, import_hash, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  detectTransfers(parsed, accountId);

  const results = { inserted: 0, duplicates: 0, needsReview: 0 };

  const doImport = db.transaction(() => {
    for (const row of parsed) {
      const hash = importHash(accountId, row.date, row.description, row.amount_cents);
      const exists = db.prepare('SELECT id FROM transactions WHERE import_hash = ?').get(hash);
      if (exists) { results.duplicates++; continue; }

      const catId = row.is_transfer ? null : categorise(row.description);
      if (!catId && !row.is_transfer) results.needsReview++;

      insertStmt.run(
        accountId, row.date, row.description, row.description_clean,
        row.amount_cents, catId, row.is_transfer ? 1 : 0, hash, null
      );
      results.inserted++;
    }
  });

  doImport();

  // Update account balance to the most recent transaction amount reference isn't meaningful here;
  // user updates manually from actual bank statement
  return { ...results, total: parsed.length };
}

function previewCSV(buffer, profile) {
  try {
    const rows = parseCSV(buffer, profile);
    return {
      ok: true,
      rowCount: rows.length,
      sample: rows.slice(0, 5),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { importCSV, previewCSV };
