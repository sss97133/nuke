# K5 front inner fender sculpted to reference photos (2026-10-26)

File: `nuke_frontend/public/models/k5-inner-fender.glb` (1.7 MB; nodes `inner_fender_L`, `inner_fender_R`; one material
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
| shoulder line between wall and dome, a creased cage loop on the engine side and the cowl end | Raybuck LH 9, RH 9, RH 1-3 |
| long diagonal fold across the dome toward the rear, a creased valley in the cage | Raybuck LH 9, RH 9, RH 12 |
| cup pocket pressed into the front bowl's end face | Raybuck LH 1-5 |
| flat rear end panel with a diagonal crease | Raybuck RH 1-3, b_jegs_1 |
| holed leg down the cowl at the outboard rear corner, channel with turned edges | b_jegs_1, Raybuck RH 1-3 |
| holes: rail flange, lip, front flange, two large on the rear end face, two small on the shelf | b_jegs_1, b_jegs_7, b_oer_1 |

## Installed check
Owner photo scott-bay 018 (bay from the front, hood up) is solved as a pinhole camera: f 1444 px at 2000 px wide
(iPhone main camera, 26 mm equivalent), pose from four anchors taken from the twin's own published parts: the
core-support upper tie bar's rear top edge at the centreline (k5-core-support.glb, z 1.258), the firewall top at the
centreline (k5-firewall.glb, z 1.258) and the two cowl-side tops (x +/-0.858, z 1.177). Reprojection RMS 7.4 px
(4 points, 2 spare degrees of freedom); camera at (0.00, -2.80, 1.67), 41 deg down. scott-bay 020 has none of these
anchors in view, so 018 replaced it. scott-bay 022 keeps the earlier five-point fit (RMS 14.8 px).

## Least sure
- In 018 the brake booster (driver side, on the firewall) sits where the model's engine-side wall is at the cowl end
  (x 0.42). The real wall must step outboard near the cowl; the agreed x 0.42 was kept.
- The leg's width and length, and the front pocket's size, are by eye from vendor photos without a scale.
- The Raybuck camera fits are silhouette fits (mean IoU 0.80 LH / 0.79 RH), so small shape errors shift the camera too.

## Third pass (rebuilt from the JEGS photos)
The cage is now the four elements in b_jegs_1/3/5/7: an arch rim flange in the fender plane (x 0.858) with a rolled
double bead and tails past the dome, a pillowed dome stepping inboard at a creased shoulder line, flat transverse end
panels, and a ribbed bottom flange with holes every 150 mm. The rim arc and the dome top are traced from b_jegs_7
(0.73 mm/px from the tail-to-tail span). Heights are hung from the dome top at z 1.080. With that scale, the photo's
tail-to-dome-top height (0.46 m) equals the OER box height, so the rim apex lands at z 0.86, not the earlier assumed 0.98.
Ends are set from the installed photos (i_bat_27, i_bat_15): the flat panel with the diagonal crease and the holed leg
is at the cowl, and the cup and ribbed flange are at the core support. The JEGS part is a RH skirt, so it is compared
against `inner_fender_R`. Read that way, b_jegs_7's steep left tail is the cowl leg, and the traced rim's flat low
stretch is centred about 0.09 m behind CF.FA_Y.
Cameras solved from point matches with a free focal length: b_jegs_7 RMS 8.9 px (5 points: tail tips, crown hole,
two rim points); b_jegs_3 RMS 23.7 px (6: three front-flange holes, cup, leg tip, crown hole); b_jegs_1 RMS 17.6 px
(4: rear-panel hole, leg hole, leg tip, front tail tip). The b_jegs_5 point match did not converge (RMS 90 px). Its
side-by-side uses a silhouette fit, which still shows the part from the wrong end.
The dome is 0.06 m lower than a level-camera reading of b_jegs_7, because the solved camera sits above the rim.

## Fourth pass (dome from a cut superellipsoid)
The dome is now a superellipsoid with |x/A|^2 + |y/B|^4 + |z/C|^2 = 1, sitting on the rail plane. It is cut by the
rim plane (x 0.835), the rail plane and the two end planes, and the inboard-upper part is kept. Its cut edge on the rim
plane is the wheel arch (apex z 0.86, 0.05 m behind CF.FA_Y). A fillet strip steps out to the beaded band at x 0.858.
The front cup is a separate bevelled dish set into a cut opening. The front-flange and bottom-flange ribs are separate
bevelled bars. The rear-panel crease is in the panel grid. Nothing is pressed into a smoothed mesh.
C = 0.34 (crown z 0.96). With a 1.02 crown, the point-matched b_jegs_7 camera dropped below the rim and looked into
the wheel well, which the photo does not show. With 0.96 the camera sits at z 1.17 (RMS 7.8 px).
b_jegs_3 (RMS 41 px), b_jegs_1 (36 px) and b_jegs_5 (74 px) do not solve to a few pixels against this shape.
