"""Motors and mechanisms for the K5 device models: door lock actuators, window regulators and their motors, the tailgate
window motor, the wiper motor with its washer pump, the electric parking brake, the power-step motor.

Each part is a function returning the part script's namespace (P, COLORS, PART, build, attach_points, terminals,
mount_points, CHECKS, part_meta); the per-end scripts pick the part and the end. Frames: origin at the centre of the
mounting face, +Z out of the mounting face, +X along the part's working motion where it has one (a plunger, a rod, an arm).
"""
import math
import sys
from pathlib import Path
from types import SimpleNamespace

from build123d import Axis, Box, Compound, Pos

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k5cad as K  # noqa: E402
import k5dev as D  # noqa: E402
from k5cad import Dim  # noqa: E402


def _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS):
    ns = SimpleNamespace(P=P, COLORS=COLORS, PART=PART, build=build, attach_points=attach_points, terminals=terminals,
                         mount_points=mount_points, CHECKS=CHECKS)
    ns.part_meta = lambda bodies: D.part_meta(ns, bodies)
    return vars(ns)


def mirror_x(solids):
    """Mirror bodies across the YZ plane (a right-hand part from its left-hand twin), keeping labels and colours."""
    from build123d import Plane, mirror
    out = []
    for s in solids:
        m = mirror(s, about=Plane.YZ)
        m.label, m.color = s.label, s.color
        out.append(m)
    return out


# ------------------------------------------------------------------------------------------ AutoLoc AUTZT2000
AL_PAGE = ("reference_documents/web_snapshots/shop.autoloc.com__compact-2-wire-car-door-lock-actuator-heavy-duty-12-volt-motor-"
           "13-lbs-power-12v.md (AutoLoc product page, fetched 2026-09-28)")
AL_PHURL = ("https://shop.autoloc.com/cdn/shop/files/2048_abcded99-9b45-4114-983b-9872425e0bc4.jpg (AutoLoc, fetched 2026-09-29)")
AL_PH = f"sized off AutoLoc's product photo {AL_PHURL} against the printed 5.25 in length"


