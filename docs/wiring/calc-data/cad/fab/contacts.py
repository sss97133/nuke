"""Crimp contacts and cavity plugs as solids of revolution, shared by the connector families (Deutsch first; Metri-Pack,
GT and Superseal add their terminals here).

A contact is a list of sections along its axis from the wire end: (start, end) as fractions of the overall length and a
diameter each, the barrel's bore and inspection hole, and a rounded mating end. The contact's own frame: the axis is +Z,
z = 0 at the wire end, the mating end at z = L. The families place it in a cavity.

Deutsch solid contacts (TE): the pin diameter is TE's ('Mating Pin Diameter', product pages), the strip length and
the barrel's wire range are the Deutsch contacts catalog's (p.125), the plating is TE's (nickel). The lengths and the
barrel, shoulder and sleeve diameters are measured off the customconnectorkits product photo of the same part number:
each photo is scaled from the pin diameter (pins) or from the matching pin's barrel (sockets: the Common Contact System
uses one barrel per wire range, catalog p.120), and its lengths are corrected for the camera's tilt (the end faces show
as ellipses: about 20 degrees, x 1.064, +-7 %).
"""
from build123d import Align, Axis, Cylinder, Plane, Polygon, Pos, Rot, revolve

import k5cad as K
from k5cad import Dim

CAT = "Deutsch contacts catalog (TE), customconnectorkits.com/cdn/shop/files/DEUTSCH_Contacts_Catalog.pdf (read 2026-09-29)"
TILT = 1.064          # 1 / cos 20 deg: the photos' axis tilt, from the end-face ellipses


def TE(pn):
    return f"te.com/en/product-{pn}.html (TE product page, read 2026-09-29)"


def PH(pn):
    return f"customconnectorkits.com/products/{pn.lower()} product photo (fetched 2026-09-29)"


def D(v, src, basis="maker", note="", fit=""):
    return Dim(v, src, basis, note, fit)


NICKEL_PH = "#c9bab0"


def _photo(pn, px_len, px_ref, ref_mm, ref_what):
    """Overall length from a photo: its length in px, scaled from a reference width (px) of known size (mm)."""
    return round(px_len / (px_ref / ref_mm) * TILT, 2), (f"{PH(pn)}: {px_len} px long, scaled from the {ref_what} "
                                                          f"({px_ref} px = {ref_mm} mm), x {TILT} for the camera tilt")


# section runs measured on each photo (fam scratch: contact_sections.py): (start, end, width px)
RUNS = {
    "0460-202-16141": (989, [(0.0, 0.32, 154, "barrel"), (0.32, 0.43, 199, "shoulder"), (0.43, 0.58, 149, "body"), (0.58, 1.0, 91, "pin")]),
    "0462-201-16141": (973, [(0.0, 0.33, 158, "barrel"), (0.33, 0.44, 202, "shoulder"), (0.44, 1.0, 167, "sleeve")]),
    "0460-202-20141": (1000, [(0.0, 0.25, 143, "barrel"), (0.25, 0.34, 184, "shoulder"), (0.34, 0.51, 138, "body"), (0.51, 1.0, 72, "pin")]),
    "0462-201-20141": (984, [(0.0, 0.26, 146, "barrel"), (0.26, 0.36, 192, "shoulder"), (0.36, 1.0, 140, "sleeve")]),
    "0462-005-20141": (981, [(0.0, 0.26, 140, "barrel"), (0.26, 0.36, 188, "shoulder"), (0.36, 1.0, 139, "sleeve")]),
    "0460-204-12141": (974, [(0.0, 0.31, 221, "barrel"), (0.31, 0.44, 266, "shoulder"), (0.44, 0.57, 208, "body"), (0.57, 1.0, 129, "pin")]),
    "0462-203-12141": (944, [(0.0, 0.32, 214, "barrel"), (0.32, 0.45, 258, "shoulder"), (0.45, 1.0, 215, "sleeve")]),
    "0413-204-2005": (969, [(0.0, 0.25, 185, "head"), (0.25, 1.0, 130, "stem")]),
}
# (kind, contact size, the sourced reference: pin diameter, or the pin whose barrel scales a socket)
SPEC = {
    "0460-202-16141": ("pin", 16, ("pin", 1.59, TE("0460-202-16141") + ": 'Mating Pin Diameter 1.59 mm'"), "20-16 AWG", "6.35-7.92"),
    "0462-201-16141": ("socket", 16, ("barrel", "0460-202-16141"), "20-16 AWG", "6.35-7.92"),
    "0460-202-20141": ("pin", 20, ("pin", 1.0, TE("0460-202-20141") + ": 'Mating Pin Diameter 1 mm'"), "20 AWG", "3.96-5.54"),
    "0462-201-20141": ("socket", 20, ("barrel", "0460-202-20141"), "20 AWG", "3.96-5.54"),
    "0462-005-20141": ("socket", 20, ("sleeve", "0462-201-20141"), "18-16 AWG", "3.96-5.54"),
    "0460-204-12141": ("pin", 12, ("pin", 2.4, TE("0460-204-12141") + ": 'Mating Pin Diameter 2.4 mm'"), "14-12 AWG", "5.64-7.21"),
    "0462-203-12141": ("socket", 12, ("barrel", "0460-204-12141"), "14-12 AWG", "5.64-7.21"),
    "0413-204-2005": ("plug", 20, ("stem_as_barrel", "0460-202-20141"), "sealing plug", None),
}
COLOURS = {
    "0460-202-16141": NICKEL_PH, "0462-201-16141": "#c2b9b4", "0460-202-20141": "#cec5c0", "0462-201-20141": "#c7bfbc",
    "0462-005-20141": "#ae9f98", "0460-204-12141": "#d2c7c0", "0462-203-12141": "#baafa8", "0413-204-2005": "#e2414a",
}
BAND = {"0462-005-20141": "#7e656b"}      # the purple band the photo shows on the 16-18 AWG socket's barrel


