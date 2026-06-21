#!/usr/bin/env python3
"""
K5 Blazer — FULL system schematic page set (sheets 1-6), print-grade.

Companion to scripts/generate_pinout_sheets.py (same title-block / style conventions)
and to the existing engine-loom pages docs/wiring/output/K5_S2_*.svg (engine ignition /
injectors / sensors are NOT redrawn here — cross-referenced as "S2").

Stdlib only. Emits six 2200x1700 landscape SVG sheets to docs/wiring/output/schematics/.

DATA PROVENANCE (no wire id, color, gauge, or channel is invented — every value transcribed):
  [1] docs/wiring/output/K5_cut_list_v4.txt          (2026-06-09, v4 — CANONICAL wire rows)
  [2] docs/wiring/calc-data/pdm_power_budget.md       (AUTHORITATIVE PDM30 plan 2026-04-05)
  [3] docs/wiring/calc-data/subsystems.json           (wire_ids per subsystem, shared-channel warnings)
  [4] docs/wiring/output/K5_wire_paths.yaml           (landmark routing: FWG-MAIN, FLOOR-RR, boots)
  [5] nuke_frontend/src/components/wiring/objectTraits.ts (ground points: G3-G8, STAR_* legs)

Conflicts / TBDs are shown ORANGE (#E67300) per sheet-generation directive — never resolved
silently. Receipt: docs/wiring/receipts/2026-06-09_system-schematic-pages.md

Run:  python3 scripts/generate_schematic_pages.py          # SVGs only
      python3 scripts/generate_schematic_pages.py --render # + PNG (rsvg-convert) + merged PDF (qpdf)
"""

import os
import subprocess
import sys

W, H = 2200, 1700
ORANGE = "#E67300"
GREEN = "#1E7D32"
GRAY = "#8A8A8A"
INK = "#1A1A1A"
HDR_BG = "#D8D8D8"
BOX_BG = "#F7F7F7"
FONT = "Courier New, Courier, monospace"
DATE = "2026-06-09"
TITLE_BLOCK_NOTE = ("DERIVED FROM K5_cut_list_v4 + pdm30 channel plan (2026-04-05 AUTH) "
                    "+ wire_paths + subsystems.json + objectTraits grounds")

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "docs", "wiring", "output", "schematics")

