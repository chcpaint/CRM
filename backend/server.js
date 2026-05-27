const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const { Resend } = require('resend');
const { z } = require('zod');
const { initDatabase, queryAll, queryOne, execute, getPool } = require('./src/db/init');
const { runGDriveImport } = require('./src/gdrive-import');

// ─── Validation schemas ───
// All fields optional so partial updates are allowed; types/constraints enforced.
const emailStr = z.string().trim().email().max(320);
const shortStr = (max) => z.string().trim().max(max);
const dateStr  = z.string().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'must be ISO date').nullable().optional();
const boolish  = z.union([z.boolean(), z.literal(0), z.literal(1), z.literal('true'), z.literal('false')]).transform(v => !!v && v !== 'false');
const intOrNull = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number), z.null()]).optional();
const numOrNull = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number), z.null()]).optional();

const accountUpdateSchema = z.object({
  shop_name: shortStr(200).optional(),
  address: shortStr(300).nullable().optional(),
  city: shortStr(100).nullable().optional(),
  area: shortStr(100).nullable().optional(),
  province: shortStr(10).nullable().optional(),
  contact_names: shortStr(500).nullable().optional(),
  phone: shortStr(50).nullable().optional(),
  phone2: shortStr(50).nullable().optional(),
  // email is a legacy field auto-derived from email_addresses on save;
  // many existing records hold comma-separated lists, so we accept any string here.
  email: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional(),
  account_type: z.enum(['collision', 'mechanical', 'dealership', 'restoration', 'other']).optional(),
  assigned_rep_id: intOrNull,
  secondary_rep_id: intOrNull,
  status: z.enum(['prospect', 'active', 'cold', 'dnc', 'churned', 'on_hold']).optional(),
  suppliers: shortStr(500).nullable().optional(),
  paint_line: shortStr(200).nullable().optional(),
  allied_products: shortStr(500).nullable().optional(),
  sundries: shortStr(500).nullable().optional(),
  has_contract: boolish.optional(),
  mpo: shortStr(100).nullable().optional(),
  num_techs: intOrNull,
  num_painters: intOrNull,
  num_body_men: intOrNull,
  num_paint_booths: intOrNull,
  sq_footage: shortStr(50).nullable().optional(),
  annual_revenue: numOrNull,
  former_sherwin_client: boolish.optional(),
  follow_up_date: dateStr,
  tags: z.array(z.string().max(50)).max(50).optional(),
  account_category: z.enum(['lead', 'customer', 'prospect', 'inactive']).optional(),
  branch: shortStr(100).nullable().optional(),
  postal_code: shortStr(20).nullable().optional(),
  cup_brand: shortStr(100).nullable().optional(),
  paper_brand: shortStr(100).nullable().optional(),
  filler_brand: shortStr(100).nullable().optional(),
  contract_status: shortStr(50).nullable().optional(),
  deal_details: shortStr(2000).nullable().optional(),
  banner: shortStr(100).nullable().optional(),
  business_types: z.array(z.string().max(50)).max(20).optional(),
  business_type_notes: shortStr(2000).nullable().optional(),
  contract_file_path: shortStr(500).nullable().optional(),
  contract_expiration_date: dateStr,
  phone_numbers: z.any().optional(),
  email_addresses: z.any().optional(),
  pcr_managed: boolish.optional(),
  pcr_shop_name: shortStr(200).nullable().optional(),
  skip_duplicate_check: boolish.optional(),
}).passthrough();

// ─── EMAIL (RESEND) ───
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'CHC CRM <noreply@chcpaint.com>';

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'refinish-ai-dev-secret-change-in-production';

// ─── Auth helpers ───
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Always fetch the current role from the DB so role changes take effect immediately
    // (the JWT may contain a stale role from login time)
    const freshUser = await queryOne('SELECT role FROM users WHERE id=$1 AND is_active=true', [decoded.userId]);
    if (!freshUser) return res.status(401).json({ error: 'User not found or deactivated' });
    req.user = { ...decoded, role: freshUser.role };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.status(500).json({ error: 'Authentication error' });
  }
}

