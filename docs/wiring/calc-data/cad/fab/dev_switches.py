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

from build123d import Axis, Box, Compound, Pos, Sphere

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
            "shape_basis": spec.get("shape_basis", "not sourced"), "viewset": spec.get("viewset", "wall"), "dims_mm": spec["dims_mm"],
            "dims_note": spec["dims_note"], "margin": spec["margin"], "frame": spec["frame"],
            "axes": spec.get("axes", {"mount_normal": "+Z", "maker_up": "+Y", "faces": {}}),
            "photo": spec.get("photo", {}), "photo_short": spec.get("photo_short", ""), "branding": spec.get("branding", []),
            "dims_draw": spec.get("dims_draw", []), "refs": spec["refs"], "drawing_notes": spec.get("notes", []),
            "unknowns": spec.get("unknowns", []), "cross_checks": spec.get("cross_checks", [])}
    f0, stp = spec["face"], spec["step"]
    bpos = spec.get("blade_pos")        # every physical blade (the photo's count); the registry pins take them in order

    def _pin_at(i):
        if bpos:
            return tuple(bpos[min(i, len(bpos) - 1)])
        n = len(pins)
        return (f0[0] + (i - (n - 1) / 2) * stp[0], f0[1] + (i - (n - 1) / 2) * stp[1], f0[2])

    def build():
        parts = [K.body(s, f"{end} {lab}", COLORS[ck][0], finish=fin) for s, lab, ck, fin in spec["body"](P)]
        if spec.get("blades", True):
            tabs = []
            for x, y, z in (bpos or [_pin_at(i) for i in range(len(pins))]):
                tabs.append(D.blade((x, y, z), axis=spec.get("blade_axis", "-z"), w=spec.get("blade_w", 6.35), t=0.8, l=spec.get("blade_l", 7.0)))
            if tabs:
                parts.append(K.body(Compound(children=tabs).fuse(), f"{end} terminals ({len(tabs)})", COLORS.get("tab", ("#c7c2b4", ""))[0],
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


PK56 = "the 0.250 in Packard 56 tab (catalog/families.yaml gm_blade)"
RA = "https://www.rockauto.com"


def photo_scale(photo_short, tab_px):
    """mm per px and the source text for a product photo sized against a face-on Packard 56 tab tab_px wide."""
    k = 6.35 / tab_px
    return k, f"sized off {photo_short} against {PK56}, {tab_px} px wide ({k:.4f} mm/px, ±8%)"


def gm_floor_dimmer(end="FLOOR-DIMMER"):
    """GM 1997037 floor dimmer (SMP DS72, GM Genuine D808, Rostra 650003, Wells 1S4829 on RockAuto's 1977 K5 listing),
    drawn off SMP's DS72 photo: chrome plunger can, cast neck and body, a mounting ear, and a black insulator carrying
    three blades."""
    PH = "SMP DS72 photo (RockAuto)"
    k, SRC = photo_scale(PH, 71)
    A = "not in the photo: assumed"

    def ph(px, note=""):
        return Dim(round(px * k, 1), f"{SRC}: {px} px", "photo", note)
    P = {"can_d": ph(292, "chrome plunger can"), "can_l": ph(324, "along the axis (the photo is 22° off the axis)"),
         "button_d": ph(45, "plunger button in the can's face"), "button_h": Dim(1.5, A, "assumed", "button proud of the face"),
         "neck_l": ph(69, "cast neck between the can and the body"), "neck_d": ph(250, "cast neck"),
         "body_l": ph(345, "cast body under the insulator"), "body_up": ph(194, "cast body top above the can axis"),
         "body_dn": ph(86, "cast body bottom below the can axis"), "depth": Dim(26.1, "the can's diameter (drawn the same)", "design"),
         "ear_l": ph(189, "mounting ear, body to tip"), "ear_w": ph(140, "mounting ear"), "ear_hole": ph(95, "ear hole"),
         "hole_x": ph(59, "hole centre from the body"), "ear_t": Dim(3.0, A, "assumed", "ear thickness"),
         "ins_h": ph(160, "black insulator on the body"), "ins_d": Dim(22.0, A, "assumed", "insulator depth"),
         "blade_l": ph(165, "blade standing out of the insulator"), "blade_w": Dim(6.35, PK56, "vendor", "Packard 56 tab width"),
         "blade_pitch": ph(100, "the two visible blades, along the axis")}
    C = {"can": ("#a3a8a6", f"{PH}: chrome can (k-means, lit face)"), "cast": ("#6e716b", f"{PH}: cast body (k-means, lit face)"),
         "ins": ("#1a1a18", f"{PH}: black insulator (k-means)"), "tab": ("#817246", f"{PH}: brass blades (k-means)"),
         "rivet": ("#7d6d51", f"{PH}: copper rivets on the insulator (k-means)")}
    v = K.v
    R = v(P["can_d"]) / 2
    ZC = v(P["depth"]) / 2                   # the axis sits half the depth off the mounting face
    YA = round(43 * k, 1)                    # the can axis is 43 px above the ear hole in the photo
    xb0 = v(P["hole_x"])                     # the ear hole is x = 0; the cast body starts here
    xb1 = xb0 + v(P["body_l"])
    xn1 = xb1 + v(P["neck_l"])
    xc1 = xn1 + v(P["can_l"])
    ytop = YA + v(P["body_up"])
    y_ins1 = ytop + v(P["ins_h"])
    xm = (xb0 + xb1) / 2
    pit = v(P["blade_pitch"])
    bpos = [(xm - pit / 2, y_ins1, ZC - 5.0), (xm + pit / 2, y_ins1, ZC - 5.0), (xm, y_ins1, ZC + 5.0)]
    ybot = min(YA - R, YA - v(P["body_dn"]), -v(P["ear_w"]) / 2)
    L_ALL = xc1 + v(P["button_h"]) + v(P["ear_l"]) - v(P["hole_x"])
    H_ALL = y_ins1 + v(P["blade_l"]) - ybot

    def body(P):
        ear = Pos(v(P["hole_x"]) - v(P["ear_l"]) / 2, 0, 0) * D.rbox(v(P["ear_l"]), v(P["ear_w"]), v(P["ear_t"]), r=4.0)
        ear -= D.cyl(v(P["ear_hole"]), 10, at=(0, 0, -1))
        cast = Pos(xm, YA + (v(P["body_up"]) - v(P["body_dn"])) / 2, 0) * D.rbox(
            v(P["body_l"]), v(P["body_up"]) + v(P["body_dn"]), v(P["depth"]), r=2.0)
        cast += D.cyl(v(P["neck_d"]), v(P["neck_l"]) + 1.0, at=(xb1 - 0.5, YA, ZC), axis="x")
        cast += ear
        can = D.cyl(v(P["can_d"]), v(P["can_l"]), at=(xn1, YA, ZC), axis="x")
        can -= D.cyl(v(P["button_d"]) + 1.0, 2.0, at=(xc1 - 1.0, YA, ZC), axis="x")
        button = D.cyl(v(P["button_d"]), v(P["button_h"]) + 1.0, at=(xc1 - 1.0, YA, ZC), axis="x")
        ins = Pos(xm, ytop + v(P["ins_h"]) / 2, ZC) * Box(v(P["body_l"]) - 2.0, v(P["ins_h"]), v(P["ins_d"]))
        rivets = Compound(children=[D.cyl(3.2, 0.8, at=(xm + sx * (v(P["body_l"]) / 2 - 5.0), y_ins1, ZC + sz * 7.0), axis="y")
                                    for sx in (-1, 1) for sz in (-1, 1)]).fuse()
        return [(cast, "cast body, neck and mounting ear", "cast", "cast"), (can, "chrome plunger can", "can", "chrome"),
                (button, "plunger button", "can", "chrome"), (ins, "black insulator (3 blades)", "ins", "plastic"),
                (rivets, "insulator rivets", "rivet", "metal")]

    def _can_d(b):
        c = [x for x in b if "plunger can" in x.label][0].bounding_box()
        return c.size.Y

    def _len(b):
        return Compound(children=b).bounding_box().size.X
    return switch_part(end, {
        "title": "GM floor dimmer switch (1997037 pattern, SMP DS72)",
        "what": "Headlamp dimmer switch, factory floor switch (GM 1997037 / 12338706; SMP DS72): feed, LOW and HIGH blades",
        "maker": "GM (factory pattern; SMP DS72 photographed)", "pn": "GM 1997037 (SMP DS72, Wells 1S4829, Rostra 650003)",
        "shape_basis": "scaled from photo", "dims": P, "colors": C, "body": body, "blade_pos": bpos, "blade_axis": "y",
        "blade_l": v(P["blade_l"]), "viewset": "wall",
        "dims_mm": {"l": round(L_ALL, 1), "w": round(v(P["depth"]), 1), "h": round(H_ALL, 1)},
        "checks": [("chrome can diameter", _can_d, v(P["can_d"])), ("overall length, ear tip to button", _len, round(L_ALL, 2))],
        "dims_note": "sized off SMP's DS72 photo against the 0.250 in Packard 56 blade (±8%); the depth and the third blade's "
                     "place are not in the photo",
        "margin": {"mm": 7.0, "why": "photo scale from one blade (±8%); depth assumed"},
        "face": (0, 0, 0), "step": (0, 0), "dir": (0, 1, 0), "kind": "blade (Packard 56)",
        "frame": "origin at the ear hole on the ear's mounting face; +Z out of the mounting face (the switch body), +X along "
                 "the plunger axis toward the button, +Y toward the blades",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"plunger": "+X", "blades": "+Y", "ear": "-X"}},
        "photo": {"url": f"{RA}/info/154/DS-72_Front.jpg", "page": f"{RA}/en/moreinfo.php?pk=43128", "fetched": "2026-09-29"},
        "photo_short": PH,
        "dims_draw": [("front", "x", "can_l", -10)],
        "refs": [("[1]", "SMP DS72", "RockAuto 1977 K5 Blazer dimmer switch listing: SMP DS72 (3 blades, floor mounted, bolt on, "
                                      "cast, gray), GM Genuine D808 (1997037, 12338706), Rostra 650003, Wells 1S4829"),
                 ("[2]", "Packard 56", "catalog/families.yaml gm_blade: 0.250 in tab (the photo's scale)")],
        "cross_checks": ["SMP's spec table lists 3 male blade terminals: the registry lands COMMON, LOW and HIGH on three."],
        "notes": [("Each blade takes one lead: #85+#86 before COMMON (10), #85a+#86a before LOW (12), #85b+#86b+#121 before HIGH "
                   "(11), each joined in a D-609-05 (registry). Which blade is which: read on the switch.", "#10151a")],
        "unknowns": ["The photo shows two of the three blades: the third is drawn behind them (assumed).",
                     "The switch's depth and the ear's thickness are not in the photo.", "Which blade is COMMON, LOW or HIGH."]})


