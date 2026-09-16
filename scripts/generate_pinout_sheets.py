#!/usr/bin/env python3
"""
K5 Blazer MoTeC harness — print-grade pinout sheets (M130 A, M130 B, PDM30).

Stdlib only. Emits three 1700x2200 portrait SVG sheets to docs/wiring/output/pinouts/.

DATA PROVENANCE (no pin assignment is invented here — every row is transcribed):
  [1] docs/wiring/calc-data/pdm_power_budget.md
      - "M130 pin assignments in use" (harness spec wire schedule + appendix G)
      - AUTHORITATIVE PDM30 channel plan (K5_pdm30_channel_plan.md, 2026-04-05)
  [2] docs/wiring/output/K5_cut_list_v4.txt  (wires joined to pins via FROM column,
      incl. 2026-05-14 companion-wire addendum + 2026-06-09 v4 addendum:
      AV pin shuffle, Dakota #114-#124, T43 #125, E-Stopp #126, high-beam legs)
  [3] docs/wiring/chapters/appendix-g-diagram-requirements-spec.md
      - A10/A11 = BAT_NEG1/2, B15/B16 = SEN_0V_A/B (sensor star ground, §2.3)
      - B17/B18 = CAN_H/CAN_L (CAN backbone to PDM30 B25/B26)
      - Connector B pin map: CKP B01, CMP B02, knock B07/B13, IAT B03, CLT B04, OTS B05

Where pdm_power_budget's harness-spec M130 list and the cut list disagree, the CUT LIST
value is shown and an orange conflict note is added (per sheet-generation directive).
Conflicts RESOLVED by cut list v4 (receipts/2026-06-09_cut-list-v4.md) are annotated in
gray as resolved history; only genuine remaining TBDs/conflicts stay orange.

Run:  python3 scripts/generate_pinout_sheets.py
"""

import os

W, H = 1700, 2200
MX = 60                      # left/right margin for tables
ORANGE = "#E67300"
GRAY = "#8A8A8A"
INK = "#1A1A1A"
STRIPE = "#F2F2F2"
HDR_BG = "#D8D8D8"
SPARE_BG = "#FAFAFA"
FONT = "Courier New, Courier, monospace"

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "docs", "wiring", "output", "pinouts")

TITLE_BLOCK_NOTE = "DERIVED FROM K5_cut_list_v4 + pdm30_channel_plan; lengths/landmarks per calc engine"
DATE = "2026-06-09"


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# ----------------------------------------------------------------------------
# PIN DATA
# Each pin row: (pin, function, [wire lines], [circuit lines], [color lines],
#                awg, [dest lines], note_or_None, spare_bool)
# Multi-line cells are lists; single string = one line.
# note may be a plain string (ORANGE — genuine conflict/TBD) or a
# (text, color) tuple — use (text, GRAY) for resolved-history annotations.
# ----------------------------------------------------------------------------

def L(x):
    return x if isinstance(x, list) else [x]


