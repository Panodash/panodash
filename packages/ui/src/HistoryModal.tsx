import { useEffect, useMemo, useRef, useState } from 'react';
import type { Sample, WidgetInstance } from '@panodash/widget-sdk';
import { getSamples } from '@panodash/core/history';
import { getProvider } from '@panodash/widget-sdk/registry';
import { computeStreak } from '@panodash/core/series';
import { formatValue, withUnit } from '@panodash/core/format';
import { LineChart } from './LineChart';

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All', days: 0 },
];

export function HistoryModal({
  instance,
  onClose,
}: {
  instance: WidgetInstance;
  onClose: () => void;
}) {
  const provider = getProvider(instance.type);
  const title = instance.title ?? provider?.defaultTitle(instance.config) ?? 'History';
  const unit = (instance.config.unit as string) || undefined;
  const [rangeDays, setRangeDays] = useState(30);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [streak, setStreak] = useState(0);
  const prevSamples = useRef<Sample[]>([]);
  const goal = instance.goal;

  // Streak is computed over a fixed 90-day window, independent of the
  // selected chart range, so switching to "7 days" doesn't shrink it.
  useEffect(() => {
    if (!goal) return;
    let cancelled = false;
    void getSamples(instance.id, Date.now() - 90 * 24 * 60 * 60 * 1000).then((rows) => {
      if (!cancelled) setStreak(computeStreak(rows, goal));
    });
    return () => {
      cancelled = true;
    };
  }, [instance.id, goal]);

  useEffect(() => {
    let cancelled = false;
    const since = rangeDays === 0 ? 0 : Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    void getSamples(instance.id, since).then((rows) => {
      if (cancelled) return;
      prevSamples.current = rows;
      setSamples(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [instance.id, rangeDays]);

  // While a new range loads, hold the previous render at reduced opacity.
  const rows = samples ?? prevSamples.current;
  const loading = samples === null;

  const csvHref = useMemo(() => {
    const lines = ['timestamp_ms,iso_time,value'];
    for (const s of rows) {
      lines.push(`${s.t},${new Date(s.t).toISOString()},${s.value}`);
    }
    return `data:text/csv;charset=utf-8,${encodeURIComponent(lines.join('\n'))}`;
  }, [rows]);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-label={`${title} history`}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {goal && (
          <p className="goal-summary">
            Goal: {goal.direction === 'at-most' ? 'at most' : 'at least'}{' '}
            {withUnit(formatValue(goal.value), unit)}
            {streak > 0 && (
              <>
                {' · '}
                <span className="streak-good">🔥 {streak}-day streak</span>
              </>
            )}
          </p>
        )}

        <div className="filter-row" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              className={`range-button${rangeDays === r.days ? ' selected' : ''}`}
              aria-pressed={rangeDays === r.days}
              onClick={() => setRangeDays(r.days)}
            >
              {rangeDays === r.days && <span className="range-check">✓</span>}
              {r.label}
            </button>
          ))}
          <span className="filter-spacer" />
          <button type="button" className="button-ghost" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
          <a className="button-ghost" href={csvHref} download={`${title.replace(/[^\w-]+/g, '_')}.csv`}>
            Download CSV
          </a>
        </div>

        {rows.length === 0 && !loading ? (
          <p className="feed-empty">
            No history in this range yet. Values are recorded each time the metric refreshes.
          </p>
        ) : showTable ? (
          <div className="history-table-wrap" style={{ opacity: loading ? 0.5 : 1 }}>
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((s) => (
                  <tr key={s.t}>
                    <td>{new Date(s.t).toLocaleString()}</td>
                    <td className="num">{withUnit(formatValue(s.value), unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ opacity: loading ? 0.5 : 1 }}>
            <LineChart samples={rows} unit={unit} goal={goal} />
          </div>
        )}
      </div>
    </div>
  );
}
