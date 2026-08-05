import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents, formatMonth, currentMonth } from '../lib/utils';
import ProgressBar from '../components/ProgressBar';
import Modal from '../components/Modal';
import GuidePanel from '../components/GuidePanel';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import { Sk, SkCard } from '../components/Skeleton';

export default function Budget() {
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editBudget, setEditBudget] = useState(null);
  const [form, setForm] = useState({ category_id: '', amount: '', rollover: false });

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get(`/budgets/summary?month=${month}`),
      api.get('/categories'),
    ]).then(([s, cats]) => {
      setSummary(s);
      setCategories(cats);
    }).catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [month]);

  const saveBudget = async () => {
    const body = {
      category_id: Number(form.category_id),
      amount_cents: Math.round(parseFloat(form.amount) * 100),
      rollover: form.rollover ? 1 : 0,
      start_month: month,
    };
    try {
      if (editBudget) {
        await api.put(`/budgets/${editBudget.id}`, body);
        toast.addToast('Budget updated');
      } else {
        await api.post('/budgets', body);
        toast.addToast('Budget added');
      }
      setShowAdd(false);
      setEditBudget(null);
      setForm({ category_id: '', amount: '', rollover: false });
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const deleteBudget = async (b) => {
    const ok = await confirm({
      title: `Remove ${b.category_name} budget?`,
      message: 'This month\'s spending data is kept; only the budget target is removed.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.delete(`/budgets/${b.id}`);
    toast.addToast('Budget removed');
    load();
  };

  const expenseCats = categories.filter(c => c.kind === 'expense' && c.parent_id);
  // Income categories are budgetable too — an expected salary rather than a
  // spending cap — so the picker can't be expenses only any more.
  const incomeCats = categories.filter(c => c.kind === 'income' && c.parent_id);

  if (loading) return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Sk w="w-20" h="h-6 mr-auto" />
        <Sk w="w-32" h="h-8" />
        <Sk w="w-24" h="h-8" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[0,1,2].map(i => <SkCard key={i} className="space-y-2"><Sk w="w-24" h="h-3" /><Sk w="w-28" h="h-6" /></SkCard>)}
      </div>
      <SkCard className="space-y-4">
        {[0,1,2,3,4].map(i => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between"><Sk w="w-24" h="h-3" /><Sk w="w-20" h="h-3" /></div>
            <Sk w="w-full" h="h-2" />
          </div>
        ))}
      </SkCard>
    </div>
  );

  const s = summary?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100 mr-auto">Budget</h1>
        <input
          type="month"
          className="input w-36"
          value={month}
          onChange={e => setMonth(e.target.value)}
        />
        <button className="btn-primary" onClick={() => { setShowAdd(true); setEditBudget(null); setForm({ category_id: '', amount: '', rollover: false }); }}>
          + Add budget
        </button>
      </div>

      <GuidePanel storageKey="hl_budget_guide" title="How should I structure my budget?">
        <ol className="space-y-3 text-sm text-slate-600 dark:text-slate-300 list-decimal list-inside marker:text-slate-400 marker:font-semibold">
          <li>
            <strong className="text-slate-800 dark:text-slate-100">Categorise before you budget.</strong>{' '}
            Import a month or two of transactions and categorise them first over on the{' '}
            <Link to="/transactions" className="text-emerald-600 dark:text-emerald-400 hover:underline">Transactions</Link> page.
            You can't set a realistic groceries budget without knowing what you actually spend on groceries.
          </li>
          <li>
            <strong className="text-slate-800 dark:text-slate-100">Use rollover for irregular categories, leave it off for everyday ones.</strong>{' '}
            Turn on "Roll over unspent amount" for things that happen in lumps, like car maintenance or gifts.
            Leave it off for categories you want a fresh cap on every month, like groceries or dining out.
          </li>
          <li>
            <strong className="text-slate-800 dark:text-slate-100">Big irregular costs go in Goals, not Budget.</strong>{' '}
            Rates, insurance, and Christmas (anything that hits once or twice a year) work better as a sinking fund on the{' '}
            <Link to="/goals" className="text-emerald-600 dark:text-emerald-400 hover:underline">Goals</Link> page. It tells you exactly how
            much to set aside each month so the big bill never surprises you.
          </li>
          <li>
            <strong className="text-slate-800 dark:text-slate-100">Then use Transfers to act on it.</strong>{' '}
            Once your budget and sinking funds are set, the{' '}
            <Link to="/transfers" className="text-emerald-600 dark:text-emerald-400 hover:underline">Transfer Planner</Link> tells you exactly
            what to move to each account at the start of the month: bills account, savings, wherever it needs to go.
          </li>
        </ol>
      </GuidePanel>

      {/* Summary bar */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card">
            <p className="label">Income</p>
            <p className="text-xl font-semibold text-emerald-600 dark:text-emerald-400">{formatCents(s.total_income_cents)}</p>
          </div>
          <div className="card">
            <p className="label">Spent</p>
            {/* Every expense this month, not just the ones inside a budgeted
                category — total_spent_cents only counts budgeted categories,
                so it reads $0 before any budget exists and understates the
                rest of the time. "Safe to spend" nets off this same figure. */}
            <p className="text-xl font-semibold text-slate-800 dark:text-slate-100">{formatCents(s.total_spend_cents)}</p>
            {s.total_budgeted_cents > 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                {formatCents(s.total_spent_cents)} in budgeted categories
              </p>
            )}
          </div>
          <div className="card">
            <p className="label">Budgeted</p>
            <p className="text-xl font-semibold text-slate-800 dark:text-slate-100">{formatCents(s.total_budgeted_cents)}</p>
          </div>
          <div className="card">
            <p className="label">Safe to spend</p>
            <p className={`text-xl font-semibold ${s.safe_to_spend_cents >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
              {formatCents(s.safe_to_spend_cents)}
            </p>
            {/* Without this the figure is unexplainable — it's income minus
                what the budgets still commit you to, minus spending no budget
                covers, and those two are different things. */}
            {s.unbudgeted_spend_cents > 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                after {formatCents(s.unbudgeted_spend_cents)} unbudgeted
              </p>
            )}
          </div>
        </div>
      )}

      {/* Income sits above the spending, because what came in is what the
          rest of the page is dividing up. Read the other way round to an
          expense budget: received against expected, and beating the target
          is good rather than an overspend. */}
      {(summary?.income_budgets?.length > 0 || summary?.unbudgeted_income?.length > 0) && (
        <>
          <div className="flex items-baseline gap-3 pt-2">
            <h2 className="font-serif text-lg font-semibold text-slate-800 dark:text-slate-100">Income</h2>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {formatCents(s.total_income_cents)} received
              {s.total_income_budgeted_cents > 0 && <> of {formatCents(s.total_income_budgeted_cents)} expected</>}
            </span>
          </div>
          <div className="card p-0 divide-y divide-slate-50 dark:divide-slate-800">
            {summary.income_budgets.map(b => {
              const short = b.received_cents < b.expected_cents;
              return (
                <div key={b.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.category_color || '#94a3b8' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{b.category_name}</span>
                      <div className="flex items-center gap-4 text-sm">
                        <span className={short ? 'text-slate-600 dark:text-slate-300' : 'text-emerald-600 dark:text-emerald-400 font-medium'}>
                          {formatCents(b.received_cents)}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500">/</span>
                        <span className="text-slate-500 dark:text-slate-400">{formatCents(b.expected_cents)}</span>
                      </div>
                    </div>
                    {/* Capped at the target so the bar fills rather than
                        turning red — exceeding expected income is a good month. */}
                    <ProgressBar value={Math.min(b.received_cents, b.expected_cents)} max={b.expected_cents} showLabel />
                    {short && b.remaining_cents > 0 && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        {formatCents(b.remaining_cents)} still expected
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {/* The only way to see which transactions produced the
                        figure — without it an unexpected total can't be
                        traced back to the rows behind it. */}
                    <Link
                      className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                      to={`/transactions?category_id=${b.category_id}&budget_month=${month}`}
                    >
                      Review
                    </Link>
                    <button
                      className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                      onClick={() => { setEditBudget(b); setForm({ category_id: b.category_id, amount: (b.expected_cents / 100).toFixed(2), rollover: !!b.rollover }); setShowAdd(true); }}
                    >
                      Edit
                    </button>
                    <button className="text-xs text-red-400 hover:text-red-600 px-2 py-1" onClick={() => deleteBudget(b)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}

            {summary.unbudgeted_income.map(u => (
              <div key={u.category_id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: u.category_color || '#94a3b8' }} />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100 flex-1 min-w-0 truncate">
                  {u.category_name}
                  <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">not expected</span>
                </span>
                <span className="text-sm text-emerald-600 dark:text-emerald-400 shrink-0">{formatCents(u.received_cents)}</span>
                <div className="flex gap-1 shrink-0">
                  <button
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline px-2 py-1"
                    onClick={() => {
                      setEditBudget(null);
                      setForm({ category_id: String(u.category_id), amount: (u.received_cents / 100).toFixed(2), rollover: false });
                      setShowAdd(true);
                    }}
                  >
                    Set expected
                  </button>
                  <Link
                    className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                    to={`/transactions?category_id=${u.category_id}&budget_month=${month}`}
                  >
                    Review
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Budget rows */}
      <h2 className="font-serif text-lg font-semibold text-slate-800 dark:text-slate-100 pt-2">Budgeted</h2>
      <div className="card p-0 divide-y divide-slate-50 dark:divide-slate-800">
        {summary?.budgets.length === 0 ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
            No budgets for {formatMonth(month)}. Add one to get started.
          </div>
        ) : (
          summary?.budgets.map(b => {
            const over = b.spent_cents > b.amount_cents;
            return (
              <div key={b.id} className="px-5 py-4 flex items-center gap-4">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: b.category_color || '#94a3b8' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{b.category_name}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className={over ? 'text-red-600 dark:text-red-400 font-medium' : 'text-slate-600 dark:text-slate-300'}>
                        {formatCents(b.spent_cents)}
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">/</span>
                      <span className="text-slate-500 dark:text-slate-400">{formatCents(b.amount_cents)}</span>
                    </div>
                  </div>
                  <ProgressBar value={b.spent_cents} max={b.amount_cents} showLabel />
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link
                    className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                    to={`/transactions?category_id=${b.category_id}&budget_month=${month}`}
                  >
                    Review
                  </Link>
                  <button
                    className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                    onClick={() => { setEditBudget(b); setForm({ category_id: b.category_id, amount: (b.amount_cents / 100).toFixed(2), rollover: !!b.rollover }); setShowAdd(true); }}
                  >
                    Edit
                  </button>
                  <button className="text-xs text-red-400 hover:text-red-600 px-2 py-1" onClick={() => deleteBudget(b)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Everything spent this month that no budget covers. A total alone
          can't be acted on — each line is either a category that wants a
          budget, or transactions sitting in the wrong category. */}
      {summary?.unbudgeted?.length > 0 && (
        <>
          <div className="flex items-baseline gap-3 pt-2">
            <h2 className="font-serif text-lg font-semibold text-slate-800 dark:text-slate-100">Unbudgeted</h2>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {formatCents(summary.summary.unbudgeted_spend_cents)} across {summary.unbudgeted.length} categor{summary.unbudgeted.length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          <div className="card p-0 divide-y divide-slate-50 dark:divide-slate-800">
            {summary.unbudgeted.map(u => (
              <div key={u.category_id ?? 'uncategorised'} className="px-5 py-3 flex items-center gap-4">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: u.category_color || '#94a3b8' }}
                />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100 flex-1 min-w-0 truncate">
                  {u.category_name}
                </span>
                <span className="text-sm text-slate-600 dark:text-slate-300 shrink-0">{formatCents(u.spent_cents)}</span>
                <div className="flex gap-1 shrink-0">
                  {/* Uncategorised has no category to budget — it needs
                      sorting on the transactions page instead. */}
                  {u.category_id && (
                    <button
                      className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline px-2 py-1"
                      onClick={() => {
                        setEditBudget(null);
                        setForm({ category_id: String(u.category_id), amount: (u.spent_cents / 100).toFixed(2), rollover: false });
                        setShowAdd(true);
                      }}
                    >
                      Add budget
                    </button>
                  )}
                  <Link
                    className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                    to={u.category_id
                      ? `/transactions?category_id=${u.category_id}&budget_month=${month}`
                      : `/transactions?needs_review=true&budget_month=${month}`}
                  >
                    Review
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(showAdd || editBudget) && (
        <Modal title={editBudget ? 'Edit budget' : 'Add budget'} onClose={() => { setShowAdd(false); setEditBudget(null); }}>
          <div className="space-y-4">
            {!editBudget && (
              <div>
                <label className="label">Category</label>
                <select className="input" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                  <option value="">Select…</option>
                  <optgroup label="Expense">
                    {expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="Income">
                    {incomeCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                </select>
              </div>
            )}
            <div>
              <label className="label">Monthly amount ($)</label>
              <input type="number" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" step="1" min="0" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.rollover} onChange={e => setForm(f => ({ ...f, rollover: e.target.checked }))} className="rounded" />
              Roll over unspent amount each month
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-secondary" onClick={() => { setShowAdd(false); setEditBudget(null); }}>Cancel</button>
              <button className="btn-primary" onClick={saveBudget} disabled={!form.category_id || !form.amount}>Save</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
