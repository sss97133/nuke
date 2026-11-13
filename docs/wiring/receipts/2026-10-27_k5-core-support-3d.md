---
id: 2026-10-27_k5-core-support-3d
change_type: model
scope: nuke_frontend/public/models/k5-core-support.glb (replaced); docs/wiring/calc-data/cad/fab/core_support_blender.py
  (rewritten, Blender headless); docs/wiring/calc-data/cad/fab/k5_core_support_landmarks.json (new, written by the
  generator). No viewer code, harness, registry, database row or .blend changed. The `core-support` layer stays `off: true`.
author: claude-opus-5-5 (K5 3D rebuild, core-support modeler, 2026-10-27)
owner_words: "missing the upper portion and mounting points and lower frame supports" (2026-10-27)
supersedes: the placement and sizes in 2026-10-26_k5-core-support-3d.md (tape scale rejected, see below)
---

# Radiator core support rebuilt to the camera-solved measurements

## What changed
- `core_support_blender.py` is one deterministic script: `Blender -b --factory-startup -P core_support_blender.py`
  writes the GLB (0.69 MB, 49 meshes, 23,394 triangles) and `k5_core_support_landmarks.json` (77 named points, taken
  from the same variables that place the geometry). Two runs give byte-identical files. It reads no image.
- Axes are unchanged: twin metres, +x driver, -y forward, +z up. The glTF exporter's Y-up turn gives (x, z, -y), the
  same as `k5cad.write_glb`. Checked by re-importing the GLB: the face sheet lands at y -2.528..-2.526.
- Root node `core_support`. One mesh per element, each named after it: `radiator_face`, `opening_flange`,
  `upper_tie_bar`, `hood_bumpers`, `hood_lock_catch`, `hood_lock_support`, `radiator_mounting_panel`,
  `radiator_post_L/R`, `post_foot_L/R`, `foot_tab_L/R`, `frame_bracket_L/R`, `body_mount_cushion_L/R`,
  `mount_hardware_L/R`, `lower_tie_bar_L/R/_centre/_ribs`, `radiator_pocket_L/R`, `radiator_cushion_L/R`,
  `lamp_pan_wall/floor_L/R`, `cross_bead_L/R`, `locator_boss_L/R`, `nut_cages_L/R`, `lamp_collars_L/R`,
  `oval_dome_L/R`, `dome_tab_L/R`, `end_wall_L/R`, `fender_tab_upper/lower_L/R`. L is the driver side.
- Materials:
  - `edp_black`: base 0.035, metallic 0, roughness 0.45. The owner photos show a black support: 3040b57d (original,
    black, worn to bare at the edges) and 33a89651 (the new support). That is why this file does not use the grey
    primer of the phase-2 addendum.
  - `rubber` for the cushions and bumpers.
  - `zinc` for the mount hardware.
- The embedded strip-and-scan check passes: no extras, no Draco, no credential words, no 32-hex run.

## Scale: the tape reading is replaced by the lens solve
- **Owner photo c6b40497** (installed, grille on, 52 mm-equivalent lens) was solved as a lens-plane camera.
  - Anchors: the two 7-in sealed-beam lenses (SAE 178 mm) at z 1.052.
  - fx = 6057 px, from the EXIF 35 mm-equivalent focal and the sensor diagonal.
  - Reprojection: 1.9 px rms. Scale is uncertain by ±2.5 %.
  - Lamp centres come out at x ±0.782 ±0.020 m. The 10-26 receipt had ±0.851. Forcing ±0.851 gives 10.7 px rms
    and would need 197 mm lenses, so it is rejected.
- **The vendor repro support** (AMD 350-4075-1, turntable frame 01, square-on) was mapped at that lens scale,
  1.7686 px/mm.
  - It matches c6b40497 to 0.1 % on two scale-free ratios.
  - The face is 1.777 m wide, not 1.951 m.
- **Read off frame 01 at that scale:**
  - the outer outline and the C12 kinks;
  - the 116-point radiator opening, traced from the white background, including the three tongues and the
    passenger step;
  - 51 through-holes;
  - the post and foot edges, the pan rim and the floor edge.
- **Rays from c6b40497 intersected with this model's own surfaces** set the points tested on the owner's truck:
  - tie-bar top front edge: z 1.274;
  - hood bumpers: x 0.787 / -0.791, z 1.240;
  - latch lever top: x -0.034, z 1.2685;
  - parking lamps: x ±0.775, z 0.862. This is a compromise between the c6b40497 rays (0.772 / -0.764) and
    frame 01 (0.783).
- **Mounts:**
  - Foot bottom z 0.700 (frame 01). Bolt at x ±0.445: frame 01 gives the feet at ±0.443, and dfa1cf15 gives the
    cup at ±0.455 ±0.04.
  - Bracket plate top z 0.695, from the RB7360 install photo: 37 mm under the horn top.
  - Brackets sit on the outside of the twin frame horn web (x 0.360).
  - Cushion stack from the OER T71209 photo: upper cushion 23 x 62 mm, lower cushion 25 x 57 mm, M10 bolt; ±20 %.
- **Radiator pockets** at x +0.380 / -0.310, from the vendor engine-face frame 25 (±38 mm).

