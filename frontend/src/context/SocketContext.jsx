import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [liveReading, setLiveReading] = useState(null);
  const [activeAlerts, setActiveAlerts] = useState([]);

  useEffect(() => {
    if (!token) return;

    const socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('live_reading', (data) => setLiveReading(data));

    socket.on('new_alert', (alert) => {
      setActiveAlerts((prev) => {
        const exists = prev.some((a) => a.id === alert.id);
        if (exists) return prev;
        return [alert, ...prev].slice(0, 20);
      });
    });

    socket.on('power_interruption', (data) => {
      console.warn('[Socket] Power interruption:', data);
    });

    socket.on('power_restored', (data) => {
      console.info('[Socket] Power restored:', data);
    });

    return () => socket.disconnect();
  }, [token]);

  const dismissAlert = (alertId) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  return (
    <SocketContext.Provider value={{ connected, liveReading, activeAlerts, dismissAlert, socket: socketRef.current }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
