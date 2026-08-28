import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

// `from`/`to` arrive as plain dates (e.g. "2026-08-12") picked against Sri
// Lanka's calendar - the server runs on UTC system time, so parsing them as
// bare UTC midnight (the old approach) shifts every report window by 5.5
// hours off the IST day the user actually selected. Anchoring explicitly to
// the +05:30 offset (Sri Lanka has no DST) gives the correct UTC instant for
// IST midnight regardless of server timezone.
const startOfDayIST = (dateStr: string): string => new Date(`${dateStr}T00:00:00+05:30`).toISOString();

// Every query here uses an exclusive upper bound (`recorded_at < to`) -
// without this, that compares against midnight at the *start* of the
// selected day and silently drops the entire "to" day from the report.
const endOfDayExclusive = (dateStr: string): string => new Date(new Date(`${dateStr}T00:00:00+05:30`).getTime() + 86400000).toISOString();

// Reading -> kWh: power_kw * (reading interval in hours). Readings land every
// 5 seconds, so the interval is 5/3600 hours - written as 5.0/3600 because
// Postgres does integer division on two integer literals (5/3600 truncates
// to 0), which would silently zero out every kWh total below.
const KWH_FACTOR_SQL = '(5.0/3600)';

// Tariff Report: Day/Peak/Off-Peak breakdown
export async function getTariffReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id, from, to } = req.query;
  if (!from || !to) { res.status(400).json({ error: 'from and to dates required' }); return; }

  try {
    const { rows: plantInfo } = await pool.query(
      'SELECT id, name FROM plants WHERE id = $1',
      [plant_id]
    );

    if (!plantInfo[0]) { res.status(404).json({ error: 'Plant not found' }); return; }

    // Get all energy readings for the period, grouped by meter and time period
    const { rows: readings } = await pool.query(
      `SELECT
         em.meter_id,
         em.name as meter_name,
         er.time_period,
         SUM(er.power_kw * ${KWH_FACTOR_SQL}) as period_kwh,
         MAX(er.power_kva) as max_kva,
         AVG(er.power_factor) as avg_pf,
         AVG((er.voltage_r + er.voltage_y + er.voltage_b) / 3) as avg_voltage,
         COUNT(*) as reading_count
       FROM energy_readings er
       LEFT JOIN energy_meters em ON em.meter_id = er.meter_id
       WHERE er.plant_id = $1
         AND er.recorded_at >= $2::timestamptz
         AND er.recorded_at < $3::timestamptz
       GROUP BY em.meter_id, em.name, er.time_period
       ORDER BY em.meter_id, er.time_period`,
      [plant_id, startOfDayIST(String(from)), endOfDayExclusive(String(to))]
    );

    // time_period in the DB is 'day'/'peak'/'off_peak' - the API/frontend
    // field naming drops the underscore ('offpeak_kwh'), so this maps
    // between the two instead of assuming they match.
    const periodField = (tp: string) => (tp === 'off_peak' ? 'offpeak' : tp);

    // Aggregate by meter
    const meterMetrics: Record<string, any> = {};
    const plantTotal = { day_kwh: 0, peak_kwh: 0, offpeak_kwh: 0, total_kwh: 0, max_kva: 0, avg_pf: 0 };
    const pfSum: Record<string, number> = {};
    const pfCount: Record<string, number> = {};
    let plantPfSum = 0, plantPfCount = 0;

    readings.forEach((row: any) => {
      if (!meterMetrics[row.meter_id]) {
        meterMetrics[row.meter_id] = {
          meter_id: row.meter_id,
          meter_name: row.meter_name,
          day_kwh: 0,
          peak_kwh: 0,
          offpeak_kwh: 0,
          total_kwh: 0,
          max_kva_day: 0,
          max_kva_peak: 0,
          max_kva_offpeak: 0,
          avg_pf: 0,
        };
        pfSum[row.meter_id] = 0;
        pfCount[row.meter_id] = 0;
      }

      const kwh = parseFloat(row.period_kwh || '0');
      const pf = parseFloat(row.avg_pf || '0');
      const field = periodField(row.time_period);

      meterMetrics[row.meter_id][`${field}_kwh`] = kwh;
      meterMetrics[row.meter_id][`max_kva_${field}`] = parseFloat(row.max_kva || '0');
      meterMetrics[row.meter_id].total_kwh += kwh;
      pfSum[row.meter_id] += pf;
      pfCount[row.meter_id] += 1;

      plantTotal[`${field}_kwh` as keyof typeof plantTotal] += kwh;
      plantTotal.total_kwh += kwh;
      plantPfSum += pf;
      plantPfCount += 1;
      if (parseFloat(row.max_kva || '0') > plantTotal.max_kva) plantTotal.max_kva = parseFloat(row.max_kva || '0');
    });

    Object.keys(meterMetrics).forEach((meterId) => {
      meterMetrics[meterId].avg_pf = pfCount[meterId] ? pfSum[meterId] / pfCount[meterId] : 0;
    });
    plantTotal.avg_pf = plantPfCount ? plantPfSum / plantPfCount : 0;

    res.json({
      period: { from, to },
      plant: plantInfo[0],
      metrics: Object.values(meterMetrics),
      plant_total: plantTotal,
    });
  } catch (err) { next(err); }
}

