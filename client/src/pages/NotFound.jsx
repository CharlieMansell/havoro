import { Link, useLocation } from 'react-router-dom';

export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-emerald-600 dark:text-emerald-400 mb-2 tracking-tight">404</div>

        <h1 className="font-serif text-2xl font-bold text-slate-800 dark:text-slate-100 mb-3">
          Page not in budget
        </h1>

        <p className="text-slate-500 dark:text-slate-400 mb-6">
          We've checked every account, run the numbers twice, and{' '}
          <span className="font-mono bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-1.5 py-0.5 rounded text-sm">{pathname}</span>{' '}
          is nowhere to be found. It may have been an impulse purchase.
        </p>

        <div className="card text-left mb-6 font-mono text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <div className="flex justify-between"><span>PAGE REQUESTED</span><span className="text-red-400">NOT FOUND</span></div>
          <div className="flex justify-between"><span>BUDGET ALLOCATED</span><span>$0.00</span></div>
          <div className="flex justify-between"><span>CATEGORY</span><span>Uncategorised</span></div>
          <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-200 pt-1 border-t border-slate-100 dark:border-slate-700"><span>STATUS</span><span className="text-red-500">DECLINED</span></div>
        </div>

        <Link to="/dashboard" className="btn-primary inline-flex">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
