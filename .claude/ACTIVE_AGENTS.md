# Active Claude Agents

**Last updated**: 2026-01-30 07:32

## Quick Check: Running Sessions
```bash
ps aux | grep "claude" | grep -v grep | awk '{print $2, $7, $10}'
```

## How to Use This File

1. **Check running sessions** with the command above
2. **Claim your work**: Add an entry below with what you're working on
3. **When done**: Remove or mark your entry as complete
4. **Conflict?**: If someone else is on the same file, pick different work

---

## Currently Active Agents (7 sessions running)

| TTY | PID | Status | Working On |
|-----|-----|--------|------------|
| s000 | 68738 | active | BaT queue processing & failure retry |
| s001 | 68890 | active | Comment sentiment backfill (~71k remaining) |
| s002 | 69152 | active | Multi-server inference + overnight batch |
| s005 | 69351 | ? | (unclaimed) |
| s006 | 69467 | active | Forum extraction overnight run (monitoring) |
| s017 | 69886 | ? | (unclaimed) |
| s018 | 69691 | active | Setup coordination system |

**Claim format**: Edit the "Working On" cell with your task

---

## Work Queues (coordinate here)

### High Priority (grab these)
- [ ] Forum extraction pipeline
- [ ] Comment sentiment backfill
- [ ] Image deduplication

### In Progress (claimed)
- None currently claimed

### Completed Today
- (agents add finished work here)

---

## File Locks

If editing these files, announce it here first:
- `database/migrations/*` - one agent at a time
- `supabase/functions/_shared/*` - coordinate changes
- `.env` files - never edit simultaneously

---

## Notes Between Agents

(Use this section to leave notes for other agents)


**[s000 @ 09:32]** Running CL Archive batch upload: 379/538 complete.
- Background process: PID 99654
- Log: ~/nuke/data/upload-progress.log
- Local DB: ~/nuke/data/archive-inventory.db

**[s006 @ 09:37]** Forum overnight run finishing (~30 mins left)
- Posts: 26k → 56,786 (+30k overnight)
- Threads completed: 969
- Background: PID 73175
- Log: ~/nuke/logs/overnight/forum-run-20260130-0002.log

**[s002 @ 09:41]** Built multi-server inference system
- Files: `lib/inference-client.js`, `config/inference-servers.json`, `scripts/inference-servers.js`
- Switched batch-structure-threads from OpenAI (quota hit) → local Ollama
- Ready for friend's GPU server - just `node scripts/inference-servers.js enable friend-gpu`
- Overnight batch running: PID 63236, ~340 vehicles created, 241 remaining

**[s000 @ 09:47]** BaT queue failure retry in progress
- Reset ~20k "Extraction failed" → pending for retry
- 8 workers processing: `ps aux | grep bat-continuous`
- Queue: 79.6k complete, 15k pending, 20k failed remaining
- Failed breakdown: VIN dupes (resales), null make (non-vehicles), transient errors

---

## FLIGHT CHECKPOINT @ 10:30

**All sessions pausing. Resume when landed:**

| Task | Status | Resume |
|------|--------|--------|
| BaT queue | 79.6k done, 15k pending, 20k failed | Queue in DB, workers restart |
| Sentiment backfill | s001 running, 71k remaining | Check progress |
| Forum extraction | ~56k posts, ~30 mins out | Check logs |
| Inference batch | 241 remaining | Check PID 63236 |
| CL Archive | 379/538 | Checkpoint in sqlite |

**DB at pause:** 175k vehicles, 72.6k BaT, 843 AI analyzed

