import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Plus, Search, Camera, Check, X, ChevronRight, Trash2,
  RefreshCw, Edit2, CheckCircle, Upload, Eye, ClipboardList
} from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';

// ─── Types ───────────────────────────────────────────────────────────
interface SurveyItem {
  id?: string;
  survey_id?: string;
  item_type: string;
  item_label: string;
  present: boolean;
  serial_number: string;
  photo_paths: string[];
  system: 'water' | 'solvent' | 'shared' | '';
  upc: string;
  ai_read: boolean;
  item_photo_path: string;
}

interface Survey {
  id: string;
  shop_name: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  ownership: string;
  full_paint_system: boolean;
  submitted_by: string;
  notes: string;
  status: string;
  created_at: string;
  has_water: boolean;
  has_solvent: boolean;
  draft: any;
  item_count: number;
}

interface FormItem {
  _key: string;
  item_type: string;
  item_label: string;
  present: boolean;
  serial_number: string;
  system: 'water' | 'solvent' | 'shared' | '';
  existingPhotos: string[];
  newPhotos: File[];
}

type ViewState = 'list' | 'detail' | 'form';

// ─── Constants ───────────────────────────────────────────────────────
const STORAGE_BASE_URL = 'https://umhqhfwhnuokyyurdfik.supabase.co/storage/v1/object/public/shop-survey';
const SURVEY_STORAGE_URL = 'https://umhqhfwhnuokyyurdfik.supabase.co/storage/v1/object/shop-survey';
const SURVEY_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaHFoZndobnVva3l5dXJkZmlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTg1MDYsImV4cCI6MjA5ODQ5NDUwNn0.H_yzOnSc75P3uIG0t1Q-tffvs0dbiY2Z4J1vZWHwLg4';

const OWNERSHIP_MAP: Record<string, string> = {
  consignment: 'Consignment',
  owned_by_shop: 'Owned by Shop',
  chc_owned: 'CHC Owned',
  other: 'Other',
};

const OWNERSHIP_OPTIONS = [
  { value: 'consignment', label: 'Consignment' },
  { value: 'owned_by_shop', label: 'Owned by Shop' },
  { value: 'chc_owned', label: 'CHC Owned' },
  { value: 'other', label: 'Other' },
];

const ITEM_TYPE_MAP: Record<string, string> = {
  computer: '💻 Computer',
  monitor: '🖥️ Monitor',
  printer: '🖨️ Printer',
  scale: '⚖️ Scale',
  cabinet: '🗄️ Cabinet',
  spectrophotometer: '🔬 Spectrophotometer',
  toner_bank: '🎨 Toner Bank',
  card_deck: '🃏 Card Deck',
  other: '📦 Other',
};

const FIXED_ITEMS: { type: string; label: string }[] = [
  { type: 'computer', label: 'Computer' },
  { type: 'monitor', label: 'Monitor' },
  { type: 'printer', label: 'Printer' },
  { type: 'scale', label: 'Scale' },
  { type: 'cabinet', label: 'Cabinet' },
  { type: 'spectrophotometer', label: 'Spectrophotometer' },
];

const STATUS_COLORS: Record<string, string> = {
  started: 'bg-blue-100 text-blue-800',
  submitted: 'bg-orange-100 text-orange-800',
  pending: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  imported: 'bg-green-100 text-green-800',
};

// ─── Helpers ─────────────────────────────────────────────────────────
function photoUrl(path: string): string {
  return `${STORAGE_BASE_URL}/${encodeURI(path)}`;
}

function statusLabel(s: string): string {
  if (s === 'started') return 'Started';
  if (s === 'submitted' || s === 'pending') return 'Pending';
  if (s === 'completed' || s === 'imported') return 'Completed';
  return s;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function resizeImage(file: File, maxDim = 1400, quality = 0.7): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas to blob failed'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

async function uploadPhoto(surveyId: string, file: File | Blob, itemType: string, index: number): Promise<string> {
  const blob = file instanceof File ? await resizeImage(file) : file;
  const path = `${surveyId}/${itemType}-${Date.now()}-${index}.jpg`;
  const res = await fetch(`${SURVEY_STORAGE_URL}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SURVEY_SB_KEY}`,
      'Content-Type': 'image/jpeg',
    },
    body: blob,
  });
  if (!res.ok) throw new Error('Photo upload failed');
  return path;
}

