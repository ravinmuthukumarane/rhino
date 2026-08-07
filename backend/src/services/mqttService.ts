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

  const TELEMETRY_TOPIC = process.env.MQTT_TELEMETRY_TOPIC || 'rhino/rrpl/telemetry';

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected to broker:', brokerUrl);
    mqttClient.subscribe(TELEMETRY_TOPIC, (err) => {
      if (!err) console.log(`[MQTT] Subscribed to ${TELEMETRY_TOPIC}`);
    });
  });

  mqttClient.on('message', async (_topic: string, message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());

      // A single shared topic carries energy, diesel, and flow-meter
      // readings. Diesel payloads use an explicit 'type' field; the flow
      // meter gateway instead reuses the device_id/tags envelope shared with
      // energy meters, distinguishable by tags.flow_l1 being present (no
      // voltage tag). Route on shape, not just the 'type' field.
      if (data.type === 'diesel') {
        await handleDieselReading(data, io);
      } else if (data.tags && typeof data.tags.flow_l1 === 'number') {
        await handleFlowTelemetry(data, io);
      } else {
        await handleEnergyReading(data, io);
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

interface DeviceTelemetry {
  device_id?: string;
  plant_id?: string;
  timestamp?: string | number;
  tags?: {
    // Wattz SDM630 naming
    volt_l1?: number; volt_l2?: number; volt_l3?: number;
    curr_l1?: number; curr_l2?: number; curr_l3?: number;
    // Schneider PM2120 naming - no current tags observed in real traffic
    volt_an?: number; volt_bn?: number; volt_cn?: number;
    volt_ab?: number; volt_bc?: number; volt_ca?: number;
    curr_a?: number; curr_b?: number; curr_c?: number;
    power_a?: number; power_b?: number; power_c?: number;
    power_l1?: number; power_l2?: number; power_l3?: number;
    total_power?: number; total_app?: number; total_pf?: number;
    freq?: number; import_kwh?: number;
    // Flow meter gateway (shares this envelope instead of a distinct shape)
    flow_l1?: number; flow_l2?: number; flow_status?: number;
    flow_calib?: number; flow_scale?: number;
  };
}

// mqtt.md documents the Wattz SDM630's Total active/apparent power registers
// in Watts/VA (not kW/kVA). Set MQTT_POWER_UNIT=kw once real values confirm
// the gateway already reports kW/kVA directly, to skip the /1000 conversion.
const POWER_SCALE = process.env.MQTT_POWER_UNIT === 'kw' ? 1 : 0.001;

async function handleEnergyReading(data: DeviceTelemetry, io: Server): Promise<void> {
  try {
    const deviceId = data.device_id;
    const tags = data.tags;
    // Different meter models use different tag names for voltage (Wattz:
    // volt_l1, Schneider: volt_an or volt_ab) - accept whichever is present
    // rather than assuming one schema. Values are passed through as-is; a
    // meter reporting an implausible voltage is a calibration issue on that
    // device, not something to silently "correct" here.
    const voltR = tags?.volt_l1 ?? tags?.volt_an ?? tags?.volt_ab;
    if (!deviceId || !tags || typeof voltR !== 'number') {
      console.error('[MQTT] Invalid energy data:', data);
      return;
    }
    const voltY = tags.volt_l2 ?? tags.volt_bn ?? tags.volt_bc ?? voltR;
    const voltB = tags.volt_l3 ?? tags.volt_cn ?? tags.volt_ca ?? voltR;

    const { rows } = await pool.query(
      'SELECT meter_id, plant_id, default_source FROM energy_meters WHERE device_id = $1',
      [deviceId]
    );
    if (!rows[0]) {
      console.error('[MQTT] Unknown device_id:', deviceId);
      return;
    }
    const meterId: string = rows[0].meter_id;
    const plantId: string = rows[0].plant_id;
    const source: PowerSource = (rows[0].default_source as PowerSource) ?? 'CEB';

    const timePeriod = getTimePeriod();
    const powerKw = (tags.total_power ?? 0) * POWER_SCALE;
    const powerKva = (tags.total_app ?? 0) * POWER_SCALE;
    const currR = tags.curr_l1 ?? tags.curr_a ?? 0;
    const currY = tags.curr_l2 ?? tags.curr_b ?? currR;
    const currB = tags.curr_l3 ?? tags.curr_c ?? currR;

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
        meterId,
        plantId,
        voltR,
        voltY,
        voltB,
        currR,
        currY,
        currB,
        powerKw,
        powerKva,
        tags.total_pf ?? 0,
        tags.import_kwh ?? 0,
        tags.freq ?? 50,
        0, 0, 0,
        source,
        timePeriod,
        new Date(data.timestamp || Date.now()),
      ]
    );

    // Update daily summary
    const today = new Date(data.timestamp || Date.now()).toISOString().split('T')[0];
    const dKwh = powerKw * (5 / 3600); // Assuming 5-second intervals
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
        meterId,
        dKwh,
        powerKva,
        tags.total_pf ?? 0.9,
        (voltR + voltY + voltB) / 3,
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
    const prevSource = lastPowerSource[meterId];
    if (prevSource && prevSource !== source) {
      await checkPowerSwitch(source, prevSource, plantId, meterId, io);
    }
    lastPowerSource[meterId] = source;

    // Emit to frontend
    io.emit('live_reading', {
      energy: reading,
      plant_id: plantId,
      meter_id: meterId,
      timePeriod,
    });

    console.log(`[MQTT] Energy reading stored: ${meterId} (device ${deviceId})`);
  } catch (err) {
    console.error('[MQTT] Error storing energy reading:', (err as Error).message);
  }
}

