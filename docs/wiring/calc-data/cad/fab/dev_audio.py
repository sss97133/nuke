"""Speaker family for the K5 device models: round drivers that mount through a panel (door speakers, woofers).

One builder, speaker(), draws a driver from its printed numbers: the frame on the mounting face, the cone, surround and
dust cap (or a tweeter on its post), the basket and the motor behind the panel, the terminals, and the keep-outs (the
mounting depth behind, the grille or cone travel in front). Each maker's part is a function here that returns the part
script's namespace (P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS, part_meta); the per-end
scripts (SPK-FL.py ...) are three lines that pick the part and the end.

Frame (mm): origin at the centre of the mounting face (the frame's back, where it seats on the panel). +Z out of the
panel toward the listener, +Y up, +X right; basket and motor behind the panel (-Z).
"""
import math
import sys
from pathlib import Path
from types import SimpleNamespace

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402


def speaker(pid, P, C, tweeter=False, terms=(), holes=(4, 0.0, 4.2), label=""):
    """P keys used: frame_od, frame_t, open_d (the frame's inner edge), cone_front (cone / surround top above the mounting
    face), cone_d, cone_depth, cap_d, basket_top_d, basket_bot_d, basket_l, motor_d, depth (mounting depth, face to the
    motor's back), tw_d, tw_proud (tweeter). holes = (n, bolt circle, d)."""
    v = K.v
    fo, ft = v(P["frame_od"]), v(P["frame_t"])
    frame = D.cyl(fo, ft) - D.cyl(v(P["open_d"]), ft + 2, at=(0, 0, -1))
    n, bc, hd = holes
    if n and bc:
        for i in range(n):
            a = math.radians(45 + 360 * i / n)
            frame -= D.cyl(hd, ft + 2, at=(bc / 2 * math.cos(a), bc / 2 * math.sin(a), -1))
    depth = v(P["depth"])
    bl = v(P["basket_l"])
    basket = D.cone(v(P["basket_bot_d"]), v(P["basket_top_d"]), bl + 0.01, at=(0, 0, -bl))
    basket -= D.cone(v(P["basket_bot_d"]) - 5.0, v(P["basket_top_d"]) - 5.0, bl + 0.02, at=(0, 0, -bl - 0.005))
    motor = D.cyl(v(P["motor_d"]), depth - bl + 0.01, at=(0, 0, -depth))
    cf, cd, cdep = v(P["cone_front"]), v(P["cone_d"]), v(P["cone_depth"])
    sur_w = (v(P["open_d"]) - cd) / 2
    surround = D.cyl(v(P["open_d"]) - 0.5, cf - 1.0, at=(0, 0, 1.0)) - D.cyl(cd - 0.5, cf + 2, at=(0, 0, 0))
    cone = D.cone(v(P["cap_d"]), cd, cdep, at=(0, 0, cf - cdep)) - D.cone(v(P["cap_d"]) - 2.4, cd - 2.4, cdep + 0.02,
                                                                        at=(0, 0, cf - cdep + 1.2))
    bodies = [K.body(frame, f"{pid} frame", C["frame"][0]),
              K.body(basket + motor, f"{pid} basket and motor", C["basket"][0], finish="cast"),
              K.body(surround, f"{pid} surround", C["surround"][0], finish="rubber"),
              K.body(cone, f"{pid} cone", C["cone"][0])]
    if sur_w <= 0:
        raise ValueError("cone wider than the frame opening")
    if tweeter:
        tp = v(P["tw_proud"])
        post = D.cyl(v(P["cap_d"]) * 0.55, tp - 10.0 - (cf - cdep) + 0.5, at=(0, 0, cf - cdep - 0.5))
        tw = D.cyl(v(P["tw_d"]), 6.0, at=(0, 0, tp - 10.0)) + D.dome(v(P["tw_d"]) * 0.8, 4.0, at=(0, 0, tp - 4.0))
        bodies.append(K.body(post, f"{pid} tweeter post", C["basket"][0]))
        bodies.append(K.body(tw, f"{pid} tweeter (silk dome)", C["tweeter"][0]))
    else:
        cap = D.dome(v(P["cap_d"]), 6.0, at=(0, 0, cf - cdep))
        bodies.append(K.body(cap, f"{pid} dust cap", C["cone"][0]))
    for t in terms:
        bodies.append(K.body(t["solid"], f"{pid} terminal {t['pin']} ({t['what']})", C["terminal"][0], finish="metal"))
    return bodies


