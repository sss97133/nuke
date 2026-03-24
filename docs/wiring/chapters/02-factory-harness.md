# Chapter 2: The Squarebody Factory Harness

## Overview

A 1973-1987 C/K series truck left the factory with approximately 71 distinct electrical circuits. Every wire has a GM-assigned circuit number, a standardized color, and a defined path from source to load. The factory harness is the baseline — the starting point for any upgrade.

## Circuit Organization by System

### Starting & Charging (7 circuits)

| Code | Circuit | Color | Gauge | From → To | Failure Risk |
|------|---------|-------|-------|-----------|-------------|
| BAT_FEED | Battery to Starter/Junction | RED | 4 AWG | battery → starter_solenoid | Cable/terminal corrosion (CRITICAL) |
| GND_ENGINE | Engine Ground Strap | BLK | 4 AWG | engine_block → frame | Strap corrosion, bolt loosening (CRITICAL) |
| GND_BODY | Body Ground | BLK | 10 AWG | body → frame | Bolt corrosion, paint insulation |
| CHARGE_MAIN | Alternator to Junction | RED | 20 AWG | alternator → horn_relay_junction | Fusible link burn, connector corrosion (CRITICAL) |
| CHARGE_SENSE | Alternator Field/Sense | DK BLU | 12 AWG | alternator → voltage_regulator | Connector corrosion |
| CHARGE_IND | Charge Indicator Light | BRN | 20 AWG | alternator → instrument_cluster | — |
| START_SOLENOID | Ignition to Starter | PPL/WHT | 12 AWG | ignition_switch → starter_solenoid | Ignition switch wear |
| START_NEUTRAL | Neutral Safety Switch | YEL | 14 AWG | neutral_safety_switch → starter_solenoid | Switch adjustment, connector corrosion |

### Ignition System (5 circuits)

| Code | Circuit | Color | Gauge | From → To | Notes |
|------|---------|-------|-------|-----------|-------|
| IGN_RUN | Ignition Run Feed | PNK | 12 AWG | ignition_switch → fuse_block | Switch contact wear |
| IGN_RUN_START | Ignition Run+Start Feed | PNK/BLK | 12 AWG | ignition_switch → coil_resistor | Through bulkhead |
| IGN_COIL | Coil Primary Feed | PNK/BLK | 14 AWG | coil_resistor → ignition_coil | Heat damage, connector corrosion |
| IGN_TACH | Tachometer Signal | WHT | 20 AWG | ignition_coil → instrument_cluster | Through bulkhead |
| ELEC_CHOKE | Electric Choke | BLK | 14 AWG | oil_pressure_switch → carburetor_choke | Choke element failure |

### Lighting (22 circuits)

| Code | Circuit | Color | Gauge | From → To | Notes |
|------|---------|-------|-------|-----------|-------|
| HEADLIGHT_SWITCH_FEED | Headlight Switch Battery Feed | RED | 12 AWG | horn_relay_junction → headlight_switch | Fusible link burn, switch burn (CRITICAL) |
| HEADLIGHT_HI_L | Left High Beam | LT GRN | 14 AWG | dimmer_switch → headlight_left | Dimmer switch wear, ground corrosion |
| HEADLIGHT_HI_R | Right High Beam | LT GRN | 14 AWG | dimmer_switch → headlight_right | — |
| HEADLIGHT_LO_L | Left Low Beam | TAN | 14 AWG | dimmer_switch → headlight_left | — |
| HEADLIGHT_LO_R | Right Low Beam | TAN | 14 AWG | dimmer_switch → headlight_right | — |
| PARKING_L | Left Parking/Marker | BRN | 18 AWG | headlight_switch → parking_light_left | — |
| PARKING_R | Right Parking/Marker | BRN | 18 AWG | headlight_switch → parking_light_right | — |
| CLEARANCE_L | Left Cab Clearance | BRN | 18 AWG | headlight_switch → clearance_light_left | 20A fuse |
| CLEARANCE_CENTER | Center Cab Clearance | BRN | 18 AWG | headlight_switch → clearance_light_center | 20A fuse |
| CLEARANCE_R | Right Cab Clearance | BRN | 18 AWG | headlight_switch → clearance_light_right | 20A fuse |
| SIDE_MARKER_FL | Front Left Side Marker | BRN | 18 AWG | headlight_switch → side_marker_fl | 20A fuse, through bulkhead |
| SIDE_MARKER_FR | Front Right Side Marker | BRN | 18 AWG | headlight_switch → side_marker_fr | 20A fuse, through bulkhead |
| SIDE_MARKER_RL | Rear Left Side Marker | BRN | 18 AWG | tail_light_assembly → side_marker_rl | 20A fuse |
| SIDE_MARKER_RR | Rear Right Side Marker | BRN | 18 AWG | tail_light_assembly → side_marker_rr | 20A fuse |
| INST_LIGHTS | Instrument Panel Lights | GRY | 18 AWG | headlight_switch → instrument_cluster | 3A fuse, rheostat burn |
| CARGO_LIGHT | Cargo/Bed Light | ORN | 20 AWG | fuse_block → cargo_light | — |
| GLOVE_BOX | Glove Box Light | ORN | 20 AWG | fuse_block → glove_box_light | — |
| UNDERHOOD | Underhood Light | ORN | 20 AWG | fuse_block → underhood_light | Through bulkhead |

