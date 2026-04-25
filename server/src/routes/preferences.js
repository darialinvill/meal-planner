import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM preferences WHERE household_id = ?').get(req.user.household_id);
  res.json({ data: row ? JSON.parse(row.data) : {}, updated_at: row?.updated_at || null });
});

router.put('/', (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data must be an object' });
  db.prepare(
    `INSERT INTO preferences (household_id, data, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(household_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(req.user.household_id, JSON.stringify(data));
  res.json({ ok: true });
});

export default router;
