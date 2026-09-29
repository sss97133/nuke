#!/usr/bin/env python3
"""K5 harness in CAD (v4), the data half: parts placed, looms sized from their member wires, routes filleted to
the cited bend radius, clamps spaced, rule checks run. Plain Python (numpy + PyYAML); Blender reads its output.

    python3 docs/wiring/twin/harness_cad.py [--mesh-dir <dir of exported twin meshes>] [--scope sample|all]

Writes docs/wiring/calc-data/cad/scene_v4.json (geometry for build_harness_v4.py) and routes.yaml / parts.yaml
(the audit lists). Twin axes: metres, +x = driver, -y = front, +z = up (Steering_Wheel x +0.26..+0.67).

Every route here is a PROPOSAL for the owner and the builder to confirm (.claude/rules/wiring-receipt.md: the agent
may not decide a wire's physical route on the truck). Every number carries its source or says it is not sourced.
"""
import argparse, json, math, os, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import yaml

REPO = Path(__file__).resolve().parents[3]
CAD = REPO / "docs/wiring/calc-data/cad"
REG_PATH = REPO / "docs/wiring/calc-data/k5_registry.json"

MM = 0.001
IN = 0.0254

# ------------------------------------------------------------------------------------------------ sources
S = {
    "od16": "ProWire M22759/16 page, Nom. Diameter column (reference_documents/web_snapshots/www.prowireusa.com__m22759-16-tefzel-wire.md, fetched 2026-09-27)",
    "od32": "ProWire M22759/32 page, Nom. Diameter column (reference_documents/web_snapshots/www.prowireusa.com__m22759-32-tefzel-wire.md, fetched 2026-09-27)",
    "pack": "scripts/k5_harness_calc.py lines 73 and 233: bundle OD = sqrt(sum(d^2) / 0.65), BUNDLE_FILL 0.65 ('standard round-bundle packing approximation (engine-introduced; no doctrine rule exists - rules_extracted.md s11)')",
    "dr25": "docs/wiring/chapters/16-wire-and-protection-canon.md s6.7 (TE/Raychem DR-25 catalog 1654025: as-supplied min ID, recovered max ID, recovered wall) and s7 selection rule 'order the largest size that will shrink snugly'",
    "bend": "FAA AC 43.13-1B CHG 1, par. 11-96 aa (p.11-44/45): bundle bend radius >= 10 x OD of the largest wire or cable; 3 x OD where the wire is supported at a break-out or termination (faa.gov PDF, fetched 2026-09-29)",
    "loop": "FAA AC 43.13-1B CHG 1, par. 11-137 b(2) (p.11-56): a service loop keeps a bend radius >= 3 x the harness diameter; length allowance 12 in (scripts/k5_harness_calc.py line 59 SERVICE_LOOP_IN, from scripts/compute_wire_lengths.py)",
    "clamp": "ABYC E-11: supported at intervals not exceeding 18 in (455 mm); tighten to ~12 in near the exhaust and at direction changes (docs/wiring/research/2026-06-10_power_spine_builders_study.md s1.3). FAA AC 43.13-1B par. 11-146 (p.11-57): MS-21919 cushioned clamps, <= 24 in",
    "heat": "nuke_frontend/src/components/wiring/objectTraits.ts (Under_Engine_Simple notes): headers reach 800 F+, wires need 1 in clearance + DR-25 when crossing; spine study s1.4 item 4: reflective heat sleeve within a few inches of the manifold",
    "under": "spine study s1.2: 'the under-engine shortcut is forbidden territory (heat + moving parts)'",
    "svc": "chapters/17-power-architecture-ecu-pdm.md s17.8.6 and spine study s1.4 item 5: every cable landing on the engine crosses the chassis-to-engine gap with a service loop",
    "fw": "owner calls 2026-09-29 (receipts/2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md, state row 0ah): only the 61-pin crosses the firewall, at the fuse-box hole; the cab power box's 2 AWG feed and ground at H3 is the one exception under review",
    "frame": "spine study s1.2 frame doctrine (rear-bound runs on the frame rail); objectTraits.ts Under_Frame_Blazer notes",
}

# ------------------------------------------------------------------------------------------------ wire ODs
OD16 = {24: 1.1, 22: 1.3, 20: 1.5, 18: 1.8, 16: 2.0, 14: 2.3, 12: 2.89, 10: 3.53, 8: 5.05, 6: 6.35, 4: 7.92,
        2: 9.85, 1: 10.9, 0: 12.1}
OD32 = {22: 1.09, 20: 1.27, 18: 1.52, 16: 1.73, 14: 2.16, 12: 2.62}
BUNDLE_FILL = 0.65
DR25 = [  # size, as-supplied min ID, recovered max ID, recovered wall (mm) — canon ch.16 s6.7
    ("1/8", 3.2, 1.6, 0.76), ("3/16", 4.8, 2.4, 0.84), ("1/4", 6.4, 3.2, 0.89), ("3/8", 9.5, 4.8, 1.02),
    ("1/2", 12.7, 6.4, 1.22), ("3/4", 19.0, 9.5, 1.45), ("1", 25.4, 12.7, 1.78), ("1-1/2", 38.0, 19.0, 2.41),
    ("2", 51.0, 25.4, 2.79)]


def wire_od(w):
    """(od_mm, basis, unknown) for one registry wire; a shielded pair is handled by cable grouping."""
    spec = (w.get("spec") or "").upper()
    awg = w.get("awg")
    if "M27500" in spec:
        # M27500 2-conductor shielded jacketed cable: no published OD in the substrate
        # (www.wiremasters.com__m27500-22tg2t14.md lists construction, not diameter). Working value = two 22 AWG
        # M22759/16 conductors side by side (2 x 1.3 mm, ProWire) — a floor that leaves out shield and jacket.
        return 2 * OD16[22], "not sourced: M27500 2C OD; drawn at 2 x 1.3 mm (two /16-22 conductors, ProWire), shield and jacket left out", True
    if "/32" in spec and awg in OD32:
        return OD32[awg], S["od32"], False
    if awg in OD16:
        return OD16[awg], S["od16"], False
    return OD16.get(22), f"not sourced: spec {spec!r} awg {awg}; drawn at the /16-22 OD", True


def cables_of(wids, W):
    """Group wire ids into physical cables: the two conductors of an M27500 pair (e.g. 99 + 99g) are one cable."""
    seen, out = set(), []
    for wid in wids:
        if wid in seen:
            continue
        w = W[wid]
        if "M27500" in (w.get("spec") or "").upper():
            base = wid[:-1] if wid.endswith("g") else wid
            pair = [x for x in (base, base + "g") if x in W]
            for x in pair:
                seen.add(x)
            od, basis, unk = wire_od(w)
            out.append({"wires": pair, "od_mm": od, "basis": basis, "unknown": unk, "kind": "shielded pair"})
        else:
            seen.add(wid)
            od, basis, unk = wire_od(w)
            out.append({"wires": [wid], "od_mm": od, "basis": basis, "unknown": unk,
                        "kind": f"{w.get('awg')} AWG {w.get('spec')}"})
    return out


def bundle_od(cables):
    if not cables:
        return 0.0
    if len(cables) == 1:
        return cables[0]["od_mm"]
    return math.sqrt(sum(c["od_mm"] ** 2 for c in cables) / BUNDLE_FILL)


def dr25_for(d):
    """Largest DR-25 size that still shrinks snugly (recovered max ID <= d) and slips on (as-supplied >= d)."""
    fit = [s for s in DR25 if s[2] <= d <= s[1]]
    if not fit:
        return None
    s = fit[-1]
    return {"size": s[0], "supplied_min_id_mm": s[1], "recovered_max_id_mm": s[2], "wall_mm": s[3],
            "jacketed_od_mm": round(d + 2 * s[3], 2)}


# ------------------------------------------------------------------------------------------------ geometry
def v(*a):
    return np.array(a, dtype=float)


def unit(a):
    n = np.linalg.norm(a)
    return a / n if n > 1e-12 else a


def fillet(pts, rreq, rreq_end=None, end_zone=0.150, n_arc=10):
    """Round every interior corner of a polyline with an arc. rreq: required radius in open run; rreq_end: at a
    corner within end_zone of either end (AC 43.13-1B 11-96 aa allows 3 x OD at a supported termination).
    Returns (points, bends[{at, angle_deg, r_req, r_eff}])."""
    P = [v(*p) for p in pts]
    if len(P) < 3:
        return [p.tolist() for p in P], []
    seg = [np.linalg.norm(P[i + 1] - P[i]) for i in range(len(P) - 1)]
    cum = np.concatenate([[0], np.cumsum(seg)])
    total = cum[-1]
    # wanted tangent length per corner, then share each segment between its two corners in proportion
    th_all, R_all, near_all, t_want = {}, {}, {}, {}
    for i in range(1, len(P) - 1):
        u = unit(P[i] - P[i - 1]); w = unit(P[i + 1] - P[i])
        th = math.acos(float(np.clip(np.dot(u, w), -1, 1)))
        near = min(cum[i], total - cum[i]) < end_zone
        R = (rreq_end if (near and rreq_end) else rreq)
        th_all[i], R_all[i], near_all[i] = th, R, near
        t_want[i] = R * math.tan(th / 2) if th >= math.radians(2) else 0.0
    t_ok = dict(t_want)
    for k in range(len(seg)):
        a, b = k, k + 1           # corners at the two ends of segment k (0 and len(P)-1 are path ends)
        need = t_ok.get(a, 0.0) + t_ok.get(b, 0.0)
        if need > 0.98 * seg[k]:
            f = 0.98 * seg[k] / need
            if a in t_ok: t_ok[a] *= f
            if b in t_ok: t_ok[b] *= f
    out = [P[0]]
    bends = []
    for i in range(1, len(P) - 1):
        u = unit(P[i] - P[i - 1]); w = unit(P[i + 1] - P[i])
        th, R, near_end = th_all[i], R_all[i], near_all[i]
        if th < math.radians(2):
            out.append(P[i]); continue
        t = t_ok[i]
        r_eff = t / math.tan(th / 2)
        a = P[i] - u * t; b = P[i] + w * t
        bis = unit(w - u)
        C = P[i] + bis * (r_eff / math.cos(th / 2))
        ra, rb = a - C, b - C
        ax = unit(np.cross(ra, rb))
        ang = math.acos(float(np.clip(np.dot(unit(ra), unit(rb)), -1, 1)))
        for k in range(n_arc + 1):
            f = k / n_arc
            # Rodrigues rotation of ra about ax by f*ang
            q = f * ang
            rv = ra * math.cos(q) + np.cross(ax, ra) * math.sin(q) + ax * np.dot(ax, ra) * (1 - math.cos(q))
            out.append(C + rv)
        bends.append({"at": [round(float(x), 4) for x in P[i]], "angle_deg": round(math.degrees(th), 1),
                      "r_req_mm": round(R / MM, 1), "r_eff_mm": round(r_eff / MM, 1), "near_end": bool(near_end)})
    out.append(P[-1])
    # drop coincident points
    clean = [out[0]]
    for p in out[1:]:
        if np.linalg.norm(p - clean[-1]) > 1e-5:
            clean.append(p)
    return [p.tolist() for p in clean], bends


