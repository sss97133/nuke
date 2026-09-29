"""The MoTeC small Tyco-connector case (M130 ECU, PDM15, PDM30): one parametric model, three parts.

MoTeC draws the same case for all three: 107.5 x 127.5 x 38.7 mm, R5.5 corners, three 5.2 mm holes, the 18-degree
drafted connector housing and two TE Superseal 1.0 headers (34-way A, 26-way B) over a 67.5 mm span
(M130 datasheet p.3; M1 ECU Hardware p.42; PDM user manual p.47 "PDM15 and PDM30"). The PDMs add the M6 battery stud
on the flat case front. Each part script passes its own dimension table (with its own document's pages) and colours;
this module builds the solids, the checks, the drawing and the audit record from them.

Frame (mm): origin at the centre of the flat back (the mounting face). +X right and +Y up in MoTeC's front view; +Z
out of the back face toward the viewer of that view. The plugs face -Y.
"""
import json
import math
import re
from pathlib import Path

from build123d import Align, Axis, Box, Compound, Cylinder, Plane, Polygon, Pos, RectangleRounded, extrude, fillet

import k5cad as K
import superseal as SS


CALC = Path(__file__).resolve().parents[2]          # docs/wiring/calc-data
TE_NUM = (f"{SS.TE} sheet 1 (34-way) and sheet 2 (26-way), the numbered view placed right of the side view: third-angle "
          "(the sheet's projection symbol), so it is the wire side. Rows 1-9 / 10-17 / 18-25 / 26-34 (26-way: 1-7 / 8-13 / "
          "14-19 / 20-26), cavity 1 top-left with the polarity-marked lock on top")


def _near(a, b, tol=0.05):
    return abs(a - b) < tol


def cavity_layout(ways, pitch=3.0, gap_outer=3.5, gap_inner=4.0):
    """TE Superseal 1.0 cavity numbering, as TE draws it from the wire side with the polarity-marked lock on top:
    row 1 left to right, then rows 2, 3, 4. Returns [(n, row, dx, dz)] with dx along the rows (left to right in that
    view) and dz toward the polarity-marked lock."""
    outer = 9 if ways == 34 else 7
    zo = gap_inner / 2 + gap_outer
    zi = gap_inner / 2
    out, n = [], 1
    for row, (dz, count) in enumerate(((zo, outer), (zi, outer - 1), (-zi, outer - 1), (-zo, outer))):
        for i in range(count):
            out.append((n, row + 1, (i - (count - 1) / 2) * pitch, dz))
            n += 1
    return out


def _glb(p):
    """Part frame (mm, Z up) -> the GLB's own frame (metres, glTF Y up: x, z, -y)."""
    x, y, z = p
    return [round(x / 1000, 5), round(z / 1000, 5), round(-y / 1000, 5)]


def _glb_dir(d):
    x, y, z = d
    return [x, z, -y]


