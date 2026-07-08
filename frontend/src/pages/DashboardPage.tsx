import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { User, DashboardMetrics, STATUS_LABELS, STATUS_COLORS } from '../types';
import DailyDigest from '../components/dashboard/DailyDigest';
import DailyQuote from '../components/dashboard/DailyQuote';
import MessagesForYouCard from '../components/notifications/MessagesForYouCard';

interface Props { user: User }

// Date-window preset options for the activity filters. 'priorWeek' = the most recent
// complete Monday–Sunday, useful for weekly recap. 'all' keeps the full fetched window.
type DateWindow = 'today' | 'last7' | 'priorWeek' | 'last30' | 'all';

const DATE_WINDOWS: { value: DateWindow; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'priorWeek', label: 'Prior week' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'all', label: 'All' },
];

function dateWindowRange(w: DateWindow): { start: number; end: number } {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  switch (w) {
    case 'today':
      return { start: today0.getTime(), end: now };
    case 'last7':
      return { start: now - 7 * day, end: now };
    case 'last30':
      return { start: now - 30 * day, end: now };
    case 'priorWeek': {
      // Find this week's Monday 00:00, then go back 7 days for prior Monday.
      const d = new Date(today0);
      const dow = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
      const daysSinceMonday = (dow + 6) % 7; // 0 if today is Monday
      d.setDate(d.getDate() - daysSinceMonday); // this Monday 00:00
      const thisMon = d.getTime();
      return { start: thisMon - 7 * day, end: thisMon - 1 };
    }
    case 'all':
    default:
      return { start: 0, end: Number.MAX_SAFE_INTEGER };
  }
}

interface SyncStatus {
  sync_type: string;
  status: string;
  last_run: string;
  records: number;
  error: string | null;
  consecutive_failures: number;
  last_success: string | null;
  hours_since_sync: number | null;
  stale: boolean;
}

interface SyncHealth {
  syncs: SyncStatus[];
  overall_healthy: boolean;
  branch_revenue: { last_synced: string; latest_month: string; months_covered: number };
  pcr_data: { last_synced: string; intranet_uploaded_at: string; uploaded_by: string };
}

