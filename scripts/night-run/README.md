# Subscription RSI runner

`ag.nuke.night-run` wakes every 15 minutes and at 01:30 local time. A wake-up is a controller check,
not necessarily a model call. The existing default 45-minute allowance is shared by ALL invocations
in the local 01:30-to-01:30 window. `NIGHT_RUN_CAP` changes that total, not a per-turn limit.
The machine must be awake and the user launchd domain available; this is not a cloud service.

The controller keeps one objective, acceptance criteria, Claude session ID and worktree across turns
and days. A successful CLI return becomes a checkpoint. An active checkpoint runs again on the next
wake-up while allowance remains. A completed objective is archived; the next wake-up can select another
objective while daily allowance remains. Existing old nightly PRs/worktrees are not deleted or automatically adopted.
The work order tells the agent to inspect those PRs before choosing duplicate work.

- `active`: authorized work remains. A nonempty `ready_actions` array keeps the objective active even
  when the agent reports a review gate or blocker on other steps. Budget/backoff may defer invocation.
- `waiting_review`: linked PR metadata is checked without inference. A change in head, checks, review
  or merge state resumes the same objective. This waits only when no independent ready actions remain.
  The explicit unattended no-merge hold remains.
- `blocked`: an external/authorization dependency, three controller failures, or three identical
  active handoffs. The saved reason explains what must change. After resolving it, use `--resume`.
- `complete`: the agent supplied acceptance receipts, linked PRs are merged (or closed with
  recorded merged replacements), the worktree is clean, and no ready actions remain.
  Receipt existence is mechanically checked; semantic correctness and public readiness remain agent
  claims supported by those receipts, not independently certified by the controller.

`ready_actions` contains descriptions of concrete, already authorized independent steps; it is never
executed as shell commands and cannot authorize held dependent work. Blocker/unblock conditions remain
in the handoff. Three identical handoffs still block even when a review/blocked handoff contains ready
work. A legacy waiting or agent-blocked checkpoint missing the field initiates one readiness reassessment
in the same session/worktree and existing daily allowance. Before launch, the controller records that
initiation and makes the scheduler active while preserving the handoff's blocker and holds. A timeout or
crash leaves unfinished assessment active for ordinary continuation within the current or next budget
window; it does not initiate another migration. Subscription limits retain the existing six-hour backoff.
A valid checkpoint with an empty ready list restores its declared wait/block. Controller failure and
stagnation stops remain enforced. No live state edit or timer replacement is needed for this migration.

Subscription-limit responses, including weekly limits, defer for six hours and retry automatically. A
controller already stopped after three failures remains blocked until its cause is resolved and `--resume`
is explicitly used. Other errors back off before blocking after three consecutive failures.
Nothing switches to API billing or discards context to evade
a limit. The launcher retains the existing `acceptEdits`, allowed-tool and denied-tool configuration.
These and the work-order rules are not a new OS security boundary. Existing repo/user safety settings
continue to apply; this change does not authorize production writes, unattended merges or deployment.

## Inspect and operate

```bash
bash scripts/night-run/run.sh --dry-run  # state and budget; no inference, fetch or worktree changes
bash scripts/night-run/run.sh           # one controller wake-up
bash scripts/night-run/run.sh --resume  # retry a resolved blocker; retains goal/session/budget
python3 scripts/night-run/test_controller.py  # offline contracts; no model/network/production access
```

State: `~/nuke-logs/night-run/state.json`. Daily reports: `<UTC date>.md`. CLI results:
`<task-id>-<attempt>.json` plus `.stderr.txt`. Completed task receipts: `task-<id>.json`.
Agent scratch evidence stays in the task worktree's git-excluded `.night/` directory. Treat logs as
private; do not commit them. `NIGHT_RUN_REPO` and `NIGHT_RUN_LOG_DIR` select checkout/log locations;
`NIGHT_RUN_MODEL` retains the previous default model. There is no forced worktree cleanup.

The state is atomically replaced under a process lock. The controller reserves the remaining daily
allowance before starting a child and refunds unused time only after it exits. A crash leaves that
reservation charged. GNU timeout bounds the child process group even if the controller dies; a failed
resume is reported and never silently replaced with a fresh conversation. A missing worktree blocks
rather than reconstructing unfinished work from main.

The launchd plist fetches `origin/main` and loads the launcher/controller from it, independently of the
shared checkout's branch. To install an already-reviewed revision, copy its plist to
`~/Library/LaunchAgents/ag.nuke.night-run.plist`, then bootout/bootstrap that existing label. Check that
no invocation is running before replacement. The first wake-up after installation starts real work;
`--dry-run` never does. Rollback: reinstall the previous reviewed plist and controller revision through
the normal PR path; preserve state and unfinished worktrees for inspection. Stop the local timer with
`launchctl bootout gui/$(id -u)/ag.nuke.night-run`.
