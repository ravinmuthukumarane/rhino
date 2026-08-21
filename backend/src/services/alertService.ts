import pool from '../config/database';
import { emailService } from './emailService';
import { AlertSetpoint, EnergyReading, PowerSource, Alert } from '../types';
import { Server } from 'socket.io';

let spCache: Record<string, AlertSetpoint> = {};
let cacheTime = 0;

async function getSetpoints(): Promise<Record<string, AlertSetpoint>> {
  if (Date.now() - cacheTime < 60000 && Object.keys(spCache).length) return spCache;
  const { rows } = await pool.query<AlertSetpoint>('SELECT * FROM alert_setpoints WHERE enabled = true');
  spCache = Object.fromEntries(rows.map((r) => [r.alert_type, r]));
  cacheTime = Date.now();
  return spCache;
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
  const sp = await getSetpoints();
  const avgV = ((reading.voltage_r ?? 0) + (reading.voltage_y ?? 0) + (reading.voltage_b ?? 0)) / 3;
  const alerts: Partial<Alert>[] = [];

  if (sp.over_voltage?.max_value != null && avgV > sp.over_voltage.max_value)
    alerts.push({ alert_type: 'over_voltage', severity: 'critical', message: `Over voltage: ${avgV.toFixed(1)}V (limit: ${sp.over_voltage.max_value}V)`, value: avgV, setpoint_value: sp.over_voltage.max_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  if (sp.low_voltage?.min_value != null && avgV < sp.low_voltage.min_value)
    alerts.push({ alert_type: 'low_voltage', severity: 'warning', message: `Low voltage: ${avgV.toFixed(1)}V (min: ${sp.low_voltage.min_value}V)`, value: avgV, setpoint_value: sp.low_voltage.min_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  const pf = typeof reading.power_factor === 'string' ? parseFloat(reading.power_factor) : (reading.power_factor ?? 1);
  if (sp.low_power_factor?.min_value != null && pf < sp.low_power_factor.min_value)
    alerts.push({ alert_type: 'low_power_factor', severity: 'warning', message: `Low power factor: ${pf.toFixed(3)} (min: ${sp.low_power_factor.min_value})`, value: pf, setpoint_value: sp.low_power_factor.min_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  const kva = typeof reading.power_kva === 'string' ? parseFloat(reading.power_kva) : (reading.power_kva ?? 0);
  if (sp.high_kva?.max_value != null && kva > sp.high_kva.max_value)
    alerts.push({ alert_type: 'high_kva', severity: 'warning', message: `High KVA demand: ${kva.toFixed(1)} kVA (limit: ${sp.high_kva.max_value})`, value: kva, setpoint_value: sp.high_kva.max_value, source: reading.source, plant_id: reading.plant_id?.toString(), meter_id: reading.meter_id });

  for (const data of alerts) {
    const alert = await insertAlert(data);
    io.emit('new_alert', alert);
    const setpoint = sp[data.alert_type!];
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
