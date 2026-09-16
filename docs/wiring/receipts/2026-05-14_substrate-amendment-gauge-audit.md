---
id: 2026-05-14_substrate-amendment-gauge-audit
date: 2026-05-14
change_type: substrate_amendment
scope: docs/wiring/output/K5_cut_list_v3.txt (new file, supersedes K5_cut_list_v2.txt)
status: APPLIED
amends: K5_cut_list_v2 — gauge column for 91 of 145 wires
---

# K5 cut list — physics-derived gauge audit applied to 91 wires

## What was wrong

`K5_cut_list_v2.txt` carried gauge selections that were inherited from a generic MoTeC reference harness convention ("18 AWG for everything in the engine bay") rather than DERIVED from current × length × voltage-drop physics per `chapters/06-compute-engine.md`. The result was massive oversizing across the body and engine looms (most signal/sensor/light wires were 2–8 gauges larger than physics required) AND several wires that were dangerously **undersized** for their actual current load.

Skylar flagged this when noticing 18 AWG to LS3 fuel injectors. An audit confirmed: only 8 wires were correctly sized; 108 were oversized by ≥2 gauges; 12 were undersized.

## Doctrine applied

Per `chapters/06-compute-engine.md`:
- Gauge = derived from amperage + wire length + 3% max Vdrop + 25% safety margin
- Practical floor: **22 AWG** for low-current signal wires (per `K5_wire_spec_and_costs.md` — 24 AWG reserved for CAN/Ethernet)

## Critical UPSIZED wires (safety — these were undersized)

| Wire | Was | Now | Current | Length | Reason |
|---|---|---|---|---|---|
| #6 Starter Motor | 4 AWG | **0 AWG** | 200 A peak | 4.6 ft | Cranking current; 4 AWG = 95 A ampacity, way short of 200 A |
| #59 Alternator | 8 AWG | **0 AWG** | 220 A | 4.6 ft | Mechman 220A output; 8 AWG = 50 A ampacity |
| #63 Battery Disconnect | 4 AWG | **0 AWG** | 190 A | 4.6 ft | Master cut, carries full system current |
| #51 Heater Blower | 12 AWG | **10 AWG** | 20 A peak | 4.6 ft | Aftermarket blower; 12 AWG = 20 A ampacity (no margin) |
| #52 iBooster Power | 10 AWG | **8 AWG** | 40 A peak | 4.6 ft | Per appendix-d "iBooster 40A peak" |
| #66 Fuel Pump | 10 AWG | **8 AWG** | 35 A peak | 18.4 ft | Per appendix-d "Aeromotive A1000 35A peak" — 18 ft run amplifies the drop |
| #28a/b, #29a/b Rear Speakers | 18 AWG | **16 AWG** | 5 A | 18.4 ft | Long run + amplifier-rated current; 18 AWG drops >3% over 18 ft @ 5A |
| #30a/b Subwoofer | 14 AWG | **10 AWG** | 15 A | 18.4 ft | 300W class amp output; 14 AWG drops 5% @ 15A over 18 ft |

**Important — note for builder:** the original cut list spec for these MUST NOT be ordered as-is. The battery and starter cables especially are a safety issue at the original 4 AWG / 8 AWG specs.

## DOWNSIZED wires (oversizing — wasted copper and stiffness)

| Wires | Was | Now | Current | Count |
|---|---|---|---|---|
| Fuel Injectors #13–#20 | 18 AWG | **22 AWG** | 0.83 A | 8 wires |
| Ignition Coils #5, #7–#12, #24 | 20 AWG | **22 AWG** | 0.5 A | 8 wires |
| ETB motor drives #4a, #4b | 18 AWG | **20 AWG** | 2.5 A | 2 wires |
| Most lighting (tail, marker, parking, third brake) | 18 AWG | **22 AWG** | 0.3–0.8 A | ~17 wires |
| Headlights #85, #86 | 16 AWG | **20 AWG** | 3 A LED | 2 wires |
| Switches (turn, headlight, wiper, brake, lock, door, ignition, etc) | 14–18 AWG | **22 AWG** | <0.01 A | ~16 wires |
| Power Window Motors #34, #35 | 12 AWG | **16 AWG** | 8 A peak | 2 wires |
| AMP Research Step motors #1, #2 | 14 AWG | **18 AWG** | 5 A | 2 wires |
| AMP Step Controller signal #3 | 14 AWG | **22 AWG** | 0.5 A | 1 wire |
| Horn #48 | 14 AWG | **16 AWG** | 8 A | 1 wire |
| Wiper motor #49 | 14 AWG | **18 AWG** | 5 A | 1 wire |
| Various low-current sensor/relay/indicator wires | 18–22 AWG | **22 AWG** | <1 A | ~30 wires |
| Coil rail #COIL_PWR / #COIL_GND | 14 AWG | **16 AWG** | 8 A | 2 wires |

**Total wires changed: 91 of 145 (63%).**

