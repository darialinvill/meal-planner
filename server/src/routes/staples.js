import { Router } from 'express';
import { one, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { mondayOf } from '../lib/weeks.js';

const router = Router();
router.use(requireAuth);

router.get('/current', async (req, res, next) => {
  try {
    const weekStart = mondayOf();
    const week = await one(
      'SELECT * FROM weeks WHERE household_id = $1 AND week_start = $2',
      [req.user.household_id, weekStart],
    );
    if (!week) return res.json({ exists: false, week_start: weekStart });

    const staples = JSON.parse(week.staples_json);
    const checks = await query('SELECT staple, needed FROM staples_check WHERE week_id = $1', [week.id]);
    const checkMap = new Map(checks.map((c) => [c.staple, !!c.needed]));

    res.json({
      exists: true,
      week_id: week.id,
      week_start: week.week_start,
      staples: staples.map((s) => ({ name: s, needed: checkMap.get(s) || false })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/check', async (req, res, next) => {
  try {
    const { week_id, staple, needed } = req.body || {};
    if (!week_id || !staple) return res.status(400).json({ error: 'week_id and staple required' });
    const week = await one(
      'SELECT id FROM weeks WHERE id = $1 AND household_id = $2',
      [week_id, req.user.household_id],
    );
    if (!week) return res.status(404).json({ error: 'week not found' });
    await query(
      `INSERT INTO staples_check (week_id, staple, needed) VALUES ($1, $2, $3)
       ON CONFLICT (week_id, staple) DO UPDATE SET needed = EXCLUDED.needed`,
      [week_id, staple, needed ? 1 : 0],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
