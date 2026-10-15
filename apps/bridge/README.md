# Panodash OAuth bridge

The bridge is a free, optional, self-hostable service for providers that require a confidential OAuth client. It stores provider client secrets and refresh tokens, then returns short-lived access tokens to the extension. Metric data flows directly from the provider to the extension.

## Run locally

Node.js 24 or newer is recommended.

```bash
WHOOP_CLIENT_ID=... WHOOP_CLIENT_SECRET=... npm run bridge
```

Or run the workspace directly:

```bash
npm run start --workspace @panodash/bridge
```

## Run with Docker

```bash
docker build -f apps/bridge/Dockerfile -t panodash-bridge .
docker run -p 8787:8787 \
  -e WHOOP_CLIENT_ID=... \
  -e WHOOP_CLIENT_SECRET=... \
  -e BRIDGE_BASE_URL=https://bridge.example.com \
  -e BRIDGE_STORE_FILE=/data/sessions.json \
  -v bridge-data:/data \
  panodash-bridge
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `BRIDGE_BASE_URL` | Public HTTPS origin used to construct OAuth callbacks. |
| `PORT` | HTTP listen port; defaults to `8787`. |
| `BRIDGE_STORE_FILE` | Optional JSON session store. Without it, sessions are in memory. |
| `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` | Enables WHOOP. |
| `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET` | Enables Withings. |

A provider appears in `GET /v1/providers` only when both credentials are set. See [self-hosting](../../docs/self-hosting.md) for production deployment guidance.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Liveness check. |
| `GET /v1/providers` | Lists configured providers. |
| `POST /v1/auth/:provider/start` | Starts an OAuth connection. |
| `GET /v1/auth/:provider/callback` | Completes the provider callback. |
| `POST /v1/token` | Exchanges a session handle for an access token. |
| `DELETE /v1/session` | Deletes the session and refresh token. |

Either the start or token endpoint may return HTTP `402` with
`code: "activation_required"` and an HTTPS `activationUrl`. This optional,
operator-neutral extension is specified in
[the v1 protocol](../../docs/bridge-protocol.md).

## Hosted operator seam

The reusable server and provider adapters are published as
[`@panodash/bridge-core`](../../packages/bridge-core). Its
`createBridgeServer` function accepts an optional `authorizeSession` callback. It is
called before OAuth starts and before an access token is issued. Return
`{ authorized: true }` to continue, or return an activation decision:

```ts
import { createBridgeServer } from '@panodash/bridge-core';

createBridgeServer({
  baseUrl,
  providers,
  store,
  authorizeSession: async ({ phase, provider, session }) => {
    const activationUrl = await entitlementService.authorize({ phase, provider, session });
    return activationUrl
      ? { authorized: false, activationUrl }
      : { authorized: true };
  },
});
```

The authorization callback is asynchronous so hosted operators can perform
database or entitlement-service checks before allowing a session.

Billing and account logic does not belong in the reference bridge. Without
this hook, all valid sessions are authorized exactly as before.

## Trust model

The operator can mint access tokens for sessions stored by the bridge. Run it behind HTTPS, protect the session store as a secret, restrict filesystem permissions, and disclose who operates the instance. Sessions and OAuth states use high-entropy random values; states are single-use and expire after ten minutes.
