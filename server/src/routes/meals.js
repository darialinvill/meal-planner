import { Router } from 'express';
import { one, query, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { mondayOf, formatWeekRange } from '../lib/weeks.js';
import { generateWeek, generateRecipe } from '../lib/ai.js';
import { sendMenuEmail } from '../lib/email.js';

const router = Router();
router.use(requireAuth);

async function loadWeekRow(householdId, weekStart) {
  return one(
    'SELECT * FROM weeks WHERE household_id = $1 AND week_start = $2',
    [householdId, weekStart],
  );
}

async function loadWeekDetail(weekRow, householdId) {
  if (!weekRow) return null;
  const meals = await query(
    'SELECT * FROM meals WHERE week_id = $1 ORDER BY meal_type, position',
    [weekRow.id],
  );

  const voteRows = await query(
    `SELECT mv.meal_id, mv.user_id, mv.vote, u.display_name
       FROM meal_votes mv JOIN users u ON u.id = mv.user_id
       WHERE mv.meal_id IN (SELECT id FROM meals WHERE week_id = $1)`,
    [weekRow.id],
  );
  const votesByMeal = {};
  for (const v of voteRows) {
    (votesByMeal[v.meal_id] ||= []).push({
      user_id: v.user_id,
      display_name: v.display_name,
      vote: v.vote,
    });
  }

  // Roster of all household users + each one's lock state for this week.
  const householdUsers = await query(
    `SELECT u.id, u.display_name, wl.locked_at
       FROM users u
       LEFT JOIN week_locks wl ON wl.user_id = u.id AND wl.week_id = $1
       WHERE u.household_id = $2
       ORDER BY u.id`,
    [weekRow.id, householdId],
  );

  return {
    id: weekRow.id,
    week_start: weekRow.week_start,
    weekly_theme: weekRow.weekly_theme,
    finalized_at: weekRow.finalized_at || null,
    locks: householdUsers.map((u) => ({
      user_id: u.id,
      display_name: u.display_name,
      locked_at: u.locked_at || null,
    })),
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
      recipe_md: m.recipe_md || null,
      votes: votesByMeal[m.id] || [],
    })),
  };
}

router.get('/current', async (req, res, next) => {
  try {
    const weekStart = mondayOf();
    const week = await loadWeekRow(req.user.household_id, weekStart);
    if (!week) return res.json({ exists: false, week_start: weekStart });
    res.json({ exists: true, ...(await loadWeekDetail(week, req.user.household_id)) });
  } catch (err) {
    next(err);
  }
});

router.get('/week/:weekStart', async (req, res, next) => {
  try {
    const week = await loadWeekRow(req.user.household_id, req.params.weekStart);
    if (!week) return res.status(404).json({ error: 'week not found' });
    res.json(await loadWeekDetail(week, req.user.household_id));
  } catch (err) {
    next(err);
  }
});

