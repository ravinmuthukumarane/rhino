import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../services/api';
import { fmt } from '../../utils/formatters';
import { Zap, Droplets, AlertTriangle, Gauge } from 'lucide-react';

export default function TodaySummaryCard() {
  const { data } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => reportsApi.getDashboardStats().then((r) => r.data),
    refetchInterval: 60000,
  });

  const today = data?.today || {};
  const month = data?.thisMonth || {};

  const items = [
    {
      icon: Zap, label: "Today's Energy", value: fmt.kwh(today.energy?.total_kwh),
      sub: `This month: ${fmt.kwh(month.total_kwh)}`, color: 'text-primary-400',
    },
    {
      icon: Droplets, label: "Today's Diesel", value: fmt.liters(today.diesel?.total_liters),
      sub: `Gen run: ${fmt.number2(today.diesel?.generator_run_hours)} hrs`, color: 'text-orange-400',
    },
    {
      icon: AlertTriangle, label: 'Active Alerts', value: data?.activeAlerts ?? '—',
      sub: `${data?.todayInterruptions ?? 0} interruptions today`, color: 'text-yellow-400',
    },
    {
      icon: Gauge, label: 'Max KVA Today', value: fmt.kva(today.energy?.max_kva),
      sub: `Avg PF: ${fmt.pf(today.energy?.avg_power_factor)}`, color: 'text-purple-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map(({ icon: Icon, label, value, sub, color }) => (
        <div key={label} className="card flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${color}`} />
            <span className="text-xs text-gray-500 font-medium">{label}</span>
          </div>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-500">{sub}</p>
        </div>
      ))}
    </div>
  );
}
