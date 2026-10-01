// Reading -> kWh has to use the real time between readings, not a fixed
// interval. Every kWh total used to assume one reading per 5 seconds, but the
// real gateways publish roughly every 44s - every report under-counted by
// ~8.8x (verified against the meters' own cumulative import_kwh registers,
// which match the time-weighted figure within ~1%).
//
// Each reading is weighted by the gap since the same meter's previous
// reading. A gap longer than MAX_READING_GAP_S (gateway/meter outage) only
// counts up to the cap - the load during an outage is unknown, so it isn't
// extrapolated. The first reading in a window has no predecessor and counts 0.
export const MAX_READING_GAP_S = 300;

// Hours a single live reading represents (same rule as the SQL below).
export function readingIntervalHours(prev: Date | null, current: Date): number {
  if (!prev) return 0;
  const gapS = (current.getTime() - prev.getTime()) / 1000;
  return gapS > 0 ? Math.min(gapS, MAX_READING_GAP_S) / 3600 : 0;
}

// Drop-in replacement for `energy_readings er` that adds `interval_h` (hours
// this reading represents). `fromParam`/`toParam` are SQL placeholders (e.g.
// '$2') bounding the window - the window function needs them inside the
// subquery so it doesn't scan the whole hypertable.
export function readingsWithInterval(fromParam: string, toParam?: string): string {
  return `(SELECT r.*,
      LEAST(COALESCE(EXTRACT(EPOCH FROM r.recorded_at - LAG(r.recorded_at) OVER (PARTITION BY r.meter_id ORDER BY r.recorded_at)), 0), ${MAX_READING_GAP_S}) / 3600.0 AS interval_h
    FROM energy_readings r
    WHERE r.recorded_at >= ${fromParam}::timestamptz${toParam ? ` AND r.recorded_at < ${toParam}::timestamptz` : ''})`;
}
