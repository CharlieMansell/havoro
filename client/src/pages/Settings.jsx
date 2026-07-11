import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { formatDate, formatCents } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { Sk } from '../components/Skeleton';
import CheckInModal from '../components/CheckInModal';

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// Convert a simple HH:MM to a cron expression "MM HH * * *"
function timeToCron(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${m} ${h} * * *`;
}
function cronToTime(cron) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) return '02:00';
  const m = parts[0].padStart(2, '0');
  const h = parts[1].padStart(2, '0');
  return `${h}:${m}`;
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

function AppearancePanel() {
  const { theme, setTheme } = useAuth();

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Appearance</h2>
      <div className="flex gap-2">
        {THEME_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={`flex-1 text-sm font-medium py-2 rounded-lg border transition-colors ${
              theme === opt.value
                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">Saved to your account, so it follows you to any device you sign in on.</p>
    </div>
  );
}

function CheckInPanel({ toast }) {
  const [history, setHistory] = useState([]);
  const [showModal, setShowModal] = useState(false);

  const loadHistory = () => api.get('/checkin/history').then(setHistory).catch(console.error);
  useEffect(() => { loadHistory(); }, []);

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Check-in</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Snapshot all account balances and update share prices to build your net-worth history.
        Do this monthly after importing transactions and updating manual balances.
      </p>
      <button className="btn-primary" onClick={() => setShowModal(true)}>
        Start check-in
      </button>
      {history.length > 0 && (
        <div>
          <p className="label mt-2">History</p>
          <div className="space-y-0.5">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between text-sm py-2 border-b border-slate-50 dark:border-slate-800 last:border-0">
                <span className="text-slate-600 dark:text-slate-300">{formatDate(h.date)}</span>
                <div className="flex items-center gap-3">
                  {h.notes && <span className="text-slate-400 dark:text-slate-500 text-xs truncate max-w-[120px]">{h.notes}</span>}
                  <span className="font-medium text-slate-800 dark:text-slate-100">{formatCents(h.net_worth_cents)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {showModal && (
        <CheckInModal
          onClose={() => setShowModal(false)}
          onComplete={(res) => {
            toast.addToast(`Check-in recorded: net worth ${formatCents(res.net_worth_cents)}`);
            loadHistory();
          }}
        />
      )}
    </div>
  );
}

function BackupPanel({ toast, confirm, isAdmin }) {
  const [backups, setBackups] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [schedule, setSchedule] = useState('02:00');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const loadBackups = () => {
    setLoadingList(true);
    api.get('/settings/backups')
      .then(setBackups)
      .catch(console.error)
      .finally(() => setLoadingList(false));
  };

  useEffect(() => {
    loadBackups();
    if (isAdmin) {
      api.get('/settings/backup-schedule')
        .then(r => setSchedule(cronToTime(r.cron)))
        .catch(console.error);
    }
  }, [isAdmin]);

  const runNow = async () => {
    setRunning(true);
    try {
      await api.post('/settings/backup', {});
      toast.addToast('Backup saved');
      loadBackups();
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const restore = async (filename) => {
    const ok = await confirm({
      title: `Restore from ${filename}?`,
      message: 'All data since this backup was taken will be lost. The app will restart automatically.',
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;
    setRestoring(filename);
    try {
      await api.post(`/settings/restore/${filename}`, {});
      toast.addToast('Restoring… the app will restart in a moment', 'info');
      // Give Docker 3s to restart, then reload
      setTimeout(() => window.location.reload(), 5000);
    } catch (e) {
      toast.addToast(e.message, 'error');
      setRestoring(null);
    }
  };

  const pickFile = () => fileInputRef.current?.click();

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;

    const ok = await confirm({
      title: `Restore from ${file.name}?`,
      message: 'This replaces all current data with what\'s in that file. The app will restart automatically.',
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;

    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload('/settings/restore-upload', fd);
      toast.addToast('Restoring… the app will restart in a moment', 'info');
      setTimeout(() => window.location.reload(), 5000);
    } catch (e) {
      toast.addToast(e.message, 'error');
      setImporting(false);
    }
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const cron = timeToCron(schedule);
      await api.put('/settings/backup-schedule', { cron });
      toast.addToast('Backup schedule updated');
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Database backups</h2>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <input ref={fileInputRef} type="file" accept=".db" className="hidden" onChange={importFile} />
              <button className="btn-secondary text-xs" onClick={pickFile} disabled={importing}>
                {importing ? 'Restoring…' : 'Import a backup file'}
              </button>
            </>
          )}
          <button className="btn-secondary text-xs" onClick={runNow} disabled={running}>
            {running ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      </div>

      {/* Schedule (admin only) */}
      {isAdmin && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm text-slate-600 dark:text-slate-300 shrink-0">Daily backup at</label>
          <input
            type="time"
            className="input w-32"
            value={schedule}
            onChange={e => setSchedule(e.target.value)}
          />
          <button
            className="btn-secondary text-xs shrink-0"
            onClick={saveSchedule}
            disabled={savingSchedule}
          >
            {savingSchedule ? 'Saving…' : 'Save time'}
          </button>
        </div>
      )}

      {/* Backup list */}
      <div>
        <p className="label mb-2">Available backups</p>
        {loadingList ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <Sk key={i} w="w-full" h="h-10" />)}
          </div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No backups yet. Run your first one above.</p>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden">
            {backups.map(b => (
              <div key={b.filename} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-slate-700 dark:text-slate-200 truncate">{b.filename}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {new Date(b.mtime).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {formatBytes(b.size)}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    className="btn-secondary text-xs shrink-0"
                    onClick={() => restore(b.filename)}
                    disabled={restoring === b.filename}
                  >
                    {restoring === b.filename ? 'Restoring…' : 'Restore'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        The last 30 days of backups are kept automatically.
        Stored in <code className="bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded">data/backups/</code>.
      </p>
    </div>
  );
}

const MATCH_TYPES = [
  { value: 'contains',   label: 'Contains'    },
  { value: 'startswith', label: 'Starts with' },
  { value: 'regex',      label: 'Regex'       },
];

const BLANK_RULE = { match_type: 'contains', pattern: '', category_id: '', priority: 50 };

function RuleForm({ initial, categories, onSave, onCancel }) {
  const [form, setForm] = useState(initial || BLANK_RULE);
  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  const parents = categories.filter(c => !c.parent_id);
  const childrenOf = pid => categories.filter(c => c.parent_id === pid);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 items-end bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg p-3">
      <div>
        <label className="label text-xs">Match type</label>
        <select className="input text-sm" value={form.match_type} onChange={e => f('match_type')(e.target.value)}>
          {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label text-xs">Pattern</label>
        <input className="input text-sm font-mono" placeholder="e.g. netflix" value={form.pattern} onChange={e => f('pattern')(e.target.value)} />
      </div>
      <div>
        <label className="label text-xs">Category</label>
        <select className="input text-sm" value={form.category_id} onChange={e => f('category_id')(e.target.value)}>
          <option value="">Select…</option>
          {parents.map(p => (
            <optgroup key={p.id} label={p.name}>
              {childrenOf(p.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="w-20">
        <label className="label text-xs">Priority</label>
        <input type="number" className="input text-sm" min="1" max="999" value={form.priority} onChange={e => f('priority')(parseInt(e.target.value) || 50)} />
      </div>
      <div className="flex gap-2 sm:pt-5">
        <button className="btn-primary text-xs py-1.5 px-3" onClick={() => onSave(form)} disabled={!form.pattern.trim() || !form.category_id}>Save</button>
        <button className="btn-secondary text-xs py-1.5 px-3" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function RulesPanel({ toast, confirm }) {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const load = () => {
    api.get('/rules').then(setRules).catch(console.error);
  };
  useEffect(() => {
    load();
    api.get('/categories').then(setCategories).catch(console.error);
  }, []);

  const toggle = async (rule) => {
    await api.put(`/rules/${rule.id}`, { active: rule.active ? 0 : 1 });
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: r.active ? 0 : 1 } : r));
    toast.addToast(rule.active ? 'Rule disabled' : 'Rule enabled');
  };

  const remove = async (rule) => {
    const ok = await confirm({
      title: 'Remove rule?',
      message: `"${rule.match_type} ${rule.pattern}, mapped to ${rule.category_name}" will be deleted.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.delete(`/rules/${rule.id}`);
    setRules(prev => prev.filter(r => r.id !== rule.id));
    toast.addToast('Rule removed');
  };

  const saveNew = async (form) => {
    await api.post('/rules', form);
    toast.addToast('Rule created');
    setShowAdd(false);
    load();
  };

  const saveEdit = async (form) => {
    await api.put(`/rules/${editingId}`, form);
    toast.addToast('Rule updated');
    setEditingId(null);
    load();
  };

  const editingRule = rules.find(r => r.id === editingId);

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Categorisation rules</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Rules run in priority order on import. Lower number = higher priority. First match wins.</p>
        </div>
        <button className="btn-secondary text-xs shrink-0" onClick={() => { setShowAdd(true); setEditingId(null); }}>+ Add rule</button>
      </div>

      {showAdd && (
        <RuleForm categories={categories} onSave={saveNew} onCancel={() => setShowAdd(false)} />
      )}

      {rules.length === 0 && !showAdd ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No rules yet. Categorise transactions to create them automatically, or add one above.</p>
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-slate-800">
          {rules.map(r => (
            <div key={r.id}>
              {editingId === r.id ? (
                <div className="py-2">
                  <RuleForm
                    initial={{ match_type: r.match_type, pattern: r.pattern, category_id: String(r.category_id), priority: r.priority }}
                    categories={categories}
                    onSave={saveEdit}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div className={`py-3 flex items-center gap-3 flex-wrap ${!r.active ? 'opacity-40' : ''}`}>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: r.category_color || '#94a3b8' }} />
                  <div className="flex-1 min-w-0 text-sm">
                    <span className="text-slate-400 dark:text-slate-500 text-xs mr-2">{MATCH_TYPES.find(m => m.value === r.match_type)?.label ?? r.match_type}</span><wbr />
                    <span className="font-mono bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-1.5 py-0.5 rounded text-xs">{r.pattern}</span><wbr />
                    <span className="text-slate-400 dark:text-slate-500 mx-2 text-xs uppercase tracking-wide">maps to</span><wbr />
                    <span className="text-slate-700 dark:text-slate-200">{r.category_name}</span><wbr />
                    <span className="text-slate-300 dark:text-slate-600 ml-2 text-xs">p{r.priority}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1" onClick={() => { setEditingId(r.id); setShowAdd(false); }}>Edit</button>
                    <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1" onClick={() => toggle(r)}>{r.active ? 'Disable' : 'Enable'}</button>
                    <button className="text-xs text-red-400 hover:text-red-600 px-2 py-1" onClick={() => remove(r)}>Remove</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_OPTIONS = [
  { value: 'expense',  label: 'Expense' },
  { value: 'income',   label: 'Income'  },
  { value: 'transfer', label: 'Transfer'},
];

function CategoriesPanel({ toast, confirm }) {
  const [cats, setCats] = useState([]);
  const [editing, setEditing] = useState(null); // { id, name, color }
  const [addingChild, setAddingChild] = useState(null); // parent_id
  const [newChild, setNewChild] = useState({ name: '', color: '#94a3b8' });
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', kind: 'expense', color: '#94a3b8' });

  const load = () => api.get('/categories').then(setCats).catch(console.error);
  useEffect(() => { load(); }, []);

  const parents = cats.filter(c => !c.parent_id);
  const childrenOf = (pid) => cats.filter(c => c.parent_id === pid);

  const saveEdit = async () => {
    await api.put(`/categories/${editing.id}`, { name: editing.name, color: editing.color });
    toast.addToast('Category updated');
    setEditing(null);
    load();
  };

  const deleteCategory = async (cat) => {
    const ok = await confirm({
      title: `Delete "${cat.name}"?`,
      message: cat.parent_id
        ? 'Transactions using this category will need to be reassigned first.'
        : 'Deleting a group also deletes all its subcategories (if unused).',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/categories/${cat.id}`);
      toast.addToast(`${cat.name} deleted`);
      load();
    } catch (e) {
      toast.addToast(e.message || 'Cannot delete: category has transactions', 'error');
    }
  };

  const addChild = async (parentId) => {
    if (!newChild.name.trim()) return;
    const parent = cats.find(c => c.id === parentId);
    await api.post('/categories', { name: newChild.name, parent_id: parentId, kind: parent?.kind || 'expense', color: newChild.color });
    toast.addToast('Category added');
    setAddingChild(null);
    setNewChild({ name: '', color: '#94a3b8' });
    load();
  };

  const addGroup = async () => {
    if (!newGroup.name.trim()) return;
    await api.post('/categories', { name: newGroup.name, kind: newGroup.kind, color: newGroup.color });
    toast.addToast('Group added');
    setShowAddGroup(false);
    setNewGroup({ name: '', kind: 'expense', color: '#94a3b8' });
    load();
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Categories</h2>
        <button className="btn-secondary text-xs" onClick={() => { setShowAddGroup(true); setAddingChild(null); }}>+ Add group</button>
      </div>

      <div className="space-y-3">
        {parents.map(parent => (
          <div key={parent.id} className="border border-slate-100 dark:border-slate-700 rounded-lg overflow-hidden">
            {/* Parent row */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-900">
              {editing?.id === parent.id ? (
                <>
                  <input type="color" className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" value={editing.color} onChange={e => setEditing(ed => ({ ...ed, color: e.target.value }))} />
                  <input className="input py-0.5 text-sm flex-1" value={editing.name} onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} autoFocus />
                  <button className="text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2" onClick={saveEdit}>Save</button>
                  <button className="text-xs text-slate-400 dark:text-slate-500 px-1" onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: parent.color }} />
                  <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide flex-1">{parent.name}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 mr-2">{KIND_OPTIONS.find(k => k.value === parent.kind)?.label}</span>
                  <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5" onClick={() => setEditing({ id: parent.id, name: parent.name, color: parent.color })}>Edit</button>
                  <button className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5" onClick={() => deleteCategory(parent)}>Delete</button>
                </>
              )}
            </div>

            {/* Children */}
            {childrenOf(parent.id).map(child => (
              <div key={child.id} className="flex items-center gap-2 px-4 py-2 border-t border-slate-50 dark:border-slate-800">
                {editing?.id === child.id ? (
                  <>
                    <input type="color" className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent ml-4" value={editing.color} onChange={e => setEditing(ed => ({ ...ed, color: e.target.value }))} />
                    <input className="input py-0.5 text-sm flex-1" value={editing.name} onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} autoFocus />
                    <button className="text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2" onClick={saveEdit}>Save</button>
                    <button className="text-xs text-slate-400 dark:text-slate-500 px-1" onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full shrink-0 ml-4" style={{ background: child.color }} />
                    <span className="text-sm text-slate-700 dark:text-slate-200 flex-1">{child.name}</span>
                    <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-0.5" onClick={() => setEditing({ id: child.id, name: child.name, color: child.color })}>Edit</button>
                    <button className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5" onClick={() => deleteCategory(child)}>Delete</button>
                  </>
                )}
              </div>
            ))}

            {/* Add subcategory */}
            {addingChild === parent.id ? (
              <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
                <input type="color" className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent ml-4" value={newChild.color} onChange={e => setNewChild(n => ({ ...n, color: e.target.value }))} />
                <input className="input py-0.5 text-sm flex-1" placeholder="Category name" value={newChild.name} onChange={e => setNewChild(n => ({ ...n, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addChild(parent.id); if (e.key === 'Escape') setAddingChild(null); }} autoFocus />
                <button className="text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2" onClick={() => addChild(parent.id)}>Add</button>
                <button className="text-xs text-slate-400 dark:text-slate-500 px-1" onClick={() => setAddingChild(null)}>Cancel</button>
              </div>
            ) : (
              <button
                className="w-full text-left text-xs text-slate-400 dark:text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 px-4 py-2 border-t border-slate-50 dark:border-slate-800 transition-colors"
                onClick={() => { setAddingChild(parent.id); setNewChild({ name: '', color: parent.color }); setShowAddGroup(false); }}
              >
                + Add subcategory
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add group form */}
      {showAddGroup && (
        <div className="border border-emerald-200 rounded-lg p-4 space-y-3 bg-emerald-50/30">
          <p className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">New group</p>
          <div className="flex items-center gap-3">
            <input type="color" className="w-8 h-8 rounded cursor-pointer border border-slate-200 dark:border-slate-600" value={newGroup.color} onChange={e => setNewGroup(g => ({ ...g, color: e.target.value }))} />
            <input className="input flex-1" placeholder="Group name (e.g. Entertainment)" value={newGroup.name} onChange={e => setNewGroup(g => ({ ...g, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addGroup(); if (e.key === 'Escape') setShowAddGroup(false); }} autoFocus />
            <select className="input w-36" value={newGroup.kind} onChange={e => setNewGroup(g => ({ ...g, kind: e.target.value }))}>
              {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary text-xs" onClick={() => setShowAddGroup(false)}>Cancel</button>
            <button className="btn-primary text-xs" onClick={addGroup} disabled={!newGroup.name.trim()}>Add group</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppSettings({ toast }) {
  const [settings, setSettings] = useState({});

  useEffect(() => { api.get('/settings').then(setSettings).catch(console.error); }, []);

  const save = async () => {
    await api.put('/settings', settings);
    toast.addToast('Settings saved');
  };

  const field = (key, label) => (
    <div key={key}>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.01"
          className="input w-28"
          value={settings[key] || ''}
          onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">% pa</span>
      </div>
    </div>
  );

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Projection assumptions</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500">Used by the planning tools. Illustrative only, not financial advice.</p>
      <div className="grid grid-cols-2 gap-4">
        {field('default_growth_cash',     'Cash / savings')}
        {field('default_growth_shares',   'Shares')}
        {field('default_growth_property', 'Property')}
        {field('default_growth_super',    'Super')}
      </div>
      <button className="btn-primary" onClick={save}>Save</button>
    </div>
  );
}

const RELEASES_URL = 'https://github.com/charliemansell/havoro/releases';

// Returns true if b is a newer semver than a (e.g. isNewer('1.0.0', '1.1.0'))
function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] || 0) > (pa[i] || 0)) return true;
    if ((pb[i] || 0) < (pa[i] || 0)) return false;
  }
  return false;
}

function AboutPanel() {
  const [version, setVersion] = useState(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // { latest, updateAvailable } | { error }

  useEffect(() => {
    api.get('/settings/version').then(r => setVersion(r.version)).catch(() => {});
  }, []);

  const checkForUpdates = async () => {
    setChecking(true);
    setResult(null);
    try {
      const res = await fetch('https://api.github.com/repos/charliemansell/havoro/releases/latest');
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const data = await res.json();
      const latest = (data.tag_name || '').replace(/^v/, '');
      if (!latest) throw new Error('No releases found');
      setResult({ latest, updateAvailable: version ? isNewer(version, latest) : false });
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">About</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            Havoro {version ? `v${version}` : ''}, free &amp; open source
          </p>
        </div>
        <button className="btn-secondary text-xs shrink-0" onClick={checkForUpdates} disabled={checking}>
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {result?.error && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Couldn't check for updates ({result.error}). You can check manually on the{' '}
          <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">releases page</a>.
        </p>
      )}
      {result && !result.error && result.updateAvailable && (
        <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 rounded-lg px-3 py-2.5 text-sm">
          <span className="text-emerald-800 dark:text-emerald-300 font-medium">Version {result.latest} is available.</span>{' '}
          <a href={RELEASES_URL + '/latest'} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline">
            Download it here
          </a>
          <span className="text-emerald-700 dark:text-emerald-400"> Install over the top; your data is untouched.</span>
        </div>
      )}
      {result && !result.error && !result.updateAvailable && (
        <p className="text-xs text-slate-500 dark:text-slate-400">You're on the latest version. ✓</p>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-50 dark:border-slate-800">
        Free &amp; open source:{' '}
        <a href="https://github.com/charliemansell/havoro" target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">GitHub</a>
        {' · '}
        <a href="https://buymeacoffee.com/charliemansell" target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">Buy me a coffee</a>
      </p>
    </div>
  );
}

export default function Settings() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100">Settings</h1>
      <AboutPanel />
      <AppearancePanel />
      <CheckInPanel toast={toast} />
      <BackupPanel toast={toast} confirm={confirm} isAdmin={!!user?.is_admin} />
      <RulesPanel toast={toast} confirm={confirm} />
      {user?.is_admin && <CategoriesPanel toast={toast} confirm={confirm} />}
      <AppSettings toast={toast} />
    </div>
  );
}
