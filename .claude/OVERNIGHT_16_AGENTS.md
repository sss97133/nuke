# Overnight 16-Agent Work Plan — 2026-03-08

**IMPORTANT: Every agent must read CLAUDE.md Hard Rules before starting. Especially rules #8 (batched writes), #11-14 (DDL safety, statement timeout, lock checks).**

Register yourself in ACTIVE_AGENTS.md. Remove yourself when done. Append to DONE.md.

---

## Agent 1: Make Case Normalization
**Scope:** Fix 1,230 phantom makes from case inconsistency (6,737 → ~5,500 distinct makes)
**Files:** SQL migrations only
**Instructions:**
1. Read `.claude/reports/data-quality-forensics.md` section 2
2. Build canonical make mapping (e.g., "desoto" → "DeSoto", "alfa romeo" → "Alfa Romeo")
3. Use standard automotive title case: "Mercedes-Benz", "Rolls-Royce", "Alfa Romeo", "De Tomaso"
4. Batch UPDATE in 500-row chunks with `pg_sleep(0.2)` — check locks after each batch
5. Start with the top 100 makes by vehicle count (covers 96.7% of vehicles)
6. Do NOT touch model field this session — just make

---

## Agent 2: Garbage Make Cleanup
**Scope:** Fix 6,124 vehicles with garbage makes (numbers, punctuation, memorabilia)
**Files:** SQL migrations only
**Instructions:**
1. Read `.claude/reports/data-quality-forensics.md` section on garbage makes
2. Vehicles with make starting with numbers/symbols that are actually memorabilia/signs → set `status='inactive'` and `canonical_vehicle_type='OTHER'`
3. Vehicles with make like "FordChassis#:" → fix to "Ford"
4. Vehicles with make = auction house name (Rm, Bonhams, etc.) — 8,553 already deleted per DONE.md, verify no new ones
5. Batch all writes, check locks

---

## Agent 3: Empty Tables Cleanup (Group 1 — Financial/Investment)
**Scope:** Drop 85 empty financial/investment tables
**Files:** SQL migration
**Instructions:**
1. Read `.claude/reports/empty-tables-audit.md` section 1 (Financial/Investment)
2. Check `pg_stat_activity` before any DDL
3. Drop tables in groups of 10-15 per migration
4. After each group: `NOTIFY pgrst, 'reload schema';`
5. Also remove any frontend imports/types referencing these tables
6. Check `nuke_frontend/src/` for imports of deleted table types

---

## Agent 4: Empty Tables Cleanup (Group 2 — Shop/Workforce/Auction/Bidding)
**Scope:** Drop 57 empty tables (Shop 34 + Auction/Bidding 23)
**Files:** SQL migration + frontend cleanup
**Instructions:**
1. Read `.claude/reports/empty-tables-audit.md` sections for Shop/Workforce and Auction/Bidding
2. Same safety protocol as Agent 3
3. Remove frontend references to dropped tables
4. Do NOT drop tables that Agent 3 is dropping

---

## Agent 5: Empty Tables Cleanup (Group 3 — Remaining categories)
**Scope:** Drop remaining ~180 empty tables (Streaming, Insurance, Property, Tool Mgmt, etc.)
**Files:** SQL migration + frontend cleanup
**Instructions:**
1. Read `.claude/reports/empty-tables-audit.md` for all remaining categories
2. Skip the 17 tables marked "keep" and 13 marked "needs investigation"
3. Same safety protocol as Agents 3-4
4. Coordinate: don't overlap with Agents 3 or 4

---

## Agent 6: Edge Function Consolidation Audit
**Scope:** Identify which of the ~440 edge functions can be merged, deleted, or archived
**Files:** Read-only audit + report. NO deletions this session.
**Instructions:**
1. Read `TOOLS.md` for the canonical function registry
2. List all deployed functions: `supabase functions list`
3. For each function, check: (a) is it in TOOLS.md? (b) does it have a cron? (c) when was it last invoked? (check logs)
4. Categorize: KEEP / MERGE_INTO_X / DELETE / NEEDS_REVIEW
5. Write report to `.claude/reports/edge-function-consolidation.md`
6. Target: identify path from 440 → 50 functions
7. Do NOT delete anything — just report

---

## Agent 7: Frontend Dead Feature Cleanup
**Scope:** Remove frontend code for deleted features (betting, trading, vault, concierge, investor portal, shipping)
**Files:** `nuke_frontend/src/` only
**Instructions:**
1. Read MEMORY.md for deleted features list
2. Search for and remove: imports, routes, components, pages, services for deleted features
3. Already stubbed this session: TradePanel, OrganizationInvestmentCard, InvestorDealPortal
4. Find ALL remaining broken imports (run `npx vite build` to find them)
5. Remove dead components entirely (not stubs) where possible
6. Run `npx vite build` after each batch of removals to verify
7. Deploy with `npx vercel --prod` when clean

---

## Agent 8: Design System Compliance Sweep
**Scope:** Fix remaining 185 inline style violations across the frontend
**Files:** `nuke_frontend/src/` components and pages
**Instructions:**
1. Read `src/styles/unified-design-system.css` for the canonical system
2. Search for: `borderRadius` (should be 0), `boxShadow` (should be none), `linear-gradient` (forbidden), hardcoded hex colors, wrong transitions
3. Correct transition: `180ms cubic-bezier(0.16, 1, 0.3, 1)`
4. Replace hex colors with CSS variables (--text, --accent, --border, --surface, --surface-hover, --text-secondary, --success, --error, --warning)
5. Work file-by-file, verify build compiles after each file
6. Deploy when done

---

