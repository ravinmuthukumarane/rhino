import { useState } from 'react';
import { Activity, Zap, Gauge, BarChart2, Droplets, Cpu } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import MetricCard from '../components/dashboard/MetricCard';
import PowerSourceIndicator from '../components/dashboard/PowerSourceIndicator';
import GeneratorStatusCard from '../components/dashboard/GeneratorStatusCard';
import ConsumptionChart from '../components/dashboard/ConsumptionChart';
import LiveReadingsChart from '../components/dashboard/LiveReadingsChart';
import TodaySummaryCard from '../components/dashboard/TodaySummaryCard';
import { fmt } from '../utils/formatters';

const LIVE_METRICS = [
  { key: 'voltage', label: 'Voltage', icon: Zap, color: 'primary' },
  { key: 'current', label: 'Current', icon: Activity, color: 'blue' },
  { key: 'power', label: 'Power', icon: BarChart2, color: 'green' },
  { key: 'pf', label: 'PF', icon: Gauge, color: 'purple' },
];

export default function DashboardPage() {
  const { liveReading, activeAlerts } = useSocket();
  const [activeChart, setActiveChart] = useState('voltage');

  const e = liveReading?.energy;
  const d = liveReading?.diesel;
  const g = liveReading?.generator;
  const timePeriod = liveReading?.timePeriod;

  const avgVoltage = e ? ((+e.voltage_r + +e.voltage_y + +e.voltage_b) / 3).toFixed(1) : null;
  const avgCurrent = e ? ((+e.current_r + +e.current_y + +e.current_b) / 3).toFixed(1) : null;

  const voltageStatus = !avgVoltage ? 'normal'
    : +avgVoltage > 250 ? 'critical' : +avgVoltage < 200 ? 'critical' : +avgVoltage < 210 ? 'warning' : 'normal';
  const pfStatus = !e?.power_factor ? 'normal'
    : +e.power_factor < 0.80 ? 'critical' : +e.power_factor < 0.85 ? 'warning' : 'normal';

  const criticalCount = activeAlerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length;

  return (
    <div className="space-y-6">
      {criticalCount > 0 && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3 flex items-center gap-3">
          <span className="flex-shrink-0 w-8 h-8 bg-red-700/50 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-red-300 animate-pulse" />
          </span>
          <p className="text-sm text-red-300 font-medium">
            {criticalCount} critical alert{criticalCount > 1 ? 's' : ''} — check the Alerts page immediately
          </p>
        </div>
      )}

      {/* Today's Summary */}
      <TodaySummaryCard />

      {/* Live Metrics Grid */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Real-Time Readings</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Avg Voltage" value={avgVoltage} unit="V"
            icon={Zap} color={voltageStatus === 'critical' ? 'red' : voltageStatus === 'warning' ? 'yellow' : 'primary'}
            status={voltageStatus} />
          <MetricCard label="Avg Current" value={avgCurrent} unit="A" icon={Activity} color="blue" />
          <MetricCard label="Power" value={e ? parseFloat(e.power_kw).toFixed(2) : null} unit="kW" icon={BarChart2} color="green" />
          <MetricCard label="KVA (Demand)" value={e ? parseFloat(e.power_kva).toFixed(2) : null} unit="kVA"
            icon={Gauge} color="purple" />
          <MetricCard label="Power Factor" value={e ? parseFloat(e.power_factor).toFixed(3) : null}
            icon={Gauge} color={pfStatus === 'critical' ? 'red' : pfStatus === 'warning' ? 'yellow' : 'primary'}
            status={pfStatus} />
          <MetricCard label="Frequency" value={e ? parseFloat(e.frequency).toFixed(2) : null} unit="Hz"
            icon={Activity} color="blue" />
        </div>
      </div>

      {/* Phase Detail Row */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Three-Phase Detail</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="V — R Phase" value={e ? parseFloat(e.voltage_r).toFixed(1) : null} unit="V" color="red" />
          <MetricCard label="V — Y Phase" value={e ? parseFloat(e.voltage_y).toFixed(1) : null} unit="V" color="yellow" />
          <MetricCard label="V — B Phase" value={e ? parseFloat(e.voltage_b).toFixed(1) : null} unit="V" color="blue" />
          <MetricCard label="I — R Phase" value={e ? parseFloat(e.current_r).toFixed(1) : null} unit="A" color="red" />
          <MetricCard label="I — Y Phase" value={e ? parseFloat(e.current_y).toFixed(1) : null} unit="A" color="yellow" />
          <MetricCard label="I — B Phase" value={e ? parseFloat(e.current_b).toFixed(1) : null} unit="A" color="blue" />
        </div>
      </div>

      {/* Diesel & Source Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1 space-y-4">
          <MetricCard label="Diesel Flow Rate" value={d ? parseFloat(d.flow_rate).toFixed(2) : '0.00'} unit="L/hr"
            icon={Droplets} color="orange" sublabel={`Total: ${d ? parseFloat(d.total_volume).toFixed(0) : '—'} L`} />
          <MetricCard label="Energy Meter (kWh)" value={e ? parseFloat(e.energy_kwh).toFixed(1) : null}
            icon={Zap} color="green" sublabel="Cumulative total" />
        </div>
        <PowerSourceIndicator source={e?.source} timePeriod={timePeriod} />
        <GeneratorStatusCard liveStatus={g?.status} />
      </div>

      {/* Live Charts */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Live Trend</h3>
          <div className="flex gap-1 ml-2">
            {LIVE_METRICS.map(({ key, label }) => (
              <button key={key} onClick={() => setActiveChart(key)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors
                  ${activeChart === key ? 'bg-primary-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <LiveReadingsChart metric={activeChart} />
      </div>

      {/* Consumption Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ConsumptionChart type="energy" />
        <ConsumptionChart type="diesel" />
      </div>
    </div>
  );
}
