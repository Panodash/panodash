import type { Direction, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { extractPath, toNumber } from '@panodash/core/jsonpath';
import { StatTile } from '@panodash/ui/StatTile';

/**
 * The extensibility workhorse: point it at any JSON endpoint, pick the value
 * out with a dot path, and Panodash turns it into a tracked metric. Anything
 * with an API becomes a widget with zero code.
 */
interface RestConfig {
  label: string;
  url: string;
  method: 'GET' | 'POST';
  headers: string;
  body: string;
  valuePath: string;
  unit: string;
  decimals: number;
  direction: Direction;
  pollMinutes: number;
}

export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

async function fetchRest(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as RestConfig;
  const res = await fetch(config.url, {
    method: config.method || 'GET',
    headers: parseHeaderLines(config.headers || ''),
    body: config.method === 'POST' && config.body ? config.body : undefined,
  });
  if (!res.ok) {
    return { fetchedAt: Date.now(), error: `HTTP ${res.status}`, errorCode: 'http' };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { fetchedAt: Date.now(), error: 'Response is not JSON', errorCode: 'parse' };
  }
  const raw = extractPath(data, config.valuePath || '');
  const value = toNumber(raw);
  if (value !== undefined) return { fetchedAt: Date.now(), value };
  if (raw === undefined) {
    return {
      fetchedAt: Date.now(),
      error: `Nothing at path '${config.valuePath}'`,
      errorCode: 'parse',
    };
  }
  const display = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return { fetchedAt: Date.now(), display: display.slice(0, 60) };
}

function RestWidget({ instance, snapshot, samples }: WidgetComponentProps) {
  const config = instance.config as unknown as RestConfig;
  return (
    <StatTile
      value={snapshot?.value}
      display={snapshot?.display}
      unit={config.unit || undefined}
      decimals={config.decimals}
      direction={config.direction}
      samples={samples}
      goal={instance.goal}
    />
  );
}

export const restApiProvider: WidgetProvider = {
  type: 'rest-api',
  name: 'REST API metric',
  description: 'Track a number from any JSON API — followers, stars, prices, anything.',
  icon: '🔌',
  kind: 'metric',
  auth: 'local-token',
  defaultSize: { w: 1, h: 1 },
  configFields: [
    { key: 'label', label: 'Metric name', type: 'text', required: true, placeholder: 'GitHub stars' },
    { key: 'url', label: 'Request URL', type: 'url', required: true, placeholder: 'https://api.example.com/stats' },
    {
      key: 'valuePath',
      label: 'Value path',
      type: 'text',
      placeholder: 'data.followers_count',
      help: 'Dot path to the number inside the JSON response. Leave empty if the response is the number itself.',
    },
    {
      key: 'headers',
      label: 'Headers',
      type: 'textarea',
      sensitive: true,
      placeholder: 'Authorization: Bearer YOUR_TOKEN',
      help: 'One "Name: value" per line. Stored locally, never synced or shared.',
    },
    {
      key: 'method',
      label: 'Method',
      type: 'select',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
      ],
    },
    { key: 'body', label: 'Request body (POST)', type: 'textarea', placeholder: '{"query": "…"}' },
    { key: 'unit', label: 'Unit', type: 'text', placeholder: '$, followers…' },
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
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: {
    label: '',
    url: '',
    method: 'GET',
    headers: '',
    body: '',
    valuePath: '',
    unit: '',
    decimals: 0,
    direction: 'up-good',
    pollMinutes: 30,
  },
  presets: [
    {
      label: 'GitHub followers',
      config: {
        label: 'GitHub followers',
        url: 'https://api.github.com/users/USERNAME',
        valuePath: 'followers',
        pollMinutes: 60,
      },
    },
    {
      label: 'X followers (needs paid API key)',
      config: {
        label: 'X followers',
        url: 'https://api.x.com/2/users/by/username/USERNAME?user.fields=public_metrics',
        valuePath: 'data.public_metrics.followers_count',
        headers: 'Authorization: Bearer YOUR_TOKEN',
        pollMinutes: 60,
      },
    },
    {
      label: 'Bitcoin price (no key needed)',
      config: {
        label: 'Bitcoin',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
        valuePath: 'bitcoin.usd',
        unit: '$',
        direction: 'neutral',
        pollMinutes: 30,
      },
    },
  ],
  defaultTitle: (config) => (config.label as string) || 'API metric',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 30),
  permissionOrigins: (config) => {
    try {
      const url = new URL(String(config.url));
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
      return [`${url.origin}/*`];
    } catch {
      return [];
    }
  },
  fetchSnapshot: fetchRest,
  component: RestWidget,
};
