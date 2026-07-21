import { NavLink } from 'react-router-dom';
import { Zap, LayoutDashboard, Bell, FileText, Settings, Users, LogOut, Wifi, WifiOff, Factory } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/overview', icon: Factory, label: 'Plant Overview' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/reports', icon: FileText, label: 'Reports' },
  { to: '/reports/tariff', icon: FileText, label: '  ├─ Tariff Report' },
  { to: '/reports/generator-analysis', icon: FileText, label: '  ├─ Generator Analysis' },
  { to: '/setpoints', icon: Settings, label: 'Setpoints', adminOnly: true },
  { to: '/device-settings', icon: Factory, label: 'Device Settings', adminOnly: true },
  { to: '/users', icon: Users, label: 'Users', adminOnly: true },
];

export default function Sidebar() {
  const { user, logout, isAdmin } = useAuth();
  const { connected, activeAlerts } = useSocket();
  const unack = activeAlerts.filter((a) => !a.acknowledged).length;

  return (
    <aside className="w-60 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full flex-shrink-0">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary-800 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-primary-300" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-white text-sm leading-tight">Energy Monitor</p>
            <div className="flex items-center gap-1 mt-0.5">
              {connected
                ? <><Wifi className="w-3 h-3 text-green-600 dark:text-green-400" /><span className="text-green-600 dark:text-green-400 text-xs">Live</span></>
                : <><WifiOff className="w-3 h-3 text-gray-500" /><span className="text-gray-500 text-xs">Offline</span></>}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label, end, adminOnly }) => {
          if (adminOnly && !isAdmin) return null;
          return (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                 ${isActive ? 'bg-primary-800/60 text-primary-300' : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {label === 'Alerts' && unack > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {unack > 9 ? '9+' : unack}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-800 dark:text-gray-200 flex-shrink-0">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{user?.name}</p>
            <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
          </div>
        </div>
        <button onClick={logout}
          className="flex items-center gap-3 px-3 py-2 w-full text-left rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </aside>
  );
}
