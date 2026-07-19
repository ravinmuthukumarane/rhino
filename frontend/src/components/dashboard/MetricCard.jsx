import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MetricCard({ label, value, unit, icon: Icon, color = 'primary', status, trend, sublabel }) {
  const colors = {
    primary: { bg: 'bg-primary-900/40', border: 'border-primary-800/50', icon: 'text-primary-400', value: 'text-primary-300' },
    green:   { bg: 'bg-green-900/30',   border: 'border-green-800/40',   icon: 'text-green-400',   value: 'text-green-300'   },
    yellow:  { bg: 'bg-yellow-900/30',  border: 'border-yellow-800/40',  icon: 'text-yellow-400',  value: 'text-yellow-300'  },
    red:     { bg: 'bg-red-900/30',     border: 'border-red-800/40',     icon: 'text-red-400',     value: 'text-red-300'     },
    blue:    { bg: 'bg-blue-900/30',    border: 'border-blue-800/40',    icon: 'text-blue-400',    value: 'text-blue-300'    },
    purple:  { bg: 'bg-purple-900/30',  border: 'border-purple-800/40',  icon: 'text-purple-400',  value: 'text-purple-300'  },
  };

  const c = colors[color] || colors.primary;

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4 flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg bg-gray-900/50 flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${c.icon}`} />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline gap-1.5">
          <span className={`text-2xl font-bold ${c.value}`}>{value ?? '—'}</span>
          {unit && <span className="text-sm text-gray-500">{unit}</span>}
        </div>
        {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
      </div>

      {(status || trend) && (
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium
              ${status === 'normal' ? 'bg-green-500/20 text-green-400' :
                status === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                status === 'critical' ? 'bg-red-500/20 text-red-400' :
                'bg-gray-700 text-gray-400'}`}>
              {status}
            </span>
          )}
          {trend === 'up' && <TrendingUp className="w-4 h-4 text-red-400" />}
          {trend === 'down' && <TrendingDown className="w-4 h-4 text-green-400" />}
          {trend === 'stable' && <Minus className="w-4 h-4 text-gray-400" />}
        </div>
      )}
    </div>
  );
}
