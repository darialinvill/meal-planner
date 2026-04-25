import { Router } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const DEFAULT_PREFS = {
  dietary: { vegan: true, mostly_gluten_free: true },
  hard_dislikes: ['mushrooms', 'bell peppers', 'eggplant', 'fake cheese'],
  favorite_cuisines: ['Chinese', 'Thai', 'Indian', 'Mexican'],
  spice_tolerance: { adults: 'medium', kids: 'none' },
  cooking_time_max_minutes: 45,
  ingredient_efficiency_priority: 'high',
  repetition_tolerance_weeks: 3,
  primary_stores: ['Trader Joe\'s', 'Sprouts', 'Costco (monthly)'],
  kids: [
    { age: 6, accepts: ['tofu', 'plain pasta', 'avocado', 'cucumber', 'fruit', 'broccoli (plain)', 'vegan nuggets'] },
    { age: 4, accepts: ['tofu', 'plain pasta', 'avocado', 'cucumber', 'fruit', 'broccoli (plain)', 'vegan nuggets'] },
  ],
  notes: '',
};

router.post('/signup', async (req, res) => {
  const { email, password, display_name } = req.body || {};
  if (!email || !password || !display_name) {
    return res.status(400).json({ error: 'email, password, and display_name are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'email already in use' });

  let household = db.prepare('SELECT id FROM households LIMIT 1').get();
  if (!household) {
    const info = db.prepare('INSERT INTO households (name) VALUES (?)').run('Our household');
    household = { id: info.lastInsertRowid };
    db.prepare('INSERT INTO preferences (household_id, data) VALUES (?, ?)').run(
      household.id,
      JSON.stringify(DEFAULT_PREFS),
    );
  }

  const hash = await bcrypt.hash(password, 12);
  const info = db
    .prepare('INSERT INTO users (household_id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
    .run(household.id, email, display_name, hash);

  req.session.userId = info.lastInsertRowid;
  res.json({ id: info.lastInsertRowid, email, display_name, household_id: household.id });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  req.session.userId = user.id;
  res.json({ id: user.id, email: user.email, display_name: user.display_name, household_id: user.household_id });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
