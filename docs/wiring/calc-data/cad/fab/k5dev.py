"""Shared helpers for the K5 device models: the machines, lamps, switches and modules the harness ends land on.

Built on k5cad (Dim, bodies, STEP / GLB export, the drawing). This module adds what the device families share:
  - the registry record of each end (device text, family, wires with label, colour and gauge), read at build time;
  - run(): k5cad.run plus the record, the part's overall margin and a pins file for flying leads, blades and studs;
  - small solids the families reuse: rounded boxes, flying leads, blade terminals, studs, holes, lenses.
A part script defines P (Dims), COLORS, PART, build(), attach_points(), terminals() and CHECKS, as k5cad expects.
PART adds: "margin" (overall envelope uncertainty: {"mm", "why"}) and "photo" (the maker photo the model is checked
against: {"url", "page", "fetched"}, never committed).
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/<id>.py <out_dir>
"""
import json
import math
import re
from pathlib import Path

from build123d import Align, Axis, Box, Compound, Cone, Cylinder, Location, Plane, Pos, Rot, Sphere, extrude, fillet

import k5cad as K
from k5cad import Dim  # noqa: F401  (re-exported for the part scripts)

CEN = (Align.CENTER, Align.CENTER, Align.CENTER)
BASE = (Align.CENTER, Align.CENTER, Align.MIN)
TOP = (Align.CENTER, Align.CENTER, Align.MAX)

# wire insulation colours for flying leads (the lead colour the maker prints, not the harness wire's)
LEAD_HEX = {"red": "#c4161c", "black": "#1b1b1b", "white": "#ececec", "yellow": "#f2c511", "orange": "#ee7b16",
            "brown": "#6b3a1e", "blue": "#1f4fbf", "green": "#2a8a3a", "grey": "#8d9196", "violet": "#6a3d9a",
            "tan": "#c8a878", "pink": "#e889a8", "light blue": "#77b7e6", "dark green": "#1f5d2d", "purple": "#6a3d9a"}


# ------------------------------------------------------------------------------------------ the registry record
def scrub(t):
    """The registry's device text without prices, order numbers, order dates, record ids or people's names (the repo is
    public)."""
    if not t:
        return t
    t = re.sub(r"\s*\([^()]*(\$|order|obs:)[^()]*\)", "", t)
    t = re.sub(r"[;,]?\s*lined up at [^;—]*?\$[\d,]+(?:\.\d+)?(?: a pair| each)?", "", t)
    t = re.sub(r"\$[\d,]+(?:\.\d+)?", "", t)
    t = re.sub(r"\bbought \d{4}-\d{2}-\d{2}\s*", "", t)
    t = re.sub(r"\b(via|through|from) Dave\b", r"\1 the builder", t)
    return re.sub(r"\s{2,}", " ", t).strip(" ;,")


def registry_record(endpoints):
    reg = json.loads((K.CALC / "k5_registry.json").read_text())
    eps = reg["endpoints"]
    out = {}
    for ep in endpoints:
        r = eps.get(ep, {})
        ids = list(r.get("wires", []))
        out[ep] = {"device": scrub(r.get("device")), "family": r.get("family"), "where": r.get("where"),
                   "wires": K.wire_rows(ids),
                   "cavities": {t["wire"]: t.get("cavity") for t in reg["terminations"] if t["endpoint"] == ep}}
    return out


def ns(g):
    """A part script's globals as a module-like namespace (index_v5 loads scripts without registering them in sys.modules)."""
    from types import SimpleNamespace
    return SimpleNamespace(**g)


def part_meta(mod, bodies):
    A = mod.PART
    m = K.meta_for(mod, bodies)
    m["margin_mm"] = A.get("margin", {"mm": None, "why": "not set"})
    m["registry"] = registry_record(A["endpoints"])
    if A.get("photo"):
        m["photo"] = A["photo"]
    if A.get("same_piece"):
        m["same_piece"] = A["same_piece"]
    return m


