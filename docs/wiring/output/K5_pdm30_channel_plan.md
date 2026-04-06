# PDM30 Authoritative Channel Plan — 1977 Chevrolet K5 Blazer

**Date:** 2026-04-05
**Status:** AUTHORITATIVE — All other documents (cut list, connector schedule, database) must match this.
**Reconciled from:** K5_cut_list.txt, K5_connector_schedule.txt, 05-build-manifest.md, component_connectors DB table

---

## Design Decisions

1. **Cut list grouping strategy adopted** — the cut list groups related lights that share a switch input onto single channels. This matches the build manifest Chapter 5 PDM Channel Grouping table and is the correct electrical design.
2. **Connector schedule one-per-output plan rejected** — it assigned one device per output for OUT13-OUT30, which doesn't reflect the intended switch-sharing design and would require more channels than available.
3. **OUT5/OUT6 resolved** — Electric Water Pump on OUT5, Heater Blower Motor on OUT6. The water pump is engine-critical (always-on when running) and gets the lower output number. The cut list had them this way; the connector schedule had them swapped.
4. **DIG input assignments created** — the cut list and connector schedule both left DIG inputs unassigned. This plan assigns each switch to a specific DIG pin based on functional grouping.

---

## 20A Outputs (OUT1-OUT8) — Heavy Loads

Each 20A output uses dual pins on the connector for current capacity.

| Output | Pin A | Pin B | Device | Est. Amps | Gauge | Wire # | Notes |
|--------|-------|-------|--------|-----------|-------|--------|-------|
| OUT1 | A01 | A10 | Radiator Fan 1 | 18A | 12 AWG | #21 | Dual-pin required. Continuous when engine hot. |
| OUT2 | A03 | A12 | Radiator Fan 2 | 18A | 12 AWG | #22 | Dual-pin required. Staged activation via ECU CAN. |
| OUT3 | A05 | A14 | Power Window Motor Left | 15A | 12 AWG | #34 | Intermittent load. H-bridge in window switch reverses polarity. |
| OUT4 | A07 | A16 | Power Window Motor Right | 15A | 12 AWG | #35 | Intermittent load. H-bridge in window switch reverses polarity. |
| OUT5 | A09 | A17 | Electric Water Pump | 12A | 14 AWG | #25 | Continuous when engine running. Engine-critical. |
| OUT6 | B03 | B09 | Heater Blower Motor | 12A | 12 AWG | #51 | Variable speed via PDM PWM. |
| OUT7 | B05 | B11 | Electric Parking Brake | 10A | 14 AWG | #54 | Intermittent. Only draws current during apply/release. |
| OUT8 | B07 | B13 | Cigarette Lighter / 12V Outlet | 10A | 14 AWG | #72 | Constant-on with ignition. |

**20A channel utilization:** 8 of 8 used. No spare 20A channels.

---

## 8A Outputs (OUT9-OUT30) — Light/Medium Loads

