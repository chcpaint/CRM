import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { initDatabase } from './db';
import authRoutes from './routes/auth';
import accountRoutes from './routes/accounts';
import notesRoutes from './routes/notes';
import activitiesRoutes from './routes/activities';
import salesRoutes from './routes/sales';
import searchRoutes from './routes/search';

const PORT = process.env.PORT || 3001;

async function startServer() {
  // Initialize database
  await initDatabase();

  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Allow frontend to load
    crossOriginEmbedderPolicy: false
  }));
  app.use(compression());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  // Rate limiting on auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 auth requests per window
    message: { error: 'Too many authentication attempts, please try again later' }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // General API rate limiter
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: 'Too many requests, please try again later' }
  });
  app.use('/api/', apiLimiter);

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api', notesRoutes);
  app.use('/api', activitiesRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/search', searchRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', app: 'Refinish AI CRM', version: '1.0.0' });
  });

  // Serve frontend static files in production
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendPath, 'index.html'));
    }
  });

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║         REFINISH AI CRM SERVER               ║
║   CHC Paint & Auto Body Supplies             ║
║   Running on http://localhost:${PORT}           ║
╚══════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
