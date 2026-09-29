---
id: 2026-09-30_research-cooled-seats
change_type: research
scope: docs/wiring/research/2026-09-30_cooled-seats.md (new), docs/wiring/calc-data/catalog/options.yaml (SEAT-TED, SEAT-VENT candidates), docs/wiring/calc-data/fetch_sources.py (22 cited URLs)
author: claude-opus-5-5 (seat-climate, for the k5-wiring lead)
owner_words: "instead of being extra annoying I think we have one more thing we can look into which would be air-conditioning we can insert a AC pad on the seats not because then we have to worry about HVAC at least looking into how would we actually doair condition seats" (2026-09-29)
---

# Cooled front seats: research and two candidate options

## What changed
- `research/2026-09-30_cooled-seats.md` covers:
  - the seats' state, read from the database;
  - how fan and thermoelectric seats cool, with every number sourced;
  - the real kits, with price and date and what each maker doesn't publish;
  - the plaid question;
  - the control path, wire gauge, seat plug and floor route in this build;
  - the recommendation, the upholsterer's steps, the owner's questions and two drafts (not sent).
- `catalog/options.yaml` gains two candidates, in the add-on format already on main (`product`, `demand.adds` with
  lengths marked as estimates, `limits`, `alternative_to`):
  - **SEAT-TED**: a Sanctum thermoelectric heat/cool kit in each bucket. Two PDM 20 A outputs, 8 planned wires.
  - **SEAT-VENT**: fans only, one 8 A output, 5 planned wires. `alternative_to: SEAT-TED`, so it is left out of the totals.
  - Neither is decided. Agents never promote a candidate.
- `fetch_sources.py`: the 22 web sources the two files cite. Every one has a snapshot under the script's own name
  (checked).
- Not edited: `k5_registry.json`, `endpoints.yaml`, `mounts.yaml` and the generated `OPTIONS.md`. The lead said not to
  edit the registry, and `options_v5.py` writes the registry. It was run on a scratch copy only (below), so the next
  regular run picks the two candidates up.

## Findings
1. **The seats are already done.** The OEM-pattern plaid was bought 2025-04-07 (work record
   d2e34faa-be6f-4c59-abf0-14b3641b76c0). A photo with the camera date 2026-01-31 in its EXIF shows the reupholstered buckets
   in the cab with the console and carpet (observation a4966700-e362-4881-9ca8-c1c78b4c3f1a). Cooling means reopening
   finished seats.
2. **Only thermoelectric cools the air.**
   - Katzkin: "reduces the temperature of the intake air by as much as 15 degrees", no unit given.
   - Fans only move cabin air, and no fan kit here publishes a figure.
3. **The usable kit is the Sanctum**, $400.00 a seat on 2026-09-29.
   - Katzkin DegreeZ is locked to Katzkin perforated leather.
   - Get New Seats runs OEM Ford and Nissan TED seats, not these buckets.
   - Fan kits are unbranded, with no part number and no specs.
   - OEM ventilation fans run on LIN, which neither the M130 (M1 techspec p.6) nor the PDM has.
4. **The PDM can't vary fan speed.** "Note: Motor speed control is currently not supported" (MoTeC PDM user manual p.28).
   Levels stay in each kit's own controller, and the PDM output is the enable and the fuse.
5. **Engine-running interlock.**
   - The conditions: RUN (PDM30 DIG1), not START (DIG10), and M130 RPM over CAN (M1 General 0x640) above cranking speed.
   - PDM manual p.38 shows exactly this RPM-condition use, and p.1 names load-shedding "during low battery voltage or engine
     starting".
   - No new PDM input is used.
6. **Capacity.** Thermoelectric needs one 20 A output per seat, since two seats' 30 A is over one output's 25 A ceiling
   (p.24). The PDM30's only free 20 A outputs, OUT3 and OUT4, are the power-window candidate's. So this waits on the
   owner's power-window call, or on the second PDM coming into the cab (research §5). The dry run confirms it (below).
7. **Gauge** (canon rules, ProWire /32 resistance):
   - Thermoelectric: 12 AWG, and the driver seat passes.
   - The passenger feed passes 3 % drop only up to 8.3 A on the estimated 12.5 ft run. Its gauge waits on the kit's bench
     current, because the maker publishes only a 15 A circuit.
   - Fans: 18 AWG.

