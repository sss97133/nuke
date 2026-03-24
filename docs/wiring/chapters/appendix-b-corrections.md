# Appendix B: Validated Corrections Log

Every data point that was found to be wrong and what fixed it. This is the audit trail.

## Factory Harness Circuit Color Corrections

All corrections verified against GM 1973 Service Manual Section 8C Circuit Identification Table.

| Date | Circuit | Field | Was | Now | GM Circuit # | Source |
|------|---------|-------|-----|-----|-------------|--------|
| 2026-03-22 | CHARGE_SENSE | wire_color_gm | BRN | DK BLU | 26 | GM Circuit ID Table |
| 2026-03-22 | HEATER_BLOWER | wire_color_gm | ORN | PPL | 65 | GM Circuit ID Table |
| 2026-03-22 | IGN_RUN | notes | — | Correct reference verified | 3 | GM Circuit ID Table |
| 2026-03-22 | Various (11 more) | wire_color_gm | Various | Various | Various | GM Circuit ID Table - batch cross-reference |
| 2026-03-23 | RADIO_SPEAKER_L | wire_color_gm | LT GRN | TAN | 201 | GM Circuit ID Table (left stereo) |
| 2026-03-23 | RADIO_SPEAKER_R | wire_color_gm | DK GRN | LT GRN | 200 | GM Circuit ID Table (right/single) |
| 2026-03-23 | WASHER_PUMP | wire_color_gm | DK BLU | PNK | 94 | GM Circuit ID Table |
| 2026-03-23 | GAUGE_FEED | notes | — | Verified PNK correct | 3/50 | GM Circuit ID Table |

**Total corrections: 17** (14 on 2026-03-22, 3 on 2026-03-23)

## ECU Pin Map Corrections

| Date | Model | Issue | Resolution | Source |
|------|-------|-------|-----------|--------|
| 2026-03-23 | M130 | ALL 60 PINS WRONG | Entire pin map was scaffolded from training data. Injectors were placed at A1-A8 (actually A19-A22, A27-A30). Ignition at A9-A16 (actually A03-A08, A12-A13). Complete replacement with authoritative data. | MoTeC M1 ECU Hardware Tech Note p16 |
| 2026-03-23 | M150 | ALL 120 PINS WRONG | Same issue. Complete replacement. Key finding: M150 Connectors C+D are IDENTICAL pinout to M130 Connectors A+B. An M130 harness works with M150 by adding Connectors A+B. | MoTeC M1 ECU Hardware Tech Note p24 |

**This was the most dangerous scaffold in the system.** Wrong pin assignments on an ECU = fried components. The scaffolded data had the right pin TYPES in approximately the right QUANTITIES but completely wrong pin POSITIONS. Every pin was moved.

### Key Differences: Scaffolded vs Real (M130)

| Pin | Scaffolded Function | REAL Function |
|-----|-------------------|---------------|
| A01 | Injector 1 | Half Bridge Output 2 |
| A02 | Injector 2 | Sensor 5V Supply A |
| A03 | Injector 3 | Ignition Low Side 1 |
| A09 | Ignition 1 | Sensor 5V Supply B |
| A17 | Crank Input | Analog Voltage Input 4 |
| A19 | Half Bridge 1 (unused) | Peak Hold Injector 1 |
| A27 | Sensor Ground A | Peak Hold Injector 5 |

Every single assignment was wrong. The scaffold was constructed by an LLM that knew M130 has "8 injectors and 8 ignition outputs" but didn't know WHICH pins they're on.

## Abbreviation Corrections

| Date | Field | Was | Now | Scope |
|------|-------|-----|-----|-------|
| 2026-03-22 | wire_color_gm | ORG | ORN | All circuits (standardized Orange abbreviation) |

## Circuit Verification Summary

As of 2026-03-23:
- 40 of 71 factory circuits: **MATCH** (color verified against GM Circuit ID table)
- 3 circuits: **CORRECTED** (color fixed per GM table)
- 1 circuit: **PARTIAL MATCH** (START_SOLENOID: factory PPL/WHT vs GM PPL solid — stripe may be year-specific)
- 8 circuits: **MAPPING UNCERTAIN** (mapped to wrong GM circuit numbers in cross-reference, actual colors may be correct)
- 19 circuits: **NO GM MATCH** (TBI/EFI circuits use 400-series numbers not in basic cross-ref, clearance lights are sub-circuits)
