import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

export async function getDeviceSetpoints(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { meter_id } = req.query;
  try {
    let query = 'SELECT * FROM device_alert_setpoints';
    const params: any[] = [];

    if (meter_id) {
      query += ' WHERE meter_id = $1';
      params.push(meter_id);
    }

    query += ' ORDER BY meter_id, alert_type';
    const { rows } = await pool.query(query, params);
    res.json({ setpoints: rows });
  } catch (err) { next(err); }
}

export async function createDeviceSetpoint(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin required' }); return; }

  const { meter_id, alert_type, min_value, max_value, enabled, email_notify } = req.body;
  try {
    const { rows: [sp] } = await pool.query(
      `INSERT INTO device_alert_setpoints
        (meter_id, alert_type, min_value, max_value, enabled, email_notify, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [meter_id, alert_type, min_value ?? null, max_value ?? null, enabled ?? true, email_notify ?? true, req.user.id]
    );
    res.status(201).json({ setpoint: sp });
  } catch (err) { next(err); }
}

export async function updateDeviceSetpoint(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin required' }); return; }

  const { id } = req.params;
  const { min_value, max_value, enabled, email_notify } = req.body;
  try {
    const { rows: [sp] } = await pool.query(
      `UPDATE device_alert_setpoints
       SET min_value=$1, max_value=$2, enabled=$3, email_notify=$4, updated_by=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING *`,
      [min_value ?? null, max_value ?? null, enabled ?? true, email_notify ?? true, req.user.id, id]
    );
    if (!sp) { res.status(404).json({ error: 'Setpoint not found' }); return; }
    res.json({ setpoint: sp });
  } catch (err) { next(err); }
}

export async function deleteDeviceSetpoint(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin required' }); return; }

  const { id } = req.params;
  try {
    await pool.query('DELETE FROM device_alert_setpoints WHERE id=$1', [id]);
    res.json({ message: 'Setpoint deleted' });
  } catch (err) { next(err); }
}

// Get effective setpoints for a meter (device-specific or global fallback)
export async function getEffectiveSetpoints(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { meter_id } = req.query;
  if (!meter_id) { res.status(400).json({ error: 'meter_id required' }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(das.id, gap.id) as id,
              $1 as meter_id,
              COALESCE(das.alert_type, gap.alert_type) as alert_type,
              COALESCE(das.label, gap.label) as label,
              COALESCE(das.min_value, gap.min_value) as min_value,
              COALESCE(das.max_value, gap.max_value) as max_value,
              COALESCE(das.enabled, gap.enabled) as enabled,
              COALESCE(das.email_notify, gap.email_notify) as email_notify,
              CASE WHEN das.id IS NOT NULL THEN 'device' ELSE 'global' END as source
       FROM alert_setpoints gap
       FULL OUTER JOIN device_alert_setpoints das
         ON das.alert_type = gap.alert_type AND das.meter_id = $1
       ORDER BY alert_type`,
      [meter_id]
    );
    res.json({ setpoints: rows });
  } catch (err) { next(err); }
}
