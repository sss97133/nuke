#!/usr/bin/env python3
"""K5 harness — isometric projection (schematic).

Renders every wire in K5_wire_paths.yaml as an iso polyline through its
landmark sequence. Landmark 3D positions are SCHEMATIC (illustrative, not
measured). Topology — which wires pass through which landmarks — is REAL
from the yaml.

Output: K5_harness_iso.svg (open in browser; SVG <title> gives hover tooltips).

Doctrine note (K5_WIRING_STATE.md §2): "2D done right" — this is a 2D drawing
that uses an iso *projection*, not a 3D rendering. Real lengths still come
from K5_landmarks.yaml (not yet measured) — see the disclaimer banner.
"""
from __future__ import annotations
import math, re, sys
from pathlib import Path

HERE = Path(__file__).parent

# --- Iso projection ---
# Right-handed: X = lateral (driver -, passenger +); Y = longitudinal (front=0, rear=+);
# Z = vertical (ground=0, roof=~70). Inches.
COS30 = math.cos(math.radians(30))
SIN30 = math.sin(math.radians(30))
SCALE = 4.2   # px per inch
OX, OY = 1320, 280   # screen origin (truck stretches down-left from here)

def iso(p):
    x, y, z = p
    sx = (x - y) * COS30 * SCALE + OX
    sy = ((x + y) * SIN30 - z) * SCALE + OY
    return (sx, sy)

# --- Landmark positions (SCHEMATIC) ---
# Reflect the descriptions in K5_landmarks.yaml comments + plausible K5 packaging.
# Not measured. Override-friendly: edit this dict to remap, run the script.
L = {
    # Engine bay
    "L01": (12, 72, 38),   # M130 firewall passenger
    "L02": (0,  58, 36),   # FWG-MAIN → intake valley junction
    "L03": (-8, 42, 36),   # Cyl 1 coil (driver front)
    "L04": (0, 4.4, 0),    # Δ — driver bank cyl pitch
    "L05": (8,  42, 36),   # Cyl 2 coil (passenger front)
    "L06": (0, 4.4, 0),    # Δ — passenger bank cyl pitch
    "L07": (0, 0, -4),     # Δ — coil top → injector at same cyl
    "L08": (0,  35, 36),   # Throttle body
    "L09": (0,  50, 37),   # MAP sensor port
    "L10": (0,  72, 22),   # CKP at bellhousing rear
    "L11": (0,  30, 30),   # CMP at front timing cover
    "L12": (-10, 58, 20),  # KS1 driver block
    "L13": (10,  58, 20),  # KS2 passenger block
    "L14": (-14, 36, 32),  # ALT stud / front-of-engine driver
    "L15": (-6,  70, 18),  # STARTER stud / bellhousing
    # Cab
    "L16": (15, 82, 30),   # PDM30 under-dash passenger
    "L17": (-12, 84, 30),  # Steering column
    "L18": (0,  86, 36),   # Headlight switch / dash center
    "L19": (-10, 78, 22),  # Brake pedal switch
    "L20": (-30, 88, 34),  # Driver door boot
    "L21": (-34, 92, 32),  # Inside door
    "L22": (30,  88, 34),  # Passenger door boot
    "L23": (0,   90, 58),  # Cowl / wiper / headliner
    # Rear
    "L24": (6,  130, 18),  # Mid floor / frame run
    "L25": (0,  165, 22),  # Rear junction
    "L26": (0,  185, 28),  # Rear bed / tailgate
    "L27": (0,  140, 14),  # Fuel pump (in tank)
    "L28": (0,  110, 14),  # Transmission / transfer case
    "L29": (-14, 78, 14),  # WBO2 #1 driver collector
    "L30": (14,  78, 14),  # WBO2 #2 passenger collector
}

# Deltas — L04/L06 are pitch increments, L07 is a small offset.
DELTAS = {"L04", "L06", "L07"}

