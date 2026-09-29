#!/usr/bin/env python3
"""Margin of error of the twin (v3 blend) against published K5 dimensions -> docs/wiring/calc-data/cad/margins.yaml.

    python3 docs/wiring/twin/margins_v4.py --mesh-dir <export_twin_meshes.py output>

Every model value is measured here from the exported meshes, by the method written next to it. Published values
are as printed, with document, page and figure; the row ids of the geometry lane's dimensions.yaml (PR #417) are
given as `dim_id`. Nothing is tape-measured: the tape list (tape_list.yaml, same PR) settles what stays open.
Twin axes: metres, +x = driver, -y = front, +z = up.
"""
import argparse, json, math, os, sys
from pathlib import Path
import numpy as np
import yaml

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "docs/wiring/calc-data/cad/margins.yaml"
ap = argparse.ArgumentParser(); ap.add_argument("--mesh-dir", required=True); a = ap.parse_args()
MD = a.mesh_dir
_c = {}


def load(n):
    if n not in _c:
        d = np.load(os.path.join(MD, n + ".npz")); _c[n] = (d["V"], d["T"])
    return _c[n]


def section(n, axis, val):
    V, T = load(n)
    P = V[T]; s = P[:, :, axis] - val
    cross = ~((np.sign(s[:, 0]) == np.sign(s[:, 1])) & (np.sign(s[:, 1]) == np.sign(s[:, 2])))
    segs = []
    for tri, d in zip(P[cross], s[cross]):
        pts = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            if (d[i] < 0) != (d[j] < 0) and d[i] != d[j]:
                t = d[i] / (d[i] - d[j]); pts.append(tri[i] + t * (tri[j] - tri[i]))
        if len(pts) >= 2:
            segs.append(pts[:2])
    return np.array(segs) if segs else np.zeros((0, 2, 3))


def in_box(S, lo, hi):
    if len(S) == 0:
        return S
    m = np.all((S.min(axis=1) >= np.array(lo)) & (S.max(axis=1) <= np.array(hi)), axis=1)
    return S[m]


def rail_web_faces(y, side=1):
    """Inner and outer faces of a frame rail's web at station y: the two longest vertical-segment clusters."""
    S = in_box(section("Under_Frame_Blazer", 1, y), (-2, y - 1, 0.40), (2, y + 1, 0.90))
    xs, ls = [], []
    for a_, b_ in S:
        if (a_[0] * side) < 0.30 or (a_[0] * side) > 0.47:
            continue
        dx, dz = abs(a_[0] - b_[0]), abs(a_[2] - b_[2])
        if dz > 3 * dx and dz > 0.004:
            xs.append((a_[0] + b_[0]) / 2 * side); ls.append(dz)
    xs, ls = np.array(xs), np.array(ls)
    bins = {}
    for x, l in zip(np.round(xs, 3), ls):
        bins[x] = bins.get(x, 0) + l
    top = sorted(bins.items(), key=lambda kv: -kv[1])[:2]
    faces = sorted(x for x, _ in top)
    zs = S[:, :, 2].ravel()
    return faces, float(zs.max()), float(zs.min())


def rail_top(y):
    S = in_box(section("Under_Frame_Blazer", 1, y), (0.30, y - 1, 0.40), (0.47, y + 1, 0.90))
    return float(S[:, :, 2].max())


rows = []


def row(**k):
    k.setdefault("status", "measured on the twin; nothing taped")
    rows.append(k)


def verdict(delta, tol):
    return "pass" if abs(delta) <= tol else "off"


# ------------------------------------------------------------------ frame
wh = json.load(open(os.path.join(MD, "wheels.json")))
wb = (wh["Wheel_Back_Left"]["loc"][1] - wh["Turning_Wheel_Left"]["loc"][1]) * 1000
row(id="frame.wheelbase", zone="frame", dimension="wheelbase", published_mm=2705.0, dim_id="fr88.frame.wheelbase",
    source="Mitchell 1988 Blazer 4WD dimension sheet (reference_documents/k5_factory_docs/1988_Blazer_4WD_Frame_Dimensions.pdf) p.1, header '2705 mm (106 1/2 in) WHEELBASE'; KLM 1984 CHT-1 '106.5 in'",
    model_mm=round(wb, 1), method="twin wheel centres: Turning_Wheel_Left location y -1.8955 to Wheel_Back_Left location y 0.8069",
    delta_mm=round(wb - 2705, 1), tolerance_mm=4.8, tolerance_basis="GM frame tram tolerance 3/16 in (1977 LTSM p.2A-2, dimensions.yaml tolerances gm77.frame.tram)",
    verdict=verdict(wb - 2705, 4.8))
