# PROMPT — Prove, Repair, and Grow Nuke's Image-Analysis Ecosystem

**To:** the executing engineer agent
**From:** the recon lead / lead architect
**Working dir:** `/Users/skylar/nuke` — always `cd` here first; use absolute paths everywhere.
**Mandate:** This ecosystem EXISTS and partially WORKS. You are not building a new one. You are (1) **proving** what is actually true with live metrics instead of vibes, (2) **repairing and finishing the named imperative code already in tow** — every defect below is a real bug, an orphaned writer, a drained cron, or a half-wired loop, never a missing greenfield system — (3) **converging four schema generations and four "analyzed" namespaces onto one canonical model**, and (4) once stable, turning analysis coverage into something a visitor and the owner can literally **watch fill in over time.** Every island you are tempted to greenfield already has a half-built ancestor in this repo. **Finish the ancestor.** The seven half-finished pipeline generations sitting in the DB are the warning of what happens when you don't.

Your job spans all four registers — **technical** (the bug, the indexes, the writer wiring), **programmatic** (the scheduled self-advancing harness), **intellectual** (the canonical adjudications), and **knowledge** (the coverage layer, the theory-growth loop, the authored docs). Lead with reliability and observability; you cannot grow what you cannot measure, and you cannot fix what you cannot see.

---

## 0. READ THIS FIRST — doctrine and contracts you must obey

Read these before touching anything, in this order. They are load-bearing here, not decoration.

**Memory / doctrine (the HOW):**
1. `~/.claude/projects/-Users-skylar/memory/feedback_image_work_read_concept_first.md` — the cascade doctrine you are reconciling with reality (it claims the pipeline is live; recon proves it is orphaned).
2. `~/.claude/projects/-Users-skylar/memory/feedback_dont_mint_new_structures_use_the_repo.md` + `feedback_develop_from_what_exists.md` — the cure for sprawl is **subtractive**: improve in place, pull islands in, conform, delete.
3. `~/.claude/projects/-Users-skylar/memory/feedback_photo_intent_must_be_confirmed_not_assumed.md` — the **$410 rule**: value accrues ONLY from owner-confirmed labor; `intent_confidence<0.6` ⇒ `needs_clarification`.
4. `~/.claude/projects/-Users-skylar/memory/feedback_numbers_carry_source_dna.md` — every value is `(amount, source, method, observed_at, trust)`; never write a bare number.
5. `~/.claude/projects/-Users-skylar/memory/feedback_everything_is_an_entity_with_service_provenance.md` — technicians/equipment/vendors are org-entities with observed service profiles, not hardcoded registries.

**Verdict / schema contracts (the WHAT):**
- `scripts/daily-receipt/byok-vision-prompt.md`, `scripts/schemas/byok-image-verdict.schema.json`, `scripts/daily-receipt/day-synthesis.schema.json` — the per-image and per-day verdict contracts. Rich and correct. The DEPTH spec lives here.

**Coordination ritual (do this first, before any edits):**
```bash
cd /Users/skylar/nuke
[ -f .claude/HANDOFF.md ] && cat .claude/HANDOFF.md
cat PROJECT_STATE.md; tail -60 DONE.md; cat .claude/agents/active/*.md 2>/dev/null
echo "$(date +%H:%M) | IMAGE-ECOSYSTEM | prove+repair+converge+grow image analysis | scripts/daily-receipt, deep-image-analysis-byok.mjs, attribute-registry.ts, vehicle-profile/*" > .claude/agents/active/$PPID.md
```
Deregister (`rm -f .claude/agents/active/$PPID.md`) and `claude-log-done "image-ecosystem" "..."` when done. Call `claude-handoff` with exactly-what's-next before any context-pressure freeze.

---

## 1. GROUND TRUTH — internalize this; verify magnitudes before destructive acts, but do not re-derive the map

All of the following was proven by direct DB queries, `launchctl`, `grep`, and live HTTP probes on **2026-06-16**. Trust the shape; re-confirm the exact count with an indexed query before reaping/deleting/archiving anything; never full-scan the 38.9M-row table on the pooler.

**The corpus is NOT "75,000 images."** `vehicle_images` is **38.95M rows across 914,209 vehicles**; **87.6% is scraped BaT auction images** (`bat_import`=34.1M). **Skylar's real photos are ~25,597 by `user_id` / 30,575 by `documented_by_user_id`, all `is_external=false`.** (The rumored 75K is the un-ingested iCloud library, not the DB.) **Every coverage metric is scoped to the personal corpus, never the 38.95M.** `ai_processing_status='completed'` is NOT a proxy for deep analysis (the K5 has 2,678 "completed" but only 16 `image_observations` rows and 2,935 deep verdicts — the columns disagree).

**Analysis IS happening — 12,570 `image_deep_byok` verdicts over 12,496 distinct images, real volume — but it is structurally crippled by these wounds:**

