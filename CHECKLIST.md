# Implementation Checklist

## Phase 1: Backend Setup ✅ (Already Done)

- [x] Create device_alert_setpoints table
- [x] Create user_preferences table  
- [x] Create email_report_configs table
- [x] Create generator_runtime_summary table
- [x] Create tariff_config table
- [x] Create hourly_source_summary table
- [x] Create alert_notifications table
- [x] deviceSetpointsController.ts created
- [x] userPreferencesController.ts created
- [x] enhancedReportsController.ts created
- [x] enhanced.ts routes created
- [x] index.ts updated to mount enhanced routes

## Phase 2: Database Migrations 📋 (TODO - Do First)

- [ ] Connect to PostgreSQL at 172.235.8.137
- [ ] Run upgrade.sql migration
  ```bash
  psql -h 172.235.8.137 -U rhinoadminuser -d rhinno -f backend/src/db/upgrade.sql
  ```
- [ ] Verify all new tables created
  ```sql
  SELECT tablename FROM pg_tables 
  WHERE schemaname = 'public' 
  ORDER BY tablename;
  ```
- [ ] Check table row counts (should all be 0)
  ```sql
  SELECT tablename, n_live_tup FROM pg_stat_user_tables;
  ```

## Phase 3: Test Backend APIs 🔧 (TODO - After Migration)

- [ ] Start backend: `npm run dev` in backend/
- [ ] Test health check: `curl http://localhost:5000/api/health`
- [ ] Login and get JWT token
- [ ] Test device setpoints endpoint:
  ```bash
  curl http://localhost:5000/api/device-setpoints \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
- [ ] Test user preferences endpoint:
  ```bash
  curl http://localhost:5000/api/user/preferences \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
- [ ] Test tariff report endpoint:
  ```bash
  curl "http://localhost:5000/api/reports/tariff?plant_id=PLANT_UUID&from=2024-01-01&to=2024-01-31" \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
- [ ] Test generator analysis endpoint:
  ```bash
  curl "http://localhost:5000/api/reports/generator-analysis?plant_id=PLANT_UUID&from=2024-01-01&to=2024-01-31" \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```

## Phase 4: Frontend - Theme System 🎨 (TODO - Priority 1)

### Create Files
- [ ] Create `frontend/src/context/ThemeContext.tsx`
- [ ] Create `frontend/src/components/AlarmIndicator.tsx`

### Update Files
- [ ] Update `frontend/src/App.tsx` - wrap with ThemeProvider
- [ ] Update `frontend/src/components/layout/Header.tsx` - add theme toggle and alarm indicator
- [ ] Update `frontend/tailwind.config.ts` - add darkMode: 'class'
- [ ] Update `frontend/src/index.css` - add light mode styles

### Test
- [ ] Toggle theme button appears in header
- [ ] Light/dark mode switches
- [ ] Theme persists after refresh
- [ ] All components render in both modes
- [ ] Alarm indicator appears and shows count

## Phase 5: Frontend - Report Pages 📊 (TODO - Priority 2)

### Create Files
- [ ] Create `frontend/src/pages/TariffReportPage.tsx`
- [ ] Create `frontend/src/pages/GeneratorAnalysisPage.tsx`
- [ ] Create `frontend/src/pages/DeviceComparisonPage.tsx` (optional)

### Update Files
- [ ] Update `frontend/src/App.tsx` - add new routes
- [ ] Update `frontend/src/components/layout/Sidebar.tsx` - add report links

### Test
- [ ] TariffReportPage loads at /reports/tariff
- [ ] Can select plant and date range
- [ ] Data loads and displays in table
- [ ] Bar chart renders showing Day/Peak/Off-Peak breakdown
- [ ] Plant totals display correctly
- [ ] GeneratorAnalysisPage loads at /reports/generator-analysis
- [ ] Daily breakdown table shows CEB vs Generator hours
- [ ] Area chart shows stacked CEB/Generator data
- [ ] Monthly summary shows percentage and switchovers

## Phase 6: Frontend - Device Setpoints 🔧 (TODO - Priority 3)

### Create Files
- [ ] Create `frontend/src/components/DeviceSetpointsTab.tsx`

### Update Files
- [ ] Update `frontend/src/pages/DeviceSettingsPage.tsx` - add Device Setpoints tab

### Test
- [ ] Device Setpoints tab visible in Device Settings
- [ ] Can select a meter from dropdown
- [ ] Effective setpoints load (showing device and global)
- [ ] Can edit device-specific values
- [ ] Save updates without errors
- [ ] Display shows "🔧 Device" vs "🌍 Global" source

## Phase 7: Device Registration 📝 (TODO - Priority 4)

### Register Plants (via UI or API)
- [ ] Plant 1
- [ ] Plant 4
- [ ] Canteen

### Register Energy Meters (P1: 3 meters)
- [ ] EM-P1-001 (P1.1)
- [ ] EM-P1-002 (P1.2)
- [ ] EM-P1-003 (P1.3)

### Register Energy Meters (P4: 5 meters)
- [ ] EM-P4-001 (P4.1)
- [ ] EM-P4-002 (P4.2)
- [ ] EM-P4-003 (P4.3)
- [ ] EM-P4-004 (P4.4)
- [ ] EM-P4-005 (P4.5) [Actually in P4.2 based on diagram]

### Register Energy Meters (Canteen: 1 meter)
- [ ] EM-C1-001 (C1.1)

### Register Flow Meters
- [ ] FM-P1-001 (P1.2)
- [ ] FM-P4-001 (P4.5)

**Verify:** All 30 devices registered and visible in Device Settings

## Phase 8: Data Ingestion Setup 📡 (TODO - Priority 5)

### Option A: MQTT Integration
- [ ] Configure MQTT broker connection
- [ ] Set `ENABLE_MQTT=true` in .env
- [ ] Set `MQTT_BROKER_URL=mqtt://your-ip:1883` in .env
- [ ] Publish test messages to broker
- [ ] Verify readings appear in database

