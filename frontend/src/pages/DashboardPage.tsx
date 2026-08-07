import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Zap, Gauge, BarChart2, Droplets, Cpu, TrendingUp } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSocket } from '../context/SocketContext';
import { usePlant } from '../context/PlantContext';
import { readingsApi, settingsApi } from '../services/api';
import { fmt } from '../utils/formatters';
import { getTimePeriod, timePeriodLabels, timePeriodColors } from '../utils/timeUtils';
import { format } from 'date-fns';
import type { EnergyReading, LiveReadingPayload, TimePeriod } from '../types';

const MAX_LIVE = 30;

// Plant-level view: sum extensive quantities (power, current) across every
// currently-reporting meter, average intensive ones (voltage, PF, frequency)
// instead of showing whichever single meter's message arrived last.
function aggregateEnergyReadings(readings: EnergyReading[]): EnergyReading | null {
  if (readings.length === 0) return null;
  const n = readings.length;
  const num = (v: unknown) => parseFloat(String(v)) || 0;
  const sum = (key: keyof EnergyReading) => readings.reduce((acc, r) => acc + num(r[key]), 0);
  const avg = (key: keyof EnergyReading) => sum(key) / n;
  const latest = readings.reduce((a, b) => (new Date(a.recorded_at) > new Date(b.recorded_at) ? a : b));

  return {
    ...latest,
    voltage_r: avg('voltage_r'),
    voltage_y: avg('voltage_y'),
    voltage_b: avg('voltage_b'),
    current_r: sum('current_r'),
    current_y: sum('current_y'),
    current_b: sum('current_b'),
    power_kw: sum('power_kw'),
    power_kva: sum('power_kva'),
    power_factor: avg('power_factor'),
    frequency: avg('frequency'),
    third_harmonic_r: avg('third_harmonic_r'),
    third_harmonic_y: avg('third_harmonic_y'),
    third_harmonic_b: avg('third_harmonic_b'),
  };
}

