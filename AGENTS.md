# AGENTS.md — Nuke shared agent doctrine

One doctrine for **every** coding agent in this repo — Claude Code (imports this
via CLAUDE.md), Cursor, Codex, Gemini CLI, Windsurf. This file is a **doorman,
not a manual**: it holds only what's true in every room, then sends you to the
one that owns your task. Don't add knowledge here — add it to the subsystem it
belongs to.

> **Not Claude Code?** The rule files in `.claude/rules/` do NOT auto-load for
> you. When this file points at one, open it and read it by path.

## What this repo is

Nuke: vehicle-data platform (nuke.ag) — Supabase project `qkgaybvrernstplzjaam`
(edge functions + Postgres) + Vercel web frontend (`nuke_frontend/`) + a
TestFlight-live iOS app (`apps/nuke-capture-ios/`). The *live* platform is small
(~30 functions, ~20 hot tables, 18 crons) inside a much larger dead shell —
**before believing any function/table is alive or dead, read
`docs/ledger/README.md`** (capability map · canonical ledger · intent ledger).
Preflight any new name: `scripts/guardrails/check-capability-before-mint.mjs "<name>"`.

## Universal invariants (true in every room)

1. **FACTS ARE SACRED.** Core data — vehicles, money, observations — is never
   invented. Query the substrate; never guess a value. Every datum carries
   `(source, method, observed_at, trust)`. Write only through `ingest-observation`
   — never raw INSERT into testimony tables. Testimony is never deleted or
   overwritten — supersede or relink. → `.claude/rules/agent-trust-invariants.md`
2. **CREATIVITY IS BOUNDED.** Invent freely on form (design, prose, layout).
   Never on facts. If you can't cite it, mark it unknown — don't hallucinate it closed.
3. **DON'T MINT.** Before a new function / table / dir / doc, confirm none exists
   (`docs/ledger/CAPABILITY_MAP.md`). A new thing means retiring an old one.
4. **ACT.** Do the task. Ask only for: schema changes, deletes, sign-in/permission
   changes, ownership, or destructive ops.
5. **LIVENESS & INTENT.** Unwired ≠ dead (deletion is owner-only). Intent is
   captured at an explicit Sign, never inferred from a paste/debounce/ambient
   trigger. "Safe to delete" lists are hypotheses — re-verify against runtime.
   → `.claude/rules/liveness-and-intent.md`
6. **THE REPO IS NOT PROD.** Confirmed drift exists both ways (deployed
   functions with deleted source; repo code never deployed). Verify the
   load-bearing claim against the live system before acting.
   → `.claude/rules/production-engineering.md` (probe kit inside)

## Where you work decides what you read

| Working on…                          | Your room                                              |
|--------------------------------------|--------------------------------------------------------|
| Extraction, edge functions, the DB   | `supabase/functions/CLAUDE.md`                          |
| Frontend, UI, pages, design          | `nuke_frontend/CLAUDE.md`                               |
| K5 wiring / harness                  | `docs/wiring/` + `.claude/rules/wiring-*` (receipt-gated)|
| The iOS app                          | `apps/nuke-capture-ios/CLAUDE.md` — LIVE, not greenfield |
| "What's true about X?"               | Query the database — **not** the markdown               |
| "Where are we right now?"            | `DONE.md` (the one live ledger)                         |

## Coordination (you are likely one of several concurrent agents)

Full protocol: `.claude/rules/agent-coordination.md`. Minimum viable version:
- Register: `echo "$(date +%H:%M) | TASK | desc | areas" > .claude/agents/active/$PPID.md`
- On finish: `claude-log-done "area" "what you built"` · then `rm -f .claude/agents/active/$PPID.md`
- Never edit HANDOFF.md or DONE.md directly (lockf-wrapped helpers only).
- ONE agent owns the iOS worktree at a time. Migrations: one agent at a time.

## Deploy & hygiene

- Deploys belong to CI (`supabase-deploy.yml`) / Vercel-on-merge — never hand-applied.
- No new tables/scripts without justification; deleted features stay deleted
  (list in `.claude/rules/platform-hygiene.md`).
- Report coverage toward targets, never raw row counts.
