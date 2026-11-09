# Vehicle fingerprint: filing and gating photos by what makes each vehicle different

Status: design note (not built). Author: Grok Bot for Skylar, 2026-11-09.
Lane: photo / library / gate code belongs to Codex; this note proposes, it does not change code.

## Problem

Filing and the gate decide "is this photo of this vehicle?" mostly from capture context
(album, folder, time, hash duplicates) and coarse class labels (exterior, interior,
document). That breaks whenever two similar vehicles share a shop, a drive, a phone or an
import folder. Example from today's cleanup (1987 GMC family):

| Record | What it really is | Traits that separate it |
|---|---|---|
| e0bcd7fe "1987 GMC V15 LWB" | regular-cab long-bed pickup | red over white/silver, chrome belt molding, rust at rocker and fender lips, red dash and red interior |
| 73085dcf "1987 GMC Suburban" (VIN ...509103) | 4-door Suburban | Apple Red over Doeskin Tan, tan interior and headliner, GMC Sierra Classic grille |
| b1fd848d "1987 GMC Suburban, Neon Blue" | 4-door Suburban | blue, heavy floor rust (2023-08-12 yard session) |
| b5a0c58a "1985 Chevrolet Suburban" | 4-door Suburban | red/tan with **Chevrolet** bow-tie grille (not GMC) |

Ten red/tan Suburban frames sat in the V15 pickup album, and seven sat on the Neon Blue
Suburban. A person separates them in seconds from body style, two-tone, interior color and
grille badge. The system should be able to make the same deduction.

## Idea

Each vehicle gets a **fingerprint**: a profile built only from its **confirmed** photos.

1. **Trait profile** (discrete, explainable):
   - body: style (pickup regular cab / crew / Suburban / Blazer), bed length, doors, roof
   - paint: base color, two-tone split and secondary color, stripes and decals
   - trim: grille and badge (GMC vs Chevrolet, Sierra Classic / Cheyenne / Silverado), moldings, mirrors
   - wheels and tires: wheel design and finish, tire type
   - interior: seat and dash color, upholstery pattern, headliner
   - condition marks: rust and dents by zone (rocker, fender lip, cab corner), primer, missing parts
   - aftermarket parts: lift, bumpers, racks, carburetors, lights
   Each trait carries: value, zone, confidence, the image ids that support it, and a time
   range (paint and parts change during a build, so traits are dated, not permanent).
2. **Embedding centroids per view**: mean CLIP embedding of confirmed frames for each view
   (front 3/4, side, rear, interior dash, engine bay, …), plus spread, so a new frame is
   compared with the same view of the same vehicle, not with the vehicle as a whole.
3. **Confusables list**: the other vehicles in the same owner's garage (and same shop/session)
   whose fingerprints are closest. Filing must beat these, not just pass a threshold.

## How it drives decisions

For a candidate photo P and vehicle V:

1. Detect P's view and read its visible traits (same extractor that builds the profile).
2. Score: per-view embedding similarity to V vs. each confusable, plus trait agreement.
   - A **hard contradiction** (pickup vs Suburban, GMC vs Chevrolet grille, red vs tan
     interior, blue vs red paint in the same build period) vetoes filing to V, whatever
     the context says.
   - Agreement on **distinguishing** traits (ones V has and its confusables don't) is the
     strongest positive evidence; shared traits count for little.
3. Combine with context (session, GPS, album, receipts). Context propagates a decision across
   a session only when the session's clear frames agree with one fingerprint; a session whose
   clear frames match two fingerprints is split frame by frame.
4. Outcome and audit: file, hold for review, or suggest a different vehicle, and always record
   the deciding traits (e.g. `{"veto":"body_style: suburban vs pickup","support":["interior: tan"]}`).

Uses:
- **Filing** (capture_sets / landing): pick the vehicle, or refuse the chunk with a reason.
- **Gate** (existing galleries): flag photos that contradict their vehicle's fingerprint and
  propose where they belong; this replaces most hand-viewed cleanup.
- **Cover**: prefer the frame closest to the vehicle's front-3/4 centroid.
- **Duplicate records**: two records with matching fingerprints and no contradiction are
  merge candidates; matching only on shared polluting images (e.g. the Bring a Trailer
  related-listings set) is not.

## Where it plugs in (existing tables and producers)

| Need | Existing piece |
|---|---|
| per-image embeddings, view label, visual signature | `image_observations` (`embedding_clip_vitb32`, `role`, `visual_signature`, `confidence_basis`; local pass `local_image_analysis_v1`, branch `photo-pipeline/local-image-analysis`) |
| view / angle | `image_angle_observations`, `vehicle_images.vehicle_zone` |
| condition marks by zone | `image_condition_observations` (descriptor, zone, severity) with `condition_taxonomy`; `component_conditions` |
| parts | `part_observation_evidence` (+ `catalog_parts.name_embedding`) |
| confirmed set to learn from | `vehicle_images.image_vehicle_match_status = 'confirmed'` and gate status not held/rejected |
| identity facts (VIN, colors, trim) | `vehicles` (year, make, model, trim, color, vin, body_style) |
| context | `vehicle_images` taken_at, latitude/longitude, upload_batch_id, source, file_hash / phash / dhash |
| gate actions and audit | `capture_landing_gate_check`, `hold_vehicle_images_for_review` / `revert_vehicle_image_review_hold`, `vehicle_image_gate_changes`, `photo_vehicle_mismatch_observation` |
| cover | `recompute_vehicle_primary_image` + `image_cover_rank` (PR #3206) |

New pieces (proposal):
- `vehicle_fingerprints` (vehicle_id, built_at, run_id, source image ids, period) and
  `vehicle_fingerprint_traits` (vehicle_id, trait_key, value, zone, confidence, support
  image ids, valid_from/valid_to). Rebuilt by a producer; never hand-edited.
- `vehicle_view_centroids` (vehicle_id, view, centroid vector, n, spread).
- A pure scoring function `fingerprint_match(image_id, vehicle_id)` returning score,
  vetoes and supporting traits as jsonb; the gate and filing call it and store its output in
  their existing audit rows.

## Guard rails

- Learn only from confirmed frames; a fingerprint built from a polluted gallery is worse than
  none. Rebuild after each cleanup run, and keep the run id so a revert also restores the
  prior fingerprint.
- Traits are dated: a red truck painted blue mid-build is one vehicle with two paint periods.
- Personal and sensitive photos are never used to build or show traits.
- Low trait coverage (few confirmed frames) means "hold for review", not "file".
- Local analysis only; no paid processing.

## First slice (small)

1. Build view centroids from `image_observations` embeddings for the garage vehicles that
   have confirmed frames.
2. Hand-seed the distinguishing traits for the 1987 GMC family above and check that
   `fingerprint_match` reproduces today's hand decisions (17 frames moved on 2026-11-09,
   runs `grok-garage-v15split-20261109` and `grok-garage-v15split-nb-20261109`).
3. Run it read-only over one owner's garage and compare its flags with the hand cleanup log.
