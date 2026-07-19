import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { alertsApi } from '../services/api';
import { fmt } from '../utils/formatters';
import { CheckCheck, Check, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

const SEVERITY_BADGE = {
  critical: 'badge-critical',
  warning: 'badge-warning',
  info: 'badge-info',
};

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'over_voltage', label: 'Over Voltage' },
  { value: 'low_voltage', label: 'Low Voltage' },
  { value: 'low_power_factor', label: 'Low Power Factor' },
  { value: 'high_kva', label: 'High KVA' },
  { value: 'power_interruption', label: 'Power Interruption' },
  { value: 'power_restored', label: 'Power Restored' },
];

export default function AlertsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ type: '', acknowledged: '', limit: 100 });

  const { data, isLoading } = useQuery({
    queryKey: ['alerts', filters],
    queryFn: () => alertsApi.getAll({
      type: filters.type || undefined,
      acknowledged: filters.acknowledged !== '' ? filters.acknowledged : undefined,
      limit: filters.limit,
    }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['alert-stats'],
    queryFn: () => alertsApi.getStats().then((r) => r.data),
    refetchInterval: 60000,
  });

  const ackMutation = useMutation({
    mutationFn: (id) => alertsApi.acknowledge(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      toast.success('Alert acknowledged');
    },
  });

  const ackAllMutation = useMutation({
    mutationFn: () => alertsApi.acknowledgeAll(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      toast.success(res.data?.message || 'All alerts acknowledged');
    },
  });

  const alerts = data?.alerts || [];
  const stats = statsData?.stats || [];
  const unackCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Alerts', value: alerts.length, color: 'text-gray-300' },
          { label: 'Unacknowledged', value: unackCount, color: 'text-red-400' },
          { label: 'Critical (30d)', value: stats.filter((s) => s.severity === 'critical').reduce((a, b) => a + +b.total, 0), color: 'text-red-400' },
          { label: 'Warning (30d)', value: stats.filter((s) => s.severity === 'warning').reduce((a, b) => a + +b.total, 0), color: 'text-yellow-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters + Actions */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            className="input w-44">
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select value={filters.acknowledged}
            onChange={(e) => setFilters({ ...filters, acknowledged: e.target.value })}
            className="input w-44">
            <option value="">All Status</option>
            <option value="false">Unacknowledged</option>
            <option value="true">Acknowledged</option>
          </select>

          <select value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: +e.target.value })}
            className="input w-28">
            {[50, 100, 200, 500].map((n) => <option key={n}>{n}</option>)}
          </select>

          <div className="ml-auto">
            {unackCount > 0 && (
              <button onClick={() => ackAllMutation.mutate()}
                disabled={ackAllMutation.isPending}
                className="btn-secondary flex items-center gap-2 text-sm">
                <CheckCheck className="w-4 h-4" />
                Acknowledge All ({unackCount})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Time', 'Type', 'Severity', 'Message', 'Value', 'Setpoint', 'Source', 'Status', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : alerts.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No alerts found</td></tr>
              ) : alerts.map((a) => (
                <tr key={a.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors
                  ${!a.acknowledged && a.severity === 'critical' ? 'bg-red-900/10' : ''}`}>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmt.datetime(a.created_at)}</td>
                  <td className="px-4 py-3 text-gray-200 whitespace-nowrap font-medium">
                    {a.alert_type?.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={SEVERITY_BADGE[a.severity] || 'badge-info'}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 max-w-xs truncate">{a.message}</td>
                  <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{a.value ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{a.setpoint_value ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{a.source || '—'}</td>
                  <td className="px-4 py-3">
                    {a.acknowledged
                      ? <span className="badge-success">Ack'd</span>
                      : <span className="badge-warning">Open</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {!a.acknowledged && (
                      <button onClick={() => ackMutation.mutate(a.id)}
                        disabled={ackMutation.isPending}
                        className="p-1.5 text-gray-500 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors">
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
