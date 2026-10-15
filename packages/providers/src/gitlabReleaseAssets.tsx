import { formatValue } from '@panodash/core/format';
import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  GITLAB_CONNECTION,
  gitlabErrorSnapshot,
  gitlabProjectApi,
  gitlabProjectPermissionOrigins,
  parseGitLabProject,
} from './gitlabShared';

interface Config {
  repository: string;
  maxItems: number;
  pollMinutes: number;
}

interface ReleaseAsset {
  format?: string;
  name?: string;
  url: string;
  link_type?: string;
}

export interface GitLabRelease {
  tag_name: string;
  name: string | null;
  created_at: string;
  released_at: string;
  upcoming_release?: boolean;
  historical_release?: boolean;
  assets: {
    count: number;
    sources: ReleaseAsset[];
    links: Array<ReleaseAsset & { id: number }>;
  };
  _links?: { self?: string };
}

export function releaseAssetItems(release: GitLabRelease, maxItems: number): FeedItem[] {
  const links: FeedItem[] = release.assets.links.map((asset) => ({
    id: `link-${asset.id}`,
    title: asset.name || 'Release asset',
    url: asset.url,
    subtitle: asset.link_type && asset.link_type !== 'other' ? asset.link_type : 'linked asset',
    badge: 'asset',
    tone: 'neutral',
  }));
  const sources: FeedItem[] = release.assets.sources.map((asset) => ({
    id: `source-${asset.format ?? asset.url}`,
    title: `Source code (${asset.format ?? 'archive'})`,
    url: asset.url,
    subtitle: 'generated source archive',
    badge: asset.format ?? 'source',
    tone: 'neutral',
  }));
  return [...links, ...sources].slice(0, Math.max(1, maxItems));
}

async function fetchReleaseAssets(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  if (!project) return { fetchedAt: Date.now(), error: 'Enter a project as namespace/project or a GitLab URL', errorCode: 'parse' };
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  try {
    const releases = await gitlabProjectApi<GitLabRelease[]>(project, '/releases?order_by=released_at&sort=desc&per_page=20');
    const release = releases.find((candidate) => !candidate.upcoming_release);
    if (!release) {
      return { fetchedAt: Date.now(), value: 0, meta: { noRelease: true, releasesUrl: `${project.webUrl}/-/releases` } };
    }
    return {
      fetchedAt: Date.now(),
      value: release.assets.count,
      items: releaseAssetItems(release, maxItems),
      meta: {
        releaseUrl: release._links?.self ?? `${project.webUrl}/-/releases/${encodeURIComponent(release.tag_name)}`,
        releasesUrl: `${project.webUrl}/-/releases`,
        releaseName: release.name || release.tag_name,
        tagName: release.tag_name,
        releasedAt: release.released_at,
      },
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function GitLabReleaseAssetsWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta;
  const items = snapshot?.items ?? [];
  if (meta?.noRelease) return <div className="github-feed-empty"><p className="feed-empty">No published release found.</p><a className="github-widget-link" href={String(meta.releasesUrl)} target="_blank" rel="noreferrer">View project releases</a></div>;
  const releasedAt = typeof meta?.releasedAt === 'string' ? `${ageLabel(meta.releasedAt)} old` : 'Date unavailable';
  return (
    <div className="github-release-downloads">
      <a className="github-release-summary" href={String(meta?.releaseUrl ?? '#')} target="_blank" rel="noreferrer">
        <div className="github-release-heading">
          <div className="github-release-total"><strong>{formatValue(snapshot?.value ?? 0)}</strong><span>release assets</span></div>
          <span className="feed-badge tone-good">Latest release</span>
        </div>
        <div className="github-release-title">{String(meta?.releaseName ?? 'Loading release…')}</div>
        <div className="github-release-meta">{meta && `${String(meta.tagName)} · ${releasedAt}`}</div>
      </a>
      {items.length === 0 ? <div className="feed-empty">This release has no downloadable assets.</div> : (
        <ul className="feed-list">{items.map((item) => <li key={item.id} className="feed-item"><span className="feed-badge">{item.badge}</span><a href={item.url} target="_blank" rel="noreferrer" title={item.title}>{item.title}</a><span className="feed-sub">{item.subtitle}</span></li>)}</ul>
      )}
    </div>
  );
}

export const gitlabReleaseAssetsProvider: WidgetProvider = {
  type: 'gitlab-release-assets',
  name: 'GitLab release assets',
  description: 'Assets and source archives for the latest project release.',
  icon: '↓',
  kind: 'metric',
  auth: 'none',
  connection: { ...GITLAB_CONNECTION, required: false },
  defaultSize: { w: 2, h: 2 },
  setupNote: 'GitLab does not expose per-asset download counts, so this widget tracks published assets.',
  configFields: [
    { key: 'repository', label: 'Project', type: 'text', required: true, placeholder: 'namespace/project', help: 'Private projects need read_api access.' },
    { key: 'maxItems', label: 'Assets to show', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { repository: '', maxItems: 6, pollMinutes: 60 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} release assets` : 'Release assets';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 60),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchReleaseAssets,
  component: GitLabReleaseAssetsWidget,
};