def gm_blower_switch(end="BLOWER-SW"):
    """GM 469368 A/C blower switch (SMP HS435, Four Seasons 37566 on RockAuto's 1977 K5 listing), drawn off Four
    Seasons' 37566 photo: slide-switch case with four blades, the bracket and its two ears, the pivot, the chrome plate
    and the lever. SMP's only size, 'overall width 34.8 mm', has no axis: it is taken as the case across its ears, so
    every size here is assumed (red) and the photo sets the proportions."""
    PH = "Four Seasons 37566 photo (RockAuto)"
    k = 34.8 / 570                              # SMP's 34.8 mm over the case's 570 px (the axis is our assumption)
    A = (f"proportions off {PH}, scaled so the case across its ears is SMP HS435's 'overall width 34.8 mm (1.37 in)' "
         f"({k:.4f} mm/px; SMP names no axis: assumed)")
    X0, Y0 = 711.0, 498.5                       # photo px of the origin: between the two ear holes

    def pa(px, note=""):
        return Dim(round(px * k, 1), f"{A}: {px} px", "assumed", note)
    P = {"case_w": pa(292, "slide-switch case"), "case_h": pa(570, "case across its ears"), "case_d": Dim(18.0, "not in the photo: assumed", "assumed"),
         "ear_pitch": pa(430, "ear hole to ear hole"), "ear_hole": pa(55, "ear holes"), "pivot_d": pa(150, "lever pivot"),
         "lever_l": pa(716, "pivot to lever tip"), "lever_w": pa(60, "lever"), "blade_l": pa(230, "blades out of the case"),
         "blade_w": Dim(4.75, "3/16 in tab: the photo scale makes the blades 4.0 mm, so not the 0.250 in Packard 56 (assumed)", "assumed")}
    C = {"case": ("#9a9c9b", f"{PH}: zinc case (k-means)"), "chrome": ("#c9ccce", f"{PH}: chrome plate and lever"),
         "fibre": ("#b0773f", f"{PH}: brown fibre board between case and blades"), "tab": ("#c47a4f", f"{PH}: copper blades")}
    v = K.v

    def X(px):
        return round((px - X0) * k, 2)

    def Y(py):
        return round(-(py - Y0) * k, 2)
    cx0, cx1, cy0, cy1 = X(258), X(550), Y(183), Y(767)
    CD = v(P["case_d"])
    bpos = [(cx0, Y(y), z) for y in (285, 416) for z in (CD * 0.35, CD * 0.7)]

    def body(P):
        case = Pos((cx0 + cx1) / 2, (cy0 + cy1) / 2, 0) * D.rbox(cx1 - cx0, cy0 - cy1, CD, r=1.0)
        fibre = Pos(cx0 - 0.6, (cy0 + cy1) / 2, CD / 2) * Box(1.2, (cy0 - cy1) * 0.9, CD * 0.9)
        brk = Pos((X(550) + X(830)) / 2, (Y(250) + Y(760)) / 2, 0) * D.rbox(X(830) - X(550), Y(250) - Y(760), 1.2, r=2.0)
        for hx, hy in ((780, 297), (642, 700)):
            brk += Pos(X(hx), Y(hy), 0) * D.rbox(round(130 * k, 1), round(100 * k, 1), 1.2, r=2.5)
            brk -= D.cyl(v(P["ear_hole"]), 4.0, at=(X(hx), Y(hy), -1.0))
        pivot = D.cyl(v(P["pivot_d"]), 3.0, at=(X(825), Y(500), 1.2))
        from build123d import Polyline, make_face, extrude
        tri = extrude(make_face(Polyline([(X(1060), Y(335)), (X(715), Y(1000)), (X(700), Y(420)), (X(1060), Y(335))])), amount=1.0)
        plate = Pos(0, 0, 4.2) * tri
        ang = math.degrees(math.atan2(Y(850) - Y(500), X(1450) - X(825)))
        lever = Pos(X(825), Y(500), 5.2) * Box(v(P["lever_l"]), v(P["lever_w"]), 2.0, align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN)).rotate(Axis.Z, ang)
        paddle = Pos(X(1400), Y(825), 5.2) * Box(round(110 * k, 1), round(80 * k, 1), 2.0, align=(D.Align.CENTER, D.Align.CENTER, D.Align.MIN)).rotate(Axis.Z, ang)
        return [(case, "slide-switch case", "case", "metal"), (fibre, "fibre board at the blades", "fibre", "plastic"),
                (brk + pivot, "bracket, ears and lever pivot", "case", "metal"), (plate + lever + paddle, "chrome plate and lever", "chrome", "chrome")]

    return switch_part(end, {
        "title": "GM A/C blower switch (469368 pattern; Four Seasons 37566, SMP HS435)",
        "what": "Blower switch, factory A/C control head (GM 469368; Four Seasons 37566, SMP HS435): LO, M1, M2 through the "
                "resistor; HI as a PDM30 input",
        "maker": "GM (factory pattern; Four Seasons 37566 photographed)", "pn": "GM 469368 (Four Seasons 37566, SMP HS435)",
        "shape_basis": "not sourced", "dims": P, "colors": C, "body": body, "blade_pos": bpos, "blade_axis": "-x",
        "blade_l": v(P["blade_l"]), "blade_w": v(P["blade_w"]),
        "dims_mm": {"l": round(X(1459) - X(28), 1), "w": round(Y(183) - Y(1000), 1), "h": round(CD, 1)},
        "dims_note": "the photo's proportions at an assumed scale (SMP's 34.8 mm 'overall width' as the case across its ears): ±15%",
        "margin": {"mm": 12.0, "why": "SMP's only size has no axis; the photo sets the proportions"},
        "face": (cx0, 0, 0), "step": (0, 0), "dir": (-1, 0, 0), "kind": "blade (4)",
        "frame": "origin between the two ear holes on the bracket's mounting face (the control head); +Z out of the mounting "
                 "face toward the case, +X from the blades toward the lever, +Y up as the maker's photo shows it",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"blades": "-X", "lever": "+X"}},
        "mounts": [{"n": f"ear_{n_}", "at": [X(hx), Y(hy), 0], "dir": [0, 0, -1], "d": v(P["ear_hole"]), "note": "screw to the control head"}
                   for n_, (hx, hy) in (("upper", (780, 297)), ("lower", (642, 700)))],
        "photo": {"url": f"{RA}/info/52/37566.jpg", "page": f"{RA}/en/moreinfo.php?pk=7579660", "fetched": "2026-09-29"},
        "photo_short": PH,
        "refs": [("[1]", "Four Seasons 37566", "RockAuto 1977 K5 Blazer blower switch listing: Four Seasons 37566 w/ A/C (4 terminals, "
                                                 "rectangular connector; interchange 469368)"),
                 ("[2]", "SMP HS435", "SMP HS435 w/ A/C: 4 blades, metal housing, 4 positions, 'Overall Width (mm) 34.798' (no axis)")],
        "cross_checks": ["Scaled by SMP's 34.8 mm, the photo's blades come out 4.0 mm wide: a 3/16 in tab, not the 0.250 in "
                         "Packard 56 that catalog/families.yaml gm_blade names for the blower switch. Check at the bench."],
        "notes": [("The registry lands five wires (51, 45, BLOWER_BAT, BLOWER_MED, BLOWER_M2) with no cavity names: the pin is the "
                   "blade group. Count the leads when the control head is out (registry).", "#10151a")],
        "unknowns": ["Every size (SMP's width has no axis).", "Which blade takes which wire.", "The blades' width (3/16 or 1/4 in)."]})


