---
id: 2026-10-15_k5-kind-and-carry-by-plug-code
change_type: substrate_correction
scope: supabase/migrations/20261015210000_k5_harness_kind_and_carry_by_plug_code.sql (classify_harness_endpoint_nodes and carry_harness_termination_evidence re-issued); supabase/sql/test_k5_harness_kind_and_carry_by_plug_code.sql
amends: 2026-10-15_k5-node-kind-evidence-carry
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 32: the node-kind and citation folds follow a plug by its code

**Gap.** Pass 31 placed the M130 and PDM30, and the loader re-inserted their 30 plugs with new row ids. Live as anon at
18:34Z this exposed two weaknesses in pass 28's folds:
- **Citations:** `carry_harness_termination_evidence` matched a superseded wire end to its successor on the same
  endpoint id, so citations at re-inserted plugs stopped following. Wire ends with cited evidence went 88 → 85 / 985.
- **Node kinds:** `classify_harness_endpoint_nodes` gave a re-inserted plug the generic reshape rule, not its previous
  row's kind. PS-STUDS and MARKER-LF are typed ground but are terminals by evidence (net fold v2). Re-inserted, the
  rule would make them buses, joining battery + to ground and PDM30 OUT19 to ground, and the splice load would refuse
  the whole run.

**Change:**
- A plug with no kind keeps its own previous row's kind (same design and code), with that basis, and a kind set by
  evidence is preferred. Only a plug with no history takes the generic rule.
- A citation follows the wire to the live end at the plug with the same code and the same cavity.

**Contract (PG17, on top of pass 31):**
- A re-inserted ground plug that was terminals by evidence stays terminals, with the kept basis; a new ground plug with
  no history becomes a bus.
- A citation follows its end onto a re-inserted plug.
- Both folds are idempotent.

**Expected live:** cited ends back to 88 or more, after the migration's own run.
