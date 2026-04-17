import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getDb } from './database.js';
import { SCHEMA } from './schema.js';
import { seedDatabase } from './seed.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Rate limiting (simple in-memory)
//
// Loopback/localhost is bypassed entirely — when the SPA loads the Dashboard
// it fans out ~12 parallel requests per navigation, and a single analyst
// clicking around for 30 seconds can easily exceed any tight per-minute cap.
// For remote traffic we keep a generous 600/min window which is enough for
// heavy Dashboard use while still blocking runaway scripts.
const rateLimits = new Map();
const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const RATE_LIMIT_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MIN, 10) || 600;

app.use('/api', (req, res, next) => {
  const ip = req.ip;
  if (LOCAL_IPS.has(ip)) return next();

  const now = Date.now();
  const windowMs = 60000;

  if (!rateLimits.has(ip)) rateLimits.set(ip, []);
  const hits = rateLimits.get(ip).filter(t => t > now - windowMs);
  hits.push(now);
  rateLimits.set(ip, hits);

  if (hits.length > RATE_LIMIT_PER_MIN) {
    return res.status(429).json({ error: `Too many requests. Limit: ${RATE_LIMIT_PER_MIN}/minute.` });
  }
  next();
});

// Clean rate limit map every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateLimits) {
    const recent = hits.filter(t => t > now - 60000);
    if (recent.length === 0) rateLimits.delete(ip);
    else rateLimits.set(ip, recent);
  }
}, 300000);

// Initialize DB and routes
async function init() {
  const db = await getDb();
  db.exec(SCHEMA);
  seedDatabase(db);

  // Make db available to routes
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Import and mount routes
  const { default: dealsRouter } = await import('./routes/deals.js');
  const { default: financialsRouter } = await import('./routes/financials.js');
  const { default: comparablesRouter } = await import('./routes/comparables.js');
  const { default: transactionsRouter } = await import('./routes/transactions.js');
  const { default: assumptionsRouter } = await import('./routes/assumptions.js');
  const { default: outputsRouter } = await import('./routes/outputs.js');
  const { default: documentsRouter } = await import('./routes/documents.js');
  const { default: extractionRouter } = await import('./routes/extraction.js');
  const { default: modelsRouter } = await import('./routes/models.js');
  const { default: hitlRouter } = await import('./routes/hitl.js');
  const { default: chatRouter } = await import('./routes/chat.js');
  const { default: dashboardRouter } = await import('./routes/dashboard.js');
  const { default: metaRouter } = await import('./routes/meta.js');
  const { default: settingsRouter } = await import('./routes/settings.js');
  const { default: dataimportRouter } = await import('./routes/dataimport.js');
  const { default: recommendationsRouter } = await import('./routes/recommendations.js');

  app.use('/api/deals', dealsRouter);
  app.use('/api/financials', financialsRouter);
  app.use('/api/comparables', comparablesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/assumptions', assumptionsRouter);
  app.use('/api/outputs', outputsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/extraction', extractionRouter);
  app.use('/api/models', modelsRouter);
  app.use('/api/hitl', hitlRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/import', dataimportRouter);
  // recommendations routes are nested under /api/deals/:id/recommendation
  app.use('/api', recommendationsRouter);

  // Serve frontend in production
  const distPath = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });

  app.listen(PORT, () => {
    console.log(`DealForge server running on http://localhost:${PORT}`);
  });
}

init().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
