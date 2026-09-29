#!/usr/bin/env python3
"""61-pin firewall adapter plate for the 1977 K5 Blazer (build123d, parametric B-rep CAD).

Owner, 2026-09-29: "the 61 pin connector should be placed at the original fuse box hole with a cnc'd adapter plate".
The plate covers the original fuse-block opening and carries one D38999/24WJ61SN jam-nut receptacle (shell 25).

Every parameter carries its source or says it is not measured. Run:
    ~/.nuke/cad-venv/bin/python docs/wiring/calc-data/cad/fab/fw61_adapter_plate.py docs/wiring/calc-data/cad/fab/fw61_adapter_plate
Writes <out_dir>/fw61_adapter_plate.step, .dxf (cut profile, mm), and _drawing.svg (dimensioned drawing).
"""
import math
import sys
from pathlib import Path

from build123d import (BuildPart, BuildSketch, Circle, Locations, Mode, Rectangle, RectangleRounded, Unit, export_step,
                       extrude, ExportDXF, add)

IN = 25.4

# ---- the connector: MIL-DTL-38999 Series III jam-nut receptacle, shell size 25 (letter J)
# Panel cutout: a round hole with one flat. Milnec TX37 sheet (D38999 Series III jam-nut receptacle, mates D38999/26),
# "Receptacle Dimensions", shell 25 / J: H = 1.760 in (44.7 mm) hole diameter, A = 1.710 in (43.4 mm) flat to far side.
CUT_D = 1.760 * IN
CUT_FLAT = 1.710 * IN
# Same sheet, shell 25 / J: W front = 2.189 in (55.6 mm) across the front (jam-nut) end; K rear = 1.812 in (46.0 mm) flange.
JAM_NUT_W = 2.189 * IN
REAR_FLANGE_K = 1.812 * IN

# ---- the truck: the original fuse-block punch-out. The trait table models it as a 4.0 in round opening
# (nuke_frontend/src/components/wiring/objectTraits.ts, factory_holes FB). Its true shape and size are NOT MEASURED.
FB_OPENING_D = 4.0 * IN            # replace with the tape measurement of the real opening
OVERLAP = 15.0                     # plate edge beyond the opening, mm (design choice: gasket land)

# ---- the plate
THICK = 0.125 * IN                 # 1/8 in 5052-H32 aluminium (design choice; confirm the receptacle's max panel thickness)
CORNER_R = 10.0
SIDE = max(FB_OPENING_D + 2 * OVERLAP, JAM_NUT_W + 2 * 30.0)
SIDE = math.ceil(SIDE / 5.0) * 5.0
HOLE_D = 6.6                       # M6 clearance (ISO 273 medium): fasteners into rivnuts in the firewall (design choice)
HOLE_OFF = SIDE / 2 - 13.0         # 13 mm edge distance
GASKET_T = 1.5                     # neoprene gasket under the plate (design choice)


def d_hole():
    """The keyed cutout: circle of CUT_D with a flat CUT_FLAT from the far side (flat toward +Y, 12 o'clock)."""
    r = CUT_D / 2
    flat_y = CUT_FLAT - r
    with BuildSketch() as s:
        Circle(r)
        with Locations((0, flat_y + r)):
            Rectangle(3 * r, 2 * r, mode=Mode.SUBTRACT)
    return s.sketch


def outline():
    with BuildSketch() as s:
        RectangleRounded(SIDE, SIDE, CORNER_R)
        add(d_hole(), mode=Mode.SUBTRACT)
        with Locations(*[(sx * HOLE_OFF, sy * HOLE_OFF) for sx in (-1, 1) for sy in (-1, 1)]):
            Circle(HOLE_D / 2, mode=Mode.SUBTRACT)
    return s.sketch


def solids():
    with BuildPart() as plate:
        add(outline())
        extrude(amount=THICK)
    with BuildPart() as gasket:
        add(outline())
        extrude(amount=-GASKET_T)
    return plate.part, gasket.part


