import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { User, Account, STATUS_LABELS, STATUS_COLORS, StatusType } from '../types';

interface Props { user: User }

export default function AccountsPage({ user }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Category toggle: 'lead' or 'customer'
  const [category, setCategory] = useState<'lead' | 'customer'>(
    (searchParams.get('category') as 'lead' | 'customer') || 'customer'
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const isManager = user.role === 'admin' || user.role === 'manager';
  // Reps default to "my accounts"; managers/admins default to "all"
  const [myAccountsOnly, setMyAccountsOnly] = useState(!isManager);

  // Debounce timer ref for live search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSearchRef = useRef(search);

  useEffect(() => {
    loadAccounts();
  }, [page, statusFilter, category, branchFilter, myAccountsOnly]);

  // Live search: debounce 400ms after typing
  useEffect(() => {
    // Skip on initial render or if search hasn't changed
    if (prevSearchRef.current === search) return;
    prevSearchRef.current = search;

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setPage(1);
      loadAccounts();
    }, 400);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  // Respond to ?search= and ?category= from URL (voice nav, etc.)
  useEffect(() => {
    const urlSearch = searchParams.get('search');
    const urlCategory = searchParams.get('category') as 'lead' | 'customer' | null;
    if (urlSearch && urlSearch !== search) {
      setSearch(urlSearch);
      setPage(1);
      // Trigger load after setting
      setTimeout(() => loadAccounts(), 0);
    }
    if (urlCategory && urlCategory !== category) {
      setCategory(urlCategory);
    }
  }, [searchParams]);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: page.toString(), limit: '25', category };
      if (myAccountsOnly) params.my_accounts = 'true';
      if (statusFilter) params.status = statusFilter;
      if (branchFilter) params.branch = branchFilter;
      if (search) params.search = search;
      const data = await api.get('/accounts', params);
      setAccounts(data.accounts);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadAccounts();
  };

  const switchCategory = (cat: 'lead' | 'customer') => {
    setCategory(cat);
    setPage(1);
    setSearch('');
    setStatusFilter('');
    setBranchFilter('');
  };

  const [autoLogToast, setAutoLogToast] = useState('');

  // Auto-log: fires native action AND logs the activity
  const handleContactAction = async (e: React.MouseEvent, accountId: number, type: 'call' | 'sms' | 'email', href: string) => {
    e.stopPropagation();
    e.preventDefault();
    window.location.href = href;
    try {
      const actType = type === 'sms' ? 'text' : type;
      await api.post(`/accounts/${accountId}/activities`, {
        activity_type: actType,
        description: `${actType.charAt(0).toUpperCase() + actType.slice(1)} initiated from app`
      });
      setAutoLogToast(`${actType.charAt(0).toUpperCase() + actType.slice(1)} logged`);
      setTimeout(() => setAutoLogToast(''), 3000);
    } catch (err) {
      console.error('Auto-log failed:', err);
    }
  };

  const BRANCHES = ['Hamilton', 'Markham', 'Oakville', 'Ottawa', 'St. Catharines', 'Woodbridge'];

  return (
    <div>
      {/* Auto-log toast */}
      {autoLogToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg animate-slide-down">
          ✓ {autoLogToast}
        </div>
      )}

      {/* ═══ TOP CATEGORY TOGGLE ═══ */}
      <div className="flex items-center gap-1 p-1 bg-navy-100 rounded-xl mb-4 sm:mb-6">
        <button
          onClick={() => switchCategory('customer')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
            category === 'customer'
              ? 'bg-green-600 text-white shadow-md'
              : 'text-navy-500 hover:text-navy-700 hover:bg-white/50'
          }`}
        >
          Active Customers
        </button>
        <button
          onClick={() => switchCategory('lead')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
            category === 'lead'
              ? 'bg-brand-600 text-white shadow-md'
              : 'text-navy-500 hover:text-navy-700 hover:bg-white/50'
          }`}
        >
          Leads
        </button>
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-900">
            {category === 'customer' ? 'Active Customers' : 'Leads'}
          </h1>
          <p className="text-navy-500 text-sm mt-1">{total} {myAccountsOnly ? 'of my ' : ''}{category === 'customer' ? 'customers' : 'leads'}</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary text-sm">
          + New {category === 'customer' ? 'Customer' : 'Lead'}
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-4 sm:mb-6">
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, branch, city, rep, contact, phone..."
                  className="input-field w-full pr-8"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); setPage(1); setTimeout(() => loadAccounts(), 0); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-600 text-lg leading-none"
                    title="Clear search"
                  >
                    &times;
                  </button>
                )}
              </div>
              <button type="submit" className="btn-primary">Search</button>
            </div>
          </form>
          {category === 'lead' && (
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="input-field w-auto"
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}
          <select
            value={branchFilter}
            onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}
            className="input-field w-auto"
          >
            <option value="">All Branches</option>
            {BRANCHES.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          {/* My Accounts / All toggle */}
          <div className="flex items-center bg-navy-100 rounded-lg p-0.5">
            <button
              onClick={() => { setMyAccountsOnly(true); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                myAccountsOnly
                  ? 'bg-white text-navy-900 shadow-sm'
                  : 'text-navy-500 hover:text-navy-700'
              }`}
            >
              My Accounts
            </button>
            {isManager && (
              <button
                onClick={() => { setMyAccountsOnly(false); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  !myAccountsOnly
                    ? 'bg-white text-navy-900 shadow-sm'
                    : 'text-navy-500 hover:text-navy-700'
                }`}
              >
                All
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Account list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-navy-500">No {category === 'customer' ? 'customers' : 'leads'} found</p>
          {search && <p className="text-navy-400 text-sm mt-1">Try a different search term</p>}
        </div>
      ) : (
        <>
          {/* Mobile: card view */}
          <div className="md:hidden space-y-3">
            {accounts.map((account) => (
              <div
                key={account.id}
                onClick={() => navigate(`/accounts/${account.id}`)}
                className="card block hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-navy-900 truncate">{account.shop_name}</div>
                    <div className="text-sm text-navy-500 mt-1">
                      {account.city || 'No city'}
                      {account.branch && (
                        <span className="text-navy-400"> &middot; {account.branch}</span>
                      )}
                    </div>
                    {account.contact_names && (
                      <div className="text-sm text-navy-400 mt-0.5">{account.contact_names}</div>
                    )}
                  </div>
                  {category === 'lead' ? (
                    <span className={`badge ${STATUS_COLORS[account.status]} flex-shrink-0`}>
                      {STATUS_LABELS[account.status]}
                    </span>
                  ) : (
                    <span className="badge badge-active flex-shrink-0">Customer</span>
                  )}
                </div>
                {/* Large contact action buttons — tap to call/text/email + auto-log */}
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-navy-100">
                  {account.phone ? (
                    <button
                      onClick={e => handleContactAction(e, account.id, 'call', `tel:${account.phone!.replace(/[^\d+]/g, '')}`)}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 active:scale-95 transition-all">
                      <span className="text-xl">📞</span>
                      <span className="text-xs font-semibold">Call</span>
                    </button>
                  ) : (
                    <div className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-gray-50 text-gray-300">
                      <span className="text-xl opacity-40">📞</span>
                      <span className="text-xs">Call</span>
                    </div>
                  )}
                  {account.phone ? (
                    <button
                      onClick={e => handleContactAction(e, account.id, 'sms', `sms:${account.phone!.replace(/[^\d+]/g, '')}`)}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 active:scale-95 transition-all">
                      <span className="text-xl">💬</span>
                      <span className="text-xs font-semibold">Text</span>
                    </button>
                  ) : (
                    <div className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-gray-50 text-gray-300">
                      <span className="text-xl opacity-40">💬</span>
                      <span className="text-xs">Text</span>
                    </div>
                  )}
                  {account.email ? (
                    <button
                      onClick={e => handleContactAction(e, account.id, 'email', `mailto:${account.email}`)}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 active:scale-95 transition-all">
                      <span className="text-xl">📧</span>
                      <span className="text-xs font-semibold">Email</span>
                    </button>
                  ) : (
                    <div className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-gray-50 text-gray-300">
                      <span className="text-xl opacity-40">📧</span>
                      <span className="text-xs">Email</span>
                    </div>
                  )}
                </div>
                {/* Shop detail highlights */}
                {(account.paint_line || account.num_painters || account.banner || account.contract_status && account.contract_status !== 'none') && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-navy-50">
                    {account.paint_line && <span className="text-[10px] bg-navy-50 text-navy-600 px-2 py-0.5 rounded-full">{account.paint_line}</span>}
                    {account.banner && account.banner !== 'None' && <span className="text-[10px] bg-navy-50 text-navy-600 px-2 py-0.5 rounded-full">{account.banner}</span>}
                    {account.num_painters != null && <span className="text-[10px] bg-navy-50 text-navy-600 px-2 py-0.5 rounded-full">{account.num_painters} painters</span>}
                    {account.num_paint_booths != null && <span className="text-[10px] bg-navy-50 text-navy-600 px-2 py-0.5 rounded-full">{account.num_paint_booths} booths</span>}
                    {account.contract_status && account.contract_status !== 'none' && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        account.contract_status === 'active' ? 'bg-green-50 text-green-700' :
                        account.contract_status === 'pending' ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      }`}>Contract: {account.contract_status}</span>
                    )}
                  </div>
                )}
                <div className="text-xs mt-1.5 text-right">
                  {account.rep_first_name
                    ? <span className="text-navy-500 font-medium">Rep: {account.rep_first_name} {account.rep_last_name}</span>
                    : <span className="text-navy-300">Unassigned</span>
                  }
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table view */}
          <div className="hidden md:block card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-navy-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Shop Name</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">City</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Branch</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Contact</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Rep</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase hidden lg:table-cell">Paint Line</th>
                  {category === 'lead' && (
                    <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Status</th>
                  )}
                  <th className="text-left py-3 px-4 text-xs font-medium text-navy-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-b border-navy-50 hover:bg-navy-50 transition-colors">
                    <td className="py-3 px-4">
                      <Link to={`/accounts/${account.id}`} className="font-medium text-navy-900 hover:text-brand-600">
                        {account.shop_name}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-sm text-navy-600">{account.city || '-'}</td>
                    <td className="py-3 px-4 text-sm text-navy-500">{account.branch || '-'}</td>
                    <td className="py-3 px-4 text-sm text-navy-600">{account.contact_names || '-'}</td>
                    <td className="py-3 px-4 text-sm text-navy-600">
                      {account.rep_first_name ? `${account.rep_first_name} ${account.rep_last_name}` : <span className="text-navy-300">Unassigned</span>}
                    </td>
                    <td className="py-3 px-4 text-sm text-navy-500 hidden lg:table-cell">{account.paint_line || '-'}</td>
                    {category === 'lead' && (
                      <td className="py-3 px-4">
                        <span className={`badge ${STATUS_COLORS[account.status]}`}>
                          {STATUS_LABELS[account.status]}
                        </span>
                      </td>
                    )}
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        {account.phone && (
                          <>
                            <a href={`tel:${account.phone.replace(/[^\d+]/g, '')}`} className="text-green-600 hover:text-green-700 text-sm" title="Call">
                              Call
                            </a>
                            <a href={`sms:${account.phone.replace(/[^\d+]/g, '')}`} className="text-blue-600 hover:text-blue-700 text-sm" title="Text">
                              Text
                            </a>
                          </>
                        )}
                        {account.email && (
                          <a href={`mailto:${account.email}`} className="text-purple-600 hover:text-purple-700 text-sm" title="Email">
                            Email
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-ghost disabled:opacity-50"
              >
                Previous
              </button>
              <span className="flex items-center px-4 text-sm text-navy-500">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-ghost disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Add Account Modal */}
      {showAddModal && (
        <AddAccountModal
          category={category}
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); loadAccounts(); }}
        />
      )}
    </div>
  );
}

function AddAccountModal({ category, onClose, onCreated }: { category: 'lead' | 'customer'; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    shop_name: '', address: '', city: '', province: 'ON', postal_code: '', contact_names: '',
    phone: '', phone2: '', email: '', status: category === 'customer' ? 'active' : 'prospect',
    account_type: 'collision', account_category: category, branch: ''
  });
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const BRANCHES = ['Hamilton', 'Markham', 'Oakville', 'Ottawa', 'St. Catharines', 'Woodbridge'];

  const handleSubmit = async (e: React.FormEvent, skipDuplicate = false) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/accounts', { ...form, skip_duplicate_check: skipDuplicate });
      onCreated();
    } catch (err: any) {
      if (err.status === 409 && err.duplicates) {
        setDuplicates(err.duplicates);
      } else {
        setError(err.error || 'Failed to create');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-navy-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-navy-900">
            New {category === 'customer' ? 'Customer' : 'Lead'}
          </h2>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-600 text-xl">&times;</button>
        </div>

        {duplicates.length > 0 ? (
          <div className="p-6">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <h3 className="font-bold text-yellow-800 mb-2">Potential Duplicate Detected!</h3>
              {duplicates.map((d: any, i: number) => (
                <div key={i} className="text-sm text-yellow-700 mb-1">
                  <strong>{d.shop_name}</strong> ({d.city}) — {(d.score * 100).toFixed(0)}% match
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button onClick={(e) => handleSubmit(e, true)} className="btn-primary flex-1">Create Anyway</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">Shop Name *</label>
              <input type="text" required value={form.shop_name}
                onChange={(e) => setForm(f => ({ ...f, shop_name: e.target.value }))}
                className="input-field" placeholder="e.g. Acme Collision" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">City</label>
                <input type="text" value={form.city}
                  onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
                  className="input-field" />
              </div>
              {category === 'customer' ? (
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-1">Branch</label>
                  <select value={form.branch}
                    onChange={(e) => setForm(f => ({ ...f, branch: e.target.value }))}
                    className="input-field">
                    <option value="">Select branch</option>
                    {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-1">Status</label>
                  <select value={form.status}
                    onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}
                    className="input-field">
                    {Object.entries(STATUS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">Address</label>
              <input type="text" value={form.address}
                onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                className="input-field" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Province</label>
                <input type="text" value={form.province}
                  onChange={(e) => setForm(f => ({ ...f, province: e.target.value }))}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Postal Code</label>
                <input type="text" value={form.postal_code}
                  onChange={(e) => setForm(f => ({ ...f, postal_code: e.target.value }))}
                  className="input-field" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">Contact Name(s)</label>
              <input type="text" value={form.contact_names}
                onChange={(e) => setForm(f => ({ ...f, contact_names: e.target.value }))}
                className="input-field" placeholder="e.g. Joe, John" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Phone</label>
                <input type="tel" value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Email</label>
                <input type="email" value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  className="input-field" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? 'Creating...' : `Create ${category === 'customer' ? 'Customer' : 'Lead'}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
