import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { formatCents } from '../lib/utils';

const TYPE_GROUPS = [
  { key: 'cash',      label: 'Cash & bank',   types: ['transaction','savings','offset','credit_card'] },
  { key: 'super',     label: 'Super',          types: ['super'] },
  { key: 'property',  label: 'Property',       types: ['property'] },
  { key: 'shares',    label: 'Shares',         types: ['share_portfolio'] },
  { key: 'other',     label: 'Other assets',   types: ['other_asset'] },
  { key: 'liability', label: 'Liabilities',    types: ['liability'] },
];

function centsToDisplay(cents) {
  return ((cents ?? 0) / 100).toFixed(2);
}
function displayToCents(str) {
  const n = parseFloat(str.replace(/,/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}
function minutesAgo(isoString) {
  if (!isoString) return null;
  const mins = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

function HoldingsTable({ holdings }) {
  if (!holdings?.length) return (
    <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">No holdings recorded. Add them in Assets.</p>
  );

  const anyError = holdings.some(h => h.price_error && !h.current_price_cents);
  return (
    <div className="mt-2 rounded-lg border border-slate-100 dark:border-slate-700 overflow-hidden">
      {anyError && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-100 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          Could not fetch live prices, showing last known values
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
            <th className="px-3 py-2 text-left font-medium">Ticker</th>
            <th className="px-3 py-2 text-right font-medium">Units</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {holdings.map(h => {
            const value = Math.round((h.units ?? 0) * (h.current_price_cents ?? 0));
            return (
              <tr key={h.id} className="text-slate-700 dark:text-slate-200">
                <td className="px-3 py-2 font-medium">
                  {h.ticker}
                  {h.exchange && h.exchange !== 'ASX' && (
                    <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">{h.exchange}</span>
                  )}
                  {h.price_stale && h.current_price_cents == null && (
                    <span className="ml-1 text-amber-500">?</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{(h.units ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 4 })}</td>
                <td className="px-3 py-2 text-right">
                  {h.current_price_cents != null
                    ? formatCents(h.current_price_cents)
                    : <span className="text-slate-400 dark:text-slate-500">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-medium">{value ? formatCents(value) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({ account, value, onChange }) {
  const isPortfolio = account.type === 'share_portfolio';
  const [expanded, setExpanded] = useState(isPortfolio);

  const mostRecentUpdate = account.holdings?.reduce((latest, h) => {
    if (!h.price_updated_at) return latest;
    return !latest || h.price_updated_at > latest ? h.price_updated_at : latest;
  }, null);

  return (
    <div className="py-3 border-b border-slate-50 dark:border-slate-800 last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{account.name}</span>
            {account.institution && (
              <span className="text-xs text-slate-400 dark:text-slate-500 truncate">{account.institution}</span>
            )}
          </div>
          {isPortfolio && mostRecentUpdate && (
            <div className="flex items-center gap-1 mt-0.5">
              <svg className="w-3 h-3 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
              </svg>
              <span className="text-xs text-slate-400 dark:text-slate-500">Yahoo Finance · {minutesAgo(mostRecentUpdate)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isPortfolio && account.holdings?.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              {expanded ? 'Hide' : 'Show'} holdings
            </button>
          )}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input pl-6 w-36 text-right text-sm"
              value={value}
              onChange={e => onChange(e.target.value)}
            />
          </div>
        </div>
      </div>
      {isPortfolio && expanded && <HoldingsTable holdings={account.holdings} />}
    </div>
  );
}

export default function CheckInModal({ onClose, onComplete }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [todayDone, setTodayDone] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/checkin/prefill');
      setTodayDone(data.today_checkin_exists);
      setAccounts(data.accounts);
      const init = {};
      for (const acc of data.accounts) {
        const balance = acc.type === 'share_portfolio' && acc.computed_balance_cents != null
          ? acc.computed_balance_cents
          : acc.current_balance_cents;
        // Liabilities are stored as negative; show as positive in the input (sign handled in netWorth calc)
        init[acc.id] = centsToDisplay(acc.type === 'liability' ? Math.abs(balance) : balance);
      }
      setBalances(init);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setBalance = (id, val) => setBalances(b => ({ ...b, [id]: val }));

  const netWorth = accounts.reduce((sum, acc) => {
    const cents = displayToCents(balances[acc.id] ?? '0');
    return sum + (acc.type === 'liability' ? -Math.abs(cents) : cents);
  }, 0);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const balanceCents = {};
      for (const [id, val] of Object.entries(balances)) {
        balanceCents[id] = displayToCents(val);
      }
      const res = await api.post('/checkin', { notes, balances: balanceCents });
      onComplete?.(res);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const groups = TYPE_GROUPS.map(g => ({
    ...g,
    accounts: accounts.filter(a => g.types.includes(a.type)),
  })).filter(g => g.accounts.length);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 w-full rounded-t-lg sm:rounded-lg sm:max-w-xl shadow-2xl flex flex-col max-h-[92dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Monthly check-in</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Review and confirm your account balances</p>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 -mr-1 text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Fetching live prices…</p>
            </div>
          )}

          {!loading && error && !todayDone && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {!loading && todayDone && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-100 px-4 py-3 text-sm text-amber-800">
              You've already recorded a check-in today. Come back tomorrow!
            </div>
          )}

          {!loading && !todayDone && !error && (
            <div className="space-y-5">
              {groups.map(group => (
                <div key={group.key}>
                  <h3 className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">{group.label}</h3>
                  <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3">
                    {group.accounts.map(acc => (
                      <AccountRow
                        key={acc.id}
                        account={acc}
                        value={balances[acc.id] ?? ''}
                        onChange={val => setBalance(acc.id, val)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {accounts.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                  No accounts are marked as "include in net worth" yet.
                </p>
              )}

              <div>
                <label className="label">Notes (optional)</label>
                <input
                  type="text"
                  className="input"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Annual bonus received"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !todayDone && (
          <div className="shrink-0 border-t border-slate-100 dark:border-slate-700 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-500 dark:text-slate-400">Net worth after check-in</span>
              <span className={`text-base font-bold ${netWorth < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {formatCents(netWorth)}
              </span>
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
            )}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary flex-1 justify-center"
                onClick={handleSubmit}
                disabled={saving || accounts.length === 0}
              >
                {saving ? 'Saving…' : 'Complete check-in'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
