"""Solve the IMG_6531 camera pose and the engine root position jointly from photo features.

  python3 docs/wiring/twin/photo_match.py   -> prints the Blender camera pose, engine root, fitted photo-dims and the
                                               residuals; writes photo_match_IMG6531.json (read by build_engine_v3.py)

Unknowns (15): camera rotation (3) + position (3); engine root offset dx,dy,dz (3) from ROOT0; and the model's
photo-scaled dimensions that were never published: fuel-rail offset in the bank frame (dr, ds), alternator centre
(x, z), throttle-body stack height (dz), coil-mount unaffected. Residuals: pixel reprojection of fixed truck
features (cowl edge, iBooster, tire far-tangents) and engine features whose engine-local coordinates mirror
build_engine_v3.py. Acceptance (main, 2026-09-29): TB bore centre, the four fuel-rail ends, the alternator pulley and
the iBooster within ~2 % of the frame (24 px at 1200 px).

Intrinsics: iPhone 15 Pro main camera, EXIF 6.765 mm = 24 mm equivalent, 4:3; on the 1200x900 working copy
f = 830 px, principal point at the centre, no distortion term. Pixel picks from ref-photos/grid_*.jpg (+/-8 px).
Twin frame: +x driver, -y front, +z up (metres). Engine-local: origin crank centreline at the bell face, mm.
"""
import json, os
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot

W, H = 1200, 900
F = 830.0
ROOT0 = np.array([0.0, -1.40, 0.72])       # provisional root (physical constraints; see HANDOFF)

TIRE_R = 0.40; AXLE_Y = -1.896; AXLE_Z = 0.39
TRUCK_FIXED = [   # (px, twin m, name, weight)
    ((945, 275), (0.40, -1.56, 1.05), "iBooster body centre (v2 atom position)", 0.5),
]
TIRES = [((170, 522), -0.86, "pass tire top edge (far tangent)", 1.0), ((1120, 585), 0.86, "driver tire top edge (far tangent)", 1.0)]
# line features: image line (2 px points) that these twin points must project onto (perpendicular distance residual)
LINES = [
    (((200, 50), (1000, 40)), [(-0.6, -1.52, 1.25), (0.0, -1.52, 1.25), (0.6, -1.52, 1.25)], "cowl front edge (y -1.52, z 1.25)", 1.0),
    (((335, 490), (350, 890)), [(-0.35, -2.2, 0.55), (-0.35, -1.9, 0.55), (-0.35, -1.6, 0.55)], "passenger rail inner-top edge (x -0.35, z 0.55)", 0.5),
    (((850, 490), (875, 890)), [(0.35, -2.2, 0.55), (0.35, -1.9, 0.55), (0.35, -1.6, 0.55)], "driver rail inner-top edge (x +0.35, z 0.55)", 0.5),
]
def line_resid(rvec, cpos):
    out = []; names = []
    for (a, b), pts, name, w in LINES:
        a = np.array(a, float); b = np.array(b, float); d = b - a; nrm = np.array([-d[1], d[0]]) / np.linalg.norm(d)
        pr = project(rvec, cpos, pts)
        for i, q in enumerate(pr):
            out.append(float(np.dot(q - a, nrm)) * w); names.append(name + " #%d" % i)
    return np.array(out), names

# engine geometry (mirrors build_engine_v3.py)
RW, BS, STAG = 140.0, 111.76, 24.0
Y_BANK_L = -RW - STAG - 1.5 * BS; Y_BANK_R = -RW - 1.5 * BS
Y_INT_C = (Y_BANK_L + Y_BANK_R) / 2
DH = 234.7; VZ = 225.0; PAD_Z = VZ + 137.7; TB_Z0 = PAD_Z + 25.0
BP = -735.0; Y_FRONT = -610.0
VC_TOP_R = 389.7 + 35.0
vin_x, vin_z = 0.7071 * (VC_TOP_R - 73), 0.7071 * (VC_TOP_R + 73)
PORT_R = DH + 70; PORT_S = 110.0
RAIL_R0, RAIL_S0 = PORT_R + 105, PORT_S + 40     # build script's rail centre in the bank frame
RAIL_HALF = 260.0

def bank_xz(side, r, s):
    return side * (r - s) * 0.70710678, (r + s) * 0.70710678

