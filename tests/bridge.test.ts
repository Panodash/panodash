import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createBridgeServer,
  isAllowedExtensionRedirect,
  loadProviders,
  type Store,
} from '@panodash/bridge-core';
import { createStore } from '../apps/bridge/src/store.ts';
import {
  normalizeBridgeUrl,
  parseBridgeActivationRequired,
  parseBridgeCallback,
} from '@panodash/core/bridge';

const EXT_REDIRECT = `https://${'a'.repeat(32)}.chromiumapp.org/`;

/** Fake WHOOP token endpoint: first call issues AT1/RT1, refreshes issue AT2… */
function mockProvider() {
  let exchanges = 0;
  let refreshes = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const grant = params.get('grant_type');
      res.setHeader('Content-Type', 'application/json');
      if (grant === 'authorization_code') {
        exchanges += 1;
        res.end(JSON.stringify({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }));
      } else if (grant === 'refresh_token') {
        refreshes += 1;
        if (params.get('refresh_token') === 'DEAD') {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.end(
          JSON.stringify({ access_token: `AT${refreshes + 1}`, refresh_token: `RT${refreshes + 1}`, expires_in: 3600 }),
        );
      } else {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'bad grant' }));
      }
    });
  });
  return { server, counts: () => ({ exchanges, refreshes }) };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('auth bridge', () => {
  const provider = mockProvider();
  const backingStore = createStore();
  const defer = () => new Promise<void>((resolve) => setImmediate(resolve));
  const store: Store = {
    getSession: async (id) => {
      await defer();
      return backingStore.getSession(id);
    },
    putSession: async (id, record) => {
      await defer();
      await backingStore.putSession(id, record);
    },
    deleteSession: async (id) => {
      await defer();
      await backingStore.deleteSession(id);
    },
    putPending: async (state, record) => {
      await defer();
      await backingStore.putPending(state, record);
    },
    takePending: async (state) => {
      await defer();
      return backingStore.takePending(state);
    },
    prunePending: async (ttlMs) => {
      await defer();
      await backingStore.prunePending(ttlMs);
    },
  };
  let bridgeUrl = '';
  let bridge: Server;
  let activationPhase: 'start' | 'token' | null = null;

  beforeAll(async () => {
    const providerUrl = await listen(provider.server);
    // Bind once to discover a free port, close fully, then start the real
    // bridge on that port so baseUrl matches what it listens on.
    const probe = createServer();
    const probeUrl = await listen(probe);
    const port = Number(new URL(probeUrl).port);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    bridgeUrl = `http://127.0.0.1:${port}`;
    bridge = createBridgeServer({
      baseUrl: bridgeUrl,
      providers: loadProviders({
        WHOOP_CLIENT_ID: 'cid',
        WHOOP_CLIENT_SECRET: 'sec',
        WHOOP_AUTH_URL: `${providerUrl}/auth`,
        WHOOP_TOKEN_URL: `${providerUrl}/token`,
      }),
      store,
      authorizeSession: async ({ phase, session: sessionId }) => {
        await defer();
        return phase === activationPhase
          ? {
              authorized: false,
              error: 'Activate this bridge connection',
              activationUrl: `https://accounts.example.com/activate?session=${sessionId}`,
            }
          : { authorized: true };
      },
    });
    await new Promise<void>((resolve) => {
      bridge.listen(port, '127.0.0.1', () => resolve());
    });
  });

  afterAll(() => {
    bridge.close();
    provider.server.close();
  });

  let session = '';
  let state = '';

  it('lists configured providers and reports health', async () => {
    const health = await fetch(`${bridgeUrl}/healthz`).then((r) => r.json());
    expect(health).toEqual({ ok: true });
    const providers = await fetch(`${bridgeUrl}/v1/providers`).then((r) => r.json());
    expect(providers).toEqual({ providers: ['whoop'] });
  });

  it('supports a provider-neutral activation requirement before OAuth', async () => {
    activationPhase = 'start';
    const res = await fetch(`${bridgeUrl}/v1/auth/whoop/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensionRedirect: EXT_REDIRECT }),
    });
    activationPhase = null;
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('activation_required');
    expect(body.error).toBe('Activate this bridge connection');
    expect(String(body.activationUrl)).toMatch(/^https:\/\/accounts\.example\.com\/activate\?session=/);
  });

  it('starts a flow with a bound state and session', async () => {
    const res = await fetch(`${bridgeUrl}/v1/auth/whoop/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensionRedirect: EXT_REDIRECT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authUrl: string; session: string };
    session = body.session;
    expect(session.length).toBeGreaterThan(30);
    const authUrl = new URL(body.authUrl);
    expect(authUrl.searchParams.get('client_id')).toBe('cid');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(`${bridgeUrl}/v1/auth/whoop/callback`);
    state = authUrl.searchParams.get('state') ?? '';
    expect(state).not.toBe('');
  });

  it('rejects redirects that are not extension auth windows', async () => {
    const res = await fetch(`${bridgeUrl}/v1/auth/whoop/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensionRedirect: 'https://evil.example.com/' }),
    });
    expect(res.status).toBe(400);
  });

  it('exchanges the code on callback and redirects back to the extension', async () => {
    const res = await fetch(
      `${bridgeUrl}/v1/auth/whoop/callback?code=c1&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(EXT_REDIRECT);
    expect(location.searchParams.get('bridge')).toBe('ok');
    expect(location.searchParams.get('session')).toBe(session);
    expect(provider.counts().exchanges).toBe(1);
  });

  it('can require activation before issuing an access token', async () => {
    activationPhase = 'token';
    const res = await fetch(`${bridgeUrl}/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    activationPhase = null;
    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('activation_required');
    expect(String(body.activationUrl)).toContain(encodeURIComponent(session));
    expect(await store.getSession(session)).toBeDefined();
  });

  it('rejects a replayed state', async () => {
    const res = await fetch(
      `${bridgeUrl}/v1/auth/whoop/callback?code=c2&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(400);
  });

  it('serves cached access tokens without refreshing', async () => {
    const res = await fetch(`${bridgeUrl}/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; provider: string };
    expect(body.accessToken).toBe('AT1');
    expect(body.provider).toBe('whoop');
    expect(provider.counts().refreshes).toBe(0);
  });

  it('refreshes upstream when the cached token expires and rotates the refresh token', async () => {
    const record = (await store.getSession(session))!;
    await store.putSession(session, { ...record, accessExpiresAt: Date.now() - 1 });
    const body = (await (
      await fetch(`${bridgeUrl}/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      })
    ).json()) as { accessToken: string };
    expect(body.accessToken).toBe('AT2');
    expect(provider.counts().refreshes).toBe(1);
    expect((await store.getSession(session))!.refreshToken).toBe('RT2');
  });

  it('deletes the session when the provider rejects the refresh', async () => {
    const record = (await store.getSession(session))!;
    await store.putSession(session, {
      ...record,
      refreshToken: 'DEAD',
      accessExpiresAt: Date.now() - 1,
    });
    const res = await fetch(`${bridgeUrl}/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    expect(res.status).toBe(401);
    expect(await store.getSession(session)).toBeUndefined();
  });

  it('disconnect is idempotent and unknown sessions 404', async () => {
    const res = await fetch(`${bridgeUrl}/v1/session`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    expect(res.status).toBe(200);
    const token = await fetch(`${bridgeUrl}/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    expect(token.status).toBe(404);
  });
});

