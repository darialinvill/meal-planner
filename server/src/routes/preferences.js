import { Router } from 'express';
import { one, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const row = await one(
      'SELECT data, updated_at FROM preferences WHERE household_id = $1',
      [req.user.household_id],
    );
    res.json({ data: row ? JSON.parse(row.data) : {}, updated_at: row?.updated_at || null });
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const data = req.body?.data;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data must be an object' });
    await query(
      `INSERT INTO preferences (household_id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (household_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [req.user.household_id, JSON.stringify(data)],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
