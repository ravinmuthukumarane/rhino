# Energy Monitoring System - Comprehensive Upgrade Plan

## Overview
Based on your network architecture (3 plants, 9 energy meters, 2 flow meters), this document outlines enhancements for:
- Device-level setpoints
- Advanced reporting (tariff breakdown)
- Generator vs CEB tracking
- Automated email notifications
- Visual enhancements (alarms, theme toggle)

## Architecture

```
P1.1, P1.2, P1.3 → Modbus Gateway → Backend → Database → Frontend
P4.1, P4.2, P4.3, P4.4, P4.5 → Modbus Gateway → Backend → Database → Frontend
C1.1 → Modbus Gateway → Backend → Database → Frontend
```

## Database Changes

### 1. Device-Level Setpoints (NEW TABLE)
```sql
CREATE TABLE device_alert_setpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id VARCHAR(100) NOT NULL REFERENCES energy_meters(meter_id),
  alert_type VARCHAR(100) NOT NULL,
  min_value NUMERIC(12,3),
  max_value NUMERIC(12,3),
  enabled BOOLEAN DEFAULT true,
  email_notify BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meter_id, alert_type)
);
```

**Behavior:**
- If device has specific setpoint → use it
- Else if global setpoint exists → use it
- Else → no alert

### 2. Email Report Configuration (NEW TABLE)
```sql
CREATE TABLE email_report_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  report_type VARCHAR(100), -- 'daily', 'weekly', 'monthly'
  include_graphs BOOLEAN DEFAULT true,
  include_summary BOOLEAN DEFAULT true,
  schedule VARCHAR(100), -- cron format: '0 8 * * *'
  recipients TEXT[], -- email array
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Generator Runtime Summary (NEW TABLE)
```sql
CREATE TABLE generator_runtime_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id VARCHAR(100) NOT NULL,
  plant_id UUID REFERENCES plants(id),
  summary_date DATE NOT NULL,
  ceb_hours NUMERIC(5,2) DEFAULT 0,
  generator_hours NUMERIC(5,2) DEFAULT 0,
  total_hours NUMERIC(5,2) DEFAULT 24,
  generator_percentage NUMERIC(5,2) DEFAULT 0,
  switchovers INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meter_id, summary_date)
);
```

### 4. User Preferences (NEW TABLE)
```sql
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(20) DEFAULT 'dark', -- 'light' or 'dark'
  alert_sound BOOLEAN DEFAULT true,
  email_notifications BOOLEAN DEFAULT true,
  email_daily_digest BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Frontend Changes

### Pages to Enhance/Create

#### 1. Enhanced Dashboard
- Light/Dark mode toggle (top-right)
- Plant selector with live status indicators
- Alarm badges with pulsing animation
- Real-time generator vs CEB indicator

#### 2. Advanced Reports Page (Major Upgrade)
**Tabs:**
- **Tariff Report** - Day/Peak/Off-Peak breakdown (like your CEB screenshot)
- **Device Comparison** - Multiple meters side-by-side
- **Generator Analysis** - CEB vs Generator runtime charts
- **Consumption Trends** - Historical trends
- **Power Quality** - Voltage/Current/PF graphs
- **Billing Preview** - Cost estimation based on tariff

**Filters:**
- Plant selector (P1, P4, Canteen)
- Device selector (per-meter)
- Date range (from/to)
- Time period (Day/Peak/Off-Peak)
- Export (Excel, PDF)

#### 3. Device Settings Enhancement
- **New Tab: Device Setpoints**
- Override global setpoints per meter
- Enable/disable per-device

#### 4. New Page: Email Configuration
- Configure automated reports
- Select schedule (daily/weekly/monthly)
- Choose metrics to include
- Recipients list
- Email templates preview

#### 5. Alerts with Visual Enhancements
- Pulsing/blinking animation for active critical alerts
- Color-coded severity (red/yellow/blue)
- Sound notification option
- Snooze option

## API Endpoints to Add/Modify

### Reports
```
GET /api/reports/tariff?plant_id=X&from=DATE&to=DATE
GET /api/reports/generator-analysis?plant_id=X&from=DATE&to=DATE
GET /api/reports/device-comparison?meter_ids=X,Y,Z&from=DATE&to=DATE
GET /api/reports/consumption-trend?plant_id=X&days=30
```

### Device Setpoints
```
GET /api/settings/device-setpoints?meter_id=X
POST /api/settings/device-setpoints
PUT /api/settings/device-setpoints/:id
DELETE /api/settings/device-setpoints/:id
```

### Email Configuration
```
GET /api/email-config/me
POST /api/email-config
PUT /api/email-config/:id
DELETE /api/email-config/:id
POST /api/email-config/:id/test (send test email)
```

### User Preferences
```
GET /api/user/preferences
PUT /api/user/preferences
```

## Implementation Timeline

### Phase 1: Database & Core APIs (Week 1)
- [ ] Add new database tables
- [ ] Create device-level setpoint controllers
- [ ] Create email config controllers
- [ ] Create generator runtime summary job

