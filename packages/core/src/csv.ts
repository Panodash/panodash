/**
 * CSV history import — the on-ramp for data that can't arrive via an API:
 * exports from other apps, spreadsheets, or Panodash's own per-metric CSV.
 *
 * Accepted shapes (header rows are auto-skipped because they don't parse):
 * - Panodash export:  timestamp_ms,iso_time,value
 * - Generic 2-column: time,value  (time = epoch seconds, epoch ms, or any
 *   Date.parse-able string, e.g. ISO 8601)
 */

export interface CsvSample {
  t: number;
  value: number;
}

function unquote(cell: string): string {
  const s = cell.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"').trim();
  }
  return s;
}

function parseTime(cell: string): number | undefined {
  if (/^\d+$/.test(cell)) {
    const n = Number(cell);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    // 10-digit epochs (≈2001–2286) are seconds; longer are milliseconds.
    return cell.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(cell);
  return Number.isNaN(t) ? undefined : t;
}

export function parseCsvSamples(text: string): CsvSample[] {
  const out: CsvSample[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const cells = line.split(',').map(unquote);
    if (cells.length < 2) continue;
    // Value is the last column; time is the first column that parses —
    // this covers both the 3-column export and generic 2-column files.
    const value = Number(cells[cells.length - 1]);
    if (!Number.isFinite(value)) continue;
    let t: number | undefined;
    for (const cell of cells.slice(0, -1)) {
      t = parseTime(cell);
      if (t !== undefined) break;
    }
    if (t === undefined) continue;
    out.push({ t, value });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