async function storeDieselReading(
  meterId: string,
  plantId: string | null,
  flowRate: number,
  totalVolume: number | null,
  timestamp: string | number | undefined,
  io: Server
): Promise<void> {
  // Insert diesel/flow reading
  const { rows: [reading] } = await pool.query(
    `INSERT INTO diesel_readings (meter_id, plant_id, flow_rate, total_volume, recorded_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [meterId, plantId, flowRate, totalVolume, new Date(timestamp || Date.now())]
  );

  // Update daily summary
  const today = new Date(timestamp || Date.now()).toISOString().split('T')[0];
  const dL = (flowRate || 0) * (5 / 3600);

  await pool.query(
    `INSERT INTO daily_diesel_summary (summary_date, plant_id, meter_id, total_liters, generator_run_hours)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (summary_date, meter_id) DO UPDATE SET
       total_liters = daily_diesel_summary.total_liters + EXCLUDED.total_liters,
       generator_run_hours = daily_diesel_summary.generator_run_hours + EXCLUDED.generator_run_hours,
       updated_at = NOW()`,
    [today, plantId, meterId, dL, 5 / 3600]
  );

  io.emit('live_reading', {
    diesel: reading,
    plant_id: plantId,
    meter_id: meterId,
  });
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

    await storeDieselReading(data.meter_id, plantId, data.flow_rate, data.total_volume ?? null, data.timestamp, io);
    console.log(`[MQTT] Diesel reading stored: ${data.meter_id}`);
  } catch (err) {
    console.error('[MQTT] Error storing diesel reading:', (err as Error).message);
  }
}

// The flow meter gateway shares the same device_id/tags envelope as energy
// meters instead of the explicit { type: 'diesel', meter_id, flow_rate }
// shape - it has no cumulative total, only an instantaneous flow_l1 (L1
// register) reading, so total_volume is left null here rather than guessed.
async function handleFlowTelemetry(data: DeviceTelemetry, io: Server): Promise<void> {
  try {
    const deviceId = data.device_id;
    const flowRate = data.tags?.flow_l1;
    if (!deviceId || typeof flowRate !== 'number') {
      console.error('[MQTT] Invalid flow telemetry:', data);
      return;
    }

    const { rows } = await pool.query(
      'SELECT meter_id, plant_id FROM flow_meters WHERE device_id = $1',
      [deviceId]
    );
    if (!rows[0]) {
      console.error('[MQTT] Unknown flow device_id:', deviceId);
      return;
    }
    const meterId: string = rows[0].meter_id;
    const plantId: string | null = rows[0].plant_id;

    await storeDieselReading(meterId, plantId, flowRate, null, data.timestamp, io);
    console.log(`[MQTT] Flow reading stored: ${meterId} (device ${deviceId})`);
  } catch (err) {
    console.error('[MQTT] Error storing flow reading:', (err as Error).message);
  }
}

export function stopMQTT(): void {
  if (client) {
    client.end();
    client = null;
    console.log('[MQTT] Stopped');
  }
}
