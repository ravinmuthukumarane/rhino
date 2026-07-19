import { AlertCircle } from 'lucide-react';

interface AlarmIndicatorProps {
  severity: 'critical' | 'warning' | 'info';
  count: number;
  onClick?: () => void;
}

export default function AlarmIndicator({ severity, count, onClick }: AlarmIndicatorProps) {
  const colors = {
    critical: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500',
  };

  const pulseClass = severity === 'critical' ? 'animate-pulse' : '';

  return (
    <button
      onClick={onClick}
      className={`relative p-2 rounded-lg ${colors[severity]} hover:opacity-90 transition-opacity ${pulseClass}`}
    >
      <AlertCircle className="w-5 h-5 text-white" />
      {count > 0 && (
        <span className="absolute -top-2 -right-2 bg-white text-red-600 rounded-full w-6 h-6 text-xs font-bold flex items-center justify-center animate-bounce">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
