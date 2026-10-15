import type {
  FeedItem,
  LocalConnectionRequirement,
  Snapshot,
  WidgetComponentProps,
  WidgetProvider,
} from '@panodash/widget-sdk';
import {
  ageLabel,
  ageTone,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
} from './githubShared';

export type NotificationScope = 'attention' | 'participating' | 'all';

interface GitHubNotificationsConfig {
  scope: NotificationScope;
  maxItems: number;
  pollMinutes: number;
}

export interface GitHubNotificationThread {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  subject: {
    title: string;
    url: string | null;
    latest_comment_url: string | null;
    type: string;
  };
  repository: {
    full_name: string;
    html_url: string;
  };
}

interface NotificationMeta {
  scope: NotificationScope;
  url: string;
  truncated: boolean;
  scannedCount: number;
}

const ATTENTION_REASONS = new Set([
  'approval_requested',
  'assign',
  'mention',
  'review_requested',
  'team_mention',
]);
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const GITHUB_NOTIFICATIONS_CONNECTION: LocalConnectionRequirement = {
  id: 'github-notifications',
  name: 'GitHub notifications',
  secretLabel: 'GitHub classic personal access token',
  placeholder: 'ghp_…',
  help:
    'Stored locally and used only for notifications. GitHub requires a classic token with the notifications scope for this API.',
};

export function notificationMatchesScope(
  notification: GitHubNotificationThread,
  scope: NotificationScope,
): boolean {
  if (!notification.unread) return false;
  return scope !== 'attention' || ATTENTION_REASONS.has(notification.reason);
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    approval_requested: 'Approval requested',
    assign: 'Assigned',
    author: 'Authored',
    ci_activity: 'CI activity',
    comment: 'Participating',
    invitation: 'Invitation',
    manual: 'Subscribed',
    mention: 'Mentioned',
    review_requested: 'Review requested',
    security_alert: 'Security alert',
    state_change: 'State changed',
    subscribed: 'Watching',
    team_mention: 'Team mentioned',
  };
  return labels[reason] ?? reason.replaceAll('_', ' ');
}

export function notificationWebUrl(notification: GitHubNotificationThread): string {
  const repositoryUrl = notification.repository.html_url;
  if (!notification.subject.url) return repositoryUrl;
  try {
    const url = new URL(notification.subject.url);
    if (url.hostname !== 'api.github.com') return repositoryUrl;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'repos' || segments.length < 5) return repositoryUrl;
    const [, owner, repo, resource, identifier] = segments;
    const base = `https://github.com/${owner}/${repo}`;
    if (resource === 'issues') return `${base}/issues/${identifier}`;
    if (resource === 'pulls') return `${base}/pull/${identifier}`;
    if (resource === 'discussions') return `${base}/discussions/${identifier}`;
    if (resource === 'commits') return `${base}/commit/${identifier}`;
    return repositoryUrl;
  } catch {
    return repositoryUrl;
  }
}

export function notificationItems(
  notifications: GitHubNotificationThread[],
  maxItems: number,
  now = Date.now(),
): FeedItem[] {
  return notifications.slice(0, Math.max(1, maxItems)).map((notification) => ({
    id: notification.id,
    title: notification.subject.title,
    url: notificationWebUrl(notification),
    subtitle: `${notification.repository.full_name} · ${reasonLabel(notification.reason)}`,
    badge: ageLabel(notification.updated_at, now),
    tone: ageTone(notification.updated_at, now),
  }));
}

async function fetchNotificationPages(
  participating: boolean,
): Promise<{ notifications: GitHubNotificationThread[]; truncated: boolean }> {
  const notifications: GitHubNotificationThread[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await githubApi<GitHubNotificationThread[]>(
      `/notifications?all=false&participating=${participating}&per_page=${PAGE_SIZE}&page=${page}`,
      {
        requiresAuth: true,
        connectionId: GITHUB_NOTIFICATIONS_CONNECTION.id,
      },
    );
    notifications.push(...batch);
    if (batch.length < PAGE_SIZE) return { notifications, truncated: false };
  }
  return { notifications, truncated: true };
}

