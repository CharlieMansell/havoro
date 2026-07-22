import { createContext, useContext, useState, useEffect } from 'react';
import { CSRF_HEADERS } from '../lib/api';

const AuthContext = createContext(null);

// Electron sets its own token in the default UA string unless overridden, which
// this app doesn't do — safe, standard way to tell "running as the desktop app"
// apart from the browser/PWA/self-hosted cases.
const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

const THEME_KEY = 'havoro-theme';
const prefersDarkMedia = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolveTheme(theme) {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return prefersDarkMedia?.matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [needsSetup, setNeedsSetup] = useState(undefined);
  const [theme, setThemeState] = useState(() => localStorage.getItem(THEME_KEY) || 'system');
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(theme));

  // Re-apply whenever the theme choice changes, and track system preference
  // changes live while the choice is "system" (theme-init.js only runs once,
  // before mount). resolvedTheme is the actual light/dark in effect right
  // now — for JS-driven styling (e.g. chart colors) that can't use Tailwind's
  // `dark:` variant.
  useEffect(() => {
    applyTheme(theme);
    setResolvedTheme(resolveTheme(theme));
    if (theme !== 'system' || !prefersDarkMedia) return;
    const onChange = () => { applyTheme(theme); setResolvedTheme(resolveTheme(theme)); };
    prefersDarkMedia.addEventListener('change', onChange);
    return () => prefersDarkMedia.removeEventListener('change', onChange);
  }, [theme]);

  // The account's saved theme (once loaded) is the source of truth — sync
  // local/device state to it so the choice follows you across devices.
  useEffect(() => {
    if (user?.theme && user.theme !== theme) {
      setThemeState(user.theme);
      localStorage.setItem(THEME_KEY, user.theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.theme]);

  const setTheme = async (next) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    if (user) {
      await fetch('/api/auth/theme', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
        body: JSON.stringify({ theme: next }),
      }).catch(() => {});
    }
  };

  useEffect(() => {
    (async () => {
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (meRes.ok) { setUser(await meRes.json()); setNeedsSetup(false); return; }

      const setupRes = await fetch('/api/auth/needs-setup');
      const { needsSetup: needs } = await setupRes.json();
      setNeedsSetup(needs);

      if (!needs && isElectron) {
        // Desktop, account already exists, just no valid cookie (e.g. first
        // launch after the 7-day session expired) — sign back in silently.
        const localRes = await fetch('/api/auth/local-login', { method: 'POST', credentials: 'include', headers: CSRF_HEADERS });
        if (localRes.ok) setUser(await localRes.json());
        else setUser(null);
        return;
      }
      setUser(null);
    })().catch(() => { setUser(null); setNeedsSetup(false); });
  }, []);

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setUser(data);
    return data;
  };

  // Desktop first run — just a first name, no password (see routes/auth.js local-setup)
  const completeLocalSetup = async (name) => {
    const res = await fetch('/api/auth/local-setup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setNeedsSetup(false);
    setUser(data);
    return data;
  };

  // Server/self-hosted first run — this is what creates the one admin account
  const completeSetup = async (name, email, password) => {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setNeedsSetup(false);
    setUser(data);
    return data;
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: CSRF_HEADERS });
    setUser(null);
  };

  const refreshUser = async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) { const u = await res.json(); setUser(u); return u; }
  };

  return (
    <AuthContext.Provider value={{ user, needsSetup, isElectron, theme, resolvedTheme, setTheme, login, completeLocalSetup, completeSetup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
