import { useMemo } from 'react';
import type { Sample } from '@panodash/widget-sdk';
import { bucketSamples } from '@panodash/core/series';

/**
 * 12-point stat-tile sparkline: 2px line in the de-emphasis hue, the current
 * period in the accent and marks "now" with the signal color. The SVG stretches to the
 * tile; non-scaling strokes keep the marks crisp, and the end dot is a
 * zero-length round-capped segment so it stays circular under stretch.
 */
export function Sparkline({ samples, height = 36 }: { samples: Sample[]; height?: number }) {
  const points = useMemo(() => bucketSamples(samples, 12), [samples]);
  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 100;
  const H = height;
  const padY = 5;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - padY - ((v - min) / span) * (H - padY * 2);
  const coords = points.map((p, i) => [x(i), y(p.value)] as const);
  const dimPath = coords
    .slice(0, -1)
    .map(([cx, cy], i) => `${i === 0 ? 'M' : 'L'}${cx.toFixed(2)},${cy.toFixed(2)}`)
    .join(' ');
  const [lx, ly] = coords[coords.length - 1];
  const [px, py] = coords[coords.length - 2];
  const accentPath = `M${px.toFixed(2)},${py.toFixed(2)} L${lx.toFixed(2)},${ly.toFixed(2)}`;
  const dot = `M${lx.toFixed(2)},${ly.toFixed(2)} L${lx.toFixed(2)},${ly.toFixed(2)}`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      height={H}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={dimPath + ` L${lx.toFixed(2)},${ly.toFixed(2)}`} className="spark-dim" />
      <path d={accentPath} className="spark-accent" />
      <path d={dot} className="spark-ring" />
      <path d={dot} className="spark-dot" />
    </svg>
  );
}
