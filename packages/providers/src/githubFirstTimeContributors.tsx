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

interface GitHubFirstTimeContributorsConfig {
  repository: string;
  includeDrafts: 'no' | 'yes';
  maxItems: number;
  pollMinutes: number;
}

export interface GitHubContributorPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  draft: boolean;
  author_association: string;
  user: { login: string } | null;
}

interface ContributorQueueMeta {
  repository: string;
  url: string;
  truncated: boolean;
  scannedCount: number;
}

const FIRST_TIME_ASSOCIATIONS = new Set(['FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR']);
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export function isFirstTimeContributor(pull: GitHubContributorPullRequest): boolean {
  return FIRST_TIME_ASSOCIATIONS.has(pull.author_association);
}

export function firstTimeContributorPullRequests(
  pulls: GitHubContributorPullRequest[],
  includeDrafts: boolean,
): GitHubContributorPullRequest[] {
  return pulls
    .filter((pull) => isFirstTimeContributor(pull) && (includeDrafts || !pull.draft))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

export function contributorPullRequestItems(
  pulls: GitHubContributorPullRequest[],
  maxItems: number,
  now = Date.now(),
): FeedItem[] {
  return pulls.slice(0, Math.max(1, maxItems)).map((pull) => {
    const author = pull.user?.login ? `@${pull.user.login}` : 'Unknown author';
    const context =
      pull.author_association === 'FIRST_TIMER'
        ? 'New to GitHub'
        : 'First repository contribution';
    return {
      id: String(pull.id),
      title: pull.title,
      url: pull.html_url,
      subtitle: `${author} · #${pull.number} · ${pull.draft ? 'Draft' : context}`,
      badge: ageLabel(pull.created_at, now),
      tone: pull.draft ? 'neutral' : ageTone(pull.created_at, now),
    };
  });
}

async function fetchOpenPullRequests(
  owner: string,
  repo: string,
): Promise<{ pulls: GitHubContributorPullRequest[]; truncated: boolean }> {
  const pulls: GitHubContributorPullRequest[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await githubApi<GitHubContributorPullRequest[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&sort=created&direction=asc&per_page=${PAGE_SIZE}&page=${page}`,
    );
    pulls.push(...batch);
    if (batch.length < PAGE_SIZE) return { pulls, truncated: false };
  }
  return { pulls, truncated: true };
}

async function fetchFirstTimeContributors(
  rawConfig: Record<string, unknown>,
): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubFirstTimeContributorsConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  const includeDrafts = config.includeDrafts === 'yes';
  try {
    const result = await fetchOpenPullRequests(repo.owner, repo.repo);
    const firstTimePulls = firstTimeContributorPullRequests(result.pulls, includeDrafts);
    return {
      fetchedAt: Date.now(),
      value: firstTimePulls.length,
      display: result.truncated ? `${firstTimePulls.length}+` : undefined,
      items: contributorPullRequestItems(firstTimePulls, maxItems),
      meta: {
        repository: repo.fullName,
        url: `https://github.com/${repo.fullName}/pulls?q=${encodeURIComponent(
          'is:pr is:open sort:created-asc',
        )}`,
        truncated: result.truncated,
        scannedCount: result.pulls.length,
      } satisfies ContributorQueueMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubFirstTimeContributorsWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as ContributorQueueMeta | undefined;
  const items = snapshot?.items ?? [];
  if ((snapshot?.value ?? 0) === 0) {
    if (meta?.truncated) {
      return (
        <div className="github-feed-empty">
          <p className="feed-empty">
            No matches in the oldest {meta.scannedCount} open PRs.
          </p>
          <a className="github-widget-link" href={meta.url} target="_blank" rel="noreferrer">
            Review all open pull requests
          </a>
        </div>
      );
    }
    return (
      <div className="github-clear">
        <span className="github-status-dot status-good" aria-hidden="true" />
        No first-time contributor PRs need a welcome.
      </div>
    );
  }
  return (
    <div className="feed">
      <div className="feed-count feed-count-welcome">
        {snapshot?.display ?? snapshot?.value} first-time contributor PR
        {snapshot?.display || snapshot?.value !== 1 ? 's' : ''}
      </div>
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
      {meta?.truncated && (
        <a className="github-scan-note" href={meta.url} target="_blank" rel="noreferrer">
          Showing matches from the oldest {meta.scannedCount} open PRs
        </a>
      )}
    </div>
  );
}

export const githubFirstTimeContributorsProvider: WidgetProvider = {
  type: 'github-first-time-contributors',
  name: 'GitHub first-time contributors',
  description: 'Open first-time contributor PRs, oldest first for warm welcome and triage.',
  icon: '♥',
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
      help: 'Public repositories work without a token. Private repositories need Pull requests read access.',
    },
    {
      key: 'includeDrafts',
      label: 'Draft pull requests',
      type: 'select',
      options: [
        { value: 'no', label: 'Show ready PRs only' },
        { value: 'yes', label: 'Include drafts' },
      ],
    },
    {
      key: 'maxItems',
      label: 'Pull requests to show',
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
    includeDrafts: 'no',
    maxItems: 6,
    pollMinutes: 30,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} new contributors` : 'First-time contributors';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchFirstTimeContributors,
  component: GitHubFirstTimeContributorsWidget,
};
