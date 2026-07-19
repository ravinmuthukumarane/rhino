# Quick Start Implementation Guide

## Summary of Changes

Your energy monitoring system is being upgraded with:

✅ **Already Implemented (Backend)**
- Device-level setpoint overrides
- Tariff report API (Day/Peak/Off-Peak breakdown)
- Generator analysis API (CEB vs Generator tracking)
- Device comparison API
- Consumption trend API
- User preferences API (theme, notifications)
- Email report configuration tables

❌ **Needs Implementation (Frontend)**
- Theme toggle (Light/Dark mode)
- Alarm visual animations (pulsing/blinking)
- Tariff report UI page
- Generator analysis UI page
- Device setpoints management UI
- Email configuration UI (optional, can be done later)

## Step 1: Run Database Migrations

**Important:** Do this BEFORE starting the backend

```bash
cd backend

# Run the upgrade SQL manually (since using PostgreSQL):
psql -h 172.235.8.137 -U rhinoadminuser -d rhinno -f src/db/upgrade.sql
```

Or if using local database:
```bash
psql -U rhinoadminuser -d rhino -f src/db/upgrade.sql
```

**Or create migration script** `backend/src/db/run-upgrade.ts`:

```typescript
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pool from '../config/database';

async function runUpgrade() {
  const upgradeSQL = fs.readFileSync(path.join(__dirname, 'upgrade.sql'), 'utf8');
  const client = await pool.connect();
  try {
    console.log('Running upgrade migration…');
    await client.query(upgradeSQL);
    console.log('✓ Upgrade complete.');
  } catch (err) {
    console.error('✗ Upgrade failed:', (err as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runUpgrade();
```

Then run:
```bash
npm run ts-node src/db/run-upgrade.ts
```

## Step 2: Start Backend with New Features

```bash
cd backend
npm run dev
```

You should see in logs:
```
[Server] Port 5000
[DB] Connected
[MQTT] Connected (or [Simulator] Started)
```

New endpoints ready:
- `GET /api/device-setpoints`
- `GET /api/reports/tariff?plant_id=X&from=DATE&to=DATE`
- `GET /api/reports/generator-analysis?plant_id=X&from=DATE&to=DATE`
- `GET /api/user/preferences`
- `PUT /api/user/preferences`

## Step 3: Frontend - Phase 1 (Theme & Alarms)

### 3.1 Create ThemeContext
**File:** `frontend/src/context/ThemeContext.tsx`

Copy code from FRONTEND_UPGRADE.md → Section 1: Theme System

### 3.2 Update App.tsx
Wrap with ThemeProvider:

```typescript
import { ThemeProvider } from './context/ThemeContext';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <Toaster />
          {/* rest of app */}
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

### 3.3 Create AlarmIndicator Component
**File:** `frontend/src/components/AlarmIndicator.tsx`

Copy code from FRONTEND_UPGRADE.md → Section 2: Visual Alarm Animations

### 3.4 Update Header
Add theme toggle and alarm indicator to Header.tsx

**Test:** Toggle theme, should switch light/dark, persists on refresh

## Step 4: Frontend - Phase 2 (Reports Pages)

### 4.1 Create TariffReportPage
**File:** `frontend/src/pages/TariffReportPage.tsx`

Copy from FRONTEND_UPGRADE.md → Section 3.A

### 4.2 Create GeneratorAnalysisPage
**File:** `frontend/src/pages/GeneratorAnalysisPage.tsx`

Copy from FRONTEND_UPGRADE.md → Section 3.B

### 4.3 Update Router
In `App.tsx`, add routes:

```typescript
<Route path="/reports/tariff" element={<TariffReportPage />} />
<Route path="/reports/generator-analysis" element={<GeneratorAnalysisPage />} />
```

### 4.4 Update Sidebar Navigation
Add links to new report pages:

```typescript
<NavLink to="/reports/tariff">📊 Tariff Report</NavLink>
<NavLink to="/reports/generator-analysis">⚡ Generator Analysis</NavLink>
```

**Test:** 
- Navigate to reports
- Select a plant
- Set date range
- Verify charts and data load

## Step 5: Frontend - Phase 3 (Device Setpoints)

### 5.1 Create DeviceSetpointsTab
**File:** `frontend/src/components/DeviceSetpointsTab.tsx`

Copy from FRONTEND_UPGRADE.md → Section 4

### 5.2 Update DeviceSettingsPage
Add a new tab for Device Setpoints

**Test:**
- Go to Device Settings
- Click Device Setpoints tab
- Select a meter
- Verify setpoints load (both device and global)

## Step 6: Styling Updates

### 6.1 Update Tailwind Config
Make sure darkMode is set to 'class':

```typescript
// frontend/tailwind.config.ts
export default {
  darkMode: 'class',
  // ...
}
```

### 6.2 Add Light Mode Styles
**File:** `frontend/src/index.css` (add to end)

```css
/* Light mode */
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
```

**Test:** Theme toggle switches between light/dark smoothly

## Step 7: Environment Variables

No new env vars needed! But you can add optional ones to `backend/.env`:

```bash
# Optional: Cost calculation for reports
TARIFF_RATE_DAY=12.5          # Rs per kWh
TARIFF_RATE_PEAK=18.5
TARIFF_RATE_OFFPEAK=8.5
GENERATOR_FUEL_COST=50        # Rs per liter

