---
id: 2026-10-15_k5-route-length-plan
change_type: substrate_correction
scope: supabase/migrations/20261015230000_k5_harness_route_length_plan.sql (v_harness_route_length_check, plan_harness_segment_lengths, scoreboard measure); docs/wiring/calc-data/load_map_rows.py (calls the planner after routing); supabase/sql/test_k5_harness_route_length_plan.sql
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 34: routed segments get route-based plans, and every plan is checked against its route

**Gap.** Pass 33 routed 121 of 670 segments. Live as anon at 18:57Z, only 15 of those carry a planned length. The
reshape split a wire's whole-length zone estimate only where the wire had one segment, so the rest say "unknown: the
whole-wire estimate was never split at its junctions". The 15 run on average 4.0x their route (minimum 1.88x). No
plan is short, but nothing checked.

**Change:**
- `v_harness_route_length_check`: per routed segment, its route (live branches summed), its plan and planned / route.
- `plan_harness_segment_lengths`: a routed segment with no plan (or a plan this rule wrote) gets route length x pad:
  1.20 in the engine section, 1.15 elsewhere (K5_WIRING_STATE.md row 33, "20 % engine bay, 15 % body"). The method
  names the route, the branch count and the pad. A changed route re-plans it, and a cut-list or measured plan is never
  touched.
- Scoreboard: routed segments planned shorter than their route (must be 0). The loader calls the planner after routing.

**Contract (PG17, on top of pass 33):**
- An unplanned routed segment gets 78.8 in x 1.15 = 7.55 ft, with the method above.
- A short cut-list plan is kept and counted.
- A rerouted path re-plans only rule-written plans, and the planner is idempotent.
- The fixture gains production's vehicle_custom_circuits.harness_section.

**Expected live:** segments with a planned length 268 → about 374 / 670 (the 106 routed segments without one); routed
plans shorter than their route 0.

**Note:** the 4x ratio between the cut list's zone estimates and the twin routes is an open question. Either the zone
estimates are generous, or the routes miss slack and service loops the twin does not model. Measured lengths settle it.
