# Session Handoff — 2026-03-20 08:00 AM (Overnight Pipeline Agent)

## What Was Done

### Phase 0: Infrastructure Built
- **mine-comments-for-library.mjs** — Added `--provider ollama|gemini|anthropic` flag with Ollama HTTP calls, Gemini API calls, and auto concurrency (2 for Ollama, 5 for others). Tested: BMW M5 extracted 7 library entries via Ollama in 27s.
- **scripts/run-mine-library.sh** — Mining loop wrapper. Runs batches of 80 groups, stops after 5 consecutive zero-extraction runs.
- **scripts/promote-library-extractions.mjs** — Promotes staging table entries to canonical tables (vintage_rpo_codes, paint_codes, oem_trim_levels). Fixed column name mismatches (rpo_code not code, model_family not model, trim_name not name).
- **scripts/overnight-run.sh** — Master orchestrator with 4 streams + post-processing + morning report.
- **package.json** — Added 8 npm scripts (mine:ollama, mine:loop, promote:library, overnight, etc.)

### Library Promotion (existing data)
- Promoted 2,267 existing staging entries to canonical tables:
  - 342 new RPO codes → vintage_rpo_codes (was 419, now 761)
  - 98 new paint codes → paint_codes (was 3,361, now 3,459)
  - 159 new trim packages → oem_trim_levels (was 420, now 579)
  - 1,668 engine_specs/transmission_specs/production_facts/known_issues marked reviewed

### Phase 1: 4 Overnight Streams Running
| Stream | PID | Status | Notes |
|--------|-----|--------|-------|
| A: Snapshots (regex) | 15389 | RUNNING | Barrett-Jackson low yield (noSnap). Will move to Mecum/C&B. |
| B: Mining (Ollama) | 15436 | RUNNING | First batch of 80 groups in progress. ~30s/group, GPU shared. |
| C: Extraction (Ollama) | 15499 | RUNNING | 8 vehicles extracted so far. ~60-130s/vehicle. |
| D: Enrichment (DB) | 15546 | RUNNING | 15 rounds done. Fast (pure DB). |

### Gemini API Key EXPIRED
- `GOOGLE_AI_API_KEY` returns "API key expired. Please renew."
- Stream E (Gemini high-value extraction) was **skipped** entirely
- User should renew key at https://aistudio.google.com/apikey

### Other Cleanup
- Killed stale description discovery from 1:10 AM (PID 19553/19546) — was competing for GPU

## What Needs Attention

### After Streams Complete (check `ps aux | grep -E "mass-extract|run-mine|local-description|run-enrichment"`)
1. Run post-processing: `dotenvx run -- bash scripts/overnight-run.sh --post-only`
2. This runs bridge → validate → promote sequence
3. Check logs: `tail -20 logs/overnight-*.log`

### Morning Verification Commands
```bash
# Mining stats
dotenvx run -- node scripts/mine-comments-for-library.mjs --stats

# Promotion stats
dotenvx run -- node scripts/promote-library-extractions.mjs --stats

# Check for errors
grep -c "ERR\|FAIL\|error" logs/overnight-mining-2026-03-20.log
grep -c "ERR\|FAIL\|error" logs/overnight-extraction-2026-03-20.log

# DB stats
dotenvx run -- bash -c 'curl -s "$VITE_SUPABASE_URL/functions/v1/db-stats" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"' | jq
```

### Throughput Reality (Ollama shared GPU)
- With 2 streams sharing GPU: ~30 total Ollama calls/hour (not 60 each)
- Expected 8hr total: ~240 mining groups + ~240 vehicle extractions
- Snapshots and enrichment don't use GPU so they run independently

---
# Auto-Checkpoint — 2026-03-20 07:52:05
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:52:16
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:52:35
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:52:36
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:52:49
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:52:51
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:52:59
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:53:05
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:53:11
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:53:18
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:53:47
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:54:55
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
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
# Auto-Checkpoint — 2026-03-20 07:55:16
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
none

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
DONE.md
auction-readiness-strategy.md
package.json
scripts/iphoto-intake.mjs
scripts/mine-comments-for-library.mjs
supabase/functions/mcp-connector/index.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`
