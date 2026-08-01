import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCents, formatDate } from '../lib/utils';
import Modal from '../components/Modal';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../components/ConfirmDialog';
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
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ rows: [], total: 0 });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [suggestRule, setSuggestRule] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [bankCategories, setBankCategories] = useState([]);

  const page = Number(searchParams.get('page') || 1);
  const needsReview = searchParams.get('needs_review') === 'true';
  const search = searchParams.get('search') || '';
  const accountId = searchParams.get('account_id') || '';
  const categoryId = searchParams.get('category_id') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const bankCategory = searchParams.get('bank_category') || '';

  // Everything except paging — the filters that decide *which* transactions
  // are in play, shared by the list request and "select all matching".
  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (needsReview) params.set('needs_review', 'true');
    if (search) params.set('search', search);
    if (accountId) params.set('account_id', accountId);
    if (categoryId) params.set('category_id', categoryId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (bankCategory) params.set('bank_category', bankCategory);
    return params;
  }, [needsReview, search, accountId, categoryId, dateFrom, dateTo, bankCategory]);

  const load = useCallback(() => {
    const params = filterParams();
    params.set('page', page);
    params.set('limit', '50');

    setLoading(true);
    api.get(`/transactions?${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterParams, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/categories').then(setCategories).catch(console.error);
    // Empty unless a bank that exports its own categories has been imported,
    // which is exactly when the filter below is worth showing.
    api.get('/transactions/bank-categories').then(setBankCategories).catch(console.error);
  }, []);
  // Selection deliberately survives paging, so one batch can span pages — but
  // a filter change means the selection no longer matches what's on screen.
  const filterKey = filterParams().toString();
  useEffect(() => { setSelected(new Set()); }, [filterKey]);

  const updateFilter = (key, value) => setSearchParams(p => {
    const n = new URLSearchParams(p);
    value ? n.set(key, value) : n.delete(key);
    n.delete('page');
    return n;
  });

  const toggleSelected = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allOnPageSelected = data.rows.length > 0 && data.rows.every(tx => selected.has(tx.id));
  const toggleSelectAll = () => setSelected(prev => {
    if (allOnPageSelected) return new Set();
    return new Set(data.rows.map(tx => tx.id));
  });

  const bulkApply = async () => {
    if (!bulkCategoryId || selected.size === 0) return;
    setBulkApplying(true);
    try {
      await api.post('/transactions/bulk-categorize', { ids: [...selected], category_id: Number(bulkCategoryId) });
      toast.addToast(`${selected.size} transaction${selected.size === 1 ? '' : 's'} categorised`);
      setSelected(new Set());
      setBulkCategoryId('');
      load();
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setBulkApplying(false);
    }
  };

  const updateCategory = async (tx, categoryId) => {
    await api.put(`/transactions/${tx.id}`, { category_id: categoryId || null });
    load();
    if (categoryId) {
      const sug = await api.post(`/transactions/${tx.id}/suggest-rule`, {}).catch(() => null);
      if (sug?.suggested) setSuggestRule({ tx, suggested: sug.suggested });
    }
  };

  // Deleting can shrink the list past the page being viewed — reloading that
  // page would show an empty table with no way back but the browser's own
  // Back button, so land on the last page that still has rows.
  const reloadAfterDelete = (removed) => {
    const lastPage = Math.max(1, Math.ceil(Math.max(0, data.total - removed) / 50));
    if (page > lastPage) {
      setSearchParams(p => {
        const n = new URLSearchParams(p);
        n.set('page', lastPage);
        return n;
      });
    } else {
      load();
    }
  };

  const deleteTransaction = async (tx) => {
    const ok = await confirm({
      title: 'Delete this transaction?',
      message: `${tx.description_clean || tx.description} · ${formatCents(tx.amount_cents)}. Re-importing the statement it came from will bring it back.`,
    });
    if (!ok) return;

    try {
      await api.delete(`/transactions/${tx.id}`);
      toast.addToast('Transaction deleted');
      setEditing(null);
      reloadAfterDelete(1);
    } catch (e) {
      toast.addToast(e.message, 'error');
    }
  };

  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const { ids } = await api.get(`/transactions/ids?${filterParams()}`);
      setSelected(new Set(ids));
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setSelectingAll(false);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    const ok = await confirm({
      title: `Delete ${count} transaction${count === 1 ? '' : 's'}?`,
      message: 'Re-importing the statements they came from will bring them back.',
      confirmLabel: `Delete ${count}`,
    });
    if (!ok) return;

    setBulkDeleting(true);
    try {
      const { deleted } = await api.post('/transactions/bulk-delete', { ids: [...selected] });
      toast.addToast(`${deleted} transaction${deleted === 1 ? '' : 's'} deleted`);
      setSelected(new Set());
      reloadAfterDelete(count);
    } catch (e) {
      toast.addToast(e.message, 'error');
    } finally {
      setBulkDeleting(false);
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
          onChange={e => updateFilter('search', e.target.value)}
        />

        <select
          className="input w-40 text-sm"
          value={categoryId}
          onChange={e => updateFilter('category_id', e.target.value)}
        >
          <option value="">All categories</option>
          {groups.map(g => (
            <optgroup key={g.id} label={g.name}>
              {g.children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>

        {bankCategories.length > 0 && (
          <select
            className="input w-40 text-sm"
            value={bankCategory}
            onChange={e => updateFilter('bank_category', e.target.value)}
            title="The category the bank itself assigned"
          >
            <option value="">Any bank category</option>
            {bankCategories.map(bc => <option key={bc} value={bc}>{bc}</option>)}
          </select>
        )}

        <input
          type="date"
          className="input w-36 text-sm"
          value={dateFrom}
          onChange={e => updateFilter('date_from', e.target.value)}
          title="From date"
        />
        <input
          type="date"
          className="input w-36 text-sm"
          value={dateTo}
          onChange={e => updateFilter('date_to', e.target.value)}
          title="To date"
        />

        {needsReview ? (
          <button className="btn-secondary text-xs" onClick={() => setSearchParams({})}>Show all</button>
        ) : (
          <button className="btn-secondary text-xs" onClick={() => setSearchParams({ needs_review: 'true' })}>Needs review</button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="card py-3 flex items-center gap-3 flex-wrap bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800">
          <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            {selected.size} selected
            {selected.size > data.rows.length && <span className="font-normal"> across pages</span>}
          </span>

          {/* The checkboxes only reach the current page, so anything beyond it
              has to be selectable in one go for a filtered batch to be usable. */}
          {selected.size < data.total && (
            <button className="btn-secondary text-xs" onClick={selectAllMatching} disabled={selectingAll}>
              {selectingAll ? 'Selecting…' : `Select all ${data.total}`}
            </button>
          )}
          <select
            className="input w-48 text-sm"
            value={bulkCategoryId}
            onChange={e => setBulkCategoryId(e.target.value)}
          >
            <option value="">Set category…</option>
            {groups.map(g => (
              <optgroup key={g.id} label={g.name}>
                {g.children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
          <button className="btn-primary text-xs" onClick={bulkApply} disabled={!bulkCategoryId || bulkApplying}>
            {bulkApplying ? 'Applying…' : 'Apply'}
          </button>
          <button className="btn-secondary text-xs" onClick={() => setSelected(new Set())}>Clear selection</button>
          <button
            className="btn-secondary text-xs ml-auto text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={bulkDelete}
            disabled={bulkDeleting}
          >
            {bulkDeleting ? 'Deleting…' : `Delete ${selected.size}`}
          </button>
        </div>
      )}

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
                <th className="w-8 px-4 py-3">
                  <input type="checkbox" className="rounded" checked={allOnPageSelected} onChange={toggleSelectAll} onClick={e => e.stopPropagation()} />
                </th>
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
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="rounded" checked={selected.has(tx.id)} onChange={() => toggleSelected(tx.id)} />
                  </td>
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

            {/* What the bank actually sent. These are the fields a
                categorisation rule can match on, and the heading above shows
                the merchant name in place of the statement line whenever the
                bank supplied one — so without this there's no way to see
                what a rule would actually be matching against. */}
            <dl className="text-xs space-y-1.5 border-t border-slate-100 dark:border-slate-700 pt-3">
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-slate-400 dark:text-slate-500">Description</dt>
                <dd className="text-slate-600 dark:text-slate-300 break-words font-mono">{editing.description}</dd>
              </div>
              {editing.merchant && (
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-slate-400 dark:text-slate-500">Merchant</dt>
                  <dd className="text-slate-600 dark:text-slate-300 break-words font-mono">{editing.merchant}</dd>
                </div>
              )}
              {editing.bank_category && (
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-slate-400 dark:text-slate-500">Bank category</dt>
                  <dd className="text-slate-600 dark:text-slate-300 break-words font-mono">{editing.bank_category}</dd>
                </div>
              )}
            </dl>

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
              <button
                className="btn-secondary mr-auto text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                onClick={() => deleteTransaction(editing)}
              >
                Delete
              </button>
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
            {/* Which field is named here matters: the suggestion picks the
                field it drew the pattern from, so "Woolworths" can come back
                as a merchant rule that would never match the statement line. */}
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Always categorise transactions whose{' '}
              {suggestRule.suggested.match_field === 'merchant' ? 'merchant'
                : suggestRule.suggested.match_field === 'bank_category' ? 'bank category'
                : 'description'}{' '}
              contains <strong>"{suggestRule.suggested.pattern}"</strong>?
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
