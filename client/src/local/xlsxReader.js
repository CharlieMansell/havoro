// Browser/on-device port of server/services/xlsxReader.js — reads an .xlsx
// into rows of cell strings so the bank profiles work on Excel downloads as
// well as CSV ones. Keep the two in sync; the notes on why it's hand-written,
// and on what it deliberately doesn't support, are in the server copy.
//
// The only real difference is inflate. Node has zlib; here it's
// DecompressionStream('deflate-raw'), which is native in Safari 16.4+ and
// every current browser, so this stays dependency-free on both sides. That
// makes the whole reader async, unlike the server's.

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

// DecompressionStream landed in WebKit 16.4, and this project's iOS
// deployment target is 15.0 — so on an older phone this is simply absent.
// Everything else in the app works there, including every CSV profile, which
// is exactly why the failure needs to name itself: a bare ReferenceError here
// reads as "Amex import is broken" rather than "this phone is too old".
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Reading Excel files needs iOS 16.4 or newer. CSV imports work on any version — '
      + 'for Amex, update iOS or import on the desktop app instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEndOfCentralDirectory(view, length) {
  const start = Math.max(0, length - 0x10000 - 22);
  for (let i = length - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 22 || view.getUint32(0, true) !== LOCAL_SIG) {
    throw new Error('Not a .xlsx file (no zip header)');
  }

  const eocd = findEndOfCentralDirectory(view, bytes.length);
  if (eocd < 0) throw new Error('Not a .xlsx file (no zip directory)');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder('utf-8');
  const files = {};

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CEN_SIG) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    // Data offset comes from the local header — its extra field is routinely a
    // different length from the central directory's.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = await inflateRaw(data);

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { files, decoder };
}

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

// Shared strings split across styled runs must come back joined, not halved.
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

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

// Days since 1899-12-30 — see the server copy for why it isn't 1900-01-01.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;
const MIN_SERIAL = 32874; // 1990-01-01
const MAX_SERIAL = 73051; // 2100-01-01

export function excelDate(value) {
  const str = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) return value;
  const serial = Number(str);
  if (!(serial >= MIN_SERIAL && serial <= MAX_SERIAL)) return value;
  return new Date(EXCEL_EPOCH_MS + Math.round(serial) * MS_PER_DAY).toISOString().slice(0, 10);
}

// The first sheet by workbook order, which is not reliably sheet1.xml — Amex
// puts Transaction Details first and Transaction Summary second, and reading
// the wrong one yields a file with no transactions in it.
function firstSheetPath(files, decoder) {
  const text = name => (files[name] ? decoder.decode(files[name]) : null);
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');

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
        value = sharedStrings[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }

      // Empty cells are absent from the XML, so place by reference or every
      // column after a blank shifts left.
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }

    rows.push(cells);
  }
  return rows;
}

/** Reads the first worksheet of an .xlsx as an array of row arrays of strings. */
export async function readXLSX(buffer) {
  const { files, decoder } = await unzip(buffer);
  const shared = files['xl/sharedStrings.xml'] ? decoder.decode(files['xl/sharedStrings.xml']) : null;
  const sheetXml = decoder.decode(files[firstSheetPath(files, decoder)]);
  return parseSheet(sheetXml, readSharedStrings(shared));
}

/** True if these bytes are a zip container, which is what an .xlsx is. */
export function looksLikeXLSX(bytes) {
  return bytes.length > 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === LOCAL_SIG;
}
