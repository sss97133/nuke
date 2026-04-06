# iBooster Gen 2 CAN Protocol Reverse-Engineering Plan

## Goal

Eliminate the $350 SGH Innovations V2 Controller by programming the Motec M130 (or a minimal CAN gateway) to send the correct CAN messages to the Bosch iBooster Gen 2, enabling full proportional braking with configurable boost curves on the 1977 K5 Blazer.

---

## 1. What We Know Today

### 1.1 iBooster Hardware Summary

| Parameter | Value |
|-----------|-------|
| Part | Bosch iBooster Gen 2 |
| Donor vehicles | Tesla Model 3, 2018+ Honda Accord, Chevy Volt, Honda CR-V |
| Motor | 450W brushless (Gen 2), 350W (Gen 1) |
| ECU connector | 26-pin (main ECU connector) |
| Pedal sensor connector | 4-pin on Gen 2 (5-pin on Gen 1) |
| CAN buses | 2 (Vehicle CAN + YAW sensor CAN) |
| CAN speed | 500 kbps (both buses), some Honda Gen 2 units may use CAN FD at 2 Mbps on YAW bus |
| CAN termination | None internal (must be provided externally) |
| Peak current | ~40A (dedicated relay, NOT on PDM) |

### 1.2 Pinout — 26-Pin ECU Connector (Gen 2)

| Pin | Function | Wire Size | Notes |
|-----|----------|-----------|-------|
| 1 | BAT+ (permanent 12V) | 2.5-4 mm² | Large 4.8mm spade terminal |
| 2 | Pedal Travel Sensor signal 1 | 0.35-0.5 mm² | From PTS pin 1 |
| 8 | Pedal Travel Sensor signal 2 | 0.35-0.5 mm² | From PTS pin 3 |
| 9 | GND (battery negative) | 2.5-4 mm² | Large 4.8mm spade terminal |
| 10 | YAW CAN-L | 0.35-0.5 mm² | Yaw sensor CAN bus low |
| 16 | Vehicle CAN-L | 0.35-0.5 mm² | Vehicle CAN bus low |
| 17 | (Not used on Gen 2) | — | Gen 1 used this for permanent 12V to ECU |
| 18 | YAW CAN-H | 0.35-0.5 mm² | Yaw sensor CAN bus high |
| 20 | IGN switched 12V | 0.35-0.5 mm² | Small 1.5mm spade terminal |
| 22 | Pedal Travel Sensor signal 3 | 0.35-0.5 mm² | From PTS pin 2 |
| 23 | Pedal Travel Sensor signal 4 | 0.35-0.5 mm² | From PTS pin 4 |
| 25 | Vehicle CAN-H | 0.35-0.5 mm² | Vehicle CAN bus high |

### 1.3 Pedal Travel Sensor Connector (Gen 2 — 4-pin)

| PTS Pin | Connects to ECU Pin | Function |
|---------|---------------------|----------|
| 1 | ECU Pin 2 | Signal 1 |
| 2 | ECU Pin 22 | Signal 3 |
| 3 | ECU Pin 8 | Signal 2 |
| 4 | ECU Pin 23 | Signal 4 |

The pedal travel sensor is physically integrated into the iBooster assembly but is NOT internally wired to the ECU. The 4 signal wires must be routed externally between the PTS connector and the 26-pin ECU connector.

### 1.4 Minimum Standalone Operation (Failsafe Mode)

7 wires required for basic failsafe operation:
1. Pin 1 — BAT+ (permanent 12V)
2. Pin 9 — GND
3. Pin 20 — IGN switched 12V
4. Pin 2 — PTS signal 1
5. Pin 8 — PTS signal 2
6. Pin 22 — PTS signal 3
7. Pin 23 — PTS signal 4

**Failsafe mode behavior:** The iBooster uses the pedal travel sensor position to determine assist level. No CAN communication required. The boost ratio is a fixed default programmed into the iBooster ECU at the factory. Reports from hot-rod retrofits describe the pedal as "very light from the beginning" with "no resistance" — adequate braking but not tunable.

**Performance in failsafe mode (EVcreate testing):**
- iBooster OFF: 0.5G deceleration at 500N pedal force
- iBooster ON (failsafe): 1.2G deceleration at only 300N pedal force

### 1.5 Two Operating Modes

| Mode | CAN Required | Boost Behavior | Tunability |
|------|-------------|----------------|------------|
| Failsafe | No | Fixed ratio from PTS position | None — factory default only |
| Normal (CAN-active) | Yes | Variable ratio, configurable curve | Full — boost curve, regen blending, external brake request |

### 1.6 Dual CAN Bus Architecture

The iBooster has two independent CAN buses:

**Vehicle CAN** (pins 25/16): The main communication bus. This is where the vehicle's BCM/VCU sends commands and receives status. In Tesla, this carries the friction brake command (msg 789), regen message (msg 560), and receives status (msg 925).

**YAW CAN** (pins 18/10): Connected to yaw rate sensor in factory. Sends two messages: 0x38E and 0x38F. Byte 3 of 0x38E contains push-rod position (0x40 idle, 0xC0 fully pressed). On some Honda Gen 2 units, this bus may run CAN FD (500k arb / 2M data) rather than standard CAN.

---

## 2. Known CAN Protocol Information

### 2.1 Messages FROM the iBooster (Status — iBooster transmits)

#### IBST_status — CAN ID 925 (0x39D), 5 bytes

Source: Tesla Model 3 DBC files (joshwardell/model3dbc, commaai/opendbc)

