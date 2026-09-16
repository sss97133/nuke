# 18. Deep Image Analysis — The Canonical Depth Model

## The Adjudication Record for "How Deep-Analyzed Is This Photo?"

**Date**: 2026-06-18
**Status**: Record of decisions already made in code — not aspiration. Each adjudication below was landed in a real migration / script during the IMAGE_ANALYSIS_100X mandate (`docs/IMAGE_ANALYSIS_100X_PROMPT.md`) and is cited to the file that enforces it.
**Prerequisite reading**: `docs/library/reference/encyclopedia/05-image-as-butterfly-node.md` (the butterfly-node concept), `11-intelligence-surface.md` (the vehicle-level density surface — an ORTHOGONAL axis, see §C), `vehicle-profile-computation-surface.md` (render-is-compute).

---

## Why this chapter exists

For years the platform accumulated **four disagreeing "analyzed" markers, four schema generations, and four "tier" vocabularies**, and no single number that answered "how deeply has this photo been read?" A photo was treated as a boolean — analyzed or not — when in truth it climbs a ladder of named depths, and the same image re-composes into many pictures depending on which slice you ask for. The drift produced a coordinator brief that *lied* about coverage (it measured a marker no writer emitted), UI cards that rendered `null` because they gated on a classifier string nothing wrote, and a "search engine" table that was 8.7% populated while 12,496 images carried deep verdicts.

This chapter is the **adjudication record**. The governing rule of the mandate is *crown one, demote the rest, never add a fork*. Below, each axis names the thing that was crowned, the thing that was demoted, and the file that makes the decision real. When the next agent finds two of something and is tempted to mint a third, this chapter is the answer to "which one is canonical, and where is that written down."

This is doctrine, so it lives in the library — the library is source of truth; code is its implementation (`.claude/rules/library.md`). Do not re-litigate these in code without amending this chapter.

---

## §A — ONE deep-analysis marker

**CROWN:** An image is **deep-analyzed iff** it carries BOTH of:

1. `vehicle_images.ai_scan_metadata ? 'byok_deep_analysis'` — the forensic verdict JSONB (scene_type, build_phase_guess, camera_pose, bbox-localized `components_seen[]` / `damage_localized[]` / `text_regions[]`, state_observations, workshop_signals, presence). Written at `scripts/deep-image-analysis-byok.mjs:286–319`.
2. an `image_observations` row (`is_active`, keyed by `image_id`) — the **search/convergence engine** row. Written via the `ingest_image_observation` RPC at `scripts/deep-image-analysis-byok.mjs:455` (ARM 2b), `observed_by='caller-byok'`.

A `vehicle_observations` row (`kind='condition'`, `structured_data.analysis_kind='image_deep_byok'`) is written alongside (`scripts/deep-image-analysis-byok.mjs:361–402`) so the verdict surfaces in timeline/observation routes and supersedes any prior verdict for that image per the trust invariant. The two markers above are the *coverage definition*; this observation row is the *timeline projection* of it.

**DEMOTE:** `ai_scan_metadata->appraiser->primary_label` is **retired as a coverage signal.** No current writer produces it, so any metric reading it reports phantom coverage. The canonical numerator (T1 verdict AND `image_observations` row) is computed by `get_vehicle_analysis_coverage()` (`supabase/migrations/20260617000000_image_analysis_coverage_rpc.sql`), and the `ralph-wiggum-rlm-extraction-coordinator` brief reads that RPC rather than the dead appraiser namespace.

**The two markers fire together now.** The historical wound (W2) was that the deep writer wrote the verdict + the `vehicle_observations` row but **never** the `image_observations` engine row, so visual search was dark. That arm (ARM 2b) is wired in at `scripts/deep-image-analysis-byok.mjs:433–470`; the deep writer **owns** `image_observations` going forward (`observed_by='caller-byok'`), and the historical 12,496 already-verdicted images are reconciled by `supabase/migrations/20260617010000_backfill_byok_image_observations.sql`.

**Enum note (the ambiguity, killed):** `byok` observations ride on `kind='condition'` plus `structured_data.analysis_kind='image_deep_byok'`, **not** a dedicated `kind='analysis'` enum value. The `analysis` enum value remains unlanded (migration-history desync, flagged in-code at `scripts/deep-image-analysis-byok.mjs:359–360`). This is the formally-documented decision: **byok rides condition+analysis_kind**; do not block on the `analysis` enum, and do not write a second condition variant.