### Option B: Modbus Gateway
- [ ] Configure Modbus Gateway at 192.168.1.119+ IPs
- [ ] Implement Modbus RTU→MQTT translator
- [ ] Test data flow from gateways

### Option C: Test Data (Simulator)
- [ ] Keep `ENABLE_SIMULATOR=true` in .env
- [ ] Verify simulator generates data
- [ ] Check database for readings

### Verification
- [ ] Data appearing in energy_readings table
- [ ] Readings have correct meter_id
- [ ] Readings have plant_id populated
- [ ] Timestamps are recent

## Phase 9: Alert Configuration 🚨 (TODO - Priority 6)

### Set Global Setpoints (via UI or API)
- [ ] Over Voltage max: 255V
- [ ] Low Voltage min: 195V
- [ ] Low Power Factor min: 0.85
- [ ] High KVA max: 100
- [ ] High 3rd Harmonic max: 5%

### Override Specific Devices (Optional)
Example: Make P4.1 more strict (lower voltage)
- [ ] Create device setpoint for EM-P4-001
- [ ] Set Over Voltage max: 250V (stricter)
- [ ] Enable email notifications

### Verify
- [ ] Alerts trigger when readings exceed setpoints
- [ ] Device overrides work (different thresholds)
- [ ] Alert log populates correctly

## Phase 10: Styling & Polish 🎨 (TODO - Priority 7)

- [ ] Update card styling for light mode
- [ ] Update input styling for light mode
- [ ] Update button styling for light mode
- [ ] Verify all text is readable in light mode
- [ ] Add CSS transitions for theme switch
- [ ] Verify animations work (pulsing alarms)
- [ ] Check responsive design on mobile

## Phase 11: Email Configuration ✉️ (TODO - Optional Phase 4)

- [ ] Create email report config UI
- [ ] Set up email schedules
- [ ] Create email templates
- [ ] Set up scheduler
- [ ] Send test emails
- [ ] Verify automation works

