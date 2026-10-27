---
id: 2026-10-26_k5-core-support-3d
change_type: model
scope: nuke_frontend/public/models/k5-core-support.glb (new); docs/wiring/calc-data/cad/fab/core_support_blender.py
  (its generator, Blender headless); nuke_frontend/src/components/wiring/map/scene3d.ts (one LAYERS entry). No
  harness, registry, catalog, database row or .blend file changed.
author: claude-opus-5-5 (k5 front sheet metal, core-support part agent, 2026-10-26)
owner_words: "firewall and radiator support wrong, inner fenders missing." (2026-09-30, carried by the modeling brief)
---

# The radiator core support, drawn from photos

## What changed
- `k5-core-support.glb` (0.10 MB) is the 1975-80 C/K radiator core support at true size: root node `core_support`
  with `radiator_face` (one sheet: radiator opening, two headlamp holes, two parking-lamp holes), `upper_tie_bar`,
  `lower_tie_bar`, `radiator_mounting_panel`, `headlamp_panel_L/R` (the stepped box around each lamp),
  `fender_flange_L/R` (side baffles with five screw holes each), `frame_mount_L/R` (box brackets with a 17 mm bolt
  hole) and `boss_L/R` (the stamped oval bosses beside the opening). L is the driver side (+x).
- Axes: twin metres, +x driver, -y forward, +z up; glTF (X, Y, Z) = (x, z, -y), the turn `k5cad.write_glb` makes.
  One material, satin black steel, metallic 0.6, roughness 0.55. `chassis_frame.strip_and_scan` passes: no extras,
  no Draco, no credential words, no 32-hex run (its whole-file regex did not false-positive on this mesh, so
  `chassis_frame.py` is unchanged).
- The MAP tab gets a `core-support` layer that takes over the `CTX-core-support-face` hide from the `sheetmetal`
  layer. The sheetmetal file's own `radiator_support` box still draws until that file is retired; layer hides only
  reach zone nodes.

## Which support
The truck is a 1977 (VIN in `K5_WIRING_STATE.md`, model-year digit 7), so it takes the 1975-80 support. The owner's
photos agree: scott-bay 045 and 046 show a new black support with the same stamped oval dome and slotted tabs, hole
pattern and headlamp-panel step as the NOS GM support in eBay 227561622754 frames _05/_06/_10. The photo set holds
no side-by-side of the 1973-74 support, so what tells the two apart was not checked against a photo.
scott-bay 057-059 show the front end stripped to the cowl, with no support in them, so the installed overlay uses 045.

## Which face is the engine face
In owner photo 045 the aluminium radiator stands between the camera and the support, so that photo shows the engine
face. The oval dome with the slotted tabs sits right of the radiator, on the passenger side. The NOS photos _01, _05,
_06 and _10 show that same dome at image-right of the opening, so they show the engine face too, with the driver side
at image-left. The same photo settles the tie bars. The lower tie bar's flange is a wide band toward the camera,
so it stands toward the engine. The top edge shows no flange, so the upper tie bar's channel stands forward of the face.

## Sources and how each size was read
Every reference id below is a file in the reference set (eBay listing 227561622754 frames, owner photos
scott-bay NNN, GM 1978 Light Truck Service Manual section 2C). The photos are not committed (third-party and owner
photos; public repo).
| Size | Value | Read from | Basis |
|---|---|---|---|
| Overall width, tie-bar ends | 1.951 m (76.8 in) | _05 tape: driver end -2.9 in; _06 tape: passenger end 73.9 in (same tape, same session) | scaled, +/-25 mm |
| Face height, lower tie-bar bottom to top edge | 0.627 m (24.7 in) | _01: 467 px at 18.4 px/in; _05 cross-check 24.9 in after the lamp-hole aspect correction (0.9) | scaled, +/-25 mm |
| Headlamp centres | x +/-0.843 m | _05/_06 tape with the top-to-bottom perspective taken out: 1.702 m apart; _01: 1.671 m apart | scaled, +/-16 mm |
| Headlamp hole | 0.135 m (5.3 in) | _05 driver hole on the tape; _06 passenger hole reads 5.6 in | scaled, +/-8 mm |
| Parking-lamp hole | 0.081 m, centre x +/-0.820, z 0.818 | _01 overlay, _05, _06, _10 | scaled, +/-15 mm |
| Radiator opening width | 0.765 m (30.1 in) | _05 tape 19.4 in to _06 tape 49.55 in; it sits 1 in toward the driver (_01 shows it too) | scaled, +/-10 mm |
| Radiator opening height | 0.463 m (18.2 in) | mean of _01 (17.1 in) and _05 (19.4 in, aspect-corrected) | scaled, +/-30 mm |
| Opening top under the top edge | 0.086 m | _01 | scaled, +/-15 mm |
| Tie-bar section depth | 0.100 m (about 4 in) | _07 edge view and _03 end view, no tape across the section | assumed, +/-15 mm |
| Frame-mount spacing | 0.734 m (28.9 in) | _01 bottom edge, bracket centres at 475 and 1005 px | scaled, +/-20 mm |
| Fender-flange screws | 5 a side, 0.105 m apart | count: GM 2C-9 front fender removal step 10; spacing not readable in any photo | count printed, spacing assumed +/-15 mm |
| Headlamp-panel step, inner edge | x +/-0.650 m | owner 045, 0.109 m outboard of the boss at 1491 px/m | scaled, +/-20 mm |
| Oval boss | 107 x 195 mm, centre x +/-0.541, z 1.094 | owner 045 (size); _06 tape (x); _01 (z) | scaled, +/-15 mm |
| Sheet | 1.5 mm | none printed | assumed |

