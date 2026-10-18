# Receipt: door, mirror, camera and lighting add-ons as candidate options

- **Date:** 2026-09-29
- **Change type:**
  - research (`research/2026-09-30_door-mirror-camera-lighting-options.md`; that filename is the lead's)
  - toolchain (`calc-data/catalog/options.yaml`, `calc-data/options_v5.py`, regenerated `OPTIONS.md` and the registry's
    `options` / `capacity` keys)
- **Follows:** `receipts/2026-09-28_options-capacity-readiness.md` (the options mechanism)
- **Companion:** `receipts/2026-09-29_substrate-correction-factory-washer-pump.md`
- **Ask (owner, 2026-09-29, excerpts):**
  - "if we wanted to like add like a side camera it hooks into the side mirror even like sensors"
  - "billet style side mirrors reproductions from the original style"
  - "a lot of space in these gigantic vintage bumpers ... they often very often fall out of adjustment"
  - "headliner planning for the rearview mirror"
  - "the rearview mirror is also kind of maybe an optimal screen situation"
  - "the light puddle what's our options there"
  - "do we still run them through the motec computer"
  - "if we build it and it's 80% complete we can just toggle it on and off the wiring harness"
- **Pre-flight:**
  - read state §1-4; canon ch.16 §7.1 (video is shielded), ch.17 (limit ≥ 1.25 × load, ≤ 85 % of the wire), ch.18 (door
    looms; door flex); chapters/05 "PDM Channel Grouping"
  - searched the library for every factory claim (1977 LTSM p.111, 114, 131, 132, 155, 187, 803, 814, 815; 1978 booklet p.9
    and fold-out A-1)
  - every price and spec is from a page snapshotted 2026-09-29, one request per host every 10 s

## What was built

**`catalog/options.yaml`: 17 candidates, none decided.**

| Code | Add-on | Version | Alternative to |
|---|---|---|---|
| MCAM | side-mirror cameras | EchoMaster PCAM-BS1 stick-on | — |
| MCAM-BIL | side-mirror cameras | camera pocketed in billet mirrors | MCAM |
| BSM | blind-spot radar | Rydeen BSS2LPB plate bar | — |
| BSM-SD2 | blind-spot radar | Sensata Side Defender II | BSM |
| MTS | mirror repeaters | Grote 49343 | — |
| MTS-SOG | mirror repeaters | signal-on-glass | MTS |
| PUD | puddle lamps | Lumitec Echo, door bottom | — |
| PUD-MIR | puddle lamps | in the mirror underside | PUD |
| BML | front-bumper park/turn + bumper lock | Truck-Lite 60094Y | — |
| FWC | windshield camera | Mobileye 8 Connect | — |
| MIRD | mirror screen | PAC VS41 switcher into RC CH2 | — |
| MIRD-FV | mirror screen | Brandmotion FullVUE | MIRD |
| MIRD-360 | mirror screen | RVS inView 360 | MIRD |
| HDL | header loom provision | — | — |
| BMIR | billet reproduction mirrors | — | — |
| DGND | shared door accessory ground | — | — |
| DPASS12 | DT 12-way door pass-through | the other door fix | — |

Each candidate carries:
- `name`, `status: candidate`, `source` (the owner's words plus the snapshot names)
- `product` (maker, PN, price and date)
- `demand` with the four existing keys, plus:
  - `taps`: existing outputs it shares
  - `limits`: what that does to those outputs' current-limit settings
  - `door_cavities`
  - `adds`: planned wires with gauge, spec, from, to, current, estimated length and basis
  - `mass_g_est`

The new keys are documented in the file header. Partly validated versions are separate candidates with `alternative_to`,
and billet-only versions carry `requires: [BMIR, DGND]`.

**`options_v5.py` (additive):**
- The door hinge pass-throughs (DOOR-L/R-PASS, DT 8-way) are in the capacity ledger. Base + decided use a cavity each; PL's
  designed wires are shown on top.
- The candidate table gains planned wires, door cavities and alternative-to.
- Alternates are left out of every verdict total, because one version of an add-on is built.
- A door verdict, with the DPASS12 toggle stated.
- `reg['options']` carries `alternative_to` / `requires` where set.

Nothing else in the registry changed: only the `options` and `capacity` keys differ from main, checked by key.

## Measured (options_v5 on this branch, 2026-09-29)
- **Options:** 32 (28 candidate, 3 decided, 1 base; top-design's TOP-* block will add more). Buildable and composite wire
  counts are unchanged (361 / 393), because the add-ons are undesigned and live in `adds`.
- **PDM30 outputs and inputs:** the verdicts are unchanged by these candidates. They take 0 outputs and 0 inputs by
  grouping, so the "does NOT fit" lines are still the earlier candidates' (PW, PL, FC, AS, LO4, DISP).
- **Door pass-throughs:**

  > "base + decided use 2 of 8; designed candidate wires take 4 (PL); undesigned candidates would take 4 per door — fits only
  > without PL; a DT 12-way (DT04-12PA / DT06-12SA) gives 4 more cavities; with DPASS12 each door has 12: 2 + 4 + 4 = 10 — fits"

- **Output-limit effects the picks would make:**

  | Output | Limit | Load | Why | Source |
  |---|---|---|---|---|
  | OUT27/28 | 3 → 4 A | 2.70 A | with BML | — |
  | OUT13 | 3 → 4 A | 2.52 A | — | — |
  | OUT25 | 6 → 7 A | 5.02 A | with PUD; above a 20 AWG pin lead's 6.8 A, so 18 AWG or LED base lamps | MoTeC PDM manual printed p.48: 20# = 8 A at 80 °C |
  | OUT23 group | 3 A | 1.91 A + VS41 + roof camera | — | RC mirror 8 W → 0.67 A at 12 V |

## Findings sent to other lanes
- **RC:** the decided mirror is 8 W → 0.67 A at 12 V. That closes the "RVS mirror display current" gap on MIRROR_PWR's limit.
  The monitor's own page lists 9-18 V where the kit page lists 9-32 V (open).
- **Washer:** see the companion correction receipt. The 12004622 misread is corrected in the pin tables' text.
- **top-design lane (agreed by message):**
  - Its roof camera goes on VS41 input 1.
  - Its lamps stay on the top and in the cargo area.
  - Its block goes after this one in options.yaml.
- **pieces lane:** the door fill is now in the ledger, with both toggles (DPASS12, or no PL).

## Substrate inconsistencies (flagged, not fixed)
- `options.yaml` FC `demand.crossings: 2 # ... through body bulkhead C` predates state row 0ah ("nothing else through the
  firewall"). If MIRD is built, FC's video would take VS41 input 2.
- The `options_v5` "body crossings" verdict still names body bulkheads A/B/C/P, which 0ah superseded. The registry keeps
  them until Dave's answers (state 0ah).
- `reconcile_v5.py` still writes the Hella washer pump into wire 50's terminal and the OUT26 limit note; the pieces lane is
  re-pointing it.

## Open (named close paths)
- **Vendor questions, drafted in research §8.5 and not sent:**
  - EchoMaster: PCAM-BS1 rated 9-12 V, against a ~14 V truck.
  - PAC: VS41 positive triggers rated 2-12 V.
  - RVS: the CH2 trigger wire, the camera's current, and 9-18 vs 9-32 V.
- **Currents not published:** PHD5N1, VS41, GM 84408372, the signal-on-glass arrow, Mobileye standby.
- **Prices not published:** Sensata, Mobileye, FullVUE (out of stock), Grote 49343.
- **Read on the truck:**
  - the mirror model (base, below-eyeline or West Coast)
  - the door conduit bore against the coax + DT bundle
  - headliner or bare header
  - plate on the bumper or the tailgate
- **Budget for BMIR:** unknown until quoted (research §8.5 has the published anchors and drafts).
- **Owner calls:** research §11.
- **Map rows:** `load_map_rows.py` adds one `wiring_decisions` row per option. They are not loaded; that is the wiring lane's
  job after merge.
