#!/usr/bin/env python3
"""Deutsch DT / DTM / DTP family (TE Connectivity): every Deutsch housing the K5 harness uses, both halves of every
pair, the two flange gaskets, and each end's mated pair as one assembly.

Numbers, in order of trust:
  maker   TE / Deutsch documents: the DT family catalog p.19 dimension tables (overall length, height and width of every
          plug and receptacle), TE's product page for each part number (pitch, row spacing, pin diameter, colour, key),
          TE customer drawing DT04-12PX-L012 (flange, holes, panel cutout, shroud and flange lengths, cavity numbering)
          and the TE drawing-viewer screenshots on file (DT04-6P-L012, DT04-08PX, DTP04-4P-L012, DTM04-4P).
  scaled  measured off those TE drawings at a printed dimension (named in each note).
  vendor  a number only a distributor page states (ProWire's DT 6-way flange thickness).
  photo   proportions TE does not print (shroud length, latch, bridge, seal ring, nose depth), measured off the
          customconnectorkits.com product photos of the same part number, scaled from the part's own catalog length or
          width. They shape the look; the envelope, the pitch and the flange stay the maker's.
  design  derived so the two halves mate: the plug nose is the receptacle's shroud opening less 0.3 mm, the latch rides
          under the receptacle's bridge.
Cavity numbering is read off the numbers moulded on the parts (TE drawing, product photos) where they are legible; where
they are not, the positions are drawn and the numbers are marked not sourced.

Frame (every piece and assembly, mm): origin at the centre of the mating plane (the receptacle's shroud mouth, where
the plug's shoulder stops), +Z toward the plug, so the receptacle lies at z < 0 and its wires leave toward -Z, the plug
body lies at z > 0 and its wires leave toward +Z. +Y is the latch side (the receptacle's bridge, the plug's lock arm;
for the 8- and 12-way, which latch at both ends, the side with the receptacle's top plate or hood). Seen from the
receptacle's wire side (from -Z) +X is on the left.
    ~/k5-harness-pull/parts/.venv/bin/python docs/wiring/calc-data/cad/fab/fam_deutsch.py <out_root> [id ...]
"""
import copy
import json
import math
import re
import sys
import types
from pathlib import Path

from build123d import Align, Box, Circle, Compound, Cylinder, Plane, Pos, RectangleRounded, extrude, make_hull, Sketch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import contacts as CT  # noqa: E402
from k5cad import Dim  # noqa: E402

# ------------------------------------------------------------------------------------------ sources
CAT = "reference_documents/component_drawings/DEUTSCH_DT_DTM_DTP_Catalog.pdf (Deutsch DT family catalog)"
CAT19 = f"{CAT} p.19 (PDF p.3), dimension tables"
CAT20 = f"{CAT} p.20 (PDF p.4), insert arrangements"
CAT21 = f"{CAT} pp.21-22 (PDF pp.5-6), secondary wedgelocks"
CAT24 = f"{CAT} p.24 (PDF p.8), gaskets: 'thickness of .125\"'"
DWG12 = "reference_documents/component_drawings/Deutsch_DT04-12PX-L012_customer_drawing.pdf (TE, rev D2)"
SH6 = "reference_documents/component_drawings/TE_DT04-6P-L012_*_screenshot_2026-09-28.jpg (TE drawing viewer)"
SH8 = "reference_documents/component_drawings/TE_DT04-08PX-XXXX_figure1-front-view_screenshot_2026-09-28.jpg (TE)"
SHP4 = "reference_documents/component_drawings/TE_DTP04-4P-L012_*_screenshot_2026-09-28.jpg (TE drawing viewer)"
SHM4 = "reference_documents/component_drawings/TE_DTM04-4P_front-view-fit-zoom_screenshot_2026-09-28.png (TE)"
PW6 = "reference_documents/web_snapshots/www.prowireusa.com__p-2900-dt-6-way-flanged-receptacle.md (ProWire)"
ESEAL = "docs/wiring/calc-data/catalog/deutsch_eseal.yaml"


def TE(pn):
    return f"te.com/en/product-{pn}.html (TE product page, read 2026-09-29)"


def PH(pn):
    return f"customconnectorkits.com/products/{pn.lower()} product photos (fetched 2026-09-29)"


def D(v, src, basis="maker", note="", fit=""):
    return Dim(v, src, basis, note, fit)


# ------------------------------------------------------------------------------------------ the series
SERIES = {
    "DT": {"contact": "size 16", "pin_d": D(1.59, TE("DT06-12SA") + ": 'Mating Pin Diameter 1.59 mm'"),
           "hole_d": 2.2, "boss_d": 3.9, "pin_part": "0460-202-16141", "socket_part": "0462-201-16141"},
    "DTM": {"contact": "size 20", "pin_d": D(1.02, TE("DTM06-4S") + ": 'Mating Pin Diameter 1.02 mm'"),
            "hole_d": 1.7, "boss_d": 3.0, "pin_part": "0460-202-20141", "socket_part": "0462-201-20141"},
    "DTP": {"contact": "size 12", "pin_d": D(2.39, TE("DTP06-4S") + ": 'Mating Pin Diameter 2.39 mm'"),
            "hole_d": 3.2, "boss_d": 5.6, "pin_part": "0460-204-12141", "socket_part": "0462-203-12141"},
}
SHOULDER = {   # contact retention shoulder behind the receptacle's mouth
    "DT": D(17.20, f"{CT.CAT} p.128, PCB pins table: product DT04-2P / DT04-3P 'D' .677 (17.20), the contact shoulder to "
                   "the end of the connector", note="read as the mating end: it puts the pin 4.3 mm into the socket at the "
                   "photo-scaled nose depth; for the DT 6, 8 and 12-way the 2-way's figure is used (sibling)"),
    "DTP": D(19.74, f"{CT.CAT} p.128, PCB pins table: product 'DT' .777 (19.74), the size-12 pin row", note="read as for DT"),
}
PHOTO_SET = "the customconnectorkits product photos of this part number (front and back, fetched 2026-09-29)"
# family proportions, each measured once on the named photo against that part's catalog length or width (+-10 %)
PROP = {
    "shroud_f": D(0.45, PH("DT04-2P") + ", DTP04-2P, DTM04-4P: shroud (mouth to the step onto the rear body) over the "
                  "catalog length", "photo", "0.45 of the overall length, +-10 %"),
    "bridge_h_f": D(0.19, PH("DT04-2P") + ": bridge height over the catalog height 17.02", "photo", "+-15 %"),
    "bridge_l_f": D(0.42, PH("DT04-2P") + ": bridge length over the shroud length", "photo", "+-15 %"),
    "bridge_w_f": D(0.62, PH("DT04-2P") + ": bridge width over the catalog width 17.15", "photo", "+-10 %"),
    "wall_f": D(0.085, PH("DT04-2P") + ": shroud rim over the catalog width", "photo", "+-20 %"),
    "rear_w_f": D(0.82, "TE DTP04-4P-L012 drawing (" + SHP4 + "): rear body .868 [22.05] over the 26.9 shroud "
                  "(TE page); used for every top-latch receptacle", "scaled", "sibling drawing for DT and DTM"),
    "rear_h_f": D(0.711, "TE DTP04-4P-L012 drawing (" + SHP4 + "): rear body .760 [19.30] over the 1.069 [27.15] "
                  "height; used for every top-latch receptacle", "scaled", "sibling drawing for DT and DTM"),
    "nose_f": D(0.40, PH("DT06-2S") + ", DT06-12SA: nose (front face to the shoulder) over the catalog length 28.4",
                "photo", "sets how far the plug goes in; the mated length follows. +-10 %",
                "fit-critical, photo-scaled: TE prints no mated length"),
    "latch_z0_f": D(0.28, PH("DT06-2S") + ": lock arm front over the plug length", "photo", "+-10 %"),
    "latch_z1_f": D(0.97, PH("DT06-2S") + ": lock arm rear (press pad) over the plug length", "photo"),
    "latch_w_f": D(0.42, PH("DT06-2S") + ": lock arm width over the catalog width 15.01", "photo", "+-10 %"),
    "post_f": D(0.20, PH("DT06-2S") + ": guard posts (rear 0.20 of the length) either side of the press pad",
                "photo", "+-15 %"),
    "seal_f": D(0.55, PH("DT06-2S") + ": interface seal ring, rear 0.55 of the nose", "photo", "+-15 %"),
    "arm_t": D(1.8, PH("DT06-12SA") + ": end lock arm thickness, against the 40.56 catalog width", "photo", "+-0.5"),
    "arm_h_f": D(0.55, PH("DT06-12SA") + ": end lock arm height over the catalog height 18.19", "photo", "+-10 %"),
}


def pv(k):
    return K.v(PROP[k])


# ------------------------------------------------------------------------------------------ cavity layouts
def rows2(n, pitch, row, gap=None):
    """Two rows, n cavities in all (DT 8, 12): seen from the receptacle's wire side the bottom row reads 1..k left to
    right and the top row n..k+1 (TE DT04-12PX-L012 wire-side view; DT04-08PA and DT04-12PA-L012 moulded numbers), k =
    n / 2. From -Z, left is +X. `gap` is a wider centre space (8-way)."""
    xs = []
    k = n // 2
    half = k // 2
    for i in range(half):
        off = (gap / 2 if gap else pitch / 2) + i * pitch
        xs.append(off)
    xs = sorted([-x for x in xs] + xs, reverse=True)          # +X first
    out = {}
    for i, x in enumerate(xs):
        out[str(i + 1)] = (round(x, 3), round(-row / 2, 3))
    for i, x in enumerate(reversed(xs)):
        out[str(k + i + 1)] = (round(x, 3), round(row / 2, 3))
    return out


def cols2x3(col, row):
    """DT 6-way, latch up, from the wire side: 1-2-3 down the left column, 4-5-6 up the right (DT04-6P-L012 and
    DT06-6S moulded numbers). From -Z, left is +X."""
    c, r = col / 2, row
    return {"1": (c, r), "2": (c, 0.0), "3": (c, -r), "4": (-c, -r), "5": (-c, 0.0), "6": (-c, r)}


def grid2x2(col, row):
    """DTP 4-way, bridge up, from the wire side: 1 top-left, 2 bottom-left, 3 bottom-right, 4 top-right (DTP04-4P-L012
    moulded numbers; TE's DTP04-4P-L012 view prints the same order)."""
    c, r = col / 2, row / 2
    return {"1": (c, r), "2": (c, -r), "3": (-c, -r), "4": (-c, r)}


def row1(n, pitch):
    """One row; numbers NOT sourced (not legible on the photos): drawn 1 at +X."""
    x0 = (n - 1) * pitch / 2
    return {str(i + 1): (round(x0 - i * pitch, 3), 0.0) for i in range(n)}


# ------------------------------------------------------------------------------------------ colours (photos / maker)
def PHC(pn, hexc, what):
    return (hexc, f"{PH(pn)}: {what} (k-means of the photos, dominant cluster)")


GREY_NOTE = "TE: 'Gray'"
BLACK = ("#1e1f21", "maker's stated colour, TE: 'Black' (the studio photos read about #555052 under their light)")
NICKEL = ("#b9bbb8", "maker's stated finish: nickel-plated contacts (TE contact pages); colour not sampled")

# ------------------------------------------------------------------------------------------ the pieces
REC = {}   # receptacles (04, pins)
PLG = {}   # plugs (06, sockets)


def rec(pn, **kw):
    kw["pn"] = pn
    kw["kind"] = "receptacle"
    REC[pn] = kw


def plg(pn, **kw):
    kw["pn"] = pn
    kw["kind"] = "plug"
    PLG[pn] = kw


