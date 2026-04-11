import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { User } from '../../types';

interface FollowUp {
  id: number;
  shop_name: string;
  follow_up_date: string;
  note: string | null;
}

interface DigestNote {
  id: number;
  shop_name: string;
  author: string;
  created_at: string;
  content: string;
}

interface DormantAccount {
  id: number;
  shop_name: string;
  last_contacted_at: string | null;
}

interface DigestData {
  dueFollowUps: FollowUp[];
  upcomingFollowUps: FollowUp[];
  dormantAccounts: DormantAccount[];
  newNotes: DigestNote[];
}

interface TeamRepDigest {
  rep: { id: number; first_name: string; last_name: string };
  dueFollowUps: FollowUp[];
  upcomingFollowUps: FollowUp[];
  dormantCount: number;
  newNotesCount: number;
}

interface Props {
  user: User;
  alwaysShow?: boolean;
}

function cleanNote(note: string | null): string {
  if (!note) return '';
  return note.replace(/^\[Follow-up[^\]]*\]\s*/, '');
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function DailyDigest({ user, alwaysShow = false }: Props) {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [teamDigest, setTeamDigest] = useState<TeamRepDigest[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'my' | 'team'>('my');

  const isManager = user.role === 'admin' || user.role === 'manager';
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadDigest();
  }, []);

  const loadDigest = async () => {
    try {
      const [myDigest, teamData] = await Promise.all([
        api.get('/notifications/preview'),
        isManager ? api.get('/notifications/team-digest').catch(() => null) : Promise.resolve(null)
      ]);
      setDigest(myDigest.preview);
      if (teamData) setTeamDigest(teamData.teamDigest);
    } catch (err) {
      console.error('Failed to load digest:', err);
    } finally {
      setLoading(false);
    }
  };

  // Check session dismissal
  useEffect(() => {
    const key = `digest-dismissed-${new Date().toISOString().split('T')[0]}`;
    if (sessionStorage.getItem(key)) setDismissed(true);
  }, []);

  const handleDismiss = () => {
    const key = `digest-dismissed-${new Date().toISOString().split('T')[0]}`;
    sessionStorage.setItem(key, 'true');
    setDismissed(true);
  };

  if (loading) return null;
  if (dismissed && !alwaysShow) return (
    <button
      onClick={() => setDismissed(false)}
      className="mb-4 flex items-center gap-2 text-xs text-navy-400 hover:text-brand-600 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      Show Today's Report
    </button>
  );

  if (!digest) return null;

  const totalItems = digest.dueFollowUps.length + digest.upcomingFollowUps.length;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const handleExport = async (action: 'print' | 'email') => {
    setExporting(true);
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/notifications/export-report', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error('Export failed');
      const html = await resp.text();

      if (action === 'print') {
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(html);
          win.document.close();
          setTimeout(() => win.print(), 500);
        }
      } else {
        // Copy HTML to clipboard for email paste, or open mailto with summary
        const blob = new Blob([html], { type: 'text/html' });
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': blob })
          ]);
          alert('Report copied to clipboard — paste it into your email.');
        } catch {
          // Fallback: open in new tab
          const win = window.open('', '_blank');
          if (win) { win.document.write(html); win.document.close(); }
          alert('Report opened in new tab — use Ctrl/Cmd+A to select all, then paste into email.');
        }
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // Team totals for manager view
  const teamTotals = teamDigest ? {
    due: teamDigest.reduce((s, r) => s + r.dueFollowUps.length, 0),
    upcoming: teamDigest.reduce((s, r) => s + r.upcomingFollowUps.length, 0),
    dormant: teamDigest.reduce((s, r) => s + r.dormantCount, 0)
  } : null;

  return (
    <div className="card mb-6 !p-0 overflow-hidden border-l-4 border-l-brand-500">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-500/10 to-transparent px-4 sm:px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-navy-900 text-sm sm:text-base">Daily Report</h2>
            <p className="text-[10px] sm:text-xs text-navy-400">{today}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isManager && teamDigest && (
            <div className="flex bg-navy-100 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setViewMode('my')}
                className={`px-2.5 py-1 rounded-md transition-colors ${viewMode === 'my' ? 'bg-white text-navy-900 shadow-sm font-medium' : 'text-navy-500'}`}
              >
                My Report
              </button>
              <button
                onClick={() => setViewMode('team')}
                className={`px-2.5 py-1 rounded-md transition-colors ${viewMode === 'team' ? 'bg-white text-navy-900 shadow-sm font-medium' : 'text-navy-500'}`}
              >
                Team
              </button>
            </div>
          )}
          {isManager && (
            <div className="flex gap-1">
              <button
                onClick={() => handleExport('print')}
                disabled={exporting}
                className="text-navy-400 hover:text-brand-600 p-1.5 rounded transition-colors"
                title="Print report"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
              </button>
              <button
                onClick={() => handleExport('email')}
                disabled={exporting}
                className="text-navy-400 hover:text-brand-600 p-1.5 rounded transition-colors"
                title="Copy report for email"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          )}
          {!alwaysShow && (
            <button
              onClick={handleDismiss}
              className="text-navy-400 hover:text-navy-600 p-1 rounded transition-colors"
              title="Dismiss for today"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* My Report View */}
      {viewMode === 'my' && (
        <div className="px-4 sm:px-5 py-3 space-y-4">
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-red-50 rounded-lg py-2 px-1">
              <div className="text-lg sm:text-xl font-bold text-red-600">{digest.dueFollowUps.length}</div>
              <div className="text-[10px] sm:text-xs text-red-500">Due Today</div>
            </div>
            <div className="bg-blue-50 rounded-lg py-2 px-1">
              <div className="text-lg sm:text-xl font-bold text-blue-600">{digest.upcomingFollowUps.length}</div>
              <div className="text-[10px] sm:text-xs text-blue-500">This Week</div>
            </div>
            <div className="bg-amber-50 rounded-lg py-2 px-1">
              <div className="text-lg sm:text-xl font-bold text-amber-600">{digest.dormantAccounts.length}</div>
              <div className="text-[10px] sm:text-xs text-amber-500">Dormant</div>
            </div>
          </div>

          {/* Due today */}
          {digest.dueFollowUps.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">Due Today</h3>
              <div className="space-y-1.5">
                {digest.dueFollowUps.map(f => (
                  <Link key={f.id} to={`/accounts/${f.id}`} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-navy-50 transition-colors group">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                    <span className="text-sm text-navy-900 font-medium group-hover:text-brand-600 truncate">{f.shop_name}</span>
                    {cleanNote(f.note) && (
                      <span className="text-xs text-navy-400 truncate hidden sm:inline">— {cleanNote(f.note)}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming this week */}
          {digest.upcomingFollowUps.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-2">Upcoming This Week</h3>
              <div className="space-y-1.5">
                {digest.upcomingFollowUps.map(f => (
                  <Link key={f.id} to={`/accounts/${f.id}`} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-navy-50 transition-colors group">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                    <span className="text-sm text-navy-900 font-medium group-hover:text-brand-600 truncate">{f.shop_name}</span>
                    <span className="text-xs text-navy-400 flex-shrink-0">{formatDate(f.follow_up_date)}</span>
                    {cleanNote(f.note) && (
                      <span className="text-xs text-navy-400 truncate hidden sm:inline">— {cleanNote(f.note)}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* New notes from team */}
          {digest.newNotes.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-navy-500 uppercase tracking-wide mb-2">Team Notes (Last 24h)</h3>
              <div className="space-y-1.5">
                {digest.newNotes.map(n => (
                  <div key={n.id} className="text-xs text-navy-600 py-1 px-2">
                    <span className="font-medium">{n.author}</span> on <span className="font-medium">{n.shop_name}</span>: {n.content}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Nothing to show */}
          {totalItems === 0 && digest.dormantAccounts.length === 0 && digest.newNotes.length === 0 && (
            <p className="text-sm text-navy-400 text-center py-2">All clear — no follow-ups or alerts for today.</p>
          )}
        </div>
      )}

      {/* Team View (managers only) */}
      {viewMode === 'team' && teamDigest && (
        <div className="px-4 sm:px-5 py-3 space-y-4">
          {/* Team totals */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-red-50 rounded-lg py-2 px-1">
              <div className="text-lg sm:text-xl font-bold text-red-600">{teamTotals?.due}</div>
              <div className="text-[10px] sm:text-xs text-red-500">Team Due Today</div>
            </div>
            <div className="bg-blue-50 rounded-lg py-2 px-1">
              <div className="text-lg sm:text-xl font-bold text-blue-600">{teamTotals?.upcoming}</div>
              <div className="text-[10px] sm:text-xs text-blue-500">Team This Week</div>
            </div>
            <div className="bg-amber-50 rounded-lg py-2 px-1">
              <div className="text-lg sm:text-xl font-bold text-amber-600">{teamTotals?.dormant}</div>
              <div className="text-[10px] sm:text-xs text-amber-500">Team Dormant</div>
            </div>
          </div>

          {/* Per-rep breakdown */}
          {teamDigest.map(rd => {
            const repTotal = rd.dueFollowUps.length + rd.upcomingFollowUps.length;
            return (
              <div key={rd.rep.id} className="border border-navy-100 rounded-lg overflow-hidden">
                <div className="bg-navy-50 px-3 py-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-navy-900">{rd.rep.first_name} {rd.rep.last_name}</span>
                  <div className="flex items-center gap-3 text-xs text-navy-500">
                    {rd.dueFollowUps.length > 0 && <span className="text-red-600 font-medium">{rd.dueFollowUps.length} due</span>}
                    {rd.upcomingFollowUps.length > 0 && <span className="text-blue-600">{rd.upcomingFollowUps.length} upcoming</span>}
                    {rd.dormantCount > 0 && <span className="text-amber-600">{rd.dormantCount} dormant</span>}
                  </div>
                </div>
                {(rd.dueFollowUps.length > 0 || rd.upcomingFollowUps.length > 0) && (
                  <div className="px-3 py-2 space-y-1">
                    {rd.dueFollowUps.map(f => (
                      <Link key={f.id} to={`/accounts/${f.id}`} className="flex items-center gap-2 py-1 hover:bg-navy-50 rounded px-1 transition-colors group">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                        <span className="text-xs sm:text-sm text-navy-900 font-medium group-hover:text-brand-600 truncate">{f.shop_name}</span>
                        <span className="text-[10px] text-red-500 flex-shrink-0">today</span>
                        {cleanNote(f.note) && <span className="text-xs text-navy-400 truncate hidden sm:inline">— {cleanNote(f.note)}</span>}
                      </Link>
                    ))}
                    {rd.upcomingFollowUps.map(f => (
                      <Link key={f.id} to={`/accounts/${f.id}`} className="flex items-center gap-2 py-1 hover:bg-navy-50 rounded px-1 transition-colors group">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                        <span className="text-xs sm:text-sm text-navy-900 group-hover:text-brand-600 truncate">{f.shop_name}</span>
                        <span className="text-[10px] text-navy-400 flex-shrink-0">{formatDate(f.follow_up_date)}</span>
                        {cleanNote(f.note) && <span className="text-xs text-navy-400 truncate hidden sm:inline">— {cleanNote(f.note)}</span>}
                      </Link>
                    ))}
                  </div>
                )}
                {repTotal === 0 && (
                  <div className="px-3 py-2 text-xs text-navy-400">No follow-ups scheduled</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
