# Energy Monitoring System - Complete Summary

## System Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Smart Meters   │         │  Modbus Gateway  │         │   MQTT Broker   │
│  (9 Energy +    │────────→│  (3 locations)   │────────→│   (Optional)    │
│   2 Flow)       │         │                  │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                                                  │
                                                                  ▼
                            ┌────────────────────────┐
                            │   Node.js Backend      │
                            │   (Express + Socket.io)│
                            │   (TypeScript)         │
                            └────────────────────────┘
                                      │
                                      ▼
                            ┌────────────────────────┐
                            │   PostgreSQL Database  │
                            │   (30+ Tables)         │
                            │   (172.235.8.137)      │
                            └────────────────────────┘
                                      │
                                      ▼
                            ┌────────────────────────┐
                            │   React Frontend       │
                            │   (TypeScript + React  │
                            │    Query)              │
                            │   (Light/Dark Mode)    │
                            └────────────────────────┘
                                      │
                                      ▼
                            ┌────────────────────────┐
                            │   Browser/UI           │
                            │   (Dashboard, Reports, │
                            │    Alerts, Settings)   │
                            └────────────────────────┘
```

## Data Flow

### Real-time Readings
```
Smart Meter → Modbus Gateway → Backend (MQTT/REST) → Database 
          ↓                                          ↓
       Every 5 sec                    storage + alert checking
                                       ↓
                                   Socket.io → Frontend (Live)
                                   WebSocket    Dashboard
```

### Data Storage (3 Levels)
```
Level 1: Raw Readings (Stored every 5 seconds)
├─ energy_readings (voltage, current, power, apparent power, etc)
├─ diesel_readings (flow rate, volume)
└─ generator_events (on/off status)

Level 2: Daily Summaries (Aggregated daily)
├─ daily_energy_summary (total kwh, max kva, by time period)
├─ daily_diesel_summary (total liters, run hours)
├─ hourly_source_summary (CEB vs Generator breakdown per hour)
└─ generator_runtime_summary (daily CEB/Gen hours, switchovers)

Level 3: Alert History
├─ alerts (triggered alerts with severity)
├─ alert_notifications (who was notified, when)
└─ power_interruptions (power cut events)
```

### Alert Processing
```
Raw Reading → Check against Setpoints
                ├─ Device-level (if exists) → Use device thresholds
                ├─ OR Global (if exists) → Use global thresholds
                └─ Triggered? → Create alert → Send notifications
                                               ├─ Email (if enabled)
                                               ├─ Socket.io (UI popup)
                                               └─ Log to database
