#!/usr/bin/env python3
"""Batch 6 of the sensor lane: the GM/Hitachi 12699160 electronic throttle body (TB), the Dakota Digital SEN-01-5 speed
sender (VSS-SENDER) and the Vintage Air 11079-VUS binary pressure switch (AC-HP-SW); plus the sensor-lane ends that
cannot be drawn yet, with the reason (UNMODELLED).

Each body is sized off the maker's product photo from one sourced dimension on the part (named per number):
  TB           the 92 mm bore (vehicle_build_manifest, 'GM/Hitachi 12699160, L8T 6.6L truck, ~92 mm bore', as quoted in
               docs/wiring/twin/dimensions_v3.json); photo GM 12699160_Primary (part_media TB), +-20 %; its depth is not
               in the front photo (assumed).
  VSS-SENDER   its 7/8-18 female thread (part_media VSS-SENDER '7/8-18 GM thread': 7/8 in = 22.2 mm major diameter);
               Summit photo dak-sen-01-5_xl, +-15 %.
  AC-HP-SW     its 3/8-24 male thread (part_media AC-HP-SW '3/8-24 male': 3/8 in = 9.525 mm major diameter); Summit photo
               vta-11079-vus_xl, +-15 %.
Frames (mm): the sensor's sealing / mounting face at z = 0, its body up (+Z), wires out the top; the TB stands on its
inlet flange at z = 0 with the bore along Z.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_sensors2.py <out_root> [id ...]
"""
import sys
import types
from pathlib import Path

from build123d import Compound, Pos, RegularPolygon, extrude

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402
from fam_deutsch import box, cyl_z  # noqa: E402

TBSRC = ("docs/wiring/twin/dimensions_v3.json (vehicle_build_manifest 'Electronic Throttle Body GM/Hitachi 12699160, L8T 6.6L "
         "truck, ~92 mm bore')")
TBPH = f"GM product photo 12699160_Primary (part_media TB), scaled from the 92 mm bore ({TBSRC})"
VPH = "Summit photo dak-sen-01-5_xl (part_media VSS-SENDER), scaled from its 7/8-18 thread (22.2 mm major)"
APH = "Summit photo vta-11079-vus_xl (part_media AC-HP-SW), scaled from its 3/8-24 thread (9.525 mm major)"


def D(v, src, basis="photo", note="", fit=""):
    return Dim(v, src, basis, note, fit)


TB = {"bore": D(92.0, TBSRC, "vendor", "the build manifest's 'about 92 mm' (the DB); no GM drawing on file states it"),
      "bore_od": D(110.0, TBPH, note="+-20 %"), "flange": D(118.0, TBPH, note="+-20 %: the 4-bolt inlet flange square"),
      "flange_t": D(10.0, TBPH, note="+-30 %"), "depth": D(70.0, "not in the front photo", "assumed", "+-20: bore length"),
      "box_w": D(150.0, TBPH, note="+-20 %: the lower motor and electronics housing"), "box_h": D(52.0, TBPH, note="+-20 %"),
      "cover_h": D(20.0, TBPH, note="+-25 %: the black electronics cover"), "conn_w": D(14.0, TBPH, note="+-25 %")}
VSS = {"thread": D(22.2, "part_media.yaml VSS-SENDER '7/8-18 GM thread' (the designation: 7/8 in major diameter)", "maker"),
       "body_d": D(27.0, VPH, note="+-15 %: the knurled body"), "body_l": D(36.0, VPH, note="+-15 %"),
       "conn_l": D(24.0, VPH, note="+-20 %: the black connector"), "conn_w": D(16.0, VPH, note="+-20 %")}
ACHP = {"thread": D(9.525, "part_media.yaml AC-HP-SW '3/8-24 male' (the designation: 3/8 in major diameter)", "maker"),
        "thread_l": D(8.0, APH, note="+-15 %"), "hex": D(22.0, APH, note="+-15 %: the brass hex across flats"),
        "hex_l": D(8.0, APH, note="+-15 %"), "cap_d": D(24.0, APH, note="+-15 %: the grey cap"), "cap_l": D(14.0, APH, note="+-15 %")}


