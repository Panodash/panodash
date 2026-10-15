import { describe, expect, it } from 'vitest';
import { pipelineHealth } from '@panodash/providers/gitlabBranchHealth';
import { contributorMergeRequestItems } from '@panodash/providers/gitlabFirstTimeContributors';
import { unassignedIssueItems } from '@panodash/providers/gitlabIssueTriage';
import { pipelineFailureItems } from '@panodash/providers/gitlabPipelineFailures';
import { releaseAssetItems, type GitLabRelease } from '@panodash/providers/gitlabReleaseAssets';
import { mergeRequestItems, type GitLabMergeRequest } from '@panodash/providers/gitlabReviews';
import {
  gitlabHostPermissionOrigins,
  gitlabProjectNameFromUrl,
  gitlabProjectPath,
  gitlabProjectPermissionOrigins,
  parseGitLabOrigin,
  parseGitLabProject,
} from '@panodash/providers/gitlabShared';
import { todoItems, todoMatchesScope, type GitLabTodo } from '@panodash/providers/gitlabTodos';

describe('GitLab project parsing', () => {
  it('accepts nested gitlab.com project paths', () => {
    expect(parseGitLabProject('group/platform/dashboard')).toEqual({
      origin: 'https://gitlab.com',
      fullPath: 'group/platform/dashboard',
      project: 'dashboard',
      webUrl: 'https://gitlab.com/group/platform/dashboard',
    });
  });

  it('accepts self-managed project URLs and strips .git', () => {
    expect(parseGitLabProject('https://code.example.com/acme/tools/panodash.git')).toEqual({
      origin: 'https://code.example.com',
      fullPath: 'acme/tools/panodash',
      project: 'panodash',
      webUrl: 'https://code.example.com/acme/tools/panodash',
    });
  });

  it('rejects non-project and GitLab UI routes', () => {
    expect(parseGitLabProject('group')).toBeNull();
    expect(parseGitLabProject('https://gitlab.com/group/project/-/issues')).toBeNull();
    expect(parseGitLabProject('https://user:pass@gitlab.com/group/project')).toBeNull();
  });

  it('encodes nested project paths for the API', () => {
    const project = parseGitLabProject('group/subgroup/project');
    expect(project && gitlabProjectPath(project, '/pipelines')).toBe(
      '/projects/group%2Fsubgroup%2Fproject/pipelines',
    );
  });

  it('normalizes hosts and derives narrow permission origins', () => {
    expect(parseGitLabOrigin('gitlab.example.com')).toBe('https://gitlab.example.com');
    expect(gitlabHostPermissionOrigins({ host: 'https://gitlab.example.com/path' })).toEqual([
      'https://gitlab.example.com/*',
    ]);
    expect(
      gitlabProjectPermissionOrigins({
        repository: 'https://gitlab.example.com/group/project',
      }),
    ).toEqual(['https://gitlab.example.com/*']);
  });

  it('extracts nested project names from resource URLs', () => {
    expect(
      gitlabProjectNameFromUrl(
        'https://gitlab.example.com/group/subgroup/project/-/merge_requests/17',
      ),
    ).toBe('group/subgroup/project');
  });
});

describe('GitLab pipeline helpers', () => {
  it('maps pipeline statuses to ambient health states', () => {
    expect(pipelineHealth('success')).toBe('passing');
    expect(pipelineHealth('running')).toBe('running');
    expect(pipelineHealth('manual')).toBe('running');
    expect(pipelineHealth('failed')).toBe('failing');
    expect(pipelineHealth(undefined)).toBe('unknown');
  });

  it('formats failed pipelines as attention feed items', () => {
    const items = pipelineFailureItems(
      [
        {
          id: 42,
          iid: 9,
          status: 'failed',
          ref: 'main',
          web_url: 'https://gitlab.com/acme/app/-/pipelines/42',
          name: 'Verify',
          created_at: '2026-07-25T10:00:00Z',
          updated_at: '2026-07-25T10:05:00Z',
        },
      ],
      5,
      Date.parse('2026-07-25T12:00:00Z'),
    );
    expect(items[0]).toMatchObject({
      id: '42',
      title: 'Verify',
      subtitle: 'main · #9',
      badge: '2h',
      tone: 'danger',
    });
  });
});

