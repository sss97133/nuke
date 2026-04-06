# Appendix G: Wiring Diagram Requirements Specification

Complete production requirements for generating industry-grade wiring diagrams for the 1977 Chevrolet K5 Blazer / LS3 / Motec M130 / PDM30 build. Written as a CAD technician instruction manual: every symbol, every label format, every cross-reference rule, every quality gate.

**Vehicle:** 1977 Chevrolet K5 Blazer (VIN CCL187Z210370)
**Engine:** GM LS3 6.2L (Delmo Speed cosmetic kit)
**ECU:** Motec M130 (34-pin Connector A + 26-pin Connector B)
**PDM:** Motec PDM30 (34-pin Connector A + 26-pin Connector B + M6 stud)
**Brakes:** Bosch iBooster Gen 2 (dedicated relay, integrated ECU)
**Scope:** 113 wires, 115 devices, 347 endpoints

---

## 1. DOCUMENT SET

A complete professional wiring package comprises 14 documents organized into 4 tiers. This is what Yazaki delivers to an OEM assembly plant, scaled to a single custom build. Desert Performance receives this set and can build, install, troubleshoot, and repair the harness with no additional information.

### Tier 1: Build Documents (used on the bench to build the harness)

| # | Document | Purpose | Format |
|---|----------|---------|--------|
| 1.1 | **Cut List** | Every wire: label, gauge, color, length, termination notes | Tabloid (11x17) portrait, text-only table |
| 1.2 | **Connector Schedule** | Every connector: pin-by-pin assignment with wire codes and mating part numbers | Tabloid portrait, per-connector tables |
| 1.3 | **Connector Face View Sheets** | Mating-face cavity layout for every multi-pin connector (M130-A, M130-B, PDM30-A, PDM30-B, throttle body, 6L80 TCM) | Letter (8.5x11), one face view per page, 1:1 scale where possible |
| 1.4 | **Bill of Materials** | Every purchased component: wire spools, terminals, connectors, boots, heat shrink, loom, labels, with supplier and part number | Tabloid portrait, sortable table |
| 1.5 | **Harness Build Sheet** | Loom-by-loom breakdown (engine loom, dash loom, rear loom, CAN backbone), showing which wires belong in which loom, branching points, and loom diameters | ANSI D (22x34) landscape |

### Tier 2: Schematic Diagrams (used to understand circuit logic)

| # | Document | Purpose | Format |
|---|----------|---------|--------|
| 2.1 | **System Schematics** (14 sections) | Circuit-level logic diagrams showing every wire path from source to load, with component symbols, wire codes, cross-references | ANSI D (22x34) landscape, one section per sheet (multi-page sections tile horizontally) |
| 2.2 | **Power Distribution Diagram** | Complete current flow from battery through PDM30, relays, fusible links to every load, with current ratings and protection devices | ANSI D landscape, single sheet |
| 2.3 | **Ground Distribution Diagram** | Every ground point, star ground architecture, ground strap routing, body/chassis/engine ground connections | Tabloid landscape |
| 2.4 | **CAN Bus Network Diagram** | Twisted-pair backbone showing M130, PDM30, C125/Dakota Digital nodes, termination resistors, connector pinouts at each node | Letter landscape |

### Tier 3: Physical Layout Documents (used during installation in the vehicle)

| # | Document | Purpose | Format |
|---|----------|---------|--------|
| 3.1 | **Harness Routing Diagram** | Plan view (top-down) of the vehicle showing harness trunk paths, pass-through locations (firewall grommets, frame rail clips), branch points, and connector locations | ANSI D landscape, scaled to vehicle outline |
| 3.2 | **Component Location Diagram** | Physical position of every electrical component shown on vehicle outline views (engine bay, underbody, cab interior, rear), with callouts referencing the schematic section | Tabloid landscape, 4 views |
| 3.3 | **Connector Location Diagram** | Every inline connector and device connector shown on vehicle outline, with connector ID labels matching the connector schedule | Tabloid landscape |

### Tier 4: Reference & Troubleshooting

| # | Document | Purpose | Format |
|---|----------|---------|--------|
| 4.1 | **Wire Color Chart** | Master table of all wire colors and stripe combinations used, sorted by function group, with the circuit ID for each | Letter portrait |
| 4.2 | **Circuit Index** | Alphabetical index of every circuit ID, showing which schematic section and grid address it appears on | Letter portrait |

### Relationship Between Documents

```
CUT LIST ──────────────► BUILD SHEET (which wires go in which loom)
    │                         │
    ▼                         ▼
CONNECTOR SCHEDULE ──► CONNECTOR FACE VIEWS (what goes where in each connector)
    │
    ▼
SYSTEM SCHEMATICS ────► POWER DISTRIBUTION (current flow hierarchy)
    │                         │
    │                         ▼
    │                   GROUND DISTRIBUTION (return path hierarchy)
    │
    ├──────────────────► CAN BUS DIAGRAM (communication layer)
    │
    ▼
HARNESS ROUTING ──────► COMPONENT LOCATION (physical reference)
    │
    ▼
CONNECTOR LOCATION ───► CIRCUIT INDEX (find anything by name)
```

---

## 2. DIAGRAM TYPES

### 2.1 System Schematic (Document 2.1)

**Purpose:** Answer the question "How is this circuit wired?" Show every electrical connection from power source through protection device through switch through load to ground, with every wire identified by circuit ID, gauge, and color.

**Audience:**
- Harness builder (bench): verify pin assignments against connector schedule
- Installer (vehicle): trace circuits during installation
- Technician (troubleshooting): diagnose faults by following circuit logic
- Engineer (design review): verify circuit protection and wire sizing

**Content Requirements:**
- Every wire shown as a routed line with circuit ID label (see Section 5 for format)
- Every component shown with its schematic symbol (see Section 4 for library)
- Every connector shown with face view and populated pin callouts
- Every protection device (fuse, circuit breaker, fusible link) shown with rating
- Every ground connection shown with ground symbol type (chassis, body, star)
- Cross-references to other sections at every wire that exits the section boundary
- Grid address system (columns numbered, rows lettered) on all four edges
- Zone boundaries (engine bay, firewall, cab) as dashed vertical lines with labels
- Title block in bottom-right corner (see Section 5.7)

**Format:** ANSI D (22x34 inches / 559x864 mm), landscape orientation. SVG viewBox: 8640 x 5590 (10 units/mm). Print at 1:1 scale for bench use.

**Sections (14 total, matching Appendix E Section 7):**

| Section | Title | Content | Est. Pages |
|---------|-------|---------|-----------|
| 0 | Power Distribution | Battery, PDM30 main feed, fusible links, main relay, battery disconnect, alternator, starter | 2 |
| 1 | Forward Lamps | LED headlights (Truck-Lite 27270C), parking lights, turn signals, side markers -- all PDM-driven | 1 |
| 2 | Engine -- LS3 | 8 injectors, 8 coils, crank sensor, cam sensor, MAP, IAT, CLT, oil pressure, fuel pressure, oil temp, knock x2, throttle body, A/C compressor clutch | 3 |
| 3 | ECU -- M130 Pinout | Full M130 Connector A (34-pin) and Connector B (26-pin) face views with every pin labeled and cross-referenced to its section | 1 |
| 4 | PDM30 -- Channel Map | All 30 output channels with load assignments, all 16 digital inputs, CAN connections, battery feed (M6 stud) | 2 |
| 5 | Instrument Panel | Dakota Digital VHX-73C-PU gauge cluster, warning lights, dimmer, gauge sender wiring | 1 |
| 6 | HVAC | Blower motor (PDM30 channel 6), A/C compressor clutch (PDM30 channel 16), A/C pressure switches (low + high to ECU) | 1 |
| 7 | Throttle / Transmission | Electronic throttle body (6-pin), transmission controller (Moveras 31AS or PDM30:OUT23), neutral safety switch, reverse light switch | 1 |
| 8 | Lighting -- Rear | Tail/stop (PDM30:OUT13), turn signals (PDM30:OUT27/28), backup lights (PDM30:OUT15), license plate (PDM30:OUT19), third brake light (PDM30:OUT15), cargo light (PDM30:OUT25) | 1 |
| 9 | Audio / Accessories | RetroSound Hermosa head unit (PDM30:OUT20), Kicker amplifier (direct battery), speakers x4, subwoofer, rear backup camera, USB port (PDM30:OUT30), cigarette lighter (PDM30:OUT8) | 1 |
| 10 | Body | Nu-Relics power windows (PDM30:OUT3/4), Dorman 746-014 door lock actuators (PDM30:OUT21/22), dome/courtesy lights (PDM30:OUT25), AMP Research PowerSteps (PDM30:OUT9/10/11) | 1 |
| 11 | CAN Bus Network | M130 <-> PDM30 <-> C125/Dakota Digital backbone, twisted pair routing, 120-ohm termination at each end | 1 |
| 12 | Ground Distribution | Star ground architecture: engine star ground, sensor star ground (M130 pins A10/A11, B15/B16), body star ground, frame ground straps | 1 |
| 13 | Trailer / Auxiliary | Trailer connector, auxiliary power provisions, future expansion | 1 |

