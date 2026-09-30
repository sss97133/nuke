"""The K5's front sheet metal, first pass: radiator support, firewall (dash and toe panel) and inner fenders (fender
skirts), for the twin and the site (nuke_frontend/public/models/k5-front-sheetmetal.glb).

    ~/.nuke/cad-venv/bin/python docs/wiring/calc-data/cad/fab/chassis_sheetmetal.py [out_dir]

No source on file dimensions these panels' shapes; GM's 1977 manual (Section 2C, Figs 2C-13 to 2C-16) and LMC's
front steel diagram name the parts and show how they bolt together, not their sizes. So this file places them from
what is sourced around them and marks the rest assumed:
  - fore-aft: FR88 Fig 2 engine compartment (dimensions.yaml fr88.body.engcomp.*): the radiator-support points sit
    1098 mm ahead of the cowl points (1102 point to point, with the 1523 / 1715 widths). Put the radiator support's
    front face on the frame's core-support pads (chassis_frame.py, y -2.527) and the cowl points land at y -1.43,
    3 cm behind the twin's firewall station (-1.46).
  - widths: FR88 Fig 2 front and rear point pairs (1523, 1715); the inner-fender walls where FR88 Fig 2 draws them.
  - heights and outline: the twin's own body and parts (TurboSquid fenders, headlights, grille; the harness lane's
    radiator and batteries), so the panels meet what the viewer already shows. Those are design, not sources.
Receipt: docs/wiring/receipts/2026-09-30_frame-3d.md (section "Front sheet metal").
"""
import json
import math
import sys
from pathlib import Path

from build123d import Axis, Box, Cylinder, Face, Pos, Solid, Vector, Wire, extrude

sys.path.insert(0, str(Path(__file__).parent))
from k5cad import Dim, body, write_glb  # noqa: E402
import chassis_frame as CF  # noqa: E402  (the frame's stations, pads and helpers)

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[5] / "nuke_frontend/public/models"
D, DS = CF.D, CF.DS
TWIN = "the twin's current body and parts (k5-blazer.glb TurboSquid body; harness lane's K5H_Radiator, batteries)"

engcomp_fore_aft = math.sqrt(D("fr88.body.engcomp.side.driver") ** 2
                             - ((D("fr88.body.engcomp.rear-width") - D("fr88.body.engcomp.front-width")) / 2) ** 2)
