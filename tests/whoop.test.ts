import { describe, expect, it } from 'vitest';
import { pickWhoopValue, type WhoopRecord } from '@panodash/providers/whoop';

describe('pickWhoopValue', () => {
  it('takes the newest SCORED record (records arrive newest-first)', () => {
    const records: WhoopRecord[] = [
      { score_state: 'SCORED', score: { recovery_score: 67 } },
      { score_state: 'SCORED', score: { recovery_score: 81 } },
    ];
    expect(pickWhoopValue(records, 'recovery_score')).toBe(67);
  });

  it('skips PENDING_SCORE and UNSCORABLE records', () => {
    const records: WhoopRecord[] = [
      { score_state: 'PENDING_SCORE' },
      { score_state: 'UNSCORABLE', score: { recovery_score: 1 } },
      { score_state: 'SCORED', score: { recovery_score: 74 } },
    ];
    expect(pickWhoopValue(records, 'recovery_score')).toBe(74);
  });

  it('skips naps for sleep metrics', () => {
    const records: WhoopRecord[] = [
      { score_state: 'SCORED', nap: true, score: { sleep_performance_percentage: 45 } },
      { score_state: 'SCORED', nap: false, score: { sleep_performance_percentage: 88 } },
    ];
    expect(pickWhoopValue(records, 'sleep_performance_percentage')).toBe(88);
  });

  it('skips scored records missing the requested field', () => {
    const records: WhoopRecord[] = [
      { score_state: 'SCORED', score: { strain: 12.3 } },
      { score_state: 'SCORED', score: { recovery_score: 59, hrv_rmssd_milli: 48.2 } },
    ];
    expect(pickWhoopValue(records, 'hrv_rmssd_milli')).toBe(48.2);
  });

  it('returns undefined for empty or unusable collections', () => {
    expect(pickWhoopValue([], 'recovery_score')).toBeUndefined();
    expect(pickWhoopValue([{ score_state: 'PENDING_SCORE' }], 'recovery_score')).toBeUndefined();
  });
});
