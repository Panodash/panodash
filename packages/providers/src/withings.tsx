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
import { addDays, ymdLocal } from '@panodash/core/dates';
import {
  bridgeAccessToken,
  bridgeActivationSnapshot,
  connectViaBridge,
  invalidateBridgeAccess,
} from '@panodash/core/bridge';
import { StatTile } from '@panodash/ui/StatTile';
import { ConnectPrompt } from '@panodash/ui/ConnectPrompt';

/**
 * Withings via OAuth2. Withings requires a client secret even for personal
 * use (no PKCE), so the user registers an app at developer.withings.com and
 * pastes both the Client ID and Secret — stored locally like any API key.
 * Their public API exposes steps and weight (no HRV; use Oura/Fitbit for
 * that). Responses arrive in a nonstandard {status, body} envelope.
 */
type WithingsMetric = 'steps' | 'weight';

interface WithingsConfig {
  connector: 'own-app' | 'bridge';
  clientId: string;
  clientSecret: string;
  metric: WithingsMetric;
  pollMinutes: number;
}

const TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2';

export const WITHINGS_METRICS: Record<
  WithingsMetric,
  { label: string; unit?: string; direction: Direction; decimals?: number }
> = {
  steps: { label: 'Steps today', direction: 'up-good' },
  weight: { label: 'Weight (latest)', unit: 'kg', direction: 'neutral', decimals: 1 },
};

interface WithingsEnvelope {
  status?: number;
  error?: string;
  body?: Record<string, unknown>;
}

function unwrap(json: Record<string, unknown>): Record<string, unknown> {
  const env = json as WithingsEnvelope;
  if (env.status !== 0) {
    throw new Error(`Withings error ${env.status ?? '?'}${env.error ? ` — ${env.error}` : ''}`);
  }
  return env.body ?? {};
}

export async function connectWithings(instance: WidgetInstance): Promise<void> {
  if ((instance.config as unknown as WithingsConfig).connector === 'bridge') {
    await connectViaBridge(instance.id, 'withings');
    return;
  }
  const clientId = String(instance.config.clientId ?? '').trim();
  const clientSecret = String(instance.config.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Add your Withings Client ID and Secret in the widget settings first');
  }
  const redirect = getRedirectUrl();
  const state = randomState();
  const authUrl =
    'https://account.withings.com/oauth2_user/authorize2?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'user.activity,user.metrics',
      redirect_uri: redirect,
      state,
    });
  const callback = await launchAuthFlow(authUrl);
  if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch — try again');
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('Withings did not return an authorization code');
  const body = unwrap(
    await formPost(TOKEN_URL, {
      action: 'requesttoken',
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirect,
    }),
  );
  await setTokens(instance.id, {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresAt: expiryFrom(body.expires_in),
  });
}

async function accessToken(widgetId: string, config: WithingsConfig): Promise<string | null> {
  const tokens = await getTokens(widgetId);
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;
  if (!tokens.refreshToken) return null;
  try {
    const body = unwrap(
      await formPost(TOKEN_URL, {
        action: 'requesttoken',
        grant_type: 'refresh_token',
        client_id: String(config.clientId ?? '').trim(),
        client_secret: String(config.clientSecret ?? '').trim(),
        refresh_token: tokens.refreshToken,
      }),
    );
    const next = {
      accessToken: String(body.access_token),
      refreshToken: body.refresh_token ? String(body.refresh_token) : tokens.refreshToken,
      expiresAt: expiryFrom(body.expires_in),
    };
    await setTokens(widgetId, next);
    return next.accessToken;
  } catch {
    await clearTokens(widgetId);
    return null;
  }
}

/** Most recent weight in kg from a getmeas response (grps newest-first). */
export function latestWithingsKg(
  measuregrps: Array<{ measures?: Array<{ type: number; value: number; unit: number }> }>,
): number | undefined {
  for (const grp of measuregrps) {
    const m = grp.measures?.find((x) => x.type === 1);
    if (m) return Math.round(m.value * Math.pow(10, m.unit) * 10) / 10;
  }
  return undefined;
}