N_SHEETS = 6


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Sheet:
    def __init__(self):
        self.parts = []

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill="none", stroke=INK, sw=1, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                 f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def line(self, x1, y1, x2, y2, stroke=INK, sw=1, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def poly(self, pts, stroke=INK, sw=1.2):
        p = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        self.add(f'<polyline points="{p}" fill="none" stroke="{stroke}" stroke-width="{sw}"/>')

    def circle(self, x, y, r, fill="none", stroke=INK, sw=1.5):
        self.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{fill}" '
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


def frame(s):
    s.rect(30, 30, W - 60, H - 60, sw=3)
    s.rect(38, 38, W - 76, H - 76, sw=1)


def title_block(s, sheet_no, sheet_title):
    bw, bh = 660, 168
    x = W - 46 - bw
    y = H - 46 - bh
    s.rect(x, y, bw, bh, fill="#FFFFFF", sw=2)
    for ry in (30, 58, 86, 114):
        s.line(x, y + ry, x + bw, y + ry, sw=1)
    s.text(x + 12, y + 21, "NUKE LTD / DESERT PERFORMANCE", 15, bold=True)
    s.text(x + 12, y + 49, "1977 CHEVROLET K5 BLAZER — VIN CKR187F127263", 13)
    s.text(x + 12, y + 77, f"SYSTEM SCHEMATICS — {sheet_title}", 13)
    s.text(x + 12, y + 105, f"SHEET {sheet_no} OF {N_SHEETS}   —   {DATE}   —   REV A", 13, bold=True)
    s.text(x + 12, y + 131, TITLE_BLOCK_NOTE[:74], 10)
    s.text(x + 12, y + 152, TITLE_BLOCK_NOTE[74:], 10)


def header(s, title, subtitle):
    s.text(W / 2, 88, title, 28, bold=True, anchor="middle")
    s.text(W / 2, 116, subtitle, 13, anchor="middle")


def legend(s, x, y):
    s.text(x, y, "LEGEND:", 11, bold=True)
    s.line(x + 80, y - 4, x + 130, y - 4, sw=1.2)
    s.text(x + 136, y, "wire run (id in box, COLOR · AWG · LEN on run)", 10)
    s.circle(x + 540, y - 4, 7, stroke=GREEN, sw=2)
    s.text(x + 554, y, "grommet / boot pass-through", 10)
    s.rect(x + 790, y - 12, 40, 15, dash="5,3")
    s.text(x + 838, y, "physical boundary", 10)
    s.text(x + 990, y, "ORANGE = CONFLICT / TBD", 10, fill=ORANGE, bold=True)
    s.text(x + 1210, y, "GRAY = cross-ref other sheet", 10, fill=GRAY)


def gnd_symbol(s, x, y, scale=1.0):
    s.line(x, y - 10 * scale, x, y, sw=1.5)
    s.line(x - 11 * scale, y, x + 11 * scale, y, sw=1.5)
    s.line(x - 7 * scale, y + 5 * scale, x + 7 * scale, y + 5 * scale, sw=1.5)
    s.line(x - 3 * scale, y + 10 * scale, x + 3 * scale, y + 10 * scale, sw=1.5)


def fuse_symbol(s, x, y, label):
    """Inline fuse on a horizontal wire at (x,y): rect with through-line."""
    fw, fh = 44, 16
    s.rect(x - fw / 2, y - fh / 2, fw, fh, fill="#FFFFFF", sw=1.5)
    s.line(x - fw / 2, y, x + fw / 2, y, sw=1.2)
    s.text(x, y - 12, label, 10, bold=True, anchor="middle")


# ----------------------------------------------------------------------------
# GENERIC ROWS-PAGE ENGINE
# sections: [ {title, orange?, rows:[ {pin, pin_orange?, wid, label, dev,
#              note?, note_orange?, grom?(bool), fuse?(str), ref?(bool)} ]} ]
# devices:  { dev_id: {name, lines:[(text,color)...], orange?, dashed?(str), gnd?} }
# ----------------------------------------------------------------------------

SRC_X, SRC_W = 70, 310
DEV_X, DEV_W = 1530, 600


def rows_page(fname, sheet_no, title, subtitle, sections, devices, dev_order,
              footer_notes=None, grommets=None, junction=None,
              y0=170, y_max=1448, elbow_x0=1140, lane_step=24,
              row_step=None, label_x=None, extra_texts=None):
    """grommets: [(x, label, row_filter_key)] — circle drawn at x on rows where row.get(key)."""
    s = Sheet()
    frame(s)
    header(s, title, subtitle)

    all_rows = [r for sec in sections for r in sec["rows"]]
    n_rows = len(all_rows)
    sec_pad = 34  # per-section title strip
    if row_step is None:
        row_step = min(40, int((y_max - y0 - sec_pad * len(sections)) / max(1, n_rows)))
    src_right = SRC_X + SRC_W

    # ---- assign device geometry ----
    dev_entries = {d: [] for d in devices}
    for sec in sections:
        for r in sec["rows"]:
            dev_entries[r["dev"]].append(r)
    HDRH = 26
    total_e = sum(len(dev_entries[d]) for d in dev_order)
    n_dev = len(dev_order)
    estep = min(26, int((y_max - y0 - n_dev * (HDRH + 8) - (n_dev - 1) * 10) / max(1, total_e)))
    dgap = 10
    dev_geom = {}
    dy = y0
    for d in dev_order:
        n = len(dev_entries[d])
        extra = (len(devices[d].get("lines", [])) * 16)
        hh = HDRH + n * estep + 8 + extra
        dev_geom[d] = (dy, hh)
        dy += hh + dgap

    # ---- draw device boxes ----
    for d in dev_order:
        dv = devices[d]
        y, hh = dev_geom[d]
        if dv.get("dashed"):
            s.rect(DEV_X - 14, y - 10, DEV_W + 28, hh + 20, dash="7,4", sw=1.2)
            s.text(DEV_X - 6, y - 16, dv["dashed"], 10, fill=GRAY)
        s.rect(DEV_X, y, DEV_W, hh, fill=BOX_BG, sw=1.6,
               stroke=ORANGE if dv.get("orange") else INK)
        s.text(DEV_X + 10, y + 18, dv["name"], 13, bold=True,
               fill=ORANGE if dv.get("orange") else INK)
        ly = y + HDRH + len(dev_entries[d]) * estep + 4
        for txt, col in dv.get("lines", []):
            ly += 16
            s.text(DEV_X + 10, ly - 4, txt, 10, fill=col)
        if dv.get("gnd"):
            gnd_symbol(s, DEV_X + DEV_W - 26, y + hh / 2 - 4)

    # ---- junction box (drawn under wires) ----
    if junction:
        jx, jw, jlabel, jl2 = junction
        jy0 = y0 - 8
        jy1 = max(yy + hh for yy, hh in dev_geom.values()) if dev_geom else y_max
        jy1 = min(jy1, y_max)
        s.rect(jx, jy0, jw, jy1 - jy0, fill="#EDEDED", sw=1.6)
        s.text(jx + jw / 2, jy0 + 16, jlabel, 11, bold=True, anchor="middle")
        s.text(jx + jw / 2, jy0 + 30, jl2, 9, anchor="middle")

    # ---- source sections + wires ----
    lane_of = {d: i for i, d in enumerate(dev_order)}
    entry_used = {d: 0 for d in devices}
    ry = y0
    for sec in sections:
        n = len(sec["rows"])
        sh = 30 + n * row_step + 6
        col = ORANGE if sec.get("orange") else INK
        s.rect(SRC_X, ry, SRC_W, sh, fill="#FFFFFF", sw=1.8, stroke=col)
        s.rect(SRC_X, ry, SRC_W, 24, fill=HDR_BG, sw=1.2, stroke=col)
        s.text(SRC_X + 8, ry + 17, sec["title"], 12, bold=True, fill=col)
        for i, r in enumerate(sec["rows"]):
            wy = ry + 30 + i * row_step + row_step / 2 - 4
            pin_col = ORANGE if r.get("pin_orange") else INK
            s.text(src_right - 8, wy + 4, r["pin"], 11, bold=True, anchor="end", fill=pin_col)
            # geometry
            d = r["dev"]
            dvy, _ = dev_geom[d]
            ey = dvy + HDRH + entry_used[d] * estep + estep / 2
            entry_used[d] += 1
            xm = elbow_x0 + lane_of[d] % 16 * lane_step
            wire_col = GRAY if r.get("ref") else INK
            s.poly([(src_right, wy), (xm, wy), (xm, ey), (DEV_X, ey)],
                   stroke=wire_col, sw=1.3)
            s.circle(src_right, wy, 2.4, fill=INK, stroke=INK, sw=0.5)
            # entry label inside device
            ename = r.get("ename", r["label"].split(" — ")[0])
            s.text(DEV_X + 14, ey + 4, f'{r["wid"] or ""} {ename}'.strip(), 10.5,
                   fill=GRAY if r.get("ref") else INK)
            # id box
            wid = r["wid"]
            if wid:
                bw = 14 + 7.4 * len(wid)
                s.rect(src_right + 18, wy - 10, bw, 20, fill="#FFFFFF", sw=1.2,
                       stroke=ORANGE if r.get("pin_orange") and False else INK)
                s.text(src_right + 18 + bw / 2, wy + 4, wid, 11, bold=True, anchor="middle")
                lx0 = src_right + 18 + bw + 10
            else:
                lx0 = src_right + 18
            # run label + note
            spec = r.get("spec", "")
            if spec:
                s.text(lx0, wy - 6, spec, 10.5)
            if r.get("note"):
                s.text(lx0, wy + 15, r["note"], 9.5,
                       fill=ORANGE if r.get("note_orange") else GRAY)
            if r.get("fuse"):
                fuse_symbol(s, lx0 + 320, wy, r["fuse"])
            # grommets
            if grommets:
                for gx, _glabel, key in grommets:
                    if r.get(key):
                        s.circle(gx, wy, 8, fill="#FFFFFF", stroke=GREEN, sw=2.2)
        ry += sh + 10

    # grommet column labels
    if grommets:
        for gx, glabel, _key in grommets:
            s.text(gx, y0 - 12, glabel, 10, bold=True, fill=GREEN, anchor="middle")
    if extra_texts:
        for ex, ey, etxt, esz, ecol in extra_texts:
            s.text(ex, ey, etxt, esz, fill=ecol, anchor="middle", bold=True)

    # footer
    fy = max(ry, dy) + 4
    fy = min(fy, H - 240)
    if footer_notes:
        s.text(SRC_X, fy + 14, "NOTES:", 11, bold=True)
        for i, (txt, col) in enumerate(footer_notes):
            s.text(SRC_X + 10, fy + 32 + i * 16, txt, 10, fill=col)
        fy += 32 + len(footer_notes) * 16
    legend(s, SRC_X, H - 70)
    title_block(s, sheet_no, title)
    write(fname, s)


def write(fname, sheet):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, fname)
    with open(path, "w") as f:
        f.write(sheet.svg())
    print("wrote", os.path.normpath(path))
    return path


# ============================================================================
# PAGE 1 — DASH & CONTROLS
# ============================================================================

