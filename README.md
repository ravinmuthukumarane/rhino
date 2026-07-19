# Rhino Energy Monitoring System

A comprehensive full-stack energy monitoring and reporting platform with real-time alerts, multi-plant support, and advanced analytics.

## Features

- **Real-time Monitoring**: Live voltage, current, power, KVA, power factor, and 3rd harmonic tracking across multiple plants
- **Multi-Plant Architecture**: Separate device registries and readings per location with unified dashboard
- **Device Registry**: Centralized management of energy meters, flow meters, and generators
- **Alert System**: Configurable thresholds with email notifications and manual acknowledgment
- **Power Quality Monitoring**: 3-phase voltage/current/harmonic analysis with 3rd harmonic tracking
- **Comprehensive Reports**: Daily/monthly/yearly energy and diesel consumption reports in Excel/PDF
- **Role-Based Access**: Admin (full control) and Viewer (read-only) roles
- **Real-time Updates**: Socket.io for live readings, alerts, and power event notifications
- **Data Simulator**: Generates realistic test data without hardware
- **Pre-aggregated Summaries**: Daily energy/diesel summaries for performance
- **Automated Scheduling**: Monthly report generation and daily summary recalculation via cron

## Tech Stack

**Backend**: Node.js, Express, TypeScript, PostgreSQL, Socket.io, Nodemailer, ExcelJS, PDFKit
**Frontend**: React 18, TypeScript, Vite, TailwindCSS, Recharts, React Query, Axios

## Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose (for containerized deployment)
- PostgreSQL 14+ (or use the included Docker Postgres)

### Development Setup

1. **Clone and install dependencies:**
   ```bash
   cd backend && npm install && cd ../frontend && npm install && cd ..
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your database and SMTP credentials
   ```

3. **Set database credentials in `.env.local`:**
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=rhino
   DB_USER=rhinoadminuser
   DB_PASSWORD=rhinosecpass951
   ```

4. **Run database migrations:**
   ```bash
   cd backend && npm run db:migrate
   npm run db:seed
   cd ..
   ```

5. **Start development servers:**
   ```bash
   # Terminal 1: Backend (port 5000)
   cd backend && npm run dev

   # Terminal 2: Frontend (port 3000)
   cd frontend && npm run dev
   ```

6. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000/api

### Default Credentials

The seed data creates:
- **Email**: admin@rhino.local
- **Password**: (set during registration for first user)
- **Role**: Admin (first user automatically becomes admin)

### Docker Deployment

1. **Build and run with Docker Compose:**
   ```bash
   docker-compose up --build
   ```

2. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000/api
   - Database: postgres://rhinoadminuser:rhinosecpass951@localhost:5432/rhino

3. **Run migrations in container:**
   ```bash
   docker-compose exec backend npm run db:migrate
   docker-compose exec backend npm run db:seed
   ```

### Production Deployment

1. **Update environment variables:**
   - Change `JWT_SECRET` to a strong random value (min 32 chars)
   - Configure real SMTP credentials for email notifications
   - Set appropriate `NODE_ENV=production`

2. **Build images:**
   ```bash
   docker-compose build
   docker-compose up -d
   ```

3. **Health checks:**
   ```bash
   curl http://localhost:5000/health
   ```

## Environment Variables

See `.env.example` for all available options. Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL hostname | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USER` | Database user | `rhinoadminuser` |
| `DB_PASSWORD` | Database password | `rhinosecpass951` |
| `JWT_SECRET` | JWT signing secret | (required) |
| `SMTP_HOST` | Email server hostname | - |
| `SMTP_USER` | Email account | - |
| `SMTP_PASS` | Email app password | - |
| `ENABLE_SIMULATOR` | Enable test data generation | `true` |
| `ENABLE_SCHEDULER` | Enable automated jobs | `true` |

## Database Setup

### Local PostgreSQL

```bash
# Create database and user
createuser -P rhinoadminuser
createdb -O rhinoadminuser rhino

# Run migrations
cd backend && npm run db:migrate npm run db:seed
```

### External PostgreSQL

Update `.env.local`:
```
DB_HOST=172.235.8.137
DB_USER=rhinoadminuser
DB_PASSWORD=rhinosecpass951
```

Then run migrations as above.

### Docker PostgreSQL

The `docker-compose.yml` includes a PostgreSQL service. Migrations run automatically on backend startup.

## API Reference

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/verify-email` - Email verification
- `GET /api/auth/profile` - Current user profile

### Readings
- `GET /api/readings/latest` - Latest readings across all meters
- `GET /api/readings/energy-history` - Historical energy readings
- `GET /api/readings/daily-summary` - Daily aggregates
- `GET /api/readings/monthly-summary` - Monthly aggregates
- `GET /api/readings/dashboard-stats` - Dashboard KPIs

### Alerts
- `GET /api/alerts` - List alerts with filtering
- `POST /api/alerts/:id/acknowledge` - Acknowledge single alert
- `POST /api/alerts/acknowledge-all` - Acknowledge all alerts
- `GET /api/alerts/setpoints` - Get alert thresholds
- `PUT /api/alerts/setpoints/:type` - Update threshold (admin)

### Reports
- `POST /api/reports/generate` - Generate Excel/PDF report
- `GET /api/reports/history` - Report generation audit log

### Settings (Admin Only)
- `GET/POST /api/settings/plants` - Plant management
- `GET/POST /api/settings/energy-meters` - Energy meter registry
- `GET/POST /api/settings/flow-meters` - Diesel flow meter registry
- `GET/POST /api/settings/generators` - Generator registry

### Users (Admin Only)
- `GET /api/auth/users` - List all users
- `PUT /api/auth/users/:id/role` - Change user role

## WebSocket Events

The backend emits real-time events via Socket.io:

- `live_reading` - New meter reading (voltage, current, power, etc.)
- `new_alert` - Alert triggered
- `power_interruption` - Power cut detected (CEB → Generator)
- `power_restored` - Power restored (Generator → CEB)

## Alert Types

| Type | Threshold | Default |
|------|-----------|---------|
| Over Voltage | Max voltage | 255V |
| Low Voltage | Min voltage | 195V |
| Low Power Factor | Min PF | 0.85 |
| High KVA | Max apparent power | 100 kVA |
| High 3rd Harmonic | Max THD % | 5% |
| Power Interruption | Event-based | - |

## Time Periods

Readings are classified as:
- **Day** (morning rate): 05:30–18:30
- **Peak** (peak rate): 18:30–22:30
- **Off-Peak** (off-peak rate): 22:30–05:30

Useful for time-of-use tariff analysis.

## Troubleshooting

**Database connection fails:**
- Verify PostgreSQL is running and credentials match `.env.local`
- Check firewall rules if using remote database
- Ensure database user has superuser or createdb privileges

**Simulator not generating data:**
- Check `ENABLE_SIMULATOR=true` in environment
- Monitor backend logs for errors
- Ensure database migrations completed successfully

**Email notifications not sending:**
- Verify SMTP credentials in `.env.local`
- Check firewall/VPN allows outbound SMTP (port 587)
- Enable "Less secure app access" if using Gmail

**Frontend unable to connect to API:**
- Ensure backend is running on port 5000
- Check proxy settings in `vite.config.ts`
- Verify CORS is enabled in backend

## License

Proprietary
