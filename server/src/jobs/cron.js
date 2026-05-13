import cron from 'node-cron';
import { one, query, tx } from '../db.js';
import { generateWeek } from '../lib/ai.js';
import { sendVoteEmail } from '../lib/email.js';
import { nextMondayOf, formatWeekRange } from '../lib/weeks.js';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function runForHousehold(household) {
  const weekStart = nextMondayOf();
  const existing = await one(
    'SELECT id FROM weeks WHERE household_id = $1 AND week_start = $2',
    [household.id, weekStart],
  );
  if (existing) {
    console.log(`[cron] week ${weekStart} already exists for household ${household.id}, skipping generation`);
    return existing.id;
  }

  console.log(`[cron] generating week ${weekStart} for household ${household.id}`);
  const prefsRow = await one('SELECT data FROM preferences WHERE household_id = $1', [household.id]);
  const preferences = prefsRow ? JSON.parse(prefsRow.data) : {};

  const recentMealNames = (
    await query(
      `SELECT m.name FROM meals m JOIN weeks w ON w.id = m.week_id
       WHERE w.household_id = $1 ORDER BY w.week_start DESC LIMIT 60`,
      [household.id],
    )
  ).map((r) => r.name);

  const result = await generateWeek({ preferences, weekStart, recentMealNames });

  return tx(async (client) => {
    const { rows: weekRows } = await client.query(
      `INSERT INTO weeks (household_id, week_start, weekly_theme, staples_json)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [household.id, weekStart, result.data.weekly_theme, JSON.stringify(result.data.staples_called_for)],
    );
    const weekId = weekRows[0].id;
    const types = [
      ['lunch', result.data.meals.lunches],
      ['dinner', result.data.meals.dinners],
    ];
    for (const [type, list] of types) {
      for (let idx = 0; idx < list.length; idx++) {
        const m = list[idx];
        await client.query(
          `INSERT INTO meals (week_id, meal_type, position, name, description, cuisine, prep_minutes,
             cook_minutes, kid_bridge, main_ingredients_json, grocery_items_json)
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
    return weekId;
  });
}

async function runWeekly() {
  const households = await query('SELECT id FROM households');
  for (const household of households) {
    try {
      const weekId = await runForHousehold(household);

      const users = await query(
        'SELECT email, display_name FROM users WHERE household_id = $1',
        [household.id],
      );
      if (!users.length) continue;

      const week = await one('SELECT * FROM weeks WHERE id = $1', [weekId]);
      const previewMeals = await query(
        'SELECT name, meal_type FROM meals WHERE week_id = $1 ORDER BY meal_type, position LIMIT 4',
        [weekId],
      );

      await sendVoteEmail({
        to: users.map((u) => u.email),
        weekStart: week.week_start,
        weekRange: formatWeekRange(week.week_start),
        mealPreview: previewMeals,
        voteUrl: `${APP_URL}/week`,
      });
      console.log(`[cron] emailed ${users.length} user(s) for household ${household.id}`);
    } catch (err) {
      console.error(`[cron] failed for household ${household.id}`, err);
    }
  }
}

export function startCron() {
  if (process.env.CRON_ENABLED === 'false') {
    console.log('[cron] disabled via CRON_ENABLED=false');
    return;
  }
  // Sundays at 9:00 AM local time (server local — set TZ env on Railway as needed).
  cron.schedule('0 9 * * 0', runWeekly);
  console.log('[cron] scheduled weekly run for Sundays at 09:00');
}

export { runWeekly };
