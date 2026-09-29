"""TE Superseal 1.0 plug housings (34-way, 26-way) and the ProWire SSB thermoplastic backshells, as mated to a MoTeC
M1-case header (M130, PDM30, PDM15). Shared by those part scripts.

Plug frame (mm): the mating axis is local -Y (the plug hangs below the header and its wires leave downward). x runs
along the pin rows, z across them, and the lock arm is on +z (the header's latch side). The origin is the centre of the
plug's flange face, the face that seats against the header's rim.

TE customer drawing 2-1437285-3 (Superseal 1.0 plug housing assemblies), sheet 1 (34-way) and sheet 2 (26-way):
printed 38.2 / 32.2 overall width, 29.4 / 23.4 across the nose, 18.3 nose height, 38 overall height, 32.15 overall
length, 1.4 polarising rib. The steps between nose, flange, rear body and lock arm are scaled off the same sheets.
ProWire prints no dimensions for SSB-34BS-PA66 / SSB-26BS-PA66: the backshell is sized off ProWire's product photos
against the plug's rear body, so it is basis "photo" and fit is not guaranteed. The boot (straight, 70 or 90 degrees)
is HELD in families.yaml, so the model stops at the backshell's exit collar.
"""
from build123d import Align, Box, Pos, RectangleRounded, extrude, fillet, Axis, Plane

import k5cad as K
from k5cad import Dim

TE = "reference_documents/component_drawings/te_C-2-1437285-3_superseal_1.0_plug_housing_34_26_customer_drawing.pdf"
TES = f"scaled off {TE}, sheet scale from its printed 32.15 length and 38 height"
PW = ("ProWire SSB-34BS-PA66 / SSB-26BS-PA66 product photos (prowireusa.com/content/36373..36376, fetched 2026-09-29), "
      "sized against the plug's rear body; ProWire prints no dimensions")

P = {
    "plug34_w": Dim(38.2, f"{TE} sheet 1 (34-way, 2-1437285-3)"),
    "plug26_w": Dim(32.2, f"{TE} sheet 2 (26-way, 2-1437285-2)"),
    "nose34_w": Dim(29.4, f"{TE} sheet 1, SECT B"),
    "nose26_w": Dim(23.4, f"{TE} sheet 2, SECT B"),
    "nose_h": Dim(18.3, f"{TE} sheets 1-2, side view"),
    "plug_h": Dim(38.0, f"{TE} sheets 1-2 (overall, over the lock arm and the flange)"),
    "plug_l": Dim(32.15, f"{TE} sheets 1-2 (mating face to rear)"),
    "nose_l": Dim(13.7, TES, "scaled", "mating face to the flange: this length sits inside the header"),
    "flange_l": Dim(7.3, TES, "scaled"),
    "flange_up": Dim(13.6, TES, "scaled", "flange edge on the lock side, from the pin-field centre"),
    "rear_h": Dim(24.1, TES, "scaled", "rear body height"),
    "rear_w_off": Dim(3.3, TES, "scaled", "rear body is narrower than the overall width by this (34-way: 34.9)"),
    "lock_w": Dim(12.0, TES, "scaled", "lock arm width along the rows"),
    "bs_wall": Dim(1.8, PW, "photo"),
    "bs_l": Dim(14.0, PW, "photo", "backshell length along the wires, clip body"),
    "bs_collar_l": Dim(7.0, PW, "photo", "boot collar length"),
    "bs_collar_h": Dim(12.0, PW, "photo", "boot collar (flat oval) height; its length follows the rear body"),
}
C_PLUG = ("#2a2c2e", "TE Superseal 1.0 housings are black thermoplastic polyester (TE sheet 1 note 2, 'COLOR:BLACK')")
C_BS = ("#1f2123", "ProWire product photos: black thermoplastic (PBT per ProWire's title)")


def v(k):
    return K.v(P[k])


def plug_solids(ways, cx, face_y, zc, label_prefix):
    """TE plug + ProWire backshell seated on a header: the flange face at y = face_y, nose up into the header.
    Returns (bodies, exit_point, exit_dir)."""
    w = v("plug34_w") if ways == 34 else v("plug26_w")
    nose_w = v("nose34_w") if ways == 34 else v("nose26_w")
    nh, nl, fl = v("nose_h"), v("nose_l"), v("flange_l")
    L = v("plug_l")
    up = v("flange_up")
    down = v("plug_h") / 2               # the flange reaches the full half-height on the side away from the lock
    rear_l = L - nl - fl
    rear_w = w - v("rear_w_off")
    rh = v("rear_h")
    nose = Pos(cx, face_y + nl / 2, zc) * Box(nose_w, nl, nh)
    flange = Pos(cx, face_y - fl / 2, zc + (up - down) / 2) * Box(w, fl, up + down)
    rear = Pos(cx, face_y - fl - rear_l / 2, zc) * Box(rear_w, rear_l, rh)
    lock = Pos(cx, face_y - (fl + rear_l) / 2, zc + v("plug_h") / 2 - 2.7) * Box(v("lock_w"), fl + rear_l, 5.4)
    housing = nose + flange + rear + lock
    try:
        housing = fillet(housing.edges().filter_by(Axis.Y), radius=1.0)
    except ValueError:
        pass
    # backshell: a sleeve over the rear body, then the flat-oval boot collar
    t = v("bs_wall")
    y0 = face_y - fl - 1.0                              # the sleeve starts 1 mm behind the flange
    sleeve_l = v("bs_l")
    outer = Pos(cx, y0 - sleeve_l / 2, zc) * Box(rear_w + 2 * t, sleeve_l, rh + 2 * t)
    inner = Pos(cx, y0 - sleeve_l / 2 + 0.5, zc) * Box(rear_w, sleeve_l + 1.2, rh)
    sleeve = outer - inner
    cl = v("bs_collar_l")
    ch = v("bs_collar_h")
    cw = rear_w - 2.0
    collar_o = Plane.XZ.offset(-(y0 - sleeve_l)) * RectangleRounded(cw + 2 * t, ch + 2 * t, (ch + 2 * t) / 2 - 0.01)
    collar_i = Plane.XZ.offset(-(y0 - sleeve_l)) * RectangleRounded(cw, ch, ch / 2 - 0.01)
    collar = extrude(collar_o, amount=cl) - extrude(collar_i, amount=cl)
    collar = Pos(cx, 0, zc) * collar
    # the end wall of the sleeve, with the collar opening through it
    end = Pos(cx, y0 - sleeve_l + t / 2, zc) * Box(rear_w + 2 * t, t, rh + 2 * t)
    end -= Pos(cx, y0 - sleeve_l + t / 2, zc) * Box(cw, t + 1, ch)
    backshell = sleeve + end + collar
    exit_pt = [round(cx, 2), round(y0 - sleeve_l - cl, 2), round(zc, 2)]
    return ([K.body(housing, f"{label_prefix} plug: TE Superseal 1.0 {ways}-way housing (2-1437285-{3 if ways == 34 else 2})", C_PLUG[0]),
             K.body(backshell, f"{label_prefix} backshell: ProWire SSB-{ways}BS-PA66 (photo-sized)", C_BS[0])],
            exit_pt, [0, -1, 0])