- **W1 — The autonomous deep loop is pinned to ONE drained vehicle.** `~/Library/LaunchAgents/com.nuke.byok-image-analysis.plist` hardcodes the 1977 K5 Blazer `e08bf694-970f-4cbe-8a74-8715158a0f2e` + batch 15. That vehicle is drained; the cron has fired hundreds of empty `"no pending days — drained"` cycles (exit 3) since the last real work at 2026-06-16 12:57. **The rest of the fleet is never touched autonomously.** Fleet coverage only ever happened via `scripts/daily-receipt/byok-burn-all.sh`, a **manual `nohup` script that died mid-fleet at vehicle `07124fb6` on 2026-06-14 14:27 and never resumed** (~37 of 45 vehicles unreached). The moment a human stops babysitting, deep analysis stops. **This is the single biggest reliability failure point.**

- **W2 — The production deep writer BYPASSES the search/convergence engine.** `scripts/deep-image-analysis-byok.mjs` ingest (lines ~280–377) writes `vehicle_images.ai_scan_metadata.byok_deep_analysis` + a `vehicle_observations` row (`kind='condition'`, `structured_data.analysis_kind='image_deep_byok'`) — but **never writes `image_observations`**, the table its own sibling `process-photo-cascade.mjs` (lines ~232–235) calls *"the engine that powers visual search + convergence."* Result: 12,496 images have deep verdicts, only **2,224 are in `image_observations` (8.7% of the personal corpus)**, and only 639/3,384 rows carry a CLIP embedding. Visual search is dark.

- **W3 — Every batch runs context-starved (one-line bug).** `scripts/deep-image-analysis-byok.mjs` `buildContext()` (lines ~455–456) references an **undefined `KEY`** (only `SERVICE_KEY` is defined at line ~55) in the dossier-fetch Authorization header → throws `ReferenceError` every call → silently caught → **always falls back to thin DB-only context.** The "know the whole build before you analyze" detective enrichment — the entire point of the persona — has been dead in every verdict produced to date.

- **W4 — The flagship cascade writer is orphaned.** `scripts/daily-receipt/process-photo-cascade.mjs` — the doctrine's "butterfly node → ~20 atoms" 6-arm writer — has **zero callers** (grep across `*.sh/*.mjs/*.plist/*.json` finds only a pointer comment in `process-photo.mjs`). It wrote **3 rows ever.** Target tables exist (`technicians`=12, `technician_work_evidence`=23, `equipment`=5, `equipment_usage_evidence`=**0**, `consumables`=**0**; migrations `20260523080100/080200`). The migration README states the tables *"do not populate themselves… the cascade-aware writer (still to build)"* — except it WAS built, then never wired in. This is the single highest-value dead component.

- **W5 — Observability is broken by table bloat.** `vehicle_images` reltuples ≈ 38.9M (36GB, ~85K dead tuples so the count is real scraped volume, not bloat to vacuum away); bare `count(*)` and any aggregate on `ai_processing_status` or the `byok_deep_analysis` JSONB key **times out at 90–120s on the pooler.** Queue depth is unobservable via direct SQL. Per-`vehicle_id` (indexed) queries are fine. **1,253,837 images are stuck in `'processing'`** (100% >7d old, 98% >30d, nothing new since 2026-06-02) from a dead scrape-side analyzer — they corrupt every status-based metric and never resolve. `idx_vehicle_images_pipeline_stuck` already exists to find them.

**Four more truths you must hold:**

- **Four disagreeing "analyzed" markers.** `byok_deep_analysis` (batch path), the orchestrator's `ai_scan_metadata` Gemini writes (daily-inflow path), `ai_scan_metadata->appraiser->primary_label` (what `ralph-wiggum-rlm-extraction-coordinator/index.ts:149-159` *measures* — a number **no current writer produces**, so its brief lies about coverage), and the retired `image_analysis_records`. Progress is unmeasurable until one is crowned.

- **Two mutually-blind gate columns.** The edge per-image trigger fires `WHEN ai_processing_status='pending'`; the BYOK batch's `prepare()` (line ~135) selects `WHEN vision_gate_status='approved' AND missing byok_deep_analysis`. Neither path can see the other's progress. And only **11,866 of Skylar's 30,575** images are `approved`; **18,709 are NULL/pending/review_needed and structurally invisible to deep analysis** until something approves the gate. No autonomous approver runs at volume.

- **Inflow outpaces the deep engine ~3:1 and the deep work was a one-time blitz.** ~310 personal photos/day (4,763 in 7d) vs ~107/day steady deep throughput. The 12,570 verdicts were a **backfill blitz — `observed_7d=0` means ZERO of the last week's NEW photos were freshly deep-analyzed.** The backlog re-grows daily.

- **The daily-inflow deep route is DOWN.** `supabase/functions/photo-pipeline-orchestrator/index.ts` classifies new photos with **Gemini 2.5 Flash** (shallow, works) and routes the deep tier (line ~742) to `yono-analyze` → Modal Florence-2 sidecar, whose `/health` **returns HTTP 404** (`{YONO_SIDECAR_URL}/health`; default `http://127.0.0.1:8472`, .env override `https://sss97133--yono-serve-fastapi-app.modal.run`). New photos get shallow classification and nothing deeper.

---

## 2. THE PRODUCT YOU ARE BUILDING TOWARD — TIERS, then VISUAL GROWTH

This is the "why." Everything in §3–§8 exists to earn this.

### A. Analysis has explicit, named TIERS — visible depths a photo climbs

