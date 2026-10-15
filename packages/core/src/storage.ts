import type { DashboardSettings, Snapshot, WidgetInstance } from '@panodash/widget-sdk';
import { DEFAULT_BRAND_COLORS } from './theme';

/**
 * Key-value storage over chrome.storage.local, with a localStorage fallback
 * so `npm run dev` works in a plain browser tab.
 */

const hasChrome =
  typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

type Listener = (key: string, value: unknown) => void;
const listeners = new Set<Listener>();

if (hasChrome) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
      for (const fn of listeners) fn(key, change.newValue);
    }
  });
}

export async function storageGet<T>(key: string): Promise<T | undefined> {
  if (hasChrome) {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  }
  const raw = localStorage.getItem(key);
  return raw === null ? undefined : (JSON.parse(raw) as T);
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  if (hasChrome) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
  for (const fn of listeners) fn(key, value);
}

export async function storageRemove(key: string): Promise<void> {
  if (hasChrome) {
    await chrome.storage.local.remove(key);
    return;
  }
  localStorage.removeItem(key);
  for (const fn of listeners) fn(key, undefined);
}

/** Every stored key, optionally narrowed to one prefix. Lets connection
 *  management find secrets whose provider is no longer registered. */
export async function storageKeys(prefix = ''): Promise<string[]> {
  const keys = hasChrome
    ? Object.keys(await chrome.storage.local.get(null))
    : Object.keys(localStorage);
  return keys.filter((key) => key.startsWith(prefix));
}

export function storageSubscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- Typed accessors ----

const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: DashboardSettings = {
  version: 1,
  theme: 'system',
  colors: DEFAULT_BRAND_COLORS,
  widgets: [
    {
      id: 'seed-clock',
      type: 'clock',
      size: { w: 2, h: 1 },
      config: { name: '', hour12: 'auto' },
    },
    {
      // Weather works keylessly (Open-Meteo origins ship in the manifest),
      // so first run only asks for a city — typed straight into the tile.
      id: 'seed-weather',
      type: 'weather',
      size: { w: 1, h: 1 },
      config: { location: '', unit: 'celsius' },
    },
  ],
};

function normalizeSettings(stored?: Partial<DashboardSettings>): DashboardSettings {
  if (!stored) return DEFAULT_SETTINGS;
  const storedColors = stored.colors as Partial<typeof DEFAULT_BRAND_COLORS> | undefined;
  // Palettes saved before Signal v1 used a different five-color model. Reset
  // those instead of combining incompatible primitives; current palettes
  // still merge so newly added tokens migrate safely.
  const colors = storedColors && 'ink950' in storedColors
    ? { ...DEFAULT_BRAND_COLORS, ...storedColors }
    : DEFAULT_BRAND_COLORS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    colors,
  };
}

export async function getSettings(): Promise<DashboardSettings> {
  const stored = await storageGet<DashboardSettings>(SETTINGS_KEY);
  return normalizeSettings(stored);
}

export async function saveSettings(settings: DashboardSettings): Promise<void> {
  await storageSet(SETTINGS_KEY, settings);
}

export function onSettingsChange(fn: (s: DashboardSettings) => void): () => void {
  return storageSubscribe((key, value) => {
    if (key === SETTINGS_KEY && value) fn(normalizeSettings(value as DashboardSettings));
  });
}

export function snapshotKey(widgetId: string): string {
  return `snapshot:${widgetId}`;
}

export async function getSnapshot(widgetId: string): Promise<Snapshot | undefined> {
  return storageGet<Snapshot>(snapshotKey(widgetId));
}

export async function setSnapshot(widgetId: string, snap: Snapshot): Promise<void> {
  await storageSet(snapshotKey(widgetId), snap);
}

export function newWidgetId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function findWidget(
  settings: DashboardSettings,
  id: string,
): WidgetInstance | undefined {
  return settings.widgets.find((w) => w.id === id);
}
