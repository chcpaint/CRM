import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { User, Account, Note, Activity, PhoneEntry, EmailEntry, STATUS_LABELS, STATUS_COLORS, StatusType } from '../types';
import { useVoiceInput } from '../hooks/useVoiceInput';
import ShopDetails from '../components/accounts/ShopDetails';

interface Props { user: User }

export default function AccountDetailPage({ user }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Account>>({});
  const [editPhones, setEditPhones] = useState<PhoneEntry[]>([]);
  const [editEmails, setEditEmails] = useState<EmailEntry[]>([]);

  const EMAIL_TYPES = ['', 'Painter', 'Admin', 'Manager', 'Owner'] as const;

  // Parse phone_numbers JSON from account
  const parsePhoneNumbers = (acc: Account): PhoneEntry[] => {
    try {
      const raw = acc.phone_numbers;
      if (!raw) return acc.phone ? [{ number: acc.phone, label: 'Main', is_primary: true }] : [];
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(arr) && arr.length > 0) return arr;
      return acc.phone ? [{ number: acc.phone, label: 'Main', is_primary: true }] : [];
    } catch {
      return acc.phone ? [{ number: acc.phone, label: 'Main', is_primary: true }] : [];
    }
  };

  // Parse email_addresses JSON from account
  const parseEmailAddresses = (acc: Account): EmailEntry[] => {
    try {
      const raw = acc.email_addresses;
      if (!raw) return acc.email ? [{ address: acc.email, type: '', is_primary: true }] : [];
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(arr) && arr.length > 0) return arr;
      return acc.email ? [{ address: acc.email, type: '', is_primary: true }] : [];
    } catch {
      return acc.email ? [{ address: acc.email, type: '', is_primary: true }] : [];
    }
  };

  // Note input — with auto-save draft
  const draftKey = `note-draft-${id}`;
  const [newNote, setNewNote] = useState(() => {
    try { return sessionStorage.getItem(draftKey) || ''; } catch { return ''; }
  });
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);   // "Note Saved!" confirmation state
  const [draftRestored, setDraftRestored] = useState(() => {
    try { return !!(sessionStorage.getItem(draftKey)); } catch { return false; }
  });

  // Auto-save draft to sessionStorage on every change
  useEffect(() => {
    try {
      if (newNote.trim()) {
        sessionStorage.setItem(draftKey, newNote);
      } else {
        sessionStorage.removeItem(draftKey);
        setDraftRestored(false);
      }
    } catch { /* ignore storage errors */ }
  }, [newNote, draftKey]);

  // Note activity type (optional dropdown beside note)
  const [noteActivityType, setNoteActivityType] = useState('none');

  // Auto-log toast
  const [autoLogToast, setAutoLogToast] = useState('');

  // PCR guard modal
  const [pcrWarning, setPcrWarning] = useState<string | null>(null);
  // Note transfer
  const [activeMatch, setActiveMatch] = useState<{id: number; shop_name: string; branch: string | null; pcr_managed: boolean} | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<string | null>(null);
  const [selectedNotesForTransfer, setSelectedNotesForTransfer] = useState<number[]>([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');

  // Edit note (declared early for unsaved-changes guard)
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteContent, setEditNoteContent] = useState('');
  const [savingEditNote, setSavingEditNote] = useState(false);

  // ─── Unsaved-changes guard ───
  // Dirty when note textarea has content OR an existing note is being edited
  const hasUnsavedWork = newNote.trim().length > 0 || editingNoteId !== null;
  const hasUnsavedRef = useRef(hasUnsavedWork);
  hasUnsavedRef.current = hasUnsavedWork;

  // Show unsaved-changes prompt state
  const [showLeavePrompt, setShowLeavePrompt] = useState(false);
  const pendingNavRef = useRef<(() => void) | null>(null);

  // Browser close / refresh guard
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedWork]);

  // Back button guard (popstate)
  useEffect(() => {
    if (!hasUnsavedWork) return;
    // Push a duplicate entry so pressing Back triggers popstate without leaving
    window.history.pushState(null, '', window.location.href);
    const handler = () => {
      if (hasUnsavedRef.current) {
        // Re-push to keep them on the page until they confirm
        window.history.pushState(null, '', window.location.href);
        setShowLeavePrompt(true);
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [hasUnsavedWork]);

  // Check for matching active customer when viewing a lead
  useEffect(() => {
    if (account && account.account_category === 'lead') {
      api.get(`/accounts/${account.id}/find-active-match`).then(data => {
        if (data.match) setActiveMatch(data.match);
      }).catch(() => {});
    }
  }, [account?.id, account?.account_category]);

  // Follow-up scheduling
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  // Document Vault
  interface AccountDocument {
    id: number;
    account_id: number;
    document_type: string;
    title: string;
    description: string | null;
    file_path: string;
    original_filename: string;
    file_size: number;
    mime_type: string;
    uploaded_by_id: number;
    expires_at: string | null;
    is_active: boolean;
    created_at: string;
    first_name: string;
    last_name: string;
  }
  const [documents, setDocuments] = useState<AccountDocument[]>([]);
  const [showDocUpload, setShowDocUpload] = useState(false);
  const [docForm, setDocForm] = useState({ document_type: 'contract', title: '', description: '', expires_at: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const DOC_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    contract:              { label: 'Contract',              icon: '📄', color: 'bg-blue-100 text-blue-800' },
    pricing_agreement:     { label: 'Pricing Agreement',     icon: '💰', color: 'bg-green-100 text-green-800' },
    rebate:                { label: 'Rebate',                icon: '🏷️', color: 'bg-purple-100 text-purple-800' },
    credit_application:    { label: 'Credit Application',    icon: '🏦', color: 'bg-amber-100 text-amber-800' },
    insurance_certificate: { label: 'Insurance Certificate', icon: '🛡️', color: 'bg-teal-100 text-teal-800' },
    photo:                 { label: 'Photo',                 icon: '📸', color: 'bg-pink-100 text-pink-800' },
    correspondence:        { label: 'Correspondence',        icon: '✉️', color: 'bg-indigo-100 text-indigo-800' },
    other:                 { label: 'Other',                 icon: '📎', color: 'bg-navy-100 text-navy-800' },
  };

  const loadDocuments = async () => {
    try {
      const data = await api.get(`/accounts/${id}/documents`);
      setDocuments(data.documents || []);
    } catch (err) { console.error(err); }
  };

  const uploadDocument = async () => {
    if (!docFile || !docForm.title.trim()) return;
    setUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append('file', docFile);
      formData.append('document_type', docForm.document_type);
      formData.append('title', docForm.title.trim());
      if (docForm.description) formData.append('description', docForm.description.trim());
      if (docForm.expires_at) formData.append('expires_at', docForm.expires_at);

      const token = localStorage.getItem('token');
      const baseUrl = (import.meta as any).env?.VITE_API_URL || '';
      const resp = await fetch(`${baseUrl}/api/accounts/${id}/documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!resp.ok) throw new Error('Upload failed');
      setShowDocUpload(false);
      setDocForm({ document_type: 'contract', title: '', description: '', expires_at: '' });
      setDocFile(null);
      loadDocuments();
    } catch (err) { console.error(err); }
    finally { setUploadingDoc(false); }
  };

  const deleteDocument = async (docId: number) => {
    if (!confirm('Remove this document?')) return;
    try {
      await api.delete(`/documents/${docId}`);
      loadDocuments();
    } catch (err) { console.error(err); }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const { isListening, startListening, stopListening, isSupported } = useVoiceInput(
    (text) => setNewNote(prev => prev + (prev ? ' ' : '') + text)
  );

  useEffect(() => { loadAccount(); loadDocuments(); }, [id]);

  const loadAccount = async () => {
    try {
      const data = await api.get(`/accounts/${id}`);
      setAccount(data.account);
      setNotes(data.notes);
      setActivities(data.activities);
      setEditForm(data.account);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveNote = async () => {
    if (!newNote.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await api.post(`/accounts/${id}/notes`, {
        content: newNote.trim(),
        is_voice_transcribed: isListening
      });
      // If an activity type was selected, also log the activity
      if (noteActivityType !== 'none') {
        await api.post(`/accounts/${id}/activities`, {
          activity_type: noteActivityType,
          description: newNote.trim()
        });
      }
      // Clear everything first, then remove from storage
      setNewNote('');
      setNoteActivityType('none');
      setDraftRestored(false);
      try { sessionStorage.removeItem(draftKey); } catch {}

      // Show "Note Saved!" confirmation
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 3000);

      loadAccount();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingNote(false);
    }
  };

  const updateNote = async () => {
    if (!editNoteContent.trim() || !editingNoteId) return;
    setSavingEditNote(true);
    try {
      await api.put(`/notes/${editingNoteId}`, { content: editNoteContent.trim() });
      setEditingNoteId(null);
      setEditNoteContent('');
      loadAccount();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingEditNote(false);
    }
  };

  // Activity type config: label + icon + color
  const ACTIVITY_TAGS: Record<string, { label: string; icon: string; bg: string }> = {
    call:                     { label: 'Call',                    icon: '📞', bg: 'bg-green-100' },
    email:                    { label: 'Email',                   icon: '📧', bg: 'bg-purple-100' },
    text:                     { label: 'Text',                    icon: '💬', bg: 'bg-blue-100' },
    meeting:                  { label: 'Meeting',                 icon: '🤝', bg: 'bg-amber-100' },
    visit:                    { label: 'Visit',                   icon: '🚗', bg: 'bg-teal-100' },
    sales_call:               { label: 'Sales Call',              icon: '💼', bg: 'bg-indigo-100' },
    drop_in:                  { label: 'Drop In',                 icon: '🚪', bg: 'bg-orange-100' },
    contract_presentation:    { label: 'Contract Presentation',   icon: '📑', bg: 'bg-red-100' },
    proposal:                 { label: 'Proposal',                icon: '📄', bg: 'bg-cyan-100' },
    product_demo:             { label: 'Product Demo',            icon: '🎯', bg: 'bg-pink-100' },
    vendor_partner_visit:     { label: 'Vendor/Partner Visit',    icon: '🏢', bg: 'bg-lime-100' },
    other:                    { label: 'Other',                   icon: '📋', bg: 'bg-navy-100' },
  };

  // Auto-log: fires native action AND logs the activity automatically
  const handleContactAction = async (type: 'call' | 'sms' | 'email', href: string) => {
    // Fire the native action
    window.location.href = href;
    // Auto-log the activity
    try {
      const actType = type === 'sms' ? 'text' : type;
      await api.post(`/accounts/${id}/activities`, {
        activity_type: actType,
        description: `${actType.charAt(0).toUpperCase() + actType.slice(1)} initiated from app`
      });
      setAutoLogToast(`${actType.charAt(0).toUpperCase() + actType.slice(1)} logged`);
      setTimeout(() => setAutoLogToast(''), 3000);
      // Refresh to show in timeline
      setTimeout(() => loadAccount(), 1000);
    } catch (err) {
      console.error('Auto-log failed:', err);
    }
  };

  const scheduleFollowUp = async () => {
    if (!followUpDate) return;
    setSavingFollowUp(true);
    try {
      await api.post(`/accounts/${id}/follow-up`, {
        follow_up_date: followUpDate,
        follow_up_notes: followUpNotes || null
      });
      setShowFollowUp(false);
      setFollowUpDate('');
      setFollowUpNotes('');
      loadAccount();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingFollowUp(false);
    }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/accounts/${id}`, {
        ...editForm,
        phone_numbers: JSON.stringify(editPhones),
        email_addresses: JSON.stringify(editEmails),
      });
      setEditing(false);
      setPcrWarning(null);
      loadAccount();
    } catch (err: any) {
      // Check for PCR guard error
      if (err?.response?.error === 'pcr_required' || err?.error === 'pcr_required') {
        const msg = err?.response?.message || err?.message || 'Active customers are managed through the AccountEdge/PCR file.';
        setPcrWarning(msg);
        // Reset status back so user isn't stuck
        setEditForm(f => ({...f, status: account?.status, account_category: account?.account_category}));
      } else {
        console.error(err);
      }
    }
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!account) return (
    <div className="card text-center py-12">
      <p className="text-navy-500">Account not found</p>
      <button onClick={() => navigate('/accounts')} className="btn-primary mt-4">Back to Accounts</button>
    </div>
  );

  // Derive primary phone & email from the phone_numbers / email_addresses arrays
  const cleanPhone = (phone: string) => phone.replace(/[^\d+]/g, '');
  const accountPhones = parsePhoneNumbers(account);
  const primaryPhone = accountPhones.find(p => p.is_primary) || accountPhones[0] || null;
  const hasPhone = !!primaryPhone?.number?.trim();
  const phoneHref = hasPhone ? cleanPhone(primaryPhone!.number) : '';
  const phoneDisplay = primaryPhone ? `${primaryPhone.number}${primaryPhone.label ? ` (${primaryPhone.label})` : ''}` : '';

  const accountEmails = parseEmailAddresses(account);
  const primaryEmail = accountEmails.find(e => e.is_primary) || accountEmails[0] || null;
  const hasEmail = !!primaryEmail?.address?.trim();
  const emailDisplay = primaryEmail ? `${primaryEmail.address}${primaryEmail.type ? ` (${primaryEmail.type})` : ''}` : '';

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <button onClick={() => navigate(`/accounts?category=${account.account_category || 'lead'}`)} className="text-sm text-navy-400 hover:text-navy-600 mb-2 flex items-center gap-1">
            &larr; Back to {account.account_category === 'customer' ? 'Customers' : 'Leads'}
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-900">{account.shop_name}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {account.account_category === 'customer' ? (
              <span className="badge badge-active">Active Customer</span>
            ) : (
              <span className={`badge ${STATUS_COLORS[account.status]}`}>{STATUS_LABELS[account.status]}</span>
            )}
            {account.branch && (
              <span className="inline-flex items-center gap-1 text-sm text-brand-600 font-medium bg-brand-50 px-2 py-0.5 rounded">
                📍 {account.branch}
              </span>
            )}
            {account.city && (!account.branch || !account.city.toLowerCase().includes(account.branch.toLowerCase())) && (
              <span className="text-sm text-navy-500">{account.city}{account.province ? `, ${account.province}` : ''}</span>
            )}
            {account.contact_names && <span className="text-sm text-navy-400">{account.contact_names}</span>}
          </div>
        </div>
        <button onClick={() => { if (!editing && account) { setEditPhones(parsePhoneNumbers(account)); setEditEmails(parseEmailAddresses(account)); } setEditing(!editing); }} className="btn-ghost text-sm self-start">
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {/* ═══ CONTACT ACTION BAR ═══ */}
      {/* Tap to call/text/email — auto-logs the activity */}
      {(hasPhone || hasEmail) && !editing && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4 sm:mb-6">
          {hasPhone ? (
            <button
              onClick={() => handleContactAction('call', `tel:${phoneHref}`)}
              className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors active:scale-95"
            >
              <span className="text-2xl">📞</span>
              <span className="text-xs sm:text-sm font-medium">Call</span>
              <span className="text-[10px] text-green-500 hidden sm:block truncate max-w-full px-2">{phoneDisplay}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-navy-50 border border-navy-100 text-navy-300">
              <span className="text-2xl opacity-40">📞</span>
              <span className="text-xs sm:text-sm font-medium">No phone</span>
            </div>
          )}

          {hasPhone ? (
            <button
              onClick={() => handleContactAction('sms', `sms:${phoneHref}`)}
              className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors active:scale-95"
            >
              <span className="text-2xl">💬</span>
              <span className="text-xs sm:text-sm font-medium">Text</span>
              <span className="text-[10px] text-blue-500 hidden sm:block truncate max-w-full px-2">{phoneDisplay}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-navy-50 border border-navy-100 text-navy-300">
              <span className="text-2xl opacity-40">💬</span>
              <span className="text-xs sm:text-sm font-medium">No phone</span>
            </div>
          )}

          {hasEmail ? (
            <button
              onClick={() => handleContactAction('email', `mailto:${primaryEmail!.address}`)}
              className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 transition-colors active:scale-95"
            >
              <span className="text-2xl">📧</span>
              <span className="text-xs sm:text-sm font-medium">Email</span>
              <span className="text-[10px] text-purple-500 hidden sm:block truncate max-w-full px-2">{emailDisplay}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 sm:py-4 rounded-xl bg-navy-50 border border-navy-100 text-navy-300">
              <span className="text-2xl opacity-40">📧</span>
              <span className="text-xs sm:text-sm font-medium">No email</span>
            </div>
          )}
        </div>
      )}

      {/* Unsaved Changes Modal */}
      {showLeavePrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-scale-in">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-navy-900 text-lg">Save Your Work!</h3>
                <p className="text-navy-600 text-sm mt-2">
                  You have unsaved notes that will be lost if you leave this page. Would you like to go back and save your work?
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowLeavePrompt(false);
                  // Actually navigate back
                  window.history.go(-1);
                }}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"
              >
                Leave Without Saving
              </button>
              <button
                onClick={() => setShowLeavePrompt(false)}
                className="btn-primary"
              >
                Go Back & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-log toast */}
      {autoLogToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg animate-slide-down">
          ✓ {autoLogToast}
        </div>
      )}

      {/* Contact Info — compact row */}
      <div className="card mb-4 sm:mb-6">
        <h3 className="font-bold text-navy-900 mb-4">Contact Information</h3>
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-navy-500 mb-1">Shop Name</label>
                <input className="input-field" value={editForm.shop_name || ''} onChange={e => setEditForm(f => ({...f, shop_name: e.target.value}))} />
              </div>
              <div>
                <label className="block text-xs text-navy-500 mb-1">Contact Names</label>
                <input className="input-field" value={editForm.contact_names || ''} onChange={e => setEditForm(f => ({...f, contact_names: e.target.value}))} />
              </div>
              <div>
                <label className="block text-xs text-navy-500 mb-1">Address</label>
                <input className="input-field" value={editForm.address || ''} onChange={e => setEditForm(f => ({...f, address: e.target.value}))} />
              </div>
              <div>
                <label className="block text-xs text-navy-500 mb-1">City</label>
                <input className="input-field" value={editForm.city || ''} onChange={e => setEditForm(f => ({...f, city: e.target.value}))} />
              </div>
              <div>
                <label className="block text-xs text-navy-500 mb-1">Status</label>
                <select className="input-field" value={editForm.status || 'prospect'} onChange={e => {
                  const newStatus = e.target.value as StatusType;
                  if (newStatus === 'active' && account?.status !== 'active' && !account?.pcr_managed) {
                    setPcrWarning('Active Customer status is controlled by the AccountEdge/PCR report. Shops become Active Customers automatically when they appear in the PCR data from AccountEdge. If this shop should be active, it needs to be added in AccountEdge first.');
                    return;
                  }
                  setEditForm(f => ({...f, status: newStatus}));
                }}>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {account?.account_category === 'lead' && (
                  <p className="text-xs text-navy-400 mt-1">Active Customer status is set by PCR/AccountEdge</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-navy-500 mb-1">Branch</label>
                <select className="input-field" value={editForm.branch || ''} onChange={e => setEditForm(f => ({...f, branch: e.target.value}))}>
                  <option value="">— Unassigned —</option>
                  {['Hamilton', 'Markham', 'Oakville', 'Ottawa', 'St. Catharines', 'Woodbridge'].map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ─── Phone Numbers ─── */}
            <div className="border-t border-navy-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-navy-500 font-semibold uppercase">Phone Numbers</label>
                <button
                  type="button"
                  onClick={() => setEditPhones(prev => [...prev, { number: '', label: '', is_primary: prev.length === 0 }])}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                >
                  + Add Number
                </button>
              </div>
              {editPhones.length === 0 && (
                <p className="text-sm text-navy-400 italic">No phone numbers. Click "Add Number" to add one.</p>
              )}
              <div className="space-y-2">
                {editPhones.map((ph, i) => (
                  <div key={i} className={`flex items-center gap-2 p-2 rounded-lg border ${ph.is_primary ? 'border-green-300 bg-green-50' : 'border-navy-100 bg-white'}`}>
                    <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer" title="Set as main contact number">
                      <input
                        type="checkbox"
                        checked={ph.is_primary}
                        onChange={() => setEditPhones(prev => prev.map((p, j) => ({ ...p, is_primary: j === i })))}
                        className="w-4 h-4 accent-green-600"
                      />
                      <span className="text-[10px] text-navy-500 font-medium hidden sm:inline">Main</span>
                    </label>
                    <input
                      type="tel"
                      value={ph.number}
                      onChange={e => setEditPhones(prev => prev.map((p, j) => j === i ? { ...p, number: e.target.value } : p))}
                      className="input-field flex-1 min-w-0"
                      placeholder="e.g. 905-555-1234"
                    />
                    <input
                      type="text"
                      value={ph.label}
                      onChange={e => setEditPhones(prev => prev.map((p, j) => j === i ? { ...p, label: e.target.value } : p))}
                      className="input-field w-28 sm:w-36"
                      placeholder="Label (e.g. Neil)"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const updated = editPhones.filter((_, j) => j !== i);
                        // If we removed the primary, make first one primary
                        if (ph.is_primary && updated.length > 0) updated[0].is_primary = true;
                        setEditPhones(updated);
                      }}
                      className="text-red-400 hover:text-red-600 text-lg flex-shrink-0 px-1"
                      title="Remove"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              {editPhones.some(p => p.is_primary) && (
                <p className="text-[10px] text-green-600 mt-2">The checked number will be used for Call and Text buttons.</p>
              )}
            </div>

            {/* ─── Email Addresses ─── */}
            <div className="border-t border-navy-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-navy-500 font-semibold uppercase">Email Addresses</label>
                <button
                  type="button"
                  onClick={() => setEditEmails(prev => [...prev, { address: '', type: '', is_primary: prev.length === 0 }])}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                >
                  + Add Email
                </button>
              </div>
              {editEmails.length === 0 && (
                <p className="text-sm text-navy-400 italic">No email addresses. Click "Add Email" to add one.</p>
              )}
              <div className="space-y-2">
                {editEmails.map((em, i) => (
                  <div key={i} className={`flex items-center gap-2 p-2 rounded-lg border ${em.is_primary ? 'border-purple-300 bg-purple-50' : 'border-navy-100 bg-white'}`}>
                    <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer" title="Set as main email">
                      <input
                        type="checkbox"
                        checked={em.is_primary}
                        onChange={() => setEditEmails(prev => prev.map((e, j) => ({ ...e, is_primary: j === i })))}
                        className="w-4 h-4 accent-purple-600"
                      />
                      <span className="text-[10px] text-navy-500 font-medium hidden sm:inline">Main</span>
                    </label>
                    <input
                      type="email"
                      value={em.address}
                      onChange={e => setEditEmails(prev => prev.map((em2, j) => j === i ? { ...em2, address: e.target.value } : em2))}
                      className="input-field flex-1 min-w-0"
                      placeholder="e.g. joe@acmecollision.com"
                    />
                    <select
                      value={em.type}
                      onChange={e => setEditEmails(prev => prev.map((em2, j) => j === i ? { ...em2, type: e.target.value as EmailEntry['type'] } : em2))}
                      className="input-field w-28 sm:w-32"
                    >
                      <option value="">Type...</option>
                      {EMAIL_TYPES.filter(t => t).map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = editEmails.filter((_, j) => j !== i);
                        if (em.is_primary && updated.length > 0) updated[0].is_primary = true;
                        setEditEmails(updated);
                      }}
                      className="text-red-400 hover:text-red-600 text-lg flex-shrink-0 px-1"
                      title="Remove"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              {editEmails.some(e => e.is_primary) && (
                <p className="text-[10px] text-purple-600 mt-2">The checked email will be used for the Email button.</p>
              )}
            </div>

            <div>
              <button onClick={saveEdit} className="btn-primary w-full sm:w-auto">Save Changes</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 text-sm">
              <InfoRow label="Contact(s)" value={account.contact_names} />
              <InfoRow label="Address" value={account.address} />
              <InfoRow label="City" value={account.city} />
            </div>
            {/* Phone numbers list */}
            {(() => {
              const phones = parsePhoneNumbers(account);
              if (phones.length === 0) return <div className="text-sm text-navy-400 border-t border-navy-100 pt-3 mt-3">No phone numbers</div>;
              return (
                <div className="border-t border-navy-100 pt-3">
                  <div className="text-xs text-navy-500 font-semibold uppercase mb-2">Phone Numbers</div>
                  <div className="space-y-1.5">
                    {phones.map((ph, i) => {
                      const clean = ph.number.replace(/[^\d+]/g, '');
                      return (
                        <div key={i} className={`flex items-center gap-2 text-sm ${ph.is_primary ? 'font-medium text-navy-900' : 'text-navy-600'}`}>
                          {ph.is_primary && <span className="text-green-600 text-xs font-bold bg-green-50 px-1.5 py-0.5 rounded">Main</span>}
                          <a href={`tel:${clean}`} className="hover:text-brand-600 underline decoration-dotted">{ph.number}</a>
                          {ph.label && <span className="text-navy-400 text-xs">({ph.label})</span>}
                          <a href={`sms:${clean}`} className="text-blue-500 hover:text-blue-700 text-xs ml-1" title="Text this number">Text</a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {/* Email addresses list */}
            {(() => {
              const emails = parseEmailAddresses(account);
              if (emails.length === 0) return <div className="text-sm text-navy-400 border-t border-navy-100 pt-3">No email addresses</div>;
              return (
                <div className="border-t border-navy-100 pt-3">
                  <div className="text-xs text-navy-500 font-semibold uppercase mb-2">Email Addresses</div>
                  <div className="space-y-1.5">
                    {emails.map((em, i) => (
                      <div key={i} className={`flex items-center gap-2 text-sm ${em.is_primary ? 'font-medium text-navy-900' : 'text-navy-600'}`}>
                        {em.is_primary && <span className="text-purple-600 text-xs font-bold bg-purple-50 px-1.5 py-0.5 rounded">Main</span>}
                        <a href={`mailto:${em.address}`} className="hover:text-brand-600 underline decoration-dotted">{em.address}</a>
                        {em.type && <span className="text-navy-400 text-xs bg-navy-50 px-1.5 py-0.5 rounded">{em.type}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* PCR Warning Modal */}
      {pcrWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-navy-900 text-lg">Active Customers Controlled by PCR/AccountEdge</h3>
                <p className="text-navy-600 text-sm mt-2">{pcrWarning}</p>
                <p className="text-navy-500 text-sm mt-3">
                  Your CRM notes on this Lead will need to be moved to the active file once this shop appears in the PCR/AccountEdge report. Use the "Transfer Notes" feature to copy your notes over.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setPcrWarning(null)} className="btn-primary">Got it</button>
            </div>
          </div>
        </div>
      )}

      {/* Note Transfer Banner — shown on Leads that have a matching Active Customer from PCR */}
      {account.account_category === 'lead' && activeMatch && (
        <div className="card mb-4 sm:mb-6 border-l-4 border-blue-500 bg-blue-50">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="font-semibold text-blue-900">This Lead has a matching Active Customer from PCR/AccountEdge</p>
              <p className="text-sm text-blue-700 mt-1">
                "<strong>{activeMatch.shop_name}</strong>" exists as an active customer imported from the AccountEdge PCR report
                {activeMatch.branch ? ` (${activeMatch.branch} branch)` : ''}.
                You can copy or move your CRM notes from this Lead file to the active customer file.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/accounts/${activeMatch.id}`)}
                className="btn-secondary text-sm whitespace-nowrap"
              >
                View Active File
              </button>
              <button
                onClick={() => { setShowTransferModal(true); setSelectedNotesForTransfer([]); }}
                className="btn-primary text-sm whitespace-nowrap"
              >
                Transfer Notes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note Transfer Modal */}
      {showTransferModal && activeMatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold text-navy-900 text-lg mb-2">Transfer Notes to Active Customer</h3>
            <p className="text-sm text-navy-600 mb-4">
              {transferMode === 'copy' ? 'Copy' : 'Move'} notes from this Lead to "<strong>{activeMatch.shop_name}</strong>" (PCR/AccountEdge active customer).
            </p>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setTransferMode('copy')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${transferMode === 'copy' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-navy-50 text-navy-600 border border-navy-200'}`}
              >
                Copy (keep originals)
              </button>
              <button
                onClick={() => setTransferMode('move')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${transferMode === 'move' ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-navy-50 text-navy-600 border border-navy-200'}`}
              >
                Move (remove from Lead)
              </button>
            </div>

            {notes.length === 0 ? (
              <p className="text-navy-500 text-sm py-4">No notes to transfer.</p>
            ) : (
              <div className="space-y-2 mb-4">
                <label className="flex items-center gap-2 text-sm font-medium text-navy-700 mb-2">
                  <input
                    type="checkbox"
                    checked={selectedNotesForTransfer.length === notes.length}
                    onChange={e => setSelectedNotesForTransfer(e.target.checked ? notes.map(n => n.id) : [])}
                    className="rounded"
                  />
                  Select all ({notes.length} notes)
                </label>
                {notes.map(note => (
                  <label key={note.id} className="flex items-start gap-2 p-2 rounded-lg bg-navy-50 cursor-pointer hover:bg-navy-100">
                    <input
                      type="checkbox"
                      checked={selectedNotesForTransfer.includes(note.id)}
                      onChange={e => {
                        if (e.target.checked) setSelectedNotesForTransfer(prev => [...prev, note.id]);
                        else setSelectedNotesForTransfer(prev => prev.filter(id => id !== note.id));
                      }}
                      className="rounded mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-navy-800 line-clamp-2">{note.content}</p>
                      <p className="text-xs text-navy-500 mt-1">
                        {note.first_name} {note.last_name} &middot; {new Date(note.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {transferResult && (
              <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm mb-4">
                {transferResult}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowTransferModal(false); setTransferResult(null); }} className="btn-secondary">
                {transferResult ? 'Done' : 'Cancel'}
              </button>
              {!transferResult && (
                <button
                  onClick={async () => {
                    setTransferring(true);
                    try {
                      const endpoint = transferMode === 'copy' ? 'copy-notes' : 'transfer-notes';
                      const body: any = { target_account_id: activeMatch.id };
                      if (selectedNotesForTransfer.length > 0 && selectedNotesForTransfer.length < notes.length) {
                        body.note_ids = selectedNotesForTransfer;
                      }
                      const result = await api.post(`/accounts/${id}/${endpoint}`, body);
                      setTransferResult(result.message);
                      loadAccount(); // Refresh notes
                    } catch (err) {
                      setTransferResult('Error transferring notes. Please try again.');
                    }
                    setTransferring(false);
                  }}
                  disabled={transferring || (notes.length > 0 && selectedNotesForTransfer.length === 0)}
                  className="btn-primary"
                >
                  {transferring ? 'Transferring...' : `${transferMode === 'copy' ? 'Copy' : 'Move'} ${selectedNotesForTransfer.length || 'All'} Note(s)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PCR Managed Badge — shown on active customers controlled by PCR */}
      {account.pcr_managed && (
        <div className="card mb-4 sm:mb-6 border-l-4 border-green-500 bg-green-50">
          <p className="text-sm text-green-800">
            <strong>PCR/AccountEdge Managed</strong> — This active customer file is kept in sync with the AccountEdge PCR report. Status changes are controlled by the PCR data.
          </p>
        </div>
      )}

      {/* Shop Details — full width */}
      <div className="mb-4 sm:mb-6">
        <ShopDetails account={account} user={user} onSave={loadAccount} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-1 gap-4 sm:gap-6">
        {/* Notes & Activities — full width */}
        <div className="space-y-4 sm:space-y-6">
          {/* Add Note — with optional activity type dropdown */}
          <div className={`card transition-all ${noteSaved ? 'ring-2 ring-green-400 border-green-300' : newNote.trim() ? 'ring-2 ring-amber-400 border-amber-300' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-navy-900">Add Note</h3>
              <div className="flex items-center gap-2">
                {draftRestored && newNote.trim() && (
                  <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                    Draft restored
                  </span>
                )}
                {noteSaved && (
                  <span className="text-xs font-bold text-green-700 bg-green-100 border border-green-300 px-3 py-1 rounded-full flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Note Saved!
                  </span>
                )}
                {!noteSaved && newNote.trim() && (
                  <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse-soft">
                    Unsaved — don't forget to Save!
                  </span>
                )}
              </div>
            </div>
            {noteSaved ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <div className="text-3xl mb-2">&#10003;</div>
                <p className="text-green-800 font-semibold">Note saved successfully!</p>
                <p className="text-green-600 text-sm mt-1">Your note has been added to the timeline below.</p>
                <button
                  onClick={() => setNoteSaved(false)}
                  className="mt-3 text-sm text-green-700 hover:text-green-900 underline"
                >
                  Add another note
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Type a note or use voice input..."
                    className="input-field min-h-[60px] resize-none pr-10 w-full"
                    rows={2}
                  />
                  {isSupported && (
                    <button
                      onClick={isListening ? stopListening : startListening}
                      className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${
                        isListening ? 'text-brand-500 bg-brand-50' : 'text-navy-400 hover:text-navy-600'
                      }`}
                      title={isListening ? 'Stop recording' : 'Voice input'}
                    >
                      {isListening && <div className="absolute inset-0 bg-brand-500/20 rounded-full voice-pulse" />}
                      <svg className="w-5 h-5 relative" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                      </svg>
                    </button>
                  )}
                </div>
                {isListening && (
                  <div className="text-xs text-brand-500 mt-2 flex items-center gap-1">
                    <div className="w-2 h-2 bg-brand-500 rounded-full animate-pulse" />
                    Listening... speak now
                  </div>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <select
                    value={noteActivityType}
                    onChange={e => setNoteActivityType(e.target.value)}
                    className="input-field w-auto text-sm"
                  >
                    <option value="none">Note only</option>
                    {Object.entries(ACTIVITY_TAGS).map(([key, { label, icon }]) => (
                      <option key={key} value={key}>{icon} {label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-navy-400 hidden sm:inline">
                    {noteActivityType !== 'none' ? `Will also log as: ${ACTIVITY_TAGS[noteActivityType]?.label}` : 'Optional: tag as activity type'}
                  </span>
                  <button onClick={saveNote} disabled={savingNote || !newNote.trim()} className="btn-primary ml-auto">
                    {savingNote ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Follow-up Scheduling */}
          <div className="card">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="font-bold text-navy-900">Follow-up</h3>
                {account.follow_up_date && !showFollowUp && (
                  <button
                    onClick={() => { setShowFollowUp(true); setFollowUpDate(account.follow_up_date || ''); }}
                    className="text-xs text-navy-500 mt-1 flex items-center gap-1 hover:text-brand-600 transition group"
                  >
                    Scheduled: <span className={`font-medium ${new Date(account.follow_up_date) < new Date() ? 'text-red-600' : 'text-amber-600'} group-hover:underline`}>
                      {new Date(account.follow_up_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {new Date(account.follow_up_date) < new Date() && ' (overdue)'}
                    </span>
                    <span className="text-navy-400 group-hover:text-brand-500 text-[10px]">tap to edit</span>
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                {account.follow_up_date && !showFollowUp && (
                  <button
                    onClick={async () => {
                      if (!confirm('Clear this follow-up?')) return;
                      try {
                        await api.delete(`/accounts/${id}/follow-up`);
                        loadAccount();
                      } catch (err) { console.error(err); }
                    }}
                    className="text-xs text-navy-400 hover:text-red-500 transition"
                  >
                    Clear
                  </button>
                )}
                {!showFollowUp && (
                  <button onClick={() => { setShowFollowUp(true); setFollowUpDate(account.follow_up_date || ''); }} className="btn-ghost text-sm">
                    {account.follow_up_date ? 'Reschedule' : 'Schedule'}
                  </button>
                )}
              </div>
            </div>
            {showFollowUp && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={e => setFollowUpDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="input-field flex-1"
                  />
                  <div className="flex gap-1">
                    {[1, 3, 7, 14].map(days => (
                      <button
                        key={days}
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() + days);
                          setFollowUpDate(d.toISOString().split('T')[0]);
                        }}
                        className="btn-ghost text-xs px-2 py-1"
                      >
                        +{days}d
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  placeholder="Notes (optional) e.g. Call about pricing quote"
                  value={followUpNotes}
                  onChange={e => setFollowUpNotes(e.target.value)}
                  className="input-field"
                />
                <div className="flex gap-2">
                  <button onClick={scheduleFollowUp} disabled={savingFollowUp || !followUpDate} className="btn-primary flex-1">
                    {savingFollowUp ? 'Saving...' : 'Set Follow-up'}
                  </button>
                  <button onClick={() => setShowFollowUp(false)} className="btn-ghost">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Document Vault */}
          <div className="card">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-navy-900">Document Vault</h3>
              <button onClick={() => setShowDocUpload(!showDocUpload)} className="btn-ghost text-sm">
                {showDocUpload ? 'Cancel' : '+ Upload'}
              </button>
            </div>

            {showDocUpload && (
              <div className="border border-navy-100 rounded-xl p-4 mb-4 bg-navy-50/50 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={docForm.document_type}
                    onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}
                    className="input-field"
                  >
                    {Object.entries(DOC_TYPE_LABELS).map(([key, { label, icon }]) => (
                      <option key={key} value={key}>{icon} {label}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Title *"
                    value={docForm.title}
                    onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <input
                  placeholder="Description (optional)"
                  value={docForm.description}
                  onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))}
                  className="input-field"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-navy-500 mb-1 block">File</label>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xls,.xlsx,.csv,.txt"
                      onChange={e => setDocFile(e.target.files?.[0] || null)}
                      className="text-sm text-navy-700"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-navy-500 mb-1 block">Expiration Date (optional)</label>
                    <input
                      type="date"
                      value={docForm.expires_at}
                      onChange={e => setDocForm(f => ({ ...f, expires_at: e.target.value }))}
                      className="input-field"
                    />
                  </div>
                </div>
                <button
                  onClick={uploadDocument}
                  disabled={uploadingDoc || !docFile || !docForm.title.trim()}
                  className="btn-primary"
                >
                  {uploadingDoc ? 'Uploading...' : 'Upload Document'}
                </button>
              </div>
            )}

            {documents.length === 0 ? (
              <p className="text-navy-400 text-sm py-4 text-center">
                No documents yet. Upload contracts, pricing agreements, rebates, and more.
              </p>
            ) : (
              <div className="space-y-2">
                {Object.entries(
                  documents.reduce<Record<string, AccountDocument[]>>((acc, d) => {
                    const type = d.document_type || 'other';
                    if (!acc[type]) acc[type] = [];
                    acc[type].push(d);
                    return acc;
                  }, {})
                ).map(([type, docs]) => {
                  const config = DOC_TYPE_LABELS[type] || DOC_TYPE_LABELS.other;
                  return (
                    <div key={type}>
                      <div className="text-xs font-semibold text-navy-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                        <span>{config.icon}</span> {config.label} ({docs.length})
                      </div>
                      <div className="space-y-1.5 mb-3">
                        {docs.map(doc => {
                          const isExpired = doc.expires_at && new Date(doc.expires_at) < new Date();
                          const baseUrl = (import.meta as any).env?.VITE_API_URL || '';
                          return (
                            <div key={doc.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-navy-100 hover:border-navy-200 bg-white transition group">
                              <div className="min-w-0 flex-1">
                                <a
                                  href={`${baseUrl}${doc.file_path}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline truncate block"
                                >
                                  {doc.title}
                                </a>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-navy-400 mt-0.5">
                                  <span>{doc.original_filename}</span>
                                  {doc.file_size && <span>{formatFileSize(doc.file_size)}</span>}
                                  <span>by {doc.first_name} {doc.last_name}</span>
                                  <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                                  {doc.expires_at && (
                                    <span className={isExpired ? 'text-red-600 font-semibold' : 'text-amber-600'}>
                                      {isExpired ? '⚠ Expired' : 'Exp'}: {new Date(doc.expires_at + 'T00:00:00').toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                                {doc.description && <div className="text-xs text-navy-500 mt-0.5">{doc.description}</div>}
                              </div>
                              <button
                                onClick={() => deleteDocument(doc.id)}
                                className="text-navy-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                                title="Remove"
                              >
                                ✕
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes & Activity Timeline */}
          <div className="card">
            <h3 className="font-bold text-navy-900 mb-4">Notes & Activity Timeline</h3>
            {notes.length === 0 && activities.length === 0 ? (
              <p className="text-navy-400 text-sm py-6 text-center">No notes or activities yet. Add your first note above!</p>
            ) : (
              <div className="space-y-4">
                {[
                  ...notes.map(n => ({ type: 'note' as const, date: n.created_at, data: n })),
                  ...activities.map(a => ({ type: 'activity' as const, date: a.created_at, data: a }))
                ]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map((item, idx) => {
                    const isNote = item.type === 'note';
                    const note = isNote ? (item.data as Note) : null;
                    const activity = !isNote ? (item.data as Activity) : null;
                    const tagConfig = activity ? ACTIVITY_TAGS[activity.activity_type] || ACTIVITY_TAGS.other : null;
                    const canEdit = isNote && note!.created_by_id === user.id;
                    const isEditing = isNote && editingNoteId === note!.id;

                    return (
                      <div key={`${item.type}-${isNote ? note!.id : activity!.id}`} className="flex gap-3 pb-4 border-b border-navy-50 last:border-0">
                        {/* Icon */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${
                          isNote ? 'bg-blue-100' : (tagConfig?.bg || 'bg-green-100')
                        }`}>
                          {isNote ? '📝' : tagConfig?.icon || '📋'}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-navy-900">
                                {isNote ? `${note!.first_name} ${note!.last_name}` : `${activity!.first_name} ${activity!.last_name}`}
                              </span>
                              {!isNote && tagConfig && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tagConfig.bg} text-navy-700`}>
                                  {tagConfig.icon} {tagConfig.label}
                                </span>
                              )}
                              {isNote && note!.is_voice_transcribed ? (
                                <span className="text-[10px] text-navy-400 bg-navy-50 px-1.5 py-0.5 rounded-full">🎤 Voice</span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {canEdit && !isEditing && (
                                <button
                                  onClick={() => { setEditingNoteId(note!.id); setEditNoteContent(note!.content); }}
                                  className="text-[10px] text-navy-400 hover:text-navy-600 px-1.5 py-0.5 rounded hover:bg-navy-50"
                                >
                                  Edit
                                </button>
                              )}
                              <div className="text-right flex-shrink-0">
                                <span className="text-xs text-navy-400">
                                  {new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {isNote && note!.updated_at && note!.updated_at !== note!.created_at && (
                                  <div className="text-[10px] text-navy-400 italic">
                                    edited {new Date(note!.updated_at).toLocaleDateString()} {new Date(note!.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* Note content — editable or read-only */}
                          {isEditing ? (
                            <div className="mt-2 space-y-2 p-2 rounded-lg ring-2 ring-amber-400 bg-amber-50/30">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-semibold text-amber-600">Editing — remember to Save!</span>
                              </div>
                              <textarea
                                value={editNoteContent}
                                onChange={e => setEditNoteContent(e.target.value)}
                                className="input-field w-full min-h-[60px] resize-none text-sm"
                                rows={3}
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button onClick={updateNote} disabled={savingEditNote || !editNoteContent.trim()} className="btn-primary text-xs px-3 py-1">
                                  {savingEditNote ? 'Saving...' : 'Save'}
                                </button>
                                <button onClick={() => { setEditingNoteId(null); setEditNoteContent(''); }} className="btn-ghost text-xs px-3 py-1">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-navy-700 mt-1 whitespace-pre-wrap">
                              {isNote
                                ? note!.content
                                : activity!.description || `Logged a ${tagConfig?.label || activity!.activity_type}`
                              }
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, href }: { label: string; value: string | null | undefined; href?: string }) {
  if (!value || value === 'null') return null;
  return (
    <div className="flex justify-between py-1.5 border-b border-navy-50">
      <span className="text-navy-500">{label}</span>
      {href ? (
        <a href={href} className="font-medium text-brand-600 hover:text-brand-700">{value}</a>
      ) : (
        <span className="font-medium text-navy-900 text-right">{value}</span>
      )}
    </div>
  );
}

