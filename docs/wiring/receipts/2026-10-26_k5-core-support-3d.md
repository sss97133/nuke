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
| Headlamp centres | x +/-0.851 m (1.702 m apart) | _05/_06 tape with the top-to-bottom perspective taken out (tape governs; _01 reads 1.671 m and only confirms) | scaled, +/-16 mm |
| Headlamp hole | 0.135 m (5.3 in) | _05 driver hole on the tape; _06 passenger hole reads 5.6 in | scaled, +/-8 mm |
| Parking-lamp hole | 0.081 m, centre x +/-0.820, z 0.818 | _01 overlay, _05, _06, _10 | scaled, +/-15 mm |
| Radiator opening width | 0.765 m (30.1 in) | _05 tape 19.4 in to _06 tape 49.55 in; it sits 1 in toward the driver (_01 shows it too) | scaled, +/-10 mm |
| Radiator opening height | 0.493 m (19.4 in) | _05 tape frame, aspect-corrected (tape governs; _01 confirms within 27/42 mm after the re-pick below) | scaled, +/-20 mm |
| Opening top under the top edge | 0.086 m | _01 | scaled, +/-15 mm |
| Tie-bar section depth | 0.100 m (about 4 in) | _07 edge view and _03 end view, no tape across the section | assumed, +/-15 mm |
| Frame-mount spacing | 0.734 m (28.9 in) | _01 bottom edge, bracket centres at 475 and 1005 px | scaled, +/-20 mm |
| Fender-flange screws | 5 a side, 0.105 m apart | count: GM 2C-9 front fender removal step 10; spacing not readable in any photo | count printed, spacing assumed +/-15 mm |
| Headlamp-panel step, inner edge | x +/-0.650 m | owner 045, 0.109 m outboard of the boss at 1491 px/m | scaled, +/-20 mm |
| Oval boss | 107 x 195 mm, centre x +/-0.541, z 1.094 | owner 045 (size); _06 tape (x); _01 (z) | scaled, +/-15 mm |
| Sheet | 1.5 mm | none printed | assumed |

Tape frames (_05, _06, _10) give the number wherever they read a size; _01 and the obliques only check it
(lead ruling 2026-10-26).

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
| Tie-bar ends (overall width) | 1.951 m | 22, 15 | 32 (passenger) | not in frame |
| Top corners | z 1.258 | 19, 33 | 33 (passenger) | 18 (top over the boss) |
| Lower tie-bar bottom | z 0.631 | (with the ends) | (with the ends) | 28 |
| Headlamp centres | +/-0.851 | 15, 13 | 64 (driver, far end), 36 | not in frame |
| Parking-lamp holes | +/-0.820, 0.818 | 10, 12 | 51 | not in frame |
| Radiator opening top corners | 0.765 wide | 22, 21 | 13, 33 | hidden by the radiator |
| Radiator opening bottom corners | 0.493 tall | 27, 42 | 9, 62 | hidden |
| Frame mounts | 0.734 apart | 44, 45 | not visible | not visible |
| Boss | -0.541, 1.094 | n/a | 40 | 0 (the fit point) |
| Headlamp-panel step | -0.650 | n/a | n/a | 10 |

Worst residual in _01: 45 mm, at the frame-mount brackets, whose picks are bracket centres on a dark underside.
Worst overall: 64 mm, the driver headlamp at the far end of _10, about 2 m from a camera roughly 1 m off the
near end. The first _01 bottom-corner picks (y 531 / 549 px) sat on the edge between two pieces of cardboard seen
through the opening, not on the steel. Re-picked on the steel's straight lower edge (y 567 / 582 px), _01 agrees with
the tape at 27 and 42 mm. The 42 mm on the passenger side falls where the stamped corner radius starts, so that pick
is the one I distrust. Picks are by eye on 1600 px photos, about 10 px each.

## Twin conflicts for the frame and body lanes
The placement follows the headlamp centre, the convention every other MAP layer uses (radiator, harness, engine).
The two conflicts below are about the twin, not this part.
- **Vertical, frame against body.** Anchored on the headlamps, the frame-mount brackets bottom out at z 0.586, which
  is 135 mm below the frame's core-support pad top (z 0.721, itself assumed +/-40 mm). Anchored on the pads instead,
  the headlamps would sit near z 1.19 and the top edge at 1.41, 140 mm over the fender line (photos _01 bracket
  drop 45 mm under the tie bar; height from _01/_05). The body anchors
  agree with each other, so this file follows them. The frame's pad height or the body's ride height is off by
  about 135 mm, and that belongs to the frame lane.
- **Headlamp spacing.** The _05/_06 tape puts the centres 1.702 m apart, and the twin body's Headlights mesh puts them
  about 1.56 m apart (+/-0.780): 142 mm narrower. The support is at least 1.951 m wide, wider than the twin's grille (1.866 m),
  and the fenders bolt to its ends, so the twin body reads narrow at the front.