def page1():
    sections = [
        {"title": "PDM30 — OUTPUTS (DASH)", "rows": [
            dict(pin="OUT20", wid="#31", spec="ORN/BLK · 22 AWG · 3.5ft", dev="RADIO",
                 label="Radio/Head Unit", ename="RADIO/HEAD UNIT FEED"),
            dict(pin="OUT23", wid="#58", spec="ORN/YEL · 22 AWG · 3.5ft", dev="TCU",
                 label="TCU power", ename="TCU POWER (3A)"),
            dict(pin="OUT29", wid="#65", spec="ORN/RED · 22 AWG · 3.5ft", dev="C125",
                 label="Display/Dash", ename="C125 POWER"),
            dict(pin="OUT29 SPL", wid="#124", spec="ORN/RED · 22 AWG · 3.0ft", dev="DAKOTA",
                 label="Dakota +12V backup", ename="SW +12V BACKUP",
                 note="COLOR COLLISION w/ #117 in Dakota loom — reassign at mockup; verify vs internal jumper",
                 note_orange=True),
            dict(pin="CH TBD", pin_orange=True, wid="#71", spec="ORN/VIO · 22 AWG · 3.5ft",
                 dev="DAKOTA", label="Dakota cluster", ename="CLUSTER MAIN +12V",
                 note="PDM30 channel UNSPECIFIED in cut list — IGN rail tap per power budget",
                 note_orange=True),
            dict(pin="OUT30", wid="#70", spec="ORN/YEL · 22 AWG · 3.5ft", dev="ACC",
                 label="USB port", ename="USB CHARGING PORT"),
            dict(pin="OUT8", wid="#72", spec="ORN/ORG · 14 AWG · 3.5ft", dev="ACC",
                 label="12V outlet", ename="CIG LIGHTER / 12V OUTLET"),
            dict(pin="OUT6", wid="#51", spec="ORN/BLK/BLU · 10 AWG · 4.6ft", dev="BLOWER",
                 label="Blower", ename="BLOWER MOTOR FEED (12A)"),
        ]},
        {"title": "M130 ECU — DASH SIGNALS", "rows": [
            dict(pin="A31 OUT_HB3", wid="#116", spec="WHT/BLK · 22 AWG · 8.0ft", dev="DAKOTA",
                 label="Tach", ename="TACH SIGNAL", note="spare half-bridge — needs M1 GPR config at tune"),
            dict(pin="A32 OUT_HB4", wid="#118", spec="WHT/YEL · 22 AWG · 11.5ft", dev="DAKOTA",
                 label="VSS", ename="VSS / SPEEDO MIRROR", note="spare half-bridge — needs M1 GPR config at tune"),
            dict(pin="B17/B18", wid="#62", spec="WHT/GRN · 24 AWG TW PAIR · 3.5ft", dev="CANBUS",
                 label="CAN", ename="CAN-H / CAN-L TRUNK"),
            dict(pin="SPLICE #62", wid="#125", spec="WHT/GRN · 22 AWG TW PAIR · 2.0ft", dev="TCU",
                 label="T43 CAN stub", ename="CAN STUB (H+L)",
                 note="stub is 22 AWG off a 24 AWG trunk — accepted, flagged in v4 receipt",
                 note_orange=True),
        ]},
        {"title": "M130 INPUTS — PIN TBD", "orange": True, "rows": [
            dict(pin="PIN TBD", pin_orange=True, wid="#33", spec="ORN/BLU · 22 AWG · 3.5ft",
                 dev="COLUMN", label="Turn sw", ename="TURN SIGNAL SWITCH"),
            dict(pin="PIN TBD", pin_orange=True, wid="#40", spec="ORN · 22 AWG · 3.5ft",
                 dev="COLUMN", label="Ign sw", ename="IGNITION SWITCH"),
            dict(pin="PIN TBD", pin_orange=True, wid="#41", spec="ORN/WHT · 22 AWG · 3.5ft",
                 dev="COLUMN", label="Hazard", ename="HAZARD FLASHER"),
            dict(pin="PIN TBD", pin_orange=True, wid="#39", spec="ORN/ORG · 22 AWG · 3.5ft",
                 dev="DASHSW", label="HL sw", ename="HEADLIGHT SWITCH"),
            dict(pin="PIN TBD", pin_orange=True, wid="#46", spec="ORN/VIO · 22 AWG · 3.5ft",
                 dev="DASHSW", label="Wiper sw", ename="WIPER/WASHER SWITCH"),
            dict(pin="PIN TBD", pin_orange=True, wid="#45", spec="ORN/YEL · 22 AWG · 3.5ft",
                 dev="DASHSW", label="Blower sw", ename="BLOWER SPEED SWITCH"),
            dict(pin="PIN TBD", pin_orange=True, wid="#53", spec="ORN/WHT · 22 AWG · 3.5ft",
                 dev="PEDAL", label="Brake sw", ename="BRAKE LIGHT SWITCH",
                 note="#122 Dakota brake-indicator taps this circuit dash-side"),
        ]},
        {"title": "SENDERS / TAPS (DAKOTA VHX)", "rows": [
            dict(pin="GM CTS SNDR", wid="#114", spec="BRN/WHT · 22 AWG · 8.0ft", dev="DAKOTA",
                 label="CTS", ename="WATER TEMP (factory sndr)",
                 note="factory sender, driver head boss — sender PN UNKNOWN", note_orange=True),
            dict(pin="GM OPS SNDR", wid="#115", spec="VIO/WHT · 22 AWG · 8.0ft", dev="DAKOTA",
                 label="OPS", ename="OIL PRESS (0-90 PSI sndr)",
                 note="factory sender, galley boss — sender PN UNKNOWN", note_orange=True),
            dict(pin="GM FUEL SNDR", wid="#117", spec="ORN/RED · 22 AWG · 18.4ft", dev="DAKOTA",
                 label="Fuel", ename="FUEL LEVEL (tank tap)",
                 note="parallel tap with #98 ECU wire — see SHEET 6"),
            dict(pin="TAP #80", wid="#119", spec="LT BLU · 22 AWG · 1.5ft", dev="DAKOTA",
                 label="Turn L", ename="TURN L INDICATOR"),
            dict(pin="TAP #82", wid="#120", spec="DK BLU · 22 AWG · 1.5ft", dev="DAKOTA",
                 label="Turn R", ename="TURN R INDICATOR"),
            dict(pin="TAP #85b", wid="#121", spec="LT GRN/BLK · 22 AWG · 2.0ft", dev="DAKOTA",
                 label="High beam", ename="HIGH BEAM INDICATOR",
                 note="tap at floor dimmer HI-OUT — see SHEET 2"),
            dict(pin="TAP #53", wid="#122", spec="ORN/WHT · 22 AWG · 1.5ft", dev="DAKOTA",
                 label="Brake ind", ename="BRAKE INDICATOR"),
            dict(pin="DASH STAR GND", wid="#123", spec="BLK · 22 AWG · 3.0ft", dev="DAKOTA",
                 label="Ground", ename="CLUSTER GROUND"),
            dict(pin="DASH BUTTON", wid="#126", spec="ORN/WHT · 22 AWG · 10.0ft", dev="ESTOPBTN",
                 label="E-Stopp trigger", ename="TRIGGER OUT → REAR",
                 note="latching illuminated button — PN TBD (Carling-style); runs to E-Stopp ctrl, SHEET 6",
                 note_orange=True),
        ]},
    ]
    devices = {
        "RADIO": dict(name="RADIO / HEAD UNIT", lines=[("RCA pre-out + remote → AMP (SHEET 4)", GRAY)]),
        "TCU": dict(name="HOLLEY 558-499 T43 TCU (6L80E)",
                    lines=[("16-pin Kostal LKS 1.5 / Holley 19303772 — module in cab", INK)]),
        "C125": dict(name="MoTeC C125 DISPLAY", lines=[("data via CAN trunk #62", GRAY)]),
        "DAKOTA": dict(name="DAKOTA DIGITAL VHX CLUSTER",
                       lines=[("dual-sender config per 2026-05-14 addendum; CAN via SGI-100BT (no cut-list wire — GAP)", ORANGE)]),
        "ACC": dict(name="ACCESSORY 12V"),
        "BLOWER": dict(name="HEATER BLOWER MOTOR", lines=[("motor on firewall, switch #45 in dash", GRAY)]),
        "CANBUS": dict(name="CAN BACKBONE",
                       lines=[("M130 B17/B18 ↔ PDM30 B25/B26 + C125 + SGI-100BT — 120 ohm each end", INK)]),
        "COLUMN": dict(name="STEERING COLUMN SWITCHES"),
        "DASHSW": dict(name="DASH SWITCHES"),
        "PEDAL": dict(name="BRAKE PEDAL SWITCH"),
        "ESTOPBTN": dict(name="E-STOPP DASH BUTTON", orange=True),
    }
    dev_order = ["RADIO", "TCU", "C125", "DAKOTA", "ACC", "BLOWER", "CANBUS",
                 "COLUMN", "DASHSW", "PEDAL", "ESTOPBTN"]
    footer = [
        ("All M130 'PIN TBD' rows: cut list v4 gives FROM=ECU with no pin — switch/digital input pin map is an open item (pinout sheet 1 note).", ORANGE),
        ("Engine-loom circuits (coils, injectors, engine sensors) are on existing S2 pages — K5_S2_P1/P2/P3.", GRAY),
    ]
    rows_page("K5_SCH_P1_dash_controls.svg", 1,
              "SECTION 3 — DASH & CONTROLS",
              "PDM30 + M130 → COLUMN / DASH SWITCHES / DAKOTA VHX / C125 / RADIO / TCU / E-STOPP BUTTON",
              sections, devices, dev_order, footer_notes=footer)


