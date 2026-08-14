import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Zap, Gauge, BarChart2, Droplets, Cpu, TrendingUp } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSocket } from '../context/SocketContext';
import { usePlant } from '../context/PlantContext';
import { readingsApi, settingsApi } from '../services/api';
import { fmt, numFmt } from '../utils/formatters';
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
  ? <div className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2 text-xs"><p className="text-gray-700 dark:text-gray-300 mb-1">{label}</p>{payload.map((p: any) => <div key={p.name} className="flex items-center gap-1.5 mb-0.5"><div className="w-2 h-2 rounded-full" style={{ background: p.color }} /><span className="text-gray-600 dark:text-gray-400">{p.name}:</span><span className="text-gray-900 dark:text-gray-100 font-medium">{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span></div>)}</div>
  : null;

type ConsumPeriod = 'daily' | 'monthly' | 'yearly';
// 'source' = CEB vs Generator, 'tariff' = Day/Peak/Off-Peak. Kept as separate
// views rather than 5 simultaneous bars - the two breakdowns answer different
// questions (grid dependency vs tariff exposure) and rarely need comparing at once.
// Yearly summaries don't carry the tariff breakdown, so 'tariff' only applies
// to daily/monthly.
type ConsumView = 'source' | 'tariff';

// Shared by the plant-wide fallback and each per-section column - turns the
// daily/monthly/yearly summary responses into the shape recharts expects.
function buildConsumChartData(period: ConsumPeriod, view: ConsumView, dailyData: any, monthlyData: any, yearlyData: any) {
  const row = (label: string, r: any) => view === 'tariff'
    ? { label, Day: +r.day_kwh||0, Peak: +r.peak_kwh||0, OffPeak: +r.off_peak_kwh||0 }
    : { label, CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0 };
  if (period === 'daily') return (dailyData?.energy ?? []).slice().reverse().map((r: any) => row(format(new Date(r.summary_date), 'dd MMM'), r));
  if (period === 'monthly') return (monthlyData?.energy ?? []).map((r: any) => row(format(new Date(r.month), "MMM ''yy"), r));
  return (yearlyData?.energy ?? []).slice().reverse().map((r: any) => ({ label: String(r.year), CEB: +r.ceb_kwh||0, Generator: +r.generator_kwh||0 }));
}

function buildDieselChartData(period: ConsumPeriod, dailyData: any, monthlyData: any, yearlyData: any) {
  if (period === 'daily') return (dailyData?.diesel ?? []).slice().reverse().map((r: any) => ({ label: format(new Date(r.summary_date), 'dd MMM'), Liters: +r.total_liters||0 }));
  if (period === 'monthly') return (monthlyData?.diesel ?? []).map((r: any) => ({ label: format(new Date(r.month), "MMM ''yy"), Liters: +r.total_liters||0 }));
  return (yearlyData?.diesel ?? []).slice().reverse().map((r: any) => ({ label: String(r.year), Liters: +r.total_liters||0 }));
}

// One column of the Live Trend / Real-Time Readings / Phase Detail blocks,
// scoped to a single plant section (e.g. "P1" or "P4") so the two sections
// can be compared side by side instead of being merged into one plant-wide view.
// The section heading itself is rendered by the caller, above the rest of
// that section's block (stats row, source indicator, this, consumption charts).
function SectionColumn({ meterReadings }: { meterReadings: LiveReadingPayload[] }) {
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
          <MetricCard label="Power (kW)" value={e ? numFmt(e.power_kw, 2) : null} color="green" />
          <MetricCard label="KVA (Max Demand)" value={e ? numFmt(e.power_kva, 2) : null} color="purple" />
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
          <MetricCard label="Flow Rate" value={d ? numFmt(d.flow_rate, 2) : '0.00'} unit="L/hr" color="orange" sub={`Total: ${fmt.lit(d?.total_volume)}`} />
        </div>
      </div>
    </div>
  );
}

// Shared by EnergyConsumptionCard/DieselConsumptionCard - the daily/monthly/
// yearly summary endpoints return both energy and diesel together, and both
// cards request off the same queryKey shape, so when their periods happen to
// match react-query dedupes it into a single request; when they differ each
// card gets its own independent fetch.
function useConsumptionSummary(period: ConsumPeriod, selectedPlantId: string | null, section?: string) {
  const params = { plant_id: selectedPlantId ?? undefined, ...(section ? { plant_section: section } : {}) };
  const { data: dailyData } = useQuery({
    queryKey: ['daily-summary', selectedPlantId, section],
    queryFn: () => readingsApi.getDailySummary(params).then((r) => r.data),
    enabled: period === 'daily',
    refetchInterval: 60000,
  });
  const { data: monthlyData } = useQuery({
    queryKey: ['monthly-summary', selectedPlantId, section, new Date().getFullYear()],
    queryFn: () => readingsApi.getMonthlySummary({ ...params, year: new Date().getFullYear() }).then((r) => r.data),
    enabled: period === 'monthly',
  });
  const { data: yearlyData } = useQuery({
    queryKey: ['yearly-summary', selectedPlantId, section],
    queryFn: () => readingsApi.getYearlySummary(params).then((r) => r.data),
    enabled: period === 'yearly',
  });
  return { dailyData, monthlyData, yearlyData };
}

