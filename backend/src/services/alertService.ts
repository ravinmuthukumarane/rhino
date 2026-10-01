import pool from '../config/database';
import { emailService } from './emailService';
import { AlertSetpoint, EnergyReading, PowerSource, Alert } from '../types';
import { Server } from 'socket.io';

let globalSpCache: Record<string, AlertSetpoint> = {};
// meter_id -> alert_type -> setpoint. Holds device rows regardless of their
// own `enabled` flag - an explicitly-disabled device row must suppress the
// alert for that meter even when the global setpoint is enabled, so it has
// to stay distinguishable from "no override exists" (see getEffectiveSetpoint).
let deviceSpCache: Record<string, Record<string, AlertSetpoint>> = {};
let cacheTime = 0;

async function refreshSetpointCache(): Promise<void> {
  if (Date.now() - cacheTime < 60000 && cacheTime > 0) return;
  const [{ rows: globalRows }, { rows: deviceRows }] = await Promise.all([
    pool.query<AlertSetpoint>('SELECT * FROM alert_setpoints WHERE enabled = true'),
    pool.query<AlertSetpoint & { meter_id: string }>('SELECT * FROM device_alert_setpoints'),
  ]);
  globalSpCache = Object.fromEntries(globalRows.map((r) => [r.alert_type, r]));
  const byMeter: Record<string, Record<string, AlertSetpoint>> = {};
  for (const r of deviceRows) {
    (byMeter[(r as any).meter_id] ??= {})[r.alert_type] = r;
  }
  deviceSpCache = byMeter;
  cacheTime = Date.now();
}

// Device-specific setpoint overrides the global one for that meter+alert_type,
// including to explicitly turn the alert off for just that device. With no
// device override, falls back to the global setpoint (already filtered to
// enabled ones above).
function getEffectiveSetpoint(meterId: string | undefined, alertType: string): AlertSetpoint | undefined {
  const device = meterId ? deviceSpCache[meterId]?.[alertType] : undefined;
  if (device) return device.enabled ? device : undefined;
  return globalSpCache[alertType];
}

async function getAdminEmails(): Promise<string[]> {
  const { rows } = await pool.query("SELECT email FROM users WHERE role='admin' AND is_verified=true");
  return rows.map((r: { email: string }) => r.email);
}

export async function insertAlert(data: Partial<Alert>): Promise<Alert> {
  const { rows: [alert] } = await pool.query<Alert>(
    `INSERT INTO alerts (alert_type, severity, message, value, setpoint_value, source, plant_id, meter_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.alert_type, data.severity, data.message, data.value ?? null, data.setpoint_value ?? null,
     data.source ?? null, data.plant_id ?? null, data.meter_id ?? null]
  );
  alert.plant_section = await resolveSection(alert.meter_id);
  return alert;
}

// alerts don't store plant_section themselves - it's derived from whichever
// device registry owns the meter_id (energy meter, flow meter, or generator,
// e.g. power_interruption/power_restored alerts carry a generator_id like
// "GEN-P1" instead of an energy_meters.meter_id).
async function resolveSection(meterId?: string | null): Promise<string | null> {
  if (!meterId) return null;
  const { rows } = await pool.query(
    `SELECT COALESCE(em.plant_section, fm.plant_section, g.plant_section) AS plant_section
     FROM (SELECT $1::text AS meter_id) x
     LEFT JOIN energy_meters em ON em.meter_id = x.meter_id
     LEFT JOIN flow_meters fm ON fm.meter_id = x.meter_id
     LEFT JOIN generators g ON g.generator_id = x.meter_id`,
    [meterId]
  );
  return rows[0]?.plant_section ?? null;
}

// While a condition persists, a meter re-alerts at most once per this window
// - otherwise every reading (~every 44s) that breaks a setpoint logged its
// own alert, which for a steady low-PF load is ~2,000 alerts per meter/day.
const REALERT_MINUTES = 15;

async function recentlyAlerted(alertType: string, meterId: string | undefined): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM alerts WHERE alert_type=$1 AND meter_id IS NOT DISTINCT FROM $2
     AND created_at > NOW() - make_interval(mins => $3) LIMIT 1`,
    [alertType, meterId ?? null, REALERT_MINUTES]
  );
  return rows.length > 0;
}

// Email rate limit is per meter, not per alert type site-wide - a P4 alert
// used to silence P1's email of the same type for 15 minutes.
async function canEmail(alertType: string, meterId: string | undefined): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT id FROM alerts WHERE alert_type=$1 AND meter_id IS NOT DISTINCT FROM $2 AND email_sent=true AND created_at > NOW()-INTERVAL '15 minutes' LIMIT 1",
    [alertType, meterId ?? null]
  );
  return rows.length === 0;
}

// Below this a meter is effectively idle (machine off) and its PF reads 0 or
// noise - PF is meaningless without load, so it isn't checked.
const PF_MIN_LOAD_KW = 0.5;

