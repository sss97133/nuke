"""Shared helpers for the K5 part models (build123d, parametric B-rep CAD).

A part script defines its dimensions as `Dim(value, source, basis)` and builds named, coloured solids from them.
This module writes what each part ships with:
  <id>.step          the part (millimetres); the STEP header's FILE_DESCRIPTION lists every dimension and its source
  <id>_keepout.step  clearance volumes (plugs, boots, cables), when the part has them
  <id>.glb           the same solids for the Blender scene and the site: metres, glTF Y-up, no Draco
  <id>_drawing.svg   third-angle views with dimensions, drawn from the model's own edges (1 SVG unit = 1 mm)
  <id>.params.json   the dimension table: value, source, basis
Dimension basis: maker = the maker's drawing prints the number; scaled = measured off the maker's drawing with
one of its printed dimensions as the scale; photo = sized off a product photo against a sourced dimension;
design = our clearance or choice; assumed = not in any source.
The drawing prints maker numbers in blue, scaled ones in orange with a "≈", photo ones in purple with a "≈",
design ones in green, assumed ones in red.
Nothing here traces a maker's image: shapes come from the numbers.
"""
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from build123d import Color, Compound, GeomType, Location, export_step

BASIS_COLOR = {"maker": "#1f5fbf", "scaled": "#c46a00", "photo": "#7b3fa0", "design": "#2e7d32", "assumed": "#b3261e"}


@dataclass
class Dim:
    value: float
    source: str
    basis: str = "maker"
    note: str = ""
    fit: str = ""        # "fit-critical, scaled": a bracket or cutout depends on it, but the maker didn't print it

    def __float__(self):
        return float(self.value)


def v(d):
    return float(d.value) if isinstance(d, Dim) else float(d)


def hex_color(h, alpha=1.0):
    h = h.lstrip("#")
    return Color(int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, alpha)


FINISHES = {  # glTF metallicFactor, roughnessFactor. glTF defaults to fully metallic, so every material gets one.
    "plastic": (0.0, 0.55), "rubber": (0.0, 0.85), "gloss": (0.0, 0.3), "paint": (0.0, 0.45), "print": (0.0, 0.4),
    "metal": (1.0, 0.35), "cast": (0.6, 0.6), "chrome": (1.0, 0.12), "lens": (0.0, 0.1), "aid": (0.0, 0.8),
}
FINISH_BY_LABEL = {}


def body(shape, label, hexc, alpha=1.0, finish=None):
    shape.label = label
    shape.color = hex_color(hexc, alpha)
    FINISH_BY_LABEL[label] = finish or ("aid" if alpha < 1.0 else "plastic")
    return shape


def text_solid(s, size, at, plane="xy", depth=0.1, font="Arial", style="regular", font_path=None, align="center"):
    """Raised lettering as a solid: `at` is the text's anchor in the part frame; plane 'xy' faces +Z, 'xz-' faces -Y."""
    from build123d import Align, FontStyle, Plane, Pos, Text, extrude
    fs = {"regular": FontStyle.REGULAR, "bold": FontStyle.BOLD, "italic": FontStyle.ITALIC,
          "bolditalic": FontStyle.BOLDITALIC}[style]
    al = {"center": (Align.CENTER, Align.CENTER), "left": (Align.MIN, Align.CENTER), "right": (Align.MAX, Align.CENTER)}[align]
    kw = {"font_path": font_path} if font_path else {"font": font, "font_style": fs}
    sk = Text(s, font_size=size, align=al, **kw)
    if plane == "xy":
        solid = extrude(sk, amount=depth)
        return Pos(*at) * solid
    if plane == "xz-":            # on a face whose outward normal is -Y, readable from below with +X right, +Z up
        solid = extrude(Plane.XZ * sk, amount=depth)
        return Pos(at[0], at[1], at[2]) * solid
    raise ValueError(plane)


