import mqtt, { MqttClient } from 'mqtt';
import pool from '../config/database';
import { checkAndAlert, checkPowerSwitch } from './alertService';
import { getTimePeriod, getISTDateString } from '../utils/timeUtils';
import { EnergyReading, PowerSource, GeneratorStatus } from '../types';
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

      // A single shared topic carries energy, diesel, flow-meter, and power-
      // status readings. Diesel payloads use an explicit 'type' field; the
      // flow meter gateway and the power-status (ATS) sensor instead reuse
      // the device_id/tags envelope shared with energy meters, distinguished
      // by tags.flow_l1 / tags.pa0_status being present (no voltage tag
      // either way). Route on shape, not just the 'type' field.
      if (data.type === 'diesel') {
        await handleDieselReading(data, io);
      } else if (data.tags && typeof data.tags.flow_l1 === 'number') {
        await handleFlowTelemetry(data, io);
      } else if (data.tags && typeof data.tags.pa0_status === 'number' && typeof data.tags.pa1_status === 'number') {
        await handlePowerStatus(data, io);
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
    // Power status (ATS) sensor - digital status inputs, no voltage/current.
    // pa0 = generator contact energized, pa1 = CEB/mains contact energized.
    pa0_status?: number; pa1_status?: number;
  };
}

// mqtt.md documents the Wattz SDM630's Total active/apparent power registers
// in Watts/VA (not kW/kVA). Set MQTT_POWER_UNIT=kw once real values confirm
// the gateway already reports kW/kVA directly, to skip the /1000 conversion.
const POWER_SCALE = process.env.MQTT_POWER_UNIT === 'kw' ? 1 : 0.001;