def autoloc_autzt2000(end):
    side = "driver" if end.endswith("DS") else "passenger"
    P = {
        "length": Dim(133.35, f"{AL_PAGE}: 'Length :: 5.25”'", note="body end to the plunger tip, retracted"),
        "width": Dim(63.5, f"{AL_PAGE}: 'Width :: 2.5”'", note="over the mounting ears"),
        "height": Dim(19.05, f"{AL_PAGE}: 'Height :: 0.75”'"),
        "force": Dim(57.8, f"{AL_PAGE}: 'Push/Pull Force :: 13lbs' (57.8 N; not a dimension, kept for the pin notes)"),
        "body_l": Dim(88.0, AL_PH, "photo", "motor body"), "body_w": Dim(44.0, AL_PH, "photo", "motor body without the ears"),
        "boot_l": Dim(27.0, AL_PH, "photo", "corrugated boot"), "boot_d": Dim(17.0, AL_PH, "photo"),
        "tip_l": Dim(19.35, AL_PH, "photo", "plunger tip (rest of the 133.35)"), "tip_hole": Dim(4.0, AL_PH, "photo", "rod hole in the tip"),
        "ear_hole": Dim(4.5, AL_PH, "photo", "mounting ear holes"),
        "stroke": Dim(20.0, "the plunger stroke is not printed", "assumed", "keep-out drawn for 20 mm of travel"),
        "lead_l": Dim(150.0, f"{AL_PAGE}: 'Wire :: Plug-In Harness'; the harness length is not printed", "assumed"),
    }
    COLORS = {"body": ("#2b2b2c", f"AutoLoc photo {AL_PHURL} (ABS body, black)"),
              "tip": ("#ececec", f"AutoLoc photo {AL_PHURL} (plunger tip, white)"),
              "plug": ("#1d1d1e", "harness plug: black")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "AutoLoc", "pn": "AUTZT2000",
        "title": f"AutoLoc AUTZT2000 door lock actuator ({side} door)",
        "what": f"{side.capitalize()} door lock actuator, AutoLoc AUTZT2000 2-wire, 13 lb, 12 V",
        "shape_basis": "datasheet dims", "viewset": "wall",
        "dims_mm": {"l": 133.35, "w": 63.5, "h": 19.05},
        "dims_note": "5.25 x 2.5 x 0.75 in (AutoLoc); plunger stroke not printed (20 mm keep-out)",
        "margin": {"mm": 3.0, "why": "envelope printed by AutoLoc; body, boot, tip and ears sized off its photo (±3)"},
        "frame": "origin at the centre of the mounting face (flat side on the door's inner panel); +Z out of it, +X along the "
                 "plunger (toward the lock rod)",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"plunger": "+X", "plug": "-X"}},
        "photo": {"url": "https://shop.autoloc.com/cdn/shop/files/2048_abcded99-9b45-4114-983b-9872425e0bc4.jpg",
                  "page": "https://shop.autoloc.com/products/compact-2-wire-car-door-lock-actuator-heavy-duty-12-volt-motor-13-lbs-power-12v",
                  "fetched": "2026-09-29"},
        "photo_short": "AutoLoc photo AUTZT2000",
        "branding": [],
        "dims_draw": [("front", "x", "length", -10), ("front", "y", "width", -10), ("right", "z", "height", 10)],
        "refs": [("[1]", "shop.autoloc.com__compact", "AutoLoc AUTZT2000 page (5.25 x 2.5 x 0.75 in, 13 lb, plug-in harness)"),
                 ("[2]", "sized off AutoLoc", "sized off AutoLoc's photo against the printed 5.25 in"), ("[3]", "not printed", "assumed")],
        "drawing_notes": [("2 wires, polarity sets lock / unlock (registry: LOCK_BUS_A / LOCK_BUS_B, set at the bench).", "#10151a"),
                          ("Mount so the plunger runs along the lock rod; the 12 in mounting bar in the kit bends to suit.", "#10151a")],
        "unknowns": ["Stroke and the harness plug are not printed (AutoLoc's instruction link returned no document, registry).",
                     "Mounting spot inside the door is set on the door (mounts.yaml: on the lock rod)."],
    }
    v = K.v
    L_, W_, H_ = v(P["length"]), v(P["width"]), v(P["height"])
    X0 = -L_ / 2
    BL = v(P["body_l"])

    def build():
        body = Pos(X0 + BL / 2, 0, 0) * D.rbox(BL, v(P["body_w"]), H_, r=3.0, r_top=2.0)
        for sx, sy in ((0.2, 1), (0.85, 1), (0.2, -1), (0.85, -1)):
            ear = Pos(X0 + BL * sx, sy * (W_ / 2 - 5.5), 0) * D.rbox(12.0, 11.0, 5.0, r=5.4)
            ear -= D.cyl(v(P["ear_hole"]), 8, at=(X0 + BL * sx, sy * (W_ / 2 - 5.5), -1))
            body += ear
        bl, bd = v(P["boot_l"]), v(P["boot_d"])
        boot = D.cyl(bd, bl, at=(X0 + BL - 1.0, 0, H_ / 2), axis="x")
        for i in range(5):
            boot += D.cyl(bd + 2.0, 2.5, at=(X0 + BL + 3.0 + 4.6 * i, 0, H_ / 2), axis="x")
        tl = v(P["tip_l"])
        tip = D.cyl(12.0, tl, at=(X0 + BL + bl - 1.0, 0, H_ / 2), axis="x")
        tip -= D.cyl(v(P["tip_hole"]), 20, at=(L_ / 2 - 6.0, 0, H_ / 2 - 10), axis="z")
        plug = Pos(X0 - 8.0, 0, H_ / 2) * Box(16.0, 14.0, 10.0)
        parts = [K.body(body, f"{end} actuator body (ABS)", COLORS["body"][0]),
                 K.body(boot, f"{end} plunger boot", COLORS["body"][0], finish="rubber"),
                 K.body(tip, f"{end} plunger tip (rod eye)", COLORS["tip"][0]),
                 K.body(plug, f"{end} harness socket (2-wire)", COLORS["plug"][0])]
        keep = [K.body(Pos(L_ / 2 + v(P["stroke"]) / 2, 0, H_ / 2) * Box(v(P["stroke"]), 16.0, 16.0),
                       "keep-out: plunger travel (20 mm, stroke not printed)", "#2e7d32", alpha=0.25)]
        return parts, keep, []

    def attach_points():
        return [{"n": "socket", "ep": end, "at": [round(X0 - 16.0, 2), 0, round(H_ / 2, 2)], "dir": [-1, 0, 0], "kind": "plug-in harness",
                 "note": "2-wire plug-in harness (polarity sets lock / unlock)"}]

    def terminals():
        at = (X0 - 16.0, 0, H_ / 2)
        return [{"pin": "A", "endpoint": end, "name": "lead A", "kind": "harness lead", "wires": ["LOCK_BUS_A"], "at": at, "dir": (-1, 0, 0)},
                {"pin": "B", "endpoint": end, "name": "lead B", "kind": "harness lead", "wires": ["LOCK_BUS_B"], "at": at, "dir": (-1, 0, 0)}]

    def mount_points():
        return [{"n": f"ear_{i}", "at": [round(X0 + BL * sx, 2), round(sy * (W_ / 2 - 5.5), 2), 5.0], "dir": [0, 0, -1],
                 "d": v(P["ear_hole"]), "note": "mounting ear"} for i, (sx, sy) in enumerate(((0.2, 1), (0.85, 1), (0.2, -1), (0.85, -1)))]

    CHECKS = [("length to the plunger tip", lambda b: Compound(children=[x for x in b if "socket" not in x.label]).bounding_box().size.X, 133.35),
              ("width over the ears", lambda b: b[0].bounding_box().size.Y, 63.5),
              ("height", lambda b: Compound(children=b).bounding_box().size.Z, 19.05, 0.1)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ E-Stopp ESK001
ES_SIL = ("estopp.com/products/esk1-sil, Technical Specifications (fetched 2026-09-29 by the layout-ui lane: 'Length: 15 in (38.1 cm)', "
          "'Width: 3-1/4 in (9.6 cm) (including flanges)', 'Height: 2 in (5.1 cm)')")
ES_CM = "reference_documents/web_snapshots/estopp.com__esr1-cm.md (E-Stopp control module page, fetched 2026-09-28)"
ES_FAQ = "reference_documents/web_snapshots/estopp.com__faq.md (E-Stopp FAQ)"
ES_INS = ("https://cdn.shopify.com/s/files/1/0890/5841/0810/files/E-Stopp_ESK1_Instructions.pdf (E-Stopp ESK1 instructions, fetched "
          "2026-09-29)")
ES_PHURL = "https://static.summitracing.com/global/images/prod/xlarge/esc-esk001_xl.jpg (Summit Racing, fetched 2026-09-29)"
ES_PH = f"sized off the kit photo {ES_PHURL} against the printed 15 in actuator length"


def estopp_esk001(end="E-STOPP"):
    P = {
        "act_l": Dim(381.0, f"{ES_SIL}: 'Length: 15 in (38.1 cm)'"),
        "act_w": Dim(82.6, f"{ES_SIL}: 'Width: 3-1/4 in' (the page also says 9.6 cm, which is 3.78 in)",
                     note="3-1/4 in kept; the page disagrees with itself"),
        "act_h": Dim(50.8, f"{ES_SIL}: 'Height: 2 in (5.1 cm)'"),
        "travel": Dim(50.8, f"{ES_FAQ}: 'About 2 inches' of travel"),
        "box_l": Dim(133.4, f"{ES_CM}: 'Length: 5-1/4 in (13.4 cm) (including flanges)'"),
        "box_w": Dim(76.2, f"{ES_CM}: 'Width: 3 in (7.7 cm)'"),
        "box_h": Dim(34.9, f"{ES_CM}: 'Height: 1-3/8 in (3.5 cm)'"),
        "button_d": Dim(22.0, f"{ES_CM}: '22 mm latching billet button with LED'"),
        "harness_l": Dim(457.0, f"{ES_CM}: 'Wire Harness Length: 18 in (46 cm)'"),
        "tube_w": Dim(50.8, ES_PH, "photo", "actuator tube width (flanges make the 82.6)"),
        "flange_l": Dim(80.0, ES_PH, "photo", "slotted mounting flange length"), "flange_t": Dim(3.0, ES_PH, "photo"),
        "slot_l": Dim(40.0, ES_PH, "photo", "flange slot"), "slot_w": Dim(8.0, ES_PH, "photo"),
        "flange_x": Dim(145.0, ES_PH, "photo", "flange centres off the actuator centre"),
        "cable_d": Dim(9.0, ES_PH, "photo", "actuator cable housing"), "cable_show": Dim(80.0, "the cable is drawn cut short", "design"),
    }
    COLORS = {"tube": ("#cfd2d4", f"kit photo {ES_PHURL} (actuator tube, aluminium)"),
              "box": ("#1c1c1d", f"kit photo {ES_PHURL} (control box, black)"),
              "button": ("#d9dbdd", f"kit photo {ES_PHURL} (billet button bezel)"),
              "led": ("#2e9a4a", f"kit photo {ES_PHURL} (button LED, green)"),
              "cable": ("#161617", "actuator cable: black")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "E-Stopp", "pn": "ESK001 (actuator + control module + button)",
        "title": "E-Stopp ESK001 electric parking brake (actuator, control box, button)",
        "what": "Electric parking brake, E-Stopp ESK001: actuator on the parking-brake cable + control box, dash button in the kit",
        "shape_basis": "datasheet dims", "viewset": "floor",
        "dims_mm": {"l": 381.0, "w": 82.6, "h": 50.8},
        "dims_note": "actuator 381 x 82.6 x 50.8 over its flanges (E-Stopp); control box 133.4 x 76.2 x 34.9 and the 22 mm button "
                     "drawn beside it (display position); ~2 in of cable travel",
        "margin": {"mm": 8.0, "why": "envelopes printed by E-Stopp (its page gives the actuator width two ways, 3-1/4 in and 9.6 cm); "
                                    "flanges, slots and cable sized off the kit photo"},
        "frame": "origin at the centre of the actuator's mounting face (flanges on the frame rail); +Z up off the rail, +X along "
                 "the actuator toward its cable end",
        "axes": {"mount_normal": "+Z", "maker_up": "+Z", "faces": {"cable": "+X", "leads": "-X"}},
        "photo": {"url": "https://static.summitracing.com/global/images/prod/xlarge/esc-esk001_xl.jpg",
                  "page": "https://www.summitracing.com/parts/esc-esk001", "fetched": "2026-09-29"},
        "photo_short": "E-Stopp ESK001 kit photo (Summit)",
        "branding": ["'E-STOPP' on the actuator"],
        "dims_draw": [("front", "x", "act_l", -10), ("right", "y", "act_w", -10), ("right", "z", "act_h", 10)],
        "refs": [("[1]", "esk1-sil", "E-Stopp ESK1 page, technical specifications (actuator)"),
                 ("[2]", "estopp.com__esr1-cm", "E-Stopp control module page (box, button, harness)"),
                 ("[3]", "estopp.com__faq", "E-Stopp FAQ (travel)"), ("[4]", "sized off the kit photo", "sized off the kit photo"),
                 ("[5]", "cut short", "our choice")],
        "drawing_notes": [
            ("Control box leads (ESK1 instructions): E green switched ground (DAK_BRAKE), F blue ignition (ESTOPP_IGN), G red "
             "+12 V (#54), H black ground (ESTOPP_GND); the button harness plugs into the box (#126).", "#10151a"),
            ("Actuator leads brown / blue come from the box's C red / D black (kit wiring, not the loom).", "#10151a"),
        ],
        "unknowns": ["Actuator width: 3-1/4 in or 9.6 cm (E-Stopp's page gives both); 3-1/4 in drawn, margin 8 mm.",
                     "Where the actuator sits on the frame rail and where the box goes are open (mounts.yaml: proposed)."],
    }
    v = K.v
    AL, AW, AH = v(P["act_l"]), v(P["act_w"]), v(P["act_h"])
    BOX0 = (0.0, 140.0, 0.0)

    def build():
        tw = v(P["tube_w"])
        tube = Pos(0, 0, 0) * D.rbox(AL - 20.0, tw, AH, r=3.0, r_top=3.0)
        caps = [Pos(sx * (AL / 2 - 5.0), 0, 0) * D.rbox(10.0, tw - 2.0, AH - 2.0, r=2.0) for sx in (-1, 1)]
        fl, ft, sl, sw = v(P["flange_l"]), v(P["flange_t"]), v(P["slot_l"]), v(P["slot_w"])
        flanges = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                fw = (AW - tw) / 2 + 4.0
                f = Pos(sx * v(P["flange_x"]), sy * (AW / 2 - fw / 2), 0) * D.rbox(fl, fw, ft, r=3.0)
                f -= Pos(sx * v(P["flange_x"]), sy * (AW / 2 - fw / 2 + 1.0), -1) * D.rbox(sl, sw, ft + 2, r=sw / 2 - 0.01)
                flanges.append(f)
        act = tube + caps[0] + caps[1] + Compound(children=flanges).fuse()
        cable, _ = D.lead((AL / 2, 0, AH / 2), (1, 0, 0), v(P["cable_show"]), d=v(P["cable_d"]))
        bl, bw, bh = v(P["box_l"]), v(P["box_w"]), v(P["box_h"])
        box = Pos(*BOX0) * D.rbox(bl, bw, bh, r=4.0)
        btn = D.cyl(v(P["button_d"]) + 6.0, 6.0, at=(BOX0[0] + bl / 2 + 40.0, BOX0[1], 0)) + D.cyl(v(P["button_d"]), 30.0, at=(BOX0[0] + bl / 2 + 40.0, BOX0[1], -30.0))
        led = D.cyl(v(P["button_d"]) - 6.0, 0.8, at=(BOX0[0] + bl / 2 + 40.0, BOX0[1], 6.0))
        parts = [K.body(act, f"{end} actuator (aluminium tube, slotted flanges)", COLORS["tube"][0], finish="metal"),
                 K.body(cable, f"{end} actuator cable (to the brake cables)", COLORS["cable"][0], finish="rubber"),
                 K.body(box, f"{end} control box (display position)", COLORS["box"][0]),
                 K.body(btn, f"{end} dash button, 22 mm billet (display position)", COLORS["button"][0], finish="chrome")]
        leads = []
        for i, (col, lab) in enumerate((("brown", "actuator A"), ("blue", "actuator B"))):
            s, _ = D.lead((-AL / 2, -6.0 + 12.0 * i, AH / 2), (-1, 0.9, 0), 120.0, d=2.4)
            leads.append(K.body(s, f"{end} actuator lead {col} ({lab})", D.LEAD_HEX[col], finish="rubber"))
        cos = [K.body(led, f"{end} button LED (green)", COLORS["led"][0], finish="lens")] + leads
        t = K.text_solid("E-STOPP", 16.0, (-60.0, -tw / 2 - 0.1, AH / 2), plane="xz-", depth=0.12, style="bold")
        cos.append(K.body(t, f"{end} branding: 'E-STOPP' (redrawn from the photo, cosmetic)", "#c0282d", finish="print"))
        keep = [K.body(Pos(AL / 2 + v(P["travel"]) / 2 + 10.0, 0, AH / 2) * Box(v(P["travel"]) + 20.0, 30.0, 30.0),
                       "keep-out: cable travel (about 2 in) at the cable end", "#2e7d32", alpha=0.25)]
        return parts, keep, cos

    def _box_leads():
        return (BOX0[0] - v(P["box_l"]) / 2, BOX0[1], v(P["box_h"]) / 2)

    def attach_points():
        return [{"n": "control_box", "ep": end, "at": [round(c, 2) for c in _box_leads()], "dir": [-1, 0, 0], "kind": "flying leads",
                 "note": "control box leads E / F / G / H and the button harness plug (display position)"}]

    def terminals():
        at = _box_leads()
        rows = []
        for pin, nm, rx in (("G", "red +12 V", r"^G "), ("F", "blue ignition safety", r"^F "), ("H", "black ground", r"^H "),
                            ("E", "green switched ground (brake indicator)", r"^E "), ("BTN", "button harness (kit plug)", r"^button")):
            rows.append({"pin": pin, "endpoint": end, "name": f"{pin}: {nm}", "kind": "flying lead" if pin != "BTN" else "kit plug",
                         "match": rx, "at": at, "dir": (-1, 0, 0)})
        return rows

    def mount_points():
        tw = v(P["tube_w"])
        return [{"n": f"flange_{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}",
                 "at": [sx * v(P["flange_x"]), round(sy * (AW / 2 - ((AW - tw) / 2 + 4.0) / 2 + 1.0), 2), v(P["flange_t"])],
                 "dir": [0, 0, -1], "note": "slotted flange bolt to the frame rail"} for sx in (-1, 1) for sy in (-1, 1)]

    CHECKS = [("actuator length", lambda b: b[0].bounding_box().size.X, 381.0),
              ("actuator width over the flanges", lambda b: b[0].bounding_box().size.Y, 82.6, 0.2),
              ("actuator height", lambda b: b[0].bounding_box().size.Z, 50.8),
              ("control box length", lambda b: b[2].bounding_box().size.X, 133.4),
              ("control box height", lambda b: b[2].bounding_box().size.Z, 34.9)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ GM-pattern window lift motor
def window_lift_motor(pid, at, s, can_dir=(-1, 0, 0), C=None, name="window lift motor (ACI, GM pattern)"):
    """A GM-pattern window lift motor: gear housing (flat, on the regulator plate), the motor can off one side and the
    two-pole plug on the can's end. `at` = gear housing centre on the plate face (z = 0), s = size scale (1.0 = the assumed
    envelope below). Returns (bodies, plug_point)."""
    gx, gy, gt = 110.0 * s, 90.0 * s, 32.0 * s
    cd, cl = 44.0 * s, 52.0 * s
    housing = Pos(at[0], at[1], 0) * D.rbox(gx, gy, gt, r=14.0 * s)
    cx = at[0] + can_dir[0] * (gx / 2 + cl / 2 - 6.0 * s)
    can = D.cyl(cd, cl, at=(at[0] + can_dir[0] * (gx / 2 - 6.0 * s), at[1] - gy * 0.18, gt / 2), axis="-x" if can_dir[0] < 0 else "x")
    pz = gt / 2
    px = at[0] + can_dir[0] * (gx / 2 - 6.0 * s + cl)
    plug = Pos(px + can_dir[0] * 7.0 * s, at[1] - gy * 0.18, pz) * Box(14.0 * s, 20.0 * s, 12.0 * s)
    col = C or {"gear": "#c3c6c9", "can": "#1f2021", "plug": "#e0d7b8"}
    bodies = [K.body(housing, f"{pid} {name}: gear housing", col["gear"], finish="cast"),
              K.body(can, f"{pid} {name}: motor can", col["can"]),
              K.body(plug, f"{pid} {name}: two-pole plug", col["plug"])]
    return bodies, (px + can_dir[0] * 14.0 * s, at[1] - gy * 0.18, pz)


NR2 = "reference_documents/web_snapshots/www.nu-relics.com__17383-2.md (Nu-Relics 17383-2 page, fetched 2026-09-28)"
NR1 = "reference_documents/web_snapshots/www.nu-relics.com__17383-1.md (Nu-Relics 17383-1 page, fetched 2026-09-28)"
NRGI = "reference_documents/component_drawings/Nu-Relics_General_Instructions_12-30-14.pdf"
NR2_PHURL = "https://cdn4.volusion.store/aport-qgqvw/v/vspfiles/photos/17383-2-2.jpg (Nu-Relics, fetched 2026-09-29)"
NR1_PHURL = "https://cdn4.volusion.store/aport-qgqvw/v/vspfiles/photos/17383-1-2.jpg (Nu-Relics, fetched 2026-09-29)"
SCALE_NOTE = ("Nu-Relics publishes no size for the regulator or the ACI motor (its pages and instructions give none): the "
              "proportions are the Nu-Relics photo's, the overall scale is assumed")


def nu_relics_door(end):
    """Nu-Relics 17383-2 front door power window regulator with its ACI motor; left (DS) drawn, right (PS) mirrored."""
    left = end.endswith("DS")
    ASM = f"{SCALE_NOTE} (overall height 460)"
    P = {
        "height": Dim(460.0, ASM, "assumed", "regulator, top of the plate to the motor's bottom", "fit-critical, scaled"),
        "plate_w": Dim(98.0, ASM, "assumed", "main plate"), "plate_h": Dim(412.0, ASM, "assumed"), "plate_t": Dim(3.0, ASM, "assumed"),
        "lift_arm": Dim(380.0, ASM, "assumed", "lift arm, pivot to roller"), "eq_arm": Dim(310.0, ASM, "assumed", "equalizer arm"),
        "arm_w": Dim(18.0, ASM, "assumed"), "roller_d": Dim(15.0, ASM, "assumed"),
        "sector_r": Dim(95.0, ASM, "assumed", "sector gear radius"),
        "motor_scale": Dim(1.0, ASM, "assumed", "ACI motor drawn at the GM-pattern envelope (110 x 90 gear housing, Ø44 can)"),
        "current": Dim(20.0, f"{NR2}: ACI motor '3 A no load / 5 A low / 11 A high / 20 A stall' (registry; not a size)"),
    }
    COLORS = {"steel": ("#1d1e20", f"Nu-Relics photo {NR2_PHURL} (regulator plate and arms, black)"),
              "gear": ("#c3c6c9", f"Nu-Relics photo {NR2_PHURL} (motor gear housing, silver)"),
              "can": ("#1f2021", f"Nu-Relics photo {NR2_PHURL} (motor can, black)"),
              "plug": ("#e0d7b8", "motor plug: natural (not in the photo)"),
              "roller": ("#eeeeee", f"Nu-Relics photo {NR2_PHURL} (rollers, white nylon)"),
              "label": ("#f4d000", f"Nu-Relics photo {NR2_PHURL} (yellow label)")}
    wires = ("WIN_MOT_L_A", "WIN_MOT_L_B") if left else ("WIN_MOT_R_A", "WIN_MOT_R_B")
    PART = {
        "pid": end, "endpoints": [end], "maker": "Nu-Relics (ACI motor)", "pn": "17383-2 (regulator + ACI motor)",
        "title": f"Nu-Relics 17383-2 power window regulator and ACI motor ({'driver' if left else 'passenger'} door)",
        "what": f"{'Driver' if left else 'Passenger'} window motor and regulator, Nu-Relics 17383-2 (1973-91 Blazer/Jimmy front doors), "
                "ACI reverse-polarity motor",
        "shape_basis": "not sourced", "viewset": "wall",
        "dims_mm": {"l": 510.0, "w": 60.0, "h": 460.0},
        "dims_note": "Nu-Relics publishes no size: drawn from its photo's proportions at an assumed 460 overall height (±60)",
        "margin": {"mm": 60.0, "why": "no published dimension for the regulator or the motor; proportions from the maker's photo, "
                                     "scale assumed; measure the kit on arrival"},
        "frame": "origin at the centre of the main plate's face on the door inner panel; +Z toward the glass, +Y up, +X toward "
                 "the door's front" + ("" if left else " (mirrored from the left-hand part)"),
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"arms": "+X", "motor": "-Y"}},
        "photo": {"url": "https://cdn4.volusion.store/aport-qgqvw/v/vspfiles/photos/17383-2-2.jpg",
                  "page": "https://www.nu-relics.com/17383-2", "fetched": "2026-09-29"},
        "photo_short": "Nu-Relics photo 17383-2",
        "branding": ["yellow '73-87 Chevy Trk' label"],
        "dims_draw": [("front", "y", "height", -10)],
        "refs": [("[1]", "nu-relics.com__17383-2", "Nu-Relics 17383-2 page (kit contents, ACI motor, reverse polarity)"),
                 ("[2]", "Nu-Relics publishes no size", "no published size: the photo's proportions at an assumed scale")],
        "drawing_notes": [
            (f"Two-pole reverse-polarity motor (not grounded through the case): {wires[0]} / {wires[1]}; which pole is UP is set "
             "at the bench (registry).", "#10151a"),
            ("Every size on this sheet is assumed (red): Nu-Relics publishes none. Measure the regulator before any bracket.", "assumed"),
        ],
        "unknowns": ["Every dimension: Nu-Relics publishes no size for the regulator or motor. Measure on arrival.",
                     "Mounting bolt pattern: 'the mounting bolts (3,4,5, or 6)' into the factory holes (Nu-Relics instructions)."],
    }
    v = K.v
    s = v(P["height"]) / 460.0

    def build():
        pw, ph, pt = v(P["plate_w"]), v(P["plate_h"]), v(P["plate_t"])
        plate = Pos(0, 193.0 * s - ph / 2, 0) * D.rbox(pw, ph, pt, r=10.0)
        plate += Pos(0, 193.0 * s - 40.0, 0) * D.rbox(136.0 * s, 80.0 * s, pt, r=8.0)
        sr = v(P["sector_r"])
        sector = Pos(-20.0 * s, -150.0 * s, pt) * (D.cyl(2 * sr, pt) & Pos(-sr, -sr, 0) * Box(sr, sr * 1.2, 10, align=D.BASE))
        piv = (0.0, 95.0 * s, pt * 2)
        arm_l, eq_l, aw = v(P["lift_arm"]), v(P["eq_arm"]), v(P["arm_w"])
        a1 = math.degrees(math.atan2(170.0 - 270.0, 180.0 - 690.0))
        lift = Pos(*piv) * Box(arm_l, aw, pt, align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN)).rotate(Axis.Z, 180.0 + 11.0)
        mid = (piv[0] - arm_l / 2 * math.cos(math.radians(11.0)), piv[1] + arm_l / 2 * math.sin(math.radians(11.0)) * -1.0, pt * 3)
        eq = Pos(*mid) * Box(eq_l, aw, pt, align=D.CEN).rotate(Axis.Z, -32.0)
        rollers = []
        tip = (piv[0] - arm_l * math.cos(math.radians(11.0)), piv[1] - arm_l * math.sin(math.radians(11.0)), pt * 2)
        rollers.append(D.cyl(v(P["roller_d"]), 10.0, at=tip))
        for sgn in (-1, 1):
            e = (mid[0] + sgn * eq_l / 2 * math.cos(math.radians(-32.0)), mid[1] + sgn * eq_l / 2 * math.sin(math.radians(-32.0)), pt * 3)
            rollers.append(D.cyl(v(P["roller_d"]), 10.0, at=e))
        spring = D.cyl(40.0 * s, 8.0, at=piv)
        motor, plug_at = window_lift_motor(end, (-50.0 * s, -222.0 * s), v(P["motor_scale"]) * s, C={k: COLORS[k][0] for k in ("gear", "can", "plug")})
        bodies = [K.body(plate + sector, f"{end} regulator plate and sector gear", COLORS["steel"][0], finish="paint"),
                  K.body(lift + eq, f"{end} lift and equalizer arms", COLORS["steel"][0], finish="paint"),
                  K.body(spring, f"{end} counterbalance spring", COLORS["steel"][0], finish="metal"),
                  K.body(Compound(children=rollers).fuse(), f"{end} rollers", COLORS["roller"][0])] + motor
        if not left:
            bodies = mirror_x(bodies)
        return bodies, [], []

    def _plug():
        motor_at = (-50.0 * s, -222.0 * s)
        gx, gy, gt = 110.0 * s, 90.0 * s, 32.0 * s
        x = motor_at[0] - (gx / 2 - 6.0 * s + 52.0 * s) - 14.0 * s
        p = (x, motor_at[1] - gy * 0.18, gt / 2)
        return p if left else (-p[0], p[1], p[2])

    def attach_points():
        p = _plug()
        return [{"n": "motor_plug", "ep": end, "at": [round(c, 2) for c in p], "dir": [-1 if left else 1, 0, 0], "kind": "kit plug",
                 "note": "two-pole motor plug (kit terminals + seals)"}]

    def terminals():
        p = _plug()
        d = (-1 if left else 1, 0, 0)
        return [{"pin": "1", "endpoint": end, "name": "motor pole 1 (A)", "kind": "kit terminal", "match": r"pole 1", "at": p, "dir": d},
                {"pin": "2", "endpoint": end, "name": "motor pole 2 (B)", "kind": "kit terminal", "match": r"pole 2", "at": p, "dir": d}]

    def mount_points():
        return [{"n": "plate", "at": [0, 0, 0], "dir": [0, 0, -1], "note": "3-6 bolts into the factory regulator holes (Nu-Relics)"}]

    CHECKS = [("overall height (assumed)", lambda b: Compound(children=b).bounding_box().size.Y, 460.0, 25.0)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


def nu_relics_tailgate(end="TG-MOTOR-ACI"):
    """Nu-Relics 17383-1 tailgate window regulator (two sectors, gear-driven) with its ACI motor."""
    ASM = f"{SCALE_NOTE} (overall width 900 across the lift-arm rollers)"
    P = {
        "width": Dim(900.0, ASM, "assumed", "regulator, lift-arm roller to lift-arm roller", "fit-critical, scaled"),
        "plate_w": Dim(620.0, ASM, "assumed", "main plate"), "plate_h": Dim(150.0, ASM, "assumed"), "plate_t": Dim(3.0, ASM, "assumed"),
        "arm_l": Dim(384.0, ASM, "assumed", "each lift arm"), "arm_w": Dim(40.0, ASM, "assumed"),
        "sector_r": Dim(120.0, ASM, "assumed", "sector gears"), "roller_d": Dim(15.0, ASM, "assumed"),
        "opening": Dim(1657.0, "docs/wiring/receipts/2026-09-30_research-vehicle-geometry.md: Mitchell tailgate opening 1657 x 505 "
                              "(the tailgate's own width bounds the regulator)"),
        "current": Dim(20.0, f"{NR1}: ACI motor stall 20 A (registry; not a size)"),
    }
    COLORS = {"steel": ("#1d1e20", f"Nu-Relics photo {NR1_PHURL} (regulator, black)"),
              "gear": ("#c3c6c9", f"Nu-Relics photo {NR1_PHURL} (motor gear housing, silver)"),
              "can": ("#1f2021", f"Nu-Relics photo {NR1_PHURL} (motor can, black)"),
              "plug": ("#e0d7b8", "motor plug: natural (not in the photo)"),
              "roller": ("#eeeeee", f"Nu-Relics photo {NR1_PHURL} (rollers)")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "Nu-Relics (ACI motor)", "pn": "17383-1 (tailgate regulator + ACI motor)",
        "title": "Nu-Relics 17383-1 tailgate window regulator and ACI motor",
        "what": "Tailgate window motor and regulator, Nu-Relics 17383-1 (1973-91 Blazer/Jimmy/Suburban tailgate), ACI reverse-polarity "
                "motor (candidate)",
        "shape_basis": "not sourced", "viewset": "wall",
        "dims_mm": {"l": 900.0, "w": 50.0, "h": 470.0},
        "dims_note": "Nu-Relics publishes no size: its photo's proportions at an assumed 900 across the rollers (±100); the tailgate "
                     "opening is 1657 wide (Mitchell)",
        "margin": {"mm": 100.0, "why": "no published dimension; proportions from the maker's photo, scale assumed; measure on arrival"},
        "frame": "origin at the centre of the main plate's face on the tailgate inner panel; +Z toward the glass, +Y up, +X to the "
                 "right seen from behind the truck; the motor at +X",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"arms": "+Y", "motor": "+X"}},
        "photo": {"url": "https://cdn4.volusion.store/aport-qgqvw/v/vspfiles/photos/17383-1-2.jpg",
                  "page": "https://www.nu-relics.com/17383-1", "fetched": "2026-09-29"},
        "photo_short": "Nu-Relics photo 17383-1",
        "branding": [],
        "dims_draw": [("front", "x", "width", -10)],
        "refs": [("[1]", "nu-relics.com__17383-1", "Nu-Relics 17383-1 page (kit, ACI motor)"),
                 ("[2]", "Nu-Relics publishes no size", "no published size: the photo's proportions at an assumed scale"),
                 ("[3]", "vehicle-geometry", "the vehicle-geometry lane's Mitchell tailgate opening")],
        "drawing_notes": [("Candidate for the tailgate (the owner has no tailgate regulator or motor): two-pole ACI motor, TGR_MOT_A / "
                           "TGR_MOT_B; plug from the kit (option #100).", "#10151a"),
                          ("Every size here is assumed (red): Nu-Relics publishes none.", "assumed")],
        "unknowns": ["Every dimension: no published size. Measure on arrival.", "Motor plug and lead colours: read on arrival (registry)."],
    }
    v = K.v
    s = v(P["width"]) / 900.0

    def build():
        pw, ph, pt = v(P["plate_w"]), v(P["plate_h"]), v(P["plate_t"])
        plate = Pos(0, 0, 0) * D.rbox(pw, ph, pt, r=12.0)
        sr = v(P["sector_r"])
        sectors = []
        for sx in (-1, 1):
            sec = D.cyl(2 * sr, pt, at=(sx * 110.0 * s, -ph / 2 + 10.0, pt)) & Pos(sx * 110.0 * s, -ph / 2 - sr + 10.0, 0) * Box(2 * sr, sr, 20, align=D.BASE)
            sectors.append(sec)
        arms, rollers = [], []
        al, aw = v(P["arm_l"]), v(P["arm_w"])
        for sx, ang in ((-1, 150.0), (1, 30.0)):
            piv = (sx * 110.0 * s, -ph / 2 + 10.0, pt * 2)
            arm = Pos(*piv) * Box(al, aw, pt, align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN)).rotate(Axis.Z, ang)
            arms.append(arm)
            tip = (piv[0] + al * math.cos(math.radians(ang)), piv[1] + al * math.sin(math.radians(ang)), pt * 2)
            rollers.append(D.cyl(v(P["roller_d"]), 10.0, at=tip))
        motor, _ = window_lift_motor(end, (pw / 2 - 20.0 * s, -10.0 * s), 1.0 * s, can_dir=(1, 0, 0),
                                     C={k: COLORS[k][0] for k in ("gear", "can", "plug")})
        bodies = [K.body(plate + Compound(children=sectors).fuse(), f"{end} regulator plate and sector gears", COLORS["steel"][0], finish="paint"),
                  K.body(Compound(children=arms).fuse(), f"{end} lift arms", COLORS["steel"][0], finish="paint"),
                  K.body(Compound(children=rollers).fuse(), f"{end} rollers", COLORS["roller"][0])] + motor
        return bodies, [], []

    def _plug():
        pw = v(P["plate_w"])
        at = (pw / 2 - 20.0 * s, -10.0 * s)
        gx, gy, gt = 110.0 * s, 90.0 * s, 32.0 * s
        return (at[0] + gx / 2 - 6.0 * s + 52.0 * s + 14.0 * s, at[1] - gy * 0.18, gt / 2)

    def attach_points():
        return [{"n": "motor_plug", "ep": end, "at": [round(c, 2) for c in _plug()], "dir": [1, 0, 0], "kind": "kit plug",
                 "note": "two-pole ACI motor plug (kit option #100)"}]

    def terminals():
        p = _plug()
        return [{"pin": "A", "endpoint": end, "name": "motor pole A", "kind": "kit terminal", "match": r"^pole A", "at": p, "dir": (1, 0, 0)},
                {"pin": "B", "endpoint": end, "name": "motor pole B", "kind": "kit terminal", "match": r"^pole B", "at": p, "dir": (1, 0, 0)}]

    def mount_points():
        return [{"n": "plate", "at": [0, 0, 0], "dir": [0, 0, -1], "note": "bolts into the factory tailgate regulator holes"}]

    CHECKS = [("width across the rollers (assumed)", lambda b: b[2].bounding_box().size.X + v(P["roller_d"]), 900.0, 60.0)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


def gm_tailgate_motor(end="rear_window_motor"):
    """The factory electric tailgate window motor (GM, 1973-87 Blazer): the motor and drive on the factory regulator."""
    LT = "reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf p.151 (tailgate: 'Remove the regulator motor attaching screws')"
    BK = "1978 C/K wiring booklet ST-352-78 p.16 (tailgate window motor, connector 6288909: UP 1 / DN 2, grounds through the case; registry)"
    ASM = "no GM dimension on file for the factory tailgate window motor: drawn at the GM-pattern window lift motor envelope, assumed"
    P = {
        "scale": Dim(1.0, ASM, "assumed", "gear housing 110 x 90 x 32, can Ø44 x 52 (the envelope the ACI motor is drawn at)"),
        "bracket_w": Dim(150.0, ASM, "assumed", "mounting plate on the regulator"), "bracket_h": Dim(120.0, ASM, "assumed"),
    }
    COLORS = {"gear": ("#b8bbbe", "factory motor: cast housing, drawn aluminium (no photo on file)"),
              "can": ("#2a2b2c", "motor can: drawn black"), "plug": ("#2d2d2e", "GM connector 6288909: drawn black"),
              "plate": ("#3a3b3c", "mounting plate: drawn painted steel")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "GM (factory)", "pn": "factory tailgate window motor (connector 6288909)",
        "title": "Factory electric tailgate window motor (1973-87 Blazer)",
        "what": "Tailgate window motor, factory electric (base design; the Nu-Relics 17383-1 kit is the candidate replacement)",
        "shape_basis": "not sourced", "viewset": "wall",
        "dims_mm": {"l": 216.0, "w": 42.0, "h": 120.0},
        "dims_note": "no GM dimension on file: the GM-pattern window lift motor envelope, assumed (±40)",
        "margin": {"mm": 40.0, "why": "no drawing or listing of the factory tailgate motor on file; the owner has none to measure"},
        "frame": "origin at the centre of the motor's mounting plate on the tailgate regulator; +Z out of the plate, +Y up",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"plug": "-X"}},
        "photo": {},
        "photo_short": "",
        "branding": [],
        "refs": [("[1]", "1977_Light_Truck_Service_Manual", "1977 LTSM p.151 (tailgate motor removal)"),
                 ("[2]", "ST-352-78", "1978 C/K wiring booklet p.16 (connector 6288909)"),
                 ("[3]", "no GM dimension", "not in any source: assumed")],
        "drawing_notes": [("UP on pole 1 (TG_MOT_A), DOWN on pole 2 (TG_MOT_B); grounds through the case (1978 booklet).", "#10151a"),
                          ("Every size here is assumed (red). The owner has no tailgate regulator or motor to measure.", "assumed")],
        "unknowns": ["Every dimension: no factory drawing or part number on file (part_media: unknown).",
                     "Whether this base-design end is built at all: the Nu-Relics 17383-1 kit is the candidate (registry)."],
    }
    v = K.v

    def build():
        plate = D.rbox(v(P["bracket_w"]), v(P["bracket_h"]), 3.0, r=10.0)
        motor, _ = window_lift_motor(end, (0.0, 0.0), v(P["scale"]), C={k: COLORS[k][0] for k in ("gear", "can", "plug")},
                                     name="factory window motor")
        motor = [Pos(0, 0, 3.0) * m for m in motor]
        for m, src in zip(motor, window_lift_motor(end, (0.0, 0.0), v(P["scale"]), name="factory window motor")[0]):
            m.label, m.color = src.label, src.color
        return [K.body(plate, f"{end} mounting plate", COLORS["plate"][0], finish="paint")] + motor, [], []

    def _plug():
        s = v(P["scale"])
        return (-(110.0 * s / 2 - 6.0 * s + 52.0 * s) - 14.0 * s, -90.0 * s * 0.18, 3.0 + 16.0 * s)

    def attach_points():
        return [{"n": "motor_plug", "ep": end, "at": [round(c, 2) for c in _plug()], "dir": [-1, 0, 0], "kind": "GM connector 6288909",
                 "note": "UP 1 / DN 2 (1978 booklet)"}]

    def terminals():
        p = _plug()
        return [{"pin": "1", "endpoint": end, "name": "UP (pole 1)", "kind": "Packard 56 blade", "match": r"^1$", "at": p, "dir": (-1, 0, 0)},
                {"pin": "2", "endpoint": end, "name": "DOWN (pole 2)", "kind": "Packard 56 blade", "match": r"^2$", "at": p, "dir": (-1, 0, 0)}]

    def mount_points():
        return [{"n": "plate", "at": [0, 0, 0], "dir": [0, 0, -1], "note": "motor attaching screws into the regulator (LTSM p.151)"}]

    CHECKS = [("drawn at the assumed envelope", lambda b: v(P["scale"]), 1.0)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)
