---
id: 2026-10-15_k5-harness-splices
change_type: data_model
scope: harness_splices + harness_splice_members; load_harness_splices(); refold_harness_nets joins through splices; v_harness_pin_occupancy names each pin's splices; v_harness_splice_check (fill against the crimp range); four scoreboard measures; load_map_rows.py passes the registry's splices after every run
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015090000_k5_harness_splices.sql
contract: supabase/sql/test_k5_harness_splices.sql (db-contracts)
---

# RSI pass 16: the design's splices land in the model

**Gap.** The registry designs 37 splices (`k5_registry.json` "splices"):
- 21 "splice at pin" groups: several wires meet in a Raychem stub splice beside an M130 or PDM pin. For example,
  M130-B B16 has two D-609-05 group splices and a third that takes their leads into the pin.
- 16 splice nodes on the route (`SPL-*`). 15 are M81824/1 butt splices, most joining a PDM 20 A output's two pin
  pigtails to its load wire. One is a D-609-05 stub.

The loader dropped all of them. RSI pass 14 counted 29 pin cavities holding several wire ends, but the model could not
tell a designed splice from two wires crowded into one contact.

**Change:**
- `harness_splices`: one splice part. It records where the splice sits (beside a pin, or a splice node), the part and
  the design's own gauge sum. A changed splice is superseded, never edited.
- `harness_splice_members`: one conductor into a splice. It is a live wire, or a lead the design names only in words
  (circuit_id null), with its side on a butt splice. Rows are append-only.
- `load_harness_splices(vehicle, rows, source)` writes the registry's rows. A changed splice is superseded and
  re-inserted, and a splice the rows stop naming is retired. It re-runs the net fold, and it refuses the whole load if
  any net then joins a supply to ground. It is idempotent and runs as service role only. The loader passes
  `reg["splices"]` after every run, and the first load follows the deploy by that same call.
- `refold_harness_nets` also joins decided wires that share a live splice.
- `v_harness_pin_occupancy` gains two columns per pin: the splices beside it, and how many of its wires they hold.
- `v_harness_splice_check` reads each splice side. It sums the conductors' area in circular mils (AWG formula) and
  compares it with the part's crimp range (`catalog_parts` range_awg, from the ProWire 3137CT cavity colours).
  A splice beside a pin also needs the lead that goes into the contact. The registry names one ("pin lead") only at
  M130-B B16.
- New scoreboard measures:
  - splice members keyed to a live wire;
  - pin cavities shared by several wires with no splice the design names (must be 0);
  - spliced pins whose lead into the pin the design names;
  - splice sides outside the part's crimp range (must be 0).

**Expected after the first load:** 37 splices (21 at a pin across 19 pins, 15 in-line, 1 stub). Every listed wire
code is a registry wire, so all members are keyed except the four leads at B16, unless the loader has retired a wire.
1 of 19 spliced pins names its pin lead. The pins pass 14 counted that no splice explains are the design defects left
to fix, such as the dimmer's feed blade carrying PDM30 OUT17 and OUT18.

**Unknowns:** none for this change. The crimp ranges are ProWire's cavity colours converted to circular mils. Raychem's
own D-609 wire-range table, where it differs, would replace them in `catalog_parts`.
