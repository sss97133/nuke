---
id: 2026-10-15_k5-route-writers-relink
change_type: substrate_correction
scope: supabase/migrations/20261015240000_k5_harness_route_writers_relink.sql (load_harness_topology_points, load_harness_branches re-issued); docs/wiring/calc-data/load_map_rows.py (end-of-run folds run to the end); supabase/sql/test_k5_harness_route_writers_relink.sql
amends: 2026-10-15_k5-route-segments
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 36: the route-graph writers keep unmoved rows, and one failing fold no longer strands the rest

**Gap.** The pass 35 load (2026-10-15 19:36Z) stopped half-way:
- BRAKE_SW's point was written again at the same coordinates with new words, so the point writer gave it a new row;
- branch K5B_C06 still pointed at the old row, so the branch writer tried to insert the same code and geometry again;
- the history-wide unique key (vehicle, code, method) refused it, and the loader exited.

That left routing, the net fold and the splices un-run: "pin cavities shared by several wires with no splice the
design names (must be 0)" read 8 / 9. The remaining steps were run by hand through the same functions at 19:38Z. Every
check came back except one real finding: 8 cut-list lengths are shorter than their plugs' straight line.

**Change:**
- `load_harness_topology_points` writes a new row only when a point moves, to the millimetre.
- `load_harness_branches` re-links a branch in place when its geometry is unchanged but an end point's row was
  re-written. A branch drawn back to earlier geometry gets a revision mark.
- **Loader:** each end-of-run fold reports a failure and the run goes on, so the later folds always run; the run
  exits non-zero at the end.

**Contract (PG17, on top of pass 34):**
- Same coordinates with new words keep the row.
- Two branches on a re-written point are re-linked, with nothing new inserted.
- A branch drawn back to its first geometry loads with a revision mark.

**Finding left red on purpose:** "segments planned shorter than the straight line between their plugs (must be 0)"
reads 8 / 207. Cut-list "dash zone" estimates (3.5 ft, marked needs_rederivation in the state file) can't reach:
- #67 PDM30 to the dome lamp, 5.8 ft straight;
- #79, #90 and #91 to the cab-roof clearance lamps, 3.5–3.9 ft;
- PDM_GND1 and PDM_GND2 to the engine ground bank, 3.6 ft before the firewall;
- #21 and FAN_GND at the fan, 3.2 ft and 2.6 ft against 2.2 ft.

They close when these wires route and their lengths come from the route (the next route study, then a registry pass).
