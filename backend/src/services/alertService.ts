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

async function insertAlert(data: Partial<Alert>): Promise<Alert> {
  const { rows: [alert] } = await pool.query<Alert>(
    `INSERT INTO alerts (alert_type, severity, message, value, setpoint_value, source, plant_id, meter_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.alert_type, data.severity, data.message, data.value ?? null, data.setpoint_value ?? null,
     data.source ?? null, data.plant_id ?? null, data.meter_id ?? null]
  );
  return alert;
}

async function canEmail(alertType: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT id FROM alerts WHERE alert_type=$1 AND email_sent=true AND created_at > NOW()-INTERVAL '15 minutes' LIMIT 1",
    [alertType]
  );
  return rows.length === 0;
}

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

  // PF/cos φ is a *signed* register on this hardware (negative = leading/
  // capacitive, positive = lagging/inductive - see script/mqtt.md, Circutor
  // CVM-C11 map) - comparing the raw signed value against a magnitude
  // threshold like 0.85 made every leading reading (e.g. -0.95, actually a
  // very good PF) compare as "low" regardless of how good it really was.
  // The threshold is about magnitude/quality, so compare the absolute value.
  const pfRaw = typeof reading.power_factor === 'string' ? parseFloat(reading.power_factor) : (reading.power_factor ?? 1);
  const pf = Math.abs(pfRaw);
  if (sp.low_power_factor?.min_value != null && pf < sp.low_power_factor.min_value)
    alerts.push({ alert_type: 'low_power_factor', severity: 'warning', message: `Low power factor: ${pf.toFixed(3)} (min: ${sp.low_power_factor.min_value})`, value: pf, setpoint_value: sp.low_power_factor.min_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  const kva = typeof reading.power_kva === 'string' ? parseFloat(reading.power_kva) : (reading.power_kva ?? 0);
  if (sp.high_kva?.max_value != null && kva > sp.high_kva.max_value)
    alerts.push({ alert_type: 'high_kva', severity: 'warning', message: `High KVA demand: ${kva.toFixed(1)} kVA (limit: ${sp.high_kva.max_value})`, value: kva, setpoint_value: sp.high_kva.max_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  for (const data of alerts) {
    const alert = await insertAlert(data);
    io.emit('new_alert', alert);
    const setpoint = getEffectiveSetpoint(meterId, data.alert_type!);
    if (setpoint?.email_notify && await canEmail(data.alert_type!)) {
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
