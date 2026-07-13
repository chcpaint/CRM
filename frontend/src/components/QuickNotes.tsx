import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';

// ─── Types ───
interface NoteShare { user_id: number; name: string }
interface NoteAttachment {
  id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  thumbnail_url?: string | null;
  created_at: string;
}
interface Note {
  id: number;
  user_id: number;
  content: string;
  voice_url: string | null;
  voice_duration_sec: number | null;
  reminder_at: string | null;
  reminder_sent: boolean;
  reminder_dismissed: boolean;
  is_pinned: boolean;
  color: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  author_name?: string;
  is_owner?: boolean;
  shared_with?: NoteShare[];
  attachments?: NoteAttachment[];
}

interface PendingFile {
  file: File;
  preview: string | null; // data URL for images
  dataUrl: string; // full data URL for upload
}

interface ShareableUser { id: number; first_name: string; last_name: string; role: string }

const COLORS: { value: string; label: string; bg: string; border: string; swatch: string }[] = [
  { value: 'default', label: 'Default', bg: 'bg-white',      border: 'border-navy-100',   swatch: 'bg-navy-200' },
  { value: 'yellow',  label: 'Yellow',  bg: 'bg-yellow-50',  border: 'border-yellow-300', swatch: 'bg-yellow-400' },
  { value: 'blue',    label: 'Blue',    bg: 'bg-blue-50',    border: 'border-blue-300',   swatch: 'bg-blue-400' },
  { value: 'green',   label: 'Green',   bg: 'bg-green-50',   border: 'border-green-300',  swatch: 'bg-green-400' },
  { value: 'pink',    label: 'Pink',    bg: 'bg-pink-50',    border: 'border-pink-300',   swatch: 'bg-pink-400' },
  { value: 'orange',  label: 'Orange',  bg: 'bg-orange-50',  border: 'border-orange-300', swatch: 'bg-orange-400' },
];