def path_len(pts):
    P = np.array(pts)
    return float(np.sum(np.linalg.norm(P[1:] - P[:-1], axis=1)))


def resample(pts, step=0.01):
    P = np.array(pts)
    d = np.linalg.norm(P[1:] - P[:-1], axis=1)
    s = np.concatenate([[0], np.cumsum(d)])
    n = max(2, int(s[-1] / step) + 1)
    ss = np.linspace(0, s[-1], n)
    out = np.stack([np.interp(ss, s, P[:, k]) for k in range(3)], axis=1)
    return out, ss


def offset_pair(pts, sep, up=(0, 0, 1)):
    """Two parallel copies of a path, +-sep/2 along a parallel-transported side vector (equal-length pair)."""
    P = np.array(pts)
    T = np.gradient(P, axis=0)
    T = np.array([unit(t) for t in T])
    side = np.cross(T[0], v(*up))
    if np.linalg.norm(side) < 1e-6:
        side = np.cross(T[0], v(1, 0, 0))
    side = unit(side)
    sides = [side]
    for i in range(1, len(P)):
        s = sides[-1] - T[i] * np.dot(sides[-1], T[i])
        sides.append(unit(s) if np.linalg.norm(s) > 1e-9 else sides[-1])
    sides = np.array(sides)
    return (P + sides * sep / 2).tolist(), (P - sides * sep / 2).tolist()


# ------------------------------------------------------------------------------------------------ twin obstacles
class Obstacles:
    """Point clouds of the twin's exhaust (v3 engine, docs/wiring/twin/build_engine_v3.py) for clearance checks."""
    EXH = ["E3_Header_L_1", "E3_Header_L_3", "E3_Header_L_5", "E3_Header_L_7", "E3_Header_R_2", "E3_Header_R_4",
           "E3_Header_R_6", "E3_Header_R_8", "E3_Collector_L", "E3_Collector_R", "E3_Exhaust_Tail_L", "E3_Exhaust_Tail_R",
           "E3_ExhFlange_L_1", "E3_ExhFlange_L_3", "E3_ExhFlange_L_5", "E3_ExhFlange_L_7", "E3_ExhFlange_R_2",
           "E3_ExhFlange_R_4", "E3_ExhFlange_R_6", "E3_ExhFlange_R_8"]

    def __init__(self, mesh_dir):
        self.ok = False
        pts = []
        if mesh_dir and os.path.isdir(mesh_dir):
            for n in self.EXH:
                f = os.path.join(mesh_dir, n + ".npz")
                if os.path.exists(f):
                    d = np.load(f)
                    V, T = d["V"], d["T"]
                    # dense surface samples: vertices + triangle centroids + edge midpoints
                    tri = V[T]
                    pts += [V, tri.mean(axis=1), (tri[:, 0] + tri[:, 1]) / 2, (tri[:, 1] + tri[:, 2]) / 2, (tri[:, 2] + tri[:, 0]) / 2]
            if pts:
                self.exh = np.concatenate(pts)
                self.ok = True

    def exhaust_clearance(self, path_pts, radius_m):
        """Minimum distance from the cable surface to the exhaust surface samples (m), and where."""
        if not self.ok:
            return None, None
        P, _ = resample(path_pts, 0.005)
        best, where = 1e9, None
        for i in range(0, len(P), 64):
            chunk = P[i:i + 64]
            d = np.linalg.norm(chunk[:, None, :] - self.exh[None, :, :], axis=2)
            j = np.unravel_index(np.argmin(d), d.shape)
            if d[j] < best:
                best, where = float(d[j]), chunk[j[0]].tolist()
        return best - radius_m, where


# ------------------------------------------------------------------------------------------------ the firewall
# Vertical face of the twin firewall (Under_Main_Blazer), z 0.90..1.25, sampled by plane sections 2026-09-29
# (harness-cad probe: dominant y per x section). |x| -> y. The centre is recessed (tunnel/cowl), the sides flat.
FW_FACE = [(0.00, -1.375), (0.05, -1.380), (0.10, -1.384), (0.15, -1.411), (0.175, -1.454), (0.20, -1.462),
           (0.25, -1.466), (0.35, -1.466), (0.50, -1.458), (0.60, -1.458), (0.76, -1.467)]


def y_fw(x):
    xs, ys = zip(*FW_FACE)
    return float(np.interp(abs(x), xs, ys))


FB = {"x": 0.50, "z": 0.90, "d_in": 4.0,
      "src": "objectTraits.ts Exterior_Body_Blazer factory_holes FB [+0.50, -1.00, 0.90], 4.0 in: x and z kept; y moved onto the v3 firewall face (the trait's y -1.00 is the dash face in v3)"}
FAN = {"c": (0.0, None, 0.95), "r": 16 * IN / 2, "y0": -2.382, "y1": -2.382 + 3.10 * IN}
BELT = {"lo": (-0.320, -2.160, 0.620), "hi": (0.300, -2.110, 1.045)}
INTAKE = {"hx": 0.18, "y0": -1.95, "y1": -1.50, "z": 0.98}
S["fan"] = ("fan: SPAL 30107090 16 in, 3.10 in thick (footprints.py, web_snapshots kartek spal-30107090 page); on the engine side of the radiator core "
            "(mounts.yaml FAN), centred on the twin radiator K5H_Radiator (x 0, z 0.95, rear face y -2.382); 25 mm clearance: critic's rule 2026-09-29, recorded here as a design rule, not a standard")
S["belt"] = ("accessory-drive envelope: union of the twin's E3_Belt, E3_*Pulley, E3_Damper, E3_Idler, E3_Tensioner boxes (docs/wiring/twin/build_engine_v3.py; "
             "Holley mid-mount 199R11485 layout) = x -0.320..0.300, y -2.160..-2.110, z 0.620..1.045; 25 mm clearance: critic's rule 2026-09-29")
S["intake"] = "critic's rule 2026-09-29 (no DC cable over the intake): intake footprint |x| < 0.18, y -1.95..-1.50, above z 0.98 (twin E3_Intake_*, E3_FuelRail_*)"
H3 = {"x": -0.35, "z": 0.90, "d_in": 1.5,
      "src": "objectTraits.ts factory_holes H3 [-0.35, -1.02, 0.90], 1.5 in, 'A/C + ECU (passenger)': x and z kept; y moved onto the v3 firewall face"}

# ------------------------------------------------------------------------------------------------ parts
PARTS = []


def part(**k):
    PARTS.append(k)
    return k


