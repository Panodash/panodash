import { describe, expect, it } from 'vitest';
import { decodeEntities, parseFeed } from '@panodash/core/rss';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com</link>
    <item>
      <title>First &amp; foremost</title>
      <link>https://example.com/first</link>
      <guid>post-1</guid>
      <pubDate>Tue, 14 Jul 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Second post — with <em>markup</em>]]></title>
      <link>https://example.com/second</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Releases</title>
  <entry>
    <id>tag:example,2026:release-2</id>
    <title>v2.0.0</title>
    <link rel="alternate" href="https://example.com/releases/2"/>
    <updated>2026-07-10T12:00:00Z</updated>
  </entry>
  <entry>
    <id>tag:example,2026:release-1</id>
    <title>v1.0.0</title>
    <link href="https://example.com/releases/1"/>
    <updated>2026-06-01T12:00:00Z</updated>
  </entry>
</feed>`;

describe('parseFeed — RSS 2.0', () => {
  const feed = parseFeed(RSS);

  it('reads the channel title', () => {
    expect(feed.title).toBe('Example Blog');
  });

  it('parses items with entities decoded', () => {
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0].title).toBe('First & foremost');
    expect(feed.items[0].link).toBe('https://example.com/first');
    expect(feed.items[0].id).toBe('post-1');
  });

  it('parses dates', () => {
    expect(feed.items[0].date).toBe(Date.parse('Tue, 14 Jul 2026 09:00:00 GMT'));
    expect(feed.items[1].date).toBeUndefined();
  });

  it('unwraps CDATA and strips inner markup', () => {
    expect(feed.items[1].title).toBe('Second post — with markup');
  });
});

describe('parseFeed — Atom', () => {
  const feed = parseFeed(ATOM);

  it('reads the feed title and entries', () => {
    expect(feed.title).toBe('Releases');
    expect(feed.items).toHaveLength(2);
  });

  it('extracts href links, preferring rel=alternate', () => {
    expect(feed.items[0].link).toBe('https://example.com/releases/2');
    expect(feed.items[1].link).toBe('https://example.com/releases/1');
  });

  it('uses <id> for identity and parses <updated>', () => {
    expect(feed.items[0].id).toBe('tag:example,2026:release-2');
    expect(feed.items[0].date).toBe(Date.parse('2026-07-10T12:00:00Z'));
  });
});

describe('parseFeed — edge cases', () => {
  it('returns no items for non-feed content', () => {
    expect(parseFeed('<html><body>nope</body></html>').items).toHaveLength(0);
  });
  it('titles missing items as Untitled', () => {
    const feed = parseFeed('<rss><channel><item><link>https://x.y/a</link></item></channel></rss>');
    expect(feed.items[0].title).toBe('Untitled');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal, and hex entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#8212; &#x1F525;')).toBe('a & b <c> — 🔥');
  });
  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
  });
});