## Per-gauge inventory shift

| AWG | Before (ft) | After (ft) | Delta |
|---|---|---|---|
| 24 | 0.0 | 3.5 | +3.5 (CAN bus only) |
| 22 | 234.8 | **673.0** | **+438.2** |
| 20 | 103.0 | 36.8 | −66.2 |
| 18 | **408.7** | **55.2** | **−353.5** |
| 16 | 25.7 | 121.4 | +95.7 |
| 14 | 148.8 | 8.1 | −140.7 |
| 12 | 27.6 | 9.2 | −18.4 |
| 10 | 23.0 | 41.4 | +18.4 |
| 8 | 23.0 | 41.4 | +18.4 |
| 4 | 9.2 | 0.0 | −9.2 |
| 0 | 0.0 | **13.8** | +13.8 (battery/starter/alt + disconnect — was 4/8 AWG) |

**The 18 AWG inventory drops from 409 ft to 55 ft — 87% reduction.** The 22 AWG inventory triples. This realigns with Skylar's design principle ("high-power = many skinny conductors") *and* with chapter 6 doctrine simultaneously.

## Cost / weight impact (rough)

Per `K5_wire_spec_and_costs.md` ProWire pricing:
- 18 AWG Tefzel ≈ $1.35/ft
- 22 AWG Tefzel ≈ $0.56/ft
- Net wire savings on downsizes ≈ $200–$280
- Net wire cost increase from upsizes (0 AWG battery cables ≈ $5–6/ft × 13.8 ft) ≈ $80–100
- Estimated net savings: ~$100–$180 wire-only

Weight: 22 AWG is ~30% the copper mass of 18 AWG. The 353 ft of 18→22 downsize alone strips ~3 lb of copper from the harness. The harness becomes meaningfully more flexible and easier to route.

## Wires NOT changed

- Sensor signal wires already at 22 AWG (CTS, IAT, OTS, MAP, OPS, FPS, knock, crank, cam, fuel level, VSS, switches, etc.) — already at the practical floor
- Engine ground points, body grounds — separate substrate (ground straps and ring terminals)
- 22 wires (the companion wires added 2026-05-14 in `2026-05-14_amendment-cut-list-companion-wires.md`) have no current-draw entry yet in the audit script (15 marked NO_MATCH) — these inherit the parent wire's gauge by convention; explicit per-wire derivation is a future pass

## Citations

- AWG resistance: NEC / SAE J1128 standard values (per 1000 ft @ 20°C)
- AWG ampacity: SAE J1128 bundle-derated values (105°C insulation)
- 3% Vdrop target: `chapters/06-compute-engine.md` Wire Specification section
- 25% safety margin: same source
- Per-device currents: cited inline in `audit_wire_gauges.py` CURRENT_MAP — most from `chapters/appendix-d-k5-build.md` (fuel pump 35A, iBooster 40A, amplifier 30A, alternator 220A) and industry typicals (LED headlight 3A, Spal 14" fan 15A, etc.)
- Practical 22 AWG floor: `K5_wire_spec_and_costs.md` ("24 AWG... Thinnest, CAN/Ethernet only")
- LS3 injector impedance ≈ 14.5 Ω: GM service data; results in 0.83 A continuous at 12V

## Files

- **`K5_cut_list_v3.txt`** — NEW, supersedes v2 with corrections applied
- `audit_wire_gauges.py` — the audit script (reproducible, citations in CURRENT_MAP)
- `apply_gauge_corrections.py` — the corrector script that emits v3

## Downstream actions needed

1. **Update `build_complete_pdf.sh` to read from v3** when regenerating diagrams (cut list source is referenced by `generate_wireviz_yaml.py`)
2. **Update `K5_wire_spec_and_costs.md`** to reflect the new gauge inventory (the cost table was based on v2's 408.7 ft of 18 AWG; v3 has 55 ft)
3. **Regenerate WireViz YAML / SVG / PDF** to reflect new gauges visually
4. **Verify the upsized battery/starter/alternator cables** with Dave before ordering — 0 AWG vs the conventional 1/0 motorsport practice (which is essentially 0 AWG)

## Things to flag in this audit

- **No-match wires (15):** Companion wires added by `2026-05-14_amendment-cut-list-companion-wires.md` have no current-draw entry in the audit map yet. They're listed but not corrected. Carrying them at 22 AWG is the conservative-correct choice but they should be verified individually.
- **Heater blower #51** — I used 20 A peak. If the actual blower is 25 A (some aftermarket units), 10 AWG is at its 30 A ampacity limit. Verify the actual blower spec.
- **Subwoofer #30a/b** — 15 A is for ~300 W to a 4 Ω load. If the amp/sub combo is bigger, gauge needs another bump.
- **0 AWG vs 1/0** — these are the same gauge (0 AWG = "one-aught"). Just naming convention. Specify "0 AWG" or "1/0" depending on supplier.
