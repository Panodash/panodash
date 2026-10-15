# Editions and deployment modes

Panodash ships as one open-source Chrome extension. Paid hosting sells operation and token custody, not exclusive widgets or dashboard features.

| Mode | What runs | Cost and trust boundary |
| --- | --- | --- |
| Extension only | `apps/extension` in the user's browser | Free; public APIs, local credentials, custom endpoints, and browser-compatible OAuth |
| Extension + self-hosted bridge | extension plus `apps/bridge` on infrastructure chosen by the user | Free software; operator supplies hosting and provider applications |
| Extension + third-party bridge | extension plus a disclosed community or commercial operator | Terms, price, and token custody are set by that operator |
| Extension + Panodash hosted bridge | the unchanged extension plus a Panodash-operated bridge URL | Paid convenience for provider registrations, uptime, API costs, and secure token custody |

All modes keep metric payloads in the extension. A bridge handles OAuth credentials and token exchange, not dashboard data. The extension must treat every bridge as a user-selected URL and must not grant the Panodash-hosted service privileged behavior.

## Open-core commitment

The reference bridge, protocol, conformance tests, provider adapters, extension client, storage interface, and generic activation mechanism remain open source. Billing, account management, production database and encryption adapters, infrastructure, provider contracts, and administrative operations may live in private service repositories. See [hosted-bridge.md](hosted-bridge.md) for the complete boundary.

Any future paid feature must be deliverable through the public protocol and remain usable with an independently operated bridge. Changes to hosted-service data handling must be documented here and in [hosted-service-privacy.md](hosted-service-privacy.md) before release.
