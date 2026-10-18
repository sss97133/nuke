#!/usr/bin/env python3
"""61-pin firewall adapter plate for the 1977 K5 Blazer (build123d, parametric B-rep CAD).

Owner, 2026-09-29: "the 61 pin connector should be placed at the original fuse box hole with a cnc'd adapter plate".
The plate covers the original fuse-block opening and carries one D38999/24WJ61SN jam-nut receptacle (shell 25).

Every parameter carries its source or says it is not measured. Run:
    ~/.nuke/cad-venv/bin/python docs/wiring/calc-data/cad/fab/fw61_adapter_plate.py docs/wiring/calc-data/cad/fab/fw61_adapter_plate
Writes <out_dir>/fw61_adapter_plate.step, _gasket.step, .dxf (cut profile, mm), and _drawing.svg (dimensioned drawing).

The outputs are tracked (the fabricator's deliverable), so each carries a stamp: the first 12 hex characters of this
script's git blob hash and its input parameters (STEP: the header's FILE_DESCRIPTION; DXF: 999 comments; SVG:
<metadata>). `--check [out_dir]` fails when a tracked output's stamp does not match this script and its parameters;
index_v5.py runs the same check.
"""
import hashlib
import math
import re
import sys
from pathlib import Path

from build123d import (BuildPart, BuildSketch, Circle, Locations, Mode, Plane, Polygon, Rectangle, RectangleRounded, Unit,
                       export_step, extrude, ExportDXF, add, fillet, offset)

IN = 25.4

# ---- the connector: MIL-DTL-38999 Series III jam-nut receptacle, shell size 25 (letter J)
# Panel cutout: a round hole with one flat. MILNEC D38999 Series III catalog p.B-25 (PDF p.45), TX07 = D38999/24 jam-nut
# receptacle (mates D38999/26), "Receptacle Dimensions", shell 25 / J: H = 1.760 in (44.7 mm) hole diameter, A = 1.710 in
# (43.4 mm) flat to far side. (Batch 1 of this script cited it as the "TX37" sheet; the page is TX07.)
CUT_D = 1.760 * IN
CUT_FLAT = 1.710 * IN
# Same page, shell 25 / J, as read off its front view (the page labels the letters, not the features): W = 2.188 in ±.016
# (55.6) the flange; D = 2.323 in (59.0) and J = 2.017 in max (51.2) the jam nut across its corners and flats (J / cos 30°
# is D); K = 1.759 in (44.7). (Batch 1 of this script called W the jam nut and gave K as 1.812 in, which is not this
# page's number.)
FLANGE_W = 2.188 * IN
K_DIM = 1.759 * IN
# Same page: "P Max Rear Panel" .125 (3.2) for every shell size; "Max panel thickness will ensure proper coupling clearance".
PANEL_MAX = 0.125 * IN
JAM_NUT_D = 2.323 * IN            # across the corners (see above)
# MILNEC catalog p.B-15 (PDF p.35), "Accessory & Jam Nut Torque", shell 25, aluminium and stainless steel: jam nut
# torque 120 min, 130 max in-lb (13.6, 14.7 N-m).
JAM_NUT_TORQUE = "120-130 in-lb (13.6-14.7 N-m), MILNEC p.B-15, shell 25 aluminium"

