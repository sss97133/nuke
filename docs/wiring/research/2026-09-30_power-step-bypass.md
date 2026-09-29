# Power steps without the AMP controller (2026-09-30)

Owner, 2026-09-29: "additionally I don't like seeing a power step we're gonna have to just bypass them figure out how to
power differently which that has a lot of implications obviously computer".

**Reading:** the AMP Research steps (motors and linkages) stay on the truck. The AMP controller and its kit harness go.
The MoTeC system powers and runs the two step motors instead.

"I don't like seeing a power step" could also mean no steps at all. The rest of the sentence says to bypass them and power
them differently, so this design keeps the steps.

**Sources.** Web sources are saved as snapshots in `reference_documents/web_snapshots/<file>` (gitignored; third-party
text stays out of the public repo). Each snapshot records its URL and the fetch date, 2026-09-29. MoTeC manuals are cited
by printed page, with the library extract page in brackets: `docs/library/_extracted/component_drawings__motec_pdm_user_manual/page-00NN.txt`.

**Status.** Nothing here is decided. The candidate options are `STEP-DCMD`, `STEP-RQ` and `STEP-SW` in
`calc-data/catalog/options.yaml`. The receipt is `receipts/2026-09-30_power-steps-without-amp-controller.md`.

---

## 1. The kit on this truck

- **What the records say:**
  - Nuke DB row `invoice_learned_pricing` 641c499e-6bac-420d-aef6-5db251294a5f (client invoice, 2025-03-01):
    - brand "AMP Research";
    - part "PowerStep running boards via Far From Stock P300";
    - note "AMP PowerStep kit with FFS P300 brackets";
    - **part number: none recorded**.
  - Gmail (searched 2026-09-29 for Far From Stock, farfromstock, AMP Research, PowerStep, "running board" with order,
    invoice or shipped): marketing mail only. There is no order or shipping record for the steps.
- **The kit as sold:** Far From Stock's "SquareBody Chevy 73-87 Amp Research Power Folding Step Kit". It has a style
  option "K5 Blazer/Jimmy". The listing says:
  - "Includes various modified Amp parts. In house bracket parts and hardware. Light wiring harness modifications to ease
    install. Courtesy light for nighttime visibility."
  - "Due to the rudimentary nature of the wiring in older pickups, both steps lower when opening either door."
  - Source: `farfromstockstore.com__sqaure-body-chevy-73-86-amp-research-power-folding-step-kit.md`.
- **Unknown: the AMP part number inside the FFS kit.** Close path: read the carton label or the motor label, or get a
  photo of the motor and its plug.
- **The saved AMP guide is for a different kit.** `reference_documents/component_drawings/amp_research_75146_install.pdf`
  is IM75146 rev 01.10.20, kit 75146-01A (2011-14 Silverado/Sierra diesel). It is used below for how AMP kits behave,
  not as this kit's wiring.

## 2. The motors

