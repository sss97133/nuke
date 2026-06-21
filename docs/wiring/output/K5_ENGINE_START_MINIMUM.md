# K5 ENGINE-START MINIMUM — ordered build list

**Goal (Skylar, 2026-06-10):** "battery, ECU, PDM and the essential pinout so we can turn on
the engine." This is the harness subset that **cranks + runs the LS3 + shows gauges — nothing
else.** No lights, no wipers, no windows, no audio, no iBooster, no trans controller (idle in
park/neutral), no A/C.

**Derivation:** `scripts/k5_harness_calc.py --config k5_baseline --diff k5_engine_start_minimum`
(config: `docs/wiring/configs/k5_engine_start_minimum.toml`; run 2026-06-10) + the v4.1 ECU/PDM
lifelines (`receipts/2026-06-10_cut-list-v4.1-ecu-lifelines.md`) + the v4.2 APS pedal wires
(`receipts/2026-06-10_cut-list-v4.2-aps-pedal.md`). Wire rows quoted from
`output/K5_cut_list_v4_2.txt` — gauge/color/length live there; lengths are zone estimates
pending battery-tray + mount measurements (battery = PASSENGER firewall corner, owner working
statement 2026-06-10; L14/L15 re-derivation pending).

**Calc diff (v3-registry portion):** 145 → 73 wires (−72), 877.5 → 312.2 ft (−565.3),
conductor cost $716 → $250, PDM channels 30 → 5 in use (**25 channels freed**), nameplate
load 393.9 → 160.7 A. Calc registry excludes the v4 Dakota addendum and v4.1 lifelines —
this document adds them back explicitly below.

