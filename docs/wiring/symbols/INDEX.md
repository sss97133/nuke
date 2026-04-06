# Wiring Diagram Symbol Library -- Index

Phase 1: Engine Schematic symbols (Section 2). 17 symbols covering the core categories needed to produce the first wiring diagram.

Reference specs:
- Symbol definitions: `appendix-g-diagram-requirements-spec.md` Section 4
- Stroke/font rules: `appendix-e-diagram-format-spec.md` Sections 3, 9

## Common Properties

All symbols share these attributes:
- `viewBox="0 0 40 40"` (40x40 unit canvas)
- `stroke="black"` with `stroke-width="1.5"` for primary outlines
- `fill="white"` for closed shapes (engineering drawing standard: black on white)
- Each file contains `<title>` (symbol name) and `<desc>` (usage context)
- Font: Courier New / monospace (matches Appendix E Section 9.3 component name spec)

## Stroke Weight Reference (from Appendix E Section 9.4)

| Element | Width | Usage |
|---------|-------|-------|
| Component outline | 0.5pt (1.5 SVG units at 40-unit scale) | Symbol bodies |
| Hot wire | 0.5pt | Powered circuit lines |
| Ground wire | 0.5pt, dashed 6,3 | Ground return lines |
| Heavy wire | 1.0pt | Battery cables |
| Signal wire | 0.35pt | Sensor signals |
| Grid lines | 0.25pt, #CCCCCC | Background grid |

---

## Power Distribution (3 symbols)

| File | Symbol | Spec Ref | Dimensions | Usage |
|------|--------|----------|------------|-------|
| `P-01_battery.svg` | Battery | P-01 | 6mm W x 8mm H | Battery location and battery voltage rail reference points |
| `P-05_pdm-channel.svg` | PDM Channel Output | P-05 | 5mm W x 8mm H | Each PDM30 output channel (30 instances on Section 4). Channel number and current rating are parameterized -- replace "CH" and "10A" text in instantiation |
| `P-08_alternator.svg` | Alternator | P-08 | 10mm dia | Powermaster 150A alternator (Section 0). Sine wave indicates AC generation |

### Usage Rules -- Power
- P-01 appears at the battery AND at any bus rail representing battery voltage
- P-05 is a template: when placed on a diagram, the channel number (1-30) and current rating must be set per the PDM30 channel map
- P-08 always includes the amp rating annotation adjacent to the symbol (e.g., "150A")

---

## Sensors / Inputs (5 symbols)

| File | Symbol | Spec Ref | Dimensions | Usage |
|------|--------|----------|------------|-------|
| `I-01_thermistor.svg` | Thermistor (NTC) | I-01 | 6mm dia | Coolant temp (CLT), intake air temp (IAT), oil temp sensors |
| `I-02_pressure-transducer.svg` | Pressure Transducer | I-02 | 6mm dia | Oil pressure, MAP sensor, fuel pressure, A/C pressure switches |
| `I-03_hall-effect.svg` | Hall Effect Sensor | I-03 | 5mm W x 8mm H | Crank position sensor (58X), cam position sensor. Always shown with 3 terminals (5V ref, signal, ground) |
| `I-04_knock-sensor.svg` | Knock Sensor (Piezo) | I-04 | 6mm x 6mm | Knock sensor bank 1, knock sensor bank 2. Hexagonal body distinguishes from other sensors |
| `I-05_potentiometric-sensor.svg` | Potentiometric Sensor | I-05 | 6mm W x 4mm H | Throttle position sensor (integrated in throttle body), fuel level sender. Wiper arrow indicates variable resistance |

### Usage Rules -- Sensors
- I-01 through I-05 all require shielded cable connections (R-04) for crank, cam, and knock sensors per Motec wiring guidelines
- I-03 (Hall effect) always has 3 wires: 5V reference, signal output, sensor ground (G-04)
- I-04 (Knock) uses 2 wires only: signal and ground. Shield drain goes to sensor ground, NOT chassis ground
- I-05 wiper arrow points toward the signal output terminal

---

## Actuators / Outputs (3 symbols)

| File | Symbol | Spec Ref | Dimensions | Usage |
|------|--------|----------|------------|-------|
| `O-04_fuel-injector.svg` | Fuel Injector | O-04 | 4mm W x 8mm H | Fuel injectors x8. EV6/USCAR connector, peak-and-hold drive from M130. First instance drawn in full detail; instances 2-8 use abbreviated notation referencing the first |
| `O-05_ignition-coil.svg` | Ignition Coil | O-05 | 6mm W x 10mm H | D510C ignition coils x8 (coil-near-plug). 4 terminals: B+, IGN command, GND, HV spark output. Same abbreviated notation rule as injectors |
| `O-10_throttle-body.svg` | Electronic Throttle Body (DBW) | O-10 | 10mm W x 12mm H | GM 12605109 LS3 90mm DBW throttle body. Compound symbol showing motor (H-bridge driven) and dual TPS sensors. 6 terminals total |

### Usage Rules -- Actuators
- O-04: For injectors 2-8, draw the symbol with a dashed body and label "SEE INJ1 DETAIL" with cross-reference
- O-05: Same abbreviated notation for coils 2-8 referencing coil 1 detail
- O-10: This is a compound symbol (motor + sensors in one housing). The 6 terminals must match the Motec M130 pin assignments exactly: Motor+ (M130 A3), Motor- (M130 A4), TPS1 5V (M130 B5), TPS1 SIG (M130 A14), TPS2 SIG (M130 A15), SEN GND (M130 B15)

