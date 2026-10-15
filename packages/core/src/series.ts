import type { Goal, Sample } from '@panodash/widget-sdk';
import { ymdLocal } from './dates';

export interface Point {
  t: number;
  value: number;
}

/**
 * Reduce a sample list to at most `n` points for a sparkline: equal time
 * buckets across the span, last value per bucket, empty buckets skipped.
 * Samples must be oldest-first.
 */
export function bucketSamples(samples: Sample[], n = 12): Point[] {
  if (samples.length === 0) return [];
  if (samples.length <= n) return samples.map((s) => ({ t: s.t, value: s.value }));
  const start = samples[0].t;
  const end = samples[samples.length - 1].t;
  const span = Math.max(1, end - start);
  const buckets = new Array<Point | undefined>(n);
  for (const s of samples) {
    const i = Math.min(n - 1, Math.floor(((s.t - start) / span) * n));
    buckets[i] = { t: s.t, value: s.value };
  }
  return buckets.filter((b): b is Point => b !== undefined);
}

/** Clean y-axis ticks: a 1/2/5×10^k step covering [min, max] with ~count lines. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    if (min === 0) return [0, 1];
    min = min > 0 ? 0 : min * 2;
    max = max > 0 ? max * 1.0000001 : 0;
  }
  const span = max - min;
  const rawStep = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 7 ? 10 : norm >= 3 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const ticks: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let v = first; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

/**
 * Consecutive days meeting the goal, counting back from today. Today is
 * treated as pending: meeting the goal extends the streak, but a shortfall
 * so far today (steps still accumulating, say) doesn't break it. Days are
 * aggregated to their best value for the goal's direction — max for
 * at-least goals, min for at-most.
 */
export function computeStreak(samples: Sample[], goal: Goal, now = Date.now()): number {
  if (samples.length === 0) return 0;
  const atMost = goal.direction === 'at-most';
  const byDay = new Map<string, number>();
  for (const s of samples) {
    const day = ymdLocal(new Date(s.t));
    const prev = byDay.get(day);
    byDay.set(
      day,
      prev === undefined ? s.value : atMost ? Math.min(prev, s.value) : Math.max(prev, s.value),
    );
  }
  const meets = (v: number) => (atMost ? v <= goal.value : v >= goal.value);

  let streak = 0;
  const d = new Date(now);
  const today = byDay.get(ymdLocal(d));
  if (today !== undefined && meets(today)) streak++;
  d.setDate(d.getDate() - 1);
  for (;;) {
    const v = byDay.get(ymdLocal(d));
    if (v === undefined || !meets(v)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/**
 * Latest value compared against the sample nearest to `lookbackMs` ago
 * (default 24h). Falls back to the previous sample for sparse series.
 */
export function computeDelta(
  samples: Sample[],
  lookbackMs = 24 * 60 * 60 * 1000,
): { delta: number; since: number } | null {
  if (samples.length < 2) return null;
  const latest = samples[samples.length - 1];
  const target = latest.t - lookbackMs;
  let ref = samples[0];
  for (const s of samples) {
    if (s.t > latest.t - 1) break;
    if (Math.abs(s.t - target) <= Math.abs(ref.t - target)) ref = s;
  }
  if (ref.t >= latest.t) ref = samples[samples.length - 2];
  return { delta: latest.value - ref.value, since: ref.t };
}
