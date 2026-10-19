---
id: 2026-10-15_k5-route-segments
change_type: substrate_correction
scope: supabase/migrations/20261015220000_k5_harness_branches_and_routing.sql (load_harness_branches, route_harness_segments); docs/wiring/calc-data/catalog/route_branches.yaml (39 branches, 9 junctions); load_map_rows.py (loads them and routes after every run); research/2026-10-15_route-branches.md; supabase/sql/test_k5_harness_branches_and_routing.sql
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 33: the route graph gets its branches, and segments are routed over them

**Gap.** Segments routed over topology have been 0 / 670 since the route graph landed (pass 12):
- 24 of the June twin's 30 branches fell with the points the record overtook;
- the 7 still standing joined no two plugs;
- nothing could write a branch or a routing after the pass 12 migration.

Pass 31 placed the M130 and PDM30. Live at 18:34Z, 143 / 670 segments had both plugs at a standing point.

**Evidence:** the system's route study of 2026-10-15 (research/2026-10-15_route-branches.md), hand-routed trunk and
branch in the twin, with clearance by a headless-Blender BVH test at 10 mm sampling.
- 38 branches and 9 junctions, 536.5 in. K5B_R04 joins the amplifier and subwoofer junction to the rear along L26's
  first leg.
- The 61-pin is the only firewall crossing, and no branch passes through a mesh except at the 61-pin and the tunnel
  grommet.
- The nearest manifold or exhaust box away from device ends is 88 mm, so nothing is inside the 25.4 mm keep-out.
- 34 of the 36 point pairs the live segments need are joined. FIREWALL_61 to DEL_STRIBUTOR (8 wires) and to CKP
  (3 wires) are not, because those points are unplaced.

**Change:**
- `load_harness_branches` writes the design record's branches append-only. A redrawn branch supersedes its row, and
  its method carries a geometry hash because code plus method is unique.
- `route_harness_segments` routes each segment between standing points along the shortest branch chain (repeated
  relaxation on point codes). It writes harness_routings where a path is new or changed and supersedes an old path.
  It counts segments whose plugs share a point, whose points no chain joins, and whose plug is unplaced.
- The loader loads the junctions (through `load_harness_topology_points`) and the branches, then routes.

**Contract (PG17, on top of pass 31):**
- The router takes A–B–C over the longer A–C.
- It is idempotent, and a redrawn branch re-routes the segment.
- An unjoined pair is counted, not routed; a branch to no point refuses the load; visitors cannot call either
  function.

**Findings recorded for the next passes:**
- **The twin's engine sits about 15 cm into the cab.** The block rear is at y −1.30 and the heads at −1.33, against a
  firewall at −1.447. MAP, OilPress, CMP, CLT and the PDM30 therefore sit in impossible places in the twin, and their
  branches are confidence low.
- **The twin's iBooster sits 20 mm above the 61-pin point.** On the truck the iBooster and the 61-pin both claim the
  driver firewall, which needs a check.
- **Thin clearances:** CMP's approach is −10 mm against the block's crude box; the oil-temp leg is 0 mm against the
  oil-pan box over its last 15 cm; the subwoofer branch is 0.2 mm on the load floor; IAT is 4.3 mm.
- **docs/wiring/HARNESS_RULES.md does not exist on main.** The study used objectTraits.ts, k5LandmarkPaths.ts,
  K5_WIRING_STATE rows 0ag/0ah/0aj and chapter 18 §1–3.
