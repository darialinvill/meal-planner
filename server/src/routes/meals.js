import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { mondayOf } from '../lib/weeks.js';
import { generateWeek } from '../lib/ai.js';

const router = Router();
router.use(requireAuth);

function loadWeekRow(householdId, weekStart) {
  return db
    .prepare('SELECT * FROM weeks WHERE household_id = ? AND week_start = ?')
    .get(householdId, weekStart);
}

function loadWeekDetail(weekRow) {
  if (!weekRow) return null;
  const meals = db
    .prepare('SELECT * FROM meals WHERE week_id = ? ORDER BY meal_type, position')
    .all(weekRow.id);

  const votesByMeal = {};
  const voteRows = db
    .prepare(
      `SELECT mv.meal_id, mv.user_id, mv.vote, u.display_name
       FROM meal_votes mv JOIN users u ON u.id = mv.user_id
       WHERE mv.meal_id IN (SELECT id FROM meals WHERE week_id = ?)`,
    )
    .all(weekRow.id);
  for (const v of voteRows) {
    (votesByMeal[v.meal_id] ||= []).push({
      user_id: v.user_id,
      display_name: v.display_name,
      vote: v.vote,
    });
  }

  return {
    id: weekRow.id,
    week_start: weekRow.week_start,
    weekly_theme: weekRow.weekly_theme,
    staples_called_for: JSON.parse(weekRow.staples_json),
    meals: meals.map((m) => ({
      id: m.id,
      meal_type: m.meal_type,
      position: m.position,
      name: m.name,
      description: m.description,
      cuisine: m.cuisine,
      prep_minutes: m.prep_minutes,
      cook_minutes: m.cook_minutes,
      kid_bridge: m.kid_bridge,
      main_ingredients: JSON.parse(m.main_ingredients_json),
      grocery_items: JSON.parse(m.grocery_items_json),
      votes: votesByMeal[m.id] || [],
    })),
  };
}

router.get('/current', (req, res) => {
  const weekStart = mondayOf();
  const week = loadWeekRow(req.user.household_id, weekStart);
  if (!week) return res.json({ exists: false, week_start: weekStart });
  res.json({ exists: true, ...loadWeekDetail(week) });
});

router.get('/week/:weekStart', (req, res) => {
  const week = loadWeekRow(req.user.household_id, req.params.weekStart);
  if (!week) return res.status(404).json({ error: 'week not found' });
  res.json(loadWeekDetail(week));
});

// Manually trigger generation for the current week (or the supplied week_start).
router.post('/generate', async (req, res) => {
  const weekStart = req.body?.week_start || mondayOf();
  const force = !!req.body?.force;

  const existing = loadWeekRow(req.user.household_id, weekStart);
  if (existing && !force) {
    return res.status(409).json({ error: 'week already generated', week: loadWeekDetail(existing) });
  }

  const prefsRow = db
    .prepare('SELECT data FROM preferences WHERE household_id = ?')
    .get(req.user.household_id);
  const preferences = prefsRow ? JSON.parse(prefsRow.data) : {};

  const recentMealNames = db
    .prepare(
      `SELECT m.name FROM meals m JOIN weeks w ON w.id = m.week_id
       WHERE w.household_id = ? AND w.week_start < ?
       ORDER BY w.week_start DESC LIMIT 60`,
    )
    .all(req.user.household_id, weekStart)
    .map((r) => r.name);

  let result;
  try {
    result = await generateWeek({ preferences, weekStart, recentMealNames });
  } catch (err) {
    console.error('generateWeek failed', err);
    return res.status(502).json({ error: 'meal generation failed', detail: err.message });
  }

  const insertWeek = db.prepare(
    `INSERT INTO weeks (household_id, week_start, weekly_theme, staples_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(household_id, week_start) DO UPDATE SET
       weekly_theme = excluded.weekly_theme,
       staples_json = excluded.staples_json
     RETURNING id`,
  );
  const insertMeal = db.prepare(
    `INSERT INTO meals
       (week_id, meal_type, position, name, description, cuisine, prep_minutes, cook_minutes,
        kid_bridge, main_ingredients_json, grocery_items_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const wipeMeals = db.prepare('DELETE FROM meals WHERE week_id = ?');

  db.transaction(() => {
    const weekRow = insertWeek.get(
      req.user.household_id,
      weekStart,
      result.data.weekly_theme,
      JSON.stringify(result.data.staples_called_for),
    );
    wipeMeals.run(weekRow.id);
    const types = [
      ['lunch', result.data.meals.lunches],
      ['dinner', result.data.meals.dinners],
    ];
    for (const [type, list] of types) {
      list.forEach((m, idx) => {
        insertMeal.run(
          weekRow.id,
          type,
          idx + 1,
          m.name,
          m.description,
          m.cuisine,
          m.prep_time_minutes,
          m.cook_time_minutes,
          m.kid_bridge,
          JSON.stringify(m.main_ingredients),
          JSON.stringify(m.grocery_items),
        );
      });
    }
  })();

  const week = loadWeekRow(req.user.household_id, weekStart);
  res.json({ ok: true, ...loadWeekDetail(week), usage: result.usage });
});

router.post('/:mealId/vote', (req, res) => {
  const mealId = Number(req.params.mealId);
  const vote = req.body?.vote;
  if (vote !== 0 && vote !== 1 && vote !== null) {
    return res.status(400).json({ error: 'vote must be 0, 1, or null' });
  }

  const meal = db
    .prepare(
      `SELECT m.id FROM meals m JOIN weeks w ON w.id = m.week_id
       WHERE m.id = ? AND w.household_id = ?`,
    )
    .get(mealId, req.user.household_id);
  if (!meal) return res.status(404).json({ error: 'meal not found' });

  if (vote === null) {
    db.prepare('DELETE FROM meal_votes WHERE meal_id = ? AND user_id = ?').run(mealId, req.user.id);
  } else {
    db.prepare(
      `INSERT INTO meal_votes (meal_id, user_id, vote, voted_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(meal_id, user_id) DO UPDATE SET vote = excluded.vote, voted_at = excluded.voted_at`,
    ).run(mealId, req.user.id, vote);
  }
  res.json({ ok: true });
});

export default router;