# --- M130 CONNECTOR A (34-way) ----------------------------------------------
CONN_A = [
    ("A01", "OUT_HB2", "#4a", "ETB TAC Motor 2", "BRN", "20",
     "GM 12605109 Pin A (throttle body)", None, False),
    ("A02", "SEN_5V_A", ["#4e, 99r,", "102r, 112r"], "5V reference rail A", "GRY", "22",
     ["ETB Pin E + CKP + OPS +", "Fuel Press 5V supplies"], None, False),
    ("A03", "IGN_LS1", "#5", "Ignition Coil 3", "WHT", "22",
     "DEL-Stributor central mount", None, False),
    ("A04", "IGN_LS2", "#7", "Ignition Coil 5", "WHT/WHT", "22",
     "DEL-Stributor central mount", None, False),
    ("A05", "IGN_LS3", "#8", "Ignition Coil 7", "WHT/BLK", "22",
     "DEL-Stributor central mount", None, False),
    ("A06", "IGN_LS4", "#9", "Ignition Coil 2", "WHT/RED", "22",
     "DEL-Stributor central mount", None, False),
    ("A07", "IGN_LS5", "#10", "Ignition Coil 4", "WHT/BLU", "22",
     "DEL-Stributor central mount", None, False),
    ("A08", "IGN_LS6", "#11", "Ignition Coil 6", "WHT/YEL", "22",
     "DEL-Stributor central mount", None, False),
    ("A09", "SEN_5V_B", "#108r, 101r", "5V reference rail B", "GRY", "22",
     "MAP + CMP 5V supplies", None, False),
    ("A10", "BAT_NEG1", "—", "Battery negative", "—", "—",
     "Sensor star ground (appx G §2.3)", None, False),
    ("A11", "BAT_NEG2", "—", "Battery negative", "—", "—",
     "Sensor star ground (appx G §2.3)", None, False),
    ("A12", "IGN_LS7", "#12", "Ignition Coil 8", "WHT/VIO", "22",
     "DEL-Stributor central mount", None, False),
    ("A13", "IGN_LS8", "#24", "Ignition Coil 1", "WHT/ORG", "22",
     "DEL-Stributor central mount", None, False),
    ("A14", "AV1", "#4c", "ETB TPS1 Signal", "DK GRN", "22",
     "GM 12605109 Pin C (throttle body)",
     ("RESOLVED v4: AV1 collision cleared — #102 Oil Press moved to A25/AV5; ETB keeps A14 (newer decision wins). 2026-04-13 harness-spec AV map = STALE", GRAY), False),
    ("A15", "AV2", "#108", "MAP Sensor", "VIO/WHT", "22",
     "ACDelco PT2293 / Bosch 3-pin",
     ("v4: stays AV2 — 2026-04-13 harness-spec AV map STALE", GRAY), False),
    ("A16", "AV3", "#112", "Fuel Pressure Sensor", "VIO/BLK", "22",
     "Fuel rail pressure sender",
     ("RESOLVED v4: stays AV3 — 2026-04-13 harness-spec AV map (Oil Press on AV3) marked STALE", GRAY), False),
    ("A17", "AV4", "#4d", "ETB TPS2 Signal", "PPL", "22",
     "GM 12605109 Pin D (throttle body)",
     ("RESOLVED v4: stays AV4 — 2026-04-13 harness-spec AV map (TPS1 on AV4) marked STALE", GRAY), False),
    ("A18", "OUT_HB1", "#4b", "ETB TAC Motor 1", "YEL", "20",
     "GM 12605109 Pin B (throttle body)", None, False),
    ("A19", "INJ_PH1", "#13", "Fuel Injector 1", "GRN", "22",
     "EV6/USCAR @ fuel rail cyl 1", None, False),
    ("A20", "INJ_PH2", "#14", "Fuel Injector 2", "GRN/WHT", "22",
     "EV6/USCAR @ fuel rail cyl 2", None, False),
    ("A21", "INJ_PH3", "#15", "Fuel Injector 3", "GRN/BLK", "22",
     "EV6/USCAR @ fuel rail cyl 3", None, False),
    ("A22", "INJ_PH4", "#16", "Fuel Injector 4", "GRN/RED", "22",
     "EV6/USCAR @ fuel rail cyl 4", None, False),
    ("A23", None, None, None, None, None, None, None, True),
    ("A24", None, None, None, None, None, None, None, True),
    ("A25", "AV5", "#102", "Oil Pressure (ECU)", "VIO", "22",
     "Oil press sender (galley); gnd #102g → B16, 5V #102r → A02",
     ("RESOLVED v4: #102 MOVED A14 → A25 (AV5) per receipts/2026-06-09_cut-list-v4.md — only free AV pin; zero recrimps elsewhere", GRAY), False),
    ("A26", None, None, None, None, None, None, None, True),
    ("A27", "INJ_PH5", "#17", "Fuel Injector 5", "GRN/BLU", "22",
     "EV6/USCAR @ fuel rail cyl 5", None, False),
    ("A28", "INJ_PH6", "#18", "Fuel Injector 6", "GRN/YEL", "22",
     "EV6/USCAR @ fuel rail cyl 6", None, False),
    ("A29", "INJ_PH7", "#19", "Fuel Injector 7", "GRN/VIO", "22",
     "EV6/USCAR @ fuel rail cyl 7", None, False),
    ("A30", "INJ_PH8", "#20", "Fuel Injector 8", "GRN/ORG", "22",
     "EV6/USCAR @ fuel rail cyl 8", None, False),
    ("A31", "OUT_HB3", "#116", "Dakota Tach Signal", "WHT/BLK", "22",
     "Dakota VHX cluster tach input (dash)",
     ("v4: spare half-bridge as tach pulse (resolved 2026-05-14, K5_WIRING_STATE.md §3); requires M1 GPR config at tune", GRAY), False),
    ("A32", "OUT_HB4", "#118", "Dakota VSS / Speedo", "WHT/YEL", "22",
     "Dakota VHX cluster speedo input (dash)",
     ("v4: spare half-bridge as VSS mirror (resolved 2026-05-14, K5_WIRING_STATE.md §3); requires M1 GPR config at tune", GRAY), False),
    ("A33", None, None, None, None, None, None, None, True),
    ("A34", None, None, None, None, None, None, None, True),
]

