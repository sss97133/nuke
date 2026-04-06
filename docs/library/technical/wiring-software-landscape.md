# Wiring Harness Software Landscape — Research 2026-04-05

## What I Learned About How Harnesses Are Actually Built

The professional workflow (from HPA Academy's 8-step process, Grassroots Motorsport forum, and the 2025 Motorsport Wiring Harness Guide):

### Phase 1: Design (Documentation)
1. **Wiring connection document** — spreadsheet with every connector, pin, wire color, gauge, from/to
2. **Physical layout sketch** — branch points, connector locations, distances, sheathing materials
3. This is where software lives. Most shops use Google Sheets + hand-drawn diagrams.

### Phase 2: Template
1. Install engine/components in the vehicle
2. Run nylon clothesline rope between all connection points (2" extra each end)
3. Label every "wire" (e.g., "ignition to starter")
4. Melt rope together where wires join into bundles
5. Remove completed rope harness
6. Lay on pegboard, secure with ties in straight lines
7. Trace outlines — this IS the formboard

### Phase 3: Build
1. Transfer measurements to plywood/pegboard (the formboard/nailboard)
2. Run wires following reference marks
3. Concentric twist: 1 core → 6 around → 12 outer (alternating twist direction)
4. Crimp (never solder — solder creates hard points that crack under vibration)
5. DR-25 heat shrink, Deutsch Autosport connectors
6. Tefzel wire (M22759 Mil-Spec) for motorsport; TXL for street

### Phase 4: Test
1. Continuity on every circuit
2. Insulation resistance
3. Short circuit between pins
4. Pull testing on sample crimps
5. IPC/WHMA-A-620 acceptance criteria

### What matters in the data model:
- **From/To** (connector.cavity → connector.cavity)
- **Wire** (color, gauge AWG, length, type/spec)
- **Connector** (part number, manufacturer, pin count, type, gender)
- **Terminal/Contact** (crimp type, gauge range, part number)
- **Bundle** (which wires run together, covering type, length per segment)
- **Branch points** (where bundles split)
- **Splice** (where wires join mid-run)

---

## Tool Landscape (Evaluated April 2026)

### Tier 1: Actually Useful for Custom Vehicles

#### RapidHarness — $219-299/mo, free tier available
- **What it does well:** 1:1 formboard output (THE killer feature), auto-generated BOM/cutlist/wiring table, purpose-built for harness design
- **Data model:** Connection-centric. Define From endpoint → To endpoint → conductor. Auto-generates everything else.
- **Endpoint types:** Connector cavity, splice, loose wire end, ferrule, ring terminal, spade terminal, quick connect, resistor, diode
- **Bundle system:** White paths on diagram, branch points where they split, coverings per section, lengths per segment
- **Export:** PDF + Excel (BOM, wiring table, cutlist, labels). NO API. NO DXF. Cloud-only, vendor lock-in.
- **Honest assessment:** "Falls on its face regarding interface design" (Nathan Cheek). "Too expensive for the functionality" (HPA forums). But nothing else does formboard at this price.
- **Integration potential:** Parse Excel exports only. No API ever announced.

#### EZ Wire — $18-29/mo DIY, $107-129/mo Shop
- **What it does well:** 1,350+ connectors, 50+ ECU/PDM templates, keyboard-first speed, real-time validation, automated cut lists with branch lengths
- **Built by:** A professional harness builder (Stephen at EP Wiring / Corsa Technic)
- **Survey finding:** 57% of builders still use spreadsheets
- **Visual diagrams:** Coming early 2026
- **Assessment:** Newest, cheapest, built by someone who builds harnesses. Watch this one.

#### harness.design — Free, browser-based
- **5-step workflow:** Schematic → Layout (formboard) → Parts → Connections → Export
- **4 synchronized views:** Schematic, Layout, Parts, Connections
- **Key feature:** Formboard with bundle lengths → automatic wire length calculation
- **Export:** PDF schematic, PDF layout, CSV wiring table, CSV BOM, JSON
- **Assessment:** Most complete free tool. Schematic + formboard + BOM in browser. JSON export is the integration play.

#### Splice CAD — Free tier, browser-based
- **Node editor UI:** Drag pins to wires to pins
- **Python API:** `pip install splice-py` — programmatic harness creation + upload
- **Embed library:** `@splice-cad/embed` — embed interactive diagrams on any website
- **Export:** SVG, PDF, CSV BOM, WireViz YAML, JSON
- **Layout view:** Formboard with accessories, dimension callouts, multi-page PDF
- **Connector creator:** Built-in SVG editor for custom connectors
- **Assessment:** Best API story. Python library + embed widget = real integration path.

#### WireViz — Free, open source (Python)
- **What it is:** YAML in → SVG/PNG/HTML/TSV out
- **Data model (YAML):**
  - `connectors:` — type, subtype, pins, pinlabels, pincolors, pn, manufacturer, mpn
  - `cables:` — category (bundle), wirecount, gauge, colors, shield, length, per-wire pn/manufacturer
  - `connections:` — alternating connector-cable-connector, pin ranges, shield connections
  - `additional_bom_items:` — qty, description, pn, manufacturer
- **Web API:** wireviz-web (Flask REST), Kroki.io (hosted — POST YAML, get SVG)
- **Integrations:** InvenTree inventory plugin, VS Code extension
- **Assessment:** Best for generating diagrams FROM existing database data. Not a design tool.

#### Wirely — Free, browser-based
- **GUI on top of WireViz concepts** (independent rendering now)
- **Export:** PNG, SVG, JSON, Excel, DOT
- **Free tier:** 10 monthly builds, 1hr cooldown
- **Offline:** $60/year desktop app, unlimited builds

### Tier 2: Enterprise (Know They Exist)

| Tool | Price | Key Differentiator |
|------|-------|--------------------|
| Cadonix Arcadia | Quote-based | Cloud-native, 20-day free trial, schematic→harness→manufacturing |
| EPLAN Harness proD | $5-15K/yr | 3D→formboard, EPLAN ecosystem |
| Zuken E3.series | From ~$180/mo | End-to-end, KBL/VEC support |
| HarnWare (TE) | £1,500 training | Deep TE connector library, must take 3-day course |
| SolidWorks Electrical | $2-8K/yr | 3D routing in SolidWorks assemblies |
| Siemens Capital | $10K+/yr | OEM gold standard |

### Industry Data Exchange Standards
- **KBL (VDA 4964):** XML, single harness exchange OEM↔supplier
- **VEC (VDA 4968):** XML, complete vehicle electrical system
- **IPC/WHMA-A-620:** Workmanship acceptance standard
- Not relevant for custom work — you exchange PDFs and Excel cut lists

---

## What This Means for Nuke

### The existing `vehicle_build_manifest` data maps to harness design:
| Nuke Field | Harness Concept |
|-----------|-----------------|
| `device_name` | Connector/endpoint identifier |
| `device_category` | Functional grouping |
| `pin_count` | Connector cavity count |
| `power_draw_amps` | Wire sizing input |
| `signal_type` | Wire type (power/signal/CAN/shielded) |
| `wire_gauge_recommended` | AWG selection |
| `location_zone` | Physical zone for routing |
| `connector_type` | Connector part selection |
| `part_number` | BOM tracking |
| `price` | Cost tracking |

### What we already compute (overlayCompute.ts):
- Wire gauge selection from amperage
- Voltage drop calculation
- Fuse sizing
- PDM channel assignment
- Wire color assignment by function
- Total harness length and cost

### Integration options ranked:

1. **Splice CAD** — Best: Python API for programmatic creation, embed widget for display, JSON/WireViz export. Could generate Splice harnesses from build manifest data.

2. **WireViz via Kroki.io** — Good: Generate YAML from DB, POST to Kroki, get SVG. Zero infrastructure. But output is topological diagrams only, not formboard.

3. **harness.design** — Good: JSON export could be imported. Free. But no API for programmatic creation.

4. **RapidHarness** — Worst for integration: No API, cloud-only, Excel export only. But best standalone tool for the shop floor.

### Recommended strategy:
- **For the platform:** Splice CAD Python API to generate harnesses from build manifest data, Splice Embed to display them in the vehicle profile
- **For the shop floor:** EZ Wire ($18/mo) or RapidHarness free tier for actual formboard output
- **For documentation:** WireViz via Kroki for generating connection diagrams from DB data (zero cost, zero infrastructure)
- **Keep:** The existing computation engine (overlayCompute.ts, harnessCalculations.ts) — it does voltage drop, fuse sizing, and wire selection that none of these tools handle well
