import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { fmt } from '../utils/formatters';
import { Clock, Mail, UserPlus, Trash2, Send, Pencil, Plus } from 'lucide-react';
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
const iconBtn = 'p-1.5 inline-flex text-gray-500 rounded transition-colors disabled:opacity-50';

type ScheduleFields = {
  name: string; frequency: 'daily' | 'monthly'; enabled: boolean; report_type: string; format: string;
  plant_section: string; send_day: number; send_time: string;
};

const NEW_SCHEDULE: ScheduleFields = {
  name: '', frequency: 'monthly', enabled: true, report_type: 'consumption_summary', format: 'excel',
  plant_section: '', send_day: 1, send_time: '06:00',
};

const fieldsOf = (s: ReportSchedule): ScheduleFields => ({
  name: s.name, frequency: s.frequency, enabled: s.enabled, report_type: s.report_type, format: s.format,
  plant_section: s.plant_section ?? '', send_day: s.send_day ?? 1,
  send_time: s.send_time ?? (s.frequency === 'daily' ? '00:10' : '06:00'),
});

function SavedSchedulesTable({ schedules, isLoading, onSendNow, onDelete, busy }: {
  schedules: ReportSchedule[]; isLoading: boolean;
  onSendNow: (s: ReportSchedule) => void; onDelete: (s: ReportSchedule) => void; busy: boolean;
}) {
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-gray-800 dark:text-gray-200">Saved Schedules <span className="text-xs font-normal text-gray-500">({schedules.length})</span></h3>
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/40 text-left text-xs text-gray-500">
              {['Name', 'Status', 'Email Report Type', 'Plant', 'Format', 'Sends', 'Recipients', 'Last Send', 'Next Send', 'Last Saved', ''].map((h) =>
                <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={11} className="px-3 py-4 text-center text-gray-500 text-xs">Loading…</td></tr>
            ) : schedules.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-4 text-center text-gray-500 text-xs">No schedules yet — use "Add Schedule" above.</td></tr>
            ) : schedules.map((s) => (
              <tr key={s.id} className="border-t border-gray-200 dark:border-gray-800/50 align-top">
                <td className="px-3 py-2">
                  <p className="font-semibold text-gray-800 dark:text-gray-200">{s.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{s.frequency}</p>
                </td>
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
                  <a href={`#schedule-${s.id}`} className={`${iconBtn} hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-500/10`} title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </a>
                  <button onClick={() => onSendNow(s)} disabled={busy}
                    className={`${iconBtn} hover:text-green-600 hover:bg-green-500/10`} title="Send now">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDelete(s)} disabled={busy}
                    className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10`} title="Delete schedule">
                    <Trash2 className="w-3.5 h-3.5" />
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

function ScheduleForm({ initial, onSave, saving, submitLabel, onCancel }: {
  initial: ScheduleFields; onSave: (data: ScheduleFields) => void; saving: boolean;
  submitLabel: string; onCancel?: () => void;
}) {
  // Seeded once per mount - the parent re-keys this form by the schedule's
  // updated_at, so it resets after a save but never wipes unsaved edits when
  // the page merely re-renders.
  const [f, setF] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); onSave(f); };

  return (
    <form onSubmit={submit} className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Schedule Name</label>
          <input type="text" className="input text-sm" placeholder="e.g. Plant 4 monthly energy" required maxLength={255}
            value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer pb-2">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
            Enabled
          </label>
        </div>
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
        <div>
          <label className="label">Frequency</label>
          <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as ScheduleFields['frequency'] })} className="input text-sm">
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        {f.frequency === 'monthly' && (
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
        {whenLabel(f)},
        {f.frequency === 'daily' ? ' reporting the previous day.' : ' reporting the previous calendar month.'}
        {' '}Days 29–31 aren't offered so the send date exists in every month.
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary text-sm py-1.5 px-4">
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm py-1.5 px-4 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function RecipientList({ schedule }: { schedule: ReportSchedule }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['schedule-recipients', schedule.id],
    queryFn: () => reportsApi.getScheduleRecipients(schedule.id).then((r) => r.data),
  });
  const recipients: ReportScheduleRecipient[] = data?.recipients ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['schedule-recipients', schedule.id] });
    qc.invalidateQueries({ queryKey: ['report-schedules'] });
  };

  const [form, setForm] = useState({ name: '', email: '' });
  const addMutation = useMutation({
    mutationFn: () => reportsApi.addScheduleRecipient(schedule.id, { email: form.email, name: form.name || undefined }),
    onSuccess: () => { refresh(); toast.success('Recipient added'); setForm({ name: '', email: '' }); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Could not add recipient'),
  });
  const handleAdd = (e: FormEvent) => { e.preventDefault(); addMutation.mutate(); };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportsApi.deleteScheduleRecipient(schedule.id, id),
    onSuccess: () => { refresh(); toast.success('Recipient removed'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Delete failed'),
  });
  const handleDelete = (r: ReportScheduleRecipient) => {
    if (confirm(`Remove ${r.email} from "${schedule.name}"?`)) deleteMutation.mutate(r.id);
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

function SchedulesManager() {
  const qc = useQueryClient();
  const { data: schedulesData, isLoading } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => reportsApi.getSchedules().then((r) => r.data),
  });
  const schedules: ReportSchedule[] = schedulesData?.schedules ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['report-schedules'] });
  const [adding, setAdding] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data: ScheduleFields) => reportsApi.createSchedule(data),
    onSuccess: (res) => {
      refresh(); setAdding(false);
      toast.success('Schedule created — add its recipients below');
      const id = res.data?.schedule?.id;
      if (id) setTimeout(() => document.getElementById(`schedule-${id}`)?.scrollIntoView({ behavior: 'smooth' }), 300);
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Could not create schedule'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ScheduleFields }) => reportsApi.updateSchedule(id, data),
    onSuccess: () => { refresh(); toast.success('Schedule saved'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Save failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportsApi.deleteSchedule(id),
    onSuccess: () => { refresh(); toast.success('Schedule deleted'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Delete failed'),
  });
  const sendNowMutation = useMutation({
    mutationFn: (id: string) => reportsApi.sendScheduleNow(id),
    onSuccess: (res) => {
      const { status, message } = res.data;
      if (status === 'sent') toast.success(message); else toast.error(`Not sent: ${message}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Send failed'),
    onSettled: refresh,
  });

  const handleSendNow = (s: ReportSchedule) => {
    if (confirm(`Send "${s.name}" to its ${s.recipient_count} recipient(s) now?`)) sendNowMutation.mutate(s.id);
  };
  const handleDelete = (s: ReportSchedule) => {
    if (confirm(`Delete the schedule "${s.name}"? Its ${s.recipient_count} recipient(s) are removed with it.`)) deleteMutation.mutate(s.id);
  };
  const busy = sendNowMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Report Schedules</h2>
          {!adding && (
            <button onClick={() => setAdding(true)} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5 ml-auto">
              <Plus className="w-3.5 h-3.5" /> Add Schedule
            </button>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Set up as many automated report emails as you need — e.g. a separate monthly report per plant. Each schedule has its own report type, plant, send day/time and recipient list. The email body summarizes Plant 1 and Plant 4, with the full report attached.
        </p>
      </div>

      {adding && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200">New Schedule</h3>
          <ScheduleForm initial={NEW_SCHEDULE} submitLabel="Create Schedule" saving={createMutation.isPending}
            onSave={(data) => createMutation.mutate(data)} onCancel={() => setAdding(false)} />
        </div>
      )}

      <SavedSchedulesTable schedules={schedules} isLoading={isLoading} onSendNow={handleSendNow} onDelete={handleDelete} busy={busy} />

      {schedules.map((s) => (
        <div key={s.id} id={`schedule-${s.id}`} className="card space-y-4 scroll-mt-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">{s.name}</h3>
            <span className="text-xs text-gray-500 capitalize">· {s.frequency}</span>
            <button onClick={() => handleDelete(s)} disabled={busy}
              className="ml-auto text-xs flex items-center gap-1 px-2 py-1 rounded text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> Delete schedule
            </button>
          </div>
          <ScheduleForm key={`${s.id}:${s.updated_at}`} initial={fieldsOf(s)} submitLabel="Save" saving={updateMutation.isPending && updateMutation.variables?.id === s.id}
            onSave={(data) => updateMutation.mutate({ id: s.id, data })} />
          <RecipientList schedule={s} />
        </div>
      ))}
    </div>
  );
}

export default function ReportSchedulesPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <SchedulesManager />;
}
