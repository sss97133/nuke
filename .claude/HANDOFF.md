# Session Handoff — 2026-03-21

## COMPLETED THIS SESSION

### Phase A: Overnight DB Maintenance (12am-8am)
- VACUUMed 11 tables (17.8% → <0.2% dead tuples)
- Dropped 607 unused indexes (2548 → 1942)
- Fixed cron 413 (matview timeout → new index, now <7s)
- Reset 28K failed extractions to pending
- Released 597 stale processing locks
- Mined 41 RPO codes, promoted 272 library entries
- Created `validate_vin_check_digit()` function, extracted 48 VINs
- Committed and pushed all overnight work

### Phase B: Universal AI Extraction Pipeline (8am-present)
**Root cause identified:** Platform extractors (BJ, Mecum, Bonhams) hunt for JS-rendered JSON that doesn't exist in static archived HTML. BJ=0.0 avg fields, Mecum=0.5, Bonhams=0.1. Only C&B (10.1) and BaT (3.8) work because they parse semantic HTML.

**Built:**
1. `scripts/snapshot-to-markdown.mjs` — Converts 391K archived HTML snapshots from Supabase Storage to clean markdown. Preserves headings, dt/dd pairs, lists, tables, JSON-LD, __NEXT_DATA__, RSC data. 100% success rate on BJ.
2. `supabase/functions/batch-extract-snapshots/index.ts` — Added `parseWithAI()` using Haiku via `agentTiers.ts`. Falls back to AI when regex returns 0 fields. Deployed.
3. `scripts/ai-extract-from-snapshots.mjs` — Local Haiku-powered extraction that bypasses edge function queue issues. Queries snapshots with markdown directly.
4. **DB migration**: `ai_extraction_passes` table, evidence columns on `vehicle_field_evidence`, `vin_match_candidates` view
5. **Identity check**: Auto-merge threshold already at 100 (VIN exact only). YMM-only tiers are review-only. No changes needed.

**Proven:** BJ extraction went from 0.0 → 3.0 avg fields/vehicle. 9/25 vehicles extracted, 27 fields filled, $0.0009 cost.

## STILL RUNNING

| Process | PID | What |
|---------|-----|------|
| BJ markdown bridge | 38624 | Converting 40K BJ snapshots to markdown (~1500 done) |
| Mecum markdown bridge | 48592 | Converting 80K Mecum snapshots to markdown (just started) |
| BJ AI extraction | 48466 | Extracting from markdown-ready BJ snapshots (5K max, $5 cap) |

Check: `ps aux | grep -E "ai-extract|snapshot-to-markdown" | grep -v grep`

## NEXT STEPS

1. **Wait for markdown bridges to complete** (~2-4 hours at 50/batch)
2. **Launch AI extraction for Mecum** once markdown is available:
   ```bash
   dotenvx run -- node scripts/ai-extract-from-snapshots.mjs --platform mecum --batch 20 --max 10000 --parallel 3
   ```
3. **Launch AI extraction for Bonhams:**
   ```bash
   dotenvx run -- node scripts/snapshot-to-markdown.mjs --platform bonhams --batch 50 --max 20000
   dotenvx run -- node scripts/ai-extract-from-snapshots.mjs --platform bonhams --batch 20 --max 5000 --parallel 3
   ```
4. **Build evidence reconciliation script** (`scripts/reconcile-evidence.mjs`) — Phase 3 of the plan
5. **Monitor costs** — check `logs/ai-extract-bj-*.log` for cost tracking

## KEY METRICS

| Metric | Before | After |
|--------|--------|-------|
| BJ avg fields/extraction | 0.0 | 3.0 |
| Dead tuple peak | 17.8% | <0.2% |
| Unused indexes | 1,731 | 1,123 |
| Failed extractions | 26,868 | 1 |
| RPO codes | 802 | 901 |
| VIN cross-match pairs | N/A | 5 (new view) |
| Snapshots with markdown | 0 | ~1,500+ (growing) |

## FILES CREATED/MODIFIED