| Output | Pin | Device(s) | Est. Amps | Gauge | Wire #(s) | PDM Channel Group | Notes |
|--------|-----|-----------|-----------|-------|-----------|-------------------|-------|
| OUT9 | A02 | AMP Research Step Left | 8A | 14 AWG | #1 | — | Triggered by door switch. |
| OUT10 | A04 | AMP Research Step Right | 8A | 14 AWG | #2 | — | Triggered by door switch. |
| OUT11 | A06 | AMP Research Controller | 2A | 14 AWG | #3 | — | Always-on with ignition. Controls step timing. |
| OUT12 | A08 | Windshield Wiper Motor | 6A | 14 AWG | #49 | — | Intermittent. PDM handles park pulse. |
| OUT13 | A11 | Tail Light L + Tail Light R + Parking Light LF + Parking Light RF | 1.6A | 18 AWG | #81, #75, #83, #84 | `park_tail` | All on headlight switch position 1. 4 LED fixtures. |
| OUT14 | A13 | Horn | 5A | 14 AWG | #48 | — | Momentary. Horn button to DIG input. |
| OUT15 | A15 | Backup Light L + Backup Light R + Third Brake Light + Backup Camera | 3.5A | 18 AWG | #89, #76, #93, #97 | `backup` | All reverse-triggered. Camera gets power with reverse lights. |
| OUT16 | A18 | A/C Compressor Clutch | 4A | 18 AWG | #23 | — | Controlled via ECU CAN request + high/low pressure switch safety. |
| OUT17 | A20 | LED Headlight Left | 3.6A | 16 AWG | #85 | — | Independent left/right for future DRL or adaptive logic. |
| OUT18 | A22 | LED Headlight Right | 3.6A | 16 AWG | #86 | — | Independent left/right for future DRL or adaptive logic. |
| OUT19 | A24 | Markers + Clearance + License (8 fixtures) | 1.3A | 18 AWG | #77, #78, #79, #87, #88, #90, #91, #92 | `markers_clearance` | All on headlight switch position 1. Side markers (4) + cab clearance (3) + license plate (1). |
| OUT20 | A25 | Radio / Head Unit | 3A | 18 AWG | #31 | — | Ignition-switched. ACC wire from PDM. |
| OUT21 | B01 | Power Lock Actuator Left | 3A | 18 AWG | #38 | — | Momentary pulse. Lock switch triggers DIG input. |
| OUT22 | B02 | Power Lock Actuator Right | 3A | 18 AWG | #47 | — | Fires simultaneously with OUT21. |
| OUT23 | B04 | Transmission Controller | 3A | 20 AWG | #58 | — | Constant-on with ignition. CAN-connected. |
| OUT24 | B06 | Wideband Lambda Controller | 3A | 20 AWG | #64 | — | Constant-on with ignition. Feeds O2 data to ECU. |
| OUT25 | B08 | Interior Courtesy Lights (5 fixtures) | 2.5A | 20 AWG | #67, #68, #69, #73, #74 | `interior_courtesy` | Door-triggered. Dome + under-dash + footwell + underhood + cargo/bed. |
| OUT26 | B10 | Washer Pump | 2A | 18 AWG | #50 | — | Momentary. Wiper stalk triggers DIG input. |
| OUT27 | B12 | Turn Signal Left Front | 2A | 18 AWG | #80 | `turn_brake_left` | PDM handles flash timing via CAN from turn signal DIG input. |
| OUT28 | B14 | Turn Signal Right Front | 2A | 18 AWG | #82 | `turn_brake_right` | PDM handles flash timing via CAN from turn signal DIG input. |
| OUT29 | B16 | Display / Dash (Motec C125) | 1A | 22 AWG | #65 | — | Ignition-switched. CAN-connected display. |
| OUT30 | B19 | USB Charging Port | 1A | 18 AWG | #70 | — | Constant-on with ignition. |

**8A channel utilization:** 22 of 22 used. No spare 8A channels.
**Total channels used:** 30 of 30.

---

## Aggregate Current Verification

Channels with multiple devices sharing a single output:

| Output | Group | Devices | Individual Amps | Aggregate | Rating | Margin |
|--------|-------|---------|----------------|-----------|--------|--------|
| OUT13 | `park_tail` | Tail L (0.5) + Tail R (0.5) + Park LF (0.3) + Park RF (0.3) | 0.5+0.5+0.3+0.3 | **1.6A** | 8A | 6.4A |
| OUT15 | `backup` | Backup L (1.0) + Backup R (1.0) + 3rd Brake (0.5) + Camera (0.5) | 1.0+1.0+0.5+0.5 | **3.0A** | 8A | 5.0A |
| OUT19 | `markers_clearance` | 4x side marker (0.15) + 3x cab clearance (0.15) + license (0.2) | 7x0.15+0.2 | **1.25A** | 8A | 6.75A |
| OUT25 | `interior_courtesy` | Dome (0.3) + Under-dash (0.3) + Footwell (0.3) + Underhood (0.5) + Cargo (0.5) | 3x0.3+2x0.5 | **1.9A** | 8A | 6.1A |

