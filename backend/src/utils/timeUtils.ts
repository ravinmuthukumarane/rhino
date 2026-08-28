import { TimePeriod } from '../types';

// Sri Lanka local time, fixed UTC+5:30 (no DST).
const IST_TZ = 'Asia/Colombo';

// Day: 05:30–18:30 | Peak: 18:30–22:30 | Off-peak: 22:30–05:30 (Sri Lanka local time)
// Computed from UTC fields + a fixed +5:30 offset (Sri Lanka has no DST) so
// this is correct regardless of the server/container's own system timezone -
// getHours()/getMinutes() would silently use whatever TZ the OS is set to,
// which is UTC on this deployment, shifting every boundary by 5.5 hours.
export function getTimePeriod(date: Date = new Date()): TimePeriod {
  const total = (date.getUTCHours() * 60 + date.getUTCMinutes() + 330) % 1440;
  if (total >= 330 && total < 1110) return 'day';
  if (total >= 1110 && total < 1350) return 'peak';
  return 'off_peak';
}

// Calendar date (YYYY-MM-DD) in Sri Lanka local time - use this (not
// `date.toISOString().split('T')[0]`) anywhere a reading/report is bucketed
// by "day". The server runs on UTC system time, so plain UTC-based date
// slicing misfiles every reading between 00:00–05:30 IST under the previous
// day - `en-CA` gives ISO-ordered YYYY-MM-DD directly.
export function getISTDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(date);
}

// { year, month (1-indexed), day } in Sri Lanka local time - for calendar
// math (e.g. "1st of last month") that must anchor to IST, not server UTC.
export function getISTParts(date: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// Display formatting anchored to Sri Lanka local time regardless of server
// timezone - plain `toLocaleString()`/`toLocaleDateString()` on the server
// render in the server's own (UTC) system time, which is off by 5.5 hours
// from what report/email recipients in Sri Lanka expect.
export function formatISTDate(date: Date | string, options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }): string {
  return new Date(date).toLocaleDateString('en-GB', { timeZone: IST_TZ, ...options });
}

export function formatISTDateTime(date: Date | string): string {
  return new Date(date).toLocaleString('en-GB', { timeZone: IST_TZ });
}

export function getDateRange(type: string, reference: Date = new Date()): { start: Date; end: Date } {
  const d = new Date(reference);
  switch (type) {
    case 'today':       return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate()), end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) };
    case 'yesterday':   return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1), end: new Date(d.getFullYear(), d.getMonth(), d.getDate()) };
    case 'this_month':  return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
    case 'last_month':  return { start: new Date(d.getFullYear(), d.getMonth() - 1, 1), end: new Date(d.getFullYear(), d.getMonth(), 1) };
    case 'this_year':   return { start: new Date(d.getFullYear(), 0, 1), end: new Date(d.getFullYear() + 1, 0, 1) };
    case 'last_30_days':{ const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return { start: new Date(end.getTime() - 30 * 86400000), end }; }
    default:            return { start: new Date(0), end: new Date() };
  }
}