def params_table(P):
    return [{"name": k, "value": d.value, "source": d.source, "basis": d.basis, **({"note": d.note} if d.note else {}),
             **({"fit": d.fit} if d.fit else {})} for k, d in P.items()]


def _step_str(s):
    s = s.encode("ascii", "replace").decode().replace("'", "''")
    return "'" + s[:240] + "'"


def write_step(shape, path, description):
    export_step(shape, str(path))
    text = Path(path).read_text()
    desc = ",\n  ".join(_step_str(s) for s in description)
    text = text.replace("FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');", f"FILE_DESCRIPTION(({desc}),'2;1');", 1)
    Path(path).write_text(text)


def write_glb(bodies, path, linear=0.25, angular=0.45):
    """glTF 2.0 binary, metres, Y-up (OCC puts the Z-up to Y-up turn on the root node), faces merged per body,
    no UVs and no Draco, so the file stays small and any viewer or Blender importer reads it."""
    import build123d.exporters3d as ex
    from OCP.BRepTools import BRepTools
    from OCP.Message import Message_ProgressRange
    from OCP.RWGltf import RWGltf_CafWriter
    from OCP.TCollection import TCollection_AsciiString
    comp = Compound(children=bodies, label=Path(path).stem)
    comp.location *= Location((0, 0, 0), (1, 0, 0), -90)
    for node in ex.PreOrderIter(comp):
        if node.wrapped is not None:
            node.mesh(linear, angular)
    doc = ex._create_xde(comp, ex.Unit.MM, auto_naming=False)
    writer = RWGltf_CafWriter(TCollection_AsciiString(str(path)), True)
    writer.SetParallel(True)
    writer.SetForcedUVExport(False)
    writer.SetMergeFaces(True)
    ok = writer.Perform(doc, ex.IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString(), Message_ProgressRange())
    BRepTools.Clean_s(comp.wrapped)
    if not ok:
        raise RuntimeError(f"glTF export failed: {path}")
    _set_finishes(path, {b.label: FINISH_BY_LABEL.get(b.label, "plastic") for b in bodies})


def _set_finishes(path, finish_of):
    """Write metallicFactor / roughnessFactor on every material (OCC leaves them out, and glTF then means metal)."""
    import struct
    raw = Path(path).read_bytes()
    jl = struct.unpack("<I", raw[12:16])[0]
    j = json.loads(raw[20:20 + jl])
    rest = raw[20 + jl:]
    users = {}
    for n in j.get("nodes", []):
        if "mesh" in n:
            for pr in j["meshes"][n["mesh"]]["primitives"]:
                if "material" in pr:
                    users.setdefault(pr["material"], []).append(n.get("name", ""))
    for i, m in enumerate(j.get("materials", [])):
        names = users.get(i, [])
        fin = next((finish_of[nm] for nm in names if nm in finish_of), "plastic")
        met, rough = FINISHES[fin]
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"], pbr["roughnessFactor"] = met, rough
        m["name"] = f"{fin} {m.get('name', i)}"
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    Path(path).write_bytes(struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js + rest)


# ------------------------------------------------------------------------------------------ the drawing
VIEWS = {  # name: (eye direction from the part, up hint). "wall" parts: maker's up is +Y, the face is +Z.
    "front": ((0, 0, 1), (0, 1, 0)), "top": ((0, 1, 0), (0, 0, -1)), "right": ((1, 0, 0), (0, 1, 0)),
    "bottom": ((0, -1, 0), (0, 0, 1)), "left": ((-1, 0, 0), (0, 1, 0)), "back": ((0, 0, -1), (0, 1, 0)),
}
VIEWS_FLOOR = {  # "floor" parts stand on their base: maker's up is +Z, the front faces -Y.
    "front": ((0, -1, 0), (0, 0, 1)), "top": ((0, 0, 1), (0, 1, 0)), "right": ((1, 0, 0), (0, 0, 1)),
    "left": ((-1, 0, 0), (0, 0, 1)), "back": ((0, 1, 0), (0, 0, 1)), "bottom": ((0, 0, -1), (0, -1, 0)),
}


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    n = math.sqrt(sum(c * c for c in a))
    return tuple(c / n for c in a)