### Gauges & Instruments (5 circuits)

| Code | Circuit | Color | Gauge | From → To | Notes |
|------|---------|-------|-------|-----------|-------|
| GAUGE_FEED | Gauge/Instrument Feed | PNK | 18 AWG | fuse_block → instrument_cluster | 10A fuse. Printed circuit crack (CRITICAL) |
| FUEL_SENDER | Fuel Level Sender | PNK | 20 AWG | fuel_tank_sender → instrument_cluster | Sender failure, ethanol corrosion |
| OIL_SENDER | Oil Pressure Sender | TAN | 20 AWG | oil_pressure_sender → instrument_cluster | Through bulkhead |
| TEMP_SENDER | Coolant Temp Sender | DK GRN | 20 AWG | temp_sender → instrument_cluster | Through bulkhead |
| VOLT_GAUGE | Voltmeter Feed | BRN | 20 AWG | fuse_block → instrument_cluster | — |

### Fuel System (6 circuits)

| Code | Circuit | Color | Gauge | From → To | Notes |
|------|---------|-------|-------|-----------|-------|
| FUEL_PUMP | Electric Fuel Pump (TBI) | PPL | 14 AWG | fuel_pump_relay → fuel_pump | 15A. Relay/pump failure, connector corrosion |
| FUEL_PUMP_RELAY | Fuel Pump Relay Control | GRY | 18 AWG | ecm → fuel_pump_relay | — |
| FUEL_SENDER_FRONT | Front Tank Sender | PNK | 20 AWG | front_fuel_sender → fuel_tank_selector | Through bulkhead |
| FUEL_SENDER_REAR | Rear Tank Sender | DK BLU | 20 AWG | rear_fuel_sender → fuel_tank_selector | Selector valve leak, sender corrosion |
| FUEL_SELECTOR | Fuel Tank Selector Valve | GRY | 14 AWG | fuel_tank_selector → fuel_selector_valve | Valve/switch failure |

### HVAC (4 circuits)

| Code | Circuit | Color | Gauge | From → To | Notes |
|------|---------|-------|-------|-----------|-------|
| HEATER_BLOWER | Heater Blower Motor | PPL | 14 AWG | blower_switch → blower_motor | 25A. Resistor burnout, motor failure |
| HEATER_RESISTOR | Blower Resistor | YEL | 16 AWG | blower_switch → blower_resistor | Resistor burnout |
| AC_COMPRESSOR | AC Compressor Clutch | DK GRN | 14 AWG | ac_switch → ac_compressor_clutch | 25A. Clutch/pressure switch failure |
| AC_PRESSURE | AC Pressure Cycling Switch | BLK | 18 AWG | ac_switch → ac_pressure_switch | Switch failure |

### Accessories (13 circuits)

