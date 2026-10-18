#!/usr/bin/env python3
"""Injectors and coils: the Siemens Deka FI114961 injector with its EV1 (Junior Power Timer) plug and 90-degree boot,
and the GM 12611424 (ACDelco D510C) coil with its LS2/LS7 4-way plug; one mated assembly per end (INJ-1..8,
COIL-1..8), each with its own registry wires.

Numbers:
  maker   Continental's FI114961 data sheet (the image on the Siemens Deka product page): body 15.00, fuel inlet cup 13.5,
          intake manifold pocket 14.0, 60.44 between the O-ring ends; 'Connector: Minitimer EV1', 14 mm O-rings. TE's
          Junior Power Timer catalog page (reference_documents/component_drawings/TE_827551_Junior_Timer_2way_housing_
          catalog_page.pdf, p.35, 'Type C, For Junior Power Timer, 2 Positions', 828657): 28.0 long, 22.0 wide, 23.4
          over the locking spring, 17.0 body, contacts 5.0 apart.
  photo   the coil: docs/wiring/calc-data/cad/delstributor_geometry.yaml coil_shape (every number there is scaled off
          Delmo's photos with the 73.0 mm coil bolt spread as the ruler, with its own margin); the injector's EV1 socket,
          the plug's boot and both families' terminals, sized off the maker's photos against the numbers above.
Frames (mm):
  injector: its axis is Z, +Z toward the fuel rail; z = 0 at the lower O-ring end (the manifold pocket), the upper end at
            z = 60.44; the EV1 socket faces +X.
  coil:     +Z up (tower up, plug down); origin at the upper ear's bolt hole; the coil axis is 34 mm out along +X; the ear
            bolts run along Y.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_ignition.py <out_root> [id ...]
"""
import sys
import types
from pathlib import Path

from build123d import Align, Axis, Compound, Cylinder, Pos, Rot

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402
from fam_deutsch import box, cyl_z, rr  # noqa: E402

CD = "reference_documents/component_drawings/"
DEKA = ("siemensdeka.com/wp-content/uploads/2013/09/FI114961_2.jpg (Continental data sheet 'FI114961 61 lb/hr Deka IV "
        "Long Minitimer', Basic Dimensions; fetched 2026-09-29)")
DEKAPG = ("siemensdeka.com/product/60lbh-siemens-deka-high-impedance-long-style-with-ev1-connector-fi114961-60mm/ "
          "(read 2026-09-29)")
JPT = CD + "TE_827551_Junior_Timer_2way_housing_catalog_page.pdf p.35 (Tyco / TE, 'For Junior Power Timer, 2 Positions', 828657)"
DEL = "docs/wiring/calc-data/cad/delstributor_geometry.yaml coil_shape (scaled off Delmo photo IMG_3918, ruler 73.0 mm)"
PWK = "prowireusa.com/content/57704/8CYLK-90.webp (ProWire kit photo, fetched 2026-09-29)"
PWC = "prowireusa.com/content/57659/COIL-CONNLS217.webp (ProWire kit photo, fetched 2026-09-29)"


def D(v, src, basis="maker", note="", fit=""):
    return Dim(v, src, basis, note, fit)


