import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { User } from '../../types';
import AISearchBar from '../search/AISearchBar';
import NotificationBell from '../notifications/NotificationBell';

interface LayoutProps {
  user: User;
  onLogout: () => void;
  children: React.ReactNode;
}

export default function Layout({ user, onLogout, children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '\u{1F4CA}' },
    { path: '/report', label: 'Daily Activities', icon: '\u{1F4CB}' },
    { path: '/accounts', label: 'Accounts', icon: '\u{1F3E2}' },
    { path: '/sales', label: 'Sales', icon: '\u{1F4B0}' },
    { path: '/holds', label: 'On Hold', icon: '\u{26D4}' },
  ];

  if (user.role === 'admin' || user.role === 'manager') {
    navItems.push({ path: '/admin', label: 'Admin', icon: '\u{2699}\u{FE0F}' });
  }

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen bg-navy-50">
      {/* Top navbar */}
      <header className="bg-navy-900 text-white shadow-lg fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center justify-between px-3 sm:px-4 h-14 sm:h-16 gap-2">
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-navy-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-brand-500 rounded-lg flex items-center justify-center font-bold text-xs sm:text-sm flex-shrink-0">
                C
              </div>
              <div className="hidden sm:block">
                <div className="font-bold text-lg leading-tight">CRM</div>
                <div className="text-[10px] text-navy-300 leading-tight">CHC Paint & Auto Body Supplies</div>
              </div>
            </Link>
          </div>

          {/* Search bar — visible on all screens */}
          <div className="flex-1 max-w-xl mx-1 sm:mx-4">
            <AISearchBar onNavigate={(path) => navigate(path)} />
          </div>

          {/* User menu */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <NotificationBell />
            <div className="text-right hidden md:block ml-1">
              <div className="text-sm font-medium">{user.first_name} {user.last_name}</div>
              <div className="text-xs text-navy-300 capitalize">{user.role}</div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs sm:text-sm text-navy-300 hover:text-white px-2 sm:px-3 py-1.5 rounded-lg hover:bg-navy-800 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-14 sm:top-16 left-0 bottom-0 w-56 bg-white border-r border-navy-100 z-40 transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${isActive(item.path)
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900'
                }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Quick stats in sidebar */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-navy-100">
          <div className="text-xs text-navy-400">Powered by</div>
          <div className="text-sm font-bold text-navy-700">Refinish AI</div>
        </div>
      </aside>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-navy-200 shadow-[0_-2px_10px_rgba(0,0,0,0.1)]">
        <div className="flex items-center justify-around px-2 py-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors min-w-0
                ${isActive(item.path)
                  ? 'text-brand-600'
                  : 'text-navy-400 hover:text-navy-600'
                }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="pt-14 sm:pt-16 lg:pl-56 min-h-screen pb-20 lg:pb-0">
        <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  );
}
