import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { alertsApi } from '../services/api';
import { fmt } from '../utils/formatters';
import { Settings, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

function SetpointRow({ sp, onSave }) {
  const [form, setForm] = useState({
    min_value: sp.min_value ?? '',
    max_value: sp.max_value ?? '',
    enabled: sp.enabled,
    email_notify: sp.email_notify,
  });
  const [editing, setEditing] = useState(false);

  const handleSave = () => {
    onSave(sp.alert_type, {
      min_value: form.min_value !== '' ? parseFloat(form.min_value) : null,
      max_value: form.max_value !== '' ? parseFloat(form.max_value) : null,
      enabled: form.enabled,
      email_notify: form.email_notify,
    });
    setEditing(false);
  };

  return (
    <tr className="border-b border-gray-800/50">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-200">{sp.label}</p>
        <p className="text-xs text-gray-500">{sp.alert_type}</p>
      </td>
      <td className="px-4 py-3 text-gray-400">{sp.unit || '—'}</td>
      <td className="px-4 py-3">
        {editing
          ? <input type="number" step="any" className="input w-24"
              value={form.min_value} onChange={(e) => setForm({ ...form, min_value: e.target.value })} />
          : <span className="text-gray-300">{sp.min_value ?? '—'}</span>
        }
      </td>
      <td className="px-4 py-3">
        {editing
          ? <input type="number" step="any" className="input w-24"
              value={form.max_value} onChange={(e) => setForm({ ...form, max_value: e.target.value })} />
          : <span className="text-gray-300">{sp.max_value ?? '—'}</span>
        }
      </td>
      <td className="px-4 py-3">
        {editing
          ? <input type="checkbox" checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="w-4 h-4 accent-primary-500" />
          : sp.enabled
            ? <span className="badge-success">Enabled</span>
            : <span className="text-gray-500 text-xs">Disabled</span>
        }
      </td>
      <td className="px-4 py-3">
        {editing
          ? <input type="checkbox" checked={form.email_notify}
              onChange={(e) => setForm({ ...form, email_notify: e.target.checked })}
              className="w-4 h-4 accent-primary-500" />
          : sp.email_notify
            ? <span className="badge-success">Yes</span>
            : <span className="text-gray-500 text-xs">No</span>
        }
      </td>
      <td className="px-4 py-3 text-gray-500 text-xs">{fmt.datetime(sp.updated_at)}</td>
      <td className="px-4 py-3">
        {editing
          ? <div className="flex gap-2">
              <button onClick={handleSave} className="btn-primary text-xs py-1 px-3 flex items-center gap-1">
                <Save className="w-3.5 h-3.5" /> Save
              </button>
              <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1 px-3">Cancel</button>
            </div>
          : <button onClick={() => setEditing(true)}
              className="text-xs text-primary-400 hover:text-primary-300 hover:underline">Edit</button>
        }
      </td>
    </tr>
  );
}

export default function SetpointsPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;

  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['setpoints'],
    queryFn: () => alertsApi.getSetpoints().then((r) => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ type, data }) => alertsApi.updateSetpoint(type, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['setpoints'] });
      toast.success('Setpoint updated');
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Update failed'),
  });

  const setpoints = data?.setpoints || [];

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Settings className="w-5 h-5 text-primary-400" />
          <h3 className="font-semibold text-gray-200">Alert Setpoints</h3>
        </div>
        <p className="text-sm text-gray-400">
          Configure thresholds for automatic alert generation and email notifications.
          Min value = lower limit (triggers if reading goes below), Max value = upper limit.
        </p>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Alert Type', 'Unit', 'Min Value', 'Max Value', 'Enabled', 'Email Alert', 'Last Updated', 'Action'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                : setpoints.map((sp) => (
                  <SetpointRow key={sp.alert_type} sp={sp}
                    onSave={(type, data) => updateMutation.mutate({ type, data })} />
                ))
              }
            </tbody>
          </table>
        </div>
      </div>

      <div className="card bg-yellow-900/20 border-yellow-700/30">
        <h4 className="text-sm font-medium text-yellow-300 mb-2">Setpoint Guide</h4>
        <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
          <li><strong className="text-gray-300">Over Voltage</strong> — Max value: triggers if average phase voltage exceeds this (V)</li>
          <li><strong className="text-gray-300">Low Voltage</strong> — Min value: triggers if average phase voltage drops below this (V)</li>
          <li><strong className="text-gray-300">Low Power Factor</strong> — Min value: triggers if PF drops below this (0–1)</li>
          <li><strong className="text-gray-300">High KVA</strong> — Max value: triggers if apparent power exceeds this (kVA)</li>
          <li><strong className="text-gray-300">Power Interruption</strong> — No threshold; triggers on source switch CEB → Generator</li>
        </ul>
      </div>
    </div>
  );
}