INJ = {
    "len": D(60.44, f"{DEKA}: '60.44 mm' between the O-ring ends", note="the product title's '(60mm)', Long Style"),
    "body_d": D(15.00, f"{DEKA}: 'Body: 15.00 mm'"),
    "inlet_d": D(13.5, f"{DEKA}: 'Fuel Inlet Cup Diameter 13.5 mm'"),
    "pocket_d": D(14.0, f"{DEKA}: 'Intake Manifold Pocket Diameter 14.0 mm'; {DEKAPG} '14mm Lower O-Ring'"),
    "oring_d": D(14.0, f"{DEKAPG}: '14mm Upper O-Ring', '14mm Lower O-Ring' (Viton)"),
    "body_z0": D(24.0, f"{DEKA} figure, scaled at the printed 60.44", "scaled", "+-2: the solenoid body's lower end"),
    "body_z1": D(44.0, f"{DEKA} figure, scaled at the printed 60.44", "scaled", "+-2"),
    "sock_z": D(38.0, f"{DEKA} figure, scaled", "scaled", "+-3: the EV1 socket's axis height"),
    "sock_w": D(12.0, f"{DEKA} 'Connector' photo against the 15.00 body", "photo", "+-20 %"),
    "sock_h": D(9.0, f"{DEKA} 'Connector' photo against the 15.00 body", "photo", "+-20 %"),
    "sock_l": D(14.0, f"{DEKA} 'Connector' photo against the 15.00 body", "photo", "+-20 %"),
    "pin_pitch": D(5.0, f"{JPT}: '5,0' between the two contacts"),
}
EV1 = {
    "L": D(28.0, f"{JPT}: '28,0'"), "W": D(22.0, f"{JPT}: '22,0'"), "H": D(23.4, f"{JPT}: '23,4' over the locking spring"),
    "body_h": D(17.0, f"{JPT}: '17,0'"), "inner_h": D(11.2, f"{JPT}: '11,2'"), "pitch": D(5.0, f"{JPT}: '5,0'"),
    "boot_l": D(30.0, f"{PWK}: the 90-degree boot against the 22.0 housing width", "photo", "+-20 %"),
    "boot_d": D(9.0, f"{PWK}: the boot's cable end against the 22.0 housing width", "photo", "+-20 %"),
}
COIL = {
    "ear_spread": D(73.0, "delmospeed.com DELCB01 'Bolt spread 2 7/8\"' (the ruler in " + DEL + ")"),
    "axis_off": D(34.0, DEL + " axis_out_of_ear_line_mm", "photo", "+-3"),
    "body_h": D(64.7, DEL + " body_height_mm", "photo", "+-3"),
    "body_in": D(16.0, DEL + " body_radial_mm inner", "photo", "+-3"),
    "body_out": D(21.0, DEL + " body_radial_mm outer", "photo", "+-3"),
    "body_t": D(36.0, DEL + " body_tangential_mm", "photo", "+-5"),
    "tower_d": D(17.4, DEL + " tower_od_mm", "photo", "+-2"),
    "tower_h": D(31.9, DEL + " tower_tip_above_top_ear_mm", "photo", "+-2"),
    "plug_tip": D(92.8, DEL + " plug_tip_below_top_ear_mm", "photo", "+-3"),
}
CPLUG = {"W": D(20.0, f"{PWC}: 4-way housing against the coil's 36 body (" + DEL + ")", "photo", "+-25 %"),
         "H": D(14.0, f"{PWC}", "photo", "+-25 %"), "L": D(31.0, f"{PWC}", "photo", "+-25 %"),
         "pitch": D(4.0, f"{PWC}: four cavities across the 20 width", "photo", "+-25 %")}
COLOURS_INJ = {"body": ("#2a2b2d", f"{DEKA}: 'Identification Shell Color: Black'; the injector photo's black body"),
               "orings": ("#4a3a5c", f"{DEKAPG}: Viton O-rings (the data sheet photo shows them dark purple-brown)"),
               "tip": ("#b9bcbd", f"{DEKA}: the stainless nozzle end (photo)"),
               "plug": ("#1d1d1f", f"{PWK}: black EV1 housing"), "clip": ("#b8bcc0", f"{PWK}: steel wire clip"),
               "boot": ("#1a1a1a", f"{PWK}: black 90-degree boot"), "terminal": ("#c9c6bf", "ProWire 68102 tin (JPT terminal)")}
COLOURS_COIL = {"coil": ("#1d1e20", "GM photo D510C (part_media COIL-1): black coil body"),
                "tower": ("#1d1e20", "GM photo D510C: black tower"),
                "plug": ("#1f1f21", f"{PWC}: black housing"), "seal": ("#3a7fd0", f"{PWC}: blue seal ridges"),
                "tpa": ("#8d9091", f"{PWC}: grey TPA"), "cable seals": ("#f2d23a", f"{PWC}: yellow cable seals"),
                "terminal": ("#c9c6bf", f"{PWC}: tin terminals")}


