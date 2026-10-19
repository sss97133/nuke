---
id: 2026-10-14_harness-connectivity-levels
change_type: schema
scope: new tables harness_signals, harness_nets, harness_segments, harness_topology_nodes, harness_routings; new keys on vehicle_harness_landmarks, harness_endpoints, wiring_decision_links, connector_cavity_layouts, wire_termination_specs
proposal: schema_proposals cdfc46c3 (supersedes 006d44ec), approved for build 2026-10-14 under owner direction
case: docs/ledger/theory/data-machine-cases.md 13.12, 13.12.1
migration: supabase/migrations/20261014060000_harness_connectivity_levels.sql
contract: supabase/sql/test_harness_connectivity_levels.sql (PG17, CI job harness-connectivity-contract)
---

# The harness at four connectivity levels

Owner, 2026-10-14: the harness is a structured model in Postgres, "completely ingested into the proper data model".
VEC (VDA 4968) keeps signal, net, physical wire and topology apart; `vehicle_custom_circuits` held all four in one
row, so wire #110 (coolant temp) is one row with four end rows because it passes the 61-pin firewall connector.

**What this adds (no data yet, additive):**
- `harness_signals`: what the wire means.
- `harness_nets`: what is electrically joined, with its load and its protection (PDM output or fuse, trip setting).
- `harness_segments`: one physical wire between two wire ends. It has a planned length (a prediction) and a measured
  length (the outcome), and its own build state.
- `harness_topology_nodes`, plus `vehicle_harness_landmarks` as the branches between them, and `harness_routings`.
- Mating between plug halves, variant links at wire and wire-end grain, a cavity key on each wire end, and a housing
  key on each cavity layout.

**Proved on PG17 with #110:** one net, two segments meeting at the mated cavity w, reproducing the legacy four wire
ends. The cabin segment is cut and measured while the engine segment stays uncut. Duplicate live rows, invalid build
states, a length without its measurement time and anonymous writes are refused. Every new column is described.

**Unknowns:** none for the schema. Next: the K5 re-ingest from each field's own citation (not from the registry
export), #110 first, with its diff against the legacy rows.