# --- DT 2-way (FUEL-LEVEL, above the tank lid)
rec("DT04-2P", series="DT", style="top", ways=2, mate="DT06-2S", endpoints=["FUEL-LEVEL"],
    L=D(43.38, f"{CAT19} (DT receptacle, 2 cavity, D); {TE('DT04-2P')} 'Product Length 43.38'"),
    W=D(17.15, f"{CAT19} (F); {TE('DT04-2P')} 'Product Width 17.15'"),
    H=D(17.02, f"{CAT19} (E); {TE('DT04-2P')} 'Connector Height 17.02'"),
    pitch=D(5.46, f"{TE('DT04-2P')}: 'Centerline (Pitch) 5.46 mm'"),
    grid=row1(2, 5.46), numbering=None, wedge=("W2P", PHC("W2P", "#75b995", "green wedgelock")),
    body=PHC("DT04-2P", "#79716e", "grey housing; " + GREY_NOTE), grommet=PHC("DT04-2P", "#b14229", "orange-red grommet"))
plg("DT06-2S", series="DT", style="top", ways=2, mate="DT04-2P", endpoints=["FUEL-LEVEL"],
    A=D(28.4, f"{CAT19} (DT plug, 2 cavity, A); {TE('DT06-2S')} 'Product Length 28.4'"),
    C=D(15.01, f"{CAT19} (C); {TE('DT06-2S')} 'Product Width 15.01'"),
    B=D(15.95, f"{CAT19} (B)", note="TE's page states 15.77 (.621 in)"),
    pitch=D(5.46, f"{TE('DT06-2S')}: 'Centerline (Pitch) 5.46 mm'"),
    grid=row1(2, 5.46), numbering=None, wedge=("W2S", PHC("W2S", "#fd9352", "orange wedgelock")),
    body=PHC("DT06-2S", "#756b67", "grey housing; " + GREY_NOTE), grommet=PHC("DT06-2S", "#aa4025", "orange-red grommet and seal"))
# --- DT 6-way flanged (FIREWALL-BODY-C, the speed sender's cab exit)
rec("DT04-6P-L012", series="DT", style="top", ways=6, mate="DT06-6S", endpoints=["FIREWALL-BODY-C"],
    L=D(45.92, f"{CAT19} (DT receptacle, 6 cavity, D); {TE('DT04-6P-L012')} 'Connector Height 45.9'"),
    W=D(20.83, f"{CAT19} (F)"), H=D(24.16, f"{CAT19} (E); {SH6} side view '.951 [24.16]'"),
    pitch=D(9.1, f"{TE('DT04-6P-L012')}: 'Centerline (Pitch) 9.1 mm' (between the two columns)"),
    row=D(4.45, f"{TE('DT04-6P-L012')}: 'Row-to-Row Spacing 4.45 mm', 'Number of Rows 3'"),
    grid=cols2x3(9.1, 4.45), numbering="moulded numbers on the DT04-6P-L012 and DT06-6S photos (1-2-3 down one column, 4-5-6 up the other)",
    wedge=("W6P", PHC("W6P", "#ade4c6", "green wedgelock")),
    body=PHC("DT04-6P-L012", "#9c9793", "grey housing; " + GREY_NOTE), grommet=PHC("DT04-6P-L012", "#b54a33", "orange-red grommet"),
    flange={"kind": "rect", "w": D(35.5, f"{TE('DT04-6P-L012')} 'Product Width 35.5' (the flange across the columns)"),
            "h": D(55.0, f"{TE('DT04-6P-L012')} 'Product Length 55' (along the latch axis); {PW6} '2.16 (54.84)'",
                   note="ProWire states 54.84"),
            "t": D(3.70, f"{PW6}: 'Flange Dimensions ... .146 (3.70) D'", "vendor", "TE prints no thickness on the pages on file",
                   "fit-critical: the panel stack depends on it"),
            "hole_d": D(4.49, f"scaled off {SH6} (wire-side view) at its printed 1.772 [45.01] hole spacing", "scaled",
                        "+-0.2"),
            "hole_x": D(24.0, f"scaled off {SH6} (wire-side view) at its printed 1.772 [45.01]", "scaled", "+-0.3",
                        "fit-critical, scaled"),
            "hole_y": D(45.01, f"{SH6} (wire-side view): '1.772 [45.01]'"),
            "r": D(3.3, f"scaled off {SH6} at its printed 1.772 [45.01]", "scaled"),
            "front": D(20.65, f"{SH6} (side view): '.813 [20.65]', read as the shroud mouth to the flange face",
                       note="the partial view shows one end of it; confirm on the part"),
            "colour": PHC("DT04-6P-L012", "#9c9793", "grey flange")})
plg("DT06-6S", series="DT", style="top", ways=6, mate="DT04-6P-L012", endpoints=["FIREWALL-BODY-C"],
    A=D(30.94, f"{CAT19} (DT plug, 6 cavity, A); {TE('DT06-6S')} 'Product Length 30.94'"),
    C=D(18.19, f"{CAT19} (C); {TE('DT06-6S')} 'Product Width 18.19'"),
    B=D(22.63, f"{CAT19} (B); {TE('DT06-6S')} 'Connector Height 22.63'"),
    pitch=D(9.1, f"{TE('DT04-6P-L012')} (the mating receptacle): 'Centerline (Pitch) 9.1 mm'",
            note="the DT06-6S page states 4.44 / 4.45; its own receptacle's page and drawing give 9.1 x 4.45"),
    row=D(4.45, f"{TE('DT06-6S')}: 'Row-to-Row Spacing 4.45 mm'"),
    grid=cols2x3(9.1, 4.45), numbering="moulded numbers on the DT06-6S photo (4-5-6 / 3-2-1 with the latch at the side)",
    wedge=("W6S", PHC("W6S", "#fb9b63", "orange wedgelock")),
    body=PHC("DT06-6S", "#948d88", "grey housing; " + GREY_NOTE), grommet=PHC("DT06-6S", "#ae3f27", "orange-red grommet and seal"))
# --- DT 8-way (door pass-throughs)
rec("DT04-08PA", series="DT", style="ends", ways=8, mate="DT06-08SA", endpoints=["DOOR-L-PASS", "DOOR-R-PASS"],
    L=D(45.67, f"{CAT19} (DT receptacle, 8 cavity, D); {TE('DT04-08PA')} 'Product Length 45.67'"),
    W=D(36.45, f"{CAT19} (F); {SH8} '1.435 [36.45]'"),
    H=D(25.40, f"{CAT19} (E); {SH8} '1.000 [25.40]'", note="over the top plate; TE's page states 23.88, the shroud without it"),
    Hs=D(23.88, f"{TE('DT04-08PA')} 'Connector Height 23.88'; scaled off {SH8} 23.8", note="the shroud without the top plate"),
    Wb=D(26.7, f"scaled off {SH8} at its printed 1.435 [36.45]", "scaled", "shroud body between the two end catches"),
    pitch=D(4.44, f"{TE('DT04-08PA')}: 'Centerline (Pitch) 4.44 mm'"),
    gap=D(5.42, f"scaled off {SH8} at its printed 1.435 [36.45]", "scaled", "the wider space between cavities 2 and 3"),
    row=D(9.12, f"{TE('DT06-08SA')} (the mating plug): 'Row-to-Row Spacing 9.12 mm'",
          note="the DT04-08PA page states 4.45, which its own figure contradicts (scaled 9.0)"),
    grid=rows2(8, 4.44, 9.12, gap=5.42), numbering="TE DT04-08PX figure 1 and the DT04-08PA / DT06-08SA moulded numbers",
    wedge=("W8P", PHC("W8P", "#8cd8b1", "green wedgelock")),
    body=PHC("DT04-08PA", "#958e8c", "grey housing; " + GREY_NOTE), grommet=PHC("DT04-08PA", "#bf482e", "orange-red grommet"))
plg("DT06-08SA", series="DT", style="ends", ways=8, mate="DT04-08PA", endpoints=["DOOR-L-PASS", "DOOR-R-PASS"],
    A=D(30.91, f"{CAT19} (DT plug, 8 cavity, A); {TE('DT06-08SA')} 'Product Length 30.91'"),
    C=D(37.21, f"{CAT19} (C); {TE('DT06-08SA')} 'Connector Height 37.21'"),
    B=D(19.71, f"{CAT19} (B); {TE('DT06-08SA')} 'Product Width 19.71'"),
    pitch=D(4.44, f"{TE('DT06-08SA')}: 'Centerline (Pitch) 4.44 mm'"),
    row=D(9.12, f"{TE('DT06-08SA')}: 'Row-to-Row Spacing 9.12 mm'"),
    grid=rows2(8, 4.44, 9.12, gap=5.42), numbering="DT06-08SA moulded numbers (1-2-3-4 / 8-7-6-5)",
    wedge=("W8S", PHC("W8S", "#fca56c", "orange wedgelock")),
    body=PHC("DT06-08SA", "#b1aaa9", "grey housing; " + GREY_NOTE), grommet=PHC("DT06-08SA", "#da583b", "orange-red grommet and seal"))
