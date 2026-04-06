import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { User } from '../types';

interface Props { user: User }

interface NotificationSettings {
  phone: string | null;
  notification_email: string | null;
  sms_enabled: boolean;
  email_enabled: boolean;
  daily_digest_time: string;
}

interface DigestPreview {
  dueFollowUps: { id: number; shop_name: string; follow_up_date: string }[];
  dormantAccounts: { id: number; shop_name: string; last_contacted_at: string | null }[];
  newNotes: { id: number; shop_name: string; author: string; created_at: string; content: string }[];
}

interface ManagedUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export default function AdminPage({ user }: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'notifications' | 'data' | 'duplicates' | 'audit'>('users');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', first_name: '', last_name: '', role: 'rep' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // User management state
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Notification state
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>({ phone: null, notification_email: null, sms_enabled: false, email_enabled: true, daily_digest_time: '07:30' });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSuccess, setNotifSuccess] = useState('');
  const [digestPreview, setDigestPreview] = useState<DigestPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);

  // Data management state
  const [clearingData, setClearingData] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dataMessage, setDataMessage] = useState('');

  // Customer seed state
  const [seedRunning, setSeedRunning] = useState(false);
  const [seedResult, setSeedResult] = useState<string>('');

  // Auto-assign reps state
  const [autoAssignRunning, setAutoAssignRunning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<any>(null);

  // Create salespeople state
  const [createSpRunning, setCreateSpRunning] = useState(false);
  const [createSpResult, setCreateSpResult] = useState<any>(null);

  // Duplicate management state
  interface DuplicateFlag {
    id: number; similarity_score: number; status: string; created_at: string;
    lead_id: number; lead_name: string; lead_city: string | null; lead_phone: string | null; lead_email: string | null; lead_contacts: string | null; lead_note_count: number;
    active_id: number; active_name: string; active_city: string | null; active_phone: string | null; active_email: string | null; active_contacts: string | null; active_pcr_managed: boolean; active_branch: string | null; active_note_count: number;
  }
  const [duplicates, setDuplicates] = useState<DuplicateFlag[]>([]);
  const [dupeScanning, setDupeScanning] = useState(false);
  const [dupeScanResult, setDupeScanResult] = useState('');
  const [dupeLoading, setDupeLoading] = useState(false);
  const [dupeActionLoading, setDupeActionLoading] = useState<number | null>(null);
  const [dupeThreshold, setDupeThreshold] = useState('0.95');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadDuplicates = async () => {
    setDupeLoading(true);
    try {
      const data = await api.get('/admin/duplicates');
      setDuplicates(data.duplicates || []);
    } catch (err) { console.error(err); }
    finally { setDupeLoading(false); }
  };

  const scanDuplicates = async () => {
    setDupeScanning(true);
    setDupeScanResult('');
    try {
      const data = await api.post('/admin/scan-duplicates', { threshold: parseFloat(dupeThreshold) });
      setDupeScanResult(`Scan complete: found ${data.count} duplicate(s) across ${data.leadsScanned} leads and ${data.activesScanned} active customers.`);
      await loadDuplicates();
    } catch (err: any) {
      setDupeScanResult(`Error: ${err.error || err.message || 'Scan failed'}`);
    } finally { setDupeScanning(false); }
  };

  const deleteLead = async (flagId: number) => {
    setDupeActionLoading(flagId);
    try {
      const data = await api.post(`/admin/duplicates/${flagId}/delete-lead`);
      showSuccess(data.message || 'Lead deleted and notes transferred.');
      setConfirmDeleteId(null);
      await loadDuplicates();
    } catch (err: any) {
      showError(err.error || 'Delete failed');
    } finally { setDupeActionLoading(null); }
  };

  const dismissDuplicate = async (flagId: number) => {
    setDupeActionLoading(flagId);
    try {
      await api.post(`/admin/duplicates/${flagId}/dismiss`);
      await loadDuplicates();
    } catch (err: any) {
      showError(err.error || 'Dismiss failed');
    } finally { setDupeActionLoading(null); }
  };

  // Google Drive auto-import state
  interface GDriveStatus { configured: boolean; lastRun: any; cronSchedule: string; folderId: string | null }
  interface ImportLogEntry { id: number; status: string; files_processed: number; records_imported: number; unmatched_count: number; details: any; error_message: string | null; triggered_by: string; created_at: string }
  const [gdriveStatus, setGdriveStatus] = useState<GDriveStatus | null>(null);
  const [importHistory, setImportHistory] = useState<ImportLogEntry[]>([]);
  const [importRunning, setImportRunning] = useState(false);
  const [importResult, setImportResult] = useState<string>('');
  const [pcrRefreshRunning, setPcrRefreshRunning] = useState(false);
  const [pcrRefreshResult, setPcrRefreshResult] = useState<string>('');

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      const data = await api.get('/auth/users');
      setUsers(data.users);
    } catch (err) { console.error(err); }
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 4000);
  };

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(''), 5000);
  };

  const loadNotificationSettings = async () => {
    try {
      const data = await api.get('/notifications/settings');
      if (data.settings) setNotifSettings(data.settings);
    } catch (err) { console.error(err); }
  };

  const saveNotificationSettings = async () => {
    setNotifSaving(true);
    setNotifSuccess('');
    try {
      await api.put('/notifications/settings', notifSettings);
      setNotifSuccess('Settings saved!');
      setTimeout(() => setNotifSuccess(''), 3000);
    } catch (err: any) {
      showError(err.error || 'Failed to save');
    } finally {
      setNotifSaving(false);
    }
  };

  const loadDigestPreview = async () => {
    setLoadingPreview(true);
    try {
      const data = await api.get('/notifications/preview');
      setDigestPreview(data.preview);
    } catch (err) { console.error(err); }
    finally { setLoadingPreview(false); }
  };

  const sendDigestNow = async () => {
    setSendingDigest(true);
    try {
      const data = await api.post('/notifications/send-digest', {});
      setNotifSuccess(`Digest sent! ${data.results?.length || 0} notifications processed.`);
      setTimeout(() => setNotifSuccess(''), 5000);
    } catch (err: any) {
      showError(err.error || 'Failed to send digest');
    } finally {
      setSendingDigest(false);
    }
  };

  const clearAllSalesData = async () => {
    setClearingData(true);
    setDataMessage('');
    try {
      const data = await api.delete('/sales/all');
      setDataMessage(`Successfully deleted ${data.deleted} sales records.`);
      setConfirmClear(false);
      setTimeout(() => setDataMessage(''), 5000);
    } catch (err: any) {
      showError(err.error || 'Failed to clear sales data');
    } finally {
      setClearingData(false);
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/register', newUser);
      setShowAddUser(false);
      setShowCreatePassword(false);
      setNewUser({ email: '', password: '', first_name: '', last_name: '', role: 'rep' });
      showSuccess('User created successfully');
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to create user');
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !newPassword) return;
    setActionLoading(resetPasswordUser.id);
    try {
      const data = await api.put(`/auth/users/${resetPasswordUser.id}/reset-password`, { password: newPassword });
      showSuccess(data.message);
      setResetPasswordUser(null);
      setNewPassword('');
      setShowResetPassword(false);
    } catch (err: any) {
      showError(err.error || 'Failed to reset password');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleActive = async (u: ManagedUser) => {
    setActionLoading(u.id);
    try {
      const data = await api.put(`/auth/users/${u.id}/toggle-active`, {});
      showSuccess(data.message);
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to update user status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleChange = async (u: ManagedUser, newRole: string) => {
    setActionLoading(u.id);
    try {
      const data = await api.put(`/auth/users/${u.id}/role`, { role: newRole });
      showSuccess(data.message);
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to change role');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setActionLoading(editingUser.id);
    try {
      await api.put(`/auth/users/${editingUser.id}`, {
        first_name: editingUser.first_name,
        last_name: editingUser.last_name,
        email: editingUser.email,
      });
      showSuccess(`Updated ${editingUser.first_name} ${editingUser.last_name}`);
      setEditingUser(null);
      loadUsers();
    } catch (err: any) {
      showError(err.error || 'Failed to update user');
    } finally {
      setActionLoading(null);
    }
  };

  const loadGDriveStatus = async () => {
    try {
      const data = await api.get('/gdrive-import/status');
      setGdriveStatus(data);
    } catch (err) { console.error(err); }
  };

  const loadImportHistory = async () => {
    try {
      const data = await api.get('/gdrive-import/history');
      setImportHistory(data.history || []);
    } catch (err) { console.error(err); }
  };

  const runImportNow = async () => {
    setImportRunning(true);
    setImportResult('');
    try {
      const data = await api.post('/gdrive-import/run', {});
      if (data.success) {
        setImportResult(`Imported ${data.totalImported} records from ${data.filesProcessed} file(s)${data.totalUnmatched ? ` (${data.totalUnmatched} unmatched)` : ''}`);
        showSuccess('Google Drive import completed successfully');
      } else {
        setImportResult(`Import failed: ${data.error}`);
        showError(data.error || 'Import failed');
      }
      loadGDriveStatus();
      loadImportHistory();
    } catch (err: any) {
      showError(err.error || 'Failed to run import');
      setImportResult(`Error: ${err.error || err.message}`);
    } finally {
      setImportRunning(false);
    }
  };

  const refreshSalesFromPcr = async () => {
    setPcrRefreshRunning(true);
    setPcrRefreshResult('');
    try {
      const data = await api.post('/admin/refresh-sales-from-pcr', {});
      if (data.success) {
        const s = data.stats || {};
        setPcrRefreshResult(`Refreshed ${data.inserted ?? s.total ?? '?'} rows. Range: ${s.min_date} → ${s.max_date}`);
        showSuccess('Sales data refreshed from PCR');
      } else {
        setPcrRefreshResult(`Failed: ${data.error}`);
        showError(data.error || 'Refresh failed');
      }
    } catch (err: any) {
      setPcrRefreshResult(`Error: ${err.error || err.message}`);
      showError(err.error || 'Failed to refresh');
    } finally {
      setPcrRefreshRunning(false);
    }
  };

  const isAdmin = user.role === 'admin';
  const isManagerOrAdmin = user.role === 'admin' || user.role === 'manager';

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-navy-900 mb-4 sm:mb-6">Admin Panel</h1>

      {/* Global success/error banners */}
      {success && (
        <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200 flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600 text-xs ml-3">dismiss</button>
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4 border border-red-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 text-xs ml-3">dismiss</button>
        </div>
      )}

      {/* Tabs — scrollable on mobile */}
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 mb-4 sm:mb-6">
        <div className="flex gap-1 bg-navy-100 rounded-lg p-1 w-fit min-w-max">
          {[
            { key: 'users', label: 'Users', labelFull: 'User Management' },
            { key: 'notifications', label: 'Alerts', labelFull: 'Notifications' },
            ...(isAdmin ? [{ key: 'duplicates', label: 'Dupes', labelFull: 'Duplicate Cleanup' }] : []),
            ...(isAdmin ? [{ key: 'data', label: 'Data', labelFull: 'Data Management' }] : []),
            { key: 'audit', label: 'Audit', labelFull: 'Audit Log' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key as any);
                if (tab.key === 'notifications') loadNotificationSettings();
                if (tab.key === 'duplicates') loadDuplicates();
                if (tab.key === 'data') { loadGDriveStatus(); loadImportHistory(); }
              }}
              className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500 hover:text-navy-700'
              }`}
            >
              <span className="sm:hidden">{tab.label}</span>
              <span className="hidden sm:inline">{tab.labelFull}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ═══ USERS TAB ═══ */}
      {activeTab === 'users' && (
        <div>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
            <div>
              <h2 className="font-bold text-navy-900">Team Members</h2>
              <p className="text-xs text-navy-400 mt-0.5">
                {isManagerOrAdmin ? 'Manage users, reset passwords, and control access.' : 'View your team members.'}
              </p>
            </div>
            {isManagerOrAdmin && (
              <button onClick={() => setShowAddUser(true)} className="btn-primary text-sm">+ Add User</button>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Role</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase hidden lg:table-cell">Last Login</th>
                  {isManagerOrAdmin && (
                    <th className="text-right py-3 px-4 text-xs font-medium text-navy-500 uppercase">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className={`border-b border-navy-50 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="py-3 px-4 font-medium text-navy-900">
                      {u.first_name} {u.last_name}
                      {u.id === user.id && <span className="text-xs text-brand-500 ml-1">(you)</span>}
                    </td>
                    <td className="py-3 px-4 text-sm text-navy-600">{u.email}</td>
                    <td className="py-3 px-4">
                      {isAdmin && u.id !== user.id ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value)}
                          disabled={actionLoading === u.id}
                          className="text-xs font-medium rounded-full px-2.5 py-1 border border-navy-200 bg-white cursor-pointer"
                        >
                          <option value="rep">Rep</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className={`badge ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : u.role === 'manager' ? 'bg-blue-100 text-blue-800' : 'bg-navy-100 text-navy-700'}`}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${u.is_active ? 'badge-active' : 'bg-red-100 text-red-800'}`}>
                        {u.is_active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-navy-500 hidden lg:table-cell">
                      {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    {isManagerOrAdmin && (
                      <td className="py-3 px-4 text-right">
                        {u.id !== user.id && (
                          <div className="flex items-center justify-end gap-1">
                            {isAdmin && (
                              <button
                                onClick={() => setEditingUser({ ...u })}
                                className="text-xs text-navy-500 hover:text-navy-700 px-2 py-1 rounded hover:bg-navy-50"
                                title="Edit user details"
                              >
                                Edit
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                onClick={() => { setResetPasswordUser(u); setNewPassword(''); }}
                                className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1 rounded hover:bg-brand-50"
                                title="Reset password"
                              >
                                Reset PW
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                onClick={() => handleToggleActive(u)}
                                disabled={actionLoading === u.id}
                                className={`text-xs px-2 py-1 rounded ${
                                  u.is_active
                                    ? 'text-red-600 hover:text-red-800 hover:bg-red-50'
                                    : 'text-green-600 hover:text-green-800 hover:bg-green-50'
                                }`}
                                title={u.is_active ? 'Revoke access' : 'Restore access'}
                              >
                                {actionLoading === u.id ? '...' : u.is_active ? 'Revoke' : 'Restore'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="sm:hidden space-y-2">
            {users.map(u => (
              <div key={u.id} className={`card !p-4 ${!u.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-navy-900 text-sm">
                      {u.first_name} {u.last_name}
                      {u.id === user.id && <span className="text-xs text-brand-500 ml-1">(you)</span>}
                    </div>
                    <div className="text-xs text-navy-500 mt-0.5">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`badge text-[10px] ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : u.role === 'manager' ? 'bg-blue-100 text-blue-800' : 'bg-navy-100 text-navy-700'}`}>
                      {u.role}
                    </span>
                    <span className={`badge text-[10px] ${u.is_active ? 'badge-active' : 'bg-red-100 text-red-800'}`}>
                      {u.is_active ? 'Active' : 'Revoked'}
                    </span>
                  </div>
                </div>
                {isAdmin && u.id !== user.id && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-navy-100">
                    <button
                      onClick={() => setEditingUser({ ...u })}
                      className="text-xs text-navy-600 hover:text-navy-800 px-2 py-1 rounded bg-navy-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { setResetPasswordUser(u); setNewPassword(''); }}
                      className="text-xs text-brand-600 hover:text-brand-800 px-2 py-1 rounded bg-brand-50"
                    >
                      Reset PW
                    </button>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u, e.target.value)}
                      disabled={actionLoading === u.id}
                      className="text-xs rounded px-2 py-1 border border-navy-200 bg-white"
                    >
                      <option value="rep">Rep</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      onClick={() => handleToggleActive(u)}
                      disabled={actionLoading === u.id}
                      className={`text-xs px-2 py-1 rounded ml-auto ${
                        u.is_active
                          ? 'text-red-600 bg-red-50'
                          : 'text-green-600 bg-green-50'
                      }`}
                    >
                      {actionLoading === u.id ? '...' : u.is_active ? 'Revoke' : 'Restore'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add User Modal */}
          {showAddUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-navy-900 mb-4">Add Team Member</h3>
                <form onSubmit={createUser} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input required placeholder="First Name" value={newUser.first_name}
                      onChange={e => setNewUser(u => ({...u, first_name: e.target.value}))} className="input-field" />
                    <input required placeholder="Last Name" value={newUser.last_name}
                      onChange={e => setNewUser(u => ({...u, last_name: e.target.value}))} className="input-field" />
                  </div>
                  <input required type="email" placeholder="Email" value={newUser.email}
                    onChange={e => setNewUser(u => ({...u, email: e.target.value}))} className="input-field" />
                  <div className="relative">
                    <input required type={showCreatePassword ? 'text' : 'password'} placeholder="Temporary Password (6+ chars)" value={newUser.password}
                      onChange={e => setNewUser(u => ({...u, password: e.target.value}))} className="input-field pr-16" minLength={6} />
                    <button type="button" onClick={() => setShowCreatePassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-navy-500 hover:text-navy-700 px-2 py-1 rounded bg-navy-50 hover:bg-navy-100 transition-colors">
                      {showCreatePassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <select value={newUser.role} onChange={e => setNewUser(u => ({...u, role: e.target.value}))} className="input-field">
                    <option value="rep">Sales Rep</option>
                    {isAdmin && <option value="manager">Manager</option>}
                    {isAdmin && <option value="admin">Admin</option>}
                  </select>
                  <p className="text-xs text-navy-400">The user will need to be given their temporary password. They can log in immediately.</p>
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setShowAddUser(false)} className="btn-secondary flex-1">Cancel</button>
                    <button type="submit" className="btn-primary flex-1">Create User</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Reset Password Modal */}
          {resetPasswordUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-navy-900 mb-2">Reset Password</h3>
                <p className="text-sm text-navy-500 mb-4">
                  Set a new password for <strong>{resetPasswordUser.first_name} {resetPasswordUser.last_name}</strong> ({resetPasswordUser.email})
                </p>
                <div className="relative mb-4">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    placeholder="New password (6+ characters)"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input-field pr-16"
                    minLength={6}
                    autoFocus
                  />
                  <button type="button" onClick={() => setShowResetPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-navy-500 hover:text-navy-700 px-2 py-1 rounded bg-navy-50 hover:bg-navy-100 transition-colors">
                    {showResetPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-navy-400 mb-4">You will need to share this password with the user directly.</p>
                <div className="flex gap-3">
                  <button onClick={() => setResetPasswordUser(null)} className="btn-secondary flex-1">Cancel</button>
                  <button
                    onClick={handleResetPassword}
                    disabled={!newPassword || newPassword.length < 6 || actionLoading === resetPasswordUser.id}
                    className="btn-primary flex-1"
                  >
                    {actionLoading === resetPasswordUser.id ? 'Resetting...' : 'Reset Password'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit User Modal */}
          {editingUser && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold text-navy-900 mb-4">Edit User</h3>
                <form onSubmit={handleUpdateUser} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input required placeholder="First Name" value={editingUser.first_name}
                      onChange={e => setEditingUser(u => u ? {...u, first_name: e.target.value} : null)} className="input-field" />
                    <input required placeholder="Last Name" value={editingUser.last_name}
                      onChange={e => setEditingUser(u => u ? {...u, last_name: e.target.value} : null)} className="input-field" />
                  </div>
                  <input required type="email" placeholder="Email" value={editingUser.email}
                    onChange={e => setEditingUser(u => u ? {...u, email: e.target.value} : null)} className="input-field" />
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => setEditingUser(null)} className="btn-secondary flex-1">Cancel</button>
                    <button type="submit" disabled={actionLoading === editingUser.id} className="btn-primary flex-1">
                      {actionLoading === editingUser.id ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ NOTIFICATIONS TAB ═══ */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="font-bold text-navy-900 mb-4">Your Notification Settings</h2>
            <p className="text-sm text-navy-500 mb-6">Configure how you receive your daily actionables digest.</p>

            {notifSuccess && (
              <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200">{notifSuccess}</div>
            )}

            <div className="space-y-4 max-w-lg">
              <div className="p-4 rounded-xl border border-navy-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">SMS Notifications</div>
                    <div className="text-xs text-navy-500">Get a text with your daily actionables</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={notifSettings.sms_enabled}
                      onChange={e => setNotifSettings(s => ({ ...s, sms_enabled: e.target.checked }))} className="sr-only peer" />
                    <div className="w-11 h-6 bg-navy-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
                  </label>
                </div>
                {notifSettings.sms_enabled && (
                  <input type="tel" placeholder="Phone number (e.g. +16135551234)" value={notifSettings.phone || ''}
                    onChange={e => setNotifSettings(s => ({ ...s, phone: e.target.value }))} className="input-field" />
                )}
              </div>

              <div className="p-4 rounded-xl border border-navy-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">Email Notifications</div>
                    <div className="text-xs text-navy-500">Receive a morning email digest</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={notifSettings.email_enabled}
                      onChange={e => setNotifSettings(s => ({ ...s, email_enabled: e.target.checked }))} className="sr-only peer" />
                    <div className="w-11 h-6 bg-navy-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
                  </label>
                </div>
                {notifSettings.email_enabled && (
                  <input type="email" placeholder="Notification email" value={notifSettings.notification_email || ''}
                    onChange={e => setNotifSettings(s => ({ ...s, notification_email: e.target.value }))} className="input-field" />
                )}
              </div>

              <div className="p-4 rounded-xl border border-navy-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-navy-900">Digest Time</div>
                    <div className="text-xs text-navy-500">When to send your daily digest (weekdays)</div>
                  </div>
                  <input type="time" value={notifSettings.daily_digest_time || '07:30'}
                    onChange={e => setNotifSettings(s => ({ ...s, daily_digest_time: e.target.value }))} className="input-field w-auto" />
                </div>
              </div>

              <button onClick={saveNotificationSettings} disabled={notifSaving} className="btn-primary w-full">
                {notifSaving ? 'Saving...' : 'Save Notification Settings'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
              <div>
                <h2 className="font-bold text-navy-900">Digest Preview</h2>
                <p className="text-xs text-navy-500">See what your next daily digest would contain</p>
              </div>
              <div className="flex gap-2">
                <button onClick={loadDigestPreview} disabled={loadingPreview} className="btn-secondary text-sm">
                  {loadingPreview ? 'Loading...' : 'Preview My Digest'}
                </button>
                {isAdmin && (
                  <button onClick={sendDigestNow} disabled={sendingDigest} className="btn-primary text-sm">
                    {sendingDigest ? 'Sending...' : 'Send Digest Now'}
                  </button>
                )}
              </div>
            </div>

            {digestPreview && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                  <h3 className="font-medium text-amber-800 mb-2">Follow-ups Due ({digestPreview.dueFollowUps.length})</h3>
                  {digestPreview.dueFollowUps.length === 0 ? (
                    <p className="text-sm text-amber-600">No follow-ups due today!</p>
                  ) : (
                    <ul className="space-y-1">
                      {digestPreview.dueFollowUps.map(f => (
                        <li key={f.id} className="text-sm text-amber-700 flex justify-between">
                          <span className="font-medium">{f.shop_name}</span>
                          <span className="text-amber-500">{f.follow_up_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-red-50 border border-red-200">
                  <h3 className="font-medium text-red-800 mb-2">Dormant Accounts ({digestPreview.dormantAccounts.length})</h3>
                  {digestPreview.dormantAccounts.length === 0 ? (
                    <p className="text-sm text-red-600">All accounts are up to date!</p>
                  ) : (
                    <ul className="space-y-1">
                      {digestPreview.dormantAccounts.map(a => (
                        <li key={a.id} className="text-sm text-red-700 flex justify-between">
                          <span className="font-medium">{a.shop_name}</span>
                          <span className="text-red-500">{a.last_contacted_at ? `Last: ${new Date(a.last_contacted_at).toLocaleDateString()}` : 'Never contacted'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                  <h3 className="font-medium text-blue-800 mb-2">New Team Notes ({digestPreview.newNotes.length})</h3>
                  {digestPreview.newNotes.length === 0 ? (
                    <p className="text-sm text-blue-600">No new notes from teammates</p>
                  ) : (
                    <ul className="space-y-2">
                      {digestPreview.newNotes.map(n => (
                        <li key={n.id} className="text-sm text-blue-700">
                          <div className="flex justify-between">
                            <span className="font-medium">{n.shop_name}</span>
                            <span className="text-blue-500 text-xs">{n.author}</span>
                          </div>
                          <p className="text-blue-600 text-xs mt-0.5">{n.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ DATA TAB (admin only) ═══ */}
      {/* ═══ DUPLICATES TAB ═══ */}
      {activeTab === 'duplicates' && isAdmin && (
        <div className="space-y-6">
          {/* Scan Controls */}
          <div className="card">
            <h2 className="font-bold text-navy-900 mb-1">Lead / Active Customer Duplicate Scanner</h2>
            <p className="text-sm text-navy-500 mb-4">
              Scans for Leads that match an Active Customer from PCR/AccountEdge. Matching leads can be reviewed and deleted, with notes transferred to the active file.
            </p>
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 mb-4">
              <div>
                <label className="text-xs font-medium text-navy-600 block mb-1">Match Threshold</label>
                <select value={dupeThreshold} onChange={e => setDupeThreshold(e.target.value)} className="input text-sm w-32">
                  <option value="1.0">Exact (100%)</option>
                  <option value="0.95">Very High (95%)</option>
                  <option value="0.90">High (90%)</option>
                  <option value="0.85">Medium (85%)</option>
                </select>
              </div>
              <button onClick={scanDuplicates} disabled={dupeScanning} className="btn-primary text-sm">
                {dupeScanning ? 'Scanning...' : 'Run Duplicate Scan'}
              </button>
            </div>
            {dupeScanResult && (
              <div className={`text-sm px-4 py-3 rounded-lg border ${
                dupeScanResult.startsWith('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
              }`}>{dupeScanResult}</div>
            )}
          </div>

          {/* Duplicate List */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-navy-900">Pending Duplicates ({duplicates.length})</h2>
              {duplicates.length > 0 && <span className="text-xs text-navy-400">Review each match below</span>}
            </div>

            {dupeLoading ? (
              <div className="text-sm text-navy-400 py-4">Loading duplicates...</div>
            ) : duplicates.length === 0 ? (
              <div className="text-sm text-navy-400 py-4">No pending duplicates. Run a scan to check for matches.</div>
            ) : (
              <div className="space-y-4">
                {duplicates.map(d => (
                  <div key={d.id} className="border border-navy-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                        d.similarity_score >= 1 ? 'bg-red-100 text-red-800' : d.similarity_score >= 0.95 ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {d.similarity_score >= 1 ? 'EXACT MATCH' : `${Math.round(d.similarity_score * 100)}% Match`}
                      </span>
                      <span className="text-xs text-navy-400">Flagged {new Date(d.created_at).toLocaleDateString()}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      {/* Lead */}
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-amber-200 text-amber-800 text-xs font-bold px-2 py-0.5 rounded">LEAD</span>
                          <span className="text-xs text-navy-400">(will be deleted)</span>
                        </div>
                        <p className="font-semibold text-navy-900">{d.lead_name}</p>
                        {d.lead_city && <p className="text-xs text-navy-500 mt-0.5">{d.lead_city}</p>}
                        {d.lead_phone && <p className="text-xs text-navy-500">{d.lead_phone}</p>}
                        {d.lead_email && <p className="text-xs text-navy-500">{d.lead_email}</p>}
                        {d.lead_contacts && <p className="text-xs text-navy-500">Contacts: {d.lead_contacts}</p>}
                        <p className="text-xs mt-2 font-medium text-amber-700">{d.lead_note_count} note(s)</p>
                        <a href={`/accounts/${d.lead_id}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block">View Lead →</a>
                      </div>

                      {/* Active Customer */}
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-green-200 text-green-800 text-xs font-bold px-2 py-0.5 rounded">ACTIVE (PCR)</span>
                          <span className="text-xs text-navy-400">(will be kept)</span>
                        </div>
                        <p className="font-semibold text-navy-900">{d.active_name}</p>
                        {d.active_city && <p className="text-xs text-navy-500 mt-0.5">{d.active_city}</p>}
                        {d.active_phone && <p className="text-xs text-navy-500">{d.active_phone}</p>}
                        {d.active_email && <p className="text-xs text-navy-500">{d.active_email}</p>}
                        {d.active_contacts && <p className="text-xs text-navy-500">Contacts: {d.active_contacts}</p>}
                        {d.active_branch && <p className="text-xs text-navy-500">Branch: {d.active_branch}</p>}
                        <p className="text-xs mt-2 font-medium text-green-700">{d.active_note_count} note(s)</p>
                        <a href={`/accounts/${d.active_id}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block">View Active File →</a>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-navy-100">
                      {confirmDeleteId === d.id ? (
                        <div className="flex items-center gap-2 w-full">
                          <p className="text-xs text-red-700 font-medium flex-1">
                            Confirm: Delete lead &quot;{d.lead_name}&quot; and transfer {d.lead_note_count} note(s) to active file?
                          </p>
                          <button
                            onClick={() => deleteLead(d.id)}
                            disabled={dupeActionLoading === d.id}
                            className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            {dupeActionLoading === d.id ? 'Deleting...' : 'Yes, Delete Lead'}
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 text-xs text-navy-600 hover:text-navy-800">Cancel</button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => setConfirmDeleteId(d.id)}
                            disabled={dupeActionLoading === d.id}
                            className="px-3 py-1.5 text-xs font-semibold bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                          >
                            Delete Lead & Transfer Notes
                          </button>
                          <button
                            onClick={() => dismissDuplicate(d.id)}
                            disabled={dupeActionLoading === d.id}
                            className="px-3 py-1.5 text-xs text-navy-500 hover:text-navy-700 hover:bg-navy-100 rounded-lg"
                          >
                            {dupeActionLoading === d.id ? 'Dismissing...' : 'Not a Duplicate'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ DATA TAB ═══ */}
      {activeTab === 'data' && isAdmin && (
        <div className="space-y-6">

          {/* PCR → sales_data refresh (Supabase only) */}
          <div className="card">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
              <div>
                <h2 className="font-bold text-navy-900">Refresh Sales from PCR (Supabase)</h2>
                <p className="text-xs text-navy-500 mt-0.5">
                  Rebuilds <code>sales_data</code> from the latest <code>pcr_sync_data.payload</code> uploaded by the AccountEdge intranet. No Google Drive involved.
                </p>
              </div>
              <button
                onClick={refreshSalesFromPcr}
                disabled={pcrRefreshRunning}
                className="btn-primary text-sm whitespace-nowrap"
              >
                {pcrRefreshRunning ? 'Refreshing…' : 'Refresh Sales Now'}
              </button>
            </div>
            {pcrRefreshResult && (
              <div className={`text-sm px-4 py-3 rounded-lg border ${
                pcrRefreshResult.startsWith('Error') || pcrRefreshResult.startsWith('Failed')
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-green-50 text-green-700 border-green-200'
              }`}>
                {pcrRefreshResult}
              </div>
            )}
          </div>

          {/* Google Drive Auto-Import */}
          <div className="card">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
              <div>
                <h2 className="font-bold text-navy-900">Google Drive Auto-Import</h2>
                <p className="text-xs text-navy-500 mt-0.5">
                  Automatically imports AccountEdge CSV files from your shared Google Drive folder.
                </p>
              </div>
              {gdriveStatus?.configured && (
                <button
                  onClick={runImportNow}
                  disabled={importRunning}
                  className="btn-primary text-sm whitespace-nowrap"
                >
                  {importRunning ? 'Importing...' : 'Run Import Now'}
                </button>
              )}
            </div>

            {importResult && (
              <div className={`text-sm px-4 py-3 rounded-lg mb-4 border ${
                importResult.startsWith('Error') || importResult.startsWith('Import failed')
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-green-50 text-green-700 border-green-200'
              }`}>
                {importResult}
              </div>
            )}

            {gdriveStatus === null ? (
              <div className="text-sm text-navy-400">Loading status...</div>
            ) : !gdriveStatus.configured ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-amber-800 font-medium mb-2">Not configured yet</p>
                <p className="text-sm text-amber-700 mb-3">
                  To enable automatic imports, you need to set up a Google Cloud service account and add these environment variables to Render:
                </p>
                <div className="space-y-1 text-xs font-mono bg-amber-100 rounded-lg p-3 text-amber-900">
                  <div>GOOGLE_SERVICE_ACCOUNT_JSON={"{"} ... {"}"}</div>
                  <div>GDRIVE_FOLDER_ID=your_folder_id_here</div>
                  <div>GDRIVE_IMPORT_CRON=0 10 * * 1-5 <span className="text-amber-600 font-sans">(optional, default: 10AM weekdays)</span></div>
                </div>
                <p className="text-xs text-amber-600 mt-3">See the setup guide in the project README for step-by-step instructions.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-green-50 border border-green-200">
                    <div className="text-xs text-green-600 font-medium">Status</div>
                    <div className="text-sm font-bold text-green-800 mt-0.5">Connected</div>
                  </div>
                  <div className="p-3 rounded-xl bg-navy-50 border border-navy-200">
                    <div className="text-xs text-navy-500 font-medium">Schedule</div>
                    <div className="text-sm font-bold text-navy-800 mt-0.5">{gdriveStatus.cronSchedule || '10AM weekdays'}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-navy-50 border border-navy-200">
                    <div className="text-xs text-navy-500 font-medium">Last Run</div>
                    <div className="text-sm font-bold text-navy-800 mt-0.5">
                      {gdriveStatus.lastRun
                        ? new Date(gdriveStatus.lastRun.created_at).toLocaleString()
                        : 'Never'}
                    </div>
                  </div>
                </div>

                {gdriveStatus.lastRun && (
                  <div className="text-xs text-navy-500">
                    Last result: {gdriveStatus.lastRun.status === 'success'
                      ? `${gdriveStatus.lastRun.records_imported} records from ${gdriveStatus.lastRun.files_processed} file(s)`
                      : `Error: ${gdriveStatus.lastRun.error_message}`}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Import History */}
          {importHistory.length > 0 && (
            <div className="card">
              <h2 className="font-bold text-navy-900 mb-3">Import History</h2>
              <div className="space-y-2">
                {importHistory.slice(0, 10).map(entry => (
                  <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-2 border-b border-navy-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        entry.status === 'success' ? 'bg-green-500' : entry.status === 'running' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                      }`} />
                      <span className="text-sm text-navy-800">
                        {entry.status === 'success'
                          ? `${entry.records_imported} records from ${entry.files_processed} file(s)`
                          : entry.status === 'running'
                            ? 'Running...'
                            : entry.error_message || 'Failed'}
                      </span>
                      {entry.unmatched_count > 0 && (
                        <span className="text-xs text-amber-600">({entry.unmatched_count} unmatched)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-navy-400">
                      <span className={`px-1.5 py-0.5 rounded ${entry.triggered_by === 'manual' ? 'bg-brand-50 text-brand-600' : 'bg-navy-50 text-navy-500'}`}>
                        {entry.triggered_by || 'cron'}
                      </span>
                      <span>{new Date(entry.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card mb-6">
            <h2 className="font-bold text-navy-900 mb-2">Customer Database Seed</h2>
            <p className="text-sm text-navy-500 mb-4">
              Import all Active Customers from the AccountEdge customer exports (Hamilton, Markham, Oakville, Ottawa, St. Catharines, Wasaga Beach). This will create customer records and link them to existing sales data.
            </p>
            {seedResult && (
              <div className={`text-sm px-4 py-3 rounded-lg mb-4 border ${seedResult.includes('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                {seedResult}
              </div>
            )}
            <button
              onClick={async () => {
                setSeedRunning(true);
                setSeedResult('');
                try {
                  const data = await api.post('/admin/seed-customers');
                  setSeedResult(`Imported ${data.imported} customers. Linked ${data.linked_sales} sales records. ${data.skipped > 0 ? `${data.skipped} errors.` : ''}`);
                } catch (err: any) {
                  setSeedResult(`Error: ${err.error || err.message || 'Import failed'}`);
                } finally {
                  setSeedRunning(false);
                }
              }}
              disabled={seedRunning}
              className="px-6 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {seedRunning ? 'Importing Customers...' : 'Import Active Customers'}
            </button>
          </div>

          {/* Create Salespeople */}
          <div className="card">
            <h2 className="font-bold text-navy-900 mb-2">Create Sales Rep Accounts</h2>
            <p className="text-sm text-navy-500 mb-4">
              Creates CRM user accounts for all salespeople found in AccountEdge data who don't have a CRM login yet. All accounts are created as Sales Reps with a default password of <strong>changeme123</strong>.
            </p>
            {createSpResult && (
              <div className={`text-sm px-4 py-3 rounded-lg mb-4 border ${
                createSpResult.error ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
              }`}>
                {createSpResult.error ? (
                  <span>Error: {createSpResult.error}</span>
                ) : (
                  <div>
                    <div className="font-medium">{createSpResult.message}</div>
                    {createSpResult.users_created?.length > 0 && (
                      <div className="mt-2 text-xs">
                        <span className="font-medium">Created:</span>{' '}
                        {createSpResult.users_created.map((u: any) => `${u.name} (${u.email})`).join(', ')}
                      </div>
                    )}
                    {createSpResult.users_existed?.length > 0 && (
                      <div className="mt-1 text-xs text-navy-500">
                        <span className="font-medium">Already existed:</span>{' '}
                        {createSpResult.users_existed.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={async () => {
                setCreateSpRunning(true);
                setCreateSpResult(null);
                try {
                  const data = await api.post('/admin/create-salespeople-and-assign');
                  setCreateSpResult(data);
                  loadUsers();
                } catch (err: any) {
                  setCreateSpResult({ error: err.error || err.message || 'Failed' });
                } finally {
                  setCreateSpRunning(false);
                }
              }}
              disabled={createSpRunning}
              className="px-6 py-3 bg-brand-600 text-white font-medium rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {createSpRunning ? 'Creating Users...' : 'Create Sales Rep Accounts'}
            </button>
          </div>

          {/* Auto-Assign Reps */}
          <div className="card">
            <h2 className="font-bold text-navy-900 mb-2">Auto-Assign Sales Reps</h2>
            <p className="text-sm text-navy-500 mb-4">
              Matches salesperson names from AccountEdge sales data to CRM users and assigns them to accounts that don't have a rep yet. House accounts and generic entries are skipped.
            </p>
            {autoAssignResult && (
              <div className={`text-sm px-4 py-3 rounded-lg mb-4 border ${
                autoAssignResult.error ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
              }`}>
                {autoAssignResult.error ? (
                  <span>Error: {autoAssignResult.error}</span>
                ) : (
                  <div>
                    <div className="font-medium mb-1">
                      {autoAssignResult.dry_run ? 'Preview (dry run)' : 'Assignment complete'}:
                      {' '}{autoAssignResult.assigned} accounts {autoAssignResult.dry_run ? 'would be' : ''} assigned, {autoAssignResult.skipped} skipped
                      {' '}(of {autoAssignResult.total_unassigned} unassigned)
                    </div>
                    {autoAssignResult.assignments?.length > 0 && (
                      <div className="mt-2 max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-green-200">
                              <th className="text-left py-1 font-medium">Shop</th>
                              <th className="text-left py-1 font-medium">Type</th>
                              <th className="text-left py-1 font-medium">Salesperson</th>
                              <th className="text-left py-1 font-medium">Assigned To</th>
                            </tr>
                          </thead>
                          <tbody>
                            {autoAssignResult.assignments.map((a: any, i: number) => (
                              <tr key={i} className="border-b border-green-100">
                                <td className="py-1">{a.shop}</td>
                                <td className="py-1 capitalize">{a.category}</td>
                                <td className="py-1">{a.salesperson}</td>
                                <td className="py-1 font-medium">{a.assigned_to}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {autoAssignResult.no_match?.length > 0 && (
                      <div className="mt-2 text-xs text-amber-700">
                        <span className="font-medium">No match ({autoAssignResult.no_match.length}):</span>{' '}
                        {autoAssignResult.no_match.slice(0, 10).map((n: any) => n.shop).join(', ')}
                        {autoAssignResult.no_match.length > 10 && ` +${autoAssignResult.no_match.length - 10} more`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={async () => {
                  setAutoAssignRunning(true);
                  setAutoAssignResult(null);
                  try {
                    const data = await api.post('/admin/auto-assign-reps', { dry_run: true });
                    setAutoAssignResult(data);
                  } catch (err: any) {
                    setAutoAssignResult({ error: err.error || err.message || 'Failed' });
                  } finally {
                    setAutoAssignRunning(false);
                  }
                }}
                disabled={autoAssignRunning}
                className="px-6 py-3 bg-navy-600 text-white font-medium rounded-xl hover:bg-navy-700 transition-colors disabled:opacity-50"
              >
                {autoAssignRunning ? 'Checking...' : 'Preview Assignments'}
              </button>
              <button
                onClick={async () => {
                  setAutoAssignRunning(true);
                  setAutoAssignResult(null);
                  try {
                    const data = await api.post('/admin/auto-assign-reps', { dry_run: false });
                    setAutoAssignResult(data);
                    loadUsers();
                  } catch (err: any) {
                    setAutoAssignResult({ error: err.error || err.message || 'Failed' });
                  } finally {
                    setAutoAssignRunning(false);
                  }
                }}
                disabled={autoAssignRunning}
                className="px-6 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {autoAssignRunning ? 'Assigning...' : 'Run Assignment'}
              </button>
            </div>
          </div>

          <div className="card">
            <h2 className="font-bold text-navy-900 mb-2">Sales Data Management</h2>
            <p className="text-sm text-navy-500 mb-6">
              Clear imported sales data so you can re-import with the correct settings. This removes all sales records but does not affect accounts, notes, or activities.
            </p>

            {dataMessage && (
              <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg mb-4 border border-green-200">{dataMessage}</div>
            )}

            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                className="px-6 py-3 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors"
              >
                Clear All Sales Data
              </button>
            ) : (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
                <p className="text-red-800 font-medium">Are you sure? This will permanently delete ALL imported sales records.</p>
                <p className="text-sm text-red-600">This cannot be undone. You will need to re-import your AccountEdge CSV after clearing.</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={clearAllSalesData}
                    disabled={clearingData}
                    className="px-6 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
                  >
                    {clearingData ? 'Deleting...' : 'Yes, Delete All Sales Data'}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-6 py-2 bg-white text-navy-700 font-medium rounded-lg border border-navy-200 hover:bg-navy-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ AUDIT TAB ═══ */}
      {activeTab === 'audit' && (
        <div className="card">
          <h2 className="font-bold text-navy-900 mb-4">Audit Log</h2>
          <p className="text-navy-500 text-sm">All changes to accounts, notes, sales, and user management are logged for security.</p>
          <p className="text-navy-400 text-sm mt-2">Audit viewer coming in next release.</p>
        </div>
      )}
    </div>
  );
}
