import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents } from '../lib/utils';
import { Sk, SkCard } from '../components/Skeleton';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import CheckInModal from '../components/CheckInModal';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

export default function NetWorth() {
  const toast = useToast();
  const { resolvedTheme } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCheckin, setShowCheckin] = useState(false);

  const loadHistory = () => api.get('/checkin/history').then(h => setHistory(h.reverse())).catch(console.error);

  useEffect(() => {
    Promise.all([api.get('/accounts'), api.get('/checkin/history')])
      .then(([accs, hist]) => { setAccounts(accs); setHistory(hist.reverse()); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const types = [
    { key: 'cash',     label: 'Cash & bank',  types: ['transaction','savings','offset','credit_card'], color: '#3b82f6' },
    { key: 'super',    label: 'Super',         types: ['super'],                                       color: '#8b5cf6' },
    { key: 'property', label: 'Property',      types: ['property'],                                    color: '#f59e0b' },
    { key: 'shares',   label: 'Shares',        types: ['share_portfolio'],                             color: '#10b981' },
    { key: 'mortgage', label: 'Mortgage',      types: ['liability'],                                   color: '#ef4444', negate: true },
    { key: 'other',    label: 'Other assets',  types: ['other_asset'],                                 color: '#94a3b8' },
  ];

  const live = accounts.filter(a => a.include_in_net_worth && !a.archived);
  const netWorth = live.reduce((s, a) => s + (a.type === 'liability' ? -1 : 1) * Math.abs(a.current_balance_cents), 0);
  const breakdown = types
    .map(t => {
      const accs = live.filter(a => t.types.includes(a.type));
      const total = accs.reduce((s, a) => s + (t.negate ? -1 : 1) * Math.abs(a.current_balance_cents), 0);
      return { ...t, total, accounts: accs };
    })
    .filter(t => t.accounts.length);

  if (loading) return (
    <div className="space-y-6">
      <Sk w="w-28" h="h-6" />
      <SkCard className="text-center py-6 space-y-3">
        <Sk w="w-32 mx-auto" h="h-3" />
        <Sk w="w-48 mx-auto" h="h-10" />
      </SkCard>
      <SkCard className="space-y-3">
        <Sk w="w-24" h="h-4" />
        <Sk w="w-full" h="h-40" />
      </SkCard>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0,1,2,3].map(i => (
          <SkCard key={i} className="space-y-2">
            <div className="flex justify-between"><Sk w="w-24" h="h-4" /><Sk w="w-20" h="h-4" /></div>
            {[0,1].map(j => <div key={j} className="flex justify-between"><Sk w="w-28" h="h-3" /><Sk w="w-16" h="h-3" /></div>)}
          </SkCard>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-2">
        <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100 shrink-0">Net Worth</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/assets" className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline">Manage assets</Link>
          <Link to="/accounts" className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline">Manage accounts</Link>
          <button className="btn-primary shrink-0" onClick={() => setShowCheckin(true)}>
            Check in
          </button>
        </div>
      </div>

      <div className="card text-center py-8">
        <p className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Total net worth</p>
        <p className="text-4xl font-bold text-slate-800 dark:text-slate-100">{formatCents(netWorth)}</p>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">History</h2>
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history}>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: resolvedTheme === 'dark' ? '#94a3b8' : undefined }} />
              <YAxis tickFormatter={v => `$${(v / 100000).toFixed(0)}k`} tick={{ fontSize: 11, fill: resolvedTheme === 'dark' ? '#94a3b8' : undefined }} width={55} />
              <Tooltip
                formatter={v => formatCents(v)}
                contentStyle={resolvedTheme === 'dark'
                  ? { fontSize: 12, borderRadius: 8, background: '#1e293b', border: '1px solid #475569' }
                  : { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                labelStyle={resolvedTheme === 'dark' ? { color: '#f1f5f9' } : undefined}
                itemStyle={resolvedTheme === 'dark' ? { color: '#f1f5f9' } : undefined}
              />
              <Line type="monotone" dataKey="net_worth_cents" stroke="#10b981" strokeWidth={2} dot={false} name="Net worth" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-36 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
            Complete your first check-in to start building history
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {breakdown.map(group => (
          <div key={group.key} className="card">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: group.color }} />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{group.label}</h3>
              <span className={`ml-auto text-sm font-semibold ${group.total < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>
                {formatCents(group.total)}
              </span>
            </div>
            <div className="space-y-2">
              {group.accounts.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-600 dark:text-slate-300 truncate">{a.name}</span>
                  <span className={`font-medium shrink-0 ${a.type === 'liability' ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>
                    {formatCents(a.type === 'liability' ? -Math.abs(a.current_balance_cents) : a.current_balance_cents)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {breakdown.length === 0 && (
          <div className="card md:col-span-2 text-center py-10">
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">No accounts included in net worth yet.</p>
            <div className="flex gap-3 justify-center">
              <Link to="/accounts" className="btn-primary inline-flex">Add accounts</Link>
              <Link to="/assets" className="btn-secondary inline-flex">Add assets</Link>
            </div>
          </div>
        )}
      </div>

      {showCheckin && (
        <CheckInModal
          onClose={() => setShowCheckin(false)}
          onComplete={(res) => {
            toast.addToast(`Check-in recorded: net worth ${formatCents(res.net_worth_cents)}`);
            loadHistory();
          }}
        />
      )}
    </div>
  );
}
