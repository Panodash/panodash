import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  ageTone,
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
} from './githubShared';

interface GitHubReviewsConfig {
  maxItems: number;
  pollMinutes: number;
}

export interface GitHubSearchIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  created_at: string;
  user?: { login?: string };
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchIssue[];
}

export function reviewFeedItems(
  issues: GitHubSearchIssue[],
  maxItems: number,
  now = Date.now(),
): FeedItem[] {
  return issues.slice(0, Math.max(1, maxItems)).map((issue) => {
    const repository = issue.repository_url.split('/').slice(-2).join('/');
    return {
      id: String(issue.id),
      title: issue.title,
      url: issue.html_url,
      subtitle: `${repository} · #${issue.number}`,
      badge: ageLabel(issue.created_at, now),
      tone: ageTone(issue.created_at, now),
    };
  });
}

async function fetchReviews(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubReviewsConfig;
  try {
    const query = new URLSearchParams({
      q: 'is:pr is:open review-requested:@me archived:false',
      sort: 'created',
      order: 'asc',
      per_page: String(Math.min(20, Math.max(1, Number(config.maxItems) || 6))),
    });
    const data = await githubApi<GitHubSearchResponse>(`/search/issues?${query}`, {
      requiresAuth: true,
    });
    return {
      fetchedAt: Date.now(),
      value: data.total_count,
      items: reviewFeedItems(data.items, Number(config.maxItems) || 6),
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubReviewsWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  if (snapshot?.errorCode === 'auth') {
    return <div className="feed-empty">Add a GitHub token in this widget’s settings to see review requests.</div>;
  }
  if (items.length === 0) {
    return (
      <div className="github-clear">
        <span className="github-status-dot status-good" aria-hidden="true" />
        No pull requests are waiting on you.
      </div>
    );
  }
  return (
    <div className="feed">
      <div className="feed-count feed-count-attention">
        {snapshot?.value} review{snapshot?.value === 1 ? '' : 's'} requested
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
    </div>
  );
}

export const githubReviewsProvider: WidgetProvider = {
  type: 'github-reviews',
  name: 'GitHub review queue',
  description: 'Pull requests waiting for your review, with age at a glance.',
  icon: '⌕',
  kind: 'feed',
  auth: 'local-token',
  connection: { ...GITHUB_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  setupNote:
    'The token identifies your GitHub account. Fine-grained tokens should grant read-only Pull requests access to the repositories you want included.',
  configFields: [
    { key: 'maxItems', label: 'Pull requests to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { maxItems: 6, pollMinutes: 15 },
  defaultTitle: () => 'Review queue',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 15),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchReviews,
  component: GitHubReviewsWidget,
};
