import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';

/**
 * Top-priority Linear issues assigned to you, via the Linear GraphQL API and
 * a personal API key (Linear → Settings → Security & access → API keys).
 * Also records the open-issue count to history, so you can watch your queue
 * shrink (or not) over time.
 */
interface LinearConfig {
  apiKey: string;
  maxItems: number;
  pollMinutes: number;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  priorityLabel: string;
  state: { name: string };
}

const QUERY = `{
  viewer {
    assignedIssues(
      first: 50
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
    ) {
      nodes { id identifier title url priority priorityLabel state { name } }
    }
  }
}`;

/** Linear priority: 1 urgent … 4 low, 0 none. Sort urgent first, none last. */
export function priorityRank(priority: number): number {
  return priority === 0 ? 5 : priority;
}

async function fetchLinear(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as LinearConfig;
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: config.apiKey,
    },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) {
    const hint = res.status === 400 || res.status === 401 ? ' — check your API key' : '';
    return { fetchedAt: Date.now(), error: `Linear HTTP ${res.status}${hint}`, errorCode: 'http' };
  }
  const payload = (await res.json()) as {
    data?: { viewer?: { assignedIssues?: { nodes?: LinearIssue[] } } };
    errors?: { message: string }[];
  };
  if (payload.errors?.length) {
    return { fetchedAt: Date.now(), error: payload.errors[0].message, errorCode: 'http' };
  }
  const nodes = payload.data?.viewer?.assignedIssues?.nodes ?? [];
  const sorted = [...nodes].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const max = Math.max(1, Number(config.maxItems) || 5);
  const items: FeedItem[] = sorted.slice(0, max).map((issue) => ({
    id: issue.id,
    title: issue.title,
    url: issue.url,
    subtitle: `${issue.identifier} · ${issue.state.name}`,
    badge: issue.priority === 0 ? undefined : issue.priorityLabel,
  }));
  return { fetchedAt: Date.now(), value: nodes.length, items };
}

function LinearWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  if (items.length === 0) {
    return <div className="feed-empty">No open issues assigned to you. Enjoy it.</div>;
  }
  return (
    <div className="feed">
      {typeof snapshot?.value === 'number' && (
        <div className="feed-count">{snapshot.value} open</div>
      )}
      <ul className="feed-list">
        {items.map((item) => (
          <li key={item.id} className="feed-item">
            {item.badge && <span className="feed-badge">{item.badge}</span>}
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

export const linearTasksProvider: WidgetProvider = {
  type: 'linear-tasks',
  name: 'Linear tasks',
  description: 'Your top-priority assigned Linear issues, plus queue size over time.',
  icon: '📋',
  kind: 'feed',
  auth: 'local-token',
  defaultSize: { w: 2, h: 2 },
  configFields: [
    {
      key: 'apiKey',
      label: 'Linear API key',
      type: 'password',
      required: true,
      help: 'Personal API key from Linear → Settings → Security & access. Stored locally, never synced.',
    },
    { key: 'maxItems', label: 'Issues to show', type: 'number', min: 1, max: 15, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { apiKey: '', maxItems: 6, pollMinutes: 15 },
  defaultTitle: () => 'Linear tasks',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 15),
  permissionOrigins: () => ['https://api.linear.app/*'],
  fetchSnapshot: fetchLinear,
  component: LinearWidget,
};