- `scripts/snapshot-to-markdown.mjs` (NEW) — HTML→markdown bridge
- `scripts/ai-extract-from-snapshots.mjs` (NEW) — Local AI extraction
- `supabase/functions/batch-extract-snapshots/index.ts` (MODIFIED) — AI fallback + markdown support
- `scripts/mass-extract-snapshots.mjs` (MODIFIED) — --mode ai flag
- Migration: `ai_extraction_passes_and_evidence` — extraction tracking table + VIN view

---
# Auto-Checkpoint — 2026-03-20 09:30:06
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
0e05b4f78 feat: AI extraction pipeline working — BJ 0.0 → 3.0 avg fields
aca87271c feat: Modal description discovery — Qwen2.5-7B batch extraction on T4
7fcafd742 feat: local LLM infrastructure — Modelfiles, Modal fine-tuning pipeline, training data exporter
c983a2d92 feat: universal AI extraction pipeline + snapshot-to-markdown bridge

## Uncommitted Changes
.claude/HANDOFF.md
scripts/local-description-discovery.mjs
scripts/mine-comments-for-library.mjs
supabase/functions/mcp-connector/index.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 09:30:20
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
0e05b4f78 feat: AI extraction pipeline working — BJ 0.0 → 3.0 avg fields
aca87271c feat: Modal description discovery — Qwen2.5-7B batch extraction on T4
7fcafd742 feat: local LLM infrastructure — Modelfiles, Modal fine-tuning pipeline, training data exporter
c983a2d92 feat: universal AI extraction pipeline + snapshot-to-markdown bridge

## Uncommitted Changes
.claude/HANDOFF.md
scripts/local-description-discovery.mjs
scripts/mine-comments-for-library.mjs
supabase/functions/mcp-connector/index.ts
yono/modal_description_discovery.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 09:36:12
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
0e05b4f78 feat: AI extraction pipeline working — BJ 0.0 → 3.0 avg fields
aca87271c feat: Modal description discovery — Qwen2.5-7B batch extraction on T4
7fcafd742 feat: local LLM infrastructure — Modelfiles, Modal fine-tuning pipeline, training data exporter
c983a2d92 feat: universal AI extraction pipeline + snapshot-to-markdown bridge

## Uncommitted Changes
.claude/HANDOFF.md
scripts/local-description-discovery.mjs
scripts/mine-comments-for-library.mjs
supabase/functions/mcp-connector/index.ts
yono/modal_description_discovery.py

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 09:46:49
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
091cad206 fix: modal_description_discovery fetch + scale tuning
0e05b4f78 feat: AI extraction pipeline working — BJ 0.0 → 3.0 avg fields
aca87271c feat: Modal description discovery — Qwen2.5-7B batch extraction on T4
7fcafd742 feat: local LLM infrastructure — Modelfiles, Modal fine-tuning pipeline, training data exporter

## Uncommitted Changes
.claude/HANDOFF.md
scripts/local-description-discovery.mjs
scripts/mine-comments-for-library.mjs
supabase/functions/mcp-connector/index.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 11:09:51
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 12:27:57
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 15:07:13
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 15:07:40
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 15:18:09
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 15:18:33
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:06:37
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md
supabase/functions/mcp-connector/index.ts
supabase/functions/nuke-data-bot/index.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:07:04
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md
supabase/functions/mcp-connector/index.ts
supabase/functions/nuke-data-bot/index.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:10:15
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
e22702a7d fix: MCP connector — add decode_vin, fix browse_inventory make filter

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:13:31
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
e22702a7d fix: MCP connector — add decode_vin, fix browse_inventory make filter

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:22:14
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
e22702a7d fix: MCP connector — add decode_vin, fix browse_inventory make filter

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:23:33
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
e22702a7d fix: MCP connector — add decode_vin, fix browse_inventory make filter

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:33:34
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
e22702a7d fix: MCP connector — add decode_vin, fix browse_inventory make filter

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-20 16:35:03
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
e22702a7d fix: MCP connector — add decode_vin, fix browse_inventory make filter

## Uncommitted Changes
.claude/HANDOFF.md
DONE.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`
