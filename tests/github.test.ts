import { describe, expect, it } from 'vitest';
import { branchHealth, type GitHubCheckRun } from '@panodash/providers/githubBranchHealth';
import {
  prioritizePullRequests,
  prSizeSignal,
  reviewSignal,
  startOfWeekDate,
  type MyPullRequest,
} from '@panodash/providers/githubMyPrs';
import {
  milestoneProgress,
  milestoneSignal,
} from '@panodash/providers/githubMilestone';
import {
  failureWindowStart,
  workflowFailureItems,
  type GitHubWorkflowRun,
} from '@panodash/providers/githubActionsFailures';
import {
  issueTriageSignal,
  unassignedIssueItems,
  type GitHubTriageIssue,
} from '@panodash/providers/githubIssueTriage';
import {
  releaseAssetItems,
  releaseDownloadTotal,
  selectRelease,
  type GitHubRelease,
  type GitHubReleaseAsset,
} from '@panodash/providers/githubReleaseDownloads';
import {
  contributorPullRequestItems,
  firstTimeContributorPullRequests,
  isFirstTimeContributor,
  type GitHubContributorPullRequest,
} from '@panodash/providers/githubFirstTimeContributors';
import {
  cycleTimeItems,
  cycleTimeStats,
  cycleWindowStart,
  formatCycleDuration,
  type GitHubCyclePullRequest,
} from '@panodash/providers/githubCycleTime';
import {
  notificationItems,
  notificationMatchesScope,
  notificationWebUrl,
  type GitHubNotificationThread,
} from '@panodash/providers/githubNotifications';
import {
  dependabotAlertItems,
  dependabotSeverityFilter,
  type GitHubDependabotAlert,
} from '@panodash/providers/githubDependabotAlerts';
import {
  trafficCountDelta,
  trafficTrendLabel,
  type GitHubTrafficPoint,
} from '@panodash/providers/githubTraffic';
import {
  coverageDeltaLabel,
  coverageSignal,
  coverageSparkline,
  type CodecovCoverageMeasurement,
} from '@panodash/providers/githubCoverageTrend';
import { reviewFeedItems, type GitHubSearchIssue } from '@panodash/providers/githubReviews';
import { ageLabel, ageTone, parseGitHubRepo } from '@panodash/providers/githubShared';

function check(
  id: number,
  status: string,
  conclusion: string | null,
): GitHubCheckRun {
  return { id, name: `check-${id}`, status, conclusion, html_url: `https://github.com/run/${id}` };
}

describe('parseGitHubRepo', () => {
  it('accepts owner/repo and GitHub URLs', () => {
    expect(parseGitHubRepo('openai/codex')).toEqual({
      owner: 'openai',
      repo: 'codex',
      fullName: 'openai/codex',
    });
    expect(parseGitHubRepo('https://github.com/openai/codex.git')).toEqual({
      owner: 'openai',
      repo: 'codex',
      fullName: 'openai/codex',
    });
  });

  it('rejects non-repository and non-GitHub inputs', () => {
    expect(parseGitHubRepo('openai')).toBeNull();
    expect(parseGitHubRepo('https://example.com/openai/codex')).toBeNull();
    expect(parseGitHubRepo('openai/codex/issues')).toBeNull();
  });
});

describe('branchHealth', () => {
  it('is unknown with no checks', () => {
    expect(branchHealth([]).state).toBe('unknown');
  });

  it('is passing when all completed checks are successful or skipped', () => {
    expect(
      branchHealth([
        check(1, 'completed', 'success'),
        check(2, 'completed', 'neutral'),
        check(3, 'completed', 'skipped'),
      ]).state,
    ).toBe('passing');
  });

  it('is running while any non-failing check is pending', () => {
    const health = branchHealth([
      check(1, 'completed', 'success'),
      check(2, 'in_progress', null),
    ]);
    expect(health.state).toBe('running');
    expect(health.pending).toHaveLength(1);
  });

  it('gives failures precedence over pending checks', () => {
    const health = branchHealth([
      check(1, 'completed', 'failure'),
      check(2, 'queued', null),
    ]);
    expect(health.state).toBe('failing');
    expect(health.failing).toHaveLength(1);
  });

  it('does not report stale checks as passing', () => {
    expect(branchHealth([check(1, 'completed', 'stale')]).state).toBe('failing');
  });
});

