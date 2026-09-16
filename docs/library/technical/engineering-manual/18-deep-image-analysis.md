# 18 — Deep Image Analysis Pipeline

> **STATUS: PROTOTYPE / DRAFT (2026-05-23).** This chapter was written mid-session before the pipeline was actually run. Treat as orientation, not spec. Known gaps listed at bottom.

> Goal: turn the K5's 2,303 approved photos (and every future vehicle's photo set, ~75K total across Skylar's iPhoto library) into a structured, navigable, narratable build chronicle. Each image is a fact-bearing artifact; each cluster of images at a moment in time is a *scene*; each chain of scenes is the *narrative*.

This chapter exists because vision-gate verdicts (`approved` / `misattributed` / `personal`) are *triage*. They tell you "is this image of the right vehicle". They don't tell you *what's happening in it, what parts are visible, what state the vehicle is in, where in the build it sits*. That's the next pass.

## What deep analysis produces

For each image:

1. **Scene type** — engine_bay / body_exterior / body_interior / undercarriage / receipt_document / data_plate / hand_drawn_diagram / shop_context / fabrication_in_progress / paint_booth / wheel_assembly / road_test / off_property / cross_reference (3D render, mood-board, comparable vehicle).
2. **Build phase** — discovery / teardown / metalwork / paint_prep / paint_application / mechanical_assembly / wiring / interior / final_assembly / drivable / show_finish. (One vehicle can re-enter phases — order is not strict.)
3. **Components visible** — list of part categories or specific PNs identifiable in the frame. `["engine.ls3_short_block", "engine.holley_intake_300_129", "body.driver_door"]` etc.
4. **State markers** — rust_severity / paint_state / completeness / damage_callouts / measurement_visible (calipers reading a value, tape measure on a panel).
5. **Persons/dogs/places** — recorded only as `presence: "person"`, not identifying anyone. Purely a confidence signal that this isn't an isolated-part-detail shot.
6. **Temporal anchors** — date taken (EXIF or `created_at`), date inferred (when EXIF missing), state-relative ordering hints ("after paint" / "before paint" — derivable from rust state + paint state).

These features are written to `vehicle_images.deep_analysis` (jsonb) and reflected as a `kind='analysis'` `vehicle_observation` so the timeline shows them.

For each *cluster* (group of images in the same date window OR same build phase):

1. **Scene narrative** — a 2-4 sentence description of what happened in that window. Cites individual image IDs as witnesses.
2. **Linked atoms** — every part observation referenced by the cluster, every receipt observation dated in the window, every comment.
3. **Phase transition signals** — "this is where teardown ended and metalwork began". Sets the lifecycle pointer for the vehicle's build phase.

These narrative observations are `kind='analysis'` rows scoped to a date range (use `structured_data.window_start` / `window_end`).

## Why structured features + cluster narrative

The user has explicitly rejected curated views ("don't give me top-10 lists, give me Excel-style sortable everything"). The substrate model is:
- Raw atoms (per-image features, per-receipt line items) — stored verbatim, queryable.
- Derived views (build phase narrative, vendor rollup, lifecycle dashboard) — composed from raw atoms.

This means deep analysis writes ATOMS, not summaries. Summaries are computed at view time from the atoms. If the user disagrees with a phase boundary, they can change ONE phase-transition atom and the narrative updates everywhere it's surfaced.

## The pipeline

```
For each batch of N images (start with N=20 to fit Claude Code Agent context):
  1. Prepare worklist: vehicle_images rows where deep_analysis IS NULL,
     ordered by created_at ASC. Skip vision_gate_status != 'approved'.
  2. Spawn BYOK agent with worklist + this chapter's instructions.
  3. Agent downloads each image (use optimizeImageUrl 'medium' so the
     transfer is ~150KB not 5MB).
  4. Agent reads each image, fills the structured schema (above), writes
     verdicts JSONL.
  5. Ingest verdicts → vehicle_images.deep_analysis + write a
     kind='analysis' vehicle_observation per image (so the timeline lights up).
  6. After every 200 images processed, run the clustering pass:
       SELECT date_bucket, array_agg(image_id), array_agg(scene_type), ...
       FROM vehicle_images
       WHERE vehicle_id = $1 AND deep_analysis IS NOT NULL
       GROUP BY date_bucket;
     For each cluster, write a phase-narrative observation if not present.
```