**Total: 88 wires** = 73 calc-active − 2 superseded (#60/#61, see v4.1) + 6 v4.1 lifelines
+ 5 Dakota v4 wires required for gauges (#114/#115/#116/#117/#123) + 6 v4.2 APS pedal wires.
86 mandatory + 2 optional (#100 VSS, #65 C125 display).

---

## ✅ APS GAP CLOSED (v4.2, 2026-06-10)

The flag that stood here ("APS HAS NO WIRES — you cannot rev the engine without it") is
resolved: cut list v4.2 lands the 6 dual-track pedal wires — #APS_T1_SIG (B21/AV7),
#APS_T1_5V (A02), #APS_T1_GND (B15), #APS_T2_SIG (B22/AV8), #APS_T2_5V (A09), #APS_T2_GND
(B16). AV6 (B20) stays free for #98 fuel level. Tracks ride separate 5V rails with
letter-paired grounds. See `receipts/2026-06-10_cut-list-v4.2-aps-pedal.md`; wires laid into
group 8 below. Still open from that receipt: gm_aps_6pin per-cavity map (connector-time),
M130→pedal landmark (lengths are L19-proxy estimates).

Other open items carried into this build: #ECU_PWR switching element (master relay vs freed
PDM channel — see v4.1 receipt §4); #INJ_PWR/#COIL_PWR/#94 PDM channels (TBD since
2026-05-14 — the 25 freed channels in this config remove the capacity excuse); #98 fuel-level
AV pin; battery-end fuse rating for #PDM_BPOS.

---

## BUILD ORDER

Power spine first (everything else is dead metal without it), then grounds, then the ECU's
own lifelines, then the signals the M1 needs to fire (crank/cam), then fuel, spark, injection,
throttle, sensors, cooling, gauges. Pins are M130 A/B (Superseal 34/26), PDM30 OUTn per
`K5_pdm30_channel_plan.md`.

### 1. POWER SPINE (5 wires) — battery corner outward

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 1 | #63 Battery Disconnect | BAT+ → disconnect | 0 AWG M22759/16 | ORN/WHT | 4.6 ft |
| 2 | #6 Starter Motor | disconnect → starter stud | 0 AWG M22759/16 | ORN | 4.6 ft |
| 3 | #59 Alternator | alternator B+ stud → BAT+ | 0 AWG M22759/16 | ORN/VIO | 4.6 ft |
| 4 | #PDM_BPOS PDM30 Battery Feed | BAT+ (fused, rating TBD) → PDM30 M6 stud | 0 AWG M22759/16 (alt: 2× 4 AWG parallel — v4.1 receipt §3.3) | ORN/RED | 3.5 ft |
| 5 | #40 Ignition Switch | column switch → PDM30:A27 (DIG1, master RUN) | 22 AWG M22759/32 | ORN | 3.5 ft |

Starter solenoid trigger + alternator field/sense wiring: not yet numbered in the cut list —
the 0 AWG runs above are the cranking/charging power path; solenoid S-terminal control is part
of the #40/PDM start logic to be pinned at PDM programming (open, flag carried from v4).

### 2. GROUNDS (4 wires + hardware straps) — before anything is powered

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 6 | #PDM_GND1 PDM30 Battery Negative 1 | PDM30:A26 → BAT− star | 20 AWG M22759/32 | BLK | 3.5 ft |
| 7 | #PDM_GND2 PDM30 Battery Negative 2 | PDM30:B18 → BAT− star | 20 AWG M22759/32 | BLK/WHT | 3.5 ft (EQUAL LENGTH with #PDM_GND1) |
| 8 | #COIL_GND Coil Ground Rail | DEL-Stributor bracket bus → engine block star | 16 AWG M22759/32 | BLK | 3.0 ft |
| 9 | #123 Dakota Ground | cluster → dash star ground | 22 AWG M22759/32 | BLK | 3.0 ft |

Hardware (not numbered wires, required): battery− → engine block strap; engine block → frame
strap; frame → body strap. BAT− star and dash star locations land with the battery tray.

### 3. ECU LIFELINES (4 wires) — the v4.1 fix; the ECU cannot power on without these

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 10 | #ECU_PWR M130 Battery Positive | switched element (OPEN — relay or freed PDM ch) → M130:A26 | 16 AWG M22759/32 | RED | 4.6 ft |
| 11 | #ECU_GND1 M130 Battery Negative 1 | M130:A10 → BAT− star | 16 AWG M22759/32 | BLK | 4.6 ft |
| 12 | #ECU_GND2 M130 Battery Negative 2 | M130:A11 → BAT− star | 16 AWG M22759/32 | BLK/WHT | 4.6 ft (EQUAL LENGTH with #ECU_GND1) |
| 13 | #62 CAN Bus Network | M130:B17/B18 (CAN_HI/LO) → PDM30 → nodes | 24 AWG TWISTED PAIR | WHT/GRN | 3.5 ft (120 Ω termination each end) |

M130 wakes on BAT_POS energize — no ignition pin exists (techspec pp.16-18). Both ground pins
mandatory (injector + ignition return current — v4.1 receipt §3.2).

### 4. CRANK / CAM (8 wires) — no sync, no spark

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 14-16 | #99 + #99g + #99s CKP signal/gnd/drain | front timing cover sensor → M130:B01 / B15 / B15 | 22 AWG SHIELDED 2C | BLU/WHT/WHT + BLK + BARE | 4.6 ft |
| 17 | #99r CKP 5V Reference | M130:A02 (SEN_5V_A) → sensor | 22 AWG M22759/32 | GRY | 4.6 ft |
| 18-20 | #101 + #101g + #101s CMP signal/gnd/drain | front cover sensor → M130:B02 / B16 / B16 | 22 AWG SHIELDED 2C | BLU/WHT/BLK + BLK + BARE | 4.6 ft |
| 21 | #101r CMP 5V Reference | M130:A09 (SEN_5V_B) → sensor | 22 AWG M22759/32 | GRY | 4.6 ft |

Shield drains land at SEN_0V at the ECU end ONLY.

### 5. FUEL (7 wires) — pressure before spark

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 22 | #66 Fuel Pump | feed → Aeromotive A1000 (direct-wired, 35 A class) | 8 AWG M22759/16 | ORN/BLU | 18.4 ft |
| 23 | #94 Fuel Pump Relay | PDM30 (channel TBD) → pump relay coil | 22 AWG M22759/32 | ORN | 4.6 ft |
| 24 | #112 Fuel Pressure Sensor | rail sensor → M130:A16 (AV3) | 22 AWG M22759/32 | VIO/BLK | 4.6 ft |
| 25 | #112g FP Ground | sensor → M130:B16 | 22 AWG M22759/32 | BLK | 4.6 ft |
| 26 | #112r FP 5V Reference | M130:A02 → sensor | 22 AWG M22759/32 | GRY | 4.6 ft |
| 27 | #98 Fuel Level Sender (ECU) | tank sender → M130:AV pin **UNASSIGNED** (AV6/B20 candidate) | 22 AWG M22759/32 | ORN/RED | 18.4 ft |
| 28 | #117 Dakota Fuel Level Sender | tank sender tap (parallel #98) → cluster | 22 AWG M22759/32 | ORN/RED | 18.4 ft |

### 6. IGNITION (9 wires) — DEL-Stributor central bracket, 8× D510C

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 29 | #COIL_PWR Coil +12V Rail | PDM30:OUT-TBD (use a freed channel) → bracket bus | 16 AWG M22759/32 | RED | 3.0 ft |
| 30 | #24 Coil 1 | M130:A13 → bracket | 22 AWG M22759/32 | WHT/ORG | 2.5 ft |
| 31 | #9 Coil 2 | M130:A06 → bracket | 22 AWG M22759/32 | WHT/RED | 2.5 ft |
| 32 | #5 Coil 3 | M130:A03 → bracket | 22 AWG M22759/32 | WHT | 2.5 ft |
| 33 | #10 Coil 4 | M130:A07 → bracket | 22 AWG M22759/32 | WHT/BLU | 2.5 ft |
| 34 | #7 Coil 5 | M130:A04 → bracket | 22 AWG M22759/32 | WHT/WHT | 2.5 ft |
| 35 | #11 Coil 6 | M130:A08 → bracket | 22 AWG M22759/32 | WHT/YEL | 2.5 ft |
| 36 | #8 Coil 7 | M130:A05 → bracket | 22 AWG M22759/32 | WHT/BLK | 2.5 ft |
| 37 | #12 Coil 8 | M130:A12 → bracket | 22 AWG M22759/32 | WHT/VIO | 2.5 ft |

⚠ Calc gauge audit flags all 8 coil trigger wires (22 AWG @ 4 A nameplate → wants 18 AWG).
Trigger current is pulsed, not continuous — carry the flag to Dave, don't silently re-gauge.

### 7. INJECTION (9 wires)

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 38 | #INJ_PWR Injector +12V Rail | PDM30:OUT-TBD (freed channel) → rail daisy-chain | 16 AWG M22759/32 | RED | 5.0 ft |
| 39-46 | #13–#20 Injectors 1-8 | M130:A19/A20/A21/A22/A27/A28/A29/A30 → injectors | 22 AWG M22759/32 | GRN family | 4.6 ft ea |

⚠ Same pulsed-load audit flag as coils (22 AWG vs 4 A nameplate). Techspec p.12 note applies:
INJ_PWR rail terminates as close as possible to M1 supply pins.

### 8. DBW THROTTLE + APS (12 wires)

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 47 | #4a ETB TAC Motor 2 | M130:A01 (OUT_HB2) → GM 12605109 pin A | 20 AWG M22759/32 | BRN | 4.6 ft |
| 48 | #4b ETB TAC Motor 1 | M130:A18 (OUT_HB1) → pin B | 20 AWG M22759/32 | YEL | 4.6 ft |
| 49 | #4c ETB TPS1 | M130:A14 (AV1) → pin C | 22 AWG M22759/32 | DK GRN | 4.6 ft |
| 50 | #4d ETB TPS2 | M130:A17 (AV4) → pin D | 22 AWG M22759/32 | PPL | 4.6 ft |
| 51 | #4e ETB 5V Ref | M130:A02 (SEN_5V0_A) → pin E | 22 AWG M22759/32 | GRY | 4.6 ft |
| 52 | #4f ETB Signal Ground | M130:B15 (SEN_0V_A) → pin F | 22 AWG M22759/32 | BLK | 4.6 ft |
| 53 | #APS_T1_SIG APS Track 1 Signal | pedal (GM 10379038) → M130:B21 (AV7) | 22 AWG M22759/32 | VIO/YEL | 3.5 ft |
| 54 | #APS_T1_5V APS Track 1 5V Ref | M130:A02 (SEN_5V0_A) → pedal | 22 AWG M22759/32 | GRY | 3.5 ft |
| 55 | #APS_T1_GND APS Track 1 Ground | pedal → M130:B15 (SEN_0V_A) | 22 AWG M22759/32 | BLK | 3.5 ft |
| 56 | #APS_T2_SIG APS Track 2 Signal | pedal → M130:B22 (AV8) | 22 AWG M22759/32 | VIO/ORG | 3.5 ft |
| 57 | #APS_T2_5V APS Track 2 5V Ref | M130:A09 (SEN_5V0_B) → pedal | 22 AWG M22759/32 | GRY | 3.5 ft |
| 58 | #APS_T2_GND APS Track 2 Ground | pedal → M130:B16 (SEN_0V_B) | 22 AWG M22759/32 | BLK/WHT | 3.5 ft |

APS = dual-track (two independent tracks, each signal+5V+0V — GM APP architecture); tracks
deliberately split across the two 5V rails with letter-paired grounds so one rail fault
can't take both (v4.2 receipt §4.2). Lengths are dash-zone estimates (L19 proxy,
`needs_rederivation`). gm_aps_6pin per-cavity map = connector-time open item.

