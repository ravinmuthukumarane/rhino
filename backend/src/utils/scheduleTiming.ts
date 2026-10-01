import { getISTParts, getISTDateString, formatISTDate } from './timeUtils';

// Report schedule slots, all in Sri Lanka time (UTC+5:30, no DST). A daily
// schedule fires every day at send_time; a monthly one on send_day (1-28,
// so it exists in every month) at send_time.
export interface ScheduleTiming {
  frequency: 'daily' | 'monthly';
  send_day: number;
  send_time: string; // 'HH:MM' or 'HH:MM:SS' (pg TIME)
}

const IST_OFFSET_MS = 330 * 60000;

// UTC instant for a Sri Lanka wall-clock time. Date.UTC normalises month/day
// overflow (month 0 -> December of the previous year, etc).
function istInstant(year: number, month: number, day: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hh, mm) - IST_OFFSET_MS);
}

function hhmm(t: string): [number, number] {
  const [h, m] = t.split(':').map(Number);
  return [h || 0, m || 0];
}

// The most recent slot at or before `now`.
export function lastSlot(s: ScheduleTiming, now: Date = new Date()): Date {
  const { year, month, day } = getISTParts(now);
  const [hh, mm] = hhmm(s.send_time);
  if (s.frequency === 'daily') {
    const t = istInstant(year, month, day, hh, mm);
    return t > now ? new Date(t.getTime() - 86400000) : t;
  }
  const t = istInstant(year, month, s.send_day, hh, mm);
  return t > now ? istInstant(year, month - 1, s.send_day, hh, mm) : t;
}

// The first slot strictly after `now`.
export function nextSlot(s: ScheduleTiming, now: Date = new Date()): Date {
  const { year, month, day } = getISTParts(now);
  const [hh, mm] = hhmm(s.send_time);
  if (s.frequency === 'daily') {
    const t = istInstant(year, month, day, hh, mm);
    return t > now ? t : new Date(t.getTime() + 86400000);
  }
  const t = istInstant(year, month, s.send_day, hh, mm);
  return t > now ? t : istInstant(year, month + 1, s.send_day, hh, mm);
}

// The period a slot reports on: daily -> the IST day before the slot's day;
// monthly -> the calendar month before the slot's month.
export function slotPeriod(frequency: 'daily' | 'monthly', slot: Date): { start: string; end: string; label: string } {
  if (frequency === 'daily') {
    const d = getISTDateString(new Date(slot.getTime() - 86400000));
    return { start: d, end: d, label: formatISTDate(`${d}T00:00:00+05:30`, { year: 'numeric', month: 'long', day: 'numeric' }) };
  }
  const { year, month } = getISTParts(slot);
  const start = new Date(Date.UTC(year, month - 2, 1)).toISOString().split('T')[0];
  const end = new Date(Date.UTC(year, month - 1, 0)).toISOString().split('T')[0];
  return { start, end, label: formatISTDate(`${start}T00:00:00+05:30`, { year: 'numeric', month: 'long' }) };
}