## Capacity dry run (`options_v5.py` on a scratch copy of calc-data, main at 09c291120 + this change)
- "PDM30 outputs: candidates would take 9; 3 spare — does NOT fit." Before this change it was 7 against 3 (the committed
  registry, after the top-design candidates in #420). SEAT-TED adds 2.
- "PDM30 inputs: candidates would take 3; 2 spare." Unchanged: the seats take no input.
- "Alternate versions not counted above ... SEAT-VENT."
- Options 41 (37 candidate, 3 decided, 1 base). The buildable and composite wire counts don't change, because neither
  option has registry wires.

## Proposed endpoints (for the pieces lane's `ends:` map; not written to `endpoints.yaml`)
Positions are the agent's proposal. The builder places them on the truck. Only one of the two plug pairs is built.

```yaml
SEAT-L-PASS-P:            # SEAT-TED
  where: cabin
  device: "driver seat disconnect, climate kit power — Deutsch DTP 2-way: DTP04-2P + WP-2P (floor/harness side, pins 0460-204-12141), DTP06-2S + WP-2S (seat side, sockets 0462-203-12141), size 12, 14-12 AWG, 25 A per contact"
  family: dtp
  kit: {DTP04-2P: 1, DTP06-2S: 1, WP-2P: 1, WP-2S: 1}
  wires: ["SEAT_L_PWR", "SEAT_L_GND"]
  position: "seat half on the driver seat frame under the cushion, near the rear; floor half P-clipped to the floor under the seat; service loop covers the adjuster's fore-aft travel (unmeasured)"
  sources: ["www.customconnectorkits.com__dtp04-2p.md / __dtp06-2s.md (wedges WP-2P / WP-2S, size 12 contacts 14-12 AWG)", "www.farnell.com__628276.md (DTP 25 A; seals 2.46-4.32 mm; 12 AWG /32 is 2.62 mm, www.prowireusa.com__m22759-32-tefzel-wire.md)"]
  open: ["the kit's power-lead gauge (must be 14-12 AWG for the size 12 socket)", "adjuster travel for the loop (tape T-16)"]
SEAT-R-PASS-P:            # SEAT-TED
  where: cabin
  device: "passenger seat disconnect, climate kit power — as SEAT-L-PASS-P"
  family: dtp
  kit: {DTP04-2P: 1, DTP06-2S: 1, WP-2P: 1, WP-2S: 1}
  wires: ["SEAT_R_PWR", "SEAT_R_GND"]
  position: "seat half on the passenger seat frame close to the front pivot bracket, so the tip-forward swings the shortest loop; floor half P-clipped clear of the pivot, springs and restraint cable (1987 LDT manual 10A2-5 Fig. 4)"
  open: ["tip-forward arc at the plug (tape T-16)", "10 AWG feed needs a 10-to-12 AWG transition if the bench current is over 8.3 A"]
SEAT-L-PASS:              # SEAT-VENT (alternative)
  where: cabin
  device: "driver seat disconnect, fan kit power — Deutsch DT 2-way: DT04-2P + W2P (floor side, pins 0460-202-16141), DT06-2S + W2S (seat side, sockets 0462-201-16141), size 16, 20-16 AWG, 13 A"
  family: dt
  kit: {DT04-2P: 1, DT06-2S: 1, W2P: 1, W2S: 1}
  wires: ["VENT_L_PWR", "VENT_L_GND"]
  sources: ["catalog/parts.yaml DT04-2P / DT06-2S", "www.farnell.com__628276.md (DT 13 A; seals 1.35-3.68 mm; 18 AWG /32 is 1.52 mm)"]
SEAT-R-PASS:              # SEAT-VENT (alternative)
  where: cabin
  device: "passenger seat disconnect, fan kit power — as SEAT-L-PASS"
  family: dt
  kit: {DT04-2P: 1, DT06-2S: 1, W2P: 1, W2S: 1}
  wires: ["VENT_R_PWR", "VENT_R_GND"]
SEAT-L-CLIMATE:           # the kit's own control module and TED/blower pair(s), driver seat
  where: cabin
  device: "Sanctum heat/cool kit (LeatherSeats.com) or a fan kit: control module under the seat, cushion and backrest units in the seat"
  family: open
  kit: {}
  open: ["kit power-lead gauge and plug", "module mounting spot under the cushion (bench)", "backrest depth for the back unit (tape T-16)"]
SEAT-R-CLIMATE:           # passenger seat, as SEAT-L-CLIMATE
  where: cabin
  family: open
  kit: {}
SPL-SEAT-L / SPL-SEAT-R:  # M81824/1-3 in-line splices, 2 x 16 AWG pigtails -> 12 AWG leg, at the PDM (the build's 20 A-output pattern, state 0ac)
SPL-SEAT-VENT:            # 20 AWG pin lead -> two 18 AWG seat legs, at the PDM
SEAT-SW-L / SEAT-SW-R:    # the kits' own switches, console or seat (owner's call); the kit's switch cable, not our wire
```

## Proposed tape item (for `cad/tape_list.yaml`; not written there)
- **T-16, priority 2: seat runs and seat travel.**
  - (a) Along the route, from the PDM30's spot to under each seat.
  - (b) The driver adjuster's full fore-aft travel.
  - (c) The passenger seat's tip-forward arc, measured at the plug spot.
  - (d) The clearance from under each cushion to the floor at both ends of travel.
  - (e) The backrest's inside depth between the foam and the vinyl back.
  - Settles: the seat feed lengths and the passenger gauge (drop), the service loops, and whether a thermoelectric unit
    fits in the backrest.
  - Tolerance: 25 mm for lengths, 5 mm for depths.

## Substrate inconsistencies found (not fixed here; each needs its own substrate_correction)
1. **The door window pass-throughs' 14 AWG won't seal in DTP.**
   - The Deutsch catalog gives DTP seals as closing on 2.46–4.32 mm insulation (`www.farnell.com__628276.md`).
   - ProWire lists M22759/32-14 at 2.16 mm nominal (`www.prowireusa.com__m22759-32-tefzel-wire.md`). The canon lists /16-14
     at 2.31–2.41 mm (ch.16 §1.8). Both are under the minimum.
   - The PW candidate runs 14 AWG /32 through DOOR-L-PASS-P and DOOR-R-PASS-P: #34, WIN_GND_L, WIN_R_UP, WIN_R_DN, #35,
     WIN_GND_R.
   - 12 AWG /32 (2.62 mm) seals. Only one source for the seal range is on file, so check a sample in a DTP seal.
2. The lamp research quotes the DT seal as 1.35–3.05 mm from the same catalog. On that page, 1.35–3.05 mm is the DTM row.
   DT is 1.35–3.68 mm. The minimum is the same, so no lamp conclusion changes.
3. `.claude/rules/wiring-receipt.md` points to `docs/wiring/RECEIPT_FORMAT.md` and `HARNESS_RULES.md`. Neither is in the
   repo (git ls-files). This receipt follows the recent receipts' front matter.
4. For the reconciliation lane (no database write here):
   - Three rows filed on the K5 on 2026-02-04 (a146c0c7-4fbe-4f36-9b50-906713d31485,
     dc97c39a-8aa2-45a5-9416-7cb264890a91, 46a5e207-6835-46a7-873f-be95a9363f46) show a light-blue regular-cab pickup
     with a brown bench and black door panel. That is not this maroon Blazer with plaid buckets.
   - Two seat rows dated 2025-10-31 (82b6946f-3e0f-4efc-953c-dbf3516e4a68, a52685a9-db24-4533-9ea4-069e1bc91cc8) carry an
     identical timestamp to the microsecond, not a camera date.

## Pre-flight gate
- Read state §1–4 and canon ch.16, ch.17 and ch.18 (§3–4).
- The MoTeC PDM manual, the M1 hardware techspec and the 1977 and 1987 manuals were read directly by page.
  `library_search` was run for PWM and seats.
- Every number has a source or is marked unknown. The unknowns are in the research file's "Not found" list and below.
- Stopped on owner decisions rather than inventing them:
  - power windows, which decides the PDM30 outputs;
  - the second PDM's location, an open owner and Dave call;
  - reopening the finished seats;
  - the switch location;
  - thermoelectric versus fans.
- Would Dave shred this?
  - It's cited, and lengths are estimates with the tape item to close them.
  - The gauge is calculated before any cut, with the passenger gauge left open until the bench number.
  - Crimped Deutsch plugs; no relays, since the PDM replaces the kit's relay and fuse.
  - Nothing crosses the firewall.
  - The route and the loop lengths are left to the builder.

## Unknowns (each with its close)
| Unknown | Close |
|---|---|
| Kit current at each setting and inrush (all kits) | bench: clamp meter on 12–14 V with the covers off (upholsterer's step 8); or LeatherSeats.com (draft in the research file) |
| TED and blower dimensions; backrest depth | the kit in hand; tape T-16(e) |
| Noise | bench, before the covers go back |
| Condensation at max cool | bench, 30 min at max cool, check the cold-side duct for water; no maker figure |
| Plaid insert backing: does it pass air? | the upholsterer (draft); breath test on an offcut |
| Run lengths, seat travel, tip-forward arc | tape T-16 |
| Which PDM outputs | owner: power windows yes/no; owner and Dave: the second PDM in the cab or the bay |
| PDM30 100 A and alternator 150 A budgets with the seats | measure blower HIGH and seat currents; rerun the budget |
| Kit power-lead gauge (DTP socket takes 14–12 AWG) | kit in hand |
