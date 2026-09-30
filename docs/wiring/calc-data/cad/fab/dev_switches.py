"""Switches, controls and small modules for the K5 device models: the factory GM dash, column and pedal switches, the
Nu-Relics chrome rocker panels, the tailgate switches, the transfer-case switch, the DBW pedal, and the Dakota and PCS
boxes.

Most of the factory switches have no part number or drawing on file: they are drawn at an assumed envelope (basis
'assumed', shape basis 'not sourced') with the manual's or the maker's arrangement, and say so. The terminals come from
the registry: one pin per distinct terminal text on the end (wires that share a terminal share its pin), laid out on the
part's terminal face. Each function returns the part script's namespace.
Frames: origin at the centre of the mounting face, +Z out of it (toward the driver for a dash or panel part).
"""
import math
import sys
from pathlib import Path
from types import SimpleNamespace

from build123d import Axis, Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402


def _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS):
    ns = SimpleNamespace(P=P, COLORS=COLORS, PART=PART, build=build, attach_points=attach_points, terminals=terminals,
                         mount_points=mount_points, CHECKS=CHECKS)
    ns.part_meta = lambda bodies: D.part_meta(ns, bodies)
    return vars(ns)


def registry_pins(end):
    """[(pin text, [wire ids])] in registry order: one pin per distinct terminal text; no text -> one 'leads' pin."""
    out = []
    for t in K.registry()["terminations"]:
        if t["endpoint"] != end:
            continue
        cav = (t.get("cavity") or "").strip() or "leads"
        for row in out:
            if row[0] == cav:
                row[1].append(t["wire"])
                break
        else:
            out.append((cav, [t["wire"]]))
    return out


def switch_part(end, spec):
    """spec: title, what, maker, pn, shape_basis, dims {name: Dim}, colors, body(P) -> [(solid, label, colour key, finish)],
    face (x0, y0, z0) and step (dx, dy) for the terminal row, dir, kind, refs, notes, unknowns, margin, frame, dims_note."""
    P = spec["dims"]
    COLORS = spec["colors"]
    pins = registry_pins(end)
    PART = {"pid": end, "endpoints": [end], "maker": spec["maker"], "pn": spec["pn"], "title": spec["title"], "what": spec["what"],
            "shape_basis": spec.get("shape_basis", "not sourced"), "viewset": "wall", "dims_mm": spec["dims_mm"],
            "dims_note": spec["dims_note"], "margin": spec["margin"], "frame": spec["frame"],
            "axes": spec.get("axes", {"mount_normal": "+Z", "maker_up": "+Y", "faces": {}}),
            "photo": spec.get("photo", {}), "photo_short": spec.get("photo_short", ""), "branding": spec.get("branding", []),
            "dims_draw": spec.get("dims_draw", []), "refs": spec["refs"], "drawing_notes": spec.get("notes", []),
            "unknowns": spec.get("unknowns", [])}
    f0, stp = spec["face"], spec["step"]

    def _pin_at(i):
        n = len(pins)
        return (f0[0] + (i - (n - 1) / 2) * stp[0], f0[1] + (i - (n - 1) / 2) * stp[1], f0[2])

    def build():
        parts = [K.body(s, f"{end} {lab}", COLORS[ck][0], finish=fin) for s, lab, ck, fin in spec["body"](P)]
        if spec.get("blades", True):
            tabs = []
            for i in range(len(pins)):
                x, y, z = _pin_at(i)
                tabs.append(D.blade((x, y, z), axis=spec.get("blade_axis", "-z"), w=spec.get("blade_w", 6.35), t=0.8, l=spec.get("blade_l", 7.0)))
            if tabs:
                parts.append(K.body(Compound(children=tabs).fuse(), f"{end} terminals ({len(pins)})", COLORS.get("tab", ("#c7c2b4", ""))[0],
                                    finish="metal"))
        keep = spec.get("keep", lambda P: [])(P)
        return parts, keep, spec.get("cosmetic", lambda P: [])(P)

    def attach_points():
        if not pins:
            return [{"n": "plug", "ep": end, "at": [round(c, 2) for c in f0], "dir": list(spec["dir"]), "kind": spec.get("kind", "plug"),
                     "note": spec.get("empty_note", "no harness wire lands here (registry)")}]
        return [{"n": f"pin_{i + 1}", "ep": end, "at": [round(c, 2) for c in _pin_at(i)], "dir": list(spec["dir"]),
                 "kind": spec.get("kind", "blade"), "note": f"{cav}: {', '.join(ws)}"} for i, (cav, ws) in enumerate(pins)]

    def terminals():
        if not pins:
            return [{"pin": "plug", "endpoint": end, "name": spec.get("empty_note", "no harness wire lands here"), "kind": spec.get("kind", "plug"),
                     "wires": [], "at": f0, "dir": tuple(spec["dir"])}]
        return [{"pin": f"{i + 1}", "endpoint": end, "name": cav, "kind": spec.get("kind", "blade"), "wires": ws, "at": _pin_at(i),
                 "dir": tuple(spec["dir"])} for i, (cav, ws) in enumerate(pins)]

    def mount_points():
        return spec.get("mounts", [{"n": "mount", "at": [0, 0, 0], "dir": [0, 0, -1], "note": "mounting face"}])

    CHECKS = spec.get("checks", [("drawn at the assumed envelope", lambda b: 1.0, 1.0)])
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


def _A(why):
    return f"no dimension on file for this part ({why}): envelope assumed"


BK78 = "1978 C/K wiring booklet ST-352-78 (via the registry)"
LTSM = "reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf"
FAC = {"body": ("#1d1d1f", "factory switch body: drawn black (no photo on file)"), "metal": ("#b9bcbf", "metal: drawn zinc"),
       "chrome": ("#d3d6d8", "chrome: drawn"), "tab": ("#c7c2b4", "terminals: drawn tin")}