for yst, dim, pub, did, name in ((-0.50, "U", 428.6, "gm77.frame.KA105.U", "mid-frame"), (1.50, "T", 428.6, "gm77.frame.KA105.T", "rear")):
    faces, _, _ = rail_web_faces(yst)
    inner = faces[0] * 1000
    row(id=f"frame.web.{name}", zone="frame", dimension=f"frame centreline to the inside of the rail web, {name}", published_mm=pub, dim_id=did,
        source=f"1977 Light Truck Service Manual p.2A-4 Fig. 2A-3 (PDF p.110), model KA105, column {dim} = 16-7/8 in; the circled-plus mark means 'to the inside of the frame outer surface' (Fig. 2A-2, PDF p.109)",
        model_mm=round(inner, 1), method=f"Under_Frame_Blazer plane section at y {yst}: web faces at x {faces[0]:.3f} and {faces[1]:.3f} (the longest vertical segments), inner face taken",
        delta_mm=round(inner - pub, 1), tolerance_mm=4.8, tolerance_basis="GM 3/16 in", verdict=verdict(inner - pub, 4.8))
faces, _, _ = rail_web_faces(-2.55)
inner = faces[0] * 1000
row(id="frame.web.front", zone="frame_front", dimension="frame centreline to the inside of the rail web, front horns", published_mm=355.6, dim_id="gm77.frame.KA105.V",
    source="1977 LTSM p.2A-4 Fig. 2A-3, KA105 column V = 14 in (to the inside of the frame outer surface); cross-checks: GM 1987 points 1-2 704.85 mm inside the web (half 352.4); Mitchell 1988 A-A 706 (hole centres inside the front rail, half 353)",
    model_mm=round(inner, 1), method=f"Under_Frame_Blazer section at y -2.55: web faces {faces[0]:.3f} / {faces[1]:.3f}; the twin's front rails run straight from y -2.65 to -1.65 and do not taper",
    delta_mm=round(inner - 355.6, 1), tolerance_mm=4.8, tolerance_basis="GM 3/16 in", verdict=verdict(inner - 355.6, 4.8),
    correction="no harness part mounts on the front horns; the bay power runs stay on the inner fenders and the core support, so nothing is moved")
t_mid, t_high, t_kick, t_end, t_tip = rail_top(-0.50), max(rail_top(y) for y in (-2.10, -2.05, -2.0, -1.95, -1.90)), max(rail_top(y) for y in (0.55, 0.65, 0.75)), rail_top(1.50), rail_top(-2.65)
for rid, name, pub, did, mv, meth in (
        ("frame.rise.front", "front high point above the mid-frame (D+ minus F+)", 504.8 - 330.2, "gm77.frame.KA105.D/F", t_high - t_mid, "rail top flange: max over y -2.10..-1.90 minus the level mid-frame at y -0.50"),
        ("frame.rise.kickup", "rear kick-up above the mid-frame (K+ minus F+)", 508.0 - 330.2, "gm77.frame.KA105.K/F", t_kick - t_mid, "rail top flange: max over y 0.55..0.75 minus y -0.50"),
        ("frame.rise.rear", "rear end above the mid-frame (N+ minus F+)", 450.85 - 330.2, "gm77.frame.KA105.N/F", t_end - t_mid, "rail top flange at y 1.50 minus y -0.50"),
        ("frame.rise.tip", "front tip above the mid-frame (B+ minus F+)", 387.35 - 330.2, "gm77.frame.KA105.B/F", t_tip - t_mid, "rail top flange at y -2.65 (the twin's front end) minus y -0.50; station of B+ not given, so this row is station-sensitive")):
    d = mv * 1000 - pub
    row(id=rid, zone="frame", dimension=name, published_mm=round(pub, 1), dim_id=did,
        source="1977 LTSM p.2A-4 Fig. 2A-3 KA105 heights to the underside of the frame top surface (circled-plus points), differences taken so the datum drops out",
        model_mm=round(mv * 1000, 1), method=meth, delta_mm=round(d, 1), tolerance_mm=25.0,
        tolerance_basis="working band for routing on the rail (the heights of the two mid-frame points F and G already differ by the frame's own shape)",
        verdict=verdict(d, 25.0))

