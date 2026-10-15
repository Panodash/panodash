import { useEffect, useMemo, useState } from 'react';
import type { AuthPattern, WidgetInstance, WidgetProvider, WidgetSize } from '@panodash/widget-sdk';
import { allProviders } from '@panodash/widget-sdk/registry';
import {
  hasLocalConnection,
  removeLocalConnection,
  saveLocalConnection,
} from '@panodash/core/connections';
import { newWidgetId } from '@panodash/core/storage';
import { snippetToInstance } from '@panodash/core/share';
import { ConfigForm } from './ConfigForm';

export const SIZE_PRESETS: { label: string; size: WidgetSize }[] = [
  { label: 'Small (1×1)', size: { w: 1, h: 1 } },
  { label: 'Wide (2×1)', size: { w: 2, h: 1 } },
  { label: 'Tall (1×2)', size: { w: 1, h: 2 } },
  { label: 'Large (2×2)', size: { w: 2, h: 2 } },
  { label: 'Banner (4×1)', size: { w: 4, h: 1 } },
];

/** Honest setup-cost labels for the widget picker. */
const AUTH_LABELS: Record<AuthPattern, string | null> = {
  none: null,
  'local-token': 'API key',
  pkce: 'OAuth',
  confidential: 'OAuth · your own app',
};

type ProviderKindFilter = 'all' | WidgetProvider['kind'];

const PROVIDER_FILTERS: { value: ProviderKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'metric', label: 'Metrics' },
  { value: 'feed', label: 'Feeds' },
  { value: 'utility', label: 'Utilities' },
];

