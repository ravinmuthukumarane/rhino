import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import pool from '../config/database';
import { GenerateReportInput } from '../types';
import { formatISTDate, formatISTDateTime, getISTDateString } from '../utils/timeUtils';

const HFILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
const HFONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

// Row number of each sheet's column-header row - the PDF renderer skips the
// title block above it (it prints its own heading) and styles that row.
const headerRowOf = new WeakMap<ExcelJS.Worksheet, number>();

function hdr(sheet: ExcelJS.Worksheet, cols: string[]): void {
  const row = sheet.addRow(cols);
  row.eachCell((cell) => { cell.fill = HFILL; cell.font = HFONT; cell.alignment = { horizontal: 'center' }; });
  headerRowOf.set(sheet, row.number);
}

// Every report must say which plant it covers - a title block at the top of
// each sheet, on top of the per-row Plant column.
interface Scope { section?: string; start: string; end: string }
function scopeLabel(section?: string): string {
  return section ? sectionLabel(section) : 'All Plants (Plant 1 + Plant 4)';
}
function sheetWithTitle(wb: ExcelJS.Workbook, name: string, title: string, scope: Scope, cols: string[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF1E40AF' } };
  ws.addRow([`Plant: ${scopeLabel(scope.section)}`]).font = { bold: true, size: 12 };
  ws.addRow([`Period: ${scope.start} to ${scope.end}`]);
  ws.addRow([]);
  hdr(ws, cols);
  return ws;
}

// The report server runs on UTC system time, so plain toLocaleDateString()/
// toLocaleString() would print UTC clock time in a report meant to be read
// against Sri Lanka's day/peak/off-peak schedule - explicitly anchor to IST.
function fmtDate(d: any): string { return d ? formatISTDate(d, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''; }
function fmtTime(d: any): string { return d ? formatISTDateTime(d) : ''; }
function n(v: any, dp = 2): string { return v != null ? parseFloat(v).toFixed(dp) : '0.00'; }
// PF is signed (negative = lagging, positive = leading) - always show the sign.
function pf(v: any): string { if (v == null) return '—'; const x = parseFloat(v); return (x > 0 ? '+' : '') + x.toFixed(3); }

// Reports are scoped by plant_section (P1/P4 - the actual physical plants on
// site), not by plants.id - the site only has one plants row ("RRPL"), so
// filtering/labeling by plant_id never distinguished P1 from P4. Falls back
// to the plant name for any meter with no section set.
const SECTION_LABELS: Record<string, string> = { P1: 'Plant 1', P4: 'Plant 4' };
// A meter with no section set is labelled as such rather than falling back to
// the plants.name ("RRPL"), which doesn't say Plant 1 or Plant 4.
function sectionLabel(section: string | null | undefined, _plantName?: string | null): string {
  return (section && SECTION_LABELS[section]) || section || 'Unassigned plant';
}

// `start`/`end` are plain dates (e.g. "2026-08-01") picked against Sri
// Lanka's calendar. Anchoring explicitly to +05:30 (Sri Lanka has no DST)
// gives the correct UTC instant for IST midnight regardless of server
// timezone, instead of `new Date(dateStr)` which parses as UTC midnight.
const startOfDayIST = (dateStr: string): Date => new Date(`${dateStr}T00:00:00+05:30`);
const endOfDayExclusiveIST = (dateStr: string): Date => new Date(startOfDayIST(dateStr).getTime() + 86400000);

async function buildEnergyDaily(start: string, end: string, plantId?: string, meterId?: string, section?: string, wb: ExcelJS.Workbook = new ExcelJS.Workbook()): Promise<ExcelJS.Workbook> {
  const { rows } = await pool.query(
    `SELECT des.*, p.name AS plant_name, em.plant_section FROM daily_energy_summary des
     LEFT JOIN plants p ON p.id = des.plant_id
     LEFT JOIN energy_meters em ON em.meter_id = des.meter_id
     WHERE des.summary_date BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR des.plant_id = $3)
       AND ($4::text IS NULL OR des.meter_id = $4)
       AND ($5::text IS NULL OR em.plant_section = $5)
     ORDER BY em.plant_section, des.summary_date, des.meter_id`,
    [start, end, plantId ?? null, meterId ?? null, section ?? null]
  );
  const ws = sheetWithTitle(wb, 'Daily Energy', 'Daily Energy Consumption', { section, start, end }, ['Date','Plant','Meter','Total kWh','Max kVA','Avg PF','Avg Voltage','CEB kWh','Gen kWh','Day kWh','Peak kWh','Off-Peak kWh','Interruptions']);
  rows.forEach((r) => ws.addRow([fmtDate(r.summary_date),sectionLabel(r.plant_section,r.plant_name),r.meter_id,n(r.total_kwh),n(r.max_kva),pf(r.avg_power_factor),n(r.avg_voltage,1),n(r.ceb_kwh),n(r.generator_kwh),n(r.day_kwh),n(r.peak_kwh),n(r.off_peak_kwh),r.interruption_count]));
  await addInterruptionSheets(wb, 'day', start, end, plantId, section);
  return wb;
}

async function buildEnergyMonthly(start: string, end: string, plantId?: string, section?: string): Promise<ExcelJS.Workbook> {
  const { rows } = await pool.query(
    `SELECT DATE_TRUNC('month',summary_date) AS month, p.name AS plant_name, em.plant_section, des.plant_id, des.meter_id,
            SUM(total_kwh)::numeric(14,2) AS total_kwh, MAX(max_kva)::numeric(10,2) AS max_kva,
            AVG(avg_power_factor)::numeric(5,3) AS avg_pf,
            SUM(ceb_kwh)::numeric(14,2) AS ceb_kwh, SUM(generator_kwh)::numeric(14,2) AS gen_kwh,
            SUM(day_kwh)::numeric(14,2) AS day_kwh, SUM(peak_kwh)::numeric(14,2) AS peak_kwh,
            SUM(off_peak_kwh)::numeric(14,2) AS off_peak_kwh
     FROM daily_energy_summary des LEFT JOIN plants p ON p.id=des.plant_id
     LEFT JOIN energy_meters em ON em.meter_id = des.meter_id
     WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR des.plant_id=$3)
       AND ($4::text IS NULL OR em.plant_section = $4)
     GROUP BY DATE_TRUNC('month',summary_date), des.plant_id, p.name, em.plant_section, des.meter_id ORDER BY em.plant_section, month, des.meter_id`,
    [start, end, plantId ?? null, section ?? null]
  );
  const wb = new ExcelJS.Workbook();
  const ws = sheetWithTitle(wb, 'Monthly Energy', 'Monthly Energy Consumption', { section, start, end }, ['Month','Plant','Meter','Total kWh','Max kVA','Avg PF','CEB kWh','Gen kWh','Day kWh','Peak kWh','Off-Peak kWh']);
  rows.forEach((r) => ws.addRow([formatISTDate(r.month,{year:'numeric',month:'long'}),sectionLabel(r.plant_section,r.plant_name),r.meter_id,r.total_kwh,r.max_kva,pf(r.avg_pf),r.ceb_kwh,r.gen_kwh,r.day_kwh,r.peak_kwh,r.off_peak_kwh]));
  await addInterruptionSheets(wb, 'month', start, end, plantId, section);
  return wb;
}

async function buildDiesel(start: string, end: string, groupBy: 'day'|'month', plantId?: string, section?: string, wb: ExcelJS.Workbook = new ExcelJS.Workbook()): Promise<ExcelJS.Workbook> {
  const { rows } = groupBy === 'month'
    ? await pool.query(`SELECT DATE_TRUNC('month',summary_date) AS period, p.name AS plant_name, fm.plant_section, dds.meter_id, SUM(total_liters)::numeric(14,2) AS total_liters, SUM(generator_run_hours)::numeric(8,2) AS run_hours FROM daily_diesel_summary dds LEFT JOIN plants p ON p.id=dds.plant_id LEFT JOIN flow_meters fm ON fm.meter_id=dds.meter_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR dds.plant_id=$3) AND ($4::text IS NULL OR fm.plant_section=$4) GROUP BY DATE_TRUNC('month',summary_date),dds.plant_id,p.name,fm.plant_section,dds.meter_id ORDER BY fm.plant_section, period, dds.meter_id`, [start,end,plantId??null,section??null])
    : await pool.query(`SELECT summary_date AS period, p.name AS plant_name, fm.plant_section, dds.meter_id, total_liters, generator_run_hours AS run_hours FROM daily_diesel_summary dds LEFT JOIN plants p ON p.id=dds.plant_id LEFT JOIN flow_meters fm ON fm.meter_id=dds.meter_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR dds.plant_id=$3) AND ($4::text IS NULL OR fm.plant_section=$4) ORDER BY fm.plant_section, period, dds.meter_id`, [start,end,plantId??null,section??null]);
  const ws = sheetWithTitle(wb, 'Diesel', groupBy === 'month' ? 'Monthly Diesel Consumption' : 'Daily Diesel Consumption', { section, start, end }, ['Period','Plant','Meter','Diesel (L)','Gen Run Hours']);
  rows.forEach((r) => ws.addRow([fmtDate(r.period),sectionLabel(r.plant_section,r.plant_name),r.meter_id,n(r.total_liters),n(r.run_hours)]));
  return wb;
}

async function buildPowerQuality(start: string, end: string, plantId?: string, meterId?: string, section?: string, wb: ExcelJS.Workbook = new ExcelJS.Workbook()): Promise<ExcelJS.Workbook> {
  const { rows } = await pool.query(
    `SELECT er.recorded_at, p.name AS plant_name, em.plant_section, er.meter_id, er.voltage_r, er.voltage_y, er.voltage_b,
            er.current_r, er.current_y, er.current_b, er.power_kw, er.power_kva, er.power_factor,
            er.frequency, er.source
     FROM energy_readings er LEFT JOIN plants p ON p.id=er.plant_id
     LEFT JOIN energy_meters em ON em.meter_id = er.meter_id
     WHERE er.recorded_at >= $1 AND er.recorded_at < $2
       AND ($3::uuid IS NULL OR er.plant_id=$3) AND ($4::text IS NULL OR er.meter_id=$4)
       AND ($5::text IS NULL OR em.plant_section=$5)
     ORDER BY em.plant_section, er.recorded_at, er.meter_id LIMIT 50000`,
    [startOfDayIST(start), endOfDayExclusiveIST(end), plantId??null, meterId??null, section??null]
  );
  const ws = sheetWithTitle(wb, 'Power Quality', 'Power Quality', { section, start, end }, ['Timestamp','Plant','Meter','VR','VY','VB','IR','IY','IB','kW','kVA','PF','Hz','Source']);
  rows.forEach((r) => ws.addRow([fmtTime(r.recorded_at),sectionLabel(r.plant_section,r.plant_name),r.meter_id,r.voltage_r,r.voltage_y,r.voltage_b,r.current_r,r.current_y,r.current_b,r.power_kw,r.power_kva,pf(r.power_factor),r.frequency,r.source]));
  return wb;
}

async function buildInterruptions(start: string, end: string, plantId?: string, section?: string, wb: ExcelJS.Workbook = new ExcelJS.Workbook()): Promise<ExcelJS.Workbook> {
  // pi.meter_id holds a generator_id (e.g. "GEN-P1"), not an energy_meters.meter_id,
  // so the section has to come from the generators registry, not energy_meters.
  const { rows } = await pool.query(
    `SELECT pi.*, p.name AS plant_name, COALESCE(em.plant_section, g.plant_section) AS plant_section
     FROM power_interruptions pi LEFT JOIN plants p ON p.id=pi.plant_id
     LEFT JOIN energy_meters em ON em.meter_id = pi.meter_id
     LEFT JOIN generators g ON g.generator_id = pi.meter_id
     WHERE pi.started_at >= $1 AND pi.started_at < $2 AND ($3::uuid IS NULL OR pi.plant_id=$3)
       AND ($4::text IS NULL OR COALESCE(em.plant_section, g.plant_section)=$4) ORDER BY COALESCE(em.plant_section, g.plant_section), pi.started_at`,
    [startOfDayIST(start), endOfDayExclusiveIST(end), plantId??null, section??null]
  );
  const ws = sheetWithTitle(wb, 'Interruptions', 'Power Interruptions', { section, start, end }, ['Plant','Started At','Restored At','Duration (min)','Generator Used','Notes']);
  rows.forEach((r) => ws.addRow([sectionLabel(r.plant_section,r.plant_name),fmtTime(r.started_at),r.restored_at?fmtTime(r.restored_at):'Ongoing',r.duration_minutes??'N/A',r.generator_activated?'Yes':'No',r.notes??'']));
  return wb;
}

// "1 h 24 min" - downtime totals read better than raw minutes.
export function hm(mins: number): string {
  const m = Math.round(mins);
  if (m <= 0) return '0 min';
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

export interface InterruptionSummaryRow {
  period: Date | null; plant_section: string; count: number; total_minutes: number;
  longest_minutes: number; days_affected: number; generator_count: number; ongoing: boolean;
}

// Power interruptions rolled up per plant - per day, per month, or one row
// per plant for the whole period ('total'). Every plant gets a row in every
// bucket, including 0, so "no interruptions" is stated rather than implied by
// an empty table. An interruption counts toward the IST day/month it started
// in; one still ongoing counts its duration up to now (or the period end).
async function interruptionSummary(groupBy: 'day' | 'month' | 'total', start: string, end: string, plantId?: string, section?: string): Promise<InterruptionSummaryRow[]> {
  const bucketOf = (col: string) => groupBy === 'total' ? '$1::date' : `date_trunc('${groupBy}', ${col})::date`;
  const periods = groupBy === 'total'
    // $2 must appear in the query even here, or Postgres can't infer its type.
    ? 'SELECT $1::date AS p, $2::date AS period_end'
    : `SELECT generate_series(date_trunc('${groupBy}', $1::date), $2::date, '1 ${groupBy}')::date AS p`;
  const { rows } = await pool.query(
    `WITH periods AS (${periods}),
     secs AS (
       SELECT DISTINCT plant_section AS s FROM generators
       WHERE plant_section IS NOT NULL AND ($3::text IS NULL OR plant_section = $3)
     ),
     ev AS (
       SELECT ${bucketOf("pi.started_at AT TIME ZONE 'Asia/Colombo'")} AS p,
              (pi.started_at AT TIME ZONE 'Asia/Colombo')::date AS d,
              COALESCE(em.plant_section, g.plant_section) AS s,
              COALESCE(pi.duration_minutes, EXTRACT(EPOCH FROM (LEAST(NOW(), $5::timestamptz) - pi.started_at)) / 60) AS mins,
              pi.generator_activated AS gen, pi.restored_at IS NULL AS ongoing
       FROM power_interruptions pi
       LEFT JOIN energy_meters em ON em.meter_id = pi.meter_id
       LEFT JOIN generators g ON g.generator_id = pi.meter_id
       WHERE pi.started_at >= $4 AND pi.started_at < $5 AND ($6::uuid IS NULL OR pi.plant_id = $6)
     )
     SELECT periods.p, secs.s, COUNT(ev.d)::int AS n, COALESCE(SUM(ev.mins), 0)::float AS total,
            COALESCE(MAX(ev.mins), 0)::float AS longest, COUNT(DISTINCT ev.d)::int AS days,
            (COUNT(ev.d) FILTER (WHERE ev.gen))::int AS gen_n, COALESCE(bool_or(ev.ongoing), false) AS ongoing
     FROM periods CROSS JOIN secs
     LEFT JOIN ev ON ev.p = periods.p AND ev.s = secs.s
     GROUP BY periods.p, secs.s ORDER BY secs.s, periods.p`,
    [start, end, section ?? null, startOfDayIST(start), endOfDayExclusiveIST(end), plantId ?? null]
  );
  return rows.map((r) => ({
    period: groupBy === 'total' ? null : r.p, plant_section: r.s, count: r.n, total_minutes: r.total,
    longest_minutes: r.longest, days_affected: r.days, generator_count: r.gen_n, ongoing: r.ongoing,
  }));
}

// Adds a "Power Interruptions" summary sheet (per day or per month, per plant,
// with a TOTAL row per plant) plus the event list, to an energy report.
async function addInterruptionSheets(wb: ExcelJS.Workbook, groupBy: 'day' | 'month', start: string, end: string, plantId?: string, section?: string): Promise<void> {
  const rows = await interruptionSummary(groupBy, start, end, plantId, section);
  const daily = groupBy === 'day';
  const ws = sheetWithTitle(wb, 'Power Interruptions', daily ? 'Daily Power Interruptions' : 'Monthly Power Interruptions', { section, start, end },
    [daily ? 'Date' : 'Month', 'Plant', 'Interruptions', 'Days Affected', 'Total Downtime', 'Longest', 'Generator Used', 'Status']);
  const status = (r: { count: number; ongoing: boolean }) => r.ongoing ? 'Ongoing' : r.count ? 'Restored' : 'No interruptions';
  const totals: Record<string, { count: number; total: number; longest: number; days: number; gen: number }> = {};
  for (const r of rows) {
    const t = (totals[r.plant_section] ??= { count: 0, total: 0, longest: 0, days: 0, gen: 0 });
    t.count += r.count; t.total += r.total_minutes; t.longest = Math.max(t.longest, r.longest_minutes);
    t.days += r.days_affected; t.gen += r.generator_count;
    const label = daily ? fmtDate(r.period) : formatISTDate(`${r.period!.toISOString().slice(0, 10)}T00:00:00+05:30`, { year: 'numeric', month: 'long' });
    ws.addRow([label, sectionLabel(r.plant_section), r.count, r.days_affected, hm(r.total_minutes), r.count ? hm(r.longest_minutes) : '—', r.generator_count, status(r)]);
  }
  for (const [s, t] of Object.entries(totals)) {
    ws.addRow(['TOTAL', sectionLabel(s), t.count, t.days, hm(t.total), t.count ? hm(t.longest) : '—', t.gen, '']).font = { bold: true };
  }
  await buildInterruptions(start, end, plantId, section, wb);
}

// Standalone Daily / Monthly Power Interruption reports - the same
// summary + event-list sheets the energy reports carry.
async function buildInterruptionReport(groupBy: 'day' | 'month', start: string, end: string, plantId?: string, section?: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await addInterruptionSheets(wb, groupBy, start, end, plantId, section);
  return wb;
}

async function buildConsumptionSummary(start: string, end: string, plantId?: string, section?: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const [eRows, dRows] = await Promise.all([
    pool.query(`SELECT des.summary_date, p.name AS plant_name, em.plant_section, des.meter_id, des.total_kwh, des.ceb_kwh, des.generator_kwh, des.day_kwh, des.peak_kwh, des.off_peak_kwh FROM daily_energy_summary des LEFT JOIN plants p ON p.id=des.plant_id LEFT JOIN energy_meters em ON em.meter_id=des.meter_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR des.plant_id=$3) AND ($4::text IS NULL OR em.plant_section=$4) ORDER BY em.plant_section, summary_date, des.meter_id`, [start,end,plantId??null,section??null]),
    pool.query(`SELECT dds.summary_date, p.name AS plant_name, fm.plant_section, dds.meter_id, dds.total_liters, dds.generator_run_hours FROM daily_diesel_summary dds LEFT JOIN plants p ON p.id=dds.plant_id LEFT JOIN flow_meters fm ON fm.meter_id=dds.meter_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR dds.plant_id=$3) AND ($4::text IS NULL OR fm.plant_section=$4) ORDER BY fm.plant_section, summary_date, dds.meter_id`, [start,end,plantId??null,section??null]),
  ]);
  const es = sheetWithTitle(wb, 'Energy', 'Consumption Summary - Energy', { section, start, end }, ['Date','Plant','Meter','Total kWh','CEB kWh','Gen kWh','Day kWh','Peak kWh','Off-Peak kWh']); eRows.rows.forEach((r) => es.addRow([fmtDate(r.summary_date),sectionLabel(r.plant_section,r.plant_name),r.meter_id,r.total_kwh,r.ceb_kwh,r.generator_kwh,r.day_kwh,r.peak_kwh,r.off_peak_kwh]));
  const ds = sheetWithTitle(wb, 'Diesel', 'Consumption Summary - Diesel', { section, start, end }, ['Date','Plant','Meter','Liters','Run Hours']); dRows.rows.forEach((r) => ds.addRow([fmtDate(r.summary_date),sectionLabel(r.plant_section,r.plant_name),r.meter_id,r.total_liters,r.generator_run_hours]));
  return wb;
}

// One workbook, one tab per report type - used for the "all reports" bundle
// so a schedule doesn't have to pick just one report type to email.
async function buildAllCombined(start: string, end: string, plantId?: string, section?: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await buildEnergyDaily(start, end, plantId, undefined, section, wb);
  await buildDiesel(start, end, 'day', plantId, section, wb);
  await buildPowerQuality(start, end, plantId, undefined, section, wb);
  // Interruption sheets come with the Daily Energy tab above.
  return wb;
}

async function generate(input: GenerateReportInput): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const start = input.periodStart ?? getISTDateString(new Date(Date.now() - 30 * 86400000));
  const end = input.periodEnd ?? getISTDateString();
  const plantTag = input.section ? sectionLabel(input.section).replace(/\s+/g, '') : 'AllPlants';
  const tag = `${plantTag}_${start}_to_${end}`;

  let wb: ExcelJS.Workbook;
  switch (input.type) {
    case 'energy_daily':      wb = await buildEnergyDaily(start, end, input.plantId, input.meterId, input.section); break;
    case 'energy_monthly':    wb = await buildEnergyMonthly(start, end, input.plantId, input.section); break;
    case 'diesel_daily':      wb = await buildDiesel(start, end, 'day', input.plantId, input.section); break;
    case 'diesel_monthly':    wb = await buildDiesel(start, end, 'month', input.plantId, input.section); break;
    case 'power_quality':     wb = await buildPowerQuality(start, end, input.plantId, input.meterId, input.section); break;
    case 'power_interruption_daily':   wb = await buildInterruptionReport('day', start, end, input.plantId, input.section); break;
    case 'power_interruption_monthly': wb = await buildInterruptionReport('month', start, end, input.plantId, input.section); break;
    // Legacy undivided type - no longer offered, kept so old links/history still work.
    case 'power_interruption':wb = await buildInterruptions(start, end, input.plantId, input.section); break;
    case 'consumption_summary': wb = await buildConsumptionSummary(start, end, input.plantId, input.section); break;
    case 'all_combined':       wb = await buildAllCombined(start, end, input.plantId, input.section); break;
    default: throw new Error('Unknown report type');
  }

  if (input.format === 'pdf') {
    const buffer = await buildPDF(wb, input.type, start, end, input.section);
    return { buffer, filename: `${input.type}_${tag}.pdf`, contentType: 'application/pdf' };
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${input.type}_${tag}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

async function buildPDF(wb: ExcelJS.Workbook, type: string, start: string, end: string, section?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).fillColor('#1e40af').text('Energy Monitoring System', { align: 'center' });
    doc.fontSize(12).fillColor('#374151').text(`Report: ${type.replace(/_/g,' ')}`, { align: 'center' });
    doc.fontSize(13).fillColor('#111827').text(`Plant: ${scopeLabel(section)}`, { align: 'center' });
    doc.fontSize(10).fillColor('#6b7280').text(`Period: ${start} — ${end}  |  Generated: ${formatISTDateTime(new Date())} IST`, { align: 'center' });
    doc.moveDown();
    const left = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    // Multi-tab reports (e.g. all_combined) render every worksheet in turn,
    // each starting on its own page - a single flat PDF can't show tabs.
    wb.worksheets.forEach((sheet, sheetIdx) => {
      if (sheetIdx > 0) doc.addPage();
      if (wb.worksheets.length > 1) {
        doc.fontSize(13).fillColor('#1e40af').text(sheet.name, left, doc.y);
        doc.moveDown(0.5);
      }
      const headerRow = headerRowOf.get(sheet) ?? 1;
      const colCount = sheet.getRow(headerRow).actualCellCount || sheet.columnCount;
      const colWidth = usableWidth / Math.max(colCount, 1);
      let y = doc.y;
      sheet.eachRow((row, rn) => {
        if (rn < headerRow) return; // title block - already in the PDF heading
        if (y > pageBottom - 20) { doc.addPage(); y = doc.page.margins.top; }
        doc.fillColor(rn === headerRow ? '#1e40af' : '#111827').fontSize(7);
        let x = left;
        row.eachCell({ includeEmpty: true }, (cell) => {
          doc.text(String(cell.value ?? ''), x, y, { width: colWidth - 4, ellipsis: true });
          x += colWidth;
        });
        y += 14;
      });
    });
    doc.end();
  });
}

export const reportService = { generate, interruptionSummary };
