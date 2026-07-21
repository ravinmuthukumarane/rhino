import mqtt, { MqttClient } from 'mqtt';
import pool from '../config/database';
import { checkAndAlert, checkPowerSwitch } from './alertService';
import { getTimePeriod } from '../utils/timeUtils';
import { EnergyReading, PowerSource } from '../types';
import { Server } from 'socket.io';

interface MeterData {
  meter_id: string;
  plant_id: string;
  [key: string]: any;
}

let client: MqttClient | null = null;
let lastPowerSource: Record<string, PowerSource> = {};

export async function startMQTT(io: Server): Promise<void> {
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

  const mqttClient = mqtt.connect(brokerUrl, {
    clientId: `rhino-backend-${Date.now()}`,
    clean: true,
    reconnectPeriod: 1000,
  });
  client = mqttClient;

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected to broker:', brokerUrl);
    // Subscribe to energy and flow meter topics
    mqttClient.subscribe('energy/+/data', (err) => {
      if (!err) console.log('[MQTT] Subscribed to energy/+/data');
    });
    mqttClient.subscribe('diesel/+/data', (err) => {
      if (!err) console.log('[MQTT] Subscribed to diesel/+/data');
    });
  });

  mqttClient.on('message', async (topic: string, message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());

      if (topic.startsWith('energy/')) {
        await handleEnergyReading(data, io);
      } else if (topic.startsWith('diesel/')) {
        await handleDieselReading(data, io);
      }
    } catch (err) {
      console.error('[MQTT] Parse error:', (err as Error).message);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
  });

  mqttClient.on('disconnect', () => {
    console.log('[MQTT] Disconnected from broker');
  });
}

async function handleEnergyReading(data: MeterData, io: Server): Promise<void> {
  try {
    // Validate required fields
    if (!data.meter_id || typeof data.voltage_r !== 'number') {
      console.error('[MQTT] Invalid energy data:', data);
      return;
    }

    // Get plant_id from database if not in payload
    let plantId = data.plant_id;
    if (!plantId) {
      const { rows } = await pool.query(
        'SELECT plant_id FROM energy_meters WHERE meter_id = $1',
        [data.meter_id]
      );
      if (!rows[0]) {
        console.error('[MQTT] Meter not found:', data.meter_id);
        return;
      }
      plantId = rows[0].plant_id;
    }

    const timePeriod = getTimePeriod();
    const source: PowerSource = data.source || 'CEB';

    // Insert energy reading
    const { rows: [reading] } = await pool.query(
      `INSERT INTO energy_readings
         (meter_id, plant_id, voltage_r, voltage_y, voltage_b,
          current_r, current_y, current_b,
          power_kw, power_kva, power_factor, energy_kwh, frequency,
          third_harmonic_r, third_harmonic_y, third_harmonic_b,
          source, time_period, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        data.meter_id,
        plantId,
        data.voltage_r,
        data.voltage_y ?? data.voltage_r,
        data.voltage_b ?? data.voltage_r,
        data.current_r,
        data.current_y ?? data.current_r,
        data.current_b ?? data.current_r,
        data.power_kw,
        data.power_kva,
        data.power_factor,
        data.energy_kwh,
        data.frequency ?? 50,
        data.third_harmonic_r ?? 0,
        data.third_harmonic_y ?? 0,
        data.third_harmonic_b ?? 0,
        source,
        timePeriod,
        new Date(data.timestamp || Date.now()),
      ]
    );

    // Update daily summary
    const today = new Date(data.timestamp || Date.now()).toISOString().split('T')[0];
    const dKwh = (data.power_kw || 0) * (5 / 3600); // Assuming 5-second intervals
    const cebKwh = source === 'CEB' ? dKwh : 0;
    const genKwh = source === 'GENERATOR' ? dKwh : 0;

    await pool.query(
      `INSERT INTO daily_energy_summary
         (summary_date, plant_id, meter_id, total_kwh, max_kva, avg_power_factor, avg_voltage, ceb_kwh, generator_kwh, day_kwh, peak_kwh, off_peak_kwh)
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
      [
        today,
        plantId,
        data.meter_id,
        dKwh,
        data.power_kva || 0,
        data.power_factor || 0.9,
        (data.voltage_r + (data.voltage_y ?? data.voltage_r) + (data.voltage_b ?? data.voltage_r)) / 3,
        cebKwh,
        genKwh,
        timePeriod === 'day' ? dKwh : 0,
        timePeriod === 'peak' ? dKwh : 0,
        timePeriod === 'off_peak' ? dKwh : 0,
      ]
    );

    // Check for alerts
    await checkAndAlert(reading as EnergyReading, io);

    // Check power switch
    const prevSource = lastPowerSource[data.meter_id];
    if (prevSource && prevSource !== source) {
      await checkPowerSwitch(source, prevSource, plantId, data.meter_id, io);
    }
    lastPowerSource[data.meter_id] = source;

    // Emit to frontend
    io.emit('live_reading', {
      energy: reading,
      plant_id: plantId,
      meter_id: data.meter_id,
      timePeriod,
    });

    console.log(`[MQTT] Energy reading stored: ${data.meter_id}`);
  } catch (err) {
    console.error('[MQTT] Error storing energy reading:', (err as Error).message);
  }
}

async function handleDieselReading(data: MeterData, io: Server): Promise<void> {
  try {
    if (!data.meter_id || typeof data.flow_rate !== 'number') {
      console.error('[MQTT] Invalid diesel data:', data);
      return;
    }

    let plantId = data.plant_id;
    if (!plantId) {
      const { rows } = await pool.query(
        'SELECT plant_id FROM flow_meters WHERE meter_id = $1',
        [data.meter_id]
      );
      if (!rows[0]) {
        console.error('[MQTT] Flow meter not found:', data.meter_id);
        return;
      }
      plantId = rows[0].plant_id;
    }

    // Insert diesel reading
    const { rows: [reading] } = await pool.query(
      `INSERT INTO diesel_readings (meter_id, plant_id, flow_rate, total_volume, recorded_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        data.meter_id,
        plantId,
        data.flow_rate,
        data.total_volume,
        new Date(data.timestamp || Date.now()),
      ]
    );

    // Update daily summary
    const today = new Date(data.timestamp || Date.now()).toISOString().split('T')[0];
    const dL = (data.flow_rate || 0) * (5 / 3600);

    await pool.query(
      `INSERT INTO daily_diesel_summary (summary_date, plant_id, meter_id, total_liters, generator_run_hours)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (summary_date, meter_id) DO UPDATE SET
         total_liters = daily_diesel_summary.total_liters + EXCLUDED.total_liters,
         generator_run_hours = daily_diesel_summary.generator_run_hours + EXCLUDED.generator_run_hours,
         updated_at = NOW()`,
      [today, plantId, data.meter_id, dL, 5 / 3600]
    );

    io.emit('live_reading', {
      diesel: reading,
      plant_id: plantId,
      meter_id: data.meter_id,
    });

    console.log(`[MQTT] Diesel reading stored: ${data.meter_id}`);
  } catch (err) {
    console.error('[MQTT] Error storing diesel reading:', (err as Error).message);
  }
}

export function stopMQTT(): void {
  if (client) {
    client.end();
    client = null;
    console.log('[MQTT] Stopped');
  }
}
