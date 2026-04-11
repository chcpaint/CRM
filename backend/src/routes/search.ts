import { Router, Response } from 'express';
import { queryAll } from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// POST /api/search - AI-powered natural language search
// For now: smart keyword search. AI integration can be added with Claude API key.
router.post('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.body;
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const q = query.toLowerCase().trim();

    // Parse natural language patterns
    let sql = '';
    let params: any[] = [];
    let searchType = 'accounts';

    // Check for rep-specific queries
    const repMatch = q.match(/(?:michelle|ben|adam)(?:'s)?/i);
    let repName = repMatch ? repMatch[0].replace("'s", '') : null;

    // Check for status queries
    const statusMap: Record<string, string> = {
      'prospect': 'prospect', 'prospects': 'prospect',
      'active': 'active', 'customers': 'active', 'client': 'active', 'clients': 'active',
      'cold': 'cold', 'dnc': 'dnc', 'do not contact': 'dnc', 'do not call': 'dnc',
      'churned': 'churned'
    };

    let statusFilter: string | null = null;
    for (const [keyword, status] of Object.entries(statusMap)) {
      if (q.includes(keyword)) {
        statusFilter = status;
        break;
      }
    }

    // Check for city queries
    const cityMatch = q.match(/(?:in|from|near)\s+([a-z\s]+?)(?:\s|$)/i);
    let cityFilter = cityMatch ? cityMatch[1].trim() : null;

    // Check for dormant/inactive queries
    const isDormantQuery = q.includes('dormant') || q.includes("haven't contacted") ||
      q.includes('not contacted') || q.includes('inactive') || q.includes('overdue');

    // Check for notes query
    const isNotesQuery = q.includes('notes') || q.includes('note');

    // Check for former Sherwin
    const isSherwinQuery = q.includes('sherwin');

    // Build the query
    let where: string[] = ['a.deleted_at IS NULL'];

    if (repName) {
      where.push('u.first_name LIKE ?');
      params.push(`%${repName}%`);
    }
    if (statusFilter) {
      where.push('a.status = ?');
      params.push(statusFilter);
    }
    if (cityFilter) {
      where.push('a.city LIKE ?');
      params.push(`%${cityFilter}%`);
    }
    if (isSherwinQuery) {
      where.push('a.former_sherwin_client = 1');
    }
    if (isDormantQuery) {
      where.push("(a.last_contacted_at IS NULL OR a.last_contacted_at < datetime('now', '-14 days'))");
      where.push("a.status IN ('prospect', 'active')");
    }

    // If no specific filters matched, do a general text search
    if (where.length === 1) {
      // Remove known query words and search remaining
      const searchTerms = q.replace(/show|me|find|all|the|get|list|search|for|who|what|which|where/gi, '').trim();
      if (searchTerms.length > 0) {
        where.push('(a.shop_name LIKE ? OR a.contact_names LIKE ? OR a.city LIKE ? OR a.suppliers LIKE ? OR a.paint_line LIKE ?)');
        const term = `%${searchTerms}%`;
        params.push(term, term, term, term, term);
      }
    }

    const whereClause = where.join(' AND ');

    if (isNotesQuery && !isDormantQuery) {
      // Search notes
      const noteSearch = q.replace(/notes?|on|about|for|show|me|find|get|what/gi, '').trim();
      const noteResults = queryAll(
        `SELECT n.*, a.shop_name, u.first_name, u.last_name
         FROM notes n
         JOIN accounts a ON n.account_id = a.id
         JOIN users u ON n.created_by_id = u.id
         WHERE a.shop_name LIKE ? OR n.content LIKE ?
         ORDER BY n.created_at DESC
         LIMIT 20`,
        [`%${noteSearch}%`, `%${noteSearch}%`]
      );
      return res.json({ type: 'notes', results: noteResults, query: q });
    }

    const results = queryAll(
      `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name
       FROM accounts a
       LEFT JOIN users u ON a.assigned_rep_id = u.id
       WHERE ${whereClause}
       ORDER BY a.shop_name ASC
       LIMIT 50`,
      params
    );

    res.json({
      type: 'accounts',
      results,
      query: q,
      filters: { rep: repName, status: statusFilter, city: cityFilter, dormant: isDormantQuery, sherwin: isSherwinQuery }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
