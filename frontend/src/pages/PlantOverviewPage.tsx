import { useQuery } from '@tanstack/react-query';
import { settingsApi, readingsApi } from '../services/api';
import { usePlant } from '../context/PlantContext';
import { useSocket } from '../context/SocketContext';
import { AlertCircle, Zap, Droplets, Boxes } from 'lucide-react';
import { numFmt } from '../utils/formatters';

// Fixed display grouping for this page, in this fixed order, replacing the
// previous plain alphabetical listing. Matched by device name (falling back
// to meter_id) rather than plant_id, since these groups don't always line up
// cleanly with how meters happen to be assigned to a plant record in Device
// Settings - e.g. "P1-CELLULOSE" is a Plant 4 device despite its name.
const CATEGORIES: { label: string; names: string[] }[] = [
  {
    label: 'Plant 1',
    names: [
      'P1 PR',
      'P1 BM Section 1 -ST/TH/MD/TR',
      'P1 BM Section 2 -Vacuum/VAT/CON',
      'P1 STR/COMPRE',
      'P1 GENERATOR',
      'P1 -Main Incoming Energy',
      'P1 Compressor 1',
      'P1 Compressor 2',
      'P1 Compressor 3',
      'P1 Compressor 4',
      'P1 Air Dryer',
      'P1 STR',
    ],
  },
  {
    label: 'Plant 4',
    names: [
      'P2-PR',
      'P1-CELLULOSE',
      'OFFICE/WSHOP/CWA',
      'P4- BM',
      'P4- PR',
      'P4- STR/TR',
      'P4-SUB SECTION',
      'P4- BAG OPENER',
      'STRIP CEILING PLANT',
      'P4- ST/TR',
      'P4 GENERATOR',
      'P4 -Main Incoming Energy',
      'P4 Compressor 1',
      'P4 Compressor 2',
      'P4 Air Dryer',
    ],
  },
  {
    label: 'Flow Meters',
    names: ['P1 Diesel Flow Meter', 'P4 Diesel Flow Meter'],
  },
  {
    label: 'Other',
    names: ['WORKSHOP', 'CANTEEN', 'MAIN OFFICE'],
  },
];

const norm = (s?: string) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

type Device = { key: string; kind: 'energy' | 'flow'; meter: any };

