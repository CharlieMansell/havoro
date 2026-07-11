import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatCents } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { Sk, SkCard } from '../components/Skeleton';

const ASSET_TYPES = [
  { value: 'super',           label: 'Super / Retirement' },
  { value: 'property',        label: 'Property' },
  { value: 'share_portfolio', label: 'Share Portfolio' },
  { value: 'other_asset',     label: 'Other Asset' },
];

const EXCHANGES = [
  { value: 'ASX',    label: 'ASX (Australia)' },
  { value: 'NYSE',   label: 'NYSE (US)' },
  { value: 'NASDAQ', label: 'NASDAQ (US)' },
  { value: 'LSE',    label: 'LSE (UK)' },
  { value: 'OTHER',  label: 'Other' },
];

const TYPE_COLORS = {
  super:           '#8b5cf6',
  property:        '#f59e0b',
  share_portfolio: '#10b981',
  other_asset:     '#94a3b8',
};

function inferYahooSymbol(ticker, exchange) {
  if (!ticker) return '';
  const t = ticker.trim().toUpperCase();
  if (exchange === 'ASX') return `${t}.AX`;
  if (exchange === 'LSE') return `${t}.L`;
  return t;
}

// ─── Asset form (add / edit a portfolio / super / property / other) ──────────
function AssetForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    name: '', type: 'property', institution: '',
    current_balance_cents: 0, include_in_net_worth: true,
  });
  const [display, setDisplay] = useState(
    initial ? (Math.abs(initial.current_balance_cents) / 100).toFixed(2) : ''
  );
  const f = k => v => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    await onSave({
      ...form,
      current_balance_cents: Math.round(parseFloat(display || 0) * 100),
      is_manual_balance: 1,
      include_in_net_worth: form.include_in_net_worth ? 1 : 0,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Asset name</label>
        <input className="input" value={form.name} onChange={e => f('name')(e.target.value)} placeholder="e.g. Family home" />
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={form.type} onChange={e => f('type')(e.target.value)}>
          {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Institution / Provider</label>
        <input className="input" value={form.institution || ''} onChange={e => f('institution')(e.target.value)} placeholder="e.g. AustralianSuper" />
      </div>
      {form.type !== 'share_portfolio' && (
        <div>
          <label className="label">Current value ($)</label>
          <input
            type="number" className="input" step="0.01"
            value={display} onChange={e => setDisplay(e.target.value)} placeholder="0.00"
          />
        </div>
      )}
      {form.type === 'share_portfolio' && (
        <p className="text-xs text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
          Portfolio value is computed automatically from your holdings.
          Add individual stocks/ETFs after saving this portfolio.
        </p>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={!!form.include_in_net_worth} onChange={e => f('include_in_net_worth')(e.target.checked)} className="rounded" />
        Include in net worth
      </label>
      <div className="flex gap-2 justify-end pt-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={!form.name}>Save</button>
      </div>
    </div>
  );
}

// ─── Holding form (add / edit a single stock/ETF within a portfolio) ─────────
function HoldingForm({ initial, portfolioId, onSave, onClose }) {
  const [form, setForm] = useState(initial ? {
    ticker:            initial.ticker || '',
    exchange:          initial.exchange || 'ASX',
    yahoo_symbol:      initial.yahoo_symbol || '',
    units:             initial.units ?? '',
    avg_cost_display:  initial.avg_cost_cents != null ? (initial.avg_cost_cents / 100).toFixed(2) : '',
    price_display:     initial.current_price_cents > 0 ? (initial.current_price_cents / 100).toFixed(2) : '',
    yahoo_override:    !!(initial.yahoo_symbol && initial.yahoo_symbol !== inferYahooSymbol(initial.ticker, initial.exchange)),
  } : {
    ticker: '', exchange: 'ASX', yahoo_symbol: '', units: '', avg_cost_display: '', price_display: '', yahoo_override: false,
  });

  const derived = inferYahooSymbol(form.ticker, form.exchange);
  const displaySymbol = form.yahoo_override ? form.yahoo_symbol : derived;

  const setField = k => v => setForm(p => ({ ...p, [k]: v }));

  const handleTickerOrExchangeChange = (ticker, exchange) => {
    setForm(p => ({
      ...p,
      ticker: ticker ?? p.ticker,
      exchange: exchange ?? p.exchange,
      yahoo_symbol: p.yahoo_override ? p.yahoo_symbol : inferYahooSymbol(ticker ?? p.ticker, exchange ?? p.exchange),
    }));
  };

  const handleSave = () => {
    const priceCents = form.price_display ? Math.round(parseFloat(form.price_display) * 100) : null;
    onSave({
      portfolio_account_id: portfolioId,
      ticker:               form.ticker.trim().toUpperCase(),
      exchange:             form.exchange,
      yahoo_symbol:         displaySymbol,
      units:                Number(form.units) || 0,
      avg_cost_cents:       Math.round(parseFloat(form.avg_cost_display || '0') * 100),
      ...(priceCents != null ? { current_price_cents: priceCents } : {}),
    });
  };

  const valid = form.ticker.trim().length > 0 && Number(form.units) > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Ticker</label>
          <input
            className="input uppercase" placeholder="e.g. BHP"
            value={form.ticker}
            onChange={e => handleTickerOrExchangeChange(e.target.value, null)}
          />
        </div>
        <div>
          <label className="label">Exchange</label>
          <select className="input" value={form.exchange} onChange={e => handleTickerOrExchangeChange(null, e.target.value)}>
            {EXCHANGES.map(ex => <option key={ex.value} value={ex.value}>{ex.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="label mb-0">Yahoo Finance symbol</label>
          <button
            type="button"
            className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
            onClick={() => setField('yahoo_override')(!form.yahoo_override)}
          >
            {form.yahoo_override ? 'Use auto' : 'Override'}
          </button>
        </div>
        {form.yahoo_override ? (
          <input
            className="input font-mono text-sm"
            value={form.yahoo_symbol}
            onChange={e => setField('yahoo_symbol')(e.target.value)}
            placeholder="e.g. BHP.AX"
          />
        ) : (
          <div className="input bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-mono text-sm select-none">
            {displaySymbol || <span className="text-slate-300 dark:text-slate-600">enter ticker first</span>}
          </div>
        )}
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Used to fetch live prices. ASX tickers auto-append .AX</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Units held</label>
          <input
            type="number" step="any" min="0" className="input"
            value={form.units} onChange={e => setField('units')(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label className="label">Avg cost / unit ($)</label>
          <input
            type="number" step="0.01" min="0" className="input"
            value={form.avg_cost_display} onChange={e => setField('avg_cost_display')(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div>
        <label className="label">
          Current price / unit ($)
          <span className="font-normal text-slate-400 dark:text-slate-500 ml-1">(optional, overrides auto-fetch)</span>
        </label>
        <input
          type="number" step="0.01" min="0" className="input"
          value={form.price_display} onChange={e => setField('price_display')(e.target.value)}
          placeholder="Leave blank to use Yahoo Finance"
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={!valid}>
          {initial ? 'Save changes' : 'Add holding'}
        </button>
      </div>
    </div>
  );
}

function minutesAgo(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

// ─── Holdings panel (shown when a share_portfolio is expanded) ────────────────
function HoldingsPanel({ portfolioId, onBalanceUpdated }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/holdings?portfolio_id=${portfolioId}`)
      .then(setHoldings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [portfolioId]);

  useEffect(() => { load(); }, [load]);

  const refreshPrices = async () => {
    setRefreshing(true);
    try {
      const { holdings: updated, any_error } = await api.post(`/holdings/refresh-prices?portfolio_id=${portfolioId}`, {});
      setHoldings(updated);
      onBalanceUpdated?.();
      if (any_error) toast.addToast('Some prices could not be fetched', 'warning');
      else toast.addToast('Prices updated');
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const addHolding = async (body) => {
    try {
      await api.post('/holdings', body);
      toast.addToast('Holding added');
      setShowAdd(false);
      load();
    } catch (e) { toast.addToast(e.message, 'error'); }
  };

  const updateHolding = async (body) => {
    try {
      await api.put(`/holdings/${editing.id}`, body);
      toast.addToast('Holding updated');
      setEditing(null);
      load();
    } catch (e) { toast.addToast(e.message, 'error'); }
  };

  const deleteHolding = async (h) => {
    const ok = await confirm({
      title: `Remove ${h.ticker}?`,
      message: 'This will delete the holding and its price history.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.delete(`/holdings/${h.id}`);
    toast.addToast(`${h.ticker} removed`);
    load();
  };

  const totalValue = holdings.reduce((s, h) => s + Math.round((h.units ?? 0) * (h.current_price_cents ?? 0)), 0);
  const totalCost  = holdings.reduce((s, h) => s + Math.round((h.units ?? 0) * (h.avg_cost_cents ?? 0)), 0);
  const gain = totalValue - totalCost;

  const mostRecentPrice = holdings.reduce((latest, h) => {
    if (!h.price_updated_at) return latest;
    return !latest || h.price_updated_at > latest ? h.price_updated_at : latest;
  }, null);

  return (
    <div className="px-4 sm:px-5 pb-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Holdings</span>
          {mostRecentPrice && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500">· updated {minutesAgo(mostRecentPrice)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {holdings.length > 0 && (
            <button
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50 flex items-center gap-1"
              onClick={refreshPrices}
              disabled={refreshing}
            >
              {refreshing ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  Refreshing…
                </>
              ) : 'Refresh prices'}
            </button>
          )}
          <button className="btn-primary text-xs py-1.5 px-3" onClick={() => setShowAdd(true)}>+ Add holding</button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 pb-2">
          {[0,1].map(i => <div key={i} className="h-8 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />)}
        </div>
      ) : holdings.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 pb-3">No holdings yet. Add your first stock or ETF.</p>
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden mb-2">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[480px]">
              <thead>
                <tr className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-500 font-medium">
                  <th className="px-3 py-2.5 text-left">Ticker</th>
                  <th className="px-3 py-2.5 text-right">Units</th>
                  <th className="px-3 py-2.5 text-right">Avg cost</th>
                  <th className="px-3 py-2.5 text-right">Last price</th>
                  <th className="px-3 py-2.5 text-right">Value</th>
                  <th className="px-3 py-2.5 text-right">Gain/Loss</th>
                  <th className="px-1 py-2.5" />
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-50 dark:divide-slate-800">
                {holdings.map(h => {
                  const value   = Math.round((h.units ?? 0) * (h.current_price_cents ?? 0));
                  const cost    = Math.round((h.units ?? 0) * (h.avg_cost_cents ?? 0));
                  const gl      = value - cost;
                  const hasPrice = h.current_price_cents != null && h.current_price_cents > 0;
                  return (
                    <tr key={h.id} className="text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 group">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{h.ticker}</div>
                        <div className="text-slate-400 dark:text-slate-500 text-[10px]">{h.exchange}{h.yahoo_symbol ? ` · ${h.yahoo_symbol}` : ''}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right">{(h.units ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 4 })}</td>
                      <td className="px-3 py-2.5 text-right">{h.avg_cost_cents ? formatCents(h.avg_cost_cents) : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {hasPrice
                          ? <span>{formatCents(h.current_price_cents)}</span>
                          : <span className="text-slate-300 dark:text-slate-600">no price yet</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium">{hasPrice ? formatCents(value) : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {hasPrice && cost > 0
                          ? <span className={gl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{gl >= 0 ? '+' : ''}{formatCents(gl)}</span>
                          : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="text-slate-400 dark:text-slate-500 hover:text-slate-700 px-1.5 py-1 rounded" onClick={() => setEditing(h)}>Edit</button>
                          <button className="text-red-400 hover:text-red-600 px-1.5 py-1 rounded" onClick={() => deleteHolding(h)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {holdings.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium">
                    <td className="px-3 py-2" colSpan={4}>Total</td>
                    <td className="px-3 py-2 text-right">{totalValue > 0 ? formatCents(totalValue) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {totalValue > 0 && totalCost > 0
                        ? <span className={gain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{gain >= 0 ? '+' : ''}{formatCents(gain)}</span>
                        : '—'}
                    </td>
                    <td className="px-2 py-2" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-400 dark:text-slate-500 pb-1">
        Prices via Yahoo Finance. Use "Refresh prices" to fetch latest, or prices auto-update during check-in.
      </p>

      {showAdd && (
        <Modal title="Add holding" onClose={() => setShowAdd(false)}>
          <HoldingForm portfolioId={portfolioId} onSave={addHolding} onClose={() => setShowAdd(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.ticker}`} onClose={() => setEditing(null)}>
          <HoldingForm initial={editing} portfolioId={portfolioId} onSave={updateHolding} onClose={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

// ─── Main Assets page ─────────────────────────────────────────────────────────
export default function Assets() {
  const toast = useToast();
  const confirm = useConfirm();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [updatingBalance, setUpdatingBalance] = useState(null);
  const [balanceInput, setBalanceInput] = useState('');
  const [expanded, setExpanded] = useState({});

  const load = () => {
    setLoading(true);
    api.get('/accounts')
      .then(all => setAssets(all.filter(a => ASSET_TYPES.some(t => t.value === a.type) && !a.archived)))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const total = assets.reduce((s, a) => s + a.current_balance_cents, 0);
  const grouped = ASSET_TYPES
    .map(t => ({ ...t, items: assets.filter(a => a.type === t.value) }))
    .filter(t => t.items.length > 0);

  const archiveAsset = async (asset) => {
    const ok = await confirm({
      title: `Archive "${asset.name}"?`,
      message: 'It will be hidden from the app. Net worth history is preserved.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    await api.delete(`/accounts/${asset.id}`);
    toast.addToast(`${asset.name} archived`);
    load();
  };

  const saveBalance = async (id) => {
    await api.patch(`/accounts/${id}/balance`, { balance_cents: Math.round(parseFloat(balanceInput) * 100) });
    toast.addToast('Value updated');
    setUpdatingBalance(null);
    load();
  };

  const toggleExpand = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  if (loading) return (
    <div className="space-y-6">
      <Sk w="w-28" h="h-6" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0,1,2].map(i => <SkCard key={i} className="space-y-2"><Sk w="w-20" h="h-3" /><Sk w="w-32" h="h-6" /></SkCard>)}
      </div>
      {[0,1].map(i => (
        <SkCard key={i} className="p-0 overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700"><Sk w="w-24" h="h-3" /></div>
          {[0,1].map(j => (
            <div key={j} className="px-5 py-4 flex items-center gap-3 border-b border-slate-50 dark:border-slate-800 last:border-0">
              <div className="flex-1 space-y-2"><Sk w="w-32" h="h-3.5" /><Sk w="w-20" h="h-3" /></div>
              <Sk w="w-24" h="h-4" />
            </div>
          ))}
        </SkCard>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100">Assets</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Total value: <span className="font-medium text-slate-700 dark:text-slate-200">{formatCents(total)}</span></p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setShowAdd(true)}>+ Add asset</button>
      </div>

      {assets.length === 0 ? (
        <div className="card text-center py-12 text-slate-400 dark:text-slate-500 text-sm">
          No assets yet. Add property, shares, super or other assets to track their value.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.value} className="card p-0 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TYPE_COLORS[group.value] }} />
                <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{group.label}</span>
              </div>

              {group.items.map(asset => (
                <div key={asset.id}>
                  <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-slate-50 dark:border-slate-800 last:border-0">
                    <div className="min-w-0 sm:flex-1">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{asset.name}</p>
                      {asset.institution && <p className="text-xs text-slate-400 dark:text-slate-500">{asset.institution}</p>}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
                      {/* Share portfolios: toggle holdings instead of inline balance edit */}
                      {asset.type === 'share_portfolio' ? (
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{formatCents(asset.current_balance_cents)}</div>
                            {asset.portfolio_cost_cents > 0 && (() => {
                              const gl = asset.current_balance_cents - asset.portfolio_cost_cents;
                              const pct = ((gl / asset.portfolio_cost_cents) * 100).toFixed(1);
                              return (
                                <div className={`text-xs font-medium ${gl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                  {gl >= 0 ? '+' : ''}{formatCents(gl)} ({gl >= 0 ? '+' : ''}{pct}%)
                                </div>
                              );
                            })()}
                          </div>
                          <button
                            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg flex items-center gap-1"
                            onClick={() => toggleExpand(asset.id)}
                          >
                            {expanded[asset.id] ? (
                              <>Holdings <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/></svg></>
                            ) : (
                              <>Holdings <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg></>
                            )}
                          </button>
                        </div>
                      ) : updatingBalance === asset.id ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number" step="0.01" className="input w-32 text-right"
                            value={balanceInput} onChange={e => setBalanceInput(e.target.value)} autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') saveBalance(asset.id); if (e.key === 'Escape') setUpdatingBalance(null); }}
                          />
                          <button className="btn-primary text-xs py-1" onClick={() => saveBalance(asset.id)}>Save</button>
                          <button className="btn-secondary text-xs py-1" onClick={() => setUpdatingBalance(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{formatCents(asset.current_balance_cents)}</span>
                          <button
                            className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg"
                            onClick={() => { setUpdatingBalance(asset.id); setBalanceInput((asset.current_balance_cents / 100).toFixed(2)); }}
                          >
                            Update
                          </button>
                        </div>
                      )}

                      <div className="flex gap-1 shrink-0">
                        <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1" onClick={() => setEditing(asset)}>Edit</button>
                        <button className="text-xs text-red-400 hover:text-red-600 px-2 py-1" onClick={() => archiveAsset(asset)}>Archive</button>
                      </div>
                    </div>
                  </div>

                  {/* Holdings panel, only for share portfolios */}
                  {asset.type === 'share_portfolio' && expanded[asset.id] && (
                    <HoldingsPanel portfolioId={asset.id} onBalanceUpdated={load} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <Modal title="Add asset" onClose={() => setShowAdd(false)}>
          <AssetForm
            onSave={async body => { await api.post('/accounts', body); toast.addToast('Asset added'); setShowAdd(false); load(); }}
            onClose={() => setShowAdd(false)}
          />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit asset" onClose={() => setEditing(null)}>
          <AssetForm
            initial={editing}
            onSave={async body => { await api.put(`/accounts/${editing.id}`, body); toast.addToast('Asset updated'); setEditing(null); load(); }}
            onClose={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
