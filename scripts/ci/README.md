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
