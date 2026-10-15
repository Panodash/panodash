import type { Snapshot, WidgetInstance } from '@panodash/widget-sdk';
import { getProvider } from '@panodash/widget-sdk/registry';
import { getSnapshot, setSnapshot } from './storage';
import { recordSample } from './history';

const hasPermissionsApi =
  typeof chrome !== 'undefined' && !!chrome.permissions;

/** Does the extension currently hold host permission for this config? */
export async function hasOriginPermission(instance: WidgetInstance): Promise<boolean> {
  const provider = getProvider(instance.type);
  const origins = provider?.permissionOrigins?.(instance.config) ?? [];
  if (origins.length === 0 || !hasPermissionsApi) return true;
  return chrome.permissions.contains({ origins });
}

/** Must be called from a user gesture (e.g. a click handler). */
export async function requestOriginPermission(instance: WidgetInstance): Promise<boolean> {
  const provider = getProvider(instance.type);
  const origins = provider?.permissionOrigins?.(instance.config) ?? [];
  if (origins.length === 0 || !hasPermissionsApi) return true;
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

/**
 * Fetch a widget's snapshot, cache it, and (for numeric metrics) append the
 * value to local history. Shared by the new-tab page and the background
 * worker. On failure the previous good values are kept and `error` is set.
 */
export async function refreshWidget(instance: WidgetInstance): Promise<Snapshot | null> {
  const provider = getProvider(instance.type);
  if (!provider?.fetchSnapshot) return null;

  const prev = await getSnapshot(instance.id);

  if (!(await hasOriginPermission(instance))) {
    const snap: Snapshot = {
      ...prev,
      fetchedAt: Date.now(),
      error: 'Panodash needs permission to reach this site',
      errorCode: 'permission',
    };
    await setSnapshot(instance.id, snap);
    return snap;
  }

  let snap: Snapshot;
  try {
    snap = await provider.fetchSnapshot(instance.config, { widgetId: instance.id });
  } catch (err) {
    snap = {
      ...prev,
      fetchedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
      errorCode: 'network',
    };
    await setSnapshot(instance.id, snap);
    return snap;
  }

  await setSnapshot(instance.id, snap);
  if (typeof snap.value === 'number' && Number.isFinite(snap.value)) {
    await recordSample(instance.id, snap.value, snap.fetchedAt);
  }
  return snap;
}

/** Refresh if the cached snapshot is older than the widget's poll cadence. */
export async function refreshIfStale(instance: WidgetInstance): Promise<Snapshot | null> {
  const provider = getProvider(instance.type);
  if (!provider?.fetchSnapshot) return null;
  const pollMs = (provider.pollMinutes?.(instance.config) ?? 15) * 60 * 1000;
  const prev = await getSnapshot(instance.id);
  if (prev && Date.now() - prev.fetchedAt < pollMs) return prev;
  return refreshWidget(instance);
}
