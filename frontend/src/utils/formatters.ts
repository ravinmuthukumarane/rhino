export const fmt = {
  v:  (v: any) => v != null ? `${parseFloat(v).toFixed(1)} V`   : '—',
  a:  (v: any) => v != null ? `${parseFloat(v).toFixed(1)} A`   : '—',
  kw: (v: any) => v != null ? `${parseFloat(v).toFixed(2)} kW`  : '—',
  kva:(v: any) => v != null ? `${parseFloat(v).toFixed(2)} kVA` : '—',
  pf: (v: any) => v != null ? parseFloat(v).toFixed(3)          : '—',
  kwh:(v: any) => v != null ? `${parseFloat(v).toFixed(2)} kWh` : '—',
  lit:(v: any) => v != null ? `${parseFloat(v).toFixed(2)} L`   : '—',
  hz: (v: any) => v != null ? `${parseFloat(v).toFixed(2)} Hz`  : '—',
  pct:(v: any) => v != null ? `${parseFloat(v).toFixed(1)}%`    : '—',
  n2: (v: any) => v != null ? parseFloat(v).toFixed(2)          : '—',
  datetime: (v: any) => v ? new Date(v).toLocaleString() : '—',
  date:     (v: any) => v ? new Date(v).toLocaleDateString() : '—',
  duration: (mins: any): string => {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
};