**Level of Detail:**
- Every wire is shown -- no "typical" groupings that hide individual wires
- Splices shown at actual splice points, not implied
- For components with many identical instances (8 injectors, 8 coils), the first instance is drawn in full detail and subsequent instances are drawn with abbreviated notation referencing the first
- Connector face views are drawn for every multi-pin connector (3+ pins)
- 2-pin connectors shown as simple mating blocks with pin labels

**Relation to Other Diagrams:**
- Cross-reference arrows at section boundaries point to the specific section, page, and grid address where the wire continues
- Every component on the schematic has a matching entry in the Component Location Diagram (Document 3.2)
- Every wire on the schematic has a matching row in the Cut List (Document 1.1)
- Every connector pin has a matching entry in the Connector Schedule (Document 1.2)


### 2.2 Power Distribution Diagram (Document 2.2)

**Purpose:** Answer the question "Where does the current come from and how is it protected?" Show the complete power hierarchy from battery positive through every distribution point, protection device, and switching element to every load.

**Audience:**
- Installer: verify battery cable routing and terminal torque specs
- Technician: diagnose no-power conditions by tracing from battery forward
- Engineer: verify total current budget and protection coordination

**Content Requirements:**
- Battery shown at top-center with terminal voltages and cable sizes
- PDM30 shown as central distribution block with all 30 output channels, current ratings, and load assignments
- Direct-wired high-current circuits shown separately: starter (4 AWG), alternator (8 AWG), fuel pump relay (10 AWG), iBooster relay (10 AWG), amplifier (8 AWG)
- Fusible link values and locations for non-PDM circuits
- Battery disconnect (Motec RBD 190) shown inline with main positive cable
- Total continuous load calculation shown in annotation: sum of all steady-state loads
- Total peak load calculation shown: sum of all worst-case simultaneous loads
- Alternator output rating shown vs. total load (margin check)

**Format:** ANSI D landscape, single sheet. Top-down current flow: battery at top, loads at bottom.

**Symbology:** Power flows vertically downward. Protection devices (fuses, PDM channels) shown as horizontal barriers that current must cross. Current ratings annotated at every protection point.

**Relation to Other Diagrams:**
- Every load references its system schematic section number
- PDM channel numbers match Section 4 (PDM30 Channel Map)
- Wire gauges match Cut List entries


### 2.3 Ground Distribution Diagram (Document 2.3)

**Purpose:** Answer the question "Where does the current return to the battery?" Show every ground path, ground point location, and ground strap specification.

**Audience:**
- Installer: know exactly where to drill, bolt, and torque every ground point
- Technician: diagnose ground-fault symptoms (dim lights, erratic sensors, CAN errors)

**Content Requirements:**
- Star ground architecture: show each star-ground bus as a physical point with all wires terminating there
- Engine star ground: block-to-frame strap (4 AWG), location on block
- Sensor star ground: M130 pins A10/A11 (BAT_NEG1/2) and B15/B16 (SEN_0V_A/B), showing which sensors return to which pin
- PDM ground: pins A26/B18 (VBATT_NEG_A/B) and A28/B22 (GND_0V_A/B)
- Body ground: cab-to-frame strap location and gauge
- Every component ground wire shown with gauge, color, length, and termination hardware (bolt size, torque)
- Ground point preparation notes: paint removal area, star washer, anti-seize compound

**Format:** Tabloid (11x17) landscape, single sheet. Ground bus shown as horizontal rails at left, loads branching to the right.


### 2.4 CAN Bus Network Diagram (Document 2.4)

**Purpose:** Answer the question "How do the Motec devices communicate?" Show the physical and logical CAN bus topology.

**Audience:**
- Installer: route CAN backbone correctly with proper twist rate and termination
- Technician: diagnose CAN communication faults
- Tuner: understand which data is available on the bus for M1 Tune configuration

**Content Requirements:**
- Bus topology: linear backbone with stubs to each node
- Nodes: M130 (pins B17/B18), PDM30 (pins B25/B26), C125/Dakota Digital
- Termination: 120-ohm resistor at each end of backbone (show which device has built-in termination vs. external resistor)
- Wire specification: 22 AWG twisted pair, WHT/GRN colors, twist rate (33 twists/meter minimum per SAE J1939)
- Maximum stub length: 300mm per CAN specification
- Maximum backbone length: vehicle-dependent, show actual routed length
- Baud rate annotation: 500 kbps (Motec default)
- Data flow annotations: which data messages flow between which nodes (ECU->PDM channel commands, PDM->ECU fault reports, ECU->Display gauge data)

**Format:** Letter (8.5x11) landscape, single sheet. Bus shown as horizontal line, nodes as labeled rectangles above and below.


### 2.5 Connector Face View Sheets (Document 1.3)

**Purpose:** Answer the question "Which wire goes in which cavity?" Provide a 1:1 scale mating-face view of every multi-pin connector so the builder can verify terminal insertion by visual comparison.

**Audience:**
- Harness builder (bench): insert terminals into correct cavities
- QC inspector: verify populated vs. empty cavities match the drawing

**Content Requirements per Sheet:**
- Connector housing drawing showing cavity layout as seen from the MATING FACE (looking into the connector as it would appear when plugging it in)
- Keying feature (lock tab, polarization key) clearly identified
- Each cavity labeled with pin designation (A01, B07, etc.)
- Populated cavities shown as filled circles; empty cavities as open circles
- Pin function label adjacent to each populated cavity
- Wire code (gauge + color) for each populated pin
- Connector housing part number (harness side)
- Mating connector part number (component side)
- Connector series/family identification (e.g., "Tyco Superseal 34-pin")
- Sealed/unsealed callout
- Terminal part number and crimp specification (wire range, crimp tool die)

**Connectors requiring face view sheets (13 total):**

| Connector | Pins | Type |
|-----------|------|------|
| M130 Connector A | 34 | Tyco Superseal |
| M130 Connector B | 26 | Tyco Superseal |
| PDM30 Connector A | 34 | Tyco Superseal |
| PDM30 Connector B | 26 | Tyco Superseal |
| PDM30 Connector C | 1 | M6 stud |
| LS3 Throttle Body | 6 | GM sealed |
| LS3 Crank Sensor | 3 | Metri-Pack |
| LS3 Cam Sensor | 3 | Metri-Pack |
| LS3 Oil Pressure | 3 | GM oval sealed |
| LS3 MAP Sensor | 3 | Bosch sealed |
| 6L80 TCM | 16 | GM T43 |
| Firewall Bulkhead | 20+ | Deutsch or Mil-Spec (TBD) |
| Trailer Connector | 7 | SAE J560 |

**Format:** Letter portrait, one connector per page. Face view at 2:1 scale for small connectors (2-6 pin), 1:1 for larger connectors.


### 2.6 Component Location Diagram (Document 3.2)

**Purpose:** Answer the question "Where is this component physically on the vehicle?" Show every electrical device on a simplified vehicle outline.

**Audience:**
- Installer: locate mounting points before routing harness
- Technician: find a specific sensor or actuator for testing

**Content Requirements:**
- Four views: engine bay (top-down plan), underbody (bottom-up plan), cab interior (driver perspective), rear (looking forward from tailgate)
- Simplified vehicle outline -- not a photo, a clean line drawing showing major structural references (frame rails, firewall, inner fenders, dash structure)
- Every component labeled with its schematic symbol and component ID
- Component ID format: system abbreviation + sequential number (e.g., E-CKP = Engine Crank Position, P-FAN1 = PDM Fan 1)
- Callout line from label to approximate mounting location
- Reference to schematic section (e.g., "See Section 2, E14")

**Format:** Tabloid landscape, 4 views arranged 2x2.


### 2.7 Harness Routing Diagram (Document 3.1)

**Purpose:** Answer the question "Where does the harness physically run through the vehicle?" Show trunk paths, branch points, pass-through locations, clip points, and connector breakout positions.

**Audience:**
- Installer: route harness through vehicle following the planned path
- Harness builder: understand trunk diameters and branch geometry for loom sizing

**Content Requirements:**
- Vehicle plan view (top-down) showing frame rails, firewall, floor pan, major structural members
- Harness trunk paths shown as bold lines with directional arrows
- Trunk diameter annotations at representative points (calculated from wire count x individual OD + 15% packing factor)
- Firewall pass-through grommet locations with hole diameter
- Frame rail clip locations with clip part number
- Branch points (where trunk splits to reach individual devices) shown as labeled nodes
- Loom material callout: split-loom conduit diameter, heat-resistant wrap zones (within 150mm of exhaust), abrasion-resistant wrap zones (frame rail contact)
- Three looms identified: Engine Loom (28 wires), Dash Loom (18 wires), Rear Loom (27 wires + audio + chassis wires)

**Format:** ANSI D landscape, single sheet. Vehicle drawn at approximately 1:10 scale.


### 2.8 Harness Build Sheet (Document 1.5)

**Purpose:** Answer the question "How do I physically assemble this harness on the bench?" Show the harness laid flat with wire-by-wire branching, breakout dimensions, and connector positions.

**Audience:**
- Harness builder (bench): build the harness from scratch on a board or form

