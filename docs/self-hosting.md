# Self-hosting the OAuth bridge

The bridge is needed only for providers that require a confidential OAuth
client. It is intentionally independent of the extension. The reference
application uses the dependency-free `@panodash/bridge-core` package.

## Requirements

- Node.js 24 or newer, or Docker;
- a public HTTPS origin;
- OAuth applications registered with each provider;
- durable private storage if sessions must survive restarts.

## Local run

From the repository root:

```bash
npm ci
WHOOP_CLIENT_ID=... WHOOP_CLIENT_SECRET=... npm run bridge
```

Set `BRIDGE_BASE_URL` to the public origin in production. Use `BRIDGE_STORE_FILE` for a persistent JSON store; the file contains refresh tokens and should live on an encrypted volume with access limited to the bridge process.

## Docker

```bash
docker build -f apps/bridge/Dockerfile -t panodash-bridge .
docker run --restart unless-stopped -p 8787:8787 \
  -e BRIDGE_BASE_URL=https://bridge.example.com \
  -e BRIDGE_STORE_FILE=/data/sessions.json \
  -e WHOOP_CLIENT_ID=... \
  -e WHOOP_CLIENT_SECRET=... \
  -v panodash-bridge-data:/data \
  panodash-bridge
```

Terminate TLS at a reverse proxy, forward only to the bridge's private port, and monitor `GET /healthz`. Back up the session store as a secret. Rotating provider client secrets does not remove stored refresh tokens; revoking a provider app or deleting the store invalidates connections.

Provider-specific variables and endpoints are listed in [../apps/bridge/README.md](../apps/bridge/README.md).
