// Reads an .xlsx into the same shape csv-parse gives us: an array of rows,
// each an array of cell strings. That is the whole point — every bank profile,
// column index and date format in csvImporter.js then works unchanged whether
// the file came from a CSV download or an Excel one.
//
// Written by hand rather than pulled from a package. An .xlsx is a zip of XML
// and Node already ships the inflate half in zlib, so the alternative was a
// dependency (SheetJS is no longer published to the npm registry; exceljs is
// several megabytes) for something that comes to a couple of hundred lines and
// has no attack surface beyond files the user picked themselves.
//
// Deliberately not supported: formulas (the cached value is used), styles,
// merged cells, and zip64 containers. Bank exports are flat tables of a few
// hundred rows and use none of them.

const zlib = require('zlib');

// ── zip ─────────────────────────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

// The end-of-central-directory record sits at the very end of the file, after
// a comment of unknown length, so it has to be searched for backwards. The
// comment is capped at 64KB by the format.
function findEndOfCentralDirectory(buf) {
  const start = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// Returns { filename: Buffer } for every entry in the archive.
function unzip(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Not a .xlsx file (no zip header)');
  }

  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('Not a .xlsx file (no zip directory)');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CEN_SIG) break;

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);

    // The local header repeats the name and carries its own extra field, which
    // is frequently a different length from the central one — so the data
    // offset has to be read from the local header, not computed from this one.
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buf.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = zlib.inflateRawSync(data);
    // Anything else (bzip2, lzma) never appears in a spreadsheet export.

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// ── xml ─────────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(str) {
  return str.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

// Concatenates the text of every <t> in a fragment. Shared strings are split
// across several <t> runs whenever part of the string is styled differently,
// and a merchant name broken over two runs must not come back broken in half.
function textOf(fragment) {
  let out = '';
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(fragment))) out += decodeEntities(m[1]);
  return out;
}

function readSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) strings.push(textOf(m[1]));
  return strings;
}

// "BC12" → 54. Excel columns are base-26 with no zero, so AA follows Z.
function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break; // hit the row number
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

// ── excel dates ─────────────────────────────────────────────────────────────

// Excel stores a date as days since 1899-12-30. (Not 1900-01-01: the format
// deliberately reproduces a bug in Lotus 1-2-3 that treated 1900 as a leap
// year, and the two errors cancel out for every date after February 1900.)
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

// Only serials inside a plausible range for a bank statement are converted:
// 1990-01-01 to 2100-01-01. A raw amount that happens to be numeric is never
// mistaken for a date this way.
const MIN_SERIAL = 32874;
const MAX_SERIAL = 73051;

function serialToISODate(serial) {
  if (!(serial >= MIN_SERIAL && serial <= MAX_SERIAL)) return null;
  // Round rather than truncate: a timestamped cell can land a hair under the
  // day boundary, and a date is what's wanted either way.
  const date = new Date(EXCEL_EPOCH_MS + Math.round(serial) * MS_PER_DAY);
  return date.toISOString().slice(0, 10);
}

/** Converts an Excel date serial to YYYY-MM-DD, or returns the value unchanged. */
function excelDate(value) {
  const str = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) return value; // already a date string
  return serialToISODate(Number(str)) ?? value;
}

// ── sheets ──────────────────────────────────────────────────────────────────

// The first sheet in the workbook is not reliably worksheets/sheet1.xml — the
// file name reflects creation order, the workbook lists display order. Amex
// puts Transaction Details first and a Transaction Summary after it, and
// picking the wrong one silently yields a file with no transactions in it.
function firstSheetPath(files) {
  const workbook = files['xl/workbook.xml']?.toString('utf8');
  const rels = files['xl/_rels/workbook.xml.rels']?.toString('utf8');

  if (workbook && rels) {
    const sheet = /<sheet[^>]*\/?>/.exec(workbook)?.[0];
    const relId = sheet && /r:id="([^"]+)"/.exec(sheet)?.[1];
    if (relId) {
      const rel = new RegExp(`<Relationship[^>]*Id="${relId}"[^>]*>`).exec(rels)?.[0];
      const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
      if (target) {
        const path = target.replace(/^\/?(xl\/)?/, 'xl/');
        if (files[path]) return path;
      }
    }
  }

  // Fall back to the lowest-numbered sheet rather than failing outright.
  const sheets = Object.keys(files)
    .filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!sheets.length) throw new Error('That .xlsx has no worksheets in it');
  return sheets[0];
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;

  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    let cellMatch;
    cellRe.lastIndex = 0;

    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const ref = /r="([A-Z]+)/.exec(attrs)?.[1];

      let value = '';
      if (type === 's') {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]);
        value = sharedStrings[index] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        // Numbers, dates, booleans and cached formula results all land here.
        value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }

      // Empty cells are omitted from the XML entirely, so a row's cells have
      // to be placed by their reference or every column after a blank shifts.
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }

    rows.push(cells);
  }
  return rows;
}

/**
 * Reads the first worksheet of an .xlsx buffer as an array of row arrays.
 * Cell values come back as strings, exactly as csv-parse returns them.
 */
function readXLSX(buffer) {
  const files = unzip(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const sharedStrings = readSharedStrings(files['xl/sharedStrings.xml']?.toString('utf8'));
  const sheetXml = files[firstSheetPath(files)].toString('utf8');
  return parseSheet(sheetXml, sharedStrings);
}

/** True if the buffer looks like a zip container, which is what an .xlsx is. */
function looksLikeXLSX(buffer) {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

module.exports = { readXLSX, looksLikeXLSX, excelDate };
