# The Observation–Projection Boundary

**Status:** Live contract (load-bearing)
**Cited by:**
- `supabase/functions/_shared/cockpit/types.ts` (`ResultKind` definition, ~line 11)
- `supabase/functions/_shared/cockpit/attribute-registry.ts` (`result_kind` field, ~lines 5, 81–87)
**Enforced by:** `attribute-registry.ts` (`AttributeDefinition.result_kind`); the cockpit `project()` path stamps `projection_event.result_kind` from the registry, not from the caller. A walk-in adapter that misdeclares is rejected with `BoundaryViolationError`.

---

## The one distinction

Every fact Nuke records about a subject is exactly one of two kinds. The type lives in `types.ts`:

```ts
export type ResultKind = "substrate" | "projection";
```

- **`substrate`** — a *direct measurement on the captured artifact*. The artifact is the thing in hand: this image, this VIN, this title document, this row of the graph. A substrate fact is something you read **off** the artifact without reasoning about the world beyond it.
  - *Examples:* "two doors are visible in this frame"; "the EXIF latitude is 32.22"; "the door-jamb plate reads engine code C"; "there is an odometer showing 84,102 in this photo."

- **`projection`** — an *inference about the world*. It uses the artifact as evidence but asserts something the artifact does not literally contain — an identity, a relation, a rank, a state of the world the photo only implies.
  - *Examples:* "this vehicle is a 1977 K5 Blazer"; "its condition relative to peers is p65"; "this image most likely belongs to vehicle X"; "the car was repainted black at some point."

The boundary is the line between *what the artifact shows* and *what we conclude about reality from it*. It is not a confidence distinction (a projection can be near-certain) and not a modality distinction (both can come from an image). It is an **epistemic** distinction: measurement vs. inference.

## Why the line is drawn here, not elsewhere

The registry's verbatim doctrine (`attribute-registry.ts:81–87`):

> `'substrate'` = direct measurement on the captured artifact (a vehicle has two doors visible in this frame; the EXIF lat is X).
> `'projection'` = inference about the world (this vehicle is a 1977 K5 Blazer; its condition relative to peers is p65).
> Walk-in adapters that misdeclare get rejected with `BoundaryViolationError`.

Three things ride on this line:

1. **Recency semantics differ.** A substrate measurement is true *of the artifact* forever — the photo will always show two doors. A projection about *present state* (current color, current disposition) must be recency-weighted by **capture time** so the latest era beats a stale one. The registry's `temporal` field (`present_state` vs `timeless`) only makes sense once you have already split measurement from inference. (See `attribute-registry.ts:121–127`.)

2. **Truth-resolution differs.** Substrate atoms corroborate by agreement on a fact of record (two callers reading the same plate should agree). Projections corroborate by *dialectic* — multiple inferences are weighted by caller trust × confidence and the consensus is computed, with contradictions surfaced rather than silently resolved. The read path (`get_subject_atoms`, `project_attribute`) treats the two kinds differently.

3. **The audit envelope is honest about uncertainty.** `projection_event.result_kind` records which kind every atom is, so a downstream consumer can tell at a glance whether it is reading a measurement or an inference. A measurement laundered in as a projection (or vice-versa) corrupts that signal.

## What the registry already encodes

Each `AttributeDefinition` carries a hard-coded `result_kind`. Reading the live registry, the split is consistent:

| Attribute | `result_kind` | Why |
|---|---|---|
| `image.has_vehicle`, `image.vehicle_bboxes`, `image.ocr_regions` | `substrate` | Read directly off the pixels. |
| `vehicle.viewpoint`, `vehicle.vin_visible`, `vehicle.plate_redacted` | `substrate` | What the frame literally shows. |
| `vehicle.exterior_color`, `vehicle.current_color`, `vehicle.condition_cues`, `vehicle.odometer_reading` | `substrate` | Measured off the panels/gauge in *this* photo. |
| `vehicle.year_range`, `vehicle.make`, `vehicle.model`, `vehicle.modifications` | `projection` | Identity/departure-from-stock — concluded about the world. |
| `vehicle.refinish_event` | `projection` | An inference *about a change* in the world (`attribute-registry.ts:585–589`). |
| `image.likely_vehicle_id` | `projection` | Linking this image to a known chassis is a world-claim, not a pixel reading. |
| `cluster.work_transition`, all `make_model.*` | `projection` | dT inference / cohort statistics — never visible in a single artifact. |

Note the deliberate subtleties:

- **Factory-spec facts** (`vehicle.horsepower`, `vehicle.torque`, `vehicle.displacement`) are marked `substrate`, not `projection` — because they are *read off the VIN decode rule*, which is the artifact in that case. The VIN-decode is a measurement on a record; it is not an inference about the world. The boundary is about *what you measured*, and a decode table is a thing you measure against. This is also why these attributes' admissible evidence excludes `image` (a photo can't show horsepower) — see the **anti-laundering** rule below.
- **`vehicle.original_color`** is `substrate` (read from a Marti report / door tag — a document artifact), while **`vehicle.refinish_event`** that links original→current is `projection` (an inferred state-change). Same color domain, opposite sides of the boundary, because one is read off a document and the other is concluded.

## How the boundary is enforced

The boundary is **declared in the registry, never trusted from the caller.** The flow:

1. A caller submits an answer via `submit_attribute_value` (see `cockpit-unified-interface.md`).
2. The connector looks up the `AttributeDefinition` by name and reads `def.result_kind`.
3. It stamps `projection_event.result_kind = def.result_kind` — the *registry's* declaration, not the caller's claim (`mcp-connector/index.ts:2697`).

A walk-in adapter cannot relabel a projection as substrate to dodge dialectic weighting, nor pass off a measurement as an inference. If an adapter's own declared `result_kind` disagrees with the registry's, that disagreement is a `BoundaryViolationError` — the registry is the single source of truth for which side of the line an attribute sits on.

### Relation to the anti-laundering (evidence-class) rule

The boundary pairs with, but is distinct from, the evidence-class gate (`attribute-registry.ts:32–58`, `validateEvidenceClass`). The evidence-class rule asks *"may this class of evidence cite this attribute?"* (a photo may not cite horsepower). The substrate/projection boundary asks *"is this fact a measurement or an inference?"* A claim must pass **both**: the right *kind* of fact, backed by an *admissible* class of evidence. Together they make it structurally impossible to launder a high-tier inference behind a low-tier measurement's citation.

## The done-test

A fact is on the **substrate** side iff you could establish it by pointing at the artifact and reading, with no claim about anything outside the frame. The moment you assert an identity, a relation, a rank, a change-over-time, or a state of the world the artifact merely implies, you are on the **projection** side, and the registry must say so.
