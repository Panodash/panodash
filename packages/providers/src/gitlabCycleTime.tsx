import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  cycleTimeItems,
  cycleTimeStats,
  cycleWindowStart,
  formatCycleDuration,
  type GitHubCyclePullRequest,
} from './githubCycleTime';
import {
  GITLAB_CONNECTION,
  gitlabErrorSnapshot,
  gitlabPaginate,
  gitlabProjectPath,
  gitlabProjectPermissionOrigins,
  parseGitLabProject,
} from './gitlabShared';
import type { GitLabMergeRequest } from './gitlabReviews';

interface Config {
  repository: string;
  windowDays: number;
  warningHours: number;
  dangerHours: number;
  maxItems: number;
  pollMinutes: number;
}

function asCyclePull(request: GitLabMergeRequest): GitHubCyclePullRequest {
  return {
    id: request.id,
    number: request.iid,
    title: request.title,
    html_url: request.web_url,
    created_at: request.created_at,
    updated_at: request.updated_at,
    merged_at: request.merged_at ?? null,
    user: request.author ? { login: request.author.username } : null,
  };
}

async function fetchCycleTime(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  if (!project) return { fetchedAt: Date.now(), error: 'Enter a project as namespace/project or a GitLab URL', errorCode: 'parse' };
  const windowDays = Math.min(365, Math.max(1, Number(config.windowDays) || 30));
  const warningHours = Math.min(8760, Math.max(1, Number(config.warningHours) || 48));
  const dangerHours = Math.min(8760, Math.max(warningHours, Number(config.dangerHours) || 96));
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 4));
  const start = cycleWindowStart(windowDays);
  try {
    const query = new URLSearchParams({
      state: 'merged',
      updated_after: start,
      order_by: 'updated_at',
      sort: 'desc',
    });
    const result = await gitlabPaginate<GitLabMergeRequest>(
      `${gitlabProjectPath(project, '/merge_requests')}?${query}`,
      { origin: project.origin, maxPages: 10 },
    );
    const pulls = result.items
      .filter((request) => request.merged_at && request.merged_at >= start)
      .map(asCyclePull);
    const stats = cycleTimeStats(pulls, warningHours, dangerHours);
    return {
      fetchedAt: Date.now(),
      value: stats.averageHours,
      display: stats.count > 0 ? formatCycleDuration(stats.averageHours) : undefined,
      items: cycleTimeItems(pulls, maxItems, warningHours, dangerHours),
      meta: {
        ...stats,
        windowDays,
        url: `${project.webUrl}/-/merge_requests?scope=all&state=merged`,
        truncated: result.truncated,
        scannedCount: result.items.length,
      },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabCycleTimeWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta;
  const count = Number(meta?.count ?? 0);
  const items = snapshot?.items ?? [];
  if (count === 0) return <div className="github-feed-empty"><p className="feed-empty">No merge requests merged in the last {String(meta?.windowDays ?? 30)} days.</p><a className="github-widget-link" href={String(meta?.url ?? '#')} target="_blank" rel="noreferrer">View merged merge requests</a></div>;
  const tone = String(meta?.tone ?? 'neutral');
  return (
    <div className="github-cycle-time">
      <a className="github-cycle-summary" href={String(meta?.url ?? '#')} target="_blank" rel="noreferrer">
        <div className="github-cycle-heading"><div><strong>{snapshot?.display ?? '—'}</strong><span>average cycle time</span></div><span className={`feed-badge tone-${tone}`}>{tone === 'good' ? 'Flowing' : tone === 'warning' ? 'Slowing' : 'Friction'}</span></div>
        <div className="github-cycle-stats"><span><strong>{formatCycleDuration(Number(meta?.medianHours ?? 0))}</strong> median</span><span><strong>{formatCycleDuration(Number(meta?.p90Hours ?? 0))}</strong> P90</span><span><strong>{count}</strong> merged</span></div>
      </a>
      <ul className="feed-list">{items.map((item) => <li key={item.id} className="feed-item"><span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span><a href={item.url} target="_blank" rel="noreferrer" title={item.title}>{item.title}</a><span className="feed-sub">{item.subtitle}</span></li>)}</ul>
      {meta?.truncated === true && <a className="github-scan-note" href={String(meta.url)} target="_blank" rel="noreferrer">Calculated from the latest {String(meta.scannedCount)} merged MRs</a>}
    </div>
  );
}

export const gitlabCycleTimeProvider: WidgetProvider = {
  type: 'gitlab-cycle-time',
  name: 'GitLab MR cycle time',
  description: 'Average opening-to-merge time with median, P90, and friction signals.',
  icon: '↻',
  kind: 'metric',
  auth: 'none',
  connection: { ...GITLAB_CONNECTION, required: false },
  defaultSize: { w: 2, h: 2 },
  configFields: [
    { key: 'repository', label: 'Project', type: 'text', required: true, placeholder: 'namespace/project', help: 'Private projects need read_api access.' },
    { key: 'windowDays', label: 'Look back (days)', type: 'number', min: 1, max: 365, step: 1 },
    { key: 'warningHours', label: 'Warning threshold (hours)', type: 'number', min: 1, max: 8760, step: 1 },
    { key: 'dangerHours', label: 'Danger threshold (hours)', type: 'number', min: 1, max: 8760, step: 1 },
    { key: 'maxItems', label: 'Slow merges to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { repository: '', windowDays: 30, warningHours: 48, dangerHours: 96, maxItems: 4, pollMinutes: 30 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} MR cycle time` : 'MR cycle time';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchCycleTime,
  component: GitLabCycleTimeWidget,
};
