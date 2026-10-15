import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

interface GitHubActionsFailuresConfig {
  repository: string;
  branch: string;
  windowHours: number;
  maxItems: number;
  pollMinutes: number;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  display_title: string;
  html_url: string;
  head_branch: string | null;
  run_number: number;
  run_attempt: number;
  created_at: string;
}

interface GitHubWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
}

export function failureWindowStart(windowHours: number, now = Date.now()): string {
  const hours = Math.min(168, Math.max(1, windowHours));
  return new Date(now - hours * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z');
}

export function workflowFailureItems(
  runs: GitHubWorkflowRun[],
  maxItems: number,
  now = Date.now(),
): FeedItem[] {
  return runs.slice(0, Math.max(1, maxItems)).map((run) => ({
    id: String(run.id),
    title: run.display_title || run.name,
    url: run.html_url,
    subtitle: `${run.name} · ${run.head_branch ?? 'detached'} · #${run.run_number}`,
    badge: ageLabel(run.created_at, now),
    tone: 'danger',
  }));
}

async function fetchActionsFailures(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubActionsFailuresConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const windowHours = Math.min(168, Math.max(1, Number(config.windowHours) || 24));
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  const query = new URLSearchParams({
    status: 'failure',
    created: `>=${failureWindowStart(windowHours)}`,
    per_page: String(maxItems),
  });
  const branch = config.branch?.trim();
  if (branch) query.set('branch', branch);

  try {
    const data = await githubApi<GitHubWorkflowRunsResponse>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/actions/runs?${query}`,
    );
    return {
      fetchedAt: Date.now(),
      value: data.total_count,
      items: workflowFailureItems(data.workflow_runs, maxItems),
      meta: {
        repository: repo.fullName,
        branch: branch || null,
        windowHours,
        url: `https://github.com/${repo.fullName}/actions`,
      },
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubActionsFailuresWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="github-clear">
        <span className="github-status-dot status-good" aria-hidden="true" />
        No failed Actions runs in this window.
      </div>
    );
  }
  return (
    <div className="feed">
      <div className="feed-count feed-count-attention">
        {snapshot?.value} failed run{snapshot?.value === 1 ? '' : 's'}
      </div>
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.id} className="feed-item">
            <span className="feed-badge tone-danger">{item.badge}</span>
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

export const githubActionsFailuresProvider: WidgetProvider = {
  type: 'github-actions-failures',
  name: 'GitHub Actions failures',
  description: 'Recent failed workflow runs, linked directly to the run.',
  icon: '!',
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
      help: 'Public repositories work without a token. Private repositories need Actions read access.',
    },
    {
      key: 'branch',
      label: 'Branch (optional)',
      type: 'text',
      placeholder: 'main',
      help: 'Leave blank to include failures from every branch.',
    },
    {
      key: 'windowHours',
      label: 'Look back (hours)',
      type: 'number',
      min: 1,
      max: 168,
      step: 1,
    },
    { key: 'maxItems', label: 'Failed runs to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: {
    repository: '',
    branch: '',
    windowHours: 24,
    maxItems: 6,
    pollMinutes: 10,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} Actions failures` : 'Actions failures';
  },
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 10),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchActionsFailures,
  component: GitHubActionsFailuresWidget,
};
