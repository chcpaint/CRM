import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

interface DueReminder {
  id: number;
  content: string;
  reminder_at: string;
  voice_url: string | null;
}

interface Toast {
  id: number;
  content: string;
  reminder_at: string;
  dismissing: boolean;
}

export default function ReminderNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasRequestedPermission = useRef(false);

  // Request browser notification permission on mount
  useEffect(() => {
    if (!hasRequestedPermission.current && 'Notification' in window && Notification.permission === 'default') {
      hasRequestedPermission.current = true;
      Notification.requestPermission();
    }
  }, []);

  const checkReminders = useCallback(async () => {
    try {
      const data = await api.get('/notes/reminders/due');
      const reminders: DueReminder[] = data.reminders || [];
      if (reminders.length === 0) return;

      // Play notification sound
      try {
        if (!audioRef.current) {
          audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JjYyLiYeGh4mLjY6OjYuJh4WEhIWHiYuNjo+PjoyKiIaEg4OEhoiKjI6Pj4+NjIqIhoSDg4SFh4mLjY+Pj4+NjIqIhoWEg4SFh4mLjY6Pj4+NjIqIhoWDg4SFh4mLjY6Pj4+NjImIhoWDg4SFh4mLjY6Pj4+NjImHhoWDg4SFh4mLjY6Pj4+NjImHhoWDg4SFh4mKjI6Pj4+OjYuJh4aEg4OEhYeJi42Oj4+PjYyKiIaFhIOEhYeJi42Oj4+PjY2KiYeGhIODhIWHiYuNjo+Pj42MioiGhYSDhIWHiYuNjo+Pj42MioiGhYODhIWHiYuNjo+Pj42MiYiGhYODhIWHiYuNjo+Pj42MiYeGhIODhIWHiYuNjo+Pj42MiYeGhYODhIWHiYqMjo+Pj46NjImHhoWDg4SFh4mLjY6Pj4+NjIqIhoWEg4SFh4mLjY6Pj4+NjYqJh4aEg4OEhYeJi42Oj4+PjYyKiIaFhIOEhYeJi42Oj4+PjYyKiIaFg4OEhYeJi42Oj4+PjYyJiIaFg4OEhYeJi42Oj4+PjYyJh4aEg4OEhYeJi42Oj4+PjYyJh4aFg4OEhYeJioyOj4+Pjo2MiYeGhYODhIWHiYuNjo+Pj42MioiGhYSDhIWHiYuNjo+Pj42NiomHhoSDg4SFh4mLjY6Pj4+NjIqIhoWEg4SFh4mLjY6Pj4+NjIqIhoWDg4SFh4mLjY6Pj4+NjImIhoWDg4SFh4mLjY6Pj4+NjImHhoSDg4SFh4mLjY6Pj4+NjImHhoWDg4SFh4mKjI6Pj4+OjYyJh4aFg4OEhYeJi42Oj4+PjYyKiIaFhIOEhYeJi42Oj4+PjY2KiYeGhIODhIWHiYuNjo+Pj42MioiGhYSDhIWHiYuNjo+Pj42MioiGhYODhIWHiYuNjo+Pj42MiYiGhYODhIWHiYuNjo+Pj42MiYeGhIODhIWHiYuNjo+Pj42MiYeGhYODhIWHiYqMjo+Pj46NjImHhoWDg4SFh4mLjY6Pj4+NjIqIhoWEg4SFh4mLjY6Pj4+NjYqJh4aEg4OEhYeJi42Oj4+PjYyKiIaFhIOEhYeJi42Oj4+PjYyKiIaFg4OEhYeJi42Oj4+PjYyJiIaFg4OEhYeJi42Oj4+PjYyJh4aEg4OEhYeJi42Oj4+PjYyJh4aFg4OEhYeJioyOj4+Pjo2MiYeGhYODhIWHiYuNjo+Pj42MioiGhYSDhIWHiYuNjo+Pj42NiomHhoSDg4SFh4mLjY6Pj4+NjIqIhoWEg4SFh4mLjY6Pj4+NjIqIhoWDg4SFh4mLjY6Pj4+NjImIhoWDg4SFh4mLjY6Pj4+NjImHhoSDg4SFh4mLjY6Pj4+NjImHhoWDg4SFh4mKjI6Pj4+OjYyJh4aFg4OEhYeJi42Oj4+PjYyKiIaFhIOEhYeJi42Oj4+PjY2KiYeGhIODhIWHiYuNjo+Pj42MioiGhYSDhIWHiYuNjo+Pj42MioiGhYODhIWHiYuNjo+Pj42MiYiGhYODhIWHiYuNjo+Pj42MiYeGhIODhIWHiYuNjo+Pj42MiYeGhYODhIWHiYqMjo+Pj46NjImHhoWDg4SFh4mLjY6Pj4+NjIqIhoWEg4SFh4mLjY6Pj4+NjYqJh4aEg4OEhYeJi42Oj4+PjYyKiIaFhIOEhYeJi42Oj4+PjYyKiIaFg4OEhYeJi42Oj4+PjYyJiIaFg4OEhYeJi42Oj4+PjYyJh4aEg4OEhYeJi42Oj4+PjYyJh4aFg4OEhYeJioyOj4+Pjo2MiYeGhYODhIWHiYuNjo+Pj42MioiGhYSDhIWHiYuNjo+Pj42NiomHhoSDg4SFh4mLjY6Pj42NjIqIhoWEg4SFh4mLjY6Pj4+NjIqIhoWDg4SFh4mLjY6Pj4+NjImIhoWDg4SFh4mLjY6Pj4+NjImHhoSDg4SFh4mLjY6Pj42NjImHhoWDg4SFh4mKjI6Pj4+OjYyJh4aFg4OEhYeJi42Oj4+PjYyKiIaFhIOEhQ==');
        }
        audioRef.current.volume = 0.3;
        audioRef.current.play().catch(() => {}); // Ignore autoplay restrictions
      } catch {} // Sound is best-effort

      // Add toasts
      const newToasts: Toast[] = reminders.map(r => ({
        id: r.id,
        content: r.content,
        reminder_at: r.reminder_at,
        dismissing: false,
      }));
      setToasts(prev => [...prev, ...newToasts]);

      // Browser notification (if permitted)
      if ('Notification' in window && Notification.permission === 'granted') {
        reminders.forEach(r => {
          new Notification('CRM Reminder', {
            body: r.content || 'You have a reminder',
            icon: '/chc-logo.png',
            tag: `reminder-${r.id}`,
          });
        });
      }
    } catch (err) {
      // Silent fail — don't spam console on every poll
    }
  }, []);

  // Poll every 30 seconds
  useEffect(() => {
    checkReminders();
    const interval = setInterval(checkReminders, 30000);
    return () => clearInterval(interval);
  }, [checkReminders]);

  // Dismiss toast
  const dismissToast = async (noteId: number) => {
    setToasts(prev => prev.map(t => t.id === noteId ? { ...t, dismissing: true } : t));
    try {
      await api.post(`/notes/${noteId}/dismiss`);
    } catch {}
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== noteId));
    }, 300);
  };

  // Auto-dismiss after 15 seconds
  useEffect(() => {
    const timers = toasts.map(t =>
      setTimeout(() => dismissToast(t.id), 15000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts.length]); // eslint-disable-line

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[80] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`pointer-events-auto bg-white rounded-2xl shadow-2xl border border-brand-100 p-4
            transition-all duration-300 ${toast.dismissing ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0 animate-slide-in'}`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-brand-600 mb-0.5">Reminder</div>
              <p className="text-sm text-navy-800 line-clamp-3">{toast.content || 'You have a reminder'}</p>
              <div className="text-[10px] text-navy-400 mt-1">
                {new Date(toast.reminder_at).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="flex-shrink-0 p-1 rounded-lg hover:bg-navy-100 text-navy-400 hover:text-navy-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
