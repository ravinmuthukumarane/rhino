import { useQuery } from '@tanstack/react-query';
import { readingsApi } from '../../services/api';
import { Power, Clock, Droplets } from 'lucide-react';
import { fmt } from '../../utils/formatters';

export default function GeneratorStatusCard({ liveStatus }) {
  const { data } = useQuery({
    queryKey: ['generator-events'],
    queryFn: () => readingsApi.getGeneratorEvents({ limit: 5 }),
    refetchInterval: 30000,
  });

  const events = data?.data?.events || [];
  const currentStatus = liveStatus || events[0]?.status || 'OFF';
  const isRunning = currentStatus === 'ON';

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Generator Status</span>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
          ${isRunning ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40' : 'bg-gray-700/50 text-gray-400 border border-gray-600/40'}`}>
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-orange-400 animate-pulse' : 'bg-gray-500'}`} />
          {isRunning ? 'RUNNING' : 'STANDBY'}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center
          ${isRunning ? 'bg-orange-900/50 border border-orange-700/50' : 'bg-gray-800 border border-gray-700'}`}>
          <Power className={`w-7 h-7 ${isRunning ? 'text-orange-400' : 'text-gray-500'}`} />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-300">GEN1</p>
          <p className="text-xs text-gray-500">Diesel Generator</p>
        </div>
      </div>

      <div className="border-t border-gray-800 pt-3">
        <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> Recent Events
        </p>
        <div className="space-y-1.5 max-h-28 overflow-y-auto">
          {events.length === 0
            ? <p className="text-xs text-gray-600">No events recorded</p>
            : events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between text-xs">
                <span className={`font-medium ${ev.status === 'ON' ? 'text-orange-400' : 'text-gray-400'}`}>
                  {ev.status}
                </span>
                <span className="text-gray-500">{fmt.datetime(ev.recorded_at)}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
