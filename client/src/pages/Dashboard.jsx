import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents, formatMonth, currentMonth } from '../lib/utils';
import { StatCard } from '../components/Card';
import ProgressBar from '../components/ProgressBar';
import { Sk, SkCard, SkStatCards } from '../components/Skeleton';
import GettingStartedCard from '../components/GettingStartedCard';
import { useAuth } from '../contexts/AuthContext';
import { LineChart, Line, Tooltip, ResponsiveContainer, XAxis } from 'recharts';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Sk w="w-40" h="h-6" className="mb-2" />
        <Sk w="w-56" h="h-4" />
      </div>
      <SkStatCards />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SkCard className="lg:col-span-2 space-y-3">
          <Sk w="w-32" h="h-4" />
          <Sk w="w-full" h="h-36" />
        </SkCard>
        <SkCard className="space-y-3">
          <Sk w="w-28" h="h-4" />
          {[0,1,2,3].map(i => (
            <div key={i} className="flex justify-between items-center">
              <Sk w="w-24" h="h-3" />
              <Sk w="w-20" h="h-3" />
            </div>
          ))}
        </SkCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkCard className="space-y-3">
          <Sk w="w-28" h="h-4" />
          {[0,1,2,3].map(i => <Sk key={i} w="w-full" h="h-3" />)}
        </SkCard>
        <SkCard className="space-y-4">
          <Sk w="w-36" h="h-4" />
          {[0,1].map(i => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between">
                <Sk w="w-24" h="h-3" />
                <Sk w="w-20" h="h-3" />
              </div>
              <Sk w="w-full" h="h-2" />
            </div>
          ))}
        </SkCard>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, resolvedTheme } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/summary')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (!data) return null;

  const savingsRateColor = data.savings_rate >= 20 ? 'text-emerald-600 dark:text-emerald-400' : data.savings_rate >= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500';
  const firstName = user?.name?.trim().split(' ')[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100">{formatMonth(currentMonth())}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{firstName ? `${greeting()}, ${firstName}.` : "Here's where things stand"}</p>
        </div>
        {data.needs_review_count > 0 && (
          <Link to="/transactions?needs_review=true" className="btn bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100 text-sm">
            {data.needs_review_count} transactions need a category
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Net Worth"
          value={formatCents(data.net_worth_cents)}
          delta={data.net_worth_delta_cents != null ? formatCents(data.net_worth_delta_cents, { signed: true }) : undefined}
          sub={data.net_worth_delta_cents != null ? 'since last check-in' : 'no check-ins yet'}
        />
        <StatCard label="Income this month" value={formatCents(data.month_income_cents)} />
        <StatCard label="Spent this month" value={formatCents(data.month_expenses_cents)} />
        <div className="card">
          <p className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Savings rate</p>
          <p className={`text-2xl font-semibold ${savingsRateColor}`}>{data.savings_rate}%</p>
          <p className="text-sm mt-1 text-slate-400 dark:text-slate-500">of income saved</p>
        </div>
      </div>

      <GettingStartedCard setup={data.setup} needsReviewCount={data.needs_review_count} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Net worth history</h2>
          {data.net_worth_history?.length > 1 ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={data.net_worth_history}>
                <XAxis dataKey="date" hide />
                <Tooltip
                  formatter={v => formatCents(v)}
                  labelFormatter={l => l}
                  contentStyle={resolvedTheme === 'dark'
                    ? { fontSize: 12, borderRadius: 8, background: '#1e293b', border: '1px solid #475569' }
                    : { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  labelStyle={resolvedTheme === 'dark' ? { color: '#f1f5f9' } : undefined}
                  itemStyle={resolvedTheme === 'dark' ? { color: '#f1f5f9' } : undefined}
                />
                <Line type="monotone" dataKey="net_worth" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-32 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
              Complete your first check-in to start tracking history
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Asset breakdown</h2>
          <div className="space-y-2">
            {data.asset_breakdown?.map(item => (
              <div key={item.asset_class} className="flex items-center justify-between">
                <span className="text-sm capitalize text-slate-600 dark:text-slate-300">{item.asset_class}</span>
                <span className={`text-sm font-medium ${item.balance < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>
                  {formatCents(item.balance)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Top spending</h2>
            <Link to="/budget" className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">View budget</Link>
          </div>
          {data.top_categories?.length ? (
            <div className="space-y-3">
              {data.top_categories.map(cat => (
                <div key={cat.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: cat.color || '#94a3b8' }} />
                      <span className="text-sm text-slate-700 dark:text-slate-200">{cat.name}</span>
                    </div>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{formatCents(cat.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">No transactions this month</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Goals & sinking funds</h2>
          </div>
          {data.goals?.length ? (
            <div className="space-y-4">
              {data.goals.map(goal => (
                <div key={goal.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-700 dark:text-slate-200">{goal.name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatCents(goal.current_amount_cents)} / {formatCents(goal.target_amount_cents)}
                    </span>
                  </div>
                  <ProgressBar value={goal.current_amount_cents} max={goal.target_amount_cents} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">No goals set up yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
