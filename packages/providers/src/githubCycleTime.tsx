import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

interface GitHubCycleTimeConfig {
  repository: string;
  windowDays: number;
  warningHours: number;
  dangerHours: number;
  maxItems: number;
  pollMinutes: number;
}

export interface GitHubCyclePullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  user: { login: string } | null;
}

type CycleTimeTone = 'neutral' | 'good' | 'warning' | 'danger';

export interface CycleTimeStats {
  count: number;
  averageHours: number;
  medianHours: number;
  p90Hours: number;
  tone: CycleTimeTone;
}

interface CycleTimeMeta extends CycleTimeStats {
  repository: string;
  windowDays: number;
  warningHours: number;
  dangerHours: number;
  url: string;
  truncated: boolean;
  scannedCount: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function cycleHours(pull: GitHubCyclePullRequest): number | null {
  if (!pull.merged_at) return null;
  const created = Date.parse(pull.created_at);
  const merged = Date.parse(pull.merged_at);
  if (!Number.isFinite(created) || !Number.isFinite(merged) || merged < created) return null;
  return (merged - created) / 3_600_000;
}

export function cycleWindowStart(windowDays: number, now = Date.now()): string {
  const days = Math.min(365, Math.max(1, windowDays));
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

export function formatCycleDuration(hours: number): string {
  const safeHours = Math.max(0, hours);
  if (safeHours < 1) return '<1h';
  if (safeHours < 24) return `${Math.round(safeHours)}h`;
  const days = roundOne(safeHours / 24);
  return `${Number.isInteger(days) ? days.toFixed(0) : days.toFixed(1)}d`;
}

function durationTone(
  hours: number,
  warningHours: number,
  dangerHours: number,
): CycleTimeTone {
  if (hours >= dangerHours) return 'danger';
  if (hours >= warningHours) return 'warning';
  return 'good';
}

export function cycleTimeStats(
  pulls: GitHubCyclePullRequest[],
  warningHours: number,
  dangerHours: number,
): CycleTimeStats {
  const durations = pulls
    .map(cycleHours)
    .filter((duration): duration is number => duration !== null)
    .sort((left, right) => left - right);
  if (durations.length === 0) {
    return {
      count: 0,
      averageHours: 0,
      medianHours: 0,
      p90Hours: 0,
      tone: 'neutral',
    };
  }
  const averageHours = roundOne(
    durations.reduce((total, duration) => total + duration, 0) / durations.length,
  );
  const midpoint = Math.floor(durations.length / 2);
  const medianHours = roundOne(
    durations.length % 2 === 0
      ? (durations[midpoint - 1] + durations[midpoint]) / 2
      : durations[midpoint],
  );
  const p90Index = Math.max(0, Math.ceil(durations.length * 0.9) - 1);
  const p90Hours = roundOne(durations[p90Index]);
  return {
    count: durations.length,
    averageHours,
    medianHours,
    p90Hours,
    tone: durationTone(
      averageHours,
      Math.max(1, warningHours),
      Math.max(Math.max(1, warningHours), dangerHours),
    ),
  };
}

export function cycleTimeItems(
  pulls: GitHubCyclePullRequest[],
  maxItems: number,
  warningHours: number,
  dangerHours: number,
  now = Date.now(),
): FeedItem[] {
  return pulls
    .map((pull) => ({ pull, hours: cycleHours(pull) }))
    .filter(
      (entry): entry is { pull: GitHubCyclePullRequest; hours: number } =>
        entry.hours !== null,
    )
    .sort((left, right) => right.hours - left.hours)
    .slice(0, Math.max(1, maxItems))
    .map(({ pull, hours }) => ({
      id: String(pull.id),
      title: pull.title,
      url: pull.html_url,
      subtitle: `${pull.user?.login ? `@${pull.user.login}` : 'Unknown author'} · #${pull.number} · merged ${ageLabel(pull.merged_at ?? '', now)} ago`,
      badge: formatCycleDuration(hours),
      tone: durationTone(
        hours,
        Math.max(1, warningHours),
        Math.max(Math.max(1, warningHours), dangerHours),
      ),
    }));
}

async function fetchMergedPullRequests(
  owner: string,
  repo: string,
  windowStart: number,
): Promise<{ pulls: GitHubCyclePullRequest[]; scannedCount: number; truncated: boolean }> {
  const mergedPulls: GitHubCyclePullRequest[] = [];
  let scannedCount = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await githubApi<GitHubCyclePullRequest[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`,
    );
    scannedCount += batch.length;
    mergedPulls.push(
      ...batch.filter(
        (pull) => pull.merged_at && Date.parse(pull.merged_at) >= windowStart,
      ),
    );
    const oldestUpdated = batch.at(-1)?.updated_at;
    if (
      batch.length < PAGE_SIZE ||
      (oldestUpdated && Date.parse(oldestUpdated) < windowStart)
    ) {
      return { pulls: mergedPulls, scannedCount, truncated: false };
    }
  }
  return { pulls: mergedPulls, scannedCount, truncated: true };
}

async function fetchCycleTime(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubCycleTimeConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const windowDays = Math.min(365, Math.max(1, Number(config.windowDays) || 30));
  const warningHours = Math.min(8_760, Math.max(1, Number(config.warningHours) || 48));
  const dangerHours = Math.min(
    8_760,
    Math.max(warningHours, Number(config.dangerHours) || 96),
  );
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 4));
  const windowStart = Date.parse(cycleWindowStart(windowDays));
  const query = `is:pr is:merged merged:>=${new Date(windowStart).toISOString().slice(0, 10)} sort:updated-desc`;

  try {
    const result = await fetchMergedPullRequests(repo.owner, repo.repo, windowStart);
    const stats = cycleTimeStats(result.pulls, warningHours, dangerHours);
    return {
      fetchedAt: Date.now(),
      value: stats.averageHours,
      display: stats.count > 0 ? formatCycleDuration(stats.averageHours) : undefined,
      items: cycleTimeItems(
        result.pulls,
        maxItems,
        warningHours,
        dangerHours,
      ),
      meta: {
        ...stats,
        repository: repo.fullName,
        windowDays,
        warningHours,
        dangerHours,
        url: `https://github.com/${repo.fullName}/pulls?q=${encodeURIComponent(query)}`,
        truncated: result.truncated,
        scannedCount: result.scannedCount,
      } satisfies CycleTimeMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubCycleTimeWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as CycleTimeMeta | undefined;
  const items = snapshot?.items ?? [];
  if (meta?.count === 0) {
    return (
      <div className="github-feed-empty">
        <p className="feed-empty">
          {meta.truncated
            ? `No merges found in the latest ${meta.scannedCount} updated closed PRs.`
            : `No pull requests merged in the last ${meta.windowDays} days.`}
        </p>
        <a className="github-widget-link" href={meta.url} target="_blank" rel="noreferrer">
          View merged pull requests
        </a>
      </div>
    );
  }
  const tone = meta?.tone ?? 'neutral';
  return (
    <div className="github-cycle-time">
      <a
        className="github-cycle-summary"
        href={meta?.url}
        target="_blank"
        rel="noreferrer"
      >
        <div className="github-cycle-heading">
          <div>
            <strong>{snapshot?.display ?? '—'}</strong>
            <span>average cycle time</span>
          </div>
          <span className={`feed-badge tone-${tone}`}>
            {tone === 'good' ? 'Flowing' : tone === 'warning' ? 'Slowing' : 'Friction'}
          </span>
        </div>
        <div className="github-cycle-stats">
          <span>
            <strong>{formatCycleDuration(meta?.medianHours ?? 0)}</strong> median
          </span>
          <span>
            <strong>{formatCycleDuration(meta?.p90Hours ?? 0)}</strong> P90
          </span>
          <span>
            <strong>{meta?.count ?? 0}</strong> merged
          </span>
        </div>
      </a>
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.id} className="feed-item">
            <span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span>
            <a href={item.url} target="_blank" rel="noreferrer" title={item.title}>
              {item.title}
            </a>
            {item.subtitle && <span className="feed-sub">{item.subtitle}</span>}
          </li>
        ))}
      </ul>
      {meta?.truncated && (
        <a className="github-scan-note" href={meta.url} target="_blank" rel="noreferrer">
          Calculated from the latest {meta.scannedCount} updated closed PRs
        </a>
      )}
    </div>
  );
}