| Signal | Start Bit | Length | Scale | Offset | Range | Unit | Description |
|--------|-----------|--------|-------|--------|-------|------|-------------|
| IBST_statusChecksum | 0 | 8 bits | 1 | 0 | 0-255 | — | Checksum byte |
| IBST_statusCounter | 8 | 4 bits | 1 | 0 | 0-15 | — | Rolling counter (0-15) |
| IBST_iBoosterStatus | 12 | 3 bits | 1 | 0 | 0-6 | — | Operating state enum |
| IBST_driverBrakeApply | 16 | 2 bits | 1 | 0 | 0-3 | — | Brake application state |
| IBST_internalState | 18 | 3 bits | 1 | 0 | 0-6 | — | Internal mode enum |
| IBST_sInputRodDriver | 21 | 12 bits | 0.015625 | -5 | -5 to 47 | mm | Input rod position (push-rod travel) |

**IBST_iBoosterStatus enum:**
| Value | State |
|-------|-------|
| 0 | OFF |
| 1 | INIT |
| 2 | FAILURE |
| 3 | DIAGNOSTIC |
| 4 | ACTIVE_GOOD_CHECK |
| 5 | READY |
| 6 | ACTUATION |

**IBST_driverBrakeApply enum:**
| Value | State |
|-------|-------|
| 0 | NOT_INIT_OR_OFF |
| 1 | BRAKES_NOT_APPLIED |
| 2 | DRIVER_APPLYING_BRAKES |
| 3 | FAULT |

**IBST_internalState enum:**
| Value | State |
|-------|-------|
| 0 | NO_MODE_ACTIVE |
| 1 | PRE_DRIVE_CHECK |
| 2 | LOCAL_BRAKE_REQUEST (failsafe PTS-based) |
| 3 | EXTERNAL_BRAKE_REQUEST (CAN-commanded) |
| 4 | DIAGNOSTIC |
| 5 | TRANSITION_TO_IDLE |
| 6 | POST_DRIVE_CHECK |

**Checksum algorithm (from community research):** The checksum changes by 1 for every counter increment. The checksum is computed so the sum of all data bytes equals 0 in 16-bit math: checksum = 0x10000 - (counter + first_16_bits). This needs to be verified by sniffing.

#### iBoosterFrictionBrakeStatus — CAN ID 368 (0x170), 8 bytes

Transmitted by iBooster to the VCU.

| Signal | Start Bit | Length | Description |
|--------|-----------|--------|-------------|
| FrictionBrakePressure | 23 | 16 bits | Actual friction brake pressure being applied |

Additional signals likely present but not yet fully decoded.

#### YAW Bus Messages

| Message ID | Length | Notes |
|------------|--------|-------|
| 0x38E | 8 bytes (est.) | Byte 3 = push rod position. Idle = 0x40, full press = 0xC0 |
| 0x38F | 8 bytes (est.) | Second YAW message, content unknown |

### 2.2 Messages TO the iBooster (Commands — VCU/BCM transmits)

#### iBoosterFrictionBrakeCmd — CAN ID 789 (0x315), 5 bytes

Sent from VCU to iBooster to command friction braking.

| Signal | Start Bit | Length | Description |
|--------|-----------|--------|-------------|
| FrictionBrakeCmd | 3 | 12 bits | Brake force/pressure command value |
| FrictionBrakeMode | 7 | 4 bits | Mode selector |
| FrictionBrakeChecksum | 23 | 16 bits | Rolling checksum |
| RollingCounter | 33 | 2 bits | Increments each message |

**Note:** Bit positions use DBC big-endian notation. The byte order and exact packing need verification via CAN sniffing.

#### iBoosterRegen — CAN ID 560 (0x230), 6 bytes

Sent from VCU to iBooster to coordinate with regenerative braking.

| Signal | Start Bit | Length | Description |
|--------|-----------|--------|-------------|
| Regen | 1 | 10 bits | Regenerative braking level (tells iBooster how much regen is active so it can reduce friction braking proportionally) |

#### VCFRONT_LVPowerState — CAN ID 545 (0x221), 8 bytes

Contains iBooster low-voltage power state.

| Signal | Start Bit | Length | Description |
|--------|-----------|--------|-------------|
| VCFRONT_iBoosterLVState | 24 | 2 bits | LV power state enum |

**LV State enum:** 0=LV_OFF, 1=LV_ON, 2=LV_GOING_DOWN, 3=LV_FAULT

### 2.3 Unknown / Needs Verification

The above messages are decoded from **Tesla Model 3** DBC files. Critical unknowns:

1. **Are these the same messages the Honda Accord iBooster expects?** The iBooster ECU firmware is likely OEM-specific. Different OEMs may use different CAN IDs and message formats. SGH Innovations states that their controller only supports Tesla Gen1 and Gen2 iBoosters, implying Honda units may differ.

2. **What is the minimum set of messages needed to exit failsafe mode?** The iBooster may only need a single heartbeat/status message to transition from failsafe to normal mode, or it may require the full suite of VCU messages.

3. **What is the required message rate?** Typical automotive CAN rates for safety-critical messages are 10-50ms (20-100 Hz). The iBooster likely expects messages at 20-50 Hz.

4. **Is there a startup/initialization sequence?** The iBooster may require messages in a specific order or timing during power-up to transition through INIT to READY state.

5. **What happens if CAN communication drops mid-braking?** Community reports say the iBooster "goes to limp mode" (failsafe) — maintains basic assist but loses CAN control. This is the safe failure mode we want to verify.

---

## 3. Sniffing Methodology