describe('GitHub review age', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');

  it('formats and tones ambient age thresholds', () => {
    expect(ageLabel('2026-07-24T11:30:00Z', now)).toBe('<1h');
    expect(ageLabel('2026-07-24T00:00:00Z', now)).toBe('12h');
    expect(ageLabel('2026-07-21T12:00:00Z', now)).toBe('3d');
    expect(ageTone('2026-07-24T11:30:00Z', now)).toBe('neutral');
    expect(ageTone('2026-07-24T00:00:00Z', now)).toBe('warning');
    expect(ageTone('2026-07-21T12:00:00Z', now)).toBe('danger');
  });

  it('maps review requests into compact feed rows', () => {
    const issues: GitHubSearchIssue[] = [
      {
        id: 42,
        number: 17,
        title: 'Add GitHub widgets',
        html_url: 'https://github.com/acme/dashboard/pull/17',
        repository_url: 'https://api.github.com/repos/acme/dashboard',
        created_at: '2026-07-21T12:00:00Z',
      },
    ];
    expect(reviewFeedItems(issues, 6, now)).toEqual([
      {
        id: '42',
        title: 'Add GitHub widgets',
        url: 'https://github.com/acme/dashboard/pull/17',
        subtitle: 'acme/dashboard · #17',
        badge: '3d',
        tone: 'danger',
      },
    ]);
  });
});

describe('My GitHub PRs', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');

  function pull(overrides: Partial<MyPullRequest> = {}): MyPullRequest {
    return {
      id: '1',
      number: 1,
      title: 'A pull request',
      url: 'https://github.com/acme/repo/pull/1',
      repository: 'acme/repo',
      isDraft: false,
      createdAt: '2026-07-24T02:00:00Z',
      additions: 100,
      deletions: 50,
      ...overrides,
    };
  }

  it('uses Monday as the weekly velocity boundary', () => {
    expect(startOfWeekDate(Date.parse('2026-07-20T00:00:00Z'))).toBe('2026-07-20');
    expect(startOfWeekDate(Date.parse('2026-07-24T12:00:00Z'))).toBe('2026-07-20');
    expect(startOfWeekDate(Date.parse('2026-07-26T23:59:00Z'))).toBe('2026-07-20');
  });

  it('distinguishes drafts, reviewed PRs, and escalating review wait', () => {
    expect(reviewSignal(pull({ isDraft: true }), 24, now)).toEqual({
      label: 'Draft',
      tone: 'neutral',
    });
    expect(
      reviewSignal(
        pull({
          createdAt: '2026-07-24T02:00:00Z',
          firstReviewAt: '2026-07-24T06:00:00Z',
        }),
        24,
        now,
      ),
    ).toEqual({ label: 'Reviewed in 4h', tone: 'good' });
    expect(reviewSignal(pull({ createdAt: '2026-07-23T06:00:00Z' }), 24, now).tone).toBe('warning');
    expect(reviewSignal(pull({ createdAt: '2026-07-22T06:00:00Z' }), 24, now).tone).toBe('danger');
  });

  it('warns at the configured PR size and escalates at twice the limit', () => {
    expect(prSizeSignal(pull({ additions: 300, deletions: 199 }), 500)).toBeNull();
    expect(prSizeSignal(pull({ additions: 300, deletions: 200 }), 500)).toEqual({
      label: '500 lines',
      tone: 'warning',
    });
    expect(prSizeSignal(pull({ additions: 800, deletions: 200 }), 500)).toEqual({
      label: '1,000 lines',
      tone: 'danger',
    });
  });

  it('puts unreviewed active PRs before reviewed PRs and drafts', () => {
    const ordered = prioritizePullRequests([
      pull({ id: 'draft', isDraft: true }),
      pull({ id: 'reviewed', firstReviewAt: '2026-07-24T06:00:00Z' }),
      pull({ id: 'recent', createdAt: '2026-07-24T10:00:00Z' }),
      pull({ id: 'old', createdAt: '2026-07-20T10:00:00Z' }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['old', 'recent', 'reviewed', 'draft']);
  });
});

describe('GitHub milestone progress', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');

  it('calculates completion from open and closed work', () => {
    expect(milestoneProgress(4, 8)).toBe(67);
    expect(milestoneProgress(0, 8)).toBe(100);
    expect(milestoneProgress(0, 0)).toBe(0);
    expect(milestoneSignal(0, 0, '2026-07-01T12:00:00Z', now)).toEqual({
      progress: 0,
      tone: 'neutral',
      dueLabel: 'No items',
    });
  });

  it('marks completed milestones as good regardless of due date', () => {
    expect(milestoneSignal(0, 8, '2026-07-01T12:00:00Z', now)).toEqual({
      progress: 100,
      tone: 'good',
      dueLabel: 'Complete',
    });
  });

  it('escalates overdue milestones with open work', () => {
    expect(milestoneSignal(4, 8, '2026-07-22T12:00:00Z', now)).toEqual({
      progress: 67,
      tone: 'danger',
      dueLabel: 'Overdue by 2d',
    });
  });

  it('warns within seven days and stays neutral farther out', () => {
    expect(milestoneSignal(4, 8, '2026-07-25T12:00:00Z', now)).toEqual({
      progress: 67,
      tone: 'warning',
      dueLabel: 'Due tomorrow',
    });
    expect(milestoneSignal(4, 8, '2026-07-31T12:00:00Z', now).tone).toBe('warning');
    expect(milestoneSignal(4, 8, '2026-08-01T12:00:00Z', now).tone).toBe('neutral');
    expect(milestoneSignal(4, 8, null, now)).toEqual({
      progress: 67,
      tone: 'neutral',
      dueLabel: 'No due date',
    });
  });
});

