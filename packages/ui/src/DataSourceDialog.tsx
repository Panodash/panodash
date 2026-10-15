import { useCallback, useEffect, useState } from 'react';
import type { WidgetInstance } from '@panodash/widget-sdk';
import { allProviders } from '@panodash/widget-sdk/registry';
import {
  collectAccountConnections,
  collectDataSources,
  type AccountConnection,
  type DataSourceEntry,
} from '@panodash/core/dataSources';
import {
  listConnectionMeta,
  removeLocalConnection,
  saveLocalConnection,
} from '@panodash/core/connections';
import { clearTokens, listOAuthWidgetIds } from '@panodash/core/oauth';
import { disconnectBridge, listBridgeConnections } from '@panodash/core/bridge';
import { timeAgo } from '@panodash/core/format';

/**
 * Manage every credential Panodash holds, in one place.
 *
 * Shared connections can be added, replaced, and removed here — the same
 * secrets the add/edit widget dialog writes, but reachable without owning a
 * widget yet. Account connections (OAuth, bridge) are consent-flow results,
 * so they are shown read-only with a disconnect: reconnecting is the widget's
 * job. Saved secrets are never rendered back — only a masked tail.
 */
export function DataSourceDialog({
  widgets,
  bridgeUrl,
  onOpenBridge,
  onConnectionsChanged,
  onClose,
}: {
  widgets: WidgetInstance[];
  bridgeUrl?: string;
  onOpenBridge: () => void;
  /** Widgets whose credentials changed — the caller refetches them. */
  onConnectionsChanged: (widgetIds: string[]) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<DataSourceEntry[] | null>(null);
  const [accounts, setAccounts] = useState<AccountConnection[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const providers = allProviders();
    const [stored, oauthWidgetIds, bridgeRecords] = await Promise.all([
      listConnectionMeta(),
      listOAuthWidgetIds(),
      listBridgeConnections(),
    ]);
    setEntries(collectDataSources(providers, widgets, stored));
    setAccounts(collectAccountConnections(providers, widgets, oauthWidgetIds, bridgeRecords));
  }, [widgets]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEditing(id: string) {
    setEditing(id);
    setDraft('');
    setError(null);
  }

  async function run(action: () => Promise<void>, affected: string[]) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onConnectionsChanged(affected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function saveEntry(entry: DataSourceEntry) {
    void run(async () => {
      await saveLocalConnection(entry.id, draft);
      setEditing(null);
      setDraft('');
    }, entry.usedBy.map((usage) => usage.widgetId));
  }

  function removeEntry(entry: DataSourceEntry) {
    const dependents = entry.usedBy.filter((usage) => usage.required);
    const warning = dependents.length
      ? `\n\n${dependents.length} widget${dependents.length === 1 ? '' : 's'} require it and will stop updating: ${dependents
          .map((usage) => usage.title)
          .join(', ')}.`
      : '';
    if (!window.confirm(`Remove the saved ${entry.name} credential from this browser?${warning}`)) {
      return;
    }
    void run(async () => {
      await removeLocalConnection(entry.id);
      setEditing(null);
    }, entry.usedBy.map((usage) => usage.widgetId));
  }

  function disconnectAccount(account: AccountConnection) {
    if (
      !window.confirm(
        `Disconnect ${account.title}? The widget stays on your dashboard and can reconnect from its tile.`,
      )
    ) {
      return;
    }
    void run(async () => {
      await clearTokens(account.widgetId);
      await disconnectBridge(account.widgetId);
    }, [account.widgetId]);
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-label="Data sources">
        <div className="dialog-header">
          <h2>Data sources</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="share-note">
          Every credential Panodash holds, stored in this browser only. Saved secrets are never
          shown again — just enough to recognise which one is in place.
        </p>

        {error && <p className="import-error">{error}</p>}

        <div className="dialog-body">
          <section className="data-source-section">
            <h3>Shared connections</h3>
            <p className="form-help">
              One credential per service, reused by every widget of that family.
            </p>
            {entries === null ? (
              <p className="data-source-empty">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="data-source-empty">No provider on this build uses a shared credential.</p>
            ) : (
              <ul className="data-source-list">
                {entries.map((entry) => (
                  <li key={entry.id} className="data-source-row">
                    <div className="data-source-head">
                      <span className="data-source-name">{entry.name}</span>
                      <span
                        className={`data-source-status${entry.connected ? ' connected' : ''}`}
                      >
                        {entry.orphaned
                          ? 'Unused credential'
                          : entry.connected
                            ? 'Connected'
                            : 'Not connected'}
                      </span>
                    </div>

                    <p className="data-source-meta">
                      {entry.connected && (
                        <>
                          <code>{entry.hint}</code>
                          {entry.updatedAt !== undefined && ` · updated ${timeAgo(entry.updatedAt)}`}
                          {' · '}
                        </>
                      )}
                      {entry.orphaned
                        ? 'No installed provider claims this credential — safe to remove.'
                        : entry.usedBy.length === 0
                          ? 'Not used by any widget yet.'
                          : `Used by ${entry.usedBy.map((usage) => usage.title).join(', ')}.`}
                    </p>

                    {!entry.orphaned && entry.help && !entry.connected && (
                      <p className="form-help">{entry.help}</p>
                    )}

                    {editing === entry.id ? (
                      <div className="form-field data-source-edit">
                        <label htmlFor={`data-source-${entry.id}`}>{entry.secretLabel}</label>
                        <input
                          id={`data-source-${entry.id}`}
                          type="password"
                          value={draft}
                          placeholder={entry.placeholder}
                          autoComplete="off"
                          autoFocus
                          onChange={(e) => setDraft(e.target.value)}
                        />
                        <div className="data-source-actions">
                          <button
                            type="button"
                            className="button-small"
                            onClick={() => {
                              setEditing(null);
                              setDraft('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="button-primary button-small"
                            disabled={busy || draft.trim() === ''}
                            onClick={() => saveEntry(entry)}
                          >
                            {entry.connected ? 'Replace' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="data-source-actions">
                        {!entry.orphaned && (
                          <button
                            type="button"
                            className="button-small"
                            disabled={busy}
                            onClick={() => startEditing(entry.id)}
                          >
                            {entry.connected ? 'Replace token' : 'Add token'}
                          </button>
                        )}
                        {entry.connected && (
                          <button
                            type="button"
                            className="button-small danger"
                            disabled={busy}
                            onClick={() => removeEntry(entry)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="data-source-section">
            <h3>Account connections</h3>
            <p className="form-help">
              Per-widget authorizations from an OAuth consent flow. Reconnect from the widget
              itself.
            </p>
            {accounts.length === 0 ? (
              <p className="data-source-empty">No widget has completed a consent flow.</p>
            ) : (
              <ul className="data-source-list">
                {accounts.map((account) => (
                  <li key={account.widgetId} className="data-source-row">
                    <div className="data-source-head">
                      <span className="data-source-name">{account.title}</span>
                      <span className="data-source-status connected">
                        {account.kinds.includes('bridge') ? 'Via bridge' : 'Connected'}
                      </span>
                    </div>
                    <p className="data-source-meta">
                      {account.installed
                        ? account.providerName
                        : 'The widget is gone; this authorization outlived it.'}
                      {account.bridgeUrl && ` · ${account.bridgeProvider} at ${account.bridgeUrl}`}
                    </p>
                    <div className="data-source-actions">
                      <button
                        type="button"
                        className="button-small danger"
                        disabled={busy}
                        onClick={() => disconnectAccount(account)}
                      >
                        {account.installed ? 'Disconnect' : 'Remove credential'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="data-source-section">
            <h3>Auth bridge</h3>
            <p className="form-help">
              An optional service that holds confidential OAuth credentials so you don't have to
              register your own developer app.
            </p>
            <p className="data-source-meta">
              {bridgeUrl ? <code>{bridgeUrl}</code> : 'No bridge configured — fully local.'}
            </p>
            <div className="data-source-actions">
              <button type="button" className="button-small" onClick={onOpenBridge}>
                {bridgeUrl ? 'Change bridge…' : 'Set up a bridge…'}
              </button>
            </div>
          </section>
        </div>

        <div className="dialog-actions">
          <button type="button" className="button-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
