# Frontend Upgrade Guide

## Overview
This document covers all frontend changes needed to support:
- Light/Dark mode
- Device-level setpoints
- Advanced reporting (Tariff, Generator analysis)
- User preferences
- Visual alarm animations

## 1. Theme System (Light/Dark Mode)

### Step 1: Create Theme Context
**File:** `src/context/ThemeContext.tsx`

```typescript
import { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Load saved preference
    const saved = localStorage.getItem('theme') as Theme | null;
    if (saved) {
      setTheme(saved);
      applyTheme(saved);
    }
    setMounted(true);
  }, []);

  const toggleTheme = async () => {
    const newTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);

    // Save to backend
    try {
      await axios.put('/api/user/preferences', { theme: newTheme });
    } catch (err) {
      console.error('Failed to save theme:', err);
    }
  };

  const applyTheme = (t: Theme) => {
    const html = document.documentElement;
    if (t === 'light') {
      html.classList.remove('dark');
    } else {
      html.classList.add('dark');
    }
  };

  if (!mounted) return <>{children}</>;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

### Step 2: Update Tailwind Config
**File:** `frontend/tailwind.config.ts`

```typescript
export default {
  darkMode: 'class', // Use class-based dark mode
  theme: {
    extend: {
      colors: {
        light: {
          bg: '#ffffff',
          card: '#f5f5f5',
          text: '#1a1a1a',
        },
        dark: {
          bg: '#0f172a',
          card: '#1e293b',
          text: '#e2e8f0',
        },
      },
    },
  },
};
```

### Step 3: Update App.tsx
Wrap with ThemeProvider:

```typescript
import { ThemeProvider } from './context/ThemeContext';

export default function App() {
  return (
    <ThemeProvider>
      {/* existing content */}
    </ThemeProvider>
  );
}
```

## 2. Visual Alarm Animations

### Create Alarm Component
**File:** `src/components/AlarmIndicator.tsx`

```typescript
import { AlertCircle } from 'lucide-react';

interface AlarmIndicatorProps {
  severity: 'critical' | 'warning' | 'info';
  count: number;
  onClick?: () => void;
}

export default function AlarmIndicator({ severity, count, onClick }: AlarmIndicatorProps) {
  const colors = {
    critical: 'bg-red-500 animate-pulse',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500',
  };

  return (
    <button
      onClick={onClick}
      className={`relative p-2 rounded-lg ${colors[severity]} hover:opacity-90 transition-opacity`}
    >
      <AlertCircle className="w-5 h-5 text-white" />
      {count > 0 && (
        <span className="absolute top-0 right-0 bg-white text-red-600 rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center">
          {count}
        </span>
      )}
      {/* Pulsing animation for critical */}
      {severity === 'critical' && (
        <div className="absolute inset-0 rounded-lg animate-pulse bg-red-400 opacity-25"></div>
      )}
    </button>
  );
}
```

### Add to Header
**File:** `src/components/layout/Header.tsx` (update)

```typescript
import AlarmIndicator from '../AlarmIndicator';
import { useTheme } from '../../context/ThemeContext';

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const criticalCount = activeAlerts.filter(a => a.severity === 'critical').length;

  return (
    <header className={`${theme === 'dark' ? 'bg-dark-card' : 'bg-light-card'}`}>
      {/* existing content */}

      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-gray-700">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* Alarm indicator */}
        <AlarmIndicator
          severity={criticalCount > 0 ? 'critical' : 'warning'}
          count={criticalCount}
          onClick={() => navigate('/alerts')}
        />
      </div>
    </header>
  );
}
```

## 3. Enhanced Reports Pages

### A. Tariff Report Page
**File:** `src/pages/TariffReportPage.tsx`

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function TariffReportPage() {
  const [plant, setPlant] = useState('');
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading } = useQuery({
    queryKey: ['tariff-report', plant, from, to],
    queryFn: () =>
      axios.get('/api/reports/tariff', { params: { plant_id: plant, from, to } })
        .then(r => r.data),
    enabled: !!plant,
  });

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="card grid grid-cols-4 gap-4">
        <select value={plant} onChange={e => setPlant(e.target.value)} className="input">
          <option value="">Select Plant</option>
          <option value="plant-1">Plant 1</option>
          <option value="plant-4">Plant 4</option>
          <option value="canteen">Canteen</option>
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input" />
        <button className="btn-primary">Generate Report</button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : data ? (
        <>
          {/* Summary Table */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3">Meter</th>
                  <th className="text-right p-3">Day (kWh)</th>
                  <th className="text-right p-3">Peak (kWh)</th>
                  <th className="text-right p-3">Off-Peak (kWh)</th>
                  <th className="text-right p-3">Total (kWh)</th>
                  <th className="text-right p-3">Max KVA</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics?.map((m: any) => (
                  <tr key={m.meter_id} className="border-b">
                    <td className="p-3">{m.meter_name}</td>
                    <td className="text-right p-3">{parseFloat(m.day_kwh).toFixed(2)}</td>
                    <td className="text-right p-3">{parseFloat(m.peak_kwh).toFixed(2)}</td>
                    <td className="text-right p-3">{parseFloat(m.offpeak_kwh).toFixed(2)}</td>
                    <td className="text-right p-3 font-bold">{parseFloat(m.total_kwh).toFixed(2)}</td>
                    <td className="text-right p-3">{parseFloat(m.max_kva_day).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Chart */}
          <div className="card">
            <h3 className="font-semibold mb-4">Consumption by Time Period</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="meter_name" />
                <YAxis label={{ value: 'kWh', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="day_kwh" fill="#3b82f6" name="Day" />
                <Bar dataKey="peak_kwh" fill="#ef4444" name="Peak" />
                <Bar dataKey="offpeak_kwh" fill="#10b981" name="Off-Peak" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Plant Total */}
          <div className="card bg-blue-900/20 border-blue-700/30">
            <h3 className="font-semibold mb-3">Plant Total</h3>
            <div className="grid grid-cols-5 gap-4">
              <div>
                <p className="text-sm text-gray-400">Day</p>
                <p className="text-2xl font-bold">{data.plant_total.day_kwh.toFixed(1)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Peak</p>
                <p className="text-2xl font-bold">{data.plant_total.peak_kwh.toFixed(1)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Off-Peak</p>
                <p className="text-2xl font-bold">{data.plant_total.offpeak_kwh.toFixed(1)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Total</p>
                <p className="text-2xl font-bold">{data.plant_total.total_kwh.toFixed(1)}</p>
                <p className="text-xs text-gray-500">kWh</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Max KVA</p>
                <p className="text-2xl font-bold">{data.plant_total.max_kva.toFixed(1)}</p>
                <p className="text-xs text-gray-500">kVA</p>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
```