```

## Database Tables (30+)

### User Management
- `users` - Login credentials, roles
- `email_verifications` - Email verification tokens
- `password_resets` - Password recovery tokens
- `user_preferences` - Theme, notifications, timezone

### Device Registry
- `plants` - Locations/facilities (P1, P4, Canteen)
- `energy_meters` - Smart meters (9 total)
- `flow_meters` - Diesel/water meters (2 total)
- `generators` - Backup generators
- `device_alert_setpoints` - Per-device alert overrides

### Readings
- `energy_readings` - Voltage, current, power, apparent power (5-sec interval)
- `diesel_readings` - Flow rate, volume (5-sec interval)
- `generator_events` - Generator on/off events
- `power_interruptions` - Power cut/restore events
- `hourly_source_summary` - CEB vs Generator per hour

### Summaries
- `daily_energy_summary` - Daily totals per meter (kWh by period)
- `daily_diesel_summary` - Daily diesel totals per meter
- `generator_runtime_summary` - Daily CEB/Gen hours, switchovers

### Alerts & Notifications
- `alert_setpoints` - Global thresholds (Over Voltage, Low Voltage, etc)
- `alerts` - Alert log with severity and message
- `alert_notifications` - Notification history (email, UI, push)

### Configuration
- `email_report_configs` - Automated report schedules
- `tariff_config` - Rate per kWh by time period
- `reports` - Report generation audit log

## Key Features

### 1️⃣ Real-time Monitoring
- Live dashboard with 3-phase power quality metrics
- Real-time voltage, current, power, apparent power, power factor
- Live generator vs CEB indicator with automatic switchover detection

### 2️⃣ Multi-Plant Support
- Monitor 3 separate locations independently
- Plant-level summaries and aggregates
- Plant-level setpoints and reports

### 3️⃣ Device Registry
- Register and manage 9 energy meters
- Register and manage 2 flow meters
- Device metadata (model, serial number)
- Per-device configuration and overrides

### 4️⃣ Advanced Reporting
- **Tariff Report:** Consumption breakdown by Day/Peak/Off-Peak per meter
- **Generator Analysis:** CEB vs Generator usage, switchover counts, run hours
- **Device Comparison:** Side-by-side comparison of multiple meters
- **Consumption Trends:** Historical trends over 1-365 days
- **Power Quality:** Voltage, current, apparent power analysis
- **Export:** Excel (.xlsx) and PDF formats

### 5️⃣ Alert System
- 5 alert types: Over Voltage, Low Voltage, Low Power Factor, High KVA, Power Interruption
- Global + Device-level setpoints (device overrides global)
- 3 severity levels: Critical (red), Warning (yellow), Info (blue)
- Email notifications (configurable per alert type)
- Alert acknowledgment and history

### 6️⃣ User Management
- Admin: Full access to settings, users, reports, alerts
- Viewer: Read-only access to dashboard, alerts, reports
- Role-based UI (hides admin sections for viewers)
- Email verification required before login
- Password reset functionality

### 7️⃣ Theme System
- Dark mode (default) for 24/7 monitoring environments
- Light mode for office/daytime usage
- Per-user preference saved
- Smooth transitions

### 8️⃣ Visual Enhancements
- Pulsing animation for critical active alerts
- Blinking badges for unacknowledged alerts
- Color-coded severity indicators
- Real-time status badges

### 9️⃣ Data Integration
- MQTT integration for real meters
- Data simulator for testing (when no real hardware)
- Modbus gateway compatibility
- JSON message format

### 🔟 Automation
- Scheduled daily/monthly report generation
- Automatic email distribution
- Daily summary recalculation
- Generator runtime summary calculation
- Hourly CEB vs Generator tracking

## API Endpoints

### Authentication
```
POST   /api/auth/register              - User registration
POST   /api/auth/login                 - Login & get JWT token
GET    /api/auth/verify/:token         - Verify email
POST   /api/auth/forgot-password        - Password recovery
POST   /api/auth/reset-password         - Reset password
GET    /api/auth/me                     - Current user profile
GET    /api/auth/users                  - List all users (admin)
PUT    /api/auth/users/:id/role         - Change user role (admin)
```

### Readings
```
GET    /api/readings/latest             - Latest reading across all meters
GET    /api/readings/energy/history     - Energy reading history
GET    /api/readings/diesel/history     - Diesel reading history
GET    /api/readings/generator/events   - Generator on/off events
GET    /api/readings/summary/daily      - Daily aggregates
GET    /api/readings/summary/monthly    - Monthly aggregates
GET    /api/readings/summary/yearly     - Yearly aggregates
GET    /api/readings/power-interruptions - Power cut events
GET    /api/readings/dashboard-stats    - Today's KPIs
```

### Alerts
```
GET    /api/alerts                      - List alerts with filters
GET    /api/alerts/active               - Active/unacknowledged alerts
GET    /api/alerts/stats                - Alert statistics by type/severity
GET    /api/alerts/setpoints            - List alert thresholds
PUT    /api/alerts/:id/acknowledge      - Mark alert acknowledged
PUT    /api/alerts/acknowledge-all      - Acknowledge all unacknowledged
PUT    /api/alerts/setpoints/:type      - Update setpoint (admin)
```

### Reports
```
POST   /api/reports/generate            - Generate Excel/PDF report
GET    /api/reports/history             - Report generation log
GET    /api/reports/tariff              - Tariff report (Day/Peak/Off-Peak)
GET    /api/reports/generator-analysis  - CEB vs Generator analysis
GET    /api/reports/device-comparison   - Compare multiple meters
GET    /api/reports/consumption-trend   - Historical trend analysis
```

### Settings (Admin Only)
```
GET    /api/settings/plants             - List plants
POST   /api/settings/plants             - Create plant
PUT    /api/settings/plants/:id         - Update plant
DELETE /api/settings/plants/:id         - Delete plant

GET    /api/settings/energy-meters      - List energy meters
POST   /api/settings/energy-meters      - Register energy meter
PUT    /api/settings/energy-meters/:id  - Update meter
DELETE /api/settings/energy-meters/:id  - Delete meter

GET    /api/settings/flow-meters        - List flow meters
POST   /api/settings/flow-meters        - Register flow meter
PUT    /api/settings/flow-meters/:id    - Update meter
DELETE /api/settings/flow-meters/:id    - Delete meter

