import { useState, FormEvent, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { fmt } from '../utils/formatters';
import { Clock, Mail, UserPlus, Trash2, Send, Users, X, CalendarDays, CalendarClock, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ReportSchedule, ReportScheduleRecipient } from '../types';

const REPORTS = [
  { value: 'energy_daily',        label: 'Daily Energy Consumption' },
  { value: 'energy_monthly',      label: 'Monthly Energy Consumption' },
  { value: 'diesel_daily',        label: 'Daily Diesel Consumption' },
  { value: 'diesel_monthly',      label: 'Monthly Diesel Consumption' },
  { value: 'power_quality',       label: 'Power Quality Report' },
  { value: 'power_interruption_daily',   label: 'Daily Power Interruption Report' },
  { value: 'power_interruption_monthly', label: 'Monthly Power Interruption Report' },
  { value: 'consumption_summary', label: 'Full Consumption Summary' },
  { value: 'all_combined',        label: 'All Reports (multi-tab)' },
];

const SECTIONS = [
  { value: '',   label: 'All Plants (P1 + P4)' },
  { value: 'P1', label: 'Plant 1' },
  { value: 'P4', label: 'Plant 4' },
];

type Frequency = 'daily' | 'monthly';

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
const isEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());

// One permanent "add" form per frequency. Saving always creates a NEW
// schedule (never edits an existing one) and then clears the form, so a
// different report type for the same frequency becomes its own schedule.
function AddScheduleForm({ frequency, existing }: { frequency: Frequency; existing: ReportSchedule[] }) {
  const qc = useQueryClient();
  const blank = {
    report_type: frequency === 'daily' ? 'energy_daily' : 'energy_monthly', format: 'excel', plant_section: '',
    send_day: 1, send_time: frequency === 'daily' ? '00:10' : '06:00',
  };
  const [f, setF] = useState(blank);
  const [recipients, setRecipients] = useState<{ email: string; name: string }[]>([]);
  const [draft, setDraft] = useState({ name: '', email: '' });

  const addDraft = () => {
    if (!isEmail(draft.email)) { toast.error('Enter a valid email'); return; }
    const email = draft.email.trim().toLowerCase();
    if (recipients.some((r) => r.email === email)) { toast.error('Already in the list'); return; }
    setRecipients([...recipients, { email, name: draft.name.trim() }]);
    setDraft({ name: '', email: '' });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const label = frequency === 'daily' ? 'Daily' : 'Monthly';
      return reportsApi.createSchedule({
        ...f, frequency, enabled: true,
        name: `${label} – ${reportLabel(f.report_type)} – ${plantLabel(f.plant_section)}`,
        recipients: recipients.map((r) => ({ email: r.email, name: r.name || undefined })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-schedules'] });
      toast.success(`${frequency === 'daily' ? 'Daily' : 'Monthly'} schedule added`);
      setF(blank); setRecipients([]); setDraft({ name: '', email: '' });
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Could not save schedule'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // An email typed into the box but not yet "added" still counts.
    if (draft.email.trim()) { toast.error('Click "Add" to include the email you typed, or clear it'); return; }
    if (!recipients.length && !confirm('No recipients added - this schedule will not email anyone until recipients are added. Save anyway?')) return;
    createMutation.mutate();
  };

  const Icon = frequency === 'daily' ? CalendarClock : CalendarDays;
  const count = existing.filter((s) => s.frequency === frequency).length;

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        <h3 className="font-semibold text-gray-800 dark:text-gray-200">{frequency === 'daily' ? 'Daily' : 'Monthly'} Report Schedule</h3>
        <span className="text-xs text-gray-500 ml-auto">{count} saved</span>
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
        {frequency === 'monthly' && (
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

      <div className="space-y-2">
        <label className="label">Recipients</label>
        <div className="flex flex-wrap items-end gap-2">
          <input type="text" className="input text-sm w-40" placeholder="Name (optional)"
            value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input type="email" className="input text-sm w-56" placeholder="email@factory.com"
            value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }} />
          <button type="button" onClick={addDraft}
            className="text-sm py-1.5 px-3 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {recipients.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {recipients.map((r) => (
              <span key={r.email} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary-500/10 text-primary-700 dark:text-primary-300">
                {r.name ? `${r.name} <${r.email}>` : r.email}
                <button type="button" onClick={() => setRecipients(recipients.filter((x) => x.email !== r.email))} title="Remove">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        {whenLabel({ frequency, send_day: f.send_day, send_time: f.send_time })},
        {frequency === 'daily' ? ' reporting the previous day.' : ' reporting the previous calendar month.'}
        {' '}Saving adds a new schedule to the list below — it never changes an existing one.
      </p>
      <button type="submit" disabled={createMutation.isPending} className="btn-primary text-sm py-1.5 px-4">
        {createMutation.isPending ? 'Saving…' : `Save ${frequency === 'daily' ? 'Daily' : 'Monthly'} Schedule`}
      </button>
    </form>
  );
}

function RecipientManager({ schedule }: { schedule: ReportSchedule }) {
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
  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportsApi.deleteScheduleRecipient(schedule.id, id),
    onSuccess: () => { refresh(); toast.success('Recipient removed'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Delete failed'),
  });

  return (
    <div className="space-y-2 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Recipients of "{schedule.name}"</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); addMutation.mutate(); }} className="flex flex-wrap items-end gap-2">
        <input type="text" className="input text-sm w-40" placeholder="Name (optional)"
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input type="email" className="input text-sm w-56" placeholder="email@factory.com" required
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <button type="submit" className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5" disabled={addMutation.isPending}>
          <UserPlus className="w-3.5 h-3.5" /> {addMutation.isPending ? 'Adding…' : 'Add'}
        </button>
      </form>
      {isLoading ? <p className="text-xs text-gray-500">Loading…</p>
        : recipients.length === 0 ? <p className="text-xs text-red-600 dark:text-red-400">No recipients — this schedule won't send until one is added.</p>
        : (
          <table className="w-full text-sm">
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-gray-200 dark:border-gray-800/50 last:border-0">
                  <td className="px-2 py-1.5 text-gray-800 dark:text-gray-200">{r.name || '—'}</td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400">{r.email}</td>
                  <td className="px-2 py-1.5 text-gray-500 text-xs whitespace-nowrap">{fmt.date(r.created_at)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => { if (confirm(`Remove ${r.email}?`)) deleteMutation.mutate(r.id); }} disabled={deleteMutation.isPending}
                      className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10`} title="Remove recipient">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}

// Edits one existing schedule in place - opened from that schedule's row,
// titled with its name and saved with "Save changes", so it can't be
// mistaken for the add forms above (which always create a new schedule).
function EditScheduleForm({ schedule, onDone }: { schedule: ReportSchedule; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    report_type: schedule.report_type, format: schedule.format as string, plant_section: schedule.plant_section ?? '',
    send_day: schedule.send_day ?? 1, send_time: schedule.send_time,
  });
  const saveMutation = useMutation({
    mutationFn: () => {
      const label = schedule.frequency === 'daily' ? 'Daily' : 'Monthly';
      return reportsApi.updateSchedule(schedule.id, {
        ...f, frequency: schedule.frequency, enabled: schedule.enabled,
        name: `${label} – ${reportLabel(f.report_type)} – ${plantLabel(f.plant_section)}`,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['report-schedules'] }); toast.success('Schedule updated'); onDone(); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Update failed'),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}
      className="space-y-3 p-3 rounded-lg border border-primary-500/40 bg-primary-500/5">
      <div className="flex items-center gap-2">
        <Pencil className="w-4 h-4 text-primary-600 dark:text-primary-400" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Editing: {schedule.name}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        <div className="sm:col-span-2">
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
            {SECTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          {schedule.frequency === 'monthly' && (
            <div className="flex-1">
              <label className="label">Day</label>
              <select value={f.send_day} onChange={(e) => setF({ ...f, send_day: Number(e.target.value) })} className="input text-sm">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
              </select>
            </div>
          )}
          <div className="flex-1">
            <label className="label">Time</label>
            <input type="time" value={f.send_time} onChange={(e) => setF({ ...f, send_time: e.target.value })} className="input text-sm" required />
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-500">{whenLabel({ frequency: schedule.frequency, send_day: f.send_day, send_time: f.send_time })}. Changes apply from the next send; recipients are edited via the recipient count.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={saveMutation.isPending} className="btn-primary text-sm py-1.5 px-4">
          {saveMutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" onClick={onDone}
          className="text-sm py-1.5 px-4 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}

function SavedSchedulesTable({ schedules, isLoading }: { schedules: ReportSchedule[]; isLoading: boolean }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['report-schedules'] });
  // One panel at a time under a row: its recipients or its edit form.
  const [panel, setPanel] = useState<{ id: string; kind: 'recipients' | 'edit' } | null>(null);
  const togglePanel = (id: string, kind: 'recipients' | 'edit') =>
    setPanel(panel?.id === id && panel.kind === kind ? null : { id, kind });

  const toggleMutation = useMutation({
    mutationFn: (s: ReportSchedule) => reportsApi.updateSchedule(s.id, {
      name: s.name, frequency: s.frequency, enabled: !s.enabled, report_type: s.report_type, format: s.format,
      plant_section: s.plant_section ?? '', send_day: s.send_day, send_time: s.send_time,
    }),
    onSuccess: (_r, s) => { refresh(); toast.success(s.enabled ? 'Schedule disabled' : 'Schedule enabled'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Update failed'),
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
  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportsApi.deleteSchedule(id),
    onSuccess: () => { refresh(); toast.success('Schedule removed'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Delete failed'),
  });
  const busy = toggleMutation.isPending || sendNowMutation.isPending || deleteMutation.isPending;

  const cols = ['Schedule', 'Status', 'Email Report Type', 'Plant', 'Format', 'Sends', 'Recipients', 'Last Send', 'Next Send', 'Saved', ''];

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-gray-800 dark:text-gray-200">Saved Schedules <span className="text-xs font-normal text-gray-500">({schedules.length})</span></h3>
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/40 text-left text-xs text-gray-500">
              {cols.map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={cols.length} className="px-3 py-4 text-center text-gray-500 text-xs">Loading…</td></tr>
            ) : schedules.length === 0 ? (
              <tr><td colSpan={cols.length} className="px-3 py-4 text-center text-gray-500 text-xs">No schedules saved yet.</td></tr>
            ) : schedules.map((s) => (
              <Fragment key={s.id}>
                <tr className="border-t border-gray-200 dark:border-gray-800/50 align-top">
                  <td className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-200 capitalize">{s.frequency}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleMutation.mutate(s)} disabled={busy} title={s.enabled ? 'Click to disable' : 'Click to enable'}
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full disabled:opacity-50 ${s.enabled ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-gray-500/10 text-gray-500'}`}>
                      {s.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{reportLabel(s.report_type)}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{plantLabel(s.plant_section)}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 uppercase text-xs">{s.format}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{whenLabel(s)}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => togglePanel(s.id, 'recipients')}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded hover:bg-primary-500/10 ${s.recipient_count ? 'text-gray-700 dark:text-gray-300' : 'text-red-600 dark:text-red-400'}`}
                      title="View / edit recipients">
                      <Users className="w-3.5 h-3.5" /> {s.recipient_count}
                    </button>
                  </td>
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
                    <button onClick={() => togglePanel(s.id, 'edit')} disabled={busy}
                      className={`${iconBtn} hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-500/10`} title="Edit schedule">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { if (confirm(`Send "${s.name}" to its ${s.recipient_count} recipient(s) now?`)) sendNowMutation.mutate(s.id); }} disabled={busy}
                      className={`${iconBtn} hover:text-green-600 hover:bg-green-500/10`} title="Send now">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { if (confirm(`Remove the schedule "${s.name}" and its recipients?`)) deleteMutation.mutate(s.id); }} disabled={busy}
                      className={`${iconBtn} hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10`} title="Remove schedule">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
                {panel?.id === s.id && (
                  <tr><td colSpan={cols.length} className="px-3 pb-3">
                    {panel.kind === 'recipients'
                      ? <RecipientManager schedule={s} />
                      : <EditScheduleForm schedule={s} onDone={() => setPanel(null)} />}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">All times are Sri Lanka time. Click a status to enable/disable, the recipient count to view and edit who receives it, or the pencil to edit a schedule. "Send now" emails the most recent period immediately without changing the next scheduled send.</p>
    </div>
  );
}

function SchedulesManager() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => reportsApi.getSchedules().then((r) => r.data),
  });
  const schedules: ReportSchedule[] = data?.schedules ?? [];

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Report Schedules</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Use the Monthly or Daily form to add a scheduled report email. Each save adds a new schedule — e.g. a Monthly Energy report and a Monthly Diesel report are two separate schedules, each with its own recipients. The email body summarizes Plant 1 and Plant 4, with the chosen report attached.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <AddScheduleForm frequency="monthly" existing={schedules} />
        <AddScheduleForm frequency="daily" existing={schedules} />
      </div>

      <SavedSchedulesTable schedules={schedules} isLoading={isLoading} />
    </div>
  );
}

export default function ReportSchedulesPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <SchedulesManager />;
}
