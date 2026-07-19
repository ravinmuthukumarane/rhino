import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { readingsApi } from '../../services/api';
import { format, subDays, subMonths } from 'date-fns';

const PERIODS = [
  { key: 'daily', label: 'Daily (30 days)' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs">
      <p className="font-medium text-gray-300 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="font-medium text-gray-200">{parseFloat(p.value || 0).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
};

export default function ConsumptionChart({ type = 'energy' }) {
  const [period, setPeriod] = useState('daily');

  const { data: dailyData } = useQuery({
    queryKey: ['daily-summary', type],
    queryFn: async () => {
      const from = subDays(new Date(), 30).toISOString().split('T')[0];
      const res = await readingsApi.getDailySummary({ from, limit: 30 });
      return res.data;
    },
    enabled: period === 'daily',
    refetchInterval: 60000,
  });

  const { data: monthlyData } = useQuery({
    queryKey: ['monthly-summary', type, new Date().getFullYear()],
    queryFn: async () => {
      const res = await readingsApi.getMonthlySummary({ year: new Date().getFullYear() });
      return res.data;
    },
    enabled: period === 'monthly',
    refetchInterval: 300000,
  });

  const { data: yearlyData } = useQuery({
    queryKey: ['yearly-summary', type],
    queryFn: () => readingsApi.getYearlySummary().then((r) => r.data),
    enabled: period === 'yearly',
  });

  const chartData = (() => {
    if (period === 'daily') {
      const rows = type === 'energy' ? (dailyData?.energy || []) : (dailyData?.diesel || []);
      return rows.slice().reverse().map((r) => ({
        label: format(new Date(r.summary_date), 'dd MMM'),
        ...(type === 'energy'
          ? { CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0, Day: +r.day_kwh||0, Peak: +r.peak_kwh||0, OffPeak: +r.off_peak_kwh||0 }
          : { 'Diesel (L)': +r.total_liters||0, 'Run Hours': +r.generator_run_hours||0 }),
      }));
    }
    if (period === 'monthly') {
      const rows = type === 'energy' ? (monthlyData?.energy || []) : (monthlyData?.diesel || []);
      return rows.map((r) => ({
        label: format(new Date(r.month), 'MMM yyyy'),
        ...(type === 'energy'
          ? { CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0, Day: +r.day_kwh||0, Peak: +r.peak_kwh||0, OffPeak: +r.off_peak_kwh||0 }
          : { 'Diesel (L)': +r.total_liters||0, 'Run Hours': +r.generator_run_hours||0 }),
      }));
    }
    if (period === 'yearly') {
      const rows = type === 'energy' ? (yearlyData?.energy || []) : (yearlyData?.diesel || []);
      return rows.slice().reverse().map((r) => ({
        label: String(r.year),
        ...(type === 'energy'
          ? { CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0 }
          : { 'Diesel (L)': +r.total_liters||0, 'Run Hours': +r.generator_run_hours||0 }),
      }));
    }
    return [];
  })();

  const energyBars = period === 'yearly'
    ? [{ key: 'CEB', color: '#22c55e' }, { key: 'Generator', color: '#f97316' }]
    : [
        { key: 'CEB', color: '#22c55e' },
        { key: 'Generator', color: '#f97316' },
        { key: 'Day', color: '#3b82f6' },
        { key: 'Peak', color: '#f59e0b' },
        { key: 'OffPeak', color: '#8b5cf6' },
      ];

  const dieselBars = [
    { key: 'Diesel (L)', color: '#f97316' },
    { key: 'Run Hours', color: '#fb923c' },
  ];

  const bars = type === 'energy' ? energyBars : dieselBars;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-200">
          {type === 'energy' ? 'Energy Consumption (kWh)' : 'Diesel Consumption'}
        </h3>
        <div className="flex gap-1">
          {PERIODS.map(({ key, label }) => (
            <button key={key} onClick={() => setPeriod(key)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors
                ${period === key ? 'bg-primary-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
          {bars.map(({ key, color }) => (
            <Bar key={key} dataKey={key} fill={color} radius={[2, 2, 0, 0]} maxBarSize={32} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
