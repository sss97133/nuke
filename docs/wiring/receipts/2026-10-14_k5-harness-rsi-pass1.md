---
id: 2026-10-14_k5-harness-rsi-pass1
change_type: data_model
scope: harness_evidence (new); harness_segments.design_status/design_note; wiring_decision_links target check; K5 pdm_units/pdm_channels; wire-end catalog keys; stack SH in the stack registry; v_harness_coverage
proposal: schema_proposals 50296583 (approved for build 2026-10-14 under owner direction)
case: docs/ledger/theory/data-machine-cases.md 13.12.2
migration: supabase/migrations/20261014103000_k5_harness_rsi_pass1.sql
contract: supabase/sql/test_k5_harness_rsi_pass1.sql (PG17, CI job k5-harness-rsi-pass1-contract)
---

# RSI pass 1 on the K5 harness model

Owner, 2026-10-14, on the reshape: "a bit light ... data model goes rsi". The model now measures its own coverage per
layer and fills the gaps it can from evidence already in the database.

**Measured on the live rows before the pass, read-only:**
- 783 field-level facts on the K5 (`k5-wiring:*` observations); 586 of them speak to a specific wire end.
- 25 decided wires (50 segments) route through body bulkheads the owner retired on 2026-09-29.
- 927 option couplings could not reach wires. The link check allowed only a decision or a plug as target; that was a
  gap in 20261014060000, now fixed.
- 57 nets reach a PDM output pin (49 on PDM30, 8 on PDM15) whose output number and rating are in `device_pin_maps`.
  The library names PDM30 pins A01 / OUT1_A and PDM15 pins A1 / 'Output 1 (High Side)'; wire ends say A1; both forms
  are matched. 8 PDM15 wire ends name cavities the library does not list (A21, A26 to A30), a library gap.
- The K5 had no PDM units. The two PDM rows are filed on e04bf9c5, another Blazer; they are left there and named.
- 27 terminal and 211 crimp-tool part numbers on wire ends match the catalog exactly.
- 138 concept wires sat outside the model.

**After this pass:**
- Evidence is linked to its wire end or plug, as `supports`, `needs_bench` or `open`.
- Retired routes are `contradicted`, naming the bulkhead and the owner's call.
- Concept wires are `candidate` segments with unknown ends.
- Options reach wires.
- Nets on PDM outputs point at the K5's own PDM channels.
- Exact catalog matches are keyed.
- The harness is stack SH, with 13 needs that `stack_coverage()` reads every hour, and `v_harness_coverage` reports
  each vehicle by layer.

**Still missing, as SH names them:**
- Cavity keys: the library repair.
- Topology and routing.
- Load models on nets.
- The factory baseline and residual.
- Measured lengths: the outcome, as wires are cut.

**Unknowns:** none for this pass.
