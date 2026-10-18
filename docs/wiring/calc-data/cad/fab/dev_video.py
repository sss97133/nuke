"""Rear-camera kit for the K5 device models: Rear View Safety RVS-7180355-IR (license-plate camera + replacement mirror
monitor). Both are drawn from the kit page's Product Dimensions (camera 1 x 7.5 x 1 in, mirror monitor 3.15 x 10.55 x 1 in)
and sized off Rear View Safety's photos against those numbers. Each function returns the part script's namespace."""
import sys
from pathlib import Path
from types import SimpleNamespace

from build123d import Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402

KIT = ("reference_documents/web_snapshots/www.rearviewsafety.com__license-plate-backup-camera-system-rvs-7180355-ir.md "
       "(Rear View Safety kit page, fetched 2026-09-28)")
MAN = "reference_documents/web_snapshots/www.surveillance-video.com__RVS-718-BB-Instruction-Manual.md (RVS-718-BB manual)"


def _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS):
    ns = SimpleNamespace(P=P, COLORS=COLORS, PART=PART, build=build, attach_points=attach_points, terminals=terminals,
                         mount_points=mount_points, CHECKS=CHECKS)
    ns.part_meta = lambda bodies: D.part_meta(ns, bodies)
    return vars(ns)


CAM_PHURL = "https://www.rearviewsafety.com/pub/media/catalog/product/r/v/rvs-0355-ir_main_2.jpg (Rear View Safety, fetched 2026-09-29)"
CAM_PH = f"sized off Rear View Safety's camera photo {CAM_PHURL} against the printed 7.5 in length (3.29 px/mm)"


