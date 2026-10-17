---
id: 2026-10-15_k5-node-kind-evidence-carry
change_type: substrate_correction
scope: supabase/migrations/20261015180000_k5_harness_node_kind_evidence_carry.sql (classify_harness_endpoint_nodes, carry_harness_termination_evidence); docs/wiring/calc-data/load_map_rows.py (calls both after every run; a pin splice node's pos_source starts with its plug's anchor); supabase/sql/test_k5_harness_node_kind_evidence_carry.sql
amends: 2026-10-15_k5-pin-lead-wires
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 28: rules that ran once now run after every load

**Gap.** The pass 26 load (2026-10-15 17:28Z) put 25 pin splice nodes and 25 lead wires in the model and re-inserted
68 wires. Live as anon at 17:29Z, the scoreboard fell where the design did not change:
- wire ends with cited evidence 88 / 935 to 51 / 985;
- nets carrying a factory circuit 33 to 26 / 337;
- wire ends at a topology node 446 / 935 to 398 / 985.

There were three causes:
1. **Citations stay on old rows.** `harness_evidence` links on wire ends were written once, by the pass 1 and pass 3
   migrations. The loader re-inserts every end of a wire it re-inserts and sets no `superseded_by`, so 37 device ends
   that did not move (APS, CKP, CLT-ECU, CMP, KNOCK-1, FIREWALL-ENGINE ...) lost their links.
2. **New plugs get no node kind.** `node_kind` (bus or terminals) was set once, by net fold v2 (20261014153000). All
   25 new nodes and SPL-PDM15-OUT8 (pass 24) had none. Their wires were joined only through the splice rows; the B16
   net still held its 12 wires and 3 leads.
3. **New nodes missed the route graph.** `key_harness_endpoints_to_topology` reads the twin anchor at the start of
   `pos_source`. The loader wrote the nodes' source as "beside <plug> pin ..." first, so none keyed to its plug's
   point.

**Change:**
- `classify_harness_endpoint_nodes(vehicle)`: a live plug with no node kind takes the reshape v1 rule. A splice,
  ground bus or stud is a bus; anything else is terminals. A plug that already has a kind keeps it.
- `carry_harness_termination_evidence(vehicle)`: a citation on a superseded wire end is copied to the live end of the
  same wire (circuit code) at the same plug and cavity. An end that moved keeps none, because the citation was about
  its old place. The old links stay.
- **Loader:**
  - calls the node rule before the folds and the carry after the keys;
  - a pin splice node's `pos_source` is its plug's source followed by "— beside <plug> pin <cavity> ...".

**Contract (PG17, on top of pass 27):**
- A new splice plug becomes a bus and a new device becomes terminals; MARKER-LF stays terminals.
- An unmoved end gets both citations, and an end that moved to a splice gets none. The old links stay.
- Both functions are idempotent, and visitors cannot call them.

**Expected live after the load:**
- wire ends with cited evidence back to at least 88;
- nets carrying a factory circuit back to 33;
- wire ends at a topology node up by the 22 positioned nodes' ends.
- The 3 nodes beside PDM15 pins stay unplaced until the PDM15 has a position.
- Wire ends keyed to a cavity stays lower (308 / 985), for a physical reason: 68 wires that were counted as crimped
  into ECU/PDM contacts end in splice barrels, which have no cavity. Their 25 leads take the contacts.