export const githubCycleTimeProvider: WidgetProvider = {
  type: 'github-cycle-time',
  name: 'GitHub PR cycle time',
  description: 'Average opening-to-merge time with median, P90, and friction signals.',
  icon: '↻',
  kind: 'metric',
  auth: 'none',
  connection: { ...GITHUB_CONNECTION, required: false },
  defaultSize: { w: 2, h: 2 },
  configFields: [
    {
      key: 'repository',
      label: 'Repository',
      type: 'text',
      required: true,
      placeholder: 'owner/repo',
      help: 'Public repositories work without a token. Private repositories need Pull requests read access.',
    },
    {
      key: 'windowDays',
      label: 'Look back (days)',
      type: 'number',
      min: 1,
      max: 365,
      step: 1,
    },
    {
      key: 'warningHours',
      label: 'Warning threshold (hours)',
      type: 'number',
      min: 1,
      max: 8_760,
      step: 1,
    },
    {
      key: 'dangerHours',
      label: 'Danger threshold (hours)',
      type: 'number',
      min: 1,
      max: 8_760,
      step: 1,
    },
    {
      key: 'maxItems',
      label: 'Slow merges to show',
      type: 'number',
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: 'pollMinutes',
      label: 'Refresh every (minutes)',
      type: 'number',
      min: 15,
      max: 1440,
      step: 15,
    },
  ],
  defaultConfig: {
    repository: '',
    windowDays: 30,
    warningHours: 48,
    dangerHours: 96,
    maxItems: 4,
    pollMinutes: 30,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} PR cycle time` : 'PR cycle time';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchCycleTime,
  component: GitHubCycleTimeWidget,
};