def resolve_path(landmarks):
    """Walk a wire's landmark list. Repeats of L04/L06/L07 accumulate as Δ."""
    pts = []
    base = None
    for lm in landmarks:
        if lm in DELTAS:
            if pts:
                last = pts[-1]
                d = L[lm]
                pts.append((last[0] + d[0], last[1] + d[1], last[2] + d[2]))
            continue
        if lm in L:
            pts.append(L[lm])
        else:
            return None
    return pts

# --- Parse K5_wire_paths.yaml (light parser — the file is regular) ---
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
        if m:
            current_loom = m.group(1).strip()
            continue
        m = WIRE_RE.search(line)
        if m:
            ids = [s.strip() for s in m.group("path").split(",")]
            out.append({
                "id": m.group("id"),
                "label": m.group("label"),
                "gauge": int(m.group("gauge")),
                "path": ids,
                "loom": current_loom or "?",
                "flags": "shielded" if "shielded" in line else (
                    "door_crossing" if "door_crossing" in line else ""),
            })
    return out

# --- Color per loom ---
LOOM_COLOR = {
    "ENGINE LOOM":          "#c2410c",
    "EXTERIOR/BODY LOOM":   "#ca8a04",
    "INTERIOR/DASH LOOM":   "#15803d",
    "CHASSIS/UNDERBODY":    "#1d4ed8",
    "AUDIO":                "#7c3aed",
    "POWER/COMM":           "#b91c1c",
    "MISC":                 "#4b5563",
    "REAR LOOM EXTRA":      "#4b5563",
}
# YAML loom headings have variant spacing — normalize.
def loom_key(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("/", "/")).strip()

def color_for(loom: str) -> str:
    key = loom_key(loom)
    for k, c in LOOM_COLOR.items():
        if loom_key(k) == key:
            return c
    return "#4b5563"

# --- Vehicle outline (very schematic — a cab + engine bay + bed wireframe) ---
def vehicle_outline():
    """Return list of polylines [(p, p, ...)] for context geometry."""
    # rough K5 box: front bumper y=0, cab y=70-120, bed y=120-185; width ±36
    # heights: ground 0, frame 18, roof 70
    lines = []
    # frame top edge both sides (z=22)
    lines.append([(-32, 5, 22), (-32, 185, 22)])
    lines.append([(32,  5, 22), (32,  185, 22)])
    # frame front/rear
    lines.append([(-32, 5, 22), (32, 5, 22)])
    lines.append([(-32, 185, 22), (32, 185, 22)])
    # engine bay top (hood plane @ z=42), driver/passenger
    lines.append([(-32, 5, 42), (-32, 70, 42)])
    lines.append([(32,  5, 42), (32,  70, 42)])
    lines.append([(-32, 5, 42), (32, 5, 42)])         # front of hood
    lines.append([(-32, 70, 42), (32, 70, 42)])       # firewall top
    # firewall up to cab roof
    lines.append([(-32, 70, 42), (-32, 70, 65)])
    lines.append([(32,  70, 42), (32,  70, 65)])
    # cab roof
    lines.append([(-32, 70, 65), (-32, 120, 65)])
    lines.append([(32,  70, 65), (32,  120, 65)])
    lines.append([(-32, 120, 65), (32, 120, 65)])     # rear of cab top
    lines.append([(-32, 70, 65), (32, 70, 65)])       # windshield top
    # back of cab down
    lines.append([(-32, 120, 65), (-32, 120, 42)])
    lines.append([(32,  120, 65), (32,  120, 42)])
    # bed floor (z=28) + sides
    lines.append([(-32, 120, 28), (-32, 185, 28)])
    lines.append([(32,  120, 28), (32,  185, 28)])
    lines.append([(-32, 185, 28), (32, 185, 28)])
    # bed top rails (z=42)
    lines.append([(-32, 120, 42), (-32, 185, 42)])
    lines.append([(32,  120, 42), (32,  185, 42)])
    lines.append([(-32, 185, 42), (32, 185, 42)])
    # engine block stylized (centered between motor mounts at frame point E ≈ y=62, ±10)
    eng_y0, eng_y1 = 32, 62
    lines.append([(-10, eng_y0, 28), (10, eng_y0, 28),
                  (10, eng_y1, 28), (-10, eng_y1, 28), (-10, eng_y0, 28)])
    lines.append([(-10, eng_y0, 40), (10, eng_y0, 40),
                  (10, eng_y1, 40), (-10, eng_y1, 40), (-10, eng_y0, 40)])
    for (xa, ya, za) in [(-10, eng_y0, 28), (10, eng_y0, 28),
                          (-10, eng_y1, 28), (10, eng_y1, 28)]:
        lines.append([(xa, ya, za), (xa, ya, 40)])
    return lines

