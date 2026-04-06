# K5 Blazer Wire Specification & Cost Analysis
## MIL-W-22759/32 Tefzel (Professional Tier) + M130 Fuel Level Analysis

**Generated:** 2026-04-05
**Build:** 1977 Chevrolet K5 Blazer — LS3 / Motec M130 / PDM30
**Tier:** Professional (per Chapter 03 Tier System)
**Wire Spec:** M22759/32 cross-linked ETFE (Tefzel), 150C rated
**Supplier:** ProWire USA (primary), RaceSpec Online (reference pricing)

---

## JOB 1: Motec M130 Fuel Level Sender Analysis

### Can the M130 Read a Fuel Level Sender?

**Yes, but it requires a pull-up resistor circuit.** The M130 has no dedicated fuel level input, but any of its 8 Analog Voltage (AV) inputs can read a resistive fuel sender with the right signal conditioning.

### M130 Input Inventory

| Input Type | Count | Pins | Specification |
|-----------|-------|------|---------------|
| Analog Voltage (AV) | 8 | A14-A17 + 4 more | 0-6.098V range, 12-bit ADC (1.49mV resolution), 100K impedance |
| Analog Temperature (AT) | 4 | B03-B06 | Built-in 1K pull-up to 5V, designed for NTC thermistors |
| Digital Inputs | 7 | Various | Logic level |
| Knock Inputs | 2 | B07, B13 | Piezoelectric |

### The Problem with AT Inputs for Fuel Level

The AT inputs have a fixed 1K ohm pull-up to 5V. With a GM 0-90 ohm sender:
- **Empty (0 ohm):** V = 5V x (0 / (0 + 1000)) = 0.000V
- **Full (90 ohm):** V = 5V x (90 / (90 + 1000)) = 0.413V

That gives only **0.413V of range** across the full fuel level sweep. With AT resolution of ~3.66mV, that is only **~113 discrete steps** — technically usable but noisy and low resolution for a sloshing fuel tank.

### Recommended: AV Input with External Pull-Up Resistor

Use an AV input (one of A14-A17 or the additional four) with a calculated external pull-up resistor to 5V (SEN_5V_A or SEN_5V_B).

**Circuit:** SEN_5V (5V) → Pull-up resistor → AV input pin ← Fuel sender → SEN_0V (ground)

**Optimal pull-up for 0-90 ohm GM sender:**

A 270 ohm pull-up resistor gives the best voltage spread:
- **Empty (0 ohm):** V = 5V x (0 / (0 + 270)) = 0.000V
- **Full (90 ohm):** V = 5V x (90 / (90 + 270)) = 1.250V
- **Usable range:** 0.0V - 1.25V
- **Resolution:** 1.49mV per step = **~839 discrete steps across full range**
- **Max current at 5V:** 5V / 270 ohm = 18.5mA (well under the 200mA max for SEN_5V rail)

A 330 ohm pull-up is also acceptable:
- **Full (90 ohm):** V = 5V x (90 / (90 + 330)) = 1.071V
- **Usable range:** 0.0V - 1.07V
- **Resolution:** ~718 steps

**Either value works.** The 270 ohm gives better resolution. Both are safe for the 5V supply.

### What Does Motec Software Do with Fuel Level?

1. **Display only.** The M1 software can read the AV channel, apply a calibration table (ohm-to-percentage or voltage-to-percentage), and transmit the value over CAN to a dash (C125, C127, or Dakota Digital via CAN bridge).

2. **Fuel consumption is NOT calculated from fuel level.** The M1 calculates "Fuel Used" from injector pulse width, duty cycle, and injector characterization data. The fuel level sender is independent of this calculation.

3. **Low fuel warning.** The M1 software supports alarms/warnings based on any channel value. A "Fuel Level < 15%" alarm can be configured to trigger a dash warning LED or message.

4. **No fuel trim dependency.** The fuel level sender does not affect fuel delivery calculations, lambda targets, or any closed-loop control. It is purely informational.

### GM K5 Blazer Fuel Sender Specs

