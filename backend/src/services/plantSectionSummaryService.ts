import pool from '../config/database';

export interface SectionSummary {
  plant_section: string;
  total_kwh: number | null;
  max_kva: number | null;
  avg_power_factor: number | null;
  avg_voltage: number | null;
  ceb_kwh: number | null;
  generator_kwh: number | null;
  total_liters: number | null;
  generator_run_hours: number | null;
}

// Aggregates daily_energy_summary/daily_diesel_summary over a date range,
// grouped by plant_section (joined in via energy_meters/flow_meters, same
// pattern as getDashboardStats in readingsController.ts). Iterates whatever
// sections actually exist rather than hardcoding P1/P4, so a renamed or
// added section doesn't silently drop out of scheduled report emails.
async function getSectionSummaries(start: string, end: string): Promise<SectionSummary[]> {
  const [energy, diesel] = await Promise.all([
    pool.query(
      `SELECT COALESCE(em.plant_section, 'Unassigned') AS plant_section,
              SUM(des.total_kwh) AS total_kwh, MAX(des.max_kva) AS max_kva,
              AVG(des.avg_power_factor) AS avg_power_factor, AVG(des.avg_voltage) AS avg_voltage,
              SUM(des.ceb_kwh) AS ceb_kwh, SUM(des.generator_kwh) AS generator_kwh
       FROM daily_energy_summary des
       LEFT JOIN energy_meters em ON em.meter_id = des.meter_id
       WHERE des.summary_date BETWEEN $1 AND $2
       GROUP BY COALESCE(em.plant_section, 'Unassigned')`,
      [start, end]
    ),
    pool.query(
      `SELECT COALESCE(fm.plant_section, 'Unassigned') AS plant_section,
              SUM(dds.total_liters) AS total_liters, SUM(dds.generator_run_hours) AS generator_run_hours
       FROM daily_diesel_summary dds
       LEFT JOIN flow_meters fm ON fm.meter_id = dds.meter_id
       WHERE dds.summary_date BETWEEN $1 AND $2
       GROUP BY COALESCE(fm.plant_section, 'Unassigned')`,
      [start, end]
    ),
  ]);

  const bySection = new Map<string, SectionSummary>();
  for (const r of energy.rows) {
    bySection.set(r.plant_section, {
      plant_section: r.plant_section,
      total_kwh: r.total_kwh, max_kva: r.max_kva,
      avg_power_factor: r.avg_power_factor, avg_voltage: r.avg_voltage,
      ceb_kwh: r.ceb_kwh, generator_kwh: r.generator_kwh,
      total_liters: null, generator_run_hours: null,
    });
  }
  for (const r of diesel.rows) {
    const existing = bySection.get(r.plant_section);
    if (existing) {
      existing.total_liters = r.total_liters;
      existing.generator_run_hours = r.generator_run_hours;
    } else {
      bySection.set(r.plant_section, {
        plant_section: r.plant_section,
        total_kwh: null, max_kva: null, avg_power_factor: null, avg_voltage: null,
        ceb_kwh: null, generator_kwh: null,
        total_liters: r.total_liters, generator_run_hours: r.generator_run_hours,
      });
    }
  }
  return [...bySection.values()].sort((a, b) => a.plant_section.localeCompare(b.plant_section));
}

export const plantSectionSummaryService = { getSectionSummaries };
