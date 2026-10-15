# Chrome Web Store privacy disclosures

This document is the source of truth for completing store privacy fields. Revalidate it whenever permissions, providers, or data flows change.

## Single purpose

Panodash replaces the new-tab page with a configurable personal metrics dashboard and stores the dashboard's configuration and history locally.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `storage` | Saves widget configuration, layout, settings, snapshots, and history locally. |
| `alarms` | Schedules widget refreshes while new-tab pages are closed. |
| `identity` | Completes OAuth redirect flows initiated by the user. |
| Open-Meteo host origins | Fetches weather and geocoding for the built-in weather widget. |
| Optional HTTP/HTTPS origins | Requested only for a provider, bridge, or custom endpoint configured by the user. |

## Data handling declarations

Panodash may handle website authentication information, user-provided configuration, location entered for weather, and health or financial metrics returned by configured providers. These data are used only to provide the configured dashboard feature.

Panodash does not sell user data, use it for personalized advertising, transfer it for unrelated purposes, or use it for creditworthiness or lending. The project does not operate a server that receives dashboard metric payloads. Data may be sent to a service explicitly selected by the user, such as the relevant provider API or optional OAuth bridge for token exchange.

## Remote code

The extension does not execute remotely hosted code. Provider responses are treated as data.

## Review checklist

- Confirm the production manifest matches every permission listed above.
- Confirm the public privacy-policy URL renders `docs/privacy.md` content.
- Confirm screenshots contain no real personal data or credentials.
- Confirm no analytics, telemetry, or new backend data flow was added.
- Revisit the store's data-use questionnaire for each new provider category.
