import { describe, expect, it } from 'vitest';
import { formatDelta, formatValue, timeAgo, withUnit } from '@panodash/core/format';

describe('formatValue', () => {
  it('comma-groups small numbers', () => {
    expect(formatValue(1284)).toBe('1,284');
  });
  it('compacts from 10K up', () => {
    expect(formatValue(12900)).toBe('12.9K');
    expect(formatValue(4_200_000)).toBe('4.2M');
    expect(formatValue(2_000_000_000)).toBe('2B');
  });
  it('respects explicit decimals', () => {
    expect(formatValue(72.4567, 2)).toBe('72.46');
    expect(formatValue(72, 0)).toBe('72');
  });
  it('infers one decimal for small fractional values', () => {
    expect(formatValue(7.25)).toBe('7.3');
  });
});

describe('withUnit', () => {
  it('prefixes currency symbols', () => {
    expect(withUnit('42', '$')).toBe('$42');
  });
  it('suffixes other units', () => {
    expect(withUnit('42', 'ms')).toBe('42 ms');
  });
  it('passes through with no unit', () => {
    expect(withUnit('42')).toBe('42');
  });
});

describe('formatDelta', () => {
  it('signs deltas', () => {
    expect(formatDelta(12)).toBe('+12');
    expect(formatDelta(-3)).toBe('−3');
  });
});

describe('timeAgo', () => {
  const now = 1_000_000_000_000;
  it('rounds to friendly units', () => {
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});
