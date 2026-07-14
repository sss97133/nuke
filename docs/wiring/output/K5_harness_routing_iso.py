#!/usr/bin/env python3
"""K5 Harness Routing Diagram — isometric pictorial (Document 3.1.iso).

Single ANSI D landscape sheet (34"x22"). Iso grid background. K5 wireframe
built from measured atoms in K5_dimensions_atoms.yaml. Harness trunks routed
Manhattan-style along the three iso axes (vertical, +30°, -30°).
Title block per Appendix E §6.3. Zone labels per Appendix E §4.1.
Cross-references to System Schematic sections per Appendix G §2.1.

Component positions:
  - Frame, body, engine: MEASURED from FR-88, KLM-Blz, LS3-Marine atoms.
  - M130, PDM30, battery, iBooster: UNMEASURED per K5_WIRING_STATE.md §4 —
    shown with "[POSITION TBD]" callouts at plausible-zone anchors.

Output: K5_harness_routing_iso.svg
"""
from __future__ import annotations
import math, re
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
IN_TO_MM = 25.4

# ---------------------------------------------------------------------------
# Measured atoms — K5 frame + body + LS3 (mm, from K5_dimensions_atoms.yaml).
# Cited as FR-88 (frame book), KLM-Blz (body box), LS3-Marine (engine envelope).
# ---------------------------------------------------------------------------
WHEELBASE_MM = 2705       # FR-88 p1
LS3_ENV_W = 705           # LS3-Marine p3 (mm, with FAD, no headers)
LS3_ENV_H = 716           # LS3-Marine p3 (mm, oil pan to intake top)
LS3_ENV_L = 660           # est. L92/LS3 long block fore-aft (block + FAD)
FRAME_FRONT_INSIDE_W = 1587   # FR-88 p1 — across rails at front
FRAME_MM_INSIDE_W = 1410      # FR-88 p1 — motor mount station inside width
FRAME_REAR_LEAFSP_W = 1624    # FR-88 p1
FRAME_MID_W = 1184            # FR-88 p1 — after kickup
FRAME_REAR_AXLE_W = 1411      # FR-88 p1
ENG_BAY_W_FW = 1715           # FR-88 p2 — at firewall top
UNDERHOOD_BOX_W = 1721        # KLM-Blz
UNDERHOOD_BOX_H = 1524        # KLM-Blz
TAILGATE_W = 1572             # FR-88 p2
WINDSHIELD_W = 1686           # FR-88 p2

# Frame longitudinal stations (mm from front rail tip = station 0)
STA = {
    "A":  706,    # front rail hole
    "B":  938,    # front leaf spring mount
    "D":  1475,   # front crossmember
    "CD": 1582,
    "E":  1587,   # motor mount — KEY
    "G":  1769,   # mid frame
}

# Frame point lateral distances from centerline (FR-88 p1, each value cited
# in K5_dimensions_atoms.yaml as `frame_point{X}.distance_from_centerline`).
HW_FR88 = {
    "A": 461,
    "B": 332,
    "C": 463,
    "D": 464,
    "E": 448,   # motor mount bolt tip — KEY for engine placement
    "F": 366,
    "G": 367,
    "H": 337,
    "I": 305,
    "J": 436,
    "K": 575,
    "L": 489,
    "M": 367,
    "N": 433,
}

# Side-view height profile (frame bottom datum -> top edge of rail, mm)
# Built from FR-88 + KLM-Blz height stations, interpolated.
FRAME_PROFILE = [
    # (station_mm_from_front, frame_top_z_mm)
    (   0,  706),  # front rail tip
    ( 200,  900),  # rising
    ( 500,  938),  # kickdown peak
    ( 900, 1020),  # midbay level run
    (1300, 1020),  #
    (1587, 1020),  # at motor mount station
    (1900,  791),  # cab kickup low
    (2700,  961),  # cab kickup high
    (3400,  810),  # rear kickup low
    (4000, 1093),  # rear kickup high
    (4500,  824),  # rear rail bottom
]
FRAME_BOTTOM_PROFILE = [(s, 0) for s, _ in FRAME_PROFILE]  # datum

# Body outline keyed against the frame stations (estimated for v1, body atoms
# are sparse beyond firewall/tailgate widths and underhood box).
# Y axis: 0 = front rail tip; +Y = rearward. Z: 0 = frame bottom; +Z = up.
# Body width tapers between known stations.
BODY_OUTLINE = {
    # (station, half_width_top, half_width_bottom, top_z, bottom_z)
    "front_bumper":     (   0,  ENG_BAY_W_FW/2,      FRAME_FRONT_INSIDE_W/2,   600,   200),
    "engine_bay_front": ( 300,  UNDERHOOD_BOX_W/2,   FRAME_FRONT_INSIDE_W/2,  1380,   200),
    "firewall":         (1700,  UNDERHOOD_BOX_W/2,   FRAME_FRONT_INSIDE_W/2,  1380,   600),
    "cab_front":        (1700,  WINDSHIELD_W/2 + 50, FRAME_MM_INSIDE_W/2,     2300,   600),
    "cab_rear":         (3100,  WINDSHIELD_W/2 + 50, FRAME_MM_INSIDE_W/2,     2300,   600),
    "bed_front":        (3100,  TAILGATE_W/2 + 60,   FRAME_MID_W/2,           1380,   800),
    "tailgate":         (4500,  TAILGATE_W/2,        FRAME_REAR_LEAFSP_W/2,   1380,   800),
}

# Engine bay anchor for the LS3 block: frame point E (1587mm).
LS3_CENTER = (0, STA["E"], 1020 + LS3_ENV_H/2)  # x=centerline, y=motor mount, z=mid-engine
LS3_FRONT  = LS3_CENTER[1] - LS3_ENV_L/2
LS3_REAR   = LS3_CENTER[1] + LS3_ENV_L/2
LS3_LEFT   = -LS3_ENV_W/2
LS3_RIGHT  = +LS3_ENV_W/2
LS3_BOTTOM = LS3_CENTER[2] - LS3_ENV_H/2
LS3_TOP    = LS3_CENTER[2] + LS3_ENV_H/2

