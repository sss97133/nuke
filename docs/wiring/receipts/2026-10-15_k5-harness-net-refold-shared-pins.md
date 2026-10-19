---
id: 2026-10-15_k5-harness-net-refold-shared-pins
change_type: data_model
scope: refold_harness_nets() (the net fold as a re-runnable function, with the shared-pin rule); v_harness_pin_occupancy; scoreboard measure "pin cavities shared by several wires"; load_map_rows.py calls the refold after every run
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015033000_k5_harness_net_refold_shared_pins.sql
contract: supabase/sql/test_k5_harness_net_refold_shared_pins.sql (db-contracts)
---

# RSI pass 14: two wire ends in one pin are one electrical node

**Gap.** The net fold joins wires only through bus plugs (splices, ground buses, studs). Two wires landed in the same
pin of a device or connector are one electrical node, but the fold never joins them. Measured read-only on 2026-10-15
on the K5 (decided wires, live ends):
- PDM30-A A24 (OUT19): the 8 marker and clearance-lamp feeds are 8 nets.
- PDM30-A A11 (OUT13): its 5 feeds are 5 nets.
- M130-B B16: the 12 sensor grounds are 12 nets.
- M130-A A02: the 5 sensor 5 V references are 5 nets.
- Both CAN pairs, the dimmer's beam cavities and PDM30 A28's switch returns are split the same way.

In all, 29 pin cavities hold several wire ends, and 89 nets are pieces of 27 electrical nodes. The registry builds most
of these as splices at the pin: `k5_registry.json` "splices" has 37 groups (e.g. M130-B B16 is two D-609-05 group
splices and a lead). The loader drops those splices and lands every wire on the pin, so the model also shows 12 wires
in one Superseal cavity.

**Rule, kept narrow:**
- Cavity labels compare case-sensitively. The D38999 25-61 insert has contacts F and f, and they carry different wires
  (FIREWALL-CABIN F = #15, f = #4f). A first simulation that upper-cased labels joined a coil drive to the sensor
  grounds; it was caught before anything was written.
- Only leading zeros and an underscore are normalised (A02 = A2).
- A cavity named by a stud, lug, post, ring or eyelet does not join. Its text describes the lug, not which stud: AMP-BLOCK
  "stud, lug DL438" holds both the power tail and the ground tail.
- Only decided wires join through a shared pin.

Simulated read-only on production before writing: 27 nodes absorb 89 nets, and no node joins a supply to ground.

**Change:**
- `refold_harness_nets(vehicle)` makes net fold v2 a function and adds the shared-pin rule. On each run it:
  - supersedes the changed nets and their signals, each old net pointing at the net its wires moved to;
  - inserts the new nets and signals;
  - re-points segments;
  - re-reads loads from the physics sizing;
  - re-folds protection (pass 13).
  It is idempotent, runs as service role only, and the loader calls it after every run. A wire end that leaves a shared
  pin splits the node again.
- `v_harness_pin_occupancy` counts wire ends per pin cavity. The scoreboard gains "pin cavities shared by several
  wires": the backlog for loading the registry's splices and doubled terminals into the model.

**Expected on deploy**, predicted read-only from production data:
- 89 nets superseded, 27 created: 338 live nets (was 400).
- 29 of 602 pin cavities shared.
- 0 nets join a supply to ground.

**Not done:**
- The registry's 37 splices at pins, and its doubled terminals, are not loaded as plugs and lead wires. That is the
  loader pass. Until then the model shows several wires in one Superseal cavity.
- 22 decided segments with no wire ends and 20 with one end, also a loader gap.

**Unknowns:** none.