## Final Testing ✅ (TODO - After Each Phase)

### After Phase 4 (Theme)
- [ ] Login works in light mode
- [ ] Login works in dark mode
- [ ] All pages render correctly in both modes
- [ ] Charts look good in both modes
- [ ] Text is readable in both modes

### After Phase 5 (Reports)
- [ ] Can view tariff report for each plant
- [ ] Date range filtering works
- [ ] Charts render data correctly
- [ ] Export to Excel works
- [ ] Export to PDF works
- [ ] Generator analysis shows correct data

### After Phase 6 (Device Setpoints)
- [ ] Device setpoints can be created
- [ ] Device setpoints can be updated
- [ ] Device setpoints can be deleted
- [ ] Global setpoints still work
- [ ] Effective setpoints show correct priority

### After Phase 8 (Data Ingestion)
- [ ] Real meter data flowing in
- [ ] Dashboard shows live data
- [ ] Reports use latest data
- [ ] Database growing (readings accumulating)

### After Phase 9 (Alerts)
- [ ] Alerts trigger correctly
- [ ] Alert severity is correct
- [ ] Device setpoints trigger correct alerts
- [ ] Alert history is logged

## Production Checklist 🚀 (TODO - Before Deployment)

- [ ] All backend APIs tested
- [ ] All frontend pages tested
- [ ] Database has sample data from real meters
- [ ] Alerts trigger and notify correctly
- [ ] Email notifications work (if configured)
- [ ] Theme toggle works smoothly
- [ ] Responsive design on mobile/tablet
- [ ] Performance acceptable (< 2s page load)
- [ ] No console errors
- [ ] No unhandled promise rejections
- [ ] API rate limiting working
- [ ] CORS configured for production domain
- [ ] Database backups configured
- [ ] SSL certificates configured
- [ ] Error monitoring set up (optional)
- [ ] User documentation created
- [ ] Admin manual created

## Estimated Timeline

```
Phase 1: Backend Setup         ✅ Complete
Phase 2: Database Migration    1 hour
Phase 3: API Testing           1 hour
Phase 4: Theme System          2 hours
Phase 5: Report Pages          4 hours
Phase 6: Device Setpoints      2 hours
Phase 7: Device Registration   1 hour
Phase 8: Data Ingestion        2 hours
Phase 9: Alert Configuration   1 hour
Phase 10: Styling              2 hours
Phase 11: Email (Optional)     3 hours
Phase 12: Testing & Deploy     3 hours
─────────────────────────────────────
Total:                        ~22 hours
                              (1 week part-time)
```

## Notes & Tips

### Database Commands
```bash
# Connect to database
psql -h 172.235.8.137 -U rhinoadminuser -d rhinno

# Check migrations
\dt  # List all tables
\d user_preferences  # Describe table
SELECT COUNT(*) FROM alerts;  # Count rows

# Backup database
pg_dump -h 172.235.8.137 -U rhinoadminuser -d rhinno > backup.sql
```

### API Testing
```bash
# Get JWT token
TOKEN=$(curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rhino.local","password":"yourpass"}' \
  | jq -r '.token')

# Use token in requests
curl http://localhost:5000/api/readings/latest \
  -H "Authorization: Bearer $TOKEN"
```

### Common Issues

**"Table already exists"**
→ Safe to ignore, table exists from previous run

**"Column does not exist"**
→ Restart backend after migration

**"Theme not persisting"**
→ Check localStorage in DevTools, clear cache

**"Charts not showing data"**
→ Check browser console for API errors
→ Verify plant_id is valid UUID
→ Check date range has data in database

## Success Metrics

✅ All pages load without errors
✅ Theme toggle works smoothly
✅ Reports show correct data
✅ Alerts trigger on meter data
✅ Device setpoints work
✅ 9 energy meters registered
✅ 2 flow meters registered
✅ Data flowing from real meters (or simulator)
✅ Database has 30+ days of history
✅ No missing features

---

**Start Date:** ___________
**Target Completion:** ___________

Good luck! 🚀

