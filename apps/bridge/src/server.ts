/**
 * Panodash reference OAuth bridge.
 *
 * The reusable protocol and provider implementation lives in
 * `@panodash/bridge-core`; this entry point only wires environment
 * configuration to the reference JSON store.
 */
import {
  createBridgeServer,
  loadProviders,
} from '@panodash/bridge-core';
import { createStore } from './store.ts';

const port = Number(process.env.PORT) || 8787;
const baseUrl = process.env.BRIDGE_BASE_URL ?? `http://localhost:${port}`;
const providers = loadProviders(process.env);
const store = createStore(process.env.BRIDGE_STORE_FILE);

if (providers.size === 0) {
  console.error(
    'No providers configured. Set e.g. WHOOP_CLIENT_ID + WHOOP_CLIENT_SECRET (see apps/bridge/README.md).',
  );
  process.exit(1);
}

createBridgeServer({ baseUrl, providers, store }).listen(port, () => {
  console.log(`Panodash auth bridge on ${baseUrl} (providers: ${[...providers.keys()].join(', ')})`);
});
