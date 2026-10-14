---
id: 2026-10-14_k5-harness-reshape-v1
change_type: data_reshape
scope: K5 (e08bf694) decided wires from vehicle_custom_circuits + wire_termination_specs into harness_signals, harness_nets, harness_segments; harness_endpoints mate for the 61-pin halves; harness_segments.vehicle_custom_circuit_id; distinct-ends check relaxed for unknown ends
case: docs/ledger/theory/data-machine-cases.md 13.12.2
migration: supabase/migrations/20261014093000_k5_harness_reshape_v1.sql
contract: supabase/sql/test_k5_harness_reshape_v1.sql (PG17, CI job k5-harness-reshape-contract)
---

# The K5's wires in the harness tables (reshape v1)

Owner, 2026-10-14: "get them in the new tables, that's the whole point."

**Previewed read-only on the live rows before writing:**
- The 390 decided wires become 247 nets and 500 segments.
- Nets: 20 of them join 163 wires through splices, ground banks and battery studs. The largest is the cab ground
  bank at 75 wires; sensor 0 V returns stay separate, on the ECU's own pins.
- Segments: 58 wires that cross the 61-pin become two segments each. 288 wires are one segment, 98 are two, 2 are
  three and 2 are five.
- Every decided wire has a segment and every wire end except the grommets' is used.
- 42 segments have an unknown end; 22 of those are wires that never had ends recorded.
- 317 of the 390 wires key to an exact catalog wire part.

**Left as candidates:** the 138 concept wires (April 2026 plan, unreviewed, no wire ends). The harness tables have
no design-status column to mark a candidate yet.

**Not yet carried (v2):** per-field citations. Each row keeps the legacy row's source, event time and trust, and
`method` names this reshape.

**Unknowns:** none for the reshape. Segment lengths are unknown for split wires, with the reason on each row,
because the whole-wire estimates were never split.
