-- Single-household app: at most one row in households (created on first signup).
CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Our household',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One preferences row per household. Free-form JSON in `data`.
CREATE TABLE IF NOT EXISTS preferences (
  household_id INTEGER PRIMARY KEY REFERENCES households(id),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each generated week. week_start is the Monday (YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  week_start TEXT NOT NULL,
  weekly_theme TEXT,
  staples_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(household_id, week_start)
);

-- Generated meals attached to a week.
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch','dinner')),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  cuisine TEXT,
  prep_minutes INTEGER,
  cook_minutes INTEGER,
  kid_bridge TEXT,
  main_ingredients_json TEXT NOT NULL DEFAULT '[]',
  grocery_items_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_meals_week ON meals(week_id);

-- One vote per (meal, user). vote: 1 = yes, 0 = no, NULL means not yet voted.
CREATE TABLE IF NOT EXISTS meal_votes (
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vote INTEGER CHECK (vote IN (0,1)),
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (meal_id, user_id)
);

-- Per-week staples checklist (household-shared).
-- needed = 1 means "we need to buy this", 0 means "we have it / already declined".
CREATE TABLE IF NOT EXISTS staples_check (
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  staple TEXT NOT NULL,
  needed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week_id, staple)
);

-- Manually-added grocery items (separate from meal-derived).
CREATE TABLE IF NOT EXISTS manual_grocery (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  added_by INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-week per-user "checked off in store" state for meal-derived items.
CREATE TABLE IF NOT EXISTS grocery_check (
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week_id, item_key)
);