# ---- the truck: the original fuse-block punch-out. The trait table models it as a 4.0 in round opening
# (nuke_frontend/src/components/wiring/objectTraits.ts, factory_holes FB), which cites no source. No document reached on
# 2026-09-29 prints the opening's shape or size (receipt 2026-09-29_fw61-plate-stamp lists what was tried). What is sourced:
# it is the stock bulkhead-connector hole on the driver side, and the fuse panel fastens to the firewall with two screws
# through two stock holes (American Autowire 510351 instructions rev 1.0, sheet 1: "Locate the stock OEM bulkhead
# connector hole in the driver side of the firewall", "Using the two mounting screws A ... attach the fuse panel to the
# firewall"; the holes' positions are not printed).
# The SHAPE is from the same sheet's illustration, read by the lead at 300 dpi (2026-09-29): a trapezoid whose parallel
# sides are vertical, with rounded corners, seen from the cab. The right side is the tall one (left : right = 0.73), the
# width is 0.92 x the right side, the top and bottom edges slant symmetrically, the corner radius is 0.08 x the right
# side. The two "A" screw holes sit on a diagonal: A1 about 12/212 of the right side right of the right edge and 28/212
# above the top-right corner; A2 about 17/212 left of the left edge and 30/212 below the bottom-left corner; each drawn
# about 1/15 of the right side across. The sheet is an illustration, possibly in perspective: shape only.
# The SIZE is NOT SOURCED: the right side is drawn at the trait table's 4.0 in (ASSUMED) until a block-off plate's
# cutout, the fuse block's screw spacing or a scaled truck photo gives one real dimension; the rest follows the ratios.
FB_SHAPE = "shape from AAW 510351 sheet 1 illustration; size NOT SOURCED"
FB_H_RIGHT = 4.0 * IN              # ASSUMED (the scale); everything below is this times the illustration's ratios
FB_H_LEFT = 0.73 * FB_H_RIGHT
FB_W = 0.92 * FB_H_RIGHT
FB_R = 0.08 * FB_H_RIGHT
FB_A1 = (FB_W / 2 + 12 / 212 * FB_H_RIGHT, FB_H_RIGHT / 2 + 28 / 212 * FB_H_RIGHT)
FB_A2 = (-FB_W / 2 - 17 / 212 * FB_H_RIGHT, -FB_H_LEFT / 2 - 30 / 212 * FB_H_RIGHT)
FB_A_D = FB_H_RIGHT / 15
FB_BASIS = f"NOT SOURCED: {FB_SHAPE}, right side {FB_H_RIGHT:.1f} ASSUMED"
FB_FASTENERS = "two screws in two stock holes (AAW 510351 rev 1.0 sheet 1), positions not printed"
OVERLAP = 15.0                     # plate edge beyond the opening, mm (design choice: gasket land)

# ---- the plate
THICK = 0.125 * IN                 # 1/8 in 5052-H32 aluminium (design choice; confirm the receptacle's max panel thickness)
CORNER_R = 10.0
SIDE = max(max(FB_W, FB_H_RIGHT) + 2 * OVERLAP, FLANGE_W + 2 * 30.0)
SIDE = math.ceil(SIDE / 5.0) * 5.0
HOLE_D = 6.6                       # M6 clearance (ISO 273 medium): fasteners into rivnuts in the firewall (design choice)
HOLE_OFF = SIDE / 2 - 13.0         # 13 mm edge distance
GASKET_T = 1.5                     # neoprene gasket under the plate (design choice)
# The gasket is a perimeter ring: its outer edge is the plate's outline, its inner edge the firewall opening plus
# GASKET_INSET all round, so the receptacle clamps bare aluminium only (the system's call, 2026-09-29, pieces lane).
GASKET_INSET = 3.0
# The 1/8 in plate is exactly at PANEL_MAX (the page's inch value; its 3.2 mm is rounded). The plate stays 1/8 in for
# stiffness at the fasteners, and the receptacle land is spot-faced on the jam-nut face to SPOTFACE_T over SPOTFACE_D
# (the jam nut is JAM_NUT_D): the clamped thickness is then under the maximum, with margin for sheet tolerance and coating
# (the system's call, 2026-09-29). The jam-nut face is drawn as +Z, the face away from the gasket: the plate on the
# firewall's cab face, the receptacle's flange toward the engine bay through the opening, the jam nut in the cab.
SPOTFACE_T = 0.110 * IN
SPOTFACE_D = 62.0
CLAMP_MARGIN_MIN = 0.25            # --check: the clamped thickness is at most PANEL_MAX - this
CLAMPED = SPOTFACE_T
PANEL_MARGIN = PANEL_MAX - CLAMPED

SCRIPT = Path(__file__).resolve()


def blob12(path=SCRIPT):
    """The first 12 hex characters of the file's git blob hash (what `git hash-object` prints)."""
    data = Path(path).read_bytes()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()[:12]


