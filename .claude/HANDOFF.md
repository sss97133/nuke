# Session Handoff — 2026-03-21

## CURRENT SESSION: Unified Multi-LLM Integration

### What's happening
Building unified LLM router (`_shared/llmRouter.ts`) per approved plan at `.claude/plans/mossy-exploring-wall.md`.

### What's complete
- DeepSeek R1 32B + Qwen3 30B-A3B + Kimi K2.5 cloud downloaded to SSD
- `nuke` Ollama model (fat prompt) created and live
- `nuke-agent` fine-tuned model (market intelligence, loss 0.084) merged + GGUF exported + live on Ollama
- Phase 0.3 done (agent_tier, extraction_method, raw_source_ref on vehicle_observations)
- Phase 0.4 done (CHECK constraint fixed)
- Market intelligence training data exported (3,213 examples)
- Squarebody training data exported (3,788 examples)
- 3 PAPERS written (entity resolution, trust scoring, market intelligence patterns)
- ALMANAC platform metrics snapshot
- Engineering Manual Ch.9 (LLM infrastructure)

### What's in progress
- Building `_shared/llmRouter.ts` — unified provider router for all LLM calls
- Plan approved at `.claude/plans/mossy-exploring-wall.md` — 7 phases, 14 steps

### What's next (in order)
1. Finish `_shared/llmRouter.ts`
2. Make `agentTiers.ts` a backward-compat shim
3. Migration: agent_model + agent_cost_cents on vehicle_observations
4. `llm_cost_tracking` table
5. Update `ingest-observation` for provenance fields
6. Migrate edge functions one by one
7. `scripts/overnight-enrichment.mjs`

### Key files
- Plan: `.claude/plans/mossy-exploring-wall.md`
- Router: `supabase/functions/_shared/llmRouter.ts` (NEW)
- Existing: `supabase/functions/_shared/agentTiers.ts` (381 lines, keep as shim)
- Training: `yono/modal_nuke_agent_train.py`, `yono/export_*.py`
- Models: `/Volumes/NukePortable/ollama-models/` (nuke, nuke-agent, deepseek-r1, qwen3, kimi-k2.5)

---
# Auto-Checkpoint — 2026-03-21 09:02:35
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:06:30
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Session Handoff — 2026-03-21 09:10:44
*(Written explicitly by agent — high-quality context for next session)*

## What Was Happening
DESCRIPTION PIPELINE FIX — Layers 1-2 complete, Layers 3-5 remain.

COMPLETED THIS SESSION:
1. Built modal_description_discovery.py (standalone Modal batch extraction)
2. Fixed fetch for large batches (paginated REST + client-side dedup)
3. Ran 1K standalone batch (.70), discovered transformers.generate() is 10x too expensive
4. Launched JS + vLLM HTTP extraction (550 vehicles before vLLM died)
5. Built promote-discoveries-to-observations.mjs — digests JSON blobs into observations
6. Promoted 13,986 discoveries → 81,379 vehicle_observations + ~12K vehicles materialized
7. Added 4 library docs: GPU infrastructure ch.9, extraction quality study, GPU costs almanac, field note
8. P00: Fixed import_queue status CHECK constraint
9. P01: Backfilled 81,379 observations with audit trail (agent_tier, extraction_method, extracted_by)
10. TEMPORAL DECAY: Created 4 SQL functions (observation_relevance, observation_half_life_days, observation_effective_weight, observation_freshness) implementing the half-life paper
11. Created vehicle_current_state view — weighted composite from specification observations

STILL RUNNING:
- Nothing (vLLM server down, JS script died, standalone Modal job likely done)

NEXT STEPS (Layers 3-5 from plan):
1. Layer 3: Multi-model corroboration script (scripts/compute-description-corroboration.mjs)
   - 736 vehicles have 2+ model extractions, compute field-level agreement
   - Corroboration bonus: 1.0 + 0.15 * (agreeing_sources - 1), capped at 1.5x
   - Flag contradictions as separate observations

2. Layer 4: Fix promote script to use ingest-observation HTTP instead of direct SQL
   - Current version bypasses vehicle resolution, confidence scoring, analysis triggers
   - 10 concurrent HTTP calls, ~13 min for 81K observations

