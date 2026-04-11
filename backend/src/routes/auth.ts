import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, queryAll, execute } from '../db';
import { generateToken, authenticate } from '../middleware/auth';
import { logAudit } from '../middleware/audit';
import { AuthRequest, User, JWTPayload } from '../types';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, first_name, last_name, role } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existing = queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const { lastId } = execute(
      `INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)`,
      [email, password_hash, first_name, last_name, role || 'rep']
    );

    logAudit(req, 'user', lastId, 'create', { email, first_name, last_name, role: role || 'rep' });

    const token = generateToken({ userId: lastId, email, role: role || 'rep' });
    res.status(201).json({
      token,
      user: { id: lastId, email, first_name, last_name, role: role || 'rep' }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = queryOne<User>('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    execute('UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);

    const token = generateToken({ userId: user.id, email: user.email, role: user.role });
    logAudit(req, 'user', user.id, 'login', {});

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  const user = queryOne<User>('SELECT id, email, first_name, last_name, role, last_login FROM users WHERE id = ?', [req.user!.userId]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

// GET /api/auth/users (managers/admins only)
router.get('/users', authenticate, (req: AuthRequest, res: Response) => {
  const users = queryAll('SELECT id, email, first_name, last_name, role, is_active, last_login, created_at FROM users ORDER BY first_name');
  res.json({ users });
});

export default router;