ASSUMED_REFS = [("[1]", "no dimension on file", "not in any source: assumed"), ("[2]", "ST-352-78", "1978 C/K wiring booklet via the registry")]


# ------------------------------------------------------------------------------------------ factory dash / column switches
def gm_headlight_switch(end="HL-SW"):
    A = _A("USA1's 16603 page gives no size")
    P = {"body_w": Dim(64.0, A, "assumed", "switch body"), "body_h": Dim(40.0, A, "assumed"), "body_d": Dim(45.0, A, "assumed"),
         "shaft_d": Dim(6.0, A, "assumed", "knob shaft (push-pull, rotates for the dash dimmer)"), "shaft_l": Dim(55.0, A, "assumed"),
         "knob_d": Dim(32.0, A, "assumed")}
    C = dict(FAC, knob=("#1a1a1b", "knob: black (USA1 photo)"))

    def body(P):
        v = K.v
        b = Pos(0, 0, -v(P["body_d"])) * D.rbox(v(P["body_w"]), v(P["body_h"]), v(P["body_d"]), r=3.0)
        nut = D.cyl(22.0, 4.0, at=(0, 0, 0))
        shaft = D.cyl(v(P["shaft_d"]), v(P["shaft_l"]), at=(0, 0, 0))
        knob = D.cyl(v(P["knob_d"]), 16.0, at=(0, 0, v(P["shaft_l"]) - 16.0))
        return [(b, "switch body", "body", "plastic"), (nut, "bezel nut", "chrome", "chrome"), (shaft, "knob shaft", "metal", "metal"),
                (knob, "knob", "knob", "plastic")]
    return switch_part(end, {
        "title": "USA1 1973-87 headlight switch (factory style)", "what": "Headlight switch, USA1 Industries 1973-87 square-body, factory style (push-pull)",
        "maker": "USA1 Industries", "pn": "16603", "dims": P, "colors": C, "body": body,
        "dims_mm": {"l": 64.0, "w": 40.0, "h": 100.0}, "dims_note": "no size published: a 64 x 40 x 45 body with a push-pull knob, assumed (±15)",
        "margin": {"mm": 15.0, "why": "USA1's page gives no size"}, "face": (0, -20.0, -45.0), "step": (10.0, 0.0), "dir": (0, 0, -1),
        "frame": "origin at the centre of the dash panel's back face at the knob shaft; +Z toward the driver (the knob), body behind",
        "photo": {"url": "https://cdn11.bigcommerce.com/s-5ha9tbdrhc/images/stencil/1280x1280/products/4929/4601/1973-91-Square_body-Chevy-GMC-Truck-Headlight-Switch-USA1-Industries.jpg",
                  "page": "part_media HL-SW", "fetched": "2026-09-29"}, "photo_short": "USA1 photo 16603",
        "refs": ASSUMED_REFS, "notes": [("1 BAT FEED (HL_SW_0V), 6 HEAD LP (HL_SW_HEAD), TAIL LP (HL_SW_PARK): terminal letters read off the "
                                        "switch at the bench (registry).", "#10151a")],
        "unknowns": ["Every dimension: USA1 publishes no size. Terminal positions are drawn in a row (not read)."]})


def gm_floor_dimmer(end="FLOOR-DIMMER"):
    A = _A("the factory floor dimmer has no part number or drawing on file")
    P = {"body_d": Dim(50.0, A, "assumed", "switch body"), "body_h": Dim(40.0, A, "assumed"), "plunger_d": Dim(16.0, A, "assumed"),
         "plunger_l": Dim(22.0, A, "assumed", "foot plunger above the floor"), "flange_w": Dim(76.0, A, "assumed", "mounting flange")}

    def body(P):
        v = K.v
        flange = D.rbox(v(P["flange_w"]), 34.0, 2.0, r=6.0)
        b = D.cyl(v(P["body_d"]), v(P["body_h"]), at=(0, 0, -v(P["body_h"])))
        plunger = D.cyl(v(P["plunger_d"]), v(P["plunger_l"]), at=(0, 0, 2.0))
        conn = Pos(0, 0, -v(P["body_h"]) - 14.0) * Box(30.0, 14.0, 14.0, align=D.BASE)
        return [(flange, "mounting flange", "metal", "metal"), (b + conn, "switch body and 3-way plug", "body", "plastic"),
                (plunger, "foot plunger", "metal", "metal")]
    return switch_part(end, {
        "title": "Factory headlamp floor dimmer switch", "what": "Headlamp dimmer switch, factory floor switch: feed, LOW and HIGH (GM connector 8900855)",
        "maker": "GM (factory)", "pn": "factory (connector 8900855)", "dims": P, "colors": FAC, "body": body,
        "dims_mm": {"l": 76.0, "w": 50.0, "h": 78.0}, "dims_note": "no part number or size on file: envelope assumed (±15)",
        "margin": {"mm": 15.0, "why": "factory part, nothing on file"}, "face": (0, 0, -54.0), "step": (7.0, 0.0), "dir": (0, 0, -1),
        "frame": "origin at the centre of the flange on the floor pan; +Z up into the cab (the plunger), body below the floor",
        "refs": ASSUMED_REFS, "notes": [("Each blade takes one lead: #85+#86 before COMMON (10), #85a+#86a before LOW (12), #85b+#86b+#121 "
                                        "before HIGH (11), each joined in a D-609-05 (registry).", "#10151a")],
        "unknowns": ["Every dimension: factory part with no number on file. Read the switch on the truck."]})


