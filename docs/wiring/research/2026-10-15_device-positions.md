---
id: 2026-10-15_device-positions
change_type: research
scope: 3D positions (twin frame) for the 124 harness plugs that had no route-graph point; 119 placed (6 high, 27 medium, 86 low confidence), 5 left unplaced with reasons
by: system (engineering call)
---

# K5 harness: positions for plugs with no topology node (2026-10-15)

Read-only study. YAML: device_positions.yaml (same folder). Generator: build_positions.py. Frame: +x driver, -y front, +z up, metres.

## Result
- Placed 119 of 124 plugs. By confidence: high 6, medium 27, low 86.
- Unplaced 5 (below).
- 86 distinct points; 12 points are shared by 2 or more plugs, covering 45 plugs (box splices at PDM30/PDM15, door pass-throughs at the boots, switch panels, alternative parts).
- Confidence meaning: high = a named twin object (lamp lens) split from a combined mesh; medium = on a placed node or inside a named object with the exact point assumed; low = mounts.yaml zone only, derived from twin geometry or ray casts.

## Unplaced
- UNDERHOOD-LAMP: mounts.yaml: "the factory spot was not found in the 1977 manual text"; the hood opens, so there is no fixed twin point
- PS-STUDS: aggregate of 10+ cable ends at different sites (Odyssey, isolator, distribution stud, starter, alternator, block, frame, PDMs, ground star); one point would be wrong for every route. Split into per-stud endpoints first.
- DAK-CTS: rear of the passenger head port is on the engine insert; with the 0.15 m engine offset corrected its y (about -1.45) coincides with the firewall plane. Not placed on the twin alone.
- DAK-OILP: mounts.yaml names two candidate sites (a tee at the factory oil port, or a port on the oil cooler adapter) and the first is on the engine insert rear (twin K5H_OilPress y -1.40, 0.15 m off).
- COIL-GROUND-RINGS: back of the cylinder heads is the engine insert rear face (twin y about -1.30, 0.15 m off); no bolt positions are recorded. Not placed on the twin alone.

## Twin flaws found
- Engine insert (K5H_*) about 0.15 m too far back (block rear y -1.30, firewall y -1.447); K5H_6L80E also starts at y -1.30. Engine-top nodes already in the graph carry it.
- Headlights, Parking_Lights, Marker_Lights, Tail_Lights_Main are single meshes for both sides; split here by connected component and x sign.
- Interior_Dome_Light_Blazer (5 copies), Interior_Mirror, Exterior_License_Plate_Back/Front sit at the world origin with local geometry: unusable as anchors. The DOME node comes from a landmark, not the object.
- Exterior_Roof is hidden; ray casts from above miss it for y > -0.2.
- K5H_Amplifier (x -0.65..-0.45, y 1.30..1.60, z 0.82..0.88) is inside the passenger spare tire (Wheel_Spare_Tire) and straddles the cargo floor (z 0.854).
- K5H_Battery is on the driver side (x +0.65); working position is the passenger firewall corner (state row 0ag(e)). K5H_AC_Compressor is on the driver side (+0.30) but mounts.yaml puts it on the passenger side. K5H_Alternator is on the passenger side; mounts.yaml puts it driver side.
- K5H_FWG_MAIN (-0.65, -2.88, 1.9) and K5H_CKP (-0.30, -3.34, 1.30) are outside the body (bumper front is y -2.72).
- Passenger firewall corner is claimed twice (batteries and the locked Four-Season A/C case); I put the batteries forward of the case. PDM15 and DCDC are flagged by mounts.yaml as breaking maker specs; if they move to the cab, their follows move too.
- Legacy twin_centers K5H_MoTeC_M130 / K5H_MoTeC_PDM30 are on the passenger side; the driver-side nodes in the database supersede them.

## Method notes
- Twin data read with Blender headless: object bbox, mesh connected components (lamps), ray casts (firewall plane y -1.452, dash face, apron |x| 0.565 at z 0.9, cargo floor z 0.854, roof header z ~1.90, rails |x| 0.39) with K5H_* hidden.
- Dash slots and in-door device heights are assumptions; mounts.yaml gives zone words only.

## Shared points
- (-0.52, -1.72, 1.12): 15 plugs: PDM15-A, PDM15-B, PDM15-STUD, SPL-PDM15-OUT1, SPL-PDM15-OUT2, SPL-PDM15-OUT3, SPL-PDM15-OUT4, SPL-PDM15-OUT5, SPL-PDM15-OUT6, SPL-PDM15-OUT7, SPL-PDM15-OUT8, SPL-PDM15-OUT13, SPL-PDM15-A-A28, SPL-PDM15-B-B25, SPL-PDM15-B-B26
- (0.3, -1.3, 0.997): 10 plugs: SPL-PDM30-OUT1, SPL-PDM30-OUT2, SPL-PDM30-OUT3, SPL-PDM30-OUT4, SPL-PDM30-OUT5, SPL-PDM30-OUT6, SPL-PDM30-OUT7, SPL-PDM30-OUT8, FUSE-DAK_CONST, FUSE-PCS_BATT
- (0.62, -1.24, 1.05): 2 plugs: HL-SW, WIPER-SW
- (0.5, -1.2, 0.95): 2 plugs: TURN-SW, HORN-SW
- (0.1, -1.14, 1.05): 2 plugs: TG-SW-DASH, TG-SW-MASTER
- (0.92, -1.13, 1.0): 2 plugs: DOOR-L-PASS, DOOR-L-PASS-P
- (-0.92, -1.13, 1.0): 2 plugs: DOOR-R-PASS, DOOR-R-PASS-P
- (0.825, -0.815, 1.245): 2 plugs: WIN-SW-L, LOCK-SW-L
- (-0.825, -0.815, 1.245): 2 plugs: WIN-SW-R, LOCK-SW-R
- (0.28, -1.5, 1.2): 2 plugs: WIPER-MOTOR, WASHER-PUMP
- (0.0, 1.82, 1.0): 2 plugs: TG-SW-KEY, TG-SW-KEY-REV
- (0.3, 1.74, 0.8): 2 plugs: TG-MOTOR-ACI, rear_window_motor