class View:
    def __init__(self, sheet, kind, shapes, origin, hidden=True, label=None, viewset="wall", scale=1.0):
        self.sheet, self.kind, self.ox, self.oy = sheet, kind, origin[0], origin[1]
        self.s = scale
        e, up = (VIEWS_FLOOR if viewset == "floor" else VIEWS)[kind]
        f = tuple(-c for c in e)
        self.r = _norm(_cross(f, up))
        self.t = _norm(_cross(self.r, f))
        self.label = label or kind.upper()
        self.edges = []
        groups = {}
        for shp, style in shapes:
            groups.setdefault(style, []).append(shp)
        for style, shps in groups.items():   # one projection per style, so solids hide each other
            vis, hid = Compound(children=shps).project_to_viewport(tuple(1000 * c for c in e), up, (0, 0, 0))
            self.edges.append((vis, style))
            if style == "solid" and hidden:
                self.edges.append((hid, "hidden"))

    def uv(self, p):
        return (sum(a * b for a, b in zip(p, self.r)), sum(a * b for a, b in zip(p, self.t)))

    def xy(self, p):
        """World point (mm) -> sheet point (mm, y down)."""
        u, w = self.uv(p)
        return (self.ox + u * self.s, self.oy - w * self.s)

    def _uv_xy(self, u, w):
        return (self.ox + u * self.s, self.oy - w * self.s)

    def svg(self):
        out = []
        for edges, style in self.edges:
            cls = {"solid": "vis", "hidden": "hid", "keepout": "ko", "mated": "mat"}[style]
            d = []
            for e in edges:
                if e.geom_type == GeomType.LINE:
                    pts = [e.position_at(0), e.position_at(1)]
                else:
                    n = max(8, min(64, int(e.length / 1.2)))
                    pts = [e.position_at(i / n) for i in range(n + 1)]
                d.append("M" + " L".join(f"{self.ox + p.X * self.s:.2f},{self.oy - p.Y * self.s:.2f}" for p in pts))
            if d:
                out.append(f'<path class="{cls}" d="{" ".join(d)}"/>')
        return "\n".join(out)


