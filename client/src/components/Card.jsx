export function Card({ children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, delta, color = 'slate' }) {
  const deltaColor = delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-red-500' : 'text-slate-400 dark:text-slate-500';
  const deltaSign = delta > 0 ? '+' : '';
  return (
    <div className="card">
      <p className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{value}</p>
      {(sub || delta !== undefined) && (
        <p className="text-sm mt-1 text-slate-500 dark:text-slate-400">
          {sub}
          {delta !== undefined && (
            <span className={`ml-2 ${deltaColor}`}>{deltaSign}{delta}</span>
          )}
        </p>
      )}
    </div>
  );
}
