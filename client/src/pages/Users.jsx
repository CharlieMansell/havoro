import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import { SkList } from '../components/Skeleton';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ROLE_LABELS = { admin: 'Admin', member: 'Member' };

function RoleBadge({ role }) {
  return role === 'admin'
    ? <span className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">Admin</span>
    : <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-medium">Member</span>;
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [editRoleUser, setEditRoleUser] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const [resetPassword, setResetPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/users').then(setUsers).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const createUser = async () => {
    if (!form.name || !form.email || !form.password) return;
    setSaving(true);
    try {
      await api.post('/users', form);
      toast.addToast(`Account created for ${form.name}`);
      setShowAdd(false);
      setForm({ name: '', email: '', password: '', role: 'member' });
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (user, role) => {
    try {
      await api.put(`/users/${user.id}`, { role });
      toast.addToast(`${user.name} is now ${ROLE_LABELS[role]}`);
      setEditRoleUser(null);
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const deleteUser = async (user) => {
    const ok = await confirm({
      title: `Remove ${user.name}?`,
      message: 'This will delete their account. They will no longer be able to sign in.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.addToast(`${user.name} removed`);
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const doReset = async () => {
    if (!resetPassword || resetPassword.length < 8) {
      toast.addToast('Password must be at least 8 characters', 'error');
      return;
    }
    try {
      await api.put(`/users/${resetUser.id}`, { new_password: resetPassword });
      toast.addToast(`Password updated for ${resetUser.name}`);
      setResetUser(null);
      setResetPassword('');
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100 mr-auto">Users</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add user</button>
      </div>

      <div className="card p-0 divide-y divide-slate-50 dark:divide-slate-800">
        {loading ? (
          <SkList rows={3} />
        ) : users.map(u => (
          <div key={u.id} className="px-5 py-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-semibold text-sm shrink-0">
              {u.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{u.name}</p>
                <RoleBadge role={u.role || (u.is_admin ? 'admin' : 'member')} />
                {u.id === me.id && (
                  <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded">you</span>
                )}
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{u.email}</p>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 hidden sm:block shrink-0">Joined {formatDate(u.created_at)}</p>
            <div className="flex gap-1 shrink-0">
              {u.id !== me.id && (
                <button
                  className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                  onClick={() => setEditRoleUser(u)}
                >
                  Change role
                </button>
              )}
              <button
                className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
                onClick={() => { setResetUser(u); setResetPassword(''); }}
              >
                Reset password
              </button>
              {u.id !== me.id && (
                <button
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                  onClick={() => deleteUser(u)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add user modal */}
      {showAdd && (
        <Modal title="Add user" onClose={() => setShowAdd(false)}>
          <div className="space-y-4">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Alex" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="alex@havoro.local" />
            </div>
            <div>
              <label className="label">Temporary password</label>
              <input type="password" className="input" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="member">Member (can view and edit all data)</option>
                <option value="admin">Admin (full access including users and settings)</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn-primary" onClick={createUser} disabled={saving || !form.name || !form.email || !form.password}>
                {saving ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Change role modal */}
      {editRoleUser && (
        <Modal title={`Change role for ${editRoleUser.name}`} onClose={() => setEditRoleUser(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Current role: <RoleBadge role={editRoleUser.role || (editRoleUser.is_admin ? 'admin' : 'member')} />
            </p>
            <div className="space-y-2">
              {['member', 'admin'].map(r => (
                <button
                  key={r}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                    (editRoleUser.role || (editRoleUser.is_admin ? 'admin' : 'member')) === r
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                  }`}
                  onClick={() => changeRole(editRoleUser, r)}
                >
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{ROLE_LABELS[r]}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {r === 'admin'
                      ? 'Full access: users, settings, backup/restore, and all financial data'
                      : 'Can view and edit all financial data, but cannot manage users or settings'}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button className="btn-secondary" onClick={() => setEditRoleUser(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reset password modal */}
      {resetUser && (
        <Modal title={`Reset password for ${resetUser.name}`} onClose={() => setResetUser(null)}>
          <div className="space-y-4">
            <div>
              <label className="label">New password</label>
              <input type="password" className="input" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="At least 8 characters" autoFocus />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-secondary" onClick={() => setResetUser(null)}>Cancel</button>
              <button className="btn-primary" onClick={doReset}>Set password</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
