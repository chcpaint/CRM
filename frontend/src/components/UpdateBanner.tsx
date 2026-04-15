import { useEffect, useState } from 'react';

// Polls /api/version every 2 minutes. When the backend reports a different
// commit SHA than what this tab booted with, show a banner prompting the
// user to reload. Fixes the "stuck on old bundle after deploy" problem.
export default function UpdateBanner() {
  const [bootVersion, setBootVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setBootVersion(prev => prev || data.version);
        setLatestVersion(data.version);
      } catch {
        // network blip — try again next tick
      }
    };

    check();
    const id = setInterval(check, 2 * 60 * 1000); // every 2 min
    // Also re-check when the tab regains focus (users who left it open)
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const stale = !!bootVersion && !!latestVersion && bootVersion !== latestVersion && bootVersion !== 'dev' && latestVersion !== 'dev';
  if (!stale || dismissed) return null;

  const reload = () => {
    // Wipe HTTP cache for the SPA so the browser re-fetches index.html
    try {
      if ('caches' in window) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
      }
    } catch { /* ignore */ }
    // Force reload from server (bypass cache where supported)
    (window.location as any).reload(true);
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, background: '#1e3a8a', color: 'white',
        padding: '10px 16px', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        display: 'flex', alignItems: 'center', gap: 12, fontSize: 14,
        maxWidth: '92vw',
      }}
    >
      <span>A new version of the CRM is available.</span>
      <button
        onClick={reload}
        style={{
          background: 'white', color: '#1e3a8a', border: 'none',
          padding: '6px 14px', borderRadius: 6, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Reload
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: 'transparent', color: 'white', border: 'none',
          fontSize: 18, cursor: 'pointer', padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
