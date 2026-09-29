"""K5 harness in CAD (v4): the channel graph. Every harness wire in the registry is routed over a network of
channels that follow the truck's structure (engine loom tree, inner-fender edges, core support, cowl seam, the
firewall's cab face above the toe board, under-dash crossbar, A-pillar and header, driver sill, door hinge, rear body
floor edge, frame rails, rear crossmember, tunnel). Each channel edge becomes one loom segment whose members are the
wires routed through it, so bundle diameters, break-outs and clamps follow from the wire list, not from drawing.

Used by harness_full.py. All channels are PROPOSALS for the owner and the builder to confirm.
Twin axes: metres, +x = driver, -y = front, +z = up.

Where the numbers come from (twin probes 2026-09-29, harness-cad; TurboSquid body, so +-margins.yaml per zone):
- frame rails: RAIL below, the outboard web face and top of Under_Frame_Blazer sampled every 50 mm of y
  (a loom rides the upper web, the DC cables the lower web; brackets and hangers smoothed out)
- firewall cab face y_fw(x) (harness_cad.FW_FACE), the toe board (Under_Main_Blazer: z 0.90 at the firewall face,
  sloping to z 0.66 at y -1.22 for |x| 0.2..0.8), the tunnel (top z 0.88 at the firewall, 0.80 at y -0.9), the dash's
  modelled lower panel (Dash_Main, z 1.03: a closure, not real structure; tape T-04 settles the under-dash space)
- cab floor z 0.645, rear cargo floor z 0.845, kick panels |x| 0.80, door inner panel x 0.90, headliner z 1.86
"""
import heapq, math
from collections import defaultdict
import numpy as np

# ------------------------------------------------------------------ frame rails (twin probe, smoothed)
# (y, outboard web face |x|, rail top z). Mid-frame the rail is z 0.496..0.646 (150 mm web).
RAIL = [(-2.45, 0.401, 0.759), (-2.20, 0.401, 0.807), (-2.00, 0.401, 0.825), (-1.80, 0.401, 0.825), (-1.60, 0.405, 0.799),
        (-1.50, 0.413, 0.761), (-1.40, 0.421, 0.720), (-1.30, 0.430, 0.679), (-1.20, 0.439, 0.648), (-1.10, 0.441, 0.645),
        (0.10, 0.441, 0.650), (0.20, 0.441, 0.666), (0.30, 0.441, 0.756), (0.40, 0.440, 0.779), (0.50, 0.441, 0.803),
        (0.75, 0.441, 0.804), (0.95, 0.441, 0.784), (1.10, 0.441, 0.770), (1.20, 0.441, 0.751), (1.60, 0.441, 0.751),
        (1.70, 0.430, 0.745), (1.80, 0.403, 0.721), (1.90, 0.399, 0.718)]
RAIL_SRC = ("twin probe 2026-09-29 (Under_Frame_Blazer, outboard web face and top per 50 mm of y, brackets smoothed); "
            "frame zone +-5 mm plan, +-25 mm heights (margins.yaml). From y -2.05 to -1.39 the twin's headers and collectors reach "
            "|x| 0.389, 12 mm inside the web, so runs there sit on 30 mm stand-off clamps to keep 1 in (objectTraits heat rule)")


def rail_xyz(side, y, below_top=0.040, off=0.012):
    """A point on the outboard web of a frame rail: side +1 driver, -1 passenger; 'below_top' under the rail top,
    'off' out from the web face (clip standoff + half the bundle)."""
    ys = [r[0] for r in RAIL]
    if -2.05 <= y <= -1.39:
        off = max(off, 0.034)    # the headers and collectors run inside the rail here (|x| up to 0.389): 30 mm stand-off clamps
    wx = float(np.interp(y, ys, [r[1] for r in RAIL]))
    zt = float(np.interp(y, ys, [r[2] for r in RAIL]))
    return (round(side * (wx + off), 4), round(y, 4), round(zt - below_top, 4))


def rail_run(side, y0, y1, below_top=0.040, off=0.012):
    """Rail points from y0 to y1 at every RAIL station between them (plus both ends)."""
    ys = sorted({y0, y1} | {r[0] for r in RAIL if min(y0, y1) < r[0] < max(y0, y1)}, reverse=(y1 < y0))
    return [rail_xyz(side, y, below_top, off) for y in ys]


