export const fmt = {
  voltage: (v) => v != null ? `${parseFloat(v).toFixed(1)} V` : '—',
  current: (v) => v != null ? `${parseFloat(v).toFixed(1)} A` : '—',
  power: (v) => v != null ? `${parseFloat(v).toFixed(2)} kW` : '—',
  kva: (v) => v != null ? `${parseFloat(v).toFixed(2)} kVA` : '—',
  pf: (v) => v != null ? parseFloat(v).toFixed(3) : '—',
  kwh: (v) => v != null ? `${parseFloat(v).toFixed(2)} kWh` : '—',
  liters: (v) => v != null ? `${parseFloat(v).toFixed(2)} L` : '—',
  frequency: (v) => v != null ? `${parseFloat(v).toFixed(2)} Hz` : '—',
  percent: (v) => v != null ? `${parseFloat(v).toFixed(1)}%` : '—',
  number2: (v) => v != null ? parseFloat(v).toFixed(2) : '—',
  datetime: (v) => v ? new Date(v).toLocaleString() : '—',
  date: (v) => v ? new Date(v).toLocaleDateString() : '—',
  duration: (mins) => {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
};

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