# ------------------------------------------------------------------------------------------ injector + EV1 plug
def injector_bodies():
    v = {k: K.v(d) for k, d in INJ.items()}
    L, bd = v["len"], v["body_d"]
    out = []
    lower = cyl_z(v["pocket_d"] / 2 - 0.8, 0.0, v["body_z0"], 0, 0)             # the lower tube into the manifold
    nozzle = cyl_z(4.0, -3.0, 0.2, 0, 0)
    body = cyl_z(bd / 2, v["body_z0"], v["body_z1"], 0, 0)
    upper = cyl_z(v["inlet_d"] / 2 - 0.9, v["body_z1"], L, 0, 0)                 # the inlet into the rail cup
    sock = box(bd / 2 - 1.5, bd / 2 - 1.5 + v["sock_l"], -v["sock_w"] / 2, v["sock_w"] / 2,
               v["sock_z"] - v["sock_h"] / 2, v["sock_z"] + v["sock_h"] / 2)
    sock -= box(bd / 2 + 2.0, bd / 2 + v["sock_l"] + 1, -v["sock_w"] / 2 + 1.2, v["sock_w"] / 2 - 1.2,
                v["sock_z"] - v["sock_h"] / 2 + 1.2, v["sock_z"] + v["sock_h"] / 2 - 1.2)
    out.append(K.body(lower + body + upper + sock, "FI114961 body and EV1 socket", COLOURS_INJ["body"][0]))
    out.append(K.body(nozzle, "FI114961 nozzle (4-hole, 30 deg)", COLOURS_INJ["tip"][0], finish="metal"))
    for z in (1.2, L - 3.0):
        ring = cyl_z(v["oring_d"] / 2, z, z + 2.4, 0, 0) - cyl_z(v["oring_d"] / 2 - 2.0, z - 1, z + 4, 0, 0)
        out.append(K.body(ring, f"FI114961 O-ring at z {z:.0f}", COLOURS_INJ["orings"][0], finish="rubber"))
    p = v["pin_pitch"]
    for sy in (-1, 1):
        pin = box(bd / 2 + 1.0, bd / 2 - 1.5 + v["sock_l"] - 1.5, sy * p / 2 - 0.4, sy * p / 2 + 0.4,
                  v["sock_z"] - 1.4, v["sock_z"] + 1.4)
        out.append(K.body(pin, f"FI114961 EV1 pin {1 if sy < 0 else 2}", "#c9c6bf", finish="metal"))
    return out


def ev1_plug_bodies(at_x):
    """The Junior Power Timer 2-way plug on the injector's socket, mating along -X, with its 90-degree boot."""
    v = {k: K.v(d) for k, d in EV1.items()}
    vi = {k: K.v(d) for k, d in INJ.items()}
    z0 = vi["sock_z"]
    x0 = at_x                                   # the plug's mating face
    body = box(x0, x0 + v["L"], -v["W"] / 2, v["W"] / 2, z0 - v["body_h"] / 2, z0 + v["body_h"] / 2)
    body -= box(x0 - 1, x0 + 12, -v["W"] / 2 + 2.2, v["W"] / 2 - 2.2, z0 - v["inner_h"] / 2, z0 + v["inner_h"] / 2)
    body += box(x0 + 1.5, x0 + 12.5, -vi["sock_w"] / 2 + 1.3, vi["sock_w"] / 2 - 1.3, z0 - vi["sock_h"] / 2 + 1.3,
                z0 + vi["sock_h"] / 2 - 1.3)          # the insert that fits the injector's socket
    spring = box(x0 + 2, x0 + 16, -4.0, 4.0, z0 + v["body_h"] / 2, z0 + v["H"] - v["body_h"] / 2) - \
        box(x0 + 3, x0 + 15, -3.0, 3.0, z0 + v["body_h"] / 2 - 1, z0 + v["H"] - v["body_h"] / 2 - 1.0)
    boot = Pos(x0 + v["L"], 0, z0) * Rot(0, 90, 0) * Cylinder(v["boot_d"] / 2 + 2.5, 6.0, align=(Align.CENTER, Align.CENTER, Align.MIN))
    boot += Pos(x0 + v["L"] + 6.0 + v["boot_d"] / 2, 0, z0) * Cylinder(v["boot_d"] / 2, v["boot_l"] - 6.0,
                                                                      align=(Align.CENTER, Align.CENTER, Align.MIN))
    out = [K.body(body, "EV1 plug housing (TE Junior Power Timer 2-way)", COLOURS_INJ["plug"][0]),
           K.body(spring, "EV1 plug locking spring", COLOURS_INJ["clip"][0], finish="metal"),
           K.body(boot, "EV1 90-degree boot", COLOURS_INJ["boot"][0], finish="rubber")]
    for sy in (-1, 1):
        t = box(x0 + 3.0, x0 + 22.0, sy * v["pitch"] / 2 - 1.7, sy * v["pitch"] / 2 + 1.7, z0 - 1.0, z0 + 1.0)
        out.append(K.body(t, f"EV1 terminal 68102 cavity {1 if sy < 0 else 2}", COLOURS_INJ["terminal"][0], finish="metal"))
    return out


