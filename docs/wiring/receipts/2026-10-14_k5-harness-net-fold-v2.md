---
id: 2026-10-14_k5-harness-net-fold-v2
change_type: data_model
scope: harness_endpoints.node_kind/node_kind_basis; K5 nets refolded (append-only); design loads on nets; physics check on the SH scoreboard; one SH need
case: docs/ledger/theory/data-machine-cases.md 13.12.2
migration: supabase/migrations/20261014153000_k5_harness_net_fold_v2.sql
contract: supabase/sql/test_k5_harness_net_fold_v2.sql (PG17, CI job k5-harness-net-fold-v2-contract)
---

# RSI pass 5: the net fold checks its own physics

**Found** while folding design loads onto nets, read-only, 2026-10-14:
- 14 of the 18 power-spine cables sized from physics sat in one net, GND-BANK-CAB, with every ground cable.
- That net held 80 segments and joined the Odyssey + post and PDM30 OUT19 (A24) to the ground star.

Two plugs broke the reshape's rule that a splice, ground-typed plug or stud is one node:
- **PS-STUDS** is one code for the DC primary's distinct studs: isolator A and B, the distribution stud, starter B+,
  alternator B+, block, frame rail, head and firewall bond. The stud names are in the `vehicle_custom_circuits`
  from/to text.
  - The legacy rows lost the second end of the stud-to-stud cables: #6, #59 and ISO_OUT have one wire end each.
  - The registry marks this topology open: "the registry still carries the v4 runs #63/#6/#59 - the power-spine
    chapter re-draws them".
  - So this pass does not invent the topology. Each PS-STUDS end becomes its own node until the re-draw names each
    stud.
- **MARKER-LF** is a lamp socket with two leads, typed ground. It joined #87 (PDM30 OUT19) to MK_LF_GND.

**Change:**
- `harness_endpoints.node_kind` ("bus" or "terminals") and `node_kind_basis`: the rule as data, with the two
  exceptions and their evidence.
- The fold re-runs with it. Preview on live data: 1 net superseded (GND-BANK-CAB) and 16 added; the other 246 nets keep
  their ids.
- PDM protection is recomputed with pass 1's pin rule.
- Design loads: the largest physics-sized load among a net's wires (`vehicle_custom_circuits` notes from
  `cable_sizing_v5.py`), with peak where cranking is stated.
- New scoreboard measure "nets that join a supply to ground (must be 0)". A supply is a battery + post or a PDM output
  pin; ground is a battery - post. The migration raises if the measure is not 0.

**Not claimed:**
- The DC primary's stud-to-stud topology. It waits on the power-spine re-draw.
- Loads on PDM-fed nets. The design sets each output's current from the device's measured draw (`power_v5.py`), so
  those stay unknown.

**Unknowns:** none for this pass.
