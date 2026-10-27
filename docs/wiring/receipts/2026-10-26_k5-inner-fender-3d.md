---
id: 2026-10-26_k5-inner-fender-3d
change_type: model
scope: nuke_frontend/public/models/k5-inner-fender.glb (new); docs/wiring/calc-data/cad/fab/inner_fender_blender.py
  (generator); nuke_frontend/src/components/wiring/map/scene3d.ts (one LAYERS entry, two hides moved). No wire, pin,
  database row or .blend file changed.
author: claude-opus-5-5 (k5-inner-fender-3d lane, sheet-metal modeling brief)
---

# K5 front inner fender drawn from reference photos (2026-10-26)

File: `nuke_frontend/public/models/k5-inner-fender.glb` (282,612 bytes; nodes `inner_fender_L`, `inner_fender_R`;
glTF Y-up of the twin, (X, Y, Z) = (x, z, -y), metres; one material, metallicFactor 0.2, roughnessFactor 0.45; no
Draco, no extras; the `chassis_frame.strip_and_scan` check passed). Generator:
`docs/wiring/calc-data/cad/fab/inner_fender_blender.py` (Blender 4.3, headless). MAP layer: `inner-fender` in
`map/scene3d.ts`. It takes over the `CTX-inner-fender-wall-*` hides from the `sheetmetal` layer. Until the core-support
and firewall files replace `k5-front-sheetmetal.glb`, that file still draws its own `inner_fender_*` boxes.

Status: **draft. The brief's 25 mm landmark gate is not met everywhere** (see the table). The rim arch and the mid-span
dome fit the photos. The front quarter of the dome and the panel's inboard width do not.

## Shape, and the photos each part of it comes from
The part is a wheelhouse tunnel. An arched rim on the outboard face bolts to the fender's wheel-opening lip. A roof
runs inboard and rises to a crest, then a fillet turns it into the engine-side wall, whose lower edge follows the same
arch. The rear end is the long holed leg and the front end is the short tail to the core support. Sources are
`scratchpad/sm/ref/inner-fender/bare/`: b_jegs_1 and b_jegs_5 (tunnel and rim), b_eckler_1 (rim arch, legs),
b_jegs_3 (rear leg) and b_oer_1 (top view, stamped bulge).

| param | value | basis | source |
|---|---|---|---|
| y_front | -2.505 | assumed +/-0.01 | core-support front face y -2.527, less the sheet |
| y_rear | -1.440 | assumed +/-0.02 | FR-88 cowl points y -1.43, firewall station -1.46 |
| rim arch | 30-point table | photo | b_eckler_1: lower edge of the silhouette per column, scaled by the y span |
| arch_k | 1.20 | fitted | b_eckler_1 is shot from about 30 deg above, so the rim drops are stretched to match |
| z_rim_apex | 0.980 | assumed +/-0.04 | tyre top 0.802 (wheel z 0.396 + r 0.406) plus travel and clearance |
| x_out | 0.858 | maker | FR-88 cowl pair 1715 / 2 |
| x_in | 0.400 | scaled +/-0.03 | **moved** from 0.510/0.545: OER box 18 in and the b_oer_1 width; the wall's bottom flange lands at 0.382, outboard of the rail web (0.360) |
| crown | 0.150 | fitted +/-0.05 | b_eckler_1 dome over rim (grid 0.10/0.15/0.22) |
| front_taper | 0.25 | photo | b_eckler_1 cols 800-950: the dome falls onto the front tail |
| fillet / wall / lip | 0.10 / 0.23 / 0.03 | photo | b_jegs_1, b_oer_1 highlight bands, b_jegs_7 |
| stamped bulge | 25 mm | photo, height assumed | b_oer_1, the "+" stamp |

Not modelled: ribs, holes, and the ribbed inboard flange in b_oer_1, along with any other detail no photo resolves.

## Camera matches
- b_eckler_1: orthographic, scale fixed by the y span (1.133 mm/px). Elevation, azimuth and shift came from a grid
  search on silhouette IoU against the non-white mask. Result: IoU 0.77, elevation 30 deg.
- b_oer_1: orthographic, scale 1.12 mm/px, near top-down (elevation 85 deg). IoU 0.83.
- Owner photo 022 (`scott-bay/022.jpeg`, square front view, hood up): pinhole with f fixed at 1155 px on a 1600 px
  frame (iPhone main camera, 26 mm equivalent). Pose was solved by Levenberg-Marquardt from five twin anchors: both
  headlamp centres (+/-0.78, z 1.052) and the core-support top bar corners and centre (+/-0.87, z 1.22). Reprojection
  RMS is 14.8 px. The headlamp residuals of 18 px suggest the twin's headlamp z sits about 25 mm off.

Overlays (50 % blend plus red model edges) and camera specs are in `scratchpad/sm/out/inner-fender/` and are not
committed. They contain vendor product photos and the owner's shop photo, and this repo is public.

## Landmarks
Pixel errors are converted at that view's mm/px.

| # | landmark | model | photo-derived | source | error |
|---|---|---|---|---|---|
| 1 | rim apex, fore-aft | y -1.922 | front axle centre y -1.896 (CF.FA_Y) | b_eckler_1 vs twin | 26 mm (independent check) |
| 2 | rim lower edge, cols 150-800 | silhouette | silhouette | b_eckler_1 | <= 9 px = 10 mm |
| 3 | rim lower edge at the front tail, cols 850-950 | silhouette | silhouette | b_eckler_1 | 9-36 px = 10-41 mm **(fail)** |
| 4 | dome top, cols 200-750 | silhouette | silhouette | b_eckler_1 | <= 24 px = 27 mm (borderline) |
| 5 | dome top, front quarter, cols 800-950 | silhouette | silhouette | b_eckler_1 | 111-239 px = 126-271 mm **(fail)** |
| 6 | rim-side edge, cols 100-900 | silhouette | silhouette | b_oer_1 | 10-30 px = 11-34 mm (fails at the ends) |
| 7 | inboard edge (panel width), cols 200-800 | silhouette | silhouette | b_oer_1 | 35-62 px = 39-69 mm narrow **(fail)** |
| 8 | crest hidden behind the core-support top bar | top rows 620 / 623 | bar top row ~600; no inner-fender sheet visible above it | owner 022 | passes, 20 px margin |
| 9 | outboard edge against the fender skin | x px 201 | fender inner skin ~190 px | owner 022 | ~11 px = ~20 mm |
| 10 | wall bottom flange against the frame-rail web | x 0.382 | rail web x 0.360 | chassis_frame params | 22 mm clearance (no interference) |
| 11 | bounding box | 1.065 x 0.506 x 0.549 m | OER box 48 x 23 x 18 in (1.219 x 0.584 x 0.457) | oerparts.com | the 0.506 x extent is over 18 in unless the part sits tilted in the box |

## Open
- The front quarter is unresolved. b_eckler_1 shows the dome falling onto a narrow tail. b_oer_1 shows full width
  there. Narrowing the width to match eckler lowered b_oer_1's IoU (0.82 to 0.79), so the model keeps full width.
  A straight-on view of the front end (bare/ or installed/) would settle it.
- The inboard width: b_oer_1 wants about 60 mm more, and the OER box wants about 50 mm less.
- The owner photo checks only occlusion and the outboard line, because the panel sits mostly behind the core support
  in 022. Owner photos 018-020 (bay from above) were not camera-matched. 057-059 show the cowl with the inner fenders
  off.