Idempotency:
- Each image: `deep_analysis_at` timestamp marks completion. Re-runs skip.
- Each cluster: identified by `window_start/end + vehicle_id`. Re-runs supersede with new content if changed.

## Self-direction by future agents

A future agent picking this up:

1. Read this chapter end to end. It IS the spec.
2. Read `docs/library/working/2026-05-23_timeline-substrate-mvp.md` for current substrate state.
3. Query the DB to know what's already been done:
   ```sql
   SELECT count(*) FILTER (WHERE deep_analysis IS NULL) AS pending,
          count(*) FILTER (WHERE deep_analysis IS NOT NULL) AS done
   FROM vehicle_images
   WHERE vehicle_id = '<id>' AND vision_gate_status = 'approved';
   ```
4. Don't ask the user what to do. Start with the next batch of 20 images.
5. Stop and ask only when:
   - The image contains content that requires legal/ethical judgment (faces of identifiable minors, etc.)
   - The image suggests a vehicle reattribution (this is a different vehicle entirely)
   - The structured schema needs a new field that isn't covered here (file a schema proposal, don't invent silently)

## What "narrative" means here

Not marketing prose. A factual chain of build events the user can scroll through and recognize. Example:

> **2021-04 — Teardown initiated.** First photos of the K5 in Skylar's possession show original 400 SBC + Quadrajet still mounted; chrome bumpers and tan vinyl interior intact. Body has rust on rockers, cab corners, lower quarter panels (witness: image 0c7f11dc, 1abc66f8, …). First parts orders begin: LMC Truck $239.40 trim parts, AutoZone $148.97 oil/filter for transport.
>
> **2023-11 — LS3 dressing kit arrives.** Holley shipment 766317 delivers 20-186 mid-mount accessory drive, 300-129 LS3 intake, 534-209 fuel rails. Concurrent Holley invoice $1,019.98. Build phase: mechanical_assembly. Parts staged but install evidence pending.
>
> **2026-04 — SMS Fabrics interior cloth received and installed.** 77-7438 plaid fabric for re-upholstery; install evidence visible in image 64a67714.

Each paragraph is a generated observation. Each sentence cites its source image/observation. The user can rewrite or split a paragraph without breaking the underlying atoms.

## Cost reality

BYOK (Claude Code Agent reads images via Read tool) = ~$0 marginal cost per image. ~1 image / ~5 seconds of agent time. 2,303 images = 11-12 hours of one agent OR 1-2 hours of 8 parallel agents. The earlier vision-gate run did 2,303 in roughly that time using 14 parallel agents.

