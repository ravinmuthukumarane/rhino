import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSocket } from '../../context/SocketContext';
import { format } from 'date-fns';

const MAX_POINTS = 30;

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs">
      <p className="text-gray-400 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="text-gray-200 font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function LiveReadingsChart({ metric = 'voltage' }) {
  const { liveReading } = useSocket();
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!liveReading?.energy) return;
    const e = liveReading.energy;
    const point = {
      time: format(new Date(), 'HH:mm:ss'),
      ...(metric === 'voltage'
        ? { VR: +parseFloat(e.voltage_r||0).toFixed(1), VY: +parseFloat(e.voltage_y||0).toFixed(1), VB: +parseFloat(e.voltage_b||0).toFixed(1) }
        : metric === 'current'
        ? { IR: +parseFloat(e.current_r||0).toFixed(1), IY: +parseFloat(e.current_y||0).toFixed(1), IB: +parseFloat(e.current_b||0).toFixed(1) }
        : metric === 'power'
        ? { 'Power (kW)': +parseFloat(e.power_kw||0).toFixed(2), 'KVA': +parseFloat(e.power_kva||0).toFixed(2) }
        : { PF: +parseFloat(e.power_factor||0).toFixed(3) }),
    };
    setHistory((prev) => [...prev.slice(-(MAX_POINTS - 1)), point]);
  }, [liveReading, metric]);

  const lines = {
    voltage: [{ key: 'VR', color: '#ef4444' }, { key: 'VY', color: '#eab308' }, { key: 'VB', color: '#3b82f6' }],
    current: [{ key: 'IR', color: '#ef4444' }, { key: 'IY', color: '#eab308' }, { key: 'IB', color: '#3b82f6' }],
    power: [{ key: 'Power (kW)', color: '#22c55e' }, { key: 'KVA', color: '#8b5cf6' }],
    pf: [{ key: 'PF', color: '#06b6d4' }],
  };

  const labels = { voltage: 'Live Voltage (V)', current: 'Live Current (A)', power: 'Live Power', pf: 'Live Power Factor' };

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-200 mb-4">{labels[metric]}</h3>
      {history.length === 0
        ? <div className="h-[200px] flex items-center justify-center text-gray-600 text-sm">Waiting for live data…</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={history} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              {(lines[metric] || []).map(({ key, color }) => (
                <Line key={key} type="monotone" dataKey={key} stroke={color}
                  dot={false} strokeWidth={1.5} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )
      }
    </div>
  );
}
