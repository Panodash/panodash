import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { ageLabel, GITLAB_CONNECTION, gitlabErrorSnapshot, gitlabProjectApi, gitlabProjectPermissionOrigins, parseGitLabProject } from './gitlabShared';
import type { GitLabPipeline } from './gitlabBranchHealth';

interface Config {
  repository: string;
  branch: string;
  windowHours: number;
  maxItems: number;
  pollMinutes: number;
}

export function pipelineFailureItems(pipelines: GitLabPipeline[], maxItems: number, now = Date.now()): FeedItem[] {
  return pipelines.slice(0, Math.max(1, maxItems)).map((pipeline) => ({
    id: String(pipeline.id),
    title: pipeline.name || `Pipeline #${pipeline.iid || pipeline.id}`,
    url: pipeline.web_url,
    subtitle: `${pipeline.ref} · #${pipeline.iid || pipeline.id}`,
    badge: ageLabel(pipeline.created_at, now),
    tone: 'danger',
  }));
}

async function fetchFailures(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  if (!project) return { fetchedAt: Date.now(), error: 'Enter a project as namespace/project or a GitLab URL', errorCode: 'parse' };
  const windowHours = Math.min(168, Math.max(1, Number(config.windowHours) || 24));
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  const start = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const query = new URLSearchParams({ status: 'failed', updated_after: start, order_by: 'updated_at', sort: 'desc', per_page: '100' });
  if (config.branch?.trim()) query.set('ref', config.branch.trim());
  try {
    const pipelines = await gitlabProjectApi<GitLabPipeline[]>(project, `/pipelines?${query}`);
    return {
      fetchedAt: Date.now(),
      value: pipelines.length,
      items: pipelineFailureItems(pipelines, maxItems),
      meta: { url: `${project.webUrl}/-/pipelines`, windowHours },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabPipelineFailuresWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  if (items.length === 0) return <div className="github-clear"><span className="github-status-dot status-good" aria-hidden="true" />No failed pipelines in this window.</div>;
  return (
    <div className="feed">
      <div className="feed-count feed-count-attention">{snapshot?.value} failed pipeline{snapshot?.value === 1 ? '' : 's'}</div>
      <ul className="feed-list">
        {items.map((item) => <li key={item.id} className="feed-item"><span className="feed-badge tone-danger">{item.badge}</span><a href={item.url} target="_blank" rel="noreferrer" title={item.title}>{item.title}</a><span className="feed-sub">{item.subtitle}</span></li>)}
      </ul>
    </div>
  );
}

export const gitlabPipelineFailuresProvider: WidgetProvider = {
  type: 'gitlab-pipeline-failures',
  name: 'GitLab pipeline failures',
  description: 'Recent failed pipelines, linked directly to the pipeline.',
  icon: '!',
  kind: 'feed',
  auth: 'none',
  connection: { ...GITLAB_CONNECTION, required: false },
  defaultSize: { w: 2, h: 2 },
  configFields: [
    { key: 'repository', label: 'Project', type: 'text', required: true, placeholder: 'namespace/project', help: 'Private projects need read_api access.' },
    { key: 'branch', label: 'Branch (optional)', type: 'text', placeholder: 'main', help: 'Leave blank to include every ref.' },
    { key: 'windowHours', label: 'Look back (hours)', type: 'number', min: 1, max: 168, step: 1 },
    { key: 'maxItems', label: 'Failed pipelines to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { repository: '', branch: '', windowHours: 24, maxItems: 6, pollMinutes: 10 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} pipeline failures` : 'Pipeline failures';
  },
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 10),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchFailures,
  component: GitLabPipelineFailuresWidget,
};