A photo is NOT "analyzed / not analyzed." It climbs a ladder. **This ladder is the canonical image-depth model — crown it, demote every competitor (see §4), and never invent a fifth.** It is simultaneously the product's spine AND the countable metric ladder that proves the system works:

- **Tier 0 — GATED.** `vehicle_images.vision_gate_status='approved'` (migration `20260503210000`): this photo belongs to this vehicle and is worth deep work.
- **Tier 1 — SEEN.** A deep BYOK verdict exists (`ai_scan_metadata.byok_deep_analysis` + a `vehicle_observations` row with `analysis_kind='image_deep_byok'`): scene_type, build_phase, components_seen with bboxes, camera_pose, damage_localized, state_observations.
- **Tier 2 — PLACED.** The photo is in the search/convergence engine: an `image_observations` row with role/bbox/visual_signature and a CLIP embedding — findable by visual similarity, clusterable into bursts.
- **Tier 3 — CONNECTED.** The photo's cascade fired: it contributed atoms to `technician_work_evidence` / `equipment_usage_evidence` / `consumables` / `parts_observed` — it is part of a day's work story.
- **Tier 4 — CONFIRMED.** The day it belongs to was owner-confirmed (`work_sessions.owner_confirmed_at`): labor and value are no longer agent-guessed, they are testimony. (Today **0/599** work_sessions are confirmed — the value gate has never fired.)

The full butterfly cascade these tiers express:
```
PHOTO ──┬─► ARM1  vehicle_images promoted columns (zone, camera_pose, components[bbox], damage_flags, condition_score)
        ├─► ARM2  vehicle_observation atom (kind, source DNA, supersession)          ← the one arm that fires today
        ├─► ARM2b image_observations engine row (role, bbox, visual_signature, CLIP) ← Tier 2; DARK (8.7%)  [W2]
        ├─► ARM3  technician_work_evidence (who did the labor — org-entity)           ← 23 rows
        ├─► ARM4  equipment_usage_evidence (tool depreciation)                        ← 0 rows, DEAD
        ├─► ARM5  consumables decrement (paint/abrasives/fluids)                      ← 0 rows, DEAD
        └─► ARM6  parts_observed → parts_catalog (per-SKU)                            ← dead-ends in JSONB
```
Plus the **micro-atom lane with no home** (the largest open lane): persons-visible→`contacts`, substances-visible, PPE, weather/season, vendor sale-evidence — captured in `ai_scan_metadata.byok_deep_analysis` JSONB today but never cascaded into queryable rows.

Introduce a single per-image **`analysis_depth_score` (0–1)** derived from the verdict — fields-filled/possible, bbox coverage, `intent_confidence`, `context_complete`, not-`stale`, **plus cascade-arms-fired/6.** No single "how-analyzed-is-this-image" number exists today; this is what makes the backlog **rank-orderable** and what feeds the timeline illumination. Persist it (promoted column or stable JSONB key) and expose it through the coverage RPC.

### B. GROWTH BECOMES VISUAL — the timeline illuminating as depth propagates

Once the ladder is real and countable per-photo and per-day, the vehicle profile's timeline (`BarcodeTimeline.tsx`, already a GitHub-style green heatmap) **darkens and illuminates as analysis depth propagates.** A day with raw photos but no verdicts is dim. As Tier 1 verdicts land it warms; as Tier 2 embeddings and Tier 3 cascade atoms land it saturates; an owner-confirmed Tier 4 day glows brightest. As the fleet coordinator drains overnight, the owner **watches depth fill in over time** and a visitor sees a vehicle whose record is visibly alive — motion, not a static gallery. **This is the payoff that closes the mandate.**

---

## 3. RECONCILE THE TWO FLOWS — ONE ENGINE, TWO FEEDERS

You must reconcile a **years-long backlog** against **daily new inflow** as two distinct flows driven by **one deep engine** — the doctrine-sanctioned BYOK `claude --print` Opus-4.8 path (`byok-image-batch.sh` → `deep-image-analysis-byok.mjs` → `build-day.mjs`, plus W2/W4's `image_observations` + cascade). Do not build two systems. The engine has two feeders:

- **BACKLOG feeder:** the §6 fleet coordinator (scheduled), draining oldest-un-analyzed approved days across the whole personal corpus, plus a `prepare --rehash` pass for the **1,956 `stale=true`** images that currently have no scheduled drainer.
- **INFLOW feeder:** the existing `trigger_photo_pipeline_on_image_insert` + cron `photo-pipeline-drain`, with the orchestrator's dead deep route (W's `yono-analyze` 404) **repointed to enqueue new photos into the same deep flow** instead of the dead sidecar. (Option b is strongly preferred over restoring Modal — it unifies inflow and backlog onto one engine and lets you retire the sidecar.)

**Priority rule the coordinator MUST implement:** new inflow (anything `observed` within the last 7d) is processed **ahead of** backfill — because today `observed_7d=0` proves inflow is starving. *Never let today's photos wait behind 2024's.* Document this as the canonical flow in `docs/library/technical/design-book/18-deep-image-analysis.md` (the doc that already carries the `kind=analysis` migration-desync note at line ~212) so the next agent doesn't re-fork.

---

## 4. CANONICAL ADJUDICATIONS — crown one, demote the rest (do not add a fork)

