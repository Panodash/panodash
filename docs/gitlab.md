# GitLab

Panodash includes first-class GitLab widgets for GitLab.com and self-managed instances. They use GitLab's REST API directly from the extension; metric payloads and credentials do not pass through the Panodash bridge.

## Connection

GitLab widgets share one personal access token stored in local extension storage. Create a token with the `read_api` scope, then paste it into any GitLab widget that asks for a connection. Public project widgets can work without a token; private projects and personal widgets require one.

For project widgets, enter either:

- a GitLab.com path such as `group/subgroup/project`; or
- a full project URL such as `https://gitlab.example.com/group/project`.

Personal widgets such as review queue, My GitLab MRs, and to-dos have a separate GitLab host field so they can query a self-managed instance without a project URL.

Panodash requests optional host access only for the configured GitLab origin.

## Widgets

| GitHub signal | GitLab widget |
| --- | --- |
| Stars | Stars |
| Review queue | Review queue |
| Branch health | Branch health from the latest pipeline and its jobs |
| My PRs | My MRs |
| Milestone progress | Milestone progress across issues and merge requests |
| Actions failures | Pipeline failures |
| Issue triage | Issue triage |
| Release downloads | Release assets |
| First-time contributors | First-time contributors |
| PR cycle time | MR cycle time |
| Notifications | To-dos |

GitLab's API does not expose per-asset release download counts. The release widget therefore reports the latest release's linked assets and generated source archives. GitLab also does not expose GitHub-style author-association flags, so the first-time contributor widget checks open authors for prior merged merge requests and scans at most the oldest 100 open merge requests per refresh.
