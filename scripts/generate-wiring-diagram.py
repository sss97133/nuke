#!/usr/bin/env python3
"""
Generate industry-grade wiring diagram — Section 2: LS3 Engine
GM 1987 grid-address format, properly spaced for legibility.

Split into 3 sub-pages:
  Page 1: Ignition coils (8 wires)
  Page 2: Fuel injectors (8 wires)
  Page 3: Sensors (11 wires)
"""

import os

def generate_page(filename, title_suffix, wires, page_num, total_pages):
    """Generate one diagram page with proper spacing."""

    COLS = 30
    ROWS = len(wires) + 4  # wires + header/footer space
    if ROWS < 10:
        ROWS = 10

    CELL_W = 145
    CELL_H = 72    # Tall rows = readable
    MARGIN_L = 50
    MARGIN_T = 40
    MARGIN_R = 50
    MARGIN_B = 100
    W = MARGIN_L + COLS * CELL_W + MARGIN_R
    H = MARGIN_T + ROWS * CELL_H + MARGIN_B

    ROW_LABELS = [chr(65 + i) for i in range(ROWS)]

    def gx(col): return MARGIN_L + (col - 1) * CELL_W + CELL_W // 2
    def gy(row): return MARGIN_T + row * CELL_H + CELL_H // 2

    lines = []
    lines.append(f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs>
  <style>
    .grid {{ stroke: #E0E0E0; stroke-width: 0.25; }}
    .zone {{ stroke: #999; stroke-width: 0.7; stroke-dasharray: 8,4; fill: none; }}
    .wire {{ stroke: #000; stroke-width: 0.9; fill: none; }}
    .wire-sig {{ stroke: #000; stroke-width: 0.6; fill: none; }}
    .wire-shld {{ stroke: #000; stroke-width: 0.6; fill: none; stroke-dasharray: 2,1.5; }}
    .dot {{ fill: #000; }}
    .comp {{ fill: white; stroke: #000; stroke-width: 1.2; }}
    .lbl {{ font-family: 'Courier New', monospace; font-size: 11px; }}
    .lbl-sm {{ font-family: 'Courier New', monospace; font-size: 9px; fill: #444; }}
    .hdr {{ font-family: Arial, sans-serif; font-weight: bold; }}
    .note {{ font-family: Arial, sans-serif; font-size: 9px; fill: #888; }}
  </style>
</defs>
<rect width="{W}" height="{H}" fill="white"/>''')

    # ── GRID ──
    lines.append('<g id="grid" opacity="0.6">')
    for c in range(COLS + 1):
        x = MARGIN_L + c * CELL_W
        lines.append(f'<line x1="{x}" y1="{MARGIN_T}" x2="{x}" y2="{MARGIN_T + ROWS*CELL_H}" class="grid"/>')
    for r in range(ROWS + 1):
        y = MARGIN_T + r * CELL_H
        lines.append(f'<line x1="{MARGIN_L}" y1="{y}" x2="{MARGIN_L + COLS*CELL_W}" y2="{y}" class="grid"/>')
    # Column numbers
    for c in range(COLS):
        x = MARGIN_L + c * CELL_W + CELL_W // 2
        lines.append(f'<text x="{x}" y="{MARGIN_T - 10}" text-anchor="middle" class="note">{c+1}</text>')
        lines.append(f'<text x="{x}" y="{MARGIN_T + ROWS*CELL_H + 16}" text-anchor="middle" class="note">{c+1}</text>')
    # Row letters
    for r in range(ROWS):
        y = gy(r) + 4
        lines.append(f'<text x="{MARGIN_L - 18}" y="{y}" text-anchor="middle" class="note">{ROW_LABELS[r]}</text>')
        lines.append(f'<text x="{MARGIN_L + COLS*CELL_W + 18}" y="{y}" text-anchor="middle" class="note">{ROW_LABELS[r]}</text>')
    lines.append('</g>')

    # ── ZONES ──
    lines.append('<g id="zones">')
    # ECU zone (columns 1-6)
    ecu_x1 = MARGIN_L + 5
    ecu_y1 = MARGIN_T + 5
    ecu_x2 = gx(7) - CELL_W//2
    ecu_y2 = MARGIN_T + ROWS * CELL_H - 5
    lines.append(f'<rect x="{ecu_x1}" y="{ecu_y1}" width="{ecu_x2-ecu_x1}" height="{ecu_y2-ecu_y1}" class="zone"/>')
    lines.append(f'<text x="{(ecu_x1+ecu_x2)//2}" y="{ecu_y1 + 20}" text-anchor="middle" class="hdr" font-size="14">M130 ECU</text>')

    # Firewall
    fw_x = gx(10)
    lines.append(f'<line x1="{fw_x}" y1="{MARGIN_T}" x2="{fw_x}" y2="{MARGIN_T + ROWS*CELL_H}" class="zone"/>')
    lines.append(f'<text x="{fw_x}" y="{MARGIN_T + ROWS*CELL_H + 30}" text-anchor="middle" class="hdr" font-size="10" fill="#888">FIREWALL</text>')

    # Engine zone (columns 11-30)
    eng_x1 = gx(11) - CELL_W//2
    eng_y1 = MARGIN_T + 5
    eng_x2 = MARGIN_L + COLS * CELL_W - 5
    eng_y2 = MARGIN_T + ROWS * CELL_H - 5
    lines.append(f'<rect x="{eng_x1}" y="{eng_y1}" width="{eng_x2-eng_x1}" height="{eng_y2-eng_y1}" class="zone"/>')
    lines.append(f'<text x="{(eng_x1+eng_x2)//2}" y="{eng_y2 - 10}" text-anchor="middle" class="hdr" font-size="12" fill="#999">ENGINE — LS3 6.2L V8</text>')
    lines.append('</g>')

    # ── WIRES + COMPONENTS ──
    lines.append('<g id="wiring">')

    for i, (label, pin, gauge, color, component, sig_type, notes) in enumerate(wires):
        row = i + 2  # Start at row C (leave A,B for headers)
        y = gy(row)

        # ── ECU PIN (left side) ──
        pin_x = gx(3)
        # Pin box
        lines.append(f'<rect x="{pin_x - 40}" y="{y - 14}" width="80" height="28" rx="2" fill="#F5F5F5" stroke="#000" stroke-width="1"/>')
        lines.append(f'<text x="{pin_x}" y="{y - 1}" text-anchor="middle" class="lbl" font-weight="bold">{pin}</text>')
        lines.append(f'<text x="{pin_x}" y="{y + 12}" text-anchor="middle" class="lbl-sm">{label}</text>')

        # ── WIRE RUN ──
        wire_start = pin_x + 42
        wire_end = gx(24) - 20

        wclass = "wire"
        if sig_type in ("analog_5v", "analog_temp"):
            wclass = "wire-sig"
        elif sig_type in ("ecu_crank_cam", "piezoelectric"):
            wclass = "wire-shld"

        # Horizontal wire line
        lines.append(f'<line x1="{wire_start}" y1="{y}" x2="{wire_end}" y2="{y}" class="{wclass}"/>')

        # Junction dots
        lines.append(f'<circle cx="{wire_start}" cy="{y}" r="2.5" class="dot"/>')
        lines.append(f'<circle cx="{wire_end}" cy="{y}" r="2.5" class="dot"/>')

        # ── WIRE LABEL (on the line, GM format) ──
        lbl_x = gx(12) + 10
        # Format: CIRCUIT  GAUGE  COLOR
        lines.append(f'<text x="{lbl_x}" y="{y - 6}" class="lbl">{label}  {gauge}AWG  {color}</text>')

        # Wire length
        lines.append(f'<text x="{lbl_x}" y="{y + 16}" class="lbl-sm">4.6 FT  TXL</text>')

        # ── COMPONENT (right side) ──
        comp_x = gx(25)

        if sig_type == "low_side_drive":
            # Coil/injector: rectangle with internal lines
            lines.append(f'<rect x="{comp_x - 14}" y="{y - 16}" width="28" height="32" class="comp"/>')
            if "Coil" in component:
                # Coil windings
                for j in range(3):
                    cy = y - 8 + j * 8
                    lines.append(f'<path d="M{comp_x-8},{cy} Q{comp_x},{cy-4} {comp_x+8},{cy}" fill="none" stroke="black" stroke-width="0.6"/>')
            else:
                # Injector nozzle
                lines.append(f'<line x1="{comp_x}" y1="{y-10}" x2="{comp_x}" y2="{y+10}" stroke="black" stroke-width="1"/>')
                lines.append(f'<polygon points="{comp_x-5},{y+6} {comp_x+5},{y+6} {comp_x},{y+14}" fill="black"/>')
        elif sig_type in ("ecu_crank_cam",):
            # Crank/cam sensor
            lines.append(f'<circle cx="{comp_x}" cy="{y}" r="14" class="comp"/>')
            lines.append(f'<path d="M{comp_x-8},{y} Q{comp_x-4},{y-6} {comp_x},{y} Q{comp_x+4},{y+6} {comp_x+8},{y}" fill="none" stroke="black" stroke-width="1"/>')
        elif sig_type == "piezoelectric":
            # Knock sensor
            lines.append(f'<circle cx="{comp_x}" cy="{y}" r="14" class="comp"/>')
            lines.append(f'<text x="{comp_x}" y="{y+4}" text-anchor="middle" class="hdr" font-size="10">KS</text>')
        elif sig_type in ("analog_5v", "analog_temp"):
            # Sensor diamond
            lines.append(f'<polygon points="{comp_x},{y-14} {comp_x+14},{y} {comp_x},{y+14} {comp_x-14},{y}" class="comp"/>')
        elif sig_type == "h_bridge_motor":
            # Motor
            lines.append(f'<circle cx="{comp_x}" cy="{y}" r="14" class="comp"/>')
            lines.append(f'<text x="{comp_x}" y="{y+5}" text-anchor="middle" class="hdr" font-size="12">M</text>')

        # Component name (right of symbol)
        lines.append(f'<text x="{comp_x + 22}" y="{y - 2}" class="hdr" font-size="11">{component}</text>')

        # Notes (connector type, shielded, etc.)
        if notes:
            lines.append(f'<text x="{comp_x + 22}" y="{y + 12}" class="lbl-sm">{notes}</text>')

        # Grid address label (right edge)
        grid_addr = f"{ROW_LABELS[row]}25"
        lines.append(f'<text x="{gx(28)}" y="{y + 4}" class="lbl-sm">{grid_addr}</text>')

    lines.append('</g>')

    # ── TITLE BLOCK ──
    lines.append('<g id="titleblock">')
    tb_w = 380
    tb_h = 72
    tb_x = MARGIN_L + COLS * CELL_W - tb_w
    tb_y = MARGIN_T + ROWS * CELL_H + 25
    lines.append(f'<rect x="{tb_x}" y="{tb_y}" width="{tb_w}" height="{tb_h}" fill="white" stroke="black" stroke-width="1.5"/>')
    lines.append(f'<line x1="{tb_x}" y1="{tb_y+20}" x2="{tb_x+tb_w}" y2="{tb_y+20}" stroke="black" stroke-width="0.5"/>')
    lines.append(f'<line x1="{tb_x}" y1="{tb_y+40}" x2="{tb_x+tb_w}" y2="{tb_y+40}" stroke="black" stroke-width="0.5"/>')
    lines.append(f'<line x1="{tb_x}" y1="{tb_y+56}" x2="{tb_x+tb_w}" y2="{tb_y+56}" stroke="black" stroke-width="0.5"/>')
    lines.append(f'<text x="{tb_x+tb_w//2}" y="{tb_y+15}" text-anchor="middle" class="hdr" font-size="13">NUKE LTD — BOULDER CITY NV</text>')
    lines.append(f'<text x="{tb_x+tb_w//2}" y="{tb_y+34}" text-anchor="middle" class="hdr" font-size="11">1977 K5 BLAZER — LS3 / MOTEC M130</text>')
    lines.append(f'<text x="{tb_x+tb_w//2}" y="{tb_y+52}" text-anchor="middle" class="lbl" font-size="10">SECTION 2  {title_suffix}</text>')
    lines.append(f'<text x="{tb_x+tb_w//2}" y="{tb_y+67}" text-anchor="middle" class="lbl-sm">PAGE {page_num} OF {total_pages}  |  VIN CCL187Z210370  |  2026-04-04</text>')
    lines.append('</g>')

    # ── LEGEND (bottom left) ──
    lines.append('<g id="legend">')
    lg_x = MARGIN_L + 10
    lg_y = tb_y + 5
    lines.append(f'<rect x="{lg_x}" y="{lg_y}" width="260" height="62" fill="white" stroke="black" stroke-width="1"/>')
    lines.append(f'<text x="{lg_x+8}" y="{lg_y+14}" class="hdr" font-size="9">WIRE TYPES</text>')
    lines.append(f'<line x1="{lg_x+8}" y1="{lg_y+26}" x2="{lg_x+60}" y2="{lg_y+26}" class="wire"/>')
    lines.append(f'<text x="{lg_x+68}" y="{lg_y+30}" class="lbl-sm">POWER / LOW-SIDE DRIVE</text>')
    lines.append(f'<line x1="{lg_x+8}" y1="{lg_y+40}" x2="{lg_x+60}" y2="{lg_y+40}" class="wire-sig"/>')
    lines.append(f'<text x="{lg_x+68}" y="{lg_y+44}" class="lbl-sm">SIGNAL (5V / TEMP / ANALOG)</text>')
    lines.append(f'<line x1="{lg_x+8}" y1="{lg_y+54}" x2="{lg_x+60}" y2="{lg_y+54}" class="wire-shld"/>')
    lines.append(f'<text x="{lg_x+68}" y="{lg_y+58}" class="lbl-sm">SHIELDED 2-CONDUCTOR</text>')
    lines.append('</g>')

    lines.append('</svg>')

    out = os.path.join("docs/wiring/output", filename)
    with open(out, 'w') as f:
        f.write('\n'.join(lines))
    print(f"  {filename}: {W}x{H}px, {len(wires)} wires")
    return out

# === WIRE DATA ===
# (label, pin, gauge, color, component, signal_type, notes)

COILS = [
    ("IGN1", "A03", "20", "WHT",     "IGNITION COIL 1",  "low_side_drive", "D510C  12611424"),
    ("IGN2", "A06", "20", "WHT/RED", "IGNITION COIL 2",  "low_side_drive", "D510C  12611424"),
    ("IGN3", "A04", "20", "WHT/BLK", "IGNITION COIL 3",  "low_side_drive", "D510C  12611424"),
    ("IGN4", "A07", "20", "WHT/BLU", "IGNITION COIL 4",  "low_side_drive", "D510C  12611424"),
    ("IGN5", "A05", "20", "WHT/WHT", "IGNITION COIL 5",  "low_side_drive", "D510C  12611424"),
    ("IGN6", "A08", "20", "WHT/YEL", "IGNITION COIL 6",  "low_side_drive", "D510C  12611424"),
    ("IGN7", "A12", "20", "WHT/VIO", "IGNITION COIL 7",  "low_side_drive", "D510C  12611424"),
    ("IGN8", "A13", "20", "WHT/ORG", "IGNITION COIL 8",  "low_side_drive", "D510C  12611424"),
]

INJECTORS = [
    ("INJ1", "A19", "18", "GRN",     "FUEL INJECTOR 1",  "low_side_drive", "EV6/USCAR  12576341"),
    ("INJ2", "A20", "18", "GRN/WHT", "FUEL INJECTOR 2",  "low_side_drive", "EV6/USCAR  12576341"),
    ("INJ3", "A21", "18", "GRN/BLK", "FUEL INJECTOR 3",  "low_side_drive", "EV6/USCAR  12576341"),
    ("INJ4", "A22", "18", "GRN/RED", "FUEL INJECTOR 4",  "low_side_drive", "EV6/USCAR  12576341"),
    ("INJ5", "A27", "18", "GRN/BLU", "FUEL INJECTOR 5",  "low_side_drive", "EV6/USCAR  12576341"),
    ("INJ6", "A28", "18", "GRN/YEL", "FUEL INJECTOR 6",  "low_side_drive", "EV6/USCAR  12576341"),
    ("INJ7", "A29", "18", "GRN/VIO", "FUEL INJECTOR 7",  "low_side_drive", "EV6/USCAR  12576341"),
    ("INJ8", "A30", "18", "GRN/ORG", "FUEL INJECTOR 8",  "low_side_drive", "EV6/USCAR  12576341"),
]

SENSORS = [
    ("CKP",  "B01", "22", "BLU/WHT",     "CRANK POSITION SENSOR",  "ecu_crank_cam",  "SHIELDED  58x tooth"),
    ("CMP",  "B02", "22", "BLU/BLK",     "CAM POSITION SENSOR",    "ecu_crank_cam",  "SHIELDED  1x tooth"),
    ("KS1",  "B07", "22", "GRY",         "KNOCK SENSOR BANK 1",    "piezoelectric",  "SHIELDED  12589867"),
    ("KS2",  "B13", "22", "GRY/WHT",     "KNOCK SENSOR BANK 2",    "piezoelectric",  "SHIELDED  12589867"),
    ("MAP",  "A15", "22", "VIO/WHT",     "MAP SENSOR",             "analog_5v",      "3-wire  5V/SIG/GND"),
    ("IAT",  "B03", "22", "TAN",         "INTAKE AIR TEMP",        "analog_temp",    "2-wire  SIG/GND"),
    ("CLT",  "B04", "22", "TAN/WHT",     "COOLANT TEMP SENSOR",    "analog_temp",    "2-wire  SIG/GND"),
    ("TPS",  "---", "22", "VIO",         "THROTTLE POSITION",      "analog_5v",      "INTEGRAL TO ETB"),
    ("FPS",  "A16", "22", "VIO/BLK",     "FUEL PRESSURE SENSOR",   "analog_5v",      "3-wire  5V/SIG/GND"),
    ("OPS",  "A14", "22", "VIO/RED",     "OIL PRESSURE SENSOR",    "analog_5v",      "3-wire  12674513"),
    ("OTS",  "B05", "22", "TAN/BLK",     "OIL TEMP SENSOR",        "analog_temp",    "2-wire  SIG/GND"),
]

# === GENERATE ===
os.makedirs("docs/wiring/output", exist_ok=True)

print("Generating Section 2: LS3 Engine wiring diagrams...")
generate_page("K5_S2_P1_ignition_coils.svg",   "IGNITION COILS",   COILS,     1, 3)
generate_page("K5_S2_P2_fuel_injectors.svg",   "FUEL INJECTORS",   INJECTORS, 2, 3)
generate_page("K5_S2_P3_engine_sensors.svg",   "ENGINE SENSORS",   SENSORS,   3, 3)

print("Done. Opening...")
os.system("open docs/wiring/output/K5_S2_P1_ignition_coils.svg")
