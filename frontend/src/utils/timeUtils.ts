import type { TimePeriod } from '../types';

export function getTimePeriod(date: Date = new Date()): TimePeriod {
  const t = date.getHours() * 60 + date.getMinutes();
  if (t >= 330 && t < 1110) return 'day';
  if (t >= 1110 && t < 1350) return 'peak';
  return 'off_peak';
}

export const timePeriodLabels: Record<TimePeriod, string> = {
  day: 'Day (05:30–18:30)',
  peak: 'Peak (18:30–22:30)',
  off_peak: 'Off-Peak (22:30–05:30)',
};

export const timePeriodColors: Record<TimePeriod, string> = {
  day: '#22c55e',
  peak: '#f59e0b',
  off_peak: '#3b82f6',
};