# ============================================================================
# PAGE 2 — EXTERIOR LIGHTING
# ============================================================================

def page2():
    sections = [
        {"title": "PDM30 — LIGHTING OUTPUTS", "rows": [
            dict(pin="OUT17", wid="#85", spec="LT GRN · 20 AWG · 4.6ft", dev="DIMMER",
                 label="HL L feed", ename="COMMON FEED L (3.6A)",
                 note="terminates at dimmer COMMON, not the lamp — 2026-05-14 high-beam decision"),
            dict(pin="OUT18", wid="#86", spec="LT GRN/WHT · 20 AWG · 4.6ft", dev="DIMMER",
                 label="HL R feed", ename="COMMON FEED R (3.6A)"),
            dict(pin="OUT27", wid="#80", spec="LT BLU · 22 AWG · 4.6ft", dev="TURNL",
                 label="Turn LF", ename="TURN SIGNAL LF", grom=True,
                 note="#119 Dakota indicator splices dash-side (SHEET 1)"),
            dict(pin="OUT28", wid="#82", spec="DK BLU · 22 AWG · 4.6ft", dev="TURNR",
                 label="Turn RF", ename="TURN SIGNAL RF", grom=True,
                 note="#120 Dakota indicator splices dash-side (SHEET 1)"),
            dict(pin="OUT13", wid="#83", spec="BRN/RED · 22 AWG · 4.6ft", dev="PARK",
                 label="Park LF", ename="PARKING LIGHT LF", grom=True),
            dict(pin="OUT13", wid="#84", spec="BRN/BLU · 22 AWG · 4.6ft", dev="PARK",
                 label="Park RF", ename="PARKING LIGHT RF", grom=True),
            dict(pin="OUT19", wid="#87", spec="BRN/YEL · 22 AWG · 4.6ft", dev="MARKF",
                 label="Marker FL", ename="SIDE MARKER FRONT L", grom=True),
            dict(pin="OUT19", wid="#88", spec="BRN/VIO · 22 AWG · 4.6ft", dev="MARKF",
                 label="Marker FR", ename="SIDE MARKER FRONT R", grom=True),
            dict(pin="OUT19", wid="#79", spec="BRN/WHT · 22 AWG · 3.5ft", dev="CLEAR",
                 label="Clearance L", ename="CAB CLEARANCE L"),
            dict(pin="OUT19", wid="#90", spec="BRN · 22 AWG · 3.5ft", dev="CLEAR",
                 label="Clearance C", ename="CAB CLEARANCE CENTER"),
            dict(pin="OUT19", wid="#91", spec="BRN/WHT · 22 AWG · 3.5ft", dev="CLEAR",
                 label="Clearance R", ename="CAB CLEARANCE R"),
            dict(pin="OUT13", wid="#75 #81", spec="tails — BRN/YEL + BRN/BLK · 22 AWG · 18.4ft",
                 dev="REARREF", label="Tails", ename="TAIL LIGHTS L+R", ref=True),
            dict(pin="OUT15", wid="#76 #89 #93", spec="backup L/R + 3rd brake · 22 AWG · 18.4ft",
                 dev="REARREF", label="Backup", ename="BACKUP L/R + 3RD BRAKE", ref=True),
            dict(pin="OUT19", wid="#77 #78 #92", spec="rear markers + plate · 22 AWG · 18.4ft",
                 dev="REARREF", label="Rear markers", ename="MARKERS RL/RR + PLATE", ref=True),
        ]},
        {"title": "FLOOR DIMMER — SPDT OUTPUTS", "rows": [
            dict(pin="LO-OUT", wid="#85a", spec="LT GRN · 16 AWG · 4.0ft", dev="HLL",
                 label="L low", ename="LOW BEAM PIN", grom=True),
            dict(pin="HI-OUT", wid="#85b", spec="LT GRN/BLK · 16 AWG · 4.0ft", dev="HLL",
                 label="L high", ename="HIGH BEAM PIN", grom=True,
                 note="#121 Dakota high-beam indicator taps at dimmer HI-OUT"),
            dict(pin="LO-OUT", wid="#86a", spec="LT GRN/WHT · 16 AWG · 4.0ft", dev="HLR",
                 label="R low", ename="LOW BEAM PIN", grom=True),
            dict(pin="HI-OUT", wid="#86b", spec="LT GRN/WHT/BLK · 16 AWG · 4.0ft", dev="HLR",
                 label="R high", ename="HIGH BEAM PIN", grom=True,
                 note="3-stripe code remaps to 2-color at purchase — locked decision 2026-05-11",
                 note_orange=True),
        ]},
        {"title": "M130 INPUTS — PIN TBD", "orange": True, "rows": [
            dict(pin="PIN TBD", pin_orange=True, wid="#33", spec="ORN/BLU · 22 AWG (logic input)",
                 dev="COLREF", label="Turn sw", ename="TURN SIGNAL SWITCH", ref=True),
            dict(pin="PIN TBD", pin_orange=True, wid="#41", spec="ORN/WHT · 22 AWG (logic input)",
                 dev="COLREF", label="Hazard", ename="HAZARD FLASHER", ref=True),
        ]},
    ]
    devices = {
        "DIMMER": dict(name="FLOOR DIMMER SWITCH (SPDT)",
                       lines=[("COMMON fed by OUT17/OUT18 paralleled; LO/HI legs below", INK),
                              ("dimmer position UNMEASURED — L19 is nearest landmark (estimate)", ORANGE),
                              ("dimmer switch itself has NO cut-list wire id — gap (subsystems.json)", ORANGE)]),
        "TURNL": dict(name="TURN SIGNAL LF"),
        "TURNR": dict(name="TURN SIGNAL RF"),
        "PARK": dict(name="PARKING LIGHTS FRONT"),
        "MARKF": dict(name="SIDE MARKERS FRONT"),
        "CLEAR": dict(name="CAB CLEARANCE LIGHTS (ROOF)"),
        "REARREF": dict(name="REAR FIXTURES — SEE SHEET 6",
                        lines=[("runs continue via FLOOR-RR grommet + frame rail (rear loom)", GRAY)]),
        "HLL": dict(name="LED HEADLIGHT LEFT",
                    lines=[("Truck-Lite 27270C — dual-input LOW/HIGH pins", INK)]),
        "HLR": dict(name="LED HEADLIGHT RIGHT",
                    lines=[("Truck-Lite 27270C — dual-input LOW/HIGH pins", INK)]),
        "COLREF": dict(name="COLUMN SWITCHES — SEE SHEET 1"),
    }
    dev_order = ["DIMMER", "TURNL", "TURNR", "PARK", "MARKF", "CLEAR", "REARREF",
                 "HLL", "HLR", "COLREF"]
    footer = [
        ("HIGH-BEAM TOPOLOGY: OUT17/18 → #85/#86 → dimmer COMMON → SPDT LO/HI → #85a/b #86a/b → lamp LOW/HIGH pins (receipt 2026-05-14_decision-high-beam-floor-dimmer.md).", INK),
        ("Label drift: wire_paths.yaml swaps front/rear marker naming on #77/#78/#87/#88/#90-92 — CUT LIST v4 names shown (canonical per wire-closure protocol).", ORANGE),
        ("Marker/clearance group OUT19 = 8 fixtures, 1.25-1.3A total. Tail/park group OUT13. Backup group OUT15 (shared w/ camera).", GRAY),
    ]
    rows_page("K5_SCH_P2_exterior_lighting.svg", 2,
              "SECTION 4 — EXTERIOR LIGHTING",
              "PDM30 OUT13/15/17/18/19/27/28 → FRONT FIXTURES + FLOOR-DIMMER HIGH-BEAM TOPOLOGY (REAR FIXTURES ON SHEET 6)",
              sections, devices, dev_order, footer_notes=footer,
              grommets=[(1060, "FWG-MAIN", "grom")])


