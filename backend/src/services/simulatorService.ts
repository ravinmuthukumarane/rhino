import { Server } from 'socket.io';
import pool from '../config/database';
import { checkAndAlert, checkPowerSwitch } from './alertService';
import { getTimePeriod, getISTDateString } from '../utils/timeUtils';
import { PowerSource, TimePeriod } from '../types';

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

interface SimState {
  meterId: string;
  flowMeterId: string;
  generatorId: string;
  plantId: string;
  baseKwh: number;
  baseDiesel: number;
  genOn: boolean;
  prevSource: PowerSource | null;
}

let states: SimState[] = [];
let timer: NodeJS.Timeout | null = null;

export async function startSimulator(io: Server): Promise<void> {
  if (timer) return;

  // Load active devices from DB
  const { rows: emeters } = await pool.query(
    "SELECT em.meter_id, em.plant_id::text FROM energy_meters em WHERE em.is_active = true LIMIT 5"
  );
  const { rows: fmeters } = await pool.query(
    "SELECT fm.meter_id, fm.plant_id::text FROM flow_meters fm WHERE fm.is_active = true LIMIT 5"
  );
  const { rows: gens } = await pool.query(
    "SELECT g.generator_id, g.plant_id::text FROM generators g WHERE g.is_active = true LIMIT 5"
  );

  states = emeters.map((em, i) => ({
    meterId: em.meter_id,
    flowMeterId: fmeters[i]?.meter_id ?? `FM-SIM-${i + 1}`,
    generatorId: gens[i]?.generator_id ?? `GEN-SIM-${i + 1}`,
    plantId: em.plant_id,
    baseKwh: 10000 + i * 500,
    baseDiesel: 5000 + i * 100,
    genOn: false,
    prevSource: null,
  }));

  if (!states.length) {
    states = [{
      meterId: 'EM-01', flowMeterId: 'FM-01', generatorId: 'GEN-01',
      plantId: '00000000-0000-0000-0000-000000000001',
      baseKwh: 10000, baseDiesel: 5000, genOn: false, prevSource: null,
    }];
  }

  const interval = parseInt(process.env.SIMULATOR_INTERVAL_MS ?? '5000');
  console.log(`[Simulator] Started with ${states.length} device(s), interval: ${interval}ms`);

  timer = setInterval(async () => {
    for (const state of states) {
      try {
        await tick(state, io);
      } catch (err) {
        console.error(`[Simulator] tick error (${state.meterId}):`, (err as Error).message);
      }
    }
  }, interval);
}