def build_sample_parts():
    yf = y_fw(FB["x"])
    plate_t = 0.125 * IN; gasket_t = 1.5 * MM
    part(id="FW61-PLATE", endpoint="FIREWALL-ENGINE", kind="plate", size_mm=[135, 3.175, 135],
         centre=[FB["x"], yf - gasket_t - plate_t / 2, FB["z"]], hole_d_mm=44.7, hole_flat_mm=43.4,
         bolt_offset_mm=54.5, bolt_d_mm=6.6, corner_r_mm=10.0,
         colour="#b9bcbf", colour_basis="5052-H32 aluminium (fw61_adapter_plate.py THICK note), drawn as bare aluminium",
         sources=["docs/wiring/calc-data/cad/fab/fw61_adapter_plate.py (parts lane, branch wiring/cad-fw61-plate): SIDE 135 mm, THICK 1/8 in, cutout 1.760 in with a 1.710 in flat (Milnec TX37 shell 25), M6 holes 13 mm from the edge, gasket 1.5 mm",
                  FB["src"]],
         status="decided (owner 2026-09-29: the 61-pin at the original fuse-box hole on a CNC'd plate)", model="stand-in (parts lane CAD parameters)")
    y0 = yf - gasket_t - plate_t
    part(id="FIREWALL-ENGINE", endpoint="FIREWALL-ENGINE", kind="stack", axis=[0, -1, 0], base=[FB["x"], y0, FB["z"]],
         segments=[
             [4.0, 55.6, "jam-nut end W = 2.189 in across (Milnec TX37 via fw61_adapter_plate.py); thickness not sourced, drawn 4 mm"],
             [20.0, 46.0, "receptacle front body: rear flange K = 1.812 in (Milnec TX37); protrusion not sourced, drawn 20 mm"],
             [35.0, 46.99, "D38999/26WJ61PN plug: coupling OD taken as the M85049/69-25 adapter max A 46.99 mm; plug length not sourced, drawn 35 mm"],
             [18.03, 46.99, "M85049/69-25 shrink-boot adapter: A max 46.99 mm, length 0.71 in max (web_snapshots/www.amphenolpcd.com__M85049_69-Shrink-Boot.md)"],
             [40.0, 36.65, "Raychem 202K163-25-0 boot: from the adapter's C max 36.65 mm down to the loom; boot length not sourced, drawn 40 mm"],
         ],
         colour="#5b5d3f", colour_basis="finish letter W = cadmium olive drab (letter key on the Amphenol M85049/69 sheet; the D38999 class table is not in the substrate)",
         sources=["registry endpoint FIREWALL-ENGINE: D38999/26WJ61PN plug, engine loom side (pins)",
                  "K5_WIRING_STATE.md s1 row 43 (D38999/24WJ61SN + /26WJ61PN, insert 25-61)"],
         status="decided", model="dashed (plug and receptacle lengths not sourced)")
    part(id="FIREWALL-CABIN", endpoint="FIREWALL-CABIN", kind="stack", axis=[0, 1, 0], base=[FB["x"], yf, FB["z"]],
         segments=[[25.0, 46.0, "D38999/24WJ61SN receptacle rear (wire side) in the cab; rear flange K 46.0 mm (Milnec TX37); length not sourced, drawn 25 mm"]],
         colour="#5b5d3f", colour_basis="as FIREWALL-ENGINE", sources=["registry endpoint FIREWALL-CABIN"],
         status="decided", model="dashed (length not sourced)")
    for pid, x, dims, cols, name, src, cbasis in (
            ("ODYSSEY", -0.60, (7.09, 10.86, 7.88), {"case": "#2b2b2d"}, "Odyssey 34/78-PC1500DT, the running battery",
             "web_snapshots/batterysales.com__34-78-pc1500dt-odyssey.md: 10.86 x 7.09 x 7.88 in (L x W x H), SAE post and GM side terminals",
             "not read: the maker's photo only opens in a browser (colors.py skip list); drawn neutral charcoal"),
            ("ACC-BATT", 0.60, (6.94, 10.06, 7.88), {"case": "#92a5a9", "top": "#cf8c2a"}, "Optima YellowTop D34/78, the accessory battery",
             "web_snapshots/batterysales.com__d34-78-8014-045-optima.md: 10.06 x 6.94 x 7.88 in",
             "Clarios product photo k-means (colors.json): grey case #92a5a9, yellow top #cf8c2a")):
        dx, dy, dz = (d * IN for d in dims)
        zb = 1.01
        sx = 1 if x > 0 else -1
        xin = x - sx * (dx / 2 - 0.022)
        yfront = -2.300 - dy / 2
        part(id=pid, endpoint=pid, kind="battery", size_mm=[round(dx / MM, 1), round(dy / MM, 1), round(dz / MM, 1)],
             centre=[x, -2.300, round(zb + dz / 2, 4)], colours=cols, colour_basis=cbasis, what=name,
             posts={"pos": [round(xin, 4), round(yfront + 0.045, 4), round(zb + dz, 4)],
                    "neg": [round(xin, 4), round(yfront + dy - 0.045, 4), round(zb + dz, 4)]},
             post_size_mm={"d": 17.5, "h": 19.0, "basis": "not sourced: SAE posts drawn 17.5 mm x 19 mm tall"},
             sources=[src, "1977 Light Truck Service Manual p.122: 'battery (right side or auxiliary left side)'; 'place battery tray in position and fasten to radiator support'",
                      "main lane 2026-09-29: batteries at GM's spots, Odyssey right tray, YellowTop left auxiliary (PROPOSED)"],
             status="proposed (the battery corner is an open owner call, mounts.yaml BATTERIES)",
             notes="long side fore-aft and the post layout are drawn, not decided; tray height not published: drawn with the bottom at z 1.01; the twin's wheelhouse dome still rises ~20 mm into the outboard-rear corner (x -0.69, dome z ~1.03), a front-clip margin symptom (tape T-11)",
             model="stand-in")
    part(id="ISOLATOR", endpoint="ISOLATOR", kind="isolator", size_mm=[95.25, 51.56, 138.94],
         centre=[-0.43, -2.455 + 0.05156 / 2, 1.000 + 0.13894 / 2],
         studs={"A": [round(-0.43 - 0.02413, 4), round(-2.455 + 0.02616, 4), 1.000], "B": [round(-0.43 + 0.02413, 4), round(-2.455 + 0.02616, 4), 1.000],
                "len_mm": 22.23, "d_mm": 9.525, "dir": [0, 0, -1]},
         colour="#464144", colour_basis="Blue Sea product photo k-means (dh778tpvmt77t.cloudfront.net/images/products/7700.jpg): body #464144",
         sources=["Blue Sea dimension drawing 7700_7702_7622_7623.jpg (bluesea.com, fetched 2026-09-29): 3.750 x 5.470 x 2.030 in; two studs at the bottom, 1.900 in apart, 1.030 in off the mounting face",
                  "web_snapshots/www.bluesea.com__ML-RBS_Remote_Battery_Switch_with_Manual_Control_-_12V_DC_500A.md: 3/8-16 studs, 0.875 in long",
                  "mounts.yaml ISOLATOR: engine bay, on the Odyssey's positive cable as close to the battery as it fits"],
         status="decided part (state s1 row 57); spot proposed", model="stand-in")
    part(id="PDM15-A", endpoint="PDM15-A", kind="box", size_mm=[60, 180, 28], centre=[-0.68, -1.90, 1.075],
         what="Engine power box, drawn as the proposed sealed MoTeC PDM32 (180 x 60 x 28 mm); the registry still lists a PDM15 (107 x 133 x 39 mm, unsealed)",
         colour="#2a2929", colour_basis="PDM32 colour not read (machined aluminium case per the manual); drawn MoTeC-dark like the PDM15 photo #2a2929",
         sources=["MoTeC PDM user manual p.35 (library text component_drawings__motec_pdm_user_manual/page-0038.txt): PDM32 length 180, width 60, height 28 mm; machined aluminium; rubber seal on lid and connectors",
                  "mounts.yaml PDM15 (flag: unsealed case in the bay); state row 0ah (sealed bay PDM32 candidate for the front loads)",
                  "main lane 2026-09-29: sealed bay PDM on the passenger inner fender, PROPOSED"],
         status="proposed (the PDM model is an open owner/Dave call)", model="stand-in",
         notes="PDM32 battery input is a 1-pin Autosport for #6 or #4 AWG (manual p.42, #68093/#68094): the 2 AWG PDM15_BPOS cable does not fit it")
    part(id="PS-STUDS", endpoint="PS-STUDS", kind="box", size_mm=[60, 120, 50], centre=[-0.48, -2.08, 1.04],
         what="Distribution stud with the MEGA 200 / 125 / 100 and MIDI 40 holders",
         colour="#d23b2f", colour_basis="Dave's red covered two-stud block (state row 0i photo evidence); holder colours not read",
         sources=["registry PS-STUDS; cable_decisions.json fuses (MEGA 200 #59, MEGA 125 PDM_BPOS, MEGA 100 PDM15_BPOS, MIDI 40 #52)", "state row 0i (Blue Sea 2019 match, 2 x 3/8 in studs)"],
         status="open (mounts.yaml PS-STUDS)", model="dashed (size not sourced)")
    part(id="GND-BANK-ENG", endpoint="GND-BANK-ENG", kind="box", size_mm=[50, 100, 40], centre=[-0.48, -2.06, 0.915],
         what="Engine ground star: both battery negatives, block G1, frame G2, bay returns", colour="#1c1c1c", colour_basis="not read",
         sources=["registry GND-BANK-ENG; state s1 row 56 (grounds run in the loom to banks)"], status="open", model="dashed (size not sourced)")
    part(id="IBOOSTER", endpoint="IBOOSTER", kind="box", size_mm=[190, 240, 260], centre=[0.40, -1.52, 1.05],
         what="Bosch iBooster Gen 2 on the driver firewall (twin v2 object K5H_iBooster)", colour="#878275",
         colour_basis="EVcreate photo of a 1037123-00-B (footprints.py)",
         sources=["twin object K5H_iBooster box x 0.305..0.495, y -1.64..-1.40, z 0.92..1.18 (v2, the unit's own size not read)", "state s4: installed on the driver firewall factory pad"],
         status="decided (installed)", model="dashed (size not read: twin v2 box)")
    part(id="FIREWALL-GROMMET", endpoint="FIREWALL-GROMMET", kind="ring", size_mm=[38.1, 6, 38.1],
         centre=[H3["x"], y_fw(H3["x"]), H3["z"]], what="Factory hole H3 (passenger): the exception under review for the cab power box's 2 AWG feed and ground",
         colour="#f2c318", colour_basis="marker colour (not a part colour)", sources=[H3["src"], S["fw"]],
         status="exception under review", model="marker")


# ------------------------------------------------------------------------------------------------ routes
ROUTES = []


def route(**k):
    ROUTES.append(k)
    return k


