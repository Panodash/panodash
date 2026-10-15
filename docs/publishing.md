# Publishing

## Prepare a release

1. Update the version in the root `package.json`, `apps/extension/package.json`, and `apps/extension/public/manifest.json`.
2. Move user-visible changes from the Unreleased section of `CHANGELOG.md` into a dated version section.
3. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
4. Load `apps/extension/dist` as an unpacked extension and smoke-test the new-tab page, widget creation, editing, permissions, and theme controls.
5. Review `store/description.md`, `store/privacy-disclosures.md`, screenshots, and the privacy policy for accuracy.

## GitHub release

Create and push an annotated tag matching the version, for example `v0.7.1`. `.github/workflows/release.yml` rebuilds the extension, creates a zip from the contents of `apps/extension/dist`, and attaches it to a GitHub release.

## Chrome Web Store

The `Publish Chrome` workflow is manually dispatched. Configure these protected repository secrets:

- `CHROME_EXTENSION_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

The workflow rebuilds from the selected commit, uploads the zip, and publishes it. Use a protected GitHub environment named `chrome-web-store` if publication requires approval. Never upload a locally modified build that did not pass the same checks.