def gm_dash_rotary(end, kind):
    wiper = kind == "wiper"
    A = _A("the factory " + ("wiper/washer" if wiper else "blower") + " switch has no part number or drawing on file")
    P = {"body_w": Dim(50.0, A, "assumed", "switch body"), "body_h": Dim(38.0, A, "assumed"), "body_d": Dim(35.0, A, "assumed"),
         "shaft_l": Dim(30.0, A, "assumed", "control shaft / lever"), "knob_d": Dim(26.0 if wiper else 20.0, A, "assumed")}

    def body(P):
        v = K.v
        b = Pos(0, 0, -v(P["body_d"])) * D.rbox(v(P["body_w"]), v(P["body_h"]), v(P["body_d"]), r=3.0)
        shaft = D.cyl(6.0, v(P["shaft_l"]), at=(0, 0, 0))
        knob = D.cyl(v(P["knob_d"]), 12.0, at=(0, 0, v(P["shaft_l"]) - 12.0))
        return [(b, "switch body", "body", "plastic"), (shaft, "control shaft", "metal", "metal"), (knob, "knob", "body", "plastic")]
    return switch_part(end, {
        "title": "Factory wiper / washer dash switch" if wiper else "Factory Four-Season blower switch (control head)",
        "what": ("Wiper and washer switch, factory grounding type (grounds through its mounting)" if wiper else
                 "Blower switch, factory Four-Season control head: LO, M1, M2 through the resistor; HI as a PDM30 input"),
        "maker": "GM (factory)", "pn": "factory", "dims": P, "colors": FAC, "body": body,
        "dims_mm": {"l": 50.0, "w": 38.0, "h": 65.0}, "dims_note": "no part number or size on file: envelope assumed (±15)",
        "margin": {"mm": 15.0, "why": "factory part, nothing on file"}, "face": (0, -12.0, -35.0), "step": (8.0, 0.0), "dir": (0, 0, -1),
        "frame": "origin at the centre of the switch's mounting face behind the dash (or the control head); +Z toward the driver",
        "refs": ASSUMED_REFS,
        "notes": [(("The motor current returns through the switch body: WIPER_SW_GND lands under a mount screw (registry)." if wiper else
                    "Count the switch's leads when the control head is out (registry)."), "#10151a")],
        "unknowns": ["Every dimension: factory part with no number on file.", "Which cavity carries which wire: read at the bench (registry)."]})


def oer_ignition_switch(end="IGN-SWITCH"):
    CD = ("reference_documents/web_snapshots/www.camarodepot.ca__oer-1969-2002-chevrolet-pontiac-ignition-switch-tilt-wheel-1990096.md "
          "(the listing gives only a 5 x 2 x 5 in package)")
    A = f"no dimension of the switch on file ({CD}): envelope assumed from the GM column-switch pattern"
    P = {"body_l": Dim(70.0, A, "assumed", "switch body along the column"), "body_w": Dim(38.0, A, "assumed"), "body_h": Dim(25.0, A, "assumed"),
         "slider_l": Dim(20.0, A, "assumed", "actuator rod slider"), "screw_pitch": Dim(40.0, A, "assumed", "two screws to the column", "fit-critical, scaled")}

    def body(P):
        v = K.v
        b = D.rbox(v(P["body_l"]), v(P["body_w"]), v(P["body_h"]), r=2.0)
        slider = Pos(-v(P["body_l"]) / 2 + 14.0, 0, v(P["body_h"])) * Box(v(P["slider_l"]), 8.0, 5.0, align=D.BASE)
        return [(b, "switch body (9 blades)", "body", "plastic"), (slider, "actuator rod slider", "metal", "metal")]
    return switch_part(end, {
        "title": "OER 1990096 ignition switch (GM tilt column, 9 blades)", "what": "Ignition switch, OER 1990096 9-blade GM-pattern for the tilt column",
        "maker": "OER (GM pattern)", "pn": "1990096", "dims": P, "colors": dict(FAC, body=("#e6dfcc", "switch body: natural (the listing photo)")),
        "body": body, "dims_mm": {"l": 70.0, "w": 38.0, "h": 30.0},
        "dims_note": "the listing gives only the package (5 x 2 x 5 in): a 70 x 38 x 25 body, assumed (±12)",
        "margin": {"mm": 12.0, "why": "no size published for the switch itself"}, "face": (0, -19.0, 12.0), "step": (7.0, 0.0), "dir": (0, -1, 0),
        "frame": "origin at the centre of the switch's mounting face on top of the steering column jacket; +Z up off the column, +X along the column",
        "photo": {"url": "reference_documents/product_images/1990096.jpg (camarodepot.ca, fetched 2026-09-28)", "page": CD, "fetched": "2026-09-28"},
        "photo_short": "camarodepot photo 1990096", "blade_axis": "-y",
        "refs": [("[1]", "camarodepot", "camarodepot.ca OER 1990096 listing (package size only)"), ("[2]", "no dimension of the switch", "assumed")],
        "notes": [("BAT 2 (IGN_SW_0V), IGN 1 (IGN_RUN_B), SOL (IGN_START); BAT 1 + 2 + 3 are common (registry, switch key on A-1).", "#10151a")],
        "unknowns": ["Every dimension: only the package size is published.", "Factory column connector vs splice: under-dash chapter (registry)."]})