**Content Requirements:**
- Full-length harness shown laid flat (as it would be pinned to a build board)
- Main trunk shown as a bold parallel pair of lines (representing the loom)
- Each branch drawn departing from the trunk at the correct distance from the trunk origin
- Branch-point dimensions: distance from trunk origin to each branch point (in inches and mm)
- Breakout lengths: distance from branch point to each connector
- Every connector drawn at the end of its branch with connector ID
- Wire count annotation at each trunk segment (between branch points)
- Loom diameter annotation at each trunk segment
- Tape/tie points marked (every 150mm on trunk, every 75mm on branches per IPC/WHMA-A-620)
- Strain relief callouts at every connector entry
- Splice locations marked with splice ID

**Format:** ANSI D landscape, one sheet per loom (3 sheets total: engine, dash, rear). Drawn at 1:4 scale with dimension callouts.

---

## 3. DRAWING STANDARDS

### 3.1 Applicable Standards

| Standard | Title | Application |
|----------|-------|-------------|
| **SAE J1128** | Low-Tension Primary Cable | Wire type selection: TXL (cross-linked polyethylene, 125C) is the specified insulation for this build. All wire gauges per J1128 Table 1. Voltage drop calculations per J1128 ampacity tables. |
| **SAE J1292** | Automobile, Truck, Truck Tractor, Trailer, and Motor Coach Wiring | Harness routing, grounding practices, connector selection, environmental protection. Clause 4.3 (grounding) mandates star-ground architecture for ECU installations. Clause 5.2 (routing) specifies minimum bend radius of 3x wire OD. |
| **SAE J1939** | Serial Control and Communications Vehicle Network | CAN bus physical layer: twisted-pair impedance (120 ohm), termination, stub length limits, baud rate. Twist rate minimum 33 twists/meter. |
| **IPC/WHMA-A-620** | Requirements and Acceptance for Cable and Wire Harness Assemblies | Workmanship standard for harness construction. Class 2 (Dedicated Service) applies. Specifies crimp inspection criteria, solder joint quality, lacing/tying, wire dress. |
| **SAE J858** | Blade Type Electric Fuses | Fuse sizing and derating. Not directly applicable (PDM30 replaces blade fuses) but informs the few non-PDM protection points. |
| **ISO 11898** | Controller Area Network | CAN bus specification. Supplements J1939 for physical layer requirements. |

### 3.2 OEM Conventions Referenced

**GM (General Motors) -- Primary Reference:**
- ST-350/ST-352 wiring diagram format (1978-1988 C/K truck): grid address system, wire label format, section organization, zone layout. Our diagrams adopt this structure with Motec-specific modifications (documented in Appendix E Section 8).
- GM circuit numbering system (Appendix A): used as cross-reference for retained factory circuits. New Motec circuits use a separate ID scheme.
- GM wire color code table: 3-letter abbreviations (BLK, RED, WHT, ORG, YEL, BRN, GRN, BLU, PPL, PNK, GRY, TAN, LT GRN, DK GRN, LT BLU, DK BLU). We adopt this color vocabulary.

**Ford / Chrysler -- Secondary Reference:**
- Ford uses function-based wire codes (e.g., "C241" = ignition circuit 241). We adopt this philosophy for Motec circuits rather than sequential numbering.
- Chrysler splice identification system: every splice gets a unique ID (S101, S102...) traceable across sections. We adopt this.

### 3.3 Motorsport Conventions

**FIA (Appendix J, Article 259):** Requires harness documentation showing wire routing, connector identification, and circuit protection for competition homologation. Our documentation exceeds this requirement.

**Motec Wiring Guidelines (M1 Platform Wiring Manual):**
- Shielded cables for crank, cam, and knock sensors -- shield drain connected to sensor ground (M130 pin B15/B16), NOT chassis ground
- Star-ground architecture mandatory: all sensor grounds return to ECU sensor ground pins, not chassis
- CAN bus: single twisted pair, 120-ohm termination at each physical end of the backbone
- Half-bridge outputs (throttle body motor): use heavy-gauge wire (16 AWG minimum for LS3 90mm DBW)

### 3.4 AEM TA2 LS3 Harness Diagram -- Analysis

The AEM 36-3824 Rev. A diagram (extracted and stored as `aem_ta2_ls3_harness_diagram.png`) is a component interconnection diagram. It is a useful reference for what it does well and what it omits.

**What the AEM diagram does right:**
- Every connector drawn as a physical face view with pin labels
- Connector viewed from REAR (harness side) -- clearly noted in legend
- Every connector labeled with GM part number (12591720 for cam sensor, 12615626 for crank, etc.)
- Ground connections shown explicitly (R1, R2 ground symbols)
- Firewall pass-through (F1) shown as a labeled boundary
- Component grouping by physical proximity (coil banks, injector banks)
- Acronym table in upper-right corner defining all abbreviations

**What the AEM diagram is missing (and our diagrams must include):**
- No wire codes -- wires are unlabeled lines with no gauge, color, or circuit ID
- No current ratings or fuse values
- No wire lengths
- No cross-reference to other system diagrams (this is the entire diagram on one sheet -- no lighting, body, audio, etc.)
- No grid address system -- components are positioned but not addressable
- No power distribution hierarchy -- where does 12V come from?
- No ground distribution detail -- ground symbols shown but no ground point specifications (bolt size, torque, paint removal area)
- No CAN bus -- no communication layer shown
- No title block with revision control
- No scale or dimensional reference

Our diagrams must include all of the above. The AEM diagram is a component-level wiring guide; our documents are a complete system-engineering package.

---

## 4. SYMBOL LIBRARY

67 symbols organized into 9 categories. Every symbol is defined with its exact geometry, stroke weight, and usage rules. All symbols are drawn with 0.5pt black stroke unless otherwise specified.

### 4.1 Power Distribution Symbols (8 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| P-01 | **Battery** | Parallel lines: long thin line (positive) over short thick line (negative), with + and - labels | 6mm wide x 8mm tall | At the battery and at any point representing the battery voltage rail |
| P-02 | **Fuse (blade)** | Two parallel vertical lines connected by S-curve, with amp rating inside | 4mm wide x 6mm tall | At each fuse location in non-PDM circuits (fuel pump relay fuse, amplifier fuse) |
| P-03 | **Fusible Link** | Wavy line (zigzag, 3 cycles) between two wire endpoints, labeled "FUSIBLE LINK" with gauge | 8mm wide x 3mm tall | At each fusible link location (alternator to junction, battery to starter) |
| P-04 | **Circuit Breaker** | Rectangle with diagonal line (breaker element), amp rating inside | 4mm x 4mm | At any resettable protection point (not used in this build -- PDM30 provides electronic circuit breaking) |
| P-05 | **PDM Channel** | Rectangle with channel number inside, current rating below, output state indicator (open/closed) | 5mm x 8mm | At each PDM30 output channel (30 instances on Section 4) |
| P-06 | **Relay** | Rectangle with coil symbol (diagonal line between two contacts) inside, 5 terminals labeled (85=coil+, 86=coil-, 30=common, 87=NO, 87a=NC) | 8mm x 10mm | At each standalone relay: fuel pump relay, iBooster relay, starter relay, amplifier relay |
| P-07 | **Battery Disconnect** | Relay symbol with heavy-gauge wire connections and "RBD 190" label | 10mm x 12mm | At the Motec RBD 190 battery disconnect location (Section 0) |
| P-08 | **Alternator** | Circle with "ALT" label and output terminal indicators, amp rating annotation | 10mm diameter | At the Powermaster 150A alternator (Section 0) |

### 4.2 Switching / Control Symbols (9 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| S-01 | **Switch (SPST, open)** | Horizontal line with angled contact (30 degrees from horizontal), dot at pivot | 6mm x 4mm | Generic switch in open position |
| S-02 | **Switch (SPST, closed)** | Horizontal line with contact touching opposite terminal, dot at pivot | 6mm x 4mm | Generic switch in closed position |
| S-03 | **Switch (SPDT)** | Horizontal line with contact between two terminals (upper and lower), common terminal at pivot | 6mm x 6mm | Toggle/rocker switches with two positions (headlight hi/lo, transfer case) |
| S-04 | **Momentary Switch (normally open)** | Same as S-01 but with spring return arrow on contact arm | 6mm x 4mm | Horn button, brake light switch, door jamb switches |
| S-05 | **Rotary Switch** | Circle with wiper arm and numbered positions around circumference | 8mm diameter | Headlight switch (off/park/head), blower speed switch (off/1/2/3/4) |
| S-06 | **Ignition Switch** | Rotary switch with positions labeled: OFF, ACC, RUN, START (spring return from START to RUN) | 10mm diameter | Ignition switch (Section 0), showing all 4 positions and which circuits are energized in each |
| S-07 | **Pressure Switch** | Switch symbol with pressure transducer element (circle with arrow), set-point annotation | 6mm x 6mm | A/C low-pressure cutoff switch, A/C high-pressure cutoff switch |
| S-08 | **Neutral Safety Switch** | Switch symbol with mechanical linkage indicator (dashed line to shift mechanism) | 6mm x 6mm | Neutral safety switch on transmission (Section 7) |
| S-09 | **Hazard Flasher** | Rectangle labeled "FLASHER" with 3 terminals (B, L, P) | 5mm x 8mm | Hazard/turn signal flasher module |