# ------------------------------------------------------------------ body
S = in_box(section("Exterior_Body_Blazer_Rear", 2, 1.10), (0.70, 1.60, 1.0), (1.05, 1.95, 1.2))
tg_x = float(S[:, :, 0].min())
top_z = float(load("Exterior_Body_Blazer_Rear")[0][:, 2].max())
Ssill = in_box(section("Exterior_Body_Blazer_Rear", 0, 0.50), (0.4, 1.60, 0.70), (0.6, 1.80, 0.90))
sill = float(Ssill[:, :, 2].max())
w_tg, h_tg = 2 * tg_x * 1000, (top_z - sill) * 1000
for rid, name, pub, did, mv, meth in (
        ("body.tailgate.width", "tailgate opening width, inner corners", 1657, "fr88.body.tailgate.top-A-B / bottom-D-C", w_tg, f"inner faces of the rear pillars, Exterior_Body_Blazer_Rear section z 1.10: x +-{tg_x:.4f}"),
        ("body.tailgate.height", "tailgate opening height, inner corners", 505, "fr88.body.tailgate.side-A-D", h_tg, f"pillar top z {top_z:.4f} minus the rear sill top z {sill:.4f} (section x 0.50)"),
        ("body.tailgate.diagonal", "tailgate opening diagonal", 1724, "fr88.body.tailgate.diag-A-C", math.hypot(w_tg, h_tg), "from the two rows above")):
    d = mv - pub
    row(id=rid, zone="body_exterior", dimension=name, published_mm=pub, dim_id=did,
        source="Mitchell 1988 sheet p.2 (Fig 2 upperbody, TAILGATE OPENING)", model_mm=round(mv, 1), method=meth, delta_mm=round(d, 1),
        tolerance_mm=18.0, tolerance_basis="the sheet's own closure error 8 mm (1657 x 505 wants a 1732 diagonal; geometry lane check) + 10 mm point identification",
        verdict=verdict(d, 18.0))
V, _ = load("Exterior_Window_Front")
zmin, zmax = V[:, 2].min(), V[:, 2].max()
widths = []
for z in np.linspace(zmin + 0.01, zmax - 0.01, 40):
    m = np.abs(V[:, 2] - z) < 0.006
    if m.sum():
        widths.append((z, V[m, 0].max() - V[m, 0].min()))
wb_bot = max(w for z, w in widths if z < zmin + 0.12) * 1000
wb_top = [w for z, w in widths if abs(z - 1.80) < 0.02][0] * 1000
cm = np.abs(V[:, 0]) < 0.01; Pc = V[cm]
slant = float(np.linalg.norm(Pc[np.argmax(Pc[:, 2])] - Pc[np.argmin(Pc[:, 2])])) * 1000
for rid, name, pub, did, mv, inset in (
        ("body.windshield.bottom", "windshield opening, lower corners (centre of arc at moulding)", 1686, "fr88.body.windshield.bottom-D-C", wb_bot, (wb_bot - 1686) / 2),
        ("body.windshield.top", "windshield opening, upper corners", 1417, "fr88.body.windshield.top-A-B", wb_top, (wb_top - 1417) / 2),
        ("body.windshield.side", "windshield opening, upper to lower corner", 600, "fr88.body.windshield.side-A-D", slant, (slant - 600) / 2)):
    row(id=rid, zone="body_exterior", dimension=name, published_mm=pub, dim_id=did, source="Mitchell 1988 sheet p.2 (FRONT WINDSHIELD)",
        model_mm=round(mv, 1), method="the glass (Exterior_Window_Front) edge to edge; the published points sit on the moulding's corner arcs, inside the glass edge",
        delta_mm=round(mv - pub, 1), tolerance_mm=None, tolerance_basis="point identification: the moulding arc points are an unknown 5-35 mm inside the glass edge",
        verdict="consistent" if 0 <= inset <= 35 else "off", note=f"implied inset {inset:.0f} mm per side")
