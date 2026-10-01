import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';
import { getDeviceStatuses, OFFLINE_MINUTES } from '../services/deviceMonitorService';

const validEmail = (email?: string): email is string => !!email && /^\S+@\S+\.\S+$/.test(email.trim());

export async function getStatus(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ devices: await getDeviceStatuses(), offline_minutes: OFFLINE_MINUTES });
  } catch (err) { next(err); }
}

export async function getRecipients(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query('SELECT * FROM offline_alert_recipients ORDER BY email');
    res.json({ recipients: rows });
  } catch (err) { next(err); }
}

export async function addRecipient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { email, name } = req.body as { email?: string; name?: string };
  if (!validEmail(email)) { res.status(400).json({ error: 'Valid email required' }); return; }
  try {
    const { rows: [recipient] } = await pool.query(
      `INSERT INTO offline_alert_recipients (email, name) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
      [email.trim().toLowerCase(), name?.trim() || null]
    );
    res.status(201).json({ recipient });
  } catch (err) { next(err); }
}

export async function updateRecipient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  const { email, name } = req.body as { email?: string; name?: string };
  if (!validEmail(email)) { res.status(400).json({ error: 'Valid email required' }); return; }
  try {
    const { rows: [recipient] } = await pool.query(
      'UPDATE offline_alert_recipients SET email=$1, name=$2 WHERE id=$3 RETURNING *',
      [email.trim().toLowerCase(), name?.trim() || null, id]
    );
    if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }
    res.json({ recipient });
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'That email is already on the list' }); return; }
    next(err);
  }
}

export async function deleteRecipient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rowCount } = await pool.query('DELETE FROM offline_alert_recipients WHERE id=$1', [req.params.id]);
    if (!rowCount) { res.status(404).json({ error: 'Recipient not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
}
