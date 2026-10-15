import { getConnectionSecret } from '@panodash/core/connections';
import type { LocalConnectionRequirement, Snapshot } from '@panodash/widget-sdk';

export const DEFAULT_GITLAB_ORIGIN = 'https://gitlab.com';

export const GITLAB_CONNECTION: LocalConnectionRequirement = {
  id: 'gitlab',
  name: 'GitLab',
  secretLabel: 'GitLab personal access token',
  placeholder: 'glpat-…',
  help:
    'Stored once in this browser and shared by GitLab widgets. Use a token with read_api access; public projects also work without one.',
};

export interface GitLabProject {
  origin: string;
  fullPath: string;
  project: string;
  webUrl: string;
}

export function parseGitLabOrigin(value: unknown): string | null {
  const input = String(value ?? '').trim() || DEFAULT_GITLAB_ORIGIN;
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseGitLabProject(value: unknown): GitLabProject | null {
  let input = String(value ?? '').trim();
  if (!input) return null;
  let origin = DEFAULT_GITLAB_ORIGIN;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    origin = url.origin;
    input = url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    // namespace/project form on gitlab.com
  }
  input = input.replace(/\.git$/i, '');
  if (input.includes('/-/')) return null;
  const segments = input.split('/');
  if (
    segments.length < 2 ||
    segments.some((segment) => !segment || !/^[A-Za-z0-9_.-]+$/.test(segment))
  ) {
    return null;
  }
  const project = segments.at(-1)!;
  return {
    origin,
    fullPath: segments.join('/'),
    project,
    webUrl: `${origin}/${segments.join('/')}`,
  };
}

export class GitLabApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: 'auth' | 'http',
  ) {
    super(message);
  }
}

function apiRoot(origin: string): string {
  return `${origin}/api/v4`;
}

export async function gitlabApi<T>(
  path: string,
  options: { origin?: string; requiresAuth?: boolean } = {},
): Promise<T> {
  const origin = parseGitLabOrigin(options.origin) ?? DEFAULT_GITLAB_ORIGIN;
  const token = await getConnectionSecret(GITLAB_CONNECTION.id);
  if (options.requiresAuth && !token) {
    throw new GitLabApiError('Connect GitLab in the widget settings', 'auth');
  }
  const request = (secret?: string) =>
    fetch(`${apiRoot(origin)}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(secret ? { 'PRIVATE-TOKEN': secret } : {}),
      },
    });
  let response = await request(token);
  if (response.status === 401 && token && !options.requiresAuth) {
    response = await request();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string | Record<string, string[]>; error?: string }
      | null;
    if (response.status === 401 || response.status === 403) {
      throw new GitLabApiError(
        token
          ? 'GitLab rejected the saved token — replace it in widget settings'
          : 'Connect GitLab in the widget settings',
        'auth',
      );
    }
    if (response.status === 404) {
      throw new GitLabApiError(
        'Project not found, or the GitLab token cannot access it',
        'http',
      );
    }
    const detail =
      typeof body?.message === 'string'
        ? body.message
        : typeof body?.error === 'string'
          ? body.error
          : '';
    throw new GitLabApiError(
      `GitLab HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      'http',
    );
  }
  return response.json() as Promise<T>;
}

export function gitlabProjectPath(project: GitLabProject, suffix = ''): string {
  return `/projects/${encodeURIComponent(project.fullPath)}${suffix}`;
}

export async function gitlabProjectApi<T>(
  project: GitLabProject,
  suffix = '',
  options: { requiresAuth?: boolean } = {},
): Promise<T> {
  return gitlabApi<T>(gitlabProjectPath(project, suffix), {
    origin: project.origin,
    requiresAuth: options.requiresAuth,
  });
}

export async function gitlabPaginate<T>(
  path: string,
  options: {
    origin?: string;
    requiresAuth?: boolean;
    maxPages?: number;
    perPage?: number;
  } = {},
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 100));
  const maxPages = Math.max(1, options.maxPages ?? 5);
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await gitlabApi<T[]>(
      `${path}${separator}per_page=${perPage}&page=${page}`,
      options,
    );
    items.push(...batch);
    if (batch.length < perPage) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export function gitlabErrorSnapshot(error: unknown): Snapshot {
  if (error instanceof GitLabApiError) {
    return { fetchedAt: Date.now(), error: error.message, errorCode: error.errorCode };
  }
  throw error;
}

export function gitlabProjectPermissionOrigins(config: Record<string, unknown>): string[] {
  const project = parseGitLabProject(config.repository);
  return project ? [`${project.origin}/*`] : [];
}

export function gitlabHostPermissionOrigins(config: Record<string, unknown>): string[] {
  const origin = parseGitLabOrigin(config.host);
  return origin ? [`${origin}/*`] : [];
}

export function gitlabProjectNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const marker = path.indexOf('/-/');
    return (marker >= 0 ? path.slice(1, marker) : path.slice(1)).replace(/\.git$/i, '');
  } catch {
    return '';
  }
}

export function ageLabel(createdAt: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(createdAt));
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ageTone(
  createdAt: string,
  now = Date.now(),
): 'neutral' | 'warning' | 'danger' {
  const elapsed = Math.max(0, now - Date.parse(createdAt));
  if (elapsed >= 48 * 3_600_000) return 'danger';
  if (elapsed >= 8 * 3_600_000) return 'warning';
  return 'neutral';
}