def gm_column_switch(end, kind):
    turn = kind == "turn"
    A = _A("the factory " + ("turn / hazard switch" if turn else "horn button") + " has no part number or drawing on file")
    P = {"d": Dim(110.0 if turn else 60.0, A, "assumed", "switch plate" if turn else "horn button"),
         "t": Dim(18.0 if turn else 12.0, A, "assumed"), "lead_l": Dim(150.0, A, "assumed", "harness to the column connector")}

    def body(P):
        v = K.v
        b = D.cyl(v(P["d"]), v(P["t"]))
        out = [(b, "turn / hazard switch plate" if turn else "horn button (grounds through the column)", "body", "plastic")]
        if turn:
            out.append((Pos(v(P["d"]) / 2 + 20.0, 0, v(P["t"]) / 2) * Box(50.0, 10.0, 8.0), "turn lever stub", "chrome", "chrome"))
        return out
    return switch_part(end, {
        "title": "Factory column turn and hazard switch" if turn else "Factory horn button",
        "what": ("Turn and hazard switch, factory column (column connector): turn and hazard feeds on PDM30 0V, front outputs to DIG4 / DIG5"
                 if turn else "Horn button, factory (grounds through the column) on PDM30 DIG6"),
        "maker": "GM (factory)", "pn": "factory", "dims": P, "colors": FAC, "body": body, "blades": turn,
        "dims_mm": {"l": P["d"].value, "w": P["d"].value, "h": P["t"].value},
        "dims_note": "no part number or size on file: envelope assumed (±20)", "margin": {"mm": 20.0, "why": "factory part, nothing on file"},
        "face": (0, -P["d"].value / 2 - 5.0, 0.0), "step": (8.0, 0.0), "dir": (0, -1, 0), "kind": "column connector cavity",
        "frame": "origin at the centre of the part on the steering column's axis; +Z toward the driver",
        "refs": ASSUMED_REFS, "notes": [("Cavities are named by the GM circuit printed in each (registry).", "#10151a")],
        "unknowns": ["Every dimension: factory part with no number on file.", "Column connector cavities read at the bench (registry)."]})


def gm_plunger_switch(end, kind):
    """door jamb pin switches, the brake light switch and the tailgate-closed cutout switch."""
    spec = {"jamb": ("Factory door jamb switch (pin switch)", "door jamb switch, factory pin switch (grounds through the body)", 19.0, 40.0),
            "brake": ("Factory brake light switch (at the pedal)", "Brake light switch, factory, at the pedal: switches 0V (PDM30 A28) into DIG14",
                      22.0, 55.0),
            "cutout": ("Factory tailgate-closed cutout switch", "Tailgate-closed cutout switch, normally open, GM connector 2977647, in the window UP line",
                       22.0, 50.0)}[kind]
    A = _A(f"the factory {kind} switch has no part number or drawing on file")
    P = {"body_d": Dim(spec[2], A, "assumed", "switch body"), "body_l": Dim(spec[3], A, "assumed"),
         "plunger_l": Dim(14.0, A, "assumed", "plunger out of the body"), "flange_d": Dim(spec[2] + 8.0, A, "assumed", "mounting flange / nut")}

    def body(P):
        v = K.v
        b = D.cyl(v(P["body_d"]), v(P["body_l"]), at=(0, 0, -v(P["body_l"])))
        fl = D.cyl(v(P["flange_d"]), 3.0, at=(0, 0, 0))
        pl = D.cyl(7.0, v(P["plunger_l"]), at=(0, 0, 3.0))
        return [(b, "switch body", "body", "plastic"), (fl, "mounting flange", "metal", "metal"), (pl, "plunger", "metal", "metal")]
    what = spec[1] if kind != "jamb" else f"{'Driver' if end.endswith('L') else 'Passenger'} {spec[1]}"
    return switch_part(end, {
        "title": spec[0] + (f" ({'driver' if end.endswith('L') else 'passenger'})" if kind == "jamb" else ""), "what": what,
        "maker": "GM (factory)", "pn": {"jamb": "factory pin switch (terminal 2984369)", "brake": "factory (connector 2984235)",
                                        "cutout": "factory (connector 2977647)"}[kind], "dims": P, "colors": FAC, "body": body,
        "dims_mm": {"l": P["flange_d"].value, "w": P["flange_d"].value, "h": P["body_l"].value + 17.0},
        "dims_note": "no part number or size on file: envelope assumed (±12)", "margin": {"mm": 12.0, "why": "factory part, nothing on file"},
        "face": (0, 0, -P["body_l"].value), "step": (7.0, 0.0), "dir": (0, 0, -1),
        "frame": "origin at the centre of the mounting flange on the pillar / pedal bracket / tailgate; +Z out toward the plunger's striker",
        "refs": ASSUMED_REFS, "notes": [("Terminals and their wires from the registry; the pin switch has one terminal (a tap joins ahead of it).", "#10151a")],
        "unknowns": ["Every dimension: factory part with no number on file."]})


def gm_key_switch(end):
    rev = end.endswith("REV")
    A = _A("the factory tailgate key switch 8900713 has no drawing on file" + ("; the keyed reversing switch is not picked" if rev else ""))
    P = {"cyl_d": Dim(24.0, A, "assumed", "lock cylinder"), "cyl_l": Dim(30.0, A, "assumed"), "sw_w": Dim(40.0, A, "assumed", "switch body"),
         "sw_h": Dim(30.0, A, "assumed"), "sw_d": Dim(22.0, A, "assumed")}

    def body(P):
        v = K.v
        cyl = D.cyl(v(P["cyl_d"]), v(P["cyl_l"]), at=(0, 0, -v(P["cyl_l"]) + 6.0))
        face = D.cyl(v(P["cyl_d"]) + 8.0, 3.0, at=(0, 0, 0))
        sw = Pos(0, 0, -v(P["cyl_l"]) - v(P["sw_d"]) + 6.0) * D.rbox(v(P["sw_w"]), v(P["sw_h"]), v(P["sw_d"]), r=3.0)
        return [(cyl, "lock cylinder", "metal", "metal"), (face, "cylinder face (chrome)", "chrome", "chrome"), (sw, "switch body", "body", "plastic")]
    return switch_part(end, {
        "title": "Tailgate keyed reversing switch (candidate, not picked)" if rev else "Factory tailgate key switch (8900713)",
        "what": ("Tailgate keyed switch as the second reversing switch in series (candidate; no keyed reversing switch picked): drawn at "
                 "the factory key switch's envelope" if rev else "Tailgate key switch, factory 8900713: FEED switched to CLOSE or OPEN, in "
                 "parallel with the dash switch"),
        "maker": "GM (factory)" if not rev else "not picked", "pn": "8900713" if not rev else "not picked (drawn as 8900713)",
        "dims": P, "colors": FAC, "body": body, "dims_mm": {"l": 40.0, "w": 30.0, "h": 55.0},
        "dims_note": "no drawing on file: envelope assumed (±15)" + ("; the part is not picked" if rev else ""),
        "margin": {"mm": 15.0 if not rev else 25.0, "why": "no drawing on file" + ("; part not picked" if rev else "")},
        "face": (0, -15.0, -52.0 + 6.0), "step": (6.5, 0.0), "dir": (0, 0, -1),
        "frame": "origin at the centre of the cylinder's face on the tailgate outer skin; +Z out of the tailgate, switch inside (-Z)",
        "refs": ASSUMED_REFS, "notes": [("Terminals from the registry (a wire list per terminal).", "#10151a")],
        "unknowns": (["The keyed reversing switch is not picked: its pins are unknown (registry)."] if rev else
                     ["1977-specific key switch drawing not on file (1978 booklet used; same body)."])})