describe('GitHub Actions failure helpers', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');

  it('builds a clamped workflow failure lookback window', () => {
    expect(failureWindowStart(24, now)).toBe('2026-07-23T12:00:00Z');
    expect(failureWindowStart(0, now)).toBe('2026-07-24T11:00:00Z');
    expect(failureWindowStart(999, now)).toBe('2026-07-17T12:00:00Z');
  });

  it('maps failed workflow runs to actionable feed items', () => {
    const runs: GitHubWorkflowRun[] = [
      {
        id: 42,
        name: 'CI',
        display_title: 'Fix flaky test',
        html_url: 'https://github.com/acme/repo/actions/runs/42',
        head_branch: 'main',
        run_number: 17,
        run_attempt: 1,
        created_at: '2026-07-24T10:00:00Z',
      },
    ];

    expect(workflowFailureItems(runs, 6, now)).toEqual([
      {
        id: '42',
        title: 'Fix flaky test',
        url: 'https://github.com/acme/repo/actions/runs/42',
        subtitle: 'CI · main · #17',
        badge: '2h',
        tone: 'danger',
      },
    ]);
  });

  it('falls back to workflow and detached-commit labels', () => {
    const runs: GitHubWorkflowRun[] = [
      {
        id: 7,
        name: 'Release',
        display_title: '',
        html_url: 'https://github.com/acme/repo/actions/runs/7',
        head_branch: null,
        run_number: 3,
        run_attempt: 1,
        created_at: '2026-07-24T11:59:00Z',
      },
    ];

    expect(workflowFailureItems(runs, 1, now)[0]).toMatchObject({
      title: 'Release',
      subtitle: 'Release · detached · #3',
      badge: '<1h',
    });
  });
});

