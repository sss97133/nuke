# The Reciprocal-Confirmation Engine — threshold-triggered BYOK group analysis

> **Status:** architecture, grounded in the cheap-data study + the engine study (2026-06-25).
> The market-differentiator: analysis *within a confirmed group* so critiques are
> **specific** (this truck, this 289) not generalized, and images **cross-confirm and
> compound** until a fact is owner-grade. This doc is the durable structure; it mostly
> WIRES two existing halves together + adds one new bridge.

## The thesis (Skylar, 2026-06-25)
Confirm the vehicle→profile FIRST. Then analyze *inside* that confirmed group, schema-aware,
so a verdict is a specific critique of a known thing. Facts cross-confirm: a VIN plate reads
**engine 289** (a hint) → an engine-bay image *shows* a 289 → they confirm each other → more
images compound → reciprocal confirmation → the **expertise layer** (telling a 289 from a 302
by small details). That compounding, owner-grade specificity is what secures the market.

## The two halves that already exist (reuse — do NOT rebuild)
1. **The BYOK image loop** — `scripts/daily-receipt/byok-image-batch.sh` + `deep-image-analysis-byok.mjs`:
   storage object → local temp file → `claude --print … --add-dir` reads it with the Read tool
   (BYOK subscription, `$0` at margin) → schema-validated verdict (`validateVerdict()`, the gate;
   a tourist caption is rejected) → writes `vehicle_images.ai_scan_metadata.byok_deep_analysis`
   + a `vehicle_observations` row + `observation_witnesses`. Sharded `--by-day` (the day is the unit).
2. **The consensus engine** — `project_attribute(subject_id, attribute)` (migration `20260615020000`):
   `weight = nuke_evidence_weight(class) × actor_trust × confidence × recency`; returns `consensus`,
   `consensus_support`, `corroboration = count(DISTINCT actor)`, `conflict`, and the candidate
   breakdown. `nuke_evidence_weight`: document/vin_decode 1.00, image 0.90, owner 0.45.
   `field_evidence` already has unused `supporting_signals`/`contradicting_signals` columns — the
   natural home for reciprocal edges.

## The bridge (NET-NEW) — verdicts → per-attribute claims
Today the BYOK verdict lands as **opaque JSONB**; the consensus engine never sees it as
**per-attribute claims**, so nothing compounds. The bridge does exactly one thing: decompose
each verdict's confirmable atoms into individual `(vehicle_id, attribute, value, evidence)` claims
that `project_attribute` can weigh and compound. The verdict contract IS the target list:
`scripts/schemas/byok-image-verdict.schema.json` — `components_seen[]` (label, part_number_guess,
bbox), `text_regions[]` (the VIN-plate / data-plate OCR channel), `state_observations`,
`workshop_signals`, `scene_type`, `build_phase_guess`, `camera_pose`. Each atom → a claim with
its source class (image_vision 0.90; a VIN-plate OCR text_region → vin_decode-grade 1.00 when it
fuzzy-matches a known VIN).

## The pipeline (the multi-pass)
- **Pass 1 — membership confirm.** A photo enters a group only when its session resolves to the
  vehicle: `session = one day at one GPS cell = one truck` (AttributionEngine), VIN-OCR match =
  DEFINITIVE, album = prior (overridden by content). Feature-print is NOT a decider (K10 ≈ GMC
  0.69). No-VIN, low-confidence → stays a *suggestion* (`auto_suggested_vehicle_id`), never a raw write.
- **Pass 2 — in-group extraction.** Run the BYOK loop on the CONFIRMED group's SOURCE images with
  the vehicle dossier as context (`buildContext()` already assembles identity + build timeline +
  GPS legend). Because the group is confirmed, the verdict critiques a *known* vehicle.
- **Pass 3 — reciprocal compound.** Bridge each verdict → per-attribute claims → `project_attribute`
  raises consensus as independent images corroborate (rising `corroboration`); contradiction lowers
  it / forks. A VIN-plate read + N engine-bay reads of "289" compound to owner-grade.

## The threshold (what triggers a group analysis)
A group is analysis-ready when it is **confirmed + dense enough to be worth a BYOK pass**: e.g. a
confirmed work-session (`dayCount`/`work_session`) with ≥ K images, or a vehicle whose orphan→bound
set crosses a count. Cheap signals gate it for free first (located+dated+Apple-labeled). Below
threshold → stays at the cheap T0 ledger; never burns BYOK on an unconfirmed or trivial group.

## Hard rules (carried from Skylar)
- **SOURCE images only.** Read the raw object (`vehicle_images.storage_path` / the public
  `image_url` which equals it), NEVER the rendered/derived `large_url`/`medium_url` transforms,
  and NEVER "work from the DB's processed images" as a shortcut.
- **File EXIF is truth.** Date/GPS from the file, never the corrupt cloud `taken_at` (PHAsset
  re-add date, ~6mo off).
- **Promotion is owner-signed.** Reciprocal confidence raises a claim toward owner-grade, but value
  accrual / canonical promotion still needs the owner (proven > attributed > projected; the $410
  intent gate at confidence ≤ 0.6 → needs_clarification). The engine STAGES; the owner confirms.
- **Honest rungs.** A fact shows the rung it has actually climbed (cheap → labeled → analyzed →
  confirmed), sourced from a real column with a count. No "in process," no implied progress.

## Reuse vs new (build ledger)
- **Reuse:** byok-image-batch.sh + deep-image-analysis-byok.mjs (the loop); project_attribute +
  field_evidence + nuke_evidence_weight (the math); AttributionEngine session-key (Pass 1).
- **New:** the verdict→per-attribute-claim **bridge**; the **confirmed-group** scoping + threshold;
  the reciprocal edge in `supporting_signals`; the in-app trigger/state.
