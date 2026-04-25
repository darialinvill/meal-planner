import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { mondayOf } from '../lib/weeks.js';

const router = Router();
router.use(requireAuth);

function itemKey(item) {
  return `${(item.name || '').trim().toLowerCase()}|${item.category || ''}`;
}

function loadWeek(householdId, weekStart) {
  return db.prepare('SELECT * FROM weeks WHERE household_id = ? AND week_start = ?').get(householdId, weekStart);
}

// Aggregates the meal-derived grocery list:
// - includes each meal where AT LEAST ONE user voted yes
// - dedupes by (lowercased name, category)
// - groups by category, with the contributing meal names attached
function buildGroceryList(weekId) {
  const meals = db
    .prepare(
      `SELECT m.id, m.name, m.grocery_items_json,
              SUM(CASE WHEN mv.vote = 1 THEN 1 ELSE 0 END) AS yes_votes
         FROM meals m
         LEFT JOIN meal_votes mv ON mv.meal_id = m.id
         WHERE m.week_id = ?
         GROUP BY m.id`,
    )
    .all(weekId);

  const approved = meals.filter((m) => (m.yes_votes || 0) >= 1);

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

  const checks = db
    .prepare('SELECT item_key, checked FROM grocery_check WHERE week_id = ?')
    .all(weekId);
  const checkMap = new Map(checks.map((c) => [c.item_key, !!c.checked]));

  const list = Array.from(aggregated.values()).map((e) => ({
    ...e,
    quantities: Array.from(new Set(e.quantities)),
    checked: checkMap.get(e.key) || false,
  }));

  // group by category
  const byCategory = {};
  for (const it of list) (byCategory[it.category] ||= []).push(it);
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  return byCategory;
}

router.get('/current', (req, res) => {
  const weekStart = mondayOf();
  const week = loadWeek(req.user.household_id, weekStart);
  if (!week) return res.json({ exists: false, week_start: weekStart });

  const fromMeals = buildGroceryList(week.id);

  const manual = db
    .prepare(
      `SELECT mg.id, mg.name, mg.category, mg.checked, u.display_name AS added_by_name
         FROM manual_grocery mg JOIN users u ON u.id = mg.added_by
         WHERE mg.week_id = ?
         ORDER BY mg.created_at`,
    )
    .all(week.id);

  res.json({
    exists: true,
    week_id: week.id,
    week_start: week.week_start,
    from_meals: fromMeals,
    manual,
  });
});

router.post('/check', (req, res) => {
  const { week_id, item_key, checked } = req.body || {};
  if (!week_id || !item_key) return res.status(400).json({ error: 'week_id and item_key required' });
  // verify the week belongs to this household
  const week = db.prepare('SELECT id FROM weeks WHERE id = ? AND household_id = ?').get(week_id, req.user.household_id);
  if (!week) return res.status(404).json({ error: 'week not found' });
  db.prepare(
    `INSERT INTO grocery_check (week_id, item_key, checked) VALUES (?, ?, ?)
     ON CONFLICT(week_id, item_key) DO UPDATE SET checked = excluded.checked`,
  ).run(week_id, item_key, checked ? 1 : 0);
  res.json({ ok: true });
});

router.post('/manual', (req, res) => {
  const { week_id, name, category } = req.body || {};
  if (!week_id || !name) return res.status(400).json({ error: 'week_id and name required' });
  const week = db.prepare('SELECT id FROM weeks WHERE id = ? AND household_id = ?').get(week_id, req.user.household_id);
  if (!week) return res.status(404).json({ error: 'week not found' });
  const info = db
    .prepare('INSERT INTO manual_grocery (week_id, added_by, name, category) VALUES (?, ?, ?, ?)')
    .run(week_id, req.user.id, name.trim(), category || null);
  res.json({ id: info.lastInsertRowid });
});

router.post('/manual/:id/check', (req, res) => {
  const id = Number(req.params.id);
  const { checked } = req.body || {};
  const row = db
    .prepare(
      `SELECT mg.id FROM manual_grocery mg JOIN weeks w ON w.id = mg.week_id
       WHERE mg.id = ? AND w.household_id = ?`,
    )
    .get(id, req.user.household_id);
  if (!row) return res.status(404).json({ error: 'item not found' });
  db.prepare('UPDATE manual_grocery SET checked = ? WHERE id = ?').run(checked ? 1 : 0, id);
  res.json({ ok: true });
});

router.delete('/manual/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `SELECT mg.id FROM manual_grocery mg JOIN weeks w ON w.id = mg.week_id
       WHERE mg.id = ? AND w.household_id = ?`,
    )
    .get(id, req.user.household_id);
  if (!row) return res.status(404).json({ error: 'item not found' });
  db.prepare('DELETE FROM manual_grocery WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
