# COIL-TO-PIN AUTHORITATIVE MAPPING — 1977 Chevrolet K5 Blazer

**ECU:** Motec M130 (GPR-LS3 firmware) | **Coils:** ACDelco D510C (x8) | **Bracket:** Delmo Speed DEL-Stributor
**Date:** 2026-04-04 | **Status:** AUTHORITATIVE — supersedes cut list and connector schedule where they conflict

---

## THE RULE

In Motec M130 with GPR firmware for LS3:

**IGN_LS(n) = Cylinder(n)**

IGN_LS1 fires Cylinder 1. IGN_LS2 fires Cylinder 2. And so on. The LS3 firing order (1-8-7-2-6-5-4-3) is handled entirely in firmware timing tables — it does NOT affect wiring. Each output is hardwired to its cylinder number, period.

---

## LS3 CYLINDER LAYOUT

```
        FRONT OF ENGINE
        ┌─────────────┐
Driver  │  1   3   5   7  │  (left bank, front to rear)
(left)  │                 │
        │                 │
Pass.   │  2   4   6   8  │  (right bank, front to rear)
(right) │                 │
        └─────────────┘
        REAR OF ENGINE (firewall)
            ┌─────┐
            │ DEL-│
            │Strib│  <-- all 8 coils mount here
            └─────┘
```

Firing order: 1-8-7-2-6-5-4-3 (handled in firmware, NOT wiring)

---

## AUTHORITATIVE COIL-TO-PIN MAP

| M130 Pin | Motec Designation | Cylinder | Bank | Physical Position | Wire # | Wire Color | DEL-Stributor Coil Slot |
|----------|-------------------|----------|------|-------------------|--------|------------|------------------------|
| A03 | IGN_LS1 | Cyl 1 | Driver | Front | #24 | WHT/ORG | 1 — Driver front |
| A04 | IGN_LS2 | Cyl 2 | Passenger | Front | #9 | WHT/RED | 2 — Passenger front |
| A05 | IGN_LS3 | Cyl 3 | Driver | Mid-front | #5 | WHT | 3 — Driver mid-front |
| A06 | IGN_LS4 | Cyl 4 | Passenger | Mid-front | #10 | WHT/BLU | 4 — Passenger mid-front |
| A07 | IGN_LS5 | Cyl 5 | Driver | Mid-rear | #7 | WHT/WHT | 5 — Driver mid-rear |
| A08 | IGN_LS6 | Cyl 6 | Passenger | Mid-rear | #11 | WHT/YEL | 6 — Passenger mid-rear |
| A12 | IGN_LS7 | Cyl 7 | Driver | Rear | #8 | WHT/BLK | 7 — Driver rear |
| A13 | IGN_LS8 | Cyl 8 | Passenger | Rear | #12 | WHT/VIO | 8 — Passenger rear |

---

## WHAT WAS WRONG BEFORE

The cut list and connector schedule disagreed on coil numbering:

| Pin | Connector Schedule Said | Cut List Said | Truth (This Document) |
|-----|------------------------|---------------|----------------------|
| A03 | IGN_LS1 = Coil 1 | Ignition Coil 3 | **Cylinder 1** (connector schedule was correct) |
| A04 | IGN_LS2 = Coil 2 | Ignition Coil 5 | **Cylinder 2** (connector schedule was correct) |
| A05 | IGN_LS3 = Coil 3 | Ignition Coil 7 | **Cylinder 3** (connector schedule was correct) |
| A06 | IGN_LS4 = Coil 4 | Ignition Coil 2 | **Cylinder 4** (connector schedule was correct) |
| A07 | IGN_LS5 = Coil 5 | Ignition Coil 4 | **Cylinder 5** (connector schedule was correct) |
| A08 | IGN_LS6 = Coil 6 | Ignition Coil 6 | **Cylinder 6** (both agreed) |
| A12 | IGN_LS7 = Coil 7 | Ignition Coil 8 | **Cylinder 7** (connector schedule was correct) |
| A13 | IGN_LS8 = Coil 8 | Ignition Coil 1 | **Cylinder 8** (connector schedule was correct) |

The cut list had attempted to map pins to cylinders via the firing order sequence — e.g., A03 (first ignition output) fires the first cylinder in the firing order (Cyl 1), then A04 fires the second in firing order (Cyl 8), etc. But the Motec M130 GPR firmware does not work that way. Each IGN_LS output is permanently bound to its cylinder number. The firmware handles firing order timing internally.