All grouped channels have comfortable margins. Even with incandescent equivalents (3-4x LED current), all remain under 8A.

---

## Digital Input Assignments (DIG1-DIG16)

The PDM30 has 16 digital inputs (switch-to-ground). Each switch connects between a DIG pin and GND_0V (A28 or B22). 10k pullup to VBATT is internal.

| DIG | Pin | Switch / Signal | Triggers Output(s) | Logic | Notes |
|-----|-----|----------------|--------------------|----|-------|
| DIG1 | A27 | Ignition Switch (RUN) | OUT5,6,8,11,20,23,24,29,30 | Latched ON | Master ignition. All "ignition-switched" outputs. |
| DIG2 | A19 | Headlight Switch (Park) | OUT13, OUT19 | Latched ON | Position 1: tail + parking + markers + clearance + license. |
| DIG3 | A29 | Headlight Switch (Head) | OUT17, OUT18 | Latched ON | Position 2: headlights. Park lights also on (DIG2 wired in series). |
| DIG4 | A21 | Turn Signal Left | OUT27 | Flash pattern | PDM generates flash timing. Also flashes left tail via CAN. |
| DIG5 | A30 | Turn Signal Right | OUT28 | Flash pattern | PDM generates flash timing. Also flashes right tail via CAN. |
| DIG6 | A31 | Horn Button | OUT14 | Momentary ON | Active while pressed. |
| DIG7 | A23 | Wiper Switch (Low) | OUT12 | Latched ON | Low speed wiper. PDM handles park pulse on OFF transition. |
| DIG8 | A32 | Wiper Switch (High) | OUT12 | Latched ON | High speed wiper (PDM adjusts duty or separate speed pin). |
| DIG9 | A33 | Washer Switch | OUT26 | Momentary ON | Washer pump runs while held. May also trigger wipers (DIG7). |
| DIG10 | A34 | Lock Switch (Lock) | OUT21, OUT22 | Momentary pulse | PDM sends timed pulse to both lock actuators. |
| DIG11 | B20 | Lock Switch (Unlock) | OUT21, OUT22 | Momentary pulse | PDM sends timed pulse (reverse polarity or separate unlock wire). |
| DIG12 | B21 | Door Switch Left | OUT9, OUT25 | Latched ON | Triggers AMP step deploy + interior courtesy lights. |
| DIG13 | B15 | Door Switch Right | OUT10, OUT25 | Latched ON | Triggers AMP step deploy + interior courtesy lights. |
| DIG14 | B23 | Brake Light Switch | — | CAN passthrough | PDM reads brake input and sends CAN message. Brake lights handled via turn signal outputs or dedicated logic. |
| DIG15 | B17 | Reverse Light Switch | OUT15 | Latched ON | Activates backup lights + camera + third brake light group. |
| DIG16 | B24 | Hazard Switch | OUT27, OUT28 | Flash pattern | Both turn signals flash simultaneously. Overrides DIG4/DIG5. |

**DIG utilization:** 16 of 16 used. No spare DIG inputs.

---

## Devices NOT on PDM30 (Direct-Wired)

These devices exceed PDM30 channel ratings or are power infrastructure. Documented here for completeness.

| Device | Why Not PDM | Connection | Wire # |
|--------|-----------|-----------|--------|
| Alternator (220A) | IS the power source | Direct to battery + sense wire | #59 |
| Starter Motor (200A peak) | Exceeds any PDM channel | Direct battery + relay trigger | #6 |
| Battery Disconnect (190A) | IS the master switch | Inline with battery cable | #63 |
| Fuel Pump (35A) | Exceeds 20A PDM max | Dedicated relay (Aeromotive 16301) | #66 |
| Bosch iBooster Brake (40A peak) | Exceeds 20A PDM max | Dedicated relay, integrated ECU | #52 |
| Amplifier (30A) | Exceeds 20A PDM max | Direct fused battery wire | #32 |
| All ECU Sensors | Powered from ECU 5V ref | M130 connector pins | Various |
| Injectors + Coils | ECU low-side drive | Individual control from M130 pins | #5-#20, #24 |
| Dakota Digital Gauge | Powers from IGN circuit | PDM ignition-switched rail (not a channel) | #71 |

