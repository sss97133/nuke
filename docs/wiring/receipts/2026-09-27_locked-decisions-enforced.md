# Receipt — Locked decisions enforced on the map; strict proof ladder; owner corrections land

- **Date:** 2026-09-27
- **Change type:** data (decision rows, retirements, supersessions) + frontend (MAP proof ladder, LOCKED strip)
- **Ask (owner, 2026-09-27):**
  - "thats dump data because the whole system is set up to be based on the holley mid mount so none of that data
    would stick that youre confused about thus proving our methods are not being enforced"
  - "trinary switch doesnt matter its low value data"
  - "m130 in hand sure.. but any proof of purchase? … throttle body likely never installed"
  - "you can rewrite the supersede_observation as needed. im inputing from here. more importantly the data is
    surfacing and its our imperfect rules blocking"

## What went wrong

- The map showed an "electric water pump (#25)" node, and the agent asked the owner about it.
  - `K5_WIRING_STATE.md` §1 already locks "Accessory drive = Holley Mid-Mount" (2026-09-24).
  - The registry had already retired wire #25 ("water pump is mechanical on the Holley mid-mount") and noted the
    device "not needed … retire in the next registry pass".
  - Retiring a wire never retired its device, and no locked decision was checked against the rows.
- The agent's photo reads over-claimed:
  - "M130 on hand" was counted as proof, but possession isn't a purchase.
  - "Throttle body on the truck" came from a mock-up photo; the bolts were never found.
- The corrections could not retire the wrong rows: `supersede_observation` accepts only an app session.

## What changed

**Locked decisions are rows** (`wiring_decisions`, status `decided`, trust T1, sourced to §1):
- `locked-accessory-drive-holley-mid-mount` (part_choice, 2026-09-24). Rules out an electric water pump.
- `locked-pdm-replaces-relays` (policy, 2026-09-24). Rules out relay devices and the wires that exist only to serve
  them.

**Retired as dead data** (typed design rows, `is_superseded`). Each node has a `blocks` link to its decision in
`wiring_decision_links`, noting its own wire count.

| Node | Retired by | Wires retired with it |
|---|---|---|
| WATER-PUMP | accessory drive | 0 |
| Aeromotive_Fuel_Pump_Relay | no relays | PTC-W023, PTC-W024, PTC-W025, PTC-W026 |
| Bosch_iBooster_Relay | no relays | dash-cabin-W023, -W026, -W027, -W028 |
| Fuel_Pump_Relay | no relays | LR-W021, LR-W022 |
| Headlight_Relay_L | no relays | LF-W003, LF-W005, LF-W006, LF-W021, LF-W023 |
| Headlight_Relay_R | no relays | LF-W004, LF-W008, LF-W009, LF-W022, LF-W024 |
| rear_window_relay | no relays | BC-W035, BC-W037, BC-W038 |

These relays fed the headlights, fuel pump, iBooster and rear window. Those loads keep their device nodes. Their
PDM-driven wiring is now an honest gap, to be designed under the locked rules. The headlights already have the
locked floor-dimmer topology (#85a/b, #86a/b).

`PDM30_OUT_ACClutch` is back to open and unassigned, because the trinary question was low value.

**Enforced where rows come from.** These live in the local wiring toolchain and are not in this repo:
- The map loader skips any node a decided decision blocks, and every wire and wire end on it.
- The registry generator drops any endpoint that is retired, or whose wires are all retired, and lists it under
  `retired_endpoints`. Regenerating the registry removed WATER-PUMP and changed nothing else.

**Owner corrections supersede** through `supersede_observation_relay` (#352). The owner is the actor, the channel is
`owner-chat:claude-code 2026-09-27`, and each call is logged in `reattribution_audit`.

| Old row | Now |
|---|---|
| TB "on the truck" | not installed (owner's words; mounts via the Delmo 4-bolt adapter, order record obs:a58db14b) |
| Injector rails "on the truck" | withdrawn (a mock-up photo is not install proof) |
| Coils "not on the truck" | withdrawn (the coils sit on the DEL-Stributor mount) |
| Alternator "on the truck" | mounted on the Holley drive, not wired |
| Water pump question | answered (owner) |
| Trinary question | answered (owner: low value) |
| 2 CKP tool facts from the double load | superseded by their identical twins |

**Map, plug card:**
- PROOF shows LINED UP · BOUGHT · INSTALLED as fixed rungs, and each rung takes its own evidence:
  - lined up: a cart, quote or circled listing;
  - bought: a purchase record;
  - installed: fastened and connected.
- Possession, mounted, mock-up and answered rows are listed under OTHER EVIDENCE — NOT PROOF.
- The owner's own statements are labelled as his words.

**Map, rollups and strips:**
- Section rollups count BOUGHT and INSTALLED only. Engine: bought 1/46, installed 0/46.
- LOCKED lists the decided decisions, each with the rows it retired. OPEN CALLS lists only undecided ones.

## Verification

- Relay: rolled-back dry run against prod passed before merge (see #352). Live: the function exists with
  EXECUTE for postgres and service_role only; 8 relayed supersessions returned `superseded: true`. The
  duplicate-facts query now returns 0 rows.
- The loader's block query returns 2 decided decisions and 7 blocked nodes.
- Local dev server against prod, logged out:
  - TB: lined up implied by the purchase, bought YES (eBay screen), installed NO (owner's words).
  - M130: no proof on file on all three rungs; the in-hand photo shows as a note.
  - LOCKED (2), OPEN CALLS (8).
  - The truck rollup shows installed 0 in every section.
- `tsc` 0 errors; `eslint` on the changed files 0 errors.

## Open

- `docs/wiring/calc-data/pdm_power_budget.md` still budgets a 12 A electric water pump and two fans (the owner
  said one fan). It is a derived doc, so rebuild it from the registry before the second-PDM call leans on it.
- Every other §1 locked decision is still prose. Encode each one with a checkable rule as it touches the map.