def drawing_svg(path):
    """A dimensioned front view, mm, drawn from the same parameters (1 SVG unit = 1 mm)."""
    m = 40.0
    W = SIDE + 2 * m + 90
    H = SIDE + 2 * m + 46
    cx, cy = m + SIDE / 2, m + SIDE / 2
    r = CUT_D / 2
    flat_y = CUT_FLAT - r                     # +Y is up in the part, down in SVG
    half_chord = math.sqrt(r * r - flat_y * flat_y)
    ink, dim = "#1a2027", "#2461c7"
    el = []
    el.append(f'<rect x="{m}" y="{m}" width="{SIDE}" height="{SIDE}" rx="{CORNER_R}" fill="#c9cdd2" stroke="{ink}" stroke-width="0.6"/>')
    # D hole: arc from one end of the flat around the bottom to the other end, then the flat
    x1, x2, yf = cx - half_chord, cx + half_chord, cy - flat_y
    el.append(f'<path d="M {x1:.2f} {yf:.2f} A {r:.2f} {r:.2f} 0 1 0 {x2:.2f} {yf:.2f} Z" fill="#ffffff" stroke="{ink}" stroke-width="0.6"/>')
    for sx in (-1, 1):
        for sy in (-1, 1):
            el.append(f'<circle cx="{cx + sx * HOLE_OFF:.2f}" cy="{cy + sy * HOLE_OFF:.2f}" r="{HOLE_D / 2:.2f}" fill="#ffffff" stroke="{ink}" stroke-width="0.6"/>')
    el.append(f'<circle cx="{cx}" cy="{cy}" r="{FB_OPENING_D / 2:.2f}" fill="none" stroke="{ink}" stroke-width="0.4" stroke-dasharray="3 2"/>')
    el.append(f'<circle cx="{cx}" cy="{cy}" r="{JAM_NUT_W / 2:.2f}" fill="none" stroke="#8a939c" stroke-width="0.4" stroke-dasharray="1.5 1.5"/>')

    def dim_h(xa, xb, y, text):
        el.append(f'<line x1="{xa}" y1="{y}" x2="{xb}" y2="{y}" stroke="{dim}" stroke-width="0.35" marker-start="url(#a)" marker-end="url(#a)"/>')
        el.append(f'<text x="{(xa + xb) / 2}" y="{y - 1.6}" font-size="4" text-anchor="middle" fill="{dim}" font-family="Helvetica, Arial">{text}</text>')

    def dim_v(ya, yb, x, text):
        el.append(f'<line x1="{x}" y1="{ya}" x2="{x}" y2="{yb}" stroke="{dim}" stroke-width="0.35" marker-start="url(#a)" marker-end="url(#a)"/>')
        el.append(f'<text x="{x + 2}" y="{(ya + yb) / 2 + 1.4}" font-size="4" fill="{dim}" font-family="Helvetica, Arial">{text}</text>')

    dim_h(m, m + SIDE, m - 12, f"{SIDE:.1f}")
    dim_v(m, m + SIDE, m + SIDE + 12, f"{SIDE:.1f}")
    dim_h(cx - r, cx + r, cy + JAM_NUT_W / 2 + 6, f"Ø{CUT_D:.1f} (1.760 in)")
    el.append(f'<line x1="{cx - r}" y1="{cy}" x2="{cx - r}" y2="{cy + JAM_NUT_W / 2 + 7}" stroke="{dim}" stroke-width="0.2"/>')
    el.append(f'<line x1="{cx + r}" y1="{cy}" x2="{cx + r}" y2="{cy + JAM_NUT_W / 2 + 7}" stroke="{dim}" stroke-width="0.2"/>')
    xd = cx - JAM_NUT_W / 2 - 6
    el.append(f'<line x1="{xd}" y1="{cy + r}" x2="{xd}" y2="{cy - flat_y}" stroke="{dim}" stroke-width="0.35" marker-start="url(#a)" marker-end="url(#a)"/>')
    el.append(f'<line x1="{xd - 1}" y1="{cy - flat_y}" x2="{cx}" y2="{cy - flat_y}" stroke="{dim}" stroke-width="0.2"/>')
    el.append(f'<line x1="{xd - 1}" y1="{cy + r}" x2="{cx}" y2="{cy + r}" stroke="{dim}" stroke-width="0.2"/>')
    el.append(f'<text x="{xd - 2}" y="{cy + 1.4}" font-size="4" text-anchor="end" fill="{dim}" font-family="Helvetica, Arial">{CUT_FLAT:.1f} to flat</text>')
    el.append(f'<text x="{xd - 2}" y="{cy + 6.4}" font-size="3.4" text-anchor="end" fill="{dim}" font-family="Helvetica, Arial">(1.710 in)</text>')
    dim_h(cx - HOLE_OFF, cx + HOLE_OFF, m + SIDE + 10, f"{2 * HOLE_OFF:.1f} hole centres")
    el.append(f'<text x="{cx - HOLE_OFF + 5}" y="{cy - HOLE_OFF - 5}" font-size="3.6" fill="{ink}" font-family="Helvetica, Arial">4 × Ø{HOLE_D} (M6 clearance)</text>')
    el.append(f'<text x="{cx}" y="{cy - FB_OPENING_D / 2 - 2.5}" font-size="3.2" text-anchor="middle" fill="{ink}" font-family="Helvetica, Arial">fuse-box opening (dashed), modelled Ø{FB_OPENING_D:.1f}: NOT MEASURED</text>')
    el.append(f'<text x="{cx}" y="{cy - JAM_NUT_W / 2 - 2}" font-size="3" text-anchor="middle" fill="#6b747d" font-family="Helvetica, Arial">jam nut Ø{JAM_NUT_W:.1f}</text>')
    el.append(f'<text x="{m}" y="{H - 14}" font-size="4.2" fill="{ink}" font-family="Helvetica, Arial" font-weight="bold">61-PIN FIREWALL ADAPTER PLATE · 1977 K5 · 5052-H32 AL {THICK:.2f} mm (1/8 in) · + {GASKET_T} mm neoprene gasket</text>')
    el.append(f'<text x="{m}" y="{H - 8}" font-size="3.4" fill="{ink}" font-family="Helvetica, Arial">Cutout: D38999 Series III jam-nut receptacle, shell 25 (Milnec TX37 sheet). Flat at 12 o\'clock. Units mm.</text>')
    el.append(f'<text x="{m}" y="{H - 3}" font-size="3.4" fill="#b35c00" font-family="Helvetica, Arial">Open before cutting: the real fuse-box opening (shape, size, screw holes) and the receptacle\'s maximum panel thickness.</text>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" width="{W * 4:.0f}" height="{H * 4:.0f}">'
           f'<defs><marker id="a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">'
           f'<path d="M0,0 L6,3 L0,6 z" fill="{dim}"/></marker></defs><rect width="100%" height="100%" fill="#ffffff"/>' + "".join(el) + "</svg>")
    Path(path).write_text(svg)


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    plate, gasket = solids()
    export_step(plate, str(out / "fw61_adapter_plate.step"))
    export_step(gasket, str(out / "fw61_adapter_gasket.step"))
    dxf = ExportDXF(unit=Unit.MM)
    dxf.add_layer("CUT")
    dxf.add_shape(outline().edges(), layer="CUT")
    dxf.write(str(out / "fw61_adapter_plate.dxf"))
    drawing_svg(out / "fw61_adapter_plate_drawing.svg")
    bb = plate.bounding_box()
    print(f"plate {bb.size.X:.1f} x {bb.size.Y:.1f} x {bb.size.Z:.2f} mm, volume {plate.volume / 1000:.1f} cm3, "
          f"mass {plate.volume / 1e3 * 2.68:.0f} g (5052 at 2.68 g/cm3)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
