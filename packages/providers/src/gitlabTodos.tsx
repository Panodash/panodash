import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  ageTone,
  DEFAULT_GITLAB_ORIGIN,
  GITLAB_CONNECTION,
  gitlabErrorSnapshot,
  gitlabHostPermissionOrigins,
  gitlabPaginate,
  parseGitLabOrigin,
} from './gitlabShared';

export type GitLabTodoScope = 'attention' | 'all';

interface Config {
  host: string;
  scope: GitLabTodoScope;
  maxItems: number;
  pollMinutes: number;
}

export interface GitLabTodo {
  id: number;
  action_name: string;
  target_type: string;
  target: { title?: string; iid?: number };
  target_url: string;
  body: string;
  state: 'pending' | 'done';
  created_at: string;
  updated_at: string;
  project?: { path_with_namespace?: string };
}

const ATTENTION_ACTIONS = new Set([
  'assigned',
  'mentioned',
  'approval_required',
  'unmergeable',
  'directly_addressed',
  'build_failed',
]);

export function todoMatchesScope(todo: GitLabTodo, scope: GitLabTodoScope): boolean {
  return todo.state === 'pending' && (scope === 'all' || ATTENTION_ACTIONS.has(todo.action_name));
}

function actionLabel(action: string): string {
  return action.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

export function todoItems(todos: GitLabTodo[], maxItems: number, now = Date.now()): FeedItem[] {
  return todos.slice(0, Math.max(1, maxItems)).map((todo) => ({
    id: String(todo.id),
    title: todo.target.title || todo.body || todo.target_type,
    url: todo.target_url,
    subtitle: `${todo.project?.path_with_namespace ?? todo.target_type} · ${actionLabel(todo.action_name)}`,
    badge: ageLabel(todo.updated_at || todo.created_at, now),
    tone: ageTone(todo.updated_at || todo.created_at, now),
  }));
}

async function fetchTodos(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const origin = parseGitLabOrigin(config.host);
  if (!origin) return { fetchedAt: Date.now(), error: 'Enter a valid GitLab host URL', errorCode: 'parse' };
  const scope: GitLabTodoScope = config.scope === 'all' ? 'all' : 'attention';
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  try {
    const result = await gitlabPaginate<GitLabTodo>('/todos?state=pending', {
      origin,
      requiresAuth: true,
      maxPages: 5,
    });
    const todos = result.items.filter((todo) => todoMatchesScope(todo, scope));
    return {
      fetchedAt: Date.now(),
      value: todos.length,
      display: result.truncated ? `${todos.length}+` : undefined,
      items: todoItems(todos, maxItems),
      meta: { url: `${origin}/dashboard/todos`, truncated: result.truncated, scannedCount: result.items.length },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabTodosWidget({ snapshot }: WidgetComponentProps) {
  const items = snapshot?.items ?? [];
  const meta = snapshot?.meta;
  if (snapshot?.errorCode === 'auth') return <div className="feed-empty">Add a GitLab token in this widget’s settings to see your to-dos.</div>;
  if ((snapshot?.value ?? 0) === 0) return <div className="github-clear"><span className="github-status-dot status-good" aria-hidden="true" />No pending GitLab to-dos need attention.</div>;
  return (
    <div className="feed">
      <div className="feed-count feed-count-attention">{snapshot?.display ?? snapshot?.value} pending to-do{snapshot?.value === 1 ? '' : 's'}</div>
      <ul className="feed-list">{items.map((item) => <li key={item.id} className="feed-item"><span className={`feed-badge tone-${item.tone ?? 'neutral'}`}>{item.badge}</span><a href={item.url} target="_blank" rel="noreferrer" title={item.title}>{item.title}</a><span className="feed-sub">{item.subtitle}</span></li>)}</ul>
      {meta?.truncated === true && <a className="github-scan-note" href={String(meta.url)} target="_blank" rel="noreferrer">Showing matches from the newest {String(meta.scannedCount)} to-dos</a>}
    </div>
  );
}

export const gitlabTodosProvider: WidgetProvider = {
  type: 'gitlab-todos',
  name: 'GitLab to-dos',
  description: 'Pending assignments, mentions, approvals, and other to-dos.',
  icon: '@',
  kind: 'feed',
  auth: 'local-token',
  connection: { ...GITLAB_CONNECTION, required: true },
  defaultSize: { w: 2, h: 2 },
  setupNote: 'GitLab exposes actionable notifications through the To-Do List API. Use a token with read_api access.',
  configFields: [
    { key: 'host', label: 'GitLab host', type: 'url', required: true, placeholder: DEFAULT_GITLAB_ORIGIN },
    { key: 'scope', label: 'To-do scope', type: 'select', options: [{ value: 'attention', label: 'Assignments, mentions, approvals, and failures' }, { value: 'all', label: 'All pending to-dos' }] },
    { key: 'maxItems', label: 'To-dos to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
  ],
  defaultConfig: { host: DEFAULT_GITLAB_ORIGIN, scope: 'attention', maxItems: 6, pollMinutes: 10 },
  defaultTitle: () => 'GitLab to-dos',
  pollMinutes: (config) => Math.max(5, Number(config.pollMinutes) || 10),
  permissionOrigins: gitlabHostPermissionOrigins,
  fetchSnapshot: fetchTodos,
  component: GitLabTodosWidget,
};