You are converging drift on four axes. Make each decision explicit in **code AND in `docs/library/.../18-deep-image-analysis.md`** — every time you find two of something, crown one and demote the other in both places.

1. **ONE canonical "is this image deep-analyzed" marker.** An image is deep-analyzed **iff** it has a `vehicle_observations` row with `analysis_kind='image_deep_byok'` **AND** an `image_observations` row (the W2 fix makes both fire). Retire `appraiser->primary_label` as a coverage signal; repoint the `ralph-wiggum` coordinator brief at the canonical marker. Land the long-missing `kind='analysis'` observation enum (migration desync, `18-deep-image-analysis.md:212`) OR formally document that byok rides on `kind='condition' + analysis_kind`. One or the other — kill the ambiguity.

2. **ONE canonical image tier/confidence model.** The **Tier 0→4 ladder** (§2.A), derived from the BYOK per-image verdict (`scripts/schemas/byok-image-verdict.schema.json`, validated by `validateVerdict()` at `deep-image-analysis-byok.mjs:75-112`), is canonical. **Explicitly DEMOTE** `Decode/Observe/Deliberate/Sign` (`nuke_frontend/src/services/channelAdapters.ts:111`) to its real scope — *listing-field justification, NOT image depth* — the single most common conflation; add a "these are different axes" note where it's defined and in the design-book doc. **ARCHIVE as deprecated:** the retired `image_analysis_records` (223 rows) + `component_identifications` (17), and legacy `analysis_queue` (112,320 tier1-3/expert rows, pre-BYOK, no drainer). **Leave orthogonal, just name them:** Worth-Engine two-axis (existence×magnitude, `20260523081300`) is vehicle-VALUE confidence; `Level 1-5 Sparse→Bedrock` (`11-intelligence-surface.md`) is vehicle-level density. Neither is per-image depth.

3. **ONE per-image `analysis_depth_score` (0–1)** — defined in §2.A. Persist and expose it.

4. **ONE canonical write path for `vehicle_zone`/`condition_score`.** Today 380,936 zoned + 279,231 scored rows came from an earlier unidentified pipeline, while the BYOK writer lands the same semantics inside `byok_deep_analysis` JSONB — same fact, two shapes, by writer. **Pick one:** promote zone/condition out of the JSONB in `deep-image-analysis-byok.mjs`, OR stop writing the column. Document it. Likewise consolidate the **5+ competing `observed_by` writers** in `image_observations` (orchestrator-v1, gopro-backfill, vision-gate, caller-byok, caller-byok-cascade) onto the single cascade writer going forward.

Fix the **intent-gate leak** while adjudicating tiers: live rows exist with `intent_confidence=0.5` and `needs_clarification=false` (violates the $410 rule; threshold 0.6 at `deep-image-analysis-byok.mjs:72`). Re-run `validateVerdict` at ingest; backfill the ~38% (385/1000 sampled) null-intent observations; wire the ask-the-technician clarification queue.

---

## 5–10. SEQUENCED EXECUTION — order is load-bearing; each phase ends with a demonstrable checkpoint

Do not start Phase N+1 until Phase N's checkpoint is demonstrated. **Read the actual file/schema/log state before editing — line numbers here are from recon and may have drifted.** Report progress as **metrics that moved**, not row counts or narration ("numbers are not the work").

### PHASE 1 — PROVE THE TRUTH & STOP THE BLEEDING (first win, same session, < 2 hours)

The fastest path to a demonstrable first win: one honest coverage number, the silent bug fixed, the parked driver un-parked.

- **1.1 — Build the ONE coverage layer (the scoreboard everything else moves).** Create migration `supabase/migrations/<ts>_image_analysis_coverage_rpc.sql` with **per-vehicle, indexed** functions (NEVER whole-table — counts time out at 90s):
  - `get_vehicle_analysis_coverage(p_vehicle_id uuid)` → `{ photos, gated_t0, seen_t1, placed_t2, with_clip, connected_t3, confirmed_t4, cascade_atoms, depth_score_avg, pct_deep, pct_engine }`. **Numerator = distinct images with an `image_deep_byok` verdict AND an `image_observations` row** (the canonical marker). Every count carries source DNA (which table/marker it came from).
  - `get_day_analysis_coverage(p_vehicle_id uuid, p_date date)` → same shape, day-grained (feeds the §8 timeline).
  - `mv_image_coverage_by_vehicle` materialized view (or trigger-maintained counter table), cron-refreshed, for the **only safe fleet-wide rollup** without a whole-table scan.
  - Add the missing **partial indexes** so these run in-timeout: on `(vehicle_id) WHERE source='user_upload' AND vision_gate_status='approved'`, and expression/GIN support for the `byok_deep_analysis` key existence per vehicle. **Keep every index partial on the owner subset so it never touches the 34M BaT mass.** Verify each query returns in < 2s before proceeding.
  - **Repoint the coordinator brief** (`ralph-wiggum-rlm-extraction-coordinator/index.ts:149-159`) off the dead `appraiser->primary_label` namespace and onto this RPC.