def build_sample_routes(reg):
    W = {w["id"]: w for w in reg["wires"] + reg["implied"]}
    E = reg["endpoints"]
    fe = E["FIREWALL-ENGINE"]["wires"]
    drains = [w for w in fe if w.endswith("s")]

    def mem(*devs):
        out = []
        for d in devs:
            out += [w for w in E[d]["wires"] if w in fe]
        return out

    ids = {"coils": {i: mem(f"COIL-{i}") for i in range(1, 9)}, "inj": {i: mem(f"INJ-{i}") for i in range(1, 9)},
           "TB": mem("TB"), "MAP": mem("MAP"), "IAT": mem("IAT"), "CLT": mem("CLT-ECU"), "CMP": mem("CMP"),
           "CKP": mem("CKP"), "K1": mem("KNOCK-1"), "K2": mem("KNOCK-2"), "OILP": mem("OILP-ECU"),
           "DOILP": mem("DAK-OILP"), "DCTS": mem("DAK-CTS"), "FUELP": mem("FUELP"), "CAN": mem("PDM15-B"),
           "FAN": mem("FAN"), "OILT": mem("OILT")}
    L = "engine"
    yf = y_fw(FB["x"])
    stack_len = (1.5 + 3.175 + 4 + 20 + 35 + 18.03 + 40) * MM
    E0 = [FB["x"], round(yf - stack_len, 4), FB["z"]]
    H0 = [0.0, -1.515, 1.140]
    trunk = [w for w in fe if w not in drains]
    route(id="ENG-T0", loom=L, kind="trunk", members=trunk, frm="FIREWALL-ENGINE (61-pin boot)", to="hub over the coils",
          pts=[E0, [0.470, -1.590, 0.930], [0.400, -1.535, 1.020], [0.250, -1.515, 1.130], H0],
          why="along the firewall from the 61-pin to the back of the intake. It runs straight through the twin iBooster box: a flagged conflict (FB from objectTraits, iBooster a v2 box), re-check with the booster model and tapes T-02/T-03",
          fixed_to="firewall", fw_idx=[0, 1, 2], conflict="IBOOSTER")
    comb_c = [0.0, -1.510, 1.118]
    cxy = {1: (-0.097, -1.556), 2: (-0.032, -1.556), 3: (0.032, -1.556), 4: (0.097, -1.556),
           5: (-0.097, -1.464), 6: (-0.032, -1.464), 7: (0.032, -1.464), 8: (0.097, -1.464)}
    route(id="ENG-COILS", loom=L, kind="branch", members=sum((ids["coils"][i] for i in range(1, 9)), []), frm="hub", to="coil comb",
          pts=[H0, comb_c], fixed_to="coil bracket")
    for side, xe in (("P", -0.110), ("D", 0.110)):
        sel = [i for i in range(1, 9) if (cxy[i][0] < 0) == (side == "P")]
        route(id=f"ENG-COMB-{side}", loom=L, kind="branch", members=sum((ids["coils"][i] for i in sel), []), frm="coil comb",
              to=f"coil comb {'passenger' if side == 'P' else 'driver'} end", pts=[comb_c, [xe, -1.510, 1.118]], fixed_to="coil bracket")
    for i in range(1, 9):
        cx, cy = cxy[i]
        face = -1.5165 if cy < -1.5 else -1.5035
        route(id=f"ENG-COIL-{i}", loom=L, kind="drop", members=ids["coils"][i], frm="coil comb", to=f"COIL-{i}",
              pts=[[cx, -1.510, 1.118], [cx, (face - 1.510) / 2, 1.085], [cx, face + (-0.004 if cy < -1.5 else 0.004), 1.050]], fixed_to="coil")
    route(id="ENG-MAP", loom=L, kind="branch", members=ids["MAP"], frm="hub", to="MAP", pts=[H0, [0.09, -1.508, 1.160], [0.140, -1.500, 1.160]],
          fixed_to="MAP bracket")
    route(id="ENG-OILP", loom=L, kind="branch", members=ids["OILP"] + ids["DOILP"], frm="hub", to="oil pressure pair",
          pts=[H0, [0.05, -1.440, 1.125], [0.05, -1.440, 1.005]], fixed_to="rear of the block")
    route(id="ENG-OILP-ECU", loom=L, kind="drop", members=ids["OILP"], frm="oil pressure pair", to="OILP-ECU",
          pts=[[0.05, -1.440, 1.005], [0.025, -1.470, 0.990]], fixed_to="sensor")
    route(id="ENG-DAK-OILP", loom=L, kind="drop", members=ids["DOILP"], frm="oil pressure pair", to="DAK-OILP",
          pts=[[0.05, -1.440, 1.005], [0.075, -1.480, 0.990]], fixed_to="sensor")
    PB = [-0.10, -1.505, 1.132]
    pbm = sum((ids["inj"][i] for i in (2, 4, 6, 8)), []) + ids["TB"]
    route(id="ENG-P", loom=L, kind="branch", members=pbm + ids["CAN"], frm="hub", to="passenger rail start", pts=[H0, PB], fixed_to="intake")
    route(id="ENG-PRAIL", loom=L, kind="branch", members=pbm, frm="passenger rail start", to="passenger rail front",
          pts=[PB, [-0.185, -1.530, 1.114], [-0.185, -1.700, 1.114], [-0.185, -1.890, 1.114]], fixed_to="passenger fuel rail")
    for i, y in ((8, -1.540), (6, -1.6518), (4, -1.7635), (2, -1.8753)):
        route(id=f"ENG-INJ-{i}", loom=L, kind="drop", members=ids["inj"][i], frm="passenger rail", to=f"INJ-{i}",
              pts=[[-0.185, y, 1.114], [-0.178, y, 1.085], [-0.172, y, 1.065]], fixed_to="injector")
    route(id="ENG-TB", loom=L, kind="drop", members=ids["TB"], frm="passenger rail", to="TB",
          pts=[[-0.185, -1.700, 1.114], [-0.150, -1.700, 1.150], [-0.115, -1.700, 1.148]], fixed_to="throttle body")
    route(id="ENG-CAN", loom=L, kind="branch", members=ids["CAN"], frm="passenger rail start", to="PDM15-B (engine power box)",
          pts=[PB, [-0.30, -1.500, 1.200], [-0.55, -1.520, 1.200], [-0.66, -1.620, 1.140], [-0.68, -1.790, 1.090], [-0.68, -1.812, 1.076]],
          fixed_to="cowl lip, passenger inner fender", fw_idx=[1, 2])
    PR0 = [-0.155, -1.440, 1.090]
    route(id="ENG-PREAR", loom=L, kind="branch", members=ids["DCTS"] + ids["CKP"] + ids["K2"] + ids["OILT"], frm="hub", to="passenger rear drop",
          pts=[H0, [-0.10, -1.475, 1.130], PR0, [-0.155, -1.440, 0.860]], fixed_to="rear of the passenger head")
    route(id="ENG-DAK-CTS", loom=L, kind="drop", members=ids["DCTS"], frm="passenger rear drop", to="DAK-CTS",
          pts=[[-0.155, -1.440, 0.860], [-0.24, -1.437, 0.845], [-0.279, -1.440, 0.840]], fixed_to="sender")
    route(id="ENG-PREAR-LOW", loom=L, kind="branch", members=ids["CKP"] + ids["K2"] + ids["OILT"], frm="passenger rear drop", to="block side (passenger)",
          pts=[[-0.155, -1.440, 0.860], [-0.162, -1.445, 0.790], [-0.168, -1.495, 0.780]], fixed_to="block")
    route(id="ENG-CKP", loom=L, kind="drop", members=ids["CKP"], frm="block side (passenger)", to="CKP",
          pts=[[-0.168, -1.495, 0.780], [-0.164, -1.495, 0.760]], fixed_to="sensor")
    route(id="ENG-PSIDE", loom=L, kind="branch", members=ids["K2"] + ids["OILT"], frm="block side (passenger)", to="knock 2 / oil temp split",
          pts=[[-0.168, -1.495, 0.780], [-0.168, -1.655, 0.778]], fixed_to="block side")
    route(id="ENG-KNOCK-2", loom=L, kind="drop", members=ids["K2"], frm="knock 2 / oil temp split", to="KNOCK-2",
          pts=[[-0.168, -1.655, 0.778], [-0.168, -1.690, 0.778], [-0.160, -1.705, 0.767]], fixed_to="block side")
    route(id="ENG-OILT", loom=L, kind="drop", members=ids["OILT"], frm="knock 2 / oil temp split", to="OILT (oil level and temperature sensor in the pan)",
          pts=[[-0.168, -1.655, 0.778], [-0.176, -1.662, 0.700], [-0.176, -1.670, 0.640], [-0.170, -1.670, 0.622]], fixed_to="block side, pan rail")
    route(id="ENG-DREAR", loom=L, kind="branch", members=ids["K1"], frm="hub", to="KNOCK-1",
          pts=[H0, [0.10, -1.475, 1.130], [0.155, -1.442, 1.090], [0.155, -1.442, 0.800], [0.168, -1.600, 0.780], [0.168, -1.690, 0.778], [0.160, -1.705, 0.767]],
          fixed_to="rear of the driver head, block side")
    DB = [0.10, -1.505, 1.132]
    frontm = ids["FUELP"] + ids["IAT"] + ids["FAN"] + ids["CLT"] + ids["CMP"]
    dbm = sum((ids["inj"][i] for i in (1, 3, 5, 7)), []) + frontm
    route(id="ENG-D", loom=L, kind="branch", members=dbm, frm="hub", to="driver rail start", pts=[H0, DB], fixed_to="intake")
    DF = [0.185, -1.930, 1.114]
    route(id="ENG-DRAIL", loom=L, kind="branch", members=dbm, frm="driver rail start", to="driver rail front",
          pts=[DB, [0.185, -1.530, 1.114], [0.185, -1.750, 1.114], DF], fixed_to="driver fuel rail")
    for i, y in ((7, -1.564), (5, -1.6758), (3, -1.7875), (1, -1.899)):
        route(id=f"ENG-INJ-{i}", loom=L, kind="drop", members=ids["inj"][i], frm="driver rail", to=f"INJ-{i}",
              pts=[[0.185, y, 1.114], [0.178, y, 1.085], [0.172, y, 1.065]], fixed_to="injector")
    FF = [0.030, -1.985, 1.120]
    route(id="ENG-FRONT", loom=L, kind="branch", members=ids["FUELP"] + ids["IAT"] + ids["FAN"], frm="driver rail front", to="front centre",
          pts=[DF, [0.10, -1.975, 1.120], FF], fixed_to="intake front")
    route(id="ENG-FUELP", loom=L, kind="drop", members=ids["FUELP"], frm="front centre", to="FUELP (position open: fuel-system lane)",
          pts=[FF, [0.100, -1.990, 1.110], [0.159, -1.998, 1.098]], fixed_to="fuel rail front end (stand-in)", position_open=True)
    route(id="ENG-IAT", loom=L, kind="drop", members=ids["IAT"], frm="front centre", to="IAT (inlet tube)",
          pts=[FF, [0.012, -2.010, 1.190], [0.000, -2.020, 1.228]], fixed_to="inlet tube")
    route(id="ENG-FAN", loom=L, kind="drop", members=ids["FAN"], frm="front centre", to="FAN (fan motor)",
          pts=[FF, [0.030, -2.200, 1.130], [0.020, -2.250, 1.000], [0.000, -2.300, 0.955]], fixed_to="shroud", ends_at_fan=True)
    route(id="ENG-CLTCMP", loom=L, kind="branch", members=ids["CLT"] + ids["CMP"], frm="driver rail front", to="front of the driver head",
          pts=[DF, [0.200, -1.975, 1.030], [0.190, -1.985, 0.990]], fixed_to="head front")
    route(id="ENG-CLT", loom=L, kind="drop", members=ids["CLT"], frm="front of the driver head", to="CLT-ECU",
          pts=[[0.190, -1.985, 0.990], [0.182, -1.994, 0.965]], fixed_to="sensor")
    route(id="ENG-CMP", loom=L, kind="drop", members=ids["CMP"], frm="front of the driver head", to="CMP",
          pts=[[0.190, -1.985, 0.990], [0.150, -2.010, 0.970], [0.060, -2.018, 0.930], [0.046, -2.026, 0.890]], fixed_to="front cover")
    notes = {"drains_at_the_61pin": drains, "oilt": "placed by the pieces lane 2026-09-29: GM oil level and temperature sensor in the pan, passenger side, behind and below knock 2, about (-0.17, -1.67, 0.62) +-50 mm (vehicle_images 9365b1d0, 2024-08-24 engine photo)"}

    # ---- DC primary: every cable at its own OD; 2 x 2 AWG pairs drawn side by side, equal length.
    # A lug leaves its post or stud flat (along the tongue) before the cable bends, so every cable starts and
    # ends with a straight lug leg; bends then sweep at >= 10 x OD in open run, 3 x OD at a supported end.
    P = {p["id"]: p for p in PARTS}
    ody, acc, iso = P["ODYSSEY"], P["ACC-BATT"], P["ISOLATOR"]
    lug = 0.009                                          # lug sits on the post top (not sourced: drawn 9 mm up)
    po = [ody["posts"]["pos"][0], ody["posts"]["pos"][1], round(ody["posts"]["pos"][2] + 0.019 + lug, 4)]
    pn = [ody["posts"]["neg"][0], ody["posts"]["neg"][1], round(ody["posts"]["neg"][2] + 0.019 + lug, 4)]
    ap_ = [acc["posts"]["pos"][0], acc["posts"]["pos"][1], round(acc["posts"]["pos"][2] + 0.019 + lug, 4)]
    an_ = [acc["posts"]["neg"][0], acc["posts"]["neg"][1], round(acc["posts"]["neg"][2] + 0.019 + lug, 4)]
    sA, sB = iso["studs"]["A"], iso["studs"]["B"]
    zst = round(sA[2] - 0.008, 4)                       # ring lug on the stud just under the body (drawn)
    D = "dc"

    def dtop(y):
        return [-0.48, y, 1.070]

    CS_Y = -2.425        # along the core support's engine-side face, 30 mm behind it, under its top flange
    route(id="DC-63", loom=D, kind="cable", wire="63", members=["63"], parallel=2, frm="ODYSSEY +", to="ISOLATOR stud A",
          pts=[po, [-0.490, po[1], po[2]], [-0.490, -2.4288, 1.100], [-0.490, -2.4288, zst], [sA[0], sA[1], zst]],
          fixed_to="Odyssey hold-down, radiator support", polarity="+",
          path_why="shortest drop from the + post to the isolator's outboard stud, in the slot between the battery and the isolator")
    route(id="DC-ISO_OUT", loom=D, kind="cable", wire="ISO_OUT", members=["ISO_OUT"], parallel=2, frm="ISOLATOR stud B", to="PS-STUDS distribution stud",
          pts=[[sB[0], sB[1], zst], [sB[0], -2.380, zst], [-0.430, -2.250, 1.000], [-0.480, -2.170, 1.040], [-0.480, -2.140, 1.040]],
          fixed_to="radiator support, inner-fender bracket", polarity="+",
          path_why="stud B straight back to the distribution stud's front face, under the battery's inboard edge")
    route(id="DC-ODY_NEG", loom=D, kind="cable", wire="ODY_NEG", members=["ODY_NEG"], parallel=2, frm="ODYSSEY -", to="GND-BANK-ENG",
          pts=[pn, [-0.490, pn[1], pn[2]], [-0.490, pn[1], 0.930], [-0.480, -2.110, 0.915]],
          fixed_to="inner-fender bracket", polarity="-",
          path_why="the - post straight down the battery's inboard face to the ground star below the distribution stud")
    route(id="DC-6", loom=D, kind="cable", wire="6", members=["6"], parallel=1, frm="PS-STUDS distribution stud", to="STARTER-S (B+ stud)",
          pts=[[-0.48, -2.020, 1.040], [-0.49, -1.900, 1.000], [-0.49, -1.620, 0.800], [-0.49, -1.480, 0.790], [-0.30, -1.460, 0.790], [-0.232, -1.438, 0.700]],
          fixed_to="passenger inner-fender wall, top of the passenger frame rail", polarity="+", service_loop=True, lands_on_engine=True,
          path_why="down the passenger inner-fender wall (outboard of the header by >100 mm), over the frame rail behind the headers, in to the solenoid: the shortest path that keeps 1 in off the exhaust")
    route(id="DC-G1", loom=D, kind="cable", wire="G1", members=["G1"], parallel=2, frm="GND-BANK-ENG", to="engine block boss near the starter",
          pts=[[-0.455, -2.060, 0.915], [-0.415, -2.060, 0.915], [-0.440, -1.880, 0.900], [-0.455, -1.620, 0.770], [-0.455, -1.480, 0.765], [-0.300, -1.455, 0.765], [-0.160, -1.425, 0.715]],
          fixed_to="passenger inner-fender wall, top of the passenger frame rail", polarity="-", service_loop=True, lands_on_engine=True,
          path_why="clamped alongside the starter cable (#6) so feed and return run together to the engine")
    route(id="DC-G2", loom=D, kind="cable", wire="G2", members=["G2"], parallel=1, frm="GND-BANK-ENG", to="frame rail boss (passenger)",
          pts=[[-0.480, -2.060, 0.895], [-0.480, -2.060, 0.860], [-0.440, -2.055, 0.800], [-0.412, -2.050, 0.785]], fixed_to="frame rail", polarity="-",
          path_why="shortest drop from the ground star to a boss on the passenger rail's outboard web")
    route(id="DC-59", loom=D, kind="cable", wire="59", members=["59"], parallel=2, frm="PS-STUDS (MEGA 200)", to="ALTERNATOR-SENSE (B+ stud)",
          pts=[dtop(-2.100), [-0.480, -2.100, 1.130], [-0.400, CS_Y, 1.215], [0.400, CS_Y, 1.215], [0.470, -2.300, 1.160],
               [0.480, -2.120, 1.090], [0.480, -2.020, 1.080], [0.340, -1.975, 1.070], [0.255, -1.964, 1.036]],
          fixed_to="radiator (core) support, driver inner-fender edge", polarity="+", service_loop=True, lands_on_engine=True,
          path_why="along the core support (clear of the fan and belt), then back along the driver inner-fender edge inboard of the YellowTop, in to the alternator's rear stud with a loop")
    route(id="DC-ACC_NEG", loom=D, kind="cable", wire="ACC_NEG", members=["ACC_NEG"], parallel=1, frm="ACC-BATT -", to="GND-BANK-ENG",
          pts=[an_, [0.490, an_[1], an_[2]], [0.440, -2.380, 1.195], [0.400, CS_Y, 1.195], [-0.400, CS_Y, 1.195], [-0.440, -2.300, 1.020], [-0.480, -2.160, 0.930], [-0.480, -2.110, 0.915]],
          fixed_to="radiator (core) support", polarity="-",
          path_why="the accessory battery's return to the one ground star, clamped under #59 along the core support")
    route(id="DC-32", loom=D, kind="cable", wire="32", members=["32"], parallel=1, frm="ACC-BATT + (MIDI 60)", to="AMP-BLOCK (rear, along the driver frame rail)",
          pts=[ap_, [0.485, ap_[1], ap_[2]], [0.485, -2.350, 1.100], [0.485, -2.200, 0.900], [0.445, -2.050, 0.720], [0.445, -1.620, 0.700], [0.470, -1.250, 0.600], [0.470, -0.700, 0.575]],
          fixed_to="driver inner-fender wall, outboard web of the driver frame rail", polarity="+", rear_bound=True,
          path_why="down the YellowTop's inboard face to the driver frame rail, then rearward on the rail's outboard web (frame doctrine); outboard because the twin's exhaust tail runs inside that rail")
    route(id="DC-AMP_GND", loom=D, kind="cable", wire="AMP_GND", members=["AMP_GND"], parallel=1, frm="GND-BANK-ENG", to="AMP-BLOCK (rear, along the driver frame rail)",
          pts=[[-0.455, -2.040, 0.925], [-0.415, -2.040, 0.925], [-0.420, -2.300, 1.100], [-0.400, CS_Y, 1.235], [0.400, CS_Y, 1.235], [0.465, -2.300, 1.100],
               [0.465, -2.150, 0.920], [0.430, -2.050, 0.708], [0.430, -1.620, 0.688], [0.455, -1.250, 0.588], [0.455, -0.700, 0.563]],
          fixed_to="radiator (core) support, driver inner-fender wall, outboard web of the driver frame rail", polarity="-", rear_bound=True,
          path_why="the amp's return comes back to the one ground star, so it crosses on the core support and then pairs with #32 down the driver rail")
    route(id="DC-PDM15_BPOS", loom=D, kind="cable", wire="PDM15_BPOS", members=["PDM15_BPOS"], parallel=1, frm="PS-STUDS (MEGA 100)", to="PDM15-A (PDM32 connector C, 1-pin Autosport)",
          od_override=(OD16[4], "PROPOSED CHANGE: drawn at 4 AWG (7.92 mm, ProWire) because the PDM32 battery pin takes #6 or #4 AWG only (MoTeC PDM manual p.42, mating #68093/#68094); the registry still says 2 AWG, and its fuse (MEGA 100) is the registry owner's call"),
          pts=[dtop(-2.060), [-0.480, -2.060, 1.105], [-0.580, -2.030, 1.100], [-0.650, -2.005, 1.085], [-0.680, -1.992, 1.076]], fixed_to="passenger inner fender", polarity="+",
          path_why="short hop from the MEGA 100 to the bay box's battery input on the same fender")
    yh = round(y_fw(-0.357) + 0.030, 4)
    route(id="DC-PDM_BPOS", loom=D, kind="cable", wire="PDM_BPOS", members=["PDM_BPOS"], parallel=1, frm="PS-STUDS (MEGA 125)", to="PDM30-STUD through H3 (the exception)",
          pts=[dtop(-2.080), [-0.480, -2.080, 1.118], [-0.495, -1.950, 1.075], [-0.495, -1.620, 1.050], [-0.490, -1.515, 0.985], [-0.400, -1.500, 0.905], [-0.357, -1.470, 0.905], [-0.357, yh, 0.905]],
          fixed_to="passenger inner-fender edge, firewall", polarity="+", crossing="H3", fw_idx=[5, 6, 7],
          path_why="back along the passenger inner-fender edge, down its rear slope and along the firewall to H3: the exception route")
    route(id="DC-GND_RET_CAB", loom=D, kind="cable", wire="GND_RET_CAB", members=["GND_RET_CAB"], parallel=1, frm="GND-BANK-CAB through H3 (the exception)", to="GND-BANK-ENG",
          pts=[[-0.343, round(y_fw(-0.343) + 0.030, 4), 0.895], [-0.343, -1.470, 0.895], [-0.430, -1.480, 0.910], [-0.470, -1.520, 0.960], [-0.470, -1.620, 1.025],
               [-0.470, -1.950, 1.045], [-0.470, -1.985, 0.960], [-0.480, -2.010, 0.925]],
          fixed_to="firewall, passenger inner-fender edge", polarity="-", crossing="H3", fw_idx=[0, 1, 2],
          path_why="the cab bank's return, paired with PDM_BPOS on the same inner-fender edge, into the ground star's rear face")
    route(id="DC-52", loom=D, kind="cable", wire="52", members=["52"], parallel=1, frm="PS-STUDS (MIDI 40)", to="IBOOSTER (feed)",
          pts=[dtop(-2.040), [-0.480, -2.040, 1.110], [-0.515, -1.900, 1.100], [-0.515, -1.620, 1.080], [-0.520, -1.500, 1.090], [-0.520, -1.488, 1.228],
               [0.190, -1.488, 1.228], [0.250, -1.530, 1.140], [0.300, -1.550, 1.100]],
          fixed_to="passenger inner-fender edge, firewall corner seam, cowl seam", polarity="+", fw_idx=[5, 6, 7, 8],
          path_why="inner-fender edge back to the firewall corner, up the corner seam, across the cowl seam to the booster: stays off the engine, intake and belt; the core-support way is ~0.6 m longer")
    route(id="DC-IBOOST_GND", loom=D, kind="cable", wire="IBOOST_GND", members=["IBOOST_GND"], parallel=1, frm="IBOOSTER (ground)", to="GND-BANK-ENG",
          pts=[[0.300, -1.530, 1.085], [0.250, -1.510, 1.150], [0.180, -1.476, 1.242], [-0.540, -1.476, 1.242], [-0.540, -1.492, 1.095], [-0.540, -1.620, 1.090],
               [-0.540, -1.900, 1.110], [-0.500, -1.985, 0.990], [-0.480, -2.010, 0.935]],
          fixed_to="cowl seam, firewall corner seam, passenger inner-fender edge", polarity="-", fw_idx=[0, 1, 2, 3, 4],
          path_why="the booster's return, paired with #52 on the same seams")
    return notes, W


