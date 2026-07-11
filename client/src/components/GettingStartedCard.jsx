import { useState } from 'react';
import { Link } from 'react-router-dom';

const DISMISS_KEY = 'hl_getting_started_dismissed';

const STEPS = [
  { key: 'accounts',       label: 'Add your accounts',            hint: 'Bank, super, property, shares: whatever you want to track',  to: '/accounts' },
  { key: 'transactions',   label: 'Import your first bank CSV',   hint: 'Export a statement from your bank and drop it in',           to: '/import' },
  { key: 'categorised',    label: 'Categorise your transactions', hint: 'Tag each one so spending shows up in the right place',       to: '/transactions' },
  { key: 'budgets',        label: 'Set up your budget',           hint: 'Give each category a monthly target',                        to: '/budget' },
  { key: 'transfer_plans', label: 'Plan your monthly transfers',  hint: 'Know exactly what to move to each account, every month',      to: '/transfers' },
];

export default function GettingStartedCard({ setup, needsReviewCount }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  if (!setup || dismissed) return null;

  const done = {
    accounts:       setup.accounts > 0,
    transactions:   setup.transactions > 0,
    categorised:    setup.transactions > 0 && needsReviewCount === 0,
    budgets:        setup.budgets > 0,
    transfer_plans: setup.transfer_plans > 0,
  };

  const doneCount = STEPS.filter(s => done[s.key]).length;
  if (doneCount === STEPS.length) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="card relative">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-slate-300 dark:text-slate-600 hover:text-slate-500 p-1"
        aria-label="Dismiss getting started checklist"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Getting started</h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">{doneCount} of {STEPS.length} done</span>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Set up Havoro in this order for the smoothest start.</p>

      <div className="space-y-1">
        {STEPS.map((step, i) => {
          const isDone = done[step.key];
          return (
            <Link
              key={step.key}
              to={step.to}
              className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isDone ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 group-hover:bg-slate-200'
                }`}
              >
                {isDone ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${isDone ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200 font-medium'}`}>
                  {step.label}
                </p>
                {!isDone && <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{step.hint}</p>}
              </div>
              {!isDone && (
                <svg className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
