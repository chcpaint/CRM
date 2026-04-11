import { Router, Response } from 'express';
import { queryAll, queryOne, execute } from '../db';
import { authenticate } from '../middleware/auth';
import { logAudit } from '../middleware/audit';
import { AuthRequest } from '../types';

const router = Router();

// POST /api/accounts/:accountId/activities
router.post('/accounts/:accountId/activities', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { activity_type, description, scheduled_date } = req.body;
    if (!activity_type) {
      return res.status(400).json({ error: 'activity_type is required' });
    }

    const account = queryOne('SELECT id FROM accounts WHERE id = ? AND deleted_at IS NULL', [req.params.accountId]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const { lastId } = execute(
      `INSERT INTO activities (account_id, rep_id, activity_type, description, scheduled_date, completed_date)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [req.params.accountId, req.user!.userId, activity_type, description || null, scheduled_date || null]
    );

    // Update last_contacted_at
    execute('UPDATE accounts SET last_contacted_at = datetime("now"), updated_at = datetime("now") WHERE id = ?', [req.params.accountId]);

    logAudit(req, 'activity', lastId, 'create', { account_id: req.params.accountId, activity_type });

    const activity = queryOne(
      `SELECT act.*, u.first_name, u.last_name FROM activities act JOIN users u ON act.rep_id = u.id WHERE act.id = ?`,
      [lastId]
    );
    res.status(201).json({ activity });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/reminders - dormant accounts (no contact in 14+ days)
router.get('/activities/reminders', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 14;
    const repFilter = req.user!.role === 'rep' ? 'AND a.assigned_rep_id = ?' : '';
    const params: any[] = [days];
    if (req.user!.role === 'rep') params.push(req.user!.userId);

    const dormant = queryAll(
      `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name
       FROM accounts a
       LEFT JOIN users u ON a.assigned_rep_id = u.id
       WHERE a.deleted_at IS NULL
       AND a.status IN ('prospect', 'active')
       AND (a.last_contacted_at IS NULL OR a.last_contacted_at < datetime('now', '-' || ? || ' days'))
       ${repFilter}
       ORDER BY a.last_contacted_at ASC NULLS FIRST
       LIMIT 50`,
      params
    );
    res.json({ dormant, count: dormant.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