def params():
    """The inputs the outputs depend on, in a fixed order (mm)."""
    return (f"FB_OPENING={FB_BASIS}; FB_H_RIGHT={FB_H_RIGHT:.3f}; FB_H_LEFT={FB_H_LEFT:.3f}; FB_W={FB_W:.3f}; "
            f"FB_R={FB_R:.3f}; FB_A1=({FB_A1[0]:.2f}, {FB_A1[1]:.2f}); FB_A2=({FB_A2[0]:.2f}, {FB_A2[1]:.2f}); "
            f"FB_FASTENERS={FB_FASTENERS}; JAM_NUT_TORQUE={JAM_NUT_TORQUE}; THICK={THICK:.3f}; "
            f"PANEL_MAX={PANEL_MAX:.3f}; SPOTFACE_T={SPOTFACE_T:.3f}; SPOTFACE_D={SPOTFACE_D:.3f}; "
            f"GASKET_T={GASKET_T:.3f}; GASKET_INSET={GASKET_INSET:.3f}; SIDE={SIDE:.3f}; CORNER_R={CORNER_R:.3f}; "
            f"HOLE_D={HOLE_D:.3f}; HOLE_OFF={HOLE_OFF:.3f}; CUT_D={CUT_D:.3f}; CUT_FLAT={CUT_FLAT:.3f}")


def stamp():
    return f"generator fw61_adapter_plate.py blob {blob12()}; {params()}"


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


def fb_opening(grow=0.0):
    """The firewall opening (the illustration's rounded trapezoid, centred on its bounding box), grown by `grow`."""
    pts = [(-FB_W / 2, -FB_H_LEFT / 2), (FB_W / 2, -FB_H_RIGHT / 2), (FB_W / 2, FB_H_RIGHT / 2), (-FB_W / 2, FB_H_LEFT / 2)]
    with BuildSketch() as s:
        Polygon(*pts, align=None)
        fillet(s.vertices(), radius=FB_R)
        if grow:
            offset(amount=grow)
    return s.sketch


def outline_points(sketch, n=16):
    """The sketch's outer outline as points, in order (for the drawing and the clearance checks)."""
    w = sketch.faces()[0].outer_wire()
    out = []
    for e in w.order_edges():
        out += [tuple(e.position_at(i / n))[:2] for i in range(n)]
    return out


def min_radius(sketch):
    import math as _m
    return min(_m.hypot(x, y) for x, y in outline_points(sketch, 40))


def gasket_outline():
    """The perimeter ring: the plate's outline and fastener holes, open inside the opening grown by GASKET_INSET."""
    with BuildSketch() as s:
        RectangleRounded(SIDE, SIDE, CORNER_R)
        add(fb_opening(GASKET_INSET), mode=Mode.SUBTRACT)
        with Locations(*[(sx * HOLE_OFF, sy * HOLE_OFF) for sx in (-1, 1) for sy in (-1, 1)]):
            Circle(HOLE_D / 2, mode=Mode.SUBTRACT)
    return s.sketch


def solids():
    with BuildPart() as plate:
        add(outline())
        extrude(amount=THICK)
        with BuildSketch(Plane.XY.offset(THICK)):
            Circle(SPOTFACE_D / 2)
        extrude(amount=-(THICK - SPOTFACE_T), mode=Mode.SUBTRACT)
    with BuildPart() as gasket:
        add(gasket_outline())
        extrude(amount=-GASKET_T)
    return plate.part, gasket.part


def design_errors():
    """The limits the plate must meet, whatever its outputs say."""
    errs = []
    if CLAMPED > PANEL_MAX - CLAMP_MARGIN_MIN:
        errs.append(f"fw61: clamped thickness {CLAMPED:.3f} is over PANEL_MAX {PANEL_MAX:.3f} - {CLAMP_MARGIN_MIN} "
                    "(MILNEC TX07 p.B-25)")
    if SPOTFACE_D <= JAM_NUT_D:
        errs.append(f"fw61: spot face {SPOTFACE_D} does not clear the jam nut {JAM_NUT_D:.1f}")
    if SPOTFACE_D / 2 >= min_radius(fb_opening(GASKET_INSET)):
        errs.append("fw61: the spot face reaches the gasket ring")
    if max(FLANGE_W, JAM_NUT_D) / 2 >= min_radius(fb_opening()):
        errs.append("fw61: the receptacle's flange or jam nut does not clear the opening")
    if not THICK > SPOTFACE_T > 0:
        errs.append("fw61: the spot face must leave material")
    return errs