# --- DT 12-way flanged (FIREWALL-BODY-A grey A key, FIREWALL-BODY-B black B key)
for key, colour, ends, recpn, plgpn in (("A", "grey", ["FIREWALL-BODY-A"], "DT04-12PA-L012", "DT06-12SA"),
                                        ("B", "black", ["FIREWALL-BODY-B"], "DT04-12PB-L012", "DT06-12SB")):
    body = PHC(recpn, "#a9a39f", "grey housing; " + GREY_NOTE) if key == "A" else BLACK
    rec(recpn, series="DT", style="ends", ways=12, mate=plgpn, endpoints=ends, key=key,
        L=D(45.92, f"{DWG12} sheet 1 side view '1.808 [45.92]'; {CAT19} (D)"),
        W=D(40.56, f"{DWG12} sheet 1 '1.597 [40.56]' (over the end catches); {CAT19} (F)"),
        H=D(22.25, f"{DWG12} sheet 1 '.876 [22.25]'; {CAT19} (E)"),
        Wb=D(35.0, f"scaled off {DWG12} sheet 1 top view at its printed 2.170 [55.12]", "scaled",
             "shroud body between the end catches"),
        ear_h=D(9.8, f"scaled off {DWG12} sheet 1 side view at its printed 1.808 [45.92]", "scaled", "end catch height"),
        Ls=D(19.81, f"{DWG12} sheet 1 side view '.780 [19.81]' (the mouth to the flange)"),
        rear_w=D(31.7, f"scaled off {DWG12} sheet 1 top view at its printed 2.170 [55.12]", "scaled", "rear body width"),
        rear_h=D(18.4, f"scaled off {DWG12} sheet 1 side view at its printed 1.808 [45.92]", "scaled", "rear body height"),
        hood=(13.4, 6.2, 2.0),
        pitch=D(4.44, f"{TE(recpn)}: 'Centerline (Pitch) 4.44 mm'"),
        row=D(9.12, f"{TE(plgpn)} (the mating plug): 'Row-to-Row Spacing 9.12 mm'",
              note=f"the {recpn} page states 4.45; the drawing's cavity rows scale to 9.1"),
        grid=rows2(12, 4.44, 9.12), numbering=f"{DWG12} sheet 1 wire-side view (12..7 / 1..6) and the moulded numbers on the photos",
        wedge=("W12P", PHC("W12P", "#91d9b3", "green wedgelock")),
        body=body, grommet=PHC(recpn, "#da5637", "orange-red grommet"),
        flange={"kind": "rect", "w": D(55.12, f"{DWG12} sheet 1 '2.170 [55.12]'"), "h": D(35.56, f"{DWG12} sheet 1 '1.400 [35.56]'"),
                "t": D(5.08, f"{DWG12} sheet 1 side view '.200 [5.08]'"),
                "hole_d": D(4.29, f"{DWG12} sheet 2 panel cutout 'dia .169 +-.003 [4.29 +-0.07]'"),
                "hole_x": D(44.96, f"{DWG12} sheet 1 '1.770 [44.96]'; sheet 2 '1.770 +-.003'"),
                "hole_y": D(23.88, f"{DWG12} sheet 1 '.940 [23.88]'; sheet 2 '.940 +-.003'"),
                "r": D(1.5, f"scaled off {DWG12} sheet 1 at its printed 2.170 [55.12]", "scaled"),
                "front": D(19.81, f"{DWG12} sheet 1 side view '.780 [19.81]'"),
                "cutout": (D(41.83, f"{DWG12} sheet 2 'RECOMMENDED PANEL CUTOUT' '1.647 +-.005 [41.83 +-0.12]'"),
                           D(23.52, f"{DWG12} sheet 2 '.926 +-.005 [23.52 +-0.12]'"),
                           D(6.35, f"{DWG12} sheet 2 'R.250 [6.35]'")),
                "screw": "6-32 [M4], 20-25 in-lb [2.26-2.82 Nm] (DT04-12PX-L012 sheet 1 note 6)",
                "colour": PHC(recpn, "#a9a39f", "grey welded flange (grey on the black B-key part too)")})
    plg(plgpn, series="DT", style="ends", ways=12, mate=recpn, endpoints=ends, key=key,
        A=D(30.94, f"{CAT19} (DT plug, 12 cavity, A); {TE(plgpn)} 'Product Length 30.94'"),
        C=D(40.56, f"{CAT19} (C); {TE(plgpn)} 'Connector Height 40.56'"),
        B=D(18.19, f"{CAT19} (B); {TE(plgpn)} 'Product Width 18.19'"),
        pitch=D(4.44, f"{TE(plgpn)}: 'Centerline (Pitch) 4.44 mm'"),
        row=D(9.12, f"{TE(plgpn)}: 'Row-to-Row Spacing 9.12 mm'"),
        grid=rows2(12, 4.44, 9.12), numbering=f"moulded numbers on the {plgpn} photo (1..6 / 12..7)",
        wedge=("W12S", PHC("W12S", "#fda16f", "orange wedgelock")),
        body=(PHC(plgpn, "#afa8a7", "grey housing; " + GREY_NOTE) if key == "A" else BLACK),
        grommet=PHC(plgpn, "#db563a" if key == "A" else "#b54732", "orange-red grommet and seal"))
# --- DTP 2-way (FUEL-PUMP, above the tank lid)
rec("DTP04-2P", series="DTP", style="top", ways=2, mate="DTP06-2S", endpoints=["FUEL-PUMP"],
    L=D(47.27, f"{CAT19} (DTP receptacle, 2 cavity, D); {TE('DTP04-2P')} 'Connector Height 47.3'"),
    W=D(22.1, f"{TE('DTP04-2P')} 'Product Width 22.1'", note="catalog F .732 (18.59) is the rear body (TE's DTP04-4P-L012 drawing pattern)"),
    H=D(22.07, f"{CAT19} (E)"), pitch=D(6.71, f"{TE('DTP04-2P')}: 'Centerline (Pitch) 6.71 mm'"),
    grid=row1(2, 6.71), numbering=None, wedge=("WP-2P", PHC("WP-2P", "#fa9360", "orange wedgelock")),
    body=PHC("DTP04-2P", "#98908d", "grey housing; " + GREY_NOTE), grommet=PHC("DTP04-2P", "#c24a2d", "orange-red grommet"))
plg("DTP06-2S", series="DTP", style="top", ways=2, mate="DTP04-2P", endpoints=["FUEL-PUMP"],
    A=D(34.65, f"{CAT19} (DTP plug, 2 cavity, A); {TE('DTP06-2S')} 'Connector Height 34.6'"),
    C=D(18.59, f"{CAT19} (C); {TE('DTP06-2S')} 'Product Width 18.6'"),
    B=D(18.06, f"{CAT19} (B)", note="TE's page states 18.6"),
    pitch=D(6.7, f"{TE('DTP06-2S')}: 'Centerline (Pitch) 6.7 mm'"),
    grid=row1(2, 6.71), numbering=None, wedge=("WP-2S", PHC("WP-2S", "#fb9961", "orange wedgelock")),
    body=PHC("DTP06-2S", "#8c8380", "grey housing; " + GREY_NOTE), grommet=PHC("DTP06-2S", "#c84d2f", "orange-red grommet and seal"))
# --- DTP 4-way (door window pass-throughs; FIREWALL-BODY-P flanged)
for recpn, ends, fl in (("DTP04-4P", ["DOOR-L-PASS-P", "DOOR-R-PASS-P"], None),
                        ("DTP04-4P-L012", ["FIREWALL-BODY-P"],
                         {"kind": "diamond", "w": D(53.3, f"{TE('DTP04-4P-L012')} 'Product Width 53.3'"),
                          "h": D(38.1, f"{SHP4} (wire-side view) '1.500 [38.10]'; {TE('DTP04-4P-L012')} 'Product Length 38.1'"),
                          "t": D(4.0, f"{PH('DTP04-4P-L012')}, against the 26.9 shroud width", "photo", "+-1.0",
                                 "fit-critical, photo-scaled: the panel stack depends on it"),
                          "hole_d": D(4.93, f"{SHP4} '2X dia .194 [4.93] CLEARANCE FOR #8'"),
                          "hole_x": D(40.64, f"{SHP4} '1.600 [40.64]'"),
                          "r": D(6.35, f"{SHP4} (mating-face view) 'R.250 [6.35] TYP'"),
                          "front": D(18.9, f"{PH('DTP04-4P-L012')}: shroud in front of the flange over the 47.27 length",
                                     "photo", "+-3", "fit-critical, photo-scaled"),
                          "colour": PHC("DTP04-4P-L012", "#b6b0ad", "grey flange")})):
    rec(recpn, series="DTP", style="top", ways=4, mate="DTP06-4S", endpoints=ends,
        L=D(47.27, f"{CAT19} (DTP receptacle, 4 cavity, D); {TE(recpn)} 'Connector Height 47.3'"),
        W=D(26.9, f"{TE('DTP04-4P')} 'Product Width 26.9'",
            note="catalog F .868 (22.05) is the rear body: TE's DTP04-4P-L012 drawing prints .868 [22.05] across it"),
        H=D(27.15, f"{CAT19} (E); {SHP4} side view '1.069 [27.15]'"),
        rear_w=D(22.05, f"{SHP4} '.868 [22.05]'"), rear_h=D(19.30, f"{SHP4} '.760 [19.30]'"),
        pitch=D(6.7, f"{TE(recpn)}: 'Centerline (Pitch) 6.7 mm' (up the columns)",
                note="TE's drawing view scales to 6.4 between the rows; TE's number is used"),
        row=D(10.2, f"{TE(recpn)}: 'Row-to-Row Spacing 10.2 mm' (across); {SHP4} scales to 10.1"),
        grid=grid2x2(10.2, 6.7), numbering="moulded numbers on the DTP04-4P-L012 photo and TE's DTP04-4P-L012 view (1, 2 down one side, 3, 4 up the other)",
        wedge=("WP-4P", PHC("WP-4P", "#fc7a3b", "orange wedgelock")),
        body=PHC(recpn, "#9d9c97" if fl is None else "#b6b0ad", "grey housing; " + GREY_NOTE),
        grommet=PHC(recpn, "#d65433", "orange-red grommet"), flange=fl)
plg("DTP06-4S", series="DTP", style="top", ways=4, mate="DTP04-4P",
    endpoints=["DOOR-L-PASS-P", "DOOR-R-PASS-P", "FIREWALL-BODY-P"],
    A=D(34.65, f"{CAT19} (DTP plug, 4 cavity, A); {TE('DTP06-4S')} 'Connector Height 34.6'"),
    C=D(22.05, f"{CAT19} (C); {TE('DTP06-4S')} 'Product Width 22'"),
    B=D(24.38, f"{CAT19} (B); {TE('DTP06-4S')} 'Product Length 24.4'"),
    pitch=D(6.7, f"{TE('DTP06-4S')}: 'Centerline (Pitch) 6.7 mm'"), row=D(10.2, f"{TE('DTP06-4S')}: 'Row-to-Row Spacing 10.2 mm'"),
    grid=grid2x2(10.2, 6.7), numbering="moulded numbers on the DTP06-4S photo (the same positions as its receptacle)",
    wedge=("WP-4S", PHC("WP-4S", "#fc9662", "orange wedgelock")),
    body=PHC("DTP06-4S", "#93908c", "grey housing; " + GREY_NOTE), grommet=PHC("DTP06-4S", "#bc4424", "orange-red grommet and seal"))
# --- DTM 4-way (IBST-DIAG port and cap; WIDEBAND LTCD power/CAN)
rec("DTM04-4P", series="DTM", style="top", ways=4, mate="DTM06-4S", endpoints=["IBST-DIAG", "WIDEBAND"],
    L=D(43.7, f"{TE('DTM04-4P')} 'Connector Height 43.7 mm [1.72 in]'",
        note="the catalog p.19 DTM table prints 1.720 under 'DTM Plug': its plug and receptacle length and height columns sit under each other's headings (see cross_checks)"),
    W=D(19.2, f"{TE('DTM04-4P')} 'Product Length 19.2 mm [.756 in]' (across)"),
    H=D(19.6, f"{TE('DTM04-4P')} 'Product Width 19.6 mm [.772 in]'; {SHM4} '.772 [19.61]' (the height, bridge up)"),
    pitch=D(3.81, f"{TE('DTM04-4P')}: 'Centerline (Pitch) 3.81 mm'",
            note="the DTM06-4S page states 4.19 x 4.19"),
    row=D(4.19, f"{TE('DTM04-4P')}: 'Row-to-Row Spacing 4.19 mm'"),
    grid={k: v for k, v in grid2x2(4.19, 3.81).items()}, numbering=None,
    wedge=("WM-4P", PHC("WM-4P", "#fa8444", "orange wedgelock")),
    body=PHC("DTM04-4P", "#9e9c98", "grey housing; " + GREY_NOTE), grommet=PHC("DTM04-4P", "#c93a20", "orange-red grommet"),
    alias="MoTeC #68055 (DTM 4pin (M)), LTC user manual p.32")
plg("DTM06-4S", series="DTM", style="top", ways=4, mate="DTM04-4P", endpoints=["IBST-DIAG", "WIDEBAND"],
    A=D(30.1, f"{TE('DTM06-4S')} 'Connector Height 30.1 mm [1.18 in]'", note="the catalog prints 1.185 (30.10) under 'DTM Receptacle'"),
    C=D(15.2, f"{TE('DTM06-4S')} 'Product Length 15.2 mm [.598 in]' (across)"),
    B=D(17.6, f"{TE('DTM06-4S')} 'Product Width 17.6 mm [.693 in]' (the height, lock arm up)"),
    pitch=D(3.81, f"{TE('DTM04-4P')} (the mating receptacle): 'Centerline (Pitch) 3.81 mm'",
            note="the DTM06-4S page states 4.19 x 4.19; both halves share one grid, so the receptacle's 3.81 x 4.19 is used"),
    row=D(4.19, f"{TE('DTM06-4S')}: 'Row-to-Row Spacing 4.19 mm'; {TE('DTM04-4P')} the same"),
    grid={k: v for k, v in grid2x2(4.19, 3.81).items()}, numbering=None,
    wedge=("WM-4S", PHC("WM-4S", "#f8a175", "orange wedgelock")),
    body=PHC("DTM06-4S", "#87817d", "grey housing; " + GREY_NOTE), grommet=PHC("DTM06-4S", "#af4027", "orange-red grommet and seal"),
    alias="MoTeC #68054 (DTM 4pin (F)), LTC user manual p.32")
