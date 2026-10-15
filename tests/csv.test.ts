import { beforeAll, describe, expect, it } from 'vitest';
import { parseCsvSamples } from '@panodash/core/csv';
import { registerBuiltins } from '@panodash/providers';
import { allProviders } from '@panodash/widget-sdk/registry';

describe('parseCsvSamples', () => {
  it('parses the Panodash per-metric export format, skipping the header', () => {
    const csv = [
      'timestamp_ms,iso_time,value',
      '1752537600000,2026-07-15T00:00:00.000Z,8400',
      '1752624000000,2026-07-16T00:00:00.000Z,9100',
    ].join('\n');
    expect(parseCsvSamples(csv)).toEqual([
      { t: 1752537600000, value: 8400 },
      { t: 1752624000000, value: 9100 },
    ]);
  });

  it('parses generic time,value with ISO dates', () => {
    const csv = 'date,steps\n2026-07-14,7000\n2026-07-15T08:30:00Z,8000';
    const rows = parseCsvSamples(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe(7000);
    expect(rows[1].t).toBe(Date.parse('2026-07-15T08:30:00Z'));
  });

  it('treats 10-digit epochs as seconds and longer as milliseconds', () => {
    const rows = parseCsvSamples('1752537600,42\n1752537600000,43');
    expect(rows[0].t).toBe(1752537600000);
    expect(rows[1].t).toBe(1752537600000);
  });

  it('handles quoted cells and blank lines, and sorts oldest-first', () => {
    const csv = '\n"2026-07-15",  "12.5"\n\n"2026-07-13","11"\n';
    const rows = parseCsvSamples(csv);
    expect(rows.map((r) => r.value)).toEqual([11, 12.5]);
    expect(rows[0].t).toBeLessThan(rows[1].t);
  });

  it('skips rows without a parseable time or numeric value', () => {
    const csv = 'when,what\nyesterday,10\n2026-07-15,plenty\n2026-07-15,10';
    expect(parseCsvSamples(csv)).toHaveLength(1);
  });

  it('returns nothing for garbage', () => {
    expect(parseCsvSamples('')).toEqual([]);
    expect(parseCsvSamples('just some prose, without numbers')).toEqual([]);
  });
});

describe('provider auth declarations', () => {
  beforeAll(() => registerBuiltins());

  it('every registered provider declares a valid auth pattern', () => {
    const valid = new Set(['none', 'local-token', 'pkce', 'confidential']);
    const providers = allProviders();
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(valid.has(p.auth), `${p.type} declares auth`).toBe(true);
    }
  });

  it('credentialed providers declare the expected patterns', () => {
    const byType = Object.fromEntries(allProviders().map((p) => [p.type, p.auth]));
    expect(byType['oura']).toBe('local-token');
    expect(byType['fitbit']).toBe('pkce');
    expect(byType['withings']).toBe('confidential');
    expect(byType['whoop']).toBe('confidential');
    expect(byType['weather']).toBe('none');
    expect(byType['gitlab-stars']).toBe('none');
    expect(byType['gitlab-reviews']).toBe('local-token');
    expect(byType['gitlab-my-mrs']).toBe('local-token');
    expect(byType['gitlab-todos']).toBe('local-token');
  });
});
