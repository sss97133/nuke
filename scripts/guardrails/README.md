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
| `no-raw-testimony-insert.mjs --changes` | In the migrations a change **adds** (base: `HEAD^1` in Actions, the merge-base with `origin/main` locally; `--base`, `--files` for replays): any INSERT/UPDATE/DELETE/MERGE/TRUNCATE/COPY into a `db-safety.md` testimony table at top level, in a DO block, in a new or patched function body, unless the function is a sanctioned writer named in AGENTS.md "Row writes". Supersession-only UPDATEs pass. Exception: `-- guardrail-allow(testimony-write): <fn\|top\|do>: <reason>`. Runs in `verify.sh` (hard fail). | 2026-11-24 replay: #3707 caught (1, its fold's INSERT); 45 migrations dated 11-24: 0; 10 migrations in open PRs: 0 |
| `cron-notice-prefix.mjs` | In the migrations a change **adds**: a `cron.schedule` / `cron.alter_job` command of more than one statement that can raise a NOTICE before its last statement, by DDL with IF [NOT] EXISTS, ADD COLUMN IF NOT EXISTS or RAISE NOTICE/WARNING/INFO, in the command or in a public function it calls (3 levels, newest definition in `supabase/migrations`), and does not begin with `SET client_min_messages = error;`. With `cron.use_background_workers` off, such a notice stalls the pg_cron launcher until the job ends. Live counterparts: views `v_cron_notice_risk` and `v_cron_launcher_stalls`. Runs in `verify.sh` (advisory). | 2026-11-25 replay of 525 November migrations: 7 warnings in 5 files, all live jobs (694, 736, 741, and 753 three times); 0 false positives against `v_cron_notice_risk`. Incidents: job 526, 194-328 s each night at 04:25Z; job 646, 149-236 s at 09:22Z |
| `no-committed-secrets.sh` | Committed private keys, PEM blocks, service_role JWTs (decoded, not pattern-matched — anon keys pass), provider API keys, secret-named assignments. Default mode scans the git index (0.04s, pre-commit safe); `--tracked` = full audit. | **0** |
| `check-capability-before-mint.mjs` | Minting a function/table/page whose capability already has a canonical owner, or resurrecting a DEAD/RETIRED name. Per-name preflight: `check-capability-before-mint.mjs "<name>"` → exit 0 CLEAR / 1 STOP. `--json`, `--test` available. | n/a (preflight, not a sweeper) |
| `no-schema-baked-labels.mjs` | New migrations baking world-labels as CHECK enums / CREATE TYPE (doctrine: labels are projections of measurement). Advisory — always exits 0. Default scopes to staged migrations; `--all` = full audit. | **282** across 143 historical migrations (`--all`); staged mode currently clean |
| `check-write-guard.mjs` | An edge function that writes (table/storage/auth.admin/write RPC/raw SQL, or fan-out to a writer) without `requireWriteAuth` from `_shared/writeGuard.ts` and not on the script's allowlist. Runs in `supabase-deploy.yml` before deploy — a hit blocks the deploy. `--list` prints every function's classification. | **0** (2026-09-27: 155 guarded, 13 allowlisted) |
| `no-pii-exposure.mjs` | A migration (version ≥ its `FLOOR`) that opens a personal column (e-mail, phone, address, legal name, precise location, device identity; `PII_COLUMN`) to anon/authenticated/PUBLIC by a select grant, a permissive `USING (true)` policy, disabled RLS or an owner-run view, unless `pii-exposure-allowlist.json` names it with a reason. Tables' columns from `pii-columns.json` (`--refresh` from live). `--live` checks production the same way; `--live --content` samples free-form columns open to anon for e-mail addresses and phone numbers (counts only) and fails on any column `pii-freeform-columns.json` does not list. Static mode also treats the listed free-form columns as personal. Runs in `scripts/ci/verify.sh` (hard fail). | 2026-10-19: static **0**; live **5** before 20261020163000, all closed by it; 17 allowlisted. Content (SEC4): 17 free-form columns listed (1 closed, 2 redacted in readers, 14 public by nature) |
| `no-pii-exposure.mjs --counts` | Advisory: a SECURITY DEFINER function executable by anon (explicit grant, or no REVOKE from PUBLIC in the file) that counts over `data_set_members`, `data_set_public_counts` or `vehicle_code_readings` and never names a grade. `--counts --live` reads `has_function_privilege('anon', ...)` in production. Runs in `verify.sh` as a WARN line; never blocks. | 2026-11-24: live 0, added migrations 0. With `field_evidence` in the list it warned on 2 readers that count provenance rows, not memberships, so it is out |
| `no-new-photo-reader.mjs` | A change that adds a table keyed by a photo (`image_id`, `vehicle_image_id`, `photo_id`) in a new migration, or a new edge function or script whose name says it reads photos, and is not listed in `photo-stores.allow.json` with the owner's approval. Owner direction 2026-11-10: readings are keyed through the registry and `ingest-observation`; no reader gets its own table. Reads names and CREATE TABLE text only. Tried on the 40 newest commits on main (2026-11-10): fired on 3 (two new stage tables, two scripts of a new reading lane, and one heartbeat script that is now exempt). |
| `no-new-photo-reader.mjs` (keys) | Also in added migrations: an `observation_properties` row written with `ratified_at` when the same migration files no `schema_proposals` row (`ratified-vocabulary`), and a new table with a vehicle/image/receipt/receipt_item/observation id column and no foreign key on it, inline, table-level or by `ALTER TABLE ... ADD ... FOREIGN KEY` in the file (`center-key-fk`). Exception: `-- guardrail-allow(<rule>): <name>: <reason>`. Runs in `verify.sh` and `pre-deploy-check.yml` (hard fail). | 2026-11-24 replay: #3707 caught (1 vocabulary); 45 migrations dated 11-24: 0 vocabulary, 5 unkeyed `vehicle_id` (model fold queue/log tables, coverage sample); open PRs: 1 (`vehicle_tie_journal.vehicle_id`, #3687) |
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
| `.github/workflows/pre-deploy-check.yml` | Raw-fetch regression tests, `no-new-photo-reader.mjs` and its tests, frontend typecheck and build; lint reports without blocking | Pull requests and pushes to main; inspect actual check results |
| `.github/workflows/supabase-deploy.yml` | `check-write-guard.mjs` | Blocks edge-function deployment when a writing function lacks the required guard or explicit script allowlist |
| Local Git and agent-tool hooks | Whatever the active installation configures | Client/checkout-specific; inspect the installed configuration before claiming coverage |

