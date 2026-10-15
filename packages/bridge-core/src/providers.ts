/**
 * Provider registry for the auth bridge core. A provider is enabled when its
 * client id + secret are present in the environment; the bridge only ever
 * exposes the providers its operator configured.
 *
 * AUTH_URL / TOKEN_URL env overrides exist so tests (and providers'
 * sandbox environments) can point at a different host.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

export interface BridgeProvider {
  id: string;
  buildAuthUrl(input: { redirectUri: string; state: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<TokenSet>;
  refresh(input: { refreshToken: string }): Promise<TokenSet>;
}

type Env = Record<string, string | undefined>;

async function formPost(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json) throw new Error(`Provider token endpoint failed (HTTP ${res.status})`);
  return json;
}

function standardTokenSet(json: Record<string, unknown>): TokenSet {
  if (typeof json.access_token !== 'string') throw new Error('Provider returned no access token');
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expiresInSeconds: Number(json.expires_in) || 3600,
  };
}

function makeWhoop(env: Env): BridgeProvider | null {
  const clientId = env.WHOOP_CLIENT_ID;
  const clientSecret = env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const authUrl = env.WHOOP_AUTH_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/auth';
  const tokenUrl = env.WHOOP_TOKEN_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/token';
  return {
    id: 'whoop',
    buildAuthUrl: ({ redirectUri, state }) =>
      `${authUrl}?` +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'offline read:recovery read:cycles read:sleep',
        state,
      }),
    exchangeCode: async ({ code, redirectUri }) =>
      standardTokenSet(
        await formPost(tokenUrl, {
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      ),
    refresh: async ({ refreshToken }) =>
      standardTokenSet(
        await formPost(tokenUrl, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'offline',
        }),
      ),
  };
}

/** Withings wraps everything in a {status, body} envelope. */
function unwrapWithings(json: Record<string, unknown>): Record<string, unknown> {
  const status = json.status;
  if (status !== 0) throw new Error(`Withings error ${String(status ?? '?')}`);
  return (json.body as Record<string, unknown>) ?? {};
}

function makeWithings(env: Env): BridgeProvider | null {
  const clientId = env.WITHINGS_CLIENT_ID;
  const clientSecret = env.WITHINGS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const authUrl = env.WITHINGS_AUTH_URL ?? 'https://account.withings.com/oauth2_user/authorize2';
  const tokenUrl = env.WITHINGS_TOKEN_URL ?? 'https://wbsapi.withings.net/v2/oauth2';
  return {
    id: 'withings',
    buildAuthUrl: ({ redirectUri, state }) =>
      `${authUrl}?` +
      new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: 'user.activity,user.metrics',
        redirect_uri: redirectUri,
        state,
      }),
    exchangeCode: async ({ code, redirectUri }) =>
      standardTokenSet(
        unwrapWithings(
          await formPost(tokenUrl, {
            action: 'requesttoken',
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        ),
      ),
    refresh: async ({ refreshToken }) =>
      standardTokenSet(
        unwrapWithings(
          await formPost(tokenUrl, {
            action: 'requesttoken',
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
          }),
        ),
      ),
  };
}

export function loadProviders(env: Env): Map<string, BridgeProvider> {
  const providers = new Map<string, BridgeProvider>();
  for (const provider of [makeWhoop(env), makeWithings(env)]) {
    if (provider) providers.set(provider.id, provider);
  }
  return providers;
}
