import { useState, useEffect, useRef } from 'react';
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
  const mainRef = useRef<HTMLDivElement>(null);

  // Animate page content on route change
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.style.opacity = '0';
      mainRef.current.style.transform = 'translateY(8px)';
      requestAnimationFrame(() => {
        if (mainRef.current) {
          mainRef.current.style.transition = 'opacity 0.35s ease-out, transform 0.35s ease-out';
          mainRef.current.style.opacity = '1';
          mainRef.current.style.transform = 'translateY(0)';
        }
      });
    }
  }, [location.pathname]);

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
      {/* ─── Top navbar ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-navy-900/95 backdrop-blur-lg text-white border-b border-white/5 shadow-glow-blue">
        <div className="flex items-center justify-between px-3 sm:px-5 h-14 sm:h-16 gap-2">
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mobile hamburger */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-xl hover:bg-white/10 active:scale-95 transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={sidebarOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
              </svg>
            </button>
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 sm:w-9 sm:h-9 bg-brand-gradient rounded-xl flex items-center justify-center font-bold text-sm shadow-glow-red/50 group-hover:scale-105 group-hover:shadow-glow-red transition-all duration-300">
                C
              </div>
              <div className="hidden sm:block">
                <div className="font-bold text-lg leading-tight tracking-tight">CHC CRM</div>
                <div className="text-[10px] text-navy-300 leading-tight tracking-wide uppercase">Paint & Auto Body Supplies</div>
              </div>
            </Link>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-xl mx-1 sm:mx-4">
            <AISearchBar onNavigate={(path) => navigate(path)} />
          </div>

          {/* User menu */}
          <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
            <NotificationBell />
            <div className="text-right hidden md:block ml-1">
              <div className="text-sm font-semibold">{user.first_name} {user.last_name}</div>
              <div className="text-[11px] text-navy-400 capitalize font-medium">{user.role}</div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs sm:text-sm text-navy-400 hover:text-white px-3 py-1.5 rounded-xl hover:bg-white/10 active:scale-95 transition-all duration-200 font-medium"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* ─── Sidebar overlay (mobile) ─── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-navy-950/60 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside
        className={`fixed top-14 sm:top-16 left-0 bottom-0 w-60 bg-sidebar-gradient border-r border-navy-100/80 z-40 transform transition-all duration-300 ease-out
          ${sidebarOpen ? 'translate-x-0 shadow-glass' : '-translate-x-full'} lg:translate-x-0 lg:shadow-none`}
      >
        <nav className="p-4 space-y-1 stagger-children">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 relative overflow-hidden
                  ${active
                    ? 'bg-brand-gradient text-white shadow-glow-red/30'
                    : 'text-navy-600 hover:bg-navy-100/80 hover:text-navy-900 active:scale-[0.98]'
                  }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-r-full shadow-sm" />
                )}
                <span className={`text-lg transition-transform duration-200 ${active ? '' : 'group-hover:scale-110'}`}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-navy-100/80">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-soft shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
            <div className="text-xs text-navy-400">System Online</div>
          </div>
          <div className="text-sm font-bold text-navy-700 mt-1 tracking-tight">Powered by <span className="text-brand-600">Refinish AI</span></div>
        </div>
      </aside>

      {/* ─── Mobile bottom navigation ─── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-lg border-t border-navy-200/60 shadow-glass">
        <div className="flex items-center justify-around px-2 py-1">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 min-w-0
                  ${active
                    ? 'text-brand-600 scale-105'
                    : 'text-navy-400 hover:text-navy-600 active:scale-95'
                  }`}
              >
                <span className={`text-lg transition-transform duration-200 ${active ? 'animate-scale-in' : ''}`}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
                {active && <span className="w-4 h-0.5 rounded-full bg-brand-500 mt-0.5" />}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ─── Main content with page transition ─── */}
      <main className="pt-14 sm:pt-16 lg:pl-60 min-h-screen pb-20 lg:pb-0">
        <div ref={mainRef} className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  );
}