# ------------------------------------------------------------------------------------------ pins
def write_pins(mod, out):
    """<id>.pins.json. mod.terminals() -> [{pin, endpoint, name, at, dir, and either wires: [ids] or match: regex on the
    registry termination's cavity text}]. A lead's pin_tip is where it leaves the part; wire_side is its free end.
    registry_endpoint names the registry end a wire lands on when it isn't the part's own (the isolator's studs are PS-STUDS)."""
    A = mod.PART
    terms = K.registry()["terminations"]
    rows = []
    for tm in mod.terminals():
        if "wires" in tm:
            ids = list(tm["wires"])
        else:
            rx = re.compile(tm["match"], re.I)
            ids = [x["wire"] for x in terms if x["endpoint"] == tm["endpoint"] and rx.search(str(x.get("cavity", "")))]
        tip = tm["at"]
        free = tm.get("free", tip)
        rows.append({"pin": tm["pin"], "endpoint": tm["endpoint"], "name": tm["name"], "full_name": tm.get("full_name", tm["name"]),
                     "kind": tm.get("kind", ""), "pin_tip_glb_m": K.glb_point(tip), "wire_side_glb_m": K.glb_point(free),
                     "exit_dir_glb": K.glb_dir(tm["dir"]), "wires": K.wire_rows(ids),
                     **({"registry_endpoint": tm["registry_endpoint"]} if tm.get("registry_endpoint") else {}),
                     **({"note": tm["note"]} if tm.get("note") else {})})
    (Path(out) / f"{A['pid']}.pins.json").write_text(json.dumps(
        {"id": A["pid"], "frame": "GLB coordinates: metres, glTF Y-up (part x, z, -y); pin_tip = where the lug, blade or lead "
                                  "leaves the part, wire_side = the lead's free end (same as pin_tip for a stud or blade), "
                                  "exit_dir = the way the wire leaves",
         "wires": "docs/wiring/calc-data/k5_registry.json terminations (endpoint + terminal text), or the wire ids named",
         "cavities": rows}, indent=1, ensure_ascii=False))
    return rows


def glb_scan(path):
    raw = Path(path).read_bytes().lower()
    return [s for s in (b"blendermcp", b"api_key") if s in raw]