describe('GitHub issue triage helpers', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');

  it('turns ownerless issue counts into ambient signals', () => {
    expect(issueTriageSignal(0, 0, 5)).toEqual({
      unassignedPercent: 0,
      tone: 'good',
    });
    expect(issueTriageSignal(10, 2, 5)).toEqual({
      unassignedPercent: 20,
      tone: 'warning',
    });
    expect(issueTriageSignal(10, 5, 5)).toEqual({
      unassignedPercent: 50,
      tone: 'danger',
    });
    expect(issueTriageSignal(2, 3, 5).unassignedPercent).toBe(100);
  });

  it('maps unassigned issues into oldest-first triage rows', () => {
    const issues: GitHubTriageIssue[] = [
      {
        id: 42,
        number: 17,
        title: 'Investigate stale cache entries',
        html_url: 'https://github.com/acme/repo/issues/17',
        created_at: '2026-07-21T12:00:00Z',
        labels: [{ name: 'bug' }],
      },
      {
        id: 43,
        number: 18,
        title: 'Document the release workflow',
        html_url: 'https://github.com/acme/repo/issues/18',
        created_at: '2026-07-24T10:00:00Z',
        labels: [],
      },
    ];

    expect(unassignedIssueItems(issues, 1, now)).toEqual([
      {
        id: '42',
        title: 'Investigate stale cache entries',
        url: 'https://github.com/acme/repo/issues/17',
        subtitle: '#17 · bug',
        badge: '3d',
        tone: 'danger',
      },
    ]);
    expect(unassignedIssueItems(issues, 2, now)[1]).toMatchObject({
      subtitle: '#18',
      badge: '2h',
      tone: 'neutral',
    });
  });
});

describe('GitHub release download helpers', () => {
  function release(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
    return {
      id: 1,
      tag_name: 'v1.0.0',
      name: 'Version 1.0',
      html_url: 'https://github.com/acme/repo/releases/tag/v1.0.0',
      draft: false,
      prerelease: false,
      published_at: '2026-07-20T12:00:00Z',
      assets: [],
      ...overrides,
    };
  }

  it('selects the newest release for the configured channel', () => {
    const releases = [
      release({ id: 1, tag_name: 'v2.0.0-beta.1', prerelease: true }),
      release({ id: 2, tag_name: 'v1.5.0' }),
      release({ id: 3, tag_name: 'v1.4.0', draft: true }),
    ];

    expect(selectRelease(releases, 'stable')?.id).toBe(2);
    expect(selectRelease(releases, 'prerelease')?.id).toBe(1);
    expect(selectRelease([release({ draft: true })], 'stable')).toBeNull();
  });

  it('sums release asset downloads without allowing negative counts', () => {
    const assets: GitHubReleaseAsset[] = [
      {
        id: 1,
        name: 'app.zip',
        browser_download_url: 'https://github.com/acme/repo/releases/download/v1/app.zip',
        download_count: 120,
        size: 2 * 1024 * 1024,
      },
      {
        id: 2,
        name: 'app.tar.gz',
        browser_download_url: 'https://github.com/acme/repo/releases/download/v1/app.tar.gz',
        download_count: -1,
        size: 1024,
      },
    ];

    expect(releaseDownloadTotal(assets)).toBe(120);
  });

  it('orders downloadable assets by adoption and formats compact rows', () => {
    const assets: GitHubReleaseAsset[] = [
      {
        id: 1,
        name: 'checksums.txt',
        browser_download_url: 'https://github.com/acme/repo/releases/download/v1/checksums.txt',
        download_count: 30,
        size: 512,
      },
      {
        id: 2,
        name: 'app.zip',
        browser_download_url: 'https://github.com/acme/repo/releases/download/v1/app.zip',
        download_count: 120,
        size: 2 * 1024 * 1024,
      },
    ];

    expect(releaseAssetItems(assets, 1)).toEqual([
      {
        id: '2',
        title: 'app.zip',
        url: 'https://github.com/acme/repo/releases/download/v1/app.zip',
        subtitle: '2 MB',
        badge: '120 dl',
        tone: 'neutral',
      },
    ]);
  });
});

