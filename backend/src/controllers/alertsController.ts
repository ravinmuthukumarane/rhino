import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

// Which bound each alert type is actually evaluated against in
// alertService.ts - the API previously accepted and stored whatever the
// caller sent for the other field with no validation, but alertService
// silently never checks it (e.g. a "max" saved against low_power_factor
// looked like a working upper-limit alarm but could never fire).
const BOUNDS: Record<string, 'min' | 'max' | 'none'> = {
  over_voltage: 'max', low_voltage: 'min', low_power_factor: 'min',
  high_kva: 'max', power_interruption: 'none',
};

export async function getAlerts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { from, to, type, acknowledged, plant_id, limit = '100' } = req.query as Record<string, string>;
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.name AS acknowledged_by_name, p.name AS plant_name
       FROM alerts a
       LEFT JOIN users u ON u.id = a.acknowledged_by
       LEFT JOIN plants p ON p.id = a.plant_id
       WHERE ($1::timestamptz IS NULL OR a.created_at >= $1)
         AND ($2::timestamptz IS NULL OR a.created_at <= $2)
         AND ($3::text IS NULL OR a.alert_type = $3)
         AND ($4::boolean IS NULL OR a.acknowledged = $4)
         AND ($5::uuid IS NULL OR a.plant_id = $5)
       ORDER BY a.created_at DESC LIMIT $6`,
      [from ?? null, to ?? null, type ?? null,
       acknowledged !== undefined ? acknowledged === 'true' : null,
       plant_id ?? null, Math.min(parseInt(limit), 1000)]
    );
    res.json({ alerts: rows });
  } catch (err) { next(err); }
}

export async function getActiveAlerts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id } = req.query as { plant_id?: string };
  try {
    const { rows } = await pool.query(
      `SELECT a.*, p.name AS plant_name FROM alerts a
       LEFT JOIN plants p ON p.id = a.plant_id
       WHERE a.acknowledged = false AND ($1::uuid IS NULL OR a.plant_id = $1)
       ORDER BY a.created_at DESC LIMIT 50`,
      [plant_id ?? null]
    );
    res.json({ alerts: rows });
  } catch (err) { next(err); }
}

export async function acknowledgeAlert(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { alertId } = req.params;
  try {
    const { rows: [alert] } = await pool.query(
      'UPDATE alerts SET acknowledged=true, acknowledged_by=$1, acknowledged_at=NOW() WHERE id=$2 RETURNING *',
      [req.user!.id, alertId]
    );
    if (!alert) { res.status(404).json({ error: 'Alert not found' }); return; }
    res.json({ alert });
  } catch (err) { next(err); }
}

export async function acknowledgeAll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rowCount } = await pool.query(
      'UPDATE alerts SET acknowledged=true, acknowledged_by=$1, acknowledged_at=NOW() WHERE acknowledged=false',
      [req.user!.id]
    );
    res.json({ count: rowCount, message: `${rowCount} alerts acknowledged` });
  } catch (err) { next(err); }
}

export async function getSetpoints(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT sp.*, u.name AS updated_by_name FROM alert_setpoints sp
       LEFT JOIN users u ON u.id = sp.updated_by ORDER BY sp.alert_type`
    );
    res.json({ setpoints: rows });
  } catch (err) { next(err); }
}

export async function updateSetpoint(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { alertType } = req.params;
  const { min_value, max_value, enabled, email_notify } = req.body as Record<string, any>;
  const bound = BOUNDS[alertType];
  try {
    const { rows: [sp] } = await pool.query(
      `UPDATE alert_setpoints SET min_value=$1, max_value=$2, enabled=$3, email_notify=$4,
       updated_by=$5, updated_at=NOW() WHERE alert_type=$6 RETURNING *`,
      [bound === 'min' ? (min_value ?? null) : null, bound === 'max' ? (max_value ?? null) : null, enabled ?? true, email_notify ?? true, req.user!.id, alertType]
    );
    if (!sp) { res.status(404).json({ error: 'Setpoint not found' }); return; }
    res.json({ setpoint: sp });
  } catch (err) { next(err); }
}

export async function getAlertStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id } = req.query as { plant_id?: string };
  try {
    const { rows } = await pool.query(
      `SELECT alert_type, severity, COUNT(*) AS total,
              SUM(CASE WHEN acknowledged=false THEN 1 ELSE 0 END) AS unacknowledged,
              MAX(created_at) AS last_occurrence
       FROM alerts
       WHERE created_at >= NOW() - INTERVAL '30 days'
         AND ($1::uuid IS NULL OR plant_id = $1)
       GROUP BY alert_type, severity ORDER BY total DESC`,
      [plant_id ?? null]
    );
    res.json({ stats: rows });
  } catch (err) { next(err); }
}