# --- M130 CONNECTOR B (26-way) ----------------------------------------------
CONN_B = [
    ("B01", "UDIG1", "#99", "Crank Position Sensor", "BLU/WHT/WHT", "22",
     "3-pin Metri-Pack CKP; SHLD 2C, drain → B15 (#99s)", None, False),
    ("B02", "UDIG2", "#101", "Cam Position Sensor", "BLU/WHT/BLK", "22",
     "CMP; SHLD 2C, drain → B16 (#101s)",
     ("RESOLVED v4: Rear Backup Camera on B02 (2026-04-13 spec) marked STALE — B02 = CMP; camera pwr = PDM30:OUT15 (#97)", GRAY), False),
    ("B03", "AT1", "#109", "Intake Air Temp Sensor", "TAN", "22",
     "IAT; gnd #109g → B15",
     "CONFLICT: pdm_power_budget M130 list swaps CLT/IAT on B03/B04; cut list v4 + appendix-g value shown", False),
    ("B04", "AT2", "#110", "Coolant Temp Sensor (ECU)", "TAN/WHT", "22",
     "CLT; gnd #110g → B16",
     "CONFLICT: see B03 — cut list v4 + appendix-g value shown", False),
    ("B05", "AT3", "#113", "Oil Temperature Sensor", "TAN/BLK", "22",
     "OTS; gnd #113g → B15", None, False),
    ("B06", "AT4", "—", "(reserved — no wire)", "—", "—", "—",
     "SPARE AT4 — no signal wire yet (cut list v4 KNOWN GAPS); companion gnd needed when assigned", False),
    ("B07", "KNOCK1", "#103", "Knock Sensor Bank 1", "GRY", "22",
     "Piezo 2-pin; SHLD 2C, drain → B15", None, False),
    ("B08", None, None, None, None, None, None, None, True),
    ("B09", None, None, None, None, None, None, None, True),
    ("B10", None, None, None, None, None, None, None, True),
    ("B11", None, None, None, None, None, None, None, True),
    ("B12", None, None, None, None, None, None, None, True),
    ("B13", "KNOCK2", "#104", "Knock Sensor Bank 2", "GRY/WHT", "22",
     "Piezo 2-pin; SHLD 2C, drain → B16", None, False),
    ("B14", None, None, None, None, None, None, None, True),
    ("B15", "SEN_0V_A", ["#4f, 99g, 99s, 103g,", "103s, 108g, 109g, 113g"],
     "Sensor 0V star A", ["BLK /", "BARE"], "22",
     ["ETB + CKP + Knock1 gnds/drains,", "MAP + IAT + OTS grounds"], None, False),
    ("B16", "SEN_0V_B", ["#101g, 101s, 102g,", "104g, 104s, 110g, 112g"],
     "Sensor 0V star B", ["BLK /", "BARE"], "22",
     ["CMP + Knock2 gnds/drains,", "OPS + CLT + FuelPress grounds"], None, False),
    ("B17", "CAN_H", "#62", "CAN Bus Network", "WHT/GRN", "24",
     ["PDM30 B25 + C125/Dakota +", "T43 TCU (#125 stub); 120Ω ea end"],
     ("v4: #125 Holley T43 CAN stub (2.0ft) splices trunk #62 — stub is 22 AWG vs 24 AWG trunk, flagged in v4 receipt", GRAY), False),
    ("B18", "CAN_L", "#62", "CAN Bus Network", "WHT/GRN", "24",
     ["PDM30 B26 + C125/Dakota +", "T43 TCU (#125 stub); 120Ω ea end"], None, False),
    ("B19", None, None, None, None, None, None, None, True),
    ("B20", None, None, None, None, None, None, None, True),
    ("B21", None, None, None, None, None, None, None, True),
    ("B22", None, None, None, None, None, None, None, True),
    ("B23", None, None, None, None, None, None, None, True),
    ("B24", None, None, None, None, None, None, None, True),
    ("B25", None, None, None, None, None, None, None, True),
    ("B26", None, None, None, None, None, None, None, True),
]