### Phase 2: Frontend - Reports (Week 2)
- [ ] Tariff report page
- [ ] Generator analysis charts
- [ ] Device comparison charts
- [ ] Date range selectors

### Phase 3: Frontend - Enhancements (Week 3)
- [ ] Light/Dark mode toggle
- [ ] Email configuration UI
- [ ] Device setpoints override UI
- [ ] Alarm visual effects (pulsing)

### Phase 4: Email Automation (Week 4)
- [ ] Email template engine
- [ ] Scheduler for automated reports
- [ ] Email sending service
- [ ] Preview & test functionality

### Phase 5: Polish & Testing (Week 5)
- [ ] Testing across all features
- [ ] Performance optimization
- [ ] Documentation

## Key Features Summary

### 1. Device-Level Setpoints
**Benefit:** Different devices have different tolerances
**Example:**
- Global: Over Voltage max = 255V
- Device P4.1 (critical): max = 250V (stricter)
- Device C1.1 (flexible): max = 260V (relaxed)

### 2. Tariff Report
**Benefit:** Understand consumption by time period
**Shows:**
- Consumption: Day vs Peak vs Off-Peak
- Max KVA per period
- Cost estimation (if tariff configured)
- Per-location breakdown

**Example Output:**
```
Location: P1 BM - VACCUM/VAT/CONV
Day (05:30-18:30):       26.8 kWh
Peak (18:30-22:30):       0.0 kWh
Off-Peak (22:30-05:30):   0.0 kWh
Max KVA:               340.7 kVA
```

### 3. Generator Analysis
**Benefit:** Track backup power usage
**Shows:**
- CEB hours vs Generator hours (daily/monthly)
- Switchover count
- Generator run percentage
- Cost savings (if generator fuel cost configured)

**Example:**
```
Day 1: CEB 18h | Generator 6h | Switchovers: 2
Day 2: CEB 24h | Generator 0h | Switchovers: 0
Month: CEB 720h | Generator 36h | 5% generator usage
```

### 4. Automated Email Reports
**Benefit:** Stakeholders get insights without logging in
**Config Example:**
- User: Manager
- Plant: P4
- Schedule: Daily at 8:00 AM
- Include: Tariff report, generator analysis, alerts
- Recipients: manager@company.com, admin@company.com

### 5. Visual Enhancements
**Dashboard Alarm Blinking:**
- Critical alerts: Red pulsing badge
- Click to view details
- Sound notification option

**Theme Toggle:**
- Dark mode (default)
- Light mode
- Saved in user preferences

## Data Models

### Tariff Report Output
```json
{
  "plant_id": "00000000-0000-0000-0000-000000000001",
  "plant_name": "Plant 1",
  "period": "2024-06-01 to 2024-06-30",
  "metrics": [
    {
      "meter_id": "EM-P1-001",
      "meter_name": "P1.1",
      "day_kwh": 450.5,
      "peak_kwh": 280.3,
      "offpeak_kwh": 120.2,
      "max_kva_day": 85.5,
      "max_kva_peak": 120.3,
      "max_kva_offpeak": 45.2,
      "total_kwh": 851.0,
      "avg_pf": 0.926
    }
  ],
  "plant_total": {
    "day_kwh": 2125.5,
    "peak_kwh": 950.3,
    "offpeak_kwh": 540.2,
    "total_kwh": 3615.0,
    "max_kva": 320.5
  }
}
```

### Generator Analysis Output
```json
{
  "period": "2024-06-01 to 2024-06-30",
  "daily_breakdown": [
    {
      "date": "2024-06-01",
      "ceb_hours": 20,
      "generator_hours": 4,
      "switchovers": 2,
      "generator_percentage": 16.7,
      "notes": "Power cut 14:00-18:00"
    }
  ],
  "monthly_summary": {
    "total_ceb_hours": 600,
    "total_generator_hours": 60,
    "generator_percentage": 9.1,
    "total_switchovers": 12,
    "estimated_fuel_used_liters": 120,
    "estimated_fuel_cost": 6000
  }
}
```

## Configuration

### Environment Variables (add to .env)
```bash
# Email Reports
EMAIL_REPORT_TIMEZONE=Asia/Colombo
TARIFF_RATE_DAY=12.5          # Rs per kWh
TARIFF_RATE_PEAK=18.5
TARIFF_RATE_OFFPEAK=8.5
GENERATOR_FUEL_COST=50        # Rs per liter
GENERATOR_FUEL_EFFICIENCY=0.6 # kWh per liter

# Report Generation
AUTO_REPORT_ENABLED=true
AUTO_REPORT_TIME=08:00        # HH:MM
AUTO_SUMMARY_TIME=00:05       # HH:MM
```

## Next Steps
1. Run database migrations to add new tables
2. Create backend controllers for new endpoints
3. Update frontend with new pages and components
4. Configure email templates
5. Set up automated scheduler for reports and summaries
6. Test end-to-end with actual data