def gm_dash_rotary(end, kind):
    if kind != "wiper":
        return gm_blower_switch(end)
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
    """OER 1990096 9-blade GM tilt-column ignition switch (SMP US105 and Rostra 630003 list 1990096 in their
    interchange), drawn off the face-on listing photo: natural body with the connector recess and its 9 blades, the
    zinc bracket with its two slots, and the actuator rod slider."""
    CD = ("reference_documents/web_snapshots/www.camarodepot.ca__oer-1969-2002-chevrolet-pontiac-ignition-switch-tilt-wheel-1990096.md "
          "(the listing gives only a 5 x 2 x 5 in package)")
    PH = "OER 1990096 listing photo (reference_documents/product_images/1990096.jpg)"
    k, SRC = photo_scale(PH, 39)
    A = "not in the photo (face-on): assumed"
    X0, Y0 = 384.5, 52.0                     # photo px of the origin: between the two bracket slots

    def ph(px, note=""):
        return Dim(round(px * k, 1), f"{SRC}: {px} px", "photo", note)
    P = {"body_l": ph(542, "switch body along the column"), "body_h": ph(245, "switch body"),
         "body_d": Dim(25.0, A, "assumed", "body depth off the bracket"), "cap_l": ph(65, "slider end cap"),
         "plate_l": ph(490, "bracket plate"), "plate_h": ph(130, "bracket plate above the body"),
         "plate_t": Dim(1.5, A, "assumed", "bracket steel"), "slot_pitch": ph(375, "the two bracket slots, centre to centre"),
         "slot_l": ph(65, "bracket slot"), "slot_w": ph(25, "bracket slot"), "recess_l": ph(325, "connector recess"),
         "recess_h": ph(160, "connector recess"), "recess_d": Dim(8.0, A, "assumed", "recess depth"),
         "blade_w": Dim(6.35, PK56, "vendor", "Packard 56 tab width"), "blade_l": ph(40, "blade showing in the recess")}
    C = {"body": ("#e6dfcc", f"{PH}: natural body (k-means)"), "zinc": ("#c3c8c6", f"{PH}: zinc bracket"),
         "tab": ("#c47a4f", f"{PH}: copper blades"), "slider": ("#2f7fc0", f"{PH}: blue actuator slider")}
    v = K.v

    def X(px):
        return round((px - X0) * k, 2)

    def Y(py):
        return round(-(py - Y0) * k, 2)
    ZF = v(P["plate_t"]) + v(P["body_d"])    # the connector face
    ZR = ZF - v(P["recess_d"])               # the recess floor, where the blades lie
    rows = [(251, 312), (325, 312), (420, 312), (475, 312), (251, 367), (362, 367), (475, 367), (225, 262), (350, 262)]
    bpos = [(X(x), Y(y) + v(P["blade_l"]) / 2, ZR + 1.0) for x, y in rows]

    def body(P):
        pl = Pos(X(385), Y(70), 0) * D.rbox(v(P["plate_l"]), v(P["plate_h"]), v(P["plate_t"]), r=2.0)
        for sx in (-1, 1):
            pl -= Pos(sx * v(P["slot_pitch"]) / 2, 0, -1) * D.rbox(v(P["slot_l"]), v(P["slot_w"]), 4.0, r=v(P["slot_w"]) / 2 - 0.05)
        tab = Pos(X(80), Y(82), 0) * D.rbox(round(140 * k, 1), round(115 * k, 1), v(P["plate_t"]), r=2.0)
        tab -= D.cyl(round(20 * k, 1), 4.0, at=(X(45), Y(45), -1))
        bx0, bx1 = X(58), X(58) + v(P["body_l"])
        bod = Pos((bx0 + bx1) / 2, Y(135) - v(P["body_h"]) / 2, v(P["plate_t"])) * D.rbox(v(P["body_l"]), v(P["body_h"]), v(P["body_d"]), r=1.5)
        bod += Pos(bx1 + v(P["cap_l"]) / 2 - 0.5, Y(267), v(P["plate_t"])) * D.rbox(v(P["cap_l"]) + 1.0, round(185 * k, 1),
                                                                                    v(P["body_d"]) - 4.0, r=1.5)
        rc = Pos((X(195) + X(520)) / 2, Y(220) - v(P["recess_h"]) / 2 - 0.01, ZR) * Box(v(P["recess_l"]), v(P["recess_h"]) + 0.02,
                                                                                     v(P["recess_d"]) + 1.0, align=D.BASE)
        bod -= rc
        slider = Pos(X(157), Y(300), ZF) * D.rbox(round(55 * k, 1), round(85 * k, 1), 3.0, r=2.0)
        return [(pl + tab, "zinc bracket (two slots to the column)", "zinc", "metal"), (bod, "switch body and connector recess", "body", "plastic"),
                (slider, "actuator rod slider (blue)", "slider", "plastic")]

    def _len(b):
        return [x for x in b if "switch body" in x.label][0].bounding_box().size.X

    L_BODY = v(P["body_l"]) + v(P["cap_l"])
    return switch_part(end, {
        "title": "OER 1990096 ignition switch (GM tilt column, 9 blades)",
        "what": "Ignition switch, OER 1990096 9-blade GM-pattern for the tilt column (interchange of SMP US105, Rostra 630003)",
        "maker": "OER (GM pattern)", "pn": "1990096", "shape_basis": "scaled from photo", "dims": P, "colors": C, "body": body,
        "blade_pos": bpos, "blade_axis": "-y", "blade_l": v(P["blade_l"]),
        "dims_mm": {"l": round(X(665) - X(10), 1), "w": round(ZF, 1), "h": round(Y(5) - Y(380), 1)},
        "dims_note": "sized off the face-on listing photo against the 0.250 in Packard 56 blades (±8%); the body's depth is "
                     "not in the photo",
        "margin": {"mm": 8.0, "why": "photo scale from the blades (±8%); depth assumed"},
        "face": (0, 0, ZR), "step": (0, 0), "dir": (0, -1, 0), "kind": "blade (Packard 56)",
        "frame": "origin between the bracket's two slots on the bracket's back face (on the column); +Z out of the column "
                 "toward the connector face, +X along the column (the slot line), +Y from the body up to the bracket",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"connector": "+Z", "bracket": "+Y"}},
        "mounts": [{"n": f"slot_{s_}", "at": [round(sx * v(P["slot_pitch"]) / 2, 2), 0, 0], "dir": [0, 0, -1],
                    "note": "screw through the bracket slot into the column (slotted for the switch's adjustment)"}
                   for s_, sx in (("L", -1), ("R", 1))],
        "photo": {"url": "reference_documents/product_images/1990096.jpg (camarodepot.ca, fetched 2026-09-28)", "page": CD, "fetched": "2026-09-28"},
        "photo_short": "camarodepot photo 1990096",
        "dims_draw": [("front", "x", "body_l", -10)],
        "checks": [("switch body and end cap along the column", _len, round(L_BODY, 2))],
        "refs": [("[1]", "1990096 photo", "camarodepot.ca OER 1990096 listing photo (face-on; package size only in the text)"),
                 ("[2]", "SMP US105", "RockAuto 1977 K5 Blazer ignition switch listing: SMP US105 w/ tilt (9 blades; interchange "
                                      "1990096), Rostra 630003, Wells 1S6122"),
                 ("[3]", "Packard 56", "catalog/families.yaml gm_blade: 0.250 in tab (the photo's scale)")],
        "cross_checks": ["SMP US105 and Rostra 630003 list 9 male blades, as the photo shows.",
                         "Mating halves (pin table): GM 6294642 (BAT 1 / BAT 2 / IGN 1 / ACC / SOL) and 6294641 (BAT 3 / IGN 3 / GRD 1 / GRD 2)."],
        "notes": [("BAT 2 (IGN_SW_0V), IGN 1 (IGN_RUN_B), SOL (IGN_START); BAT 1 + 2 + 3 are common (registry, switch key on A-1). "
                   "The pins sit on three blades of the top row: which blade is which is read off the booklet's connector view "
                   "or the switch.", "#10151a")],
        "unknowns": ["The body's depth: the photo is face-on.", "Two of the nine blades sit in the upper windows (drawn as the photo "
                     "suggests).", "Which blade carries BAT 2, IGN 1 and SOL."]})


