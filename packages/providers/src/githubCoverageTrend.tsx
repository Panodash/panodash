import { getConnectionSecret } from '@panodash/core/connections';
import type {
  LocalConnectionRequirement,
  Snapshot,
  WidgetComponentProps,
  WidgetProvider,
} from '@panodash/widget-sdk';
import { parseGitHubRepo } from './githubShared';

type CoverageInterval = '1d' | '7d';
type CoverageTone = 'neutral' | 'good' | 'danger';

interface GitHubCoverageTrendConfig {
  repository: string;
  branch: string;
  interval: CoverageInterval;
  lookbackDays: number;
  pollMinutes: number;
}

export interface CodecovCoverageMeasurement {
  timestamp: string;
  min: number;
  max: number;
  avg: number;
}

interface CodecovCoverageResponse {
  count: number;
  results: CodecovCoverageMeasurement[];
}

export interface CoverageSignal {
  current: number | null;
  previous: number | null;
  delta: number | null;
  tone: CoverageTone;
}

interface CoverageMeta {
  repository: string;
  branch: string | null;
  interval: CoverageInterval;
  url: string;
  delta: number | null;
  previous: number | null;
  tone: CoverageTone;
  points: CodecovCoverageMeasurement[];
}

const CODECOV_API_ROOT = 'https://api.codecov.io';
const CODECOV_CONNECTION: LocalConnectionRequirement = {
  id: 'codecov',
  name: 'Codecov',
  secretLabel: 'Codecov API access token',
  placeholder: 'Optional for public repositories',
  help:
    'Stored locally and used only for Codecov coverage. Public repositories usually work without a token; private repositories need a Codecov access token.',
};

function normalizeCoveragePoints(
  points: CodecovCoverageMeasurement[],
): CodecovCoverageMeasurement[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.avg) &&
        Number.isFinite(point.min) &&
        Number.isFinite(point.max) &&
        Number.isFinite(Date.parse(point.timestamp)),
    )
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function coverageSignal(points: CodecovCoverageMeasurement[]): CoverageSignal {
  const ordered = normalizeCoveragePoints(points);
  const current = ordered.at(-1)?.avg ?? null;
  const previous = ordered.at(-2)?.avg ?? null;
  if (current === null || previous === null) {
    return { current, previous, delta: null, tone: 'neutral' };
  }
  const delta = current - previous;
  const tone: CoverageTone = delta > 0.05 ? 'good' : delta < -0.05 ? 'danger' : 'neutral';
  return { current, previous, delta, tone };
}

export function coverageDeltaLabel(delta: number | null): string {
  if (delta === null) return 'Baseline';
  if (Math.abs(delta) < 0.05) return 'No change';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pp`;
}

export function coverageSparkline(points: CodecovCoverageMeasurement[]): string {
  const ordered = normalizeCoveragePoints(points);
  if (ordered.length === 0) return '';
  const values = ordered.map((point) => point.avg);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  return ordered
    .map((point, index) => {
      const x = ordered.length === 1 ? 50 : (index / (ordered.length - 1)) * 100;
      const y = 25 - ((point.avg - minimum) / range) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

async function codecovApi<T>(path: string): Promise<T> {
  const token = await getConnectionSecret(CODECOV_CONNECTION.id);
  const request = (secret?: string) =>
    fetch(`${CODECOV_API_ROOT}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
    });
  let response = await request(token);
  if ((response.status === 401 || response.status === 403) && token) {
    response = await request();
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Codecov access was denied — connect a token with access to this repository');
    }
    if (response.status === 404) {
      throw new Error('Repository not found in Codecov, or no coverage has been uploaded');
    }
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(`Codecov HTTP ${response.status}${body?.detail ? `: ${body.detail}` : ''}`);
  }
  return response.json() as Promise<T>;
}

