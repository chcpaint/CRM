import { useState, useRef, useEffect } from 'react';
import { Account, User } from '../../types';
import { api } from '../../services/api';

interface RepOption {
  id: number;
  first_name: string;
  last_name: string;
}

interface Props {
  account: Account;
  user: User;
  onSave: () => void;
}

// ─── Dropdown options ───
const PAINT_LINE_OPTIONS = ['', 'PPG', 'Sherwin-Williams', 'Axalta', 'BASF', 'AkzoNobel', 'Matrix', 'Sikkens', 'Prospray', 'Other'];
const CUP_BRAND_OPTIONS = ['', '3M PPS', 'SATA RPS', 'DeVilbiss DeKups', 'Colad Snap Lid', 'Other'];
const PAPER_BRAND_OPTIONS = ['', '3M', 'Norton', 'Mirka', 'Indasa', 'Klingspor', 'Other'];
const FILLER_OPTIONS = ['', 'Bondo/3M', 'Evercoat', 'USC', 'U-POL', 'Other'];
const BANNER_OPTIONS = ['', 'CARSTAR', 'Fix Auto', 'Boyd/Gerber', 'CSN Collision', 'Assured Auto', 'Simplicity', 'None', 'Other'];
const BRANCH_OPTIONS = ['', 'Hamilton', 'Markham', 'Oakville', 'Ottawa', 'St. Catharines', 'Woodbridge'];
const CONTRACT_STATUS_OPTIONS = ['none', 'pending', 'active', 'expired', 'cancelled'];
const BUSINESS_TYPE_OPTIONS = [
  'Commercial Vehicles',
  'General Public',
  'Trailers',
  'Powder Coat',
  'Fireplace or Equipment',
  'Other'
];

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  none: 'None',
  pending: 'Pending',
  active: 'Active',
  expired: 'Expired',
  cancelled: 'Cancelled'
};

const CONTRACT_STATUS_COLORS: Record<string, string> = {
  none: 'text-navy-400',
  pending: 'text-amber-600',
  active: 'text-green-600',
  expired: 'text-red-600',
  cancelled: 'text-navy-400'
};

function parseBusinessTypes(val: string[] | string | null): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

