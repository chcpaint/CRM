/**
 * PCR Daily Sales Widget â Drop into CRM Dashboard
 *
 * Reads from pcr_daily_sales table (CRM Supabase, synced from intranet)
 * Shows today's sales by branch with progress bars toward monthly targets
 *
 * NEW: Pass currentUser prop to show a "My Shops" summary card.
 * When a rep is logged in, the widget shows their assigned shops' total alongside company-wide.
 *
 * Usage: import PCRDailySalesWidget from './PCRDailySalesWidget';
 *        <PCRDailySalesWidget supabase={supabaseClient} currentUser={loggedInUser} />
 */
import { useState, useEffect, useMemo } from 'react';

const BRANCH_COLORS = {
  WB:  '#3B82F6', // blue
  HAM: '#10B981', // green
  MAR: '#F59E0B', // amber
  OAK: '#8B5CF6', // purple
  OTT: '#EF4444', // red
  STC: '#06B6D4', // cyan
};

export default function PCRDailySalesWidget({ supabase, currentUser = null }) {
  const [dailyData, setDailyData] = useState([]);
  const [targets, setTargets] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [error, setError] = useState(null);
  const [myShopNames, setMyShopNames] = useState([]);
  const [myShopTargetTotal, setMyShopTargetTotal] = useState(0);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      setSelectedMonth({ year, month });

      // If logged in, fetch this user's assigned shops via sp mapping
      if (currentUser?.id) {
        const [mapRes, shopTgtRes] = await Promise.all([
          supabase.from('pcr_sp_mapping').select('pcr_name').eq('crm_user_id', currentUser.id),
          supabase.from('pcr_shop_targets').select('shop_name, target, salesperson'),
        ]);
        const aliases = (mapRes.data || []).map(m => m.pcr_name);
        const myShops = (shopTgtRes.data || []).filter(t => aliases.includes(t.salesperson));
        setMyShopNames(myShops.map(s => s.shop_name));
        setMyShopTargetTotal(myShops.reduce((sum, s) => sum + (parseFloat(s.target) || 0), 0));
      }

      // Fetch current month daily sales
      const { data: sales, error: salesErr } = await supabase
        .from('pcr_daily_sales')
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .order('report_date', { ascending: true });

      if (salesErr) throw salesErr;

      // Fetch monthly targets
      const { data: tgt, error: tgtErr } = await supabase
        .from('pcr_monthly_targets')
        .select('*')
        .eq('year', year)
        .eq('month', month);

      if (tgtErr) throw tgtErr;

      setDailyData(sales || []);
      const tgtMap = {};
      (tgt || []).forEach(t => { tgtMap[t.branch_code] = parseFloat(t.target); });
      setTargets(tgtMap);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Aggregate MTD totals by branch
  const mtdByBranch = useMemo(() => {
    const agg = {};
    dailyData.forEach(row => {
      if (!agg[row.branch_code]) {
        agg[row.branch_code] = {
          code: row.branch_code,
          name: row.branch_name,
          total: 0,
          days: 0,
          latestDate: row.report_date,
          latestAmount: 0,
        };
      }
      agg[row.branch_code].total += parseFloat(row.sales_total);
      agg[row.branch_code].days++;
      if (row.report_date >= agg[row.branch_code].latestDate) {
        agg[row.branch_code].latestDate = row.report_date;
        agg[row.branch_code].latestAmount = parseFloat(row.sales_total);
      }
    });
    return Object.values(agg).sort((a, b) => b.total - a.total);
  }, [dailyData]);

  // Grand totals
  const grandTotal = mtdByBranch.reduce((s, b) => s + b.total, 0);
  const grandTarget = Object.values(targets).reduce((s, t) => s + t, 0);
  const grandPct = grandTarget > 0 ? (grandTotal / grandTarget * 100) : 0;

  // Latest date in data
  const latestDate = dailyData.length > 0
    ? new Date(dailyData[dailyData.length - 1].report_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
    : '';

  const fmt = (n) => '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  if (loading) {
    return (
      <div style={styles.card}>
        <div style={styles.header}>
          <h3 style={styles.title}>Daily Sales (PCR)</h3>
        </div>
        <div style={styles.loading}>Loading sales data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.card}>
        <div style={styles.header}>
          <h3 style={styles.title}>Daily Sales (PCR)</h3>
        </div>
        <div style={styles.error}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Daily Sales (PCR)</h3>
          <span style={styles.subtitle}>
            {selectedMonth ? `${new Date(selectedMonth.year, selectedMonth.month - 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}` : ''}
            {latestDate ? ` Â· Updated ${latestDate}` : ''}
          </span>
        </div>
        <button onClick={fetchData} style={styles.refreshBtn} title="Refresh">â»</button>
      </div>

      {/* Grand Total KPI */}
      <div style={styles.kpiRow}>
        <div style={styles.kpiMain}>
          <span style={styles.kpiLabel}>MTD Total</span>
          <span style={styles.kpiValue}>{fmt(grandTotal)}</span>
        </div>
        <div style={styles.kpiSecondary}>
          <span style={styles.kpiLabel}>Target</span>
          <span style={styles.kpiValueSm}>{fmt(grandTarget)}</span>
        </div>
        <div style={styles.kpiSecondary}>
          <span style={styles.kpiLabel}>Progress</span>
          <span style={{
            ...styles.kpiValueSm,
            color: grandPct >= 100 ? '#10B981' : grandPct >= 70 ? '#F59E0B' : '#EF4444',
          }}>{grandPct.toFixed(1)}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={styles.progressBg}>
        <div style={{
          ...styles.progressFill,
          width: `${Math.min(grandPct, 100)}%`,
          backgroundColor: grandPct >= 100 ? '#10B981' : grandPct >= 70 ? '#F59E0B' : '#3B82F6',
        }} />
      </div>

      {/* My Portfolio Summary â shown when a rep is logged in with assigned shops */}
      {currentUser && myShopNames.length > 0 && (
        <div style={styles.myPortfolio}>
          <div style={styles.myPortfolioHeader}>
            <span style={styles.myPortfolioLabel}>â My Portfolio</span>
            <span style={styles.myPortfolioCount}>{myShopNames.length} shops</span>
          </div>
          <div style={styles.myPortfolioStats}>
            <span style={styles.myPortfolioTarget}>
              Annual Target: {fmt(myShopTargetTotal)}
            </span>
          </div>
        </div>
      )}

      {/* Branch Breakdown */}
      <div style={styles.branchList}>
        {mtdByBranch.map(branch => {
          const target = targets[branch.code] || 0;
          const pct = target > 0 ? (branch.total / target * 100) : 0;
          return (
            <div key={branch.code} style={styles.branchRow}>
              <div style={styles.branchInfo}>
                <div style={{
                  ...styles.branchDot,
                  backgroundColor: BRANCH_COLORS[branch.code] || '#6B7280',
                }} />
                <div>
                  <div style={styles.branchName}>{branch.name}</div>
                  <div style={styles.branchMeta}>
                    Today: {fmt(branch.latestAmount)} Â· {branch.days} days
                  </div>
                </div>
              </div>
              <div style={styles.branchRight}>
                <div style={styles.branchTotal}>{fmt(branch.total)}</div>
                <div style={styles.branchPct}>
                  <div style={styles.miniProgressBg}>
                    <div style={{
                      ...styles.miniProgressFill,
                      width: `${Math.min(pct, 100)}%`,
                      backgroundColor: BRANCH_COLORS[branch.code] || '#6B7280',
                    }} />
                  </div>
                  <span style={{
                    fontSize: '11px',
                    color: pct >= 100 ? '#10B981' : '#6B7280',
                    fontWeight: pct >= 100 ? '600' : '400',
                  }}>{pct.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sync indicator */}
      <div style={styles.syncFooter}>
        Synced from CHC Intranet PCR
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: '#fff',
    borderRadius: '12px',
    border: '1px solid #E5E7EB',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#111827',
  },
  subtitle: {
    fontSize: '12px',
    color: '#6B7280',
  },
  refreshBtn: {
    background: 'none',
    border: '1px solid #E5E7EB',
    borderRadius: '6px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '16px',
    color: '#6B7280',
  },
  kpiRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '12px',
  },
  kpiMain: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  kpiSecondary: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  kpiLabel: {
    fontSize: '11px',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  kpiValue: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#111827',
  },
  kpiValueSm: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#374151',
  },
  progressBg: {
    height: '6px',
    borderRadius: '3px',
    backgroundColor: '#F3F4F6',
    marginBottom: '20px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.5s ease',
  },
  branchList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  branchRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #F3F4F6',
  },
  branchInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  branchDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  branchName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#111827',
  },
  branchMeta: {
    fontSize: '11px',
    color: '#9CA3AF',
  },
  branchRight: {
    textAlign: 'right',
  },
  branchTotal: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#111827',
  },
  branchPct: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '2px',
  },
  miniProgressBg: {
    width: '48px',
    height: '4px',
    borderRadius: '2px',
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    borderRadius: '2px',
  },
  myPortfolio: {
    marginBottom: '16px',
    padding: '10px 14px',
    backgroundColor: '#EFF6FF',
    borderRadius: '8px',
    border: '1px solid #BFDBFE',
  },
  myPortfolioHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  myPortfolioLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1D4ED8',
  },
  myPortfolioCount: {
    fontSize: '11px',
    color: '#3B82F6',
    fontWeight: '500',
  },
  myPortfolioStats: {
    marginTop: '4px',
  },
  myPortfolioTarget: {
    fontSize: '12px',
    color: '#4B5563',
  },
  syncFooter: {
    marginTop: '12px',
    paddingTop: '8px',
    borderTop: '1px solid #F3F4F6',
    fontSize: '10px',
    color: '#9CA3AF',
    textAlign: 'center',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#6B7280',
  },
  error: {
    padding: '20px',
    textAlign: 'center',
    color: '#EF4444',
    fontSize: '13px',
  },
};
