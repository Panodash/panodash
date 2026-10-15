import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  prioritizePullRequests,
  startOfWeekDate,
  type MyPullRequest,
} from './githubMyPrs';
import {
  DEFAULT_GITLAB_ORIGIN,
  GITLAB_CONNECTION,
  gitlabApi,
  gitlabErrorSnapshot,
  gitlabHostPermissionOrigins,
  gitlabPaginate,
  gitlabProjectNameFromUrl,
  parseGitLabOrigin,
  ageLabel,
} from './gitlabShared';
import type { GitLabMergeRequest } from './gitlabReviews';

interface Config {
  host: string;
  maxItems: number;
  sizeThreshold: number;
  reviewWarningHours: number;
  pollMinutes: number;
}

interface DetailResponse extends GitLabMergeRequest {
  changes_count?: string | null;
}

interface ReviewerResponse {
  state: 'unreviewed' | 'reviewed';
  created_at: string;
}

interface Meta {
  open: number;
  mergedThisWeek: number;
  openUrl: string;
  mergedUrl: string;
  pulls: MyPullRequest[];
}

function changeSizeSignal(
  pull: Pick<MyPullRequest, 'additions'>,
  threshold: number,
): { label: string; tone: 'warning' | 'danger' } | null {
  const files = pull.additions;
  const limit = Math.max(1, threshold);
  if (files < limit) return null;
  return {
    label: `${files.toLocaleString()} files`,
    tone: files >= limit * 2 ? 'danger' : 'warning',
  };
}

function mergeRequestReviewSignal(
  pull: Pick<MyPullRequest, 'createdAt' | 'firstReviewAt' | 'isDraft'>,
  warningHours: number,
  now = Date.now(),
): { label: string; tone: 'neutral' | 'good' | 'warning' | 'danger' } {
  if (pull.isDraft) return { label: 'Draft', tone: 'neutral' };
  if (pull.firstReviewAt) return { label: 'Reviewed', tone: 'good' };
  const elapsedHours = Math.max(0, now - Date.parse(pull.createdAt)) / 3_600_000;
  const threshold = Math.max(1, warningHours);
  return {
    label: `Waiting ${ageLabel(pull.createdAt, now)}`,
    tone:
      elapsedHours >= threshold * 2
        ? 'danger'
        : elapsedHours >= threshold
          ? 'warning'
          : 'neutral',
  };
}

