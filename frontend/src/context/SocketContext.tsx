import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { readingsApi } from '../services/api';
import { getTimePeriod } from '../utils/timeUtils';
import type { Alert, LiveReadingPayload } from '../types';

// plant_id -> meter_id -> that meter's latest reading. A plant has many
// meters reporting independently; keying only by plant_id would make each
// new meter's message overwrite the previous one instead of accumulating
// a full picture of the plant. meter_id falls back to '__plant__' for
// events that aren't per-meter (e.g. a plant-wide generator status change).
type PlantReadings = Map<string, Map<string, LiveReadingPayload>>;

function applyReading(map: PlantReadings, data: LiveReadingPayload): PlantReadings {
  const next = new Map(map);
  const meterKey = data.meter_id ?? '__plant__';
  const plantMeters = new Map(next.get(data.plant_id));
  const prev = plantMeters.get(meterKey);
  // Merge rather than replace: the power-status sensor emits a
  // generator-only update onto the section's Main Incoming Energy meter's
  // key, on its own schedule independent of that meter's own energy
  // readings - a plain overwrite would blank out its energy/diesel data
  // between messages instead of layering the generator status on top.
  plantMeters.set(meterKey, prev ? {
    ...prev,
    ...data,
    energy: data.energy ?? prev.energy,
    diesel: data.diesel ?? prev.diesel,
    generator: data.generator ?? prev.generator,
  } : data);
  next.set(data.plant_id, plantMeters);
  return next;
}

interface SocketContextValue {
  connected: boolean;
  liveReadings: PlantReadings;
  activeAlerts: Alert[];
  dismissAlert: (id: number) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [liveReadings, setLiveReadings] = useState<PlantReadings>(new Map());
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (!token) return;

    // Seed every meter with its last-known DB reading before any live
    // socket message arrives. Without this, liveReadings starts empty on
    // every page load/reload and every card - Real-Time Readings, Phase
    // Detail, the Live Trend chart - sits on "waiting for data" and then
    // fills in meter-by-meter as each device's next MQTT push lands (up to
    // ~10s per device, on independent schedules). A live message for a
    // meter always wins over its seed - checked against the latest state
    // at apply time, not the state when this fetch was kicked off.
    readingsApi.getLatestByMeter({}).then((r) => {
      const { energy = {}, diesel = {} } = r.data ?? {};
      const timePeriod = getTimePeriod();
      setLiveReadings((prev) => {
        let next = prev;
        const seed = (row: any) => {
          if (!row?.plant_id) return;
          const meterKey = row.meter_id ?? '__plant__';
          if (next.get(row.plant_id)?.has(meterKey)) return; // live data already arrived - don't clobber it
          next = applyReading(next, {
            energy: row.voltage_r !== undefined ? row : null,
            diesel: row.flow_rate !== undefined ? row : null,
            generator: null,
            timePeriod,
            plant_id: row.plant_id,
            meter_id: row.meter_id,
          });
        };
        Object.values(energy).forEach(seed);
        Object.values(diesel).forEach(seed);
        return next;
      });
    }).catch(() => { /* live socket data will populate as it arrives regardless */ });

    const socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('live_reading', (data: LiveReadingPayload) => {
      setLiveReadings((prev) => applyReading(prev, data));
    });

    socket.on('new_alert', (alert: Alert) => {
      setActiveAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, 30));
    });

    return () => { socket.disconnect(); };
  }, [token]);

  const dismissAlert = (id: number) => setActiveAlerts((prev) => prev.filter((a) => a.id !== id));

  return (
    <SocketContext.Provider value={{ connected, liveReadings, activeAlerts, dismissAlert }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be inside SocketProvider');
  return ctx;
};