# ============================================================================
# PAGE 3 — DOORS & INTERIOR
# ============================================================================

def page3():
    sections = [
        {"title": "PDM30 — DOOR / INTERIOR", "rows": [
            dict(pin="OUT3", wid="#34", spec="DK BLU · 16 AWG · 6.9ft (15A)", dev="DOORL",
                 label="Window L", ename="WINDOW MOTOR", grom=True),
            dict(pin="OUT21", wid="#38", spec="BLK · 20 AWG · 6.9ft", dev="DOORL",
                 label="Lock L", ename="LOCK ACTUATOR", grom=True),
            dict(pin="OUT4", wid="#35", spec="DK BLU/WHT · 16 AWG · 6.9ft (15A)", dev="DOORR",
                 label="Window R", ename="WINDOW MOTOR", grom=True),
            dict(pin="OUT22", wid="#47", spec="BLK/WHT · 20 AWG · 6.9ft", dev="DOORR",
                 label="Lock R", ename="LOCK ACTUATOR", grom=True),
            dict(pin="OUT25", wid="#67", spec="BRN · 22 AWG · 3.5ft", dev="COURTESY",
                 label="Dome", ename="DOME LIGHT"),
            dict(pin="OUT25", wid="#68", spec="BRN/WHT · 22 AWG · 3.5ft", dev="COURTESY",
                 label="Under-dash", ename="UNDER-DASH LED"),
            dict(pin="OUT25", wid="#69", spec="BRN/BLK · 22 AWG · 3.5ft", dev="COURTESY",
                 label="Footwell", ename="FOOTWELL LIGHTS"),
            dict(pin="OUT25", wid="#73", spec="BRN/RED · 22 AWG · 4.6ft", dev="COURTESY",
                 label="Underhood", ename="UNDERHOOD LIGHT (→ bay)", ref=True),
            dict(pin="OUT25", wid="#74", spec="BRN/BLU · 22 AWG · 18.4ft", dev="COURTESY",
                 label="Cargo", ename="CARGO/BED LIGHT (SHEET 6)", ref=True),
        ]},
        {"title": "AMPLIFIER — SEE SHEET 4", "rows": [
            dict(pin="AMP CH1+", wid="#26a", spec="ORN/YEL · 18 AWG · 6.9ft", dev="DOORL",
                 label="Spk FL+", ename="SPEAKER (+)", grom=True, ref=True),
            dict(pin="AMP CH1-", wid="#26b", spec="ORN/YEL/BLK · 18 AWG · 6.9ft", dev="DOORL",
                 label="Spk FL-", ename="SPEAKER (-)", grom=True, ref=True),
            dict(pin="AMP CH2+", wid="#27a", spec="ORN/VIO · 18 AWG · 6.9ft", dev="DOORR",
                 label="Spk FR+", ename="SPEAKER (+)", grom=True, ref=True),
            dict(pin="AMP CH2-", wid="#27b", spec="ORN/VIO/BLK · 18 AWG · 6.9ft", dev="DOORR",
                 label="Spk FR-", ename="SPEAKER (-)", grom=True, ref=True),
        ]},
        {"title": "M130 INPUTS — PIN TBD", "orange": True, "rows": [
            dict(pin="PIN TBD", pin_orange=True, wid="#42", spec="ORN/BLK · 22 AWG · 6.9ft",
                 dev="DOORL", label="Ajar L", ename="DOOR AJAR SWITCH", grom=True),
            dict(pin="PIN TBD", pin_orange=True, wid="#43", spec="ORN/RED · 22 AWG · 6.9ft",
                 dev="DOORR", label="Ajar R", ename="DOOR AJAR SWITCH", grom=True),
            dict(pin="PIN TBD", pin_orange=True, wid="#36", spec="ORN/YEL · 22 AWG · 6.9ft",
                 dev="SWPANEL", label="Win sw master", ename="WINDOW SW MASTER (DRV)"),
            dict(pin="PIN TBD", pin_orange=True, wid="#37", spec="ORN/VIO · 22 AWG · 6.9ft",
                 dev="SWPANEL", label="Win sw pass", ename="WINDOW SW PASSENGER"),
            dict(pin="PIN TBD", pin_orange=True, wid="#44", spec="ORN/BLU · 22 AWG · 6.9ft",
                 dev="SWPANEL", label="Lock sw", ename="LOCK SWITCH"),
        ]},
    ]
    devices = {
        "DOORL": dict(name="DRIVER DOOR LOOM", dashed="DOOR SHELL L — JAMB BOOT (+6in flex)",
                      lines=[("window 15A · lock 3A · speaker 6.5x9 · ajar sw → courtesy logic", INK)]),
        "DOORR": dict(name="PASSENGER DOOR LOOM", dashed="DOOR SHELL R — JAMB BOOT (+6in flex)",
                      lines=[("window 15A · lock 3A · speaker 6.5x9 · ajar sw → courtesy logic", INK)]),
        "COURTESY": dict(name="INTERIOR / COURTESY GROUP (OUT25)",
                         lines=[("5 loads share OUT25 (1.9-2.5A) — channel frees only if BOTH",
                                 GRAY),
                                ("DOME_COURTESY and LIGHTING_INTERIOR toggle off (subsystems.json)", GRAY),
                                ("door puddle lights: devices exist, NO cut-list wire ids — gap", ORANGE)]),
        "SWPANEL": dict(name="DOOR CONTROL SWITCH PANEL",
                        lines=[("window/lock switches — dash or console mount TBD", ORANGE)]),
    }
    dev_order = ["DOORL", "DOORR", "COURTESY", "SWPANEL"]
    footer = [
        ("Door crossings (#34 #35 #38 #47 #26x #27x #42 #43) carry door_crossing flag: +6in boot flex allowance (wire_paths.yaml).", INK),
        ("Door jamb boots required by POWER_WINDOWS / POWER_LOCKS / AUDIO front / DOME_COURTESY — HARNESS_INFRA dependency rule.", GRAY),
    ]
    rows_page("K5_SCH_P3_doors_interior.svg", 3,
              "SECTION 5 — DOORS & INTERIOR",
              "PDM30 OUT3/4/21/22/25 + AMP CH1/CH2 + M130 INPUTS → DOOR LOOMS (BOOTS) + DOME/COURTESY",
              sections, devices, dev_order, footer_notes=footer,
              grommets=[(1060, "DOOR BOOTS", "grom")])


# ============================================================================
# PAGE 4 — AUDIO
# ============================================================================

