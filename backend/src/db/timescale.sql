-- TimescaleDB setup — converts the time-series tables into compressed hypertables.
-- Run AFTER schema.sql (tables must already exist). Safe to re-run (idempotent).
-- Requires the timescaledb extension to be installed on the Postgres server itself
-- (bundled in the timescale/timescaledb Docker image — see docker-compose.yml).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================
-- energy_readings — highest volume, one row per meter per simulator tick
-- ============================================================
ALTER TABLE energy_readings DROP CONSTRAINT IF EXISTS energy_readings_pkey;
ALTER TABLE energy_readings ADD PRIMARY KEY (id, recorded_at);
SELECT create_hypertable('energy_readings', 'recorded_at',
  chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE energy_readings SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'meter_id',
  timescaledb.compress_orderby = 'recorded_at DESC'
);
SELECT add_compression_policy('energy_readings', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================
-- diesel_readings
-- ============================================================
ALTER TABLE diesel_readings DROP CONSTRAINT IF EXISTS diesel_readings_pkey;
ALTER TABLE diesel_readings ADD PRIMARY KEY (id, recorded_at);
SELECT create_hypertable('diesel_readings', 'recorded_at',
  chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE diesel_readings SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'meter_id',
  timescaledb.compress_orderby = 'recorded_at DESC'
);
SELECT add_compression_policy('diesel_readings', INTERVAL '7 days', if_not_exists => TRUE);

-- ============================================================
-- generator_events — low volume, insert-only
-- ============================================================
ALTER TABLE generator_events DROP CONSTRAINT IF EXISTS generator_events_pkey;
ALTER TABLE generator_events ADD PRIMARY KEY (id, recorded_at);
SELECT create_hypertable('generator_events', 'recorded_at',
  chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE generator_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'generator_id',
  timescaledb.compress_orderby = 'recorded_at DESC'
);
SELECT add_compression_policy('generator_events', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================================
-- alerts — rows are UPDATEd (acknowledged_*) shortly after insert, so give
-- them a longer window before compressing to avoid touching compressed chunks.
-- ============================================================
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_pkey;
ALTER TABLE alerts ADD PRIMARY KEY (id, created_at);
SELECT create_hypertable('alerts', 'created_at',
  chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE alerts SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'alert_type',
  timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('alerts', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================================
-- power_interruptions — rows are UPDATEd (restored_at) shortly after insert,
-- same reasoning as alerts.
-- ============================================================
ALTER TABLE power_interruptions DROP CONSTRAINT IF EXISTS power_interruptions_pkey;
ALTER TABLE power_interruptions ADD PRIMARY KEY (id, started_at);
SELECT create_hypertable('power_interruptions', 'started_at',
  chunk_time_interval => INTERVAL '30 days', if_not_exists => TRUE, migrate_data => TRUE);
ALTER TABLE power_interruptions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'plant_id',
  timescaledb.compress_orderby = 'started_at DESC'
);
SELECT add_compression_policy('power_interruptions', INTERVAL '30 days', if_not_exists => TRUE);
