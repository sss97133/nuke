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
# The 25-61 insert arrangement: every contact's centre and letter read from the vectors of MILNEC's insert arrangement
# page (the contact circles and the letter text, located with pdftocairo and pdftotext), lettered by the drawing's own
# spiral (A-Z without I O Q round the outside from the top right, then a-z without l o, then AA-PP inward); every printed
# letter sits within 4.5 pt of the contact it names. Figure frame: x right, y up, pt, from the centre contact PP, as the
# page draws the front face of the PIN insert. Positions are exact to the drawing; the absolute SCALE is assumed.
IA = CD + "MILNEC_D38999_insert_arrangements.pdf p.B-22 (PDF p.4), 25-61, 'Front face of pin insert shown'"
ARR_25_61_PT = {
    "A": (10.53, 24.46), "B": (16.40, 21.42), "C": (20.97, 16.63), "D": (24.67, 10.55), "E": (26.62, 4.24),
    "F": (27.49, -2.28), "G": (26.41, -8.91), "H": (22.93, -15.11), "J": (19.01, -19.90), "K": (14.01, -23.60),
    "L": (8.57, -26.21), "M": (0.00, -27.40), "N": (-8.39, -26.64), "P": (-14.70, -23.60), "R": (-19.70, -19.90),
    "S": (-23.61, -15.11), "T": (-26.43, -8.92), "U": (-27.52, -2.28), "V": (-27.31, 4.24), "W": (-25.35, 10.54),
    "X": (-21.65, 16.63), "Y": (-17.09, 20.98), "Z": (-11.21, 24.03), "a": (-4.91, 22.07), "b": (4.22, 22.07),
    "c": (9.34, 17.61), "d": (14.88, 13.37), "e": (18.69, 8.26), "f": (20.21, 1.52), "g": (20.75, -4.89),
    "h": (18.14, -11.20), "i": (13.36, -15.98), "j": (7.92, -19.35), "k": (0.00, -20.01), "m": (-8.17, -19.35),
    "n": (-14.04, -15.98), "p": (-17.96, -11.41), "q": (-20.78, -5.33), "r": (-20.89, 1.52), "s": (-19.37, 7.83),
    "t": (-15.56, 13.37), "u": (-10.02, 17.61), "v": (0.00, 16.31), "w": (8.14, 10.76), "x": (12.58, 5.80),
    "y": (14.01, -1.19), "z": (11.62, -7.28), "AA": (7.27, -12.07), "BB": (0.00, -13.92), "CC": (-7.95, -12.07),
    "DD": (-12.30, -7.28), "EE": (-14.70, -1.19), "FF": (-13.28, 5.43), "GG": (-8.82, 10.33), "HH": (0.00, 9.57),
    "JJ": (5.20, 4.03), "KK": (7.38, -2.17), "LL": (0.00, -7.18), "MM": (-8.06, -2.17), "NN": (-6.54, 4.03),
    "PP": (0.00, -0.00)
}
ARR_CIRCLE_PT = 65.80              # the drawn insert circle's diameter, pt
INSERT_D = D(38.2, "the insert diameter the batch-5 receptacle model draws (TX07 M 43.4 less 2 x 2.6)", "assumed",
             "red: the absolute scale of the arrangement; needs the MIL-STD-1560 sheet for 25-61, or calipers on the insert")
CAV_D = D(1.2, "not on file", "assumed", "red: the cavity holes are drawn 1.2 across; the M39029 contacts are not drawn")
CAV_DEPTH = D(3.0, "not on file", "assumed", "red: the holes' drawn depth")


