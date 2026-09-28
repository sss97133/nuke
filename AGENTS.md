# AGENTS.md — how to work in this repo

Rules for every coding agent here. Claude Code loads this file through `CLAUDE.md`; Cursor, Codex and
other tools read it directly. It holds what is true everywhere and points to the rest.

## What this is
Nuke (nuke.ag) is a vehicle data ledger: every vehicle and every observation about it, each with its
source. The stack:
- Supabase project `qkgaybvrernstplzjaam`: Postgres, plus edge functions in `supabase/functions/`.
- Web frontend in `nuke_frontend/` (Vite), deployed by Vercel.
- iOS app in `apps/`.

Nuke is pre-launch, and production is the test environment.

Before you decide any function or table is alive or dead, read `docs/ledger/README.md`. Before you make
a new function, table or folder, check `docs/ledger/CAPABILITY_MAP.md`
(`node scripts/guardrails/check-capability-before-mint.mjs "<name>"`) and extend what already exists.

## Invariants
1. **Facts are never invented.** Every datum carries its source, method, observed_at and trust.
   "Unknown" is an answer; a guess is not.
2. **Testimony is never overwritten or deleted.** It is superseded, and the original is kept.
3. **The repo is not prod.** Verify a claim against the live system before acting on it. The probe kit is in
   `.claude/rules/production-engineering.md`.
4. **This repo is public.**
   - Secrets never enter it.
   - Private data (people's contact details, invoices, amounts) doesn't either. It lives in the database,
     and code and docs refer to it by id.
   - `VITE_*` values ship to browsers, so no secret gets that prefix. `npm run build` fails if one does.

## Writes and deploys
- **Schema, cron and SQL functions.** Write a migration file, make one commit, and push it yourself.
  - Before pushing, check that `gh run list --workflow supabase-deploy.yml` is idle, and tell the other
    sessions "pushing <sha>, <file>".
  - One migration per commit per push: CI applies only the last commit's new files.
  - Set `statement_timeout` and `lock_timeout` in any migration that can wait on a lock (the pooler
    default is 10 s).
  - Verify it live after the run.
- **Edge functions.** Same path; CI deploys the function folders the commit changed. A function that
  writes calls `requireWriteAuth` (`supabase/functions/_shared/writeGuard.ts`), and
  `scripts/guardrails/check-write-guard.mjs` fails the deploy otherwise.
- **Row writes.** Only through the sanctioned writers: `ingest-observation`,
  `correct_vehicle_sale_provenance_batch`, and the supersession functions.
  - No raw INSERT, UPDATE or DELETE on testimony tables.
  - No `DISABLE TRIGGER`.
  - No `statement_timeout = 0`.
- **Reads.** Use `scripts/data/q.sh "SELECT …"`.
- **Frontend.** Open a PR to `main`. Vercel deploys on merge, which takes 8–10 min. Check the live page
  afterwards.
- **Never** hand-apply a migration or function deploy, and never change compute, plan or disk.

## Working alongside other agents
- Work in your own worktree:
  `git worktree add ~/.worktrees/<task> -b <branch> origin/main`.
- When several sessions run, one lane list says who owns what. Tell the others before you push.
- Read a file before changing it, and keep changes surgical. A fix is a few lines, not a rewrite.

## Rules by area
`.claude/rules/` holds rules that Claude Code loads when you touch their folders. Other tools should
open them by path:
- `frontend.md` for `nuke_frontend/src`.
- `db-safety.md`, `edge-functions.md` and `extraction.md` for `supabase/`.
- `library.md` and `supply-side.md`.
- `wiring-receipt.md` and `wiring-wire-closure-protocol.md` for `docs/wiring/`.
- `production-engineering.md`, which applies everywhere.
