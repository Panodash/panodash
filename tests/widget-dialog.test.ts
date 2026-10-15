import { describe, expect, it } from 'vitest';
import type { WidgetProvider } from '@panodash/widget-sdk';
import { filterWidgetProviders } from '@panodash/ui/WidgetDialog';

function provider(
  type: string,
  name: string,
  description: string,
  kind: WidgetProvider['kind'],
): WidgetProvider {
  return {
    type,
    name,
    description,
    kind,
    icon: '',
    auth: 'none',
    defaultSize: { w: 1, h: 1 },
    configFields: [],
    defaultConfig: {},
    defaultTitle: () => name,
    component: () => null,
  };
}

const providers = [
  provider('github-stars', 'GitHub stars', 'Repository popularity over time.', 'metric'),
  provider('rss-feed', 'RSS / Atom feed', 'Headlines from any feed.', 'feed'),
  provider('clock', 'Clock & greeting', 'Time and date.', 'utility'),
];

describe('filterWidgetProviders', () => {
  it('filters providers by kind', () => {
    expect(filterWidgetProviders(providers, 'feed', '')).toEqual([providers[1]]);
  });

  it('searches names, descriptions, and provider IDs without case sensitivity', () => {
    expect(filterWidgetProviders(providers, 'all', 'GITHUB')).toEqual([providers[0]]);
    expect(filterWidgetProviders(providers, 'all', 'popularity')).toEqual([providers[0]]);
    expect(filterWidgetProviders(providers, 'all', 'rss-feed')).toEqual([providers[1]]);
  });

  it('requires every search term and combines search with the kind filter', () => {
    expect(filterWidgetProviders(providers, 'metric', 'repository stars')).toEqual([providers[0]]);
    expect(filterWidgetProviders(providers, 'feed', 'repository')).toEqual([]);
  });
});