function PeriodToggle({ period, setPeriod }: { period: ConsumPeriod; setPeriod: (p: ConsumPeriod) => void }) {
  return (
    <div className="flex gap-1 ml-auto">
      {(['daily','monthly','yearly'] as const).map((p) => (
        <button key={p} onClick={() => setPeriod(p)}
          className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${period === p ? 'bg-primary-700 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  );
}

// Owns its own Daily/Monthly/Yearly toggle, independent of DieselConsumptionCard.
function EnergyConsumptionCard({ selectedPlantId, section }: { selectedPlantId: string | null; section?: string }) {
  const [period, setPeriod] = useState<ConsumPeriod>('monthly');
  const [view, setView] = useState<ConsumView>('source');
  const { dailyData, monthlyData, yearlyData } = useConsumptionSummary(period, selectedPlantId, section);
  const effectiveView: ConsumView = period === 'yearly' ? 'source' : view;
  const consumChartData = buildConsumChartData(period, effectiveView, dailyData, monthlyData, yearlyData);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2"><Zap className="w-4 h-4 text-primary-600 dark:text-primary-400" />Energy Consumption (kWh)</p>
        <select value={view} onChange={(e) => setView(e.target.value as ConsumView)} disabled={period === 'yearly'}
          className="input py-1 text-xs w-auto ml-2 disabled:opacity-50" title={period === 'yearly' ? 'Tariff breakdown not available for yearly' : undefined}>
          <option value="source">Source (CEB/Generator)</option>
          <option value="tariff">Tariff (Day/Peak/Off-Peak)</option>
        </select>
        <PeriodToggle period={period} setPeriod={setPeriod} />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={consumChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <Tooltip content={<TT />} />
          <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
          {effectiveView === 'source' ? <>
            <Bar dataKey="CEB" fill="#22c55e" maxBarSize={30} radius={[2,2,0,0]} />
            <Bar dataKey="Generator" fill="#f97316" maxBarSize={30} radius={[2,2,0,0]} />
          </> : <>
            <Bar dataKey="Day" fill="#3b82f6" maxBarSize={30} radius={[2,2,0,0]} />
            <Bar dataKey="Peak" fill="#f59e0b" maxBarSize={30} radius={[2,2,0,0]} />
            <Bar dataKey="OffPeak" fill="#8b5cf6" maxBarSize={30} radius={[2,2,0,0]} />
          </>}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Owns its own Daily/Monthly/Yearly toggle, independent of EnergyConsumptionCard.
function DieselConsumptionCard({ selectedPlantId, section }: { selectedPlantId: string | null; section?: string }) {
  const [period, setPeriod] = useState<ConsumPeriod>('daily');
  const { dailyData, monthlyData, yearlyData } = useConsumptionSummary(period, selectedPlantId, section);
  const dieselChartData = buildDieselChartData(period, dailyData, monthlyData, yearlyData);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2"><Droplets className="w-4 h-4 text-orange-600 dark:text-orange-400" />Diesel Consumption (Litres)</p>
        <PeriodToggle period={period} setPeriod={setPeriod} />
      </div>
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
  );
}

// Per-section visual identity (border/tint/badge) so Plant 1 and Plant 4 read
// as clearly separate regions rather than two unlabeled grid cells. Indexed
// by section position, so a third/fourth section still gets a distinct look.
const SECTION_THEMES = [
  { ring: 'ring-1 ring-blue-200 dark:ring-blue-900/50', bg: 'bg-blue-50/50 dark:bg-blue-950/10', border: 'border-blue-200 dark:border-blue-900/50', badge: 'bg-blue-600 dark:bg-blue-500' },
  { ring: 'ring-1 ring-purple-200 dark:ring-purple-900/50', bg: 'bg-purple-50/50 dark:bg-purple-950/10', border: 'border-purple-200 dark:border-purple-900/50', badge: 'bg-purple-600 dark:bg-purple-500' },
  { ring: 'ring-1 ring-emerald-200 dark:ring-emerald-900/50', bg: 'bg-emerald-50/50 dark:bg-emerald-950/10', border: 'border-emerald-200 dark:border-emerald-900/50', badge: 'bg-emerald-600 dark:bg-emerald-500' },
  { ring: 'ring-1 ring-amber-200 dark:ring-amber-900/50', bg: 'bg-amber-50/50 dark:bg-amber-950/10', border: 'border-amber-200 dark:border-amber-900/50', badge: 'bg-amber-600 dark:bg-amber-500' },
];

// Everything for one plant section (P1, P4, ...): its own Daily/Monthly/Yearly
// toggle and the stats/consumption queries that depend on it, so switching
// one plant's period never touches another plant's charts.
function SectionBlock({ section, isCEB: sectionIsCEB, gen: sectionGen, readings, selectedPlantId, theme }: {
  section: string; isCEB: boolean; gen: any; readings: LiveReadingPayload[]; selectedPlantId: string | null; theme: typeof SECTION_THEMES[number];
}) {
  const { data: statsData } = useQuery({
    queryKey: ['dashboard-stats', selectedPlantId, section],
    queryFn: () => readingsApi.getDashboardStats({ ...(selectedPlantId ? { plant_id: selectedPlantId } : {}), plant_section: section }).then((r) => r.data),
    refetchInterval: 60000,
  });

  const today = statsData?.today ?? {};

  return (
    <div className={`rounded-2xl border ${theme.border} ${theme.bg} ${theme.ring} p-4 sm:p-5 space-y-5`}>
      <div className="flex items-center gap-2.5">
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">Plant {section.replace(/^P/i, '')}</p>
      </div>

      {/* Today stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Today Energy" value={fmt.kwh(today?.energy?.total_kwh)} color="primary" sub={`CEB: ${fmt.kwh(today?.energy?.ceb_kwh)}`} />
        <MetricCard label="Today Diesel" value={fmt.lit(today?.diesel?.total_liters)} color="orange" sub={`Run: ${fmt.n2(today?.diesel?.run_hours)} hrs`} />
        <MetricCard label="Active Alerts" value={statsData?.activeAlerts ?? '—'} color={statsData?.activeAlerts > 0 ? 'red' : 'green'} sub={`${statsData?.todayInterruptions ?? 0} interruptions`} />
        <MetricCard label="Max KVA Today" value={fmt.kva(today?.energy?.max_kva)} color="purple" sub={`Avg PF: ${fmt.pf(today?.energy?.avg_power_factor)}`} />
      </div>

      {/* Power source indicator */}
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

      {/* Live trend / real-time / phase-level detail */}
      <SectionColumn meterReadings={readings} />

      {/* Consumption charts - each card owns its own Daily/Monthly/Yearly toggle */}
      <div className="space-y-5">
        <EnergyConsumptionCard selectedPlantId={selectedPlantId} section={section} />
        <DieselConsumptionCard selectedPlantId={selectedPlantId} section={section} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { liveReadings, activeAlerts } = useSocket();
  const { selectedPlantId } = usePlant();

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

  // Plant-wide fallback for installs that haven't tagged meters with a
  // plant_section yet - without this, sections.length === 0 would leave the
  // whole dashboard blank instead of degrading to one merged view.
  const { data: statsData } = useQuery({
    queryKey: ['dashboard-stats', selectedPlantId],
    queryFn: () => readingsApi.getDashboardStats(selectedPlantId ? { plant_id: selectedPlantId } : {}).then((r) => r.data),
    enabled: sections.length === 0,
    refetchInterval: 60000,
  });

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

      {sectionData.length > 0 ? (
        /* Plant 1 / Plant 4 side-by-side, each in its own tinted/bordered
           card so the two are visually unmistakable - every stat, indicator,
           chart and trend inside is scoped to that section's own meters and
           has its own independent Daily/Monthly/Yearly toggle. */
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {sectionData.map((sd, i) => (
            <SectionBlock key={sd.section} {...sd} selectedPlantId={selectedPlantId} theme={SECTION_THEMES[i % SECTION_THEMES.length]} />
          ))}
        </div>
      ) : (
        <>
          {/* Today stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard label="Today Energy" value={fmt.kwh(today?.energy?.total_kwh)} color="primary" sub={`CEB: ${fmt.kwh(today?.energy?.ceb_kwh)}`} />
            <MetricCard label="Today Diesel" value={fmt.lit(today?.diesel?.total_liters)} color="orange" sub={`Run: ${fmt.n2(today?.diesel?.run_hours)} hrs`} />
            <MetricCard label="Active Alerts" value={statsData?.activeAlerts ?? '—'} color={statsData?.activeAlerts > 0 ? 'red' : 'green'} sub={`${statsData?.todayInterruptions ?? 0} interruptions`} />
            <MetricCard label="Max KVA Today" value={fmt.kva(today?.energy?.max_kva)} color="purple" sub={`Avg PF: ${fmt.pf(today?.energy?.avg_power_factor)}`} />
          </div>

          {/* Consumption charts - each card owns its own Daily/Monthly/Yearly toggle */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <EnergyConsumptionCard selectedPlantId={selectedPlantId} />
            <DieselConsumptionCard selectedPlantId={selectedPlantId} />
          </div>
        </>
      )}
    </div>
  );
}