describe('isAllowedExtensionRedirect', () => {
  it('accepts chromiumapp.org and localhost only', () => {
    expect(isAllowedExtensionRedirect(EXT_REDIRECT)).toBe(true);
    expect(isAllowedExtensionRedirect('http://localhost:5173/')).toBe(true);
    expect(isAllowedExtensionRedirect('https://evil.example.com/')).toBe(false);
    expect(isAllowedExtensionRedirect(`https://${'a'.repeat(32)}.chromiumapp.org.evil.com/`)).toBe(false);
    expect(isAllowedExtensionRedirect('')).toBe(false);
  });
});

describe('extension bridge client (pure parts)', () => {
  it('normalizes bridge URLs and rejects insecure ones', () => {
    expect(normalizeBridgeUrl('https://bridge.example.com/')).toBe('https://bridge.example.com');
    expect(normalizeBridgeUrl('https://bridge.example.com/base/')).toBe('https://bridge.example.com/base');
    expect(normalizeBridgeUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(() => normalizeBridgeUrl('http://bridge.example.com')).toThrow(/https/);
    expect(() => normalizeBridgeUrl('not a url')).toThrow();
  });

  it('accepts only a matching ok callback', () => {
    const ok = new URL(`${EXT_REDIRECT}?bridge=ok&session=s1`);
    expect(parseBridgeCallback(ok, 's1')).toEqual({ ok: true });
    const wrongSession = parseBridgeCallback(ok, 'other');
    expect(wrongSession.ok).toBe(false);
    const error = parseBridgeCallback(new URL(`${EXT_REDIRECT}?bridge=error&message=denied`), 's1');
    expect(error).toEqual({ ok: false, error: 'denied' });
    const missing = parseBridgeCallback(new URL(EXT_REDIRECT), 's1');
    expect(missing.ok).toBe(false);
  });

  it('parses only safe activation-required responses', () => {
    const activation = parseBridgeActivationRequired({
      code: 'activation_required',
      error: 'Choose a plan',
      activationUrl: 'https://accounts.example.com/activate',
    });
    expect(activation?.message).toBe('Choose a plan');
    expect(activation?.activationUrl).toBe('https://accounts.example.com/activate');
    expect(
      parseBridgeActivationRequired({
        code: 'activation_required',
        activationUrl: 'javascript:alert(1)',
      }),
    ).toBeNull();
  });
});
