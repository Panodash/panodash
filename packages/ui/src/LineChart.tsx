import { useEffect, useMemo, useRef, useState } from 'react';
import type { Goal, Sample } from '@panodash/widget-sdk';
import { niceTicks } from '@panodash/core/series';
import { formatValue, withUnit } from '@panodash/core/format';

const HEIGHT = 260;
const PAD = { top: 16, right: 20, bottom: 28, left: 8 };

/**
 * Single-series history chart: 2px line, 10% area wash, hairline gridlines,
 * end dot with a surface ring. Hover (or arrow keys on focus) drives a
 * crosshair that snaps to the nearest sample and a tooltip with the value
 * leading and the time secondary. One series, so no legend — the dialog
 * title names it.
 */
export function LineChart({
  samples,
  unit,
  goal,
}: {
  samples: Sample[];
  unit?: string;
  goal?: Goal;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plot = useMemo(() => {
    if (samples.length === 0) return null;
    const values = samples.map((s) => s.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (goal) {
      min = Math.min(min, goal.value);
      max = Math.max(max, goal.value);
    }
    if (min === max) {
      min -= Math.abs(min) * 0.1 || 1;
      max += Math.abs(max) * 0.1 || 1;
    }
    const t0 = samples[0].t;
    const t1 = samples[samples.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const ticks = niceTicks(min, max, 4);
    // Reserve left gutter for the widest tick label (~8px per char).
    const gutter = Math.max(...ticks.map((v) => formatValue(v).length), 2) * 8 + 12;
    const x = (t: number) =>
      PAD.left + gutter + ((t - t0) / span) * (width - PAD.left - gutter - PAD.right);
    const y = (v: number) =>
      PAD.top + (1 - (v - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom);
    return { min, max, t0, t1, ticks, gutter, x, y };
  }, [samples, width, goal]);

  if (!plot || samples.length === 0) return null;
  const { ticks, x, y, t0, t1 } = plot;

  const linePath = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.t).toFixed(1)},${y(s.value).toFixed(1)}`)
    .join(' ');
  const baselineY = HEIGHT - PAD.bottom;
  const areaPath =
    samples.length > 1
      ? `${linePath} L${x(t1).toFixed(1)},${baselineY} L${x(t0).toFixed(1)},${baselineY} Z`
      : '';

  const timeTicks = makeTimeTicks(t0, t1);

  function nearestIndex(clientX: number): number {
    const rect = containerRef.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    samples.forEach((s, i) => {
      const d = Math.abs(x(s.t) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  const hovered = hoverIndex !== null ? samples[hoverIndex] : null;
  const last = samples[samples.length - 1];
  const tooltipLeft = hovered ? Math.min(Math.max(x(hovered.t) + 12, plot.gutter), width - 150) : 0;

  return (
    <div
      className="line-chart"
      ref={containerRef}
      role="img"
      aria-label={`History chart, ${samples.length} points from ${new Date(t0).toLocaleDateString()} to ${new Date(t1).toLocaleDateString()}`}
      tabIndex={0}
      onPointerMove={(e) => setHoverIndex(nearestIndex(e.clientX))}
      onPointerLeave={() => setHoverIndex(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          setHoverIndex((i) => Math.min(samples.length - 1, (i ?? samples.length - 1) + 1));
          e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
          setHoverIndex((i) => Math.max(0, (i ?? samples.length) - 1));
          e.preventDefault();
        } else if (e.key === 'Escape') {
          setHoverIndex(null);
        }
      }}
    >
      <svg width={width} height={HEIGHT}>
        {/* hairline gridlines + clean tick labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line
              className="grid-line"
              x1={PAD.left + plot.gutter}
              x2={width - PAD.right}
              y1={y(v)}
              y2={y(v)}
            />
            <text className="tick-label" x={PAD.left + plot.gutter - 8} y={y(v) + 4} textAnchor="end">
              {formatValue(v)}
            </text>
          </g>
        ))}
        <line
          className="axis-line"
          x1={PAD.left + plot.gutter}
          x2={width - PAD.right}
          y1={baselineY}
          y2={baselineY}
        />
        {timeTicks.map((tick) => (
          <text
            key={tick.t}
            className="tick-label"
            x={x(tick.t)}
            y={HEIGHT - 8}
            textAnchor="middle"
          >
            {tick.label}
          </text>
        ))}

        {goal && (
          <g>
            <line
              className="goal-line"
              x1={PAD.left + plot.gutter}
              x2={width - PAD.right}
              y1={y(goal.value)}
              y2={y(goal.value)}
            />
            <text
              className="tick-label goal-label"
              x={width - PAD.right}
              y={y(goal.value) - 5}
              textAnchor="end"
            >
              Goal {formatValue(goal.value)}
            </text>
          </g>
        )}

        {areaPath && <path className="chart-area" d={areaPath} />}
        <path className="chart-line" d={linePath} />

        {/* end dot: surface ring keeps it legible on the line */}
        <circle className="dot-ring" cx={x(last.t)} cy={y(last.value)} r={6} />
        <circle className="chart-dot" cx={x(last.t)} cy={y(last.value)} r={4} />

        {hovered && (
          <g>
            <line
              className="crosshair"
              x1={x(hovered.t)}
              x2={x(hovered.t)}
              y1={PAD.top}
              y2={baselineY}
            />
            <circle className="dot-ring" cx={x(hovered.t)} cy={y(hovered.value)} r={6} />
            <circle className="chart-dot" cx={x(hovered.t)} cy={y(hovered.value)} r={4} />
          </g>
        )}
      </svg>
      {hovered && (
        <div className="chart-tooltip" style={{ left: tooltipLeft, top: y(hovered.value) - 8 }}>
          <span className="tooltip-key" aria-hidden="true" />
          <span className="tooltip-value">{withUnit(formatValue(hovered.value), unit)}</span>
          <span className="tooltip-time">{new Date(hovered.t).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

function makeTimeTicks(t0: number, t1: number): { t: number; label: string }[] {
  const span = t1 - t0;
  const count = 4;
  const ticks: { t: number; label: string }[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i <= count; i++) {
    const t = t0 + (span * i) / count;
    const d = new Date(t);
    const label =
      span <= 2 * dayMs
        ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    ticks.push({ t, label });
  }
  return ticks;
}
