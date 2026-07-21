import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi, settingsApi, downloadBlob } from '../services/api';
import { usePlant } from '../context/PlantContext';
import { useAuth } from '../context/AuthContext';
import { fmt } from '../utils/formatters';
import { FileDown, FileText, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Plant } from '../types';

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
        <h4 className="font-medium text-gray-800 dark:text-gray-200 capitalize">{schedule.frequency}</h4>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          Enabled
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Report Type</label>
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
        {' '}Emailed to all verified admins.
      </p>
      <button onClick={() => onSave(f)} disabled={saving} className="btn-primary text-sm py-1.5 px-4">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

export default function ReportsPage() {
  const { isAdmin } = useAuth();
  const { selectedPlantId } = usePlant();
  const [reportType, setReportType] = useState('energy_daily');
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const qc = useQueryClient();

  const { data: histData } = useQuery({
    queryKey: ['report-history'],
    queryFn: () => reportsApi.getHistory().then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: schedulesData } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => reportsApi.getSchedules().then((r) => r.data),
    enabled: isAdmin,
  });
  const { data: plantsData } = useQuery({
    queryKey: ['plants'],
    queryFn: () => settingsApi.getPlants().then((r) => r.data),
    enabled: isAdmin,
  });
  const plants: Plant[] = plantsData?.plants ?? [];
  const schedules = schedulesData?.schedules ?? [];

  const scheduleMutation = useMutation({
    mutationFn: ({ frequency, data }: { frequency: string; data: object }) => reportsApi.updateSchedule(frequency, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['report-schedules'] }); toast.success('Schedule saved'); },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Save failed'),
  });

  const genMutation = useMutation({
    mutationFn: (data: any) => reportsApi.generate(data),
    onSuccess: (res, vars: any) => {
      const ext = vars.format === 'excel' ? 'xlsx' : 'pdf';
      downloadBlob(res.data as Blob, `${vars.type}_${vars.dateFrom}_to_${vars.dateTo}.${ext}`);
      toast.success('Report downloaded');
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? 'Failed'),
  });

  const handleDownload = (format: 'excel' | 'pdf') => {
    genMutation.mutate({
      type: reportType,
      period_start: dateFrom,
      period_end: dateTo,
      format,
      plant_id: selectedPlantId || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Report Builder */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Generate Report</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Report Type</label>
            <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="input text-sm">
              {REPORTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input text-sm"
            />
          </div>

          <div>
            <label className="label">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => handleDownload('excel')}
            disabled={genMutation.isPending}
            className="btn-primary flex items-center gap-2 flex-1"
          >
            <FileDown className="w-4 h-4" />
            {genMutation.isPending ? 'Generating…' : 'Download as Excel'}
          </button>
          <button
            onClick={() => handleDownload('pdf')}
            disabled={genMutation.isPending}
            className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-1"
          >
            <FileDown className="w-4 h-4" />
            {genMutation.isPending ? 'Generating…' : 'Download as PDF'}
          </button>
        </div>
      </div>

      {/* Scheduled Reports (admin only) */}
      {isAdmin && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Scheduled Reports</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {schedules.map((s: any) => (
              <ScheduleCard key={s.frequency} schedule={s} plants={plants}
                onSave={(data) => scheduleMutation.mutate({ frequency: s.frequency, data })}
                saving={scheduleMutation.isPending} />
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {histData?.reports && histData.reports.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">Recent Reports</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/50">
                  {['Type', 'Period', 'Format', 'Generated'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {histData.reports.slice(0, 10).map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 text-xs">
                      {r.report_type?.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                      {r.period_start ? `${fmt.date(r.period_start)} – ${fmt.date(r.period_end)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={r.format === 'excel' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {r.format?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                      {fmt.datetime(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