- **1.2 — Fix the silent context bug (W3).** `scripts/deep-image-analysis-byok.mjs` `buildContext()` lines ~455–456: change `KEY` → `SERVICE_KEY`. Run one batch; confirm via log the dossier now loads (log the dossier size — it was silently empty before). One-line fix that materially upgrades every future verdict.
- **1.3 — Reap the stuck rows (W5).** Re-confirm the 1.25M / "nothing since 2026-06-02" facts with a per-status indexed query, then decide disposition (scraped-market images → `skipped`/`failed`; personal → re-queue `pending`) so status metrics stop lying. Use `idx_vehicle_images_pipeline_stuck`.
- **1.4 — Un-park the scheduled driver (W1, first half).** Write fleet coordinator `scripts/daily-receipt/byok-fleet-next.mjs` that queries the coverage RPC/MV (NOT a whole-table scan) for the vehicle+day with the oldest pending/stale approved frames across all `source='user_upload'` vehicles, emits the chosen `vehicle_id`/day so `byok-image-batch.sh` runs against it, and exits. Reuse `byok-image-batch.sh`'s proven patterns (pooled keep-alive, lockfile, prepare-rc≠drain guard). Repoint the **installed** `com.nuke.byok-image-analysis.plist` to call the coordinator (no hardcoded vehicle) and reconcile the **repo** plist to match installed reality; fix the 300/900 + batch 4/15 drift; commit the running config so the repo is the source of truth. `launchctl unload`/`load`.

**PHASE 1 CHECKPOINT (the first win — demonstrate all four):**
1. `get_vehicle_analysis_coverage` returns in < 2s for the K5 AND for a never-touched vehicle, printing the live one-line scoreboard: *"corpus 25,597 · gated 11,866 · seen N · placed M · inflow 310/d · deep ~107/d · deficit R."*
2. The coordinator brief's image number == the RPC number (namespaces reconciled — no more lying brief).
3. One batch runs with the dossier context loading (W3 fixed, proven in log).
4. The launchd job, on its next fire, picks a **NON-K5 vehicle** and writes ≥1 deep verdict to a previously-untouched vehicle — the fleet self-advances. Capture the log line. (The doctrine-central 1983 K5 `8eab4edc`, currently 0 byok obs, is a good early target.)

### PHASE 2 — MAKE THE LOOP FLEET-WIDE & SELF-ADVANCING (W1, the core reliability fix)

- **2.1 — Finish the fleet coordinator** started in 1.4 into a **resumable, idempotent** driver. Each cycle it (a) processes **daily inflow first** (frames `observed`/created in last 7d lacking the canonical marker), (b) then the oldest un-deep-analyzed approved day across the fleet, (c) then a `prepare --rehash` slice for `stale=true`. It must **survive being killed mid-run** (no "died at `07124fb6` and never resumed") — checkpoint progress and re-derive remaining work from the DB each cycle, never from in-memory state.
- **2.2 — Retire `byok-burn-all.sh` as the fleet mechanism** (reduce it to a thin one-shot wrapper over the coordinator, or delete). The manual-nohup-that-dies pattern must not be how the fleet drains.
- **2.3 — Run an autonomous gate approver at volume.** 18,709 personal images are gate-pending and invisible to deep analysis. `vision-gate-classify.mjs` exists — schedule it (or fold a gate pass into the coordinator) so the approved set grows instead of capping the pipeline at 39%. Confirm against doctrine that the gate is meant to filter mis-attributed/personal, not to permanently park real build photos.

**PHASE 2 CHECKPOINT:** `tail logs/byok-image-batch.log` shows real ingest on **multiple distinct `vehicle_id`s** within one hour (not "drained, drained, drained"). Kill the coordinator mid-run; it resumes correctly next cycle from DB-derived state. The Phase-1 deficit ratio starts closing.

### PHASE 3 — RECONCILE THE TWO FLOWS IN CODE (inflow stops starving)

