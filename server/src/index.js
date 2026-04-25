import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import { db } from './db.js';
import authRoutes from './routes/auth.js';
import preferencesRoutes from './routes/preferences.js';
import mealsRoutes from './routes/meals.js';
import groceryRoutes from './routes/grocery.js';
import staplesRoutes from './routes/staples.js';
import { startCron } from './jobs/cron.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(
  cookieSession({
    name: 'nourish_session',
    keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/meals', mealsRoutes);
app.use('/api/grocery', groceryRoutes);
app.use('/api/staples', staplesRoutes);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Nourish server listening on http://localhost:${port}`);
  // touch db so any schema migration runs at boot
  db.prepare('SELECT 1').get();
  startCron();
});
