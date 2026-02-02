# 10-Hour Autonomous Loop

**Purpose:** Run extraction + monitoring + quality in a structured loop; you watch and give occasional input.  
**Based on:** Yesterday’s productivity (Feb 1–2) + EXTRACTION_SOURCES_INVENTORY + RUN_MAJOR_EXTRACTION.

---

## Yesterday’s productivity (reference)

### Our session (Feb 1–2)
- **Migrations:** api_keys, value_trends, vault_privacy, webhooks (all 20260201).
- **Tools:** nuke-sdk (production-ready), nuke-scanner (README + validation), nuke-desktop.
- **Extraction:** Facebook 1991 config + monitor filter; RUN_MAJOR_EXTRACTION.md + run-major-extraction.sh.
- **Theme:** Removed OrganizationProfile force-light; theme-inspection rule + agent + inspect-theme.sh.
- **Agentic:** agentic-continuous.mdc; Cursor CLI ref; full disk + Claude logs access.

### Agent log (Feb 1 evening)
- **Fixes:** 1,161 data corruption + 265 inconsistencies; BaT comment pollution fix deployed; Mecum regex fix.
- **New:** Collecting Cars Typesense API (305 queued, 20 processed); Craigslist extractor deployed.
- **Queue:** BaT ~77k, Craigslist ~539, Classic.com ~10 via process-import-queue.
- **Blockers:** OpenAI quota, Firecrawl credits. **Strategy:** Native/API extractors first.

---

## 10-hour loop (draft – hit the points with you)

Total: **10 hours**. Phases have **checkpoints** where I report and you can give input (pause, change batch size, add task, stop).

| Phase | Name              | Duration | What happens | Checkpoint (your input) |
|-------|-------------------|----------|--------------|--------------------------|
| 0     | **Kickoff**       | ~15 min  | Env check, queue counts, list running extractors. | Go / no-go; batch size? |
| 1     | **Extraction run**| 4–5 hr   | Run process-import-queue in batches (run-major-extraction.sh or extract-loop). Pause between batches. | Every ~1 hr: progress + errors; pause? adjust? |
| 2     | **Monitor + triage** | ~1 hr | Check queue drain, terminal processes (profile repair, C&B backfill), error spikes. | Add focus? (e.g. “prioritize CL”) |
| 3     | **Quality pass**  | ~1 hr    | Sample new vehicles; run inspect-theme.sh if we touched frontend; optional scrape-quality spot check. | Fix anything? |
| 4     | **Report + next** | ~30 min  | Summary: processed, errors, remaining queue. Update AGENT_PRODUCTIVITY_LOG or a session note. Propose next run. | Extend loop? Stop? Schedule next? |
| 5     | **Buffer / repeat** | remainder | Optional: repeat Phase 1 (smaller batches) or run Facebook monitor 1 cycle; or idle until next checkpoint. | Your call. |

**Your occasional input:** At each checkpoint I’ll post a short status and ask: continue / pause / change X / stop. You only need to respond when you want to change something.

**How I “run” it:** You keep this chat (or a dedicated “loop” chat) open. At the start I run Phase 0 and ask for go. Then I run Phase 1 in chunks (e.g. trigger run-major-extraction.sh with N rounds, wait, then report at checkpoint). Same for 2–4. I don’t run 10 hours of commands in one shot; I run in **blocks** and **report at checkpoints** so you can steer.

---

## Phase detail (to refine together)

### Phase 0 – Kickoff (~15 min)
- [ ] Confirm `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (e.g. from nuke `.env` / `.env.local`).
- [ ] Query or note: `import_queue` pending count (BaT, CL, Classic.com if visible).
- [ ] List running processes: autonomous-profile-repair, backfill-cab-vins, extract-loop, bat-process-queue, marketplace monitor.
- [ ] **Checkpoint:** “Queue is X. Running: Y. Proceed with Phase 1? Batch size 20, 50 rounds per block, or different?”

### Phase 1 – Extraction run (4–5 hr in blocks)
- [ ] Run `./scripts/run-major-extraction.sh` (or custom: `BATCH=20 MAX_BATCHES=50 PAUSE_SEC=15`) **in blocks** (e.g. 50 rounds = one block).
- [ ] After each block (or every ~1 hr): report processed count, any spike in errors, remaining pending.
- [ ] **Checkpoints:** “Block N done. ~X processed, Y errors. Continue same / smaller batches / pause?”

### Phase 2 – Monitor + triage (~1 hr)
- [ ] Re-check `import_queue` status (pending per source if possible).
- [ ] Check terminals: profile repair, C&B backfill — still running? Any failures?
- [ ] Optional: trigger one Facebook monitor cycle (`cd scripts/marketplace-monitor && npx tsx monitor.ts` once) if you want 1991 listings.
- [ ] **Checkpoint:** “Queue now X. Processes: … . Add a task or move to Phase 3?”

### Phase 3 – Quality pass (~1 hr)
- [ ] Sample: e.g. 5–10 recently created/updated vehicles (by created_at or updated_at) and spot-check fields.
- [ ] If we changed frontend this loop: run `./scripts/inspect-theme.sh` and fix any new violations.
- [ ] Optional: open scrape-quality report or run one BaT listing through extract and confirm.
- [ ] **Checkpoint:** “Quality: … . Fixes applied: … . Proceed to Phase 4?”

### Phase 4 – Report + next (~30 min)
- [ ] Write short summary: vehicles processed this loop, errors, queue left, running agents.
- [ ] Append to AGENT_PRODUCTIVITY_LOG or create `reports/loop-YYYY-MM-DD.md`.
- [ ] Propose: “Next: another 10hr loop / run extract-loop overnight / focus on CL only / …”
- [ ] **Checkpoint:** “Summary above. Extend, stop, or schedule next?”

### Phase 5 – Buffer / repeat
- [ ] Use remaining time for: more extraction blocks (smaller batches), one Facebook monitor run, or idle until you say “next checkpoint.”

---

## What we need to align (your input)

1. **Batch size and rounds per block:** Default 20 × 50 rounds per block; okay or prefer 10 × 100, 30 × 30?
2. **Checkpoint interval:** Every 1 hr, or every N blocks (e.g. every 2 blocks)?
3. **Facebook monitor:** Include one cycle in Phase 2 or skip?
4. **Quality:** Just vehicle sample + theme, or also scrape-quality / BaT spot-check?
5. **Where to log:** AGENT_PRODUCTIVITY_LOG only, or also `reports/loop-2026-02-02.md` (or similar)?
6. **Stop conditions:** You say “stop,” or auto-pause if error rate > X%, or queue empty?

---

## How to run it “all day”

- **You:** Open this plan; start the loop (e.g. “run Phase 0” or “start the 10hr loop”).
- **Me:** Execute Phase 0, then ask for go. Then run Phase 1 in blocks, report at checkpoints, and ask for input.
- **You:** Reply only when you want to change something (pause, smaller batch, add task, stop).
- **Me:** Continue through Phase 2 → 3 → 4 → 5, same pattern: do work, report, ask at checkpoints.
- **Result:** By end of 10 hr you have a clear report and optional next steps; you’ve only had to chime in when you cared.

---

*Edit this file with your choices (batch size, checkpoints, stop conditions), then say “start the loop” or “run Phase 0.”*