// Generator Analysis: CEB vs Generator breakdown
export async function getGeneratorAnalysis(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id, from, to } = req.query;
  if (!from || !to) { res.status(400).json({ error: 'from and to dates required' }); return; }

  try {
    const fromInclusive = startOfDayIST(String(from));
    const toExclusive = endOfDayExclusive(String(to));

    // Daily breakdown - bucketed by Sri Lanka calendar day, not the server's
    // UTC system day, so readings between 00:00–05:30 IST land on the
    // correct date instead of the previous one.
    const { rows: dailyData } = await pool.query(
      `SELECT
         (er.recorded_at AT TIME ZONE 'Asia/Colombo')::date as record_date,
         er.meter_id,
         er.source,
         SUM(er.power_kw * ${KWH_FACTOR_SQL}) as period_kwh
       FROM energy_readings er
       WHERE er.plant_id = $1
         AND er.recorded_at >= $2::timestamptz
         AND er.recorded_at < $3::timestamptz
       GROUP BY (er.recorded_at AT TIME ZONE 'Asia/Colombo')::date, er.meter_id, er.source
       ORDER BY record_date DESC, er.meter_id`,
      [plant_id, fromInclusive, toExclusive]
    );

    // Power interruptions (switchovers)
    const { rows: interruptions } = await pool.query(
      `SELECT
         (started_at AT TIME ZONE 'Asia/Colombo')::date as switchover_date,
         COUNT(*) as switchover_count
       FROM power_interruptions
       WHERE plant_id = $1
         AND started_at >= $2::timestamptz
         AND started_at < $3::timestamptz
       GROUP BY (started_at AT TIME ZONE 'Asia/Colombo')::date`,
      [plant_id, fromInclusive, toExclusive]
    );

    // Aggregate daily
    const dailyBreakdown: Record<string, any> = {};
    let totalCebKwh = 0, totalGenKwh = 0;

    dailyData.forEach((row: any) => {
      const dateStr = row.record_date.toISOString().split('T')[0];
      if (!dailyBreakdown[dateStr]) {
        dailyBreakdown[dateStr] = { ceb_kwh: 0, generator_kwh: 0, switchovers: 0 };
      }
      if (row.source === 'CEB') {
        dailyBreakdown[dateStr].ceb_kwh += parseFloat(row.period_kwh || '0');
        totalCebKwh += parseFloat(row.period_kwh || '0');
      } else {
        dailyBreakdown[dateStr].generator_kwh += parseFloat(row.period_kwh || '0');
        totalGenKwh += parseFloat(row.period_kwh || '0');
      }
    });

    // Add switchover counts
    interruptions.forEach((row: any) => {
      const dateStr = row.switchover_date.toISOString().split('T')[0];
      if (dailyBreakdown[dateStr]) {
        dailyBreakdown[dateStr].switchovers = row.switchover_count;
      }
    });

    const dailyList = Object.entries(dailyBreakdown).map(([date, data]) => ({
      date,
      ...data,
      total_kwh: (data as any).ceb_kwh + (data as any).generator_kwh,
      generator_percentage: ((data as any).generator_kwh / ((data as any).ceb_kwh + (data as any).generator_kwh) * 100).toFixed(2),
    }));

    const monthlyTotal = totalCebKwh + totalGenKwh;
    const generatorPercentage = monthlyTotal > 0 ? (totalGenKwh / monthlyTotal * 100).toFixed(2) : '0';

    res.json({
      period: { from, to },
      daily_breakdown: dailyList,
      monthly_summary: {
        total_ceb_kwh: totalCebKwh.toFixed(2),
        total_generator_kwh: totalGenKwh.toFixed(2),
        total_kwh: monthlyTotal.toFixed(2),
        generator_percentage: generatorPercentage,
        total_switchovers: interruptions.reduce((sum, row) => sum + (row.switchover_count || 0), 0),
      },
    });
  } catch (err) { next(err); }
}