### 3.1 Required Equipment

| Item | Cost | Purpose |
|------|------|---------|
| PCAN-USB adapter (Peak Systems IPEH-002021) | ~$300 | Industry-standard CAN bus analyzer, SavvyCAN compatible |
| **OR** CANable 2.0 (USB-CAN adapter) | ~$40 | Open-source alternative, SavvyCAN compatible |
| **OR** Saleae Logic Pro 16 | Already owned? | Can capture CAN FD as well as standard CAN |
| 120-ohm termination resistor x2 | $1 | One at each end of the CAN bus |
| iBooster Gen 2 (Tesla Model 3 donor) | Already purchased | The unit under test |
| DB9-to-wire adapter or bare wire CAN pigtails | $10 | Connect analyzer to CAN bus |
| 12V bench power supply (10A minimum) | $50 | Power the iBooster on the bench |
| SavvyCAN software | Free | Open-source CAN analysis and replay |

**Recommended: CANable 2.0** — $40, open-source, slcan-compatible with SavvyCAN, supports 500 kbps. Best cost/performance for this project.

### 3.2 Bench Setup — Passive Sniffing (Ideal Path)

If you can obtain a donor vehicle on the bench (2018+ Honda Accord or Tesla Model 3 with iBooster still connected to factory BCM/VCU):

```
Factory BCM/VCU ←── CAN-H (pin 25) ──→ iBooster ECU
                ←── CAN-L (pin 16) ──→
                         ↑
                    CAN Analyzer (passive tap)
                    (high-impedance, no termination)
```

1. Tap into Vehicle CAN (pins 25/16) with the CAN analyzer in listen-only mode
2. Power up the system (ignition on)
3. Record all traffic for 60 seconds at idle (engine running)
4. Press the brake pedal at various speeds and pressures
5. Record all traffic during braking events
6. Power down and record shutdown sequence

**What to look for:**
- Messages that appear immediately at power-up (heartbeat/keep-alive candidates)
- Messages that change when brake pedal is pressed (brake command candidates)
- Messages that appear at constant intervals (cyclic messages — these are the heartbeats)
- Message IDs matching the known Tesla DBC: 789, 560, 545, 925, 368

### 3.3 Bench Setup — Standalone Sniffing

If no donor vehicle is available (most likely scenario):

```
12V Power Supply ──→ Pin 1 (BAT+), Pin 20 (IGN)
GND ─────────────→ Pin 9 (GND)
PTS wired ──────→ Pins 2, 8, 22, 23

CAN Analyzer ←──→ Pin 25 (CAN-H Vehicle) + Pin 16 (CAN-L Vehicle)
                   120Ω termination at analyzer end
                   120Ω termination at iBooster end (or single 120Ω if short bus)

Second CAN Analyzer ←──→ Pin 18 (CAN-H YAW) + Pin 10 (CAN-L YAW)
                          120Ω termination
```

1. Power up with all 7 wires connected (failsafe mode)
2. Record all CAN traffic the iBooster transmits on both buses
3. This captures the iBooster's outbound messages (IBST_status, FrictionBrakeStatus, YAW messages)
4. Press brake pedal and observe message changes
5. Note: Without inbound CAN messages, the iBooster stays in failsafe. You will only see what IT sends, not what it needs to receive.

### 3.4 Message Replay — Finding the Command Messages

Once you have the iBooster's outbound messages captured:

1. **Start with known Tesla message IDs:** Build CAN frames for ID 789 (FrictionBrakeCmd) with the format from the DBC file. Send them at 50 Hz.
2. **Monitor IBST_status (ID 925):** Watch for the iBooster to transition from INIT/LOCAL_BRAKE_REQUEST to READY/EXTERNAL_BRAKE_REQUEST
3. **Systematic exploration:** If Tesla IDs don't work, sweep through CAN IDs sending minimal heartbeat frames. Watch for state transitions on IBST_status.
4. **Binary search:** Once you find a message that causes a state change, vary individual bytes to map the protocol.

### 3.5 Analysis Strategy in SavvyCAN

1. **DBC file import:** Load the joshwardell/model3dbc DBC file into SavvyCAN. Even if message IDs differ for Honda-sourced units, it gives you a starting template.
2. **Message frequency analysis:** Use SavvyCAN's graphing to identify cyclic messages and their rates.
3. **Byte-level correlation:** Graph individual bytes against time. Look for bytes that correlate with brake pedal position.
4. **Rolling counter identification:** Look for bytes that increment by 1 each message cycle — these are counters.
5. **Checksum identification:** Look for bytes that change unpredictably — compute CRC8, XOR, or additive checksum candidates.

---

## 4. Motec M130 CAN Transmission Capability

### 4.1 M130 CAN Hardware

| Parameter | Specification |
|-----------|--------------|
| CAN buses | 1 |
| Speed | 500 kbps (configurable in some packages) |
| Protocol | CAN 2.0B (standard and extended frames) |
| Connector | Pins on Connector B |
| Termination | External required |

### 4.2 Standard Package Limitations (GPR)

The M130 with GPR firmware can:
- Transmit pre-defined MoTeC CAN templates (to PDM30, C125 display, loggers)
- Receive data from MoTeC devices on standard CAN IDs
- Read brake pressure, coolant pressure, fuel level as "CAN sensor" resources

The M130 with GPR firmware **cannot** (without development license):
- Transmit arbitrary CAN messages with custom IDs
- Control CAN message timing at specific rates
- Implement rolling counters or checksums in CAN frames
- Read non-MoTeC CAN messages

