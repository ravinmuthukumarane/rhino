-- Energy Monitoring System v2 — PostgreSQL Schema
-- Roles: admin / viewer only
-- Multi-plant support, 3rd harmonics, device registry

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PLANTS (locations)
-- ============================================================
CREATE TABLE IF NOT EXISTS plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DEVICE REGISTRY
-- ============================================================
CREATE TABLE IF NOT EXISTS energy_meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  model VARCHAR(255),
  serial_number VARCHAR(255),
  device_id VARCHAR(50) UNIQUE,          -- MQTT bridge device id, e.g. "u155_10" (gateway last octet + Modbus unit)
  default_source VARCHAR(20) DEFAULT 'CEB' CHECK (default_source IN ('CEB', 'GENERATOR')),
  plant_section VARCHAR(20),             -- physical section/incomer this meter is fed from, e.g. "P1", "P4"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  model VARCHAR(255),
  fluid_type VARCHAR(100) DEFAULT 'diesel',
  device_id VARCHAR(50) UNIQUE,           -- MQTT bridge device id, e.g. "u119_01" (gateway last octet + Modbus unit)
  plant_section VARCHAR(20),             -- physical section/incomer this meter is fed from, e.g. "P1", "P4"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generator_id VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  capacity_kva NUMERIC(10,2),
  fuel_type VARCHAR(100) DEFAULT 'diesel',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENERGY READINGS (includes 3rd harmonics)
