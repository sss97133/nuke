# Image-to-Atom Taxonomy (L1–L5)

**Status:** Live contract (load-bearing)
**Cited by:** `supabase/functions/_shared/cockpit/attribute-registry.ts` (~lines 24, 89; the `layer` field 1–5)
**Discovery sources** (the pre-existing extractors this taxonomy was distilled from, per `attribute-registry.ts:20–26`):
- `validate-vehicle-image` — image_type taxonomy + content detection
- `identify-vehicle-from-image` — year / make / model / trim / body_style
- `api-v1-vision` `/classify` and `/analyze` — make hierarchy, condition_score, zone, damage

---

## What the taxonomy is

A single photograph is a **butterfly node** — one capture that fans out into ~20 distinct facts (see encyclopedia ch. 5, *Image as Butterfly Node*). The L1–L5 taxonomy is the **ordering** of that fan-out: it sorts every extractable atom into five layers such that *lower layers must be answered before higher layers can be*. The registry encodes the layer on every attribute:

```ts
// The L1–L5 layer per image-to-atom-taxonomy.md.
// Lower layers must be answered before higher layers can be (e.g. L3 color
// depends on L2 vehicle bbox per layer-dependencies.md).
layer: 1 | 2 | 3 | 4 | 5;
```

The taxonomy is a **dependency ladder, not a priority list**. A higher layer is not "more important" — it is "downstream." You cannot extract a vehicle's color (L3) before you know where the vehicle is in the frame (L2), and you cannot bound the vehicle (L2) before you know a vehicle is present at all (L1). The layer number is the position in that causal chain.

This is what lets the harness hand a caller agent a checklist *in dependency order* (`getChecklist` → `topoSort`), so the caller never tries to read paint off a frame that has no car in it.

## The five layers

Distilled directly from the attributes the live registry assigns to each layer.

### L1 — Detection
*"Is there a vehicle, and where is the readable content?"* Nothing higher works without it.

- `image.has_vehicle` — is at least one vehicle physically in the frame?
- `image.classification` — exterior / interior / engine_bay / undercarriage / detail_part / documentation / in_progress / scene_context / ui_element / unrelated.
- `image.vehicle_bboxes` — a normalized 0..1 box per visible vehicle, largest first.
- `image.ocr_regions` — every readable text region (vin / plate / odometer / sign / gauge / badge / document_text).

All four are `result_kind: substrate` — read straight off the pixels. (Provenance: the `image_type` taxonomy of `validate-vehicle-image`.)

### L2 — Identity
*"What IS the vehicle?"* Depends on L1's detection + boxes.

- `vehicle.viewpoint` (substrate) — pose of the largest vehicle (front_three_quarter / profile_left / undercarriage / …).
- `vehicle.year_range`, `vehicle.make`, `vehicle.model` (projection) — generation cues → identity. (Provenance: `identify-vehicle-from-image`.)
- `vehicle.vin_visible`, `vehicle.plate_redacted` (substrate) — read off OCR regions; the plate is *redacted to a bbox*, never transcribed.

L2 is where the `substrate`/`projection` line is most visible inside one layer: viewpoint and VIN-read are measurements; make/model/year are inferences. See `observation-projection-boundary.md`.

### L3 — Attributes
*"What are the vehicle's properties?"* Depends on the L2 vehicle bbox (and viewpoint, for color).

- Present-state, image-read: `vehicle.exterior_color`, `vehicle.current_color`, `vehicle.condition_cues`, `vehicle.odometer_reading`.
- Document/decode-read (a photo *cannot* show these): `vehicle.horsepower`, `vehicle.torque`, `vehicle.displacement`, `vehicle.seat_count`, `vehicle.original_color`, `vehicle.title_status`, `vehicle.title_state`, `vehicle.sale_disposition`, ownership/location facts.
- Inference: `vehicle.modifications` (departures from factory spec). (Provenance: `api-v1-vision /analyze` — condition_score, zone, damage.)

L3 is the layer where the **evidence-class gate** does most of its work: the spec facts list `vin_decode | document | owner_claim` as admissible, never `image`, so a photo-cited horsepower claim dies at L3.

### L4 — Context
*"What's the situation around the vehicle?"* Depends on L1–L3 + EXIF + corpus.

- `vehicle.refinish_event` (projection) — links original→current color as a state-change.
- `image.location_class` (projection) — shop / driveway / auction_lot / barn_find_site / … (uses EXIF + scene).
- `image.in_progress_work` (substrate) — the task being performed (disassembly / repair / paint / reassembly), with tool/evidence bboxes.

### L5 — Linking & Synthesis
*"How does this connect to the rest of the graph?"* Depends on L1–L4 + cross-image corpus.

- `image.likely_vehicle_id` (projection) — bind this image to a known chassis; null below the 0.80 entity-resolution auto-match threshold.
- `cluster.work_transition` (projection) — the dT diff across two consecutive `work_sessions`.
- Compound projections — `vehicle.invoice_artifact`, `vehicle.work_log_artifact`, and the `make_model.*` cohort statistics are *nominally* L5 (synthesis over many atoms). Their layer is nominal: they are produced by deterministic-SQL adapters, not walk-in vision callers, but live in the registry so they are discoverable via `get_attribute_checklist`.

## The invariant

The taxonomy guarantees: **for any subject, the checklist returned by `getChecklist` is topologically sorted so that every attribute appears after the attributes it depends on.** The layer field is the coarse ordering; the per-attribute `depends_on` is the fine ordering. A caller iterating the list in order never asks an upstream question after a downstream one. The hard dependency edges that cross layers (e.g. L3 `exterior_color` → L2 `vehicle_bboxes`) are specified in `layer-dependencies.md`.

## Why five and not more

The layers are not arbitrary granularity — they are the four natural cut-points in "from a raw photo to a graph-linked fact": **is something there** (L1) → **what is it** (L2) → **what is it like** (L3) → **what's going on around it** (L4) → **how does it connect** (L5). New attributes extend a layer indefinitely (the long tail — paint chemistry, weld pattern, period-correctness) without adding a sixth layer, exactly as the registry header intends: *"the registry is structured so the long tail can extend indefinitely without changing the cockpit interface."*
