# Receipt: wheel speed sensors, tone rings and knuckle mounts (research + candidate options)

- **Date:** 2026-09-30 (prepared 2026-09-29; web sources read 2026-09-29)
- **Change type:** research (`docs/wiring/research/2026-09-30_wheel-speed-sensors.md`) + candidate options
  (`calc-data/catalog/options.yaml`: WSS-F2, WSS-4E, WSS-PREP) + toolchain (`calc-data/options_v5.py`: engine-side demand keys
  and verdict lines) + source list (`calc-data/fetch_sources.py`)
- **Follows:** `receipts/2026-09-28_options-capacity-readiness.md` (the options format and capacity ledger);
  `research/2026-09-28_ibooster-gen2-wiring.md` (Gen 1 correction)
- **Ask (owner, 2026-09-29, relayed by the lead):** "no a super lame question with the brakes and stuff we need to deal with
  TPS sensors and then the other side of the sensor which we have to figure out how to install that machine or whatever
  machining part of the axle the knuckle worth looking into what do we do there"
- **Reading:** "TPS sensors" in a brakes context = wheel speed (ABS) sensors. "The other side of the sensor" = the tone ring.
  "Machining part of the axle, the knuckle" = fitting a ring and a sensor mount to axles that never had them. Tire-pressure
  sensors need no axle or knuckle work, so they were not researched.

## Pre-flight gate (wiring-receipt.md)
1. State §1–4 read. Rows touched:
   - 0ah: one 61-pin, nothing else through the firewall.
   - 0y: capacity ledger.
   - 51: engine-only firewall.
   - 57: grounds in the loom.
   - 0v: speed from the NP205 sender.
   - Row 32 is stale: it says iBooster Gen 2, and the unit is Gen 1.
2. Canon read:
   - ch.16 §7.1 shielded list, §6 DR-25, §8.5 tie spacing;
   - ch.17 service loops;
   - ch.18 §3.4 routing schools, §8 design-vs-hands.
3. library_search for every term; cited by doc and page. Terms: hub-and-disc, C-lock, spindle nuts, antilock, wheel speed
   sensor, UDIG, E888, E816, reluctor, tone ring (no match).
4. Every number is cited or marked `{unknown, needs: ...}`.
5. Owner-dependent items are stated and not decided:
   - whether TC or launch is wanted;
   - the 61-pin cavities;
   - the machine shop.
6. "Would Dave shred this?" checks:
   - crimped DTM contacts, no solder;
   - no invented cut lengths (null with a basis);
   - the shield and supply choices are left to Dave;
   - Dave's vocabulary ("wheel speed sensor").
7. HANDS steps deferred to the builder, never asserted done:
   - press the rings;
   - set the gap;
   - bench sweep;
   - lock-to-lock and droop-to-bump cycle;
   - corner temperature;
   - final lengths.

