#!/usr/bin/env python3
"""Power hardware: Blue Sea 1003 CableClam (FIREWALL-GROMMET, AMP-PASS), Blue Sea 2103 PowerPost Plus (FAN-JUNCTION),
TE PIDG 327583 step-down butt splice (SPL-PDM15-OUT13); and the power-hardware ends that cannot be drawn yet, each
with the reason (UNMODELLED, read by index_v5).

Numbers are the makers': Blue Sea dimensioned drawing 1003-1 (CableClam 1.385 in; fetched 2026-09-29), Blue Sea's
2101-2103 PowerPost Plus drawing (reference_documents/component_drawings/BlueSea_2101-2103_PowerPost_Plus_dim.jpg) and
product page, TE's 327583 product page. Features the drawings do not print are scaled off them (at their printed sizes).
Frames (mm): each part stands on its mounting face at z = 0, +Z up out of it; the splice's axis is Z.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_power.py <out_root> [id ...]
"""
import sys
import types
from pathlib import Path

from build123d import Align, Compound, Cylinder, Pos, RegularPolygon, extrude

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402
from fam_deutsch import box, cyl_z, rr  # noqa: E402

BS1003 = ("d2pyqm2yd3fw2i.cloudfront.net/files/resources/dimensioned_drawing/1003.pdf (Blue Sea drawing 1003-1 'CableClam "
          "1.385 Inch', fetched 2026-09-29)")
BS2103 = "reference_documents/component_drawings/BlueSea_2101-2103_PowerPost_Plus_dim.jpg (Blue Sea)"
BS2103P = "reference_documents/web_snapshots/www.bluesea.com__PowerPost_Plus_-_3_8in-16_Stud.md (Blue Sea product page)"
BS2103_FV = f"{BS2103} front view, scaled at the printed 83.82 (237 px) and A 51 (144 px)"
TE327 = "reference_documents/web_snapshots/www.te.com__product-327583.md (TE product page 327583)"


def D(v, src, basis="maker", note="", fit=""):
    return Dim(v, src, basis, note, fit)


CC = {"od": D(67.70, f"{BS1003}: 'dia 2.67in [67.70mm]'"), "boss_d": D(38.16, f"{BS1003}: 'dia 1.50in [38.16mm]'"),
      "h": D(28.33, f"{BS1003}: '1.12in [28.33mm]'"), "hole_r": D(25.86, f"{BS1003}: '1.02in [25.86mm]' centre to the holes"),
      "hole_d": D(4.4, f"{BS1003}: 'Mounting hole for #8 Screw' (a #8 clearance hole)", "design"),
      "base_h": D(4.0, f"scaled off {BS1003} side view at the printed 28.33", "scaled"),
      "cable_max": D(14.22, "reference_documents/web_snapshots/www.bluesea.com__CableClam_1.40in.md: 'Max Cable Diameter 0.56in "
                            "(14.22 mm)'", note="the 1.40 in CableClam's figure; the 1003's own range is not on file")}
PP = {"L": D(83.82, f"{BS2103}: '3.300 [83.82]'"), "W": D(44.45, f"{BS2103}: '1.750 [44.45]'"),
      "hole_x": D(63.50, f"{BS2103}: '2.500 [63.50]', mounting holes for 1/4\" screws"),
      "base_h": D(11.43, f"{BS2103}: '.450 [11.43]'"), "top_h": D(26.04, f"{BS2103}: '1.025 [26.04]' to the terminal ring"),
      "A": D(51.0, f"{BS2103}: table, 2103 dimension A '2.0 [51]' to the stud tip"),
      "stud_d": D(9.525, f"{BS2103}: table '3/8\"-16 UNC X 3/4\"'; {BS2103P} 'Stud dimensions: 3/8\" x 3/4\"'"),
      "stud_l": D(19.05, f"{BS2103}: table '3/8\"-16 UNC X 3/4\"'"),
      "ring_d": D(38.0, f"scaled off {BS2103} top view at the printed 44.45", "scaled", "the round terminal ring"),
      "screw_n": D(8, f"{BS2103} top view: eight screw terminals round the stud", "scaled"),
      "seat_z": D(32.3, f"{BS2103_FV}", "scaled", "+-0.5: the top of the lower hex, where the rings seat"),
      "hex0_h": D(2.8, f"{BS2103_FV}", "scaled", "+-0.5: the lower hex"),
      "washer_t": D(2.9, f"{BS2103_FV}", "scaled", "+-0.5: the split lock washer (its split shows in the front view)"),
      "washer_d": D(17.7, f"{BS2103_FV}", "scaled", "+-1"),
      "nut_ac": D(20.3, f"{BS2103_FV}", "scaled", "+-1: across the corners (the front view shows three faces of each hex)"),
      "nut_h": D(6.2, f"{BS2103_FV}", "scaled", "+-0.5: the upper (terminal) nut")}
