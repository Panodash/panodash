/** Compact value formatting for stat tiles: 1,284 / 12.9K / 4.2M. */
export function formatValue(value: number, decimals?: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return trim(value / 1_000_000_000) + 'B';
  if (abs >= 1_000_000) return trim(value / 1_000_000) + 'M';
  if (abs >= 10_000) return trim(value / 1_000) + 'K';
  const d = decimals ?? inferDecimals(value);
  return value.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function trim(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function inferDecimals(value: number): number {
  if (Number.isInteger(value)) return 0;
  return Math.abs(value) < 10 ? 1 : 0;
}

/** "$" and "€" read as prefixes; everything else as a suffix ("ms", "steps"). */
export function withUnit(display: string, unit?: string): string {
  if (!unit) return display;
  if (/^[$€£¥]$/.test(unit)) return unit + display;
  return `${display} ${unit}`;
}

export function formatDelta(delta: number, decimals?: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return sign + formatValue(Math.abs(delta), decimals);
}

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const min = Math.round(s / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