| Parameter | Value |
|-----------|-------|
| Type | Variable resistance, float arm |
| Empty | 0 ohm (some sources say ~1.8 ohm) |
| Full | 90 ohm |
| GM era | 1965-1997 standard (0-90 ohm) |
| Wire count | 2 (signal + ground to tank/body) |
| Note | Pre-1965 GM used 0-30 ohm; 1998+ uses 40-250 ohm |

### Signal Conditioner Required?

**No.** The GM 0-90 ohm sender can be read directly by the M130 AV input with a single external pull-up resistor (270 ohm, 1/4W). No signal conditioner, amplifier, or interface module is needed.

### Implementation for the K5 Cut List

Wire #98 (Fuel Level Sender) is already in the cut list as 20 AWG, 18.4ft, routed to "ECU". The specific M130 pin should be assigned to an available AV input (suggest AV5 or higher, since AV1-AV4 are used for TPS1, MAP, fuel pressure, and TPS2).

**Hardware needed:** One 270 ohm 1/4W resistor soldered between the AV input pin and SEN_5V at the ECU connector. Total cost: ~$0.05.

### Calibration Procedure

1. In M1 Tune, configure the selected AV input as "Fuel Tank Level Sensor"
2. Create a 2-point calibration: 0V = Empty (0%), 1.25V = Full (100%)
3. Apply damping/filtering (2-5 second moving average) to smooth fuel slosh
4. Set up CAN transmit for the fuel level channel to the dash display
5. Optionally configure a low-fuel alarm at 15% (0.19V)

---

## JOB 2: AWG to mm2 Cross-Reference — M22759/32 Tefzel

### Wire Specification Correction

The cut list v2 header says "TXL tier." **This is incorrect.** The K5 build is Professional tier per Chapter 03. The wire being purchased is **M22759/32 Tefzel** from ProWire USA, not TXL.

### Critical Finding: M22759/32 Maxes Out at 12 AWG

The MIL-W-22759/32 specification covers **28 AWG through 12 AWG only.** It does not exist in 10, 8, 6, 4, or 2 AWG. For larger gauges, use **M22759/16** (standard-wall ETFE, same 150C rating, same Tefzel insulation, thicker wall).

### Complete Cross-Reference Table

| AWG | mm² | Motec Size | M22759/32 | M22759/16 | Use in K5 Build | Cut List Wires |
|-----|-----|-----------|-----------|-----------|-----------------|----------------|
| 24 | 0.22 | 0.22mm² | Yes | Yes | CAN bus, Ethernet | #62 (CAN twisted pair) |
| 22 | 0.35 | 0.35mm² | Yes | Yes | Sensors, signals, grounds | #4c-f, #53, #65, #94-96, #99-113 (21 wires) |
| 20 | 0.50 | 0.50mm² | Yes | Yes | Coils, indicators, cameras | #5-12, #24, #58, #60, #64, #67-69, #73-74, #97-98 (18 wires) |
| 18 | 0.75 | 0.75mm² | Yes | Yes | Injectors, ETB motor, lights, speakers | #4a-b, #13-20, #23, #26a-31, #33, #38, #41-44, #46-47, #50, #57, #70-72, #75-93 (49 wires) |
| 16 | 1.0 | 1.0mm² | Yes | Yes | PDM outputs, headlights, transfer case | #55, #85-86 (3 wires) |
| 14 | 2.0 | 2.0mm² | Yes | Yes | Power switches, motors, steps | #1-3, #25, #36-37, #39, #45, #48-49, #54, #56, #72 (16 wires) |
| 12 | 3.0 | 3.0mm² | Yes | Yes | Window motors, fans, blower | #21-22, #34-35, #51 (5 wires) |
| 10 | 5.0 | 5.0mm² | **NO** | Yes | Fuel pump, iBooster | #52, #66 (2 wires) |
| 8 | 8.0 | 8.0mm² | **NO** | Yes | Alternator, amplifier | #32, #59 (2 wires) |
| 4 | 21.0 | 21.0mm² | **NO** | **NO** | Starter, battery disconnect | #6, #63 (2 wires) |

### Wire Spec by Gauge for K5 Build

