---
id: 2026-09-26_device-ends-from-owner-parts-and-motec
date: 2026-09-26
change_type: substrate_correction + substrate_extension
amends: 2026-09-26_kits-tools-bom-vs-carts
scope: docs/wiring/calc-data/{reconcile_v5.py, kits_v5.py, k5_registry.json, catalog/*.yaml}
status: APPLIED
owner surface: Claude Doc "K5 Parts & Build Book" rev 126, section "Master list vs carts" + the "Engine plugs" table
---

# Device ends closed from the owner's part numbers, MoTeC's manuals and the makers' data

## Why
Owner, 2026-09-26: "2 of 87 is pretty low.. i gave u the throttle body part number. i gave you the part number on injecto, coil, and fuel pump/hanger… why would i ask prowire about 22 awg terminals. you just need to do your homework on motec and the prowire parts list. i cant decide on can 22 or 24 or the blower, need to rely on the math."

## Part numbers used (owner testimony + receipts)
| Part | Number | Source |
|---|---|---|
| Throttle body | GM 12699160 ("for 22-23 Silverado 2500") | Gemini-thread distillation §2d (T75) |
| Coils | 8× GM Delco 12611424 / D510C | same, §2e |
| Injectors | 8× Siemens Deka FI114961, 60 lb | same, §2f; KM Racing receipt 2024-07-01 (Deka 650cc ×8) |
| Fuel pump | Quantum QFS-H882 hanger + P367 pump | QFS receipt 2024-09-25 |
| Alternator | Holley 197-302 + pigtail 197-400 | Holley receipt 2023-08-02 |
| Pedal | GM 10379038 | cut list v4.2 |

## Findings, each cited
1. **The TB 12699160 is a Gen V SENT throttle body.**
   - Pinout: 1 motor +, 2 motor −, 3 SENT position, 4 low reference, 5 +5 V, 6 not used.
     - Sources: MaxxECU "E-Throttle bodies" (GM 12678223); rusefi wiki "SENT ETB" (GM SENT TBs share the pinout, e.g. 12617792).
     - Michigan Motorsports: 12746422 supersedes 12699160 / 12730580 / 12740724 (2022–24 6.2L/6.6L gas trucks).
     - Holley: LT throttle bodies share a connector distinct from the LS 6-pin.
   - The M130 decodes SENT: MoTeC GPR (M130) firmware 01.11.0099 release notes, "Throttle Servo 2 (includes SENT Secure Serial Decode Type)".
   - Consequences:
     - #4d (TPS2) is retired.
     - #4c moves A14 → B09 (UDIG4).
     - PCS_TPS moves from the TB tap to pedal track 1 (B21). ZGP guide p.13, Table 4: AI1 may piggyback an ECU sensor.
     - A14 (AV1) and A17 (AV4) become free.
     - Plug = ICT WCTHB50 ($23, TE AMP, 18 AWG recommended). The carted 68212 (LS2/LS7 GT150 6-way) is the wrong plug.
   - **Corrects** state row 29's "re-derive against the 12699160 connector" and state 0f(e)'s "TB 12699160 = Gen IV 6-pin".
2. **22 AWG into sensor terminals.**
   - MoTeC C125 manual p.21: "Some sensor connectors may not be available with 22# terminals, in which case doubling the wire over gives the equivalent of an 18# wire."
   - ProWire carries the 22 AWG parts:
     - Metri-Pack 150 terminal 12110847 (18–22 AWG) and seal 15324976 (20–22 AWG), for crank, cam, MAP and knock.
     - GT150 12191818 / 15366021 (20–22 AWG), for pedal, air temp, coolant, oil temp and oil pressure.
   - Doubling is kept for the coil trigger, the injector driver and the TB signals.
3. **Coil pins** from Dave's M130 sheet: a chassis ground and b signal ground to a head ring terminal, c trigger, d switched +12 V.
   - 24 branch wires added at 18 AWG (MoTeC PDM manual p.48: 18# = 11 A).
   - COIL_PWR daisy chain uses 7 × D-609-05.
   - 4 ground rings.
4. **Injectors.**
   - FI114961 is EV1, 12.5 Ω (siemensdeka.com).
   - EV1 = TE Junior Power Timer 2.8 mm. ProWire 68102 ×16; 8CYLK-90 has no terminals.
   - 8 × 20 AWG +12 V branches, at 1.1 A each.
   - INJ_PWR daisy chain uses 7 × D-609-05.
5. **Sensor pins** from Dave's sheet: crank, cam, MAP, air temp, coolant, oil temp, oil pressure, knock, fuel pressure (by his convention).
   - Crank and cam stay on 5 V (A02/A09). GM Gen IV 58x sensors are 5 V Hall, needing a pull-up (msextra forum); Dave's Bronco uses B19 6.3 V.
6. **Pedal 10379038 is 6-pin.**
   - Holley 199R10762, Appendix 3.0: "Holley recommends GM P/N 10379038 which is a passenger car pedal with a 6 pin connector".
   - Pinout A–F: track 2 ground / signal / 5 V, then track 1 ground / signal / 5 V, per the LS1Tech "GM 2007-current Vortec gas pedal pinout" thread. That page returns 403 to fetch; the pinout came via web search.
   - Plug: ProWire GT150 6-way 15326829 + TPA 15317363.
7. **CAN (#62) is 22 AWG.**
   - MoTeC PDM manual p.50: "twisted 22# Tefzel is usually OK", at least one twist per 50 mm.
   - Terminators are **100R 0.25 W**, and a bus under 2 m takes one, at the end opposite the UTC plug. This **corrects** cut list #62's "120-ohm termination each end" and state 0d(c).
8. **Blower (#51) is 12 AWG /32.**
   - 1977 LTSM Section 1B: C-K Four-Season blower 12.8 A max at 12 V; fuses 25 A.
   - MoTeC table: 14# = 22 A at 80 °C.
   - 12 AWG drops 0.12 V over 1.7 m and fits D-609-05 (16–12); 10 AWG does not.
9. **Fuel pump (#66) is 14 AWG from a PDM 8 A output.**
   - QFS P367 (HFP-367) draws 5.1 A at 60 psi and 4.6 A at 45 psi (highflowfuel.com).
   - Drop over 18.4 ft at 5.1 A: 16 AWG 0.40 V (3.0 %), 14 AWG 0.26 V (1.9 %).
   - #94 (pump relay) is retired under owner row 54 ("PDM replaces relays"), which frees bulkhead cavity 'n'.
   - The 8 AWG and the pump's MIDI 40 A are no longer needed.
   - PUMP_GND 14 AWG added.
   - **Closes** state 0e(b) (pump draw UNKNOWN).

## Result
- Registry: 174 active (5 retired: #60, #61, #25, #4d, #94), 52 implied, 56 endpoints, 343 wire ends.
- **Device-end pin maps: 84 of 103 wire ends cited** (was 2 of 87). The other 19 sit on unpicked parts: Dakota box, fan, fuel level, fuel-pressure sensor, wideband, VSS, ignition switch, and the hanger-top plug.
- Firewall under the engine-only rule: **57 of 61 used, 4 spare.**
- Cart deltas (in the owner doc):
  - Remove 68212, 68104, and 22 AWG green/yellow.
  - Reduce 8 AWG red from 30 to 8 ft.
  - Add WCTHB50 (ICT), 12110847/15324976 ×20, 68102 ×20, 15326829 + 15317363, GT150-AIR-TEMP-KIT, LS-CRANK-CONN-KIT +1, 12191818/15366021 +8, D-609-05 +10, M-RJ45-CABLE, CPA-100-3/4-BK, coil/injector/pump wire, and a 100R resistor (DigiKey).

## Unknowns left (each with its close path)
- Crimper models for the Junior Power Timer (68102) and TE AMP (WCTHB50) terminals: the TE part number on the terminal bag names the tool.
- The 68201 knock terminal family: Metri-Pack 150 or GT150; both 22 AWG sets are on the order.
- The hanger-top plug: not on Quantum's pages. Read it off the hanger when the tank is out.
- The pedal pinout rests on a forum source (403). A meter check on the pedal confirms it: each track's 5 V-to-ground pair reads the pot.