def mck5_dash_switch(end="TG-SW-DASH"):
    MCK = "Motor City K5 MCK5REARWINDOWSWITCH listing (part_media; the page gives only a 2 x 0.5 x 2 in package)"
    A = f"no dimension of the switch on file ({MCK}): envelope assumed"
    P = {"face_w": Dim(38.0, A, "assumed", "switch face"), "face_h": Dim(22.0, A, "assumed"), "body_d": Dim(28.0, A, "assumed")}

    def body(P):
        v = K.v
        face = D.rbox(v(P["face_w"]), v(P["face_h"]), 3.0, r=3.0)
        rocker = Pos(0, 0, 3.0) * D.rbox(v(P["face_w"]) - 10.0, v(P["face_h"]) - 8.0, 6.0, r=2.0)
        b = Pos(0, 0, -v(P["body_d"])) * D.rbox(v(P["face_w"]) - 8.0, v(P["face_h"]) - 4.0, v(P["body_d"]), r=2.0)
        return [(face, "bezel", "chrome", "chrome"), (rocker, "rocker", "body", "plastic"), (b, "switch body (6 blades)", "body", "plastic")]
    return switch_part(end, {
        "title": "Motor City K5 dash tailgate window switch", "what": "Tailgate window switch at the dash, Motor City K5 MCK5REARWINDOWSWITCH, 6 blades (top or bottom 3 used)",
        "maker": "Motor City K5", "pn": "MCK5REARWINDOWSWITCH", "dims": P, "colors": FAC, "body": body,
        "dims_mm": {"l": 38.0, "w": 22.0, "h": 40.0}, "dims_note": "the listing gives only the package: envelope assumed (±10)",
        "margin": {"mm": 10.0, "why": "no size published"}, "face": (0, 0, -28.0), "step": (7.0, 0.0), "dir": (0, 0, -1),
        "frame": "origin at the centre of the bezel's back on the dash; +Z toward the driver",
        "photo": {"url": "https://www.motorcityk5.com/images/F22904.jpg", "page": "part_media TG-SW-DASH", "fetched": "2026-09-29"},
        "photo_short": "Motor City K5 photo", "refs": [("[1]", "Motor City K5", "Motor City K5 listing (package size only)"), ("[2]", "no dimension", "assumed")],
        "notes": [("Loose blade terminals ('will not accept stock harness pigtail'); 3 DOWN, 4 FEED, 5 UP (registry).", "#10151a")],
        "unknowns": ["Every dimension: only the package size is published."]})


NR201 = ("reference_documents/web_snapshots/www.nu-relics.com__201.md (#201 Standard Chrome Switches Double: 'Bezel 2-7/8 x 1-3/4 in, "
         "cutout 2-1/4 x 1-1/4 in')")


