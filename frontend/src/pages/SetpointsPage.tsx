import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { alertsApi } from '../services/api';
import { fmt } from '../utils/formatters';
import { Settings, Save, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { Navigate, Link } from 'react-router-dom';
import type { AlertSetpoint } from '../types';

function Row({ sp, onSave }: { sp: AlertSetpoint; onSave: (type: string, data: object) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    min_value: sp.min_value?.toString() ?? '',
    max_value: sp.max_value?.toString() ?? '',
    enabled: sp.enabled,
    email_notify: sp.email_notify,
  });

  const save = () => {
    onSave(sp.alert_type, {
      min_value: form.min_value !== '' ? parseFloat(form.min_value) : null,
      max_value: form.max_value !== '' ? parseFloat(form.max_value) : null,
      enabled: form.enabled,
      email_notify: form.email_notify,
    });
    setEditing(false);
  };

  return (
    <tr className="border-b border-gray-200 dark:border-gray-800/50">
      <td className="px-4 py-3"><p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{sp.label}</p><p className="text-xs text-gray-500">{sp.alert_type}</p></td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">{sp.unit ?? '—'}</td>
      <td className="px-4 py-3">{editing ? <input type="number" step="any" className="input w-24 text-sm" value={form.min_value} onChange={(e) => setForm({ ...form, min_value: e.target.value })} /> : <span className="text-gray-700 dark:text-gray-300 text-sm">{sp.min_value ?? '—'}</span>}</td>
      <td className="px-4 py-3">{editing ? <input type="number" step="any" className="input w-24 text-sm" value={form.max_value} onChange={(e) => setForm({ ...form, max_value: e.target.value })} /> : <span className="text-gray-700 dark:text-gray-300 text-sm">{sp.max_value ?? '—'}</span>}</td>
      <td className="px-4 py-3">{editing ? <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-4 h-4 accent-primary-500" /> : (sp.enabled ? <span className="badge-success">Yes</span> : <span className="text-gray-500 text-xs">No</span>)}</td>
      <td className="px-4 py-3">{editing ? <input type="checkbox" checked={form.email_notify} onChange={(e) => setForm({ ...form, email_notify: e.target.checked })} className="w-4 h-4 accent-primary-500" /> : (sp.email_notify ? <span className="badge-success">Yes</span> : <span className="text-gray-500 text-xs">No</span>)}</td>
      <td className="px-4 py-3 text-gray-500 text-xs">{fmt.datetime(sp.updated_at)}</td>
      <td className="px-4 py-3">
        {editing
          ? <div className="flex gap-2"><button onClick={save} className="btn-primary text-xs py-1 px-3 flex items-center gap-1"><Save className="w-3 h-3" />Save</button><button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1 px-2">×</button></div>
          : <button onClick={() => setEditing(true)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Edit</button>}
      </td>
    </tr>
  );
}

export default function SetpointsPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;

  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['setpoints'], queryFn: () => alertsApi.getSetpoints().then((r) => r.data) });

  const update = useMutation({
    mutationFn: ({ type, data }: { type: string; data: object }) => alertsApi.updateSetpoint(type, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['setpoints'] }); toast.success('Setpoint updated'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Update failed'),
  });

  return (
    <div className="space-y-5">
      <div className="card">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-1"><Settings className="w-4 h-4 text-primary-600 dark:text-primary-400" />Alert Setpoints</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">Configure the global thresholds below - they apply to every meter that doesn't have its own override. Changes take effect within 1 minute.</p>
      </div>

      <Link to="/device-settings" state={{ tab: 'setpoints' }}
        className="card flex items-center justify-between hover:border-primary-500 dark:hover:border-primary-500 transition-colors group">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Need different thresholds for a specific meter?</p>
          <p className="text-xs text-gray-500 mt-0.5">Set a per-device override in Device Settings → Device Setpoints - it takes priority over the global setpoint above for that meter only.</p>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400 flex-shrink-0 ml-3" />
      </Link>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 dark:border-gray-800">{['Alert Type','Unit','Min Value','Max Value','Enabled','Email Alert','Updated',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {isLoading
                ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                : (data?.setpoints ?? []).map((sp: AlertSetpoint) => (
                  <Row key={sp.alert_type} sp={sp} onSave={(type, d) => update.mutate({ type, data: d })} />
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700/30">
        <h4 className="text-sm font-medium text-yellow-700 dark:text-yellow-300 mb-2">Setpoint Guide</h4>
        <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
          <li><strong className="text-gray-700 dark:text-gray-300">Over Voltage</strong> — Max: alert fires if avg phase voltage exceeds this</li>
          <li><strong className="text-gray-700 dark:text-gray-300">Low Voltage</strong> — Min: alert fires if avg phase voltage drops below this</li>
          <li><strong className="text-gray-700 dark:text-gray-300">Low Power Factor</strong> — Min: alert fires if PF drops below this (0–1)</li>
          <li><strong className="text-gray-700 dark:text-gray-300">High KVA</strong> — Max: alert fires if apparent power exceeds this</li>
          <li><strong className="text-gray-700 dark:text-gray-300">Power Interruption</strong> — No threshold; fires on CEB→Generator switch</li>
        </ul>
      </div>
    </div>
  );
}
