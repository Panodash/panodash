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
  pkcePair,
  setTokens,
} from '@panodash/core/oauth';
import { addDays, ymdLocal } from '@panodash/core/dates';
import { extractPath, toNumber } from '@panodash/core/jsonpath';
import { StatTile } from '@panodash/ui/StatTile';
import { ConnectPrompt } from '@panodash/ui/ConnectPrompt';

/**
 * Fitbit via OAuth2 + PKCE. Fitbit has no personal tokens, but PKCE means no
 * client secret: the user registers a free "Personal" app at dev.fitbit.com,
 * pastes the Client ID, and clicks Connect. Refresh happens silently in the
 * background worker, so history keeps recording without an open tab.
 */
type FitbitMetric = 'steps' | 'hrv' | 'restingHeartRate';

interface FitbitConfig {
  clientId: string;
  metric: FitbitMetric;
  pollMinutes: number;
}

const TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const SCOPES = 'activity heartrate';

export const FITBIT_METRICS: Record<
  FitbitMetric,
  { label: string; unit?: string; direction: Direction; decimals?: number }
> = {
  steps: { label: 'Steps today', direction: 'up-good' },
  hrv: { label: 'HRV (daily RMSSD)', unit: 'ms', direction: 'up-good', decimals: 1 },
  restingHeartRate: { label: 'Resting heart rate', unit: 'bpm', direction: 'down-good' },
};

export async function connectFitbit(instance: WidgetInstance): Promise<void> {
  const clientId = String(instance.config.clientId ?? '').trim();
  if (!clientId) throw new Error('Add your Fitbit Client ID in the widget settings first');
  const { verifier, challenge } = await pkcePair();
  const redirect = getRedirectUrl();
  const authUrl =
    'https://www.fitbit.com/oauth2/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect_uri: redirect,
    });
  const callback = await launchAuthFlow(authUrl);
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('Fitbit did not return an authorization code');
  const json = await formPost(TOKEN_URL, {
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
  });
  await setTokens(instance.id, {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: expiryFrom(json.expires_in),
  });
}

async function accessToken(widgetId: string, clientId: string): Promise<string | null> {
  const tokens = await getTokens(widgetId);
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;
  if (!tokens.refreshToken) return null;
  try {
    const json = await formPost(TOKEN_URL, {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    const next = {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : tokens.refreshToken,
      expiresAt: expiryFrom(json.expires_in),
    };
    await setTokens(widgetId, next);
    return next.accessToken;
  } catch {
    // Refresh token revoked or expired — force a fresh connect.
    await clearTokens(widgetId);
    return null;
  }
}

const AUTH_ERROR: Omit<Snapshot, 'fetchedAt'> = {
  error: 'Fitbit is not connected',
  errorCode: 'auth',
};

async function fetchFitbit(
  rawConfig: Record<string, unknown>,
  { widgetId }: FetchContext,
): Promise<Snapshot> {
  const config = rawConfig as unknown as FitbitConfig;
  const token = await accessToken(widgetId, String(config.clientId ?? '').trim());
  if (!token) return { fetchedAt: Date.now(), ...AUTH_ERROR };

  const metric = FITBIT_METRICS[config.metric] ? config.metric : 'steps';
  let url: string;
  let path: string;
  if (metric === 'steps') {
    url = 'https://api.fitbit.com/1/user/-/activities/date/today.json';
    path = 'summary.steps';
  } else if (metric === 'restingHeartRate') {
    url = 'https://api.fitbit.com/1/user/-/activities/heart/date/today/1d.json';
    path = 'activities-heart[0].value.restingHeartRate';
  } else {
    // HRV lands after the night syncs; ask for a 2-day window and take the latest.
    const start = ymdLocal(addDays(new Date(), -1));
    url = `https://api.fitbit.com/1/user/-/hrv/date/${start}/${ymdLocal()}.json`;
    path = '';
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    await clearTokens(widgetId);
    return { fetchedAt: Date.now(), ...AUTH_ERROR };
  }
  if (!res.ok) return { fetchedAt: Date.now(), error: `Fitbit HTTP ${res.status}`, errorCode: 'http' };
  const json = (await res.json()) as Record<string, unknown>;

  let value: number | undefined;
  if (metric === 'hrv') {
    const entries = (json.hrv as Array<{ value?: { dailyRmssd?: number } }> | undefined) ?? [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const v = entries[i]?.value?.dailyRmssd;
      if (typeof v === 'number') {
        value = v;
        break;
      }
    }
    if (value === undefined) {
      return { fetchedAt: Date.now(), error: 'No HRV yet — it appears after tonight syncs', errorCode: 'parse' };
    }
  } else {
    value = toNumber(extractPath(json, path));
    if (value === undefined) {
      return { fetchedAt: Date.now(), error: 'No data for today yet', errorCode: 'parse' };
    }
  }
  return { fetchedAt: Date.now(), value };
}

function FitbitWidget({ instance, snapshot, samples, refresh }: WidgetComponentProps) {
  const config = instance.config as unknown as FitbitConfig;
  const spec = FITBIT_METRICS[config.metric] ?? FITBIT_METRICS.steps;
  if (snapshot?.errorCode === 'auth') {
    return (
      <ConnectPrompt service="Fitbit" onConnect={() => connectFitbit(instance)} onConnected={refresh} />
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

export const fitbitProvider: WidgetProvider = {
  type: 'fitbit',
  name: 'Fitbit',
  description: 'Steps, HRV, or resting heart rate — OAuth, no client secret needed.',
  icon: '⌚',
  kind: 'metric',
  auth: 'pkce',
  defaultSize: { w: 1, h: 1 },
  setupNote: () =>
    'Register a free app at dev.fitbit.com/apps (OAuth 2.0 Application Type: “Personal”) and set its ' +
    `Redirect URL to exactly: ${getRedirectUrl()} — then paste the Client ID below and click Connect on the widget. ` +
    'Each Fitbit widget connects separately.',
  configFields: [
    { key: 'clientId', label: 'Fitbit app Client ID', type: 'text', required: true, placeholder: '23ABCD' },
    {
      key: 'metric',
      label: 'Metric',
      type: 'select',
      options: (Object.keys(FITBIT_METRICS) as FitbitMetric[]).map((k) => ({
        value: k,
        label: FITBIT_METRICS[k].label,
      })),
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { clientId: '', metric: 'steps', pollMinutes: 30 },
  defaultTitle: (config) =>
    `Fitbit ${FITBIT_METRICS[(config.metric as FitbitMetric) ?? 'steps']?.label ?? ''}`.trim(),
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: () => ['https://api.fitbit.com/*'],
  fetchSnapshot: fetchFitbit,
  component: FitbitWidget,
};