The local ratchets permit existing findings up to the configured baseline. They do not prove
that all code satisfies the design requirements. The write-guard scanner checks source wiring;
runtime caller rejection is implemented by the guarded function and must be verified separately.

## The owner-voice test

`owner-voice-test.md` in this folder is the owner's test of the image analysis record (the direction at the top
of `docs/ledger/theory/data-machine.md`): a new agent with no memory gets the kind of message he would send, and
is graded on where it goes. It holds the messages, the grading, the results of each round and the script. It is
the answer key, so nothing in the record links to it and an agent under test must not open it.
`owner-voice-other-model.mjs` runs the same messages against a model from another provider (Grok, GPT) with a
read-only view of main; the answer key says how to run and grade it.

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

## Measured incidents the checks do not cover yet

- 2026-11-25, two green PRs broke main together. #3826 asserted `r.starts === 4` in
  `scripts/photo-pipeline/subscription-reader-batch.test.mjs`. #3827 added a fifth reader (`answer-receipt-parts`).
  Each PR passed against its own base. They merged at 04:02Z and 04:13Z, and main's Frontend Tests failed from run
  45545609310 (head 0dc598266) until #3835. No check here reads the combined tree before a merge. When two open PRs
  touch the same assertion or test file, use a merge queue, or rebase onto main and re-run CI before merging. The
  enforcing form is GitHub's merge queue, or branch protection's "require branches to be up to date", on `main`.