# --- PDM30 OUTPUT CHANNELS (AUTHORITATIVE plan 2026-04-05) -------------------
# (ch, rating, device/group, est amps, [wire lines], [color lines], awg, note)
PDM = [
    ("OUT1", "20A", "Radiator Fan 1", "18A", "#21", "ORN/WHT", "12", None),
    ("OUT2", "20A", "Radiator Fan 2", "18A", "#22", "ORN/BLK", "12", None),
    ("OUT3", "20A", "Power Window Motor Left", "15A", "#34", "DK BLU", "16", None),
    ("OUT4", "20A", "Power Window Motor Right", "15A", "#35", "DK BLU/WHT", "16", None),
    ("OUT5", "20A", "Electric Water Pump", "12A", "#25", "ORN/BLU", "14", None),
    ("OUT6", "20A", "Heater Blower Motor", "12A", "#51", "ORN/BLK/BLU", "10", None),
    ("OUT7", "20A", "Electric Parking Brake (E-Stopp)", "10A", "#54", "ORN/BLK/YEL", "16",
     ("v4: #126 dash button trigger (22 AWG ORN/WHT, 10.0ft) → E-Stopp signal pin landed; button PN TBD (Carling-style)", GRAY)),
    ("OUT8", "20A", "Cigarette Lighter / 12V Outlet", "10A", "#72", "ORN/ORG", "14", None),
    ("OUT9", "8A", "AMP Research Step Left", "8A", "#1", "ORN/BLK", "18", None),
    ("OUT10", "8A", "AMP Research Step Right", "8A", "#2", "ORN/BLK/WHT", "18", None),
    ("OUT11", "8A", "AMP Research Controller", "2A", "#3", "ORN/BLK/BLK", "22", None),
    ("OUT12", "8A", "Windshield Wiper Motor", "6A", "#49", "PPL", "18", None),
    ("OUT13", "8A", ["park_tail group", "(Tail L/R + Park LF/RF)"], "1.6A",
     "#75, 81, 83, 84", ["BRN/YEL, BRN/BLK,", "BRN/RED, BRN/BLU"], "22", None),
    ("OUT14", "8A", "Horn", "5A", "#48", "ORN/ORG", "16", None),
    ("OUT15", "8A", ["backup group (Backup L/R", "+ 3rd Brake + Backup Camera)"], "3.0–3.5A",
     "#76, 89, 93, 97", ["BRN/VIO, BRN/ORG,", "BRN/RED, BLU/WHT"], "22", None),
    ("OUT16", "8A", "A/C Compressor Clutch", "4A", "#23", "ORN/RED", "20", None),
    ("OUT17", "8A", ["LED Headlight Left", "(→ floor dimmer COMMON)"], "3.6A", "#85", "LT GRN", "20",
     ("v4: legs #85a LOW / #85b HIGH (16 AWG) dimmer → lamp landed; #121 Dakota high-beam ind taps #85b", GRAY)),
    ("OUT18", "8A", ["LED Headlight Right", "(→ floor dimmer COMMON)"], "3.6A", "#86", "LT GRN/WHT", "20",
     ("v4: legs #86a LOW / #86b HIGH (16 AWG) paralleled at dimmer; dimmer PN/connector TBD", GRAY)),
    ("OUT19", "8A", ["markers_clearance group", "(8 fixtures)"], "1.25–1.3A",
     ["#77, 78, 79, 87,", "88, 90, 91, 92"],
     ["BRN/ORG, BRN, BRN/WHT(x2), BRN(x2),", "BRN/YEL, BRN/VIO, BRN/BLK"], "22", None),
    ("OUT20", "8A", "Radio / Head Unit", "3A", "#31", "ORN/BLK", "22", None),
    ("OUT21", "8A", "Power Lock Actuator Left", "3A", "#38", "BLK", "20", None),
    ("OUT22", "8A", "Power Lock Actuator Right", "3A", "#47", "BLK/WHT", "20", None),
    ("OUT23", "8A", "Transmission Controller", "3A", "#58", "ORN/YEL", "22",
     ("v4: powers Holley 558-499 T43 TCU (3A); CAN via #125 stub off trunk #62", GRAY)),
    ("OUT24", "8A", "Wideband Lambda Controller", "3A", "#64", "ORN/BLK", "22", None),
    ("OUT25", "8A", ["interior_courtesy group (Dome,", "U-Dash, Footwell, U-Hood, Cargo)"], "1.9–2.5A",
     "#67, 68, 69, 73, 74", ["BRN, BRN/WHT, BRN/BLK,", "BRN/RED, BRN/BLU"], "22", None),
    ("OUT26", "8A", "Washer Pump", "2A", "#50", "ORN/BLK/RED", "22", None),
    ("OUT27", "8A", "Turn Signal Left Front", "2A", ["#80", "(+#119 tap)"], "LT BLU", "22",
     ("v4: #119 Dakota L-turn input = dash-side splice on #80", GRAY)),
    ("OUT28", "8A", "Turn Signal Right Front", "2A", ["#82", "(+#120 tap)"], "DK BLU", "22",
     ("v4: #120 Dakota R-turn input = dash-side splice on #82", GRAY)),
    ("OUT29", "8A", "Display / Dash (MoTeC C125)", "1A", ["#65", "(+#124 splice)"], "ORN/RED", "22",
     "v4: #124 Dakota switched-+12V backup splices OUT29 — verify vs Dakota internal jumper; #124 ORN/RED collides with #117 — reassign at mockup"),
    ("OUT30", "8A", "USB Charging Port", "1A", "#70", "ORN/YEL", "22", None),
]


