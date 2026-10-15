import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
} from './githubShared';

interface GitHubMyPrsConfig {
  maxItems: number;
  sizeThreshold: number;
  reviewWarningHours: number;
  pollMinutes: number;
}

interface GitHubSearchPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  created_at: string;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchPullRequest[];
}

interface GitHubPullResponse {
  additions: number;
  deletions: number;
  draft: boolean;
  created_at: string;
}

interface GitHubReviewResponse {
  submitted_at?: string;
}

export interface MyPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: string;
  isDraft: boolean;
  createdAt: string;
  additions: number;
  deletions: number;
  firstReviewAt?: string;
}

interface MyPrsMeta {
  open: number;
  mergedThisWeek: number;
  weekStart: string;
  openUrl: string;
  mergedUrl: string;
  pulls: MyPullRequest[];
}

export type AttentionTone = 'neutral' | 'good' | 'warning' | 'danger';

export function startOfWeekDate(now = Date.now()): string {
  const date = new Date(now);
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function durationLabel(milliseconds: number): string {
  const hours = Math.max(0, Math.floor(milliseconds / 3_600_000));
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function reviewSignal(
  pull: Pick<MyPullRequest, 'createdAt' | 'firstReviewAt' | 'isDraft'>,
  warningHours: number,
  now = Date.now(),
): { label: string; tone: AttentionTone } {
  if (pull.isDraft) return { label: 'Draft', tone: 'neutral' };
  if (pull.firstReviewAt) {
    return {
      label: `Reviewed in ${durationLabel(Date.parse(pull.firstReviewAt) - Date.parse(pull.createdAt))}`,
      tone: 'good',
    };
  }
  const elapsedHours = Math.max(0, now - Date.parse(pull.createdAt)) / 3_600_000;
  const threshold = Math.max(1, warningHours);
  return {
    label: `Waiting ${ageLabel(pull.createdAt, now)}`,
    tone: elapsedHours >= threshold * 2 ? 'danger' : elapsedHours >= threshold ? 'warning' : 'neutral',
  };
}

export function prSizeSignal(
  pull: Pick<MyPullRequest, 'additions' | 'deletions'>,
  threshold: number,
): { label: string; tone: 'warning' | 'danger' } | null {
  const lines = pull.additions + pull.deletions;
  const limit = Math.max(1, threshold);
  if (lines < limit) return null;
  return {
    label: `${lines.toLocaleString()} lines`,
    tone: lines >= limit * 2 ? 'danger' : 'warning',
  };
}

export function prioritizePullRequests(pulls: MyPullRequest[]): MyPullRequest[] {
  return [...pulls].sort((a, b) => {
    const rank = (pull: MyPullRequest) => (pull.isDraft ? 2 : pull.firstReviewAt ? 1 : 0);
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}

function repositoryName(repositoryUrl: string): string {
  return repositoryUrl.split('/').slice(-2).join('/');
}

async function enrichPullRequest(item: GitHubSearchPullRequest): Promise<MyPullRequest> {
  const repository = repositoryName(item.repository_url);
  const [owner, repo] = repository.split('/');
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${item.number}`;
  const [pull, reviews] = await Promise.all([
    githubApi<GitHubPullResponse>(base, { requiresAuth: true }),
    githubApi<GitHubReviewResponse[]>(`${base}/reviews?per_page=100`, { requiresAuth: true }),
  ]);
  const firstReviewAt = reviews
    .map((review) => review.submitted_at)
    .filter((submitted): submitted is string => !!submitted)
    .sort()[0];
  return {
    id: String(item.id),
    number: item.number,
    title: item.title,
    url: item.html_url,
    repository,
    isDraft: pull.draft,
    createdAt: pull.created_at || item.created_at,
    additions: pull.additions,
    deletions: pull.deletions,
    firstReviewAt,
  };
}

async function fetchMyPrs(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubMyPrsConfig;
  const maxItems = Math.min(10, Math.max(1, Number(config.maxItems) || 6));
  const weekStart = startOfWeekDate();
  try {
    const openQuery = new URLSearchParams({
      q: 'is:pr is:open author:@me archived:false',
      sort: 'created',
      order: 'asc',
      per_page: String(Math.min(20, maxItems * 2)),
    });
    const mergedQuery = new URLSearchParams({
      q: `is:pr is:merged author:@me merged:>=${weekStart}`,
      per_page: '1',
    });
    const [open, merged] = await Promise.all([
      githubApi<GitHubSearchResponse>(`/search/issues?${openQuery}`, { requiresAuth: true }),
      githubApi<GitHubSearchResponse>(`/search/issues?${mergedQuery}`, { requiresAuth: true }),
    ]);
    const detailed = await Promise.all(open.items.map(enrichPullRequest));
    const pulls = prioritizePullRequests(detailed).slice(0, maxItems);
    return {
      fetchedAt: Date.now(),
      value: open.total_count,
      meta: {
        open: open.total_count,
        mergedThisWeek: merged.total_count,
        weekStart,
        openUrl: 'https://github.com/pulls?q=is%3Aopen+is%3Apr+author%3A%40me',
        mergedUrl: `https://github.com/pulls?q=is%3Amerged+is%3Apr+author%3A%40me+merged%3A%3E%3D${weekStart}`,
        pulls,
      } satisfies MyPrsMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function SummaryMetric({
  value,
  label,
  url,
}: {
  value: number;
  label: string;
  url?: string;
}) {
  const content = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
    </>
  );
  return url ? (
    <a className="github-pr-metric" href={url} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="github-pr-metric">{content}</div>
  );
}

function GitHubMyPrsWidget({ instance, snapshot }: WidgetComponentProps) {
  const config = instance.config as unknown as GitHubMyPrsConfig;
  const meta = snapshot?.meta as unknown as MyPrsMeta | undefined;
  if (snapshot?.errorCode === 'auth') {
    return <div className="feed-empty">Add a GitHub token in this widget’s settings to see your pull requests.</div>;
  }
  const pulls = meta?.pulls ?? [];
  return (
    <div className="github-prs">
      <div className="github-pr-summary">
        <SummaryMetric value={meta?.open ?? 0} label="open PRs" url={meta?.openUrl} />
        <SummaryMetric
          value={meta?.mergedThisWeek ?? 0}
          label="merged this week"
          url={meta?.mergedUrl}
        />
      </div>
      {pulls.length === 0 ? (
        <div className="github-clear">
          <span className="github-status-dot status-good" aria-hidden="true" />
          No open pull requests.
        </div>
      ) : (
        <ul className="github-pr-list">
          {pulls.map((pull) => {
            const review = reviewSignal(pull, Number(config.reviewWarningHours) || 24);
            const size = prSizeSignal(pull, Number(config.sizeThreshold) || 500);
            return (
              <li key={pull.id} className="github-pr-item">
                <div className="github-pr-main">
                  <a href={pull.url} target="_blank" rel="noreferrer" title={pull.title}>
                    {pull.title}
                  </a>
                  <span className={`feed-badge tone-${review.tone}`}>{review.label}</span>
                  {size && <span className={`feed-badge tone-${size.tone}`}>{size.label}</span>}
                </div>
                <div className="github-pr-meta">
                  {pull.repository} · #{pull.number} · +{pull.additions.toLocaleString()} −
                  {pull.deletions.toLocaleString()}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const githubMyPrsProvider: WidgetProvider = {
  type: 'github-my-prs',
  name: 'My GitHub PRs',
  description: 'Open PRs, weekly merges, review wait, and size warnings.',
  icon: '↗',
  kind: 'feed',
  auth: 'local-token',
  connection: { ...GITHUB_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  setupNote:
    'Uses the shared GitHub connection. Fine-grained tokens should grant read-only Pull requests access to the repositories you want included.',
  configFields: [
    { key: 'maxItems', label: 'Pull requests to show', type: 'number', min: 1, max: 10, step: 1 },
    {
      key: 'sizeThreshold',
      label: 'Large PR threshold (changed lines)',
      type: 'number',
      min: 50,
      max: 10000,
      step: 50,
    },
    {
      key: 'reviewWarningHours',
      label: 'Warn after no review (hours)',
      type: 'number',
      min: 1,
      max: 336,
      step: 1,
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: {
    maxItems: 6,
    sizeThreshold: 500,
    reviewWarningHours: 24,
    pollMinutes: 15,
  },
  defaultTitle: () => 'My pull requests',
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 15),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchMyPrs,
  component: GitHubMyPrsWidget,
};