3. Layer 5: Library injection into extraction prompts
   - Build scripts/lib/build-extraction-context.mjs
   - Query comment_library_extractions + paint_codes + oem_trim_levels for context
   - Inject into DISCOVERY_PROMPT when available

4. Restart extraction: redeploy vLLM server, relaunch JS script for 220K remaining

KEY INSIGHT: 'Nuke Estimate' wording is wrong. The user says value is a topology (current state → maximum potential), not a single number. The term 'estimate' stranges the system's potential. Need better technical terminology — valuation envelope or value surface.

PLAN FILE: ~/.claude/plans/snazzy-squishing-coral.md has the full 6-layer plan.

## Branch
main

## Recent Commits (last 3h)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes (not yet committed)
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
yono/modal_nuke_agent_train.py

## Staged
none

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read above "What Was Happening" section
3. Check git log if more detail needed: `git log --oneline -10`
4. Register in .claude/ACTIVE_AGENTS.md before starting

---
# Auto-Checkpoint — 2026-03-21 09:10:56
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Session Handoff — 2026-03-21 09:13:51
*(Written explicitly by agent — high-quality context for next session)*

## What Was Happening
MCP onboarding + data rehabilitation session. COMPLETE: 5 MCP onboarding tools deployed (33 total), 11.6M comment-identity links, RPO library 23→174, feed polling configured, import queue crons created (14.4K/day), Engineering Manual Ch 9+10 (883 lines), almanac corrected, conceptcarz cleanup (262K tagged, 976 prices flagged). RUNNING: vision enrichment (1000 done, 4000 more in progress), import queue draining (8K remaining), 5 markdown bridges. NEXT: finish vision enrichment to 5K+, conceptcarz B3 cross-reference, B4 reclassify, deep inspection sample (A2), restart YONO sidecar for free condition analysis.

## Branch
main

## Recent Commits (last 3h)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes (not yet committed)
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
yono/modal_nuke_agent_train.py

## Staged
none

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read above "What Was Happening" section
3. Check git log if more detail needed: `git log --oneline -10`
4. Register in .claude/ACTIVE_AGENTS.md before starting

---
# Auto-Checkpoint — 2026-03-21 09:14:09
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:23:14
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:25:47
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:30:46
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
62512ec5e feat: unified LLM router + cost tracking infrastructure

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:33:04
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:39:10
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:55:19
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 09:57:16
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:10:30
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:15:25
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
f54391104 feat: multi-model corroboration + library-injected extraction prompts
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Session Handoff — 2026-03-21 10:20:18
*(Written explicitly by agent — high-quality context for next session)*

## What Was Happening
Comment system unification + refinery foundation. COMPLETED: (1) Unified comment schema — user_comments table consolidating 4 first-party tables, vehicle_comments_unified VIEW across auction_comments + user_comments + vehicle_observations with dedup, partial index for 12ms queries. (2) Frontend wired — VehicleProfileContext counts from VIEW, VehicleCommentsCard reads from VIEW (was 3 tables), realtime 3→2 subs, writes to user_comments. (3) bat_comments writes removed from extract-auction-comments. (4) Comment Refinery schema — comment_claims_progress table, data_source_trust_hierarchy entry (trust 45), compute_temporal_decay() function (paint 2yr, rust 5yr, specs no decay), analysis widget registered. NEXT: Task #6 Write _shared/commentRefinery.ts (prompt builder, claim parser, confidence computation, corroboration engine). Then Task #7 extend analyze-comments-fast with claim_triage mode (regex pre-filter, /bin/zsh cost). Then Task #8 extend batch-comment-discovery with extract_claims mode (LLM pipeline). Full plan at ~/.claude/plans/validated-singing-tome.md

## Branch
main

## Recent Commits (last 3h)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes (not yet committed)
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/styles/header-fix.css
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read above "What Was Happening" section
3. Check git log if more detail needed: `git log --oneline -10`
4. Register in .claude/ACTIVE_AGENTS.md before starting

---
# Auto-Checkpoint — 2026-03-21 10:20:50
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:20:54
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:23:57
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Session Handoff — 2026-03-21 10:27:01
*(Written explicitly by agent — high-quality context for next session)*