describe('GitLab merge request and issue feeds', () => {
  const request: GitLabMergeRequest = {
    id: 100,
    iid: 17,
    project_id: 3,
    title: 'Add GitLab widgets',
    web_url: 'https://gitlab.com/acme/panodash/-/merge_requests/17',
    created_at: '2026-07-24T12:00:00Z',
    updated_at: '2026-07-24T12:00:00Z',
  };

  it('formats review requests with project and MR references', () => {
    expect(
      mergeRequestItems([request], 5, Date.parse('2026-07-25T12:00:00Z'))[0],
    ).toMatchObject({
      title: 'Add GitLab widgets',
      subtitle: 'acme/panodash · !17',
      badge: '1d',
    });
  });

  it('formats first-time contributor requests and drafts', () => {
    const items = contributorMergeRequestItems(
      [{ ...request, draft: true, author: { id: 7, username: 'new-user' } }],
      5,
      Date.parse('2026-07-25T12:00:00Z'),
    );
    expect(items[0]).toMatchObject({
      subtitle: '@new-user · !17 · Draft',
      tone: 'neutral',
    });
  });

  it('formats unassigned issues with their first label', () => {
    const items = unassignedIssueItems(
      [
        {
          id: 9,
          iid: 4,
          title: 'Needs an owner',
          web_url: 'https://gitlab.com/acme/app/-/issues/4',
          created_at: '2026-07-25T11:00:00Z',
          labels: ['bug'],
        },
      ],
      5,
      Date.parse('2026-07-25T12:00:00Z'),
    );
    expect(items[0]).toMatchObject({ subtitle: '#4 · bug', badge: '1h' });
  });
});

describe('GitLab release assets and to-dos', () => {
  it('combines linked release assets and generated source archives', () => {
    const release: GitLabRelease = {
      tag_name: 'v1.0.0',
      name: 'One',
      created_at: '2026-07-20T00:00:00Z',
      released_at: '2026-07-20T00:00:00Z',
      assets: {
        count: 2,
        links: [
          {
            id: 1,
            name: 'app.zip',
            url: 'https://downloads.example.com/app.zip',
            link_type: 'package',
          },
        ],
        sources: [
          {
            format: 'tar.gz',
            url: 'https://gitlab.com/acme/app/-/archive/v1.0.0/app.tar.gz',
          },
        ],
      },
    };
    expect(releaseAssetItems(release, 5).map((item) => item.title)).toEqual([
      'app.zip',
      'Source code (tar.gz)',
    ]);
  });

  it('filters pending to-dos by attention action', () => {
    const base: GitLabTodo = {
      id: 1,
      action_name: 'assigned',
      target_type: 'MergeRequest',
      target: { title: 'Review this', iid: 8 },
      target_url: 'https://gitlab.com/acme/app/-/merge_requests/8',
      body: 'Review this',
      state: 'pending',
      created_at: '2026-07-25T10:00:00Z',
      updated_at: '2026-07-25T10:00:00Z',
      project: { path_with_namespace: 'acme/app' },
    };
    expect(todoMatchesScope(base, 'attention')).toBe(true);
    expect(todoMatchesScope({ ...base, action_name: 'marked' }, 'attention')).toBe(false);
    expect(todoMatchesScope({ ...base, action_name: 'marked' }, 'all')).toBe(true);
    expect(todoMatchesScope({ ...base, state: 'done' }, 'all')).toBe(false);
  });

  it('formats to-dos with project and action labels', () => {
    const item = todoItems(
      [
        {
          id: 1,
          action_name: 'approval_required',
          target_type: 'MergeRequest',
          target: { title: 'Ship it', iid: 8 },
          target_url: 'https://gitlab.com/acme/app/-/merge_requests/8',
          body: '',
          state: 'pending',
          created_at: '2026-07-25T10:00:00Z',
          updated_at: '2026-07-25T10:00:00Z',
          project: { path_with_namespace: 'acme/app' },
        },
      ],
      5,
      Date.parse('2026-07-25T12:00:00Z'),
    )[0];
    expect(item).toMatchObject({
      title: 'Ship it',
      subtitle: 'acme/app · Approval required',
      badge: '2h',
    });
  });
});