router.post('/generate', async (req, res, next) => {
  try {
    const weekStart = req.body?.week_start || mondayOf();
    const force = !!req.body?.force;

    const existing = await loadWeekRow(req.user.household_id, weekStart);
    if (existing && !force) {
      return res.status(409).json({ error: 'week already generated', week: await loadWeekDetail(existing, req.user.household_id) });
    }

    const prefsRow = await one(
      'SELECT data FROM preferences WHERE household_id = $1',
      [req.user.household_id],
    );
    const preferences = prefsRow ? JSON.parse(prefsRow.data) : {};

    const recentMealNames = (
      await query(
        `SELECT m.name FROM meals m JOIN weeks w ON w.id = m.week_id
         WHERE w.household_id = $1 AND w.week_start < $2
         ORDER BY w.week_start DESC LIMIT 60`,
        [req.user.household_id, weekStart],
      )
    ).map((r) => r.name);

    let result;
    try {
      result = await generateWeek({ preferences, weekStart, recentMealNames });
    } catch (err) {
      console.error('generateWeek failed', err);
      return res.status(502).json({ error: 'meal generation failed', detail: err.message });
    }

    await tx(async (client) => {
      const { rows: weekRows } = await client.query(
        `INSERT INTO weeks (household_id, week_start, weekly_theme, staples_json)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (household_id, week_start) DO UPDATE SET
           weekly_theme = EXCLUDED.weekly_theme,
           staples_json = EXCLUDED.staples_json
         RETURNING id`,
        [
          req.user.household_id,
          weekStart,
          result.data.weekly_theme,
          JSON.stringify(result.data.staples_called_for),
        ],
      );
      const weekId = weekRows[0].id;
      await client.query('DELETE FROM meals WHERE week_id = $1', [weekId]);

      const types = [
        ['lunch', result.data.meals.lunches],
        ['dinner', result.data.meals.dinners],
      ];
      for (const [type, list] of types) {
        for (let idx = 0; idx < list.length; idx++) {
          const m = list[idx];
          await client.query(
            `INSERT INTO meals (week_id, meal_type, position, name, description, cuisine,
                prep_minutes, cook_minutes, kid_bridge, main_ingredients_json, grocery_items_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              weekId,
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
            ],
          );
        }
      }
    });

    const week = await loadWeekRow(req.user.household_id, weekStart);
    res.json({ ok: true, ...(await loadWeekDetail(week, req.user.household_id)), usage: result.usage });
  } catch (err) {
    next(err);
  }
});

// Runs the finalize work for a household + week: generate recipes for any
// not-yet-cached "both yes" meal, stamp finalized_at, and email both adults.
// Idempotent — re-running is fine. Returns a summary the caller can echo back.
async function runFinalize(householdId, week) {
  const { n: userCount } = await one(
    'SELECT COUNT(*)::int AS n FROM users WHERE household_id = $1',
    [householdId],
  );

  const approvedMeals = await query(
    `SELECT m.*
       FROM meals m
       WHERE m.week_id = $1
         AND (SELECT COUNT(*) FROM meal_votes mv WHERE mv.meal_id = m.id AND mv.vote = 1) >= $2
       ORDER BY m.meal_type, m.position`,
    [week.id, userCount],
  );

  const prefsRow = await one(
    'SELECT data FROM preferences WHERE household_id = $1',
    [householdId],
  );
  const preferences = prefsRow ? JSON.parse(prefsRow.data) : {};

  // Generate recipes in parallel for any approved meal without a cached one.
  // Each call is ~10–15s; serial would be ~2 min for a typical week.
  const toGenerate = approvedMeals.filter((m) => !m.recipe_md);
  const results = await Promise.allSettled(
    toGenerate.map((m) => generateRecipe({ meal: m, preferences })),
  );
  let generated = 0;
  for (let i = 0; i < toGenerate.length; i++) {
    const m = toGenerate[i];
    const r = results[i];
    if (r.status === 'fulfilled') {
      await query('UPDATE meals SET recipe_md = $1 WHERE id = $2', [r.value.markdown, m.id]);
      m.recipe_md = r.value.markdown;
      generated += 1;
    } else {
      console.error('generateRecipe failed for', m.name, r.reason);
    }
  }

  await query('UPDATE weeks SET finalized_at = NOW() WHERE id = $1', [week.id]);

  const users = await query(
    'SELECT email FROM users WHERE household_id = $1',
    [householdId],
  );
  let emailed = false;
  if (approvedMeals.length > 0 && users.length > 0) {
    try {
      await sendMenuEmail({
        to: users.map((u) => u.email),
        weekStart: week.week_start,
        weekRange: formatWeekRange(week.week_start),
        meals: approvedMeals,
        appUrl: process.env.APP_URL || 'http://localhost:5173',
      });
      emailed = true;
    } catch (err) {
      console.error('sendMenuEmail failed', err);
    }
  }

  return { approved_count: approvedMeals.length, generated_count: generated, emailed };
}

router.post('/lock', async (req, res, next) => {
  try {
    const weekStart = req.body?.week_start || mondayOf();
    const week = await loadWeekRow(req.user.household_id, weekStart);
    if (!week) return res.status(404).json({ error: 'no week to lock' });

    await query(
      `INSERT INTO week_locks (week_id, user_id) VALUES ($1, $2)
       ON CONFLICT (week_id, user_id) DO UPDATE SET locked_at = NOW()`,
      [week.id, req.user.id],
    );

    // If every household user is now locked, run the finalize work.
    const { ready } = await one(
      `SELECT (
         SELECT COUNT(*) FROM week_locks WHERE week_id = $1
       ) = (
         SELECT COUNT(*) FROM users WHERE household_id = $2
       ) AS ready`,
      [week.id, req.user.household_id],
    );

    let summary = null;
    if (ready) {
      summary = await runFinalize(req.user.household_id, week);
    }

    const refreshed = await loadWeekRow(req.user.household_id, weekStart);
    res.json({
      ok: true,
      ready_to_finalize: !!ready,
      ...(summary || {}),
      ...(await loadWeekDetail(refreshed, req.user.household_id)),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/unlock', async (req, res, next) => {
  try {
    const weekStart = req.body?.week_start || mondayOf();
    const week = await loadWeekRow(req.user.household_id, weekStart);
    if (!week) return res.status(404).json({ error: 'no week to unlock' });

    await query('DELETE FROM week_locks WHERE week_id = $1 AND user_id = $2', [week.id, req.user.id]);

    const refreshed = await loadWeekRow(req.user.household_id, weekStart);
    res.json({ ok: true, ...(await loadWeekDetail(refreshed, req.user.household_id)) });
  } catch (err) {
    next(err);
  }
});

router.post('/:mealId/vote', async (req, res, next) => {
  try {
    const mealId = Number(req.params.mealId);
    const vote = req.body?.vote;
    if (vote !== 0 && vote !== 1 && vote !== null) {
      return res.status(400).json({ error: 'vote must be 0, 1, or null' });
    }

    const meal = await one(
      `SELECT m.id FROM meals m JOIN weeks w ON w.id = m.week_id
       WHERE m.id = $1 AND w.household_id = $2`,
      [mealId, req.user.household_id],
    );
    if (!meal) return res.status(404).json({ error: 'meal not found' });

    if (vote === null) {
      await query('DELETE FROM meal_votes WHERE meal_id = $1 AND user_id = $2', [mealId, req.user.id]);
    } else {
      await query(
        `INSERT INTO meal_votes (meal_id, user_id, vote, voted_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (meal_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, voted_at = EXCLUDED.voted_at`,
        [mealId, req.user.id, vote],
      );
    }
    // Voting after locking clears your lock — "I'm done" is invalidated by a vote change.
    await query(
      `DELETE FROM week_locks
         WHERE user_id = $1
           AND week_id = (SELECT week_id FROM meals WHERE id = $2)`,
      [req.user.id, mealId],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