## What Was Happening
Massive session: MCP onboarding (5 tools), 11.6M comment-identity links, live data loop (feeds+crons+gmail), library chapters 9+10, data rehabilitation (conceptcarz cleanup, vision enrichment, image junk filter). RUNNING: vision enrichment (1000 done, 4000 more grinding), import queue draining (8K→processing at 14.4K/day), 5 markdown bridges. OPEN PROBLEMS: (1) entity resolution needs image similarity — 7 duplicate Koenigsegg Regeras can't be resolved without pHash or VIN, (2) 294K inactive vehicles need audit (283K conceptcarz cleaned but not cross-referenced yet), (3) YONO sidecar offline (neither local nor Modal), (4) 16K vehicles still need descriptions after current 5K batch finishes. NEXT SESSION: restart YONO sidecar, build pHash image dedup for entity resolution, finish vision enrichment to 16K, conceptcarz B3 cross-reference.

## Branch
main

## Recent Commits (last 3h)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes (not yet committed)
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/styles/header-fix.css
supabase/functions/extract-auction-comments/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read above "What Was Happening" section
3. Check git log if more detail needed: `git log --oneline -10`
4. Register in .claude/ACTIVE_AGENTS.md before starting

---
# Auto-Checkpoint — 2026-03-21 10:27:35
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:32:07
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:39:17
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:40:14
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:49:10
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:52:56
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 10:53:21
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:09:03
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
4aa797fcc fix: auctions page — always load recently ended, log errors

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:09:17
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
4aa797fcc fix: auctions page — always load recently ended, log errors

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:12:15
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c6ee4e2f7 docs: update DONE.md with browser inspection findings
4aa797fcc fix: auctions page — always load recently ended, log errors

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:14:01
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c6ee4e2f7 docs: update DONE.md with browser inspection findings
4aa797fcc fix: auctions page — always load recently ended, log errors

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Session Handoff — 2026-03-21 11:18:32
*(Written explicitly by agent — high-quality context for next session)*

## What Was Happening
Comment Refinery pipeline fully built and deployed. COMPLETED: (1) _shared/commentRefinery.ts — claim density scoring (25 regex patterns), prompt builder, response parser with quote verification, temporal decay, corroboration engine. (2) comment_claims_progress table + trust hierarchy entry + compute_temporal_decay() function + analysis widget. (3) analyze-comments-fast claim_triage mode — tested on 57 comments, 4 passed filter (7% rate), correctly identifies substantive claims. (4) batch-comment-discovery extract_claims mode — Gemini 2.5 Flash primary, Haiku fallback, batches 10 comments/call, writes to field_evidence, self-chains. BLOCKED: Both Anthropic credits and Google AI quota exhausted. Pipeline code is production-ready, needs credits to run. NEXT STEPS: (1) Top up Anthropic credits or Google AI quota. (2) Run extract_claims on the 4 pending high-density comments for test vehicle 4ecc1fa5. (3) Verify field_evidence rows created with correct confidence scores and quotes. (4) Scale: run claim_triage on top 500 vehicles (continue=true), then extract_claims. (5) Build corroboration sweep and gap detection widget. Plan at ~/.claude/plans/validated-singing-tome.md

## Branch
main

## Recent Commits (last 3h)
fcb2de3eb feat: v3 testimony-grade extraction prompt + testimony fields documentation
c6ee4e2f7 docs: update DONE.md with browser inspection findings
4aa797fcc fix: auctions page — always load recently ended, log errors
c2b1cb7c7 fix: filter junk images (dealer logos, favicons, tracking pixels)
f54391104 feat: multi-model corroboration + library-injected extraction prompts
9ad485974 feat: wire llmRouter into pipeline — migrate core edge functions
62512ec5e feat: unified LLM router + cost tracking infrastructure
ae07d3815 fix: OPEN PROFILE button always renders in expanded cards
fc35ce729 feat: vision enrichment for 16K URL-less vehicles + conceptcarz cleanup

