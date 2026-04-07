import { useState, useEffect } from 'react';
import { Send } from 'lucide-react';
import { api } from '../../services/api';
import { User } from '../../types';

interface Comment {
  id: number;
  note_id: number;
  author_id: number;
  parent_comment_id: number | null;
  body: string;
  created_at: string;
  first_name: string;
  last_name: string;
  role: 'rep' | 'manager' | 'admin';
}

interface Props {
  noteId: number;
  currentUser: User;
  noteAuthorId: number;
  accountAssignedRepId?: number | null;
}

export default function NoteCommentThread({ noteId, currentUser, noteAuthorId, accountAssignedRepId }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reps can post if it's their own note. Managers/admins can always post.
  const isManager = currentUser.role === 'admin' || currentUser.role === 'manager';
  const isOwnNote = noteAuthorId === currentUser.id || accountAssignedRepId === currentUser.id;
  const canPost = isManager || isOwnNote;

  const load = async () => {
    try {
      const r = await api.get<{ comments: Comment[] }>(`/notes/${noteId}/comments`);
      setComments(r.comments || []);
    } catch (e: any) {
      setError(e.error || 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [noteId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/notes/${noteId}/comments`, { body: body.trim() });
      setBody('');
      load();
    } catch (e: any) {
      setError(e.error || 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-t border-navy-100 pt-3">
      <div className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-2">
        Coaching & Replies {comments.length > 0 && `(${comments.length})`}
      </div>

      {loading ? (
        <div className="text-xs text-navy-400">Loading…</div>
      ) : comments.length === 0 ? (
        <div className="text-xs text-navy-400 italic">No replies yet.</div>
      ) : (
        <ul className="space-y-2">
          {comments.map(c => (
            <li key={c.id} className="bg-navy-50 rounded-lg p-2.5">
              <div className="flex items-center gap-2 text-xs mb-1">
                <span className="font-semibold text-navy-900">
                  {c.first_name} {c.last_name}
                </span>
                {(c.role === 'manager' || c.role === 'admin') && (
                  <span className="px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded text-[10px] font-medium uppercase">
                    {c.role}
                  </span>
                )}
                <span className="text-navy-400 ml-auto">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div className="text-sm text-navy-800 whitespace-pre-wrap">{c.body}</div>
            </li>
          ))}
        </ul>
      )}

      {canPost ? (
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            type="text"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={isManager ? 'Reply with coaching or @mention a teammate…' : 'Reply…'}
            className="flex-1 px-3 py-2 text-sm border border-navy-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            disabled={submitting}
            maxLength={4000}
          />
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="px-3 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1 text-sm"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      ) : (
        <div className="text-xs text-navy-400 italic mt-2">
          Only managers and admins can comment on other reps' notes.
        </div>
      )}

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  );
}
