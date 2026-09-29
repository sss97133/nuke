"""Shared helpers for the K5 part models (build123d, parametric B-rep CAD).

A part script defines its dimensions as `Dim(value, source, basis)` and builds named, coloured solids from them.
This module writes what each part ships with:
  <id>.step          the part (millimetres); the STEP header's FILE_DESCRIPTION lists every dimension and its source
  <id>_keepout.step  clearance volumes (plugs, boots, cables), when the part has them
  <id>.glb           the same solids for the Blender scene and the site: metres, glTF Y-up, no Draco
  <id>_drawing.svg   third-angle views with dimensions, drawn from the model's own edges (1 SVG unit = 1 mm)
  <id>.params.json   the dimension table: value, source, basis
Dimension basis: maker = the maker's drawing prints the number; scaled = measured off the maker's drawing with
one of its printed dimensions as the scale; design = our clearance or choice; assumed = not in any source.
The drawing prints maker numbers in blue, scaled ones in orange with a "≈", design ones in green.
Nothing here traces a maker's image: shapes come from the numbers.
"""
import json
import math
from dataclasses import dataclass
from pathlib import Path

from build123d import Color, Compound, GeomType, Location, export_step

BASIS_COLOR = {"maker": "#1f5fbf", "scaled": "#c46a00", "design": "#2e7d32", "assumed": "#b3261e"}


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


def body(shape, label, hexc, alpha=1.0):
    shape.label = label
    shape.color = hex_color(hexc, alpha)
    return shape


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


# ------------------------------------------------------------------------------------------ the drawing
VIEWS = {  # name: (eye direction from the part, up hint)
    "front": ((0, 0, 1), (0, 1, 0)), "top": ((0, 1, 0), (0, 0, -1)), "right": ((1, 0, 0), (0, 1, 0)),
    "bottom": ((0, -1, 0), (0, 0, 1)), "left": ((-1, 0, 0), (0, 1, 0)), "back": ((0, 0, -1), (0, 1, 0)),
}


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    n = math.sqrt(sum(c * c for c in a))
    return tuple(c / n for c in a)


class View:
    def __init__(self, sheet, kind, shapes, origin, hidden=True, label=None):
        self.sheet, self.kind, self.ox, self.oy = sheet, kind, origin[0], origin[1]
        e, up = VIEWS[kind]
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
        return (self.ox + u, self.oy - w)

    def _uv_xy(self, u, w):
        return (self.ox + u, self.oy - w)

    def svg(self):
        out = []
        for edges, style in self.edges:
            cls = {"solid": "vis", "hidden": "hid", "keepout": "ko"}[style]
            d = []
            for e in edges:
                if e.geom_type == GeomType.LINE:
                    pts = [e.position_at(0), e.position_at(1)]
                else:
                    n = max(8, min(64, int(e.length / 1.2)))
                    pts = [e.position_at(i / n) for i in range(n + 1)]
                d.append("M" + " L".join(f"{self.ox + p.X:.2f},{self.oy - p.Y:.2f}" for p in pts))
            if d:
                out.append(f'<path class="{cls}" d="{" ".join(d)}"/>')
        return "\n".join(out)


class Sheet:
    def __init__(self, w, h, title):
        self.w, self.h, self.title = w, h, title
        self.views = {}
        self.els = []

    def view(self, kind, shapes, origin, hidden=True, label=None):
        vw = View(self, kind, shapes, origin, hidden=hidden, label=label)
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
        if axis is None:
            axis = "h" if abs(b[0] - a[0]) >= abs(b[1] - a[1]) else "v"
        if axis == "h":
            yv = max(a[1], b[1]) + offset if offset > 0 else min(a[1], b[1]) + offset
            A, B = view._uv_xy(a[0], yv), view._uv_xy(b[0], yv)
            self.line(view._uv_xy(a[0], a[1] + (0.8 if offset > 0 else -0.8)), view._uv_xy(a[0], yv + (1.2 if offset > 0 else -1.2)), "ext")
            self.line(view._uv_xy(b[0], b[1] + (0.8 if offset > 0 else -0.8)), view._uv_xy(b[0], yv + (1.2 if offset > 0 else -1.2)), "ext")
            meas = abs(b[0] - a[0])
        else:
            xv = max(a[0], b[0]) + offset if offset > 0 else min(a[0], b[0]) + offset
            A, B = view._uv_xy(xv, a[1]), view._uv_xy(xv, b[1])
            self.line(view._uv_xy(a[0] + (0.8 if offset > 0 else -0.8), a[1]), view._uv_xy(xv + (1.2 if offset > 0 else -1.2), a[1]), "ext")
            self.line(view._uv_xy(b[0] + (0.8 if offset > 0 else -0.8), b[1]), view._uv_xy(xv + (1.2 if offset > 0 else -1.2), b[1]), "ext")
            meas = abs(b[1] - a[1])
        self.els.append(f'<line x1="{A[0]:.2f}" y1="{A[1]:.2f}" x2="{B[0]:.2f}" y2="{B[1]:.2f}" stroke="{color}" stroke-width="0.18"/>')
        self._arrow(A, (A[0] - B[0], A[1] - B[1]), color)
        self._arrow(B, (B[0] - A[0], B[1] - A[1]), color)
        if text is None:
            val = v(dimv) if dimv is not None else meas
            text = f"{val:.2f}".rstrip("0").rstrip(".")
        if basis == "scaled":
            text = "≈" + text
        text = prefix + text
        mid = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
        small = meas < 3.2 * max(2, len(text)) * 0.55
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
