import { describe, expect, it } from 'vitest';
import { bucketSamples, computeDelta, computeStreak, niceTicks } from '@panodash/core/series';
import type { Sample } from '@panodash/widget-sdk';

function mk(values: number[], stepMs = 60_000, start = 0): Sample[] {
  return values.map((value, i) => ({ widgetId: 'w', t: start + i * stepMs, value }));
}

describe('bucketSamples', () => {
  it('passes short series through', () => {
    const points = bucketSamples(mk([1, 2, 3]), 12);
    expect(points.map((p) => p.value)).toEqual([1, 2, 3]);
  });

  it('reduces long series to at most n points, keeping the last value per bucket', () => {
    const samples = mk(Array.from({ length: 100 }, (_, i) => i));
    const points = bucketSamples(samples, 12);
    expect(points.length).toBeLessThanOrEqual(12);
    expect(points[points.length - 1].value).toBe(99);
    const ts = points.map((p) => p.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('handles empty input', () => {
    expect(bucketSamples([], 12)).toEqual([]);
  });
});

describe('niceTicks', () => {
  it('produces clean 1/2/5 steps covering the range', () => {
    const ticks = niceTicks(0, 87, 4);
    expect(ticks).toEqual([0, 20, 40, 60, 80]);
  });
  it('handles a flat series', () => {
    const ticks = niceTicks(50, 50, 4);
    expect(ticks.length).toBeGreaterThan(1);
  });
});

describe('computeDelta', () => {
  it('needs at least two samples', () => {
    expect(computeDelta(mk([5]))).toBeNull();
  });

  it('compares against the sample nearest to the lookback', () => {
    const day = 24 * 60 * 60 * 1000;
    const samples: Sample[] = [
      { widgetId: 'w', t: 0, value: 100 },
      { widgetId: 'w', t: day, value: 110 },
      { widgetId: 'w', t: 2 * day, value: 130 },
    ];
    const delta = computeDelta(samples, day);
    expect(delta).not.toBeNull();
    expect(delta!.delta).toBe(20); // 130 vs the sample one day earlier (110)
    expect(delta!.since).toBe(day);
  });

  it('falls back to the previous sample for dense recent data', () => {
    const samples = mk([10, 12], 60_000);
    const delta = computeDelta(samples);
    expect(delta!.delta).toBe(2);
  });
});

describe('computeStreak', () => {
  const day = 24 * 60 * 60 * 1000;
  // Fixed "now": late evening, so day boundaries are unambiguous.
  const now = new Date(2026, 6, 15, 21, 0, 0).getTime();
  const goal = { value: 8000, direction: 'at-least' as const };

  function daily(values: number[], endOffsetDays = 0): Sample[] {
    // values[last] lands on `now - endOffsetDays` days, one sample per day
    return values.map((value, i) => ({
      widgetId: 'w',
      t: now - (values.length - 1 - i + endOffsetDays) * day,
      value,
    }));
  }

  it('counts consecutive met days ending today', () => {
    expect(computeStreak(daily([9000, 8500, 8200]), goal, now)).toBe(3);
  });

  it('stops at the first missed day', () => {
    expect(computeStreak(daily([9000, 4000, 8200, 8100]), goal, now)).toBe(2);
  });

  it('treats an unmet today as pending, not broken', () => {
    // today only has 3,000 so far — yesterday's streak of 2 survives
    expect(computeStreak(daily([8500, 9000, 3000]), goal, now)).toBe(2);
  });

  it('uses the day maximum for at-least goals', () => {
    // two samples today: mid-day 4,000 then 8,800 — day counts as met
    const samples = [
      ...daily([9000], 1),
      { widgetId: 'w', t: now - 3600_000, value: 4000 },
      { widgetId: 'w', t: now - 60_000, value: 8800 },
    ];
    expect(computeStreak(samples, goal, now)).toBe(2);
  });

  it('supports at-most goals with the day minimum', () => {
    const atMost = { value: 60, direction: 'at-most' as const };
    expect(computeStreak(daily([58, 59, 55]), atMost, now)).toBe(3);
    expect(computeStreak(daily([58, 65, 55]), atMost, now)).toBe(1);
  });

  it('is zero with no samples or no met days', () => {
    expect(computeStreak([], goal, now)).toBe(0);
    expect(computeStreak(daily([100, 200]), goal, now)).toBe(0);
  });
});
