---
id: 2026-10-15_k5-route-branches-2
change_type: substrate_correction
scope: docs/wiring/calc-data/catalog/route_branches.yaml (+116 branches, +16 junctions); research/2026-10-15_route-branches-2.md
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 38: the route graph reaches every placed plug

**Gap.** After pass 35 placed 119 plugs, 265 segments (163 point pairs) had standing points that no branch chain
joined. Live at 19:50Z: 125 / 670 segments routed.

**Evidence:** the system's second route study (research/2026-10-15_route-branches-2.md). It drew hand routes in the
twin, headless Blender, with BVH clearance at 10 mm sampling, and checked the result with the router's own
shortest-path rule.
- 116 branches and 16 junctions, 1,507 in: cab and dash 276, bay 482, roof rails and headers 298, rear 210, passenger
  floor and frame 136, doors 105.
- All 196 point pairs the live segments need are joined, covering 390 segments. Confidence: 72 low, 44 medium.
- Body circuits cross on their own bulkheads (FIREWALL_BODY_A/B/P), and power and ground cables on FIREWALL_GROMMET.
  Nothing new crosses the 61-pin.
- The nearest exhaust to any new branch is 59.7 mm (the 25.4 mm keep-out holds).

**Findings carried forward:**
- **The first study's engine-front branches sit in the engine once the twin's insert is moved 150 mm forward**
  (K5B_B04–B09 at -1.7 to 0.6 mm). Redraw them after the twin is fixed. K5B_C04 runs 3.2 mm from the head.
- **Bulkheads B and P feed passenger-bay devices 1.1 m across the cowl**: the isolator, blower resistor and motor,
  PDM15 and a fuse. If those devices stay on the passenger side, the plates belong there too.
- **Seven cab-to-bay power and ground runs depend on the firewall grommet.** mounts.yaml still marks it as needing a
  ruled exception to "nothing but the 61-pin goes through the firewall"; without it these 7 have no legal path.
- **Seven coincident points are tied by 0.1 in branches**, because the writer refuses length 0: AT_HL_SW and
  DASH_CLUSTER, AT_HORN_SW and STEER_COL, the door pass-throughs and boots, GND_SPLICE_REAR and REAR_JCT, SUB_2 and the
  subwoofer, RAIL_COIL_PWR and VALLEY. One point per spot would be cleaner.
- **35 branches clear by under 10 mm**: runs hugging the cab's layered shells and the C-channel, none inside a closed
  box. Every polyline is a hand route in a crude twin, and none has been checked on the truck.

**Change:** catalog/route_branches.yaml gains the 116 branches and 16 junctions. The loader loads them on its next run
(load_harness_topology_points, load_harness_branches, route_harness_segments, plan_harness_segment_lengths).

**Expected after the load:** routed segments from 125 to about 390 / 670; planned segments up; the check "routed
segments planned shorter than their route (must be 0)" runs on about 390.