### 4.3 Sensor / Input Symbols (11 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| I-01 | **Thermistor (NTC)** | Resistor symbol (zigzag) inside a circle with "t" subscript and thermometer icon | 6mm diameter | Coolant temp sensor (ECU), intake air temp sensor, oil temp sensor |
| I-02 | **Pressure Transducer** | Circle with internal diaphragm element (curved line) and pressure arrow | 6mm diameter | Oil pressure sensor (ECU), MAP sensor, fuel pressure sensor, A/C pressure switches |
| I-03 | **Hall Effect Sensor** | Rectangle with "H" inside, 3 terminals (5V ref, signal, ground), small arrow indicating magnetic sensing direction | 5mm x 8mm | Crank position sensor (58X), cam position sensor |
| I-04 | **Knock Sensor (piezoelectric)** | Hexagon shape with "KS" inside, 2 terminals (signal, ground), mounting bolt indicator | 6mm x 6mm | Knock sensor bank 1, knock sensor bank 2 |
| I-05 | **Position Sensor (potentiometric)** | Resistor with wiper arrow, 3 terminals (5V ref, signal, ground) | 6mm x 4mm | Throttle position sensor (integrated in throttle body), fuel level sender |
| I-06 | **Speed Sensor (reluctor)** | Coil symbol with gear tooth indicator, 2 terminals | 5mm x 8mm | Vehicle speed sensor (driveshaft) |
| I-07 | **Wideband Lambda Sensor** | Circle with lambda symbol inside, 5 terminals (IP, VS, HPWR, HGND, Rcal), connected to LTCD controller box | 8mm diameter | Wideband O2 sensor 1 (bank 1), wideband O2 sensor 2 (bank 2) |
| I-08 | **Fuel Level Sender** | Potentiometer symbol with float arm indicator, 2 terminals (signal, ground) | 6mm x 8mm | Fuel tank sender unit |
| I-09 | **Door Jamb Switch** | Momentary switch symbol with spring return, mechanical plunger indicator | 4mm x 6mm | Door switch left, door switch right |
| I-10 | **Backup Camera** | Rectangle with lens symbol, 3 connections (power, ground, video) | 6mm x 6mm | Rear backup camera |
| I-11 | **Gauge Sender (resistive)** | Resistor with mechanical linkage indicator, 2 terminals | 5mm x 5mm | Oil pressure sender (gauge), coolant temp sender (gauge) -- separate from ECU sensors in dual-sender architecture |

### 4.4 Actuator / Output Symbols (10 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| O-01 | **Electric Motor** | Circle with "M" inside, 2 terminals (+ and -) | 6mm diameter | Window motors, wiper motor, blower motor, electric water pump, radiator fans, fuel pump |
| O-02 | **Reversible Motor** | Circle with "M" inside and bidirectional arrows, 2 terminals with H-bridge indication | 6mm diameter | Window motors (direction determined by switch polarity), electric parking brake motor |
| O-03 | **Solenoid** | Rectangle with coil symbol (single winding), 2 terminals, mechanical arrow indicating plunger direction | 4mm x 8mm | Door lock actuators, A/C compressor clutch solenoid |
| O-04 | **Fuel Injector** | Solenoid symbol with nozzle tip at one end, 2 terminals | 4mm x 8mm | Fuel injectors x8 (EV6/USCAR connector, peak-and-hold drive from M130) |
| O-05 | **Ignition Coil** | Primary winding (few turns) over secondary winding (many turns), 4 terminals (B+, IGN command, gnd, spark out) | 6mm x 10mm | D510C ignition coils x8 (coil-near-plug) |
| O-06 | **Horn** | Circle with sound wave lines radiating from one side | 6mm diameter | Horn (PDM30:OUT14) |
| O-07 | **Speaker** | Cone shape with magnet housing, 2 terminals (+, -) | 6mm x 6mm | Front speakers x2, rear speakers x2, subwoofer |
| O-08 | **Electric Brake Booster** | Rectangle with "iBOOSTER" label, hydraulic port symbol, 3 electrical connections (power, ground, CAN/signal) | 8mm x 12mm | Bosch iBooster Gen 2 (Section 0, dedicated relay circuit) |
| O-09 | **A/C Compressor Clutch** | Circle with "A/C" inside and clutch engagement indicator, 2 terminals | 6mm diameter | Sanden SD7H15 compressor (PDM30:OUT16) |
| O-10 | **Throttle Body (DBW)** | Rectangle with butterfly valve symbol inside, motor symbol on one side, TPS symbols on the other, 6 terminals clearly labeled (Motor+, Motor-, TPS1 5Vref, TPS1 signal, TPS2 signal, sensor ground) | 10mm x 12mm | GM 12605109 LS3 90mm electronic throttle body |

### 4.5 Lighting Symbols (5 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| L-01 | **LED Headlight** | Circle with "X" pattern inside (lamp symbol) and "LED" annotation, 2 terminals | 8mm diameter | Truck-Lite 27270C left and right headlights |
| L-02 | **Incandescent/LED Lamp** | Circle with "X" pattern inside, 2 terminals | 6mm diameter | Parking lights, side markers, clearance lights, license plate light, cargo light, underhood light |
| L-03 | **Dual-Filament Lamp** | Circle with "X" pattern inside and two separate filament connections, 3 terminals (common ground, brake/turn filament, tail filament) | 6mm diameter | Combined tail/stop/turn lamps (United Pacific CTL7387LED -- sequential LED, but uses dual-function wiring) |
| L-04 | **Third Brake Light** | Elongated rectangle with "X" pattern, 2 terminals | 10mm x 4mm | Center high-mount stop lamp |
| L-05 | **Interior Light** | Circle with small rays emanating (indicating area illumination), 2 terminals | 5mm diameter | Dome light, under-dash LEDs, footwell lights, glove box light |

### 4.6 Connector Symbols (5 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| C-01 | **Inline Connector (mating pair)** | Two rectangular halves facing each other with aligned pin/socket indicators, connector ID label | 4mm x varies | At every point where two harness sections connect inline (engine-to-dash at firewall, dash-to-rear) |
| C-02 | **Device Connector (face view)** | Rectangular outline showing cavity layout from mating face, with keying feature, filled circles for populated pins, open circles for empty, pin labels, part number | Varies with pin count | At every multi-pin device connection (see Section 2.5 for full specification) |
| C-03 | **Ring Terminal** | Circle with lead-in line, hole diameter annotation | 4mm diameter | At every bolt-down ground point (engine ground, body ground, battery terminals) |
| C-04 | **Spade Terminal** | Fork shape with lead-in line | 3mm x 5mm | At fuse holder connections (non-PDM circuits) |
| C-05 | **Butt Splice** | Two lines meeting at a cylindrical splice indicator with splice ID label | 3mm x 6mm | At any wire-to-wire splice location (identified in splice schedule) |

### 4.7 Ground Symbols (4 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| G-01 | **Chassis Ground** | Three horizontal lines decreasing in width (standard chassis ground), bolt callout | 4mm x 5mm | At every point where a wire is bolted directly to the frame or engine block |
| G-02 | **Body Ground** | Chassis ground symbol with "B" subscript | 4mm x 5mm | At every point where a wire is bolted to the cab body |
| G-03 | **Star Ground Bus** | Horizontal bar (bus) with multiple vertical connections descending to chassis ground symbol, "STAR GND" label | 8mm x 6mm | At each star-ground collection point (engine star ground, sensor star ground, body star ground) |
| G-04 | **ECU Sensor Ground** | Triangle with "SG" inside, pin reference label | 4mm x 4mm | At each ECU sensor ground return (M130 pins B15/B16 SEN_0V_A/B). Used for all sensor grounds to distinguish from chassis/power grounds |

### 4.8 Protection Device Symbols (3 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| D-01 | **Diode** | Triangle pointing in current flow direction with bar at cathode, polarity labels | 4mm x 3mm | Flyback diodes across relay coils, reverse-polarity protection |
| D-02 | **TVS (Transient Voltage Suppressor)** | Bidirectional diode symbol (two triangles back-to-back with bars) | 5mm x 3mm | Across CAN bus lines (if external TVS protection used beyond ECU internal protection) |
| D-03 | **Capacitor** | Two parallel vertical lines, capacitance value annotation | 3mm x 4mm | Across sensor signal lines if EMI filtering required (typically internal to ECU) |

### 4.9 Communication & Routing Symbols (12 symbols)

