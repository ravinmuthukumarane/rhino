import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import pool from '../config/database';
import { GenerateReportInput } from '../types';

const HFILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
const HFONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

function hdr(sheet: ExcelJS.Worksheet, cols: string[]): void {
  const row = sheet.addRow(cols);
  row.eachCell((cell) => { cell.fill = HFILL; cell.font = HFONT; cell.alignment = { horizontal: 'center' }; });
}

function fmtDate(d: any): string { return d ? new Date(d).toLocaleDateString() : ''; }
function fmtTime(d: any): string { return d ? new Date(d).toLocaleString() : ''; }
function n(v: any, dp = 2): string { return v != null ? parseFloat(v).toFixed(dp) : '0.00'; }

async function buildEnergyDaily(start: string, end: string, plantId?: string, meterId?: string): Promise<ExcelJS.Workbook> {
  const { rows } = await pool.query(
    `SELECT des.*, p.name AS plant_name FROM daily_energy_summary des
     LEFT JOIN plants p ON p.id = des.plant_id
     WHERE des.summary_date BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR des.plant_id = $3)
       AND ($4::text IS NULL OR des.meter_id = $4)
     ORDER BY des.plant_id, des.summary_date`,
    [start, end, plantId ?? null, meterId ?? null]
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Daily Energy');
  hdr(ws, ['Date','Plant','Meter','Total kWh','Max kVA','Avg PF','Avg Voltage','CEB kWh','Gen kWh','Day kWh','Peak kWh','Off-Peak kWh','Interruptions']);
  rows.forEach((r) => ws.addRow([fmtDate(r.summary_date),r.plant_name,r.meter_id,n(r.total_kwh),n(r.max_kva),n(r.avg_power_factor,3),n(r.avg_voltage,1),n(r.ceb_kwh),n(r.generator_kwh),n(r.day_kwh),n(r.peak_kwh),n(r.off_peak_kwh),r.interruption_count]));
  return wb;
}

async function buildEnergyMonthly(start: string, end: string, plantId?: string): Promise<ExcelJS.Workbook> {
  const { rows } = await pool.query(
    `SELECT DATE_TRUNC('month',summary_date) AS month, p.name AS plant_name, des.plant_id, des.meter_id,
            SUM(total_kwh)::numeric(14,2) AS total_kwh, MAX(max_kva)::numeric(10,2) AS max_kva,
            AVG(avg_power_factor)::numeric(5,3) AS avg_pf,
            SUM(ceb_kwh)::numeric(14,2) AS ceb_kwh, SUM(generator_kwh)::numeric(14,2) AS gen_kwh,
            SUM(day_kwh)::numeric(14,2) AS day_kwh, SUM(peak_kwh)::numeric(14,2) AS peak_kwh,
            SUM(off_peak_kwh)::numeric(14,2) AS off_peak_kwh
     FROM daily_energy_summary des LEFT JOIN plants p ON p.id=des.plant_id
     WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR des.plant_id=$3)
     GROUP BY DATE_TRUNC('month',summary_date), des.plant_id, p.name, des.meter_id ORDER BY month`,
    [start, end, plantId ?? null]
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Monthly Energy');
  hdr(ws, ['Month','Plant','Meter','Total kWh','Max kVA','Avg PF','CEB kWh','Gen kWh','Day kWh','Peak kWh','Off-Peak kWh']);
  rows.forEach((r) => ws.addRow([new Date(r.month).toLocaleDateString('en-GB',{year:'numeric',month:'long'}),r.plant_name,r.meter_id,r.total_kwh,r.max_kva,r.avg_pf,r.ceb_kwh,r.gen_kwh,r.day_kwh,r.peak_kwh,r.off_peak_kwh]));
  return wb;
}

async function buildDiesel(start: string, end: string, groupBy: 'day'|'month', plantId?: string): Promise<ExcelJS.Workbook> {
  const { rows } = groupBy === 'month'
    ? await pool.query(`SELECT DATE_TRUNC('month',summary_date) AS period, p.name AS plant_name, dds.meter_id, SUM(total_liters)::numeric(14,2) AS total_liters, SUM(generator_run_hours)::numeric(8,2) AS run_hours FROM daily_diesel_summary dds LEFT JOIN plants p ON p.id=dds.plant_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR dds.plant_id=$3) GROUP BY DATE_TRUNC('month',summary_date),dds.plant_id,p.name,dds.meter_id ORDER BY period`, [start,end,plantId??null])
    : await pool.query(`SELECT summary_date AS period, p.name AS plant_name, dds.meter_id, total_liters, generator_run_hours AS run_hours FROM daily_diesel_summary dds LEFT JOIN plants p ON p.id=dds.plant_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR dds.plant_id=$3) ORDER BY period`, [start,end,plantId??null]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Diesel');
  hdr(ws, ['Period','Plant','Meter','Diesel (L)','Gen Run Hours']);
  rows.forEach((r) => ws.addRow([fmtDate(r.period),r.plant_name,r.meter_id,n(r.total_liters),n(r.run_hours)]));
  return wb;
}

async function buildPowerQuality(start: string, end: string, plantId?: string, meterId?: string): Promise<ExcelJS.Workbook> {
  const { rows } = await pool.query(
    `SELECT er.recorded_at, p.name AS plant_name, er.meter_id, er.voltage_r, er.voltage_y, er.voltage_b,
            er.current_r, er.current_y, er.current_b, er.power_kw, er.power_kva, er.power_factor,
            er.frequency, er.source
     FROM energy_readings er LEFT JOIN plants p ON p.id=er.plant_id
     WHERE er.recorded_at BETWEEN $1 AND $2
       AND ($3::uuid IS NULL OR er.plant_id=$3) AND ($4::text IS NULL OR er.meter_id=$4)
     ORDER BY er.recorded_at LIMIT 50000`,
    [new Date(start), new Date(end), plantId??null, meterId??null]
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Power Quality');
  hdr(ws, ['Timestamp','Plant','Meter','VR','VY','VB','IR','IY','IB','kW','kVA','PF','Hz','Source']);
  rows.forEach((r) => ws.addRow([fmtTime(r.recorded_at),r.plant_name,r.meter_id,r.voltage_r,r.voltage_y,r.voltage_b,r.current_r,r.current_y,r.current_b,r.power_kw,r.power_kva,r.power_factor,r.frequency,r.source]));
  return wb;
}

async function buildInterruptions(start: string, end: string, plantId?: string): Promise<ExcelJS.Workbook> {
  const { rows } = await pool.query(
    `SELECT pi.*, p.name AS plant_name FROM power_interruptions pi LEFT JOIN plants p ON p.id=pi.plant_id
     WHERE pi.started_at BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR pi.plant_id=$3) ORDER BY pi.started_at`,
    [new Date(start), new Date(end), plantId??null]
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Interruptions');
  hdr(ws, ['Started At','Restored At','Duration (min)','Plant','Generator Used','Notes']);
  rows.forEach((r) => ws.addRow([fmtTime(r.started_at),r.restored_at?fmtTime(r.restored_at):'Ongoing',r.duration_minutes??'N/A',r.plant_name,r.generator_activated?'Yes':'No',r.notes??'']));
  return wb;
}

async function buildConsumptionSummary(start: string, end: string, plantId?: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const [eRows, dRows] = await Promise.all([
    pool.query(`SELECT des.summary_date, p.name AS plant_name, des.meter_id, des.total_kwh, des.ceb_kwh, des.generator_kwh, des.day_kwh, des.peak_kwh, des.off_peak_kwh FROM daily_energy_summary des LEFT JOIN plants p ON p.id=des.plant_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR des.plant_id=$3) ORDER BY summary_date`, [start,end,plantId??null]),
    pool.query(`SELECT dds.summary_date, p.name AS plant_name, dds.meter_id, dds.total_liters, dds.generator_run_hours FROM daily_diesel_summary dds LEFT JOIN plants p ON p.id=dds.plant_id WHERE summary_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR dds.plant_id=$3) ORDER BY summary_date`, [start,end,plantId??null]),
  ]);
  const es = wb.addWorksheet('Energy'); hdr(es,['Date','Plant','Meter','Total kWh','CEB kWh','Gen kWh','Day kWh','Peak kWh','Off-Peak kWh']); eRows.rows.forEach((r) => es.addRow([fmtDate(r.summary_date),r.plant_name,r.meter_id,r.total_kwh,r.ceb_kwh,r.generator_kwh,r.day_kwh,r.peak_kwh,r.off_peak_kwh]));
  const ds = wb.addWorksheet('Diesel'); hdr(ds,['Date','Plant','Meter','Liters','Run Hours']); dRows.rows.forEach((r) => ds.addRow([fmtDate(r.summary_date),r.plant_name,r.meter_id,r.total_liters,r.generator_run_hours]));
  return wb;
}

async function generate(input: GenerateReportInput): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const start = input.periodStart ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const end = input.periodEnd ?? new Date().toISOString().split('T')[0];
  const tag = `${start}_to_${end}`;

  let wb: ExcelJS.Workbook;
  switch (input.type) {
    case 'energy_daily':      wb = await buildEnergyDaily(start, end, input.plantId, input.meterId); break;
    case 'energy_monthly':    wb = await buildEnergyMonthly(start, end, input.plantId); break;
    case 'diesel_daily':      wb = await buildDiesel(start, end, 'day', input.plantId); break;
    case 'diesel_monthly':    wb = await buildDiesel(start, end, 'month', input.plantId); break;
    case 'power_quality':     wb = await buildPowerQuality(start, end, input.plantId, input.meterId); break;
    case 'power_interruption':wb = await buildInterruptions(start, end, input.plantId); break;
    case 'consumption_summary': wb = await buildConsumptionSummary(start, end, input.plantId); break;
    default: throw new Error('Unknown report type');
  }

  if (input.format === 'pdf') {
    const buffer = await buildPDF(wb, input.type, start, end);
    return { buffer, filename: `${input.type}_${tag}.pdf`, contentType: 'application/pdf' };
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${input.type}_${tag}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

async function buildPDF(wb: ExcelJS.Workbook, type: string, start: string, end: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).fillColor('#1e40af').text('Energy Monitoring System', { align: 'center' });
    doc.fontSize(12).fillColor('#374151').text(`Report: ${type.replace(/_/g,' ')}`, { align: 'center' });
    doc.fontSize(10).fillColor('#6b7280').text(`Period: ${start} — ${end}  |  Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown();
    const sheet = wb.getWorksheet(1);
    if (sheet) {
      const left = doc.page.margins.left;
      const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const pageBottom = doc.page.height - doc.page.margins.bottom;
      const colCount = sheet.getRow(1).actualCellCount || sheet.columnCount;
      const colWidth = usableWidth / Math.max(colCount, 1);
      let y = doc.y;
      sheet.eachRow((row, rn) => {
        if (y > pageBottom - 20) { doc.addPage(); y = doc.page.margins.top; }
        doc.fillColor(rn === 1 ? '#1e40af' : '#111827').fontSize(7);
        let x = left;
        row.eachCell({ includeEmpty: true }, (cell) => {
          doc.text(String(cell.value ?? ''), x, y, { width: colWidth - 4, ellipsis: true });
          x += colWidth;
        });
        y += 14;
      });
    }
    doc.end();
  });
}

export const reportService = { generate };