Placement in the twin: front face at y -2.527 (the frame's core-support pads, as the brief sets it), vertical from
the twin's headlamp centre z 1.052. The top edge then lands at z 1.258, against the fender top line at 1.27: a
second, independent body check. The radiator opening (0.765 m) matches the twin's radiator core width (0.762 m).

## Check against the photos
The cameras were matched in OpenCV, not Blender. For _01 and _10, the focal length came from a planar calibration
of the face's own points, with the principal point at the centre, followed by solvePnP. For owner 045 the camera is
set square-on by hand: focal length from the iPhone main camera, distance from the face height, centred on the boss.
Each overlay draws the model's triangles at 50 % and an edges-only pass. The residuals in the table are model point
against photo point after the fit, in mm at the point's depth.

| Landmark | Model | _01 full face | _10 end oblique | owner 045 |
|---|---|---|---|---|
| Tie-bar ends (overall width) | 1.951 m | 23, 19 | 28 (passenger) | not in frame |
| Top corners | z 1.258 | 20, 32 | 29 (passenger) | 18 (top over the boss) |
| Lower tie-bar bottom | z 0.631 | (with the ends) | (with the ends) | 28 |
| Headlamp centres | +/-0.843 | 16, 18 | 46 (driver, far end), 39 | not in frame |
| Parking-lamp holes | +/-0.820, 0.818 | 13, 15 | 46 | not in frame |
| Radiator opening top corners | 0.765 wide | 22, 21 | 16, 36 | hidden by the radiator |
| Radiator opening bottom corners | 0.463 tall | **47, 54** | 8, 47 | hidden |
| Frame mounts | 0.734 apart | 46, 46 | not visible | not visible |
| Boss | -0.541, 1.094 | n/a | 36 | 0 (the fit point) |
| Headlamp-panel step | -0.650 | n/a | n/a | 10 |

The worst residual is 54 mm, at the opening's bottom corners in _01. _01 wants the opening 45 mm deeper, while
_10 wants the passenger bottom corner 47 mm higher, so the height stays at the mean, +/-30 mm. Eleven of the 26 fit
residuals are over the brief's 25 mm pass line. The picks are by eye on 1600 px photos (about 10 px each), and the
far-end points in _10 sit 2 m from a 1 m camera.

## Conflicts with the twin (not changed here)
- **Vertical, frame against body.** Anchored on the headlamps, the frame-mount brackets bottom out at z 0.586, which
  is 135 mm below the frame's core-support pad top (z 0.721, itself assumed +/-40 mm). Anchored on the pads instead,
  the headlamps would sit near z 1.19 and the top edge at 1.41, 140 mm over the fender line. The body anchors
  agree with each other, so this file follows them. The frame's pad height or the body's ride height is off by
  about 135 mm, and that belongs to the frame lane.
- **Headlamp spacing.** The photos put the centres 1.686 m apart, and the twin body's Headlights mesh puts them
  about 1.56 m apart (+/-0.780): 126 mm narrower. The support is at least 1.951 m wide, wider than the twin's grille (1.866 m),
  and the fenders bolt to its ends, so the twin body reads narrow at the front.
- **Frame-mount bolts.** The frame model's `body_mount_1` bolt holes sit at x +/-0.313 (assumed: web plus 10 mm),
  and this support's brackets at +/-0.367, on the rail-top centre (+/-0.368). The frame model's hole is the guess.

## Unknowns
- `{unknown, needs: tape across the tie-bar section}` tie-bar depth and channel shape.
- `{unknown, needs: tape on the owner's fender flange}` screw spacing.
- `{unknown, needs: 1973-74 support photo}` the feature that tells 1973-74 from 1975-80, beyond the model year.
