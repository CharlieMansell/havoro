import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCents } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { Sk, SkCard } from '../components/Skeleton';

const CADENCE_LABELS = {
  weekly:      'Weekly',
  fortnightly: 'Fortnightly',
  monthly:     'Monthly',
  quarterly:   'Quarterly',
  annual:      'Annual',
};

const MONTHLY_FACTOR = {
  weekly:      52 / 12,
  fortnightly: 26 / 12,
  monthly:     1,
  quarterly:   1 / 3,
  annual:      1 / 12,
};

function toMonthly(cents, cadence) {
  return Math.round(cents * (MONTHLY_FACTOR[cadence] ?? 1));
}

function TransferForm({ initial, accounts, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    name: '', to_account_id: '', amount_cents: '', cadence: 'monthly', notes: '', sort_order: 100,
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const f = k => v => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.name || !form.amount_cents) {
      toast.addToast('Name and amount are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...form,
        to_account_id: form.to_account_id ? Number(form.to_account_id) : null,
        amount_cents: Math.round(parseFloat(form.amount_cents) * 100),
        sort_order: Number(form.sort_order) || 100,
      });
    } finally {
      setSaving(false);
    }
  };

  const preview = form.amount_cents && form.cadence && form.cadence !== 'monthly'
    ? toMonthly(Math.round(parseFloat(form.amount_cents || 0) * 100), form.cadence)
    : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Description</label>
        <input
          className="input" value={form.name} placeholder="e.g. Rates, Body Corporate, Netflix"
          onChange={e => f('name')(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Transfer to account</label>
        <select className="input" value={form.to_account_id} onChange={e => f('to_account_id')(e.target.value)}>
          <option value="">Unassigned</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Which account does this money need to land in?</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Amount ($)</label>
          <input
            type="number" step="0.01" min="0" className="input"
            value={form.amount_cents} placeholder="0.00"
            onChange={e => f('amount_cents')(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Frequency</label>
          <select className="input" value={form.cadence} onChange={e => f('cadence')(e.target.value)}>
            {Object.entries(CADENCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      {preview != null && (
        <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
          = {formatCents(preview)} / month
        </p>
      )}
      <div>
        <label className="label">Notes (optional)</label>
        <input
          className="input" value={form.notes} placeholder="e.g. Due 15th, council rates Q2"
          onChange={e => f('notes')(e.target.value)}
        />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function TransferRow({ item, onEdit, onDelete }) {
  const isMonthly = item.cadence === 'monthly';
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-800 dark:text-slate-100 font-medium">{item.name}</p>
        {item.notes && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{item.notes}</p>}
        {!isMonthly && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {formatCents(item.amount_cents)} {CADENCE_LABELS[item.cadence]?.toLowerCase()}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{formatCents(item.monthly_cents)}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">/ month</p>
      </div>
      <div className="flex gap-1 shrink-0 pt-0.5">
        <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-1.5 py-1" onClick={() => onEdit(item)}>Edit</button>
        <button className="text-xs text-red-400 hover:text-red-600 px-1.5 py-1" onClick={() => onDelete(item)}>Delete</button>
      </div>
    </div>
  );
}

function AccountGroup({ accountName, items, onEdit, onDelete }) {
  const total = items.reduce((s, i) => s + i.monthly_cents, 0);
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1 pb-2 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{accountName}</h2>
        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatCents(total)}<span className="text-xs font-normal text-slate-400 dark:text-slate-500"> / mo</span></span>
      </div>
      <div>
        {items.map(item => (
          <TransferRow key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

export default function Transfers() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/transfers'), api.get('/accounts')])
      .then(([t, a]) => { setItems(t); setAccounts(a.filter(acc => !acc.archived)); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async (body) => {
    try {
      await api.post('/transfers', body);
      toast.addToast('Transfer added');
      setShowAdd(false);
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const update = async (body) => {
    try {
      await api.put(`/transfers/${editing.id}`, body);
      toast.addToast('Transfer updated');
      setEditing(null);
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const remove = async (item) => {
    const ok = await confirm({
      title: `Delete "${item.name}"?`,
      message: 'This will remove it from your transfer plan.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await api.delete(`/transfers/${item.id}`);
    toast.addToast('Deleted');
    load();
  };

  // Group by destination account
  const groups = [];
  const seen = new Map();
  for (const item of items) {
    const key = item.to_account_id ?? 'none';
    const label = item.account_name ?? 'Unassigned';
    if (!seen.has(key)) { seen.set(key, []); groups.push({ key, label, items: seen.get(key) }); }
    seen.get(key).push(item);
  }

  const grandTotal = items.reduce((s, i) => s + i.monthly_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="mr-auto">
          <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100">Transfer planner</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">What to transfer at the start of each month, grouped by destination account</p>
        </div>
        <button className="btn-primary shrink-0" onClick={() => setShowAdd(true)}>+ Add transfer</button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map(i => (
            <SkCard key={i} className="space-y-3">
              <div className="flex justify-between pb-2 border-b border-slate-100 dark:border-slate-700"><Sk w="w-32" h="h-4" /><Sk w="w-20" h="h-4" /></div>
              {[0, 1, 2].map(j => (
                <div key={j} className="flex justify-between py-2"><Sk w="w-40" h="h-3" /><Sk w="w-16" h="h-3" /></div>
              ))}
            </SkCard>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-1">No transfers planned yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mb-4">
            Add each recurring transfer (bills account top-up, savings, sinking funds) and tag which account it goes to
          </p>
          <button className="btn-primary mx-auto" onClick={() => setShowAdd(true)}>Add your first transfer</button>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {groups.map(g => (
              <AccountGroup
                key={g.key}
                accountName={g.label}
                items={g.items}
                onEdit={setEditing}
                onDelete={remove}
              />
            ))}
          </div>

          <div className="card bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Total to transfer this month</span>
              <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatCents(grandTotal)}</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {groups.map(g => {
                const groupTotal = g.items.reduce((s, i) => s + i.monthly_cents, 0);
                return (
                  <div key={g.key} className="flex items-center justify-between text-sm">
                    <span className="text-emerald-700 dark:text-emerald-400">{g.label}</span>
                    <span className="font-medium text-emerald-800 dark:text-emerald-300">{formatCents(groupTotal)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {showAdd && (
        <Modal title="Add transfer" onClose={() => setShowAdd(false)}>
          <TransferForm accounts={accounts} onSave={create} onClose={() => setShowAdd(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit transfer" onClose={() => setEditing(null)}>
          <TransferForm
            initial={{
              ...editing,
              amount_cents: (editing.amount_cents / 100).toFixed(2),
              to_account_id: editing.to_account_id ?? '',
            }}
            accounts={accounts}
            onSave={update}
            onClose={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