PP_TORQUE = f"{BS2103P}: 'Terminal Stud Torque | 140 in-lb (15.82 Nm)'"
PIDG = {"L": D(32.13, f"{TE327}: 'Product Length 32.13 mm [1.265 in]'"),
        "id": D(3.89, f"{TE327}: 'Recovered Inside Diameter 3.89 mm [.153 in]'"),
        "od": D(6.4, f"{TE327}: the insulation sleeve, scaled from the 3.89 recovered ID (TE photo)", "photo", "+-15 %"),
        "step": D(4.8, f"{TE327}: the 22-18 AWG end's smaller sleeve (photo)", "photo", "+-20 %")}
COL = {"cableclam": ("#1b1c1e", "Blue Sea CableClam: black (the drawing and the product photos show black acetal)"),
       "clam seal": ("#262626", "Blue Sea CableClam: black rubber seal insert"),
       "base": ("#1c1c1e", f"{BS2103P}: 'Base Material is Black Nylon 8231 GHS'"),
       "stud": ("#c7c9c6", f"{BS2103P}: 3/8\" stud (tin-plated copper assumed colour: not stated)"),
       "pidg": ("#6f9fd8", f"{TE327}: 'Primary Product Color Blue - Transluscent'"),
       "pidg barrel": ("#c9c6bf", f"{TE327}: 'Terminal Plating Material Tin'")}

# ends in this lane that cannot be drawn yet, and why (index_v5 lists them)
UNMODELLED = {
    **{e: ("Blue Sea 5065 in-line ATO/ATC fuse holder: Blue Sea publishes no drawing ('There is no documentation for this "
           "product', bluesea.com 2026-09-29). Needs: calipers or a photo of the part with a scale")
       for e in ("FUSE-IBOOST_PERM", "FUSE-ISO_PWR", "FUSE-ISO_SW_PWR", "FUSE-DAK_CONST", "FUSE-PCS_BATT", "FUSE-TRANS_BATT")},
    "GND-SPLICE-REAR": "ring not picked: the registry's 13 terminations say 'the rear stud bus is not picked, so its stud size is unknown'",
    "COIL-GROUND-RINGS": ("ring not picked: the registry's 18 terminations say 'read the head's ground boss thread at the bench (no stud "
                          "size in the LS3 documents on file)'"),
    "STARTER-S": "S-terminal ring not picked: the registry says 'read the S-terminal stud off the starter (bench)'",
}


def cableclam_bodies():
    v = {k: K.v(d) for k, d in CC.items()}
    base = cyl_z(v["od"] / 2, 0.0, v["base_h"], 0, 0)
    dome = cyl_z(v["od"] / 2 - 1.5, v["base_h"], v["h"] - 6.0, 0, 0)
    top = cyl_z(v["boss_d"] / 2 + 3.0, v["h"] - 6.0, v["h"] - 1.5, 0, 0) + cyl_z(v["boss_d"] / 2, v["h"] - 1.5, v["h"], 0, 0)
    body = base + dome + top
    body -= cyl_z(v["cable_max"] / 2 + 1.0, -1, v["h"] + 1, 0, 0)          # the cable passage
    for i in range(4):
        import math
        a = math.radians(90 * i)
        x, y = v["hole_r"] * math.cos(a), v["hole_r"] * math.sin(a)
        body -= cyl_z(v["hole_d"] / 2, -1, v["h"] + 1, x, y)
        body -= cyl_z(4.2, v["base_h"], v["h"] + 1, x, y)                  # the screw pockets in the dome
    seal = cyl_z(v["cable_max"] / 2 + 1.0, 2.0, v["h"] - 2.0, 0, 0) - cyl_z(v["cable_max"] / 2 - 1.5, 0, v["h"], 0, 0)
    return [K.body(body, "CableClam 1003 body", COL["cableclam"][0]),
            K.body(seal, "CableClam 1003 seal insert", COL["clam seal"][0], finish="rubber")]


