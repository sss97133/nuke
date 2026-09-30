"""Engine-bay machines for the K5 device models: the alternator, the A/C compressor, the starter, the horn, the wiper
motor with its washer pump, the blower resistor and the power-step motor and controller.

Several of these are factory GM parts with no part number or drawing on file, or parts whose maker prints no size:
those are drawn at an assumed envelope (basis 'assumed', shape basis 'not sourced'), with the maker's or the manual's
figure giving the arrangement, and a margin that says so. Each function returns the part script's namespace.
Frames: origin at the centre of the mounting face, +Z out of it.
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


# ------------------------------------------------------------------------------------------ Holley 197-302 alternator
HMM = ("reference_documents/component_drawings/extracted/holley_midmount_dimensional.png (Holley Mid-Mount accessory drive "
       "dimension page, which lists the same 197-302 alternator)")
HMM_SC = f"scaled off {HMM} at its printed 255 (10 in)"
H185 = "reference_documents/component_drawings/Holley_20-185_Mid_Mount_Install_Guide.pdf p.2 (parts list: 197-302, pigtail 197-400; M10 x 80 / x 75 alternator bolts)"
TRUCK_ENG = "owner's photo of the engine bay, vehicle_images 40e5e5f9 (2026-01-31): the Holley alternator on the mid-mount"


def holley_197_302(end="ALTERNATOR-SENSE"):
    P = {
        "case_d": Dim(152.0, HMM_SC, "scaled", "alternator case"),
        "length": Dim(190.0, HMM_SC, "scaled", "pulley front to the rear cover"),
        "pulley_d": Dim(62.0, HMM_SC, "scaled", "6-rib pulley"), "pulley_l": Dim(28.0, HMM_SC, "scaled"),
        "ear_bolt_out": Dim(80.0, f"{H185}: 'Button Head Bolt, M10 x 1.5 x 80 - Alternator (outside)'"),
        "ear_bolt_in": Dim(75.0, f"{H185}: 'Socket Head Cap Bolt, M10 x 1.5 x 75 - Alternator (inside)'"),
        "ear_hole": Dim(10.5, f"{H185}: M10 bolts (clearance hole drawn 10.5)", "design"),
        "bplus_d": Dim(8.0, "the B+ stud size is not printed", "assumed", "drawn M8"),
        "plug_w": Dim(24.0, "the regulator plug body is not dimensioned", "assumed"),
    }
    COLORS = {"case": ("#c9ccce", f"{TRUCK_ENG} (natural aluminium case)"), "pulley": ("#2a2b2c", f"{TRUCK_ENG} (pulley, black)"),
              "plug": ("#1d1d1e", "regulator plug: black"), "stud": ("#b8a372", "B+ stud: drawn brass")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "Holley", "pn": "197-302 (pigtail 197-400)",
        "title": "Holley 197-302 alternator (Mid-Mount, LT1-style hairpin)",
        "what": "Alternator, Holley 197-302 LT1-style hairpin (natural), on the Holley mid-mount; sense plug via pigtail 197-400",
        "shape_basis": "maker drawing", "viewset": "wall",
        "dims_mm": {"l": 152.0, "w": 152.0, "h": 190.0},
        "dims_note": "case Ø152 x 190 with the pulley, scaled off Holley's mid-mount dimension page at its printed 255 (±8)",
        "margin": {"mm": 8.0, "why": "Holley prints the drive's positions, not the alternator's own size: case and length scaled off "
                                    "its drawing (±8); plug and B+ stud assumed"},
        "frame": "origin on the alternator's axis at the front mounting-ear face; +Z forward (the pulley), +Y up",
        "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"pulley": "+Z", "plug": "-Z"}},
        "photo": {"url": "vehicle_images 40e5e5f9 (owner's engine-bay photo)", "page": "Nuke vehicle e08bf694 images", "fetched": "2026-09-29"},
        "photo_short": "owner's engine-bay photo 40e5e5f9",
        "branding": [],
        "dims_draw": [("front", "x", "case_d", -10), ("right", "z", "length", -10)],
        "refs": [("[1]", "holley_midmount_dimensional", "Holley Mid-Mount dimension page (same 197-302 alternator)"),
                 ("[2]", "20-185_Mid_Mount", "Holley 20-185 LS mid-mount guide p.2 (parts and bolts)"),
                 ("[3]", "not printed", "assumed"), ("[4]", "clearance hole", "our choice")],
        "drawing_notes": [("ALT_L (L lead, 560 ohm in line) via the 197-400 pigtail and a MiniSeal splice; the B+ output cable lands "
                           "on the stud (the DC primary sheet, not this end).", "#10151a"),
                          ("It grounds through the timing cover (Holley: keep the mating faces bare).", "#10151a")],
        "unknowns": ["Case, length and pulley scaled off Holley's drive drawing (±8).",
                     "Plug position on the rear cover and the B+ stud size: read on the part (the registry opens the S lead)."],
    }
    v = K.v
    CD, L_ = v(P["case_d"]), v(P["length"])
    PL = v(P["pulley_l"])
    ZB = -(L_ - PL)                                  # rear cover

    def build():
        case = D.cyl(CD, -ZB, at=(0, 0, ZB))
        for i in range(16):
            case -= Pos(0, 0, ZB + 10.0) * Box(4.0, CD + 2, 30.0, align=(D.Align.CENTER, D.Align.CENTER, D.Align.MIN)).rotate(Axis.Z, 11.25 * i) & D.cyl(CD + 2, 40, at=(0, 0, ZB)) - D.cyl(CD - 10, 60, at=(0, 0, ZB - 5))
        ears = []
        for ang, zc, lg in ((20.0, -12.0, 24.0), (200.0, ZB + 30.0, 24.0)):
            e = Pos(0, 0, zc - lg / 2) * Box(30.0, 26.0, lg, align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN))
            e = Pos(CD / 2 - 6.0, 0, 0) * e
            e -= Pos(CD / 2 + 12.0, 0, zc - lg) * D.cyl(v(P["ear_hole"]), lg + 2)
            ears.append(e.rotate(Axis.Z, ang))
        pulley = D.cyl(v(P["pulley_d"]), PL, at=(0, 0, 0))
        for i in range(6):
            pulley -= D.cyl(v(P["pulley_d"]) + 2, 1.6, at=(0, 0, 4.0 + 3.56 * i)) - D.cyl(v(P["pulley_d"]) - 5, 3, at=(0, 0, 3.0 + 3.56 * i))
        stud = D.cyl(v(P["bplus_d"]), 18.0, at=(28.0, 20.0, ZB - 18.0))
        plug = Pos(-30.0, 30.0, ZB - 10.0) * Box(v(P["plug_w"]), 16.0, 20.0, align=D.BASE)
        parts = [K.body(case + Compound(children=ears).fuse(), f"{end} case and ears", COLORS["case"][0], finish="cast"),
                 K.body(pulley, f"{end} 6-rib pulley", COLORS["pulley"][0], finish="metal"),
                 K.body(stud, f"{end} B+ output stud", COLORS["stud"][0], finish="metal"),
                 K.body(plug, f"{end} regulator plug (197-400 pigtail)", COLORS["plug"][0])]
        keep = [K.body(Pos(-30.0, 30.0, ZB - 50.0) * Box(40.0, 30.0, 40.0, align=D.BASE), "keep-out: pigtail plug and lead behind the "
                       "rear cover (40 mm)", "#2e7d32", alpha=0.25)]
        return parts, keep, []

    def attach_points():
        return [{"n": "sense_plug", "ep": end, "at": [-30.0, 38.0, round(ZB - 10.0, 2)], "dir": [0, 0, -1], "kind": "pigtail plug",
                 "note": "197-400 pigtail: L lead (ALT_L)"}]

    def terminals():
        return [{"pin": "L", "endpoint": end, "name": "L (197-400 pigtail, 560 ohm in line)", "kind": "pigtail lead", "match": r"^L ",
                 "at": (-30.0, 38.0, ZB - 10.0), "dir": (0, 0, -1)},
                {"pin": "B+", "endpoint": end, "name": "B+ output stud (the DC primary cable; not this end's wire)", "kind": "stud",
                 "wires": [], "at": (28.0, 20.0, ZB - 18.0), "dir": (0, 0, -1)}]

    def mount_points():
        return [{"n": "ear_front", "at": [0, 0, 0], "dir": [0, 0, -1], "d": v(P["ear_hole"]), "note": "M10 x 80 (outside), Holley"},
                {"n": "ear_rear", "at": [0, 0, round(ZB + 30.0, 2)], "dir": [0, 0, -1], "d": v(P["ear_hole"]), "note": "M10 x 75 (inside)"}]

    CHECKS = [("case diameter", lambda b: v(P["case_d"]), 152.0),
              ("length with the pulley", lambda b: b[1].bounding_box().max.Z - b[0].bounding_box().min.Z, 190.0)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ Sanden SD7B10 (7176)
SAN = "reference_documents/component_drawings/Sanden_Compressors_ATC_Catalog.pdf (MEI 2017), table row 7176"
SAN_ROW = f"{SAN}: '7176 57176 NSS NSS 7B10 PB Top 3/4x7/8 Ear 112 PV6 12v T1 Key 100'"
SAN_PHURL = "https://i.ebayimg.com/images/g/sq8AAOSw1yNoG2vB/s-l1600.jpg (eBay listing photo of a Sanden 7176, fetched 2026-09-29)"
SAN_PH = f"sized off {SAN_PHURL} against the printed 112 mm pulley (perspective, ±12)"


def sanden_sd7b10(end="AC-CLUTCH"):
    P = {
        "pulley_d": Dim(112.0, f"{SAN_ROW} (112 mm pulley, PV6)"),
        "grooves": Dim(6, f"{SAN_ROW} ('PV6')"),
        "displacement": Dim(100.0, f"{SAN_ROW} (100 cc; not a size)"),
        "body_d": Dim(108.0, SAN_PH, "photo", "cylinder body"), "length": Dim(200.0, SAN_PH, "photo", "clutch face to the rear head"),
        "clutch_l": Dim(38.0, SAN_PH, "photo", "pulley and clutch"), "ear_w": Dim(26.0, SAN_PH, "photo", "mounting ears (Ear mount)"),
        "ear_hole": Dim(10.5, "the ear bolt size is not printed", "assumed"),
        "lead_l": Dim(250.0, "the T1 lead's length is not printed", "assumed"),
    }
    COLORS = {"body": ("#c2c5c7", f"eBay photo {SAN_PHURL} (cast aluminium body)"), "clutch": ("#2b2c2d", f"eBay photo {SAN_PHURL} "
              "(clutch plate, black)"), "pulley": ("#c9b98a", f"eBay photo {SAN_PHURL} (pulley, zinc-gold)")}
    PART = {
        "pid": end, "endpoints": [end], "maker": "Sanden", "pn": "7176 (SD7B10, ear mount, PV6 112 mm, T1)",
        "title": "Sanden 7176 SD7B10 A/C compressor",
        "what": "A/C compressor clutch, Sanden 7176 SD7B10: ear mount, PV6 112 mm pulley, 12 V, T1 single lead, 100 cc",
        "shape_basis": "scaled from photo", "viewset": "wall",
        "dims_mm": {"l": 150.0, "w": 150.0, "h": 200.0},
        "dims_note": "112 mm PV6 pulley (Sanden's catalogue); body Ø108 x 200 long and the ears sized off a listing photo (±12)",
        "margin": {"mm": 12.0, "why": "Sanden's catalogue prints the pulley and mount, not the body; the rest sized off a perspective "
                                     "listing photo"},
        "frame": "origin on the compressor's axis at the clutch face; +Z forward (out of the clutch), +Y up (the ears), body behind",
        "axes": {"mount_normal": "+Y", "maker_up": "+Y", "faces": {"clutch": "+Z", "ears": "+Y"}},
        "photo": {"url": "https://i.ebayimg.com/images/g/sq8AAOSw1yNoG2vB/s-l1600.jpg", "page": "eBay listing (part_media AC-CLUTCH)",
                  "fetched": "2026-09-29"},
        "photo_short": "eBay listing photo, Sanden 7176",
        "branding": [],
        "dims_draw": [("front", "x", "pulley_d", -10), ("right", "z", "length", -10)],
        "refs": [("[1]", "Sanden_Compressors_ATC_Catalog", "Sanden (MEI) catalogue, row 7176"),
                 ("[2]", "sized off", "sized off the listing photo against the printed 112"), ("[3]", "not printed", "assumed")],
        "drawing_notes": [("T1: one clutch lead (#23 from PDM15 OUT11), no suppression diode; the coil returns through the body.", "#10151a")],
        "unknowns": ["Body and ears sized off a photo (±12): Sanden prints no envelope for the SD7B10 in the documents on file.",
                     "The Holley mid-mount lists its own SD7 (199-102); the registry's is the Sanden 7176: confirm which is on the truck."],
    }
    v = K.v
    BD, L_, CL = v(P["body_d"]), v(P["length"]), v(P["clutch_l"])

    def build():
        body = D.cyl(BD, L_ - CL, at=(0, 0, -(L_ - CL)))
        head = D.cyl(BD - 6, 40.0, at=(0, 0, -L_))
        ears = []
        for zc in (-(L_ - CL) + 35.0, -45.0):
            e = Pos(0, BD / 2 + 8.0, zc) * Box(v(P["ear_w"]), 28.0, 20.0)
            e -= D.cyl(v(P["ear_hole"]), 40, at=(-20.0, BD / 2 + 12.0, zc), axis="x")
            ears.append(e)
        fittings = [D.cyl(22.0, 18.0, at=(sx * 22.0, BD / 2 - 4.0, -L_ + 20.0), axis="y") for sx in (-1, 1)]
        pulley = D.cyl(v(P["pulley_d"]), CL * 0.7, at=(0, 0, 0.0 - CL * 0.7 - 2.0))
        for i in range(int(v(P["grooves"]))):
            pulley -= D.cyl(v(P["pulley_d"]) + 2, 1.8, at=(0, 0, -CL * 0.7 + 2.0 + 3.6 * i)) - D.cyl(v(P["pulley_d"]) - 5, 3, at=(0, 0, -CL * 0.7 + 1.0 + 3.6 * i))
        clutch = D.cyl(v(P["pulley_d"]) - 18.0, 8.0, at=(0, 0, -8.0))
        parts = [K.body(body + head + Compound(children=ears).fuse() + Compound(children=fittings).fuse(), f"{end} compressor body, "
                        "ears and head (PB)", COLORS["body"][0], finish="cast"),
                 K.body(pulley, f"{end} clutch pulley (PV6, 112)", COLORS["pulley"][0], finish="metal"),
                 K.body(clutch, f"{end} clutch plate", COLORS["clutch"][0], finish="metal")]
        lead, _ = D.lead((0, BD / 2 - 5.0, -CL - 10.0), (0.3, 1, -0.4), v(P["lead_l"]) * 0.4, d=2.4)
        return parts, [], [K.body(lead, f"{end} T1 clutch lead (black)", D.LEAD_HEX["black"], finish="rubber")]

    def attach_points():
        return [{"n": "t1", "ep": end, "at": [0, round(BD / 2 - 5.0, 2), round(-CL - 10.0, 2)], "dir": [0, 1, 0], "kind": "flying lead",
                 "note": "T1 single lead, male bullet (clutch coil +)"}]

    def terminals():
        return [{"pin": "T1", "endpoint": end, "name": "T1 clutch lead (male bullet)", "kind": "flying lead", "match": r"^T1",
                 "at": (0, BD / 2 - 5.0, -CL - 10.0), "dir": (0, 1, 0), "free": (0.3 * 100, BD / 2 + 95.0, -CL - 50.0)}]

    def mount_points():
        return [{"n": f"ear_{i}", "at": [0, round(BD / 2 + 12.0, 2), round(zc, 2)], "dir": [1, 0, 0], "d": v(P["ear_hole"]),
                 "note": "ear bolt through the bracket"} for i, zc in enumerate((-(L_ - CL) + 35.0, -45.0))]

    CHECKS = [("pulley diameter", lambda b: b[1].bounding_box().size.X, 112.0, 0.1)]
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


# ------------------------------------------------------------------------------------------ factory and unpicked parts
def _assumed_part(end, title, what, maker, pn, dims_mm, dims_note, margin, frame, refs, notes, unknowns, P, COLORS, build,
                  attach_points, terminals, mount_points, CHECKS, photo=None, axes=None):
    PART = {"pid": end, "endpoints": [end], "maker": maker, "pn": pn, "title": title, "what": what,
            "shape_basis": "not sourced", "viewset": "wall", "dims_mm": dims_mm, "dims_note": dims_note,
            "margin": margin, "frame": frame, "axes": axes or {"mount_normal": "+Z", "maker_up": "+Y", "faces": {}},
            "photo": photo or {}, "photo_short": "", "branding": [], "refs": refs, "drawing_notes": notes, "unknowns": unknowns}
    return _namespace(P, COLORS, PART, build, attach_points, terminals, mount_points, CHECKS)


LTSM = "reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf"
RA = "https://www.rockauto.com"


def gm_starter(end="STARTER-S"):
    A = "the starter is not picked or its number is not recorded (layout-ui TODO; registry): a GM LS gear-reduction starter envelope, assumed"
    P = {"motor_d": Dim(88.0, A, "assumed", "motor can"), "length": Dim(220.0, A, "assumed", "nose to the motor's end"),
         "sol_d": Dim(52.0, A, "assumed", "solenoid on top"), "sol_l": Dim(95.0, A, "assumed"),
         "flange_w": Dim(115.0, A, "assumed", "mounting flange, two bolts"), "bolt_pitch": Dim(95.0, A, "assumed", "", "fit-critical, scaled"),
         "s_stud": Dim(5.0, "registry: 'S-terminal stud size: read off the starter (bench)'", "assumed", "drawn #10"),
         "b_stud": Dim(8.0, A, "assumed", "B+ stud")}
    C = {"body": ("#4a4c4e", "not in any photo: drawn dark grey"), "sol": ("#b9bcbf", "solenoid: drawn zinc"),
         "stud": ("#b8a372", "studs: drawn brass")}
    v = K.v

    def build():
        md, L_ = v(P["motor_d"]), v(P["length"])
        flange = D.rbox(v(P["flange_w"]), 60.0, 14.0, r=10.0)
        for sx in (-1, 1):
            flange -= D.cyl(11.0, 20, at=(sx * v(P["bolt_pitch"]) / 2, 0, -1))
        nose = D.cyl(62.0, 40.0, at=(0, -10.0, 14.0 - 60.0))
        motor = D.cyl(md, L_ - 60.0, at=(0, -10.0, 14.0))
        sol = D.cyl(v(P["sol_d"]), v(P["sol_l"]), at=(0, -10.0 + md / 2 + v(P["sol_d"]) / 2 - 6.0, 14.0))
        s_st = D.cyl(v(P["s_stud"]), 12.0, at=(-14.0, -10.0 + md / 2 + v(P["sol_d"]) / 2 - 6.0, 14.0 + v(P["sol_l"])))
        b_st = D.cyl(v(P["b_stud"]), 16.0, at=(14.0, -10.0 + md / 2 + v(P["sol_d"]) / 2 - 6.0, 14.0 + v(P["sol_l"])))
        parts = [K.body(flange + nose + motor, f"{end} starter body (drive end, motor)", C["body"][0], finish="cast"),
                 K.body(sol, f"{end} solenoid", C["sol"][0], finish="metal"),
                 K.body(s_st, f"{end} S (trigger) terminal", C["stud"][0], finish="metal"),
                 K.body(b_st, f"{end} B+ stud (2 AWG cranking cable #6)", C["stud"][0], finish="metal")]
        return parts, [], []

    def _s():
        md = v(P["motor_d"])
        return (-14.0, -10.0 + md / 2 + v(P["sol_d"]) / 2 - 6.0, 14.0 + v(P["sol_l"]) + 12.0)

    def attach_points():
        return [{"n": "S", "ep": end, "at": [round(c, 2) for c in _s()], "dir": [0, 0, 1], "kind": "stud", "note": "S trigger terminal (START_TRIG ring)"}]

    def terminals():
        return [{"pin": "S", "endpoint": end, "name": "S trigger terminal", "kind": "ring on a stud", "match": r"^ring", "at": _s(), "dir": (0, 0, 1)}]

    def mount_points():
        return [{"n": f"bolt_{s}", "at": [sx * v(P["bolt_pitch"]) / 2, 0, 0], "dir": [0, 0, -1], "note": "starter bolt into the block"}
                for s, sx in (("L", -1), ("R", 1))]

    return _assumed_part(end, "Starter (LS gear-reduction, not picked)", "Starter motor: S (trigger) terminal here; its B+ stud takes the "
                         "2 AWG cranking cable #6", "GM (not picked)", "not recorded", {"l": 115.0, "w": 88.0, "h": 220.0},
                         "not picked: a GM LS gear-reduction starter envelope, assumed (±40)",
                         {"mm": 40.0, "why": "the starter is not picked; every size assumed"},
                         "origin at the centre of the mounting flange on the block; +Z along the starter away from the flywheel, +Y up",
                         [("[1]", "not picked", "not in any source: assumed"), ("[2]", "registry", "registry open item")],
                         [("Every size is assumed (red): the starter is not picked. START_TRIG on S; cable #6 on B+.", "assumed")],
                         ["The starter: part not picked (registry). Every dimension assumed; the S stud size read at the bench."],
                         P, C, build, attach_points, terminals, mount_points, [("drawn at the assumed envelope", lambda b: 1.0, 1.0)])


def gm_horn(end="HORN"):
    BK = "1978 C/K wiring booklet p.13 (registry): factory horn, one terminal in connector 12004267, grounds through its bracket"
    PH = "SMP HN16 photo (RockAuto)"
    A = ("no horn part number in the registry and no size in any source: drawn as the SMP HN16 low-tone snail horn that "
         f"RockAuto lists for the 1977 K5 (proportions off {PH}), size assumed")
    P = {"d": Dim(85.0, A, "assumed", "diaphragm housing"), "depth": Dim(28.0, A, "assumed", "diaphragm housing"),
         "snail_w": Dim(80.0, A, "assumed", "snail cover in front"), "snail_d": Dim(40.0, A, "assumed"),
         "bracket_l": Dim(60.0, A, "assumed", "mounting bracket"), "blade_w": Dim(6.35, f"{BK} (a Packard 56 blade, family gm_blade)", "vendor")}
    C = {"body": ("#2d2925", f"{PH}: black horn (k-means)"), "bracket": ("#5b594e", f"{PH}: gold-zinc bracket (k-means)"),
         "blade": ("#c7c2b4", "blade: drawn tin")}
    v = K.v

    def build():
        bracket = D.rbox(20.0, v(P["bracket_l"]), 3.0, r=4.0) - D.cyl(8.5, 10, at=(0, v(P["bracket_l"]) / 2 - 10.0, -1))
        cy = -v(P["bracket_l"]) / 2 - v(P["d"]) / 2 + 10.0
        body = D.cyl(v(P["d"]), v(P["depth"]), at=(0, cy, 3.0))
        sw = v(P["snail_w"])
        snail = Pos(sw * 0.12, cy - sw * 0.08, 3.0 + v(P["depth"])) * D.rbox(sw, sw, v(P["snail_d"]), r=sw * 0.3, r_top=8.0)
        bell = body + snail
        blade = D.blade((v(P["d"]) / 2 - 6.0, cy, 3.0 + 10.0), axis="x", w=v(P["blade_w"]), l=8.0)
        return [K.body(bracket, f"{end} mounting bracket (ground path)", C["bracket"][0], finish="metal"),
                K.body(bell, f"{end} horn body and snail cover", C["body"][0]), K.body(blade, f"{end} terminal blade", C["blade"][0], finish="metal")], [], []

    def _t():
        return (v(P["d"]) / 2 - 6.0 + 8.0, -v(P["bracket_l"]) / 2 - v(P["d"]) / 2 + 10.0, 13.0)

    def attach_points():
        return [{"n": "terminal", "ep": end, "at": [round(c, 2) for c in _t()], "dir": [1, 0, 0], "kind": "blade", "note": "#48 (connector 12004267)"}]

    def terminals():
        return [{"pin": "1", "endpoint": end, "name": "horn terminal", "kind": "Packard 56 blade", "match": r"^horn terminal", "at": _t(), "dir": (1, 0, 0)},
                {"pin": "GND", "endpoint": end, "name": "ground through the bracket (HORN_GND ring under the mount bolt)", "kind": "ring",
                 "wires": ["HORN_GND"], "at": (0, v(P["bracket_l"]) / 2 - 10.0, 0), "dir": (0, 0, -1)}]

    def mount_points():
        return [{"n": "bracket", "at": [0, round(v(P["bracket_l"]) / 2 - 10.0, 2), 3.0], "dir": [0, 0, -1], "d": 8.5,
                 "note": "bolt to the radiator support (grounds through it)"}]

    ns = _assumed_part(end, "Horn (factory location on the radiator support; drawn as SMP HN16)", "Horn, factory, one terminal (connector "
                       "12004267), grounds through its bracket; the registry names no horn, so SMP's HN16 low-tone snail is drawn",
                       "GM (factory)", "unknown (registry names none; drawn as SMP HN16)",
                       {"l": round(v(P["d"]) / 2 + v(P["snail_w"]) * 0.62, 1), "w": round(v(P["bracket_l"]) + v(P["d"]) - 10.0, 1),
                        "h": round(3.0 + v(P["depth"]) + v(P["snail_d"]), 1)},
                       "no horn named and no size on file: SMP HN16's proportions at an assumed size (±25)",
                       {"mm": 25.0, "why": "the registry names no horn; no dimension on file"},
                       "origin at the centre of the bracket's face on the radiator support; +Z out of the support, +Y up",
                       [("[1]", "1978 C/K wiring booklet", "1978 booklet p.13 via the registry"),
                        ("[2]", "SMP HN16", "RockAuto 1977 K5 Blazer horn listing: SMP HN15 / HN16 (high / low tone, 2 terminals), "
                                            "ACDelco E1905E, Wells 1H1001; LMC 36-2150 / 36-2152 standard horns"),
                        ("[3]", "no size", "no dimension on file: assumed")],
                       [("#48 on the terminal; HORN_GND needs a ring under the mount bolt (registry open).", "#10151a"),
                        ("Every size is assumed (red).", "assumed")],
                       ["Which horn is on the truck (the registry names none), and every dimension."],
                       P, C, build, attach_points, terminals, mount_points, [("drawn at the assumed envelope", lambda b: 1.0, 1.0)],
                       photo={"url": f"{RA}/info/154/HN-16_Front.jpg", "page": f"{RA}/en/moreinfo.php?pk=319740", "fetched": "2026-09-29"})
    ns["PART"]["photo_short"] = PH
    return ns


def gm_wiper(end="WIPER-MOTOR"):
    F816 = f"{LTSM} p.803, Fig. 8-16 'Washer Mechanism Mounting on Wiper' and Fig. 8-17 (arrangement only; no dimension printed)"
    A = f"no dimension printed ({F816}); the GM round 2-speed wiper motor with its washer pump, envelope assumed"
    P = {"gear_w": Dim(130.0, A, "assumed", "gear box"), "gear_h": Dim(105.0, A, "assumed"), "gear_t": Dim(45.0, A, "assumed"),
         "can_d": Dim(85.0, A, "assumed", "motor can"), "can_l": Dim(75.0, A, "assumed"),
         "pump_w": Dim(70.0, A, "assumed", "washer pump on the gear box cover"), "pump_h": Dim(60.0, A, "assumed"), "pump_t": Dim(40.0, A, "assumed"),
         "shaft_d": Dim(14.0, A, "assumed", "crank shaft through the cowl"), "flange_bolts": Dim(3, A, "assumed", "mounting bolts to the cowl")}
    C = {"gear": ("#b7babd", f"{F816}: cast gear box, drawn aluminium"), "can": ("#2b2c2d", "motor can: drawn black"),
         "pump": ("#e8e3d6", f"{F816}: washer pump housing, drawn natural nylon"), "board": ("#6b4a2b", "terminal board: drawn phenolic brown")}
    v = K.v

    def build():
        gw, gh, gt = v(P["gear_w"]), v(P["gear_h"]), v(P["gear_t"])
        gear = D.rbox(gw, gh, gt, r=18.0)
        for i in range(3):
            a = math.radians(90 + 120 * i)
            gear += Pos(0.62 * gw * math.cos(a), 0.62 * gh * math.sin(a), 0) * D.rbox(22.0, 22.0, 6.0, r=10.0)
        can = D.cyl(v(P["can_d"]), v(P["can_l"]), at=(-gw * 0.1, gh / 2 + v(P["can_d"]) / 2 - 20.0, 5.0))
        shaft = D.cyl(v(P["shaft_d"]), 30.0, at=(gw * 0.15, 0, -30.0))
        pump = Pos(-gw * 0.1, -gh * 0.1, gt) * D.rbox(v(P["pump_w"]), v(P["pump_h"]), v(P["pump_t"]), r=8.0)
        board = Pos(gw / 2 - 12.0, gh * 0.15, gt - 12.0) * Box(18.0, 30.0, 14.0)
        return [K.body(gear, "WIPER-MOTOR gear box (park switch inside)", C["gear"][0], finish="cast"),
                K.body(can, "WIPER-MOTOR 2-speed motor can", C["can"][0], finish="paint"),
                K.body(shaft, "WIPER-MOTOR crank shaft (through the cowl)", C["gear"][0], finish="metal"),
                K.body(pump, "WASHER-PUMP washer pump on the gear box (driven by the wiper gear)", C["pump"][0]),
                K.body(board, "WIPER-MOTOR terminal board 1 / 2 / 3", C["board"][0])], [], []

    def _pts():
        gw, gh, gt = v(P["gear_w"]), v(P["gear_h"]), v(P["gear_t"])
        return {"board": (gw / 2 - 3.0, gh * 0.15, gt - 12.0), "sol": (-gw * 0.1 + v(P["pump_w"]) / 2, -gh * 0.1, gt + v(P["pump_t"]) / 2),
                "strap": (-gw / 2, -gh / 2 + 10.0, gt / 2)}

    def attach_points():
        p = _pts()
        return [{"n": "motor", "ep": "WIPER-MOTOR", "at": [round(c, 2) for c in p["board"]], "dir": [1, 0, 0], "kind": "terminal board",
                 "note": "terminals 1 / 2 (centre feed) / 3"},
                {"n": "washer", "ep": "WASHER-PUMP", "at": [round(c, 2) for c in p["sol"]], "dir": [1, 0, 0], "kind": "2-way plug",
                 "note": "washer solenoid (93B feed, 94 switch side)"}]

    def terminals():
        p = _pts()
        rows = [{"pin": t, "endpoint": "WIPER-MOTOR", "name": f"terminal {t}", "kind": "blade", "match": rx, "at": p["board"], "dir": (1, 0, 0)}
                for t, rx in (("1", r"^terminal 1"), ("2", r"^terminal 2"), ("3", r"^terminal 3"))]
        rows.append({"pin": "GND", "endpoint": "WIPER-MOTOR", "name": "ground strap", "kind": "strap", "match": r"^ground strap",
                     "at": p["strap"], "dir": (-1, 0, 0)})
        rows += [{"pin": pn, "endpoint": "WASHER-PUMP", "name": nm, "kind": "2-way plug", "match": rx, "at": p["sol"], "dir": (1, 0, 0)}
                 for pn, nm, rx in (("93B", "solenoid feed side", r"^93B"), ("94", "solenoid switch side", r"^94"))]
        return rows

    def mount_points():
        gw, gh = v(P["gear_w"]), v(P["gear_h"])
        return [{"n": f"bolt_{i}", "at": [round(0.62 * gw * math.cos(math.radians(90 + 120 * i)), 2),
                                          round(0.62 * gh * math.sin(math.radians(90 + 120 * i)), 2), 0], "dir": [0, 0, -1],
                 "note": "gear box to the cowl"} for i in range(3)]

    ns = _assumed_part(end, "Factory 2-speed wiper motor with washer pump (1977 C/K)", "Wiper motor (factory 1977 C/K 2-speed, compound "
                       "wound, park switch, terminal board 1 / 2 / 3, ground strap) with the factory washer pump on its gear box",
                       "GM (factory)", "unknown (factory; no part number recorded)", {"l": 130.0, "w": 85.0, "h": 190.0},
                       "no dimension printed (1977 LTSM Figs. 8-16 / 8-17 show the arrangement only): envelope assumed (±25)",
                       {"mm": 25.0, "why": "factory part with no number or drawing on file"},
                       "origin at the centre of the gear box's face on the cowl (engine side); +Z out of the cowl into the engine bay, +Y up",
                       [("[1]", "p.803, Fig. 8-16", "1977 LTSM p.803 Figs. 8-16, 8-17 (arrangement)"), ("[2]", "no dimension printed", "assumed")],
                       [("Terminal 2 (centre) = feed #49; 1 = WIPER_T1; 3 = WIPER_T3; ground strap WIPER_GND (registry).", "#10151a"),
                        ("Washer pump solenoid: #50 on 93B, WASH_GND on 94 (its own 2-way plug, registry).", "#10151a"),
                        ("Every size is assumed (red): read the motor on the truck.", "assumed")],
                       ["Every dimension: factory part with no number or drawing on file (layout-ui TODO)."],
                       P, C, build, attach_points, terminals, mount_points, [("drawn at the assumed envelope", lambda b: 1.0, 1.0)])
    ns["PART"]["endpoints"] = ["WIPER-MOTOR", "WASHER-PUMP"]
    return ns



def gm_blower_resistor(end="BLOWER-RES"):
    """GM 336403 A/C blower resistor (A/C without the heavy-duty heater: Four Seasons 20083, SMP RU67, Wells 3A1044, UMP
    BMR11, Holstein 2BMR0020 on RockAuto's 1977 K5 listing; LMC 32-2406), drawn off Four Seasons' 20083 photo at an
    assumed size: a black diamond plate with two holes and four blades, the steel strips and coils inside the case."""
    BK = "1978 C/K wiring booklet p.16 sheet A-4 (registry): C60 blower resistor, four terminals BAT / M1 / M2 / BLO"
    PH = "Four Seasons 20083 photo (RockAuto)"
    A = f"no size in any source: assumed; proportions off {PH}"
    P = {"hole_pitch": Dim(70.0, A, "assumed", "the plate's two mounting holes", "fit-critical"),
         "plate_l": Dim(84.0, A, "assumed", "diamond plate, tip to tip"), "plate_w": Dim(46.0, A, "assumed", "at its widest"),
         "plate_t": Dim(1.6, A, "assumed", "phenolic plate"), "hole_d": Dim(5.5, A, "assumed"),
         "strip_l": Dim(92.0, A, "assumed", "steel strips into the case"), "coil_d": Dim(11.0, A, "assumed", "resistor coils"),
         "blade_w": Dim(6.35, f"{BK} (family gm_blade: the 0.250 in Packard 56 tab)", "vendor")}
    C = {"plate": ("#2f2f2e", f"{PH}: black plate (k-means)"), "strip": ("#80909f", f"{PH}: zinc strips (k-means, lit face)"),
         "coil": ("#8e8f8d", f"{PH}: coils"), "blade": ("#b9bfc4", "blades: drawn tin")}
    v = K.v
    NAMES = ("BAT", "M1", "M2", "BLO")
    BP = [(-4.5, 5.5), (4.5, 5.5), (-4.5, -5.5), (4.5, -5.5)]      # the photo's 2 x 2 cluster

    def build():
        from build123d import Sketch, Circle, make_hull, extrude
        L_, W_ = v(P["plate_l"]), v(P["plate_w"])
        pts = [(0, L_ / 2 - 7.0), (0, -(L_ / 2 - 7.0)), (W_ / 2 - 7.0, 0), (-(W_ / 2 - 7.0), 0)]
        hull = make_hull((Sketch() + [Pos(x, y) * Circle(7.0) for x, y in pts]).edges())
        plate = extrude(hull, amount=v(P["plate_t"]))
        for sy in (-1, 1):
            plate -= D.cyl(v(P["hole_d"]), 5, at=(0, sy * v(P["hole_pitch"]) / 2, -1))
        rivets = Compound(children=[D.cyl(4.0, 1.0, at=(x, y, v(P["plate_t"]))) for x, y in ((-9.5, 12.0), (9.5, 12.0), (-9.5, -12.0), (9.5, -12.0))]).fuse()
        strips = Compound(children=[Pos(sx * 7.0, 0, -v(P["strip_l"])) * Box(2.0, 12.0, v(P["strip_l"]), align=D.BASE) for sx in (-1, 1)]).fuse()
        coils = Compound(children=[D.cyl(v(P["coil_d"]), 16.0, at=(sx * 7.0, sy * 9.0, -v(P["strip_l"]) + 2.0), axis="x")
                                   for sx in (-1, 1) for sy in (-1, 1)]).fuse()
        blades = Compound(children=[D.blade((x, y, v(P["plate_t"])), axis="z", w=v(P["blade_w"]), l=9.0) for x, y in BP]).fuse()
        return [K.body(plate, f"{end} diamond plate", C["plate"][0]), K.body(rivets, f"{end} rivets", C["strip"][0], finish="metal"),
                K.body(strips, f"{end} steel strips (inside the case)", C["strip"][0], finish="metal"),
                K.body(coils, f"{end} resistor coils (inside the case)", C["coil"][0], finish="metal"),
                K.body(blades, f"{end} blades BAT / M1 / M2 / BLO", C["blade"][0], finish="metal")], [], []

    def attach_points():
        return [{"n": t, "ep": end, "at": [x, y, round(v(P["plate_t"]) + 9.0, 2)], "dir": [0, 0, 1], "kind": "blade", "note": t}
                for t, (x, y) in zip(NAMES, BP)]

    def terminals():
        return [{"pin": t, "endpoint": end, "name": t, "kind": "blade", "match": rf"^{t}$", "at": (x, y, v(P["plate_t"])), "dir": (0, 0, 1)}
                for t, (x, y) in zip(NAMES, BP)]

    def mount_points():
        return [{"n": f"screw_{s_}", "at": [0, sy * v(P["hole_pitch"]) / 2, 0], "dir": [0, 0, -1], "d": v(P["hole_d"]),
                 "note": "screw into the evaporator case"} for s_, sy in (("top", 1), ("bottom", -1))]

    ns = _assumed_part(end, "GM A/C blower resistor (336403 pattern; Four Seasons 20083)", "Blower resistor, factory A/C (GM 336403; "
                       "Four Seasons 20083, SMP RU67) on the blower-evaporator case: 4 blades BAT / M1 / M2 / BLO",
                       "GM", "GM 336403 (Four Seasons 20083, SMP RU67, LMC 32-2406)",
                       {"l": v(P["plate_w"]), "w": v(P["plate_l"]), "h": round(v(P["strip_l"]) + v(P["plate_t"]) + 9.0, 1)},
                       "no size in any source: Four Seasons' photo's proportions at an assumed 70 mm hole pitch (±15)",
                       {"mm": 15.0, "why": "no size published; proportions from the maker's photo"},
                       "origin at the centre of the plate's back face on the evaporator case; +Z out of the case (the blades), "
                       "strips and coils inside (-Z), +Y through the two holes",
                       [("[1]", "RockAuto 336403", "RockAuto 1977 K5 Blazer blower resistor listing: GM 336403 for A/C without the "
                                                   "heavy-duty heater (Four Seasons 20083, SMP RU67, Wells 3A1044 '2 bolt holes, 4 blades')"),
                        ("[2]", "LMC 32-2406", "LMC catalogue (database, ccComplete.pdf): 32-2406 blower resistor, W/AC 1973-87"),
                        ("[3]", "1978 C/K wiring booklet", "1978 booklet p.16 sheet A-4 via the registry")],
                       [("BAT = BLOWER_BAT, M1 = BLOWER_MED, M2 = BLOWER_M2, BLO = BLOWER_MOT (registry).", "#10151a"),
                        ("Every size is assumed (red); the blades' order in the cluster is drawn in the registry's order.", "assumed")],
                       ["Every size and the blade order: read the resistor on the truck."],
                       P, C, build, attach_points, terminals, mount_points, [("drawn at the assumed envelope", lambda b: 1.0, 1.0)],
                       photo={"url": f"{RA}/info/52/20083.jpg", "page": f"{RA}/en/moreinfo.php?pk=1312672", "fetched": "2026-09-29"})
    ns["PART"]["photo_short"] = PH
    ns["PART"]["cross_checks"] = ["Four Seasons, SMP, Wells and UMP list 4 male blades; the registry lands 4 (BAT, M1, M2, BLO)."]
    return ns


def amp_powerstep(end="AMP-STEP-CTRL"):
    AR = "reference_documents/component_drawings/amp_research_75146_install.pdf (AMP Research, Silverado kit IM75146: motor, linkages, controller)"
    A = f"no dimension printed ({AR}); the K5 kit is not in hand: envelopes assumed"
    P = {"ctrl_l": Dim(100.0, A, "assumed", "controller"), "ctrl_w": Dim(65.0, A, "assumed"), "ctrl_h": Dim(30.0, A, "assumed"),
         "motor_d": Dim(60.0, A, "assumed", "step motor"), "motor_l": Dim(110.0, A, "assumed"),
         "arm_l": Dim(220.0, A, "assumed", "motor linkage arm"), "bracket_w": Dim(110.0, A, "assumed", "linkage mounting bracket")}
    C = {"ctrl": ("#1d1d1e", "controller: drawn black"), "motor": ("#2b2c2d", "motor: drawn black"), "arm": ("#3a3b3c", "linkage: drawn cast black")}
    v = K.v

    def build():
        ctrl = D.rbox(v(P["ctrl_l"]), v(P["ctrl_w"]), v(P["ctrl_h"]), r=5.0)
        br = Pos(0, 160.0, 0) * D.rbox(v(P["bracket_w"]), 80.0, 8.0, r=6.0)
        motor = D.cyl(v(P["motor_d"]), v(P["motor_l"]), at=(0, 160.0, 8.0))
        arm = Pos(0, 160.0, -20.0) * Box(v(P["arm_l"]), 30.0, 12.0, align=(D.Align.MIN, D.Align.CENTER, D.Align.MIN)).rotate(Axis.Z, -25.0)
        return [K.body(ctrl, f"{end} controller (STA)", C["ctrl"][0]),
                K.body(br + motor, f"{end} step motor on its linkage bracket (one of two, display position)", C["motor"][0]),
                K.body(arm, f"{end} motor linkage arm (display position)", C["arm"][0], finish="cast")], [], []

    def attach_points():
        return [{"n": "harness", "ep": end, "at": [round(-v(P["ctrl_l"]) / 2, 2), 0, round(v(P["ctrl_h"]) / 2, 2)], "dir": [-1, 0, 0],
                 "kind": "kit harness", "note": "kit harness: RED power, BLACK negative, trigger leads to the door circuits"}]

    def terminals():
        at = (-v(P["ctrl_l"]) / 2, 0, v(P["ctrl_h"]) / 2)
        return [{"pin": "RED", "endpoint": end, "name": "RED power lead (kit harness)", "kind": "kit lead", "wires": ["3"], "at": at, "dir": (-1, 0, 0)},
                {"pin": "BLACK", "endpoint": end, "name": "BLACK negative lead (kit harness)", "kind": "kit lead", "wires": ["STEP_GND"], "at": at,
                 "dir": (-1, 0, 0)},
                {"pin": "TRIG_L", "endpoint": end, "name": "driver door trigger", "kind": "kit lead (Posi-Tap)", "wires": ["STEP_DOOR_L"], "at": at,
                 "dir": (-1, 0, 0)},
                {"pin": "TRIG_R", "endpoint": end, "name": "passenger door trigger", "kind": "kit lead (Posi-Tap)", "wires": ["STEP_DOOR_R"],
                 "at": at, "dir": (-1, 0, 0)}]

    def mount_points():
        return [{"n": "controller", "at": [0, 0, 0], "dir": [0, 0, -1], "note": "controller mount (spot not picked)"}]

    return _assumed_part(end, "AMP Research PowerStep controller and motor (K5 kit)", "Power step controller (AMP Research PowerStep kit "
                         "harness + controller; drives both step motors), with one motor and its linkage", "AMP Research", "PowerStep (K5 kit)",
                         {"l": 100.0, "w": 65.0, "h": 30.0}, "no dimension printed and the K5 kit not in hand: envelopes assumed (±40)",
                         {"mm": 40.0, "why": "AMP Research prints no size; the saved guide is the Silverado kit"},
                         "origin at the centre of the controller's mounting face; +Z out of it; the motor and linkage drawn beside it",
                         [("[1]", "amp_research_75146", "AMP Research install guide IM75146 (Silverado kit)"), ("[2]", "no dimension printed", "assumed")],
                         [("Kit harness: RED power (#3), BLACK negative (STEP_GND), door triggers by Posi-Tap (registry).", "#10151a"),
                          ("Every size is assumed (red).", "assumed")],
                         ["Every dimension: no printed size; the K5 kit's harness and trigger polarity read on arrival (registry)."],
                         P, C, build, attach_points, terminals, mount_points, [("drawn at the assumed envelope", lambda b: 1.0, 1.0)])