// Device Comparison: Multiple meters side-by-side
export async function getDeviceComparison(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { meter_ids, from, to } = req.query;
  if (!meter_ids || !from || !to) {
    res.status(400).json({ error: 'meter_ids, from and to required' }); return;
  }

  const meterArray = String(meter_ids).split(',');

  try {
    const { rows } = await pool.query(
      `SELECT
         em.meter_id,
         em.name,
         (er.recorded_at AT TIME ZONE 'Asia/Colombo')::date as record_date,
         SUM(er.power_kw * ${KWH_FACTOR_SQL}) as total_kwh,
         AVG(er.power_factor) as avg_pf,
         MAX(er.power_kva) as max_kva,
         AVG((er.voltage_r + er.voltage_y + er.voltage_b) / 3) as avg_voltage
       FROM energy_readings er
       LEFT JOIN energy_meters em ON em.meter_id = er.meter_id
       WHERE er.meter_id = ANY($1::text[])
         AND er.recorded_at >= $2::timestamptz
         AND er.recorded_at < $3::timestamptz
       GROUP BY em.meter_id, em.name, (er.recorded_at AT TIME ZONE 'Asia/Colombo')::date
       ORDER BY em.meter_id, record_date DESC`,
      [meterArray, startOfDayIST(String(from)), endOfDayExclusive(String(to))]
    );

    res.json({
      period: { from, to },
      comparison: rows,
    });
  } catch (err) { next(err); }
}

// Consumption Trend: Historical trend over time
export async function getConsumptionTrend(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { plant_id, days = '30', meter_id } = req.query;
  const daysNum = Math.min(parseInt(String(days)), 365);

  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysNum);

    let query = `
      SELECT
        (er.recorded_at AT TIME ZONE 'Asia/Colombo')::date as record_date,
        em.meter_id,
        em.name,
        SUM(er.power_kw * ${KWH_FACTOR_SQL}) as daily_kwh,
        AVG(er.power_factor) as avg_pf,
        MAX(er.power_kva) as max_kva
      FROM energy_readings er
      LEFT JOIN energy_meters em ON em.meter_id = er.meter_id
      WHERE er.recorded_at >= $1::timestamptz
    `;
    const params: any[] = [fromDate.toISOString()];

    if (plant_id) {
      query += ` AND er.plant_id = $${params.length + 1}`;
      params.push(plant_id);
    }

    if (meter_id) {
      query += ` AND er.meter_id = $${params.length + 1}`;
      params.push(meter_id);
    }

    query += ` GROUP BY (er.recorded_at AT TIME ZONE 'Asia/Colombo')::date, em.meter_id, em.name
      ORDER BY record_date DESC, em.meter_id`;

    const { rows } = await pool.query(query, params);

    res.json({
      period: { days: daysNum, from: fromDate.toISOString().split('T')[0] },
      trend: rows,
    });
  } catch (err) { next(err); }
}
