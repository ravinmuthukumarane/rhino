import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { reportService } from '../services/reportService';
import { AuthRequest } from '../types';
import { nextSlot, lastSlot } from '../utils/scheduleTiming';
import { runScheduledReport } from '../services/schedulerService';

export async function generateReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { type, period_start, period_end, format = 'excel', plant_id, meter_id, plant_section } = req.body as Record<string, string>;
  const validTypes = ['energy_daily','energy_monthly','diesel_daily','diesel_monthly',
                      'power_quality','power_interruption','consumption_summary','all_combined'];
  if (!validTypes.includes(type)) { res.status(400).json({ error: 'Invalid report type' }); return; }
  if (!['excel','pdf'].includes(format)) { res.status(400).json({ error: 'Format must be excel or pdf' }); return; }
  try {
    const { buffer, filename, contentType } = await reportService.generate({
      type, periodStart: period_start, periodEnd: period_end,
      format: format as 'excel' | 'pdf',
      plantId: plant_id, meterId: meter_id, section: plant_section,
      generatedBy: req.user!,
    });
    await pool.query(
      'INSERT INTO reports (report_type, period_start, period_end, format, file_name, plant_id, plant_section, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [type, period_start, period_end, format, filename, plant_id ?? null, plant_section ?? null, req.user!.id]
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (err) { next(err); }
}

export async function getReportHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS generated_by_name, p.name AS plant_name
       FROM reports r
       LEFT JOIN users u ON u.id = r.generated_by
       LEFT JOIN plants p ON p.id = r.plant_id
       ORDER BY r.created_at DESC LIMIT 100`
    );
    res.json({ reports: rows });
  } catch (err) { next(err); }
}

const REPORT_TYPES = ['energy_daily','energy_monthly','diesel_daily','diesel_monthly',
                      'power_quality','power_interruption','consumption_summary','all_combined'];

export async function getReportSchedules(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT rs.*, to_char(rs.send_time, 'HH24:MI') AS send_time, p.name AS plant_name, u.name AS updated_by_name,
              (SELECT COUNT(*)::int FROM report_schedule_recipients r WHERE r.frequency = rs.frequency) AS recipient_count
       FROM report_schedules rs
       LEFT JOIN plants p ON p.id = rs.plant_id
       LEFT JOIN users u ON u.id = rs.updated_by
       ORDER BY rs.frequency`
    );
    res.json({
      schedules: rows.map((s) => ({ ...s, next_send_at: s.enabled ? nextSlot(s) : null })),
    });
  } catch (err) { next(err); }
}

export async function updateReportSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { frequency } = req.params;
  const { enabled, report_type, format, plant_id, plant_section, send_day, send_time } = req.body as Record<string, any>;
  if (!['daily', 'monthly'].includes(frequency)) { res.status(400).json({ error: 'Invalid frequency' }); return; }
  const day = send_day == null ? 1 : Number(send_day);
  if (!Number.isInteger(day) || day < 1 || day > 28) { res.status(400).json({ error: 'Day of month must be 1-28' }); return; }
  if (typeof send_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(send_time)) { res.status(400).json({ error: 'Time must be HH:MM (24-hour)' }); return; }
  if (!REPORT_TYPES.includes(report_type)) { res.status(400).json({ error: 'Invalid report type' }); return; }
  if (!['excel', 'pdf'].includes(format)) { res.status(400).json({ error: 'Format must be excel or pdf' }); return; }
  try {
    const { rows: [schedule] } = await pool.query(
      `UPDATE report_schedules SET enabled=$1, report_type=$2, format=$3, plant_id=$4, plant_section=$5, send_day=$8, send_time=$9,
       updated_by=$6, updated_at=NOW()
       WHERE frequency=$7 RETURNING *`,
      [!!enabled, report_type, format, plant_id || null, plant_section || null, req.user!.id, frequency, day, send_time]
    );
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json({ schedule });
  } catch (err) { next(err); }
}

export async function getScheduleRecipients(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { frequency } = req.params;
  if (!['daily', 'monthly'].includes(frequency)) { res.status(400).json({ error: 'Invalid frequency' }); return; }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM report_schedule_recipients WHERE frequency=$1 ORDER BY email', [frequency]
    );
    res.json({ recipients: rows });
  } catch (err) { next(err); }
}

export async function addScheduleRecipient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { frequency } = req.params;
  const { email, name } = req.body as { email?: string; name?: string };
  if (!['daily', 'monthly'].includes(frequency)) { res.status(400).json({ error: 'Invalid frequency' }); return; }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) { res.status(400).json({ error: 'Valid email required' }); return; }
  try {
    const { rows: [recipient] } = await pool.query(
      `INSERT INTO report_schedule_recipients (frequency, email, name) VALUES ($1,$2,$3)
       ON CONFLICT (frequency, email) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
      [frequency, email.trim().toLowerCase(), name || null]
    );
    res.status(201).json({ recipient });
  } catch (err) { next(err); }
}

export async function deleteScheduleRecipient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { frequency, id } = req.params;
  if (!['daily', 'monthly'].includes(frequency)) { res.status(400).json({ error: 'Invalid frequency' }); return; }
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM report_schedule_recipients WHERE id=$1 AND frequency=$2', [id, frequency]
    );
    if (!rowCount) { res.status(404).json({ error: 'Recipient not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
}

// Sends a schedule's report right now, for the period its most recent slot
// covers (yesterday / last month), without consuming the next scheduled send.
export async function sendScheduleNow(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { frequency } = req.params;
  if (!['daily', 'monthly'].includes(frequency)) { res.status(400).json({ error: 'Invalid frequency' }); return; }
  try {
    const { rows: [s] } = await pool.query("SELECT frequency, send_day, to_char(send_time,'HH24:MI') AS send_time FROM report_schedules WHERE frequency=$1", [frequency]);
    if (!s) { res.status(404).json({ error: 'Schedule not found' }); return; }
    const result = await runScheduledReport(frequency as 'daily' | 'monthly', lastSlot(s), true);
    if (result.status === 'failed') { res.status(500).json({ error: result.message }); return; }
    res.json(result);
  } catch (err) { next(err); }
}
