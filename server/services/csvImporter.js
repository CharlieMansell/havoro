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

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// "31 Jul 26" / "31-Jul-2026" — NAB writes the month as a name and the year
// with two digits, which no split on a single separator can handle. Returns
// null when the string isn't that shape, so callers can fall through.
const NAMED_MONTH = /^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{2}|\d{4})$/;
function parseNamedMonthDate(str) {
  const match = str.match(NAMED_MONTH);
  if (!match) return null;

  const month = MONTH_NAMES[match[2].slice(0, 3).toLowerCase()];
  if (!month) return null;

  // A two-digit year is this century for anything a bank statement can
  // plausibly cover; the 70 pivot is the usual POSIX one.
  let year = Number(match[3]);
  if (match[3].length === 2) year += year < 70 ? 2000 : 1900;

  return [String(match[1]), String(month), String(year)];
}

function parseDate(value, format) {
  const str = String(value).trim();
  if (!str) return null;
  // supported formats: DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY, D/M/YYYY, DD MMM YY
  let d, m, y;
  if (format === 'DD MMM YY' || format === 'DD MMM YYYY') {
    const parts = parseNamedMonthDate(str);
    if (!parts) return str;
    [d, m, y] = parts;
  } else if (format === 'DD/MM/YYYY' || format === 'D/M/YYYY') {
    [d, m, y] = str.split('/');
  } else if (format === 'MM/DD/YYYY') {
    [m, d, y] = str.split('/');
  } else if (format === 'YYYY-MM-DD') {
    [y, m, d] = str.split('-');
  } else {
    // attempt auto-detect
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) { [y, m, d] = str.split('-'); }
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) { [d, m, y] = str.split('/'); }
    else {
      const parts = parseNamedMonthDate(str);
      if (!parts) return str;
      [d, m, y] = parts;
    }
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
    // ?? not || — ANZ and CommBank export with no header row at all, and
    // `0 || 1` would quietly skip their first transaction on every import.
    from_line: (profile.skip_rows ?? 1) + 1,
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

    // Some exports carry a tidied merchant name in its own column (NAB's
    // "Merchant Name", ANZ's payment reference), which beats anything
    // cleanDescription can recover from the raw statement line — but it's
    // blank on plenty of rows, so fall back rather than trusting it blindly.
    const merchant = profile.merchant ? String(rec[profile.merchant.column] ?? '').trim() : '';
    // The bank's own categorisation, where it has one, kept as-is so a rule
    // can map it to a Havoro category directly.
    const bankCategory = profile.bank_category ? String(rec[profile.bank_category.column] ?? '').trim() : '';

    rows.push({
      date,
      description,
      description_clean: merchant || cleanDescription(description),
      merchant: merchant || null,
      bank_category: bankCategory || null,
      amount_cents,
    });
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
      (account_id, date, description, description_clean, merchant, bank_category,
       amount_cents, category_id, is_transfer, import_hash, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  detectTransfers(parsed, accountId);

  const results = { inserted: 0, duplicates: 0, needsReview: 0 };

  const doImport = db.transaction(() => {
    for (const row of parsed) {
      const hash = importHash(accountId, row.date, row.description, row.amount_cents);
      const exists = db.prepare('SELECT id FROM transactions WHERE import_hash = ?').get(hash);
      if (exists) { results.duplicates++; continue; }

      const catId = row.is_transfer ? null : categorise({ ...row, account_id: accountId });
      if (!catId && !row.is_transfer) results.needsReview++;

      insertStmt.run(
        accountId, row.date, row.description, row.description_clean,
        row.merchant, row.bank_category,
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