## Uncommitted Changes (not yet committed)
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx
nuke_frontend/src/pages/Search.tsx
nuke_frontend/src/pages/vehicle-profile/VehicleProfileContext.tsx
nuke_frontend/src/pages/vehicle-profile/WorkspaceContent.tsx
nuke_frontend/src/styles/header-fix.css
supabase/functions/analyze-comments-fast/index.ts
supabase/functions/batch-comment-discovery/index.ts
supabase/functions/extract-auction-comments/index.ts
supabase/functions/universal-search/index.ts
yono/modal_nuke_agent_train.py

## Staged
none

## Pickup Instructions
1. Read PROJECT_STATE.md for sprint context
2. Read above "What Was Happening" section
3. Check git log if more detail needed: `git log --oneline -10`
4. Register in .claude/ACTIVE_AGENTS.md before starting

---
# Auto-Checkpoint — 2026-03-21 11:18:50
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
fcb2de3eb feat: v3 testimony-grade extraction prompt + testimony fields documentation
c6ee4e2f7 docs: update DONE.md with browser inspection findings
4aa797fcc fix: auctions page — always load recently ended, log errors

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:25:28
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
fcb2de3eb feat: v3 testimony-grade extraction prompt + testimony fields documentation
c6ee4e2f7 docs: update DONE.md with browser inspection findings
4aa797fcc fix: auctions page — always load recently ended, log errors

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:34:25
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
fcb2de3eb feat: v3 testimony-grade extraction prompt + testimony fields documentation
c6ee4e2f7 docs: update DONE.md with browser inspection findings

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:35:51
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
2d1d80eb0 docs(library): dynamic trust model — trust earned through track record
fcb2de3eb feat: v3 testimony-grade extraction prompt + testimony fields documentation
c6ee4e2f7 docs: update DONE.md with browser inspection findings

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:40:42
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
2d1d80eb0 docs(library): dynamic trust model — trust earned through track record
fcb2de3eb feat: v3 testimony-grade extraction prompt + testimony fields documentation
c6ee4e2f7 docs: update DONE.md with browser inspection findings

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:42:06
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c13e5feba feat: overnight enrichment script — tested, 43/50 vehicles enriched at $0
2d1d80eb0 docs(library): dynamic trust model — trust earned through track record
fcb2de3eb feat: v3 testimony-grade extraction prompt + testimony fields documentation

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:55:15
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
c13e5feba feat: overnight enrichment script — tested, 43/50 vehicles enriched at $0
2d1d80eb0 docs(library): dynamic trust model — trust earned through track record

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 11:56:36
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
90d5c7f9c docs: PAPER — Enrichment Rules (ground truth for making data better)
c13e5feba feat: overnight enrichment script — tested, 43/50 vehicles enriched at $0
2d1d80eb0 docs(library): dynamic trust model — trust earned through track record

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-21 12:00:28
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
90d5c7f9c docs: PAPER — Enrichment Rules (ground truth for making data better)
c13e5feba feat: overnight enrichment script — tested, 43/50 vehicles enriched at $0
2d1d80eb0 docs(library): dynamic trust model — trust earned through track record

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
nuke_frontend/src/components/layout/AppHeader.css
nuke_frontend/src/components/layout/AppHeader.tsx
nuke_frontend/src/components/layout/AppLayout.tsx
nuke_frontend/src/components/layout/AppLayoutContext.tsx
nuke_frontend/src/components/layout/UserDropdown.tsx
nuke_frontend/src/components/layout/VehicleTabBar.css
nuke_frontend/src/components/layout/hooks/useHeaderVariant.ts
nuke_frontend/src/components/layout/variants/CommandLineLayout.tsx
nuke_frontend/src/components/layout/variants/MinimalLayout.tsx
nuke_frontend/src/components/layout/variants/SegmentedLayout.tsx
nuke_frontend/src/components/layout/variants/TwoRowLayout.tsx
nuke_frontend/src/components/search/IntelligentSearch.tsx
nuke_frontend/src/components/search/SearchResults.tsx
nuke_frontend/src/components/settings/AppearanceSpecimen.tsx
nuke_frontend/src/components/vehicle/VehicleCommentsCard.tsx
nuke_frontend/src/feed/components/FeedPage.tsx
nuke_frontend/src/pages/HomePage.tsx

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`
