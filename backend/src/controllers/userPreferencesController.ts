import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

export async function getUserPreferences(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.id) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    let { rows: [prefs] } = await pool.query(
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [req.user.id]
    );

    // Create defaults if not exists
    if (!prefs) {
      const { rows: [newPrefs] } = await pool.query(
        `INSERT INTO user_preferences (user_id) VALUES ($1) RETURNING *`,
        [req.user.id]
      );
      prefs = newPrefs;
    }

    res.json({ preferences: prefs });
  } catch (err) { next(err); }
}

export async function updateUserPreferences(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.id) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { theme, alert_sound, email_notifications, email_daily_digest, alert_snooze_minutes, timezone } = req.body;

  try {
    const { rows: [prefs] } = await pool.query(
      `UPDATE user_preferences
       SET theme=$2,
           alert_sound=$3,
           email_notifications=$4,
           email_daily_digest=$5,
           alert_snooze_minutes=$6,
           timezone=$7,
           updated_at=NOW()
       WHERE user_id=$1
       RETURNING *`,
      [req.user.id, theme, alert_sound, email_notifications, email_daily_digest, alert_snooze_minutes, timezone]
    );

    if (!prefs) {
      // Create if doesn't exist
      const { rows: [newPrefs] } = await pool.query(
        `INSERT INTO user_preferences
          (user_id, theme, alert_sound, email_notifications, email_daily_digest, alert_snooze_minutes, timezone)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [req.user.id, theme ?? 'dark', alert_sound ?? true, email_notifications ?? true,
         email_daily_digest ?? true, alert_snooze_minutes ?? 60, timezone ?? 'UTC']
      );
      return res.json({ preferences: newPrefs });
    }

    res.json({ preferences: prefs });
  } catch (err) { next(err); }
}
