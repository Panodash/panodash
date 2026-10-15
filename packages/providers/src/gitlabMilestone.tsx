import { useState } from 'react';
import type { Snapshot, WidgetComponentProps, WidgetProvider } from '@panodash/widget-sdk';
import { milestoneSignal, type MilestoneTone } from './githubMilestone';
import {
  GITLAB_CONNECTION,
  gitlabErrorSnapshot,
  gitlabPaginate,
  gitlabProjectApi,
  gitlabProjectPath,
  gitlabProjectPermissionOrigins,
  parseGitLabProject,
} from './gitlabShared';

interface Config {
  repository: string;
  milestoneId: number | '';
  pollMinutes: number;
}

export interface GitLabMilestone {
  id: number;
  iid: number;
  title: string;
  state: 'active' | 'closed';
  due_date: string | null;
}

interface MilestoneItem {
  state: 'opened' | 'closed' | 'merged' | string;
}

interface Option {
  id: number;
  title: string;
}

interface Meta {
  selecting?: boolean;
  milestones?: Option[];
  title?: string;
  url?: string;
  open?: number;
  closed?: number;
  tone?: MilestoneTone;
  dueLabel?: string;
}

async function fetchMilestone(rawConfig: Record<string, unknown>): Promise<Snapshot> {
  const config = rawConfig as unknown as Config;
  const project = parseGitLabProject(config.repository);
  if (!project) {
    return {
      fetchedAt: Date.now(),
      error: 'Enter a project as namespace/project or a GitLab URL',
      errorCode: 'parse',
    };
  }
  const milestoneId = Number(config.milestoneId);
  try {
    if (!Number.isInteger(milestoneId) || milestoneId <= 0) {
      const milestones = await gitlabProjectApi<GitLabMilestone[]>(
        project,
        '/milestones?state=active&per_page=100',
      );
      return {
        fetchedAt: Date.now(),
        meta: {
          selecting: true,
          milestones: milestones.map((milestone) => ({ id: milestone.id, title: milestone.title })),
        } satisfies Meta,
      };
    }
    const base = gitlabProjectPath(project, `/milestones/${milestoneId}`);
    const [milestone, issues, mergeRequests] = await Promise.all([
      gitlabProjectApi<GitLabMilestone>(project, `/milestones/${milestoneId}`),
      gitlabPaginate<MilestoneItem>(`${base}/issues`, {
        origin: project.origin,
        maxPages: 10,
      }),
      gitlabPaginate<MilestoneItem>(`${base}/merge_requests`, {
        origin: project.origin,
        maxPages: 10,
      }),
    ]);
    const items = [...issues.items, ...mergeRequests.items];
    const open = items.filter((item) => item.state === 'opened').length;
    const closed = items.length - open;
    const signal = milestoneSignal(open, closed, milestone.due_date);
    return {
      fetchedAt: Date.now(),
      value: signal.progress,
      meta: {
        title: milestone.title,
        url: `${project.webUrl}/-/milestones/${milestone.iid}`,
        open,
        closed,
        tone: signal.tone,
        dueLabel: signal.dueLabel,
      } satisfies Meta,
    };
  } catch (error) {
    return gitlabErrorSnapshot(error);
  }
}

function MilestonePicker({ milestones, updateConfig }: { milestones: Option[]; updateConfig: WidgetComponentProps['updateConfig'] }) {
  const [selection, setSelection] = useState('');
  const [saving, setSaving] = useState(false);
  if (milestones.length === 0) return <div className="feed-empty">This project has no active milestones.</div>;
  return (
    <div className="github-milestone-setup">
      <p className="feed-empty">Choose an active milestone.</p>
      <form className="manual-entry" onSubmit={(event) => {
        event.preventDefault();
        const id = Number(selection);
        if (!Number.isInteger(id) || id <= 0 || saving) return;
        setSaving(true);
        void updateConfig({ milestoneId: id }).finally(() => setSaving(false));
      }}>
        <select value={selection} aria-label="Active milestone" onChange={(event) => setSelection(event.target.value)}>
          <option value="">Choose…</option>
          {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
        </select>
        <button type="submit" disabled={!selection || saving}>Set</button>
      </form>
    </div>
  );
}

function GitLabMilestoneWidget({ snapshot, updateConfig }: WidgetComponentProps) {
  const meta = snapshot?.meta as Meta | undefined;
  if (meta?.selecting) return <MilestonePicker milestones={meta.milestones ?? []} updateConfig={updateConfig} />;
  const progress = snapshot?.value ?? 0;
  const tone = meta?.tone ?? 'neutral';
  const content = (
    <>
      <div className="github-milestone-heading">
        <strong>{Math.round(progress)}%</strong>
        <span className={`feed-badge tone-${tone}`}>{meta?.dueLabel ?? 'Loading…'}</span>
      </div>
      <div className={`github-milestone-track tone-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
      <div className="github-milestone-title">{meta?.title ?? 'Loading milestone…'}</div>
      <div className="github-milestone-meta">{meta && `${meta.closed ?? 0} closed · ${meta.open ?? 0} open`}</div>
    </>
  );
  return meta?.url ? <a className="github-milestone" href={meta.url} target="_blank" rel="noreferrer">{content}</a> : <div className="github-milestone">{content}</div>;
}

export const gitlabMilestoneProvider: WidgetProvider = {
  type: 'gitlab-milestone',
  name: 'GitLab milestone',
  description: 'Issue completion for a project milestone, with due-date awareness.',
  icon: '◒',
  kind: 'metric',
  auth: 'none',
  connection: { ...GITLAB_CONNECTION, required: false },
  defaultSize: { w: 1, h: 1 },
  configFields: [
    { key: 'repository', label: 'Project', type: 'text', required: true, placeholder: 'namespace/project', help: 'Private projects need read_api access.' },
    { key: 'milestoneId', label: 'Milestone ID', type: 'number', min: 1, step: 1, help: 'Leave blank to choose an active milestone from the widget.' },
    { key: 'pollMinutes', label: 'Refresh every (minutes)', type: 'number', min: 15, max: 1440, step: 15 },
  ],
  defaultConfig: { repository: '', milestoneId: '', pollMinutes: 30 },
  defaultTitle: (config) => {
    const project = parseGitLabProject(config.repository);
    return project ? `${project.project} milestone` : 'Milestone progress';
  },
  pollMinutes: (config) => Math.max(15, Number(config.pollMinutes) || 30),
  permissionOrigins: gitlabProjectPermissionOrigins,
  fetchSnapshot: fetchMilestone,
  component: GitLabMilestoneWidget,
};