| # | Symbol Name | Drawing | Dimensions | When Used |
|---|-------------|---------|------------|-----------|
| R-01 | **Wire (hot, powered)** | Solid horizontal line | 0.5pt stroke, black | Every powered circuit wire |
| R-02 | **Wire (ground)** | Dashed horizontal line (6pt dash, 3pt gap) | 0.5pt stroke, black | Every ground return wire |
| R-03 | **Wire (heavy current)** | Solid horizontal line, heavy weight | 1.0pt stroke, black | Battery cables (4 AWG), starter cable, alternator output (8 AWG) |
| R-04 | **Wire (signal, low current)** | Solid horizontal line, thin weight | 0.35pt stroke, black | Sensor signals (22 AWG), switch inputs |
| R-05 | **Wire crossing (no connection)** | Two lines crossing with a small semicircular bump on one line at the intersection | Standard line weights | Any place two wires cross on the diagram without electrical connection |
| R-06 | **Wire junction (connection)** | Filled black circle at intersection of two or more wires | 2pt diameter | Any place two or more wires connect electrically (T-junction, 4-way junction) |
| R-07 | **Splice** | Small inverted triangle with filled dot at center, splice ID label | 3mm x 3mm | At every point where one wire branches to feed multiple destinations |
| R-08 | **Shielded Cable** | Parallel lines with dashed line envelope enclosing them, shield drain wire shown as separate conductor | Envelope 2mm wider than enclosed wires | Crank sensor cable, cam sensor cable, knock sensor cables (4 instances total) |
| R-09 | **Twisted Pair** | Two lines with periodic "twist" markers (small X every 20mm of drawing length) | Standard wire weight | CAN bus backbone (M130 B17/B18 to PDM30 B25/B26) |
| R-10 | **Cross-Reference Arrow (right)** | Horizontal arrow pointing right with destination annotation above | 6mm x 3mm | At right edge of sheet where wire continues to next page or different section |
| R-11 | **Cross-Reference Arrow (left)** | Horizontal arrow pointing left with source annotation above | 6mm x 3mm | At left edge of sheet where wire arrives from previous page or different section |
| R-12 | **Termination Resistor** | Standard resistor symbol (zigzag) with value annotation (120 ohm) | 4mm x 3mm | At each end of CAN bus backbone |

---

## 5. LABELING AND ANNOTATION

### 5.1 Wire Identification Format

Every wire carries a label positioned above the wire line, left-aligned from the source endpoint. The label contains four fields in a fixed-width format.

```
FORMAT:  [CircuitID]  [Gauge]  [Color]

EXAMPLES:
  INJ1     18AWG    GRN
  CKP-SIG  22AWG    BLU/WHT
  BAT+     4AWG     RED
  CAN-H    22AWG    WHT/GRN
  GND-ENG  4AWG     BLK
```

| Field | Description | Source | Font |
|-------|-------------|-------|------|
| CircuitID | Unique circuit identifier, function-based (not sequential) | Cut list "LABEL" column, converted to abbreviated form | Courier New, 6pt, Regular |
| Gauge | Wire gauge in AWG | Cut list "SPEC" column | Courier New, 6pt, Regular |
| Color | Wire color using GM 3-letter abbreviations, stripe separated by "/" | Cut list "COLOR" column | Courier New, 6pt, Regular |

**Circuit ID Naming Convention:**

| Prefix | System | Examples |
|--------|--------|----------|
| BAT | Battery / power source | BAT+, BAT-, BAT-DISC |
| ALT | Alternator / charging | ALT-OUT, ALT-SENSE |
| STR | Starter | STR-SOL, STR-NEUT |
| INJ | Fuel injection | INJ1 through INJ8 |
| IGN | Ignition coil drive | IGN1 through IGN8 |
| CKP | Crank position | CKP-SIG, CKP-5V, CKP-GND |
| CMP | Cam position | CMP-SIG, CMP-5V, CMP-GND |
| KNK | Knock sensor | KNK1-SIG, KNK1-GND, KNK2-SIG, KNK2-GND |
| ETB | Electronic throttle body | ETB-M1, ETB-M2, ETB-TPS1, ETB-TPS2, ETB-5V, ETB-GND |
| MAP | Manifold absolute pressure | MAP-SIG, MAP-5V, MAP-GND |
| CLT | Coolant temperature | CLT-SIG, CLT-GND |
| IAT | Intake air temperature | IAT-SIG, IAT-GND |
| OPS | Oil pressure sensor (ECU) | OPS-SIG, OPS-5V, OPS-GND |
| FPS | Fuel pressure sensor | FPS-SIG, FPS-5V, FPS-GND |
| OTS | Oil temperature sensor | OTS-SIG, OTS-GND |
| O2 | Wideband lambda | O2-1, O2-2 (to LTCD controller) |
| CAN | Controller area network | CAN-H, CAN-L |
| HL | Headlight | HL-L, HL-R |
| PK | Parking light | PK-FL, PK-FR |
| TN | Turn signal | TN-FL, TN-FR, TN-RL, TN-RR |
| TL | Tail light | TL-L, TL-R |
| BU | Backup light | BU-L, BU-R |
| MK | Side marker | MK-FL, MK-FR, MK-RL, MK-RR |
| CL | Clearance light | CL-L, CL-C, CL-R |
| LP | License plate | LP |
| 3BRK | Third brake light | 3BRK |
| DOM | Dome / interior | DOM, DASH-LED, FOOT-LED |
| WIP | Wiper | WIP-PWR, WIP-PARK |
| WSH | Washer | WSH |
| HRN | Horn | HRN |
| BLW | Blower motor | BLW |
| AC | A/C system | AC-CLT, AC-LO, AC-HI |
| WIN | Power windows | WIN-L, WIN-R |
| LCK | Power locks | LCK-L, LCK-R |
| STP | Power steps | STP-L, STP-R, STP-CTL |
| FUP | Fuel pump | FUP-PWR, FUP-RLY |
| iBST | iBooster | iBST-PWR, iBST-RLY |
| AMP | Audio amplifier | AMP-PWR |
| RAD | Radio | RAD-PWR |
| SPK | Speaker | SPK-FL, SPK-FR, SPK-RL, SPK-RR, SPK-SUB |
| GND | Ground | GND-ENG, GND-BODY, GND-STAR, GND-SEN |
| USB | USB / accessory | USB |
| CIG | Cigarette lighter | CIG |
| EPB | Electric parking brake | EPB |
| TCM | Transmission | TCM-PWR |
| NSS | Neutral safety | NSS |
| REV | Reverse switch | REV |
| VSS | Vehicle speed | VSS |
| DKD | Dakota Digital | DKD-PWR |
| LTCD | Lambda controller | LTCD-PWR |
| CAM | Backup camera | CAM |

### 5.2 Component Identification Format

Every component on every diagram has a unique component ID consisting of a zone prefix and a sequential number within that zone.

```
FORMAT:  [Zone]-[Abbreviation][Number]

EXAMPLES:
  E-INJ1    Engine zone, Injector 1
  E-CKP     Engine zone, Crank Position Sensor
  D-DKD     Dash zone, Dakota Digital gauge cluster
  C-WIP     Chassis zone, Wiper motor
  R-TL1     Rear zone, Tail light left
```

| Zone Prefix | Zone | Column Range (Schematic) |
|-------------|------|-------------------------|
| F | Forward (ahead of engine) | 1-8 |
| E | Engine bay | 9-20 |
| D | Dash / instrument panel / cab interior | 21-37 |
| C | Chassis / underbody | Varies per system |
| R | Rear (behind cab) | 60+ (page 2) |

Component labels are placed adjacent to the component symbol (not inside). Font: Courier New, 8pt, Bold. Labels are positioned to avoid overlapping wire lines. If space is constrained, a leader line (thin solid, 0.25pt) connects the label to the component.

### 5.3 Connector Identification Format

```
FORMAT:  [ComponentID]:[ConnectorLabel]

EXAMPLES:
  M130:A       M130 ECU, Connector A (34-pin Superseal)
  M130:B       M130 ECU, Connector B (26-pin Superseal)
  PDM30:A      PDM30, Connector A (34-pin Superseal)
  PDM30:B      PDM30, Connector B (26-pin Superseal)
  PDM30:C      PDM30, Connector C (M6 stud)
  E-ETB:main   Electronic Throttle Body, main connector
  E-CKP:main   Crank Position Sensor, main connector
```

### 5.4 Pin Identification Format

```
FORMAT:  [ConnectorID]:[PinNumber]

EXAMPLES:
  M130:A03     M130 Connector A, pin 3 (IGN_LS1 -- ignition coil 1)
  M130:B01     M130 Connector B, pin 1 (UDIG1 -- crank position sensor)
  PDM30:A01    PDM30 Connector A, pin 1 (OUT1 -- Radiator Fan 1)
  PDM30:B25    PDM30 Connector B, pin 25 (CAN_LO)
  E-ETB:A      Throttle body, pin A (Motor drive 2)
```

Pin designations must match exactly between: the connector face view sheet, the connector schedule, the system schematic, and the M130/PDM30 pin maps in the database.

### 5.5 Cross-Reference Format

When a wire exits one schematic section and continues in another, a cross-reference annotation is placed at the wire terminus.

**Same-section continuation (wire exits right edge, continues on next page):**
```
─────────────────────────────────►
INJ1  18AWG  GRN
                    SEE PAGE 2, B42
```

**Different-section cross-reference (wire connects to a different system):**
```
─────────────────────────────────►
FUP-PWR  10AWG  ORG/BLU
                    TO SEC 0 (POWER DIST)
                    PAGE 1, D15
```

The cross-reference includes:
- Destination section number and title abbreviation
- Destination page number
- Destination grid address (column + row letter)

A matching cross-reference arrow at the destination end points back to the source:
```
◄─────────────────────────────────
FUP-PWR  10AWG  ORG/BLU
FROM SEC 2 (ENGINE)
PAGE 3, K65
```