def drawing_svg(path):
    """A dimensioned front view, mm, drawn from the same parameters (1 SVG unit = 1 mm)."""
    m = 40.0
    W = SIDE + 2 * m + 90
    H = SIDE + 2 * m + 64
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
    def poly(sk, colour, dash, w=0.4):
        pts = outline_points(sk)
        d = " ".join(f"{'M' if i == 0 else 'L'} {cx + x:.2f} {cy - y:.2f}" for i, (x, y) in enumerate(pts)) + " Z"
        el.append(f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="{w}" stroke-dasharray="{dash}"/>')
    poly(fb_opening(), ink, "3 2")
    for (ax, ay), nm in ((FB_A1, "A1"), (FB_A2, "A2")):
        el.append(f'<circle cx="{cx + ax:.2f}" cy="{cy - ay:.2f}" r="{FB_A_D / 2:.2f}" fill="none" stroke="#b35c00" stroke-width="0.4" stroke-dasharray="1 1"/>')
        el.append(f'<text x="{cx + ax + (4 if ax > 0 else -4):.2f}" y="{cy - ay + 1.2:.2f}" font-size="3" text-anchor="{"start" if ax > 0 else "end"}" fill="#b35c00" font-family="Helvetica, Arial">stock screw hole {nm} (illustration)</text>')
    el.append(f'<circle cx="{cx}" cy="{cy}" r="{FLANGE_W / 2:.2f}" fill="none" stroke="#8a939c" stroke-width="0.4" stroke-dasharray="1.5 1.5"/>')
    el.append(f'<circle cx="{cx}" cy="{cy}" r="{SPOTFACE_D / 2:.2f}" fill="none" stroke="#7a3db8" stroke-width="0.45" stroke-dasharray="4 1 1 1"/>')
    poly(fb_opening(GASKET_INSET), "#2e7d32", "0.8 1.2")
    el.append(f'<text x="{cx}" y="{cy - SPOTFACE_D / 2 - 2.0:.2f}" font-size="3" text-anchor="middle" fill="#7a3db8" font-family="Helvetica, Arial">spot face Ø{SPOTFACE_D:.0f} to {SPOTFACE_T:.2f} ({SPOTFACE_T / IN:.3f} in), jam-nut face; jam nut {JAM_NUT_D:.1f} across corners (D)</text>')
    el.append(f'<text x="{cx}" y="{cy + FB_H_RIGHT / 2 + GASKET_INSET + 4.0:.2f}" font-size="3" text-anchor="middle" fill="#2e7d32" font-family="Helvetica, Arial">gasket ring inner edge: the opening + {GASKET_INSET:.0f}</text>')

    def dim_h(xa, xb, y, text):
        el.append(f'<line x1="{xa}" y1="{y}" x2="{xb}" y2="{y}" stroke="{dim}" stroke-width="0.35" marker-start="url(#a)" marker-end="url(#a)"/>')
        el.append(f'<text x="{(xa + xb) / 2}" y="{y - 1.6}" font-size="4" text-anchor="middle" fill="{dim}" font-family="Helvetica, Arial">{text}</text>')

    def dim_v(ya, yb, x, text):
        el.append(f'<line x1="{x}" y1="{ya}" x2="{x}" y2="{yb}" stroke="{dim}" stroke-width="0.35" marker-start="url(#a)" marker-end="url(#a)"/>')
        el.append(f'<text x="{x + 2}" y="{(ya + yb) / 2 + 1.4}" font-size="4" fill="{dim}" font-family="Helvetica, Arial">{text}</text>')

    dim_h(m, m + SIDE, m - 12, f"{SIDE:.1f}")
    dim_v(m, m + SIDE, m + SIDE + 12, f"{SIDE:.1f}")
    dim_h(cx - r, cx + r, cy + SPOTFACE_D / 2 + 5, f"Ø{CUT_D:.1f} (1.760 in)")
    el.append(f'<line x1="{cx - r}" y1="{cy}" x2="{cx - r}" y2="{cy + SPOTFACE_D / 2 + 6}" stroke="{dim}" stroke-width="0.2"/>')
    el.append(f'<line x1="{cx + r}" y1="{cy}" x2="{cx + r}" y2="{cy + SPOTFACE_D / 2 + 6}" stroke="{dim}" stroke-width="0.2"/>')
    xd = cx - SPOTFACE_D / 2 - 5
    el.append(f'<line x1="{xd}" y1="{cy + r}" x2="{xd}" y2="{cy - flat_y}" stroke="{dim}" stroke-width="0.35" marker-start="url(#a)" marker-end="url(#a)"/>')
    el.append(f'<line x1="{xd - 1}" y1="{cy - flat_y}" x2="{cx}" y2="{cy - flat_y}" stroke="{dim}" stroke-width="0.2"/>')
    el.append(f'<line x1="{xd - 1}" y1="{cy + r}" x2="{cx}" y2="{cy + r}" stroke="{dim}" stroke-width="0.2"/>')
    el.append(f'<text x="{xd - 2}" y="{cy + 1.4}" font-size="4" text-anchor="end" fill="{dim}" font-family="Helvetica, Arial">{CUT_FLAT:.1f} to flat</text>')
    el.append(f'<text x="{xd - 2}" y="{cy + 6.4}" font-size="3.4" text-anchor="end" fill="{dim}" font-family="Helvetica, Arial">(1.710 in)</text>')
    dim_h(cx - HOLE_OFF, cx + HOLE_OFF, m + SIDE + 10, f"{2 * HOLE_OFF:.1f} hole centres")
    el.append(f'<text x="{cx - HOLE_OFF + 5}" y="{cy - HOLE_OFF - 5}" font-size="3.6" fill="{ink}" font-family="Helvetica, Arial">4 × Ø{HOLE_D} (M6 clearance)</text>')
    el.append(f'<text x="{cx}" y="{cy - FB_H_LEFT / 2 + 1.0:.2f}" font-size="3.0" text-anchor="middle" fill="{ink}" font-family="Helvetica, Arial">fuse-box opening (dashed): {FB_SHAPE}</text>')
    el.append(f'<text x="{cx}" y="{cy - FLANGE_W / 2 + 4}" font-size="3" text-anchor="middle" fill="#6b747d" font-family="Helvetica, Arial">flange Ø{FLANGE_W:.1f} (W)</text>')
    notes = [(4.2, ink, "bold", f"61-PIN FIREWALL ADAPTER PLATE · 1977 K5 · 5052-H32 AL {THICK:.2f} mm (1/8 in) · + {GASKET_T} mm neoprene gasket ring"),
             (3.4, ink, "normal", "Cutout: D38999 Series III jam-nut receptacle, shell 25 (MILNEC TX07 p.B-25). Flat at 12 o'clock. Units mm."),
             (3.4, ink, "normal", f"Jam nut torque: {JAM_NUT_TORQUE}."),
             (3.4, "#7a3db8", "normal", f"Spot face Ø{SPOTFACE_D:.0f} to {SPOTFACE_T:.2f} on the jam-nut face (drawn: the face away from the gasket): "
                                       f"clamped thickness under TX07 p.B-25's .125 max, with margin for sheet tolerance ({PANEL_MARGIN:.2f})."),
             (3.4, "#2e7d32", "normal", f"Gasket: a perimeter ring, outer edge the plate outline, inner edge the opening + {GASKET_INSET:.0f}; "
                                        "the receptacle clamps bare aluminium only."),
             (3.4, "#b35c00", "normal", f"Opening: {FB_BASIS}; the rest follows the illustration's ratios."),
             (3.4, "#b35c00", "normal", f"Fastening: {FB_FASTENERS}; A1 and A2 drawn where the illustration puts them."),
             (3.4, "#b35c00", "normal", "Open before cutting: the real fuse-box opening (shape, size) and its two stock screw holes.")]
    for i, (fs, col, fw, txt) in enumerate(notes):
        y = H - 3 - 5.6 * (len(notes) - 1 - i) - (1.5 if i == 0 else 0)
        txt = txt.replace("&", "&amp;").replace("<", "&lt;")
        el.append(f'<text x="{m}" y="{y:.1f}" font-size="{fs}" fill="{col}" font-family="Helvetica, Arial" font-weight="{fw}">{txt}</text>')
    meta = stamp().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" width="{W * 4:.0f}" height="{H * 4:.0f}">'
           f'<metadata>{meta}</metadata><defs><marker id="a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">'
           f'<path d="M0,0 L6,3 L0,6 z" fill="{dim}"/></marker></defs><rect width="100%" height="100%" fill="#ffffff"/>' + "".join(el) + "</svg>")
    Path(path).write_text(svg)


