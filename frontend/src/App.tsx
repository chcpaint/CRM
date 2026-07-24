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
import CompetitiveMarketInfoPage from './pages/CompetitiveMarketInfoPage';
import WeeklyReportPage from './pages/WeeklyReportPage';
import Layout from './components/layout/Layout';
import UpdateBanner from './components/UpdateBanner';
import ReminderNotifier from './components/ReminderNotifier';

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
      // Refresh user profile from server so role changes take effect immediately
      api.get('/auth/me').then((data: any) => {
        if (data.user) {
          const refreshed = { ...JSON.parse(savedUser), ...data.user };
          localStorage.setItem('user', JSON.stringify(refreshed));
          setUser(refreshed);
        }
      }).catch(() => { /* token expired — handled by api interceptor */ });
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
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-brand-600/15 blur-3xl animate-float" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-brand-500/10 blur-3xl animate-float" style={{ animationDelay: '3s' }} />
        </div>
        <div className="text-center relative z-10 animate-fade-in">
          <img
            src="/chc-logo.png"
            alt="CHC Paint & Body Shop Supplies"
            className="h-20 mx-auto mb-6 animate-pulse-soft drop-shadow-[0_4px_24px_rgba(230,57,70,0.3)]"
          />
          <div className="w-8 h-8 border-3 border-brand-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-navy-300 font-semibold tracking-widest text-xs uppercase">Loading CRM...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <Layout user={user} onLogout={handleLogout}>
      <UpdateBanner />
      <ReminderNotifier />
      <Routes>
        <Route path="/" element={<DashboardPage user={user} />} />
        <Route path="/accounts" element={<AccountsPage user={user} />} />
        <Route path="/accounts/:id" element={<AccountDetailPage user={user} />} />
        <Route path="/sales" element={<SalesPage user={user} />} />
        <Route path="/report" element={<DailyReportPage user={user} />} />
        <Route path="/holds" element={<HoldsPage user={user} />} />
        <Route path="/customer-alerts" element={<CustomerAlertsPage user={user} />} />
        <Route path="/competitive-market-info" element={<CompetitiveMarketInfoPage user={user} />} />
        <Route path="/weekly-report" element={<WeeklyReportPage user={user} />} />
        {(user.role === 'admin' || user.role === 'manager') && (
          <Route path="/admin" element={<AdminPage user={user} />} />
        )}
        <Route path="/login" element={<Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
