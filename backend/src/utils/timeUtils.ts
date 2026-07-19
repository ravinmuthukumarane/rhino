import { TimePeriod } from '../types';

// Day: 05:30–18:30 | Peak: 18:30–22:30 | Off-peak: 22:30–05:30
export function getTimePeriod(date: Date = new Date()): TimePeriod {
  const total = date.getHours() * 60 + date.getMinutes();
  if (total >= 330 && total < 1110) return 'day';
  if (total >= 1110 && total < 1350) return 'peak';
  return 'off_peak';
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
