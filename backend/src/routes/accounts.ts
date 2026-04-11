import { Router, Response } from 'express';
import { queryAll, queryOne, execute } from '../db';
import { authenticate } from '../middleware/auth';
import { logAudit } from '../middleware/audit';
import { AuthRequest, Account } from '../types';
import { findDuplicates, flagDuplicate } from '../services/duplicateService';

const router = Router();

// GET /api/accounts - list with filters
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { status, assigned_rep_id, city, search, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let where = ['a.deleted_at IS NULL'];
    let params: any[] = [];

    if (status) {
      where.push('a.status = ?');
      params.push(status);
    }
    if (assigned_rep_id) {
      where.push('a.assigned_rep_id = ?');
      params.push(assigned_rep_id);
    }
    if (city) {
      where.push('a.city LIKE ?');
      params.push(`%${city}%`);
    }
    if (search) {
      where.push('(a.shop_name LIKE ? OR a.contact_names LIKE ? OR a.city LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM accounts a ${whereClause}`,
      params
    );

    const accounts = queryAll(
      `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name
       FROM accounts a
       LEFT JOIN users u ON a.assigned_rep_id = u.id
       ${whereClause}
       ORDER BY a.shop_name ASC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      accounts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limitNum)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id - single account with notes
router.get('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const account = queryOne(
      `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name
       FROM accounts a
       LEFT JOIN users u ON a.assigned_rep_id = u.id
       WHERE a.id = ? AND a.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const notes = queryAll(
      `SELECT n.*, u.first_name, u.last_name
       FROM notes n
       JOIN users u ON n.created_by_id = u.id
       WHERE n.account_id = ?
       ORDER BY n.created_at DESC`,
      [req.params.id]
    );

    const activities = queryAll(
      `SELECT act.*, u.first_name, u.last_name
       FROM activities act
       JOIN users u ON act.rep_id = u.id
       WHERE act.account_id = ?
       ORDER BY act.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );

    res.json({ account, notes, activities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/check-duplicate
router.post('/check-duplicate', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { shop_name, city, exclude_id } = req.body;
    if (!shop_name) {
      return res.status(400).json({ error: 'shop_name is required' });
    }

    const duplicates = findDuplicates(shop_name, city, 0.80, exclude_id);
    res.json({
      hasDuplicates: duplicates.length > 0,
      duplicates: duplicates.map(d => ({
        id: d.existingAccount.id,
        shop_name: d.existingAccount.shop_name,
        city: d.existingAccount.city,
        status: d.existingAccount.status,
        score: d.score,
        matchedOn: d.matchedOn
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts - create
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const {
      shop_name, address, city, area, province, contact_names, phone, email,
      account_type, assigned_rep_id, status, suppliers, paint_line, allied_products,
      sundries, has_contract, mpo, num_techs, sq_footage, annual_revenue,
      former_sherwin_client, follow_up_date, tags, skip_duplicate_check
    } = req.body;

    if (!shop_name) {
      return res.status(400).json({ error: 'shop_name is required' });
    }

    // Check for duplicates unless explicitly skipped
    if (!skip_duplicate_check) {
      const duplicates = findDuplicates(shop_name, city);
      if (duplicates.length > 0) {
        return res.status(409).json({
          error: 'Potential duplicate detected',
          duplicates: duplicates.map(d => ({
            id: d.existingAccount.id,
            shop_name: d.existingAccount.shop_name,
            city: d.existingAccount.city,
            status: d.existingAccount.status,
            score: d.score,
            matchedOn: d.matchedOn
          }))
        });
      }
    }

    const { lastId } = execute(
      `INSERT INTO accounts (shop_name, address, city, area, province, contact_names, phone, email,
        account_type, assigned_rep_id, status, suppliers, paint_line, allied_products, sundries,
        has_contract, mpo, num_techs, sq_footage, annual_revenue, former_sherwin_client,
        follow_up_date, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shop_name, address || null, city || null, area || null, province || 'ON',
        contact_names || null, phone || null, email || null,
        account_type || 'collision', assigned_rep_id || null,
        status || 'prospect', suppliers || null, paint_line || null,
        allied_products || null, sundries || null,
        has_contract ? 1 : 0, mpo || null, num_techs || null,
        sq_footage || null, annual_revenue || null,
        former_sherwin_client ? 1 : 0, follow_up_date || null,
        JSON.stringify(tags || [])
      ]
    );

    logAudit(req, 'account', lastId, 'create', { shop_name, city, status: status || 'prospect' });

    const account = queryOne('SELECT * FROM accounts WHERE id = ?', [lastId]);
    res.status(201).json({ account });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/accounts/:id - update
router.put('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = queryOne<Account>('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const fields = [
      'shop_name', 'address', 'city', 'area', 'province', 'contact_names',
      'phone', 'email', 'account_type', 'assigned_rep_id', 'status',
      'suppliers', 'paint_line', 'allied_products', 'sundries',
      'has_contract', 'mpo', 'num_techs', 'sq_footage', 'annual_revenue',
      'former_sherwin_client', 'follow_up_date', 'tags'
    ];

    const updates: string[] = ['updated_at = datetime("now")'];
    const params: any[] = [];
    const changes: any = {};

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        let value = req.body[field];
        if (field === 'tags' && Array.isArray(value)) value = JSON.stringify(value);
        if (field === 'has_contract' || field === 'former_sherwin_client') value = value ? 1 : 0;
        updates.push(`${field} = ?`);
        params.push(value);
        changes[field] = { from: (existing as any)[field], to: value };
      }
    }

    params.push(req.params.id);
    execute(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`, params);

    logAudit(req, 'account', parseInt(req.params.id), 'update', changes);

    const updated = queryOne('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
    res.json({ account: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/accounts/:id - soft delete
router.delete('/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = queryOne('SELECT id FROM accounts WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Account not found' });
    }

    execute('UPDATE accounts SET deleted_at = datetime("now") WHERE id = ?', [req.params.id]);
    logAudit(req, 'account', parseInt(req.params.id), 'delete', {});
    res.json({ message: 'Account deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/import - bulk import
router.post('/import', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { accounts: importData, skip_duplicates } = req.body;

    if (!Array.isArray(importData) || importData.length === 0) {
      return res.status(400).json({ error: 'accounts array is required' });
    }

    let imported = 0;
    let skipped = 0;
    let duplicatesList: any[] = [];

    for (const row of importData) {
      if (!row.shop_name) { skipped++; continue; }

      // Check for duplicates
      const dupes = findDuplicates(row.shop_name, row.city, 0.85);
      if (dupes.length > 0 && !skip_duplicates) {
        duplicatesList.push({
          shop_name: row.shop_name,
          city: row.city,
          matchedWith: dupes[0].existingAccount.shop_name,
          score: dupes[0].score
        });
        skipped++;
        continue;
      }

      const { lastId } = execute(
        `INSERT INTO accounts (shop_name, address, city, area, province, contact_names, phone, email,
          account_type, assigned_rep_id, status, suppliers, paint_line, allied_products, sundries,
          has_contract, mpo, num_techs, sq_footage, annual_revenue, former_sherwin_client,
          follow_up_date, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.shop_name, row.address || null, row.city || null, row.area || null, row.province || 'ON',
          row.contact_names || null, row.phone || null, row.email || null,
          row.account_type || 'collision', row.assigned_rep_id || null,
          row.status || 'prospect', row.suppliers || null, row.paint_line || null,
          row.allied_products || null, row.sundries || null,
          row.has_contract ? 1 : 0, row.mpo || null, row.num_techs || null,
          row.sq_footage || null, row.annual_revenue || null,
          row.former_sherwin_client ? 1 : 0, row.follow_up_date || null,
          JSON.stringify(row.tags || [])
        ]
      );

      // If duplicates found but skip_duplicates is true, flag them
      if (dupes.length > 0) {
        for (const dupe of dupes) {
          flagDuplicate(lastId, dupe.existingAccount.id, dupe.score);
        }
      }

      imported++;
    }

    logAudit(req, 'account', null, 'import', { imported, skipped, duplicates: duplicatesList.length });

    res.json({
      imported,
      skipped,
      duplicates: duplicatesList,
      total: importData.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/export/csv
router.get('/export/csv', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const accounts = queryAll(
      `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name
       FROM accounts a
       LEFT JOIN users u ON a.assigned_rep_id = u.id
       WHERE a.deleted_at IS NULL
       ORDER BY a.shop_name`
    );

    const headers = ['Shop Name', 'Address', 'City', 'Province', 'Contact(s)', 'Phone', 'Email',
      'Type', 'Rep', 'Status', 'Suppliers', 'Paint Line', 'Contract', '# Techs', 'Sq Footage',
      'Annual Revenue', 'Follow-Up Date', 'Last Contacted'];

    const rows = accounts.map(a => [
      a.shop_name, a.address, a.city, a.province, a.contact_names, a.phone, a.email,
      a.account_type, a.rep_first_name ? `${a.rep_first_name} ${a.rep_last_name}` : '',
      a.status, a.suppliers, a.paint_line, a.has_contract ? 'Y' : 'N',
      a.num_techs, a.sq_footage, a.annual_revenue, a.follow_up_date, a.last_contacted_at
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=accounts-export.csv');
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