### 5.6 Revision Control

Every document carries revision history in the title block and a separate revision table.

**Revision table (placed in upper-right corner of each sheet):**

| Rev | Date | By | Description |
|-----|------|----|-------------|
| -- | 2026-04-04 | NUKE | Initial release |
| A | TBD | TBD | First revision |
| B | TBD | TBD | Second revision |

**Revision marking on diagram:** Changed areas are enclosed in a triangle (delta) symbol with the revision letter. Lines, components, or annotations that changed in the current revision are highlighted with a revision cloud (irregular bumpy outline).

**Revision letter sequence:** --, A, B, C, D, ... (initial release is "--", first change is "A")

### 5.7 Title Block

Every sheet has a title block in the bottom-right corner, 80mm wide x 30mm tall.

```
┌────────────────────────────────────────────────────────────────┐
│  NUKE LTD                              DRAWN: ___  DATE: ___  │
│  676 Wells Rd, Boulder City NV 89005   CHK'D: ___  DATE: ___  │
│                                        APPR:  ___  DATE: ___  │
│  1977 CHEVROLET K5 BLAZER                                     │
│  LS3 6.2L / MOTEC M130 / PDM30        SCALE: NTS              │
│                                        SHEET: ___ OF ___      │
│  SECTION [#]: [TITLE]                  REV: --                 │
│                                        DWG NO: NKW-K5-[SEC]-  │
│  VIN: CCL187Z210370                    [PAGE]                  │
└────────────────────────────────────────────────────────────────┘
```

**Drawing number format:** `NKW-K5-[SECTION]-[PAGE]`
- NKW = Nuke Wiring
- K5 = Vehicle identifier
- SECTION = 2-digit section number (00-13)
- PAGE = page number within section (1, 2, 3...)
- Example: NKW-K5-02-1 = Section 2 (Engine), Page 1

### 5.8 Bill of Materials Reference

Components on schematics reference the BOM using a parts-list balloon: a circle with a sequential number inside, connected by leader line to the component. The BOM table (Document 1.4) lists all items by that number, with full manufacturer, part number, description, and quantity.

---

## 6. LAYER / VIEW ARCHITECTURE

### 6.1 The Three Diagram Paradigms

This diagram set contains three fundamentally different ways of looking at the same wiring:

| Paradigm | Example | Purpose | What It Shows | What It Hides |
|----------|---------|---------|---------------|---------------|
| **Component Diagram** | AEM TA2 LS3 diagram | "What plugs into what?" | Physical connectors, pin assignments, connector part numbers | Circuit logic, wire routing, power hierarchy, protection |
| **System Schematic** | GM ST-350 wiring diagrams | "How is the circuit designed?" | Circuit logic, power flow, protection coordination, cross-references | Physical locations, harness routing, loom construction |
| **Physical Layout** | GM service manual routing diagrams | "Where is everything on the vehicle?" | Component locations, harness trunk paths, firewall pass-throughs | Detailed circuit logic, pin assignments |

All three paradigms reference each other through consistent use of component IDs, connector IDs, and circuit IDs.

### 6.2 Schematic View Zones (System Schematics)

The schematic diagrams represent the physical vehicle laid out left-to-right on the sheet, matching the GM convention:

```
COLUMN:  1    5    10   15   20   25   30   35   37
         ├────┼────┼────┼────┼────┼────┼────┼────┤
         │    │         │    :    │              │
         │FWD │  ENGINE │    :FW │     CAB      │
         │LMP │   BAY   │    :   │   INTERIOR   │
         │    │         │    :    │              │
         ├────┼────┼────┼────:────┼────┼────┼────┤
              ▲              ▲         ▲
        FRONT BUMPER    FIREWALL   INSTRUMENT PANEL

         Column 20: Dashed vertical line labeled "FRONT OF DASH"
         Engine outline: Dashed rectangle spanning columns 9-19
```

**Vertical organization (row groups):**

| Row Range | Content | Typical Wire Types |
|-----------|---------|-------------------|
| A-D | Power distribution: battery, alternator, PDM main feed, fusible links | Heavy (4-10 AWG), hot |
| E-J | Engine sensors and actuators: injectors, coils, crank/cam, MAP, CLT | Medium-signal (18-22 AWG) |
| K-P | Mid-level systems: fuel pump, cooling fans, A/C, throttle body | Medium-power (14-18 AWG) |
| Q-T | Communication and signal: CAN bus, speed sensor, switches | Signal (20-22 AWG) |
| U-Z | Ground distribution: engine ground, sensor grounds, body grounds | Ground (dashed, various gauges) |

### 6.3 Physical Layout Views (Component/Routing Diagrams)

| View | Perspective | Covers | Sheet Orientation |
|------|-------------|--------|-------------------|
| Engine Bay (Plan) | Top-down, looking down with hood removed | Engine, radiator, headlights, firewall front face, inner fenders | Landscape, front at top |
| Underbody (Plan) | Bottom-up, looking up from ground | Frame rails, transmission, driveshaft, fuel tank, exhaust routing, rear axle | Landscape, front at top |
| Cab Interior (Perspective) | Driver seated position, looking forward at dash | Instrument panel, switches, gauge cluster, radio, blower motor, fuse panel | Landscape |
| Rear (Elevation) | Looking forward from tailgate | Tail lights, license plate, third brake, cargo light, rear camera, fuel sender, trailer connector | Landscape, viewed from rear |

### 6.4 Cross-Paradigm Reference Rules

Every component on a physical layout view carries a callout that says:
```
E-CKP
SEC 2, F12
```
meaning: component E-CKP is detailed on System Schematic Section 2, grid address F12.

Every component on a system schematic carries a zone annotation that says:
```
E-CKP
ENGINE BAY, FRONT OF BLOCK
```
referencing its physical location for the installer.

Every connector on a face view sheet references the schematic:
```
M130 CONNECTOR A
SEE SEC 3 FOR FULL PINOUT
SEE SEC 2 FOR ENGINE CIRCUITS
```

---

## 7. DATA REQUIREMENTS

### 7.1 Data Required Per Diagram

For each diagram type, the following data must exist in the database before production can begin.

#### System Schematics (Document 2.1)

| Required Data | Source Table | Column(s) | Status |
|---------------|-------------|-----------|--------|
| Every wire: from-device, to-device, from-pin, to-pin | Cut list output (computed) | circuit_id, from, to, spec, color | COMPLETE (113 wires) |
| Every ECU pin: function, assignment, wire gauge | component_connectors.pins (M130) | pins jsonb array | COMPLETE (60 pins, 34+26) |
| Every PDM channel: output number, current rating, load | component_connectors.pins (PDM30) | pins jsonb array | COMPLETE (61 pins, 34+26+1) |
| Component symbols (SVG) | component_drawings.svg_path | svg_path | MISSING -- no SVG symbols exist yet |
| Connector face view data | component_connectors | pin_count, pins, keying, sealed | COMPLETE for M130, PDM30, 10 LS3 sensors |
| Component physical zone | build_manifest_components | zone, mounting_location | PARTIAL -- zone populated, position_x/y/z mostly null |
| Wire routing (Manhattan paths) | Not in database | N/A -- computed at render time | NOT APPLICABLE |
| Cross-section references | Not in database | N/A -- computed from section assignments | NOT APPLICABLE |

#### Power Distribution Diagram (Document 2.2)

| Required Data | Source Table | Status |
|---------------|-------------|--------|
| PDM30 channel ratings (6x20A, 14x15A, 10x10A) | component_connectors.pins (PDM30) | COMPLETE |
| PDM30 channel load assignments | Connector schedule output | COMPLETE |
| Non-PDM high-current circuits (starter, alt, fuel pump, iBooster, amp) | Cut list, build manifest | COMPLETE |
| Fusible link ratings | Not in database | MISSING -- need to define fusible link values for non-PDM circuits |
| Battery cable sizes | Cut list | COMPLETE (4 AWG starter, 8 AWG alternator) |
| Alternator output rating | component_library (Powermaster 47294) | COMPLETE (150A) |

#### Ground Distribution Diagram (Document 2.3)

| Required Data | Source Table | Status |
|---------------|-------------|--------|
| Star ground bus definitions | M130 pin map (A10/A11, B15/B16) | COMPLETE |
| PDM ground pins | PDM30 pin map (A26/B18, A28/B22) | COMPLETE |
| Engine ground strap spec | Not in database | MISSING -- need gauge, length, bolt size, location |
| Body ground strap spec | Not in database | MISSING |
| Ground point locations on frame/body | build_manifest_components | MISSING -- no ground point entries in manifest |
| Ground point hardware (bolt size, torque) | Not in database | MISSING |

#### CAN Bus Network Diagram (Document 2.4)

| Required Data | Source Table | Status |
|---------------|-------------|--------|
| M130 CAN pins (B17/B18) | component_connectors.pins | COMPLETE |
| PDM30 CAN pins (B25/B26) | component_connectors.pins | COMPLETE |
| C125/Dakota Digital CAN pins | component_connectors | MISSING -- Dakota Digital connector not in library |
| Termination resistor locations | Not in database | MISSING -- need to define which device has built-in termination |
| Backbone routing path | build_manifest_components positions | PARTIAL |