describe('GitHub first-time contributor helpers', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');

  function pull(
    overrides: Partial<GitHubContributorPullRequest> = {},
  ): GitHubContributorPullRequest {
    return {
      id: 1,
      number: 17,
      title: 'Improve the contributor guide',
      html_url: 'https://github.com/acme/repo/pull/17',
      created_at: '2026-07-23T12:00:00Z',
      draft: false,
      author_association: 'FIRST_TIME_CONTRIBUTOR',
      user: { login: 'octocat' },
      ...overrides,
    };
  }

  it('recognizes both GitHub first-time author classifications', () => {
    expect(isFirstTimeContributor(pull())).toBe(true);
    expect(isFirstTimeContributor(pull({ author_association: 'FIRST_TIMER' }))).toBe(true);
    expect(isFirstTimeContributor(pull({ author_association: 'CONTRIBUTOR' }))).toBe(false);
  });

  it('excludes drafts by default and orders the welcome queue oldest first', () => {
    const pulls = [
      pull({ id: 1, created_at: '2026-07-24T10:00:00Z' }),
      pull({ id: 2, created_at: '2026-07-20T10:00:00Z' }),
      pull({ id: 3, draft: true, created_at: '2026-07-19T10:00:00Z' }),
      pull({ id: 4, author_association: 'MEMBER' }),
    ];

    expect(firstTimeContributorPullRequests(pulls, false).map((item) => item.id)).toEqual([
      2,
      1,
    ]);
    expect(firstTimeContributorPullRequests(pulls, true).map((item) => item.id)).toEqual([
      3,
      2,
      1,
    ]);
  });

  it('maps contributor context and age into actionable feed rows', () => {
    expect(
      contributorPullRequestItems(
        [
          pull({
            author_association: 'FIRST_TIMER',
            created_at: '2026-07-21T12:00:00Z',
          }),
          pull({ id: 2, number: 18, draft: true }),
        ],
        2,
        now,
      ),
    ).toEqual([
      {
        id: '1',
        title: 'Improve the contributor guide',
        url: 'https://github.com/acme/repo/pull/17',
        subtitle: '@octocat · #17 · New to GitHub',
        badge: '3d',
        tone: 'danger',
      },
      {
        id: '2',
        title: 'Improve the contributor guide',
        url: 'https://github.com/acme/repo/pull/17',
        subtitle: '@octocat · #18 · Draft',
        badge: '1d',
        tone: 'neutral',
      },
    ]);
  });
});

describe('GitHub PR cycle-time helpers', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');
  const created = Date.parse('2026-07-01T12:00:00Z');

  function pull(hours: number, id = hours): GitHubCyclePullRequest {
    const mergedAt = new Date(created + hours * 3_600_000).toISOString();
    return {
      id,
      number: id,
      title: `Pull request ${id}`,
      html_url: `https://github.com/acme/repo/pull/${id}`,
      created_at: new Date(created).toISOString(),
      updated_at: mergedAt,
      merged_at: mergedAt,
      user: { login: 'octocat' },
    };
  }

  it('builds a bounded lookback window and formats durations', () => {
    expect(cycleWindowStart(30, now)).toBe('2026-06-24T12:00:00.000Z');
    expect(cycleWindowStart(0, now)).toBe('2026-07-23T12:00:00.000Z');
    expect(formatCycleDuration(0.5)).toBe('<1h');
    expect(formatCycleDuration(12.4)).toBe('12h');
    expect(formatCycleDuration(36)).toBe('1.5d');
    expect(formatCycleDuration(96)).toBe('4d');
  });

  it('calculates average, median, P90, and threshold tone', () => {
    expect(cycleTimeStats([pull(12), pull(24), pull(48), pull(96)], 24, 72)).toEqual({
      count: 4,
      averageHours: 45,
      medianHours: 36,
      p90Hours: 96,
      tone: 'warning',
    });
    expect(cycleTimeStats([pull(96)], 24, 72).tone).toBe('danger');
    expect(cycleTimeStats([], 24, 72).tone).toBe('neutral');
  });

  it('surfaces the slowest merges with direct context', () => {
    expect(cycleTimeItems([pull(12, 1), pull(96, 4)], 1, 24, 72, now)).toEqual([
      {
        id: '4',
        title: 'Pull request 4',
        url: 'https://github.com/acme/repo/pull/4',
        subtitle: '@octocat · #4 · merged 19d ago',
        badge: '4d',
        tone: 'danger',
      },
    ]);
  });
});