def nu_relics_rocker(end, n_switch=2, what=None, title=None, pn="201", picked=True):
    """Nu-Relics standard chrome switch panel: #201 double (the printed bezel and cut-out) or a single (#121)."""
    P = {"bezel_w": Dim(73.0 if n_switch == 2 else 36.5, NR201 if n_switch == 2 else f"{NR201}; a single switch drawn at half the double's width",
                        "maker" if n_switch == 2 else "assumed"),
         "bezel_h": Dim(44.45, NR201, "maker" if picked else "assumed"),
         "cut_w": Dim(57.15 if n_switch == 2 else 28.6, NR201, "maker" if n_switch == 2 and picked else "assumed"),
         "cut_h": Dim(31.75, NR201, "maker" if picked else "assumed"),
         "depth": Dim(38.0, f"{NR201}: the depth behind the panel is not printed", "assumed")}
    C = {"chrome": ("#d7dadc", "Nu-Relics photo (chrome switches)"), "body": ("#1f1f21", "switch body: drawn black"),
         "tab": ("#c7c2b4", "terminals: drawn tin")}

    def body(P):
        v = K.v
        bez = D.rbox(v(P["bezel_w"]), v(P["bezel_h"]), 3.0, r=4.0)
        rockers = [Pos((i - (n_switch - 1) / 2) * (v(P["bezel_w"]) / n_switch), 0, 3.0) * D.rbox(v(P["bezel_w"]) / n_switch - 8.0,
                                                                                               v(P["bezel_h"]) - 12.0, 7.0, r=3.0)
                   for i in range(n_switch)]
        b = Pos(0, 0, -v(P["depth"])) * D.rbox(v(P["cut_w"]) - 1.0, v(P["cut_h"]) - 1.0, v(P["depth"]), r=2.0)
        return [(bez, "chrome bezel", "chrome", "chrome"), (Compound(children=rockers).fuse(), f"rockers ({n_switch})", "chrome", "chrome"),
                (b, "switch bodies", "body", "plastic")]
    return switch_part(end, {
        "title": title or f"Nu-Relics #201 standard chrome switches, double", "what": what or "Nu-Relics chrome reverse-polarity switches",
        "maker": "Nu-Relics", "pn": pn, "dims": P, "colors": C, "body": body, "shape_basis": "datasheet dims" if picked and n_switch == 2 else "not sourced",
        "dims_mm": {"l": P["bezel_w"].value, "w": 44.45, "h": 48.0},
        "dims_note": ("bezel 2-7/8 x 1-3/4 in, cut-out 2-1/4 x 1-1/4 in (Nu-Relics #201); depth assumed" if n_switch == 2 else
                      "a single chrome switch at half the #201 double's width (assumed); depth assumed"),
        "margin": {"mm": 5.0 if picked and n_switch == 2 else 15.0, "why": "bezel and cut-out printed by Nu-Relics; depth assumed"
                   if n_switch == 2 else "the single switch's size is not printed"},
        "face": (0, 0, -38.0), "step": (5.0, 0.0), "dir": (0, 0, -1), "kind": "switch harness lead",
        "frame": "origin at the centre of the bezel's back on the door panel (or dash); +Z toward the occupant, bodies behind",
        "photo": {"url": "https://cdn4.volusion.store/aport-qgqvw/v/vspfiles/photos/201-2.jpg", "page": "https://www.nu-relics.com/201",
                  "fetched": "2026-09-29"}, "photo_short": "Nu-Relics photo #201",
        "refs": [("[1]", "nu-relics.com__201", "Nu-Relics #201 page (bezel, cut-out)"), ("[2]", "not printed", "assumed")],
        "dims_draw": [("front", "x", "bezel_w", -8), ("front", "y", "bezel_h", -8)],
        "notes": [("Nu-Relics harness leads (labelled on the harness): feed, ground, UP / DOWN lines and the motor leads (registry).", "#10151a")],
        "unknowns": ["Depth behind the panel is not printed.", "Switch-plug terminal map: the harness-bag sheet at the bench (registry)."]
                    + ([] if picked else ["The switch is not picked (registry): drawn as a Nu-Relics chrome switch."])})


def torque_king_qu30048(end="TCASE-4WD-SW"):
    TK = "reference_documents/web_snapshots/torqueking.com__qu30048-weather-proof-np205c-transfer-case-indicator-switch.md"
    PH = "sized off Torque King's photos (reference_documents/product_images/QU30048_side.jpg) against the printed 15/16 in hex"
    P = {"hex": Dim(23.8, f"{TK}: 'The 15/16\" hex head'"),
         "torque": Dim(21.7, f"{TK}: 'Maximum torque is 16 lb.ft.' (21.7 Nm; not a size)"),
         "thread_d": Dim(15.9, PH, "photo", "thread into the NP205 poppet port"), "thread_l": Dim(12.0, PH, "photo"),
         "body_l": Dim(28.0, PH, "photo", "switch body above the hex"), "body_d": Dim(20.0, PH, "photo"),
         "plunger_l": Dim(8.0, PH, "photo", "plunger below the thread")}
    C = {"body": ("#d9c9a0", "Torque King photo QU30048_side.jpg (the sealed connector boot, tan)"),
         "metal": ("#c9ccd0", "Torque King photo QU30048_side.jpg (zinc-plated hex, body and thread)"),
         "tab": ("#c7c2b4", "pins: drawn tin")}

    def body(P):
        v = K.v
        hx = D.hex_prism(v(P["hex"]), 10.0, at=(0, 0, 0))
        th = D.cyl(v(P["thread_d"]), v(P["thread_l"]), at=(0, 0, -v(P["thread_l"])))
        pl = D.cyl(8.0, v(P["plunger_l"]), at=(0, 0, -v(P["thread_l"]) - v(P["plunger_l"])))
        b = D.cyl(v(P["body_d"]), v(P["body_l"]), at=(0, 0, 10.0))
        return [(hx + th, "hex (15/16 in) and thread", "metal", "metal"), (pl, "plunger", "metal", "metal"),
                (b, "sealed body (twin-pin connector)", "body", "plastic")]
    return switch_part(end, {
        "title": "Torque King QU30048 NP205 4WD indicator switch", "what": "4WD indicator switch, Torque King QU30048 weather-proof NP205 "
        "(normally ON, in a front-output poppet port; 15/16 hex, 16 lb-ft max) with the QU90002 pigtail", "maker": "Torque King", "pn": "QU30048",
        "shape_basis": "scaled from photo", "dims": P, "colors": C, "body": body, "blades": False,
        "dims_mm": {"l": 23.8, "w": 23.8, "h": 58.0}, "dims_note": "15/16 in hex (Torque King); thread, body and plunger sized off its photo (±4)",
        "margin": {"mm": 4.0, "why": "only the hex is printed; the rest sized off Torque King's photos"},
        "face": (0, 0, 10.0 + 28.0), "step": (4.0, 0.0), "dir": (0, 0, 1), "kind": "twin-pin sealed connector (QU90002 pigtail)",
        "frame": "origin on the switch's axis at the hex's seat on the transfer case; +Z out of the case, thread and plunger into it (-Z)",
        "photo": {"url": "https://torqueking.com/cdn/shop/files/qu30048__08146_8788__76476.1707875361.1280.1280.jpg",
                  "page": "https://torqueking.com/products/qu30048", "fetched": "2026-09-29"}, "photo_short": "Torque King photo QU30048",
        "refs": [("[1]", "torqueking.com__qu30048", "Torque King QU30048 page (15/16 hex, 16 lb-ft)"), ("[2]", "sized off Torque King", "sized off the photos")],
        "notes": [("Closed in 4WD (confirm with an ohmmeter); #55 and TCASE_SW_GND on the QU90002 pigtail (registry).", "#10151a")],
        "unknowns": ["Thread size: sized off the photo (the NP205 poppet port is to be confirmed on this 1977 case, registry)."]})


