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

// Deletes one Report History entry. History rows are only a log of what was
// generated (no file is stored), so this removes the log line only.
export async function deleteReportHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Report not found' }); return; }
  try {
    const { rowCount } = await pool.query('DELETE FROM reports WHERE id=$1', [req.params.id]);
    if (!rowCount) { res.status(404).json({ error: 'Report not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
}

const REPORT_TYPES = ['energy_daily','energy_monthly','diesel_daily','diesel_monthly',
                      'power_quality','power_interruption','consumption_summary','all_combined'];

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type ScheduleInput = {
  name: string; frequency: 'daily' | 'monthly'; enabled: boolean; report_type: string; format: string;
  plant_id: string | null; plant_section: string | null; send_day: number; send_time: string;
};

// Shared validation for create/update - returns an error message or the
// cleaned values.
function parseSchedule(body: Record<string, any>): { error: string } | { value: ScheduleInput } {
  const { name, frequency, enabled, report_type, format, plant_id, plant_section, send_day, send_time } = body;
  if (typeof name !== 'string' || !name.trim()) return { error: 'Schedule name is required' };
  if (!['daily', 'monthly'].includes(frequency)) return { error: 'Frequency must be daily or monthly' };
  if (!REPORT_TYPES.includes(report_type)) return { error: 'Invalid report type' };
  if (!['excel', 'pdf'].includes(format)) return { error: 'Format must be excel or pdf' };
  const day = send_day == null ? 1 : Number(send_day);
  if (!Number.isInteger(day) || day < 1 || day > 28) return { error: 'Day of month must be 1-28' };
  if (typeof send_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(send_time)) return { error: 'Time must be HH:MM (24-hour)' };
  return { value: {
    name: name.trim().slice(0, 255), frequency, enabled: enabled !== false, report_type, format,
    plant_id: plant_id || null, plant_section: plant_section || null, send_day: day, send_time,
  } };
}

export async function getReportSchedules(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT rs.*, to_char(rs.send_time, 'HH24:MI') AS send_time, p.name AS plant_name, u.name AS updated_by_name,
              (SELECT COUNT(*)::int FROM report_schedule_recipients r WHERE r.schedule_id = rs.id) AS recipient_count
       FROM report_schedules rs
       LEFT JOIN plants p ON p.id = rs.plant_id
       LEFT JOIN users u ON u.id = rs.updated_by
       ORDER BY rs.created_at, rs.name`
    );
    res.json({
      schedules: rows.map((s) => ({ ...s, next_send_at: s.enabled ? nextSlot(s) : null })),
    });
  } catch (err) { next(err); }
}

export async function createReportSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const parsed = parseSchedule(req.body ?? {});
  if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return; }
  const v = parsed.value;
  // Recipients come with the schedule so it's complete the moment it's saved.
  const raw: { email?: string; name?: string }[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const recipients = raw.map((r) => ({ email: String(r?.email ?? '').trim().toLowerCase(), name: r?.name?.trim() || null }));
  const bad = recipients.find((r) => !/^\S+@\S+\.\S+$/.test(r.email));
  if (bad) { res.status(400).json({ error: `Invalid email: ${bad.email || '(blank)'}` }); return; }

  const client = await pool.connect();
  try {
    // Saving the same settings twice would email the same report twice.
    const { rows: [dup] } = await client.query(
      `SELECT name FROM report_schedules WHERE frequency=$1 AND report_type=$2 AND format=$3
       AND plant_section IS NOT DISTINCT FROM $4 AND send_time=$5 AND ($1='daily' OR send_day=$6) LIMIT 1`,
      [v.frequency, v.report_type, v.format, v.plant_section, v.send_time, v.send_day]
    );
    if (dup) { res.status(409).json({ error: `An identical schedule already exists ("${dup.name}") - add recipients to that one instead` }); return; }

    await client.query('BEGIN');
    // updated_at = NOW() means a slot that's already past today/this month
    // isn't sent immediately - the first send is the next upcoming slot.
    const { rows: [schedule] } = await client.query(
      `INSERT INTO report_schedules (name, frequency, enabled, report_type, format, plant_id, plant_section, send_day, send_time, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
      [v.name, v.frequency, v.enabled, v.report_type, v.format, v.plant_id, v.plant_section, v.send_day, v.send_time, req.user!.id]
    );
    for (const r of recipients) {
      await client.query(
        `INSERT INTO report_schedule_recipients (schedule_id, email, name) VALUES ($1,$2,$3)
         ON CONFLICT (schedule_id, email) DO NOTHING`,
        [schedule.id, r.email, r.name]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ schedule });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

export async function updateReportSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Schedule not found' }); return; }
  const parsed = parseSchedule(req.body ?? {});
  if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return; }
  const v = parsed.value;
  try {
    const { rows: [schedule] } = await pool.query(
      `UPDATE report_schedules SET name=$1, frequency=$2, enabled=$3, report_type=$4, format=$5, plant_id=$6, plant_section=$7,
       send_day=$8, send_time=$9, updated_by=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [v.name, v.frequency, v.enabled, v.report_type, v.format, v.plant_id, v.plant_section, v.send_day, v.send_time, req.user!.id, req.params.id]
    );
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json({ schedule });
  } catch (err) { next(err); }
}

// Recipients are removed with the schedule (ON DELETE CASCADE).
export async function deleteReportSchedule(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Schedule not found' }); return; }
  try {
    const { rowCount } = await pool.query('DELETE FROM report_schedules WHERE id=$1', [req.params.id]);
    if (!rowCount) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function getScheduleRecipients(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Schedule not found' }); return; }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM report_schedule_recipients WHERE schedule_id=$1 ORDER BY email', [req.params.id]
    );
    res.json({ recipients: rows });
  } catch (err) { next(err); }
}

export async function addScheduleRecipient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Schedule not found' }); return; }
  const { email, name } = req.body as { email?: string; name?: string };
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) { res.status(400).json({ error: 'Valid email required' }); return; }
  try {
    const { rows: [recipient] } = await pool.query(
      `INSERT INTO report_schedule_recipients (schedule_id, email, name) VALUES ($1,$2,$3)
       ON CONFLICT (schedule_id, email) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
      [req.params.id, email.trim().toLowerCase(), name || null]
    );
    res.status(201).json({ recipient });
  } catch (err: any) {
    if (err.code === '23503') { res.status(404).json({ error: 'Schedule not found' }); return; }
    next(err);
  }
}

export async function deleteScheduleRecipient(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id, recipientId } = req.params;
  if (!isUuid(id) || !isUuid(recipientId)) { res.status(404).json({ error: 'Recipient not found' }); return; }
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM report_schedule_recipients WHERE id=$1 AND schedule_id=$2', [recipientId, id]
    );
    if (!rowCount) { res.status(404).json({ error: 'Recipient not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
}

// Sends a schedule's report right now, for the period its most recent slot
// covers (yesterday / last month), without consuming the next scheduled send.
export async function sendScheduleNow(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Schedule not found' }); return; }
  try {
    const { rows: [s] } = await pool.query("SELECT id, frequency, send_day, to_char(send_time,'HH24:MI') AS send_time FROM report_schedules WHERE id=$1", [req.params.id]);
    if (!s) { res.status(404).json({ error: 'Schedule not found' }); return; }
    const result = await runScheduledReport(s.id, lastSlot(s), true);
    if (result.status === 'failed') { res.status(500).json({ error: result.message }); return; }
    res.json(result);
  } catch (err) { next(err); }
}
