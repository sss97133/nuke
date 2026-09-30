#!/usr/bin/env python3
"""Batch 7 of the connector lane: the in-tank fuel pieces behind FUEL-LEVEL and FUEL-PUMP. They are the Quantum
QFS-BKCN-GM electrical bulkhead (4 terminals through the hanger's top plate) and the Quantum QFS-H882 hanger (1973-91
Blazer, 31 gal tank) that carries it, with its level sender, float and pump.

Neither maker publishes a drawing. Each body is sized off the vendor's product photos from one sourced number:
  QFS-BKCN-GM  the vendor's "keyed 10mm hole" it fits (highflowfuel.com page, saved 2026-09-28): the O-ring that seals
               round that hole is taken as 10 across inside; photo reference_documents/product_images/QFS-BKCN-GM.jpg
               (1279 x 1280): 172 px across the O-ring's inside, +-20 %.
  QFS-H882     the vendor's own measurement, "12 inches from the top plate to the bottom of the fuel housing that holds
               the fuel pump" (highflowfuel.com Q&A, saved 2026-09-28); the side-view photo (image 633481 on the product
               page, viewed 2026-09-29) spans that 12 in over 505 px; the rest is scaled from it, +-20 %. The pump is not
               in any of the product photos: its body is ASSUMED.
Frames (mm): the bulkhead's lid seat at z = 0, its harness shroud up (+Z), its blades down into the tank; the hanger's
top plate underside at z = 0 (the tank's top), +Z out of the tank, the pump holder 12 in down.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_fuel.py <out_root> [id ...]
"""
import math
import sys
import types
from pathlib import Path

from build123d import Compound, Pos, Rot

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402
from fam_deutsch import box, cyl_z  # noqa: E402

SNAP = "reference_documents/web_snapshots/"
BKP = SNAP + "www.highflowfuel.com__qfs-performance-bulkhead-connector-fitting-qfs-bkcn-gm.md"
H8P = SNAP + ("www.highflowfuel.com__ls-swap-fuel-pump-hanger-for-1973-1991-blazer-jimmy-suburban-performance-fuel-pump-"
              "system-qfs-h882-qfs.md")
BKPH = ("reference_documents/product_images/QFS-BKCN-GM.jpg, scaled from the O-ring's 172 px inside, taken as the "
        f"'keyed 10mm hole' ({BKP})")
H8PH = (f"the H882 side-view photo (product page image 633481), scaled from the vendor's 12 in, top plate to the pump "
        f"housing's bottom (505 px; {H8P} Q&A)")


def D(v, src, basis="photo", note="", fit=""):
    return Dim(v, src, basis, note, fit)


# ------------------------------------------------------------------------------------------ QFS-BKCN-GM
BK = {"hole": D(10.0, f"{BKP}: 'a keyed 10mm hole'", "vendor", "the lid hole the stem passes"),
      "oring_od": D(14.4, BKPH, note="+-20 %"), "oring_cs": D(2.2, BKPH, note="+-25 %"),
      "boss_d": D(20.0, BKPH, note="+-20 %: the flange round the O-ring"), "boss_t": D(2.5, BKPH, note="+-30 %"),
      "body_w": D(27.6, BKPH, note="+-20 %: across the oval shroud"), "body_d": D(15.0, BKPH, note="+-25 %: front to back"),
      "shroud_h": D(14.8, BKPH, note="+-25 %: the oval harness shroud"), "neck_h": D(7.6, BKPH, note="+-25 %"),
      "wall": D(1.5, "not on file", "assumed", "red: the shroud's wall"),
      "stem_l": D(4.0, BKPH, note="+-30 %: the stem below the lid seat"),
      "blade_l": D(8.7, BKPH, note="+-25 %"), "blade_w": D(1.45, BKPH, note="+-25 %"),
      "blade_t": D(0.6, "not on file", "assumed", "red: the blades' thickness"),
      "blade_pitch": D(3.2, BKPH, note="+-25 %: the 2 x 2 blades' spacing"),
      "clip_d": D(23.0, BKPH, note="+-20 %: the stainless lock clip's star washer"),
      "clip_t": D(0.5, "not on file", "assumed", "red: the clip's sheet")}
