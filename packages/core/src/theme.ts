import type { BrandColors, ThemeMode } from '@panodash/widget-sdk';

export const DEFAULT_BRAND_COLORS: BrandColors = {
  ink950: '#060906',
  ink900: '#0A0F0B',
  ink800: '#0E1510',
  ink700: '#142017',
  ink600: '#1C2B1F',
  ink500: '#2A4030',
  mist400: '#5F7A66',
  mist300: '#8FA894',
  mist200: '#C2D4C6',
  mist100: '#EAFBEA',
  signal500: '#37FF8B',
  signal600: '#23D96F',
  signal700: '#149E4E',
  alert500: '#FF5D5D',
  amber500: '#FFC53D',
  cyan500: '#4DD8E6',
  violet500: '#A78BFA',
};

/** Brand primitives are set separately from semantic UI tokens so CSS can
 * react to light, dark, and system theme changes without JavaScript color math. */
export function applyColors(colors: BrandColors): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(colors)) {
    root.style.setProperty(`--brand-${name.replace(/(\d+)/, '-$1')}`, value);
  }
}

function channels(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** color-mix(in srgb, a WEIGHT%, b) — plain per-channel interpolation. */
export function mixSrgb(a: string, b: string, weightA: number): string {
  const [ca, cb] = [channels(a), channels(b)];
  return (
    '#' +
    ca
      .map((v, i) => Math.round(v * weightA + cb[i] * (1 - weightA)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** WCAG 2.x contrast ratio between two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = channels(hex)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastCheck {
  label: string;
  mode: 'light' | 'dark';
  ratio: number;
  /** 3:1 for chart marks / large UI, 4.5:1 for text. */
  target: number;
  pass: boolean;
}

/** Audit a candidate palette against the semantic product tokens. */
export function auditBrandColors(colors: BrandColors): ContrastCheck[] {
  const {
    ink950, ink900, ink800, ink500, mist400, mist300, mist100,
    signal500, signal700, alert500,
  } = colors;
  const alertLight = mixSrgb(alert500, ink950, 0.7);
  const check = (
    label: string,
    mode: 'light' | 'dark',
    fg: string,
    bg: string,
    target: number,
  ): ContrastCheck => {
    const ratio = contrastRatio(fg, bg);
    return { label, mode, ratio, target, pass: ratio >= target };
  };

  return [
    check('Body text', 'light', ink900, mist100, 4.5),
    check('Signal marks', 'light', signal700, mist100, 3),
    check('Signal labels', 'light', ink950, signal700, 4.5),
    check('Alert marks', 'light', alertLight, mist100, 3),
    check('Muted labels', 'light', ink500, mist100, 4.5),
    check('Body text', 'dark', mist100, ink800, 4.5),
    check('Signal marks', 'dark', signal500, ink800, 3),
    check('Alert marks', 'dark', alert500, ink800, 3),
    check('Secondary labels', 'dark', mist300, ink800, 4.5),
    check('Muted labels', 'dark', mist400, ink950, 3),
  ];
}

/** Theme is applied as a data attribute on <html>; system leaves it unset. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  const order: ThemeMode[] = ['system', 'light', 'dark'];
  return order[(order.indexOf(mode) + 1) % order.length];
}

export function themeLabel(mode: ThemeMode): string {
  return mode === 'system' ? 'Theme: system' : mode === 'light' ? 'Theme: light' : 'Theme: dark';
}