pad_y = CF.Y(CF.val("bm1_s")) / 1000
P = {
    "rs_front_y": Dim(round(pad_y, 4), "chassis_frame.py body_mount_1 core-support pads (s 60, itself assumed +/-40 mm"
                                        " from the owner's photos)", "assumed", "+/-0.040 m"),
    "rs_rear_y": Dim(-2.460, TWIN + ": the radiator core's front face is at y -2.458", "design", "m"),
    "engcomp_fore_aft": Dim(round(engcomp_fore_aft, 1), DS("fr88.body.engcomp.side.driver") + " with "
                            + DS("fr88.body.engcomp.front-width") + " and " + DS("fr88.body.engcomp.rear-width")
                            + ": fore-aft part of the point-to-point side; KLM84 prints 1108", "maker"),
    "rs_points_x": Dim(D("fr88.body.engcomp.front-width") / 2000, DS("fr88.body.engcomp.front-width") + ", /2 (m)"),
    "cowl_points_x": Dim(D("fr88.body.engcomp.rear-width") / 2000, DS("fr88.body.engcomp.rear-width") + ", /2 (m)"),
    "rs_half_width": Dim(0.870, TWIN + ": headlights reach x +/-0.879, grille +/-0.933", "design", "+/-0.02 m"),
    "rs_bottom_z": Dim(0.700, "lower tie bar under the radiator (core bottom z 0.734), on the frame pads (z 0.721)",
                       "assumed", "+/-0.03 m"),
    "rs_top_z": Dim(1.220, TWIN + ": grille top 1.199, fender top line 1.27 at the front", "design", "+/-0.03 m"),
    "rs_opening_half": Dim(0.420, TWIN + ": radiator core x +/-0.381, plus 39 mm", "design", "m"),
    "headlight_x": Dim(0.780, TWIN + ": Headlights mesh x 0.68-0.879 a side", "design", "m"),
    "headlight_z": Dim(1.052, TWIN + ": Headlights mesh z 0.962-1.142", "design", "m"),
    "headlight_d": Dim(0.180, "7 in round sealed beam opening (twin headlight 0.18 m tall)", "design", "m"),
    "firewall_y": Dim(-1.460, "layout builder FIREWALL constant (branch wiring/layout-ui build.py)", "design", "m"),
    "firewall_half_width": Dim(0.760, "the old CTX-firewall-face; the TurboSquid doors' inner skins are at +/-0.717",
                               "assumed", "+/-0.03 m"),
    "cowl_z": Dim(1.270, TWIN + ": hood rear edge 1.32, cowl 1.366 at y -1.5", "design", "+/-0.03 m"),
    "toe_bottom": Dim((-1.220, 0.660), "the old CTX-toe-board's lower edge (y, z)", "assumed", "+/-0.04 m"),
    "toe_top_z": Dim(0.900, "the old CTX-toe-board's upper edge", "assumed", "+/-0.04 m"),
    "tunnel_half_width": Dim(0.250, TWIN + ": 6L90 bell x +/-0.22 plus 30 mm", "design", "m"),
    "tunnel_depth": Dim(0.100, "the dash's centre recess for the bellhousing; the block's rear face (E3_RearCover) is"
                               " at y -1.40, 60 mm behind the firewall station (geometry-scan receipt 2026-09-30)",
                        "assumed", "+/-0.03 m"),
    "tunnel_top_z": Dim(0.980, TWIN + ": 6L90 bell top 0.94 plus 40 mm", "design", "m"),
    "skirt_wall_x_front": Dim(0.510, "FR88 Fig 2 engine compartment: skirt walls drawn from the radiator-support bar"
                                     " (read x 470-520 px against the 1523 pair)", "scaled", "+/-0.03 m"),
    "skirt_wall_x_rear": Dim(0.545, "FR88 Fig 2: skirt walls at the cowl bar (read x 440-490 px against the 1715 pair)",
                             "scaled", "+/-0.03 m"),
    "skirt_outer_x": Dim(0.858, DS("fr88.body.engcomp.rear-width") + ", /2: the fender-top line the skirt bolts under",
                         "maker", "m"),
    "skirt_top_z": Dim(1.000, TWIN + ": both batteries sit at z 1.01 on the skirt tops; the old CTX wall top 1.04",
                       "design", "+/-0.04 m"),
    "skirt_wall_bottom_z": Dim(0.720, "the skirt's engine-side wall runs down past the frame hump (top 0.837)",
                               "assumed", "+/-0.05 m"),
    "arch_clearance": Dim(0.075, "wheelhouse radius over the twin's tyre (r 0.406)", "assumed", "+/-0.03 m"),
    "arch_ends_deg": Dim((15, 165), "arch from 15 deg behind to 165 deg ahead of the axle, per Fig 2C-14's skirt"
                                    " feet at the cab and the radiator support", "assumed", "deg"),
    "t_sheet": Dim(0.003, "panel thickness drawn (real ~1 mm; drawn thicker so the viewer can see it)", "design", "m"),
}


def v(k):
    return P[k].value


def mm(x):
    return x * 1000.0


def box(x0, x1, y0, y1, z0, z1):
    x0, x1, y0, y1, z0, z1 = (mm(a) for a in (x0, x1, y0, y1, z0, z1))
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))


T = v("t_sheet")
bodies = []
SUPPORT, SKIRT, DASH = "#23262a", "#2b2e33", "#3a3d42"


def add(shape, label, hexc):
    bodies.append(body(shape, label, hexc, finish="paint"))


# ---- radiator support (1973-80 type: radiator opening in the middle, headlamp panels at the ends)
yf, yr = v("rs_front_y"), v("rs_rear_y")
hw, zb, zt, oh = v("rs_half_width"), v("rs_bottom_z"), v("rs_top_z"), v("rs_opening_half")
rs = (box(-hw, hw, yf, yr, zt - 0.06, zt) + box(-hw, hw, yf, yr, zb, zb + 0.06)        # upper and lower tie bars
      + box(-oh - 0.05, -oh, yf, yr, zb, zt) + box(oh, oh + 0.05, yf, yr, zb, zt)        # radiator-opening posts
      + box(-hw, -oh - 0.05, yf, yf + T * 2, zb, zt) + box(oh + 0.05, hw, yf, yf + T * 2, zb, zt))  # headlamp panels
for sx in (1, -1):
    rs -= Pos(mm(sx * v("headlight_x")), mm(yf), mm(v("headlight_z"))) * Cylinder(mm(v("headlight_d")) / 2, 200,
                                                                                  rotation=(90, 0, 0))
    rs += box(sx * hw - (0.03 if sx > 0 else -0.03), sx * hw, yf, yr + 0.02, zb, zt)   # the flange the fender bolts to
add(rs, "radiator_support", SUPPORT)

# ---- firewall: dash panel with the bellhousing recess, and the toe board (the cowl skin is the body's)
fy, fw, cz = v("firewall_y"), v("firewall_half_width"), v("cowl_z")
tw, td, tz = v("tunnel_half_width"), v("tunnel_depth"), v("tunnel_top_z")
(ty0, tz0), tzt = v("toe_bottom"), v("toe_top_z")
dash = box(-fw, fw, fy, fy + T, tzt, cz)
dash -= box(-tw, tw, fy - 0.01, fy + 0.01, tzt - 0.01, tz)            # opening for the recess
dash += box(-tw, tw, fy + td, fy + td + T, tzt - 0.3, tz) + box(-tw - T, -tw, fy, fy + td + T, tzt - 0.3, tz) \
    + box(tw, tw + T, fy, fy + td + T, tzt - 0.3, tz) + box(-tw - T, tw + T, fy, fy + td + T, tz - T, tz)