# ----------------------------------------------------------------------------
# SVG primitives
# ----------------------------------------------------------------------------

class Sheet:
    def __init__(self):
        self.parts = []

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill="none", stroke=INK, sw=1):
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                 f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def line(self, x1, y1, x2, y2, stroke=INK, sw=1):
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                 f'stroke="{stroke}" stroke-width="{sw}"/>')

    def text(self, x, y, s, size=12, fill=INK, bold=False, anchor="start"):
        w = ' font-weight="bold"' if bold else ""
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}"'
                 f'{w} fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>')

    def svg(self):
        body = "\n".join(self.parts)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
                f'viewBox="0 0 {W} {H}">\n'
                f'<rect x="0" y="0" width="{W}" height="{H}" fill="#FFFFFF"/>\n'
                f'{body}\n</svg>\n')


def title_block(s, sheet_no):
    """Engineering title block, bottom-right."""
    bw, bh = 640, 168
    x = W - 40 - bw
    y = H - 40 - bh
    s.rect(x, y, bw, bh, fill="#FFFFFF", sw=2)
    rows = [30, 58, 86, 114, 140]
    for ry in rows[:4]:
        s.line(x, y + ry, x + bw, y + ry, sw=1)
    s.text(x + 12, y + 21, "NUKE LTD / DESERT PERFORMANCE", 15, bold=True)
    s.text(x + 12, y + 49, "1977 CHEVROLET K5 BLAZER — VIN CKR187F127263", 13)
    s.text(x + 12, y + 77, "LS3 6.2L / MoTeC M130 + PDM30", 13)
    s.text(x + 12, y + 105, f"SHEET {sheet_no} OF 3   —   {DATE}   —   REV A", 13, bold=True)
    s.text(x + 12, y + 131, TITLE_BLOCK_NOTE[:62], 10)
    s.text(x + 12, y + 152, TITLE_BLOCK_NOTE[62:], 10)