### 4.3 Development License Path

The M1 Development License ($1,200-$2,500 depending on version) unlocks M1 Build software which allows:
- Custom CAN transmit functions with arbitrary message IDs
- Custom data packing (unsigned integers, bits at specific positions)
- Scheduled functions for transmission rate control
- Custom CAN receive parsing

**Implementation in M1 Build:**
```
// Pseudocode based on Motec forum descriptions
// In a Scheduled Function running at 50 Hz:

CAN_Transmit_Handle = CAN_Init(CAN_BUS_1, 0x315, 5);  // ID 789 = 0x315, 5 bytes
CAN_SetUInt(handle, byte0_position, brake_cmd_value);
CAN_SetUInt(handle, counter_position, rolling_counter);
CAN_SetUInt(handle, checksum_position, computed_checksum);
CAN_Transmit(handle);

rolling_counter = (rolling_counter + 1) & 0x03;  // 2-bit counter wraps at 4
```

**The problem:** This is a significant investment ($1,200+) in a development license for what is essentially a glorified CAN message generator. The M130's single CAN bus is already occupied by PDM30 communication. Adding iBooster traffic to the same bus is possible (CAN is a multi-device bus) but adds complexity and risk.

### 4.4 Verdict on M130 Native Control

**Feasible but not recommended as primary path.** The M130 CAN bus is shared with the PDM30 and potentially the Dakota Digital display. Adding safety-critical iBooster messages to this bus:
- Requires M1 Development License ($1,200+)
- Shares bandwidth with non-safety-critical traffic
- Single point of failure (if M130 crashes or resets, brakes lose CAN control)
- Complex firmware development for a brake safety system

---

## 5. Recommended Implementation: Dedicated CAN Gateway

### 5.1 Architecture

```
                    ┌──────────────┐
                    │  Motec M130  │
                    │   (GPR)      │
                    │              │
                    │  CAN Bus     │←──── 500 kbps ────→ PDM30, Display
                    └──────┬───────┘
                           │
                    Analog output (0-5V)
                    = Brake pressure feedback
                           │
                    ┌──────┴───────┐
                    │   ESP32-S3   │
                    │  CAN Gateway │
                    │              │
                    │  CAN Port 1  │←──── 500 kbps ────→ iBooster Vehicle CAN
                    │              │                       (pins 25/16)
                    │  CAN Port 2  │←──── 500 kbps ────→ iBooster YAW CAN
                    │  (optional)  │                       (pins 18/10)
                    │              │
                    │  ADC inputs  │←──── PTS signal ────  (optional: read pedal
                    │              │                         position directly)
                    └──────────────┘
```

### 5.2 Hardware: ESP32-CAN-X2

| Component | Cost | Source |
|-----------|------|--------|
| ESP32-CAN-X2 (Autosport Labs) | ~$50 | Dual CAN bus, automotive grade, 12V input |
| **OR** ESP32-S3 + 2x MCP2515 + 2x TJA1050 | ~$25 | DIY alternative |
| **OR** STM32F4 + CAN transceivers | ~$30 | Higher reliability, automotive-grade option |
| Enclosure (IP67 rated) | $15 | Weatherproof for engine bay |
| Total | $50-95 | vs. $350 for SGH Innovations |

**Recommended: ESP32-CAN-X2 from Autosport Labs.** It is a dual CAN bus automotive-grade development board with 12V power input and two CAN ports — exactly what this application needs.

### 5.3 Gateway Firmware Design

```
┌─────────────────────────────────────────────────┐
│                GATEWAY FIRMWARE                  │
│                                                  │
│  ┌──────────────┐    ┌────────────────────────┐  │
│  │  Heartbeat   │    │  Brake Command         │  │
│  │  Generator   │    │  Generator             │  │
│  │              │    │                        │  │
│  │  50 Hz loop  │    │  Read PTS via ADC      │  │
│  │  Send keep-  │    │  OR read iBooster      │  │
│  │  alive msgs  │    │  IBST_status msg       │  │
│  │  to iBooster │    │  Map pedal position    │  │
│  │              │    │  to brake command       │  │
│  │  Rolling     │    │  Apply boost curve     │  │
│  │  counter +   │    │  Send FrictionBrakeCmd │  │
│  │  checksum    │    │  (msg 789)             │  │
│  └──────────────┘    └────────────────────────┘  │
│                                                  │
│  ┌──────────────┐    ┌────────────────────────┐  │
│  │  Status      │    │  Motec Interface       │  │
│  │  Monitor     │    │  (optional)            │  │
│  │              │    │                        │  │
│  │  Read        │    │  Output 0-5V analog    │  │
│  │  IBST_status │    │  brake pressure to     │  │
│  │  (msg 925)   │    │  M130 analog input     │  │
│  │              │    │                        │  │
│  │  Watchdog:   │    │  OR: transmit brake    │  │
│  │  if no reply │    │  data on Motec CAN     │  │
│  │  in 200ms,   │    │  using Motec template  │  │
│  │  set fault   │    │  format                │  │
│  └──────────────┘    └────────────────────────┘  │
│                                                  │
│  ┌──────────────┐                                │
│  │  Safety      │                                │
│  │  Manager     │                                │
│  │              │                                │
│  │  If CAN tx   │                                │
│  │  fails:      │                                │
│  │  stop sending│                                │
│  │  → iBooster  │                                │
│  │  reverts to  │                                │
│  │  failsafe    │                                │
│  └──────────────┘                                │
└─────────────────────────────────────────────────┘
```

### 5.4 Message Transmission Schedule

