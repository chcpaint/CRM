import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { api } from './services/api';
import { User } from './types';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/AccountsPage';
import AccountDetailPage from './pages/AccountDetailPage';
import SalesPage from './pages/SalesPage';
import AdminPage from './pages/AdminPage';
import DailyReportPage from './pages/DailyReportPage';
import HoldsPage from './pages/HoldsPage';
import CustomerAlertsPage from './pages/CustomerAlertsPage';
import Layout from './components/layout/Layout';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('token');
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
      api.setToken(savedToken);
    }
    setLoading(false);
  }, []);

  const handleLogin = (token: string, userData: User) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    api.setToken(token);
    setUser(userData);
    navigate('/');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    api.setToken(null);
    setUser(null);
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-brand-600/10 blur-3xl animate-float" />
        </div>
        <div className="text-center relative z-10 animate-fade-in">
          <div className="w-14 h-14 bg-brand-gradient rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-glow-red animate-pulse-soft">
            <span className="text-white font-bold text-xl">C</span>
          </div>
          <div className="w-10 h-10 border-3 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-navy-300 font-semibold tracking-wide text-sm">Loading CHC CRM...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <Layout user={user} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<DashboardPage user={user} />} />
        <Route path="/accounts" element={<AccountsPage user={user} />} />
        <Route path="/accounts/:id" element={<AccountDetailPage user={user} />} />
        <Route path="/sales" element={<SalesPage user={user} />} />
        <Route path="/report" element={<DailyReportPage user={user} />} />
        <Route path="/holds" element={<HoldsPage user={user} />} />
        <Route path="/customer-alerts" element={<CustomerAlertsPage user={user} />} />
        {(user.role === 'admin' || user.role === 'manager') && (
          <Route path="/admin" element={<AdminPage user={user} />} />
        )}
        <Route path="/login" element={<Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
