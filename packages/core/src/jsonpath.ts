/**
 * Tiny dot/bracket path extractor for the REST widget: `a.b[0].c`,
 * `data["odd key"].count`, optional leading `$.`. Deliberately not full
 * JSONPath — simple, predictable, and dependency-free.
 */
export function extractPath(data: unknown, path: string): unknown {
  const trimmed = path.trim().replace(/^\$\.?/, '');
  if (trimmed === '') return data;
  const tokens: (string | number)[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]|\["([^"]*)"\]|\['([^']*)'\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
    else tokens.push(m[3] ?? m[4] ?? '');
  }
  let cur: unknown = data;
  for (const token of tokens) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string | number, unknown>)[token];
  }
  return cur;
}

/** Coerce an extracted value to a number if it plausibly is one. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, ''));
    if (value.trim() !== '' && Number.isFinite(n)) return n;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return undefined;
}
