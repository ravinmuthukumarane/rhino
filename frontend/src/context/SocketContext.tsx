import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import type { Alert, LiveReadingPayload } from '../types';

// plant_id -> meter_id -> that meter's latest reading. A plant has many
// meters reporting independently; keying only by plant_id would make each
// new meter's message overwrite the previous one instead of accumulating
// a full picture of the plant. meter_id falls back to '__plant__' for
// events that aren't per-meter (e.g. a plant-wide generator status change).
type PlantReadings = Map<string, Map<string, LiveReadingPayload>>;

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
    const socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('live_reading', (data: LiveReadingPayload) => {
      setLiveReadings((prev) => {
        const next = new Map(prev);
        const meterKey = data.meter_id ?? '__plant__';
        const plantMeters = new Map(next.get(data.plant_id));
        plantMeters.set(meterKey, data);
        next.set(data.plant_id, plantMeters);
        return next;
      });
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