Open Q carried from as-built survey: photos show a 4150-flange TB; locked decision is 90 mm
DBW GM 12605109 — confirm before building this group.

### 9. ENGINE SENSORS (22 wires; 2 optional)

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 59-61 | #108 + #108g + #108r MAP | sensor → M130:A15 (AV2) / B15 / A09 | 22 AWG M22759/32 | VIO/WHT + BLK + GRY | 4.6 ft |
| 62-63 | #109 + #109g IAT | sensor → M130:B03 (AT1) / B15 | 22 AWG M22759/32 | TAN + BLK | 4.6 ft |
| 64-65 | #110 + #110g CLT (ECU) | sensor → M130:B04 (AT2) / B16 | 22 AWG M22759/32 | TAN/WHT + BLK | 4.6 ft |
| 66-67 | #113 + #113g Oil Temp | sensor → M130:B05 (AT3) / B15 | 22 AWG M22759/32 | TAN/BLK + BLK | 4.6 ft |
| 68-70 | #102 + #102g + #102r OPS (ECU) | sensor → M130:A25 (AV5) / B16 / A02 | 22 AWG M22759/32 | VIO + BLK + GRY | 4.6 ft |
| 71-73 | #103 + #103g + #103s Knock 1 | sensor → M130:B07 / B15 / B15 | 22 AWG SHIELDED 2C | GRY + BLK + BARE | 4.6 ft |
| 74-76 | #104 + #104g + #104s Knock 2 | sensor → M130:B13 / B16 / B16 | 22 AWG SHIELDED 2C | GRY/WHT + BLK + BARE | 4.6 ft |
| 77 | #64 Wideband Lambda Controller | PDM30:OUT24 → controller | 22 AWG M22759/32 | ORN/BLK | 4.6 ft |
| 78-79 | #106 / #107 Wideband O2 1/2 | controller → sensors | 22 AWG M22759/32 | VIO/BLU, VIO/BLU/WHT | 11.5 ft ea |
| 80 | #100 Vehicle Speed Sensor — **OPTIONAL for engine start** | VSS → M130 (route open — overflow item) | 22 AWG M22759/32 | ORN/BLU | 11.5 ft |