function getColorClasses(color: string) {
  return COLORS.find(c => c.value === color) || COLORS[0];
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function QuickNotes() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newReminder, setNewReminder] = useState('');
  const [newColor, setNewColor] = useState('default');
  const [showComposer, setShowComposer] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'reminders' | 'completed'>('active');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [shareNoteId, setShareNoteId] = useState<number | null>(null);
  const [shareUsers, setShareUsers] = useState<ShareableUser[]>([]);
  const [colorPickerId, setColorPickerId] = useState<number | null>(null);

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pendingVoiceBlob, setPendingVoiceBlob] = useState<Blob | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noteFileInputRef = useRef<HTMLInputElement>(null);
  const [attachToNoteId, setAttachToNoteId] = useState<number | null>(null);

  // ─── Load notes ───
  const loadNotes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/notes');
      setNotes(data.notes || []);
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadNotes();
  }, [open, loadNotes]);

  // ─── Keyboard shortcut: Cmd/Ctrl+J to toggle ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Create note ───
  const createNote = async () => {
    const content = newContent.trim();
    if (!content && !pendingVoiceBlob && pendingFiles.length === 0) return;
    try {
      const res = await api.post('/notes', {
        content: content || (pendingFiles.length > 0 ? '(Attachment)' : ''),
        reminder_at: newReminder || null,
        color: newColor,
      });
      // Upload voice recording if present
      if (pendingVoiceBlob && res.note) {
        await uploadVoice(res.note.id, pendingVoiceBlob);
      }
      // Upload file attachments if present
      if (pendingFiles.length > 0 && res.note) {
        await uploadAttachments(res.note.id, pendingFiles);
      }
      setNewContent('');
      setNewReminder('');
      setNewColor('default');
      setShowComposer(false);
      setPendingVoiceBlob(null);
      setPendingFiles([]);
      loadNotes();
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  // ─── Update note ───
  const updateNote = async (id: number, updates: Partial<Note>) => {
    try {
      await api.patch(`/notes/${id}`, updates);
      loadNotes();
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  // ─── Delete note ───
  const deleteNote = async (id: number) => {
    try {
      await api.delete(`/notes/${id}`);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  // ─── Toggle pin ───
  const togglePin = (note: Note) => updateNote(note.id, { is_pinned: !note.is_pinned } as any);

  // ─── Toggle complete ───
  const toggleComplete = (note: Note) => {
    updateNote(note.id, {
      completed_at: note.completed_at ? null : new Date().toISOString()
    } as any);
  };

  // ─── Voice recording ───
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunks.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        setPendingVoiceBlob(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordingTime(0);
      recordingInterval.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      mediaRecorder.current.stop();
    }
    setRecording(false);
    if (recordingInterval.current) clearInterval(recordingInterval.current);
  };

  const uploadVoice = async (noteId: number, blob: Blob) => {
    const reader = new FileReader();
    return new Promise<void>((resolve) => {
      reader.onloadend = async () => {
        try {
          await api.post(`/notes/${noteId}/voice`, {
            audio_data: reader.result as string,
            duration_sec: recordingTime,
          });
          resolve();
        } catch (err) {
          console.error('Voice upload failed:', err);
          resolve();
        }
      };
      reader.readAsDataURL(blob);
    });
  };

  // ─── Share ───
  const openShare = async (noteId: number) => {
    setShareNoteId(noteId);
    try {
      const data = await api.get('/notes/users');
      setShareUsers(data.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const shareWith = async (userId: number) => {
    if (!shareNoteId) return;
    try {
      await api.post(`/notes/${shareNoteId}/share`, { user_id: userId });
      setShareNoteId(null);
      loadNotes();
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  // ─── File attachments ───
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > 10 * 1024 * 1024) {
        alert(`"${file.name}" is too large (max 10MB)`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const isImage = file.type.startsWith('image/');
        setPendingFiles(prev => [...prev, {
          file,
          preview: isImage ? dataUrl : null,
          dataUrl,
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = ''; // reset so same file can be re-selected
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const uploadAttachments = async (noteId: number, files: PendingFile[]) => {
    for (const pf of files) {
      try {
        // For images, generate a smaller thumbnail
        let thumbnailUrl: string | null = null;
        if (pf.file.type.startsWith('image/')) {
          thumbnailUrl = await generateThumbnail(pf.dataUrl, 200);
        }
        await api.post(`/notes/${noteId}/attachments`, {
          file_name: pf.file.name,
          file_type: pf.file.type,
          file_size: pf.file.size,
          data_url: pf.dataUrl,
          thumbnail_url: thumbnailUrl,
        });
      } catch (err) {
        console.error(`Failed to upload ${pf.file.name}:`, err);
      }
    }
  };

  const generateThumbnail = (dataUrl: string, maxDim: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) { h = (h / w) * maxDim; w = maxDim; }
        else { w = (w / h) * maxDim; h = maxDim; }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const addAttachmentToNote = async (noteId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setUploadingAttachment(true);
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { alert(`"${file.name}" too large (max 10MB)`); continue; }
      const reader = new FileReader();
      await new Promise<void>((resolve) => {
        reader.onloadend = async () => {
          const dataUrl = reader.result as string;
          let thumbnailUrl: string | null = null;
          if (file.type.startsWith('image/')) {
            thumbnailUrl = await generateThumbnail(dataUrl, 200);
          }
          try {
            await api.post(`/notes/${noteId}/attachments`, {
              file_name: file.name,
              file_type: file.type,
              file_size: file.size,
              data_url: dataUrl,
              thumbnail_url: thumbnailUrl,
            });
          } catch (err) { console.error('Attachment upload failed:', err); }
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
    e.target.value = '';
    setAttachToNoteId(null);
    setUploadingAttachment(false);
    loadNotes();
  };

  const deleteAttachment = async (noteId: number, attachmentId: number) => {
    try {
      await api.delete(`/notes/${noteId}/attachments/${attachmentId}`);
      loadNotes();
    } catch (err) { console.error('Failed to delete attachment:', err); }
  };

  const downloadAttachment = async (noteId: number, attachment: NoteAttachment) => {
    try {
      const data = await api.get(`/notes/${noteId}/attachments/${attachment.id}/download`);
      if (data.attachment?.data_url) {
        const a = document.createElement('a');
        a.href = data.attachment.data_url;
        a.download = attachment.file_name;
        a.click();
      }
    } catch (err) { console.error('Download failed:', err); }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // ─── Inline edit ───
  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    await updateNote(editingId, { content: editContent } as any);
    setEditingId(null);
    setEditContent('');
  };

  // ─── Filter notes ───
  const filteredNotes = notes.filter(n => {
    switch (filter) {
      case 'active': return !n.completed_at;
      case 'reminders': return !!n.reminder_at && !n.completed_at;
      case 'completed': return !!n.completed_at;
      default: return true;
    }
  });

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ─── Render ───
  return (
    <>
      {/* ── Collapsed tab / FAB ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Quick Notes (Ctrl+J)"
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40
            hidden lg:flex items-center gap-1 px-1.5 py-4
            bg-brand-600 hover:bg-brand-700 text-white rounded-l-xl
            shadow-lg hover:shadow-xl transition-all duration-200
            writing-mode-vertical"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          <svg className="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span className="text-[11px] font-semibold tracking-wider uppercase">Notes</span>
          {notes.filter(n => !n.completed_at).length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-white text-brand-600 rounded-full">
              {notes.filter(n => !n.completed_at).length}
            </span>
          )}
        </button>
      )}

      {/* Mobile FAB */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="lg:hidden fixed right-4 bottom-20 z-40
            w-12 h-12 bg-brand-600 hover:bg-brand-700 text-white
            rounded-full shadow-xl flex items-center justify-center
            transition-all duration-200 active:scale-95"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          {notes.filter(n => !n.completed_at).length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 text-[10px] font-bold bg-yellow-400 text-navy-900 rounded-full flex items-center justify-center">
              {notes.filter(n => !n.completed_at).length}
            </span>
          )}
        </button>
      )}

      {/* ── Overlay (mobile) ── */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-[60]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Panel ── */}
      <div
        ref={panelRef}
        className={`fixed top-14 sm:top-16 right-0 bottom-0 z-[61]
          w-[340px] max-w-[90vw] bg-white/95 backdrop-blur-xl border-l border-navy-100/50
          shadow-[-8px_0_30px_rgba(0,0,0,0.1)]
          transform transition-transform duration-300 ease-out
          flex flex-col
          ${open ? 'translate-x-0' : 'translate-x-full'}
          lg:bottom-0
          max-lg:top-0 max-lg:bottom-[60px] max-lg:rounded-l-2xl`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-navy-100/50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <h2 className="font-bold text-navy-900 text-sm">Quick Notes</h2>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-navy-400 hidden sm:inline">Ctrl+J</span>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-navy-100 transition-colors text-navy-400 hover:text-navy-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Quick capture bar */}
        <div className="px-3 py-2 border-b border-navy-50 flex-shrink-0">
          {!showComposer ? (
            <button
              onClick={() => { setShowComposer(true); setTimeout(() => inputRef.current?.focus(), 50); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-navy-50/80 hover:bg-navy-100/80 text-navy-400 text-sm transition-colors text-left"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add a note or reminder...
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                ref={inputRef}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createNote(); }}
                placeholder="What's on your mind?"
                rows={3}
                className="w-full px-3 py-2 rounded-xl border border-navy-200 focus:border-brand-400 focus:ring-1 focus:ring-brand-400 text-sm resize-none outline-none"
              />
              {/* Voice recording + file attach */}
              <div className="flex items-center gap-2">
                {recording ? (
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 text-red-600 text-xs font-medium animate-pulse"
                  >
                    <span className="w-2 h-2 bg-red-500 rounded-full" />
                    {formatDuration(recordingTime)} — Tap to stop
                  </button>
                ) : (
                  <>
                    <button
                      onClick={startRecording}
                      title="Record voice note"
                      className="p-2 rounded-lg hover:bg-navy-100 text-navy-400 hover:text-brand-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach photo or file"
                      className="p-2 rounded-lg hover:bg-navy-100 text-navy-400 hover:text-brand-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </>
                )}
                {pendingVoiceBlob && !recording && (
                  <span className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" /></svg>
                    Voice attached ({formatDuration(recordingTime)})
                  </span>
                )}
              </div>
              {/* Pending file previews */}
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pendingFiles.map((pf, idx) => (
                    <div key={idx} className="relative group/file">
                      {pf.preview ? (
                        <img src={pf.preview} alt={pf.file.name} className="w-14 h-14 object-cover rounded-lg border border-navy-200" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg border border-navy-200 bg-navy-50 flex flex-col items-center justify-center">
                          <svg className="w-5 h-5 text-navy-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="text-[8px] text-navy-400 mt-0.5 truncate max-w-[52px] px-1">{pf.file.name.split('.').pop()}</span>
                        </div>
                      )}
                      <button
                        onClick={() => removePendingFile(idx)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/file:opacity-100 transition-opacity"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Reminder picker */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-navy-500 font-medium flex-shrink-0">Remind:</label>
                <input
                  type="datetime-local"
                  value={newReminder}
                  onChange={(e) => setNewReminder(e.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-navy-200 text-xs outline-none focus:border-brand-400"
                />
              </div>
              {/* Color picker */}
              <div className="flex items-center gap-1.5">
                {COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setNewColor(c.value)}
                    title={c.label}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${c.swatch} ${
                      newColor === c.value ? 'border-navy-800 scale-110 ring-2 ring-brand-300' : 'border-white hover:scale-105'
                    }`}
                  />
                ))}
              </div>
              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => { setShowComposer(false); setNewContent(''); setNewReminder(''); setNewColor('default'); setPendingVoiceBlob(null); setPendingFiles([]); }}
                  className="text-xs text-navy-400 hover:text-navy-600 px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={createNote}
                  disabled={!newContent.trim() && !pendingVoiceBlob && pendingFiles.length === 0}
                  className="px-4 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Save Note
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-navy-50 flex-shrink-0">
          {([
            { key: 'active', label: 'Active' },
            { key: 'reminders', label: 'Reminders' },
            { key: 'completed', label: 'Done' },
            { key: 'all', label: 'All' },
          ] as { key: typeof filter; label: string }[]).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                filter === f.key
                  ? 'bg-brand-600 text-white'
                  : 'text-navy-500 hover:bg-navy-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && notes.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center py-8">
              <svg className="w-10 h-10 text-navy-200 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <p className="text-xs text-navy-400">
                {filter === 'active' ? 'No active notes. Add one above!' :
                 filter === 'reminders' ? 'No reminders set.' :
                 filter === 'completed' ? 'No completed notes.' : 'No notes yet.'}
              </p>
            </div>
          ) : (
            filteredNotes.map(note => {
              const colors = getColorClasses(note.color);
              const isEditing = editingId === note.id;
              return (
                <div
                  key={note.id}
                  className={`rounded-xl border p-3 transition-all duration-200 group ${colors.bg} ${colors.border}
                    ${note.completed_at ? 'opacity-60' : ''}
                    ${note.is_pinned ? 'ring-1 ring-brand-200' : ''}`}
                >
                  {/* Pin indicator */}
                  {note.is_pinned && (
                    <div className="text-[10px] text-brand-500 font-semibold mb-1 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" /></svg>
                      Pinned
                    </div>
                  )}

                  {/* Content */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="w-full px-2 py-1.5 rounded-lg border border-navy-200 text-sm resize-none outline-none focus:border-brand-400"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="text-xs text-navy-400 px-2 py-1">Cancel</button>
                        <button onClick={saveEdit} className="text-xs bg-brand-600 text-white px-3 py-1 rounded-lg">Save</button>
                      </div>
                    </div>
                  ) : (
                    <p
                      className={`text-sm text-navy-800 whitespace-pre-wrap cursor-pointer ${note.completed_at ? 'line-through' : ''}`}
                      onClick={() => note.is_owner !== false && startEdit(note)}
                    >
                      {note.content || '(Voice note)'}
                    </p>
                  )}

                  {/* Voice playback */}
                  {note.voice_url && (
                    <div className="mt-2">
                      <audio controls src={note.voice_url} className="w-full h-8" style={{ height: '32px' }} />
                    </div>
                  )}

                  {/* Attachments */}
                  {note.attachments && note.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {note.attachments.map(att => {
                        const isImage = att.file_type.startsWith('image/');
                        return (
                          <div key={att.id} className="relative group/att">
                            {isImage && att.thumbnail_url ? (
                              <img
                                src={att.thumbnail_url}
                                alt={att.file_name}
                                className="w-16 h-16 object-cover rounded-lg border border-navy-200 cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => {
                                  // Fetch full image and show preview
                                  api.get(`/notes/${note.id}/attachments/${att.id}/download`).then(d => {
                                    if (d.attachment?.data_url) setPreviewImage(d.attachment.data_url);
                                  });
                                }}
                              />
                            ) : (
                              <button
                                onClick={() => downloadAttachment(note.id, att)}
                                className="w-16 h-16 rounded-lg border border-navy-200 bg-navy-50 hover:bg-navy-100 flex flex-col items-center justify-center transition-colors"
                              >
                                <svg className="w-5 h-5 text-navy-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                <span className="text-[7px] text-navy-500 mt-0.5 truncate max-w-[56px] px-1 font-medium">{att.file_name.split('.').pop()?.toUpperCase()}</span>
                              </button>
                            )}
                            <div className="absolute -bottom-0.5 left-0 right-0 text-center">
                              <span className="text-[7px] text-navy-400 bg-white/80 px-1 rounded">{formatFileSize(att.file_size)}</span>
                            </div>
                            {note.is_owner !== false && (
                              <button
                                onClick={() => deleteAttachment(note.id, att.id)}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity"
                              >
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reminder badge */}
                  {note.reminder_at && !note.completed_at && (
                    <div className={`mt-2 flex items-center gap-1 text-[10px] font-medium ${
                      new Date(note.reminder_at) <= new Date() ? 'text-red-600' : 'text-navy-500'
                    }`}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {new Date(note.reminder_at) <= new Date() ? 'Due! ' : ''}
                      {new Date(note.reminder_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  )}

                  {/* Shared badge */}
                  {note.shared_with && note.shared_with.length > 0 && (
                    <div className="mt-1.5 text-[10px] text-navy-400 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Shared with {note.shared_with.map(s => s.name.split(' ')[0]).join(', ')}
                    </div>
                  )}
                  {!note.is_owner && note.author_name && (
                    <div className="mt-1 text-[10px] text-navy-400">From {note.author_name}</div>
                  )}

                  {/* Footer: timestamp + actions */}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-navy-400">{timeAgo(note.created_at)}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Complete */}
                      {note.is_owner !== false && (
                        <button
                          onClick={() => toggleComplete(note)}
                          title={note.completed_at ? 'Mark active' : 'Mark done'}
                          className="p-1 rounded hover:bg-navy-100 text-navy-400 hover:text-green-600 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={note.completed_at ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" : "M5 13l4 4L19 7"} />
                          </svg>
                        </button>
                      )}
                      {/* Pin */}
                      {note.is_owner !== false && (
                        <button
                          onClick={() => togglePin(note)}
                          title={note.is_pinned ? 'Unpin' : 'Pin to top'}
                          className={`p-1 rounded hover:bg-navy-100 transition-colors ${note.is_pinned ? 'text-brand-500' : 'text-navy-400 hover:text-brand-500'}`}
                        >
                          <svg className="w-3.5 h-3.5" fill={note.is_pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                          </svg>
                        </button>
                      )}
                      {/* Color */}
                      {note.is_owner !== false && (
                        <button
                          onClick={() => setColorPickerId(colorPickerId === note.id ? null : note.id)}
                          title="Change color"
                          className="p-1 rounded hover:bg-navy-100 text-navy-400 hover:text-navy-600 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                          </svg>
                        </button>
                      )}
                      {/* Attach file */}
                      {note.is_owner !== false && (
                        <button
                          onClick={() => { setAttachToNoteId(note.id); setTimeout(() => noteFileInputRef.current?.click(), 50); }}
                          title="Attach photo or file"
                          className={`p-1 rounded hover:bg-navy-100 transition-colors ${uploadingAttachment && attachToNoteId === note.id ? 'text-brand-500 animate-pulse' : 'text-navy-400 hover:text-brand-500'}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                        </button>
                      )}
                      {/* Share */}
                      {note.is_owner !== false && (
                        <button
                          onClick={() => openShare(note.id)}
                          title="Share with team member"
                          className="p-1 rounded hover:bg-navy-100 text-navy-400 hover:text-blue-500 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                        </button>
                      )}
                      {/* Delete */}
                      {note.is_owner !== false && (
                        <button
                          onClick={() => deleteNote(note.id)}
                          title="Delete"
                          className="p-1 rounded hover:bg-red-50 text-navy-400 hover:text-red-500 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Color picker dropdown */}
                  {colorPickerId === note.id && (
                    <div className="mt-2 flex items-center gap-1.5 p-2 bg-white rounded-lg border border-navy-100 shadow-sm">
                      {COLORS.map(c => (
                        <button
                          key={c.value}
                          onClick={() => { updateNote(note.id, { color: c.value } as any); setColorPickerId(null); }}
                          title={c.label}
                          className={`w-7 h-7 rounded-full border-2 transition-all ${c.swatch} ${
                            note.color === c.value ? 'border-navy-800 scale-110 ring-2 ring-brand-300' : 'border-white hover:scale-105'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Hidden file input for attaching to existing notes */}
      <input
        ref={noteFileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
        onChange={(e) => attachToNoteId && addAttachmentToNote(attachToNoteId, e)}
        className="hidden"
      />

      {/* ── Image Preview Modal ── */}
      {previewImage && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[80]" onClick={() => setPreviewImage(null)} />
          <div className="fixed inset-4 z-[81] flex items-center justify-center" onClick={() => setPreviewImage(null)}>
            <img src={previewImage} alt="Preview" className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 w-8 h-8 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </>
      )}

      {/* ── Share Modal ── */}
      {shareNoteId && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[70]" onClick={() => setShareNoteId(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] w-80 bg-white rounded-2xl shadow-2xl p-5">
            <h3 className="font-bold text-navy-900 text-sm mb-3">Share note with...</h3>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {shareUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => shareWith(u.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-navy-50 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {u.first_name[0]}{u.last_name[0]}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-navy-900">{u.first_name} {u.last_name}</div>
                    <div className="text-[10px] text-navy-400 capitalize">{u.role}</div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShareNoteId(null)}
              className="mt-3 w-full py-2 rounded-xl bg-navy-100 text-navy-600 text-xs font-medium hover:bg-navy-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  );
}
