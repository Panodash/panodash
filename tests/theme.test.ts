import { describe, expect, it } from 'vitest';
import {
  auditBrandColors,
  contrastRatio,
  DEFAULT_BRAND_COLORS,
  mixSrgb,
} from '@panodash/core/theme';

describe('mixSrgb', () => {
  it('interpolates per channel like color-mix(in srgb)', () => {
    expect(mixSrgb('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixSrgb('#ff0000', '#000000', 0.25)).toBe('#400000');
    expect(mixSrgb('#abc', '#abc', 0.5)).toBe('#aabbcc');
  });
});

describe('contrastRatio', () => {
  it('matches WCAG anchors', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 3);
  });
});

describe('auditBrandColors', () => {
  it('passes every check for the Signal v1 palette', () => {
    const checks = auditBrandColors(DEFAULT_BRAND_COLORS);
    expect(checks).toHaveLength(10);
    for (const check of checks) {
      expect(check.pass, `${check.mode} ${check.label} at ${check.ratio.toFixed(2)}:1`).toBe(true);
    }
  });

  it('flags a signal that disappears on the app background', () => {
    const checks = auditBrandColors({
      ...DEFAULT_BRAND_COLORS,
      signal500: DEFAULT_BRAND_COLORS.ink800,
    });
    const signal = checks.find((check) => check.mode === 'dark' && check.label === 'Signal marks');
    expect(signal?.pass).toBe(false);
  });

  it('flags muted copy that is too close to the dark canvas', () => {
    const checks = auditBrandColors({
      ...DEFAULT_BRAND_COLORS,
      mist400: DEFAULT_BRAND_COLORS.ink950,
    });
    const muted = checks.find((check) => check.mode === 'dark' && check.label === 'Muted labels');
    expect(muted?.pass).toBe(false);
  });
});