def page4():
    sections = [
        {"title": "BATTERY — DIRECT FEED", "rows": [
            dict(pin="BAT+ STUD", wid="#32", spec="ORN/RED · 8 AWG · 18.4ft", dev="AMP",
                 label="Amp feed", ename="B+ FEED (30A)", fuse="30A",
                 note="direct fused battery feed — NOT a PDM channel (power budget direct-wire table)"),
        ]},
        {"title": "PDM30", "rows": [
            dict(pin="OUT20", wid="#31", spec="ORN/BLK · 22 AWG · 3.5ft", dev="HEADUNIT",
                 label="Head unit", ename="SWITCHED +12V (3A)"),
        ]},
        {"title": "M130 ECU — PIN TBD", "orange": True, "rows": [
            dict(pin="PIN TBD", pin_orange=True, wid="#96", spec="ORN/BLK · 22 AWG · 18.4ft",
                 dev="AMPRELAY", label="Amp relay", ename="RELAY COIL TRIGGER"),
        ]},
        {"title": "AMPLIFIER — SPEAKER OUTPUTS", "rows": [
            dict(pin="CH1+", wid="#26a", spec="ORN/YEL · 18 AWG · 6.9ft", dev="SPKFL",
                 label="FL+", ename="(+)", grom=True),
            dict(pin="CH1-", wid="#26b", spec="ORN/YEL/BLK · 18 AWG · 6.9ft", dev="SPKFL",
                 label="FL-", ename="(-)", grom=True),
            dict(pin="CH2+", wid="#27a", spec="ORN/VIO · 18 AWG · 6.9ft", dev="SPKFR",
                 label="FR+", ename="(+)", grom=True),
            dict(pin="CH2-", wid="#27b", spec="ORN/VIO/BLK · 18 AWG · 6.9ft", dev="SPKFR",
                 label="FR-", ename="(-)", grom=True),
            dict(pin="CH3+", wid="#28a", spec="ORN/ORG · 16 AWG · 18.4ft", dev="SPKRL",
                 label="RL+", ename="(+)"),
            dict(pin="CH3-", wid="#28b", spec="ORN/ORG/BLK · 16 AWG · 18.4ft", dev="SPKRL",
                 label="RL-", ename="(-)"),
            dict(pin="CH4+", wid="#29a", spec="ORN · 16 AWG · 18.4ft", dev="SPKRR",
                 label="RR+", ename="(+)"),
            dict(pin="CH4-", wid="#29b", spec="ORN/BLK · 16 AWG · 18.4ft", dev="SPKRR",
                 label="RR-", ename="(-)"),
            dict(pin="SUB+", wid="#30a", spec="ORN/WHT · 10 AWG · 18.4ft", dev="SUB",
                 label="Sub+", ename="(+)"),
            dict(pin="SUB-", wid="#30b", spec="ORN/WHT/BLK · 10 AWG · 18.4ft", dev="SUB",
                 label="Sub-", ename="(-)"),
        ]},
    ]
    devices = {
        "AMP": dict(name="AMPLIFIER (REAR-MOUNT)",
                    lines=[("remote-in ← amp relay; signal ← head unit RCA", INK),
                           ("EE-audit: REAR-SUB-POS/NEG 14 AWG < 15A required — FAIL, upsize", ORANGE)]),
        "HEADUNIT": dict(name="RADIO / HEAD UNIT",
                         lines=[("RCA pre-out + remote turn-on → amp relay coil path", GRAY),
                                ("camera #97 video lands here or on C125 (cross_dependency)", GRAY)]),
        "AMPRELAY": dict(name="AMPLIFIER RELAY",
                         lines=[("output = amp remote turn-on; coil trigger #96 FROM=ECU, pin TBD", ORANGE)]),
        "SPKFL": dict(name="SPEAKER FRONT LEFT (DOOR)", dashed="DRIVER DOOR — BOOT"),
        "SPKFR": dict(name="SPEAKER FRONT RIGHT (DOOR)", dashed="PASSENGER DOOR — BOOT"),
        "SPKRL": dict(name="SPEAKER REAR LEFT"),
        "SPKRR": dict(name="SPEAKER REAR RIGHT"),
        "SUB": dict(name="SUBWOOFER (REAR)"),
    }
    dev_order = ["AMP", "HEADUNIT", "AMPRELAY", "SPKFL", "SPKFR", "SPKRL", "SPKRR", "SUB"]
    footer = [
        ("Amp feed #32 + rear speaker/sub runs share the FLOOR-RR + frame-rail trunk with the rear loom (SHEET 6).", GRAY),
        ("Speaker wires carry no battery amps — amp 30A + head unit 3A are the only supply loads (subsystems.json AUDIO).", GRAY),
    ]
    rows_page("K5_SCH_P4_audio.svg", 4,
              "SECTION 6 — AUDIO",
              "BATTERY (FUSED) + OUT20 + AMP CHANNELS → HEAD UNIT / AMP / 4 SPEAKERS / SUB",
              sections, devices, dev_order, footer_notes=footer,
              grommets=[(1060, "DOOR BOOTS", "grom")])


# ============================================================================
# PAGE 5 — CHASSIS / POWER
# ============================================================================

