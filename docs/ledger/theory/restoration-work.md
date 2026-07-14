# RESTORATION / WORK — theory card

**The model:** Work is not a form someone fills out — it is a projection of photo evidence. Owner photos land, `create-work-session-from-evidence` groups them into a `pending_analysis` timeline event (evidence-first, `needs_ai_analysis: true`, attribution-conflict flagged in metadata — never silently mis-filed), and AI/render-time analysis derives what the work *was*. The work story lives in the `work_sessions` production table (1,899 rows, written by auto-sort-photos cron + mcp-connector `confirm_work_session`), never in local .md files. Labels ("engine work", "paint") are query-time projections of stored evidence — never baked as schema categoricals.

**The invariant(s):**
- Evidence before labels: a work record exists only if photos/receipts back it; photo intent must be owner-confirmed before value accrues.
- Testimony is never deleted or overwritten — wrong attribution forks (ghost vehicle + relink), never hides. `create-work-session-from-evidence` flags cross-vehicle conflicts (`needs_review`) instead of blocking or deleting.
- Agent writes go through `ingest-observation` / mcp-connector — no raw INSERT into testimony tables.
- Every number/value carries source DNA `(source, method, observed_at, trust)`.

**Canonical entrypoints:**
- Work record ledger → `work_sessions` table; write via `create-work-session-from-evidence` (UI path) or mcp-connector `confirm_work_session` (agent path)
- Auto work-log from photos → `photo-pipeline-orchestrator` inline logic
- Parts catalog → `catalog_parts` table (10,853 rows — THE catalog; `parts_catalog` is a different grain, don't add parts there)
- Parts recommendations → `recommend-parts-for-vehicle`
- Wiring compute (BOM/cut-list/diagram/quote) → `nuke_frontend/src/components/wiring/harnessDerivation.ts` (client-side; what WiringPlan renders)
- Work-order statement UI → `WorkOrderStatement.tsx` (/work-orders/statement); intake UI → `RestorationIntake.tsx` (/restoration)
- K5 wiring state → `docs/wiring/K5_WIRING_STATE.md` + wiring rules in `.claude/rules/wiring-*` (pre-flight gate is mandatory)

**Do NOT:**
- Call the `work-session` edge function — canonical-sounding name, ZERO callers. It is a trap.
- Resurrect `generate-work-logs` (2,002 LOC, both callers repointed off 2026-07-06), the dead server wiring chain (generate-harness-spec/-wiring-bom/-wiring-quote, query-wiring-needs, compute-wiring-overlay), or deleted intake fns (work-intake-batch, sms-work-intake, telegram-restoration-bot, intelligent-work-detector).
- Write to the `work_orders` family (7 tables, 0 rows ever), `vehicle_jobs`, `wiring_*` tables (empty/seed-only), or reference ghost tables `work_session_photos` / `wiring_connections` — they DO NOT EXIST despite old maps.
- Mint a work-log format as local .md files — the ledger is the `work_sessions` table.
- Compute value or work-type from pixels alone; intent needs owner confirmation.

**Before you build here:** Read `docs/ledger/CAPABILITY_MAP.md` (RESTORATION / WORK section) before minting ANY function/table — the capability almost certainly exists dormant or has a named dead twin. For anything wiring: run the pre-flight gate in `.claude/rules/wiring-receipt.md` first (K5 work = one wire per turn, cited or marked unknown). For DB writes: `.claude/rules/agent-trust-invariants.md`.
