import { useMemo, useState, type CSSProperties } from 'react';
import type { BrandColors } from '@panodash/widget-sdk';
import { auditBrandColors, DEFAULT_BRAND_COLORS } from '@panodash/core/theme';

type Field = { key: keyof BrandColors; label: string; role: string };

const FIELD_GROUPS: { label: string; fields: Field[] }[] = [
  {
    label: 'Ink',
    fields: [
      { key: 'ink950', label: 'Ink 950', role: 'App background' },
      { key: 'ink900', label: 'Ink 900', role: 'Page sections' },
      { key: 'ink800', label: 'Ink 800', role: 'Widget surface' },
      { key: 'ink700', label: 'Ink 700', role: 'Raised surface' },
      { key: 'ink600', label: 'Ink 600', role: 'Borders' },
      { key: 'ink500', label: 'Ink 500', role: 'Active borders' },
    ],
  },
  {
    label: 'Mist',
    fields: [
      { key: 'mist400', label: 'Mist 400', role: 'Muted text' },
      { key: 'mist300', label: 'Mist 300', role: 'Secondary text' },
      { key: 'mist200', label: 'Mist 200', role: 'Body text' },
      { key: 'mist100', label: 'Mist 100', role: 'Headlines & metrics' },
    ],
  },
  {
    label: 'Signal',
    fields: [
      { key: 'signal500', label: 'Signal 500', role: 'Primary accent' },
      { key: 'signal600', label: 'Signal 600', role: 'Hover' },
      { key: 'signal700', label: 'Signal 700', role: 'Pressed & light mode' },
    ],
  },
  {
    label: 'Data',
    fields: [
      { key: 'alert500', label: 'Alert 500', role: 'Down & error' },
      { key: 'amber500', label: 'Amber 500', role: 'Warning' },
      { key: 'cyan500', label: 'Cyan 500', role: 'Chart series 2' },
      { key: 'violet500', label: 'Violet 500', role: 'Chart series 3' },
    ],
  },
];

const FIELDS = FIELD_GROUPS.flatMap((group) => group.fields);
const HEX = /^#[0-9a-f]{6}$/i;

export function ColorDialog({
  current,
  onSave,
  onClose,
}: {
  current: BrandColors;
  onSave: (colors: BrandColors) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BrandColors>(current);
  const valid = FIELDS.every(({ key }) => HEX.test(draft[key]));
  const checks = useMemo(() => (valid ? auditBrandColors(draft) : null), [valid, draft]);
  const failures = checks?.filter((check) => !check.pass) ?? [];
  const previewStyle = {
    '--preview-ink': HEX.test(draft.ink950) ? draft.ink950 : current.ink950,
    '--preview-surface': HEX.test(draft.ink800) ? draft.ink800 : current.ink800,
    '--preview-mist': HEX.test(draft.mist100) ? draft.mist100 : current.mist100,
    '--preview-muted': HEX.test(draft.mist300) ? draft.mist300 : current.mist300,
    '--preview-signal': HEX.test(draft.signal500) ? draft.signal500 : current.signal500,
  } as CSSProperties;

  function update(key: keyof BrandColors, value: string) {
    setDraft((colors) => ({ ...colors, [key]: value.toUpperCase() }));
  }

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog color-dialog" role="dialog" aria-modal="true" aria-label="Color palette">
        <div className="dialog-header">
          <div>
            <h2>Signal palette</h2>
            <p className="dialog-subtitle">Tune the primitives that drive both light and dark mode.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="color-preview" style={previewStyle} aria-label="Palette preview">
          <div className="color-preview-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <rect className="preview-cursor" x="15" y="13" width="12" height="24" rx="1" />
              <rect className="preview-pixel" x="31" y="31" width="6" height="6" rx="1" />
            </svg>
          </div>
          <div className="color-preview-card">
            <span>TODAY'S SIGNAL</span>
            <strong>82%</strong>
            <i>+6 VS YESTERDAY</i>
          </div>
        </div>

        <div className="color-fields">
          {FIELD_GROUPS.map((group) => (
            <section className="color-group" key={group.label}>
              <h3>{group.label}</h3>
              <div className="color-group-fields">
                {group.fields.map(({ key, label, role }) => {
                  const pickerValue = HEX.test(draft[key]) ? draft[key] : current[key];
                  return (
                    <div className="color-field" key={key}>
                      <label htmlFor={`color-${key}`}>
                        <strong>{label}</strong>
                        <span>{role}</span>
                      </label>
                      <div className="color-controls">
                        <input
                          className="color-picker"
                          type="color"
                          value={pickerValue}
                          aria-label={`${label} color picker`}
                          onChange={(event) => update(key, event.target.value)}
                        />
                        <input
                          id={`color-${key}`}
                          className={HEX.test(draft[key]) ? 'color-hex' : 'color-hex invalid'}
                          type="text"
                          value={draft[key]}
                          maxLength={7}
                          spellCheck={false}
                          aria-invalid={!HEX.test(draft[key])}
                          onChange={(event) => update(key, event.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {checks && (
          <div className="contrast-audit" aria-live="polite">
            <div className="contrast-audit-head">
              <strong>Legibility check</strong>
              <span className={failures.length === 0 ? 'audit-ok' : 'audit-warn'}>
                {failures.length === 0
                  ? 'All contrast targets met'
                  : `${failures.length} combination${failures.length === 1 ? '' : 's'} below WCAG targets`}
              </span>
            </div>
            <ul className="contrast-audit-list">
              {checks.map((check) => (
                <li key={`${check.mode}-${check.label}`} className={check.pass ? 'pass' : 'fail'}>
                  <span className="audit-dot" aria-hidden="true" />
                  <span className="audit-label">{check.label} <em>{check.mode}</em></span>
                  <span className="audit-ratio">{check.ratio.toFixed(2)}:1 <em>/ {check.target}:1</em></span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="dialog-actions color-dialog-actions">
          <button type="button" className="button-ghost" onClick={() => setDraft(DEFAULT_BRAND_COLORS)}>Reset defaults</button>
          <span className="dialog-action-spacer" />
          <button type="button" className="button-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="button-primary"
            disabled={!valid}
            onClick={() => { onSave(draft); onClose(); }}
          >
            Save palette
          </button>
        </div>
      </div>
    </div>
  );
}
