# K5 front inner fender sculpted to reference photos (2026-10-26)

File: `nuke_frontend/public/models/k5-inner-fender.glb` (1.6 MB; nodes `inner_fender_L`, `inner_fender_R`; one material
`satin_black`, metallic 0, roughness 0.35, clearcoat 0.25; Y-up metres in the twin's frame; passes
`chassis_frame.strip_and_scan`). Generator: `docs/wiring/calc-data/cad/fab/inner_fender_sds.py` (Blender 4.x headless:
`Blender -b -P inner_fender_sds.py -- out.blend out.glb`). MAP layer `inner-fender` in `scene3d.ts`.

## Method
A hand-placed low-poly cage (a 6 x 12 top grid for the dome plus six rings hung off its boundary: shoulder, wall top,
wall, bend support, flange root, flange tip), Catmull-Clark level 3, stamped detail pressed into the subdivided sheet,
solidify 1 mm, clip holes cut by boolean. LH is built; RH is its mirror. The web copy is decimated to 60 % to stay
under 2 MB. There is no millimetre gate: the shape was judged by eye, side by side with eight Raybuck turntable frames
(cameras re-fitted to this model by silhouette IoU, mean 0.82 LH / 0.82 RH) and two owner bay photos. The images are
vendor and owner photos and are kept outside this public repo.

## Placement (agreed twin anchors, not re-derived)
Outboard lip at x 0.858 under the fender lip; engine-side wall x 0.42; bottom flange z 0.62 on the frame rail; span
y -2.505 (core-support rear face) to -1.44 (cowl). Dome crown z 1.085 and the rim heights are by eye inside that box
(**assumed, +/-0.04 m**); crown is the OER T70124 box height (18 in) over the rail flange.

## Each feature and the photo it came from
| feature | photos |
|---|---|
| near-vertical engine-side wall, straight bottom flange on the rail | Raybuck RH 1, RH 9; b_jegs_1 |
| big rounded shoulder, dome high nearly to both ends, rounded end shoulders | Raybuck LH 5, LH 9, RH 3, RH 9 |
| dome crowned along its length, rolling off at the ends | Raybuck LH 9, RH 9, RH 12 |
| outboard rim following the wheel arch, lip outward to the fender line | b_eckler_1 (crown trace), Raybuck LH 9/13, RH 9/12 (end drop, by eye) |
| front end a full-width bowl, flange running forward flat | Raybuck LH 1-5, b_oer_1 left end |
| ribs across the front flange | Raybuck LH 1-5, b_oer_1 upper left |
| short ribs across the outboard lip, front third | b_oer_1 top edge, Raybuck RH 5-8 |
| "+" stamped ribs and shallow pan on the shelf | b_oer_1 (RH, mirrored) |
| step bead along the engine-side wall | Raybuck LH 9, RH 9 highlight band |
| holes: rail flange, lip, front flange, two large on the rear end face, two small on the shelf | b_jegs_1, b_jegs_7, b_oer_1 |

## Not modelled / least sure
- The rear end: photos (Raybuck RH 1-3, b_jegs_1) show a flat end panel with a diagonal crease and a long holed leg
  down the cowl; the model closes the rear with a plain rounded end and flange.
- The front bowl's cup-shaped pocket (Raybuck LH 1-5) is not modelled.
- Installed view scott-bay 020 is matched by a hand-set camera, not a solved one; scott-bay 022 uses the earlier
  PnP fit (reprojection RMS 14.8 px), where the core support hides most of the part.
