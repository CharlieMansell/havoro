import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents, formatDate } from '../lib/utils';
import Modal from '../components/Modal';
import { useToast } from '../contexts/ToastContext';
import { SkTableRows } from '../components/Skeleton';

function CategoryBadge({ name, color }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color || '#94a3b8' }} />
      {name}
    </span>
  );
}

export default function Transactions() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ rows: [], total: 0 });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [suggestRule, setSuggestRule] = useState(null);

  const page = Number(searchParams.get('page') || 1);
  const needsReview = searchParams.get('needs_review') === 'true';
  const search = searchParams.get('search') || '';
  const accountId = searchParams.get('account_id') || '';

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (needsReview) params.set('needs_review', 'true');
    if (search) params.set('search', search);
    if (accountId) params.set('account_id', accountId);
    params.set('page', page);
    params.set('limit', '50');

    setLoading(true);
    api.get(`/transactions?${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, needsReview, search, accountId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/categories').then(setCategories).catch(console.error);
  }, []);

  const updateCategory = async (tx, categoryId) => {
    await api.put(`/transactions/${tx.id}`, { category_id: categoryId || null });
    load();
    if (categoryId) {
      const sug = await api.post(`/transactions/${tx.id}/suggest-rule`, {}).catch(() => null);
      if (sug?.suggested) setSuggestRule({ tx, suggested: sug.suggested });
    }
  };

  const createRuleFromSuggestion = async () => {
    if (!suggestRule) return;
    await api.post('/rules', suggestRule.suggested);
    setSuggestRule(null);
  };

  const groupedCats = categories.reduce((acc, c) => {
    if (!c.parent_id) { acc[c.id] = { ...c, children: [] }; }
    return acc;
  }, {});
  categories.forEach(c => { if (c.parent_id && groupedCats[c.parent_id]) groupedCats[c.parent_id].children.push(c); });
  const groups = Object.values(groupedCats);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100 mr-auto">
          Transactions
          {needsReview && <span className="ml-2 text-sm font-normal text-amber-600 dark:text-amber-400">· needs review</span>}
        </h1>

        <input
          type="search"
          className="input w-48"
          placeholder="Search…"
          value={search}
          onChange={e => setSearchParams(p => { const n = new URLSearchParams(p); e.target.value ? n.set('search', e.target.value) : n.delete('search'); n.delete('page'); return n; })}
        />

        {needsReview ? (
          <button className="btn-secondary text-xs" onClick={() => setSearchParams({})}>Show all</button>
        ) : (
          <button className="btn-secondary text-xs" onClick={() => setSearchParams({ needs_review: 'true' })}>Needs review</button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <SkTableRows cols={5} rows={10} />
        ) : data.rows.length === 0 ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">No transactions found</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">Description</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">Account</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">Category</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {data.rows.map(tx => (
                <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" onClick={() => setEditing(tx)}>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatDate(tx.date)}</td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-100 max-w-xs truncate">
                    {tx.description_clean || tx.description}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{tx.account_name}</td>
                  <td className="px-4 py-3">
                    {tx.is_transfer ? (
                      <span className="text-xs text-slate-400 dark:text-slate-500 italic">Transfer</span>
                    ) : tx.category_name ? (
                      <CategoryBadge name={tx.category_name} color={tx.category_color} />
                    ) : (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Needs review</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${tx.amount_cents >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'}`}>
                    {formatCents(tx.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {data.total > 50 && (
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{data.total} transactions</span>
            <div className="flex gap-2">
              {page > 1 && (
                <button className="btn-secondary text-xs py-1" onClick={() => setSearchParams(p => { const n = new URLSearchParams(p); n.set('page', page - 1); return n; })}>
                  Previous
                </button>
              )}
              {page * 50 < data.total && (
                <button className="btn-secondary text-xs py-1" onClick={() => setSearchParams(p => { const n = new URLSearchParams(p); n.set('page', page + 1); return n; })}>
                  Next
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit transaction" onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{editing.description_clean || editing.description}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{formatDate(editing.date)} · {editing.account_name}</p>
            </div>
            <div className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{formatCents(editing.amount_cents)}</div>

            <div>
              <label className="label">Category</label>
              <select
                className="input"
                value={editing.category_id || ''}
                onChange={e => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setEditing(ex => ({ ...ex, category_id: val }));
                }}
              >
                <option value="">Uncategorised</option>
                {groups.map(g => (
                  <optgroup key={g.id} label={g.name}>
                    {g.children.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Mark as transfer</label>
              <input
                type="checkbox"
                checked={!!editing.is_transfer}
                onChange={e => setEditing(ex => ({ ...ex, is_transfer: e.target.checked ? 1 : 0 }))}
                className="rounded"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={async () => {
                  await api.put(`/transactions/${editing.id}`, {
                    category_id: editing.category_id || null,
                    is_transfer: editing.is_transfer,
                  });
                  toast.addToast('Transaction updated');
                  setEditing(null);
                  load();
                  if (editing.category_id) {
                    const sug = await api.post(`/transactions/${editing.id}/suggest-rule`, {}).catch(() => null);
                    if (sug?.suggested) setSuggestRule({ tx: editing, suggested: sug.suggested });
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rule suggestion */}
      {suggestRule && (
        <Modal title="Create a rule?" onClose={() => setSuggestRule(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Always categorise transactions containing{' '}
              <strong>"{suggestRule.suggested.pattern}"</strong>?
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setSuggestRule(null)}>Skip</button>
              <button className="btn-primary" onClick={createRuleFromSuggestion}>Create rule</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