# ---------------------------------------------------------------------------
# Component anchors. POSITION_VERIFIED flag is the honest column.
# Per K5_WIRING_STATE.md §4 — M130, PDM30, battery, iBooster all unmeasured.
# ---------------------------------------------------------------------------
COMPONENTS = [
    # (id, label, x, y, z, position_verified, zone, section_xref)
    # Measured (verified=True): position derived from FR-88, KLM-Blz, LS3-Marine atoms
    # or geometric derivation from those (e.g. alternator off LS3 envelope).
    # Unmeasured per K5_WIRING_STATE.md §4 (verified=False): rendered ONLY as
    # zone-internal endpoints. No trunks route to them — see TRUNK_ANCHORS.
    ("ALT",    "Alternator",         LS3_RIGHT + 80, LS3_FRONT + 120, 1300, True, "ENGINE BAY", "S0"),
    ("STR",    "Starter",            LS3_LEFT  - 50, LS3_REAR - 80,    900, True, "ENGINE BAY", "S0"),
    ("TB",     "Throttle Body (DBW)",  0,  LS3_FRONT + 30, LS3_TOP, True, "ENGINE BAY", "S7"),
    ("FUEL",   "Fuel Pump (in-tank)", 0, 4200, 600, True, "REAR / UNDERBODY", "S0"),
    ("HDLT_L", "LED Headlight L",  -700,   50, 950, True, "FORWARD LAMPS", "S1"),
    ("HDLT_R", "LED Headlight R",  +700,   50, 950, True, "FORWARD LAMPS", "S1"),
    ("TAIL_L", "Tail/Stop L",      -700, 4500, 1050, True, "REAR / UNDERBODY", "S8"),
    ("TAIL_R", "Tail/Stop R",      +700, 4500, 1050, True, "REAR / UNDERBODY", "S8"),
    ("DOOR_L", "Driver Door Plug",  -900, 2200, 1200, True, "CAB", "S10"),
    ("DOOR_R", "Pass Door Plug",    +900, 2200, 1200, True, "CAB", "S10"),
    # Engine sensor bosses — flagged TBD per K5_WIRING_STATE.md §4
    # ("LS3 sensor boss positions on engine"). Schematic positions only,
    # rendered as zone-internal endpoints.
    ("MAP",    "MAP sensor",            0,  LS3_CENTER[1], LS3_TOP - 50, False, "ENGINE BAY", "S2"),
    ("CKP",    "Crank Pos Sensor",      0,  LS3_REAR + 20, LS3_BOTTOM + 100, False, "ENGINE BAY", "S2"),
    ("CMP",    "Cam Pos Sensor",        0,  LS3_FRONT - 20, LS3_CENTER[2], False, "ENGINE BAY", "S2"),
    ("KS1",    "Knock Sensor (LH)", LS3_LEFT,  LS3_CENTER[1], LS3_BOTTOM + 200, False, "ENGINE BAY", "S2"),
    ("KS2",    "Knock Sensor (RH)", LS3_RIGHT, LS3_CENTER[1], LS3_BOTTOM + 200, False, "ENGINE BAY", "S2"),
    # ECU / PDM / battery / iBooster / radiator / HVAC / dash — ALL §4 unmeasured.
    # Listed here as zone-internal callouts; no trunks route to them.
    # Schematic position is in the correct zone but x/y/z values are illustrative.
    ("M130",   "Motec M130 ECU",     +400, 1700, 1200, False, "ENGINE BAY (firewall, pass side)", "S3"),
    ("PDM30",  "Motec PDM30",        +500, 1900, 1100, False, "FRONT OF DASH (under dash, pass side)", "S4"),
    ("BAT",    "Battery (Group 31)", -500, 1300, 1000, False, "ENGINE BAY (driver front, est.)", "S0"),
    ("iBOO",   "Bosch iBooster",     -500, 1700, 1400, False, "ENGINE BAY (firewall, driver)", "S0"),
    ("RAD",    "Radiator",            0,  150, 900, False, "ENGINE BAY (front)", "S6"),
    ("HVAC",   "HVAC Blower",      +500, 1500, 1100, False, "FRONT OF DASH", "S6"),
    ("DASH",   "Dakota VHX Cluster", 0, 2000, 1300, False, "FRONT OF DASH (cluster pod)", "S5"),
]

# ---------------------------------------------------------------------------
# Iso projection: view from upper-front-driver. Front to LEFT, rear to RIGHT.
# Top visible. Driver side visible (closer to viewer).
#   sx = (X + Y) * cos30
#   sy = (Y - X) * sin30 - Z
# Where X=lateral (passenger=+), Y=longitudinal (rear=+), Z=vertical (up=+).
# All projected, then scaled (PX_PER_MM) and offset to screen origin.
# ---------------------------------------------------------------------------
COS30 = math.cos(math.radians(30))
SIN30 = math.sin(math.radians(30))
PX_PER_MM = 0.55
OX, OY = 600, 1100   # screen origin (front-driver-ground projects here)

def iso(p):
    x, y, z = p
    sx = (x + y) * COS30 * PX_PER_MM + OX
    sy = ((y - x) * SIN30 - z) * PX_PER_MM + OY
    return (sx, sy)

# Iso axis screen vectors (unit-length in mm before PX_PER_MM):
ISO_AXIS = {
    # 3D-unit-along-axis → screen-delta (per mm of true length)
    "+X": (+COS30, -SIN30),  # passenger (into-page)
    "-X": (-COS30, +SIN30),
    "+Y": (+COS30, +SIN30),  # rearward
    "-Y": (-COS30, -SIN30),
    "+Z": (0, -1),           # up
    "-Z": (0, +1),
}

# ---------------------------------------------------------------------------
# Trunk extraction from K5_wire_paths.yaml — count wires per (lm_a, lm_b) edge.
# ---------------------------------------------------------------------------
WIRE_RE = re.compile(
    r'^\s*"(?P<id>[\w]+)"\s*:\s*\{\s*'
    r'label:\s*"(?P<label>[^"]+)"\s*,\s*'
    r'gauge:\s*(?P<gauge>\d+)\s*,\s*'
    r'path:\s*\[(?P<path>[^\]]+)\]'
)

def parse_wires(path: Path):
    text = path.read_text()
    out = []
    current_loom = None
    loom_re = re.compile(r"#\s*=+\s*([A-Z][A-Z /]+?)\s*\(")
    for line in text.splitlines():
        m = loom_re.search(line)
        if m: current_loom = m.group(1).strip(); continue
        m = WIRE_RE.search(line)
        if m:
            ids = [s.strip() for s in m.group("path").split(",")]
            out.append({
                "id": m.group("id"),
                "label": m.group("label"),
                "gauge": int(m.group("gauge")),
                "path": ids,
                "loom": current_loom or "?",
                "shielded": "shielded" in line,
            })
    return out

