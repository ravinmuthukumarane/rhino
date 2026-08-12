import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlant } from '../context/PlantContext';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { reportsApi } from '../services/api';

export default function TariffReportPage() {
  const { plants } = usePlant();
  const [plant, setPlant] = useState('');
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading } = useQuery({
    queryKey: ['tariff-report', plant, from, to],
    queryFn: () => reportsApi.getTariffReport({ plant_id: plant, from, to }).then(r => r.data),
    enabled: !!plant,
  });

  const colors = ['#3b82f6', '#ef4444', '#10b981'];

  return (
    <div className="space-y-5">
      <div className="card">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-1">📊 Tariff Report</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">Energy consumption breakdown by time period (Day/Peak/Off-Peak)</p>
      </div>

      <div className="card grid grid-cols-4 gap-4">
        <div>
          <label className="label">Plant</label>
          <select value={plant} onChange={e => setPlant(e.target.value)} className="input text-sm">
            <option value="">Select Plant</option>
            {plants?.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-sm" />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-sm" />
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full">Generate</button>
        </div>
      </div>

      {isLoading ? (
        <div className="card text-center py-8 text-gray-600 dark:text-gray-400">Loading...</div>
      ) : data ? (
        <>
          {/* Plant Summary */}
          {data.plant_total && (
            <div className="grid grid-cols-5 gap-3">
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Day</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{parseFloat(data.plant_total.day_kwh).toFixed(0)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Peak</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{parseFloat(data.plant_total.peak_kwh).toFixed(0)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Off-Peak</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{parseFloat(data.plant_total.offpeak_kwh).toFixed(0)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Total</p>
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-200">{parseFloat(data.plant_total.total_kwh).toFixed(0)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Max KVA</p>
                <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{parseFloat(data.plant_total.max_kva).toFixed(1)}</p>
                <p className="text-xs text-gray-500">kVA</p>
              </div>
            </div>
          )}

          {/* Bar Chart */}
          <div className="card">
            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Consumption by Period</h4>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.metrics}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="meter_name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                <Legend />
                <Bar dataKey="day_kwh" fill={colors[0]} name="Day" />
                <Bar dataKey="peak_kwh" fill={colors[1]} name="Peak" />
                <Bar dataKey="offpeak_kwh" fill={colors[2]} name="Off-Peak" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Max KVA Chart */}
          <div className="card">
            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Peak Demand (Max KVA)</h4>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.metrics}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="meter_name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                <Bar dataKey="max_kva_day" fill="#f59e0b" name="Max KVA" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Meter Details Table */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    {['Meter', 'Day (kWh)', 'Peak (kWh)', 'Off-Peak (kWh)', 'Total (kWh)', 'Max KVA', 'Avg PF'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.metrics?.map((m: any) => (
                    <tr key={m.meter_id} className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{m.meter_name}</td>
                      <td className="px-4 py-3">{parseFloat(m.day_kwh).toFixed(1)}</td>
                      <td className="px-4 py-3">{parseFloat(m.peak_kwh).toFixed(1)}</td>
                      <td className="px-4 py-3">{parseFloat(m.offpeak_kwh).toFixed(1)}</td>
                      <td className="px-4 py-3 font-bold text-blue-600 dark:text-blue-400">{parseFloat(m.total_kwh).toFixed(1)}</td>
                      <td className="px-4 py-3">{parseFloat(m.max_kva_day).toFixed(1)}</td>
                      <td className="px-4 py-3">{parseFloat(m.avg_pf).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