async function logAudit(req, entityType, entityId, action, changes = {}) {
  try {
    await execute('INSERT INTO audit_log (user_id, entity_type, entity_id, action, changes, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user?.userId || null, entityType, entityId, action, JSON.stringify(changes), req.ip || 'unknown']);
  } catch (e) { console.error('Audit error:', e.message); }
}

// ─── Duplicate detection ───
function levenshtein(a, b) {
  const m = []; const al = a.length; const bl = b.length;
  if (!al) return bl; if (!bl) return al;
  for (let i = 0; i <= bl; i++) m[i] = [i];
  for (let j = 0; j <= al; j++) m[0][j] = j;
  for (let i = 1; i <= bl; i++)
    for (let j = 1; j <= al; j++)
      m[i][j] = b[i-1] === a[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[bl][al];
}

// Basic character-level similarity (kept for backward compat)
function similarity(a, b) {
  const al = a.toLowerCase().trim(); const bl = b.toLowerCase().trim();
  if (al === bl) return 1; const max = Math.max(al.length, bl.length);
  return max === 0 ? 1 : 1 - levenshtein(al, bl) / max;
}

// ─── IMPROVED duplicate scoring (multi-signal, token-aware) ───
// Common industry words that inflate Levenshtein scores for unrelated shops
const INDUSTRY_NOISE = new Set([
  'auto', 'body', 'collision', 'centre', 'center', 'paint', 'paints', 'painting',
  'repair', 'repairs', 'shop', 'shops', 'inc', 'ltd', 'llc', 'corp', 'the', 'and', '&', 'of',
  'service', 'services', 'automotive', 'refinish', 'refinishing', 'custom', 'pro', 'express',
  'motor', 'motors', 'garage', 'coachworks', 'autobody', 'car', 'cars', 'vehicle', 'vehicles',
  'supply', 'supplies', 'works', 'restoration', 'restorations', 'group', 'bodyshop',
]);

function normalizeForDupes(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[''`]/g, '')           // remove apostrophes
    .replace(/[^a-z0-9\s]/g, ' ')    // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(name) {
  return normalizeForDupes(name).split(' ').filter(Boolean);
}

// Simple stem: strip trailing 's' or 'es' for comparison
function simpleStem(word) {
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return word;
}

// Extract "meaningful" tokens (strip industry noise)
function meaningfulTokens(name) {
  return tokenize(name).filter(t => {
    if (t.length <= 1) return false;
    if (INDUSTRY_NOISE.has(t)) return false;
    if (INDUSTRY_NOISE.has(simpleStem(t))) return false;
    return true;
  });
}

// Jaccard similarity on word tokens
function tokenJaccard(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// Multi-signal duplicate score: combines name, phone, city, contacts
function duplicateScore(a, b) {
  const signals = [];
  let reason = [];

  // 1. Full name Levenshtein similarity
  const fullSim = similarity(a.shop_name || '', b.shop_name || '');

  // 2. Meaningful token Jaccard (ignoring industry noise)
  const aMeaningful = meaningfulTokens(a.shop_name || '');
  const bMeaningful = meaningfulTokens(b.shop_name || '');

  let meaningfulSim = 0;
  if (aMeaningful.length === 0 && bMeaningful.length === 0) {
    meaningfulSim = fullSim;
  } else if (aMeaningful.length === 0 || bMeaningful.length === 0) {
    meaningfulSim = 0;
  } else {
    // Check each meaningful token for close matches (handles typos + plurals)
    const aSet = new Set(aMeaningful);
    const bSet = new Set(bMeaningful);
    let matched = 0;
    for (const ta of aSet) {
      for (const tb of bSet) {
        if (ta === tb || simpleStem(ta) === simpleStem(tb) || similarity(ta, tb) >= 0.8) { matched++; break; }
      }
    }
    meaningfulSim = matched / Math.max(aSet.size, bSet.size);
  }

  // Weighted name score: meaningful tokens dominate
  const nameScore = meaningfulSim * 0.7 + fullSim * 0.3;
  signals.push(nameScore);
  if (nameScore > 0.6) reason.push(`name ${(nameScore * 100).toFixed(0)}%`);

  // 3. Phone match (strong signal)
  const aPhone = (a.phone || '').replace(/\D/g, '').slice(-10);
  const bPhone = (b.phone || '').replace(/\D/g, '').slice(-10);
  if (aPhone.length >= 7 && bPhone.length >= 7) {
    if (aPhone === bPhone) {
      signals.push(1.0);
      reason.push('phone match');
    } else {
      signals.push(0);
    }
  }

  // 4. City match (weak signal, boosts confidence)
  if (a.city && b.city) {
    const citySim = similarity(a.city, b.city);
    if (citySim > 0.85) {
      signals.push(0.8);
      reason.push('same city');
    } else {
      signals.push(0.1);
    }
  }

  // 5. Contact name overlap
  const aContacts = normalizeForDupes(a.contact_names || '');
  const bContacts = normalizeForDupes(b.contact_names || '');
  if (aContacts.length > 2 && bContacts.length > 2) {
    const contactSim = similarity(aContacts, bContacts);
    if (contactSim > 0.6) {
      signals.push(0.9);
      reason.push('contacts overlap');
    }
  }

  // 6. Email match
  const aEmail = (a.email || '').toLowerCase().trim();
  const bEmail = (b.email || '').toLowerCase().trim();
  if (aEmail && bEmail && aEmail === bEmail) {
    signals.push(1.0);
    reason.push('email match');
  }

  // Final composite score — name is required baseline, other signals boost
  const baseScore = nameScore;
  const boostSignals = signals.slice(1).filter(s => s > 0.5);
  const boost = boostSignals.length > 0
    ? boostSignals.reduce((sum, s) => sum + s, 0) / boostSignals.length * 0.15
    : 0;

  const finalScore = Math.min(baseScore + boost, 1.0);
  return { score: finalScore, reason: reason.join(', '), nameScore, meaningfulSim, fullSim };
}

async function findDuplicates(shopName, city, threshold = 0.85, excludeId) {
  let sql = 'SELECT * FROM accounts WHERE deleted_at IS NULL';
  const params = [];
  if (excludeId) { sql += ' AND id != $1'; params.push(excludeId); }
  const all = await queryAll(sql, params);
  const matches = [];
  const source = { shop_name: shopName, city: city || null };
  for (const a of all) {
    const result = duplicateScore(source, { shop_name: a.shop_name, city: a.city, phone: a.phone, email: a.email, contact_names: a.contact_names });
    if (result.score >= threshold) matches.push({ account: a, score: result.score, reason: result.reason });
  }
  return matches.sort((a, b) => b.score - a.score);
}

async function autoSeed() {
  const count = await queryOne('SELECT COUNT(*) as count FROM users');
  if (!count || parseInt(count.count) === 0) {
    console.log('Empty database detected — running auto-seed...');
    const seedData = require('./src/db/seed-data.json');

    const adminHash = await bcrypt.hash('admin123', 12);
    const repHash = await bcrypt.hash('rep123', 12);

    await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
      ['adam@chcpaint.com', adminHash, 'Adam', 'Berube', 'admin']);
    const { lastId: michelleId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
      ['michelle@chcpaint.com', repHash, 'Michelle', 'Rep', 'rep']);
    const { lastId: benId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
      ['ben@chcpaint.com', repHash, 'Ben', 'Halliday', 'rep']);

    let total = 0;
    for (const row of (seedData['Michelles Accounts'] || [])) {
      if (!row['Shop Name']) continue;
      const { lastId } = await execute('INSERT INTO accounts (shop_name,city,assigned_rep_id,status,former_sherwin_client,tags) VALUES ($1,$2,$3,$4,$5,$6)',
        [row['Shop Name'], row['City/Area']||null, michelleId, 'prospect', row['Former Sherwin Client? Y/N']==='Y', '[]']);
      if (row['Notes']) await execute('INSERT INTO notes (account_id,created_by_id,content) VALUES ($1,$2,$3)', [lastId, michelleId, '[Imported] '+row['Notes']]);
      total++;
    }
    for (const row of (seedData['Bens Accounts'] || [])) {
      if (!row['Shop Name']) continue;
      await execute('INSERT INTO accounts (shop_name,city,assigned_rep_id,status,tags) VALUES ($1,$2,$3,$4,$5)', [row['Shop Name'], row['City/Area']||null, benId, 'prospect', '[]']);
      total++;
    }
    for (const row of (seedData['Joint Accounts'] || [])) {
      if (!row['Shop Name']) continue;
      await execute('INSERT INTO accounts (shop_name,address,city,contact_names,suppliers,paint_line,sundries,has_contract,mpo,num_techs,sq_footage,status,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [row['Shop Name'],row['Address']||null,row['City/Area']||null,row['Contact(s)']||null,row['Supplier(s)']||null,row['Paint']||null,row['Sundries']||null,row['Contract? Y/N']==='Y',row['MPO']||null,row['# of Techs']?parseInt(row['# of Techs']):null,row['Shop Sq. Footage']||null,'active','[]']);
      total++;
    }
    for (const row of (seedData['Cold'] || [])) {
      if (!row['Shop Name']) continue;
      const { lastId } = await execute('INSERT INTO accounts (shop_name,address,city,status,tags) VALUES ($1,$2,$3,$4,$5)', [row['Shop Name'],row['Address']||null,row['City']||null,'cold','[]']);
      if (row['Reason']) await execute('INSERT INTO notes (account_id,created_by_id,content) VALUES ($1,$2,$3)', [lastId, benId, '[Cold - Reason] '+row['Reason']]);
      total++;
    }
    for (const row of (seedData['DNC Request'] || [])) {
      if (!row['Shop Name']) continue;
      const rep = (row['Rep Pursuing']||'').toLowerCase().includes('michelle') ? michelleId : benId;
      const { lastId } = await execute('INSERT INTO accounts (shop_name,city,assigned_rep_id,status,tags) VALUES ($1,$2,$3,$4,$5)', [row['Shop Name'],row['City/Area']||null,rep,'dnc','[]']);
      if (row['Notes']) await execute('INSERT INTO notes (account_id,created_by_id,content) VALUES ($1,$2,$3)', [lastId, rep, '[DNC - Reason] '+row['Notes']]);
      total++;
    }
    console.log(`Auto-seed complete: 3 users, ${total} accounts imported`);
  }
}

async function startServer() {
  await initDatabase();
  await autoSeed();
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(compression());
  // CORS: in production require an explicit allow-list via CORS_ORIGIN (comma-separated).
  // Never fall through to `true` (reflect any origin) in production.
  let corsOrigin;
  if (process.env.NODE_ENV === 'production') {
    const raw = process.env.CORS_ORIGIN;
    if (!raw) {
      console.warn('[SECURITY] CORS_ORIGIN not set in production — rejecting all cross-origin requests.');
      corsOrigin = false;
    } else {
      const allowList = raw.split(',').map(s => s.trim()).filter(Boolean);
      corsOrigin = (origin, cb) => {
        // Same-origin / server-to-server requests have no Origin header — allow them.
        if (!origin) return cb(null, true);
        if (allowList.includes(origin)) return cb(null, true);
        return cb(new Error('CORS: origin not allowed'));
      };
    }
  } else {
    corsOrigin = 'http://localhost:5173';
  }
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Too many attempts' } });
  app.use('/api/auth/login', authLimiter);

  // ─── AUTH ROUTES ───
  app.post('/api/auth/register', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Admin or manager access required to create users' });
      const { email, password, first_name, last_name, role } = req.body;
      if (!email || !password || !first_name || !last_name) return res.status(400).json({ error: 'All fields required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      // Managers can only create reps, not other managers or admins
      if (req.user.role === 'manager' && role !== 'rep') return res.status(403).json({ error: 'Managers can only create sales rep accounts' });
      if (await queryOne('SELECT id FROM users WHERE email = $1', [email])) return res.status(409).json({ error: 'Email already exists' });
      const validRole = ['rep', 'manager', 'admin'].includes(role) ? role : 'rep';
      const hash = await bcrypt.hash(password, 12);
      const { lastId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
        [email, hash, first_name, last_name, validRole]);
      await logAudit(req, 'user', lastId, 'create', { email, role: validRole, created_by: req.user.email });
      res.status(201).json({ user: { id: lastId, email, first_name, last_name, role: validRole } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await queryOne('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
      if (!user || !(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ error: 'Invalid credentials' });
      await execute('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
      await logAudit(req, 'user', user.id, 'login', {});
      res.json({ token: generateToken({ userId: user.id, email: user.email, role: user.role }),
        user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/auth/me', authenticate, async (req, res) => {
    const u = await queryOne('SELECT id,email,first_name,last_name,role FROM users WHERE id=$1', [req.user.userId]);
    res.json({ user: u });
  });

  app.get('/api/auth/users', authenticate, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Admin or manager access required' });
    }
    res.json({ users: await queryAll('SELECT id,email,first_name,last_name,role,is_active,last_login,created_at FROM users ORDER BY first_name') });
  });

  // ─── ADMIN: Reset user password ───
  app.put('/api/auth/users/:id/reset-password', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { password } = req.body;
      if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const target = await queryOne('SELECT id, email, first_name, last_name FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const hash = await bcrypt.hash(password, 12);
      await execute('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.params.id]);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', { action: 'password_reset', target_email: target.email });
      res.json({ message: `Password reset for ${target.first_name} ${target.last_name}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN: Revoke / restore user access ───
  app.put('/api/auth/users/:id/toggle-active', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      if (parseInt(req.params.id) === req.user.userId) return res.status(400).json({ error: 'Cannot deactivate yourself' });
      const target = await queryOne('SELECT id, email, first_name, last_name, is_active FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const newStatus = !target.is_active;
      await execute('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [newStatus, req.params.id]);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', { action: newStatus ? 'restore_access' : 'revoke_access', target_email: target.email });
      res.json({ message: `${target.first_name} ${target.last_name} is now ${newStatus ? 'active' : 'deactivated'}`, is_active: newStatus });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN: Change user role ───
  app.put('/api/auth/users/:id/role', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { role } = req.body;
      if (!['rep', 'manager', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role. Must be rep, manager, or admin' });
      if (parseInt(req.params.id) === req.user.userId) return res.status(400).json({ error: 'Cannot change your own role' });
      const target = await queryOne('SELECT id, email, first_name, last_name, role FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      await execute('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, req.params.id]);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', { action: 'role_change', from: target.role, to: role, target_email: target.email });
      res.json({ message: `${target.first_name} ${target.last_name} role changed to ${role}`, role });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN: Update user details ───
  app.put('/api/auth/users/:id', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { first_name, last_name, email } = req.body;
      const target = await queryOne('SELECT * FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const updates = ['updated_at = NOW()']; const params = []; let idx = 1;
      const changes = {};
      if (first_name) { updates.push(`first_name = $${idx++}`); params.push(first_name); changes.first_name = { from: target.first_name, to: first_name }; }
      if (last_name) { updates.push(`last_name = $${idx++}`); params.push(last_name); changes.last_name = { from: target.last_name, to: last_name }; }
      if (email) {
        const existing = await queryOne('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.params.id]);
        if (existing) return res.status(409).json({ error: 'Email already in use' });
        updates.push(`email = $${idx++}`); params.push(email); changes.email = { from: target.email, to: email };
      }
      params.push(req.params.id);
      await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', changes);
      const updated = await queryOne('SELECT id,email,first_name,last_name,role,is_active,last_login,created_at FROM users WHERE id=$1', [req.params.id]);
      res.json({ user: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ACCOUNTS ROUTES ───
  app.get('/api/accounts', authenticate, async (req, res) => {
    try {
      const { status, assigned_rep_id, city, search, category, branch, my_accounts, page = '1', limit = '50' } = req.query;
      const pg = parseInt(page); const lim = parseInt(limit); const off = (pg-1)*lim;
      let where = ['a.deleted_at IS NULL']; let params = []; let idx = 1;
      if (category) { where.push(`a.account_category = $${idx++}`); params.push(category); }
      if (branch) { where.push(`a.branch ILIKE $${idx++}`); params.push(`%${branch}%`); }
      if (status) { where.push(`a.status = $${idx++}`); params.push(status); }
      // Filter to accounts where user is primary OR secondary rep
      if (my_accounts === 'true') {
        where.push(`(a.assigned_rep_id = $${idx} OR a.secondary_rep_id = $${idx+1})`);
        params.push(req.user.userId, req.user.userId); idx += 2;
      } else if (assigned_rep_id) { where.push(`a.assigned_rep_id = $${idx++}`); params.push(assigned_rep_id); }
      if (city) { where.push(`a.city ILIKE $${idx++}`); params.push(`%${city}%`); }
      if (search) {
        where.push(`(a.shop_name ILIKE $${idx} OR a.contact_names ILIKE $${idx+1} OR a.city ILIKE $${idx+2} OR a.email ILIKE $${idx+3} OR a.phone ILIKE $${idx+4} OR a.branch ILIKE $${idx+5} OR a.address ILIKE $${idx+6} OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $${idx+7})`);
        const s = `%${search}%`; params.push(s,s,s,s,s,s,s,s); idx += 8;
      }
      const w = 'WHERE ' + where.join(' AND ');
      const joinClause = 'LEFT JOIN users u ON a.assigned_rep_id=u.id';
      const total = await queryOne(`SELECT COUNT(*) as total FROM accounts a ${joinClause} ${w}`, params);
      const accounts = await queryAll(
        `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a ${joinClause} ${w} ORDER BY a.shop_name LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, lim, off]);
      res.json({ accounts, pagination: { page: pg, limit: lim, total: parseInt(total?.total) || 0, totalPages: Math.ceil((parseInt(total?.total)||0)/lim) } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/accounts/export/csv', authenticate, async (req, res) => {
    // Bulk export of the entire account book is privileged — admins/managers only.
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Admin or manager access required' });
    }
    await logAudit(req, 'account', 0, 'export_csv', { count: 'all' });
    const accounts = await queryAll('SELECT a.*, u.first_name as rfn, u.last_name as rln FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL ORDER BY a.shop_name');
    const hdr = 'Shop Name,City,Contact,Phone,Email,Status,Rep\n';
    const rows = accounts.map(a => `"${a.shop_name}","${a.city||''}","${a.contact_names||''}","${a.phone||''}","${a.email||''}","${a.status}","${a.rfn||''} ${a.rln||''}"`).join('\n');
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=accounts.csv');
    res.send(hdr + rows);
  });

  app.get('/api/accounts/:id', authenticate, async (req, res) => {
    try {
      const account = await queryOne('SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name, u2.first_name as secondary_rep_first_name, u2.last_name as secondary_rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id LEFT JOIN users u2 ON a.secondary_rep_id=u2.id WHERE a.id=$1 AND a.deleted_at IS NULL', [req.params.id]);
      if (!account) return res.status(404).json({ error: 'Not found' });
      // Reps can only view accounts they are assigned to (primary or secondary).
      // Managers and admins see everything.
      if (req.user.role === 'rep') {
        const uid = req.user.userId;
        if (account.assigned_rep_id !== uid && account.secondary_rep_id !== uid) {
          return res.status(403).json({ error: 'You do not have access to this account' });
        }
      }
      const notes = await queryAll('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id=u.id WHERE n.account_id=$1 ORDER BY n.created_at DESC', [req.params.id]);
      // Reps see only their own activities; managers/admins see all
      const isRep = req.user.role === 'rep';
      const activities = isRep
        ? await queryAll('SELECT act.*, u.first_name, u.last_name FROM activities act JOIN users u ON act.rep_id=u.id WHERE act.account_id=$1 AND act.rep_id=$2 ORDER BY act.created_at DESC LIMIT 20', [req.params.id, req.user.userId])
        : await queryAll('SELECT act.*, u.first_name, u.last_name FROM activities act JOIN users u ON act.rep_id=u.id WHERE act.account_id=$1 ORDER BY act.created_at DESC LIMIT 20', [req.params.id]);
      res.json({ account, notes, activities });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/accounts/check-duplicate', authenticate, async (req, res) => {
    const dupes = await findDuplicates(req.body.shop_name, req.body.city, 0.80, req.body.exclude_id);
    res.json({ hasDuplicates: dupes.length > 0, duplicates: dupes.map(d => ({
      id: d.account.id, shop_name: d.account.shop_name, city: d.account.city, status: d.account.status, score: d.score
    }))});
  });

  app.post('/api/accounts', authenticate, async (req, res) => {
    try {
      const b = req.body;
      if (!b.shop_name) return res.status(400).json({ error: 'shop_name required' });
      // Auto-assign the creating user as the rep if not explicitly set
      if (!b.assigned_rep_id) b.assigned_rep_id = req.user.userId;
      if (!b.skip_duplicate_check) {
        const dupes = await findDuplicates(b.shop_name, b.city);
        if (dupes.length > 0) return res.status(409).json({ error: 'Potential duplicate', duplicates: dupes.map(d => ({
          id: d.account.id, shop_name: d.account.shop_name, city: d.account.city, status: d.account.status, score: d.score }))});
      }
      const { lastId } = await execute(
        `INSERT INTO accounts (shop_name,address,city,area,province,contact_names,phone,email,account_type,assigned_rep_id,status,suppliers,paint_line,allied_products,sundries,has_contract,mpo,num_techs,sq_footage,annual_revenue,former_sherwin_client,follow_up_date,tags,account_category,branch,postal_code,phone2) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [b.shop_name,b.address||null,b.city||null,b.area||null,b.province||'ON',b.contact_names||null,b.phone||null,b.email||null,b.account_type||'collision',b.assigned_rep_id||null,b.status||'prospect',b.suppliers||null,b.paint_line||null,b.allied_products||null,b.sundries||null,b.has_contract?true:false,b.mpo||null,b.num_techs||null,b.sq_footage||null,b.annual_revenue||null,b.former_sherwin_client?true:false,b.follow_up_date||null,JSON.stringify(b.tags||[]),b.account_category||'lead',b.branch||null,b.postal_code||null,b.phone2||null]);
      await logAudit(req, 'account', lastId, 'create', { shop_name: b.shop_name });
      res.status(201).json({ account: await queryOne('SELECT * FROM accounts WHERE id=$1', [lastId]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/accounts/:id', authenticate, async (req, res) => {
    try {
      // Validate shape + reject oversized/malformed fields before hitting the DB.
      const parsed = accountUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues.slice(0, 5).map(i => ({ path: i.path.join('.'), message: i.message })) });
      }
      req.body = { ...req.body, ...parsed.data };
      const existing = await queryOne('SELECT * FROM accounts WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      // Reps can only modify accounts they are assigned to.
      if (req.user.role === 'rep') {
        const uid = req.user.userId;
        if (existing.assigned_rep_id !== uid && existing.secondary_rep_id !== uid) {
          return res.status(403).json({ error: 'You do not have access to this account' });
        }
      }

      // ─── PCR Guard: prevent manual promotion to Active Customer ───
      // Active customers are controlled by the AccountEdge/PCR file.
      // Staff must be warned that only shops in the PCR report become active.
      const isPromotingToActive = (
        (req.body.status === 'active' && existing.status !== 'active') ||
        (req.body.account_category === 'customer' && existing.account_category !== 'customer')
      );
      if (isPromotingToActive && existing.pcr_managed !== true) {
        // Check if a PCR shop exists with a matching name
        const pcrMatch = await queryOne(
          "SELECT shop_name, branch FROM pcr_shop_list WHERE LOWER(shop_name) = LOWER($1) LIMIT 1",
          [existing.shop_name]
        );
        if (!pcrMatch) {
          return res.status(400).json({
            error: 'pcr_required',
            message: 'Active customers and clients are managed through the AccountEdge/PCR file. This shop is not in the PCR report. Only shops that appear in the PCR data from AccountEdge can be set to Active Customer status. If this shop should be active, it needs to be added in AccountEdge first — the PCR sync will then bring it into the CRM as an active customer automatically.',
            shop_name: existing.shop_name
          });
        }
      }

      const fields = ['shop_name','address','city','area','province','contact_names','phone','email','account_type','assigned_rep_id','status','suppliers','paint_line','allied_products','sundries','has_contract','mpo','num_techs','sq_footage','annual_revenue','former_sherwin_client','follow_up_date','tags','account_category','branch','postal_code','phone2','num_painters','num_body_men','num_paint_booths','cup_brand','paper_brand','filler_brand','contract_status','deal_details','banner','business_types','business_type_notes','contract_file_path','contract_expiration_date','secondary_rep_id','phone_numbers','email_addresses','pcr_managed','pcr_shop_name'];
      // Fix double-encoded JSON entries: strings that should be objects
      const fixJsonEncoding = (arr) => arr.map(item => {
        if (typeof item === 'string') { try { return JSON.parse(item); } catch { return null; } }
        return item;
      }).filter(item => item && typeof item === 'object');

      // If phone_numbers is provided, auto-sync the primary number into `phone` for backward compat
      if (req.body.phone_numbers) {
        try {
          let nums = typeof req.body.phone_numbers === 'string' ? JSON.parse(req.body.phone_numbers) : req.body.phone_numbers;
          if (Array.isArray(nums)) {
            nums = fixJsonEncoding(nums);
            const primary = nums.find(n => n.is_primary) || nums[0];
            if (primary) req.body.phone = primary.number;
            else req.body.phone = null;
            req.body.phone_numbers = JSON.stringify(nums);
          }
        } catch (e) { /* leave as-is */ }
      }
      // If email_addresses is provided, auto-sync the primary email into `email` for backward compat
      if (req.body.email_addresses) {
        try {
          let emails = typeof req.body.email_addresses === 'string' ? JSON.parse(req.body.email_addresses) : req.body.email_addresses;
          if (Array.isArray(emails)) {
            emails = fixJsonEncoding(emails);
            const primary = emails.find(e => e.is_primary) || emails[0];
            if (primary) req.body.email = primary.address;
            else req.body.email = null;
            req.body.email_addresses = JSON.stringify(emails);
          }
        } catch (e) { /* leave as-is */ }
      }
      const updates = ['updated_at = NOW()']; const params = []; const changes = {};
      let idx = 1;
      for (const f of fields) {
        if (req.body[f] !== undefined) {
          let v = req.body[f];
          if ((f === 'tags' || f === 'business_types') && Array.isArray(v)) v = JSON.stringify(v);
          if ((f === 'phone_numbers' || f === 'email_addresses') && Array.isArray(v)) v = JSON.stringify(v);
          if (f === 'has_contract' || f === 'former_sherwin_client') v = v ? true : false;
          updates.push(`${f} = $${idx++}`); params.push(v); changes[f] = { from: existing[f], to: v };
        }
      }
      params.push(req.params.id);
      await execute(`UPDATE accounts SET ${updates.join(', ')} WHERE id = $${idx}`, params);
      await logAudit(req, 'account', parseInt(req.params.id), 'update', changes);
      res.json({ account: await queryOne('SELECT * FROM accounts WHERE id=$1', [req.params.id]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/accounts/:id', authenticate, async (req, res) => {
    await execute('UPDATE accounts SET deleted_at = NOW() WHERE id = $1', [req.params.id]);
    await logAudit(req, 'account', parseInt(req.params.id), 'delete', {});
    res.json({ message: 'Deleted' });
  });

  // ─── Contract file upload ───
  const uploadsDir = path.join(__dirname, 'uploads', 'contracts');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const contractUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
      const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  });

  app.post('/api/accounts/:id/upload-contract', authenticate, contractUpload.single('contract'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid file type' });
      const filePath = `/uploads/contracts/${req.file.filename}`;
      await execute('UPDATE accounts SET contract_file_path = $1, updated_at = NOW() WHERE id = $2', [filePath, req.params.id]);
      await logAudit(req, 'account', parseInt(req.params.id), 'update', { contract_file_path: { from: null, to: filePath } });
      res.json({ file_path: filePath, filename: req.file.originalname });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Serve uploaded contract files
  app.get('/uploads/contracts/:filename', authenticate, (req, res) => {
    const filePath = path.join(uploadsDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  });

  // ─── COMPETITIVE MARKET INFO ───
  // Promo flyers, competitor price lists, scans. File bytes stored in Postgres
  // (bytea) so they survive Render deploys without a persistent disk.
  const cmiUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file
    fileFilter: (req, file, cb) => {
      const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.gif', '.tif', '.tiff'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  });

  // List all entries (no file bytes — just metadata)
  app.get('/api/competitive-market-info', authenticate, async (req, res) => {
    try {
      const rows = await queryAll(`
        SELECT c.id, c.title, c.notes, c.filename, c.mime_type, c.file_size,
               c.manufacturer, c.product_codes,
               c.created_at, c.updated_at, c.uploaded_by_id,
               u.first_name AS by_first_name, u.last_name AS by_last_name
        FROM competitive_market_info c
        LEFT JOIN users u ON c.uploaded_by_id = u.id
        ORDER BY c.created_at DESC
      `);
      res.json({ items: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Upload a new entry — multipart/form-data with `file` + `title` + optional `notes`
  app.post('/api/competitive-market-info', authenticate, cmiUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'File required (PDF or image, max 15MB)' });
      const title = (req.body.title || '').toString().trim();
      const notes = (req.body.notes || '').toString().trim() || null;
      const manufacturer = (req.body.manufacturer || '').toString().trim().slice(0, 200) || null;
      const productCodes = (req.body.product_codes || '').toString().trim().slice(0, 2000) || null;
      if (!title) return res.status(400).json({ error: 'Title required' });
      if (title.length > 200) return res.status(400).json({ error: 'Title too long (max 200 chars)' });

      const { lastId } = await execute(
        `INSERT INTO competitive_market_info (title, notes, filename, mime_type, file_size, file_data, uploaded_by_id, manufacturer, product_codes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [title, notes, req.file.originalname, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer, req.user.userId, manufacturer, productCodes]
      );
      await logAudit(req, 'competitive_market_info', lastId, 'create', { title, filename: req.file.originalname, size: req.file.size, manufacturer });
      res.status(201).json({ id: lastId, title, filename: req.file.originalname });
    } catch (e) {
      console.error('CMI upload error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Edit title / notes (uploader or admin/manager)
  app.patch('/api/competitive-market-info/:id', authenticate, async (req, res) => {
    try {
      const row = await queryOne('SELECT * FROM competitive_market_info WHERE id=$1', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      const isOwner = row.uploaded_by_id === req.user.userId;
      const isPriv = req.user.role === 'admin' || req.user.role === 'manager';
      if (!isOwner && !isPriv) return res.status(403).json({ error: 'You can only edit your own uploads' });

      const updates = ['updated_at = NOW()']; const params = []; let i = 1;
      const changes = {};
      if (typeof req.body.title === 'string') {
        const t = req.body.title.trim();
        if (!t) return res.status(400).json({ error: 'Title cannot be empty' });
        if (t.length > 200) return res.status(400).json({ error: 'Title too long' });
        updates.push(`title = $${i++}`); params.push(t); changes.title = { from: row.title, to: t };
      }
      if (req.body.notes !== undefined) {
        const n = req.body.notes === null ? null : String(req.body.notes).trim() || null;
        updates.push(`notes = $${i++}`); params.push(n); changes.notes = { from: row.notes, to: n };
      }
      if (req.body.manufacturer !== undefined) {
        const m = req.body.manufacturer === null ? null : String(req.body.manufacturer).trim().slice(0, 200) || null;
        updates.push(`manufacturer = $${i++}`); params.push(m); changes.manufacturer = { from: row.manufacturer, to: m };
      }
      if (req.body.product_codes !== undefined) {
        const p = req.body.product_codes === null ? null : String(req.body.product_codes).trim().slice(0, 2000) || null;
        updates.push(`product_codes = $${i++}`); params.push(p); changes.product_codes = { from: row.product_codes, to: p };
      }
      params.push(req.params.id);
      await execute(`UPDATE competitive_market_info SET ${updates.join(', ')} WHERE id = $${i}`, params);
      await logAudit(req, 'competitive_market_info', parseInt(req.params.id), 'update', changes);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Stream the file (inline so PDFs/images render in browser)
  app.get('/api/competitive-market-info/:id/file', authenticate, async (req, res) => {
    try {
      const row = await queryOne('SELECT filename, mime_type, file_data FROM competitive_market_info WHERE id=$1', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `${disposition}; filename="${row.filename.replace(/"/g, '')}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(row.file_data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Delete (uploader or admin/manager)
  app.delete('/api/competitive-market-info/:id', authenticate, async (req, res) => {
    try {
      const row = await queryOne('SELECT id, title, uploaded_by_id FROM competitive_market_info WHERE id=$1', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      const isOwner = row.uploaded_by_id === req.user.userId;
      const isPriv = req.user.role === 'admin' || req.user.role === 'manager';
      if (!isOwner && !isPriv) return res.status(403).json({ error: 'You can only delete your own uploads' });
      await execute('DELETE FROM competitive_market_info WHERE id=$1', [req.params.id]);
      await logAudit(req, 'competitive_market_info', parseInt(req.params.id), 'delete', { title: row.title });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/accounts/import', authenticate, async (req, res) => {
    try {
      const { accounts: data, skip_duplicates } = req.body;
      if (!Array.isArray(data)) return res.status(400).json({ error: 'accounts array required' });
      let imported = 0, skipped = 0, dupesList = [];
      for (const r of data) {
        if (!r.shop_name) { skipped++; continue; }
        const dupes = await findDuplicates(r.shop_name, r.city, 0.85);
        if (dupes.length > 0 && !skip_duplicates) { dupesList.push({ shop_name: r.shop_name, matchedWith: dupes[0].account.shop_name }); skipped++; continue; }
        await execute('INSERT INTO accounts (shop_name,address,city,contact_names,phone,email,status,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [r.shop_name,r.address||null,r.city||null,r.contact_names||null,r.phone||null,r.email||null,r.status||'prospect','[]']);
        imported++;
      }
      await logAudit(req, 'account', null, 'import', { imported, skipped });
      res.json({ imported, skipped, duplicates: dupesList, total: data.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── NOTES ROUTES ───
  app.get('/api/accounts/:id/notes', authenticate, async (req, res) => {
    res.json({ notes: await queryAll('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id=u.id WHERE n.account_id=$1 ORDER BY n.created_at DESC', [req.params.id]) });
  });

  app.post('/api/accounts/:id/notes', authenticate, async (req, res) => {
    try {
      if (!req.body.content?.trim()) return res.status(400).json({ error: 'Content required' });
      // Permission: managers/admins can post notes on any account.
      // Reps can only post on accounts where they are the assigned or secondary rep.
      // This prevents fellow sales team members from leaving notes on each other's clients.
      if (!isManagerOrAdmin(req.user)) {
        const acc = await queryOne(
          'SELECT assigned_rep_id, secondary_rep_id FROM accounts WHERE id = $1 AND deleted_at IS NULL',
          [req.params.id]
        );
        if (!acc) return res.status(404).json({ error: 'Account not found' });
        const uid = req.user.userId;
        if (acc.assigned_rep_id !== uid && acc.secondary_rep_id !== uid) {
          return res.status(403).json({ error: 'You can only add notes on accounts assigned to you' });
        }
      }
      const { lastId } = await execute('INSERT INTO notes (account_id, created_by_id, content, is_voice_transcribed) VALUES ($1,$2,$3,$4)',
        [req.params.id, req.user.userId, req.body.content.trim(), req.body.is_voice_transcribed ? true : false]);
      await execute('UPDATE accounts SET last_contacted_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id]);
      await logAudit(req, 'note', lastId, 'create', { account_id: req.params.id });
      res.status(201).json({ note: await queryOne('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id=u.id WHERE n.id=$1', [lastId]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── EDIT NOTE ───
  app.put('/api/notes/:id', authenticate, async (req, res) => {
    try {
      const note = await queryOne('SELECT * FROM notes WHERE id=$1', [req.params.id]);
      if (!note) return res.status(404).json({ error: 'Note not found' });
      // Only the original author can edit their own notes
      if (note.created_by_id !== req.user.userId) {
        return res.status(403).json({ error: 'You can only edit your own notes' });
      }
      if (!req.body.content?.trim()) return res.status(400).json({ error: 'Content required' });
      await execute('UPDATE notes SET content=$1, updated_at=NOW() WHERE id=$2', [req.body.content.trim(), req.params.id]);
      await logAudit(req, 'note', note.id, 'update', { account_id: note.account_id });
      res.json({ note: await queryOne('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id=u.id WHERE n.id=$1', [req.params.id]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ACTIVITIES ROUTES ───
  const VALID_ACTIVITY_TYPES = ['call','email','text','meeting','visit','sales_call','drop_in','contract_presentation','proposal','product_demo','vendor_partner_visit','other'];

  app.post('/api/accounts/:id/activities', authenticate, async (req, res) => {
    try {
      const actType = req.body.activity_type || 'other';
      if (!VALID_ACTIVITY_TYPES.includes(actType)) return res.status(400).json({ error: `Invalid activity type. Must be one of: ${VALID_ACTIVITY_TYPES.join(', ')}` });
      const { lastId } = await execute('INSERT INTO activities (account_id, rep_id, activity_type, description, completed_date) VALUES ($1,$2,$3,$4,NOW())',
        [req.params.id, req.user.userId, actType, req.body.description || null]);
      await execute('UPDATE accounts SET last_contacted_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id]);
      await logAudit(req, 'activity', lastId, 'create', { account_id: req.params.id, activity_type: actType });
      res.status(201).json({ activity: await queryOne('SELECT act.*, u.first_name, u.last_name FROM activities act JOIN users u ON act.rep_id=u.id WHERE act.id=$1', [lastId]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/activities/reminders', authenticate, async (req, res) => {
    const days = parseInt(req.query.days) || 14;
    const isRep = req.user.role === 'rep';
    let sql = `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL AND a.status IN ('prospect','active') AND (a.last_contacted_at IS NULL OR a.last_contacted_at < NOW() - ($1 || ' days')::INTERVAL)`;
    const params = [days];
    if (isRep) { sql += ' AND a.assigned_rep_id = $2'; params.push(req.user.userId); }
    sql += ' ORDER BY a.last_contacted_at ASC NULLS FIRST LIMIT 50';
    res.json({ dormant: await queryAll(sql, params) });
  });

  // ─── SALES ROUTES ───
  app.get('/api/sales', authenticate, async (req, res) => {
    try {
      const { month, rep_id, account_id, page = '1', limit = '50' } = req.query;
      const isRep = req.user.role === 'rep';
      const uid = req.user.userId;
      let where = []; let params = []; let idx = 1;

      // Reps can only see their own sales
      if (isRep) {
        where.push(`(s.rep_id = $${idx} OR LOWER(TRIM(s.salesperson)) = (SELECT LOWER(TRIM(first_name || ' ' || last_name)) FROM users WHERE id = $${idx}))`);
        params.push(uid);
        idx++;
      }

      if (month) { where.push(`s.month=$${idx++}`); params.push(month); }
      if (rep_id && !isRep) { where.push(`s.rep_id=$${idx++}`); params.push(rep_id); }
      if (account_id) { where.push(`s.account_id=$${idx++}`); params.push(account_id); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const lim = parseInt(limit);
      const pg = parseInt(page);
      const tot = await queryOne(`SELECT COUNT(*) as total FROM sales_data s ${w}`, params);
      const totalCount = parseInt(tot?.total) || 0;

      let sales;
      if (lim === 0) {
        // limit=0 means fetch all records (no pagination)
        sales = await queryAll(`SELECT s.*, a.shop_name, u.first_name as rep_first_name, u.last_name as rep_last_name FROM sales_data s LEFT JOIN accounts a ON s.account_id=a.id LEFT JOIN users u ON s.rep_id=u.id ${w} ORDER BY s.sale_date DESC`,
          params);
      } else {
        sales = await queryAll(`SELECT s.*, a.shop_name, u.first_name as rep_first_name, u.last_name as rep_last_name FROM sales_data s LEFT JOIN accounts a ON s.account_id=a.id LEFT JOIN users u ON s.rep_id=u.id ${w} ORDER BY s.sale_date DESC LIMIT $${idx++} OFFSET $${idx++}`,
          [...params, lim, (pg-1)*lim]);
      }
      res.json({ sales, pagination: { page: pg, limit: lim, total: totalCount } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sales/import', authenticate, async (req, res) => {
    try {
      const { records } = req.body;
      if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
      const allAccounts = await queryAll('SELECT id, shop_name FROM accounts WHERE deleted_at IS NULL');
      const allUsers = await queryAll('SELECT id, first_name, last_name FROM users WHERE is_active = true');
      // Build salesperson → user lookup (lowercase full name → id)
      const spLookup = {};
      for (const u of allUsers) {
        spLookup[(u.first_name + ' ' + u.last_name).toLowerCase().trim()] = u.id;
      }
      let imported = 0; const unmatched = [];
      for (const r of records) {
        const name = r.customer_name || r['Customer Name'] || r['Name'] || '';
        const amt = parseFloat(r.amount || r['Amount'] || r['Total'] || 0);
        const date = r.date || r['Invoice Date'] || r['Date'] || '';
        const memo = r.memo || r['Memo'] || r['Description'] || '';
        const itemName = r.item_name || '';
        const quantity = parseInt(r.quantity) || 0;
        const cogs = parseFloat(r.cogs) || 0;
        const profit = parseFloat(r.profit) || 0;
        const category = r.category || '';
        const productLine = r.product_line || '';
        const salesperson = r.salesperson || '';
        if (!name || !amt || !date) continue;
        let matchId = null, best = 0;
        for (const a of allAccounts) {
          const s = similarity(name, a.shop_name);
          if (s > best && s >= 0.80) { best = s; matchId = a.id; }
        }
        // Match salesperson to user id (prefer actual match, fallback to uploader)
        const repId = spLookup[salesperson.toLowerCase().trim()] || req.user.userId;
        const month = date.substring(0, 7);
        await execute('INSERT INTO sales_data (account_id,rep_id,sale_amount,sale_date,month,memo,customer_name,imported_from_accountedge,item_name,quantity,cogs,profit,category,product_line,salesperson) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [matchId, repId, amt, date, month, memo, name, true, itemName, quantity, cogs, profit, category, productLine, salesperson]);
        if (!matchId) unmatched.push({ customer_name: name, amount: amt, date });
        imported++;
      }
      await logAudit(req, 'sale', null, 'import', { imported, unmatched: unmatched.length });
      res.json({ imported, unmatched, total: records.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── CLEAR SALES DATA (admin only) ───
  app.delete('/api/sales/all', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const result = await queryOne('SELECT COUNT(*) as count FROM sales_data');
      const count = parseInt(result?.count) || 0;
      await execute('DELETE FROM sales_data');
      await logAudit(req, 'sale', null, 'delete', { action: 'clear_all_sales', records_deleted: count });
      res.json({ deleted: count, message: `All ${count} sales records have been deleted` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── SHOP TARGETS (from PCR sync) ───
  app.get('/api/sales/shop-targets', authenticate, async (req, res) => {
    try {
      const rows = await queryAll('SELECT shop_name, target, salesperson, install FROM pcr_shop_targets');
      res.json({ targets: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── SALES REVENUE SUMMARY (correct post-discount figures) ───
  app.get('/api/sales/revenue-summary', authenticate, async (req, res) => {
    try {
      const year = req.query.year || String(new Date().getFullYear());
      // If a specific month is passed (e.g. "04"), build YYYY-MM; otherwise use current calendar month
      const currentMonth = req.query.month
        ? `${year}-${req.query.month.padStart(2, '0')}`
        : new Date().toISOString().slice(0, 7); // e.g. "2026-04"
      const isRep = req.user.role === 'rep';
      const uid = req.user.userId;

      let rows;
      if (isRep) {
        // Rep only sees their own revenue
        rows = await queryAll(`
          WITH rep_items AS (
            SELECT s.salesperson, s.branch, s.month,
                   SUM(s.sale_amount) as sp_amount
            FROM sales_data s
            WHERE s.salesperson IS NOT NULL AND s.salesperson != ''
              AND s.sale_date >= $1 || '-01-01' AND s.sale_date <= $1 || '-12-31'
              AND (s.rep_id = $3 OR LOWER(TRIM(s.salesperson)) = (SELECT LOWER(TRIM(first_name || ' ' || last_name)) FROM users WHERE id = $3))
            GROUP BY s.salesperson, s.branch, s.month
          ),
          branch_items AS (
            SELECT month, branch, SUM(sale_amount) as branch_amount
            FROM sales_data
            WHERE branch IS NOT NULL
              AND sale_date >= $1 || '-01-01' AND sale_date <= $1 || '-12-31'
            GROUP BY month, branch
          ),
          branch_rev AS (
            SELECT month, branch_name as branch, SUM(revenue) as actual_revenue
            FROM branch_daily_revenue
            WHERE month >= $1 || '-01' AND month <= $1 || '-12'
            GROUP BY month, branch_name
          )
          SELECT ri.salesperson,
                 SUM(CASE WHEN bi.branch_amount > 0
                   THEN ri.sp_amount / bi.branch_amount * br.actual_revenue
                   ELSE ri.sp_amount END) as ytd_revenue,
                 SUM(CASE WHEN ri.month = $2 AND bi.branch_amount > 0
                   THEN ri.sp_amount / bi.branch_amount * br.actual_revenue
                   WHEN ri.month = $2
                   THEN ri.sp_amount
                   ELSE 0 END) as month_revenue
          FROM rep_items ri
          LEFT JOIN branch_items bi ON bi.month = ri.month AND bi.branch = ri.branch
          LEFT JOIN branch_rev br ON br.month = ri.month AND br.branch = ri.branch
          GROUP BY ri.salesperson
          ORDER BY ytd_revenue DESC
        `, [year, currentMonth, uid]);
      } else {
        // Admin/manager sees all salespersons
        rows = await queryAll(`
          WITH sp_items AS (
            SELECT s.salesperson, s.branch, s.month,
                   SUM(s.sale_amount) as sp_amount
            FROM sales_data s
            WHERE s.salesperson IS NOT NULL AND s.salesperson != ''
              AND s.sale_date >= $1 || '-01-01' AND s.sale_date <= $1 || '-12-31'
            GROUP BY s.salesperson, s.branch, s.month
          ),
          branch_items AS (
            SELECT month, branch, SUM(sale_amount) as branch_amount
            FROM sales_data
            WHERE branch IS NOT NULL
              AND sale_date >= $1 || '-01-01' AND sale_date <= $1 || '-12-31'
            GROUP BY month, branch
          ),
          branch_rev AS (
            SELECT month, branch_name as branch, SUM(revenue) as actual_revenue
            FROM branch_daily_revenue
            WHERE month >= $1 || '-01' AND month <= $1 || '-12'
            GROUP BY month, branch_name
          )
          SELECT sp.salesperson,
                 SUM(CASE WHEN bi.branch_amount > 0
                   THEN sp.sp_amount / bi.branch_amount * br.actual_revenue
                   ELSE sp.sp_amount END) as ytd_revenue,
                 SUM(CASE WHEN sp.month = $2 AND bi.branch_amount > 0
                   THEN sp.sp_amount / bi.branch_amount * br.actual_revenue
                   WHEN sp.month = $2
                   THEN sp.sp_amount
                   ELSE 0 END) as month_revenue
          FROM sp_items sp
          LEFT JOIN branch_items bi ON bi.month = sp.month AND bi.branch = sp.branch
          LEFT JOIN branch_rev br ON br.month = sp.month AND br.branch = sp.branch
          GROUP BY sp.salesperson
          ORDER BY ytd_revenue DESC
        `, [year, currentMonth]);
      }

      // Company totals from branch_daily_revenue (admins see full total, reps see their share)
      let companyTotals;
      if (isRep) {
        // For reps, "company" totals = their own totals (sum of the rows above)
        const ytd = rows.reduce((s, r) => s + (parseFloat(r.ytd_revenue) || 0), 0);
        const mo = rows.reduce((s, r) => s + (parseFloat(r.month_revenue) || 0), 0);
        companyTotals = { ytd_total: ytd, month_total: mo };
      } else {
        companyTotals = await queryOne(`
          SELECT
            COALESCE(SUM(CASE WHEN month >= $1 || '-01' AND month <= $1 || '-12' THEN revenue ELSE 0 END), 0) as ytd_total,
            COALESCE(SUM(CASE WHEN month = $2 THEN revenue ELSE 0 END), 0) as month_total
          FROM branch_daily_revenue
        `, [year, currentMonth]);
      }

      res.json({
        year,
        currentMonth,
        isRep,
        salespersons: rows.map(r => ({
          salesperson: r.salesperson,
          ytd_revenue: parseFloat(r.ytd_revenue) || 0,
          month_revenue: parseFloat(r.month_revenue) || 0
        })),
        company: {
          ytd_total: parseFloat(companyTotals?.ytd_total) || 0,
          month_total: parseFloat(companyTotals?.month_total) || 0
        }
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── DASHBOARD ───
  app.get('/api/sales/dashboard/metrics', authenticate, async (req, res) => {
    try {
      const isRep = req.user.role === 'rep';
      const uid = req.user.userId;

      const statusCounts = await queryAll(
        isRep
          ? 'SELECT status, COUNT(*) as count FROM accounts WHERE deleted_at IS NULL AND assigned_rep_id = $1 GROUP BY status'
          : 'SELECT status, COUNT(*) as count FROM accounts WHERE deleted_at IS NULL GROUP BY status',
        isRep ? [uid] : []);

      // Revenue uses branch_daily_revenue (post-discount invoice totals from intranet)
      // For reps: proportional share of branch revenue based on their line-item contribution
      // COUNT(DISTINCT memo) gives actual invoice count, not line-item count
      const monthlyRevenue = await queryAll(
        isRep
          ? `WITH rep_items AS (
               SELECT month, branch, SUM(sale_amount) as rep_amount, COUNT(DISTINCT memo) as inv_count
               FROM sales_data
               WHERE rep_id = $1
                  OR LOWER(TRIM(salesperson)) = (SELECT LOWER(TRIM(first_name || ' ' || last_name)) FROM users WHERE id = $1)
               GROUP BY month, branch
             ),
             branch_items AS (
               SELECT month, branch, SUM(sale_amount) as branch_amount
               FROM sales_data
               WHERE branch IS NOT NULL
               GROUP BY month, branch
             ),
             branch_rev AS (
               SELECT month, branch_name as branch, SUM(revenue) as actual_revenue
               FROM branch_daily_revenue
               GROUP BY month, branch_name
             )
             SELECT ri.month,
                    COALESCE(SUM(
                      CASE WHEN bi.branch_amount > 0
                        THEN ri.rep_amount / bi.branch_amount * br.actual_revenue
                        ELSE ri.rep_amount
                      END
                    ), 0) as total,
                    SUM(ri.inv_count) as count
             FROM rep_items ri
             LEFT JOIN branch_items bi ON bi.month = ri.month AND bi.branch = ri.branch
             LEFT JOIN branch_rev br ON br.month = ri.month AND br.branch = ri.branch
             GROUP BY ri.month ORDER BY ri.month DESC LIMIT 12`
          : `SELECT b.month, SUM(b.revenue) as total,
                    COALESCE((SELECT COUNT(DISTINCT memo) FROM sales_data s WHERE s.month = b.month), 0) as count
             FROM branch_daily_revenue b
             GROUP BY b.month ORDER BY b.month DESC LIMIT 12`,
        isRep ? [uid] : []);

      // Top accounts by revenue — uses proportional scaling against branch_daily_revenue for accuracy
      const topAccounts = await queryAll(
        isRep
          ? `WITH acct_items AS (
               SELECT s.customer_name, s.salesperson, s.branch, s.month,
                      SUM(s.sale_amount) as acct_amount, COUNT(DISTINCT s.memo) as inv_count
               FROM sales_data s
               WHERE (s.rep_id = $1
                  OR LOWER(TRIM(s.salesperson)) = (SELECT LOWER(TRIM(first_name || ' ' || last_name)) FROM users WHERE id = $1))
                 AND s.customer_name IS NOT NULL
               GROUP BY s.customer_name, s.salesperson, s.branch, s.month
             ),
             branch_items AS (
               SELECT month, branch, SUM(sale_amount) as branch_amount
               FROM sales_data WHERE branch IS NOT NULL
               GROUP BY month, branch
             ),
             branch_rev AS (
               SELECT month, branch_name as branch, SUM(revenue) as actual_revenue
               FROM branch_daily_revenue GROUP BY month, branch_name
             )
             SELECT ai.customer_name as shop_name, ai.salesperson,
                    SUM(CASE WHEN bi.branch_amount > 0
                      THEN ai.acct_amount / bi.branch_amount * br.actual_revenue
                      ELSE ai.acct_amount END) as total_revenue,
                    SUM(ai.inv_count) as sale_count
             FROM acct_items ai
             LEFT JOIN branch_items bi ON bi.month = ai.month AND bi.branch = ai.branch
             LEFT JOIN branch_rev br ON br.month = ai.month AND br.branch = ai.branch
             GROUP BY ai.customer_name, ai.salesperson
             ORDER BY total_revenue DESC LIMIT 15`
          : `WITH acct_items AS (
               SELECT s.customer_name, s.salesperson, s.branch, s.month,
                      SUM(s.sale_amount) as acct_amount, COUNT(DISTINCT s.memo) as inv_count
               FROM sales_data s WHERE s.customer_name IS NOT NULL
               GROUP BY s.customer_name, s.salesperson, s.branch, s.month
             ),
             branch_items AS (
               SELECT month, branch, SUM(sale_amount) as branch_amount
               FROM sales_data WHERE branch IS NOT NULL
               GROUP BY month, branch
             ),
             branch_rev AS (
               SELECT month, branch_name as branch, SUM(revenue) as actual_revenue
               FROM branch_daily_revenue GROUP BY month, branch_name
             )
             SELECT ai.customer_name as shop_name, ai.salesperson,
                    SUM(CASE WHEN bi.branch_amount > 0
                      THEN ai.acct_amount / bi.branch_amount * br.actual_revenue
                      ELSE ai.acct_amount END) as total_revenue,
                    SUM(ai.inv_count) as sale_count
             FROM acct_items ai
             LEFT JOIN branch_items bi ON bi.month = ai.month AND bi.branch = ai.branch
             LEFT JOIN branch_rev br ON br.month = ai.month AND br.branch = ai.branch
             GROUP BY ai.customer_name, ai.salesperson
             ORDER BY total_revenue DESC LIMIT 15`,
        isRep ? [uid] : []);

      // Combined feed: activities + notes, merged & sorted by date
      const recentActivities = await queryAll(
        isRep
          ? `(SELECT act.id, act.account_id, 'activity' AS entry_type, act.activity_type, act.description, act.created_at,
                    a.shop_name, u.first_name, u.last_name
               FROM activities act
               JOIN accounts a ON act.account_id=a.id
               JOIN users u ON act.rep_id=u.id
              WHERE act.rep_id=$1)
             UNION ALL
             (SELECT n.id, n.account_id, 'note' AS entry_type, NULL AS activity_type, n.content AS description, n.created_at,
                    a.shop_name, u.first_name, u.last_name
               FROM notes n
               JOIN accounts a ON n.account_id=a.id
               JOIN users u ON n.created_by_id=u.id
              WHERE n.created_by_id=$1)
             ORDER BY created_at DESC LIMIT 100`
          : `(SELECT act.id, act.account_id, 'activity' AS entry_type, act.activity_type, act.description, act.created_at,
                    a.shop_name, u.first_name, u.last_name
               FROM activities act
               JOIN accounts a ON act.account_id=a.id
               JOIN users u ON act.rep_id=u.id)
             UNION ALL
             (SELECT n.id, n.account_id, 'note' AS entry_type, NULL AS activity_type, n.content AS description, n.created_at,
                    a.shop_name, u.first_name, u.last_name
               FROM notes n
               JOIN accounts a ON n.account_id=a.id
               JOIN users u ON n.created_by_id=u.id)
             ORDER BY created_at DESC LIMIT 100`,
        isRep ? [uid] : []);

      const dormantCount = await queryOne(
        isRep
          ? "SELECT COUNT(*) as count FROM accounts WHERE deleted_at IS NULL AND status = 'active' AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '30 days') AND assigned_rep_id = $1"
          : "SELECT COUNT(*) as count FROM accounts WHERE deleted_at IS NULL AND status = 'active' AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '30 days')",
        isRep ? [uid] : []);

      res.json({
        statusCounts: statusCounts.map(r => ({ ...r, count: parseInt(r.count) })),
        monthlyRevenue: monthlyRevenue.reverse().map(r => ({ ...r, total: parseFloat(r.total), count: parseInt(r.count) })),
        topAccounts: topAccounts.map(r => ({ ...r, total_revenue: parseFloat(r.total_revenue), sale_count: parseInt(r.sale_count) })),
        recentActivities,
        dormantCount: parseInt(dormantCount?.count) || 0,
        totalAccounts: statusCounts.reduce((s, c) => s + parseInt(c.count), 0)
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── SEARCH ───
  app.post('/api/search', authenticate, async (req, res) => {
    try {
      const q = (req.body.query || '').toLowerCase().trim();
      if (!q) return res.status(400).json({ error: 'Query required' });

      let where = ['a.deleted_at IS NULL']; let params = []; let idx = 1;
      const repMatch = q.match(/(?:michelle|ben|adam)(?:'s)?/i);
      if (repMatch) { where.push(`u.first_name ILIKE $${idx++}`); params.push(`%${repMatch[0].replace("'s",'')}%`); }

      const statusMap = { prospect:'prospect', prospects:'prospect', active:'active', customers:'active', clients:'active', cold:'cold', dnc:'dnc', 'do not contact':'dnc', churned:'churned' };
      for (const [kw, st] of Object.entries(statusMap)) { if (q.includes(kw)) { where.push(`a.status=$${idx++}`); params.push(st); break; } }

      const cityMatch = q.match(/(?:in|from|near)\s+([a-z\s]+?)(?:\s|$)/i);
      if (cityMatch) { where.push(`a.city ILIKE $${idx++}`); params.push(`%${cityMatch[1].trim()}%`); }

      if (q.includes('sherwin')) where.push('a.former_sherwin_client = true');
      if (q.includes('dormant') || q.includes("haven't contacted") || q.includes('overdue')) {
        where.push("(a.last_contacted_at IS NULL OR a.last_contacted_at < NOW() - INTERVAL '14 days')");
        where.push("a.status IN ('prospect','active')");
      }

      if (q.includes('notes') || q.includes('note')) {
        const ns = q.replace(/notes?|on|about|for|show|me|find|get|what/gi, '').trim();
        const results = await queryAll('SELECT n.*, a.shop_name, u.first_name, u.last_name FROM notes n JOIN accounts a ON n.account_id=a.id JOIN users u ON n.created_by_id=u.id WHERE a.shop_name ILIKE $1 OR n.content ILIKE $2 ORDER BY n.created_at DESC LIMIT 20',
          [`%${ns}%`, `%${ns}%`]);
        return res.json({ type: 'notes', results, query: q });
      }

      if (where.length === 1) {
        const terms = q.replace(/show|me|find|all|the|get|list|search|for|who|what|which|where/gi, '').trim();
        if (terms) { where.push(`(a.shop_name ILIKE $${idx} OR a.contact_names ILIKE $${idx+1} OR a.city ILIKE $${idx+2})`); const t = `%${terms}%`; params.push(t,t,t); idx += 3; }
      }

      const results = await queryAll(`SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE ${where.join(' AND ')} ORDER BY a.shop_name LIMIT 50`, params);

      // If no account results found, also search sales_data for customer names
      // This catches customers like "Universal Auto" that exist in sales imports but not as accounts
      if (results.length === 0) {
        const salesTerms = q.replace(/show|me|find|all|the|get|list|search|for|who|what|which|where/gi, '').trim();
        if (salesTerms) {
          const salesResults = await queryAll(
            `WITH cust_items AS (
               SELECT s.customer_name, s.account_id, s.branch, s.month,
                      SUM(s.sale_amount) as cust_amount, COUNT(DISTINCT s.memo) as inv_count,
                      MAX(s.sale_date) as last_sale
               FROM sales_data s WHERE s.customer_name ILIKE $1
               GROUP BY s.customer_name, s.account_id, s.branch, s.month
             ),
             branch_items AS (
               SELECT month, branch, SUM(sale_amount) as branch_amount
               FROM sales_data WHERE branch IS NOT NULL GROUP BY month, branch
             ),
             branch_rev AS (
               SELECT month, branch_name as branch, SUM(revenue) as actual_revenue
               FROM branch_daily_revenue GROUP BY month, branch_name
             )
             SELECT ci.customer_name, ci.account_id,
                    SUM(CASE WHEN bi.branch_amount > 0
                      THEN ci.cust_amount / bi.branch_amount * br.actual_revenue
                      ELSE ci.cust_amount END) as total_revenue,
                    SUM(ci.inv_count) as sale_count,
                    MAX(ci.last_sale) as last_sale_date
             FROM cust_items ci
             LEFT JOIN branch_items bi ON bi.month = ci.month AND bi.branch = ci.branch
             LEFT JOIN branch_rev br ON br.month = ci.month AND br.branch = ci.branch
             GROUP BY ci.customer_name, ci.account_id
             ORDER BY total_revenue DESC LIMIT 20`,
            [`%${salesTerms}%`]
          );
          if (salesResults.length > 0) {
            return res.json({ type: 'sales_customers', results: salesResults.map(r => ({
              ...r,
              total_revenue: parseFloat(r.total_revenue),
              sale_count: parseInt(r.sale_count)
            })), query: q });
          }
        }
      }

      res.json({ type: 'accounts', results, query: q });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── NOTIFICATION ROUTES ───
  app.get('/api/notifications/settings', authenticate, async (req, res) => {
    try {
      const settings = await queryOne(
        'SELECT phone, notification_email, sms_enabled, email_enabled, daily_digest_time FROM users WHERE id=$1',
        [req.user.userId]
      );
      if (!settings) return res.status(404).json({ error: 'User not found' });
      res.json({ settings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/notifications/settings', authenticate, async (req, res) => {
    try {
      const { phone, notification_email, sms_enabled, email_enabled, daily_digest_time } = req.body;
      const updates = ['updated_at = NOW()'];
      const params = [];
      let idx = 1;

      if (phone !== undefined) { updates.push(`phone = $${idx++}`); params.push(phone || null); }
      if (notification_email !== undefined) { updates.push(`notification_email = $${idx++}`); params.push(notification_email || null); }
      if (sms_enabled !== undefined) { updates.push(`sms_enabled = $${idx++}`); params.push(sms_enabled ? true : false); }
      if (email_enabled !== undefined) { updates.push(`email_enabled = $${idx++}`); params.push(email_enabled ? true : false); }
      if (daily_digest_time !== undefined) { updates.push(`daily_digest_time = $${idx++}`); params.push(daily_digest_time || '07:30'); }

      params.push(req.user.userId);
      await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);

      const updated = await queryOne('SELECT phone, notification_email, sms_enabled, email_enabled, daily_digest_time FROM users WHERE id=$1', [req.user.userId]);
      res.json({ settings: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Helper function to generate daily digest
  async function generateDigestForUser(userId) {
    const user = await queryOne('SELECT * FROM users WHERE id=$1', [userId]);
    if (!user) return null;

    // Get follow-ups due today or overdue, with their latest follow-up note
    const dueFollowUps = await queryAll(
      `SELECT a.*, (
        SELECT n.content FROM notes n WHERE n.account_id = a.id AND n.content LIKE '[Follow-up%' ORDER BY n.created_at DESC LIMIT 1
      ) as follow_up_note
      FROM accounts a WHERE a.deleted_at IS NULL AND a.assigned_rep_id = $1 AND a.follow_up_date IS NOT NULL AND a.follow_up_date <= CURRENT_DATE ORDER BY a.follow_up_date ASC`,
      [userId]
    );

    // Get upcoming follow-ups (next 7 days)
    const upcomingFollowUps = await queryAll(
      `SELECT a.*, (
        SELECT n.content FROM notes n WHERE n.account_id = a.id AND n.content LIKE '[Follow-up%' ORDER BY n.created_at DESC LIMIT 1
      ) as follow_up_note
      FROM accounts a WHERE a.deleted_at IS NULL AND a.assigned_rep_id = $1 AND a.follow_up_date IS NOT NULL AND a.follow_up_date > CURRENT_DATE AND a.follow_up_date <= CURRENT_DATE + INTERVAL '7 days' ORDER BY a.follow_up_date ASC`,
      [userId]
    );

    // Get dormant accounts (no contact in 14+ days)
    const dormantAccounts = await queryAll(
      "SELECT a.* FROM accounts a WHERE a.deleted_at IS NULL AND a.assigned_rep_id = $1 AND a.status = 'active' AND (a.last_contacted_at IS NULL OR a.last_contacted_at < NOW() - INTERVAL '30 days') ORDER BY a.last_contacted_at ASC NULLS FIRST LIMIT 10",
      [userId]
    );

    // Get new notes from other team members in last 24 hours
    const newNotes = await queryAll(
      'SELECT n.*, a.shop_name, u.first_name, u.last_name FROM notes n JOIN accounts a ON n.account_id = a.id JOIN users u ON n.created_by_id = u.id WHERE a.assigned_rep_id = $1 AND n.created_by_id != $1 AND n.created_at > NOW() - INTERVAL \'30 days\' ORDER BY n.created_at DESC LIMIT 100',
      [userId]
    );

    return {
      user,
      dueFollowUps,
      upcomingFollowUps,
      dormantAccounts,
      newNotes
    };
  }

  // Manager summary emails — aggregates all reps into one digest
  const MANAGER_EMAILS = (process.env.MANAGER_DIGEST_EMAILS || 'frankc@chcpaint.com,manny@chcpaint.com,adam@chcpaint.com').split(',').map(e => e.trim()).filter(Boolean);

  async function generateManagerSummary() {
    const reps = await queryAll("SELECT id, first_name, last_name FROM users WHERE is_active = true AND role IN ('rep','manager') ORDER BY first_name");
    const repDigests = [];
    for (const rep of reps) {
      const digest = await generateDigestForUser(rep.id);
      if (digest) repDigests.push(digest);
    }
    return repDigests;
  }

  function buildManagerSummaryText(repDigests) {
    let text = `TEAM DAILY SUMMARY — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}\n\n`;
    let totalDue = 0, totalUpcoming = 0, totalDormant = 0, totalNotes = 0;

    for (const d of repDigests) {
      totalDue += d.dueFollowUps.length;
      totalUpcoming += d.upcomingFollowUps.length;
      totalDormant += d.dormantAccounts.length;
      totalNotes += d.newNotes.length;

      text += `── ${d.user.first_name} ${d.user.last_name} ──\n`;
      if (d.dueFollowUps.length > 0) {
        text += `  Due Today: ${d.dueFollowUps.length}\n`;
        d.dueFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          text += `    • ${a.shop_name}${note}\n`;
        });
      }
      if (d.upcomingFollowUps.length > 0) {
        text += `  Upcoming: ${d.upcomingFollowUps.length}\n`;
        d.upcomingFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          text += `    • ${a.shop_name} (${a.follow_up_date})${note}\n`;
        });
      }
      text += `  Dormant: ${d.dormantAccounts.length}  |  New Notes: ${d.newNotes.length}\n\n`;
    }

    text = `Team Totals: ${totalDue} due today, ${totalUpcoming} upcoming, ${totalDormant} dormant\n\n` + text;
    return text;
  }

  function buildManagerSummaryHtml(repDigests) {
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    let totalDue = 0, totalUpcoming = 0, totalDormant = 0, totalNotes = 0;
    for (const d of repDigests) {
      totalDue += d.dueFollowUps.length;
      totalUpcoming += d.upcomingFollowUps.length;
      totalDormant += d.dormantAccounts.length;
      totalNotes += d.newNotes.length;
    }

    let html = `<h2>Team Daily Summary — ${dateStr}</h2>`;
    html += `<p style="font-size:16px;"><strong>${totalDue}</strong> due today &nbsp;|&nbsp; <strong>${totalUpcoming}</strong> upcoming &nbsp;|&nbsp; <strong>${totalDormant}</strong> dormant &nbsp;|&nbsp; <strong>${totalNotes}</strong> new notes</p><hr/>`;

    for (const d of repDigests) {
      html += `<h3>${d.user.first_name} ${d.user.last_name}</h3>`;
      if (d.dueFollowUps.length > 0) {
        html += `<p><strong>Due Today (${d.dueFollowUps.length}):</strong></p><ul>`;
        d.dueFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          html += `<li><strong>${a.shop_name}</strong>${note}</li>`;
        });
        html += '</ul>';
      }
      if (d.upcomingFollowUps.length > 0) {
        html += `<p><strong>Upcoming This Week (${d.upcomingFollowUps.length}):</strong></p><ul>`;
        d.upcomingFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          html += `<li><strong>${a.shop_name}</strong> (${a.follow_up_date})${note}</li>`;
        });
        html += '</ul>';
      }
      html += `<p>Dormant: ${d.dormantAccounts.length} &nbsp;|&nbsp; New Notes: ${d.newNotes.length}</p><hr/>`;
    }
    return html;
  }

  async function sendManagerSummary() {
    if (!resend || MANAGER_EMAILS.length === 0) return;

    const repDigests = await generateManagerSummary();
    if (repDigests.length === 0) return;

    const htmlContent = buildManagerSummaryHtml(repDigests);
    const dateStr = new Date().toLocaleDateString();

    try {
      await resend.emails.send({
        from: EMAIL_FROM,
        to: MANAGER_EMAILS,
        subject: `Team Daily Summary — ${dateStr}`,
        html: htmlContent
      });
      console.log(`Manager summary sent to: ${MANAGER_EMAILS.join(', ')}`);
    } catch (e) {
      console.warn(`Manager summary email failed: ${e.message}`);
    }
  }

  app.post('/api/notifications/send-digest', authenticate, async (req, res) => {
    try {
      // Admin-only check
      const user = await queryOne('SELECT role FROM users WHERE id=$1', [req.user.userId]);
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      const { user_id } = req.body;
      const userIds = user_id ? [user_id] : (await queryAll('SELECT id FROM users WHERE is_active = true')).map(u => u.id);

      const results = [];
      for (const uid of userIds) {
        const digest = await generateDigestForUser(uid);
        if (!digest) continue;

        const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

        // Build digest message with follow-up details
        let digestText = `Daily Digest for ${digest.user.first_name}\n\n`;
        if (digest.dueFollowUps.length > 0) {
          digestText += `DUE TODAY (${digest.dueFollowUps.length}):\n`;
          digest.dueFollowUps.forEach(a => {
            digestText += `- ${a.shop_name}`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        if (digest.upcomingFollowUps.length > 0) {
          digestText += `UPCOMING THIS WEEK (${digest.upcomingFollowUps.length}):\n`;
          digest.upcomingFollowUps.forEach(a => {
            digestText += `- ${a.shop_name} (${a.follow_up_date})`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        digestText += `Dormant Accounts: ${digest.dormantAccounts.length}\nNew Notes: ${digest.newNotes.length}`;

        // Send SMS if enabled
        if (digest.user.sms_enabled && digest.user.phone && twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
          try {
            const twilio = require('twilio');
            const client = twilio(twilioAccountSid, twilioAuthToken);
            await client.messages.create({
              body: digestText,
              from: twilioPhoneNumber,
              to: digest.user.phone
            });
            results.push({ userId: uid, sms: 'sent' });
          } catch (e) {
            console.warn(`SMS send failed for user ${uid}: ${e.message}`);
            results.push({ userId: uid, sms: 'failed', error: e.message });
          }
        }

        // Send email via Resend
        if (digest.user.email_enabled && digest.user.notification_email && resend) {
          try {
            let htmlContent = `<h2>Daily Digest for ${digest.user.first_name}</h2>`;
            if (digest.dueFollowUps.length > 0) {
              htmlContent += `<h3>Due Today (${digest.dueFollowUps.length})</h3><ul>`;
              digest.dueFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong>${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            if (digest.upcomingFollowUps.length > 0) {
              htmlContent += `<h3>Upcoming This Week (${digest.upcomingFollowUps.length})</h3><ul>`;
              digest.upcomingFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong> (${a.follow_up_date})${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            htmlContent += `<p><strong>Dormant Accounts:</strong> ${digest.dormantAccounts.length}</p>
              <p><strong>New Notes from Team:</strong> ${digest.newNotes.length}</p>`;

            await resend.emails.send({
              from: EMAIL_FROM,
              to: digest.user.notification_email,
              subject: `Daily Digest - ${new Date().toLocaleDateString()}`,
              html: htmlContent
            });
            results.push({ userId: uid, email: 'sent' });
          } catch (e) {
            console.warn(`Email send failed for user ${uid}: ${e.message}`);
            results.push({ userId: uid, email: 'failed', error: e.message });
          }
        }
      }

      // Send manager summary after individual digests
      if (!user_id) {
        try { await sendManagerSummary(); results.push({ manager_summary: 'sent', to: MANAGER_EMAILS }); }
        catch (e) { results.push({ manager_summary: 'failed', error: e.message }); }
      }

      res.json({ message: 'Digest sent', results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/notifications/preview', authenticate, async (req, res) => {
    try {
      const digest = await generateDigestForUser(req.user.userId);
      if (!digest) return res.status(404).json({ error: 'Unable to generate digest' });

      res.json({
        preview: {
          dueFollowUps: digest.dueFollowUps.map(a => ({ id: a.id, shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note })),
          upcomingFollowUps: digest.upcomingFollowUps.map(a => ({ id: a.id, shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note })),
          dormantAccounts: digest.dormantAccounts.map(a => ({ id: a.id, shop_name: a.shop_name, last_contacted_at: a.last_contacted_at })),
          newNotes: digest.newNotes.map(n => ({ id: n.id, shop_name: n.shop_name, author: `${n.first_name} ${n.last_name}`, created_at: n.created_at, content: n.content.substring(0, 100) }))
        }
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Manager team digest — all reps combined
  app.get('/api/notifications/team-digest', authenticate, async (req, res) => {
    try {
      const currentUser = await queryOne('SELECT role FROM users WHERE id=$1', [req.user.userId]);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) {
        return res.status(403).json({ error: 'Manager or admin access required' });
      }

      const reps = await queryAll("SELECT id, first_name, last_name FROM users WHERE is_active = true ORDER BY first_name");
      const teamDigest = [];
      for (const rep of reps) {
        const digest = await generateDigestForUser(rep.id);
        if (digest) {
          teamDigest.push({
            rep: { id: rep.id, first_name: rep.first_name, last_name: rep.last_name },
            dueFollowUps: digest.dueFollowUps.map(a => ({ id: a.id, shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note })),
            upcomingFollowUps: digest.upcomingFollowUps.map(a => ({ id: a.id, shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note })),
            dormantCount: digest.dormantAccounts.length,
            newNotesCount: digest.newNotes.length
          });
        }
      }
      res.json({ teamDigest });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Export team report as printable HTML (managers/admins)
  app.get('/api/notifications/export-report', authenticate, async (req, res) => {
    try {
      const currentUser = await queryOne('SELECT role, first_name, last_name FROM users WHERE id=$1', [req.user.userId]);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'manager')) {
        return res.status(403).json({ error: 'Manager or admin access required' });
      }
      const reps = await queryAll("SELECT id, first_name, last_name FROM users WHERE is_active = true ORDER BY first_name");
      const teamDigest = [];
      for (const rep of reps) {
        const digest = await generateDigestForUser(rep.id);
        if (digest) {
          teamDigest.push({
            rep: { first_name: rep.first_name, last_name: rep.last_name },
            dueFollowUps: digest.dueFollowUps.map(a => ({ shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note, city: a.city })),
            upcomingFollowUps: digest.upcomingFollowUps.map(a => ({ shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note, city: a.city })),
            dormantCount: digest.dormantAccounts.length,
            dormantAccounts: digest.dormantAccounts.slice(0, 10).map(a => ({ shop_name: a.shop_name, last_contacted_at: a.last_contacted_at }))
          });
        }
      }
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const totalDue = teamDigest.reduce((s, r) => s + r.dueFollowUps.length, 0);
      const totalUpcoming = teamDigest.reduce((s, r) => s + r.upcomingFollowUps.length, 0);
      const totalDormant = teamDigest.reduce((s, r) => s + r.dormantCount, 0);
      let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CHC CRM Team Report — ${today}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2a3a;padding:24px;max-width:900px;margin:0 auto;font-size:13px}
        h1{font-size:20px;margin-bottom:4px}h2{font-size:15px;margin:18px 0 8px;padding-bottom:4px;border-bottom:2px solid #dc2626}h3{font-size:13px;margin:10px 0 4px;color:#486581}
        .subtitle{color:#627d98;font-size:12px;margin-bottom:16px}.stats{display:flex;gap:12px;margin:12px 0}.stat{background:#f8f9fa;border-radius:8px;padding:10px 16px;text-align:center;flex:1;border:1px solid #e2e8f0}
        .stat-num{font-size:22px;font-weight:700}.stat-num.red{color:#dc2626}.stat-num.blue{color:#2563eb}.stat-num.amber{color:#d97706}.stat-label{font-size:10px;text-transform:uppercase;color:#627d98;letter-spacing:0.5px}
        .rep-section{margin:14px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}.rep-header{background:#f0f4f8;padding:8px 12px;font-weight:700;display:flex;justify-content:space-between;align-items:center}
        .rep-badges span{font-size:11px;margin-left:8px}.due{color:#dc2626}.upcoming{color:#2563eb}.dormant{color:#d97706}
        table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;padding:4px 8px;background:#f8f9fa;border-bottom:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;color:#627d98}
        td{padding:5px 8px;border-bottom:1px solid #f0f4f8}.overdue{color:#dc2626;font-weight:600}
        .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;color:#829ab1;font-size:11px;text-align:center}
        @media print{body{padding:12px}@page{margin:0.5in}}
      </style></head><body>`;
      html += `<h1>CHC Paint & Auto Body — Team Report</h1><div class="subtitle">${today} &middot; Generated by ${currentUser.first_name} ${currentUser.last_name}</div>`;
      html += `<div class="stats"><div class="stat"><div class="stat-num red">${totalDue}</div><div class="stat-label">Due Today</div></div><div class="stat"><div class="stat-num blue">${totalUpcoming}</div><div class="stat-label">This Week</div></div><div class="stat"><div class="stat-num amber">${totalDormant}</div><div class="stat-label">Dormant</div></div></div>`;
      for (const rd of teamDigest) {
        html += `<div class="rep-section"><div class="rep-header"><span>${rd.rep.first_name} ${rd.rep.last_name}</span><div class="rep-badges">`;
        if (rd.dueFollowUps.length) html += `<span class="due">${rd.dueFollowUps.length} due</span>`;
        if (rd.upcomingFollowUps.length) html += `<span class="upcoming">${rd.upcomingFollowUps.length} upcoming</span>`;
        if (rd.dormantCount) html += `<span class="dormant">${rd.dormantCount} dormant</span>`;
        html += `</div></div>`;
        const allFollowUps = [...rd.dueFollowUps.map(f => ({...f, type: 'due'})), ...rd.upcomingFollowUps.map(f => ({...f, type: 'upcoming'}))];
        if (allFollowUps.length > 0) {
          html += `<table><thead><tr><th>Shop</th><th>Date</th><th>Notes</th></tr></thead><tbody>`;
          for (const f of allFollowUps) {
            const note = f.note ? f.note.replace(/^\[Follow-up[^\]]*\]\s*/, '') : '';
            const dateStr = new Date(f.follow_up_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            html += `<tr><td><strong>${f.shop_name}</strong></td><td class="${f.type === 'due' ? 'overdue' : ''}">${f.type === 'due' ? 'TODAY' : dateStr}</td><td>${note}</td></tr>`;
          }
          html += `</tbody></table>`;
        }
        if (rd.dormantAccounts.length > 0) {
          html += `<div style="padding:6px 8px"><h3>Dormant Accounts</h3><div style="font-size:11px;color:#627d98">`;
          html += rd.dormantAccounts.map(a => a.shop_name + (a.last_contacted_at ? ` (last: ${new Date(a.last_contacted_at).toLocaleDateString()})` : ' (never contacted)')).join(', ');
          html += `</div></div>`;
        }
        if (allFollowUps.length === 0 && rd.dormantCount === 0) {
          html += `<div style="padding:8px 12px;color:#829ab1;font-size:12px">No follow-ups or alerts</div>`;
        }
        html += `</div>`;
      }
      html += `<div class="footer">CHC CRM — Confidential &middot; Generated ${new Date().toLocaleString()}</div></body></html>`;
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── FOLLOW-UP ROUTES ───
  app.post('/api/accounts/:id/follow-up', authenticate, async (req, res) => {
    try {
      const { follow_up_date, follow_up_notes } = req.body;
      if (!follow_up_date) return res.status(400).json({ error: 'follow_up_date required' });

      // Update account with follow-up date
      await execute('UPDATE accounts SET follow_up_date = $1, updated_at = NOW() WHERE id = $2', [follow_up_date, req.params.id]);

      // Create note for follow-up
      const noteContent = `[Follow-up scheduled for ${follow_up_date}] ${follow_up_notes || ''}`;
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)', [req.params.id, req.user.userId, noteContent]);

      const account = await queryOne('SELECT * FROM accounts WHERE id=$1', [req.params.id]);
      res.json({ account });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── PATCH FOLLOW-UP (reschedule / update notes) ───
  app.patch('/api/accounts/:id/follow-up', authenticate, async (req, res) => {
    try {
      const accountId = req.params.id;
      const { follow_up_date, follow_up_notes } = req.body;
      if (!follow_up_date) return res.status(400).json({ error: 'follow_up_date required' });

      // Reps can only update their own accounts; admins/managers can update any
      if (req.user.role === 'rep') {
        const acct = await queryOne('SELECT assigned_rep_id FROM accounts WHERE id=$1 AND deleted_at IS NULL', [accountId]);
        if (!acct) return res.status(404).json({ error: 'Account not found' });
        if (acct.assigned_rep_id !== req.user.userId) {
          return res.status(403).json({ error: 'You can only update follow-ups on your own accounts' });
        }
      }

      // Update the follow-up date on the account
      await execute('UPDATE accounts SET follow_up_date = $1, updated_at = NOW() WHERE id = $2', [follow_up_date, accountId]);

      // Log the reschedule as a note
      const noteContent = `[Follow-up rescheduled to ${follow_up_date}] ${follow_up_notes || ''}`.trim();
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)', [accountId, req.user.userId, noteContent]);

      const account = await queryOne('SELECT id, shop_name, follow_up_date FROM accounts WHERE id=$1', [accountId]);
      res.json({ account });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── DELETE FOLLOW-UP (clear a follow-up) ───
  app.delete('/api/accounts/:id/follow-up', authenticate, async (req, res) => {
    try {
      const accountId = req.params.id;
      // Reps can only clear their own; admins/managers can clear any
      if (req.user.role === 'rep') {
        const acct = await queryOne('SELECT assigned_rep_id FROM accounts WHERE id=$1 AND deleted_at IS NULL', [accountId]);
        if (!acct) return res.status(404).json({ error: 'Account not found' });
        if (acct.assigned_rep_id !== req.user.userId) {
          return res.status(403).json({ error: 'You can only clear follow-ups on your own accounts' });
        }
      }
      await execute('UPDATE accounts SET follow_up_date = NULL, updated_at = NOW() WHERE id = $1', [accountId]);
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)',
        [accountId, req.user.userId, '[Follow-up cleared]']);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── VOICE FOLLOW-UP (quick create from voice command) ───
  app.post('/api/voice-follow-up', authenticate, async (req, res) => {
    try {
      const { account_name, follow_up_date, notes } = req.body;
      if (!account_name) return res.status(400).json({ error: 'account_name required' });
      if (!follow_up_date) return res.status(400).json({ error: 'follow_up_date required' });

      // Find account by name (case-insensitive, partial match)
      let account = await queryOne(
        'SELECT id, shop_name FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
        [account_name.trim()]
      );

      // If no exact match, try ILIKE partial match
      if (!account) {
        account = await queryOne(
          'SELECT id, shop_name FROM accounts WHERE shop_name ILIKE $1 AND deleted_at IS NULL ORDER BY shop_name LIMIT 1',
          [`%${account_name.trim()}%`]
        );
      }

      if (!account) {
        return res.status(404).json({ error: `Could not find account "${account_name}"` });
      }

      // Set follow-up date on account
      await execute('UPDATE accounts SET follow_up_date = $1, updated_at = NOW() WHERE id = $2', [follow_up_date, account.id]);

      // Create note for the follow-up
      const noteContent = `[Follow-up scheduled for ${follow_up_date}] ${notes || ''}`.trim();
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)', [account.id, req.user.userId, noteContent]);

      res.json({ success: true, account_id: account.id, shop_name: account.shop_name, follow_up_date, notes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/follow-ups', authenticate, async (req, res) => {
    try {
      const isRep = req.user.role === 'rep';
      let sql = 'SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL AND a.follow_up_date IS NOT NULL AND a.follow_up_date >= CURRENT_DATE';
      const params = [];

      if (isRep) {
        sql += ' AND a.assigned_rep_id = $1';
        params.push(req.user.userId);
      }

      sql += ' ORDER BY a.follow_up_date ASC LIMIT 50';
      const followUps = await queryAll(sql, params);
      res.json({ followUps });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/follow-ups/overdue', authenticate, async (req, res) => {
    try {
      const isRep = req.user.role === 'rep';
      let sql = 'SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL AND a.follow_up_date IS NOT NULL AND a.follow_up_date < CURRENT_DATE';
      const params = [];

      if (isRep) {
        sql += ' AND a.assigned_rep_id = $1';
        params.push(req.user.userId);
      }

      sql += ' ORDER BY a.follow_up_date ASC LIMIT 50';
      const overdue = await queryAll(sql, params);
      res.json({ overdue });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── CRON JOB FOR DAILY DIGEST ───
  const digestCron = process.env.DIGEST_CRON || '30 7 * * 1-5';
  cron.schedule(digestCron, async () => {
    console.log('Running daily digest...');
    try {
      const users = await queryAll('SELECT id FROM users WHERE is_active = true AND (sms_enabled = true OR email_enabled = true)');
      for (const user of users) {
        const digest = await generateDigestForUser(user.id);
        if (!digest) continue;

        const userData = digest.user;
        const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

        let digestText = `Daily Digest for ${userData.first_name}\n\n`;
        if (digest.dueFollowUps.length > 0) {
          digestText += `DUE TODAY (${digest.dueFollowUps.length}):\n`;
          digest.dueFollowUps.forEach(a => {
            digestText += `- ${a.shop_name}`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        if (digest.upcomingFollowUps.length > 0) {
          digestText += `UPCOMING THIS WEEK (${digest.upcomingFollowUps.length}):\n`;
          digest.upcomingFollowUps.forEach(a => {
            digestText += `- ${a.shop_name} (${a.follow_up_date})`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        digestText += `Dormant Accounts: ${digest.dormantAccounts.length}\nNew Notes: ${digest.newNotes.length}`;

        // Send SMS
        if (userData.sms_enabled && userData.phone && twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
          try {
            const twilio = require('twilio');
            const client = twilio(twilioAccountSid, twilioAuthToken);
            await client.messages.create({
              body: digestText,
              from: twilioPhoneNumber,
              to: userData.phone
            });
          } catch (e) {
            console.warn(`SMS send failed for user ${userData.id}: ${e.message}`);
          }
        }

        // Send email via Resend
        if (userData.email_enabled && userData.notification_email && resend) {
          try {
            let htmlContent = `<h2>Daily Digest for ${userData.first_name}</h2>`;
            if (digest.dueFollowUps.length > 0) {
              htmlContent += `<h3>Due Today (${digest.dueFollowUps.length})</h3><ul>`;
              digest.dueFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong>${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            if (digest.upcomingFollowUps.length > 0) {
              htmlContent += `<h3>Upcoming This Week (${digest.upcomingFollowUps.length})</h3><ul>`;
              digest.upcomingFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong> (${a.follow_up_date})${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            htmlContent += `<p><strong>Dormant Accounts:</strong> ${digest.dormantAccounts.length}</p>
              <p><strong>New Notes from Team:</strong> ${digest.newNotes.length}</p>`;

            await resend.emails.send({
              from: EMAIL_FROM,
              to: userData.notification_email,
              subject: `Daily Digest - ${new Date().toLocaleDateString()}`,
              html: htmlContent
            });
          } catch (e) {
            console.warn(`Email send failed for user ${userData.id}: ${e.message}`);
          }
        }
      }
      // Send combined manager summary
      try { await sendManagerSummary(); } catch (e) { console.warn('Manager summary cron error:', e.message); }

      console.log(`Digest cron completed for ${users.length} users`);
    } catch (e) {
      console.error('Digest cron error:', e.message);
    }
  });

  // ─── GOOGLE DRIVE AUTO-IMPORT ───

  // Manual trigger — admin only
  app.post('/api/gdrive-import/run', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

      // Check if already running
      const running = await queryOne("SELECT id FROM gdrive_import_log WHERE status = 'running' AND created_at > NOW() - INTERVAL '10 minutes'");
      if (running) return res.status(409).json({ error: 'An import is already running' });

      // Mark as running
      await execute("INSERT INTO gdrive_import_log (status, triggered_by) VALUES ('running', 'manual')");

      const result = await runGDriveImport(queryAll, queryOne, execute);
      await logAudit(req, 'sale', null, 'import', { action: 'gdrive_auto_import', ...result });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Import history — admin/manager
  app.get('/api/gdrive-import/history', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Admin or manager access required' });
      }
      const history = await queryAll('SELECT * FROM gdrive_import_log ORDER BY created_at DESC LIMIT 30');
      res.json({ history });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Status check — is Google Drive configured?
  app.get('/api/gdrive-import/status', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const configured = !!(process.env.GDRIVE_FOLDER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const lastRun = await queryOne("SELECT * FROM gdrive_import_log WHERE status != 'running' ORDER BY created_at DESC LIMIT 1");
      const cronSchedule = process.env.GDRIVE_IMPORT_CRON || '0 10 * * 1-5';
      res.json({ configured, lastRun, cronSchedule, folderId: process.env.GDRIVE_FOLDER_ID || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── CRON JOB FOR GOOGLE DRIVE IMPORT ───
  const gdriveCron = process.env.GDRIVE_IMPORT_CRON || '0 10 * * 1-5';
  if (process.env.GDRIVE_FOLDER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    cron.schedule(gdriveCron, async () => {
      console.log('[GDrive Cron] Running scheduled import...');
      try {
        const result = await runGDriveImport(queryAll, queryOne, execute);
        console.log(`[GDrive Cron] Result: ${result.totalImported || 0} records from ${result.filesProcessed || 0} files`);
      } catch (e) {
        console.error('[GDrive Cron] Error:', e.message);
      }
    });
    console.log(`  Google Drive auto-import: scheduled (${gdriveCron})`);
  } else {
    console.log('  Google Drive auto-import: not configured (set GDRIVE_FOLDER_ID + GOOGLE_SERVICE_ACCOUNT_JSON)');
  }

  // ─── CUSTOMER SEED (admin-only bulk import from AccountEdge CSVs) ───
  app.post('/api/admin/seed-customers', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      const customers = require('./src/customer-seed.json');
      let imported = 0, skipped = 0, errors = [];

      for (const c of customers) {
        try {
          // Check if customer already exists (by name, case-insensitive)
          const existing = await queryOne(
            'SELECT id FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
            [c.shop_name]
          );
          if (existing) {
            // Update existing record to customer category and fill in any missing data
            const updates = [];
            const params = [];
            let idx = 1;
            updates.push(`account_category = 'customer'`);
            if (c.branch) { updates.push(`branch = $${idx++}`); params.push(c.branch); }
            if (c.address) { updates.push(`address = COALESCE(NULLIF(address,''), $${idx++})`); params.push(c.address); }
            if (c.city) { updates.push(`city = COALESCE(NULLIF(city,''), $${idx++})`); params.push(c.city); }
            if (c.province) { updates.push(`province = COALESCE(NULLIF(province,''), $${idx++})`); params.push(c.province); }
            if (c.postal_code) { updates.push(`postal_code = COALESCE(postal_code, $${idx++})`); params.push(c.postal_code); }
            if (c.phone) { updates.push(`phone = COALESCE(NULLIF(phone,''), $${idx++})`); params.push(c.phone); }
            if (c.phone2) { updates.push(`phone2 = COALESCE(phone2, $${idx++})`); params.push(c.phone2); }
            if (c.email) { updates.push(`email = COALESCE(NULLIF(email,''), $${idx++})`); params.push(c.email); }
            if (c.contact_names) { updates.push(`contact_names = COALESCE(NULLIF(contact_names,''), $${idx++})`); params.push(c.contact_names); }
            params.push(existing.id);
            await execute(`UPDATE accounts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, params);
            imported++;
          } else {
            // Insert new customer
            await execute(
              `INSERT INTO accounts (shop_name, address, city, province, postal_code, phone, phone2, email, contact_names, branch, account_category, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'customer','active')`,
              [c.shop_name, c.address, c.city, c.province, c.postal_code, c.phone, c.phone2, c.email, c.contact_names, c.branch]
            );
            imported++;
          }
        } catch (err) {
          errors.push({ shop_name: c.shop_name, error: err.message });
          skipped++;
        }
      }

      // Also link sales_data to accounts where customer_name matches
      const unlinked = await queryAll(
        `SELECT DISTINCT sd.customer_name FROM sales_data sd WHERE sd.account_id IS NULL AND sd.customer_name IS NOT NULL`
      );
      let linked = 0;
      for (const row of unlinked) {
        const match = await queryOne(
          'SELECT id FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
          [row.customer_name]
        );
        if (match) {
          await execute('UPDATE sales_data SET account_id = $1 WHERE LOWER(customer_name) = LOWER($2) AND account_id IS NULL', [match.id, row.customer_name]);
          linked++;
        }
      }

      res.json({ success: true, total: customers.length, imported, skipped, linked_sales: linked, errors: errors.slice(0, 20) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── CREATE MISSING SALESPEOPLE AS USERS + AUTO-ASSIGN (admin-only) ───
  app.post('/api/admin/create-salespeople-and-assign', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      // Known salesperson name -> { first_name, last_name } mapping from AccountEdge data
      const salespeopleToCreate = [
        { first_name: 'Jeff', last_name: 'Ward', aliases: ['Ward, Jeff', 'Jeff Ward'] },
        { first_name: 'Richard', last_name: 'Slater', aliases: ['Slater, Richard'] },
        { first_name: 'Douglas', last_name: 'Pike', aliases: ['Pike, Douglas'] },
        { first_name: 'Frank', last_name: 'Chiappetta', aliases: ['Frank C', 'Frankie G.', 'Frank, Chiappetta'] },
        { first_name: 'Jacob', last_name: 'Charbonneau', aliases: ['Charbonneau, Jacob'] },
        { first_name: 'Tony', last_name: 'Galati', aliases: ['Tony', 'Tony G'] },
        { first_name: 'Stefano', last_name: 'Galati', aliases: ['Galati, Stefano'] },
        { first_name: 'Marjorie', last_name: 'Cayer', aliases: ['Marjorie Cayer'] },
        { first_name: 'Manny', last_name: 'Rodriguez', aliases: ['Manni', 'Manny'] },
        { first_name: 'Boris', last_name: 'Saa', aliases: ['Saa, Boris'] },
        { first_name: 'Gabriel', last_name: 'Chiappetta', aliases: ['Gabriel Chiappetta'] },
        { first_name: 'Pino', last_name: 'Chiappetta', aliases: ['Pino Chiappetta'] },
        { first_name: 'Paul', last_name: 'Jassal', aliases: ['Jassal, Paul'] },
        { first_name: 'Robert', last_name: 'Cojocarasu', aliases: ['Robert Cojocarasu'] },
      ];

      const defaultPassword = await bcrypt.hash('changeme123', 12);
      const created = [];
      const alreadyExist = [];

      for (const sp of salespeopleToCreate) {
        // Check if user already exists (by first+last name match)
        const existing = await queryOne(
          'SELECT id FROM users WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2)',
          [sp.first_name, sp.last_name]
        );
        if (existing) {
          alreadyExist.push(`${sp.first_name} ${sp.last_name}`);
          continue;
        }
        // Generate email: first.last@chcpaint.com
        const email = `${sp.first_name.toLowerCase()}.${sp.last_name.toLowerCase()}@chcpaint.com`;
        // Check email collision
        const emailExists = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
        if (emailExists) {
          alreadyExist.push(`${sp.first_name} ${sp.last_name} (email exists)`);
          continue;
        }
        const { lastId } = await execute(
          'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
          [email, defaultPassword, sp.first_name, sp.last_name, 'rep']
        );
        created.push({ id: lastId, name: `${sp.first_name} ${sp.last_name}`, email });
        await logAudit(req, 'user', lastId, 'create', { email, role: 'rep', created_by: req.user.email, source: 'auto-create-salespeople' });
      }

      res.json({
        created: created.length,
        already_existed: alreadyExist.length,
        users_created: created,
        users_existed: alreadyExist,
        message: `Created ${created.length} sales rep accounts. Default password: changeme123. Now run Auto-Assign to link accounts.`
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── AUTO-ASSIGN REPS (admin-only — match salesperson names from sales data to CRM users) ───
  app.post('/api/admin/auto-assign-reps', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const dryRun = req.body.dry_run !== false; // default to dry run
    try {
      // 1. Get all active users
      const users = await queryAll('SELECT id, first_name, last_name, email FROM users WHERE is_active = true');

      // 2. Build flexible name matchers for each user
      const matchers = users.map(u => {
        const first = u.first_name.toLowerCase();
        const last = u.last_name.toLowerCase();
        const full = `${first} ${last}`;
        const lastFirst = `${last}, ${first}`;
        return { userId: u.id, name: `${u.first_name} ${u.last_name}`, patterns: [first, last, full, lastFirst] };
      });

      // 3. Build salesperson lookup from customer-seed.json (most reliable source)
      let seedData = [];
      try { seedData = require('./src/customer-seed.json'); } catch (e) { /* no seed file */ }
      const shopSalesperson = {};
      for (const rec of seedData) {
        if (rec.shop_name && rec.salesperson) {
          shopSalesperson[rec.shop_name.toLowerCase().trim()] = rec.salesperson.trim();
        }
      }

      // 4. Also build lookup from sales_data (customer_name -> salesperson) as fallback
      const salesLookup = await queryAll(`
        SELECT customer_name, salesperson, COUNT(*) as cnt
        FROM sales_data
        WHERE salesperson IS NOT NULL AND salesperson != '' AND customer_name IS NOT NULL
        GROUP BY customer_name, salesperson
        ORDER BY customer_name, cnt DESC
      `);
      const salesSalesperson = {};
      for (const row of salesLookup) {
        const key = row.customer_name.toLowerCase().trim();
        if (!salesSalesperson[key]) salesSalesperson[key] = row.salesperson.trim();
      }

      // 5. Get all unassigned accounts
      const unassigned = await queryAll(`
        SELECT a.id, a.shop_name, a.account_category
        FROM accounts a
        WHERE a.assigned_rep_id IS NULL AND a.deleted_at IS NULL
      `);

      // 6. For each account, find salesperson from seed data or sales data
      for (const acct of unassigned) {
        const key = acct.shop_name.toLowerCase().trim();
        acct.top_salesperson = shopSalesperson[key] || salesSalesperson[key] || null;
      }

      let assigned = 0, skipped = 0;
      const assignments = [];
      const noMatch = [];

      for (const acct of unassigned) {
        if (!acct.top_salesperson) {
          // No sales data — also try customer-seed "Rep Pursuing" via contact_names? Skip for now.
          skipped++;
          continue;
        }

        const sp = acct.top_salesperson.toLowerCase().trim();

        // Skip house accounts and generic entries
        if (sp === 'house account' || sp === 'house' || sp === 'retail' || sp === 'chc branch') {
          skipped++;
          noMatch.push({ shop: acct.shop_name, salesperson: acct.top_salesperson, reason: 'House/generic account' });
          continue;
        }

        // Try to match salesperson to a user
        let matchedUser = null;

        for (const m of matchers) {
          // Exact match on any pattern
          if (m.patterns.includes(sp)) {
            matchedUser = m;
            break;
          }
          // Partial: salesperson contains user's first name as a distinct word
          // e.g. "Frank C" matches "Frank Costello", "Tony G" matches "Tony Garcia"
          const spFirst = sp.split(/[\s,]+/)[0];
          const mFirst = m.patterns[0]; // first name lowercase
          if (spFirst === mFirst && spFirst.length > 2) {
            matchedUser = m;
            break;
          }
          // "Frankie G." or "Manni" — check if first name starts with same 4+ chars
          if (spFirst.length >= 4 && mFirst.startsWith(spFirst.substring(0, 4))) {
            matchedUser = m;
            break;
          }
          if (mFirst.length >= 4 && spFirst.startsWith(mFirst.substring(0, 4))) {
            matchedUser = m;
            break;
          }
        }

        if (matchedUser) {
          if (!dryRun) {
            await execute('UPDATE accounts SET assigned_rep_id = $1, updated_at = NOW() WHERE id = $2', [matchedUser.userId, acct.id]);
          }
          assigned++;
          assignments.push({ shop: acct.shop_name, category: acct.account_category, salesperson: acct.top_salesperson, assigned_to: matchedUser.name });
        } else {
          skipped++;
          noMatch.push({ shop: acct.shop_name, salesperson: acct.top_salesperson, reason: 'No matching CRM user' });
        }
      }

      if (!dryRun) {
        await logAudit(req, 'system', null, 'auto-assign-reps', { assigned, skipped, by: req.user.email });
      }

      res.json({
        dry_run: dryRun,
        total_unassigned: unassigned.length,
        assigned,
        skipped,
        assignments: assignments.slice(0, 100),
        no_match: noMatch.slice(0, 50)
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── HEALTH ───
  app.get('/api/health', async (req, res) => {
    try {
      await queryOne('SELECT 1 as ok');
      res.json({ status: 'ok', app: 'CHC CRM', version: '1.1.0', database: 'supabase' });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // ─── PCR SYNC: Sync active customers from pcr_shop_list (AccountEdge/PCR source of truth) ───
  // This reads pcr_shop_list from the same Supabase Postgres DB and creates/updates accounts
  async function syncPCRCustomers() {
    try {
      // Check if pcr_shop_list table exists
      const tableExists = await queryOne(
        "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'pcr_shop_list') as exists"
      );
      if (!tableExists?.exists) {
        console.log('  PCR sync: pcr_shop_list table not found, skipping');
        return { synced: 0, created: 0, updated: 0 };
      }

      const pcrShops = await queryAll('SELECT DISTINCT shop_name, branch FROM pcr_shop_list WHERE shop_name IS NOT NULL ORDER BY shop_name');
      if (!pcrShops || pcrShops.length === 0) {
        console.log('  PCR sync: no shops in pcr_shop_list');
        return { synced: 0, created: 0, updated: 0 };
      }

      // Normalize shop name into a stable key so minor AccountEdge tweaks
      // ("Inc"/"Ltd"/punctuation/whitespace) don't create duplicate accounts.
      const normalizeKey = (s) => (s || '')
        .toLowerCase()
        .replace(/\b(inc|ltd|llc|corp|corporation|company|co|limited)\b\.?/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, '-');

      let created = 0, updated = 0, skipped = 0;
      for (const shop of pcrShops) {
        try {
          const pcrId = normalizeKey(shop.shop_name);
          // Match by pcr_customer_id first (stable even if name changed), then by name
          let existing = await queryOne(
            'SELECT id, account_category, status, pcr_managed FROM accounts WHERE pcr_customer_id = $1 AND deleted_at IS NULL',
            [pcrId]
          );
          if (!existing) {
            existing = await queryOne(
              'SELECT id, account_category, status, pcr_managed FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
              [shop.shop_name]
            );
          }
          if (existing) {
            // Merge PCR metadata into CRM record. Never overwrite CRM user-entered fields —
            // only fill blanks and update PCR-owned fields (status/category/pcr_* columns).
            const updates = ["pcr_managed = true", "pcr_shop_name = $1", "pcr_customer_id = $2", "pcr_last_synced_at = NOW()"];
            const params = [shop.shop_name, pcrId];
            let idx = 3;
            if (existing.account_category !== 'customer') {
              updates.push("account_category = 'customer'");
            }
            // Respect manually set dnc/churned — never auto-flip those back to active
            if (existing.status !== 'active' && existing.status !== 'dnc' && existing.status !== 'churned') {
              updates.push("status = 'active'");
            }
            // If the AccountEdge name changed, adopt it — PCR is source of truth for shop_name
            updates.push(`shop_name = $${idx++}`);
            params.push(shop.shop_name);
            if (shop.branch) {
              updates.push(`branch = COALESCE(NULLIF(branch,''), $${idx++})`);
              params.push(shop.branch);
            }
            params.push(existing.id);
            await execute(`UPDATE accounts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, params);
            updated++;
          } else {
            // Create new active customer from PCR
            await execute(
              `INSERT INTO accounts (shop_name, branch, account_category, status, pcr_managed, pcr_shop_name, pcr_customer_id, pcr_last_synced_at)
               VALUES ($1, $2, 'customer', 'active', true, $1, $3, NOW())`,
              [shop.shop_name, shop.branch || null, pcrId]
            );
            created++;
          }
        } catch (err) {
          skipped++;
        }
      }

      // Also mark any current "customers" NOT in PCR as churned (they left AccountEdge)
      // But only if they were originally PCR-managed
      const pcrNames = pcrShops.map(s => s.shop_name.toLowerCase());
      const currentPCRCustomers = await queryAll(
        "SELECT id, shop_name FROM accounts WHERE pcr_managed = true AND account_category = 'customer' AND status = 'active' AND deleted_at IS NULL"
      );
      let churned = 0;
      for (const cust of currentPCRCustomers) {
        if (!pcrNames.includes(cust.shop_name.toLowerCase())) {
          await execute("UPDATE accounts SET status = 'churned', updated_at = NOW() WHERE id = $1", [cust.id]);
          churned++;
        }
      }

      return { synced: pcrShops.length, created, updated, skipped, churned };
    } catch (err) {
      console.error('  PCR sync error:', err.message);
      return { error: err.message };
    }
  }

  // Admin endpoint to trigger PCR customer sync manually
  app.post('/api/admin/sync-pcr-customers', authenticate, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Admin or manager only' });
    try {
      const result = await syncPCRCustomers();
      res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── PCR / SALES DIAGNOSTICS ───
  app.get('/api/admin/pcr-diagnostics', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      const tables = ['pcr_shop_list', 'pcr_sync_data', 'pcr_daily_sales', 'pcr_shop_targets', 'pcr_sp_mapping', 'sales_data', 'accounts'];
      const diagnostics = {};
      for (const t of tables) {
        try {
          const count = await queryOne(`SELECT COUNT(*) as count FROM ${t}`);
          diagnostics[t] = { exists: true, count: parseInt(count.count) };
          // Get date range for time-series tables
          // Get columns for each table
          const cols = await queryAll(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position", [t]
          );
          diagnostics[t].columns = cols.map(c => c.column_name);
          // Get date ranges for tables with date columns
          const dateCols = cols.filter(c => c.data_type.includes('date') || c.data_type.includes('timestamp') || c.column_name.includes('date'));
          for (const dc of dateCols.slice(0, 2)) {
            try {
              const range = await queryOne(`SELECT MIN("${dc.column_name}") as min_val, MAX("${dc.column_name}") as max_val FROM ${t}`);
              diagnostics[t][`${dc.column_name}_range`] = { min: range?.min_val, max: range?.max_val };
            } catch (e2) { /* skip */ }
          }
          if (t === 'sales_data') {
            const range = await queryOne('SELECT MIN(sale_date) as min_date, MAX(sale_date) as max_date FROM sales_data');
            diagnostics[t].date_range = { min: range?.min_date, max: range?.max_date };
          }
          if (t === 'accounts') {
            const cats = await queryAll("SELECT account_category, status, COUNT(*) as count FROM accounts WHERE deleted_at IS NULL GROUP BY account_category, status ORDER BY account_category, status");
            diagnostics[t].breakdown = cats;
          }
        } catch (e) {
          diagnostics[t] = { exists: false, error: e.message };
        }
      }
      // Check cron jobs — REDACT sync keys, bearer tokens, and other secrets before returning.
      try {
        const cronJobs = await queryAll("SELECT jobid, schedule, command, nodename, active FROM cron.job ORDER BY jobid");
        const redact = (cmd) => {
          if (typeof cmd !== 'string') return cmd;
          return cmd
            // x-sync-key header values
            .replace(/(x-sync-key['"]*\s*,\s*['"])([^'"]+)(['"])/gi, '$1[REDACTED]$3')
            // Authorization: Bearer <token>
            .replace(/(Authorization['"]*\s*,\s*['"]?Bearer\s+)([^'"\s]+)/gi, '$1[REDACTED]')
            // Any key-looking token (long base64/hex)
            .replace(/([a-zA-Z0-9_-]{40,})/g, '[REDACTED]');
        };
        diagnostics.cron_jobs = cronJobs.map(j => ({ ...j, command: redact(j.command) }));
      } catch (e) {
        diagnostics.cron_jobs = { error: e.message };
      }
      // Check edge functions invocation log
      try {
        const edgeLogs = await queryAll("SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10");
        diagnostics.cron_run_history = edgeLogs;
      } catch (e) {
        diagnostics.cron_run_history = { error: e.message };
      }
      res.json({ diagnostics });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── INVOKE EDGE FUNCTIONS MANUALLY ───
  app.post('/api/admin/invoke-edge-function', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      const { functionName } = req.body;
      const allowed = ['sync-pcr-daily', 'sync-pcr-full', 'sync-pcr-shops'];
      if (!allowed.includes(functionName)) return res.status(400).json({ error: `Invalid function. Allowed: ${allowed.join(', ')}` });
      // Read the sync key from cron jobs
      const cronJob = await queryOne("SELECT command FROM cron.job WHERE command LIKE $1 LIMIT 1", [`%${functionName}%`]);
      if (!cronJob) return res.status(404).json({ error: 'No cron job found for this function' });
      // Extract the sync key from the cron command
      const keyMatch = cronJob.command.match(/x-sync-key['"]*,\s*['"](.*?)['"]/);
      const syncKey = keyMatch ? keyMatch[1] : null;
      if (!syncKey) return res.status(500).json({ error: 'Could not extract sync key from cron job' });
      // Get the project ref from the URL
      const urlMatch = cronJob.command.match(/https:\/\/(.*?)\.supabase\.co/);
      const projectRef = urlMatch ? urlMatch[1] : null;
      if (!projectRef) return res.status(500).json({ error: 'Could not extract project ref' });
      const edgeUrl = `https://${projectRef}.supabase.co/functions/v1/${functionName}`;
      const response = await fetch(edgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-key': syncKey },
        body: JSON.stringify({})
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      res.json({ success: response.ok, status: response.status, functionName, data });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── REFRESH SALES_DATA from pcr_sync_data.payload (Supabase-only, no Google Drive) ───
  app.post('/api/admin/refresh-sales-from-pcr', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const client = await getPool().connect();
    try {
      await client.query("SET statement_timeout = '15min'");
      // Bootstrap (create-or-replace) the SQL function so this is self-healing
      await client.query(`
        CREATE OR REPLACE FUNCTION refresh_sales_data_from_pcr() RETURNS jsonb LANGUAGE plpgsql AS $func$
        DECLARE
          v_inserted int;
          v_payload jsonb;
        BEGIN
          SET LOCAL statement_timeout = '15min';
          SELECT payload INTO v_payload FROM pcr_sync_data ORDER BY intranet_uploaded_at DESC NULLS LAST LIMIT 1;
          IF v_payload IS NULL THEN RETURN jsonb_build_object('error','no payload'); END IF;
          DROP TABLE IF EXISTS _sales_scratch;
          CREATE TEMP TABLE _sales_scratch AS
            SELECT row FROM jsonb_array_elements(v_payload->'rows') AS row;
          DELETE FROM sales_data WHERE imported_from_accountedge = true;
          INSERT INTO sales_data
            (sale_amount, sale_date, month, customer_name, item_name, quantity, salesperson, category, product_line, imported_from_accountedge, memo)
          SELECT
            ((row->>4)::numeric / 100.0)::real,
            ((row->>3) || '-' || lpad((row->>2),2,'0') || '-' || lpad((row->>11),2,'0')),
            ((row->>3) || '-' || lpad((row->>2),2,'0')),
            (v_payload->'customers'->((row->>1)::int))#>>'{}',
            (v_payload->'skus'->((row->>7)::int))#>>'{}',
            (row->>6)::int,
            (v_payload->'sp'->((row->>10)::int))#>>'{}',
            (v_payload->'cl1'->((row->>8)::int))#>>'{}',
            (v_payload->'cl2'->((row->>9)::int))#>>'{}',
            true,
            'Invoice ' || (row->>5)
          FROM _sales_scratch;
          GET DIAGNOSTICS v_inserted = ROW_COUNT;
          DROP TABLE _sales_scratch;

          -- ── Link rep_id by exact match on "First Last" ──
          UPDATE sales_data s SET rep_id = u.id
            FROM users u
           WHERE s.rep_id IS NULL
             AND LOWER(TRIM(s.salesperson)) = LOWER(TRIM(u.first_name || ' ' || u.last_name));

          -- ── Link rep_id for common name variants ──
          UPDATE sales_data SET rep_id = sub.uid
            FROM (
              SELECT unnest(ARRAY['chiappetta frank','frank c','frankie g','frankie g.']) AS alias,
                     (SELECT id FROM users WHERE LOWER(first_name)='frank' AND LOWER(last_name)='chiappetta' LIMIT 1) AS uid
              UNION ALL
              SELECT unnest(ARRAY['halliday, ben']),
                     (SELECT id FROM users WHERE LOWER(first_name)='ben' AND LOWER(last_name)='halliday' LIMIT 1)
              UNION ALL
              SELECT unnest(ARRAY['manny','manni']),
                     (SELECT id FROM users WHERE LOWER(first_name)='manny' AND LOWER(last_name)='pacheco' LIMIT 1)
              UNION ALL
              SELECT 'tony',
                     (SELECT id FROM users WHERE LOWER(first_name)='tony' AND LOWER(last_name)='galati' LIMIT 1)
            ) sub
           WHERE sales_data.rep_id IS NULL
             AND LOWER(TRIM(sales_data.salesperson)) = sub.alias
             AND sub.uid IS NOT NULL;

          -- ── Link account_id by exact match on customer_name ──
          UPDATE sales_data s SET account_id = a.id
            FROM accounts a
           WHERE s.account_id IS NULL
             AND a.deleted_at IS NULL
             AND LOWER(TRIM(s.customer_name)) = LOWER(TRIM(a.shop_name));

          RETURN jsonb_build_object('inserted', v_inserted);
        END $func$;
      `);
      // Run it
      const r = await client.query('SELECT refresh_sales_data_from_pcr() AS result');
      const result = r.rows[0]?.result || {};
      // Stats
      const stats = await client.query(
        "SELECT count(*)::int AS total, MIN(sale_date) AS min_date, MAX(sale_date) AS max_date FROM sales_data WHERE imported_from_accountedge=true"
      );
      // Ensure nightly cron exists (safe to re-run)
      try {
        await client.query(`
          SELECT cron.schedule('refresh-sales-data-nightly','30 5 * * *','SELECT refresh_sales_data_from_pcr();')
          WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='refresh-sales-data-nightly')
        `);
      } catch (cronErr) { console.warn('cron schedule skipped:', cronErr.message); }

      // Ensure business-hours refresh cron exists — the Edge Function fetches fresh
      // data to pcr_sync_data every 30 min but its RPC call to the refresh function
      // always times out.  This cron runs the heavy refresh directly in Postgres
      // where the 15-min statement_timeout works.
      try {
        await client.query(`
          SELECT cron.schedule('refresh-sales-data-business-hours','0 10,14,18,22 * * 1-5','SELECT refresh_sales_data_from_pcr();')
          WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='refresh-sales-data-business-hours')
        `);
      } catch (cronErr) { console.warn('business-hours cron schedule skipped:', cronErr.message); }

      // Also sync customers/shops from PCR so new shops show up immediately
      let customerSync = null;
      try {
        customerSync = await syncPCRCustomers();
      } catch (custErr) {
        console.warn('customer sync during refresh-sales skipped:', custErr.message);
        customerSync = { error: custErr.message };
      }

      res.json({ success: true, ...result, stats: stats.rows[0], customerSync });
    } catch (e) {
      console.error('refresh-sales-from-pcr error:', e);
      res.status(500).json({ success: false, error: e.message });
    } finally {
      client.release();
    }
  });

  // Nightly PCR customer sync — runs ~30 min after the 05:30 UTC sales refresh so
  // any new shops in pcr_shop_list flow into the CRM's accounts table automatically.
  cron.schedule('0 6 * * *', async () => {
    try {
      console.log('[PCR Cron] Running nightly customer sync...');
      const result = await syncPCRCustomers();
      console.log('[PCR Cron] Customer sync result:', JSON.stringify(result));
    } catch (err) {
      console.error('[PCR Cron] Customer sync failed:', err.message);
    }
  });
  console.log('  PCR customer sync: scheduled nightly at 06:00 UTC');

  // ============================================================================
  //  HOLDS SYNC FROM CHC INTRANET
  // ============================================================================
  // New intranet project (migrated ~April 2026). Old project eijlxtplywjbilijlyzf is decomissioned.
  const INTRANET_URL = process.env.INTRANET_SUPABASE_URL || 'https://mqpagzjbfwknzeubecif.supabase.co';
  const INTRANET_KEY = process.env.INTRANET_SUPABASE_KEY || 'sb_publishable_rcrI8XZherAuRWjvx-Lh2A_A8_b0zwY';
  const HOLDS_TABLE = process.env.INTRANET_HOLDS_TABLE || 'holds';

  async function syncHoldsFromIntranet() {
    console.log('[Holds Sync] Starting sync from CHC Intranet...');
    const startTime = Date.now();

    // 1. Fetch holds from the new intranet Supabase REST API
    //    New schema: each row has { id, data (jsonb array of holds), updated_at }
    const url = `${INTRANET_URL}/rest/v1/${HOLDS_TABLE}?select=*`;
    const resp = await fetch(url, {
      headers: {
        'apikey': INTRANET_KEY,
        'Authorization': `Bearer ${INTRANET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Intranet API returned ${resp.status}: ${errText}`);
    }

    const intranetRows = await resp.json();
    if (!Array.isArray(intranetRows)) {
      throw new Error('Intranet returned non-array response');
    }

    // 2. Flatten: each row's `data` is a JSON array of hold objects.
    //    Preserve the row-level `updated_at` so the CRM staleness check works.
    const allHolds = [];
    for (const row of intranetRows) {
      const arr = row.data;
      if (!Array.isArray(arr)) continue;
      const rowUpdatedAt = row.updated_at || null;
      for (const entry of arr) {
        if (entry && typeof entry === 'object' && (entry.name || entry.customer_name)) {
          entry._rowUpdatedAt = rowUpdatedAt;
          allHolds.push(entry);
        }
      }
    }

    console.log(`[Holds Sync] Fetched ${intranetRows.length} rows → ${allHolds.length} holds from intranet`);

    let upserted = 0;
    let deactivated = 0;
    let matched = 0;

    // 3. Upsert each hold into the CRM
    for (const h of allHolds) {
      // New intranet uses camelCase fields; support both old and new naming
      const intranetId = String(h.id || h.hold_id || h.intranet_id || '');
      if (!intranetId) continue;

      const customerName = h.name || h.customer_name || h.shop_name || '';
      if (!customerName) continue;

      const branch = h.branch || h.location || null;
      // Combine reason with billing info if present (row 2 type: amount, period, paidBy, etc.)
      let reason = h.reason || h.hold_reason || h.notes || null;
      if (h.amount && !reason) {
        reason = `Amount: $${h.amount}` + (h.period ? ` — Period: ${h.period}` : '');
      }
      const addedAt = h.addedAt || h.added_at || h.created_at || h.date_added || null;
      const addedBy = h.addedBy || h.added_by || h.created_by || null;
      const updates = h.updates || h.hold_updates || '[]';
      const updatesJson = typeof updates === 'string' ? updates : JSON.stringify(updates);
      // If resolutionMs or paidAt exist, the hold has been resolved
      const isResolved = !!(h.resolutionMs || h.paidAt);
      const isActive = h.is_active !== undefined ? h.is_active
        : (h.status ? h.status !== 'resolved' && h.status !== 'removed' : !isResolved);
      // Use NOW() for intranet_updated_at — we just fetched fresh data from the
      // intranet, so the staleness check should reflect when we last synced.
      // The intranet's row-level updated_at is TEXT and may not parse as TIMESTAMPTZ.
      const intranetUpdatedAt = new Date().toISOString();

      // Try to match to a CRM account by name
      let accountId = null;
      const acct = await queryOne(
        `SELECT id FROM accounts
         WHERE LOWER(TRIM(shop_name)) = LOWER(TRIM($1)) AND deleted_at IS NULL
         LIMIT 1`,
        [customerName]
      );
      if (acct) {
        accountId = acct.id;
        matched++;
      }

      // Upsert by intranet_id
      await execute(
        `INSERT INTO holds (intranet_id, customer_name, branch, reason, added_at, added_by,
                            updates, intranet_updated_at, account_id, is_active, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, NOW())
         ON CONFLICT (intranet_id) DO UPDATE SET
           customer_name = EXCLUDED.customer_name,
           branch = EXCLUDED.branch,
           reason = EXCLUDED.reason,
           added_at = EXCLUDED.added_at,
           added_by = EXCLUDED.added_by,
           updates = EXCLUDED.updates,
           intranet_updated_at = EXCLUDED.intranet_updated_at,
           account_id = COALESCE(holds.account_id, EXCLUDED.account_id),
           is_active = EXCLUDED.is_active,
           synced_at = NOW()`,
        [intranetId, customerName, branch, reason, addedAt, addedBy,
         updatesJson, intranetUpdatedAt, accountId, isActive]
      );
      upserted++;
    }

    // 4. Mark holds as inactive if they're no longer in the intranet feed
    if (allHolds.length > 0) {
      const intranetIds = allHolds
        .map(h => String(h.id || h.hold_id || h.intranet_id || ''))
        .filter(Boolean);
      if (intranetIds.length > 0) {
        const placeholders = intranetIds.map((_, idx) => `$${idx + 1}`).join(',');
        const result = await execute(
          `UPDATE holds SET is_active = false
           WHERE is_active = true AND intranet_id IS NOT NULL
             AND intranet_id NOT IN (${placeholders})`,
          intranetIds
        );
        deactivated = result.changes || 0;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = { upserted, deactivated, matched, elapsed_sec: elapsed, synced_at: new Date().toISOString() };
    console.log(`[Holds Sync] Complete:`, JSON.stringify(summary));
    return summary;
  }

  // Cron: sync holds every 6 hours (at :15 past to avoid collisions with PCR sync)
  cron.schedule('15 */6 * * *', async () => {
    try {
      await syncHoldsFromIntranet();
    } catch (err) {
      console.error('[Holds Sync Cron] Failed:', err.message);
    }
  });
  console.log('  Holds sync: scheduled every 6 hours (0:15, 6:15, 12:15, 18:15 UTC)');

  // ─── CHECK PCR MATCH: check if a lead has a matching PCR shop ───
  app.get('/api/accounts/:id/pcr-match', authenticate, async (req, res) => {
    try {
      const account = await queryOne('SELECT shop_name FROM accounts WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      if (!account) return res.status(404).json({ error: 'Not found' });

      const pcrMatch = await queryOne(
        "SELECT shop_name, branch FROM pcr_shop_list WHERE LOWER(shop_name) = LOWER($1) LIMIT 1",
        [account.shop_name]
      );

      // Also check for fuzzy matches (partial name)
      let fuzzyMatches = [];
      if (!pcrMatch) {
        const words = account.shop_name.split(/\s+/).filter(w => w.length > 2);
        if (words.length > 0) {
          const pattern = words.map(w => w.replace(/[%_]/g, '')).join('%');
          fuzzyMatches = await queryAll(
            "SELECT DISTINCT shop_name, branch FROM pcr_shop_list WHERE LOWER(shop_name) LIKE LOWER($1) LIMIT 10",
            [`%${pattern}%`]
          );
        }
      }

      res.json({
        exact_match: pcrMatch || null,
        fuzzy_matches: fuzzyMatches,
        is_in_pcr: !!pcrMatch
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── FIND MATCHING ACTIVE ACCOUNT for note transfer ───
  app.get('/api/accounts/:id/find-active-match', authenticate, async (req, res) => {
    try {
      const account = await queryOne('SELECT id, shop_name, account_category FROM accounts WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      if (!account) return res.status(404).json({ error: 'Not found' });

      // Find matching active customer account (PCR-imported)
      let match = await queryOne(
        "SELECT id, shop_name, branch, account_category, pcr_managed FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND account_category = 'customer' AND deleted_at IS NULL AND id != $2",
        [account.shop_name, account.id]
      );

      // If no exact match, try PCR shop name
      if (!match) {
        match = await queryOne(
          "SELECT id, shop_name, branch, account_category, pcr_managed FROM accounts WHERE LOWER(pcr_shop_name) = LOWER($1) AND account_category = 'customer' AND deleted_at IS NULL AND id != $2",
          [account.shop_name, account.id]
        );
      }

      res.json({ match: match || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── TRANSFER NOTES from one account to another ───
  app.post('/api/accounts/:id/transfer-notes', authenticate, async (req, res) => {
    try {
      const { target_account_id, note_ids } = req.body;
      if (!target_account_id) return res.status(400).json({ error: 'target_account_id required' });

      const source = await queryOne('SELECT id, shop_name FROM accounts WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      const target = await queryOne('SELECT id, shop_name, account_category FROM accounts WHERE id=$1 AND deleted_at IS NULL', [target_account_id]);
      if (!source || !target) return res.status(404).json({ error: 'Source or target account not found' });

      let transferred = 0;
      if (note_ids && Array.isArray(note_ids) && note_ids.length > 0) {
        // Transfer specific notes
        for (const noteId of note_ids) {
          await execute('UPDATE notes SET account_id = $1, updated_at = NOW() WHERE id = $2 AND account_id = $3', [target_account_id, noteId, req.params.id]);
          transferred++;
        }
      } else {
        // Transfer ALL notes from source to target
        const result = await execute('UPDATE notes SET account_id = $1, updated_at = NOW() WHERE account_id = $2', [target_account_id, req.params.id]);
        transferred = result.changes;
      }

      // Log the transfer
      await logAudit(req, 'account', parseInt(req.params.id), 'update', {
        notes_transferred: { from: source.shop_name, to: target.shop_name, count: transferred }
      });

      res.json({
        success: true,
        transferred,
        message: `${transferred} note(s) moved from "${source.shop_name}" (Lead) to "${target.shop_name}" (Active Customer from PCR/AccountEdge)`
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── COPY NOTES (duplicate, don't move) from one account to another ───
  app.post('/api/accounts/:id/copy-notes', authenticate, async (req, res) => {
    try {
      const { target_account_id, note_ids } = req.body;
      if (!target_account_id) return res.status(400).json({ error: 'target_account_id required' });

      const source = await queryOne('SELECT id, shop_name FROM accounts WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      const target = await queryOne('SELECT id, shop_name FROM accounts WHERE id=$1 AND deleted_at IS NULL', [target_account_id]);
      if (!source || !target) return res.status(404).json({ error: 'Source or target account not found' });

      // Get notes to copy
      let notes;
      if (note_ids && Array.isArray(note_ids) && note_ids.length > 0) {
        notes = await queryAll('SELECT * FROM notes WHERE id = ANY($1) AND account_id = $2', [note_ids, req.params.id]);
      } else {
        notes = await queryAll('SELECT * FROM notes WHERE account_id = $1 ORDER BY created_at', [req.params.id]);
      }

      let copied = 0;
      for (const note of notes) {
        await execute(
          'INSERT INTO notes (account_id, created_by_id, content, is_voice_transcribed, created_at) VALUES ($1, $2, $3, $4, $5)',
          [target_account_id, note.created_by_id, `[Copied from Lead "${source.shop_name}"]\n\n${note.content}`, note.is_voice_transcribed, note.created_at]
        );
        copied++;
      }

      await logAudit(req, 'account', parseInt(req.params.id), 'update', {
        notes_copied: { from: source.shop_name, to: target.shop_name, count: copied }
      });

      res.json({
        success: true,
        copied,
        message: `${copied} note(s) copied from "${source.shop_name}" (Lead) to "${target.shop_name}" (Active Customer from PCR/AccountEdge)`
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── DUPLICATE DETECTION: Scan for Lead/Active matches ───
  app.post('/api/admin/scan-duplicates', authenticate, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Admin or manager only' });
    try {
      const threshold = parseFloat(req.body.threshold) || 0.95;
      const scanMode = req.body.mode || 'all'; // 'lead_vs_active', 'active_vs_active', 'all'
      // Get all leads
      const leads = await queryAll(
        "SELECT id, shop_name, city, phone, email, contact_names, account_category FROM accounts WHERE account_category = 'lead' AND deleted_at IS NULL ORDER BY shop_name"
      );
      // Get all active customers
      const actives = await queryAll(
        "SELECT id, shop_name, city, phone, email, contact_names, pcr_managed, branch, account_category FROM accounts WHERE account_category = 'customer' AND deleted_at IS NULL ORDER BY shop_name"
      );
      const duplicates = [];
      const seen = new Set(); // prevent duplicate flag pairs

      // Helper to process a pair — the account with more recent activity becomes the "keep" side
      const processPair = async (acctA, acctB, pairType) => {
        const pairKey = [Math.min(acctA.id, acctB.id), Math.max(acctA.id, acctB.id)].join('-');
        if (seen.has(pairKey)) return;
        seen.add(pairKey);

        const result = duplicateScore(acctA, acctB);
        if (result.score >= threshold) {
          // Check if already flagged (any status)
          const existing = await queryOne(
            'SELECT id, status FROM duplicate_flags WHERE ((account_1_id=$1 AND account_2_id=$2) OR (account_1_id=$2 AND account_2_id=$1))',
            [acctA.id, acctB.id]
          );
          if (!existing) {
            // Determine which account has more recent activity (notes, activities)
            const aLastActivity = await queryOne(
              `SELECT GREATEST(
                (SELECT MAX(created_at) FROM notes WHERE account_id = $1),
                (SELECT MAX(created_at) FROM activities WHERE account_id = $1)
              ) AS last_active`, [acctA.id]
            );
            const bLastActivity = await queryOne(
              `SELECT GREATEST(
                (SELECT MAX(created_at) FROM notes WHERE account_id = $1),
                (SELECT MAX(created_at) FROM activities WHERE account_id = $1)
              ) AS last_active`, [acctB.id]
            );
            // The more active account is account_2 (the "keep" side)
            const aDate = aLastActivity?.last_active || '1970-01-01';
            const bDate = bLastActivity?.last_active || '1970-01-01';
            const [deleteAcct, keepAcct] = aDate > bDate ? [acctB, acctA] : [acctA, acctB];
            await execute(
              'INSERT INTO duplicate_flags (account_1_id, account_2_id, similarity_score, status) VALUES ($1, $2, $3, $4)',
              [deleteAcct.id, keepAcct.id, result.score, 'pending']
            );
          } else if (existing.status === 'dismissed') {
            // Don't re-flag dismissed pairs
            return;
          }
          duplicates.push({
            lead: { id: acctA.id, shop_name: acctA.shop_name, city: acctA.city, phone: acctA.phone, email: acctA.email, contact_names: acctA.contact_names, category: acctA.account_category },
            active: { id: acctB.id, shop_name: acctB.shop_name, city: acctB.city, phone: acctB.phone, email: acctB.email, contact_names: acctB.contact_names, pcr_managed: acctB.pcr_managed, branch: acctB.branch, category: acctB.account_category },
            score: result.score,
            reason: result.reason,
            nameScore: result.nameScore,
            meaningfulSim: result.meaningfulSim,
          });
        }
      };

      // Lead vs Active scan
      if (scanMode === 'lead_vs_active' || scanMode === 'all') {
        for (const lead of leads) {
          for (const active of actives) {
            await processPair(lead, active, 'lead_vs_active');
          }
        }
      }

      // Active vs Active scan (find same customer with multiple active accounts)
      if (scanMode === 'active_vs_active' || scanMode === 'all') {
        for (let i = 0; i < actives.length; i++) {
          for (let j = i + 1; j < actives.length; j++) {
            await processPair(actives[i], actives[j], 'active_vs_active');
          }
        }
      }

      duplicates.sort((a, b) => b.score - a.score);
      res.json({ success: true, count: duplicates.length, duplicates, leadsScanned: leads.length, activesScanned: actives.length, mode: scanMode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get all pending duplicate flags
  app.get('/api/admin/duplicates', authenticate, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Admin or manager only' });
    try {
      const flags = await queryAll(`
        SELECT df.id, df.similarity_score, df.status, df.created_at,
          a1.id as lead_id, a1.shop_name as lead_name, a1.city as lead_city, a1.phone as lead_phone, a1.email as lead_email, a1.contact_names as lead_contacts,
          a1.account_category as lead_category,
          a2.id as active_id, a2.shop_name as active_name, a2.city as active_city, a2.phone as active_phone, a2.email as active_email, a2.contact_names as active_contacts,
          a2.pcr_managed as active_pcr_managed, a2.branch as active_branch,
          a2.account_category as active_category,
          (SELECT COUNT(*) FROM notes WHERE account_id = a1.id) as lead_note_count,
          (SELECT COUNT(*) FROM notes WHERE account_id = a2.id) as active_note_count,
          GREATEST(
            (SELECT MAX(created_at) FROM notes WHERE account_id = a1.id),
            (SELECT MAX(created_at) FROM activities WHERE account_id = a1.id)
          ) as lead_last_activity,
          GREATEST(
            (SELECT MAX(created_at) FROM notes WHERE account_id = a2.id),
            (SELECT MAX(created_at) FROM activities WHERE account_id = a2.id)
          ) as active_last_activity
        FROM duplicate_flags df
        JOIN accounts a1 ON df.account_1_id = a1.id
        JOIN accounts a2 ON df.account_2_id = a2.id
        WHERE df.status = 'pending' AND a1.deleted_at IS NULL AND a2.deleted_at IS NULL
        ORDER BY df.similarity_score DESC, df.created_at DESC
      `);
      res.json({ duplicates: flags });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Admin: approve deletion of a lead duplicate (soft-delete lead, transfer notes first)
  app.post('/api/admin/duplicates/:flagId/delete-lead', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      const flag = await queryOne('SELECT * FROM duplicate_flags WHERE id=$1', [req.params.flagId]);
      if (!flag) return res.status(404).json({ error: 'Flag not found' });
      const deleteId = flag.account_1_id;  // account to be deleted
      const keepId = flag.account_2_id;    // account to keep (more active)

      const deleteAcct = await queryOne('SELECT * FROM accounts WHERE id=$1', [deleteId]);
      const keepAcct = await queryOne('SELECT * FROM accounts WHERE id=$1', [keepId]);
      if (!deleteAcct || !keepAcct) return res.status(404).json({ error: 'Account not found' });

      // ── 1. MERGE ACCOUNT FIELDS ──
      // Fill in any blank fields on the kept account from the deleted account.
      // The kept account's existing data always takes priority.
      const mergeFields = [
        'address', 'city', 'area', 'province', 'postal_code',
        'contact_names', 'phone', 'phone2', 'email',
        'account_type', 'suppliers', 'paint_line', 'allied_products', 'sundries',
        'mpo', 'sq_footage', 'banner',
        'cup_brand', 'paper_brand', 'filler_brand',
        'deal_details', 'business_type_notes',
        'accountedge_card_id', 'pcr_shop_name', 'pcr_customer_id',
        'branch', 'contract_status', 'contract_file_path',
      ];
      const mergeIntFields = [
        'num_techs', 'num_painters', 'num_body_men', 'num_paint_booths',
      ];
      const mergeFloatFields = ['annual_revenue'];
      const mergeBoolFields = ['has_contract', 'former_sherwin_client', 'pcr_managed'];

      const updates = [];
      const updateParams = [];
      let pi = 1;
      const mergedFields = [];

      for (const f of mergeFields) {
        if ((!keepAcct[f] || keepAcct[f] === '') && deleteAcct[f] && deleteAcct[f] !== '') {
          updates.push(`${f} = $${pi++}`);
          updateParams.push(deleteAcct[f]);
          mergedFields.push(f);
        }
      }
      for (const f of mergeIntFields) {
        if (keepAcct[f] == null && deleteAcct[f] != null) {
          updates.push(`${f} = $${pi++}`);
          updateParams.push(deleteAcct[f]);
          mergedFields.push(f);
        }
      }
      for (const f of mergeFloatFields) {
        if (keepAcct[f] == null && deleteAcct[f] != null) {
          updates.push(`${f} = $${pi++}`);
          updateParams.push(deleteAcct[f]);
          mergedFields.push(f);
        }
      }
      for (const f of mergeBoolFields) {
        // Only merge booleans that are true on the deleted account but not set on the kept
        if (deleteAcct[f] === true && keepAcct[f] !== true) {
          updates.push(`${f} = $${pi++}`);
          updateParams.push(true);
          mergedFields.push(f);
        }
      }

      // Merge assigned_rep_id: keep existing, fill if blank
      if (!keepAcct.assigned_rep_id && deleteAcct.assigned_rep_id) {
        updates.push(`assigned_rep_id = $${pi++}`);
        updateParams.push(deleteAcct.assigned_rep_id);
        mergedFields.push('assigned_rep_id (primary salesperson)');
      }
      // Merge secondary_rep_id: keep existing, fill if blank.
      // If the kept account already has the same primary rep but no secondary,
      // and the deleted account has a different rep, add it as secondary.
      if (!keepAcct.secondary_rep_id && deleteAcct.assigned_rep_id
          && deleteAcct.assigned_rep_id !== keepAcct.assigned_rep_id) {
        updates.push(`secondary_rep_id = $${pi++}`);
        updateParams.push(deleteAcct.assigned_rep_id);
        mergedFields.push('secondary_rep_id (from deleted account primary)');
      } else if (!keepAcct.secondary_rep_id && deleteAcct.secondary_rep_id) {
        updates.push(`secondary_rep_id = $${pi++}`);
        updateParams.push(deleteAcct.secondary_rep_id);
        mergedFields.push('secondary_rep_id');
      }

      // Merge follow_up_date: keep the earliest upcoming date
      if (deleteAcct.follow_up_date && (!keepAcct.follow_up_date || deleteAcct.follow_up_date < keepAcct.follow_up_date)) {
        updates.push(`follow_up_date = $${pi++}`);
        updateParams.push(deleteAcct.follow_up_date);
        mergedFields.push('follow_up_date');
      }

      // Merge contract_expiration_date: keep if missing
      if (!keepAcct.contract_expiration_date && deleteAcct.contract_expiration_date) {
        updates.push(`contract_expiration_date = $${pi++}`);
        updateParams.push(deleteAcct.contract_expiration_date);
        mergedFields.push('contract_expiration_date');
      }

      // Merge tags: combine unique tags from both
      let keepTags = [];
      let deleteTags = [];
      try { keepTags = JSON.parse(keepAcct.tags || '[]'); } catch {}
      try { deleteTags = JSON.parse(deleteAcct.tags || '[]'); } catch {}
      if (typeof keepAcct.tags === 'object' && Array.isArray(keepAcct.tags)) keepTags = keepAcct.tags;
      if (typeof deleteAcct.tags === 'object' && Array.isArray(deleteAcct.tags)) deleteTags = deleteAcct.tags;
      const mergedTags = [...new Set([...keepTags, ...deleteTags])];
      if (mergedTags.length > keepTags.length) {
        updates.push(`tags = $${pi++}::jsonb`);
        updateParams.push(JSON.stringify(mergedTags));
        mergedFields.push('tags');
      }

      // Merge business_types: combine unique
      let keepBT = [];
      let deleteBT = [];
      try { keepBT = JSON.parse(keepAcct.business_types || '[]'); } catch {}
      try { deleteBT = JSON.parse(deleteAcct.business_types || '[]'); } catch {}
      if (typeof keepAcct.business_types === 'object' && Array.isArray(keepAcct.business_types)) keepBT = keepAcct.business_types;
      if (typeof deleteAcct.business_types === 'object' && Array.isArray(deleteAcct.business_types)) deleteBT = deleteAcct.business_types;
      const mergedBT = [...new Set([...keepBT, ...deleteBT])];
      if (mergedBT.length > keepBT.length) {
        updates.push(`business_types = $${pi++}::jsonb`);
        updateParams.push(JSON.stringify(mergedBT));
        mergedFields.push('business_types');
      }

      // Merge phone_numbers and email_addresses (JSON arrays of objects)
      for (const arrayField of ['phone_numbers', 'email_addresses']) {
        let keepArr = [];
        let deleteArr = [];
        try { keepArr = JSON.parse(keepAcct[arrayField] || '[]'); } catch {}
        try { deleteArr = JSON.parse(deleteAcct[arrayField] || '[]'); } catch {}
        if (typeof keepAcct[arrayField] === 'object' && Array.isArray(keepAcct[arrayField])) keepArr = keepAcct[arrayField];
        if (typeof deleteAcct[arrayField] === 'object' && Array.isArray(deleteAcct[arrayField])) deleteArr = deleteAcct[arrayField];
        // Fix any double-encoded entries (strings that are actually JSON objects)
        const fixEncoding = (arr) => arr.map(item => {
          if (typeof item === 'string') { try { return JSON.parse(item); } catch { return null; } }
          return item;
        }).filter(item => item && typeof item === 'object');
        keepArr = fixEncoding(keepArr);
        deleteArr = fixEncoding(deleteArr);
        // Deduplicate by key field (number for phones, address for emails)
        const keyField = arrayField === 'phone_numbers' ? 'number' : 'address';
        const existingKeys = new Set(keepArr.map(v => (v[keyField] || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
        const newItems = deleteArr.filter(v => !existingKeys.has((v[keyField] || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
        const merged = [...keepArr, ...newItems];
        if (merged.length > keepArr.length) {
          updates.push(`${arrayField} = $${pi++}`);
          updateParams.push(JSON.stringify(merged));
          mergedFields.push(arrayField);
        }
      }

      // Merge contact_names: append if different
      if (deleteAcct.contact_names && keepAcct.contact_names
          && deleteAcct.contact_names.toLowerCase().trim() !== keepAcct.contact_names.toLowerCase().trim()) {
        // Combine contact names, deduplicating
        const keepContacts = keepAcct.contact_names.split(/[,;]/).map(c => c.trim()).filter(Boolean);
        const deleteContacts = deleteAcct.contact_names.split(/[,;]/).map(c => c.trim()).filter(Boolean);
        const allContacts = [...new Set([...keepContacts, ...deleteContacts.filter(dc =>
          !keepContacts.some(kc => kc.toLowerCase() === dc.toLowerCase())
        )])];
        if (allContacts.length > keepContacts.length) {
          updates.push(`contact_names = $${pi++}`);
          updateParams.push(allContacts.join(', '));
          mergedFields.push('contact_names');
        }
      }

      // Apply the merged fields to the kept account
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        updateParams.push(keepId);
        await execute(
          `UPDATE accounts SET ${updates.join(', ')} WHERE id = $${pi}`,
          updateParams
        );
      }

      // ── 2. TRANSFER NOTES ──
      const leadNotes = await queryAll('SELECT * FROM notes WHERE account_id=$1 ORDER BY created_at', [deleteId]);
      let notesTransferred = 0;
      for (const note of leadNotes) {
        await execute(
          'INSERT INTO notes (account_id, created_by_id, content, is_voice_transcribed, created_at) VALUES ($1, $2, $3, $4, $5)',
          [keepId, note.created_by_id, `[Merged from "${deleteAcct.shop_name}"] ${note.content}`, note.is_voice_transcribed, note.created_at]
        );
        notesTransferred++;
      }

      // ── 3. TRANSFER ACTIVITIES ──
      const activitiesResult = await execute(
        'UPDATE activities SET account_id = $1 WHERE account_id = $2',
        [keepId, deleteId]
      );
      const activitiesTransferred = activitiesResult.changes || 0;

      // ── 4. TRANSFER SALES DATA ──
      const salesResult = await execute(
        'UPDATE sales_data SET account_id = $1 WHERE account_id = $2',
        [keepId, deleteId]
      );
      const salesTransferred = salesResult.changes || 0;

      // ── 5. TRANSFER HOLDS ──
      await execute(
        'UPDATE holds SET account_id = $1 WHERE account_id = $2',
        [keepId, deleteId]
      );

      // ── 6. TRANSFER CUSTOMER ALERT DISMISSALS ──
      await execute(
        'UPDATE customer_alert_dismissals SET account_id = $1 WHERE account_id = $2',
        [keepId, deleteId]
      );

      // ── 7. SOFT-DELETE THE MERGED ACCOUNT ──
      await execute('UPDATE accounts SET deleted_at = NOW() WHERE id = $1', [deleteId]);

      // ── 8. MARK FLAG AS MERGED ──
      await execute("UPDATE duplicate_flags SET status = 'merged', resolved_at = NOW() WHERE id = $1", [req.params.flagId]);

      await logAudit(req, 'account', deleteId, 'duplicate_merge', {
        merged_into: keepId,
        kept_account: keepAcct.shop_name,
        deleted_account: deleteAcct.shop_name,
        notes_transferred: notesTransferred,
        activities_transferred: activitiesTransferred,
        sales_transferred: salesTransferred,
        fields_merged: mergedFields,
      });

      const summary = [
        `"${deleteAcct.shop_name}" merged into "${keepAcct.shop_name}".`,
        notesTransferred > 0 ? `${notesTransferred} note(s)` : null,
        activitiesTransferred > 0 ? `${activitiesTransferred} activity record(s)` : null,
        salesTransferred > 0 ? `${salesTransferred} sales record(s)` : null,
        mergedFields.length > 0 ? `${mergedFields.length} field(s) filled in` : null,
      ].filter(Boolean).join(' | ');

      res.json({ success: true, message: summary, notesTransferred, activitiesTransferred, salesTransferred, fieldsMerged: mergedFields });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Admin: dismiss a duplicate flag (not actually duplicate)
  app.post('/api/admin/duplicates/:flagId/dismiss', authenticate, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ error: 'Admin or manager only' });
    try {
      await execute("UPDATE duplicate_flags SET status = 'dismissed', resolved_at = NOW() WHERE id = $1", [req.params.flagId]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ TEAM ACTIVITY TRACKER ═══
  // Restricted to specific management users: Adam(1), Frank(4), Manny Pacheco(7), Pino(18)
  const ACTIVITY_TRACKER_USER_IDS = [1, 4, 7, 18];
  function canAccessActivityTracker(req, res) {
    if (!ACTIVITY_TRACKER_USER_IDS.includes(req.user.userId)) {
      res.status(403).json({ error: 'Access restricted' });
      return false;
    }
    return true;
  }

  // GET /api/admin/team-activity?period=today|this_week|prior_week|month&month=2026-04&rep_id=3
  app.get('/api/admin/team-activity', authenticate, async (req, res) => {
    if (!canAccessActivityTracker(req, res)) return;
    try {
      const period = req.query.period || 'this_week';
      const repId = req.query.rep_id ? parseInt(req.query.rep_id) : null;
      const monthParam = req.query.month; // e.g. "2026-04"

      // Calculate date range
      let startDate, endDate;
      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      if (period === 'today') {
        startDate = today;
        endDate = today;
      } else if (period === 'this_week') {
        const day = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        startDate = monday.toISOString().slice(0, 10);
        endDate = today;
      } else if (period === 'prior_week') {
        const day = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        const priorMonday = new Date(monday);
        priorMonday.setDate(monday.getDate() - 7);
        const priorSunday = new Date(monday);
        priorSunday.setDate(monday.getDate() - 1);
        startDate = priorMonday.toISOString().slice(0, 10);
        endDate = priorSunday.toISOString().slice(0, 10);
      } else if (period === 'month' && monthParam) {
        startDate = `${monthParam}-01`;
        const [y, m] = monthParam.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        endDate = `${monthParam}-${String(lastDay).padStart(2, '0')}`;
      } else {
        // default: this month
        const ym = now.toISOString().slice(0, 7);
        startDate = `${ym}-01`;
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        endDate = `${ym}-${String(lastDay).padStart(2, '0')}`;
      }

      // 1) Ranking: note count + follow-up count per rep in period
      const rankingQuery = `
        SELECT u.id as rep_id, u.first_name, u.last_name,
          COALESCE(nc.note_count, 0)::int as note_count,
          COALESCE(fc.followup_count, 0)::int as followup_count,
          (COALESCE(nc.note_count, 0) + COALESCE(fc.followup_count, 0))::int as total_activity
        FROM users u
        LEFT JOIN (
          SELECT created_by_id, COUNT(*) as note_count
          FROM notes
          WHERE created_at::date >= $1 AND created_at::date <= $2
          GROUP BY created_by_id
        ) nc ON nc.created_by_id = u.id
        LEFT JOIN (
          SELECT a.assigned_rep_id, COUNT(*) as followup_count
          FROM accounts a
          WHERE a.follow_up_date >= $1::date AND a.follow_up_date <= $2::date
            AND a.deleted_at IS NULL
          GROUP BY a.assigned_rep_id
        ) fc ON fc.assigned_rep_id = u.id
        WHERE u.is_active = true AND u.role = 'rep'
        ORDER BY total_activity DESC, note_count DESC
      `;
      const ranking = await queryAll(rankingQuery, [startDate, endDate]);

      // 2) If a specific rep is requested, get their notes grouped by account
      let repNotes = [];
      let repFollowUps = [];
      if (repId) {
        const notesQuery = `
          SELECT n.id, n.content, n.created_at, n.is_voice_transcribed,
            a.id as account_id, a.shop_name, a.city, a.account_category,
            u.first_name as author_first, u.last_name as author_last, u.id as author_id,
            (SELECT json_agg(json_build_object(
              'id', r.id, 'content', r.content, 'created_at', r.created_at,
              'author_first', ru.first_name, 'author_last', ru.last_name
            ) ORDER BY r.created_at ASC)
            FROM notes r
            JOIN users ru ON ru.id = r.created_by_id
            WHERE r.content LIKE '[Manager Reply to #' || n.id || ']%'
            ) as replies
          FROM notes n
          JOIN accounts a ON a.id = n.account_id
          JOIN users u ON u.id = n.created_by_id
          WHERE n.created_by_id = $3
            AND n.created_at::date >= $1 AND n.created_at::date <= $2
            AND a.deleted_at IS NULL
            AND n.content NOT LIKE '[Manager Reply to #%'
          ORDER BY a.shop_name ASC, n.created_at DESC
        `;
        repNotes = await queryAll(notesQuery, [startDate, endDate, repId]);

        const followUpQuery = `
          SELECT a.id as account_id, a.shop_name, a.city, a.follow_up_date,
            a.account_category, a.status,
            (SELECT LEFT(n2.content, 200) FROM notes n2
             WHERE n2.account_id = a.id
             ORDER BY n2.created_at DESC LIMIT 1) as latest_note,
            (SELECT json_agg(json_build_object(
              'id', mr.id, 'content', mr.content, 'created_at', mr.created_at,
              'author_first', mu.first_name, 'author_last', mu.last_name
            ) ORDER BY mr.created_at ASC)
            FROM notes mr
            JOIN users mu ON mu.id = mr.created_by_id
            WHERE mr.account_id = a.id
              AND mr.content LIKE '[Manager Note]%'
              AND mr.created_at::date >= $1
            ) as manager_notes
          FROM accounts a
          WHERE a.assigned_rep_id = $3
            AND a.follow_up_date >= $1::date AND a.follow_up_date <= $2::date
            AND a.deleted_at IS NULL
          ORDER BY a.follow_up_date ASC
        `;
        repFollowUps = await queryAll(followUpQuery, [startDate, endDate, repId]);
      }

      res.json({
        period, startDate, endDate,
        ranking: ranking.map((r, i) => ({ ...r, rank: i + 1 })),
        repNotes,
        repFollowUps
      });
    } catch (e) {
      console.error('team-activity error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/team-activity/reply — manager replies to a specific note
  app.post('/api/admin/team-activity/reply', authenticate, async (req, res) => {
    if (!canAccessActivityTracker(req, res)) return;
    try {
      const { note_id, account_id, content } = req.body;
      if (!content || !content.trim()) return res.status(400).json({ error: 'Reply content required' });
      if (!account_id) return res.status(400).json({ error: 'account_id required' });

      const prefix = note_id ? `[Manager Reply to #${note_id}]` : '[Manager Note]';
      const fullContent = `${prefix} ${content.trim()}`;

      const result = await queryOne(
        'INSERT INTO notes (account_id, created_by_id, content, is_voice_transcribed, created_at) VALUES ($1, $2, $3, false, NOW()) RETURNING id, created_at',
        [account_id, req.user.userId, fullContent]
      );
      await logAudit(req, 'note', result.id, 'create', { type: 'manager_reply', original_note_id: note_id, account_id });

      const author = await queryOne('SELECT first_name, last_name FROM users WHERE id=$1', [req.user.userId]);
      res.json({
        success: true,
        reply: {
          id: result.id,
          content: fullContent,
          created_at: result.created_at,
          author_first: author?.first_name,
          author_last: author?.last_name
        }
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// ============================================================================
//  CHC CRM — Daily Report + Comments + Notifications
//  PASTE THIS BLOCK INTO backend/server.js
//
//  Insert location: anywhere AFTER the existing routes (e.g. after the
//  duplicates routes around line 2081), BUT BEFORE the static frontend lines:
//
//      // Serve frontend
//      const frontendPath = path.join(__dirname, '../frontend/dist');
//      app.use(express.static(frontendPath));
//      app.get('*', ...)
//
//  This block uses ONLY the helpers already imported at the top of server.js:
//  queryAll, queryOne, execute, authenticate, logAudit, getPool.
//  No new npm packages required.
// ============================================================================

  // ─── HELPER: role check (manager or admin) ───
  const isManagerOrAdmin = (u) => u && (u.role === 'manager' || u.role === 'admin');

  // ─── HELPER: parse @mentions like @firstname.lastname or @firstname ───
  async function parseMentions(text) {
    const matches = [...new Set((text.match(/@([a-zA-Z][a-zA-Z0-9._-]{1,40})/g) || []).map(m => m.slice(1).toLowerCase()))];
    if (!matches.length) return [];
    const users = await queryAll(
      `SELECT id, first_name, last_name FROM users WHERE is_active = true`
    );
    const ids = new Set();
    for (const handle of matches) {
      const [first, last] = handle.split('.');
      const hit = users.find(u => {
        const f = (u.first_name || '').toLowerCase();
        const l = (u.last_name || '').toLowerCase();
        if (last) return f === first && l === last;
        return f === first || `${f}.${l}` === handle;
      });
      if (hit) ids.add(hit.id);
    }
    return [...ids];
  }

  // ============================================================================
  //  DAILY REPORT
  // ============================================================================

  // GET /api/daily-report           → today's personal report (auto-generates if missing)
  // GET /api/daily-report?date=YYYY-MM-DD → that day's personal report
  // GET /api/daily-report?team=true → manager/admin only: full team rollup for today
  app.get('/api/daily-report', authenticate, async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);

      if (req.query.team === 'true') {
        if (!isManagerOrAdmin(req.user)) {
          return res.status(403).json({ error: 'Manager or admin only' });
        }
        // Generate fresh reports for every active rep, then return them grouped
        // Only include actual sales reps in team activity rollup — exclude managers/admins
        const reps = await queryAll(
          `SELECT id, first_name, last_name, role FROM users
           WHERE is_active = true AND role = 'rep'
           ORDER BY first_name, last_name`
        );
        const reports = [];
        for (const r of reps) {
          const payload = await queryOne(
            `SELECT public.fn_generate_daily_report($1, $2::date) AS payload`,
            [r.id, date]
          );
          reports.push({
            user_id: r.id,
            first_name: r.first_name,
            last_name: r.last_name,
            role: r.role,
            report: payload?.payload || null
          });
        }
        const teamTotals = reports.reduce((acc, r) => {
          if (!r.report) return acc;
          acc.notes_count += r.report.notes_count || 0;
          acc.followups_due_today += r.report.followups_due_today || 0;
          acc.followups_overdue += r.report.followups_overdue || 0;
          acc.followups_upcoming_7d += r.report.followups_upcoming_7d || 0;
          acc.holds_count += r.report.holds_count || 0;
          acc.reorder_alerts_count += r.report.reorder_alerts_count || 0;
          return acc;
        }, { notes_count: 0, followups_due_today: 0, followups_overdue: 0, followups_upcoming_7d: 0, holds_count: 0, reorder_alerts_count: 0 });
        // Get full holds list for team view (managers see all holds)
        const allHolds = await queryAll(
          `SELECT h.id, h.intranet_id, h.customer_name, h.branch, h.reason,
                  h.added_at, h.added_by, h.updates, h.intranet_updated_at,
                  h.account_id, h.rep_id,
                  CASE WHEN h.added_at IS NULL THEN NULL ELSE (CURRENT_DATE - h.added_at::date)::int END AS days_on_hold,
                  jsonb_array_length(COALESCE(h.updates,'[]'::jsonb)) AS update_count,
                  a.shop_name, u.first_name AS rep_first_name, u.last_name AS rep_last_name
             FROM public.holds h
             LEFT JOIN public.accounts a ON a.id = h.account_id
             LEFT JOIN public.users u ON u.id = h.rep_id
            WHERE h.is_active = true
            ORDER BY h.added_at DESC NULLS LAST`
        );
        const unassignedHolds = (allHolds || []).filter(h => !h.rep_id && (!h.account_id)).length;
        // Override the team holds_count with the actual total
        teamTotals.holds_count = (allHolds || []).length;
        return res.json({ team: true, date, totals: teamTotals, reports, unassigned_holds: unassignedHolds, holds_list: allHolds || [] });
      }

      // Personal report
      const result = await queryOne(
        `SELECT public.fn_generate_daily_report($1, $2::date) AS payload`,
        [req.user.userId, date]
      );
      let payload = result?.payload || null;

      // Enrich holds: if the DB function returned 0 holds, query via account assignment
      // (matches the same logic the On Hold page uses)
      if (payload && (payload.holds_count === 0 || !payload.holds_list || payload.holds_list.length === 0)) {
        const userRole = req.user.role;
        let holdsQuery;
        let holdsParams;
        if (userRole === 'admin' || userRole === 'manager') {
          // Admins/managers see all holds in personal report too
          holdsQuery = `SELECT h.id, h.intranet_id, h.customer_name, h.account_id, h.branch, h.reason,
                    h.added_at, h.added_by,
                    CASE WHEN h.added_at IS NULL THEN NULL ELSE (CURRENT_DATE - h.added_at::date)::int END AS days_on_hold,
                    jsonb_array_length(COALESCE(h.updates,'[]'::jsonb)) AS update_count,
                    h.updates,
                    (SELECT u2 FROM jsonb_array_elements(COALESCE(h.updates,'[]'::jsonb)) WITH ORDINALITY AS t2(u2, ord2)
                     ORDER BY ord2 DESC LIMIT 1) AS latest_update
               FROM public.holds h WHERE h.is_active = true ORDER BY h.added_at DESC NULLS LAST`;
          holdsParams = [];
        } else {
          // Reps see holds linked via account assignment
          holdsQuery = `SELECT h.id, h.intranet_id, h.customer_name, h.account_id, h.branch, h.reason,
                    h.added_at, h.added_by,
                    CASE WHEN h.added_at IS NULL THEN NULL ELSE (CURRENT_DATE - h.added_at::date)::int END AS days_on_hold,
                    jsonb_array_length(COALESCE(h.updates,'[]'::jsonb)) AS update_count,
                    h.updates,
                    (SELECT u2 FROM jsonb_array_elements(COALESCE(h.updates,'[]'::jsonb)) WITH ORDINALITY AS t2(u2, ord2)
                     ORDER BY ord2 DESC LIMIT 1) AS latest_update
               FROM public.holds h
              WHERE h.is_active = true
                AND (h.rep_id = $1 OR h.account_id IN (SELECT id FROM accounts WHERE rep_id = $1 AND deleted_at IS NULL))
              ORDER BY h.added_at DESC NULLS LAST`;
          holdsParams = [req.user.userId];
        }
        const holdRows = await queryAll(holdsQuery, holdsParams);
        if (holdRows && holdRows.length > 0) {
          payload.holds_count = holdRows.length;
          payload.holds_list = holdRows;
        }
      }

      res.json({ team: false, date, report: payload });
    } catch (e) {
      console.error('daily-report error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================================
  //  CUSTOMER ALERTS  (lapsed 60+ day customers with purchase history)
  // ============================================================================

  app.get('/api/customer-alerts', authenticate, async (req, res) => {
    try {
      // Compute lapsed customers: 60+ days since last order, 4+ orders historically
      // Includes their top categories, product lines, total revenue, and linked account/rep
      const alerts = await queryAll(`
        WITH customer_dates AS (
          SELECT customer_name, sale_date::date AS d
          FROM sales_data
          WHERE sale_date IS NOT NULL AND sale_date <> ''
          GROUP BY customer_name, sale_date::date
        ),
        gaps AS (
          SELECT customer_name, d,
            d - LAG(d) OVER (PARTITION BY customer_name ORDER BY d) AS gap_days
          FROM customer_dates
        ),
        cadence AS (
          SELECT customer_name,
            COUNT(*) + 1 AS order_count,
            ROUND(AVG(gap_days))::int AS avg_gap_days,
            MAX(d) AS last_order_date,
            (CURRENT_DATE - MAX(d))::int AS days_since_last
          FROM gaps
          WHERE gap_days IS NOT NULL
          GROUP BY customer_name
          HAVING COUNT(*) >= 3
        ),
        lapsed AS (
          SELECT * FROM cadence WHERE days_since_last > 60
        ),
        cat_agg AS (
          SELECT s.customer_name,
            array_agg(DISTINCT s.category ORDER BY s.category) FILTER (WHERE s.category IS NOT NULL AND s.category <> '') AS categories,
            array_agg(DISTINCT s.product_line ORDER BY s.product_line) FILTER (WHERE s.product_line IS NOT NULL AND s.product_line <> '') AS product_lines,
            SUM(s.sale_amount) AS total_revenue,
            MAX(s.salesperson) AS salesperson
          FROM sales_data s
          WHERE s.customer_name IN (SELECT customer_name FROM lapsed)
          GROUP BY s.customer_name
        )
        SELECT
          l.customer_name,
          l.order_count,
          l.avg_gap_days,
          l.last_order_date,
          l.days_since_last,
          c.categories,
          c.product_lines,
          ROUND(c.total_revenue::numeric, 2) AS total_revenue,
          c.salesperson,
          a.id AS account_id,
          a.shop_name,
          a.status AS account_status,
          COALESCE(a.assigned_rep_id, sp_user.id) AS rep_id,
          COALESCE(u.first_name, sp_user.first_name) AS rep_first_name,
          COALESCE(u.last_name, sp_user.last_name) AS rep_last_name
        FROM lapsed l
        JOIN cat_agg c ON c.customer_name = l.customer_name
        LEFT JOIN accounts a ON a.deleted_at IS NULL
          AND (LOWER(a.shop_name) = LOWER(l.customer_name) OR LOWER(a.pcr_shop_name) = LOWER(l.customer_name))
        LEFT JOIN users u ON a.assigned_rep_id = u.id
        LEFT JOIN users sp_user ON u.id IS NULL
          AND sp_user.is_active = true
          AND LOWER(TRIM(c.salesperson)) = LOWER(TRIM(sp_user.first_name || ' ' || sp_user.last_name))
        WHERE NOT EXISTS (
          SELECT 1 FROM customer_alert_dismissals d
          WHERE LOWER(d.customer_name) = LOWER(l.customer_name)
        )
        ORDER BY c.total_revenue DESC NULLS LAST
      `);
      res.json({ alerts, total: alerts.length });
    } catch (e) {
      console.error('customer-alerts error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── DISMISS a customer from the alerts page (admin/manager only) ───
  // Body: { customer_name, reason: 'closed'|'no_longer_ppg'|'other', notes?, account_id? }
  // Persists a dismissal row and, when an account is linked, drops a note on the account card.
  app.post('/api/customer-alerts/dismiss', authenticate, async (req, res) => {
    try {
      // Open to any authenticated user — every dismissal is audited and reversible.
      const { customer_name, reason, notes, account_id } = req.body || {};
      if (!customer_name || typeof customer_name !== 'string') return res.status(400).json({ error: 'customer_name required' });
      const allowedReasons = ['closed', 'no_longer_ppg', 'other'];
      if (!allowedReasons.includes(reason)) return res.status(400).json({ error: 'invalid reason' });
      const cleanNotes = (notes || '').toString().slice(0, 50).trim() || null;

      // Upsert by lowercased customer_name to avoid duplicates with case differences
      const existing = await queryOne('SELECT id FROM customer_alert_dismissals WHERE LOWER(customer_name) = LOWER($1)', [customer_name]);
      if (existing) {
        await execute(
          'UPDATE customer_alert_dismissals SET reason=$1, notes=$2, account_id=$3, dismissed_by_id=$4, dismissed_at=NOW() WHERE id=$5',
          [reason, cleanNotes, account_id || null, req.user.userId, existing.id]
        );
      } else {
        await execute(
          'INSERT INTO customer_alert_dismissals (customer_name, reason, notes, account_id, dismissed_by_id) VALUES ($1,$2,$3,$4,$5)',
          [customer_name, reason, cleanNotes, account_id || null, req.user.userId]
        );
      }

      // If the customer is linked to an account, append a note to that account's card
      // so the rep sees why it's been removed from alerts.
      if (account_id) {
        const reasonLabel = reason === 'closed' ? 'Closed'
          : reason === 'no_longer_ppg' ? 'No longer PPG'
          : 'Other';
        const noteContent = `[Customer Alerts — Dismissed] Reason: ${reasonLabel}${cleanNotes ? ` — ${cleanNotes}` : ''}`;
        try {
          await execute(
            'INSERT INTO notes (account_id, created_by_id, content) VALUES ($1,$2,$3)',
            [account_id, req.user.userId, noteContent]
          );
        } catch (e) { console.warn('dismiss: failed to attach note:', e.message); }
      }

      await logAudit(req, 'customer_alert', 0, 'dismiss', { customer_name, reason, notes: cleanNotes, account_id });
      res.json({ ok: true });
    } catch (e) {
      console.error('alerts/dismiss error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── LIST currently-dismissed customers (admin/manager only) ───
  app.get('/api/customer-alerts/dismissed', authenticate, async (req, res) => {
    try {
      const rows = await queryAll(
        `SELECT d.id, d.customer_name, d.reason, d.notes, d.account_id, d.dismissed_at,
                u.first_name AS by_first_name, u.last_name AS by_last_name
         FROM customer_alert_dismissals d
         LEFT JOIN users u ON d.dismissed_by_id = u.id
         ORDER BY d.dismissed_at DESC`
      );
      res.json({ dismissed: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── RESTORE (un-dismiss) a customer back onto the alerts page ───
  app.delete('/api/customer-alerts/dismiss/:id', authenticate, async (req, res) => {
    try {
      const row = await queryOne('SELECT * FROM customer_alert_dismissals WHERE id=$1', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Not found' });
      await execute('DELETE FROM customer_alert_dismissals WHERE id=$1', [req.params.id]);
      await logAudit(req, 'customer_alert', 0, 'restore', { customer_name: row.customer_name });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================================
  //  REORDER ALERTS
  // ============================================================================

  // GET /api/reorder-alerts — all active alerts (managers see all, reps see own)
  app.get('/api/reorder-alerts', authenticate, async (req, res) => {
    try {
      const isRep = req.user.role === 'rep';
      const sql = isRep
        ? `SELECT ra.*, a.shop_name FROM reorder_alerts ra
           LEFT JOIN accounts a ON ra.account_id = a.id
           WHERE ra.rep_id = $1 AND ra.alert_status NOT IN ('resolved')
           ORDER BY ra.days_overdue DESC`
        : `SELECT ra.*, a.shop_name, u.first_name AS rep_first_name, u.last_name AS rep_last_name
           FROM reorder_alerts ra
           LEFT JOIN accounts a ON ra.account_id = a.id
           LEFT JOIN users u ON ra.rep_id = u.id
           WHERE ra.alert_status NOT IN ('resolved')
           ORDER BY ra.days_overdue DESC`;
      const alerts = isRep
        ? await queryAll(sql, [req.user.userId])
        : await queryAll(sql);
      res.json({ alerts, total: alerts.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reorder-alerts/:id/acknowledge — mark as acknowledged
  app.put('/api/reorder-alerts/:id/acknowledge', authenticate, async (req, res) => {
    try {
      await execute(
        `UPDATE reorder_alerts SET alert_status = 'acknowledged', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/reorder-alerts/:id/snooze — snooze for N days
  app.put('/api/reorder-alerts/:id/snooze', authenticate, async (req, res) => {
    try {
      const days = parseInt(req.body.days) || 7;
      await execute(
        `UPDATE reorder_alerts SET alert_status = 'snoozed', snoozed_until = CURRENT_DATE + $1, updated_at = NOW() WHERE id = $2`,
        [days, req.params.id]
      );
      res.json({ ok: true, snoozed_until: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/refresh-reorder-alerts — manual refresh (admin only)
  app.post('/api/admin/refresh-reorder-alerts', authenticate, async (req, res) => {
    try {
      if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
      const result = await queryOne('SELECT public.refresh_reorder_alerts() AS result');
      res.json(result?.result || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================================
  //  DOCUMENT VAULT  (per-account file storage)
  // ============================================================================

  const docsDir = path.join(__dirname, 'uploads', 'documents');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const documentUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, docsDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${req.params.id}-${Date.now()}${ext}`);
      }
    }),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (req, file, cb) => {
      const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.xls', '.xlsx', '.csv', '.txt'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  });

  // GET /api/accounts/:id/documents — list all documents for an account
  app.get('/api/accounts/:id/documents', authenticate, async (req, res) => {
    try {
      const docs = await queryAll(
        `SELECT d.*, u.first_name, u.last_name FROM account_documents d
         LEFT JOIN users u ON d.uploaded_by_id = u.id
         WHERE d.account_id = $1 AND d.is_active = TRUE
         ORDER BY d.document_type, d.created_at DESC`,
        [req.params.id]
      );
      res.json({ documents: docs });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/accounts/:id/documents — upload a document
  app.post('/api/accounts/:id/documents', authenticate, documentUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid file type' });
      const { document_type, title, description, expires_at } = req.body;
      if (!document_type || !title) return res.status(400).json({ error: 'document_type and title required' });
      const filePath = `/uploads/documents/${req.file.filename}`;
      const { lastId } = await execute(
        `INSERT INTO account_documents (account_id, document_type, title, description, file_path, original_filename, file_size, mime_type, uploaded_by_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [req.params.id, document_type, title, description || null, filePath, req.file.originalname, req.file.size, req.file.mimetype, req.user.userId, expires_at || null]
      );
      await logAudit(req, 'account_document', lastId, 'create', { title, document_type, account_id: req.params.id });
      const doc = await queryOne('SELECT d.*, u.first_name, u.last_name FROM account_documents d LEFT JOIN users u ON d.uploaded_by_id = u.id WHERE d.id = $1', [lastId]);
      res.status(201).json({ document: doc });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/documents/:docId — soft-delete a document
  app.delete('/api/documents/:docId', authenticate, async (req, res) => {
    try {
      await execute('UPDATE account_documents SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [req.params.docId]);
      await logAudit(req, 'account_document', parseInt(req.params.docId), 'delete', {});
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Serve uploaded document files
  app.get('/uploads/documents/:filename', authenticate, (req, res) => {
    const filePath = path.join(docsDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  });

  // ============================================================================
  //  NOTIFICATIONS  (in-app only — no email/SMS)
  // ============================================================================

  // GET /api/notifications        → unread + recent for the bell dropdown
  // GET /api/notifications?all=true → include read items (last 50)
  app.get('/api/notifications', authenticate, async (req, res) => {
    try {
      const includeRead = req.query.all === 'true';
      const sql = includeRead
        ? `SELECT n.*, u.first_name AS actor_first_name, u.last_name AS actor_last_name
           FROM notifications n LEFT JOIN users u ON n.actor_id = u.id
           WHERE n.recipient_id = $1
           ORDER BY n.created_at DESC LIMIT 50`
        : `SELECT n.*, u.first_name AS actor_first_name, u.last_name AS actor_last_name
           FROM notifications n LEFT JOIN users u ON n.actor_id = u.id
           WHERE n.recipient_id = $1 AND n.is_read = false
           ORDER BY n.created_at DESC LIMIT 50`;
      const notifications = await queryAll(sql, [req.user.userId]);
      const countRow = await queryOne(
        `SELECT COUNT(*) AS unread FROM notifications WHERE recipient_id = $1 AND is_read = false`,
        [req.user.userId]
      );
      res.json({ notifications, unread_count: parseInt(countRow?.unread) || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/notifications/:id/read → mark one as read
  app.post('/api/notifications/:id/read', authenticate, async (req, res) => {
    try {
      await execute(
        `UPDATE notifications SET is_read = true, read_at = NOW()
         WHERE id = $1 AND recipient_id = $2`,
        [req.params.id, req.user.userId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/notifications/read-all → mark every unread as read
  app.post('/api/notifications/read-all', authenticate, async (req, res) => {
    try {
      await execute(
        `UPDATE notifications SET is_read = true, read_at = NOW()
         WHERE recipient_id = $1 AND is_read = false`,
        [req.user.userId]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/notifications/preview → unread count + 5 newest unread
  app.get('/api/notifications/preview', authenticate, async (req, res) => {
    try {
      const rows = await queryAll(
        `SELECT id, type, source_table, source_id, note_id, preview_text, is_read, created_at
           FROM notifications
          WHERE recipient_id = $1 AND is_read = false
          ORDER BY created_at DESC
          LIMIT 5`,
        [req.user.userId]
      );
      const countRow = await queryOne(
        `SELECT COUNT(*)::int AS unread_count FROM notifications
          WHERE recipient_id = $1 AND is_read = false`,
        [req.user.userId]
      );
      res.json({ unread_count: countRow?.unread_count || 0, items: rows || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/notifications/team-digest → manager/admin team rollup
  app.get('/api/notifications/team-digest', authenticate, async (req, res) => {
    try {
      if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
      const rows = await queryAll(
        `SELECT u.id AS user_id, u.first_name, u.last_name,
                COUNT(n.id) FILTER (WHERE n.is_read = false)::int AS unread_count,
                MAX(n.created_at) AS latest_at
           FROM users u
           LEFT JOIN notifications n ON n.recipient_id = u.id
          WHERE u.is_active = true
          GROUP BY u.id, u.first_name, u.last_name
          ORDER BY unread_count DESC, u.first_name ASC`
      );
      res.json({ team: rows || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================================
  //  HOLDS  (synced daily from CHC Intranet Supabase project)
  // ============================================================================

  // GET /api/holds → list of active holds
  //   Reps see only holds where rep_id = themselves.
  //   Managers/admins see all (or filter ?rep_id=, ?branch=, ?q=)
  app.get('/api/holds', authenticate, async (req, res) => {
    try {
      const where = ['h.is_active = true'];
      const params = [];
      let i = 1;
      if (!isManagerOrAdmin(req.user)) {
        // Match holds assigned directly to rep OR linked via account assignment
        // This matches the fn_generate_daily_report logic
        where.push(`(h.rep_id = $${i} OR h.account_id IN (SELECT id FROM accounts WHERE rep_id = $${i} AND deleted_at IS NULL))`);
        params.push(req.user.userId);
        i++;
      } else if (req.query.rep_id) {
        const repId = parseInt(req.query.rep_id, 10);
        where.push(`(h.rep_id = $${i} OR h.account_id IN (SELECT id FROM accounts WHERE rep_id = $${i} AND deleted_at IS NULL))`);
        params.push(repId);
        i++;
      }
      if (req.query.branch) {
        where.push(`LOWER(h.branch) = LOWER($${i++})`);
        params.push(req.query.branch);
      }
      if (req.query.q) {
        where.push(`(LOWER(h.customer_name) LIKE LOWER($${i}) OR LOWER(h.reason) LIKE LOWER($${i}))`);
        params.push(`%${req.query.q}%`);
        i++;
      }
      const rows = await queryAll(
        `SELECT h.id, h.intranet_id, h.customer_name, h.branch, h.reason,
                h.added_at, h.added_by,
                COALESCE((
                  SELECT jsonb_agg(u ORDER BY i DESC)
                  FROM jsonb_array_elements(COALESCE(h.updates,'[]'::jsonb)) WITH ORDINALITY AS t(u,i)
                ), '[]'::jsonb) AS updates,
                h.intranet_updated_at,
                h.account_id, h.rep_id, h.synced_at,
                CASE WHEN h.added_at IS NULL THEN NULL ELSE (CURRENT_DATE - h.added_at::date)::int END AS days_on_hold,
                jsonb_array_length(COALESCE(h.updates,'[]'::jsonb)) AS update_count,
                a.shop_name,
                u.first_name AS rep_first_name, u.last_name AS rep_last_name
           FROM public.holds h
           LEFT JOIN public.accounts a ON a.id = h.account_id
           LEFT JOIN public.users    u ON u.id = h.rep_id
          WHERE ${where.join(' AND ')}
          ORDER BY h.added_at DESC NULLS LAST`,
        params
      );

      // Summary counts (manager view gets totals, rep view gets their own)
      const totRow = await queryOne(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE rep_id IS NULL
                  AND (account_id IS NULL OR account_id NOT IN (SELECT id FROM accounts WHERE rep_id IS NOT NULL AND deleted_at IS NULL)))::int AS unassigned,
                MAX(intranet_updated_at) AS source_last_update,
                (MAX(intranet_updated_at) IS NULL OR MAX(intranet_updated_at) < NOW() - INTERVAL '48 hours') AS source_stale
           FROM public.holds WHERE is_active = true`
      );
      res.json({
        holds: rows || [],
        total_active: totRow?.total || 0,
        unassigned: totRow?.unassigned || 0,
        source_last_update: totRow?.source_last_update || null,
        source_stale: !!totRow?.source_stale,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/holds/by-rep → manager rollup: count per rep
  app.get('/api/holds/by-rep', authenticate, async (req, res) => {
    try {
      if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
      const rows = await queryAll(
        `SELECT u.id AS rep_id, u.first_name, u.last_name,
                COUNT(DISTINCT h.id)::int AS holds_count,
                COALESCE(SUM(jsonb_array_length(COALESCE(h.updates,'[]'::jsonb))),0)::int AS update_count
           FROM public.users u
           LEFT JOIN public.holds h ON h.is_active = true
             AND (h.rep_id = u.id OR h.account_id IN (SELECT id FROM accounts WHERE rep_id = u.id AND deleted_at IS NULL))
          WHERE u.is_active = true
          GROUP BY u.id, u.first_name, u.last_name
          ORDER BY holds_count DESC, u.first_name`
      );
      const unassigned = await queryOne(
        `SELECT COUNT(*)::int AS c FROM public.holds
          WHERE is_active = true
            AND rep_id IS NULL
            AND (account_id IS NULL OR account_id NOT IN (SELECT id FROM accounts WHERE rep_id IS NOT NULL AND deleted_at IS NULL))`
      );
      res.json({ by_rep: rows || [], unassigned: unassigned?.c || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/holds/:id/assign → manager-only: assign rep_id (and optionally account_id)
  app.put('/api/holds/:id/assign', authenticate, async (req, res) => {
    try {
      if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
      const holdId = parseInt(req.params.id, 10);
      const repId = req.body.rep_id === null ? null : parseInt(req.body.rep_id, 10);
      const accountId = req.body.account_id === undefined ? undefined
                       : (req.body.account_id === null ? null : parseInt(req.body.account_id, 10));

      if (repId !== null && Number.isNaN(repId)) return res.status(400).json({ error: 'invalid rep_id' });

      // Verify rep exists and is a real user
      if (repId !== null) {
        const u = await queryOne(`SELECT id FROM users WHERE id = $1 AND is_active = true`, [repId]);
        if (!u) return res.status(404).json({ error: 'rep not found' });
      }

      let row;
      if (accountId !== undefined) {
        row = await queryOne(
          `UPDATE public.holds SET rep_id = $1, account_id = $2 WHERE id = $3 RETURNING *`,
          [repId, accountId, holdId]
        );
      } else {
        row = await queryOne(
          `UPDATE public.holds SET rep_id = $1 WHERE id = $2 RETURNING *`,
          [repId, holdId]
        );
      }
      if (!row) return res.status(404).json({ error: 'hold not found' });
      await logAudit(req, 'holds', holdId, 'assign', { rep_id: repId, account_id: accountId });
      res.json({ ok: true, hold: row });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/holds/refresh → manager-only manual pull from intranet
  app.post('/api/holds/refresh', authenticate, async (req, res) => {
    try {
      if (!isManagerOrAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
      const result = await syncHoldsFromIntranet();
      await logAudit(req, 'holds', null, 'refresh', result);
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================================
  //  NOTE COMMENTS  (threaded coaching/replies on a note)
  // ============================================================================

  // GET /api/notes/:id/comments → all comments for a note (newest-first)
  app.get('/api/notes/:id/comments', authenticate, async (req, res) => {
    try {
      const note = await queryOne(
        `SELECT n.*, a.assigned_rep_id FROM notes n
         LEFT JOIN accounts a ON a.id = n.account_id
         WHERE n.id = $1`,
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: 'Note not found' });

      // Reps can only read comments on notes for accounts they own or notes they wrote.
      // Managers and admins can read everything.
      if (!isManagerOrAdmin(req.user)
          && note.created_by_id !== req.user.userId
          && note.assigned_rep_id !== req.user.userId) {
        return res.status(403).json({ error: 'Not authorized to view this thread' });
      }

      const comments = await queryAll(
        `SELECT c.*, u.first_name, u.last_name, u.role
         FROM note_comments c
         JOIN users u ON c.author_id = u.id
         WHERE c.note_id = $1
         ORDER BY c.created_at ASC`,
        [req.params.id]
      );
      res.json({ comments });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/notes/:id/comments → add a comment (rep can only reply on their own notes;
  //                                managers/admins can comment on any note)
  app.post('/api/notes/:id/comments', authenticate, async (req, res) => {
    try {
      const body = (req.body.body || '').trim();
      const parentCommentId = req.body.parent_comment_id || null;
      if (!body) return res.status(400).json({ error: 'Comment body required' });
      if (body.length > 4000) return res.status(400).json({ error: 'Comment too long (max 4000 chars)' });

      const note = await queryOne(
        `SELECT n.*, a.assigned_rep_id FROM notes n
         LEFT JOIN accounts a ON a.id = n.account_id
         WHERE n.id = $1`,
        [req.params.id]
      );
      if (!note) return res.status(404).json({ error: 'Note not found' });

      // Permission: managers/admins always allowed. Reps allowed only on their own notes
      // (i.e. they can reply within a thread that involves them).
      const isOwnNote = note.created_by_id === req.user.userId
                       || note.assigned_rep_id === req.user.userId;
      if (!isManagerOrAdmin(req.user) && !isOwnNote) {
        return res.status(403).json({ error: 'Only managers/admins can comment on other reps\' notes' });
      }

      const { lastId } = await execute(
        `INSERT INTO note_comments (note_id, author_id, parent_comment_id, body)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, req.user.userId, parentCommentId, body]
      );

      // Notify the note's author (and parent comment author) — done by DB trigger.
      // Plus parse @mentions and insert into the mentions table (which fires another trigger).
      const mentionedIds = await parseMentions(body);
      for (const uid of mentionedIds) {
        if (uid === req.user.userId) continue;
        try {
          await execute(
            `INSERT INTO mentions (comment_id, mentioned_user_id) VALUES ($1, $2)`,
            [lastId, uid]
          );
        } catch (mErr) {
          console.error('mention insert error:', mErr.message);
        }
      }

      await logAudit(req, 'note_comment', lastId, 'create', { note_id: req.params.id });

      const comment = await queryOne(
        `SELECT c.*, u.first_name, u.last_name, u.role
         FROM note_comments c JOIN users u ON c.author_id = u.id
         WHERE c.id = $1`,
        [lastId]
      );
      res.status(201).json({ comment });
    } catch (e) {
      console.error('comment create error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================================
  //  END daily-report / comments / notifications block
  // ============================================================================

  // Build version — Render sets RENDER_GIT_COMMIT automatically on every deploy
  const BUILD_VERSION = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'dev';
  const BUILD_STARTED_AT = new Date().toISOString();

  // Lightweight endpoint the frontend polls to detect new deploys
  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.json({ version: BUILD_VERSION, startedAt: BUILD_STARTED_AT });
  });

  // Serve frontend static assets.
  // Hashed bundles in /assets can be cached for a year (filenames change on rebuild).
  // index.html MUST NOT be cached — otherwise users stay pinned to old bundle hashes.
  const frontendPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendPath, {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Hashed Vite assets — safe to cache forever
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return;
    // Same no-cache headers for the SPA fallback route
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n  CRM - CHC Paint & Auto Body Supplies`);
    console.log(`  Server running on http://localhost:${PORT}`);
    console.log(`  Database: Supabase PostgreSQL\n`);

    // PCR Sync: sync active customers from pcr_shop_list on every startup
    try {
      console.log('  Syncing active customers from PCR/AccountEdge shop list...');
      const pcrResult = await syncPCRCustomers();
      if (pcrResult.error) {
        console.log(`  PCR sync warning: ${pcrResult.error}`);
      } else {
        console.log(`  PCR sync: ${pcrResult.synced} shops checked, ${pcrResult.created} created, ${pcrResult.updated} updated${pcrResult.churned ? `, ${pcrResult.churned} churned` : ''}`);
      }

      // Also link unlinked sales_data to accounts
      const unlinked = await queryAll(
        'SELECT DISTINCT customer_name FROM sales_data WHERE account_id IS NULL AND customer_name IS NOT NULL'
      );
      let linked = 0;
      for (const row of unlinked) {
        const match = await queryOne(
          'SELECT id FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
          [row.customer_name]
        );
        if (match) {
          await execute('UPDATE sales_data SET account_id = $1 WHERE LOWER(customer_name) = LOWER($2) AND account_id IS NULL', [match.id, row.customer_name]);
          linked++;
        }
      }
      if (linked > 0) console.log(`  Linked ${linked} orphan sales records to accounts`);

      const customerCount = await queryOne("SELECT COUNT(*) as count FROM accounts WHERE account_category = 'customer' AND deleted_at IS NULL");
      console.log(`  Active customers: ${customerCount.count} (controlled by PCR/AccountEdge)`);
    } catch (err) {
      console.error('  PCR sync warning:', err.message);
    }

    // One-time fix: repair double-encoded phone_numbers and email_addresses
    try {
      for (const field of ['phone_numbers', 'email_addresses']) {
        // Find rows where the JSON array contains string elements (double-encoded)
        const badRows = await queryAll(
          `SELECT id, ${field} FROM accounts WHERE deleted_at IS NULL AND ${field} IS NOT NULL AND ${field}::text LIKE '%"{\\\\"number%' OR ${field}::text LIKE '%"{\\\\"address%'`
        );
        let fixed = 0;
        for (const row of badRows) {
          try {
            let arr = typeof row[field] === 'string' ? JSON.parse(row[field]) : row[field];
            if (!Array.isArray(arr)) continue;
            let needsFix = false;
            arr = arr.map(item => {
              if (typeof item === 'string') {
                needsFix = true;
                try { return JSON.parse(item); } catch { return null; }
              }
              return item;
            }).filter(item => item && typeof item === 'object');
            if (needsFix && arr.length > 0) {
              await execute(`UPDATE accounts SET ${field} = $1 WHERE id = $2`, [JSON.stringify(arr), row.id]);
              fixed++;
            }
          } catch (e) { /* skip row */ }
        }
        if (fixed > 0) console.log(`  Fixed ${fixed} accounts with double-encoded ${field}`);
      }
    } catch (err) {
      console.error('  Double-encoding fix warning:', err.message);
    }
  });
}

startServer().catch(err => { console.error('Failed:', err); process.exit(1); });