## Agent 9: Duplicate Vehicle Archival (Phase 1 — Analysis)
**Scope:** Analyze the 499K duplicate vehicles and prepare archival strategy
**Files:** Read-only analysis + report
**Instructions:**
1. Read `.claude/reports/data-quality-forensics.md` section on duplicates
2. Analyze: how many distinct URL clusters? What's the merge strategy?
3. For each cluster: identify the "best" record (most images, most complete data)
4. Write SQL for archival: `UPDATE vehicles SET status='duplicate' WHERE ...`
5. Write report to `.claude/reports/duplicate-archival-plan.md`
6. Do NOT execute any writes — just plan
7. Include estimated impact on search performance, DB size, and vehicle counts

---

## Agent 10: Price Data Validation & Repair
**Scope:** Fix 12,887 valuations off by >200% and remaining price anomalies
**Files:** SQL migrations
**Instructions:**
1. Read `.claude/reports/data-quality-forensics.md` price sections
2. ConceptCarz cleanup was done (DONE.md 2026-03-04) — verify it held
3. Find remaining price outliers: $20M Bentley Arnage type errors
4. Historical-to-current dollar confusion: identify and flag
5. Batch all fixes, check locks
6. Update `price_confidence` column where appropriate

---

## Agent 11: SDK Publish Preparation
**Scope:** Final review and preparation of @nuke1/sdk for npm publish
**Files:** `nuke_frontend/src/` SDK-related, `package.json`
**Instructions:**
1. Find the SDK source directory
2. Review README, types, exports
3. Verify all vision types match actual API responses
4. Run any existing tests
5. Check package.json for correct version, description, keywords
6. Do NOT `npm publish` — prepare everything and document what's needed in `.claude/reports/sdk-publish-checklist.md`

---

## Agent 12: Search RPC Performance Optimization
**Scope:** Make search RPCs faster — they're hitting 15s timeouts
**Files:** SQL migrations
**Instructions:**
1. Run `EXPLAIN ANALYZE` on `search_vehicles_smart('mustang')`, `search_autocomplete('por')`, `search_vehicles_browse()`
2. Identify missing indexes or bad query plans
3. The `lower(make)` pattern needs a functional index if not covered by today's partial index
4. Consider: should RPCs use `make ILIKE` instead of `lower(make) =`?
5. Fix the `search_autocomplete` vehicle results returning NULL labels (year/make/model are NULL for some vehicles — add NOT NULL filters)
6. Batch all index creation, check locks before DDL

---

## Agent 13: Import Queue Drain & Health
**Scope:** Process stuck import queue items and fix queue health
**Files:** Edge functions, SQL
**Instructions:**
1. Check import_queue status: `SELECT status, count(*) FROM import_queue GROUP BY status`
2. Release stale locks: `SELECT * FROM release_stale_locks(dry_run:=true)`
3. Check agent hierarchy health: router, haiku worker, sonnet supervisor crons
4. Fix any broken cron jobs
5. Process a sample of pending items manually to verify pipeline works
6. Write health report to `.claude/reports/queue-health.md`

---

## Agent 14: Snapshot Migration Monitoring & Optimization
**Scope:** Check and optimize the 79 GB snapshot-to-storage migration
**Files:** `supabase/functions/migrate-snapshots-to-storage/`
**Instructions:**
1. Check migration progress: how many rows moved? How many remaining?
2. Check the cron job is healthy and running
3. Optimize if needed: increase batch size if DB load is low
4. Verify `archiveFetch.ts` reads from Storage correctly for migrated rows
5. Estimate completion date
6. Write status report to `.claude/reports/snapshot-migration-status.md`

---

## Agent 15: Vehicle Image Pipeline Health
**Scope:** Audit image pipeline health and fix issues
**Files:** Edge functions, SQL
**Instructions:**
1. Check `vehicle_images` stats: `SELECT ai_processing_status, count(*) FROM vehicle_images GROUP BY 1`
2. Check optimization pipeline: `SELECT optimization_status, count(*) FROM vehicle_images GROUP BY 1`
3. Find and release stale image processing locks
4. Check `primary_image_url` coverage — how many vehicles should have images but don't?
5. Fix the trigger that sets `primary_image_url` if it's not firing
6. Write report to `.claude/reports/image-pipeline-health.md`

---

## Agent 16: Data Quality Score Recalibration
**Scope:** Fix the meaningless `data_quality_score` (100% score 90+ despite 56% missing images)
**Files:** Edge function `calculate-profile-completeness`, SQL
**Instructions:**
1. Read the current scoring function
2. The score should penalize: missing images, missing VIN, missing price, missing description
3. A vehicle with only year/make/model should score ~30, not 90+
4. Redesign the scoring weights:
   - Year+Make+Model: 20 points
   - VIN: 15 points
   - Images (1+): 20 points
   - Price: 15 points
   - Description: 10 points
   - Mileage: 5 points
   - Transmission/Engine: 5 points
   - Color: 5 points
   - Source URL: 5 points
5. Deploy updated function
6. Do NOT batch-recalculate all vehicles tonight — just deploy the new logic for new vehicles
7. Create a report with before/after distribution estimates

---

## Coordination Rules

1. **Only one agent touches SQL migrations at a time.** Agents 1, 2, 3, 4, 5, 10, 12 must check `pg_stat_activity` before DDL.
2. **Only one agent deploys to Vercel at a time.** Agents 7, 8 coordinate — Agent 7 deploys first, Agent 8 deploys after.
3. **All agents follow CLAUDE.md Hard Rules** — especially batched writes and lock checks.
4. **Register in ACTIVE_AGENTS.md** with your task number and timestamp.
5. **Append to DONE.md** when complete.
6. **If you break PostgREST:** `NOTIFY pgrst, 'reload schema';`