def _scale(pn):
    """px per mm for a contact's photo, from its sourced reference."""
    kind, size, ref, *_ = SPEC[pn]
    px_len, runs = RUNS[pn]
    by = {r[3]: r[2] for r in runs}
    if ref[0] == "pin":
        return by["pin"] / ref[1], f"the pin diameter {ref[1]} mm ({ref[2]})"
    other = ref[1]
    s_other, _ = _scale(other)
    ob = {r[3]: r[2] for r in RUNS[other][1]}
    if ref[0] == "barrel":
        mm = ob["barrel"] / s_other
        return by["barrel"] / mm, f"the {other} barrel ({mm:.2f} mm, the Common Contact System's one barrel per wire range)"
    if ref[0] == "sleeve":
        mm = ob["sleeve"] / s_other
        return by["sleeve"] / mm, f"the {other} sleeve ({mm:.2f} mm, the same size-20 mating end)"
    mm = ob["barrel"] / s_other
    return by["stem"] / mm, f"the size-20 barrel ({mm:.2f} mm: the plug's stem fills a contact's place in the seal)"


def geometry(pn):
    """(overall length, [(z0, z1, dia, name)], params {name: Dim})."""
    s, ref = _scale(pn)
    px_len, runs = RUNS[pn]
    L = round(px_len / s * TILT, 2)
    src = f"{PH(pn)}, scaled from {ref}, lengths x {TILT} for the camera tilt"
    secs = [(round(a * L, 2), round(b * L, 2), round(w / s, 2), nm) for a, b, w, nm in runs]
    P = {"length": D(L, src, "photo", "+-7 %")}
    kind, size, sref, awg, strip = SPEC[pn]
    for z0, z1, dia, nm in secs:
        if nm == "pin" and sref[0] == "pin":
            P["pin_d"] = D(sref[1], sref[2])
        else:
            P[f"{nm}_d"] = D(dia, src, "photo", "+-5 %")
        P[f"{nm}_len"] = D(round(z1 - z0, 2), src, "photo", "+-10 %")
    if strip:
        P["strip_len"] = D(float(strip.split("-")[1]), f"{CAT} p.125 'Recommended Strip Length' {strip} mm",
                           note="the barrel takes the stripped conductor up to the inspection hole")
    return L, secs, P


