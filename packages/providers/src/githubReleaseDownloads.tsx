import { formatValue } from '@panodash/core/format';
import type { FeedItem, Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  ageLabel,
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

type ReleaseChannel = 'stable' | 'prerelease';

interface GitHubReleaseDownloadsConfig {
  repository: string;
  releaseChannel: ReleaseChannel;
  maxItems: number;
  pollMinutes: number;
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  browser_download_url: string;
  download_count: number;
  size: number;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubReleaseAsset[];
}

interface ReleaseDownloadsMeta {
  repository: string;
  releaseUrl?: string;
  releasesUrl: string;
  releaseName?: string;
  tagName?: string;
  publishedAt?: string | null;
  prerelease?: boolean;
  assetCount?: number;
  noRelease?: boolean;
}

export function selectRelease(
  releases: GitHubRelease[],
  releaseChannel: ReleaseChannel,
): GitHubRelease | null {
  return (
    releases.find(
      (release) =>
        !release.draft && (releaseChannel === 'prerelease' || !release.prerelease),
    ) ?? null
  );
}

export function releaseDownloadTotal(assets: GitHubReleaseAsset[]): number {
  return assets.reduce((total, asset) => total + Math.max(0, asset.download_count), 0);
}

function formatAssetSize(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1024) return `${safeBytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = safeBytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  const decimals = value >= 10 ? 0 : 1;
  return `${value.toFixed(decimals).replace(/\.0$/, '')} ${unit}`;
}

export function releaseAssetItems(
  assets: GitHubReleaseAsset[],
  maxItems: number,
): FeedItem[] {
  return [...assets]
    .sort(
      (left, right) =>
        right.download_count - left.download_count || left.name.localeCompare(right.name),
    )
    .slice(0, Math.max(1, maxItems))
    .map((asset) => ({
      id: String(asset.id),
      title: asset.name,
      url: asset.browser_download_url,
      subtitle: formatAssetSize(asset.size),
      badge: `${formatValue(Math.max(0, asset.download_count))} dl`,
      tone: 'neutral',
    }));
}

async function fetchReleaseDownloads(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubReleaseDownloadsConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const releaseChannel: ReleaseChannel =
    config.releaseChannel === 'prerelease' ? 'prerelease' : 'stable';
  const maxItems = Math.min(20, Math.max(1, Number(config.maxItems) || 6));
  const releasesUrl = `https://github.com/${repo.fullName}/releases`;

  try {
    const releases = await githubApi<GitHubRelease[]>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases?per_page=100`,
    );
    const release = selectRelease(releases, releaseChannel);
    if (!release) {
      return {
        fetchedAt: Date.now(),
        value: 0,
        meta: {
          repository: repo.fullName,
          releasesUrl,
          noRelease: true,
        } satisfies ReleaseDownloadsMeta,
      };
    }

    const assets = await githubApi<GitHubReleaseAsset[]>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/${release.id}/assets?per_page=100`,
    );
    const total = releaseDownloadTotal(assets);
    return {
      fetchedAt: Date.now(),
      value: total,
      items: releaseAssetItems(assets, maxItems),
      meta: {
        repository: repo.fullName,
        releaseUrl: release.html_url,
        releasesUrl,
        releaseName: release.name || release.tag_name,
        tagName: release.tag_name,
        publishedAt: release.published_at,
        prerelease: release.prerelease,
        assetCount: assets.length,
      } satisfies ReleaseDownloadsMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function GitHubReleaseDownloadsWidget({ snapshot }: WidgetComponentProps) {
  const meta = snapshot?.meta as ReleaseDownloadsMeta | undefined;
  const items = snapshot?.items ?? [];

  if (meta?.noRelease) {
    return (
      <div className="github-feed-empty">
        <p className="feed-empty">No matching published release found.</p>
        <a className="github-widget-link" href={meta.releasesUrl} target="_blank" rel="noreferrer">
          View repository releases
        </a>
      </div>
    );
  }

  const published =
    meta?.publishedAt && ageLabel(meta.publishedAt)
      ? `${ageLabel(meta.publishedAt)} old`
      : 'Publish date unavailable';
  return (
    <div className="github-release-downloads">
      <a
        className="github-release-summary"
        href={meta?.releaseUrl}
        target="_blank"
        rel="noreferrer"
      >
        <div className="github-release-heading">
          <div className="github-release-total">
            <strong>{formatValue(snapshot?.value ?? 0)}</strong>
            <span>asset downloads</span>
          </div>
          <span className={`feed-badge tone-${meta?.prerelease ? 'warning' : 'good'}`}>
            {meta?.prerelease ? 'Prerelease' : 'Latest stable'}
          </span>
        </div>
        <div className="github-release-title">{meta?.releaseName ?? 'Loading release…'}</div>
        <div className="github-release-meta">
          {meta && `${meta.tagName} · ${published} · ${meta.assetCount ?? 0} assets`}
        </div>
      </a>
      {items.length === 0 ? (
        <div className="feed-empty">This release has no downloadable assets.</div>
      ) : (
        <ul className="feed-list">
          {items.map((item) => (
            <li key={item.id} className="feed-item">
              <span className="feed-badge">{item.badge}</span>
              <a href={item.url} target="_blank" rel="noreferrer" title={item.title}>
                {item.title}
              </a>
              {item.subtitle && <span className="feed-sub">{item.subtitle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const githubReleaseDownloadsProvider: WidgetProvider = {
  type: 'github-release-downloads',
  name: 'GitHub release downloads',
  description: 'Asset download totals and adoption signals for the latest repository release.',
  icon: '↓',
  kind: 'metric',
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
      help: 'Public repositories work without a token. Private repositories need Contents read access.',
    },
    {
      key: 'releaseChannel',
      label: 'Release channel',
      type: 'select',
      options: [
        { value: 'stable', label: 'Latest stable release' },
        { value: 'prerelease', label: 'Latest release, including prereleases' },
      ],
    },
    {
      key: 'maxItems',
      label: 'Assets to show',
      type: 'number',
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: 'pollMinutes',
      label: 'Refresh every (minutes)',
      type: 'number',
      min: 15,
      max: 1440,
      step: 15,
    },
  ],
  defaultConfig: {
    repository: '',
    releaseChannel: 'stable',
    maxItems: 6,
    pollMinutes: 60,
  },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} release downloads` : 'Release downloads';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 60),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchReleaseDownloads,
  component: GitHubReleaseDownloadsWidget,
};