Based on typical automotive safety-critical CAN timing:

| Message | CAN ID | Direction | Rate | Priority |
|---------|--------|-----------|------|----------|
| Heartbeat/keep-alive | TBD (verify by sniffing) | Gateway → iBooster | 50 Hz (20ms) | Highest |
| FrictionBrakeCmd | 789 (0x315) | Gateway → iBooster | 50 Hz (20ms) | High |
| iBoosterRegen | 560 (0x230) | Gateway → iBooster | 50 Hz (20ms) | Medium (send 0 = no regen) |
| IBST_status | 925 (0x39D) | iBooster → Gateway | 50 Hz (expected) | Monitor |
| FrictionBrakeStatus | 368 (0x170) | iBooster → Gateway | Variable | Monitor |

### 5.5 Boost Curve Configuration

With CAN control, the gateway can implement a programmable boost curve:

```
Boost Ratio = f(pedal_position, vehicle_speed, brake_pressure)

// Simple linear curve (starting point):
brake_cmd = pedal_position * BOOST_GAIN

// Progressive curve (better feel for street):
brake_cmd = pedal_position^1.5 * BOOST_GAIN

// Adjustable via potentiometer or Motec CAN parameter
BOOST_GAIN configurable from 0.5 (light assist) to 3.0 (maximum assist)
```

This replaces the fixed failsafe-mode boost ratio with a tunable system — the primary value proposition over running in failsafe mode.

---

## 6. Step-by-Step Execution Plan

### Phase 1: Bench Capture (Day 1-2)

**Equipment needed:** CANable 2.0 ($40), SavvyCAN (free), 12V power supply, iBooster with harness

1. Wire the iBooster for standalone operation (7 wires)
2. Connect CAN analyzer to Vehicle CAN (pins 25/16) with 120-ohm termination
3. Connect second analyzer (or swap) to YAW CAN (pins 18/10)
4. Power up, record all outbound messages for 5 minutes
5. Press brake pedal slowly, record. Press hard, record. Pump, record.
6. Catalog all message IDs, rates, and identify IBST_status by matching to known DBC format
7. Verify message 0x38E on YAW bus (Byte 3 = pedal position)

**Deliverable:** Complete list of iBooster outbound message IDs and their content at various pedal positions.

### Phase 2: Message Replay — Finding the Unlock (Day 3-5)

1. Load Tesla Model 3 DBC into SavvyCAN
2. Build a FrictionBrakeCmd frame (ID 789, 5 bytes) with:
   - FrictionBrakeCmd = 0 (no brake)
   - FrictionBrakeMode = TBD (try 0, 1, 2, 3)
   - RollingCounter = incrementing 0-3
   - FrictionBrakeChecksum = computed per checksum algorithm
3. Transmit at 50 Hz to iBooster Vehicle CAN
4. Monitor IBST_status for state transition (INIT → READY, or LOCAL_BRAKE_REQUEST → EXTERNAL_BRAKE_REQUEST)
5. If no response: try the iBoosterRegen message (ID 560) simultaneously
6. If no response: try VCFRONT_LVPowerState (ID 545) with LV_ON state
7. If no response with Tesla IDs: the Honda Accord donor may use different IDs. Begin sweep:
   - Send a minimal frame (8 bytes of 0x00) on IDs 0x000 through 0x7FF at 10 Hz
   - Watch IBST_status for any state change
   - Binary search to identify which ID causes the transition

**Deliverable:** The minimum set of CAN messages that transitions the iBooster from failsafe to CAN-controlled mode.

### Phase 3: Protocol Mapping (Day 5-7)

Once the unlock message(s) are identified:

1. Vary each byte of the command message independently
2. Map which bytes control:
   - Brake force command (should correlate with actual braking force)
   - Mode selection
   - Counter and checksum (required for acceptance)
3. Test the full range: 0 brake → maximum brake
4. Measure actual brake line pressure with a gauge to correlate CAN values to physical force
5. Test boost curve: send constant CAN command, vary pedal position — does the iBooster blend?
6. Document the complete protocol with byte-level definitions

**Deliverable:** Complete CAN protocol specification: message IDs, byte maps, value ranges, checksum algorithm, timing requirements.

### Phase 4: Gateway Build (Day 8-12)

1. Flash ESP32-CAN-X2 with Arduino/PlatformIO firmware
2. Implement message generation with correct:
   - Message IDs
   - Rolling counter
   - Checksum computation
   - 50 Hz (20ms) transmission rate
3. Implement IBST_status monitoring (read iBooster state)
4. Implement watchdog (stop transmitting if iBooster stops responding)
5. Add brake pedal position reading:
   - Option A: Read PTS signals directly via ADC (requires understanding PTS protocol — likely dual-track potentiometer or Hall sensor)
   - Option B: Read push-rod position from 0x38E on YAW bus (simpler, no analog interface needed)
6. Implement boost curve with default parameters
7. Add analog output (0-5V via DAC or PWM+filter) for M130 brake pressure feedback

**Deliverable:** Working gateway prototype on bench.

### Phase 5: Integration Testing (Day 13-15)

1. Bench test: verify iBooster transitions to READY state on power-up
2. Bench test: press brake pedal, verify proportional CAN-controlled braking
3. Bench test: kill gateway power mid-braking, verify iBooster reverts to failsafe (continues working)
4. Bench test: measure response time (pedal press to pressure increase)
5. Install in K5 Blazer (iBooster already in progress per build manifest)
6. Static test: engine off, pump brakes, verify pedal feel
7. Low-speed test: parking lot, verify progressive braking at walking speed
8. Graduated speed testing: 5 mph, 10 mph, 20 mph, 30 mph stops

