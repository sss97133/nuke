---
id: 2026-10-15_k5-net-parallel-outputs
change_type: substrate_correction
scope: supabase/migrations/20261015170000_k5_harness_net_parallel_outputs.sql (harness_nets.protection_pdm_channel_ids; fold_harness_net_protection re-issued; v_harness_pdm_protection_check re-issued); supabase/sql/test_k5_harness_net_parallel_outputs.sql
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 27: paralleled PDM outputs protect a net together, and their limits add

**Gap.** Live as anon on 2026-10-15 17:30Z, "PDM-fed wires not protected by the output the design names (must be 0)"
read 1 of 63. The one row is #86 (LED headlight right): its design feeds it from PDM30 OUT18 (A22), but the model said
OUT17 protects it.

#85 (OUT17, A20) and #86 (OUT18, A22) are each 20 AWG M22759/32 and meet at the floor dimmer's common (receipt
2026-05-14 high-beam floor dimmer). That makes them one net fed by two outputs. The fold kept one protecting output
per net: it took the highest-rated pin, and on a tie the lower channel. So the check was wrong for #86, and the net's
limit read 4 A, one output's setting. A fault on either wire is fed by both outputs until both trip, so the wire must
carry 4 + 4 = 8 A, which is its cap in the registry (pdm_settings: wire_cap_a 8).

**Evidence:**
- MoTeC PDM user manual printed p.6: outputs may be connected in parallel to increase current capacity, and must all
  be of the same type.
- Same manual, pp.22-23: paralleled outputs are configured on a common channel or an identical condition.
- Registry pdm_settings: PDM30 OUT17 and OUT18 are each set, limit 4 A, load 2.95 A (Truck-Lite 27270C, one lamp's
  share), wire cap 8 A, and the rows say "paralleled at the dimmer common".

**Change (migration):**
- `harness_nets.protection_pdm_channel_ids` holds every PDM output whose pin lands on the net, highest-rated first.
  `protection_pdm_channel_id` stays the first of them, so its readers are unchanged.
- `fold_harness_net_protection` writes the set.
  - **Limit:** the sum of the set's programmed limits when every output in it is set, else unknown.
  - **Load:** the sum of the outputs' distinct cited loads, when each output's every load sits in the net. A pair
    that one registry row names (the fan's "PDM15 OUT1 + OUT6") carries one load on both channels, which is counted
    once.
- `v_harness_pdm_protection_check` lists the set, and a wire agrees when the output its design names is in it.

**Contract (PG17, supabase/sql/test_k5_harness_net_parallel_outputs.sql, on top of pass 25):**
- Two 8 A outputs meet at a dimmer common, and the net gets the set OUT17+OUT18, limit 8 A and load 5.90 A.
- Both wires agree with their design.
- One output not set leaves the limit unknown.
- Every single-output net keeps its pass 15 limit and load.
- The fold is idempotent; anon reads the set; anon cannot run the fold.

**Expected live after deploy:** PDM-fed wires not protected by the output the design names: 0 of 63. The
dimmer net's limit goes from 4 to 8 A.

**Unknowns:** how a MoTeC PDM shares a fault between paralleled outputs: whether one trips first and the other then
carries the fault to its own limit, or both trip together. The sum is the upper bound until MoTeC answers. The draft
question is ~/nuke-logs/k5-rsi-20261014/vendor_questions_DRAFT.md (question 3).