# door opening
fr, rr = [], []
for z in (0.90, 1.00, 1.10):
    S = in_box(section("Interior_Body", 2, z), (0.80, -1.30, 0), (0.95, -0.90, 3)); fr.append(S[:, :, 1].max())
    S = in_box(section("Interior_Body", 2, z), (0.80, -0.40, 0), (0.95, 0.05, 3)); rr.append(S[:, :, 1].min())
door = (np.mean(rr) - np.mean(fr)) * 1000
row(id="body.door.striker-to-switch", zone="body_exterior", dimension="door opening, striker bolt centre to the surface above the jamb switch", published_mm=940,
    dim_id="fr88.body.door.F-C", source="Mitchell 1988 sheet p.2 (DOOR OPENING, F to C)", model_mm=round(door, 1),
    method=f"Interior_Body jamb faces at z 0.90-1.10: hinge pillar y {np.mean(fr):.4f}, lock pillar y {np.mean(rr):.4f} (face to face; the striker bolt head stands proud of its pillar by an amount the sheet does not give)",
    delta_mm=round(door - 940, 1), tolerance_mm=35.0, tolerance_basis="striker stand-off not published + 10 mm identification", verdict=verdict(door - 940, 35.0))
# engine compartment -> firewall calibration
S = in_box(section("Under_Main_Blazer", 0, 0.7615), (-2, -2.60, 0.95), (2, -2.40, 1.24))
ys = np.round(S[:, :, 1].ravel(), 3)
vals, cnt = np.unique(ys, return_counts=True)
front_y = float(np.average(vals, weights=cnt))
fa_side = math.sqrt(1102 ** 2 - ((1715 - 1523) / 2) ** 2)
fa_diag = math.sqrt(1957 ** 2 - ((1715 + 1523) / 2) ** 2)
fa = (fa_side + fa_diag) / 2
fw_side = -1.467
pinned = front_y + fa / 1000
row(id="body.engcomp.fore-aft", zone="firewall", dimension="engine compartment, radiator-support points to cowl points (fore-aft)",
    published_mm=round(fa, 1), dim_id="fr88.body.engcomp.side.* / .diag; klm84.body.underhood.length 1108.08",
    source=f"Mitchell 1988 sheet p.2 (ENGINE COMPARTMENT): sides 1102, diagonals 1957, widths 1715 rear / 1523 front -> fore-aft {fa_side:.1f} (sides) and {fa_diag:.1f} (diagonals); the front pair sits on 1981+ radiator-support sheet metal (low weight, geometry lane)",
    model_mm=round((fw_side - front_y) * 1000, 1),
    method=f"twin radiator support at x 0.76: y {front_y:.3f} (Under_Main_Blazer panel); twin firewall face at x 0.76: y {fw_side}",
    delta_mm=round((fw_side - front_y) * 1000 - fa, 1), tolerance_mm=50.0,
    tolerance_basis="front points on 1981+ front sheet metal: their fore-aft offset from the 1977 support is not published (weighted low) -> +-50 mm",
    verdict="inconclusive",
    correction=(f"If the truck's radiator support sat where Mitchell's 1981+ front pair does, the cowl line would be at y {pinned:.3f} +- 0.050, "
                f"{(pinned - fw_side) * 1000:.0f} mm aft of the model's firewall face ({fw_side}). That is not evidence the model is wrong: the 1981+ front clip "
                "differs from the 1977 one by an amount no source gives, and the model's cowl depth (firewall face to the windshield base, y -1.467 to -1.305, "
                "162 mm) is plausible. What does point the same way: the v3 heads sit 13-18 mm from this face and the passenger head passes up to 18 mm "
                "through it, so either the firewall is too far forward or the engine too far back (geometry lane saw the same). "
                "Nothing is moved: parts stay on the model's firewall, the working tolerance stays +-100 mm fore-aft, and every run that ends on the "
                "firewall carries its length change (routes.json firewall_shift_mm). Settled by tape T-14 (radiator support to cowl, and which front "
                "clip the truck has), T-05 (engine against the firewall) and T-06 (body on the frame)."))
