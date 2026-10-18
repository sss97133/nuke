---
id: 2026-09-29_part-models-cad-m130-sample
change_type: research
scope: docs/wiring/calc-data/cad/fab/ (M130-A.py, k5cad.py, render_part.py, index_v5.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "need the product footprints from view you're doing... things need to be to size and color" / "the fabricator obviously needs instructions on how the parts will be made" / "I should see something if it's considered in a polished state" (2026-09-29; the last two relayed by the pieces lane)
---

# Every piece as true-size CAD: the tooling and the one polished sample (MoTeC M130)

## What changed
- `cad/fab/k5cad.py` holds the shared helpers. Every dimension is a `Dim(value, source, basis)`.
  - Basis is maker (printed by the maker), scaled (measured off the maker's drawing at its printed scale), design (our
    clearance) or assumed.
  - It writes the STEP with every dimension and its source in the header, and a Y-up glTF binary (metres, faces
    merged, no Draco).
  - It draws a third-angle SVG from the model's own edges, with dimensions coloured by basis.
- `cad/fab/M130-A.py` is the MoTeC M130 (part 13130) with both plugs (endpoints M130-A and M130-B).
  - It has the case, the 3 × Ø5.2 holes with their Ø13 washer lands, the connector housing with its 18° side draft
    and R5 blend, and the label recess.
  - It has both Superseal 1.0 headers with their 34 + 26 pins and the latch ramps on the front side.
  - It adds a keep-out below the plugs: 0–60 mm is the minimum, 60–80 mm the budget.
  - 19 build-time checks measure the solids against MoTeC's printed numbers, and all pass.
- `cad/fab/render_part.py` makes a studio render in headless Blender (hero, clearance, photo-match). Its light level is
  calibrated so the case renders at the photo's #2d2e2f.
- `cad/fab/index_v5.py` writes `catalog/part_models.yaml` (the audit index) and `public/wiring/part-models/index.json`
  (for the layout page) from the part scripts.
  - It fails on an unsourced dimension, an unknown basis, a colour without its source, an endpoint that isn't in
    mounts.yaml, a failed check, or a 32+ hex run.
- No STEP, GLB, image or PDF is committed. They build to `~/k5-harness-pull/parts/`.

## Sources
- MoTeC datasheet 13130 (6 June 2014): p.3 Dimensions and Mounting, and p.2 Physical.
- MoTeC M1 ECU Hardware (7 Nov 2013) p.42 has the same drawing.
- TE customer drawing 2-1437285-3 sheets 1–2: the Superseal 1.0 34-way and 26-way plug housings, 3 mm pin pitch, and
  rows at 3.5 / 4 / 3.5.
- receipts/2026-06-09_as-built-photo-survey-corrections.md for the 60–80 mm clearance below the plug faces.
- MoTeC's product photo (large_m130) for the colours. The branding is not reproduced.

## Findings
- The 18° on MoTeC's p.3 is the connector housing's side draft in the bottom view.
  research/2026-06-09_design-inputs-recon.md reads it as an "18° connector exit". The plugs exit straight down, and the
  60–80 mm budget below them still stands.
- MoTeC's own photo agrees with the drawing's 5.6 mm header height: measured at the photo's scale, the headers stand
  about 6.9 mm below the housing. That is the printed 5.6 plus the 1 mm step in the bottom edge.

## Unknowns (in the part, not guessed)
- The Key 1 rib geometry inside the headers: no drawing on file. The latch side is modelled.
- How far the plug slides over the header when mated: TE doesn't dimension it, so the plug is drawn seated at the face.
- The pin colour: the pins are not visible in the photo.
- Of the 43 dimensions, 24 are printed by MoTeC or TE, 15 are scaled off MoTeC's drawing (shown orange), 2 are assumed
  (shown red: the shroud wall and the label recess depth) and 2 are our clearance (green).