describe('GitHub notification helpers', () => {
  const now = Date.parse('2026-07-24T12:00:00Z');

  function notification(
    overrides: Partial<GitHubNotificationThread> = {},
  ): GitHubNotificationThread {
    return {
      id: '42',
      unread: true,
      reason: 'mention',
      updated_at: '2026-07-21T12:00:00Z',
      subject: {
        title: 'Please review the migration plan',
        url: 'https://api.github.com/repos/acme/repo/issues/17',
        latest_comment_url: null,
        type: 'Issue',
      },
      repository: {
        full_name: 'acme/repo',
        html_url: 'https://github.com/acme/repo',
      },
      ...overrides,
    };
  }

  it('keeps the default notification scope focused on direct attention', () => {
    expect(notificationMatchesScope(notification(), 'attention')).toBe(true);
    expect(
      notificationMatchesScope(notification({ reason: 'review_requested' }), 'attention'),
    ).toBe(true);
    expect(notificationMatchesScope(notification({ reason: 'comment' }), 'attention')).toBe(
      false,
    );
    expect(notificationMatchesScope(notification({ reason: 'comment' }), 'participating')).toBe(
      true,
    );
    expect(notificationMatchesScope(notification({ unread: false }), 'all')).toBe(false);
  });

  it('maps common notification subjects to their GitHub web pages', () => {
    expect(notificationWebUrl(notification())).toBe('https://github.com/acme/repo/issues/17');
    expect(
      notificationWebUrl(
        notification({
          subject: {
            title: 'A pull request',
            url: 'https://api.github.com/repos/acme/repo/pulls/18',
            latest_comment_url: null,
            type: 'PullRequest',
          },
        }),
      ),
    ).toBe('https://github.com/acme/repo/pull/18');
    expect(
      notificationWebUrl(
        notification({
          subject: {
            title: 'A release',
            url: 'https://api.github.com/repos/acme/repo/releases/19',
            latest_comment_url: null,
            type: 'Release',
          },
        }),
      ),
    ).toBe('https://github.com/acme/repo');
  });

  it('formats unread threads as aged, actionable feed rows', () => {
    expect(notificationItems([notification()], 6, now)).toEqual([
      {
        id: '42',
        title: 'Please review the migration plan',
        url: 'https://github.com/acme/repo/issues/17',
        subtitle: 'acme/repo · Mentioned',
        badge: '3d',
        tone: 'danger',
      },
    ]);
  });
});

describe('GitHub Dependabot helpers', () => {
  function alert(
    severity: GitHubDependabotAlert['security_advisory']['severity'],
    overrides: Partial<GitHubDependabotAlert> = {},
  ): GitHubDependabotAlert {
    return {
      number: 17,
      state: 'open',
      dependency: {
        package: { ecosystem: 'npm', name: 'example-package' },
        manifest_path: 'package-lock.json',
        scope: 'runtime',
      },
      security_advisory: {
        ghsa_id: 'GHSA-1234-5678-9012',
        cve_id: 'CVE-2026-1234',
        summary: 'Example package can execute arbitrary code',
        severity,
      },
      html_url: 'https://github.com/acme/repo/security/dependabot/17',
      created_at: '2026-07-20T12:00:00Z',
      ...overrides,
    };
  }

  it('expands minimum severity into the GitHub filter values', () => {
    expect(dependabotSeverityFilter('all')).toEqual(['low', 'medium', 'high', 'critical']);
    expect(dependabotSeverityFilter('medium')).toEqual(['medium', 'high', 'critical']);
    expect(dependabotSeverityFilter('high')).toEqual(['high', 'critical']);
    expect(dependabotSeverityFilter('critical')).toEqual(['critical']);
  });

  it('prioritizes severe alerts and preserves actionable dependency context', () => {
    expect(
      dependabotAlertItems(
        [
          alert('medium', { number: 2 }),
          alert('critical', { number: 3 }),
          alert('high', { number: 1 }),
        ],
        2,
      ),
    ).toEqual([
      {
        id: '3',
        title: 'Example package can execute arbitrary code',
        url: 'https://github.com/acme/repo/security/dependabot/17',
        subtitle: 'example-package · npm · package-lock.json',
        badge: 'critical',
        tone: 'danger',
      },
      {
        id: '1',
        title: 'Example package can execute arbitrary code',
        url: 'https://github.com/acme/repo/security/dependabot/17',
        subtitle: 'example-package · npm · package-lock.json',
        badge: 'high',
        tone: 'danger',
      },
    ]);
  });
});