# Optional: Report timing
AUTO_REPORT_ENABLED=false     # Enable automated emails (Phase 4)
AUTO_REPORT_TIME=08:00
```

## Validation Checklist

### Backend
- [ ] `npm run dev` starts without errors
- [ ] Database has new tables: `device_alert_setpoints`, `user_preferences`, `generator_runtime_summary`, etc.
- [ ] Can query `/api/device-setpoints`
- [ ] Can query `/api/reports/tariff?plant_id=X&from=Y&to=Z`
- [ ] Can query `/api/reports/generator-analysis?plant_id=X&from=Y&to=Z`
- [ ] Can GET `/api/user/preferences`
- [ ] Can PUT `/api/user/preferences` with new theme

### Frontend - Phase 1 (Theme)
- [ ] Theme toggle button appears in header
- [ ] Clicking toggle switches light ↔ dark
- [ ] Theme persists after page refresh
- [ ] All components render properly in both modes

### Frontend - Phase 2 (Reports)
- [ ] TariffReportPage accessible from sidebar
- [ ] Can select plant and date range
- [ ] Bar chart shows Day/Peak/Off-Peak breakdown
- [ ] Meters table populates correctly
- [ ] GeneratorAnalysisPage shows daily/monthly breakdown
- [ ] Area chart shows CEB vs Generator stacking

### Frontend - Phase 3 (Device Setpoints)
- [ ] Can select a meter in Device Setpoints tab
- [ ] Setpoints load (showing 'device' or 'global' source)
- [ ] Can edit device-specific setpoints

## Deployment Order

1. ✅ Backend database migrations
2. ✅ Backend new controllers and routes  
3. ✅ Frontend Theme system
4. ✅ Frontend Report pages
5. ✅ Frontend Device Setpoints
6. ✅ Frontend Styling
7. Test everything
8. Deploy to production

## Common Issues & Fixes

### Issue: Database migration fails
```
Error: relation "device_alert_setpoints" already exists
```
**Fix:** This table already exists if you ran upgrade.sql. You can safely ignore.

### Issue: Theme toggle not persisting
**Fix:** Check localStorage permissions and that ThemeProvider wraps entire app

### Issue: Charts not showing data
**Fix:** 
- Check browser console for API errors
- Verify plant_id in query is valid
- Check date range has data

### Issue: Device setpoints showing only global
**Fix:**
- Create device-specific setpoint via POST /api/device-setpoints
- Check unique constraint on (meter_id, alert_type)

## Next Phases (Optional)

### Phase 4: Automated Email Reports
- Email configuration UI
- Schedule setup
- Email templates
- Report generation scheduler

### Phase 5: Advanced Features
- Predictive alerts
- Anomaly detection
- Cost forecasting
- Custom reports builder
- API webhooks

## Support

Need help?

1. Check FRONTEND_UPGRADE.md for detailed code
2. Check UPGRADE_PLAN.md for architecture
3. Check MQTT_GUIDE.md for meter integration
4. Review backend logs: `npm run dev` output

## Success Criteria

When complete, you should be able to:

✅ Login and toggle between light/dark theme
✅ See active alarms with pulsing animation on critical ones
✅ Generate tariff reports showing Day/Peak/Off-Peak breakdown per meter
✅ View generator analysis showing CEB vs Generator usage
✅ Override alert setpoints per device
✅ See your data persisted in 30+ database tables
✅ Have 9 energy meters + 2 flow meters actively monitored
✅ Receive MQTT data or simulator data in real-time

**Estimated time to complete:** 2-3 days of development

---

Start with Step 1 (Database), then proceed sequentially.

Good luck! 🚀
