/**
 * Panodash auth bridge core — protocol and OAuth request handling for a
 * self-hosted or managed service that holds OAuth
 * client secrets and refresh tokens for `confidential` providers, so
 * extension users can connect without registering their own developer
 * apps. See docs/architecture.md ("The bridge") for the design and trust
 * statement, and apps/bridge/README.md for the reference operator.
 *
 * The bridge proxies TOKENS, never data: the extension fetches metrics
 * directly from providers with the short-lived access tokens it gets here.
 *
 * The caller supplies providers, durable storage, and any hosted-service
 * authorization policy.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Store } from './store.js';
import type { BridgeProvider } from './providers.js';

export interface BridgeConfig {
  /** Public base URL of this bridge (used to build provider redirect URIs). */
  baseUrl: string;
  providers: Map<string, BridgeProvider>;
  store: Store;
  rateLimitPerMinute?: number;
  /** Optional hosted-operator policy seam. The reference bridge allows all
   * sessions; hosted deployments can require activation without changing
   * the extension or bridge protocol. */
  authorizeSession?: SessionAuthorizer;
}

export interface SessionAuthorizationContext {
  phase: 'start' | 'token';
  provider: string;
  session: string;
  request: IncomingMessage;
}

export type SessionAuthorizationDecision =
  | { authorized: true }
  | { authorized: false; activationUrl: string; error?: string };

export type SessionAuthorizer = (
  context: SessionAuthorizationContext,
) => Promise<SessionAuthorizationDecision>;

const PENDING_TTL_MS = 10 * 60 * 1000;
const ACCESS_SLACK_MS = 60 * 1000;
const BODY_LIMIT = 10 * 1024;