def gm_dbw_pedal(end="APS"):
    A = "the pedal listing (eBay) and GM give no size: a GM Gen III truck DBW pedal envelope, assumed"
    P = {"arm_l": Dim(300.0, A, "assumed", "pedal arm, pivot to the pad"), "pad_w": Dim(70.0, A, "assumed"), "pad_h": Dim(50.0, A, "assumed"),
         "housing_w": Dim(90.0, A, "assumed", "pivot housing with the sensor"), "housing_h": Dim(80.0, A, "assumed"), "housing_d": Dim(60.0, A, "assumed"),
         "bracket_w": Dim(110.0, A, "assumed", "firewall bracket")}
    C = {"body": ("#1d1d1f", "pedal: black (eBay listing photo)"), "metal": ("#2a2b2c", "arm: black steel"), "tab": ("#c7c2b4", "pins: tin")}

    def body(P):
        v = K.v
        br = D.rbox(v(P["bracket_w"]), 90.0, 4.0, r=6.0)
        hs = Pos(0, 0, 4.0) * D.rbox(v(P["housing_w"]), v(P["housing_h"]), v(P["housing_d"]), r=6.0)
        arm = Pos(0, -v(P["housing_h"]) / 2 + 10.0, 30.0) * Box(18.0, v(P["arm_l"]), 10.0, align=(D.Align.CENTER, D.Align.MAX, D.Align.CENTER)).rotate(Axis.X, 20.0)
        pad = Pos(0, -v(P["arm_l"]) * math.cos(math.radians(20.0)) - 30.0, 30.0 + v(P["arm_l"]) * math.sin(math.radians(20.0))) * D.rbox(
            v(P["pad_w"]), v(P["pad_h"]), 8.0, r=6.0, align=D.CEN)
        plug = Pos(v(P["housing_w"]) / 2 + 8.0, 10.0, 34.0) * Box(16.0, 30.0, 20.0)
        return [(br + hs, "firewall bracket and sensor housing", "body", "plastic"), (arm, "pedal arm", "metal", "paint"),
                (pad, "pedal pad", "body", "rubber"), (plug, "9-cavity plug (6 wired)", "body", "plastic")]
    return switch_part(end, {
        "title": "DBW accelerator pedal (GM Gen III truck, OE 15751307 family)", "what": "Accelerator pedal, drive-by-wire: GM Gen III truck pedal "
        "(OE 15751307 family), 9-cavity plug with 6 wired, ICT WPAPP30 pigtail", "maker": "GM (aftermarket kit)", "pn": "OE 15751307 family",
        "dims": P, "colors": C, "body": body, "blades": False, "dims_mm": {"l": 110.0, "w": 330.0, "h": 150.0},
        "dims_note": "no size on file for the pedal: envelope assumed (±30)", "margin": {"mm": 30.0, "why": "no printed size"},
        "face": (P["housing_w"].value / 2 + 16.0, 10.0, 34.0), "step": (0.0, 3.5), "dir": (1, 0, 0), "kind": "WPAPP30 pigtail lead (MiniSeal splice)",
        "frame": "origin at the centre of the pedal bracket on the firewall (driver footwell); +Z out of the firewall into the cab, +Y up",
        "photo": {"url": "https://i.ebayimg.com/images/g/zycAAOSwI2lmXXQv/s-l1600.jpg", "page": "part_media APS", "fetched": "2026-09-29"},
        "photo_short": "eBay listing photo (DBW pedal)",
        "refs": [("[1]", "the pedal listing", "not in any source: assumed")],
        "notes": [("Cavities G, F, E (track 1: 5 V, signal, low ref) and D, C, B (track 2); meter the pedal before crimping (registry).", "#10151a")],
        "unknowns": ["Every dimension: no printed size.", "Cavity letters read off the WPAPP30 plug (registry)."]})


def box_module(end, spec):
    """Dakota VHX control box, GSS-3000 decoder, PCS TCM-2650: a box with a terminal strip or plug."""
    P = spec["dims"]
    C = {"body": ("#1d1d1f", spec.get("col_src", "housing: black plastic (Dakota: 'black plastic housing')")),
         "strip": ("#2f7a3a", "screw-terminal strip: drawn green") if spec.get("strip") else ("#262628", "plug: black"),
         "tab": ("#c9ccd0", "screws: zinc")}

    def body(P):
        v = K.v
        b = D.rbox(v(P["l"]), v(P["w"]), v(P["h"]), r=3.0)
        strip = Pos(0, -v(P["w"]) / 2 - 5.0, v(P["h"]) / 2) * Box(v(P["l"]) - 10.0, 10.0, v(P["h"]) * 0.7)
        return [(b, "housing", "body", "plastic"), (strip, "screw-terminal strip" if spec.get("strip") else "plug", "strip", "plastic")]
    n = max(1, len(registry_pins(end)))
    return switch_part(end, {
        "title": spec["title"], "what": spec["what"], "maker": spec["maker"], "pn": spec["pn"], "dims": P, "colors": C, "body": body,
        "blades": False, "shape_basis": spec.get("shape_basis", "not sourced"),
        "dims_mm": {"l": P["l"].value, "w": P["w"].value, "h": P["h"].value}, "dims_note": spec["dims_note"], "margin": spec["margin"],
        "face": (0, -P["w"].value / 2 - 10.0, P["h"].value / 2), "step": ((P["l"].value - 16.0) / max(n, 1), 0.0), "dir": (0, -1, 0),
        "kind": spec.get("kind", "screw terminal"),
        "frame": "origin at the centre of the housing's mounting face; +Z out of it, the terminal side faces -Y",
        "photo": spec.get("photo", {}), "photo_short": spec.get("photo_short", ""), "refs": spec["refs"], "notes": spec.get("notes", []),
        "dims_draw": [("front", "x", "l", -10), ("front", "y", "w", -10)], "unknowns": spec.get("unknowns", []),
        "empty_note": spec.get("empty_note", "no harness wire lands here (registry)")})


