import { describe, expect, it } from 'vitest';
import { addDays, ymdLocal } from '@panodash/core/dates';
import { base64url, expiryFrom } from '@panodash/core/oauth';
import { describeWmo } from '@panodash/providers/weather';
import { latestOuraValue } from '@panodash/providers/oura';
import { latestWithingsKg } from '@panodash/providers/withings';

describe('dates', () => {
  it('formats local YYYY-MM-DD', () => {
    expect(ymdLocal(new Date(2026, 6, 15))).toBe('2026-07-15');
    expect(ymdLocal(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
  it('adds days across month boundaries', () => {
    expect(ymdLocal(addDays(new Date(2026, 6, 30), 3))).toBe('2026-08-02');
    expect(ymdLocal(addDays(new Date(2026, 6, 1), -1))).toBe('2026-06-30');
  });
});

describe('base64url', () => {
  it('is URL-safe and unpadded', () => {
    const out = base64url(new Uint8Array([251, 255, 190, 0, 1]));
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(out).not.toContain('=');
  });
  it('encodes a known vector', () => {
    // [72,101,108,108,111] = "Hello" → SGVsbG8
    expect(base64url(new Uint8Array([72, 101, 108, 108, 111]))).toBe('SGVsbG8');
  });
});

describe('expiryFrom', () => {
  it('converts seconds with a safety margin', () => {
    const before = Date.now();
    const at = expiryFrom(3600);
    expect(at).toBeGreaterThan(before + 3500 * 1000);
    expect(at).toBeLessThan(before + 3600 * 1000);
  });
  it('falls back to an hour for garbage input', () => {
    expect(expiryFrom(undefined)).toBeGreaterThan(Date.now());
  });
});

describe('describeWmo', () => {
  it('maps representative codes', () => {
    expect(describeWmo(0).label).toBe('Clear');
    expect(describeWmo(3).label).toBe('Overcast');
    expect(describeWmo(63).label).toBe('Rain');
    expect(describeWmo(75).label).toBe('Snow');
    expect(describeWmo(95).label).toBe('Thunderstorm');
  });
  it('falls back gracefully for unknown codes', () => {
    expect(describeWmo(42).label).toBe('Weather');
  });
});

describe('latestOuraValue', () => {
  it('takes the newest day with a non-null value', () => {
    const data = [
      { day: '2026-07-13', average_hrv: 52 },
      { day: '2026-07-15', average_hrv: null },
      { day: '2026-07-14', average_hrv: 61 },
    ];
    expect(latestOuraValue(data, 'average_hrv')).toBe(61);
  });
  it('returns undefined when nothing has a value', () => {
    expect(latestOuraValue([{ day: '2026-07-15', score: null }], 'score')).toBeUndefined();
    expect(latestOuraValue([], 'score')).toBeUndefined();
  });
});

describe('latestWithingsKg', () => {
  it('scales by the unit exponent and rounds to 0.1 kg', () => {
    const grps = [
      { measures: [{ type: 1, value: 78450, unit: -3 }] },
      { measures: [{ type: 1, value: 79000, unit: -3 }] },
    ];
    expect(latestWithingsKg(grps)).toBe(78.5); // newest-first: first group wins
  });
  it('skips groups without a weight measure', () => {
    const grps = [
      { measures: [{ type: 4, value: 180, unit: -2 }] },
      { measures: [{ type: 1, value: 805, unit: -1 }] },
    ];
    expect(latestWithingsKg(grps)).toBe(80.5);
  });
  it('returns undefined with no weight at all', () => {
    expect(latestWithingsKg([])).toBeUndefined();
  });
});