def page5():
    sections = [
        {"title": "BATTERY — SIDE TBD", "orange": True, "rows": [
            dict(pin="BAT+", wid="#63", spec="ORN/WHT · 0 AWG · 4.6ft (190A)", dev="DISC",
                 label="Disconnect", ename="MASTER DISCONNECT IN"),
        ]},
        {"title": "BATTERY DISCONNECT — LOAD SIDE", "rows": [
            dict(pin="LOAD", wid="#6", spec="ORN · 0 AWG · 4.6ft (200A peak)", dev="STARTER",
                 label="Starter", ename="STARTER STUD"),
            dict(pin="LOAD", wid="#59", spec="ORN/VIO · 0 AWG · 4.6ft", dev="ALT",
                 label="Alternator", ename="ALTERNATOR B+ (source)",
                 note="capacity inconsistent across docs: 250A / 220A / 150A — RECONCILE",
                 note_orange=True),
            dict(pin="LOAD", wid="BAT+", spec="PDM30 supply — EE-audit: 2 AWG rated 73.5A < 150A reqd",
                 dev="PDMFEED", label="PDM feed", ename="PDM30 BAT+ / BAT-",
                 note="104% over ampacity — upsize feed pair before power-on", note_orange=True),
            dict(pin="LOAD", wid="#60", spec="ORN/ORG · 22 AWG · 4.6ft", dev="ECUFEED",
                 label="ECU pwr", ename="M130 POWER"),
            dict(pin="LOAD", wid="#52", spec="ORN · 8 AWG · 4.6ft (40A peak)", dev="IBOOST",
                 label="iBooster", ename="B+ FEED via relay"),
            dict(pin="LOAD", wid="#32", spec="ORN/RED · 8 AWG · 18.4ft (30A fused)", dev="AMPREF",
                 label="Amp", ename="AMPLIFIER — SHEET 4", ref=True),
            dict(pin="LOAD", wid="#66", spec="ORN/BLU · 8 AWG · 18.4ft (35A)", dev="FUELPUMP",
                 label="Fuel pump", ename="PUMP FEED via relay"),
        ]},
        {"title": "PDM30 — CHASSIS OUTPUTS", "rows": [
            dict(pin="CH TBD", pin_orange=True, wid="#94", spec="ORN · 22 AWG · 4.6ft", dev="FPRELAY",
                 label="FP relay", ename="RELAY COIL (Aeromotive 16301)",
                 note="PDM30 channel UNSPECIFIED in cut list v4", note_orange=True),
            dict(pin="CH TBD", pin_orange=True, wid="#95", spec="ORN/WHT · 22 AWG · 2.3ft", dev="IBRELAY",
                 label="iB relay", ename="RELAY COIL",
                 note="PDM30 channel UNSPECIFIED in cut list v4", note_orange=True),
            dict(pin="CH TBD", pin_orange=True, wid="#55", spec="ORN/BLK · 22 AWG · 11.5ft", dev="TRANSSW",
                 label="T-case ind", ename="TRANSFER CASE INDICATOR", grom=True),
            dict(pin="CH TBD", pin_orange=True, wid="#56", spec="ORN/RED · 22 AWG · 11.5ft", dev="TRANSSW",
                 label="NSS", ename="NEUTRAL SAFETY SWITCH", grom=True),
            dict(pin="CH TBD", pin_orange=True, wid="#57", spec="ORN/BLU · 22 AWG · 11.5ft", dev="TRANSSW",
                 label="Reverse sw", ename="REVERSE LIGHT SWITCH", grom=True,
                 note="feeds backup lights (OUT15 logic) + camera trigger"),
            dict(pin="OUT1", wid="#21", spec="ORN/WHT · 12 AWG · 4.6ft (18A)", dev="COOLING",
                 label="Fan 1", ename="RADIATOR FAN 1"),
            dict(pin="OUT2", wid="#22", spec="ORN/BLK · 12 AWG · 4.6ft (18A)", dev="COOLING",
                 label="Fan 2", ename="RADIATOR FAN 2"),
            dict(pin="OUT5", wid="#25", spec="ORN/BLU · 14 AWG · 4.6ft (12A)", dev="COOLING",
                 label="Water pump", ename="ELECTRIC WATER PUMP"),
            dict(pin="OUT9", wid="#1", spec="ORN/BLK · 18 AWG · 11.5ft (8A)", dev="STEPS",
                 label="Step L", ename="AMP RESEARCH STEP L"),
            dict(pin="OUT10", wid="#2", spec="ORN/BLK/WHT · 18 AWG · 11.5ft (8A)", dev="STEPS",
                 label="Step R", ename="AMP RESEARCH STEP R"),
            dict(pin="OUT11", wid="#3", spec="ORN/BLK/BLK · 22 AWG · 11.5ft (2A)", dev="STEPS",
                 label="Step ctrl", ename="AMP RESEARCH CONTROLLER"),
        ]},
        {"title": "GROUND SYSTEM — STAR (BAT NEG)", "rows": [
            dict(pin="STAR_BAT_CHASSIS", wid=None, spec="4 AWG min — within 12in of battery (frame rail boss)",
                 dev="GFRAME", label="bat→chassis", ename="STAR_BAT_CHASSIS leg"),
            dict(pin="STAR_BAT_ENG", wid=None, spec="4 AWG min — rear head bolt / bellhousing lug",
                 dev="GENGINE", label="bat→engine", ename="STAR_BAT_ENG leg"),
            dict(pin="STAR_ENG_FRAME", wid=None, spec="4 AWG min — separate cable from battery run",
                 dev="GFRAME", label="eng→frame", ename="STAR_ENG_FRAME leg"),
            dict(pin="STAR_ECM_HEAD", wid=None, spec="12 AWG — dedicated ECM gnd, own head bolt",
                 dev="GENGINE", label="ECM gnd", ename="STAR_ECM_HEAD leg",
                 note="do NOT share with chassis/battery grounds (GM LS service manual)"),
            dict(pin="G3 CAB STRAP", wid=None, spec="8 AWG welding cable — PS head → firewall stud",
                 dev="GCAB", label="cab strap", ename="G3 — ALL cab electrical",
                 note="CRITICAL: the one strap that makes the cab live; welded tab, not screw"),
            dict(pin="G4", wid=None, spec="8 AWG — cab sheetmetal → frame strap",
                 dev="GCAB", label="cab bond", ename="G4 — cab-to-frame bond"),
            dict(pin="G5", wid=None, spec="10 AWG — driver kick panel body mount",
                 dev="GCAB", label="interior", ename="G5 — interior/HVAC loads"),
            dict(pin="G6", wid=None, spec="10 AWG — radiator core support tab (6 AWG to chassis)",
                 dev="GFRONT", label="front lights", ename="G6 — headlights/park/horn"),
            dict(pin="G8", wid=None, spec="14 AWG high-flex — tailgate hinge crossing",
                 dev="GREAR", label="tailgate", ename="G8 — gate lamps/window motor"),
            dict(pin="COIL_GND", wid="#COIL_GND", spec="BLK · 16 AWG · 3.0ft — engine block star",
                 dev="GENGINE", label="coil gnd rail", ename="COIL GND RAIL (8x D510C)"),
        ]},
    ]
    devices = {
        "DISC": dict(name="BATTERY DISCONNECT (190A)",
                     lines=[("battery POSITION: SIDE TBD — not yet decided", ORANGE)]),
        "STARTER": dict(name="STARTER MOTOR"),
        "ALT": dict(name="ALTERNATOR", orange=True,
                    lines=[("250A (harness spec) vs 220A (channel plan) vs 150A Powermaster 47294", ORANGE),
                           ("power budget continuous 299A → headroom NEGATIVE -49A on 250A unit", ORANGE)]),
        "PDMFEED": dict(name="PDM30 BAT+ / BAT- FEED", orange=True),
        "ECUFEED": dict(name="M130 ECU POWER"),
        "IBOOST": dict(name="BOSCH iBOOSTER (BRAKE)",
                       lines=[("dedicated relay (coil #95) — 40A peak", INK)]),
        "AMPREF": dict(name="AMPLIFIER — SEE SHEET 4"),
        "FUELPUMP": dict(name="FUEL PUMP (TANK, REAR)",
                         lines=[("switched by Aeromotive 16301 relay (coil #94) — run continues SHEET 6", GRAY)]),
        "FPRELAY": dict(name="FUEL PUMP RELAY"),
        "IBRELAY": dict(name="iBOOSTER RELAY"),
        "TRANSSW": dict(name="6L80E / T-CASE SWITCHES",
                        lines=[("through tunnel grommet (L28)", GREEN)]),
        "COOLING": dict(name="COOLING (FANS + EWP)"),
        "STEPS": dict(name="AMP RESEARCH POWER STEPS"),
        "GFRAME": dict(name="FRAME / CHASSIS RAIL", gnd=True),
        "GENGINE": dict(name="ENGINE BLOCK (LS3)", gnd=True),
        "GCAB": dict(name="CAB (RUBBER-ISOLATED)", gnd=True),
        "GFRONT": dict(name="CORE SUPPORT", gnd=True),
        "GREAR": dict(name="TAILGATE", gnd=True),
    }
    dev_order = ["DISC", "STARTER", "ALT", "PDMFEED", "ECUFEED", "IBOOST", "AMPREF",
                 "FUELPUMP", "FPRELAY", "IBRELAY", "TRANSSW", "COOLING", "STEPS",
                 "GFRAME", "GENGINE", "GCAB", "GFRONT", "GREAR"]
    footer = [
        ("Ground star topology + gauges from objectTraits.ts ground_points (G3-G8 factory points, STAR_* LS-swap legs).", INK),
        ("Unspecified PDM channels (#94 #95 #55 #56 #57, INJ_PWR, COIL_PWR, #71) — but authoritative plan uses 30/30 channels: assignment requires regrouping. OPEN.", ORANGE),
    ]
    rows_page("K5_SCH_P5_chassis_power.svg", 5,
              "SECTION 7 — CHASSIS / POWER & GROUNDS",
              "BATTERY (SIDE TBD) → DISCONNECT → STARTER / ALTERNATOR / PDM30 / ECU + STAR GROUND SYSTEM + FUEL / iBOOSTER / TRANS",
              sections, devices, dev_order, footer_notes=footer,
              grommets=[(1060, "TUNNEL (L28)", "grom")])


# ============================================================================
# PAGE 6 — REAR LOOM
# ============================================================================

