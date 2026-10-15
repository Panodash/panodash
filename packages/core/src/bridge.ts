import { getSettings, storageGet, storageKeys, storageRemove, storageSet } from './storage';
import { launchAuthFlow } from './oauth';
import type { Snapshot } from '@panodash/widget-sdk';

/**
 * Client for the optional auth bridge (apps/bridge): confidential-OAuth
 * providers without registering your own developer app. The extension
 * holds only an opaque session handle — the refresh token lives on the
 * bridge — and still fetches all data directly from the provider.
 *
 * Bridge records live outside the settings object (like OAuth tokens), so
 * dashboard backups and shared snippets never contain session handles.
 */

export interface BridgeConnection {
  url: string;
  provider: string;
  session: string;
  accessToken?: string;
  expiresAt?: number;
}

/** A bridge-neutral signal that an operator requires account activation.
 * The extension understands only the message and link; plans, billing, and
 * entitlement logic remain entirely on the operator's service. */
export class BridgeActivationRequiredError extends Error {
  readonly code = 'activation_required';

  constructor(
    message: string,
    readonly activationUrl: string,
  ) {
    super(message);
    this.name = 'BridgeActivationRequiredError';
  }
}

export function parseBridgeActivationRequired(
  body: Record<string, unknown>,
): BridgeActivationRequiredError | null {
  if (body.code !== 'activation_required' || typeof body.activationUrl !== 'string') return null;
  try {
    const url = new URL(body.activationUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
      return null;
    }
    return new BridgeActivationRequiredError(
      typeof body.error === 'string' ? body.error : 'This bridge requires activation',
      url.toString(),
    );
  } catch {
    return null;
  }
}

/** Convert an activation exception into the provider-neutral snapshot shape
 * rendered by WidgetShell. Returns null for unrelated failures. */
export function bridgeActivationSnapshot(error: unknown): Snapshot | null {
  if (!(error instanceof BridgeActivationRequiredError)) return null;
  return {
    fetchedAt: Date.now(),
    error: error.message,
    errorCode: 'activation',
    meta: { activationUrl: error.activationUrl },
  };
}

const key = (widgetId: string) => `bridge:${widgetId}`;

export function normalizeBridgeUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new Error('Bridge URL must be https:// (or http://localhost for development)');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export async function getBridgeConnection(widgetId: string): Promise<BridgeConnection | undefined> {
  return storageGet<BridgeConnection>(key(widgetId));
}

export async function clearBridgeConnection(widgetId: string): Promise<void> {
  await storageRemove(key(widgetId));
}

/** Every stored bridge session — for connection management. The opaque
 *  session handle stays here; callers get only the widget, URL, and provider. */
export async function listBridgeConnections(): Promise<
  { widgetId: string; url: string; provider: string }[]
> {
  const keys = await storageKeys('bridge:');
  const records = await Promise.all(
    keys.map(async (storageKey) => {
      const widgetId = storageKey.slice('bridge:'.length);
      const record = await storageGet<BridgeConnection>(storageKey);
      return record ? { widgetId, url: record.url, provider: record.provider } : null;
    }),
  );
  return records.filter((record): record is { widgetId: string; url: string; provider: string } => !!record);
}

async function bridgeFetch(
  url: string,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { status: res.status, body };
}

/** The configured bridge URL, or a helpful error naming where to set it. */
export async function requireBridgeUrl(): Promise<string> {
  const settings = await getSettings();
  if (!settings.bridgeUrl) {
    throw new Error('No auth bridge set — add one via the dashboard ⋯ menu → Auth bridge');
  }
  return settings.bridgeUrl;
}

/** Which providers a bridge instance offers. */
export async function bridgeProviders(url: string): Promise<string[]> {
  const { status, body } = await bridgeFetch(url, '/v1/providers', { method: 'GET' });
  if (status !== 200 || !Array.isArray(body.providers)) {
    throw new Error(`That doesn’t look like a Panodash bridge (HTTP ${status})`);
  }
  return body.providers.map(String);
}