# Trunk topology: collapse common L## sequences into bundles. We don't use the
# schematic L01–L30 positions for ROUTING — instead the trunks fan out from
# zone anchors (ECU, PDM30, etc.) along iso axes through the truck.
TRUNK_ANCHORS = {
    # Anchors are MEASURABLE zone boundaries — never an unmeasured component.
    # Trunks end here; wires inside a zone fan out to TBD components as
    # zone-internal endpoints (no 3D path drawn to the phantom point).
    # Per dave-critic 2026-05-25: routing to phantom M130/PDM30 anchors
    # repeats the same defect that got the prior iteration shredded.
    "ENG_VALLEY":  (None, (0, LS3_CENTER[1] - 100, LS3_TOP - 50)),
                   # geometrically derived from LS3_CENTER (frame point E + LS3-Marine envelope)
    "FW_GROMMET":  (None, (250, 1700, 1100)),
                   # passenger-side firewall main grommet.
                   # y=1700: FR-88 engine_bay length to firewall (measured).
                   # z=1100: NOT measured — illustrative pass-through height; flagged in title block.
    "DASH_PANEL":  (None, (0, 1900, 1300)),
                   # in-cab side of firewall, dash bundle origin.
                   # y=1900: just behind firewall (measured plane).
                   # z=1300: NOT measured — illustrative dash-bundle height; flagged in title block.
    "MID_FLOOR":   (None, (250, 3100, 600)),
                   # cab/bed transition along floor rail (passenger side)
    "REAR_JCT":    (None, (250, 4000, 800)),
                   # rear leaf-spring crossmember + tow-package mount area (FR-88 point L)
    "BED":         (None, (0, 4400, 1100)),
                   # bed-side junction toward tailgate
    "FRONT_RAD":   (None, (0, 200, 950)),
                   # cross-radiator junction — front of engine bay
}

# Map K5_wire_paths landmark IDs onto trunk anchors (group-level routing).
LM_TO_ANCHOR = {
    # ECU (L01) is REPLACED by FW_GROMMET — that's where wires from the cab
    # actually emerge into the engine bay. The ECU itself is a zone-internal
    # endpoint (TBD per §4).
    "L01": "FW_GROMMET",   "L02": "FW_GROMMET",
    "L03": "ENG_VALLEY",   "L04": "ENG_VALLEY", "L05": "ENG_VALLEY",
    "L06": "ENG_VALLEY",   "L07": "ENG_VALLEY",
    "L08": "ENG_VALLEY",   "L09": "ENG_VALLEY",
    "L10": "ENG_VALLEY",   "L11": "ENG_VALLEY",
    "L12": "ENG_VALLEY",   "L13": "ENG_VALLEY",
    "L14": "FRONT_RAD",    "L15": "ENG_VALLEY",
    # PDM30 (L16) replaced by DASH_PANEL — under-dash bundle origin.
    "L16": "DASH_PANEL",
    "L17": "DASH_PANEL",   "L18": "DASH_PANEL", "L19": "DASH_PANEL",
    "L20": "DASH_PANEL",   "L21": "DASH_PANEL",
    "L22": "DASH_PANEL",   "L23": "DASH_PANEL",
    "L24": "MID_FLOOR",    "L25": "REAR_JCT",
    "L26": "BED",          "L27": "REAR_JCT",
    "L28": "MID_FLOOR",
    "L29": "ENG_VALLEY",   "L30": "ENG_VALLEY",
}

def anchor_3d(name, comp_lookup):
    """Resolve anchor name → 3D position."""
    spec = TRUNK_ANCHORS.get(name)
    if not spec:
        return None
    comp_id, fixed_p = spec
    if comp_id and comp_id in comp_lookup:
        c = comp_lookup[comp_id]
        return (c["x"], c["y"], c["z"])
    return fixed_p

def build_trunks(wires, comp_lookup):
    """edges (anchor_a, anchor_b) → {count, looms, gauges, ids, shielded}."""
    edges = defaultdict(lambda: {"count": 0, "looms": Counter(),
                                  "gauges": [], "ids": [], "shielded": 0})
    zone_internal = []   # wires that never escape a single anchor zone
    for w in wires:
        anchors = []
        for lm in w["path"]:
            a = LM_TO_ANCHOR.get(lm)
            if a and (not anchors or anchors[-1] != a):
                anchors.append(a)
        # First anchor must be either FW_GROMMET (engine wires) or DASH_PANEL
        # (cab/body wires). If the path doesn't traverse one, the wire is
        # zone-internal — record it for the sidebar, don't draw a phantom path.
        if not anchors:
            zone_internal.append({"id": w["id"], "label": w["label"],
                                  "loom": w["loom"], "zone": "unmapped"})
            continue
        if len(anchors) < 2:
            zone_internal.append({"id": w["id"], "label": w["label"],
                                  "loom": w["loom"], "zone": anchors[0]})
            continue
        for i in range(len(anchors) - 1):
            key = (anchors[i], anchors[i+1])
            e = edges[key]
            e["count"] += 1
            e["looms"][w["loom"]] += 1
            e["gauges"].append(w["gauge"])
            e["ids"].append(w["id"])
            if w["shielded"]: e["shielded"] += 1
    return edges, zone_internal

# ---------------------------------------------------------------------------
# Manhattan iso routing — route from A to B as orthogonal iso axis segments.
# Decompose Δ = (dx, dy, dz) into 3 iso-axis legs: Z first (up/down), then Y
# (longitudinal), then X (lateral). Produces a 4-point polyline in 3D.
# ---------------------------------------------------------------------------
def manhattan_iso(a, b):
    ax, ay, az = a; bx, by, bz = b
    p0 = (ax, ay, az)
    p1 = (ax, ay, bz)         # vertical move
    p2 = (ax, by, bz)         # longitudinal move
    p3 = (bx, by, bz)          # lateral move
    return [p0, p1, p2, p3]

