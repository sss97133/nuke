# Appendix D: The 1977 K5 Blazer Build

## Vehicle Identity

| Field | Value |
|-------|-------|
| Vehicle ID | `e04bf9c5-b488-433b-be9a-3d307861d90b` |
| VIN | CCL187Z210370 |
| Year/Make/Model | 1977 Chevrolet Blazer (K5) |
| Owner/Client | Scott (scott@li3go.com) |
| Builder | NUKE LTD, 676 Wells Rd, Boulder City NV 89005 |
| Wiring Sub | Desert Performance (same address) |

## Build Specification

| System | Component | Status |
|--------|-----------|--------|
| Engine | Delmo Speed LS3 (cosmetic kit on GM LS3 crate) | Installed |
| ECU | Motec M130 with GPR firmware | Purchased, system recommends M130 |
| PDM | Motec PDM30 (30 channels) | Purchased, at 30/30 capacity |
| Brakes | Bosch iBooster Gen 2 (salvage Tesla + Tulay connector) | In progress |
| Gauges | Dakota Digital VHX-73C-PU | Ordered |
| Fuel Pump | Aeromotive A1000 (dedicated relay, not PDM) | Planned |
| Parking Brake | E-Stopp ESK001 electric actuator | Planned |
| Steps | AMP Research PowerStep via Far From Stock P300 | Ordered |
| Windows | Nu-Relics NR17380201 power conversion | Ordered |
| Locks | Dorman 746-014 actuators | Planned |
| Headlights | Truck-Lite 27270C LED | Ordered |
| Taillights | United Pacific CTL7387LED | Ordered |
| Audio | RetroSound Hermosa + Kicker amp/speakers/sub | Planned |
| Camera | Rear backup, reverse-triggered | Planned |

## Invoice History

| Invoice | Date | Amount | Cumulative |
|---------|------|--------|-----------|
| SW77002 | Oct 2023 | $42,379 | $42,379 |
| SW77003 | Feb 2024 | $18,946 | $61,325 |
| SW77005 | Sep 2024 | $28,540 | $89,865 |
| SW77006 | Mar 2025 | $29,678 | $119,543 |

## Wiring System Outputs

### Computed Configuration
- **ECU:** M130 (fits all I/O requirements, $2,000 savings over M150)
- **PDM:** PDM30 at 30/30 channels (grouped small loads: markers, interior, backup)
- **Total wires:** 110
- **Total wire length:** 805 ft
- **Shielded cables:** 4 (crank, cam, knock ×2)
- **Estimated BOM:** $19,966 (parts $16,391 + labor $3,575)

### Key Engineering Decisions
1. **M130 over M150:** I/O analysis showed M130 handles all 8 injectors, 8 coils, 7 digital inputs, 1 CAN bus. M150 only needed if adding traction control or wheel speed inputs.
2. **PDM at capacity:** 30/30 channels used by grouping small loads. Adding any device requires PDM15 expansion or load grouping.
3. **Fuel pump NOT on PDM:** Aeromotive A1000 draws 35A peak — dedicated relay with Aeromotive 16301 wiring kit.
4. **iBooster NOT on PDM:** Bosch iBooster draws 40A peak — dedicated relay, integrated ECU.
5. **Dual sender strategy:** Factory gauge senders kept for Dakota Digital, separate Motec sensors for ECU. Not elegant, cheapest path to professional engine management without replacing gauge cluster.

## Build Manifest Summary

115 devices in `vehicle_build_manifest`:
- 22 actuators (motors, solenoids, coils, injectors)
- 18 sensors (pressure, temp, position, speed, O2)
- 15 lighting devices (headlights, markers, signals, interior)
- 8 switches/inputs (headlight, turn, wiper, blower, ignition, door, reverse, transfer case)
- 5 audio components (head unit, amp, speakers, sub, camera)
- 3 ECU/PDM/controller units
- 44 other (relays, fuses, connectors, brackets, harness sections)

## What's Left

1. **Validate PDM30 pin map** — still scaffolded (39 pins), needs Motec PDM30 wiring manual
2. **Physical measurements** — all wire lengths are estimated from zone distances, need actual measurements on vehicle
3. **Harness routing** — conceptual (engine loom, dash loom, rear loom), needs physical routing plan
4. **ECU programming** — M1 firmware configuration, I/O assignments, sensor calibration
5. **PDM programming** — channel assignments, current limits, soft-start profiles, grouped load logic