# --- SVG emit ---
def resolve_path_lms(landmarks):
    """Like resolve_path but returns list of (lm_name, point) — collapses Δs onto the prior landmark."""
    out = []
    for lm in landmarks:
        if lm in DELTAS:
            if out:
                last_name, last_p = out[-1]
                d = L[lm]
                out[-1] = (f"{last_name}+{lm}", (last_p[0]+d[0], last_p[1]+d[1], last_p[2]+d[2]))
            continue
        if lm in L:
            out.append((lm, L[lm]))
        else:
            return None
    return out

def build_trunks(wires):
    """Compute (lm_a, lm_b) → {count, looms:Counter, gauges:list, wire_ids:list}.
    Edges are directional from path order. Pads start of any wire that doesn't begin at L01/L16/L17/L18/L19/L20/L21/L22/L23 with a virtual L01 anchor (engine wires originate at ECU)."""
    from collections import Counter, defaultdict
    edges = defaultdict(lambda: {"count": 0, "looms": Counter(), "gauges": [], "wire_ids": [], "shielded": 0})
    terminals = defaultdict(list)   # landmark -> list of (wire_id, label, loom)
    for w in wires:
        path = resolve_path_lms(w["path"])
        if not path:
            continue
        first = w["path"][0]
        if first not in ("L01","L16","L17","L18","L19","L20","L21","L22","L23"):
            path = [("L01", L["L01"])] + path
        for i in range(len(path) - 1):
            a_name, a_p = path[i]
            b_name, b_p = path[i+1]
            key = ((a_name, a_p), (b_name, b_p))
            e = edges[key]
            e["count"] += 1
            e["looms"][w["loom"]] += 1
            e["gauges"].append(w["gauge"])
            e["wire_ids"].append(w["id"])
            if w["flags"] == "shielded":
                e["shielded"] += 1
        # terminal device sits at end of path
        last_name, last_p = path[-1]
        terminals[(last_name, last_p)].append((w["id"], w["label"], w["loom"], w["gauge"]))
    return edges, terminals