class Sheet:
    def __init__(self, w, h, title):
        self.w, self.h, self.title = w, h, title
        self.views = {}
        self.els = []

    def view(self, kind, shapes, origin, hidden=True, label=None, viewset="wall", scale=1.0):
        vw = View(self, kind, shapes, origin, hidden=hidden, label=label, viewset=viewset, scale=scale)
        self.views[kind] = vw
        return vw

    # --- annotation primitives (sheet coordinates, mm)
    def line(self, a, b, cls="thin"):
        self.els.append(f'<line class="{cls}" x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}"/>')

    def text(self, p, s, size=3.0, anchor="middle", color="#1a2027", rot=0, weight="normal"):
        s = s.replace("&", "&amp;").replace("<", "&lt;")
        tr = f' transform="rotate({rot:.1f} {p[0]:.2f} {p[1]:.2f})"' if rot else ""
        self.els.append(f'<text x="{p[0]:.2f}" y="{p[1]:.2f}" font-size="{size}" text-anchor="{anchor}" fill="{color}"'
                        f' font-weight="{weight}"{tr}>{s}</text>')

    def _arrow(self, tip, direction, color):
        dx, dy = direction
        n = math.hypot(dx, dy) or 1
        dx, dy = dx / n, dy / n
        L, W = 2.6, 0.9
        b = (tip[0] - dx * L, tip[1] - dy * L)
        p1 = (b[0] - dy * W, b[1] + dx * W)
        p2 = (b[0] + dy * W, b[1] - dx * W)
        self.els.append(f'<path d="M{tip[0]:.2f},{tip[1]:.2f} L{p1[0]:.2f},{p1[1]:.2f} L{p2[0]:.2f},{p2[1]:.2f} Z" fill="{color}"/>')

    def dim(self, view, p1, p2, offset, dimv=None, axis=None, text=None, prefix=""):
        """Linear dimension between world points p1, p2 in a view; offset (mm) moves the dimension line
        perpendicular to the measured direction (positive = up/right on the sheet)."""
        basis = dimv.basis if isinstance(dimv, Dim) else "maker"
        color = BASIS_COLOR.get(basis, "#1a2027")
        a, b = view.uv(p1), view.uv(p2)
        k = 1.0 / view.s
        offset = offset * k
        g1, g2 = 0.8 * k, 1.2 * k
        if axis is None:
            axis = "h" if abs(b[0] - a[0]) >= abs(b[1] - a[1]) else "v"
        if axis == "h":
            yv = max(a[1], b[1]) + offset if offset > 0 else min(a[1], b[1]) + offset
            A, B = view._uv_xy(a[0], yv), view._uv_xy(b[0], yv)
            self.line(view._uv_xy(a[0], a[1] + (g1 if offset > 0 else -g1)), view._uv_xy(a[0], yv + (g2 if offset > 0 else -g2)), "ext")
            self.line(view._uv_xy(b[0], b[1] + (g1 if offset > 0 else -g1)), view._uv_xy(b[0], yv + (g2 if offset > 0 else -g2)), "ext")
            meas = abs(b[0] - a[0])
        else:
            xv = max(a[0], b[0]) + offset if offset > 0 else min(a[0], b[0]) + offset
            A, B = view._uv_xy(xv, a[1]), view._uv_xy(xv, b[1])
            self.line(view._uv_xy(a[0] + (g1 if offset > 0 else -g1), a[1]), view._uv_xy(xv + (g2 if offset > 0 else -g2), a[1]), "ext")
            self.line(view._uv_xy(b[0] + (g1 if offset > 0 else -g1), b[1]), view._uv_xy(xv + (g2 if offset > 0 else -g2), b[1]), "ext")
            meas = abs(b[1] - a[1])
        self.els.append(f'<line x1="{A[0]:.2f}" y1="{A[1]:.2f}" x2="{B[0]:.2f}" y2="{B[1]:.2f}" stroke="{color}" stroke-width="0.18"/>')
        self._arrow(A, (A[0] - B[0], A[1] - B[1]), color)
        self._arrow(B, (B[0] - A[0], B[1] - A[1]), color)
        if text is None:
            val = v(dimv) if dimv is not None else meas
            text = f"{val:.2f}".rstrip("0").rstrip(".")
        if basis in ("scaled", "photo"):
            text = "≈" + text
        text = prefix + text
        mid = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
        small = meas * view.s < 3.2 * max(2, len(text)) * 0.55
        if axis == "h":
            if small:
                self.text((max(A[0], B[0]) + 1.5, mid[1] + 1.0), text, color=color, anchor="start")
            else:
                self.text((mid[0], mid[1] - 1.0), text, color=color)
        else:
            if small:
                self.text((mid[0] - 1.0, min(A[1], B[1]) - 1.5), text, color=color, rot=-90, anchor="start")
            else:
                self.text((mid[0] - 1.0, mid[1]), text, color=color, rot=-90)
        return meas

    def leader(self, view, p, dxdy, text, basis="maker", anchor="start"):
        color = BASIS_COLOR.get(basis, "#1a2027")
        a = view.xy(p)
        b = (a[0] + dxdy[0], a[1] + dxdy[1])
        self.els.append(f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}" stroke="{color}" stroke-width="0.18"/>')
        self._arrow(a, (a[0] - b[0], a[1] - b[1]), color)
        tail = (b[0] + (8 if anchor == "start" else -8), b[1])
        self.els.append(f'<line x1="{b[0]:.2f}" y1="{b[1]:.2f}" x2="{tail[0]:.2f}" y2="{tail[1]:.2f}" stroke="{color}" stroke-width="0.18"/>')
        self.text((tail[0] + (0.8 if anchor == "start" else -0.8), tail[1] + 1.0), text, anchor=anchor, color=color)

    def angle(self, view, vertex, a_dir, b_dir, radius, text, basis="maker"):
        """Arc between two directions (sheet space, degrees measured from +x, y down) at a world vertex."""
        color = BASIS_COLOR.get(basis, "#1a2027")
        c = view.xy(vertex)
        pts = []
        for i in range(21):
            t = math.radians(a_dir + (b_dir - a_dir) * i / 20)
            pts.append((c[0] + radius * math.cos(t), c[1] - radius * math.sin(t)))
        self.els.append('<path fill="none" stroke="%s" stroke-width="0.18" d="M%s"/>' % (color, " L".join(f"{x:.2f},{y:.2f}" for x, y in pts)))
        for ang in (a_dir, b_dir):
            t = math.radians(ang)
            self.line(c, (c[0] + (radius + 3) * math.cos(t), c[1] - (radius + 3) * math.sin(t)), "ext")
        t = math.radians((a_dir + b_dir) / 2)
        self.text((c[0] + (radius + 4.5) * math.cos(t), c[1] - (radius + 4.5) * math.sin(t) + 1), text, color=color)

    def table(self, P, x, y, refs, row=3.4, size=2.3):
        """Dimension table: name, value, short source tag; refs = [(tag, prefix of the source string, legend)]."""
        def tag(src):
            tags = [t for t, pre, _ in refs if pre in src]
            return ", ".join(tags) if tags else src[:60]
        self.text((x, y), "dimension", size=size, anchor="start", weight="bold")
        self.text((x + 30, y), "mm", size=size, anchor="start", weight="bold")
        self.text((x + 42, y), "source (page)", size=size, anchor="start", weight="bold")
        y += row
        for k, d in P.items():
            col = BASIS_COLOR.get(d.basis, "#1a2027")
            self.text((x, y), k + (" *" if d.fit else ""), size=size, anchor="start", color=col,
                      weight="bold" if d.fit else "normal")
            self.text((x + 30, y), f"{d.value:g}", size=size, anchor="start", color=col)
            note = f"  ({d.note})" if d.note else ""
            s = (tag(d.source) + note)
            self.text((x + 42, y), s if len(s) < 110 else s[:107] + "...", size=size * 0.92, anchor="start", color="#3b4550")
            y += row
        y += 2
        if any(d.fit for d in P.values()):
            self.text((x, y), "*  fit-critical, scaled: a bracket or cutout depends on it, but the maker did not print it."
                      " Confirm on the part first.", size=size * 0.92, anchor="start", color=BASIS_COLOR["scaled"], weight="bold")
            y += row
        for t_, _, legend in refs:
            self.text((x, y), f"{t_}  {legend}", size=size * 0.92, anchor="start", color="#3b4550")
            y += row
        return y

    def centre_mark(self, view, p, size=4.0):
        c = view.xy(p)
        self.line((c[0] - size, c[1]), (c[0] + size, c[1]), "ctr")
        self.line((c[0], c[1] - size), (c[0], c[1] + size), "ctr")

    def write(self, path, meta):
        style = ("text{font-family:Helvetica,Arial,sans-serif}"
                 ".vis{fill:none;stroke:#10151a;stroke-width:0.35;stroke-linejoin:round;stroke-linecap:round}"
                 ".hid{fill:none;stroke:#7d8791;stroke-width:0.16;stroke-dasharray:1.4 0.9}"
                 ".ko{fill:none;stroke:#2e7d32;stroke-width:0.22;stroke-dasharray:2.4 1.2}"
                 ".mat{fill:none;stroke:#5d6670;stroke-width:0.2}"
                 ".thin{stroke:#1a2027;stroke-width:0.18}.ext{stroke:#6b747d;stroke-width:0.13}"
                 ".ctr{stroke:#6b747d;stroke-width:0.13;stroke-dasharray:3 0.8 0.6 0.8}")
        body_ = "\n".join(vw.svg() for vw in self.views.values())
        for vw in self.views.values():
            pass
        md = json.dumps(meta, ensure_ascii=False, indent=1).replace("--", "- -")
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}mm" height="{self.h}mm">\n'
               f'<metadata><![CDATA[{md}]]></metadata>\n<style>{style}</style>\n'
               f'<rect width="100%" height="100%" fill="#ffffff"/>\n'
               f'<rect x="5" y="5" width="{self.w - 10}" height="{self.h - 10}" fill="none" stroke="#10151a" stroke-width="0.5"/>\n'
               f'{body_}\n' + "\n".join(self.els) + "\n</svg>\n")
        Path(path).write_text(svg)