RECON = ("docs/wiring/research/2026-06-09_design-inputs-recon.md: 'control box 5.5x3.5x1 in' from dakotadigital.com/img/dVHX-73C-PU.png "
         "(Dakota's own image; the site refused a scripted read on 2026-09-29, so it is relayed, not re-read)")


def dakota_vhx(end="DAKOTA-VHX"):
    P = {"l": Dim(139.7, RECON), "w": Dim(88.9, RECON), "h": Dim(25.4, RECON)}
    return box_module(end, {"title": "Dakota Digital VHX control box", "what": "Gauge control box, Dakota Digital VHX (for the VHX-73C-PU cluster)",
                            "maker": "Dakota Digital", "pn": "VHX control box (VHX-73C-PU)", "dims": P, "strip": True, "shape_basis": "datasheet dims",
                            "dims_note": "5.5 x 3.5 x 1 in (Dakota's image, relayed by the recon doc); 22 screw terminals on one edge (drawn)",
                            "margin": {"mm": 5.0, "why": "the envelope is Dakota's, relayed; the terminal strip's layout is drawn, not read"},
                            "photo": {"url": "https://static.summitracing.com/global/images/prod/xlarge/dak-vhx-73c-pu_xl.jpg", "page": "part_media DAKOTA-VHX",
                                      "fetched": "2026-09-29"}, "photo_short": "Summit photo VHX-73C-PU (family)",
                            "refs": [("[1]", "design-inputs-recon", "the recon doc, relaying Dakota's dVHX-73C-PU image")],
                            "notes": [("Every input lands on the control box's screw terminals (DAKOTA_VHX_ARCHITECTURE.md); the VHX harness "
                                       "joins by splice (registry).", "#10151a")],
                            "unknowns": ["Terminal order along the strip: read the box (drawn in the registry's order)."]})


def dakota_gss3000(end="GSS-3000"):
    A = "Dakota Digital's GSS-3000 manual on file gives no decoder size: envelope assumed"
    P = {"l": Dim(100.0, A, "assumed"), "w": Dim(60.0, A, "assumed"), "h": Dim(25.0, A, "assumed")}
    return box_module(end, {"title": "Dakota Digital GSS-3000 gear shift sender (decoder)", "what": "Gear shift sender decoder, Dakota Digital GSS-3000 "
                            "(its sensor on the transmission detent shaft, 10 ft cable)", "maker": "Dakota Digital", "pn": "GSS-3000",
                            "dims": P, "strip": True, "dims_note": "no size in the manual: a 100 x 60 x 25 decoder, assumed (±20)",
                            "margin": {"mm": 20.0, "why": "no printed size"},
                            "photo": {"url": "https://static.summitracing.com/global/images/prod/xlarge/dak-gss-3000_xl.jpg", "page": "part_media GSS-3000",
                                      "fetched": "2026-09-29"}, "photo_short": "Summit photo GSS-3000",
                            "refs": [("[1]", "GSS-3000 manual", "reference_documents/component_drawings/Dakota_GSS-3000_Manual.pdf (no size)")],
                            "notes": [("1-WIRE to the VHX GEAR input; IGNITION+, GROUND-, and the sensor's RED / GREEN / BLACK (registry).", "#10151a")],
                            "unknowns": ["Every dimension: no printed size. The sensor on the transmission is not drawn here."]})


def pcs_tcm2650(end="PCS-TCM"):
    A = "PCS's TCM-2650 pages and the ZGP setup guide rev2 on file give no case size (layout-ui TODO): envelope assumed"
    P = {"l": Dim(165.0, A, "assumed"), "w": Dim(115.0, A, "assumed"), "h": Dim(40.0, A, "assumed")}
    return box_module(end, {"title": "PCS TCM-2650 transmission controller", "what": "Transmission controller, PCS TCM-2650 (the TCM-4610 kit harness "
                            "plugs into it)", "maker": "Powertrain Control Solutions", "pn": "TCM-2650", "dims": P, "strip": False,
                            "col_src": "housing: black anodised (ZGP photo)", "dims_note": "no size on file: a 165 x 115 x 40 box, assumed (±30)",
                            "margin": {"mm": 30.0, "why": "no printed size"}, "kind": "TCM plug (kit harness)",
                            "empty_note": "the TCM-4610 kit harness plugs in here; none of our wires land on the TCM (registry)",
                            "photo": {"url": "https://www.zerogravityperformance.com/wp-content/uploads/2017/02/tcm2650_hanress.jpg",
                                      "page": "part_media PCS-TCM", "fetched": "2026-09-29"}, "photo_short": "ZGP photo TCM-2650",
                            "refs": [("[1]", "setup guide", "reference_documents/component_drawings/PCS_TCM-2650_ZGP_6speed_setup_configurable_tuning_rev2.pdf (no size)")],
                            "notes": [("TCM plug and pin numbers: awaiting the ZGP harness drawing (registry).", "#10151a")],
                            "unknowns": ["Every dimension: no printed size; the spot under the dash is open."]})