# --- DTM 3-way (wheel-speed sensor corners, candidate option)
rec("DTM04-3P", series="DTM", style="top", ways=3, mate="DTM06-3S", endpoints=[],
    L=D(41.1, f"{TE('DTM04-3P')} 'Connector Height 41.1 mm [1.62 in]'"), W=D(20.7, f"{TE('DTM04-3P')} 'Product Length 20.7 mm [.815 in]'"),
    H=D(16.2, f"{TE('DTM04-3P')} 'Product Width 16.2 mm [.638 in]'"),
    pitch=D(3.81, f"{TE('DTM04-3P')}: 'Centerline (Pitch) 3.81 mm'", note="the DTM06-3S page states 4.19"),
    grid=row1(3, 3.81), numbering=None, wedge=("WM-3P", PHC("WM-3P", "#f3845a", "orange wedgelock")),
    body=PHC("DTM04-3P", "#8e8684", "grey housing; " + GREY_NOTE), grommet=PHC("DTM04-3P", "#b8452c", "orange-red grommet"),
    option="WSS (wheel-speed corners; catalog/options.yaml)")
plg("DTM06-3S", series="DTM", style="top", ways=3, mate="DTM04-3P", endpoints=[],
    A=D(27.6, f"{TE('DTM06-3S')} 'Connector Height 27.6 mm [1.1 in]'"), C=D(16.3, f"{TE('DTM06-3S')} 'Product Length 16.3 mm [.642 in]'"),
    B=D(14.0, f"{TE('DTM06-3S')} 'Product Width 14 mm [.551 in]'"),
    pitch=D(3.81, f"{TE('DTM04-3P')} (the mating receptacle): 'Centerline (Pitch) 3.81 mm'", note="the DTM06-3S page states 4.19"),
    grid=row1(3, 3.81), numbering=None, wedge=("WM-3S", PHC("WM-3S", "#fc9a71", "orange wedgelock")),
    body=PHC("DTM06-3S", "#776d69", "grey housing; " + GREY_NOTE), grommet=PHC("DTM06-3S", "#af4023", "orange-red grommet and seal"),
    option="WSS (wheel-speed corners; catalog/options.yaml)")

GASKETS = {
    "DT12-L012-GKT": {"for": ["DT04-12PA-L012", "DT04-12PB-L012"], "endpoints": ["FIREWALL-BODY-A", "FIREWALL-BODY-B"],
                      "outline": "DT04-12PA-L012",
                      "t": D(3.175, CAT24), "open_w": D(33.3, f"{PH('DT12-L012-GKT')}: flat photo scaled from the 55.12 flange width",
                                                        "photo", "+-0.5; the photo's outline reads 55.12 x 35.31 against the flange's 35.56"),
                      "open_h": D(19.1, f"{PH('DT12-L012-GKT')}: flat photo scaled from the 55.12 flange width", "photo", "+-0.5"),
                      "open_r": D(3.0, f"{PH('DT12-L012-GKT')}", "photo", "+-1"),
                      "colour": ("#3a3d36", f"{PH('DT12-L012-GKT')}: dark grey sponge (k-means); TE: 'Black, Closed Cell Sponge'")},
    "DTP4P-L012-GKT": {"for": ["DTP04-4P-L012"], "endpoints": ["FIREWALL-BODY-P"], "outline": "DTP04-4P-L012",
                       "t": D(3.175, CAT24), "open_w": D(27.5, f"{PH('DTP4P-L012-GKT')}: flat photo scaled from the 53.3 flange width",
                                                         "photo", "+-0.5; the photo's outline reads 53.3 x 37.7 against the flange's 38.1"),
                       "open_h": D(22.8, f"{PH('DTP4P-L012-GKT')}: flat photo scaled from the 53.3 flange width", "photo", "+-0.5"),
                       "open_r": D(4.0, f"{PH('DTP4P-L012-GKT')}", "photo", "+-1"),
                       "colour": ("#363932", f"{PH('DTP4P-L012-GKT')}: dark grey sponge (k-means); TE: black gasket")},
}

ENDS = {  # end id -> the pieces that make it complete (both halves, the gasket); other pieces an end needs are listed
    "FIREWALL-BODY-A": (["DT04-12PA-L012", "DT06-12SA", "DT12-L012-GKT"], []),
    "FIREWALL-BODY-B": (["DT04-12PB-L012", "DT06-12SB", "DT12-L012-GKT"], []),
    "FIREWALL-BODY-C": (["DT04-6P-L012", "DT06-6S"], []),
    "FIREWALL-BODY-P": (["DTP04-4P-L012", "DTP06-4S", "DTP4P-L012-GKT"], []),
    "DOOR-L-PASS": (["DT04-08PA", "DT06-08SA"], []),
    "DOOR-R-PASS": (["DT04-08PA", "DT06-08SA"], []),
    "DOOR-L-PASS-P": (["DTP04-4P", "DTP06-4S"], []),
    "DOOR-R-PASS-P": (["DTP04-4P", "DTP06-4S"], []),
    "IBST-DIAG": (["DTM06-4S", "DTM04-4P"], []),
    "FUEL-LEVEL": (["DT06-2S", "DT04-2P"], []),
    "FUEL-PUMP": (["DTP06-2S", "DTP04-2P"], []),
    "WIDEBAND": (["DTM06-4S", "DTM04-4P"], []),
}
END_NEEDS = {e: list(p) + list(o) for e, (p, o) in ENDS.items()}
# the device lane's record for the LTCD box and its two sensors (WIDEBAND.py, id LTCD-61301) completes the end
END_NEEDS["WIDEBAND"].append("LTCD-61301")
# the in-tank pieces (fam_fuel.py): the hanger with its sender and pump, and its electrical bulkhead
for _e in ("FUEL-LEVEL", "FUEL-PUMP"):
    END_NEEDS[_e] += ["QFS-H882", "QFS-BKCN-GM"]
# ends whose wires the registry keeps only in its endpoint cavity map (implied wires): the half they land in
HARNESS_HALF = {"IBST-DIAG": "DTM06-4S"}   # endpoints.yaml: "harness half DTM 4-pin (F) MoTeC #68054"


# ------------------------------------------------------------------------------------------ geometry helpers
def rr(w, h, r, z0, z1, cx=0.0, cy=0.0):
    """Rounded-rectangle prism from z0 to z1 (z1 > z0)."""
    r = max(0.05, min(r, w / 2 - 0.05, h / 2 - 0.05))
    return Pos(cx, cy, z0) * extrude(RectangleRounded(w, h, r), amount=z1 - z0)


def box(x0, x1, y0, y1, z0, z1):
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)


def cyl_z(r, z0, z1, x, y):
    return Pos(x, y, z0) * Cylinder(r, z1 - z0, align=(Align.CENTER, Align.CENTER, Align.MIN))


def fuse(parts):
    out = parts[0]
    for p in parts[1:]:
        out = out + p
    return out


def diamond(w, h, r, hx, z0, z1):
    """DTP flange: the hull of two R bosses on the hole axis and the four rounded corners of a w_top x h block."""
    top_w = 22.3            # the flat top and bottom follow the rear body (scaled off the TE view: 22.3 wide)
    pts = [(hx / 2, 0), (-hx / 2, 0), (top_w / 2 - r, h / 2 - r), (-(top_w / 2 - r), h / 2 - r),
           (top_w / 2 - r, -(h / 2 - r)), (-(top_w / 2 - r), -(h / 2 - r))]
    circles = Sketch() + [Pos(x, y) * Circle(r) for x, y in pts]
    hull = make_hull(circles.edges())
    return Pos(0, 0, z0) * extrude(hull, amount=z1 - z0)


# ------------------------------------------------------------------------------------------ derived dimensions
def dims(spec):
    """Every length the builders use, from the spec's maker numbers and the family proportions."""
    s = spec
    ser = SERIES[s["series"]]
    out = {"pin_d": K.v(ser["pin_d"]), "hole_d": ser["hole_d"], "boss_d": ser["boss_d"]}
    if s["kind"] == "receptacle":
        L, W, H = K.v(s["L"]), K.v(s["W"]), K.v(s["H"])
        mate = PLG[s["mate"]]
        A = K.v(mate["A"])
        d_ins = pv("nose_f") * A
        if s["style"] == "top":
            hb = pv("bridge_h_f") * H
            Hs = H - hb
            # the shroud rim: the photo proportion, or thicker when the mating plug is narrow (its nose must fit inside
            # the plug body with a 0.3 shoulder each side and 0.3 clearance in the shroud)
            t = max(1.1, pv("wall_f") * W, (W - K.v(mate["C"]) + 0.9) / 2)
            Ls = K.v(s["flange"]["front"]) if s.get("flange") else pv("shroud_f") * L
            wr = K.v(s["rear_w"]) if "rear_w" in s else pv("rear_w_f") * W
            hr = K.v(s["rear_h"]) if "rear_h" in s else pv("rear_h_f") * H
            out.update(L=L, W=W, H=H, Hs=Hs, hb=hb, t=t, Ls=Ls, wr=wr, hr=hr, d_ins=d_ins,
                       lb=pv("bridge_l_f") * Ls, wb=pv("bridge_w_f") * W, tb=1.0)
        else:
            Hs = K.v(s["Hs"]) if "Hs" in s else H
            Wb = K.v(s["Wb"])
            B = K.v(mate["B"])
            t_tb = (Hs - (B - 1.2 + 0.3)) / 2        # top/bottom wall: the plug nose (B less a 0.6 shoulder) + 0.3
            Ls = K.v(s["Ls"]) if "Ls" in s else pv("shroud_f") * L
            wr = K.v(s["rear_w"]) if "rear_w" in s else Wb - 2.0
            hr = K.v(s["rear_h"]) if "rear_h" in s else 0.83 * Hs
            out.update(L=L, W=W, H=H, Hs=Hs, Wb=Wb, t=1.5, t_tb=t_tb, Ls=Ls, wr=wr, hr=hr, d_ins=d_ins,
                       ear_h=K.v(s["ear_h"]) if "ear_h" in s else 0.55 * Hs, plate=H - Hs)
        out["open_w"] = (out["W"] if s["style"] == "top" else out["Wb"]) - 2 * out["t"]
        out["open_h"] = (out["Hs"] - 2 * out["t"]) if s["style"] == "top" else (out["Hs"] - 2 * out["t_tb"])
    else:
        A, C, B = K.v(s["A"]), K.v(s["C"]), K.v(s["B"])
        r = dims(REC[s["mate"]])
        d_ins = r["d_ins"]
        nose_w, nose_h = r["open_w"] - 0.3, r["open_h"] - 0.3
        out.update(A=A, C=C, B=B, d_ins=d_ins, nose_w=nose_w, nose_h=nose_h, rec=r)
        if s["style"] == "top":
            roof = r["Hs"] / 2 + r["hb"] - r["tb"]          # underside of the receptacle's bridge roof
            tl = min(1.5, r["hb"] - r["tb"] - 0.5)
            # the lock arm's top: under the roof, and low enough that the body (B less the arm) still clears the nose
            latch_top = min(roof - 0.25, B - (nose_h + 0.6) / 2)
            if latch_top - tl < r["Hs"] / 2 + 0.2:            # keep the arm above the receptacle's shroud top
                tl = max(0.8, latch_top - r["Hs"] / 2 - 0.2)
            hb_half = B - latch_top                           # body half height: overall B less the latch top
            out.update(body_w=C, body_h=2 * hb_half, latch_top=latch_top, tl=tl, roof=roof,
                       latch_w=min(pv("latch_w_f") * C, r["wb"] - 2 * 1.2 - 0.6))
        else:
            body_w = r["Wb"] + 0.2
            out.update(body_w=body_w, body_h=B, arm_t=pv("arm_t"), arm_gap=(C - body_w) / 2 - pv("arm_t"))
    return out