#### Connector Face Views (Document 1.3)

| Required Data | Source Table | Status |
|---------------|-------------|--------|
| M130 Connector A: 34 pins, cavity layout | component_connectors | COMPLETE (34 pin objects in pins jsonb) |
| M130 Connector B: 26 pins, cavity layout | component_connectors | COMPLETE (26 pin objects) |
| PDM30 Connector A: 34 pins | component_connectors | COMPLETE |
| PDM30 Connector B: 26 pins | component_connectors | COMPLETE |
| Connector cavity geometry (physical layout of pin positions) | component_connectors | MISSING -- pin objects have function data but not physical position (row/column in the housing) |
| Harness-side connector part numbers | component_connectors.harness_side_pn | PARTIAL -- only M130 Connector A has it (MoTeC #65044) |
| Terminal part numbers and crimp specs | Not in database | MISSING |
| Connector keying/polarization details | component_connectors.keying | PARTIAL |

#### Harness Routing Diagram (Document 3.1)

| Required Data | Source Table | Status |
|---------------|-------------|--------|
| Vehicle outline (plan view) | Not in database | MISSING -- need simplified vehicle line drawing |
| Firewall grommet locations | Not in database | MISSING |
| Frame rail clip locations | Not in database | MISSING |
| Harness trunk paths | Not in database | MISSING -- need physical routing survey |
| Loom diameters | Computed from wire count x OD | COMPUTABLE |

#### Component Location Diagram (Document 3.2)

| Required Data | Source Table | Status |
|---------------|-------------|--------|
| Component X/Y/Z positions | build_manifest_components | PARTIAL -- zone populated, precise position mostly null |
| Vehicle outline views (4 views) | Not in database | MISSING |

### 7.2 Data Gap Summary

| Gap Category | Items Missing | Priority | Action Required |
|-------------|--------------|----------|-----------------|
| SVG symbol library | 67 symbols | HIGH -- blocks all schematic production | Create SVG files for every symbol defined in Section 4 |
| Connector cavity geometry | Physical pin layout for all multi-pin connectors | HIGH -- blocks face view sheets | Extract cavity positions from manufacturer connector drawings or datasheets |
| Vehicle outline drawings | 4 views (engine bay, underbody, cab, rear) | MEDIUM -- blocks physical layout diagrams | Trace from photos or CAD model |
| Ground point specifications | Bolt sizes, locations, torque specs for all ground points | MEDIUM -- blocks ground distribution diagram | Measure on physical vehicle |
| Terminal & crimp specifications | Part numbers, crimp tool dies for every connector family | MEDIUM -- blocks complete BOM and face view sheets | Research from Tyco/Delphi catalogs |
| Harness routing survey | Firewall grommet positions, frame clip locations, trunk paths | LOW -- blocks routing diagram but can be measured during installation | Survey physical vehicle |
| Fusible link values | Ratings for non-PDM circuits | LOW -- blocks complete power distribution diagram | Calculate from wire gauge and load |
| Dakota Digital connector data | CAN pins, power pins, signal interface | LOW -- blocks CAN diagram completion and gauge wiring detail | Extract from Dakota Digital installation manual |

### 7.3 Minimum Viable Data Set for First Diagram

The first diagram to produce should be **Section 2: Engine -- LS3** because:
1. All engine sensor data is complete (Chapter 8)
2. All M130 pin assignments for engine circuits are complete (Connector Schedule)
3. All engine wire specifications are complete (Cut List, engine loom: 28 wires)
4. The engine zone is self-contained (minimal cross-references to other sections)
5. It is the highest-value diagram for Desert Performance (engine harness is built first)

**Minimum data needed to produce Section 2:**
- 28 wire definitions from cut list (HAVE)
- M130 Connector A pin map: injectors A19-A30, coils A03-A13 (HAVE)
- M130 Connector B pin map: CKP B01, CMP B02, knock B07/B13, IAT B03, CLT B04, OTS B05 (HAVE)
- 10 LS3 sensor connector definitions (HAVE -- all in component_connectors)
- 1 throttle body connector definition (HAVE -- 6-pin, pins A-F defined in Chapter 8)
- SVG symbol library: need at minimum I-01 through I-06, O-04, O-05, O-10, C-02, G-01, G-04, R-01 through R-08 (~20 symbols)

---

## 8. PRODUCTION SEQUENCE

### Phase 1: Foundation (Must Do First)

| Step | Deliverable | Depends On | Estimated Effort |
|------|-------------|-----------|-----------------|
| 1.1 | SVG Symbol Library (67 symbols) | Symbol definitions in Section 4 | 40 hours CAD time |
| 1.2 | Grid template (ANSI D sheet with grid, title block, zones) | Appendix E grid spec | 4 hours |
| 1.3 | Connector cavity layout data (pin physical positions in housing) | Tyco Superseal 34/26 drawings, GM connector drawings | 8 hours research |

### Phase 2: Engine Section (First Diagram)

| Step | Deliverable | Depends On | Estimated Effort |
|------|-------------|-----------|-----------------|
| 2.1 | Section 2: Engine -- LS3 (schematic) | Phase 1 complete, cut list, connector schedule | 16 hours |
| 2.2 | M130 Connector A face view | Phase 1.3, M130-A pin data | 4 hours |
| 2.3 | M130 Connector B face view | Phase 1.3, M130-B pin data | 4 hours |
| 2.4 | LS3 sensor connector face views (10 connectors) | Phase 1.3, sensor connector data | 8 hours |

### Phase 3: Power Architecture

| Step | Deliverable | Depends On | Estimated Effort |
|------|-------------|-----------|-----------------|
| 3.1 | Section 0: Power Distribution (schematic) | Phase 1, battery/alternator/PDM data | 12 hours |
| 3.2 | Power Distribution Diagram (Document 2.2) | Phase 3.1 | 8 hours |
| 3.3 | Section 4: PDM30 Channel Map | Phase 1, PDM30 pin data, load assignments | 12 hours |
| 3.4 | PDM30 connector face views (A, B, C) | Phase 1.3, PDM30 pin data | 6 hours |
| 3.5 | Section 12: Ground Distribution (schematic) | Phase 1, ground point survey | 8 hours |
| 3.6 | Ground Distribution Diagram (Document 2.3) | Phase 3.5, ground point hardware specs | 4 hours |

### Phase 4: Remaining System Sections

| Step | Deliverable | Depends On | Estimated Effort |
|------|-------------|-----------|-----------------|
| 4.1 | Section 1: Forward Lamps | Phase 3.1 (power source), headlight/marker data | 6 hours |
| 4.2 | Section 3: ECU M130 Pinout (master face view) | Phases 2.2, 2.3 (already done, this is the summary sheet) | 4 hours |
| 4.3 | Section 5: Instrument Panel | Dakota Digital connector data (GAP), Phase 3.1 | 8 hours |
| 4.4 | Section 6: HVAC | Phase 3.1, blower/AC data | 4 hours |
| 4.5 | Section 7: Throttle / Transmission | Phase 2.1 (throttle body), TCM data | 6 hours |
| 4.6 | Section 8: Lighting -- Rear | Phase 3.1, tail light/backup data | 6 hours |
| 4.7 | Section 9: Audio / Accessories | Phase 3.1, audio component data | 6 hours |
| 4.8 | Section 10: Body (windows, locks, steps) | Phase 3.1, body component data | 6 hours |
| 4.9 | Section 11: CAN Bus Network | CAN pin data (HAVE), termination data (GAP) | 4 hours |
| 4.10 | Section 13: Trailer / Auxiliary | Trailer connector data (minimal) | 2 hours |

### Phase 5: Physical Layout Diagrams

| Step | Deliverable | Depends On | Estimated Effort |
|------|-------------|-----------|-----------------|
| 5.1 | Vehicle outline drawings (4 views) | Photos or CAD model of K5 Blazer | 12 hours |
| 5.2 | Component Location Diagram (Document 3.2) | Phase 5.1, component positions | 8 hours |
| 5.3 | Harness Routing Diagram (Document 3.1) | Phase 5.1, routing survey on vehicle | 12 hours |
| 5.4 | Connector Location Diagram (Document 3.3) | Phase 5.1, connector positions | 6 hours |

### Phase 6: Build Documents

| Step | Deliverable | Depends On | Estimated Effort |
|------|-------------|-----------|-----------------|
| 6.1 | Harness Build Sheet (engine loom) | Phase 2.1 complete, routing survey | 8 hours |
| 6.2 | Harness Build Sheet (dash loom) | Phase 4 sections complete, routing survey | 8 hours |
| 6.3 | Harness Build Sheet (rear loom) | Phase 4 sections complete, routing survey | 8 hours |

### Phase 7: Reference Documents

| Step | Deliverable | Depends On | Estimated Effort |
|------|-------------|-----------|-----------------|
| 7.1 | Wire Color Chart (Document 4.1) | Cut list complete | 2 hours |
| 7.2 | Circuit Index (Document 4.2) | All sections complete | 4 hours |

**Total estimated effort: ~260 hours** (including research time for data gaps)

**Critical path:** Phase 1 (foundation) blocks everything. Phase 2 (engine section) is the first real output and validates the entire rendering pipeline.

---

## 9. QUALITY CHECKLIST

Every diagram must pass ALL checks in its applicable category before release.

### 9.1 Completeness Checks

| # | Check | Method | Pass Criteria |
|---|-------|--------|--------------|
| C-01 | Every wire in the cut list appears on at least one schematic section | Cross-reference cut list wire #1-113 against all section sheets | 113/113 wires accounted for |
| C-02 | Every ECU pin (populated) appears on at least one schematic section | Cross-reference M130 connector schedule against section sheets | All 23 populated M130-A pins and 14 populated M130-B pins accounted for |
| C-03 | Every PDM channel (1-30) appears on exactly one schematic section | Cross-reference PDM30 channel map against section sheets | 30/30 channels shown, no duplicates |
| C-04 | Every component in the build manifest appears on the component location diagram | Cross-reference build manifest (115 devices) against Document 3.2 | 115/115 components located |
| C-05 | Every connector with 3+ pins has a face view sheet | Cross-reference connector list against Document 1.3 sheets | 13/13 face views complete |
| C-06 | Every section has a complete title block | Visual inspection of each sheet | Drawing number, revision, date, VIN, section title all present |
| C-07 | Every cross-reference arrow has a matching arrow at the destination | Trace every cross-reference: source section/page/address matches destination | Zero orphaned cross-references |
| C-08 | Ground distribution diagram accounts for every ground connection on the engine, sensors, PDM, and body | Count ground wires in cut list, verify all appear on Document 2.3 | All ground paths shown |
| C-09 | Power distribution diagram shows every protection device (PDM channel, fusible link, relay) between battery and load | Trace every load back to battery, verify protection at every stage | No unprotected circuits |

### 9.2 Consistency Checks

| # | Check | Method | Pass Criteria |
|---|-------|--------|--------------|
| N-01 | Pin A03 on M130 schematic matches pin A03 on M130 face view matches pin A03 on connector schedule | Compare all three documents for every populated pin | Zero mismatches across all documents |
| N-02 | Wire gauge on schematic matches wire gauge in cut list | Compare wire labels on schematics against cut list table | Zero gauge mismatches |
| N-03 | Wire color on schematic matches wire color in cut list | Compare color codes on schematics against cut list | Zero color mismatches |
| N-04 | Component ID on schematic matches component ID on location diagram | Cross-reference component IDs between Document 2.1 sections and Document 3.2 | Zero ID mismatches |
| N-05 | Connector housing part numbers on face views match connector schedule | Compare part numbers between Document 1.3 and Document 1.2 | Zero part number mismatches |
| N-06 | PDM channel assignments on schematic match PDM section (Section 4) | Verify every "PDM30:OUT[n]" reference in Sections 1, 6, 8, 9, 10 matches Section 4 | Zero channel assignment conflicts |
| N-07 | CAN bus pin assignments on CAN diagram (Section 11) match M130 and PDM30 face views | Verify CAN-H and CAN-L pin numbers are identical across all documents | Zero CAN pin mismatches |
| N-08 | Total wire count per loom on build sheet matches count of wires assigned to that loom in cut list | Sum wires per loom section in cut list, compare to build sheet trunk annotations | Zero count mismatches |
| N-09 | Splice IDs are unique across all sections | Collect all splice IDs from all sections, verify no duplicates | Zero duplicate splice IDs |

### 9.3 Readability Checks

| # | Check | Method | Pass Criteria |
|---|-------|--------|--------------|
| R-01 | Wire labels are legible at 100% print scale | Print one section at 1:1 on ANSI D paper, read every label at arm's length | All labels readable without magnification |
| R-02 | Minimum font size is 5pt (notes) and 6pt (wire data) | Verify font specifications against Section 5 | No text below 5pt |
| R-03 | No wire labels overlap other wire labels | Visual inspection of every wire label on every section | Zero overlaps |
| R-04 | No component symbols overlap other component symbols | Visual inspection | Zero overlaps |
| R-05 | Wire crossing (no connection) is visually distinguishable from wire junction (connection) | Verify bump symbol at crossings, dot symbol at junctions | No ambiguous intersections |
| R-06 | Minimum spacing between parallel wires is 3mm (30 SVG units) | Measure representative parallel wire runs | All spacing >= 3mm |
| R-07 | Grid address labels are visible on all four edges of every sheet | Visual inspection | All edges have complete grid labels |
| R-08 | Title block is complete and legible on every sheet | Visual inspection | All title block fields populated |
| R-09 | Color-coded wire labels (for digital version) match the physical wire color | Spot-check: RED wire shown in red, BLK wire in black, etc. | All colors match |

### 9.4 Traceability Checks

| # | Check | Method | Pass Criteria |
|---|-------|--------|--------------|
| T-01 | Any wire can be traced from battery positive to its load to ground return | Start at battery on Section 0, follow any circuit through all section cross-references to the load, then to ground on Section 12 | Complete circuit path for every wire |
| T-02 | Any sensor can be traced from ECU pin to sensor connector | Start at M130 face view, follow wire code to sensor on Section 2 | Unbroken path from ECU to sensor |
| T-03 | Any PDM load can be traced from PDM channel to load device | Start at PDM30 channel on Section 4, follow wire code to load on its section | Unbroken path from PDM to load |
| T-04 | Every wire has a unique circuit ID | Collect all circuit IDs from all sections, verify uniqueness | Zero duplicate circuit IDs for distinct wires |
| T-05 | Every ground wire can be traced to a defined ground point on the ground distribution diagram | Follow each ground wire from its device to its ground bus on Section 12 | All ground paths terminate at a defined ground point |

### 9.5 Engineering Checks

| # | Check | Method | Pass Criteria |
|---|-------|--------|--------------|
| E-01 | Wire gauge is adequate for the circuit's current at its length | Recalculate voltage drop for every wire using J1128 ampacity tables | All wires <= 3% voltage drop at rated load |
| E-02 | Shielded cables are specified for crank, cam, and knock sensors | Verify shield symbol (R-08) on CKP, CMP, KNK1, KNK2 wires | 4/4 shielded cables shown |
| E-03 | CAN bus is shown as twisted pair with termination at each end | Verify twist symbol (R-09) and termination resistor (R-12) on CAN backbone | Twisted pair and 2x 120-ohm termination shown |
| E-04 | Star ground architecture is maintained (no sensor ground wires going to chassis) | Verify every sensor ground wire terminates at ECU sensor ground pins (M130 B15/B16), not chassis ground | Zero sensor grounds to chassis |
| E-05 | High-current devices not on PDM have independent protection (fuse or fusible link) | Verify fuel pump (35A), iBooster (40A), amplifier (30A), alternator (150A), starter (200A) each have protection | All non-PDM high-current circuits protected |
| E-06 | Relay flyback diodes shown on all relay coils | Verify diode symbol (D-01) across every relay coil | Diodes on all relay coils |
| E-07 | PDM30 aggregate current does not exceed main feed capacity | Sum all PDM channel continuous loads, verify < 80A (M6 stud rating) | Total continuous < 80A |

---

## 10. GLOSSARY

| Term | Definition |
|------|-----------|
| AWG | American Wire Gauge. Smaller numbers = larger wire. |
| CAN | Controller Area Network. Serial communication bus, 500 kbps, twisted pair. |
| CLT | Coolant Temperature (sensor). |
| CMP | Cam Position (sensor). |
| CKP | Crank Position (sensor). |
| COP | Coil-on-Plug or Coil-Near-Plug ignition. |
| DBW | Drive-by-Wire. Electronic throttle control. |
| ECU | Engine Control Unit. The Motec M130 in this build. |
| EV6/USCAR | Fuel injector connector standard used on LS3. |
| FW | Firewall. The barrier between engine bay and cab. |
| IAT | Intake Air Temperature (sensor). |
| LTCD | Lambda-to-CAN Device. Motec wideband O2 controller. |
| MAP | Manifold Absolute Pressure (sensor). |
| Manhattan Routing | Wire routing using only horizontal and vertical line segments with 90-degree bends. |
| NTS | Not To Scale. |
| PDM | Power Distribution Module. The Motec PDM30 in this build. |
| Star Ground | Architecture where all ground wires in a subsystem converge at a single point (star) before connecting to the chassis/battery return. Prevents ground loops. |
| Superseal | Tyco Automotive connector series. Sealed, multi-pin. Used by Motec for M130 and PDM30 headers. |
| TPS | Throttle Position Sensor. |
| TXL | Cross-linked polyethylene wire insulation. 125C rated. SAE J1128 Type TXL. The specified insulation type for this build. |
| VSS | Vehicle Speed Sensor. |

---

## 11. DOCUMENT CONTROL

| Item | Value |
|------|-------|
| Document Number | NKW-K5-SPEC-001 |
| Title | Wiring Diagram Requirements Specification |
| Applies To | 1977 Chevrolet K5 Blazer, VIN CCL187Z210370 |
| Prepared By | NUKE LTD |
| Date | 2026-04-04 |
| Revision | -- (Initial Release) |
| Classification | Build Documentation -- Internal Use |

**Controlled Document.** Changes to this specification require revision marking per Section 5.6 and re-issue with updated revision letter.
