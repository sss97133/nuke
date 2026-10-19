---
id: 2026-10-15_k5-wire-length-basis-and-pigtails
change_type: substrate_correction
scope: supabase/migrations/20261015270000_k5_harness_wire_length_basis.sql (vehicle_custom_circuits.planned_length_kind / planned_length_basis; plan_harness_segment_lengths re-issued); supabase/sql/test_k5_harness_wire_length_basis.sql; docs/wiring/calc-data/reconcile_v5.py (pigtail design lengths; length_kind 'design'); docs/wiring/calc-data/load_map_rows.py (writes kind + basis); k5_registry.json, DOSSIERS.md, OPTIONS.md, k5-mounts.json (rebuilt)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 42: a wire's length says what it is, and the PDM pigtails get one

**Gap (live as anon, 21:15Z):**
- 82 of 669 segments have no planned length. 36 of them join two plugs at one point, so the route graph cannot measure
  them:
  - the 32 PDM 20 A output pigtails (two 16 AWG legs from the PDM contacts into the in-line M81824/1 splice beside the
    plug);
  - the PCS ignition pin lead;
  - the two fuse-holder line pigtails;
  - ISO_OUT;
  - TG_FEED.
- Their registry rows have no length. Pass 26 gave the pin leads into Superseal contacts a design length (4 in, splices
  on one plug staggered 4 and 6 in, kits_v5.LEAD_IN) and called it "the PDM pigtails' pattern". The pigtails
  themselves never got one, so their stock claimed no feet in the BOM.
- 354 wires carry `planned_length_ft` and nothing says what the number is. In the registry, 206 are routes, 115 zone
  estimates, 25 design lengths and 8 twin paths. The segment planner calls every whole-wire length "zone estimate x pad".

**Change:**
- **Registry.**
  - The PDM pigtails and PCS_IGN_PT take the pin leads' rule: every leg of a splice is one length (PDM_PIGTAIL_NOTE,
    "equal length"), and a box's splices alternate 4 and 6 in by output number. That gives PDM15 OUT1 4 in, OUT2 6 in,
    and so on to OUT13; PDM30 OUT1 to OUT8 likewise.
  - The basis reads "design call ... cut at the formboard". The owner's deferral of the final cut to the formboard
    stands; this is a planned length.
  - `length_kind` learns "design".
- **Model (migration).**
  - `vehicle_custom_circuits` gains `planned_length_kind` (tape | twin | route | design | estimate, checked) and
    `planned_length_basis`. The loader writes both, in place on rows the registry did not otherwise change, like the
    checks.
  - `plan_harness_segment_lengths` names the kind: "design length x pad", "twin path x pad", "registry route x pad",
    or "zone estimate x pad" as in pass 39.
  - A wire whose length is taped on the truck is never re-planned.

**Registry result (against main):**
- 33 wires gain a design length (0.33 or 0.5 ft).
- Wires with no length go from 63 to 30.
- Length kinds of 417 wires: route 206, estimate 115, design 58, twin 8, none 30.
- BOM wire feet rise from 1,449.3 to 1,461.5 ft (16 AWG red 89.7 to 100.0; 20 AWG red 164.2 to 166.1). Carts are
  unchanged.
- check_plug_ends shows the same 11 R13 rows as main.

**Contract (PG17, on top of pass 41):**
- A kind outside the list is refused.
- A 0.33 ft design lead on an unrouted engine segment gives 0.40 ft, "design length x pad".
- A 10.0 ft twin path longer than its 84.4 in route gives 11.50 ft, "twin path x pad ... longer than its route".
- A zone estimate keeps the pass 39 wording.
- A taped wire stays unplanned.
- The planner is idempotent and closed to anon.

**Expected live after the load:**
- Wires with a written kind go from 0 to 387.
- Segments with a planned length go from 587 to about 620 of 669.
- The 25 pin-lead segments and 8 twin-path segments are relabelled from "zone estimate" to their kind.

**Still no length:**
- ISO_OUT (isolator stud B to the distribution stud): the stud spacing is open until the power-spine positions stand.
- TG_FEED (switch to switch in the dash).
- The two fuse-holder line pigtails (Blue Sea holder leads; the vendor's lead length is not on file).