def page6():
    g = dict(grom=True)  # all rear rows pass FLOOR-RR
    sections = [
        {"title": "PDM30 — REAR OUTPUTS", "rows": [
            dict(pin="OUT13", wid="#81", spec="BRN/BLK · 22 AWG · 18.4ft", dev="CLUSTL",
                 label="Tail L", ename="TAIL LIGHT", **g),
            dict(pin="OUT15", wid="#89", spec="BRN/ORG · 22 AWG · 18.4ft", dev="CLUSTL",
                 label="Backup L", ename="BACKUP LIGHT", **g),
            dict(pin="OUT13", wid="#75", spec="BRN/YEL · 22 AWG · 18.4ft", dev="CLUSTR",
                 label="Tail R", ename="TAIL LIGHT", **g),
            dict(pin="OUT15", wid="#76", spec="BRN/VIO · 22 AWG · 18.4ft", dev="CLUSTR",
                 label="Backup R", ename="BACKUP LIGHT", **g),
            dict(pin="OUT19", wid="#77", spec="BRN/ORG · 22 AWG · 18.4ft", dev="MARKR",
                 label="Marker RL", ename="SIDE MARKER REAR L", **g),
            dict(pin="OUT19", wid="#78", spec="BRN · 22 AWG · 18.4ft", dev="MARKR",
                 label="Marker RR", ename="SIDE MARKER REAR R", **g),
            dict(pin="OUT19", wid="#92", spec="BRN/BLK · 22 AWG · 18.4ft", dev="PLATE",
                 label="Plate", ename="LICENSE PLATE LIGHT", **g),
            dict(pin="OUT15", wid="#93", spec="BRN/RED · 22 AWG · 18.4ft", dev="BRAKE3",
                 label="3rd brake", ename="THIRD BRAKE LIGHT", **g),
            dict(pin="OUT15", wid="#97", spec="BLU/WHT · 22 AWG · 18.4ft", dev="CAMERA",
                 label="Camera", ename="CAMERA POWER", **g,
                 note="2026-04-13 spec's M130:B02 camera assignment is STALE — B02 is CMP; power is OUT15 (v4)"),
            dict(pin="OUT25", wid="#74", spec="BRN/BLU · 22 AWG · 18.4ft", dev="CARGO",
                 label="Cargo", ename="CARGO/BED LIGHT", **g),
            dict(pin="OUT7", wid="#54", spec="ORN/BLK/YEL · 16 AWG · 18.4ft (10A)", dev="ESTOPP",
                 label="E-Stopp", ename="CONTROLLER B+ FEED", **g),
        ]},
        {"title": "OTHER SOURCES", "rows": [
            dict(pin="DASH BTN (SHT 1)", wid="#126", spec="ORN/WHT · 22 AWG · 10.0ft", dev="ESTOPP",
                 label="Trigger", ename="DASH BUTTON TRIGGER IN", **g),
            dict(pin="M130 AV TBD", pin_orange=True, wid="#98", spec="ORN/RED · 22 AWG · 18.4ft",
                 dev="SENDER", label="Fuel sender", ename="SENDER SIGNAL → ECU", **g,
                 note="AV pin UNASSIGNED — A25 claim now taken by #102 OPS (v4); needs AV pin decision",
                 note_orange=True),
            dict(pin="DAKOTA (SHT 1)", wid="#117", spec="ORN/RED · 22 AWG · 18.4ft", dev="SENDER",
                 label="Fuel tap", ename="PARALLEL TAP → DAKOTA", ref=True, **g),
            dict(pin="FP RELAY (SHT 5)", wid="#66", spec="ORN/BLU · 8 AWG · 18.4ft (35A)", dev="FUELPUMP",
                 label="Pump", ename="PUMP B+ FEED", **g),
            dict(pin="AMP (SHT 4)", wid="#28x #29x #30x #32",
                 spec="rear speakers + sub + 8 AWG amp feed — same trunk", dev="AUDIOREF",
                 label="Audio", ename="REAR AUDIO RUNS", ref=True, **g),
        ]},
    ]
    devices = {
        "CLUSTL": dict(name="REAR LIGHT CLUSTER LEFT"),
        "CLUSTR": dict(name="REAR LIGHT CLUSTER RIGHT"),
        "MARKR": dict(name="SIDE MARKERS REAR"),
        "PLATE": dict(name="LICENSE PLATE LIGHT"),
        "BRAKE3": dict(name="THIRD BRAKE LIGHT"),
        "CAMERA": dict(name="REAR BACKUP CAMERA",
                       lines=[("video → head unit / C125 (no cut-list wire for video run — gap)", ORANGE)]),
        "CARGO": dict(name="CARGO / BED LIGHT"),
        "ESTOPP": dict(name="E-STOPP ESK001 (CTRL + ACTUATOR)", orange=True,
                       lines=[("actuator + switch legs have NO cut-list wire ids — only #54 feed exists (gap)", ORANGE),
                              ("EE-audit: spec'd 16 AWG ch7/8 legs flagged FAIL in stale plan — verify ESK001 diagram", ORANGE)]),
        "SENDER": dict(name="FUEL LEVEL SENDER (TANK)",
                       lines=[("GM 0-90 ohm sender — dual tap: ECU #98 + Dakota #117", INK)]),
        "FUELPUMP": dict(name="FUEL PUMP (IN-TANK)"),
        "AUDIOREF": dict(name="REAR AUDIO — SEE SHEET 4"),
    }
    dev_order = ["CLUSTL", "CLUSTR", "MARKR", "PLATE", "BRAKE3", "CAMERA", "CARGO",
                 "ESTOPP", "SENDER", "FUELPUMP", "AUDIOREF"]
    footer = [
        ("TRUNK: PDM30 → FLOOR-RR grommet (L24, under driver seat / rocker entry) → DRIVER FRAME RAIL, clipped every 12in → rear junction (L25 split) → L26 tailgate / L27 tank.", INK),
        ("Rear junction is a HARNESS_INFRA item — required by FUEL / AUDIO rear / LIGHTING rear / CAMERA / E-STOPP / AMP_STEPS (subsystems.json).", GRAY),
    ]
    rows_page("K5_SCH_P6_rear_loom.svg", 6,
              "SECTION 8 — REAR LOOM",
              "PDM30 + DASH → FLOOR-RR GROMMET → FRAME-RAIL TRUNK → REAR JUNCTION → TAIL / MARKERS / CAMERA / FUEL / E-STOPP",
              sections, devices, dev_order, footer_notes=footer,
              grommets=[(820, "FLOOR-RR (L24)", "grom")],
              junction=(1150, 160, "REAR JUNCTION", "L25 split — frame rail end"),
              elbow_x0=1340, lane_step=12,
              extra_texts=[(985, 158, "— DRIVER FRAME RAIL TRUNK —", 10, GRAY)])


# ============================================================================
# RENDER + MERGE
# ============================================================================

PAGES = [
    ("K5_SCH_P1_dash_controls.svg", page1),
    ("K5_SCH_P2_exterior_lighting.svg", page2),
    ("K5_SCH_P3_doors_interior.svg", page3),
    ("K5_SCH_P4_audio.svg", page4),
    ("K5_SCH_P5_chassis_power.svg", page5),
    ("K5_SCH_P6_rear_loom.svg", page6),
]


def render():
    pdfs = []
    for fname, _ in PAGES:
        svg = os.path.join(OUT_DIR, fname)
        png = svg.replace(".svg", ".png")
        pdf = svg.replace(".svg", ".pdf")
        subprocess.run(["rsvg-convert", "-w", str(W), "-h", str(H), "-o", png, svg], check=True)
        subprocess.run(["rsvg-convert", "-f", "pdf", "-o", pdf, svg], check=True)
        pdfs.append(pdf)
        print("rendered", os.path.normpath(png))
    combined = os.path.join(OUT_DIR, "K5_system_schematics.pdf")
    subprocess.run(["qpdf", "--empty", "--pages"] + pdfs + ["--", combined], check=True)
    for p in pdfs:
        os.remove(p)
    print("combined", os.path.normpath(combined))


if __name__ == "__main__":
    for _, fn in PAGES:
        fn()
    if "--render" in sys.argv:
        render()
