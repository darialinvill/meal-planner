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

async function loadWeekDetail(weekRow) {
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

  return {
    id: weekRow.id,
    week_start: weekRow.week_start,
    weekly_theme: weekRow.weekly_theme,
    finalized_at: weekRow.finalized_at || null,
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
    res.json({ exists: true, ...(await loadWeekDetail(week)) });
  } catch (err) {
    next(err);
  }
});

router.get('/week/:weekStart', async (req, res, next) => {
  try {
    const week = await loadWeekRow(req.user.household_id, req.params.weekStart);
    if (!week) return res.status(404).json({ error: 'week not found' });
    res.json(await loadWeekDetail(week));
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
      return res.status(409).json({ error: 'week already generated', week: await loadWeekDetail(existing) });
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
    res.json({ ok: true, ...(await loadWeekDetail(week)), usage: result.usage });
  } catch (err) {
    next(err);
  }
});

router.post('/finalize', async (req, res, next) => {
  try {
    const weekStart = req.body?.week_start || mondayOf();
    const week = await loadWeekRow(req.user.household_id, weekStart);
    if (!week) return res.status(404).json({ error: 'no week to finalize' });

    const { n: userCount } = await one(
      'SELECT COUNT(*)::int AS n FROM users WHERE household_id = $1',
      [req.user.household_id],
    );
    if (userCount < 2) {
      return res.status(400).json({ error: 'both household adults must sign up before finalizing' });
    }

    // Find meals where both adults voted yes.
    const approvedMeals = await query(
      `SELECT m.*
         FROM meals m
         WHERE m.week_id = $1
           AND (SELECT COUNT(*) FROM meal_votes mv WHERE mv.meal_id = m.id AND mv.vote = 1) >= $2
         ORDER BY m.meal_type, m.position`,
      [week.id, userCount],
    );

    if (approvedMeals.length === 0) {
      return res.status(400).json({
        error: 'no meals have both yes votes yet — keep voting before finalizing',
      });
    }

    const prefsRow = await one(
      'SELECT data FROM preferences WHERE household_id = $1',
      [req.user.household_id],
    );
    const preferences = prefsRow ? JSON.parse(prefsRow.data) : {};

    // Generate (and cache) recipes for any approved meal that doesn't have one yet.
    const generated = [];
    for (const m of approvedMeals) {
      if (m.recipe_md) continue;
      try {
        const { markdown } = await generateRecipe({ meal: m, preferences });
        await query('UPDATE meals SET recipe_md = $1 WHERE id = $2', [markdown, m.id]);
        m.recipe_md = markdown;
        generated.push(m.name);
      } catch (err) {
        console.error('generateRecipe failed for', m.name, err);
      }
    }

    await query('UPDATE weeks SET finalized_at = NOW() WHERE id = $1', [week.id]);

    // Send the menu email to all household users.
    const users = await query(
      'SELECT email, display_name FROM users WHERE household_id = $1',
      [req.user.household_id],
    );
    try {
      await sendMenuEmail({
        to: users.map((u) => u.email),
        weekStart: week.week_start,
        weekRange: formatWeekRange(week.week_start),
        meals: approvedMeals,
        appUrl: process.env.APP_URL || 'http://localhost:5173',
      });
    } catch (err) {
      console.error('sendMenuEmail failed', err);
    }

    const refreshed = await loadWeekRow(req.user.household_id, weekStart);
    res.json({
      ok: true,
      generated_count: generated.length,
      approved_count: approvedMeals.length,
      ...(await loadWeekDetail(refreshed)),
    });
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
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
