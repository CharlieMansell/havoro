import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCents } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import ProgressBar from '../components/ProgressBar';
import { Sk, SkCard } from '../components/Skeleton';

const CADENCE_LABELS = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };

function requiredContribution(goal) {
  if (!goal.target_date || !goal.cadence) return null;
  const remaining = goal.target_amount_cents - goal.current_amount_cents;
  if (remaining <= 0) return null;
  const weeks = Math.max(1, Math.ceil((new Date(goal.target_date) - new Date()) / (7 * 24 * 60 * 60 * 1000)));
  const perWeek = remaining / weeks;
  const amount = goal.cadence === 'weekly' ? perWeek : goal.cadence === 'fortnightly' ? perWeek * 2 : perWeek * (52 / 12);
  return amount;
}

function GoalForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    name: '', kind: 'goal', target_amount_cents: '', current_amount_cents: '',
    target_date: '', cadence: 'monthly', priority: 100,
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.name || !form.target_amount_cents) {
      toast.addToast('Name and target amount are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...form,
        target_amount_cents: Math.round(parseFloat(form.target_amount_cents) * 100),
        current_amount_cents: Math.round(parseFloat(form.current_amount_cents || 0) * 100),
        priority: Number(form.priority) || 100,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Name</label>
        <input className="input" value={form.name} onChange={e => f('name')(e.target.value)} placeholder="e.g. Emergency fund" />
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={form.kind} onChange={e => f('kind')(e.target.value)}>
          <option value="goal">Savings goal (one-off target)</option>
          <option value="sinking_fund">Sinking fund (recurring expense)</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Target amount ($)</label>
          <input
            type="number" step="0.01" min="0" className="input"
            value={form.target_amount_cents}
            onChange={e => f('target_amount_cents')(e.target.value)}
            placeholder="5000"
          />
        </div>
        <div>
          <label className="label">Current amount ($)</label>
          <input
            type="number" step="0.01" min="0" className="input"
            value={form.current_amount_cents}
            onChange={e => f('current_amount_cents')(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Target date (optional)</label>
          <input type="date" className="input w-full min-w-0" value={form.target_date} onChange={e => f('target_date')(e.target.value)} />
        </div>
        <div>
          <label className="label">Contribution cadence</label>
          <select className="input" value={form.cadence} onChange={e => f('cadence')(e.target.value)}>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Priority (lower = shown first)</label>
        <input type="number" className="input" value={form.priority} onChange={e => f('priority')(e.target.value)} />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create'}
        </button>
      </div>
    </div>
  );
}

export default function Goals() {
  const toast = useToast();
  const confirm = useConfirm();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/goals').then(setGoals).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async (body) => {
    try {
      await api.post('/goals', body);
      toast.addToast('Goal created');
      setShowAdd(false);
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const update = async (body) => {
    try {
      await api.put(`/goals/${editing.id}`, body);
      toast.addToast('Goal updated');
      setEditing(null);
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const archive = async (goal) => {
    const ok = await confirm({
      title: `Archive "${goal.name}"?`,
      message: 'It will be removed from your goals list.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    await api.delete(`/goals/${goal.id}`);
    toast.addToast('Goal archived');
    load();
  };

  const goalSummary = goals.filter(g => g.kind === 'goal');
  const sinkingFunds = goals.filter(g => g.kind === 'sinking_fund');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100 mr-auto">Goals & sinking funds</h1>
        <button className="btn-primary shrink-0" onClick={() => setShowAdd(true)}>+ Add goal</button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <SkCard key={i} className="space-y-3">
              <div className="flex justify-between"><Sk w="w-32" h="h-4" /><Sk w="w-20" h="h-4" /></div>
              <Sk w="w-full" h="h-2" />
              <div className="flex justify-between"><Sk w="w-24" h="h-3" /><Sk w="w-28" h="h-3" /></div>
            </SkCard>
          ))}
        </div>
      ) : goals.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">No goals yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mb-4">Track savings targets and sinking funds for irregular expenses</p>
          <button className="btn-primary mx-auto" onClick={() => setShowAdd(true)}>Create your first goal</button>
        </div>
      ) : (
        <>
          {goalSummary.length > 0 && (
            <div>
              <h2 className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Savings goals</h2>
              <div className="space-y-3">
                {goalSummary.map(g => <GoalCard key={g.id} goal={g} onEdit={setEditing} onArchive={archive} />)}
              </div>
            </div>
          )}
          {sinkingFunds.length > 0 && (
            <div>
              <h2 className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Sinking funds</h2>
              <div className="space-y-3">
                {sinkingFunds.map(g => <GoalCard key={g.id} goal={g} onEdit={setEditing} onArchive={archive} />)}
              </div>
            </div>
          )}
        </>
      )}

      {showAdd && (
        <Modal title="Add goal" onClose={() => setShowAdd(false)}>
          <GoalForm onSave={create} onClose={() => setShowAdd(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit goal" onClose={() => setEditing(null)}>
          <GoalForm
            initial={{
              ...editing,
              target_amount_cents: (editing.target_amount_cents / 100).toFixed(2),
              current_amount_cents: (editing.current_amount_cents / 100).toFixed(2),
            }}
            onSave={update}
            onClose={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function GoalCard({ goal, onEdit, onArchive }) {
  const pct = goal.target_amount_cents > 0
    ? Math.min(100, Math.round((goal.current_amount_cents / goal.target_amount_cents) * 100))
    : 0;
  const contrib = requiredContribution(goal);
  const done = pct >= 100;

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{goal.name}</p>
            {done && <span className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">Done!</span>}
          </div>
          {goal.target_date && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Target: {new Date(goal.target_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{formatCents(goal.current_amount_cents)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">of {formatCents(goal.target_amount_cents)}</p>
        </div>
      </div>

      <ProgressBar value={goal.current_amount_cents} max={goal.target_amount_cents} />

      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {contrib != null
            ? <span>{formatCents(Math.round(contrib))} / {CADENCE_LABELS[goal.cadence]?.toLowerCase()} needed</span>
            : goal.cadence
              ? <span>{CADENCE_LABELS[goal.cadence]} contributions</span>
              : null
          }
        </div>
        <div className="flex gap-1 shrink-0">
          <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1" onClick={() => onEdit(goal)}>Edit</button>
          <button className="text-xs text-red-400 hover:text-red-600 px-2 py-1" onClick={() => onArchive(goal)}>Archive</button>
        </div>
      </div>
    </div>
  );
}
