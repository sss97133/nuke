---
id: 2026-10-15_route-branches-4
change_type: research
scope: fourth route study: route-graph branches that cut the detours left after the engine correction
by: system (engineering call)
---

# K5 harness route branches, fourth study: cutting the detours

Files: route_branches_4.yaml (2 junctions and 27 branches, same shape as catalog/route_branches.yaml, all codes new), this report. Frame: +x driver, -y front, +z up, metres. Twin: K5_harness_workspace_v2.blend, headless, never saved. Read-only: no commits, no database writes, no point moved. Baseline: the live graph after the third study's load (173 points, 179 branches, 517 segments, read 2026-10-15 after 23:10Z).

## Result
- **Segments more than 2x their straight line:**
  - Before: 93 of 443 routed (54 point pairs).
  - After: 16 (13 pairs).
  - Each of the 16 is kept with its reason below.
- **Excess beyond a 1.4x harness path:**
  - On the over-2x segments: 245.6 ft before, 56.8 ft after.
  - On all 443 segments: 344.8 ft before, 164.4 ft after.
  - The 93 listed segments' routes total 509.5 ft before and 330.9 ft after.
- **Walk:** the shortest-path rule of route_harness_segments, run over the live branches plus this delta, joins 443 of 443 routable segments. The 62 segments that start and end on one point and the 12 on an unplaced plug are unchanged.
- **Added:**
  - 22 engine-bay branches, K5B_E18-E39.
  - 5 cab and door branches, K5B_S01-S05.
  - 2 junctions: J_ENG_D, driver rear of the engine, low; J_ENG_P, passenger rear, low.
  - Total length 423.9 in.
  - Every branch carries at least one live segment on the walk.
