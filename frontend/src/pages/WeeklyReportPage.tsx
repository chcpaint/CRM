import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { User } from '../types';
import { Save, Send, CheckCircle, Clock, BarChart3, Users, Activity, CalendarDays, DollarSign, AlertTriangle, ChevronDown, ChevronUp, Eye, TrendingUp, TrendingDown, ShieldAlert, Target, MessageSquare, RefreshCw } from 'lucide-react';

interface WeeklyReport {
  id: number;
  rep_id: number;
  week_of: string;
  status: string;
  submitted_at: string | null;
  stats_accounts_contacted: number;
  stats_new_accounts: number;
  stats_activities_logged: number;
  stats_follow_ups_due: number;
  stats_weekly_sales: number;
  stats_dormant_accounts: number;
  sales_opportunities: string;
  product_opportunities: string;
  competitive_opportunities: string;
  equipment_opportunities: string;
  planned_follow_ups: string;
  mgmt_support_needed: string;
  additional_info: string;
  created_at: string;
  updated_at: string;
  first_name?: string;
  last_name?: string;
}

interface CrmHighlights {
  accounts_touched: { shop_name: string; activity_count: number }[];
  upcoming_follow_ups: { shop_name: string; follow_up_date: string }[];
}

interface DataSummary {
  sales_mtd: number;
  sales_prior_month: number;
  current_month_name: string;
  prior_month_name: string;
  off_cadence: { customer_name: string; prev_period: number; last_order: string }[];
  pcr_gaps: { customer_name: string; total: number; missing: string[] }[];
}

interface ReportComment {
  id: number;
  report_id: number;
  author_id: number;
  content: string;
  created_at: string;
  first_name: string;
  last_name: string;
}

interface TeamReport extends WeeklyReport {
  comment_count: number;
  data_summary: DataSummary;
}

interface AdminSummaryRep {
  rep_id: number;
  first_name: string;
  last_name: string;
  weeks: { week_of: string; status: string; submitted_at: string | null }[];
}

// Helper: safely parse week_of dates (handles both "2026-07-27" and "2026-07-27T00:00:00.000Z")
const parseWeekDate = (wo: string, opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }) => {
  if (!wo) return '';
  const dateStr = wo.substring(0, 10); // always take YYYY-MM-DD
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', opts);
};

const SURVEY_SECTIONS = [
  { key: 'sales_opportunities', label: 'Sales Opportunities', placeholder: 'What new sales opportunities did you identify this week? Any hot leads or near-closes?', icon: DollarSign, color: 'text-emerald-600' },
  { key: 'product_opportunities', label: 'Product Opportunities', placeholder: 'Any product requests, gaps, or cross-sell/upsell opportunities?', icon: BarChart3, color: 'text-blue-600' },
  { key: 'competitive_opportunities', label: 'Competitive Opportunities', placeholder: 'Any competitive intel? Competitor pricing, wins/losses, market shifts?', icon: Activity, color: 'text-purple-600' },
  { key: 'equipment_opportunities', label: 'Equipment Opportunities', placeholder: 'Any equipment needs, upgrades, or demo requests from customers?', icon: Users, color: 'text-orange-600' },
  { key: 'planned_follow_ups', label: 'Planned Follow-Ups for Next Week', placeholder: 'Auto-populated from your CRM follow-ups, reminders, and scheduled activities. Edit or add more details.', icon: CalendarDays, color: 'text-cyan-600' },
  { key: 'mgmt_support_needed', label: 'Management Support Needed', placeholder: 'Do you need any help from management? Pricing approvals, escalations, customer issues?', icon: AlertTriangle, color: 'text-red-600' },
  { key: 'additional_info', label: 'Additional Info', placeholder: 'Anything else you\'d like to share about your week?', icon: Save, color: 'text-navy-600' },
] as const;

