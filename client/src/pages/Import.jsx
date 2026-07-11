import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { formatCents, formatDate } from '../lib/utils';

export default function Import() {
  const [profiles, setProfiles] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [profile, setProfile] = useState('');
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    Promise.all([api.get('/import/profiles'), api.get('/accounts')]).then(([p, a]) => {
      setProfiles(p);
      setAccounts(a.filter(acc => !acc.is_manual_balance && !acc.archived));
    });
  }, []);

  const txAccounts = accounts.filter(a =>
    ['transaction','savings','offset','credit_card'].includes(a.type)
  );

  const previewFile = async (f, p) => {
    if (!f || !p) return;
    setError('');
    setPreview(null);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('profile', p);
    try {
      const res = await api.upload('/import/preview', fd);
      setPreview(res);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleFileChange = (f) => {
    setFile(f);
    setResult(null);
    if (f && profile) previewFile(f, profile);
  };

  const handleProfileChange = (p) => {
    setProfile(p);
    setResult(null);
    if (file && p) previewFile(file, p);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith('.csv')) handleFileChange(f);
  };

  const doImport = async () => {
    if (!file || !profile || !accountId) return;
    setLoading(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('profile', profile);
    fd.append('account_id', accountId);
    try {
      const res = await api.upload('/import', fd);
      setResult(res);
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold text-slate-800 dark:text-slate-100">Import transactions</h1>

      {result && (
        <div className="card bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100">
          <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-2">Import complete</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-slate-500 dark:text-slate-400">Imported</span><p className="text-xl font-semibold text-emerald-700 dark:text-emerald-400">{result.inserted}</p></div>
            <div><span className="text-slate-500 dark:text-slate-400">Duplicates skipped</span><p className="text-xl font-semibold text-slate-600 dark:text-slate-300">{result.duplicates}</p></div>
            <div><span className="text-slate-500 dark:text-slate-400">Need review</span><p className="text-xl font-semibold text-amber-600 dark:text-amber-400">{result.needsReview}</p></div>
          </div>
          <button className="btn-secondary mt-4 text-sm" onClick={() => setResult(null)}>Import another file</button>
        </div>
      )}

      {!result && (
        <div className="card space-y-5">
          {/* Profile select */}
          <div>
            <label className="label">Bank / Profile</label>
            <select className="input" value={profile} onChange={e => handleProfileChange(e.target.value)}>
              <option value="">Select your bank…</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Account select */}
          <div>
            <label className="label">Account to import into</label>
            <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}>
              <option value="">Select account…</option>
              {txAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.institution || a.type})</option>)}
            </select>
          </div>

          {/* File drop */}
          <div>
            <label className="label">CSV file</label>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragging ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
              }`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              {file ? (
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{file.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Drop your CSV here, or click to select</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Exported from your bank's internet banking</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => handleFileChange(e.target.files[0])}
            />
          </div>

          {/* Preview */}
          {preview?.ok && (
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
                Preview: {preview.rowCount} rows found
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 dark:text-slate-500">
                    <th className="text-left py-1">Date</th>
                    <th className="text-left py-1">Description</th>
                    <th className="text-right py-1">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {preview.sample.map((row, i) => (
                    <tr key={i}>
                      <td className="py-1.5 text-slate-600 dark:text-slate-300">{formatDate(row.date)}</td>
                      <td className="py-1.5 text-slate-800 dark:text-slate-100 truncate max-w-xs">{row.description_clean || row.description}</td>
                      <td className={`py-1.5 text-right font-medium ${row.amount_cents >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {formatCents(row.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rowCount > 5 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">…and {preview.rowCount - 5} more rows</p>
              )}
            </div>
          )}

          {preview && !preview.ok && (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-4 text-sm text-red-600 dark:text-red-400">
              Could not parse file: {preview.error}
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          <button
            className="btn-primary w-full justify-center py-2.5"
            onClick={doImport}
            disabled={!file || !profile || !accountId || loading}
          >
            {loading ? 'Importing…' : 'Import transactions'}
          </button>
        </div>
      )}
    </div>
  );
}