---

## §B — ONE tier ladder

**CROWN:** the **Tier 0 → Tier 4** ladder. This is the canonical per-image depth model and the countable metric ladder. It is encoded as the `get_vehicle_analysis_coverage()` / `get_day_analysis_coverage()` columns (`supabase/migrations/20260617000000_image_analysis_coverage_rpc.sql:16–24`) and derived from the BYOK per-image verdict (`scripts/schemas/byok-image-verdict.schema.json`, validated by `validateVerdict()` at `scripts/deep-image-analysis-byok.mjs:75`).

| Tier | Name | Marker (the literal predicate the RPC counts) |
|------|------|-----------------------------------------------|
| **T0** | **GATED** | `vehicle_images.vision_gate_status='approved'` — this photo belongs to this vehicle and is worth deep work (gate from migration `20260503210000`). |
| **T1** | **SEEN** | `ai_scan_metadata ? 'byok_deep_analysis'` — a deep BYOK verdict exists. |
| **T2** | **PLACED** | an active `image_observations` row exists — the image is in the search/convergence engine, findable by visual similarity, clusterable into bursts. `T2+CLIP` = that row carries `embedding_clip_vitb32`. |
| **T3** | **CONNECTED** | the cascade fired — the image contributed atoms to `technician_work_evidence` / `equipment_usage_evidence` / `consumables` / `parts_observed`; it is part of a day's work story (§E). |
| **T4** | **CONFIRMED** | the day the image belongs to is owner-confirmed (`work_sessions.owner_confirmed_at`) — labor and value are testimony, not agent guess. **This is the value gate; the human signs labor/value.** |

The ladder is monotone and additive: a photo at T3 is also T2, T1, T0. The product spine and the metric ladder are the **same** ladder — that is the point.

**DEMOTE — the single most common conflation:** the listing four-tier **`decode / observe / deliberate / sign`** (`nuke_frontend/src/services/channelAdapters.ts:100–111`) is **NOT image depth.** Its real and only scope is **listing-field justification** — *how a value being projected onto a sales channel's field-map was justified* (`decode`=deterministic from VIN/title, `observe`=from the image cascade, `deliberate`=ownership-era narrative, `sign`=needs the owner's signature). Its canonical home is `docs/library/technical/design-book/sales-channels-are-service-businesses.md` (cited at `channelAdapters.ts:105–106`). These are different axes: one answers "how deeply read is this photo," the other answers "how was this listing field defended." Do not feed one into the other; do not invent a fifth image tier from it.

**ARCHIVE as deprecated (pre-BYOK, no drainer, do not rebuild):**
- `image_analysis_records` (223 rows) and `component_identifications` (17 rows) — the retired tiered pipeline.
- `analysis_queue` (112,320 tier1-3/expert rows) — the legacy pre-BYOK queue, no drainer; superseded by the per-vehicle coverage counter + fleet coordinator (§F).

**LEAVE ORTHOGONAL — name them so they're never confused with depth (§C).**

---

## §C — The orthogonal axes (named, so nobody mistakes them for image depth)

Three other "score/level" systems exist. None is per-image depth. Naming them here is itself an adjudication — the historical failure was treating them as competitors to the tier ladder.

- **Worth-Engine — existence × magnitude** (migration `20260523081300`). A **vehicle-VALUE** confidence model: two axes, "does this thing exist" × "how much is it worth." Consumes cascade evidence (§E) but is not a measure of how analyzed a photo is.
- **Level 1–5, Sparse → Bedrock** (`11-intelligence-surface.md`). A **vehicle-level density** scale — how much is known about the *vehicle* overall. A vehicle can be Bedrock while a given photo is still at T0.
- **`analysis_depth_score` (§D)** is the only per-image depth number.

Rule: a value axis and a per-image-depth axis must never be unified into one number. They answer different questions and move independently.

---

## §D — ONE per-image `analysis_depth_score` (0–1)

**CROWN:** a single `analysis_depth_score ∈ [0,1]` per image, computed by `nuke_image_depth_score()` (`supabase/migrations/20260617000000_image_analysis_coverage_rpc.sql:27–48`). It blends tier attainment with verdict richness:

- T0 gated → +0.12; T1 seen → +0.30; T2 placed → +0.13; T2+CLIP → +0.07; T3 connected → +0.08; T4 confirmed → +0.07.
- Verdict-richness bonuses (only when SEEN): `context_complete` → +0.08; `intent_confidence ≥ 0.6` → +0.08 (the $410 gate, §G); at least one bbox-localized component → +0.07.
- Staleness penalty: a SEEN-but-`stale` image → −0.05 (it owes a re-hash).

**It is computed on read, not persisted as a column** — render-is-compute (`vehicle-profile-computation-surface.md`). The per-vehicle average and per-day average are surfaced through `get_vehicle_analysis_coverage().depth_score_avg` and `get_day_analysis_coverage().depth_score_avg`. This is the **rank-order key for the backlog** (drain low-score-but-gated first) and the **fuel for the timeline illumination** (`BarcodeTimeline` darkens as the day's `depth_score_avg` rises). Do not introduce a second "how-analyzed-is-this-image" number; extend this function's terms instead.

---

## §E — The butterfly cascade these tiers express

One photo is a butterfly node: it deposits atoms across many entity domains (`05-image-as-butterfly-node.md`). The tier ladder is the *coverage projection* of that cascade. The arms, with their live writers:

```
PHOTO ──┬─► ARM1  vehicle_images promoted verdict (ai_scan_metadata.byok_deep_analysis)   deep-image-analysis-byok.mjs:286
        ├─► ARM2  vehicle_observation atom (kind='condition' + analysis_kind, supersession) deep-image-analysis-byok.mjs:361
        ├─► ARM2b image_observations engine row (role, bbox, visual_signature, CLIP) = T2   deep-image-analysis-byok.mjs:455
        ├─► ARM3  technician_work_evidence (who did the labor — org-entity)                 cascade_technician_evidence RPC
        ├─► ARM4  equipment_usage_evidence (tool depreciation)                              cascade_equipment_evidence RPC
        ├─► ARM5  consumables decrement (paint / abrasives / fluids)                        cascade_consumable_evidence RPC
        └─► ARM6  parts_observed → parts_catalog (per-SKU)
```

The cascade is **chained after the deep verdict inside the harness** (`scripts/daily-receipt/byok-image-batch.sh:230–258`): ingest the verdict → `build-day.mjs` rollup → fire `cascade_technician_evidence` / `cascade_equipment_evidence` / `cascade_consumable_evidence` per vehicle, then refresh the documented-investment floor. ARM3/4/5 are real, dated migrations:

- `supabase/migrations/20260617060000_cascade_technician_evidence.sql`
- `supabase/migrations/20260617090000_equipment_from_photo_testimony.sql`
- `supabase/migrations/20260617093000_consumables_from_photo_testimony.sql`

**Entities, not registries:** technicians/equipment/vendors resolve through the org-entity/service path, never a hardcoded list (`feedback_everything_is_an_entity_with_service_provenance`).

---

## §F — Two flows, ONE engine (the architecture)

There is **one deep engine** — the doctrine-sanctioned BYOK `claude --print` path (`byok-image-batch.sh` → `deep-image-analysis-byok.mjs` → `build-day.mjs` → cascade RPCs). It has **two feeders**, and they must never become two engines:

- **BACKLOG feeder** — the fleet coordinator drains the oldest gated-but-unseen approved days across the whole personal corpus, plus a `prepare --rehash` slice for `stale=true` images. Driven by `scripts/daily-receipt/byok-fleet-next.mjs`, which ranks candidates from the per-vehicle counter table `image_coverage_by_vehicle` (refreshed one vehicle at a time via `refresh_image_coverage()`) — it **never scans** the 38.9M-row `vehicle_images` table (that times out on the pooler — wound W5). This replaces the wound-W1 hardcoded single-vehicle plist that pinned the cron to one drained K5, and retires the manual `nohup` `byok-burn-all.sh` that died mid-fleet.
- **INFLOW feeder** — new photos (`trigger_photo_pipeline_on_image_insert` + the `photo-pipeline-drain` cron) routed into the **same** deep flow.

**Inflow deep route repointed off the dead Modal sidecar (P3.2, wound W §3.2).** `photo-pipeline-orchestrator/index.ts` used to route its deep tier to `yono-analyze` → a Modal Florence-2 sidecar whose `/health` returns 404, so every new photo got only shallow Gemini classification and the deep work fell through into nothing. Decision: **do not restore Modal — feed the BYOK engine** (option b, strongly preferred — it unifies inflow and backlog onto one engine and retires the sidecar). The orchestrator now calls `enqueueDeepByok(imageId, vehicleId)` instead of `yono-analyze`. That helper marks the frame **gate-eligible** (`vision_gate_status='approved'`, but only when it isn't already `rejected_misattributed`/`rejected_personal` — the gate's reject verdict is respected; only a human/approver reverses a rejection) **without** writing `ai_scan_metadata.byok_deep_analysis`, leaving an observable `deep_byok_enqueued` marker, then calls `refresh_image_coverage(vehicle_id)`. This is exactly the selection contract `deep-image-analysis-byok.mjs:prepare()` uses (`vision_gate_status='approved'` AND `byok_deep_analysis` MISSING, lines ~134–161) and what `byok-fleet-next.mjs` ranks on (the `image_coverage_by_vehicle.inflow_7d` lane). The shallow Gemini classification path is untouched. The yono-dependent inflow branches that could never fire with a 404 sidecar (`yono-escalation-router`, `detect-before-after` keyed on `yonoResp.vehicle_zone`) were removed; the zone/stage/condition/damage they wanted now come from the BYOK deep verdict downstream. `compute-labor-estimate` (independent of yono) is retained.

**Inflow-priority rule (canonical):** anything `observed`/created within the last 7 days is processed **ahead of** backfill. Today's photos never wait behind 2024's. This is encoded literally in `byok-fleet-next.mjs:46–53`: `score = inflowDeficit * 1_000_000 + gatedUnseen`, so any vehicle with un-analyzed last-7-day photos sorts above any pure-backlog vehicle. The reason: the historical wound was `observed_7d=0` — the 12,570 verdicts were a one-time backfill blitz and zero of the past week's NEW photos were freshly deep-analyzed. The coordinator must keep `observed_7d > 0`.

**Personal corpus = `is_external=false`** — NOT `source='user_upload'` (that slug is ~1 of ~9 personal sources and undercounts by ~70%; the invariant is documented at `20260617000000_image_analysis_coverage_rpc.sql:11–14`). Every coverage number is scoped to this corpus, never the 38.95M scraped rows.

---

## §G — The $410 intent gate (cross-cutting)

Value accrues ONLY from owner-confirmed labor (`feedback_photo_intent_must_be_confirmed_not_assumed`). A verdict with `intent='unknown'` or `intent_confidence < 0.6` MUST set `needs_clarification=true`; `validateVerdict()` rejects it otherwise (`scripts/deep-image-analysis-byok.mjs:84–87`, threshold `INTENT_CONFIRM_THRESHOLD`). Arms that imply labor/value (ARM3 cost, ARM5 consumption) accrue only when the gate passes, and T4 (CONFIRMED) — the value tier — requires the human's `owner_confirmed_at`. The agent never auto-confirms labor, value, ownership, or destructive ops.

---

## The closing principle

A photo is not analyzed-or-not. It climbs a named ladder — GATED → SEEN → PLACED → CONNECTED → CONFIRMED — and each rung is a countable marker with source DNA, not a vibe. One marker, one ladder, one depth score, one engine with two feeders. When the timeline darkens as the coordinator drains overnight, that is this ladder filling in, made visible. Crown one; demote the rest; never add a fork.

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-06-18 | Chapter 18 authored as the §4 adjudication record for the IMAGE_ANALYSIS_100X mandate. Records the crowned deep-analysis marker (§A), the Tier 0–4 ladder with the listing four-tier demotion (§B), the orthogonal value/density axes (§C), the single `analysis_depth_score` (§D), the butterfly cascade arms (§E), the two-flows-one-engine architecture with the inflow-priority rule (§F), and the $410 intent gate (§G). Each decision cited to the live file that enforces it. |
| 2026-06-18 | §F: recorded P3.2 — `photo-pipeline-orchestrator`'s dead `yono-analyze` deep route (Modal sidecar `/health` 404) repointed onto the BYOK engine via `enqueueDeepByok()` (gate-approve + `refresh_image_coverage`, respecting prior rejections; never writes `byok_deep_analysis`). Inflow now feeds the same engine as backlog; the yono-dependent escalation/before-after branches removed. |