---

## PDM30 Devices Referenced But Not Channel-Assigned

These wires in the cut list show "PDM30" in the FROM column without a specific output. They are relay control wires, indicator signals, or power rail taps — not PDM output channels.

| Wire # | Device | Connection Type | Notes |
|--------|--------|----------------|-------|
| #55 | Transfer Case Indicator | PDM DIG input or CAN | 4WD indicator lamp logic |
| #56 | Neutral Safety Switch | PDM DIG input or CAN | Starter interlock |
| #57 | Reverse Light Switch | DIG15 input | Triggers OUT15 (backup group) |
| #71 | Dakota Digital Gauge | PDM ignition rail tap | Not a switched output |
| #94 | Fuel Pump Relay | PDM relay control | Local relay near PDM |
| #95 | Bosch iBooster Relay | PDM relay control | Local relay near PDM |

---

## Physical Pin Map Summary

### Connector A (34 pins)

| Pin | Designation | Device |
|-----|------------|--------|
| A01 | OUT1_A | Radiator Fan 1 |
| A02 | OUT9 | AMP Research Step Left |
| A03 | OUT2_A | Radiator Fan 2 |
| A04 | OUT10 | AMP Research Step Right |
| A05 | OUT3_A | Power Window Motor Left |
| A06 | OUT11 | AMP Research Controller |
| A07 | OUT4_A | Power Window Motor Right |
| A08 | OUT12 | Windshield Wiper Motor |
| A09 | OUT5_A | Electric Water Pump |
| A10 | OUT1_B | Radiator Fan 1 (parallel) |
| A11 | OUT13 | park_tail group |
| A12 | OUT2_B | Radiator Fan 2 (parallel) |
| A13 | OUT14 | Horn |
| A14 | OUT3_B | Power Window Motor Left (parallel) |
| A15 | OUT15 | backup group |
| A16 | OUT4_B | Power Window Motor Right (parallel) |
| A17 | OUT5_B | Electric Water Pump (parallel) |
| A18 | OUT16 | A/C Compressor Clutch |
| A19 | DIG2 | Headlight Switch (Park) |
| A20 | OUT17 | LED Headlight Left |
| A21 | DIG4 | Turn Signal Left |
| A22 | OUT18 | LED Headlight Right |
| A23 | DIG7 | Wiper Switch (Low) |
| A24 | OUT19 | markers_clearance group |
| A25 | OUT20 | Radio / Head Unit |
| A26 | VBATT_NEG_A | Battery Negative A |
| A27 | DIG1 | Ignition Switch (RUN) |
| A28 | GND_0V_A | Signal Ground A |
| A29 | DIG3 | Headlight Switch (Head) |
| A30 | DIG5 | Turn Signal Right |
| A31 | DIG6 | Horn Button |
| A32 | DIG8 | Wiper Switch (High) |
| A33 | DIG9 | Washer Switch |
| A34 | DIG10 | Lock Switch (Lock) |

### Connector B (26 pins)