def gm_turn_switch(end="TURN-SW"):
    """GM 1997985 column turn / hazard switch (SMP TW45, Wells 1S1074, Rostra 710002, Shee-Mar SM985 on RockAuto's 1977 K5
    listing), drawn off SMP's TW45 photo at an assumed size: the white C-shaped switch plate around the column, its
    actuator block, the 8-wire harness (Wells: 17.00 in, drawn cut short) and the black column connector."""
    PH = "SMP TW45 photo (RockAuto)"
    A = f"no size in any source: assumed; proportions off {PH}"
    WV = "Wells 1S1074 spec table (RockAuto): 'Wiring Harness Length 17.00 IN', 8 wires, 8 blades"
    P = {"plate_d": Dim(95.0, A, "assumed", "C-shaped switch plate"), "bore_d": Dim(42.0, A, "assumed", "column opening"),
         "plate_t": Dim(18.0, A, "assumed"), "conn_l": Dim(70.0, A, "assumed", "column connector"),
         "conn_w": Dim(14.0, A, "assumed"), "conn_d": Dim(12.0, A, "assumed"),
         "harness_l": Dim(431.8, WV, "vendor", "switch to connector (drawn cut short)"), "shown_l": Dim(60.0, "drawn length of the harness", "design")}
    C = {"plate": ("#e8e2d0", f"{PH}: white switch plate (k-means)"), "block": ("#1c1c1d", f"{PH}: black actuator and connector"),
         "wire": ("#6c7fa6", f"{PH}: the ribbon's blue / white / brown / violet wires (drawn one colour)")}
    v = K.v
    R = v(P["plate_d"]) / 2
    CX, CY = -R - 30.0, 0.0                   # the connector hangs beside the plate on the cut-short harness
    pins = registry_pins(end)
    pitch = v(P["conn_l"]) / 9.0
    bpos = [(CX, CY + (i - 3.5) * pitch, -v(P["conn_d"])) for i in range(8)]

    def body(P):
        from build123d import Cylinder
        plate = D.cyl(v(P["plate_d"]), v(P["plate_t"]), at=(0, 0, -v(P["plate_t"])))
        plate -= D.cyl(v(P["bore_d"]), v(P["plate_t"]) + 2, at=(0, 0, -v(P["plate_t"]) - 1))
        plate -= Pos(-R, 0, -v(P["plate_t"]) / 2) * Box(R * 0.9, v(P["bore_d"]) * 0.8, v(P["plate_t"]) + 2)   # the C's opening
        block = Pos(-R * 0.55, -R * 0.55, -v(P["plate_t"])) * D.rbox(28.0, 22.0, v(P["plate_t"]) + 4.0, r=2.0)
        conn = Pos(CX, CY, -v(P["conn_d"])) * D.rbox(v(P["conn_w"]), v(P["conn_l"]), v(P["conn_d"]), r=1.0)
        return [(plate, "switch plate (white)", "plate", "plastic"), (block + conn, "actuator block and column connector (black)", "block", "plastic")]

    def cosmetic(P):
        lead_, _ = D.lead((-R * 0.8, -R * 0.4, -v(P["plate_t"]) / 2), (-1, 0.1, 0), v(P["shown_l"]), d=9.0)
        return [K.body(lead_, f"{end} 8-wire harness (17.00 in, Wells; cut short)", C["wire"][0], finish="rubber")]
    return switch_part(end, {
        "title": "GM column turn and hazard switch (1997985 pattern; SMP TW45)",
        "what": "Turn and hazard switch, factory column (GM 1997985; SMP TW45): turn and hazard feeds on PDM30 0V, front outputs "
                "to DIG4 / DIG5, at the column connector",
        "maker": "GM (factory pattern; SMP TW45 photographed)", "pn": "GM 1997985 (SMP TW45, Wells 1S1074, Rostra 710002)",
        "shape_basis": "not sourced", "dims": P, "colors": C, "body": body, "cosmetic": cosmetic, "blades": False,
        "blade_pos": bpos,
        "dims_mm": {"l": round(v(P["plate_d"]) + 30.0 + v(P["conn_w"]), 1), "w": round(v(P["plate_d"]), 1), "h": round(v(P["plate_t"]) + 4.0, 1)},
        "dims_note": "no size in any source: SMP's TW45 photo's proportions at an assumed 95 mm plate (±20); the harness is Wells' 17 in",
        "margin": {"mm": 20.0, "why": "no size published; proportions from the maker's photo"},
        "face": (CX, CY, -v(P["conn_d"])), "step": (0, 0), "dir": (0, 0, -1), "kind": "column connector cavity",
        "frame": "origin on the steering column's axis at the switch plate's face; +Z toward the driver; the connector is drawn "
                 "beside the plate on a cut-short harness (it hangs 17 in down the column)",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"connector": "-Z"}},
        "photo": {"url": f"{RA}/info/154/TW-45_Front.jpg", "page": f"{RA}/en/moreinfo.php?pk=43743", "fetched": "2026-09-29"},
        "photo_short": PH,
        "refs": [("[1]", "SMP TW45", "RockAuto 1977 K5 Blazer turn signal switch listing: SMP TW45 (8 blades; interchange 1997985), "
                                      "Wells 1S1074 (8 wires, 17.00 in harness, white / black plastic), Rostra 710002, Shee-Mar SM985"),
                 ("[2]", "no size", "no dimension of the switch on file: assumed")],
        "cross_checks": ["SMP and Wells list 8 terminals at the column connector; the registry uses three cavities (14, 15, 16 + 27)."],
        "notes": [("Cavities are named by the GM circuit printed in each (registry); 17, 18 and 19 stay unused.", "#10151a")],
        "unknowns": ["Every size of the switch and its connector.", "The cavity order on the connector: read the column connector."]})