def engine_features(p):
    """p = dict of fitted model params -> list of (px, engine-local mm, name, weight, acceptance)."""
    rr, rs = RAIL_R0 + p["rail_dr"], RAIL_S0 + p["rail_ds"]
    rlx, rlz = bank_xz(+1, rr, rs); rrx, rrz = bank_xz(-1, rr, rs)
    ax, az = p["alt_x"], p["alt_z"]
    tbz = TB_Z0 + 85 / 2 + p["tb_dz"]
    return [
        ((605, 315), (0.0, Y_INT_C, tbz), "TB bore centre", 1.0, True),
        ((605, 398), (0.0, Y_INT_C, PAD_Z), "carb pad / adapter", 1.0, False),
        ((734, 242), (rlx, Y_BANK_L + RAIL_HALF, rlz), "driver rail rear end", 1.0, True),
        ((759, 630), (rlx, Y_BANK_L - RAIL_HALF, rlz), "driver rail front end", 1.0, True),
        ((487, 242), (rrx, Y_BANK_R + RAIL_HALF, rrz), "pass rail rear end", 1.0, True),
        ((459, 624), (rrx, Y_BANK_R - RAIL_HALF, rrz), "pass rail front end", 1.0, True),
        ((866, 774), (ax, BP - 2, az), "alternator pulley cover", 1.0, True),
        ((790, 715), (ax, BP + 100, az), "alternator body centre", 0.7, False),
        ((434, 761), (-160.0, BP - 2, 190.0), "tensioner pulley", 0.7, False),
        ((606, 817), (0.0, BP + 9, 150.0), "water pump pulley", 0.7, False),
        ((625, 545), (0.0, Y_FRONT + 40, VZ + 70), "fuel pressure regulator (front centre)", 0.7, False),
        ((737, 305), (vin_x, Y_BANK_L + 240, vin_z), "driver VC rear inner-top corner", 0.7, False),
        ((775, 592), (vin_x, Y_BANK_L - 240, vin_z), "driver VC front inner-top corner", 0.7, False),
        ((500, 299), (-vin_x, Y_BANK_R + 240, vin_z), "pass VC rear inner-top corner", 0.7, False),
        ((475, 599), (-vin_x, Y_BANK_R - 240, vin_z), "pass VC front inner-top corner", 0.7, False),
    ]

PNAMES = ["rail_dr", "rail_ds", "alt_x", "alt_z", "tb_dz"]
P0 = {"rail_dr": 0.0, "rail_ds": 0.0, "alt_x": 235.0, "alt_z": 215.0, "tb_dz": 0.0}

def tangent_points(cam_pos):
    pts = []
    for px, x, name, w in TIRES:
        a = np.array([x, AXLE_Y, AXLE_Z]); d = a - np.asarray(cam_pos)
        n = np.array([0.0, d[2], -d[1]]); n /= np.linalg.norm(n)
        if n[2] < 0: n = -n
        pts.append((px, tuple(a + TIRE_R * n), name, w))
    return pts

def project(rvec, cpos, pts):
    R = Rot.from_rotvec(rvec).as_matrix()
    p = (R @ (np.asarray(pts, float) - cpos).T).T
    return np.column_stack([F * p[:, 0] / p[:, 2] + W / 2, F * p[:, 1] / p[:, 2] + H / 2])

def unpack(x):
    return x[0:3], x[3:6], x[6:9], dict(zip(PNAMES, x[9:]))

def all_features(x):
    rvec, cpos, droot, p = unpack(x)
    truck = TRUCK_FIXED + tangent_points(cpos)
    eng = engine_features(p)
    pts = [t[1] for t in truck] + [tuple(np.array(e[1]) / 1000.0 + ROOT0 + droot) for e in eng]
    px = np.array([t[0] for t in truck] + [e[0] for e in eng], float)
    w = np.array([t[3] for t in truck] + [e[3] for e in eng], float)
    names = [t[2] for t in truck] + [e[2] for e in eng]
    acc = [False] * len(truck) + [e[4] for e in eng]
    acc[3] = True     # the iBooster is in the acceptance set
    return rvec, cpos, pts, px, w, names, acc

