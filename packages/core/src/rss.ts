/**
 * Minimal, tolerant RSS 2.0 / Atom parser. Deliberately text-based:
 * DOMParser doesn't exist in MV3 service workers, and the background
 * worker needs to poll feeds too. Handles CDATA, basic entities, and both
 * <link>text</link> (RSS) and <link href="…"/> (Atom) shapes.
 */

export interface ParsedFeedItem {
  id: string;
  title: string;
  link?: string;
  /** Epoch ms, when the item carries a parseable date. */
  date?: number;
}

export interface ParsedFeed {
  title?: string;
  items: ParsedFeedItem[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** Text content of the first <tag>…</tag> in the block, CDATA unwrapped,
 *  inner markup stripped, entities decoded. */
function textOf(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  let text = m[1].trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) text = cdata[1];
  const cleaned = decodeEntities(text.replace(/<[^>]+>/g, '')).trim();
  return cleaned || undefined;
}

/** Atom-style <link href="…"/>; prefers rel="alternate", then rel-less. */
function atomLink(block: string): string | undefined {
  const tags = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const pick =
    tags.find((t) => /rel=["']alternate["']/i.test(t)) ??
    tags.find((t) => !/\brel=/i.test(t)) ??
    tags[0];
  const href = pick?.match(/href=["']([^"']+)["']/i);
  return href ? decodeEntities(href[1]) : undefined;
}

function dateOf(block: string): number | undefined {
  for (const tag of ['pubDate', 'published', 'updated', 'dc:date']) {
    const raw = textOf(block, tag);
    if (raw) {
      const t = Date.parse(raw);
      if (!Number.isNaN(t)) return t;
    }
  }
  return undefined;
}

export function parseFeed(xml: string): ParsedFeed {
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items = blocks.map((block, i): ParsedFeedItem => {
    const link = textOf(block, 'link') ?? atomLink(block);
    return {
      id: textOf(block, 'guid') ?? textOf(block, 'id') ?? link ?? `item-${i}`,
      title: textOf(block, 'title') ?? 'Untitled',
      link,
      date: dateOf(block),
    };
  });
  // The channel/feed <title> precedes the first item in both formats.
  const firstBlock: string | undefined = blocks[0];
  const head = firstBlock ? xml.slice(0, xml.indexOf(firstBlock)) : xml;
  return { title: textOf(head, 'title'), items };
}
