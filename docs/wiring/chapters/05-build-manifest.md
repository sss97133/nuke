# Chapter 5: The Build Manifest

## Every Device Is a Digital Twin

The build manifest is a table where every row is an electrical device on the vehicle. Each device has:

- **Identity:** name, category, manufacturer, model/part number
- **Endpoints:** pin count, signal type, connector type, power draw
- **Sourcing:** price, supplier, sourcing difficulty, purchased status
- **Position:** layer (engine/interior/exterior/frame), x/y percentage coordinates
- **Classification:** pdm_controlled flag, pdm_channel_group, wire gauge recommendation

115 devices on the K5 Blazer. 347 total endpoints. Every device placed on one of four visual layers.

## Signal Type Classification

The signal type determines how a device connects to the electrical system. This classification is CRITICAL — getting it wrong changes which ECU the system recommends.

### ECU-Connected Signal Types
These devices wire directly to ECU pins:
| Signal Type | What It Is | Example | Wire Count |
|------------|-----------|---------|-----------|
| `analog_5v` | 5V reference + signal + ground | MAP sensor, fuel pressure | 3 |
| `analog_temp` | Thermistor signal + ground | Coolant temp, oil temp, IAT | 2 |
| `ecu_digital_input` | Logic-level input to ECU | Brake switch, AC request, VSS | 1-3 |
| `ecu_crank_cam` | Dedicated crank/cam input | Crank sensor, cam sensor | 3 (shielded) |
| `piezoelectric` | Knock sensor | Knock bank 1, bank 2 | 2 (shielded) |
| `wideband_lambda` | O2 sensor via LTCD controller | Bosch LSU 4.9 | 5 (to LTCD) |
| `h_bridge_motor` | ECU-driven H-bridge motor | Electronic throttle body | 2 (motor) + 4 (sensor) |
| `low_side_drive` | ECU low-side output | Injectors, coils | 2 |
| `logic_coil_drive` | ECU coil driver | Ignition coils | 4 |

### PDM-Connected Signal Types
These devices get power from PDM channels:
| Signal Type | What It Is | Example |
|------------|-----------|---------|
| `led_lighting` | LED lights | Headlights, tail lights, markers |
| `motor` (with pdm_controlled=true) | Electric motor | Window motor, wiper motor, fans |
| `audio` | Audio equipment | Radio head unit |
| `controller` | Standalone controller | Transmission ECU, wideband controller |
| `can_display` | CAN-connected display | Motec C125 |
| `power_outlet` | 12V accessory | Cigarette lighter, USB |

### PDM Input Signal Types
These are switches that TELL the PDM what to do:
| Signal Type | What It Is | Example |
|------------|-----------|---------|
| `pdm_input` | Switch → PDM input | Headlight switch, turn signal switch, ignition switch |

### Standalone Signal Types
These don't connect to ECU or PDM — they directly control their loads:
| Signal Type | What It Is | Example |
|------------|-----------|---------|
| `standalone_switch` | Direct load control | Window switches (reversing polarity), lock switches |
| `standalone_module` | Self-contained module | Hazard flasher, AMP Research controller |

### Infrastructure Signal Types
| Signal Type | What It Is | Example |
|------------|-----------|---------|
| `ground` | Ground connection | Star ground point, body ground |
| `power_source` | Power source | Battery, alternator |
| `can_bus` | CAN bus network | Twisted pair backbone |
| `relay` | Relay device | Battery disconnect |
| `alternator` | Charging system | High-output alternator |

## The M130 Discovery

The most important classification lesson from this build:

**Original classification:** All 20 switches were classified as `signal_type = 'switch'`. The compute engine counted them as digital inputs. 20 digital inputs exceeds the M130's 7 — system recommended M150 ($5,500).

**Corrected classification:** Only 4 switches actually connect to ECU digital input pins (brake, AC pressure ×2, VSS). The other 16 are PDM inputs (9), standalone switches (4), standalone modules (1), or dedicated ECU inputs (crank/cam = 2). After correction: 4 digital inputs ≤ M130's 7. **M130 fits. $2,000 saved.**

