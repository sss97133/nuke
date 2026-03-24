# Chapter 13: The Professional Canvas

## Vision

The workspace is where the harness gets designed visually. Not a schematic editor — those exist (AutoCAD Electrical, RapidHarness). This is a vehicle-centric canvas where you place devices on the truck and see wires appear.

## Base Layers

The canvas renders in layers, bottom to top:

1. **Vehicle outline** — orthographic side view of 1973-87 C/K series. Source: GM Service Manual Section 8C wiring route diagrams (29 pages, OCR'd text available, images not yet extracted from PDF)
2. **Zone grid** — engine bay, firewall, dash, doors (L/R), rear body, underbody. Each zone has a coordinate system for device placement
3. **Factory harness** — 71 circuits as faded gray wires. Shows where GM ran wires. This is the archaeological layer — what was there before the build
4. **Upgrade overlay** — new circuits in color. Every wire from the compute engine renders here. Color by function group (green=injectors, white=ignition, etc.)
5. **Component markers** — device icons at their placed positions. Click to see pin assignments, part numbers, prices

## Current State

The canvas is conceptual. What exists:
- Route `/vehicle/:id/wiring/sandbox` registered in frontend routes
- `WorkspaceContent.tsx` has the wiring tab framework
- Compute engine provides all the data (wires, pins, channels)
- Output documents (cut list, connector schedule, BOM) provide printable views

What doesn't exist yet:
- SVG/Canvas rendering engine for wire routing
- Device icon library (ECU, PDM, sensor symbols)
- Drag-and-drop device placement
- Interactive wire selection (click a wire to see both endpoints)
- Zone distance editor (adjust estimated wire lengths for actual measurements)

## Architecture

The canvas would consume `compute-wiring-overlay` output and render it:

```
compute-wiring-overlay → { wires, ecu_pins, pdm_channels, warnings }
                              ↓
                        Canvas renderer
                              ↓
                  SVG with positioned devices + wire paths
```

Wire paths would follow a simplified routing model:
- Device A position → nearest harness trunk → harness trunk → nearest point to Device B → Device B position
- No manual wire routing — paths are auto-derived from zone positions
- Harness trunk follows the vehicle's main routing channels (along frame rails, through firewall, across dash)

## Why It Matters

The canvas is the visual layer that makes the compute engine accessible to non-engineers. Desert Performance doesn't want a JSON document — they want to see where the wires go. The client doesn't want a database — they want to see their truck with colored wires overlaid on the chassis.

The professional canvas is what turns the wiring layer from a data system into a design tool.