def gm_column_switch(end, kind):
    if kind == "turn":
        return gm_turn_switch(end)
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


def gm_brake_switch(end="BRAKE-SW"):
    """GM stop lamp switch without cruise (SMP SLS66, Wells 1S5238, Rostra 620014, SKP SKSLS66 on RockAuto's 1977 K5
    listing), drawn off SMP's side-on SLS66 photo: white plunger, threaded barrel with its flat, round black body and
    two blades."""
    PH = "SMP SLS66 photo (RockAuto)"
    k, SRC = photo_scale(PH, 45)             # the kit's male pigtail tab lies flat in the same photo
    SMPI = "SMP instruction sheet GF8592B (RockAuto)"
    A = "not in the photo: assumed"

    def ph(px, note=""):
        return Dim(round(px * k, 1), f"{SRC}: {px} px", "photo", note)
    P = {"plunger_d": ph(85, "white plunger"), "plunger_l": ph(65, "plunger out of the barrel, pedal released off it"),
         "thread_d": ph(142, "threaded barrel, over the threads"), "thread_l": ph(325, "threaded barrel"),
         "flat": Dim(1.5, f"{SMPI}: 'the flat of the threaded bushing' (its depth: assumed)", "assumed", "flat along the barrel"),
         "body_d": ph(183, "round black body"), "body_l": ph(295, "black body"),
         "blade_l": ph(135, "blades out of the body"), "blade_pitch": ph(100, "blade centres"),
         "blade_w": Dim(6.35, PK56, "vendor", "Packard 56 tab width"),
         "free_travel": Dim(1.6, f"{SMPI}: 'allow 1/16 inch free plunger travel ... when the brake pedal is fully released'",
                            "maker", "set at the pedal (installed, not drawn)")}
    C = {"body": ("#23201e", f"{PH}: black body (k-means)"), "plunger": ("#d6d8d7", f"{PH}: white plunger (k-means)"),
         "tab": ("#7e6e51", f"{PH}: brass blades (k-means)")}
    v = K.v
    TL, BL = v(P["thread_l"]), v(P["body_l"])
    ZB = -(TL + BL)                          # the body's back face, where the blades leave
    pit = v(P["blade_pitch"])
    bpos = [(0, pit / 2, ZB), (0, -pit / 2, ZB)]

    def body(P):
        thr = D.cyl(v(P["thread_d"]), TL + 0.5, at=(0, 0, -TL - 0.5))
        thr -= Pos(0, v(P["thread_d"]) / 2 - v(P["flat"]) + 5.0, -TL / 2) * Box(30.0, 10.0, TL + 2.0)
        bod = D.cyl(v(P["body_d"]), BL, at=(0, 0, ZB))
        plunger = D.cyl(v(P["plunger_d"]), v(P["plunger_l"]) + 1.0, at=(0, 0, -1.0))
        return [(thr + bod, "threaded barrel (with its flat) and body", "body", "plastic"),
                (plunger, "plunger (white)", "plunger", "plastic")]

    def _len(b):
        return Compound(children=b).bounding_box().size.Z

    L_ALL = v(P["plunger_l"]) + TL + BL + v(P["blade_l"])
    return switch_part(end, {
        "title": "GM stop lamp switch, no cruise (SMP SLS66)",
        "what": "Brake light switch, factory pattern at the pedal (SMP SLS66, GM 1362835 family): switches 0V (PDM30 A28) into DIG14",
        "maker": "GM (factory pattern; SMP SLS66 photographed)", "pn": "GM 1362835 family (SMP SLS66, Wells 1S5238, Rostra 620014)",
        "shape_basis": "scaled from photo", "dims": P, "colors": C, "body": body, "blade_pos": bpos, "blade_axis": "-z",
        "blade_l": v(P["blade_l"]),
        "dims_mm": {"l": round(v(P["body_d"]), 1), "w": round(v(P["body_d"]), 1), "h": round(L_ALL, 1)},
        "dims_note": "sized off SMP's side-on SLS66 photo against the kit's 0.250 in male tab in the same photo (±8%)",
        "margin": {"mm": 6.0, "why": "photo scale from one tab (±8%)"},
        "face": (0, 0, ZB), "step": (0, 0), "dir": (0, 0, -1), "kind": "blade (Packard 56)",
        "frame": "origin on the switch axis at the plunger end of the threaded barrel; +Z along the axis toward the plunger "
                 "(the pedal arm), the body and blades toward -Z; +Y through the two blades",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"plunger": "+Z", "blades": "-Z"}},
        "mounts": [{"n": "barrel", "at": [0, 0, round(-TL / 2, 2)], "dir": [0, 0, -1], "d": round(v(P["thread_d"]), 2),
                    "note": "the threaded barrel goes through the pedal bracket into the spring locknut, its flat on the "
                            "locknut's finger; set for 1/16 in free plunger travel (SMP GF8592B)"}],
        "photo": {"url": f"{RA}/info/154/SLS-66_Front.jpg", "page": f"{RA}/en/moreinfo.php?pk=44657", "fetched": "2026-09-29"},
        "photo_short": PH,
        "dims_draw": [("front", "z", "thread_l", -10)],
        "checks": [("overall length, plunger to blade tips", _len, round(L_ALL, 2))],
        "refs": [("[1]", "SMP SLS66", "RockAuto 1977 K5 Blazer brake light switch listing: SMP SLS66 w/o cruise (2 blades, push-in, "
                                        "black / white plastic), Wells 1S5238, Rostra 620014 ('w/ 2 Terminals'), SKP SKSLS66"),
                 ("[2]", "GF8592B", "SMP instruction sheet GF8592B: spring locknut, the barrel's flat, 1/16 in free travel"),
                 ("[3]", "Packard 56", "catalog/families.yaml gm_blade: 0.250 in tab (the photo's scale)")],
        "cross_checks": ["SMP's spec table lists 2 male blades: the registry lands 140 (feed) and 17 (output) on two."],
        "notes": [("Feed 140 (BRK_SW_0V) and output 17 (53) plug on as the factory connector 2984235 (registry). The kit's "
                   "pigtails are not drawn.", "#10151a")],
        "unknowns": ["The flat's depth and the blades' face direction are not in the photo.",
                     "Which blade is 140 and which is 17: read on the switch."]})