def frame(s):
    s.rect(30, 30, W - 60, H - 60, sw=3)
    s.rect(38, 38, W - 76, H - 76, sw=1)


def connector_face(s, y0, prefix, total, per_row, assigned_pins, label):
    """Simple 2-row cavity grid, mating-face schematic."""
    cav, gap = 44, 8
    rows = (total + per_row - 1) // per_row
    gw = per_row * cav + (per_row - 1) * gap
    x0 = (W - gw) / 2
    # housing outline
    s.rect(x0 - 24, y0 - 20, gw + 48, rows * (cav + gap) - gap + 40, sw=2)
    # keying tab
    s.rect(x0 + gw / 2 - 30, y0 - 34, 60, 14, fill="#EEEEEE", sw=1.5)
    s.text(x0 + gw / 2, y0 - 23, "KEY", 9, anchor="middle")
    n = 1
    for r in range(rows):
        for c in range(per_row):
            if n > total:
                break
            pin = f"{prefix}{n:02d}"
            px = x0 + c * (cav + gap)
            py = y0 + r * (cav + gap)
            used = pin in assigned_pins
            s.rect(px, py, cav, cav, fill="#D9E2EA" if used else "#FFFFFF", sw=1.5)
            s.text(px + cav / 2, py + cav / 2 + 4, f"{n:02d}", 12,
                   fill=INK if used else GRAY, bold=used, anchor="middle")
            n += 1
    by = y0 + rows * (cav + gap) - gap + 34
    s.text(W / 2, by, label, 11, anchor="middle")
    s.text(W / 2, by + 16,
           "CAVITY NUMBERING PER MOTEC TECHSPEC — SCHEMATIC GRID; VERIFY AT MATING FACE BEFORE PINNING",
           10, fill=GRAY, anchor="middle")
    # legend
    lx = x0 - 24
    ly = by + 30
    s.rect(lx, ly - 11, 14, 14, fill="#D9E2EA", sw=1)
    s.text(lx + 20, ly, "= ASSIGNED", 10)
    s.rect(lx + 110, ly - 11, 14, 14, fill="#FFFFFF", sw=1)
    s.text(lx + 130, ly, "= SPARE", 10)
    return by + 44


def draw_table(s, y0, cols, header, rows_data):
    """
    cols: list of widths. header: list of strings.
    rows_data: list of dicts {cells: [list-of-lines per col], note, spare}
    Returns y after table.
    """
    tx = MX
    tw = sum(cols)
    hh = 34
    # header
    s.rect(tx, y0, tw, hh, fill=HDR_BG, sw=1.5)
    cx = tx
    for wcol, htxt in zip(cols, header):
        s.text(cx + 8, y0 + 22, htxt, 12, bold=True)
        cx += wcol
    y = y0 + hh
    for i, row in enumerate(rows_data):
        nlines = max(len(L(c)) for c in row["cells"])
        rh = max(36, 12 + 15 * nlines)
        note = row.get("note")
        if note:
            rh += 16 * len(L(note))
        bg = SPARE_BG if row.get("spare") else ("#FFFFFF" if i % 2 == 0 else STRIPE)
        s.rect(tx, y, tw, rh, fill=bg, sw=0.75, stroke="#666666")
        cx = tx
        color = GRAY if row.get("spare") else INK
        for wcol, cell in zip(cols, row["cells"]):
            for li, lt in enumerate(L(cell)):
                s.text(cx + 8, y + 24 + 15 * li, lt, 12, fill=color)
            cx += wcol
        if note:
            ncol = row.get("note_color", ORANGE)
            for li, nt in enumerate(L(note)):
                s.text(tx + cols[0] + 8, y + 24 + 15 * (nlines - 1) + 16 * (li + 1),
                       nt, 11, fill=ncol, bold=(ncol == ORANGE))
        y += rh
    # column separator lines
    cx = tx
    for wcol in cols[:-1]:
        cx += wcol
        s.line(cx, y0, cx, y, stroke="#666666", sw=0.75)
    s.rect(tx, y0, tw, y - y0, sw=1.5)
    return y