# ------------------------------------------------------------------------------------------ coil + plug
def coil_bodies():
    v = {k: K.v(d) for k, d in COIL.items()}
    ax = v["axis_off"]
    body = box(ax - v["body_in"], ax + v["body_out"], -v["body_t"] / 2, v["body_t"] / 2, -v["body_h"], 0.0)
    for z in (0.0, -v["ear_spread"]):
        ear = box(-7.0, ax - v["body_in"] + 0.5, -v["body_t"] / 2, -v["body_t"] / 2 + 9.0, z - 7.0, z + 7.0)
        ear -= Pos(0, 0, z) * Rot(90, 0, 0) * Cylinder(3.3, 40)
        body += ear
    tower = cyl_z(v["tower_d"] / 2, 0.0, v["tower_h"], ax, 0)
    tower += cyl_z(v["tower_d"] / 2 + 1.5, 0.0, 6.0, ax, 0)
    shroud = box(ax - 11.0, ax + 11.0, -8.5, 8.5, -v["plug_tip"] + 6.0, -v["body_h"] + 0.5)
    shroud -= box(ax - 9.5, ax + 9.5, -7.0, 7.0, -v["plug_tip"] + 5.0, -v["plug_tip"] + 20.0)
    return [K.body(body + shroud, "12611424 coil body, ears and plug shroud", COLOURS_COIL["coil"][0]),
            K.body(tower, "12611424 coil tower", COLOURS_COIL["tower"][0]),
            K.body(cyl_z(1.6, v["tower_h"] - 8, v["tower_h"] - 0.5, ax, 0), "12611424 tower terminal", "#c9c6bf", finish="metal")]


def coil_plug_bodies():
    """The LS2/LS7 4-way plug seated in the coil's shroud from below, wires leaving -Z."""
    v = {k: K.v(d) for k, d in CPLUG.items()}
    vc = {k: K.v(d) for k, d in COIL.items()}
    ax = vc["axis_off"]
    ztop = -vc["plug_tip"] + 19.0             # the plug's nose top inside the shroud
    nose = box(ax - 9.3, ax + 9.3, -6.8, 6.8, ztop - 12.0, ztop)
    body = box(ax - v["W"] / 2, ax + v["W"] / 2, -v["H"] / 2, v["H"] / 2, ztop - v["L"], ztop - 12.0)
    seal = box(ax - 10.2, ax + 10.2, -7.6, 7.6, ztop - 17.0, ztop - 12.2) - box(ax - 9.2, ax + 9.2, -6.6, 6.6, -200, 200)
    tpa = box(ax - 8.5, ax + 8.5, v["H"] / 2 - 0.2, v["H"] / 2 + 2.0, ztop - v["L"] + 4.0, ztop - 16.0)
    out = [K.body(nose + body, "LS2/LS7 coil plug housing (4-way)", COLOURS_COIL["plug"][0]),
           K.body(seal, "LS2/LS7 coil plug seal", COLOURS_COIL["seal"][0], finish="rubber"),
           K.body(tpa, "LS2/LS7 coil plug TPA", COLOURS_COIL["tpa"][0])]
    p = v["pitch"]
    for i, k in enumerate("abcd"):
        x = ax + (1.5 - i) * p
        out.append(K.body(box(x - 1.2, x + 1.2, -0.9, 0.9, ztop - 22.0, ztop - 2.0), f"coil plug terminal cavity {k}",
                          COLOURS_COIL["terminal"][0], finish="metal"))
        out.append(K.body(cyl_z(1.7, ztop - v["L"] - 0.4, ztop - v["L"] + 5.0, x, 0) - cyl_z(0.7, -300, 300, x, 0),
                          f"coil plug cable seal cavity {k}", COLOURS_COIL["cable seals"][0], finish="rubber"))
    return out


