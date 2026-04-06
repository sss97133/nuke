# HARNESS BUILD SHEETS — 1977 Chevrolet K5 Blazer

**ECU:** Motec M130 | **PDM:** Motec PDM30 | **Engine:** Delmo Speed LS3 6.2L
**Generated:** 2026-04-04 | **Source:** K5_cut_list.txt (113 wires, 830 ft)

All lengths are ESTIMATED. Measure every run on the truck before cutting.
Add 10% service loop to every measured length.

---

## TABLE OF CONTENTS

1. [Engine Loom](#1-engine-loom)
2. [Dash Loom](#2-dash-loom)
3. [Front Lighting Loom](#3-front-lighting-loom)
4. [Rear Loom](#4-rear-loom)
5. [Chassis / Underbody Loom](#5-chassis--underbody-loom)
6. [Audio Loom](#6-audio-loom)
7. [CAN Backbone](#7-can-backbone)
8. [Power Distribution](#8-power-distribution)
9. [Miscellaneous / Standalone Runs](#9-miscellaneous--standalone-runs)
10. [Build Sequence](#10-build-sequence)
11. [Wire Diameter Reference](#11-wire-diameter-reference)

---

## 1. ENGINE LOOM

**Wire count:** 28 | **Total wire length:** 128.8 ft (est.)
**Route:** M130 Connectors A+B (firewall, driver side) -> through firewall grommet -> along top of engine (intake manifold valley) -> branches to valve covers, front, rear, block, intake top

### 1.1 Trunk Section (Firewall to Intake Manifold)

All 28 wires pass through the firewall as one trunk.

| # | Label | Pin | Gauge | Color | Length | Branch |
|---|-------|-----|-------|-------|--------|--------|
| 24 | Ignition Coil 1 | M130:A13 | 20 AWG | WHT/ORG | 4.6ft | B1-Driver VC |
| 5 | Ignition Coil 3 | M130:A03 | 20 AWG | WHT | 4.6ft | B1-Driver VC |
| 7 | Ignition Coil 5 | M130:A04 | 20 AWG | WHT/WHT | 4.6ft | B1-Driver VC |
| 8 | Ignition Coil 7 | M130:A05 | 20 AWG | WHT/BLK | 4.6ft | B1-Driver VC |
| 9 | Ignition Coil 2 | M130:A06 | 20 AWG | WHT/RED | 4.6ft | B2-Pass VC |
| 10 | Ignition Coil 4 | M130:A07 | 20 AWG | WHT/BLU | 4.6ft | B2-Pass VC |
| 11 | Ignition Coil 6 | M130:A08 | 20 AWG | WHT/YEL | 4.6ft | B2-Pass VC |
| 12 | Ignition Coil 8 | M130:A12 | 20 AWG | WHT/VIO | 4.6ft | B2-Pass VC |
| 13 | Fuel Injector 1 | M130:A19 | 18 AWG | GRN | 4.6ft | B1-Driver VC |
| 15 | Fuel Injector 3 | M130:A21 | 18 AWG | GRN/BLK | 4.6ft | B1-Driver VC |
| 17 | Fuel Injector 5 | M130:A27 | 18 AWG | GRN/BLU | 4.6ft | B1-Driver VC |
| 19 | Fuel Injector 7 | M130:A29 | 18 AWG | GRN/VIO | 4.6ft | B1-Driver VC |
| 14 | Fuel Injector 2 | M130:A20 | 18 AWG | GRN/WHT | 4.6ft | B2-Pass VC |
| 16 | Fuel Injector 4 | M130:A22 | 18 AWG | GRN/RED | 4.6ft | B2-Pass VC |
| 18 | Fuel Injector 6 | M130:A28 | 18 AWG | GRN/YEL | 4.6ft | B2-Pass VC |
| 20 | Fuel Injector 8 | M130:A30 | 18 AWG | GRN/ORG | 4.6ft | B2-Pass VC |
| 4 | Electronic Throttle Body | ECU | 18 AWG | ORG | 4.6ft | B6-Intake Top |
| 108 | MAP Sensor | M130:A15 | 22 AWG | VIO/WHT | 4.6ft | B6-Intake Top |
| 109 | Intake Air Temp Sensor | M130:B03 | 22 AWG | TAN | 4.6ft | B6-Intake Top |
| 112 | Fuel Pressure Sensor | M130:A16 | 22 AWG | VIO/BLK | 4.6ft | B6-Intake Top |
| 110 | Coolant Temp Sensor (ECU) | M130:B04 | 22 AWG | TAN/WHT | 4.6ft | B3-Front |
| 102 | Oil Pressure Sensor (ECU) | M130:A14 | 22 AWG | VIO | 4.6ft | B5-Block |
| 113 | Oil Temperature Sensor | M130:B05 | 22 AWG | TAN/BLK | 4.6ft | B5-Block |
| 99 | Crank Position Sensor | M130:B01 | 22 AWG SHLD | BLU/WHT/WHT | 4.6ft | B4-Rear |
| 101 | Cam Position Sensor | M130:B02 | 22 AWG SHLD | BLU/WHT/BLK | 4.6ft | B3-Front |
| 103 | Knock Sensor Bank 1 | M130:B07 | 22 AWG SHLD | GRY | 4.6ft | B5-Block |
| 104 | Knock Sensor Bank 2 | M130:B13 | 22 AWG SHLD | GRY/WHT | 4.6ft | B5-Block |
| 97 | Rear Backup Camera | PDM30:OUT15 | 20 AWG | BLU/WHT | 18.4ft | REMOVE* |

*Wire #97 (Rear Backup Camera) is listed in the engine section of the cut list but belongs in the Rear Loom. Reassigned to Loom 4 (Rear). Actual engine loom wire count: **27 wires**.

### 1.2 Branch Breakdown

**Branch Point:** Where the main trunk reaches the center of the intake manifold valley, approximately 18" after the firewall penetration.

#### Branch 1 — Driver Valve Cover (8 wires)
Coils 1, 3, 5, 7 + Injectors 1, 3, 5, 7. Runs along driver (left) valve cover.

| # | Label | Gauge | Color | Sub-branch |
|---|-------|-------|-------|------------|
| 24 | Coil 1 (Cyl 1 front) | 20 AWG | WHT/ORG | VC-D front |
| 5 | Coil 3 (Cyl 3) | 20 AWG | WHT | VC-D mid-front |
| 7 | Coil 5 (Cyl 5) | 20 AWG | WHT/WHT | VC-D mid-rear |
| 8 | Coil 7 (Cyl 7 rear) | 20 AWG | WHT/BLK | VC-D rear |
| 13 | Injector 1 (Cyl 1 front) | 18 AWG | GRN | VC-D front |
| 15 | Injector 3 (Cyl 3) | 18 AWG | GRN/BLK | VC-D mid-front |
| 17 | Injector 5 (Cyl 5) | 18 AWG | GRN/BLU | VC-D mid-rear |
| 19 | Injector 7 (Cyl 7 rear) | 18 AWG | GRN/VIO | VC-D rear |

**Wire count at branch entry:** 8
**Bundle diameter:** ~0.37" (4x 20AWG + 4x 18AWG)
**Protection:** Raychem DR-25 heat shrink over the branch trunk, harness tape (Tesa 51036) wrapping individual drops
**Build note:** Each cylinder gets 1 coil wire + 1 injector wire dropping off the branch. Build as a ladder — main rail along the valve cover with paired drops at each coil pack. 6" pigtail at each coil/injector for service access.

#### Branch 2 — Passenger Valve Cover (8 wires)
Coils 2, 4, 6, 8 + Injectors 2, 4, 6, 8. Runs along passenger (right) valve cover.

| # | Label | Gauge | Color | Sub-branch |
|---|-------|-------|-------|------------|
| 9 | Coil 2 (Cyl 2 front) | 20 AWG | WHT/RED | VC-P front |
| 10 | Coil 4 (Cyl 4) | 20 AWG | WHT/BLU | VC-P mid-front |
| 11 | Coil 6 (Cyl 6) | 20 AWG | WHT/YEL | VC-P mid-rear |
| 12 | Coil 8 (Cyl 8 rear) | 20 AWG | WHT/VIO | VC-P rear |
| 14 | Injector 2 (Cyl 2 front) | 18 AWG | GRN/WHT | VC-P front |
| 16 | Injector 4 (Cyl 4) | 18 AWG | GRN/RED | VC-P mid-front |
| 18 | Injector 6 (Cyl 6) | 18 AWG | GRN/YEL | VC-P mid-rear |
| 20 | Injector 8 (Cyl 8 rear) | 18 AWG | GRN/ORG | VC-P rear |

**Wire count at branch entry:** 8
**Bundle diameter:** ~0.37" (identical to Branch 1)
**Protection:** DR-25 heat shrink over branch trunk, harness tape individual drops
**Build note:** Mirror image of Branch 1. Same ladder construction.

#### Branch 3 — Front of Engine (2 wires)
Cam position sensor + coolant temperature sensor. Both on front (timing cover area).

| # | Label | Gauge | Color | Notes |
|---|-------|-------|-------|-------|
| 101 | Cam Position Sensor | 22 AWG SHLD | BLU/WHT/BLK | SHIELDED. Ground shield drain at M130 end only. |
| 110 | Coolant Temp Sensor | 22 AWG | TAN/WHT | Route away from exhaust manifold. |

**Wire count:** 2
**Bundle diameter:** ~0.18" (shielded cable is ~0.15" OD)
**Protection:** Split loom (1/4") where exposed to heat; harness tape elsewhere
**Build note:** Keep CMP shielded cable separate from power wires. Drain wire connects to sensor ground at M130 B15/B16 — do NOT ground at the sensor end.

#### Branch 4 — Rear of Engine (1 wire)
Crank position sensor only. Routes to rear of block (behind intake, above bellhousing).

| # | Label | Gauge | Color | Notes |
|---|-------|-------|-------|-------|
| 99 | Crank Position Sensor | 22 AWG SHLD | BLU/WHT/WHT | SHIELDED. Ground shield drain at M130 end only. |

**Wire count:** 1
**Bundle diameter:** ~0.15" (single shielded cable)
**Protection:** DR-25 heat shrink, route away from starter motor EMI
**Build note:** This is the most EMI-sensitive wire in the loom. Route at least 2" from ignition coil wires, starter cable, and alternator output. Shield drain to M130 sensor ground only.

#### Branch 5 — Block Sensors (4 wires)
Knock sensors (x2), oil pressure, oil temperature. All mount to the engine block between the exhaust manifolds.

| # | Label | Gauge | Color | Notes |
|---|-------|-------|-------|-------|
| 103 | Knock Sensor Bank 1 | 22 AWG SHLD | GRY | SHIELDED. Driver side, below exhaust manifold. |
| 104 | Knock Sensor Bank 2 | 22 AWG SHLD | GRY/WHT | SHIELDED. Passenger side, below exhaust manifold. |
| 102 | Oil Pressure Sensor | 22 AWG | VIO | Block, rear driver side. |
| 113 | Oil Temperature Sensor | 22 AWG | TAN/BLK | Oil pan or block boss. |

**Wire count:** 4 (2 shielded + 2 unshielded)
**Bundle diameter:** ~0.32" at branch point
**Protection:** High-temp split loom (3/8") rated to 300F minimum — these run near exhaust
**Build note:** Knock sensor cables are shielded. Route them together but separate from ignition wires. Shield drains to M130 sensor ground. KS1 drops off to driver side, KS2 to passenger side. Oil pressure and oil temp break off individually to their block bosses.

#### Branch 6 — Top of Intake (4 wires)
MAP sensor, IAT sensor, electronic throttle body, fuel pressure sensor. All mount on or near the intake manifold top.

| # | Label | Gauge | Color | Notes |
|---|-------|-------|-------|-------|
| 4 | Electronic Throttle Body | 18 AWG | ORG | 6-pin connector (motor + TPS signals). Actually needs 6 wires to ETB connector. |
| 108 | MAP Sensor | 22 AWG | VIO/WHT | Bosch 3-pin, rear of intake manifold. |
| 109 | Intake Air Temp Sensor | 22 AWG | TAN | In intake runner or MAF housing. |
| 112 | Fuel Pressure Sensor | 22 AWG | VIO/BLK | On fuel rail, driver side. |

**Wire count:** 4 (note: ETB needs multi-conductor — see build note)
**Bundle diameter:** ~0.23"
**Protection:** Harness tape (Tesa 51036), no split loom needed (low heat area on top of intake)
**Build note:** The ETB connector is 6-pin (2x motor + 2x TPS1 + 2x TPS2) but the cut list shows it as one circuit. This needs 6 individual wires from M130 to the ETB. Verify M130 pin assignments for ETB motor drive (typically auxiliary outputs) and TPS signals (analog inputs). The single cut-list entry may represent the power feed only — cross-reference with M130 pinout.

### 1.3 Trunk Wire Count Progression

| Section | Location | Wire Count | Est. Diameter |
|---------|----------|------------|---------------|
| T1 | M130 connectors (firewall) | 27 | ~0.72" |
| T2 | After firewall grommet | 27 | ~0.72" |
| T3 | Center of intake valley (main branch point) | 27 | ~0.72" |
| After B1 | Driver valve cover breaks off | 19 | ~0.55" |
| After B2 | Passenger valve cover breaks off | 11 | ~0.40" |
| After B6 | Intake top breaks off | 7 | ~0.30" |
| After B5 | Block sensors break off | 3 | ~0.20" |
| After B3 | Front engine breaks off | 1 | ~0.15" |
| B4 | Rear engine (crank sensor) | 1 | ~0.15" |

### 1.4 Shielded Cable Routing Summary

These four cables MUST be routed separately from power wires (coil drives, injector drives):

| Cable | From | To | Shield Drain |
|-------|------|----|-------------|
| CKP (Crank) | M130:B01 | Rear of block | M130 B15 (SEN_0V_A) |
| CMP (Cam) | M130:B02 | Front timing cover | M130 B15 (SEN_0V_A) |
| KS1 (Knock 1) | M130:B07 | Driver block | M130 B16 (SEN_0V_B) |
| KS2 (Knock 2) | M130:B13 | Passenger block | M130 B16 (SEN_0V_B) |

**Rule:** Shield drain wire connects at the M130 end ONLY. Do NOT ground the shield at the sensor end. This prevents ground loops that cause false knock readings.

### 1.5 Engine Loom Build Order

1. **Lay out the main trunk** — all 27 wires at full length on harness board
2. **Build Branch 1 (Driver VC)** as a sub-harness first, taping coil/injector pairs at each cylinder
3. **Build Branch 2 (Passenger VC)** as a sub-harness, mirror of Branch 1
4. **Build Branch 6 (Intake Top)** — short runs, tape together loosely
5. **Build Branch 5 (Block Sensors)** — route shielded cables on the outside of the bundle
6. **Build Branch 3 (Front Engine)** — CMP shielded + CLT
7. **Build Branch 4 (Rear Engine)** — CKP shielded, solo run
8. **Bundle trunk** with DR-25 (or spiral wrap for serviceability) from firewall to first branch point
9. **Terminate M130 A+B pins** — crimp all pins, insert into Superseal housings
10. **Terminate sensor-side connectors** — pigtails or crimp-on terminals
11. **Continuity test** every wire end-to-end before installing on engine
12. **Label both ends** of every wire with permanent heat-shrink labels

---

## 2. DASH LOOM

**Wire count:** 18 | **Total wire length:** 94.7 ft (est.)
**Route:** PDM30 (mounted under dash, driver side) -> along I/P harness channel -> branches to driver door, passenger door, instrument panel, interior lights, accessories

### 2.1 Wire Inventory

| # | Label | Pin | Gauge | Color | Length | Branch |
|---|-------|-----|-------|-------|--------|--------|
| 34 | Power Window Motor Left | PDM30:OUT3 | 12 AWG | DK BLU | 6.9ft | B1-Driver Door |
| 38 | Power Lock Actuator Left | PDM30:OUT21 | 18 AWG | BLK | 6.9ft | B1-Driver Door |
| 42 | Door Switch Left | ECU | 18 AWG | ORG/BLK | 6.9ft | B1-Driver Door |
| 36 | Window Switch Master (Driver) | ECU | 14 AWG | ORG/YEL | 6.9ft | B1-Driver Door |
| 44 | Lock Switch | ECU | 18 AWG | ORG/BLU | 6.9ft | B1-Driver Door |
| 35 | Power Window Motor Right | PDM30:OUT4 | 12 AWG | DK BLU/WHT | 6.9ft | B2-Pass Door |
| 47 | Power Lock Actuator Right | PDM30:OUT22 | 18 AWG | BLK/WHT | 6.9ft | B2-Pass Door |
| 43 | Door Switch Right | ECU | 18 AWG | ORG/RED | 6.9ft | B2-Pass Door |
| 37 | Window Switch Passenger | ECU | 14 AWG | ORG/VIO | 6.9ft | B2-Pass Door |
| 65 | Display/Dash | PDM30:OUT29 | 22 AWG | ORG/RED | 3.5ft | B3-I/P |
| 71 | Dakota Digital Gauge Cluster | PDM30 | 18 AWG | ORG/VIO | 3.5ft | B3-I/P |
| 45 | Blower Speed Switch/Control | ECU | 14 AWG | ORG/YEL | 3.5ft | B3-I/P |
| 67 | Dome Light | PDM30:OUT25 | 20 AWG | BRN | 3.5ft | B4-Lights |
| 68 | Under-Dash LED Lights | PDM30:OUT25 | 20 AWG | BRN/WHT | 3.5ft | B4-Lights |
| 69 | Footwell Lights | PDM30:OUT25 | 20 AWG | BRN/BLK | 3.5ft | B4-Lights |
| 70 | USB Charging Port | PDM30:OUT30 | 18 AWG | ORG/YEL | 3.5ft | B5-Accessories |
| 72 | Cigarette Lighter / 12V | PDM30:OUT8 | 14 AWG | ORG/ORG | 3.5ft | B5-Accessories |
| 51 | Heater Blower Motor | PDM30:OUT6 | 12 AWG | ORG/BLK/BLU | 4.6ft | Direct Run |

### 2.2 Branch Breakdown

**Branch Point:** Behind the instrument panel, approximately 12" from PDM30. All 18 wires run as a trunk from PDM30 to this point.

#### Branch 1 — Driver Door (5 wires)
Window motor, lock actuator, door switch, window master switch, lock switch.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 34 | Power Window Motor Left | 12 AWG | DK BLU |
| 38 | Power Lock Actuator Left | 18 AWG | BLK |
| 42 | Door Switch Left | 18 AWG | ORG/BLK |
| 36 | Window Switch Master | 14 AWG | ORG/YEL |
| 44 | Lock Switch | 18 AWG | ORG/BLU |

**Wire count:** 5
**Bundle diameter:** ~0.35" (1x 12AWG + 1x 14AWG + 3x 18AWG)
**Protection:** Split loom (3/8") through door jamb, harness tape inside door
**Build note:** This branch routes through the driver door jamb. Use a rubber grommet or convoluted tubing rated for 100K+ door cycles. Leave 8" service loop inside the door for window regulator travel. The 12 AWG window motor wire carries 15A — ensure proper crimp terminals rated for that current.

#### Branch 2 — Passenger Door (4 wires)
Window motor, lock actuator, door switch, window switch.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 35 | Power Window Motor Right | 12 AWG | DK BLU/WHT |
| 47 | Power Lock Actuator Right | 18 AWG | BLK/WHT |
| 43 | Door Switch Right | 18 AWG | ORG/RED |
| 37 | Window Switch Passenger | 14 AWG | ORG/VIO |

**Wire count:** 4
**Bundle diameter:** ~0.30" (1x 12AWG + 1x 14AWG + 2x 18AWG)
**Protection:** Split loom (3/8") through door jamb, harness tape inside door
**Build note:** Route across dash behind the instrument panel. Same door jamb treatment as driver side. This branch is ~2ft longer than driver side because it crosses the full dash width.

#### Branch 3 — Instrument Panel (3 wires)
Display, Dakota Digital gauges, blower speed switch.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 65 | Display/Dash | 22 AWG | ORG/RED |
| 71 | Dakota Digital Gauge Cluster | 18 AWG | ORG/VIO |
| 45 | Blower Speed Switch/Control | 14 AWG | ORG/YEL |

**Wire count:** 3
**Bundle diameter:** ~0.20"
**Protection:** Harness tape only (protected environment behind I/P)
**Build note:** Short runs, all terminate behind the instrument cluster area. Dakota Digital VHX-73C-PU needs power + ground + signal inputs (speedometer, tachometer, oil pressure, water temp, fuel level, volts). The single wire here is likely the main power feed — additional signal wires may be needed from the CAN bridge module once built.

#### Branch 4 — Interior Lights (3 wires)
Dome light, under-dash LEDs, footwell lights. All on PDM30 OUT25 (shared output, switched).

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 67 | Dome Light | 20 AWG | BRN |
| 68 | Under-Dash LED Lights | 20 AWG | BRN/WHT |
| 69 | Footwell Lights | 20 AWG | BRN/BLK |

**Wire count:** 3
**Bundle diameter:** ~0.16" (3x 20AWG)
**Protection:** Harness tape
**Build note:** All three share PDM30 OUT25. Splice at a single junction point near the dome light, then individual runs to each fixture. Use a sealed splice (solder + adhesive heat shrink) — not Scotchloks or butt splices in the cab.

#### Branch 5 — Accessories (2 wires)
USB port and cigarette lighter/12V outlet.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 70 | USB Charging Port | 18 AWG | ORG/YEL |
| 72 | Cigarette Lighter / 12V | 14 AWG | ORG/ORG |

**Wire count:** 2
**Bundle diameter:** ~0.16"
**Protection:** Harness tape
**Build note:** Cigarette lighter carries 10A — use proper gauge crimp terminals. USB port is 1A load, no special considerations.

#### Direct Run — Heater Blower Motor (1 wire)
Runs directly from PDM30 to blower motor location behind the firewall.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 51 | Heater Blower Motor | 12 AWG | ORG/BLK/BLU |

**Wire count:** 1
**Bundle diameter:** ~0.10" (single 12AWG)
**Protection:** Split loom where it passes through firewall area
**Build note:** 12A load. This wire may need to penetrate the firewall or route through the heater box area. Check clearance. Keep separate from engine loom to avoid confusion.

### 2.3 Trunk Wire Count Progression

| Section | Location | Wire Count | Est. Diameter |
|---------|----------|------------|---------------|
| T1 | PDM30 connector | 18 | ~0.55" |
| T2 | Behind I/P (main branch point) | 18 | ~0.55" |
| After B1 | Driver door breaks off | 13 | ~0.42" |
| After B2 | Passenger door breaks off | 9 | ~0.30" |
| After B3 | I/P breaks off | 6 | ~0.22" |
| After B4 | Lights break off | 3 | ~0.16" |
| After B5 | Accessories break off | 1 | ~0.10" |

### 2.4 Dash Loom Build Order

1. **Build Branch 1 (Driver Door)** as sub-harness — tape the 5 wires together, leave 12" untaped at PDM end for trunk integration
2. **Build Branch 2 (Passenger Door)** as sub-harness — same method
3. **Build Branch 3 (I/P)** — 3 short wires, tape together
4. **Build Branch 4 (Lights)** — splice the 3 wires from OUT25, then individual runs
5. **Build Branch 5 (Accessories)** — 2 wires, tape together
6. **Run Blower Motor wire** separately
7. **Bundle trunk** — combine all branches at the PDM30 end, tape with harness tape
8. **Terminate PDM30 pins** — crimp and insert into Superseal housings
9. **Terminate load-side connectors** — door connectors, gauge plugs, light pigtails
10. **Continuity test** every wire
11. **Label both ends**

---

## 3. FRONT LIGHTING LOOM

**Wire count:** 11 | **Total wire length:** ~52 ft (est.)
**Route:** PDM30 -> through firewall -> forward along fender wells to headlights, turn signals, parking lights, markers, horn, wiper, washer

These wires are listed in the Exterior/Body and Chassis sections of the cut list. They serve front-of-vehicle components and should be built as their own loom for clean installation.

### 3.1 Wire Inventory

| # | Label | Pin | Gauge | Color | Length | Branch |
|---|-------|-----|-------|-------|--------|--------|
| 85 | LED Headlight Left | PDM30:OUT17 | 16 AWG | LT GRN | 4.6ft | B1-Driver |
| 80 | Turn Signal Left Front | PDM30:OUT27 | 18 AWG | LT BLU | 4.6ft | B1-Driver |
| 83 | Parking Light Left Front | PDM30:OUT13 | 18 AWG | BRN/RED | 4.6ft | B1-Driver |
| 87 | Side Marker Front Left | PDM30:OUT19 | 18 AWG | BRN/YEL | 4.6ft | B1-Driver |
| 86 | LED Headlight Right | PDM30:OUT18 | 16 AWG | LT GRN/WHT | 4.6ft | B2-Passenger |
| 82 | Turn Signal Right Front | PDM30:OUT28 | 18 AWG | DK BLU | 4.6ft | B2-Passenger |
| 84 | Parking Light Right Front | PDM30:OUT13 | 18 AWG | BRN/BLU | 4.6ft | B2-Passenger |
| 88 | Side Marker Front Right | PDM30:OUT19 | 18 AWG | BRN/VIO | 4.6ft | B2-Passenger |
| 48 | Horn | PDM30:OUT14 | 14 AWG | ORN/ORG | 4.6ft | Center |
| 49 | Windshield Wiper Motor | PDM30:OUT12 | 14 AWG | PPL | 4.6ft | Center |
| 50 | Washer Pump | PDM30:OUT26 | 18 AWG | ORN/BLK/RED | 4.6ft | Center |

### 3.2 Branch Breakdown

**Branch Point:** At the forward firewall/radiator support area where the loom splits left and right.

#### Branch 1 — Driver Side Front (4 wires)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 85 | LED Headlight Left | 16 AWG | LT GRN |
| 80 | Turn Signal Left | 18 AWG | LT BLU |
| 83 | Parking Light Left | 18 AWG | BRN/RED |
| 87 | Side Marker Front Left | 18 AWG | BRN/YEL |

**Bundle diameter:** ~0.23"
**Protection:** Split loom (3/8") — exposed to underhood heat and road spray

#### Branch 2 — Passenger Side Front (4 wires)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 86 | LED Headlight Right | 16 AWG | LT GRN/WHT |
| 82 | Turn Signal Right | 18 AWG | DK BLU |
| 84 | Parking Light Right | 18 AWG | BRN/BLU |
| 88 | Side Marker Front Right | 18 AWG | BRN/VIO |

**Bundle diameter:** ~0.23"
**Protection:** Split loom (3/8")

#### Center — Horn, Wiper, Washer (3 wires)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 48 | Horn | 14 AWG | ORN/ORG |
| 49 | Wiper Motor | 14 AWG | PPL |
| 50 | Washer Pump | 18 AWG | ORN/BLK/RED |

**Bundle diameter:** ~0.22"
**Protection:** Split loom (3/8") — wiper motor area gets wet

### 3.3 Front Lighting Loom Build Order

1. Build driver-side sub-harness (4 wires)
2. Build passenger-side sub-harness (4 wires)
3. Build center sub-harness (horn, wiper, washer — 3 wires)
4. Bundle trunk section (all 11 wires from PDM30 to branch point)
5. Terminate PDM30 pins
6. Terminate light connectors (weatherpack or Metri-Pack for each fixture)
7. Continuity test and label

---

## 4. REAR LOOM

**Wire count:** 16 + 1 reassigned = 17 | **Total wire length:** ~283 ft (est.)
**Route:** PDM30 -> under dash -> through rocker panel -> along frame rail (driver side) -> branches at rear axle area to tail lights, backup lights, third brake, markers, license plate, fuel pump, camera

This is the longest loom. Most wires are 18.4 ft estimated.

### 4.1 Wire Inventory

| # | Label | Pin | Gauge | Color | Length | Branch |
|---|-------|-----|-------|-------|--------|--------|
| 75 | Tail Light Right | PDM30:OUT13 | 18 AWG | BRN/YEL | 18.4ft | B1-Tail R |
| 81 | Tail Light Left | PDM30:OUT13 | 18 AWG | BRN/BLK | 18.4ft | B1-Tail L |
| 76 | Backup Light Right | PDM30:OUT15 | 18 AWG | BRN/VIO | 18.4ft | B2-Backup |
| 89 | Backup Light Left | PDM30:OUT15 | 18 AWG | BRN/ORG | 18.4ft | B2-Backup |
| 93 | Third Brake Light | PDM30:OUT15 | 18 AWG | BRN/RED | 18.4ft | B2-Backup |
| 97 | Rear Backup Camera | PDM30:OUT15 | 20 AWG | BLU/WHT | 18.4ft | B2-Backup |
| 77 | Side Marker Rear Left | PDM30:OUT19 | 18 AWG | BRN/ORG | 18.4ft | B3-Markers |
| 78 | Side Marker Rear Right | PDM30:OUT19 | 18 AWG | BRN | 18.4ft | B3-Markers |
| 92 | License Plate Light | PDM30:OUT19 | 18 AWG | BRN/BLK | 18.4ft | B4-License |
| 66 | Fuel Pump | ECU | 10 AWG | ORG/BLU | 18.4ft | B5-Fuel |
| 98 | Fuel Level Sender | ECU | 20 AWG | ORG/RED | 18.4ft | B5-Fuel |
| 94 | Fuel Pump Relay | PDM30 | 22 AWG | ORG | 4.6ft | Local* |
| 54 | Electric Parking Brake | PDM30:OUT7 | 14 AWG | ORG/BLK/YEL | 18.4ft | Direct Run |
| 74 | Cargo/Bed Light | PDM30:OUT25 | 20 AWG | BRN/BLU | 18.4ft | Direct Run |
| 79 | Cab Clearance Light Left | PDM30:OUT19 | 18 AWG | BRN/WHT | 3.5ft | Cab Local |
| 90 | Cab Clearance Light Center | PDM30:OUT19 | 18 AWG | BRN | 3.5ft | Cab Local |
| 91 | Cab Clearance Light Right | PDM30:OUT19 | 18 AWG | BRN/WHT | 3.5ft | Cab Local |

*Wire #94 (Fuel Pump Relay) at 4.6ft is a local relay control wire near PDM30 — may not physically be in the rear loom trunk.

**Note:** Cab clearance lights (#79, #90, #91) are short runs (3.5ft) that mount on top of the cab. These branch off near the start of the rear loom before it drops down to the frame rail.

### 4.2 Branch Breakdown

**Branch Point 1 (Cab):** At the rear of the cab, where clearance lights branch upward (3 wires).
**Branch Point 2 (Rear Axle Area):** Where the frame-rail trunk reaches the rear of the vehicle and fans out.

#### Cab Clearance Lights (3 wires — Branch at cab)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 79 | Cab Clearance Left | 18 AWG | BRN/WHT |
| 90 | Cab Clearance Center | 18 AWG | BRN |
| 91 | Cab Clearance Right | 18 AWG | BRN/WHT |

**Protection:** Harness tape inside cab, weatherpack connectors at each fixture
**Build note:** These branch off early, before the main loom drops below the cab to the frame rail.

#### Branch 1 — Tail Lights (2 wires)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 75 | Tail Light Right | 18 AWG | BRN/YEL |
| 81 | Tail Light Left | 18 AWG | BRN/BLK |

**Protection:** Split loom to weatherpack connectors at each tail light housing

#### Branch 2 — Backup / Third Brake / Camera (4 wires)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 76 | Backup Light Right | 18 AWG | BRN/VIO |
| 89 | Backup Light Left | 18 AWG | BRN/ORG |
| 93 | Third Brake Light | 18 AWG | BRN/RED |
| 97 | Rear Backup Camera | 20 AWG | BLU/WHT |

**Protection:** Split loom, camera wire may need shielding if video quality is affected by EMI

#### Branch 3 — Rear Side Markers (2 wires)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 77 | Side Marker Rear Left | 18 AWG | BRN/ORG |
| 78 | Side Marker Rear Right | 18 AWG | BRN |

**Protection:** Split loom to weatherpack connectors

#### Branch 4 — License Plate (1 wire)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 92 | License Plate Light | 18 AWG | BRN/BLK |

**Protection:** Split loom, weatherpack connector at fixture

#### Branch 5 — Fuel System (2 wires)
| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 66 | Fuel Pump | 10 AWG | ORG/BLU |
| 98 | Fuel Level Sender | 20 AWG | ORG/RED |

**Bundle diameter:** ~0.22" (10AWG + 20AWG)
**Protection:** Split loom (1/2") — fuel pump wire is 10 AWG and carries significant current
**Build note:** Fuel pump wire is 10 AWG for the Aeromotive pump. This is the heaviest wire in the rear loom. Route along the frame rail, protected from road debris. Fuel pump relay (#94) mounts near PDM30, not at the tank — its control wire is a short local run.

#### Direct Runs
| # | Label | Gauge | Color | Length | Notes |
|---|-------|-------|-------|--------|-------|
| 54 | Electric Parking Brake | 14 AWG | ORG/BLK/YEL | 18.4ft | Routes to rear axle area (E-Stopp unit) |
| 74 | Cargo/Bed Light | 20 AWG | BRN/BLU | 18.4ft | Routes to bed/cargo area |

### 4.3 Trunk Wire Count Progression

| Section | Location | Wire Count | Est. Diameter |
|---------|----------|------------|---------------|
| T1 | PDM30 exit | 17 | ~0.62" |
| After Cab | Clearance lights branch off | 14 | ~0.55" |
| T2 | Along frame rail (steady) | 14 | ~0.55" |
| T3 | Rear axle area (fan-out point) | 14 | ~0.55" |
| After B1 | Tails break off | 12 | ~0.50" |
| After B2 | Backup/camera break off | 8 | ~0.38" |
| After B3 | Markers break off | 6 | ~0.32" |
| After B4 | License plate breaks off | 5 | ~0.28" |
| After B5 | Fuel system breaks off | 3 | ~0.22" |

### 4.4 Rear Loom Build Order

1. **Build cab clearance sub-harness** (3 wires, 3.5ft each)
2. **Build tail light sub-harness** (2 wires, match lengths to left/right routing)
3. **Build backup/camera sub-harness** (4 wires)
4. **Build fuel system sub-harness** (2 wires — 10 AWG pump + 20 AWG sender)
5. **Lay out main trunk** on harness board — all 14 frame-rail wires at 18.4ft
6. **Join cab clearance wires** to trunk at the cab branch point
7. **Bundle trunk** with split loom (1/2" or 3/4") for the frame rail section
8. **Terminate PDM30 pins** at the front end
9. **Terminate fixture connectors** (weatherpack) at each light, sensor, pump
10. **Continuity test** every wire — this is the longest loom, most likely to have damage during install
11. **Label both ends** with permanent shrink labels
12. **Test fit along frame rail** before final tape/loom — measure actual distances

---

## 5. CHASSIS / UNDERBODY LOOM

**Wire count:** 10 | **Total wire length:** ~77 ft (est.)
**Route:** PDM30 -> down through firewall -> along engine bay / frame to components

These are wires from the Chassis/Underbody cut list section that serve engine bay and mid-vehicle components (not rear-routing).

### 5.1 Wire Inventory

| # | Label | Pin | Gauge | Color | Length | Destination |
|---|-------|-----|-------|-------|--------|-------------|
| 21 | Radiator Fan 1 | PDM30:OUT1 | 12 AWG | ORN/WHT | 4.6ft | Radiator, front |
| 22 | Radiator Fan 2 | PDM30:OUT2 | 12 AWG | ORG/BLK | 4.6ft | Radiator, front |
| 25 | Electric Water Pump | PDM30:OUT5 | 14 AWG | ORG/BLU | 4.6ft | Engine front |
| 64 | Wideband Lambda Controller | PDM30:OUT24 | 20 AWG | ORN/BLK | 4.6ft | Engine bay |
| 23 | A/C Compressor Clutch | PDM30:OUT16 | 18 AWG | ORN/RED | 4.6ft | Compressor |
| 1 | AMP Research Step Left | PDM30:OUT9 | 14 AWG | ORN/BLK | 11.5ft | Driver rocker |
| 2 | AMP Research Step Right | PDM30:OUT10 | 14 AWG | ORN/BLK/WHT | 11.5ft | Passenger rocker |
| 3 | AMP Research Controller | PDM30:OUT11 | 14 AWG | ORG/BLK/BLK | 11.5ft | Under cab center |
| 100 | Vehicle Speed Sensor | ECU | 22 AWG | ORG/BLU | 11.5ft | Transfer case/trans |
| 106 | Wideband O2 Sensor 1 | ECU | 22 AWG | VIO/BLU | 11.5ft | Driver exhaust |
| 107 | Wideband O2 Sensor 2 | ECU | 22 AWG | VIO/BLU/WHT | 11.5ft | Passenger exhaust |

Note: Wire #105 (A/C Pressure Switch Low) and #111 (A/C Pressure Switch High) from the Misc section also route to engine bay A/C components. Include them here if building a single underbody loom.

### 5.2 Sub-groups

#### Radiator / Front Engine Bay (4 wires)
Fans, water pump, A/C compressor. All short runs (4.6ft) from PDM30 to engine bay front.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 21 | Radiator Fan 1 | 12 AWG | ORN/WHT |
| 22 | Radiator Fan 2 | 12 AWG | ORG/BLK |
| 25 | Electric Water Pump | 14 AWG | ORG/BLU |
| 23 | A/C Compressor Clutch | 18 AWG | ORN/RED |

**Protection:** Split loom (1/2") — fans are 18A each, these are heavy current wires

#### AMP Research Power Steps (3 wires)
Left step, right step, controller. Route under cab along rockers.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 1 | AMP Step Left | 14 AWG | ORN/BLK |
| 2 | AMP Step Right | 14 AWG | ORN/BLK/WHT |
| 3 | AMP Controller | 14 AWG | ORG/BLK/BLK |

**Protection:** Split loom (3/8"), secured to frame with adel clamps every 12"
**Build note:** The AMP Research controller mounts centrally under the cab. Left and right step wires branch from the controller. Build as a Y-harness: controller at the junction, two branches to the steps.

#### Exhaust / Drivetrain Sensors (3 wires)
Wideband O2 x2 + vehicle speed sensor. Mid-vehicle routing along exhaust/drivetrain.

| # | Label | Gauge | Color |
|---|-------|-------|-------|
| 100 | Vehicle Speed Sensor | 22 AWG | ORG/BLU |
| 106 | Wideband O2 Sensor 1 | 22 AWG | VIO/BLU |
| 107 | Wideband O2 Sensor 2 | 22 AWG | VIO/BLU/WHT |

**Protection:** High-temp split loom near exhaust, standard split loom elsewhere
**Build note:** Wideband O2 sensors typically come with their own harness pigtails (Bosch LSU 4.9). These wires may be extensions from the wideband controller to the ECU rather than direct sensor wires. Verify with the Wideband Lambda Controller (#64) wiring diagram.

### 5.3 Chassis Loom Build Order

1. **Build radiator/front sub-harness** (4 wires, short runs)
2. **Build AMP Research Y-harness** (3 wires, branch at controller)
3. **Build exhaust sensor sub-harness** (3 wires)
4. **Terminate PDM30 and ECU pins**
5. **Terminate component connectors**
6. **Continuity test and label**

---

## 6. AUDIO LOOM

**Wire count:** 8 | **Total wire length:** 109.3 ft (est.)
**Route:** Head unit location (center dash) -> front speakers (door/kick panel) + rear speakers + subwoofer + amplifier

### 6.1 Wire Inventory

| # | Label | Pin | Gauge | Color | Length | Destination |
|---|-------|-----|-------|-------|--------|-------------|
| 31 | Radio/Head Unit | PDM30:OUT20 | 18 AWG | ORN/BLK | 3.5ft | Center dash |
| 26 | Speaker Front Left | ECU | 18 AWG | ORN/YEL | 6.9ft | Driver door/kick |
| 27 | Speaker Front Right | ECU | 18 AWG | ORN/VIO | 6.9ft | Pass door/kick |
| 28 | Speaker Rear Left | ECU | 18 AWG | ORN/ORG | 18.4ft | Rear left |
| 29 | Speaker Rear Right | ECU | 18 AWG | ORN | 18.4ft | Rear right |
| 30 | Subwoofer | ECU | 14 AWG | ORN/WHT | 18.4ft | Rear cargo |
| 32 | Amplifier | ECU | 8 AWG | ORN/RED | 18.4ft | Rear cargo |
| 96 | Amplifier Relay | ECU | 22 AWG | ORN/BLK | 18.4ft | Near amplifier |

**Build note:** Speaker wires in the cut list are shown as single conductors but speakers need + and - pairs. Each speaker needs 2 wires (or use 2-conductor cable). Verify total wire count with the head unit / amplifier wiring diagram. The amplifier power wire (#32) at 8 AWG carries significant current and should have its own fused run from the battery or PDM, not bundled tightly with speaker signal wires.

### 6.2 Audio Loom Build Order

1. **Build front speaker sub-harness** (2 pairs, route to doors/kick panels)
2. **Build rear speaker sub-harness** (2 pairs + sub pair, route to rear)
3. **Run amplifier power wire** (8 AWG) separately along frame/floor — keep away from signal wires
4. **Run amplifier relay wire** alongside the amplifier power wire
5. **Run head unit power wire** (short local run from PDM30)
6. **Terminate all connectors**
7. **Continuity test and label**

---

## 7. CAN BACKBONE

**Wire count:** 1 twisted pair | **Length:** 3.5 ft (est.)
**Route:** M130 Connector B (B17 CAN_HI, B18 CAN_LO) -> PDM30 (B26 CAN_HI, B25 CAN_LO)

### 7.1 Specification

| Parameter | Value |
|-----------|-------|
| Cable | 22 AWG twisted pair, TXL rated |
| Colors | WHT/GRN + GRN/WHT |
| Termination | 120 ohm resistor at each end |
| Twist rate | Minimum 1 twist per inch (25 twists/ft) |
| Shield | Not required for this short run (M130-to-PDM30 only) |

### 7.2 Pin Mapping

| End | CAN_HI | CAN_LO |
|-----|--------|--------|
| M130 | B17 | B18 |
| PDM30 | B26 | B25 |

### 7.3 Termination Detail

Each end gets a 120 ohm 1/4W resistor soldered across CAN_HI and CAN_LO, inside the connector backshell or at the pin.

- **M130 end:** 120 ohm between B17 and B18
- **PDM30 end:** 120 ohm between B25 and B26

Verify 60 ohm measured end-to-end between CAN_HI and CAN_LO with both terminators installed.

### 7.4 CAN Backbone Build Order

1. Cut twisted pair to measured length + 6" service loop
2. Solder 120 ohm resistor at M130 end (B17-B18) — heat shrink over resistor
3. Solder 120 ohm resistor at PDM30 end (B25-B26) — heat shrink over resistor
4. Crimp M130 B-connector pins (B17, B18)
5. Crimp PDM30 B-connector pins (B25, B26)
6. Route AWAY from ignition coil wires and injector wires
7. Test with M130 powered up — verify CAN communication to PDM30

### 7.5 Future CAN Expansion

When the CAN bridge module (ESP32/GPS) or Dakota Digital CAN adapter is added, the backbone extends:

```
M130 B17/B18 ---[twisted pair]--- PDM30 B25/B26 ---[twisted pair]--- C125/Bridge Module
                 120 ohm                                                   120 ohm
```

Move the PDM30 termination resistor to the last device on the bus. The bus is a daisy-chain, not a star — T-stubs cause reflections.

---

## 8. POWER DISTRIBUTION

**Wire count:** 4 heavy cables + relay control wires
**These are NOT part of any signal loom — they are built and routed separately.**

### 8.1 Main Power Cables

| # | Label | From | To | Gauge | Color | Length | Notes |
|---|-------|------|----|-------|-------|--------|-------|
| — | PDM30 Main Feed | Battery + | PDM30 C01 (M6 stud) | 6 AWG | RED | ~3ft | Fused at battery (80A MEGA fuse) |
| — | PDM30 Ground | Battery - | PDM30 A26+B18 | 6 AWG | BLK | ~3ft | Both VBATT_NEG pins MUST be connected |
| 6 | Starter Motor | Battery + | Starter solenoid | 4 AWG | ORN | 4.6ft | Through starter relay |
| 59 | Alternator | Alternator | Battery + | 8 AWG | ORN/VIO | 4.6ft | With fusible link (110A alt output) |
| 63 | Battery Disconnect | Battery + | Kill switch | 4 AWG | ORN/WHT | 4.6ft | Master disconnect |
| — | M130 Power | PDM30 | M130 A26 (BAT_POS) | 16 AWG | RED/WHT | ~2ft | M130 power via PDM output or direct |
| — | M130 Ground | Star ground | M130 A10+A11 | 16 AWG | BLK | ~2ft | Both BAT_NEG pins |

### 8.2 Relay-Controlled Power

| Circuit | Relay Location | Control Wire | Power Wire | Load |
|---------|---------------|-------------|------------|------|
| Fuel Pump | Near PDM30 | #94 (22 AWG, 4.6ft) | #66 (10 AWG, 18.4ft to tank) | Aeromotive pump, 30A |
| Bosch iBooster | Near PDM30 | #95 (22 AWG, 2.3ft) | #52 (10 AWG, 4.6ft) | iBooster, 40A |
| Starter | Engine bay | Via ignition switch | #6 (4 AWG, 4.6ft) | Starter motor |
| Amplifier | Near PDM30 | #96 (22 AWG, 18.4ft) | #32 (8 AWG, 18.4ft) | Audio amp |

### 8.3 Power Distribution Build Order

1. **Battery cables first** — 6 AWG to PDM30 (positive + negative), 4 AWG to starter
2. **Alternator charge wire** — 8 AWG with fusible link
3. **Battery disconnect** — 4 AWG to kill switch
4. **M130 power and ground** — 16 AWG from PDM30 area
5. **Mount fuel pump relay**, wire control (#94) and power (#66)
6. **Mount iBooster relay**, wire control (#95) and power (#52)
7. **Run amplifier power** (8 AWG) with inline fuse
8. **Verify all grounds** — star ground architecture, no daisy-chaining grounds

### 8.4 Ground Architecture

| Ground Point | Wires | Location |
|-------------|-------|----------|
| Battery negative post | 6 AWG to PDM30, 4 AWG to engine block, 4 AWG to chassis | Battery tray |
| Engine block ground stud | Engine-to-chassis ground strap, M130 A10/A11 star ground | Rear of driver head |
| M130 sensor ground | B15 (SEN_0V_A), B16 (SEN_0V_B) | Inside M130 — sensor return only |
| PDM30 ground reference | A28 (GND_0V_A), B22 (GND_0V_B) | Inside PDM30 — switch return |
| Body/cab ground | Interior lights, gauges, switches | Behind driver kick panel |

**Rule:** Sensor grounds (M130 B15/B16) are INTERNAL to the M130. They return through the ECU, not to the chassis. Never tie sensor grounds to the chassis — it creates ground loops that cause erratic sensor readings and false knock events.

---

## 9. MISCELLANEOUS / STANDALONE RUNS

These wires from the Misc/Exterior/Chassis cut list sections don't fit neatly into the main looms. They are short individual runs or connect to locally-mounted components.

### 9.1 Switch Input Wires (Route with Dash Loom or standalone)

| # | Label | Pin | Gauge | Color | Length | Notes |
|---|-------|-----|-------|-------|--------|-------|
| 33 | Turn Signal Switch | ECU | 18 AWG | ORN/BLU | 3.5ft | Column switch to PDM30 DIG input |
| 39 | Headlight Switch | ECU | 14 AWG | ORN/ORG | 3.5ft | Dash switch to PDM30 DIG input |
| 46 | Wiper/Washer Switch | ECU | 18 AWG | ORN/VIO | 3.5ft | Column switch to PDM30 DIG input |
| 53 | Brake Light Switch | ECU | 22 AWG | ORN/WHT | 3.5ft | Brake pedal to PDM30 DIG input |
| 40 | Ignition Switch | ECU | 14 AWG | ORN | 3.5ft | Key switch to PDM30 DIG input |
| 41 | Hazard Flasher | ECU | 18 AWG | ORN/WHT | 3.5ft | Dash switch to PDM30 DIG input |

**Build note:** These are all switch inputs to the PDM30 digital inputs. They run from dash/column-mounted switches to the PDM30. Bundle with the Dash Loom trunk for the shared routing segment.

### 9.2 Transmission / Drivetrain

| # | Label | Pin | Gauge | Color | Length | Notes |
|---|-------|-----|-------|-------|--------|-------|
| 55 | Transfer Case Indicator | PDM30 | 16 AWG | ORN/BLK | 11.5ft | To transfer case switch |
| 56 | Neutral Safety Switch | PDM30 | 14 AWG | ORN/RED | 11.5ft | To transmission |
| 57 | Reverse Light Switch | PDM30 | 18 AWG | ORN/BLU | 11.5ft | To transmission |
| 58 | Transmission Controller | PDM30:OUT23 | 20 AWG | ORN/YEL | 3.5ft | To 6L80E TCM (local) |

**Build note:** Transfer case, neutral safety, and reverse switch wires route under the vehicle to the transmission area. Could bundle with the Chassis loom or run as a standalone 3-wire sub-harness along the transmission tunnel.

### 9.3 Engine Bay Miscellaneous

| # | Label | Pin | Gauge | Color | Length | Notes |
|---|-------|-----|-------|-------|--------|-------|
| 52 | Bosch iBooster | ECU | 10 AWG | ORN | 4.6ft | Power wire to iBooster (relay-controlled) |
| 60 | ECU Power | ECU | 20 AWG | ORN/ORG | 4.6ft | M130 ignition-switched power |
| 61 | PDM Power | ECU | 22 AWG | ORN | 3.5ft | PDM30 ignition-switched power |
| 73 | Underhood Light | PDM30:OUT25 | 20 AWG | BRN/RED | 4.6ft | Engine bay work light |
| 95 | Bosch iBooster Relay | PDM30 | 22 AWG | ORN/WHT | 2.3ft | Relay coil control |
| 105 | A/C Pressure Switch Low | ECU | 22 AWG | ORN/YEL | 4.6ft | A/C system |
| 111 | A/C Pressure Switch High | ECU | 22 AWG | ORN/VIO | 4.6ft | A/C system |

---

## 10. BUILD SEQUENCE

The complete harness system should be built in this order. Each phase should be completed and tested before moving to the next.

### Phase 1: Preparation (Before Cutting Wire)

- [ ] Validate ALL wire lengths on the truck with tape measure
- [ ] Order all connector pigtails, mating connectors, terminals
- [ ] Order wire spools per BOM purchase summary
- [ ] Set up harness bench (mandrel, tape, loom stock, label printer)
- [ ] Print this document and the cut list for bench reference

### Phase 2: Engine Loom (Build First)

**Why first:** Most complex loom, highest pin density at M130. If the engine loom has problems, the vehicle doesn't run. Build and bench-test before anything else.

- [ ] Cut all 27 engine wires to measured length + 10%
- [ ] Build driver valve cover sub-harness (Branch 1: 8 wires)
- [ ] Build passenger valve cover sub-harness (Branch 2: 8 wires)
- [ ] Build intake top sub-harness (Branch 6: 4 wires)
- [ ] Build block sensor sub-harness (Branch 5: 4 wires, 2 shielded)
- [ ] Build front engine sub-harness (Branch 3: 2 wires, 1 shielded)
- [ ] Route crank position shielded cable (Branch 4: 1 wire)
- [ ] Bundle main trunk with DR-25 or spiral wrap
- [ ] Terminate all M130 A+B pins
- [ ] Terminate all sensor-side pigtails
- [ ] Continuity test every wire end-to-end
- [ ] Megger/insulation test (optional but recommended)
- [ ] Label every wire at both ends

### Phase 3: CAN Backbone

**Why second:** Quick to build, required for PDM30 communication. Validates that M130 and PDM30 can talk before wiring anything to the PDM.

- [ ] Cut twisted pair to length
- [ ] Install 120 ohm terminators at both ends
- [ ] Crimp M130 B17/B18 and PDM30 B25/B26 pins
- [ ] Power up M130 + PDM30, verify CAN handshake
- [ ] Verify 60 ohm end-to-end on CAN bus

### Phase 4: Power Distribution

**Why third:** PDM30 needs power before testing any output channel.

- [ ] Run battery to PDM30 main feed (6 AWG + fuse)
- [ ] Run battery to PDM30 ground (6 AWG, both A26 + B18)
- [ ] Run M130 power and ground
- [ ] Run alternator charge wire with fusible link
- [ ] Run starter cable
- [ ] Run battery disconnect
- [ ] Mount and wire fuel pump relay
- [ ] Mount and wire iBooster relay
- [ ] Verify all ground connections (star ground architecture)
- [ ] Power up system, verify PDM30 channels respond to M130 commands

### Phase 5: Dash Loom

**Why fourth:** Interior wiring is accessible and testable on the bench or in the cab.

- [ ] Cut all 18 dash wires to measured length
- [ ] Build driver door sub-harness (5 wires)
- [ ] Build passenger door sub-harness (4 wires)
- [ ] Build I/P sub-harness (3 wires)
- [ ] Build interior lights sub-harness (3 wires, spliced from OUT25)
- [ ] Build accessories sub-harness (2 wires)
- [ ] Run blower motor wire
- [ ] Bundle trunk
- [ ] Terminate PDM30 pins
- [ ] Terminate load-side connectors
- [ ] Test each PDM channel: windows, locks, lights, blower, accessories

### Phase 6: Front Lighting Loom

- [ ] Cut all 11 front lighting wires to measured length
- [ ] Build driver side sub-harness (4 wires)
- [ ] Build passenger side sub-harness (4 wires)
- [ ] Build center sub-harness (horn, wiper, washer)
- [ ] Bundle trunk
- [ ] Terminate PDM30 pins and fixture connectors
- [ ] Test each circuit: headlights, turns, parking, markers, horn, wiper, washer

### Phase 7: Rear Loom

**Why late:** Longest loom, hardest to route. Needs the most on-vehicle fitting time.

- [ ] Cut all 17 rear wires to measured length
- [ ] Build cab clearance sub-harness (3 wires)
- [ ] Build tail light sub-harness (2 wires)
- [ ] Build backup/camera sub-harness (4 wires)
- [ ] Build fuel system sub-harness (2 wires, 10 AWG pump + sender)
- [ ] Lay out main trunk on harness board
- [ ] Bundle with split loom for frame rail section
- [ ] Route along frame rail, secure with adel clamps
- [ ] Terminate PDM30 pins and fixture connectors
- [ ] Test each circuit: tails, backup, third brake, markers, license, fuel pump, camera

### Phase 8: Chassis / Underbody Loom

- [ ] Build radiator/front sub-harness (4 wires)
- [ ] Build AMP Research Y-harness (3 wires)
- [ ] Build exhaust sensor sub-harness (3 wires)
- [ ] Terminate and test

### Phase 9: Audio Loom

- [ ] Build speaker harnesses (verify + and - pairs needed)
- [ ] Run amplifier power wire (8 AWG) with inline fuse
- [ ] Run head unit power
- [ ] Test with head unit powered up

### Phase 10: Switch Inputs and Miscellaneous

- [ ] Wire all switch inputs to PDM30 digital inputs
- [ ] Wire transmission/drivetrain runs
- [ ] Wire engine bay miscellaneous (iBooster, A/C switches, underhood light)
- [ ] Test each switch input registers on PDM30

### Phase 11: Integration Test

- [ ] Power up complete system
- [ ] Verify M130 LED status (no faults)
- [ ] Verify PDM30 CAN link active
- [ ] Test each PDM channel individually with bench load
- [ ] Crank engine, verify all sensor readings in M130 tune software
- [ ] Test all lighting circuits (headlights, turns, tails, backup, markers, brake)
- [ ] Test door functions (windows, locks, switches)
- [ ] Test interior (lights, blower, USB, 12V outlet)
- [ ] Test fuel pump prime and run
- [ ] Road test with all systems active
- [ ] Check for EMI: radio static, erratic sensor readings, CAN errors

---

## 11. WIRE DIAMETER REFERENCE

Approximate outer diameter (OD) for TXL automotive wire with insulation:

| Gauge | Single Wire OD | Notes |
|-------|---------------|-------|
| 4 AWG | 0.300" | Battery/starter cables |
| 6 AWG | 0.250" | PDM30 main feed |
| 8 AWG | 0.200" | Alternator, amplifier power |
| 10 AWG | 0.170" | Fuel pump, iBooster |
| 12 AWG | 0.130" | Window motors, fans, blower |
| 14 AWG | 0.110" | Steps, switches, headlights |
| 16 AWG | 0.095" | M130 power, headlights |
| 18 AWG | 0.080" | Lighting, locks, sensors |
| 20 AWG | 0.070" | Signal wires, low-current |
| 22 AWG | 0.060" | Sensor signals, CAN, switches |
| 22 AWG Shielded | 0.150" | CKP, CMP, KS (2-conductor with shield) |
| 22 AWG Twisted Pair | 0.130" | CAN bus |

### Bundle Diameter Estimation

For a bundle of N wires, the bundle diameter is approximately:

```
D_bundle = D_single * sqrt(N) * 1.2 (packing factor)
```

For mixed gauges, use the weighted average single-wire diameter.

### Loom Protection Sizing

| Bundle OD | Recommended Protection |
|-----------|----------------------|
| < 0.25" | Harness tape (Tesa 51036) only |
| 0.25" - 0.40" | Split loom 3/8" or DR-25 3/8" |
| 0.40" - 0.60" | Split loom 1/2" or DR-25 1/2" |
| 0.60" - 0.80" | Split loom 3/4" |
| > 0.80" | Split loom 1" or dual-wall heat shrink |

---

## NOTES AND WARNINGS

1. **ALL LENGTHS ARE ESTIMATED.** Measure every wire run on the actual truck before cutting. The cut list uses generic zone-based lengths (4.6ft engine bay, 3.5ft dash, 18.4ft rear). Actual lengths will vary by 20-50%.

2. **ETB wiring needs clarification.** Cut list wire #4 shows the Electronic Throttle Body as a single 18 AWG wire, but the ETB connector is 6-pin (2x motor drive, 2x TPS1, 2x TPS2). Verify M130 pin assignments for all 6 ETB wires.

3. **Speaker wires need pairs.** The cut list shows 5 speaker circuits as single wires. Each speaker needs a positive and negative conductor. Either double the wire count or use 2-conductor speaker cable.

4. **Backup camera wire #97** was listed in the Engine section of the cut list. Reassigned to Rear Loom in this document.

5. **Color code conflict:** Wire #77 (Side Marker Rear Left) and #89 (Backup Light Left) both show BRN/ORG. Wire #78 (Side Marker Rear Right) and #67 (Dome Light) and #90 (Cab Clearance Center) all show BRN. Verify colors are intentional (same PDM output) or assign unique colors for troubleshooting.

6. **Fuel pump relay (#94)** is listed at 4.6ft but routes to a relay near PDM30. This is a control wire only — the power wire is #66 at 10 AWG, 18.4ft to the tank.

7. **Shielded cables** (CKP, CMP, KS1, KS2) must be grounded at the M130 end ONLY. Grounding at both ends creates ground loops.

8. **PDM30 requires BOTH ground pins** (A26 + B18) connected. Missing either one will cause ground faults and erratic output behavior.

9. **PDM30 OUT13** drives multiple lights (tail left, tail right, parking left, parking right). Verify aggregate current draw does not exceed 8A channel limit.

10. **PDM30 OUT19** drives all marker lights + clearance lights + license plate. Same 8A limit check needed.

11. **PDM30 OUT25** drives dome, under-dash, footwell, underhood, and cargo lights. Verify aggregate current within 8A.

12. **PDM30 OUT15** drives backup left, backup right, third brake light, and rear camera. Verify aggregate current within 8A.