function id(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** Only Chrome extension auth windows (and localhost during development)
 *  may be redirect targets — anything else would make us an open redirector. */
export function isAllowedExtensionRedirect(url: string): boolean {
  return (
    /^https:\/\/[a-p]{32}\.chromiumapp\.org\/([\w\-./?=&%]*)?$/.test(url) ||
    /^http:\/\/localhost(:\d{1,5})?\/([\w\-./?=&%]*)?$/.test(url)
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function normalizeActivationUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new Error('authorizeSession activationUrl must use https (or localhost for development)');
  }
  return url.toString();
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      } catch {
        reject(new Error('Body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createBridgeServer(config: BridgeConfig) {
  const { store, providers } = config;
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const rateLimit = config.rateLimitPerMinute ?? 60;
  const hits = new Map<string, { count: number; resetAt: number }>();

  async function authorize(
    context: SessionAuthorizationContext,
  ): Promise<{ authorized: true } | { authorized: false; activationUrl: string; error: string }> {
    if (!config.authorizeSession) return { authorized: true };
    const decision = await config.authorizeSession(context);
    if (decision.authorized) return decision;
    return {
      authorized: false,
      activationUrl: normalizeActivationUrl(decision.activationUrl),
      error: decision.error ?? 'This bridge requires activation',
    };
  }

  function sendAuthorizationRequired(
    res: ServerResponse,
    decision: { authorized: false; activationUrl: string; error: string },
  ): void {
    sendJson(res, 402, {
      error: decision.error,
      code: 'activation_required',
      activationUrl: decision.activationUrl,
    });
  }

  function rateLimited(req: IncomingMessage): boolean {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    entry.count += 1;
    return entry.count > rateLimit;
  }

  async function freshAccessToken(sessionId: string, req: IncomingMessage): Promise<
    | { ok: true; accessToken: string; expiresAt: number; provider: string }
    | {
        ok: false;
        status: number;
        error: string;
        code?: 'activation_required';
        activationUrl?: string;
      }
  > {
    const session = await store.getSession(sessionId);
    if (!session) return { ok: false, status: 404, error: 'Unknown session' };
    const provider = providers.get(session.provider);
    if (!provider) return { ok: false, status: 410, error: 'Provider no longer configured' };
    const authorization = await authorize({
      phase: 'token',
      provider: session.provider,
      session: sessionId,
      request: req,
    });
    if (!authorization.authorized) {
      return {
        ok: false,
        status: 402,
        error: authorization.error,
        code: 'activation_required',
        activationUrl: authorization.activationUrl,
      };
    }

    if (
      session.accessToken &&
      session.accessExpiresAt &&
      Date.now() < session.accessExpiresAt - ACCESS_SLACK_MS
    ) {
      await store.putSession(sessionId, { ...session, lastUsedAt: Date.now() });
      return {
        ok: true,
        accessToken: session.accessToken,
        expiresAt: session.accessExpiresAt,
        provider: session.provider,
      };
    }

    try {
      const tokens = await provider.refresh({ refreshToken: session.refreshToken });
      const expiresAt = Date.now() + tokens.expiresInSeconds * 1000;
      await store.putSession(sessionId, {
        ...session,
        refreshToken: tokens.refreshToken ?? session.refreshToken,
        accessToken: tokens.accessToken,
        accessExpiresAt: expiresAt,
        lastUsedAt: Date.now(),
      });
      return { ok: true, accessToken: tokens.accessToken, expiresAt, provider: session.provider };
    } catch {
      // Refresh rejected — the grant is dead; make the client reconnect.
      await store.deleteSession(sessionId);
      return { ok: false, status: 401, error: 'Provider rejected the refresh — reconnect' };
    }
  }

  return createServer((req, res) => {
    void (async () => {
      // The extension calls from a chrome-extension:// origin; no cookies or
      // credentials are involved, so a permissive CORS policy is safe here.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (rateLimited(req)) return sendJson(res, 429, { error: 'Rate limited — slow down' });

      const url = new URL(req.url ?? '/', baseUrl);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && path === '/healthz') {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && path === '/v1/providers') {
        return sendJson(res, 200, { providers: [...providers.keys()] });
      }

      const startMatch = path.match(/^\/v1\/auth\/([a-z0-9-]+)\/start$/);
      if (req.method === 'POST' && startMatch) {
        const provider = providers.get(startMatch[1]);
        if (!provider) return sendJson(res, 404, { error: `Provider '${startMatch[1]}' is not configured on this bridge` });
        const body = await readBody(req);
        const extensionRedirect = String(body.extensionRedirect ?? '');
        if (!isAllowedExtensionRedirect(extensionRedirect)) {
          return sendJson(res, 400, { error: 'extensionRedirect must be a chromiumapp.org (or localhost) URL' });
        }
        await store.prunePending(PENDING_TTL_MS);
        const session = id(32);
        const authorization = await authorize({
          phase: 'start',
          provider: provider.id,
          session,
          request: req,
        });
        if (!authorization.authorized) {
          sendAuthorizationRequired(res, authorization);
          return;
        }
        const state = id(16);
        await store.putPending(state, {
          session,
          provider: provider.id,
          extensionRedirect,
          createdAt: Date.now(),
        });
        const authUrl = provider.buildAuthUrl({
          redirectUri: `${baseUrl}/v1/auth/${provider.id}/callback`,
          state,
        });
        return sendJson(res, 200, { authUrl, session });
      }

      const callbackMatch = path.match(/^\/v1\/auth\/([a-z0-9-]+)\/callback$/);
      if (req.method === 'GET' && callbackMatch) {
        const state = url.searchParams.get('state') ?? '';
        const pending = await store.takePending(state);
        if (!pending || pending.provider !== callbackMatch[1] || Date.now() - pending.createdAt > PENDING_TTL_MS) {
          return sendJson(res, 400, { error: 'Unknown or expired state — restart the connect flow' });
        }
        const fail = (message: string) => {
          res.writeHead(302, {
            Location: `${pending.extensionRedirect}?bridge=error&message=${encodeURIComponent(message)}`,
          });
          res.end();
        };
        const provider = providers.get(pending.provider);
        const code = url.searchParams.get('code');
        if (!provider) return fail('Provider no longer configured');
        if (!code) return fail(url.searchParams.get('error') ?? 'Authorization was denied');
        try {
          const tokens = await provider.exchangeCode({
            code,
            redirectUri: `${baseUrl}/v1/auth/${provider.id}/callback`,
          });
          if (!tokens.refreshToken) return fail('Provider returned no refresh token');
          await store.putSession(pending.session, {
            provider: provider.id,
            refreshToken: tokens.refreshToken,
            accessToken: tokens.accessToken,
            accessExpiresAt: Date.now() + tokens.expiresInSeconds * 1000,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
          });
          res.writeHead(302, {
            Location: `${pending.extensionRedirect}?bridge=ok&session=${encodeURIComponent(pending.session)}`,
          });
          res.end();
        } catch (err) {
          fail(err instanceof Error ? err.message : 'Token exchange failed');
        }
        return;
      }

      if (req.method === 'POST' && path === '/v1/token') {
        const body = await readBody(req);
        const session = String(body.session ?? '');
        if (!session) return sendJson(res, 400, { error: 'Missing session' });
        const result = await freshAccessToken(session, req);
        if (!result.ok) {
          return sendJson(res, result.status, {
            error: result.error,
            ...(result.code ? { code: result.code } : {}),
            ...(result.activationUrl ? { activationUrl: result.activationUrl } : {}),
          });
        }
        return sendJson(res, 200, {
          accessToken: result.accessToken,
          expiresAt: result.expiresAt,
          provider: result.provider,
        });
      }

      if (req.method === 'DELETE' && path === '/v1/session') {
        const body = await readBody(req);
        const session = String(body.session ?? '');
        if (session) await store.deleteSession(session);
        return sendJson(res, 200, { ok: true });
      }

      sendJson(res, 404, { error: 'Not found' });
    })().catch((err: unknown) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' });
    });
  });
}

