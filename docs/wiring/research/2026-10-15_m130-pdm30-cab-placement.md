---
id: 2026-10-15_m130-pdm30-cab-placement
change_type: research
scope: where the MoTeC M130 and PDM30 mount in the cab (twin free-space study, Blender headless on K5_harness_workspace_v2.blend; v3 gives the same cab result)
by: system (engineering call; owner 2026-09-29: "its not dave and skylar. dave is an avatar concept. we are building this system")
confidence: medium-low (the twin has no 61-pin hole, heater box, A/C duct, radio, pedal arms or fuse box as separate objects)
---

# M130 and PDM30 placement (driver-side cab), twin free-space study

Frame: twin metres, +x = driver, -y = front (toward engine), +z = up (objectTraits.ts and twin_centers.json `_frame`). Twin files: `K5_harness_workspace_v2.blend`; v3 re-run gives the same cab results (same body and interior meshes). Blender headless only. The study scripts were throwaway bpy scripts (overlap and ray methods below).

## 1. Box sizes and connector clearance (MoTeC documents)

| Item | Value | Source |
|---|---|---|
| M130 case | 107.5 x 127.5 x 38.7 mm (W x H x D), 300 g | motec_m130_datasheet.pdf p.2 spec block; drawing p.3 |
| M130 plug protrusion below case | 5.6 mm (drawing), connectors A (34 way) and B (26 way) side by side, 67.5 mm span, on the bottom edge | datasheet p.3 drawing |
| M130 mounting | 3 x Ø5.2 holes (M5 or 3/16"), 97.5 mm pitch, max washer/head Ø13 | datasheet p.3 |
| PDM30 case | 107.5 x 127.5 x 38.7 mm, 270 g; manual spec table says 107 x 133 x 39 (133 = 127.5 + 5.6 plugs) | motec_pdm30_datasheet.pdf p.1 and p.2 drawing; motec_pdm_user_manual.pdf p.35 table |
| PDM30 power stud | M6 stud, "4 Power Connection", insulating cap; stud sticks about 17.9 mm out of the lid face, inside the 38.7 mm envelope | pdm30_datasheet p.2 drawing; manual p.44 (C_1 battery +) |
| PDM30 mounting | same 3 x Ø5.2 pattern | pdm30_datasheet p.2; manual pp.45-47 "Mounting Dimensions" |
| Plug clearance (rule in record) | 60-80 mm clear beyond both plug faces | mounts.yaml (M130 block, `receipts/2026-06-09_as-built-photo-survey-corrections.md`). I used 80 mm. |
| Thermal | PDM "may get very hot", mount in a well ventilated area, not against a hot surface; 110 C internal max, typical 85 C ambient only for 120 A load; M130 85 C ceiling in record | manual p.3 and p.35; K5_WIRING_STATE.md line 142 |
| Environment | PDM15/PDM30 = magnesium case, conformal-coated PCB only (no seals); M130 "protected location, occasional splash" | manual p.35; K5_WIRING_STATE.md row 0ag(b) and line 142 |

Envelope I tested per unit: 107.5 (W) x [127.5 + 5.6 + 80] = 213.1 mm along the connector axis x 38.7 mm deep. For the PDM30 the M6 stud and its 2 AWG / 4 AWG lug side exit are not in the box. Cable bend space for that lug is UNKNOWN (no source for the lug's bend radius).

## 2. What the twin cab contains (measured)

Method: for each candidate, build a box mesh and run a BVH triangle overlap test against these meshes: Interior_Main, Interior_Body, Interior_Carpets_Rubber, Interior_Center_Box, Dash_Main, Dash_Panel_01/02, Dash_Speedo, Dash_Vent_02/03/04, Steering_Main, Steering_Wheel, Exterior_Body_Blazer, Under_Main_Blazer, Door_Left_Main/Details, Interior_Seat_Front_Left/Right, wiper systems, Exterior_Window_Front. "Margin" = the box, inflated by that distance on every face, still has zero overlap (tested 5, 10, 20, 30 mm). Every box sits 15 mm off its mounting surface (isolator gap), so margin to the mounting surface itself is 15 mm and margin tests above 10 mm are limited by that.

Ray probes:
- Firewall inner plane: y = -1.454 at z >= 0.95 (all x 0.2..0.75). Toe board slopes: y = -1.41 at z 0.85, y = -1.32 at z 0.75.
- Dash underside (ceiling): z = 1.031 (x 0.3..0.7, y -1.35..-1.15). Above it (z 1.07+) the twin shows only the dash shell, so the space behind the dash face is inside the dash and is not usable.
- Driver side wall (kick panel / cowl side): x = 0.81 .. 0.82 at y -1.40..-1.10 (Interior_Main).
- Steering_Main carries about 22,000 vertices at z 0.75-0.95, x 0.21-0.79, y -1.41..-1.12: that is the column foot and pedal assembly. It fills the firewall face below z 0.95.
- Free vertical gap on the firewall face between pedal assembly top (z 0.95) and dash underside (z 1.031) is 8 cm. Result: no firewall-face mount fits (a box needs 10.8 cm). Tested orientations F1 (plugs down), F2 and F3 (plugs sideways): 0 feasible below the ceiling. The apparent F2/F3 hits at z 1.05-1.15 are inside the dash shell and were rejected.
- 61-pin position: the twin has no hole in Interior_Main (rays at z 0.95-1.0 hit solid firewall everywhere). I used the objectTraits.ts FB hole x = +0.50, z = 0.90 (objectTraits.ts:163) with y snapped to the measured firewall plane: **A61 = (0.50, -1.454, 0.90)**. The FB entry in objectTraits.ts has y = -1.00, which is 0.45 m inside the cab and contradicts the measured firewall at -1.454, so I did not use that y. x and z are unverified (placeholder, confidence low). The 61-pin plug and boot keep-out is also unknown (library has MILNEC_D38999_series_III_catalog.pdf but its shell-25 plug length was not extracted); I assumed a keep-out of 90 mm radius x 120 mm deep from the firewall around A61. Rerun with the real value moves the answer little because every winner below is 0.12+ m from that cylinder.
- Heat context: K5H_Manifold_D bbox x 0.315..0.405, y -1.94..-1.37, z 0.63..0.77 (driver exhaust manifold, engine bay side); K5H_Exhaust_D under the floor, z 0.44-0.50. The twin has no heater box, no Four-Season duct and no radio object in the cab, so those are NOT excluded by the overlap test. Mounts.yaml says they fill under-dash centre, so I stayed on the driver side of the column (x >= 0.15).

## 3. Candidates

Orientation names: "dash-underside" = mounting face flat against the underside of the dash at z 1.02-1.03 (lid faces down), body long axis horizontal. Plugs face horizontally, so there is no upward-facing plug cup and nothing on top to collect drips. Distance = straight line from A61 to the centre of the plug face (where the 58 engine tails land).

### M130

| # | Body centre (x, y, z) | Orientation | Box lo..hi incl. 80 mm plug clearance | Margin | Distance to A61 | Near | Risk |
|---|---|---|---|---|---|---|---|
| M1 (recommended) | (0.55, -1.22, 0.987) | dash-underside, plugs toward centre (-x), plug face at (0.481, -1.22, 0.987) | x 0.401..0.614, y -1.274..-1.166, z 0.967..1.006 | >= 10 mm all faces (fails at 20 mm only because of the 15 mm mount gap) | 0.250 m (record rule: tails short, HP Academy ~300 mm, so inside it) | dash underside left of column; column foot and pedals 0.15 m below (Steering_Main at z <= 0.85 below this xy); 0.21 m from manifold_D bbox through the firewall | footwell is below it, so foot or knee kick on the lid is the exposure; windshield cowl leak water can run down firewall onto the top. Heat unknown. |
| M2 | (0.34, -1.38, 0.997) | dash-underside, plugs rearward (+y), plug face (0.34, -1.311, 0.997) | x 0.286..0.394, y -1.444..-1.231, z 0.977..1.016 | >= 10 mm | 0.236 m | against the firewall base of the dash, left of column | plugs face the driver's knees, harness must drop to the floor side; 0.207 m from manifold_D bbox, the closest of the set |
| M3 | (0.778, -1.20, 0.81) | on the driver kick panel wall, lid facing -x, plugs rearward (+y), plug face (0.778, -1.131, 0.81) | x 0.759..0.797, y -1.264..-1.051, z 0.756..0.864 | >= 10 mm | 0.436 m (outside the 300 mm rule) | kick panel, driver's left foot | foot kick, door water, leaves the 300 mm rule. Fallback only. |

### PDM30 (M130 placed first at M1, then +20 mm keep-out around it)

| # | Body centre | Orientation | Box lo..hi | Margin | Distance to A61 | Near | Risk |
|---|---|---|---|---|---|---|---|
| P1 (recommended) | (0.30, -1.30, 0.997) | dash-underside, plugs toward centre (-x), plug face (0.231, -1.30, 0.997) | x 0.151..0.364, y -1.354..-1.246, z 0.977..1.016 | >= 10 mm | 0.325 m | in line with M130 along x, 37 mm between PDM30 body end (x 0.364) and the M130 plug zone (x 0.401) | most-loaded box (up to 100 A): ventilation is mounting-face-only here (face hard against the dash steel) and the pocket is closed from above; heat soak test required (state line 143). 0.208 m from manifold_D bbox. |
| P2 | (0.31, -1.21, 0.987) | dash-underside, plugs rearward (+y), plug face (0.31, -1.141, 0.987) | x 0.256..0.364, y -1.274..-1.061, z 0.967..1.006 | >= 10 mm | 0.377 m | left of column | plugs toward knees, longer from 61-pin |
| P3 | (0.22, -1.31, 0.997) | dash-underside, plugs toward door (+x), plug face (0.289, -1.31, 0.997) | x 0.156..0.369, y -1.364..-1.256, z 0.977..1.016 | >= 10 mm | 0.273 m | left of column | the M6 stud and the power lug side exit are not modelled; side exit space unknown |

PDM30 stud and lug: the 4 power connection (M6) side of the PDM30 needs room for a 2 AWG or 2 x 4 AWG lug. The tested box does not include it. Unknown until Dave picks the lug and routing (state row 0k, 0ah "battery cables" listed as an open question for Dave).

## 4. Recommendation

- **M130: M1**, body centre (0.55, -1.22, 0.987), box x 0.401..0.614, y -1.274..-1.166, z 0.967..1.006, lid facing down on the dash underside, plugs toward centre (-x), plug-face centre (0.481, -1.22, 0.987). Reason: only orientation family that fits at all (firewall face is full of pedal assembly), it is 0.25 m from the 61-pin (inside the 300 mm figure), it sits clear above the column foot and pedals with 10 mm or more margin everywhere, it keeps both plugs horizontal and away from windshield drips, and it is as far from the driver exhaust manifold bbox (0.219 m) as any candidate near the hole.
- **PDM30: P1**, body centre (0.30, -1.30, 0.997), box x 0.151..0.364, y -1.354..-1.246, z 0.977..1.016, same orientation, plugs toward centre. Reason: same family and same plane, so the two boxes form one row on the dash underside; the only nearer-to-61-pin PDM positions (U1 at 0.236) collide with the M130 position M1 or put plugs at the knees.
- Mount both on rubber isolators (record: not rigid on a vibrating panel, K5 mounts.yaml). Standoff 15 mm assumed in the model.

## 5. PDM15 beside the PDM30 in the cab (state row 0ag(b))

Same case, same size as the PDM30 (PDM15/30: 107 x 133 x 39 mm, manual p.35), same unsealed magnesium + coated-PCB construction. Space: after P1 and M1 are placed, the dash underside left of the column still has feasible 213 x 108 mm boxes (search left 91-116 feasible positions after the M130 and PDM30 are blocked, e.g. toward the centre x 0.0-0.15, but those are outside the driver side and closer to the (unmodelled) heater and radio). So geometry allows a third box on the same underside, but with three boxes the underside row becomes about 0.6 m wide and the PDM15 plus PDM30 stack heat into one closed pocket; a PDM30 already needs a ventilation test. My call: yes, the PDM15 belongs in the cab (an unsealed box in the engine bay breaks the MoTeC spec table), mounted separately from the PDM30 and not butted against it (at least 40 mm gap and its own airflow), positioned after the PDM30 heat-soak test; a PDM16 in the bay is the only alternative that keeps it sealed. Position of the PDM15 itself: not computed to the same standard; the twin does not model the heater box, so I cannot prove clearance for a third box. Confidence low.

## 6. Confidence

- Geometry of the box and of the dash underside: medium. The cab mesh is a single shell for the dash, so the underside z = 1.031 is surface only; the space above it is not usable but the actual K5 has a structural dash support, wiring and a heater box under there that the twin does not hold.
- No heater box, Four-Season duct, radio, brake booster/pedal arms, fuse box or steering column bracket exist as separate objects. They could take the M1/P1 volume. A measurement in the real truck (hold a 108 x 213 x 39 mm cardboard template at the dash underside left of the column, x about 0.40-0.61 / y about -1.27..-1.17 in twin frame) settles it. The owner is not being asked; the system keeps M1 and P1 until a photo or measurement contradicts them.
- A61 (the 61-pin position) is a placeholder (x 0.50, z 0.90 from objectTraits.ts:163, y from the measured firewall). Every distance above moves with it. If the real hole is at x 0.65 the M130 plug-face distance becomes 0.30 m; at x 0.30 it becomes 0.31 m (computed from the M1 plug-face centre, z 0.90, y -1.454), so M1 sits at the 300 mm figure if the hole is 0.15-0.2 m off the placeholder in x.
- Heat: no thermal model; engine-bay manifold is 0.21 m from the boxes through steel firewall; cab ambient unknown. Needs a CAN-logged internal temperature test (manual p.3 tip) before PDM30 is closed.
- Water: no water-path model; dash underside has no overhead aperture in the twin.