GET    /api/settings/generators         - List generators
POST   /api/settings/generators         - Register generator
PUT    /api/settings/generators/:id     - Update generator
DELETE /api/settings/generators/:id     - Delete generator
```

### Device-Level Setpoints
```
GET    /api/device-setpoints            - List all device overrides
GET    /api/device-setpoints/effective  - Get effective setpoints for meter
POST   /api/device-setpoints            - Create device override
PUT    /api/device-setpoints/:id        - Update device override
DELETE /api/device-setpoints/:id        - Delete device override
```

### User Preferences
```
GET    /api/user/preferences            - Get theme, notifications, etc
PUT    /api/user/preferences            - Update preferences
```

## Technology Stack

### Backend
- **Runtime:** Node.js 20+
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** PostgreSQL (14+)
- **Real-time:** Socket.io
- **Data Integration:** MQTT client, Modbus (via gateway)
- **Reports:** ExcelJS, PDFKit
- **Auth:** JWT, bcryptjs
- **Email:** Nodemailer
- **Scheduling:** node-cron

### Frontend
- **Framework:** React 18
- **Language:** TypeScript
- **Build Tool:** Vite
- **Styling:** TailwindCSS
- **Data Fetching:** Axios, React Query
- **Charts:** Recharts
- **Icons:** lucide-react
- **Notifications:** react-hot-toast
- **Routing:** React Router

### Database
- **RDBMS:** PostgreSQL
- **Connection:** pg (Node.js driver)
- **Hosted:** 172.235.8.137 (remote)

### Deployment
- **Containerization:** Docker (Dockerfile included)
- **Orchestration:** docker-compose
- **CI/CD:** (Optional, can be added)

## Performance Considerations

### Optimization Strategies
1. **Pre-aggregated Summaries** - Daily summaries reduce query load
2. **Setpoint Caching** - 60-second cache to avoid frequent DB lookups
3. **Pagination** - Limit results to 500 readings per query
4. **Indexes** - On recorded_at, plant_id, meter_id for fast filtering
5. **Socket.io Broadcasting** - Avoid redundant API calls
6. **Daily Data Cleanup** - Archive old readings (optional)

### Scalability
Current setup handles:
- **9 Energy Meters** - ~1,728 readings/day (5-sec interval)
- **2 Flow Meters** - ~384 readings/day
- **100+ Concurrent Users** - With Socket.io broadcasting
- **3 Years of History** - ~2GB database (estimate)

To scale further:
- Add read replicas for PostgreSQL
- Implement caching layer (Redis)
- Archive old data to S3/glacier
- Use time-series DB (TimescaleDB) for readings

## Security Features

✅ **Authentication**
- JWT tokens with expiration
- Email verification required
- Password hashing (bcryptjs, 12 rounds)
- Password reset flow

✅ **Authorization**
- Role-based access control (Admin/Viewer)
- Admin-only endpoints
- User can only access their own data

✅ **Data Protection**
- CORS enabled for trusted origins
- Rate limiting on auth endpoints
- SQL parameterization (pg driver)
- No sensitive data in logs

✅ **Transport Security**
- HTTPS-ready (use reverse proxy in production)
- WebSocket (Socket.io) uses same auth

## Monitoring & Maintenance

### Logs to Monitor
```
[Server] Port 5000               - Server started
[DB] Connected                   - Database connected
[MQTT] Connected to broker       - MQTT connection
[Simulator] Started              - Test data generation
[Scheduler] Cron jobs started    - Automated tasks
```

### Database Maintenance
```sql
-- Check table sizes
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname != 'pg_catalog'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check for unused indexes
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0;

-- Vacuum and analyze
VACUUM ANALYZE;
```

### Backup Strategy
```bash
# Daily backup
pg_dump -h 172.235.8.137 -U rhinoadminuser -d rhino > rhino_$(date +%Y%m%d).sql

# Compress backup
gzip rhino_*.sql

# Keep last 30 days
find . -name "rhino_*.sql.gz" -mtime +30 -delete
```

## Next Steps

1. ✅ **Deploy Backend** with all controllers and routes
2. ✅ **Run Database Migrations** to create all tables
3. ✅ **Register Your Devices** (9 energy + 2 flow meters)
4. ✅ **Configure MQTT or Simulator** for data ingestion
5. ✅ **Deploy Frontend** with theme system and reports
6. ⏳ **Configure Email Automation** (Phase 4)
7. ⏳ **Add Advanced Features** (Predictive alerts, cost forecasting, etc)

## Documentation Files

- `IMPLEMENTATION_GUIDE.md` - Step-by-step setup
- `FRONTEND_UPGRADE.md` - Frontend code & components
- `UPGRADE_PLAN.md` - Architecture & detailed requirements
- `MQTT_GUIDE.md` - Real meter integration
- `README.md` - Project overview & quick start

## Support & Troubleshooting

**Check logs first:**
```bash
# Backend logs
npm run dev

# Frontend browser console
F12 → Console tab

# Database logs
psql → SELECT * FROM alerts LIMIT 10;
```

**Common commands:**

```bash
# Backend development
cd backend && npm run dev

# Frontend development
cd frontend && npm run dev

# Run migrations
cd backend && npm run db:migrate

# Check API
curl http://localhost:5000/api/health

# View database
psql -h 172.235.8.137 -U rhinoadminuser -d rhino
```

---

**Status:** ✅ Production Ready (with optional Phase 4 enhancements)

**Last Updated:** 2024-06-03

**Architecture Version:** 2.0 (TypeScript + Multi-Plant + Device Registry + MQTT)