BK_COL = {"body": ("#c4bc46", "QFS-BKCN-GM.jpg: the yellow body, median of its pixels"),
          "o-ring": ("#402316", "QFS-BKCN-GM.jpg: the brown O-ring, median"),
          "clip": ("#868582", "QFS-BKCN-GM.jpg: the stainless clip, median"),
          "blades": ("#c8c9c4", "tin-plated terminals (colour assumed)")}


def bkcn_bodies(at=(0.0, 0.0, 0.0)):
    v = {k: K.v(d) for k, d in BK.items()}
    x0, y0, z0 = at
    boss = cyl_z(v["boss_d"] / 2, z0, z0 + v["boss_t"], x0, y0)
    neck = box(x0 - v["body_w"] / 2 * 0.8, x0 + v["body_w"] / 2 * 0.8, y0 - v["body_d"] / 2, y0 + v["body_d"] / 2,
               z0 + v["boss_t"], z0 + v["boss_t"] + v["neck_h"])
    zs = z0 + v["boss_t"] + v["neck_h"]
    r = v["body_d"] / 2
    shroud = (box(x0 - v["body_w"] / 2 + r, x0 + v["body_w"] / 2 - r, y0 - r, y0 + r, zs, zs + v["shroud_h"])
              + cyl_z(r, zs, zs + v["shroud_h"], x0 - v["body_w"] / 2 + r, y0)
              + cyl_z(r, zs, zs + v["shroud_h"], x0 + v["body_w"] / 2 - r, y0))
    ri = r - v["wall"]
    cav = (box(x0 - v["body_w"] / 2 + r, x0 + v["body_w"] / 2 - r, y0 - ri, y0 + ri, zs + 3.0, zs + v["shroud_h"] + 1)
           + cyl_z(ri, zs + 3.0, zs + v["shroud_h"] + 1, x0 - v["body_w"] / 2 + r, y0)
           + cyl_z(ri, zs + 3.0, zs + v["shroud_h"] + 1, x0 + v["body_w"] / 2 - r, y0))
    stem = cyl_z(v["hole"] / 2 - 0.2, z0 - v["stem_l"], z0, x0, y0)
    body = boss + neck + shroud - cav + stem
    oring = (cyl_z(v["oring_od"] / 2, z0 - v["oring_cs"], z0, x0, y0)
             - cyl_z(v["hole"] / 2, z0 - v["oring_cs"] - 1, z0 + 1, x0, y0))
    blades = None
    p = v["blade_pitch"] / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            b = box(x0 + sx * p - v["blade_w"] / 2, x0 + sx * p + v["blade_w"] / 2, y0 + sy * p - v["blade_t"] / 2,
                    y0 + sy * p + v["blade_t"] / 2, z0 - v["stem_l"] - v["blade_l"], z0 - v["stem_l"] + 1.0)
            b += box(x0 + sx * p - v["blade_w"] / 2, x0 + sx * p + v["blade_w"] / 2, y0 + sy * p - v["blade_t"] / 2,
                     y0 + sy * p + v["blade_t"] / 2, zs + 3.0, zs + 3.0 + 6.0)      # the harness-side blades in the shroud
            blades = b if blades is None else blades + b
    clip = (cyl_z(v["clip_d"] / 2, z0 - v["oring_cs"] - 2.0 - v["clip_t"], z0 - v["oring_cs"] - 2.0, x0, y0)
            - cyl_z(v["hole"] / 2 - 0.4, z0 - 10, z0 + 1, x0, y0))
    return [K.body(body, "QFS-BKCN-GM bulkhead body (yellow)", BK_COL["body"][0]),
            K.body(oring, "QFS-BKCN-GM O-ring (brown)", BK_COL["o-ring"][0], finish="rubber"),
            K.body(blades, "QFS-BKCN-GM terminals (4, both sides)", BK_COL["blades"][0], finish="metal"),
            K.body(clip, "QFS-BKCN-GM stainless lock clip", BK_COL["clip"][0], finish="metal")]