## Elements built (C-codes from the reference summary)
| code | element | built from |
|---|---|---|
| C1 | upper tie bar, open C-channel (47 mm forward, 43 mm back, 41 mm front wall), top-flange holes, nine face row holes, hood bumpers, end tabs | c6b40497, frame 01 |
| C2 | opening with three tongues and the passenger step, 20 mm return flange | frame 01 |
| C3 | hood-lock catch on the tie-bar top, release lever in front, full-height centre support with window | c6b40497 (lever), GM ST-330-78 Fig 2C-3 (shape) |
| C4 | radiator mounting panel: curved hat strip on the engine side of the tie-bar top, four bolts | GM Fig 2C-20, owner f6203444 (top view) |
| C5 | double-channel posts, x 0.383-0.507, with the frame 01 holes | frame 01 |
| C6 | post feet: box under each post, bottom z 0.700, vertical 17 mm bolt hole, oval access hole, drop tab | frame 01, NOS frames _07/_15, 81-88 install video |
| C7 | frame-side bracket on the outside of each horn: top plate with a 48 mm cushion hole, web wall with 6 rivets, gussets | RB7360 photos and instructions, dfa1cf15 |
| C8 | upper and lower cushions, retainer, washer, bolt, nut | OER T71209 photo |
| C9 | lower tie bar: band in the face (z 0.713-0.776), shelf, rear lip; centre channel with 2 ribs and 3 holes | frame 01, NOS _07/_15 |
| C10 | two 3-slot cradle pockets with rubber blocks | vendor frame 25, owner 8ace0227 (blocks) |
| C11 | lamp pans 40 mm forward with drafted walls, cross bead, trapezoid key window, locator boss, square nut cages, notched headlamp collar, parking-lamp collar | frame 01, c6b40497 |
| C12 | top-corner kinks | frame 01 |
| C13 | oval domes with slotted tabs, both sides | owner 33a89651 (passenger dome); vendor frame 01 position |
| C14 | end walls with 3 fender-screw holes, upper fender tab with hole, lower angled tab with hole | vendor end view frame 13 |
| C15 | fender-skirt screw holes in the shelf lip (3 a side, count assumed) | GM Fig 2C-18 |

Not built:
- **C16**: the owner's foam seal between the radiator and the support. Its shape is unknown.

## Gate (B3_gate_overlay.py 1.0; self-test 12/12 points, max 0.375 px)
The only owner photo with a solved camera is c6b40497.
- **Unsolved owner photos:** 3040b57d, dfa1cf15, f6203444, acc53b51, 33a89651 and 8ace0227 have no pose, so the
  gate skips them.
- **A model-anchored PnP of 3040b57d fails:** 82 px rms. The nine points cluster at the end and the support is
  loose in that photo.
- **The vendor frames are not gate images.** They were scored as a consistency check against the outline they
  supplied.

| image | picks | scored | RMS mm | max mm | over 25 mm |
|---|---|---|---|---|---|
| c6b40497 (owner, gate) | 11 | 11 | 8.9 | 20.0 | 0 |
| vendor frame 01 (shape check) | 60 | 60 | 5.4 | 18.3 | 0 |
| vendor frame 25 (shape check) | 2 | 2 | 8.0 | 11.3 | 0 |

The c6b40497 rows:

| landmark | d_mm | note |
|---|---|---|
| C11_headlamp_centre_L / _R | 0.1 / 0.1 | camera anchors: pass by construction |
| C11_parkinglamp_centre_L / _R | 3.5 / 12.8 | compromise with frame 01 |
| C1_tiebar_top_pt_L / _R | 0.7 / 4.0 | z of the top front edge |
| C1_tiebar_visible_end_L / _R | 20.0 / 16.4 | the photo sees only the part outside the fender lip; the model's ends are the vendor tab tips at ±0.866 |
| C1_hood_stud_L / _R | 0.7 / 1.2 | placed on the c6b40497 rays |
| C3_latch_lever_top | 0.2 | placed on the c6b40497 ray |

Error bars:
- Pick error is ±3.7 mm (median) at 3.7 m.
- Not included in the bars: the ±2.5 % absolute scale, about ±20 mm at the lamps.
- The c6b40497 camera assumes yaw and pitch of 0 (±3° and ±1.5°).

Relief check:
- The depth and normal renders from c6b40497 show the lamp pans, posts, tie bar, latch support and feet as
  separate depth bands.
- The oblique side-by-side the gate asks for cannot be made: no oblique owner photo has a solved camera.

## Least sure (assumed, no tape across a section)
- Section depths, with no photo measure:
  - lamp-pan depth 40 mm (±15);
  - tie-bar section 47 / 43 mm (±15);
  - post depth 65 / 55 mm (±25);
  - shelf depth 80 mm.
- Where the foot is fore-and-aft: the bolt at y -2.542 (±40), inside the post foot under its access hole.
- The C3 centre support, the C4 retainer section, the C7 bracket box and the C8 cushion sizes (±20 %).
- The owner's driver-side dome (taken as the passenger shape) and the vendor driver-side holes the dome replaces.
- Which way the C14 tabs point: one vendor end view can be read either way.
- The ±2.5 % absolute scale. With the tape scale instead, every offset from the centre would be 9.8 % larger.

## Conflicts handed to the frame lane
- The twin frame's `body_mount_1` sits at x ±0.359, pad z 0.721.
- The measured mount is a cup on the outside of the horn: hole at x ±0.445-0.455, plate top z 0.695, foot bottom
  z 0.700.
- The support now sits 21-26 mm below the twin pad and 86-96 mm outboard of it.
- The 10-26 receipt's 135 mm vertical conflict came from the tape scale and is gone.
