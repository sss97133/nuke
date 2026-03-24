# Chapter 12: The Build Sheet

## What It Is

A step-by-step assembly guide organized by harness section. Not a design document — a construction sequence. The builder reads top to bottom and builds.

## Assembly Sequence

### Phase 1: Preparation

1. **Print the cut list** (Chapter 9). Tape to the bench wall.
2. **Print the connector schedule** (Chapter 10). One page per connector.
3. **Verify BOM** (Chapter 11). All NEEDED items ordered. All PURCHASED items on hand.
4. **Set up the harness board.** Mark breakout points for engine, dash, rear looms.

### Phase 2: ECU and PDM Core

1. Mount M130 ECU in designated location (typically firewall, passenger side)
2. Mount PDM30 (typically under dash, accessible for fuse replacement)
3. Run main power feeds: BAT_POS (16 AWG) from battery to PDM, PDM to ECU
4. Run ground straps: BAT_NEG (16 AWG) to chassis star ground point
5. Run CAN bus pair (22 AWG twisted, WHT/GRN + GRN/WHT) between ECU B17/B18 and PDM CAN port
6. Add 120-ohm termination resistors at both ends of CAN bus

### Phase 3: Engine Loom (28 wires, 143 ft)

1. **Injectors** (8 wires, 18 AWG GRN with stripe sequence): Run from M130 pins A19-A22, A27-A30 to each injector EV6/USCAR connector
2. **Coils** (8 wires, 20 AWG WHT with stripe sequence): Run from M130 pins A03-A08, A12-A13 to each D510C coil connector
3. **Crank sensor** (22 AWG shielded 2C): Run from M130 B01 (UDIG1) — shield drain to B15 (SEN_0V_A)
4. **Cam sensor** (22 AWG shielded 2C): Run from M130 B02 (UDIG2)
5. **Knock sensors** (22 AWG shielded 2C × 2): Run from M130 B07 and B13
6. **Analog sensors** (22 AWG TXL): MAP (AV1), IAT (AT1), CLT (AT3), oil pressure (AV2), fuel pressure (AV3), oil temp (AT2)
7. **Throttle body** (18 AWG): 6-pin connector, 2 wires to half-bridge outputs A18/A01 for motor, 2 to AV inputs for TPS1/TPS2, 2 to 5V supply and ground

### Phase 4: Exterior Loom (27 wires, 241 ft)

1. **Headlights** (4 circuits from PDM Ch1-Ch4): Run to Truck-Lite 27270C, both sides
2. **Turn/brake** (2 circuits from PDM Ch5-Ch6): Run to United Pacific assemblies, left and right
3. **Markers/clearance/license** (grouped on PDM Ch7): Single feed, splice at rear
4. **Parking/tail** (grouped on PDM Ch8): Single feed, splice to both sides
5. **Backup/3rd brake/camera** (grouped on PDM Ch9): Reverse-triggered via PDM input

### Phase 5: Interior Loom (20 wires, 117 ft)

1. **Dakota Digital VHX-73C-PU gauges**: Analog signals from ECU analog outputs, power from PDM
2. **Switches**: Headlight, turn, wiper, blower, ignition — PDM input wires
3. **Keypad**: 8-button Motec keypad, CAN-connected
4. **Interior lights**: Dome, footwell, underdash (grouped on PDM Ch10)
5. **HVAC controls**: Blower speed via PDM, AC compressor clutch via PDM

### Phase 6: Chassis/Under (10 wires, 60 ft)

1. **AMP PowerStep**: Controller power from PDM, door trigger inputs, motor outputs
2. **Power locks**: Dorman 746-014 actuators, polarity-reversing relay pair per side
3. **Power windows**: Nu-Relics NR17380201 motors, polarity-reversing relay pair per side
4. **Fuel pump relay**: Dedicated relay controlled by PDM, relay output to Aeromotive A1000

### Phase 7: Audio (7 wires, 76 ft)

1. **Amplifier power**: Direct battery feed, 30A inline fuse, 10 AWG to amp location
2. **Head unit**: RetroSound Hermosa, accessory power from PDM
3. **Speaker runs**: 4 speakers + subwoofer, 18 AWG runs

### Phase 8: Power Distribution (10 wires, 112 ft)

1. **Battery cables**: 4 AWG from battery to starter solenoid and main junction
2. **Alternator charge wire**: Direct to battery junction
3. **RBD-190 battery disconnect**: Inline between battery and main distribution
4. **PDM main feeds**: From battery junction through RBD-190 to PDM power input
5. **Ground bus**: Star ground topology — engine block, firewall, body, dash

### Phase 9: Final

1. **Harness bundling**: DR-25 heat shrink for engine compartment, braided sleeving for visible runs
2. **Label all connectors** with circuit codes from cut list
3. **Continuity test** every circuit before powering on
4. **ECU programming**: Connect via Ethernet, load M1 firmware, configure I/O assignments
5. **PDM programming**: Configure channel assignments, current limits, soft-start profiles
6. **First power-on**: Battery disconnect in ON position, monitor for shorts (ammeter on main feed)
7. **Sensor calibration**: Verify all analog inputs read correctly in M1 Tune
8. **Engine start sequence**: Crank with injectors disabled, verify RPM signal, then enable