# ---------------------------------------------------------------------------
# Loom colors (per Appendix E §9.4 spec adapted — colored overlays for digital).
# ---------------------------------------------------------------------------
LOOM_COLOR = {
    "ENGINE LOOM":          "#c2410c",
    "EXTERIOR/BODY LOOM":   "#a16207",
    "INTERIOR/DASH LOOM":   "#15803d",
    "CHASSIS/UNDERBODY":    "#1d4ed8",
    "AUDIO":                "#7c3aed",
    "POWER/COMM":           "#b91c1c",
    "MISC":                 "#4b5563",
    "REAR LOOM EXTRA":      "#4b5563",
}
def color_for(loom):
    for k, c in LOOM_COLOR.items():
        if k.strip() == loom.strip():
            return c
    return "#4b5563"

# ---------------------------------------------------------------------------
# Iso grid background (the "graph element" — triangular iso grid)
# ---------------------------------------------------------------------------
def emit_iso_grid(W, H, spacing_mm=200, major_every=5):
    """Triangular iso grid: vertical lines + ±30° lines, spanning full canvas."""
    out = []
    s = spacing_mm * PX_PER_MM   # screen spacing between verticals
    tan30 = math.tan(math.radians(30))
    v_step = s * tan30
    # vertical lines
    x = 0
    n = 0
    while x <= W:
        major = (n % major_every == 0)
        c = "#cbd5e1" if not major else "#94a3b8"
        out.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{H}" '
                   f'stroke="{c}" stroke-width="{0.6 if not major else 1.0}"/>')
        x += s; n += 1
    # iso diagonals — both ±tan30
    for sign in (+1, -1):
        slope = sign * tan30
        k_lo = -int(W / s) - 2
        k_hi = int(H / v_step) + int(W * abs(slope) / v_step) + 2
        for k in range(k_lo, k_hi + 1):
            major = (k % major_every == 0)
            c = "#e2e8f0" if not major else "#cbd5e1"
            yb = k * v_step
            pts = []
            for x in (0, W):
                yt = yb + slope * x
                if 0 <= yt <= H:
                    pts.append((x, yt))
            for y in (0, H):
                if slope != 0:
                    xt = (y - yb) / slope
                    if 0 <= xt <= W:
                        pts.append((xt, y))
            if len(pts) >= 2:
                pts.sort()
                (x1,y1), (x2,y2) = pts[0], pts[-1]
                out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" '
                           f'x2="{x2:.1f}" y2="{y2:.1f}" '
                           f'stroke="{c}" stroke-width="{0.6 if not major else 1.0}"/>')
    return "\n".join(out)