- **Clearance (nearest mesh every 10 mm, the end's own device excluded within 60 mm):**
  - 26 of 27 branches keep 10 mm or more. The engine-bay minimum is 10.2 mm (K5B_E30 and E33 against their own coils, beyond the 60 mm end window).
  - The one exception is K5B_S03, at 3.4 mm to the cab tunnel shell (see below).
  - Exhaust minimum 28.3 mm (K5B_E21 to header_L), against the 25.4 mm keep-out.
  - No segment passes through a mesh, the corrected engine or the 6L90.
- **Confidence:** 5 medium, 2 low-medium, 20 low.
  - A branch takes the lower of its two end points' confidence.
  - Any branch under 10 mm is low.

## What was wrong
The third study placed J_ENG_REAR (behind the intake, z 1.12) but did not join it to FIREWALL_61. Every wire from the 61-pin to the rear of the engine therefore went forward to VALLEY and came back:
- the coils and their head ground;
- the knock, crank, cam and coolant sensors;
- the throttle body;
- MAP;
- oil pressure and temperature;
- the Dakota senders.

The rest were spurs elsewhere: cab pairs walked through the dash chain or a door hub, the tunnel exit, and short engine-top hops.

## Method
- **Scene:** the third study's.
  - The corrected engine: engine_ls3 at root (0, -1.432, 0.72).
  - The v3 throttle body, starter and 6L90.
  - The coil cluster and Del-Stributer plate lifted 97 mm clear of the intake.
  - The workspace body, with the hood inner panel excluded and the photo-measured firewall recess (x +/-0.36, z 0.80-1.25) given a back wall at y -1.379.
  - The FR88 frame.
- **Engine bay: a grid planner.**
  - 10 mm grid. A cell is free at 10 mm or more from any mesh and 28 mm or more from exhaust.
  - A* with a clearance penalty, then line-of-sight simplification.
  - The first pass let the simplification keep any shortcut whose 8 mm samples stayed 8 mm or more from the nearest surface sample. On 11 branches the corners dipped to 7.4-9.9 mm.
  - Those 11 were re-planned with a 10-12 mm acceptance. All now measure 12 mm or more, at a cost of 0.6 in at most per branch.
- **Cab and doors: hand polylines,** checked by the same measure.
  - A grommet, bulkhead, door pass-through, door switch or behind-the-dash splice sits in a panel, so the body shells within 30 mm of that end count as its own device.
  - The live L21 and K5B_D02 cross the door shells the same way.
- **Pair metrics:**
  - Straight line: point to point.
  - Route: the sum of distance_in on the shortest walk.
  - Excess: route minus 1.4 x straight, per segment.

## Decisions on the pairs flagged for a case-by-case call
- **Door lock switch to its door pass-through (both doors, 14 segments):**
  - 2.12-2.15x before, 1.39x after.
  - K5B_S04 and S05 run inside each door from the hinge boot up the door's front to the switch. The graph had sent them in through the door hub and back.
  - The right switch to the driver lock actuator stays at 2.09x (12.11 ft, was 13.09). The wire crosses the cab and runs through both doors, each leg forward to its hinge boot. That is the run.
- **PDM30 to STEER_COL and AT_HORN_SW (7 segments):**
  - 2.10-2.11x before, 1.00-1.01x after.
  - K5B_S01 runs straight across the dash underside.
- **GSS_SENSOR to GSS_3000 (3 segments):**
  - 3.30x before, 1.39x after.
  - K5B_S03 runs from the cab side of the tunnel grommet up the tunnel's driver flank to the dash centre.
  - It also takes the transfer-case ground from 2.08x to 1.49x.
- **PDM30 to MIRROR_MON (2.78x), and CLEARANCE_R to GND_BANK_CAB (2.44x):** kept.
  - These are roof devices. The only way up is the driver A-pillar from the hinge pillar, then the header.
  - The straight line runs through the windshield.
  - Six more roof pairs stay over 2x for the same reason.
- **TG_CUTOUT to AT_TG_MOTOR_ACI (2.03x):** kept.
  - The cutout switch is on the body's latch-side jamb and the motor is inside the tailgate.
  - The wire enters the gate at its one pass-through, which the graph models at TAIL_CLUSTER.
  - A direct branch would cross the gate's shell with no pass-through.

## Engine bay network
- **K5B_E18:** FIREWALL_61 to J_ENG_REAR, inboard along the firewall and across the recess behind the driver valve cover. It is the trunk: 26 point pairs ride it.
- **K5B_E19:** FIREWALL_61 down to J_ENG_D.
  - E20-E22 run forward along the driver block side to knock 1, coolant temperature and the cam sensor.
  - E23 crosses the back of the engine over the bellhousing to J_ENG_P.
  - E24-E26 serve knock 2, the crank sensor and oil temperature.
- **From J_ENG_REAR:**
  - E27 to MAP;
  - E28 over the cluster to the throttle body;
  - E29 to injector 8;
  - E30-E33 onto the rear-row coils 5-8.
- **K5B_E39:** FIREWALL_61 direct to injector 7 (and on to injector 5) along the driver rail's outboard side.
- **Shortcuts:**
  - E34, from the passenger trunk to the coil power splice (PDM15 to RAIL_COIL_PWR, 2.95x to 1.25x);
  - E35-E36, from the injector power splice to injectors 1 and 2;
  - E37, the radiator fan ground to the engine ground bank;
  - E38, the blower resistor to the motor.
- **Not joined:** J_ENG_REAR to J_ENG_P. No segment's shortest walk used it: the low crossing E23 is shorter from the 61-pin.

## Branches added
Codes without the K5B_ prefix. Minimum clearance is measured away from the branch's own end devices. Exhaust is shown where it comes within 100 mm. Pairs = live point pairs whose shortest walk uses the branch.

| Code | From | To | in | Min mm (nearest) | Exhaust mm | Pairs | Confidence | Follows |
|---|---|---|---|---|---|---|---|---|
| E18 | FIREWALL_61 | J_ENG_REAR | 24.7 | 14.5 (Under_Main_Blazer) | 51.3 | 26 | medium | from the 61-pin's engine face inboard along the firewall and across the recess behind the driver valve cover |
| E19 | FIREWALL_61 | J_ENG_D | 8.3 | 17.6 (Under_Main_Blazer) | 44.5 | 6 | medium | from the 61-pin's engine face down behind the driver header's rear end |
| E20 | J_ENG_D | KS1 | 12.0 | 10.5 (Under_Frame_Blazer) | 29.6 | 1 | low | forward along the driver block side under the head to knock sensor 1 |
| E21 | J_ENG_D | K5H_CLT | 27.1 | 15.0 (head_L) | 28.3 | 1 | low | forward along the driver block side to the front of the driver head |
| E22 | J_ENG_D | CMP | 32.3 | 12.8 (front_cover) | 29.3 | 1 | low | forward along the driver block side to the cam sensor on the front cover |
| E23 | J_ENG_D | J_ENG_P | 29.3 | 12.0 (bell_face) | 36.0 | 3 | medium | across the back of the engine over the bellhousing top, in the firewall recess |
| E24 | J_ENG_P | KS2 | 13.3 | 13.4 (Under_Frame_Blazer) | 28.6 | 1 | low | forward along the passenger block side under the head to knock sensor 2 |
| E25 | J_ENG_P | CKP | 6.6 | 28.6 (header_R) | 28.6 | 1 | low | down the passenger block side to the crank sensor |
| E26 | J_ENG_P | K5H_OilTemp | 20.1 | 16.5 (E3_Starter_DFSR-8715) | 30.2 | 1 | low | down the passenger block side to the oil temp sensor on the pan |
| E27 | J_ENG_REAR | MAP_SENSOR | 6.3 | 40.8 (E3_Coil_7) | - | 1 | low | straight up from the rear-of-engine junction to the MAP point |
| E28 | J_ENG_REAR | THROTTLE_BODY | 17.7 | 12.5 (E3_TB_MotorHousing) | - | 1 | low-medium | over the coil cluster to the passenger side of the throttle body |
| E29 | J_ENG_REAR | K5H_Injector_8 | 8.0 | 12.1 (E3_DelStributer_Plate) | - | 3 | medium | behind the passenger rail's rear end, along its outboard side to injector 8 |
| E30 | J_ENG_REAR | K5H_Coil_5 | 7.7 | 10.2 (E3_Coil_5) | - | 2 | low | from behind the cluster onto coil 5 (rear row) |
| E31 | J_ENG_REAR | K5H_Coil_6 | 6.0 | 15.0 (E3_Coil_6) | - | 2 | low | from behind the cluster onto coil 6 (rear row) |
| E32 | J_ENG_REAR | K5H_Coil_7 | 6.0 | 15.0 (E3_Coil_6) | - | 2 | low | from behind the cluster onto coil 7 (rear row) |
| E33 | J_ENG_REAR | K5H_Coil_8 | 7.7 | 10.2 (E3_Coil_8) | - | 2 | low | from behind the cluster onto coil 8 (rear row) |
| E34 | J_BAY_P_MID | RAIL_COIL_PWR | 18.7 | 19.9 (E3_Coil_2_Tower) | - | 8 | low | from the passenger trunk over the passenger valve cover, behind the throttle body, to the coil power splice |
| E35 | RAIL_INJ_PWR | K5H_Injector_1 | 6.6 | 14.5 (intake_300-131) | - | 1 | low | over the intake runners, in under the driver rail to injector 1 |
| E36 | RAIL_INJ_PWR | K5H_Injector_2 | 7.7 | 14.5 (intake_300-131) | - | 2 | low | over the intake runners, in under the passenger rail to injector 2 |
| E37 | K5H_RadFan_1 | GND_BANK_ENG | 34.9 | 14.1 (tensioner) | - | 1 | low | across the bay between the fan shroud and the engine front, to the engine ground bank |
| E38 | BLOWER_RES | BLOWER_MOTOR | 7.6 | 51.4 (Under_Main_Blazer) | - | 1 | low | the blower resistor's leads straight to the blower motor on the same housing |
| E39 | FIREWALL_61 | K5H_Injector_7 | 21.8 | 13.0 (Under_Main_Blazer) | 51.7 | 2 | medium | from the 61-pin inboard under the iBooster, up behind the driver valve cover in the recess, along the driver rail's outboard side to injector 7 |
| S01 | PDM30 | STEER_COL | 9.0 | 46.7 (Dash_Main) | - | 2 | low-medium | dash underside from the PDM30 straight across to the steering column |
| S02 | SPL_ISO_YEL | M130 | 13.8 | 37.1 (Dash_Main) | - | 9 | low | behind the dash from the isolator splice to the M130 |
| S03 | TUNNEL_6L90 | GSS_3000 | 25.9 | 3.4 (Interior_Main) | - | 2 | low | cab side of the tunnel grommet, up the tunnel's driver flank clear of its crown, to the dash centre |
| S04 | DOOR_BOOT_L | AT_LOCK_SW_L | 22.4 | 36.3 (Door_Left_Details) | - | 2 | low | inside the driver door from the hinge pass-through up the door's front to the lock switch |
| S05 | DOOR_BOOT_R | AT_LOCK_SW_R | 22.4 | 36.3 (Door_Right_Details) | - | 3 | low | inside the passenger door from the hinge pass-through up the door's front to the lock switch |

## Notes on single branches
- **K5B_S03, 3.4 mm.** Every route from the tunnel grommet rides the tunnel shell (Interior_Main) for about 40 mm, just past the grommet's 60 mm end window.
  - Four variants measured 1.9, 1.0, 3.4 and 3.4 mm, and none crossed the shell. The one adopted is 3 in longer than the shortest, for 1.5 mm more.
  - A loom clipped along the tunnel sits on it.
- **K5B_E27 (MAP).** It ends on the MAP point, which still floats at its v2 spot above the corrected intake (the third study's open item). Redraw it when the port is placed.
- **FIREWALL_61 to K5H_OilTemp, 1.99x.** This pair sits just under the line.
  - It crosses behind the engine, low over the bellhousing, and the straight line runs through the block.
  - A route over the top, through J_ENG_REAR and down the passenger rear corner, measured 4.8 in longer. That link (17.7 in) is not added, because no segment would use it.

## Still over 2x: 13 pairs, 16 segments
| From | To | Segs | Straight ft | Old ft | Old x | New ft | New x | Why it stays |
|---|---|---|---|---|---|---|---|---|
| FIREWALL_BODY_B | K5H_iBooster | 1 | 0.85 | 2.93 | 3.45 | 2.93 | 3.45 | placement: bulkhead B sits outboard of the inner apron (x 0.64 m, apron edge 0.565 m); the best planned direct run was 33.7 in against 35.2 in today |
| CARGO_LAMP | GND_SPLICE_REAR | 1 | 4.34 | 13.66 | 3.15 | 13.66 | 3.15 | roof lamp grounded at the rear floor splice: up to the roof rail, down the rear corner post, along the floor |
| MIRROR_MON | GND_BANK_CAB | 1 | 2.93 | 8.95 | 3.06 | 8.95 | 3.06 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| PDM30 | MIRROR_MON | 2 | 3.05 | 8.46 | 2.78 | 8.46 | 2.78 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| CLEARANCE_R | GND_BANK_CAB | 1 | 3.68 | 8.97 | 2.44 | 8.97 | 2.44 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| CLEARANCE_C | GND_BANK_CAB | 1 | 3.53 | 8.22 | 2.33 | 8.22 | 2.33 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| CHMSL | GND_SPLICE_REAR | 1 | 5.32 | 12.12 | 2.28 | 12.12 | 2.28 | as the cargo lamp |
| PDM30 | CLEARANCE_R | 1 | 3.86 | 8.48 | 2.19 | 8.48 | 2.19 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| CLEARANCE_L | GND_BANK_CAB | 1 | 3.50 | 7.48 | 2.14 | 7.48 | 2.14 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| PDM30 | CLEARANCE_C | 1 | 3.63 | 7.73 | 2.13 | 7.73 | 2.13 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| AT_LOCK_SW_R | lock_actuator_DS | 2 | 5.80 | 13.09 | 2.26 | 12.11 | 2.09 | crosses the cab through both doors; each door leg runs forward to its hinge boot |
| DOME_LAMP | GND_BANK_CAB | 1 | 5.73 | 11.78 | 2.06 | 11.78 | 2.06 | roof device: up the driver A-pillar from the hinge pillar, then the header; the straight line runs through the windshield |
| TG_CUTOUT | AT_TG_MOTOR_ACI | 2 | 1.97 | 4.00 | 2.03 | 4.00 | 2.03 | the tailgate loom enters at one pass-through, modelled at TAIL_CLUSTER |

What would shorten them:
- **The roof pairs:** a roof-local ground (a ground stud at the roof rail or the A-pillar top) for the clearance, dome, cargo and mirror lamps. That is a design call; the graph is right for the current ground plan.
- **The cargo lamp and CHMSL grounds:** they come down the rear corner post to the driver tail lamp, then go across the rear panel to TAIL_CLUSTER and forward along L26.
  - A branch from the driver tail lamp to the rear floor junction J_REAR_TAIL was tried in three shapes (43.7-44.9 in). Each crossed the rear body shell and the frame mesh at 0.7 mm. It would save about 1.6 ft and still leave both pairs over 2x.
  - The rear is not measured: tape item T-09 (rear run lengths) settles it.
- **FIREWALL_BODY_B to K5H_iBooster:** this is a placement question. Bulkhead B sits outboard of the inner apron (x 0.64 m; the apron edge is at 0.565 m), so any run goes round the apron edge. The best planned direct run was 33.7 in against 35.2 in today.

## Fixed: 41 pairs, 77 segments (worst first, by the old ratio)
| From | To | Segs | Straight ft | Old ft | Old x | New ft | New x | New path |
|---|---|---|---|---|---|---|---|---|
| FIREWALL_61 | DAK_OILP_TEE | 2 | 1.55 | 6.52 | 4.21 | 2.70 | 1.75 | E18 > E12 > E13 |
| DAK_OILP_TEE | FIREWALL_61 | 1 | 1.55 | 6.52 | 4.21 | 2.70 | 1.75 | E13 > E12 > E18 |
| FIREWALL_61 | CKP | 3 | 2.32 | 9.53 | 4.10 | 3.68 | 1.59 | E19 > E23 > E25 |
| FIREWALL_61 | KS1 | 2 | 1.31 | 5.29 | 4.04 | 1.69 | 1.29 | E19 > E20 |
| FIREWALL_61 | K5H_OilPress | 3 | 1.60 | 6.41 | 4.01 | 2.59 | 1.62 | E18 > E12 |
| FIREWALL_61 | K5H_Coil_8 | 1 | 1.59 | 6.01 | 3.78 | 2.70 | 1.70 | E18 > E33 |
| FIREWALL_61 | K5H_Coil_4 | 1 | 1.62 | 5.77 | 3.55 | 2.92 | 1.80 | E18 > E01 > E05 |
| FIREWALL_61 | K5H_OilTemp | 2 | 2.41 | 8.48 | 3.52 | 4.81 | 1.99 | E19 > E23 > E26 |
| FIREWALL_61 | KS2 | 2 | 2.45 | 8.53 | 3.48 | 4.24 | 1.73 | E19 > E23 > E24 |
| GSS_SENSOR | GSS_3000 | 3 | 1.65 | 5.46 | 3.30 | 2.29 | 1.39 | C41 > S03 |
| FIREWALL_61 | K5H_Injector_7 | 1 | 1.36 | 4.47 | 3.28 | 1.82 | 1.34 | E39 |
| FIREWALL_61 | K5H_Coil_7 | 1 | 1.77 | 5.63 | 3.18 | 2.56 | 1.45 | E18 > E32 |
| FIREWALL_61 | K5H_Coil_3 | 1 | 1.80 | 5.68 | 3.16 | 2.83 | 1.57 | E18 > E01 > E04 |
| M130 | COIL_GND_HEAD_REAR_P | 2 | 2.60 | 7.77 | 2.99 | 3.95 | 1.52 | C02 > C01 > E18 > E10 |
| PDM15 | RAIL_COIL_PWR | 1 | 1.83 | 5.38 | 2.95 | 2.29 | 1.25 | B37 > B38 > E34 |
| FIREWALL_61 | K5H_Coil_6 | 1 | 1.96 | 5.63 | 2.87 | 2.56 | 1.31 | E18 > E31 |
| FIREWALL_61 | K5H_Coil_2 | 1 | 1.99 | 5.68 | 2.86 | 2.83 | 1.42 | E18 > E01 > E03 |
| FIREWALL_61 | MAP_SENSOR | 3 | 2.06 | 5.80 | 2.81 | 2.58 | 1.25 | E18 > E27 |
| FIREWALL_61 | K5H_Coil_5 | 1 | 2.15 | 6.01 | 2.79 | 2.70 | 1.25 | E18 > E30 |
| DAK_CTS_HEAD_REAR_P | FIREWALL_61 | 1 | 2.62 | 7.29 | 2.78 | 3.48 | 1.32 | E11 > E10 > E18 |
| FIREWALL_61 | DAK_CTS_HEAD_REAR_P | 1 | 2.62 | 7.29 | 2.78 | 3.48 | 1.32 | E18 > E10 > E11 |
| FIREWALL_61 | K5H_Coil_1 | 1 | 2.18 | 5.77 | 2.65 | 2.92 | 1.34 | E18 > E01 > E02 |
| FIREWALL_61 | K5H_Injector_5 | 1 | 1.48 | 3.79 | 2.57 | 2.49 | 1.69 | E39 > B15 |
| FIREWALL_61 | K5H_Injector_8 | 1 | 2.16 | 5.48 | 2.54 | 2.73 | 1.26 | E18 > E29 |
| RAIL_INJ_PWR | K5H_Injector_2 | 1 | 0.48 | 1.19 | 2.48 | 0.64 | 1.33 | E36 |
| FIREWALL_61 | K5H_CLT | 2 | 1.90 | 4.54 | 2.39 | 2.95 | 1.56 | E19 > E21 |
| BLOWER_RES | BLOWER_MOTOR | 1 | 0.61 | 1.45 | 2.37 | 0.63 | 1.03 | E38 |
| K5H_Coil_5 | COIL_GND_HEAD_REAR_P | 2 | 0.88 | 2.08 | 2.36 | 1.62 | 1.84 | E30 > E10 |
| FIREWALL_61 | THROTTLE_BODY | 5 | 2.16 | 5.02 | 2.32 | 3.53 | 1.63 | E18 > E28 |
| K5H_RadFan_1 | GND_BANK_ENG | 1 | 2.56 | 5.85 | 2.28 | 2.91 | 1.14 | E37 |
| RAIL_INJ_PWR | K5H_Injector_1 | 1 | 0.51 | 1.18 | 2.28 | 0.55 | 1.07 | E35 |
| SPL_ISO_YEL | M130 | 1 | 0.85 | 1.88 | 2.22 | 1.15 | 1.36 | S02 |
| FIREWALL_61 | CMP | 3 | 2.22 | 4.91 | 2.21 | 3.38 | 1.52 | E19 > E22 |
| FIREWALL_61 | K5H_Injector_6 | 1 | 2.22 | 4.81 | 2.17 | 3.40 | 1.53 | E18 > E29 > B19 |
| AT_LOCK_SW_L | AT_DOOR_L_PASS | 6 | 1.35 | 2.89 | 2.15 | 1.88 | 1.39 | S04 > C37 |
| AT_DOOR_L_PASS | AT_LOCK_SW_L | 2 | 1.35 | 2.89 | 2.15 | 1.88 | 1.39 | C37 > S04 |
| AT_DOOR_R_PASS | AT_LOCK_SW_R | 4 | 1.35 | 2.86 | 2.12 | 1.88 | 1.39 | C38 > S05 |
| AT_LOCK_SW_R | AT_DOOR_R_PASS | 2 | 1.35 | 2.86 | 2.12 | 1.88 | 1.39 | S05 > C38 |
| PDM30 | AT_HORN_SW | 4 | 0.75 | 1.58 | 2.11 | 0.76 | 1.01 | S01 > C15 |
| PDM30 | STEER_COL | 3 | 0.75 | 1.57 | 2.10 | 0.75 | 1.00 | S01 |
| K5H_TransferCase | GND_BANK_CAB | 1 | 2.95 | 6.12 | 2.08 | 4.38 | 1.49 | C10 > S03 > C17 |

## Reproduce
These scripts are in the study's working folder, outside the repo:
- route4.py plans and measures design4.json against the exported scene.
- walk4.py runs the walk over a pull of the live graph plus a delta.
- write_rb4.py writes the YAML.
- check4.py re-reads the YAML on its own and confirms:
  - every end lies on its live point within 2 mm, and every length matches its polyline within 0.6 in;
  - the re-measured clearance, crossing and exhaust figures;
  - no code is live;
  - the walk built from the YAML alone gives the figures above.

**Open, with what closes them:**
- The roof-device ground plan: a design call.
- The rear run lengths: tape item T-09.
- MAP, IAT and fuel-pressure port positions: the third study's open item.
- Bulkhead B's position relative to the apron: placement.