def run(mod, out):
    """k5cad.run, with the registry record, the margin and the pins; fails on a failed check or a flagged string."""
    A = mod.PART
    pid = A["pid"]
    out = Path(out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    bodies, extra, cosmetic = mod.build()
    desc = [f"K5 harness reference model: {A['title']} (not a {A['maker']} file)", "Units mm. Frame: " + A["frame"]]
    desc += [f"{k} = {d.value:g} [{d.basis}] {d.source}" for k, d in mod.P.items()]
    K.write_step(Compound(children=bodies, label=pid), out / f"{pid}.step", desc)
    if extra:
        K.write_step(Compound(children=extra, label=f"{pid} keep-out"), out / f"{pid}_keepout.step",
                     [f"K5 harness: clearance around the {A['title']} (design aid, not a product)"])
    lin, ang = A.get("mesh", (0.25, 0.2))            # finer angular step than k5cad's default: round parts stay round
    K.write_glb(bodies + cosmetic + extra, out / f"{pid}.glb", linear=lin, angular=ang)
    flagged = glb_scan(out / f"{pid}.glb")
    if hasattr(mod, "terminals"):
        write_pins(mod, out)
    meta = part_meta(mod, bodies)
    for c in meta["checks"]:
        tol = f" (within ±{c['tol']:g})" if c.get("tol") else ""
        print(("ok  " if c["ok"] else "BAD ") + f"{c['check']}: model {c['model']} vs drawing {c['drawing']}{tol}")
    if not hasattr(mod, "annotate") and A.get("dims_draw"):
        mod.annotate = lambda S, V: draw_dims(S, V, bodies, mod.P, A["dims_draw"])
    K.auto_drawing(mod, bodies, extra, meta, out / f"{pid}_drawing.svg")
    (out / f"{pid}.params.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    bb = Compound(children=bodies).bounding_box()
    kb = (out / f"{pid}.glb").stat().st_size / 1024
    print(f"{pid}: {bb.size.X:.2f} x {bb.size.Y:.2f} x {bb.size.Z:.2f} mm; GLB {kb:.0f} KB; flagged strings {len(flagged)}")
    bad = [c for c in meta["checks"] if not c["ok"]]
    if bad or flagged or kb > 1024:
        raise SystemExit(f"{len(bad)} checks failed; flagged {flagged}; GLB {kb:.0f} KB")


def main(mod, argv):
    run(mod, argv[1] if len(argv) > 1 else "out")


# ------------------------------------------------------------------------------------------ solids
def rbox(l, w, h, r=0.0, r_top=0.0, align=BASE, at=(0, 0, 0)):
    """Box l (X) x w (Y) x h (Z), vertical edges rounded r, top edges rounded r_top; base on z=0 by default."""
    b = Box(l, w, h, align=align)
    if r > 0:
        b = fillet(b.edges().filter_by(Axis.Z), radius=min(r, l / 2 - 0.01, w / 2 - 0.01))
    if r_top > 0:
        b = fillet(b.edges().group_by(Axis.Z)[-1], radius=min(r_top, h - 0.01))
    return Pos(*at) * b


def cyl(d, h, at=(0, 0, 0), axis="z", align=BASE):
    """Cylinder of diameter d and length h from `at` along +axis ('x', 'y', 'z', or '-x', '-y', '-z')."""
    c = Cylinder(d / 2, h, align=align)
    return Pos(*at) * _turn(axis) * c


def cone(d0, d1, h, at=(0, 0, 0), axis="z"):
    return Pos(*at) * _turn(axis) * Cone(d0 / 2, d1 / 2, h, align=BASE)


def _turn(axis):
    return {"z": Rot(0, 0, 0), "-z": Rot(180, 0, 0), "x": Rot(0, 90, 0), "-x": Rot(0, -90, 0),
            "y": Rot(-90, 0, 0), "-y": Rot(90, 0, 0)}[axis]


def unit(v_):
    n = math.sqrt(sum(c * c for c in v_))
    return tuple(c / n for c in v_)


def rod(p0, p1, d):
    """A round bar from p0 to p1 (a lead, a rod, a link)."""
    from build123d import Vector
    a, b = Vector(*p0), Vector(*p1)
    L = (b - a).length
    c = Cylinder(d / 2, L, align=BASE)
    z = Vector(0, 0, 1)
    dvec = (b - a).normalized()
    ax = z.cross(dvec)
    ang = math.degrees(math.acos(max(-1.0, min(1.0, z.dot(dvec)))))
    if ax.length < 1e-9:
        rot = Rot(0, 0, 0) if ang < 90 else Rot(180, 0, 0)
        return Pos(a.X, a.Y, a.Z) * rot * c
    return Pos(a.X, a.Y, a.Z) * c.rotate(Axis((0, 0, 0), (ax.X, ax.Y, ax.Z)), ang)


def lead(p0, direction, length, d=2.2, bend=None):
    """A flying lead: straight from p0 along direction for length (mm); bend = (length2, direction2) adds a second leg.
    Returns (solid, free_end)."""
    d0 = unit(direction)
    p1 = tuple(p0[i] + d0[i] * length for i in range(3))
    s = rod(p0, p1, d)
    if bend:
        l2, d2 = bend
        d2 = unit(d2)
        p2 = tuple(p1[i] + d2[i] * l2 for i in range(3))
        s = s + rod(p1, p2, d) + Pos(*p1) * Sphere(d / 2)
        p1 = p2
    return s, p1


def blade(at, axis="-z", w=6.35, t=0.81, l=8.0, hole=True):
    """A male quick-connect tab (0.250 x 0.032 in default) standing out of a face from `at` along axis."""
    b = Box(w, t, l, align=BASE)
    if hole:
        b -= Pos(0, 0, l * 0.62) * Cylinder(0.9, t * 3, rotation=(90, 0, 0))
    return Pos(*at) * _turn(axis) * b


def stud(at, d, l, axis="z"):
    return cyl(d, l, at, axis)


def hex_prism(af, h, at=(0, 0, 0), axis="z"):
    from build123d import RegularPolygon
    sk = RegularPolygon(af / math.sqrt(3), 6)
    return Pos(*at) * _turn(axis) * extrude(sk, amount=h)


def dome(d, h, at=(0, 0, 0), axis="z"):
    """A lens cap: a spherical segment of base diameter d and height h standing on `at` along axis."""
    r = (d * d / 4 + h * h) / (2 * h)
    s = Pos(0, 0, h - r) * Sphere(r)
    s = s & Cylinder(d / 2 + 0.01, h, align=BASE)
    return Pos(*at) * _turn(axis) * s


# ------------------------------------------------------------------------------------------ drawing help
def draw_dims(S, V, bodies, P, spec):
    """PART["dims_draw"]: [(view, axis, dim name, offset)] for an overall dimension over the bounding box, or
    (view, p1, p2, dim name, offset) between two points; each line takes its Dim's basis colour."""
    for row in spec:
        if isinstance(row[1], str):
            vw, ax, k, off = row
            dim_bbox(S, V[vw], bodies, ax, P[k], off)
        else:
            vw, p1, p2, k, off = row
            S.dim(V[vw], p1, p2, off, P[k])


def dim_bbox(S, view, bodies, axis, dimv, offset=-8.0):
    """A dimension along one world axis ('x', 'y' or 'z') over the bodies' bounding box, drawn in `view` outside the
    part: offset > 0 puts it above (or right of) the part as the view shows it, < 0 below (or left)."""
    bb = Compound(children=bodies).bounding_box()
    lo, hi = [bb.min.X, bb.min.Y, bb.min.Z], [bb.max.X, bb.max.Y, bb.max.Z]
    i = "xyz".index(axis)
    a = [0.0, 0.0, 0.0]
    a[i] = 1.0
    ru, tw = view.uv(tuple(a))
    horiz = abs(ru) >= abs(tw)
    corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    key = (lambda c: view.uv(c)[1]) if horiz else (lambda c: view.uv(c)[0])
    c = max(corners, key=key) if offset > 0 else min(corners, key=key)
    p1, p2 = list(c), list(c)
    p1[i], p2[i] = lo[i], hi[i]
    return S.dim(view, tuple(p1), tuple(p2), offset, dimv, axis="h" if horiz else "v")
