# Wiring Harness Build Plan — K5 Blazer LS3/Motec M130

**Vehicle:** 1977 K5 Blazer, VIN CCL187Z210370
**Engine:** Delmo Speed LS3 6.2L
**ECU:** Motec M130 (34+26 pin Superseal)
**PDM:** Motec PDM30 (34+26 pin + M6 stud)
**Brakes:** Bosch iBooster Gen 2
**Transmission:** 6L80E (16-pin T43 TCM)
**Gauges:** Dakota Digital VHX-73C-PU (analog inputs — CAN bridge module planned)

---

## WHAT EXISTS (built this session)

### Database (Supabase, project qkgaybvrernstplzjaam)
| Table | Rows | Content |
|-------|------|---------|
| component_library | 62 | Universal parts catalog with dimensions, specs, prices |
| component_connectors | 15 | Pin-level detail (165 pins total) — M130 A+B, PDM30 A+B+C, 6L80E T43, D510C, ETB, CKP, CMP, KS, MAP, OPS, CLT, INJ |
| component_documents | 75 | Every PDF linked to its component |
| component_drawings | 10 | Extracted dimensional drawings with metadata |
| build_manifest_components | 0 | EMPTY — needs migration from vehicle_build_manifest (115 devices) |

### Generated Build Documents (ready to use)
| File | Content |
|------|---------|
| `docs/wiring/output/K5_cut_list.txt` | 113 wires — label, pin, gauge, color, length, grouped by loom |
| `docs/wiring/output/K5_connector_schedule.txt` | Every pin on M130 A+B and PDM30, with assignments |
| `docs/wiring/output/K5_bom.txt` | Bill of materials with pricing ($19,966 estimated) |

### Reference Documentation
| Directory | Count | Content |
|-----------|-------|---------|
| `reference_documents/component_drawings/` | 75 PDFs (85MB) | Datasheets, install guides, manuals for all components |
| `reference_documents/component_drawings/extracted/` | 10 PNGs | Key dimensional drawings (M130, PDM30, EV14 injector, Holley mid-mount, AEM harness diagram, C125 cutout, E-Stopp wiring, ACDelco pigtails) |
| `reference_documents/vehicle_base_drawings/` | 7 files | GM factory chassis drawing TX000469, K10 frame color-coded, K5 4-view orthographic, frame dimensions, body outlines |
| `reference_documents/wiring_diagram_booklets/` | 3 PDFs + 245 PNGs | GM ST-352/ST-350 wiring booklets (1978, 1985, 1987) |
| `docs/wiring/base_layers/` | 15 PNGs | Physical layout images from 1977 service manual (engine bay, frame, underbody, cab, front end, rear body) |

### Specifications
| File | Content |
|------|---------|
| `docs/wiring/chapters/appendix-e-diagram-format-spec.md` | GM 1987 grid-address diagram format reverse-engineered |
| `docs/wiring/chapters/appendix-f-component-library-schema.md` | Database schema for component engineering library |
| `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md` | 1,081-line requirements spec — 14 documents, 67 symbols, 32 quality checks |
| `docs/wiring/symbols/` | 17 SVG symbols (Phase 1 complete) — battery, alternator, PDM, sensors, injector, coil, ETB, connectors, grounds, shielded, twisted pair |

### Engineering Designs
| File | Content |
|------|---------|
| `docs/wiring/designs/gps-speed-can-bridge-module.md` | 1,211 lines — ESP32 + u-blox GPS + CAN reader. Reads Motec CAN, outputs analog for Dakota gauges. $66 BOM vs $470 Dakota solution. Eliminates dual senders. |
| `docs/wiring/designs/ibooster-can-protocol-plan.md` | 848 lines — Reverse engineering plan for Bosch iBooster CAN protocol. Partially decoded from Tesla DBC files. ESP32 dual-CAN gateway design (~$50-95). |

### Existing Wiring System Documentation (pre-session)
| File | Content |
|------|---------|
| `docs/wiring/WIRING_SYSTEM_KNOWLEDGE.md` | Master reference document |
| `docs/wiring/chapters/01-13 + appendix a-d` | 19 chapters covering factory harness, tier system, supply chain, build manifest, compute engine, Motec ecosystem, LS3 sensors, cut list, connector schedule, BOM, build sheet, canvas, catalog |
| `docs/wiring/diagrams/` | 37 factory GM diagrams from service manual |

