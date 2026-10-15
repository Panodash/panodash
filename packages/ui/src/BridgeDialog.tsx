import { useState } from 'react';
import { bridgeProviders, normalizeBridgeUrl } from '@panodash/core/bridge';

/**
 * Configure the optional auth bridge. Saving verifies the URL actually
 * speaks the bridge protocol, requests host permission for its origin
 * (inside this click gesture), and states the trust trade plainly.
 */
export function BridgeDialog({
  current,
  onSave,
  onClose,
}: {
  current?: string;
  onSave: (bridgeUrl: string | undefined) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const url = normalizeBridgeUrl(draft);
      if (typeof chrome !== 'undefined' && chrome.permissions) {
        const origin = `${new URL(url).origin}/*`;
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) throw new Error('Permission to reach the bridge was declined');
      }
      const providers = await bridgeProviders(url);
      onSave(url);
      window.alert(
        `Bridge saved. It offers: ${providers.length > 0 ? providers.join(', ') : 'no providers yet'}.`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Auth bridge">
        <div className="dialog-header">
          <h2>Auth bridge</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="share-note">
          A bridge lets OAuth widgets (WHOOP, Withings) connect <em>without</em> registering your
          own developer app. The trade: the bridge's operator holds that connection's refresh
          token. Your metrics never pass through it — data still flows directly from the provider
          to this extension. Anyone can self-host one: see <code>docs/self-hosting.md</code>.
        </p>
        <div className="form-field">
          <label htmlFor="bridge-url">Bridge URL</label>
          <input
            id="bridge-url"
            type="url"
            value={draft}
            placeholder="https://bridge.example.com"
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
          />
          <p className="form-help">Leave empty and save to disconnect from the bridge.</p>
        </div>
        {error && <p className="import-error">{error}</p>}
        <div className="dialog-actions">
          {current && (
            <button
              type="button"
              className="button-ghost"
              onClick={() => {
                onSave(undefined);
                onClose();
              }}
            >
              Remove bridge
            </button>
          )}
          <button
            type="button"
            className="button-primary"
            disabled={busy || draft.trim() === ''}
            onClick={() => void save()}
          >
            {busy ? 'Checking…' : 'Verify & save'}
          </button>
        </div>
      </div>
    </div>
  );
}
