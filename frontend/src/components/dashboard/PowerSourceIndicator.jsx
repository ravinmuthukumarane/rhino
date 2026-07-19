import { Zap, Cpu } from 'lucide-react';

export default function PowerSourceIndicator({ source, timePeriod }) {
  const isCEB = source === 'CEB' || !source;
  const periodColors = { day: '#22c55e', peak: '#f59e0b', off_peak: '#3b82f6' };
  const periodColor = periodColors[timePeriod] || '#6b7280';
  const periodLabel = { day: 'Day', peak: 'Peak', off_peak: 'Off-Peak' }[timePeriod] || '—';

  return (
    <div className="card flex flex-col gap-4">
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Power Source</span>

      <div className="flex items-center gap-4">
        <div className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all
          ${isCEB
            ? 'bg-green-900/30 border-green-700/50'
            : 'bg-gray-800/40 border-gray-700/30 opacity-50'}`}>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isCEB ? 'bg-green-800/60' : 'bg-gray-800'}`}>
            <Zap className={`w-5 h-5 ${isCEB ? 'text-green-300' : 'text-gray-500'}`} />
          </div>
          <div>
            <p className={`font-semibold text-sm ${isCEB ? 'text-green-300' : 'text-gray-500'}`}>CEB</p>
            <p className="text-xs text-gray-500">Grid Power</p>
          </div>
          {isCEB && (
            <div className="ml-auto w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          )}
        </div>

        <div className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all
          ${!isCEB
            ? 'bg-orange-900/30 border-orange-700/50'
            : 'bg-gray-800/40 border-gray-700/30 opacity-50'}`}>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${!isCEB ? 'bg-orange-800/60' : 'bg-gray-800'}`}>
            <Cpu className={`w-5 h-5 ${!isCEB ? 'text-orange-300' : 'text-gray-500'}`} />
          </div>
          <div>
            <p className={`font-semibold text-sm ${!isCEB ? 'text-orange-300' : 'text-gray-500'}`}>Generator</p>
            <p className="text-xs text-gray-500">Backup</p>
          </div>
          {!isCEB && (
            <div className="ml-auto w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-gray-800">
        <div className="w-2 h-2 rounded-full" style={{ background: periodColor }} />
        <span className="text-xs text-gray-400">Time Period: </span>
        <span className="text-xs font-medium" style={{ color: periodColor }}>{periodLabel}</span>
      </div>
    </div>
  );
}
