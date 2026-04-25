import { db } from '../db.js';

export function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'not authenticated' });
  const user = db.prepare('SELECT id, email, display_name, household_id FROM users WHERE id = ?').get(userId);
  if (!user) {
    req.session = null;
    return res.status(401).json({ error: 'not authenticated' });
  }
  req.user = user;
  next();
}