function MetricCard({ label, value, unit, color = 'primary', sub }: { label: string; value: any; unit?: string; color?: string; sub?: string }) {
  const colors: Record<string, string> = {
    primary: 'text-primary-700 dark:text-primary-300 border-primary-800/50 bg-primary-900/30',
    green: 'text-green-700 dark:text-green-300 border-green-300 dark:border-green-800/40 bg-green-50 dark:bg-green-900/20',
    yellow: 'text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-800/40 bg-yellow-50 dark:bg-yellow-900/20',
    red: 'text-red-700 dark:text-red-300 border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20',
    blue: 'text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-900/20',
    purple: 'text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800/40 bg-purple-50 dark:bg-purple-900/20',
    orange: 'text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-800/40 bg-orange-50 dark:bg-orange-900/20',
    cyan: 'text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-800/40 bg-cyan-50 dark:bg-cyan-900/20',
  };
  const cls = colors[color] ?? colors.primary;
  return (
    <div className={`border rounded-xl p-3 ${cls}`}>
      <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-xl font-bold leading-tight">{value ?? '—'}{unit && <span className="text-sm font-normal text-gray-600 dark:text-gray-400 ml-1">{unit}</span>}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

const TT = ({ active, payload, label }: any) => active && payload?.length
  ? <div className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2 text-xs"><p className="text-gray-700 dark:text-gray-300 mb-1">{label}</p>{payload.map((p: any) => <div key={p.name} className="flex items-center gap-1.5 mb-0.5"><div className="w-2 h-2 rounded-full" style={{ background: p.color }} /><span className="text-gray-600 dark:text-gray-400">{p.name}:</span><span className="text-gray-900 dark:text-gray-100 font-medium">{p.value}</span></div>)}</div>
  : null;

// One column of the Live Trend / Real-Time Readings / Phase Detail blocks,
// scoped to a single plant section (e.g. "P1" or "P4") so the two sections
// can be compared side by side instead of being merged into one plant-wide view.
function SectionColumn({ section, meterReadings }: { section: string; meterReadings: LiveReadingPayload[] }) {
  const [liveHistory, setLiveHistory] = useState<any[]>([]);
  const [liveMetric, setLiveMetric] = useState<'voltage'|'current'|'power'|'pf'|'harmonic'>('power');

  const energyReadings = meterReadings.map((r) => r.energy).filter((x): x is EnergyReading => x != null);
  const e = aggregateEnergyReadings(energyReadings);
  const d = meterReadings.filter((r) => r.diesel != null)
    .sort((a, b) => new Date(b.diesel!.recorded_at).getTime() - new Date(a.diesel!.recorded_at).getTime())[0]?.diesel;
  const tp: TimePeriod = meterReadings[0]?.timePeriod ?? getTimePeriod();

  const prevRef = { current: liveHistory };
  if (e && (prevRef.current.length === 0 || prevRef.current[prevRef.current.length - 1]?.ts !== e.recorded_at)) {
    const point: any = {
      ts: e.recorded_at,
      time: format(new Date(e.recorded_at), 'HH:mm:ss'),
      VR: +parseFloat(String(e.voltage_r)).toFixed(1),
      VY: +parseFloat(String(e.voltage_y)).toFixed(1),
      VB: +parseFloat(String(e.voltage_b)).toFixed(1),
      IR: +parseFloat(String(e.current_r)).toFixed(1),
      IY: +parseFloat(String(e.current_y)).toFixed(1),
      IB: +parseFloat(String(e.current_b)).toFixed(1),
      'kW': +parseFloat(String(e.power_kw)).toFixed(2),
      'kVA': +parseFloat(String(e.power_kva)).toFixed(2),
      PF: +parseFloat(String(e.power_factor)).toFixed(3),
      'H3-R': +parseFloat(String(e.third_harmonic_r ?? 0)).toFixed(2),
      'H3-Y': +parseFloat(String(e.third_harmonic_y ?? 0)).toFixed(2),
      'H3-B': +parseFloat(String(e.third_harmonic_b ?? 0)).toFixed(2),
    };
    setTimeout(() => setLiveHistory((prev) => [...prev.slice(-(MAX_LIVE - 1)), point]), 0);
  }

  const liveLines: Record<string, { key: string; color: string }[]> = {
    voltage: [{ key:'VR', color:'#ef4444' }, { key:'VY', color:'#eab308' }, { key:'VB', color:'#3b82f6' }],
    current: [{ key:'IR', color:'#ef4444' }, { key:'IY', color:'#eab308' }, { key:'IB', color:'#3b82f6' }],
    power:   [{ key:'kW', color:'#22c55e' }, { key:'kVA', color:'#8b5cf6' }],
    pf:      [{ key:'PF', color:'#06b6d4' }],
    harmonic:[{ key:'H3-R', color:'#ef4444' }, { key:'H3-Y', color:'#eab308' }, { key:'H3-B', color:'#3b82f6' }],
  };

  const avgV = e ? ((+e.voltage_r + +e.voltage_y + +e.voltage_b) / 3).toFixed(1) : null;
  const avgI = e ? ((+e.current_r + +e.current_y + +e.current_b) / 3).toFixed(1) : null;
  const avgH3 = e?.third_harmonic_r != null ? (((e.third_harmonic_r ?? 0) + (e.third_harmonic_y ?? 0) + (e.third_harmonic_b ?? 0)) / 3).toFixed(2) : null;

  const vColor = !avgV ? 'primary' : +avgV > 250 ? 'red' : +avgV < 200 ? 'red' : +avgV < 210 ? 'yellow' : 'primary';
  const pfColor = !e?.power_factor ? 'primary' : +e.power_factor < 0.80 ? 'red' : +e.power_factor < 0.85 ? 'yellow' : 'green';
  const h3Color = !avgH3 ? 'cyan' : +avgH3 > 5 ? 'red' : +avgH3 > 3 ? 'yellow' : 'cyan';

  return (
    <div className="space-y-5">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Plant {section.replace(/^P/i, '')} <span className="text-xs font-normal text-gray-500">({section})</span></p>

      {/* Live trend chart */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Live Trend</p>
          <div className="flex flex-wrap gap-1 ml-2">
            {(['voltage','current','power','pf','harmonic'] as const).map((m) => (
              <button key={m} onClick={() => setLiveMetric(m)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${liveMetric === m ? 'bg-primary-700 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                {m === 'harmonic' ? '3rd Harmonic' : m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {liveHistory.length === 0
          ? <div className="h-48 flex items-center justify-center text-gray-600 text-sm">Waiting for live data…</div>
          : <ResponsiveContainer width="100%" height={200}>
              <LineChart data={liveHistory} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <Tooltip content={<TT />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                {(liveLines[liveMetric] ?? []).map(({ key, color }) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
        }
      </div>

      {/* Real-time metrics grid */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Real-Time Readings</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <MetricCard label="Avg Voltage" value={avgV} unit="V" color={vColor} />
          <MetricCard label="Avg Current" value={avgI} unit="A" color="blue" />
          <MetricCard label="Power (kW)" value={e ? parseFloat(String(e.power_kw)).toFixed(2) : null} color="green" />
          <MetricCard label="KVA (Max Demand)" value={e ? parseFloat(String(e.power_kva)).toFixed(2) : null} color="purple" />
          <MetricCard label="Power Factor" value={e ? parseFloat(String(e.power_factor)).toFixed(3) : null} color={pfColor} />
          <MetricCard label="3rd Harmonic" value={avgH3} unit="%" color={h3Color} sub="Avg R/Y/B" />
        </div>
      </div>

      {/* Phase-level detail */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Three-Phase Detail</p>
        <div className="grid grid-cols-3 gap-2.5">
          <MetricCard label="V-R" value={e ? parseFloat(String(e.voltage_r)).toFixed(1) : null} unit="V" color="red" />
          <MetricCard label="V-Y" value={e ? parseFloat(String(e.voltage_y)).toFixed(1) : null} unit="V" color="yellow" />
          <MetricCard label="V-B" value={e ? parseFloat(String(e.voltage_b)).toFixed(1) : null} unit="V" color="blue" />
          <MetricCard label="I-R" value={e ? parseFloat(String(e.current_r)).toFixed(1) : null} unit="A" color="red" />
          <MetricCard label="I-Y" value={e ? parseFloat(String(e.current_y)).toFixed(1) : null} unit="A" color="yellow" />
          <MetricCard label="I-B" value={e ? parseFloat(String(e.current_b)).toFixed(1) : null} unit="A" color="blue" />
          <MetricCard label="3H-R" value={e?.third_harmonic_r != null ? parseFloat(String(e.third_harmonic_r)).toFixed(2) : null} unit="%" color="red" />
          <MetricCard label="3H-Y" value={e?.third_harmonic_y != null ? parseFloat(String(e.third_harmonic_y)).toFixed(2) : null} unit="%" color="yellow" />
          <MetricCard label="3H-B" value={e?.third_harmonic_b != null ? parseFloat(String(e.third_harmonic_b)).toFixed(2) : null} unit="%" color="blue" />
          <MetricCard label="Frequency" value={e ? parseFloat(String(e.frequency)).toFixed(2) : null} unit="Hz" color="primary" />
          <MetricCard label="Time Period" value={timePeriodLabels[tp]} color="primary" />
          <MetricCard label="Flow Rate" value={d ? parseFloat(String(d.flow_rate)).toFixed(2) : '0.00'} unit="L/hr" color="orange" sub={`Total: ${fmt.lit(d?.total_volume)}`} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { liveReadings, activeAlerts } = useSocket();
  const { selectedPlantId } = usePlant();
  const [consumPeriod, setConsumPeriod] = useState<'daily'|'monthly'|'yearly'>('monthly');

  // All meters currently reporting for the selected plant (or the first
  // plant with any data, if none selected) - one entry per meter_id.
  const plantMeters: Map<string, LiveReadingPayload> = selectedPlantId
    ? liveReadings.get(selectedPlantId) ?? new Map()
    : Array.from(liveReadings.values())[0] ?? new Map();
  const meterReadings = Array.from(plantMeters.values());

  // The plant has multiple physical sections (P1, P4, ...), each fed by its
  // own incomer/generator - a single plant-wide CEB/Generator indicator
  // hides which section is actually on grid vs generator. Group meters by
  // their registered plant_section and show one indicator pair per section.
  const { data: metersData } = useQuery({
    queryKey: ['energy-meters-for-sections'],
    queryFn: () => settingsApi.getEnergyMeters().then((r) => r.data),
  });
  const meterSections = new Map<string, string>(
    (metersData?.meters ?? [])
      .filter((m: any) => (!selectedPlantId || m.plant_id === selectedPlantId) && m.plant_section)
      .map((m: any) => [m.meter_id, m.plant_section])
  );
  const sections = Array.from(new Set(meterSections.values())).sort();
  const sectionData = sections.map((section) => {
    const idsInSection = new Set(Array.from(meterSections.entries()).filter(([, s]) => s === section).map(([id]) => id));
    const readingsInSection = meterReadings.filter((r) => r.meter_id && idsInSection.has(r.meter_id));
    const sectionEnergy = aggregateEnergyReadings(readingsInSection.map((r) => r.energy).filter((x): x is EnergyReading => x != null));
    return {
      section,
      isCEB: sectionEnergy?.source !== 'GENERATOR',
      gen: readingsInSection.find((r) => r.generator != null)?.generator,
      readings: readingsInSection,
    };
  });

  const { data: statsData } = useQuery({
    queryKey: ['dashboard-stats', selectedPlantId],
    queryFn: () => readingsApi.getDashboardStats(selectedPlantId ? { plant_id: selectedPlantId } : {}).then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: dailyData } = useQuery({
    queryKey: ['daily-summary', selectedPlantId, consumPeriod],
    queryFn: () => readingsApi.getDailySummary({ plant_id: selectedPlantId ?? undefined }).then((r) => r.data),
    enabled: consumPeriod === 'daily',
    refetchInterval: 60000,
  });

  const { data: monthlyData } = useQuery({
    queryKey: ['monthly-summary', selectedPlantId, new Date().getFullYear()],
    queryFn: () => readingsApi.getMonthlySummary({ year: new Date().getFullYear(), plant_id: selectedPlantId ?? undefined }).then((r) => r.data),
    enabled: consumPeriod === 'monthly',
  });

  const { data: yearlyData } = useQuery({
    queryKey: ['yearly-summary', selectedPlantId],
    queryFn: () => readingsApi.getYearlySummary(selectedPlantId ? { plant_id: selectedPlantId } : {}).then((r) => r.data),
    enabled: consumPeriod === 'yearly',
  });

  const consumChartData = (() => {
    if (consumPeriod === 'daily') return (dailyData?.energy ?? []).slice().reverse().map((r: any) => ({ label: format(new Date(r.summary_date), 'dd MMM'), CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0, Day: +r.day_kwh||0, Peak: +r.peak_kwh||0, OffPeak: +r.off_peak_kwh||0 }));
    if (consumPeriod === 'monthly') return (monthlyData?.energy ?? []).map((r: any) => ({ label: format(new Date(r.month), "MMM ''yy"), CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0, Day: +r.day_kwh||0, Peak: +r.peak_kwh||0, OffPeak: +r.off_peak_kwh||0 }));
    return (yearlyData?.energy ?? []).slice().reverse().map((r: any) => ({ label: String(r.year), CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0 }));
  })();

  const dieselChartData = (() => {
    if (consumPeriod === 'daily') return (dailyData?.diesel ?? []).slice().reverse().map((r: any) => ({ label: format(new Date(r.summary_date), 'dd MMM'), Liters: +r.total_liters||0 }));
    if (consumPeriod === 'monthly') return (monthlyData?.diesel ?? []).map((r: any) => ({ label: format(new Date(r.month), "MMM ''yy"), Liters: +r.total_liters||0 }));
    return (yearlyData?.diesel ?? []).slice().reverse().map((r: any) => ({ label: String(r.year), Liters: +r.total_liters||0 }));
  })();

  const today = statsData?.today ?? {};
  const unack = activeAlerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="space-y-5">
      {/* Critical alert banner */}
      {unack > 0 && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700/50 rounded-xl px-4 py-3 flex items-center gap-3">
          <Zap className="w-4 h-4 text-red-600 dark:text-red-400 animate-pulse flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300 font-medium">{unack} unacknowledged alert{unack > 1 ? 's' : ''} — check Alerts page</p>
        </div>
      )}

      {/* Today stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Today Energy" value={fmt.kwh(today?.energy?.total_kwh)} color="primary" sub={`CEB: ${fmt.kwh(today?.energy?.ceb_kwh)}`} />
        <MetricCard label="Today Diesel" value={fmt.lit(today?.diesel?.total_liters)} color="orange" sub={`Run: ${fmt.n2(today?.diesel?.run_hours)} hrs`} />
        <MetricCard label="Active Alerts" value={statsData?.activeAlerts ?? '—'} color={statsData?.activeAlerts > 0 ? 'red' : 'green'} sub={`${statsData?.todayInterruptions ?? 0} interruptions`} />
        <MetricCard label="Max KVA Today" value={fmt.kva(today?.energy?.max_kva)} color="purple" sub={`Avg PF: ${fmt.pf(today?.energy?.avg_power_factor)}`} />
      </div>

      {/* Power source indicator - one CEB/Generator pair per plant section */}
      {sectionData.map(({ section, isCEB: sectionIsCEB, gen: sectionGen }) => (
        <div key={section}>
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">{section}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={`border rounded-xl p-3 flex items-center gap-3 col-span-2 ${sectionIsCEB ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700/40' : 'bg-gray-100 dark:bg-gray-800/30 border-gray-300 dark:border-gray-700/30'}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${sectionIsCEB ? 'bg-green-50 dark:bg-green-800/60' : 'bg-gray-100 dark:bg-gray-800'}`}>
                <Zap className={`w-5 h-5 ${sectionIsCEB ? 'text-green-700 dark:text-green-300' : 'text-gray-500'}`} />
              </div>
              <div>
                <p className={`font-semibold text-sm ${sectionIsCEB ? 'text-green-700 dark:text-green-300' : 'text-gray-500'}`}>CEB {sectionIsCEB && <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse ml-1" />}</p>
                <p className="text-xs text-gray-500">Grid Supply</p>
              </div>
            </div>
            <div className={`border rounded-xl p-3 flex items-center gap-3 col-span-2 ${!sectionIsCEB ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700/40' : 'bg-gray-100 dark:bg-gray-800/30 border-gray-300 dark:border-gray-700/30'}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${!sectionIsCEB ? 'bg-orange-50 dark:bg-orange-800/60' : 'bg-gray-100 dark:bg-gray-800'}`}>
                <Cpu className={`w-5 h-5 ${!sectionIsCEB ? 'text-orange-700 dark:text-orange-300' : 'text-gray-500'}`} />
              </div>
              <div>
                <p className={`font-semibold text-sm ${!sectionIsCEB ? 'text-orange-700 dark:text-orange-300' : 'text-gray-500'}`}>Generator {sectionGen?.status === 'ON' && !sectionIsCEB && <span className="inline-block w-2 h-2 bg-orange-400 rounded-full animate-pulse ml-1" />}</p>
                <p className="text-xs text-gray-500">{sectionGen?.status ?? 'STANDBY'} — {sectionGen?.generator_id ?? '—'}</p>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Plant 1 / Plant 4 side-by-side sections */}
      {sectionData.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {sectionData.map(({ section, readings }) => (
            <SectionColumn key={section} section={section} meterReadings={readings} />
          ))}
        </div>
      )}

      {/* Consumption charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Energy consumption */}
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2"><Zap className="w-4 h-4 text-primary-600 dark:text-primary-400" />Energy Consumption (kWh)</p>
            <div className="flex gap-1 ml-auto">
              {(['daily','monthly','yearly'] as const).map((p) => (
                <button key={p} onClick={() => setConsumPeriod(p)}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${consumPeriod === p ? 'bg-primary-700 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={consumChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<TT />} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
              <Bar dataKey="CEB" fill="#22c55e" maxBarSize={30} radius={[2,2,0,0]} />
              <Bar dataKey="Generator" fill="#f97316" maxBarSize={30} radius={[2,2,0,0]} />
              {consumPeriod !== 'yearly' && <>
                <Bar dataKey="Day" fill="#3b82f6" maxBarSize={30} radius={[2,2,0,0]} />
                <Bar dataKey="Peak" fill="#f59e0b" maxBarSize={30} radius={[2,2,0,0]} />
                <Bar dataKey="OffPeak" fill="#8b5cf6" maxBarSize={30} radius={[2,2,0,0]} />
              </>}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Diesel consumption */}
        <div className="card">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2"><Droplets className="w-4 h-4 text-orange-600 dark:text-orange-400" />Diesel Consumption (Litres)</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dieselChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<TT />} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
              <Area type="monotone" dataKey="Liters" stroke="#f97316" fill="#f9731620" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
