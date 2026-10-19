---
id: 2026-10-15_k5-through-run-route-lengths
change_type: substrate_correction
scope: docs/wiring/calc-data/export_route_lengths.py (each wire's chain); docs/wiring/calc-data/inputs/route_lengths.json (re-exported 2026-10-15 after #1698); docs/wiring/calc-data/reconcile_v5.py (through runs take their summed route); k5_registry.json, DOSSIERS.md, OPTIONS.md, k5-mounts.json (rebuilt); docs/ledger/theory/data-machine-cases.md (passes 35 to 40)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
amends: 2026-10-15_k5-route-lengths-into-cut-list
---

# RSI pass 40, part 2: a wire through one crossing takes its summed route

**Gap.** Pass 39 fed only one-segment wires into the registry, because the segment fold could chain a wire's ends
backwards. #1698 fixed the one wrong start (the AMP speaker leads). After the load (20:45Z), 85 multi-hop wires are
fully routed and none of them carries a route length.

**Change:**
- `export_route_lengths.py` writes each wire's chain: the plugs its segments join, in order, when they form one simple
  path in their own direction. The 61-pin's two halves count as one plug. Otherwise the chain is null.
- `reconcile_v5.py` also accepts a through run: a chain whose interior plugs are all crossings (FIREWALL-CABIN, a
  FIREWALL-BODY bulkhead, a door pass-through). Its segments sum to the wire. The basis names the crossings.
- 81 of the 85 are through runs. CAN_HI and CAN_LO (M130 to the PDM30 pin splice to the CAN bus node) and LOCK_BUS_A/B
  (one switch, a door pass-through each side, two actuators, the other switch) are trees drawn as chains, and they wait.

**Registry result (against main, same build):**
- 24 wires gain a length (188.9 ft unpadded).
- 48 estimates rise from 229.9 to 349.8 ft. None falls.
- Length kinds of 417 wires: route 206, estimate 115, none 63, design 25, twin 8.
- BOM wire feet rise from 1,301.1 to 1,449.3 ft. Cart lines are unchanged.
- check_plug_ends shows the same 11 R13 rows as main.
- The largest rises: front right lamps #82, #84, #86a/b and #88 from 4.0 to 4.6 ft up to 10.4 to 10.9 ft (PDM30 in
  the cab, through body bulkhead A, across the radiator support), and speaker leads #26a/b and #27a/b from 6.9 ft up
  to 14.3 to 15.3 ft (amp at the rear, through the door).

**Twin caveat.** The engine-side branches run long; knock sensor #104 goes 4.6 to 8.7 ft, and its engine segment is
2.9 times its straight line. The twin's engine sits about 0.15 m back, and the branch study rated those branches low.
A longer cut is the safe error. A tape on the truck supersedes it.

**Expected live after the load:** 72 wire rows re-rowed with their new lengths, and segment plans unchanged (they are
per-segment route plans already). Every must-be-0 check except the 2 / 40 PDM bench currents stays at 0.