## What was found (cited in the research file)
- **Nothing on the truck needs wheel speeds.**
  - iBooster Gen 1 standalone uses only its pedal travel sensor (evcreate, Tulay Gen-1, fastandquiet).
  - The PCS needs only engine RPM on Speed Input 3 (ZGP guide p.18).
  - The Dakota reads the NP205 sender (#100).
- **What wheel speeds buy:** M1 GPR traction and launch control, and logging.
  - MoTeC's minimum is one driven + one non-driven sensor, four preferred; rings at least 24 teeth, 48 preferred; Hall sensors
    (M1 Launch Control User Guide pp.3–4).
  - MoTeC's own GPR M130 example puts "Wheel Speed Rear Drive Sensor" on B08 UDIG3, where #100 already sits.
- **PDM inputs cannot measure frequency.** An input makes only a Status and a Voltage channel (PDM manual p.19), and CAN out is
  at most 20/50 Hz (p.36).
- **E888:** 4 frequency inputs, but rated −10 to 70 °C (manual p.15), so it goes in the cab. Its use as a GPR wheel-speed source
  is not stated anywhere we hold.
- **Sensors:** ZF GS100502 ($33.80, DigiKey 2026-09-29), Littelfuse 55505-00-02-B/-A ($26.63 for the -A), Bosch HA-M
  B261.209.283-01 (price not published). The Honeywell 1GT101DC is obsolete (DigiKey PCN 2017-12-11).
- **Front hub:** the 1977 K10 front is a "hub-and-disc assembly" on tapered bearings, .001–.010 in end play; spindle nuts
  25 ft-lb (LTSM pp.305–307). No GM antilock part exists for this axle in our manuals, so the rings are made to suit.
- **Rear:** a GM semi-floating axle with C-locks (LTSM pp.354, 365–366). Photo 5aefc0bd shows 11 cover bolts, pointing to the
  12-bolt 8-7/8 (to confirm). Bolt-on disc conversion with a welded caliper bracket (photos c475159e, 23ffbfd5).
- **Routing** follows objectTraits: wheel wells are forbidden, the frame rail inside channel is the path, clips every 12 in.
  Plus the spine study (ABYC 18 in max), A-620 ties 150/75 mm, and the LTSM p.398 0.75 in clearance benchmark.

## What was changed
- `docs/wiring/research/2026-09-30_wheel-speed-sensors.md` (new). It covers:
  - purpose table and verdict;
  - three sensors;
  - rings per corner, with the tooth-count and frequency arithmetic;
  - bracket, gap and travel;
  - the machine-shop drawing list D1–D6 and a draft request for quote (for Skylar; not sent);
  - wiring: cable, route, clips, flex loop, DTM corner connector, receivers;
  - the capacity ledger;
  - recommendation, open questions, substrate inconsistencies.
- `calc-data/catalog/options.yaml`: three candidates in the #416 format (`product`, `demand.adds`, `alternative_to`). None
  decided; agents never promote a candidate.
  - **WSS-F2** (the recommended path): two front ZF sensors into M130 UDIG5/UDIG6; 7 planned wires. `conflicts_with: [NAV-L10]`
    (pieces audit 2026-09-29): both name M130 B11 (UDIG6); NAV-L10 is nav-comms' GPS-L10 alternate in PR #421, which already
    carries the mirror entry (merged to main as #421). PDM15 OUT14 feeds the sensors. It is uncontested: step-power's
    STEP-DCMD moved to the bay-PDM32 candidate (step-power, PR #428), and its PDM32 estimate counts this feed if the bay PDM
    becomes a PDM32.
  - **WSS-4E** (`alternative_to: WSS-F2`): four corners into a cab E888 over CAN; 15 planned wires.
  - **WSS-PREP** (`alternative_to: WSS-F2`): rings and brackets only, no wires.
- `calc-data/options_v5.py` (options-rd's pattern from #416, at their suggestion; their lane is closed): `capacity()` now
  reads, per undesigned candidate:
  - `demand.pdm15_outputs` (the designed-wire count stays the default);
  - `m130_pins` / `m130_udig` and `pin61_cavities`;
  - `conflicts_with`.
  - Three verdict lines sum over the lead versions (alternates excluded) against the ledger, with the takers named.
  - The M130 row lists the spare pin ids, the I/O-usable spares (free supply pins such as BAT_BAK left out), and the spare
    UDIGs.
  - `OPTIONS.md` gains PDM15, M130 and 61-pin columns.
  - The options.yaml header documents the keys.
- `calc-data/fetch_sources.py`: 19 source URLs appended so the gitignored snapshots can be refetched. Their stems match the
  snapshots already saved on 2026-09-29.
- Not changed: `k5_registry.json` (the lead's) and `OPTIONS.md` (generated from the registry). No database writes.

## Measured
`options_v5.py` was run on a scratch copy of `calc-data/` with the new options.yaml (the committed registry was not written).
It parses and places all three (branch merged with origin/main 248f2cd21, which brings nav-comms #421 and the tape list #427):
- `options: 52 (candidate 48, decided 3, base 1)`. NAV-L10 and WSS-4E / WSS-PREP are alternates, so they stay out of the sums.
- Candidate-demand rows:
  - WSS-F2: 7 planned wires.
  - WSS-4E: 15 planned wires, alternate.
  - WSS-PREP: 0.
- `alternates: ... WSS-4E, WSS-PREP`.
- The verdicts (body crossings 2, PDM30 outputs 7 against 3 spare, PDM30 inputs 3 against 2 spare, door pass-throughs) come
  from the other candidates. The wheel-speed candidates add 0 body-bulkhead crossings and 0 PDM30 outputs or inputs.
- New verdict lines:
  - `61-pin (engine connector): candidates would take 2 (WSS-F2 2); 3 spare (d, t, u) — fits, leaving 1`
  - `M130 pins: candidates would take 2 (WSS-F2 2), 2 of them universal digital inputs; 8 spare, 7 of them I/O (not I/O:
    B12 BAT_BAK), 2 of them UDIG (B10, B11) — fits, leaving 5 I/O pins and 0 UDIG`. B12 is "Battery Backup", a supply pin
    (M1 techspec p.17), so options-rd's review took it out of the usable count.
  - `PDM15 outputs: candidates would take 1 (WSS-F2 1); 5 spare — fits, leaving 4`

## Capacity (the recommended path WSS-F2, from the registry `capacity` of the 2026-09-28 run)
| Resource | Now | WSS-F2 |
|---|---|---|
| M130 pins | 52 / 60 | 54 / 60 (B10, B11, the last two UDIGs) |
| 61-pin | 58 / 61 (spare d, t, u) | 60 / 61 (two signal cavities) |
| PDM15 8 A outputs | 3 / 7 (OUT10, 12, 14, 15 free) | 4 / 7 (one feed at 1 A) |
| PDM30 outputs and inputs, PDM15 inputs, body bulkheads | — | no change |

- These now print in the options_v5 verdict (above) beside the other candidates, so Skylar sees the 61-pin cost next to the
  traction-control question.

## Open (named close paths)
1. **Owner:** is traction or launch control wanted at all, at 2 of the 61-pin's last 3 spares, the M130's last two UDIGs and
   one PDM15 output? It also rules out NAV-L10 (GPS-L10 on B11). If not, WSS-PREP or nothing.
2. **Owner / lead:** two 61-pin cavities for WSS-F2.
   - Registry #100 may take cavity d back when body bulkhead C is retired under 0ah.
   - Is an M130 speed input an engine signal under 0ah, or a chassis circuit under row 51?
3. **Dave:** the sensor supply (PDM15 12 V with 0 V to GND-BANK-ENG, or the MoTeC pattern SEN_5V0_B / SEN_0V at +2 cavities);
   shield or no shield.
4. **Measure (tape list T-16 to T-19, geometry lane #427):**
   - hub-and-disc inboard barrel OD and free length;
   - whether the disc is cast with the hub;
   - rotor-to-knuckle axial space;
   - spindle nut pattern;
   - caliper support-bracket bolt pattern;
   - hose bracket positions and hose free length;
   - steering lock angles;
   - full-droop and full-bump knuckle positions;
   - tire size.
5. **Seal fit at the corner DTM (state 0ai class).**
   - The DTM seal range is 1.35–3.05 mm (Deutsch DT Series Technical Manual, farnell 628276); M22759/32-20 is 1.27 mm.
   - Fix is Dave's call:
     - 20 AWG /16 (1.5 mm), with the owner's OK;
     - or 18 AWG /32 on 16–18 AWG size-20 contacts, spliced to 20 AWG before the 61-pin.
   - Check that the DTM range is a single seal. Caliper the ZF lead OD.
6. **Bench:**
   - gap sweep on the real ring (runout window);
   - scope the ZF edge on the M130's 3k3 pull-up;
   - corner temperature after hard stops (125 °C sensor; Bosch HA-M 160 °C fallback).
7. **M1 Tune / dealer:** can an E888 digital input be a GPR wheel-speed resource (only WSS-4E)? And the E888 price.
8. **Machine shop:** quote for D1–D4 (the draft in the research file §4.3 is for Skylar to send or not).
9. **Substrate corrections to file** (separate receipts, not done here):
   - four "8-lug" photo captions (the photo checked shows 6);
   - state §1 row 32 "iBooster Gen 2";
   - build-manifest rows d224438e (Bosch V4 booster), b47e99a2 (iBooster relay) and 4f357665 (MoTeC 5291 VSS "purchased").
