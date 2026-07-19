export function getTimePeriod(date = new Date()) {
  const h = date.getHours();
  const m = date.getMinutes();
  const total = h * 60 + m;
  if (total >= 330 && total < 1110) return 'day';
  if (total >= 1110 && total < 1350) return 'peak';
  return 'off_peak';
}

export const timePeriodLabels = {
  day: 'Day (05:30–18:30)',
  peak: 'Peak (18:30–22:30)',
  off_peak: 'Off-Peak (22:30–05:30)',
};

export const timePeriodColors = {
  day: '#22c55e',
  peak: '#f59e0b',
  off_peak: '#3b82f6',
};