Re-running deep analysis is similar cost. Cluster narrative is cheap (it's SQL aggregation + one LLM call per cluster, maybe 20-50 calls total per vehicle).

## What you have available

- `vehicle_images` table (2,303 K5 approved photos).
- `vehicle_observations` table (327 K5 observations: receipts, specs, conditions, comments).
- `observation_witnesses` table (linking observations ↔ images).
- `optimizeImageUrl()` helper (Supabase render endpoint, bandwidth-cheap).
- Existing vision-gate L4 scripts at `scripts/vision-gate-l4.mjs` — model for the worklist/verdict/ingest pattern.

## What you don't have

- A `deep_analysis` column on `vehicle_images` yet. First step: add it via migration:
  ```sql
  ALTER TABLE public.vehicle_images
    ADD COLUMN IF NOT EXISTS deep_analysis jsonb,
    ADD COLUMN IF NOT EXISTS deep_analysis_at timestamptz;
  CREATE INDEX IF NOT EXISTS idx_vehicle_images_deep_analysis_at
    ON public.vehicle_images(deep_analysis_at) WHERE deep_analysis_at IS NOT NULL;
  ```

- A scene-type taxonomy beyond the rough list above. Refine as you process — the first 100 images will tell you what categories you actually need.

## Failure modes to avoid

- Don't summarize before you analyze. Write per-image features first; cluster narratives are derived, not authored.
- Don't ask the user "should this image be teardown or paint_prep" — make the call from the visual evidence and flag uncertain ones explicitly with `confidence: 'low'`.
- Don't delete or supersede existing `vehicle_images` rows. Deep analysis enriches; it doesn't replace.
- Don't make claims about specific persons identifiable in photos. Record `presence: "person"`, not names.
- Don't read images outside the K5 vehicle scope unless explicitly told to.

---

*This chapter is the playbook. If a future agent reads it and asks "what now," the answer is: query the pending count, prepare a batch of 20, run the analysis, write the atoms, repeat.*

---

## Known gaps in this chapter (caught the day it was written)

This was written before the pipeline was actually run end-to-end. Don't treat as truth:

1. **Vision model.** The doc says "BYOK Claude Code Agent reads." The implementation reach was for `scripts/deep-image-analysis.mjs` which uses Gemini 2.5 Flash ($0.001/image). The user's constraint is *no paid APIs at all* — when there are 75K images, $75 of Gemini becomes uneconomic at scale even if it looks cheap on one vehicle. Replace this script with a BYOK sibling (model on `scripts/vision-gate-l4.mjs`) before running again.

2. **Throughput estimate.** "11-12 hours for 2,303 images at 14 parallel agents" — measured against the vision-gate-l4 session earlier this same day, parallel agents hit usage quotas around the 1.5-hour mark. The honest number is unclear and depends on rate limits.

3. **Schema is invented.** `scene_type`, `build_phase`, `components_visible` were proposed without validating against actual K5 outputs. The first 100 images will probably surface 2-3 categories I missed entirely (e.g. "screenshot of a vendor product page", "Apple Numbers spreadsheet view", "tape measure showing a value with no vehicle context"). Adapt the schema to what the images actually contain.

4. **Storage location collision.** I added a `deep_analysis` jsonb column to `vehicle_images` while a parallel pipeline writes to `ai_scan_metadata.deep_analysis` on the same table. **Dropped my redundant column on 2026-05-23.** Canonical location: `ai_scan_metadata.deep_analysis` — but that column is a soup of multiple analysis-pipeline outputs and should probably be split eventually.

5. **Narrative form.** The doc proposes per-cluster paragraphs. Real iPhoto libraries have heavy redundancy (50 photos of the same engine angle within minutes). A naive grouping by day will produce duplicate narratives. Cluster by *visual similarity within a day window*, not just by day.

6. **Component-identification ceiling.** Vision models — Claude or Gemini — cannot read tiny part numbers off a manifold unless the photo specifically captures the part label. Expect `components_visible` to be 80% category (e.g. "ls3-style intake") and 20% specific PNs. Don't over-promise.

7. **"Build phase" is leaky.** A restoration re-enters phases (paint after a fab discovery, then back to fab). One image isn't enough to assign a phase definitively — needs sibling images and dated receipts to triangulate. The doc handwaves this.

The honest framing: this is prototype work. The chapter is a starting hypothesis. Read it, then read the actual outputs, then revise the chapter.

---

## 2026-05-23 update — what actually happened when we ran it

Three bbox-bearing atoms landed on K5 in a single live session via a teacher-student self-critique loop. The chapter above proposed the system; this section is the *operating* version: what the pipeline actually looks like once you stop describing it and start running it.

### The loop, in one paragraph

For each image, Claude does **v1 → annotate → v2 → ingest**. v1 is a verdict produced by Reading the source image and authoring JSON with bbox coords. The annotate step renders the bboxes back onto a downscaled overlay. Claude Reads the overlay (the "teacher pass") and judges every box: does the label actually match what's inside the rectangle? Mismatches produce v2. Then ingest. The loop converges in 1–2 iterations because the teacher and student are the same model — there's no distillation gap to close, only a *self-consistency* gap.

This is structurally an On-Policy Distillation loop with N=1 expert:

$$\mathcal{L}_{\text{OPD}}(\theta) = \sum_i w_i \cdot D_{\text{KL}}(\pi_\theta \,\|\, \pi_{E_i})$$

In OPD, π_θ is the student and π_{E_i} are the experts. In our pipeline they're both Claude: the student is Claude generating a verdict from the raw image, the expert is Claude *grading* a verdict by inspecting an overlay. The KL surrogate is "did the teacher cross out any label." When the teacher stops finding mistakes, the verdict has self-converged.

The reason this still has value with N=1: the **teacher pass operates over a different input modality** (annotated overlay instead of raw image), which is enough to surface labeling errors the student pass missed. The overlay forces Claude to commit to a rectangle, then check the rectangle's content, which is a different cognitive act from open-ended captioning.

### The bbox convention — Thinking with Visual Primitives (TWVP)

Coordinates are normalized **0–999, top-left origin, `[x1, y1, x2, y2]` per bbox**. This is the format from DeepSeek's *Thinking with Visual Primitives* paper (2026.04). We can't use their model (DeepSeek-V4-Flash, 284B MoE), but the **output schema is portable** — any vision model can produce it. The SVG overlay on `ObservationPage` consumes the same coords, so once a verdict lands, the UI renders it without re-projection logic.

### Schema additions

Verdicts now carry three bbox-bearing arrays:

```json
{
  "components_seen": [{ "label": "...", "confidence": 0.0-1.0, "bbox": [x1,y1,x2,y2] }],
  "damage_localized": [{ "label": "...", "severity": "...", "bbox": [...] }],
  "text_regions": [{ "text": "...", "bbox": [...] }]
}
```

`damage_localized` is for callouts where the *location* matters (rust patch on this fender, not the whole vehicle). `text_regions` is for visible text in the photo (caliper scale readings, brand labels, receipts, data plates). Both are optional but high-value when present — they're the difference between "there is rust" and "there is rust at this specific bbox."

### The harness

Three artifacts make the loop tractable:

- `scripts/deep-image-analysis-byok.mjs` — the canonical ingest tool. Reads a JSONL of verdicts, updates `vehicle_images.ai_scan_metadata.byok_deep_analysis`, emits a `kind='condition'` `vehicle_observation` with `structured_data.analysis_kind='image_deep_byok'`, and links a primary `observation_witness`. Idempotent per-image (latest write wins on the metadata slot).
- `/tmp/dia/k5/_bbox_annotate.py` — renders the bbox overlay used for the teacher pass. Downscales to 1024 on the long side and draws colored rectangles with numbered labels (green=component, red=damage, blue=text).
- `/tmp/dia/k5/_loop.sh` — driver. Subcommands: `resolve <8-char prefix>` → full UUID + image URL, `dims <prefix>` → aspect-ratio check, `annotate <prefix> <ver>` → render overlay, `ingest <prefix>` → ship final verdict.

A session-resumable workflow for the K5 backlog:

```bash
PREFIX=abc12345
bash /tmp/dia/k5/_loop.sh resolve $PREFIX   # confirms it's a K5 image, gets URL
# Claude Reads /tmp/dia/k5/imgs/$PREFIX.jpg
# Claude writes /tmp/dia/k5/work/$PREFIX/verdict_v1.jsonl
bash /tmp/dia/k5/_loop.sh annotate $PREFIX v1
# Claude Reads /tmp/dia/k5/work/$PREFIX/annotated_v1.jpg
# Claude judges + writes /tmp/dia/k5/work/$PREFIX/verdict_final.jsonl
bash /tmp/dia/k5/_loop.sh ingest $PREFIX
```

### Why the `kind='analysis'` enum value still doesn't exist

The original chapter said deep analysis writes `kind='analysis'`. That enum value never got added — the migration tooling is desynced and `supabase db push` refuses to advance until the local/remote migration histories are reconciled. **Workaround:** we write `kind='condition'` and disambiguate via `structured_data.analysis_kind='image_deep_byok'`. Both the analysis-stream page (`/vehicle/:id/analysis-stream`) and `ObservationPage` filter on this combination, so the substrate behaves correctly. Backfill is trivial once the enum lands.

### The Live Analysis Stream

`/vehicle/:vehicleId/analysis-stream` subscribes to Postgres changes on `vehicle_observations` filtered by vehicle_id + the analysis_kind discriminator. When an ingest writes a new atom, the page receives a Realtime INSERT event, the new card slides in with a "● JUST LANDED" badge for 4 seconds, and the underlying thumbnail loads from `optimizeImageUrl(image_url, 'small')`. Useful for watching backlog grinds, but also the cleanest possible demo of the 5-layer substrate: blob → testimony → canonical row → witness link → trust-source — all five mutating in real time.

### What this enables

Once an image has a bbox-bearing verdict, downstream UI can:
- Highlight specific components in a tour ("here's the brake rotor, here's the spindle")
- Cluster images by *which component* they show (every photo where bbox-label includes `wheel_hub_face`)
- Detect part lifecycle ("here's `vented_brake_rotor_new` on date X, here's `used_brake_rotor` on date Y — same wheel station, different states")
- Drive a parts-inventory join: bbox label → supplier catalog → "the K5 needs this PN if the rotor in image abc is replaced"

That last point closes the loop with the supply-side rules (`docs/library/intellectual/contemplations/the-supply-side.md`): demand-side observations (this image shows component X in state Y) join to supply-side catalogs (PN matches X) to compute the gap.

---

## The coverage layer & canonical adjudications (Phase 1, 2026-06-17)

The pipeline had four disagreeing "analyzed" markers, four schema generations, and no
single coverage number — so progress was unmeasurable and the coordinator brief lied
(it counted `ai_scan_metadata->appraiser->primary_label`, a key NO writer emits, so it
always read **0 analyzed**). Migration `20260617000000_image_analysis_coverage_rpc.sql`
crowns one model. These decisions are canonical; do not fork them.

### Personal corpus = `is_external=false` (NOT `source='user_upload'`)
`user_upload` is only ~1 of ~9 personal source slugs (the K5 alone spans `user_upload`,
`iphoto`, `ssd_blast`, `hd_archive`, `drop-folder`, `photo_auto_sync`,
`capture_relay_ios`, `external_import`, `bat_import_mirrored`). Scoping coverage to
`user_upload` undercounts personal photos by ~70% and is why the fleet enumeration kept
missing iphoto/ssd-only vehicles. **All coverage is `is_external=false`.**

### The one tier ladder (the per-image depth model — never invent a fifth)
- **T0 GATED** — `vehicle_images.vision_gate_status='approved'`
- **T1 SEEN** — `ai_scan_metadata ? 'byok_deep_analysis'` (a deep BYOK verdict exists)
- **T2 PLACED** — an active `image_observations` row exists (search/convergence engine);
  **+CLIP** when it carries `embedding_clip_vitb32`
- **T3 CONNECTED** — the cascade fired (technician/equipment/consumable/parts evidence) — Phase 5
- **T4 CONFIRMED** — the image's day `work_sessions.owner_confirmed_at` is set (the value gate)

`analysis_depth_score(0–1)` (`nuke_image_depth_score`) blends tier attainment with verdict
richness (context_complete, intent_confidence≥0.6, components present, not-stale). It is
the rank-order key for the backlog and the fuel for the timeline illumination (Phase 6).

The **canonical "deep-analyzed" marker** is T1 (`analysis_kind='image_deep_byok'`), which
rides on `kind='condition'` + `structured_data.analysis_kind` until the `kind='analysis'`
enum lands (see the desync note above). The `appraiser->primary_label` marker and the
listing-side Decode/Observe/Deliberate/Sign four-tier are **demoted** — the latter is
listing-field justification, a different axis from image depth.

### Reading coverage (per-vehicle and indexed — never a 38.9M scan)
`vehicle_images` is 38.9M rows; any corpus-wide `count(*)` or jsonb aggregate times out on
the pooler (W5). Every function is scoped to one `vehicle_id` (indexed) or sums a
per-vehicle counter table:
- `get_vehicle_analysis_coverage(vehicle_id)` / `get_day_analysis_coverage(vehicle_id,date)`
- `image_coverage_by_vehicle` counter table + `refresh_image_coverage(vehicle_id)`
- `get_fleet_analysis_scoreboard()` — the one-line scoreboard (sums the counter, never scans)

The ralph-wiggum coordinator brief now reads `get_fleet_analysis_scoreboard()`, so the
brief, the RPC, and the vehicle-profile UI all show the same number. First honest
scoreboard (2026-06-17): corpus 29,063 · gated 17,587 · seen 8,632 (49% deep) · placed
856 (4.9% engine) · CLIP 111 · confirmed 0 · stale 5,840 · inflow 115/7d · seen 14/7d.

### The fleet driver is no longer pinned (W1)
The launchd plist hardcoded one (drained) K5, so the cron logged "drained" every fire and
never touched the fleet's 9,000+ gated-but-unseen frames. `byok-fleet-next.mjs` now ranks
candidates (inflow-first, then biggest backlog) from the counter table and
`byok-fleet-batch.sh` drains one bounded batch per fire, self-advancing past drained
vehicles. State lives in the DB (counter + prepare's live queue), so it is idempotent and
resumable — killing it mid-fire loses nothing.

### Why the cascade arms 3–5 are still empty — it's entity resolution, not wiring (2026-06-17)

`process-photo-cascade.mjs` "wrote 3 rows ever" not because it's unwired but because arms
3–5 require **resolved org-entity IDs the BYOK verdict does not produce**:
- ARM3 `technician_work_evidence` needs `person_visible.technician_id`
- ARM4 `equipment_usage_evidence` needs `tools_visible[].equipment_id`
- ARM5 `consumables` needs `consumables_used[].consumable_id`

The deep verdict observes *that* a person/tool/substance is present (`presence`,
`workshop_signals`) but does not resolve them to entities. So "wiring the arms" against the
verdict just makes them skip (no IDs). The missing layer is the doctrine I keep forgetting —
*everything is an entity with observed service provenance* (`feedback_everything_is_an_
entity_with_service_provenance`): person/equipment/consumable must resolve/create through the
organizations→services→observations path, not a hardcoded registry. **That resolution layer
is the actual Phase-5 work, and it is a sub-system, not a wire.**

And ARM3/ARM5 feed **labor → value**. Auto-creating technician work-evidence from "a person
is visible in a photo" is exactly the class of error behind the $410-text-to-dad incident
(`feedback_photo_intent_must_be_confirmed_not_assumed`): value accrues ONLY from owner-
confirmed labor; `intent_confidence < 0.6 ⇒ needs_clarification`; `work_sessions` stay
`owner_confirmed_at = NULL` until the human signs. So the value arms are owner-gated by
design — they must surface evidence as **unconfirmed**, never auto-accrue. The micro-atoms
the verdict already captures (`components_seen`, `workshop_signals`, `presence`) are
preserved in `ai_scan_metadata.byok_deep_analysis` + the vehicle_observation's
`structured_data`, ready for that resolution pass to consume — the data isn't lost, the
resolver is what's unbuilt.