### 10. COOLING (3 wires) — it will idle long enough to need them

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 81 | #25 Electric Water Pump | PDM30:OUT5 → pump | 14 AWG M22759/32 | ORN/BLU | 4.6 ft |
| 82 | #21 Radiator Fan 1 | PDM30:OUT1 (dual-pin 20 A) → fan | 12 AWG M22759/32 | ORN/WHT | 4.6 ft |
| 83 | #22 Radiator Fan 2 | PDM30:OUT2 (dual-pin 20 A) → fan | 12 AWG M22759/32 | ORN/BLK | 4.6 ft |

⚠ Calc audit flags both fan feeds (12 AWG @ 18 A over ~8 ft derived length → wants 10/8 AWG)
— standing audit item, predates this config; resolve with Dave at formboard.

### 11. DAKOTA / GAUGES (5 wires; 1 optional)

| # | Wire | From → To | Spec | Color | Len |
|---|---|---|---|---|---|
| 84 | #71 Dakota Digital Gauge Cluster | PDM30 (OUT29 group) → VHX control box | 22 AWG M22759/32 | ORN/VIO | 3.5 ft |
| 85 | #114 Dakota CTS Sender | factory CTS, driver head boss → cluster | 22 AWG M22759/32 | BRN/WHT | 8.0 ft |
| 86 | #115 Dakota Oil Pressure Sender | factory 0-90 PSI, galley boss → cluster | 22 AWG M22759/32 | VIO/WHT | 8.0 ft |
| 87 | #116 Dakota Tach Signal | M130:A31 (OUT_HB3) → cluster | 22 AWG M22759/32 | WHT/BLK | 8.0 ft (M1 GPR config at tune) |
| 88 | #65 Display/Dash (MoTeC C125) — **OPTIONAL but recommended for first start/tune** | PDM30:OUT29 → C125 | 22 AWG M22759/32 | ORN/RED | 3.5 ft |

(#123 Dakota ground laid in group 2; #117 fuel sender in group 5.) Deferred Dakota wires —
not needed to verify a running engine: #118 VSS, #119/#120 turn inputs, #121 high beam,
#122 brake, #124 +12V backup.

---

## PDM CHANNELS IN THIS CONFIG

In use (5): OUT1/OUT2 (fans), OUT5 (water pump), OUT24 (wideband), OUT29 (display/Dakota).
**Freed (25):** OUT3,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,30.
Assign #ECU_PWR, #INJ_PWR, #COIL_PWR, #94 fuel-pump-relay from the freed pool for the start
phase — capacity is not the constraint here; the assignment decision is (flagged in v4.1
receipt §4 + the 2026-05-14 addendum TBDs).

## WHAT THIS LIST DOES NOT COVER

Connector/terminal PNs at device ends (deferred until after formboard — locked 2026-05-11,
D38999 bulkhead excepted), heat-shrink/boot stack (see research/2026-05-21 milspec protocols),
starter solenoid trigger + alternator field pinning (PDM programming pass), and all lengths
as cut values (zone estimates until the Blender twin re-derivation + on-vehicle verification
per Dave's method: max-length prototype first, then cut).