export default function PlantOverviewPage() {
  const { selectedPlantId } = usePlant();
  const { liveReadings } = useSocket();

  const { data: meters } = useQuery({
    queryKey: ['energy-meters', selectedPlantId],
    queryFn: () =>
      settingsApi.getEnergyMeters().then((r) =>
        r.data.meters?.filter((m: any) => !selectedPlantId || m.plant_id === selectedPlantId)
      ),
  });

  const { data: flowmeters } = useQuery({
    queryKey: ['flow-meters', selectedPlantId],
    queryFn: () =>
      settingsApi.getFlowMeters().then((r) =>
        r.data.meters?.filter((m: any) => !selectedPlantId || m.plant_id === selectedPlantId)
      ),
  });

  // Seeds every meter card with its last-known DB reading on mount, so cards
  // don't sit on "No readings yet" until each meter's next MQTT push lands
  // (up to ~10s per meter). Live socket data below still takes priority once
  // it arrives - this is just the gap-filler for the first few seconds.
  const { data: snapshot } = useQuery({
    queryKey: ['readings-latest-by-meter', selectedPlantId],
    queryFn: () =>
      readingsApi.getLatestByMeter(selectedPlantId ? { plant_id: selectedPlantId } : {}).then((r) => r.data),
    staleTime: 15000,
  });

  // CRITICAL/WARNING badges disabled for now - this ran independently of
  // alert_setpoints.enabled (which only gates the backend alert pipeline),
  // so disabling alerts there never touched this card's badge. Was PF < 0.80
  // -> critical, PF < 0.85 -> warning; restore those thresholds to re-enable.
  const getSeverity = (_reading: any): 'critical' | 'warning' | 'normal' => 'normal';

  const getStatusColor = (reading: any) => {
    if (!reading) return 'bg-gray-200 dark:bg-gray-700 border-gray-400 dark:border-gray-600';
    const severity = getSeverity(reading);
    if (severity === 'critical') return 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700';
    if (severity === 'warning') return 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700';
    return 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700';
  };

  const getStatusText = (reading: any) => {
    if (!reading) return 'No data';
    const severity = getSeverity(reading);
    if (severity === 'critical') return 'CRITICAL';
    if (severity === 'warning') return 'WARNING';
    return 'NORMAL';
  };

  const getStatusTextColor = (reading: any) => {
    if (!reading) return 'text-gray-600 dark:text-gray-400';
    const severity = getSeverity(reading);
    if (severity === 'critical') return 'text-red-600 dark:text-red-400';
    if (severity === 'warning') return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  };

  const plantMeterReadings = selectedPlantId
    ? liveReadings.get(selectedPlantId) ?? new Map()
    : Array.from(liveReadings.values())[0] ?? new Map();

  // Start from the DB snapshot (last-known reading per meter), then let live
  // socket pushes override it - live data is always more current once it
  // arrives, but the snapshot avoids a blank/loading card in the meantime.
  const latestByMeter: Record<string, any> = { ...(snapshot?.energy ?? {}) };
  const latestFlowByMeter: Record<string, any> = { ...(snapshot?.diesel ?? {}) };
  for (const [meterId, payload] of plantMeterReadings) {
    if (payload.energy) latestByMeter[meterId] = payload.energy;
    if (payload.diesel) latestFlowByMeter[meterId] = payload.diesel;
  }

  const energyDevices: Device[] = (meters ?? []).map((m: any) => ({ key: `e-${m.meter_id}`, kind: 'energy', meter: m }));
  const flowDevices: Device[] = (flowmeters ?? []).map((m: any) => ({ key: `f-${m.meter_id}`, kind: 'flow', meter: m }));
  const allDevices: Device[] = [...energyDevices, ...flowDevices];
  const findDevice = (name: string) =>
    allDevices.find((d) => norm(d.meter.name) === norm(name) || norm(d.meter.meter_id) === norm(name));

  const categorized = CATEGORIES.map((cat) => ({
    label: cat.label,
    items: cat.names.map(findDevice).filter((d): d is Device => d != null),
  }));
  // Anything registered but not named in any category above still shows up
  // here, rather than silently disappearing from the page.
  const categorizedKeys = new Set(categorized.flatMap((c) => c.items.map((d) => d.key)));
  const leftover = allDevices.filter((d) => !categorizedKeys.has(d.key));

  const renderDevice = (d: Device) => {
    if (d.kind === 'energy') {
      const reading = latestByMeter[d.meter.meter_id];
      return (
        <div className={`card border-2 p-4 ${getStatusColor(reading)} transition-all`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{d.meter.name}</p>
              <p className="text-xs text-gray-500">{d.meter.meter_id}</p>
            </div>
            <div className={`text-xs font-bold px-2 py-1 rounded ${getStatusTextColor(reading)}`}>
              {getStatusText(reading)}
            </div>
          </div>

          {reading ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Voltage</span>
                <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.voltage_r != null ? parseFloat(String(reading.voltage_r)).toFixed(1) : '—'} V</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Current</span>
                <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.current_r != null ? parseFloat(String(reading.current_r)).toFixed(2) : '—'} A</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Power</span>
                <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.power_kw != null ? numFmt(reading.power_kw, 2) : '—'} kW</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">KVA</span>
                <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.power_kva != null ? numFmt(reading.power_kva, 2) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">PF</span>
                <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.power_factor != null ? parseFloat(String(reading.power_factor)).toFixed(3) : '—'}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">No readings yet</p>
          )}
        </div>
      );
    }

    const reading = latestFlowByMeter[d.meter.meter_id];
    return (
      <div className={`card border-2 p-4 transition-all ${reading ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700/50' : 'bg-gray-200 dark:bg-gray-700 border-gray-400 dark:border-gray-600'}`}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{d.meter.name}</p>
            <p className="text-xs text-gray-500">{d.meter.meter_id}</p>
          </div>
          <div className={`text-xs font-bold px-2 py-1 rounded ${reading ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
            {reading ? 'LIVE' : 'NO DATA'}
          </div>
        </div>

        {reading ? (
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Total Volume</span>
              <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.total_volume != null ? numFmt(reading.total_volume, 2) : '—'} L</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Last Reading</span>
              <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.recorded_at ? new Date(reading.recorded_at).toLocaleTimeString() : '—'}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">No readings yet</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {categorized.map((cat) => cat.items.length > 0 && (
        <div key={cat.label}>
          <div className="flex items-center gap-2 mb-4">
            {cat.label === 'Flow Meters' ? (
              <Droplets className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            ) : cat.label === 'Other' ? (
              <Boxes className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            ) : (
              <Zap className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            )}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{cat.label}</h2>
            <span className="ml-auto text-xs text-gray-500">({cat.items.length} devices)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cat.items.map((d) => <div key={d.key}>{renderDevice(d)}</div>)}
          </div>
        </div>
      ))}

      {leftover.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Boxes className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Uncategorized</h2>
            <span className="ml-auto text-xs text-gray-500">({leftover.length} devices)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {leftover.map((d) => <div key={d.key}>{renderDevice(d)}</div>)}
          </div>
        </div>
      )}

      {!meters?.length && !flowmeters?.length && (
        <div className="card text-center py-12">
          <AlertCircle className="w-8 h-8 text-gray-500 mx-auto mb-2" />
          <p className="text-gray-600 dark:text-gray-400">No devices registered for this plant</p>
          <p className="text-xs text-gray-600 mt-1">Go to Device Settings to add meters</p>
        </div>
      )}
    </div>
  );
}
