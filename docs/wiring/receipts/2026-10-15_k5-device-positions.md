---
id: 2026-10-15_k5-device-positions
change_type: substrate_correction
scope: docs/wiring/calc-data/catalog/mounts.yaml (119 ends gain a twin `position` and a point; 38 open ends become proposed); mounts_v5.py (an end's position is linted, its point is a route-graph code); load_map_rows.py (a positioned end takes its point, and the points land before the plugs are keyed); research/2026-10-15_device-positions.md
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 35: 119 more plugs are placed on the route graph

**Gap.** After pass 33, 368 of 670 segments could not route because a plug had no position. Live at 18:57Z, 124 live
plugs had no route-graph point: lamps, switches, rail splices, grounds, fuses, body connectors and a few boxes.
mounts.yaml gave most of them only zone words.

**Evidence:** the system's device-position study of 2026-10-15 (research/2026-10-15_device-positions.md), with the twin
read headless (object boxes, connected components, ray casts with the engine insert hidden), the placed points and
mounts.yaml.
- 119 of 124 placed: 6 high, 27 medium, 86 low confidence. Low is mostly a mounts.yaml zone turned into a twin point.
- 86 distinct points. 12 points are shared by 45 plugs (a box and its splices, door pass-throughs, switch panels).
  The PDM30's own pigtail splices sit on the placed PDM30 point; the PDM15's on a PDM15 point.
- Unplaced, with reasons:
  - UNDERHOOD-LAMP: no factory spot, and the hood opens.
  - PS-STUDS: one code for ten studs, which needs splitting first.
  - DAK-CTS, DAK-OILP and COIL-GROUND-RINGS: on the engine insert's rear face, which the twin puts about 15 cm too far
    back.

**Change:**
- Each placed end in mounts.yaml gains `position {point, frame twin, x, y, z, method, confidence, source}`. Open ends
  given a position become proposed.
- mounts_v5.py lints it: a point must be `[A-Za-z0-9_]`, the code the route graph keys by.
- **Loader:** a positioned end takes its point, which the twin anchor or box would otherwise give. Each point lands
  once through `load_harness_topology_points`, typed splice, ground, bulkhead or device, before the plugs are keyed.

**Calls recorded (the system's):**
- **Passenger firewall corner:** it is claimed twice, by the batteries and by the locked Four-Season A/C case. The study
  put the batteries forward of the case, with the PDM15, DC-DC and fuses beside them.
- **PDM15:** if the PDM15 moves to the cab (state row 0ag(b): it is not sealed), its point and its splices move with it.

**More twin flaws found** (for the twin's next correction):
- Lamps that are one mesh for both sides.
- Dome lamp, mirror and plate objects at the world origin.
- The roof is hidden.
- The amplifier sits inside the spare tire.
- The battery, A/C compressor and alternator are on the wrong sides.
- The FWG_MAIN and CKP objects sit outside the body.

**Expected after the load:** plugs at a route-graph point rise by 119 (placed on a twin anchor 77 → 196 of 263 in the
plan). Segments with an unplaced plug fall. Routing reaches the new points only once branches join them (the next
route study).
