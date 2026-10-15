import type { ReactNode } from 'react';
import type { Direction, Goal, Sample } from '@panodash/widget-sdk';
import { computeDelta, computeStreak } from '@panodash/core/series';
import { formatDelta, formatValue, withUnit } from '@panodash/core/format';
import { Sparkline } from './Sparkline';

interface StatTileProps {
  value?: number;
  display?: string;
  unit?: string;
  decimals?: number;
  direction?: Direction;
  samples: Sample[];
  goal?: Goal;
  footer?: ReactNode;
}

/**
 * The stat-tile contract: value (semibold, compact), optional delta vs a
 * named period (color = direction x whether up is good), optional 12-point
 * sparkline. An active goal streak rides the delta line so the tile never
 * grows taller. The label lives in the widget shell header.
 */
export function StatTile({
  value,
  display,
  unit,
  decimals,
  direction = 'neutral',
  samples,
  goal,
  footer,
}: StatTileProps) {
  const delta = computeDelta(samples);
  const showDelta = !!delta && delta.delta !== 0;
  const streak = goal ? computeStreak(samples, goal) : 0;
  const deltaClass =
    !delta || delta.delta === 0 || direction === 'neutral'
      ? 'delta-neutral'
      : (delta.delta > 0) === (direction === 'up-good')
        ? 'delta-good'
        : 'delta-bad';
  const sinceLabel = delta
    ? Date.now() - delta.since > 20 * 60 * 60 * 1000
      ? 'vs yesterday'
      : 'vs previous'
    : null;

  return (
    <div className={`stat-tile${footer ? ' has-footer' : ''}`}>
      <div className="stat-value">
        {display ?? (value !== undefined ? withUnit(formatValue(value, decimals), unit) : '—')}
      </div>
      {(showDelta || streak > 0) && (
        <div className={`stat-delta ${deltaClass}`}>
          {showDelta && (
            <>
              {formatDelta(delta.delta, decimals)}{' '}
              <span className="stat-delta-period">{sinceLabel}</span>
            </>
          )}
          {streak > 0 && (
            <span className="stat-streak">
              {showDelta ? ' · ' : ''}🔥 {streak}-day streak
            </span>
          )}
        </div>
      )}
      <div className="stat-spacer" />
      {footer}
      <Sparkline samples={samples} height={footer ? 26 : 36} />
    </div>
  );
}
