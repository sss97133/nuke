---
id: 2026-10-15_k5-route-lengths-into-cut-list
change_type: substrate_correction
scope: supabase/migrations/20261015250000_k5_harness_estimate_plans_padded.sql (plan_harness_segment_lengths re-issued); supabase/sql/test_k5_harness_estimate_plans_padded.sql; docs/wiring/calc-data/export_route_lengths.py (new); docs/wiring/calc-data/inputs/route_lengths.json (new); docs/wiring/calc-data/reconcile_v5.py (route lengths into the registry); k5_registry.json, DOSSIERS.md, OPTIONS.md, nuke_frontend/public/wiring/k5-mounts.json (rebuilt)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 39: the twin routes become cut lengths, and no estimate stands shorter than its route

**Gap.** After the pass 38 branches (#1690), 397 of 669 segments are routed (live as anon, 20:12Z). The scoreboard's
"routed segments planned shorter than their route (must be 0)" read 14/397. Every one of the 14 is a wire's whole-length
zone estimate from cut list v4.2, copied onto the wire's only segment. Examples: #67 dome lamp, 3.5 ft against an
11.29 ft route; clearance lamps #79/#90/#91, 3.5 ft against 6.99 to 8.48 ft; PDM_GND1 and PDM_GND2, 3.5 ft against
5.91 ft; FAN_GND, 2.2 ft against 5.85 ft. Two more faults sat under them:
- `harness_segments.planned_length_ft` is the length to cut, pad included (its column comment). The 186 segments on
  a copied estimate carried it without the pad, which the registry applies downstream (kits_v5.py, state row 33).
- 207 of 417 registry wires had no length at all. The routes for 120 of them already existed in the model.

**Change:**
- **Model (migration).** `plan_harness_segment_lengths` handles every segment whose plan is empty, a whole-wire
  estimate, or one the planner wrote:
  - Routed, with the wire's estimate no longer than the route: route x pad. The method notes a shorter estimate.
  - Otherwise: estimate x pad (1.20 engine, 1.15 body). The method names the route it beats, or says it is not routed.
  - A planner-written plan with no route and no estimate left is cleared to unknown.
  - Tape, twin-landmark and April concept plans are never touched.
- **Registry.** `export_route_lengths.py` reads the live routes into `inputs/route_lengths.json` (20:19Z: 304 wires
  with a routed segment, 282 fully routed). `reconcile_v5.py` gives a wire with one routed segment either:
  - its route, when it has no length; or
  - the longer of its route and its zone estimate or older twin path.
  Each change carries a `decision` conflict and a basis line. Tape and design lengths stand.

**Registry result (registry versus main, same build):**
- 120 wires gain a route length (611.0 ft unpadded).
- 12 zone estimates rise from 35.8 to 68.7 ft.
- 2 older twin paths rise: PDM_BPOS 1.9 to 5.4 ft (taken before the PDM30 moved to the cab) and #21 2.2 to 4.4 ft.
- Length kinds of 417 wires: route 134, estimate 163, none 87, design 25, twin 8. Main had none 207, estimate 175.
- Wire feet in the BOM scope rise from 1,232.7 to 1,301.1 ft. Cart lines are unchanged.
- check_plug_ends shows the same 11 R13 locked-decision rows as main. Every other rule has 0 FAIL.

**Finding (not fixed here).** The segment fold chains a wire's ends in an order that can double back. Speaker lead 26a
has the hops AMP to SPK-FL and DOOR-L-PASS to AMP; the physical run is AMP, then DOOR-L-PASS, then SPK-FL. Summed, it
reads 28.2 ft against a 6.9 ft estimate. So only one-segment wires feed the registry. The 85 complete multi-hop wires
wait for a fold that orders hops from the wire's from-end through its pass-throughs.

**Twin caveats.**
- The amplifier object sits in the spare-tire well (2026-10-15_device-positions.md).
- The engine insert sits about 0.15 m too far back.
- 22 routes run more than 2.5x their straight line. The worst is KNOCK-1 from the 61-pin, 4.48 ft over 1.08 ft. The
  graph lacks a direct branch there.
- A long route only lengthens a cut, never shortens one. A tape on the truck supersedes all of this.

**Contract (PG17, on top of pass 36):**
- A 2.0 ft estimate on an 84.4 in route gives 8.09 ft by route, and the short-plan measure goes from 1 to 0.
- A 10.0 ft estimate gives 11.50 ft by estimate, naming the route.
- A 7.1 ft estimate, within rounding of the route, gives the route.
- An unrouted engine estimate of 3.0 ft gives 3.60 ft.
- An estimate removed from the wire clears the plan to unknown.
- A tape plan is untouched.
- The planner is idempotent and closed to anon.

**Expected live:** routed segments planned shorter than their route 14 → 0. Segments planned shorter than the
straight line between their plugs fall from 9 and are re-measured after the load.
