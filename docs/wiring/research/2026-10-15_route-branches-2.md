---
id: 2026-10-15_route-branches-2
change_type: research
scope: second route study: branches and junctions joining every route-graph point pair the live segments need
by: system (engineering call)
---

# K5 harness route branches, second study

Files: route_branches_2.yaml (16 junctions, 116 branches, same shape as catalog/route_branches.yaml), this report. Frame: +x driver, -y front, +z up, metres. Twin: K5_harness_workspace_v2.blend, headless. Read-only: no commits, no database writes. Existing branches untouched.

## Result
- Point pairs the live segments need: 196 (390 segments). Joined before: 33 pairs (125 segments). Joined after the additions: 196 pairs (390 segments); checked with a shortest-path walk over the 43 live branches plus the 116 new ones, the same rule route_harness_segments uses. All 265 previously unjoined segments (163 pairs) are now joined.
- Pairs still unjoined: none.
- Pairs that need a firewall crossing with no placed bulkhead: none. Cab to bay body wires cross on FIREWALL_BODY_A/B/P (their own plate, cab face to J_CAB_DASH, bay face to J_BAY_BODY_D). Power and ground cables cross on FIREWALL_GROMMET (placed, status proposed). No pair that does not end at FIREWALL_61 routes through it.
- New length: 1,507.3 in (38.29 m). By family: bay B 481.6 in, roof H 298.3, cab C 276.1, rear R 210.1, passenger floor F 136.3, doors D 104.9.
- Codes: K5B_C11-C44 cab and dash, K5B_D01-D09 door interiors, K5B_H01-H12 roof rails and headers, K5B_F01-F04 passenger floor and frame, K5B_R05-R21 rear, K5B_B26-B65 bay. No clash with existing codes.

## Network added
- Cab: a dash-underside trunk from PDM30 through GND_BANK_CAB, GSS_3000, PCS_HARNESS_4610 to J_DASH_P, with the dash switches and lamps tapped off it; a passenger kick panel breakout J_CAB_KICK_P (mirror of J_CAB_DASH) with the power grommet's cab face; door hinge boots joined to the kick panels and the driver rocker; speed-sender exit FIREWALL_BODY_C joined to the transfer case and the floor.
- Passenger floor trunk, mirror of the driver's: J_CAB_FLOOR_P, J_FLOOR_PR, J_REAR_PASS up to the amplifier, plus a cross-frame link REAR_JCT to J_REAR_PASS. Carries the amplifier, speaker, accessory-battery and ground runs.
- Doors: passenger boot to a new interior hub J_DOOR_R_IN (mirror of L21), then the lock, window, actuator and speaker spokes in both doors.
- Roof: driver A-pillar up to a roof rail (J_ROOF_FD, MD, CD, RD), front header to the three clearance lamps and the mirror monitor, cross-bows to the dome and cargo lamps, rear header to the CHMSL, rear corner post down to the tail lamp.
- Rear: spokes from TAIL_CLUSTER across the rear panel to both tail lamp assemblies (backup and marker lamps hang off those), plate lamp, camera, tailgate switch, motor and cutout; speakers off the subwoofer and amplifier.
- Bay, body side: bay face of bulkheads A/B/P (J_BAY_BODY_D), a cowl crossing along the firewall top behind the intake (J_BAY_COWL_D to J_BAY_BODY_P) for the driver-side bulkhead to passenger-side device pairs, a passenger power rail (PDM15, fuses, isolator, ground bank, accessory battery, DC-DC) to the radiator support, and a front loop across the radiator support (J_BAY_CORE_D/P) for the lamps, horn and A/C switches. The rail joins the engine trunk only at FAN_JUNCTION to J_BAY_P_MID.
- Seven coincident-point ties (0.1 in each, because the branch writer rejects length 0): AT_HL_SW with DASH_CLUSTER, AT_HORN_SW with STEER_COL, AT_DOOR_L/R_PASS with DOOR_BOOT_L/R, GND_SPLICE_REAR with REAR_JCT, SUB_2 with K5H_Subwoofer, RAIL_COIL_PWR with VALLEY. A better fix is one point per spot, or a router rule that treats equal coordinates as one point.

