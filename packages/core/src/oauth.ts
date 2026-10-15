import { storageGet, storageKeys, storageRemove, storageSet } from './storage';

/**
 * Small OAuth2 toolkit for health-source widgets. Providers own their
 * protocol shapes (Fitbit is PKCE, Withings wants a client secret and a
 * nonstandard envelope); this module supplies the shared pieces: PKCE
 * generation, the chrome.identity auth window, form-encoded POSTs, and a
 * per-widget token store.
 *
 * Tokens are stored under their own storage keys — deliberately outside the
 * settings object, so dashboard backups never contain refresh tokens.
 */

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms after which the access token should be refreshed. */
  expiresAt: number;
}

const hasIdentity = typeof chrome !== 'undefined' && !!chrome.identity;

export function oauthKey(widgetId: string): string {
  return `oauth:${widgetId}`;
}

export async function getTokens(widgetId: string): Promise<OAuthTokens | undefined> {
  return storageGet<OAuthTokens>(oauthKey(widgetId));
}

export async function setTokens(widgetId: string, tokens: OAuthTokens): Promise<void> {
  await storageSet(oauthKey(widgetId), tokens);
}

export async function clearTokens(widgetId: string): Promise<void> {
  await storageRemove(oauthKey(widgetId));
}

/** Widget ids that currently hold OAuth tokens — for connection management. */
export async function listOAuthWidgetIds(): Promise<string[]> {
  const keys = await storageKeys('oauth:');
  return keys.map((key) => key.slice('oauth:'.length));
}

/** The redirect URL the user must register with the OAuth provider. */
export function getRedirectUrl(): string {
  if (hasIdentity) return chrome.identity.getRedirectURL();
  return 'https://<extension-id>.chromiumapp.org/ (shown once the extension is installed)';
}

export function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Open the provider's consent screen and resolve with the redirect URL it
 * lands on. Must be called from a user gesture in the new-tab page.
 */
export async function launchAuthFlow(url: string): Promise<URL> {
  if (!hasIdentity) {
    throw new Error('Connecting requires the installed extension (chrome://extensions → Load unpacked)');
  }
  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!redirect) throw new Error('Authorization was cancelled');
  return new URL(redirect);
}

/** POST application/x-www-form-urlencoded, expect a JSON reply. */
export async function formPost(
  url: string,
  params: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!json) throw new Error('Response is not JSON');
  return json;
}

export function expiryFrom(expiresInSeconds: unknown): number {
  const s = Number(expiresInSeconds);
  return Date.now() + (Number.isFinite(s) && s > 0 ? s : 3600) * 1000 - 60_000;
}
