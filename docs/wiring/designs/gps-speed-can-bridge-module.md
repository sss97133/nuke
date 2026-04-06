# NUKE CAN Bridge Module — Design Document

## GPS Speed Sensor + MoTeC CAN-to-Analog Bridge for Dakota Digital VHX

**Revision:** 1.0
**Date:** 2026-04-04
**Vehicle:** 1977 K5 Blazer (VIN CCL187Z210370)
**ECU:** MoTeC M130 (GPR firmware)
**PDM:** MoTeC PDM30
**Gauges:** Dakota Digital VHX-73C-PU

---

## 1. THE PROBLEM

The K5 Blazer build has two data worlds that do not talk to each other:

| World | Protocol | Devices |
|-------|----------|---------|
| Engine Management | CAN bus (500 kbps) | MoTeC M130, PDM30, LTCD wideband |
| Instrument Cluster | Analog (pulses, resistance, voltage) | Dakota Digital VHX-73C-PU |

The MoTeC M130 already knows everything: RPM, vehicle speed, coolant temp, oil pressure, oil temp, fuel pressure, intake temp, throttle position, boost, lambda, battery voltage. It broadcasts all of this on its CAN bus.

The Dakota Digital VHX cluster cannot read CAN. It expects:
- **Speedometer:** Pulsed square wave (configurable 2,000-250,000 PPM, default 16,000 PPM)
- **Tachometer:** Pulsed signal (coil negative or 5V/12V logic)
- **Temperature:** Variable resistance sender (GM 240-33 ohm standard)
- **Oil Pressure:** Variable resistance or 0-5V analog sender
- **Fuel Level:** Variable resistance sender (GM 0-90 ohm standard)
- **Voltmeter:** Direct battery voltage passthrough

### Current Approach: Dual Sender Strategy

The build spec (Appendix D) documents the "dual sender strategy" -- factory gauge senders kept for Dakota Digital, separate MoTeC sensors for the ECU. This means:

- 2 coolant temp senders (one for MoTeC, one for Dakota)
- 2 oil pressure senders (one for MoTeC, one for Dakota)
- Separate speed signal path
- Extra wiring, extra failure points, extra hole-drilling in the engine

### Dakota Digital's Solution: Expensive Black Boxes

| Device | Price | Function |
|--------|-------|----------|
| GPS-50-2 | $220 | GPS speed signal, outputs selectable PPM square/sine wave |
| SGI-100BT | $250 | Speed/tach signal calibrator and splitter |
| BIM modules | $50-100 each | Various proprietary bus interface modules |

Total cost for speed + tach signal conditioning: $250-470, and you still need dual senders for temp/oil/fuel.

### The Real Solution: CAN-to-Analog Bridge

One module that reads the MoTeC CAN bus and converts every signal to the format Dakota Digital expects. **Eliminate all duplicate senders. One sensor per measurement. MoTeC reads it, the bridge converts it, Dakota displays it.**

---

## 2. WHAT THE DAKOTA DIGITAL VHX EXPECTS

### 2.1 Speedometer Input

The VHX speedometer reads a pulsed signal on the SPD SND input.

| Parameter | Specification |
|-----------|---------------|
| Signal type | Square wave (preferred) or sine wave |
| Default PPM | 16,000 pulses per mile |
| Configurable range | 2,000 -- 250,000 PPM |
| Voltage levels | 0-5V logic (pulled up internally) or 0-12V |
| Wiring | SPD SND (signal), SPD - (ground) |
| Sensor compatibility | 2-wire pulse generator, 3-wire Hall effect (SEN-01-5) |

The GPS-50-2 outputs selectable 4K, 8K, or 16K PPM square wave by default, with 54,400 or 128K PPM modes available for ECM applications. Speed data updates 10 times per second.

**Our module output:** 16,000 PPM square wave, 0-5V, frequency proportional to speed.

Calculation at 60 mph:
- 16,000 pulses/mile at 60 mph = 16,000 pulses/min = 266.67 Hz
- At 100 mph = 444.44 Hz
- At 1 mph = 4.44 Hz

The pulse frequency is linear: `f(Hz) = (PPM * mph) / (60 * 5280 / 5280)` simplified to `f(Hz) = PPM * mph / 60`.

Actually more precisely: `f(Hz) = (speed_mph * PPM) / 3600` since PPM is pulses per mile and we want Hz (pulses per second), and speed in mph means miles per hour, so pulses/sec = (miles/hour * pulses/mile) / 3600.

Wait -- let's be precise:
- PPM = 16,000 pulses per mile
- Speed = 60 mph = 1 mile per minute
- Pulses per minute = 16,000
- Pulses per second = 16,000 / 60 = 266.67 Hz

**Formula: `f(Hz) = (speed_mph * PPM) / 3600`**

| Speed (mph) | Frequency at 16K PPM |
|-------------|---------------------|
| 1 | 4.44 Hz |
| 10 | 44.44 Hz |
| 30 | 133.33 Hz |
| 60 | 266.67 Hz |
| 80 | 355.56 Hz |
| 100 | 444.44 Hz |
| 120 | 533.33 Hz |
| 150 | 666.67 Hz |

This is well within timer/PWM capability of any microcontroller.

### 2.2 Tachometer Input

The VHX tachometer reads a pulsed signal, typically from the coil negative terminal or a dedicated tach output.

| Parameter | Specification |
|-----------|---------------|
| Signal type | Pulsed (square wave or coil-negative pulse) |
| Cylinder settings | 1-16 cylinders configurable |
| Voltage | 5V or 12V signal type (configurable via SGI-100BT) |
| Pulses per revolution | Depends on cylinder count and ignition type |

For an LS3 V8 with coil-on-plug (waste spark or sequential):
- 8 cylinders, 4-stroke = 4 ignition events per revolution (if waste spark) or 4 events per 2 revolutions (sequential)
- The tach expects 1 pulse per ignition event
- Standard V8: 4 pulses per revolution (360 degrees)

**From CAN data:** MoTeC reports Engine Speed in RPM. We generate a pulse train.

Formula: `f(Hz) = (RPM * pulses_per_rev) / 60`

For V8 with 4 pulses/rev:
- Idle (800 RPM): 800 * 4 / 60 = 53.33 Hz
- Cruise (2000 RPM): 133.33 Hz
- Redline (6500 RPM): 433.33 Hz

**Our module output:** 0-5V square wave, frequency proportional to RPM, 50% duty cycle.

### 2.3 Temperature Gauge (Coolant)

The VHX temperature gauge reads a variable resistance sender. The standard configuration for a 73-87 C/K truck uses:

| Sender Type | Empty/Cold (ohms) | Full/Hot (ohms) | Notes |
|-------------|-------------------|-----------------|-------|
| GM 240-33 | 240 (cold) | 33 (hot) | Standard GM, used in C/K trucks |
| GM 73-10 | 73 (cold) | 10 (hot) | Some GM applications |
| Custom | Programmable | Programmable | VHX supports custom calibration |

The VHX reads resistance between the sender terminal and ground. The gauge's internal circuitry applies a small excitation current and measures the resulting voltage drop.

**Our module output:** A digitally-controlled resistance that varies from ~240 ohms (cold) to ~33 ohms (hot) proportional to the coolant temperature reported on CAN.

Implementation: Digital potentiometer (X9C104 = 0-100K ohm, 100 steps) in series with a fixed resistor network to map the 33-240 ohm range.

### 2.4 Oil Pressure Gauge

Two options depending on what sender the VHX is configured for:

| Option | Type | Range |
|--------|------|-------|
| GM resistance sender | Variable resistance | ~10 ohm (0 psi) to ~184 ohm (80 psi) |
| Dakota Digital SEN-03-8 | 0-5V analog | 0.5V (0 psi) to 4.5V (100 psi) |

If using the SEN-03-8 analog input mode, a DAC output is simpler and more accurate.

