import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Budget from './pages/Budget';
import NetWorth from './pages/NetWorth';
import Accounts from './pages/Accounts';
import Assets from './pages/Assets';
import Import from './pages/Import';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Profile from './pages/Profile';
import Goals from './pages/Goals';
import Transfers from './pages/Transfers';
import NotFound from './pages/NotFound';

export default function App() {
  const { user, needsSetup, isElectron } = useAuth();

  if (user === undefined || needsSetup === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (needsSetup) return <Setup />;

  if (!user) {
    // Desktop signs itself in silently (see AuthContext) — this is just the
    // brief moment while that request is in flight, never a form to fill in.
    if (isElectron) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    return <Login />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/"             element={<Navigate to="/dashboard" replace />} />
        <Route path="/login"        element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"    element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/budget"       element={<Budget />} />
        <Route path="/goals"        element={<Goals />} />
        <Route path="/transfers"    element={<Transfers />} />
        <Route path="/net-worth"    element={<NetWorth />} />
        <Route path="/accounts"     element={<Accounts />} />
        <Route path="/assets"       element={<Assets />} />
        <Route path="/import"       element={<Import />} />
        <Route path="/settings"     element={<Settings />} />
        <Route path="/users"         element={user.is_admin ? <Users /> : <Navigate to="/dashboard" replace />} />
        <Route path="/profile"       element={<Profile />} />
        <Route path="*"              element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
