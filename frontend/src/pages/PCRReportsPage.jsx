/**
 * PCR Reports Page â Full PCR section for CRM Reports screen
 *
 * Reads from pcr_sync_data, pcr_daily_sales, pcr_shop_list, pcr_shop_targets (CRM Supabase)
 * Decodes the compressed JSONB payload client-side (same format as intranet)
 *
 * CORRECTED ROW MAPPING (verified against intranet DB):
 *   [0] branch_idx  â payload.branches[idx]
 *   [1] customer_idx â payload.customers[idx]  â THIS IS THE SHOP
 *   [2] month       (1-12)
 *   [3] year
 *   [4] amount      (line total in cents, divide by 100)
 *   [5] sku         (string product code)
 *   [6] quantity
 *   [7] desc_idx    â payload.descs[idx] for unit price
 *   [8] cl1_idx     â payload.cl1[idx] product category
 *   [9] cl2_idx     â payload.cl2[idx] product line
 *  [10] sp_idx      â payload.sp[idx] salesperson
 *  [11] day         (1-31)
 *
 * Filtering: Branch, Shop (dropdown + search), Salesperson, Category, Product Line, Month
 * Tabs: Transactions, Daily Sales, Branch Summary, Shop Summary
 *
 * NEW: "My Shops" feature â pass currentUser prop with { id, first_name, last_name, role }
 * and the component auto-loads the rep's PCR name aliases and assigned shops from pcr_sp_mapping.
 * Reps see a "My Shops" toggle button that instantly filters to only their assigned shops and sales.
 * Admins/managers see all data by default but can still toggle to any rep's view.
 *
 * Usage: import PCRReportsPage from './PCRReportsPage';
 *        <PCRReportsPage supabase={supabaseClient} currentUser={loggedInUser} />
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

const BRANCH_INDEX = ['Hamilton', 'Markham', 'Oakville', 'Ottawa', 'St. Catharines', 'Woodbridge'];

export default function PCRReportsPage({ supabase, currentUser = null }) {
  const [pcrPayload, setPcrPayload] = useState(null);
  const [dailySales, setDailySales] = useState([]);
  const [shopList, setShopList] = useState([]);
  const [shopTargets, setShopTargets] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncInfo, setSyncInfo] = useState(null);

  // Salesperson mapping
  const [spMapping, setSpMapping] = useState([]);       // full pcr_sp_mapping table
  const [myPcrNames, setMyPcrNames] = useState([]);     // current user's PCR name aliases
  const [myShopNames, setMyShopNames] = useState([]);   // shops assigned to current user
  const [myShopsMode, setMyShopsMode] = useState(false); // "My Shops" toggle active

  // Filters
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterShop, setFilterShop] = useState('all');
  const [filterShopSearch, setFilterShopSearch] = useState('');
  const [filterSP, setFilterSP] = useState('all');
  const [filterCL1, setFilterCL1] = useState('all');
  const [filterCL2, setFilterCL2] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [showShopDropdown, setShowShopDropdown] = useState(false);
  const shopDropdownRef = useRef(null);

  // Sorting
  const [sortCol, setSortCol] = useState('amount');
  const [sortDir, setSortDir] = useState('desc');

  // Pagination
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Active tab
  const [tab, setTab] = useState('transactions');

  // Close shop dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (shopDropdownRef.current && !shopDropdownRef.current.contains(e.target)) {
        setShowShopDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    try {
      setLoading(true);

      const [pcrRes, dailyRes, shopRes, shopTgtRes, spMapRes] = await Promise.all([
        supabase.from('pcr_sync_data').select('*').eq('id', 1).single(),
        supabase.from('pcr_daily_sales').select('*').order('report_date', { ascending: false }).limit(500),
        supabase.from('pcr_shop_list').select('shop_name, branch').order('branch').order('shop_name'),
        supabase.from('pcr_shop_targets').select('shop_name, target, install, salesperson'),
        supabase.from('pcr_sp_mapping').select('pcr_name, crm_user_id, crm_display_name, is_house_account'),
      ]);

      if (pcrRes.error) throw pcrRes.error;
      if (dailyRes.error) throw dailyRes.error;

      setPcrPayload(pcrRes.data?.payload || null);
      setSyncInfo({
        synced_at: pcrRes.data?.synced_at,
        uploaded_by: pcrRes.data?.uploaded_by,
        intranet_uploaded_at: pcrRes.data?.intranet_uploaded_at,
      });
      setDailySales(dailyRes.data || []);
      setShopList(shopRes.data || []);

      // Build shop targets lookup
      const tgtMap = {};
      (shopTgtRes.data || []).forEach(t => {
        tgtMap[t.shop_name] = { target: parseFloat(t.target) || 0, install: t.install, salesperson: t.salesperson };
      });
      setShopTargets(tgtMap);

      // Build salesperson mapping
      const mapping = spMapRes.data || [];
      setSpMapping(mapping);

      // Determine current user's PCR aliases and assigned shops
      if (currentUser?.id) {
        const userAliases = mapping
          .filter(m => m.crm_user_id === currentUser.id)
          .map(m => m.pcr_name);
        setMyPcrNames(userAliases);

        // Shops assigned to this user via shop_targets
        const assignedShops = (shopTgtRes.data || [])
          .filter(t => userAliases.includes(t.salesperson))
          .map(t => t.shop_name);
        setMyShopNames(assignedShops);

        // Auto-enable "My Shops" for reps (not admins/managers)
        if (currentUser.role === 'rep' && assignedShops.length > 0) {
          setMyShopsMode(true);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Decode PCR rows â CORRECTED MAPPING: position 1 = customer/shop
  const decodedRows = useMemo(() => {
    if (!pcrPayload?.rows) return [];
    const { rows, branches = BRANCH_INDEX, customers = [], sp = [], cl1 = [], cl2 = [], descs = {} } = pcrPayload;

    return rows.map((r) => {
      const branchIdx  = r[0];
      const custIdx    = r[1];   // SHOP/CUSTOMER is at position 1
      const month      = r[2];
      const year       = r[3];
      const amountRaw  = r[4];   // line total (cents or raw)
      const skuCode    = r[5];   // SKU string
      const qty        = r[6];
      const descIdx    = r[7];   // maps to descs for unit price
      const cl1Idx     = r[4];
      const cl2Idx     = r[9];
      const spIdx      = r[10] !== undefined ? r[10] : 0;
      const day        = r[11];

      // Amount: use raw / 100 as line total
      const amount = typeof amountRaw === 'number' ? amountRaw / 100 : 0;

      // Unit price from descs lookup
      const unitPriceStr = descs[String(descIdx)] || '';
      const unitPrice = parseFloat(unitPriceStr.replace(/[$,]/g, '')) || 0;

      return {
        branch:    branches[branchIdx] || `Branch ${branchIdx}`,
        customer:  customers[custIdx] || `Customer ${custIdx}`,
        month,
        day,
        year,
        date:      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        amount,
        unitPrice,
        sku:       skuCode,
        qty,
        cl1:       cl1[cl1Idx] || '',
        cl2:       cl2[cl2Idx] || '',
        sp:        sp[spIdx] || '',
      };
    });
  }, [pcrPayload]);

  // Build filter options from decoded data + shop list
  const filterOptions = useMemo(() => {
    const branches = [...new Set(decodedRows.map(r => r.branch))].sort();
    const customers = [...new Set(decodedRows.map(r => r.customer))].sort();
    const sps = [...new Set(decodedRows.map(r => r.sp).filter(Boolean))].sort();
    const cl1s = [...new Set(decodedRows.map(r => r.cl1).filter(Boolean))].sort();
    const cl2s = [...new Set(decodedRows.map(r => r.cl2).filter(Boolean))].sort();
    const months = [...new Set(decodedRows.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`))].sort().reverse();

    // Shops grouped by branch (from the synced shop_list for the dropdown)
    const shopsByBranch = {};
    shopList.forEach(s => {
      if (!shopsByBranch[s.branch]) shopsByBranch[s.branch] = [];
      shopsByBranch[s.branch].push(s.shop_name);
    });

    return { branches, customers, sps, cl1s, cl2s, months, shopsByBranch };
  }, [decodedRows, shopList]);

  // Filtered shop options for the dropdown (respects branch filter + search)
  const filteredShopOptions = useMemo(() => {
    let shops = filterOptions.customers;
    // If a branch is selected, narrow to shops in that branch (from shop_list)
    if (filterBranch !== 'all') {
      const branchShops = new Set(
        shopList.filter(s => s.branch === filterBranch).map(s => s.shop_name)
      );
      // Include shops that are in the branch list OR appear in PCR data for that branch
      const pcrShopsInBranch = new Set(
        decodedRows.filter(r => r.branch === filterBranch).map(r => r.customer)
      );
      const combined = new Set([...branchShops, ...pcrShopsInBranch]);
      shops = shops.filter(s => combined.has(s));
    }
    if (filterShopSearch.trim()) {
      const q = filterShopSearch.toLowerCase();
      shops = shops.filter(s => s.toLowerCase().includes(q));
    }
    return shops.slice(0, 100); // cap for performance
  }, [filterOptions.customers, filterBranch, filterShopSearch, shopList, decodedRows]);

  // Build a set of "my" PCR names for fast lookup
  const myPcrNamesSet = useMemo(() => new Set(myPcrNames), [myPcrNames]);
  const myShopNamesSet = useMemo(() => new Set(myShopNames), [myShopNames]);

  // CRM users list for the "View as" dropdown (admins/managers only)
  const crmReps = useMemo(() => {
    const seen = new Map();
    spMapping
      .filter(m => m.crm_user_id && !m.is_house_account)
      .forEach(m => {
        if (!seen.has(m.crm_user_id)) {
          seen.set(m.crm_user_id, { id: m.crm_user_id, name: m.crm_display_name });
        }
      });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [spMapping]);

  // "View as" state for admins/managers
  const [viewAsUserId, setViewAsUserId] = useState(null);

  // Compute effective PCR names and shops based on myShopsMode + viewAs
  const effectiveFilter = useMemo(() => {
    if (!myShopsMode) return null;

    const targetUserId = viewAsUserId || currentUser?.id;
    if (!targetUserId) return null;

    const aliases = spMapping
      .filter(m => m.crm_user_id === targetUserId)
      .map(m => m.pcr_name);
    const aliasSet = new Set(aliases);

    // Shops where this user is assigned as salesperson in shop_targets
    const assignedShops = new Set();
    Object.entries(shopTargets).forEach(([shopName, info]) => {
      if (aliasSet.has(info.salesperson)) assignedShops.add(shopName);
    });

    return { aliasSet, assignedShops };
  }, [myShopsMode, viewAsUserId, currentUser, spMapping, shopTargets]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let rows = decodedRows;

    // "My Shops" filter â show transactions for my assigned shops OR where I'm the salesperson
    if (myShopsMode && effectiveFilter) {
      rows = rows.filter(r =>
        effectiveFilter.assignedShops.has(r.customer) || effectiveFilter.aliasSet.has(r.sp)
      );
    }

    if (filterBranch !== 'all') rows = rows.filter(r => r.branch === filterBranch);
    if (filterShop !== 'all') rows = rows.filter(r => r.customer === filterShop);
    if (filterSP !== 'all') rows = rows.filter(r => r.sp === filterSP);
    if (filterCL1 !== 'all') rows = rows.filter(r => r.cl1 === filterCL1);
    if (filterCL2 !== 'all') rows = rows.filter(r => r.cl2 === filterCL2);
    if (filterMonth !== 'all') rows = rows.filter(r => `${r.year}-${String(r.month).padStart(2, '0')}` === filterMonth);
    return rows;
  }, [decodedRows, myShopsMode, effectiveFilter, filterBranch, filterShop, filterSP, filterCL1, filterCL2, filterMonth]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  // Paginated rows
  const pageRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE);

  // Summary by branch
  const branchSummary = useMemo(() => {
    const agg = {};
    filteredRows.forEach(r => {
      if (!agg[r.branch]) agg[r.branch] = { branch: r.branch, total: 0, count: 0, customers: new Set() };
      agg[r.branch].total += r.amount;
      agg[r.branch].count++;
      agg[r.branch].customers.add(r.customer);
    });
    return Object.values(agg)
      .map(a => ({ ...a, customers: a.customers.size }))
      .sort((a, b) => b.total - a.total);
  }, [filteredRows]);

  // Summary by shop â THIS IS THE KEY VIEW FOR SALES TEAM
  const shopSummary = useMemo(() => {
    const agg = {};
    filteredRows.forEach(r => {
      const key = r.customer;
      if (!agg[key]) agg[key] = { shop: key, branch: r.branch, total: 0, count: 0, sps: new Set() };
      agg[key].total += r.amount;
      agg[key].count++;
      if (r.sp) agg[key].sps.add(r.sp);
    });
    return Object.values(agg)
      .map(a => ({
        ...a,
        sps: [...a.sps].join(', '),
        target: shopTargets[a.shop]?.target || 0,
        install: shopTargets[a.shop]?.install || '',
        assignedSP: shopTargets[a.shop]?.salesperson || '',
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredRows, shopTargets]);

  const handleSort = useCallback((col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
    setPage(0);
  }, [sortCol]);

  const resetFilters = () => {
    setFilterBranch('all');
    setFilterShop('all');
    setFilterShopSearch('');
    setFilterSP('all');
    setFilterCL1('all');
    setFilterCL2('all');
    setFilterMonth('all');
    setPage(0);
  };

  const selectShop = (shopName) => {
    setFilterShop(shopName);
    setFilterShopSearch('');
    setShowShopDropdown(false);
    setPage(0);
  };

  const fmt = (n) => '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtK = (n) => n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : fmt(n);

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span style={{ color: '#D1D5DB' }}> â</span>;
    return <span style={{ color: '#3B82F6' }}> {sortDir === 'asc' ? 'â' : 'â'}</span>;
  };

  if (loading) {
    return <div style={styles.page}><div style={styles.loading}>Loading PCR data...</div></div>;
  }

  if (error) {
    return <div style={styles.page}><div style={styles.error}>Error: {error}</div></div>;
  }

  return (
    <div style={styles.page}>
      {/* Page Header */}
      <div style={styles.pageHeader}>
        <div>
          <h2 style={styles.pageTitle}>PCR Reports</h2>
          <p style={styles.pageSubtitle}>
            {decodedRows.length.toLocaleString()} transactions Â· {filterOptions.customers.length} shops
            {syncInfo?.uploaded_by ? ` Â· Uploaded by ${syncInfo.uploaded_by}` : ''}
            {syncInfo?.synced_at ? ` Â· Synced ${new Date(syncInfo.synced_at).toLocaleString('en-CA')}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchAll} style={styles.btnOutline}>â» Refresh</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {[
          { id: 'transactions', label: 'Transactions' },
          { id: 'shopSummary', label: 'Shop Summary' },
          { id: 'daily', label: 'Daily Sales' },
          { id: 'summary', label: 'Branch Summary' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setPage(0); }}
            style={tab === t.id ? styles.tabActive : styles.tab}
          >{t.label}</button>
        ))}
      </div>

      {/* My Shops Toggle + View As */}
      {currentUser && (
        <div style={styles.myShopsBar}>
          <button
            onClick={() => {
              setMyShopsMode(!myShopsMode);
              if (!myShopsMode) {
                setViewAsUserId(currentUser.id);
              }
              setFilterShop('all');
              setPage(0);
            }}
            style={myShopsMode ? styles.myShopsBtnActive : styles.myShopsBtn}
          >
            {myShopsMode ? 'â My Shops' : 'â My Shops'}
          </button>

          {myShopsMode && (
            <span style={styles.myShopsInfo}>
              {myShopNames.length > 0
                ? `${myShopNames.length} assigned shops`
                : 'Showing all your transactions'}
            </span>
          )}

          {/* Admins/managers can view as any rep */}
          {myShopsMode && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
            <select
              value={viewAsUserId || ''}
              onChange={e => { setViewAsUserId(e.target.value ? parseInt(e.target.value) : null); setPage(0); }}
              style={{ ...styles.select, borderColor: '#3B82F6', backgroundColor: '#EFF6FF' }}
            >
              <option value="">View as...</option>
              {crmReps.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={styles.filterBar}>
        {/* Branch filter */}
        <select value={filterBranch} onChange={e => { setFilterBranch(e.target.value); setFilterShop('all'); setPage(0); }} style={styles.select}>
          <option value="all">All Branches</option>
          {filterOptions.branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>

        {/* Shop filter â searchable dropdown */}
        <div ref={shopDropdownRef} style={{ position: 'relative' }}>
          <div
            onClick={() => setShowShopDropdown(!showShopDropdown)}
            style={{
              ...styles.select,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minWidth: '220px',
              backgroundColor: filterShop !== 'all' ? '#EFF6FF' : '#fff',
              borderColor: filterShop !== 'all' ? '#3B82F6' : '#D1D5DB',
            }}
          >
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '190px',
              fontWeight: filterShop !== 'all' ? '500' : '400',
            }}>
              {filterShop !== 'all' ? filterShop : 'All Shops'}
            </span>
            <span style={{ fontSize: '10px', color: '#6B7280' }}> â¼</span>
          </div>
          {showShopDropdown && (
            <div style={styles.shopDropdown}>
              <input
                type="text"
                placeholder="Search shops..."
                value={filterShopSearch}
                onChange={e => setFilterShopSearch(e.target.value)}
                style={styles.shopSearchInput}
                autoFocus
              />
              <div style={styles.shopOptionsList}>
                <div
                  onClick={() => selectShop('all')}
                  style={{
                    ...styles.shopOption,
                    fontWeight: filterShop === 'all' ? '600' : '400',
                    color: filterShop === 'all' ? '#3B82F6' : '#374151',
                  }}
                >All Shops</div>
                {filteredShopOptions.map(s => (
                  <div
                    key={s}
                    onClick={() => selectShop(s)}
                    style={{
                      ...styles.shopOption,
                      fontWeight: filterShop === s ? '600' : '400',
                      backgroundColor: filterShop === s ? '#EFF6FF' : 'transparent',
                    }}
                  >
                    {s}
                    {shopTargets[s] && (
                      <span style={{ fontSize: '10px', color: '#9CA3AF', marginLeft: '6px' }}>
                        Target: {fmtK(shopTargets[s].target)}
                      </span>
                    )}
                  </div>
                ))}
                {filteredShopOptions.length === 0 && (
                  <div style={{ padding: '8px 12px', color: '#9CA3AF', fontSize: '12px' }}>No shops found</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Salesperson */}
        <select value={filterSP} onChange={e => { setFilterSP(e.target.value); setPage(0); }} style={styles.select}>
          <option value="all">All Salespersons</option>
          {filterOptions.sps.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Product Category */}
        <select value={filterCL1} onChange={e => { setFilterCL1(e.target.value); setPage(0); }} style={styles.select}>
          <option value="all">All Categories</option>
          {filterOptions.cl1s.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Product Line */}
        <select value={filterCL2} onChange={e => { setFilterCL2(e.target.value); setPage(0); }} style={styles.select}>
          <option value="all">All Product Lines</option>
          {filterOptions.cl2s.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Month */}
        <select value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setPage(0); }} style={styles.select}>
          <option value="all">All Months</option>
          {filterOptions.months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <button onClick={resetFilters} style={styles.btnSmall}>Clear All</button>
      </div>

      {/* Active filter chips */}
      {(myShopsMode || filterBranch !== 'all' || filterShop !== 'all' || filterSP !== 'all' || filterCL1 !== 'all' || filterCL2 !== 'all' || filterMonth !== 'all') && (
        <div style={styles.chipBar}>
          {myShopsMode && <span style={styles.chipMyShops} onClick={() => { setMyShopsMode(false); setPage(0); }}>â My Shops Ã</span>}
          {filterBranch !== 'all' && <span style={styles.chip} onClick={() => { setFilterBranch('all'); setPage(0); }}>Branch: {filterBranch} Ã</span>}
          {filterShop !== 'all' && <span style={styles.chipShop} onClick={() => { setFilterShop('all'); setPage(0); }}>Shop: {filterShop} Ã</span>}
          {filterSP !== 'all' && <span style={styles.chip} onClick={() => { setFilterSP('all'); setPage(0); }}>Rep: {filterSP} Ã</span>}
          {filterCL1 !== 'all' && <span style={styles.chip} onClick={() => { setFilterCL1('all'); setPage(0); }}>Cat: {filterCL1} Ã</span>}
          {filterCL2 !== 'all' && <span style={styles.chip} onClick={() => { setFilterCL2('all'); setPage(0); }}>Line: {filterCL2} Ã</span>}
          {filterMonth !== 'all' && <span style={styles.chip} onClick={() => { setFilterMonth('all'); setPage(0); }}>Month: {filterMonth} Ã</span>}
        </div>
      )}

      {/* Filter stats */}
      <div style={styles.filterStats}>
        Showing {filteredRows.length.toLocaleString()} of {decodedRows.length.toLocaleString()} transactions
        {filteredRows.length !== decodedRows.length && (
          <> Â· Total: {fmt(filteredRows.reduce((s, r) => s + r.amount, 0))}</>
        )}
        {filterShop !== 'all' && shopTargets[filterShop] && (
          <> Â· Annual Target: {fmt(shopTargets[filterShop].target)}
            {shopTargets[filterShop].salesperson && <> Â· Assigned Rep: {shopTargets[filterShop].salesperson}</>}
            {shopTargets[filterShop].install && <> Â· Install: {shopTargets[filterShop].install}</>}
          </>
        )}
      </div>

      {/* TAB: Transactions */}
      {tab === 'transactions' && (
        <>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {[
                    { col: 'date', label: 'Date' },
                    { col: 'branch', label: 'Branch' },
                    { col: 'customer', label: 'Shop' },
                    { col: 'sp', label: 'Salesperson' },
                    { col: 'sku', label: 'SKU' },
                    { col: 'cl1', label: 'Category' },
                    { col: 'cl2', label: 'Product Line' },
                    { col: 'qty', label: 'Qty' },
                    { col: 'amount', label: 'Amount' },
                  ].map(h => (
                    <th key={h.col} style={styles.th} onClick={() => handleSort(h.col)}>
                      {h.label}<SortIcon col={h.col} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                    <td style={styles.td}>{r.date}</td>
                    <td style={styles.td}>{r.branch}</td>
                    <td style={styles.tdShop} onClick={() => selectShop(r.customer)} title={`Filter by ${r.customer}`}>{r.customer}</td>
                    <td style={styles.td}>{r.sp}</td>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '12px' }}>{r.sku}</td>
                    <td style={styles.td}>{r.cl1}</td>
                    <td style={styles.td}>{r.cl2}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{r.qty}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: '500' }}>{fmt(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={styles.pagination}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={styles.pageBtn}>â Prev</button>
            <span style={styles.pageInfo}>Page {page + 1} of {totalPages || 1}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={styles.pageBtn}>Next â</button>
          </div>
        </>
      )}

      {/* TAB: Shop Summary â CRITICAL FOR SALES TEAM */}
      {tab === 'shopSummary' && (
        <>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th} onClick={() => handleSort('shop')}>Shop<SortIcon col="shop" /></th>
                  <th style={styles.th} onClick={() => handleSort('branch')}>Branch<SortIcon col="branch" /></th>
                  <th style={styles.th}>Assigned Rep</th>
                  <th style={styles.th}>Install</th>
                  <th style={{ ...styles.th, textAlign: 'right' }} onClick={() => handleSort('total')}>YTD Sales<SortIcon col="total" /></th>
                  <th style={{ ...styles.th, textAlign: 'right' }} onClick={() => handleSort('target')}>Annual Target<SortIcon col="target" /></th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>% to Target</th>
                  <th style={{ ...styles.th, textAlign: 'right' }} onClick={() => handleSort('count')}>Transactions<SortIcon col="count" /></th>
                </tr>
              </thead>
              <tbody>
                {shopSummary
                  .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                  .map((s, i) => {
                  const pct = s.target > 0 ? (s.total / s.target * 100) : null;
                  return (
                    <tr key={s.shop} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                      <td style={styles.tdShop} onClick={() => { selectShop(s.shop); setTab('transactions'); }} title={`View transactions for ${s.shop}`}>
                        {s.shop}
                      </td>
                      <td style={styles.td}>{s.branch}</td>
                      <td style={styles.td}>{s.assignedSP || s.sps || 'â'}</td>
                      <td style={{ ...styles.td, fontSize: '12px', color: '#6B7280' }}>{s.install || 'â'}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600' }}>{fmt(s.total)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', color: '#6B7280' }}>{s.target > 0 ? fmt(s.target) : 'â'}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        {pct !== null ? (
                          <span style={{
                            fontWeight: '600',
                            color: pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444',
                          }}>{pct.toFixed(1)}%</span>
                        ) : 'â'}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{s.count.toLocaleString()}</td>
                    </tr>
                  );
                })}
                {shopSummary.length > 1 && page === 0 && (
                  <tr style={{ backgroundColor: '#F0F4FF', fontWeight: '600' }}>
                    <td style={styles.td}>Total ({shopSummary.length} shops)</td>
                    <td style={styles.td}>â</td>
                    <td style={styles.td}>â</td>
                    <td style={styles.td}>â</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(shopSummary.reduce((s, b) => s + b.total, 0))}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(shopSummary.reduce((s, b) => s + b.target, 0))}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>â</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{shopSummary.reduce((s, b) => s + b.count, 0).toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={styles.pagination}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={styles.pageBtn}>â Prev</button>
            <span style={styles.pageInfo}>Page {page + 1} of {Math.ceil(shopSummary.length / PAGE_SIZE) || 1}</span>
            <button disabled={page >= Math.ceil(shopSummary.length / PAGE_SIZE) - 1} onClick={() => setPage(p => p + 1)} style={styles.pageBtn}>Next â</button>
          </div>
        </>
      )}

      {/* TAB: Daily Sales */}
      {tab === 'daily' && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Branch</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Sales</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Target</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Transfers</th>
              </tr>
            </thead>
            <tbody>
              {dailySales
                .filter(d => filterBranch === 'all' || d.branch_name === filterBranch)
                .slice(0, 200)
                .map((d, i) => (
                <tr key={i} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                  <td style={styles.td}>{d.report_date}</td>
                  <td style={styles.td}>{d.branch_name}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: '500' }}>{fmt(d.sales_total)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#6B7280' }}>{fmt(d.target)}</td>
                  <td style={{ ...styles.td, textAlign: 'right', color: '#6B7280' }}>{fmt(d.transfers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB: Branch Summary */}
      {tab === 'summary' && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Branch</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Total Sales</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Transactions</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Unique Shops</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Avg Transaction</th>
              </tr>
            </thead>
            <tbody>
              {branchSummary.map((b, i) => (
                <tr key={b.branch} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                  <td style={{ ...styles.td, fontWeight: '500', cursor: 'pointer', color: '#3B82F6' }} onClick={() => { setFilterBranch(b.branch); setPage(0); }}>{b.branch}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600' }}>{fmt(b.total)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{b.count.toLocaleString()}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{b.customers.toLocaleString()}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(b.count > 0 ? b.total / b.count : 0)}</td>
                </tr>
              ))}
              {branchSummary.length > 1 && (
                <tr style={{ backgroundColor: '#F9FAFB', fontWeight: '600' }}>
                  <td style={styles.td}>Total</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(branchSummary.reduce((s, b) => s + b.total, 0))}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{branchSummary.reduce((s, b) => s + b.count, 0).toLocaleString()}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>â</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>â</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '24px',
    maxWidth: '1400px',
  },
  myShopsBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
    padding: '10px 14px',
    backgroundColor: '#FAFBFF',
    borderRadius: '8px',
    border: '1px solid #E5E7EB',
  },
  myShopsBtn: {
    padding: '6px 16px',
    borderRadius: '20px',
    border: '1px solid #D1D5DB',
    background: '#fff',
    fontSize: '13px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer',
  },
  myShopsBtnActive: {
    padding: '6px 16px',
    borderRadius: '20px',
    border: '1px solid #2563EB',
    background: '#2563EB',
    fontSize: '13px',
    fontWeight: '600',
    color: '#fff',
    cursor: 'pointer',
  },
  myShopsInfo: {
    fontSize: '12px',
    color: '#6B7280',
  },
  chipMyShops: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    backgroundColor: '#2563EB',
    color: '#fff',
    cursor: 'pointer',
    border: '1px solid #1D4ED8',
    fontWeight: '600',
  },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px',
  },
  pageTitle: {
    margin: 0,
    fontSize: '22px',
    fontWeight: '700',
    color: '#111827',
  },
  pageSubtitle: {
    margin: '4px 0 0',
    fontSize: '13px',
    color: '#6B7280',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '16px',
    borderBottom: '1px solid #E5E7EB',
    paddingBottom: '0',
  },
  tab: {
    padding: '8px 16px',
    border: 'none',
    background: 'none',
    fontSize: '14px',
    color: '#6B7280',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    marginBottom: '-1px',
  },
  tabActive: {
    padding: '8px 16px',
    border: 'none',
    background: 'none',
    fontSize: '14px',
    color: '#3B82F6',
    fontWeight: '600',
    cursor: 'pointer',
    borderBottom: '2px solid #3B82F6',
    marginBottom: '-1px',
  },
  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '8px',
    alignItems: 'center',
  },
  chipBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '8px',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    backgroundColor: '#F3F4F6',
    color: '#374151',
    cursor: 'pointer',
    border: '1px solid #E5E7EB',
  },
  chipShop: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
    cursor: 'pointer',
    border: '1px solid #BFDBFE',
    fontWeight: '500',
  },
  select: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #D1D5DB',
    fontSize: '13px',
    color: '#374151',
    background: '#fff',
    minWidth: '140px',
  },
  shopDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    zIndex: 50,
    width: '320px',
    maxHeight: '360px',
    background: '#fff',
    border: '1px solid #D1D5DB',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    marginTop: '4px',
    overflow: 'hidden',
  },
  shopSearchInput: {
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    borderBottom: '1px solid #E5E7EB',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  shopOptionsList: {
    maxHeight: '300px',
    overflowY: 'auto',
  },
  shopOption: {
    padding: '8px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #F9FAFB',
  },
  btnOutline: {
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid #D1D5DB',
    background: '#fff',
    fontSize: '13px',
    color: '#374151',
    cursor: 'pointer',
    fontWeight: '500',
  },
  btnSmall: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #D1D5DB',
    background: '#fff',
    fontSize: '12px',
    color: '#6B7280',
    cursor: 'pointer',
  },
  filterStats: {
    fontSize: '12px',
    color: '#9CA3AF',
    marginBottom: '12px',
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    padding: '10px 12px',
    textAlign: 'left',
    fontWeight: '600',
    color: '#374151',
    borderBottom: '2px solid #E5E7EB',
    backgroundColor: '#F9FAFB',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #F3F4F6',
    color: '#111827',
  },
  tdShop: {
    padding: '8px 12px',
    borderBottom: '1px solid #F3F4F6',
    color: '#2563EB',
    cursor: 'pointer',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: '500',
  },
  trEven: { backgroundColor: '#fff' },
  trOdd: { backgroundColor: '#FAFAFA' },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16px',
    marginTop: '12px',
    padding: '8px 0',
  },
  pageBtn: {
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid #D1D5DB',
    background: '#fff',
    fontSize: '13px',
    color: '#374151',
    cursor: 'pointer',
  },
  pageInfo: {
    fontSize: '13px',
    color: '#6B7280',
  },
  loading: {
    padding: '60px',
    textAlign: 'center',
    color: '#6B7280',
    fontSize: '15px',
  },
  error: {
    padding: '40px',
    textAlign: 'center',
    color: '#EF4444',
    fontSize: '14px',
  },
};