def rvs_camera(end="Backup_Camera"):
    P = {
        "length": Dim(190.5, f"{KIT}: 'Camera: 1\" (H) x 7.5\" (L) x 1\" (D)'"),
        "height": Dim(25.4, f"{KIT}: camera 1 in (H)"),
        "depth": Dim(25.4, f"{KIT}: camera 1 in (D)"),
        "hole_pitch": Dim(172.0, CAM_PH, "photo", "end mounting holes (the plate's top screws; a US plate's holes are 7 in apart)",
                          "fit-critical, scaled"),
        "panel_w": Dim(102.0, CAM_PH, "photo", "IR LED panel"), "lens_d": Dim(22.0, CAM_PH, "photo", "lens ring"),
        "lens_proud": Dim(6.0, CAM_PH, "photo", "lens ring ahead of the bar"),
        "cable_l": Dim(150.0, f"{KIT} lists '1 x 33' Camera Cable'; the camera pigtail length is not printed", "assumed"),
    }
    COLORS = {"bar": ("#333436", f"Rear View Safety photo {CAM_PHURL}, k-means (bar, black, 70%)"),
              "lens": ("#101114", f"Rear View Safety photo {CAM_PHURL} (lens, black glass)"),
              "led": ("#b9bcbf", f"Rear View Safety photo {CAM_PHURL} (IR LED rims, silver)"),
              "cable": ("#1b1b1c", "camera pigtail: black")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "Rear View Safety", "pn": "RVS-7180355-IR (camera)",
        "title": "Rear View Safety RVS-7180355-IR license-plate camera",
        "what": "Backup camera, Rear View Safety RVS-7180355-IR license-plate bar camera with IR night vision",
        "shape_basis": "datasheet dims", "viewset": "wall",
        "dims_mm": {"l": 190.5, "w": 25.4, "h": 31.4},
        "dims_note": "190.5 x 25.4 x 25.4 (7.5 x 1 x 1 in, Rear View Safety); the lens ring stands ~6 proud (photo)",
        "margin": {"mm": 3.0, "why": "envelope printed by Rear View Safety; holes, LED panel and lens sized off the photo (±3)"},
        "frame": "origin at the centre of the bar's back (on the plate's top edge / the tailgate); +Z rearward (the view), +Y up",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"lens": "+Z", "cable": "-Z"}},
        "photo": {"url": "https://www.rearviewsafety.com/pub/media/catalog/product/r/v/rvs-0355-ir_main_2.jpg",
                  "page": "https://www.rearviewsafety.com/license-plate-backup-camera-system-rvs-7180355-ir", "fetched": "2026-09-29"},
        "photo_short": "Rear View Safety camera photo RVS-0355-IR",
        "branding": [],
        "dims_draw": [("front", "x", "length", -10), ("right", "z", "depth", 10)],
        "refs": [("[1]", "license-plate-backup-camera-system", "Rear View Safety RVS-7180355-IR kit page (Product Dimensions)"),
                 ("[2]", "sized off Rear View Safety", "sized off the camera photo against the printed 7.5 in"),
                 ("[3]", "not printed", "not in any source: assumed")],
        "drawing_notes": [("Camera end: #97 (+), CAM_GND and CAM_VIDEO; which of them land at the camera is open (the kit's power "
                           "harness, registry).", "#10151a")],
        "unknowns": ["Hole spacing sized off the photo (172; a US plate's top holes are 7 in = 177.8 apart): check on the part.",
                     "The camera pigtail and its plug are not described (kit: 33 ft camera cable)."],
    }
    v = K.v
    L_, H_, DP = v(P["length"]), v(P["height"]), v(P["depth"])

    def build():
        bar = D.rbox(L_, H_, DP, r=H_ / 2 - 0.5, r_top=4.0)
        for sx in (-1, 1):
            bar -= D.cyl(5.0, DP + 2, at=(sx * v(P["hole_pitch"]) / 2, 0, -1))
        panel = Pos(0, 1.0, DP - 0.01) * D.rbox(v(P["panel_w"]), H_ - 8.0, 1.5, r=2.0)
        lens = D.cyl(v(P["lens_d"]), v(P["lens_proud"]) + 1.5, at=(0, 0, DP - 0.01))
        glass = D.cyl(v(P["lens_d"]) * 0.55, 0.6, at=(0, 0, DP + v(P["lens_proud"]) + 1.4))
        bodies = [K.body(bar, f"{end} bar housing", COLORS["bar"][0]), K.body(panel, f"{end} IR LED panel", COLORS["bar"][0]),
                  K.body(lens, f"{end} lens ring", COLORS["bar"][0]), K.body(glass, f"{end} lens glass", COLORS["lens"][0], finish="gloss")]
        leds = [D.cyl(4.6, 0.8, at=(sx * (18.0 + 8.5 * i), 1.0, DP + 1.4)) for sx in (-1, 1) for i in range(3)]
        cos = [K.body(Compound(children=leds).fuse(), f"{end} IR LEDs (6)", COLORS["led"][0], finish="metal")]
        cable, _ = D.lead((0, 0, 0.5), (0, 0, -1), v(P["cable_l"]), d=4.5)
        cos.append(K.body(cable, f"{end} camera pigtail", COLORS["cable"][0], finish="rubber"))
        return bodies, [], cos

    def attach_points():
        return [{"n": "pigtail", "ep": end, "at": [0, 0, 0], "dir": [0, 0, -1], "kind": "pigtail",
                 "note": "camera pigtail out of the back (to the kit's 33 ft cable)"}]

    def terminals():
        return [{"pin": "CAM", "endpoint": end, "name": "camera pigtail (power, ground, video)", "kind": "kit cable",
                 "wires": ["97", "CAM_GND", "CAM_VIDEO"], "at": (0, 0, 0), "dir": (0, 0, -1), "free": (0, 0, -v(P["cable_l"]))}]

    def mount_points():
        return [{"n": f"hole_{'L' if sx < 0 else 'R'}", "at": [sx * v(P["hole_pitch"]) / 2, 0, DP], "dir": [0, 0, -1],
                 "note": "license-plate screw through the bar's end"} for sx in (-1, 1)]

    CHECKS = [("length", lambda b: b[0].bounding_box().size.X, 190.5), ("height", lambda b: b[0].bounding_box().size.Y, 25.4),
              ("depth", lambda b: b[0].bounding_box().size.Z, 25.4)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


MIR_PHURL = ("https://www.rearviewsafety.com/pub/media/catalog/product/r/e/replacement-mirror-monitor-rvs-718-main_2.jpg "
             "(Rear View Safety, fetched 2026-09-29)")
MIR_DIMS = "https://www.rearviewsafety.com/pub/media/catalog/product/7/1/718dimensions_3.jpg (Rear View Safety dimension photo, fetched 2026-09-29)"
MIR_PH = f"sized off Rear View Safety's dimension photo {MIR_DIMS} against its printed 10.55 in"


def rvs_mirror(end="MIRROR-MON"):
    P = {
        "length": Dim(268.0, f"{KIT}: 'Mirror Monitor: 3.15\" (H) x 10.55\" (L) x 1\" (D)'; {MIR_DIMS} '10.55 IN'"),
        "height": Dim(80.0, f"{KIT}: 3.15 in (H); {MIR_DIMS} '3.15 IN'"),
        "depth": Dim(25.4, f"{KIT}: 1 in (D)"),
        "screen": Dim(109.2, f"{KIT}: 'Screen Size 4.3\"' (diagonal)"),
        "screen_x": Dim(-52.0, MIR_PH, "photo", "display centre left of the mirror centre"),
        "end_r": Dim(30.0, MIR_PH, "photo", "rounded ends"),
        "arm_d": Dim(18.0, "the mounting arm is not dimensioned", "assumed"), "arm_l": Dim(35.0, "as arm_d", "assumed"),
        "harness_l": Dim(150.0, "the harness length is not printed", "assumed"),
    }
    COLORS = {"body": ("#454546", f"Rear View Safety photo {MIR_PHURL}, k-means (housing, black, 65%)"),
              "glass": ("#2a2f33", f"Rear View Safety photo {MIR_PHURL} (mirror glass, dark)"),
              "screen": ("#3b6a8f", f"Rear View Safety photo {MIR_PHURL} (display, lit)"),
              "button": ("#1c1c1d", "buttons: black")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "Rear View Safety", "pn": "RVS-7180355-IR (mirror monitor, G-Series)",
        "title": "Rear View Safety replacement mirror monitor (4.3 in display)",
        "what": "Mirror monitor, Rear View Safety replacement rear-view mirror with a 4.3 in display (RVS-7180355-IR kit); camera in reverse",
        "shape_basis": "datasheet dims", "viewset": "wall",
        "dims_mm": {"l": 268.0, "w": 25.4, "h": 80.0},
        "dims_note": "268 x 80 x 25.4 (10.55 x 3.15 x 1 in, Rear View Safety); the windshield mount arm is not dimensioned",
        "margin": {"mm": 3.0, "why": "envelope printed by Rear View Safety; the display position sized off the photo; the arm assumed"},
        "frame": "origin at the centre of the mirror's back (at the mount arm); +Z toward the driver (the glass), +Y up",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"glass": "+Z", "arm": "-Z"}},
        "photo": {"url": "https://www.rearviewsafety.com/pub/media/catalog/product/r/e/replacement-mirror-monitor-rvs-718-main_2.jpg",
                  "page": "https://www.rearviewsafety.com/license-plate-backup-camera-system-rvs-7180355-ir", "fetched": "2026-09-29"},
        "photo_short": "Rear View Safety mirror monitor photo",
        "branding": [],
        "dims_draw": [("front", "x", "length", -10), ("front", "y", "height", -10), ("right", "z", "depth", 10)],
        "refs": [("[1]", "license-plate-backup-camera-system", "Rear View Safety RVS-7180355-IR kit page (Product Dimensions)"),
                 ("[2]", "718dimensions", "Rear View Safety dimension photo (10.55 in, 3.15 in)"),
                 ("[3]", "sized off Rear View Safety", "sized off the dimension photo"), ("[4]", "not dimensioned", "assumed")],
        "drawing_notes": [("Harness: RED 12 V ignition (MIRROR_PWR), BLACK ground (MIRROR_GND), GREEN reverse trigger (MIRROR_TRIG) "
                           "spliced; the camera plugs in on the harness RCA (CAM_VIDEO). Colours per the RVS-718-BB manual (registry).",
                           "#10151a")],
        "unknowns": ["The windshield mount arm and button fitting are not dimensioned (drawn as a Ø18 x 35 post).",
                     "Harness colours are from the RVS-718-BB manual; confirm on the kit harness (registry)."],
    }
    v = K.v
    L_, H_, DP = v(P["length"]), v(P["height"]), v(P["depth"])

    def build():
        body = D.rbox(L_, H_, DP, r=v(P["end_r"]), r_top=6.0)
        glass = Pos(0, 0, DP - 0.3) * D.rbox(L_ - 10.0, H_ - 10.0, 0.6, r=v(P["end_r"]) - 5)
        sd = v(P["screen"])
        sw, sh = sd * 16 / (256 + 81) ** 0.5, sd * 9 / (256 + 81) ** 0.5
        screen = Pos(v(P["screen_x"]), 3.0, DP + 0.25) * Box(sw, sh, 0.2, align=D.BASE)
        arm = D.cyl(v(P["arm_d"]), v(P["arm_l"]), at=(0, 12.0, -v(P["arm_l"]) + 0.5))
        buttons = [D.rbox(7.0, 5.0, 2.0, r=1.0, at=(dx, -H_ / 2 + 7.0, DP - 1.0)) for dx in (-12.0, 0.0, 12.0)]
        bodies = [K.body(body, f"{end} housing", COLORS["body"][0]), K.body(glass, f"{end} mirror glass", COLORS["glass"][0], finish="gloss"),
                  K.body(arm, f"{end} mount arm (to the windshield button)", COLORS["body"][0])]
        cos = [K.body(screen, f"{end} 4.3 in display (image area)", COLORS["screen"][0], finish="gloss"),
               K.body(Compound(children=buttons).fuse(), f"{end} buttons", COLORS["button"][0])]
        for i, (col, w) in enumerate((("red", "MIRROR_PWR"), ("black", "MIRROR_GND"), ("green", "MIRROR_TRIG"), ("yellow", "CAM_VIDEO"))):
            s, _ = D.lead((-4.5 + 3.0 * i, 12.0, -v(P["arm_l"]) + 1.0), (0, 1, -0.4), v(P["harness_l"]), d=2.2)
            cos.append(K.body(s, f"{end} harness lead {col} ({w})", D.LEAD_HEX[col], finish="rubber"))
        return bodies, [], cos

    def attach_points():
        return [{"n": "harness", "ep": end, "at": [0, 12.0, round(-v(P["arm_l"]), 2)], "dir": [0, 1, 0], "kind": "harness",
                 "note": "power harness (red / black / green) and the camera RCA, out of the mount arm"}]

    def terminals():
        rows = []
        for pin, rx, i in (("RED", r"^RED", 0), ("BLACK", r"^BLACK", 1), ("GREEN", r"^GREEN", 2), ("VIDEO", r"^camera input", 3)):
            rows.append({"pin": pin, "endpoint": end, "name": f"{pin.lower()} harness lead", "kind": "harness lead", "match": rx,
                         "at": (-4.5 + 3.0 * i, 12.0, -v(P["arm_l"])), "dir": (0, 1, 0)})
        return rows

    def mount_points():
        return [{"n": "arm", "at": [0, 12.0, round(-v(P["arm_l"]), 2)], "dir": [0, 0, 1], "note": "mount arm onto the windshield button"}]

    CHECKS = [("length", lambda b: b[0].bounding_box().size.X, 268.0), ("height", lambda b: b[0].bounding_box().size.Y, 80.0),
              ("depth", lambda b: b[0].bounding_box().size.Z, 25.4)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)
