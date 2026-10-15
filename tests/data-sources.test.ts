import { describe, expect, it } from 'vitest';
import type { LocalConnectionRequirement, WidgetInstance, WidgetProvider } from '@panodash/widget-sdk';
import {
  collectAccountConnections,
  collectDataSources,
  widgetTitle,
} from '@panodash/core/dataSources';
import { maskSecret } from '@panodash/core/connections';

const GITHUB: LocalConnectionRequirement = {
  id: 'github',
  name: 'GitHub',
  secretLabel: 'GitHub personal access token',
  help: 'Shared by GitHub widgets.',
  placeholder: 'ghp_…',
};

function provider(
  type: string,
  name: string,
  extra: Partial<WidgetProvider> = {},
): WidgetProvider {
  return {
    type,
    name,
    description: `${name} description`,
    kind: 'metric',
    icon: '',
    auth: 'none',
    defaultSize: { w: 1, h: 1 },
    configFields: [],
    defaultConfig: {},
    defaultTitle: () => name,
    component: () => null,
    ...extra,
  };
}

function widget(id: string, type: string, title?: string): WidgetInstance {
  return { id, type, title, size: { w: 1, h: 1 }, config: {} };
}

const stars = provider('github-stars', 'GitHub stars', {
  connection: { ...GITHUB, required: false },
});
const reviews = provider('github-reviews', 'GitHub reviews', {
  connection: { ...GITHUB, required: true },
});
const clock = provider('clock', 'Clock');

describe('collectDataSources', () => {
  it('lists a declared connection even when nothing uses it', () => {
    const [entry] = collectDataSources([stars, clock], [], []);
    expect(entry).toMatchObject({
      id: 'github',
      name: 'GitHub',
      secretLabel: 'GitHub personal access token',
      placeholder: 'ghp_…',
      connected: false,
      required: false,
      orphaned: false,
      usedBy: [],
    });
  });

  it('merges providers sharing one connection id into a single entry', () => {
    const entries = collectDataSources([stars, reviews, clock], [], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].providerTypes).toEqual(['github-stars', 'github-reviews']);
  });

  it('maps installed widgets onto the connection they use', () => {
    const entries = collectDataSources(
      [stars, reviews, clock],
      [widget('w1', 'github-stars', 'Stars'), widget('w2', 'clock')],
      [],
    );
    expect(entries[0].usedBy).toEqual([
      { widgetId: 'w1', title: 'Stars', providerName: 'GitHub stars', required: false },
    ]);
  });

  it('marks the entry required when any installed widget requires it', () => {
    const optionalOnly = collectDataSources([stars, reviews], [widget('w1', 'github-stars')], []);
    expect(optionalOnly[0].required).toBe(false);

    const withRequired = collectDataSources(
      [stars, reviews],
      [widget('w1', 'github-stars'), widget('w2', 'github-reviews')],
      [],
    );
    expect(withRequired[0].required).toBe(true);
  });

  it('applies stored metadata without exposing the secret', () => {
    const raw = 'ghp_0123456789abcd';
    const [entry] = collectDataSources(
      [stars],
      [],
      [{ id: 'github', updatedAt: 1700000000000, hint: maskSecret(raw) }],
    );
    expect(entry.connected).toBe(true);
    expect(entry.updatedAt).toBe(1700000000000);
    expect(entry.hint).toBe('••••abcd');
    expect(JSON.stringify(entry)).not.toContain(raw);
  });

  it('surfaces a stored secret no registered provider claims', () => {
    const entries = collectDataSources(
      [stars],
      [],
      [{ id: 'retired-service', updatedAt: 5, hint: '••••' }],
    );
    const orphan = entries.find((entry) => entry.id === 'retired-service');
    expect(orphan).toMatchObject({ orphaned: true, connected: true, name: 'retired-service' });
  });

  it('orders in-use entries first and orphans last', () => {
    const codecov = provider('coverage', 'Coverage', {
      connection: { id: 'codecov', name: 'Codecov', secretLabel: 'Codecov token' },
    });
    const entries = collectDataSources(
      [stars, codecov],
      [widget('w1', 'coverage')],
      [
        { id: 'github', updatedAt: 1, hint: '••••' },
        { id: 'gone', updatedAt: 1, hint: '••••' },
      ],
    );
    expect(entries.map((entry) => entry.id)).toEqual(['codecov', 'github', 'gone']);
  });
});

describe('collectAccountConnections', () => {
  const fitbit = provider('fitbit', 'Fitbit', { auth: 'pkce' });
  const whoop = provider('whoop', 'WHOOP', { auth: 'confidential' });

  it('names the widget behind each stored credential', () => {
    const [entry] = collectAccountConnections(
      [fitbit],
      [widget('w1', 'fitbit', 'Steps')],
      ['w1'],
      [],
    );
    expect(entry).toMatchObject({
      widgetId: 'w1',
      title: 'Steps',
      providerName: 'Fitbit',
      kinds: ['oauth'],
      installed: true,
    });
  });

  it('combines OAuth tokens and a bridge session for one widget', () => {
    const [entry] = collectAccountConnections(
      [whoop],
      [widget('w2', 'whoop')],
      ['w2'],
      [{ widgetId: 'w2', url: 'https://bridge.example.com', provider: 'whoop' }],
    );
    expect(entry.kinds).toEqual(['oauth', 'bridge']);
    expect(entry.bridgeUrl).toBe('https://bridge.example.com');
    expect(entry.bridgeProvider).toBe('whoop');
  });

  it('keeps credentials whose widget is gone, flagged as uninstalled', () => {
    const entries = collectAccountConnections([fitbit], [], ['w-removed'], []);
    expect(entries[0]).toMatchObject({
      widgetId: 'w-removed',
      title: 'w-removed',
      providerName: 'Removed widget',
      installed: false,
    });
  });

  it('sorts installed widgets ahead of stranded credentials', () => {
    const entries = collectAccountConnections(
      [fitbit],
      [widget('w1', 'fitbit', 'Steps')],
      ['w-removed', 'w1'],
      [],
    );
    expect(entries.map((entry) => entry.widgetId)).toEqual(['w1', 'w-removed']);
  });
});

describe('widgetTitle', () => {
  it('prefers an explicit title, then the provider default, then the type', () => {
    expect(widgetTitle(widget('w1', 'clock', 'My clock'), clock)).toBe('My clock');
    expect(widgetTitle(widget('w1', 'clock', '  '), clock)).toBe('Clock');
    expect(widgetTitle(widget('w1', 'clock'), undefined)).toBe('clock');
  });
});

describe('maskSecret', () => {
  it('keeps a recognisable tail for long secrets', () => {
    expect(maskSecret('ghp_0123456789abcdef')).toBe('••••cdef');
  });

  it('hides short secrets entirely', () => {
    expect(maskSecret('short')).toBe('••••');
    expect(maskSecret('12345678')).toBe('••••');
  });

  it('ignores surrounding whitespace', () => {
    expect(maskSecret('  ghp_0123456789abcdef  ')).toBe('••••cdef');
  });
});