# ------------------------------------------------------------------------------------------------ evaluation
def evaluate(obst, W):
    out = []
    CL, CL_HOT, HOT = 18 * IN, 12 * IN, 0.150
    for r in ROUTES:
        mem = [m for m in r["members"] if m in W]
        cables = cables_of(mem, W)
        bund = (cables[0]["od_mm"] if cables else 0.0) if r["loom"] == "dc" else bundle_od(cables)
        if r.get("od_override"):
            for c in cables:
                c["od_mm"], c["basis"], c["unknown"] = r["od_override"][0], r["od_override"][1], False
            bund = r["od_override"][0]
        largest = max((c["od_mm"] for c in cables), default=0.0)
        pts, bends = fillet(r["pts"], 10 * largest * MM, 3 * largest * MM)
        loop = None
        if r.get("service_loop"):
            a, b = np.array(pts[-2]), np.array(pts[-1])
            mid = (a + b) / 2 + np.array([0, 0, -0.06])
            q = [((1 - t) ** 2) * a + 2 * (1 - t) * t * mid + (t ** 2) * b for t in np.linspace(0, 1, 16)]
            pts = pts[:-1] + [p.tolist() for p in q[1:]]
            loop = {"drawn": "slack span sagging 60 mm into the engine stud", "length_allowance_in": 12,
                    "min_radius_mm": round(3 * bund, 1), "source": S["loop"]}
        length = path_len(pts) + (12 * IN if loop else 0.0)
        rad = bund / 2 * MM
        clear, where = obst.exhaust_clearance(pts, rad) if (obst and obst.ok) else (None, None)
        clamps = []
        path_only = path_len(pts)
        if path_only > 0.30 and r["kind"] in ("trunk", "branch", "cable"):
            spacing = CL_HOT if (clear is not None and clear < HOT) else CL
            # both ends are supported (lug, plug or break-out); first and last clamp 150 mm in, even spacing between
            n = max(1, math.ceil((path_only - 0.30) / spacing) + 1)
            clamps = [round(float(s), 3) for s in np.linspace(0.15, path_only - 0.15, n)]
            cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1))])
            for bnd in bends:
                if bnd["angle_deg"] > 45 and not bnd["near_end"]:
                    j = int(np.argmin(np.linalg.norm(np.array(pts) - np.array(bnd["at"]), axis=1)))
                    sj = float(cum[j])
                    if all(abs(sj - c) > 0.08 for c in clamps) and 0.08 < sj < path_only - 0.08:
                        clamps.append(round(sj, 3))
            clamps.sort()
        Pp, ss = resample(pts, 0.005)
        cxyz = []
        for s_ in clamps:
            k = int(np.clip(np.searchsorted(ss, s_), 1, len(ss) - 1))
            cxyz.append({"s_m": s_, "at": [round(float(x), 4) for x in Pp[k]], "tangent": [round(float(x), 4) for x in unit(Pp[k] - Pp[k - 1])]})
        checks = []
        ok_b = all(b["r_eff_mm"] + 0.5 >= b["r_req_mm"] for b in bends)
        worst = min(bends, key=lambda b: b["r_eff_mm"] - b["r_req_mm"]) if bends else None
        checks.append({"rule": "minimum bend radius", "source": S["bend"], "result": "pass" if ok_b else "fail",
                       "why": f"largest cable {largest:.2f} mm: {10 * largest:.0f} mm in open run, {3 * largest:.0f} mm at a supported end; "
                              + (f"tightest {worst['r_eff_mm']} mm against {worst['r_req_mm']} mm" if worst else "no bends")})
        if clear is not None and min(p[1] for p in pts) > -1.00 and clear > 0.30:
            checks.append({"rule": ">= 1 in from the exhaust", "source": S["heat"], "result": "not run",
                           "why": "aft of the twin's exhaust: the E3 tail pipes end at y -1.07 and the route behind that is not known (owner asked by the fuel-system lane)"})
        elif clear is not None:
            checks.append({"rule": ">= 1 in from the exhaust, DR-25 + heat sleeve near it", "source": S["heat"], "result": "pass" if clear >= 25.4 * MM else "fail",
                           "why": f"closest cable surface to the twin exhaust {clear / MM:.0f} mm" + ("; within 150 mm, so DR-25 + reflective sleeve and 12 in clamps" if clear < HOT else "")})
        else:
            checks.append({"rule": ">= 1 in from the exhaust", "source": S["heat"], "result": "not run", "why": "no exhaust meshes (--mesh-dir)"})
        # fan swept volume: SPAL 30107090 16 in, 3.10 in thick, on the engine side of the radiator core (FAN)
        def fan_d(p):
            rr = math.hypot(p[0] - FAN["c"][0], p[2] - FAN["c"][2]) - FAN["r"]
            aa = max(FAN["y0"] - p[1], p[1] - FAN["y1"], 0.0)
            return math.hypot(max(rr, 0.0), aa) if (rr > 0 or aa > 0) else -1.0
        fpts = pts
        if r.get("ends_at_fan"):   # the fan's own lead lands on the motor hub: its last 60 mm is at the hub, not in the blade disc
            cumr = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1))])
            fpts = [p for p, c in zip(pts, cumr) if c < cumr[-1] - 0.060]
        dfan = min(fan_d(p) for p in fpts) - rad
        checks.append({"rule": ">= 25 mm from the fan's swept volume", "source": S["fan"], "result": "pass" if dfan >= 0.025 else "fail",
                       "why": f"closest cable surface to the 16 in fan disc {dfan / MM:.0f} mm"})
        def box_d(p, lo, hi):
            d = [max(lo[i] - p[i], 0, p[i] - hi[i]) for i in range(3)]
            return math.sqrt(sum(x * x for x in d))
        bpts = pts
        if r.get("ends_at_belt"):   # a lead that lands on a belt-driven unit (A/C clutch, alternator): its last 60 mm is at the unit
            cumr = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1))])
            bpts = [p for p, c in zip(pts, cumr) if c < cumr[-1] - 0.060] or pts[:1]
        dbelt = min(box_d(p, BELT["lo"], BELT["hi"]) for p in bpts) - rad
        checks.append({"rule": ">= 25 mm from the belt and pulley envelope", "source": S["belt"], "result": "pass" if dbelt >= 0.025 else "fail",
                       "why": f"closest cable surface to the accessory-drive envelope {dbelt / MM:.0f} mm"})
        if r["loom"] == "dc":
            over = [p for p in pts if abs(p[0]) < INTAKE["hx"] and INTAKE["y0"] < p[1] < INTAKE["y1"] and p[2] > INTAKE["z"]]
            checks.append({"rule": "no DC cable over the intake", "source": S["intake"], "result": "fail" if over else "pass",
                           "why": f"{len(over)} points over the intake footprint" if over else "never crosses the intake footprint"})
        under = [p for p in pts if abs(p[0]) < 0.14 and -2.00 < p[1] < -1.40 and p[2] < 0.60]
        checks.append({"rule": "no runs under the engine", "source": S["under"], "result": "fail" if under else "pass",
                       "why": f"{len(under)} points under the oil pan (inside its footprint |x| < 0.14, below z 0.60)" if under else "never passes under the oil pan (|x| < 0.14 below z 0.60, twin E3_OilPan)"})
        side = r.get("side", "engine")
        if r.get("crossing") == "H3" or r.get("crossing_tag") == "h3":
            checks.append({"rule": "firewall crossings only at the 61-pin or the H3 exception", "source": S["fw"], "result": "exception",
                           "why": "crosses at factory hole H3: the exception under review (the cab power box's 2 AWG feed and ground)"})
        elif r["kind"] == "crossing" and r.get("crossing_tag") == "61pin":
            checks.append({"rule": "firewall crossings only at the 61-pin or the H3 exception", "source": S["fw"], "result": "pass",
                           "why": "this is the 61-pin itself: the one firewall crossing"})
        elif r["kind"] == "crossing":
            checks.append({"rule": "any other bulkhead is round", "source": "owner calls 2026-09-29 (task brief: any other bulkhead must be round; a small round rear-floor connector is acceptable)",
                           "result": "pass", "why": f"{r.get('to') or r['id']}: a round floor pass-through, not the firewall"})
        elif side == "cab":
            front = [p for p in pts if abs(p[0]) < 0.76 and 0.90 <= p[2] <= 1.25 and p[1] < y_fw(p[0]) + rad - 0.002]
            checks.append({"rule": "firewall crossings only at the 61-pin or the H3 exception", "source": S["fw"], "result": "fail" if front else "pass",
                           "why": (f"{len(front)} path points inside or ahead of the twin's firewall panel" if front
                                   else "stays on the cab side; its wires cross only in the 61-pin")})
        elif side == "body":
            checks.append({"rule": "firewall crossings only at the 61-pin or the H3 exception", "source": S["fw"], "result": "pass",
                           "why": "aft of the firewall (body or frame); no firewall crossing"})
        else:
            behind = [p for p in pts if abs(p[0]) < 0.76 and 0.90 <= p[2] <= 1.25 and y_fw(p[0]) - rad + 0.002 < p[1] < y_fw(p[0]) + 0.10]
            if behind and r.get("fw_dish"):
                checks.append({"rule": "firewall crossings only at the 61-pin or the H3 exception", "source": S["fw"] + "; delstributor lane FIT-FIREWALL (PR #434)",
                               "result": "flag",
                               "why": f"{len(behind)} points behind the twin's firewall face at the centre, where the real firewall has a deep dish (IMG_6531) and the DEL-Stributor ring sits (Delmo: 'designed for applications with a deep firewall'): a twin inaccuracy to tape (block rear face to the dish), not a crossing"})
            else:
                checks.append({"rule": "firewall crossings only at the 61-pin or the H3 exception", "source": S["fw"], "result": "fail" if behind else "pass",
                               "why": (f"{len(behind)} path points inside the twin's firewall panel (worst {max(p[1] - y_fw(p[0]) + rad for p in behind) * 1000:+.0f} mm)" if behind
                                       else "stays on the engine side; its wires cross only in the 61-pin")})
        if r.get("conflict"):
            checks.append({"rule": "clear of neighbouring parts", "source": "twin K5H_iBooster (v2 box, size not read); objectTraits FB (position not measured)",
                           "result": "flag", "why": f"the path runs through the twin {r['conflict']} box. Both positions are unmeasured, so this is a flagged conflict, not a detour (tapes T-02, T-03)"})
        if r.get("position_open"):
            checks.append({"rule": "end position sourced", "source": "mounts.yaml FUELP (open); fuel-system lane owns the regulator and port", "result": "flag",
                           "why": "end drawn at a stand-in spot (the driver fuel rail's front end) until the fuel-system lane places the port"})
        if r.get("engine_gap"):
            checks.append({"rule": "slack across the chassis-to-engine gap", "source": S["svc"], "result": "flag",
                           "why": "one end on the chassis, the other on the engine (it moves on its mounts): drawn tight; the builder leaves the slack at the mock-up"})
        if r.get("open_note"):
            checks.append({"rule": "every wire has a sanctioned crossing", "source": S["fw"], "result": "flag", "why": r["open_note"]})
        if r.get("lands_on_engine"):
            checks.append({"rule": "service loop where a cable lands on the engine", "source": S["svc"], "result": "pass" if loop else "fail",
                           "why": "slack span into the engine stud, 12 in allowance" if loop else "no loop"})
        if path_only > 0.30 and r["kind"] in ("trunk", "branch", "cable"):
            gaps = np.diff([0] + clamps + [path_only])
            lim = CL_HOT if (clear is not None and clear < HOT) else CL
            checks.append({"rule": "clamps <= 18 in (ABYC E-11), 12 in near heat, extra at bends", "source": S["clamp"],
                           "result": "pass" if gaps.max() <= lim + 0.001 else "fail",
                           "why": f"{len(clamps)} clamps, largest gap {gaps.max() / IN:.1f} in (limit {lim / IN:.0f} in)"})
        # firewall fore-aft sensitivity (margins.yaml, firewall zone +-100 mm): points on the firewall or cowl move with
        # it; engine and battery-corner points stay (the engine sits on frame mounts: an assumption, tape T-05/T-06)
        sens = None
        if r.get("fw_idx"):
            # the waypoints that sit on the firewall or cowl move with it; the rest stay (engine on frame mounts,
            # batteries and inner-fender points on the front clip): polyline length before and after, no re-filleting
            W0 = np.array(r["pts"], dtype=float)
            base_l = float(np.sum(np.linalg.norm(np.diff(W0, axis=0), axis=1)))
            sens = {}
            for dy in (0.10, -0.10):
                Q = W0.copy()
                Q[r["fw_idx"], 1] += dy
                sens[f"{int(round(dy * 1000)):+d}"] = int(round((float(np.sum(np.linalg.norm(np.diff(Q, axis=0), axis=1))) - base_l) / MM))
        jacket = dr25_for(bund) if (len(cables) > 1 or r["loom"] == "dc") else None
        out.append({"id": r["id"], "loom": r["loom"], "kind": r["kind"], "status": "PROPOSAL (owner and builder to confirm)",
                    "from": r["frm"], "to": r["to"], "members": mem, "cables": len(cables), "parallel": r.get("parallel", 1),
                    "bundle_od_mm": round(bund, 2),
                    "bundle_od_basis": S["pack"] if (len(cables) > 1 and r["loom"] != "dc") else (cables[0]["basis"] if cables else None),
                    "od_unknowns": sorted({c["basis"] for c in cables if c["unknown"]}),
                    "dr25_estimate": jacket, "length_mm": round(length / MM),
                    "length_basis": "twin path (filleted), not taped" + ("; + 12 in service-loop allowance" if loop else ""),
                    "service_loop": loop, "clamps": cxyz, "bends": bends, "fixed_to": r.get("fixed_to"), "polarity": r.get("polarity"),
                    "wire": r.get("wire"), "why": r.get("why") or r.get("path_why"), "firewall_shift_mm": sens, "conflict": r.get("conflict"), "position_open": r.get("position_open"), "od_override_note": (r.get("od_override") or [None, None])[1], "side": r.get("side", "engine"), "crossing_tag": r.get("crossing_tag"),
                    "edge_of": r.get("edge_of"), "open_wires": r.get("open_wires"), "checks": checks, "path": [[round(float(x), 5) for x in p] for p in pts]})
    return out