describe('GitHub traffic helpers', () => {
  function trafficCounts(counts: number[]): GitHubTrafficPoint[] {
    return counts.map((count, index) => ({
      timestamp: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
      count,
      uniques: Math.ceil(count / 2),
    }));
  }

  it('compares activity counts across adjacent seven-day windows', () => {
    expect(trafficCountDelta(trafficCounts([...Array(7).fill(10), ...Array(7).fill(15)]))).toBe(
      50,
    );
    expect(trafficCountDelta(trafficCounts([...Array(7).fill(10), ...Array(7).fill(5)]))).toBe(
      -50,
    );
  });

  it('waits for two complete windows and avoids dividing by zero', () => {
    expect(trafficCountDelta(trafficCounts(Array(13).fill(10)))).toBeNull();
    expect(trafficCountDelta(trafficCounts([...Array(7).fill(0), ...Array(7).fill(5)]))).toBeNull();
    expect(trafficCountDelta(trafficCounts(Array(14).fill(0)))).toBe(0);
  });

  it('formats compact ambient trend labels', () => {
    expect(trafficTrendLabel(25.4)).toBe('↑ 25%');
    expect(trafficTrendLabel(-10.1)).toBe('↓ 10%');
    expect(trafficTrendLabel(0.2)).toBe('Steady');
    expect(trafficTrendLabel(null)).toBe('Trend pending');
  });
});

describe('GitHub coverage trend helpers', () => {
  function coverage(avg: number, day: number): CodecovCoverageMeasurement {
    return {
      timestamp: new Date(Date.UTC(2026, 6, day)).toISOString(),
      min: avg - 0.2,
      max: avg + 0.2,
      avg,
    };
  }

  it('compares the latest two Codecov measurements in chronological order', () => {
    expect(coverageSignal([coverage(91.2, 3), coverage(90.7, 1), coverage(91, 2)])).toEqual({
      current: 91.2,
      previous: 91,
      delta: 0.20000000000000284,
      tone: 'good',
    });
    expect(coverageSignal([coverage(89.5, 2), coverage(90, 1)]).tone).toBe('danger');
    expect(coverageSignal([coverage(90, 1)])).toEqual({
      current: 90,
      previous: null,
      delta: null,
      tone: 'neutral',
    });
  });

  it('formats coverage movement in percentage points', () => {
    expect(coverageDeltaLabel(0.35)).toBe('+0.3 pp');
    expect(coverageDeltaLabel(-1.24)).toBe('−1.2 pp');
    expect(coverageDeltaLabel(0.01)).toBe('No change');
    expect(coverageDeltaLabel(null)).toBe('Baseline');
  });

  it('creates a bounded sparkline, including a flat series', () => {
    expect(coverageSparkline([coverage(80, 1), coverage(90, 2)])).toBe(
      '0.0,25.0 100.0,3.0',
    );
    expect(coverageSparkline([coverage(90, 1), coverage(90, 2)])).toBe(
      '0.0,25.0 100.0,25.0',
    );
  });
});