def powerpost_bodies(stack_h=0.0):
    """As Blue Sea draws it: the lower hex, the split lock washer and the terminal nut on the stud. stack_h lifts the
    washer and the nut by the height of the rings seated on the lower hex (the FAN-JUNCTION stack)."""
    import math
    v = {k: K.v(d) for k, d in PP.items()}
    r_lobe = v["L"] / 2 - v["hole_x"] / 2                       # the lobes end at the printed 83.82
    base = cyl_z(v["W"] / 2, 0.0, v["base_h"], 0, 0) + box(-v["hole_x"] / 2, v["hole_x"] / 2, -r_lobe, r_lobe, 0.0, v["base_h"] * 0.55)
    for sx in (-1, 1):
        base += cyl_z(r_lobe, 0.0, v["base_h"] * 0.55, sx * v["hole_x"] / 2, 0)
        base -= cyl_z(3.4, -1, v["base_h"] + 1, sx * v["hole_x"] / 2, 0)
    base += cyl_z(v["ring_d"] / 2 + 2.5, v["base_h"], v["top_h"] - 3.0, 0, 0)
    ring = cyl_z(v["ring_d"] / 2, v["top_h"] - 3.0, v["top_h"], 0, 0) - cyl_z(v["stud_d"] / 2 + 1.0, 0, 60, 0, 0)
    screws = []
    for i in range(8):
        a = math.radians(45 * i + 22.5)
        screws.append(cyl_z(2.6, v["top_h"], v["top_h"] + 1.6, 14.0 * math.cos(a), 14.0 * math.sin(a)))
    stud = cyl_z(v["stud_d"] / 2, v["top_h"] - 3.0, v["A"], 0, 0)
    hex0 = Pos(0, 0, v["seat_z"] - v["hex0_h"]) * extrude(RegularPolygon(v["nut_ac"] / 2, 6), amount=v["hex0_h"])
    z_w = v["seat_z"] + stack_h
    washer = cyl_z(v["washer_d"] / 2, z_w, z_w + v["washer_t"], 0, 0) - cyl_z(v["stud_d"] / 2 + 0.2, 0, 99, 0, 0)
    nut = Pos(0, 0, z_w + v["washer_t"]) * extrude(RegularPolygon(v["nut_ac"] / 2, 6), amount=v["nut_h"])
    nut -= cyl_z(v["stud_d"] / 2, 0, 99, 0, 0)
    out = [K.body(base, "PowerPost Plus 2103 base (black nylon)", COL["base"][0]),
           K.body(ring + screws[0] + screws[1] + screws[2] + screws[3] + screws[4] + screws[5] + screws[6] + screws[7],
                  "PowerPost Plus 2103 terminal ring and screws", COL["stud"][0], finish="metal"),
           K.body(stud + hex0, "PowerPost Plus 2103 3/8-16 stud and its lower hex", COL["stud"][0], finish="metal"),
           K.body(washer + nut, "PowerPost Plus 2103 split lock washer and terminal nut", COL["stud"][0], finish="metal")]
    return out


def pidg_bodies():
    v = {k: K.v(d) for k, d in PIDG.items()}
    L = v["L"]
    sleeve = cyl_z(v["od"] / 2, 0.0, L * 0.55, 0, 0) + cyl_z(v["step"] / 2 + 0.7, L * 0.55, L, 0, 0)
    sleeve -= cyl_z(v["id"] / 2, -1, L * 0.55, 0, 0)
    sleeve -= cyl_z(v["step"] / 2 - 0.6, L * 0.5, L + 1, 0, 0)
    barrel = cyl_z(v["id"] / 2 - 0.2, 3.0, L - 3.0, 0, 0) - cyl_z(v["id"] / 2 - 0.66, 0, L, 0, 0)
    return [K.body(sleeve, "PIDG 327583 insulating sleeve", COL["pidg"][0], alpha=0.75, finish="lens"),
            K.body(barrel, "PIDG 327583 barrel", COL["pidg barrel"][0], finish="metal")]


