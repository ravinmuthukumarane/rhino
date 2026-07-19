import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { reportsApi, settingsApi, downloadBlob } from '../services/api';
import { usePlant } from '../context/PlantContext';
import { fmt } from '../utils/formatters';
import { FileDown, FileText } from 'lucide-react';
import toast from 'react-hot-toast';

const REPORTS = [
  { value: 'energy_daily',        label: 'Daily Energy Consumption' },
  { value: 'energy_monthly',      label: 'Monthly Energy Consumption' },
  { value: 'diesel_daily',        label: 'Daily Diesel Consumption' },
  { value: 'diesel_monthly',      label: 'Monthly Diesel Consumption' },
  { value: 'power_quality',       label: 'Power Quality Report' },
  { value: 'power_interruption',  label: 'Power Interruption Report' },
  { value: 'consumption_summary', label: 'Full Consumption Summary' },
];

export default function ReportsPage() {
  const { selectedPlantId } = usePlant();
  const [reportType, setReportType] = useState('energy_daily');
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  const { data: histData } = useQuery({
    queryKey: ['report-history'],
    queryFn: () => reportsApi.getHistory().then((r) => r.data),
    refetchInterval: 30000,
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
          <FileText className="w-5 h-5 text-primary-400" />
          <h2 className="text-lg font-semibold text-gray-100">Generate Report</h2>
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
            className="bg-gray-800 hover:bg-gray-700 text-gray-200 font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-1"
          >
            <FileDown className="w-4 h-4" />
            {genMutation.isPending ? 'Generating…' : 'Download as PDF'}
          </button>
        </div>
      </div>

      {/* History */}
      {histData?.reports && histData.reports.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="p-4 border-b border-gray-800">
            <h3 className="font-semibold text-gray-200">Recent Reports</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/50">
                  {['Type', 'Period', 'Format', 'Generated'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {histData.reports.slice(0, 10).map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                    <td className="px-4 py-2.5 text-gray-200 text-xs">
                      {r.report_type?.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                      {r.period_start ? `${fmt.date(r.period_start)} – ${fmt.date(r.period_end)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={r.format === 'excel' ? 'text-green-400' : 'text-red-400'}>
                        {r.format?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
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