---

## WHAT NEEDS TO HAPPEN (ordered by priority)

### PRIORITY 1: Validate wire lengths on the actual truck
The cut list uses ESTIMATED lengths (4.6ft for engine bay, 3.5ft for dash, 18.4ft for rear). These MUST be measured on the vehicle before cutting wire. Every wire needs a tape-measure run from its ECU/PDM pin location to its component location, following the actual harness routing path.

**Agent task:** Generate a measurement worksheet — every wire with its estimated length and blank columns for measured length, routing notes, and variance.

### PRIORITY 2: Order connector pigtails and terminals
Before building any loom, all connector pigtails and M130/PDM30 mating connectors must be in hand.

**Shopping list needed:**
- Motec #65044 mating connector for M130 Connector A (34-pin Superseal)
- Motec mating connector for M130 Connector B (26-pin Superseal)
- Motec mating connectors for PDM30 A+B
- ICT Billet pigtails for each LS3 sensor:
  - WPCKP40 (crank position)
  - WPCMP30 (cam position)
  - WPKN040 (knock sensor, qty 2)
  - WP0IL40 (oil pressure)
  - WPCTS30 (coolant temp)
  - WPINJ40 (injectors, qty 8) or pre-terminated injector sub-harness
  - Coil pigtails (D510C 4-pin, qty 8) or pre-terminated coil sub-harness
- Throttle body connector (6-pin, GM 12605109 mating side)
- MAP sensor connector (Bosch 3-pin)
- EV6/USCAR injector connectors (qty 8) if not using pigtails
- Deutsch/Autosport connectors for any inline connections

**Agent task:** Generate a complete connector BOM with part numbers, quantities, suppliers (ICT Billet, Motec dealers, Wiring Specialties), and prices.

### PRIORITY 3: Draw the engine loom wiring diagram
The first real diagram. Section 2 from the requirements spec. Uses the 17 SVG symbols already built.

**What it shows:**
- M130 ECU with Connectors A and B (face views)
- 8 ignition coils on valve covers (4 per side)
- 8 fuel injectors on fuel rails (4 per side)
- All engine sensors (CKP, CMP, KS1, KS2, MAP, IAT, CLT, OPS, OTS, FPS)
- Electronic throttle body
- Every wire labeled: circuit ID, gauge, color
- Grid-address cross-references per appendix-e format

**Agent task:** Read appendix-g Section 2 specs, read the cut list engine loom section, read all connector pin data from the database, and compose the SVG diagram using the symbols from docs/wiring/symbols/.

### PRIORITY 4: Generate harness build sheets (loom breakdown)
The cut list groups wires by zone but doesn't specify which physical loom they belong to or where looms branch.

**Three looms:**
1. **Engine loom** — M130 connectors → through firewall → to all engine components. 28 wires.
2. **Dash loom** — PDM30 → switches, gauges, interior lights, door locks/windows. 18 wires.
3. **Rear loom** — PDM30 → tail lights, backup lights, side markers, license plate, fuel pump, AMP Research steps. 27+ wires.

Plus:
4. **CAN backbone** — M130 ↔ PDM30 ↔ C125/Dakota Digital. Twisted pair with 120Ω termination.
5. **Power distribution** — Battery → PDM30 (6AWG), Battery → M130 (16AWG), Battery → Starter (4AWG), Alt → Battery (8AWG).

**Agent task:** Generate the harness build sheet showing which wires go in which loom, branching points, loom diameters at each section, and build sequence.

### PRIORITY 5: Power distribution diagram
Shows complete current flow from battery through every protection device to every load. Critical for validating PDM30 channel assignments and aggregate current budget.

### PRIORITY 6: Ground distribution diagram
Shows every ground point — star ground architecture, engine ground strap, body grounds, sensor ground returns through M130 B15/B16.

### PRIORITY 7: Remaining system schematics
Sections 1 (Forward Lamps), 3 (HVAC), 5 (Instrument Panel), 6-13 per the requirements spec.