def residuals(x, weighted=True):
    rvec, cpos, pts, px, w, names, acc = all_features(x)
    r = project(rvec, cpos, pts) - px
    lr, _ = line_resid(rvec, cpos)
    # weak priors keep the free dims near their photo estimates (mm)
    _, _, _, p = unpack(x)
    prior = np.array([p["rail_dr"] / 60, p["rail_ds"] / 60, (p["alt_x"] - 235) / 60, (p["alt_z"] - 215) / 60, p["tb_dz"] / 40])
    droot = x[6:9]
    prior = np.concatenate([prior, droot * 1e4])      # root FIXED at ROOT0 (physical constraints); camera fits the engine
    if weighted: r = r * w[:, None]
    return np.concatenate([r.ravel(), lr, prior])

def lookat_rvec(pos, tgt):
    fwd = np.asarray(tgt, float) - np.asarray(pos, float); fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 0, 1.0]); right /= np.linalg.norm(right); down = np.cross(fwd, right)
    return Rot.from_matrix(np.vstack([right, down, fwd])).as_rotvec()

def blender_euler(rvec):
    R = Rot.from_rotvec(rvec).as_matrix()
    return Rot.from_matrix(R.T @ np.diag([1, -1, -1])).as_euler("xyz")

if __name__ == "__main__":
    best = None
    for pos0, tgt0 in [([0.13, -2.70, 1.56], [0, -1.90, 1.0]), ([0.05, -2.45, 1.80], [0, -1.90, 1.0]), ([0.2, -2.75, 1.4], [0, -1.8, 0.95]), ([0.1, -2.2, 2.1], [0, -1.8, 0.9])]:
        x0 = np.concatenate([lookat_rvec(pos0, tgt0), pos0, [0, 0, 0], [P0[k] for k in PNAMES]])
        lo = np.concatenate([[-np.inf] * 9, [-40, -40, 200, 150, 0]]); hi = np.concatenate([[np.inf] * 9, [40, 40, 300, 280, 120]])
        x0[9:] = np.clip(x0[9:], lo[9:] + 1e-3, hi[9:] - 1e-3)
        r = least_squares(residuals, x0, loss="soft_l1", f_scale=20.0, max_nfev=4000, bounds=(lo, hi))
        if best is None or r.cost < best.cost: best = r
    rvec, cpos, droot, p = unpack(best.x)
    _, _, pts, px, w, names, acc = all_features(best.x)
    err = np.linalg.norm(project(rvec, cpos, pts) - px, axis=1)
    eul = blender_euler(rvec); root = ROOT0 + droot
    print("CAMERA pos", np.round(cpos, 3), "blender rot_euler", np.round(eul, 4), "deg", np.round(np.degrees(eul), 1))
    print("ENGINE ROOT", np.round(root, 3), "(offset from provisional", np.round(droot, 3), ")")
    print("FITTED DIMS", {k: round(v, 1) for k, v in p.items()})
    for n, e, a in zip(names, err, acc): print("  %s %-42s err %5.1f px %s" % ("ACC" if a else "   ", n, e, "" if e <= 24 or not a else "<-- over 2%"))
    lr, lnames = line_resid(rvec, cpos)
    for n, e in zip(lnames, lr): print("      line %-42s off %5.1f px (weighted)" % (n, e))
    accerr = [e for e, a in zip(err, acc) if a]
    print("ACCEPTANCE set: max %.1f px, RMS %.1f px (limit 24 px = 2%% of 1200)" % (max(accerr), np.sqrt(np.mean(np.square(accerr)))))
    out = {"camera": {"location": [float(v) for v in cpos], "rotation_euler": [float(v) for v in eul], "lens_mm": 24, "sensor_width_mm": 34.6, "res": [W, H]},
           "engine_root": {"x": float(root[0]), "y": float(root[1]), "z": float(root[2])},
           "fitted_dims_mm": {k: float(v) for k, v in p.items()},
           "features": [{"px": [float(v) for v in q], "name": n, "err_px": float(e), "acceptance": bool(a)} for q, n, e, a in zip(px, names, err, acc)],
           "acceptance": {"max_px": float(max(accerr)), "rms_px": float(np.sqrt(np.mean(np.square(accerr)))), "limit_px": 24},
           "method": "joint least-squares (soft_l1, f_scale 20 px) of camera pose, engine root and 5 photo-scaled model dims on 6 truck + 15 engine features; f=830 px at 1200x900 from the 24 mm-equivalent EXIF"}
    pth = os.path.join(os.path.dirname(os.path.abspath(__file__)), "photo_match_IMG6531.json")
    json.dump(out, open(pth, "w"), indent=1); print("wrote", pth)