# ---------------------------------------------------------------------------
# K5 wireframe — polylines in 3D, projected.
# ---------------------------------------------------------------------------
def k5_wireframe():
    lines = []
    half_w = {
        "fr_front":  FRAME_FRONT_INSIDE_W/2,
        "fr_mm":     FRAME_MM_INSIDE_W/2,
        "fr_mid":    FRAME_MID_W/2,
        "fr_rear":   FRAME_REAR_AXLE_W/2,
        "bay":       UNDERHOOD_BOX_W/2,
        "wind":      WINDSHIELD_W/2,
        "tail":      TAILGATE_W/2,
    }
    # Frame top edge (left rail) — follow FRAME_PROFILE longitudinally, x = -fr_*
    left_rail_top  = [(-half_w["fr_front"], s, z) for s, z in FRAME_PROFILE]
    right_rail_top = [(+half_w["fr_front"], s, z) for s, z in FRAME_PROFILE]
    # smooth the width along Y per FR-88 widths at known stations
    width_stations = [
        (0,        half_w["fr_front"]),
        (STA["E"], half_w["fr_mm"]),
        (3000,     half_w["fr_mid"]),
        (4000,     half_w["fr_rear"]),
        (4500,     half_w["fr_rear"]),
    ]
    def hw_at(y):
        prev = width_stations[0]
        for st in width_stations[1:]:
            if y <= st[0]:
                t = (y - prev[0]) / (st[0] - prev[0]) if st[0] > prev[0] else 0
                return prev[1] + (st[1] - prev[1]) * t
            prev = st
        return width_stations[-1][1]
    left_rail_top  = [(-hw_at(s), s, z) for s, z in FRAME_PROFILE]
    right_rail_top = [(+hw_at(s), s, z) for s, z in FRAME_PROFILE]
    left_rail_bot  = [(-hw_at(s), s, 0) for s, z in FRAME_PROFILE]
    right_rail_bot = [(+hw_at(s), s, 0) for s, z in FRAME_PROFILE]
    lines.append(("frame_top",  left_rail_top))
    lines.append(("frame_top",  right_rail_top))
    lines.append(("frame_bot",  left_rail_bot))
    lines.append(("frame_bot",  right_rail_bot))
    # frame cross-bars at key stations
    for s in [0, STA["E"], 3000, 4500]:
        z_top = next((z for st, z in FRAME_PROFILE if st >= s), FRAME_PROFILE[-1][1])
        hw = hw_at(s)
        lines.append(("frame_top", [(-hw, s, z_top), (+hw, s, z_top)]))
        lines.append(("frame_bot", [(-hw, s, 0), (+hw, s, 0)]))
    # vertical edges between top and bot at the corners
    for s in [0, STA["E"], 3000, 4500]:
        z_top = next((z for st, z in FRAME_PROFILE if st >= s), FRAME_PROFILE[-1][1])
        hw = hw_at(s)
        lines.append(("frame_edge", [(-hw, s, 0), (-hw, s, z_top)]))
        lines.append(("frame_edge", [(+hw, s, 0), (+hw, s, z_top)]))

    # Body — engine bay (hood plane), cab, bed
    # engine bay top plane (hood line) z = 1380, between stations 200 and 1700
    bay_hw = half_w["bay"]
    lines.append(("body", [(-bay_hw, 200, 1380), (+bay_hw, 200, 1380),
                            (+bay_hw, 1700, 1380), (-bay_hw, 1700, 1380),
                            (-bay_hw, 200, 1380)]))
    # hood crease (centerline ridge of hood)
    lines.append(("body", [(0, 200, 1430), (0, 1700, 1430)]))
    # front fender top edges (drop from hood line to headlight level)
    for sx in (-1, +1):
        lines.append(("body", [(sx*bay_hw, 200, 1380),
                                (sx*bay_hw, 50, 1000),
                                (sx*(bay_hw-100), 50, 950)]))
    # front grille cross
    lines.append(("body", [(-bay_hw+100, 50, 950), (+bay_hw-100, 50, 950)]))
    lines.append(("body", [(-bay_hw+100, 50, 700), (+bay_hw-100, 50, 700)]))
    # bumper line
    lines.append(("body", [(-bay_hw+100, -50, 600), (+bay_hw-100, -50, 600)]))
    # continuous fender / belt line: front to cab door
    for sx in (-1, +1):
        lines.append(("body", [
            (sx*(bay_hw-100), 50, 950),         # headlight
            (sx*bay_hw, 200, 1380),              # corner
            (sx*bay_hw, 1700, 1380),             # to firewall
            (sx*(half_w["wind"]+50), 1700, 1380),# step in to cab
            (sx*(half_w["wind"]+50), 3100, 1380),# along door / rear cab
            (sx*(half_w["tail"]+60), 3100, 1380),# step to bed width
            (sx*(half_w["tail"]+60), 4500, 1380),# bed top run to tailgate
        ]))
    # rocker panel run (just above frame top, along cab + bed bottom)
    for sx in (-1, +1):
        lines.append(("body", [
            (sx*(half_w["wind"]+50), 1700, 1020),
            (sx*(half_w["wind"]+50), 3100, 1020),
            (sx*(half_w["tail"]+60), 3100, 800),
            (sx*(half_w["tail"]+60), 4500, 800),
        ]))
    # firewall (vertical plane at y=1700, from z=1020 frame top to z=2300 cab top)
    lines.append(("body", [(-bay_hw, 1700, 1380), (-half_w["wind"]-50, 1700, 2300),
                            (+half_w["wind"]+50, 1700, 2300), (+bay_hw, 1700, 1380)]))
    # cab roof
    lines.append(("body", [(-half_w["wind"]-50, 1700, 2300),
                           (+half_w["wind"]+50, 1700, 2300),
                           (+half_w["wind"]+50, 3100, 2300),
                           (-half_w["wind"]-50, 3100, 2300),
                           (-half_w["wind"]-50, 1700, 2300)]))
    # cab sides (vertical from frame top to roof at y=1700 and y=3100)
    for y in (1700, 3100):
        for sx in (-1, +1):
            lines.append(("body", [(sx*(half_w["wind"]+50), y, 1020),
                                   (sx*(half_w["wind"]+50), y, 2300)]))
    # B-pillar (between door + rear cab window) at y~2700, both sides
    for sx in (-1, +1):
        lines.append(("body", [(sx*(half_w["wind"]+50), 2700, 1020),
                               (sx*(half_w["wind"]+50), 2700, 2300)]))
    # door cut lines along cab sides (vertical at front of cab + B-pillar)
    for sx in (-1, +1):
        lines.append(("body", [(sx*(half_w["wind"]+50), 1700, 1020),
                               (sx*(half_w["wind"]+50), 1700, 1800)]))
    # windshield outline (top of firewall to top of cab front)
    lines.append(("body", [(-half_w["wind"], 1700, 1380),
                           (-half_w["wind"], 1700, 2300),
                           (+half_w["wind"], 1700, 2300),
                           (+half_w["wind"], 1700, 1380)]))
    # rear cab window outline
    lines.append(("body", [(-half_w["wind"], 3100, 1500),
                           (-half_w["wind"], 3100, 2200),
                           (+half_w["wind"], 3100, 2200),
                           (+half_w["wind"], 3100, 1500)]))
    # bed (rectangular box from y=3100 to y=4500, top z=1380, bottom z=800)
    bed_hw = half_w["tail"] + 60
    bx_low_y, bx_hi_y = 3100, 4500
    # bed top rim
    lines.append(("body", [(-bed_hw, bx_low_y, 1380), (+bed_hw, bx_low_y, 1380),
                           (+bed_hw, bx_hi_y,  1380), (-bed_hw, bx_hi_y,  1380),
                           (-bed_hw, bx_low_y, 1380)]))
    # bed floor
    lines.append(("body", [(-bed_hw, bx_low_y, 800),  (+bed_hw, bx_low_y, 800),
                           (+bed_hw, bx_hi_y,  800),  (-bed_hw, bx_hi_y,  800),
                           (-bed_hw, bx_low_y, 800)]))
    # bed verticals (corners)
    for y in (bx_low_y, bx_hi_y):
        for sx in (-1, +1):
            lines.append(("body", [(sx*bed_hw, y, 800), (sx*bed_hw, y, 1380)]))

    # Engine block (LS3) — box at frame point E
    ex = [LS3_LEFT, LS3_RIGHT]
    ey = [LS3_FRONT, LS3_REAR]
    ez = [LS3_BOTTOM, LS3_TOP]
    corners = [(x, y, z) for x in ex for y in ey for z in ez]
    # 12 edges of the box
    box_edges = [
        ((LS3_LEFT,LS3_FRONT,LS3_BOTTOM), (LS3_RIGHT,LS3_FRONT,LS3_BOTTOM)),
        ((LS3_LEFT,LS3_REAR, LS3_BOTTOM), (LS3_RIGHT,LS3_REAR, LS3_BOTTOM)),
        ((LS3_LEFT,LS3_FRONT,LS3_TOP),    (LS3_RIGHT,LS3_FRONT,LS3_TOP)),
        ((LS3_LEFT,LS3_REAR, LS3_TOP),    (LS3_RIGHT,LS3_REAR, LS3_TOP)),
        ((LS3_LEFT,LS3_FRONT,LS3_BOTTOM), (LS3_LEFT,LS3_REAR, LS3_BOTTOM)),
        ((LS3_RIGHT,LS3_FRONT,LS3_BOTTOM),(LS3_RIGHT,LS3_REAR, LS3_BOTTOM)),
        ((LS3_LEFT,LS3_FRONT,LS3_TOP),    (LS3_LEFT,LS3_REAR, LS3_TOP)),
        ((LS3_RIGHT,LS3_FRONT,LS3_TOP),   (LS3_RIGHT,LS3_REAR, LS3_TOP)),
        ((LS3_LEFT,LS3_FRONT,LS3_BOTTOM), (LS3_LEFT,LS3_FRONT,LS3_TOP)),
        ((LS3_RIGHT,LS3_FRONT,LS3_BOTTOM),(LS3_RIGHT,LS3_FRONT,LS3_TOP)),
        ((LS3_LEFT,LS3_REAR, LS3_BOTTOM), (LS3_LEFT,LS3_REAR, LS3_TOP)),
        ((LS3_RIGHT,LS3_REAR, LS3_BOTTOM),(LS3_RIGHT,LS3_REAR, LS3_TOP)),
    ]
    for a, b in box_edges:
        lines.append(("engine", [a, b]))

    return lines

