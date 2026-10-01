import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Activity, Mail, UserPlus, Trash2, Pencil, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { deviceMonitorApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { fmt } from '../utils/formatters';
import type { MonitoredDevice, OfflineAlertRecipient } from '../types';

const SECTION_LABELS: Record<string, string> = { P1: 'Plant 1', P4: 'Plant 4' };

function ago(ts: string | null): string {
  if (!ts) return 'Never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  return mins < 1 ? 'just now' : `${fmt.duration(mins)} ago`;
}

function DeviceStatusTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['device-monitor-status'],
    queryFn: () => deviceMonitorApi.getStatus().then((r) => r.data),
    refetchInterval: 30_000,
  });
  const devices: MonitoredDevice[] = data?.devices ?? [];
  const offlineCount = devices.filter((d) => d.offline).length;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200">Device Status</h3>
        {!isLoading && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${offlineCount ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'}`}>
            {offlineCount ? `${offlineCount} offline` : 'All online'} · {devices.length} devices
          </span>
        )}
      </div>
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/40 text-left text-xs text-gray-500">
              {['Status', 'Plant', 'Device', 'Type', 'Device ID', 'Last Seen'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-500 text-xs">Loading…</td></tr>
            ) : devices.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-500 text-xs">No devices with an MQTT device ID are registered.</td></tr>
            ) : devices.map((d) => (
              <tr key={d.device_id} className="border-t border-gray-200 dark:border-gray-800/50">
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${d.offline ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    <span className={`w-2 h-2 rounded-full ${d.offline ? 'bg-red-500' : 'bg-green-500'}`} />
                    {d.offline ? 'Offline' : 'Online'}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{(d.plant_section && SECTION_LABELS[d.plant_section]) || d.plant_section || '—'}</td>
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{d.name}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{d.kind}</td>
                <td className="px-3 py-2 text-gray-500 font-mono text-xs">{d.device_id}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap" title={d.last_seen_at ? fmt.datetime(d.last_seen_at) : undefined}>{ago(d.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecipientRow({ r }: { r: OfflineAlertRecipient }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: r.name ?? '', email: r.email });

  const updateMutation = useMutation({
    mutationFn: () => deviceMonitorApi.updateRecipient(r.id, { email: form.email, name: form.name || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['offline-recipients'] }); toast.success('Recipient updated'); setEditing(false); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Update failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deviceMonitorApi.deleteRecipient(r.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['offline-recipients'] }); toast.success('Recipient removed'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Delete failed'),
  });

  const iconBtn = 'p-1.5 text-gray-500 rounded transition-colors';
  if (editing) {
    return (
      <tr className="border-b border-gray-200 dark:border-gray-800/50 last:border-0">
        <td className="px-3 py-2"><input className="input text-sm" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></td>
        <td className="px-3 py-2"><input type="email" className="input text-sm" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></td>
        <td />
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className={`${iconBtn} hover:text-green-600 hover:bg-green-500/10`} title="Save"><Check className="w-3.5 h-3.5" /></button>
          <button onClick={() => { setEditing(false); setForm({ name: r.name ?? '', email: r.email }); }} className={`${iconBtn} hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-500/10`} title="Cancel"><X className="w-3.5 h-3.5" /></button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800/50 last:border-0 hover:bg-gray-100 dark:hover:bg-gray-800/20">
      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.name || '—'}</td>
      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.email}</td>
      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{fmt.date(r.created_at)}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button onClick={() => setEditing(true)} className={`${iconBtn} hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-500/10`} title="Edit recipient"><Pencil className="w-3.5 h-3.5" /></button>
        <button onClick={() => { if (confirm(`Remove ${r.email} from device offline alerts?`)) deleteMutation.mutate(); }} disabled={deleteMutation.isPending}
          className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10`} title="Remove recipient"><Trash2 className="w-3.5 h-3.5" /></button>
      </td>
    </tr>
  );
}

function RecipientList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['offline-recipients'],
    queryFn: () => deviceMonitorApi.getRecipients().then((r) => r.data),
  });
  const recipients: OfflineAlertRecipient[] = data?.recipients ?? [];

  const [form, setForm] = useState({ name: '', email: '' });
  const addMutation = useMutation({
    mutationFn: () => deviceMonitorApi.addRecipient({ email: form.email, name: form.name || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['offline-recipients'] }); toast.success('Recipient added'); setForm({ name: '', email: '' }); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Could not add recipient'),
  });
  const handleAdd = (e: FormEvent) => { e.preventDefault(); addMutation.mutate(); };

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        <h3 className="font-semibold text-gray-800 dark:text-gray-200">Alert Email Recipients</h3>
        <span className="text-xs text-gray-500">({recipients.length})</span>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Name (optional)</label>
          <input type="text" className="input text-sm" placeholder="Jane Doe"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input text-sm" placeholder="jane@factory.com" required
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <button type="submit" className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5" disabled={addMutation.isPending}>
          <UserPlus className="w-3.5 h-3.5" />
          {addMutation.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {isLoading ? (
              <tr><td className="px-3 py-4 text-center text-gray-500 text-xs">Loading…</td></tr>
            ) : recipients.length === 0 ? (
              <tr><td className="px-3 py-4 text-center text-gray-500 text-xs">No recipients yet — offline alerts won't be emailed until one is added.</td></tr>
            ) : recipients.map((r) => <RecipientRow key={r.id} r={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DeviceMonitorPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Device Monitor</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Any energy meter, flow meter or power status sensor that sends no data for more than 15 minutes is flagged offline,
          logged under Alerts, and emailed to the recipients below. A follow-up email is sent when it comes back online.
        </p>
      </div>
      <RecipientList />
      <DeviceStatusTable />
    </div>
  );
}
