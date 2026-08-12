import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { cacheWrap } from '../config/redis';
import { getTimePeriod } from '../utils/timeUtils';
import { AuthRequest } from '../types';

export async function getLatestReading(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id } = req.query as { plant_id?: string };
  try {
    const plantFilter = plant_id ? 'AND plant_id = $1' : '';
    const params = plant_id ? [plant_id] : [];

    const [energy, diesel, generator] = await Promise.all([
      pool.query(`SELECT er.*, p.name AS plant_name FROM energy_readings er LEFT JOIN plants p ON p.id=er.plant_id WHERE 1=1 ${plantFilter} ORDER BY recorded_at DESC LIMIT 1`, params),
      pool.query(`SELECT dr.*, p.name AS plant_name FROM diesel_readings dr LEFT JOIN plants p ON p.id=dr.plant_id WHERE 1=1 ${plantFilter} ORDER BY recorded_at DESC LIMIT 1`, params),
      pool.query(`SELECT ge.*, p.name AS plant_name FROM generator_events ge LEFT JOIN plants p ON p.id=ge.plant_id WHERE 1=1 ${plantFilter} ORDER BY recorded_at DESC LIMIT 1`, params),
    ]);

    res.json({
      energy: energy.rows[0] ?? null,
      diesel: diesel.rows[0] ?? null,
      generator: generator.rows[0] ?? null,
      timePeriod: getTimePeriod(),
    });
  } catch (err) { next(err); }
}

// One row per meter (not just the single latest row for the whole plant) -
// lets a page with many meter cards (Plant Overview) seed every card
// immediately on load instead of waiting for each meter's next MQTT push.
export async function getLatestReadingsByMeter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id } = req.query as { plant_id?: string };
  try {
    const result = await cacheWrap(`latest-by-meter:${plant_id ?? 'all'}`, 10, async () => {
      const plantFilter = plant_id ? 'AND plant_id = $1' : '';
      const params = plant_id ? [plant_id] : [];

      const [energy, diesel] = await Promise.all([
        pool.query(
          `SELECT DISTINCT ON (meter_id) * FROM energy_readings
           WHERE 1=1 ${plantFilter}
           ORDER BY meter_id, recorded_at DESC`,
          params
        ),
        pool.query(
          `SELECT DISTINCT ON (meter_id) * FROM diesel_readings
           WHERE 1=1 ${plantFilter}
           ORDER BY meter_id, recorded_at DESC`,
          params
        ),
      ]);

      return {
        energy: Object.fromEntries(energy.rows.map((r) => [r.meter_id, r])),
        diesel: Object.fromEntries(diesel.rows.map((r) => [r.meter_id, r])),
      };
    });

    res.json(result);
  } catch (err) { next(err); }
}

export async function getEnergyHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { from, to, plant_id, meter_id, limit = '500' } = req.query as Record<string, string>;
  try {
    const { rows } = await pool.query(
      `SELECT er.*, p.name AS plant_name FROM energy_readings er
       LEFT JOIN plants p ON p.id = er.plant_id
       WHERE ($1::timestamptz IS NULL OR er.recorded_at >= $1)
         AND ($2::timestamptz IS NULL OR er.recorded_at <= $2)
         AND ($3::uuid IS NULL OR er.plant_id = $3)
         AND ($4::text IS NULL OR er.meter_id = $4)
       ORDER BY er.recorded_at DESC LIMIT $5`,
      [from ?? null, to ?? null, plant_id ?? null, meter_id ?? null, Math.min(parseInt(limit), 2000)]
    );
    res.json({ readings: rows });
  } catch (err) { next(err); }
}

export async function getDieselHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { from, to, plant_id, meter_id, limit = '500' } = req.query as Record<string, string>;
  try {
    const { rows } = await pool.query(
      `SELECT dr.*, p.name AS plant_name FROM diesel_readings dr
       LEFT JOIN plants p ON p.id = dr.plant_id
       WHERE ($1::timestamptz IS NULL OR dr.recorded_at >= $1)
         AND ($2::timestamptz IS NULL OR dr.recorded_at <= $2)
         AND ($3::uuid IS NULL OR dr.plant_id = $3)
         AND ($4::text IS NULL OR dr.meter_id = $4)
       ORDER BY dr.recorded_at DESC LIMIT $5`,
      [from ?? null, to ?? null, plant_id ?? null, meter_id ?? null, Math.min(parseInt(limit), 2000)]
    );
    res.json({ readings: rows });
  } catch (err) { next(err); }
}

