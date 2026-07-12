# Nuke CI — the local gate

There is **no GitHub Actions** in this repo. The real gate has always been: verify locally, then
push → Vercel builds/deploys. This makes that gate explicit and adds the ledger guardrails as
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
| `no-committed-secrets` | **gate** | 0 (hard) | any hit blocks in any mode |
| `no-raw-fetch` (must use `archiveFetch`) | **ratchet** | 144 | burn down opportunistically |
| `no-raw-testimony-insert` (must use `ingest-observation`) | **ratchet** | 2 | should trend to 0 |
| `no-schema-baked-labels` (label-as-projection) | advisory | 282 | never blocks; informational |

**Ratchet rule:** a check fails only when its count **exceeds** the baseline — i.e. you *added* a
violation. Pre-existing debt doesn't block you; new debt does. As you fix violations, lower the
floor with `CI_WRITE_BASELINE=1`. Never raise it.

The ghost ratchet uses `git grep`, so it sees committed/staged files (exactly what a push carries).

## Rollout status (set up 2026-07-12, warn mode)

- `scripts/ci/verify.sh` + `scripts/ci/baseline.json` — the gate, seeded and self-tested (a planted
  ghost ref was confirmed to trip it).
- `.git/hooks/pre-push` — **installed, WARN mode**: it prints the report on every `git push` but does
  **not** block. This is deliberate so nothing bricks unattended.
  - Make it block: `CI_ENFORCE=1 git push`, or add `export CI_ENFORCE=1` at the top of the hook, or
    delete the final `exit 0` line so `verify.sh`'s own exit code stands.
  - Bypass once: `git push --no-verify`.  Remove: `rm .git/hooks/pre-push`.

## Opt-in: keep AI agents on rails (not installed — your call)

A Claude Code `PreToolUse` hook can preflight every new edge-function/migration an agent tries to
write, blocking a duplicate mint of an existing canonical capability and warning on dead-asset refs.
It touches your interactive `.claude/settings.json`, so it's left for you to enable. The exact JSON +
copy-paste apply command are in `scripts/guardrails/README.md` (section b).

## Where the authority lives

`docs/ledger/` — `CANONICAL_LEDGER.md`, `CAPABILITY_MAP.md` (check before minting anything),
`disposition.json` (intent fates), `theory/` (per-subsystem cards). The guardrails read `ledger.json`.
