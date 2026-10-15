# `@panodash/bridge-core`

Provider-neutral OAuth bridge protocol and provider adapters for
Panodash-compatible bridges.

The package contains the reusable HTTP server, protocol validation, WHOOP and
Withings adapters, and asynchronous storage and authorization contracts. It
does not include billing, user accounts, infrastructure, or a production
database.

## Install

```bash
npm install @panodash/bridge-core
```

Node.js 22 or newer is required.

## Use

```ts
import {
  createBridgeServer,
  loadProviders,
  type Store,
} from '@panodash/bridge-core';

const providers = loadProviders(process.env);
const store: Store = createYourStore();

createBridgeServer({
  baseUrl: 'https://bridge.example.com',
  providers,
  store,
}).listen(8787);
```

`Store` is asynchronous so operators can use Postgres or another durable
database. Refresh tokens are sensitive credentials; production adapters should
encrypt them at the application layer and keep encryption keys outside the
database.

Hosted operators can inject an authorization policy:

```ts
createBridgeServer({
  baseUrl,
  providers,
  store,
  authorizeSession: async ({ phase, provider, session }) => {
    const activationUrl = await authorize({ phase, provider, session });
    return activationUrl
      ? { authorized: false, activationUrl }
      : { authorized: true };
  },
});
```

Authorization policies return a promise so hosted implementations can query
accounts, entitlements, or another external policy service without blocking
the bridge runtime.

The complete file-backed reference application is available in
[`apps/bridge`](https://github.com/panodash/panodash/tree/main/apps/bridge).
The protocol is documented in
[`docs/bridge-protocol.md`](https://github.com/panodash/panodash/blob/main/docs/bridge-protocol.md).

## License

MIT
