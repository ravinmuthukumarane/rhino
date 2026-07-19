import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { reportService } from '../services/reportService';
import { AuthRequest } from '../types';

export async function generateReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { type, period_start, period_end, format = 'excel', plant_id, meter_id } = req.body as Record<string, string>;
  const validTypes = ['energy_daily','energy_monthly','diesel_daily','diesel_monthly',
                      'power_quality','power_interruption','consumption_summary'];
  if (!validTypes.includes(type)) { res.status(400).json({ error: 'Invalid report type' }); return; }
  if (!['excel','pdf'].includes(format)) { res.status(400).json({ error: 'Format must be excel or pdf' }); return; }
  try {
    const { buffer, filename, contentType } = await reportService.generate({
      type, periodStart: period_start, periodEnd: period_end,
      format: format as 'excel' | 'pdf',
      plantId: plant_id, meterId: meter_id,
      generatedBy: req.user!,
    });
    await pool.query(
      'INSERT INTO reports (report_type, period_start, period_end, format, file_name, plant_id, generated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [type, period_start, period_end, format, filename, plant_id ?? null, req.user!.id]
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
