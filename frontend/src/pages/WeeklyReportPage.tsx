import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { User } from '../types';
import { Save, Send, CheckCircle, Clock, BarChart3, Users, Activity, CalendarDays, DollarSign, AlertTriangle, ChevronDown, ChevronUp, Eye } from 'lucide-react';

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

interface AdminSummaryRep {
  rep_id: number;
  first_name: string;
  last_name: string;
  weeks: { week_of: string; status: string; submitted_at: string | null }[];
}

const SURVEY_SECTIONS = [
  { key: 'sales_opportunities', label: 'Sales Opportunities', placeholder: 'What new sales opportunities did you identify this week? Any hot leads or near-closes?', icon: DollarSign, color: 'text-emerald-600' },
  { key: 'product_opportunities', label: 'Product Opportunities', placeholder: 'Any product requests, gaps, or cross-sell/upsell opportunities?', icon: BarChart3, color: 'text-blue-600' },
  { key: 'competitive_opportunities', label: 'Competitive Opportunities', placeholder: 'Any competitive intel? Competitor pricing, wins/losses, market shifts?', icon: Activity, color: 'text-purple-600' },
  { key: 'equipment_opportunities', label: 'Equipment Opportunities', placeholder: 'Any equipment needs, upgrades, or demo requests from customers?', icon: Users, color: 'text-orange-600' },
  { key: 'planned_follow_ups', label: 'Planned Follow-Ups for Next Week', placeholder: 'Which accounts are you planning to follow up with next week? Any scheduled meetings or calls?', icon: CalendarDays, color: 'text-cyan-600' },
  { key: 'mgmt_support_needed', label: 'Management Support Needed', placeholder: 'Do you need any help from management? Pricing approvals, escalations, customer issues?', icon: AlertTriangle, color: 'text-red-600' },
  { key: 'additional_info', label: 'Additional Info', placeholder: 'Anything else you\'d like to share about your week?', icon: Save, color: 'text-navy-600' },
] as const;

export default function WeeklyReportPage({ user }: { user: User }) {
  const isAdmin = user.role === 'admin' || user.role === 'manager';

  // Rep survey state
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [highlights, setHighlights] = useState<CrmHighlights | null>(null);
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
  const [adminTab, setAdminTab] = useState<'survey' | 'tracker'>('survey');
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
      setFormData({
        sales_opportunities: data.report.sales_opportunities || '',
        product_opportunities: data.report.product_opportunities || '',
        competitive_opportunities: data.report.competitive_opportunities || '',
        equipment_opportunities: data.report.equipment_opportunities || '',
        planned_follow_ups: data.report.planned_follow_ups || '',
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

  const weekOfDisplay = report ? new Date(report.week_of + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const isSubmitted = report?.status === 'submitted';

  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 5=Fri
  const isFriday = dayOfWeek === 5;
  const isPastDue = dayOfWeek === 6 || dayOfWeek === 0; // Sat/Sun

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
                onClick={() => setAdminTab('tracker')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${adminTab === 'tracker' ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500'}`}
              >
                Team Tracker
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
                      Week of {new Date(h.week_of + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
                Week of {new Date(viewingReport.week_of + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </h3>
              <button onClick={() => setViewingReport(null)} className="p-2 hover:bg-navy-100 rounded-xl">
                <span className="text-navy-500 text-lg">&times;</span>
              </button>
            </div>
            <ReportReadonly report={viewingReport} />
          </div>
        </div>
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
                {viewReport.first_name} {viewReport.last_name} — Week of {new Date(viewReport.week_of + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
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
                        Week of {new Date(r.week_of + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