# ------------------------------------------------------------------------------------------ generic parts
def checks_from(mod, bodies):
    """mod.CHECKS: [(name, fn(bodies) -> model value, printed value, tol)]."""
    out = []
    for name, fn, want, *tol in getattr(mod, "CHECKS", []):
        got = fn(bodies)
        tl = tol[0] if tol else 0.05
        exact = isinstance(want, bool) or not isinstance(want, (int, float))
        out.append({"check": name, "model": round(got, 3) if isinstance(got, float) else got, "drawing": want,
                    **({} if exact else {"tol": tl}),
                    "ok": (got == want) if exact else (abs(got - want) <= tl)})
    return out


def meta_for(mod, bodies):
    A = mod.PART
    return {"id": A["pid"], "endpoints": A["endpoints"], "what": A["what"], "maker": A["maker"], "maker_pn": A["pn"],
            "shape_basis": A["shape_basis"], "dims_mm": A["dims_mm"], "dims_note": A.get("dims_note", ""),
            "frame": A["frame"], "axes": A["axes"],
            "colors": {k: {"hex": c[0], "from": c[1]} for k, c in mod.COLORS.items()},
            "attach": mod.attach_points(), "mount": mod.mount_points() if hasattr(mod, "mount_points") else [],
            **({"keepout": A["keepout"]} if A.get("keepout") else {}),
            "params": params_table(mod.P), "checks": checks_from(mod, bodies),
            "branding": {"what": A.get("branding", []),
                         "basis": "branding, redrawn from photo: text and shapes sized off the maker's product photo; fonts "
                                  "are stand-ins; cosmetic, never used for fit; no maker artwork used",
                         "source": A.get("photo_short", "")} if A.get("branding") else {},
            "unknowns": A.get("unknowns", []), "cross_checks": A.get("cross_checks", []), "notes": A.get("notes", [])}