def solid(pn):
    """The contact as one solid, axis +Z, wire end at z = 0."""
    L, secs, P = geometry(pn)
    kind = SPEC[pn][0]
    pts = [(0.0, 0.0)]
    for i, (z0, z1, dia, nm) in enumerate(secs):
        r = dia / 2
        if i == 0:
            pts.append((r * 0.92, 0.0))                  # the wire lead-in chamfer at the barrel end
            pts.append((r, 0.25))
        else:
            pts.append((r, z0))
        if i == len(secs) - 1:
            if kind == "pin":                           # a rounded mating end
                pts.append((r, z1 - r * 0.8))
                pts.append((r * 0.55, z1 - r * 0.15))
                pts.append((0.0, z1))
            else:
                pts.append((r, z1 - 0.2))
                pts.append((r * 0.9, z1))
                pts.append((0.0, z1))
        else:
            pts.append((r, z1))
    prof = Plane.XZ * Polygon(*[(x, z) for x, z in pts], align=None)
    body = revolve(prof, Axis.Z)
    if kind in ("pin", "socket"):
        bar = secs[0]
        bore = bar[2] * 0.62
        depth = min(bar[1] + 0.6, L * 0.45)
        body -= Pos(0, 0, -0.1) * Cylinder(bore / 2, depth, align=(Align.CENTER, Align.CENTER, Align.MIN))
        hole = min(0.9, bar[2] * 0.33)                  # the wire inspection hole, near the shoulder
        body -= Pos(0, 0, bar[1] - hole * 0.9) * Rot(90, 0, 0) * Cylinder(hole / 2, bar[2] * 2)
    if kind == "socket":
        last = secs[-1]
        entry = SPEC[SPEC[pn][2][1]][2][1] if SPEC[pn][2][0] == "barrel" else 1.0
        body -= Pos(0, 0, L - 3.5) * Cylinder(min(entry, last[2] * 0.8) * 0.55, 3.6, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return body


def bodies(pn, label=None, at=(0, 0, 0), flip=False):
    """Labelled bodies for a contact placed with its wire end at `at`: flip=False points the mating end +Z."""
    lab = label or pn
    s = solid(pn)
    if flip:
        s = Rot(180, 0, 0) * s
    s = Pos(*at) * s
    fin = "rubber" if SPEC[pn][0] == "plug" else "metal"
    out = [K.body(s, f"{lab} ({pn})", COLOURS[pn], finish=fin)]
    if pn in BAND:
        L, secs, _ = geometry(pn)
        z0, z1 = secs[0][0] + 0.6, secs[0][0] + 1.6
        band = Pos(0, 0, z0) * Cylinder(secs[0][2] / 2 + 0.03, z1 - z0, align=(Align.CENTER, Align.CENTER, Align.MIN))
        band -= Pos(0, 0, z0 - 0.1) * Cylinder(secs[0][2] / 2 - 0.05, z1 - z0 + 0.2, align=(Align.CENTER, Align.CENTER, Align.MIN))
        if flip:
            band = Rot(180, 0, 0) * band
        out.append(K.body(Pos(*at) * band, f"{lab} ({pn}) colour band", BAND[pn], finish="paint"))
    return out


def shoulder_z(pn):
    """Distance from the wire end to the retention shoulder's front face (the housing's fingers lock behind it)."""
    L, secs, _ = geometry(pn)
    return next(z1 for z0, z1, d, nm in secs if nm in ("shoulder", "head"))


def module(pn, endpoints, maker="TE Connectivity (Deutsch)", family="deutsch contact"):
    """A contact as its own part: its solid, dimension table and checks, in the contact frame (axis +Z, wire end at
    z = 0)."""
    import types
    L, secs, P = geometry(pn)
    kind, size, ref, awg, strip = SPEC[pn]
    m = types.SimpleNamespace()
    m.P = P
    plating = "; TE: 'Interface Plating Nickel (Ni)'" if kind != "plug" else "; the red size-20 sealing plug"
    m.COLORS = {"plating": (COLOURS[pn], f"{PH(pn)}: dominant colour (k-means){plating}")}
    if pn in BAND:
        m.COLORS["band"] = (BAND[pn], f"{PH(pn)}: the coloured band on the barrel")
    what = {"pin": f"Deutsch size {size} solid pin contact, {awg}, nickel",
            "socket": f"Deutsch size {size} solid socket contact, {awg}, nickel, with its protective sleeve",
            "plug": f"Deutsch size {size} cavity sealing plug (red)"}[kind]
    dmax = max(d for _, _, d, _ in secs)
    m.PART = {"pid": pn, "endpoints": list(endpoints), "maker": maker, "pn": pn, "title": f"Deutsch {pn}", "what": what,
              "shape_basis": "scaled from photo", "viewset": "wall", "kind": "piece", "family": family,
              "dims_mm": {"l": L, "w": dmax, "h": dmax},
              "dims_note": f"{L:g} long overall (photo, +-7 %); " + ", ".join(f"{nm} dia {d:g}" for _, _, d, nm in secs),
              "frame": "the contact's axis is +Z, the wire (barrel) end at z = 0, the mating end toward +Z",
              "axes": {"mount_normal": "+Z", "maker_up": "+Y", "faces": {"wire": "-Z", "mating": "+Z"}},
              "refs": [("[1]", "te.com/en/product-", "TE product page (pin diameter, plating)"),
                       ("[2]", "customconnectorkits.com", "customconnectorkits product photo (lengths and diameters)"),
                       ("[3]", "Deutsch contacts catalog", "Deutsch contacts catalog p.125 (strip length, wire range)")],
              "unknowns": ["Lengths and diameters are photo-scaled (+-5-10 %): TE's contact drawings were not on file."],
              "notes": [f"wire range {awg}" + (f", strip length {strip} mm (catalog p.125)" if strip else "")]}
    m.build = lambda: (bodies(pn), [], [])
    ep0 = endpoints[0] if endpoints else pn
    kind_txt = "crimp barrel (wire end)" if kind != "plug" else "sealing plug head"
    m.attach_points = lambda: ([{"n": "wire", "ep": ep0, "at": [0.0, 0.0, 0.0], "dir": [0, 0, -1], "kind": kind_txt}]
                               if endpoints else [])
    m.mount_points = lambda: []
    ck = [("overall length (photo-scaled)", lambda b: round(b[0].bounding_box().size.Z, 2), L, 0.02)]
    if kind == "pin":
        ck.append(("pin diameter (TE)", lambda b: round(max(e.radius for e in b[0].edges()
                                                             if e.geom_type.name == "CIRCLE" and e.arc_center.Z > L * 0.7) * 2, 2),
                   ref[1], 0.02))
    m.CHECKS = ck
    return m