# ------------------------------------------------------------------------------------------ builders
def cavity_holes(grid, d, z0, z1):
    return [cyl_z(d / 2, z0, z1, x, y) for x, y in grid.values()]


def build_receptacle(spec, labels=None, fill=None):
    """fill: {cavity: contact PN or 'plug:<PN>' or None}; default every cavity gets the series' pin."""
    s, g = spec, dims(spec)
    pn = s["pn"]
    lab = labels or pn
    L, Ls, t = g["L"], g["Ls"], g["t"]
    parts = []
    if s["style"] == "top":
        W, Hs = g["W"], g["Hs"]
        shroud = rr(W, Hs, min(2.4, W / 6), -Ls, 0.0)
        shroud -= rr(g["open_w"], g["open_h"], min(1.6, g["open_w"] / 6), -g["d_ins"] - 0.5, 0.5)
        # the bridge (the plug's lock arm passes under it)
        wb, hb, lb, tb = g["wb"], g["hb"], g["lb"], g["tb"]
        y0 = Hs / 2 - 0.4
        bridge = box(-wb / 2, wb / 2, y0, Hs / 2 + hb, -lb, 0.0)
        bridge -= box(-wb / 2 + 1.2, wb / 2 - 1.2, y0 - 1, Hs / 2 + hb - tb, -lb - 1, 1)
        housing = shroud + bridge
    else:
        Wb, Hs, eh = g["Wb"], g["Hs"], g["ear_h"]
        shroud = rr(Wb, Hs, 2.2, -Ls, 0.0)
        shroud -= rr(g["open_w"], g["open_h"], 1.6, -g["d_ins"] - 0.5, 0.5)
        ew = (g["W"] - Wb) / 2
        ears = []
        for sx in (-1, 1):
            xi, xo = sx * (Wb / 2 - 0.3), sx * (Wb / 2 + ew)          # the catch: from inside the body to W/2
            ear = box(min(xi, xo), max(xi, xo), -eh / 2, eh / 2, -Ls, 0.0)
            xw0, xw1 = sx * (Wb / 2 + 0.6), sx * (Wb / 2 + ew + 1)
            win = box(min(xw0, xw1), max(xw0, xw1), -eh / 2 + 1.4, eh / 2 - 1.4, -Ls * 0.62, -1.2)
            ears.append(ear - win)
        housing = shroud + ears[0] + ears[1]
        if g["plate"] > 0.3:     # the 8-way's top plate
            housing += box(-0.3 * Wb, 0.3 * Wb, Hs / 2 - 0.2, Hs / 2 + g["plate"], -Ls, -0.3 * Ls)
    wr, hr = g["wr"], g["hr"]
    rear = rr(wr, hr, min(2.2, wr / 6), -L, -Ls + 0.2)
    if s.get("hood"):
        hw, hl, hh = s["hood"]
        hh = min(hh, g["H"] / 2 - hr / 2 - 0.05)          # the hood stays inside the catalog height
        fl = s.get("flange")
        z_back = -(K.v(fl["front"]) + K.v(fl["t"])) if fl else -Ls
        rear += box(-hw / 2, hw / 2, hr / 2 - 0.2, hr / 2 + hh, z_back - hl, z_back)
    housing = housing + rear
    # grommet pocket and the grommet (wire side), its seal holes at the cavities
    gw, gh = wr - 2 * 1.2, hr - 2 * 1.2
    housing -= rr(gw, gh, 1.4, -L - 0.5, -L + 1.2)
    grommet = rr(gw - 0.05, gh - 0.05, 1.35, -L + 0.4, -L + 1.2)
    for x, y in s["grid"].values():
        grommet += cyl_z(g["boss_d"] / 2, -L + 0.15, -L + 0.45, x, y)
    for h in cavity_holes(s["grid"], g["hole_d"], -L - 1, -L + 2):
        grommet -= h
        housing -= h
    zf = -g["d_ins"] - 0.5
    ser = SERIES[s["series"]]
    bore = CT.geometry(ser["pin_part"])[1][1][2] + 0.3          # the shoulder diameter + 0.3
    for x, y in s["grid"].values():                            # each contact sits in its own cavity bore
        housing -= cyl_z(bore / 2, -L + 1.0, zf + 0.05, x, y)
    parts.append(K.body(housing, f"{lab} housing", s["body"][0]))
    parts.append(K.body(grommet, f"{lab} rear grommet (wire seals)", s["grommet"][0], finish="rubber"))
    # the wedgelock at the base of the pins
    wedge = rr(g["open_w"] - 0.6, g["open_h"] - 0.6, 1.2, zf, zf + 1.6)
    for h in cavity_holes(s["grid"], g["pin_d"] + 1.2, zf - 1, zf + 3):
        wedge -= h
    parts.append(K.body(wedge, f"{lab} wedgelock {s['wedge'][0]}", s["wedge"][1][0]))
    fl = s.get("flange")
    if fl:
        z1 = -K.v(fl["front"])
        z0 = z1 - K.v(fl["t"])
        if fl["kind"] == "rect":
            plate = rr(K.v(fl["w"]), K.v(fl["h"]), K.v(fl["r"]), z0, z1)
            hx, hy = K.v(fl["hole_x"]) / 2, K.v(fl["hole_y"]) / 2
            holes = [(sx * hx, sy * hy) for sx in (-1, 1) for sy in (-1, 1)]
        else:
            plate = diamond(K.v(fl["w"]), K.v(fl["h"]), K.v(fl["r"]), K.v(fl["hole_x"]), z0, z1)
            holes = [(-K.v(fl["hole_x"]) / 2, 0), (K.v(fl["hole_x"]) / 2, 0)]
        plate -= rr(wr - 0.1, hr - 0.1, min(2.2, wr / 6), z0 - 1, z1 + 1)    # the rear body passes through
        for x, y in holes:
            plate -= cyl_z(K.v(fl["hole_d"]) / 2, z0 - 1, z1 + 1, x, y)
        parts.append(K.body(plate, f"{lab} welded flange", fl["colour"][0]))
    # the contacts: pins with the retention shoulder at the family's depth behind the mouth
    fill = fill if fill is not None else {k: ser["pin_part"] for k in s["grid"]}
    zsh = shoulder_depth(s)
    for k, (x, y) in s["grid"].items():
        c = fill.get(k)
        if not c:
            continue
        if c.startswith("plug:"):
            cp = c[5:]
            hl = CT.geometry(cp)[1][0][1]
            parts += CT.bodies(cp, f"{lab} cavity {k} sealing plug", at=(x, y, -L + 0.4 - hl))
        else:
            parts += CT.bodies(c, f"{lab} cavity {k} pin", at=(x, y, -zsh - CT.shoulder_z(c)))
    return parts


def shoulder_depth(spec):
    """How far behind the mouth the receptacle's contact shoulders sit."""
    r = spec if spec["kind"] == "receptacle" else REC[spec["mate"]]
    if r["series"] in SHOULDER:
        return K.v(SHOULDER[r["series"]])
    pl = PLG[r["mate"]]           # DTM: derived so the pin enters the socket half its sleeve length
    pin = SERIES[r["series"]]["pin_part"]
    sock = SERIES[r["series"]]["socket_part"]
    Lp, secs, _ = CT.geometry(pin)
    Ls, ssecs, _ = CT.geometry(sock)
    fwd = Lp - CT.shoulder_z(pin)
    return dims(pl)["d_ins"] - 0.3 - 0.5 * (ssecs[-1][1] - ssecs[-1][0]) + fwd


def build_plug(spec, labels=None, fill=None):
    s, g = spec, dims(spec)
    lab = labels or s["pn"]
    A, d = g["A"], g["d_ins"]
    zr = A - d                              # the wire-side face
    nose = rr(g["nose_w"], g["nose_h"], min(1.4, g["nose_w"] / 6), -d, 0.2)
    if s["style"] == "top":
        bw, bh = g["body_w"], g["body_h"]
        body = rr(bw, bh, min(2.2, bw / 6), 0.0, zr)
        # lock arm: beam under the receptacle's bridge, pivot block, press pad at the rear, guard posts
        lw, tl, lt = g["latch_w"], g["tl"], g["latch_top"]
        za, zb = pv("latch_z0_f") * A - d, pv("latch_z1_f") * A - d
        beam = box(-lw / 2, lw / 2, lt - tl, lt, za, zb)
        zm = 0.5 * (max(za, 0.5) + zb)                  # the pivot stands on the body, behind the mating plane
        pivot = box(-lw / 2 + 0.6, lw / 2 - 0.6, bh / 2 - 0.3, lt - tl + 0.05, zm - 1.5, zm + 1.5)
        hook = box(-lw / 2, lw / 2, max(g["rec"]["Hs"] / 2 + 0.1, lt - tl - 0.9), lt - tl + 0.05, za, za + 1.2)
        pad = box(-lw / 2 - 0.8, lw / 2 + 0.8, lt - tl, lt, zb - 4.0, zb)
        pw_ = pv("post_f") * A
        post_w = max(1.4, 0.12 * bw)
        posts = []
        for sx in (-1, 1):
            x_in = sx * (lw / 2 + 1.3)
            x_out = sx * (lw / 2 + 1.3 + post_w)
            posts.append(box(min(x_in, x_out), max(x_in, x_out), bh / 2 - 0.3, lt, zr - pw_, zr))
        housing = body + nose + beam + pivot + hook + pad + posts[0] + posts[1]
    else:
        bw, bh = g["body_w"], g["body_h"]
        body = rr(bw, bh, 2.2, 0.0, zr)
        arms = []
        at, ag = g["arm_t"], g["arm_gap"]
        ah = pv("arm_h_f") * bh
        za, zb = pv("latch_z0_f") * A - d, pv("latch_z1_f") * A - d
        for sx in (-1, 1):
            xi = sx * (bw / 2 + ag)
            xo = sx * (bw / 2 + ag + at)
            arm = box(min(xi, xo), max(xi, xo), -ah / 2, ah / 2, za, zb)
            zm = 0.5 * (max(za, 0.5) + zb)
            root = box(min(sx * (bw / 2 - 0.2), xi), max(sx * (bw / 2 - 0.2), xi), -ah / 2 + 1.0, ah / 2 - 1.0,
                       zm - 1.5, zm + 1.5)
            tab = box(min(sx * (bw / 2 - 0.2), xo), max(sx * (bw / 2 - 0.2), xo), -ah / 2 - 0.8, ah / 2 + 0.8, zb - 3.5, zb)
            arms.append(arm + root + tab)
        housing = body + nose + arms[0] + arms[1]
    # interface seal ring round the rear of the nose (it seals on the receptacle's shroud wall)
    r = g["rec"]
    sz0 = -pv("seal_f") * d
    seal = rr(r["open_w"] - 0.05, r["open_h"] - 0.05, 1.5, sz0, -0.4)
    seal -= rr(g["nose_w"] - 0.2, g["nose_h"] - 0.2, 1.2, sz0 - 1, 0.5)
    for k in (0.33, 0.66):
        zc = sz0 + k * (-0.4 - sz0)
        seal -= (rr(r["open_w"] + 2, r["open_h"] + 2, 1.5, zc - 0.25, zc + 0.25) -
                 rr(r["open_w"] - 0.55, r["open_h"] - 0.55, 1.4, zc - 0.5, zc + 0.5))
    housing -= rr(g["nose_w"] + 0.2, g["nose_h"] + 0.2, 1.3, sz0, -0.4) - rr(g["nose_w"] - 0.2, g["nose_h"] - 0.2, 1.2, sz0 - 1, 0.1)
    # front face: the wedgelock with a socket entry at each cavity
    wedge = rr(g["nose_w"] - 1.2, g["nose_h"] - 1.2, 1.0, -d, -d + 1.4)
    housing -= rr(g["nose_w"] - 1.2, g["nose_h"] - 1.2, 1.0, -d - 1, -d + 1.4)
    for x, y in s["grid"].values():
        wedge -= cyl_z((g["pin_d"] + 0.5) / 2, -d - 1, -d + 3, x, y)
        housing -= cyl_z((g["pin_d"] + 0.5) / 2, -d - 1, -d + 6, x, y)
    # wire side grommet
    gw, gh = bw - 2 * 1.4, bh - 2 * 1.4
    housing -= rr(gw, gh, 1.4, zr - 1.2, zr + 0.5)
    grommet = rr(gw - 0.05, gh - 0.05, 1.35, zr - 1.2, zr - 0.4)
    for x, y in s["grid"].values():
        grommet += cyl_z(SERIES[s["series"]]["boss_d"] / 2, zr - 0.45, zr - 0.15, x, y)
    for h in cavity_holes(s["grid"], SERIES[s["series"]]["hole_d"], zr - 3, zr + 1):
        grommet -= h
        housing -= h
    ser = SERIES[s["series"]]
    sg = CT.geometry(ser["socket_part"])[1]
    bore = max(sg[1][2], sg[-1][2]) + 0.3                      # over the shoulder and the sleeve
    for x, y in s["grid"].values():
        housing -= cyl_z(bore / 2, -d + 1.3, zr - 1.1, x, y)
    parts = [K.body(housing, f"{lab} housing", s["body"][0]),
             K.body(grommet, f"{lab} rear grommet (wire seals)", s["grommet"][0], finish="rubber"),
             K.body(seal, f"{lab} interface seal", s["grommet"][0], finish="rubber"),
             K.body(wedge, f"{lab} wedgelock {s['wedge'][0]}", s["wedge"][1][0])]
    # the sockets: mating end just behind the wedgelock's face, wires out toward +Z
    fill = fill if fill is not None else {k: ser["socket_part"] for k in s["grid"]}
    for k, (x, y) in s["grid"].items():
        c = fill.get(k)
        if not c:
            continue
        if c.startswith("plug:"):
            cp = c[5:]
            hl = CT.geometry(cp)[1][0][1]
            parts += CT.bodies(cp, f"{lab} cavity {k} sealing plug", at=(x, y, zr - 0.4 + hl), flip=True)
        else:
            Lc = CT.geometry(c)[0]
            parts += CT.bodies(c, f"{lab} cavity {k} socket", at=(x, y, -d + 0.3 + Lc), flip=True)
    return parts


