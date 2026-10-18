---
id: 2026-10-15_route-branches
change_type: research
scope: the K5 harness route graph's branches between standing points (twin route study, headless Blender)
by: system (engineering call)
---

# K5 harness route branches

Files: route_branches.yaml (full data), this report. Frame: +x driver, -y front, +z up, metres. Twin: K5_harness_workspace_v2.blend. Read-only: no commits, no DB writes.

## Result
- 38 new branches, 9 junctions, 536.5 in (13.63 m) of new polyline. Existing live branches L08, L09, L21, L25, L26, L27 kept unchanged (L15 has a NULL polyline because BAT is unplaced).
- Pairs: 36 distinct pairs in live segments. 34 connected (121 wires), 2 not connected (11 wires: FIREWALL_61 to DEL_STRIBUTOR 8, FIREWALL_61 to CKP 3), both because the far point is unplaced. 2 more pairs have both ends at one point (PDM30 15 wires, M130 7), needing no branch.
- M130 and PDM30 were already placed in the DB (0.55,-1.22,0.987 / 0.30,-1.30,0.997); used as is.

## Network
- Cab: FIREWALL_61 (cab face) to J_CAB_DASH at the kick panel (0.55,-1.38,0.90), then spokes to M130, PDM30, STEER_COL, BRAKE_SW; M130 to DASH_CLUSTER; a floor trunk J_CAB_DASH to J_CAB_FLOOR to FLOOR_RR (the June L24 corridor, joins existing L25 to the rear), and a tunnel spur to TUNNEL_6L90 and the transfer case.
- Rear: REAR_JCT to the E-Stopp actuator; the subwoofer and amplifier meet at J_REAR_TAIL, which is the existing L26 vertex (0.40,1.40,0.62). L26 is not redrawn, only treated as split there.
- Bay: FIREWALL_61 (engine face) to J_BAY_FW, then one trunk up the driver inner fender, along the driver valve cover edge at z 1.22 to J_BAY_D_MID and J_BAY_FRONT, across the engine front above the throttle body and damper to J_BAY_P_MID. Branches off it: injector rows (fed at injectors 3 and 4, hopped along the outboard side of each rail), fuel pressure, CLT, IAT, CMP, throttle body, radiator fan, KS1/KS2 from the block-side junctions, and VALLEY entered from the front end of the corridor between the coil rows. The sump sensor (OilTemp) leaves from J_BAY_BLOCK_D, and OilPress from MAP_SENSOR.
- Body circuits are not drawn through FIREWALL_61: no live pair needed one. The 61-pin is the only crossing branch.

## Clearance (BVH nearest-surface, 10 mm samples)
- Lowest: K5B_B07 (CMP) -10 mm vs K5H_LS3_Block. Next: K5B_B24 (OilTemp) 0 vs oil pan box at its last 15 cm, K5B_R02 (subwoofer) 0.2 mm (rests on the load floor where the box sits; the drop into the C-channel is the intended entry), K5B_B08 (IAT) 4.3.
- Everything else is 10 mm or more; trunks are 29 to 62 mm off the valve covers and iBooster. Per-branch numbers are in the YAML.
- Heat: nearest manifold or exhaust box to any branch, measured away from device endpoints, is 88 mm (KS1/KS2 legs), 95 mm (OilTemp leg), 135 mm (block-side junction drops); bay trunks are 190 to 460 mm. No branch is within the 25.4 mm hard keep-out. KS1 and KS2 themselves sit 45 mm from the manifold boxes, which is the twin placement, not the harness.
- No branch passes through a mesh at a grommet or hole except FIREWALL_61 itself (the 61-pin in the original fuse-box punch-out, FB, 4 in) and TUNNEL_6L90 (the tunnel grommet).

## Rules not fully satisfied, and twin faults found
1. The twin engine does not fit the twin body. The block rear is at y -1.30 and head rear at y -1.33; the firewall is at y -1.447/-1.454. The engine boxes poke 12 to 17 cm into the cab and into Dash_Main. This puts MAP, OilPress, CMP, CLT and PDM30 in impossible spots; those branches are marked confidence low and their clearance is only against what the twin has. The engine needs to move forward about 15 cm in the twin before the rear-of-engine routes (OilPress, MAP) mean anything.
2. The iBooster box (x .31-.50, y -1.64..-1.40, z .92-1.18) sits 20 mm above the FIREWALL_61 point: the 61-pin hole and the iBooster collide in the twin. The bay trunk leaves outboard of it (x 0.56).
3. The twin hood inner panel (Under_Main_Blazer, flat at z 1.252) lies below the engine top (coils to 1.34, valley 1.31), so it was excluded (1,344 faces); the hood skin is about 1.34 to 1.37, which leaves 30 to 40 mm above the valley run. The stale stock-engine mesh Under_Engine_Simple is also excluded (owner: not an LS3); its figure is kept as stale_engine_mesh_mm per branch.
4. The mid-mount accessory box (y -2.15..-2.01, z .50-1.05) spans the whole engine front, so CMP, OilTemp and IAT have no clean path in the twin.
5. HARNESS_RULES.md does not exist on origin/main; rules came from objectTraits.ts, k5LandmarkPaths.ts, K5_WIRING_STATE.md rows 0ag/0ah/0aj and chapter 18 sections 1 to 3.
6. Not read in full: chapter 18 formboard section; trunk and branch layout here follows its section 3 segmentation (bulkhead as the boundary) only.

## Not drawn (not needed by any live pair)
DOOR_BOOT_L/R, DOOR_IN_L, DOME, TAIL_CLUSTER beyond L26, STARTER/BAT (L15 polyline NULL), ALT, O2_L/R, K5H_Starter, K5H_VSS, K5H_AC_Compressor, K5H_FuelTank.
