import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { issueTriageSignal } from './githubIssueTriage';
import {
  ageLabel,
  ageTone,
  GITLAB_CONNECTION,
  gitlabErrorSnapshot,
  gitlabPaginate,
  gitlabProjectPath,
  gitlabProjectPermissionOrigins,
  parseGitLabProject,
} from './gitlabShared';

interface Config {
  repository: string;
  maxItems: number;
  alertThreshold: number;
  pollMinutes: number;
}

export interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  created_at: string;
  labels: string[];
}

export function unassignedIssueItems(issues: GitLabIssue[], maxItems: number, now = Date.now()): FeedItem[] {
  return issues.slice(0, Math.max(1, maxItems)).map((issue) => ({
    id: String(issue.id),
    title: issue.title,
    url: issue.web_url,
    subtitle: `#${issue.iid}${issue.labels[0] ? ` · ${issue.labels[0]}` : ''}`,
    badge: ageLabel(issue.created_at, now),
    tone: ageTone(issue.created_at, now),
  }));
}

async function fetchIssueTriage(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  if (!project) return { fetchedAt: Date.now(), error: 'Enter a project as namespace/project or a GitLab URL', errorCode: 'parse' };
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 5));
  const alertThreshold = Math.min(10_000, Math.max(1, Number(config.alertThreshold) || 5));
  const base = gitlabProjectPath(project, '/issues');
  try {
    const [open, unassigned] = await Promise.all([
      gitlabPaginate<GitLabIssue>(`${base}?state=opened`, { origin: project.origin, maxPages: 10 }),
      gitlabPaginate<GitLabIssue>(`${base}?state=opened&assignee_id=None&order_by=created_at&sort=asc`, { origin: project.origin, maxPages: 10 }),
    ]);
    const signal = issueTriageSignal(open.items.length, unassigned.items.length, alertThreshold);
    return {
      fetchedAt: Date.now(),
      value: unassigned.items.length,
      display: unassigned.truncated ? `${unassigned.items.length}+` : undefined,
      items: unassignedIssueItems(unassigned.items, maxItems),
      meta: {
        openCount: open.items.length,
        unassignedCount: unassigned.items.length,
        unassignedPercent: signal.unassignedPercent,
        tone: signal.tone,
        openUrl: `${project.webUrl}/-/issues?state=opened`,
        unassignedUrl: `${project.webUrl}/-/issues?state=opened&assignee_id=None`,
      },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabIssueTriageWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta;
  const openCount = Number(meta?.openCount ?? 0);
  const unassignedCount = Number(meta?.unassignedCount ?? 0);
  const unassignedPercent = Number(meta?.unassignedPercent ?? 0);
  const tone = String(meta?.tone ?? 'good');
  const items = snapshot?.items ?? [];
  return (
    <div className="github-issue-triage">
      <div className="github-issue-summary">
        <a className={`github-issue-metric tone-${tone}`} href={String(meta?.unassignedUrl ?? '#')} target="_blank" rel="noreferrer"><strong>{snapshot?.display ?? unassignedCount}</strong><span>unassigned</span></a>
        <a className="github-issue-metric" href={String(meta?.openUrl ?? '#')} target="_blank" rel="noreferrer"><strong>{openCount}</strong><span>open</span></a>
        <span className={`feed-badge tone-${tone}`}>{unassignedPercent}% need owners</span>
      </div>
      <div className={`github-issue-track tone-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={unassignedPercent}><span style={{ width: `${unassignedPercent}%` }} /></div>
      {unassignedCount === 0 ? (
        <div className="github-clear"><span className="github-status-dot status-good" aria-hidden="true" />{openCount === 0 ? 'No open issues.' : 'Every open issue has an owner.'}</div>
      ) : (
        <ul className="feed-list">
          {items.map((item) => <li key={item.id} className="feed-item"><span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span><a href={item.url} target="_blank" rel="noreferrer" title={item.title}>{item.title}</a><span className="feed-sub">{item.subtitle}</span></li>)}
        </ul>
      )}
    </div>
  );
}

export const gitlabIssueTriageProvider: WidgetProvider = {
  type: 'gitlab-issue-triage',
  name: 'GitLab issue triage',
  description: 'Open versus unassigned issues, with the oldest ownerless work first.',
  icon: '#',
  kind: 'feed',
  auth: 'none',
  connection: { ...GITLAB_CONNECTION, required: false },
  defaultSize: { w: 2, h: 2 },
  configFields: [
    { key: 'repository', label: 'Project', type: 'text', required: true, placeholder: 'namespace/project', help: 'Private projects need read_api access.' },
    { key: 'alertThreshold', label: 'Turn red at this many unassigned issues', type: 'number', min: 1, max: 10_000, step: 1 },
    { key: 'maxItems', label: 'Unassigned issues to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { repository: '', alertThreshold: 5, maxItems: 5, pollMinutes: 15 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} issue triage` : 'Issue triage';
  },
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 15),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchIssueTriage,
  component: GitLabIssueTriageWidget,
};