The lesson: signal type classification directly determines ECU selection. Getting it wrong costs money. The system should validate these classifications — if a device is classified as `switch` (generic), the system should ask: "Is this an ECU input, a PDM input, or a standalone switch?"

## PDM Channel Grouping

Small devices that share a single PDM channel:

| Group | Devices | Total Amps | Why Grouped |
|-------|---------|-----------|-------------|
| `markers_clearance` | 8 (4 side markers + 3 cab clearance + license) | 3.2A | All on same headlight switch position |
| `park_tail` | 4 (2 parking + 2 tail lights) | 6.0A | Same switch position |
| `interior_courtesy` | 5 (dome + footwell + under-dash + underhood + cargo) | 2.5A | All door-triggered |
| `backup` | 4 (2 backup + third brake + camera) | 4.7A | All reverse-triggered |
| `turn_brake_left` | 1 (left front turn) | 2.0A | Independent turn control |
| `turn_brake_right` | 1 (right front turn) | 2.0A | Independent turn control |

Without grouping: 47 PDM loads → exceeds PDM30's 30 channels → overflow warnings.
With grouping: 30 channels used → fits exactly → zero headroom warning.

## Direct-Wired Devices (NOT Through PDM)

| Device | Why Not PDM | Connection |
|--------|-----------|-----------|
| Alternator (220A) | IS the power source | Direct to battery + sense wire |
| Starter (200A peak) | Exceeds any PDM channel | Direct battery + relay trigger |
| Battery disconnect (190A) | IS the master switch | Inline with battery cable |
| Fuel pump (35A) | Exceeds 20A PDM max | Dedicated relay (Aeromotive 16301 kit) |
| Brake booster (40A peak) | Exceeds 20A PDM max | Dedicated relay, integrated ECU |
| Amplifier (30A) | Exceeds 20A PDM max | Direct fused battery wire |
| All sensors | Powered from ECU 5V ref | ECU connector pins |
| Injectors + coils | Powered from PDM rail channels | Individual control from ECU pins |

## Companion Wire Naming Convention (added 2026-05-14)

Signal-type wire counts (analog_5v = 3, analog_temp = 2, low_side_drive = 2, logic_coil_drive = 4) require multiple physical conductors per circuit. The cut list previously enumerated only the *signal* wire and treated companions as implicit. To make terminal counts and routing accurate, companion wires now have explicit IDs.

| Suffix | Role | Example | Wire spec |
|---|---|---|---|
| `g` | Sensor ground return | #110g = CLT ground → M130:B16 | 22 AWG M22759/32 BLK |
| `r` | 5V reference companion | #108r = MAP 5V ref → M130:A02 (SEN_5V_A) | 22 AWG M22759/32 GRY |
| `s` | Shield drain (M27500-style cables) | #99s = CKP shield drain → M130:B15 | 22 AWG bare/BLK |

**SEN_0V pairing rule (from `motec_m1_hardware_techspec.pdf` p17):**

| AT input | Pullup rail | Companion ground (SEN_0V) |
|---|---|---|
| AT1 (B03) | SEN_5V_A | B15 |
| AT2 (B04) | SEN_5V_B | B16 |
| AT3 (B05) | SEN_5V_A | B15 |
| AT4 (B06) | SEN_5V_B | B16 |

Same convention extended to AV inputs by builder choice. The rule keeps each sensor's pullup and ground on the same letter (A or B) to minimize ground-loop voltage offset.

**Bus rails (not parented to a signal wire):**

| Rail ID | Role | Source | Gauge |
|---|---|---|---|
| `#INJ_PWR` | Injector +12V rail (8x daisy-chained at fuel rail via WPINJ40 pigtails) | PDM30 channel TBD | 16 AWG |
| `#COIL_PWR` | Coil +12V rail (DEL-Stributor bracket bus, 8 coils) | PDM30 channel TBD | 14 AWG |
| `#COIL_GND` | Coil ground rail (bracket → engine block ground stud) | Engine block | 14 AWG |

See `K5_cut_list_v2.txt` addendum and `receipts/2026-05-14_amendment-cut-list-companion-wires.md` for the full enumerated list.
