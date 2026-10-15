import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  ageTone,
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

interface GitHubIssueTriageConfig {
  repository: string;
  maxItems: number;
  alertThreshold: number;
  pollMinutes: number;
}

export interface GitHubTriageIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  labels: Array<string | { name?: string | null }>;
}

interface GitHubIssueSearchResponse {
  total_count: number;
  items: GitHubTriageIssue[];
}

type IssueTriageTone = 'good' | 'warning' | 'danger';

interface IssueTriageMeta {
  repository: string;
  openCount: number;
  unassignedCount: number;
  unassignedPercent: number;
  tone: IssueTriageTone;
  openUrl: string;
  unassignedUrl: string;
}

export function issueTriageSignal(
  openCount: number,
  unassignedCount: number,
  alertThreshold: number,
): { unassignedPercent: number; tone: IssueTriageTone } {
  const open = Math.max(0, openCount);
  const unassigned = Math.max(0, unassignedCount);
  const threshold = Math.max(1, alertThreshold);
  const unassignedPercent =
    open === 0 ? 0 : Math.round((Math.min(open, unassigned) / open) * 100);
  const tone = unassigned === 0 ? 'good' : unassigned >= threshold ? 'danger' : 'warning';
  return { unassignedPercent, tone };
}

function issueLabel(issue: GitHubTriageIssue): string | null {
  const first = issue.labels[0];
  if (typeof first === 'string') return first || null;
  return first?.name || null;
}

export function unassignedIssueItems(
  issues: GitHubTriageIssue[],
  maxItems: number,
  now = Date.now(),
): FeedItem[] {
  return issues.slice(0, Math.max(1, maxItems)).map((issue) => {
    const label = issueLabel(issue);
    return {
      id: String(issue.id),
      title: issue.title,
      url: issue.html_url,
      subtitle: `#${issue.number}${label ? ` · ${label}` : ''}`,
      badge: ageLabel(issue.created_at, now),
      tone: ageTone(issue.created_at, now),
    };
  });
}

function issueSearchPath(query: string, perPage: number): string {
  const params = new URLSearchParams({
    q: query,
    sort: 'created',
    order: 'asc',
    per_page: String(perPage),
  });
  return `/search/issues?${params}`;
}

async function fetchIssueTriage(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubIssueTriageConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 5));
  const alertThreshold = Math.min(
    10_000,
    Math.max(1, Number(config.alertThreshold) || 5),
  );
  const openQuery = `repo:${repo.fullName} is:issue is:open`;
  const unassignedQuery = `${openQuery} no:assignee`;

  try {
    const [open, unassigned] = await Promise.all([
      githubApi<GitHubIssueSearchResponse>(issueSearchPath(openQuery, 1)),
      githubApi<GitHubIssueSearchResponse>(issueSearchPath(unassignedQuery, maxItems)),
    ]);
    const signal = issueTriageSignal(
      open.total_count,
      unassigned.total_count,
      alertThreshold,
    );
    return {
      fetchedAt: Date.now(),
      value: unassigned.total_count,
      items: unassignedIssueItems(unassigned.items, maxItems),
      meta: {
        repository: repo.fullName,
        openCount: open.total_count,
        unassignedCount: unassigned.total_count,
        unassignedPercent: signal.unassignedPercent,
        tone: signal.tone,
        openUrl: `https://github.com/${repo.fullName}/issues?q=${encodeURIComponent('is:issue is:open')}`,
        unassignedUrl: `https://github.com/${repo.fullName}/issues?q=${encodeURIComponent(
          'is:issue is:open no:assignee sort:created-asc',
        )}`,
      } satisfies IssueTriageMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubIssueTriageWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as IssueTriageMeta | undefined;
  const openCount = meta?.openCount ?? 0;
  const unassignedCount = meta?.unassignedCount ?? 0;
  const unassignedPercent = meta?.unassignedPercent ?? 0;
  const tone = meta?.tone ?? 'good';
  const items = snapshot?.items ?? [];

  return (
    <div className="github-issue-triage">
      <div className="github-issue-summary">
        <a
          className={`github-issue-metric tone-${tone}`}
          href={meta?.unassignedUrl}
          target="_blank"
          rel="noreferrer"
        >
          <strong>{unassignedCount}</strong>
          <span>unassigned</span>
        </a>
        <a
          className="github-issue-metric"
          href={meta?.openUrl}
          target="_blank"
          rel="noreferrer"
        >
          <strong>{openCount}</strong>
          <span>open</span>
        </a>
        <span className={`feed-badge tone-${tone}`}>{unassignedPercent}% need owners</span>
      </div>
      <div
        className={`github-issue-track tone-${tone}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={unassignedPercent}
        aria-label={`${unassignedPercent}% of open issues are unassigned`}
      >
        <span style={{ width: `${unassignedPercent}%` }} />
      </div>
      {unassignedCount === 0 ? (
        <div className="github-clear">
          <span className="github-status-dot status-good" aria-hidden="true" />
          {openCount === 0 ? 'No open issues.' : 'Every open issue has an owner.'}
        </div>
      ) : (
        <ul className="feed-list">
          {items.map((item) => (
            <li key={item.id} className="feed-item">
              {item.badge && (
                <span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span>
              )}
              <a href={item.url} target="_blank" rel="noreferrer" title={item.title}>
                {item.title}
              </a>
              {item.subtitle && <span className="feed-sub">{item.subtitle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const githubIssueTriageProvider: WidgetProvider = {
  type: 'github-issue-triage',
  name: 'GitHub issue triage',
  description: 'Open versus unassigned issues, with the oldest ownerless work surfaced first.',
  icon: '#',
  kind: 'feed',
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
      help: 'Public repositories work without a token. Private repositories need Issues read access.',
    },
    {
      key: 'alertThreshold',
      label: 'Turn red at this many unassigned issues',
      type: 'number',
      min: 1,
      max: 10_000,
      step: 1,
    },
    {
      key: 'maxItems',
      label: 'Unassigned issues to show',
      type: 'number',
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: 'pollMinutes',
      label: 'Refresh every (minutes)',
      type: 'number',
      min: 5,
      max: 1440,
      step: 5,
    },
  ],
  defaultConfig: {
    repository: '',
    alertThreshold: 5,
    maxItems: 5,
    pollMinutes: 15,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} issue triage` : 'Issue triage';
  },
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 15),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchIssueTriage,
  component: GitHubIssueTriageWidget,
};