export default function DashboardPage({ user }: Props) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncHealth, setSyncHealth] = useState<SyncHealth | null>(null);
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  // Track which salesperson groups are expanded in the Recent Activity card.
  // Collapsed by default — users click a rep's row to see their entries.
  const [expandedReps, setExpandedReps] = useState<Set<string>>(new Set());
  const [activityWindow, setActivityWindow] = useState<DateWindow>('last7');
  const toggleRep = (key: string) =>
    setExpandedReps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    loadMetrics();
    // Load sync health for admins/managers
    if (user.role === 'admin' || user.role === 'manager') {
      loadSyncHealth();
    }
  }, []);

  const loadMetrics = async () => {
    try {
      const data = await api.get('/sales/dashboard/metrics');
      setMetrics(data);
    } catch (err) {
      console.error('Failed to load metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSyncHealth = async () => {
    try {
      const data = await api.get('/sync/health');
      setSyncHealth(data);
    } catch (err) {
      // Non-critical — don't block dashboard
      console.error('Failed to load sync health:', err);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!metrics) return <div className="text-navy-500">Failed to load dashboard</div>;

  const currentYear = new Date().getFullYear().toString();
  // YTD = sum of months that fall in the current calendar year only (month format: "YYYY-MM")
  const ytdRevenue = metrics.monthlyRevenue
    .filter((m) => typeof m.month === 'string' && m.month.startsWith(currentYear))
    .reduce((sum, m) => sum + (m.total || 0), 0);
  // Find the actual current calendar month instead of blindly taking the last array element.
  // This prevents the dashboard from showing stale data when a new month starts.
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = metrics.monthlyRevenue.find((m) => m.month === currentMonthKey) || { month: currentMonthKey, total: 0, count: 0 };

  // Show ACTIVE accounts on the KPI card (previously showed every row including cold / DNC / churned,
  // which inflated the number past 1,800 and misrepresented the book of business).
  const activeAccounts =
    metrics.statusCounts.find((s) => s.status === 'active')?.count || 0;
  // Keep the all-accounts total for pipeline percentage math so the bars still add up to 100%.
  const pipelineTotal = metrics.totalAccounts;

  const fmtMoney = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-900">Dashboard</h1>
          <p className="text-navy-500 text-xs sm:text-sm mt-1">Welcome back, {user.first_name}</p>
        </div>
      </div>

      {/* Sync Health Alert — only visible to admin/manager when sync is unhealthy */}
      {syncHealth && !syncHealth.overall_healthy && (user.role === 'admin' || user.role === 'manager') && (
        <div className="mb-4 sm:mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-red-600 text-lg">&#9888;</span>
              <div>
                <h3 className="text-sm font-semibold text-red-800">Data Sync Issue Detected</h3>
                <p className="text-xs text-red-600 mt-0.5">
                  {syncHealth.syncs.filter(s => s.consecutive_failures >= 3).length > 0
                    ? `${syncHealth.syncs.filter(s => s.consecutive_failures >= 3).map(s => s.sync_type).join(', ')} — consecutive failures detected`
                    : syncHealth.syncs.filter(s => s.stale).length > 0
                    ? `${syncHealth.syncs.filter(s => s.stale).map(s => s.sync_type).join(', ')} — no sync in 24+ hours`
                    : 'One or more data syncs may not be running correctly.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSyncDetails(!showSyncDetails)}
              className="text-xs text-red-700 underline hover:text-red-900 flex-shrink-0"
            >
              {showSyncDetails ? 'Hide details' : 'Show details'}
            </button>
          </div>
          {showSyncDetails && (
            <div className="mt-3 space-y-2">
              {syncHealth.syncs.map(s => (
                <div key={s.sync_type} className={`flex items-center justify-between text-xs p-2 rounded ${
                  s.consecutive_failures >= 3 ? 'bg-red-100 text-red-800' :
                  s.stale ? 'bg-yellow-100 text-yellow-800' :
                  'bg-green-100 text-green-800'
                }`}>
                  <div>
                    <span className="font-medium">{s.sync_type}</span>
                    {s.error && <span className="ml-2 text-red-600">— {s.error.slice(0, 80)}</span>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    {s.last_run
                      ? `Last run: ${new Date(s.last_run).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                      : 'Never run'}
                    {s.consecutive_failures > 0 && ` (${s.consecutive_failures} failures)`}
                  </div>
                </div>
              ))}
              <div className="text-[10px] text-red-500 mt-1">
                Revenue data: last synced {syncHealth.branch_revenue?.last_synced
                  ? new Date(syncHealth.branch_revenue.last_synced).toLocaleString()
                  : 'never'}, latest month: {syncHealth.branch_revenue?.latest_month || 'N/A'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Daily motivational quote / fun fact */}
      <DailyQuote />

      {/* Daily Report — shows on open, dismissable */}
      <DailyDigest user={user} />

      {/* In-app messages inbox */}
      <div className="mb-4 sm:mb-6">
        <MessagesForYouCard />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8 stagger-children">
        <div className="card !p-4 sm:!p-6 group hover:scale-[1.02]">
          <div className="text-xs sm:text-sm text-navy-500 mb-1 font-medium">Active Accounts</div>
          <div className="text-xl sm:text-2xl font-bold text-navy-900">{activeAccounts}</div>
          <div className="text-[10px] sm:text-xs text-navy-400 mt-1">Status = Active</div>
        </div>
        <div className="card !p-4 sm:!p-6 group hover:scale-[1.02]">
          <div className="text-xs sm:text-sm text-navy-500 mb-1 font-medium">No Activity for 30 days</div>
          <div className="text-xl sm:text-2xl font-bold text-brand-600">{metrics.dormantCount}</div>
          <div className="text-[10px] sm:text-xs text-navy-400 mt-1">Active accounts with no note or activity in 30+ days</div>
        </div>
        <div className="card !p-4 sm:!p-6 group hover:scale-[1.02]">
          <div className="text-xs sm:text-sm text-navy-500 mb-1 font-medium">This Month</div>
          <div className="text-lg sm:text-2xl font-bold text-green-600">
            {fmtMoney(currentMonth?.total || 0)}
          </div>
        </div>
        <div className="card !p-4 sm:!p-6 group hover:scale-[1.02]">
          <div className="text-xs sm:text-sm text-navy-500 mb-1 font-medium">YTD Sales</div>
          <div className="text-lg sm:text-2xl font-bold text-navy-900">
            {fmtMoney(ytdRevenue)}
          </div>
          <div className="text-[10px] sm:text-xs text-navy-400 mt-1">Jan 1 {currentYear} – today</div>
        </div>
      </div>

      {/* Pipeline & Revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
        {/* Pipeline by status */}
        <div className="card">
          <h2 className="font-bold text-navy-900 mb-4 text-sm sm:text-base">Pipeline Overview</h2>
          <div className="space-y-3">
            {metrics.statusCounts.map((sc) => {
              const status = sc.status as keyof typeof STATUS_LABELS;
              const percentage = pipelineTotal > 0 ? (sc.count / pipelineTotal) * 100 : 0;
              return (
                <div key={sc.status}>
                  <div className="flex justify-between text-xs sm:text-sm mb-1">
                    <span className="text-navy-700">{STATUS_LABELS[status] || sc.status}</span>
                    <span className="font-medium text-navy-900">{sc.count}</span>
                  </div>
                  <div className="w-full h-2 sm:h-2.5 bg-navy-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        status === 'active' ? 'bg-green-500' :
                        status === 'prospect' ? 'bg-blue-500' :
                        status === 'cold' ? 'bg-gray-400' :
                        status === 'dnc' ? 'bg-red-400' : 'bg-yellow-400'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly Revenue Chart */}
        <div className="card">
          <h2 className="font-bold text-navy-900 mb-4 text-sm sm:text-base">Monthly Revenue</h2>
          {metrics.monthlyRevenue.length > 0 ? (
            <div className="space-y-2">
              {metrics.monthlyRevenue.map((m) => {
                const maxRevenue = Math.max(...metrics.monthlyRevenue.map(r => r.total || 0));
                const percentage = maxRevenue > 0 ? ((m.total || 0) / maxRevenue) * 100 : 0;
                return (
                  <div key={m.month} className="flex items-center gap-2 sm:gap-3">
                    <span className="text-[10px] sm:text-xs text-navy-500 w-12 sm:w-16 flex-shrink-0">{m.month}</span>
                    <div className="flex-1 h-5 sm:h-6 bg-navy-50 rounded overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded transition-all flex items-center justify-end pr-1 sm:pr-2"
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                      >
                        {percentage > 20 && (
                          <span className="text-[9px] sm:text-[10px] text-white font-medium">
                            ${(m.total || 0).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {percentage <= 20 && (
                      <span className="text-[10px] sm:text-xs text-navy-500 flex-shrink-0">${(m.total || 0).toLocaleString()}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-navy-400 text-sm py-8 text-center">No sales data yet. Import from AccountEdge to see revenue trends.</p>
          )}
        </div>
      </div>

      {/* Bottom row: Top Accounts & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Top Accounts */}
        <div className="card">
          <h2 className="font-bold text-navy-900 mb-4 text-sm sm:text-base">Top Accounts by Revenue</h2>
          {metrics.topAccounts.length > 0 ? (
            <div className="space-y-2 sm:space-y-3">
              {metrics.topAccounts.slice(0, 10).map((a, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-navy-50 last:border-0 gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-navy-900 text-xs sm:text-sm truncate">{a.shop_name}</div>
                    <div className="text-[10px] sm:text-xs text-navy-400">{a.salesperson || 'Unassigned'} — {a.sale_count} sales</div>
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-green-600 flex-shrink-0">
                    {fmtMoney(a.total_revenue)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-navy-400 text-sm py-8 text-center">No sales data yet.</p>
          )}
        </div>

        {/* Recent Activity — grouped by salesperson, date-windowed, collapsed by default */}
        <div className="card">
          <div className="flex items-baseline justify-between mb-2 gap-2">
            <h2 className="font-bold text-navy-900 text-sm sm:text-base">Recent Activity</h2>
            {metrics.recentActivities.length > 0 && (
              <span className="text-[10px] sm:text-xs text-navy-400">Click to see activity</span>
            )}
          </div>
          {/* Date window chips — filter both the grouping and the per-rep entries */}
          <div className="flex flex-wrap gap-1 mb-3" role="group" aria-label="Activity date window">
            {DATE_WINDOWS.map((w) => {
              const active = activityWindow === w.value;
              return (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => setActivityWindow(w.value)}
                  aria-pressed={active}
                  className={`text-[10px] sm:text-xs px-2 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white border-navy-200 text-navy-600 hover:bg-navy-50'
                  }`}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
          {metrics.recentActivities.length > 0 ? (
            <div className="divide-y divide-navy-50">
              {(() => {
                // Apply date window first, then group by salesperson.
                type Entry = any;
                const { start, end } = dateWindowRange(activityWindow);
                const inWindow = (metrics.recentActivities as Entry[]).filter((a) => {
                  const t = a.created_at ? new Date(a.created_at).getTime() : NaN;
                  return Number.isFinite(t) && t >= start && t <= end;
                });
                if (inWindow.length === 0) {
                  return (
                    <p className="text-navy-400 text-sm py-6 text-center">
                      No activity in this window. Try a longer range.
                    </p>
                  );
                }
                const groups = new Map<string, { label: string; entries: Entry[] }>();
                for (const a of inWindow) {
                  const fullName = `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'Unassigned';
                  const key = String(a.rep_id ?? fullName);
                  if (!groups.has(key)) groups.set(key, { label: fullName, entries: [] });
                  groups.get(key)!.entries.push(a);
                }
                // Sort groups by most recent entry first
                const sortedGroups = Array.from(groups.entries()).sort(
                  ([, aG], [, bG]) =>
                    new Date(bG.entries[0].created_at).getTime() -
                    new Date(aG.entries[0].created_at).getTime()
                );
                return sortedGroups.map(([key, { label, entries }]) => {
                  const isOpen = expandedReps.has(key);
                  const latest = entries[0];
                  return (
                    <div key={key} className="py-1">
                      <button
                        type="button"
                        onClick={() => toggleRep(key)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center gap-2 sm:gap-3 py-2 -mx-2 px-2 rounded hover:bg-navy-50 transition-colors text-left"
                      >
                        <span
                          className={`text-navy-400 text-xs transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`}
                          aria-hidden="true"
                        >
                          ▶
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-navy-900 text-xs sm:text-sm truncate">{label}</span>
                            <span className="text-[10px] sm:text-xs text-navy-400 flex-shrink-0">
                              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                            </span>
                          </div>
                          <div className="text-[10px] sm:text-xs text-navy-400 truncate">
                            Last: {new Date(latest.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {latest.shop_name}
                          </div>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="ml-5 sm:ml-6 pl-2 border-l border-navy-100 space-y-1 pb-2">
                          {entries.map((a: Entry) => {
                            const isNote = a.entry_type === 'note';
                            const icon = isNote ? '📝'
                              : a.activity_type === 'call' ? '📞'
                              : a.activity_type === 'email' ? '📧'
                              : a.activity_type === 'visit' || a.activity_type === 'drop_in' ? '🚗'
                              : a.activity_type === 'meeting' ? '🤝'
                              : a.activity_type === 'text' ? '💬'
                              : '📋';
                            const actionLabel = isNote ? 'note' : (a.activity_type || 'activity').replace(/_/g, ' ');
                            const snippet = a.description
                              ? a.description.length > 80 ? a.description.slice(0, 80) + '…' : a.description
                              : null;
                            return (
                              <Link
                                key={`${a.entry_type ?? 'activity'}-${a.id}`}
                                to={`/accounts/${a.account_id}`}
                                className="flex items-start gap-2 py-1.5 px-2 -mx-2 rounded hover:bg-navy-50 transition-colors"
                              >
                                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-navy-100 flex items-center justify-center text-xs flex-shrink-0">
                                  {icon}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs sm:text-sm text-navy-900">
                                    <span className="font-medium">{actionLabel}</span> on <span className="font-medium">{a.shop_name}</span>
                                  </div>
                                  {snippet && (
                                    <div className="text-[10px] sm:text-xs text-navy-500 mt-0.5 truncate">{snippet}</div>
                                  )}
                                  <div className="text-[10px] sm:text-xs text-navy-400 mt-0.5">
                                    {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </div>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <p className="text-navy-400 text-sm py-8 text-center">No recent activity. Start logging calls and visits!</p>
          )}
        </div>
      </div>
    </div>
  );
}
