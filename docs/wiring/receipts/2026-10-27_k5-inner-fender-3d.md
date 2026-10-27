# K5 front inner fender skirts from the camera-solved spec (2026-10-27)

File: `nuke_frontend/public/models/k5-inner-fender.glb` (3.80 MB, 198,456 triangles, sha1 e7f8c6d8). Two parent
nodes, `inner_fender_L` (driver) and `inner_fender_R` (passenger), each with five meshes: `_tub`, `_rear_panel`,
`_front_panel`, `_front_tab`, `_ledge_ribs`. One material, `bare_primer` (base 0.18/0.18/0.19, metallic 0,
roughness 0.6, per the 10-27 brief for bare primer / EDP parts). Twin frame, glTF Y-up (X, Y, Z) = (x, z, -y), the
`k5cad.write_glb` turn; checked by re-importing the GLB: the crown-ridge landmarks sit 0.0 mm from the imported
surface. Generator: `docs/wiring/calc-data/cad/fab/inner_fender_sds.py`, headless Blender 4.3
(`Blender -b --factory-startup -P inner_fender_sds.py`). Two runs gave byte-identical GLBs. The generator reads no
image and no other model, and it writes `k5_inner_fender_landmarks.json` from its own geometry (58 entries; driver
side, plus two `R_` points). The MAP layer `inner-fender` stays `off: true`.

This replaces the 10-26 placeholder dome. That dome was 100-200 mm too low over the front half; it had no rear panel
at the cowl, and its inboard edge sat at x 0.380, inside the frame rail.

## What it is built from
Photos are named by Nuke `vehicle_images` id. The photo files stay outside this repo.

- **Camera solve.** Owner photos f6203444 and 069ba2a5 are solved together as one bundle with a5718305 and c1f5b457
  (SIFT, essential-matrix RANSAC, bundle adjustment, reprojection 0.7-1.5 px).
  - EXIF focal 26 mm equivalent, fx 3029 px.
  - Twin placement uses weak anchors: the support top-flange edges for scale (s 0.347 m per unit, +-4.6 %), the cowl
    studs for the x axis and origin (y -1.46 and z 1.270 are assumed), and the air-cleaner lid for up.
  - The absolute 1-sigma at the driver shelf is 60-80 mm.
- **The measured spec the generator is built to** (twin metres, sigma 60-110 mm):
  - Crown ridge at x 0.665. It is level at z 1.115-1.120 from y -1.92 to -2.40. It falls 17 mm by y -2.46 and 88 mm
    by -2.52. At the rear it falls 21 / 62 / 103 mm at y -1.74 / -1.62 / -1.50 (OER T70124 LH inboard elevation,
    scaled L 1.194 m, H 0.512).
  - Shelf hole H1 at (0.595, -2.153, 1.101), triangulated from f6203444 and 069ba2a5.
  - Wheel-centre section at y -1.935, taken from the USA1 16303 rear-view envelope (W 0.43).
  - Rim plane x 0.858 (FR-88 1715/2). Inboard edge x 0.428.
  - Rear panel at y -1.47, lowest point z 0.608.
  - Rail-ledge holes at y -1.563 / -1.894 / -2.264, z 0.70. Cup at y -2.242.
- **Other twin sources:**
  - Fender wheel opening, where the rim arch follows the lip: ray-cast of k5-blazer.glb. The opening top is at
    z 0.97-0.98 over y -2.25..-1.65, the front edge at y -2.335 and the rear edge at -1.47.
  - Frame rail outer face: `chassis_frame.params.json` `rail_profile` web_x + 6 mm.
  - Core-support end, from the 10-27 core-support generator: radiator face y -2.527, lower tie-bar shelf top z 0.738,
    radiator-post foot to z 0.776, end wall x 0.865-0.890.

## Elements built (driver; passenger mirrored except where noted)
| id | element | where it comes from |
|---|---|---|
| I1 | outboard rim wall in the x 0.858 plane, 25 mm flange under the shoulder following the fender opening, rolled bead, 9 bolt holes (8 mm) at equal pitch along the arch | rim plane FR-88; arch = k5-blazer opening; LH_2 hole count |
| I2 | crown shelf, level ridge z 1.12 over y -1.92..-2.40, front roll to 1.03, rear fall | solve I2 series |
| I3 | outboard shoulder into the rim (about R 100) | SEC_wc outboard envelope |
| I4 | inboard flank (steep, from the envelope table) and vertical lower band to x 0.428 at z 0.74 | SEC_wc inboard envelope, I4 |
| I5 | two longitudinal steps on the inboard flank, 8 mm, about 90 mm apart | LH t016, RH t013/t016 |
| I6 | front closing panel at y -2.522 with a notch over the radiator-post foot; 3 bolts through the front outboard wall into the core-support end wall | T124-1/-2, itgm 09/11 caption |
| I7 | LH cup blister on the lower band, 0.21 x 0.10 m, pushed 32 mm inboard (27 mm clear of the rail) | T124-1 |
| I7-RH | oval dish on the RH crown, 0.21 x 0.13 m, 15 mm deep | T123-1 |
| I8 | rail ledge along the inboard bottom, 55 mm, turned outboard, z 0.705; 3 x 17 mm holes at the T124-1 y positions; 6 transverse ribs; front tab on the lower tie-bar shelf with 4 holes | T124-1, U-16303, T124-2 |
| I9 | '+' rib pair on the RH crown, arms 0.20 x 0.08 m, 10 mm | T123-1, CTP 12 |
| I10 | flat rear panel at y -1.47, fold about 0.845, lowest point 0.608 at x 0.598, outboard bottom cut back | solve I10, U-rear |
| I11 | holed cowl leg pressed 8 mm toward the cowl, 26 mm hole, 15 mm hole, 2 leg holes | U-rear, RH_3 |
| I12 | diagonal crease on the rear face | RH_3, LH t028 |
| I14 | H1 shelf hole; five small roof holes v1-v5 (8 mm) at the T124-1 heights | owner f6203444 x 069ba2a5; T124-1 |