### PRIORITY 8: Physical layout diagrams
Component location, harness routing, and connector location diagrams overlaid on the vehicle base drawings.

### PRIORITY 9: CAN bridge module prototype
Build the ESP32 GPS/CAN bridge module per the design doc. Order parts, flash firmware, bench test.

### PRIORITY 10: iBooster CAN sniffing
Order CANable 2.0, capture CAN traffic from a donor Honda Accord iBooster, decode messages.

---

## BUILD SEQUENCE (for the physical harness)

### Phase A: Prep (before cutting any wire)
1. Validate ALL wire lengths on the truck with tape measure
2. Order all connector pigtails and mating connectors
3. Order wire spools per the BOM purchase summary in the cut list
4. Set up the harness bench (mandrel, tape, loom, labels)

### Phase B: Engine Loom (build first)
1. Cut all 28 engine wires to measured length + 10% service loop
2. Build coil sub-harness (8 wires, same gauge, branch at each cylinder)
3. Build injector sub-harness (8 wires, same gauge, branch at each cylinder)
4. Build sensor pigtail extensions (individual runs to each sensor)
5. Build shielded cable runs (CKP, CMP, KS1, KS2)
6. Bundle into trunk with DR-25 or split loom
7. Terminate M130 Connector A and B pins
8. Terminate all sensor-side pigtails
9. Continuity test every wire end-to-end
10. Label every wire at both ends

### Phase C: CAN Backbone
1. Run twisted pair (WHT/GRN + GRN/WHT) from M130 B17/B18 to PDM30 B25/B26
2. Install 120Ω termination resistor at each end
3. Test CAN communication (M130 ↔ PDM30 handshake)

### Phase D: Dash Loom
1. Cut all 18 dash wires to measured length
2. Terminate PDM30 connector pins
3. Connect switches, gauges, interior lights
4. Test each circuit

### Phase E: Rear Loom
1. Cut all 27+ rear wires to measured length
2. Route along frame rails (follow factory path from base layer diagrams)
3. Terminate tail lights, backup lights, markers, fuel pump relay, AMP Research

### Phase F: Power Distribution
1. Battery → PDM30 (6AWG, M6 stud)
2. Battery → M130 (16AWG)
3. Battery → Starter (4AWG with relay)
4. Alternator → Battery (8AWG with fusible link)
5. Battery → iBooster (dedicated relay, 40A)
6. Battery → Fuel pump (dedicated relay, 30A Aeromotive kit)

### Phase G: Integration Test
1. Power up M130, verify LED status
2. Power up PDM30, verify CAN link to M130
3. Test each PDM channel individually (bench load)
4. Crank engine, verify sensor readings
5. Test each lighting circuit
6. Road test with full systems active

---

## KEY DATA LOCATIONS

| What | Where |
|------|-------|
| Every wire in the build | `docs/wiring/output/K5_cut_list.txt` |
| Every pin assignment | `docs/wiring/output/K5_connector_schedule.txt` |
| Every part with price | `docs/wiring/output/K5_bom.txt` |
| M130 pin map | `component_connectors` WHERE component = 'M130' (60 pins, A+B) |
| PDM30 pin map | `component_connectors` WHERE component = 'PDM30' (61 pins, A+B+C) |
| 6L80E TCM pins | `component_connectors` WHERE component = '6L80E' (16 pins) |
| All sensor specs | `docs/wiring/chapters/08-ls3-sensors.md` |
| Motec I/O specs | `docs/wiring/chapters/07-motec-ecosystem.md` |
| Factory wiring baseline | `docs/wiring/chapters/02-factory-harness.md` |
| Diagram format rules | `docs/wiring/chapters/appendix-e-diagram-format-spec.md` |
| Diagram requirements | `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md` |
| SVG symbols | `docs/wiring/symbols/` (17 files) |
| Component dimensional drawings | `reference_documents/component_drawings/extracted/` (10 files) |
| Vehicle base layers | `docs/wiring/base_layers/` + `reference_documents/vehicle_base_drawings/` |
| CAN bridge module design | `docs/wiring/designs/gps-speed-can-bridge-module.md` |
| iBooster CAN plan | `docs/wiring/designs/ibooster-can-protocol-plan.md` |