- **3.1 — Implement the inflow-priority lane** in the coordinator (§3 priority rule).
- **3.2 — Repair the inflow edge deep route (W's 404):** repoint `photo-pipeline-orchestrator`'s deep route (line ~742) off the dead `yono-analyze` and onto the BYOK enqueue flow (preferred), OR restore the Modal sidecar. Document which. New photos must get the deep analysis they currently fall through into nothing.

**PHASE 3 CHECKPOINT:** `observed_7d > 0` — a photo that ARRIVED this week got deep-analyzed this week. Backlog coverage % rises monotonically across two consecutive coordinator cycles. Stuck-processing count is ~0.

### PHASE 4 — WIRE THE SEARCH ENGINE (W2 → Tier 2 lights up)

- **4.1 — Make the deep writer populate `image_observations`.** In `deep-image-analysis-byok.mjs` ingest, add the `ingest_image_observation` RPC call (role/bbox/visual_signature from the verdict's `components_seen`/`camera_pose`), copying the shape from `process-photo-cascade.mjs:246` (ARM 2b), `observed_by='caller-byok'`. This is the canonical-marker decision made real.
- **4.2 — Backfill `image_observations` for the 12,496 already-deep-analyzed images** from their stored verdicts, then run `clip-embed-image-observations.py` (it exists) to lift CLIP coverage off 18.9%.

**PHASE 4 CHECKPOINT:** `image_observations` distinct-image coverage jumps from 2,224 (8.7%) toward ~12,500 (~49%); report the new % with CLIP % alongside. Visual search returns results. The coverage RPC's `pct_engine`/`placed_t2` climbs.

### PHASE 5 — FINISH THE CASCADE: DEPTH FROM 1–2 ATOMS TOWARD ~20 (W4, the core of the lens)

Integration of a tested-with-3-rows component, NOT greenfield. **Decide and execute:** chain `process-photo-cascade.mjs` after `deep-image-analysis-byok.mjs` ingest inside `byok-image-batch.sh` (preferred, per "develop from what exists"), OR fold arms 3–6 into the deep writer. If the cascade's `image_observations` write overlaps Phase 4's, **converge them — one writer owns `image_observations`; never double-write.**

- **ARM3 `technician_work_evidence`:** technicians resolve/create through the **org-entity/service path** (doctrine), not a hardcoded list.
- **ARM4 `equipment_usage_evidence` + ARM5 `consumables`** (call `decrement_consumable_stock` RPC): wire the dead arms. These feed `compute_inferred_value`/`vehicle_market_estimates`, which today returns `low_n_under_3` for lack of an evidence base.
- **ARM6 `parts_observed` → `parts_catalog`** (per-SKU), not dead-ending in JSONB.
- **Micro-atom lane:** `presence.person` → `contacts` work history; substances/PPE/weather from `workshop_signals` JSONB → queryable atom rows. Where a queryable destination genuinely does not exist, do NOT mint a parallel island — extend the existing atom store (`vehicle_observations.structured_data` with a typed `observation_property`); if a new property is needed, route it through **Phase 7's proposal path.**
- **Day-synthesis home:** `day-synthesis.schema.json`'s rich artifact (`work_items[]`, `parts_installed[]`, `build_arc_placement`, `labor_signal`) lives only as unqueryable `work_sessions.metadata->synthesis` JSONB (101/599). Either promote it to first-class rows or document the JSONB-only decision — don't leave it ambiguous.
- **Gate everything on intent confirmation (the $410 rule):** arms implying labor/value (ARM3 cost, ARM5 consumption) accrue only when `intent_confidence≥0.6` and not `needs_clarification`.

**PHASE 5 CHECKPOINT:** Run the cascade against one real K5 work-day. Report **atoms-per-photo** rising from 1–2 toward the target (image_observations row + ≥1 of ARM3/4/5/6 + micro-atoms). `equipment_usage_evidence` and `consumables` are no longer 0; `technician_work_evidence` grows past 23; `compute_inferred_value` has an evidence base above `low_n_under_3`.

### PHASE 6 — DEFINE & PORTRAY DEPTH IN THE UI; MAKE GROWTH VISUAL (the payoff)

Schema drift turned working components blank — the "no empty shells" rule converts a schema mismatch into a silent widget, which IS the owner's "exists but not interesting/reliable" complaint. **Assess every surface yourself (capture + inspect) before showing Skylar — broken UI surfaced = trust tax.**

- **6.1 — Un-dead the readers:**
  - `nuke_frontend/src/pages/vehicle-profile/VehicleFindingsCard.tsx` (lines ~101–128) gates on `ai_scan_metadata.classifier === 'claude-opus-4-7-byok'` — a string **NO writer emits** — and renders `null` for nearly every vehicle. Repoint to the canonical marker (`analysis_kind='image_deep_byok'` / nested `byok_deep_analysis` / `classifier IN ('caller-byok-cascade','caller-byok')`) and read the coverage RPC for its "X/Y analyzed" footer. ~3–10 line fix that un-deads the flagship card.
  - `AnalysisStreamPage.tsx` (lines ~59–60, 165) filters `structured_data @> {analysis_kind:'image_deep_byok'}` — **verify against live rows post-Phase-4**; reconcile reader and writer so the stream lights up (it should now flow). The live `● live` feed during a drain is the most visceral "it's happening" proof.
  - `ImageProcessingDashboard.tsx` is built on the retired tiered pipeline (`tier_1/2/3`, per-call Gemini/Haiku/gpt-4o-mini cost) and does a `head:true count(*)` over the 38.9M-row table (slow). Rebuild on the coverage RPC + canonical depth model, or retire it. **Never frame work as Anthropic API cost** (doctrine).
- **6.2 — Wire the timeline illumination.** `BarcodeTimeline.tsx` already renders the GitHub-style heatmap (`hm-c.l1..l4` → `--heat-2..5` green ramp, `BARCODE_COLORS` 1:`#a7f3d0`→4:`#047857`). Today `level` (lines ~349–354) is driven **purely by per-day timeline-event item count — ZERO analysis input.** Feed `level` (or a parallel intensity channel) from `get_day_analysis_coverage`'s `depth_score_avg`/tier ladder so each day cell **darkens as analysis depth accrues**: photos-but-no-verdicts dim (`l1`), Tier 1 warms, Tier 2/3 saturate, owner-confirmed Tier 4 glows `l4`/`#047857`. **This is the literal "timeline darkening/illuminating as data propagates, depth filling in over time" the owner asked for.** Ensure the RPC is cheap enough that the profile re-renders new levels on each load.
- **6.3 — Discoverability + doppelganger guard.** Link `AnalysisStreamPage` and a coverage view from the vehicle profile (today they're admin-only/orphaned in nav). Surface a "**this vehicle's photos may be split across N rows**" banner for doppelganger rows (e.g. the 0-image 1972 Blazer `5db59f3e…`) so working widgets don't read empty on the wrong `vehicle_id`.

**PHASE 6 CHECKPOINT:** Open a vehicle profile. The findings card renders real data on the 1977 Blazer. Run a drain, reload — `BarcodeTimeline` is **visibly darker/illuminated** than before; the heatmap fills in as the coordinator runs. Capture before/after screenshots — **this is the deliverable that closes the mandate.**

### PHASE 7 — CLOSE THE KNOWLEDGE-GROWTH LOOP (novel theory → KB write path)

When the agent derives a NOVEL attribute/theory the checklist lacks (`weld_pattern_type`, `period_correct_finish`, `media_blast_profile`), it must be **written back into the KB via a real runtime path** — not lost, not requiring a TypeScript redeploy to capture. This is the knowledge-architecture payload of the whole task and a **first-class deliverable.**

**State (recon-proven):** IMAGE attributes (`supabase/functions/_shared/cockpit/attribute-registry.ts`, 43 defs / 36 distinct, L1→L5) are **code-only by Skylar's explicit call** (line ~876) — **zero runtime write path**; `mcp-connector` (52 tools) exposes `get_attribute_checklist`/`submit_attribute_value`/`synthesize_attribute` but **0** propose tools. PROPERTY proposals (`schema_proposals`→`observation_properties`, 19 proposals / 15 approved / 38 properties) — the back half WORKS, the front half is unwired (`pending_claims=0`, no `schema-proposals` edge function, `api-v1-events/index.ts` has ZERO `unknown_property`/`schema_proposal` references).

- **7.1 — Capture novel IMAGE attributes (respect the code-only call, stop losing discoveries).** Add a `propose_attribute` MCP tool (in `mcp-connector/index.ts`) and/or a `projection_event` meta-row that records a PROPOSED attribute `{name, prompt, expected_shape, admissible_evidence, motivation, sample_evidence, observed_by, confidence}` with full source DNA. A human (or curator job) promotes it into `attribute-registry.ts`. Today **0 of 52 MCP tools** can grow the vocabulary; this closes the loop through the agent surface while keeping promotion human.
- **7.2 — Close the PROPERTY loop that's 80% built.** Implement the `api-v1-events` rejection path (ch.8 §8): unknown `property_id` → park in `pending_claims` → cite a `schema_proposal`. Add the missing `schema-proposals` edge function + an MCP propose tool. The tables/trigger/15-approved-proposals prove the back half; you finish the front half.
- **7.3 — Reconcile the two consensus engines & close the governance leak.** TS `handleSynthesizeAttribute` (weight=`base_trust*confidence`, MCP-exposed) vs SQL `project_attribute()` (weight=`evidence_weight*actor_trust*confidence*recency`, richer, NOT exposed). Expose the richer SQL one via MCP; retire the weaker. Route `money_flow_artifact`/`smoke_test` (which reach `projection_event` bypassing the `getAttribute` admissibility gate) through the same gate so the registry is genuinely the single source of admissible attributes.
- **7.4 — Fix stale doctrine & author the missing theory docs.** Update encyclopedia **ch.8 §0** — it still labels live tables (`schema_proposals`=19, `observation_properties`=38) "PROPOSED, not applied," inviting a duplicate rebuild. Author the theory docs the registry header cites but that **do not exist anywhere in the repo** (`observation-projection-boundary.md`, `image-to-atom-taxonomy.md` L1–L5, `cockpit-unified-interface.md`, `layer-dependencies.md`) into `docs/library/` so the governing theory is a queryable artifact, not reverse-engineered from code (per `.claude/rules/library.md`: the library, not code, is source of truth). Reconcile `feedback_image_work_read_concept_first` so its "pipeline already exists / cascade is live" claim matches the now-true reality.

**PHASE 7 CHECKPOINT:** (1) `propose_attribute` with a novel image attribute → lands as a proposal row with source DNA, retrievable. (2) POST an unknown property to `api-v1-events` → parks in `pending_claims` and creates a `schema_proposal` (was 0). (3) `synthesize_attribute` via MCP returns the recency/evidence-weighted result. (4) The L1–L5 taxonomy doc is in `docs/library/` and `query_library` finds it.

### PHASE 8 — STANDING OBSERVABILITY & SUBTRACTIVE CLEANUP

- **8.1 — Standing dashboard.** A single `image-ecosystem-status` view/RPC reporting, with source DNA on every number: deep coverage %, engine coverage %, CLIP %, atoms-per-photo, cascade-arm fill (3/4/5/6), inflow-vs-throughput (per-day), stuck-processing count, stale-rehash queue depth, `vision_gate` approval backlog. This replaces "succeeded" cron lines (which only mean `net.http_post` dispatched).
- **8.2 — Retire schema sprawl (the cure is subtractive).** ~45 of 65 image/observation tables are empty aspirational schema (`image_work_extractions`, `image_identities`, `image_camera_position`, `image_pose_observations`, `image_angle_spectrum`, `surface_observations`, `photo_inbox`, `photo_sync_items`, …). For each: wire it to the cascade if it has a real lane, else mark deprecated/drop. Do not leave dead tables masquerading as capability.

**PHASE 8 CHECKPOINT:** the status RPC returns every metric in < 5s. Two consecutive daily runs show: deep coverage % up, engine coverage % up, atoms-per-photo up, stuck-processing → 0, `observed_7d > 0`. Screenshot the timeline darkening week-over-week.

---

## THE FOUR REGISTERS — confirm each is served

- **Technical:** the W3 bug, the index/MV strategy, the `image_observations` writer wiring, the cascade arms, the plist. (Phases 1, 4, 5.)
- **Programmatic:** the scheduled self-advancing coordinator, idempotent resumable runs, the gate approver, the inflow-priority lane, config under version control. (Phases 1–3.)
- **Intellectual:** the canonical adjudications — one marker, one tier ladder, one depth score, one write path — and the documented demotion of the listing four-tier. (§4, Phase 7.4.)
- **Knowledge:** the coverage RPCs/MV, the standing dashboard, the `propose_attribute` path, the property-loop closure, the authored theory docs, the corrected doctrine. (Phases 1, 7, 8.)

---

## DEFINITION OF DONE — verifiable, not vibes

1. **It's happening, provably:** the status RPC runs in < 5s and prints live coverage with source DNA; the launchd job advances across multiple vehicles in `logs/byok-image-batch.log` (not "drained" forever).
2. **It's bulletproof:** kill the coordinator mid-run → it resumes from DB-derived state. No manual nohup. No single-vehicle pin.
3. **One marker, no lies:** the coordinator brief, the UI, and the coverage RPC all agree on one number; the `appraiser->primary_label` phantom is gone.
4. **Two flows, one engine:** `observed_7d > 0` (inflow deep-analyzed within the week); the inflow-vs-throughput deficit trends toward ≤1; backlog coverage rises monotonically.
5. **Depth has a number and tiers:** every deep-analyzed image carries an `analysis_depth_score`; the Tier 0→4 ladder is countable; the backlog is rank-orderable.
6. **Engine + cascade are alive:** `image_observations` covers ≥49% of the personal corpus with climbing CLIP; atoms-per-photo has risen from 1–2 toward ~20; `equipment_usage_evidence`/`consumables` are no longer 0.
7. **It's visible:** the findings card renders real data; `BarcodeTimeline` darkens by analysis depth; an overnight coordinator run visibly fills the heatmap (before/after screenshots).
8. **Knowledge grows:** a novel agent-derived attribute lands as a retrievable proposal; the property unknown-attribute path routes to `pending_claims`; `synthesize_attribute` uses the richer engine.
9. **Doctrine matches reality:** ch.8 §0 and `18-deep-image-analysis.md` reflect what's live; the cited theory docs exist.

---

## RULES OF ENGAGEMENT

- **Repair in place. Never greenfield a parallel island.** Every named executor (`deep-image-analysis-byok.mjs`, `byok-image-batch.sh`, `process-photo-cascade.mjs`, `build-day.mjs`, `photo-pipeline-orchestrator`, the plist) is the thing to fix or finish. If you feel the urge to mint a new script/table/index/page, first prove the ancestor doesn't exist — recon says it usually does. The cure for sprawl is subtractive.
- **Read before you write.** Read actual file/schema/log state before editing; line numbers may have drifted.
- **Idempotent, resumable, observable** is the bar for every batch operation. Re-running must not double-write; killing must not lose progress; every run must emit a metric.
- **Coverage is scoped to the personal corpus (~25.6K), never the 38.95M.** Status columns (`'completed'`) are unreliable; the canonical atom-marker is truth. Re-verify magnitudes with an indexed query before any destructive act; use a maintenance window for full-table work; never full-scan on the pooler.
- **No bare numbers; atoms via the real write path.** Every DB value carries `(source, method, observed_at, trust)`. Write through `ingest-observation` / `ingest_image_observation` / the proposal path — never raw INSERT into testimony tables (the PreToolUse hook blocks God-mode writes), never `.md` as substrate.
- **Owner-confirm is the value gate.** 0/599 work_sessions are confirmed; do NOT auto-confirm labor/value. Surface the existing `confirm_prompt`/`value_status='unconfirmed'` machinery; the human signs labor/value, ownership promotion, and destructive ops.
- **Entities, not registries.** Technicians/equipment/vendors resolve through the org-entity/service path.
- **Run unsandboxed** for anything touching Supabase/network (the sandbox drops the network → false HTTP 000 / "image processing API error"). Use the proven `byok-image-batch.sh` + launchd patterns.
- **Land decisions in the substrate and the library, not in `.md` status reports.** Durable theory/doctrine updates (the §4 adjudications, the Phase-7 docs) go in the library; never status logs.
- **Show movement.** Each phase names a number that must move (queue honesty, distinct vehicles drained, `image_observations` %, `observed_7d`, cascade-arm rows, atoms-per-photo, timeline darkness). Report before/after. The owner has been told "it exists" too many times — your job is to make the metric move and the timeline light up.

**Start at Phase 1.1 and 1.2 — the fastest path to a demonstrable first win. Show the first coverage scoreboard and the second-vehicle log line, then proceed in order. Report each phase as the metrics that moved.**