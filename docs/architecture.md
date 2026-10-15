# Architecture

Panodash is a local-first Chrome extension with an optional, independently deployed OAuth bridge. The monorepo separates platform code, public contracts, built-in integrations, and reusable interface components so each can evolve without making the extension entry point a dependency hub.

## Workspace boundaries

| Workspace | Responsibility | May depend on |
| --- | --- | --- |
| `apps/extension` | Manifest V3 entry points, new-tab composition, service worker, static assets | all packages |
| `apps/bridge` | Reference bridge environment and JSON session store | bridge core |
| `packages/bridge-core` | OAuth bridge protocol, provider adapters, storage and authorization contracts | Node.js only |
| `packages/widget-sdk` | Stable provider types, configuration schema, registry | React types |
| `packages/core` | snapshots, history, storage, fetch scheduling, calculations, OAuth clients | widget SDK |
| `packages/ui` | reusable dashboard dialogs, tiles, charts, controls | core, widget SDK |
| `packages/providers` | built-in API adapters and provider-specific tile renderers | core, UI, widget SDK |

The SDK is the lowest-level product contract. Code in `packages/widget-sdk` must not import the extension, a built-in provider, or core storage. `apps/extension` owns composition and runtime entry points; shared packages must remain unaware of Chrome page layout.

## Extension runtime

`apps/extension/index.html` starts the React new-tab application. The application loads widget configuration and snapshots from `chrome.storage.local`, registers the built-in providers, and renders the dashboard with shared UI components.

The Manifest V3 service worker in `apps/extension/src/background` schedules refreshes and performs work that must survive the lifetime of a new-tab page. Provider adapters return canonical snapshots rather than exposing remote response shapes to the rest of the system.

```text
provider API -> provider adapter -> canonical snapshot -> history/storage -> UI
```

## Widget contract

A `WidgetProvider` describes:

- its stable type identifier and user-facing metadata;
- a declarative configuration schema;
- how to fetch a canonical snapshot;
- how to render its tile;
- optional validation, OAuth, and metric metadata.

Built-in providers live in `packages/providers/src` and are registered by `packages/providers/src/index.ts`. Third-party providers should depend on the public surface exported by `@panodash/widget-sdk` rather than reaching into internal source files.

## Local data model

Dashboard configuration, provider credentials supplied by the user, snapshots, and bounded history are stored locally. Core services own schema normalization and persistence. Export and sharing paths remove secret configuration before producing a portable payload.

## Credentials

Credentials live under their own storage keys, outside the settings object, so backups and shared snippets never carry them:

| Key | Scope | Origin |
| --- | --- | --- |
| `connection:<id>` | shared by every widget of one provider family | a `LocalConnectionRequirement` declared by a provider |
| `oauth:<widgetId>` | one widget | a provider consent flow |
| `bridge:<widgetId>` | one widget | a bridge session handle |

`packages/core/src/dataSources.ts` assembles a provider-neutral view of all three from the registered providers, the installed widgets, and what storage holds. It is pure, so the shaping rules — which widgets depend on a credential, which saved secrets no provider claims — stay testable and DOM-free. The Data sources dialog in `packages/ui` renders that view; it reads only masked metadata, never a stored secret.

Shared connection identifiers are declared by providers, so this surface can supply, replace, and remove a credential but cannot invent a new kind of one.

## OAuth bridge

Some providers do not permit a public browser client to hold the OAuth client
secret. `packages/bridge-core` contains the reusable, dependency-free OAuth
protocol server and provider adapters. `apps/bridge` wires it to environment
configuration and the reference JSON store. The service holds client
credentials and refresh tokens, while the extension receives short-lived
access tokens and requests metrics directly from the provider.

The bridge is a trust boundary: its operator can mint access tokens for stored sessions. It must run behind HTTPS and protect its store. See [self-hosting.md](self-hosting.md).

The extension-to-bridge contract is documented in [bridge-protocol.md](bridge-protocol.md). The reference server permits an optional, provider-neutral session authorization hook, but defaults to unrestricted self-hosted operation. Hosted billing and account systems remain outside this repository; see [hosted-bridge.md](hosted-bridge.md).

## Testing and releases

Root Vitest configuration resolves workspace aliases and runs tests under `tests/`. TypeScript validates all application and package sources in one project. Vite builds only the extension application and writes its unpacked output to `apps/extension/dist`.

Releases are tag-driven. The release workflow validates and packages the extension; Chrome Web Store publication is an explicit workflow with protected secrets. See [publishing.md](publishing.md).