## Clearance (BVH nearest surface, 10 mm samples, own device excluded)
- 35 of 116 branches are under 10 mm and 59 under 25.4 mm. Almost all are runs along a panel or a frame channel that the cab's layered shells (Interior_Main, Under_Main_Blazer, carpets, door and tailgate shells) put at 0 to 3 mm anywhere in the lower cab, plus the C-channel runs. They are hugging, not crossing; none was found inside a closed K5H box. A second pass nudged vias by up to 4 cm and did not move most of them.
- Lowest: K5B_R17 0.0 (Tailgate_Main), K5B_F02 0.1 (Under_Main_Blazer, C-channel), K5B_C29 0.2, K5B_C31 0.2 (carpet), K5B_H12 0.4 (corner post), K5B_C43 0.5, K5B_H10 0.5 (roof), K5B_B27 0.5, K5B_B29 0.5 and K5B_C13 0.6 (the bay faces of bulkheads A/B/P sit on the apron skin), K5B_F03 0.7.
- Heat: no new branch comes within the 25.4 mm hard keep-out. Nearest manifold or exhaust to any new branch, measured away from device ends: 59.7 mm (K5B_B40, PDM15 to the starter, passenger manifold); next 119.5 mm (K5B_C29), then 173 mm and up. The starter itself sits against the passenger manifold in the twin (x overlap, 1 cm); that is the placement, not the harness.
- Engine-flaw cases: each branch carries a second figure with the engine insert moved 150 mm forward where it differs by 10 mm or more. K5B_B30 (cowl crossing) goes from 3.3 mm (the coils) to 31.2 mm (the hood); K5B_B61 (A/C compressor, 32.1 mm as-is) and K5B_B62 (brake warning switch, 24.1 mm) drop to 0 mm because they run in front of the engine. The dash chain beside PDM30 (K5B_C16-C18) reads 30 to 34 mm only because the route study nudged it off the block's rear face; PDM30 itself is against the block.
- RAIL_INJ_PWR sits inside the Holley intake box in the twin; K5B_B64/B65 leave the box and their figure excludes the intake.

## Existing branches that look wrong or fragile
1. The engine-front group in the first study is drawn against the flawed engine position. With the engine insert moved 150 mm forward: K5B_B04 -0.0, B06 -0.0, B07 -1.5, B08 0.0, B09 -1.7, B05 0.6 mm, so they would sit in the engine front and accessory box. Redraw them after the twin engine is fixed.
2. K5B_C04 (J_CAB_DASH to PDM30): 3.2 mm to K5H_Head_D as the twin stands (19.4 mm with the engine moved). PDM30 is against the head rear.
3. K5B_C06 and K5B_C09 lie on the carpet mesh (1.1 mm and 0.2 mm in this run; the first study reported 19.2 and 30.3, so it did not count the carpet). Fine as a route, wrong as a clearance claim.
4. K5B_B12 and K5B_B16 (D_MID/P_MID into the injector rows) and the injector hops B13-B19 measure 9 to 10 mm here against 45 to 60 mm in the first study, a difference in method (injector boxes versus rail boxes); the route is not the issue.
5. L27 ends inside the E-Stopp actuator box, L26's last stretch touches Tailgate_Main (0.2 mm), K5B_R03 starts inside the spare tire (the amplifier flaw).
6. Ends and lengths of all 43 existing branches match the live points and their polylines to within 0.3 in; nothing found wrong there.

## Data and placement findings
- FIREWALL_BODY_A/B/P are at x 0.64, about 7 cm outboard of the inner apron (x 0.565); their bay-face branches (B26-B29) run on the apron skin. Low-confidence placements; worth setting at the mock-up.
- FIREWALL_BODY_B and P carry wires to passenger-bay devices (ISOLATOR, BLOWER_RES, BLOWER_MOTOR, PDM15, FUSE_ISO_SW_PWR), 1.1 m across the bay. They route over the cowl (68 to 81 in). If those devices stay on the passenger side, the plates belong there too.
- Cab to bay ground and power wires with no bulkhead endpoint use FIREWALL_GROMMET: PDM30 to GND_BANK_ENG (2), AMP_STEP_CTRL to GND_BANK_ENG, FUEL_TANK to GND_BANK_ENG, FUEL_TANK to PDM15, AMP_BLOCK to GND_BANK_ENG, ACC_BATT to AMP_BLOCK (7 segments). mounts.yaml still marks the grommet as needing a ruled exception to "nothing but the 61-pin goes through the firewall"; if that is refused these 7 have no legal path.
- FIREWALL_61 to PDM15 (2 wires) routes through the injector power rail splice (J_BAY_D_MID to Inj 3 to RAIL_INJ_PWR to Inj 4 to J_BAY_P_MID), 73 in, because that is shorter than the front-of-engine trunk. Plausible, but it is the router's choice, not a drawn trunk.
- Backup_Camera to MIRROR_MON routes 231 in (5.9 m) via the tail lamp, rear corner post, driver roof rail and header.
- Twin flaws hit: engine insert 0.15 m back (above), Exterior_Roof hidden (unhidden for the test; the roof is crowned, rail points sit near x 0.68-0.70 and about 50 mm under it), combined lamp meshes (lamp spokes end at the placed per-side points), dome, mirror and plate objects at the origin (excluded from the test), K5H_MoTeC_PDM30 legacy box in the cab (counted as an obstacle for K5B_C29 only).
- Not verified: nothing was checked against the real truck; every polyline is a hand route in a crude twin. Confidence: 72 low, 44 medium, none high.