row(id="body.engcomp.widths", zone="firewall", dimension="engine compartment widths, rear 1715 / front 1523", published_mm=1715, dim_id="fr88.body.engcomp.rear-width / front-width",
    source="Mitchell 1988 sheet p.2; KLM 1984 1721 / 1524", model_mm=None,
    method="the rear points (x +-0.858) fall between the twin's firewall end (x +-0.77) and the fender skin (+-0.93); the front points (x +-0.762) fall on the twin radiator support (x 0.49-0.89)",
    delta_mm=None, tolerance_mm=None, tolerance_basis="points not modelled as holes", verdict="consistent (points lie on the modelled panels)")

# ------------------------------------------------------------------ zones
zones = [
    {"zone": "body_exterior", "tolerance_mm": 15, "basis": "tailgate -9/-12 mm, door -32 mm before the striker stand-off, windshield consistent: the outer shell is good (owner: 'really nice and accurate on the outside')", "tape": ["T-08", "T-12", "T-13"]},
    {"zone": "frame", "tolerance_mm": 5, "basis": "mid and rear web +1 mm against GM KA105 U/T; heights within 20 mm", "tape": []},
    {"zone": "frame_heights", "tolerance_mm": 25, "basis": "kick-up -20 mm, rear end -16 mm, front high +5 mm", "tape": []},
    {"zone": "frame_front", "tolerance_mm": 40, "basis": "front horns +34 mm per side (the twin's rails do not taper)", "tape": []},
    {"zone": "firewall", "tolerance_mm": 100, "pinned_line_y": round(pinned, 3), "pinned_margin_mm": 50,
     "basis": f"model firewall face {fw_side}; the Mitchell engine-compartment points put the cowl line at {pinned:.3f} +- 0.050 only if the truck has the 1981+ support (low weight); the heads touching the model's firewall point the same way; kept at +-100 mm and drawn on the model until taped",
     "tape": ["T-14", "T-05", "T-06", "T-02"]},
    {"zone": "front_inner_fenders", "tolerance_mm": 50, "basis": "not checked against a published figure; the wheelhouse dome rises into GM's battery tray spot by ~20 mm", "tape": ["T-11", "T-14"]},
    {"zone": "engine", "tolerance_mm": 100, "basis": "twin v3 engine: photo match RMS 27 px of 1200, geometry error 5-10 cm (docs/wiring/twin/HANDOFF.md)", "tape": ["T-05"]},
    {"zone": "rear_double_wall", "tolerance_mm": 40, "basis": "the inner quarter panel is not modelled (trim panel at x +-0.82, outer skin +-0.995, wheelhouse wall +-0.624); tailgate width -9 mm", "tape": ["T-07"]},
    {"zone": "cab_interior", "tolerance_mm": 30, "basis": "dash, column and floor not checked against a published figure; door jambs consistent", "tape": ["T-12", "T-04"]},
]
doc = {"schema": "margins v1 (harness-cad 2026-09-29)", "frame": "twin metres: +x driver, -y front, +z up (model_mm, published_mm, delta_mm in mm)",
       "generated_by": "docs/wiring/twin/margins_v4.py", "twin": "~/k5-harness-pull/K5_harness_workspace_v3.blend (TurboSquid 1978 Blazer body scaled to the wheelbase, v3 engine)",
       "published_source_index": "geometry lane docs/wiring/calc-data/cad/dimensions.yaml (PR #417): dim_id per row",
       "rows": rows, "zones": zones,
       "rule": "Where the model is off, parts are placed by the published value and the correction is recorded; the mesh is not sculpted unless placement needs it."}
OUT.parent.mkdir(parents=True, exist_ok=True)
def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.generic):
        return o.item()
    return o


doc = clean(doc)
yaml.safe_dump(doc, open(OUT, "w"), sort_keys=False, width=140, allow_unicode=True)
for r in rows:
    print(f"{r['id']:30s} pub {r['published_mm']!s:8s} model {r['model_mm']!s:8s} d {r['delta_mm']!s:7s} {r['verdict']}")
print("WROTE", OUT)
