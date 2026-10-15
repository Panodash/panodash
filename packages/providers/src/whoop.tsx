import type {
  Direction,
  FetchContext,
  Snapshot,
  WidgetComponentProps,
  WidgetInstance,
  WidgetProvider,
} from '@panodash/widget-sdk';
import {
  clearTokens,
  expiryFrom,
  formPost,
  getRedirectUrl,
  getTokens,
  launchAuthFlow,
  randomState,
  setTokens,
} from '@panodash/core/oauth';
import {
  bridgeAccessToken,
  bridgeActivationSnapshot,
  connectViaBridge,
  invalidateBridgeAccess,
} from '@panodash/core/bridge';
import { StatTile } from '@panodash/ui/StatTile';
import { ConnectPrompt } from '@panodash/ui/ConnectPrompt';

/**
 * WHOOP via OAuth2 (API v2). WHOOP issues a client ID + secret from
 * developer.whoop.com — no PKCE public clients — so like Withings the user
 * registers their own app and both values stay in local storage. The
 * `offline` scope is what makes WHOOP return a refresh token; without it
 * the connection would die after an hour.
 */
type WhoopMetric = 'recovery' | 'hrv' | 'restingHeartRate' | 'strain' | 'sleepPerformance';

interface WhoopConfig {
  connector: 'own-app' | 'bridge';
  clientId: string;
  clientSecret: string;
  metric: WhoopMetric;
  pollMinutes: number;
}

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API_BASE = 'https://api.prod.whoop.com/developer/v2';
const SCOPES = 'offline read:recovery read:cycles read:sleep';

export const WHOOP_METRICS: Record<
  WhoopMetric,
  {
    label: string;
    endpoint: string;
    field: string;
    unit?: string;
    direction: Direction;
    decimals?: number;
  }
> = {
  recovery: { label: 'Recovery score', endpoint: 'recovery', field: 'recovery_score', unit: '%', direction: 'up-good' },
  hrv: { label: 'HRV (RMSSD)', endpoint: 'recovery', field: 'hrv_rmssd_milli', unit: 'ms', direction: 'up-good', decimals: 1 },
  restingHeartRate: { label: 'Resting heart rate', endpoint: 'recovery', field: 'resting_heart_rate', unit: 'bpm', direction: 'down-good' },
  strain: { label: 'Day strain', endpoint: 'cycle', field: 'strain', direction: 'neutral', decimals: 1 },
  sleepPerformance: { label: 'Sleep performance', endpoint: 'activity/sleep', field: 'sleep_performance_percentage', unit: '%', direction: 'up-good' },
};

export interface WhoopRecord {
  score_state?: string;
  nap?: boolean;
  score?: Record<string, unknown>;
}

/**
 * Newest usable value from a WHOOP collection: records arrive newest-first,
 * and only 'SCORED' records carry final numbers (PENDING_SCORE and
 * UNSCORABLE don't). Naps are skipped so sleep metrics reflect the night.
 */
export function pickWhoopValue(records: WhoopRecord[], field: string): number | undefined {
  for (const record of records) {
    if (record.score_state !== 'SCORED') continue;
    if (record.nap === true) continue;
    const value = record.score?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export async function connectWhoop(instance: WidgetInstance): Promise<void> {
  if ((instance.config as unknown as WhoopConfig).connector === 'bridge') {
    await connectViaBridge(instance.id, 'whoop');
    return;
  }
  const clientId = String(instance.config.clientId ?? '').trim();
  const clientSecret = String(instance.config.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Add your WHOOP Client ID and Secret in the widget settings first');
  }
  const redirect = getRedirectUrl();
  const state = randomState();
  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      scope: SCOPES,
      state,
    });
  const callback = await launchAuthFlow(authUrl);
  if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch — try again');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('WHOOP did not return an authorization code');
  const json = await formPost(TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirect,
  });
  await setTokens(instance.id, {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: expiryFrom(json.expires_in),
  });
}

async function accessToken(widgetId: string, config: WhoopConfig): Promise<string | null> {
  const tokens = await getTokens(widgetId);
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;
  if (!tokens.refreshToken) return null;
  try {
    const json = await formPost(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: String(config.clientId ?? '').trim(),
      client_secret: String(config.clientSecret ?? '').trim(),
      scope: 'offline',
    });
    const next = {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : tokens.refreshToken,
      expiresAt: expiryFrom(json.expires_in),
    };
    await setTokens(widgetId, next);
    return next.accessToken;
  } catch {
    await clearTokens(widgetId);
    return null;
  }
}

