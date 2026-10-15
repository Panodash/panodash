import type {
  Direction,
  Sample,
  Snapshot,
  WidgetComponentProps,
  WidgetProvider,
} from '@panodash/widget-sdk';
import { getSettings, getSnapshot } from '@panodash/core/storage';
import { getSamples } from '@panodash/core/history';
import { computeDelta } from '@panodash/core/series';
import { StatTile } from '@panodash/ui/StatTile';

/**
 * A metric derived from other widgets' series — combine sources (net
 * followers across accounts, income minus spend) or transform one (today's
 * change, 7-day average). The result is recorded to history like any other
 * metric, so computed series chart and streak just like raw ones.
 */
export type ComputedOp = 'sum' | 'difference' | 'ratio' | 'daily-change' | 'weekly-average';

interface ComputedConfig {
  label: string;
  operation: ComputedOp;
  sourceA: string;
  sourceB: string;
  unit: string;
  decimals: number;
  direction: Direction;
  pollMinutes: number;
}

export const OPS: Record<ComputedOp, { label: string; twoSources: boolean }> = {
  sum: { label: 'A + B', twoSources: true },
  difference: { label: 'A − B', twoSources: true },
  ratio: { label: 'A ÷ B', twoSources: true },
  'daily-change': { label: 'Change in A over 24h', twoSources: false },
  'weekly-average': { label: '7-day average of A', twoSources: false },
};

export interface SourceSeries {
  latest?: number;
  samples: Sample[];
}

export function computeOperation(
  op: ComputedOp,
  a: SourceSeries,
  b?: SourceSeries,
): number | undefined {
  const av = a.latest ?? a.samples[a.samples.length - 1]?.value;
  const bv = b ? (b.latest ?? b.samples[b.samples.length - 1]?.value) : undefined;
  switch (op) {
    case 'sum':
      return av !== undefined && bv !== undefined ? av + bv : undefined;
    case 'difference':
      return av !== undefined && bv !== undefined ? av - bv : undefined;
    case 'ratio':
      return av !== undefined && bv !== undefined && bv !== 0 ? av / bv : undefined;
    case 'daily-change':
      return computeDelta(a.samples)?.delta;
    case 'weekly-average': {
      if (a.samples.length === 0) return undefined;
      const end = a.samples[a.samples.length - 1].t;
      // Strict bound: daily samples yield exactly 7 points, not 8.
      const window = a.samples.filter((s) => s.t > end - 7 * 24 * 60 * 60 * 1000);
      return window.reduce((sum, s) => sum + s.value, 0) / window.length;
    }
  }
}

async function loadSource(widgetId: string): Promise<SourceSeries> {
  const [snap, samples] = await Promise.all([
    getSnapshot(widgetId),
    getSamples(widgetId, Date.now() - 30 * 24 * 60 * 60 * 1000),
  ]);
  return { latest: typeof snap?.value === 'number' ? snap.value : undefined, samples };
}

async function fetchComputed(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as ComputedConfig;
  const op = OPS[config.operation] ? config.operation : 'difference';
  const settings = await getSettings();
  const exists = (id: string) => settings.widgets.some((w) => w.id === id);

  if (!config.sourceA) {
    return { fetchedAt: Date.now(), error: 'Pick a source widget in the settings', errorCode: 'parse' };
  }
  if (!exists(config.sourceA) || (OPS[op].twoSources && config.sourceB && !exists(config.sourceB))) {
    return { fetchedAt: Date.now(), error: 'A source widget was removed', errorCode: 'parse' };
  }
  if (OPS[op].twoSources && !config.sourceB) {
    return { fetchedAt: Date.now(), error: 'This operation needs a second source widget', errorCode: 'parse' };
  }

  const a = await loadSource(config.sourceA);
  const b = OPS[op].twoSources ? await loadSource(config.sourceB) : undefined;
  const value = computeOperation(op, a, b);
  if (value === undefined || !Number.isFinite(value)) {
    return { fetchedAt: Date.now(), error: 'Sources have no data yet (or division by zero)', errorCode: 'parse' };
  }
  return { fetchedAt: Date.now(), value };
}

function ComputedWidget({ instance, snapshot, samples }: WidgetComponentProps) {
  const config = instance.config as unknown as ComputedConfig;
  return (
    <StatTile
      value={snapshot?.value}
      unit={config.unit || undefined}
      decimals={config.decimals}
      direction={config.direction}
      samples={samples}
      goal={instance.goal}
    />
  );
}

export const computedProvider: WidgetProvider = {
  type: 'computed',
  name: 'Computed metric',
  description: 'Combine or transform other widgets: sums, differences, ratios, rates.',
  icon: '🧮',
  kind: 'metric',
  auth: 'none',
  defaultSize: { w: 1, h: 1 },
  configFields: [
    { key: 'label', label: 'Metric name', type: 'text', required: true, placeholder: 'Net followers' },
    {
      key: 'operation',
      label: 'Operation',
      type: 'select',
      options: (Object.keys(OPS) as ComputedOp[]).map((k) => ({ value: k, label: OPS[k].label })),
    },
    { key: 'sourceA', label: 'Source A', type: 'widget', required: true },
    { key: 'sourceB', label: 'Source B (for two-source operations)', type: 'widget' },
    { key: 'unit', label: 'Unit', type: 'text' },
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
    { key: 'pollMinutes', label: 'Recompute every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: {
    label: '',
    operation: 'difference',
    sourceA: '',
    sourceB: '',
    unit: '',
    decimals: 0,
    direction: 'up-good',
    pollMinutes: 15,
  },
  defaultTitle: (config) => (config.label as string) || 'Computed metric',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 15),
  fetchSnapshot: fetchComputed,
  component: ComputedWidget,
};