# ------------------------------------------------------------------ named nodes
N = {
    "PDM15": (-0.680, -1.812, 1.076),     # the bay box's plug end (sample: PDM32 stand-in, connector end at the rear)
    "PBB": (-0.560, -1.700, 1.120), "PF2": (-0.560, -2.050, 1.120), "PCS": (-0.520, -2.449, 1.200),
    "CS0": (0.000, -2.449, 1.200), "DCS": (0.520, -2.449, 1.200), "DF2": (0.560, -2.050, 1.120), "DBB": (0.560, -1.700, 1.120),
    "PCOWL": (-0.560, -1.505, 1.190), "COWL0": (0.000, -1.505, 1.190), "DCOWL": (0.560, -1.505, 1.190),
    "H0": (0.000, -1.515, 1.140),
    "PRAILF": rail_xyz(-1, -2.00), "DRAILF": rail_xyz(+1, -2.00),
    "PRAIL16": rail_xyz(-1, -1.60), "DRAIL16": rail_xyz(+1, -1.60),
    "PRAIL07": rail_xyz(-1, -0.70), "DRAIL07": rail_xyz(+1, -0.70),
    "PRAIL005": rail_xyz(-1, 0.05), "DRAIL005": rail_xyz(+1, 0.05),
    "PRAIL12": rail_xyz(-1, 1.20), "DRAIL12": rail_xyz(+1, 1.20),
    "PRAIL16R": rail_xyz(-1, 1.60), "DRAIL16R": rail_xyz(+1, 1.60),
    "PRAIL18": rail_xyz(-1, 1.80), "DRAIL18": rail_xyz(+1, 1.80),
    "RX0": (0.000, 1.860, 0.660),
    # cab (firewall cab face above the toe board; under-dash crossbar; kick panels; sill)
    "C61": (0.500, -1.418, 0.900),        # the 61-pin's cab side, where the harness leaves the receptacle's rear
    "B61": (0.500, -1.392, 0.935),        # cab-side break-out over the 61-pin
    "FWD": (0.760, -1.360, 0.915), "PDMN": (0.140, -1.345, 0.925),
    "DASH0": (0.000, -1.300, 0.990), "COL": (0.465, -1.300, 0.990), "DASHD": (0.700, -1.300, 0.990), "DASHP": (-0.700, -1.300, 0.990),
    "KICKD": (0.760, -1.300, 0.860), "KICKP": (-0.760, -1.300, 0.860),
    "HDRD": (0.600, -0.880, 1.840), "HDR0": (0.000, -0.860, 1.860),
    "SILLR": (0.760, 0.020, 0.665), "RC": (0.550, 0.050, 0.645),
    "BODYC": (0.180, -0.620, 0.680), "TUNP": (-0.160, -0.850, 0.700),
    "DLP": (0.860, -1.120, 1.020), "DRP": (-0.860, -1.120, 1.020),
    "RD0": (0.780, 0.250, 0.880), "RD1": (0.600, 1.250, 0.880), "RD2": (0.800, 1.700, 0.880),
    "RP0": (-0.780, 0.250, 0.880), "RP1": (-0.600, 1.250, 0.880), "RP2": (-0.800, 1.700, 0.880),
    "TG": (0.700, 1.850, 0.760), "PILT": (0.820, 1.720, 1.330), "TOPR": (0.000, 1.780, 1.840),
    # underbody by the transmission and transfer case
    "UTP": (-0.150, -0.850, 0.630), "UTC": (0.160, -0.620, 0.620),
}

