import { useState, useEffect } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

// Consistent 20×20 SVG icons — all use stroke="currentColor" at strokeWidth 1.5
const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  transactions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
    </svg>
  ),
  budget: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
    </svg>
  ),
  goals: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>
    </svg>
  ),
  networth: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
    </svg>
  ),
  accounts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
    </svg>
  ),
  assets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>
    </svg>
  ),
  import: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  transfers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4"/>
    </svg>
  ),
  signout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
    </svg>
  ),
};

const nav = [
  { to: '/dashboard',    label: 'Dashboard',   icon: icons.dashboard    },
  { to: '/transactions', label: 'Transactions', icon: icons.transactions },
  { to: '/budget',       label: 'Budget',       icon: icons.budget       },
  { to: '/goals',        label: 'Goals',        icon: icons.goals        },
  { to: '/transfers',   label: 'Transfers',    icon: icons.transfers    },
  { to: '/net-worth',    label: 'Net Worth',    icon: icons.networth     },
  { to: '/accounts',     label: 'Accounts',     icon: icons.accounts     },
  { to: '/assets',       label: 'Assets',       icon: icons.assets       },
  { to: '/import',       label: 'Import',       icon: icons.import       },
  { to: '/settings',     label: 'Settings',     icon: icons.settings     },
];

function NavItem({ to, label, icon, badge }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100'
        }`
      }
    >
      <span className="w-5 h-5 shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 dark:text-amber-400 text-xs font-semibold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { user, logout, isElectron } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [needsReview, setNeedsReview] = useState(0);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Refresh the needs-review count on every navigation so the badge
  // updates after imports and categorisation without a full reload
  useEffect(() => {
    api.get('/transactions/needs-review/count')
      .then(r => setNeedsReview(r.count))
      .catch(() => {});
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = (user?.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="Havoro" className="w-7 h-7" />
          <span className="text-base font-semibold text-slate-800 dark:text-slate-100">Havoro</span>
        </div>
        <button
          className="md:hidden text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
        {nav.map(item => (
          <NavItem key={item.to} {...item} badge={item.to === '/transactions' ? needsReview : 0} />
        ))}
        {!isElectron && user?.is_admin && <NavItem to="/users" label="Users" icon={icons.users} />}
      </nav>

      <div className="p-3 border-t border-slate-100 dark:border-slate-700 space-y-0.5">
        <Link
          to="/profile"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{user?.name}</div>
            {!isElectron && <div className="text-xs text-slate-400 dark:text-slate-500 truncate">{user?.email}</div>}
          </div>
        </Link>
        {!isElectron && (
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <span className="w-5 h-5 shrink-0">{icons.signout}</span>
            <span className="text-sm">Sign out</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-dvh flex bg-slate-50 dark:bg-slate-900">
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-700 fixed inset-y-0 left-0 z-30">
        {sidebar}
      </aside>

      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}

      <aside className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-800 shadow-xl transform transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        {sidebar}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col md:pl-56">
        <header className="md:hidden sticky top-0 z-20 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setOpen(true)} className="text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 p-1 -m-1" aria-label="Open menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="Havoro" className="w-6 h-6" />
            <span className="text-base font-semibold text-slate-800 dark:text-slate-100">Havoro</span>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {children}
          </div>
          <div style={{ height: 'env(safe-area-inset-bottom)' }} />
        </main>
      </div>
    </div>
  );
}