def tb_bodies():
    v = {k: K.v(d) for k, d in TB.items()}
    fl = box(-v["flange"] / 2, v["flange"] / 2, -v["flange"] / 2, v["flange"] / 2, 0.0, v["flange_t"])
    body = cyl_z(v["bore_od"] / 2, 0.0, v["depth"], 0, 0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            fl -= cyl_z(4.5, -1, v["flange_t"] + 1, sx * (v["flange"] / 2 - 9), sy * (v["flange"] / 2 - 9))
    housing = (fl + body) - cyl_z(v["bore"] / 2, -1, v["depth"] + 1, 0, 0)
    y0 = -v["bore_od"] / 2 - v["box_h"] + 12.0
    lower = box(-v["box_w"] / 2, v["box_w"] / 2, y0, -v["bore_od"] / 2 + 12.0, 8.0, v["depth"] - 6.0)
    cover = box(-v["box_w"] / 2 + 3, v["box_w"] / 2 - 3, y0 - v["cover_h"], y0 + 0.5, 12.0, v["depth"] - 10.0)
    conn = box(-v["conn_w"] / 2 - 25, v["conn_w"] / 2 - 25, y0 - v["cover_h"] - 16.0, y0 - v["cover_h"] + 0.5, 25.0, 45.0)
    plate = cyl_z(v["bore"] / 2 - 0.5, v["depth"] * 0.45, v["depth"] * 0.45 + 1.5, 0, 0)
    return [K.body(housing + lower, "12699160 cast aluminium body", "#b9bcbe", finish="cast"),
            K.body(cover, "12699160 electronics cover", "#1d1e20"),
            K.body(conn, "12699160 5-way connector shroud", "#1d1e20"),
            K.body(plate, "12699160 throttle plate", "#c5a86a", finish="metal")]


def vss_bodies():
    v = {k: K.v(d) for k, d in VSS.items()}
    body = cyl_z(v["body_d"] / 2, 0.0, v["body_l"], 0, 0) - cyl_z(v["thread"] / 2, -1, 14.0, 0, 0)
    conn = box(-v["conn_w"] / 2, v["conn_w"] / 2, -v["conn_w"] / 2 + 1, v["conn_w"] / 2 - 1, v["body_l"], v["body_l"] + v["conn_l"])
    return [K.body(body, "SEN-01-5 knurled aluminium body (7/8-18 female)", "#c9ccce", finish="metal"),
            K.body(conn, "SEN-01-5 connector and pigtail exit", "#1c1c1c")]


def achp_bodies():
    v = {k: K.v(d) for k, d in ACHP.items()}
    thread = cyl_z(v["thread"] / 2, 0.0, v["thread_l"], 0, 0)
    hexb = Pos(0, 0, v["thread_l"]) * extrude(RegularPolygon(v["hex"] / 2 / 0.866, 6), amount=v["hex_l"])
    cap = cyl_z(v["cap_d"] / 2, v["thread_l"] + v["hex_l"], v["thread_l"] + v["hex_l"] + v["cap_l"], 0, 0)
    z0 = v["thread_l"] + v["hex_l"] + v["cap_l"]
    tabs = box(-4.5, -3.7, -3.2, 3.2, z0, z0 + 11) + box(3.7, 4.5, -3.2, 3.2, z0, z0 + 11)
    return [K.body(thread + hexb, "11079-VUS brass hex body and 3/8-24 thread", "#c3a34f", finish="metal"),
            K.body(cap, "11079-VUS grey cap", "#6c6f71"),
            K.body(tabs, "11079-VUS spade terminals", "#c47a3f", finish="metal")]


def _ns(pid, end, what, maker, pn, P, COLORS, fn, attach, checks, frame, extra=None, rows=None):
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    bb = Compound(children=fn()).bounding_box()
    m.PART = {"pid": pid, "endpoints": [end], "maker": maker, "pn": pn, "title": f"{maker} {pn}", "what": what,
              "shape_basis": "scaled from photo", "viewset": "floor", "kind": "assembly", "family": "sensors",
              "dims_mm": {"l": round(bb.size.X, 1), "w": round(bb.size.Y, 1), "h": round(bb.size.Z, 1)},
              "dims_note": f"about {bb.size.X:.0f} x {bb.size.Y:.0f} x {bb.size.Z:.0f} (photo-scaled)", "frame": frame,
              "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {}},
              "refs": [("[1]", "part_media", "the maker's product photo named in part_media.yaml"),
                       ("[2]", "dimensions_v3", "the owner's build manifest via the twin's dimensions file")],
              "unknowns": ["Sized off the maker's photo from one sourced dimension (margins per number)."], "notes": [],
              "pieces": [pn], "missing": []}
    if extra:
        m.PART.update(extra)
    m.build = lambda: (fn(), [], [])
    m.attach_points = lambda: attach
    m.mount_points = lambda: []
    m.CHECKS = checks
    if rows is not None:
        m.terminals = lambda: rows
    return m


UNMODELLED = {
    "KNOCK-1": "GM 12623730 knock sensor: no sourced dimension on the sensor (GM prints none) and its plug's housing part number "
               "is not on file (ProWire 68201 kit). Needs: the bolt size or a caliper reading",
    "KNOCK-2": "as KNOCK-1 (GM 12623730)",
    "OILP-ECU": "GM 12673134 oil pressure sensor: no sourced dimension (thread and hex not in the documents on file); its round "
                "3-way plug's housing part number is not on file (ICT WC0IL40)",
    "DAK-CTS": "Dakota SEN-04-5: '1/8 NPT' is the only size stated, and a pipe thread's designation is not its diameter; needs a "
               "thread table or a caliper reading to scale the photo",
    "DAK-OILP": "Dakota SEN-03-8: as DAK-CTS (1/8 NPT only)",
    "AC-LP-SW": "GM 15035084 cycling switch: GM's page states no thread or size",
    "GSS-SENSOR": "Dakota GSS-3000 sensor: the manual and page give the kit hardware (M8 x 30 bolts, M3 rod) but no sensor size, "
                  "and no photo of the sensor alone is on file",
    "BRAKE-FLUID-LVL": "sensor part number not recorded (part_media: 'read the unit')",
    "PCS-HARNESS-4610": "the PCS TCM-4610 harness is bought complete; PCS prints no connector or loom dimensions",
    "PCS-HARNESS-4610-CASE": "as PCS-HARNESS-4610",
    "CAN-BUS": "the 100 / 120 ohm terminators are not picked (endpoints.yaml CAN-BUS kit 'CAN-TERM-100R')",
}


def pieces():
    tv = {k: K.v(d) for k, d in TB.items()}
    rows = [{"pin": str(i), "endpoint": "TB", "name": f"12699160 cavity {i}", "match": rf"^{i}\b", "at": (-25.0, -tv["bore_od"] / 2 - 60.0, 35.0),
             "dir": (0, -1, 0), "full_name": f"12699160 cavity {i} (pin order OPEN in the registry until a GM end view)"} for i in range(1, 6)]
    out = [_ns("TB", "TB", "GM/Hitachi 12699160 electronic throttle body, 92 mm, SENT position sensor, 5-way connector",
               "GM / Hitachi", "12699160", dict(TB), {"body": ("#b9bcbe", "GM photo: cast aluminium"),
                                                     "cover": ("#1d1e20", "GM photo: black electronics cover"),
                                                     "plate": ("#c5a86a", "GM photo: brass-coloured throttle plate")},
               tb_bodies, [{"n": "plug", "ep": "TB", "at": [-25.0, round(-tv["bore_od"] / 2 - 60.0, 1), 35.0], "dir": [0, -1, 0],
                            "kind": "5-way connector (ICT WCTHB50 kit plug not drawn)"}],
               [("bore (build manifest)", lambda b: round(max(e.radius for e in b[0].edges() if e.geom_type.name == "CIRCLE" and 40 < e.radius < 50) * 2, 1), 92.0, 0.1)],
               "stands on the inlet flange at z = 0, the bore along Z; the electronics housing toward -Y",
               extra={"missing": ["the ICT WCTHB50 kit plug (its housing part number is not on file)"]}, rows=rows)]
    vv = {k: K.v(d) for k, d in VSS.items()}
    out.append(_ns("VSS-SENDER", "VSS-SENDER", "Dakota Digital SEN-01-5 speed sender (7/8-18 GM thread, 3 wires)", "Dakota Digital",
                   "SEN-01-5", dict(VSS), {"body": ("#c9ccce", "Summit photo: knurled aluminium"), "connector": ("#1c1c1c", "Summit photo: black")},
                   vss_bodies, [{"n": "pigtail", "ep": "VSS-SENDER", "at": [0.0, 0.0, vv["body_l"] + vv["conn_l"]], "dir": [0, 0, 1], "kind": "3-wire pigtail"}],
                   [("7/8-18 thread (designation)", lambda b: round(min(e.radius for e in b[0].edges() if e.geom_type.name == "CIRCLE") * 2, 2), 22.2, 0.05)],
                   "the thread face at z = 0 (on the transmission's speedometer drive), the pigtail up (+Z)"))
    av = {k: K.v(d) for k, d in ACHP.items()}
    out.append(_ns("AC-HP-SW", "AC-HP-SW", "Vintage Air 11079-VUS binary pressure switch, 30 / 406 psi, 3/8-24 male, two spade terminals",
                   "Vintage Air", "11079-VUS", dict(ACHP), {"hex": ("#c3a34f", "Summit photo: brass hex"), "cap": ("#6c6f71", "Summit photo: grey cap"),
                                                           "terminals": ("#c47a3f", "Summit photo: copper spades")},
                   achp_bodies, [{"n": f"t{i}", "ep": "AC-HP-SW", "at": [sx, 0.0, round(av["thread_l"] + av["hex_l"] + av["cap_l"] + 11, 1)],
                                  "dir": [0, 0, 1], "kind": "spade terminal"} for i, sx in ((1, -4.1), (2, 4.1))],
                   [("3/8-24 thread (designation)", lambda b: round(min(e.radius for e in b[0].edges() if e.geom_type.name == "CIRCLE") * 2, 3), 9.525, 0.05)],
                   "the thread end at z = 0 (into the A/C line fitting), the terminals up (+Z)"))
    return out


END_NEEDS = {"TB": ["TB"], "VSS-SENDER": ["VSS-SENDER"],
             "AC-HP-SW": ["AC-HP-SW", "the mating terminals for the two spades: the registry's terminations say 'open "
                                      "(connector not picked)', and its open list says the plug type is not on the Summit page"]}


def main(argv):
    out_root = Path(argv[1] if len(argv) > 1 else "~/k5-harness-pull/parts/samples").expanduser()
    for m in pieces():
        print(f"== {m.PART['pid']}")
        K.run(m, out_root / m.PART["pid"])


if __name__ == "__main__":
    main(sys.argv)