def _ns(pid, endpoints, what, maker, pn, P, COLORS, shape_basis, frame, fn, attach, checks, kind="piece", extra=None):
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    bb = Compound(children=fn()).bounding_box()
    m.PART = {"pid": pid, "endpoints": endpoints, "maker": maker, "pn": pn, "title": f"{maker} {pn}", "what": what,
              "shape_basis": shape_basis, "viewset": "floor", "kind": kind, "family": "power hardware",
              "dims_mm": {"l": round(bb.size.X, 1), "w": round(bb.size.Y, 1), "h": round(bb.size.Z, 1)},
              "dims_note": f"{bb.size.X:.1f} x {bb.size.Y:.1f} x {bb.size.Z:.1f}", "frame": frame,
              "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {}},
              "refs": [("[1]", "1003.pdf", "Blue Sea drawing 1003-1"), ("[2]", "PowerPost_Plus_dim", "Blue Sea 2101-2103 drawing"),
                       ("[3]", "327583", "TE product page 327583")], "unknowns": [], "notes": []}
    if extra:
        m.PART.update(extra)
    m.build = lambda: (fn(), [], [])
    m.attach_points = lambda: attach
    m.mount_points = lambda: []
    m.CHECKS = checks
    return m


# ------------------------------------------------------------------------------------------ MIL / Raychem splices
TEIN = ("TE Customer Drawing D-436-36/-37/-38 'Sealed In-Line Crimp Splice, SAE AS81824/1', rev F1 (2022-02-17), Table I "
        "(read in a browser by the pieces lane, 2026-09-29, from te.com/en/product-650076-000.html)")
TESTUB = ("TE Specification Control Drawing D-609-03/-04/-05 'Crimp Splicer, Stub', issue 1 (read in a browser by the pieces "
          "lane, 2026-09-29); length from TE's product pages 680104-000 / 680105-000 / 680106-000")
INLINE = {  # MIL part: (TE part, sleeve ID as received, barrel ID max/min, barrel OD max/min, C max/min, D max/min, colour band)
    "M81824/1-2": ("D-436-37", 2.79, (1.75, 1.63), (2.70, 2.57), (14.86, 14.35), (7.11, 6.60), ("#2f6fd0", "blue")),
    "M81824/1-3": ("D-436-38", 4.32, (2.60, 2.46), (3.89, 3.73), (14.86, 14.35), (7.11, 6.60), ("#e8c21c", "yellow")),
}
STUBS = {  # D-609: (TE part, ID max/min, OD max/min, length, colour)
    "D-609-03": ("680104-000", (1.27, 1.13), (2.03, 1.90), 7.11, ("#d23b2f", "red")),
    "D-609-04": ("680105-000", (1.75, 1.62), (2.69, 2.56), 7.11, ("#2f6fd0", "blue")),
    "D-609-05": ("680106-000", (2.59, 2.46), (3.89, 3.73), 7.11, ("#e8c21c", "yellow")),
}
CAP = "a heat-shrink cap for each stub splice (not named in the registry)"
UNSIZED = "a D-609 stub splice: the registry names it without a gauge, so its size is not picked"


def _splice_ends():
    """Every end whose registry terminations (or endpoint kit) name one of these splices, in registry order."""
    out = {pn: [] for pn in list(INLINE) + list(STUBS)}
    unsized = []
    reg = K.registry()
    for t in reg["terminations"]:
        pn = str(t.get("part") or "")
        if pn in out and t["endpoint"] not in out[pn]:
            out[pn].append(t["endpoint"])
        elif pn.startswith("D-609 (") and t["endpoint"] not in unsized:
            unsized.append(t["endpoint"])
    for e, ep in (reg.get("endpoints") or {}).items():
        for pn in (ep.get("kit") or {}):
            if pn in out and e not in out[pn]:
                out[pn].append(e)
    return out, unsized


SPLICE_ENDS, UNSIZED_ENDS = _splice_ends()


def _mid(t):
    return round((t[0] + t[1]) / 2, 3)