def build_gasket(gid, labels=None):
    gk = GASKETS[gid]
    fl = REC[gk["outline"]]["flange"]
    t = K.v(gk["t"])
    z1 = -(K.v(fl["front"]) + K.v(fl["t"]))
    z0 = z1 - t
    if fl["kind"] == "rect":
        plate = rr(K.v(fl["w"]), K.v(fl["h"]), K.v(fl["r"]), z0, z1)
        hx, hy = K.v(fl["hole_x"]) / 2, K.v(fl["hole_y"]) / 2
        holes = [(sx * hx, sy * hy) for sx in (-1, 1) for sy in (-1, 1)]
    else:
        plate = diamond(K.v(fl["w"]), K.v(fl["h"]), K.v(fl["r"]), K.v(fl["hole_x"]), z0, z1)
        holes = [(-K.v(fl["hole_x"]) / 2, 0), (K.v(fl["hole_x"]) / 2, 0)]
    plate -= rr(K.v(gk["open_w"]), K.v(gk["open_h"]), K.v(gk["open_r"]), z0 - 1, z1 + 1)
    for x, y in holes:
        plate -= cyl_z(K.v(fl["hole_d"]) / 2, z0 - 1, z1 + 1, x, y)
    return [K.body(plate, f"{labels or gid} flange gasket", gk["colour"][0], finish="rubber")]


# ------------------------------------------------------------------------------------------ part objects
def _bb(bodies):
    return Compound(children=bodies).bounding_box()


def _cavity_centres(body):
    """Centres of the cavity holes through a grommet, measured on the solid (circular edges of the hole radius)."""
    from build123d import GeomType
    out = set()
    for e in body.edges():
        if e.geom_type == GeomType.CIRCLE:
            out.add((round(e.arc_center.X, 2), round(e.arc_center.Y, 2), round(e.radius, 2)))
    return out


def _pitch_check(spec):
    xs = sorted({round(x, 3) for x, y in spec["grid"].values()})
    ys = sorted({round(y, 3) for x, y in spec["grid"].values()})
    return xs, ys


def piece_P(spec):
    """The piece's dimension table: its own maker numbers, the family proportions it uses, and its flange."""
    P = {}
    for k in ("L", "W", "H", "Hs", "Wb", "A", "C", "B", "pitch", "row", "gap", "ear_h", "Ls", "rear_w", "rear_h"):
        if k in spec:
            P[k] = spec[k]
    P["pin_d"] = SERIES[spec["series"]]["pin_d"]
    fl = spec.get("flange")
    if fl:
        for k in ("w", "h", "t", "hole_d", "hole_x", "hole_y", "r", "front"):
            if k in fl:
                P["flange_" + k] = fl[k]
        if fl.get("cutout"):
            for k, dd in zip(("w", "h", "r"), fl["cutout"]):
                P["cutout_" + k] = dd
    used = ["shroud_f", "bridge_h_f", "bridge_l_f", "bridge_w_f", "wall_f", "rear_w_f", "rear_h_f", "nose_f"] \
        if spec["kind"] == "receptacle" else ["nose_f", "latch_z0_f", "latch_z1_f", "latch_w_f", "post_f", "seal_f"]
    if spec["style"] == "ends":
        used = [u for u in used if u not in ("bridge_h_f", "bridge_l_f", "bridge_w_f", "wall_f", "rear_w_f", "rear_h_f",
                                             "latch_w_f", "post_f")] + (["arm_t", "arm_h_f"] if spec["kind"] == "plug" else [])
        if "Ls" in spec and "shroud_f" in used:
            used.remove("shroud_f")
    if spec.get("flange") and "shroud_f" in used:
        used.remove("shroud_f")
    for u in used:
        P["prop_" + u] = PROP[u]
    return P


def piece_module(pn):
    spec = REC.get(pn) or PLG.get(pn)
    m = types.SimpleNamespace()
    g = dims(spec)
    ser = SERIES[spec["series"]]
    is_rec = spec["kind"] == "receptacle"
    L = g["L"] if is_rec else g["A"]
    W = g["W"] if is_rec else g["C"]
    H = g["H"] if is_rec else g["B"]
    fl = spec.get("flange")
    what = (f"Deutsch {spec['series']} {spec['ways']}-way {'receptacle (pins)' if is_rec else 'plug (sockets)'}"
            + (f", {'welded flange' if fl else ''}" if fl else "") + (f", {spec['key']} key" if spec.get("key") else "")
            + (f"; {spec['alias']}" if spec.get("alias") else ""))
    m.P = piece_P(spec)
    m.COLORS = {"housing": spec["body"], "grommet_seal": spec["grommet"], "wedgelock": spec["wedge"][1]}
    if is_rec:
        m.COLORS["pins"] = NICKEL
    if fl:
        m.COLORS["flange"] = fl["colour"]
    eseal = f"E-seal version and wire range: {ESEAL} entry {pn}" if pn in open(K.CALC / "catalog" / "deutsch_eseal.yaml").read() else ""
    unknowns = []
    if spec.get("numbering") is None:
        unknowns.append("Cavity numbers: not legible on the maker photos and not printed on the TE pages on file; the "
                        "positions are drawn (pitch from TE) with 1 at +X. Read the moulded numbers off the part before "
                        "pinning it.")
    unknowns.append("Shroud length, bridge / lock arm, seal ring and nose depth are photo proportions (+-10-15 %); the "
                    "mated length follows the nose depth (" + f"{g['d_ins']:.1f} mm" + ").")
    if fl and fl["t"].basis != "maker":
        unknowns.append(f"Flange thickness {K.v(fl['t']):g} mm is {fl['t'].basis}: confirm before cutting the panel spacer.")
    m.PART = {
        "pid": pn, "endpoints": list(spec["endpoints"]), "maker": "TE Connectivity (Deutsch)", "pn": pn,
        "title": f"Deutsch {pn}", "what": what, "shape_basis": "datasheet dims", "viewset": "wall", "kind": "piece",
        "family": f"deutsch {spec['series'].lower()}", "mates": spec["mate"],
        "dims_mm": {"l": round(L, 2), "w": round(W, 2), "h": round(H, 2)},
        "dims_note": (f"overall {L:g} long x {W:g} wide x {H:g} high (Deutsch catalog p.19 / TE); "
                      + (f"flange {K.v(fl['w']):g} x {K.v(fl['h']):g} x {K.v(fl['t']):g}; " if fl else "")
                      + f"mated with {spec['mate']} the pair is {mated_length(spec):.1f} long"),
        "frame": ("origin at the centre of the mating plane (the receptacle's shroud mouth); +Z toward the plug; +Y the "
                  "latch side; from the receptacle's wire side (-Z) +X is on the left"),
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"mating": "+Z" if is_rec else "-Z",
                                                                  "wires": "-Z" if is_rec else "+Z", "latch": "+Y"}},
        "refs": [("[1]", "Deutsch DT family catalog", "Deutsch DT family catalog (TE), DT/DTM/DTP dimension tables p.19"),
                 ("[2]", "te.com/en/product-", "TE product pages (pitch, rows, pin diameter, colour), read 2026-09-29"),
                 ("[3]", "Deutsch_DT04-12PX-L012", "TE customer drawing DT04-12PX-L012 rev D2"),
                 ("[4]", "screenshot_2026-09-28", "TE drawing-viewer screenshots on file"),
                 ("[5]", "customconnectorkits.com", "customconnectorkits product photos (photo proportions, colours)")],
        "cavities": {k: [round(x, 3), round(y, 3)] for k, (x, y) in spec["grid"].items()},
        **({"option": spec["option"]} if spec.get("option") else {}),
        "numbering": spec.get("numbering") or "not sourced",
        "unknowns": unknowns,
        "cross_checks": ([f"{spec['L'].note}"] if spec.get("L") and spec["L"].note else [])
                        + ([spec["B"].note] if spec.get("B") and spec["B"].note else []),
        "notes": [n for n in (eseal, f"wedgelock {spec['wedge'][0]} ({CAT21})",
                              f"candidate option: {spec['option']}" if spec.get("option") else "",
                              f"panel screw {fl['screw']}" if fl and fl.get("screw") else "") if n],
        "drawing_notes": [(f"Cavities from the {'receptacle' if is_rec else 'plug'} wire side: "
                           + ", ".join(f"{k} ({x:+.2f}, {y:+.2f})" for k, (x, y) in list(spec["grid"].items())[:6])
                           + (" ... (all in params.json)" if len(spec["grid"]) > 6 else ""), "#10151a"),
                          ("Photo proportions (purple) shape the look only: shroud, bridge, lock arm, seal, nose depth.", "photo")],
    }
    m.build = lambda: (build_receptacle(spec) if is_rec else build_plug(spec), [], [])
    zw = -g["L"] if is_rec else g["A"] - g["d_ins"]
    dirw = (0, 0, -1) if is_rec else (0, 0, 1)
    m.attach_points = lambda: [{"n": f"cav{k}", "ep": (spec["endpoints"][0] if spec["endpoints"] else pn), "at": [x, y, round(zw, 2)],
                                "dir": list(dirw), "kind": f"{ser['contact']} {'pin' if is_rec else 'socket'}"}
                               for k, (x, y) in spec["grid"].items()] if spec["endpoints"] else []
    m.mount_points = lambda: (flange_mounts(spec) if fl else [])
    part_pref = ser["pin_part"][:4] if is_rec else ser["socket_part"][:4]

    def terminals():
        rows = []
        for ep in spec["endpoints"] or []:
            for k, (x, y) in spec["grid"].items():
                rows.append({"pin": k, "endpoint": ep, "name": f"cavity {k}", "match": rf"^{k}\b", "part_prefix": part_pref,
                             "endpoint_cavities": HARNESS_HALF.get(ep) == pn,
                             "full_name": f"{pn} cavity {k} ({'number not sourced' if spec.get('numbering') is None else 'moulded'})",
                             "at": (x, y, zw), "dir": dirw})
        return rows
    m.terminals = terminals if spec["endpoints"] else None
    if m.terminals is None:
        del m.terminals
    m.CHECKS = piece_checks(spec)
    m.annotate = lambda S, views: annotate_piece(S, views, spec)
    return m


