// CSV and Excel import for the on-device backend — ported from
// server/services/csvImporter.js and server/bank-profiles/*.json.
// Keep in sync when the server importer or profiles change.

import { readXLSX, looksLikeXLSX, excelDate } from './xlsxReader.js';

export const BANK_PROFILES = {
  amex: {
    name: 'American Express — Card', account_match: 'amex',
    // The only profile on an Excel download rather than a CSV: Amex's
    // spreadsheet is the export that carries the merchant and category
    // columns worth categorising on.
    file: 'xlsx', skip_rows: 7, header_match: ['Date', 'Description', 'Amount'],
    date: { column: 0, format: 'EXCEL' }, description: { column: 2 },
    merchant: { column: 10 }, bank_category: { column: 9 },
    // Amex states a purchase as a positive number and a payment as a
    // negative one, which is the opposite of every other profile here.
    amount: { column: 5, negate: true },
  },
  anz: {
    name: 'ANZ — Everyday / Savings', account_match: 'anz', skip_rows: 0,
    date: { column: 0, format: 'D/M/YYYY' }, description: { column: 2 },
    merchant: { column: 7 },
    amount: { column: 1, negate: false },
  },
  commbank: {
    name: 'CommBank (CBA) — Everyday / Savings', account_match: 'commbank', skip_rows: 0,
    date: { column: 0, format: 'D/M/YYYY' }, description: { column: 2 },
    amount: { column: 1, negate: false },
  },
  nab: {
    name: 'NAB — Everyday / Savings', account_match: 'nab', skip_rows: 1,
    date: { column: 0, format: 'DD MMM YY' }, description: { column: 4 },
    merchant: { column: 7 }, bank_category: { column: 6 },
    amount: { column: 1, negate: false },
  },
  westpac: {
    name: 'Westpac — Everyday / Savings', account_match: 'westpac', skip_rows: 1,
    date: { column: 1, format: 'D/M/YYYY' }, description: { column: 2 },
    bank_category: { column: 6 },
    debit_credit: { debit_column: 3, credit_column: 4 },
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

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// "31 Jul 26" / "31-Jul-2026" — see the note in server/services/csvImporter.js
const NAMED_MONTH = /^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{2}|\d{4})$/;
function parseNamedMonthDate(str) {
  const match = str.match(NAMED_MONTH);
  if (!match) return null;
  const month = MONTH_NAMES[match[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  let year = Number(match[3]);
  if (match[3].length === 2) year += year < 70 ? 2000 : 1900;
  return [String(match[1]), String(month), String(year)];
}

function parseDate(value, format) {
  let str = String(value).trim();
  if (!str) return null;

  // An Excel date cell holds a serial number, not text — see the server copy.
  if (format === 'EXCEL') {
    str = String(excelDate(str)).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  }

  let d, m, y;
  if (format === 'DD MMM YY' || format === 'DD MMM YYYY') {
    const parts = parseNamedMonthDate(str);
    if (!parts) return str;
    [d, m, y] = parts;
  }
  else if (format === 'DD/MM/YYYY' || format === 'D/M/YYYY') [d, m, y] = str.split('/');
  else if (format === 'MM/DD/YYYY') [m, d, y] = str.split('/');
  else if (format === 'YYYY-MM-DD') [y, m, d] = str.split('-');
  else {
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) [y, m, d] = str.split('-');
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) [d, m, y] = str.split('/');
    else {
      const parts = parseNamedMonthDate(str);
      if (!parts) return str;
      [d, m, y] = parts;
    }
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

// The first row containing all of `match` (in any column), or -1.
function findHeaderRow(records, match) {
  const needles = (Array.isArray(match) ? match : [match]).map(s => s.toLowerCase());
  for (let i = 0; i < records.length; i++) {
    const cells = records[i].map(c => String(c ?? '').trim().toLowerCase());
    if (needles.every(n => cells.includes(n))) return i;
  }
  return -1;
}

// Both formats reduce to rows of cell strings; everything downstream is shared.
async function toRecords(bytes, profile) {
  const skip = profile.skip_rows ?? 1;
  const isXLSX = looksLikeXLSX(bytes);

  if (profile.file === 'xlsx') {
    if (!isXLSX) {
      throw new Error(`${profile.name} expects the Excel (.xlsx) download — that file isn't one. `
        + 'Re-download it choosing Excel rather than CSV.');
    }
    const all = await readXLSX(bytes);
    // Locate the header rather than counting past the letterhead where the
    // profile says how to recognise it; skip_rows is the fallback.
    if (profile.header_match) {
      const index = findHeaderRow(all, profile.header_match);
      if (index >= 0) return all.slice(index + 1);
    }
    return all.slice(skip);
  }

  if (isXLSX) {
    throw new Error(`${profile.name} expects a .csv file, but that's a spreadsheet. `
      + 'Re-download it choosing CSV.');
  }

  // BOM strip + skip header rows (record-based; bank CSV fields don't contain newlines).
  // ?? not || — a headerless export sets skip_rows: 0, and `0 || 1` would
  // quietly drop its first transaction.
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  return parseCsvText(text).slice(skip);
}

export async function parseBankFile(bytes, profile) {
  const records = await toRecords(bytes, profile);

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

    // Prefer a dedicated merchant-name column when the profile has one
    const merchant = profile.merchant ? String(rec[profile.merchant.column] ?? '').trim() : '';
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

// `occurrence` distinguishes rows a bank exports identically — see the note
// in server/services/csvImporter.js. Occurrence 0 hashes what it always did,
// so existing on-device data keeps deduping against itself.
export async function importHash(accountId, date, description, amountCents, occurrence = 0) {
  const base = `${accountId}|${date}|${description}|${amountCents}`;
  const data = new TextEncoder().encode(occurrence === 0 ? base : `${base}|${occurrence}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