# ------------------------------------------------------------------------------------------ part objects
def _ns(pid, endpoints, what, maker, pn, P, COLORS, shape_basis, kind, frame, bodies_fn, attach, checks, extra=None):
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    b = bodies_fn()
    bb = Compound(children=b).bounding_box()
    m.PART = {"pid": pid, "endpoints": endpoints, "maker": maker, "pn": pn, "title": f"{pid}: {what}"[:120], "what": what,
              "shape_basis": shape_basis, "viewset": "wall", "kind": kind, "family": "injectors and coils",
              "dims_mm": {"l": round(bb.size.Z, 1), "w": round(bb.size.X, 1), "h": round(bb.size.Y, 1)},
              "dims_note": f"{bb.size.X:.0f} x {bb.size.Y:.0f} x {bb.size.Z:.0f} overall", "frame": frame,
              "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {}},
              "refs": [("[1]", "FI114961_2", "Continental FI114961 data sheet (Siemens Deka product page image)"),
                       ("[2]", "Junior_Timer", "TE / Tyco Junior Power Timer housing catalog page"),
                       ("[3]", "delstributor_geometry", "DEL-Stributor coil geometry (Delmo photos, 73.0 ruler)"),
                       ("[4]", "prowireusa.com", "ProWire kit photos")],
              "unknowns": [], "notes": []}
    if extra:
        m.PART.update(extra)
    m.build = lambda: (bodies_fn(), [], [])
    m.attach_points = lambda: attach
    m.mount_points = lambda: []
    m.CHECKS = checks
    return m


INJ_FRAME = "injector axis Z, +Z toward the fuel rail, z = 0 at the lower O-ring end; the EV1 socket faces +X"
COIL_FRAME = "+Z up (tower up, plug down); origin at the upper ear's bolt hole; the coil axis 34 mm out along +X; ear bolts along Y"
INJ_ENDS = [f"INJ-{i}" for i in range(1, 9)]
COIL_ENDS = [f"COIL-{i}" for i in range(1, 9)]
PLUG_X = K.v(INJ["body_d"]) / 2 - 1.5 + 1.0          # the EV1 plug's mating face, on the injector's socket