/** Run the consent flow through the bridge. Call from a user gesture. */
export async function connectViaBridge(widgetId: string, provider: string): Promise<void> {
  const url = await requireBridgeUrl();
  const redirect = chrome.identity?.getRedirectURL?.();
  if (!redirect) {
    throw new Error('Connecting requires the installed extension (chrome://extensions → Load unpacked)');
  }
  const start = await bridgeFetch(url, `/v1/auth/${provider}/start`, {
    method: 'POST',
    body: JSON.stringify({ extensionRedirect: redirect }),
  });
  const activation = parseBridgeActivationRequired(start.body);
  if (activation) throw activation;
  if (start.status !== 200 || typeof start.body.authUrl !== 'string' || typeof start.body.session !== 'string') {
    throw new Error(String(start.body.error ?? `Bridge refused to start the flow (HTTP ${start.status})`));
  }
  const callback = await launchAuthFlow(start.body.authUrl);
  const result = parseBridgeCallback(callback, start.body.session);
  if (!result.ok) throw new Error(result.error);
  await storageSet(key(widgetId), {
    url,
    provider,
    session: start.body.session,
  } satisfies BridgeConnection);
}

/** Pure: interpret the auth-window redirect the bridge sent us back on. */
export function parseBridgeCallback(
  callback: URL,
  expectedSession: string,
): { ok: true } | { ok: false; error: string } {
  if (callback.searchParams.get('bridge') === 'error') {
    return { ok: false, error: callback.searchParams.get('message') ?? 'The bridge reported an error' };
  }
  if (
    callback.searchParams.get('bridge') !== 'ok' ||
    callback.searchParams.get('session') !== expectedSession
  ) {
    return { ok: false, error: 'Bridge session mismatch — try connecting again' };
  }
  return { ok: true };
}

/**
 * A fresh provider access token via the bridge, or null when the widget
 * needs (re)connecting. Cached locally until near expiry; the bridge
 * refreshes upstream on its side.
 */
export async function bridgeAccessToken(widgetId: string): Promise<string | null> {
  const record = await getBridgeConnection(widgetId);
  if (!record) return null;
  if (record.accessToken && record.expiresAt && Date.now() < record.expiresAt - 30_000) {
    return record.accessToken;
  }
  try {
    const { status, body } = await bridgeFetch(record.url, '/v1/token', {
      method: 'POST',
      body: JSON.stringify({ session: record.session }),
    });
    const activation = parseBridgeActivationRequired(body);
    if (activation) throw activation;
    if (status === 401 || status === 404 || status === 410) {
      await clearBridgeConnection(widgetId);
      return null;
    }
    if (status !== 200 || typeof body.accessToken !== 'string') return null;
    await storageSet(key(widgetId), {
      ...record,
      accessToken: body.accessToken,
      expiresAt: Number(body.expiresAt) || Date.now() + 5 * 60 * 1000,
    } satisfies BridgeConnection);
    return body.accessToken;
  } catch (err) {
    if (err instanceof BridgeActivationRequiredError) throw err;
    // Bridge unreachable — keep the session; it may come back.
    return null;
  }
}

/** Drop the locally cached access token so the next call refetches. */
export async function invalidateBridgeAccess(widgetId: string): Promise<void> {
  const record = await getBridgeConnection(widgetId);
  if (record) {
    await storageSet(key(widgetId), { ...record, accessToken: undefined, expiresAt: undefined });
  }
}

/** Disconnect: best-effort delete on the bridge, always clear locally. */
export async function disconnectBridge(widgetId: string): Promise<void> {
  const record = await getBridgeConnection(widgetId);
  if (record) {
    try {
      await bridgeFetch(record.url, '/v1/session', {
        method: 'DELETE',
        body: JSON.stringify({ session: record.session }),
      });
    } catch {
      // Bridge unreachable; the session will age out server-side.
    }
  }
  await clearBridgeConnection(widgetId);
}
