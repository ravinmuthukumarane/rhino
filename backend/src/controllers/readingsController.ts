import { Response, NextFunction } from 'express';
import pool from '../config/database';
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
  const { from, to, plant_id, meter_id, limit = '365' } = req.query as Record<string, string>;
  try {
    const [energy, diesel] = await Promise.all([
      pool.query(
        `SELECT des.*, p.name AS plant_name FROM daily_energy_summary des
         LEFT JOIN plants p ON p.id = des.plant_id
         WHERE ($1::date IS NULL OR des.summary_date >= $1)
           AND ($2::date IS NULL OR des.summary_date <= $2)
           AND ($3::uuid IS NULL OR des.plant_id = $3)
           AND ($4::text IS NULL OR des.meter_id = $4)
         ORDER BY des.summary_date DESC LIMIT $5`,
        [from ?? null, to ?? null, plant_id ?? null, meter_id ?? null, Math.min(parseInt(limit), 730)]
      ),
      pool.query(
        `SELECT dds.*, p.name AS plant_name FROM daily_diesel_summary dds
         LEFT JOIN plants p ON p.id = dds.plant_id
         WHERE ($1::date IS NULL OR dds.summary_date >= $1)
           AND ($2::date IS NULL OR dds.summary_date <= $2)
           AND ($3::uuid IS NULL OR dds.plant_id = $3)
           AND ($4::text IS NULL OR dds.meter_id = $4)
         ORDER BY dds.summary_date DESC LIMIT $5`,
        [from ?? null, to ?? null, plant_id ?? null, meter_id ?? null, Math.min(parseInt(limit), 730)]
      ),
    ]);
    res.json({ energy: energy.rows, diesel: diesel.rows });
  } catch (err) { next(err); }
}

export async function getMonthlySummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { year = String(new Date().getFullYear()), plant_id, meter_id } = req.query as Record<string, string>;
  try {
    const [energy, diesel] = await Promise.all([
      pool.query(
        `SELECT DATE_TRUNC('month', summary_date) AS month,
                des.plant_id, p.name AS plant_name, des.meter_id,
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
         WHERE EXTRACT(YEAR FROM summary_date) = $1
           AND ($2::uuid IS NULL OR des.plant_id = $2)
           AND ($3::text IS NULL OR des.meter_id = $3)
         GROUP BY DATE_TRUNC('month', summary_date), des.plant_id, p.name, des.meter_id
         ORDER BY month`,
        [parseInt(year), plant_id ?? null, meter_id ?? null]
      ),
      pool.query(
        `SELECT DATE_TRUNC('month', summary_date) AS month,
                dds.plant_id, p.name AS plant_name, dds.meter_id,
                SUM(total_liters)::numeric(14,2) AS total_liters,
                SUM(generator_run_hours)::numeric(8,2) AS generator_run_hours
         FROM daily_diesel_summary dds
         LEFT JOIN plants p ON p.id = dds.plant_id
         WHERE EXTRACT(YEAR FROM summary_date) = $1
           AND ($2::uuid IS NULL OR dds.plant_id = $2)
           AND ($3::text IS NULL OR dds.meter_id = $3)
         GROUP BY DATE_TRUNC('month', summary_date), dds.plant_id, p.name, dds.meter_id
         ORDER BY month`,
        [parseInt(year), plant_id ?? null, meter_id ?? null]
      ),
    ]);
    res.json({ energy: energy.rows, diesel: diesel.rows });
  } catch (err) { next(err); }
}

export async function getYearlySummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id } = req.query as { plant_id?: string };
  try {
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
         WHERE ($1::uuid IS NULL OR des.plant_id = $1)
         GROUP BY EXTRACT(YEAR FROM summary_date), des.plant_id, p.name
         ORDER BY year DESC LIMIT 10`,
        [plant_id ?? null]
      ),
      pool.query(
        `SELECT EXTRACT(YEAR FROM summary_date)::int AS year,
                dds.plant_id, p.name AS plant_name,
                SUM(total_liters)::numeric(14,2) AS total_liters,
                SUM(generator_run_hours)::numeric(8,2) AS generator_run_hours
         FROM daily_diesel_summary dds
         LEFT JOIN plants p ON p.id = dds.plant_id
         WHERE ($1::uuid IS NULL OR dds.plant_id = $1)
         GROUP BY EXTRACT(YEAR FROM summary_date), dds.plant_id, p.name
         ORDER BY year DESC LIMIT 10`,
        [plant_id ?? null]
      ),
    ]);
    res.json({ energy: energy.rows, diesel: diesel.rows });
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
  const { plant_id } = req.query as { plant_id?: string };
  const today = new Date().toISOString().split('T')[0];
  const plantFilter = plant_id ? 'AND plant_id = $2' : '';
  const params = (extra: string[]) => plant_id ? [today, plant_id, ...extra] : [today, ...extra];
  try {
    const [todayE, todayD, activeA, interrupts] = await Promise.all([
      pool.query(`SELECT SUM(total_kwh) AS total_kwh, MAX(max_kva) AS max_kva, AVG(avg_power_factor) AS avg_power_factor, AVG(avg_voltage) AS avg_voltage FROM daily_energy_summary WHERE summary_date = $1 ${plantFilter}`, params([])),
      pool.query(`SELECT SUM(total_liters) AS total_liters, SUM(generator_run_hours) AS run_hours FROM daily_diesel_summary WHERE summary_date = $1 ${plantFilter}`, params([])),
      pool.query(`SELECT COUNT(*) FROM alerts WHERE acknowledged = false ${plant_id ? 'AND plant_id = $1' : ''}`, plant_id ? [plant_id] : []),
      pool.query(`SELECT COUNT(*) FROM power_interruptions WHERE started_at::date = $1 ${plant_id ? 'AND plant_id = $2' : ''}`, params([])),
    ]);
    res.json({
      today: { energy: todayE.rows[0] ?? {}, diesel: todayD.rows[0] ?? {} },
      activeAlerts: parseInt(activeA.rows[0].count),
      todayInterruptions: parseInt(interrupts.rows[0].count),
    });
  } catch (err) { next(err); }
}