# ------------------------------------------------------------------ channel network
# (id, loom, fixed_to, [points]); the first and last point of each channel are its nodes.
CHANNELS = [
    # front loom from the bay power box (PDM32 proposed, passenger inner fender)
    ("F-BB", "front", "bay box bracket", [N["PDM15"], (-0.600, -1.760, 1.115), N["PBB"]]),
    ("F-PFEND", "front", "passenger inner-fender edge", [N["PBB"], N["PF2"]]),
    ("F-PFEND2", "front", "passenger inner-fender edge", [N["PF2"], (-0.540, -2.300, 1.160), N["PCS"]]),
    ("F-CORE-P", "front", "radiator (core) support, engine-side face above the radiator", [N["PCS"], N["CS0"]]),
    ("F-CORE-D", "front", "radiator (core) support, engine-side face above the radiator", [N["CS0"], N["DCS"]]),
    ("F-DFEND2", "front", "driver inner-fender edge", [N["DCS"], (0.540, -2.300, 1.160), N["DF2"]]),
    ("F-DFEND", "front", "driver inner-fender edge", [N["DF2"], N["DBB"]]),
    ("F-PCOWL", "front", "firewall corner seam (passenger)", [N["PBB"], N["PCOWL"]]),
    ("F-COWL-P", "front", "cowl seam", [N["PCOWL"], N["COWL0"]]),
    ("F-COWL-D", "front", "cowl seam", [N["COWL0"], N["DCOWL"]]),
    ("F-DCOWL", "front", "firewall corner seam (driver)", [N["DCOWL"], N["DBB"]]),
    ("F-TOHUB", "front", "cowl to the back of the intake (crosses to the engine)", [N["COWL0"], (0.000, -1.512, 1.165), N["H0"]]),
    ("F-61", "front", "from the 61-pin's engine boot up the firewall to the driver corner seam (outboard of the iBooster)",
     ["E0", (0.530, -1.590, 0.960), (0.555, -1.610, 1.080), (0.560, -1.620, 1.1487)]),
    ("F-PDOWN", "front", "passenger inner-fender wall, down to the frame rail", [N["PF2"], (-0.500, -2.040, 0.980), N["PRAILF"]]),
    ("F-DDOWN", "front", "driver inner-fender wall, down to the frame rail", [N["DF2"], (0.500, -2.040, 0.980), N["DRAILF"]]),
    ("F-STARTER", "front", "over the passenger frame rail behind the headers", [N["PRAIL16"], (-0.440, -1.480, 0.800), (-0.300, -1.460, 0.800)]),
    # frame rails (outboard web, upper half), front to rear
    ("U-PR-F", "under", "passenger frame rail, outboard web", rail_run(-1, -2.00, -1.60)),
    ("U-PR-M1", "under", "passenger frame rail, outboard web", rail_run(-1, -1.60, -0.70)),
    ("U-PR-M2", "under", "passenger frame rail, outboard web", rail_run(-1, -0.70, 0.05)),
    ("U-PR-K", "under", "passenger frame rail over the axle kick-up", rail_run(-1, 0.05, 1.20)),
    ("U-PR-R", "under", "passenger frame rail, rear section", rail_run(-1, 1.20, 1.60)),
    ("U-PR-T", "under", "passenger frame rail, rear tip", rail_run(-1, 1.60, 1.80)),
    ("U-DR-F", "under", "driver frame rail, outboard web", rail_run(+1, -2.00, -1.60)),
    ("U-DR-M1", "under", "driver frame rail, outboard web", rail_run(+1, -1.60, -0.70)),
    ("U-DR-M2", "under", "driver frame rail, outboard web", rail_run(+1, -0.70, 0.05)),
    ("U-DR-K", "rear", "driver frame rail over the axle kick-up", rail_run(+1, 0.05, 1.20)),
    ("U-DR-R", "rear", "driver frame rail, rear section", rail_run(+1, 1.20, 1.60)),
    ("U-DR-T", "rear", "driver frame rail, rear tip", rail_run(+1, 1.60, 1.80)),
    ("U-RX-D", "rear", "rear crossmember (height not probed)", [N["DRAIL18"], (0.300, 1.860, 0.660), N["RX0"]]),
    ("U-RX-P", "rear", "rear crossmember (height not probed)", [N["RX0"], (-0.300, 1.860, 0.660), N["PRAIL18"]]),
    ("U-TC", "under", "along the 6L90 and NP205 cases under the tunnel (path not sourced)", [N["UTP"], (-0.120, -0.760, 0.615), (0.000, -0.700, 0.600), N["UTC"]]),
    ("U-XM", "under", "to the driver rail along the transfer-case crossmember (path not sourced)", [N["UTC"], (0.300, -0.600, 0.600), rail_xyz(+1, -0.60)]),
    # cab: the firewall's cab face above the toe board, then the dash crossbar
    ("C-61", "cab", "rises off the 61-pin's cab side onto the firewall run", [N["C61"], (0.500, -1.400, 0.918), N["B61"]]),
    ("C-FW-D", "cab", "firewall cab face above the toe board, outboard (under the M130)", [N["B61"], (0.600, -1.400, 0.935), (0.700, -1.400, 0.935), N["FWD"]]),
    ("C-KF-D", "cab", "driver kick panel, front", [N["FWD"], (0.772, -1.325, 0.885), N["KICKD"]]),
    ("C-FW-P", "cab", "firewall cab face above the toe board and the tunnel, inboard (to the PDM30)",
     [N["B61"], (0.400, -1.392, 0.940), (0.250, -1.392, 0.940), (0.180, -1.372, 0.935), N["PDMN"]]),
    ("C-PDM-DASH", "cab", "up the tunnel's front to the dash centre", [N["PDMN"], (0.070, -1.318, 0.965), N["DASH0"]]),
    ("C-DASH-D2", "cab", "under-dash crossbar", [N["DASH0"], N["COL"]]),
    ("C-DASH-D1", "cab", "under-dash crossbar", [N["COL"], N["DASHD"]]),
    ("C-DASH-P", "cab", "under-dash crossbar", [N["DASH0"], N["DASHP"]]),
    ("C-KICK-D", "cab", "driver kick panel", [N["DASHD"], N["KICKD"]]),
    ("C-KICK-P", "cab", "passenger kick panel", [N["DASHP"], N["KICKP"]]),
    ("C-APIL-D", "cab", "driver A-pillar and header", [N["DASHD"], (0.790, -1.180, 1.250), (0.730, -1.000, 1.600), N["HDRD"]]),
    ("C-HEADER", "cab", "windshield header", [N["HDRD"], N["HDR0"]]),
    ("C-HEADER-P", "cab", "windshield header", [N["HDR0"], (-0.550, -0.870, 1.850)]),
    ("C-ROOF", "cab", "roof centre (headliner)", [N["HDR0"], (0.000, -0.400, 1.870)]),
    ("C-SILL-D", "cab", "inside the driver sill, under the sill plate", [N["KICKD"], (0.760, -1.120, 0.665), (0.760, -0.400, 0.665), N["SILLR"]]),
    ("C-REARCONN", "cab", "rear floor, driver side (the round rear connector)", [N["SILLR"], (0.620, 0.050, 0.660), N["RC"]]),
    ("C-STEP", "rear", "rear floor step into the rear body", [N["SILLR"], (0.780, 0.180, 0.870), N["RD0"]]),
    ("C-TUN-D", "cab", "driver side of the tunnel, to the floor grommet by the transfer case", [N["DASH0"], (0.150, -1.100, 0.790), N["BODYC"]]),
    ("C-TUN-P", "cab", "passenger side of the tunnel", [N["DASHP"], (-0.300, -1.200, 0.900), N["TUNP"]]),
    # doors (from the kick panel through the hinge side into the door)
    ("D-L-HINGE", "door", "driver door hinge side (pass-through)", [N["KICKD"], (0.820, -1.150, 0.950), N["DLP"]]),
    ("D-L", "door", "driver door inner panel", [N["DLP"], (0.900, -1.000, 0.950), (0.900, -0.600, 0.950), (0.900, -0.250, 1.000)]),
    ("D-R-HINGE", "door", "passenger door hinge side (pass-through)", [N["KICKP"], (-0.820, -1.150, 0.950), N["DRP"]]),
    ("D-R", "door", "passenger door inner panel", [N["DRP"], (-0.900, -1.000, 0.950), (-0.900, -0.600, 0.950), (-0.900, -0.250, 1.000)]),
    # rear body inside (floor edge, inboard of the wheelhouse), across the rear floor, tailgate, rear pillar and top
    ("R-D1", "rear", "rear body floor edge, driver", [N["RD0"], (0.600, 0.320, 0.880), N["RD1"]]),
    ("R-D2", "rear", "rear body side panel, driver, behind the wheelhouse", [N["RD1"], (0.800, 1.320, 0.880), N["RD2"]]),
    ("R-X", "rear", "across the rear floor, under the covering", [N["RD0"], (0.000, 0.250, 0.865), N["RP0"]]),
    ("R-P1", "rear", "rear body floor edge, passenger", [N["RP0"], (-0.600, 0.320, 0.880), N["RP1"]]),
    ("R-P2", "rear", "rear body side panel, passenger, behind the wheelhouse", [N["RP1"], (-0.800, 1.320, 0.880), N["RP2"]]),
    ("R-TG", "rear", "tailgate hinge boot (driver)", [N["RD2"], (0.780, 1.800, 0.780), N["TG"]]),
    ("R-TGATE", "rear", "inside the tailgate shell, along its lower edge (path not sourced)", [N["TG"], (0.600, 1.870, 0.900), (0.000, 1.870, 0.920), (-0.600, 1.870, 0.920)]),
    ("R-UP-D", "rear", "rear pillar, driver (to the top)", [N["RD2"], N["PILT"]]),
    ("R-TOP", "rear", "rear edge of the removable top (a top disconnect at the pillar is the top-design lane's candidate)", [N["PILT"], (0.790, 1.760, 1.780), N["TOPR"]]),
    ("R-TOP-C", "rear", "along the top's centre line to the cargo lamp", [N["TOPR"], (0.000, 1.300, 1.860)]),
]
# crossing edges: the only links between zones (id, loom, what, [points], allowed tag). "E0" is replaced by the
# 61-pin's engine-side boot end (harness_full.py computes it from the plug stack).
CROSSINGS = [
    ("X-61PIN", "cab", "the 61-pin D38999 at the fuse-box hole (owner call 0ah)", ["E0", N["C61"]], "61pin"),
    ("X-H3", "cab", "factory hole H3: the cab power box's feed and ground (the exception under review)", [(-0.357, -1.500, 0.935), (-0.357, -1.420, 0.935)], "h3"),
    ("X-REAR", "rear", "rear round connector through the floor (REAR-CONN, proposed)", [N["RC"], (0.520, 0.050, 0.600), N["DRAIL005"]], "rear"),
    ("X-TRANS", "under", "tunnel grommet for the PCS harness (proposed round)", [N["TUNP"], N["UTP"]], "trans"),
    ("X-BODYC", "under", "floor grommet by the transfer case (FIREWALL-BODY-C)", [N["BODYC"], (0.170, -0.620, 0.650), N["UTC"]], "bodyc"),
    ("X-AMPPASS", "rear", "rear floor pass-through for the amp (AMP-PASS, CableClam)", [N["RD1"], (0.550, 1.300, 0.850), rail_xyz(+1, 1.30)], "amp"),
]
# which endpoints may attach to which channels (zone of each channel group)
ZONE_CHANNELS = {
    "engine": None,   # engine devices attach through the engine loom tree (fixed drops) or the nearest bay channel
    "bay": ["F-BB", "F-PFEND", "F-PFEND2", "F-CORE-P", "F-CORE-D", "F-DFEND2", "F-DFEND", "F-PCOWL", "F-COWL-P", "F-COWL-D", "F-DCOWL", "F-STARTER", "F-PDOWN", "F-DDOWN"],
    "cab": ["C-61", "C-FW-D", "C-KF-D", "C-FW-P", "C-PDM-DASH", "C-DASH-D2", "C-DASH-D1", "C-DASH-P", "C-KICK-D", "C-KICK-P", "C-APIL-D", "C-HEADER", "C-HEADER-P", "C-ROOF", "C-SILL-D", "C-TUN-D", "C-TUN-P"],
    "door_L": ["D-L"], "door_R": ["D-R"],
    "rear_in": ["R-D1", "R-D2", "R-X", "R-P1", "R-P2", "R-TG", "R-TGATE", "R-UP-D", "R-TOP", "R-TOP-C"],
    "rear_out": ["U-DR-K", "U-DR-R", "U-DR-T", "U-RX-D", "U-RX-P", "U-PR-K", "U-PR-R", "U-PR-T"],
    "under": ["U-PR-F", "U-PR-M1", "U-PR-M2", "U-DR-F", "U-DR-M1", "U-DR-M2", "U-TC", "U-XM"],
}


