import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  ageTone,
  GITLAB_CONNECTION,
  gitlabApi,
  gitlabErrorSnapshot,
  gitlabProjectApi,
  gitlabProjectPermissionOrigins,
  parseGitLabProject,
} from './gitlabShared';
import type { GitLabMergeRequest } from './gitlabReviews';

interface Config {
  repository: string;
  includeDrafts: 'no' | 'yes';
  maxItems: number;
  pollMinutes: number;
}

export interface GitLabContributorMergeRequest extends GitLabMergeRequest {
  author: { id: number; username: string };
}

export function contributorMergeRequestItems(
  requests: GitLabContributorMergeRequest[],
  maxItems: number,
  now = Date.now(),
): FeedItem[] {
  return requests.slice(0, Math.max(1, maxItems)).map((request) => ({
    id: String(request.id),
    title: request.title,
    url: request.web_url,
    subtitle: `@${request.author.username} · !${request.iid}${request.draft || request.work_in_progress ? ' · Draft' : ''}`,
    badge: ageLabel(request.created_at, now),
    tone: request.draft || request.work_in_progress ? 'neutral' : ageTone(request.created_at, now),
  }));
}

async function hasMergedContribution(
  projectId: number,
  authorId: number,
  origin: string,
): Promise<boolean> {
  const requests = await gitlabApi<GitLabMergeRequest[]>(
    `/projects/${projectId}/merge_requests?state=merged&author_id=${authorId}&per_page=1`,
    { origin },
  );
  return requests.length > 0;
}

async function fetchFirstTimeContributors(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  if (!project) return { fetchedAt: Date.now(), error: 'Enter a project as namespace/project or a GitLab URL', errorCode: 'parse' };
  const includeDrafts = config.includeDrafts === 'yes';
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  try {
    const open = await gitlabProjectApi<GitLabContributorMergeRequest[]>(
      project,
      '/merge_requests?state=opened&order_by=created_at&sort=asc&per_page=100',
    );
    const candidates = open.filter(
      (request) => includeDrafts || !(request.draft || request.work_in_progress),
    );
    const byAuthor = new Map<number, GitLabContributorMergeRequest[]>();
    for (const request of candidates) {
      const requests = byAuthor.get(request.author.id) ?? [];
      requests.push(request);
      byAuthor.set(request.author.id, requests);
    }
    const firstTime: GitLabContributorMergeRequest[] = [];
    const authors = [...byAuthor.entries()];
    for (let start = 0; start < authors.length; start += 8) {
      const batch = authors.slice(start, start + 8);
      const results = await Promise.all(
        batch.map(async ([authorId, requests]) => ({
          requests,
          hasMerged: await hasMergedContribution(requests[0].project_id, authorId, project.origin),
        })),
      );
      for (const result of results) {
        if (!result.hasMerged) firstTime.push(...result.requests);
      }
    }
    firstTime.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
    return {
      fetchedAt: Date.now(),
      value: firstTime.length,
      items: contributorMergeRequestItems(firstTime, maxItems),
      meta: {
        url: `${project.webUrl}/-/merge_requests?scope=all&state=opened&sort=asc`,
        scannedCount: open.length,
        truncated: open.length === 100,
      },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabFirstTimeContributorsWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  const meta = snapshot?.meta;
  if ((snapshot?.value ?? 0) === 0) {
    return <div className="github-clear"><span className="github-status-dot status-good" aria-hidden="true" />No first-time contributor MRs need a welcome.</div>;
  }
  return (
    <div className="feed">
      <div className="feed-count feed-count-welcome">{snapshot?.value} first-time contributor MR{snapshot?.value === 1 ? '' : 's'}</div>
      <ul className="feed-list">{items.map((item) => <li key={item.id} className="feed-item"><span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span><a href={item.url} target="_blank" rel="noreferrer" title={item.title}>{item.title}</a><span className="feed-sub">{item.subtitle}</span></li>)}</ul>
      {meta?.truncated === true && <a className="github-scan-note" href={String(meta.url)} target="_blank" rel="noreferrer">Calculated from the oldest {String(meta.scannedCount)} open MRs</a>}
    </div>
  );
}

export const gitlabFirstTimeContributorsProvider: WidgetProvider = {
  type: 'gitlab-first-time-contributors',
  name: 'GitLab first-time contributors',
  description: 'Open MRs from authors with no previous merged contribution, oldest first.',
  icon: '♥',
  kind: 'feed',
  auth: 'none',
  connection: { ...GITLAB_CONNECTION, required: false },
  defaultSize: { w: 2, h: 2 },
  setupNote: 'GitLab does not expose an author-association flag, so Panodash checks each open author for prior merged MRs.',
  configFields: [
    { key: 'repository', label: 'Project', type: 'text', required: true, placeholder: 'namespace/project', help: 'Private projects need read_api access.' },
    { key: 'includeDrafts', label: 'Draft merge requests', type: 'select', options: [{ value: 'no', label: 'Show ready MRs only' }, { value: 'yes', label: 'Include drafts' }] },
    { key: 'maxItems', label: 'Merge requests to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { repository: '', includeDrafts: 'no', maxItems: 6, pollMinutes: 30 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} new contributors` : 'First-time contributors';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchFirstTimeContributors,
  component: GitLabFirstTimeContributorsWidget,
};
