---
id: 2026-10-15_k5-cavity-key-fold
change_type: data_model
scope: key_harness_wire_end_cavities(); load_map_rows.py calls it after key_harness_wire_ends; one call in the migration for the K5
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015110000_k5_harness_cavity_key_fold.sql
contract: supabase/sql/test_k5_harness_cavity_key_fold.sql (db-contracts)
---

# RSI pass 22: wire ends are keyed to their cavity by a re-runnable fold

**Gap.** RSI passes 2 and 9 keyed the K5's wire ends to the cited cavity library inline, once, inside their
migrations. Their rules:
- the 61-pin halves by exact designator, case kept;
- the M130 and PDM Superseal plugs by number, when the cavity's letter is the plug's letter;
- Deutsch DT and DTP plugs by the series and size in the plug's housing part number.

An end the registry loader inserts afterwards is never keyed. After the loader's 2026-10-15 run (56 ends inserted,
four wires' ends re-inserted), "wire ends keyed to a cavity" fell from 344 to 340 of 884.

**Change:**
- `key_harness_wire_end_cavities(vehicle)` applies the two passes' rules as one function. It acts only on live ends
  with no cavity key yet, and the housing part follows the cavity model (pass 2's rule). It is idempotent and runs as
  service role only.
- The loader calls it after `key_harness_wire_ends`.
- The migration runs it once for the K5.

**Expected live:** the four re-inserted Dakota wires' ends and the new ends on Superseal, 61-pin and Deutsch plugs get
their keys back. Ends on families with no cited layout (GM blade, rings, kit terminals) stay unkeyed, as before.

**Unknowns:** none for this change. The layouts of the other families (GM 56-series blade, Metri-Pack, rings, kit
terminals) are still uncited: that is the remaining cavity backlog.