| Fact | Value | Source |
|---|---|---|
| Motor type | an automotive window-lift motor: "One suitable type of electric motor assembly 402 is a standard automotive window-lift motor, such as those available from Siemens AG of Munich, Germany." | patent US 7,163,221 B2 (original assignee 89908 Inc, AMP Research's company; now Lund Motion Products), `patents.google.com__US7163221B2.md` |
| | "Advantageously, a window motor may be used to drive the apparatus." | US 6,641,158 B2 (on IM75146 p.1's patent list), `patents.google.com__US6641158B2.md` |
| Replacement motors | 80-03129-90 (Siemens): "The SIEMENS Motor has officially been discontinued" and buyers "will now need to upgrade to the NEW BROSE Motor" | `www.electricstep.com__AMP-Research-Replacement-Motor-80-03129-90-p228.md` |
| | 80-04868-90 (Brose), $99.99: "designed specifically for PowerStep systems utilizing Brose motors ... NOT a replacement for SKU# 80-03129-90" | `ampstep.com__amp-research-replacement-motor-80-04868-90.md` |
| | 80-04868-10 "SIEMENS to BROSE Conversion Kit", $119.99 | `ampstep.com__amp-research-replacement-motor-80-03129-90.md` (that URL serves the conversion kit) |
| Which motor this kit has | **unknown**. The Brose one is "easily identified by the specific housing shape" | ampstep 80-04868-90 page |
| Supply | 12 V. AMP's motor test: "manually put 12v power+ and ground- to each of the pins on the motor ... One contact gets positive+ and the other gets a ground- and the motor moves one way, then you switch the configuration, and the motor will spin the other." | AMP PowerStep Installation Troubleshooting Guide, Test 3, p.5, `static.summitracing.com__mpa-77152-01a.md` |
| Plug | two pins. Leads are "a solid orange and solid white wire" on one side and "orange/black stripe and white/black stripe" on the other | same guide, Test 3, p.5 |
| Plug housing part number | **unknown**. Not in any AMP document fetched. Close path: read the plug on the kit | — |
| Running current | **unknown**. No AMP, RealTruck or dealer page gives it | — |
| Stall current | **unknown** | — |
| Third-party figures (not used for design) | "A working PowerStep motor draws about 3 to 5 amps under normal load. A seized or worn motor pulls 15+ amps stall current". This blog gives no author, no method and no maker source | `towratings.net__how-to-fix-amp-research-power-step-problems.md` |
| The kit's own fuse | "Remove the 30/40-amp fuse to the system", in the red lead from battery + to the controller | troubleshooting guide, Test 1, p.3 |

**The bench measurement that closes the current unknowns** (Skylar or Dave, about 30 minutes, nothing to buy):
- One motor on its linkage, a 12 V supply or the truck battery, and a DC clamp meter.
- Log the free-running current in both directions.
- Log the current held against each end stop for under 1 s.
- Log the travel time each way.

Every gauge, PDM limit and threshold below waits on those numbers.

## 3. How the stock controller runs them

| Question | What AMP documents show | Source |
|---|---|---|
| **Reversing** | The controller reverses polarity. With the motor unplugged, a door opening puts "battery voltage for 5 seconds" on the motor plug, and a door closing puts "-battery voltage for 5 seconds" | troubleshooting guide, Test 3, p.5 |
| **Drive window** | **5 s** in each direction when no motor is connected | same |
| **End of travel** | Deployed: a mechanical stop. "the extended position B is reached when the support arms 30 a, 30 b contact a stop 52". The deployed step carries load with no help from the motor: "without input from motor 146 ... when stepped upon by a user" | US 6,641,158 B2 |
| | Stowed: the step falls to deployed under its own weight when the motor is off the linkage. "The step will rest in the down position after the motor has been removed"; "The board should return to the fully deployed position quickly". So the motor's gear train holds the step stowed | troubleshooting guide, Test 4, p.6; IM75146 p.5, "Steps should deploy under own weight" |
| How it knows it has arrived | **Not published.** The documented behaviour points to stall (current) sensing with the 5 s window as the backstop: the step stops on an obstruction, stays put when held by a foot, and runs 5 s with no motor. The threshold is unknown. **This is inferred, not documented** | IM75146 p.12; guide Tests 3–4 |
| **Pinch / obstacle** | "Automatic stop: If an object is in the way of the moving running board, the running board will automatically stop. To reset, clear any obstruction, then simply open and close the door to resume normal operation." The patent adds only "a standard anti-pinch/anti-strike system may be used, as is known in the art" | IM75146 p.12; US 6,641,158 B2 |
| Hold out for cleaning | "Manually set the running boards in the deployed position by opening the door, and then place your foot on the step. Maintain firm pressure with your foot on the step as you close the door. Your steps will remain in the deployed position." That is a stall on the retract stroke, latched until the next door cycle | troubleshooting guide, Test 4, p.6 |
| **Auto-retract** | "there is a 2-second delay before the PowerStep returns to the stowed/retracted position" | IM75146 p.10 and p.12 |
| Triggers | "When chassis ground is applied to wires it will deploy the step and when ground is removed it will retract the step". There are two purple leads, "one driver and one passenger" | troubleshooting guide, Test 2, p.4 |
| Lamps | "All four lamps will illuminate upon opening any door ... Lamps will stay on until restowing of both Power Steps or until 5 minutes has expired" | IM75146 p.10 |
| Travel times | deploy "about 0.3–2.0 seconds", retract "about 0.6–1.8 seconds". These are patent embodiments, not this kit | US 7,163,221 B2 |

So the stock AMP controller is a door-triggered reversing drive. It stops on an obstruction, by a method AMP doesn't
publish, and has a 5 s window. That behaviour is what the MoTeC side has to reproduce.

## 4. Why a PDM can't do it alone, and what that leaves

1. **PDM outputs only switch to battery +.**
   - "All outputs are high side type outputs; they switch Batt+ to the output pin." (PDM manual p.6 [page-0009] and p.22
     [page-0025].)
   - A two-wire motor reverses only when each lead can go to both + and ground, so two PDM outputs cannot reverse it.
   - The one ground path, on Output 9, is a braking pulse: the PDM "performs motor braking by momentarily shorting the
     output to ground when the output turns off" (p.8 [page-0011]). Its clamp is −0.7 V relative to Batt− (p.36
     [page-0039]). It is not a sustained return.
2. **Relays are out.** `wiring_decisions` row `locked-pdm-replaces-relays` (decided 2026-09-24) reads "PDM replaces relays —
   no relay/bypass designs"; chosen: "PDM outputs drive the loads; no relays or bypass circuits". This is state §1 row 54.
   The relay H-bridge is the textbook answer, and it is not offered. Only the owner can reopen it.
3. **The M130 half-bridges are out.**
   - All six are taken (registry `m130_pinout`):
     - A1/A18: throttle motor;
     - A31: Dakota tach;
     - A32: check-engine;
     - A33: PCS RPM;
     - A34: fan PWM.
   - Their rating is "Max current HS 9 Amps minimum", "RMS current 4 Amps", and two outputs make one motor bridge (M1
     hardware techspec p.11 [page-0011]).
   - The M130 is off with the key off, and AMP steps deploy key-off (registry wire 3: "the steps deploy key-off").
4. **No MoTeC part has an H-bridge.**
   - MoTeC's current range is PDM15, PDM30 and PDM32 (`www.motec.com.au__Power-Distribution-Modules.md`), all high-side
     only.
   - The expanders are E888, SVIM and TCMux (`www.motec.com.au__Expanders.md`). None is a motor bridge.
5. **Ecumaster PMU (checked, no):**
   - high-side outputs;
   - a wiper braking output;
   - on the AS version, six "low-side up to 1 A" outputs.
   - No motor bridge (`www.ecumaster.com__PMU_Manual.md`).

**What's left is a solid-state H-bridge commanded by PDM outputs.** Two real products follow. Commanding a bridge over
the MoTeC CAN trunk was considered and not used. A step controller on the bus the engine loads depend on could stop the
engine if it failed ("a dead bus shuts engine loads off", state row 0v). Discrete lines keep the steps off that bus.

---

## 5. Way 1 — `STEP-DCMD`: the bay PDM (PDM32 candidate) + two Haltech DCMD bridges (recommended)

**Part.** Haltech HT-038009 "DC Motor Driver – DCMD", $180.00 each (`www.haltech.com__ht-038009-dc-motor-driver-dcmd.md`,
2026-09-29). Two are needed, one per motor. **The pick is provisional until the bench test (§11)** confirms the motor
currents fit it and a pulled-down input drives it.

**Which PDM.** The bay PDM, a sealed PDM32 carrying the engine and front loads. That is a candidate, not a decision:
- The PDM15 can't stay in the bay. Its case is magnesium with a coated board only; the PDM16/PDM32 have "Rubber seal on lid
  and connectors" (PDM manual p.35 [page-0038]; mounts.yaml PDM15 entry).
- Dave's one-connector rule moves the front loads to a bay PDM, "about 22–27 outputs, which is a PDM32" (state row 0ah;
  receipt 2026-09-29_owner-calls-one-61pin-at-fusebox-hole).
