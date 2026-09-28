# Receipt: the DC primary cables sized from physics; the "2 or 4 AWG" question closed

- **Date:** 2026-09-28 (night)
- **Change type:** design (registry rows via `calc-data/cable_sizing_v5.py` → `cable_decisions.json` → `reconcile_v5.py`)
- **Amends:** `receipts/2026-09-28_registry-corrections-from-reviews.md` (PDM15 feed 4 AWG → 2 AWG), state §1 row
  "DC-primary gauge: 2 AWG (Dave) OR 2×4 AWG /16"
- **Ask (owner, 2026-09-28):** "2 and 4 is a physics answer not meatbag skylar answer.. all that means is the design isnt
  done. i see on daves build he was using 2awg on the wires from the pdm i photographed and shared the other day."

## Inputs, every one cited
| input | value | source |
|---|---|---|
| M22759/16 resistance | 2 AWG 0.183, 4 AWG 0.280, 6 AWG 0.445, 8 AWG 0.701 Ω/1000 ft | ProWire/Thermax datasheet (canon ch.16 §1.8) |
| free air, single wire, 80 °C ambient | 2# 150 A · 4# 120 · 6# 90 | MoTeC PDM user manual p.48 |
| free air, single wire, 100 °C ambient | 2# 120 A · 4# 100 · 6# 75 | MoTeC PDM user manual p.48 |
| bundled in heat-shrink, 35 °C rise | 2# 100 · 4# 72 · 6# 54 · 8# 40 A | ProWire Tefzel ampacity chart, read 2026-09-28 |
| starter | 200 A peak, brief | chapters/05 build manifest |
| alternator Holley 197-302 | 150 A | Holley product page (read 2026-09-28); the mid-mount PDFs on file list only 197-300/301 |
| PDM30 / PDM15 total output | 100 A / 80 A continuous | PDM user manual p.35 |
| amplifier JL VX700/5i | 60 A fuse recommended | Crutchfield snapshot |
| iBooster supply fuse | 40 A (OEM) | canon ch.17 §17.5 |
| Orion-Tr Smart 12/12-30 | ~35 A in, MIDI 40 | canon ch.17 §17.5 |
| rules | fuse ≥ 125 % load and ≤ 85 % cable ampacity; drop ≤ 3 % (0.42 V); bundle derate only past 24 in; parallel = same gauge, length, terminations; cranking cables never below 2 AWG | canon ch.17 §17.2.3, §17.4.3, §17.5.3/6; ch.16 §2.2, §2.4 |
| basis per zone | engine bay → the 100 °C-ambient column; cab-side solo cable → 80 °C column; loom/bed runs → bundled chart | this receipt (the manual's own hot column, not a second derate stacked on the 80 °C column) |
| lengths | the twin's polylines (#63 1.1 ft, #6 3.1, #59 3.5, G1 3.5, PDM_BPOS 1.9, #32 18.4 zone est., #52 4.6) | registry |

## Result (`calc-data/CABLE_SIZING.md`)
| cable | was | **sized** | fuse | why |
|---|---|---|---|---|
| #63 battery → isolator A, ISO_OUT isolator B → stud, ODY_NEG battery − → star | 2 | **2 × 2 AWG** | none | 180 A continuous worst case (both PDMs, engine off) > 120 A one 2 AWG carries at 100 °C |
| #6 stud → starter B+ | 2 | **2 AWG** | none | cranking only; 0.11 V at 200 A; the 2 AWG floor |
| G1 star → block | 2 | **2 × 2 AWG** | none | starter return + alternator return 150 A continuous |
| #59 alternator B+ → stud | 2 | **2 × 2 AWG**, each in its own sleeve | MEGA 200 | 150 A nameplate → MEGA 200 → 235 A of cable; 2 × 120 = 240 |
| PDM_BPOS stud → PDM30 | 2 | **2 AWG** | MEGA 125 | 147 A needed; 150 A free air, cab side, 1.9 ft solo |
| PDM15_BPOS stud → PDM15 | 4 | **2 AWG** | MEGA 100 | 118 A needed; 4 AWG is 100 A at 100 °C |
| GND_RET_CAB cab bank → star | 2 | **2 AWG** | none | 100 A return in the loom; 100 A bundled — at the limit, noted |
| #32 YellowTop → amp, AMP_GND | 4 | **2 AWG** | MIDI 60 | 18.4 ft loop: 4 AWG drops 0.62 V (4.4 %), 2 AWG 0.40 V (2.9 %). Alternative: the YellowTop in the bed, under 8 ft, then 4 AWG |
| #52 stud → iBooster | 8 | **6 AWG** | MIDI 40 | 47 A of cable needed; 8 AWG bundled is 40 |
| DCDC_IN / OUT / GND | 8 | **6 AWG** | MIDI 40 (in) | same rule |
| ACC_NEG, G2 | 4 | unchanged | | no length in the twin; drop check waits on it (ch.17 §17.4.4 keeps G2 at 4 AWG) |

**Insulation:** Tefzel M22759/16 stays (the locked spec, 600 V, 150 °C; ProWire stocks M22759/16-2). Dave's 600 V
battery cable is the same voltage class in a lower-temperature jacket; the calculation does not depend on which, the lock does.

## Measured (after `reconcile_v5.py` → `check_plug_ends.py --wires`)
344 wires: 331 right, 0 wrong, 13 incomplete (unchanged counts; gauges and fuses changed on 14 rows, each with its why on
the row). Engine-run set 174, every rule PASS 168, any FAIL 0. The DC primary pages regenerate with "2×2" labels and the
cable-type banner replaced by the sizing statement.

## Open (named close paths)
- Two 2 AWG lugs on one 3/8 stud (isolator A/B, distribution stud): the Blue Sea 7700 instructions allow 140 in-lb on the
  stud; lug stacking count per stud to confirm on the 2019 block's sheet.
- 6 AWG lugs for the iBooster and Orion ends: parts.yaml has 838TP (8 AWG); the 6 AWG 3/8 and M5 lugs are OPEN.
- ACC_NEG and G2 lengths from the twin, then the drop check.
