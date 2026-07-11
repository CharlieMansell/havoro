export default function ProgressBar({ value, max, color = 'emerald', showLabel = false }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const over = pct >= 100;
  const barColor = over
    ? 'bg-red-500'
    : color === 'emerald' ? 'bg-emerald-500'
    : color === 'blue' ? 'bg-blue-500'
    : 'bg-slate-400';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className={`text-xs font-medium w-8 text-right ${over ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
          {pct}%
        </span>
      )}
    </div>
  );
}
