import { getConnectionSecret } from '@panodash/core/connections';
import type { LocalConnectionRequirement, Snapshot } from '@panodash/widget-sdk';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2026-03-10';

export const GITHUB_CONNECTION: LocalConnectionRequirement = {
  id: 'github',
  name: 'GitHub',
  secretLabel: 'GitHub personal access token',
  placeholder: 'github_pat_… or ghp_…',
  help:
    'Stored once in this browser and shared by GitHub widgets. Prefer a fine-grained token with only the read access required by the widgets you use.',
};

export interface GitHubRepo {
  owner: string;
  repo: string;
  fullName: string;
}

export function parseGitHubRepo(value: unknown): GitHubRepo | null {
  let input = String(value ?? '').trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    input = url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    // owner/repo form
  }
  const [owner, rawRepo, ...rest] = input.split('/');
  const repo = rawRepo?.replace(/\.git$/i, '');
  if (!owner || !repo || rest.length > 0 || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return null;
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly errorCode: 'auth' | 'http',
  ) {
    super(message);
  }
}

export async function githubApi<T>(
  path: string,
  options: { requiresAuth?: boolean; connectionId?: string } = {},
): Promise<T> {
  const token = await getConnectionSecret(options.connectionId ?? GITHUB_CONNECTION.id);
  if (options.requiresAuth && !token) {
    throw new GitHubApiError('Connect GitHub in the widget settings', 'auth');
  }
  const request = (secret?: string) =>
    fetch(`${API_ROOT}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
    });
  let res = await request(token);
  // Public widgets should remain useful if a previously saved optional token
  // is revoked. Auth-required widgets still surface the connection error.
  if (res.status === 401 && token && !options.requiresAuth) {
    res = await request();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    if (res.status === 401) {
      throw new GitHubApiError('GitHub rejected the saved token — replace it in widget settings', 'auth');
    }
    if (res.status === 404) {
      throw new GitHubApiError('Repository not found, or the GitHub token cannot access it', 'http');
    }
    const detail = body?.message && body.message !== 'Not Found' ? `: ${body.message}` : '';
    throw new GitHubApiError(`GitHub HTTP ${res.status}${detail}`, 'http');
  }
  return res.json() as Promise<T>;
}

export function githubErrorSnapshot(error: unknown): Snapshot {
  if (error instanceof GitHubApiError) {
    return { fetchedAt: Date.now(), error: error.message, errorCode: error.errorCode };
  }
  throw error;
}

export function githubPermissionOrigins(): string[] {
  return [`${API_ROOT}/*`];
}

export function ageLabel(createdAt: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(createdAt));
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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