# ------------------------------------------------------------------------------------------ QFS-H882 hanger
H8 = {"drop": D(304.8, f"{H8P}: Q&A 'The measurement is 12 inches from the top plate to the bottom of the fuel housing "
                       "that holds the fuel pump'", "vendor"),
      "plate_d": D(106.0, H8PH, note="+-20 %: the top plate"), "plate_t": D(1.5, "not on file", "assumed", "red"),
      "tube_od": D(9.8, H8PH, note="+-20 %: the stand and fuel tubes as photographed; the listing names 8AN / 6AN"),
      "an_reach": D(144.0, H8PH, note="+-20 %: the AN ends from the plate's centre"),
      "an_rise": D(35.0, H8PH, note="+-25 %: the tubes' height above the plate"),
      "an_hex": D(19.0, H8PH, note="+-25 %: the AN fittings' hex"),
      "foot_od": D(47.0, H8PH, note="+-20 %: the pump holder's ring"),
      "pump_d": D(38.0, "no photo shows the pump", "assumed", "red: the P367 pump's body"),
      "pump_l": D(130.0, "no photo shows the pump", "assumed", "red"),
      "card_h": D(50.0, H8PH, note="+-25 %: the level sender's card"), "arm_l": D(100.0, H8PH, note="+-25 %: the float arm"),
      "float_l": D(45.0, H8PH, note="+-25 %"), "float_d": D(25.0, H8PH, note="+-25 %")}
H8_COL = {"hanger": ("#b9a24e", "H882 product photos: the yellow-zinc (gold) plating"),
          "float": ("#1d1d1f", "H882 product photos: black float"),
          "sender": ("#e8e6de", "H882 product photos: the white sender housing"),
          "pump": ("#8d8f91", "assumed: a bare steel pump body (not photographed)")}
BK_AT = (24.0, 8.0)          # the bulkhead's place on the plate, photo (+-8)


