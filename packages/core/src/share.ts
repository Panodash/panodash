import type { Goal, WidgetInstance, WidgetProvider } from '@panodash/widget-sdk';
import { getProvider } from '@panodash/widget-sdk/registry';
import { newWidgetId } from './storage';

/**
 * Widget sharing: a widget exports to a human-readable JSON snippet anyone
 * can paste into their own dashboard — the seed of a community gallery.
 *
 * Two invariants, both enforced by field type so widget authors get them
 * for free:
 * - 'password' fields (API keys, tokens) NEVER travel: stripped on export
 *   and ignored on import, so a leaked snippet can't leak a credential.
 * - 'widget' reference fields are blanked: instance ids are meaningless on
 *   another dashboard, and the recipient picks their own sources.
 *
 * Import runs the same sanitizer, so a hand-crafted snippet can't smuggle
 * secrets, unknown keys, or malformed values into config either.
 */

export interface WidgetSnippet {
  app: 'panodash';
  kind: 'widget';
  version: 1;
  widget: {
    type: string;
    title?: string;
    size: { w: number; h: number };
    config: Record<string, unknown>;
    goal?: Goal;
  };
}

const MAX_W = 4;
const MAX_H = 2;
const MAX_TITLE = 80;

/** Rebuild a config from provider defaults + only the declared, shareable
 *  fields of `raw`, coercing each value to its field's shape. */
export function sanitizeConfig(
  provider: WidgetProvider,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...provider.defaultConfig };
  if (!raw) return out;
  for (const field of provider.configFields) {
    if (field.type === 'password' || field.type === 'widget' || field.sensitive) continue;
    const value = raw[field.key];
    if (value === undefined || value === null) continue;
    switch (field.type) {
      case 'number': {
        const n = Number(value);
        if (Number.isFinite(n)) out[field.key] = n;
        break;
      }
      case 'select': {
        const s = String(value);
        if (field.options.some((opt) => opt.value === s)) out[field.key] = s;
        break;
      }
      default:
        out[field.key] = String(value);
    }
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizeGoal(raw: unknown): Goal | undefined {
  const g = raw as { value?: unknown; direction?: unknown } | undefined;
  if (!g || typeof g.value !== 'number' || !Number.isFinite(g.value)) return undefined;
  return {
    value: g.value,
    direction: g.direction === 'at-most' ? 'at-most' : 'at-least',
  };
}

export function widgetToSnippet(instance: WidgetInstance): WidgetSnippet {
  const provider = getProvider(instance.type);
  if (!provider) throw new Error(`Unknown widget type '${instance.type}'`);
  return {
    app: 'panodash',
    kind: 'widget',
    version: 1,
    widget: {
      type: instance.type,
      title: instance.title,
      size: { w: instance.size.w, h: instance.size.h },
      config: sanitizeConfig(provider, instance.config),
      goal: instance.goal ? { ...instance.goal } : undefined,
    },
  };
}

/**
 * Parse a pasted snippet into a fresh, sanitized instance. Throws with a
 * user-facing message on anything unusable.
 */
export function snippetToInstance(text: string): {
  instance: WidgetInstance;
  provider: WidgetProvider;
} {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('That doesn’t look like JSON — paste the whole snippet.');
  }
  const p = payload as Partial<WidgetSnippet> | null;
  const widget = p?.widget;
  if (p?.kind !== 'widget' || !widget || typeof widget.type !== 'string') {
    throw new Error('That doesn’t look like a Panodash widget snippet.');
  }
  const provider = getProvider(widget.type);
  if (!provider) {
    throw new Error(
      `This snippet needs the “${widget.type}” widget type, which isn’t available in this build.`,
    );
  }
  const rawSize = widget.size as { w?: unknown; h?: unknown } | undefined;
  const size = {
    w: clamp(Math.round(Number(rawSize?.w)) || provider.defaultSize.w, 1, MAX_W),
    h: clamp(Math.round(Number(rawSize?.h)) || provider.defaultSize.h, 1, MAX_H),
  };
  const title =
    typeof widget.title === 'string' && widget.title.trim() !== ''
      ? widget.title.trim().slice(0, MAX_TITLE)
      : undefined;
  return {
    provider,
    instance: {
      id: newWidgetId(),
      type: provider.type,
      title,
      size,
      config: sanitizeConfig(provider, widget.config as Record<string, unknown> | undefined),
      goal: sanitizeGoal(widget.goal),
    },
  };
}