| Code | Circuit | Color | Gauge | From → To | Notes |
|------|---------|-------|-------|-----------|-------|
| WIPER_FEED | Wiper Motor Feed | PPL | 14 AWG | fuse_block → wiper_motor | 25A. Switch/motor failure |
| WIPER_PARK | Wiper Park Switch | GRY | 18 AWG | wiper_motor → wiper_switch | Through bulkhead |
| WASHER_PUMP | Windshield Washer | PNK | 18 AWG | washer_switch → washer_pump | Through bulkhead |
| HORN_BUTTON | Horn Button Signal | BLK | 18 AWG | horn_button → horn_relay | Through bulkhead |
| HORN_RELAY | Horn Relay Feed | DK GRN | 14 AWG | horn_relay → horn | 25A. Contact ring wear |
| RADIO_FEED | Radio/Accessory Feed | YEL | 18 AWG | fuse_block → radio | 10A fuse |
| RADIO_SPEAKER_L | Left Speaker | TAN | 20 AWG | radio → speaker_left | Corrected from LT GRN per GM Circuit 201 |
| RADIO_SPEAKER_R | Right Speaker | LT GRN | 20 AWG | radio → speaker_right | Corrected from DK GRN per GM Circuit 200 |
| CIG_LIGHTER | Cigarette Lighter | ORN | 14 AWG | fuse_block → cigarette_lighter | 20A fuse |
| KEY_BUZZER | Key-in-Ignition Buzzer | TAN | 20 AWG | ignition_switch → warning_buzzer | — |
| SEAT_BELT_WARN | Seat Belt Warning | YEL | 20 AWG | seat_belt_switch → warning_buzzer | Switch failure |
| CRUISE_MODULE | Cruise Control Module | DK GRN | 18 AWG | cruise_switch → cruise_module | Through bulkhead |
| CRUISE_SERVO | Cruise Control Servo | LT GRN | 18 AWG | cruise_module → cruise_servo | — |

### Body (6 circuits)

| Code | Circuit | Color | Gauge | From → To | Notes |
|------|---------|-------|-------|-----------|-------|
| PWR_WINDOW_L | Left Power Window | DK BLU | 12 AWG | window_switch → window_motor_left | 30A fuse |
| PWR_WINDOW_R | Right Power Window | DK BLU/WHT | 12 AWG | window_switch → window_motor_right | 30A fuse |
| PWR_LOCK_L | Left Power Door Lock | BLK | 18 AWG | lock_switch → lock_actuator_left | 20A fuse |
| PWR_LOCK_R | Right Power Door Lock | LT BLU | 18 AWG | lock_switch → lock_actuator_right | 20A fuse |

### TBI/EFI Engine (10 circuits — 1987 TBI-equipped trucks)

| Code | Circuit | Color | Gauge | From → To |
|------|---------|-------|-------|-----------|
| TBI_ECM_POWER | ECM Power Feed | ORN | 12 AWG | fuse_block → ecm |
| TBI_CLT | Coolant Temp Sensor | YEL | 22 AWG | ecm → cts |
| TBI_TPS | Throttle Position Sensor | DK BLU | 22 AWG | ecm → tps |
| TBI_MAP | MAP Sensor | LT GRN | 22 AWG | ecm → map_sensor |
| TBI_O2 | Oxygen Sensor | PPL | 22 AWG | ecm → o2_sensor |
| TBI_IAC | Idle Air Control | LT BLU | 20 AWG | ecm → iac_valve |
| TBI_EST | Electronic Spark Timing | WHT | 20 AWG | ecm → hei_distributor |
| TBI_INJ_1 | TBI Injector 1 | LT BLU | 18 AWG | ecm → tbi_injector_1 |
| TBI_INJ_2 | TBI Injector 2 | LT GRN | 18 AWG | ecm → tbi_injector_2 |

## Critical Failure Patterns

**Printed circuit board** (instrument cluster): The flexible copper traces on the rear of the cluster crack from heat cycling. Symptoms: intermittent gauges, phantom warning lights. Solution: replace with reproduction PCB.

**Fusible links**: Inline between alternator and junction. Factory spec is 4 gauges smaller than the wire they protect. They degrade silently over decades. Replacement with modern Maxi-fuse holders is the standard upgrade.

**Headlight switch**: Carries full headlight current through a contact inside the dash. Decades of heat cycling burn the contacts. Switch replacement is 100% expected on any restoration.

**Bulkhead connector**: A 20-pin connector passes through the firewall. Every circuit that crosses engine-to-cab goes through this single point. Corrosion here causes cascading failures across multiple systems.

## Verification Status

Of 71 factory circuits:
- **40 circuits** verified MATCH against GM Circuit ID table
- **3 circuits** corrected (speaker L, speaker R, washer pump colors fixed per GM table)
- **1 circuit** partial match (START_SOLENOID: factory PPL/WHT stripe vs GM PPL solid)
- **8 circuits** mapped to different GM circuit numbers than expected (fuel system variants, AC pressure)
- **19 circuits** not yet mapped to GM circuit numbers (TBI/EFI circuits use 400-series, clearance/marker lights are sub-circuits of circuit 9)