-- ============================================================
CREATE TABLE IF NOT EXISTS energy_readings (
  id BIGSERIAL PRIMARY KEY,
  meter_id VARCHAR(100) NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  voltage_r NUMERIC(8,3),
  voltage_y NUMERIC(8,3),
  voltage_b NUMERIC(8,3),
  current_r NUMERIC(8,3),
  current_y NUMERIC(8,3),
  current_b NUMERIC(8,3),
  power_kw NUMERIC(10,3),
  power_kva NUMERIC(10,3),
  power_factor NUMERIC(5,3),
  energy_kwh NUMERIC(14,3),
  frequency NUMERIC(5,2) DEFAULT 50.0,
  -- 3rd harmonic as % of fundamental
  third_harmonic_r NUMERIC(6,2),
  third_harmonic_y NUMERIC(6,2),
  third_harmonic_b NUMERIC(6,2),
  source VARCHAR(20) DEFAULT 'CEB' CHECK (source IN ('CEB', 'GENERATOR')),
  time_period VARCHAR(20) CHECK (time_period IN ('day', 'peak', 'off_peak')),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_recorded_at   ON energy_readings (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_er_meter_id       ON energy_readings (meter_id);
CREATE INDEX IF NOT EXISTS idx_er_plant_id       ON energy_readings (plant_id);
CREATE INDEX IF NOT EXISTS idx_er_source         ON energy_readings (source);
CREATE INDEX IF NOT EXISTS idx_er_time_period    ON energy_readings (time_period);
-- Composite, supports `DISTINCT ON (meter_id) ... ORDER BY meter_id, recorded_at DESC`
-- (the latest-reading-per-meter query the dashboard/plant overview run on
-- every load) as a single index scan instead of a per-meter sort.
CREATE INDEX IF NOT EXISTS idx_er_meter_recorded ON energy_readings (meter_id, recorded_at DESC);

-- ============================================================
-- FLOW / DIESEL READINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS diesel_readings (
  id BIGSERIAL PRIMARY KEY,
  meter_id VARCHAR(100) NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  flow_rate NUMERIC(10,3),
  total_volume NUMERIC(14,3),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dr_recorded_at ON diesel_readings (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_meter_id     ON diesel_readings (meter_id);
CREATE INDEX IF NOT EXISTS idx_dr_plant_id     ON diesel_readings (plant_id);
-- Same reasoning as idx_er_meter_recorded above, for diesel_readings.
CREATE INDEX IF NOT EXISTS idx_dr_meter_recorded ON diesel_readings (meter_id, recorded_at DESC);

-- ============================================================
-- GENERATOR EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS generator_events (
  id BIGSERIAL PRIMARY KEY,
  generator_id VARCHAR(100) NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ON', 'OFF')),
  reason VARCHAR(255),
  fuel_level_pct NUMERIC(5,2),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ge_recorded_at ON generator_events (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ge_plant_id     ON generator_events (plant_id);

-- ============================================================
-- POWER INTERRUPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS power_interruptions (
  id BIGSERIAL PRIMARY KEY,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  meter_id VARCHAR(100),
  started_at TIMESTAMPTZ NOT NULL,
  restored_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  generator_activated BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pi_started_at ON power_interruptions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pi_plant_id    ON power_interruptions (plant_id);

-- ============================================================
-- ALERT SETPOINTS
-- ============================================================
CREATE TABLE IF NOT EXISTS alert_setpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(100) UNIQUE NOT NULL,
  label VARCHAR(255) NOT NULL,
  unit VARCHAR(50),
  min_value NUMERIC(12,3),
  max_value NUMERIC(12,3),
  enabled BOOLEAN DEFAULT true,
  email_notify BOOLEAN DEFAULT true,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ALERTS LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  alert_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  message TEXT NOT NULL,
  value NUMERIC(12,3),
  setpoint_value NUMERIC(12,3),
  source VARCHAR(20),
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  meter_id VARCHAR(100),
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  email_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at   ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged  ON alerts (acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_plant_id      ON alerts (plant_id);

-- ============================================================
-- DAILY SUMMARIES (pre-aggregated, per meter)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_energy_summary (
  id BIGSERIAL PRIMARY KEY,
  summary_date DATE NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  meter_id VARCHAR(100) NOT NULL,
  total_kwh NUMERIC(14,3) DEFAULT 0,
  max_kva NUMERIC(10,3) DEFAULT 0,
  avg_power_factor NUMERIC(5,3) DEFAULT 0,
  avg_voltage NUMERIC(8,3) DEFAULT 0,
  max_current NUMERIC(8,3) DEFAULT 0,
  ceb_kwh NUMERIC(14,3) DEFAULT 0,
  generator_kwh NUMERIC(14,3) DEFAULT 0,
  day_kwh NUMERIC(14,3) DEFAULT 0,
  peak_kwh NUMERIC(14,3) DEFAULT 0,
  off_peak_kwh NUMERIC(14,3) DEFAULT 0,
  interruption_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (summary_date, meter_id)
);

CREATE INDEX IF NOT EXISTS idx_des_date      ON daily_energy_summary (summary_date DESC);
CREATE INDEX IF NOT EXISTS idx_des_plant_id  ON daily_energy_summary (plant_id);

CREATE TABLE IF NOT EXISTS daily_diesel_summary (
  id BIGSERIAL PRIMARY KEY,
  summary_date DATE NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  meter_id VARCHAR(100) NOT NULL,
  total_liters NUMERIC(14,3) DEFAULT 0,
  generator_run_hours NUMERIC(8,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (summary_date, meter_id)
);

-- ============================================================
-- REPORTS LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type VARCHAR(100) NOT NULL,
  period_start DATE,
  period_end DATE,
  format VARCHAR(20) CHECK (format IN ('pdf', 'excel')),
  file_name VARCHAR(500),
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  generated_by UUID REFERENCES users(id),
  auto_generated BOOLEAN DEFAULT false,
  email_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REPORT SCHEDULES (configurable auto-email daily/monthly report)
-- ============================================================
CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frequency VARCHAR(20) UNIQUE NOT NULL CHECK (frequency IN ('daily', 'monthly')),
  enabled BOOLEAN DEFAULT true,
  report_type VARCHAR(50) NOT NULL DEFAULT 'consumption_summary',
  format VARCHAR(20) NOT NULL DEFAULT 'excel' CHECK (format IN ('excel', 'pdf')),
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_plants_upd BEFORE UPDATE ON plants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_em_upd BEFORE UPDATE ON energy_meters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_fm_upd BEFORE UPDATE ON flow_meters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_gen_upd BEFORE UPDATE ON generators FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