**Deliverable:** Validated iBooster CAN control on the vehicle.

### Phase 6: Tuning and Integration (Day 16-20)

1. Tune boost curve for desired pedal feel
2. Connect gateway analog output to M130 analog input for brake pressure data logging
3. Configure M130 to log brake pressure alongside other engine data
4. Consider CAN integration with M130 bus (gateway relays brake data as MoTeC-format CAN)
5. Final validation: emergency stop testing from increasing speeds

---

## 7. Safety Analysis

### 7.1 Failure Modes

| Failure | iBooster Behavior | Risk Level | Mitigation |
|---------|-------------------|------------|------------|
| CAN gateway loses power | Reverts to failsafe mode (PTS-based assist) | **LOW** — brakes still work | Acceptable. Failsafe is the backup. |
| CAN gateway sends corrupt data | iBooster rejects (checksum/counter mismatch) | **LOW** — reverts to failsafe after timeout | Verify timeout period by testing |
| CAN gateway sends wrong brake command | Unexpected braking force | **MEDIUM** | Limit max brake command in firmware. Physical pressure relief in hydraulics. |
| iBooster ECU fails | No power assist, manual brakes only | **LOW** — very rare | Master cylinder still functions. Heavy pedal but stoppable. |
| 12V power loss to iBooster | No power assist, manual brakes only | **LOW** | Dual power feeds. Dedicated relay with fuse. |
| CAN bus short/open | Lost communication, failsafe mode | **LOW** | Proper twisted-pair wiring, fused power |

### 7.2 Key Safety Properties

1. **The iBooster is fail-safe by design.** It ALWAYS provides basic braking via the pedal travel sensor, even with no CAN communication. This is the fundamental safety property — we are adding CAN control ON TOP of an already-safe baseline.

2. **Manual brakes work without iBooster.** Even if the iBooster motor completely fails, the push rod mechanically connects the brake pedal to the master cylinder. Pedal effort increases dramatically, but the brakes work.

3. **The gateway is not in the braking force path.** The gateway only sends CAN messages. If it fails, the iBooster reverts to its own internal control using the pedal travel sensor. The hydraulic path (pedal → push rod → master cylinder → brake lines → calipers) is always intact.

### 7.3 Testing Protocol

1. **Bench validation:** Confirm failsafe reversion by pulling CAN while braking
2. **Static on vehicle:** Pump pedal 20 times, verify pressure holds
3. **Parking lot:** 5 mph stops, verify proportional response
4. **Street test:** Graduated speed increase with progressive braking
5. **Emergency stop test:** Full ABS-threshold braking from 30 mph, 40 mph, 50 mph
6. **Endurance:** 50 consecutive stops to check for fade or CAN errors
7. **Kill test:** Pull gateway power at speed, confirm seamless transition to failsafe

---

## 8. Alternative Approaches

### 8.1 Just Buy the SGH Controller ($350)

**Pros:**
- Proven, tested, 2+ years of production
- SGH spent 7 months reverse-engineering the protocol
- Zero development time
- They handle Tesla Gen1 and Gen2 specifically

**Cons:**
- $350 for what is essentially an ESP32 + CAN transceiver
- Black box — no control over boost curve
- No integration with Motec
- No brake data logging
- Single-source dependency (if SGH discontinues, no replacement)

**Verdict:** Good fallback if the reverse-engineering effort stalls. The $350 is not unreasonable for a proven solution. But the knowledge gained from reverse-engineering has long-term value for the Nuke platform (applicable to every iBooster retrofit in the K5/squarebody community).

### 8.2 Run in Failsafe Only (No CAN at all)

**Pros:**
- Simplest possible installation (7 wires)
- Zero CAN development
- Proven by hundreds of hot-rod retrofits

**Cons:**
- Fixed boost ratio — cannot tune pedal feel
- No brake data to M130 for logging
- No possibility of future ABS/traction control integration
- Community reports pedal is "too light" or "no resistance" — some dislike the feel

**Verdict:** This is the baseline that already works. The CAN project builds on top of it. If CAN reverse-engineering fails, failsafe mode is the production fallback.

### 8.3 Contact EVcreate / Seb Smith Directly

EVcreate's Lars provided research units to the CarbagePilot project. Seb Smith (referenced by EVcreate) has reportedly "solved the puzzle" of iBooster CAN control. Their research was in exchange for publishing findings. Contacting them directly may yield:
- Partially decoded protocol documentation
- DBC files they have developed
- Guidance on which CAN IDs are critical
- Confirmation of whether Honda and Tesla iBooster firmware differs

**Action item:** Email info@evcreate.com and reference the iBooster CAN-BUS research page. Ask specifically about:
1. Any published DBC file for iBooster Gen 2
2. Whether Honda Accord and Tesla Model 3 iBoosters use the same CAN protocol
3. The minimum messages needed to exit failsafe mode
4. Seb Smith's controller — is his protocol work published anywhere?

---

## 9. Bill of Materials

| Item | Cost | Source | Notes |
|------|------|--------|-------|
| CANable 2.0 USB-CAN adapter | $40 | canable.io | For protocol sniffing |
| ESP32-CAN-X2 dual CAN board | $50 | autosportlabs.com | Gateway hardware |
| 120-ohm termination resistors x4 | $2 | DigiKey | CAN bus termination |
| Weatherproof enclosure | $15 | Amazon | For gateway in engine bay |
| Hookup wire, connectors, pins | $20 | Various | Integration wiring |
| **Total** | **~$127** | | vs. $350 for SGH controller |
| **Savings** | **$223** | | Plus: full control, Motec integration, data logging |