# ------------------------------------------------------------------------------------------------ layout-page export
CLAMP_TABLE = [  # clamp size by bundle OD, docs/wiring/output/K5_harness_protection_catalog.md s10 (Adel, rubber-lined)
    (0.25, "1/4 in", "Waytek AC-14"), (0.40, "3/8 in", "Waytek AC-38"), (0.55, "1/2 in", "Waytek AC-12"),
    (0.80, "3/4 in", "Waytek AC-34"), (1.00, "1 in", "Waytek AC-1")]
S["clamp_pn"] = ("docs/wiring/output/K5_harness_protection_catalog.md s10 'Adel Clamps (Rubber-Lined P-Clips)': size by bundle OD "
                 "(1/4 in to 0.25, 3/8 to 0.40, 1/2 to 0.55, 3/4 to 0.80, 1 in to 1.0 in), Waytek AC-series; MS21919 is the mil family "
                 "(spine study s1.3, AC 43.13-1B par. 11-146); the MS21919 dash number for each size is not in the substrate")
S["ties"] = "docs/wiring/chapters/16-wire-and-protection-canon.md s8.5 (IPC/WHMA-A-620): tie or lace every 150 mm on the trunk, 75 mm on branches"
LOOM_NAMES = {"engine": "ENGINE LOOM (61-pin engine side)", "dc": "DC PRIMARY / POWER SPINE", "front": "FRONT LOOM (bay box)",
              "cab": "CAB / DASH LOOM (61-pin cab side, M130, PDM30)", "door": "DOOR LOOMS (hinge side)",
              "rear": "REAR LOOM (sill, rear connector, frame rail, rear body)", "under": "UNDERBODY / TRANS LOOM"}