| AWG | Spec to Order | Part Number Pattern | Temp | Insulation | Notes |
|-----|--------------|-------------------|------|------------|-------|
| 24 | M22759/32-24-* | Solid: -24-[0-9], Stripe: -24-[XY] | 150C | XL-ETFE (Tefzel) | Thinnest, CAN/Ethernet only |
| 22 | M22759/32-22-* | Solid: -22-[0-9], Stripe: -22-[XY] | 150C | XL-ETFE (Tefzel) | Primary sensor wire |
| 20 | M22759/32-20-* | Solid: -20-[0-9], Stripe: -20-[XY] | 150C | XL-ETFE (Tefzel) | Coils, indicators |
| 18 | M22759/32-18-* | Solid: -18-[0-9], Stripe: -18-[XY] | 150C | XL-ETFE (Tefzel) | Injectors, most circuits |
| 16 | M22759/32-16-* | Solid: -16-[0-9], Stripe: -16-[XY] | 150C | XL-ETFE (Tefzel) | Medium power |
| 14 | M22759/32-14-* | Solid: -14-[0-9], Stripe: -14-[XY] | 150C | XL-ETFE (Tefzel) | Switches, motors |
| 12 | M22759/32-12-* | Solid: -12-[0-9] | 150C | XL-ETFE (Tefzel) | Heavy loads |
| 10 | M22759/16-10-* | Solid: -10-[0-9] | 150C | ETFE (Tefzel) | Fuel pump, iBooster |
| 8 | M22759/16-8-* | Solid: -8-[0-9] | 150C | ETFE (Tefzel) | Alternator, amp power |
| 4 | Welding cable or marine-grade | N/A | 105C+ | PVC/rubber | Starter, battery disconnect |

### M22759/32 Color Code System

The last digit in the part number encodes the base color:

| Code | Color | Code | Color |
|------|-------|------|-------|
| 0 | Black | 5 | Green |
| 1 | Brown | 6 | Blue |
| 2 | Red | 7 | Violet |
| 3 | Orange | 8 | Gray |
| 4 | Yellow | 9 | White |

Striped wire uses two digits: base color + stripe color. Example: M22759/32-22-92 = 22 AWG, White with Red stripe.

---

## JOB 3: ProWire USA / RaceSpec M22759/32 Catalog & Cost Analysis

### Pricing Summary by Gauge (RaceSpec Online reference prices, April 2026)

| AWG | Solid $/ft | Striped $/ft | Min Order | Colors Available |
|-----|-----------|-------------|-----------|-----------------|
| 28 | $0.36 | N/A | 100 ft | Limited (Black) |
| 26 | $0.38 | N/A | 100 ft | Limited (Black) |
| 24 | $0.42 | $0.48 | 100 ft | 10 solid + striped combos |
| 22 | $0.52 | $0.60 | 100 ft | 10 solid + 9 base x 9 stripe = 90+ combos |
| 20 | $0.70 | $0.76-$0.98 | 100 ft | 10 solid + striped combos |
| 18 | $1.30 (solid) | $1.38 (striped) | 50 ft | 10 solid + 14+ striped combos |
| 16 | $1.38 | $1.48-$1.79 | 50 ft | 10 solid + striped combos |
| 14 | $2.30 | $2.30-$2.95 | 50 ft | 10 solid + 14 striped combos |
| 12 | $3.30 | N/A | 50 ft | 10 solid (Yellow/Green: $4.50) |
| 10 | $4.60 (M22759/16) | N/A | 50 ft | 5 colors (Black, Red, White, Gray, Yellow) |
| 8 | $9.25 (M22759/16) | N/A | 25 ft | 2 colors (Black, Red) |

### ProWire USA Part Number System

Format: `M22759/32-[AWG]-[COLOR CODE]`

Examples:
- `M22759/32-22-9` = 22 AWG White solid
- `M22759/32-18-29` = 18 AWG Red/White striped
- `M22759/32-14-0` = 14 AWG Black solid
- `M22759/16-10-2` = 10 AWG Red (note: /16 for this gauge)

### Color Availability by Gauge (Solid)

All gauges 12-24 AWG carry the full 10-color palette:
Black (0), Brown (1), Red (2), Orange (3), Yellow (4), Green (5), Blue (6), Violet (7), Gray (8), White (9)

10 AWG (M22759/16): Black, Red, White, Gray, Yellow only
8 AWG (M22759/16): Black, Red only

