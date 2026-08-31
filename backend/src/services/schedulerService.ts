import cron from 'node-cron';
import pool from '../config/database';
import { reportService } from './reportService';
import { emailService } from './emailService';
import { plantSectionSummaryService } from './plantSectionSummaryService';
import { getISTDateString, getISTParts, formatISTDate } from '../utils/timeUtils';

const REPORT_LABELS: Record<string, string> = {
  energy_daily: 'Daily Energy Consumption', energy_monthly: 'Monthly Energy Consumption',
  diesel_daily: 'Daily Diesel Consumption', diesel_monthly: 'Monthly Diesel Consumption',
  power_quality: 'Power Quality', power_interruption: 'Power Interruption',
  consumption_summary: 'Consumption Summary',
};

async function runScheduledReport(frequency: 'daily' | 'monthly'): Promise<void> {
  const { rows: [sched] } = await pool.query('SELECT * FROM report_schedules WHERE frequency=$1', [frequency]);
  if (!sched?.enabled) { console.log(`[Scheduler] ${frequency} report is disabled, skipping.`); return; }

  const now = new Date();
  let start: string, end: string, periodLabel: string;
  if (frequency === 'daily') {
    // "Yesterday" in Sri Lanka's calendar, not the server's UTC system day.
    start = end = getISTDateString(new Date(now.getTime() - 86400000));
    periodLabel = formatISTDate(`${start}T00:00:00+05:30`, { year: 'numeric', month: 'long', day: 'numeric' });
  } else {
    // Last calendar month anchored to the IST year/month, not server UTC.
    const { year, month } = getISTParts(now); // month is 1-indexed
    start = new Date(Date.UTC(year, month - 2, 1)).toISOString().split('T')[0];
    end = new Date(Date.UTC(year, month - 1, 0)).toISOString().split('T')[0];
    periodLabel = formatISTDate(`${start}T00:00:00+05:30`, { year: 'numeric', month: 'long' });
  }

  console.log(`[Scheduler] Generating ${frequency} report (${sched.report_type}, ${sched.format})…`);
  try {
    const { buffer, filename, contentType } = await reportService.generate({
      type: sched.report_type, periodStart: start, periodEnd: end, format: sched.format,
      plantId: sched.plant_id ?? undefined, section: sched.plant_section ?? undefined,
      generatedBy: { id: 'system', email: 'system', name: 'System', role: 'admin', is_verified: true },
    });

    await pool.query(
      'INSERT INTO reports (report_type,period_start,period_end,format,file_name,plant_id,plant_section,auto_generated) VALUES ($1,$2,$3,$4,$5,$6,$7,true)',
      [sched.report_type, start, end, sched.format, filename, sched.plant_id ?? null, sched.plant_section ?? null]
    );

    const { rows } = await pool.query(
      'SELECT email FROM report_schedule_recipients WHERE frequency=$1 ORDER BY email',
      [frequency]
    );
    const emails = rows.map((r: { email: string }) => r.email);
    const sections = await plantSectionSummaryService.getSectionSummaries(start, end);
    const label = REPORT_LABELS[sched.report_type] ?? sched.report_type;
    await emailService.sendScheduledReport(emails, frequency, label, periodLabel, buffer, filename, contentType, sections);
    if (emails.length) console.log(`[Scheduler] ${frequency} report sent to ${emails.join(', ')}`);
  } catch (err) { console.error(`[Scheduler] ${frequency} report failed:`, (err as Error).message); }
}

export function startScheduler(): void {
  // Auto monthly report on 1st of each month at 06:00
  cron.schedule('0 6 1 * *', () => runScheduledReport('monthly'));

  // Auto daily report at 00:10 (after the 00:05 summary recalc below has run)
  cron.schedule('10 0 * * *', () => runScheduledReport('daily'));

  // Daily summary recalc at 00:05
  cron.schedule('5 0 * * *', async () => {
    const date = getISTDateString(new Date(Date.now() - 86400000));
    console.log(`[Scheduler] Recalculating daily summary for ${date}…`);
    try {
      const { rows: meters } = await pool.query(
        "SELECT DISTINCT meter_id, plant_id FROM energy_readings WHERE (recorded_at AT TIME ZONE 'Asia/Colombo')::date = $1",
        [date]
      );
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
           FROM energy_readings WHERE (recorded_at AT TIME ZONE 'Asia/Colombo')::date=$1 AND meter_id=$2`, [date, meter_id]
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
