import { formatValue } from '@panodash/core/format';
import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

type TrafficMetric = 'visitors' | 'views' | 'cloners' | 'clones';

interface GitHubTrafficConfig {
  repository: string;
  primaryMetric: TrafficMetric;
  pollMinutes: number;
}

export interface GitHubTrafficPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

interface GitHubViewsResponse {
  count: number;
  uniques: number;
  views: GitHubTrafficPoint[];
}

interface GitHubClonesResponse {
  count: number;
  uniques: number;
  clones: GitHubTrafficPoint[];
}

interface TrafficMeta {
  repository: string;
  url: string;
  primaryMetric: TrafficMetric;
  views: number;
  uniqueVisitors: number;
  clones: number;
  uniqueCloners: number;
  viewsDelta: number | null;
  clonesDelta: number | null;
}

export function trafficCountDelta(
  points: GitHubTrafficPoint[],
  windowDays = 7,
): number | null {
  const ordered = [...points].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  const window = Math.max(1, Math.floor(windowDays));
  if (ordered.length < window * 2) return null;
  const recent = ordered.slice(-window).reduce((sum, point) => sum + Math.max(0, point.count), 0);
  const previous = ordered
    .slice(-window * 2, -window)
    .reduce((sum, point) => sum + Math.max(0, point.count), 0);
  if (previous === 0) return recent === 0 ? 0 : null;
  return ((recent - previous) / previous) * 100;
}

export function trafficTrendLabel(delta: number | null): string {
  if (delta === null) return 'Trend pending';
  if (Math.abs(delta) < 0.5) return 'Steady';
  const rounded = Math.round(Math.abs(delta));
  return `${delta > 0 ? '↑' : '↓'} ${rounded}%`;
}

function trafficTone(delta: number | null): 'neutral' | 'good' | 'warning' {
  if (delta === null || Math.abs(delta) < 0.5) return 'neutral';
  return delta > 0 ? 'good' : 'warning';
}

async function fetchGitHubTraffic(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubTrafficConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const primaryMetric: TrafficMetric =
    config.primaryMetric === 'views' ||
    config.primaryMetric === 'cloners' ||
    config.primaryMetric === 'clones'
      ? config.primaryMetric
      : 'visitors';

  try {
    const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/traffic`;
    const [views, clones] = await Promise.all([
      githubApi<GitHubViewsResponse>(`${base}/views?per=day`, { requiresAuth: true }),
      githubApi<GitHubClonesResponse>(`${base}/clones?per=day`, { requiresAuth: true }),
    ]);
    const metrics: Record<TrafficMetric, number> = {
      visitors: views.uniques,
      views: views.count,
      cloners: clones.uniques,
      clones: clones.count,
    };
    return {
      fetchedAt: Date.now(),
      value: metrics[primaryMetric],
      display: formatValue(metrics[primaryMetric]),
      meta: {
        repository: repo.fullName,
        primaryMetric,
        views: views.count,
        uniqueVisitors: views.uniques,
        clones: clones.count,
        uniqueCloners: clones.uniques,
        viewsDelta: trafficCountDelta(views.views),
        clonesDelta: trafficCountDelta(clones.clones),
        url: `https://github.com/${repo.fullName}/graphs/traffic`,
      } satisfies TrafficMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

const METRIC_LABELS: Record<TrafficMetric, string> = {
  visitors: 'unique visitors',
  views: 'views',
  cloners: 'unique cloners',
  clones: 'clones',
};

function GitHubTrafficWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as TrafficMeta | undefined;
  const primaryMetric = meta?.primaryMetric ?? 'visitors';
  return (
    <a className="github-traffic" href={meta?.url} target="_blank" rel="noreferrer">
      <div className="github-traffic-heading">
        <div>
          <strong>{snapshot?.display ?? '—'}</strong>
          <span>{METRIC_LABELS[primaryMetric]} · past 14 days</span>
        </div>
        <span className={`feed-badge tone-${trafficTone(meta?.viewsDelta ?? null)}`}>
          Views {trafficTrendLabel(meta?.viewsDelta ?? null)}
        </span>
      </div>
      <div className="github-traffic-grid">
        <div><strong>{formatValue(meta?.uniqueVisitors ?? 0)}</strong><span>Visitors</span></div>
        <div><strong>{formatValue(meta?.views ?? 0)}</strong><span>Views</span></div>
        <div><strong>{formatValue(meta?.uniqueCloners ?? 0)}</strong><span>Cloners</span></div>
        <div><strong>{formatValue(meta?.clones ?? 0)}</strong><span>Clones</span></div>
      </div>
      <div className="github-traffic-foot">
        <span>GitHub Insights</span>
        <span className={`tone-${trafficTone(meta?.clonesDelta ?? null)}`}>
          Clones {trafficTrendLabel(meta?.clonesDelta ?? null)}
        </span>
      </div>
    </a>
  );
}

export const githubTrafficProvider: WidgetProvider = {
  type: 'github-traffic',
  name: 'GitHub repository traffic',
  description: 'Visitors, views, cloners, and clones from GitHub Insights.',
  icon: '↗',
  kind: 'metric',
  auth: 'none',
  connection: { ...GITHUB_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  configFields: [
    {
      key: 'repository',
      label: 'Repository',
      type: 'text',
      required: true,
      placeholder: 'owner/repo',
      help: 'Requires push access. Fine-grained tokens need Administration: read.',
    },
    {
      key: 'primaryMetric',
      label: 'Headline metric',
      type: 'select',
      options: [
        { value: 'visitors', label: 'Unique visitors' },
        { value: 'views', label: 'Views' },
        { value: 'cloners', label: 'Unique cloners' },
        { value: 'clones', label: 'Clones' },
      ],
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 60, max: 1440, step: 60 },
  ],
  defaultConfig: {
    repository: '',
    primaryMetric: 'visitors',
    pollMinutes: 60,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} traffic` : 'Repository traffic';
  },
  pollMinutes: (config) => Math.max(60, Number(config.pollMinutes) || 60),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchGitHubTraffic,
  component: GitHubTrafficWidget,
};