def _namespace(pid, P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS):
    ns = SimpleNamespace(P=P, COLORS=COLORS, PART=PART, build=build, attach_points=attach_points, terminals=terminals,
                         mount_points=mount_points, CHECKS=CHECKS)
    ns.part_meta = lambda bodies: D.part_meta(ns, bodies)
    return vars(ns)


# ------------------------------------------------------------------------------------------ JL Audio C2-650X
JL_MAN = "reference_documents/component_drawings/JL_Audio_C2-650X_Manual.pdf"
JL_TAB = f"{JL_MAN} p.2, Woofer Physical Dimensions"
JL_PHURL = ("https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/20081/136/x136C2650X-f.jpeg (Crutchfield, "
            "fetched 2026-09-29)")
JL_PH = f"sized off the Crutchfield product photo {JL_PHURL} against the printed 165.0 frame"
JL_PHOTO = f"Crutchfield product photo {JL_PHURL}, k-means of the region"


def jl_c2_650x(end, where):
    """JL Audio C2-650X 6.5 in coax. end: the registry end (SPK-FL ...); where: a few words on the spot."""
    pid = end
    P = {
        "frame_od": Dim(165.0, f"{JL_TAB} (A) 6.50 in / 165.0 mm"),
        "grille_od": Dim(173.7, f"{JL_TAB} (B) 6.84 in / 173.7 mm"),
        "motor_d": Dim(80.0, f"{JL_TAB} (C) 3.15 in / 80.0 mm w/o cover"),
        "tw_proud": Dim(11.6, f"{JL_TAB} (D) 0.45 in / 11.6 mm"),
        "grille_proud": Dim(21.6, f"{JL_TAB} (E) 0.85 in / 21.6 mm"),
        "hole_d": Dim(141.3, f"{JL_TAB} (F) 5.56 in / 141.3 mm"),
        "depth": Dim(61.9, f"{JL_TAB} (G) 2.44 in / 61.9 mm w/o cover"),
        "screw_pilot": Dim(3.2, f"{JL_MAN} p.3: 'Drill four 1/8-inch (3 mm) holes for the speaker's mounting screws'"),
        "screw": Dim(4.2, f"{JL_MAN}: 'Eight #8 x 1 1/4-inch (30mm) sheet metal screws' (#8 = 4.2 mm)"),
        "frame_t": Dim(4.0, JL_PH, "photo", "frame flange thickness"),
        "open_d": Dim(138.0, JL_PH, "photo", "frame's inner edge (surround outer)"),
        "cone_d": Dim(118.0, JL_PH, "photo", "cone outer (surround inner)"),
        "cone_front": Dim(5.0, JL_PH, "photo", "surround roll above the mounting face"),
        "cone_depth": Dim(22.0, JL_PH, "photo", "cone depth"),
        "cap_d": Dim(46.0, JL_PH, "photo", "cone neck under the tweeter post"),
        "tw_d": Dim(26.0, JL_PH, "photo", "tweeter housing"),
        "basket_top_d": Dim(134.0, JL_PH, "photo", "basket at the frame"), "basket_bot_d": Dim(84.0, JL_PH, "photo"),
        "basket_l": Dim(40.0, JL_PH, "photo", "basket behind the mounting face"),
        "bolt_circle": Dim(153.0, JL_PH, "photo", "screw holes' circle (4 used of the universal pattern)", "fit-critical, scaled"),
        "tab_pos": Dim(5.2, f"{JL_MAN} p.3: '(2) 5.2 mm female crimpable connectors' (the + tab)"),
        "tab_neg": Dim(2.8, f"{JL_MAN} p.3: '(2) 2.8 mm female crimpable connectors' (the - tab)"),
        "tab_l": Dim(8.0, JL_PH, "photo", "tab length"),
    }
    COLORS = {
        "frame": ("#1c1c1e", JL_PHOTO + " (frame, black)"),
        "basket": ("#232325", JL_PHOTO + " (basket, black)"),
        "surround": ("#141415", JL_PHOTO + " (butyl surround, black)"),
        "cone": ("#1a1a1b", JL_PHOTO + " (cone, black)"),
        "tweeter": ("#2b2b2d", JL_PHOTO + " (tweeter housing)"),
        "trim": ("#c6c9cc", JL_PHOTO + " (silver trim ring)"),
        "terminal": ("#c9c6bd", "tabs: drawn tin"),
        "label": ("#5d4f9c", JL_PHOTO + " (magnet cover label, purple)"),
    }
    wires = {"SPK-FL": ("26a", "26b"), "SPK-FR": ("27a", "27b"), "SPK-RL": ("28a", "28b"), "SPK-RR": ("29a", "29b")}[end]
    PART = {
        "pid": pid, "endpoints": [end], "maker": "JL Audio", "pn": "C2-650X",
        "title": f"JL Audio C2-650X 6.5 in coaxial speaker ({end})",
        "what": f"{where} speaker, JL Audio C2-650X 6.5 in (165 mm) 2-way coaxial, 4 ohm",
        "shape_basis": "datasheet dims", "viewset": "wall",
        "dims_mm": {"l": 165.0, "w": 165.0, "h": 73.5},
        "dims_note": "frame Ø165.0 on the panel; hole Ø141.3; 61.9 deep behind the mounting face (magnet w/o cover); tweeter 11.6 "
                     "in front (21.6 with the grille, Ø173.7 grille tray)",
        "margin": {"mm": 3.0, "why": "every envelope number printed by JL; the frame section, cone, basket and screw circle sized "
                                    "off the photo (±3)"},
        "frame": "origin at the centre of the mounting face (frame back on the panel); +Z toward the listener, +Y up (terminals "
                 "down), basket and motor behind (-Z)",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"cone": "+Z", "terminals": "-Y"}},
        "photo": {"url": "https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/20081/136/x136C2650X-f.jpeg",
                  "page": "https://www.crutchfield.com/p_136C2650X/JL-Audio-C2-650X.html", "fetched": "2026-09-29"},
        "photo_short": "Crutchfield product photo C2-650X",
        "branding": ["silver trim ring round the cone"],
        "dims_draw": [("front", "x", "frame_od", -10), ("right", "z", "depth", -10)],
        "refs": [("[1]", "Woofer Physical Dimensions", "JL Audio C2-650X owner's manual p.2: Woofer Physical Dimensions (A-G)"),
                 ("[2]", "C2-650X_Manual.pdf p.3", "same manual p.3: installation (screws, connectors)"),
                 ("[3]", "Eight #8", "same manual: what is included"),
                 ("[4]", "sized off the Crutchfield", "sized off the Crutchfield photo against the printed 165.0")],
        "drawing_notes": [
            (f"+ on the large 5.2 mm tab, - on the small 2.8 mm tab (JL): wires {wires[0]} (+) and {wires[1]} (-).", "#10151a"),
            ("Mounting depth 61.9 behind the mounting face (w/o the magnet cover): the keep-out behind is drawn to it + 10.", "#10151a"),
        ],
        "unknowns": ["The frame's screw pattern: JL ships a universal pattern (4- and 3-hole factory patterns); 4 holes drawn on a "
                     "Ø153 circle (photo): mark the door with JL's template.",
                     "Where the terminals sit round the basket is from the photo (drawn at the bottom).",
                     "The door or cargo-panel spot is open (mounts.yaml)." if end in ("SPK-RL", "SPK-RR") else
                     "The door spot and the grille are the door panel's (not drawn)."],
    }
    v = K.v
    ZT = -12.0

    def build():
        terms = []
        for pin, w, x in (("+", v(P["tab_pos"]), -5.0), ("-", v(P["tab_neg"]), 5.0)):
            y = -v(P["basket_top_d"]) / 2 + 5.0
            terms.append({"pin": pin, "what": f"{w:g} mm tab", "solid": D.blade((x, y, ZT), axis="-y", w=w, t=0.8, l=v(P["tab_l"]))})
        bodies = speaker(pid, P, COLORS, tweeter=True, terms=terms, holes=(4, v(P["bolt_circle"]), v(P["screw_pilot"])))
        trim = D.cyl(v(P["cone_d"]) + 6.0, 1.2, at=(0, 0, v(P["cone_front"]) - 1.4)) - D.cyl(v(P["cone_d"]) - 1.0, 8, at=(0, 0, -2))
        cosmetic = [K.body(trim, f"{pid} trim ring (silver)", COLORS["trim"][0], finish="metal")]
        lab = D.cyl(v(P["motor_d"]) - 6.0, 0.2, at=(0, 0, -v(P["depth"]) - 0.19))
        cosmetic.append(K.body(lab, f"{pid} branding: magnet cover label (redrawn from the photo, cosmetic)", COLORS["label"][0],
                               finish="print"))
        keep = [K.body(D.cyl(v(P["grille_od"]), v(P["grille_proud"]), at=(0, 0, 0)), "keep-out: grille and tweeter in front (21.6)",
                       "#2e7d32", alpha=0.25),
                K.body(D.cyl(v(P["hole_d"]), v(P["depth"]) + 10.0, at=(0, 0, -v(P["depth"]) - 10.0)),
                       "keep-out: mounting depth behind the panel (61.9 + 10)", "#2e7d32", alpha=0.25)]
        return bodies, keep, cosmetic

    def attach_points():
        y = -v(P["basket_top_d"]) / 2 + 5.0 - v(P["tab_l"])
        return [{"n": "pos", "ep": end, "at": [-5.0, round(y, 2), ZT], "dir": [0, -1, 0], "kind": "5.2 mm tab", "note": f"+ ({wires[0]})"},
                {"n": "neg", "ep": end, "at": [5.0, round(y, 2), ZT], "dir": [0, -1, 0], "kind": "2.8 mm tab", "note": f"- ({wires[1]})"}]

    def terminals():
        y = -v(P["basket_top_d"]) / 2 + 5.0 - v(P["tab_l"])
        return [{"pin": "+", "endpoint": end, "name": "+ (large 5.2 mm tab)", "kind": "5.2 mm tab", "wires": [wires[0]],
                 "at": (-5.0, y, ZT), "dir": (0, -1, 0)},
                {"pin": "-", "endpoint": end, "name": "- (small 2.8 mm tab)", "kind": "2.8 mm tab", "wires": [wires[1]],
                 "at": (5.0, y, ZT), "dir": (0, -1, 0)}]

    def mount_points():
        bc = v(P["bolt_circle"])
        return [{"n": f"screw_{i}", "at": [round(bc / 2 * math.cos(math.radians(45 + 90 * i)), 2),
                                           round(bc / 2 * math.sin(math.radians(45 + 90 * i)), 2), v(P["frame_t"])],
                 "dir": [0, 0, -1], "d": v(P["screw"]), "note": "#8 sheet-metal screw through the frame"} for i in range(4)]

    CHECKS = [
        ("frame outer diameter (A)", lambda b: b[0].bounding_box().size.X, 165.0),
        ("magnet outer diameter (C)", lambda b: v(P["motor_d"]), 80.0),
        ("tweeter in front of the mounting face (D)", lambda b: Compound(children=b).bounding_box().max.Z, 11.6),
        ("mounting depth (G)", lambda b: -Compound(children=b).bounding_box().min.Z, 61.9),
        ("basket passes the mounting hole (F)", lambda b: b[1].bounding_box().size.X <= 141.3, True),
    ]
    return _namespace(pid, P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ JBL Club 102SL
JBL_SNAP = "reference_documents/web_snapshots/www.crutchfield.com__JBL-Club-102SL.md (Crutchfield specs, fetched 2026-09-28)"
JBL_PHURL = ("https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/2024/26/109/g109CL102SL-M.jpg (Crutchfield, "
             "fetched 2026-09-29)")
JBL_BACK = "reference_documents/component_drawings/JBL_Club_102SL_back_crutchfield.jpg (Crutchfield back photo)"
JBL_PH = f"sized off {JBL_BACK} and the front photo {JBL_PHURL} against the printed 10.5 in frame"
JBL_PHOTO = f"Crutchfield product photo {JBL_PHURL}, k-means of the region"


def jbl_club_102sl(end, which):
    pid = end
    P = {
        "frame_od": Dim(266.7, f"{JBL_SNAP}: 'Frame Width 10.5' in", "vendor"),
        "hole_d": Dim(228.6, f"{JBL_SNAP}: 'cutout diameter: 9.0\"'", "vendor"),
        "depth": Dim(82.55, f"{JBL_SNAP}: 'top-mount depth: 3.25\"'", "vendor"),
        "cone_front": Dim(17.3, f"{JBL_SNAP}: 'mounting height: 0.68\"' (above the mounting surface)", "vendor"),
        "frame_t": Dim(6.0, JBL_PH, "photo", "frame flange"),
        "open_d": Dim(236.0, JBL_PH, "photo", "frame's inner edge"),
        "cone_d": Dim(206.0, JBL_PH, "photo", "flat cone outer (surround inner)"),
        "cone_depth": Dim(6.0, JBL_PH, "photo", "the flat cone's dish"),
        "cap_d": Dim(196.0, JBL_PH, "photo", "flat cone face"),
        "basket_top_d": Dim(224.0, JBL_PH, "photo", "basket at the frame"), "basket_bot_d": Dim(196.0, JBL_PH, "photo"),
        "basket_l": Dim(50.0, JBL_PH, "photo", "basket behind the mounting face"),
        "motor_d": Dim(188.0, JBL_PH, "photo", "shallow motor can (the back label disc)"),
        "bolt_circle": Dim(250.0, JBL_PH, "photo", "screw holes' circle (8 holes)", "fit-critical, scaled"),
        "screw": Dim(4.2, "screw size not printed", "assumed"),
        "post_d": Dim(6.0, JBL_PH, "photo", "spring push-terminal post"), "post_l": Dim(28.0, JBL_PH, "photo"),
        "block_w": Dim(30.0, JBL_PH, "photo", "terminal block on the basket"),
    }
    COLORS = {
        "frame": ("#1d1d1f", JBL_PHOTO + " (frame, black)"),
        "basket": ("#2e2f31", JBL_PHOTO + " (steel basket, textured black-grey)"),
        "surround": ("#18181a", JBL_PHOTO + " (rubber surround, black)"),
        "cone": ("#232426", JBL_PHOTO + " (aluminium cone, black anodised)"),
        "terminal": ("#c9c6bd", JBL_PHOTO + " (push-terminal posts, nickel)"),
        "accent": ("#e8651d", JBL_PHOTO + " (orange ring)"),
        "graphic": ("#6d6f73", JBL_PHOTO + " (cone graphic, grey)"),
    }
    wires = {"SUB": ("30a", "SUB_JMP_P", "30b", "SUB_JMP_N"), "SUB-2": ("SUB_JMP_P", None, "SUB_JMP_N", None)}[end]
    PART = {
        "pid": pid, "endpoints": [end], "maker": "JBL (Harman)", "pn": "Club 102SL (JBLSUBCB102SL)",
        "title": f"JBL Club 102SL 10 in shallow-mount subwoofer ({end})",
        "what": f"Woofer {which} of 2, JBL Club 102SL 10 in shallow-mount, SSI switch at 4 ohm",
        "shape_basis": "datasheet dims", "viewset": "wall",
        "dims_mm": {"l": 266.7, "w": 266.7, "h": 99.85},
        "dims_note": "frame 266.7 (10.5 in); cut-out Ø228.6 (9.0 in); 82.55 deep behind the mounting face (top-mount); cone "
                     "17.3 above it (Crutchfield's specs)",
        "margin": {"mm": 4.0, "why": "envelope from Crutchfield's spec table; the frame section, basket, motor can and terminal "
                                    "block sized off the photos (±4)"},
        "frame": "origin at the centre of the mounting face (frame back on the baffle); +Z out of the baffle, +Y up (terminals "
                 "down), motor behind (-Z)",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"cone": "+Z", "terminals": "-Y"}},
        "photo": {"url": "https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/2024/26/109/g109CL102SL-M.jpg",
                  "page": "https://www.crutchfield.com/p_109CL102SL/JBL-Club-102SL.html", "fetched": "2026-09-29"},
        "photo_short": "Crutchfield product photo Club 102SL",
        "branding": ["orange ring on the cone", "grey triangle and dot graphic", "'JBL'", "'CLUB' on the frame"],
        "dims_draw": [("front", "x", "frame_od", -10), ("right", "z", "depth", -10)],
        "refs": [("[1]", "JBL-Club-102SL.md", "Crutchfield JBL Club 102SL spec table (frame width, cut-out, depths)"),
                 ("[2]", "sized off", "sized off Crutchfield's front and back photos against the printed 10.5 in")],
        "drawing_notes": [
            ("Spring push terminals (+ red, - black) and the SSI 2/4 ohm switch on the basket; bare 14-8 AWG (registry).", "#10151a"),
            ("Both woofers at 4 ohm in parallel = 2 ohm on the amp's sub channel (registry).", "#10151a"),
            ("The enclosure is not designed yet (registry open); the keep-out behind is the top-mount depth + 10.", "design"),
        ],
        "unknowns": ["Frame section, screw circle, basket and motor can sized off photos (±4); JBL's own spec sheet PDF answered "
                     "403 to a scripted read.",
                     "The spot in the cargo area and the box are open (mounts.yaml)."],
    }
    v = K.v
    XT, YT, ZT = 0.0, -v(P["basket_top_d"]) / 2 + 2.0, -30.0

    def build():
        terms = []
        for pin, x in (("+", -8.0), ("-", 8.0)):
            terms.append({"pin": pin, "what": "spring push-terminal post",
                          "solid": D.cyl(v(P["post_d"]), v(P["post_l"]), at=(x, YT - 10.0, ZT - v(P["post_l"]) + 6.0))})
        bodies = speaker(pid, P, COLORS, tweeter=False, terms=terms, holes=(8, v(P["bolt_circle"]), 5.0))
        block = Pos(XT, YT - 5.0, ZT) * Box(v(P["block_w"]), 12.0, 16.0)
        bodies.append(K.body(block, f"{pid} terminal block with the SSI switch", COLORS["frame"][0]))
        cf = v(P["cone_front"])
        ring = D.cyl(v(P["cone_d"]) - 30.0, 0.3, at=(0, 0, cf)) - D.cyl(v(P["cone_d"]) - 34.0, 1, at=(0, 0, cf - 0.5))
        cosmetic = [K.body(ring, f"{pid} branding: orange ring (redrawn from the photo, cosmetic)", COLORS["accent"][0], finish="print")]
        tri = D.cyl(32.0, 0.3, at=(22.0, -22.0, cf))
        cosmetic.append(K.body(tri, f"{pid} branding: grey dot (redrawn from the photo, cosmetic)", COLORS["graphic"][0], finish="print"))
        t = K.text_solid("JBL", 9.0, (40.0, -48.0, cf), depth=0.2, style="bold")
        cosmetic.append(K.body(t, f"{pid} branding: 'JBL' (redrawn from the photo, cosmetic)", COLORS["graphic"][0], finish="print"))
        keep = [K.body(D.cyl(v(P["hole_d"]), v(P["depth"]) + 10.0, at=(0, 0, -v(P["depth"]) - 10.0)),
                       "keep-out: top-mount depth behind the baffle (82.55 + 10)", "#2e7d32", alpha=0.25)]
        return bodies, keep, cosmetic

    def attach_points():
        return [{"n": "pos", "ep": end, "at": [-8.0, round(YT - 10.0, 2), ZT + 6.0], "dir": [0, -1, 0], "kind": "push terminal",
                 "note": "+ spring terminal (bare wire)"},
                {"n": "neg", "ep": end, "at": [8.0, round(YT - 10.0, 2), ZT + 6.0], "dir": [0, -1, 0], "kind": "push terminal",
                 "note": "- spring terminal (bare wire)"}]

    def terminals():
        pos = [w for w in (wires[0], wires[1]) if w]
        neg = [w for w in (wires[2], wires[3]) if w]
        return [{"pin": "+", "endpoint": end, "name": "+ spring push terminal", "kind": "push terminal", "wires": pos,
                 "at": (-8.0, YT - 10.0, ZT + 6.0), "dir": (0, -1, 0)},
                {"pin": "-", "endpoint": end, "name": "- spring push terminal", "kind": "push terminal", "wires": neg,
                 "at": (8.0, YT - 10.0, ZT + 6.0), "dir": (0, -1, 0)}]

    def mount_points():
        bc = v(P["bolt_circle"])
        return [{"n": f"screw_{i}", "at": [round(bc / 2 * math.cos(math.radians(45 + 45 * i)), 2),
                                           round(bc / 2 * math.sin(math.radians(45 + 45 * i)), 2), v(P["frame_t"])],
                 "dir": [0, 0, -1], "note": "frame screw"} for i in range(8)]

    CHECKS = [
        ("frame width", lambda b: b[0].bounding_box().size.X, 266.7),
        ("top-mount depth", lambda b: -Compound(children=b).bounding_box().min.Z, 82.55),
        ("mounting height (cone above the face)", lambda b: Compound(children=b).bounding_box().max.Z, 17.3),
        ("basket passes the 9.0 in cut-out", lambda b: b[1].bounding_box().size.X <= 228.6, True),
    ]
    return _namespace(pid, P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)
