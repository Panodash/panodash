# Contributing to Panodash

Thanks for helping make personal metrics more useful without making them less private.

## Before you start

Use an issue for large features, new data-handling behavior, or architecture changes. Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public issue. Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Development setup

Use Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Before submitting a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

The production extension is written to `apps/extension/dist` and can be loaded from Chrome's Extensions page with Developer mode enabled.

## Where changes belong

- `apps/extension`: Chrome entry points, manifest, service worker, and application composition.
- `apps/bridge`: the independently deployable confidential-OAuth service.
- `packages/widget-sdk`: stable public types and provider registration only.
- `packages/core`: storage, history, calculations, scheduling, and protocol clients.
- `packages/ui`: reusable provider-neutral presentation.
- `packages/providers`: built-in provider adapters and tiles.

Keep dependencies pointed toward the SDK and core. Shared packages must not import from `apps/extension`.

## Adding a built-in provider

1. Implement a `WidgetProvider` under `packages/providers/src` using exports from `@panodash/widget-sdk`.
2. Convert remote data into canonical snapshots. Keep provider response shapes inside the adapter.
3. Put reusable parsing or calculations in `@panodash/core` and reusable provider-neutral controls in `@panodash/ui`.
4. Register the provider in `packages/providers/src/index.ts`.
5. Add unit tests for parsing, validation, error handling, and any calculations.
6. Document permissions, credentials, OAuth behavior, and privacy impact.

Never commit credentials, refresh tokens, exported personal history, or production bridge stores.

## Pull requests

Keep changes focused and explain user-visible behavior, privacy impact, and verification. Update `CHANGELOG.md` for notable changes. Screenshots are expected for interface changes. By contributing, you agree that your contribution is licensed under the repository's MIT License.
