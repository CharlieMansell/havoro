import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCents } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { Sk, SkCard } from '../components/Skeleton';

const ACCOUNT_TYPES = [
  { value: 'transaction', label: 'Everyday / Transaction' },
  { value: 'savings',     label: 'Savings' },
  { value: 'offset',      label: 'Offset' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'liability',   label: 'Mortgage / Liability' },
];

const ASSET_TYPES = new Set(['super','property','share_portfolio','other_asset']);
const MANUAL_TYPES = new Set(['liability']);

function AccountForm({ initial, accounts, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    name: '', type: 'transaction', institution: '',
    current_balance_cents: 0, include_in_net_worth: true,
    is_manual_balance: false, linked_loan_account_id: '',
    lvr_ceiling: 0.80,
  });

  const f = (k) => (v) => setForm(prev => ({ ...prev, [k]: v }));
  const isManual = MANUAL_TYPES.has(form.type);

  const handleSave = async () => {
    const display = form.current_balance_cents_display;
    const body = {
      ...form,
      current_balance_cents: Math.round(parseFloat(display ?? form.current_balance_cents / 100 ?? 0) * 100),
      is_manual_balance: isManual ? 1 : (form.is_manual_balance ? 1 : 0),
      include_in_net_worth: form.include_in_net_worth ? 1 : 0,
      linked_loan_account_id: form.linked_loan_account_id || null,
    };
    delete body.current_balance_cents_display;
    await onSave(body);
  };

  const mortgageAccounts = accounts.filter(a => a.type === 'liability');

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Account name</label>
        <input className="input" value={form.name} onChange={e => f('name')(e.target.value)} placeholder="e.g. Joint Everyday" />
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={form.type} onChange={e => f('type')(e.target.value)}>
          {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Institution</label>
        <input className="input" value={form.institution || ''} onChange={e => f('institution')(e.target.value)} placeholder="e.g. ANZ" />
      </div>
      <div>
        <label className="label">Current balance ($)</label>
        <input
          type="number"
          className="input"
          step="0.01"
          value={form.current_balance_cents_display ?? (form.current_balance_cents / 100).toFixed(2)}
          onChange={e => setForm(prev => ({ ...prev, current_balance_cents_display: e.target.value }))}
          placeholder="0.00"
        />
        {form.type === 'liability' && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Enter the loan balance as a positive number (e.g. 480000).</p>
        )}
      </div>
      {form.type === 'property' && mortgageAccounts.length > 0 && (
        <div>
          <label className="label">Linked mortgage</label>
          <select className="input" value={form.linked_loan_account_id || ''} onChange={e => f('linked_loan_account_id')(e.target.value)}>
            <option value="">None</option>
            {mortgageAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={!!form.include_in_net_worth} onChange={e => f('include_in_net_worth')(e.target.checked)} className="rounded" />
        Include in net worth
      </label>
      <div className="flex gap-2 justify-end pt-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleSave} disabled={!form.name || !form.type}>Save</button>
      </div>
    </div>
  );
}

export default function Accounts() {
  const toast = useToast();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [updatingBalance, setUpdatingBalance] = useState(null);
  const [balanceInput, setBalanceInput] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/accounts')
      .then(all => setAccounts(all.filter(a => !ASSET_TYPES.has(a.type) && !a.archived)))
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const cashTotal = accounts
    .filter(a => a.include_in_net_worth && a.type !== 'liability')
    .reduce((s, a) => s + a.current_balance_cents, 0);
  const debtTotal = accounts
    .filter(a => a.type === 'liability')
    .reduce((s, a) => s + a.current_balance_cents, 0);

  const grouped = accounts.reduce((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {});

  const typeLabel = (t) => ACCOUNT_TYPES.find(x => x.value === t)?.label || t;

  const archiveAccount = async (acc) => {
    const ok = await confirm({
      title: `Archive "${acc.name}"?`,
      message: 'It will be hidden from the app. Existing transactions are kept.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    await api.delete(`/accounts/${acc.id}`);
    toast.addToast(`${acc.name} archived`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100">Accounts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cash <span className="font-medium text-slate-700 dark:text-slate-200">{formatCents(cashTotal)}</span>
            {debtTotal > 0 && <> · Debt <span className="font-medium text-red-500">-{formatCents(debtTotal)}</span></>}
          </p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setShowAdd(true)}>+ Add account</button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map(i => (
            <SkCard key={i} className="p-0 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700"><Sk w="w-24" h="h-3" /></div>
              {[0, 1].map(j => (
                <div key={j} className="px-5 py-4 flex items-center gap-3 border-b border-slate-50 dark:border-slate-800 last:border-0">
                  <div className="flex-1 space-y-2"><Sk w="w-32" h="h-3.5" /><Sk w="w-20" h="h-3" /></div>
                  <Sk w="w-24" h="h-4" />
                </div>
              ))}
            </SkCard>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([type, accs]) => (
            <div key={type} className="card p-0 overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700">
                <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{typeLabel(type)}</span>
              </div>
              {accs.map(acc => (
                <div key={acc.id} className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-slate-50 dark:border-slate-800 last:border-0">
                  <div className="min-w-0 sm:flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{acc.name}</p>
                    {acc.institution && <p className="text-xs text-slate-400 dark:text-slate-500">{acc.institution}</p>}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
                  {acc.is_manual_balance ? (
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {updatingBalance === acc.id ? (
                        <>
                          <input
                            type="number"
                            step="0.01"
                            className="input w-32 text-right"
                            value={balanceInput}
                            onChange={e => setBalanceInput(e.target.value)}
                            autoFocus
                            onKeyDown={async e => {
                              if (e.key === 'Enter') {
                                await api.patch(`/accounts/${acc.id}/balance`, { balance_cents: Math.round(parseFloat(balanceInput) * 100) });
                                toast.addToast('Balance updated');
                                setUpdatingBalance(null);
                                load();
                              }
                              if (e.key === 'Escape') setUpdatingBalance(null);
                            }}
                          />
                          <button className="btn-primary text-xs py-1" onClick={async () => {
                            await api.patch(`/accounts/${acc.id}/balance`, { balance_cents: Math.round(parseFloat(balanceInput) * 100) });
                            toast.addToast('Balance updated');
                            setUpdatingBalance(null);
                            load();
                          }}>Save</button>
                          <button className="btn-secondary text-xs py-1" onClick={() => setUpdatingBalance(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className={`text-sm font-medium ${acc.type === 'liability' ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>
                            {formatCents(acc.type === 'liability' ? -Math.abs(acc.current_balance_cents) : acc.current_balance_cents)}
                          </span>
                          <button
                            className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-lg"
                            onClick={() => { setUpdatingBalance(acc.id); setBalanceInput((Math.abs(acc.current_balance_cents) / 100).toFixed(2)); }}
                          >
                            Update
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className={`text-sm font-medium ${acc.current_balance_cents < 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>
                      {formatCents(acc.current_balance_cents)}
                    </span>
                  )}

                  <div className="flex gap-1 shrink-0">
                    <button className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1" onClick={() => setEditing(acc)}>Edit</button>
                    <button className="text-xs text-red-400 hover:text-red-600 px-2 py-1" onClick={() => archiveAccount(acc)}>Archive</button>
                  </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {accounts.length === 0 && (
            <div className="card text-center py-12 text-slate-400 dark:text-slate-500 text-sm">
              No accounts yet. Add your first account to get started.
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <Modal title="Add account" onClose={() => setShowAdd(false)}>
          <AccountForm accounts={accounts} onSave={async body => { await api.post('/accounts', body); toast.addToast('Account added'); setShowAdd(false); load(); }} onClose={() => setShowAdd(false)} />
        </Modal>
      )}

      {editing && (
        <Modal title="Edit account" onClose={() => setEditing(null)}>
          <AccountForm initial={editing} accounts={accounts} onSave={async body => { await api.put(`/accounts/${editing.id}`, body); toast.addToast('Account updated'); setEditing(null); load(); }} onClose={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
