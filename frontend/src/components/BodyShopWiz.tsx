import { useState, useEffect } from 'react';

export default function BodyShopWiz() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pulse, setPulse] = useState(true);

  // Stop the attention pulse after 8 seconds
  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 8000);
    return () => clearTimeout(t);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => { setOpen(o => !o); setLoaded(true); }}
        aria-label={open ? 'Close Body Shop Wiz' : 'Open Body Shop Wiz'}
        className="fixed z-[60] transition-all duration-300 ease-in-out group"
        style={{
          bottom: 80,   // above mobile nav
          right: 16,
          width: open ? 44 : 56,
          height: open ? 44 : 56,
        }}
      >
        {/* Pulse ring */}
        {pulse && !open && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: 'rgba(37,99,235,0.3)' }}
          />
        )}

        <span
          className="relative flex items-center justify-center w-full h-full rounded-full shadow-lg transition-all duration-200"
          style={{
            background: open
              ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
              : 'linear-gradient(135deg, #2563eb, #1e40af)',
            boxShadow: open
              ? '0 4px 14px rgba(220,38,38,0.4)'
              : '0 4px 14px rgba(37,99,235,0.4)',
          }}
        >
          {open ? (
            // Close X icon
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            // Wiz icon — wrench/magic wand style
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          )}
        </span>

        {/* Label tooltip */}
        {!open && (
          <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 whitespace-nowrap bg-navy-900 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Body Shop Wiz
          </span>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-[58] lg:bg-transparent"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-out panel */}
      <div
        className={`fixed z-[59] bg-white shadow-2xl transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}
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
          style={{ background: 'linear-gradient(135deg, #1e3a8a, #1e40af)' }}
        >
          <svg className="w-6 h-6 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-sm leading-tight">Body Shop Wiz</div>
            <div className="text-blue-200 text-[10px] leading-tight">CHC Paint & Auto Body Supplies</div>
          </div>
          <a
            href="https://chc-work-buddy-frontend-production.up.railway.app"
            target="_blank"
            rel="noreferrer"
            className="text-blue-200 hover:text-white transition-colors"
            title="Open in new tab"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          <button
            onClick={() => setOpen(false)}
            className="text-blue-200 hover:text-white transition-colors ml-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Iframe */}
        {loaded && (
          <iframe
            src="https://chc-work-buddy-frontend-production.up.railway.app"
            title="Body Shop Wiz"
            className="w-full border-0"
            style={{ height: 'calc(100% - 56px)' }}
            allow="clipboard-write; clipboard-read"
          />
        )}
      </div>
    </>
  );
}
