import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { StatTile } from '@panodash/ui/StatTile';
import {
  gitlabErrorSnapshot,
  gitlabProjectApi,
  gitlabProjectPermissionOrigins,
  parseGitLabProject,
} from './gitlabShared';

interface Config {
  repository: string;
  pollMinutes: number;
}

interface ProjectResponse {
  path_with_namespace: string;
  web_url: string;
  star_count: number;
}

async function fetchStars(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  if (!project) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a project as namespace/project or a GitLab URL',
      errorCode: 'parse',
    };
  }
  try {
    const data = await gitlabProjectApi<ProjectResponse>(project);
    return {
      fetchedAt: Date.now(),
      value: data.star_count,
      meta: { repository: data.path_with_namespace, url: data.web_url },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabStarsWidget({ instance, snapshot, samples }: WidgetComponentProps) {
  const project = parseGitLabProject(instance.config.repository);
  const url = typeof snapshot?.meta?.url === 'string' ? snapshot.meta.url : undefined;
  return (
    <StatTile
      value={snapshot?.value}
      direction="up-good"
      samples={samples}
      goal={instance.goal}
      footer={
        url && project ? (
          <a className="github-widget-link" href={url} target="_blank" rel="noreferrer">
            {project.fullPath}
          </a>
        ) : undefined
      }
    />
  );
}

export const gitlabStarsProvider: WidgetProvider = {
  type: 'gitlab-stars',
  name: 'GitLab stars',
  description: 'Project stars with a local trend line and history.',
  icon: '★',
  kind: 'metric',
  auth: 'none',
  defaultSize: { w: 1, h: 1 },
  configFields: [
    {
      key: 'repository',
      label: 'Project',
      type: 'text',
      required: true,
      placeholder: 'namespace/project',
      help:
        'Public projects work without a token. Paste a full URL for self-managed GitLab or nested groups.',
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
  defaultConfig: { repository: '', pollMinutes: 60 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} stars` : 'GitLab stars';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 60),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchStars,
  component: GitLabStarsWidget,
};
