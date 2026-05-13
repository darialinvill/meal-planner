import { one } from '../db.js';

export async function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'not authenticated' });
  try {
    const user = await one(
      'SELECT id, email, display_name, household_id FROM users WHERE id = $1',
      [userId],
    );
    if (!user) {
      req.session = null;
      return res.status(401).json({ error: 'not authenticated' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