**Time investment:** Estimated 15-20 days of bench/testing work. The primary value is knowledge, not cost savings.

---

## 10. Key Resources and References

### Community Research
- [EVcreate iBooster CAN-BUS Research](https://www.evcreate.com/ibooster-can-bus/) — Primary community research hub
- [EVcreate Wiring the iBooster](https://www.evcreate.com/wiring-the-ibooster/) — Complete wiring guide with pinouts
- [EVcreate iBooster Performance Testing](https://www.evcreate.com/ibooster-performance/) — Measured boost ratios and decel rates
- [irate4x4 iBooster Bible](https://irate4x4.com/threads/ibooster-electric-brake-booster.394316/) — 16+ page community thread
- [DIYElectricCar Wiring Tesla iBooster](https://www.diyelectriccar.com/threads/wiring-tesla-ibooster.195506/) — Standalone wiring discussion

### CAN Protocol Data
- [joshwardell/model3dbc](https://github.com/joshwardell/model3dbc) — Tesla Model 3 DBC file with IBST_status message
- [commaai/opendbc](https://github.com/commaai/opendbc) — Tesla DBC with iBooster status signals
- [onyx-m2/onyx-m2-dbc](https://github.com/onyx-m2/onyx-m2-dbc) — Onyx M2 Tesla DBC with FrictionBrakeCmd/Status messages
- [commaai/panda](https://github.com/commaai/panda) — Panda firmware (iBooster references)
- [CarbagePilot Part 1](https://practicapp.com/carbagepilot-part1/) — 1993 Volvo with iBooster CAN control (Part 2 forthcoming with protocol details)

### Products
- [SGH Innovations V2 Controller](https://sghinnovations.com/product/ibooster-controller-ecu-gen2/) — Reference product ($350)
- [Tulay's Wire Werks Gen 2 Connector Kit](https://tulayswirewerks.com/product/bosch-ibooster-gen-2-connector-kit/) — Connector kit with pinout PDF
- [Fast and Quiet Gen 2 Connector Set](https://www.fastandquiet.com/bosch-ibooster-gen-2-connector-set) — Alternative connector source

### Motec CAN Configuration
- [HPA Forum: M130 CAN Message Assignment](https://www.hpacademy.com/forum/motec-m1-software-tutorial/show/m130-can-message-assignment) — M130 CAN receive/transmit discussion
- [Motec Forum: Custom CAN Message](https://forum.motec.com.au/viewtopic.php?f=53&t=3860) — M1 Build custom transmit functions
- [ESP32-CAN-X2 Dual CAN Board](https://www.autosportlabs.com/product/esp32-can-x2-dual-can-bus-automotive-grade-development-board/) — Automotive-grade dual CAN for gateway

### CAN Analysis Tools
- [SavvyCAN](https://www.savvycan.com/) — Open-source CAN bus analyzer
- [CANable](https://canable.io/) — Open-source USB-to-CAN adapter

---

## 11. Decision Matrix

| Approach | Cost | Dev Time | Pedal Feel Control | Motec Integration | Risk |
|----------|------|----------|-------------------|-------------------|------|
| SGH Innovations V2 | $350 | 0 days | None (fixed) | None | Low |
| Failsafe only | $0 | 0 days | None (fixed) | None | Lowest |
| M130 Dev License + native CAN | $1,200+ | 10 days | Full | Native | Medium |
| ESP32 CAN Gateway | $127 | 15-20 days | Full | Analog + optional CAN | Medium |
| ESP32 Gateway + SGH as backup | $477 | 15-20 days | Full (gateway) or fixed (SGH fallback) | Both | Lowest |

**Recommended path:** Build the ESP32 CAN Gateway. Order the SGH controller as insurance. If the reverse-engineering succeeds, return or shelve the SGH. If it stalls, install the SGH and move on.

---

## Appendix A: DBC File Fragment (Tesla Model 3 — iBooster Messages)

```dbc
BO_ 925 IBST_status: 5 PARTY
 SG_ IBST_sInputRodDriver : 21|12@0+ (0.015625,-5) [-5|47] "mm" X
 SG_ IBST_internalState : 18|3@0+ (1,0) [0|6] "" X
 SG_ IBST_driverBrakeApply : 16|2@0+ (1,0) [0|3] "" X
 SG_ IBST_iBoosterStatus : 12|3@0+ (1,0) [0|6] "" X
 SG_ IBST_statusCounter : 8|4@0+ (1,0) [0|15] "" X
 SG_ IBST_statusChecksum : 0|8@0+ (1,0) [0|255] "" X

BO_ 789 iBoosterFrictionBrakeCmd: 5 VCU
 SG_ RollingCounter : 33|2@0+ (1,0) [0|3] "" IBOOSTER
 SG_ FrictionBrakeMode : 7|4@0+ (1,0) [0|15] "" IBOOSTER
 SG_ FrictionBrakeChecksum : 23|16@0+ (1,0) [0|65535] "" IBOOSTER
 SG_ FrictionBrakeCmd : 3|12@0+ (1,0) [0|4095] "" IBOOSTER

BO_ 368 iBoosterFrictionBrakeStatus: 8 IBOOSTER
 SG_ FrictionBrakePressure : 23|16@0+ (1,0) [0|65535] "" VCU

BO_ 560 iBoosterRegen: 6 VCU
 SG_ Regen : 1|10@0+ (1,0) [0|1023] "" IBOOSTER

BO_ 545 VCFRONT_LVPowerState: 8 CH
 SG_ VCFRONT_iBoosterLVState : 24|2@0+ (1,0) [0|3] "" X
```

**Note:** This DBC data is from Tesla Model 3 CAN captures. Bit positions use DBC big-endian notation. The Honda Accord iBooster firmware may use different CAN IDs. This serves as the starting point for the reverse-engineering effort.

## Appendix B: ESP32 Gateway Starter Code (Pseudocode)

```cpp
// iBooster CAN Gateway — ESP32-CAN-X2
// Dual CAN: Port 1 = iBooster Vehicle CAN, Port 2 = iBooster YAW CAN

#include <CAN.h>

// CAN IDs (Tesla Model 3 — verify by sniffing)
#define IBST_STATUS_ID        0x39D  // 925 decimal — FROM iBooster
#define FRICTION_BRAKE_CMD_ID 0x315  // 789 decimal — TO iBooster
#define IBOOSTER_REGEN_ID     0x230  // 560 decimal — TO iBooster
#define LV_POWER_STATE_ID     0x221  // 545 decimal — TO iBooster
#define YAW_PUSHROD_ID        0x38E  // YAW bus — FROM iBooster

// State
uint8_t rolling_counter = 0;
uint8_t ibooster_status = 0;   // 0=OFF, 5=READY, 6=ACTUATION
uint32_t last_ibst_rx_ms = 0;
float pedal_position_mm = 0.0;
bool ibooster_online = false;

void setup() {
    CAN1.begin(500000);  // Vehicle CAN at 500 kbps
    CAN2.begin(500000);  // YAW CAN at 500 kbps
    // TODO: Configure CAN filters for relevant IDs
}

void loop() {
    // ---- READ: Monitor iBooster status ----
    if (CAN1.available()) {
        CAN_Frame rx = CAN1.read();
        if (rx.id == IBST_STATUS_ID) {
            last_ibst_rx_ms = millis();
            ibooster_status = (rx.data[1] >> 4) & 0x07;  // bits 12-14
            ibooster_online = true;
        }
    }

    // ---- READ: Pedal position from YAW bus ----
    if (CAN2.available()) {
        CAN_Frame rx = CAN2.read();
        if (rx.id == YAW_PUSHROD_ID) {
            uint8_t raw = rx.data[3];  // Byte 3: 0x40=idle, 0xC0=full
            pedal_position_mm = (raw - 0x40) * 0.5;  // Scale TBD
        }
    }

    // ---- WATCHDOG: Check iBooster is responding ----
    if (millis() - last_ibst_rx_ms > 200) {
        ibooster_online = false;
        // Stop sending commands — iBooster reverts to failsafe
    }

    // ---- WRITE: Send heartbeat + brake command at 50 Hz ----
    static uint32_t last_tx_ms = 0;
    if (millis() - last_tx_ms >= 20) {  // 20ms = 50 Hz
        last_tx_ms = millis();

        if (ibooster_online || millis() < 5000) {  // Always try during startup
            send_friction_brake_cmd(pedal_position_mm);
            send_regen_message(0);  // No regen on ICE vehicle
            send_lv_power_state(1);  // LV_ON
        }

        rolling_counter = (rolling_counter + 1) & 0x03;
    }
}

void send_friction_brake_cmd(float pedal_mm) {
    CAN_Frame tx;
    tx.id = FRICTION_BRAKE_CMD_ID;
    tx.len = 5;

    // Apply boost curve
    uint16_t brake_cmd = compute_boost_curve(pedal_mm);

    // Pack into DBC format (VERIFY bit positions by sniffing)
    // FrictionBrakeCmd: start bit 3, 12 bits, big-endian
    // FrictionBrakeMode: start bit 7, 4 bits
    // FrictionBrakeChecksum: start bit 23, 16 bits
    // RollingCounter: start bit 33, 2 bits

    // TODO: Exact byte packing depends on verified protocol
    tx.data[0] = (brake_cmd >> 8) & 0x0F;  // Upper 4 bits of cmd
    tx.data[0] |= (0x01 << 4);             // FrictionBrakeMode = 1
    tx.data[1] = brake_cmd & 0xFF;          // Lower 8 bits of cmd

    // Checksum (algorithm TBD — verify by sniffing)
    uint16_t checksum = compute_checksum(tx.data, rolling_counter);
    tx.data[2] = (checksum >> 8) & 0xFF;
    tx.data[3] = checksum & 0xFF;
    tx.data[4] = rolling_counter & 0x03;

    CAN1.write(tx);
}

uint16_t compute_boost_curve(float pedal_mm) {
    // Linear with adjustable gain (starting point)
    float gain = 2.0;  // Adjustable via potentiometer
    float output = pedal_mm * gain;
    if (output > 4095) output = 4095;  // 12-bit max
    if (output < 0) output = 0;
    return (uint16_t)output;
}

uint16_t compute_checksum(uint8_t* data, uint8_t counter) {
    // Placeholder — actual algorithm TBD from sniffing
    // Tesla uses: sum of all bytes + counter = 0 (mod 256)
    uint16_t sum = counter;
    for (int i = 0; i < 4; i++) sum += data[i];
    return 0x10000 - sum;
}
```

**This is pseudocode.** The exact byte packing, checksum algorithm, and message timing must be verified by CAN bus sniffing before this code becomes functional. The DBC bit positions use big-endian notation which must be translated to actual byte/bit positions in the data array.