ZONE_TOL_MM = {  # working tolerance of each end's position (margins.yaml zones)
    "engine": 100, "firewall": 100, "battery_corner": 50, "front_body": 50, "cab": 30, "frame": 25, "rear": 40}


def clamp_for(od_mm):
    inch = od_mm / 25.4
    for lim, size, pn in CLAMP_TABLE:
        if inch <= lim:
            return size, pn
    return "over 1 in", "not in the catalog table"


def zone_of(label, pos):
    t = (label or "").upper()
    if "FIREWALL" in t or "H3" in t or "IBOOSTER" in t:
        return "firewall"
    if any(k in t for k in ("ODYSSEY", "ACC-BATT", "ISOLATOR", "PS-STUDS", "GND-BANK-ENG", "PDM15")):
        return "battery_corner"
    if "FRAME" in t:
        return "frame"
    if pos[1] > -1.40:
        return "cab" if pos[1] < 0.2 else "rear"
    return "engine"


def export_layout(routes, reg):
    epids = sorted(reg["endpoints"].keys(), key=len, reverse=True)
    nodes, seg_out, clips = {}, [], []

    up = {e.upper(): e for e in epids}

    def ep_in(text):
        """The first whole token that is an endpoint id (so KICKP is not CKP)."""
        import re
        for tok in re.findall(r"[A-Za-z0-9_-]+", text or ""):
            if tok.upper() in up:
                return up[tok.upper()]
        return None

    def node(pos, label, kind, wires):
        key = tuple(round(c / 0.002) for c in pos)
        if key not in nodes:
            ep = ep_in(label)
            nid = ep or ("N-" + "-".join(w for w in "".join(ch if ch.isalnum() else " " for ch in label.lower()).split())[:40])
            base, k = nid, 2
            while any(n["id"] == nid for n in nodes.values()):
                nid = f"{base}-{k}"; k += 1
            nodes[key] = {"id": nid, "kind": kind, "pos": [round(c, 4) for c in pos], "pn": None, "wires": [], "ep": ep, "note": label}
        n = nodes[key]
        n["wires"] = sorted(set(n["wires"]) | set(wires))
        return n["id"]

    starts = {tuple(round(c / 0.002) for c in r["path"][0]) for r in routes}
    for r in routes:
        a, b = r["path"][0], r["path"][-1]
        dc = r["loom"] == "dc"
        ka = "stud" if dc else ("connector" if ep_in(r["from"]) else "breakout")
        kb = "stud" if dc else ("connector" if ep_in(r["to"]) else "breakout")
        if "H3" in (r["from"] or ""):
            ka = "grommet"
        if "H3" in (r["to"] or ""):
            kb = "grommet"
        na = node(a, r["from"], ka, r["members"]); nb = node(b, r["to"], kb, r["members"])
        za, zb = zone_of(r["from"], a), zone_of(r["to"], b)
        ta, tb = ZONE_TOL_MM[za], ZONE_TOL_MM[zb]
        if za == zb == "engine":
            ta = tb = 50          # both ends on the engine: relative error of the box engine, not its absolute placement
        L = r["length_mm"]
        margin = int(round(min(300, max(25, math.hypot(ta, tb) + 0.03 * L)) / 5) * 5)
        od = r["bundle_od_mm"] * (2 if r.get("parallel", 1) == 2 else 1) + (4 if r.get("parallel", 1) == 2 else 0)
        size, pn = clamp_for(od)
        cover = []
        if r.get("dr25_estimate"):
            cover.append(f"DR-25 {r['dr25_estimate']['size']} in (estimate; final size off the formboard, canon ch.18 s7)")
        heat = [c for c in r["checks"] if c["rule"].startswith(">= 1 in") and "reflective" in c["why"]]
        if heat:
            cover.append("reflective heat sleeve where it passes the exhaust")
        if dc:
            cover.append("red shrink band at + lugs, black at - lugs (canon ch.18 s7 layer 4)")
        big = r["kind"] == "trunk" or r["cables"] >= 8
        tie_step = 150 if big else 75
        ties = 0 if (r["kind"] == "drop" or (dc and r.get("parallel", 1) == 1)) else int(L // tie_step)
        seg_out.append({"id": r["id"], "bundle": LOOM_NAMES.get(r["loom"], r["loom"]),
                        "status": r["status"], "from_node": na, "to_node": nb, "points": r["path"], "wires": r["members"],
                        "cables": r["cables"], "parallel": r.get("parallel", 1), "od_mm": r["bundle_od_mm"],
                        "od_basis": r["bundle_od_basis"], "od_unknowns": r["od_unknowns"], "covering": "; ".join(cover) or "none (single wire)",
                        "length_m": round(L / 1000, 3), "margin_mm": margin,
                        "margin_basis": f"end zones {za} +-{ta} mm and {zb} +-{tb} mm (margins.yaml), combined root-sum-square, +3 % of length; clipped to 25..300 mm (owner: 6 to 12 in)",
                        "clip_spacing_mm": (305 if any("12 in clamps" in c["why"] for c in r["checks"]) else 457) if r["clamps"] else None,
                        "ties": ties, "tie_spacing_mm": tie_step if ties else None, "firewall_shift_mm": r.get("firewall_shift_mm"),
                        "why": r.get("why"),
                        "basis": "PROPOSAL: twin path, filleted to the cited bend radius; not taped", "checks": r["checks"]})
        for i, cl in enumerate(r["clamps"]):
            clips.append({"id": f"{r['id']}-C{i + 1}", "segment": r["id"], "pos": cl["at"], "tangent": cl["tangent"],
                          "pn": pn, "type": f"cushioned loop clamp {size} (MS21919 family)", "fixed_to": r.get("fixed_to"),
                          "note": "position along the proposed path; the builder sets the mount at the mock-up", "basis": S["clamp_pn"]})
    # connector / stud part numbers where the scene knows them
    for n in nodes.values():
        if n["ep"] == "FIREWALL-ENGINE":
            n["pn"] = "D38999/26WJ61PN plug + M85049/69-25 adapter + 202K163-25-0 boot (registry, state s1 row 43, 0k)"
        if n["kind"] == "breakout":
            n["pn"] = "AS81765/1 Type II molded transition (1 to N); boot PN not sourced (canon ch.16 s7.4)"
        if n["kind"] == "grommet":
            n["pn"] = "factory hole H3, 1.5 in (objectTraits.ts); grommet PN not picked"
    return {"frame": "twin metres: +x driver, -y forward, +z up", "status": "PROPOSAL (owner and builder to confirm)",
            "scope": "engine bay: engine loom from the 61-pin + DC primary (sample scope, 2026-09-29)",
            "generated_by": "docs/wiring/twin/harness_cad.py", "segments": seg_out, "nodes": list(nodes.values()), "clips": clips,
            "sources": S}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh-dir", default=None)
    ap.add_argument("--scope", default="sample")
    a = ap.parse_args()
    reg = json.load(open(REG_PATH))
    build_sample_parts()
    notes, W = build_sample_routes(reg)
    obst = Obstacles(a.mesh_dir)
    routes = evaluate(obst, W)
    CAD.mkdir(parents=True, exist_ok=True)
    json.dump({"frame": "twin metres: +x driver, -y front, +z up", "scope": a.scope, "parts": PARTS, "routes": routes, "notes": notes, "sources": S},
              open(CAD / "scene_v4.json", "w"), indent=1)
    ends_status = {e["id"]: e.get("status") for e in yaml.safe_load(open(REPO / "docs/wiring/calc-data/catalog/mounts.yaml"))["ends"]}
    epids = sorted(reg["endpoints"].keys(), key=len, reverse=True)

    def ep_of(text):
        t = (text or "").upper()
        return next((e for e in epids if e.upper() in t), None)
    for r in routes:
        for k, txt in (("start", r["from"]), ("end", r["to"])):
            ep = ep_of(txt)
            r[k + "_ep"] = ep
            r[k + "_status"] = ends_status.get(ep) if ep else ("breakout" if r["loom"] != "dc" else None)
    json.dump({"frame": "twin metres: +x driver, -y front, +z up", "scope": a.scope, "parts": PARTS, "routes": routes, "notes": notes, "sources": S},
              open(CAD / "scene_v4.json", "w"), indent=1)
    lay = export_layout(routes, reg)
    json.dump(lay, open(CAD / "routes.json", "w"), indent=1)
    print("routes.json:", len(lay["segments"]), "segments,", len(lay["nodes"]), "nodes,", len(lay["clips"]), "clips")
    npass = sum(1 for r in routes for c in r["checks"] if c["result"] == "pass")
    nfail = sum(1 for r in routes for c in r["checks"] if c["result"] == "fail")
    print(f"parts {len(PARTS)} routes {len(routes)} checks pass {npass} fail {nfail}")
    for r in routes:
        f = [c["rule"] + ": " + c["why"] for c in r["checks"] if c["result"] == "fail"]
        print(f"{r['id']:16s} od {r['bundle_od_mm']:6.2f} len {r['length_mm']:5d} cl {len(r['clamps']):2d}" + ("  FAIL " + " ; ".join(f) if f else ""))


if __name__ == "__main__":
    main()