def cavity_xy(kind, letter):
    """A cavity's centre in the half's own frame (mating face toward -Z, wires +Z, Y up), mm. Seen from its mating face
    (from -Z) the viewer's right is -X, so the pin face as drawn maps x -> -X on the plug. The socket face is the pin face
    mirrored, so the same letter meets its mate: x -> +X on the receptacle."""
    sc = K.v(INSERT_D) / ARR_CIRCLE_PT
    x, y = ARR_25_61_PT[letter]
    return (round((-x if kind == "plug" else x) * sc, 3), round(y * sc, 3))


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
        ins = cyl_z(tv["M"] / 2 - 2.6, -11.0, tv["L"] - 13.0, 0, 0)
        for k in ARR_25_61_PT:
            x, y = cavity_xy(kind, k)
            ins -= cyl_z(K.v(CAV_D) / 2, -11.0 - 1.0, -11.0 + K.v(CAV_DEPTH), x, y)
        out.append(K.body(ins, "D38999 25-61 insert (61 x #20 sockets)", "#2a2a2a"))
        za = tv["L"] - 12.0
    else:
        ring = cyl_z(pv["A"] / 2, 0.0, 16.0, 0, 0) - cyl_z(pv["A"] / 2 - 3.0, -1, 17, 0, 0)
        body = cyl_z(pv["A"] / 2 - 3.0, 0.0, pv["L"], 0, 0) - cyl_z(pv["A"] / 2 - 5.5, -1, 8.0, 0, 0)
        body += cyl_z(pv["V"] / 2, pv["L"] - 6.0, pv["L"], 0, 0)
        out += [K.body(ring, "D38999/26WJ61PN coupling ring", OD_COL[0], finish="paint"),
                K.body(body, "D38999/26WJ61PN shell (plug)", OD_COL[0], finish="paint")]
        ins = cyl_z(pv["A"] / 2 - 5.6, 1.0, pv["L"] - 7.0, 0, 0)
        for k in ARR_25_61_PT:
            x, y = cavity_xy(kind, k)
            ins -= cyl_z(K.v(CAV_D) / 2, 0.0, 1.0 + K.v(CAV_DEPTH), x, y)
        out.append(K.body(ins, "D38999 25-61 insert (61 x #20 pins)", "#2a2a2a"))
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
AEMS = "scaled at the printed 15/16 in hex (211 px) and 2.15 in overall (483 px) of the side view, 300 dpi render"
AEMF = ("scaled off the p.1 pinout view ('Pinout Shown Looking At Sensor', undimensioned) at the connector OD: the outer "
        "circle is 379.5 px")
AEMP = {"L": D(54.6, f"{AEM} drawing '2.15' in overall"),
        "hex_l": D(19.3, f"{AEM} drawing '0.76' in", note="the hex with its lip and its chamfer"),
        "thread_l": D(10.2, f"{AEM} drawing '0.40' in thread", note="1/8-27 NPT"),
        "hex": D(23.8, f"{AEM} drawing '15/16' in hex across flats"),
        "thread_d": D(10.2, f"{AEM} side view, {AEMS}", "scaled",
                      "+-0.3: the sheet names the thread '1/8\" - 27 NPT' and prints no diameter"),
        "lip_l": D(2.1, f"{AEM} side view, {AEMS}", "scaled", "+-0.3: the rounded lip behind the hex"),
        "chamfer_l": D(2.5, f"{AEM} side view, {AEMS}", "scaled", "+-0.3: the hex's taper to the thread"),
        "neck_d": D(11.2, f"{AEM} side view, {AEMS}", "scaled", "+-0.5"),
        "conn_d": D(17.0, f"{AEM} side view, {AEMS}", "scaled", "+-0.5: the Packard 3-pin connector end, 150.5 px tall"),
        "conn_l": D(10.1, f"{AEM} side view, {AEMS}", "scaled", "+-0.5"),
        "bore_d": D(12.9, f"{AEM} {AEMF}", "scaled", "+-20 %: the second circle, the shroud's bore"),
        "tower_w": D(8.4, f"{AEM} {AEMF}", "scaled", "+-20 %: the keyed terminal tower (188 px wide)"),
        "tower_h": D(8.6, f"{AEM} {AEMF}", "scaled", "+-20 %: 191.5 px tall"),
        "cav_l": D(3.05, f"{AEM} {AEMF}", "scaled", "+-20 %: each terminal's recess, 68 x 30 px"),
        "cav_w": D(1.34, f"{AEM} {AEMF}", "scaled", "+-20 %"),
        "blade_w": D(1.75, f"{AEM} {AEMF}", "scaled", "+-20 %: the blade line inside each recess, 39 px"),
        "gnd_x": D(-1.99, f"{AEM} {AEMF}: SIG GND upper left", "scaled", "+-0.4"),
        "pwr_x": D(1.95, f"{AEM} {AEMF}: 5 VOLTS upper right", "scaled", "+-0.4"),
        "top_y": D(1.75, f"{AEM} {AEMF}: the two upper blades", "scaled", "+-0.4"),
        "sig_x": D(-0.45, f"{AEM} {AEMF}: Signal (Input), the vertical blade", "scaled",
                   "+-0.4: drawn 10 px left of the centre; kept as drawn"),
        "sig_y": D(-2.31, f"{AEM} {AEMF}", "scaled", "+-0.4"),
        "key_w": D(1.66, f"{AEM} {AEMF}: the key at the top", "scaled", "+-20 %"),
        "key_r": D(7.50, f"{AEM} {AEMF}: the key's outer edge", "scaled", "+-20 %"),
        "bore_depth": D(8.0, "not printed", "assumed", "red: the bore's depth"),
        "tower_gap": D(1.0, "not printed", "assumed", "red: the tower stops 1.0 below the mouth"),
        "cav_depth": D(2.0, "not printed", "assumed", "red: the recess depth"),
        "blade_t": D(0.6, "not printed", "assumed", "red: the blade's thickness")}
