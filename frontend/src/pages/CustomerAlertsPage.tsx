import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Search, ArrowUpDown, ShoppingCart, TrendingDown, Package, DollarSign, X, RotateCcw } from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';

interface LapsedCustomer {
  customer_name: string;
  order_count: number;
  avg_gap_days: number;
  last_order_date: string;
  days_since_last: number;
  categories: string[] | null;
  product_lines: string[] | null;
  total_revenue: number;
  salesperson: string | null;
  account_id: number | null;
  shop_name: string | null;
  account_status: string | null;
  rep_id: number | null;
  rep_first_name: string | null;
  rep_last_name: string | null;
}

interface DismissedCustomer {
  id: number;
  customer_name: string;
  reason: 'closed' | 'no_longer_ppg' | 'other';
  notes: string | null;
  account_id: number | null;
  dismissed_at: string;
  by_first_name: string | null;
  by_last_name: string | null;
}

type SortKey = 'days' | 'revenue' | 'orders' | 'name';
type DismissReason = 'closed' | 'no_longer_ppg' | 'other';

const REASON_LABEL: Record<DismissReason, string> = {
  closed: 'Closed',
  no_longer_ppg: 'No longer PPG',
  other: 'Other',
};

export default function CustomerAlertsPage({ user }: { user: User }) {
  const [alerts, setAlerts] = useState<LapsedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('revenue');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [filterRep, setFilterRep] = useState('');

  // Anyone can dismiss/restore — every action is audited and reversible.
  // `user` retained for future role-aware tweaks (e.g. show "by you" labels).
  void user;
  const canDismiss = true;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissModal, setDismissModal] = useState<{ open: boolean; targets: LapsedCustomer[] }>({ open: false, targets: [] });
  const [dismissReason, setDismissReason] = useState<DismissReason>('closed');
  const [dismissNotes, setDismissNotes] = useState('');
  const [dismissing, setDismissing] = useState(false);

  // Dismissed list panel
  const [showDismissedPanel, setShowDismissedPanel] = useState(false);
  const [dismissed, setDismissed] = useState<DismissedCustomer[]>([]);
  const [dismissedLoading, setDismissedLoading] = useState(false);

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get('/customer-alerts');
      setAlerts(data.alerts || []);
    } catch (e: any) {
      setError(e.error || 'Failed to load customer alerts');
    } finally {
      setLoading(false);
    }
  };

  const loadDismissed = async () => {
    setDismissedLoading(true);
    try {
      const data = await api.get('/customer-alerts/dismissed');
      setDismissed(data.dismissed || []);
    } catch (e: any) {
      setError(e.error || 'Failed to load dismissed list');
    } finally {
      setDismissedLoading(false);
    }
  };

  const fmtMoney = (n: number | string) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (d: string) => {
    try {
      const raw = d.includes('T') ? d : d + 'T00:00:00';
      const parsed = new Date(raw);
      if (isNaN(parsed.getTime())) return d;
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return d; }
  };

  // Unique reps for filter
  const allReps = [...new Set(alerts.filter(a => a.rep_first_name).map(a => `${a.rep_first_name} ${a.rep_last_name}`))].sort();

  // Filter
  const filtered = alerts.filter(a => {
    if (search) {
      const q = search.toLowerCase();
      if (!(a.customer_name || '').toLowerCase().includes(q) &&
          !(a.shop_name || '').toLowerCase().includes(q) &&
          !(a.categories || []).some(c => c.toLowerCase().includes(q)) &&
          !(a.product_lines || []).some(p => p.toLowerCase().includes(q))) return false;
    }
    if (filterRep) {
      const repName = a.rep_first_name ? `${a.rep_first_name} ${a.rep_last_name}` : '';
      if (repName !== filterRep) return false;
    }
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'days') cmp = Number(a.days_since_last) - Number(b.days_since_last);
    else if (sortBy === 'revenue') cmp = (Number(a.total_revenue) || 0) - (Number(b.total_revenue) || 0);
    else if (sortBy === 'orders') cmp = Number(a.order_count) - Number(b.order_count);
    else if (sortBy === 'name') cmp = a.customer_name.localeCompare(b.customer_name);
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(false); }
  };

  // Summary stats
  const totalRevAtRisk = filtered.reduce((s, a) => s + (Number(a.total_revenue) || 0), 0);
  const avgDaysSilent = filtered.length > 0 ? Math.round(filtered.reduce((s, a) => s + Number(a.days_since_last), 0) / filtered.length) : 0;

  // Severity color based on days silent
  const severityColor = (days: number) => {
    if (days >= 180) return 'bg-red-100 text-red-700';
    if (days >= 120) return 'bg-red-50 text-red-600';
    if (days >= 90) return 'bg-amber-100 text-amber-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  // ─── Selection helpers ───
  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  // ─── Dismiss flow ───
  const openDismissForSelection = () => {
    const targets = sorted.filter(a => selected.has(a.customer_name));
    if (targets.length === 0) return;
    setDismissReason('closed');
    setDismissNotes('');
    setDismissModal({ open: true, targets });
  };

  const openDismissForOne = (a: LapsedCustomer) => {
    setDismissReason('closed');
    setDismissNotes('');
    setDismissModal({ open: true, targets: [a] });
  };

  const closeDismissModal = () => setDismissModal({ open: false, targets: [] });

  const submitDismiss = async () => {
    if (dismissModal.targets.length === 0) return;
    setDismissing(true);
    try {
      for (const t of dismissModal.targets) {
        await api.post('/customer-alerts/dismiss', {
          customer_name: t.customer_name,
          reason: dismissReason,
          notes: dismissNotes.slice(0, 50),
          account_id: t.account_id || null,
        });
      }
      // Optimistically drop them from the visible list
      const dismissedNames = new Set(dismissModal.targets.map(t => t.customer_name));
      setAlerts(prev => prev.filter(a => !dismissedNames.has(a.customer_name)));
      clearSelection();
      closeDismissModal();
    } catch (e: any) {
      setError(e.error || 'Failed to dismiss');
    } finally {
      setDismissing(false);
    }
  };

  const restoreOne = async (id: number) => {
    try {
      await api.delete(`/customer-alerts/dismiss/${id}`);
      setDismissed(prev => prev.filter(d => d.id !== id));
      // Refresh main list so the customer reappears if they still qualify
      loadAlerts();
    } catch (e: any) {
      setError(e.error || 'Failed to restore');
    }
  };

  const openDismissedPanel = async () => {
    setShowDismissedPanel(true);
    await loadDismissed();
  };

  const visibleSelectedCount = sorted.filter(a => selected.has(a.customer_name)).length;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            Customer Alerts
          </h1>
          <p className="text-sm text-navy-500 mt-1">
            Customers who haven't ordered in 60+ days. Review what they used to buy and reach out with better pricing or back-in-stock news.
          </p>
        </div>
        {canDismiss && (
          <button
            onClick={openDismissedPanel}
            className="btn-ghost text-xs"
            title="View customers permanently removed from alerts"
          >
            View dismissed list
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-amber-50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-amber-700 uppercase">Lapsed Customers</span>
          </div>
          <div className="text-3xl font-bold text-amber-800">{filtered.length}</div>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-red-600" />
            <span className="text-xs font-medium text-red-700 uppercase">Revenue at Risk</span>
          </div>
          <div className="text-3xl font-bold text-red-800">{fmtMoney(totalRevAtRisk)}</div>
        </div>
        <div className="bg-navy-50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShoppingCart className="w-4 h-4 text-navy-600" />
            <span className="text-xs font-medium text-navy-600 uppercase">Avg Days Silent</span>
          </div>
          <div className="text-3xl font-bold text-navy-800">{avgDaysSilent}</div>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 text-green-600" />
            <span className="text-xs font-medium text-green-700 uppercase">Avg Past Orders</span>
          </div>
          <div className="text-3xl font-bold text-green-800">
            {filtered.length > 0 ? Math.round(filtered.reduce((s, a) => s + Number(a.order_count), 0) / filtered.length) : 0}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400" />
          <input
            type="text"
            placeholder="Search by customer, category, or product..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pl-10 w-full"
          />
        </div>
        {allReps.length > 1 && (
          <select
            value={filterRep}
            onChange={e => setFilterRep(e.target.value)}
            className="input-field w-auto"
          >
            <option value="">All Reps</option>
            {allReps.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>

      {/* Bulk action bar */}
      {canDismiss && visibleSelectedCount > 0 && (
        <div className="sticky top-16 z-30 bg-navy-900 text-white rounded-xl px-4 py-2.5 flex items-center justify-between shadow-lg">
          <div className="text-sm font-medium">{visibleSelectedCount} selected</div>
          <div className="flex items-center gap-2">
            <button onClick={clearSelection} className="text-xs text-navy-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-navy-800">Clear</button>
            <button onClick={openDismissForSelection} className="text-xs font-semibold bg-brand-500 hover:bg-brand-600 px-3 py-1.5 rounded-lg">
              Remove from alerts…
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-navy-400 py-8 text-center">Loading customer alerts...</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

      {!loading && !error && sorted.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-navy-500">No lapsed customers found matching your filters.</p>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <>
          {/* Mobile card view */}
          <div className="sm:hidden space-y-2">
            {sorted.map(a => {
              const isExpanded = expandedRow === a.customer_name;
              const isSelected = selected.has(a.customer_name);
              return (
                <div key={a.customer_name} className={`card !p-0 overflow-hidden ${isSelected ? 'ring-2 ring-brand-500' : ''}`}>
                  <div className="flex items-stretch">
                    {canDismiss && (
                      <label className="flex items-center px-3 cursor-pointer" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(a.customer_name)}
                          className="w-4 h-4 accent-brand-500"
                        />
                      </label>
                    )}
                    <button
                      onClick={() => setExpandedRow(isExpanded ? null : a.customer_name)}
                      className="flex-1 text-left p-4 hover:bg-navy-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-navy-900 text-sm truncate">{a.shop_name || a.customer_name}</div>
                          <div className="text-xs text-navy-400 mt-0.5">
                            {a.rep_first_name ? `${a.rep_first_name} ${a.rep_last_name}` : 'No rep'} &middot; {a.order_count} orders
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${severityColor(a.days_since_last)}`}>
                            {a.days_since_last}d silent
                          </span>
                          <div className="text-xs font-bold text-green-700 mt-1">{fmtMoney(a.total_revenue)}</div>
                        </div>
                      </div>
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-navy-100 bg-navy-50 p-4 space-y-3">
                      <div className="text-xs text-navy-500">
                        <strong>Last Order:</strong> {fmtDate(a.last_order_date)} &middot;
                        <strong className="ml-1">Normal Cadence:</strong> every {a.avg_gap_days}d
                      </div>
                      {a.categories && a.categories.length > 0 && (
                        <div>
                          <div className="text-xs font-bold text-red-600 uppercase mb-1">What They Bought — Categories</div>
                          <div className="flex flex-wrap gap-1.5">
                            {a.categories.map(c => (
                              <span key={c} className="px-2 py-0.5 rounded-full bg-white border border-navy-200 text-xs text-navy-700 font-medium">{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {a.product_lines && a.product_lines.length > 0 && (
                        <div>
                          <div className="text-xs font-bold text-brand-600 uppercase mb-1">Product Lines</div>
                          <div className="flex flex-wrap gap-1.5">
                            {a.product_lines.map(p => (
                              <span key={p} className="px-2 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-xs text-brand-700 font-medium">{p}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-3 pt-1 flex-wrap">
                        {a.account_id && (
                          <Link to={`/accounts/${a.account_id}`} className="inline-block text-xs font-medium text-brand-600 hover:underline">
                            View Account &rarr;
                          </Link>
                        )}
                        {canDismiss && (
                          <button
                            onClick={() => openDismissForOne(a)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Remove from alerts
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table view */}
          <div className="hidden sm:block card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  {canDismiss && (
                    <th className="text-left py-3 px-3 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all visible"
                        checked={sorted.length > 0 && sorted.every(a => selected.has(a.customer_name))}
                        onChange={e => {
                          if (e.target.checked) setSelected(new Set(sorted.map(a => a.customer_name)));
                          else clearSelection();
                        }}
                        className="w-4 h-4 accent-brand-500"
                      />
                    </th>
                  )}
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase w-6"></th>
                  <th onClick={() => toggleSort('name')} className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase cursor-pointer hover:text-navy-700 select-none">
                    <span className="flex items-center gap-1">Customer <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th onClick={() => toggleSort('days')} className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase cursor-pointer hover:text-navy-700 select-none">
                    <span className="flex items-center justify-end gap-1">Days Silent <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase hidden md:table-cell">Last Order</th>
                  <th onClick={() => toggleSort('revenue')} className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase cursor-pointer hover:text-navy-700 select-none">
                    <span className="flex items-center justify-end gap-1">Revenue <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th onClick={() => toggleSort('orders')} className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase cursor-pointer hover:text-navy-700 select-none hidden lg:table-cell">
                    <span className="flex items-center justify-end gap-1">Orders <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase hidden lg:table-cell">Rep</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(a => {
                  const isExpanded = expandedRow === a.customer_name;
                  const isSelected = selected.has(a.customer_name);
                  return (
                    <>
                      <tr
                        key={a.customer_name}
                        onClick={() => setExpandedRow(isExpanded ? null : a.customer_name)}
                        className={`border-b border-navy-50 cursor-pointer transition-colors ${isSelected ? 'bg-brand-50/50 hover:bg-brand-50' : 'hover:bg-amber-50/50'}`}
                      >
                        {canDismiss && (
                          <td className="py-3 px-3" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(a.customer_name)}
                              className="w-4 h-4 accent-brand-500"
                            />
                          </td>
                        )}
                        <td className="py-3 px-4 text-navy-400">
                          <span className={`inline-block transition-transform text-xs ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-sm font-medium text-navy-900">{a.shop_name || a.customer_name}</div>
                          {a.salesperson && <div className="text-[11px] text-navy-400">{a.salesperson}</div>}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${severityColor(a.days_since_last)}`}>
                            {a.days_since_last}d
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-navy-500 hidden md:table-cell">{fmtDate(a.last_order_date)}</td>
                        <td className="py-3 px-4 text-sm text-right font-bold text-green-600">{fmtMoney(a.total_revenue)}</td>
                        <td className="py-3 px-4 text-sm text-right text-navy-500 hidden lg:table-cell">{a.order_count}</td>
                        <td className="py-3 px-4 text-sm text-navy-500 hidden lg:table-cell">
                          {a.rep_first_name ? `${a.rep_first_name} ${a.rep_last_name}` : '-'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${a.customer_name}-detail`}>
                          <td colSpan={canDismiss ? 8 : 7} className="p-0">
                            <div className="bg-navy-50 border-y border-navy-100 px-4 pl-10 py-4 space-y-3">
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-navy-500">
                                <span>Normal cadence: <strong className="text-navy-700">every {a.avg_gap_days} days</strong></span>
                                <span>Total orders: <strong className="text-navy-700">{a.order_count}</strong></span>
                                <span>Total revenue: <strong className="text-green-700">{fmtMoney(a.total_revenue)}</strong></span>
                                <span>Last order: <strong className="text-navy-700">{fmtDate(a.last_order_date)}</strong></span>
                              </div>

                              {a.categories && a.categories.length > 0 && (
                                <div>
                                  <div className="text-xs font-bold text-red-600 uppercase tracking-wide mb-1.5">What They Used to Buy — Categories</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {a.categories.map(c => (
                                      <span key={c} className="px-2.5 py-1 rounded-full bg-white border border-navy-200 text-xs text-navy-700 font-medium shadow-sm">{c}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {a.product_lines && a.product_lines.length > 0 && (
                                <div>
                                  <div className="text-xs font-bold text-brand-600 uppercase tracking-wide mb-1.5">Product Lines Purchased</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {a.product_lines.map(p => (
                                      <span key={p} className="px-2.5 py-1 rounded-full bg-brand-50 border border-brand-200 text-xs text-brand-700 font-medium shadow-sm">{p}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center gap-3 pt-1 flex-wrap">
                                {a.account_id && (
                                  <Link to={`/accounts/${a.account_id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline">
                                    View Account &rarr;
                                  </Link>
                                )}
                                {canDismiss && (
                                  <button
                                    onClick={() => openDismissForOne(a)}
                                    className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                                  >
                                    Remove from alerts
                                  </button>
                                )}
                                <span className="text-xs text-navy-400 italic">
                                  Reach out with better pricing, back-in-stock news, or new product offerings in these categories.
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── Dismiss modal ─── */}
      {dismissModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-fade-in">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-navy-900">
                Remove from alerts
              </h2>
              <button onClick={closeDismissModal} className="text-navy-400 hover:text-navy-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-navy-500">
              {dismissModal.targets.length === 1
                ? <>Permanently remove <strong>{dismissModal.targets[0].shop_name || dismissModal.targets[0].customer_name}</strong> from the customer alerts page.</>
                : <>Permanently remove <strong>{dismissModal.targets.length}</strong> customers from the customer alerts page.</>}
              {' '}A note will be added to each linked account card.
            </p>

            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">Reason</label>
              <select
                value={dismissReason}
                onChange={e => setDismissReason(e.target.value as DismissReason)}
                className="input-field w-full"
              >
                <option value="closed">Closed</option>
                <option value="no_longer_ppg">No longer PPG</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-700 uppercase mb-1.5">
                Notes <span className="text-navy-400 normal-case font-normal">(optional, max 50 chars)</span>
              </label>
              <input
                type="text"
                maxLength={50}
                value={dismissNotes}
                onChange={e => setDismissNotes(e.target.value)}
                placeholder="e.g. Confirmed by owner Jan 2026"
                className="input-field w-full"
              />
              <div className="text-xs text-navy-400 mt-1 text-right">{dismissNotes.length}/50</div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={closeDismissModal} className="btn-ghost text-sm" disabled={dismissing}>Cancel</button>
              <button onClick={submitDismiss} disabled={dismissing} className="btn-primary text-sm">
                {dismissing ? 'Saving…' : `Remove ${dismissModal.targets.length > 1 ? dismissModal.targets.length + ' customers' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Dismissed list panel ─── */}
      {showDismissedPanel && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-navy-100">
              <h2 className="text-lg font-bold text-navy-900">Dismissed customers</h2>
              <button onClick={() => setShowDismissedPanel(false)} className="text-navy-400 hover:text-navy-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              {dismissedLoading && <div className="text-navy-400 text-center py-6">Loading…</div>}
              {!dismissedLoading && dismissed.length === 0 && (
                <div className="text-center text-navy-500 py-6 text-sm">No dismissed customers yet.</div>
              )}
              {!dismissedLoading && dismissed.length > 0 && (
                <ul className="divide-y divide-navy-100">
                  {dismissed.map(d => (
                    <li key={d.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-navy-900 text-sm truncate">{d.customer_name}</div>
                        <div className="text-xs text-navy-500 mt-0.5">
                          <span className="font-semibold">{REASON_LABEL[d.reason]}</span>
                          {d.notes && <span> — {d.notes}</span>}
                        </div>
                        <div className="text-[11px] text-navy-400 mt-0.5">
                          {fmtDate(d.dismissed_at)}
                          {d.by_first_name && ` · by ${d.by_first_name} ${d.by_last_name || ''}`}
                          {d.account_id && (
                            <> · <Link to={`/accounts/${d.account_id}`} className="text-brand-600 hover:underline">view account</Link></>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => restoreOne(d.id)}
                        className="flex items-center gap-1 text-xs font-medium text-navy-600 hover:text-brand-600 px-2 py-1 rounded-lg hover:bg-navy-50"
                        title="Put this customer back on the alerts page"
                      >
                        <RotateCcw className="w-3 h-3" /> Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