def _step_quote(t):
    return "'" + t.replace("'", "''") + "'"


def stamp_step(path):
    """Put the stamp in the STEP header's FILE_DESCRIPTION (one string per '; '-separated field)."""
    t = Path(path).read_text()
    parts = ", ".join(_step_quote(x) for x in stamp().split("; "))
    t2, n = re.subn(r"FILE_DESCRIPTION\(\(.*?\),'2;1'\);", lambda _m: f"FILE_DESCRIPTION(({parts}),'2;1');", t,
                    count=1, flags=re.S)
    assert n == 1, "no FILE_DESCRIPTION in " + str(path)
    Path(path).write_text(t2)


def stamp_dxf(path):
    """999 comment groups at the top of the DXF, one per stamp field."""
    t = Path(path).read_text()
    head = "".join(f"999\n{x}\n" for x in stamp().split("; "))
    Path(path).write_text(head + t)


OUTPUTS = ("fw61_adapter_plate.step", "fw61_adapter_gasket.step", "fw61_adapter_plate.dxf", "fw61_adapter_plate_drawing.svg")


def read_stamp(path):
    t = Path(path).read_text(errors="replace")
    if path.suffix == ".step":
        m = re.search(r"FILE_DESCRIPTION\(\((.*?)\),'2;1'\);", t, re.S)
        return "; ".join(x.replace("''", "'") for x in re.findall(r"'((?:[^']|'')*)'", m.group(1))) if m else None
    if path.suffix == ".dxf":
        lines = t.split("\n")
        vals = [lines[i + 1] for i in range(0, len(lines) - 1, 2) if lines[i].strip() == "999"]
        return "; ".join(vals) if vals else None
    m = re.search(r"<metadata>(.*?)</metadata>", t, re.S)
    return m.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&") if m else None


