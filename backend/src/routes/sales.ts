import { Router, Response } from 'express';
import { queryAll, queryOne, execute } from '../db';
import { authenticate } from '../middleware/auth';
import { logAudit } from '../middleware/audit';
import { AuthRequest } from '../types';
import { similarityScore } from '../services/duplicateService';

const router = Router();

// GET /api/sales - list sales data
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { month, rep_id, account_id, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let where: string[] = [];
    let params: any[] = [];

    if (month) { where.push('s.month = ?'); params.push(month); }
    if (rep_id) { where.push('s.rep_id = ?'); params.push(rep_id); }
    if (account_id) { where.push('s.account_id = ?'); params.push(account_id); }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const sales = queryAll(
      `SELECT s.*, a.shop_name, u.first_name as rep_first_name, u.last_name as rep_last_name
       FROM sales_data s
       LEFT JOIN accounts a ON s.account_id = a.id
       LEFT JOIN users u ON s.rep_id = u.id
       ${whereClause}
       ORDER BY s.sale_date DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const totalResult = queryOne<{ total: number }>(`SELECT COUNT(*) as total FROM sales_data s ${whereClause}`, params);

    res.json({
      sales,
      pagination: { page: pageNum, limit: limitNum, total: totalResult?.total || 0 }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales - create sale
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { account_id, sale_amount, sale_date, memo } = req.body;
    if (!sale_amount || !sale_date) {
      return res.status(400).json({ error: 'sale_amount and sale_date are required' });
    }

    const month = sale_date.substring(0, 7); // YYYY-MM
    const { lastId } = execute(
      `INSERT INTO sales_data (account_id, rep_id, sale_amount, sale_date, month, memo) VALUES (?, ?, ?, ?, ?, ?)`,
      [account_id || null, req.user!.userId, sale_amount, sale_date, month, memo || null]
    );

    logAudit(req, 'sale', lastId, 'create', { account_id, sale_amount, sale_date });
    const sale = queryOne('SELECT * FROM sales_data WHERE id = ?', [lastId]);
    res.status(201).json({ sale });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales/import - import from AccountEdge CSV
router.post('/import', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required' });
    }

    // Get all accounts for matching
    const allAccounts = queryAll<{ id: number; shop_name: string }>(
      'SELECT id, shop_name FROM accounts WHERE deleted_at IS NULL'
    );

    let imported = 0;
    let unmatched: any[] = [];

    for (const record of records) {
      const customerName = record.customer_name || record['Customer Name'] || '';
      const amount = parseFloat(record.amount || record['Amount'] || record['Total'] || 0);
      const date = record.date || record['Invoice Date'] || record['Date'] || '';
      const memo = record.memo || record['Memo'] || record['Description'] || '';

      if (!customerName || !amount || !date) continue;

      // Try to match customer to existing account
      let matchedAccountId: number | null = null;
      let bestScore = 0;

      for (const account of allAccounts) {
        const score = similarityScore(customerName, account.shop_name);
        if (score > bestScore && score >= 0.80) {
          bestScore = score;
          matchedAccountId = account.id;
        }
      }

      const month = date.substring(0, 7);

      execute(
        `INSERT INTO sales_data (account_id, rep_id, sale_amount, sale_date, month, memo, customer_name, imported_from_accountedge)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [matchedAccountId, req.user!.userId, amount, date, month, memo, customerName]
      );

      if (!matchedAccountId) {
        unmatched.push({ customer_name: customerName, amount, date });
      }
      imported++;
    }

    logAudit(req, 'sale', null, 'import', { imported, unmatched: unmatched.length });

    res.json({
      imported,
      unmatched,
      total: records.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/metrics
router.get('/dashboard/metrics', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const repFilter = req.user!.role === 'rep';
    const userId = req.user!.userId;

    // Account counts by status
    const statusCounts = queryAll(
      `SELECT status, COUNT(*) as count FROM accounts WHERE deleted_at IS NULL
       ${repFilter ? 'AND assigned_rep_id = ?' : ''}
       GROUP BY status`,
      repFilter ? [userId] : []
    );

    // Monthly revenue (last 12 months)
    const monthlyRevenue = queryAll(
      `SELECT month, SUM(sale_amount) as total, COUNT(*) as count
       FROM sales_data
       ${repFilter ? 'WHERE rep_id = ?' : ''}
       GROUP BY month
       ORDER BY month DESC
       LIMIT 12`,
      repFilter ? [userId] : []
    );

    // Top accounts by revenue
    const topAccounts = queryAll(
      `SELECT a.shop_name, a.city, SUM(s.sale_amount) as total_revenue, COUNT(s.id) as sale_count
       FROM sales_data s
       JOIN accounts a ON s.account_id = a.id
       ${repFilter ? 'WHERE s.rep_id = ?' : ''}
       GROUP BY s.account_id
       ORDER BY total_revenue DESC
       LIMIT 10`,
      repFilter ? [userId] : []
    );

    // Recent activities
    const recentActivities = queryAll(
      `SELECT act.*, a.shop_name, u.first_name, u.last_name
       FROM activities act
       JOIN accounts a ON act.account_id = a.id
       JOIN users u ON act.rep_id = u.id
       ${repFilter ? 'WHERE act.rep_id = ?' : ''}
       ORDER BY act.created_at DESC
       LIMIT 10`,
      repFilter ? [userId] : []
    );

    // Dormant accounts count
    const dormantCount = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM accounts
       WHERE deleted_at IS NULL AND status IN ('prospect', 'active')
       AND (last_contacted_at IS NULL OR last_contacted_at < datetime('now', '-14 days'))
       ${repFilter ? 'AND assigned_rep_id = ?' : ''}`,
      repFilter ? [userId] : []
    );

    res.json({
      statusCounts,
      monthlyRevenue: monthlyRevenue.reverse(),
      topAccounts,
      recentActivities,
      dormantCount: dormantCount?.count || 0,
      totalAccounts: statusCounts.reduce((sum: number, s: any) => sum + s.count, 0)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
