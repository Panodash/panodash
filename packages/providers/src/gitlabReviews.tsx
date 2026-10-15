import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  ageTone,
  DEFAULT_GITLAB_ORIGIN,
  GITLAB_CONNECTION,
  gitlabErrorSnapshot,
  gitlabHostPermissionOrigins,
  gitlabPaginate,
  gitlabProjectNameFromUrl,
  parseGitLabOrigin,
} from './gitlabShared';

interface Config {
  host: string;
  maxItems: number;
  pollMinutes: number;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  draft?: boolean;
  work_in_progress?: boolean;
  changes_count?: string | null;
  author?: { id: number; username: string };
  references?: { full?: string };
}

export function mergeRequestItems(
  requests: GitLabMergeRequest[],
  maxItems: number,
  now = Date.now(),
): FeedItem[] {
  return requests.slice(0, Math.max(1, maxItems)).map((request) => ({
    id: String(request.id),
    title: request.title,
    url: request.web_url,
    subtitle: `${gitlabProjectNameFromUrl(request.web_url)} · !${request.iid}`,
    badge: ageLabel(request.created_at, now),
    tone: ageTone(request.created_at, now),
  }));
}

async function fetchReviews(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const origin = parseGitLabOrigin(config.host);
  if (!origin) {
    return { fetchedAt: Date.now(), error: 'Enter a valid GitLab host URL', errorCode: 'parse' };
  }
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  try {
    const query = new URLSearchParams({
      scope: 'reviews_for_me',
      state: 'opened',
      non_archived: 'true',
      order_by: 'created_at',
      sort: 'asc',
    });
    const result = await gitlabPaginate<GitLabMergeRequest>(`/merge_requests?${query}`, {
      origin,
      requiresAuth: true,
      maxPages: 5,
    });
    return {
      fetchedAt: Date.now(),
      value: result.items.length,
      display: result.truncated ? `${result.items.length}+` : undefined,
      items: mergeRequestItems(result.items, maxItems),
      meta: {
        url: `${origin}/dashboard/merge_requests?assignee_username=`,
        truncated: result.truncated,
      },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabReviewsWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  if (snapshot?.errorCode === 'auth') {
    return <div className="feed-empty">Add a GitLab token in this widget’s settings to see review requests.</div>;
  }
  if (items.length === 0) {
    return (
      <div className="github-clear">
        <span className="github-status-dot status-good" aria-hidden="true" />
        No merge requests are waiting on you.
      </div>
    );
  }
  return (
    <div className="feed">
      <div className="feed-count feed-count-attention">
        {snapshot?.display ?? snapshot?.value} review{snapshot?.value === 1 ? '' : 's'} requested
      </div>
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.id} className="feed-item">
            <span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span>
            <a href={item.url} target="_blank" rel="noreferrer" title={item.title}>
              {item.title}
            </a>
            <span className="feed-sub">{item.subtitle}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const gitlabReviewsProvider: WidgetProvider = {
  type: 'gitlab-reviews',
  name: 'GitLab review queue',
  description: 'Merge requests waiting for your review, with age at a glance.',
  icon: '⌕',
  kind: 'feed',
  auth: 'local-token',
  connection: { ...GITLAB_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  setupNote: 'Use a GitLab personal access token with the read_api scope.',
  configFields: [
    {
      key: 'host',
      label: 'GitLab host',
      type: 'url',
      required: true,
      placeholder: DEFAULT_GITLAB_ORIGIN,
      help: 'Change this for a self-managed GitLab instance.',
    },
    { key: 'maxItems', label: 'Merge requests to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { host: DEFAULT_GITLAB_ORIGIN, maxItems: 6, pollMinutes: 15 },
  defaultTitle: () => 'Review queue',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 15),
  permissionOrigins: gitlabHostPermissionOrigins,
  fetchSnapshot: fetchReviews,
  component: GitLabReviewsWidget,
};