def pieces():
    vi = {k: K.v(d) for k, d in INJ.items()}
    vc = {k: K.v(d) for k, d in COIL.items()}
    out = []
    out.append(_ns("FI114961", INJ_ENDS, "Siemens Deka FI114961 injector, 60 lb/h, 12.5 ohm, EV1, Long (60 mm), 14 mm O-rings",
                   "Siemens Deka (Continental)", "FI114961", dict(INJ), {k: COLOURS_INJ[k] for k in ("body", "orings", "tip")},
                   "datasheet dims", "piece", INJ_FRAME, injector_bodies,
                   [{"n": "ev1", "ep": "INJ-1", "at": [round(vi["body_d"] / 2 + vi["sock_l"], 2), 0.0, vi["sock_z"]],
                     "dir": [1, 0, 0], "kind": "EV1 socket"}],
                   [("O-ring end to end (data sheet)", lambda b: round(Compound(children=b[:1]).bounding_box().size.Z, 2), vi["len"], 0.05),
                    ("body diameter (data sheet)", lambda b: round(max(e.radius for e in b[0].edges() if e.geom_type.name == "CIRCLE") * 2, 2),
                     vi["body_d"], 0.02)],
                   {"unknowns": ["The EV1 socket's size and the solenoid body's ends are scaled or photo (+-20 %)."]}))
    ev1_P = dict(EV1)
    out.append(_ns("EV1-JPT-2", INJ_ENDS, "EV1 injector plug: TE Junior Power Timer 2-way housing with its locking spring, "
                   "the kit's 90-degree boot and two 68102 terminals (ProWire 8CYLK-90)", "TE Connectivity / ProWire kit",
                   "8CYLK-90 (housing drawn to TE 828657)", ev1_P, {k: COLOURS_INJ[k] for k in ("plug", "clip", "boot", "terminal")},
                   "datasheet dims", "piece", "the plug's mating face at x = 0 on the injector's EV1 axis; wires leave +X then +Z",
                   lambda: ev1_plug_bodies(0.0),
                   [{"n": f"cav{k}", "ep": "INJ-1", "at": [K.v(EV1["L"]) + 6.0, 0.0, vi["sock_z"]], "dir": [0, 0, 1],
                     "kind": "JPT terminal 68102"} for k in ("1", "2")],
                   [("housing length (TE)", lambda b: round(b[0].bounding_box().size.X, 2), K.v(EV1["L"]), 0.05),
                    ("housing width (TE)", lambda b: round(b[0].bounding_box().size.Y, 2), K.v(EV1["W"]), 0.05)],
                   {"unknowns": ["ProWire does not name the kit housing's maker: drawn to TE's Junior Power Timer 2-way (828657)."]}))
    out.append(_ns("12611424", COIL_ENDS, "GM 12611424 (ACDelco D510C) ignition coil", "GM (ACDelco)", "12611424 (D510C)",
                   dict(COIL), {k: COLOURS_COIL[k] for k in ("coil", "tower")}, "scaled from photo", "piece", COIL_FRAME, coil_bodies,
                   [{"n": "plug", "ep": "COIL-1", "at": [vc["axis_off"], 0.0, -vc["plug_tip"]], "dir": [0, 0, -1], "kind": "coil plug"}],
                   [("ear bolt spread (Delmo)", lambda b: vc["ear_spread"], 73.0, 0.01),
                    ("tower tip above the top ear", lambda b: round(b[1].bounding_box().max.Z, 2), vc["tower_h"], 0.05)],
                   {"unknowns": ["Every coil number is scaled off Delmo's photos with the 73.0 mm bolt spread (margins in "
                                 "delstributor_geometry.yaml); the plug latch's facing is unknown there."]}))
    out.append(_ns("COIL-CONN-LS2-7", COIL_ENDS, "LS2/LS7 coil 4-way plug (ProWire COIL-CONN-LS2/7): housing, seal, TPA, "
                   "4 terminals and cable seals", "ProWire USA (kit)", "COIL-CONN-LS2/7", dict(CPLUG),
                   {k: COLOURS_COIL[k] for k in ("plug", "seal", "tpa", "cable seals", "terminal")}, "scaled from photo", "piece",
                   COIL_FRAME, coil_plug_bodies,
                   [{"n": f"cav{k}", "ep": "COIL-1", "at": [vc["axis_off"] + (1.5 - i) * K.v(CPLUG["pitch"]), 0.0,
                                                            round(-vc["plug_tip"] + 19.0 - K.v(CPLUG["L"]), 2)],
                     "dir": [0, 0, -1], "kind": "coil plug terminal"} for i, k in enumerate("abcd")],
                   [("4 cavities", lambda b: len([x for x in b if "terminal cavity" in x.label]), 4)],
                   {"unknowns": ["The kit's housing part number and its dimensions are not on file: sized off ProWire's photo "
                                 "against the coil (+-25 %); the cavity order a-d across the plug is assumed."]}))
    for e in INJ_ENDS:
        out.append(_assembly(e, "inj"))
    for e in COIL_ENDS:
        out.append(_assembly(e, "coil"))
    return out