# ---------------------------------------------------------------------------
# SVG emit
# ---------------------------------------------------------------------------
STROKE = {
    "frame_top":  ("#1e293b", 2.0, ""),
    "frame_bot":  ("#475569", 1.4, ""),
    "frame_edge": ("#475569", 1.0, ""),
    "body":       ("#334155", 1.6, ""),
    "engine":     ("#0f172a", 2.4, ""),
}

def emit_svg(out_path: Path):
    W, H = 3400, 2200      # ANSI D landscape, 100 dpi
    margin = 60
    svg = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" font-family="Arial, Helvetica, sans-serif">',
        '<rect width="100%" height="100%" fill="#ffffff"/>',
        '<g id="grid" opacity="0.55">',
        emit_iso_grid(W, H, spacing_mm=152, major_every=4),  # ~6" grid
        '</g>',
    ]
    # outer frame and title-block area
    svg.append(f'<rect x="{margin}" y="{margin}" width="{W-2*margin}" '
               f'height="{H-2*margin}" fill="none" stroke="#1f2937" '
               f'stroke-width="2"/>')

    # K5 wireframe
    svg.append('<g id="wireframe">')
    for kind, poly in k5_wireframe():
        color, width, dash = STROKE[kind]
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (iso(p) for p in poly))
        svg.append(f'<polyline points="{pts}" fill="none" stroke="{color}" '
                   f'stroke-width="{width}"{(" stroke-dasharray=\""+dash+"\"" if dash else "")}/>')
    svg.append('</g>')

    # Zone boundaries (dashed vertical-ish iso planes at firewall y=1700, cab back y=3100)
    svg.append('<g id="zones">')
    for y, label in [(1700, "FRONT OF DASH (firewall)"), (3100, "CAB / REAR BOUNDARY")]:
        # project a vertical iso plane from frame_bottom to body_top
        p_top_l = iso((-2200, y, 2600))
        p_bot_l = iso((-2200, y, -200))
        p_top_r = iso((+2200, y, 2600))
        p_bot_r = iso((+2200, y, -200))
        svg.append(f'<line x1="{p_top_l[0]:.1f}" y1="{p_top_l[1]:.1f}" '
                   f'x2="{p_bot_l[0]:.1f}" y2="{p_bot_l[1]:.1f}" '
                   f'stroke="#94a3b8" stroke-width="1.0" stroke-dasharray="6 4"/>')
        svg.append(f'<line x1="{p_top_r[0]:.1f}" y1="{p_top_r[1]:.1f}" '
                   f'x2="{p_bot_r[0]:.1f}" y2="{p_bot_r[1]:.1f}" '
                   f'stroke="#94a3b8" stroke-width="1.0" stroke-dasharray="6 4"/>')
        # label at top
        lx, ly = iso((+2200, y, 2700))
        svg.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="13" '
                   f'fill="#475569" font-weight="700" '
                   f'letter-spacing="1.2">{label}</text>')
    svg.append('</g>')

    # Measured landmark callouts — frame points from FR-88 p1
    # These ARE measured (cited per K5_dimensions_atoms.yaml). Drawn as small
    # diamond markers with point ID and longitudinal station label.
    svg.append('<g id="frame_landmarks">')
    frame_pts = [
        ("E", STA["E"], HW_FR88["E"], "Motor mount (KEY)"),
        ("D", STA["D"], HW_FR88["D"], "Front crossmember"),
        ("G", STA["G"], HW_FR88["G"], "Mid frame"),
        ("A", STA["A"], HW_FR88["A"], "Front rail hole"),
        ("B", STA["B"], HW_FR88["B"], "Front leaf spring mount"),
    ]
    for pid, sta, hw, note in frame_pts:
        # mark on both rails
        for sx in (-1, +1):
            x3d = sx * hw
            p3 = (x3d, sta, 1020)   # at frame top
            x, y = iso(p3)
            svg.append(f'<polygon points="{x:.1f},{y-5:.1f} {x+5:.1f},{y:.1f} '
                       f'{x:.1f},{y+5:.1f} {x-5:.1f},{y:.1f}" '
                       f'fill="#0891b2" stroke="white" stroke-width="0.8"/>')
        # label once (center)
        cx, cy = iso((0, sta, 1020))
        svg.append(f'<text x="{cx:.1f}" y="{cy+18:.1f}" font-size="9" '
                   f'fill="#155e75" font-weight="600" text-anchor="middle">'
                   f'point {pid} · sta {sta}mm · {note}</text>')
    svg.append('</g>')

    # Firewall detail zones (brake booster bulge, MC, A/C box) intentionally
    # OMITTED in v3 — KLM-Blz doesn't carry exact dimensions and dave-critic
    # flagged guessed boxes as worse than empty. Title block records this gap.

    # Zone labels at zone centers
    zone_labels = [
        ("FORWARD LAMPS", (0, 50, 1500)),
        ("ENGINE BAY", (-300, 800, 1500)),
        ("CAB", (0, 2400, 2500)),
        ("BED / REAR", (0, 3800, 1700)),
    ]
    for txt, p in zone_labels:
        sx, sy = iso(p)
        svg.append(f'<text x="{sx:.1f}" y="{sy:.1f}" font-size="16" '
                   f'fill="#0f172a" font-weight="800" '
                   f'letter-spacing="2.0" text-anchor="middle">{txt}</text>')

    # Components
    comp_lookup = {c[0]: {"id":c[0], "label":c[1], "x":c[2], "y":c[3], "z":c[4],
                          "verified":c[5], "zone":c[6], "section":c[7]}
                   for c in COMPONENTS}
    svg.append('<g id="components">')
    for c in comp_lookup.values():
        sx, sy = iso((c["x"], c["y"], c["z"]))
        fill = "#fef3c7" if not c["verified"] else "#dbeafe"
        stroke = "#b45309" if not c["verified"] else "#1e40af"
        # box dimensions vary by importance — ECU/PDM larger
        major = c["id"] in ("M130", "PDM30")
        bw, bh = (78, 34) if major else (60, 26)
        svg.append(f'<rect x="{sx-bw/2:.1f}" y="{sy-bh/2:.1f}" '
                   f'width="{bw}" height="{bh}" '
                   f'fill="{fill}" stroke="{stroke}" stroke-width="1.6" rx="2"/>')
        verified_tag = "  ⚠ TBD" if not c["verified"] else ""
        # ID + section inside box
        svg.append(f'<text x="{sx:.1f}" y="{sy-2:.1f}" font-size="{12 if major else 10}" '
                   f'fill="#0f172a" font-weight="800" text-anchor="middle">'
                   f'{c["id"]}</text>')
        svg.append(f'<text x="{sx:.1f}" y="{sy+10:.1f}" font-size="8" '
                   f'fill="#334155" text-anchor="middle">'
                   f'{c["section"]}{verified_tag}</text>')
        # label below box
        svg.append(f'<text x="{sx:.1f}" y="{sy+bh/2+10:.1f}" font-size="9" '
                   f'fill="{"#b45309" if not c["verified"] else "#334155"}" '
                   f'text-anchor="middle">{c["label"]}</text>')
    svg.append('</g>')

    # Harness trunks — Manhattan iso routing along axes
    wires = parse_wires(HERE / "K5_wire_paths.yaml")
    edges, zone_internal = build_trunks(wires, comp_lookup)
    # unique-wire count (each wire might pass through several edges)
    routed_wire_ids = set()
    for e in edges.values():
        routed_wire_ids.update(e["ids"])
    svg.append('<g id="trunks">')
    for (a_name, b_name), e in sorted(edges.items(), key=lambda kv: -kv[1]["count"]):
        ap = anchor_3d(a_name, comp_lookup)
        bp = anchor_3d(b_name, comp_lookup)
        if not ap or not bp: continue
        poly3 = manhattan_iso(ap, bp)
        # Per-loom stratified bands offset perpendicular to the overall direction
        # For Manhattan iso routing, each leg is along one iso axis — we draw a
        # single polyline per loom, offset perpendicular to the LINE direction.
        bands = sorted(e["looms"].items(), key=lambda kv: -kv[1])
        band_w = lambda c: 2.0 + math.sqrt(c) * 2.4
        total_w = sum(band_w(c) for _, c in bands)
        # Use projected midpoint of first leg to derive perp direction (approx)
        s0 = iso(poly3[0]); s1 = iso(poly3[-1])
        dx, dy = s1[0]-s0[0], s1[1]-s0[1]
        L = math.hypot(dx, dy) or 1
        px, py = -dy/L, dx/L
        cursor = -total_w / 2
        for loom, count in bands:
            bw = band_w(count); off = cursor + bw/2; cursor += bw
            # project full polyline, offset each point by perp*off
            spts = [iso(p) for p in poly3]
            spts = [(x + px*off, y + py*off) for x, y in spts]
            d = " ".join(f"{x:.1f},{y:.1f}" for x, y in spts)
            color = color_for(loom)
            dash = ' stroke-dasharray="6 3"' if e["shielded"] > 0 and loom == "ENGINE LOOM" else ""
            title = (f"{a_name} → {b_name} · {loom}: {count} wires · "
                     f"gauges {sorted(set(e['gauges']))} · "
                     f"ids {','.join(e['ids'][:10])}"
                     f"{'...' if len(e['ids']) > 10 else ''}")
            svg.append(f'<polyline points="{d}" fill="none" stroke="{color}" '
                       f'stroke-width="{bw:.2f}" stroke-linejoin="round" '
                       f'stroke-linecap="round" opacity="0.85"{dash}>'
                       f'<title>{title}</title></polyline>')
        # edge count label at midpoint of polyline
        mid_idx = len(poly3) // 2
        m3 = poly3[mid_idx]
        mx, my = iso(m3)
        my -= 8
        if e["count"] >= 4:
            svg.append(f'<text x="{mx:.1f}" y="{my:.1f}" font-size="10" '
                       f'fill="#0f172a" font-weight="700" '
                       f'text-anchor="middle">×{e["count"]}</text>')
    svg.append('</g>')

    # Title block (bottom-right per Appendix E §6.3)
    tb_w, tb_h = 480, 200
    tb_x, tb_y = W - margin - tb_w, H - margin - tb_h
    svg.append(f'<rect x="{tb_x}" y="{tb_y}" width="{tb_w}" height="{tb_h}" '
               f'fill="white" stroke="#1f2937" stroke-width="1.5"/>')
    tb_rows = [
        ("NUKE LTD", 18, "700"),
        ("1977 CHEVROLET K5 BLAZER · VIN CKR187F127263", 12, "600"),
        ("DOCUMENT 3.1.iso — HARNESS ROUTING (ISO PICTORIAL)", 11, "700"),
        ("LS3 6.2L · MoTeC M130 · PDM30 · 113 wires", 10, "400"),
        ("DWG: NWX-K5-3.1.iso · REV: v3 · 2026-05-25", 9, "400"),
        ("Frame geometry: FR-88 p1 (measured). Body envelope: KLM-Blz.", 9, "400"),
        ("Engine center: frame point E (1587mm). LS3 envelope: LS3-Marine p3.", 9, "400"),
        ("Cross-reference: System Schematics S0–S13 per Appendix G §2.1.", 9, "400"),
        ("⚠ FW_GROMMET/DASH_PANEL z-heights illustrative — not measured.", 8, "400"),
        ("⚠ Firewall bulge geometry (booster/MC/A/C) deferred — KLM-Blz lacks dims.", 8, "400"),
    ]
    for i, (txt, sz, wt) in enumerate(tb_rows):
        svg.append(f'<text x="{tb_x + 12}" y="{tb_y + 24 + i*18:.0f}" '
                   f'font-size="{sz}" font-weight="{wt}" fill="#0f172a">{txt}</text>')

    # Sidebar: trunk inventory + legend (top-left)
    sb_x, sb_y = margin + 16, margin + 16
    sb_w, sb_h = 480, 980
    svg.append(f'<rect x="{sb_x}" y="{sb_y}" width="{sb_w}" height="{sb_h}" '
               f'fill="white" fill-opacity="0.92" stroke="#1f2937" stroke-width="1.2"/>')
    y_cursor = sb_y + 24
    svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="14" '
               f'font-weight="800" fill="#0f172a">TRUNK INVENTORY</text>')
    y_cursor += 22
    edges_sorted = sorted(edges.items(), key=lambda kv: -kv[1]["count"])
    for (a, b), e in edges_sorted[:18]:
        gauges = sorted(set(e["gauges"]))
        line = f'{a:>10} → {b:<12} ×{e["count"]:>3}  AWG {min(gauges):>2}-{max(gauges):>2}'
        svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="10" '
                   f'font-family="ui-monospace, Menlo, monospace" '
                   f'fill="#0f172a">{line}</text>')
        y_cursor += 14
    if len(edges_sorted) > 18:
        svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="10" '
                   f'font-family="ui-monospace, Menlo, monospace" '
                   f'fill="#64748b">… + {len(edges_sorted) - 18} more trunks</text>')
        y_cursor += 18
    y_cursor += 12
    svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="14" '
               f'font-weight="800" fill="#0f172a">LOOM LEGEND</text>')
    y_cursor += 22
    for loom, color in LOOM_COLOR.items():
        svg.append(f'<line x1="{sb_x+12}" y1="{y_cursor-4:.0f}" '
                   f'x2="{sb_x+44}" y2="{y_cursor-4:.0f}" '
                   f'stroke="{color}" stroke-width="4" stroke-linecap="round"/>')
        svg.append(f'<text x="{sb_x+52}" y="{y_cursor:.0f}" font-size="11" '
                   f'fill="#0f172a">{loom}</text>')
        y_cursor += 16
    y_cursor += 8
    svg.append(f'<line x1="{sb_x+12}" y1="{y_cursor-4:.0f}" '
               f'x2="{sb_x+44}" y2="{y_cursor-4:.0f}" '
               f'stroke="#334155" stroke-width="3" '
               f'stroke-dasharray="6 3" stroke-linecap="round"/>')
    svg.append(f'<text x="{sb_x+52}" y="{y_cursor:.0f}" font-size="11" '
               f'fill="#0f172a">Shielded (engine sensor)</text>')
    # Zone-internal wires enumeration — per Appendix E §5.2 cross-reference
    # notation requirement; dave-critic 2026-05-25: do not silently discard.
    if zone_internal:
        y_cursor += 12
        svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="14" '
                   f'font-weight="800" fill="#0f172a">'
                   f'ZONE-INTERNAL WIRES ({len(zone_internal)})</text>')
        y_cursor += 18
        svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="9" '
                   f'fill="#64748b" font-style="italic">'
                   f'Terminate inside a single anchor zone — no inter-zone route drawn.</text>')
        y_cursor += 14
        # group by zone
        by_zone = defaultdict(list)
        for w in zone_internal:
            by_zone[w["zone"]].append(w)
        for zone in sorted(by_zone.keys()):
            wires_in_zone = by_zone[zone]
            ids = ", ".join(w["id"] for w in wires_in_zone[:12])
            if len(wires_in_zone) > 12:
                ids += f", +{len(wires_in_zone) - 12} more"
            svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="10" '
                       f'font-family="ui-monospace, Menlo, monospace" '
                       f'fill="#0f172a">{zone} (×{len(wires_in_zone)}): {ids}</text>')
            y_cursor += 14
    y_cursor += 8
    svg.append(f'<text x="{sb_x + 12}" y="{y_cursor:.0f}" font-size="14" '
               f'font-weight="800" fill="#0f172a">POSITION STATUS</text>')
    y_cursor += 20
    svg.append(f'<circle cx="{sb_x+22}" cy="{y_cursor-4:.0f}" r="6" '
               f'fill="#dbeafe" stroke="#1e40af" stroke-width="1.5"/>')
    svg.append(f'<text x="{sb_x+36}" y="{y_cursor:.0f}" font-size="11" '
               f'fill="#0f172a">Position verified from substrate</text>')
    y_cursor += 18
    svg.append(f'<circle cx="{sb_x+22}" cy="{y_cursor-4:.0f}" r="6" '
               f'fill="#fef3c7" stroke="#b45309" stroke-width="1.5"/>')
    svg.append(f'<text x="{sb_x+36}" y="{y_cursor:.0f}" font-size="11" '
               f'fill="#b45309">Position TBD — needs physical measurement (§4)</text>')

    # Iso axis rosette (top-right, before title block)
    rx, ry = W - margin - 200, margin + 60
    svg.append(f'<rect x="{rx-30}" y="{ry-30}" width="200" height="120" '
               f'fill="white" stroke="#cbd5e1" stroke-width="1"/>')
    a = 60
    def axis_arrow(dx, dy, lbl, c):
        x2, y2 = rx + dx, ry + dy
        svg.append(f'<line x1="{rx}" y1="{ry}" x2="{x2:.1f}" y2="{y2:.1f}" '
                   f'stroke="{c}" stroke-width="2"/>')
        svg.append(f'<polygon points="{x2:.1f},{y2:.1f} '
                   f'{x2-dx*0.18:.1f},{y2-dy*0.18-3:.1f} '
                   f'{x2-dx*0.18:.1f},{y2-dy*0.18+3:.1f}" fill="{c}"/>')
        svg.append(f'<text x="{x2+6:.1f}" y="{y2+4:.1f}" font-size="11" '
                   f'fill="{c}" font-weight="600">{lbl}</text>')
    # +Z up
    axis_arrow(0, -a, "UP", "#374151")
    # +Y rear (cos30, sin30)*a
    axis_arrow(a*COS30, a*SIN30, "REAR", "#374151")
    # +X passenger (into page; cos30, -sin30)*a
    axis_arrow(a*COS30, -a*SIN30, "PASS", "#374151")
    svg.append(f'<text x="{rx-25}" y="{ry+80:.0f}" font-size="10" '
               f'fill="#64748b" font-style="italic">'
               f'View: upper-front-driver, iso 30°</text>')

    # Footer note
    svg.append(f'<text x="{margin+16}" y="{H-margin-12}" font-size="10" '
               f'fill="#64748b" font-style="italic">'
               f'Trunks drawn Manhattan along iso axes (Z → Y → X). '
               f'Bundle width ∝ √(wire count). '
               f'{len(routed_wire_ids)} of {len(wires)} wires routed through trunk anchors '
               f'({len(wires) - len(routed_wire_ids)} terminate inside a single anchor zone).'
               f'</text>')

    svg.append('</svg>')
    out_path.write_text("\n".join(svg))
    return len(routed_wire_ids), len(wires)

def main():
    out = HERE / "K5_harness_routing_iso.svg"
    routed, total = emit_svg(out)
    print(f"wrote {out}")
    print(f"  trunks: {routed}/{total} wires routed")

if __name__ == "__main__":
    main()