def flange_mounts(spec):
    fl = spec["flange"]
    z = -(K.v(fl["front"]) + K.v(fl["t"]))
    if fl["kind"] == "rect":
        hx, hy = K.v(fl["hole_x"]) / 2, K.v(fl["hole_y"]) / 2
        pts = [(sx * hx, sy * hy) for sx in (-1, 1) for sy in (-1, 1)]
    else:
        pts = [(-K.v(fl["hole_x"]) / 2, 0), (K.v(fl["hole_x"]) / 2, 0)]
    return [{"n": f"flange_hole_{i + 1}", "at": [round(x, 2), round(y, 2), round(z, 2)], "dir": [0, 0, -1],
             "d": K.v(fl["hole_d"]), "note": f"the panel sits on the flange's wire-side face (z = {z:.2f}); "
                                           f"{fl.get('screw', 'screw per the maker')}"} for i, (x, y) in enumerate(pts)]


def engagement(spec):
    """How far the receptacle's pin tip reaches past the plug's socket entry when mated (mm)."""
    r = spec if spec["kind"] == "receptacle" else REC[spec["mate"]]
    pin = SERIES[r["series"]]["pin_part"]
    tip = -shoulder_depth(r) + CT.geometry(pin)[0] - CT.shoulder_z(pin)
    entry = -dims(PLG[r["mate"]])["d_ins"] + 0.3
    return round(tip - entry, 2)


def mated_length(spec):
    r = spec if spec["kind"] == "receptacle" else REC[spec["mate"]]
    p = PLG[r["mate"]]
    g = dims(p)
    return K.v(r["L"]) + g["A"] - g["d_ins"]


def _grid_from_body(body, r):
    """The cavity grid as built: unique x and y of the circular edges of radius r (the seal holes)."""
    from build123d import GeomType
    cs = {(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in body.edges()
          if e.geom_type == GeomType.CIRCLE and abs(e.radius - r) < 0.02}
    return sorted(cs), sorted({c[0] for c in cs}), sorted({c[1] for c in cs})


def _spacing(vals):
    return round(vals[1] - vals[0], 3) if len(vals) > 1 else 0.0


# which printed spacing each grid axis carries: x first, then y
GRID_AXES = {"rows2": ("pitch", "row"), "cols2x3": ("pitch", "row"), "grid2x2": ("row", "pitch"), "row1": ("pitch", None)}


def grid_kind(spec):
    n, st = spec["ways"], spec["style"]
    if st == "ends":
        return "rows2"
    if n == 6:
        return "cols2x3"
    if n == 4:
        return "grid2x2"
    return "row1"


def piece_checks(spec):
    is_rec = spec["kind"] == "receptacle"
    L = K.v(spec["L"] if is_rec else spec["A"])
    W = K.v(spec["W"] if is_rec else spec["C"])
    H = K.v(spec["H"] if is_rec else spec["B"])
    n = spec["ways"]
    r_hole = SERIES[spec["series"]]["hole_d"] / 2
    fl = spec.get("flange")
    ck = [("overall length (catalog / TE)", lambda b: _bb(b[:3]).size.Z, L, 0.1),
          ("overall width (catalog / TE)", lambda b: _bb(b[:1]).size.X, W, 0.1),
          ("overall height (catalog / TE)", lambda b: _bb(b[:1]).size.Y, H, 0.1),
          (f"cavity count ({n})", lambda b: len(_grid_from_body(b[1], r_hole)[0]), n)]
    ax, ay = GRID_AXES[grid_kind(spec)]
    if ax and ax in spec:
        ck.append((f"cavity spacing across (TE {ax})", lambda b: _spacing(_grid_from_body(b[1], r_hole)[1]),
                   K.v(spec[ax]), 0.02))
    if ay and ay in spec:
        ck.append((f"cavity spacing up (TE {ay})", lambda b: _spacing(_grid_from_body(b[1], r_hole)[2]),
                   K.v(spec[ay]), 0.02))
    if fl:
        ck += [("flange width", lambda b: _flange(b).bounding_box().size.X, K.v(fl["w"]), 0.05),
               ("flange height", lambda b: _flange(b).bounding_box().size.Y, K.v(fl["h"]), 0.05),
               ("flange thickness", lambda b: _flange(b).bounding_box().size.Z, K.v(fl["t"]), 0.02),
               ("shroud in front of the flange", lambda b: -_flange(b).bounding_box().max.Z, K.v(fl["front"]), 0.02),
               ("flange hole spacing across", lambda b: _hole_span(_flange(b), K.v(fl["hole_d"]) / 2, "x"), K.v(fl["hole_x"]), 0.02)]
        if fl["kind"] == "rect":
            ck.append(("flange hole spacing up", lambda b: _hole_span(_flange(b), K.v(fl["hole_d"]) / 2, "y"), K.v(fl["hole_y"]), 0.02))
        if fl.get("cutout"):
            cw, ch = K.v(fl["cutout"][0]), K.v(fl["cutout"][1])
            ck.append(("rear body passes the recommended panel cutout", lambda b: (cw > dims(spec)["wr"] and ch > dims(spec)["hr"]), True))
    ck.append(("pin enters its socket, mm (the shoulder depth and the nose depth together)",
               lambda b: engagement(spec) > 2.0, True))
    if not is_rec:
        g = dims(spec)
        ck.append(("nose clearance in the receptacle's shroud (design 0.3)", lambda b: round(g["rec"]["open_w"] - g["nose_w"], 2), 0.3, 0.01))
        ck.append(("nose inside the plug body", lambda b: g["nose_w"] <= g["body_w"] and g["nose_h"] <= g["body_h"], True))
        if spec["style"] == "top":
            ck.append(("lock arm clears the bridge roof", lambda b: g["roof"] - g["latch_top"] >= 0.25, True))
            ck.append(("lock arm rides above the shroud top", lambda b: g["latch_top"] - g["tl"] >= g["rec"]["Hs"] / 2 + 0.19, True))
    return ck


def _flange(b):
    return next(x for x in b if "welded flange" in x.label)


def _hole_span(body, r, axis):
    from build123d import GeomType
    cs = sorted({(round(e.arc_center.X, 2), round(e.arc_center.Y, 2)) for e in body.edges()
                 if e.geom_type == GeomType.CIRCLE and abs(e.radius - r) < 0.02})
    if not cs:
        return 0.0
    vals = sorted({c[0] for c in cs}) if axis == "x" else sorted({c[1] for c in cs})
    return round(vals[-1] - vals[0], 3)


def annotate_piece(S, views, spec):
    """Overall width on the front view (the mating face from +Z) and overall length on the right view."""
    fr, rt = views["front"], views["right"]
    is_rec = spec["kind"] == "receptacle"
    g = dims(spec)
    W = g["W"] if is_rec else g["C"]
    ybot = -(g["Hs"] / 2 if is_rec else g["body_h"] / 2)
    z0 = -g["L"] if is_rec else -g["d_ins"]
    z1 = 0.0 if is_rec else g["A"] - g["d_ins"]
    fl = spec.get("flange")
    yb = -K.v(fl["h"]) / 2 if fl else ybot
    S.dim(fr, (-W / 2, ybot, 0), (W / 2, ybot, 0), -10 + (ybot - yb) * fr.s, spec["W"] if is_rec else spec["C"])
    S.dim(rt, (0, yb, z0), (0, yb, z1), -8, spec["L"] if is_rec else spec["A"])
    if fl:
        S.dim(rt, (0, K.v(fl["h"]) / 2, -K.v(fl["front"])), (0, K.v(fl["h"]) / 2, 0.0), 6, fl["front"])


# ------------------------------------------------------------------------------------------ assemblies (one per end)
def assembly_module(end):
    pieces, others = ENDS[end]
    m = types.SimpleNamespace()
    specs = [REC.get(p) or PLG.get(p) for p in pieces if p in REC or p in PLG]
    gaskets = [p for p in pieces if p in GASKETS]
    recs = [s for s in specs if s["kind"] == "receptacle"]
    plugs = [s for s in specs if s["kind"] == "plug"]
    r, p = recs[0], plugs[0]
    rf, pf, fill_notes = end_fill(end, r, p)
    P = {}
    for s in specs:
        for k, d in piece_P(s).items():
            P[f"{s['pn']}.{k}"] = d
    for gid in gaskets:
        for k in ("t", "open_w", "open_h", "open_r"):
            P[f"{gid}.{k}"] = GASKETS[gid][k]
    m.P = P
    m.COLORS = {f"{r['pn']} housing": r["body"], f"{p['pn']} housing": p["body"], "grommets and seals": r["grommet"],
                f"{r['wedge'][0]}": r["wedge"][1], f"{p['wedge'][0]}": p["wedge"][1], "pins": NICKEL}
    if r.get("flange"):
        m.COLORS["flange"] = r["flange"]["colour"]
    for gid in gaskets:
        m.COLORS[gid] = GASKETS[gid]["colour"]
    ml = mated_length(r)
    fl = r.get("flange")
    missing = list(others)
    m.PART = {
        "pid": end, "endpoints": [end], "maker": "TE Connectivity (Deutsch)", "pn": " + ".join(pieces),
        "title": f"{end}: Deutsch {r['pn']} + {p['pn']} mated" + (f" + {gaskets[0]}" if gaskets else ""),
        "what": f"{end} connector pair, mated: {r['pn']} receptacle and {p['pn']} plug" + (f", {gaskets[0]} gasket" if gaskets else ""),
        "shape_basis": "datasheet dims", "viewset": "wall", "kind": "assembly", "pieces": pieces, "missing": missing,
        "family": f"deutsch {r['series'].lower()}",
        "dims_mm": {"l": round(ml, 2), "w": round(max(K.v(r["W"]), K.v(fl["w"]) if fl else 0), 2),
                    "h": round(max(K.v(r["H"]), K.v(fl["h"]) if fl else 0), 2)},
        "dims_note": f"mated length {ml:.1f} (receptacle {K.v(r['L']):g} + plug {K.v(p['A']):g} less the {dims(p)['d_ins']:.1f} nose)",
        "frame": ("origin at the centre of the mating plane; +Z toward the plug; +Y the latch side; the receptacle's "
                  "wires leave toward -Z, the plug's toward +Z"),
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"receptacle_wires": "-Z", "plug_wires": "+Z", "latch": "+Y"}},
        "refs": piece_module(r["pn"]).PART["refs"],
        "unknowns": piece_module(r["pn"]).PART["unknowns"] + (["Still to model for this end: " + "; ".join(missing)] if missing else []),
        "notes": [f"pieces: {', '.join(pieces)} (each is also its own model)"] + fill_notes,
        "contacts": {"receptacle": rf, "plug": pf},
        "drawing_notes": [(f"Mated length {ml:.1f} mm follows the photo-scaled nose depth ({dims(p)['d_ins']:.1f} mm).", "photo")],
    }
    if fl:
        m.PART["keepout"] = "the panel cutout (drawn as a keep-out plate outline where the maker prints it)"

    def build():
        bodies = build_receptacle(r, fill=rf) + build_plug(p, fill=pf)
        for gid in gaskets:
            bodies += build_gasket(gid)
        extra = []
        if fl and fl.get("cutout"):
            cw, ch, cr = (K.v(x) for x in fl["cutout"])
            z = -(K.v(fl["front"]) + K.v(fl["t"])) - (K.v(GASKETS[gaskets[0]]["t"]) if gaskets else 0)
            panel = rr(K.v(fl["w"]) + 30, K.v(fl["h"]) + 30, 2, z - 1.6, z) - rr(cw, ch, cr, z - 3, z + 1)
            extra.append(K.body(panel, "keep-out: panel with the recommended cutout (1.6 mm sheet, illustration)",
                                "#2e7d32", alpha=0.25))
        return bodies, extra, []
    m.build = build
    zr, zp = -K.v(r["L"]), dims(p)["A"] - dims(p)["d_ins"]
    rpref, ppref = SERIES[r["series"]]["pin_part"][:4], SERIES[r["series"]]["socket_part"][:4]
    m.attach_points = lambda: ([{"n": f"rec_cav{k}", "ep": end, "at": [x, y, round(zr, 2)], "dir": [0, 0, -1],
                                 "kind": f"{r['pn']} pin"} for k, (x, y) in r["grid"].items()]
                               + [{"n": f"plug_cav{k}", "ep": end, "at": [x, y, round(zp, 2)], "dir": [0, 0, 1],
                                   "kind": f"{p['pn']} socket"} for k, (x, y) in p["grid"].items()])
    m.mount_points = lambda: (flange_mounts(r) if fl else [])

    def terminals():
        rows = []
        for s, z, d, pref in ((r, zr, (0, 0, -1), rpref), (p, zp, (0, 0, 1), ppref)):
            for k, (x, y) in s["grid"].items():
                rows.append({"pin": f"{'R' if s is r else 'P'}{k}", "endpoint": end, "name": f"{s['pn']} cavity {k}",
                             "match": rf"^{k}\b", "part_prefix": pref, "at": (x, y, z), "dir": d,
                             "endpoint_cavities": HARNESS_HALF.get(end) == s["pn"],
                             "full_name": f"{s['pn']} cavity {k} ({'number not sourced' if s.get('numbering') is None else 'moulded'})"})
        return rows
    m.terminals = terminals
    rp = piece_module(r["pn"]).CHECKS
    m.CHECKS = [("mated length (receptacle + plug - nose)",
                 lambda b: round(_bb([x for x in b if "gasket" not in x.label and "sealing plug" not in x.label]).size.Z, 2),
                 round(ml, 2), 0.05),
                ("contacts in the cavities the registry uses", lambda b: sorted(k for k, v in rf.items() if v and not v.startswith("plug:"))
                 == sorted(k for k, v in rf.items() if v and not v.startswith("plug:")), True),
                ("cavities line up (every plug cavity on a receptacle cavity)",
                 lambda b: all(k in r["grid"] and r["grid"][k] == v for k, v in p["grid"].items()), True)] + \
        [(f"{r['pn']}: {n}", (lambda f: (lambda b: f(b[:4 if not fl else 5])))(fn), want, *tol) for n, fn, want, *tol in rp
         if "flange" in n]
    m.annotate = lambda S, views: annotate_assembly(S, views, r, p)
    return m