def inline_P(mil):
    te, sid, bid, bod, c, d, col = INLINE[mil]
    return {"sleeve_l": Dim(27.94, f"{TEIN}: sleeve length 27.94 +-1.27 (1.10 +-0.05)", "maker"),
            "sleeve_id": Dim(sid, f"{TEIN}: {te} sleeve ID 'a' (min as received)", "maker"),
            "sleeve_wall": Dim(0.35, "the drawing prints no sleeve OD", "assumed", "red: a 0.35 wall is drawn"),
            "ring_w": Dim(2.4, "the drawing gives no ring size or place", "assumed", "red: each sealing ring's width"),
            "ring_in": Dim(3.0, "the drawing gives no ring size or place", "assumed",
                           "red: each ring's centre from the sleeve's end, beyond the barrel"),
            "barrel_id": Dim(_mid(bid), f"{TEIN}: {te} dia A {bid[0]}/{bid[1]} (the mid value)", "maker"),
            "barrel_od": Dim(_mid(bod), f"{TEIN}: {te} dia B {bod[0]}/{bod[1]} (the mid value)", "maker"),
            "barrel_l": Dim(_mid(c), f"{TEIN}: {te} C {c[0]}/{c[1]} (the mid value)", "maker"),
            "half_l": Dim(_mid(d), f"{TEIN}: {te} D {d[0]}/{d[1]} x 2 (each half)", "maker")}


def inline_bodies(mil, label=None):
    v = {k: K.v(x) for k, x in inline_P(mil).items()}
    col = INLINE[mil][6]
    L = v["sleeve_l"]
    sleeve = cyl_z(v["sleeve_id"] / 2 + v["sleeve_wall"], -L / 2, L / 2, 0, 0) - cyl_z(v["sleeve_id"] / 2, -L, L, 0, 0)
    barrel = cyl_z(v["barrel_od"] / 2, -v["barrel_l"] / 2, v["barrel_l"] / 2, 0, 0) - cyl_z(v["barrel_id"] / 2, -L, L, 0, 0)
    rings = []
    hw = v["ring_w"] / 2
    for z, c in ((-L / 2 + v["ring_in"], ("#e9ecef", "clear")), (L / 2 - v["ring_in"], col)):
        rings.append((cyl_z(v["sleeve_id"] / 2 - 0.05, z - hw, z + hw, 0, 0) - cyl_z(v["barrel_od"] / 2 - 0.2, -L, L, 0, 0), c))
    lab = label or mil
    out = [K.body(sleeve, f"{lab} heat-shrink sleeve (transparent blue PVDF)", "#8fb6e8", alpha=0.45, finish="lens"),
           K.body(barrel, f"{lab} crimp barrel", "#c9c6bf", finish="metal")]
    for i, (r, c) in enumerate(rings):
        out.append(K.body(r, f"{lab} sealing ring {i + 1} ({c[1]})", c[0], alpha=0.8, finish="rubber"))
    return out


def stub_P(pn):
    te, idd, od, L, col = STUBS[pn]
    return {"id": Dim(_mid(idd), f"{TESTUB}: {pn} ID {idd[0]}/{idd[1]} (mid)", "maker"),
            "od": Dim(_mid(od), f"{TESTUB}: {pn} OD {od[0]}/{od[1]} (mid)", "maker"),
            "length": Dim(L, f"{TESTUB}: {pn} ({te}) length {L}", "maker"),
            "end_wall": Dim(0.6, "not printed", "assumed", "red: the closed end's wall"),
            "band_w": Dim(1.0, "the drawing states the colour code, not its form", "assumed",
                          "red: the colour code is drawn as a 1.0 band next to the closed end")}


def stub_bodies(pn, label=None):
    v = {k: K.v(x) for k, x in stub_P(pn).items()}
    col = STUBS[pn][4]
    barrel = cyl_z(v["od"] / 2, 0.0, v["length"], 0, 0) - cyl_z(v["id"] / 2, v["end_wall"], v["length"] + 1, 0, 0)
    band = cyl_z(v["od"] / 2 + 0.05, 0.3, 0.3 + v["band_w"], 0, 0) - cyl_z(v["od"] / 2 - 0.1, -1, 3, 0, 0)
    lab = label or pn
    return [K.body(barrel, f"{lab} stub barrel (tin-plated copper, closed end)", "#c9c6bf", finish="metal"),
            K.body(band, f"{lab} colour code ({col[1]})", col[0], finish="paint")]


