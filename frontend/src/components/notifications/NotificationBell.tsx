import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { api } from '../../services/api';

interface Notification {
  id: number;
  recipient_id: number;
  actor_id: number | null;
  type: string;
  source_table: string | null;
  source_id: number | null;
  note_id: number | null;
  preview_text: string | null;
  is_read: boolean;
  created_at: string;
  actor_first_name?: string | null;
  actor_last_name?: string | null;
}

const POLL_MS = 30_000;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const r = await api.get<{ notifications: Notification[]; unread_count: number }>('/notifications');
      setItems(r.notifications || []);
      setUnread(r.unread_count || 0);
      // Tab title flash so they notice when the tab is backgrounded
      if (r.unread_count > 0) document.title = `(${r.unread_count}) CHC CRM`;
      else document.title = 'CHC CRM';
    } catch {
      // silent — keep last state
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleClick = async (n: Notification) => {
    try {
      await api.post(`/notifications/${n.id}/read`);
    } catch { /* ignore */ }
    setOpen(false);
    if (n.note_id) {
      // Deep-link via account detail (route uses /accounts/:id; we don't know the account here,
      // so fall back to dashboard which now shows the message inbox).
      navigate('/');
    } else if (n.source_table === 'daily_reports') {
      navigate('/report');
    }
    load();
  };

  const markAll = async () => {
    try {
      await api.post('/notifications/read-all');
      load();
    } catch { /* ignore */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-navy-800 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-white border border-navy-200 rounded-lg shadow-xl z-50 text-navy-900">
          <div className="flex items-center justify-between px-3 py-2 border-b border-navy-100">
            <div className="font-semibold text-sm">Notifications</div>
            {items.some(i => !i.is_read) && (
              <button
                onClick={markAll}
                className="text-xs text-brand-600 hover:underline flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-navy-400">You're all caught up.</div>
          ) : (
            items.map(n => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left px-3 py-2.5 border-b border-navy-50 hover:bg-navy-50 transition-colors block ${
                  !n.is_read ? 'bg-brand-50/60' : ''
                }`}
              >
                <div className="text-xs text-navy-500 mb-0.5">
                  {n.actor_first_name
                    ? `${n.actor_first_name} ${n.actor_last_name || ''}`
                    : n.type.replace(/_/g, ' ')}
                </div>
                <div className="text-sm leading-snug line-clamp-2">{n.preview_text}</div>
                <div className="text-[10px] text-navy-400 mt-1">
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
