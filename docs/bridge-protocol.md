# Bridge protocol v1

This document is the compatibility contract between the Panodash extension and any OAuth bridge. A self-hosted or third-party implementation that follows this contract can be used without a special extension build. `tests/bridge.test.ts` is the executable conformance suite for the reference implementation.

All responses are JSON unless an OAuth callback redirects to the extension. JSON responses must use `Cache-Control: no-store`. Production bridge and activation URLs must use HTTPS; localhost HTTP is permitted for development.

## Endpoints

| Endpoint | Successful response |
| --- | --- |
| `GET /healthz` | `200 { "ok": true }` |
| `GET /v1/providers` | `200 { "providers": ["provider-id"] }` |
| `POST /v1/auth/:provider/start` | `200 { "authUrl": "...", "session": "..." }` |
| `GET /v1/auth/:provider/callback` | `302` to the bound extension redirect with `bridge=ok&session=...` or `bridge=error&message=...` |
| `POST /v1/token` | `200 { "accessToken": "...", "expiresAt": 0, "provider": "..." }` |
| `DELETE /v1/session` | `200 { "ok": true }` |

`POST /v1/auth/:provider/start` accepts `{ "extensionRedirect": "..." }`. Redirects must be a Chrome identity URL under `*.chromiumapp.org`, or localhost during development. `POST /v1/token` and `DELETE /v1/session` accept `{ "session": "..." }`.

Session handles are bearer credentials. Implementations must generate high-entropy, unguessable values, avoid logging them, and return `401`, `404`, or `410` when the extension must discard a connection.

## Optional activation response

A bridge may require operator-neutral account activation before starting OAuth or issuing a token. Either `POST /v1/auth/:provider/start` or `POST /v1/token` may return:

```json
{
  "error": "This bridge requires activation",
  "code": "activation_required",
  "activationUrl": "https://bridge.example.com/activate"
}
```

Use HTTP `402`. The extension renders the message and activation link generically; it does not interpret plans, prices, billing providers, or entitlement state. After activation, the user retries the connection or refresh. Any bridge operator, including a nonprofit or cost-sharing cooperative, may use the same response.

The reference server exposes an optional `authorizeSession` hook for this decision. Without the hook, every valid session is authorized and the self-hosted behavior is unchanged.

## Compatibility policy

Fields may be added to v1 responses. Clients must ignore unknown fields. Removing or changing existing fields, status semantics, redirect validation, or token-custody behavior requires a new protocol version. Built-in provider OAuth adapters and the extension client remain open source and must not special-case a Panodash-operated bridge.