## Gate (B3_gate_overlay 1.0; self-test 12/12, max 0.375 px)
Cameras f6203444, 069ba2a5, a5718305 and c1f5b457 come from the inner-fender solve. Picks are the solve's
landmarks.csv.

| image | n picks | n scored | unscored | RMS mm | max mm | over 25 mm |
|---|---|---|---|---|---|---|
| f6203444 | 3 | 1 | 2 | 9.3 | 9.3 | 0 |
| 069ba2a5 | 2 | 1 | 1 | 9.9 | 9.9 | 0 |
| a5718305 | 0 | 0 | 0 | - | - | 0 |
| c1f5b457 | 1 | 0 | 1 | - | - | 0 |

**Overall: FAIL by the tool's rule.** The cowl studs `CTX_cowl_stud_L/R` are camera anchors on the cowl, not
skirt geometry, so they have no model landmark.

With the anchor rows removed, the tool reports PASS: H1 is 9.3 mm in f6203444 and 9.9 mm in 069ba2a5. That is not
independent evidence. H1 was triangulated with these same cameras, and its error measures only the 13 mm by which
the model's shelf sits above the triangulated point.

The cameras' absolute sigma (60-80 mm) is larger than the 25 mm gate. The other two gate photos are not solved:
- c423d2b6 is taken from the front-passenger corner. The driver skirt shows only as a sliver behind the core
  support, with no point picks.
- 3040b57d shows the driver side with the fender and the skirt off.

A gate on the owner photos needs a twin-fixed metric anchor in f6203444 or 069ba2a5.

Relief: the depth and normal renders from the four cameras show the shoulder, the flank steps, the cup, the dish,
the '+', the ledge and the rim.

The body (k5-blazer split), core support, frame, firewall and LS3 were rendered through the same cameras. The
fender top line meets the work-light base in 069ba2a5, where the photo shows the light standing on the fender. The
bay outline lands near the photo in f6203444.

## Spec vs model (generator landmarks vs the solve's landmarks_twin.csv)
- **Crown ridge** (18 points): within 0.4 mm.
- **Section envelope** (16 points): within 9 mm, except outboard at 0.40 H, which is 25 mm off. That is the arch
  cut, which the envelope does not resolve.
- **Inboard edge and rail-ledge corner:** 0.1 and 5 mm.
- **Rear panel bottom and fold:** 0 and 3 mm.
- **H1:** 13 mm (z).
- **Rim apex:** 43 mm low (z 0.987 vs 1.030). The envelope table and the I1 reading disagree, and the table was kept.
- **Rail-ledge holes:** 53-66 mm in x. The ledge is turned outboard here; the solve's x 0.405 was a guess.
- **Cup:** 100 mm. z 0.756 vs 0.688: the spec z sits below the ledge.
- **Front tab tip:** 57 mm. The tab cannot reach y -2.575 through the core-support face at -2.527.
- **Closing-flange top:** 143 mm (1.021 vs 0.88). The spec flags this as unresolved against the level shelf.
- **Roof holes v1-v5:** 48-121 mm in x. The solve's x values were flank interpolations.

## Clearances
- **Frame rail and LS3:** no contact.
- **Core support (10-27 generator):** at least 4.4 mm from the radiator face, tie-bar shelf, posts and post foot.
- **Firewall (origin/main):** its `cowl_side_L/R` reaches forward to y -1.668 at x 0.65-0.88, so the rear 0.2 m of
  each skirt passes through it. `firewall_dash` reaches -1.561. The skirt's rear panel is the cowl station
  y -1.47, which the firewall rebuild has to meet.
- **Tyre:** the k5-blazer tyre is 32 x 13.3. It was swept +-35 deg about an assumed kingpin at x 0.72. Clearance is
  37 mm static and 9 mm with an assumed 60 mm bump, at the rear panel's outboard bottom. The owner's tyre, lift and
  steering stops are unknown.

## Missing or unresolved
- **Battery tray.** c1f5b457 shows it as a separate bolted tray on the passenger side, not part of the skirt. Its
  size and position were not measured.
- **I15 brace.** Its location is unknown.
- **The "stamped ribs and slots" on the 069ba2a5 shelf.** The solve places the ribbed panel in that photo on the
  core-support top flange, not the skirt.
- **Passenger skirt.** It is the driver geometry mirrored, plus the dish and the '+'. Nothing on it was measured on
  the owner's truck. c1f5b457 shows a rounder dome.
- **Booster clearance at the cowl end.** Unknown, because the booster is not in the twin.
- **Scale.** If the air-cleaner lid is 14 in, every distance from the stud line shrinks 10 %.
- **Part height H.** It is 0.46-0.58 m; the model adopts 0.512.
