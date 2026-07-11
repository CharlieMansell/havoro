// CSV import for the on-device backend — ported from
// server/services/csvImporter.js and server/bank-profiles/*.json.
// Keep in sync when the server importer or profiles change.

export const BANK_PROFILES = {
  anz: {
    name: 'ANZ — Everyday / Savings', account_match: 'anz', skip_rows: 1,
    date: { column: 0, format: 'DD/MM/YYYY' }, description: { column: 2 },
    amount: { column: 1, negate: false },
  },
  commbank: {
    name: 'CommBank (CBA) — Everyday / Savings', account_match: 'commbank', skip_rows: 1,
    date: { column: 0, format: 'DD/MM/YYYY' }, description: { column: 2 },
    debit_credit: { debit_column: 1, credit_column: 3 },
  },
  nab: {
    name: 'NAB — Everyday / Savings', account_match: 'nab', skip_rows: 1,
    date: { column: 0, format: 'DD/MM/YYYY' }, description: { column: 2 },
    amount: { column: 1, negate: false },
  },
  westpac: {
    name: 'Westpac — Everyday / Savings', account_match: 'westpac', skip_rows: 1,
    date: { column: 0, format: 'DD/MM/YYYY' }, description: { column: 1 },
    debit_credit: { debit_column: 2, credit_column: 3 },
  },
};

// Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF)
function parseCsvText(text) {
  const records = [];
  let record = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
    } else field += ch;
  }
  record.push(field);
  if (record.length > 1 || record[0] !== '') records.push(record);
  return records;
}

function parseAmount(value) {
  if (!value && value !== 0) return null;
  const str = String(value).trim().replace(/[$,\s]/g, '');
  if (!str || str === '-') return null;
  const neg = str.startsWith('(') && str.endsWith(')');
  const num = parseFloat(neg ? str.slice(1, -1) : str);
  return isNaN(num) ? null : (neg ? -num : num);
}

function parseDate(value, format) {
  const str = String(value).trim();
  if (!str) return null;
  let d, m, y;
  if (format === 'DD/MM/YYYY' || format === 'D/M/YYYY') [d, m, y] = str.split('/');
  else if (format === 'MM/DD/YYYY') [m, d, y] = str.split('/');
  else if (format === 'YYYY-MM-DD') [y, m, d] = str.split('-');
  else {
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) [y, m, d] = str.split('-');
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) [d, m, y] = str.split('/');
    else return str;
  }
  if (!d || !m || !y) return str;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function cleanDescription(raw) {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^(EFTPOS\s+|POS\s+|INTERNET\s+PURCHASE\s+|DIRECT\s+DEBIT\s+|BPAY\s+)/i, '')
    .replace(/\s+(AUS|AU|QLD|NSW|VIC|WA|SA|TAS|NT|ACT)\s*$/i, '')
    .trim();
}

export function parseBankCSV(text, profile) {
  // BOM strip + skip header rows (record-based; bank CSV fields don't contain newlines)
  const records = parseCsvText(text.replace(/^﻿/, '')).slice(profile.skip_rows || 1);

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
      if (debit) amountFloat = -Math.abs(debit);
      else if (credit) amountFloat = Math.abs(credit);
      else continue;
    } else continue;

    const amount_cents = Math.round(amountFloat * 100);
    if (!date || !description) continue;

    rows.push({ date, description, description_clean: cleanDescription(description), amount_cents });
  }
  return rows;
}

export async function importHash(accountId, date, description, amountCents) {
  const data = new TextEncoder().encode(`${accountId}|${date}|${description}|${amountCents}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
