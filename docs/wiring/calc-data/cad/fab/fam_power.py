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
      "screw_n": D(8, f"{BS2103} top view: eight screw terminals round the stud", "scaled")}
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
_MS = ("Raychem MiniSeal ({pn}): no dimension on file. TE's data sheet (2347480-1, linked from DigiKey 680106-000 = "
       "D-609-05) opens only in a browser; ProWire and DigiKey print none. Needs: the data sheet read in a browser, or "
       "calipers on a splice from the ProWire order")
UNMODELLED = {
    **{f"SPL-PDM15-OUT{i}": _MS.format(pn="M81824/1-3") for i in range(1, 8)},
    **{f"SPL-PDM30-OUT{i}": _MS.format(pn="M81824/1-3") for i in (1, 2, 3, 4, 6, 7, 8)},
    "SPL-PDM30-OUT5": _MS.format(pn="D-609-05"), "SPL-FUEL-SND": _MS.format(pn="M81824/1-2"),
    "SPL-ISO-YEL": _MS.format(pn="D-609-04"), "RAIL-COIL_PWR": _MS.format(pn="D-609-05 x 7"),
    "RAIL-INJ_PWR": _MS.format(pn="D-609-05 x 7"),
    **{e: ("Blue Sea 5065 in-line ATO/ATC fuse holder: Blue Sea publishes no drawing ('There is no documentation for this "
           "product', bluesea.com 2026-09-29). Needs: calipers or a photo of the part with a scale")
       for e in ("FUSE-IBOOST_PERM", "FUSE-ISO_PWR", "FUSE-ISO_SW_PWR", "FUSE-DAK_CONST", "FUSE-PCS_BATT", "FUSE-TRANS_BATT")},
    **{e: "ring terminal and stud bank not picked (families.yaml ring_small: 'UNKNOWN: ring PN per stud size + gauge')"
       for e in ("GND-BANK-ENG", "GND-BANK-CAB", "GND-SPLICE-REAR", "COIL-GROUND-RINGS", "STARTER-S")},
    "PS-STUDS": "the DC primary lugs land on six different studs; the lug set per stud is not picked (endpoints.yaml PS-STUDS)",
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


def powerpost_bodies():
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
    nut = Pos(0, 0, v["A"] - v["stud_l"] + 0.5) * extrude(RegularPolygon(14.3 / 2 / 0.866, 6), amount=8.0)
    out = [K.body(base, "PowerPost Plus 2103 base (black nylon)", COL["base"][0]),
           K.body(ring + screws[0] + screws[1] + screws[2] + screws[3] + screws[4] + screws[5] + screws[6] + screws[7],
                  "PowerPost Plus 2103 terminal ring and screws", COL["stud"][0], finish="metal"),
           K.body(stud + nut, "PowerPost Plus 2103 3/8-16 stud and nut", COL["stud"][0], finish="metal")]
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
                    ("stud tip height A (drawing)", lambda b: round(b[2].bounding_box().max.Z, 2), ppv["A"], 0.05)]))
    pv = {k: K.v(d) for k, d in PIDG.items()}
    out.append(_ns("327583", ["SPL-PDM15-OUT13"], "TE PIDG 327583 step-down butt splice, 16-14 / 22-18 AWG, blue translucent nylon",
                   "TE Connectivity (AMP)", "327583", dict(PIDG), {k: COL[k] for k in ("pidg", "pidg barrel")}, "datasheet dims",
                   "the splice axis is Z, the 16-14 AWG end at z = 0", pidg_bodies,
                   [{"n": "big_end", "ep": "SPL-PDM15-OUT13", "at": [0.0, 0.0, 0.0], "dir": [0, 0, -1], "kind": "16-14 AWG end"},
                    {"n": "small_end", "ep": "SPL-PDM15-OUT13", "at": [0.0, 0.0, pv["L"]], "dir": [0, 0, 1], "kind": "22-18 AWG end"}],
                   [("length (TE)", lambda b: round(b[0].bounding_box().size.Z, 2), pv["L"], 0.05)]))
    return out


END_NEEDS = {"FIREWALL-GROMMET": ["1003"], "AMP-PASS": ["1003"], "FAN-JUNCTION": ["2103"], "SPL-PDM15-OUT13": ["327583"]}


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
