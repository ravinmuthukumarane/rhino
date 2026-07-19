import { useLocation } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { useState } from 'react';
import { fmt } from '../../utils/formatters';
import { getTimePeriod, timePeriodLabels, timePeriodColors } from '../../utils/timeUtils';

const pageTitles = {
  '/': 'Dashboard',
  '/alerts': 'Alerts',
  '/reports': 'Reports',
  '/setpoints': 'Alert Setpoints',
  '/users': 'User Management',
};

export default function Header() {
  const location = useLocation();
  const { activeAlerts, dismissAlert } = useSocket();
  const [showDropdown, setShowDropdown] = useState(false);
  const unack = activeAlerts.filter((a) => !a.acknowledged).length;
  const period = getTimePeriod();

  return (
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
      <h2 className="font-semibold text-gray-100">
        {pageTitles[location.pathname] || 'Energy Monitor'}
      </h2>

      <div className="flex items-center gap-4">
        <div className="text-xs px-2 py-1 rounded-full border"
          style={{ color: timePeriodColors[period], borderColor: timePeriodColors[period] + '60', background: timePeriodColors[period] + '15' }}>
          {timePeriodLabels[period]}
        </div>

        <div className="relative">
          <button onClick={() => setShowDropdown(!showDropdown)}
            className="relative p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors">
            <Bell className="w-5 h-5" />
            {unack > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-10 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50">
              <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                <span className="font-medium text-sm text-gray-200">Active Alerts</span>
                <button onClick={() => setShowDropdown(false)}
                  className="text-gray-500 hover:text-gray-200"><X className="w-4 h-4" /></button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {activeAlerts.length === 0
                  ? <p className="p-4 text-sm text-gray-500 text-center">No active alerts</p>
                  : activeAlerts.slice(0, 10).map((a) => (
                    <div key={a.id} className="p-3 border-b border-gray-800 flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium mb-0.5 ${a.severity === 'critical' ? 'text-red-400' : a.severity === 'warning' ? 'text-yellow-400' : 'text-blue-400'}`}>
                          {a.alert_type?.replace(/_/g, ' ').toUpperCase()}
                        </div>
                        <p className="text-xs text-gray-300 truncate">{a.message}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{fmt.datetime(a.created_at)}</p>
                      </div>
                      <button onClick={() => dismissAlert(a.id)} className="text-gray-600 hover:text-gray-400 flex-shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>

        <div className="text-xs text-gray-500">
          {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>
    </header>
  );
}
