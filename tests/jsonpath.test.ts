import { describe, expect, it } from 'vitest';
import { extractPath, toNumber } from '@panodash/core/jsonpath';

describe('extractPath', () => {
  const data = {
    data: {
      public_metrics: { followers_count: 1234 },
      items: [{ value: 7 }, { value: 9 }],
      'odd key': { nested: 'x' },
    },
    top: 5,
  };

  it('walks dot paths', () => {
    expect(extractPath(data, 'data.public_metrics.followers_count')).toBe(1234);
  });

  it('accepts an optional $ prefix', () => {
    expect(extractPath(data, '$.top')).toBe(5);
    expect(extractPath(data, '$.data.public_metrics.followers_count')).toBe(1234);
  });

  it('handles array indices', () => {
    expect(extractPath(data, 'data.items[1].value')).toBe(9);
  });

  it('handles quoted bracket keys', () => {
    expect(extractPath(data, 'data["odd key"].nested')).toBe('x');
  });

  it('reads array length as a plain property', () => {
    expect(extractPath(data, 'data.items.length')).toBe(2);
  });

  it('returns the whole document for an empty path', () => {
    expect(extractPath(42, '')).toBe(42);
  });

  it('returns undefined for a missing path', () => {
    expect(extractPath(data, 'data.nope.deeper')).toBeUndefined();
  });
});

describe('toNumber', () => {
  it('passes finite numbers through', () => {
    expect(toNumber(3.5)).toBe(3.5);
  });
  it('parses numeric strings, including comma-grouped', () => {
    expect(toNumber('1,234')).toBe(1234);
    expect(toNumber(' 12.5 ')).toBe(12.5);
  });
  it('rejects non-numeric values', () => {
    expect(toNumber('n/a')).toBeUndefined();
    expect(toNumber('')).toBeUndefined();
    expect(toNumber({})).toBeUndefined();
    expect(toNumber(NaN)).toBeUndefined();
  });
  it('maps booleans to 0/1', () => {
    expect(toNumber(true)).toBe(1);
  });
});
