import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema } from './db.js';
import authRoutes from './routes/auth.js';
import preferencesRoutes from './routes/preferences.js';
import mealsRoutes from './routes/meals.js';
import groceryRoutes from './routes/grocery.js';
import staplesRoutes from './routes/staples.js';
import { startCron } from './jobs/cron.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Behind Railway's proxy (or any reverse proxy), trust the X-Forwarded-* headers
// so secure cookies + req.ip work correctly in production.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(
  cookieSession({
    name: 'nourish_session',
    keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/meals', mealsRoutes);
app.use('/api/grocery', groceryRoutes);
app.use('/api/staples', staplesRoutes);

// In production, serve the built React client from the same origin.
// `npm run build` at the project root produces client/dist/.
if (process.env.NODE_ENV === 'production') {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(__dirname, '../../client/dist');
  if (existsSync(clientDist)) {
    console.log('[server] serving client from', clientDist);
    app.use(express.static(clientDist));
    // SPA fallback: any non-/api GET returns index.html so client-side routes work.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(resolve(clientDist, 'index.html'));
    });
  } else {
    console.warn('[server] NODE_ENV=production but', clientDist, 'is missing — did the build run?');
  }
}

// Generic error handler — keeps unhandled promise rejections from killing the process.
app.use((err, _req, res, _next) => {
  console.error('[server]', err);
  res.status(500).json({ error: 'internal server error' });
});

const port = Number(process.env.PORT || 4000);

async function main() {
  try {
    await initSchema();
    console.log('[db] schema ready');
  } catch (err) {
    console.error('[db] schema init failed', err);
    process.exit(1);
  }
  app.listen(port, () => {
    console.log(`Nourish server listening on http://localhost:${port}`);
    startCron();
  });
}

main();
