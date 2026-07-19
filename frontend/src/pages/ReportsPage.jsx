import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import { fmt, downloadBlob } from '../utils/formatters';
import { FileDown, FileText, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

const REPORT_TYPES = [
  { value: 'energy_daily',      label: 'Daily Energy Consumption',    desc: 'kWh by day, CEB vs Generator, Day/Peak/Off-Peak' },
  { value: 'energy_monthly',    label: 'Monthly Energy Consumption',  desc: 'Monthly aggregates with demand & PF' },
  { value: 'diesel_daily',      label: 'Daily Diesel Consumption',    desc: 'Liters used & generator run hours per day' },
  { value: 'diesel_monthly',    label: 'Monthly Diesel Consumption',  desc: 'Monthly diesel totals' },
  { value: 'power_quality',     label: 'Power Quality Report',        desc: 'Voltage, Current, Power, KVA, PF readings' },
  { value: 'power_interruption',label: 'Power Interruption Report',   desc: 'All interruption events with duration' },
  { value: 'consumption_summary','label': 'Full Consumption Summary',  desc: 'Energy + Diesel in one workbook' },
];

export default function ReportsPage() {
  const [form, setForm] = useState({
    type: 'energy_daily',
    period_start: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
    period_end: new Date().toISOString().split('T')[0],
    format: 'excel',
  });

  const { data: historyData } = useQuery({
    queryKey: ['report-history'],
    queryFn: () => reportsApi.getHistory().then((r) => r.data),
  });

  const generateMutation = useMutation({
    mutationFn: (data) => reportsApi.generate(data),
    onSuccess: (res, variables) => {
      const ext = variables.format === 'excel' ? 'xlsx' : 'pdf';
      const filename = `${variables.type}_${variables.period_start}_to_${variables.period_end}.${ext}`;
      downloadBlob(res.data, filename);
      toast.success('Report downloaded');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Report generation failed'),
  });

  const selectedType = REPORT_TYPES.find((t) => t.value === form.type);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Report Builder */}
        <div className="lg:col-span-2 card space-y-5">
          <h3 className="font-semibold text-gray-200 flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary-400" /> Generate Report
          </h3>

          <div>
            <label className="label">Report Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
              {REPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {selectedType && (
              <p className="mt-1.5 text-xs text-gray-500">{selectedType.desc}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Period Start</label>
              <input type="date" className="input" value={form.period_start}
                onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
            </div>
            <div>
              <label className="label">Period End</label>
              <input type="date" className="input" value={form.period_end}
                onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label">Export Format</label>
            <div className="flex gap-3">
              {[
                { value: 'excel', label: 'Excel (.xlsx)', color: 'text-green-400' },
                { value: 'pdf', label: 'PDF', color: 'text-red-400' },
              ].map(({ value, label, color }) => (
                <label key={value} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors
                  ${form.format === value
                    ? 'bg-primary-800/40 border-primary-600'
                    : 'border-gray-700 hover:border-gray-600'}`}>
                  <input type="radio" name="format" value={value} checked={form.format === value}
                    onChange={() => setForm({ ...form, format: value })} className="hidden" />
                  <span className={`font-medium text-sm ${color}`}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={() => generateMutation.mutate(form)}
            disabled={generateMutation.isPending}
            className="btn-primary flex items-center gap-2">
            <FileDown className="w-4 h-4" />
            {generateMutation.isPending ? 'Generating…' : 'Download Report'}
          </button>
        </div>

        {/* Quick Presets */}
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-200 text-sm">Quick Reports</h3>
          {[
            { label: 'Yesterday Energy', type: 'energy_daily', days: 1 },
            { label: 'Last 7 Days Energy', type: 'energy_daily', days: 7 },
            { label: 'Last 30 Days Diesel', type: 'diesel_daily', days: 30 },
            { label: 'This Year Monthly', type: 'energy_monthly', year: true },
            { label: 'Power Quality (7d)', type: 'power_quality', days: 7 },
            { label: 'Interruptions (30d)', type: 'power_interruption', days: 30 },
          ].map(({ label, type, days, year }) => (
            <button key={label} onClick={() => {
              const end = new Date().toISOString().split('T')[0];
              const start = year
                ? `${new Date().getFullYear()}-01-01`
                : new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
              generateMutation.mutate({ type, period_start: start, period_end: end, format: 'excel' });
            }}
              disabled={generateMutation.isPending}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors border border-gray-800 hover:border-gray-700">
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="card overflow-hidden p-0">
        <div className="p-4 border-b border-gray-800 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <h3 className="font-semibold text-gray-200">Report History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Generated At', 'Type', 'Period', 'Format', 'By', 'Auto'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(historyData?.reports || []).length === 0
                ? <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No reports generated yet</td></tr>
                : (historyData?.reports || []).map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmt.datetime(r.created_at)}</td>
                    <td className="px-4 py-3 text-gray-200">{r.report_type?.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {r.period_start && `${fmt.date(r.period_start)} — ${fmt.date(r.period_end)}`}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${r.format === 'excel' ? 'text-green-400' : 'text-red-400'}`}>
                        {r.format?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.generated_by_name || '—'}</td>
                    <td className="px-4 py-3">
                      {r.auto_generated && <span className="badge-info">Auto</span>}
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
