-- Single-household app: at most one row in households (created on first signup).
CREATE TABLE IF NOT EXISTS households (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Our household',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One preferences row per household. JSON stored as TEXT to keep route logic
-- identical to the SQLite original (we never query inside the JSON anyway).
CREATE TABLE IF NOT EXISTS preferences (
  household_id INTEGER PRIMARY KEY REFERENCES households(id),
  data TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- week_start is the Monday of the week (stored as 'YYYY-MM-DD' text for round-trip stability).
CREATE TABLE IF NOT EXISTS weeks (
  id SERIAL PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  week_start TEXT NOT NULL,
  weekly_theme TEXT,
  staples_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(household_id, week_start)
);

CREATE TABLE IF NOT EXISTS meals (
  id SERIAL PRIMARY KEY,
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

-- vote: 1 = yes, 0 = no. Row absent = not yet voted.
CREATE TABLE IF NOT EXISTS meal_votes (
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vote SMALLINT CHECK (vote IN (0, 1)),
  voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (meal_id, user_id)
);

-- Per-week staples checklist (household-shared).
CREATE TABLE IF NOT EXISTS staples_check (
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  staple TEXT NOT NULL,
  needed SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (week_id, staple)
);

CREATE TABLE IF NOT EXISTS manual_grocery (
  id SERIAL PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  added_by INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT,
  checked SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grocery_check (
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  checked SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (week_id, item_key)
);
