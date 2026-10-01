import cron from 'node-cron';
import pool from '../config/database';
import { reportService } from './reportService';
import { emailService } from './emailService';
import { plantSectionSummaryService } from './plantSectionSummaryService';
import { getISTDateString, getISTParts, formatISTDate } from '../utils/timeUtils';
import { readingsWithInterval } from '../utils/energySql';

const REPORT_LABELS: Record<string, string> = {
  energy_daily: 'Daily Energy Consumption', energy_monthly: 'Monthly Energy Consumption',
  diesel_daily: 'Daily Diesel Consumption', diesel_monthly: 'Monthly Diesel Consumption',
  power_quality: 'Power Quality', power_interruption: 'Power Interruption',
  consumption_summary: 'Consumption Summary', all_combined: 'All Reports (multi-tab)',
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
    const plantLabel = sched.plant_section === 'P1' ? 'Plant 1' : sched.plant_section === 'P4' ? 'Plant 4' : (sched.plant_section || 'All Plants (Plant 1 + Plant 4)');
    const label = `${REPORT_LABELS[sched.report_type] ?? sched.report_type} – ${plantLabel}`;
    await emailService.sendScheduledReport(emails, frequency, label, periodLabel, buffer, filename, contentType, sections);
    if (emails.length) console.log(`[Scheduler] ${frequency} report sent to ${emails.join(', ')}`);
  } catch (err) { console.error(`[Scheduler] ${frequency} report failed:`, (err as Error).message); }
}

// Rebuilds daily_energy_summary for one IST calendar day from the raw
// readings, overwriting the incrementally-maintained live values. kWh uses the
// real time between readings (see utils/energySql.ts), not a fixed interval.
export async function recalcDailySummary(date: string): Promise<number> {
  const from = new Date(`${date}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 86400000);
  const { rows } = await pool.query(
    `SELECT er.meter_id, (array_agg(er.plant_id))[1] AS plant_id,
            SUM(er.power_kw*er.interval_h) AS total_kwh, MAX(er.power_kva) AS max_kva,
            AVG(er.power_factor) AS avg_pf, AVG((er.voltage_r+er.voltage_y+er.voltage_b)/3) AS avg_v,
            MAX(GREATEST(er.current_r,er.current_y,er.current_b)) AS max_i,
            SUM(CASE WHEN er.source='CEB' THEN er.power_kw*er.interval_h ELSE 0 END) AS ceb_kwh,
            SUM(CASE WHEN er.source='GENERATOR' THEN er.power_kw*er.interval_h ELSE 0 END) AS gen_kwh,
            SUM(CASE WHEN er.time_period='day' THEN er.power_kw*er.interval_h ELSE 0 END) AS day_kwh,
            SUM(CASE WHEN er.time_period='peak' THEN er.power_kw*er.interval_h ELSE 0 END) AS peak_kwh,
            SUM(CASE WHEN er.time_period='off_peak' THEN er.power_kw*er.interval_h ELSE 0 END) AS off_kwh
     FROM ${readingsWithInterval('$1', '$2')} er
     GROUP BY er.meter_id`,
    [from.toISOString(), to.toISOString()]
  );
  for (const r of rows) {
    await pool.query(
      `INSERT INTO daily_energy_summary (summary_date,plant_id,meter_id,total_kwh,max_kva,avg_power_factor,avg_voltage,max_current,ceb_kwh,generator_kwh,day_kwh,peak_kwh,off_peak_kwh)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (summary_date,meter_id) DO UPDATE SET total_kwh=EXCLUDED.total_kwh,max_kva=EXCLUDED.max_kva,avg_power_factor=EXCLUDED.avg_power_factor,avg_voltage=EXCLUDED.avg_voltage,max_current=EXCLUDED.max_current,ceb_kwh=EXCLUDED.ceb_kwh,generator_kwh=EXCLUDED.generator_kwh,day_kwh=EXCLUDED.day_kwh,peak_kwh=EXCLUDED.peak_kwh,off_peak_kwh=EXCLUDED.off_peak_kwh,updated_at=NOW()`,
      [date,r.plant_id,r.meter_id,r.total_kwh||0,r.max_kva||0,r.avg_pf||0,r.avg_v||0,r.max_i||0,r.ceb_kwh||0,r.gen_kwh||0,r.day_kwh||0,r.peak_kwh||0,r.off_kwh||0]
    );
  }
  return rows.length;
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
      await recalcDailySummary(date);
      console.log('[Scheduler] Daily summary done.');
    } catch (err) { console.error('[Scheduler] Daily summary failed:', (err as Error).message); }
  });

  console.log('[Scheduler] Cron jobs started.');
}
