# Chapter 19: The Extraction Contract (schema-as-decision-tree)

## Why this chapter exists

`vehicle_images` has **162 columns**. On a real vehicle (the 1966 Mustang test case,
2026-06-22) only ~15 are meaningfully filled; the rest are **dead duplicates** or
**unfed load-bearing fields**. "Fill all the schema fields" is the stated goal — but it
is the wrong goal stated against this table, because half the columns are redundant and a
handful of the important ones have no extractor feeding them.

This chapter defines the **canonical extraction contract**: the real, minimal set of
fields each image should carry, *where each comes from*, and the **decision tree** that
says which fields apply to which image. It is the spec the analyzer fills, the dedup map
for the 130 junk columns, and the acceptance test for "the pipeline works."

The mental model the owner gave: the schema is a standardized request — an **if-then tree**
(if this is a data plate, then read the VIN; if an engine bay, then read the block/heads)
— not "describe the picture." Captioning is freeform and unscoreable; a contract is
checkable: every applicable field is either filled or explicitly `unknown`.

---

## The three sources of a field

Every canonical field is filled from exactly one of three sources, cheapest first. The
pipeline must try them in order; vision is the *last* resort, not the first.

1. **Capture (free, deterministic).** Already in the file or the upload: `taken_at`
   (EXIF DateTimeOriginal), `latitude`/`longitude` (EXIF GPS), `camera`/`device_fingerprint`
   (EXIF Make/Model/serial), `mime_type`, `file_size`, dimensions, `upload_batch_id`.
   *Never* spend a model on these. (As of 2026-06-22 the drain did not even read EXIF —
   dates were null fleet-wide; see Ch.16/18.)
2. **Derived (free, compute-only).** Computed from pixels with no model: `phash`/`dhash`
   (perceptual hash → dedup + burst detection), blur/sharpness, dominant color,
   resolution class. These gate everything downstream (a blurry burst-duplicate should
   never reach a paid model).
3. **Vision (paid, conditional).** Only the fields a model must judge: `scene_type`,
   `build_phase_guess`, `components_seen`, `text_regions` (OCR), `state_observations`,
   `camera_pose`, `narrative_one_line`, `intent`. These are gated by the decision tree
   below so we never ask for engine fields on a document.

The cost work (Ch. cost notes) showed the model call is the expensive step; sources 1–2
must do as much as possible so source 3 runs on the fewest images with the smallest prompt.

---

## The decision tree (what to extract, conditioned on what it is)

`scene_type` is the discriminator. It is cheap to get (a tiny first-pass classifier) and
it decides which expensive fields are even asked for:

```
every image →  capture fields (1) + derived fields (2) + scene_type + is_vehicle?
  ├─ not a vehicle / personal / document-of-people → STOP. image_vehicle_match_status='unrelated'. no vehicle vision.
  ├─ scene_type = data_plate | vin | receipt_document  → text_regions/OCR is PRIMARY (VIN, serial, part #, price, date). minimal component pass.
  ├─ scene_type = body_exterior                         → camera_pose (framing/angle/distance), paint_state, completeness, hero_score inputs.
  ├─ scene_type = engine_bay                            → components_seen (block, heads, intake, carb...), part_number_guess, casting OCR.
  ├─ scene_type = undercarriage                         → components (frame, axle, suspension), rust_severity, damage_localized.
  ├─ scene_type = interior                              → components (seats, dash, gauges), completeness.
  └─ scene_type = shop_context | off_property           → presence, place_hint (GPS-resolved). low component effort; often a session anchor, not a subject.
```

The point: a document gets OCR, not a carburetor hunt; an exterior gets pose+paint, not a
fastener inventory. Same model, different *contract slice*, so tokens are spent only where
the field can exist.

---

## The canonical fields (the real contract)

| field | source | applies to | today |
|---|---|---|---|
| `taken_at` | capture (EXIF) | all | fixed 2026-06-22 (was null) |
| `latitude`/`longitude`/`location_name` | capture (EXIF GPS + legend) | all w/ GPS | partial (iOS only) |
| `device_fingerprint` | capture (EXIF) | all | partial |
| `upload_batch_id` | capture (upload) | all | **0% — unfed** |
| `phash` (+ `dhash`) | derived | all | **0% — unfed (this chapter builds it)** |
| `is_duplicate`/`duplicate_of` | derived (phash) | all | **0% — unfed** |
| `image_hero_score` (computed) | derived (from vision pose) | exterior | live (migration 20260622050000) |
| `scene_type` | vision (cheap pass) | all | in JSONB |
| `image_vehicle_match_status` | vision/classifier | all | partial |
| `work_session_id` | derived (taken_at+device+gps cluster) | all | **18% — barely fed** |
| `components_seen` | vision (conditional) | engine/undercarriage/interior | in JSONB |
| `text_regions` (OCR) | vision (conditional) | data_plate/document | in JSONB |
| `camera_pose` | vision (conditional) | exterior | in JSONB (dead column) |
| `state_observations` | vision (conditional) | most | in JSONB |
| `narrative_one_line` | vision | all | live |
| provenance (`agent_model`,`agent_cost_cents`,tokens) | harness | all | fixed 2026-06-22 (cost capture) |

Everything else in the 162 columns is one of: a **dead duplicate** (`filename`+`file_name`;
`category`+`image_category`+`image_type`; `vehicle_make/model/year/vin` columns that
identity already lives for on the vehicle record; four hash columns where one is
canonical; five quality scores where `image_hero_score` is canonical), or **scaffolding
for a stage that never ran** (`fabrication_stage`, `surface_coord_u/v`, `yono_queued_at`).
Those are consolidation/deletion targets, not fill targets.

---

## Dedup is burst-collapse, not library-halving (correction, 2026-06-22)

A perceptual-hash probe disproved the assumption that the HD-archive and iOS capture-relay
copies are the same photos double-stored: across a 36-frame sample there were **zero**
cross-copy matches. The two are largely **distinct shoots** (2024 build originals vs later
captures). So dedup's job is **within-burst collapse** — the 5 near-identical frames of one
moment where only the best should anchor the cover/gallery (the "last-of-burst not
best-of-set" problem) — plus catching genuine re-uploads. Worth doing (fewer redundant
paid analyses, cleaner galleries, a real burst→representative signal), but it is **not** a
2× cost cut. Be precise about this when costing a rerun.

---

## Acceptance test ("does the pipeline work")

For a vehicle, the contract is met when, for every non-superseded image:
1. capture fields are filled wherever the file carries them (no null `taken_at` on a dated file);
2. `phash` is set and the image is either a burst representative or flagged `is_duplicate`;
3. `scene_type` + `image_vehicle_match_status` are set;
4. the **applicable** vision fields for that `scene_type` are filled or explicitly `unknown`;
5. provenance records the model + real per-image cost.

That is a checkable definition of "filled ALL possible schema fields" — *possible* meaning
*applicable under the decision tree*, not all 162 columns.
