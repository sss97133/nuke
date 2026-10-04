# Guardrails — Nuke repo rails for agents

Checks that address failure classes found by the 2026-07-12 ledger audit. Their execution paths
determine enforcement: `scripts/ci/verify.sh` runs local checks and ratchets, and
`.github/workflows/supabase-deploy.yml` runs write-guard validation before edge-function deployment.
Some checks are advisory; local tool and Git hooks vary by installation. Do not infer that every
agent has a hook installed or that every documented invariant has an executable guard.

Development instructions: `AGENTS.md` and the applicable `.claude/rules/`. Design requirements:
`docs/ledger/theory/data-machine.md`. The guard scripts consume dated ledger inventory where
specified; current operational claims still require live verification.

## The suite

| Script | Catches | 2026-07-12 measurements unless otherwise dated |
|---|---|---|
| `no-raw-fetch.sh` | Edge functions fetching external pages directly instead of via `_shared/archiveFetch` (results must land in `listing_page_snapshots`). Allowlists internal/LLM/OAuth calls; escape hatch `// guardrail-allow: raw-fetch`. | **144** (~70-80% genuine raw scrapes; rest internal-in-disguise — wire as a ratchet, not a hard block) |
| `no-raw-testimony-insert.mjs` | Raw INSERT/UPSERT into testimony tables (`vehicle_observations`, `vehicle_user_permissions`) bypassing the `ingest-observation` front door — in migrations (incl. DO blocks) and edge functions. Marker bypass: `ALLOW_RAW_TESTIMONY_WRITE`. | **2** (+1 grandfathered baseline) |
| `no-committed-secrets.sh` | Committed private keys, PEM blocks, service_role JWTs (decoded, not pattern-matched — anon keys pass), provider API keys, secret-named assignments. Default mode scans the git index (0.04s, pre-commit safe); `--tracked` = full audit. | **0** |
| `check-capability-before-mint.mjs` | Minting a function/table/page whose capability already has a canonical owner, or resurrecting a DEAD/RETIRED name. Per-name preflight: `check-capability-before-mint.mjs "<name>"` → exit 0 CLEAR / 1 STOP. `--json`, `--test` available. | n/a (preflight, not a sweeper) |
| `no-schema-baked-labels.mjs` | New migrations baking world-labels as CHECK enums / CREATE TYPE (doctrine: labels are projections of measurement). Advisory — always exits 0. Default scopes to staged migrations; `--all` = full audit. | **282** across 143 historical migrations (`--all`); staged mode currently clean |
| `check-write-guard.mjs` | An edge function that writes (table/storage/auth.admin/write RPC/raw SQL, or fan-out to a writer) without `requireWriteAuth` from `_shared/writeGuard.ts` and not on the script's allowlist. Runs in `supabase-deploy.yml` before deploy — a hit blocks the deploy. `--list` prints every function's classification. | **0** (2026-09-27: 155 guarded, 13 allowlisted) |
| `no-dead-asset-references.mjs` | Live code referencing dropped tables (`.from('vehicle_image_tags')` → silent 404) or DEAD edge functions. ERROR = DB-confirmed ghost on a live path; WARNING = ledger-DEAD. `--no-db`, `--json`, `--strict`. | **6** ERRORs (2026-07-12: 50 ghost ERRORs found → 44 fixed [repointed/guarded/webhooks removed] → 6 remain, all guarded `vehicle_transactions`; ~184 ledger-DEAD WARNINGs) |

Exit convention: 0 = clean, 1 = violation, 2 = setup/usage error.

These counts are historical measurements. For the local ratchet's configured limits, read
`scripts/ci/baseline.json`; for current findings, run the relevant check in the checkout being
published. A bypass marker documented by a script does not grant authorization to bypass an
owner restriction.

## Where checks run

| Execution path | What runs | Boundary |
|---|---|---|
| `scripts/ci/verify.sh` | Frontend typecheck, raw-fetch regression tests, ghost/raw-fetch/testimony ratchets, secret scan, advisory schema-label scan; optional build | `CI_ENFORCE=1` blocks a failing local gate; default WARN mode reports and returns success |
| `.github/workflows/pre-deploy-check.yml` | Raw-fetch regression tests, frontend typecheck and build; lint reports without blocking | Pull requests and pushes to main; inspect actual check results |
| `.github/workflows/supabase-deploy.yml` | `check-write-guard.mjs` | Blocks edge-function deployment when a writing function lacks the required guard or explicit script allowlist |
| Local Git and agent-tool hooks | Whatever the active installation configures | Client/checkout-specific; inspect the installed configuration before claiming coverage |

The local ratchets permit existing findings up to the configured baseline. They do not prove
that all code satisfies the design requirements. The write-guard scanner checks source wiring;
runtime caller rejection is implemented by the guarded function and must be verified separately.

## Use the existing checks

From the checkout being published:

```bash
CI_ENFORCE=1 scripts/ci/verify.sh
node scripts/guardrails/check-capability-before-mint.mjs "<name-or-capability>"
```

The capability preflight consumes the existing inventory; verify the proposed owner against the
current atlas and writer before minting. `scripts/guardrails/pretooluse-mint-check.sh` is the
existing tool-hook implementation for this preflight, not proof that a client invokes it.

Inspect `core.hooksPath` and the hooks in `git rev-parse --git-common-dir` before relying on a Git
hook. Worktrees may share a hook that points at another checkout; run the gate directly in your
own checkout when needed. Inspect the active client configuration for tool hooks. Claude and
Codex hook coverage must be established separately.

Preserve existing checks, use the current owner-authorized scope for configuration changes, and record the actual
execution path and its limits. See `scripts/ci/README.md` for local gate behavior.
