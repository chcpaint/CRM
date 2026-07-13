import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { User } from '../../types';
import AISearchBar from '../search/AISearchBar';
import NotificationBell from '../notifications/NotificationBell';
import BodyShopWiz from '../BodyShopWiz';
import QuickNotes from '../QuickNotes';

interface LayoutProps {
  user: User;
  onLogout: () => void;
  children: React.ReactNode;
}

export default function Layout({ user, onLogout, children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Primary bottom-nav items (most used by the team)
  const primaryNav = [
    { path: '/', label: 'Dashboard', icon: '\u{1F4CA}' },
    { path: '/report', label: 'Activities', icon: '\u{1F4CB}' },
    { path: '/accounts', label: 'Accounts', icon: '\u{1F3E2}' },
    { path: '/sales', label: 'Sales', icon: '\u{1F4B0}' },
  ];

  // Overflow items — shown in sidebar + mobile "More" sheet
  const secondaryNav = [
    { path: '/holds', label: 'On Hold', icon: '\u{26D4}' },
    { path: '/customer-alerts', label: 'Customer Alerts', icon: '\u{26A0}\u{FE0F}' },
    { path: '/competitive-market-info', label: 'Competitive Market Info', icon: '\u{1F4C9}' },
  ];

  if (user.role === 'admin' || user.role === 'manager') {
    secondaryNav.push({ path: '/admin', label: 'Admin', icon: '\u{2699}\u{FE0F}' });
  }

  const navItems = [...primaryNav, ...secondaryNav];

  // Is the current page one of the secondary items?
  const isSecondaryActive = secondaryNav.some(s =>
    s.path === '/' ? location.pathname === '/' : location.pathname.startsWith(s.path)
  );

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen">
      {/* Top navbar */}
      <header className="bg-navy-900/95 backdrop-blur-xl text-white shadow-[0_4px_30px_rgba(0,0,0,0.3)] fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]">
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
            <Link to="/" className="flex items-center gap-2.5 group">
              <img
                src="/chc-logo.png"
                alt="CHC"
                className="h-8 sm:h-9 flex-shrink-0 drop-shadow-[0_2px_8px_rgba(230,57,70,0.25)] group-hover:drop-shadow-[0_2px_12px_rgba(230,57,70,0.4)] transition-all duration-300"
              />
              <div className="hidden sm:block">
                <div className="font-bold text-lg leading-tight tracking-tight">CRM</div>
                <div className="text-[10px] text-navy-300 leading-tight tracking-wide">Paint & Auto Body Supplies</div>
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
        className={`fixed top-14 sm:top-16 left-0 bottom-0 w-56 bg-white/80 backdrop-blur-xl border-r border-navy-100/50 z-40 transform transition-transform duration-300 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                ${isActive(item.path)
                  ? 'bg-brand-50/80 text-brand-700 shadow-sm border border-brand-100/50'
                  : 'text-navy-600 hover:bg-white/60 hover:text-navy-900 hover:shadow-sm'
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

      {/* Mobile bottom navigation — 4 primary + More */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-t border-navy-200/50 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-around px-1">
          {primaryNav.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMoreOpen(false)}
              className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg text-[11px] font-medium transition-colors min-w-0 flex-1
                ${isActive(item.path)
                  ? 'text-brand-600'
                  : 'text-navy-400'
                }`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span className="truncate max-w-full">{item.label}</span>
            </Link>
          ))}
          {/* More button */}
          <button
            onClick={() => setMoreOpen(o => !o)}
            className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg text-[11px] font-medium transition-colors min-w-0 flex-1
              ${moreOpen || isSecondaryActive ? 'text-brand-600' : 'text-navy-400'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" />
            </svg>
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* "More" slide-up sheet (mobile) */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[55] lg:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed bottom-[60px] left-2 right-2 z-[56] lg:hidden bg-white rounded-2xl shadow-2xl border border-navy-100 overflow-hidden animate-slide-up">
            <div className="p-2">
              {secondaryNav.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors
                    ${isActive(item.path)
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-navy-700 hover:bg-navy-50'
                    }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Main content */}
      <main className="pt-14 sm:pt-16 lg:pl-56 min-h-screen pb-20 lg:pb-0">
        <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl">
          {children}
        </div>
      </main>

      {/* Body Shop Wiz floating panel */}
      <BodyShopWiz />

      {/* Quick Notes sidebar */}
      <QuickNotes />
    </div>
  );
}
