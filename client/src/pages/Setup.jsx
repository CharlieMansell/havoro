import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function DesktopSetup() {
  const { completeLocalSetup } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await completeLocalSetup(name);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">What should we call you?</label>
        <input
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Alex"
          autoFocus
          required
        />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
        {loading ? 'Setting up…' : 'Continue'}
      </button>
    </form>
  );
}

function ServerSetup() {
  const { completeSetup } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const f = k => v => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await completeSetup(form.name, form.email, form.password);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Your name</label>
        <input className="input" value={form.name} onChange={e => f('name')(e.target.value)} placeholder="Alex" autoFocus required />
      </div>
      <div>
        <label className="label">Email</label>
        <input type="email" className="input" value={form.email} onChange={e => f('email')(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
      </div>
      <div>
        <label className="label">Password</label>
        <input type="password" className="input" value={form.password} onChange={e => f('password')(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
        {loading ? 'Creating account…' : 'Create admin account'}
      </button>
    </form>
  );
}

export default function Setup() {
  const { isElectron } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/icon.svg" alt="Havoro" className="w-20 h-20 mx-auto mb-3" />
          <h1 className="font-serif text-2xl font-semibold text-slate-800 dark:text-slate-100">Welcome to Havoro</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {isElectron ? "Let's get your name, then you're straight in." : 'Create the admin account for this install.'}
          </p>
        </div>
        <div className="card">
          {isElectron ? <DesktopSetup /> : <ServerSetup />}
        </div>
      </div>
    </div>
  );
}