def _extent(view, shapes):
    lo, hi = [1e9, 1e9], [-1e9, -1e9]
    for s in shapes:
        bb = s.bounding_box()
        for x in (bb.min.X, bb.max.X):
            for y in (bb.min.Y, bb.max.Y):
                for z in (bb.min.Z, bb.max.Z):
                    u, w = view.uv((x, y, z))
                    lo, hi = [min(lo[0], u), min(lo[1], w)], [max(hi[0], u), max(hi[1], w)]
    return lo, hi


def auto_drawing(mod, bodies, extra, meta, path):
    """Third-angle FRONT / RIGHT / TOP at a standard scale that fits, overall dimensions from the model, the part's
    own dimensions (mod.annotate), the title block and the dimension table."""
    A = mod.PART
    vs = A.get("viewset", "floor")
    solid = [(b, "solid") for b in bodies]
    ko = [(b, "keepout") for b in extra if b.label.startswith("keep-out")]
    mated = [(b, "mated") for b in extra if not b.label.startswith("keep-out")]
    probe = View(None, "front", [], (0, 0), viewset=vs)
    probe_r = View(None, "right", [], (0, 0), viewset=vs)
    probe_t = View(None, "top", [], (0, 0), viewset=vs)
    shp = bodies + [b for b in extra]
    (fl, fh), (rl, rh), (tl, th) = _extent(probe, shp), _extent(probe_r, shp), _extent(probe_t, shp)
    fw, fhh = fh[0] - fl[0], fh[1] - fl[1]
    rw, th_ = rh[0] - rl[0], th[1] - tl[1]
    avail_w, avail_h = 230.0, 230.0
    scale = 1.0
    for s in (1.0, 0.5, 0.4, 0.25, 0.2, 0.1, 0.05):
        if (fw + rw) * s + 60 <= avail_w and (fhh + th_) * s + 70 <= avail_h:
            scale = s
            break
    else:
        scale = 0.05
    FX = 30 + (-fl[0]) * scale + 10
    FY = 40 + th_ * scale + 25 + fh[1] * scale
    RX = FX + fh[0] * scale + 35 + (-rl[0]) * scale
    TY = FY - fh[1] * scale - 22 + tl[1] * scale      # the top view's lower edge sits 22 above the front view
    S = Sheet(480, 272, A["pid"])
    front = S.view("front", solid + mated, (FX, FY), hidden=False, viewset=vs, scale=scale)
    right = S.view("right", solid + mated + ko, (RX, FY), hidden=True, viewset=vs, scale=scale)
    top = S.view("top", solid + mated, (FX, TY), hidden=False, viewset=vs, scale=scale)
    S.text((FX + (fl[0] + fh[0]) / 2 * scale, FY - fl[1] * scale + 14), "FRONT VIEW", size=3.4, weight="bold")
    S.text((RX + (rl[0] + rh[0]) / 2 * scale, FY - rl[1] * scale + 14), "RIGHT VIEW", size=3.4, weight="bold")
    S.text((FX + (tl[0] + th[0]) / 2 * scale, TY - th[1] * scale - 5), "TOP VIEW", size=3.4, weight="bold")
    if hasattr(mod, "annotate"):
        mod.annotate(S, {"front": front, "right": right, "top": top})
    tx, ty = 272, 18
    ratio = {1.0: "1:1", 0.5: "1:2", 0.4: "1:2.5", 0.25: "1:4", 0.2: "1:5", 0.1: "1:10", 0.05: "1:20"}[scale]
    S.text((tx, ty), A["title"], size=5.0, anchor="start", weight="bold")
    S.text((tx, ty + 6), f"K5 harness reference model (build123d) · mm · {ratio} · third-angle projection", size=2.8, anchor="start")
    S.text((tx, ty + 10.5), f"Redrawn from {A['maker']}'s published numbers, not a {A['maker']} drawing. Endpoints "
                            f"{', '.join(A['endpoints'])}.", size=2.8, anchor="start")
    S.text((tx, ty + 15), "Origin: " + A["frame"][:120], size=2.6, anchor="start")
    S.text((tx, ty + 21), "blue = printed by the maker · orange ≈ scaled off the maker's drawing · purple ≈ sized off a photo · "
                          "green = our clearance · red = assumed", size=2.6, anchor="start", weight="bold")
    y = S.table(mod.P, tx, ty + 28, A["refs"])
    S.text((tx, y + 2), "Colours: " + ", ".join(f"{k} {c[0]}" for k, c in mod.COLORS.items())[:150], size=2.3, anchor="start")
    yy = y + 5.5
    for line, col in A.get("drawing_notes", []):
        S.text((tx, yy), line, size=2.3, anchor="start", color=BASIS_COLOR.get(col, col))
        yy += 3.5
    S.h = max(S.h, yy + 10, FY - min(fl[1], rl[1]) * scale + 24)
    S.write(path, meta)


