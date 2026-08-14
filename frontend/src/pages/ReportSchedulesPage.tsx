import { useState, useEffect, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi, settingsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { fmt } from '../utils/formatters';
import { Clock, Mail, UserPlus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Plant, ReportScheduleRecipient } from '../types';

const REPORTS = [
  { value: 'energy_daily',        label: 'Daily Energy Consumption' },
  { value: 'energy_monthly',      label: 'Monthly Energy Consumption' },
  { value: 'diesel_daily',        label: 'Daily Diesel Consumption' },
  { value: 'diesel_monthly',      label: 'Monthly Diesel Consumption' },
  { value: 'power_quality',       label: 'Power Quality Report' },
  { value: 'power_interruption',  label: 'Power Interruption Report' },
  { value: 'consumption_summary', label: 'Full Consumption Summary' },
];

function ScheduleCard({ schedule, plants, onSave, saving }: {
  schedule: { frequency: 'daily' | 'monthly'; enabled: boolean; report_type: string; format: string; plant_id: string | null };
  plants: Plant[];
  onSave: (data: object) => void;
  saving: boolean;
}) {
  const [f, setF] = useState({
    enabled: schedule.enabled, report_type: schedule.report_type,
    format: schedule.format, plant_id: schedule.plant_id ?? '',
  });
  useEffect(() => {
    setF({ enabled: schedule.enabled, report_type: schedule.report_type, format: schedule.format, plant_id: schedule.plant_id ?? '' });
  }, [schedule]);

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          Enabled
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Report Type (attachment)</label>
          <select value={f.report_type} onChange={(e) => setF({ ...f, report_type: e.target.value })} className="input text-sm">
            {REPORTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Format</label>
          <select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} className="input text-sm">
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
        <div>
          <label className="label">Plant</label>
          <select value={f.plant_id} onChange={(e) => setF({ ...f, plant_id: e.target.value })} className="input text-sm">
            <option value="">All Plants</option>
            {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {schedule.frequency === 'daily' ? 'Runs at 00:10 for the previous day.' : 'Runs at 06:00 on the 1st for the previous month.'}
        {' '}Email body includes a P1 and P4 summary; the report above is attached in full.
      </p>
      <button onClick={() => onSave(f)} disabled={saving} className="btn-primary text-sm py-1.5 px-4">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function RecipientList({ frequency }: { frequency: 'daily' | 'monthly' }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['schedule-recipients', frequency],
    queryFn: () => reportsApi.getScheduleRecipients(frequency).then((r) => r.data),
  });
  const recipients: ReportScheduleRecipient[] = data?.recipients ?? [];

  const [form, setForm] = useState({ name: '', email: '' });
  const addMutation = useMutation({
    mutationFn: () => reportsApi.addScheduleRecipient(frequency, { email: form.email, name: form.name || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-recipients', frequency] });
      toast.success('Recipient added');
      setForm({ name: '', email: '' });
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Could not add recipient'),
  });
  const handleAdd = (e: FormEvent) => { e.preventDefault(); addMutation.mutate(); };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportsApi.deleteScheduleRecipient(frequency, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schedule-recipients', frequency] }); toast.success('Recipient removed'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Delete failed'),
  });
  const handleDelete = (r: ReportScheduleRecipient) => {
    if (confirm(`Remove ${r.email} from the ${frequency} report list?`)) deleteMutation.mutate(r.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Recipients</p>
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

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {isLoading ? (
              <tr><td className="px-3 py-4 text-center text-gray-500 text-xs">Loading…</td></tr>
            ) : recipients.length === 0 ? (
              <tr><td className="px-3 py-4 text-center text-gray-500 text-xs">No recipients yet — this schedule won't send until one is added.</td></tr>
            ) : recipients.map((r) => (
              <tr key={r.id} className="border-b border-gray-200 dark:border-gray-800/50 last:border-0 hover:bg-gray-100 dark:hover:bg-gray-800/20">
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{r.name || '—'}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.email}</td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{fmt.date(r.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => handleDelete(r)} disabled={deleteMutation.isPending}
                    className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    title="Remove recipient">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReportSchedulesPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;

  const qc = useQueryClient();
  const { data: schedulesData } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => reportsApi.getSchedules().then((r) => r.data),
  });
  const { data: plantsData } = useQuery({
    queryKey: ['plants'],
    queryFn: () => settingsApi.getPlants().then((r) => r.data),
  });
  const plants: Plant[] = plantsData?.plants ?? [];
  const schedules = schedulesData?.schedules ?? [];

  const scheduleMutation = useMutation({
    mutationFn: ({ frequency, data }: { frequency: string; data: object }) => reportsApi.updateSchedule(frequency, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['report-schedules'] }); toast.success('Schedule saved'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Save failed'),
  });

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Report Schedules</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure the automated daily and monthly report emails. Each email body summarizes every plant section (e.g. P1, P4) separately, with the full report attached. Daily and monthly schedules have independent recipient lists.
        </p>
      </div>

      {(['daily', 'monthly'] as const).map((freq) => {
        const schedule = schedules.find((s: any) => s.frequency === freq);
        return (
          <div key={freq} className="card space-y-4">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200 capitalize">{freq} Report</h3>
            {schedule && (
              <ScheduleCard schedule={schedule} plants={plants}
                onSave={(data) => scheduleMutation.mutate({ frequency: freq, data })}
                saving={scheduleMutation.isPending} />
            )}
            <RecipientList frequency={freq} />
          </div>
        );
      })}
    </div>
  );
}