export default function WeeklyReportPage({ user }: { user: User }) {
  const isAdmin = user.role === 'admin' || user.role === 'manager';

  // Rep survey state
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [highlights, setHighlights] = useState<CrmHighlights | null>(null);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [showHighlights, setShowHighlights] = useState(false);

  // History state
  const [history, setHistory] = useState<WeeklyReport[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingReport, setViewingReport] = useState<WeeklyReport | null>(null);

  // Admin state
  const [adminTab, setAdminTab] = useState<'survey' | 'tracker' | 'team'>('survey');
  const [adminSummary, setAdminSummary] = useState<AdminSummaryRep[]>([]);
  const [adminMondays, setAdminMondays] = useState<string[]>([]);
  const [adminMonth, setAdminMonth] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminViewReport, setAdminViewReport] = useState<WeeklyReport | null>(null);

  // Admin: rep history
  const [repHistory, setAdminRepHistory] = useState<WeeklyReport[]>([]);
  const [adminRepId, setAdminRepId] = useState<number | null>(null);

  const loadCurrentReport = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/weekly-report/current');
      setReport(data.report);
      setHighlights(data.crm_highlights);
      setDataSummary(data.data_summary || null);
      // Auto-fill planned_follow_ups from CRM data if the rep hasn't written anything yet
      const savedFollowUps = data.report.planned_follow_ups || '';
      const followUpText = savedFollowUps.trim()
        ? savedFollowUps
        : (data.follow_up_suggestion || '');

      setFormData({
        sales_opportunities: data.report.sales_opportunities || '',
        product_opportunities: data.report.product_opportunities || '',
        competitive_opportunities: data.report.competitive_opportunities || '',
        equipment_opportunities: data.report.equipment_opportunities || '',
        planned_follow_ups: followUpText,
        mgmt_support_needed: data.report.mgmt_support_needed || '',
        additional_info: data.report.additional_info || '',
      });
    } catch (err) {
      console.error('Failed to load weekly report', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCurrentReport(); }, [loadCurrentReport]);

  const loadHistory = async () => {
    try {
      const data = await api.get('/weekly-report/history');
      setHistory(data.reports || []);
    } catch (err) { console.error(err); }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const data = await api.put('/weekly-report/save', formData);
      setReport(data.report);
      setSaveMsg('Draft saved!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!confirm('Submit your weekly report? This will email it to management and cannot be undone.')) return;
    setSubmitting(true);
    try {
      const data = await api.post('/weekly-report/submit', formData);
      setReport(data.report);
      setSaveMsg('Report submitted and emailed!');
    } catch (err: any) {
      setSaveMsg(err?.error || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  // Admin: load summary
  const loadAdminSummary = useCallback(async (month?: string) => {
    setAdminLoading(true);
    try {
      const params: Record<string, string> = {};
      if (month) params.month = month;
      const data = await api.get('/weekly-report/admin/summary', params);
      setAdminSummary(data.summary || []);
      setAdminMondays(data.mondays || []);
    } catch (err) { console.error(err); }
    finally { setAdminLoading(false); }
  }, []);

  useEffect(() => {
    if (isAdmin && adminTab === 'tracker') loadAdminSummary(adminMonth || undefined);
  }, [isAdmin, adminTab, adminMonth, loadAdminSummary]);

  // Admin: view a specific report
  const viewReport = async (id: number) => {
    try {
      const data = await api.get(`/weekly-report/${id}`);
      setAdminViewReport(data.report);
    } catch (err) { console.error(err); }
  };

  // Admin: view rep history
  const loadRepHistory = async (repId: number) => {
    try {
      const data = await api.get('/weekly-report/history', { rep_id: String(repId) });
      setAdminRepHistory(data.reports || []);
      setAdminRepId(repId);
    } catch (err) { console.error(err); }
  };

  const weekOfDisplay = report ? parseWeekDate(report.week_of) : '';
  const isSubmitted = report?.status === 'submitted';

  // Use Eastern Time for cutover logic (Saturday 5 PM ET = locked)
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = etNow.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const etHour = etNow.getHours();
  const isFriday = dayOfWeek === 5;
  const isPastDue = (dayOfWeek === 6 && etHour < 17); // Sat before 5PM — still this week, past due

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-900">Weekly Report</h1>
          <p className="text-sm text-navy-500 mt-0.5">
            Week of {weekOfDisplay}
            {isSubmitted && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 font-semibold">
                <CheckCircle className="w-4 h-4" /> Submitted
              </span>
            )}
            {!isSubmitted && isFriday && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600 font-semibold">
                <Clock className="w-4 h-4" /> Due Today
              </span>
            )}
            {!isSubmitted && isPastDue && (
              <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-semibold">
                <AlertTriangle className="w-4 h-4" /> Past Due
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="flex bg-navy-100 rounded-xl p-1">
              <button
                onClick={() => setAdminTab('survey')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${adminTab === 'survey' ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500'}`}
              >
                My Report
              </button>
              <button
                onClick={() => setAdminTab('team')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${adminTab === 'team' ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500'}`}
              >
                Team Reports
              </button>
              <button
                onClick={() => setAdminTab('tracker')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${adminTab === 'tracker' ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500'}`}
              >
                History
              </button>
            </div>
          )}
          <button
            onClick={() => { if (!showHistory) loadHistory(); setShowHistory(h => !h); }}
            className="px-3 py-1.5 text-sm font-medium text-navy-600 hover:bg-navy-50 rounded-xl transition-colors flex items-center gap-1"
          >
            <Clock className="w-4 h-4" />
            History
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* History drawer */}
      {showHistory && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-navy-100 p-4 shadow-card">
          <h3 className="text-sm font-bold text-navy-700 mb-3">Past Reports</h3>
          {history.length === 0 ? (
            <p className="text-sm text-navy-400">No past reports yet.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {history.map(h => (
                <button
                  key={h.id}
                  onClick={() => setViewingReport(h)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-navy-50 transition-colors text-left"
                >
                  <div>
                    <span className="text-sm font-medium text-navy-800">
                      Week of {parseWeekDate(h.week_of, { month: 'short', day: 'numeric' })}
                    </span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${h.status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {h.status}
                    </span>
                  </div>
                  <Eye className="w-4 h-4 text-navy-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Viewing a past report modal */}
      {viewingReport && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={() => setViewingReport(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-navy-900">
                Week of {parseWeekDate(viewingReport.week_of)}
              </h3>
              <button onClick={() => setViewingReport(null)} className="p-2 hover:bg-navy-100 rounded-xl">
                <span className="text-navy-500 text-lg">&times;</span>
              </button>
            </div>
            <ReportReadonly report={viewingReport} />
          </div>
        </div>
      )}

      {/* Team Reports — live view */}
      {isAdmin && adminTab === 'team' && (
        <TeamReports user={user} />
      )}

      {/* Admin Tracker */}
      {isAdmin && adminTab === 'tracker' && (
        <AdminTracker
          summary={adminSummary}
          mondays={adminMondays}
          month={adminMonth}
          setMonth={setAdminMonth}
          loading={adminLoading}
          onViewReport={viewReport}
          viewReport={adminViewReport}
          onCloseView={() => setAdminViewReport(null)}
          onViewRepHistory={loadRepHistory}
          repHistory={repHistory}
          repId={adminRepId}
          onCloseRepHistory={() => { setAdminRepId(null); setAdminRepHistory([]); }}
        />
      )}

      {/* Survey Form (reps + admin "My Report" tab) */}
      {(!isAdmin || adminTab === 'survey') && report && (
        <>
          {/* Data Snapshot */}
          {dataSummary && (
            <div className="bg-gradient-to-r from-navy-50 to-blue-50 rounded-2xl border border-navy-100 p-4 sm:p-5 shadow-card">
              <h3 className="text-xs font-bold text-navy-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5" /> Data Snapshot
              </h3>
              <div className="grid sm:grid-cols-3 gap-4">
                {/* Sales MTD vs Prior */}
                <div>
                  <div className="text-xs font-semibold text-navy-500 mb-1.5">Sales Comparison</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-navy-900">${Number(dataSummary.sales_mtd).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    <span className="text-xs text-navy-400">{dataSummary.current_month_name} MTD</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-sm text-navy-600">${Number(dataSummary.sales_prior_month).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    <span className="text-xs text-navy-400">{dataSummary.prior_month_name} Total</span>
                  </div>
                  {dataSummary.sales_prior_month > 0 && (
                    <div className={`flex items-center gap-1 mt-1 text-xs font-semibold ${dataSummary.sales_mtd >= dataSummary.sales_prior_month ? 'text-emerald-600' : 'text-red-500'}`}>
                      {dataSummary.sales_mtd >= dataSummary.sales_prior_month ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {dataSummary.sales_mtd >= dataSummary.sales_prior_month ? '+' : ''}{((dataSummary.sales_mtd - dataSummary.sales_prior_month) / dataSummary.sales_prior_month * 100).toFixed(0)}% vs {dataSummary.prior_month_name}
                    </div>
                  )}
                </div>

                {/* Off-Cadence */}
                <div>
                  <div className="text-xs font-semibold text-red-500 mb-1.5 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> Recently Off-Cadence
                  </div>
                  {dataSummary.off_cadence.length === 0 ? (
                    <p className="text-xs text-navy-400">All active customers on track</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dataSummary.off_cadence.map((c, i) => (
                        <div key={i}>
                          <div className="text-sm font-medium text-navy-800 truncate">{c.customer_name}</div>
                          <div className="text-xs text-navy-400">
                            ${Number(c.prev_period).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} prev 3mo · last {c.last_order}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* PCR Category Gaps */}
                <div>
                  <div className="text-xs font-semibold text-navy-500 mb-1.5">Category Gaps — Top Shops</div>
                  {dataSummary.pcr_gaps.length === 0 ? (
                    <p className="text-xs text-navy-400">No gaps detected</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dataSummary.pcr_gaps.slice(0, 3).map((s, i) => (
                        <div key={i}>
                          <div className="text-sm font-medium text-navy-800 truncate">
                            {s.customer_name} <span className="text-xs text-navy-400">(${Number(s.total).toLocaleString('en-US', { maximumFractionDigits: 0 })})</span>
                          </div>
                          <div className="text-xs text-red-500 truncate">
                            Not buying: {s.missing.slice(0, 3).join(', ')}{s.missing.length > 3 ? ` +${s.missing.length - 3}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* CRM Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Accounts Contacted" value={report.stats_accounts_contacted} icon={Users} color="bg-blue-50 text-blue-600" />
            <StatCard label="New Accounts" value={report.stats_new_accounts} icon={BarChart3} color="bg-emerald-50 text-emerald-600" />
            <StatCard label="Activities Logged" value={report.stats_activities_logged} icon={Activity} color="bg-purple-50 text-purple-600" />
            <StatCard label="Follow-Ups Next Week" value={report.stats_follow_ups_due} icon={CalendarDays} color="bg-cyan-50 text-cyan-600" />
            <StatCard label="Weekly Sales" value={`$${Number(report.stats_weekly_sales).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} icon={DollarSign} color="bg-amber-50 text-amber-600" />
            <StatCard label="Dormant (30+ days)" value={report.stats_dormant_accounts} icon={AlertTriangle} color="bg-red-50 text-red-600" />
          </div>

          {/* CRM Highlights toggle */}
          {highlights && (highlights.accounts_touched.length > 0 || highlights.upcoming_follow_ups.length > 0) && (
            <button
              onClick={() => setShowHighlights(h => !h)}
              className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              CRM Highlights
              {showHighlights ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}

          {showHighlights && highlights && (
            <div className="grid sm:grid-cols-2 gap-4">
              {highlights.accounts_touched.length > 0 && (
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-navy-100 p-4 shadow-card">
                  <h4 className="text-xs font-bold text-navy-500 uppercase tracking-wider mb-2">Accounts Touched This Week</h4>
                  <div className="space-y-1.5">
                    {highlights.accounts_touched.map((a, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-navy-700">{a.shop_name}</span>
                        <span className="text-navy-400 font-medium">{a.activity_count} activities</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {highlights.upcoming_follow_ups.length > 0 && (
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-navy-100 p-4 shadow-card">
                  <h4 className="text-xs font-bold text-navy-500 uppercase tracking-wider mb-2">Follow-Ups Planned Next Week</h4>
                  <div className="space-y-1.5">
                    {highlights.upcoming_follow_ups.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-navy-700">{f.shop_name}</span>
                        <span className="text-navy-400">{new Date(f.follow_up_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Survey Fields */}
          <div className="space-y-4">
            {SURVEY_SECTIONS.map(section => {
              const Icon = section.icon;
              return (
                <div key={section.key} className="bg-white/80 backdrop-blur-sm rounded-2xl border border-navy-100 p-4 sm:p-5 shadow-card">
                  <label className="flex items-center gap-2 text-sm font-bold text-navy-700 mb-2">
                    <Icon className={`w-4 h-4 ${section.color}`} />
                    {section.label}
                  </label>
                  <textarea
                    value={formData[section.key] || ''}
                    onChange={e => setFormData(prev => ({ ...prev, [section.key]: e.target.value }))}
                    placeholder={section.placeholder}
                    disabled={isSubmitted}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-navy-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 disabled:bg-navy-50 disabled:text-navy-500 resize-y transition-colors"
                  />
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          {!isSubmitted && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-navy-100 hover:bg-navy-200 text-navy-700 font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl shadow-lg shadow-brand-600/20 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
              {saveMsg && (
                <span className={`text-sm font-medium ${saveMsg.includes('Failed') ? 'text-red-600' : 'text-emerald-600'}`}>
                  {saveMsg}
                </span>
              )}
            </div>
          )}

          {isSubmitted && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Report Submitted</p>
                <p className="text-xs text-emerald-600">
                  Submitted {report.submitted_at ? new Date(report.submitted_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Stat Card ──
function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-navy-100 p-3 shadow-card">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-lg sm:text-xl font-bold text-navy-900">{value}</div>
      <div className="text-[11px] text-navy-500 font-medium leading-tight">{label}</div>
    </div>
  );
}

// ── Read-only report view ──
function ReportReadonly({ report }: { report: WeeklyReport }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-2 bg-navy-50 rounded-xl">
          <div className="text-lg font-bold text-navy-900">{report.stats_accounts_contacted}</div>
          <div className="text-[10px] text-navy-500">Contacted</div>
        </div>
        <div className="text-center p-2 bg-navy-50 rounded-xl">
          <div className="text-lg font-bold text-navy-900">{report.stats_activities_logged}</div>
          <div className="text-[10px] text-navy-500">Activities</div>
        </div>
        <div className="text-center p-2 bg-navy-50 rounded-xl">
          <div className="text-lg font-bold text-navy-900">${Number(report.stats_weekly_sales).toLocaleString('en-US', { minimumFractionDigits: 0 })}</div>
          <div className="text-[10px] text-navy-500">Sales</div>
        </div>
      </div>
      {SURVEY_SECTIONS.map(s => (
        <div key={s.key}>
          <h4 className="text-xs font-bold text-navy-500 uppercase tracking-wider mb-1">{s.label}</h4>
          <p className="text-sm text-navy-700 whitespace-pre-wrap">{(report as any)[s.key] || <span className="text-navy-300 italic">No response</span>}</p>
        </div>
      ))}
    </div>
  );
}

// ── Team Reports (live view with comments) ──
function TeamReports({ user }: { user: User }) {
  const [reports, setReports] = useState<TeamReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, ReportComment[]>>({});
  const [commentText, setCommentText] = useState<Record<number, string>>({});
  const [sendingComment, setSendingComment] = useState<number | null>(null);
  const [weekOf, setWeekOf] = useState('');
  const [populating, setPopulating] = useState(false);

  const loadTeamReports = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/weekly-report/team-current');
      setReports(data.reports || []);
      setWeekOf(data.week_of || '');
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTeamReports(); }, [loadTeamReports]);

  const loadComments = async (reportId: number) => {
    try {
      const data = await api.get(`/weekly-report/${reportId}/comments`);
      setComments(prev => ({ ...prev, [reportId]: data.comments || [] }));
    } catch (err) { console.error(err); }
  };

  const toggleExpand = (reportId: number) => {
    if (expandedId === reportId) {
      setExpandedId(null);
    } else {
      setExpandedId(reportId);
      if (!comments[reportId]) loadComments(reportId);
    }
  };

  const addComment = async (reportId: number) => {
    const text = (commentText[reportId] || '').trim();
    if (!text) return;
    setSendingComment(reportId);
    try {
      const data = await api.post(`/weekly-report/${reportId}/comments`, { content: text });
      setComments(prev => ({
        ...prev,
        [reportId]: [...(prev[reportId] || []), data.comment],
      }));
      setCommentText(prev => ({ ...prev, [reportId]: '' }));
      // Update comment count
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, comment_count: r.comment_count + 1 } : r));
    } catch (err) { console.error(err); }
    finally { setSendingComment(null); }
  };

  const handlePopulateAll = async () => {
    setPopulating(true);
    try {
      await api.post('/weekly-report/populate-all', {});
      await loadTeamReports();
    } catch (err) { console.error(err); }
    finally { setPopulating(false); }
  };

  const weekLabel = weekOf ? parseWeekDate(weekOf) : '';

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-3 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Only show reps (not admin/manager in the team view)
  const repReports = reports.filter(r => r.first_name && r.last_name);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-navy-700">Week of {weekLabel}</h3>
          <p className="text-xs text-navy-400 mt-0.5">{repReports.length} reports · Live data updates on each page load</p>
        </div>
        <button
          onClick={handlePopulateAll}
          disabled={populating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-navy-100 hover:bg-navy-200 text-navy-700 rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${populating ? 'animate-spin' : ''}`} />
          {populating ? 'Refreshing...' : 'Refresh All Stats'}
        </button>
      </div>

      {repReports.map(r => {
        const isExpanded = expandedId === r.id;
        const ds = r.data_summary;

        return (
          <div key={r.id} className="bg-white/80 backdrop-blur-sm rounded-2xl border border-navy-100 shadow-card overflow-hidden">
            {/* Header row — always visible */}
            <button
              onClick={() => toggleExpand(r.id)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-navy-50/30 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center text-brand-700 font-semibold text-sm">
                  {r.first_name?.[0]}{r.last_name?.[0]}
                </div>
                <div>
                  <div className="text-sm font-semibold text-navy-900">{r.first_name} {r.last_name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.status}
                    </span>
                    {ds && (
                      <span className="text-xs text-navy-400">
                        ${Number(ds.sales_mtd).toLocaleString('en-US', { maximumFractionDigits: 0 })} MTD
                      </span>
                    )}
                    {r.comment_count > 0 && (
                      <span className="flex items-center gap-0.5 text-xs text-brand-600">
                        <MessageSquare className="w-3 h-3" /> {r.comment_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-navy-400">Weekly Sales</div>
                  <div className="text-sm font-bold text-navy-900">${Number(r.stats_weekly_sales).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-navy-400" /> : <ChevronDown className="w-4 h-4 text-navy-400" />}
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-navy-100 px-4 py-4 space-y-4">
                {/* Data snapshot inline */}
                {ds && (
                  <div className="bg-gradient-to-r from-navy-50 to-blue-50 rounded-xl p-4">
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div>
                        <div className="text-xs font-semibold text-navy-500 mb-1">Sales Comparison</div>
                        <div className="text-lg font-bold text-navy-900">${Number(ds.sales_mtd).toLocaleString('en-US', { maximumFractionDigits: 0 })}<span className="text-xs text-navy-400 ml-1">{ds.current_month_name} MTD</span></div>
                        <div className="text-sm text-navy-600">${Number(ds.sales_prior_month).toLocaleString('en-US', { maximumFractionDigits: 0 })}<span className="text-xs text-navy-400 ml-1">{ds.prior_month_name} Total</span></div>
                        {ds.sales_prior_month > 0 && (
                          <div className={`flex items-center gap-1 mt-1 text-xs font-semibold ${ds.sales_mtd >= ds.sales_prior_month ? 'text-emerald-600' : 'text-red-500'}`}>
                            {ds.sales_mtd >= ds.sales_prior_month ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {ds.sales_mtd >= ds.sales_prior_month ? '+' : ''}{((ds.sales_mtd - ds.sales_prior_month) / ds.sales_prior_month * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-red-500 mb-1">Off-Cadence</div>
                        {ds.off_cadence.length === 0 ? (
                          <p className="text-xs text-navy-400">All on track</p>
                        ) : ds.off_cadence.map((c, i) => (
                          <div key={i} className="mb-1">
                            <div className="text-sm font-medium text-navy-800 truncate">{c.customer_name}</div>
                            <div className="text-xs text-navy-400">${Number(c.prev_period).toLocaleString()} prev 3mo</div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-navy-500 mb-1">Category Gaps</div>
                        {ds.pcr_gaps.length === 0 ? (
                          <p className="text-xs text-navy-400">No gaps</p>
                        ) : ds.pcr_gaps.slice(0, 2).map((s, i) => (
                          <div key={i} className="mb-1">
                            <div className="text-sm font-medium text-navy-800 truncate">{s.customer_name} <span className="text-xs text-navy-400">(${Number(s.total).toLocaleString('en-US', { maximumFractionDigits: 0 })})</span></div>
                            <div className="text-xs text-red-500 truncate">{s.missing.slice(0, 3).join(', ')}{s.missing.length > 3 ? ` +${s.missing.length - 3}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  <div className="text-center p-2 bg-navy-50 rounded-xl">
                    <div className="text-lg font-bold text-navy-900">{r.stats_accounts_contacted}</div>
                    <div className="text-[10px] text-navy-500">Contacted</div>
                  </div>
                  <div className="text-center p-2 bg-navy-50 rounded-xl">
                    <div className="text-lg font-bold text-navy-900">{r.stats_new_accounts}</div>
                    <div className="text-[10px] text-navy-500">New Accts</div>
                  </div>
                  <div className="text-center p-2 bg-navy-50 rounded-xl">
                    <div className="text-lg font-bold text-navy-900">{r.stats_activities_logged}</div>
                    <div className="text-[10px] text-navy-500">Activities</div>
                  </div>
                  <div className="text-center p-2 bg-navy-50 rounded-xl">
                    <div className="text-lg font-bold text-navy-900">{r.stats_follow_ups_due}</div>
                    <div className="text-[10px] text-navy-500">Follow-Ups</div>
                  </div>
                  <div className="text-center p-2 bg-navy-50 rounded-xl">
                    <div className="text-lg font-bold text-navy-900">${Number(r.stats_weekly_sales).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                    <div className="text-[10px] text-navy-500">Weekly Sales</div>
                  </div>
                  <div className="text-center p-2 bg-navy-50 rounded-xl">
                    <div className="text-lg font-bold text-navy-900">{r.stats_dormant_accounts}</div>
                    <div className="text-[10px] text-navy-500">Dormant</div>
                  </div>
                </div>

                {/* Survey responses */}
                <div className="space-y-3">
                  {SURVEY_SECTIONS.map(s => {
                    const val = (r as any)[s.key];
                    if (!val) return null;
                    const Icon = s.icon;
                    return (
                      <div key={s.key}>
                        <h4 className="text-xs font-bold text-navy-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                          <Icon className={`w-3 h-3 ${s.color}`} /> {s.label}
                        </h4>
                        <p className="text-sm text-navy-700 whitespace-pre-wrap bg-navy-50/50 rounded-xl px-3 py-2">{val}</p>
                      </div>
                    );
                  })}
                  {SURVEY_SECTIONS.every(s => !(r as any)[s.key]) && (
                    <p className="text-sm text-navy-400 italic">No commentary submitted yet</p>
                  )}
                </div>

                {/* Comments section */}
                <div className="border-t border-navy-100 pt-3">
                  <h4 className="text-xs font-bold text-navy-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Manager Comments
                  </h4>
                  <div className="space-y-2 mb-3">
                    {(comments[r.id] || []).map(c => (
                      <div key={c.id} className="bg-brand-50/50 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-brand-700">{c.first_name} {c.last_name}</span>
                          <span className="text-[10px] text-navy-400">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-sm text-navy-700">{c.content}</p>
                      </div>
                    ))}
                    {comments[r.id] && comments[r.id].length === 0 && (
                      <p className="text-xs text-navy-400">No comments yet</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={commentText[r.id] || ''}
                      onChange={e => setCommentText(prev => ({ ...prev, [r.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addComment(r.id); }}
                      placeholder="Add a comment..."
                      className="flex-1 text-sm border border-navy-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
                    />
                    <button
                      onClick={() => addComment(r.id)}
                      disabled={sendingComment === r.id || !(commentText[r.id] || '').trim()}
                      className="px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      {sendingComment === r.id ? '...' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Admin Tracker ──
function AdminTracker({
  summary, mondays, month, setMonth, loading, onViewReport, viewReport, onCloseView,
  onViewRepHistory, repHistory, repId, onCloseRepHistory,
}: {
  summary: AdminSummaryRep[];
  mondays: string[];
  month: string;
  setMonth: (m: string) => void;
  loading: boolean;
  onViewReport: (id: number) => void;
  viewReport: WeeklyReport | null;
  onCloseView: () => void;
  onViewRepHistory: (repId: number) => void;
  repHistory: WeeklyReport[];
  repId: number | null;
  onCloseRepHistory: () => void;
}) {
  // Generate month options (last 6 months)
  const monthOptions: { value: string; label: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    monthOptions.push({ value: val, label });
  }

  return (
    <div className="space-y-4">
      {/* Month filter */}
      <div className="flex items-center gap-3">
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="text-sm border border-navy-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          <option value="">Current Month</option>
          {monthOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-3 border-brand-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-navy-100 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-navy-200 bg-navy-50/50">
                  <th className="text-left px-4 py-3 font-bold text-navy-700 sticky left-0 bg-navy-50/50">Rep</th>
                  {mondays.map(m => (
                    <th key={m} className="text-center px-3 py-3 font-semibold text-navy-600 whitespace-nowrap">
                      {new Date(m + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.map(rep => (
                  <tr key={rep.rep_id} className="border-b border-navy-100 hover:bg-navy-50/30">
                    <td className="px-4 py-3 font-medium text-navy-800 sticky left-0 bg-white/80 whitespace-nowrap">
                      <button
                        onClick={() => onViewRepHistory(rep.rep_id)}
                        className="hover:text-brand-600 transition-colors"
                      >
                        {rep.first_name} {rep.last_name}
                      </button>
                    </td>
                    {rep.weeks.map((w, i) => (
                      <td key={i} className="text-center px-3 py-3">
                        {w.status === 'submitted' ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-600" title={`Submitted ${w.submitted_at ? new Date(w.submitted_at).toLocaleDateString() : ''}`}>
                            <CheckCircle className="w-4 h-4" />
                          </span>
                        ) : w.status === 'draft' ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-600" title="Draft saved">
                            <Clock className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-50 text-red-400" title="Missing">
                            &mdash;
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* View report modal */}
      {viewReport && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={onCloseView}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-navy-900">
                {viewReport.first_name} {viewReport.last_name} — Week of {parseWeekDate(viewReport.week_of, { month: 'long', day: 'numeric' })}
              </h3>
              <button onClick={onCloseView} className="p-2 hover:bg-navy-100 rounded-xl">
                <span className="text-navy-500 text-lg">&times;</span>
              </button>
            </div>
            <ReportReadonly report={viewReport} />
          </div>
        </div>
      )}

      {/* Rep history side panel */}
      {repId && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={onCloseRepHistory}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-navy-900">Report History</h3>
              <button onClick={onCloseRepHistory} className="p-2 hover:bg-navy-100 rounded-xl">
                <span className="text-navy-500 text-lg">&times;</span>
              </button>
            </div>
            {repHistory.length === 0 ? (
              <p className="text-sm text-navy-400">No reports found.</p>
            ) : (
              <div className="space-y-2">
                {repHistory.map(r => (
                  <button
                    key={r.id}
                    onClick={() => onViewReport(r.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-navy-50 text-left transition-colors"
                  >
                    <div>
                      <span className="text-sm font-medium text-navy-800">
                        Week of {parseWeekDate(r.week_of, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${r.status === 'submitted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.status}
                      </span>
                    </div>
                    <Eye className="w-4 h-4 text-navy-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
