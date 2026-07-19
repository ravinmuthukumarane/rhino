import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

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
         SUM(er.power_kw * (5/3600)) as period_kwh,
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
      [plant_id, from, to]
    );

    // Aggregate by meter
    const meterMetrics: Record<string, any> = {};
    let plantTotal = { day_kwh: 0, peak_kwh: 0, offpeak_kwh: 0, total_kwh: 0, max_kva: 0, avg_pf: 0 };

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
      }

      const kwh = parseFloat(row.period_kwh || '0');
      const key = `${row.time_period}_kwh`;
      const kvaKey = `max_kva_${row.time_period}`;

      meterMetrics[row.meter_id][key] = kwh;
      meterMetrics[row.meter_id][kvaKey] = parseFloat(row.max_kva || '0');
      meterMetrics[row.meter_id].total_kwh += kwh;
      meterMetrics[row.meter_id].avg_pf = parseFloat(row.avg_pf || '0.9');

      plantTotal[`${row.time_period}_kwh` as keyof typeof plantTotal] += kwh;
      plantTotal.total_kwh += kwh;
      if (row.max_kva > plantTotal.max_kva) plantTotal.max_kva = parseFloat(row.max_kva || '0');
    });

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
    // Daily breakdown
    const { rows: dailyData } = await pool.query(
      `SELECT
         DATE(er.recorded_at) as record_date,
         er.meter_id,
         er.source,
         SUM(er.power_kw * (5/3600)) as period_kwh
       FROM energy_readings er
       WHERE er.plant_id = $1
         AND er.recorded_at >= $2::timestamptz
         AND er.recorded_at < $3::timestamptz
       GROUP BY DATE(er.recorded_at), er.meter_id, er.source
       ORDER BY record_date DESC, er.meter_id`,
      [plant_id, from, to]
    );

    // Power interruptions (switchovers)
    const { rows: interruptions } = await pool.query(
      `SELECT
         DATE(started_at) as switchover_date,
         COUNT(*) as switchover_count
       FROM power_interruptions
       WHERE plant_id = $1
         AND started_at >= $2::timestamptz
         AND started_at < $3::timestamptz
       GROUP BY DATE(started_at)`,
      [plant_id, from, to]
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
         DATE(er.recorded_at) as record_date,
         SUM(er.power_kw * (5/3600)) as total_kwh,
         AVG(er.power_factor) as avg_pf,
         MAX(er.power_kva) as max_kva,
         AVG((er.voltage_r + er.voltage_y + er.voltage_b) / 3) as avg_voltage
       FROM energy_readings er
       LEFT JOIN energy_meters em ON em.meter_id = er.meter_id
       WHERE er.meter_id = ANY($1::text[])
         AND er.recorded_at >= $2::timestamptz
         AND er.recorded_at < $3::timestamptz
       GROUP BY em.meter_id, em.name, DATE(er.recorded_at)
       ORDER BY em.meter_id, record_date DESC`,
      [meterArray, from, to]
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
        DATE(er.recorded_at) as record_date,
        em.meter_id,
        em.name,
        SUM(er.power_kw * (5/3600)) as daily_kwh,
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

    query += ` GROUP BY DATE(er.recorded_at), em.meter_id, em.name
      ORDER BY record_date DESC, em.meter_id`;

    const { rows } = await pool.query(query, params);

    res.json({
      period: { days: daysNum, from: fromDate.toISOString().split('T')[0] },
      trend: rows,
    });
  } catch (err) { next(err); }
}
