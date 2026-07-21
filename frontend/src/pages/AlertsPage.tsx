import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { alertsApi } from '../services/api';
import { usePlant } from '../context/PlantContext';
import { fmt } from '../utils/formatters';
import { Check, CheckCheck, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Alert } from '../types';

const SEVERITY_CLS: Record<string, string> = {
  critical: 'badge-critical',
  warning: 'badge-warning',
  info: 'badge-info',
};

const TYPE_OPTS = [
  { value: '', label: 'All Types' },
  { value: 'over_voltage', label: 'Over Voltage' },
  { value: 'low_voltage', label: 'Low Voltage' },
  { value: 'low_power_factor', label: 'Low Power Factor' },
  { value: 'high_kva', label: 'High KVA' },
  { value: 'high_third_harmonic', label: 'High 3rd Harmonic' },
  { value: 'power_interruption', label: 'Power Interruption' },
  { value: 'power_restored', label: 'Power Restored' },
];

export default function AlertsPage() {
  const qc = useQueryClient();
  const { selectedPlantId } = usePlant();
  const [filters, setFilters] = useState({ type: '', acknowledged: '', limit: '100' });

  const { data, isLoading } = useQuery({
    queryKey: ['alerts', filters, selectedPlantId],
    queryFn: () => alertsApi.getAll({
      type: filters.type || undefined,
      acknowledged: filters.acknowledged !== '' ? filters.acknowledged : undefined,
      plant_id: selectedPlantId ?? undefined,
      limit: filters.limit,
    }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['alert-stats', selectedPlantId],
    queryFn: () => alertsApi.getStats(selectedPlantId ? { plant_id: selectedPlantId } : {}).then((r) => r.data),
    refetchInterval: 60000,
  });

  const ackOne = useMutation({
    mutationFn: (id: number) => alertsApi.acknowledge(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success('Acknowledged'); },
  });
  const ackAll = useMutation({
    mutationFn: () => alertsApi.acknowledgeAll(),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success(res.data?.message ?? 'Done'); },
  });

  const alerts: Alert[] = data?.alerts ?? [];
  const stats = statsData?.stats ?? [];
  const unack = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Shown', value: alerts.length, color: 'text-gray-700 dark:text-gray-300' },
          { label: 'Unacknowledged', value: unack, color: 'text-red-600 dark:text-red-400' },
          { label: 'Critical (30d)', value: stats.filter((s: any) => s.severity === 'critical').reduce((a: number, b: any) => a + +b.total, 0), color: 'text-red-600 dark:text-red-400' },
          { label: 'Warning (30d)', value: stats.filter((s: any) => s.severity === 'warning').reduce((a: number, b: any) => a + +b.total, 0), color: 'text-yellow-600 dark:text-yellow-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card"><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p></div>
        ))}
      </div>

      <div className="card flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-gray-500 flex-shrink-0" />
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className="input w-44 text-sm">
          {TYPE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.acknowledged} onChange={(e) => setFilters({ ...filters, acknowledged: e.target.value })} className="input w-40 text-sm">
          <option value="">All Status</option>
          <option value="false">Unacknowledged</option>
          <option value="true">Acknowledged</option>
        </select>
        <select value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: e.target.value })} className="input w-24 text-sm">
          {['50','100','200','500'].map((n) => <option key={n}>{n}</option>)}
        </select>
        {unack > 0 && (
          <button onClick={() => ackAll.mutate()} disabled={ackAll.isPending}
            className="btn-secondary flex items-center gap-2 text-sm ml-auto">
            <CheckCheck className="w-4 h-4" /> Acknowledge All ({unack})
          </button>
        )}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">
                {['Time','Plant','Meter','Type','Severity','Message','Value','Setpoint','Status',''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                : alerts.length === 0
                ? <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No alerts found</td></tr>
                : alerts.map((a) => (
                  <tr key={a.id} className={`border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20 transition-colors ${!a.acknowledged && a.severity === 'critical' ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{fmt.datetime(a.created_at)}</td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 text-xs">{a.plant_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs">{a.meter_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 text-xs font-medium whitespace-nowrap">{a.alert_type.replace(/_/g,' ')}</td>
                    <td className="px-4 py-2.5"><span className={SEVERITY_CLS[a.severity] ?? 'badge-info'}>{a.severity}</span></td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 text-xs max-w-xs truncate">{a.message}</td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">{a.value ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{a.setpoint_value ?? '—'}</td>
                    <td className="px-4 py-2.5">{a.acknowledged ? <span className="badge-success">Ack'd</span> : <span className="badge-warning">Open</span>}</td>
                    <td className="px-4 py-2.5">
                      {!a.acknowledged && (
                        <button onClick={() => ackOne.mutate(a.id)} disabled={ackOne.isPending}
                          className="p-1 text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 rounded transition-colors">
                          <Check className="w-4 h-4" />
                        </button>
                      )}
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