def wrap_note(note, width=118):
    """Crude wrap for orange notes."""
    if note is None:
        return None
    words = note.split(" ")
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    return lines


def split_note(note):
    """note is None, a string (ORANGE), or a (text, color) tuple."""
    if note is None:
        return None, ORANGE
    if isinstance(note, tuple):
        return note[0], note[1]
    return note, ORANGE


def m130_rows(pin_data):
    rows = []
    for (pin, func, wire, circ, color, awg, dest, note, spare) in pin_data:
        if spare:
            rows.append({"cells": [pin, "— SPARE —", "—", "—", "—", "—", "—"],
                         "spare": True})
        else:
            ntxt, ncol = split_note(note)
            rows.append({"cells": [pin, func, wire, circ, color, awg, dest],
                         "note": wrap_note(ntxt), "note_color": ncol,
                         "spare": False})
    return rows


def sheet_m130(connector, pin_data, total, per_row, sheet_no, fname):
    s = Sheet()
    frame(s)
    s.text(W / 2, 86, f"M130 ECU — CONNECTOR {connector} "
                      f"({total}-WAY TYCO SUPERSEAL)", 30, bold=True, anchor="middle")
    s.text(W / 2, 116, "1977 CHEVROLET K5 BLAZER — LS3 6.2L — MoTeC M130 ENGINE HARNESS",
           14, anchor="middle")
    assigned = {p[0] for p in pin_data if not p[8]}
    y = connector_face(s, 190, connector, total, per_row, assigned,
                       f"CONNECTOR {connector} — MATING FACE VIEW (HARNESS SIDE)")
    cols = [70, 150, 175, 305, 185, 65, 630]
    header = ["PIN", "M130 FUNCTION", "WIRE #", "CIRCUIT", "COLOR", "AWG", "DESTINATION"]
    y = draw_table(s, y + 14, cols, header, m130_rows(pin_data))
    # footer notes
    fy = y + 28
    s.text(MX, fy, "NOTES:", 12, bold=True)
    notes = [
        ("Cut-list wires with FROM = 'ECU' (switch/digital inputs #33,36,37,39–46,53,98,100,105–107,111) "
         "have no M130 pin in cut list v4 — pin assignment TBD.", ORANGE),
        ("#98 Fuel Level Sender needs an AV pin: 2026-05-14 Dakota addendum claimed A25/AV5, but v4 assigns "
         "A25 to #102 Oil Press — next free AV input per MoTeC techspec, or Skylar call (v4 open item 1).", ORANGE),
        ("Sources: pdm_power_budget.md (M130 pins in use) + K5_cut_list_v4.txt (wires, via FROM column) + "
         "appendix-g (BAT_NEG / SEN_0V / CAN pins) + receipts/2026-06-09_cut-list-v4.md (AV shuffle, Dakota A31/A32).", INK),
        ("Spare cavities carry no terminal; plug with sealed cavity plugs per Superseal practice.", GRAY),
    ]
    for txt, col in notes:
        for ln in wrap_note(txt, 150):
            fy += 17
            s.text(MX + 10, fy, ln, 11, fill=col)
    title_block(s, sheet_no)
    write(fname, s)


def pdm_rows():
    rows = []
    for (ch, rating, dev, amps, wire, color, awg, note) in PDM:
        ntxt, ncol = split_note(note)
        rows.append({"cells": [ch, rating, dev, amps, wire, color, awg],
                     "note": wrap_note(ntxt), "note_color": ncol,
                     "spare": False})
    return rows


