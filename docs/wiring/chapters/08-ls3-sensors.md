# Chapter 8: The LS3 Sensor Suite

Every sensor and actuator on the LS3 engine with verified part numbers, connector types, pin counts, and wiring requirements.

**Source:** ACDelco part catalog, verified against product pages at Summit Racing, ICT Billet, Michigan Motorsports, and Wiring Specialties.

## Sensors

### Crank Position Sensor (CKP)
| | |
|---|---|
| Manufacturer | ACDelco |
| ACDelco PN | **213-4573** |
| GM OEM PN | **12615626** |
| Type | Hall effect, Gen IV 58X reluctor |
| Connector | 3-pin Metri-Pack (gray) |
| Pins | 3 (5V reference, signal, ground) |
| Shielding | REQUIRED — 2-conductor shielded cable |
| Location | Front of block, behind harmonic balancer |
| Price | $15-25 |
| Pigtail | ICT Billet WPCKP40 |

**Critical note:** Gen III LS1/LS6 use ACDelco 213-1557 (24X reluctor, different sensor). NOT compatible with LS3. LS3 is 58X.

### Cam Position Sensor (CMP)
| | |
|---|---|
| ACDelco PN | **213-3826** |
| GM OEM PN | **12591720** |
| Type | Hall effect, Gen IV, timing cover mounted |
| Connector | 3-pin Metri-Pack |
| Pins | 3 (5V reference, signal, ground) |
| Shielding | REQUIRED |
| Location | Front timing cover |
| Price | $20-35 |
| Pigtail | ICT Billet WPCMP30 |

### Knock Sensors (×2)
| | |
|---|---|
| ACDelco PN | **213-1576** |
| GM OEM PN | **12623730** (supersedes 12589867) |
| Type | Flat-response piezoelectric, Gen IV |
| Connector | 2-pin sealed |
| Pins | 2 per sensor (signal + ground) |
| Shielding | REQUIRED |
| Location | Valley of block, under intake manifold |
| Price | $15-25 each |
| Pigtail | ICT Billet WPKN040 |

**Critical note:** LS3 knock sensors are 2-wire flat-response. Gen III LS1 used single-wire resonant sensors with a different connector. Not interchangeable.

### Oil Pressure Sensor
| | |
|---|---|
| ACDelco PN | **D1846A** |
| GM OEM PN | **12673134** (2009+, supersedes 12616646) |
| Type | Resistive pressure transducer |
| Connector | 3-pin oval sealed |
| Pins | 3 (5V ref, signal, ground) |
| Location | Rear of block, above oil filter |
| Price | $40-75 |
| Pigtail | ICT Billet WP0IL40 |

**Connector caution:** Multiple LS oil pressure sensors exist with DIFFERENT connectors. 12673134 (3-wire large round) is correct for LS3 crate engines. Pre-2009 truck sensors have different connectors.

### MAP Sensor (Manifold Absolute Pressure)
| | |
|---|---|
| GM OEM PN | **55573248** (supersedes 12592525) |
| Type | 1-bar MAP, Bosch style, Gen IV |
| Connector | 3-pin Bosch sealed |
| Pins | 3 (5V ref, signal, ground) |
| Location | Intake manifold |
| Price | $25-45 |

**Connector note:** Gen III LS1 used a Delphi-style MAP with different connector. LS3 uses Bosch style. Not pin-compatible.

### Coolant Temperature Sensor (ECT)
| | |
|---|---|
| ACDelco PN | **213-4514** |
| GM OEM PN | **19236568** |
| Type | NTC thermistor |
| Connector | 2-pin Metri-Pack |
| Pins | 2 (signal + ground) |
| Thread | M12 × 1.5 |
| Location | Cylinder head, driver side near thermostat |
| Price | $8-18 |
| Pigtail | ICT Billet WPCTS30 |

This is the ECU sensor. Separate from the gauge sender if keeping factory gauges (dual-sender approach).

### Intake Air Temperature (IAT)
| | |
|---|---|
| GM OEM PN | **25036751** |
| Type | NTC thermistor |
| Connector | 2-pin |
| Pins | 2 (signal + ground) |
| Price | $10-15 |

## Actuators

### Ignition Coils (×8)
| | |
|---|---|
| ACDelco PN | **D510C** |
| GM OEM PN | **12611424** (supersedes 12570616) |
| Type | Coil-near-plug, square flat design |
| Connector | 4-pin push-to-seat |
| Pins | 4 per coil |
| Location | Valve covers (OEM) or relocated with brackets |
| Price | $25-45 each; aftermarket sets of 8 for $80-180 |

**D510C vs D585:** The LS3 uses **D510C** (square/flat). The D585 is Gen III truck (round with heat sink). They are NOT the same part. D585 will not bolt to LS3 valve covers without adapters.

### Fuel Injectors (×8)
| | |
|---|---|
| ACDelco PN | **217-2425** |
| GM OEM PN | **12576341** |
| Type | Port injection, high-impedance |
| Flow rate | 42 lb/hr @ 58 PSI |
| Connector | **EV6 / USCAR** (2-pin) |
| Pins | 2 per injector |
| O-rings | Top: 0.540" blue, Bottom: 0.565" red |
| Price | $30-50 each; $240-400 set of 8 |
| Pigtail | ICT Billet WPINJ40 |

**Connector note:** LS3 uses EV6/USCAR connectors. Earlier Gen III trucks used Multec 2 / Mini Delphi. NOT the same. Adapter pigtails exist.

### Electronic Throttle Body (DBW)
| | |
|---|---|
| GM OEM PN | **12605109** |
| Type | Drive-by-wire, 90mm, 4-bolt |
| Connector | **6-pin** sealed |
| Pins | 6 |
| Price | $150-300 |

**6-pin pinout:**

| Pin | Function | Wire Color |
|-----|----------|-----------|
| A | Motor drive 2 | Brown |
| B | Motor drive 1 | Yellow |
| C | 5V TPS reference (shared) | Dark Green/White |
| D | TPS1 signal (0-5V) | Dark Blue |
| E | Sensor ground (shared) | Purple |
| F | TPS2 signal (5V-0, inverse) | Pink |

**Critical note:** Gen III LS1/LS6 used 8-pin throttle body. LS3 6-pin is NOT pin-compatible with 8-pin harnesses without an adapter.

## Wire Count Summary

| Component | Qty | Pins Each | Total Wires |
|-----------|-----|-----------|-------------|
| Crank position | 1 | 3 | 3 |
| Cam position | 1 | 3 | 3 |
| Knock sensors | 2 | 2 | 4 |
| Ignition coils | 8 | 4 | 32 |
| Fuel injectors | 8 | 2 | 16 |
| Throttle body | 1 | 6 | 6 |
| Coolant temp | 1 | 2 | 2 |
| Oil pressure | 1 | 3 | 3 |
| MAP sensor | 1 | 3 | 3 |
| IAT sensor | 1 | 2 | 2 |
| **Engine total** | | | **74** |

This does not include: O2 sensors (through LTCD), fuel pump, cooling fans, AC compressor, alternator, or starter — those are separate from the engine sensor harness.
