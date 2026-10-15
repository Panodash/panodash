import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

type DependabotSeverity = 'low' | 'medium' | 'high' | 'critical';
type MinimumSeverity = 'all' | DependabotSeverity;

interface GitHubDependabotAlertsConfig {
  repository: string;
  minimumSeverity: MinimumSeverity;
  maxItems: number;
  pollMinutes: number;
}

export interface GitHubDependabotAlert {
  number: number;
  state: string;
  dependency: {
    package: {
      ecosystem: string;
      name: string;
    };
    manifest_path: string;
    scope: string | null;
  };
  security_advisory: {
    ghsa_id: string;
    cve_id: string | null;
    summary: string;
    severity: DependabotSeverity;
  };
  html_url: string;
  created_at: string;
}

interface DependabotMeta {
  repository: string;
  url: string;
  minimumSeverity: MinimumSeverity;
  truncated: boolean;
}

const SEVERITY_RANK: Record<DependabotSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function dependabotSeverityFilter(minimum: MinimumSeverity): DependabotSeverity[] {
  if (minimum === 'all') return ['low', 'medium', 'high', 'critical'];
  const rank = SEVERITY_RANK[minimum];
  return (Object.keys(SEVERITY_RANK) as DependabotSeverity[]).filter(
    (severity) => SEVERITY_RANK[severity] >= rank,
  );
}

function dependabotTone(severity: DependabotSeverity): FeedItem['tone'] {
  if (severity === 'critical' || severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  return 'neutral';
}

export function dependabotAlertItems(
  alerts: GitHubDependabotAlert[],
  maxItems: number,
): FeedItem[] {
  return [...alerts]
    .sort(
      (left, right) =>
        SEVERITY_RANK[right.security_advisory.severity] -
          SEVERITY_RANK[left.security_advisory.severity] ||
        Date.parse(left.created_at) - Date.parse(right.created_at),
    )
    .slice(0, Math.max(1, maxItems))
    .map((alert) => ({
      id: String(alert.number),
      title: alert.security_advisory.summary,
      url: alert.html_url,
      subtitle: `${alert.dependency.package.name} · ${alert.dependency.package.ecosystem} · ${alert.dependency.manifest_path}`,
      badge: alert.security_advisory.severity,
      tone: dependabotTone(alert.security_advisory.severity),
    }));
}

async function fetchDependabotAlerts(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubDependabotAlertsConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const minimum: MinimumSeverity =
    config.minimumSeverity === 'low' ||
    config.minimumSeverity === 'medium' ||
    config.minimumSeverity === 'high' ||
    config.minimumSeverity === 'critical'
      ? config.minimumSeverity
      : 'all';
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  const pageSize = 100;
  const maxPages = 10;
  const alerts: GitHubDependabotAlert[] = [];
  let truncated = false;

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const query = new URLSearchParams({
        state: 'open',
        severity: dependabotSeverityFilter(minimum).join(','),
        per_page: String(pageSize),
        page: String(page),
      });
      const batch = await githubApi<GitHubDependabotAlert[]>(
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/dependabot/alerts?${query}`,
        { requiresAuth: true },
      );
      alerts.push(...batch);
      if (batch.length < pageSize) break;
      if (page === maxPages) truncated = true;
    }

    return {
      fetchedAt: Date.now(),
      value: alerts.length,
      display: `${alerts.length}${truncated ? '+' : ''}`,
      items: dependabotAlertItems(alerts, maxItems),
      meta: {
        repository: repo.fullName,
        minimumSeverity: minimum,
        truncated,
        url: `https://github.com/${repo.fullName}/security/dependabot`,
      } satisfies DependabotMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubDependabotAlertsWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as DependabotMeta | undefined;
  const items = snapshot?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="github-clear">
        <span className="github-status-dot status-good" aria-hidden="true" />
        No matching Dependabot alerts.
      </div>
    );
  }

  return (
    <div className="feed">
      <div className="feed-count feed-count-attention">
        {snapshot?.display ?? snapshot?.value} open alert{snapshot?.value === 1 ? '' : 's'}
      </div>
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.id} className="feed-item">
            <span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span>
            <a href={item.url} target="_blank" rel="noreferrer" title={item.title}>
              {item.title}
            </a>
            {item.subtitle && <span className="feed-sub">{item.subtitle}</span>}
          </li>
        ))}
      </ul>
      {meta?.truncated && (
        <a className="github-scan-note" href={meta.url} target="_blank" rel="noreferrer">
          Showing a count capped at 1,000 alerts · View all
        </a>
      )}
    </div>
  );
}

export const githubDependabotAlertsProvider: WidgetProvider = {
  type: 'github-dependabot-alerts',
  name: 'GitHub Dependabot alerts',
  description: 'Open dependency vulnerabilities, prioritized by severity.',
  icon: '◆',
  kind: 'feed',
  auth: 'none',
  connection: { ...GITHUB_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  configFields: [
    {
      key: 'repository',
      label: 'Repository',
      type: 'text',
      required: true,
      placeholder: 'owner/repo',
      help: 'Fine-grained tokens need Dependabot alerts: read. Classic tokens need security_events.',
    },
    {
      key: 'minimumSeverity',
      label: 'Minimum severity',
      type: 'select',
      options: [
        { value: 'all', label: 'All severities' },
        { value: 'medium', label: 'Medium and above' },
        { value: 'high', label: 'High and critical' },
        { value: 'critical', label: 'Critical only' },
      ],
    },
    { key: 'maxItems', label: 'Alerts to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: {
    repository: '',
    minimumSeverity: 'all',
    maxItems: 6,
    pollMinutes: 30,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} dependency risk` : 'Dependency risk';
  },
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 30),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchDependabotAlerts,
  component: GitHubDependabotAlertsWidget,
};