**Our module output:** 0-5V analog voltage (DAC) proportional to oil pressure from CAN. This requires configuring the VHX to read the Dakota Digital SEN-03-8 sender type.

### 2.5 Fuel Level Gauge

| Sender Type | Empty (ohms) | Full (ohms) |
|-------------|-------------|-------------|
| GM 0-90 | ~0-5 (empty) | ~90-97 (full) |
| GM 0-30 | ~0-5 (empty) | ~30 (full) |
| GM 240-33 | ~240 (empty) | ~33 (full) |
| Ford 10-150 | ~10 (empty) | ~150 (full) |

The K5 will use GM 0-90 (standard for this era).

**Important:** The fuel level sender is a physical float in the tank. The MoTeC does not typically read fuel level -- it has no fuel level input on the M130. This signal stays as a direct physical sender to the VHX. No bridge needed for fuel level.

### 2.6 Voltmeter

Direct battery voltage passthrough. The VHX reads system voltage directly -- no sender, no conversion. The VHX voltmeter connects straight to switched 12V. No bridge needed.

### Summary: What the Bridge Must Output

| Gauge | Signal Type | Source | Bridge Output |
|-------|-------------|--------|---------------|
| Speedometer | Pulsed square wave (16K PPM) | CAN: Vehicle Speed | Timer-generated pulse train |
| Tachometer | Pulsed square wave | CAN: Engine Speed (RPM) | Timer-generated pulse train |
| Coolant Temp | Variable resistance (240-33 ohm) | CAN: Engine Coolant Temp | Digital potentiometer |
| Oil Pressure | 0-5V analog | CAN: Oil Pressure | DAC output |
| Fuel Level | Variable resistance (0-90 ohm) | Physical sender (tank float) | NOT BRIDGED -- direct wire |
| Voltmeter | Direct voltage | Battery | NOT BRIDGED -- direct wire |

**The bridge handles 4 of 6 gauge signals.** Fuel level and voltmeter remain direct physical connections.

---

## 3. MOTEC M130 CAN PROTOCOL

### 3.1 CAN Bus Architecture (K5 Build)

```
MoTeC M130 ──── CAN H/L (500 kbps) ──── MoTeC PDM30
                         │
                    120 ohm termination
                    at each end
                         │
                  ┌──────┴──────┐
                  │  NUKE CAN   │
                  │   Bridge    │
                  │  Module     │
                  └─────────────┘
                  (passive listener,
                   no termination)
```

The bridge module taps the existing CAN bus between the M130 and PDM30 as a **passive listener only**. It does not transmit on the bus. It does not require CAN termination (the M130 and PDM30 already terminate both ends).

### 3.2 M1 CAN Transmit Stream

The MoTeC M130 with GPR firmware broadcasts engine data on its CAN bus using configurable transmit templates. The M1 platform supports over 200 transmittable channels.

**CAN Configuration in M1 Tune (i-Series software):**

The M130 CAN transmit is configured using "Generic Dash" templates or custom transmit messages. The standard approach:

1. In M1 Tune, navigate to **CAN > Transmit**
2. Add transmit messages with configurable:
   - **Message ID** (11-bit standard format, hex)
   - **Transmit rate** (10-100 Hz typical, 25 Hz recommended for gauges)
   - **Data format:** Fixed binary, normal alignment
   - **Channel packing:** 2 bytes per channel, offset increments of 2

**Recommended CAN transmit configuration for the bridge:**

We define 2 CAN messages, each carrying 4 channels (8 bytes = full CAN frame):

#### Message 1: ID 0x640 -- Primary Gauge Data
| Byte Offset | Length | Channel | Units | Scale |
|-------------|--------|---------|-------|-------|
| 0-1 | 2 bytes | Engine Speed (RPM) | RPM | 1 RPM/bit |
| 2-3 | 2 bytes | Vehicle Speed | km/h | 0.1 km/h per bit |
| 4-5 | 2 bytes | Engine Coolant Temp | degC | 0.1 degC/bit, signed |
| 6-7 | 2 bytes | Engine Oil Pressure | kPa | 1 kPa/bit |

#### Message 2: ID 0x641 -- Secondary Data
| Byte Offset | Length | Channel | Units | Scale |
|-------------|--------|---------|-------|-------|
| 0-1 | 2 bytes | Engine Oil Temp | degC | 0.1 degC/bit, signed |
| 2-3 | 2 bytes | Inlet Manifold Pressure (MAP) | kPa | 0.1 kPa/bit |
| 4-5 | 2 bytes | Throttle Position | % | 0.1%/bit |
| 6-7 | 2 bytes | Battery Voltage | V | 0.01 V/bit |

#### Message 3: ID 0x642 -- Extended Data
| Byte Offset | Length | Channel | Units | Scale |
|-------------|--------|---------|-------|-------|
| 0-1 | 2 bytes | Lambda 1 | ratio | 0.001/bit |
| 2-3 | 2 bytes | Lambda 2 | ratio | 0.001/bit |
| 4-5 | 2 bytes | Fuel Pressure | kPa | 1 kPa/bit |
| 6-7 | 2 bytes | Ignition Timing | deg | 0.1 deg/bit, signed |