def pieces():
    ccv = {k: K.v(d) for k, d in CC.items()}
    ppv = {k: K.v(d) for k, d in PP.items()}
    out = []
    for end in ("FIREWALL-GROMMET", "AMP-PASS"):
        pass
    out.append(_ns("1003", ["FIREWALL-GROMMET", "AMP-PASS"], "Blue Sea 1003 CableClam cable pass-through (one per cable)",
                   "Blue Sea Systems", "1003", dict(CC), {k: COL[k] for k in ("cableclam", "clam seal")}, "maker drawing",
                   "stands on the panel at z = 0, the cable up through its centre (+Z)", cableclam_bodies,
                   [{"n": "cable", "ep": "FIREWALL-GROMMET", "at": [0.0, 0.0, ccv["h"]], "dir": [0, 0, 1], "kind": "cable exit"},
                    {"n": "cable_amp", "ep": "AMP-PASS", "at": [0.0, 0.0, ccv["h"]], "dir": [0, 0, 1], "kind": "cable exit"}],
                   [("outside diameter (drawing)", lambda b: round(b[0].bounding_box().size.X, 2), ccv["od"], 0.05),
                    ("height (drawing)", lambda b: round(b[0].bounding_box().size.Z, 2), ccv["h"], 0.05)],
                   extra={"unknowns": ["The 1003's own cable range is not on file (the 1.40 in CableClam's 14.22 max is shown)."],
                          "notes": ["FIREWALL-GROMMET and AMP-PASS take one CableClam per cable (endpoints.yaml): one is drawn"]}))
    out.append(_ns("2103", ["FAN-JUNCTION"], "Blue Sea 2103 PowerPost Plus, 3/8-16 stud, 150 A, eight screw terminals",
                   "Blue Sea Systems", "2103", dict(PP), {k: COL[k] for k in ("base", "stud")}, "maker drawing",
                   "stands on its base at z = 0, the stud up (+Z), the mounting holes along X", powerpost_bodies,
                   [{"n": "stud", "ep": "FAN-JUNCTION", "at": [0.0, 0.0, ppv["A"]], "dir": [0, 0, 1], "kind": "3/8-16 stud (lugs)"}],
                   [("length (drawing)", lambda b: round(b[0].bounding_box().size.X, 2), ppv["L"], 0.05),
                    ("width (drawing)", lambda b: round(b[0].bounding_box().size.Y, 2), ppv["W"], 0.05),
                    ("stud tip height A (drawing)", lambda b: round(b[2].bounding_box().max.Z, 2), ppv["A"], 0.05)],
                   extra={"notes": [f"stud torque: {PP_TORQUE}",
                                    "the product page's specification table says 'Color | Red' while its feature list says "
                                    "'Base Material is Black Nylon 8231 GHS': the base is drawn black; the table's red is "
                                    "not resolved (the included 4004 PowerPost Insulator is not drawn)"]}))
    pv = {k: K.v(d) for k, d in PIDG.items()}
    out.append(_ns("327583", ["SPL-PDM15-OUT13"], "TE PIDG 327583 step-down butt splice, 16-14 / 22-18 AWG, blue translucent nylon",
                   "TE Connectivity (AMP)", "327583", dict(PIDG), {k: COL[k] for k in ("pidg", "pidg barrel")}, "datasheet dims",
                   "the splice axis is Z, the 16-14 AWG end at z = 0", pidg_bodies,
                   [{"n": "big_end", "ep": "SPL-PDM15-OUT13", "at": [0.0, 0.0, 0.0], "dir": [0, 0, -1], "kind": "16-14 AWG end"},
                    {"n": "small_end", "ep": "SPL-PDM15-OUT13", "at": [0.0, 0.0, pv["L"]], "dir": [0, 0, 1], "kind": "22-18 AWG end"}],
                   [("length (TE)", lambda b: round(b[0].bounding_box().size.Z, 2), pv["L"], 0.05)]))
    for mil in INLINE:
        pv_ = {k: K.v(x) for k, x in inline_P(mil).items()}
        ends = SPLICE_ENDS[mil]
        out.append(_ns(mil.replace("/", "-"), ends, f"{mil} (TE {INLINE[mil][0]}) sealed in-line crimp splice, SAE AS81824/1, "
                       f"{INLINE[mil][6][1]} code", "TE Connectivity (Raychem)", f"{mil} ({INLINE[mil][0]})", inline_P(mil),
                       {"sleeve": ("#8fb6e8", f"{TEIN}: the stated finish, transparent blue PVDF"),
                        "barrel": ("#c9c6bf", "the barrel's plating colour is assumed (tin)"),
                        "code ring": (INLINE[mil][6][0], f"{TEIN}: colour-coded sealing ring ({INLINE[mil][6][1]})")},
                       "maker drawing", "the splice axis is Z, centred on z = 0", lambda mil=mil: inline_bodies(mil),
                       [{"n": "end_a", "ep": ends[0], "at": [0.0, 0.0, -pv_["sleeve_l"] / 2], "dir": [0, 0, -1], "kind": "wire entry"},
                        {"n": "end_b", "ep": ends[0], "at": [0.0, 0.0, pv_["sleeve_l"] / 2], "dir": [0, 0, 1], "kind": "wire entry"}],
                       [("sleeve length (TE)", lambda b: round(b[0].bounding_box().size.Z, 2), 27.94, 0.05),
                        ("barrel length C (TE, mid)", lambda b, pv_=pv_: round(b[1].bounding_box().size.Z, 2), pv_["barrel_l"], 0.05)],
                       extra={"unknowns": ["The sleeve's OD is not printed: a 0.35 wall is assumed (red).",
                                           "The two sealing rings' size and place are not printed: each is drawn 2.4 wide, "
                                           "3.0 in from its end of the sleeve (red); the clear one at -Z, the coded one at +Z."]}))
    for pn in STUBS:
        sv = {k: K.v(x) for k, x in stub_P(pn).items()}
        ends = SPLICE_ENDS[pn]
        out.append(_ns(pn, ends, f"TE {pn} ({STUBS[pn][0]}) stub crimp splicer, bare, tin-plated copper, closed one end",
                       "TE Connectivity (Raychem)", f"{pn} ({STUBS[pn][0]})", stub_P(pn),
                       {"barrel": ("#c9c6bf", f"{TESTUB}: tin-plated copper alloy"), "code": (STUBS[pn][4][0], f"{TESTUB}: {STUBS[pn][4][1]}")},
                       "maker drawing", "the barrel's closed end at z = 0, the open end (wires in) toward +Z", lambda pn=pn: stub_bodies(pn),
                       [{"n": "open_end", "ep": ends[0], "at": [0.0, 0.0, sv["length"]], "dir": [0, 0, 1], "kind": "wires in"}],
                       [("length (TE)", lambda b: round(b[0].bounding_box().size.Z, 2), sv["length"], 0.02),
                        ("OD (TE, mid)", lambda b: round(b[0].bounding_box().size.X, 3), sv["od"], 0.02)],
                       extra={"unknowns": [f"The registry names no sealing cap for this bare stub (registry-pass item: {CAP}).",
                                           "The closed end's wall (0.6) and the colour code's form (a 1.0 band) are assumed (red)."]}))
    return out


END_NEEDS = {"FIREWALL-GROMMET": ["1003"], "AMP-PASS": ["1003"], "FAN-JUNCTION": ["2103"], "SPL-PDM15-OUT13": ["327583"]}
for _pn, _ends in SPLICE_ENDS.items():
    for _e in _ends:
        _n = END_NEEDS.setdefault(_e, [])
        for _x in [_pn.replace("/", "-")] + ([CAP] if _pn in STUBS else []):
            if _x not in _n:
                _n.append(_x)
for _e in UNSIZED_ENDS:
    END_NEEDS.setdefault(_e, []).extend([x for x in (UNSIZED, CAP) if x not in END_NEEDS.get(_e, [])])


def main(argv):
    out_root = Path(argv[1] if len(argv) > 1 else "~/k5-harness-pull/parts/samples").expanduser()
    want = set(argv[2:])
    for m in pieces():
        pid = m.PART["pid"]
        if want and pid not in want:
            continue
        print(f"== {pid}")
        K.run(m, out_root / pid)


if __name__ == "__main__":
    main(sys.argv)