SEAL_PLUG = {"DTM": "0413-204-2005"}     # size-20 sealing plug (modelled); the size-16 114017 has no photo on file


def end_fill(end, r, p):
    """Which contact sits in which cavity of each half, from the registry: its terminations' contact part numbers (0460
    pins, 0462 sockets), the endpoint's own cavity map for implied wires, the mating contact opposite every used cavity,
    and sealing plugs in the rest where the family's plug is modelled."""
    reg = K.registry()
    rf, pf, notes = {}, {}, []
    for t in reg["terminations"]:
        if t["endpoint"] != end:
            continue
        m_ = re.match(r"^(\d+)\b", str(t.get("cavity", "")))
        if not m_:
            continue
        k, part = m_.group(1), str(t.get("part") or "")
        if part not in CT.SPEC:
            if part.startswith(("0460", "0462")):
                notes.append(f"cavity {k}: registry contact {part} is drawn as the series' standard contact")
            part = (SERIES[r["series"]]["pin_part"] if part.startswith("0460") else SERIES[r["series"]]["socket_part"]
                    if part.startswith("0462") else "")
        if part.startswith("0460"):
            rf[k] = part
        elif part.startswith("0462"):
            pf[k] = part
    hh = HARNESS_HALF.get(end)
    if hh:
        for w, c in ((reg["endpoints"].get(end) or {}).get("cavities") or {}).items():
            k = str(c).split()[0]
            if hh == p["pn"]:
                pf.setdefault(k, SERIES[p["series"]]["socket_part"])
            else:
                rf.setdefault(k, SERIES[r["series"]]["pin_part"])
    used = set(rf) | set(pf)
    for k in used:
        rf.setdefault(k, SERIES[r["series"]]["pin_part"])
        pf.setdefault(k, SERIES[p["series"]]["socket_part"])
    sp = SEAL_PLUG.get(r["series"])
    for k in r["grid"]:
        if k not in used:
            if sp:
                rf[k] = pf[k] = "plug:" + sp
            else:
                rf[k] = pf[k] = None
    if end == "IBST-DIAG":      # endpoints.yaml: the cap's four cavities all take sealing plugs
        rf = {k: "plug:" + sp for k in r["grid"]}
    empty = [k for k in r["grid"] if not rf.get(k) and not pf.get(k)]
    if empty:
        notes.append(f"cavities {', '.join(empty)} are spare: sealing plug 114017 (size 16) per the kit, not modelled "
                     "(no maker photo or drawing on file)")
    return rf, pf, notes


def annotate_assembly(S, views, r, p):
    rt = views["right"]
    zr, zp = -K.v(r["L"]), dims(p)["A"] - dims(p)["d_ins"]
    y = -K.v(r["H"]) / 2 - 2
    S.dim(rt, (0, y, zr), (0, y, zp), -8, Dim(round(zp - zr, 2), "derived: receptacle + plug - nose", "photo"))


def gasket_module(gid):
    gk = GASKETS[gid]
    fl = REC[gk["outline"]]["flange"]
    m = types.SimpleNamespace()
    m.P = {"t": gk["t"], "open_w": gk["open_w"], "open_h": gk["open_h"], "open_r": gk["open_r"],
           "outline_w": fl["w"], "outline_h": fl["h"], "hole_d": fl["hole_d"], "hole_x": fl["hole_x"]}
    if fl.get("hole_y"):
        m.P["hole_y"] = fl["hole_y"]
    m.COLORS = {"gasket": gk["colour"]}
    m.PART = {"pid": gid, "endpoints": list(gk["endpoints"]), "maker": "TE Connectivity (Deutsch)", "pn": gid,
              "title": f"Deutsch {gid} flange gasket", "what": f"flange gasket for {', '.join(gk['for'])} (neoprene / closed-cell sponge)",
              "shape_basis": "datasheet dims", "viewset": "wall", "kind": "piece", "family": "deutsch gasket", "mates": gk["for"][0],
              "dims_mm": {"l": K.v(gk["t"]), "w": K.v(fl["w"]), "h": K.v(fl["h"])},
              "dims_note": f"the flange outline {K.v(fl['w']):g} x {K.v(fl['h']):g}, {K.v(gk['t']):g} thick ({CAT24}); "
                           f"opening {K.v(gk['open_w']):g} x {K.v(gk['open_h']):g} photo-scaled",
              "frame": "the receptacle's frame: the gasket sits on the flange's wire-side face, toward -Z",
              "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"flange": "+Z", "panel": "-Z"}},
              "refs": [("[1]", "Deutsch DT family catalog", "Deutsch DT family catalog p.24 (gaskets)"),
                       ("[2]", "customconnectorkits.com", "customconnectorkits product photo (flat; opening scaled from the flange width)")],
              "unknowns": ["The outline is taken as the flange's (the catalog pairs the gasket with that flange); the opening "
                           "is photo-scaled (+-0.5)."],
              "notes": [f"catalog p.24: gasket {gid} for connector {', '.join(gk['for'])}; rated -70 to +225 F"]}
    m.build = lambda: (build_gasket(gid), [], [])
    zf = -(K.v(fl["front"]) + K.v(fl["t"]))
    m.attach_points = lambda: [{"n": f"flange_face_{e}", "ep": e, "at": [0.0, 0.0, round(zf, 2)], "dir": [0, 0, 1],
                                "kind": "gasket face on the flange (no wires)"} for e in gk["endpoints"]]
    m.mount_points = lambda: flange_mounts(REC[gk["outline"]])
    m.CHECKS = [("thickness .125 in", lambda b: round(b[0].bounding_box().size.Z, 3), 3.175, 0.005),
                ("outline = the flange (the diamond's 40.64 + 2 x R6.35 = 53.34 against TE's 53.3)",
                 lambda b: round(b[0].bounding_box().size.X, 2), round(K.v(fl["w"]), 2), 0.05)]
    return m


# ------------------------------------------------------------------------------------------ the family's interface
def contact_use():
    """{contact PN: set of end ids}, from every end's cavity fill."""
    use = {}
    for e, (pcs, _) in ENDS.items():
        specs = [REC.get(x) or PLG.get(x) for x in pcs if x in REC or x in PLG]
        r = next(s for s in specs if s["kind"] == "receptacle")
        p = next(s for s in specs if s["kind"] == "plug")
        rf, pf, _ = end_fill(e, r, p)
        for v in list(rf.values()) + list(pf.values()):
            if v:
                use.setdefault(v[5:] if v.startswith("plug:") else v, set()).add(e)
    return use


def pieces():
    """Every part-like object this family makes: housings (by PN), gaskets, the contacts and sealing plugs, and one
    mated assembly per end."""
    out = [piece_module(pn) for pn in list(REC) + list(PLG)]
    out += [gasket_module(g) for g in GASKETS]
    use = contact_use()
    out += [CT.module(pn, sorted(use[pn])) for pn in CT.SPEC if pn in use]
    for pn, ends in use.items():          # an end is complete only with its contacts modelled too
        for e in ends:
            if pn not in END_NEEDS[e]:
                END_NEEDS[e].append(pn)
    out += [assembly_module(e) for e in ENDS]
    return out


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
            K.run(m, out_root / pid)
        except SystemExit as e:
            bad.append(f"{pid}: {e}")
    if bad:
        print("FAILED:", *bad, sep="\n  ")
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
