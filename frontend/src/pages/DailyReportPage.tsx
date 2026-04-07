import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, FileText, Clock, AlertCircle, Users } from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';

interface NoteRow {
  id: number;
  account_id: number;
  shop_name: string;
  content: string;
  created_at: string;
}

interface FollowUpRow {
  account_id: number;
  shop_name: string;
  follow_up_date: string;
  days_until?: number;
  days_overdue?: number;
}

interface DailyReportPayload {
  user_id: number;
  report_date: string;
  generated_at: string;
  notes_count: number;
  followups_due_today: number;
  followups_overdue: number;
  followups_upcoming_7d: number;
  unread_messages: number;
  notes: NoteRow[];
  followups_due_list: FollowUpRow[];
  followups_overdue_list: FollowUpRow[];
  followups_upcoming_list: FollowUpRow[];
}

interface PersonalResp { team: false; date: string; report: DailyReportPayload | null }
interface TeamRep {
  user_id: number;
  first_name: string;
  last_name: string;
  role: string;
  report: DailyReportPayload | null;
}
interface TeamResp {
  team: true;
  date: string;
  totals: { notes_count: number; followups_due_today: number; followups_overdue: number; followups_upcoming_7d: number };
  reports: TeamRep[];
}

function CountdownChip({ days, overdue }: { days?: number; overdue?: number }) {
  if (overdue !== undefined && overdue > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        {overdue}d overdue
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
        Due today
      </span>
    );
  }
  if (days !== undefined && days <= 2) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
        in {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
      in {days}d
    </span>
  );
}