class M1Unit:
    """spec keys: pid, endpoints {A, B, stud?}, name, pn, what, P (dims), colors, photo, refs (drawing legend),
    printed (numbers the checks hold the solids to), stud (bool), notes, unknowns, cross_checks, keepout_src."""

    def __init__(self, spec):
        self.s = spec
        P = self.P = spec["P"]
        g = lambda k: K.v(P[k])  # noqa: E731
        self.g = g
        self.W, self.H, self.D, self.T = g("case_w"), g("case_h"), g("depth"), g("plate_t")
        self.Y0 = -self.H / 2
        self.T18 = math.tan(math.radians(g("draft_deg")))
        self.HDR_D = g("hdr_depth")
        self.HDR_Z = g("hdr_back") + self.HDR_D / 2 if "hdr_back" in P else g("hdr_z")
        self.HDR_FACE = self.Y0 - g("hdr_proud")
        self.A_X0 = -g("hdr_span") / 2
        self.A_X1 = self.A_X0 + g("hdr_a_w")
        self.B_X1 = g("hdr_span") / 2
        self.B_X0 = self.B_X1 - g("hdr_b_w")
        self.A_CX, self.B_CX = (self.A_X0 + self.A_X1) / 2, (self.B_X0 + self.B_X1) / 2
        low = self.Y0 + g("hole_low")
        self.HOLES = [(0.0, low + g("hole_rise")), (-g("hole_pitch") / 2, low), (g("hole_pitch") / 2, low)]
        self.exits = {}
        self.fillets = {}

    # ------------------------------------------------------------------ solids
    def case_solid(self):
        g, W, H, D, T, Y0 = self.g, self.W, self.H, self.D, self.T, self.Y0
        outline = extrude(RectangleRounded(W, H, g("corner_r")), amount=T)
        plate = fillet(outline.edges().group_by(Axis.Z)[-1], radius=g("plate_fillet"))
        for (x, y) in self.HOLES:   # flat washer lands: the front round stops short of each hole
            land = Pos(x, y, T - 5) * Cylinder(g("washer_max") / 2, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
            plate += land & outline
        prof = [(Y0, 10.0), (Y0, D), (Y0 + g("slope_front_h"), D), (Y0 + g("slope_top_h"), T), (Y0 + g("slope_top_h"), 10.0)]
        face = Plane.YZ * Polygon(*prof, align=None)
        corner = [vx for vx in face.vertices() if _near(vx.Z, D) and _near(vx.Y, Y0 + g("slope_front_h"))]
        face = fillet(corner, radius=g("slope_r"))
        housing = extrude(face, amount=W / 2, both=True)
        z_top, ds = 48.0, g("draft_start")
        xw = W / 2 - (z_top - ds) * self.T18
        wedge = extrude(Plane.XZ * Polygon((-W / 2, -1), (W / 2, -1), (W / 2, ds), (xw, z_top), (-xw, z_top), (-W / 2, ds),
                                           align=None), amount=90, both=True)
        housing = housing & wedge
        side = [e for e in housing.edges() if e.center().Z > ds + 4 and abs(e.center().X) > 38
                and e.center().Y < Y0 + g("slope_front_h") + 1 and not _near(e.center().Y, Y0, 0.3)]
        for r in (g("front_edge_r"), 3.0, 2.0):
            try:
                housing = fillet(side, radius=r)
                self.fillets["front_edge_r"] = r
                break
            except ValueError:
                continue
        shell = plate + housing
        for (x, y) in self.HOLES:
            shell -= Pos(x, y, -1) * Cylinder(g("hole_d") / 2, T + 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
        lab = extrude(RectangleRounded(g("label_w"), g("label_h"), 2.9), amount=2)
        shell -= Pos(0, Y0 + g("label_y"), D - g("label_depth")) * lab
        shell -= self.header_pocket(self.A_X0, self.A_X1)
        shell -= self.header_pocket(self.B_X0, self.B_X1)
        return shell

    def label_solid(self):
        g = self.g
        lab = extrude(RectangleRounded(g("label_w") - 0.3, g("label_h") - 0.3, 2.75), amount=g("label_depth") - 0.15)
        return Pos(0, self.Y0 + g("label_y"), self.D - g("label_depth")) * lab

    def header_solid(self, x0, x1):
        """Shroud standing hdr_proud below the bottom edge; its cavity runs up into the housing for TE's plug nose."""
        g = self.g
        w, cx = x1 - x0, (x0 + x1) / 2
        wall, face = g("hdr_wall"), self.HDR_FACE
        top = face + g("cav_depth") + 1.0
        outer = Pos(cx, (face + top) / 2, self.HDR_Z) * Box(w, top - face, self.HDR_D)
        outer = fillet(outer.edges().filter_by(Axis.Y), radius=g("hdr_r"))
        cav_h = g("cav_depth")
        cav = Pos(cx, face + cav_h / 2 - 0.01, self.HDR_Z) * Box(w - 2 * wall, cav_h + 0.02, self.HDR_D - 2 * wall)
        cav = fillet(cav.edges().filter_by(Axis.Y), radius=max(0.3, g("hdr_r") - wall))
        lw, lp = g("latch_w"), g("latch_proud")
        latch = Pos(cx, self.Y0 - 3.2, self.HDR_Z + self.HDR_D / 2 + lp / 2) * Box(lw, 2.2, lp)
        return (outer - cav) + latch

    def header_pocket(self, x0, x1):
        top = self.HDR_FACE + self.g("cav_depth") + 1.0
        return Pos((x0 + x1) / 2, (self.Y0 - 0.5 + top) / 2, self.HDR_Z) * Box(x1 - x0, top - self.Y0 + 0.5, self.HDR_D)

    def pins_solid(self, cx, outer_n):
        """4 rows along X: outer rows outer_n pins, inner rows outer_n - 1, offset half a pitch (TE face view)."""
        g = self.g
        pitch = g("pin_pitch")
        zo = g("row_gap_inner") / 2 + g("row_gap_outer")
        zi = g("row_gap_inner") / 2
        floor = self.HDR_FACE + g("cav_depth")
        pins = []
        for dz, n in ((zo, outer_n), (zi, outer_n - 1), (-zi, outer_n - 1), (-zo, outer_n)):
            for i in range(n):
                pins.append(Pos(cx + (i - (n - 1) / 2) * pitch, floor - 4.25, self.HDR_Z + dz) * Box(1.0, 8.5, 0.6))
        return Compound(children=pins).fuse()

    def numbers_solid(self, cx, ways):
        """TE's row-end numbers, raised 0.15 mm on the cavity floor where you see them looking up into the header."""
        floor = self.HDR_FACE + self.g("cav_depth")
        lay = cavity_layout(ways, self.g("pin_pitch"), self.g("row_gap_outer"), self.g("row_gap_inner"))
        rows = {}
        for n, row, dx, dz in lay:
            rows.setdefault(row, []).append((n, dx, dz))
        parts = []
        for row, cells in rows.items():
            (n0, x0, z0), (n1, x1, _z1) = cells[0], cells[-1]
            for n, x, anchor in ((n0, x0 - 1.9, "right"), (n1, x1 + 1.9, "left")):
                parts.append(K.text_solid(str(n), 1.3, (cx + x, floor, self.HDR_Z + z0), plane="xz-", depth=0.15, align=anchor))
        return Compound(children=parts).fuse()

    def cavities(self):
        """One row per header cavity: the pin (tip centre inside the header), the cavity centre on the plug's wire
        side, the wire exit, the maker's pin name and the build's wires (registry terminations)."""
        g = self.g
        reg = json.loads((CALC / "k5_registry.json").read_text())
        wires = {w["id"]: w for w in reg["wires"]}
        by_cav = {}
        for tm in reg["terminations"]:
            m = re.match(r"^([AB])0*(\d+)$", str(tm.get("cavity", "")))
            if m:
                by_cav.setdefault((tm["endpoint"], m.group(1), int(m.group(2))), []).append(tm["wire"])
        names = {}
        for line in (CALC / self.s["designations"]).read_text().splitlines():
            parts = line.split("|")
            if len(parts) >= 3:
                m = re.match(r"^([AB])0*(\d+)$", parts[0].strip())
                if m:
                    names[(m.group(1), int(m.group(2)))] = (parts[1].strip(), parts[2].strip())
        floor = self.HDR_FACE + g("cav_depth")
        tip_y = floor - 8.5
        rear_y = self.HDR_FACE - (g("plug_l") - g("nose_l"))
        rows = []
        for key, ways, cx in (("A", 34, self.A_CX), ("B", 26, self.B_CX)):
            ep = self.s["endpoints"][key]
            for n, row, dx, dz in cavity_layout(ways, g("pin_pitch"), g("row_gap_outer"), g("row_gap_inner")):
                nm, full = names.get((key, n), ("?", "not in the designations file"))
                ws = by_cav.get((ep, key, n), [])
                rows.append({
                    "pin": f"{key}{n:02d}", "maker_pin": self.s.get("pin_fmt", "{k}{n:02d}").format(k=key, n=n),
                    "endpoint": ep, "cavity": n, "row": row,
                    "name": nm, "full_name": full,
                    "pin_tip_glb_m": _glb((cx + dx, tip_y, self.HDR_Z + dz)),
                    "wire_side_glb_m": _glb((cx + dx, rear_y, self.HDR_Z + dz)),
                    "exit_dir_glb": _glb_dir((0, -1, 0)),
                    "wires": [{"id": w, "label": wires.get(w, {}).get("label"), "color": wires.get(w, {}).get("color"),
                               "awg": wires.get(w, {}).get("awg")} for w in ws]})
        return rows

    def stud_solids(self):
        """M6 battery stud on the flat case front (PDM): hex base, stud, nut. Position printed, sizes scaled."""
        g, T = self.g, self.T
        y = self.Y0 + g("stud_y")
        L = g("stud_len")
        hex_base = Pos(0, y, T) * extrude(_hexagon(g("stud_base_af")), amount=g("stud_base_t"))
        stud = Pos(0, y, T + g("stud_base_t")) * Cylinder(g("stud_d") / 2, L - g("stud_base_t"),
                                                          align=(Align.CENTER, Align.CENTER, Align.MIN))
        nut = Pos(0, y, T + L - 1.0 - g("nut_t")) * extrude(_hexagon(g("nut_af")), amount=g("nut_t"))
        return hex_base, stud, nut

    def branding_solids(self):
        """The maker's label as text and shapes sized off the product photo (spec['branding']); cosmetic only.
        Items are placed on the label panel (x right, y up from its centre) or, with on='face', on the flat case front."""
        g, s = self.g, self.s
        panel_z = self.D - g("label_depth") + (g("label_depth") - 0.15)
        cy = self.Y0 + g("label_y")
        out = []
        for it in s.get("branding", []):
            z0 = panel_z if it.get("on", "label") == "label" else self.T
            x, y = it["x"], (cy + it["y"]) if it.get("on", "label") == "label" else (self.Y0 + it["y"])
            col = it["color"]
            if it["kind"] != "ring_text":
                z0 += it.get("lift", 0.0)
            if it["kind"] == "text":
                solid = K.text_solid(it["s"], it["size"], (x, y, z0), depth=0.12, font=it.get("font", "Arial"),
                                     style=it.get("style", "regular"), align=it.get("align", "center"))
            elif it["kind"] == "frame":
                o = extrude(RectangleRounded(it["w"], it["h"], it["r"]), amount=0.12)
                i_ = extrude(RectangleRounded(it["w"] - 2 * it["t"], it["h"] - 2 * it["t"], max(0.2, it["r"] - it["t"])), amount=0.12)
                solid = Pos(x, y, z0) * (o - i_)
            elif it["kind"] == "bar":
                solid = Pos(x, y, z0 + 0.06) * Box(it["w"], it["t"], 0.12)
            elif it["kind"] == "disc":
                solid = Pos(x, y, z0) * Cylinder(it["d"] / 2, it.get("t", 0.4), align=(Align.CENTER, Align.CENTER, Align.MIN))
            elif it["kind"] == "ring_text":
                parts = []
                for k in range(it["n"]):
                    a = math.radians(it.get("a0", 90) + 360 * k / it["n"])
                    tx = K.text_solid(it["s"], it["size"], (0, 0, 0), depth=0.12, style=it.get("style", "bold"))
                    tx = tx.rotate(Axis.Z, math.degrees(a) - 90)
                    parts.append(Pos(x + it["r"] * math.cos(a), y + it["r"] * math.sin(a), z0 + it.get("lift", 0.4)) * tx)
                solid = Compound(children=parts).fuse()
            else:
                raise ValueError(it["kind"])
            out.append(K.body(solid, f"{s['name']} branding: {it['what']} (redrawn from the photo, cosmetic)", col, finish="print"))
        return out

    def mated_solids(self):
        g = self.g
        eA, eB = self.s["endpoints"]["A"], self.s["endpoints"]["B"]
        a, a_exit, a_dir = SS.plug_solids(34, self.A_CX, self.HDR_FACE, self.HDR_Z, eA)
        b, b_exit, b_dir = SS.plug_solids(26, self.B_CX, self.HDR_FACE, self.HDR_Z, eB)
        x0 = self.A_CX - g("plug34_w") / 2
        x1 = self.B_CX + g("plug26_w") / 2
        ph = g("plug_h")
        kmin, kmax = g("keepout_min"), g("keepout")
        k60 = Pos((x0 + x1) / 2, self.HDR_FACE - kmin / 2, self.HDR_Z) * Box(x1 - x0, kmin, ph)
        k80 = Pos((x0 + x1) / 2, self.HDR_FACE - kmin - (kmax - kmin) / 2, self.HDR_Z) * Box(x1 - x0, kmax - kmin, ph)
        ko = [K.body(k60, "keep-out 0-60 mm below the plug faces (minimum)", self.s["colors"]["keepout"][0], 0.22),
              K.body(k80, "keep-out 60-80 mm below the plug faces (budget)", self.s["colors"]["keepout"][0], 0.12)]
        self.exits = {eA: (a_exit, a_dir), eB: (b_exit, b_dir)}
        return a + b, ko, (x0, x1)

    def build(self):
        C, s = self.s["colors"], self.s
        eA, eB = s["endpoints"]["A"], s["endpoints"]["B"]
        case = K.body(self.case_solid(), f"{s['name']} case (MoTeC {s['pn']})", C["case"][0])
        label = K.body(self.label_solid(), f"{s['name']} label panel", C["label"][0])
        hdr_a = K.body(self.header_solid(self.A_X0, self.A_X1), f"{eA} header: 34-way TE Superseal 1.0 Key 1 (mates MoTeC #65044)", C["header"][0])
        hdr_b = K.body(self.header_solid(self.B_X0, self.B_X1), f"{eB} header: 26-way TE Superseal 1.0 Key 1 (mates MoTeC #65045)", C["header"][0])
        pins_a = K.body(self.pins_solid(self.A_CX, 9), f"{eA} pins (34)", C["pins"][0], finish="metal")
        pins_b = K.body(self.pins_solid(self.B_CX, 7), f"{eB} pins (26)", C["pins"][0], finish="metal")
        bodies = [case, label, hdr_a, hdr_b, pins_a, pins_b]
        if s.get("stud"):
            base, stud, nut = self.stud_solids()
            bodies += [K.body(stud, f"{s['endpoints']['stud']}: M6 battery stud", C["stud"][0], finish="metal"),
                       K.body(nut, f"{s['endpoints']['stud']}: M6 nut", C["stud"][0], finish="metal"),
                       K.body(base, f"{s['endpoints']['stud']}: stud's insulating hex base", C["batt_disc"][0])]
        self.cosmetic = [K.body(self.numbers_solid(self.A_CX, 34), f"{eA} cavity numbers (TE)", C["numbers"][0]),
                         K.body(self.numbers_solid(self.B_CX, 26), f"{eB} cavity numbers (TE)", C["numbers"][0])]
        self.cosmetic += self.branding_solids()
        mated, ko, span = self.mated_solids()
        return bodies, mated + ko, span

    # ------------------------------------------------------------------ record
    def attach_points(self):
        if not self.exits:
            self.mated_solids()
        out = []
        for key, ways in (("A", 34), ("B", 26)):
            ep = self.s["endpoints"][key]
            (x, y, z), d = self.exits[ep]
            out.append({"n": "plug", "ep": ep, "at": [x, y, z], "dir": d,
                        "note": f"{ways}-way: wires leave the ProWire backshell's boot collar straight down; the boot "
                                "(straight / 70 / 90 degrees) is HELD, so the final bend is open (keep-out 60-80 mm)"})
        if self.s.get("stud"):
            g = self.g
            out.append({"n": "stud", "ep": self.s["endpoints"]["stud"],
                        "at": [0.0, round(self.Y0 + g("stud_y"), 2), round(self.T + g("stud_len"), 2)], "dir": [0, 1, 0],
                        "kind": "stud", "note": "M6 stud, eyelet and M6 nut (PDM manual p.47 draws the power cable leaving upward)"})
        return out

    def checks(self, bodies):
        from build123d import GeomType as G
        pr = self.s["printed"]
        case, _label, hdr_a, hdr_b, pins_a, pins_b = bodies[:6]
        res = []

        def chk(name, got, want, tol=0.05):
            res.append({"check": name, "model": round(got, 3), "drawing": want, "ok": abs(got - want) <= tol})

        bb = case.bounding_box()
        chk("case width (x)", bb.size.X, pr["case_w"])
        chk("case height (y)", bb.size.Y, pr["case_h"])
        chk("case depth (z)", bb.size.Z, pr["depth"])
        holes = sorted({(round(e.arc_center.X, 3), round(e.arc_center.Y, 3)) for e in case.edges()
                        if e.geom_type == G.CIRCLE and abs(e.radius - self.g("hole_d") / 2) < 0.01 and abs(e.arc_center.Z) < 0.01},
                       key=lambda h: (-h[1], h[0]))
        res.append({"check": "hole count", "model": len(holes), "drawing": 3, "ok": len(holes) == 3})
        if len(holes) == 3:
            top, low = holes[0], sorted(holes[1:])
            chk("hole pitch", low[1][0] - low[0][0], pr["hole_pitch"])
            chk("hole rise (lower to top)", top[1] - low[0][1], pr["hole_rise"])
            chk("lower holes above the bottom edge", low[0][1] - self.Y0, pr["hole_low"])
            chk("hole centre from the side edge", low[0][0] + self.W / 2, pr["hole_edge"])
            chk("top hole on the centreline", top[0], 0.0)
        for nm, h, w in (("A", hdr_a, self.g("hdr_a_w")), ("B", hdr_b, self.g("hdr_b_w"))):
            hb = h.bounding_box()
            chk(f"header {nm} width", hb.size.X, w)
            chk(f"header {nm} below the bottom edge", self.Y0 - hb.min.Y, pr["hdr_proud"])
            chk(f"header {nm} depth (z, less the latch ramp)", hb.size.Z - self.g("latch_proud"), pr["hdr_depth"])
        chk("span over both headers", hdr_b.bounding_box().max.X - hdr_a.bounding_box().min.X, pr["hdr_span"])
        hz = hdr_a.bounding_box()
        if "hdr_z" in pr:
            chk("header centre from the back face", (hz.min.Z + hz.max.Z - self.g("latch_proud")) / 2, pr["hdr_z"])
        if "hdr_back" in pr:
            chk("header rear edge from the back face", hz.min.Z, pr["hdr_back"])
        res.append({"check": "pins A", "model": len(pins_a.solids()), "drawing": 34, "ok": len(pins_a.solids()) == 34})
        res.append({"check": "pins B", "model": len(pins_b.solids()), "drawing": 26, "ok": len(pins_b.solids()) == 26})
        if self.s.get("stud"):
            sb = bodies[6].bounding_box()      # the stud itself
            chk("stud above the bottom edge", (sb.min.Y + sb.max.Y) / 2 - self.Y0, pr["stud_y"])
            chk("stud out from the case front", sb.max.Z - self.T, pr["stud_len"])
        return res

    def part_meta(self, bodies):
        s, g = self.s, self.g
        eps = [s["endpoints"]["A"], s["endpoints"]["B"]] + ([s["endpoints"]["stud"]] if s.get("stud") else [])
        faces = {"plugs": "-Y", "label": "+Z", "mounting": "-Z"}
        if s.get("stud"):
            faces["stud"] = "+Z"
        return {"id": s["pid"], "endpoints": eps, "what": s["what"], "maker": "MoTeC", "maker_pn": s["pn"],
                "shape_basis": "maker drawing",
                "dims_mm": {"l": self.W, "w": round(self.H + g("hdr_proud"), 2), "h": self.D},
                "dims_note": s["dims_note"],
                "frame": "origin at the centre of the back (mounting) face; +X right, +Y up in MoTeC's front view; +Z out of "
                         "the back face; plugs face -Y" + ("; the M6 stud stands out of the flat case front" if s.get("stud") else ""),
                "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": faces},
                "colors": {k: {"hex": c[0], "from": c[1]} for k, c in s["colors"].items()},
                "attach": self.attach_points(),
                "mount": [{"n": f"hole_{i}", "at": [x, y, 0], "dir": [0, 0, -1], "d": g("hole_d"),
                           "note": "M5 or 3/16 in; washer or head 13 max"} for i, (x, y) in enumerate(self.HOLES)],
                "mated": {"what": "TE Superseal 1.0 plugs 2-1437285-3 (34) and -2 (26) with ProWire SSB-34BS-PA66 / "
                                  "SSB-26BS-PA66 backshells", "sources": [SS.TE, SS.PW]},
                "keepout": {"what": "plug + boot + wire bend below both plug faces", "min_mm": g("keepout_min"),
                            "budget_mm": g("keepout"), "source": s["keepout_src"]},
                "params": K.params_table(self.P),
                "checks": self.checks(bodies),
                "pins": {"file": f"{s['pid']}.pins.json (built with the part)", "numbering": TE_NUM,
                         "names": s["designations_src"], "orientation_unknown": s["pin_orientation_note"]},
                "branding": {"what": [it["what"] for it in s.get("branding", [])],
                             "basis": "branding, redrawn from photo: text and shapes sized off the maker's product photo; "
                                      "fonts are stand-ins; cosmetic, never used for fit; no maker artwork used",
                             "source": s["photo_short"]},
                "unknowns": s["unknowns"], "cross_checks": s.get("cross_checks", []), "notes": s.get("notes", [])}

    # ------------------------------------------------------------------ drawing
    def drawing(self, path, meta, bodies, extra):
        s, g, P = self.s, self.g, self.P
        W, H, D, T, Y0 = self.W, self.H, self.D, self.T, self.Y0
        A_X0, A_X1, B_X0, B_X1, A_CX, B_CX = self.A_X0, self.A_X1, self.B_X0, self.B_X1, self.A_CX, self.B_CX
        HDR_FACE, HDR_Z, HDR_D, HOLES = self.HDR_FACE, self.HDR_Z, self.HDR_D, self.HOLES
        S = K.Sheet(480, 272, s["name"])
        solid = [(b, "solid") for b in bodies]
        mated = [(b, "mated") for b in extra if not b.label.startswith("keep-out")]
        ko_shapes = [(b, "keepout") for b in extra if b.label.startswith("keep-out")]
        FX, FY = 100, 96
        RX = FX + 130
        BY = FY + 150
        front = S.view("front", solid, (FX, FY), hidden=False)
        right = S.view("right", solid + mated + ko_shapes, (RX, FY), hidden=True)
        bottom = S.view("bottom", solid + mated, (FX, BY), hidden=False)
        S.text((FX, FY - H / 2 - 22), "FRONT VIEW", size=3.6, weight="bold")
        S.text((RX - 20, FY - H / 2 - 22), "RIGHT VIEW", size=3.6, weight="bold")
        S.text((FX, BY + 12), "BOTTOM VIEW  (looking up at the plug faces; the front of the unit is at the top)", size=3.0, weight="bold")
        S.dim(front, (-W / 2, H / 2, 0), (W / 2, H / 2, 0), 10, P["case_w"])
        S.dim(front, (-W / 2, Y0, 0), (-W / 2, H / 2, 0), -24, P["case_h"])
        hx, hy = HOLES[1]
        S.dim(front, (-W / 2, Y0, 0), (hx, hy, 0), -12, P["hole_low"], axis="v")
        S.dim(front, (hx, hy, 0), (HOLES[0][0], HOLES[0][1], 0), -12 - (hx + W / 2), P["hole_rise"], axis="v")
        S.dim(front, (HOLES[1][0], hy, 0), (HOLES[2][0], hy, 0), 9, P["hole_pitch"])
        S.dim(front, (HOLES[2][0], hy, 0), (W / 2, hy, 0), 9, P["hole_edge"])
        for (x, y) in HOLES:
            S.centre_mark(front, (x, y, T), 4.2)
        S.leader(front, (HOLES[0][0] - 1.9, HOLES[0][1] - 1.9, T), (-14, 20), "Ø5.2 THRU ×3", anchor="start")
        S.text(front.xy((-W / 2 + 22, HOLES[0][1] - 26, T)), "to suit M5 or 3/16 in; washer or head Ø13 max", size=2.8,
               anchor="start", color=K.BASIS_COLOR["maker"])
        S.leader(front, (-W / 2 + 1.6, H / 2 - 1.6, T), (-7, -9), "R5.5", anchor="end")
        S.dim(front, (A_X0, HDR_FACE, 0), (B_X1, HDR_FACE, 0), -13, P["hdr_span"])
        S.dim(front, (A_X0, HDR_FACE, 0), (A_X1, HDR_FACE, 0), -6, P["hdr_a_w"])
        S.dim(front, (B_X0, HDR_FACE, 0), (B_X1, HDR_FACE, 0), -6, P["hdr_b_w"])
        S.dim(front, (W / 2, Y0, 0), (W / 2, HDR_FACE, 0), 7, P["hdr_proud"], axis="v")
        S.text(front.xy((A_CX, Y0 + 2.2, D)), "A · 34-way", size=2.6)
        S.text(front.xy((B_CX, Y0 + 2.2, D)), "B · 26-way", size=2.6)
        if s.get("stud"):
            sy = Y0 + g("stud_y")
            S.dim(front, (W / 2, Y0, 0), (W / 2, sy, 0), 18, P["stud_y"], axis="v")
            S.line(front.xy((0, sy, T)), front.xy((W / 2 + 19, sy, T)), "ext")
            S.leader(front, (3.0, sy - 3.0, T + 20), (24, 8), "M6 battery stud", anchor="start")
            S.dim(right, (0, sy, T), (0, sy, T + g("stud_len")), 10, P["stud_len"], axis="h")
        S.dim(right, (0, H / 2, 0), (0, H / 2, T), 7, P["plate_t"])
        S.dim(right, (0, H / 2, 0), (0, H / 2, D), 15, P["depth"])
        S.dim(right, (0, Y0, D), (0, Y0 + g("housing_h"), D), -7, P["housing_h"], axis="v")
        kmin, kmax = g("keepout_min"), g("keepout")
        zb = HDR_Z - g("plug_h") / 2
        S.dim(right, (0, HDR_FACE, zb), (0, HDR_FACE - kmin, zb), 6, P["keepout_min"], axis="v")
        S.dim(right, (0, HDR_FACE, zb), (0, HDR_FACE - kmax, zb), 13, P["keepout"], axis="v")
        S.text(right.xy((0, HDR_FACE - 45, HDR_Z)), "KEEP-OUT", size=3.0, color=K.BASIS_COLOR["design"], weight="bold")
        S.text(right.xy((0, HDR_FACE - 50, HDR_Z)), "plug + boot + bend", size=2.4, color=K.BASIS_COLOR["design"])
        S.text(right.xy((0, HDR_FACE - 4.5, HDR_Z + 21)), "TE plug", size=2.2, color="#5d6670", anchor="end")
        S.text(right.xy((0, HDR_FACE - 21, HDR_Z + 21)), "backshell", size=2.2, color="#5d6670", anchor="end")
        S.text(right.xy((0, HDR_FACE - 25, HDR_Z + 21)), "(photo-sized)", size=2.0, color=K.BASIS_COLOR["photo"], anchor="end")
        S.dim(bottom, (-W / 2, 0, 0), (-W / 2, 0, D), -9, P["depth"], axis="v")
        if "hdr_back" in P:
            S.dim(bottom, (A_X0, 0, 0), (A_X0, 0, HDR_Z - HDR_D / 2), -(A_X0 + W / 2) - 17, P["hdr_back"], axis="v")
        else:
            S.dim(bottom, (A_X0, 0, 0), (A_X0, 0, HDR_Z), -(A_X0 + W / 2) - 17, P["hdr_z"], axis="v")
        S.dim(bottom, (B_X1, 0, HDR_Z - HDR_D / 2), (B_X1, 0, HDR_Z + HDR_D / 2), (W / 2 - B_X1) + 9, P["hdr_depth"], axis="v")
        ds = g("draft_start")
        S.line(bottom.xy((W / 2, 0, ds)), bottom.xy((W / 2, 0, D + 8)), "ext")
        S.angle(bottom, (W / 2, 0, ds), 90, 108, 22, "18°")
        S.text(bottom.xy((A_CX, 0, 3.5)), "A · 34-way", size=2.5)
        S.text(bottom.xy((B_CX, 0, 3.5)), "B · 26-way", size=2.5)
        S.text(bottom.xy((0, 0, D + 12)), "latch ramps on the front side of each header (away from the mounting face); plugs exit straight down",
               size=2.5, color="#10151a")
        S.text(bottom.xy((0, 0, D + 8)), "grey = the mated TE plug and ProWire backshell outlines", size=2.3, color="#5d6670")
        tx, ty = 272, 18
        S.text((tx, ty), f"{s['title']}", size=5.2, anchor="start", weight="bold")
        S.text((tx, ty + 6), "K5 harness reference model (build123d) · mm · 1:1 · third-angle projection", size=2.8, anchor="start")
        S.text((tx, ty + 10.5), f"Redrawn from MoTeC's printed dimensions, not a MoTeC drawing. Endpoints {', '.join(meta['endpoints'])}.",
               size=2.8, anchor="start")
        S.text((tx, ty + 15), "Origin: centre of the back (mounting) face. +Y up, +Z out of the back face; plugs face -Y.", size=2.8,
               anchor="start")
        S.text((tx, ty + 21), "blue = printed by the maker · orange ≈ scaled off the maker's drawing · purple ≈ sized off a photo · "
                              "green = our clearance · red = assumed", size=2.6, anchor="start", weight="bold")
        y = S.table(P, tx, ty + 28, s["refs"])
        C = s["colors"]
        S.text((tx, y + 2), "Colours (" + s["photo_short"] + ", k-means per region): case " + C["case"][0] + ", housing " + C["housing"][0]
               + ", label " + C["label"][0] + ", headers " + C["header"][0] + "; pins " + C["pins"][0] + " not sourced.",
               size=2.3, anchor="start")
        yy = y + 5.5
        for line, col in s["drawing_notes"]:
            S.text((tx, yy), line, size=2.3, anchor="start", color=K.BASIS_COLOR.get(col, col))
            yy += 3.5
        S.h = max(S.h, yy + 10)
        S.write(path, {k: v for k, v in meta.items() if not k.startswith("_")})

    def pinout_svg(self, path, rows):
        """Both header faces seen from below (looking up at the pins, +X right, the front of the unit at the top),
        3:1, every cavity with TE's number, the maker's pin name and the build's wire ids and colours."""
        sc = 3.0
        cell = []
        ox = {"A": 40 + 12.5 * sc + 20, "B": 40 + 12.5 * sc + 20 + 32 * sc + 60}
        oy = 70 + 12 * sc
        esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;")  # noqa: E731
        for key, ways in (("A", 34), ("B", 26)):
            w = self.g("hdr_a_w") if key == "A" else self.g("hdr_b_w")
            x0 = ox[key] - w / 2 * sc
            y0 = oy - self.HDR_D / 2 * sc
            cell.append(f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{w * sc:.1f}" height="{self.HDR_D * sc:.1f}" rx="{self.g("hdr_r") * sc:.1f}" '
                        f'fill="#f4f5f6" stroke="#10151a" stroke-width="0.6"/>')
            cell.append(f'<rect x="{ox[key] - self.g("latch_w") / 2 * sc:.1f}" y="{y0 - self.g("latch_proud") * sc:.1f}" '
                        f'width="{self.g("latch_w") * sc:.1f}" height="{self.g("latch_proud") * sc:.1f}" fill="#d9dde1" stroke="#10151a" stroke-width="0.4"/>')
            cell.append(f'<text x="{ox[key]:.1f}" y="{y0 - 12:.1f}" font-size="5" text-anchor="middle" font-weight="bold">'
                        f'{esc(self.s["endpoints"][key])} · {ways}-way (latch side up = the front of the unit)</text>')
            for r in [r for r in rows if r["pin"].startswith(key)]:
                lay = {n: (dx, dz) for n, _row, dx, dz in cavity_layout(ways)}
                dx, dz = lay[r["cavity"]]
                cx, cy = ox[key] + dx * sc, oy - dz * sc
                used = bool(r["wires"])
                cell.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{1.25 * sc:.1f}" fill="{"#2e7d32" if used else "#ffffff"}" '
                            f'stroke="#10151a" stroke-width="0.4"/>')
                cell.append(f'<text x="{cx:.1f}" y="{cy + 1.3:.1f}" font-size="3.4" text-anchor="middle" fill="{"#ffffff" if used else "#10151a"}">{r["cavity"]}</text>')
        # table
        ty = oy + self.HDR_D / 2 * sc + 22
        cell.append(f'<text x="20" y="{ty:.1f}" font-size="4" font-weight="bold">pin</text><text x="42" y="{ty:.1f}" font-size="4" font-weight="bold">maker name</text>'
                    f'<text x="95" y="{ty:.1f}" font-size="4" font-weight="bold">build wires (registry id · colour · AWG · what)</text>')
        yy = ty + 5
        col2 = 250
        half = (len(rows) + 1) // 2
        for i, r in enumerate(rows):
            x = 20 if i < half else col2
            y = yy + (i if i < half else i - half) * 4.4
            ws = "; ".join(f"{w['id']} {w['color'] or ''} {w['awg'] or ''} {w['label'] or ''}".strip() for w in r["wires"]) or "unused"
            cell.append(f'<text x="{x}" y="{y:.1f}" font-size="3.1">{r["pin"]}</text>'
                        f'<text x="{x + 16}" y="{y:.1f}" font-size="3.1">{esc(r["name"])}</text>'
                        f'<text x="{x + 55}" y="{y:.1f}" font-size="2.8" fill="#3b4550">{esc(ws[:95])}</text>')
        H = yy + half * 4.4 + 30
        note = esc(self.s["pin_orientation_note"])
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 {H:.0f}" width="480mm" height="{H:.0f}mm">'
               f'<style>text{{font-family:Helvetica,Arial,sans-serif;fill:#10151a}}</style><rect width="100%" height="100%" fill="#fff"/>'
               f'<text x="20" y="22" font-size="7" font-weight="bold">{esc(self.s["title"])}: pinout on the headers</text>'
               f'<text x="20" y="31" font-size="3.6">Looking up at the header faces (plugs off), 3:1. Green = a wire lands there in this build. '
               f'Cavity numbers: TE 2-1437285-3 (wire side, polarity-marked lock on top). Names: {esc(self.s["designations_src"])}.</text>'
               f'<text x="20" y="37" font-size="3.4" fill="#b3261e">{note}</text>' + "".join(cell) + "</svg>")
        Path(path).write_text(svg)

    # ------------------------------------------------------------------ outputs
    def main(self, out):
        s = self.s
        out = Path(out).expanduser()
        out.mkdir(parents=True, exist_ok=True)
        pid = s["pid"]
        bodies, extra, span = self.build()
        desc = [f"K5 harness reference model: {s['title']} (not a MoTeC file)",
                "Units mm. Origin: centre of the back (mounting) face. +Y up in MoTeC's front view, +Z out of the back, plugs face -Y."]
        desc += [f"{k} = {d.value:g} [{d.basis}] {d.source}" for k, d in self.P.items()]
        K.write_step(Compound(children=bodies, label=s["name"]), out / f"{pid}.step", desc)
        mated = [b for b in extra if not b.label.startswith("keep-out")]
        vols = [b for b in extra if b.label.startswith("keep-out")]
        K.write_step(Compound(children=mated, label=f"{s['name']} mated plugs"), out / f"{pid}_mated.step",
                     [f"K5 harness: the two TE Superseal 1.0 plugs and ProWire SSB backshells seated on the {s['name']}",
                      f"plugs: {SS.TE}", "backshells: " + SS.PW] + [f"{k} = {d.value:g} [{d.basis}] {d.source}" for k, d in SS.P.items()])
        K.write_step(Compound(children=vols, label=f"{s['name']} keep-out"), out / f"{pid}_keepout.step",
                     [f"K5 harness: clearance below the {s['name']} plugs (design aid, not a product)", s["keepout_src"]])
        K.write_glb(bodies + self.cosmetic + extra, out / f"{pid}.glb")
        rows = self.cavities()
        (out / f"{pid}.pins.json").write_text(json.dumps(
            {"id": pid, "frame": "GLB coordinates: metres, glTF Y-up (part x, z, -y); pin_tip = pin centre inside the header, "
                                 "wire_side = cavity centre on the plug's rear face, exit_dir = the way the wires leave",
             "numbering": TE_NUM, "names": self.s["designations_src"],
             "wires": "docs/wiring/calc-data/k5_registry.json terminations (endpoint + cavity)",
             "orientation_unknown": self.s["pin_orientation_note"], "cavities": rows}, indent=1, ensure_ascii=False))
        self.pinout_svg(out / f"{pid}_pinout.svg", rows)
        meta = self.part_meta(bodies)
        bad = [c for c in meta["checks"] if not c["ok"]]
        for c in meta["checks"]:
            print(("ok  " if c["ok"] else "BAD ") + f"{c['check']}: model {c['model']} vs drawing {c['drawing']}")
        self.drawing(out / f"{pid}_drawing.svg", meta, bodies, extra)
        (out / f"{pid}.params.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
        bb = Compound(children=bodies).bounding_box()
        print(f"{pid}: {bb.size.X:.2f} x {bb.size.Y:.2f} x {bb.size.Z:.2f} mm")
        if bad:
            raise SystemExit(f"{len(bad)} checks failed")


def _hexagon(af):
    """Regular hexagon face (flats across af) on the XY plane, flats parallel to X."""
    r = af / 2 / math.cos(math.pi / 6)
    pts = [(r * math.cos(math.radians(30 + 60 * i)), r * math.sin(math.radians(30 + 60 * i))) for i in range(6)]
    return Polygon(*pts, align=None)
