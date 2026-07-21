import { useLocation } from 'react-router-dom';
import { Bell, X, ChevronDown, Sun, Moon } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { usePlant } from '../../context/PlantContext';
import { useTheme } from '../../context/ThemeContext';
import { useState } from 'react';
import { fmt } from '../../utils/formatters';
import { getTimePeriod, timePeriodLabels, timePeriodColors } from '../../utils/timeUtils';

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/overview': 'Plant Overview',
  '/alerts': 'Alerts',
  '/reports': 'Reports',
  '/reports/tariff': 'Tariff Report',
  '/reports/generator-analysis': 'Generator Analysis',
  '/setpoints': 'Alert Setpoints',
  '/device-settings': 'Device Settings',
  '/users': 'User Management',
};

export default function Header() {
  const location = useLocation();
  const { activeAlerts, dismissAlert } = useSocket();
  const { plants, selectedPlantId, setSelectedPlantId } = usePlant();
  const { theme, toggleTheme } = useTheme();
  const [showAlerts, setShowAlerts] = useState(false);
  const unack = activeAlerts.filter((a) => !a.acknowledged).length;
  const period = getTimePeriod();

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 flex-shrink-0 gap-4">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{titles[location.pathname] ?? 'Energy Monitor'}</h2>

      <div className="flex items-center gap-3 ml-auto">
        {/* Plant selector */}
        {plants.length > 0 && (
          <div className="relative">
            <select value={selectedPlantId ?? ''}
              onChange={(e) => setSelectedPlantId(e.target.value || null)}
              className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 text-xs rounded-lg px-3 py-1.5 pr-7 appearance-none focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer">
              {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown className="w-3 h-3 text-gray-600 dark:text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}

        {/* Time period */}
        <div className="text-xs px-2 py-1 rounded-full border"
          style={{ color: timePeriodColors[period], borderColor: timePeriodColors[period] + '60', background: timePeriodColors[period] + '15' }}>
          {timePeriodLabels[period]}
        </div>

        {/* Theme toggle */}
        <button onClick={toggleTheme}
          className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Alert bell */}
        <div className="relative">
          <button onClick={() => setShowAlerts(!showAlerts)}
            className="relative p-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
            <Bell className="w-5 h-5" />
            {unack > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
          </button>
          {showAlerts && (
            <div className="absolute right-0 top-10 w-80 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl shadow-2xl z-50">
              <div className="p-3 border-b border-gray-300 dark:border-gray-700 flex items-center justify-between">
                <span className="font-medium text-sm text-gray-800 dark:text-gray-200">Active Alerts ({unack})</span>
                <button onClick={() => setShowAlerts(false)} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><X className="w-4 h-4" /></button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {activeAlerts.length === 0
                  ? <p className="p-4 text-sm text-gray-500 text-center">No active alerts</p>
                  : activeAlerts.slice(0, 10).map((a) => (
                    <div key={a.id} className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-start gap-2 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium mb-0.5 ${a.severity === 'critical' ? 'text-red-600 dark:text-red-400' : a.severity === 'warning' ? 'text-yellow-600 dark:text-yellow-400' : 'text-blue-600 dark:text-blue-400'}`}>
                          {a.alert_type.replace(/_/g, ' ').toUpperCase()}
                          {a.plant_name && <span className="ml-1 text-gray-500 font-normal">({a.plant_name})</span>}
                        </div>
                        <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{a.message}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{fmt.datetime(a.created_at)}</p>
                      </div>
                      <button onClick={() => dismissAlert(a.id)} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-400 flex-shrink-0 mt-0.5">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        <span className="text-xs text-gray-500 hidden sm:block">
          {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
    </header>
  );
}
