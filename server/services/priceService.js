const https = require('https');
const db = require('../db/db');

const PRICE_CACHE_MS = 60 * 60 * 1000; // 1 hour

// ── Stooq (primary — no API key, no IP restrictions) ─────────────────────────
// Symbol format: bhp.au (ASX), aapl.us (NYSE/NASDAQ), hsba.uk (LSE)
function stooqSymbol(ticker, exchange) {
  const t = ticker.toLowerCase();
  if (exchange === 'ASX')    return `${t}.au`;
  if (exchange === 'LSE')    return `${t}.uk`;
  if (exchange === 'NYSE' || exchange === 'NASDAQ') return `${t}.us`;
  return t;
}

function fetchStooq(ticker, exchange) {
  const sym = stooqSymbol(ticker, exchange);
  const url = `https://stooq.com/q/l/?s=${sym}&f=sd2t2ohlcv&h&e=csv`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Stooq HTTP ${res.statusCode}`));
        const lines = data.trim().split('\n');
        if (lines.length < 2) return reject(new Error(`No data returned for ${sym}`));
        const cols = lines[1].split(',');
        const close = parseFloat(cols[5]);  // Close price column
        if (!close || isNaN(close) || cols[5] === 'N/D') {
          return reject(new Error(`No price available for ${sym} (market may be closed)`));
        }
        resolve(close);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Stooq request timed out')); });
  });
}

// ── Yahoo Finance (fallback) ──────────────────────────────────────────────────
let _yf = null;
function getYahooFinance() {
  if (_yf) return _yf;
  try {
    const { default: YahooFinanceCls } = require('yahoo-finance2');
    _yf = new YahooFinanceCls({ suppressNotices: ['yahooSurvey'] });
  } catch {
    _yf = null;
  }
  return _yf;
}

async function fetchYahoo(yahooSymbol) {
  const yf = getYahooFinance();
  if (!yf) throw new Error('yahoo-finance2 unavailable');
  const quote = await yf.quote(yahooSymbol, {}, { validateResult: false });
  const price = quote.regularMarketPrice;
  if (!price) throw new Error('No price in Yahoo response');
  return price;
}

// ── Combined fetch: Stooq → Yahoo fallback ────────────────────────────────────
async function fetchPrice(holding) {
  const errors = [];

  try {
    const price = await fetchStooq(holding.ticker, holding.exchange);
    return { price, source: 'stooq' };
  } catch (e) {
    errors.push(`Stooq: ${e.message}`);
  }

  if (holding.yahoo_symbol) {
    try {
      const price = await fetchYahoo(holding.yahoo_symbol);
      return { price, source: 'yahoo' };
    } catch (e) {
      errors.push(`Yahoo: ${e.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

// ── Main export ───────────────────────────────────────────────────────────────
async function refreshHoldingPrices(holdings, { force = false } = {}) {
  if (!holdings.length) return holdings;

  const now = Date.now();
  const updateStmt = db.prepare(
    'UPDATE holdings SET current_price_cents = ?, price_updated_at = ? WHERE id = ?'
  );

  return Promise.all(holdings.map(async (h) => {
    const cachedAt = h.price_updated_at ? new Date(h.price_updated_at).getTime() : 0;
    if (!force && (now - cachedAt) < PRICE_CACHE_MS) {
      return { ...h, price_stale: false };
    }
    if (!h.ticker) return { ...h, price_stale: true };

    try {
      const { price } = await fetchPrice(h);
      const priceCents = Math.round(price * 100);
      const updatedAt = new Date().toISOString();
      updateStmt.run(priceCents, updatedAt, h.id);
      return { ...h, current_price_cents: priceCents, price_updated_at: updatedAt, price_stale: false };
    } catch (err) {
      return { ...h, price_stale: true, price_error: err.message };
    }
  }));
}

module.exports = { refreshHoldingPrices };
