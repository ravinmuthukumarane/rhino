import cron from 'node-cron';
import pool from '../config/database';
import { reportService } from './reportService';
import { emailService } from './emailService';

export function startScheduler(): void {
  // Auto monthly report on 1st of each month at 06:00
  cron.schedule('0 6 1 * *', async () => {
    console.log('[Scheduler] Generating monthly report…');
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const end = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
      const label = new Date(start).toLocaleDateString('en-GB', { year: 'numeric', month: 'long' });

      const { buffer } = await reportService.generate({
        type: 'consumption_summary', periodStart: start, periodEnd: end, format: 'excel',
        generatedBy: { id: 'system', email: 'system', name: 'System', role: 'admin', is_verified: true },
      });

      await pool.query(
        'INSERT INTO reports (report_type,period_start,period_end,format,file_name,auto_generated) VALUES ($1,$2,$3,$4,$5,true)',
        ['consumption_summary', start, end, 'excel', `consumption_summary_${start}_to_${end}.xlsx`]
      );

      const { rows } = await pool.query("SELECT email FROM users WHERE role='admin' AND is_verified=true");
      const emails = rows.map((r: { email: string }) => r.email);
      if (emails.length) {
        await emailService.sendMonthlyReport(emails, label, buffer);
        console.log(`[Scheduler] Monthly report sent to ${emails.join(', ')}`);
      }
    } catch (err) { console.error('[Scheduler] Monthly report failed:', (err as Error).message); }
  });

  // Daily summary recalc at 00:05
  cron.schedule('5 0 * * *', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toISOString().split('T')[0];
    console.log(`[Scheduler] Recalculating daily summary for ${date}…`);
    try {
      const { rows: meters } = await pool.query('SELECT DISTINCT meter_id, plant_id FROM energy_readings WHERE recorded_at::date = $1', [date]);
      for (const { meter_id, plant_id } of meters) {
        const { rows: [r] } = await pool.query(
          `SELECT SUM(power_kw*(5.0/3600)) AS total_kwh, MAX(power_kva) AS max_kva,
                  AVG(power_factor) AS avg_pf, AVG((voltage_r+voltage_y+voltage_b)/3) AS avg_v,
                  MAX(GREATEST(current_r,current_y,current_b)) AS max_i,
                  SUM(CASE WHEN source='CEB' THEN power_kw*(5.0/3600) ELSE 0 END) AS ceb_kwh,
                  SUM(CASE WHEN source='GENERATOR' THEN power_kw*(5.0/3600) ELSE 0 END) AS gen_kwh,
                  SUM(CASE WHEN time_period='day' THEN power_kw*(5.0/3600) ELSE 0 END) AS day_kwh,
                  SUM(CASE WHEN time_period='peak' THEN power_kw*(5.0/3600) ELSE 0 END) AS peak_kwh,
                  SUM(CASE WHEN time_period='off_peak' THEN power_kw*(5.0/3600) ELSE 0 END) AS off_kwh
           FROM energy_readings WHERE recorded_at::date=$1 AND meter_id=$2`, [date, meter_id]
        );
        if (r.total_kwh != null) {
          await pool.query(
            `INSERT INTO daily_energy_summary (summary_date,plant_id,meter_id,total_kwh,max_kva,avg_power_factor,avg_voltage,max_current,ceb_kwh,generator_kwh,day_kwh,peak_kwh,off_peak_kwh)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (summary_date,meter_id) DO UPDATE SET total_kwh=EXCLUDED.total_kwh,max_kva=EXCLUDED.max_kva,avg_power_factor=EXCLUDED.avg_power_factor,avg_voltage=EXCLUDED.avg_voltage,max_current=EXCLUDED.max_current,ceb_kwh=EXCLUDED.ceb_kwh,generator_kwh=EXCLUDED.generator_kwh,day_kwh=EXCLUDED.day_kwh,peak_kwh=EXCLUDED.peak_kwh,off_peak_kwh=EXCLUDED.off_peak_kwh,updated_at=NOW()`,
            [date,plant_id,meter_id,r.total_kwh||0,r.max_kva||0,r.avg_pf||0,r.avg_v||0,r.max_i||0,r.ceb_kwh||0,r.gen_kwh||0,r.day_kwh||0,r.peak_kwh||0,r.off_kwh||0]
          );
        }
      }
      console.log('[Scheduler] Daily summary done.');
    } catch (err) { console.error('[Scheduler] Daily summary failed:', (err as Error).message); }
  });

  console.log('[Scheduler] Cron jobs started.');
}