def zone_of_end(eid, pos, mounts_zone):
    z = (mounts_zone or "").lower()
    if eid.startswith(("DOOR-L", "WIN-SW-L", "LOCK-SW-L")) or eid in ("lock_actuator_DS", "window_motor_DS", "SPK-FL"):
        return "door_L"
    if eid.startswith(("DOOR-R", "WIN-SW-R", "LOCK-SW-R")) or eid in ("lock_actuator_PS", "window_motor_PS", "SPK-FR"):
        return "door_R"
    if z == "underbody":
        return "under"
    if z == "rear":
        # lamps and camera at the back, the tank: outside (off the frame); the rest inside the body
        if eid.startswith(("Tail_Light", "Backup_Light", "MARKER-L", "MARKER-R")) or eid in ("LICENSE-LAMP", "Backup_Camera", "FUEL-PUMP", "FUEL-LEVEL", "SPL-FUEL-SND"):
            return "rear_out"
        return "rear_in"
    if z == "cab":
        return "cab"
    if z == "doors":
        return "door_L" if pos[0] > 0 else "door_R"
    return "bay"


# ------------------------------------------------------------------ geometry helpers
def seglen(P):
    P = np.asarray(P, float)
    return float(np.sum(np.linalg.norm(np.diff(P, axis=0), axis=1)))