### Striped Wire Availability

Striped M22759/32 Tefzel is available in:
- **22 AWG:** 9 base colors x 9 stripe colors = extensive catalog
- **20 AWG:** Multiple base/stripe combinations
- **18 AWG:** 14+ combinations (White/X, Red/X, Black/X)
- **16 AWG:** Multiple combinations
- **14 AWG:** 14 combinations (White/X, Red/X)
- **24 AWG:** Limited striped options

### K5 Build Wire Cost — Tefzel vs TXL

Using cut list v2 quantities (123 wires, 905.4 ft needed, order quantities rounded up):

#### Wire Cost Calculation by Gauge

| AWG | Order Qty | # Colors | Type | Solid/Stripe Mix | $/ft (avg) | Subtotal |
|-----|-----------|----------|------|------------------|-----------|----------|
| 4 | 10 ft | 2 | Welding/marine | N/A | $2.50 | $25.00 |
| 8 | 25 ft | 2 | M22759/16 | Solid | $9.25 | $231.25 |
| 10 | 25 ft | 2 | M22759/16 | Solid | $4.60 | $115.00 |
| 12 | 50 ft | 5 | M22759/32 | Solid | $3.30 | $165.00 |
| 14 | 200 ft | 16 | M22759/32 | ~50% striped | $2.50 | $500.00 |
| 16 | 25 ft | 3 | M22759/32 | ~50% striped | $1.50 | $37.50 |
| 18 | 450 ft | 49 | M22759/32 | ~60% striped | $1.35 | $607.50 |
| 20 | 150 ft | 18 | M22759/32 | ~40% striped | $0.74 | $111.00 |
| 22 | 200 ft | 21 | M22759/32 | ~50% striped | $0.56 | $112.00 |
| 22 TP | 10 ft | 1 | Twisted pair | Shielded CAN | $2.50 | $25.00 |
| 22 SH | 25 ft | 4 | Shielded 2C | Shielded sensor | $3.50 | $87.50 |
| **TOTAL** | **1,170 ft** | **123** | | | | **$2,016.75** |

#### Cost Comparison

| Wire Type | Total Cost | Cost/ft (avg) | Temp Rating | Insulation |
|-----------|-----------|---------------|-------------|------------|
| TXL (Enthusiast) | ~$172 | ~$0.15 | 125C | Thin-wall XL polyethylene |
| **M22759/32 Tefzel (Professional)** | **~$2,017** | **~$1.72** | **150C** | **Cross-linked ETFE** |
| M22759/44 (Ultra) | ~$3,400+ | ~$2.90 | 200C | XL ETFE, silver-plated conductor |

**The Tefzel wire upgrade costs approximately $1,845 more than TXL** for the same 123 wires. This is the single largest cost difference between Enthusiast and Professional tier harness materials.

### Minimum Order Impact

M22759/32 Tefzel has minimum orders of 50-100 ft per color per gauge. For a build using 49 colors of 18 AWG wire, the minimum order rules mean ordering significantly more wire than needed. The 450 ft order quantity already accounts for this — individual color runs may be as short as 3.5 ft but you must order 50 ft minimum.

**Practical approach:** Order the 10-15 most-used colors in full 50/100 ft minimum orders. For single-run colors used in only one 3.5 ft wire, consider:
1. Ordering the minimum and keeping the remainder as stock
2. Using a solid color + heat-shrink label instead of a unique stripe color
3. Grouping similar circuits onto the same color and relying on labels for identification

This could reduce the actual wire spend from ~$2,017 to ~$1,400-1,600 by being strategic about color selection.

### Recommended Order Strategy

**Priority colors to order in bulk (used across many wires):**
- 18 AWG White (used in 8+ lighting circuits): 50 ft minimum, $1.30/ft = $65
- 18 AWG Brown series (tail/marker lights): 50 ft per color x 5 colors = $325
- 18 AWG Orange series (switches): 50 ft per color x 4 colors = $260
- 22 AWG assorted (sensors): 100 ft minimum per color

**Colors that can consolidate (only 1 wire each):**
- 18 AWG exotic stripes (ORN/BLK/RED, ORN/BLK/BLU, etc.) — these three-color stripes do NOT exist in M22759/32. Use a two-color stripe + label, or a solid color + label.

