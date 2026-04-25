import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { mondayOf } from '../lib/weeks.js';

const router = Router();
router.use(requireAuth);

router.get('/current', (req, res) => {
  const weekStart = mondayOf();
  const week = db
    .prepare('SELECT * FROM weeks WHERE household_id = ? AND week_start = ?')
    .get(req.user.household_id, weekStart);
  if (!week) return res.json({ exists: false, week_start: weekStart });

  const staples = JSON.parse(week.staples_json);
  const checks = db.prepare('SELECT staple, needed FROM staples_check WHERE week_id = ?').all(week.id);
  const checkMap = new Map(checks.map((c) => [c.staple, !!c.needed]));

  res.json({
    exists: true,
    week_id: week.id,
    week_start: week.week_start,
    staples: staples.map((s) => ({ name: s, needed: checkMap.get(s) || false })),
  });
});

router.post('/check', (req, res) => {
  const { week_id, staple, needed } = req.body || {};
  if (!week_id || !staple) return res.status(400).json({ error: 'week_id and staple required' });
  const week = db.prepare('SELECT id FROM weeks WHERE id = ? AND household_id = ?').get(week_id, req.user.household_id);
  if (!week) return res.status(404).json({ error: 'week not found' });
  db.prepare(
    `INSERT INTO staples_check (week_id, staple, needed) VALUES (?, ?, ?)
     ON CONFLICT(week_id, staple) DO UPDATE SET needed = excluded.needed`,
  ).run(week_id, staple, needed ? 1 : 0);
  res.json({ ok: true });
});

export default router;
