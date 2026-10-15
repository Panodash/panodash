import type { Direction, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { addDays, ymdLocal } from '@panodash/core/dates';
import { StatTile } from '@panodash/ui/StatTile';

/**
 * Oura metrics via a personal access token (cloud.ouraring.com → Personal
 * Access Tokens) — Oura's PATs make this the friction-free health source:
 * paste one token, no OAuth app registration.
 */
type OuraMetric = 'hrv' | 'steps' | 'readiness' | 'sleepScore';

interface OuraConfig {
  token: string;
  metric: OuraMetric;
  pollMinutes: number;
}

export const OURA_METRICS: Record<
  OuraMetric,
  { label: string; path: string; field: string; unit?: string; direction: Direction }
> = {
  hrv: { label: 'HRV (sleep avg)', path: 'sleep', field: 'average_hrv', unit: 'ms', direction: 'up-good' },
  steps: { label: 'Steps today', path: 'daily_activity', field: 'steps', direction: 'up-good' },
  readiness: { label: 'Readiness score', path: 'daily_readiness', field: 'score', direction: 'up-good' },
  sleepScore: { label: 'Sleep score', path: 'daily_sleep', field: 'score', direction: 'up-good' },
};

/** Latest non-null value of `field` from a day-keyed Oura collection. */
export function latestOuraValue(
  data: Array<Record<string, unknown>>,
  field: string,
): number | undefined {
  const rows = [...data].sort((a, b) => String(a.day ?? '').localeCompare(String(b.day ?? '')));
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

async function fetchOura(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as OuraConfig;
  const spec = OURA_METRICS[config.metric] ?? OURA_METRICS.hrv;
  const params = new URLSearchParams({
    start_date: ymdLocal(addDays(new Date(), -7)),
    end_date: ymdLocal(),
  });
  const res = await fetch(`https://api.ouraring.com/v2/usercollection/${spec.path}?${params}`, {
    headers: { Authorization: `Bearer ${config.token.trim()}` },
  });
  if (res.status === 401 || res.status === 403) {
    return { fetchedAt: Date.now(), error: 'Oura rejected the token — check it in the widget settings', errorCode: 'http' };
  }
  if (!res.ok) return { fetchedAt: Date.now(), error: `Oura HTTP ${res.status}`, errorCode: 'http' };
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const value = latestOuraValue(json.data ?? [], spec.field);
  if (value === undefined) {
    return { fetchedAt: Date.now(), error: 'No data in the last 7 days — has the ring synced?', errorCode: 'parse' };
  }
  return { fetchedAt: Date.now(), value };
}

function OuraWidget({ instance, snapshot, samples }: WidgetComponentProps) {
  const config = instance.config as unknown as OuraConfig;
  const spec = OURA_METRICS[config.metric] ?? OURA_METRICS.hrv;
  return (
    <StatTile
      value={snapshot?.value}
      unit={spec.unit}
      direction={spec.direction}
      samples={samples}
      goal={instance.goal}
    />
  );
}

export const ouraProvider: WidgetProvider = {
  type: 'oura',
  name: 'Oura',
  description: 'HRV, steps, readiness, or sleep score from your Oura ring.',
  icon: '💍',
  kind: 'metric',
  auth: 'local-token',
  defaultSize: { w: 1, h: 1 },
  setupNote:
    'Create a personal access token at cloud.ouraring.com → Personal Access Tokens. It is stored locally and only ever sent to api.ouraring.com.',
  configFields: [
    { key: 'token', label: 'Personal access token', type: 'password', required: true },
    {
      key: 'metric',
      label: 'Metric',
      type: 'select',
      options: (Object.keys(OURA_METRICS) as OuraMetric[]).map((k) => ({
        value: k,
        label: OURA_METRICS[k].label,
      })),
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { token: '', metric: 'hrv', pollMinutes: 60 },
  defaultTitle: (config) => `Oura ${OURA_METRICS[(config.metric as OuraMetric) ?? 'hrv']?.label ?? ''}`.trim(),
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 60),
  permissionOrigins: () => ['https://api.ouraring.com/*'],
  fetchSnapshot: fetchOura,
  component: OuraWidget,
};
