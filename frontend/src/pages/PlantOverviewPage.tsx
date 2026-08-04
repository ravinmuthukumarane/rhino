import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../services/api';
import { usePlant } from '../context/PlantContext';
import { useSocket } from '../context/SocketContext';
import { TrendingUp, AlertCircle, Zap, Droplets, Gauge } from 'lucide-react';

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

  // No per-reading severity field on EnergyReading - derive from power
  // factor using the same thresholds as the Dashboard's live PF indicator.
  const getSeverity = (reading: any): 'critical' | 'warning' | 'normal' => {
    const pf = reading?.power_factor != null ? parseFloat(String(reading.power_factor)) : null;
    if (pf == null) return 'normal';
    if (pf < 0.80) return 'critical';
    if (pf < 0.85) return 'warning';
    return 'normal';
  };

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
  const latestByMeter: Record<string, any> = {};
  for (const [meterId, payload] of plantMeterReadings) {
    if (payload.energy) latestByMeter[meterId] = payload.energy;
  }

  return (
    <div className="space-y-6">
      {/* Energy Meters */}
      {meters && meters.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Energy Meters</h2>
            <span className="ml-auto text-xs text-gray-500">({meters.length} meters)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {meters.map((meter: any) => {
              const reading = latestByMeter[meter.meter_id];
              return (
                <div
                  key={meter.meter_id}
                  className={`card border-2 p-4 ${getStatusColor(reading)} transition-all`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{meter.name}</p>
                      <p className="text-xs text-gray-500">{meter.meter_id}</p>
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
                        <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.power_kw != null ? parseFloat(String(reading.power_kw)).toFixed(2) : '—'} kW</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">KVA</span>
                        <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.power_kva != null ? parseFloat(String(reading.power_kva)).toFixed(2) : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">PF</span>
                        <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.power_factor != null ? parseFloat(String(reading.power_factor)).toFixed(3) : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">3rd Harmonic</span>
                        <span className="text-gray-800 dark:text-gray-200 font-mono">{reading.third_harmonic_r != null ? parseFloat(String(reading.third_harmonic_r)).toFixed(2) : '—'}%</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No readings yet</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Flow Meters */}
      {flowmeters && flowmeters.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Droplets className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Flow Meters</h2>
            <span className="ml-auto text-xs text-gray-500">({flowmeters.length} meters)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flowmeters.map((meter: any) => (
              <div key={meter.meter_id} className="card border border-blue-300 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/20 p-4">
                <p className="font-semibold text-blue-800 dark:text-blue-200 text-sm">{meter.name}</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{meter.meter_id}</p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">Flow Meter</p>
              </div>
            ))}
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
