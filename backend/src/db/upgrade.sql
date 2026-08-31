-- ============================================================
-- UPGRADE: Email Config, User Prefs
-- device_alert_setpoints moved to schema.sql (now created on every install).
-- ============================================================

-- Email report automation config
CREATE TABLE IF NOT EXISTS email_report_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  report_type VARCHAR(100) NOT NULL, -- 'daily', 'weekly', 'monthly', 'tariff'
  include_graphs BOOLEAN DEFAULT true,
  include_summary BOOLEAN DEFAULT true,
  include_alerts BOOLEAN DEFAULT true,
  schedule VARCHAR(100) NOT NULL, -- cron: '0 8 * * *' = daily 8am
  recipients TEXT NOT NULL, -- comma-separated emails
  enabled BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erc_user_id ON email_report_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_erc_plant_id ON email_report_configs(plant_id);

-- Generator runtime summary (daily)
CREATE TABLE IF NOT EXISTS generator_runtime_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id VARCHAR(100) NOT NULL,
  plant_id UUID REFERENCES plants(id) ON DELETE SET NULL,
  summary_date DATE NOT NULL,
  ceb_hours NUMERIC(5,2) DEFAULT 0,
  generator_hours NUMERIC(5,2) DEFAULT 0,
  total_hours NUMERIC(5,2) DEFAULT 24,
  switchover_count INT DEFAULT 0,
  generator_percentage NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_gen_summary UNIQUE(meter_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_grs_meter_id ON generator_runtime_summary(meter_id);
CREATE INDEX IF NOT EXISTS idx_grs_plant_id ON generator_runtime_summary(plant_id);
CREATE INDEX IF NOT EXISTS idx_grs_date ON generator_runtime_summary(summary_date DESC);

-- User preferences (theme, notifications, etc)
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(20) DEFAULT 'dark', -- 'light' or 'dark'
  alert_sound BOOLEAN DEFAULT true,
  email_notifications BOOLEAN DEFAULT true,
  email_daily_digest BOOLEAN DEFAULT true,
  alert_snooze_minutes INT DEFAULT 60,
  timezone VARCHAR(100) DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_up_user_id ON user_preferences(user_id);

-- Tariff configuration (company-wide or per-plant)
CREATE TABLE IF NOT EXISTS tariff_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID REFERENCES plants(id) ON DELETE CASCADE,
  period_type VARCHAR(20) NOT NULL, -- 'day', 'peak', 'offpeak'
  rate_per_kwh NUMERIC(10,3) NOT NULL,
  currency VARCHAR(10) DEFAULT 'LKR',
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_tariff UNIQUE(plant_id, period_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_tc_plant_id ON tariff_config(plant_id);

-- Hour-by-hour CEB/Generator breakdown (for detailed analysis)
CREATE TABLE IF NOT EXISTS hourly_source_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id VARCHAR(100) NOT NULL,
  plant_id UUID REFERENCES plants(id),
  summary_date DATE NOT NULL,
  hour INT NOT NULL CHECK (hour >= 0 AND hour < 24),
  ceb_kwh NUMERIC(10,3) DEFAULT 0,
  generator_kwh NUMERIC(10,3) DEFAULT 0,
  total_kwh NUMERIC(10,3) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_hourly UNIQUE(meter_id, summary_date, hour)
);

CREATE INDEX IF NOT EXISTS idx_hss_meter_date ON hourly_source_summary(meter_id, summary_date DESC);

-- Alarm/Alert notification history (for UI animations)
CREATE TABLE IF NOT EXISTS alert_notifications (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGSERIAL NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  notified_via VARCHAR(50), -- 'email', 'push', 'ui', 'sms'
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_an_alert_id ON alert_notifications(alert_id DESC);
CREATE INDEX IF NOT EXISTS idx_an_user_id ON alert_notifications(user_id);
