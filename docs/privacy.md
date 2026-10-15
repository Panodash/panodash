# Privacy

Panodash is designed around data minimization: it has no Panodash account, analytics pipeline, or hosted metrics database.

## Data stored locally

The extension may store the following in Chrome's local extension storage:

- dashboard layout, theme, and widget settings;
- provider URLs, tokens, or credentials entered by the user;
- current metric snapshots and bounded history;
- optional OAuth bridge URL and opaque session handles.

This data remains in the browser profile unless the user exports it, shares a sanitized dashboard, or Chrome synchronizes the profile independently of Panodash. Removing the extension normally removes its extension storage; users can also remove widgets or clear data from the dashboard.

## Managing stored credentials

The dashboard's ⋯ menu lists every credential the extension holds under **Data sources**: shared provider tokens, per-widget OAuth authorizations, and bridge sessions. Each can be supplied, replaced, or removed there, and removing one deletes it from extension storage immediately.

That surface never displays a saved secret. It shows only a masked tail and the date it was stored — enough to tell two tokens apart, not enough to reuse one. Credentials are stored outside the settings object, so a dashboard export does not contain them and cannot restore one that has been removed; revoking the token at the provider remains a separate step the user performs there.

## Network activity

Panodash contacts only services needed by configured widgets, such as provider APIs, custom endpoints, weather services, or a bridge selected by the user. Optional host permissions are requested in response to user configuration. Panodash does not sell data, use it for advertising, or combine it into an operator-controlled profile.

## OAuth bridge

The optional bridge stores OAuth refresh tokens and provider client secrets. It returns short-lived access tokens; it does not proxy metric responses. A bridge operator can nevertheless mint tokens for stored sessions, so users should trust the operator or self-host. Deleting a bridge session removes its stored refresh token.

A paid or community bridge may require activation using a link supplied by that operator. Its account, billing, retention, and subprocessor practices are governed by the operator's privacy notice. The draft disclosure for a future Panodash-hosted service is maintained separately in [hosted-service-privacy.md](hosted-service-privacy.md).

## Exports and sharing

Exports can contain personal metric history and should be handled as sensitive files. Share payloads are sanitized to exclude known credential fields, but users should review custom widget configuration before publishing it.

## Permissions

`storage` persists the dashboard, `alarms` schedules refreshes, and `identity` completes OAuth redirects. Default host permissions cover bundled weather services. Broader HTTP or HTTPS origins are optional and requested only when a user configures a provider requiring them.

For the store-facing declaration, see [../store/privacy-disclosures.md](../store/privacy-disclosures.md). Security reports belong through the process in [../SECURITY.md](../SECURITY.md).
