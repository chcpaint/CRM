import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { User, SalesData } from '../types';

interface Props { user: User }

export default function SalesPage({ user }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sales, setSales] = useState<SalesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const [shopTargets, setShopTargets] = useState<Map<string, { target: number; salesperson?: string; install?: string }>>(new Map());

  // Filters
  const [filterCustomer, setFilterCustomer] = useState<string>('');
  const [filterSalesperson, setFilterSalesperson] = useState<string>('');
  const [filterYear, setFilterYear] = useState<string>(String(new Date().getFullYear()));
  const [voiceMatchFeedback, setVoiceMatchFeedback] = useState<string>('');
  const [revSummary, setRevSummary] = useState<{
    year: string;
    currentMonth: string;
    salespersons: { salesperson: string; ytd_revenue: number; month_revenue: number }[];
    company: { ytd_total: number; month_total: number };
  } | null>(null);
  const [revError, setRevError] = useState(false);

  useEffect(() => { loadSales(); loadShopTargets(); }, []);

  // Handle ?customer= URL param (from voice navigation) — fuzzy match
  useEffect(() => {
    const customerParam = searchParams.get('customer');
    if (customerParam && sales.length > 0) {
      const query = customerParam.toLowerCase();
      const customers = [...new Set(sales.map(s => s.customer_name || s.shop_name || '').filter(Boolean))];

      const exact = customers.find(c => c.toLowerCase() === query);
      if (exact) {
        setFilterCustomer(exact);
        setExpandedSale(exact);
        setVoiceMatchFeedback('');
      } else {
        const contains = customers.filter(c => c.toLowerCase().includes(query) || query.includes(c.toLowerCase()));
        if (contains.length === 1) {
          setFilterCustomer(contains[0]);
          setExpandedSale(contains[0]);
          setVoiceMatchFeedback('');
        } else if (contains.length > 1) {
          const best = contains.sort((a, b) =>
            Math.abs(a.length - customerParam.length) - Math.abs(b.length - customerParam.length)
          )[0];
          setFilterCustomer(best);
          setExpandedSale(best);
          setVoiceMatchFeedback(`Matched "${customerParam}" to "${best}"`);
        } else {
          const queryWords = query.split(/\s+/);
          const scored = customers.map(c => {
            const cWords = c.toLowerCase().split(/\s+/);
            const overlap = queryWords.filter(w => cWords.some(cw => cw.includes(w) || w.includes(cw))).length;
            return { name: c, score: overlap };
          }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

          if (scored.length > 0) {
            setFilterCustomer(scored[0].name);
            setExpandedSale(scored[0].name);
            setVoiceMatchFeedback(`Matched "${customerParam}" to "${scored[0].name}"`);
          } else {
            setVoiceMatchFeedback(`No customer found matching "${customerParam}"`);
          }
        }
      }
      setSearchParams({}, { replace: true });
    }

    const repParam = searchParams.get('rep');
    if (repParam && sales.length > 0) {
      const query = repParam.toLowerCase();
      const reps = [...new Set(sales.map(s => s.salesperson || '').filter(Boolean))];
      const match = reps.find(r => r.toLowerCase().includes(query) || query.includes(r.toLowerCase()));
      if (match) {
        setFilterSalesperson(match);
        setVoiceMatchFeedback(`Showing sales for rep: ${match}`);
      } else {
        const queryWords = query.split(/\s+/);
        const scored = reps.map(r => {
          const rWords = r.toLowerCase().split(/\s+/);
          const overlap = queryWords.filter(w => rWords.some(rw => rw.includes(w) || w.includes(rw))).length;
          return { name: r, score: overlap };
        }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
        if (scored.length > 0) {
          setFilterSalesperson(scored[0].name);
          setVoiceMatchFeedback(`Matched "${repParam}" to rep: ${scored[0].name}`);
        } else {
          setVoiceMatchFeedback(`No salesperson found matching "${repParam}"`);
        }
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, sales, setSearchParams]);

  const loadSales = async () => {
    try {
      const data = await api.get('/sales', { limit: '0' });
      setSales(data.sales);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadShopTargets = async () => {
    try {
      const data = await api.get('/sales/shop-targets');
      const m = new Map<string, { target: number; salesperson?: string; install?: string }>();
      (data.targets || []).forEach((t: any) => {
        if (t?.shop_name) m.set(t.shop_name.toLowerCase().trim(), {
          target: Number(t.target) || 0,
          salesperson: t.salesperson || undefined,
          install: t.install || undefined,
        });
      });
      setShopTargets(m);
    } catch (err) {
      console.error('shop targets load failed', err);
    }
  };

  const loadRevenueSummary = async (yr?: string) => {
    try {
      setRevError(false);
      const data = await api.get('/sales/revenue-summary', { year: yr || filterYear });
      if (data && data.company) {
        setRevSummary(data);
      }
    } catch (err) {
      console.error('revenue summary load failed', err);
      setRevError(true);
    }
  };

  // Load revenue summary on mount and when year filter changes
  useEffect(() => { loadRevenueSummary(filterYear); }, [filterYear]);

  // Build YTD breakdown for a customer's sales items
  const buildBreakdown = (items: any[]) => {
    const ytdYear = new Date().getFullYear();
    const ytd = items.filter(it => (it.sale_date || '').startsWith(String(ytdYear)));
    const ytdTotal = ytd.reduce((s, it) => s + (Number(it.sale_amount) || 0), 0);
    const byCl1: Record<string, number> = {};
    const byCl2: Record<string, number> = {};
    for (const it of ytd) {
      const cl1 = (it.category || '').trim() || 'Uncategorized';
      const cl2 = (it.product_line || '').trim() || 'Uncategorized';
      byCl1[cl1] = (byCl1[cl1] || 0) + (Number(it.sale_amount) || 0);
      byCl2[cl2] = (byCl2[cl2] || 0) + (Number(it.sale_amount) || 0);
    }
    const sortDesc = (m: Record<string, number>) =>
      Object.entries(m).sort((a, b) => b[1] - a[1]);
    return { ytdTotal, ytdYear, cl1: sortDesc(byCl1), cl2: sortDesc(byCl2) };
  };

  const findTarget = (name: string): { target: number; salesperson?: string; install?: string } | null => {
    if (!name) return null;
    const key = name.toLowerCase().trim();
    const exact = shopTargets.get(key);
    if (exact) return exact;
    for (const [k, v] of shopTargets) {
      if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
  };

  // Build unique filter options
  const allCustomers = [...new Set(sales.map(s => s.customer_name || s.shop_name || '').filter(Boolean))].sort();
  const allSalespersons = [...new Set(sales.map(s => s.salesperson || '').filter(Boolean))].sort();

  // Apply filters
  const filteredSales = sales.filter(s => {
    if (filterCustomer && (s.customer_name || s.shop_name || '') !== filterCustomer) return false;
    if (filterSalesperson && (s.salesperson || '') !== filterSalesperson) return false;
    if (filterYear !== 'all' && !(s.sale_date || '').startsWith(filterYear)) return false;
    return true;
  });

  // Group filtered sales by customer
  const groupedSales = filteredSales.reduce<Record<string, SalesData[]>>((acc, sale) => {
    const key = sale.customer_name || sale.shop_name || 'Unmatched';
    if (!acc[key]) acc[key] = [];
    acc[key].push(sale);
    return acc;
  }, {});

  const customerTotals = Object.entries(groupedSales).map(([name, items]) => ({
    name,
    total: items.reduce((s, i) => s + (i.sale_amount || 0), 0),
    totalProfit: items.reduce((s, i) => s + (i.profit || 0), 0),
    count: items.length,
    shop_name: items[0]?.shop_name || null,
    salesperson: items.find(i => i.salesperson)?.salesperson || '',
    dates: items.map(i => i.sale_date).filter(Boolean).sort(),
    items,
  })).sort((a, b) => b.total - a.total);

  const groupByInvoice = (items: SalesData[]) => {
    const byDate: Record<string, SalesData[]> = {};
    items.forEach(item => {
      const key = item.sale_date || 'unknown';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(item);
    });
    // Newest invoices first (sales team wants the most recent purchase at the top)
    return Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a));
  };

  const fmtDate = (d: string) => {
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return d; }
  };

  const fmtMoney = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const activeFilters = (filterCustomer ? 1 : 0) + (filterSalesperson ? 1 : 0) + (filterYear !== 'all' && filterYear !== String(new Date().getFullYear()) ? 1 : 0);
  const availableYears = [...new Set(sales.map(s => (s.sale_date || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));

  // Compute all unique PCR categories across entire sales dataset (for "not purchased" feature)
  const allCategories = [...new Set(sales.map(s => s.category).filter(Boolean))].sort();

  // Helper: get categories a customer IS buying
  const getCustomerCategories = (items: SalesData[]) =>
    new Set(items.map(s => s.category).filter(Boolean));

  // Helper: get categories a customer is NOT buying
  const getMissingCategories = (items: SalesData[]) => {
    const bought = getCustomerCategories(items);
    return allCategories.filter(c => !bought.has(c));
  };

  return (
    <div>
      {/* Date range banner */}
      {sales.length > 0 && (() => {
        const dates = filteredSales.map(s => s.sale_date).filter(Boolean).sort();
        if (dates.length === 0) return null;
        const first = new Date(dates[0] + 'T00:00:00');
        const last = new Date(dates[dates.length - 1] + 'T00:00:00');
        return (
          <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 sm:px-5 py-3 mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <div>
              <span className="text-sm text-brand-700 font-medium">Sales data: </span>
              <span className="text-sm text-brand-900 font-bold">
                {first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} &ndash; {last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <span className="text-xs text-brand-600">
              {filterYear === 'all' ? 'All years' : `Year: ${filterYear}`} &middot; {filteredSales.length.toLocaleString()} of {sales.length.toLocaleString()} records &middot; {allCustomers.length} customers
            </span>
          </div>
        );
      })()}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-900">Sales Tracking</h1>
          <p className="text-navy-500 text-xs sm:text-sm mt-1">Click any customer to see invoices.</p>
        </div>
      </div>

      {/* Filter Bar */}
      {sales.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
          <span className="text-xs font-medium text-navy-500 uppercase tracking-wide">Filter:</span>
          <select
            value={filterCustomer}
            onChange={e => { setFilterCustomer(e.target.value); setExpandedSale(null); }}
            className="input-field text-sm py-2"
          >
            <option value="">All Customers</option>
            {allCustomers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {allSalespersons.length > 0 && (
            <select
              value={filterSalesperson}
              onChange={e => { setFilterSalesperson(e.target.value); setExpandedSale(null); }}
              className="input-field text-sm py-2"
            >
              <option value="">All Salespersons</option>
              {allSalespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
            </select>
          )}
          {availableYears.length > 1 && (
            <select
              value={filterYear}
              onChange={e => { setFilterYear(e.target.value); setExpandedSale(null); }}
              className="input-field text-sm py-2"
              title="Filter by year"
            >
              <option value="all">All Years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {activeFilters > 0 && (
            <div className="flex items-center justify-between sm:justify-start gap-3">
              <button
                onClick={() => { setFilterCustomer(''); setFilterSalesperson(''); setFilterYear(String(new Date().getFullYear())); setExpandedSale(null); }}
                className="text-xs text-brand-600 hover:text-brand-800 underline"
              >
                Clear filters ({activeFilters})
              </button>
              <span className="text-xs text-navy-400">
                {filteredSales.length} of {sales.length} records
              </span>
            </div>
          )}
        </div>
      )}

      {/* Revenue Summary Bar */}
      {revSummary && (() => {
        const monthName = (() => {
          try {
            const [y, m] = revSummary.currentMonth.split('-');
            return new Date(Number(y), Number(m) - 1).toLocaleString('en-US', { month: 'long' });
          } catch { return revSummary.currentMonth; }
        })();
        const yr = revSummary.year;

        // If a salesperson is selected, show their numbers; otherwise show company totals
        const spData = filterSalesperson
          ? revSummary.salespersons.find(s => s.salesperson === filterSalesperson)
          : null;
        const showMonth = spData ? spData.month_revenue : revSummary.company.month_total;
        const showYtd = spData ? spData.ytd_revenue : revSummary.company.ytd_total;
        const label = filterSalesperson || 'All Salespersons';

        const isCurrentYear = yr === String(new Date().getFullYear());
        const fmtRev = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

        return (
          <div className="bg-green-50 border border-green-300 rounded-xl px-4 sm:px-5 py-3 mb-4 sm:mb-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
              <div className="text-sm font-bold text-green-900 min-w-0 truncate">{label}</div>
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                {isCurrentYear && filterYear !== 'all' && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg sm:text-xl font-bold text-green-800">{fmtRev(showMonth)}</span>
                    <span className="text-xs text-green-600 font-semibold">({monthName})</span>
                  </div>
                )}
                <div className="flex items-baseline gap-1.5">
                  <span className={`font-bold text-green-800 ${isCurrentYear && filterYear !== 'all' ? 'text-base' : 'text-lg sm:text-xl'}`}>
                    {fmtRev(showYtd)}
                  </span>
                  <span className="text-xs text-green-600 font-semibold">
                    ({filterYear === 'all' ? 'All Time' : `YTD ${yr}`})
                  </span>
                </div>
              </div>
            </div>
            {/* If no salesperson selected, show per-rep breakdown */}
            {!filterSalesperson && revSummary.salespersons.length > 0 && (
              <div className="mt-2 pt-2 border-t border-green-200 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                {revSummary.salespersons
                  .filter(s => (isCurrentYear && filterYear !== 'all') ? s.month_revenue > 0 : s.ytd_revenue > 0)
                  .map(s => (
                  <div key={s.salesperson} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-green-800 truncate font-medium">{s.salesperson}</span>
                    <span className="font-bold text-green-900 tabular-nums flex-shrink-0">
                      {isCurrentYear && filterYear !== 'all'
                        ? fmtRev(s.month_revenue)
                        : fmtRev(s.ytd_revenue)
                      }
                      <span className="text-green-500 font-normal ml-1">
                        ({isCurrentYear && filterYear !== 'all' ? monthName.slice(0, 3) : 'YTD'})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Voice match feedback */}
      {voiceMatchFeedback && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-4 flex items-center justify-between">
          <span className="text-sm text-blue-700">{voiceMatchFeedback}</span>
          <button onClick={() => setVoiceMatchFeedback('')} className="text-blue-400 hover:text-blue-600 text-xs ml-3">dismiss</button>
        </div>
      )}

      {/* Main Sales Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredSales.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-navy-500">{activeFilters > 0 ? 'No sales match the selected filters.' : 'No sales data yet.'}</p>
          <p className="text-sm text-navy-400 mt-2">
            {activeFilters > 0 ? 'Try adjusting or clearing your filters.' : 'Sales data syncs automatically from the CHC intranet.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile card view for customer list */}
          <div className="sm:hidden space-y-2">
            {customerTotals.map((ct) => {
              const isExpanded = expandedSale === ct.name;
              const hasDetailedItems = ct.items.some(s => s.item_name);
              const invoiceGroups = groupByInvoice(ct.items);
              const invoiceCount = invoiceGroups.length;
              return (
                <div key={ct.name} className="card !p-0 overflow-hidden">
                  {/* Customer header — tappable */}
                  <button
                    onClick={() => setExpandedSale(isExpanded ? null : ct.name)}
                    className="w-full text-left p-4 hover:bg-navy-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-navy-900 text-sm truncate">{ct.shop_name || ct.name}</div>
                        <div className="text-xs text-navy-400 mt-0.5">
                          {ct.salesperson || 'No rep'} &middot; {invoiceCount} inv &middot; {ct.count} items
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-bold text-green-600 text-sm">{fmtMoney(ct.total)}</div>
                        <div className={`text-xs ${ct.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          P: {fmtMoney(ct.totalProfit)}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-center mt-2">
                      <span className={`text-navy-400 text-xs transition-transform inline-block ${isExpanded ? 'rotate-180' : ''}`}>
                        &#9660;
                      </span>
                    </div>
                  </button>

                  {/* PCR Categories not being purchased - mobile */}
                  {(() => {
                    const missing = getMissingCategories(ct.items);
                    return missing.length > 0 && allCategories.length > 0 ? (
                      <div className="px-4 py-2 bg-red-50/60 border-t border-red-100">
                        <div className="text-xs font-bold text-red-600 uppercase tracking-wide mb-1">PCR Categories Not Being Purchased</div>
                        <div className="text-xs font-bold text-red-500 leading-relaxed">
                          {missing.join('  ·  ')}
                        </div>
                      </div>
                    ) : null;
                  })()}
                  {/* Expanded invoice detail */}
                  {isExpanded && (() => {
                    const bd = buildBreakdown(ct.items);
                    const tgtRow = findTarget(ct.shop_name || ct.name);
                    const annualTarget = tgtRow?.target || 0;
                    const pctGoal = annualTarget > 0 ? (bd.ytdTotal / annualTarget) * 100 : null;
                    return (
                    <div className="border-t border-navy-100 bg-navy-50">
                      {/* YTD breakdown banner */}
                      <div className="bg-white border-b border-navy-100 px-3 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-navy-500">YTD {bd.ytdYear}</span>
                          <span className="text-base font-bold text-green-700">{fmtMoney(bd.ytdTotal)}</span>
                          {annualTarget > 0 ? (
                            <>
                              <span className="text-xs text-navy-500">/ {fmtMoney(annualTarget)}</span>
                              <span className={`text-xs font-bold ${pctGoal! >= 100 ? 'text-green-600' : pctGoal! >= 75 ? 'text-amber-600' : 'text-red-600'}`}>
                                {pctGoal!.toFixed(1)}%
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-navy-400 italic">no target</span>
                          )}
                        </div>
                        {annualTarget > 0 && (
                          <div className="bg-navy-100 rounded-full h-1.5 overflow-hidden mb-2">
                            <div className={`h-full rounded-full ${pctGoal! >= 100 ? 'bg-green-500' : pctGoal! >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(pctGoal!, 100)}%` }} />
                          </div>
                        )}
                        {(bd.cl1.length > 0 || bd.cl2.length > 0) && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-wider text-navy-400 mb-1">Category</div>
                              {bd.cl1.slice(0, 6).map(([name, amt]) => (
                                <div key={name} className="flex justify-between text-[11px]">
                                  <span className="truncate pr-1 text-navy-700">{name}</span>
                                  <span className="font-mono tabular-nums text-navy-600">{fmtMoney(amt)}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-wider text-navy-400 mb-1">Product Line</div>
                              {bd.cl2.slice(0, 6).map(([name, amt]) => (
                                <div key={name} className="flex justify-between text-[11px]">
                                  <span className="truncate pr-1 text-navy-700">{name}</span>
                                  <span className="font-mono tabular-nums text-navy-600">{fmtMoney(amt)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {hasDetailedItems ? (
                        <div className="divide-y divide-navy-200">
                          {invoiceGroups.map(([date, items], gi) => {
                            const invTotal = items.reduce((s, i) => s + (i.sale_amount || 0), 0);
                            const invProfit = items.reduce((s, i) => s + (i.profit || 0), 0);
                            return (
                              <div key={gi} className="py-2">
                                <div className="px-4 py-1 flex items-center justify-between">
                                  <span className="text-xs font-bold text-navy-800">{fmtDate(date)}</span>
                                  <span className="text-xs text-green-600 font-medium">{fmtMoney(invTotal)}</span>
                                </div>
                                {items.map((sale, j) => (
                                  <div key={j} className="px-4 py-1.5 flex items-center justify-between text-xs">
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium text-navy-800 truncate">{sale.item_name || '-'}</div>
                                      <div className="text-navy-400">
                                        Qty: {sale.quantity || '-'}
                                        {sale.category ? ` · ${sale.category}` : ''}
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0 ml-3">
                                      <div className="text-green-600">{fmtMoney(sale.sale_amount || 0)}</div>
                                      <div className={`${(sale.profit || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        P: ${(sale.profit || 0).toFixed(2)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                          {/* Grand total */}
                          <div className="px-4 py-3 bg-navy-200/40 flex items-center justify-between">
                            <span className="text-xs font-bold text-navy-900">Customer Total</span>
                            <div className="text-right">
                              <span className="text-sm font-bold text-green-700">{fmtMoney(ct.total)}</span>
                              <span className={`text-xs ml-2 ${ct.totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                P: {fmtMoney(ct.totalProfit)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4">
                          {ct.items.map((sale, j) => (
                            <div key={j} className="flex justify-between text-xs py-1 border-b border-navy-100/50 last:border-0">
                              <span className="text-navy-600">{sale.sale_date}</span>
                              <span className="text-green-600">{fmtMoney(sale.sale_amount || 0)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between text-xs font-bold pt-2 mt-1 border-t border-navy-200">
                            <span>Total</span>
                            <span className="text-green-700">{fmtMoney(ct.total)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          {/* Desktop/tablet table view */}
          <div className="hidden sm:block card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase w-6"></th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Customer</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase">Total Revenue</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase hidden md:table-cell">Total Profit</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase">Invoices</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase hidden lg:table-cell">Rep</th>
                </tr>
              </thead>
              <tbody>
                {customerTotals.map((ct) => {
                  const isExpanded = expandedSale === ct.name;
                  const hasDetailedItems = ct.items.some(s => s.item_name);
                  const invoiceGroups = groupByInvoice(ct.items);
                  const invoiceCount = invoiceGroups.length;
                  return (
                    <>
                      <tr
                        key={ct.name}
                        onClick={() => setExpandedSale(isExpanded ? null : ct.name)}
                        className="border-b border-navy-50 cursor-pointer hover:bg-brand-50 transition-colors"
                      >
                        <td className="py-3 px-4 text-navy-400">
                          <span className={`inline-block transition-transform text-xs ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                        </td>
                        <td className="py-3 px-4 text-sm font-medium text-brand-700">
                          {ct.shop_name || ct.name}
                        </td>
                        <td className="py-3 px-4 text-sm text-right font-bold text-green-600">
                          {fmtMoney(ct.total)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-medium hidden md:table-cell ${ct.totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {fmtMoney(ct.totalProfit)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-navy-500">
                          {invoiceCount} inv ({ct.count} items)
                        </td>
                        <td className="py-3 px-4 text-sm text-navy-500 hidden lg:table-cell">
                          {ct.salesperson || '-'}
                        </td>
                      </tr>
                      {/* PCR Categories not being purchased */}
                      {(() => {
                        const missing = getMissingCategories(ct.items);
                        return missing.length > 0 && allCategories.length > 0 ? (
                          <tr key={`${ct.name}-missing-cats`}>
                            <td colSpan={6} className="px-4 pl-10 py-2 bg-red-50/60 border-b border-red-100">
                              <span className="text-xs font-bold text-red-600 uppercase tracking-wide mr-2">PCR Categories Not Being Purchased:</span>
                              <span className="text-xs font-bold text-red-500">
                                {missing.join('  ·  ')}
                              </span>
                            </td>
                          </tr>
                        ) : null;
                      })()}
                      {isExpanded && (() => {
                        const bd = buildBreakdown(ct.items);
                        const tgtRow = findTarget(ct.shop_name || ct.name);
                        const annualTarget = tgtRow?.target || 0;
                        const pctGoal = annualTarget > 0 ? (bd.ytdTotal / annualTarget) * 100 : null;
                        return (
                        <tr key={`${ct.name}-detail`}>
                          <td colSpan={6} className="p-0">
                            <div className="bg-navy-50 border-y border-navy-100">
                              {/* Top banner: YTD breakdown + % to goal */}
                              <div className="bg-white border-b border-navy-100 px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                    <span className="text-xs font-bold uppercase tracking-wide text-navy-500">YTD {bd.ytdYear}</span>
                                    <span className="text-lg font-bold text-green-700">{fmtMoney(bd.ytdTotal)}</span>
                                    {annualTarget > 0 && (
                                      <>
                                        <span className="text-xs text-navy-400">/</span>
                                        <span className="text-sm font-semibold text-navy-700">{fmtMoney(annualTarget)} goal</span>
                                        <span className={`text-sm font-bold ${pctGoal! >= 100 ? 'text-green-600' : pctGoal! >= 75 ? 'text-amber-600' : 'text-red-600'}`}>
                                          {pctGoal!.toFixed(1)}%
                                        </span>
                                      </>
                                    )}
                                    {!annualTarget && (
                                      <span className="text-xs text-navy-400 italic">no target set</span>
                                    )}
                                  </div>
                                  {annualTarget > 0 && (
                                    <div className="w-full sm:w-64 bg-navy-100 rounded-full h-2 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${pctGoal! >= 100 ? 'bg-green-500' : pctGoal! >= 75 ? 'bg-amber-500' : 'bg-red-500'}`}
                                        style={{ width: `${Math.min(pctGoal!, 100)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                                {(bd.cl1.length > 0 || bd.cl2.length > 0) && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {/* cl1: Product Category */}
                                    <div>
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1.5">Category</div>
                                      <div className="space-y-1">
                                        {bd.cl1.map(([name, amt]) => {
                                          const pct = bd.ytdTotal > 0 ? (amt / bd.ytdTotal) * 100 : 0;
                                          return (
                                            <div key={name} className="flex items-center gap-2 text-xs">
                                              <span className="flex-1 truncate text-navy-700">{name}</span>
                                              <span className="font-mono text-navy-600 tabular-nums">{fmtMoney(amt)}</span>
                                              <span className="font-mono text-navy-400 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                    {/* cl2: Product Line / Brand */}
                                    <div>
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1.5">Product Line</div>
                                      <div className="space-y-1">
                                        {bd.cl2.map(([name, amt]) => {
                                          const pct = bd.ytdTotal > 0 ? (amt / bd.ytdTotal) * 100 : 0;
                                          return (
                                            <div key={name} className="flex items-center gap-2 text-xs">
                                              <span className="flex-1 truncate text-navy-700">{name}</span>
                                              <span className="font-mono text-navy-600 tabular-nums">{fmtMoney(amt)}</span>
                                              <span className="font-mono text-navy-400 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                              {hasDetailedItems ? (
                                <div className="divide-y divide-navy-200">
                                  {invoiceGroups.map(([date, items], gi) => {
                                    const invTotal = items.reduce((s, i) => s + (i.sale_amount || 0), 0);
                                    const invProfit = items.reduce((s, i) => s + (i.profit || 0), 0);
                                    const invCogs = items.reduce((s, i) => s + (i.cogs || 0), 0);
                                    return (
                                      <div key={gi} className="py-2">
                                        <div className="flex items-center justify-between px-4 pl-10 py-1.5">
                                          <span className="text-xs font-bold text-navy-800">
                                            Invoice: {fmtDate(date)}
                                          </span>
                                          <span className="text-xs text-navy-500">
                                            {items.length} item{items.length !== 1 ? 's' : ''}
                                          </span>
                                        </div>
                                        <div className="overflow-x-auto">
                                          <table className="w-full text-xs min-w-[600px]">
                                            <thead>
                                              <tr className="text-navy-400">
                                                <th className="text-left py-1 px-4 pl-14">Item</th>
                                                <th className="text-right py-1 px-3">Qty</th>
                                                <th className="text-right py-1 px-3">Amount</th>
                                                <th className="text-right py-1 px-3">COGS</th>
                                                <th className="text-right py-1 px-3">Profit</th>
                                                <th className="text-left py-1 px-3">Category</th>
                                                <th className="text-left py-1 px-3">Product Line</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {items.map((sale, j) => (
                                                <tr key={j} className="border-t border-navy-100/30 hover:bg-white/50">
                                                  <td className="py-1.5 px-4 pl-14 font-medium text-navy-800">{sale.item_name || '-'}</td>
                                                  <td className="py-1.5 px-3 text-right text-navy-600">{sale.quantity || '-'}</td>
                                                  <td className="py-1.5 px-3 text-right text-green-600">${sale.sale_amount?.toFixed(2)}</td>
                                                  <td className="py-1.5 px-3 text-right text-navy-500">${(sale.cogs || 0).toFixed(2)}</td>
                                                  <td className={`py-1.5 px-3 text-right ${(sale.profit || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                    ${(sale.profit || 0).toFixed(2)}
                                                  </td>
                                                  <td className="py-1.5 px-3 text-navy-500">{sale.category || '-'}</td>
                                                  <td className="py-1.5 px-3 text-navy-500">{sale.product_line || '-'}</td>
                                                </tr>
                                              ))}
                                              <tr className="bg-navy-100/50 font-semibold">
                                                <td className="py-1.5 px-4 pl-14 text-navy-700">Invoice Total</td>
                                                <td className="py-1.5 px-3"></td>
                                                <td className="py-1.5 px-3 text-right text-green-700">${invTotal.toFixed(2)}</td>
                                                <td className="py-1.5 px-3 text-right text-navy-600">${invCogs.toFixed(2)}</td>
                                                <td className={`py-1.5 px-3 text-right ${invProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>${invProfit.toFixed(2)}</td>
                                                <td className="py-1.5 px-3" colSpan={2}></td>
                                              </tr>
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {/* Customer grand total */}
                                  <div className="bg-navy-200/40 px-4 pl-10 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1">
                                    <span className="text-sm font-bold text-navy-900">
                                      Total Sales &mdash; {ct.shop_name || ct.name}
                                    </span>
                                    <div className="flex flex-wrap gap-3 sm:gap-6 text-sm">
                                      <span className="font-bold text-green-700">Revenue: {fmtMoney(ct.total)}</span>
                                      <span className={`font-bold ${ct.totalProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                        Profit: {fmtMoney(ct.totalProfit)}
                                      </span>
                                      <span className="text-navy-600">{invoiceCount} inv &middot; {ct.count} items</span>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-navy-400">
                                        <th className="text-left py-1.5 px-4 pl-10">Date</th>
                                        <th className="text-right py-1.5 px-3">Amount</th>
                                        <th className="text-left py-1.5 px-3">Details</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {ct.items.map((sale, j) => (
                                        <tr key={j} className="border-t border-navy-100/50 hover:bg-white/50">
                                          <td className="py-1.5 px-4 pl-10 text-navy-600">{sale.sale_date}</td>
                                          <td className="py-1.5 px-3 text-right text-green-600">${sale.sale_amount?.toFixed(2)}</td>
                                          <td className="py-1.5 px-3 text-navy-600">{sale.memo || '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <div className="bg-navy-200/40 px-4 pl-10 py-3 flex items-center justify-between">
                                    <span className="text-sm font-bold text-navy-900">Total Sales</span>
                                    <span className="text-sm font-bold text-green-700">{fmtMoney(ct.total)}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })()}
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
