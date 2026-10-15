import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  GITLAB_CONNECTION,
  gitlabErrorSnapshot,
  gitlabProjectApi,
  gitlabProjectPermissionOrigins,
  parseGitLabProject,
} from './gitlabShared';

interface Config {
  repository: string;
  branch: string;
  pollMinutes: number;
}

export interface GitLabPipeline {
  id: number;
  iid: number;
  status: string;
  ref: string;
  web_url: string;
  name?: string | null;
  created_at: string;
  updated_at: string;
}

interface GitLabJob {
  id: number;
  status: string;
  web_url: string;
}

export type GitLabBranchHealthState = 'passing' | 'running' | 'failing' | 'unknown';

export function pipelineHealth(status: string | undefined): GitLabBranchHealthState {
  if (status === 'success' || status === 'skipped') return 'passing';
  if (['failed', 'canceled', 'canceling'].includes(status ?? '')) return 'failing';
  if (
    ['created', 'waiting_for_resource', 'preparing', 'waiting_for_callback', 'pending', 'running', 'manual', 'scheduled'].includes(
      status ?? '',
    )
  ) {
    return 'running';
  }
  return 'unknown';
}

async function fetchBranchHealth(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  const branch = config.branch?.trim() || 'main';
  if (!project) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a project as namespace/project or a GitLab URL',
      errorCode: 'parse',
    };
  }
  try {
    const pipelines = await gitlabProjectApi<GitLabPipeline[]>(
      project,
      `/pipelines?ref=${encodeURIComponent(branch)}&order_by=id&sort=desc&per_page=1`,
    );
    const pipeline = pipelines[0];
    const jobs = pipeline
      ? await gitlabProjectApi<GitLabJob[]>(
          project,
          `/pipelines/${pipeline.id}/jobs?per_page=100`,
        )
      : [];
    const state = pipelineHealth(pipeline?.status);
    const failing = jobs.filter((job) => ['failed', 'canceled'].includes(job.status)).length;
    const pending = jobs.filter((job) =>
      ['created', 'pending', 'running', 'waiting_for_resource', 'manual', 'scheduled'].includes(job.status),
    ).length;
    return {
      fetchedAt: Date.now(),
      display: state,
      meta: {
        state,
        repository: project.fullPath,
        branch,
        total: jobs.length,
        failing,
        pending,
        url: pipeline?.web_url ?? `${project.webUrl}/-/pipelines?ref=${encodeURIComponent(branch)}`,
      },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

const COPY: Record<GitLabBranchHealthState, { label: string; tone: string }> = {
  passing: { label: 'Passing', tone: 'good' },
  running: { label: 'Running', tone: 'warning' },
  failing: { label: 'Failing', tone: 'danger' },
  unknown: { label: 'No pipeline', tone: 'neutral' },
};

function GitLabBranchHealthWidget({ instance, snapshot }: WidgetComponentProps) {
  const rawState = snapshot?.meta?.state;
  const state: GitLabBranchHealthState =
    rawState === 'passing' || rawState === 'running' || rawState === 'failing'
      ? rawState
      : 'unknown';
  const copy = COPY[state];
  const total = Number(snapshot?.meta?.total ?? 0);
  const failing = Number(snapshot?.meta?.failing ?? 0);
  const pending = Number(snapshot?.meta?.pending ?? 0);
  const branch = String(snapshot?.meta?.branch ?? instance.config.branch ?? 'main');
  const url = typeof snapshot?.meta?.url === 'string' ? snapshot.meta.url : undefined;
  const detail =
    state === 'failing'
      ? `${failing || 1} failed job${failing === 1 ? '' : 's'}`
      : state === 'running'
        ? `${pending || 1} job${pending === 1 ? '' : 's'} in progress`
        : state === 'passing'
          ? `${total} job${total === 1 ? '' : 's'} passed`
          : 'No pipelines found';
  const content = (
    <>
      <span className={`github-status-dot status-${copy.tone}`} aria-hidden="true" />
      <span className="github-health-copy">
        <strong>{copy.label}</strong>
        <span>{branch} · {detail}</span>
      </span>
    </>
  );
  return url ? (
    <a className="github-health" href={url} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="github-health">{content}</div>
  );
}

export const gitlabBranchHealthProvider: WidgetProvider = {
  type: 'gitlab-branch-health',
  name: 'GitLab branch health',
  description: 'A red, amber, or green signal for the latest pipeline on a branch.',
  icon: '●',
  kind: 'utility',
  auth: 'none',
  connection: { ...GITLAB_CONNECTION, required: false },
  defaultSize: { w: 1, h: 1 },
  configFields: [
    {
      key: 'repository',
      label: 'Project',
      type: 'text',
      required: true,
      placeholder: 'namespace/project',
      help: 'Public projects work without a token. Private projects need read_api access.',
    },
    { key: 'branch', label: 'Branch', type: 'text', required: true, placeholder: 'main' },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { repository: '', branch: 'main', pollMinutes: 10 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} build` : 'Branch health';
  },
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 10),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchBranchHealth,
  component: GitLabBranchHealthWidget,
};
