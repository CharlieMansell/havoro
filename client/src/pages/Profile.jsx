import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export default function Profile() {
  const { user, logout, refreshUser, isElectron } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name || '');
  const [nameSaving, setNameSaving] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);

  const saveName = async () => {
    if (!name.trim()) return;
    setNameSaving(true);
    try {
      await api.put('/auth/profile', { name: name.trim() });
      await refreshUser();
      toast.addToast('Name updated');
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setNameSaving(false);
    }
  };

  const savePassword = async () => {
    if (pw.next !== pw.confirm) { toast.addToast('New passwords do not match', 'error'); return; }
    if (pw.next.length < 8) { toast.addToast('Password must be at least 8 characters', 'error'); return; }
    setPwSaving(true);
    try {
      await api.post('/auth/change-password', { current_password: pw.current, new_password: pw.next });
      toast.addToast('Password changed');
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setPwSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = (user?.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100">Profile</h1>

      {/* Avatar + identity */}
      <div className="card flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center text-xl font-bold shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{user?.name}</p>
          {!isElectron && <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>}
          {!isElectron && user?.is_admin && (
            <span className="mt-1 inline-block text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded font-medium">Admin</span>
          )}
        </div>
      </div>

      {/* Edit name */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Display name</h2>
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); }}
          />
          <button
            className="btn-primary shrink-0"
            onClick={saveName}
            disabled={nameSaving || !name.trim() || name.trim() === user?.name}
          >
            {nameSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Change password — not applicable on desktop, there's no password to change */}
      {!isElectron && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Change password</h2>
          <div>
            <label className="label">Current password</label>
            <input
              type="password"
              className="input"
              value={pw.current}
              onChange={e => setPw(p => ({ ...p, current: e.target.value }))}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">New password</label>
            <input
              type="password"
              className="input"
              value={pw.next}
              onChange={e => setPw(p => ({ ...p, next: e.target.value }))}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input
              type="password"
              className="input"
              value={pw.confirm}
              onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
              autoComplete="new-password"
            />
          </div>
          <button
            className="btn-primary"
            onClick={savePassword}
            disabled={pwSaving || !pw.current || !pw.next}
          >
            {pwSaving ? 'Saving…' : 'Update password'}
          </button>
        </div>
      )}

      {/* Sign out — not applicable on desktop, there's no login screen to return to */}
      {!isElectron && (
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Session</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Signing out removes your session cookie. You'll need to log in again on this device.
          </p>
          <button
            className="btn w-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium"
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
