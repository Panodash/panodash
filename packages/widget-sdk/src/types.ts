import type { ComponentType } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface BrandColors {
  ink950: string;
  ink900: string;
  ink800: string;
  ink700: string;
  ink600: string;
  ink500: string;
  mist400: string;
  mist300: string;
  mist200: string;
  mist100: string;
  signal500: string;
  signal600: string;
  signal700: string;
  alert500: string;
  amber500: string;
  cyan500: string;
  violet500: string;
}

/** Grid footprint in cells. The dashboard grid is 4 columns wide on desktop. */
export interface WidgetSize {
  w: number;
  h: number;
}

/** An optional target for a metric: draws a goal line on its chart and
 *  powers the streak counter (consecutive days meeting the goal). */
export interface Goal {
  value: number;
  direction: 'at-least' | 'at-most';
}

/** One widget on the dashboard: a provider type plus its saved config. */
export interface WidgetInstance {
  id: string;
  type: string;
  title?: string;
  size: WidgetSize;
  config: Record<string, unknown>;
  goal?: Goal;
}

export interface DashboardSettings {
  version: 1;
  theme: ThemeMode;
  colors: BrandColors;
  widgets: WidgetInstance[];
  /** Reserved for the optional self-hostable auth bridge (next milestone —
   *  see docs/architecture.md). Unset = fully local operation. */
  bridgeUrl?: string;
}

/** A row in a feed-style widget (tasks, PRs, articles…). */
export interface FeedItem {
  id: string;
  title: string;
  url?: string;
  subtitle?: string;
  badge?: string;
  /** Optional semantic treatment for compact status badges. */
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}

/**
 * The latest fetched state of a widget. Cached in extension storage so a
 * fresh new tab renders instantly with last-known values.
 */
export interface Snapshot {
  fetchedAt: number;
  /** Numeric metric value — the thing tracked over time. */
  value?: number;
  /** Preformatted display string when the metric isn't a plain number. */
  display?: string;
  items?: FeedItem[];
  /** Provider-specific extras for rendering (e.g. weather conditions). */
  meta?: Record<string, unknown>;
  /** Set when the last refresh failed; previous good values are kept. */
  error?: string;
  /** Machine-readable error kind: 'permission' offers a grant button in the
   *  shell; 'auth' means the provider's component renders a connect flow. */
  errorCode?: 'permission' | 'http' | 'parse' | 'network' | 'auth' | 'activation';
}

/** One point in a widget's local time series. */
export interface Sample {
  widgetId: string;
  t: number;
  value: number;
}

/** Direction semantics for delta coloring: is a rising number good news? */
export type Direction = 'up-good' | 'down-good' | 'neutral';

/**
 * Declarative config schema — the add/edit dialog renders a form from this,
 * so widget authors never write settings UI.
 */
export type ConfigField = {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  placeholder?: string;
  /** Free-text fields that may carry credentials (e.g. a headers textarea).
   *  Stripped from shared snippets like password fields are. */
  sensitive?: boolean;
  /** Show this field only when another config value matches (e.g. client
   *  credentials only in 'own-app' connector mode). Hidden fields are also
   *  exempt from required-validation. */
  visibleWhen?: { key: string; equals: string };
} & (
  | { type: 'text' | 'url' | 'password' | 'textarea' }
  | { type: 'number'; min?: number; max?: number; step?: number }
  | { type: 'select'; options: { value: string; label: string }[] }
  /** Picks another widget on the dashboard (stores its instance id) —
   *  the dialog offers the user's metric widgets as options. */
  | { type: 'widget' }
);

/** A named partial config the dialog offers as a one-click starting point. */
export interface ConfigPreset {
  label: string;
  config: Record<string, unknown>;
}

/** Passed to fetchSnapshot — lets providers key per-widget state (OAuth
 *  tokens, caches) without touching the config the user edits. */
export interface FetchContext {
  widgetId: string;
}

/**
 * How a provider authenticates — every provider must declare one, and the
 * widget picker labels it honestly (see docs/architecture.md):
 * - 'none': no credentials (clock, weather, RSS, computed).
 * - 'local-token': a user-supplied key/token pasted into config (Oura,
 *   Linear, REST headers). Stored locally, never shared or synced.
 * - 'pkce': OAuth public client — user's own app, no secret exists (Fitbit).
 * - 'confidential': OAuth requiring a client secret. Today: the user's own
 *   registered app, secret stored locally. A future optional self-hostable
 *   bridge can hold these instead (design in docs/architecture.md).
 */
export type AuthPattern = 'none' | 'local-token' | 'pkce' | 'confidential';

/**
 * A credential shared by multiple widgets from the same provider family.
 * The secret is stored outside dashboard settings, so it is neither copied
 * into every widget nor included in shared snippets.
 */
export interface LocalConnectionRequirement {
  id: string;
  name: string;
  secretLabel: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
}

export interface WidgetComponentProps {
  instance: WidgetInstance;
  snapshot: Snapshot | null;
  /** Recent history, oldest first. Empty for widgets that keep no history. */
  samples: Sample[];
  refresh: () => void;
  /** Append a sample + update the snapshot (used by manual-entry widgets). */
  recordValue: (value: number) => Promise<void>;
  /** Merge a partial config into the instance, persist, and refetch — lets a
   *  widget finish its own setup from the tile (e.g. the weather city
   *  prompt) instead of forcing the edit dialog open. */
  updateConfig: (patch: Record<string, unknown>) => Promise<void>;
}

/**
 * A widget provider — the plugin unit of Panodash. Register one of these in
 * packages/providers/src/index.ts and the widget appears in the "Add widget" dialog,
 * gets polled by the background worker, and has its history tracked.
 *
 * `fetchSnapshot` must be DOM-free: it also runs inside the background
 * service worker.
 */
export interface WidgetProvider {
  type: string;
  name: string;
  description: string;
  /** Emoji shown in the widget picker. */
  icon: string;
  kind: 'metric' | 'feed' | 'utility';
  auth: AuthPattern;
  /** Optional shared, locally stored credential used by this provider. */
  connection?: LocalConnectionRequirement;
  defaultSize: WidgetSize;
  configFields: ConfigField[];
  defaultConfig: Record<string, unknown>;
  presets?: ConfigPreset[];
  /** Setup instructions shown above the config form (function form is
   *  evaluated at render, e.g. to include the OAuth redirect URL). */
  setupNote?: string | (() => string);
  /** Title used when the user doesn't set one. */
  defaultTitle: (config: Record<string, unknown>) => string;
  /** Poll cadence in minutes; omit for widgets that never fetch. */
  pollMinutes?: (config: Record<string, unknown>) => number;
  /** Origins this config needs host permission for (requested on save). */
  permissionOrigins?: (config: Record<string, unknown>) => string[];
  fetchSnapshot?: (config: Record<string, unknown>, ctx: FetchContext) => Promise<Snapshot>;
  component: ComponentType<WidgetComponentProps>;
}