add(dash, "firewall_dash_panel", DASH)
# toe board: a plate sloping from the dash's lower edge down and back to the floor
L = math.hypot(ty0 - fy, tzt - tz0)
ang = math.degrees(math.atan2(tzt - tz0, ty0 - fy))
toe = Pos(0, mm((fy + ty0) / 2), mm((tzt + tz0) / 2)) * Box(mm(2 * fw), mm(L), mm(T)).rotate(Axis.X, -ang)
toe -= box(-tw, tw, fy - 0.05, ty0 + 0.05, tz0 - 0.1, tzt + 0.05)   # the tunnel runs through it
add(toe, "firewall_toe_board", DASH)

# ---- inner fenders (fender skirts): engine-side wall, top, wheelhouse arch
ax_y, ax_z = CF.FA_Y, 0.396                   # the twin's front axle centre (wheel empties at z 0.388-0.396)
R = 0.406 + v("arch_clearance")
a0, a1 = v("arch_ends_deg")
xo, top, wb = v("skirt_outer_x"), v("skirt_top_z"), v("skirt_wall_bottom_z")
for sx, sfx in ((1, "L"), (-1, "R")):
    def wall_x(y):
        u = (y - yf) / (fy - yf)
        return v("skirt_wall_x_front") + (v("skirt_wall_x_rear") - v("skirt_wall_x_front")) * u
    # wall: a quad plate, its inner face following the FR88 taper
    pts = [(wall_x(yr), yr, wb), (wall_x(fy), fy, wb), (wall_x(fy), fy, top), (wall_x(yr), yr, top)]
    w = Wire.make_polygon([Vector(sx * mm(x), mm(y), mm(z)) for x, y, z in pts], close=True)
    wall = extrude(Face(w), amount=mm(T), dir=(sx, 0, 0))
    add(wall, f"inner_fender_wall_{sfx}", SKIRT)
    shelf = Solid.make_loft([
        Wire.make_polygon([Vector(sx * mm(wall_x(y)), mm(y), mm(top - T)), Vector(sx * mm(xo), mm(y), mm(top - T)),
                           Vector(sx * mm(xo), mm(y), mm(top)), Vector(sx * mm(wall_x(y)), mm(y), mm(top))], close=True)
        for y in (yr, fy)], ruled=True)
    add(shelf, f"inner_fender_top_{sfx}", SKIRT)
    # wheelhouse: an annular sector around the axle, spanning the wall to the fender line
    arc = []
    n = 24
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        arc.append((ax_y + R * math.cos(a), ax_z + R * math.sin(a)))
    inner = [(ax_y + (R + T) * math.cos(math.radians(a1 - (a1 - a0) * i / n)),
              ax_z + (R + T) * math.sin(math.radians(a1 - (a1 - a0) * i / n))) for i in range(n + 1)]
    ring = [(y, z) for y, z in arc] + inner
    x0 = wall_x(ax_y)
    prof = Wire.make_polygon([Vector(sx * mm(x0), mm(y), mm(z)) for y, z in ring], close=True)
    arch = extrude(Face(prof), amount=mm(xo - x0), dir=(sx, 0, 0))
    add(arch, f"inner_fender_wheelhouse_{sfx}", SKIRT)

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    glb = OUT / "k5-front-sheetmetal.glb"
    write_glb(bodies, glb, linear=0.8, angular=0.3)
    size = CF.strip_and_scan(glb)
    assert size < 10_000_000, size
    table = [{"name": k, "value": d.value, "source": d.source, "basis": d.basis, **({"note": d.note} if d.note else {})}
             for k, d in P.items()]
    meta = {"file": glb.name, "axes": "twin metres: +x driver, -y forward, +z up; glTF (X,Y,Z) = (x, z, -y)",
            "nodes": [b.label for b in bodies], "params": table,
            "cowl_points_y_by_fr88": round(yf + engcomp_fore_aft / 1000, 4),
            "replaces": ["CTX-core-support-face", "CTX-firewall-face", "CTX-toe-board", "CTX-inner-fender-wall-driver",
                         "CTX-inner-fender-wall-passenger"]}
    Path(__file__).with_suffix(".params.json").write_text(json.dumps(meta, indent=1))
    print("wrote", glb, size, "bytes,", len(bodies), "nodes; FR88 cowl points land at y", meta["cowl_points_y_by_fr88"])
