# Appendix E: Wiring Diagram Format Specification

Reverse-engineered from GM ST-350/ST-352 wiring diagram booklets (1978, 1985, 1987/88).
This spec defines every drawing primitive needed to generate industry-grade wiring diagrams for Motec/LS3 builds.

## 1. Grid System

The foundation. Every element has a grid address.

```
        1    2    3    4    5  ...  35   36   37
      ┌────┬────┬────┬────┬────     ────┬────┬────┐
  A   │    │    │    │    │              │    │    │  A
      ├────┼────┼────┼────┼────     ────┼────┼────┤
  B   │    │    │    │    │              │    │    │  B
      ├────┼────┼────┼────┼────     ────┼────┼────┤
  C   │    │    │    │    │              │    │    │  C
      :    :    :    :    :              :    :    :
  Z   │    │    │    │    │              │    │    │  Z
      └────┴────┴────┴────┴────     ────┴────┴────┘
        1    2    3    4    5  ...  35   36   37
```

- **Columns**: numbered 1-37 (page 1), 39-75 (page 2), 77-113 (page 3)
- **Rows**: lettered A-Z (26 rows)
- Column numbers printed at TOP and BOTTOM edges
- Row letters printed at LEFT and RIGHT edges
- Grid lines: 0.25pt, light gray (#CCCCCC)
- Cell size: approximately 18mm x 8mm at full scale (11x17" sheet = 37 cols x 26 rows)

Multi-page sections tile horizontally. A wire at column 37 on page 1 continues at column 39 on page 2.

## 2. Wire Representation

Every wire is a horizontal line with a data label.

### 2.1 Wire Line Types

| Line Style | Meaning | Stroke |
|------------|---------|--------|
| Solid, medium weight | Hot circuit (powered) | 0.5pt black |
| Dashed (long dash) | Ground circuit | 0.5pt black, dash 4pt gap 2pt |
| Solid, heavy weight | High-current path (battery cables) | 1.0pt black |
| Solid, thin | Signal/low-current | 0.35pt black |

### 2.2 Wire Label Format

Every wire carries a label ON the line. The 1987 format uses four fields:

```
┌──────────────────────────────────────────────┐
│  [suffix]  [circuit#]  [size_mm²]  [color]   │
│     ↓          ↓           ↓          ↓      │
│   150N       D10         8.0        BLK      │
└──────────────────────────────────────────────┘
```

| Field | Description | Example |
|-------|-------------|---------|
| Suffix | Wire variant letter (A,B,C...) appended to circuit number | 150N, 139B, 1190 |
| Circuit # | GM circuit identification number | 2, 39, 150, 439, 810 |
| Size | Wire cross-section in mm² | 0.5, 0.8, 1.0, 2.0, 3.0, 5.0, 8.0 |
| Color | Abbreviated wire color | BLK, RED, PNK/BLK, LT GRN, DK BLU |

Label font: monospace, 6pt. Positioned above the wire line, left-aligned from the source endpoint.

### 2.3 Wire Routing Rules

- **Manhattan routing only** — all segments horizontal or vertical, 90° bends
- **Horizontal** = wire run (the path the wire takes)
- **Vertical** = connection between horizontal runs or to components
- **Dot at intersection** = electrical connection (filled circle, 2pt diameter)
- **No dot at crossing** = wires cross without connecting
- **Arrow at wire end** = wire continues to another page/section (with address)

### 2.4 Wire Branching

When a wire splits (splice point):

```
          ──────────┬──────────
                    │
          Triangle with dot = splice
                    │
          ──────────┘
```

The splice symbol is a small triangle (▼) with a filled dot in center, approximately 3mm.
Multiple wire codes listed at the splice indicate the wires joined there.

## 3. Component Symbols

### 3.1 Core Symbol Library (~25 symbols needed)

```
BATTERY          GROUND (CHASSIS)    GROUND (BODY)     FUSE
  ┬─              ┴                    ⏚                ─┤├─
  │  ─  +         ═                                    with rating
  ┴─              ═

FUSIBLE LINK     CIRCUIT BREAKER      RELAY              MOTOR
  ─/\/\/─          ─⊳|⊲─             ┌──┐               (M)
  FUSE LINK                          │  │ coil
                                     └──┘

LAMP             SWITCH (OPEN)       SWITCH (CLOSED)     RESISTOR
  (X)              ─/ ─               ─/─                ─/\/\/─

SENSOR           SOLENOID            DIODE               CAPACITOR
  (◊)              ─|]─               ─▷|─               ─||─

ECM/MODULE       CONNECTOR           SPLICE              EYELET (GROUND)
  ┌────────┐     [face view]           ▼                   ⊖
  │ pin    │     with cavities        (dot)
  │ labels │
  └────────┘
```

### 3.2 Connector Face Views

Connectors are drawn as realistic cavity layouts showing the mating face:

```
  ┌─────────────────┐
  │  A   B   C   D  │    ← Pin/cavity labels
  │  ○   ○   ○   ○  │    ← Pin positions (open circles)
  │  E   F   G   H  │
  │  ○   ○   ○   ○  │
  └──────┬──────────┘
         │
     12040754           ← GM part number
```

Key features to draw:
- Locking tab/key on one edge
- Filled circles (●) = populated pins
- Open circles (○) = empty cavities
- Pin labels (A, B, C... or 1, 2, 3...)
- GM part number below

For our Motec builds, connector face views use Motec connector housing numbers instead of GM part numbers.

### 3.3 ECM/Module Representation

Large modules (ECM, PDM) drawn as labeled rectangles with pin lists:

```
  ┌─────────────────────────┐
  │         ECM             │
  │  .J1                    │
  │  TACH TO CKP            │
  │  HI RES ONLY            │
  │  EST BYPASS              │
  │  TP SENSOR               │
  │  A/C REQUEST             │
  │  MAP SENSOR              │
  │  etc.                    │
  │                          │
  │  X = WIRE 446            │
  │  USED W/M009             │
  │  AUTOMATIC TRANS. ONLY   │
  └─────────────────────────┘
```

Each pin listed with wire code. Notes for option-dependent wiring.

### 3.4 Fuse Block Detail

The fuse block gets its own dedicated diagram showing physical layout:

```
  ┌────────────────────────────────────────┐
  │   3    39     300    50                │
  │  ┌──┐ ┌──┐  ┌──┐  ┌──┐               │
  │  │20A│ │25A│  │25A│ │25A│              │
  │  │   │ │   │  │   │ │WIPER│            │
  │  └──┘ └──┘  └──┘  └──┘    4    93     │
  │   1    6      2    40    ┌──┐  ┌──┐    │
  │        ┌──┐        ┌──┐ │10A│  │25A│   │
  │        │15A│       │20A│ │   │  │AC/HTR││
  │        │   │       │   │ └──┘  └──┘    │
  │        │TURN│      │CTSY│              │
  │        └──┘       └──┘                │
  │                                        │
  │            FUSE BLOCK                  │
  └────────────────────────────────────────┘
```

Each fuse shows: position number, amp rating, circuit number, destination labels.

## 4. Spatial Layout

The diagram represents the physical vehicle, laid out left-to-right:

```
┌─────────┬──────────────┬─────────────────┬─────────────────┐
│ FORWARD │   ENGINE     │   FRONT OF      │   CAB /         │
│ LAMPS   │   BAY        │   DASH          │   INSTRUMENT    │
│         │              │   (firewall)    │   PANEL         │
│ cols    │  cols        │   dashed        │   cols          │
│ 1-8     │  9-20        │   vertical      │   21-37         │
│         │              │   line          │                 │
└─────────┴──────────────┴─────────────────┴─────────────────┘
  FRONT ←─────────────────────────────────────────────→ REAR
```

### 4.1 Zone Boundaries

| Zone | Column Range | Boundary Style | Label |
|------|-------------|----------------|-------|
| Forward lamps | 1-8 | — | Component labels only |
| Engine bay | 9-25 | Dashed rectangle | `ENGINE OUTLINE` |
| Firewall | ~20 | Dashed vertical line | `FRONT OF DASH` |
| Instrument panel | 21-37 | — | Component labels |
| Transmission | ~15-20 | Dashed box below engine | `MOUNTED ON TRANSMISSION` |
| Rear | 60+ (page 2) | — | `REAR` |

### 4.2 Vertical Organization

| Row Range | Content |
|-----------|---------|
| A-D | High-current power distribution (battery, starter, alternator) |
| E-J | Engine sensors and actuators |
| K-P | Mid-level systems (fuel, cooling, A/C) |
| Q-T | Signal circuits (speed sensor, trans, CAN) |
| U-Z | Grounds and low-level returns |

## 5. Cross-Referencing System

### 5.1 Same-Section Cross-Reference

When a wire exits one page and enters the next page of the same section:

```
Wire end:     ───────→  (arrow pointing right)
              SEE SECTION LOCATION
              [section]   [page]
```

### 5.2 Different-Section Cross-Reference

When a wire connects to a system on a different section:

```
              TO
              I/P           ← destination system
              [section] [page]
              5         I7    ← section 5, address I7
```

### 5.3 Wire Address Code

At each wire termination, the address code tells you where the other end is:

```
Format: [page_column] [row]
Example: N9 = column 9, row N on this page
         If on a different page: section and page number shown
```

## 6. Annotation Conventions

### 6.1 Option-Dependent Wiring

When a wire or component is only present with certain options:

```
USED WITH L19 ENGINE ONLY
USED WITH L19 & A/C ONLY
422 USED W/AUTOMATIC TRANS. ONLY
24 75 USED WITH MAN. TRANS. ONLY
```

Style: ALL CAPS, placed near the affected wires. No box — just text annotation.

### 6.2 Component Labels

- ALL CAPS, sans-serif font (Helvetica/Arial equivalent)
- 7-8pt for component names
- 6pt for wire data
- 5pt for notes and option text
- Component names placed ADJACENT to the symbol, not inside

### 6.3 Title Block

Bottom-right corner of each page:

```
┌─────────────────────────┐
│                         │
│    C K TRUCK            │
│    SECTION 2  PAGE 1    │
│                  15528745│
└─────────────────────────┘
```

For our diagrams:
```
┌─────────────────────────┐
│    NUKE LTD             │
│    77 K5 BLAZER         │
│    SECTION 1  PAGE 1    │
│    LS3 / MOTEC M130     │
└─────────────────────────┘
```

## 7. Section Organization for Motec/LS3 Build

Adapting GM's 14-section structure to our build:

| Section | Title | Content |
|---------|-------|---------|
| 0 | Power Distribution | Battery, PDM30, fusible links, main relay, battery disconnect |
| 1 | Forward Lamps | Headlights, parking, turn signals, markers (PDM-driven) |
| 2 | Engine — LS3 | 8 injectors, 8 coils, crank/cam sensors, MAP, IAT, CLT, TPS, O2, knock |
| 3 | ECU — M130 Pinout | Full M130 connector face view, every pin mapped |
| 4 | PDM30 — Channel Map | All 30 output channels, all inputs, CAN connections |
| 5 | Instrument Panel | C125 dash display, warning lights, switches, gauge senders |
| 6 | HVAC | Blower motor, A/C compressor clutch, A/C pressure switch |
| 7 | Cruise / Drive | Electronic throttle body, cruise inputs, transmission |
| 8 | Lighting — Rear | Tail/stop/turn, license, backup, third brake, cargo |
| 9 | Audio / Accessories | Radio, speakers, USB, cigarette lighter |
| 10 | Body | Power windows, power locks, dome/courtesy lights |
| 11 | CAN Bus Network | M130 ↔ PDM30 ↔ C125 ↔ LTCD backbone |
| 12 | Ground Distribution | All star grounds, chassis ground points, engine grounds |
| 13 | Trailer / Auxiliary | Trailer connector, auxiliary battery, camper harness |

## 8. Differences from Factory GM Format

Our diagrams adopt the GM 1987 grid-address format but with these modifications:

| Feature | GM Factory | Nuke / Motec Build |
|---------|-----------|-------------------|
| Wire coding | Circuit# + mm² + color | Circuit# + AWG + color (AWG for US supply chain) |
| Power distribution | Fuse block (blade fuses) | PDM30 (solid-state, CAN-programmable) |
| ECU representation | Single rectangle with pin list | Detailed connector face view per header (A, B, C) |
| Ground system | Distributed body/frame grounds | Star-ground architecture with defined points |
| CAN bus | Not present (pre-CAN era) | Dedicated section showing twisted-pair backbone |
| Option notes | Engine RPO codes (L19, LO3) | Build-specific (no variants — one vehicle, one harness) |
| Connector part numbers | GM 7-digit | Motec connector housing + Deutsch/Autosport |
| Color scheme | Black ink on white | Black base + colored system overlays for digital version |

## 9. Rendering Specification (SVG)

For programmatic generation:

### 9.1 Canvas Size

| Format | Width | Height | Scale |
|--------|-------|--------|-------|
| Full sheet (print) | 34" (864mm) | 11" (279mm) | 1:1 |
| SVG viewBox | 8640 | 2790 | 10 units/mm |
| Grid cell | 233 x 107 units | — | 37 cols x 26 rows |

### 9.2 Layer Structure (SVG groups)

```xml
<g id="grid">          <!-- Grid lines and labels -->
<g id="zones">          <!-- Engine outline, firewall, zone labels -->
<g id="wires-power">    <!-- Hot circuits (solid lines) -->
<g id="wires-ground">   <!-- Ground circuits (dashed lines) -->
<g id="wires-signal">   <!-- Signal circuits (thin lines) -->
<g id="wires-can">      <!-- CAN bus (twisted pair indicator) -->
<g id="components">     <!-- All component symbols -->
<g id="connectors">     <!-- Connector face views -->
<g id="labels">         <!-- Wire data labels, component names -->
<g id="annotations">    <!-- Option notes, cross-references -->
<g id="titleblock">     <!-- Title block -->
```

### 9.3 Font Specification

| Use | Font | Size | Weight |
|-----|------|------|--------|
| Component names | Courier New / monospace | 8pt | Bold |
| Wire data | Courier New / monospace | 6pt | Regular |
| Zone labels | Arial / sans-serif | 10pt | Bold |
| Notes / options | Arial / sans-serif | 6pt | Regular |
| Title block | Arial / sans-serif | 12pt | Bold |
| Grid labels | Arial / sans-serif | 7pt | Regular |

### 9.4 Stroke Specification

| Element | Width | Color | Dash |
|---------|-------|-------|------|
| Grid lines | 0.25pt | #CCCCCC | solid |
| Zone boundaries | 0.5pt | #666666 | 4,2 dash |
| Hot wire | 0.5pt | #000000 | solid |
| Ground wire | 0.5pt | #000000 | 6,3 dash |
| Heavy wire (battery) | 1.0pt | #000000 | solid |
| Signal wire | 0.35pt | #000000 | solid |
| CAN bus | 0.5pt | #000000 | twisted pair marker every 20mm |
| Component outline | 0.5pt | #000000 | solid |

## 10. Data Pipeline: Compute Engine → Diagram

The existing compute engine (`compute-wiring-overlay`) already produces:

```json
{
  "wires": [
    {
      "circuit_id": "INJ1",
      "from_device": "M130",
      "from_pin": "A1",
      "to_device": "Injector_Cyl1",
      "to_pin": "1",
      "gauge": "18 AWG",
      "color": "LT BLU",
      "length_ft": 8,
      "harness_section": "engine"
    }
  ],
  "ecu_pins": [...],
  "pdm_channels": [...],
  "warnings": [...]
}
```

To render a diagram, the pipeline adds:
1. **Grid placement** — assign each device to a grid cell based on its zone and layer
2. **Wire routing** — Manhattan-route wires between placed devices
3. **Connector generation** — draw face views for each multi-pin connector
4. **Label generation** — format wire data labels per spec
5. **Cross-reference** — generate section/page links for inter-section wires
6. **SVG output** — render all layers to SVG per section

## 11. What We Need to Build

| Component | Status | Source |
|-----------|--------|--------|
| Grid renderer | Not built | This spec |
| Component symbol library (SVG) | Not built | Traced from GM diagrams + Motec-specific |
| Connector face view generator | Not built | From `device_pin_maps` (241 validated pins) |
| Wire router (Manhattan) | Not built | Standard pathfinding algorithm |
| Wire label formatter | Not built | This spec + compute engine data |
| Zone layout engine | Not built | `vehicle_build_manifest` position data |
| Cross-reference linker | Not built | Section/page assignment logic |
| SVG composer | Not built | Combine all layers per section |
| Fuse block / PDM detail generator | Not built | From `pdm_channels` data |
| Print stylesheet | Not built | 11x17" or ANSI D (22x34") output |