export async function checkAndAlert(reading: EnergyReading, io: Server): Promise<void> {
  await refreshSetpointCache();
  const meterId = reading.meter_id;
  const sp = {
    over_voltage: getEffectiveSetpoint(meterId, 'over_voltage'),
    low_voltage: getEffectiveSetpoint(meterId, 'low_voltage'),
    low_power_factor: getEffectiveSetpoint(meterId, 'low_power_factor'),
    high_kva: getEffectiveSetpoint(meterId, 'high_kva'),
  };
  const avgV = ((reading.voltage_r ?? 0) + (reading.voltage_y ?? 0) + (reading.voltage_b ?? 0)) / 3;
  const alerts: Partial<Alert>[] = [];

  if (sp.over_voltage?.max_value != null && avgV > sp.over_voltage.max_value)
    alerts.push({ alert_type: 'over_voltage', severity: 'critical', message: `Over voltage: ${avgV.toFixed(1)}V (limit: ${sp.over_voltage.max_value}V)`, value: avgV, setpoint_value: sp.over_voltage.max_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  if (sp.low_voltage?.min_value != null && avgV < sp.low_voltage.min_value)
    alerts.push({ alert_type: 'low_voltage', severity: 'warning', message: `Low voltage: ${avgV.toFixed(1)}V (min: ${sp.low_voltage.min_value}V)`, value: avgV, setpoint_value: sp.low_voltage.min_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  // PF is stored *signed* (negative = lagging/inductive, positive = leading/
  // capacitive - normalised across meter brands in mqttService.ts), and the
  // setpoint's sign is meaningful too - it picks which side is watched:
  //   -0.60 -> lagging readings weaker than 0.60 alert (-0.60 < PF < 0)
  //   +0.60 -> leading readings weaker than 0.60 alert (0 < PF < +0.60)
  // Readings on the other side of zero aren't checked against that setpoint.
  // (Comparing |PF| against a negative setpoint as-is, as before, could never
  // fire: |PF| is never below -0.6.)
  const pfRaw = typeof reading.power_factor === 'string' ? parseFloat(reading.power_factor) : (reading.power_factor ?? 1);
  const pfSetpoint = sp.low_power_factor?.min_value != null ? Number(sp.low_power_factor.min_value) : null;
  const kw = typeof reading.power_kw === 'string' ? parseFloat(reading.power_kw) : (reading.power_kw ?? 0);
  const pfBreached = pfSetpoint != null && pfSetpoint !== 0 && (
    pfSetpoint < 0 ? (pfRaw < 0 && pfRaw > pfSetpoint) : (pfRaw > 0 && pfRaw < pfSetpoint)
  );
  if (pfBreached && Math.abs(kw) >= PF_MIN_LOAD_KW) {
    const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)}`;
    const side = pfSetpoint! < 0 ? 'lagging' : 'leading';
    alerts.push({ alert_type: 'low_power_factor', severity: 'warning', message: `Low power factor (${side}): ${signed(pfRaw)} (limit: ${signed(pfSetpoint!)})`, value: pfRaw, setpoint_value: pfSetpoint!, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });
  }

  const kva = typeof reading.power_kva === 'string' ? parseFloat(reading.power_kva) : (reading.power_kva ?? 0);
  if (sp.high_kva?.max_value != null && kva > sp.high_kva.max_value)
    alerts.push({ alert_type: 'high_kva', severity: 'warning', message: `High KVA demand: ${kva.toFixed(1)} kVA (limit: ${sp.high_kva.max_value})`, value: kva, setpoint_value: sp.high_kva.max_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  for (const data of alerts) {
    if (await recentlyAlerted(data.alert_type!, meterId)) continue;
    const alert = await insertAlert(data);
    io.emit('new_alert', alert);
    const setpoint = getEffectiveSetpoint(meterId, data.alert_type!);
    if (setpoint?.email_notify && await canEmail(data.alert_type!, meterId)) {
      const emails = await getAdminEmails();
      if (emails.length) {
        emailService.sendAlert(alert, emails).catch(console.error);
        await pool.query('UPDATE alerts SET email_sent=true WHERE id=$1', [alert.id]);
      }
    }
  }
}

export async function checkPowerSwitch(current: PowerSource, previous: PowerSource | null, plantId: string | null, meterId: string, io: Server): Promise<void> {
  if (!previous || current === previous) return;

  if (previous === 'CEB' && current === 'GENERATOR') {
    await pool.query('INSERT INTO power_interruptions (plant_id, meter_id, started_at, generator_activated) VALUES ($1,$2,NOW(),true)',
      [plantId, meterId]);
    const alert = await insertAlert({
      alert_type: 'power_interruption', severity: 'critical',
      message: 'Power interruption — switched to generator',
      source: 'CEB', plant_id: plantId ?? undefined, meter_id: meterId,
    });
    io.emit('new_alert', alert);
    io.emit('power_interruption', { started_at: new Date(), plant_id: plantId });
    const emails = await getAdminEmails();
    if (emails.length) emailService.sendAlert(alert, emails).catch(console.error);
  } else if (previous === 'GENERATOR' && current === 'CEB') {
    await pool.query(
      `WITH target AS (
         SELECT id FROM power_interruptions
         WHERE plant_id IS NOT DISTINCT FROM $1 AND restored_at IS NULL
         ORDER BY started_at DESC LIMIT 1
       )
       UPDATE power_interruptions SET restored_at=NOW(),
       duration_minutes=EXTRACT(EPOCH FROM (NOW()-started_at))/60
       WHERE id IN (SELECT id FROM target)`,
      [plantId]
    );
    const alert = await insertAlert({
      alert_type: 'power_restored', severity: 'info',
      message: 'Power restored — back on CEB',
      source: 'CEB', plant_id: plantId ?? undefined, meter_id: meterId,
    });
    io.emit('new_alert', alert);
    io.emit('power_restored', { restored_at: new Date(), plant_id: plantId });
  }
}