function numericChangeCount(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function enrichMergeRequest(
  request: GitLabMergeRequest,
  origin: string,
): Promise<MyPullRequest> {
  const base = `/projects/${request.project_id}/merge_requests/${request.iid}`;
  const [detail, reviewers] = await Promise.all([
    gitlabApi<DetailResponse>(base, { origin, requiresAuth: true }),
    gitlabApi<ReviewerResponse[]>(`${base}/reviewers`, { origin, requiresAuth: true }).catch(
      () => [],
    ),
  ]);
  const firstReviewAt = reviewers
    .filter((reviewer) => reviewer.state === 'reviewed')
    .map((reviewer) => reviewer.created_at)
    .sort()[0];
  return {
    id: String(request.id),
    number: request.iid,
    title: request.title,
    url: request.web_url,
    repository: gitlabProjectNameFromUrl(request.web_url),
    isDraft: detail.draft ?? detail.work_in_progress ?? false,
    createdAt: detail.created_at || request.created_at,
    additions: numericChangeCount(detail.changes_count),
    deletions: 0,
    firstReviewAt,
  };
}

async function fetchMyMrs(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const origin = parseGitLabOrigin(config.host);
  if (!origin) {
    return { fetchedAt: Date.now(), error: 'Enter a valid GitLab host URL', errorCode: 'parse' };
  }
  const maxItems = Math.min(10, Math.max(1, Number(config.maxItems) || 6));
  const weekStart = startOfWeekDate();
  try {
    const openQuery = new URLSearchParams({
      scope: 'created_by_me',
      state: 'opened',
      non_archived: 'true',
      order_by: 'created_at',
      sort: 'asc',
    });
    const mergedQuery = new URLSearchParams({
      scope: 'created_by_me',
      state: 'merged',
      order_by: 'merged_at',
      sort: 'desc',
      updated_after: `${weekStart}T00:00:00Z`,
    });
    const [open, merged] = await Promise.all([
      gitlabPaginate<GitLabMergeRequest>(`/merge_requests?${openQuery}`, {
        origin,
        requiresAuth: true,
        maxPages: 5,
      }),
      gitlabPaginate<GitLabMergeRequest>(`/merge_requests?${mergedQuery}`, {
        origin,
        requiresAuth: true,
        maxPages: 5,
      }),
    ]);
    const detailed = await Promise.all(open.items.slice(0, maxItems * 2).map((mr) => enrichMergeRequest(mr, origin)));
    const pulls = prioritizePullRequests(detailed).slice(0, maxItems);
    const mergedThisWeek = merged.items.filter(
      (request) => request.merged_at && request.merged_at >= `${weekStart}T00:00:00Z`,
    ).length;
    return {
      fetchedAt: Date.now(),
      value: open.items.length,
      display: open.truncated ? `${open.items.length}+` : undefined,
      meta: {
        open: open.items.length,
        mergedThisWeek,
        openUrl: `${origin}/dashboard/merge_requests?scope=created_by_me&state=opened`,
        mergedUrl: `${origin}/dashboard/merge_requests?scope=created_by_me&state=merged`,
        pulls,
      } satisfies Meta,
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function SummaryMetric({ value, label, url }: { value: number; label: string; url: string }) {
  return (
    <a className="github-pr-metric" href={url} target="_blank" rel="noreferrer">
      <strong>{value}</strong>
      <span>{label}</span>
    </a>
  );
}

function GitLabMyMrsWidget({ instance, snapshot }: WidgetComponentProps) {
  const config = instance.config as unknown as Config;
  const meta = snapshot?.meta as unknown as Meta | undefined;
  if (snapshot?.errorCode === 'auth') {
    return <div className="feed-empty">Add a GitLab token in this widget’s settings to see your merge requests.</div>;
  }
  const pulls = meta?.pulls ?? [];
  return (
    <div className="github-prs">
      <div className="github-pr-summary">
        <SummaryMetric value={meta?.open ?? 0} label="open MRs" url={meta?.openUrl ?? '#'} />
        <SummaryMetric value={meta?.mergedThisWeek ?? 0} label="merged this week" url={meta?.mergedUrl ?? '#'} />
      </div>
      {pulls.length === 0 ? (
        <div className="github-clear">
          <span className="github-status-dot status-good" aria-hidden="true" />
          No open merge requests.
        </div>
      ) : (
        <ul className="github-pr-list">
          {pulls.map((pull) => {
            const review = mergeRequestReviewSignal(
              pull,
              Number(config.reviewWarningHours) || 24,
            );
            const size = changeSizeSignal(pull, Number(config.sizeThreshold) || 100);
            return (
              <li key={pull.id} className="github-pr-item">
                <div className="github-pr-main">
                  <a href={pull.url} target="_blank" rel="noreferrer" title={pull.title}>{pull.title}</a>
                  <span className={`feed-badge tone-${review.tone}`}>{review.label}</span>
                  {size && <span className={`feed-badge tone-${size.tone}`}>{size.label}</span>}
                </div>
                <div className="github-pr-meta">
                  {pull.repository} · !{pull.number} · {pull.additions.toLocaleString()} changed files
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const gitlabMyMrsProvider: WidgetProvider = {
  type: 'gitlab-my-mrs',
  name: 'My GitLab MRs',
  description: 'Open merge requests, weekly merges, review wait, and size warnings.',
  icon: '↗',
  kind: 'feed',
  auth: 'local-token',
  connection: { ...GITLAB_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  setupNote: 'Use a GitLab personal access token with the read_api scope.',
  configFields: [
    { key: 'host', label: 'GitLab host', type: 'url', required: true, placeholder: DEFAULT_GITLAB_ORIGIN },
    { key: 'maxItems', label: 'Merge requests to show', type: 'number', min: 1, max: 10, step: 1 },
    { key: 'sizeThreshold', label: 'Large MR threshold (changed files)', type: 'number', min: 10, max: 1000, step: 10 },
    { key: 'reviewWarningHours', label: 'Warn after no review (hours)', type: 'number', min: 1, max: 336, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: {
    host: DEFAULT_GITLAB_ORIGIN,
    maxItems: 6,
    sizeThreshold: 100,
    reviewWarningHours: 24,
    pollMinutes: 15,
  },
  defaultTitle: () => 'My merge requests',
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 15),
  permissionOrigins: gitlabHostPermissionOrigins,
  fetchSnapshot: fetchMyMrs,
  component: GitLabMyMrsWidget,
};
