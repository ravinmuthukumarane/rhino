import { useState, useEffect, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { fmt } from '../utils/formatters';
import { Clock, Mail, UserPlus, Trash2, Send, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ReportSchedule, ReportScheduleRecipient } from '../types';

const REPORTS = [
  { value: 'energy_daily',        label: 'Daily Energy Consumption' },
  { value: 'energy_monthly',      label: 'Monthly Energy Consumption' },
  { value: 'diesel_daily',        label: 'Daily Diesel Consumption' },
  { value: 'diesel_monthly',      label: 'Monthly Diesel Consumption' },
  { value: 'power_quality',       label: 'Power Quality Report' },
  { value: 'power_interruption',  label: 'Power Interruption Report' },
  { value: 'consumption_summary', label: 'Full Consumption Summary' },
  { value: 'all_combined',        label: 'All Reports (multi-tab)' },
];

const SECTIONS = [
  { value: '',   label: 'All Plants (P1 + P4)' },
  { value: 'P1', label: 'Plant 1' },
  { value: 'P4', label: 'Plant 4' },
];

const reportLabel = (v: string) => REPORTS.find((r) => r.value === v)?.label ?? v;
const plantLabel = (v: string | null) => SECTIONS.find((s) => s.value === (v ?? ''))?.label ?? v ?? '';
const ordinal = (n: number) => `${n}${[, 'st', 'nd', 'rd'][n % 100 >> 3 ^ 1 && n % 10] || 'th'}`;
const whenLabel = (s: Pick<ReportSchedule, 'frequency' | 'send_day' | 'send_time'>) =>
  s.frequency === 'daily' ? `Every day at ${s.send_time}` : `${ordinal(s.send_day)} of every month at ${s.send_time}`;
// Times are Sri Lanka time regardless of the viewer's browser timezone.
const istDateTime = (v: string | null) => v
  ? new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';
const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-green-500/10 text-green-700 dark:text-green-400',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
  skipped: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
};

function SavedSchedulesTable({ schedules, onSendNow, sending }: {
  schedules: ReportSchedule[]; onSendNow: (f: string) => void; sending: string | null;
}) {
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-gray-800 dark:text-gray-200">Saved Schedules</h3>
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/40 text-left text-xs text-gray-500">
              {['Schedule', 'Status', 'Email Report Type', 'Plant', 'Format', 'Sends', 'Recipients', 'Last Send', 'Next Send', 'Last Saved', ''].map((h) =>
                <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {schedules.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-4 text-center text-gray-500 text-xs">Loading…</td></tr>
            ) : schedules.map((s) => (
              <tr key={s.frequency} className="border-t border-gray-200 dark:border-gray-800/50 align-top">
                <td className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-200 capitalize">{s.frequency}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.enabled ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-gray-500/10 text-gray-500'}`}>
                    {s.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{reportLabel(s.report_type)}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{plantLabel(s.plant_section)}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400 uppercase text-xs">{s.format}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{whenLabel(s)}</td>
                <td className={`px-3 py-2 ${s.recipient_count ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>{s.recipient_count}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {s.last_status ? (
                    <div className="space-y-0.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[s.last_status] ?? ''}`}>{s.last_status}</span>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{s.last_period}</p>
                      <p className="text-xs text-gray-500">{istDateTime(s.last_run_at)}</p>
                      {s.last_message && <p className="text-xs text-gray-500 max-w-[220px] whitespace-normal">{s.last_message}</p>}
                    </div>
                  ) : <span className="text-gray-500 text-xs">Never</span>}
                </td>
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200 whitespace-nowrap">{s.enabled ? istDateTime(s.next_send_at) : <span className="text-gray-500 text-xs">Disabled</span>}</td>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {istDateTime(s.updated_at)}{s.updated_by_name && <><br />by {s.updated_by_name}</>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <a href={`#schedule-${s.frequency}`} className="p-1.5 inline-flex text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-500/10 rounded" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </a>
                  <button onClick={() => onSendNow(s.frequency)} disabled={sending !== null}
                    className="p-1.5 inline-flex text-gray-500 hover:text-green-600 hover:bg-green-500/10 rounded disabled:opacity-50" title="Send now">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">All times are Sri Lanka time. Daily reports cover the previous day; monthly reports cover the previous calendar month. "Send now" emails the most recent period immediately without changing the next scheduled send.</p>
    </div>
  );
}

function ScheduleCard({ schedule, onSave, saving }: {
  schedule: ReportSchedule;
  onSave: (data: object) => void;
  saving: boolean;
}) {
  const fromSchedule = (s: ReportSchedule) => ({
    enabled: s.enabled, report_type: s.report_type, format: s.format as string,
    plant_id: s.plant_id ?? '', plant_section: s.plant_section ?? '',
    send_day: s.send_day ?? 1, send_time: s.send_time ?? (s.frequency === 'daily' ? '00:10' : '06:00'),
  });
  const [f, setF] = useState(fromSchedule(schedule));
  useEffect(() => { setF(fromSchedule(schedule)); }, [schedule]);

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
          <select value={f.plant_section} onChange={(e) => setF({ ...f, plant_section: e.target.value })} className="input text-sm">
            {SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {schedule.frequency === 'monthly' && (
          <div>
            <label className="label">Day of Month</label>
            <select value={f.send_day} onChange={(e) => setF({ ...f, send_day: Number(e.target.value) })} className="input text-sm">
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Send Time (Sri Lanka)</label>
          <input type="time" value={f.send_time} onChange={(e) => setF({ ...f, send_time: e.target.value })} className="input text-sm" required />
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {whenLabel({ frequency: schedule.frequency, send_day: f.send_day, send_time: f.send_time })},
        {schedule.frequency === 'daily' ? ' reporting the previous day.' : ' reporting the previous calendar month.'}
        {' '}Days 29–31 aren't offered so the send date exists in every month. The email body includes a Plant 1 and Plant 4 summary; the report above is attached in full.
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
  const schedules: ReportSchedule[] = schedulesData?.schedules ?? [];
  const [sending, setSending] = useState<string | null>(null);
  const sendNowMutation = useMutation({
    mutationFn: (frequency: string) => { setSending(frequency); return reportsApi.sendScheduleNow(frequency); },
    onSuccess: (res) => {
      const { status, message } = res.data;
      if (status === 'sent') toast.success(message); else toast.error(`Not sent: ${message}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Send failed'),
    onSettled: () => { setSending(null); qc.invalidateQueries({ queryKey: ['report-schedules'] }); },
  });
  const handleSendNow = (frequency: string) => {
    if (confirm(`Send the ${frequency} report to its recipients now?`)) sendNowMutation.mutate(frequency);
  };

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

      <SavedSchedulesTable schedules={schedules} onSendNow={handleSendNow} sending={sending} />

      {(['daily', 'monthly'] as const).map((freq) => {
        const schedule = schedules.find((s) => s.frequency === freq);
        return (
          <div key={freq} id={`schedule-${freq}`} className="card space-y-4 scroll-mt-4">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200 capitalize">{freq} Report</h3>
            {schedule && (
              <ScheduleCard schedule={schedule}
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