async function tick(state: SimState, io: Server): Promise<void> {
  // Occasionally toggle generator (0.5% chance per tick)
  if (!state.genOn && Math.random() < 0.005) state.genOn = true;
  else if (state.genOn && Math.random() < 0.02) state.genOn = false;

  const source: PowerSource = state.genOn ? 'GENERATOR' : 'CEB';
  const baseV = source === 'CEB' ? 230 : 220;
  const timePeriod: TimePeriod = getTimePeriod();
  const interval = 5 / 3600;

  const vR = parseFloat((baseV + rand(-5, 5)).toFixed(1));
  const vY = parseFloat((baseV + rand(-5, 5)).toFixed(1));
  const vB = parseFloat((baseV + rand(-5, 5)).toFixed(1));
  const iR = parseFloat(rand(80, 150).toFixed(1));
  const iY = parseFloat(rand(80, 150).toFixed(1));
  const iB = parseFloat(rand(80, 150).toFixed(1));
  const pf = parseFloat(rand(0.82, 0.98).toFixed(3));
  const kva = parseFloat(((vR * iR + vY * iY + vB * iB) / 1000).toFixed(2));
  const kw = parseFloat((kva * pf).toFixed(2));

  state.baseKwh += kw * interval;
  const kwh = parseFloat(state.baseKwh.toFixed(3));

  const { rows: [energyRow] } = await pool.query(
    `INSERT INTO energy_readings
       (meter_id, plant_id, voltage_r, voltage_y, voltage_b,
        current_r, current_y, current_b,
        power_kw, power_kva, power_factor, energy_kwh, frequency,
        source, time_period)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [state.meterId, state.plantId, vR, vY, vB, iR, iY, iB,
     kw, kva, pf, kwh, parseFloat((50 + rand(-0.2, 0.2)).toFixed(2)),
     source, timePeriod]
  );

  // Diesel
  const flowRate = state.genOn ? parseFloat(rand(12, 18).toFixed(2)) : 0;
  if (state.genOn) state.baseDiesel += flowRate * interval;
  const { rows: [dieselRow] } = await pool.query(
    'INSERT INTO diesel_readings (meter_id, plant_id, flow_rate, total_volume) VALUES ($1,$2,$3,$4) RETURNING *',
    [state.flowMeterId, state.plantId, flowRate, parseFloat(state.baseDiesel.toFixed(3))]
  );

  // Generator event
  const genStatus = state.genOn ? 'ON' : 'OFF';
  const { rows: [lastGe] } = await pool.query(
    'SELECT status FROM generator_events WHERE generator_id=$1 ORDER BY recorded_at DESC LIMIT 1',
    [state.generatorId]
  );
  if (lastGe?.status !== genStatus) {
    await pool.query('INSERT INTO generator_events (generator_id, plant_id, status, reason) VALUES ($1,$2,$3,$4)',
      [state.generatorId, state.plantId, genStatus, genStatus === 'ON' ? 'power_cut' : 'power_restored']);
  }

  // Alerts & power switch
  await checkAndAlert(energyRow, io);
  await checkPowerSwitch(source, state.prevSource, state.plantId, state.meterId, io);
  state.prevSource = source;

  // Daily summaries (incremental)
  const today = getISTDateString();
  const dKwh = kw * interval;
  const cebKwh = source === 'CEB' ? dKwh : 0;
  const genKwh = source === 'GENERATOR' ? dKwh : 0;

  await pool.query(
    `INSERT INTO daily_energy_summary (summary_date, plant_id, meter_id, total_kwh, max_kva, avg_power_factor, avg_voltage, ceb_kwh, generator_kwh, day_kwh, peak_kwh, off_peak_kwh)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (summary_date, meter_id) DO UPDATE SET
       total_kwh = daily_energy_summary.total_kwh + EXCLUDED.total_kwh,
       max_kva = GREATEST(daily_energy_summary.max_kva, EXCLUDED.max_kva),
       avg_power_factor = (daily_energy_summary.avg_power_factor + EXCLUDED.avg_power_factor)/2,
       avg_voltage = (daily_energy_summary.avg_voltage + EXCLUDED.avg_voltage)/2,
       ceb_kwh = daily_energy_summary.ceb_kwh + EXCLUDED.ceb_kwh,
       generator_kwh = daily_energy_summary.generator_kwh + EXCLUDED.generator_kwh,
       day_kwh = daily_energy_summary.day_kwh + EXCLUDED.day_kwh,
       peak_kwh = daily_energy_summary.peak_kwh + EXCLUDED.peak_kwh,
       off_peak_kwh = daily_energy_summary.off_peak_kwh + EXCLUDED.off_peak_kwh,
       updated_at = NOW()`,
    [today, state.plantId, state.meterId, dKwh, kva, pf, (vR + vY + vB) / 3,
     cebKwh, genKwh,
     timePeriod === 'day' ? dKwh : 0,
     timePeriod === 'peak' ? dKwh : 0,
     timePeriod === 'off_peak' ? dKwh : 0]
  );

  if (state.genOn && flowRate > 0) {
    const dL = flowRate * interval;
    await pool.query(
      `INSERT INTO daily_diesel_summary (summary_date, plant_id, meter_id, total_liters, generator_run_hours)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (summary_date, meter_id) DO UPDATE SET
         total_liters = daily_diesel_summary.total_liters + EXCLUDED.total_liters,
         generator_run_hours = daily_diesel_summary.generator_run_hours + EXCLUDED.generator_run_hours,
         updated_at = NOW()`,
      [today, state.plantId, state.flowMeterId, dL, interval]
    );
  }

  io.emit('live_reading', {
    energy: energyRow,
    diesel: dieselRow,
    generator: { status: genStatus, generator_id: state.generatorId },
    timePeriod,
    plant_id: state.plantId,
  });
}

export function stopSimulator(): void {
  if (timer) { clearInterval(timer); timer = null; console.log('[Simulator] Stopped'); }
}