async function fetchWhoop(
  rawConfig: Record<string, unknown>,
  { widgetId }: FetchContext,
): Promise<Snapshot> {
  const config = rawConfig as unknown as WhoopConfig;
  const bridged = config.connector === 'bridge';
  const spec = WHOOP_METRICS[config.metric] ?? WHOOP_METRICS.recovery;
  let token: string | null;
  try {
    token = bridged ? await bridgeAccessToken(widgetId) : await accessToken(widgetId, config);
  } catch (err) {
    const activation = bridgeActivationSnapshot(err);
    if (activation) return activation;
    throw err;
  }
  if (!token) return { fetchedAt: Date.now(), error: 'WHOOP is not connected', errorCode: 'auth' };

  let res = await fetch(`${API_BASE}/${spec.endpoint}?limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && bridged) {
    // Cached bridge token may be stale — invalidate and retry once.
    await invalidateBridgeAccess(widgetId);
    try {
      token = await bridgeAccessToken(widgetId);
    } catch (err) {
      const activation = bridgeActivationSnapshot(err);
      if (activation) return activation;
      throw err;
    }
    if (token) {
      res = await fetch(`${API_BASE}/${spec.endpoint}?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  if (res.status === 401 || !token) {
    if (!bridged) await clearTokens(widgetId);
    return { fetchedAt: Date.now(), error: 'WHOOP is not connected', errorCode: 'auth' };
  }
  if (!res.ok) return { fetchedAt: Date.now(), error: `WHOOP HTTP ${res.status}`, errorCode: 'http' };
  const json = (await res.json()) as { records?: WhoopRecord[] };
  const value = pickWhoopValue(json.records ?? [], spec.field);
  if (value === undefined) {
    return {
      fetchedAt: Date.now(),
      error: 'No scored data yet — WHOOP scores arrive after it syncs',
      errorCode: 'parse',
    };
  }
  return { fetchedAt: Date.now(), value };
}

function WhoopWidget({ instance, snapshot, samples, refresh }: WidgetComponentProps) {
  const config = instance.config as unknown as WhoopConfig;
  const spec = WHOOP_METRICS[config.metric] ?? WHOOP_METRICS.recovery;
  if (snapshot?.errorCode === 'auth') {
    return (
      <ConnectPrompt service="WHOOP" onConnect={() => connectWhoop(instance)} onConnected={refresh} />
    );
  }
  return (
    <StatTile
      value={snapshot?.value}
      unit={spec.unit}
      decimals={spec.decimals}
      direction={spec.direction}
      samples={samples}
      goal={instance.goal}
    />
  );
}

export const whoopProvider: WidgetProvider = {
  type: 'whoop',
  name: 'WHOOP',
  description: 'Recovery, HRV, resting heart rate, strain, or sleep performance (OAuth).',
  icon: '💪',
  kind: 'metric',
  auth: 'confidential',
  defaultSize: { w: 1, h: 1 },
  setupNote: () =>
    'Own app: create one at developer.whoop.com with the read:recovery, read:cycles, and read:sleep scopes ' +
    `and Redirect URL exactly: ${getRedirectUrl()} — keys stay local. ` +
    'Auth bridge: no app registration; uses the bridge configured in the dashboard ⋯ menu, which then holds ' +
    'this connection’s refresh token.',
  configFields: [
    {
      key: 'connector',
      label: 'Connection method',
      type: 'select',
      options: [
        { value: 'own-app', label: 'Your own WHOOP app (keys stay local)' },
        { value: 'bridge', label: 'Auth bridge (no app registration)' },
      ],
    },
    {
      key: 'clientId',
      label: 'WHOOP Client ID',
      type: 'text',
      visibleWhen: { key: 'connector', equals: 'own-app' },
    },
    {
      key: 'clientSecret',
      label: 'WHOOP Client Secret',
      type: 'password',
      visibleWhen: { key: 'connector', equals: 'own-app' },
    },
    {
      key: 'metric',
      label: 'Metric',
      type: 'select',
      options: (Object.keys(WHOOP_METRICS) as WhoopMetric[]).map((k) => ({
        value: k,
        label: WHOOP_METRICS[k].label,
      })),
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { connector: 'own-app', clientId: '', clientSecret: '', metric: 'recovery', pollMinutes: 30 },
  defaultTitle: (config) =>
    `WHOOP ${WHOOP_METRICS[(config.metric as WhoopMetric) ?? 'recovery']?.label ?? ''}`.trim(),
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: () => ['https://api.prod.whoop.com/*'],
  fetchSnapshot: fetchWhoop,
  component: WhoopWidget,
};