export default function ShopDetails({ account, user, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reps, setReps] = useState<RepOption[]>([]);
  const isManager = user.role === 'admin' || user.role === 'manager';

  // Load reps list for managers
  useEffect(() => {
    if (isManager) {
      api.get('/auth/users').then((data: any) => {
        if (data.users) setReps(data.users.filter((u: any) => u.is_active));
      }).catch(() => {});
    }
  }, [isManager]);

  // Edit state
  const [form, setForm] = useState({
    sq_footage: account.sq_footage || '',
    annual_revenue: account.annual_revenue?.toString() || '',
    paint_line: account.paint_line || '',
    contract_status: account.contract_status || 'none',
    num_painters: account.num_painters?.toString() || '',
    num_body_men: account.num_body_men?.toString() || '',
    num_paint_booths: account.num_paint_booths?.toString() || '',
    cup_brand: account.cup_brand || '',
    paper_brand: account.paper_brand || '',
    filler_brand: account.filler_brand || '',
    suppliers: account.suppliers || '',
    deal_details: account.deal_details || '',
    banner: account.banner || '',
    branch: account.branch || '',
    business_types: parseBusinessTypes(account.business_types),
    business_type_notes: account.business_type_notes || '',
    contract_expiration_date: account.contract_expiration_date || '',
    assigned_rep_id: account.assigned_rep_id?.toString() || '',
    secondary_rep_id: account.secondary_rep_id?.toString() || '',
  });

  const startEditing = () => {
    setForm({
      sq_footage: account.sq_footage || '',
      annual_revenue: account.annual_revenue?.toString() || '',
      paint_line: account.paint_line || '',
      contract_status: account.contract_status || 'none',
      num_painters: account.num_painters?.toString() || '',
      num_body_men: account.num_body_men?.toString() || '',
      num_paint_booths: account.num_paint_booths?.toString() || '',
      cup_brand: account.cup_brand || '',
      paper_brand: account.paper_brand || '',
      filler_brand: account.filler_brand || '',
      suppliers: account.suppliers || '',
      deal_details: account.deal_details || '',
      banner: account.banner || '',
      branch: account.branch || '',
      business_types: parseBusinessTypes(account.business_types),
      business_type_notes: account.business_type_notes || '',
      contract_expiration_date: account.contract_expiration_date || '',
      assigned_rep_id: account.assigned_rep_id?.toString() || '',
      secondary_rep_id: account.secondary_rep_id?.toString() || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/accounts/${account.id}`, {
        sq_footage: form.sq_footage || null,
        annual_revenue: form.annual_revenue ? parseFloat(form.annual_revenue) : null,
        paint_line: form.paint_line || null,
        contract_status: form.contract_status,
        num_painters: form.num_painters ? parseInt(form.num_painters) : null,
        num_body_men: form.num_body_men ? parseInt(form.num_body_men) : null,
        num_paint_booths: form.num_paint_booths ? parseInt(form.num_paint_booths) : null,
        cup_brand: form.cup_brand || null,
        paper_brand: form.paper_brand || null,
        filler_brand: form.filler_brand || null,
        suppliers: form.suppliers || null,
        deal_details: form.deal_details || null,
        banner: form.banner || null,
        branch: form.branch || null,
        business_types: form.business_types,
        business_type_notes: form.business_type_notes || null,
        contract_expiration_date: form.contract_expiration_date || null,
        ...(isManager ? {
          assigned_rep_id: form.assigned_rep_id ? parseInt(form.assigned_rep_id) : null,
          secondary_rep_id: form.secondary_rep_id ? parseInt(form.secondary_rep_id) : null,
        } : {}),
      });
      setEditing(false);
      onSave();
    } catch (err) {
      console.error('Save shop details failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('contract', file);
      const resp = await fetch(`/api/accounts/${account.id}/upload-contract`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData
      });
      if (!resp.ok) throw new Error('Upload failed');
      onSave();
    } catch (err) {
      console.error('Contract upload failed:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleBusinessType = (type: string) => {
    setForm(f => ({
      ...f,
      business_types: f.business_types.includes(type)
        ? f.business_types.filter(t => t !== type)
        : [...f.business_types, type]
    }));
  };

  const businessTypes = parseBusinessTypes(account.business_types);
  const contractStatus = account.contract_status || 'none';

  // Format last contact date
  const lastContactDisplay = account.last_contacted_at
    ? new Date(account.last_contacted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never';
  const repDisplay = account.rep_first_name ? `${account.rep_first_name} ${account.rep_last_name}` : null;
  const secondaryRepDisplay = account.secondary_rep_first_name ? `${account.secondary_rep_first_name} ${account.secondary_rep_last_name}` : null;

  // ─── READ-ONLY VIEW ───
  if (!editing) {
    return (
      <div className="card">
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-bold text-navy-900 text-base">Shop Details</h3>
          <button onClick={startEditing} className="btn-ghost text-sm">Edit</button>
        </div>

        <div className="space-y-4 text-sm">
          {/* Row 1: Key numbers + last contact */}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3">
            <StatBox label="Sq Ft" value={account.sq_footage} />
            <StatBox label="Revenue" value={account.annual_revenue ? `$${Number(account.annual_revenue).toLocaleString()}` : null} />
            <StatBox label="Painters" value={account.num_painters?.toString()} />
            <StatBox label="Body Men" value={account.num_body_men?.toString()} />
            <StatBox label="Paint Booths" value={account.num_paint_booths?.toString()} />
            <StatBox label="Last Contact" value={lastContactDisplay} highlight={!account.last_contacted_at} />
          </div>

          {/* Row 2: Products & brands */}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3">
            <StatBox label="Paint Line" value={account.paint_line} />
            <StatBox label="Cup Brand" value={account.cup_brand} />
            <StatBox label="Paper Brand" value={account.paper_brand} />
            <StatBox label="Filler" value={account.filler_brand} />
            <StatBox label="Banner" value={account.banner} />
            <StatBox label="Buy From" value={account.suppliers} />
          </div>

          {/* Row 3: Contract + Rep */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="bg-navy-50 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">Contract Status</div>
              <div className={`font-semibold text-sm ${CONTRACT_STATUS_COLORS[contractStatus]}`}>
                {CONTRACT_STATUS_LABELS[contractStatus] || 'None'}
              </div>
            </div>
            <StatBox label="Branch" value={account.branch || 'Unassigned'} highlight={!account.branch} />
            {repDisplay && <StatBox label="Primary Rep" value={repDisplay} />}
            {secondaryRepDisplay && <StatBox label="Secondary Rep" value={secondaryRepDisplay} />}
            {account.follow_up_date && (
              <StatBox label="Follow-Up" value={new Date(account.follow_up_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
            )}
          </div>

          {/* Business Types */}
          {businessTypes.length > 0 && (
            <div className="pt-3 border-t border-navy-100">
              <div className="text-xs text-navy-400 mb-2 font-medium">Business Type</div>
              <div className="flex flex-wrap gap-2">
                {businessTypes.map(t => (
                  <span key={t} className="text-xs bg-brand-50 text-brand-700 px-3 py-1.5 rounded-full font-medium">{t}</span>
                ))}
              </div>
              {account.business_type_notes && (
                <p className="text-xs text-navy-500 mt-2 italic">{account.business_type_notes}</p>
              )}
            </div>
          )}

          {/* Deal Details */}
          {account.deal_details && (
            <div className="pt-3 border-t border-navy-100">
              <div className="text-xs text-navy-400 mb-1 font-medium">Deal Details</div>
              <p className="text-sm text-navy-700 whitespace-pre-wrap">{account.deal_details}</p>
            </div>
          )}

          {/* Contract File & Expiration */}
          {(account.contract_file_path || account.contract_expiration_date) && (
            <div className="pt-3 border-t border-navy-100">
              <div className="text-xs text-navy-400 mb-2 font-medium">CHC Contract</div>
              <div className="flex flex-wrap items-center gap-4">
                {account.contract_file_path && (
                  <a
                    href={account.contract_file_path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium"
                  >
                    📄 View Contract
                  </a>
                )}
                {account.contract_expiration_date && (() => {
                  const exp = new Date(account.contract_expiration_date + 'T00:00:00');
                  const now = new Date();
                  const daysUntil = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  const isExpired = daysUntil < 0;
                  const isExpiringSoon = daysUntil >= 0 && daysUntil <= 30;
                  return (
                    <div className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg ${
                      isExpired ? 'bg-red-50 text-red-700 border border-red-200' :
                      isExpiringSoon ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-green-50 text-green-700 border border-green-200'
                    }`}>
                      {isExpired ? '⚠️' : isExpiringSoon ? '⏰' : '✓'}
                      <span>Expires {exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      {isExpired && <span className="text-xs">(expired)</span>}
                      {isExpiringSoon && !isExpired && <span className="text-xs">({daysUntil} days)</span>}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── EDIT VIEW ───
  return (
    <div className="card border-brand-200">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-navy-900">Shop Details</h3>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="btn-ghost text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Row 1: Numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <FieldInput label="Shop Sq Ft" type="text" value={form.sq_footage} onChange={v => setForm(f => ({ ...f, sq_footage: v }))} placeholder="e.g. 5000" />
          <FieldInput label="Shop Revenue" type="text" value={form.annual_revenue} onChange={v => setForm(f => ({ ...f, annual_revenue: v }))} placeholder="e.g. 500000" />
          <FieldInput label="# Painters" type="number" value={form.num_painters} onChange={v => setForm(f => ({ ...f, num_painters: v }))} placeholder="0" />
          <FieldInput label="# Body Men" type="number" value={form.num_body_men} onChange={v => setForm(f => ({ ...f, num_body_men: v }))} placeholder="0" />
          <FieldInput label="# Paint Booths" type="number" value={form.num_paint_booths} onChange={v => setForm(f => ({ ...f, num_paint_booths: v }))} placeholder="0" />
        </div>

        {/* Row 2: Dropdowns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <FieldSelect label="Paint Line" value={form.paint_line} onChange={v => setForm(f => ({ ...f, paint_line: v }))} options={PAINT_LINE_OPTIONS} />
          <FieldSelect label="Cup Brand" value={form.cup_brand} onChange={v => setForm(f => ({ ...f, cup_brand: v }))} options={CUP_BRAND_OPTIONS} />
          <FieldSelect label="Paper Brand" value={form.paper_brand} onChange={v => setForm(f => ({ ...f, paper_brand: v }))} options={PAPER_BRAND_OPTIONS} />
          <FieldSelect label="Filler" value={form.filler_brand} onChange={v => setForm(f => ({ ...f, filler_brand: v }))} options={FILLER_OPTIONS} />
          <FieldSelect label="Banner" value={form.banner} onChange={v => setForm(f => ({ ...f, banner: v }))} options={BANNER_OPTIONS} />
          <FieldSelect label="Contract Status" value={form.contract_status} onChange={v => setForm(f => ({ ...f, contract_status: v }))} options={CONTRACT_STATUS_OPTIONS} labels={CONTRACT_STATUS_LABELS} />
        </div>

        {/* Branch + Rep Assignment — managers/admins only */}
        {isManager && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-navy-100">
            <div>
              <label className="block text-xs text-navy-500 mb-1 font-semibold">Branch</label>
              <select
                value={form.branch}
                onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
                className="input-field w-full"
              >
                <option value="">— Unassigned —</option>
                {BRANCH_OPTIONS.filter(b => b).map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {isManager && reps.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-navy-500 mb-1 font-semibold">Primary Rep</label>
              <select
                value={form.assigned_rep_id}
                onChange={e => setForm(f => ({ ...f, assigned_rep_id: e.target.value }))}
                className="input-field w-full"
              >
                <option value="">— Unassigned —</option>
                {reps.map(r => (
                  <option key={r.id} value={r.id.toString()}>{r.first_name} {r.last_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-navy-500 mb-1 font-semibold">Secondary Rep</label>
              <select
                value={form.secondary_rep_id}
                onChange={e => setForm(f => ({ ...f, secondary_rep_id: e.target.value }))}
                className="input-field w-full"
              >
                <option value="">— None —</option>
                {reps.filter(r => r.id.toString() !== form.assigned_rep_id).map(r => (
                  <option key={r.id} value={r.id.toString()}>{r.first_name} {r.last_name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Row 3: Text fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldInput label="Who Do They Buy From" type="text" value={form.suppliers} onChange={v => setForm(f => ({ ...f, suppliers: v }))} placeholder="e.g. PPG, 3M, Uni-Select" />
          <div>
            <label className="block text-xs text-navy-500 mb-1">Deal Details</label>
            <textarea
              value={form.deal_details}
              onChange={e => setForm(f => ({ ...f, deal_details: e.target.value }))}
              className="input-field resize-none w-full"
              rows={2}
              placeholder="Pricing notes, special terms..."
            />
          </div>
        </div>

        {/* Business Type — Multi-select checkboxes */}
        <div>
          <label className="block text-xs text-navy-500 mb-2">Business Type (select all that apply)</label>
          <div className="flex flex-wrap gap-2">
            {BUSINESS_TYPE_OPTIONS.map(type => {
              const selected = form.business_types.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleBusinessType(type)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    selected
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-navy-600 border-navy-200 hover:border-brand-300'
                  }`}
                >
                  {selected ? '✓ ' : ''}{type}
                </button>
              );
            })}
          </div>
          {form.business_types.includes('Other') && (
            <textarea
              value={form.business_type_notes}
              onChange={e => setForm(f => ({ ...f, business_type_notes: e.target.value }))}
              className="input-field mt-2 resize-none w-full"
              rows={2}
              placeholder="Describe other business types..."
            />
          )}
        </div>

        {/* Contract Upload & Expiration Date */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-navy-500 mb-1 font-semibold">Contract Expiration Date</label>
            <input
              type="date"
              value={form.contract_expiration_date}
              onChange={e => setForm(f => ({ ...f, contract_expiration_date: e.target.value }))}
              className="input-field w-full sm:w-auto"
            />
          </div>
          <div>
            <label className="block text-xs text-navy-500 mb-1">CHC Contract File</label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={handleFileUpload}
                className="text-sm text-navy-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
              />
              {uploading && <span className="text-xs text-navy-400">Uploading...</span>}
              {account.contract_file_path && (
                <a href={account.contract_file_path} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline">
                  View current
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable sub-components ───

function StatBox({ label, value, highlight }: { label: string; value: string | null | undefined; highlight?: boolean }) {
  return (
    <div className="bg-navy-50 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-navy-400 mb-1">{label}</div>
      <div className={`font-semibold text-sm truncate ${highlight ? 'text-amber-600' : 'text-navy-800'}`}>{value || '—'}</div>
    </div>
  );
}

function FieldInput({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-navy-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input-field w-full"
        placeholder={placeholder}
      />
    </div>
  );
}

function FieldSelect({ label, value, onChange, options, labels }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; labels?: Record<string, string>;
}) {
  return (
    <div>
      <label className="block text-xs text-navy-500 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input-field w-full">
        {options.map(opt => (
          <option key={opt} value={opt}>{labels ? (labels[opt] || opt) : (opt || '— Select —')}</option>
        ))}
      </select>
    </div>
  );
}