async function fetchCoverageTrend(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubCoverageTrendConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const branch = config.branch?.trim();
  const interval: CoverageInterval = config.interval === '7d' ? '7d' : '1d';
  const lookbackDays = Math.min(90, Math.max(14, Number(config.lookbackDays) || 30));
  const startDate = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const query = new URLSearchParams({
    interval,
    start_date: startDate,
    page_size: '100',
  });
  if (branch) query.set('branch', branch);

  try {
    const data = await codecovApi<CodecovCoverageResponse>(
      `/api/v2/github/${encodeURIComponent(repo.owner)}/repos/${encodeURIComponent(repo.repo)}/coverage/?${query}`,
    );
    const points = normalizeCoveragePoints(data.results);
    const signal = coverageSignal(points);
    if (signal.current === null) {
      return {
        fetchedAt: Date.now(),
        error: 'Codecov has no coverage measurements for this repository and branch',
        errorCode: 'parse',
      };
    }
    return {
      fetchedAt: Date.now(),
      value: signal.current,
      display: `${signal.current.toFixed(1)}%`,
      meta: {
        repository: repo.fullName,
        branch: branch || null,
        interval,
        delta: signal.delta,
        previous: signal.previous,
        tone: signal.tone,
        points: points.slice(-30),
        url: `https://app.codecov.io/gh/${repo.fullName}`,
      } satisfies CoverageMeta,
    };
  } catch (error) {
    return {
      fetchedAt: Date.now(),
      error: error instanceof Error ? error.message : 'Codecov request failed',
      errorCode: 'http',
    };
  }
}

function GitHubCoverageTrendWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as CoverageMeta | undefined;
  const points = meta?.points ?? [];
  return (
    <a className="github-coverage" href={meta?.url} target="_blank" rel="noreferrer">
      <div className="github-coverage-heading">
        <div>
          <strong>{snapshot?.display ?? '—'}</strong>
          <span>project coverage</span>
        </div>
        <span className={`feed-badge tone-${meta?.tone ?? 'neutral'}`}>
          {coverageDeltaLabel(meta?.delta ?? null)}
        </span>
      </div>
      <svg
        className={`github-coverage-chart tone-${meta?.tone ?? 'neutral'}`}
        viewBox="0 0 100 28"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline points={coverageSparkline(points)} />
      </svg>
      <div className="github-coverage-meta">
        <span>{meta?.branch || 'Default branch'} · {meta?.interval === '7d' ? 'weekly' : 'daily'}</span>
        <span>{points.length} points · Codecov</span>
      </div>
    </a>
  );
}

export const githubCoverageTrendProvider: WidgetProvider = {
  type: 'github-coverage-trend',
  name: 'GitHub coverage trend',
  description: 'Current project coverage and recent direction from Codecov.',
  icon: '%',
  kind: 'metric',
  auth: 'none',
  connection: { ...CODECOV_CONNECTION, required: false },
  defaultSize: { w: 2, h: 1 },
  configFields: [
    {
      key: 'repository',
      label: 'GitHub repository',
      type: 'text',
      required: true,
      placeholder: 'owner/repo',
      help: 'The repository must upload coverage to Codecov. Public Codecov data needs no token.',
    },
    {
      key: 'branch',
      label: 'Branch (optional)',
      type: 'text',
      placeholder: 'main',
      help: 'Leave blank to use the default branch configured in Codecov.',
    },
    {
      key: 'interval',
      label: 'Trend interval',
      type: 'select',
      options: [
        { value: '1d', label: 'Daily' },
        { value: '7d', label: 'Weekly' },
      ],
    },
    { key: 'lookbackDays', label: 'Look back (days)', type: 'number', min: 14, max: 90, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 30, max: 1440, step: 30 },
  ],
  defaultConfig: {
    repository: '',
    branch: '',
    interval: '1d',
    lookbackDays: 30,
    pollMinutes: 60,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} coverage` : 'Coverage trend';
  },
  pollMinutes: (config) => Math.max(30, Number(config.pollMinutes) || 60),
  permissionOrigins: () => [`${CODECOV_API_ROOT}/*`],
  fetchSnapshot: fetchCoverageTrend,
  component: GitHubCoverageTrendWidget,
};
