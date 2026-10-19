# Nuke CI — the local gate

Run this gate in the checkout being published; it resolves its root from the script location.
GitHub workflows also validate changes; Supabase deploys belong to `supabase-deploy.yml`.
The local gate adds the ledger guardrails as
regression ratchets, so weaker models (and tired humans) can't quietly re-introduce the failure
classes the 2026-07-12 audit found.

## Run it

```bash
scripts/ci/verify.sh                    # WARN mode (default): reports, never blocks. exit 0 always.
CI_ENFORCE=1 scripts/ci/verify.sh       # ENFORCE: exit 1 on any regression / secret / typecheck fail
CI_BUILD=1  scripts/ci/verify.sh        # also run `vite build` (slower; catches build-only breaks)
CI_WRITE_BASELINE=1 scripts/ci/verify.sh  # re-seed baseline.json from current counts (after burndown)
```

Each invocation owns a private scratch directory under `${TMPDIR:-/tmp}`. Count JSON and
diagnostic logs are isolated between invocations and removed on exit or handled HUP/INT/TERM.
Allocation failure stops the gate before grading. Diagnostics still print to the gate's output;
redirect that output to retain a receipt. This does not serialize intentional
`CI_WRITE_BASELINE=1` writes to the same checkout's baseline file.

Run the offline isolation and mode contracts with `node --test scripts/ci/verify.test.mjs`.
They execute the verifier in fixture checkout roots with controlled commands. Legacy global
scratch paths are translated only into the fixture namespace; tests never touch another gate's files.

## What it checks

| Check | Type | Baseline (2026-07-12) | Notes |
|---|---|---|---|
| frontend typecheck (`tsc --noEmit`) | **gate** | must be clean | hard fail if red |
| `no-dead-asset-references` (ghost tables/fns on live paths) | **ratchet** | 18 | 12 webhooks (pending strip) + 6 guarded `vehicle_transactions` |
| `no-committed-secrets` | **gate** | 0 | any hit fails ENFORCE; WARN reports without blocking |
| `no-raw-fetch` (must use `archiveFetch`) | **ratchet** | 144 | burn down opportunistically |
| raw-fetch regression fixtures | **gate** | must pass | internal URL continuations, external pages and Firecrawl |
| `no-raw-testimony-insert` (must use `ingest-observation`) | **ratchet** | 2 | should trend to 0 |
| `no-schema-baked-labels` (label-as-projection) | advisory | 282 | never blocks; informational |
| `design-system/*` (seven eslint rules over `src`, `src/kit` exempt) | **ratchet**, one floor per rule | seeded 2026-10-12 | `node scripts/guardrails/design-violations.mjs` to list; `--list <rule>` for sites. The kit is the only place type and inline style may be set. |

**Ratchet rule:** a check fails only when its count **exceeds** the baseline — i.e. you *added* a
violation. Pre-existing debt doesn't block you; new debt does. As you fix violations, lower the
floor with `CI_WRITE_BASELINE=1`. Never raise it.

The ghost ratchet uses `git grep`, so it sees committed/staged files (exactly what a push carries).

## Local installation (recorded 2026-07-12)

- `scripts/ci/verify.sh` + `scripts/ci/baseline.json` — the gate, seeded and self-tested (a planted
  ghost ref was confirmed to trip it).
- The original installation's `.git/hooks/pre-push` ran **ENFORCE mode** (`CI_ENFORCE=1 verify.sh`): it **blocks**
  a push that regresses a guardrail, fails typecheck, or commits a secret. Confirmed passing on the
  tree checked at installation. Hook files are local, not proof of another checkout's configuration.

Before relying on a hook, inspect `core.hooksPath` and the hook in `git rev-parse --git-common-dir`.
Run the ENFORCE gate directly in the checkout being published when its hook does not run that
checkout's gate. Do not bypass checks, soften enforcement or raise a baseline to publish a failing
change. See `AGENTS.md` for the authorized publication path.

## Agent tool hooks

A Claude Code `PreToolUse` hook can preflight every new edge-function/migration an agent tries to
write, blocking a duplicate mint of an existing canonical capability and warning on dead-asset refs.
Its installation is client-specific; inspect the active client configuration before relying on it.
`scripts/guardrails/pretooluse-mint-check.sh` is the existing capability-preflight implementation.
Do not overwrite existing hooks or assume a Claude hook also runs in Codex.

## Where the authority lives

`AGENTS.md` routes development work. `docs/ledger/theory/data-machine.md` defines owner intent;
the case ledger records open work and dated acceptance evidence. The guardrails read the audit
inventory in `ledger.json`, and the local ratchets use `scripts/ci/baseline.json`. These inputs do
not establish current database health or authorize archival. See `docs/ledger/README.md` and verify
operational claims against the live atlas and affected writer/reader.

## Job-loop migration replay

`supabase/sql/test_job_loop_replay.sql` (db-contracts job) replays the job-loop build's migrations in filename order on
PostgreSQL 17, as `supabase db reset` or a preview branch would. Push deploys apply only migration files a push
**adds** (`supabase-deploy.yml`, `--diff-filter=A`), in push order, so live order can differ from filename order and an
edit to an already-merged file never reaches live through a push (use the workflow's exact-file `migration_file`
dispatch for a reviewed recovery). `scripts/ci/job-loop-replay-check.sh` fails the contract when a job-loop-named
migration is missing from the replay, out of order, or absent; append new ones in filename order.
