import { Router, Response } from 'express';
import { queryAll, queryOne, execute } from '../db';
import { authenticate } from '../middleware/auth';
import { logAudit } from '../middleware/audit';
import { AuthRequest } from '../types';

const router = Router();

// GET /api/accounts/:accountId/notes
router.get('/accounts/:accountId/notes', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const notes = queryAll(
      `SELECT n.*, u.first_name, u.last_name
       FROM notes n
       JOIN users u ON n.created_by_id = u.id
       WHERE n.account_id = ?
       ORDER BY n.created_at DESC`,
      [req.params.accountId]
    );
    res.json({ notes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/:accountId/notes
router.post('/accounts/:accountId/notes', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { content, is_voice_transcribed } = req.body;
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note content is required' });
    }

    const account = queryOne('SELECT id FROM accounts WHERE id = ? AND deleted_at IS NULL', [req.params.accountId]);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const { lastId } = execute(
      `INSERT INTO notes (account_id, created_by_id, content, is_voice_transcribed) VALUES (?, ?, ?, ?)`,
      [req.params.accountId, req.user!.userId, content.trim(), is_voice_transcribed ? 1 : 0]
    );

    // Update last_contacted_at on the account
    execute('UPDATE accounts SET last_contacted_at = datetime("now"), updated_at = datetime("now") WHERE id = ?', [req.params.accountId]);

    logAudit(req, 'note', lastId, 'create', { account_id: req.params.accountId });

    const note = queryOne(
      `SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id = u.id WHERE n.id = ?`,
      [lastId]
    );
    res.status(201).json({ note });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notes/:id
router.put('/notes/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Note content is required' });
    }

    const existing = queryOne('SELECT * FROM notes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    execute(
      'UPDATE notes SET content = ?, updated_at = datetime("now") WHERE id = ?',
      [content.trim(), req.params.id]
    );

    logAudit(req, 'note', parseInt(req.params.id), 'update', { content });
    const note = queryOne('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id = u.id WHERE n.id = ?', [req.params.id]);
    res.json({ note });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id
router.delete('/notes/:id', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const existing = queryOne('SELECT * FROM notes WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    execute('DELETE FROM notes WHERE id = ?', [req.params.id]);
    logAudit(req, 'note', parseInt(req.params.id), 'delete', {});
    res.json({ message: 'Note deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