### Three-Color Stripe Problem

The cut list v2 specifies several three-color combinations (e.g., ORN/BLK/RED, ORN/BLK/BLU, ORN/BLK/YEL, ORN/WHT/BLK). **M22759/32 Tefzel is only available in solid and two-color stripe.** Three-color stripe wire does not exist in this specification.

**Solution:** Map three-color codes to available two-color M22759/32 equivalents:

| Cut List Color | Substitute M22759/32 Color | Wire # |
|---------------|---------------------------|--------|
| ORN/BLK/RED | Orange/Red | #50 Washer Pump |
| ORN/BLK/YEL | Orange/Yellow | #54 E-Brake |
| ORN/BLK/BLU | Orange/Blue | #51 Blower Motor |
| ORN/BLK/BLK | Orange/Black | #3 AMP Step Controller |
| ORN/BLK/WHT | Orange/Brown | #2 AMP Step Right |
| ORN/WHT/BLK | White/Orange | #30b Subwoofer (-) |

Differentiation is maintained through heat-shrink labels at both ends per the existing labeling plan.

---

## Appendix A: M22759/32 Technical Specifications

| Parameter | Value |
|-----------|-------|
| Specification | MIL-DTL-22759/32 (SAE AS22759/32) |
| Conductor | Tin-plated copper (TC) |
| Insulation | Cross-linked modified ETFE (Tefzel) |
| Temperature range | -65C to +150C |
| Voltage rating | 600V RMS |
| Impulse dielectric | 8.0 kV peak |
| Insulation thickness | 0.005" (0.127mm) minimum |
| Insulation resistance | 5,000 megohm per 1000 ft minimum |
| Gauge range | 28 AWG to 12 AWG |
| Weight savings vs TXL | ~15-25% (thinner insulation, same conductor) |
| Chemical resistance | Fuels, oils, hydraulic fluids, solvents |
| Abrasion resistance | Superior to TXL |
| Flame retardant | Yes (self-extinguishing) |
| Crosslinked | Yes (radiation crosslinked — maintains integrity if insulation is nicked) |

## Appendix B: M22759/16 Technical Specifications (for 10+ AWG)

| Parameter | Value |
|-----------|-------|
| Specification | MIL-DTL-22759/16 (SAE AS22759/16) |
| Conductor | Tin-plated copper (TC) |
| Insulation | Extruded ETFE (Tefzel) — NOT crosslinked |
| Temperature range | -65C to +150C |
| Voltage rating | 600V RMS |
| Insulation thickness | 0.010" (0.254mm) — 2x thicker than /32 |
| Gauge range | 2 AWG to 24 AWG |
| Key difference | Standard wall, not crosslinked. Stiffer, heavier per foot. |
| Use case | Heavy power runs where /32 is not available (10, 8, 6, 4, 2 AWG) |

## Appendix C: 4 AWG Wire Note

4 AWG is used for only 2 wires in the K5 build: #6 Starter Motor (4.6 ft) and #63 Battery Disconnect (4.6 ft). M22759/16 is available in 4 AWG but at approximately $15-22/ft. For these short, non-engine-bay power runs, **marine-grade tinned copper battery cable** (105C, $2-3/ft) is the practical choice. These wires route directly from the battery/junction to the starter and are not part of the harness looms.

---

## Summary

| Decision | Recommendation |
|----------|---------------|
| M130 fuel level | Use AV input + 270 ohm pull-up. No signal conditioner needed. Assign to spare AV pin. |
| Wire 12-24 AWG | M22759/32 Tefzel from ProWire USA / RaceSpec |
| Wire 10-8 AWG | M22759/16 Tefzel (standard wall) |
| Wire 4 AWG | Marine-grade tinned copper battery cable |
| Total wire cost | ~$2,017 (vs $172 for TXL) |
| Three-color stripes | Remap to two-color M22759/32 equivalents + labels |
| Cut list header | Change "TXL tier" to "M22759/32 Tefzel (Professional)" |

---

*Sources: RaceSpec Online, ProWire USA, HP Academy forums, MoTeC Global Forum, MoTeC M130 datasheet, MIL-DTL-22759 specification*
