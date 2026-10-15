import { useState } from 'react';
import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import {
  GITHUB_CONNECTION,
  githubApi,
  githubErrorSnapshot,
  githubPermissionOrigins,
  parseGitHubRepo,
} from './githubShared';

interface GitHubMilestoneConfig {
  repository: string;
  milestoneNumber: number | '';
  pollMinutes: number;
}

export interface GitHubMilestoneResponse {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
}

interface MilestoneOption {
  number: number;
  title: string;
  dueOn: string | null;
}

interface MilestoneMeta {
  selecting?: boolean;
  milestones?: MilestoneOption[];
  title?: string;
  url?: string;
  repository?: string;
  open?: number;
  closed?: number;
  total?: number;
  dueOn?: string | null;
  tone?: MilestoneTone;
  dueLabel?: string;
}

export type MilestoneTone = 'neutral' | 'good' | 'warning' | 'danger';

export function milestoneProgress(open: number, closed: number): number {
  const safeOpen = Math.max(0, open);
  const safeClosed = Math.max(0, closed);
  const total = safeOpen + safeClosed;
  return total === 0 ? 0 : Math.round((safeClosed / total) * 100);
}

export function milestoneSignal(
  open: number,
  closed: number,
  dueOn: string | null,
  now = Date.now(),
): { progress: number; tone: MilestoneTone; dueLabel: string } {
  const progress = milestoneProgress(open, closed);
  if (open <= 0 && closed <= 0) return { progress, tone: 'neutral', dueLabel: 'No items' };
  if (open <= 0 && closed > 0) return { progress, tone: 'good', dueLabel: 'Complete' };
  if (!dueOn) return { progress, tone: 'neutral', dueLabel: 'No due date' };

  const delta = Date.parse(dueOn) - now;
  const dayMs = 24 * 60 * 60 * 1000;
  if (delta < 0) {
    const days = Math.max(1, Math.ceil(Math.abs(delta) / dayMs));
    return {
      progress,
      tone: 'danger',
      dueLabel: `Overdue by ${days}d`,
    };
  }
  const days = Math.ceil(delta / dayMs);
  if (days === 0) return { progress, tone: 'warning', dueLabel: 'Due today' };
  if (days === 1) return { progress, tone: 'warning', dueLabel: 'Due tomorrow' };
  return {
    progress,
    tone: days <= 7 ? 'warning' : 'neutral',
    dueLabel: `Due in ${days}d`,
  };
}

async function fetchMilestone(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as GitHubMilestoneConfig;
  const repo = parseGitHubRepo(config.repository);
  if (!repo) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a repository as owner/repo or a GitHub URL',
      errorCode: 'parse',
    };
  }

  const milestoneNumber = Number(config.milestoneNumber);
  try {
    if (!Number.isInteger(milestoneNumber) || milestoneNumber <= 0) {
      const milestones = await githubApi<GitHubMilestoneResponse[]>(
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/milestones?state=open&sort=due_on&direction=asc&per_page=100`,
      );
      return {
        fetchedAt: Date.now(),
        meta: {
          selecting: true,
          repository: repo.fullName,
          milestones: milestones.map((milestone) => ({
            number: milestone.number,
            title: milestone.title,
            dueOn: milestone.due_on,
          })),
        } satisfies MilestoneMeta,
      };
    }

    const milestone = await githubApi<GitHubMilestoneResponse>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/milestones/${milestoneNumber}`,
    );
    const total = milestone.open_issues + milestone.closed_issues;
    const signal = milestoneSignal(
      milestone.open_issues,
      milestone.closed_issues,
      milestone.due_on,
    );
    return {
      fetchedAt: Date.now(),
      value: signal.progress,
      meta: {
        title: milestone.title,
        url: milestone.html_url,
        repository: repo.fullName,
        open: milestone.open_issues,
        closed: milestone.closed_issues,
        total,
        dueOn: milestone.due_on,
        tone: signal.tone,
        dueLabel: signal.dueLabel,
      } satisfies MilestoneMeta,
    };
  } catch (error) {
    return githubErrorSnapshot(error);
  }
}

function MilestonePicker({
  milestones,
  updateConfig,
}: {
  milestones: MilestoneOption[];
  updateConfig: WidgetComponentProps['updateConfig'];
}) {
  const [selection, setSelection] = useState('');
  const [saving, setSaving] = useState(false);
  if (milestones.length === 0) {
    return <div className="feed-empty">This repository has no open milestones.</div>;
  }
  return (
    <div className="github-milestone-setup">
      <p className="feed-empty">Choose an open milestone.</p>
      <form
        className="manual-entry"
        onSubmit={(event) => {
          event.preventDefault();
          const number = Number(selection);
          if (!Number.isInteger(number) || number <= 0 || saving) return;
          setSaving(true);
          void updateConfig({ milestoneNumber: number }).finally(() => setSaving(false));
        }}
      >
        <select
          value={selection}
          aria-label="Open milestone"
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">Choose…</option>
          {milestones.map((milestone) => (
            <option key={milestone.number} value={milestone.number}>
              {milestone.title}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!selection || saving}>
          Set
        </button>
      </form>
    </div>
  );
}

function GitHubMilestoneWidget({ snapshot, updateConfig }: WidgetComponentProps) {
  const meta = snapshot?.meta as MilestoneMeta | undefined;
  if (meta?.selecting) {
    return <MilestonePicker milestones={meta.milestones ?? []} updateConfig={updateConfig} />;
  }
  const progress = snapshot?.value ?? 0;
  const tone = meta?.tone ?? 'neutral';
  const content = (
    <>
      <div className="github-milestone-heading">
        <strong>{Math.round(progress)}%</strong>
        <span className={`feed-badge tone-${tone}`}>{meta?.dueLabel ?? 'Loading…'}</span>
      </div>
      <div
        className={`github-milestone-track tone-${tone}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label={`${meta?.title ?? 'Milestone'} progress`}
      >
        <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
      <div className="github-milestone-title">{meta?.title ?? 'Loading milestone…'}</div>
      <div className="github-milestone-meta">
        {meta && `${meta.closed ?? 0} closed · ${meta.open ?? 0} open`}
      </div>
    </>
  );
  return meta?.url ? (
    <a className="github-milestone" href={meta.url} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="github-milestone">{content}</div>
  );
}

export const githubMilestoneProvider: WidgetProvider = {
  type: 'github-milestone',
  name: 'GitHub milestone',
  description: 'Issue and PR completion for a repository milestone, with due-date awareness.',
  icon: '◒',
  kind: 'metric',
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
      help: 'Public repositories work without a token. Private repositories need Issues or Pull requests read access.',
    },
    {
      key: 'milestoneNumber',
      label: 'Milestone number',
      type: 'number',
      min: 1,
      step: 1,
      help: 'Leave blank to choose an open milestone from the widget.',
    },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { repository: '', milestoneNumber: '', pollMinutes: 30 },
  defaultTitle: (config) => {
    const repo = parseGitHubRepo(config.repository);
    return repo ? `${repo.repo} milestone` : 'Milestone progress';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: githubPermissionOrigins,
  fetchSnapshot: fetchMilestone,
  component: GitHubMilestoneWidget,
};