def emit_svg(wires, out_path: Path, mode: str = "trunks"):
    W, H = 1700, 1050
    svg = [f'<?xml version="1.0" encoding="UTF-8"?>',
           f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}" font-family="ui-sans-serif, system-ui, sans-serif">',
           '<defs><style><![CDATA[',
           '  .frame  { stroke: #94a3b8; stroke-width: 1.4; fill: none; }',
           '  .wire   { fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: 0.5; }',
           '  .wire:hover { opacity: 1; stroke-width: 5; }',
           '  .lm     { fill: #1f2937; stroke: white; stroke-width: 1.2; }',
           '  .lm-label { font-size: 11px; fill: #1f2937; }',
           '  .comp   { font-size: 11px; fill: #111827; font-weight: 600; }',
           '  .title  { font-size: 18px; fill: #111827; font-weight: 700; }',
           '  .sub    { font-size: 11px; fill: #6b7280; }',
           '  .disc   { font-size: 11px; fill: #b45309; }',
           '  .legend { font-size: 11px; fill: #374151; }',
           ']]></style></defs>',
           f'<rect width="100%" height="100%" fill="#ffffff"/>']

    # --- vehicle outline ---
    for poly in vehicle_outline():
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (iso(p) for p in poly))
        svg.append(f'<polyline class="frame" points="{pts}"/>')

    skipped = []
    if mode == "trunks":
        edges, terminals = build_trunks(wires)
        # --- draw trunks: each edge = stratified parallel polylines per loom ---
        # offset perpendicular-to-edge in screen space so loom bands sit side-by-side.
        import math
        for ((a_name, a_p), (b_name, b_p)), e in sorted(edges.items(), key=lambda kv: -kv[1]["count"]):
            sa, sb = iso(a_p), iso(b_p)
            dx, dy = sb[0]-sa[0], sb[1]-sa[1]
            length = math.hypot(dx, dy) or 1
            # perpendicular unit vector
            px, py = -dy/length, dx/length
            # split into per-loom bands
            bands = sorted(e["looms"].items(), key=lambda kv: -kv[1])
            total = sum(c for _, c in bands)
            band_w = lambda c: 1.0 + math.sqrt(c) * 1.8   # px width
            total_w = sum(band_w(c) for _, c in bands)
            cursor = -total_w / 2
            for loom, count in bands:
                bw = band_w(count)
                offset = cursor + bw / 2
                cursor += bw
                # offset endpoints by perpendicular
                x1 = sa[0] + px * offset; y1 = sa[1] + py * offset
                x2 = sb[0] + px * offset; y2 = sb[1] + py * offset
                color = color_for(loom)
                dash = ' stroke-dasharray="5 4"' if e["shielded"] > 0 and loom == "ENGINE LOOM" else ""
                title_lines = [
                    f"{a_name} → {b_name}",
                    f"  {loom}: {count} wire(s)" if total == e["count"] else f"  {loom}: {count}",
                    f"  total on edge: {e['count']}",
                    f"  gauges: {sorted(set(e['gauges']))}",
                    f"  ids: {','.join(e['wire_ids'][:12])}{'...' if len(e['wire_ids'])>12 else ''}",
                ]
                title = "\n".join(title_lines)
                svg.append(
                    f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                    f'stroke="{color}" stroke-width="{bw:.2f}"{dash} '
                    f'stroke-linecap="round" opacity="0.85">'
                    f'<title>{title}</title></line>'
                )
            # edge label (total count) at midpoint, offset perpendicular
            if e["count"] >= 6:
                mid_off = (total_w/2 + 8)
                mx = (sa[0]+sb[0])/2 + px*mid_off
                my = (sa[1]+sb[1])/2 + py*mid_off
                svg.append(f'<text x="{mx:.1f}" y="{my:.1f}" font-size="10" '
                           f'fill="#374151" font-weight="600" text-anchor="middle">'
                           f'{e["count"]}</text>')
    else:
        # per-wire mode (the original spaghetti view)
        for w in wires:
            pts = resolve_path(w["path"])
            if not pts:
                skipped.append(w["id"]); continue
            if pts[0] != L["L01"] and w["path"][0] not in ("L17","L18","L19","L20","L21","L22","L23"):
                pts = [L["L01"]] + pts
            if len(pts) < 2:
                p = pts[0]; pts = [p, (p[0], p[1], p[2]+2)]
            sp = [iso(p) for p in pts]
            d = " ".join(f"{x:.1f},{y:.1f}" for x, y in sp)
            sw = 0.8 + max(0, (22 - w["gauge"])) * 0.18
            color = color_for(w["loom"])
            dash = ' stroke-dasharray="4 3"' if w["flags"] == "shielded" else ""
            title = f'#{w["id"]} {w["label"]} · {w["gauge"]} AWG · {w["loom"]}'
            svg.append(
                f'<polyline class="wire" points="{d}" stroke="{color}" '
                f'stroke-width="{sw:.2f}"{dash}><title>{title}</title></polyline>'
            )

    # --- landmarks (only "absolute" ones — not deltas) ---
    for name, p in L.items():
        if name in DELTAS:
            continue
        x, y = iso(p)
        svg.append(f'<circle class="lm" cx="{x:.1f}" cy="{y:.1f}" r="3.2"/>')
        svg.append(f'<text class="lm-label" x="{x+5:.1f}" y="{y-5:.1f}">{name}</text>')

    # --- component name labels (a few critical anchors) ---
    anchors = {
        "L01": "M130 ECU",
        "L16": "PDM30",
        "L10": "CKP",
        "L08": "Throttle Body",
        "L14": "ALT / BAT+",
        "L15": "Starter",
        "L25": "Rear junction",
        "L27": "Fuel pump",
        "L23": "Cowl / cab top",
    }
    for lm, name in anchors.items():
        if lm not in L: continue
        x, y = iso(L[lm])
        svg.append(f'<text class="comp" x="{x+8:.1f}" y="{y+12:.1f}">{name}</text>')

    # --- title + disclaimer + legend ---
    # Orientation indicator (axes rosette, bottom-right)
    rx, ry = W - 130, H - 110
    def axis(dx, dy, lbl, c):
        svg.append(f'<line x1="{rx}" y1="{ry}" x2="{rx+dx}" y2="{ry+dy}" '
                   f'stroke="{c}" stroke-width="2" marker-end="url(#arrow)"/>')
        svg.append(f'<text x="{rx+dx*1.3:.0f}" y="{ry+dy*1.3+4:.0f}" '
                   f'font-size="11" fill="{c}">{lbl}</text>')
    svg.append('<defs><marker id="arrow" markerWidth="6" markerHeight="6" '
               'refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#374151"/>'
               '</marker></defs>')
    a = 50
    # -Y direction = front (up-right): (+cos30, -sin30)
    axis(int(a*COS30),  int(-a*SIN30), "front",  "#374151")
    # -X direction = driver (up-left): (-cos30, -sin30)
    axis(int(-a*COS30), int(-a*SIN30), "driver", "#374151")
    # +Z direction = up
    axis(0, -a,                        "up",     "#374151")

    mode_label = "trunk-and-fanout" if mode == "trunks" else "per-wire"
    svg.append(f'<text class="title" x="40" y="40">1977 K5 Blazer — harness isometric · {mode_label}</text>')
    svg.append(f'<text class="sub" x="40" y="60">'
               f'{len(wires)-len(skipped)} wires drawn · '
               f'projection: 30°/30°/vertical · '
               f'topology from K5_wire_paths.yaml</text>')
    svg.append('<text class="disc" x="40" y="78">'
               'Landmark 3D positions are illustrative, not measured. '
               'Real lengths require K5_landmarks.yaml values (currently null).</text>')

    # legend
    lx, ly = 40, 100
    svg.append(f'<text class="legend" x="{lx}" y="{ly}" font-weight="700">Loom</text>')
    for i, (loom, color) in enumerate(LOOM_COLOR.items()):
        yy = ly + 16 + i * 16
        svg.append(f'<line x1="{lx}" y1="{yy}" x2="{lx+26}" y2="{yy}" '
                   f'stroke="{color}" stroke-width="3" stroke-linecap="round"/>')
        svg.append(f'<text class="legend" x="{lx+32}" y="{yy+3}">{loom.title()}</text>')
    # shielded indicator
    yy = ly + 16 + len(LOOM_COLOR) * 16 + 6
    svg.append(f'<line x1="{lx}" y1="{yy}" x2="{lx+26}" y2="{yy}" '
               f'stroke="#374151" stroke-width="2" stroke-dasharray="4 3"/>')
    svg.append(f'<text class="legend" x="{lx+32}" y="{yy+3}">dashed = shielded</text>')

    if skipped:
        svg.append(f'<text class="sub" x="40" y="{H-20}">'
                   f'Skipped {len(skipped)} wire(s) with unmapped landmarks: '
                   f'{", ".join(skipped[:20])}</text>')

    svg.append('</svg>')
    out_path.write_text("\n".join(svg))
    return len(wires), len(skipped)

def main():
    wires = parse_wires(HERE / "K5_wire_paths.yaml")
    for mode, suffix in [("trunks", "_trunks"), ("perwire", "")]:
        out = HERE / f"K5_harness_iso{suffix}.svg"
        n, skipped = emit_svg(wires, out, mode=mode)
        print(f"wrote {out}  ({n} wires, {skipped} skipped, mode={mode})")

if __name__ == "__main__":
    main()
