import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, RefreshCw, Search, MapPin, User as UserIcon, ChevronDown, ChevronRight, UserPlus, Check } from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';

interface RepOption { id: number; first_name: string; last_name: string; role: string; is_active: boolean }

interface HoldUpdate { text: string; addedAt: string; addedBy: string }
interface Hold {
  id: number;
  intranet_id: string;
  customer_name: string;
  branch: string | null;
  reason: string | null;
  added_at: string | null;
  added_by: string | null;
  updates: HoldUpdate[];
  intranet_updated_at: string | null;
  account_id: number | null;
  rep_id: number | null;
  shop_name: string | null;
  rep_first_name: string | null;
  rep_last_name: string | null;
  days_on_hold: number | null;
  update_count: number;
}

interface HoldsResp { holds: Hold[]; total_active: number; unassigned: number }

function DaysChip({ days }: { days: number | null }) {
  if (days === null) return null;
  const cls = days >= 30 ? 'bg-red-100 text-red-700' : days >= 7 ? 'bg-amber-100 text-amber-800' : 'bg-navy-100 text-navy-700';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{days}d on hold</span>;
}

function AssignControl({ hold, reps, onAssigned }: { hold: Hold; reps: RepOption[]; onAssigned: (repId: number) => void }) {
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (repId: number) => {
    setSaving(true); setErr(null);
    try {
      await api.put(`/holds/${hold.id}/assign`, { rep_id: repId });
      onAssigned(repId);
      setPicking(false);
    } catch (e: any) {
      setErr(e.error || 'failed');
    } finally { setSaving(false); }
  };
  if (!picking) {
    return (
      <button
        onClick={() => setPicking(true)}
        className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-semibold hover:bg-amber-200"
      >
        <UserPlus className="w-3 h-3" /> Assign rep
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1">
      <select
        autoFocus
        disabled={saving}
        onChange={e => e.target.value && submit(parseInt(e.target.value, 10))}
        className="text-xs border border-navy-200 rounded px-2 py-1 bg-white"
        defaultValue=""
      >
        <option value="" disabled>Pick rep…</option>
        {reps.map(r => <option key={r.id} value={r.id}>{r.first_name} {r.last_name}</option>)}
      </select>
      <button onClick={() => setPicking(false)} className="text-xs text-navy-500 hover:text-navy-800">Cancel</button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

function HoldRow({ hold, reps, onAssigned }: { hold: Hold; reps: RepOption[]; onAssigned: (holdId: number, repId: number) => void }) {
  const [open, setOpen] = useState(false);
  const isManager = reps.length > 0;
  return (
    <li className="bg-white">
      <div className="p-3 sm:p-4 flex items-start gap-3">
        <button onClick={() => setOpen(o => !o)} className="mt-0.5 text-navy-400 hover:text-navy-700">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {hold.account_id ? (
              <Link to={`/accounts/${hold.account_id}`} className="font-semibold text-navy-900 hover:text-brand-600">
                {hold.customer_name}
              </Link>
            ) : (
              <span className="font-semibold text-navy-900">{hold.customer_name}</span>
            )}
            {hold.branch && (
              <span className="inline-flex items-center gap-1 text-xs text-navy-500">
                <MapPin className="w-3 h-3" /> {hold.branch}
              </span>
            )}
            {hold.rep_first_name ? (
              <span className="inline-flex items-center gap-1 text-xs text-navy-500">
                <UserIcon className="w-3 h-3" /> {hold.rep_first_name} {hold.rep_last_name}
              </span>
            ) : isManager ? (
              <AssignControl hold={hold} reps={reps} onAssigned={(repId) => onAssigned(hold.id, repId)} />
            ) : (
              <span className="text-xs text-amber-700 font-semibold">Unassigned</span>
            )}
            <DaysChip days={hold.days_on_hold} />
            {hold.update_count > 0 && (
              <span className="text-xs text-navy-500">{hold.update_count} update{hold.update_count !== 1 ? 's' : ''}</span>
            )}
          </div>
          {hold.reason && <div className="text-sm text-red-700 font-medium mt-1">{hold.reason}</div>}
          <div className="text-[11px] text-navy-400 mt-1">
            Added {hold.added_at ? new Date(hold.added_at).toLocaleDateString() : '—'}
            {hold.added_by ? ` by ${hold.added_by}` : ''}
          </div>
        </div>
      </div>
      {open && hold.updates && hold.updates.length > 0 && (
        <div className="px-4 pb-4 ml-7 border-l-2 border-navy-100 space-y-2">
          {hold.updates.map((u, i) => (
            <div key={i} className="bg-navy-50 rounded p-2 text-sm">
              <div className="text-navy-800">{u.text}</div>
              <div className="text-[11px] text-navy-400 mt-1">
                {u.addedBy} · {new Date(u.addedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && (!hold.updates || hold.updates.length === 0) && (
        <div className="px-4 pb-4 ml-7 text-xs text-navy-400 italic">No updates yet.</div>
      )}
    </li>
  );
}

export default function HoldsPage({ user }: { user: User }) {
  const [data, setData] = useState<HoldsResp | null>(null);
  const [reps, setReps] = useState<RepOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState<string>('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const isManager = user.role === 'admin' || user.role === 'manager';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (q) params.q = q;
      if (branch) params.branch = branch;
      const r = await api.get<HoldsResp>('/holds', params);
      setData(r);
    } catch (e: any) {
      setError(e.error || 'Failed to load holds');
    } finally {
      setLoading(false);
    }
  };

  const loadReps = async () => {
    if (!isManager) return;
    try {
      const r = await api.get<{ users: RepOption[] }>('/auth/users');
      setReps((r.users || []).filter(u => u.is_active));
    } catch {}
  };

  useEffect(() => { load(); loadReps(); }, []);

  const onAssigned = (holdId: number, repId: number) => {
    const rep = reps.find(r => r.id === repId);
    if (!data || !rep) return;
    setData({
      ...data,
      holds: data.holds.map(h => h.id === holdId ? { ...h, rep_id: repId, rep_first_name: rep.first_name, rep_last_name: rep.last_name } : h),
      unassigned: Math.max(0, data.unassigned - 1),
    });
  };

  const branches = useMemo(() => {
    const set = new Set<string>();
    (data?.holds || []).forEach(h => h.branch && set.add(h.branch));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.holds.filter(h =>
      (!branch || h.branch === branch) &&
      (!unassignedOnly || h.rep_id === null) &&
      (!q || h.customer_name.toLowerCase().includes(q.toLowerCase()) || (h.reason || '').toLowerCase().includes(q.toLowerCase()))
    );
  }, [data, branch, q, unassignedOnly]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/holds/refresh', {});
      await load();
    } catch (e: any) {
      setError(e.error || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
            <AlertOctagon className="w-6 h-6 text-red-600" /> Customers On Hold
          </h1>
          <div className="text-sm text-navy-500">
            Synced daily from CHC Intranet · {data?.total_active ?? 0} active
            {isManager && data && data.unassigned > 0 && ` · ${data.unassigned} unassigned`}
          </div>
        </div>
        {isManager && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-navy-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search customer or reason…"
            className="w-full pl-9 pr-3 py-2 border border-navy-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={branch}
          onChange={e => setBranch(e.target.value)}
          className="px-3 py-2 border border-navy-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All branches</option>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        {isManager && (
          <button
            onClick={() => setUnassignedOnly(u => !u)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${unassignedOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-navy-200 text-navy-700 hover:bg-navy-50'}`}
          >
            {unassignedOnly && <Check className="w-4 h-4 inline mr-1" />}
            Unassigned only{data ? ` (${data.unassigned})` : ''}
          </button>
        )}
      </div>

      {loading && <div className="text-navy-400">Loading…</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="bg-white border border-navy-100 rounded-xl p-8 text-center text-navy-400">
          {data && data.total_active === 0 ? 'No customers on hold today.' : 'No holds match your filters.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="bg-white border border-navy-100 rounded-xl divide-y divide-navy-100 overflow-hidden">
          {filtered.map(h => <HoldRow key={h.id} hold={h} reps={isManager ? reps : []} onAssigned={onAssigned} />)}
        </ul>
      )}
    </div>
  );
}