- The PDM15 is then proposed as a second cab PDM (owner call pending).
- **STEP-DCMD depends on that bay-PDM decision.** The PDM32 has 8 × 20 A and 24 × 8 A outputs, 23 inputs and 120 A total
  (pp.35–36). Its 8 A outputs are on the 26-pin Autosport connector B (p.42 [page-0044]).

**Specs** (Haltech quick start guide, `www.haltech.com__ht-038009-dcmd-quick-start-guide.md`, pp.2–3 and p.10):

| Item | Value |
|---|---|
| Channels | "Two independent channels", which make one "8A full bridge DC Motor Driver" |
| Current | "8A Continuous Per Channel, Maximum Transient Current 30A" (p.3) |
| Operating voltage | 8 V to 18 V DC |
| Ambient | −40 °C to +85 °C |
| Size | 86 × 28 × 55.5 mm |
| Wire | "16AWG – Power, Ground, Motor A/B"; "20AWG – Control A/B" |
| Fuse | "20A for Switched Power" |
| Protection | "Limited automatic overcurrent protection" |

**Control** (quick start guide p.10):
- "Control is Active State: Low. 0V on Control A = 0V on Motor A. Pull Up Resistor not required. Can be controlled from a
  DPO, Ignition, Injection, Stepper or DBW ECU output."
