import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { api } from '../../services/api';

interface Notification {
  id: number;
  type: string;
  preview_text: string | null;
  is_read: boolean;
  note_id: number | null;
  created_at: string;
  actor_first_name?: string | null;
  actor_last_name?: string | null;
}

export default function MessagesForYouCard() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.get<{ notifications: Notification[] }>('/notifications');
      // Show only comment / mention / assignment style messages here (not daily-report-ready)
      setItems(
        (r.notifications || []).filter(n =>
          ['comment', 'mention', 'comment_reply', 'assignment'].includes(n.type)
        ).slice(0, 10)
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const dismiss = async (id: number) => {
    try {
      await api.post(`/notifications/${id}/read`);
      load();
    } catch { /* ignore */ }
  };

  return (
    <div className="bg-white rounded-xl border border-navy-100 shadow-sm">
      <div className="px-4 py-3 border-b border-navy-100 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-brand-600" />
        <h3 className="font-semibold text-navy-900">Messages for you</h3>
        {items.length > 0 && (
          <span className="ml-auto text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">
            {items.length}
          </span>
        )}
      </div>
      {loading ? (
        <div className="p-6 text-center text-sm text-navy-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-sm text-navy-400">
          No new messages. You're all caught up.
        </div>
      ) : (
        <ul className="divide-y divide-navy-50">
          {items.map(n => (
            <li key={n.id} className="p-3 flex items-start gap-3 hover:bg-navy-50/50">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-navy-500 mb-0.5 font-medium">
                  {n.actor_first_name
                    ? `${n.actor_first_name} ${n.actor_last_name || ''}`
                    : n.type.replace(/_/g, ' ')}
                </div>
                <div className="text-sm text-navy-800 leading-snug line-clamp-3">
                  {n.preview_text}
                </div>
                <div className="text-[11px] text-navy-400 mt-1">
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => dismiss(n.id)}
                className="text-xs text-navy-400 hover:text-navy-700 px-2 py-1 rounded"
              >
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
