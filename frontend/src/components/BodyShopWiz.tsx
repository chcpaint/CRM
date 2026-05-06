import { useState, useEffect } from 'react';

interface ChcApp {
  id: string;
  label: string;
  subtitle: string;
  url: string;
  color: string;       // gradient start
  colorEnd: string;    // gradient end
  icon: JSX.Element;
}

const CHC_APPS: ChcApp[] = [
  {
    id: 'wiz',
    label: 'Body Shop Wiz',
    subtitle: 'Product info & estimating',
    url: 'https://chc-work-buddy-frontend-production.up.railway.app',
    color: '#2563eb',
    colorEnd: '#1e40af',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    id: 'intranet',
    label: 'CHC Intranet',
    subtitle: 'Time off, HR & company info',
    url: 'https://chcteam.site/?_v=177798874',
    color: '#059669',
    colorEnd: '#047857',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
];

export default function BodyShopWiz() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<ChcApp | null>(null);
  const [loadedApps, setLoadedApps] = useState<Set<string>>(new Set());
  const [pulse, setPulse] = useState(true);

  // Stop the attention pulse after 8 seconds
  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 8000);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeApp) setActiveApp(null);
        else if (menuOpen) setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeApp, menuOpen]);

  const openApp = (app: ChcApp) => {
    setActiveApp(app);
    setLoadedApps(prev => new Set(prev).add(app.id));
    setMenuOpen(false);
  };

  const isAnythingOpen = menuOpen || !!activeApp;

  return (
    <>
      {/* Floating launcher button */}
      <button
        onClick={() => {
          if (activeApp) { setActiveApp(null); }
          else { setMenuOpen(o => !o); }
        }}
        aria-label={isAnythingOpen ? 'Close' : 'CHC Apps'}
        className="fixed z-[60] transition-all duration-300 ease-in-out group"
        style={{
          bottom: 80,
          right: 16,
          width: isAnythingOpen ? 44 : 56,
          height: isAnythingOpen ? 44 : 56,
        }}
      >
        {/* Pulse ring */}
        {pulse && !isAnythingOpen && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: 'rgba(37,99,235,0.3)' }}
          />
        )}

        <span
          className="relative flex items-center justify-center w-full h-full rounded-full shadow-lg transition-all duration-200"
          style={{
            background: isAnythingOpen
              ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
              : 'linear-gradient(135deg, #1e3a8a, #1e40af)',
            boxShadow: isAnythingOpen
              ? '0 4px 14px rgba(220,38,38,0.4)'
              : '0 4px 14px rgba(30,58,138,0.4)',
          }}
        >
          {isAnythingOpen ? (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            // Grid / apps icon
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          )}
        </span>

        {/* Tooltip */}
        {!isAnythingOpen && (
          <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 whitespace-nowrap bg-navy-900 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            CHC Apps
          </span>
        )}
      </button>

      {/* App picker menu (pop-up cards) */}
      {menuOpen && !activeApp && (
        <>
          <div
            className="fixed inset-0 z-[57]"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="fixed z-[58] animate-slide-up"
            style={{ bottom: 144, right: 16, width: 240 }}
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-navy-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-navy-100">
                <div className="text-xs font-bold text-navy-500 uppercase tracking-wider">CHC Apps</div>
              </div>
              <div className="p-2 space-y-1">
                {CHC_APPS.map(app => (
                  <button
                    key={app.id}
                    onClick={() => openApp(app)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-navy-50 transition-colors text-left"
                  >
                    <span
                      className="flex items-center justify-center w-10 h-10 rounded-lg text-white flex-shrink-0"
                      style={{ background: `linear-gradient(135deg, ${app.color}, ${app.colorEnd})` }}
                    >
                      {app.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-navy-900 leading-tight">{app.label}</div>
                      <div className="text-[11px] text-navy-400 leading-tight mt-0.5">{app.subtitle}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Backdrop for slide-out panel */}
      {activeApp && (
        <div
          className="fixed inset-0 bg-black/30 z-[58] lg:bg-transparent"
          onClick={() => setActiveApp(null)}
        />
      )}

      {/* Slide-out panel — renders for each app, only visible when active */}
      {CHC_APPS.map(app => (
        <div
          key={app.id}
          className={`fixed z-[59] bg-white shadow-2xl transition-transform duration-300 ease-in-out
            ${activeApp?.id === app.id ? 'translate-x-0' : 'translate-x-full'}
          `}
          style={{
            top: 0,
            right: 0,
            bottom: 0,
            width: 'min(420px, 92vw)',
            borderLeft: '1px solid #e5e7eb',
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center gap-3 px-4 h-14 border-b border-navy-100 flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${app.colorEnd}, ${app.color})` }}
          >
            <span className="text-white flex-shrink-0">{app.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold text-sm leading-tight">{app.label}</div>
              <div className="text-white/60 text-[10px] leading-tight">CHC Paint & Auto Body Supplies</div>
            </div>
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className="text-white/60 hover:text-white transition-colors"
              title="Open in new tab"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <button
              onClick={() => setActiveApp(null)}
              className="text-white/60 hover:text-white transition-colors ml-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Iframe — only renders once the app has been opened at least once */}
          {loadedApps.has(app.id) && (
            <iframe
              src={app.url}
              title={app.label}
              className="w-full border-0"
              style={{ height: 'calc(100% - 56px)' }}
              allow="clipboard-write; clipboard-read"
            />
          )}
        </div>
      ))}
    </>
  );
}
