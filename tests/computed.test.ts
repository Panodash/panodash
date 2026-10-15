import { describe, expect, it } from 'vitest';
import { computeOperation, type SourceSeries } from '@panodash/providers/computed';
import type { Sample } from '@panodash/widget-sdk';

const day = 24 * 60 * 60 * 1000;

function src(latest: number | undefined, values: number[] = [], stepMs = day): SourceSeries {
  const samples: Sample[] = values.map((value, i) => ({
    widgetId: 's',
    t: i * stepMs,
    value,
  }));
  return { latest, samples };
}

describe('computeOperation', () => {
  it('sums and differences two sources', () => {
    expect(computeOperation('sum', src(10), src(32))).toBe(42);
    expect(computeOperation('difference', src(10), src(32))).toBe(-22);
  });

  it('computes ratios and refuses division by zero', () => {
    expect(computeOperation('ratio', src(10), src(4))).toBe(2.5);
    expect(computeOperation('ratio', src(10), src(0))).toBeUndefined();
  });

  it('falls back to the last sample when a source has no snapshot', () => {
    expect(computeOperation('sum', src(undefined, [1, 7]), src(3))).toBe(10);
  });

  it('is undefined when a required source is empty', () => {
    expect(computeOperation('sum', src(undefined, []), src(3))).toBeUndefined();
    expect(computeOperation('difference', src(5))).toBeUndefined();
  });

  it('computes the 24h change from samples', () => {
    // one sample per day: 100, 110, 130 → change vs a day ago = 20
    expect(computeOperation('daily-change', src(999, [100, 110, 130]))).toBe(20);
  });

  it('averages the trailing 7 days', () => {
    // 10 daily samples 1..10; last 7 days of the window = 4..10
    const avg = computeOperation('weekly-average', src(undefined, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(avg).toBe((4 + 5 + 6 + 7 + 8 + 9 + 10) / 7);
  });
});
