import { useState } from 'react';

export default function GuidePanel({ storageKey, title, children }) {
  const [open, setOpen] = useState(() => localStorage.getItem(storageKey) !== 'closed');

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(storageKey, next ? 'open' : 'closed');
  };

  return (
    <div className="card">
      <button onClick={toggle} className="w-full flex items-center gap-3 text-left">
        <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6M10 22h4M12 2a6 6 0 00-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0012 2z" />
          </svg>
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</span>
        <svg
          className={`w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
          {children}
        </div>
      )}
    </div>
  );
}