async function fetchNotifications(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubNotificationsConfig;
  const scope: NotificationScope =
    config.scope === 'all' || config.scope === 'participating'
      ? config.scope
      : 'attention';
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));

  try {
    const result = await fetchNotificationPages(scope !== 'all');
    const notifications = result.notifications.filter((notification) =>
      notificationMatchesScope(notification, scope),
    );
    return {
      fetchedAt: Date.now(),
      value: notifications.length,
      display: result.truncated ? `${notifications.length}+` : undefined,
      items: notificationItems(notifications, maxItems),
      meta: {
        scope,
        url: 'https://github.com/notifications?query=is%3Aunread',
        truncated: result.truncated,
        scannedCount: result.notifications.length,
      } satisfies NotificationMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubNotificationsWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as NotificationMeta | undefined;
  const items = snapshot?.items ?? [];
  if (snapshot?.errorCode === 'auth') {
    return (
      <div className="feed-empty">
        Add a classic GitHub token with the notifications scope in this widget’s settings.
      </div>
    );
  }
  if ((snapshot?.value ?? 0) === 0) {
    if (meta?.truncated) {
      return (
        <div className="github-feed-empty">
          <p className="feed-empty">
            No matches in the newest {meta.scannedCount} unread notifications.
          </p>
          <a className="github-widget-link" href={meta.url} target="_blank" rel="noreferrer">
            Open GitHub notifications
          </a>
        </div>
      );
    }
    return (
      <div className="github-clear">
        <span className="github-status-dot status-good" aria-hidden="true" />
        No unread GitHub notifications need attention.
      </div>
    );
  }
  return (
    <div className="feed">
      <div className="feed-count feed-count-attention">
        {snapshot?.display ?? snapshot?.value} unread notification
        {snapshot?.display || snapshot?.value !== 1 ? 's' : ''}
      </div>
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.id} className="feed-item">
            {item.badge && (
              <span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span>
            )}
            <a href={item.url} target="_blank" rel="noreferrer" title={item.title}>
              {item.title}
            </a>
            {item.subtitle && <span className="feed-sub">{item.subtitle}</span>}
          </li>
        ))}
      </ul>
      {meta?.truncated && (
        <a className="github-scan-note" href={meta.url} target="_blank" rel="noreferrer">
          Showing matches from the newest {meta.scannedCount} unread notifications
        </a>
      )}
    </div>
  );
}

export const githubNotificationsProvider: WidgetProvider = {
  type: 'github-notifications',
  name: 'GitHub notifications',
  description: 'Unread mentions, assignments, and review requests that need your attention.',
  icon: '@',
  kind: 'feed',
  auth: 'local-token',
  connection: { ...GITHUB_NOTIFICATIONS_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  setupNote:
    'GitHub’s Notifications API requires a personal access token (classic); fine-grained tokens are not supported. Grant the classic token the notifications scope.',
  configFields: [
    {
      key: 'scope',
      label: 'Notification scope',
      type: 'select',
      options: [
        {
          value: 'attention',
          label: 'Mentions, assignments, and requests',
        },
        {
          value: 'participating',
          label: 'All participating notifications',
        },
        {
          value: 'all',
          label: 'All unread notifications',
        },
      ],
    },
    {
      key: 'maxItems',
      label: 'Notifications to show',
      type: 'number',
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: 'pollMinutes',
      label: 'Refresh every (minutes)',
      type: 'number',
      min: 5,
      max: 1440,
      step: 5,
    },
  ],
  defaultConfig: {
    scope: 'attention',
    maxItems: 6,
    pollMinutes: 10,
  },
  defaultTitle: () => 'GitHub notifications',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 10),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchNotifications,
  component: GitHubNotificationsWidget,
};
