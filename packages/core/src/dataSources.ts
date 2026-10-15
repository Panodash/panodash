import type { WidgetInstance, WidgetProvider } from '@panodash/widget-sdk';
import type { ConnectionMeta } from './connections';

/**
 * Provider-neutral view of everywhere Panodash keeps a credential, assembled
 * for the Data sources dialog. Everything here is pure: the caller supplies
 * the registered providers, the dashboard's widgets, and what storage holds,
 * so the shaping rules stay unit-testable and DOM-free.
 *
 * Two families exist, and they behave differently:
 * - shared local connections (`connection:<id>`), declared by providers and
 *   reused across every widget of that family;
 * - account connections (`oauth:<widgetId>`, `bridge:<widgetId>`), minted per
 *   widget by a consent flow and never re-enterable by hand.
 */

/** One widget that draws on a shared connection. */
export interface DataSourceUsage {
  widgetId: string;
  title: string;
  providerName: string;
  /** The widget stops working without this connection. */
  required: boolean;
}

export interface DataSourceEntry {
  id: string;
  name: string;
  secretLabel: string;
  help?: string;
  placeholder?: string;
  connected: boolean;
  updatedAt?: number;
  /** Masked tail of the saved secret — never the secret itself. */
  hint?: string;
  /** At least one installed widget cannot work without this connection. */
  required: boolean;
  usedBy: DataSourceUsage[];
  /** Provider types that can use it, whether or not one is installed. */
  providerTypes: string[];
  /** A saved secret no registered provider claims. */
  orphaned: boolean;
}

export type AccountConnectionKind = 'oauth' | 'bridge';

/** A per-widget credential minted by a consent flow. */
export interface AccountConnection {
  widgetId: string;
  title: string;
  providerName: string;
  providerType: string;
  /** Both are possible: a bridge session caches an access token locally. */
  kinds: AccountConnectionKind[];
  bridgeUrl?: string;
  bridgeProvider?: string;
  /** False when the widget is gone but its credential outlived it. */
  installed: boolean;
}

export interface StoredBridgeRecord {
  widgetId: string;
  url: string;
  provider: string;
}

export function widgetTitle(widget: WidgetInstance, provider?: WidgetProvider): string {
  return widget.title?.trim() || provider?.defaultTitle(widget.config) || widget.type;
}

/** Rank for display: in-use first, then saved, then offered, orphans last. */
function entryRank(entry: DataSourceEntry): number {
  if (entry.orphaned) return 3;
  if (entry.usedBy.length > 0) return 0;
  return entry.connected ? 1 : 2;
}

/**
 * Every shared connection the dashboard could hold: declared by a registered
 * provider, already saved, or both. Declared-but-empty entries stay listed so
 * a token can be added before the first widget of that family exists.
 */
export function collectDataSources(
  providers: WidgetProvider[],
  widgets: WidgetInstance[],
  stored: ConnectionMeta[],
): DataSourceEntry[] {
  const entries = new Map<string, DataSourceEntry>();

  for (const provider of providers) {
    const requirement = provider.connection;
    if (!requirement) continue;
    const existing = entries.get(requirement.id);
    if (existing) {
      existing.providerTypes.push(provider.type);
      continue;
    }
    entries.set(requirement.id, {
      id: requirement.id,
      name: requirement.name,
      secretLabel: requirement.secretLabel,
      help: requirement.help,
      placeholder: requirement.placeholder,
      connected: false,
      required: false,
      usedBy: [],
      providerTypes: [provider.type],
      orphaned: false,
    });
  }

  for (const widget of widgets) {
    const provider = providers.find((candidate) => candidate.type === widget.type);
    const requirement = provider?.connection;
    if (!provider || !requirement) continue;
    const entry = entries.get(requirement.id);
    if (!entry) continue;
    entry.usedBy.push({
      widgetId: widget.id,
      title: widgetTitle(widget, provider),
      providerName: provider.name,
      required: !!requirement.required,
    });
    if (requirement.required) entry.required = true;
  }

  for (const meta of stored) {
    const entry = entries.get(meta.id);
    if (entry) {
      entry.connected = true;
      entry.updatedAt = meta.updatedAt;
      entry.hint = meta.hint;
      continue;
    }
    // A secret whose provider was removed or renamed: surface it so it can
    // be deleted rather than sitting unreachable in storage.
    entries.set(meta.id, {
      id: meta.id,
      name: meta.id,
      secretLabel: 'Saved token',
      connected: true,
      updatedAt: meta.updatedAt,
      hint: meta.hint,
      required: false,
      usedBy: [],
      providerTypes: [],
      orphaned: true,
    });
  }

  return [...entries.values()].sort(
    (a, b) => entryRank(a) - entryRank(b) || a.name.localeCompare(b.name),
  );
}

/**
 * Per-widget OAuth tokens and bridge sessions. Records whose widget no longer
 * exists are kept in the list (marked `installed: false`) — importing a backup
 * replaces the widget set wholesale and can strand them.
 */
export function collectAccountConnections(
  providers: WidgetProvider[],
  widgets: WidgetInstance[],
  oauthWidgetIds: string[],
  bridgeRecords: StoredBridgeRecord[],
): AccountConnection[] {
  const byWidget = new Map<string, AccountConnection>();

  function ensure(widgetId: string): AccountConnection {
    const found = byWidget.get(widgetId);
    if (found) return found;
    const widget = widgets.find((candidate) => candidate.id === widgetId);
    const provider = widget && providers.find((candidate) => candidate.type === widget.type);
    const connection: AccountConnection = {
      widgetId,
      title: widget ? widgetTitle(widget, provider) : widgetId,
      providerName: provider?.name ?? 'Removed widget',
      providerType: widget?.type ?? '',
      kinds: [],
      installed: !!widget,
    };
    byWidget.set(widgetId, connection);
    return connection;
  }

  for (const widgetId of oauthWidgetIds) ensure(widgetId).kinds.push('oauth');
  for (const record of bridgeRecords) {
    const connection = ensure(record.widgetId);
    connection.kinds.push('bridge');
    connection.bridgeUrl = record.url;
    connection.bridgeProvider = record.provider;
  }

  return [...byWidget.values()].sort(
    (a, b) =>
      Number(b.installed) - Number(a.installed) ||
      a.title.localeCompare(b.title) ||
      a.widgetId.localeCompare(b.widgetId),
  );
}