### B. Generator Analysis Page
**File:** `src/pages/GeneratorAnalysisPage.tsx`

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function GeneratorAnalysisPage() {
  const [plant, setPlant] = useState('');
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading } = useQuery({
    queryKey: ['generator-analysis', plant, from, to],
    queryFn: () =>
      axios.get('/api/reports/generator-analysis', { params: { plant_id: plant, from, to } })
        .then(r => r.data),
    enabled: !!plant,
  });

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="card grid grid-cols-4 gap-4">
        <select value={plant} onChange={e => setPlant(e.target.value)} className="input">
          <option value="">Select Plant</option>
          <option value="plant-1">Plant 1</option>
          <option value="plant-4">Plant 4</option>
          <option value="canteen">Canteen</option>
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input" />
        <button className="btn-primary">Generate Report</button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : data ? (
        <>
          {/* Monthly Summary */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card">
              <p className="text-sm text-gray-400">CEB Hours</p>
              <p className="text-3xl font-bold text-blue-400">{parseFloat(data.monthly_summary.total_ceb_kwh).toFixed(0)}</p>
              <p className="text-xs text-gray-500 mt-1">kWh</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-400">Generator Hours</p>
              <p className="text-3xl font-bold text-yellow-400">{parseFloat(data.monthly_summary.total_generator_kwh).toFixed(0)}</p>
              <p className="text-xs text-gray-500 mt-1">kWh</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-400">Generator %</p>
              <p className="text-3xl font-bold text-red-400">{data.monthly_summary.generator_percentage}%</p>
              <p className="text-xs text-gray-500 mt-1">of total</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-400">Switchovers</p>
              <p className="text-3xl font-bold text-orange-400">{data.monthly_summary.total_switchovers}</p>
              <p className="text-xs text-gray-500 mt-1">power cuts</p>
            </div>
          </div>

          {/* Daily Breakdown Chart */}
          <div className="card">
            <h3 className="font-semibold mb-4">Daily CEB vs Generator</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.daily_breakdown}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="ceb_kwh" stackId="1" fill="#3b82f6" name="CEB" />
                <Area type="monotone" dataKey="generator_kwh" stackId="1" fill="#f59e0b" name="Generator" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Daily Table */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3">Date</th>
                  <th className="text-right p-3">CEB (kWh)</th>
                  <th className="text-right p-3">Gen (kWh)</th>
                  <th className="text-right p-3">Total</th>
                  <th className="text-right p-3">Gen %</th>
                  <th className="text-right p-3">Switchovers</th>
                </tr>
              </thead>
              <tbody>
                {data.daily_breakdown?.map((d: any) => (
                  <tr key={d.date} className="border-b hover:bg-gray-800/50">
                    <td className="p-3">{d.date}</td>
                    <td className="text-right p-3">{parseFloat(d.ceb_kwh).toFixed(1)}</td>
                    <td className="text-right p-3">{parseFloat(d.generator_kwh).toFixed(1)}</td>
                    <td className="text-right p-3 font-bold">{parseFloat(d.total_kwh).toFixed(1)}</td>
                    <td className="text-right p-3">{d.generator_percentage}%</td>
                    <td className="text-right p-3">{d.switchovers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
```

## 4. Device Setpoints UI
**File:** `src/pages/DeviceSettingsPage.tsx` (update)

Add a new tab for "Device Setpoints":

```typescript
<Tabs>
  <TabPanel title="Plants">
    {/* existing plants tab */}
  </TabPanel>
  
  <TabPanel title="Device Setpoints">
    <DeviceSetpointsTab />
  </TabPanel>
  
  {/* other tabs */}
</Tabs>
```

**File:** `src/components/DeviceSetpointsTab.tsx`

```typescript
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

export default function DeviceSetpointsTab() {
  const qc = useQueryClient();
  const [selectedMeter, setSelectedMeter] = useState('');

  const { data: meters } = useQuery({
    queryKey: ['energy-meters'],
    queryFn: () => axios.get('/api/settings/energy-meters').then(r => r.data),
  });

  const { data: setpoints } = useQuery({
    queryKey: ['device-setpoints', selectedMeter],
    queryFn: () =>
      axios.get('/api/device-setpoints/effective', { params: { meter_id: selectedMeter } })
        .then(r => r.data),
    enabled: !!selectedMeter,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) =>
      axios.put(`/api/device-setpoints/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-setpoints'] });
      toast.success('Updated');
    },
  });

  return (
    <div className="space-y-4">
      <select value={selectedMeter} onChange={e => setSelectedMeter(e.target.value)} className="input">
        <option value="">Select Meter</option>
        {meters?.meters?.map((m: any) => (
          <option key={m.id} value={m.meter_id}>{m.name} ({m.meter_id})</option>
        ))}
      </select>

      {setpoints?.setpoints && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-3">Alert Type</th>
              <th className="text-left p-3">Min</th>
              <th className="text-left p-3">Max</th>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {setpoints.setpoints.map((sp: any) => (
              <tr key={sp.id} className="border-b">
                <td className="p-3">{sp.alert_type}</td>
                <td className="p-3">{sp.min_value}</td>
                <td className="p-3">{sp.max_value}</td>
                <td className="p-3">{sp.source === 'device' ? '🔧 Device' : '🌍 Global'}</td>
                <td className="p-3">
                  {sp.source === 'device' && (
                    <button
                      onClick={() => updateMutation.mutate({ id: sp.id, min_value: sp.min_value, max_value: sp.max_value })}
                      className="text-xs text-primary-400 hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

## 5. Router Updates
**File:** `src/App.tsx` (update routes)

```typescript
{/* Add new routes */}
<Route path="/reports/tariff" element={<TariffReportPage />} />
<Route path="/reports/generator-analysis" element={<GeneratorAnalysisPage />} />
<Route path="/reports/device-comparison" element={<DeviceComparisonPage />} />
```

## 6. CSS for Light/Dark Mode
**File:** `src/index.css` (add)

```css
/* Light mode overrides */
html:not(.dark) {
  @apply bg-white text-gray-900;
}

html:not(.dark) .card {
  @apply bg-gray-50 border-gray-200;
}

html:not(.dark) .input {
  @apply bg-white border-gray-300 text-gray-900;
}

html:not(.dark) .btn-primary {
  @apply bg-blue-600 hover:bg-blue-700;
}

/* Dark mode (default) */
html.dark {
  @apply bg-dark-bg text-gray-100;
}

html.dark .card {
  @apply bg-dark-card border-gray-700;
}
```

## Implementation Checklist

- [ ] Create ThemeContext and ThemeProvider
- [ ] Update Tailwind config for dark mode
- [ ] Create AlarmIndicator component
- [ ] Update Header with theme toggle and alarm indicator
- [ ] Create TariffReportPage
- [ ] Create GeneratorAnalysisPage
- [ ] Update DeviceSettingsPage with Device Setpoints tab
- [ ] Add new routes to App.tsx
- [ ] Add light mode CSS
- [ ] Update Sidebar navigation with new report pages
- [ ] Test light/dark mode toggle
- [ ] Test all new report pages

## Testing Checklist

- [ ] Theme toggle persists across refresh
- [ ] Alarm badges show correct count
- [ ] Critical alarms pulse animation works
- [ ] Tariff report loads data correctly
- [ ] Generator analysis shows daily/monthly breakdown
- [ ] Device setpoints show effective values (device overrides global)
- [ ] Charts render correctly in both light and dark modes
- [ ] Date range filters work properly
- [ ] Export to Excel/PDF works with new reports

## Next Steps

1. Run backend migrations: `npm run db:migrate` then load `src/db/upgrade.sql`
2. Install frontend dependencies if needed
3. Implement frontend components in order listed above
4. Test each feature end-to-end
5. Deploy and monitor