def check_outputs(out=None):
    """Errors for every tracked output whose stamp does not match this script's blob hash and parameters."""
    out = Path(out) if out else SCRIPT.parent / "fw61_adapter_plate"
    want = stamp()
    errors = design_errors()
    for name in OUTPUTS:
        f = out / name
        if not f.exists():
            errors.append(f"fw61: {name} missing")
            continue
        got = read_stamp(f)
        if got != want:
            errors.append(f"fw61: {name} is stale (stamp {'missing' if got is None else got.split(';')[0]!r}, "
                          f"script is {want.split(';')[0]!r}); rerun fw61_adapter_plate.py")
    return errors


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    plate, gasket = solids()
    export_step(plate, str(out / "fw61_adapter_plate.step"))
    export_step(gasket, str(out / "fw61_adapter_gasket.step"))
    stamp_step(out / "fw61_adapter_plate.step")
    stamp_step(out / "fw61_adapter_gasket.step")
    dxf = ExportDXF(unit=Unit.MM)
    dxf.add_layer("CUT")
    dxf.add_shape(outline().edges(), layer="CUT")
    dxf.add_layer(f"SPOTFACE_TO_{SPOTFACE_T:.2f}MM".replace(".", "P"))
    with BuildSketch() as sf:
        Circle(SPOTFACE_D / 2)
    dxf.add_shape(sf.sketch.edges(), layer=f"SPOTFACE_TO_{SPOTFACE_T:.2f}MM".replace(".", "P"))
    dxf.add_layer("GASKET_RING")
    dxf.add_shape(gasket_outline().edges(), layer="GASKET_RING")
    dxf.write(str(out / "fw61_adapter_plate.dxf"))
    stamp_dxf(out / "fw61_adapter_plate.dxf")
    drawing_svg(out / "fw61_adapter_plate_drawing.svg")
    bad = design_errors() + check_outputs(out)
    if bad:
        sys.exit("\n".join(bad))
    print(f"stamped: {stamp()[:80]}...")
    print(f"receptacle max panel {PANEL_MAX:.3f} mm (MILNEC TX07 p.B-25); plate {THICK:.3f} mm, spot-faced to {CLAMPED:.3f} "
          f"over Ø{SPOTFACE_D:.0f}; margin {PANEL_MARGIN:.3f} mm; opening {FB_W:.1f} wide, {FB_H_LEFT:.1f} / {FB_H_RIGHT:.1f} "
          f"tall (ASSUMED scale), min radius {min_radius(fb_opening()):.1f}")
    bb = plate.bounding_box()
    print(f"plate {bb.size.X:.1f} x {bb.size.Y:.1f} x {bb.size.Z:.2f} mm, volume {plate.volume / 1000:.1f} cm3, "
          f"mass {plate.volume / 1e3 * 2.68:.0f} g (5052 at 2.68 g/cm3)")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        errs = check_outputs(sys.argv[2] if len(sys.argv) > 2 else None)
        print("\n".join(errs) if errs else "fw61 outputs match the script")
        sys.exit(1 if errs else 0)
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