def nearest_on(P, q):
    """Nearest point on polyline P to q: (distance, segment index, t, point)."""
    P = np.asarray(P, float); q = np.asarray(q, float)
    best = (1e9, 0, 0.0, P[0])
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]; ab = b - a; L2 = float(ab @ ab)
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, float((q - a) @ ab) / L2))
        p = a + t * ab; d = float(np.linalg.norm(q - p))
        if d < best[0]:
            best = (d, i, t, p)
    return best


def split_at(P, i, t):
    P = [np.asarray(p, float) for p in P]
    p = P[i] + t * (P[i + 1] - P[i])
    left = P[:i + 1] + [p]; right = [p] + P[i + 1:]
    clean = lambda Q: [Q[0]] + [Q[k] for k in range(1, len(Q)) if np.linalg.norm(Q[k] - Q[k - 1]) > 1e-6]
    return clean(left), clean(right), p


def drop_path(a, b):
    """A drop from a channel point a to a device b: leave the channel square, then run to the device."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    if np.linalg.norm(d) < 0.03:
        return [a.tolist(), b.tolist()]
    k = int(np.argmax(np.abs(d)))
    m = a.copy(); m[k] = a[k] + 0.6 * d[k]
    return [a.tolist(), m.tolist(), b.tolist()]


class Graph:
    def __init__(self):
        self.nodes = {}       # key -> xyz
        self.edges = {}       # eid -> dict(a, b, pts, loom, fixed_to, kind, allowed)
        self.adj = defaultdict(list)
        self.terminal = set()  # device ports: a path may start or end here, never pass through

    def key(self, p):
        return tuple(int(round(c / 0.002)) for c in p)

    def add_node(self, p):
        k = self.key(p)
        self.nodes.setdefault(k, tuple(float(c) for c in p))
        return k

    def add_edge(self, eid, pts, loom, fixed_to, kind="channel", allowed=None, device=None):
        a = self.add_node(pts[0]); b = self.add_node(pts[-1])
        self.edges[eid] = {"id": eid, "a": a, "b": b, "pts": [list(map(float, p)) for p in pts], "loom": loom,
                           "fixed_to": fixed_to, "kind": kind, "allowed": allowed, "device": device, "len": seglen(pts)}
        self.adj[a].append(eid); self.adj[b].append(eid)

    def remove_edge(self, eid):
        e = self.edges.pop(eid)
        self.adj[e["a"]].remove(eid); self.adj[e["b"]].remove(eid)
        return e

    def attach(self, eid, q, snap=0.025):
        """Split channel eid at the point nearest q; return the new node key (a break-out on that channel)."""
        e = self.edges[eid]
        d, i, t, p = nearest_on(e["pts"], q)
        L = e["pts"]
        if np.linalg.norm(np.asarray(L[0]) - p) < snap:
            return e["a"]
        if np.linalg.norm(np.asarray(L[-1]) - p) < snap:
            return e["b"]
        left, right, p = split_at(L, i, t)
        self.remove_edge(eid)
        base = eid.split("~")[0]
        n = 1
        while f"{base}~{n}" in self.edges:
            n += 1
        self.add_edge(f"{base}~{n}", left, e["loom"], e["fixed_to"], e["kind"], e["allowed"])
        m = n + 1
        while f"{base}~{m}" in self.edges:
            m += 1
        self.add_edge(f"{base}~{m}", right, e["loom"], e["fixed_to"], e["kind"], e["allowed"])
        return self.key(p)

    def path(self, src, dst, allowed):
        dist = {src: 0.0}; prev = {}; pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                break
            if d > dist.get(u, 1e18):
                continue
            if u != src and u in self.terminal:
                continue    # never route through a device port
            for eid in self.adj[u]:
                e = self.edges[eid]
                if e["kind"] == "crossing" and e["allowed"] not in allowed:
                    continue
                if e["kind"] == "device" and u != src and self.other(e, u) != dst:
                    continue    # never route through someone else's device drop
                v = self.other(e, u)
                nd = d + e["len"] + (0.05 if e["kind"] == "crossing" else 0.0)
                if nd < dist.get(v, 1e18):
                    dist[v] = nd; prev[v] = (u, eid); heapq.heappush(pq, (nd, v))
        if dst not in dist:
            return None
        out, u = [], dst
        while u != src:
            pu, eid = prev[u]; out.append(eid); u = pu
        return list(reversed(out))

    @staticmethod
    def other(e, u):
        return e["b"] if e["a"] == u else e["a"]