| Pin | Designation | Device |
|-----|------------|--------|
| B01 | OUT21 | Power Lock Actuator Left |
| B02 | OUT22 | Power Lock Actuator Right |
| B03 | OUT6_A | Heater Blower Motor |
| B04 | OUT23 | Transmission Controller |
| B05 | OUT7_A | Electric Parking Brake |
| B06 | OUT24 | Wideband Lambda Controller |
| B07 | OUT8_A | Cigarette Lighter / 12V Outlet |
| B08 | OUT25 | interior_courtesy group |
| B09 | OUT6_B | Heater Blower Motor (parallel) |
| B10 | OUT26 | Washer Pump |
| B11 | OUT7_B | Electric Parking Brake (parallel) |
| B12 | OUT27 | Turn Signal Left Front |
| B13 | OUT8_B | Cigarette Lighter (parallel) |
| B14 | OUT28 | Turn Signal Right Front |
| B15 | DIG13 | Door Switch Right |
| B16 | OUT29 | Display / Dash (Motec C125) |
| B17 | DIG15 | Reverse Light Switch |
| B18 | VBATT_NEG_B | Battery Negative B |
| B19 | OUT30 | USB Charging Port |
| B20 | DIG11 | Lock Switch (Unlock) |
| B21 | DIG12 | Door Switch Left |
| B22 | GND_0V_B | Signal Ground B |
| B23 | DIG14 | Brake Light Switch |
| B24 | DIG16 | Hazard Switch |
| B25 | CAN_LO | CAN Bus Low |
| B26 | CAN_HI | CAN Bus High |

### Connector C (1 pin)

| Pin | Designation | Device |
|-----|------------|--------|
| C01 | VBATT_POS | Battery Positive (6 AWG, M6 stud) |

---

## Changes From Previous Documents

### vs. Cut List
- **OUT5/OUT6:** Cut list had Water Pump on OUT5 and Blower on OUT6. **Kept as-is** — this is correct.
- **All other outputs:** Cut list assignments adopted as authoritative.
- **DIG inputs:** Cut list had no DIG assignments. All 16 now assigned above.

### vs. Connector Schedule / Database
- **OUT1-OUT4, OUT9-OUT12:** No change. Already matched.
- **OUT5:** Was Heater Blower Motor. **Changed to Electric Water Pump.**
- **OUT6:** Was Electric Water Pump. **Changed to Heater Blower Motor.**
- **OUT13:** Was Horn (single device). **Changed to park_tail group** (4 fixtures, 1.6A).
- **OUT14:** Was A/C Compressor Clutch. **Changed to Horn** (5A).
- **OUT15:** Was LED Headlight Left. **Changed to backup group** (4 devices, 3.0A).
- **OUT16:** Was LED Headlight Right. **Changed to A/C Compressor Clutch** (4A).
- **OUT17:** Was Power Lock Actuator Left. **Changed to LED Headlight Left** (3.6A).
- **OUT18:** Was Radio/Head Unit. **Changed to LED Headlight Right** (3.6A).
- **OUT19:** Was Power Lock Actuator Right. **Changed to markers_clearance group** (8 fixtures, 1.25A).
- **OUT20:** Was Transmission Controller. **Changed to Radio / Head Unit** (3A).
- **OUT21:** Was Wideband Lambda Controller. **Changed to Power Lock Actuator Left** (3A).
- **OUT22:** Was Tail Light Right. **Changed to Power Lock Actuator Right** (3A).
- **OUT23:** Was Tail Light Left. **Changed to Transmission Controller** (3A).
- **OUT24:** Was Turn Signal Left Front. **Changed to Wideband Lambda Controller** (3A).
- **OUT25:** Was Turn Signal Right Front. **Changed to interior_courtesy group** (5 fixtures, 1.9A).
- **OUT26:** No change. Washer Pump in both.
- **OUT27:** Was Backup Light Right. **Changed to Turn Signal Left Front** (2A).
- **OUT28:** Was Backup Light Left. **Changed to Turn Signal Right Front** (2A).
- **OUT29:** Was USB Charging Port. **Changed to Display / Dash** (1A).
- **OUT30:** Was Parking Light Left Front. **Changed to USB Charging Port** (1A).

---

*This document is the single source of truth for PDM30 channel assignments. The cut list, connector schedule, build sheets, and database must all be updated to match.*
