import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

interface GitHubBranchConfig {
  repository: string;
  branch: string;
  pollMinutes: number;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

export type BranchHealthState = 'passing' | 'running' | 'failing' | 'unknown';

const FAILING_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'stale',
  'startup_failure',
  'timed_out',
]);

export function branchHealth(checks: GitHubCheckRun[]): {
  state: BranchHealthState;
  failing: GitHubCheckRun[];
  pending: GitHubCheckRun[];
} {
  const failing = checks.filter((check) => check.conclusion && FAILING_CONCLUSIONS.has(check.conclusion));
  const pending = checks.filter((check) => check.status !== 'completed' || check.conclusion === null);
  const state: BranchHealthState =
    checks.length === 0 ? 'unknown' : failing.length > 0 ? 'failing' : pending.length > 0 ? 'running' : 'passing';
  return { state, failing, pending };
}

async function fetchBranchHealth(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubBranchConfig;
  const repo = parseGitHubRepo(config.repository);
  const branch = config.branch.trim() || 'main';
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }
  try {
    const data = await githubApi<GitHubCheckRunsResponse>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${encodeURIComponent(branch)}/check-runs?filter=latest&per_page=100`,
    );
    const health = branchHealth(data.check_runs);
    const target =
      health.failing[0]?.html_url ??
      health.pending[0]?.html_url ??
      data.check_runs[0]?.html_url ??
      `https://github.com/${repo.fullName}/actions?query=branch%3A${encodeURIComponent(branch)}`;
    return {
      fetchedAt: Date.now(),
      display: health.state,
      meta: {
        state: health.state,
        repository: repo.fullName,
        branch,
        total: data.total_count,
        failing: health.failing.length,
        pending: health.pending.length,
        url: target,
      },
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

const STATE_COPY: Record<BranchHealthState, { label: string; tone: string }> = {
  passing: { label: 'Passing', tone: 'good' },
  running: { label: 'Running', tone: 'warning' },
  failing: { label: 'Failing', tone: 'danger' },
  unknown: { label: 'No checks', tone: 'neutral' },
};

function GitHubBranchHealthWidget({ instance, snapshot }: WidgetComponentProps) {
  const config = instance.config as unknown as GitHubBranchConfig;
  const state =
    snapshot?.meta?.state === 'passing' ||
    snapshot?.meta?.state === 'running' ||
    snapshot?.meta?.state === 'failing'
      ? snapshot.meta.state
      : 'unknown';
  const copy = STATE_COPY[state];
  const total = Number(snapshot?.meta?.total ?? 0);
  const failing = Number(snapshot?.meta?.failing ?? 0);
  const pending = Number(snapshot?.meta?.pending ?? 0);
  const url = typeof snapshot?.meta?.url === 'string' ? snapshot.meta.url : undefined;
  const branch = String(snapshot?.meta?.branch ?? config.branch ?? 'main');
  const detail =
    state === 'failing'
      ? `${failing} failed check${failing === 1 ? '' : 's'}`
      : state === 'running'
        ? `${pending} check${pending === 1 ? '' : 's'} in progress`
        : state === 'passing'
          ? `${total} check${total === 1 ? '' : 's'} passed`
          : 'No check runs found';
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
    <a className="github-health" href={url} target="_blank" rel="noreferrer" aria-label={`${branch}: ${copy.label}`}>
      {content}
    </a>
  ) : (
    <div className="github-health">{content}</div>
  );
}

export const githubBranchHealthProvider: WidgetProvider = {
  type: 'github-branch-health',
  name: 'GitHub branch health',
  description: 'A red, amber, or green signal for the latest checks on a branch.',
  icon: '●',
  kind: 'utility',
  auth: 'none',
  connection: { ...GITHUB_CONNECTION, required: false },
  defaultSize: { w: 1, h: 1 },
  configFields: [
    {
      key: 'repository',
      label: 'Repository',
      type: 'text',
      required: true,
      placeholder: 'owner/repo',
      help: 'Public repositories work without a token. Private repositories need a token with Checks read access.',
    },
    { key: 'branch', label: 'Branch', type: 'text', required: true, placeholder: 'main' },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { repository: '', branch: 'main', pollMinutes: 10 },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} build` : 'Branch health';
  },
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 10),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchBranchHealth,
  component: GitHubBranchHealthWidget,
};