// Generous headroom over any realistic generator's diesel burn rate at this
// plant, used to reject implausible flow-rate glitches (see handleFlowTelemetry).
const MAX_PLAUSIBLE_FLOW_RATE = 1000;

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
      'SELECT meter_id, plant_id, default_source, model FROM energy_meters WHERE device_id = $1',
      [deviceId]
    );
    if (!rows[0]) {
      console.error('[MQTT] Unknown device_id:', deviceId);
      return;
    }
    const meterId: string = rows[0].meter_id;
    const plantId: string = rows[0].plant_id;
    const source: PowerSource = (rows[0].default_source as PowerSource) ?? 'CEB';
    // Unlike the Wattz/Circutor gateways (Watts/VA, needs /1000), the
    // Schneider PM2120 gateway already publishes total_power/total_app in
    // kW/kVA - applying POWER_SCALE to it too under-scales by another 1000x.
    const powerScale = rows[0].model === 'Schneider PM2120' ? 1 : POWER_SCALE;

    const timePeriod = getTimePeriod();
    const powerKw = (tags.total_power ?? 0) * powerScale;
    const powerKva = (tags.total_app ?? 0) * powerScale;
    const currR = tags.curr_l1 ?? tags.curr_a ?? 0;
    const currY = tags.curr_l2 ?? tags.curr_b ?? currR;
    const currB = tags.curr_l3 ?? tags.curr_c ?? currR;

    // Insert energy reading
    const { rows: [reading] } = await pool.query(
      `INSERT INTO energy_readings
         (meter_id, plant_id, voltage_r, voltage_y, voltage_b,
          current_r, current_y, current_b,
          power_kw, power_kva, power_factor, energy_kwh, frequency,
          source, time_period, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
        source,
        timePeriod,
        new Date(data.timestamp || Date.now()),
      ]
    );

    // Update daily summary
    const today = getISTDateString(new Date(data.timestamp || Date.now()));
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
  deltaLiters: number,
  runHours: number,
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
  const today = getISTDateString(new Date(timestamp || Date.now()));

  await pool.query(
    `INSERT INTO daily_diesel_summary (summary_date, plant_id, meter_id, total_liters, generator_run_hours)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (summary_date, meter_id) DO UPDATE SET
       total_liters = daily_diesel_summary.total_liters + EXCLUDED.total_liters,
       generator_run_hours = daily_diesel_summary.generator_run_hours + EXCLUDED.generator_run_hours,
       updated_at = NOW()`,
    [today, plantId, meterId, deltaLiters, runHours]
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

    const dL = data.flow_rate * (5 / 3600); // Assuming 5-second intervals
    await storeDieselReading(data.meter_id, plantId, data.flow_rate, data.total_volume ?? null, dL, 5 / 3600, data.timestamp, io);
    console.log(`[MQTT] Diesel reading stored: ${data.meter_id}`);
  } catch (err) {
    console.error('[MQTT] Error storing diesel reading:', (err as Error).message);
  }
}

// The flow meter gateway shares the same device_id/tags envelope as energy
// meters instead of the explicit { type: 'diesel', meter_id, flow_rate }
// shape. flow_l1 is not an instantaneous rate - it's a cumulative totalizer
// in cubic meters (confirmed against real traffic: it creeps up by
// thousandths between consecutive messages, never fluctuates like a rate
// would) - so the actual flow rate has to be derived from the delta against
// the previous reading over the elapsed time, not read off directly.
async function handleFlowTelemetry(data: DeviceTelemetry, io: Server): Promise<void> {
  try {
    const deviceId = data.device_id;
    const volumeM3 = data.tags?.flow_l1;
    if (!deviceId || typeof volumeM3 !== 'number') {
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
    const volumeLiters = volumeM3 * 1000;
    const now = new Date(data.timestamp || Date.now());

    const { rows: [prev] } = await pool.query(
      'SELECT total_volume, recorded_at FROM diesel_readings WHERE meter_id=$1 ORDER BY recorded_at DESC LIMIT 1',
      [meterId]
    );

    let deltaLiters = 0;
    let flowRate = 0;
    let runHours = 0;
    if (prev?.total_volume != null) {
      const elapsedHours = Math.max((now.getTime() - new Date(prev.recorded_at).getTime()) / 3600000, 1 / 3600);
      // A negative delta means the totalizer reset/rolled over on-device -
      // treat that interval as zero consumption rather than a bogus refund,
      // and let the next message re-establish the baseline.
      deltaLiters = Math.max(0, volumeLiters - parseFloat(prev.total_volume));
      flowRate = deltaLiters / elapsedHours;
      // A comms/decode glitch on the raw totalizer (seen in real traffic:
      // isolated readings of 0 or wildly larger than neighbors) produces an
      // implausible rate - no generator this size burns anywhere near
      // MAX_PLAUSIBLE_FLOW_RATE L/hr. Don't let one bad tick inflate the
      // daily total or Diesel Consumption chart; still record the raw
      // counter value as this reading's total_volume so it becomes the
      // baseline the next (hopefully sane) delta is measured against.
      if (flowRate > MAX_PLAUSIBLE_FLOW_RATE) {
        console.error(`[MQTT] Implausible flow rate ignored: ${meterId} ${flowRate.toFixed(1)} L/hr (device ${deviceId})`);
        deltaLiters = 0;
        flowRate = 0;
      } else {
        // Run hours only count while fuel was actually being consumed -
        // unlike the explicit diesel-type path's fixed per-message
        // assumption, this path has a real consumption delta to gate on.
        runHours = deltaLiters > 0 ? elapsedHours : 0;
      }
    }

    await storeDieselReading(meterId, plantId, flowRate, volumeLiters, deltaLiters, runHours, data.timestamp, io);
    console.log(`[MQTT] Flow reading stored: ${meterId} (device ${deviceId})`);
  } catch (err) {
    console.error('[MQTT] Error storing flow reading:', (err as Error).message);
  }
}

// The ATS/power-status sensor also shares the device_id/tags envelope,
// carrying only two digital contacts (pa0 = generator energized, pa1 = CEB
// energized) instead of voltage/current. It's the authoritative live signal
// for which source is feeding a plant section - individual meters' 'source'
// column is a static per-meter label, not a live switch detector. A status
// change is written to generator_events (same table/shape the simulator
// writes to) and routed through the existing checkPowerSwitch alerting used
// for the simulated CEB<->GENERATOR transition, then merged onto the
// section's Main Incoming Energy meter's live_reading (via main_meter_id)
// so the dashboard's existing per-meter live-reading map picks it up without
// needing its own device-type-aware section grouping.
async function handlePowerStatus(data: DeviceTelemetry, io: Server): Promise<void> {
  try {
    const deviceId = data.device_id;
    const tags = data.tags;
    if (!deviceId || typeof tags?.pa0_status !== 'number' || typeof tags?.pa1_status !== 'number') {
      console.error('[MQTT] Invalid power status data:', data);
      return;
    }

    const { rows } = await pool.query(
      'SELECT plant_id, generator_id, main_meter_id FROM power_status_sensors WHERE device_id = $1',
      [deviceId]
    );
    if (!rows[0]) {
      console.error('[MQTT] Unknown power status device_id:', deviceId);
      return;
    }
    const plantId: string | null = rows[0].plant_id;
    const generatorId: string = rows[0].generator_id;
    const mainMeterId: string | null = rows[0].main_meter_id;

    const genOn = tags.pa0_status >= 0.5;
    const status: GeneratorStatus = genOn ? 'ON' : 'OFF';

    const { rows: [lastGe] } = await pool.query(
      'SELECT status FROM generator_events WHERE generator_id=$1 ORDER BY recorded_at DESC LIMIT 1',
      [generatorId]
    );

    if (lastGe?.status !== status) {
      await pool.query(
        'INSERT INTO generator_events (generator_id, plant_id, status, reason) VALUES ($1,$2,$3,$4)',
        [generatorId, plantId, status, status === 'ON' ? 'power_cut' : 'power_restored']
      );

      const current: PowerSource = genOn ? 'GENERATOR' : 'CEB';
      const previous: PowerSource | null = lastGe ? (lastGe.status === 'ON' ? 'GENERATOR' : 'CEB') : null;
      await checkPowerSwitch(current, previous, plantId, generatorId, io);
    }

    io.emit('live_reading', {
      generator: { status, generator_id: generatorId },
      plant_id: plantId,
      meter_id: mainMeterId,
    });

    console.log(`[MQTT] Power status stored: ${generatorId} = ${status} (device ${deviceId})`);
  } catch (err) {
    console.error('[MQTT] Error storing power status:', (err as Error).message);
  }
}

export function stopMQTT(): void {
  if (client) {
    client.end();
    client = null;
    console.log('[MQTT] Stopped');
  }
}
