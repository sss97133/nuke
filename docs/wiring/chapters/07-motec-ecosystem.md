# Chapter 7: The Motec Ecosystem

## ECU Models

### M130
| | |
|---|---|
| Price | $3,500 (Desert Performance invoice, 2019) |
| Connectors | 2: Connector A (34-pin Superseal) + Connector B (26-pin Superseal) |
| Dimensions | 107 × 127 × 39 mm |
| Weight | 290g |
| Logging | 120 MB |
| CAN buses | 1 |
| Source | racespeconline.com product page (verified) |

**I/O:**
| Type | Count | Notes |
|------|-------|-------|
| Injector (Peak & Hold) | 8 | Enough for V8 |
| Ignition (Low Side) | 8 | Enough for V8 COP |
| Half Bridge | 6 | E-throttle + 4 spare |
| Auxiliary (Low Side) | 2 | |
| Analog Voltage | 8 | TPS, MAP, pressures |
| Analog Temperature | 4 | CLT, IAT, oil temp, +1 |
| Universal Digital | 7 | VSS, brake, AC switches |
| Knock | 2 | One per bank |

**When M130 is sufficient:** Basic LS V8 swap with standard sensors. 8 injectors + 8 coils + throttle body + standard sensor suite. This is the K5 Blazer build — M130 fits with headroom on every I/O type except injectors (8/8 exactly).

**When M130 is NOT enough:**
- More than 8 injectors (staged injection)
- More than 8 ignition outputs (10+ cylinder)
- More than 7 digital inputs (add 4 wheel speed sensors → need 11 → exceeds 7)
- Need 2+ CAN buses (external data logging + PDM on separate buses)
- Need more than 8 analog inputs (many pressure/position sensors)

### M150
| | |
|---|---|
| Price | $5,500 (estimated, Motec dealer quote) |
| Connectors | 4: A (34-pin) + B (34-pin) + C (26-pin) + D (26-pin), all Superseal |
| Dimensions | 162 × 127 × 40.5 mm |
| Weight | 445g |
| Logging | 250 MB |
| CAN buses | 3 |
| Source | motec.com.au (scaffold — pin map needs manual validation) |

**I/O:**
| Type | Count | vs M130 |
|------|-------|---------|
| Injector (Peak & Hold) | 12 | +4 (staged injection) |
| Ignition (Low Side) | 12 | +4 |
| Half Bridge | 10 | +4 |
| Analog Voltage | 17 | +9 |
| Analog Temperature | 6 | +2 |
| Universal Digital | 16 | +9 |
| Knock | 2 | same |

**The $2,000 question:** What do you gain for $2,000 more?
- 50% more I/O across every type
- 2 additional CAN buses (telemetry, data logging, separate display bus)
- 4 more injector outputs (staged injection for high-HP builds)
- 9 more digital inputs (wheel speed sensors for traction control, additional switches)
- Double the logging memory
- Larger physical unit (significant in tight engine bays)

### M1 Platform
| | |
|---|---|
| Price | ~$8,000+ |
| I/O | Maximum across all types |
| Use case | Professional motorsport, 10+ cylinder, complex traction/launch control |

The M1 is rarely needed for squarebody builds unless doing something extreme (twin-turbo with staged injection, sequential gearbox with paddle shift).

## PDM Models

### PDM15
| | |
|---|---|
| Price | $2,200 |
| Channels | 15 (8 × 20A + 7 × 8A) |
| Use case | Minimal builds, track cars with few accessories |

### PDM30
| | |
|---|---|
| Price | $3,140 (Desert Performance invoice, verified) |
| Channels | 30 (6 × 20A + 14 × 15A + 10 × 10A) |
| Use case | Full street/show builds with all accessories |

The K5 Blazer uses all 30 channels. This is a fully loaded street build with every accessory.

### Multi-PDM Configurations
| Config | Channels | Price | Use Case |
|--------|----------|-------|----------|
| PDM15 | 15 | $2,200 | Minimal |
| PDM30 | 30 | $3,140 | Full build (K5) |
| 2× PDM15 | 30 | $4,400 | Distributed (front + rear) |
| PDM30 + PDM15 | 45 | $5,340 | Maximum (trailer, extreme accessories) |

Multiple PDMs communicate via CAN bus. The M130 has 1 CAN bus which handles both ECU↔PDM communication and display data. If you need PDMs on separate CAN buses for isolation, you need an M150 with 3 CAN buses.

## LTCD Wideband Controller
| | |
|---|---|
| Price | $844 (Desert Performance invoice) |
| Function | Dual-channel wideband lambda interface |
| Sensors | 2× Bosch LSU 4.9 |
| Connection | CAN bus to ECU + analog outputs |

The LTCD reads the LSU 4.9 sensors (which have 5 wires each and require precise heater control) and provides clean 0-5V analog signals to the ECU. The ECU does NOT drive the wideband sensors directly.

## C125 Display
| | |
|---|---|
| Price | ~$2,500 |
| Connection | CAN bus only (4 wires: power, ground, CAN H, CAN L) |
| Function | All data received via CAN from ECU |
| Alternative | Dakota Digital VHX ($850) with analog outputs from ECU |

If using Dakota Digital instead of C125, the ECU drives the gauges via analog/PWM outputs (speed as pulse, tach as pulse, temp/pressure as analog voltage). No CAN integration needed — Dakota Digital doesn't speak Motec CAN natively.

## Other Components
| Component | Price | Function |
|-----------|-------|----------|
| 8-button keypad | $575 | Input device, CAN-connected |
| Keypad labels (×8) | $5 each | Custom text for buttons |
| RBD 190 battery disconnect | $300 | 190A continuous, software-controlled |
| GT101 speed sensor | $80 each | Hall effect, used for wheel speed or driveshaft |

## Pin Maps in Database

| Device | Pins | Connectors | Status |
|--------|------|------------|--------|
| M130 | 60 | 2 (34+26) | SCAFFOLD — from verified I/O spec, pin assignments estimated |
| M150 | 120 | 4 (34+34+26+26) | SCAFFOLD — from training data, needs Motec manual validation |
| PDM30 | 39 | 1 (67-pin) | SCAFFOLD — channel ratings verified, pin assignments estimated |

**WARNING:** The M150 pin map (120 pins) is the most dangerous scaffold in the system. Pin functions are directionally correct (A1-A8 are injectors) but exact assignments, current ratings, and wire recommendations have NOT been validated against the actual Motec M150 Wiring Manual. Do not use for production harness building until validated.

## CAN Bus Architecture

```
ECU (M130/M150) ←——CAN——→ PDM30 ←——CAN——→ C125/Dakota Digital
                                           ↑
                              120Ω termination at each end
                              Twisted pair: WHT/GRN + GRN/WHT
                              500 kbps
```

M130: 1 CAN bus shared by all devices
M150: Up to 3 CAN buses (separate for engine, body, telemetry)

The CAN bus carries all data between devices. The PDM30 reports channel status, current draw, and fault conditions to the ECU. The display reads all engine data from CAN without separate sensor wires. If using Dakota Digital instead of C125, the CAN bus only connects ECU↔PDM.