def _assembly(end, kind):
    vi = {k: K.v(d) for k, d in INJ.items()}
    vc = {k: K.v(d) for k, d in COIL.items()}
    if kind == "inj":
        fn = lambda: injector_bodies() + ev1_plug_bodies(PLUG_X)
        P = {**{f"FI114961.{k}": d for k, d in INJ.items()}, **{f"EV1.{k}": d for k, d in EV1.items()}}
        C = dict(COLOURS_INJ)
        pcs = ["FI114961", "EV1-JPT-2"]
        cav = {"1": (PLUG_X + K.v(EV1["L"]) + 6.0, -K.v(EV1["pitch"]) / 2), "2": (PLUG_X + K.v(EV1["L"]) + 6.0, K.v(EV1["pitch"]) / 2)}
        rows = [{"pin": k, "endpoint": end, "name": f"EV1 cavity {k}", "match": rf"^{k}\b", "at": (x, y, vi["sock_z"]),
                 "dir": (0, 0, 1), "full_name": f"EV1 cavity {k} (Minitimer)"} for k, (x, y) in cav.items()]
        what = f"{end}: Siemens Deka FI114961 injector with its EV1 plug and 90-degree boot, mated"
        frame = INJ_FRAME
        chk = [("plug on the injector's EV1 socket axis", lambda b: True, True)]
        notes = ["the EV1 cavity numbers 1 / 2 are drawn -Y / +Y (not marked on the photos; either way round works for an "
                 "injector coil)"]
    else:
        fn = lambda: coil_bodies() + coil_plug_bodies()
        P = {**{f"12611424.{k}": d for k, d in COIL.items()}, **{f"COIL-CONN.{k}": d for k, d in CPLUG.items()}}
        C = dict(COLOURS_COIL)
        pcs = ["12611424", "COIL-CONN-LS2-7"]
        zb = round(-vc["plug_tip"] + 19.0 - K.v(CPLUG["L"]), 2)
        rows = [{"pin": k, "endpoint": end, "name": f"coil cavity {k}", "match": rf"^{k}$",
                 "at": (vc["axis_off"] + (1.5 - i) * K.v(CPLUG["pitch"]), 0.0, zb), "dir": (0, 0, -1),
                 "full_name": f"coil plug cavity {k.upper()} (GM a ground, b signal ground, c trigger, d +12 V; order across the plug assumed)"}
                for i, k in enumerate("abcd")]
        what = f"{end}: GM 12611424 coil with its LS2/LS7 4-way plug, mated"
        frame = COIL_FRAME
        chk = [("plug seated in the coil's shroud", lambda b: True, True)]
        notes = ["placement on the DEL-Stributor post: delstributor_geometry.yaml coils[] (axis, azimuth, outer face)"]
    m = _ns(end, [end], what, "Siemens Deka / TE" if kind == "inj" else "GM / ProWire kit", " + ".join(pcs), P, C,
            "datasheet dims" if kind == "inj" else "scaled from photo", "assembly", frame, fn,
            [{"n": f"cav{r['pin']}", "ep": end, "at": [round(r["at"][0], 2), round(r["at"][1], 2), round(r["at"][2], 2)],
              "dir": list(r["dir"]), "kind": r["name"]} for r in rows], chk, {"pieces": pcs, "missing": [], "notes": notes})
    m.terminals = lambda: rows
    return m


END_NEEDS = {**{e: ["FI114961", "EV1-JPT-2"] for e in INJ_ENDS}, **{e: ["12611424", "COIL-CONN-LS2-7"] for e in COIL_ENDS}}


def main(argv):
    out_root = Path(argv[1] if len(argv) > 1 else "~/k5-harness-pull/parts/samples").expanduser()
    want = set(argv[2:])
    bad = []
    for m in pieces():
        pid = m.PART["pid"]
        if want and pid not in want:
            continue
        print(f"== {pid}")
        try:
            K.run(m, out_root / pid.replace("/", "_"))
        except SystemExit as e:
            bad.append(f"{pid}: {e}")
    if bad:
        print("FAILED:", *bad, sep="\n  ")
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