def h882_bodies():
    v = {k: K.v(d) for k, d in H8.items()}
    tr = v["tube_od"] / 2
    plate = cyl_z(v["plate_d"] / 2, 0.0, v["plate_t"], 0, 0)
    for i in range(3):
        a = math.radians(90 + 120 * i)
        plate += Pos(math.cos(a) * (v["plate_d"] / 2 + 3), math.sin(a) * (v["plate_d"] / 2 + 3), v["plate_t"] / 2) * \
            Rot(0, 0, math.degrees(a)) * box(-4, 4, -5, 5, -v["plate_t"] / 2, v["plate_t"] / 2)
    plate -= cyl_z(K.v(BK["hole"]) / 2, -1, 5, BK_AT[0], BK_AT[1])
    tubes = None
    for y, z in ((12.0, v["an_rise"]), (-12.0, v["an_rise"] - 12.0)):
        riser = cyl_z(tr, v["plate_t"], z, -8.0, y)
        run = Pos(-8.0 - (v["an_reach"] - 8.0) / 2, y, z) * Rot(0, 90, 0) * cyl_z(tr, -(v["an_reach"] - 8.0) / 2,
                                                                                    (v["an_reach"] - 8.0) / 2, 0, 0)
        hexn = Pos(-v["an_reach"] + 18, y, z) * Rot(0, 90, 0) * cyl_z(v["an_hex"] / 2 / math.cos(math.pi / 6), -4, 4, 0, 0)
        male = Pos(-v["an_reach"] + 6, y, z) * Rot(0, 90, 0) * cyl_z(v["an_hex"] / 2 * 0.95, -6, 6, 0, 0)
        t = riser + run + hexn + male
        tubes = t if tubes is None else tubes + t
    stand = cyl_z(tr, -v["drop"] + 4.0, 0.0, 8.0, -20.0)
    foot = cyl_z(v["foot_od"] / 2, -v["drop"], -v["drop"] + 3.0, 8.0, -20.0 - v["foot_od"] / 2 + tr) - \
        cyl_z(v["foot_od"] / 2 - 4, -v["drop"] - 1, -v["drop"] + 4, 8.0, -20.0 - v["foot_od"] / 2 + tr)
    pump = cyl_z(v["pump_d"] / 2, -v["drop"] + 3.0, -v["drop"] + 3.0 + v["pump_l"], 8.0, -20.0 - v["foot_od"] / 2 + tr)
    card = box(8.0 + tr, 8.0 + tr + 6.0, -32.0, -8.0, -150.0 - v["card_h"] / 2, -150.0 + v["card_h"] / 2)
    ax, az = 8.0 + tr + 6.0, -165.0
    ang = math.radians(35)
    ex, ez = ax + v["arm_l"] * math.cos(ang), az - v["arm_l"] * math.sin(ang)
    arm = Pos((ax + ex) / 2, -20.0, (az + ez) / 2) * Rot(0, 90 - math.degrees(ang), 0) * cyl_z(1.0, -v["arm_l"] / 2,
                                                                                           v["arm_l"] / 2, 0, 0)
    flt = box(ex - v["float_l"] / 2, ex + v["float_l"] / 2, -20.0 - v["float_d"] / 2, -20.0 + v["float_d"] / 2,
              ez - v["float_d"] / 2, ez + v["float_d"] / 2)
    out = [K.body(plate + tubes + stand + foot, "QFS-H882 hanger: top plate, fuel tubes (8AN / 6AN) and stand",
                  H8_COL["hanger"][0], finish="metal"),
           K.body(card, "QFS-H882 level sender", H8_COL["sender"][0]),
           K.body(arm, "QFS-H882 float arm", "#c9c8c2", finish="metal"),
           K.body(flt, "QFS-H882 float", H8_COL["float"][0]),
           K.body(pump, "P367 pump (body ASSUMED)", H8_COL["pump"][0], alpha=0.6, finish="metal")]
    out += bkcn_bodies((BK_AT[0], BK_AT[1], v["plate_t"]))
    return out


# ------------------------------------------------------------------------------------------ part objects
def _ns(pid, ends, what, maker, pn, P, COLORS, fn, attach, checks, frame, extra=None, kind="piece"):
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    bb = Compound(children=fn()).bounding_box()
    m.PART = {"pid": pid, "endpoints": ends, "maker": maker, "pn": pn, "title": f"{maker} {pn}", "what": what,
              "shape_basis": "scaled from photo", "viewset": "floor", "kind": kind, "family": "fuel system (in-tank)",
              "dims_mm": {"l": round(bb.size.X, 1), "w": round(bb.size.Y, 1), "h": round(bb.size.Z, 1)},
              "dims_note": f"about {bb.size.X:.0f} x {bb.size.Y:.0f} x {bb.size.Z:.0f} (photo-scaled)", "frame": frame,
              "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {}},
              "refs": [("[1]", "highflowfuel.com", "Quantum's vendor pages (saved 2026-09-28) and product photos")],
              "unknowns": [], "notes": [], "pieces": [pn], "missing": []}
    if extra:
        m.PART.update(extra)
    m.build = lambda: (fn(), [], [])
    m.attach_points = lambda: attach
    m.mount_points = lambda: []
    m.CHECKS = checks
    return m