export function filterWidgetProviders(
  providers: WidgetProvider[],
  kind: ProviderKindFilter,
  query: string,
): WidgetProvider[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

  return providers.filter((provider) => {
    if (kind !== 'all' && provider.kind !== kind) return false;
    if (terms.length === 0) return true;

    const searchable = [
      provider.name,
      provider.description,
      provider.type,
      provider.kind,
      provider.auth,
      provider.connection?.name,
      ...(provider.presets?.map((preset) => preset.label) ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();

    return terms.every((term) => searchable.includes(term));
  });
}

export function sizeLabel(size: WidgetSize): string {
  return (
    SIZE_PRESETS.find((p) => p.size.w === size.w && p.size.h === size.h)?.label ??
    `${size.w}×${size.h}`
  );
}

/**
 * Add/edit dialog. Adding: pick a provider (with optional presets), then a
 * config form generated from its schema. Editing: same form, prefilled.
 * On save the caller is handed the instance; it requests any host
 * permissions (still inside the click gesture) and persists.
 */
export function WidgetDialog({
  existing,
  widgets,
  onSave,
  onClose,
}: {
  existing?: WidgetInstance;
  /** All widgets on the dashboard — source options for 'widget' fields. */
  widgets: WidgetInstance[];
  onSave: (instance: WidgetInstance) => Promise<void> | void;
  onClose: () => void;
}) {
  const providers = useMemo(() => allProviders(), []);
  const [provider, setProvider] = useState<WidgetProvider | null>(
    existing ? (providers.find((p) => p.type === existing.type) ?? null) : null,
  );
  const [config, setConfig] = useState<Record<string, unknown>>(existing?.config ?? {});
  const [title, setTitle] = useState(existing?.title ?? '');
  const [size, setSize] = useState<WidgetSize>(existing?.size ?? { w: 1, h: 1 });
  const [goalValue, setGoalValue] = useState(
    existing?.goal ? String(existing.goal.value) : '',
  );
  const [goalDirection, setGoalDirection] = useState<'at-least' | 'at-most'>(
    existing?.goal?.direction ?? 'at-least',
  );
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [connectionSecret, setConnectionSecret] = useState('');
  const [hasSavedConnection, setHasSavedConnection] = useState(false);
  const [connectionLoaded, setConnectionLoaded] = useState(true);
  const [providerFilter, setProviderFilter] = useState<ProviderKindFilter>('all');
  const [providerQuery, setProviderQuery] = useState('');

  const filteredProviders = useMemo(
    () => filterWidgetProviders(providers, providerFilter, providerQuery),
    [providers, providerFilter, providerQuery],
  );
  const providerCounts = useMemo(
    () => ({
      all: providers.length,
      metric: providers.filter((item) => item.kind === 'metric').length,
      feed: providers.filter((item) => item.kind === 'feed').length,
      utility: providers.filter((item) => item.kind === 'utility').length,
    }),
    [providers],
  );

  useEffect(() => {
    const connection = provider?.connection;
    let cancelled = false;
    setConnectionSecret('');
    if (!connection) {
      setHasSavedConnection(false);
      setConnectionLoaded(true);
      return;
    }
    setConnectionLoaded(false);
    void hasLocalConnection(connection.id).then((saved) => {
      if (cancelled) return;
      setHasSavedConnection(saved);
      setConnectionLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [provider?.connection]);

  // Metric widgets other than the one being edited — a computed metric
  // must not feed on itself.
  const widgetOptions = useMemo(
    () =>
      widgets
        .filter((w) => w.id !== existing?.id)
        .filter((w) => {
          const p = providers.find((prov) => prov.type === w.type);
          return p?.kind === 'metric';
        })
        .map((w) => {
          const p = providers.find((prov) => prov.type === w.type);
          return { value: w.id, label: w.title ?? p?.defaultTitle(w.config) ?? w.type };
        }),
    [widgets, existing?.id, providers],
  );

  function pickProvider(p: WidgetProvider) {
    setProvider(p);
    setConfig({ ...p.defaultConfig });
    setSize(p.defaultSize);
  }

  function applyPreset(preset: { config: Record<string, unknown> }) {
    setConfig((prev) => ({ ...prev, ...preset.config }));
  }

  // A successful import drops the user into the normal config form,
  // prefilled — they review everything and add their own keys before
  // saving. Secrets and widget references never come in from a snippet.
  function handleImport() {
    try {
      const { instance, provider: p } = snippetToInstance(importText);
      setProvider(p);
      setConfig(instance.config);
      setTitle(instance.title ?? '');
      setSize(instance.size);
      setGoalValue(instance.goal ? String(instance.goal.value) : '');
      setGoalDirection(instance.goal?.direction ?? 'at-least');
      setImporting(false);
      setImportText('');
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (!provider || saving) return;
    setSaving(true);
    try {
      if (provider.connection && connectionSecret.trim()) {
        await saveLocalConnection(provider.connection.id, connectionSecret);
      }
      const goalNumber = Number(goalValue);
      const goal =
        goalValue.trim() !== '' && Number.isFinite(goalNumber)
          ? { value: goalNumber, direction: goalDirection }
          : undefined;
      const instance: WidgetInstance = {
        id: existing?.id ?? newWidgetId(),
        type: provider.type,
        title: title.trim() || undefined,
        size,
        config,
        goal,
      };
      await onSave(instance);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const missingRequired =
    !connectionLoaded ||
    (!!provider?.connection?.required && !hasSavedConnection && connectionSecret.trim() === '') ||
    (provider?.configFields.some(
      (f) =>
        f.required &&
        (!f.visibleWhen || String(config[f.visibleWhen.key] ?? '') === f.visibleWhen.equals) &&
        String(config[f.key] ?? '').trim() === '',
    ) ?? true);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog widget-dialog${!provider && !importing ? ' widget-picker-dialog' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Edit widget' : 'Add widget'}
      >
        <div className="dialog-header">
          <h2>{existing ? 'Edit widget' : provider ? `Add ${provider.name}` : 'Add a widget'}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {!provider && !importing && (
          <div className="provider-picker">
            <div className="provider-picker-tools">
              <div className="provider-search">
                <input
                  type="search"
                  value={providerQuery}
                  placeholder="Search widgets"
                  aria-label="Search widgets"
                  autoFocus
                  onChange={(event) => setProviderQuery(event.target.value)}
                />
                {providerQuery && (
                  <button
                    type="button"
                    className="provider-search-clear"
                    aria-label="Clear widget search"
                    onClick={() => setProviderQuery('')}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="provider-filters" role="group" aria-label="Filter widgets by type">
                {PROVIDER_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className="provider-filter"
                    aria-pressed={providerFilter === filter.value}
                    onClick={() => setProviderFilter(filter.value)}
                  >
                    {filter.label}
                    <span>{providerCounts[filter.value]}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="provider-results-count" role="status">
              {filteredProviders.length === providers.length
                ? `${providers.length} widgets`
                : `${filteredProviders.length} of ${providers.length} widgets`}
            </p>
            <div className="provider-picker-results">
              {filteredProviders.length > 0 ? (
                <div className="provider-grid">
                  {filteredProviders.map((p) => (
                    <button key={p.type} type="button" className="provider-card" onClick={() => pickProvider(p)}>
                      <span className="provider-icon" aria-hidden="true">{p.icon}</span>
                      <span className="provider-name">
                        {p.name}
                        {AUTH_LABELS[p.auth] && <span className="provider-auth">{AUTH_LABELS[p.auth]}</span>}
                      </span>
                      <span className="provider-desc">{p.description}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="provider-empty">
                  <strong>No widgets found</strong>
                  <span>Try a different search or filter.</span>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={() => {
                      setProviderQuery('');
                      setProviderFilter('all');
                    }}
                  >
                    Clear search and filters
                  </button>
                </div>
              )}
            </div>
            <div className="import-row">
              <button type="button" className="button-ghost" onClick={() => setImporting(true)}>
                Import a shared widget…
              </button>
            </div>
          </div>
        )}

        {!provider && importing && (
          <div className="dialog-body">
            <p className="share-note">
              Paste a Panodash widget snippet. You’ll review its settings — and add any API keys
              yourself — before it’s added.
            </p>
            <textarea
              className="share-code"
              rows={10}
              value={importText}
              placeholder='{"app": "panodash", "kind": "widget", …}'
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError(null);
              }}
              aria-label="Widget snippet"
            />
            {importError && <p className="import-error">{importError}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                className="button-ghost"
                onClick={() => {
                  setImporting(false);
                  setImportError(null);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={importText.trim() === ''}
                onClick={handleImport}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {provider && (
          <form
            className="dialog-body"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {provider.setupNote && (
              <p className="setup-note">
                {typeof provider.setupNote === 'function' ? provider.setupNote() : provider.setupNote}
              </p>
            )}

            {provider.connection && (
              <div className="form-field">
                <label htmlFor={`cfg-connection-${provider.connection.id}`}>
                  {provider.connection.secretLabel}
                  {!provider.connection.required && ' (optional)'}
                </label>
                <input
                  id={`cfg-connection-${provider.connection.id}`}
                  type="password"
                  value={connectionSecret}
                  placeholder={
                    hasSavedConnection
                      ? `${provider.connection.name} connection saved`
                      : provider.connection.placeholder
                  }
                  onChange={(e) => setConnectionSecret(e.target.value)}
                  autoComplete="off"
                />
                <p className="form-help">
                  {hasSavedConnection
                    ? `A ${provider.connection.name} connection is already saved. Enter a new token only to replace it.`
                    : provider.connection.help}
                </p>
                {hasSavedConnection && (
                  <button
                    type="button"
                    className="button-small"
                    onClick={() => {
                      if (!window.confirm(`Forget the saved ${provider.connection?.name} connection?`)) return;
                      void removeLocalConnection(provider.connection!.id).then(() => {
                        setHasSavedConnection(false);
                        setConnectionSecret('');
                      });
                    }}
                  >
                    Forget saved connection
                  </button>
                )}
              </div>
            )}

            {!existing && provider.presets && provider.presets.length > 0 && (
              <div className="preset-row" role="group" aria-label="Start from a preset">
                {provider.presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="preset-chip"
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}

            <ConfigForm
              fields={provider.configFields}
              values={config}
              onChange={(key, value) => setConfig((prev) => ({ ...prev, [key]: value }))}
              widgetOptions={widgetOptions}
            />

            <div className="form-field">
              <label htmlFor="cfg-widget-title">Widget title</label>
              <input
                id="cfg-widget-title"
                type="text"
                value={title}
                placeholder={provider.defaultTitle(config)}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {provider.kind === 'metric' && (
              <>
                <div className="form-field">
                  <label htmlFor="cfg-widget-goal">Goal (optional)</label>
                  <input
                    id="cfg-widget-goal"
                    type="number"
                    step="any"
                    value={goalValue}
                    placeholder="e.g. 8000"
                    onChange={(e) => setGoalValue(e.target.value)}
                  />
                  <p className="form-help">
                    Draws a goal line on the chart and tracks your daily streak.
                  </p>
                </div>
                {goalValue.trim() !== '' && (
                  <div className="form-field">
                    <label htmlFor="cfg-widget-goal-dir">A day meets the goal when it's…</label>
                    <select
                      id="cfg-widget-goal-dir"
                      value={goalDirection}
                      onChange={(e) => setGoalDirection(e.target.value as 'at-least' | 'at-most')}
                    >
                      <option value="at-least">At or above the goal</option>
                      <option value="at-most">At or below the goal</option>
                    </select>
                  </div>
                )}
              </>
            )}

            <div className="form-field">
              <label htmlFor="cfg-widget-size">Size</label>
              <select
                id="cfg-widget-size"
                value={`${size.w}x${size.h}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  setSize({ w, h });
                }}
              >
                {SIZE_PRESETS.map((p) => (
                  <option key={p.label} value={`${p.size.w}x${p.size.h}`}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="dialog-actions">
              {!existing && (
                <button type="button" className="button-ghost" onClick={() => setProvider(null)}>
                  Back
                </button>
              )}
              <button type="submit" className="button-primary" disabled={missingRequired || saving}>
                {existing ? 'Save changes' : 'Add widget'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
