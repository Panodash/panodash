import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { parseFeed } from '@panodash/core/rss';
import { timeAgo } from '@panodash/core/format';

/**
 * Any RSS 2.0 or Atom feed as a dashboard tile — blogs, release feeds,
 * subreddits, HN frontpage, status pages.
 */
interface RssConfig {
  url: string;
  maxItems: number;
  pollMinutes: number;
}

async function fetchRss(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as RssConfig;
  const res = await fetch(config.url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
  if (!res.ok) return { fetchedAt: Date.now(), error: `HTTP ${res.status}`, errorCode: 'http' };
  const feed = parseFeed(await res.text());
  if (feed.items.length === 0) {
    return { fetchedAt: Date.now(), error: 'No items found — is this an RSS/Atom feed?', errorCode: 'parse' };
  }
  const max = Math.max(1, Number(config.maxItems) || 8);
  return {
    fetchedAt: Date.now(),
    items: feed.items.slice(0, max).map((item) => ({
      id: item.id,
      title: item.title,
      url: item.link,
      subtitle: item.date ? timeAgo(item.date) : undefined,
    })),
    meta: { feedTitle: feed.title },
  };
}

function RssWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  if (items.length === 0) {
    return <div className="feed-empty">Nothing here yet.</div>;
  }
  return (
    <div className="feed">
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.id} className="feed-item">
            <a href={item.url} target="_blank" rel="noreferrer" title={item.title}>
              {item.title}
            </a>
            {item.subtitle && <span className="feed-sub">{item.subtitle}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const rssFeedProvider: WidgetProvider = {
  type: 'rss-feed',
  name: 'RSS / Atom feed',
  description: 'Headlines from any feed — blogs, releases, Hacker News, status pages.',
  icon: '📰',
  kind: 'feed',
  auth: 'none',
  defaultSize: { w: 2, h: 2 },
  configFields: [
    { key: 'label', label: 'Feed name', type: 'text', placeholder: 'Hacker News' },
    { key: 'url', label: 'Feed URL', type: 'url', required: true, placeholder: 'https://news.ycombinator.com/rss' },
    { key: 'maxItems', label: 'Items to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { label: '', url: '', maxItems: 8, pollMinutes: 30 },
  defaultTitle: (config) => (config.label as string) || 'RSS feed',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 30),
  permissionOrigins: (config) => {
    try {
      const url = new URL(String(config.url));
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
      return [`${url.origin}/*`];
    } catch {
      return [];
    }
  },
  fetchSnapshot: fetchRss,
  component: RssWidget,
};
