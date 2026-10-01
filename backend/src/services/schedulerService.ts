import cron from 'node-cron';
import pool from '../config/database';
import { reportService } from './reportService';
import { emailService } from './emailService';
import { plantSectionSummaryService } from './plantSectionSummaryService';
import { getISTDateString } from '../utils/timeUtils';
import { lastSlot, slotPeriod } from '../utils/scheduleTiming';
import { readingsWithInterval } from '../utils/energySql';

const REPORT_LABELS: Record<string, string> = {
  energy_daily: 'Daily Energy Consumption', energy_monthly: 'Monthly Energy Consumption',
  diesel_daily: 'Daily Diesel Consumption', diesel_monthly: 'Monthly Diesel Consumption',
  power_quality: 'Power Quality', power_interruption: 'Power Interruption',
  consumption_summary: 'Consumption Summary', all_combined: 'All Reports (multi-tab)',
};

type Frequency = 'daily' | 'monthly';

// Generates and emails one schedule's report for the period belonging to
// `slot`, and records the outcome on the schedule row (last_run_at/status/
// message/period) so the Report Schedules page can show what happened.
export async function runScheduledReport(frequency: Frequency, slot: Date, manual = false): Promise<{ status: string; message: string }> {
  const { rows: [sched] } = await pool.query('SELECT * FROM report_schedules WHERE frequency=$1', [frequency]);
  if (!sched) return { status: 'failed', message: 'Schedule not found' };

  const { start, end, label: periodLabel } = slotPeriod(frequency, slot);
  const record = async (status: string, message: string) => {
    // A manual "send now" doesn't consume the scheduled slot - only stamp
    // last_run_at for real scheduled runs, so the next automatic send still
    // happens on time.
    await pool.query(
      `UPDATE report_schedules SET last_status=$1, last_message=$2, last_period=$3${manual ? '' : ', last_run_at=$5'} WHERE frequency=$4`,
      manual ? [status, `${message} (sent manually)`, periodLabel, frequency] : [status, message, periodLabel, frequency, slot]
    );
    return { status, message };
  };

  console.log(`[Scheduler] Generating ${frequency} report (${sched.report_type}, ${sched.format}) for ${periodLabel}…`);
  try {
    // Make sure the reported day's totals are final before they're emailed.
    if (frequency === 'daily') await recalcDailySummary(start);

    const { rows } = await pool.query('SELECT email FROM report_schedule_recipients WHERE frequency=$1 ORDER BY email', [frequency]);
    const emails = rows.map((r: { email: string }) => r.email);
    if (!emails.length) return record('skipped', 'No recipients');
    if (!process.env.SMTP_USER) return record('skipped', 'Email (SMTP) not configured on the server');

    const { buffer, filename, contentType } = await reportService.generate({
      type: sched.report_type, periodStart: start, periodEnd: end, format: sched.format,
      plantId: sched.plant_id ?? undefined, section: sched.plant_section ?? undefined,
      generatedBy: { id: 'system', email: 'system', name: 'System', role: 'admin', is_verified: true },
    });

    await pool.query(
      'INSERT INTO reports (report_type,period_start,period_end,format,file_name,plant_id,plant_section,auto_generated,email_sent) VALUES ($1,$2,$3,$4,$5,$6,$7,true,true)',
      [sched.report_type, start, end, sched.format, filename, sched.plant_id ?? null, sched.plant_section ?? null]
    );

    const sections = await plantSectionSummaryService.getSectionSummaries(start, end);
    const plantLabel = sched.plant_section === 'P1' ? 'Plant 1' : sched.plant_section === 'P4' ? 'Plant 4' : (sched.plant_section || 'All Plants (Plant 1 + Plant 4)');
    const label = `${REPORT_LABELS[sched.report_type] ?? sched.report_type} – ${plantLabel}`;
    await emailService.sendScheduledReport(emails, frequency, label, periodLabel, buffer, filename, contentType, sections);
    console.log(`[Scheduler] ${frequency} report sent to ${emails.join(', ')}`);
    return record('sent', `Sent to ${emails.length} recipient${emails.length > 1 ? 's' : ''}`);
  } catch (err) {
    console.error(`[Scheduler] ${frequency} report failed:`, (err as Error).message);
    return record('failed', (err as Error).message);
  }
}

// Slots that were missed (e.g. server down at send time) are still sent if
// the server comes back within this window; older ones are skipped rather
// than surprising recipients with a stale report.
const CATCH_UP_MS = 12 * 3600000;
let checking = false;

// Runs every minute: fires each enabled schedule whose most recent slot
// hasn't been processed yet. Slots before the schedule was last saved don't
// count, so changing the day/time never triggers an immediate send for a
// slot that's already in the past.
async function checkDueSchedules(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const now = new Date();
    const { rows } = await pool.query('SELECT * FROM report_schedules WHERE enabled = true');
    for (const s of rows) {
      const slot = lastSlot({ frequency: s.frequency, send_day: s.send_day, send_time: s.send_time }, now);
      const alreadyRun = s.last_run_at && new Date(s.last_run_at) >= slot;
      const savedAfterSlot = s.updated_at && new Date(s.updated_at) > slot;
      if (alreadyRun || savedAfterSlot || now.getTime() - slot.getTime() > CATCH_UP_MS) continue;
      // Claim the slot before the (slow) generate/send so an overlapping
      // check can't send it twice.
      await pool.query('UPDATE report_schedules SET last_run_at=$1 WHERE frequency=$2', [slot, s.frequency]);
      await runScheduledReport(s.frequency, slot);
    }
  } catch (err) {
    console.error('[Scheduler] Schedule check failed:', (err as Error).message);
  } finally {
    checking = false;
  }
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
  // Daily/monthly report emails - day and time are configured per schedule
  // on the Report Schedules page, so check every minute which are due.
  cron.schedule('* * * * *', () => { checkDueSchedules(); });

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