- **Frame-mount bolts.** The frame model's `body_mount_1` bolt holes sit at x +/-0.313 (assumed: web plus 10 mm),
  and this support's brackets at +/-0.367, on the rail-top centre (+/-0.368). The frame model's hole is the guess.

## Unknowns
- `{unknown, needs: tape across the tie-bar section}` tie-bar depth and channel shape.
- `{unknown, needs: tape on the owner's fender flange}` screw spacing.
- `{unknown, needs: 1973-74 support photo}` the feature that tells 1973-74 from 1975-80, beyond the model year.

## Rebuilt as stamped sections (2026-10-26, second pass)
The first file had the right outline and holes but no section depth. `core_support_blender.py` now builds the part as
1 mm sheet (Solidify), bends beveled 4 mm / 3 segments, shaded smooth by angle; 0.82 MB, same node `core_support`,
same placement (face plane y -2.527, z 0.631-1.258, all hole positions unchanged). Sub-nodes:
- `radiator_face`: one height-field sheet. Headlamp panels pressed 30 mm forward inside a stepped outline (inner step
  x +/-0.650, diagonal up to the upper tie bar near each end): _03/_04 end profile dips forward between the tie bars,
  _10 and _21 show the step line. Oval bosses domed 12 mm toward the engine (_01, _10, owner 045). A 5 mm bead ring
  round each headlamp hole (_01, _10).
- `upper_tie_bar`, `lower_tie_bar`: hat boxes 95 mm forward x 85 mm tall, open to the face, full width (_03 near end,
  _13 open end of the upper bar, _16/_17/_21 from the front). Upper has a 12 mm lip turned rearward over the top; lower
  a 45 mm lip toward the engine (owner 045 band, _03 right end).
- `radiator_post_L/R`: 70 mm hat channels standing forward either side of the opening, tie bar to tie bar (_16, _17, _21).
- `opening_flange`: 15 mm return toward the engine round the opening, 45 mm corner radius (_01, _10).
- `fender_flange_L/R`: end walls turned 90 degrees, from the panel dip to 45 mm behind the face, five 9 mm holes (_03, _04).
- `lamp_collars_L/R`: headlamp edge turned 8 mm forward, parking-lamp collar 15 mm (_10, _21).
- `hood_latch_plate` (2 mm doubler with slot, centred on the upper bar's front wall), `radiator_mounting_panel`
  (strip with a 20 mm return), `frame_mount_L/R` (U brackets, 45 mm drop, 17 mm hole).
Material: satin black, metallic 0.3, roughness 0.4. `strip_and_scan` passes (824,316 bytes).

Checked by side-by-sides (photo | Cycles | 50 % blend): _01 and _10 with the first pass's OpenCV cameras; _03 and _16
with cameras set by hand (look-at, not solved), so those two compare sections, not positions.

Least sure (assumed, not measured):
- Tie-bar and post section sizes (95 x 85 mm boxes, 70 mm posts, constant depth). _16/_17 suggest the posts may taper
  or deepen toward one tie bar; no tape crosses a section. `{unknown, needs: tape across a tie bar and a post}`
- End walls: _03 reads as a ~40 mm flange that follows the dipped profile; the model's wall is a flat 76 mm strip.
- Headlamp-panel outline and depth (30 mm) and the hood-latch plate, which no photo here shows clearly.
- Photos are not committed (third-party and owner photos; public repo).

## Third pass: sections thinned to the NOS part (2026-10-26)
The owner saw the second pass in the live viewer and said it reads as blocks. Changes in `core_support_blender.py`:
- Upper tie bar: an open channel, 62 mm deep and 70 mm tall, open toward the engine. It has a 22 mm return flange on
  the face and a top wall that runs back past the face with a turned-down lip (_03 left end, about 90 px at
  0.65 mm/px; _13).
- Lower tie bar: a 40 mm deep, 60 mm tall trough with a 22 mm top return on the face and the 40 mm rear lip
  (_03 right end, _17).
- The face sheet now stops where the channels begin (z 0.691 to 1.188), so nothing is a closed box.
- Radiator posts: 50 mm flanged hat channels, tapering from 45 mm deep at the bottom to 60 mm at the top
  (_16, _17). The direction of the taper is assumed.
- End flanges: 40 mm, turned rearward off the face edge and following its dip, with five 9 mm holes (_03).
- Headlamp step wall widened to a 28 mm radiused S. Lamp collars are 5 mm and 9 mm.
- Every bend is beveled 3.5 mm.
- Material: satin dark grey, base 0.13 linear, metallic 0, roughness 0.35. The inner fender and firewall use the same
  numbers.
- 0.65 MB; `strip_and_scan` passes.

Checked by side-by-sides on _03, _16 and _10, and by renders under viewer-like lighting (Blender studio HDRI at 0.5,
two suns, AgX).

Least sure:
- Post depth and taper. In _16 the posts look deeper than 60 mm. `{unknown, needs: tape across a post at each end}`
- Upper channel orientation (open toward the engine) and the top-wall overhang behind the face.
- Lower trough depth (40 mm) and its height on the face.
