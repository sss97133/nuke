---
id: 2026-10-15_k5-route-lengths-refresh-44
change_type: substrate_correction
scope: docs/wiring/calc-data/inputs/route_lengths.json (re-exported after #1729); k5_registry.json, DOSSIERS.md, OPTIONS.md, k5-mounts.json (rebuilt)
case: docs/ledger/theory/data-machine-cases.md 13.12.3
amends: 2026-10-15_k5-through-run-route-lengths
---

# RSI pass 45: the cut list takes the routes after the engine fix and the rear trunks

**Why now.** Pass 43 (#1726) placed the engine ends on the corrected engine. Pass 44 (#1729) gave the graph its
rear-of-engine trunks. Live after its load (23:52Z): segments routed over 2x their straight line went from 93 to 16, and
excess beyond a 1.4x path went from 344.8 to 164.5 ft. The registry still carried the export from before both, so its
route lengths held the old detours. The refresh was held through pass 43 so the detours wouldn't become cut lengths.

**Change.** `export_route_lengths.py` was re-run against the live model: 334 wires with a routed segment, 328 fully
routed. The registry was rebuilt with the pass 39/40 rules unchanged:
- a one-segment wire or a through run takes its route;
- the route never shortens a zone estimate or an older twin path;
- tape and design lengths stand.

**Registry result (against main):**
- 82 wires change.
  - 63 fall, by 79.2 ft in all: the detours leave. Knock 2 #104 8.7 to 5.2 ft; the GSS sensor leads 5.5 to 2.3 ft;
    FAN_GND 5.9 to 3.0 ft.
  - 24 of those go back to their zone estimate, because the route now runs shorter than it. Oil pressure #102 7.8 to
    4.6 ft (estimate) and MAP #108 6.8 to 4.6 ft.
  - 15 rise, by 13.4 ft.
  - 4 gain a length (17.5 ft): ALT_L and the three Dakota oil-pressure and coolant-temperature wires, on their new
    engine ends.
- Length kinds of 417 wires: route 197, estimate 131, design 58, twin 5, none 26.
- BOM wire feet go from 1,461.5 to 1,426.4 ft. Cart lines are unchanged.
- check_plug_ends shows the same 11 R13 rows as main.

**Expected live after the load:** the 82 wires re-row with their new lengths and kinds; segment plans are per-segment
route plans already; every must-be-0 check stays 0.
