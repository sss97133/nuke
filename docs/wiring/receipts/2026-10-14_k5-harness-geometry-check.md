---
id: 2026-10-14_k5-harness-geometry-check
change_type: data_model
scope: v_harness_segment_geometry; two scoreboard measures; one SH need; write grants revoked on the three harness views (no rows changed)
case: docs/ledger/theory/data-machine-cases.md 13.12.2
migration: supabase/migrations/20261014173000_k5_harness_geometry_check.sql
contract: supabase/sql/test_k5_harness_geometry_check.sql (PG17, CI job k5-harness-geometry-check-contract)
---

# RSI pass 7: planned lengths checked against geometry

A wire cannot be shorter than the straight line between the plugs it joins. 98 K5 plugs carry a position from the
digital twin; `pos_source` names the twin anchor or object.

**Measured, read-only, 2026-10-14:**
- 132 live segments have both plugs positioned.
- 15 of those have a planned length.
- 4 are planned shorter than the straight line:

| Wire | Plugs | Planned | Straight line |
|---|---|---|---|
| #119 | PDM30-B → DAKOTA-VHX | 1.5 ft | 3.6 ft |
| #120 | PDM30-B → DAKOTA-VHX | 1.5 ft | 3.6 ft |
| #71 | PDM30-B → DAKOTA-VHX | 3.5 ft | 3.6 ft |
| #39 | PDM30-A → DAKOTA-VHX | 3.5 ft | 3.6 ft |

Either a position or the plan is wrong. The PDM30's position is the twin's assumption A2, "under dash passenger", in
`output/K5_landmarks_blender_derived.yaml`. That depends on an open placement call, so the check names the four and
fixes neither.

**Change:**
- `v_harness_segment_geometry` and two scoreboard measures: segments with both plugs positioned, and segments planned
  shorter than the straight line (must be 0; 4 today). No rows change.
- The three harness views (`v_harness_coverage`, `v_harness_factory_residual`, `v_harness_segment_geometry`) lose the
  write grants that the schema's default privileges give anon and authenticated. They join, union or aggregate, so
  they were never updatable; this makes them read-only by grant as well. The contract test checks it.

**Unknowns:** none for this pass. The four findings are open questions for the PDM30 placement and the Dakota run
lengths.
