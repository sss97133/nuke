#!/usr/bin/env python3
"""Batch 5 of the connector lane: the panel ports (Neutrik NC5FD-L-1 for PORT-UTC, NE8FDP for PORT-ETH), the 61-pin
firewall bulkhead halves (D38999/24WJ61SN jam-nut receptacle, FIREWALL-CABIN; D38999/26WJ61PN plug, FIREWALL-ENGINE),
the 6L90 case connector pair (Kostal LKS 1.5 16-cavity, TRANS-CASE) and the AEM 30-2131-100 fuel pressure sensor
(FUELP).

Numbers are the makers' (drawing or catalog pages on file, cited per number); features the pages do not print are
scaled off them. Frames (mm): each part's mounting or mating face at z = 0, +Z out of it toward the wires or the mate.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_misc.py <out_root> [id ...]
"""
import math
import sys
import types
from pathlib import Path

from build123d import Compound, Pos, RegularPolygon, extrude

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
from k5cad import Dim  # noqa: E402
from fam_deutsch import box, cyl_z, rr  # noqa: E402

CD = "reference_documents/component_drawings/"
NC5 = CD + "Neutrik_NC5FD-L-1_drawing.pdf (Neutrik drawing)"
NE8 = CD + "Neutrik_NE8FDP_drawing.pdf (Neutrik drawing)"
MIL = CD + "MILNEC_D38999_series_III_catalog.pdf"
KOS = CD + "Kostal_LKS_1_5_Connector_POP.pdf p.2 (Kostal, 'DIMENSIONS' / 'TECHNICAL DATA')"
AEM = CD + "AEM_30-2131_Pressure_Sensor_Instructions_10-2131C.pdf p.1 (AEM instructions 10-2131 Rev C)"


def D(v, src, basis="maker", note="", fit=""):
    return Dim(v, src, basis, note, fit)


# ------------------------------------------------------------------------------------------ Neutrik D-series ports
NEU = {
    "flange_w": D(26.0, f"{NC5} '26.00 [1.024\"]'; {NE8} '26 [1.02]'"),
    "flange_h": D(31.0, f"{NC5} '31.00 [1.220\"]'; {NE8} '31 [1.22]'"),
    "hole_x": D(19.0, f"{NC5} '19.00 [0.748\"]'; {NE8} '19 +-0.1'"), "hole_y": D(24.0, f"{NC5} '24.00 [0.945\"]'; {NE8} '24 +-0.1'"),
    "hole_d": D(3.2, f"{NC5} 'dia 3.20 [0.126\"]' (panel cutout); {NE8} '>= dia 3.2'"),
    "cutout_d": D(23.8, f"{NC5} panel cut out '>= dia 23.80 [0.937\"]'; {NE8} '>= dia 24'"),
    "flange_t": D(2.0, f"{NC5} side view '2.00 [0.078\"]'"),
}
PORTS = {
    "NC5FD-L-1": {"end": "PORT-UTC", "what": "Neutrik NC5FD-L-1 5-pole female XLR receptacle, D-size flange (the MoTeC UTC port)",
                  "depth": D(27.2, f"{NC5} side view '27.20 [1.071\"]' overall"),
                  "rear": D(18.3, f"{NC5} side view '18.30 [0.720\"]' behind the flange"),
                  "rear_w": D(21.0, f"scaled off {NC5} at its printed 26.00", "scaled"),
                  "pins": {"1": (4.1, 1.2), "2": (3.2, -2.5), "3": (0.0, -4.3), "4": (-3.3, -2.5), "5": (-4.2, 1.2)},
                  "pins_src": f"scaled off {NC5} front view at its printed 19.00 (contact numbers as printed)",
                  "colour": ("#23262a", "Neutrik NC5FD-L-1: black metal housing (Neutrik datasheet 'Housing: Zinc diecast, "
                             "black chrome')")},
    "NE8FDP": {"end": "PORT-ETH", "what": "Neutrik NE8FDP etherCON RJ45 feedthrough, D-size flange (the M130 laptop port)",
               "depth": D(34.55, f"{NE8} side view '34.55 [1.36]' overall"),
               "rear": D(18.05, f"{NE8} side view '18.05 [.71]'"),
               "rear_w": D(25.5, f"{NE8} rear view '25.5 [1.00]'"), "rear_h": D(27.64, f"{NE8} rear view '27.64 [1.09]'"),
               "pins": {str(i + 1): (round((i - 3.5) * 1.02, 2), 2.0) for i in range(8)},
               "pins_src": "RJ45 contacts at 1.02 mm (the TIA-568 jack pitch), drawn across the jack: cited as design",
               "colour": ("#23262a", "Neutrik NE8FDP: black metal housing (Neutrik datasheet)")},
}