---

## Connectors (2 symbols)

| File | Symbol | Spec Ref | Dimensions | Usage |
|------|--------|----------|------------|-------|
| `C-01_inline-connector.svg` | Inline Connector Pair | C-01 | 4mm W x varies | Every point where two harness sections connect inline. Keying tab shown on one half |
| `C-02_connector-face-view.svg` | Connector Face View Template | C-02 | Varies with pin count | Template for multi-pin device connections. Filled circles = populated pins; open circles = empty cavities |

### Usage Rules -- Connectors
- C-01: Always label both halves with the connector ID (e.g., "X101-A" / "X101-B"). The mating gap line indicates the disconnect point
- C-02: This is a TEMPLATE. For actual use, scale the rectangle and pin grid to match the real connector cavity count. Pin labels must match the connector schedule. Populated vs. empty is determined from the pin assignment database (`device_pin_maps`)
- All connectors with 3+ pins get a face view (C-02). 2-pin connectors use the simple mating blocks (C-01)

---

## Grounds (2 symbols)

| File | Symbol | Spec Ref | Dimensions | Usage |
|------|--------|----------|------------|-------|
| `G-01_chassis-ground.svg` | Chassis Ground | G-01 | 4mm W x 5mm H | Every wire bolted directly to frame or engine block. Three decreasing horizontal lines (standard IEC/IEEE ground symbol) |
| `G-04_ecu-sensor-ground.svg` | ECU Sensor Ground | G-04 | 4mm x 4mm | Each ECU sensor ground return (M130 pins B15/B16 SEN_0V_A/B). Triangle with "SG" distinguishes sensor grounds from chassis/power grounds |

### Usage Rules -- Grounds
- G-01: Every instance must include a bolt callout annotation (bolt size, torque, paint removal note) per the Ground Distribution Diagram (Document 2.3)
- G-04: CRITICAL DISTINCTION -- sensor grounds return to the ECU sensor ground pins, NOT to chassis. This is the Motec star-ground architecture requirement. All sensor ground wires (from I-01 through I-05) terminate at G-04, not G-01
- G-04 pin reference label (e.g., "B15") must be updated per the actual M130 pin assignment

---

## Communication and Routing (2 symbols)

| File | Symbol | Spec Ref | Dimensions | Usage |
|------|--------|----------|------------|-------|
| `R-04_shielded-cable.svg` | Shielded Cable Indicator | R-04/R-08 (spec) | Envelope 2mm wider than enclosed wires | Crank sensor cable, cam sensor cable, knock sensor cables (4 instances total). Dashed envelope with cross-hatch marks. Shield drain wire shown descending to sensor ground |
| `R-08_twisted-pair.svg` | Twisted Pair Indicator | R-09 (spec) | Standard wire weight | CAN bus backbone (M130 B17/B18 to PDM30 B25/B26). X markers at crossover points indicate the physical twist |

### Usage Rules -- Routing
- R-04: Shield drain wire ALWAYS connects to sensor ground (G-04 / M130 pin B15/B16), NEVER to chassis ground (G-01). This is per Motec wiring guidelines for EMI rejection
- R-04: The number of conductors inside the shield envelope varies (2 for crank/cam, 1+shield for knock). Adjust the number of parallel lines inside the envelope accordingly
- R-08: Twist markers (X) should appear at intervals matching approximately 20mm of drawing length per spec. For CAN bus, the twist rate must be minimum 33 twists/meter per SAE J1939
- R-08: CAN bus requires 120-ohm termination resistors at each physical end of the backbone (separate symbol R-12 in the full library)

---

## Remaining Symbols (Phase 2)

The following symbols from the full 67-symbol library (Appendix G Section 4) are NOT yet built. They are needed for sections beyond the engine schematic:

**Power (5 remaining):** P-02 Fuse, P-03 Fusible Link, P-04 Circuit Breaker, P-06 Relay, P-07 Battery Disconnect
**Switching (9):** S-01 through S-09
**Sensors (6 remaining):** I-06 Speed Sensor, I-07 Wideband Lambda, I-08 Fuel Level Sender, I-09 Door Jamb Switch, I-10 Backup Camera, I-11 Gauge Sender
**Actuators (7 remaining):** O-01 Motor, O-02 Reversible Motor, O-03 Solenoid, O-06 Horn, O-07 Speaker, O-08 iBooster, O-09 A/C Compressor
**Lighting (5):** L-01 through L-05
**Connectors (3 remaining):** C-03 Ring Terminal, C-04 Spade Terminal, C-05 Butt Splice
**Grounds (2 remaining):** G-02 Body Ground, G-03 Star Ground Bus
**Protection (3):** D-01 Diode, D-02 TVS, D-03 Capacitor
**Routing (10 remaining):** R-01 Hot Wire, R-02 Ground Wire, R-03 Heavy Wire, R-05 Wire Crossing, R-06 Wire Junction, R-07 Splice, R-09 (unused), R-10 Cross-Ref Right, R-11 Cross-Ref Left, R-12 Termination Resistor