def gm_jamb_switch(end):
    """GM door jamb pin switch (SMP DS173, Wells 1S1016, Rostra 650024 on RockAuto's 1977 K5 listing), drawn off SMP's
    DS173 photo at an assumed size: plunger with its disc head, threaded body with a hex, and one bullet terminal."""
    left = end.endswith("L")
    PH = "SMP DS173 photo (RockAuto)"
    A = f"no size in any source: assumed; proportions off {PH}"
    P = {"length": Dim(62.0, A, "assumed", "disc head to terminal tip", "fit-critical"),
         "head_d": Dim(12.0, A, "assumed", "plunger disc head"), "plunger_d": Dim(5.0, A, "assumed"),
         "plunger_l": Dim(14.0, A, "assumed", "plunger out of the body at rest"),
         "thread_d": Dim(12.5, A, "assumed", "threaded body"), "thread_l": Dim(14.0, A, "assumed"),
         "hex_af": Dim(15.0, A, "assumed", "hex under the thread"), "hex_t": Dim(4.0, A, "assumed"),
         "stem_d": Dim(7.0, A, "assumed", "stem behind the hex"), "bullet_d": Dim(4.0, A, "assumed", "bullet terminal")}
    C = {"zinc": ("#a9aaa6", f"{PH}: zinc body and hex"), "bronze": ("#8a7a5c", "SMP spec table: 'Color/Finish: Bronze' (the terminal)"),
         "head": ("#b8bab8", f"{PH}: plunger head")}
    v = K.v
    PL, TL, HT = v(P["plunger_l"]), v(P["thread_l"]), v(P["hex_t"])
    stem_l = v(P["length"]) - PL - 1.5 - TL - HT - 9.0 - v(P["bullet_d"]) / 2

    def body(P):
        head = D.cyl(v(P["head_d"]), 1.5, at=(0, 0, PL))
        plunger = D.cyl(v(P["plunger_d"]), PL + 1.0, at=(0, 0, -1.0))
        thread = D.cyl(v(P["thread_d"]), TL, at=(0, 0, -TL))
        hexp = D.hex_prism(v(P["hex_af"]), HT, at=(0, 0, -TL - HT))
        stem = D.cyl(v(P["stem_d"]), stem_l, at=(0, 0, -TL - HT - stem_l))
        bullet = D.cyl(v(P["bullet_d"]), 9.0, at=(0, 0, -TL - HT - stem_l - 9.0))
        bullet = bullet + Pos(0, 0, -TL - HT - stem_l - 9.0) * Sphere(v(P["bullet_d"]) / 2)
        return [(head + plunger, "plunger and disc head", "head", "metal"), (thread + hexp + stem, "threaded body and hex", "zinc", "metal"),
                (bullet, "bullet terminal", "bronze", "metal")]
    return switch_part(end, {
        "title": f"GM door jamb pin switch ({'driver' if left else 'passenger'}; SMP DS173 pattern)",
        "what": f"{'Driver' if left else 'Passenger'} door jamb switch, factory pin switch (GM 1971931 family; SMP DS173): one bullet "
                "terminal, grounds through the body",
        "maker": "GM (factory pattern; SMP DS173 photographed)", "pn": "GM 1971931 family (SMP DS173, Wells 1S1016, Rostra 650024)",
        "shape_basis": "not sourced", "dims": P, "colors": C, "body": body, "blades": False,
        "dims_mm": {"l": v(P["hex_af"]), "w": v(P["hex_af"]), "h": v(P["length"])},
        "checks": [("length, disc head to terminal tip", lambda b: Compound(children=b).bounding_box().size.Z, v(P["length"]))],
        "dims_note": "no size in any source: SMP's DS173 photo's proportions at an assumed 62 mm length (±10)",
        "margin": {"mm": 10.0, "why": "no size published; proportions from the maker's photo"},
        "face": (0, 0, -TL - HT - stem_l - 9.0 - v(P["bullet_d"]) / 2), "step": (0, 0), "dir": (0, 0, -1), "kind": "bullet terminal",
        "frame": "origin on the switch axis at the pillar face (the thread's top); +Z out of the pillar toward the door (the "
                 "plunger), the body inside the pillar",
        "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {"plunger": "+Z", "terminal": "-Z"}},
        "mounts": [{"n": "thread", "at": [0, 0, round(-TL / 2, 2)], "dir": [0, 0, -1], "d": v(P["thread_d"]),
                    "note": "screws into the pillar; grounds through the body (registry)"}],
        "photo": {"url": f"{RA}/info/154/DS-173_Front.jpg", "page": f"{RA}/en/moreinfo.php?pk=43035", "fetched": "2026-09-29"},
        "photo_short": PH,
        "refs": [("[1]", "SMP DS173", "RockAuto 1977 K5 Blazer door jamb switch listing: SMP DS173 front left (1 bullet terminal, "
                                        "bronze), Wells 1S1016 (screw mount, 1 pin terminal), Rostra 650024 ('w/ 1 terminals')"),
                 ("[2]", "no size", "no size in any source: assumed")],
        "cross_checks": ["SMP's spec table lists 1 terminal: the registry lands the courtesy wire and the step tap on one."],
        "notes": [("The pin switch has one terminal; the step tap joins ahead of it (registry).", "#10151a")],
        "unknowns": ["Every size: no maker or vendor publishes one. Measure a switch."]})


def gm_plunger_switch(end, kind):
    """door jamb pin switches, the brake light switch and the tailgate-closed cutout switch."""
    if kind == "brake":
        return gm_brake_switch(end)
    if kind == "jamb":
        return gm_jamb_switch(end)
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
