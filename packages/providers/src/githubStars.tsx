import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { StatTile } from '@panodash/ui/StatTile';
import {
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

interface GitHubStarsConfig {
  repository: string;
  pollMinutes: number;
}

interface GitHubRepositoryResponse {
  full_name: string;
  html_url: string;
  stargazers_count: number;
}

async function fetchStars(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubStarsConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }
  try {
    const data = await githubApi<GitHubRepositoryResponse>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
    );
    return {
      fetchedAt: Date.now(),
      value: data.stargazers_count,
      meta: { repository: data.full_name, url: data.html_url },
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubStarsWidget({ instance, snapshot, samples }: WidgetComponentProps) {
  const config = instance.config as unknown as GitHubStarsConfig;
  const repo = parseGitHubRepo(config.repository);
  const url = typeof snapshot?.meta?.url === 'string' ? snapshot.meta.url : undefined;
  return (
    <StatTile
      value={snapshot?.value}
      direction="up-good"
      samples={samples}
      goal={instance.goal}
      footer={
        url && repo ? (
          <a className="github-widget-link" href={url} target="_blank" rel="noreferrer">
            {repo.fullName}
          </a>
        ) : undefined
      }
    />
  );
}

export const githubStarsProvider: WidgetProvider = {
  type: 'github-stars',
  name: 'GitHub stars',
  description: 'Repository stars with a local trend line and history.',
  icon: '★',
  kind: 'metric',
  auth: 'none',
  defaultSize: { w: 1, h: 1 },
  configFields: [
    {
      key: 'repository',
      label: 'Repository',
      type: 'text',
      required: true,
      placeholder: 'owner/repo',
      help: 'Public repositories work without a token. You can also paste a GitHub repository URL.',
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { repository: '', pollMinutes: 60 },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} stars` : 'GitHub stars';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 60),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchStars,
  component: GitHubStarsWidget,
};
