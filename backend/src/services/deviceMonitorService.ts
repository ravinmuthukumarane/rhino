import pool from '../config/database';
import { emailService } from './emailService';
import { insertAlert } from './alertService';
import { Server } from 'socket.io';

// A device (energy meter, flow meter, or power-status sensor - anything with
// an MQTT device_id) counts as offline once nothing has been heard from it
// for this long. One email goes out when it drops, one when it comes back.
export const OFFLINE_MINUTES = parseInt(process.env.DEVICE_OFFLINE_MINUTES ?? '15');
const CHECK_INTERVAL_MS = 60_000;
// Gateways publish every ~5-10s - writing last_seen_at on every message is
// wasted load when the check only has minute resolution.
const SEEN_WRITE_THROTTLE_MS = 30_000;

const lastWrite: Record<string, number> = {};

export interface MonitoredDevice {
  kind: string;
  ref_id: string;
  name: string;
  device_id: string;
  plant_id: string | null;
  plant_section: string | null;
  last_seen_at: string | null;
  offline_notified: boolean;
  offline_since: string | null;
  offline: boolean;
}

export async function markSeen(deviceId: string | undefined): Promise<void> {
  if (!deviceId) return;
  const now = Date.now();
  if (now - (lastWrite[deviceId] ?? 0) < SEEN_WRITE_THROTTLE_MS) return;
  lastWrite[deviceId] = now;
  try {
    await pool.query(
      `INSERT INTO device_status (device_id, last_seen_at) VALUES ($1, NOW())
       ON CONFLICT (device_id) DO UPDATE SET last_seen_at = NOW()`,
      [deviceId]
    );
  } catch (err) {
    console.error('[DeviceMonitor] markSeen failed:', (err as Error).message);
  }
}

const DEVICES_SQL = `
  SELECT 'Energy Meter' AS kind, meter_id AS ref_id, name, device_id, plant_id, plant_section
    FROM energy_meters WHERE device_id IS NOT NULL AND is_active
  UNION ALL
  SELECT 'Flow Meter', meter_id, name, device_id, plant_id, plant_section
    FROM flow_meters WHERE device_id IS NOT NULL AND is_active
  UNION ALL
  SELECT 'Power Status Sensor', sensor_id, name, device_id, plant_id, plant_section
    FROM power_status_sensors WHERE device_id IS NOT NULL AND is_active`;

export async function getDeviceStatuses(): Promise<MonitoredDevice[]> {
  const { rows } = await pool.query<MonitoredDevice>(
    `SELECT d.*, s.last_seen_at, COALESCE(s.offline_notified, false) AS offline_notified, s.offline_since,
            (s.last_seen_at IS NULL OR s.last_seen_at < NOW() - make_interval(mins => $1)) AS offline
     FROM (${DEVICES_SQL}) d
     LEFT JOIN device_status s ON s.device_id = d.device_id
     ORDER BY d.plant_section NULLS LAST, d.kind, d.name`,
    [OFFLINE_MINUTES]
  );
  return rows;
}

const minutesSince = (ts: string | null) => ts ? Math.round((Date.now() - new Date(ts).getTime()) / 60000) : null;

async function checkDevices(io: Server): Promise<void> {
  // Registered devices that have never reported get a baseline of "now", so
  // a newly added (or never-working) device is flagged after the normal
  // grace period instead of being ignored forever.
  await pool.query(
    `INSERT INTO device_status (device_id) SELECT device_id FROM (${DEVICES_SQL}) d
     ON CONFLICT (device_id) DO NOTHING`
  );

  const devices = await getDeviceStatuses();
  const wentOffline = devices.filter((d) => d.offline && !d.offline_notified);
  const backOnline = devices.filter((d) => !d.offline && d.offline_notified);
  if (!wentOffline.length && !backOnline.length) return;
  const alertIds: number[] = [];

  for (const d of wentOffline) {
    await pool.query(
      'UPDATE device_status SET offline_notified=true, offline_since=last_seen_at WHERE device_id=$1',
      [d.device_id]
    );
    d.offline_since = d.last_seen_at;
    const alert = await insertAlert({
      alert_type: 'device_offline', severity: 'critical',
      message: `${d.kind} "${d.name}" (${d.device_id}) offline - no data for ${minutesSince(d.last_seen_at)} min`,
      value: minutesSince(d.last_seen_at) ?? undefined, setpoint_value: OFFLINE_MINUTES,
      plant_id: d.plant_id ?? undefined, meter_id: d.ref_id,
    });
    alert.plant_section ??= d.plant_section;
    alertIds.push(alert.id);
    io.emit('new_alert', alert);
  }

  for (const d of backOnline) {
    await pool.query(
      'UPDATE device_status SET offline_notified=false, offline_since=NULL WHERE device_id=$1',
      [d.device_id]
    );
    const alert = await insertAlert({
      alert_type: 'device_online', severity: 'info',
      message: `${d.kind} "${d.name}" (${d.device_id}) back online after ${minutesSince(d.offline_since)} min`,
      plant_id: d.plant_id ?? undefined, meter_id: d.ref_id,
    });
    alert.plant_section ??= d.plant_section;
    alertIds.push(alert.id);
    io.emit('new_alert', alert);
  }

  const { rows } = await pool.query('SELECT email FROM offline_alert_recipients ORDER BY email');
  const emails = rows.map((r: { email: string }) => r.email);
  await emailService.sendDeviceStatusAlert(emails, wentOffline, backOnline, OFFLINE_MINUTES);
  if (emails.length) {
    await pool.query('UPDATE alerts SET email_sent=true WHERE id = ANY($1)', [alertIds]);
  }
  console.log(`[DeviceMonitor] offline: ${wentOffline.map((d) => d.device_id).join(', ') || '-'}; back online: ${backOnline.map((d) => d.device_id).join(', ') || '-'}`);
}

export function startDeviceMonitor(io: Server): void {
  setInterval(() => {
    checkDevices(io).catch((err) => console.error('[DeviceMonitor] Check failed:', (err as Error).message));
  }, CHECK_INTERVAL_MS);
  console.log(`[DeviceMonitor] Started (offline after ${OFFLINE_MINUTES} min)`);
}