**Data encoding:** All values are unsigned 16-bit integers unless noted as signed (signed = two's complement int16). The scale factor converts the raw integer to engineering units.

Example: RPM = 3000 is transmitted as bytes `0x0B 0xB8` (3000 in big-endian) at offset 0-1 of message 0x640.

Example: Coolant Temp = 95.3 degC is transmitted as `0x03 0xB9` (953 in big-endian, since 953 * 0.1 = 95.3) at offset 4-5 of message 0x640.

**Transmit rate:** 25 Hz (40 ms period) for all messages. This is more than sufficient for gauge display (human perception limit is ~10 Hz).

### 3.3 M1 Tune Configuration Steps

In MoTeC M1 Tune software:

1. Open the project workspace for the K5 M130
2. Navigate to **Outputs > CAN > CAN Transmit**
3. Add **Transmit Group 1:**
   - Address: 0x640 (1600 decimal)
   - Address Type: Standard (11-bit)
   - Rate: 25 Hz
   - Format: Fixed Binary
   - Alignment: Normal (big-endian)
4. Add channels to the group:
   - Channel 0: "Engine Speed" -- Offset 0, Length 2, Scale 1.0
   - Channel 1: "Vehicle Speed" -- Offset 2, Length 2, Scale 10.0 (multiply by 10 to get 0.1 resolution)
   - Channel 2: "Engine Coolant Temperature" -- Offset 4, Length 2, Scale 10.0, Signed
   - Channel 3: "Engine Oil Pressure" -- Offset 6, Length 2, Scale 1.0
5. Repeat for messages 0x641 and 0x642

**Note:** The M130 has 1 CAN bus shared with the PDM30. The bridge reads these same messages. The PDM30 uses its own message IDs (documented in PDM30 Appendix 2) which do not conflict with the 0x640-0x642 range.

### 3.4 Alternative: Read Existing CAN Traffic

If the M130 is already configured to transmit data to the PDM30 or a hypothetical C125 display, those existing messages can be decoded instead of adding new ones. The M1 "Generic Dash" template `M1_General_0x640_Version 5` and `M1_General_0x6A0_Version 1` are pre-built templates that may already be active.

The bridge firmware should be written to accept configurable CAN message IDs and byte offsets, so it can be adapted to whatever CAN layout is actually configured on the M130.

---

## 4. HARDWARE DESIGN

### 4.1 Microcontroller Selection: ESP32-S3

| Candidate | CAN | GPS | DAC | WiFi/BLE | Price | Verdict |
|-----------|-----|-----|-----|----------|-------|---------|
| Arduino Nano | No | No | No | No | $5 | Needs too many external ICs |
| Teensy 4.1 | Yes (FlexCAN) | No | 2x 12-bit | No | $30 | Excellent, but no wireless config |
| STM32F405 | Yes (bxCAN) | No | 2x 12-bit | No | $12 | Great HW, painful toolchain |
| ESP32 (original) | Yes (TWAI) | No | 2x 8-bit | WiFi+BLE | $5 | Good, but 8-bit DAC too coarse |
| **ESP32-S3** | **Yes (TWAI)** | **No** | **No internal DAC** | **WiFi+BLE** | **$7** | **Winner: CAN + WiFi + BLE config** |

**Selected: ESP32-S3-WROOM-1 (N16R8)**

Rationale:
- **Built-in TWAI controller** (CAN 2.0B compatible) -- no MCP2515 needed
- **WiFi + BLE** for configuration interface (phone app, web UI)
- **Multiple hardware timers** for pulse generation (speed + tach)
- **I2C and SPI** for external DAC and digital potentiometers
- **16 MB flash, 8 MB PSRAM** -- plenty for firmware + config storage
- **$7 for the module** on a dev board, $3 for bare module in production
- **Arduino framework support** via ESP-IDF or Arduino Core

The ESP32-S3 lacks an internal DAC (unlike the original ESP32), but we use an external MCP4728 quad DAC which gives us 12-bit resolution (4096 steps) versus the original ESP32's 8-bit (256 steps). This is actually better for gauge accuracy.

### 4.2 GPS Module: u-blox NEO-M9N

| Module | Constellations | Update Rate | Accuracy | Price | Status |
|--------|---------------|-------------|----------|-------|--------|
| NEO-6M | GPS only | 5 Hz max | 2.5m CEP | $4 | End of life, fakes common |
| NEO-M8N | GPS+GLONASS | 10 Hz max | 2.5m CEP | $8 | Mature, widely available |
| **NEO-M9N** | **GPS+GLONASS+BeiDou+Galileo** | **25 Hz** | **1.5m CEP** | **$18** | **Current gen, best accuracy** |

**Selected: u-blox NEO-M9N**

Rationale:
- **25 Hz update rate** (vs GPS-50-2's 10 Hz) -- smoother speed display
- **4 constellation tracking** simultaneously -- faster lock, better coverage
- **1.5m CEP accuracy** -- tighter speed measurement
- **UBX binary protocol** -- more efficient than NMEA, direct speed output (no position-to-speed conversion needed)
- **Velocity accuracy: 0.05 m/s** -- that is 0.11 mph, far more accurate than any mechanical speedometer

The NEO-M9N is connected via UART to the ESP32-S3. Use UBX protocol (not NMEA) for direct velocity reporting via the UBX-NAV-PVT message.

### 4.3 CAN Transceiver: SN65HVD230

The ESP32-S3 has a built-in TWAI (CAN) controller but needs an external transceiver to interface with the physical CAN bus.

| Transceiver | Voltage | Speed | Package | Price |
|-------------|---------|-------|---------|-------|
| MCP2551 | 5V | 1 Mbps | DIP-8 | $1.50 |
| TJA1050 | 5V | 1 Mbps | SO-8 | $1.00 |
| **SN65HVD230** | **3.3V** | **1 Mbps** | **SO-8** | **$1.50** |

**Selected: SN65HVD230 (3.3V)**

The SN65HVD230 operates at 3.3V logic level, matching the ESP32-S3 directly without level shifters. It supports the MoTeC CAN bus at 500 kbps.

### 4.4 DAC: MCP4728 (Quad 12-bit I2C DAC)

For generating analog voltage outputs (oil pressure, plus spares).

| DAC | Channels | Resolution | Interface | Vref | Price |
|-----|----------|------------|-----------|------|-------|
| MCP4725 | 1 | 12-bit | I2C | Internal 2.048V or VDD | $3 |
| **MCP4728** | **4** | **12-bit** | **I2C** | **Internal 2.048V or VDD** | **$5** |

**Selected: MCP4728** (Adafruit breakout #4470, or bare IC for production)

- 4 channels of 12-bit DAC (4096 steps)
- With VDD reference at 5V: 0-5V output range, 1.22 mV resolution
- With internal 2.048V reference at 2x gain: 0-4.096V output range, 1.0 mV resolution
- I2C interface (2 wires shared with other I2C devices)
- **EEPROM** stores last settings -- survives power loss

Channel assignments:
| DAC Channel | Function | Range |
|-------------|----------|-------|
| A | Oil Pressure (0-5V, simulating SEN-03-8) | 0.5V (0 psi) to 4.5V (100 psi) |
| B | Coolant Temp (0-5V, alternative to digipot) | 0-5V mapped to temp range |
| C | Spare (oil temp, boost, etc.) | 0-5V |
| D | Spare | 0-5V |

**Note on coolant temp:** If the VHX is configured for a resistance sender (240-33 ohm), a DAC voltage output does not work directly. Options:

1. **Digital potentiometer** (X9C104) to simulate resistance -- more complex but matches the VHX's native expectation
2. **Reconfigure VHX** to read Dakota Digital's SEN-01-4 temperature sender (0-5V analog) -- simpler, but requires changing the VHX calibration
3. **Voltage-to-resistance circuit** using an op-amp and MOSFET to create a voltage-controlled resistance

**Recommended approach for temperature:** Use the MCP4728 DAC and configure the VHX for Dakota Digital's analog temperature sender mode. This eliminates the digital potentiometer complexity entirely. The VHX manual documents how to change the temperature sender type in its calibration menu.

### 4.5 Digital Potentiometer (Optional, if resistance simulation is required)

If the VHX must use a resistance-type sender input (because reconfiguration is not possible or because we want drop-in compatibility):

| Device | Resistance | Steps | Interface | Price |
|--------|-----------|-------|-----------|-------|
| X9C104 | 0-100K ohm | 100 | 3-wire (CS, U/D, INC) | $2 |
| MCP41010 | 0-10K ohm | 256 | SPI | $2 |
| **AD5206** | **6x 0-10K ohm** | **256 each** | **SPI** | **$8** |

For 240-33 ohm range (coolant temp):
- Use X9C104 (100K) with a parallel fixed resistor to bring the range down
- Or use MCP41010 (10K) with a resistor divider network

The resistance calculation:
- Cold (240 ohm): digipot set to ~240 ohm
- Hot (33 ohm): digipot set to ~33 ohm
- MCP41010 at 10K / 256 steps = 39 ohm per step -- resolution is too coarse for 33-240 range
- Better: Use two MCP41010s in series (one for coarse, one for fine) or use the X9C104 with external resistor shaping

**For this build, we recommend the DAC approach with VHX reconfiguration.** The resistance simulation path is documented here for completeness but adds unnecessary complexity.

### 4.6 Power Supply

The vehicle electrical system is 12V nominal (13.8-14.4V running, 9-16V range with cranking dips and load dump spikes).

| Regulator | Input | Output | Current | Package | Price |
|-----------|-------|--------|---------|---------|-------|
| **LM2596** | 4.5-40V | 5V fixed | 3A | TO-263/module | $1.50 |
| **AMS1117-3.3** | 4.75-12V | 3.3V fixed | 1A | SOT-223 | $0.30 |

**Power chain:**
```
Vehicle 12V ─── LM2596 (buck) ──→ 5V rail ─── AMS1117-3.3 ──→ 3.3V rail
     │                               │                            │
     │                          MCP4728 DAC (5V)           ESP32-S3 (3.3V)
     │                          SN65HVD230 (3.3V)         NEO-M9N GPS (3.3V)
     │
     └── TVS diode (SMBJ18CA) for transient protection
         Reverse polarity protection (IRLZ44N P-FET or SS54 Schottky)
```

**Protection:**
- **TVS diode** (SMBJ18CA, 18V standoff, 600W peak): Clamps load dump transients (up to 100V)
- **Reverse polarity**: P-channel MOSFET (IRLZ44N) or Schottky diode (SS54)
- **Input filter**: 100uF electrolytic + 100nF ceramic at input
- **Each rail**: 10uF + 100nF ceramic decoupling

Total module current draw: ~250 mA at 5V (ESP32-S3 ~200mA typical, GPS ~30mA, DAC/misc ~20mA).

### 4.7 Output Stage: Pulse Outputs (Speed + Tach)

The ESP32-S3 generates speed and tach pulses using hardware timers (LEDC or MCPWM peripheral).

**Speed output circuit:**
```
ESP32 GPIO (3.3V) ──→ 74HC14 Schmitt trigger buffer ──→ SPD SND (Dakota Digital)
                         │
                      Pull-up to 5V via 4.7K
```

The 74HC14 serves two purposes:
1. Level shifts 3.3V ESP32 output to 5V logic (VHX expects 5V)
2. Provides clean edge transitions (Schmitt trigger hysteresis)

**Tach output circuit:** Same as speed -- dedicated 74HC14 channel.

Alternatively, use an N-channel MOSFET (2N7000) as an open-drain output with a pull-up to 12V for direct coil-negative emulation:

```
ESP32 GPIO ──→ 2N7000 gate ──→ drain ──┬── 4.7K pull-up to 12V
                                        │
                               TACH output to VHX
                    2N7000 source ──→ GND
```

**Recommended: Use the 74HC14 buffer for both speed and tach.** The VHX accepts 5V logic signals on both inputs. 12V emulation is only needed if driving an older factory tach directly.

### 4.8 Connector and Pinout

**Module connector:** Deutsch DTM-12 (12-pin, IP67 waterproof, standard in motorsport wiring)

| Pin | Function | Wire Color | Notes |
|-----|----------|------------|-------|
| 1 | +12V Supply (switched ignition) | RED | Fused at 2A |
| 2 | Ground (chassis) | BLACK | Star ground at module |
| 3 | CAN High | WHITE/GREEN | MoTeC CAN bus tap |
| 4 | CAN Low | GREEN/WHITE | MoTeC CAN bus tap |
| 5 | Speed Output (pulse) | PURPLE | To VHX SPD SND |
| 6 | Speed Output Ground | PURPLE/BLACK | To VHX SPD - |
| 7 | Tach Output (pulse) | GRAY | To VHX tach input |
| 8 | Tach Output Ground | GRAY/BLACK | To VHX tach ground |
| 9 | Oil Pressure Analog (0-5V) | BLUE | To VHX oil sender input |
| 10 | Coolant Temp Analog (0-5V) | GREEN | To VHX temp sender input |
| 11 | Analog Ground (sensor return) | BLACK/WHITE | Shared analog ground |
| 12 | GPS Antenna (SMA pigtail) | -- | External GPS antenna |

Pin 12 is a pigtail to an SMA connector for the GPS antenna. The NEO-M9N breakout board typically has a U.FL connector; use a U.FL-to-SMA pigtail routed through the enclosure.

### 4.9 Physical Size

| Dimension | Estimate |
|-----------|----------|
| PCB | 80mm x 50mm (3.1" x 2.0") |
| Enclosure | 100mm x 70mm x 35mm (3.9" x 2.8" x 1.4") |
| Material | Aluminum or 3D-printed ASA (underhood rated) |
| Mounting | 2x M4 mounting tabs |
| Weight | ~120g with enclosure |

For comparison, the Dakota Digital GPS-50-2 is approximately 4" x 2.5" x 1" -- our module is roughly the same size.

**Mounting location:** Inside the cab, behind the dash. The GPS antenna can be mounted on the dash top or windshield (GPS signals do not penetrate metal roofs, but the K5 Blazer has a removable fiberglass top which is transparent to GPS).

---

## 5. BILL OF MATERIALS

### 5.1 Core Components

| Qty | Part | Description | Source | Unit Price | Extended |
|-----|------|-------------|--------|------------|----------|
| 1 | ESP32-S3-DevKitC-1 (N16R8) | MCU dev board (prototyping) | Espressif/Amazon | $10.00 | $10.00 |
| 1 | u-blox NEO-M9N breakout | GPS module with antenna connector | SparkFun GPS-15733 | $50.00 | $50.00 |
| 1 | GPS antenna (active, SMA) | 28dB gain, magnetic mount or adhesive | Amazon | $12.00 | $12.00 |
| 1 | SN65HVD230 breakout | 3.3V CAN transceiver | Amazon/eBay | $3.00 | $3.00 |
| 1 | MCP4728 breakout | Quad 12-bit DAC, I2C | Adafruit #4470 | $5.00 | $5.00 |
| 1 | 74HC14 | Hex Schmitt trigger inverter (DIP-14) | DigiKey | $0.50 | $0.50 |
| 1 | LM2596 module | 12V-to-5V buck converter, 3A | Amazon | $2.00 | $2.00 |
| 1 | AMS1117-3.3 | 5V-to-3.3V LDO regulator | Amazon | $0.30 | $0.30 |
| 1 | SMBJ18CA | TVS diode, 18V standoff, bidirectional | DigiKey | $0.50 | $0.50 |
| 1 | SS54 | 5A Schottky diode (reverse polarity protection) | DigiKey | $0.30 | $0.30 |

### 5.2 Passive Components

| Qty | Part | Value | Price |
|-----|------|-------|-------|
| 5 | Ceramic capacitor | 100nF (0.1uF) | $0.50 |
| 3 | Electrolytic capacitor | 100uF/25V | $0.50 |
| 2 | Resistor | 4.7K ohm (pull-ups) | $0.10 |
| 2 | Resistor | 120 ohm (CAN term -- NOT installed, just on-board option) | $0.10 |
| 2 | 2N7000 | N-channel MOSFET (optional tach output) | $0.20 |

### 5.3 Connectors and Enclosure

| Qty | Part | Description | Price |
|-----|------|-------------|-------|
| 1 | Deutsch DTM-12P | 12-pin receptacle (module side) | $8.00 |
| 1 | Deutsch DTM-12S | 12-pin plug (harness side) | $8.00 |
| 24 | Deutsch DTM pins/sockets | Contacts for both halves | $6.00 |
| 1 | SMA bulkhead connector | For GPS antenna pass-through | $3.00 |
| 1 | U.FL to SMA pigtail | Internal antenna cable, 15cm | $3.00 |
| 1 | Aluminum enclosure | Hammond 1590B or similar, drilled | $12.00 |
| 1 | Proto PCB or custom PCB | 80x50mm, double-sided | $5.00 |

### 5.4 Cost Summary

| Category | Cost |
|----------|------|
| Core electronics | $83.60 |
| Passive components | $1.40 |
| Connectors and enclosure | $45.00 |
| **Total BOM** | **$130.00** |

### 5.5 Production Version (Custom PCB)

For a custom-designed PCB (not using breakout boards):

| Part | Description | Price |
|------|-------------|-------|
| ESP32-S3-WROOM-1 (N16R8) | Bare module, soldered to PCB | $3.50 |
| NEO-M9N bare module | Castellated, reflow soldered | $18.00 |
| SN65HVD230D | SO-8 package | $1.50 |
| MCP4728-E/UN | MSOP-10 package | $3.00 |
| SN74HC14D | SO-14 package | $0.40 |
| TPS54331 | Integrated buck regulator, SO-8 | $1.50 |
| AMS1117-3.3 | SOT-223 | $0.30 |
| PCB fabrication | 4-layer, 80x50mm, JLCPCB 5pcs | $8.00 |
| Passives, connectors, enclosure | All SMD | $30.00 |
| **Production BOM** | | **~$66.00** |

---

## 6. SOFTWARE ARCHITECTURE

### 6.1 Overview

```
┌─────────────────────────────────────────────────────────┐
│                    NUKE CAN Bridge Firmware              │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌───────────────────────┐ │
│  │  GPS     │  │  CAN      │  │  Output Generator     │ │
│  │  Task    │  │  Reader   │  │                       │ │
│  │          │  │  Task     │  │  Speed Pulse (Timer)  │ │
│  │ NEO-M9N  │  │           │  │  Tach Pulse  (Timer)  │ │
│  │ UART     │  │  TWAI     │  │  DAC Voltage (I2C)    │ │
│  │ UBX      │  │  500kbps  │  │  Digipot Ohm (SPI)   │ │
│  └────┬─────┘  └─────┬─────┘  └──────────┬────────────┘ │
│       │              │                    │              │
│       ▼              ▼                    ▲              │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Shared Data Store (FreeRTOS)         │  │
│  │                                                    │  │
│  │  vehicle_speed_kph  (float, from CAN or GPS)      │  │
│  │  engine_rpm         (uint16, from CAN)            │  │
│  │  coolant_temp_c     (float, from CAN)             │  │
│  │  oil_pressure_kpa   (uint16, from CAN)            │  │
│  │  oil_temp_c         (float, from CAN)             │  │
│  │  battery_voltage    (float, from CAN)             │  │
│  │  map_kpa            (float, from CAN)             │  │
│  │  gps_speed_kph      (float, from GPS)             │  │
│  │  gps_heading        (float, from GPS)             │  │
│  │  gps_fix_quality    (uint8, from GPS)             │  │
│  │  can_alive          (bool, heartbeat)             │  │
│  │  source_priority    (enum: CAN_PRIMARY | GPS_PRIMARY) │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────┐  ┌───────────┐                            │
│  │  Config  │  │  BLE/WiFi │                            │
│  │  NVS     │  │  Config   │                            │
│  │  Store   │  │  Server   │                            │
│  └──────────┘  └───────────┘                            │
└─────────────────────────────────────────────────────────┘
```

The firmware runs on ESP-IDF FreeRTOS with 4 main tasks:

### 6.2 Task 1: GPS Reader (Core 0)

```
Priority: 3
Stack: 4096 bytes
Rate: 25 Hz (driven by GPS module output)
```

**UBX Protocol Configuration:**

On startup, configure the NEO-M9N via UBX commands:

1. **UBX-CFG-PRT**: Set UART1 to 115200 baud
2. **UBX-CFG-MSG**: Disable all NMEA sentences (we only want UBX binary)
3. **UBX-CFG-MSG**: Enable UBX-NAV-PVT at 25 Hz
4. **UBX-CFG-RATE**: Set measurement rate to 40 ms (25 Hz)
5. **UBX-CFG-NAV5**: Set dynamic model to "Automotive" (model 4)

**UBX-NAV-PVT Message (key fields):**

| Offset | Length | Name | Units |
|--------|--------|------|-------|
| 0 | 4 | iTOW | ms (GPS time of week) |
| 20 | 1 | fixType | 0=none, 2=2D, 3=3D |
| 21 | 1 | flags | bit0=gnssFixOK |
| 60 | 4 | gSpeed | mm/s (ground speed) |
| 64 | 4 | headMot | deg * 1e-5 (heading of motion) |
| 72 | 4 | sAcc | mm/s (speed accuracy estimate) |

**Speed extraction:**
```c
float gps_speed_mps = (float)pvt.gSpeed / 1000.0f;  // mm/s to m/s
float gps_speed_kph = gps_speed_mps * 3.6f;
float gps_speed_mph = gps_speed_mps * 2.23694f;
```

**GPS is the fallback source.** When CAN data is available and fresh (received within last 500ms), CAN speed is used. When CAN is stale or absent, GPS speed is used. This means the module works standalone (GPS-only mode, like the GPS-50-2) or as a CAN bridge.

### 6.3 Task 2: CAN Reader (Core 1)

```
Priority: 4 (highest -- CAN frames must not be dropped)
Stack: 4096 bytes
Rate: Event-driven (interrupt on CAN frame receive)
```

**TWAI Configuration:**
```c
twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
    GPIO_NUM_17,  // TX pin (unused -- listen only)
    GPIO_NUM_18,  // RX pin
    TWAI_MODE_LISTEN_ONLY  // Passive listener, no TX, no ACK
);
twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
twai_filter_config_t f_config = {
    .acceptance_code = 0x640 << 21,     // Filter for 0x640-0x642
    .acceptance_mask = 0xFFFFFFFC << 21, // Accept 0x640, 0x641, 0x642
    .single_filter = true
};
```

**Listen-only mode** is critical. The bridge never transmits on the CAN bus. It never sends ACK bits. This means it cannot disrupt MoTeC-PDM communication even if the firmware crashes.

**Frame parsing (message 0x640 example):**
```c
void parse_gauge_data(twai_message_t *msg) {
    if (msg->identifier == 0x640) {
        uint16_t rpm_raw     = (msg->data[0] << 8) | msg->data[1];
        uint16_t speed_raw   = (msg->data[2] << 8) | msg->data[3];
        int16_t  coolant_raw = (msg->data[4] << 8) | msg->data[5];
        uint16_t oil_p_raw   = (msg->data[6] << 8) | msg->data[7];

        shared_data.engine_rpm       = rpm_raw;           // RPM direct
        shared_data.vehicle_speed_kph = speed_raw * 0.1f; // 0.1 km/h per bit
        shared_data.coolant_temp_c   = coolant_raw * 0.1f; // 0.1 degC per bit
        shared_data.oil_pressure_kpa = oil_p_raw;          // 1 kPa per bit
        shared_data.can_last_rx_ms   = millis();
        shared_data.can_alive        = true;
    }
}
```

### 6.4 Task 3: Output Generator (Core 1)

```
Priority: 2
Stack: 4096 bytes
Rate: 50 Hz update loop (20ms period)
```

**Speed Pulse Generation:**

Use the ESP32-S3 LEDC (LED Control) peripheral, which is a hardware PWM generator with frequency and duty cycle control.

```c
// Configure LEDC for speed output
ledc_timer_config_t speed_timer = {
    .speed_mode = LEDC_LOW_SPEED_MODE,
    .duty_resolution = LEDC_TIMER_1_BIT,  // 50% duty only
    .timer_num = LEDC_TIMER_0,
    .freq_hz = 267,  // Updated dynamically
    .clk_cfg = LEDC_AUTO_CLK
};

ledc_channel_config_t speed_channel = {
    .gpio_num = GPIO_NUM_4,
    .speed_mode = LEDC_LOW_SPEED_MODE,
    .channel = LEDC_CHANNEL_0,
    .timer_sel = LEDC_TIMER_0,
    .duty = 1,  // 50% duty for 1-bit resolution
    .hpoint = 0
};
```

**Update loop:**
```c
void output_task(void *pvParameters) {
    while (1) {
        // Determine speed source
        float speed_kph;
        if (shared_data.can_alive &&
            (millis() - shared_data.can_last_rx_ms) < 500) {
            speed_kph = shared_data.vehicle_speed_kph;  // CAN primary
        } else {
            speed_kph = shared_data.gps_speed_kph;      // GPS fallback
        }

        float speed_mph = speed_kph * 0.621371f;

        // Speed pulse: f(Hz) = speed_mph * PPM / 3600
        uint32_t speed_freq = (uint32_t)(speed_mph * config.speed_ppm / 3600.0f);
        if (speed_freq < 1) speed_freq = 0;  // Stop pulses at 0 mph
        if (speed_freq > 0) {
            ledc_set_freq(LEDC_LOW_SPEED_MODE, LEDC_TIMER_0, speed_freq);
        }

        // Tach pulse: f(Hz) = RPM * pulses_per_rev / 60
        uint16_t rpm = shared_data.engine_rpm;
        uint32_t tach_freq = (uint32_t)(rpm * config.tach_pulses_per_rev / 60.0f);
        if (tach_freq < 1) tach_freq = 0;
        if (tach_freq > 0) {
            ledc_set_freq(LEDC_LOW_SPEED_MODE, LEDC_TIMER_1, tach_freq);
        }

        // Oil pressure DAC: 0.5V (0 psi) to 4.5V (100 psi)
        float oil_psi = shared_data.oil_pressure_kpa * 0.145038f;  // kPa to PSI
        float oil_voltage = 0.5f + (oil_psi / 100.0f) * 4.0f;      // Linear 0.5-4.5V
        oil_voltage = constrain(oil_voltage, 0.0f, 5.0f);
        uint16_t oil_dac = (uint16_t)(oil_voltage / 5.0f * 4095);   // 12-bit DAC
        mcp4728_set_channel(DAC_CH_A, oil_dac);

        // Coolant temp DAC: map temp to 0-5V
        // Using Dakota Digital SEN-01-4 calibration: 0.5V = cold, 4.5V = hot
        float temp_c = shared_data.coolant_temp_c;
        float temp_voltage = map_temperature_to_voltage(temp_c);
        uint16_t temp_dac = (uint16_t)(temp_voltage / 5.0f * 4095);
        mcp4728_set_channel(DAC_CH_B, temp_dac);

        vTaskDelay(pdMS_TO_TICKS(20));  // 50 Hz update
    }
}
```

### 6.5 Task 4: Configuration Server (Core 0)

```
Priority: 1 (lowest)
Stack: 8192 bytes
Rate: Event-driven (BLE/WiFi connections)
```

**Configuration parameters stored in NVS (non-volatile storage):**

```c
typedef struct {
    // Speed output
    uint32_t speed_ppm;            // Pulses per mile (default: 16000)
    uint8_t  speed_source;         // 0=CAN primary/GPS fallback, 1=GPS only, 2=CAN only

    // Tach output
    uint8_t  tach_pulses_per_rev;  // Pulses per engine revolution (default: 4 for V8)
    uint8_t  tach_cylinders;       // Cylinder count (for display, calc is pulses_per_rev)

    // CAN configuration
    uint16_t can_msg_id_primary;   // Primary gauge data message ID (default: 0x640)
    uint16_t can_msg_id_secondary; // Secondary data message ID (default: 0x641)
    uint16_t can_baud;             // CAN baud rate (default: 500)

    // CAN channel byte offsets (within primary message)
    uint8_t  rpm_offset;           // Byte offset for RPM (default: 0)
    uint8_t  speed_offset;         // Byte offset for speed (default: 2)
    uint8_t  coolant_offset;       // Byte offset for coolant temp (default: 4)
    uint8_t  oil_p_offset;         // Byte offset for oil pressure (default: 6)

    // CAN channel scaling
    float    rpm_scale;            // RPM scale factor (default: 1.0)
    float    speed_scale;          // Speed scale (default: 0.1 = 0.1 km/h per bit)
    float    coolant_scale;        // Temp scale (default: 0.1 = 0.1 degC per bit)
    float    oil_p_scale;          // Pressure scale (default: 1.0 = 1 kPa per bit)

    // GPS configuration
    uint8_t  gps_update_rate;      // Hz (default: 25)
    uint8_t  gps_dynamic_model;    // u-blox model (default: 4 = automotive)

    // Output calibration
    float    oil_v_at_0psi;        // DAC voltage at 0 psi (default: 0.5)
    float    oil_v_at_100psi;      // DAC voltage at 100 psi (default: 4.5)
    float    temp_v_at_cold;       // DAC voltage at cold (default: 0.5)
    float    temp_v_at_hot;        // DAC voltage at hot (default: 4.5)
    float    temp_cold_c;          // Cold threshold (default: 60.0)
    float    temp_hot_c;           // Hot threshold (default: 120.0)
} bridge_config_t;
```

**Configuration interface:** BLE + WiFi AP

1. **BLE (primary):** Use ESP32 BLE GATT server. A phone app (or nRF Connect) can read/write configuration characteristics.
2. **WiFi AP (secondary):** On button press, the module creates a WiFi access point "NUKE-BRIDGE" with a web configuration page at 192.168.4.1. Simple HTML form for all parameters.

### 6.6 Source Priority Logic

The module supports three speed source modes:

```
Mode 0: CAN PRIMARY (default)
  ├── CAN data fresh (< 500ms old)? → Use CAN speed
  └── CAN data stale? → Fall back to GPS speed

Mode 1: GPS ONLY (standalone, no CAN)
  └── Always use GPS speed (module operates like GPS-50-2)

Mode 2: CAN ONLY (no GPS)
  └── Always use CAN speed. If CAN stale, output 0 mph.
```

**Cross-validation:** When both CAN and GPS are active, the module can compare them. If they disagree by more than 10%, log a warning (visible in BLE/WiFi diagnostic page). This catches:
- Driveshaft speed sensor failure (CAN reads wrong, GPS correct)
- GPS multipath error (GPS reads wrong, CAN correct)
- Tire size change (CAN reads wrong ratio, GPS reads true speed)

### 6.7 Firmware Build System

**Platform:** ESP-IDF v5.x (not Arduino framework -- we need full TWAI and LEDC control)

**Project structure:**
```
nuke-can-bridge/
├── main/
│   ├── main.c              # App entry, task creation
│   ├── gps_task.c          # GPS UART + UBX parsing
│   ├── gps_task.h
│   ├── can_task.c          # TWAI listener + frame parsing
│   ├── can_task.h
│   ├── output_task.c       # Pulse + DAC output generation
│   ├── output_task.h
│   ├── config.c            # NVS read/write, BLE/WiFi server
│   ├── config.h
│   ├── shared_data.c       # Thread-safe shared state
│   ├── shared_data.h
│   ├── ubx_parser.c        # u-blox UBX binary protocol parser
│   ├── ubx_parser.h
│   ├── mcp4728.c           # I2C DAC driver
│   ├── mcp4728.h
│   └── Kconfig.projbuild   # ESP-IDF menuconfig entries
├── CMakeLists.txt
├── sdkconfig.defaults      # Default ESP-IDF config
├── partitions.csv          # Custom partition table (NVS + OTA)
└── README.md
```

### 6.8 OTA Updates

The ESP32-S3 supports over-the-air firmware updates via WiFi. The partition table includes two OTA slots:

```
# partitions.csv
nvs,      data, nvs,     0x9000,  0x6000,
phy_init, data, phy,     0xf000,  0x1000,
ota_0,    app,  ota_0,   0x10000, 0x1E0000,
ota_1,    app,  ota_1,   0x1F0000,0x1E0000,
nvs_data, data, nvs,     0x3D0000,0x30000,
```

Upload new firmware via the WiFi configuration page. This means the module can be updated in the field without removing it from the vehicle or connecting a USB cable.

---

## 7. SCHEMATIC (Textual)

```
                              +12V SWITCHED (from PDM30 channel or ignition relay)
                                │
                                ├── SMBJ18CA (TVS to GND)
                                │
                                ├── SS54 Schottky (reverse protection)
                                │
                           ┌────┴────┐
                           │ LM2596  │
                           │ 12V→5V  │
                           └────┬────┘
                                │ +5V
                    ┌───────────┼────────────────────────────────┐
                    │           │                                │
               ┌────┴────┐     │                           ┌────┴────┐
               │ MCP4728 │     │                           │  74HC14 │
               │ Quad DAC│     │                           │ Schmitt │
               │  (I2C)  │     │                           │ Buffer  │
               └──┬──┬───┘     │                           └──┬──┬───┘
                  │  │    ┌────┴────┐                         │  │
        DAC_A ────┘  │    │AMS1117  │                    SPD──┘  └──TACH
     (Oil Press)     │    │ 5V→3.3V │                  output    output
        DAC_B ───────┘    └────┬────┘                  (pin 5)  (pin 7)
     (Coolant)                 │ +3.3V
                    ┌──────────┼──────────────────────────┐
                    │          │                          │
               ┌────┴────┐    │                    ┌─────┴─────┐
               │ ESP32-S3│    │                    │  NEO-M9N  │
               │         │    │                    │   GPS     │
               │  GPIO17 ├────┤── (CAN TX, unused) │  UART TX ─┼── GPIO_RX
               │  GPIO18 ├────┤── (CAN RX)         │  UART RX ─┼── GPIO_TX
               │  GPIO21 ├────┤── (I2C SDA)        │  VCC 3.3V │
               │  GPIO22 ├────┤── (I2C SCL)        │  GND      │
               │  GPIO4  ├────┤── (Speed pulse)    └───────────┘
               │  GPIO5  ├────┤── (Tach pulse)           │
               │         │    │                     U.FL──┤
               └────┬────┘    │                    antenna │
                    │         │                    ┌──────┴──────┐
                    │    ┌────┴────┐               │ SMA bulkhead│
                    │    │SN65HVD │               │  connector  │
                    │    │  230   │               └─────────────┘
                    │    │CAN XCVR│
                    │    └──┬──┬──┘
                    │       │  │
                    │    CANH  CANL
                    │    (pin3)(pin4)
                    │
                   GND
```

### GPIO Assignments

| GPIO | Function | Direction | Peripheral |
|------|----------|-----------|------------|
| 4 | Speed pulse output | Output | LEDC Timer 0, Channel 0 |
| 5 | Tach pulse output | Output | LEDC Timer 1, Channel 1 |
| 17 | CAN TX (listen-only, unused) | Output | TWAI |
| 18 | CAN RX | Input | TWAI |
| 21 | I2C SDA | Bidirectional | I2C Master |
| 22 | I2C SCL | Output | I2C Master |
| 43 | GPS UART TX (to GPS RX) | Output | UART1 |
| 44 | GPS UART RX (from GPS TX) | Input | UART1 |
| 0 | Config button (pull-up, active low) | Input | GPIO interrupt |
| 48 | Status LED (NeoPixel on DevKitC) | Output | RMT |

---

## 8. COMPARISON: NUKE CAN BRIDGE vs. DAKOTA DIGITAL

### 8.1 Feature Comparison

| Feature | Dakota Digital GPS-50-2 + SGI-100BT | NUKE CAN Bridge |
|---------|--------------------------------------|-----------------|
| GPS speed | Yes (10 Hz) | Yes (25 Hz, 4 constellation) |
| Speed accuracy | Good | Better (0.05 m/s NEO-M9N) |
| Speed pulse output | 4K/8K/16K PPM selectable | Any PPM, fully configurable |
| Tach signal calibration | Yes (SGI-100BT) | Yes |
| CAN bus reading | No | Yes (MoTeC M130 CAN decode) |
| Coolant temp from CAN | No | Yes (DAC output) |
| Oil pressure from CAN | No | Yes (DAC output) |
| Eliminate dual senders | No | Yes |
| Compass output | Yes | Yes (GPS heading) |
| Accelerometer compensation | Yes | No (could add MPU6050, $2) |
| Configuration interface | DIP switches + BIM bus | BLE app + WiFi web UI |
| OTA firmware updates | No | Yes |
| Open source | No (black box) | Yes (full source, schematics) |
| Diagnostic data logging | No | Yes (ESP32 flash logging) |
| Cross-validation (CAN vs GPS) | Not possible | Yes (speed discrepancy detection) |

### 8.2 Cost Comparison

| Approach | Components | Total Cost |
|----------|-----------|------------|
| Dakota Digital GPS-50-2 only | GPS speed signal | $220 |
| Dakota Digital GPS-50-2 + SGI-100BT | GPS speed + tach calibration | $470 |
| Dakota Digital full solution (GPS-50-2 + SGI-100BT + BIM modules) | Speed + tach + requires dual senders for temp/oil | $550+ |
| **NUKE CAN Bridge (prototype)** | **GPS speed + CAN bridge for ALL gauges** | **$130** |
| **NUKE CAN Bridge (production PCB)** | **Same features, custom board** | **$66** |

### 8.3 Eliminated Duplicate Sensors

With the CAN bridge, these duplicate senders are eliminated from the build:

| Eliminated Part | Function | Savings |
|----------------|----------|---------|
| Dakota Digital SEN-03-8 (oil pressure) | Duplicate oil sender | $40 |
| Dakota Digital SEN-01-4 (water temp) | Duplicate coolant sender | $25 |
| Cable-driven pulse generator | Speedo pulse generator | $50 |
| Associated wiring (4 sender wires, shielding) | | $30 |
| Drilling/tapping (extra sender holes) | Labor | $50 |
| **Total savings from eliminated parts** | | **$195** |

**Net savings: $195 (eliminated parts) + $340-420 (Dakota modules not purchased) - $130 (bridge BOM) = $405-495 saved.**

### 8.4 What We Gain Beyond Cost

1. **Single source of truth:** MoTeC reads every sensor once. The bridge converts the data for the gauges. No possibility of gauges and ECU showing different values.

2. **Open source, fully understood:** Every line of firmware is readable. No black box behavior. If something is wrong, debug it.

3. **Expandable:** The MCP4728 has 4 DAC channels -- 2 are spare. Future outputs: oil temp gauge, boost gauge, transmission temp. All from CAN data that the M130 already has.

4. **Diagnostic data:** The ESP32 can log CAN data to flash. When something goes wrong, pull the log via WiFi. This is free telemetry.

5. **OTA updates:** Fix bugs or add features without pulling the module out of the vehicle.

6. **Speed cross-validation:** GPS and CAN provide independent speed measurements. If they disagree, something is wrong (tire size change, sensor failure, GPS multipath). The module can flag this.

---

## 9. IMPLEMENTATION PLAN

### Phase 1: Bench Prototype (2 weeks)

1. Order components (ESP32-S3 DevKitC, NEO-M9N SparkFun breakout, SN65HVD230 module, MCP4728 Adafruit breakout, breadboard, LM2596 module)
2. Wire on breadboard
3. Write GPS task -- verify UBX-NAV-PVT parsing, speed output
4. Write output task -- verify speed pulse generation with oscilloscope
5. Write CAN task -- verify TWAI listen-only on bench CAN bus (use a CAN-USB adapter to simulate MoTeC messages)
6. Write DAC output -- verify oil pressure and coolant temp voltages with multimeter
7. Test with VHX gauge cluster on bench (if available)

### Phase 2: Vehicle Integration (1 week)

1. Solder proto board (off breadboard)
2. Build Deutsch DTM-12 harness pigtail
3. Install in vehicle, tap CAN bus between M130 and PDM30
4. Configure M130 CAN transmit messages in M1 Tune
5. Verify speed, tach, coolant, oil readings match MoTeC display
6. Drive test: compare GPS speed vs CAN speed, verify gauge accuracy
7. Tune calibration parameters via BLE/WiFi

### Phase 3: Custom PCB (4 weeks)

1. Design PCB in KiCad (schematic + layout)
2. Order PCB from JLCPCB (5 units, assembled)
3. Machine aluminum enclosure (CNC or order Hammond box)
4. Conformal coat PCB for humidity protection
5. Final vehicle installation
6. Publish design files (KiCad, firmware, BOM) to GitHub

### Phase 4: Documentation and Community

1. Write build guide with photos
2. Record installation video
3. Publish to squarebody and MoTeC forums
4. Receive feedback, iterate

---

## 10. RISK REGISTER

| Risk | Severity | Mitigation |
|------|----------|------------|
| CAN bus disruption (bridge interferes with MoTeC-PDM comms) | HIGH | Listen-only mode (no TX, no ACK). Module cannot physically transmit. |
| GPS signal loss (tunnel, garage, dense tree cover) | MEDIUM | CAN is primary speed source. GPS is fallback. Module works fine without GPS when CAN is live. |
| VHX calibration mismatch (DAC voltage does not match expected sender curve) | MEDIUM | Fully configurable voltage-to-gauge mapping. Adjustable via BLE/WiFi. |
| MoTeC CAN message format changes (firmware update changes byte layout) | LOW | All CAN offsets and scales are configurable parameters, not hardcoded. |
| Electrical noise (engine bay EMI) | MEDIUM | Shielded CAN wiring (already in place for MoTeC). Module mounted behind dash, not in engine bay. Decoupling caps on all power rails. |
| ESP32 lockup/crash | LOW | Watchdog timer on all tasks. If any task hangs >2 seconds, hardware reset. NVS config survives reboot. |
| GPS cold start delay (no speed for 30-60 seconds after ignition) | LOW | CAN provides instant speed data. GPS-only mode has the same cold start delay as the Dakota Digital GPS-50-2. |

---

## 11. ADVANCED: RESISTANCE SIMULATION (APPENDIX)

If the VHX absolutely must see a resistance sender (because you do not want to change the VHX calibration from its factory sender type), here is the resistance simulation circuit.

### Digital Potentiometer Approach

Use two X9C104 modules to simulate coolant temp (240-33 ohm) and oil pressure (10-184 ohm):

**Coolant temp (240-33 ohm):**
```
                      X9C104 (0-100K, 100 steps)
                         │
            ┌────────────┤ H (high terminal)
            │            │
        ┌───┴───┐        │ W (wiper) ──→ VHX TEMP sender input
        │ 240 ohm│        │
        │ fixed  │        │ L (low terminal) ──→ GND
        └───┬───┘
            │
           GND
```

Wait, this does not work directly. The X9C104 has a minimum wiper resistance of ~40 ohms and max of 100K, with 100 steps of ~1K each. The resolution is far too coarse for the 33-240 ohm range.

**Better approach: MCP41010 (10K, 256 steps) with parallel resistor**

```
MCP41010 wiper range: 0-10K ohm in 256 steps (~39 ohm per step)

To get 33-240 ohm range:
- Put a 270 ohm fixed resistor in parallel with the MCP41010
- MCP41010 at step 255 (10K): parallel with 270 = 263 ohm (close to 240)
- MCP41010 at step 9 (351 ohm): parallel with 270 = 152 ohm
- Still not reaching 33 ohm.

Alternative: Use a low-value MCP41050 (50K) or chain two MCP41010s differently.
```

**The resistance simulation approach is significantly more complex than the DAC approach.** The DAC approach works perfectly if the VHX is configured to read a 0-5V analog sender. Since the VHX supports this natively (it already works with SEN-01-4 and SEN-03-8 analog senders), the DAC approach is strongly recommended.

**Bottom line: Use DAC outputs and configure the VHX for analog senders. Do not simulate resistance. The VHX supports both modes -- use the one that is easier to drive electronically.**

---

## 12. PARTS ORDERING LIST (READY TO BUY)

### Prototype Build (Phase 1)

| # | Part Number | Description | Source | Qty | Price |
|---|-------------|-------------|--------|-----|-------|
| 1 | ESP32-S3-DevKitC-1-N16R8 | ESP32-S3 dev board, 16MB flash, 8MB PSRAM | Amazon/Mouser | 1 | $10 |
| 2 | SparkFun GPS-15733 | u-blox NEO-M9N breakout, SMA connector | SparkFun | 1 | $50 |
| 3 | Generic active GPS antenna | SMA, 28dB gain, magnetic mount | Amazon | 1 | $12 |
| 4 | SN65HVD230 CAN module | 3.3V CAN transceiver, breakout board | Amazon | 1 | $3 |
| 5 | Adafruit 4470 | MCP4728 quad 12-bit DAC breakout, STEMMA QT | Adafruit | 1 | $6 |
| 6 | LM2596 buck module | 12V to 5V, adjustable (set to 5V) | Amazon | 1 | $2 |
| 7 | AMS1117-3.3 | 3.3V LDO regulator, TO-220 or breakout | Amazon | 1 | $1 |
| 8 | SN74HC14N | Hex Schmitt trigger inverter, DIP-14 | DigiKey/Mouser | 1 | $1 |
| 9 | SMBJ18CA | TVS diode, 18V bidirectional | DigiKey | 1 | $1 |
| 10 | Breadboard + jumper wires | Full-size breadboard, M-M/M-F wires | Amazon | 1 | $8 |
| 11 | Deutsch DTM-12PA + DTM-12SA | 12-pin connector pair | Corsa Technic / WiringProducts.com | 1 | $16 |
| 12 | Deutsch DTM contact pins (size 20) | Stamped pins for 20 AWG wire | Corsa Technic | 24 | $6 |
| 13 | CAN-USB adapter (for bench testing) | PCAN-USB or Canable | Amazon | 1 | $20 |
| | | | | **Total** | **$136** |

### Notes on Sourcing

- The SparkFun NEO-M9N breakout is the most expensive single component. A bare NEO-M9N module from u-blox distributors (Mouser, DigiKey) is $18 but requires soldering a 24-pin LCC package -- not beginner friendly. The SparkFun breakout is worth the premium for prototyping.
- The CAN-USB adapter is a one-time test tool purchase, not part of the final module BOM.
- All components except the Deutsch connectors are available on Amazon with 1-2 day delivery.
- Deutsch connectors: order from Corsa Technic (corsa-technic.com) or WiringProducts.com. These are the same connectors used throughout the MoTeC harness.

---

## 13. FUTURE EXPANSION

### 13.1 Additional Gauge Outputs

The MCP4728 has 2 spare DAC channels (C and D). Potential uses:

| Channel | Function | Use Case |
|---------|----------|----------|
| C | Oil Temperature | Add oil temp gauge to VHX (aftermarket) |
| D | Boost Pressure | Add boost gauge (turbo/supercharger builds) |

Add a second MCP4728 (different I2C address) for 4 more channels if needed.

### 13.2 Transmission Temperature

If the build includes an automatic transmission (4L80E, 6L80E), the trans temp sender can be read by the M130 and bridged to a Dakota Digital auxiliary gauge via DAC.

### 13.3 Data Logging

The ESP32-S3 has 16MB flash. At 25 Hz logging rate with 12 channels of 16-bit data:
- 25 samples/sec * 24 bytes/sample = 600 bytes/sec
- 16 MB / 600 = 26,667 seconds = 7.4 hours of continuous logging

Log to SPIFFS/LittleFS partition. Download via WiFi. This is free telemetry that the GPS-50-2 cannot do.

### 13.4 NMEA Output (for other devices)

The module could output NMEA 0183 sentences on a spare UART for devices that expect GPS NMEA input (older navigation systems, marine instruments, etc.).

### 13.5 Motec C125 Display Elimination

If this bridge works well, it could replace the need for a MoTeC C125 display ($2,500) entirely. The Dakota Digital VHX becomes the primary display, fed entirely from CAN data through the bridge. The C125's only advantage is CAN-native display with configurable pages -- which could be replicated with a small LCD driven by the ESP32 if desired.

### 13.6 Production Module for Sale

At $66 production BOM and a $199 retail price, this module undercuts the Dakota Digital GPS-50-2 ($220) while offering dramatically more functionality. The market for squarebody trucks with aftermarket EFI and Dakota Digital gauges is substantial. This could be a real product.

---

## REFERENCES

- Dakota Digital VHX Manual (MAN 650314): Sender specifications, calibration procedures
- Dakota Digital GPS-50-2 Manual (MAN 650519D): GPS speed module specifications
- Dakota Digital SGI-100BT Manual (MAN 650701D): Signal interface specifications
- MoTeC M130 Datasheet (PART 13130): ECU I/O and CAN specifications
- MoTeC M1 to PDM CAN Messaging User Guide: CAN message format
- u-blox NEO-M9N Integration Manual: UBX protocol, configuration commands
- ESP-IDF TWAI Driver Documentation: CAN controller API
- ESP-IDF LEDC Driver Documentation: PWM/pulse generation API
- MCP4728 Datasheet (Microchip DS22187E): DAC specifications
- SN65HVD230 Datasheet (TI SLLS560): CAN transceiver specifications
