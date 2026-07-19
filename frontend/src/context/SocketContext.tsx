import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import type { Alert, LiveReadingPayload } from '../types';

interface SocketContextValue {
  connected: boolean;
  liveReadings: Map<string, LiveReadingPayload>;
  activeAlerts: Alert[];
  dismissAlert: (id: number) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [liveReadings, setLiveReadings] = useState<Map<string, LiveReadingPayload>>(new Map());
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
        next.set(data.plant_id, data);
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