async function fetchMetric(config: WithingsConfig, token: string): Promise<Snapshot> {
  const auth = { Authorization: `Bearer ${token}` };
  if (config.metric === 'weight') {
    const body = unwrap(
      await formPost(
        'https://wbsapi.withings.net/measure',
        { action: 'getmeas', meastype: '1', category: '1' },
        auth,
      ),
    );
    const value = latestWithingsKg(
      (body.measuregrps as Array<{ measures?: Array<{ type: number; value: number; unit: number }> }>) ?? [],
    );
    if (value === undefined) {
      return { fetchedAt: Date.now(), error: 'No weight measurements found', errorCode: 'parse' };
    }
    return { fetchedAt: Date.now(), value };
  }

  const body = unwrap(
    await formPost(
      'https://wbsapi.withings.net/v2/measure',
      {
        action: 'getactivity',
        startdateymd: ymdLocal(addDays(new Date(), -7)),
        enddateymd: ymdLocal(),
      },
      auth,
    ),
  );
  const activities = (body.activities as Array<{ date?: string; steps?: number }>) ?? [];
  for (let i = activities.length - 1; i >= 0; i--) {
    const steps = activities[i]?.steps;
    if (typeof steps === 'number') return { fetchedAt: Date.now(), value: steps };
  }
  return { fetchedAt: Date.now(), error: 'No activity in the last 7 days', errorCode: 'parse' };
}

async function fetchWithings(
  rawConfig: Record<string, unknown>,
  { widgetId }: FetchContext,
): Promise<Snapshot> {
  const config = rawConfig as unknown as WithingsConfig;
  const bridged = config.connector === 'bridge';
  const authError: Snapshot = {
    fetchedAt: Date.now(),
    error: 'Withings is not connected',
    errorCode: 'auth',
  };
  let token: string | null;
  try {
    token = bridged ? await bridgeAccessToken(widgetId) : await accessToken(widgetId, config);
  } catch (err) {
    const activation = bridgeActivationSnapshot(err);
    if (activation) return activation;
    throw err;
  }
  if (!token) return authError;

  try {
    return await fetchMetric(config, token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Withings signals an expired/invalid token as status 401 in the envelope.
    if (!/error 401/.test(message)) return { fetchedAt: Date.now(), error: message, errorCode: 'http' };
    if (bridged) {
      // Cached bridge token may be stale — invalidate and retry once.
      await invalidateBridgeAccess(widgetId);
      let fresh: string | null;
      try {
        fresh = await bridgeAccessToken(widgetId);
      } catch (err) {
        const activation = bridgeActivationSnapshot(err);
        if (activation) return activation;
        throw err;
      }
      if (fresh) {
        try {
          return await fetchMetric(config, fresh);
        } catch {
          return authError;
        }
      }
      return authError;
    }
    await clearTokens(widgetId);
    return authError;
  }
}

function WithingsWidget({ instance, snapshot, samples, refresh }: WidgetComponentProps) {
  const config = instance.config as unknown as WithingsConfig;
  const spec = WITHINGS_METRICS[config.metric] ?? WITHINGS_METRICS.steps;
  if (snapshot?.errorCode === 'auth') {
    return (
      <ConnectPrompt service="Withings" onConnect={() => connectWithings(instance)} onConnected={refresh} />
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

export const withingsProvider: WidgetProvider = {
  type: 'withings',
  name: 'Withings',
  description: 'Steps or weight from Withings scales and trackers (OAuth).',
  icon: '⚖️',
  kind: 'metric',
  auth: 'confidential',
  defaultSize: { w: 1, h: 1 },
  setupNote: () =>
    'Own app: register at developer.withings.com with Callback URL exactly: ' +
    `${getRedirectUrl()} — keys stay local. ` +
    'Auth bridge: no app registration; uses the bridge configured in the dashboard ⋯ menu, which then holds ' +
    'this connection’s refresh token.',
  configFields: [
    {
      key: 'connector',
      label: 'Connection method',
      type: 'select',
      options: [
        { value: 'own-app', label: 'Your own Withings app (keys stay local)' },
        { value: 'bridge', label: 'Auth bridge (no app registration)' },
      ],
    },
    {
      key: 'clientId',
      label: 'Withings Client ID',
      type: 'text',
      visibleWhen: { key: 'connector', equals: 'own-app' },
    },
    {
      key: 'clientSecret',
      label: 'Withings Client Secret',
      type: 'password',
      visibleWhen: { key: 'connector', equals: 'own-app' },
    },
    {
      key: 'metric',
      label: 'Metric',
      type: 'select',
      options: (Object.keys(WITHINGS_METRICS) as WithingsMetric[]).map((k) => ({
        value: k,
        label: WITHINGS_METRICS[k].label,
      })),
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { connector: 'own-app', clientId: '', clientSecret: '', metric: 'steps', pollMinutes: 30 },
  defaultTitle: (config) =>
    `Withings ${WITHINGS_METRICS[(config.metric as WithingsMetric) ?? 'steps']?.label ?? ''}`.trim(),
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: () => ['https://wbsapi.withings.net/*'],
  fetchSnapshot: fetchWithings,
  component: WithingsWidget,
};
