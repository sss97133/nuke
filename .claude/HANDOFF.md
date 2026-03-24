# HANDOFF — Foundation Sprint: Library + Extraction at Scale
**2026-03-23 ~12:45 PM**

## RUNNING RIGHT NOW (nohup, survives session close)

| PID | Command | Rate | Quality |
|-----|---------|------|---------|
| 61351 | `extract:desc:xai` (grok-3-mini, v3) | ~765/hr | 106 avg fields, cited |
| 61362 | `extract:desc:ollama` (qwen2.5:7b, v3) | ~28/hr | 89 avg fields, cited, $0 |

Logs: `/tmp/grok-v3-stream.log`, `/tmp/ollama-v3-stream.log`

Restart: `npm run extract:desc:xai` or `npm run extract:desc:ollama`

Background restart:
```bash
nohup dotenvx run -- node scripts/local-description-discovery.mjs --provider xai --model grok-3-mini --batch 20 --parallel 10 --max 50000 --continue --v3 > /tmp/grok-v3-stream.log 2>&1 &
nohup dotenvx run -- node scripts/local-description-discovery.mjs --provider ollama --batch 20 --parallel 2 --max 50000 --continue --v3 > /tmp/ollama-v3-stream.log 2>&1 &
```

## CRONS (always running, don't touch)
- BaT queue: every 5 min, batch_size=5 (~60/hr) — was 1/10min
- 13 snapshot parsers: all platforms every 5 min
- ARS trigger: auto-queues on description_discoveries INSERT

## BACKLOGS

| Queue | Count | Rate | ETA |
|-------|-------|------|-----|
| Descriptions | 242,942 | ~800/hr | ~13 days |
| BaT queue | 162,469 | ~60/hr | ~113 days |
| ARS recompute | 6,364 | auto (analysis-engine cron) | auto |

## WHAT THIS SESSION BUILT

1. **Library promoted** — 2,614 entries (RPO 901→1,531, paint 3,497→3,840, trim 594→652). Fixed numeric overflow.
2. **xAI/Grok provider** added to local-description-discovery.mjs
3. **v3 testimony prompt** enabled on both streams — every claim has quote + confidence
4. **JSON repair** for truncated v3 output (4096 token limit, bracket closing). 0% parse fail.
5. **BaT queue 10x** — batch_size 1→5, cron 10→5 min, function deployed
6. **ARS trigger** — `trg_ars_on_description_discovery` migration applied, verified working
7. **Scheduled scripts** — `mine-and-promote.sh`, `batch-extract-loop.sh`
8. **npm scripts** — `extract:desc:xai`, `extract:desc:ollama`, `ops:mine`, `ops:extract-snapshots`, `library:promote`, `library:mine:gemini`

## SESSION PRODUCTION
- 1,433 description discoveries (1,313 Grok + 120 Ollama)
- 6,364 ARS recompute entries auto-queued via trigger
- 2,614 library extractions promoted

## API KEYS
- `XAI_API_KEY` — fresh this session
- `GROQ_API_KEY` — NOT SET (free 14,400 RPD if added)
- `GEMINI_API_KEY` — EXPIRED (needs rotation)

## KEY FILES CHANGED
- `scripts/local-description-discovery.mjs` — xAI provider, v3 tokens, JSON repair
- `scripts/promote-library-extractions.mjs` — numeric overflow fix
- `supabase/functions/process-bat-extraction-queue/index.ts` — batch_size (NOTE: user reverted to 1, re-check)
- `scripts/scheduled/mine-and-promote.sh` — NEW
- `scripts/scheduled/batch-extract-loop.sh` — NEW
- DB migration: `trigger_ars_on_description_discovery`

---
# Auto-Checkpoint — 2026-03-23 22:41:56
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-23 22:42:22
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:42:37
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:42:38
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:42:51
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:43:12
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:43:49
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:49:28
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:54:49
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 22:58:20
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
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
# Auto-Checkpoint — 2026-03-23 23:01:08
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
455ea62ec fix: extraction prompt — reference library is decoder ring, not shopping list
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-23 23:02:04
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
455ea62ec fix: extraction prompt — reference library is decoder ring, not shopping list
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-23 23:06:48
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
455ea62ec fix: extraction prompt — reference library is decoder ring, not shopping list
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
supabase/functions/_shared/llmRouter.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-23 23:07:21
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
455ea62ec fix: extraction prompt — reference library is decoder ring, not shopping list
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
supabase/functions/_shared/llmRouter.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`

---
# Auto-Checkpoint — 2026-03-23 23:08:04
*(Written automatically by Stop hook. For richer context, agents should call `claude-handoff` explicitly.)*

## Recent Commits (last 30 min)
455ea62ec fix: extraction prompt — reference library is decoder ring, not shopping list
cdd775e32 fix: badge popup stuck + header layout broken by global !important

## Uncommitted Changes
.claude/ACTIVE_AGENTS.md
.claude/HANDOFF.md
supabase/functions/_shared/llmRouter.ts

## Staged
none

## On Next Session
1. `cat PROJECT_STATE.md` — sprint focus
2. `tail -40 DONE.md` — what exists
3. `cat .claude/HANDOFF.md` — this file (pick up where left off)
4. Register in `.claude/ACTIVE_AGENTS.md`
