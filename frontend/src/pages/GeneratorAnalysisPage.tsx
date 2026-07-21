import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlant } from '../context/PlantContext';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import axios from 'axios';

export default function GeneratorAnalysisPage() {
  const { plants } = usePlant();
  const [plant, setPlant] = useState('');
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading } = useQuery({
    queryKey: ['generator-analysis', plant, from, to],
    queryFn: () =>
      axios.get('/api/reports/generator-analysis', { params: { plant_id: plant, from, to } })
        .then(r => r.data),
    enabled: !!plant,
  });

  return (
    <div className="space-y-5">
      <div className="card">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-1">⚡ Generator Analysis</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">CEB vs Generator usage and power interruptions</p>
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
          {/* Monthly Summary */}
          {data.monthly_summary && (
            <div className="grid grid-cols-4 gap-3">
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">CEB kWh</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{parseFloat(data.monthly_summary.total_ceb_kwh).toFixed(0)}</p>
                <p className="text-xs text-gray-500">from grid</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Generator kWh</p>
                <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{parseFloat(data.monthly_summary.total_generator_kwh).toFixed(0)}</p>
                <p className="text-xs text-gray-500">from backup</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Generator %</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{data.monthly_summary.generator_percentage}%</p>
                <p className="text-xs text-gray-500">of total</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-600 dark:text-gray-400">Switchovers</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{data.monthly_summary.total_switchovers}</p>
                <p className="text-xs text-gray-500">power cuts</p>
              </div>
            </div>
          )}

          {/* Daily Stacked Area Chart */}
          <div className="card">
            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Daily CEB vs Generator</h4>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.daily_breakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                <Legend />
                <Area type="monotone" dataKey="ceb_kwh" stackId="1" fill="#3b82f6" name="CEB" />
                <Area type="monotone" dataKey="generator_kwh" stackId="1" fill="#f59e0b" name="Generator" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Generator Percentage Bar Chart */}
          <div className="card">
            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Generator Usage %</h4>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.daily_breakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }} />
                <Bar dataKey="generator_percentage" fill="#ef4444" name="Gen %" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Daily Table */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    {['Date', 'CEB (kWh)', 'Gen (kWh)', 'Total', 'Gen %', 'Switchovers'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.daily_breakdown?.map((d: any) => (
                    <tr key={d.date} className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{d.date}</td>
                      <td className="px-4 py-3">{parseFloat(d.ceb_kwh).toFixed(1)}</td>
                      <td className="px-4 py-3">{parseFloat(d.generator_kwh).toFixed(1)}</td>
                      <td className="px-4 py-3 font-bold text-blue-600 dark:text-blue-400">{parseFloat(d.total_kwh).toFixed(1)}</td>
                      <td className={`px-4 py-3 font-semibold ${parseFloat(d.generator_percentage) > 20 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {d.generator_percentage}%
                      </td>
                      <td className="px-4 py-3">{d.switchovers > 0 ? <span className="badge-warning">{d.switchovers}</span> : '-'}</td>
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
