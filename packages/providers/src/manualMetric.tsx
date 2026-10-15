import { useState } from 'react';
import type { Direction, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { StatTile } from '@panodash/ui/StatTile';

interface ManualConfig {
  unit: string;
  decimals: number;
  direction: Direction;
}

/**
 * Log any number by hand — HRV, weight, pages read, mood on a 1–10 scale.
 * The quick-entry field appends straight to local history.
 */
function ManualMetricWidget({ instance, samples, recordValue }: WidgetComponentProps) {
  const config = instance.config as unknown as ManualConfig;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const latest = samples.length > 0 ? samples[samples.length - 1] : undefined;

  async function submit() {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n) || saving) return;
    setSaving(true);
    try {
      await recordValue(n);
      setDraft('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <StatTile
      value={latest?.value}
      unit={config.unit || undefined}
      decimals={config.decimals}
      direction={config.direction}
      samples={samples}
      goal={instance.goal}
      footer={
        <form
          className="manual-entry"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={draft}
            placeholder="Log a value"
            aria-label="Log a value"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" disabled={draft.trim() === '' || saving}>
            Log
          </button>
        </form>
      }
    />
  );
}

export const manualMetricProvider: WidgetProvider = {
  type: 'manual-metric',
  name: 'Manual metric',
  description: 'Track anything you can type: HRV, weight, pages read, mood.',
  icon: '✏️',
  kind: 'metric',
  auth: 'none',
  defaultSize: { w: 1, h: 1 },
  configFields: [
    { key: 'label', label: 'Metric name', type: 'text', required: true, placeholder: 'Heart rate variability' },
    { key: 'unit', label: 'Unit', type: 'text', placeholder: 'ms, kg, steps…' },
    { key: 'decimals', label: 'Decimal places', type: 'number', min: 0, max: 4, step: 1 },
    {
      key: 'direction',
      label: 'A rising number is…',
      type: 'select',
      options: [
        { value: 'up-good', label: 'Good news' },
        { value: 'down-good', label: 'Bad news' },
        { value: 'neutral', label: 'Neutral' },
      ],
    },
  ],
  defaultConfig: { label: '', unit: '', decimals: 0, direction: 'up-good' },
  defaultTitle: (config) => (config.label as string) || 'Manual metric',
  component: ManualMetricWidget,
};