function makeFormItem(type: string, label: string): FormItem {
  return {
    _key: crypto.randomUUID(),
    item_type: type,
    item_label: label,
    present: false,
    serial_number: '',
    system: '',
    existingPhotos: [],
    newPhotos: [],
  };
}

// ─── Sub-components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] || 'bg-gray-100 text-gray-800';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{statusLabel(status)}</span>;
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`card p-4 border-l-4 ${color}`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <button className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2" onClick={onClose}>
        <X className="w-6 h-6" />
      </button>
      <img src={src} alt="Full size" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

function PhotoThumbnail({ src, onClick }: { src: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0 hover:ring-2 hover:ring-blue-400">
      <img src={src} alt="" className="w-full h-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors">
        <Eye className="w-4 h-4 text-white opacity-0 hover:opacity-100" />
      </div>
    </button>
  );
}

// ─── Form Item Row Component ─────────────────────────────────────────

function FormItemRow({
  item,
  list,
  setList,
  showNameField = false,
  showSystemField = false,
}: {
  item: FormItem;
  list: FormItem[];
  setList: React.Dispatch<React.SetStateAction<FormItem[]>>;
  showNameField?: boolean;
  showSystemField?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const updateField = (field: Partial<FormItem>) => {
    setList((prev) => prev.map((it) => (it._key === item._key ? { ...it, ...field } : it)));
  };

  const addPhotos = (files: FileList) => {
    setList((prev) => prev.map((it) => (it._key === item._key ? { ...it, newPhotos: [...it.newPhotos, ...Array.from(files)] } : it)));
  };

  const removeNew = (idx: number) => {
    setList((prev) => prev.map((it) => (it._key === item._key ? { ...it, newPhotos: it.newPhotos.filter((_, i) => i !== idx) } : it)));
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{ITEM_TYPE_MAP[item.item_type]?.split(' ')[0] || '📦'}</span>
          {showNameField ? (
            <input
              className="input-field text-sm"
              placeholder="Item name"
              value={item.item_label}
              onChange={(e) => updateField({ item_label: e.target.value })}
            />
          ) : (
            <span className="font-medium text-sm">{item.item_label}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => updateField({ present: !item.present })}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
            item.present ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {item.present ? 'Present' : 'Not Present'}
        </button>
      </div>

      {item.present && (
        <div className="space-y-3 pl-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Serial Number</label>
            <input
              className="input-field text-sm"
              placeholder="Enter serial number"
              value={item.serial_number}
              onChange={(e) => updateField({ serial_number: e.target.value })}
            />
          </div>

          {showSystemField && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">System</label>
              <div className="flex gap-2">
                {(['water', 'solvent', 'shared'] as const).map((sys) => (
                  <button
                    key={sys}
                    type="button"
                    onClick={() => updateField({ system: item.system === sys ? '' : sys })}
                    className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${
                      item.system === sys ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {sys}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Photos</label>
            <div className="flex flex-wrap gap-2 items-center">
              {item.existingPhotos.map((p, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                  <img src={photoUrl(p)} alt="" className="w-full h-full object-cover" />
                  <div className="absolute top-0 right-0 bg-green-500 rounded-bl p-0.5">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                </div>
              ))}
              {item.newPhotos.map((f, i) => (
                <div key={`new-${i}`} className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-blue-300">
                  <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeNew(i)}
                    className="absolute top-0 right-0 bg-red-500 rounded-bl p-0.5"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-400 transition-colors"
              >
                <Camera className="w-5 h-5" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export default function ShopSurveysPage({ user }: { user: User }) {
  const [view, setView] = useState<ViewState>('list');
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
  const [surveyItems, setSurveyItems] = useState<SurveyItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Form state
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formSurveyId, setFormSurveyId] = useState<string>('');
  const [shopName, setShopName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [ownership, setOwnership] = useState('');
  const [fullPaintSystem, setFullPaintSystem] = useState(false);
  const [hasWater, setHasWater] = useState(false);
  const [hasSolvent, setHasSolvent] = useState(false);
  const [notes, setNotes] = useState('');
  const [formItems, setFormItems] = useState<FormItem[]>([]);
  const [waterToners, setWaterToners] = useState<FormItem[]>([]);
  const [solventToners, setSolventToners] = useState<FormItem[]>([]);
  const [cardDecks, setCardDecks] = useState<FormItem[]>([]);
  const [otherItems, setOtherItems] = useState<FormItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // ─── Data loading ───────────────────────────────────────────────
  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Survey[]>('/shop-surveys');
      setSurveys(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.error || 'Failed to load surveys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSurveys(); }, [fetchSurveys]);

  const fetchSurveyDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const items = await api.get<SurveyItem[]>(`/shop-surveys/${id}/items`);
      setSurveyItems(Array.isArray(items) ? items : []);
    } catch {
      setSurveyItems([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ─── Filtering ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = surveys;
    if (statusFilter !== 'all') {
      list = list.filter((s) => {
        if (statusFilter === 'started') return s.status === 'started';
        if (statusFilter === 'pending') return s.status === 'submitted' || s.status === 'pending';
        if (statusFilter === 'completed') return s.status === 'completed' || s.status === 'imported';
        return true;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.shop_name?.toLowerCase().includes(q));
    }
    return list;
  }, [surveys, statusFilter, searchQuery]);

  const kpi = useMemo(() => {
    const total = surveys.length;
    const started = surveys.filter((s) => s.status === 'started').length;
    const pending = surveys.filter((s) => s.status === 'submitted' || s.status === 'pending').length;
    const completed = surveys.filter((s) => s.status === 'completed' || s.status === 'imported').length;
    return { total, started, pending, completed };
  }, [surveys]);

  // ─── Navigation helpers ─────────────────────────────────────────
  const openDetail = (survey: Survey) => {
    setSelectedSurvey(survey);
    fetchSurveyDetail(survey.id);
    setView('detail');
  };

  const backToList = () => {
    setView('list');
    setSelectedSurvey(null);
    setSurveyItems([]);
    fetchSurveys();
  };

  const initFormForCreate = () => {
    setFormMode('create');
    const id = crypto.randomUUID();
    setFormSurveyId(id);
    setShopName('');
    setAddress('');
    setContactName('');
    setContactPhone('');
    setOwnership('');
    setFullPaintSystem(false);
    setHasWater(false);
    setHasSolvent(false);
    setNotes('');
    setFormItems(FIXED_ITEMS.map((fi) => makeFormItem(fi.type, fi.label)));
    setWaterToners([makeFormItem('toner_bank', 'Water Toner Bank 1')]);
    setSolventToners([makeFormItem('toner_bank', 'Solvent Toner Bank 1')]);
    setCardDecks([]);
    setOtherItems([]);
    setSaveError(null);
    setView('form');
  };

  const initFormForEdit = () => {
    if (!selectedSurvey) return;
    setFormMode('edit');
    setFormSurveyId(selectedSurvey.id);
    setShopName(selectedSurvey.shop_name || '');
    setAddress(selectedSurvey.address || '');
    setContactName(selectedSurvey.contact_name || '');
    setContactPhone(selectedSurvey.contact_phone || '');
    setOwnership(selectedSurvey.ownership || '');
    setFullPaintSystem(selectedSurvey.full_paint_system || false);
    setHasWater(selectedSurvey.has_water || false);
    setHasSolvent(selectedSurvey.has_solvent || false);
    setNotes(selectedSurvey.notes || '');

    // Populate fixed items from existing survey items
    const existing = surveyItems.reduce<Record<string, SurveyItem>>((acc, si) => {
      acc[si.item_type + ':' + si.item_label] = si;
      return acc;
    }, {});

    const fixed: FormItem[] = FIXED_ITEMS.map((fi) => {
      const ex = existing[fi.type + ':' + fi.label] || surveyItems.find((si) => si.item_type === fi.type);
      return {
        _key: crypto.randomUUID(),
        item_type: fi.type,
        item_label: fi.label,
        present: ex?.present ?? false,
        serial_number: ex?.serial_number || '',
        system: ((ex?.system as FormItem['system']) || '') as FormItem['system'],
        existingPhotos: ex?.photo_paths || [],
        newPhotos: [] as File[],
      };
    });
    setFormItems(fixed);

    const wt = surveyItems.filter((si) => si.item_type === 'toner_bank' && si.system === 'water').map((si) => ({
      _key: crypto.randomUUID(),
      item_type: si.item_type,
      item_label: si.item_label,
      present: si.present,
      serial_number: si.serial_number || '',
      system: 'water' as const,
      existingPhotos: si.photo_paths || [],
      newPhotos: [] as File[],
    }));
    setWaterToners(wt.length > 0 ? wt : [makeFormItem('toner_bank', 'Water Toner Bank 1')]);

    const st = surveyItems.filter((si) => si.item_type === 'toner_bank' && si.system === 'solvent').map((si) => ({
      _key: crypto.randomUUID(),
      item_type: si.item_type,
      item_label: si.item_label,
      present: si.present,
      serial_number: si.serial_number || '',
      system: 'solvent' as const,
      existingPhotos: si.photo_paths || [],
      newPhotos: [] as File[],
    }));
    setSolventToners(st.length > 0 ? st : [makeFormItem('toner_bank', 'Solvent Toner Bank 1')]);

    const cd: FormItem[] = surveyItems.filter((si) => si.item_type === 'card_deck').map((si) => ({
      _key: crypto.randomUUID(),
      item_type: si.item_type,
      item_label: si.item_label,
      present: si.present,
      serial_number: si.serial_number || '',
      system: ((si.system as FormItem['system']) || '') as FormItem['system'],
      existingPhotos: si.photo_paths || [],
      newPhotos: [] as File[],
    }));
    setCardDecks(cd);

    const ot: FormItem[] = surveyItems.filter((si) => si.item_type === 'other').map((si) => ({
      _key: crypto.randomUUID(),
      item_type: si.item_type,
      item_label: si.item_label,
      present: si.present,
      serial_number: si.serial_number || '',
      system: ((si.system as FormItem['system']) || '') as FormItem['system'],
      existingPhotos: si.photo_paths || [],
      newPhotos: [] as File[],
    }));
    setOtherItems(ot);

    setSaveError(null);
    setView('form');
  };

  // ─── Save / Submit ──────────────────────────────────────────────
  const collectAllItems = (): FormItem[] => {
    const all = [...formItems];
    if (hasWater) all.push(...waterToners.map((t) => ({ ...t, system: 'water' as const })));
    if (hasSolvent) all.push(...solventToners.map((t) => ({ ...t, system: 'solvent' as const })));
    all.push(...cardDecks);
    all.push(...otherItems);
    return all;
  };

  const uploadAllPhotos = async (items: FormItem[]): Promise<{ item_type: string; item_label: string; paths: string[] }[]> => {
    const results: { item_type: string; item_label: string; paths: string[] }[] = [];
    for (const item of items) {
      const paths = [...item.existingPhotos];
      for (let i = 0; i < item.newPhotos.length; i++) {
        const path = await uploadPhoto(formSurveyId, item.newPhotos[i], item.item_type, i);
        paths.push(path);
      }
      results.push({ item_type: item.item_type, item_label: item.item_label, paths });
    }
    return results;
  };

  const handleSave = async (submitMode: boolean) => {
    if (!shopName.trim()) {
      setSaveError('Shop name is required');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const allItems = collectAllItems();
      const photoResults = await uploadAllPhotos(allItems);

      const items = allItems.map((item, idx) => ({
        item_type: item.item_type,
        item_label: item.item_label,
        present: item.present,
        serial_number: item.serial_number,
        system: item.system,
        photo_paths: photoResults[idx]?.paths || [],
      }));

      const body = {
        id: formSurveyId,
        shop_name: shopName,
        address,
        contact_name: contactName,
        contact_phone: contactPhone,
        ownership,
        full_paint_system: fullPaintSystem,
        has_water: hasWater,
        has_solvent: hasSolvent,
        notes,
        submitted_by: `${user.first_name} ${user.last_name}`,
        status: submitMode ? 'submitted' : 'started',
        draft: submitMode ? null : { items, shopName, address, contactName, contactPhone, ownership, fullPaintSystem, hasWater, hasSolvent, notes },
        items: submitMode ? items : undefined,
      };

      if (formMode === 'create') {
        await api.post('/shop-surveys', body);
      } else {
        await api.put(`/shop-surveys/${formSurveyId}`, body);
      }
      backToList();
    } catch (e: any) {
      setSaveError(e.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const markCompleted = async () => {
    if (!selectedSurvey) return;
    setActionLoading(true);
    try {
      await api.put(`/shop-surveys/${selectedSurvey.id}`, { status: 'completed' });
      setSelectedSurvey({ ...selectedSurvey, status: 'completed' });
      fetchSurveys();
    } catch {
      // silent
    } finally {
      setActionLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'list') {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6" />
            CHC Systems / Assets
          </h1>
          <button onClick={initFormForCreate} className="btn-primary flex items-center gap-1">
            <Plus className="w-4 h-4" /> New Survey
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total Surveys" value={kpi.total} color="border-gray-400" />
          <KpiCard label="Started" value={kpi.started} color="border-blue-400" />
          <KpiCard label="Pending" value={kpi.pending} color="border-orange-400" />
          <KpiCard label="Completed" value={kpi.completed} color="border-green-400" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {['all', 'started', 'pending', 'completed'].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                statusFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by shop name..."
                className="input-field pl-9 text-sm w-full"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <button onClick={fetchSurveys} className="p-2 text-gray-400 hover:text-gray-600" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        {/* Survey List */}
        {loading && surveys.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Loading surveys...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {searchQuery || statusFilter !== 'all' ? 'No surveys match your filters' : 'No surveys yet'}
          </div>
        ) : (
          <>
            {/* Mobile: card layout */}
            <div className="space-y-3 md:hidden">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openDetail(s)}
                  className="card p-4 w-full text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-sm">{s.shop_name || 'Untitled'}</h3>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="text-xs text-gray-500 space-y-1">
                    {s.submitted_by && <p>By: {s.submitted_by}</p>}
                    <div className="flex items-center justify-between">
                      <span>{formatDate(s.created_at)}</span>
                      <span>{s.item_count ?? 0} items</span>
                    </div>
                    {s.ownership && <p>{OWNERSHIP_MAP[s.ownership] || s.ownership}</p>}
                    {s.address && <p className="truncate">{s.address}</p>}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 absolute right-3 top-1/2 -translate-y-1/2" />
                </button>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-2 font-medium">Shop Name</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Submitted By</th>
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Items</th>
                    <th className="pb-2 font-medium">Ownership</th>
                    <th className="pb-2 font-medium">Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => openDetail(s)}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 font-semibold">{s.shop_name || 'Untitled'}</td>
                      <td className="py-3"><StatusBadge status={s.status} /></td>
                      <td className="py-3 text-gray-600">{s.submitted_by || '-'}</td>
                      <td className="py-3 text-gray-600">{formatDate(s.created_at)}</td>
                      <td className="py-3 text-gray-600">{s.item_count ?? 0}</td>
                      <td className="py-3 text-gray-600">{OWNERSHIP_MAP[s.ownership] || s.ownership || '-'}</td>
                      <td className="py-3 text-gray-600 truncate max-w-[200px]">{s.address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedSurvey) {
    const s = selectedSurvey;
    const canComplete = s.status === 'submitted' || s.status === 'pending';

    return (
      <div className="space-y-4">
        {/* Back + Actions */}
        <div className="flex items-center justify-between">
          <button onClick={backToList} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="w-4 h-4" /> Back to surveys
          </button>
          <div className="flex items-center gap-2">
            {canComplete && (
              <button
                onClick={markCompleted}
                disabled={actionLoading}
                className="btn-primary flex items-center gap-1 text-sm"
              >
                <CheckCircle className="w-4 h-4" /> {actionLoading ? 'Saving...' : 'Mark Completed'}
              </button>
            )}
            <button onClick={initFormForEdit} className="flex items-center gap-1 text-sm px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">
              <Edit2 className="w-4 h-4" /> Edit
            </button>
          </div>
        </div>

        {/* Header Card */}
        <div className="card p-5">
          <div className="flex items-start justify-between mb-3">
            <h2 className="text-lg font-bold">{s.shop_name || 'Untitled Survey'}</h2>
            <StatusBadge status={s.status} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">
            {s.submitted_by && <div><span className="text-gray-400">Submitted by:</span> {s.submitted_by}</div>}
            <div><span className="text-gray-400">Date:</span> {formatDate(s.created_at)}</div>
            {s.address && <div><span className="text-gray-400">Address:</span> {s.address}</div>}
            {s.contact_name && <div><span className="text-gray-400">Contact:</span> {s.contact_name}</div>}
            {s.contact_phone && <div><span className="text-gray-400">Phone:</span> {s.contact_phone}</div>}
            {s.ownership && <div><span className="text-gray-400">Ownership:</span> {OWNERSHIP_MAP[s.ownership] || s.ownership}</div>}
            <div><span className="text-gray-400">Paint System:</span> {s.full_paint_system ? 'Full' : 'Partial'}</div>
            <div className="flex gap-4">
              {s.has_water && <span className="badge bg-blue-100 text-blue-800">Water Base</span>}
              {s.has_solvent && <span className="badge bg-purple-100 text-purple-800">Solvent Base</span>}
            </div>
          </div>
          {s.notes && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{s.notes}</p>
            </div>
          )}
        </div>

        {/* Equipment Items */}
        <div>
          <h3 className="font-semibold text-sm text-gray-700 mb-3">Equipment Items ({surveyItems.length})</h3>
          {detailLoading ? (
            <div className="text-center py-8 text-gray-400">Loading items...</div>
          ) : surveyItems.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No equipment items recorded</div>
          ) : (
            <div className="space-y-3">
              {/* Mobile: cards */}
              <div className="md:hidden space-y-3">
                {surveyItems.map((item) => (
                  <div key={item.id} className="card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{ITEM_TYPE_MAP[item.item_type] || item.item_label}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.present ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {item.present ? 'Present' : 'Not Present'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                      {item.serial_number && <p>S/N: {item.serial_number}</p>}
                      {item.system && <p>System: {item.system}</p>}
                    </div>
                    {item.photo_paths?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {item.photo_paths.map((p, i) => (
                          <PhotoThumbnail key={i} src={photoUrl(p)} onClick={() => setLightboxSrc(photoUrl(p))} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="pb-2 font-medium">Item</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Serial Number</th>
                      <th className="pb-2 font-medium">System</th>
                      <th className="pb-2 font-medium">Photos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {surveyItems.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100">
                        <td className="py-3 font-medium">{ITEM_TYPE_MAP[item.item_type] || item.item_label}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            item.present ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {item.present ? 'Present' : 'Not Present'}
                          </span>
                        </td>
                        <td className="py-3 text-gray-600">{item.serial_number || '-'}</td>
                        <td className="py-3 text-gray-600 capitalize">{item.system || '-'}</td>
                        <td className="py-3">
                          <div className="flex gap-1">
                            {(item.photo_paths || []).map((p, i) => (
                              <PhotoThumbnail key={i} src={photoUrl(p)} onClick={() => setLightboxSrc(photoUrl(p))} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (view === 'form') {
    return (
      <div className="space-y-6 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={backToList} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-bold">{formMode === 'create' ? 'New Survey' : 'Edit Survey'}</h1>
        </div>

        {/* Shop Info */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-sm text-gray-700">Shop Information</h2>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Shop Name *</label>
            <input className="input-field w-full" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Enter shop name" />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Address</label>
            <input className="input-field w-full" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full address" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Contact Name</label>
              <input className="input-field w-full" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact person" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Contact Phone</label>
              <input className="input-field w-full" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone number" />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Ownership</label>
            <div className="flex flex-wrap gap-2">
              {OWNERSHIP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setOwnership(ownership === opt.value ? '' : opt.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    ownership === opt.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Paint System */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-sm text-gray-700">Paint System</h2>

          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setFullPaintSystem(!fullPaintSystem)}>
            <div className={`relative w-11 h-6 rounded-full transition-colors ${fullPaintSystem ? 'bg-blue-600' : 'bg-gray-300'}`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${fullPaintSystem ? 'translate-x-5' : ''}`} />
            </div>
            <span className="text-sm">Full Paint System</span>
          </div>

          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setHasWater(!hasWater)}>
            <div className={`relative w-11 h-6 rounded-full transition-colors ${hasWater ? 'bg-blue-600' : 'bg-gray-300'}`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${hasWater ? 'translate-x-5' : ''}`} />
            </div>
            <span className="text-sm">Water Base System</span>
          </div>

          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setHasSolvent(!hasSolvent)}>
            <div className={`relative w-11 h-6 rounded-full transition-colors ${hasSolvent ? 'bg-blue-600' : 'bg-gray-300'}`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${hasSolvent ? 'translate-x-5' : ''}`} />
            </div>
            <span className="text-sm">Solvent Base System</span>
          </div>
        </div>

        {/* Fixed Equipment Items */}
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-gray-700">Equipment</h2>
          {formItems.map((item) => (
            <FormItemRow key={item._key} item={item} list={formItems} setList={setFormItems} />
          ))}
        </div>

        {/* Water Toner Banks */}
        {hasWater && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-gray-700">Water Toner Banks</h2>
              <button
                type="button"
                onClick={() => setWaterToners([...waterToners, makeFormItem('toner_bank', `Water Toner Bank ${waterToners.length + 1}`)])}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            {waterToners.map((item) => (
              <FormItemRow key={item._key} item={item} list={waterToners} setList={setWaterToners} showNameField />
            ))}
          </div>
        )}

        {/* Solvent Toner Banks */}
        {hasSolvent && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-gray-700">Solvent Toner Banks</h2>
              <button
                type="button"
                onClick={() => setSolventToners([...solventToners, makeFormItem('toner_bank', `Solvent Toner Bank ${solventToners.length + 1}`)])}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            {solventToners.map((item) => (
              <FormItemRow key={item._key} item={item} list={solventToners} setList={setSolventToners} showNameField />
            ))}
          </div>
        )}

        {/* Card Decks */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-gray-700">Card Deck Cabinets</h2>
            {cardDecks.length < 6 && (
              <button
                type="button"
                onClick={() => setCardDecks([...cardDecks, makeFormItem('card_deck', `Card Deck ${cardDecks.length + 1}`)])}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Add (max 6)
              </button>
            )}
          </div>
          {cardDecks.length === 0 && (
            <p className="text-xs text-gray-400 italic">No card deck cabinets added</p>
          )}
          {cardDecks.map((item, idx) => (
            <div key={item._key} className="relative">
              <FormItemRow item={item} list={cardDecks} setList={setCardDecks} showNameField />
              <button
                type="button"
                onClick={() => setCardDecks(cardDecks.filter((_, i) => i !== idx))}
                className="absolute top-2 right-2 text-red-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Other Items */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-gray-700">Other Items</h2>
            <button
              type="button"
              onClick={() => setOtherItems([...otherItems, makeFormItem('other', '')])}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add Other Item
            </button>
          </div>
          {otherItems.length === 0 && (
            <p className="text-xs text-gray-400 italic">No other items added</p>
          )}
          {otherItems.map((item, idx) => (
            <div key={item._key} className="relative">
              <FormItemRow item={item} list={otherItems} setList={setOtherItems} showNameField showSystemField />
              <button
                type="button"
                onClick={() => setOtherItems(otherItems.filter((_, i) => i !== idx))}
                className="absolute top-2 right-2 text-red-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-sm text-gray-700">Notes</h2>
          <textarea
            className="input-field w-full h-24 resize-none"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes..."
          />
        </div>

        {/* Error */}
        {saveError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{saveError}</div>
        )}

        {/* Bottom Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 flex items-center justify-end gap-3 z-40">
          <button
            type="button"
            onClick={backToList}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? 'Submitting...' : 'Submit Survey'}
          </button>
        </div>

        {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </div>
    );
  }

  return null;
}