def port_bodies(pn):
    s = PORTS[pn]
    v = {k: K.v(d) for k, d in NEU.items()}
    fl = rr(v["flange_w"], v["flange_h"], 2.5, 0.0, v["flange_t"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            fl -= cyl_z(v["hole_d"] / 2, -1, 5, sx * v["hole_x"] / 2, sy * v["hole_y"] / 2)
    depth, rear = K.v(s["depth"]), K.v(s["rear"])
    front = cyl_z(v["cutout_d"] / 2 - 0.2, -(depth - rear - v["flange_t"]), 0.0, 0, 0) - cyl_z(v["cutout_d"] / 2 - 2.0, -40, -1.5, 0, 0)
    rw = K.v(s["rear_w"])
    rh = K.v(s.get("rear_h", s["rear_w"]))
    back = box(-rw / 2, rw / 2, -rh / 2, rh / 2, v["flange_t"], v["flange_t"] + rear)
    body = fl + front + back
    insert = cyl_z(v["cutout_d"] / 2 - 2.0, -(depth - rear - v["flange_t"]) + 3.0, -0.5, 0, 0)
    for k, (x, y) in s["pins"].items():
        insert -= cyl_z(0.9, -30, 30, x, y)
    out = [K.body(body, f"{pn} housing and flange", s["colour"][0], finish="metal"),
           K.body(insert, f"{pn} insert", "#1a1a1a")]
    for k, (x, y) in s["pins"].items():
        out.append(K.body(cyl_z(0.8, -12.0, v["flange_t"] + rear - 2.0, x, y), f"{pn} contact {k}", "#d6b56a", finish="metal"))
    return out


# ------------------------------------------------------------------------------------------ D38999 shell 25 (61 x #20)
TX07 = {"W": D(55.6, f"{MIL} p.45 (TX07 / D38999/24 jam nut receptacle) shell 25 'W 2.188 (55.6)' the flange"),
        "D": D(59.0, f"{MIL} p.45 shell 25 '2.323 (59.0)' the jam nut"),
        "K": D(44.7, f"{MIL} p.45 shell 25 'K 1.759 (44.7)'"), "J": D(51.2, f"{MIL} p.45 shell 25 'J max 2.017 (51.2)'"),
        "M": D(43.4, f"{MIL} p.45 shell 25 'M 1.709 (43.4)'"), "P": D(3.2, f"{MIL} p.45 'P max rear panel .125 (3.2)'"),
        "H": D(44.7, f"{MIL} p.45 'H 1.760 (44.7)' panel D-hole"), "A": D(43.4, f"{MIL} p.45 'A 1.710 (43.4)' the D-hole flat"),
        "L": D(32.5, f"{MIL} p.45 '1.280 (32.5) Max'"), "oring": D(3.6, f"{MIL} p.45 '.142 (3.6) Max O-Ring'")}
TX06 = {"A": D(48.0, f"{MIL} p.43 (TX06 / D38999/26 plug) shell 25 'A 1.890 (48.0)' coupling ring"),
        "L": D(31.3, f"{MIL} p.43 shell 25 '1.234 (31.3)'"), "V": D(37.0, f"{MIL} p.43 shell 25 'V thread M37X1-6g' (the accessory thread)")}
ADAPT = {"C": D(36.6, "catalog/families.yaml d38999_20: M85049/69-25N, 'Amphenol PCD datasheet: C dia max 1.44 in'"),
         "L": D(22.0, "M85049/69-25N length: not on file", "assumed", "+-8: drawn so the shell has its adapter; confirm")}
OD_COL = ("#5b5c3d", f"{MIL} p.45 finish code 'W  Aluminum, olive drab cadmium' (D38999/24WJ61SN, /26WJ61PN)")


def d38999_bodies(kind):
    tv = {k: K.v(d) for k, d in TX07.items()}
    pv = {k: K.v(d) for k, d in TX06.items()}
    out = []
    if kind == "receptacle":
        fl = box(-tv["W"] / 2, tv["W"] / 2, -tv["W"] / 2, tv["W"] / 2, 0.0, 3.0)
        barrel = cyl_z(tv["M"] / 2, -12.0, 0.0, 0, 0) + cyl_z(tv["K"] / 2, 3.0, tv["L"] - 12.0, 0, 0)
        body = fl + barrel - cyl_z(tv["M"] / 2 - 2.5, -13, tv["L"], 0, 0)
        nut = Pos(0, 0, 3.0 + tv["P"]) * extrude(RegularPolygon(tv["D"] / 2, 6), amount=5.0) - cyl_z(tv["K"] / 2 + 0.2, -1, 20, 0, 0)
        out += [K.body(body, "D38999/24WJ61SN shell (jam-nut receptacle)", OD_COL[0], finish="paint"),
                K.body(nut, "D38999/24WJ61SN jam nut", OD_COL[0], finish="paint")]
        out.append(K.body(cyl_z(tv["M"] / 2 - 2.6, -11.0, tv["L"] - 13.0, 0, 0), "D38999 25-61 insert (61 x #20 sockets)", "#2a2a2a"))
        za = tv["L"] - 12.0
    else:
        ring = cyl_z(pv["A"] / 2, 0.0, 16.0, 0, 0) - cyl_z(pv["A"] / 2 - 3.0, -1, 17, 0, 0)
        body = cyl_z(pv["A"] / 2 - 3.0, 0.0, pv["L"], 0, 0) - cyl_z(pv["A"] / 2 - 5.5, -1, 8.0, 0, 0)
        body += cyl_z(pv["V"] / 2, pv["L"] - 6.0, pv["L"], 0, 0)
        out += [K.body(ring, "D38999/26WJ61PN coupling ring", OD_COL[0], finish="paint"),
                K.body(body, "D38999/26WJ61PN shell (plug)", OD_COL[0], finish="paint"),
                K.body(cyl_z(pv["A"] / 2 - 5.6, 1.0, pv["L"] - 7.0, 0, 0), "D38999 25-61 insert (61 x #20 pins)", "#2a2a2a")]
        za = pv["L"]
    av = {k: K.v(d) for k, d in ADAPT.items()}
    ad = cyl_z(av["C"] / 2, za, za + av["L"], 0, 0) - cyl_z(av["C"] / 2 - 3.0, za - 1, za + av["L"] + 1, 0, 0)
    out.append(K.body(ad, "M85049/69-25N accessory adapter", OD_COL[0], finish="paint"))
    return out


# ------------------------------------------------------------------------------------------ Kostal LKS 1.5 (6L90 case)
KOSP = {"sock_L": D(39.0, f"{KOS} socket housing 09430010 (16 cavities) 'Dimensions L x H x W' 39 x 42.7 x 50.3"),
        "sock_H": D(42.7, f"{KOS} 09430010"), "sock_W": D(50.3, f"{KOS} 09430010"),
        "pin_L": D(47.7, f"{KOS} pin housing 09330004 (16 cavities) 47.7 x 41 x 37.4"), "pin_H": D(41.0, f"{KOS} 09330004"),
        "pin_W": D(37.4, f"{KOS} 09330004")}


def kostal_bodies():
    v = {k: K.v(d) for k, d in KOSP.items()}
    pin = cyl_z(v["pin_W"] / 2, -v["pin_L"], 0.0, 0, 0)
    pin += box(-v["pin_W"] / 2, v["pin_W"] / 2, -v["pin_H"] / 2, -v["pin_H"] / 2 + 6, -v["pin_L"], -v["pin_L"] + 8)
    sock = cyl_z(min(v["sock_W"], v["sock_H"]) / 2 - 4.0, 0.0, v["sock_L"], 0, 0)
    lever = box(-v["sock_W"] / 2, v["sock_W"] / 2, -3.0, 3.0, 4.0, 12.0)
    return [K.body(pin, "Kostal 09330004 pin housing (6L90 case side, TEHCM pass-through)", "#222325"),
            K.body(sock, "Kostal 09430010 socket housing (GM 19303772, harness side)", "#1f2022"),
            K.body(lever, "Kostal 09430010 bayonet / lever", "#2b2c2e")]


# ------------------------------------------------------------------------------------------ AEM 30-2131-100
AEMP = {"L": D(54.6, f"{AEM} drawing '2.15' in overall"), "hex_l": D(19.3, f"{AEM} drawing '0.76' in", note="the hex and body"),
        "thread_l": D(10.2, f"{AEM} drawing '0.40' in thread", note="1/8-27 NPT"),
        "hex": D(23.8, f"{AEM} drawing '15/16' in hex across flats"),
        "thread_d": D(10.3, f"{AEM} '1/8\" Male NPT' (1/8-27 NPT major diameter 0.405 in)"),
        "conn_d": D(20.0, f"{AEM} drawing, scaled at its printed 2.15", "scaled", "+-2: the Packard 3-pin connector end")}


def aem_bodies():
    v = {k: K.v(d) for k, d in AEMP.items()}
    thread = cyl_z(v["thread_d"] / 2, 0.0, v["thread_l"], 0, 0)
    hexb = Pos(0, 0, v["thread_l"]) * extrude(RegularPolygon(v["hex"] / 2 / 0.866, 6), amount=6.0)
    body = cyl_z(v["hex"] / 2 - 1.5, v["thread_l"] + 6.0, v["thread_l"] + v["hex_l"], 0, 0)
    conn = cyl_z(v["conn_d"] / 2, v["thread_l"] + v["hex_l"], v["L"], 0, 0) - cyl_z(v["conn_d"] / 2 - 1.6, v["L"] - 9, v["L"] + 1, 0, 0)
    return [K.body(thread + hexb, "AEM 30-2131-100 brass body and 1/8 NPT thread", "#c9a45a", finish="metal"),
            K.body(body, "AEM 30-2131-100 sensor body", "#b9bcbd", finish="metal"),
            K.body(conn, "AEM 30-2131-100 Packard 3-pin connector", "#1c1c1c")]


# ------------------------------------------------------------------------------------------ part objects
def _ns(pid, endpoints, what, maker, pn, P, COLORS, shape_basis, frame, fn, attach, checks, kind="piece", extra=None, rows=None):
    m = types.SimpleNamespace()
    m.P, m.COLORS = P, COLORS
    bb = Compound(children=fn()).bounding_box()
    m.PART = {"pid": pid, "endpoints": endpoints, "maker": maker, "pn": pn, "title": f"{maker} {pn}", "what": what,
              "shape_basis": shape_basis, "viewset": "wall", "kind": kind, "family": "panel ports, bulkheads, case connectors",
              "dims_mm": {"l": round(bb.size.Z, 1), "w": round(bb.size.X, 1), "h": round(bb.size.Y, 1)},
              "dims_note": f"{bb.size.X:.1f} x {bb.size.Y:.1f} x {bb.size.Z:.1f}", "frame": frame,
              "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {}},
              "refs": [("[1]", "Neutrik_NC5FD", "Neutrik NC5FD-L-1 drawing"), ("[2]", "Neutrik_NE8FDP", "Neutrik NE8FDP drawing"),
                       ("[3]", "MILNEC", "MILNEC D38999 Series III catalog"), ("[4]", "Kostal", "Kostal LKS 1.5 POP"),
                       ("[5]", "AEM_30-2131", "AEM 10-2131 Rev C instructions")], "unknowns": [], "notes": []}
    if extra:
        m.PART.update(extra)
    m.build = lambda: (fn(), [], [])
    m.attach_points = lambda: attach
    m.mount_points = lambda: []
    m.CHECKS = checks
    if rows is not None:
        m.terminals = lambda: rows
    return m


def _reg_cavities(end):
    import re
    out = []
    for t in K.registry()["terminations"]:
        if t["endpoint"] == end:
            m_ = re.match(r"^([A-Za-z]{1,2}|\d+)\b", str(t.get("cavity", "")))
            if m_ and m_.group(1) not in out:
                out.append(m_.group(1))
    return out


def pieces():
    out = []
    nv = {k: K.v(d) for k, d in NEU.items()}
    for pn, s in PORTS.items():
        P = {**NEU, "depth": s["depth"], "rear": s["rear"], "rear_w": s["rear_w"], **({"rear_h": s["rear_h"]} if "rear_h" in s else {})}
        pins = s["pins"]
        rows = [{"pin": k, "endpoint": s["end"], "name": f"{pn} contact {k}", "match": rf"^{k}\b", "at": (x, y, nv["flange_t"] + K.v(s["rear"])),
                 "dir": (0, 0, 1), "endpoint_cavities": True} for k, (x, y) in pins.items()]
        out.append(_ns(pn, [s["end"]], s["what"], "Neutrik", pn, P, {"housing": s["colour"], "contacts": ("#d6b56a", "gold-plated contacts (Neutrik datasheet)")},
                       "maker drawing", "the flange's rear face at z = 0 (panel side), +Z toward the rear (wires); front toward -Z",
                       lambda pn=pn: port_bodies(pn),
                       [{"n": f"c{k}", "ep": s["end"], "at": [x, y, round(nv["flange_t"] + K.v(s["rear"]), 2)], "dir": [0, 0, 1],
                         "kind": "solder / rear contact"} for k, (x, y) in pins.items()],
                       [("flange width (drawing)", lambda b: round(b[0].bounding_box().size.X, 2), nv["flange_w"], 0.05),
                        ("flange height (drawing)", lambda b: round(b[0].bounding_box().size.Y, 2), nv["flange_h"], 0.05),
                        ("overall depth (drawing)", lambda b, s=s: round(b[0].bounding_box().size.Z, 2), K.v(s["depth"]), 0.3)],
                       extra={"notes": [s["pins_src"]]}, rows=rows))
    tv = {k: K.v(d) for k, d in TX07.items()}
    for end, kind, pn in (("FIREWALL-CABIN", "receptacle", "D38999/24WJ61SN"), ("FIREWALL-ENGINE", "plug", "D38999/26WJ61PN")):
        cav = _reg_cavities(end)
        P = dict(TX07 if kind == "receptacle" else TX06)
        P.update({f"adapter_{k}": d for k, d in ADAPT.items()})
        rows = [{"pin": k, "endpoint": end, "name": f"{pn} cavity {k}", "match": rf"^{k}$", "at": (0.0, 0.0, 30.0), "dir": (0, 0, 1),
                 "full_name": f"{pn} cavity {k} (61-pin 25-61 arrangement; the cavity's position on the insert is not mapped here)"}
                for k in cav]
        chk = ([("flange square W (MILNEC)", lambda b: round(b[0].bounding_box().size.X, 2), tv["W"], 0.05)] if kind == "receptacle" else
               [("coupling ring A (MILNEC)", lambda b: round(b[0].bounding_box().size.X, 2), K.v(TX06["A"]), 0.05)])
        out.append(_ns(end, [end], f"{pn} ({'jam-nut receptacle, sockets' if kind == 'receptacle' else 'plug, pins'}), shell 25, 61 x #20, "
                       "olive drab, with its M85049/69-25N adapter", "MIL-DTL-38999 Series III (MILNEC TX07 / TX06 dims)", pn, P,
                       {"shell": OD_COL, "insert": ("#2a2a2a", "insert: dark (catalog photos)")}, "datasheet dims",
                       "the receptacle's flange face at z = 0 (+Z toward the cabin wires)" if kind == "receptacle" else
                       "the plug's coupling face at z = 0 (+Z toward the engine loom)",
                       lambda kind=kind: d38999_bodies(kind),
                       [{"n": "bundle", "ep": end, "at": [0.0, 0.0, 30.0], "dir": [0, 0, 1], "kind": "61-way bundle through the adapter"}],
                       chk, kind="assembly",
                       extra={"pieces": [pn, "M85049/69-25N"], "missing": ["202K163-25-0 shrink boot (dimensions not on file)",
                                                                           "M39029 size-20 contacts (slash-sheet dimensions not on file)"],
                              "unknowns": ["The M85049/69-25N length is assumed (22 +-8); its diameter is the families.yaml figure.",
                                           "The 61 cavity positions (25-61 arrangement, MILNEC insert arrangements p.4) are not mapped: "
                                           "pins.json lists each registry cavity at the bundle exit."]}, rows=rows))
    kv = {k: K.v(d) for k, d in KOSP.items()}
    out.append(_ns("TRANS-CASE", ["TRANS-CASE"], "6L90 external case connector: Kostal LKS 1.5 16-cavity pin housing (case side) mated "
                   "with the socket housing GM 19303772 (Kostal 09430010) on the PCS harness", "Kostal", "09330004 + 09430010 (GM 19303772)",
                   dict(KOSP), {"housings": ("#1f2022", f"{KOS}: product photos, black")}, "datasheet dims",
                   "the mating plane at z = 0; the case side toward -Z, the harness socket toward +Z", kostal_bodies,
                   [{"n": "harness", "ep": "TRANS-CASE", "at": [0.0, 0.0, kv["sock_L"]], "dir": [0, 0, 1], "kind": "16-way harness exit"}],
                   [("socket housing length (Kostal)", lambda b: round(b[1].bounding_box().size.Z, 2), kv["sock_L"], 0.05)],
                   kind="assembly", extra={"pieces": ["09330004", "09430010"], "missing": [],
                                           "unknowns": ["Only the envelopes are Kostal's; the round body, bayonet and lever are "
                                                        "drawn from the POP photos without a scale (shape only)."]}))
    av = {k: K.v(d) for k, d in AEMP.items()}
    rows = [{"pin": k, "endpoint": "FUELP", "name": f"AEM pin {k}", "match": nm, "at": (0.0, 0.0, av["L"]), "dir": (0, 0, 1)}
            for k, nm in (("1", r"^0 V"), ("2", r"^5 V"), ("3", r"^signal"))]
    out.append(_ns("FUELP", ["FUELP"], "AEM 30-2131-100 fuel pressure sensor, 0-100 psig, 1/8-27 NPT, Packard 3-pin (its mating plug "
                   "comes in the kit)", "AEM Electronics", "30-2131-100", dict(AEMP),
                   {"brass": ("#c9a45a", f"{AEM}: 'Body Material: Brass'"), "body": ("#b9bcbd", "AEM photo: steel body"),
                    "connector": ("#1c1c1c", "AEM photo: black connector")}, "datasheet dims",
                   "the NPT thread's end at z = 0 (into the fuel fitting), the connector up (+Z)", aem_bodies,
                   [{"n": "plug", "ep": "FUELP", "at": [0.0, 0.0, av["L"]], "dir": [0, 0, 1], "kind": "Packard 3-pin"}],
                   [("overall length (AEM)", lambda b: round(Compound(children=b).bounding_box().size.Z, 2), av["L"], 0.1),
                    ("hex across flats (AEM)", lambda b: round(b[0].bounding_box().size.Y, 2), av["hex"], 0.05)],
                   kind="assembly", extra={"pieces": ["30-2131-100"], "missing": ["the kit's mating Packard 3-pin plug (not drawn)"]},
                   rows=rows))
    return out


END_NEEDS = {"PORT-UTC": ["NC5FD-L-1"], "PORT-ETH": ["NE8FDP"]}


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