export async function getGeneratorEvents(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { from, to, plant_id, limit = '200' } = req.query as Record<string, string>;
  try {
    const { rows } = await pool.query(
      `SELECT ge.*, p.name AS plant_name FROM generator_events ge
       LEFT JOIN plants p ON p.id = ge.plant_id
       WHERE ($1::timestamptz IS NULL OR ge.recorded_at >= $1)
         AND ($2::timestamptz IS NULL OR ge.recorded_at <= $2)
         AND ($3::uuid IS NULL OR ge.plant_id = $3)
       ORDER BY ge.recorded_at DESC LIMIT $4`,
      [from ?? null, to ?? null, plant_id ?? null, Math.min(parseInt(limit), 1000)]
    );
    res.json({ events: rows });
  } catch (err) { next(err); }
}

export async function getDailySummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { from, to, plant_id, meter_id, plant_section, limit = '365' } = req.query as Record<string, string>;
  try {
    const cacheKey = `daily-summary:${from ?? ''}:${to ?? ''}:${plant_id ?? ''}:${meter_id ?? ''}:${plant_section ?? ''}:${limit}`;
    const result = await cacheWrap(cacheKey, 20, async () => {
      // When meter_id isn't specified, aggregate across every meter for the
      // plant (one row per date) rather than returning one row per meter per
      // date - callers that want plant-wide totals (e.g. the dashboard chart)
      // would otherwise get N rows per date and no way to combine them.
      // plant_section (e.g. "P1"/"P4") narrows that aggregate to the meters
      // fed from one physical section/incomer, via a join on the device registry.
      const [energy, diesel] = await Promise.all([
        pool.query(
          `SELECT des.summary_date, des.plant_id, p.name AS plant_name,
                  ${meter_id ? 'des.meter_id,' : ''}
                  SUM(des.total_kwh)::numeric(14,3) AS total_kwh,
                  MAX(des.max_kva)::numeric(10,3) AS max_kva,
                  AVG(des.avg_power_factor)::numeric(5,3) AS avg_power_factor,
                  AVG(des.avg_voltage)::numeric(8,3) AS avg_voltage,
                  SUM(des.ceb_kwh)::numeric(14,3) AS ceb_kwh,
                  SUM(des.generator_kwh)::numeric(14,3) AS generator_kwh,
                  SUM(des.day_kwh)::numeric(14,3) AS day_kwh,
                  SUM(des.peak_kwh)::numeric(14,3) AS peak_kwh,
                  SUM(des.off_peak_kwh)::numeric(14,3) AS off_peak_kwh,
                  SUM(des.interruption_count) AS interruption_count
           FROM daily_energy_summary des
           LEFT JOIN plants p ON p.id = des.plant_id
           LEFT JOIN energy_meters em ON em.meter_id = des.meter_id
           WHERE ($1::date IS NULL OR des.summary_date >= $1)
             AND ($2::date IS NULL OR des.summary_date <= $2)
             AND ($3::uuid IS NULL OR des.plant_id = $3)
             AND ($4::text IS NULL OR des.meter_id = $4)
             AND ($6::text IS NULL OR em.plant_section = $6)
           GROUP BY des.summary_date, des.plant_id, p.name${meter_id ? ', des.meter_id' : ''}
           ORDER BY des.summary_date DESC LIMIT $5`,
          [from ?? null, to ?? null, plant_id ?? null, meter_id ?? null, Math.min(parseInt(limit), 730), plant_section ?? null]
        ),
        pool.query(
          `SELECT dds.summary_date, dds.plant_id, p.name AS plant_name,
                  ${meter_id ? 'dds.meter_id,' : ''}
                  SUM(dds.total_liters)::numeric(14,3) AS total_liters,
                  SUM(dds.generator_run_hours)::numeric(8,3) AS generator_run_hours
           FROM daily_diesel_summary dds
           LEFT JOIN plants p ON p.id = dds.plant_id
           LEFT JOIN flow_meters fm ON fm.meter_id = dds.meter_id
           WHERE ($1::date IS NULL OR dds.summary_date >= $1)
             AND ($2::date IS NULL OR dds.summary_date <= $2)
             AND ($3::uuid IS NULL OR dds.plant_id = $3)
             AND ($4::text IS NULL OR dds.meter_id = $4)
             AND ($6::text IS NULL OR fm.plant_section = $6)
           GROUP BY dds.summary_date, dds.plant_id, p.name${meter_id ? ', dds.meter_id' : ''}
           ORDER BY dds.summary_date DESC LIMIT $5`,
          [from ?? null, to ?? null, plant_id ?? null, meter_id ?? null, Math.min(parseInt(limit), 730), plant_section ?? null]
        ),
      ]);
      return { energy: energy.rows, diesel: diesel.rows };
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function getMonthlySummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { year = String(new Date().getFullYear()), plant_id, meter_id, plant_section } = req.query as Record<string, string>;
  try {
    const cacheKey = `monthly-summary:${year}:${plant_id ?? ''}:${meter_id ?? ''}:${plant_section ?? ''}`;
    const result = await cacheWrap(cacheKey, 60, async () => {
      // Same reasoning as getDailySummary: only group by meter_id when a
      // specific meter was requested, otherwise aggregate the whole plant
      // (optionally narrowed further to one plant_section).
      const [energy, diesel] = await Promise.all([
        pool.query(
          `SELECT DATE_TRUNC('month', summary_date) AS month,
                  des.plant_id, p.name AS plant_name${meter_id ? ', des.meter_id' : ''},
                  SUM(total_kwh)::numeric(14,2) AS total_kwh,
                  MAX(max_kva)::numeric(10,2) AS max_kva,
                  AVG(avg_power_factor)::numeric(5,3) AS avg_power_factor,
                  SUM(ceb_kwh)::numeric(14,2) AS ceb_kwh,
                  SUM(generator_kwh)::numeric(14,2) AS generator_kwh,
                  SUM(day_kwh)::numeric(14,2) AS day_kwh,
                  SUM(peak_kwh)::numeric(14,2) AS peak_kwh,
                  SUM(off_peak_kwh)::numeric(14,2) AS off_peak_kwh,
                  SUM(interruption_count) AS interruption_count
           FROM daily_energy_summary des
           LEFT JOIN plants p ON p.id = des.plant_id
           LEFT JOIN energy_meters em ON em.meter_id = des.meter_id
           WHERE EXTRACT(YEAR FROM summary_date) = $1
             AND ($2::uuid IS NULL OR des.plant_id = $2)
             AND ($3::text IS NULL OR des.meter_id = $3)
             AND ($4::text IS NULL OR em.plant_section = $4)
           GROUP BY DATE_TRUNC('month', summary_date), des.plant_id, p.name${meter_id ? ', des.meter_id' : ''}
           ORDER BY month`,
          [parseInt(year), plant_id ?? null, meter_id ?? null, plant_section ?? null]
        ),
        pool.query(
          `SELECT DATE_TRUNC('month', summary_date) AS month,
                  dds.plant_id, p.name AS plant_name${meter_id ? ', dds.meter_id' : ''},
                  SUM(total_liters)::numeric(14,2) AS total_liters,
                  SUM(generator_run_hours)::numeric(8,2) AS generator_run_hours
           FROM daily_diesel_summary dds
           LEFT JOIN plants p ON p.id = dds.plant_id
           LEFT JOIN flow_meters fm ON fm.meter_id = dds.meter_id
           WHERE EXTRACT(YEAR FROM summary_date) = $1
             AND ($2::uuid IS NULL OR dds.plant_id = $2)
             AND ($3::text IS NULL OR dds.meter_id = $3)
             AND ($4::text IS NULL OR fm.plant_section = $4)
           GROUP BY DATE_TRUNC('month', summary_date), dds.plant_id, p.name${meter_id ? ', dds.meter_id' : ''}
           ORDER BY month`,
          [parseInt(year), plant_id ?? null, meter_id ?? null, plant_section ?? null]
        ),
      ]);
      return { energy: energy.rows, diesel: diesel.rows };
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function getYearlySummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id, plant_section } = req.query as { plant_id?: string; plant_section?: string };
  try {
    const cacheKey = `yearly-summary:${plant_id ?? ''}:${plant_section ?? ''}`;
    const result = await cacheWrap(cacheKey, 60, async () => {
      const [energy, diesel] = await Promise.all([
        pool.query(
          `SELECT EXTRACT(YEAR FROM summary_date)::int AS year,
                  des.plant_id, p.name AS plant_name,
                  SUM(total_kwh)::numeric(14,2) AS total_kwh,
                  MAX(max_kva)::numeric(10,2) AS max_kva,
                  SUM(ceb_kwh)::numeric(14,2) AS ceb_kwh,
                  SUM(generator_kwh)::numeric(14,2) AS generator_kwh
           FROM daily_energy_summary des
           LEFT JOIN plants p ON p.id = des.plant_id
           LEFT JOIN energy_meters em ON em.meter_id = des.meter_id
           WHERE ($1::uuid IS NULL OR des.plant_id = $1)
             AND ($2::text IS NULL OR em.plant_section = $2)
           GROUP BY EXTRACT(YEAR FROM summary_date), des.plant_id, p.name
           ORDER BY year DESC LIMIT 10`,
          [plant_id ?? null, plant_section ?? null]
        ),
        pool.query(
          `SELECT EXTRACT(YEAR FROM summary_date)::int AS year,
                  dds.plant_id, p.name AS plant_name,
                  SUM(total_liters)::numeric(14,2) AS total_liters,
                  SUM(generator_run_hours)::numeric(8,2) AS generator_run_hours
           FROM daily_diesel_summary dds
           LEFT JOIN plants p ON p.id = dds.plant_id
           LEFT JOIN flow_meters fm ON fm.meter_id = dds.meter_id
           WHERE ($1::uuid IS NULL OR dds.plant_id = $1)
             AND ($2::text IS NULL OR fm.plant_section = $2)
           GROUP BY EXTRACT(YEAR FROM summary_date), dds.plant_id, p.name
           ORDER BY year DESC LIMIT 10`,
          [plant_id ?? null, plant_section ?? null]
        ),
      ]);
      return { energy: energy.rows, diesel: diesel.rows };
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function getPowerInterruptions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { from, to, plant_id, limit = '100' } = req.query as Record<string, string>;
  try {
    const { rows } = await pool.query(
      `SELECT pi.*, p.name AS plant_name FROM power_interruptions pi
       LEFT JOIN plants p ON p.id = pi.plant_id
       WHERE ($1::timestamptz IS NULL OR pi.started_at >= $1)
         AND ($2::timestamptz IS NULL OR pi.started_at <= $2)
         AND ($3::uuid IS NULL OR pi.plant_id = $3)
       ORDER BY pi.started_at DESC LIMIT $4`,
      [from ?? null, to ?? null, plant_id ?? null, Math.min(parseInt(limit), 500)]
    );
    res.json({ interruptions: rows });
  } catch (err) { next(err); }
}

export async function getDashboardStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id, plant_section } = req.query as { plant_id?: string; plant_section?: string };
  const today = new Date().toISOString().split('T')[0];
  try {
    const cacheKey = `dashboard-stats:${today}:${plant_id ?? ''}:${plant_section ?? ''}`;
    const result = await cacheWrap(cacheKey, 15, async () => {
      // plant_section (e.g. "P1"/"P4") narrows every stat to the meters fed
      // from one physical section/incomer, via a join on the device registry -
      // alerts/interruptions aren't tied to a specific meter table, so they're
      // matched against whichever registry (energy or flow meter) owns that meter_id.
      const [todayE, todayD, activeA, interrupts] = await Promise.all([
        pool.query(
          `SELECT SUM(des.total_kwh) AS total_kwh, MAX(des.max_kva) AS max_kva, AVG(des.avg_power_factor) AS avg_power_factor, AVG(des.avg_voltage) AS avg_voltage
           FROM daily_energy_summary des
           LEFT JOIN energy_meters em ON em.meter_id = des.meter_id
           WHERE des.summary_date = $1
             AND ($2::uuid IS NULL OR des.plant_id = $2)
             AND ($3::text IS NULL OR em.plant_section = $3)`,
          [today, plant_id ?? null, plant_section ?? null]
        ),
        pool.query(
          `SELECT SUM(dds.total_liters) AS total_liters, SUM(dds.generator_run_hours) AS run_hours
           FROM daily_diesel_summary dds
           LEFT JOIN flow_meters fm ON fm.meter_id = dds.meter_id
           WHERE dds.summary_date = $1
             AND ($2::uuid IS NULL OR dds.plant_id = $2)
             AND ($3::text IS NULL OR fm.plant_section = $3)`,
          [today, plant_id ?? null, plant_section ?? null]
        ),
        pool.query(
          `SELECT COUNT(*) FROM alerts a
           LEFT JOIN energy_meters em ON em.meter_id = a.meter_id
           LEFT JOIN flow_meters fm ON fm.meter_id = a.meter_id
           WHERE a.acknowledged = false
             AND ($1::uuid IS NULL OR a.plant_id = $1)
             AND ($2::text IS NULL OR COALESCE(em.plant_section, fm.plant_section) = $2)`,
          [plant_id ?? null, plant_section ?? null]
        ),
        pool.query(
          `SELECT COUNT(*) FROM power_interruptions pi
           LEFT JOIN energy_meters em ON em.meter_id = pi.meter_id
           WHERE pi.started_at::date = $1
             AND ($2::uuid IS NULL OR pi.plant_id = $2)
             AND ($3::text IS NULL OR em.plant_section = $3)`,
          [today, plant_id ?? null, plant_section ?? null]
        ),
      ]);
      return {
        today: { energy: todayE.rows[0] ?? {}, diesel: todayD.rows[0] ?? {} },
        activeAlerts: parseInt(activeA.rows[0].count),
        todayInterruptions: parseInt(interrupts.rows[0].count),
      };
    });
    res.json(result);
  } catch (err) { next(err); }
}