def pieces():
    bv = {k: K.v(d) for k, d in BK.items()}
    hv = {k: K.v(d) for k, d in H8.items()}
    top = bv["boss_t"] + bv["neck_h"] + bv["shroud_h"]
    out = [_ns("QFS-BKCN-GM", ["FUEL-LEVEL", "FUEL-PUMP"],
               "Quantum QFS-BKCN-GM electrical bulkhead: 4 terminals (14 A each) through a keyed 10 mm hole in the hanger's "
               "top plate, O-ring sealed, stainless lock clip", "Quantum Fuel Systems", "QFS-BKCN-GM", dict(BK), BK_COL,
               bkcn_bodies,
               [{"n": "harness", "ep": "FUEL-PUMP", "at": [0.0, 0.0, round(top, 2)], "dir": [0, 0, 1],
                 "kind": "4-way harness shroud (pump +, pump -, sender, sender ground)"},
                {"n": "harness_level", "ep": "FUEL-LEVEL", "at": [0.0, 0.0, round(top, 2)], "dir": [0, 0, 1],
                 "kind": "the same 4-way shroud"}],
               [("stem fits the keyed 10 mm hole (vendor)",
                 lambda b: round(min(e.radius for e in b[0].edges() if e.geom_type.name == "CIRCLE") * 2, 2), 9.6, 0.05)],
               "the lid seat at z = 0, the harness shroud up (+Z), the in-tank blades down",
               extra={"unknowns": ["Sized off the vendor's photo from the 'keyed 10mm hole' it fits (the O-ring's inside), "
                                   "+-20 %; the photo is a three-quarter view.",
                                   "The mating harness plug is not on file (the registry routes the pump pair to a DTP "
                                   "2-way and the sender pair to a DT 2-way above the lid)."]}),
           _ns("QFS-H882", ["FUEL-LEVEL", "FUEL-PUMP"],
               "Quantum QFS-H882 fuel pump hanger (1973-91 Blazer, 31 gal tank): top plate, 8AN / 6AN tubes, level sender "
               "and float, P367 pump holder, QFS-BKCN-GM bulkhead", "Quantum Fuel Systems", "QFS-H882", dict(H8), H8_COL,
               h882_bodies,
               [{"n": "bulkhead", "ep": "FUEL-PUMP", "at": [BK_AT[0], BK_AT[1], round(hv["plate_t"] + top, 2)],
                 "dir": [0, 0, 1], "kind": "QFS-BKCN-GM shroud"},
                {"n": "bulkhead_level", "ep": "FUEL-LEVEL", "at": [BK_AT[0], BK_AT[1], round(hv["plate_t"] + top, 2)],
                 "dir": [0, 0, 1], "kind": "QFS-BKCN-GM shroud"}],
               [("top plate to the pump holder's bottom (vendor 12 in)",
                 lambda b: round(-b[0].bounding_box().min.Z, 1), 304.8, 0.1)],
               "the top plate's underside at z = 0 (the tank top), +Z out of the tank, the pump holder 12 in down",
               kind="assembly",
               extra={"pieces": ["QFS-H882", "QFS-BKCN-GM"],
                      "unknowns": ["The hanger is scaled off the vendor's side-view photo from its own 12 in (top plate "
                                   "to the pump housing's bottom), +-20 %; the tubes' AN sizes (8AN / 6AN) are the "
                                   "listing's, their drawn OD is the photo's.",
                                   "The P367 pump is in no product photo: its body (38 x 130) is ASSUMED (red).",
                                   "The kit's own pigtail (black loom, a 2-pin plug and a ring lug in the photos) is not "
                                   "drawn; the registry routes the pairs to its DT and DTP connectors."]})]
    return out


def main(argv):
    out_root = Path(argv[1] if len(argv) > 1 else "~/k5-harness-pull/parts/samples").expanduser()
    want = set(argv[2:])
    for m in pieces():
        if want and m.PART["pid"] not in want:
            continue
        print(f"== {m.PART['pid']}")
        K.run(m, out_root / m.PART["pid"])


if __name__ == "__main__":
    main(sys.argv)