def sheet_pdm(fname):
    s = Sheet()
    frame(s)
    s.text(W / 2, 86, "PDM30 — OUTPUT CHANNELS", 30, bold=True, anchor="middle")
    s.text(W / 2, 116, "1977 CHEVROLET K5 BLAZER — LS3 6.2L — MoTeC PDM30 POWER DISTRIBUTION",
           14, anchor="middle")
    s.text(W / 2, 140, "CHANNEL PLAN: K5_pdm30_channel_plan.md (2026-04-05, AUTHORITATIVE) — "
                       "30/30 CHANNELS USED, 0 SPARE", 12, anchor="middle")
    cols = [85, 95, 480, 110, 240, 480, 90]
    header = ["CH", "RATING", "DEVICE / GROUP", "EST AMPS", "WIRE #", "COLOR", "AWG"]
    y = draw_table(s, 170, cols, header, pdm_rows())

    # ----- TBD rails (orange) -----
    fy = y + 26
    s.text(MX, fy, "POWER RAILS — CHANNEL TBD:", 13, bold=True, fill=ORANGE)
    for txt in [
        "#INJ_PWR  Injector +12V rail   16 AWG  RED  5.0ft — feeds 8x EV6 injectors @ fuel rail — PDM CHANNEL TBD",
        "#COIL_PWR Coil +12V rail       16 AWG  RED  3.0ft — feeds 8x D510C @ DEL-Stributor bracket — PDM CHANNEL TBD",
    ]:
        fy += 18
        s.text(MX + 10, fy, txt, 11, fill=ORANGE, bold=True)
    fy += 24
    s.text(MX, fy, "PDM-FED, CHANNEL NOT SPECIFIED IN CUT LIST v4:", 13, bold=True, fill=ORANGE)
    fy += 18
    s.text(MX + 10, fy, "#55 Transfer Case Ind · #56 Neutral Safety Sw · #57 Reverse Light Sw · "
                        "#71 Dakota Digital (IGN rail tap, not a channel) · #94 Fuel Pump Rly · #95 iBooster Rly",
           11, fill=ORANGE)

    # ----- direct-wired block -----
    fy += 30
    bx, bw = MX, W - 2 * MX
    bh = 130
    s.rect(bx, fy, bw, bh, fill="#F7F7F7", sw=1.5)
    s.text(bx + 12, fy + 24, "NOT ON PDM — DIRECT WIRED", 14, bold=True)
    direct = [
        "#59  Alternator           0 AWG  ORN/VIO  (220A source; capacity inconsistent across docs: 250A/220A/150A)",
        "#6   Starter Motor        0 AWG  ORN      (200A peak)        #63  Battery Disconnect  0 AWG  ORN/WHT (190A)",
        "#66  Fuel Pump            8 AWG  ORN/BLU  (35A, Aeromotive 16301 relay)",
        "#52  Bosch iBooster       8 AWG  ORN      (40A peak, dedicated relay)",
        "#32  Amplifier            8 AWG  ORN/RED  (30A, direct fused battery)   — injectors/coils sw via M130 low-side",
    ]
    for i, dtxt in enumerate(direct):
        s.text(bx + 12, fy + 46 + i * 17, dtxt, 11)

    fy += bh + 24
    s.text(MX, fy, "NOTE: stale harness_spec_latest.txt (2026-04-13) carries a different channel map "
                   "(6x20A + 14x15A + 10x10A, E-Stopp ch7/8, QTP cutouts, keypad) — superseded by the "
                   "2026-04-05 authoritative plan shown above.", 10, fill=GRAY)
    title_block(s, 3)
    write(fname, s)


def write(fname, sheet):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, fname)
    with open(path, "w") as f:
        f.write(sheet.svg())
    print("wrote", os.path.normpath(path))


if __name__ == "__main__":
    sheet_m130("A", CONN_A, 34, 17, 1, "K5_pinout_M130A.svg")
    sheet_m130("B", CONN_B, 26, 13, 2, "K5_pinout_M130B.svg")
    sheet_pdm("K5_pinout_PDM30.svg")
