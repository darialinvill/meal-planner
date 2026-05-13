import { Router } from 'express';
import { one, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { mondayOf } from '../lib/weeks.js';

const router = Router();
router.use(requireAuth);

function itemKey(item) {
  return `${(item.name || '').trim().toLowerCase()}|${item.category || ''}`;
}

function loadWeek(householdId, weekStart) {
  return one('SELECT * FROM weeks WHERE household_id = $1 AND week_start = $2', [householdId, weekStart]);
}

async function buildGroceryList(weekId) {
  const meals = await query(
    `SELECT m.id, m.name, m.grocery_items_json,
            COALESCE(SUM(CASE WHEN mv.vote = 1 THEN 1 ELSE 0 END), 0) AS yes_votes
       FROM meals m
       LEFT JOIN meal_votes mv ON mv.meal_id = m.id
       WHERE m.week_id = $1
       GROUP BY m.id`,
    [weekId],
  );

  const approved = meals.filter((m) => Number(m.yes_votes) >= 1);

  const aggregated = new Map();
  for (const m of approved) {
    const items = JSON.parse(m.grocery_items_json);
    for (const it of items) {
      const key = itemKey(it);
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          key,
          name: it.name,
          category: it.category || 'Other',
          store: it.store || '',
          quantities: [],
          for_meals: [],
        });
      }
      const entry = aggregated.get(key);
      if (it.quantity) entry.quantities.push(it.quantity);
      if (!entry.for_meals.includes(m.name)) entry.for_meals.push(m.name);
    }
  }

  const checks = await query('SELECT item_key, checked FROM grocery_check WHERE week_id = $1', [weekId]);
  const checkMap = new Map(checks.map((c) => [c.item_key, !!c.checked]));

  const list = Array.from(aggregated.values()).map((e) => ({
    ...e,
    quantities: Array.from(new Set(e.quantities)),
    checked: checkMap.get(e.key) || false,
  }));

  const byCategory = {};
  for (const it of list) (byCategory[it.category] ||= []).push(it);
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  return byCategory;
}

router.get('/current', async (req, res, next) => {
  try {
    const weekStart = mondayOf();
    const week = await loadWeek(req.user.household_id, weekStart);
    if (!week) return res.json({ exists: false, week_start: weekStart });

    const fromMeals = await buildGroceryList(week.id);

    const manual = await query(
      `SELECT mg.id, mg.name, mg.category, mg.checked, u.display_name AS added_by_name
         FROM manual_grocery mg JOIN users u ON u.id = mg.added_by
         WHERE mg.week_id = $1
         ORDER BY mg.created_at`,
      [week.id],
    );

    res.json({
      exists: true,
      week_id: week.id,
      week_start: week.week_start,
      from_meals: fromMeals,
      manual,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/check', async (req, res, next) => {
  try {
    const { week_id, item_key, checked } = req.body || {};
    if (!week_id || !item_key) return res.status(400).json({ error: 'week_id and item_key required' });
    const week = await one(
      'SELECT id FROM weeks WHERE id = $1 AND household_id = $2',
      [week_id, req.user.household_id],
    );
    if (!week) return res.status(404).json({ error: 'week not found' });
    await query(
      `INSERT INTO grocery_check (week_id, item_key, checked) VALUES ($1, $2, $3)
       ON CONFLICT (week_id, item_key) DO UPDATE SET checked = EXCLUDED.checked`,
      [week_id, item_key, checked ? 1 : 0],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/manual', async (req, res, next) => {
  try {
    const { week_id, name, category } = req.body || {};
    if (!week_id || !name) return res.status(400).json({ error: 'week_id and name required' });
    const week = await one(
      'SELECT id FROM weeks WHERE id = $1 AND household_id = $2',
      [week_id, req.user.household_id],
    );
    if (!week) return res.status(404).json({ error: 'week not found' });
    const row = await one(
      'INSERT INTO manual_grocery (week_id, added_by, name, category) VALUES ($1, $2, $3, $4) RETURNING id',
      [week_id, req.user.id, name.trim(), category || null],
    );
    res.json({ id: row.id });
  } catch (err) {
    next(err);
  }
});

router.post('/manual/:id/check', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { checked } = req.body || {};
    const row = await one(
      `SELECT mg.id FROM manual_grocery mg JOIN weeks w ON w.id = mg.week_id
       WHERE mg.id = $1 AND w.household_id = $2`,
      [id, req.user.household_id],
    );
    if (!row) return res.status(404).json({ error: 'item not found' });
    await query('UPDATE manual_grocery SET checked = $1 WHERE id = $2', [checked ? 1 : 0, id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/manual/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await one(
      `SELECT mg.id FROM manual_grocery mg JOIN weeks w ON w.id = mg.week_id
       WHERE mg.id = $1 AND w.household_id = $2`,
      [id, req.user.household_id],
    );
    if (!row) return res.status(404).json({ error: 'item not found' });
    await query('DELETE FROM manual_grocery WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
