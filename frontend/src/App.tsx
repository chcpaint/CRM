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
      <div className="h-screen flex items-center justify-center bg-navy-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-navy-500 font-medium">Loading Refinish AI...</p>
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
        {(user.role === 'admin' || user.role === 'manager') && (
          <Route path="/admin" element={<AdminPage user={user} />} />
        )}
        <Route path="/login" element={<Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