function StatCard({ icon, label, value, color = 'navy' }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    navy: 'bg-navy-50 text-navy-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    green: 'bg-green-50 text-green-700',
  };
  return (
    <div className={`rounded-xl p-4 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <div className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

function ReportBody({ report }: { report: DailyReportPayload }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<FileText className="w-4 h-4" />} label="Notes Yesterday" value={report.notes_count} color="navy" />
        <StatCard icon={<Calendar className="w-4 h-4" />} label="Due Today" value={report.followups_due_today} color="amber" />
        <StatCard icon={<AlertCircle className="w-4 h-4" />} label="Overdue" value={report.followups_overdue} color="red" />
        <StatCard icon={<Clock className="w-4 h-4" />} label="Next 7 Days" value={report.followups_upcoming_7d} color="green" />
      </div>

      {report.followups_overdue_list.length > 0 && (
        <section>
          <h3 className="font-semibold text-red-700 mb-2 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" /> Overdue Follow-Ups
          </h3>
          <ul className="bg-white border border-red-100 rounded-lg divide-y divide-red-50">
            {report.followups_overdue_list.map(f => (
              <li key={f.account_id} className="p-3 flex items-center justify-between">
                <Link to={`/accounts/${f.account_id}`} className="text-sm font-medium text-navy-800 hover:text-brand-600">
                  {f.shop_name}
                </Link>
                <CountdownChip overdue={f.days_overdue} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.followups_due_list.length > 0 && (
        <section>
          <h3 className="font-semibold text-amber-800 mb-2">Due Today</h3>
          <ul className="bg-white border border-amber-100 rounded-lg divide-y divide-amber-50">
            {report.followups_due_list.map(f => (
              <li key={f.account_id} className="p-3 flex items-center justify-between">
                <Link to={`/accounts/${f.account_id}`} className="text-sm font-medium text-navy-800 hover:text-brand-600">
                  {f.shop_name}
                </Link>
                <CountdownChip days={0} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.followups_upcoming_list.length > 0 && (
        <section>
          <h3 className="font-semibold text-navy-700 mb-2">Upcoming (Next 7 Days)</h3>
          <ul className="bg-white border border-navy-100 rounded-lg divide-y divide-navy-50">
            {report.followups_upcoming_list.map(f => (
              <li key={f.account_id} className="p-3 flex items-center justify-between">
                <Link to={`/accounts/${f.account_id}`} className="text-sm font-medium text-navy-800 hover:text-brand-600">
                  {f.shop_name}
                </Link>
                <CountdownChip days={f.days_until} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.notes.length > 0 && (
        <section>
          <h3 className="font-semibold text-navy-700 mb-2">Yesterday's Notes ({report.notes_count})</h3>
          <ul className="bg-white border border-navy-100 rounded-lg divide-y divide-navy-50">
            {report.notes.map(n => (
              <li key={n.id} className="p-3">
                <Link to={`/accounts/${n.account_id}`} className="text-sm font-medium text-brand-600 hover:underline">
                  {n.shop_name}
                </Link>
                <div className="text-sm text-navy-700 mt-1 line-clamp-2">{n.content}</div>
                <div className="text-[11px] text-navy-400 mt-1">{new Date(n.created_at).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function DailyReportPage({ user }: { user: User }) {
  const [teamView, setTeamView] = useState(false);
  const [personal, setPersonal] = useState<DailyReportPayload | null>(null);
  const [team, setTeam] = useState<TeamResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isManager = user.role === 'admin' || user.role === 'manager';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (teamView && isManager) {
        const r = await api.get<TeamResp>('/daily-report', { team: 'true' });
        setTeam(r);
      } else {
        const r = await api.get<PersonalResp>('/daily-report');
        setPersonal(r.report);
      }
    } catch (e: any) {
      setError(e.error || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [teamView]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Daily Report</h1>
          <div className="text-sm text-navy-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        {isManager && (
          <div className="inline-flex bg-navy-100 rounded-lg p-1">
            <button
              onClick={() => setTeamView(false)}
              className={`px-3 py-1.5 text-sm font-medium rounded ${!teamView ? 'bg-white shadow text-navy-900' : 'text-navy-600'}`}
            >
              My Report
            </button>
            <button
              onClick={() => setTeamView(true)}
              className={`px-3 py-1.5 text-sm font-medium rounded flex items-center gap-1 ${teamView ? 'bg-white shadow text-navy-900' : 'text-navy-600'}`}
            >
              <Users className="w-3.5 h-3.5" /> Team
            </button>
          </div>
        )}
      </div>

      {loading && <div className="text-navy-400">Loading…</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{error}</div>}

      {!loading && !error && teamView && team && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<FileText className="w-4 h-4" />} label="Team Notes" value={team.totals.notes_count} color="navy" />
            <StatCard icon={<Calendar className="w-4 h-4" />} label="Due Today" value={team.totals.followups_due_today} color="amber" />
            <StatCard icon={<AlertCircle className="w-4 h-4" />} label="Overdue" value={team.totals.followups_overdue} color="red" />
            <StatCard icon={<Clock className="w-4 h-4" />} label="Next 7 Days" value={team.totals.followups_upcoming_7d} color="green" />
          </div>
          {team.reports.map(rep => (
            <details key={rep.user_id} className="bg-white border border-navy-100 rounded-xl">
              <summary className="cursor-pointer p-4 flex items-center justify-between hover:bg-navy-50">
                <div>
                  <span className="font-semibold text-navy-900">{rep.first_name} {rep.last_name}</span>
                  <span className="ml-2 text-xs uppercase text-navy-400">{rep.role}</span>
                </div>
                {rep.report && (
                  <div className="flex gap-3 text-xs text-navy-500">
                    <span>{rep.report.notes_count} notes</span>
                    <span className="text-amber-700">{rep.report.followups_due_today} due</span>
                    <span className="text-red-700">{rep.report.followups_overdue} overdue</span>
                  </div>
                )}
              </summary>
              {rep.report && <div className="p-4 border-t border-navy-100"><ReportBody report={rep.report} /></div>}
            </details>
          ))}
        </div>
      )}

      {!loading && !error && !teamView && personal && <ReportBody report={personal} />}
      {!loading && !error && !teamView && !personal && (
        <div className="bg-white border border-navy-100 rounded-xl p-8 text-center text-navy-400">
          No data yet — your first report will appear after your next activity.
        </div>
      )}
    </div>
  );
}