def run(mod, out):
    """Build a generic part script: STEP (+ keep-out), GLB (with cosmetics), params.json, the drawing."""
    A = mod.PART
    pid = A["pid"]
    out = Path(out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    bodies, extra, cosmetic = mod.build()
    desc = [f"K5 harness reference model: {A['title']} (not a {A['maker']} file)", "Units mm. Frame: " + A["frame"]]
    desc += [f"{k} = {d.value:g} [{d.basis}] {d.source}" for k, d in mod.P.items()]
    write_step(Compound(children=bodies, label=pid), out / f"{pid}.step", desc)
    if extra:
        write_step(Compound(children=extra, label=f"{pid} keep-out"), out / f"{pid}_keepout.step",
                   [f"K5 harness: clearance around the {A['title']} (design aid, not a product)"])
    write_glb(bodies + cosmetic + extra, out / f"{pid}.glb")
    if hasattr(mod, "terminals"):
        write_pins(mod, out)
    meta = meta_for(mod, bodies)
    for c in meta["checks"]:
        tol = f" (within ±{c['tol']:g})" if c.get("tol") else ""
        print(("ok  " if c["ok"] else "BAD ") + f"{c['check']}: model {c['model']} vs drawing {c['drawing']}{tol}")
    auto_drawing(mod, bodies, extra, meta, out / f"{pid}_drawing.svg")
    (out / f"{pid}.params.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    bb = Compound(children=bodies).bounding_box()
    print(f"{pid}: {bb.size.X:.2f} x {bb.size.Y:.2f} x {bb.size.Z:.2f} mm")
    bad = [c for c in meta["checks"] if not c["ok"]]
    if bad:
        raise SystemExit(f"{len(bad)} checks failed")


# ------------------------------------------------------------------------------------------ the build's wires
CALC = Path(__file__).resolve().parents[2]          # docs/wiring/calc-data
_REG = {}


def registry():
    if not _REG:
        reg = json.loads((CALC / "k5_registry.json").read_text())
        wires = {w["id"]: w for w in reg.get("implied", [])}
        wires.update({w["id"]: w for w in reg["wires"]})
        _REG.update({"wires": wires, "terminations": reg["terminations"]})
    return _REG


def wire_rows(ids):
    W = registry()["wires"]
    return [{"id": w, "label": W.get(w, {}).get("label"), "color": W.get(w, {}).get("color"), "awg": W.get(w, {}).get("awg")}
            for w in ids]


def glb_point(p):
    """Part frame (mm, Z up) -> the GLB's own frame (metres, glTF Y up: x, z, -y)."""
    x, y, z = p
    return [round(x / 1000, 5), round(z / 1000, 5), round(-y / 1000, 5)]


def glb_dir(d):
    x, y, z = d
    return [x, z, -y]


def write_pins(mod, out):
    """<id>.pins.json for a part whose ends are studs or terminals: mod.terminals() -> [{pin, name, at, dir,
    endpoint, match (regex on the registry termination's cavity text)}]."""
    A = mod.PART
    rows = []
    terms = registry()["terminations"]
    for tm in mod.terminals():
        rx = re.compile(tm["match"], re.I)
        ids = [x["wire"] for x in terms if x["endpoint"] == tm["endpoint"] and rx.search(str(x.get("cavity", "")))]
        rows.append({"pin": tm["pin"], "endpoint": tm["endpoint"], "name": tm["name"], "full_name": tm.get("full_name", tm["name"]),
                     "pin_tip_glb_m": glb_point(tm["at"]), "wire_side_glb_m": glb_point(tm["at"]),
                     "exit_dir_glb": glb_dir(tm["dir"]), "wires": wire_rows(ids)})
    (Path(out) / f"{A['pid']}.pins.json").write_text(json.dumps(
        {"id": A["pid"], "frame": "GLB coordinates: metres, glTF Y-up (part x, z, -y); pin_tip = where the lug or wire lands, "
                                  "exit_dir = the way the cable leaves",
         "wires": "docs/wiring/calc-data/k5_registry.json terminations (endpoint + terminal text)", "cavities": rows},
        indent=1, ensure_ascii=False))
    return rows
