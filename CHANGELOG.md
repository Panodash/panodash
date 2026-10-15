# Changelog

## Unreleased

- Extracted the reusable OAuth bridge server, provider adapters, and asynchronous storage and authorization contracts into the publishable `@panodash/bridge-core` package.
- Added a Data sources section to the dashboard menu for inspecting, adding, replacing, and removing stored credentials.
- Added management of per-widget OAuth authorizations and bridge sessions, including credentials stranded by a removed widget.
- Added first-class GitLab support with a shared local personal access token.
- Added GitLab stars, review queue, branch health, personal merge requests, milestones, pipeline failures, issue triage, release assets, first-time contributors, merge-request cycle time, and to-do widgets.
- Added GitLab.com and self-managed GitLab project URL support, including nested group paths.

Notable changes to Panodash are documented here. This project follows semantic versioning where practical.

## Unreleased

### Added

- Added first-class GitHub stars, review queue, and branch health widgets with a shared local connection.
- Added ambient age and build-state signals for GitHub attention metrics.
- Added a personal GitHub PR widget with weekly merge momentum, first-review wait, and configurable size warnings.
- Added a GitHub milestone progress widget with in-tile selection and ambient due-date signals.
- Added a GitHub Actions failure feed with configurable branch, lookback window, and direct run links.
- Added a GitHub issue triage widget comparing open and unassigned issues, with oldest-first ownerless work.
- Added a GitHub release download widget with stable/prerelease selection and per-asset adoption counts.
- Added a GitHub first-time contributor queue with oldest-first welcome signals and optional draft inclusion.
- Added a GitHub PR cycle-time widget with average, median, P90, and configurable friction thresholds.
- Added a GitHub unread notifications widget with focused attention, participating, and all-unread scopes.
- Added a provider-neutral `activation_required` bridge response and optional `authorizeSession` hook for hosted operators.
- Documented the bridge v1 compatibility contract, open/private hosted-service boundary, and a pre-launch hosted privacy notice template.

### Changed

- Reorganized the repository as npm workspaces with separate extension, bridge, core, widget SDK, provider, and UI boundaries.
- Added publishing, self-hosting, privacy, governance, store, and contributor documentation.
- Added CI, GitHub release, and Chrome Web Store publishing workflows.

## 0.7.1

### Changed

- Refreshed the brand palette around Bone, Ember, Signal, Ultramarine, and Ink.
- Added root-level palette controls, an on-page version label, compact tile menu overflow handling, and caret suppression for non-editable surfaces.
