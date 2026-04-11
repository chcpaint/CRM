import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Search, ArrowUpDown, ShoppingCart, TrendingDown, Package, DollarSign } from 'lucide-react';
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

type SortKey = 'days' | 'revenue' | 'orders' | 'name';

export default function CustomerAlertsPage({ user }: { user: User }) {
  const [alerts, setAlerts] = useState<LapsedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('revenue');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [filterRep, setFilterRep] = useState('');

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

  const fmtMoney = (n: number) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (d: string) => {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
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
    if (sortBy === 'days') cmp = a.days_since_last - b.days_since_last;
    else if (sortBy === 'revenue') cmp = (a.total_revenue || 0) - (b.total_revenue || 0);
    else if (sortBy === 'orders') cmp = a.order_count - b.order_count;
    else if (sortBy === 'name') cmp = a.customer_name.localeCompare(b.customer_name);
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(false); }
  };

  // Summary stats
  const totalRevAtRisk = filtered.reduce((s, a) => s + (a.total_revenue || 0), 0);
  const avgDaysSilent = filtered.length > 0 ? Math.round(filtered.reduce((s, a) => s + a.days_since_last, 0) / filtered.length) : 0;

  // Severity color based on days silent
  const severityColor = (days: number) => {
    if (days >= 180) return 'bg-red-100 text-red-700';
    if (days >= 120) return 'bg-red-50 text-red-600';
    if (days >= 90) return 'bg-amber-100 text-amber-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          Customer Alerts
        </h1>
        <p className="text-sm text-navy-500 mt-1">
          Customers who haven't ordered in 60+ days. Review what they used to buy and reach out with better pricing or back-in-stock news.
        </p>
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
            {filtered.length > 0 ? Math.round(filtered.reduce((s, a) => s + a.order_count, 0) / filtered.length) : 0}
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
              return (
                <div key={a.customer_name} className="card !p-0 overflow-hidden">
                  <button
                    onClick={() => setExpandedRow(isExpanded ? null : a.customer_name)}
                    className="w-full text-left p-4 hover:bg-navy-50 transition-colors"
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
                      {a.account_id && (
                        <Link to={`/accounts/${a.account_id}`} className="inline-block text-xs font-medium text-brand-600 hover:underline">
                          View Account &rarr;
                        </Link>
                      )}
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
                  return (
                    <>
                      <tr
                        key={a.customer_name}
                        onClick={() => setExpandedRow(isExpanded ? null : a.customer_name)}
                        className="border-b border-navy-50 cursor-pointer hover:bg-amber-50/50 transition-colors"
                      >
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
                          <td colSpan={7} className="p-0">
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

                              <div className="flex items-center gap-3 pt-1">
                                {a.account_id && (
                                  <Link to={`/accounts/${a.account_id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline">
                                    View Account &rarr;
                                  </Link>
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
    </div>
  );
}
