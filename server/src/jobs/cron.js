import cron from 'node-cron';
import { db } from '../db.js';
import { generateWeek } from '../lib/ai.js';
import { sendVoteEmail } from '../lib/email.js';
import { nextMondayOf, formatWeekRange } from '../lib/weeks.js';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function runForHousehold(household) {
  const weekStart = nextMondayOf();
  const existing = db
    .prepare('SELECT id FROM weeks WHERE household_id = ? AND week_start = ?')
    .get(household.id, weekStart);
  if (existing) {
    console.log(`[cron] week ${weekStart} already exists for household ${household.id}, skipping generation`);
    return existing.id;
  }

  console.log(`[cron] generating week ${weekStart} for household ${household.id}`);
  const prefsRow = db.prepare('SELECT data FROM preferences WHERE household_id = ?').get(household.id);
  const preferences = prefsRow ? JSON.parse(prefsRow.data) : {};

  const recentMealNames = db
    .prepare(
      `SELECT m.name FROM meals m JOIN weeks w ON w.id = m.week_id
       WHERE w.household_id = ? ORDER BY w.week_start DESC LIMIT 60`,
    )
    .all(household.id)
    .map((r) => r.name);

  const result = await generateWeek({ preferences, weekStart, recentMealNames });

  const insertWeek = db.prepare(
    `INSERT INTO weeks (household_id, week_start, weekly_theme, staples_json) VALUES (?, ?, ?, ?) RETURNING id`,
  );
  const insertMeal = db.prepare(
    `INSERT INTO meals (week_id, meal_type, position, name, description, cuisine, prep_minutes,
       cook_minutes, kid_bridge, main_ingredients_json, grocery_items_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const weekId = db.transaction(() => {
    const w = insertWeek.get(household.id, weekStart, result.data.weekly_theme, JSON.stringify(result.data.staples_called_for));
    const types = [
      ['lunch', result.data.meals.lunches],
      ['dinner', result.data.meals.dinners],
    ];
    for (const [type, list] of types) {
      list.forEach((m, idx) => {
        insertMeal.run(
          w.id,
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
    return w.id;
  })();

  return weekId;
}

async function runWeekly() {
  const households = db.prepare('SELECT id FROM households').all();
  for (const household of households) {
    try {
      const weekId = await runForHousehold(household);

      const users = db
        .prepare('SELECT email, display_name FROM users WHERE household_id = ?')
        .all(household.id);
      if (!users.length) continue;

      const week = db.prepare('SELECT * FROM weeks WHERE id = ?').get(weekId);
      const previewMeals = db
        .prepare('SELECT name, meal_type FROM meals WHERE week_id = ? ORDER BY meal_type, position LIMIT 4')
        .all(weekId);

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
  // Sundays at 9:00 AM local time
  cron.schedule('0 9 * * 0', runWeekly);
  console.log('[cron] scheduled weekly run for Sundays at 09:00');
}

// Exported so an admin can trigger manually if needed.
export { runWeekly };
