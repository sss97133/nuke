# Chapter 6: The Compute Engine

## How the System Derives the Harness

The compute engine is a pure function: devices go in, a complete harness specification comes out. It runs client-side in the browser in under 5 milliseconds. No API calls. No loading spinners. Add a device, remove a device — the entire harness recomputes instantly.

```
computeOverlay(devices: ManifestDevice[]) → OverlayResult
```

The input is the build manifest — every device on the vehicle with its endpoints, power draw, signal type, and location. The output is everything Desert Performance needs to know: wire count, wire specs, PDM channel assignments, ECU model recommendation, alternator sizing, warnings.

## What Gets Computed

### I/O Requirements
The engine counts inputs and outputs by type:
- Injector outputs (low-side drivers)
- Ignition outputs (logic coil drivers)
- Half-bridge outputs (motors, throttle)
- Analog inputs (pressure sensors, position sensors)
- Temperature inputs (thermistors)
- Digital inputs (switches, hall effect sensors)
- Knock inputs
- CAN buses

These counts determine which ECU models can handle the build.

### ECU Selection (Options, Not a Single Answer)
The system evaluates ALL Motec ECU models against the I/O requirements:

| Model | Inj | Ign | H-Bridge | Analog | Temp | Digital | CAN | Price |
|-------|-----|-----|----------|--------|------|---------|-----|-------|
| M130 | 8 | 8 | 6 | 9 | 4 | 8 | 1 | $3,500 |
| M150 | 12 | 12 | 10 | 17 | 6 | 16 | 3 | $5,500 |
| M1 | 16 | 16 | 16 | 24 | 8 | 24 | 4 | $8,000 |

For each model, the system reports:
- **Fits:** Does it have enough I/O for every device?
- **Headroom:** What percentage of I/O is spare?
- **Bottleneck:** If it doesn't fit, exactly which I/O type is insufficient

A basic LS3 V8 swap (8 injectors, 8 coils, basic sensors) fits an M130. Add 4 wheel speed sensors for traction control and you push past the M130's 8 digital inputs — the system flags M150 as required and tells you exactly why.

The ECU model is an OUTPUT of the equation. Not a decision you make. Not a discussion. The devices define the I/O. The I/O defines the ECU.

### PDM Configuration
Same approach — multiple PDM configurations evaluated:

| Config | Channels | Price |
|--------|----------|-------|
| PDM15 | 15 | $2,200 |
| PDM30 | 30 | $3,140 |
| 2× PDM15 | 30 | $4,400 |
| PDM30 + PDM15 | 45 | $5,340 |

Devices that draw power through the PDM are assigned to channels sorted by current draw (heaviest loads get the highest-rated channels). Small loads that logically belong together (all side markers, all interior lights) share a single channel via `pdm_channel_group`.

Not everything goes through the PDM. Devices that are direct-wired:
- Alternator (IS the power source — 220A)
- Starter motor (200A momentary — relay-triggered)
- Fuel pump Aeromotive A1000 (35A — exceeds any PDM channel)
- Bosch iBooster (40A peak — dedicated relay)
- Audio amplifier (30A — direct fused battery wire)
- All sensors (powered from ECU 5V reference)

### Wire Specification
For every device with endpoints, the engine computes:
- **Wire gauge:** From amperage + wire length + 3% max voltage drop + 25% safety margin
- **Wire color:** Deterministic by function group (injectors = green, coils = white, sensors = violet, etc.) with stripe sequence for disambiguation (injector 1 = GRN, injector 2 = GRN/WHT, injector 3 = GRN/BLK, etc.)
- **Wire length:** Estimated from device location zone with 15% slack, or measured value if vehicle_circuit_measurements exist
- **Shielding:** Flagged for crank, cam, knock sensors (VR/hall signals susceptible to noise)
- **Twisted pair:** Flagged for CAN bus (differential signaling requires matched impedance)
- **Fuse rating:** For non-PDM circuits, next standard size above 125% of continuous load

### Alternator Sizing
Total continuous current from all devices × 1.25 (25% headroom) → minimum alternator output → recommendation from stock (80A) through high-output AD244 (220A) to dual alternator.

### Configuration Matrix
The system generates ALL valid ECU × PDM combinations:

```
M130 + PDM15 = $5,700  — if both fit
M130 + PDM30 = $6,640  — if M130 fits but needs 30 channels
M150 + PDM30 = $8,640  — standard full build
M150 + PDM30 + PDM15 = $10,840  — if 30 channels isn't enough
```

Sorted by cost. The cheapest valid configuration is the recommendation. Alternatives are shown for comparison.

## The Delta

When a device is added or removed, the system computes not just the new state but the CHANGE:

```
Added: Oil Pressure Sender
  +1 device → +3 wires → +$55
  ECU: M130 (unchanged)
  PDM: unchanged (sensor, not PDM-controlled)

Added: 4× Wheel Speed Sensor
  +4 devices → +12 wires → +$320
  ECU: M130 → M150 ⚠ (exceeded 8 digital inputs)
  Cost: +$2,320 ($320 sensors + $2,000 ECU upgrade)
```

The delta is shown as a flash in the UI — green for resolved warnings, red for new ones, yellow for ECU model changes. The user sees the cascade instantly.

## Files

| File | Purpose |
|------|---------|
| `overlayCompute.ts` | Core compute function — `computeOverlay()` and `computeDelta()` |
| `useOverlayCompute.ts` | React hook — `addDevice()`, `removeDevice()`, instant recompute |
| `harnessCalculations.ts` | Foundation functions — voltage drop, gauge selection, fuse sizing |
| `harnessConstants.ts` | AWG table, wire colors, connector types, typical lengths |
| `generateCutList.ts` | Wire-by-wire bench document with sections and purchase summary |
| `generateConnectorSchedule.ts` | Pin-by-pin for ECU connectors and PDM channels |
| `generateBOM.ts` | Full bill of materials with catalog linking and labor estimation |

## Edge Function vs Client-Side

The compute runs in two places:
- **Client-side (`overlayCompute.ts`):** For instant sandbox interaction. No API calls. Runs on every device add/remove.
- **Server-side (`compute-wiring-overlay` edge function):** For persistence. Saves the computed result to `vehicle_wiring_overlays`. Called when the user is done playing in the sandbox and wants to save.

The math is identical in both. The edge function also handles database reads/writes that the client-side module doesn't.