- Each channel follows its input: control low puts that motor lead at 0 V (Haltech's words). Control high putting it at
  +12 V is **inferred** (Haltech states only the low case, and says a push-pull stepper or DBW output can drive it); the
  bench check below confirms it.
- **Input logic levels: not published.** Haltech gives no threshold voltages, input impedance or pull-up value → unknown.

**How the PDM drives it:**
- A PDM output can only go high or float. So each control line gets a **pull-down resistor to ground**: output off reads
  low (lead at 0 V), output on reads high (lead at +12 V).
- Deploy = X on, Y off. Retract = X off, Y on. Idle = both off, which holds both leads at 0 V (braked). Bridge power is off
  whenever no move is running.
- **Pull-down value: unknown.** It has to beat the DCMD's internal pull-up, which isn't published. Close path: a 15-minute
  bench check with a meter, or ask Haltech (draft in §11).

**Connectors** (Haltech product page and quick start guide p.10):
- Power, ground and both control lines come on the DCMD's pre-terminated **4-pin DT** lead.
- The motor is on a **2-pin DT** on the case.
- In the box: "DT02-2S", printed that way (Deutsch's 2-way plug is DT06-2S; check the part in the box), DT06-4S, DTM06-4S
  and DTM04-4P.
- The Deutsch DT family is already in the build (`catalog/parts.yaml`: DT06-2S / DT04-2P with size-16 contacts, 20–16 AWG).

**Where it sits:**
- In the engine bay beside the bay PDM, one bridge per side, low near each front wheel-well opening. This is a proposed
  spot: the splash zone, not the spray zone. The builder places it.
- Haltech doesn't publish a sealing rating for the case → **unknown**. The connectors are sealed Deutsch.
- The motor leads then take the path AMP's own harness takes: "Route long end of wire harness above engine and down
  through drivers side wheel well ... Route short end down passengers side ... Route wire harness along the frame and back
  towards rear linkage" (IM75146 p.6).
- **No firewall crossing and no body penetration.** The two trigger-wire floor exits the AMP design needed (STEP_DOOR_L/R,
  "cab exit: through the body to the outside (path not recorded)") disappear.
- If there is no bay PDM in the end, the two bridges move into the cab with the PDM and the motor leads exit the floor as in
  Way 2.

**Bay PDM outputs.** Four 8 A outputs, all on connector B. Output numbers are assigned with the bay-PDM allocation.

| Output | Job |
|---|---|
| P_L (8 A) | DCMD-L power. Its current is the left motor's |
| P_R (8 A) | DCMD-R power. Its current is the right motor's |
| X (8 A) | Control A on both bridges |
| Y (8 A) | Control B on both bridges |

- **Both steps move together by default** (FFS's stated behaviour).
- Each bridge has its own feed, so per-door steps need no extra output. X/Y are shared: if the two doors call opposite
  directions at once, the PDM runs one move and then the other.
- **No 20 A output:** the bay PDM32's eight are all planned (capacity below).

**Current measurement:**
- The PDM reads P_L.Current and P_R.Current at 0.2 A resolution (outputs 9–32; manual p.26 [page-0029]), one motor each.
- End of travel is judged per side on that current, plus a timer (§8).
- **The bridge limits nothing.** Stall force is the motor's own until the PDM reacts, the same as AMP's stock controller.
- **The PDM's sampling and logic rate is not in the manual → unknown.** Measure the stop latency on the bench log.

**Fusing and PDM limits** (canon: limit ≥ 1.25 × load and ≤ 0.85 × the wire's rating, ch.17 §17.1 item 3; PDM manual
p.48 [page-0051] ratings at 100 °C, the engine bay):
- An 8 A output's pin takes 24–20 AWG (p.48). So each feed leaves the PDM on a 20 AWG pigtail and joins Haltech's 16 AWG
  power lead in an M81824/1-2 (the registry's pigtail method, state 0ac).
- 20 AWG is 6 A at 100 °C, × 0.85 = 5.1, so the P_L / P_R limit is **5 A**. That allows **≤ 4 A running per motor**
  (1.25 × 4 = 5).
- **Over 4 A per motor, each feed becomes two paralleled 8 A outputs.** They must be the same type and driven by the same
  condition (pp.6, 22–23): 2 × 5 A = 10 A through the same M81824/1-2 into 16 AWG (12 A × 0.85 = 10.2). That allows
  ≤ 8 A per motor, which is also the DCMD's continuous rating. Six outputs in all.
- Above 8 A per motor, take Way 2.
- X and Y carry only the control inputs and pull-downs: 1 A limit, the PDM's smallest step (p.1 [page-0004], "Outputs are
  programmable in 1 A steps").

**Bay PDM32 capacity.** This is an estimate: the bay PDM is not allocated yet. Counts are from the registry's PDM15 and
PDM30 output maps and the 30 wires that crossed the dropped body bulkheads.

| PDM32 outputs | Planned loads | Count |
|---|---|---|
| 20 A (8) | engine: fan legs 1 and 2 (today PDM15 OUT1/OUT6), injector rail, coil rail, starter trigger, fuel pump #66, LTCD #64 (PDM15 OUT2–5, OUT7); front: blower HI (PDM30 OUT2) | **8 of 8** |
| 8 A (24) | engine: ALT_L, A/C clutch #23 (PDM15 OUT9, OUT11); front loads among the body-bulkhead wires: iBooster wake, wiper #49, front park #83/#84, horn #48, front markers #87/#88, underhood lamp #73, washer #50, turn LF #80, turn RF #82 (PDM30 OUT9, 12, 13, 14, 19, 25, 26, 27, 28); loads the bay PDM would drive in place of cab switch leads: headlights low/high (#85a/b, #86a/b; 2–4 outputs), wiper second field (WIPER_T1/T3; 1), blower LOW/M1/M2 (BLOWER_BAT/MED/M2; 3, currents unknown) | **17–19 of 24** |
| 8 A, other candidates | wheel-speed sensor feed (branch `wiring/wheel-speed`, one 8 A output at 1 A) | +1 |
| 8 A, with STEP-DCMD | 4 (6 with the two-output feeds) | **22–24 of 24** (24–26 with two-output feeds: fits only at the low end) |

- The PCS TCM feed (PDM15 OUT13 today) stays with a cab PDM: the PCS is in the cab.
- **Substrate disagreement, flagged, not fixed:** registry `#66` fuel pump is on a 20 A output (PDM15 OUT5), while state row
  0o says "#66 14 AWG from a PDM 8 A output". If 0o is right, one PDM32 20 A output is free. A single 20 A pin (connector
  D, p.42) could then feed both bridges.

## 6. Way 2 — `STEP-RQ`: PDM30 + one Roboteq SDC2160 dual bridge

**Part.** Roboteq SDC2160, $350.00: "Brushed DC Motor Controller, Dual Channel, 2 x 15 A Continuous, 2 x 20 A Peak (30 s),
60V, USB, CAN, 8 Dig/Ana IO, Cooling plate with ABS cover ... not CE compliant" (`www.roboteq.com__sdc2160-detail.md`,
2026-09-29). The SDC2130 is the same at 35 V. The SDC2160's absolute maximum on the battery leads is 62 V, against the
SDC2130's 40 V (datasheet Table 3).

**Datasheet** (SDC21xx v2.3, 2025-07-10, `www.roboteq.com__63-sdc21xx-datasheet.md`, Tables 3–9):

| Item | Value |
|---|---|
| Current per channel | 20 A max for 30 s; 15 A continuous ("Estimate. Limited by heatsink temperature") |
| Current limit | adjustable 1–20 A |
| Stall detection | 1–20 A, timeout 1–65000 ms, default 500 ms |
| Digital inputs | '1' = 3–30 V, '0' = −1 to 1 V, 53 kΩ input impedance. A 12 V PDM output drives a DIN directly |
| Idle current | 50–100 mA |
| Board | −40 to 85 °C; humidity 100 % non-condensing. **Cab only** |
| Power terminals | screw terminal, 12 AWG max, M1+ M1− VMot GND M2+ M2− |
| I/O connector | DB15: DIN1 pin 4, DIN2 pin 8, GND pins 5/13 |

**In the controller** (user manual v2.1, `www.roboteq.com__272-roboteq-controllers-user-manual-v21.md`, p.91):
- Amps-threshold trigger per channel with "Safety Stop ... until command is moved back to idle or command direction is
  reversed".
- "Typical uses for it are for stall detection or 'soft limit switches'. When ... a motor reaches an end and enters stall
  condition, the current will rise ... the motor be made to stop until the direction is reversed."
- It is current-limited (a force limit, which AMP's stock controller does not have) and it stops each motor at each end
  by itself.

**Maker's rules that shape the wiring:**
- "The battery must be connected in permanence to the controller's VMot via an input emergency switch or contactor SW2";
  "An external safety contactor must be used in any application where damage to property or injury to person can occur"
  (datasheet p.4–5). The PDM30 output feeding VMot is that disconnect.
- "The Power Control input MUST be connected to Ground to turn the Controller Off" (user manual pp.22–23, Table 1-1). So
  PwrCtrl is tied to the PDM feed with a **pull-down to ground**. Value unknown; close with Roboteq or a bench reading of
  < 1 V with the feed off.
- "Beware not to create a path from the ground pins on the I/O connector and the battery's minus terminal" (datasheet
  Note 5). The DB15 grounds are not wired to a ground bank.
- The DINs "are high impedance lines with a pull down resistor built into the controller. Therefore it will report an Off
  state if unconnected". With a pull-up source (the PDM output), "an external pull down resistor should be installed",
  1K to 10K in the figure (user manual p.48, Figure 3-4). So each DIN gets one.
- DIN actions have no "run forward" (user manual p.62, Table 4-1), so a short **MicroBasic script** maps DIN1/DIN2 to the
  motor commands. It is the only new code in either way.

**PDM30 outputs** (PDM30 pinout, manual p.44 [page-0047]):

| Output | Pins | Job |
|---|---|---|
| OUT3 (20 A) | A_5 + A_14 | Feed: 2 × 16 AWG pigtails → M81824/1-3 → 12 AWG to VMot + PwrCtrl |
| OUT21 (8 A) | B_1 | Direction → DIN1 |
| OUT4 (per-door option) | A_7 + A_16 | → DIN2 |

- **These are exactly the spares that exist only while PW (OUT3/OUT4) and PL (OUT21) stay unfitted** (registry map; capacity
  ledger PDM30 20 A 6/8, 8 A 21/22). The fiberglass-top candidate TOP-LIGHT names OUT21 too, and the Starlink candidate COM
  names OUT3. Way 2 plus PW plus PL (or TOP-LIGHT, or COM) does not fit on the PDM30.
- It fits anyway if the PDM15 becomes the second cab PDM. That is proposed with the bay PDM32 (state 0ah), and the owner
  call is pending. STEP-RQ then runs on its outputs, and the conflict clears. The front loads leaving for the bay PDM32 also
  free PDM30 outputs.

**Door inputs** stay local: DIG12/DIG13 on the same PDM30. No CAN dependency for the triggers.

**Floor exits.** The motor leads leave the cab near each door through a sealed cable clamp. The Blue Sea 1003 CableClam is
already used for AMP-PASS ("max cable 0.56 in", options_v5.py). The owner allows round bulkheads only, and prefers
mil-spec over marine; the part is open.

**Fusing and PDM limits** (cab, 80 °C column):
- The OUT3 limit is ≤ 17 A (12 AWG leg: ProWire bundled 20 A × 0.85; the pigtails 2 × 15 A are not the limit).
- That allows **≤ 6.8 A running per motor** (1.25 × 2 × 6.8 = 17).

## 7. Motor-lead gauge (canon, both ways)

- **Rules:** voltage drop ≤ 3 % = 0.42 V at 14 V (ch.16 §2.4). Limit ≥ 1.25 × load, ≤ 0.85 × rating (ch.17 §17.1 item 3).
- **Resistance:** ch.16 §1.8 (M22759/16 datasheet; same conductor as /32, ch.16 §1.1).
- **Ratings:** PDM manual p.48.
- **Length:** the only one on file is the cut list v4.2 zone estimate for PDM30 → step motor, 11.5 ft (rows 104–105, registry
  wires 1/2), so a 23 ft loop. **ESTIMATE.** The bay path (Way 1) has no estimate. harness-cad derives both on the twin, and
  the table is re-run on those lengths.

| Gauge (/32) | Loop resistance | Max running current, 3 % drop | Max load by rating, 80 °C / 100 °C |
|---|---|---|---|
| 18 AWG | 0.143 Ω | 2.9 A | 7.5 / 6.1 A |
| 16 AWG | 0.111 Ω | 3.8 A | 10.2 / 8.2 A |
| 14 AWG | 0.070 Ω | 6.0 A | 15.0 / 12.2 A |
| 12 AWG | 0.047 Ω | 9.0 A | not in the PDM table |

**At this length, voltage drop sets the gauge.** The pick waits on the measured running current. If the unverified 3–5 A
is right, 14 AWG. The motor end of each lead splices to about 6 in of the kit harness kept on the AMP motor plug: M81824/1-2
for 20–16 AWG, /1-3 for 16–12 AWG (`catalog/parts.yaml`). The motor then still unplugs at its own connector.

---

## 8. The logic, as the PDM runs it (Way 1 on the bay PDM; Way 2 differences after)

**What the PDM can do** (manual):
- inputs with trigger levels and trigger times ("A trigger time of 0.1 second will normally reject switch bounce", p.19
  [page-0022]);
- CAN inputs extracted by byte offset, mask and divisor, with timeout channels and a timeout value per channel (pp.19–21
  [page-0022..24]);
- a PDM input's state is sent over CAN in the standard messages ("Input State", p.21 [page-0024]);
- up to 200 logic operations: "Flash, Pulse, Set/Reset, Hysteresis, Toggle, And, Or, Less than, Greater than, Not equal
  to, Equal to, True, False", plus counters (p.1 [page-0004], p.22 [page-0025]);
- per-output Current, Voltage, Load and Status channels (p.26 [page-0029]);
- over-current and fault shutdown with retries (pp.23–24 [page-0026..27]);
- a Global Error channel for a fault lamp (p.26);
- standby exits "when ... Any input pin changes state" or "Activity is present on the CAN bus" (p.34 [page-0037]), so a door
  opening wakes it key-off.
- **The operator parameters** (Pulse length, edge selection) are set in PDM Manager. The user manual names the operators
  but doesn't define their fields → confirm in PDM Manager.

**Inputs (bay PDM, over CAN).** Each gets its own CAN channel with its own timeout value:

| Channel | From | Value if the message times out |
|---|---|---|
| `Step.DoorL`, `Step.DoorR` | PDM30 DIG12 / DIG13 | 0 (treated as closed) |
| `Step.Run` | PDM30 DIG1 | 1 (treated as running) |
| `Step.Start` | PDM30 DIG10 | 0 |
| `Step.Off` | PDM30 DIG16 (STEP-SW) | 1 (steps disabled) |
| `Step.Speed` | M130 M1 General stream, vehicle speed | 255 |
| `Step.SpeedTO` | timeout flag of `Step.Speed` | — |

- The M130 reads road speed on B08 from the Dakota SEN-01-5 sender on the NP205 speedometer drive (registry #100). That drive
  is the transfer case's output, so it reads road speed in both ranges.
- The M1 General stream (base 0x640, 1 Mbit/s) carries vehicle speed. Sources: BIM-EFI-1 manual p.29 and the ECUMaster
  M1 note (`DAKOTA_VHX_ARCHITECTURE.md` §3b). The M130 needs "ECU Transmit" on for it.
- `Step.LowBatt` = battery voltage below V_lo, with Hysteresis.

**Conditions:**

| Channel | Rule |
|---|---|
| `Step.Moving` | Run AND (Speed > **S_max** OR SpeedTO). Key off (Run = 0) means parked: steps work with the M130 off, as AMP's do |
| `Step.Allow` | NOT Moving AND NOT Off AND NOT Start AND NOT LowBatt AND NOT Fault |
| `Step.WantOut` | (DoorL OR DoorR) AND Allow |
| `Step.Delay` | Pulse **2.0 s** when WantOut goes false (AMP's delay, IM75146 p.10) |
| `Step.HoldOut` | Set by an early stall on retract (below). Reset when a door next opens, or when Moving |
| `Step.Dir` (1 = out) | WantOut OR (Delay AND Allow) OR (HoldOut AND Allow) |
| `Step.Window` | Pulse **T_max ≤ 5 s** on any change of Dir (AMP's drive window, guide p.5), and once at power-up to stow (how the PDM starts a pulse at power-up: confirm in PDM Manager) |
| `Step.Blank` | Pulse **t_blank** on Dir change. Motor start-up current is "3 to 5 times the steady state current and it dies out in less than a second" (p.28 [page-0031]). Set t_blank from the bench log |
| `Step.StalledL`, `Step.StalledR` | Window AND NOT Blank AND P_L.Current (P_R.Current) > **I_stop**, held for **t_confirm**, one per side |
| `Step.DoneL`, `Step.DoneR` | Set by that side's Stalled, reset by a Dir change |
| `Step.Early` | A side Stalled while Pulse **t_min** (shorter than normal travel) is still true. On a retract: set HoldOut, which reverses to out and releases the pinch. That matches AMP's foot-hold behaviour. On a deploy: stop, and the step retracts at the next door close |
| `Step.Fault` | Counter: N consecutive windows that end without both Done, or N Early events. Latched → Global Error (lamp optional). Cleared by Master Retry (p.18) |

**Outputs** (8 A outputs on the bay PDM32; numbers assigned with the bay-PDM allocation):
- P_L = Window AND NOT DoneL. P_R = Window AND NOT DoneR.
- X = Window AND NOT (DoneL AND DoneR) AND Dir.
- Y = Window AND NOT (DoneL AND DoneR) AND NOT Dir.
- Per-door steps: P_L / P_R also AND their own door's request. If the two sides need opposite directions at once, a
  Set/Reset holds the second move until the first is Done.
- Which of X/Y deploys depends on the motor's lead order. Set it on the bench.
- Retries on P_L / P_R: 0.

**Numbers still to set:**
- S_max: **the owner's number**.
- I_stop, t_blank, t_confirm, t_min: **from the bench log**.
- V_lo: **open**.
- Logic cost is about 20 of the 200 operations.

**Way 2 differences** (PDM30):
- The door, RUN, START and STEP-SW inputs are local.
- Only speed comes over CAN: one of the PDM30's "4 messages, 8 bytes per message" (p.36 [page-0039]).
- OUT3 = Window (the controller's power).
- OUT21 = Dir (OUT4 = Dir_R for per-door steps).
- End of travel and the current limit are the Roboteq's (amps trigger per channel). The Window is the backstop.
- The early-stall release is written in the Roboteq script, because only it sees per-channel current.

**Override and service:**
- Holding the steps out for cleaning works as AMP's does: foot on the step while the door closes, which is the early
  retract stall.
- `STEP-SW` (optional) is a dash switch on PDM30 DIG16 that stows and holds the steps. It is for off-road use, and for when
  someone is under the rocker. DIG16 is also wanted by AS and LO4. If the CANKEY candidate (MoTeC CAN keypad) is fitted,
  one of its buttons does this job with no PDM input.
- PDM Manager "Test Outputs" (p.31 [page-0034]) drives each output from the laptop for set-up and service.

## 9. When something fails

| Failure | What happens |
|---|---|
| CAN from the PDM30 lost (Way 1) | doors read closed, STEP-SW reads on → steps stow and stay stowed |
| Speed message lost with RUN on | treated as moving → no deploy, and a deployed step retracts |
| M130 off, key off | RUN = 0 → parked → steps work (no speed needed) |
| Door switch stuck "open" (wire grounded) | steps deploy whenever parked; the speed rule keeps them stowed when moving |
| Door switch open-circuit | never deploys (safe) |
| Bridge feed (P_L / P_R, or OUT3 in Way 2) fails off | no motion; steps stay where they are. An open load is not a PDM fault ("Fault Shutdown occurs when the output voltage is lower than expected", p.23), so it only shows as a step that doesn't move |
| A control output stuck on during a move | both leads high → braked → no Done → Window times out → Fault counter → Global Error |
| Pull-down resistor open (Way 1) | that input floats high → that direction can't run. Fails to move, never runs away |
| Bridge shorted | the PDM output's short-circuit / fault shutdown; retries 0 → Global Error |
| Motor open | no current rise → Window times out → Fault after N |
| Linkage jammed, or an obstacle | early stall → stop (deploy) or release (retract) → Fault after N |
| Low battery or cranking | moves inhibited (LowBatt, Start) |
| Isolator off | nothing moves; steps stay where they are |
| Standby drain | both bridges unpowered at rest (the feed output off). The AMP controller's standby draw is not published |

## 10. What it does to the computers

| | Way 1 `STEP-DCMD` | Way 2 `STEP-RQ` |
|---|---|---|
| PDM30 outputs | none | OUT3 + OUT21 (+ OUT4 per door) |
| PDM30 inputs | + DIG16 with STEP-SW | + DIG16 with STEP-SW |
| Bay PDM (PDM32 candidate) outputs | 4 × 8 A (6 if a motor runs over 4 A); no 20 A output; no input | none |
| M130 pins | none | none |
| M130 configuration | M1 General transmit on (vehicle speed) | same |
| CAN messages | bay PDM receives: PDM30 input states (already needed for RUN/START) + M1 General speed | PDM30 receives: M1 General speed |
| New CAN nodes | none | none |
| New programmable device | none | the Roboteq (configuration + script) |
| Firewall / 61-pin | none | none |
| Body penetrations | none (the two trigger-wire exits go away) | 2 floor exits for motor leads (they replace the 2 trigger-wire exits) |
| Removed | wire 3 (the kit's red lead and its fuse at the distribution stud), STEP_GND, STEP_DOOR_L, STEP_DOOR_R, endpoint AMP-STEP-CTRL (controller + kit harness, except about 6 in of each motor plug kept as a pigtail), part AMP-KIT-RING, and the splice at each jamb switch | same |
| Added | 16 wires, 2 feed splices + 2 control splices + 4 motor-end splices (to the kit's motor-plug pigtails), 4 pull-down resistors (list in options.yaml) | 10 wires (+1 per door), 1 feed splice + 4 motor-end splices, 2 pull-downs (DIN1, Power Control; +1 per door), 2 floor clamps, 1 script |
| Parts cost (list, 2026-09-29) | 2 × $180.00 | $350.00 |

**Capacity verdict** (ledger on main):
- **Way 1** puts no load on the PDM30 or the PDM15. On the bay PDM32 (estimate, §5) it takes 4 of the 24 8 A outputs:
  - 8 A outputs go 18–20 → 22–24 of 24, counting the wheel-speed candidate. With the two-output feeds, 24–26.
  - 20 A outputs stay 8 of 8.
  - **It depends on the bay-PDM decision.**
- Way 2 takes the PDM30 to 20 A 7/8 (8/8 per door) and 8 A 22/22. The PDM30 then has no output left for PW or PL.
- Both remove one branch from the distribution stud and one return from the ground star. The AMP harness no longer lands
  on the batteries.

## 11. Recommendation

**Way 1, `STEP-DCMD`**, for four reasons:
- The MoTeC PDM stays the only brain. The DCMD has no software and just follows its two inputs.
- Nothing crosses the firewall or the floor: the motor leads run where AMP's own harness runs.
- It uses the bay PDM32's 8 A outputs (22–24 of 24 with it, estimate), not the PDM30's last outputs that PW and PL need.
  **It depends on the bay-PDM decision** (state 0ah).
- It is an engine-bay motorsport part (−40 to +85 °C, Deutsch connectors) at 2 × $180.

**It is gated on one bench session:**
- The motor's running and stall currents. Each DCMD channel is rated 8 A continuous. Running current also sets the feed:
  ≤ 4 A per motor on one 8 A output, ≤ 8 A on two paralleled, and the lead gauge (§7). **The Haltech pick is provisional
  until then.**
- Whether a DCMD input with a pull-down follows a PDM-style output.

**Take Way 2 if** the motor runs above 8 A, or the DCMD won't follow a pulled-down input, or the owner wants the pinch force
current-limited. Way 2 carries up to 6.8 A per motor through its 12 AWG feed, and 15 A per channel through the controller.
The Roboteq limits current and stops each motor itself, at the cost of PDM30 outputs, two floor exits and a script.

**Questions only Skylar can answer:**
1. One door drops both steps (FFS's behaviour), or each door drops its own step (AMP's stock behaviour)? Per-door costs
   no extra output in Way 1 (a feed per bridge already), and OUT4 on the PDM30 in Way 2.
2. The road speed above which the steps must stay stowed.
3. A dash switch that holds the steps stowed (STEP-SW, PDM30 DIG16, or a CANKEY button): yes or no?
4. The label on the FFS/AMP carton or motor (kit part number; Siemens or Brose housing), or a photo of a motor and its plug.
5. The bench session above: who and when (the kit has to come out of the box).
6. Buying: 2 × Haltech HT-038009 (Way 1) or 1 × Roboteq SDC2160 (Way 2). Nothing has been ordered.

**Drafts (not sent; for Skylar):**
- *To Haltech tech support:* "Using the HT-038009 DCMD as a plain H-bridge driven by high-side (12 V / floating) outputs
  from a MoTeC PDM, with a pull-down on each control input: what is the control input's internal pull-up (value and
  voltage), its low/high thresholds, is 12–14 V on the input within rating, and what is the case's sealing (IP) rating? Is
  the 'limited automatic overcurrent protection' threshold published?"
- *To AMP Research tech support (1-888-983-2204, IM75146 p.1):* "For the PowerStep motor in a Far From Stock 73-87 K5 kit
  (AMP part number to follow from the carton): what are the motor's running and stall currents at 12 V, the motor
  connector's housing part number, and the current threshold the controller uses to stop at end of travel?"
- *To Dave:* "No relays is locked, so the AMP steps' reversing has to be solid-state. Proposal: the bay PDM (the sealed
  PDM32 candidate) drives two Haltech DCMD bridges. Each bridge gets its own 8 A output for power, plus two shared 8 A
  direction outputs with pull-downs. End of travel on each feed's current plus a 5 s window; door and speed over CAN. The alternative is a Roboteq SDC2160 in the cab on PDM30 outputs. Any
  objection, or a bridge you'd rather use?"