AEM_PINS = (("SIG GND", "gnd_x", "top_y", "h", r"^0 V", "Signal Ground (SIG GND): upper left, looking at the sensor"),
            ("5 V", "pwr_x", "top_y", "h", r"^5 V", "Sensor Power (5 VOLTS): upper right, looking at the sensor"),
            ("Signal", "sig_x", "sig_y", "v", r"^signal", "Signal (Input): the vertical blade below, looking at the sensor"))


def aem_bodies():
    """Frame: the thread's end at z = 0, the connector's mouth at z = L; looking at the sensor (from +Z) the key is at
    +Y and +X is to the right, as the pinout view shows it."""
    v = {k: K.v(d) for k, d in AEMP.items()}
    L = v["L"]
    z_hex0 = v["thread_l"]
    z_hex1 = v["thread_l"] + v["hex_l"]
    z_conn = L - v["conn_l"]
    thread = cyl_z(v["thread_d"] / 2, 0.0, z_hex0, 0, 0)
    af = v["hex"]
    hexb = Pos(0, 0, z_hex0 + v["chamfer_l"]) * extrude(RegularPolygon(af / 2 / math.cos(math.pi / 6), 6, major_radius=True),
                                                         amount=v["hex_l"] - v["chamfer_l"] - v["lip_l"])
    taper = cyl_z(af / 2 * 0.8, z_hex0, z_hex0 + v["chamfer_l"], 0, 0)
    lip = cyl_z(af / 2 * 0.93, z_hex1 - v["lip_l"], z_hex1, 0, 0)
    neck = cyl_z(v["neck_d"] / 2, z_hex1, z_conn, 0, 0)
    shell = cyl_z(v["conn_d"] / 2, z_conn, L, 0, 0) - cyl_z(v["bore_d"] / 2, L - v["bore_depth"], L + 1, 0, 0)
    shell -= box(-v["key_w"] / 2, v["key_w"] / 2, 0.0, v["key_r"], L - 3.0, L + 1)
    z_tt = L - v["tower_gap"]
    tower = box(-v["tower_w"] / 2, v["tower_w"] / 2, -v["tower_h"] / 2, v["tower_h"] / 2, L - v["bore_depth"], z_tt)
    blades = None
    for _, kx, ky, o, _m, _n in AEM_PINS:
        x, y = v[kx], v[ky]
        cl, cw = (v["cav_l"], v["cav_w"]) if o == "h" else (v["cav_w"], v["cav_l"])
        tower -= box(x - cl / 2, x + cl / 2, y - cw / 2, y + cw / 2, z_tt - v["cav_depth"], z_tt + 1)
        bl, bt = (v["blade_w"], v["blade_t"]) if o == "h" else (v["blade_t"], v["blade_w"])
        b = box(x - bl / 2, x + bl / 2, y - bt / 2, y + bt / 2, z_tt - v["cav_depth"] - 0.5, z_tt)
        blades = b if blades is None else blades + b
    return [K.body(thread + taper + hexb + lip, "AEM 30-2131-100 brass body, hex and 1/8-27 NPT thread", "#c9a45a", finish="metal"),
            K.body(neck + shell, "AEM 30-2131-100 Packard 3-pin connector shell", "#1c1c1c"),
            K.body(tower, "AEM 30-2131-100 terminal tower", "#232323"),
            K.body(blades, "AEM 30-2131-100 terminal blades (SIG GND, 5 V, Signal)", "#c8c9c4", finish="metal")]


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
        P.update({"insert_d": INSERT_D, "cavity_d": CAV_D, "cavity_depth": CAV_DEPTH})
        z_face = -11.0 if kind == "receptacle" else 1.0
        z_rear = (K.v(TX07["L"]) - 13.0) if kind == "receptacle" else (K.v(TX06["L"]) - 7.0)
        rows = []
        for k in ARR_25_61_PT:
            x, y = cavity_xy(kind, k)
            rows.append({"pin": k, "endpoint": end, "name": f"{pn} cavity {k}", "match": rf"(?-i:^{k}$)",   # a and A differ
                         "at": (x, y, z_face), "wire_at": (x, y, z_rear), "dir": (0, 0, 1),
                         "full_name": f"{pn} cavity {k}: 25-61 position from MILNEC's arrangement (exact to the drawing), "
                                      f"scale assumed (insert Ø{K.v(INSERT_D):g})"
                                      + ("" if k in cav else "; no registry wire (empty)")})
        chk = ([("flange square W (MILNEC)", lambda b: round(b[0].bounding_box().size.X, 2), tv["W"], 0.05)] if kind == "receptacle" else
               [("coupling ring A (MILNEC)", lambda b: round(b[0].bounding_box().size.X, 2), K.v(TX06["A"]), 0.05)])
        chk.append(("25-61 cavities cut in the insert",
                    lambda b: sum(1 for f in [x for x in b if "25-61 insert" in (x.label or "")][0].faces()
                                  if f.geom_type.name == "CYLINDER") - 1, 61, 0))
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
                                           "The 61 cavity positions are from MILNEC's 25-61 arrangement (exact to the drawing); "
                                           f"the absolute scale is ASSUMED (insert Ø{K.v(INSERT_D):g} from the batch-5 model). Needs: "
                                           "the MIL-STD-1560 sheet for 25-61, or calipers on the insert.",
                                           "The socket face is the pin face mirrored so each letter meets its mate: seen from its "
                                           "mating face, the plug's cavity x is the figure's -x and the receptacle's is +x.",
                                           "The cavity holes (Ø1.2, 3 deep) are drawn, not the M39029 contacts."]}, rows=rows))
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
    rows = [{"pin": k, "endpoint": "FUELP", "name": k, "full_name": f"{nm} ({AEM}, pinout view)", "match": rx,
             "at": (av[kx], av[ky], av["L"] - av["tower_gap"]), "dir": (0, 0, 1)}
            for k, kx, ky, _o, rx, nm in AEM_PINS]
    out.append(_ns("FUELP", ["FUELP"], "AEM 30-2131-100 fuel pressure sensor, 0-100 psig, 1/8-27 NPT, Packard 3-pin (its mating plug "
                   "comes in the kit)", "AEM Electronics", "30-2131-100", dict(AEMP),
                   {"brass": ("#c9a45a", f"{AEM}: 'Body Material: Brass'"),
                    "connector": ("#1c1c1c", f"{CD}AEM_30-2131 p.2 Figure 1 photo: the mating plug is black (the sensor's "
                                  "own connector colour is not shown: drawn black)"),
                    "blades": ("#c8c9c4", "tin-plated terminals (colour assumed)")}, "datasheet dims",
                   "the NPT thread's end at z = 0 (into the fuel fitting), the connector up (+Z)", aem_bodies,
                   [{"n": "plug", "ep": "FUELP", "at": [0.0, 0.0, av["L"]], "dir": [0, 0, 1], "kind": "Packard 3-pin"}],
                   [("overall length (AEM)", lambda b: round(Compound(children=b).bounding_box().size.Z, 2), av["L"], 0.1),
                    ("hex across flats (AEM)", lambda b: round(b[0].bounding_box().size.Y, 2), av["hex"], 0.05),
                    ("connector OD (scaled)", lambda b: round(b[1].bounding_box().size.X, 2), av["conn_d"], 0.05)],
                   kind="assembly",
                   extra={"pieces": ["30-2131-100"],
                          "missing": ["the kit's mating Packard 3-pin plug (AEM: 'Each sensor comes with a mating connector plug "
                                      "and pin kit'; it names no part number and prints no drawing, so it is not drawn)"],
                          "unknowns": ["AEM prints no pin numbers or letters. The pins are named by the function and place its "
                                       "p.1 pinout view shows, looking at the sensor: SIG GND upper left, 5 VOLTS upper "
                                       "right, Signal (Input) the vertical blade below. Each wire takes its pin from the "
                                       "function in the registry's cavity text (0 V, 5 V, signal).",
                                       "The connector face is scaled off an undimensioned pinout view (+-20 %); the bore "
                                       "depth, the tower height, the recess depth and the blade thickness are assumed (red)."]},
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