**The connector schedule was correct. The cut list labels were wrong.** The cut list wire numbers (#5, #7, #8, #9, #10, #11, #12, #24) and colors are unchanged — only the cylinder assignments on those wires change.

---

## D510C COIL PINOUT

Each ACDelco D510C (GM P/N 12611424) ignition coil has a 4-pin connector:

| Pin | Function | Wire Source | Gauge | Notes |
|-----|----------|-------------|-------|-------|
| A | IC (Ignition Control) signal | M130 IGN_LS(n) output | 20 AWG | Logic-level signal from ECU |
| B | Low reference (ground) | Sensor ground bus | 20 AWG | Connect to M130 SEN_0V or dedicated coil ground bus |
| C | B+ power (ignition voltage) | Coil power bus | 16 AWG | Switched 12V from PDM30 or dedicated coil relay |
| D | Chassis ground | Chassis ground point | 16 AWG | Connect to engine block or chassis ground stud |

### Coil Power Bus

All 8 coils share a common B+ power feed (Pin C) and chassis ground (Pin D). These are NOT individual wires from the M130 — they come from a power distribution bus:

- **B+ source:** PDM30 dedicated output or ignition relay, 12 AWG minimum feed wire to coil bus
- **Ground:** Dedicated ground stud on DEL-Stributor bracket or engine block, 12 AWG minimum
- **Bus wire:** 16 AWG TXL daisy-chain or bus bar on the DEL-Stributor bracket

### Per-Coil Wiring Summary

Each coil on the DEL-Stributor needs exactly 4 connections:
1. **IC signal** — individual 20 AWG wire from M130 (the 8 wires in the map above)
2. **Low reference** — individual or bussed 20 AWG to sensor ground
3. **B+ power** — bussed 16 AWG from coil power relay/PDM output
4. **Chassis ground** — bussed 16 AWG to chassis/engine ground

The 8 IC signal wires route as a single bundle from M130 Connector A through the firewall to the DEL-Stributor bracket. The B+ and ground bus wires are short local connections on the bracket.

---

## DEL-STRIBUTOR BRACKET

**Manufacturer:** Delmo Speed
**Part Number:** DELSTRIB01
**Price:** $149.00 (currently sold out)
**Material:** Billet aluminum
**Compatibility:** LS1 and LS3 engines with D510C coils
**Mounts:** Rear-center of engine, near firewall
**URL:** https://delmospeed.com/products/del-stributer
**Component Library ID:** e37ba5d6-047a-449f-ac3f-62499173182c

### What It Does

The DEL-Stributor relocates all 8 ignition coils from the valve cover mounting positions to a single bracket at the rear of the engine. This gives the engine a vintage distributor-like appearance from above — all spark plug wires radiate from a central point instead of being clamped to the valve covers.

### Installation Notes

- Coils and individual coil relocation brackets are sold separately (the DEL-Stributor is the central hub bracket only)
- Requires individual coil relocation brackets to mount each D510C to the hub
- Delmo Speed also sells a complete kit ($619-$829) with all brackets, coils, and harness
- Delmo Speed LS Coil Harness ($59) available for the B+/ground bus wiring
- Spark plug wires must be long enough to reach from the central bracket to each cylinder

### Impact on Harness

Moving coils from valve covers to a central bracket changes the wire routing:
- **Before (stock):** 8 IC signal wires branch from the engine loom trunk to individual coils on each valve cover. Each wire is a different length.
- **After (DEL-Stributor):** All 8 IC signal wires terminate at one location near the firewall. Wire lengths are nearly equal. The entire coil signal bundle is simpler — straight run from firewall grommet to bracket.
- **Benefit:** Cleaner harness, shorter ignition wires, easier to build and service
- **All 8 coil wires use the same length** (approximately 2-3 ft from firewall grommet to bracket)

---

## CUT LIST CORRECTIONS

The following wire labels in the cut list must be updated to match this authoritative mapping:

| Wire # | Cut List Currently Says | Should Say | Pin |
|--------|------------------------|------------|-----|
| #24 | Ignition Coil 1 | Ignition Coil 1 (Cyl 1) | M130:A03 (was A13) |
| #5 | Ignition Coil 3 | Ignition Coil 1 (Cyl 1) ... | M130:A03 ... |

**Wait — this needs careful treatment.** The cut list wire numbers are arbitrary identifiers. What matters is which pin each wire connects to and which cylinder's coil it drives. Let me state the corrections precisely:

### Corrected Cut List Entries (Engine Loom — Ignition Coils)

| Wire # | Label | M130 Pin | Gauge | Color | Length | Notes |
|--------|-------|----------|-------|-------|--------|-------|
| #24 | Ignition Coil — Cyl 1 | M130:A03 | 20 AWG TXL | WHT/ORG | 4.6ft | Driver front. DEL-Stributor slot 1. |
| #9 | Ignition Coil — Cyl 2 | M130:A04 | 20 AWG TXL | WHT/RED | 4.6ft | Passenger front. DEL-Stributor slot 2. |
| #5 | Ignition Coil — Cyl 3 | M130:A05 | 20 AWG TXL | WHT | 4.6ft | Driver mid-front. DEL-Stributor slot 3. |
| #10 | Ignition Coil — Cyl 4 | M130:A06 | 20 AWG TXL | WHT/BLU | 4.6ft | Passenger mid-front. DEL-Stributor slot 4. |
| #7 | Ignition Coil — Cyl 5 | M130:A07 | 20 AWG TXL | WHT/WHT | 4.6ft | Driver mid-rear. DEL-Stributor slot 5. |
| #11 | Ignition Coil — Cyl 6 | M130:A08 | 20 AWG TXL | WHT/YEL | 4.6ft | Passenger mid-rear. DEL-Stributor slot 6. |
| #8 | Ignition Coil — Cyl 7 | M130:A12 | 20 AWG TXL | WHT/BLK | 4.6ft | Driver rear. DEL-Stributor slot 7. |
| #12 | Ignition Coil — Cyl 8 | M130:A13 | 20 AWG TXL | WHT/VIO | 4.6ft | Passenger rear. DEL-Stributor slot 8. |

### What Changed

1. **Pin assignments corrected:** Wire #24 was on A13 (IGN_LS8), now correctly mapped to A03 (IGN_LS1) for Cylinder 1. All 8 wires remapped to match IGN_LS(n) = Cylinder(n).
2. **Labels clarified:** Each wire now says "Ignition Coil — Cyl N" to eliminate ambiguity between Motec channel numbers and cylinder numbers.
3. **DEL-Stributor slot numbers added:** Since all coils mount on the central bracket, slot positions are noted for build reference.
4. **Wire numbers and colors unchanged:** The physical wires are the same — only which pin they terminate at changed.

### Corrected Wire Labels

| Wire # | Old Near-End Label | New Near-End Label | Old Far-End Label | New Far-End Label |
|--------|-------------------|-------------------|------------------|------------------|
| #24 | M130:A13 IGN1 20 | M130:A03 CYL1 IGN 20 | COIL1 DRV IGN1 20 | CYL1 COIL IGN 20 |
| #9 | M130:A06 IGN2 20 | M130:A04 CYL2 IGN 20 | COIL2 PASS IGN2 20 | CYL2 COIL IGN 20 |
| #5 | M130:A03 IGN3 20 | M130:A05 CYL3 IGN 20 | COIL3 DRV IGN3 20 | CYL3 COIL IGN 20 |
| #10 | M130:A07 IGN4 20 | M130:A06 CYL4 IGN 20 | COIL4 PASS IGN4 20 | CYL4 COIL IGN 20 |
| #7 | M130:A04 IGN5 20 | M130:A07 CYL5 IGN 20 | COIL5 DRV IGN5 20 | CYL5 COIL IGN 20 |
| #11 | M130:A08 IGN6 20 | M130:A08 CYL6 IGN 20 | COIL6 PASS IGN6 20 | CYL6 COIL IGN 20 |
| #8 | M130:A05 IGN7 20 | M130:A12 CYL7 IGN 20 | COIL7 DRV IGN7 20 | CYL7 COIL IGN 20 |
| #12 | M130:A12 IGN8 20 | M130:A13 CYL8 IGN 20 | COIL8 PASS IGN8 20 | CYL8 COIL IGN 20 |

Note: Far-end labels no longer say "DRV" or "PASS" because with the DEL-Stributor, all coils are at a central location — the bank distinction is only relevant for the spark plug wire routing, not the coil wire routing.

---

## CONNECTOR SCHEDULE CORRECTIONS

The connector schedule (K5_connector_schedule.txt) was already correct for pin-to-designation mapping. The only change needed is updating the "ASSIGNED TO" column to use cylinder numbers:

| Pin | Function | Old Assignment | New Assignment |
|-----|----------|---------------|---------------|
| A03 | IGN_LS1 | Ignition Coil 1 | Ignition Coil — Cyl 1 (D510C on DEL-Stributor) |
| A04 | IGN_LS2 | Ignition Coil 2 | Ignition Coil — Cyl 2 (D510C on DEL-Stributor) |
| A05 | IGN_LS3 | Ignition Coil 3 | Ignition Coil — Cyl 3 (D510C on DEL-Stributor) |
| A06 | IGN_LS4 | Ignition Coil 4 | Ignition Coil — Cyl 4 (D510C on DEL-Stributor) |
| A07 | IGN_LS5 | Ignition Coil 5 | Ignition Coil — Cyl 5 (D510C on DEL-Stributor) |
| A08 | IGN_LS6 | Ignition Coil 6 | Ignition Coil — Cyl 6 (D510C on DEL-Stributor) |
| A12 | IGN_LS7 | Ignition Coil 7 | Ignition Coil — Cyl 7 (D510C on DEL-Stributor) |
| A13 | IGN_LS8 | Ignition Coil 8 | Ignition Coil — Cyl 8 (D510C on DEL-Stributor) |

The old assignment was already correct (IGN_LS1 = Coil 1 = Cyl 1). The update adds the cylinder number and DEL-Stributor reference for clarity.

---

*This document is the single source of truth for coil wiring on this build. If the cut list, connector schedule, wire labels, or build sheets disagree with this document, this document wins.*
