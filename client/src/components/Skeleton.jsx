export function Sk({ w = 'w-full', h = 'h-4', className = '' }) {
  return <div className={`skeleton ${w} ${h} ${className}`} />;
}

export function SkCard({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>;
}

// Preset skeletons for common patterns
export function SkStatCards() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[0,1,2,3].map(i => (
        <SkCard key={i} className="space-y-3">
          <Sk w="w-24" h="h-3" />
          <Sk w="w-32" h="h-7" />
          <Sk w="w-20" h="h-3" />
        </SkCard>
      ))}
    </div>
  );
}

export function SkTableRows({ cols = 5, rows = 8 }) {
  return (
    <div className="divide-y divide-slate-50 dark:divide-slate-800">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }, (_, j) => (
            <Sk key={j} w={j === 0 ? 'w-20' : j === cols - 1 ? 'w-16' : 'flex-1'} h="h-3" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkList({ rows = 4 }) {
  return (
    <div className="divide-y divide-slate-50 dark:divide-slate-800">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Sk w="w-9 h-9 rounded-full shrink-0" h="h-9" className="rounded-full" />
          <div className="flex-1 space-y-2">
            <Sk w="w-32" h="h-3.5" />
            <Sk w="w-48" h="h-3" />
          </div>
          <Sk w="w-20" h="h-3" />
        </div>
      ))}
    </div>
  );
}
