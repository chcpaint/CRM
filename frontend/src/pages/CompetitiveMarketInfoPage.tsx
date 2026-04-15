import { useEffect, useState, useRef } from 'react';
import { Search, Upload, Trash2, Pencil, Download, X, FileText, Image as ImageIcon, Eye } from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';

interface CMIItem {
  id: number;
  title: string;
  notes: string | null;
  filename: string;
  mime_type: string;
  file_size: number;
  manufacturer: string | null;
  product_codes: string | null;
  created_at: string;
  updated_at: string;
  uploaded_by_id: number | null;
  by_first_name: string | null;
  by_last_name: string | null;
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,.tif,.tiff,application/pdf,image/*';
const MAX_BYTES = 15 * 1024 * 1024;

export default function CompetitiveMarketInfoPage({ user }: { user: User }) {
  const [items, setItems] = useState<CMIItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Upload form state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [productCodes, setProductCodes] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Edit / preview state
  const [editing, setEditing] = useState<CMIItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editManufacturer, setEditManufacturer] = useState('');
  const [editProductCodes, setEditProductCodes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [previewItem, setPreviewItem] = useState<CMIItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.get('/competitive-market-info');
      setItems(data.items || []);
    } catch (e: any) {
      setError(e.error || 'Failed to load uploads');
    } finally { setLoading(false); }
  };

  const fmtSize = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };
  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return d; }
  };
  const isImage = (mt: string) => mt?.startsWith('image/');
  const isPdf = (mt: string) => mt === 'application/pdf';

  // Smart search: split the query into terms (space or comma separated) and require
  // every term to match somewhere — title, notes, filename, manufacturer, or any
  // SKU/product code. This lets reps search "ppg DBC500" or "3M, P800" instinctively.
  const filtered = items.filter(it => {
    if (!search.trim()) return true;
    const haystack = [
      it.title, it.notes, it.filename, it.manufacturer, it.product_codes,
    ].filter(Boolean).join(' \u0001 ').toLowerCase();
    const terms = search.toLowerCase().split(/[\s,]+/).filter(Boolean);
    return terms.every(t => haystack.includes(t));
  });

  // ─── Upload ───
  const onPickFile = (f: File | null) => {
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) {
      setError(`File is too large (${fmtSize(f.size)}). Max 15MB.`);
      return;
    }
    setError(null);
    setFile(f);
    if (!title) {
      // Suggest title from filename without extension
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      setTitle(base.slice(0, 200));
    }
  };

  const resetUploadForm = () => {
    setFile(null); setTitle(''); setNotes(''); setManufacturer(''); setProductCodes('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submitUpload = async () => {
    if (!file) { setError('Please select a file.'); return; }
    if (!title.trim()) { setError('Please add a title.'); return; }
    setUploading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title.trim());
      if (notes.trim()) fd.append('notes', notes.trim());
      if (manufacturer.trim()) fd.append('manufacturer', manufacturer.trim());
      if (productCodes.trim()) fd.append('product_codes', productCodes.trim());
      await api.upload('/competitive-market-info', fd);
      resetUploadForm();
      setUploadOpen(false);
      load();
    } catch (e: any) {
      setError(e.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ─── Edit ───
  const openEdit = (it: CMIItem) => {
    setEditing(it);
    setEditTitle(it.title);
    setEditNotes(it.notes || '');
    setEditManufacturer(it.manufacturer || '');
    setEditProductCodes(it.product_codes || '');
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (!editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await api.patch(`/competitive-market-info/${editing.id}`, {
        title: editTitle.trim(),
        notes: editNotes.trim() || null,
        manufacturer: editManufacturer.trim() || null,
        product_codes: editProductCodes.trim() || null,
      });
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.error || 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  };

  // ─── Delete ───
  const onDelete = async (it: CMIItem) => {
    if (!confirm(`Delete "${it.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/competitive-market-info/${it.id}`);
      setItems(prev => prev.filter(p => p.id !== it.id));
    } catch (e: any) {
      setError(e.error || 'Delete failed');
    }
  };

  // ─── Preview / download (auth-required, so fetch as blob) ───
  const fetchAsBlobUrl = async (id: number): Promise<string> => {
    const token = api.getToken();
    const r = await fetch(`/api/competitive-market-info/${id}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!r.ok) throw new Error('Failed to load file');
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  };

  const openPreview = async (it: CMIItem) => {
    setPreviewItem(it);
    setPreviewUrl(null);
    setPreviewLoading(true);
    try {
      const url = await fetchAsBlobUrl(it.id);
      setPreviewUrl(url);
    } catch (e: any) {
      setError(e.message || 'Preview failed');
      setPreviewItem(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null); setPreviewItem(null);
  };

  const downloadFile = async (it: CMIItem) => {
    try {
      const url = await fetchAsBlobUrl(it.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = it.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e.message || 'Download failed');
    }
  };

  const canModify = (it: CMIItem) =>
    user.role === 'admin' || user.role === 'manager' || it.uploaded_by_id === user.id;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Competitive Market Info</h1>
          <p className="text-sm text-navy-500 mt-1">
            Shared library of competitor price lists, market promotions, flyers, and scans the team encounters in the field.
          </p>
        </div>
        <button onClick={() => setUploadOpen(true)} className="btn-primary text-sm flex items-center gap-2">
          <Upload className="w-4 h-4" /> Upload
        </button>
      </div>

      {/* Helpful greyed-out hint */}
      <div className="bg-navy-50/60 border border-dashed border-navy-200 rounded-xl p-4 text-sm text-navy-400 italic">
        Use this page to share anything competitive you come across — supplier price sheets, distributor promo flyers,
        photos of in-store signage, dealer pricing scans, manufacturer rebates, jobber markups, etc. Add a clear title
        (e.g. <span className="not-italic font-semibold text-navy-600">"NAPA Refinish Promo — March 2026"</span>) and notes
        explaining the context (where you saw it, which shop mentioned it, validity dates) so the rest of the team can act on it.
      </div>

      {/* Search */}
      <div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400" />
          <input
            type="text"
            placeholder="Search by manufacturer, SKU, product code, title, notes, or filename…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-10 pr-10 w-full"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-600"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="text-[11px] text-navy-400 mt-1.5 pl-1">
          Tip: type multiple terms separated by spaces or commas (e.g. <span className="font-mono text-navy-500">PPG DBC500</span> or <span className="font-mono text-navy-500">3M, P800</span>) — every term must match.
          {filtered.length !== items.length && (
            <span className="ml-2 text-navy-600 font-medium">{filtered.length} of {items.length} match</span>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
      {loading && <div className="text-navy-400 py-8 text-center">Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-navy-500">
            {items.length === 0 ? 'No uploads yet. Be the first to share a competitor promo or price list.' : 'No matches for your search.'}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(it => {
            const Icon = isImage(it.mime_type) ? ImageIcon : FileText;
            return (
              <div key={it.id} className="card flex flex-col">
                <button
                  onClick={() => openPreview(it)}
                  className="flex items-center gap-3 text-left mb-3 hover:opacity-80"
                  title="Preview"
                >
                  <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-navy-900 truncate">{it.title}</div>
                    <div className="text-xs text-navy-400 truncate">{it.filename} · {fmtSize(it.file_size)}</div>
                  </div>
                </button>

                {(it.manufacturer || it.product_codes) && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {it.manufacturer && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[11px] font-semibold">
                        {it.manufacturer}
                      </span>
                    )}
                    {it.product_codes && it.product_codes.split(/[\s,]+/).filter(Boolean).slice(0, 6).map((code, i) => (
                      <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md bg-navy-100 text-navy-700 text-[11px] font-mono">
                        {code}
                      </span>
                    ))}
                  </div>
                )}

                {it.notes && (
                  <div className="text-sm text-navy-600 whitespace-pre-wrap mb-3 line-clamp-4">{it.notes}</div>
                )}

                <div className="text-xs text-navy-400 mb-3">
                  {it.by_first_name ? `${it.by_first_name} ${it.by_last_name || ''}` : 'Unknown'} · {fmtDate(it.created_at)}
                </div>

                <div className="mt-auto flex items-center gap-1 pt-3 border-t border-navy-100">
                  <button onClick={() => openPreview(it)} className="btn-ghost text-xs flex items-center gap-1" title="Preview">
                    <Eye className="w-3.5 h-3.5" /> View
                  </button>
                  <button onClick={() => downloadFile(it)} className="btn-ghost text-xs flex items-center gap-1" title="Download">
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                  {canModify(it) && (
                    <>
                      <button onClick={() => openEdit(it)} className="btn-ghost text-xs flex items-center gap-1 ml-auto" title="Edit title/notes">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onDelete(it)} className="btn-ghost text-xs text-red-600 hover:bg-red-50 flex items-center gap-1" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Upload modal ─── */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-fade-in">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-navy-900">Upload competitive market info</h2>
              <button onClick={() => { setUploadOpen(false); resetUploadForm(); }} className="text-navy-400 hover:text-navy-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">File <span className="text-red-500">*</span></label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                onChange={e => onPickFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-navy-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
              />
              <div className="text-xs text-navy-400 mt-1">PDF or image · max 15MB</div>
              {file && (
                <div className="text-xs text-navy-600 mt-1.5">
                  <strong>{file.name}</strong> · {fmtSize(file.size)}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">Title <span className="text-red-500">*</span></label>
              <input
                type="text"
                maxLength={200}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. NAPA Refinish Promo — March 2026"
                className="input-field w-full"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">
                  Manufacturer <span className="text-navy-400 normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={manufacturer}
                  onChange={e => setManufacturer(e.target.value)}
                  placeholder="e.g. PPG, 3M, BASF, NAPA"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">
                  Product codes / SKUs <span className="text-navy-400 normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={productCodes}
                  onChange={e => setProductCodes(e.target.value)}
                  placeholder="DBC500, P800, 05887…"
                  className="input-field w-full"
                />
              </div>
            </div>
            <div className="text-[11px] text-navy-400 -mt-2 pl-1">
              These fields make this upload findable later when the team searches.
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">Notes <span className="text-navy-400 normal-case font-normal">(optional)</span></label>
              <textarea
                rows={4}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Where did you see this? Which shop or distributor? Validity dates? Anything the team should know."
                className="input-field w-full resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => { setUploadOpen(false); resetUploadForm(); }} className="btn-ghost text-sm" disabled={uploading}>Cancel</button>
              <button onClick={submitUpload} className="btn-primary text-sm" disabled={uploading || !file || !title.trim()}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit modal ─── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-navy-900">Edit details</h2>
              <button onClick={() => setEditing(null)} className="text-navy-400 hover:text-navy-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">Title</label>
              <input
                type="text"
                maxLength={200}
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className="input-field w-full"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">Manufacturer</label>
                <input
                  type="text"
                  maxLength={100}
                  value={editManufacturer}
                  onChange={e => setEditManufacturer(e.target.value)}
                  placeholder="e.g. PPG, 3M, BASF"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">Product codes / SKUs</label>
                <input
                  type="text"
                  maxLength={500}
                  value={editProductCodes}
                  onChange={e => setEditProductCodes(e.target.value)}
                  placeholder="DBC500, P800…"
                  className="input-field w-full"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">Notes</label>
              <textarea
                rows={4}
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                className="input-field w-full resize-y"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="btn-ghost text-sm" disabled={savingEdit}>Cancel</button>
              <button onClick={saveEdit} className="btn-primary text-sm" disabled={savingEdit || !editTitle.trim()}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Preview modal ─── */}
      {previewItem && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-2 sm:p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-navy-100">
              <div className="min-w-0">
                <div className="font-semibold text-navy-900 truncate">{previewItem.title}</div>
                <div className="text-xs text-navy-400 truncate">{previewItem.filename} · {fmtSize(previewItem.file_size)}</div>
              </div>
              <div className="flex items-center gap-1 ml-3">
                <button onClick={() => downloadFile(previewItem)} className="btn-ghost text-xs flex items-center gap-1">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button onClick={closePreview} className="text-navy-400 hover:text-navy-600 ml-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-navy-50 flex items-center justify-center">
              {previewLoading && <div className="text-navy-400 p-12">Loading file…</div>}
              {!previewLoading && previewUrl && isImage(previewItem.mime_type) && (
                <img src={previewUrl} alt={previewItem.title} className="max-w-full max-h-[78vh] object-contain" />
              )}
              {!previewLoading && previewUrl && isPdf(previewItem.mime_type) && (
                <iframe src={previewUrl} title={previewItem.title} className="w-full h-[78vh] bg-white" />
              )}
              {!previewLoading && previewUrl && !isImage(previewItem.mime_type) && !isPdf(previewItem.mime_type) && (
                <div className="text-navy-500 p-12 text-center">
                  <p>Preview not available for this file type.</p>
                  <button onClick={() => downloadFile(previewItem)} className="btn-primary mt-3 text-sm">Download to view</button>
                </div>
              )}
            </div>
            {previewItem.notes && (
              <div className="p-4 border-t border-navy-100 text-sm text-navy-700 whitespace-pre-wrap max-h-32 overflow-auto">
                {previewItem.notes}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
