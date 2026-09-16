#!/usr/bin/env python3
"""
K5 Blazer MoTeC harness — CONNECTOR BUILD SHEETS (face drawing + cut list, one page each).

Stdlib only. Emits four 2200x1700 LANDSCAPE SVG sheets to docs/wiring/output/connector-sheets/:

  SHEET 1  FIREWALL BULKHEAD  — D38999 61-way (insert arrangement 25-61, all #20 contacts)
  SHEET 2  M130 CONNECTOR A   — 34-way Tyco Superseal 1.0 (MoTeC #65044 / TE 4-1437290-0)
  SHEET 3  M130 CONNECTOR B   — 26-way Tyco Superseal 1.0 (MoTeC #65045 / TE 3-1437290-7)
  SHEET 4  PDM30              — Conn A (34) + Conn B (26) + C stud, 30-channel table

DATA PROVENANCE (nothing invented — every value transcribed or derived by documented rule):
  [1] docs/wiring/output/K5_cut_list_v4_2.txt — canonical 162-wire registry (PARSED at runtime:
      label, FROM pin, gauge, color, length). The sheets are GENERATIVE from this file.
  [2] /Users/skylar/k5-harness-pull/harness_spec_latest.txt (2026-04-13, partially STALE) —
      "BULKHEAD PIN ASSIGNMENT" 54-pin seed map. Seed reconciled against [1]; see SEED_KEEP.
  [3] docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md — verified PNs:
      receptacle D38999/24WJ61SN, plug D38999/26WJ61PN, contacts M39029/56-351 (skt) /
      M39029/58-363 (pin), #20 contact = 20-24 AWG / 7.5 A. Superseal housings + contacts.
      NOTE: spec [2] PN "D38999/26WA98SN" is MALFORMED (shell A=size 9 cannot hold 61;
      "98" is not a 61-way arrangement) — superseded by [3]'s verified PNs.
  [4] MILNEC "TX Series / MIL-DTL-38999 Series III Insert Arrangements"
      https://www.milnec.com/mil-d38999-connectors/d38999-contact-arrangements.pdf
      p. B-20 (25-61 = 61 x #20, service rating I, shell 25) and p. B-22 (insert arrangement
      drawing, FRONT FACE OF PIN INSERT, designators A-Z / a-z / AA-PP). Cavity coordinates
      below were transcribed from that drawing (blob-extracted, 2026-06-10). Per MIL-STD-1560
      arrangement 25-61: five concentric rings, PP at center.
  [5] TE Superseal 1.0 catalog (Dalroad mirror p.81): 34-pos = 4 staggered rows 9/8/8/9,
      26-pos = 7/6/6/7. Pin NUMBERING is sequential per MoTeC datasheet tables — verify
      molded cavity numbers on housing before pinning.
  [6] reference_documents/component_drawings/motec_m130_datasheet.pdf p.4-5 (full A/B pin
      functions incl. A23/A24=INJ_LS1/2, A26=BAT_POS, B08-B12/B14 UDIG, B19-B26).
  [7] docs/wiring/calc-data + scripts/generate_pinout_sheets.py — PDM30 authoritative
      channel plan (2026-04-05) + M130 wire joins (already reconciled to v4).
  [8] docs/wiring/output/K5_wire_paths.yaml — firewall-crossing determination:
      a wire crosses the bulkhead iff its path reaches an engine-bay landmark (L02-L15).
      L01 = M130->bulkhead cab-side leg; L16 = PDM30 trunk cab-side leg; L17-L30 cab/floor.

CAVITY ASSIGNMENT RULES (documented on sheet 1; also in receipt
docs/wiring/receipts/2026-06-10_connector-build-sheets.md):
  R1. SEED: 2026-04-13 bulkhead pins 1-54 map to designators in MIL-STD-1560 order
      (1=A ... 23=Z, 24=a ... 47=z, 48=AA ... 54=GG). A wire KEEPS its seeded cavity iff it
      still exists in v4 (label-matched), still crosses the firewall, and is 20-24 AWG.
  R2. GAUGE GATE: #20 contacts accept 20-24 AWG ONLY ([3] App. A: 18/16 AWG = oversized).
      Crossing wires outside that range go to DOES-NOT-PASS / DIRECT-FEED block.
  R3. FILLS: new v4 wires (companion addendum + v4 addendum) fill freed + spare cavities,
      grouped by function, in documented priority (engine-run-critical first), each taking
      the nearest free cavity to its anchor (its parent signal's cavity) on the face.
  R4. SHIELDED SETS: CKP/CMP/knock conductor-2 + drain get cavities adjacent to the signal.
  R5. PAIRS ARE ALL-OR-NOTHING: a 3-wire sensor's gnd+5V pair is useless split; a complete
      single-wire circuit outranks half a pair for the last cavities.
  R6. OVER CAPACITY: 77 candidate crossings > 61 cavities. The 8 lowest-priority wires get
      NO cavity and are listed in the OVERFLOW block (decision required — see receipt).

Run:   python3 scripts/generate_connector_build_sheets.py
Then:  rsvg-convert to PNG + pdf merge (see package.json wiring:connector-sheets)
"""

import os
import re

# ----------------------------------------------------------------------------- style
W, H = 2200, 1700                      # landscape
ORANGE = "#E67300"
GRAY = "#8A8A8A"
INK = "#1A1A1A"
STRIPE = "#F2F2F2"
HDR_BG = "#D8D8D8"
FONT = "Courier New, Courier, monospace"
DATE = "2026-06-10"

# function-group fills (face drawing)
C_SENSOR = "#BBD3EE"     # sensors + sensor supplies (blue)
C_DRIVE = "#F2BBBB"      # coil / injector / actuator drives (red)
C_POWER = "#F8D9A8"      # PDM-fed power & lighting (orange)
C_CAN = "#BFEAEF"        # CAN (cyan)
C_SPARE = "#EBEBEB"      # spare (gray)

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT_DIR = os.path.join(REPO, "docs", "wiring", "output", "connector-sheets")
CUT_LIST = os.path.join(REPO, "docs", "wiring", "output", "K5_cut_list_v4_2.txt")


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ----------------------------------------------------------------------------- cut list parser (reuses v4 row grammar)
SPEC_RE = re.compile(r"(\d+)\s*AWG\s+(M22759/\d+|SHIELDED 2C|TWISTED PAIR|bare/BLK|M22759/16)?")


def parse_cut_list_v4(path):
    """Parse '#id  LABEL  FROM  SPEC  COLOR  LEN [notes]' rows. Returns {id: dict}."""
    wires = {}
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        if not line.startswith("#") or line.startswith("#  ") or line.startswith("#    "):
            continue
        m = re.match(r"^#(\S+)\s+(.*)$", line)
        if not m:
            continue
        wid, rest = m.group(1), m.group(2)
        if wid in ("", "#"):
            continue
        fields = re.split(r"\s{2,}", rest.strip())
        # locate the SPEC field
        spec_i = None
        for i, f in enumerate(fields):
            if re.match(r"^\d+\s*AWG", f):
                spec_i = i
                break
        if spec_i is None or spec_i < 1:
            continue
        label_from = fields[:spec_i]
        # FROM is the last label_from field unless it got glued to the label
        if len(label_from) >= 2:
            label = "  ".join(label_from[:-1])
            frm = label_from[-1]
        else:
            # glued (e.g. "...cable) M130:B15") — split on last space
            parts = label_from[0].rsplit(" ", 1)
            label, frm = parts[0], parts[1]
        spec = fields[spec_i]
        sm = SPEC_RE.match(spec)
        awg = sm.group(1) if sm else "?"
        color, length = "?", "?"
        tail = fields[spec_i + 1:]
        # length field ends with 'ft'
        len_i = None
        for i, f in enumerate(tail):
            if re.match(r"^[\d.]+ft$", f):
                len_i = i
                break
        if len_i is not None:
            color = " ".join(tail[:len_i]) or "?"
            length = tail[len_i].replace("ft", "")
        elif tail:
            color = tail[0]
        # spec lines like '22 AWG    BLK   4.6ft' (companion rows) put color inside spec field
        if color == "?" and sm and spec_i + 1 < len(fields):
            color = fields[spec_i + 1]
        # wide 3-stripe colors leave only ONE space before the length (e.g. 'ORN/BLK/RED 4.6ft')
        gm = re.match(r"^(.*?)\s+([\d.]+)ft$", color)
        if length == "?" and gm:
            color, length = gm.group(1), gm.group(2)
        wires[wid] = {"id": wid, "label": label.strip(), "from": frm.strip(),
                      "awg": awg, "color": color.strip(), "len": length}
    return wires


# Rows whose v4 formatting defeats the column grammar — values transcribed verbatim
# from K5_cut_list_v4_2.txt addendum lines 227-240 (2026-05-14 companion addendum).
PARSE_OVERRIDES = {
    "99g":  {"label": "CKP Sensor Ground (cond 2)", "from": "M130:B15", "awg": "22", "color": "BLK",  "len": "4.6"},
    "99s":  {"label": "CKP Shield Drain",           "from": "M130:B15", "awg": "22", "color": "BARE", "len": "4.6"},
    "101g": {"label": "CMP Sensor Ground (cond 2)", "from": "M130:B16", "awg": "22", "color": "BLK",  "len": "4.6"},
    "101s": {"label": "CMP Shield Drain",           "from": "M130:B16", "awg": "22", "color": "BARE", "len": "4.6"},
    "103g": {"label": "Knock B1 Ground (cond 2)",   "from": "M130:B15", "awg": "22", "color": "BLK",  "len": "4.6"},
    "103s": {"label": "Knock B1 Shield Drain",      "from": "M130:B15", "awg": "22", "color": "BARE", "len": "4.6"},
    "104g": {"label": "Knock B2 Ground (cond 2)",   "from": "M130:B16", "awg": "22", "color": "BLK",  "len": "4.6"},
    "104s": {"label": "Knock B2 Shield Drain",      "from": "M130:B16", "awg": "22", "color": "BARE", "len": "4.6"},
    "INJ_PWR":  {"label": "Injector +12V Rail", "from": "PDM30:OUT?", "awg": "16", "color": "RED", "len": "5.0"},
    "COIL_PWR": {"label": "Coil +12V Rail",     "from": "PDM30:OUT?", "awg": "16", "color": "RED", "len": "3.0"},
}


# ----------------------------------------------------------------------------- D38999 25-61 face geometry
# Transcribed from MILNEC insert-arrangement drawing p. B-22 (front face of PIN insert),
# image coords (x right, y down), insert circle center (520, 610), radius 360.
# The bulkhead RECEPTACLE (D38999/24WJ61SN, socket insert) mating face seen from the
# ENGINE side is the MIRROR of this — the renderer flips X.
CAV_XY = {
    "A": (642, 326), "B": (708, 360), "C": (758, 413), "D": (800, 481), "E": (821, 551),
    "F": (832, 623), "G": (818, 696), "H": (780, 766), "J": (737, 819), "K": (682, 860),
    "L": (622, 889), "M": (526, 903), "N": (432, 894), "P": (362, 860), "R": (306, 818),
    "S": (262, 765), "T": (231, 696), "U": (219, 622), "V": (222, 550), "W": (244, 480),
    "X": (284, 412), "Y": (335, 366), "Z": (400, 330),
    "a": (470, 352), "b": (573, 352), "c": (628, 402), "d": (690, 449), "e": (734, 506),
    "f": (750, 580), "g": (756, 652), "h": (728, 722), "i": (674, 776), "j": (614, 814),
    "k": (524, 818), "m": (434, 814), "n": (370, 775), "p": (326, 724), "q": (294, 657),
    "r": (294, 580), "s": (310, 510), "t": (352, 448), "u": (414, 402), "v": (526, 416),
    "w": (616, 477), "x": (666, 533), "y": (680, 612), "z": (654, 680),
    "AA": (606, 731), "BB": (526, 752), "CC": (436, 732), "DD": (390, 678), "EE": (365, 608),
    "FF": (378, 537), "GG": (428, 482), "HH": (526, 491), "JJ": (584, 553), "KK": (608, 622),
    "LL": (526, 678), "MM": (436, 623), "NN": (454, 553), "PP": (526, 598),
}
CAV_ORDER = (list("ABCDEFGHJKLMNPRSTUVWXYZ") + list("abcdefghijkmnpqrstuvwxyz")
             + ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "JJ", "KK", "LL", "MM", "NN", "PP"])
assert len(CAV_ORDER) == 61 and set(CAV_ORDER) == set(CAV_XY)

# R1 SEED — 2026-04-13 bulkhead pins 1-54 -> designators, reconciled to v4 wire ids.
# 'None' = seed row freed (reason in FREED below).
SEED_KEEP = {
    "A": "23",   # BH1  A/C Compressor Clutch (spec: W6 OUT18 14AWG -> v4 #23 OUT16 20AWG)
    "C": "4a",   # BH3  ETB (spec single 18AWG wire -> v4 6-wire GM 12605109; #4a = TAC2 drive)
    "D": "13", "E": "14", "F": "15", "G": "16",   # BH4-7  Injectors 1-4
    "H": "17", "J": "18", "K": "19", "L": "20",   # BH8-11 Injectors 5-8
    "M": "24", "N": "9", "P": "5", "R": "10",     # BH12-15 Coils 1-4 (v4 ids per coil#)
    "S": "7", "T": "11", "U": "8", "V": "12",     # BH16-19 Coils 5-8
    "a": "50",   # BH24 Washer Pump
    "c": "64",   # BH26 Wideband Lambda Controller
    "d": "73",   # BH27 Underhood Light
    "g": "83", "h": "84",   # BH30/31 Parking Light L/R Front
    "i": "87", "j": "88",   # BH32/33 Side Marker Front L/R
    "k": "80", "m": "82",   # BH34/35 Turn Signal L/R Front
    "n": "94",   # BH36 Fuel Pump Relay
    "t": "111", "u": "105",  # BH41/42 A/C Pressure High / Low
    "v": "101",  # BH43 Cam Position Sensor (shielded set anchors here)
    "w": "110",  # BH44 Coolant Temp
    "x": "99",   # BH45 Crank Position Sensor
    "y": "112",  # BH46 Fuel Pressure
    "z": "109",  # BH47 Intake Air Temp
    "AA": "103", "BB": "104",  # BH48/49 Knock 1/2
    "CC": "108",  # BH50 MAP
    "DD": "102",  # BH51 Oil Pressure
    "EE": "113",  # BH52 Oil Temp
    "FF": "4c", "GG": "4d",    # BH53/54 TPS1/TPS2 (= v4 ETB pins C/D)
}
# Seed rows FREED during reconciliation (cavity, seed BH#, device, reason):
FREED = [
    ("B", 2, "Electric Water Pump", "v4 #25 = 14 AWG -> R2 direct feed"),
    ("W", 20, "Radiator Fan 1", "v4 #21 = 12 AWG -> R2 direct feed"),
    ("X", 21, "Radiator Fan 2", "v4 #22 = 12 AWG -> R2 direct feed"),
    ("Y", 22, "Heater Blower", "v4 #51 = 10 AWG -> R2 direct feed"),
    ("Z", 23, "Horn", "v4 #48 = 16 AWG -> R2 direct feed"),
    ("b", 25, "Wiper Motor", "v4 #49 = 18 AWG -> R2 direct feed"),
    ("e", 28, "LED Headlight L", "v4: dimmer legs #85a/b = 16 AWG -> R2 direct feed"),
    ("f", 29, "LED Headlight R", "v4: dimmer legs #86a/b = 16 AWG -> R2 direct feed"),
    ("p", 37, "Polarity Rev Relay 1", "circuit DELETED in v4"),
    ("q", 38, "Polarity Rev Relay 2", "circuit DELETED in v4"),
    ("r", 39, "Polarity Rev Relay 3", "circuit DELETED in v4"),
    ("s", 40, "Polarity Rev Relay 4", "circuit DELETED in v4"),
]

# R3 FILLS — priority-ordered (wire id, anchor cavity). Greedy nearest-free assignment.
FILLS = [
    ("4b", "C"), ("4e", "C"), ("4f", "C"),                  # P1 ETB completion (run-critical)
    ("99g", "x"), ("99s", "x"), ("101g", "v"), ("101s", "v"),   # P2 shielded sets (R4)
    ("103g", "AA"), ("103s", "AA"), ("104g", "BB"), ("104s", "BB"),
    ("99r", "x"), ("101r", "v"),                            # P3 CKP/CMP 5V refs (run-critical)
    ("108g", "CC"), ("108r", "CC"),                         # P4 MAP pair (run-critical)
    ("109g", "z"), ("110g", "w"), ("113g", "EE"),           # P5 analog-temp grounds
    ("95", "n"),                                            # P6 iBooster relay coil (R5: complete circuit)
]
# R6 OVERFLOW — crossing wires with NO cavity (decision required):
OVERFLOW = [
    ("102g", "OPS ground — pairs with 102r (R5: all-or-nothing)"),
    ("102r", "OPS 5V ref — DD has signal only: sensor DEAD until resolved"),
    ("112g", "FPS ground — pairs with 112r"),
    ("112r", "FPS 5V ref — y has signal only: sensor DEAD until resolved"),
    ("100", "VSS — crosses per wire_paths (L02); NOT in 2026-04-13 seed (spec routed underbody)"),
    ("60", "ECU power — 22 AWG 'ECU' semantics unclear; M130 BAT_POS A26 has NO wire in v4"),
    ("114", "Dakota CTS sender (factory, driver head boss)"),
    ("115", "Dakota oil pressure sender (galley boss)"),
]
# R2 DOES NOT PASS — crossing but outside 20-24 AWG #20 contact range, or battery-class.
DIRECT_FEED = [
    ("21", "12", "Radiator Fan 1 — PDM30:OUT1 (seed BH20)"),
    ("22", "12", "Radiator Fan 2 — PDM30:OUT2 (seed BH21)"),
    ("25", "14", "Electric Water Pump — PDM30:OUT5 (seed BH2)"),
    ("51", "10", "Heater Blower Motor — PDM30:OUT6 (seed BH22)"),
    ("48", "16", "Horn — PDM30:OUT14 (seed BH23)"),
    ("49", "18", "Wiper Motor — PDM30:OUT12 (seed BH25)"),
    ("85a/85b", "16", "LED Headlight L LOW/HIGH dimmer legs (seed BH28)"),
    ("86a/86b", "16", "LED Headlight R LOW/HIGH dimmer legs (seed BH29)"),
    ("INJ_PWR", "16", "Inj +12V rail — ENGINE-CRITICAL, ch TBD"),
    ("COIL_PWR", "16", "Coil +12V rail — ENGINE-CRITICAL, ch TBD"),
    ("6", "0", "Starter Motor (battery-class)"),
    ("59", "0", "Alternator (battery-class)"),
    ("63", "0", "Battery Disconnect (battery-class)"),
    ("52", "8", "Bosch iBooster feed BAT->firewall (battery-class)"),
    ("—", "—", "PDM30 main B+ feed (not a numbered v4 wire) — battery -> cab, grommet + MIDI fuse"),
]

# function group per wire id (for face color)
def wire_group(wid):
    if wid in ("4a", "4b") or wid in ("13", "14", "15", "16", "17", "18", "19", "20",
                                      "24", "9", "5", "10", "7", "11", "8", "12"):
        return C_DRIVE
    if wid in ("23", "50", "64", "73", "83", "84", "87", "88", "80", "82", "94", "95"):
        return C_POWER
    return C_SENSOR  # sensors, TPS, supplies, grounds, drains, A/C switches


# engine-side destination hints (from v4 notes / receipts; default = cut-list label)
ENG_DEST = {
    "4a": "ETB GM 12605109 pin A", "4b": "ETB GM 12605109 pin B",
    "4c": "ETB GM 12605109 pin C", "4d": "ETB GM 12605109 pin D",
    "4e": "ETB GM 12605109 pin E", "4f": "ETB GM 12605109 pin F",
    "5": "D510C coil 3 @ DEL-Stributor", "7": "D510C coil 5 @ DEL-Stributor",
    "8": "D510C coil 7 @ DEL-Stributor", "9": "D510C coil 2 @ DEL-Stributor",
    "10": "D510C coil 4 @ DEL-Stributor", "11": "D510C coil 6 @ DEL-Stributor",
    "12": "D510C coil 8 @ DEL-Stributor", "24": "D510C coil 1 @ DEL-Stributor",
    "13": "EV6 inj @ rail cyl 1", "14": "EV6 inj @ rail cyl 2", "15": "EV6 inj @ rail cyl 3",
    "16": "EV6 inj @ rail cyl 4", "17": "EV6 inj @ rail cyl 5", "18": "EV6 inj @ rail cyl 6",
    "19": "EV6 inj @ rail cyl 7", "20": "EV6 inj @ rail cyl 8",
    "99": "CKP @ front timing cover (Gen IV)", "99g": "CKP pin (cond 2 of #99 cable)",
    "99s": "CKP shield (drain @ ECU end only)", "99r": "CKP 5V supply (3-pin Metri-Pack)",
    "101": "CMP @ front cover", "101g": "CMP pin (cond 2 of #101 cable)",
    "101s": "CMP shield (drain @ ECU end only)", "101r": "CMP 5V supply",
    "103": "Knock B1 below exhaust", "103g": "Knock B1 pin 2 (cond 2)", "103s": "Knock B1 shield",
    "104": "Knock B2 below exhaust", "104g": "Knock B2 pin 2 (cond 2)", "104s": "Knock B2 shield",
    "102": "OPS @ galley boss (WP0IL40 pigtail)", "108": "MAP (ACDelco PT2293 pigtail)",
    "108g": "MAP pin (gnd)", "108r": "MAP pin (5V)",
    "109": "IAT in intake tract", "109g": "IAT pin 2 (gnd return)",
    "110": "CLT @ driver head", "110g": "CLT pin 2 (gnd return)",
    "112": "FPS @ fuel rail", "113": "OTS @ oil galley", "113g": "OTS pin 2 (gnd return)",
    "23": "A/C compressor clutch coil", "48": "Horn", "50": "Washer pump",
    "64": "Wideband lambda controller (engine bay)", "73": "Underhood light",
    "80": "Turn signal lamp front L", "82": "Turn signal lamp front R",
    "83": "Parking lamp front L", "84": "Parking lamp front R",
    "87": "Side marker front L", "88": "Side marker front R",
    "94": "Fuel pump relay (engine bay)", "95": "iBooster relay @ firewall",
    "105": "A/C pressure switch LOW", "111": "A/C pressure switch HIGH",
}

# cab-side pin overrides where v4 FROM is incomplete (orange = unresolved TBD)
CAB_PIN_TBD = {"94": "PDM30:OUT?", "95": "PDM30:OUT?", "105": "M130:UDIG?", "111": "M130:UDIG?"}


def assign_bulkhead(wires):
    """Returns ordered list of (cavity, wire_id_or_None). Greedy nearest-free fills."""
    assigned = dict(SEED_KEEP)
    free = [c for c in CAV_ORDER if c not in assigned]
    for wid, anchor in FILLS:
        ax, ay = CAV_XY[anchor]
        free.sort(key=lambda c: ((CAV_XY[c][0] - ax) ** 2 + (CAV_XY[c][1] - ay) ** 2))
        cav = free.pop(0)
        assigned[cav] = wid
    return assigned, free


# ----------------------------------------------------------------------------- M130 pin data
# (pin, function, wire ids, circuit, color, awg, destination, note, note_color)
# Functions per M130 datasheet [6]; wires joined per cut list v4 [1] (same data already
# reconciled in scripts/generate_pinout_sheets.py — kept in sync manually).
M130A = [
    ("A01", "OUT_HB2", "#4a", "ETB TAC Motor 2", "BRN", "20", "GM 12605109 pin A", None, None),
    ("A02", "SEN_5V0_A", "#4e,99r,102r,112r", "5V reference rail A", "GRY", "22", "ETB E + CKP + OPS + FPS 5V", None, None),
    ("A03", "IGN_LS1", "#5", "Ignition Coil 3", "WHT", "22", "DEL-Stributor central mount", None, None),
    ("A04", "IGN_LS2", "#7", "Ignition Coil 5", "WHT/WHT", "22", "DEL-Stributor central mount", None, None),
    ("A05", "IGN_LS3", "#8", "Ignition Coil 7", "WHT/BLK", "22", "DEL-Stributor central mount", None, None),
    ("A06", "IGN_LS4", "#9", "Ignition Coil 2", "WHT/RED", "22", "DEL-Stributor central mount", None, None),
    ("A07", "IGN_LS5", "#10", "Ignition Coil 4", "WHT/BLU", "22", "DEL-Stributor central mount", None, None),
    ("A08", "IGN_LS6", "#11", "Ignition Coil 6", "WHT/YEL", "22", "DEL-Stributor central mount", None, None),
    ("A09", "SEN_5V0_B", "#108r,101r", "5V reference rail B", "GRY", "22", "MAP + CMP 5V supplies", None, None),
    ("A10", "BAT_NEG1", "—", "Battery negative", "—", "—", "Sensor star gnd (appx G 2.3)",
     "NO ECU gnd wire in cut list v4 — gap (pairs w/ A26)", ORANGE),
    ("A11", "BAT_NEG2", "—", "Battery negative", "—", "—", "Sensor star ground (appx G 2.3)", None, None),
    ("A12", "IGN_LS7", "#12", "Ignition Coil 8", "WHT/VIO", "22", "DEL-Stributor central mount", None, None),
    ("A13", "IGN_LS8", "#24", "Ignition Coil 1", "WHT/ORG", "22", "DEL-Stributor central mount", None, None),
    ("A14", "AV1", "#4c", "ETB TPS1 Signal", "DK GRN", "22", "GM 12605109 pin C",
     "ETB keeps A14; 04-13 AV map STALE", GRAY),
    ("A15", "AV2", "#108", "MAP Sensor", "VIO/WHT", "22", "ACDelco PT2293 / Bosch 3-pin", None, None),
    ("A16", "AV3", "#112", "Fuel Pressure Sensor", "VIO/BLK", "22", "Fuel rail pressure sender", None, None),
    ("A17", "AV4", "#4d", "ETB TPS2 Signal", "PPL", "22", "GM 12605109 pin D", None, None),
    ("A18", "OUT_HB1", "#4b", "ETB TAC Motor 1", "YEL", "20", "GM 12605109 pin B", None, None),
    ("A19", "INJ_PH1", "#13", "Fuel Injector 1", "GRN", "22", "EV6/USCAR @ rail cyl 1", None, None),
    ("A20", "INJ_PH2", "#14", "Fuel Injector 2", "GRN/WHT", "22", "EV6/USCAR @ rail cyl 2", None, None),
    ("A21", "INJ_PH3", "#15", "Fuel Injector 3", "GRN/BLK", "22", "EV6/USCAR @ rail cyl 3", None, None),
    ("A22", "INJ_PH4", "#16", "Fuel Injector 4", "GRN/RED", "22", "EV6/USCAR @ rail cyl 4", None, None),
    ("A23", "INJ_LS1", "—", "(no wire)", "—", "—", "—", None, None),
    ("A24", "INJ_LS2", "—", "(no wire)", "—", "—", "—", None, None),
    ("A25", "AV5", "#102", "Oil Pressure (ECU)", "VIO", "22", "OPS galley boss",
     "#102 MOVED A14->A25 per v4 receipt", GRAY),
    ("A26", "BAT_POS", "—", "(no wire)", "—", "—", "—",
     "NO M130 power-feed wire exists in cut list v4 — open gap (see #60 note, sheet 1)", ORANGE),
    ("A27", "INJ_PH5", "#17", "Fuel Injector 5", "GRN/BLU", "22", "EV6/USCAR @ rail cyl 5", None, None),
    ("A28", "INJ_PH6", "#18", "Fuel Injector 6", "GRN/YEL", "22", "EV6/USCAR @ rail cyl 6", None, None),
    ("A29", "INJ_PH7", "#19", "Fuel Injector 7", "GRN/VIO", "22", "EV6/USCAR @ rail cyl 7", None, None),
    ("A30", "INJ_PH8", "#20", "Fuel Injector 8", "GRN/ORG", "22", "EV6/USCAR @ rail cyl 8", None, None),
    ("A31", "OUT_HB3", "#116", "Dakota Tach Signal", "WHT/BLK", "22", "Dakota VHX tach input (dash)",
     "spare HB as tach pulse (2026-05-14); M1 GPR config at tune", GRAY),
    ("A32", "OUT_HB4", "#118", "Dakota VSS / Speedo", "WHT/YEL", "22", "Dakota VHX speedo input (dash)",
     "spare HB as VSS mirror (2026-05-14); M1 GPR config at tune", GRAY),
    ("A33", "OUT_HB5", "—", "(no wire — future provisioning)", "—", "—", "—", None, None),
    ("A34", "OUT_HB6", "—", "(no wire — future provisioning)", "—", "—", "—", None, None),
]

M130B = [
    ("B01", "UDIG1", "#99", "Crank Position Sensor", "BLU/WHT/WHT", "22", "SHLD 2C; drain -> B15 (#99s)", None, None),
    ("B02", "UDIG2", "#101", "Cam Position Sensor", "BLU/WHT/BLK", "22", "SHLD 2C; drain -> B16 (#101s)",
     "2026-04-13 'camera on B02' STALE — camera = PDM30:OUT15 (#97)", GRAY),
    ("B03", "AT1", "#109", "Intake Air Temp Sensor", "TAN", "22", "IAT; gnd #109g -> B15",
     "CONFLICT: pdm_power_budget swaps CLT/IAT on B03/B04; cut list v4 + appx-G value shown", ORANGE),
    ("B04", "AT2", "#110", "Coolant Temp Sensor (ECU)", "TAN/WHT", "22", "CLT; gnd #110g -> B16",
     "CONFLICT: see B03", ORANGE),
    ("B05", "AT3", "#113", "Oil Temperature Sensor", "TAN/BLK", "22", "OTS; gnd #113g -> B15", None, None),
    ("B06", "AT4", "—", "(reserved — no wire)", "—", "—", "—",
     "spare AT4 — needs companion gnd when assigned (v4 KNOWN GAPS)", GRAY),
    ("B07", "KNOCK1", "#103", "Knock Sensor Bank 1", "GRY", "22", "SHLD 2C; drain -> B15", None, None),
    ("B08", "UDIG3", "—", "(no wire)", "—", "—", "—",
     "candidate for #105/#111 A/C switches (FROM='ECU', pin TBD)", ORANGE),
    ("B09", "UDIG4", "—", "(no wire)", "—", "—", "—", None, None),
    ("B10", "UDIG5", "—", "(no wire)", "—", "—", "—", None, None),
    ("B11", "UDIG6", "—", "(no wire)", "—", "—", "—", None, None),
    ("B12", "BAT_BAK", "—", "(no wire)", "—", "—", "—", None, None),
    ("B13", "KNOCK2", "#104", "Knock Sensor Bank 2", "GRY/WHT", "22", "SHLD 2C; drain -> B16", None, None),
    ("B14", "UDIG7", "—", "(no wire)", "—", "—", "—", None, None),
    ("B15", "SEN_0V_A", "#4f,99g/s,103g/s,108g,109g,113g", "Sensor 0V star A", "BLK/BARE", "22",
     "ETB+CKP+K1 gnd/drains, MAP+IAT+OTS gnd", None, None),
    ("B16", "SEN_0V_B", "#101g/s,102g,104g/s,110g,112g", "Sensor 0V star B", "BLK/BARE", "22",
     "CMP+K2 gnd/drains, OPS+CLT+FPS gnd", None, None),
    ("B17", "CAN_HI", "#62", "CAN Bus 1 High", "WHT/GRN", "24", "PDM30 B26 + C125/Dakota",
     "#125 T43 stub 22 vs 24 AWG trunk (v4 rcpt)", GRAY),
    ("B18", "CAN_LO", "#62", "CAN Bus 1 Low", "WHT/GRN", "24", "PDM30 B25 + C125/Dakota; 120R each end", None, None),
    ("B19", "SEN_6V3", "—", "(no wire)", "—", "—", "—", None, None),
    ("B20", "AV6", "—", "(no wire)", "—", "—", "—",
     "candidate for #98 fuel level AV pin (v4 open item)", ORANGE),
    ("B21", "AV7", "—", "(no wire)", "—", "—", "—", None, None),
    ("B22", "AV8", "—", "(no wire)", "—", "—", "—", None, None),
    ("B23", "ETH_TX+", "—", "(no wire — tune via UTC)", "—", "—", "—", None, None),
    ("B24", "ETH_TX-", "—", "(no wire)", "—", "—", "—", None, None),
    ("B25", "ETH_RX+", "—", "(no wire)", "—", "—", "—", None, None),
    ("B26", "ETH_RX-", "—", "(no wire)", "—", "—", "—", None, None),
]

# M130 face color groups by pin function
def m130_pin_group(func, used):
    if not used:
        return C_SPARE
    f = func or ""
    if f.startswith(("IGN_", "INJ_", "OUT_HB")):
        return C_DRIVE
    if f.startswith(("CAN", "ETH")):
        return C_CAN
    if f.startswith(("BAT",)):
        return C_POWER
    return C_SENSOR


# ----------------------------------------------------------------------------- PDM30 channel data
# (ch, rating, device, est amps, wires, color, awg, pins, note, note_color)
# Channel plan: K5_pdm30_channel_plan.md 2026-04-05 AUTHORITATIVE [7];
# pin pairs per PDM30 datasheet (CONNECTOR_DATA_REPORT 2.5).
PDM = [
    ("OUT1", "20A", "Radiator Fan 1", "18A", "#21", "ORN/WHT", "12", "A1+A10", None, None),
    ("OUT2", "20A", "Radiator Fan 2", "18A", "#22", "ORN/BLK", "12", "A3+A12", None, None),
    ("OUT3", "20A", "Power Window Motor Left", "15A", "#34", "DK BLU", "16", "A5+A14", None, None),
    ("OUT4", "20A", "Power Window Motor Right", "15A", "#35", "DK BLU/WHT", "16", "A7+A16", None, None),
    ("OUT5", "20A", "Electric Water Pump", "12A", "#25", "ORN/BLU", "14", "A9+A17", None, None),
    ("OUT6", "20A", "Heater Blower Motor", "12A", "#51", "ORN/BLK/BLU", "10", "B3+B9", None, None),
    ("OUT7", "20A", "Electric Parking Brake (E-Stopp)", "10A", "#54", "ORN/BLK/YEL", "16", "B5+B11",
     "#126 dash trigger landed; button PN TBD", GRAY),
    ("OUT8", "20A", "Cigarette Lighter / 12V Outlet", "10A", "#72", "ORN/ORG", "14", "B7+B13", None, None),
    ("OUT9", "8A", "AMP Research Step Left", "8A", "#1", "ORN/BLK", "18", "A2", None, None),
    ("OUT10", "8A", "AMP Research Step Right", "8A", "#2", "ORN/BLK/WHT", "18", "A4", None, None),
    ("OUT11", "8A", "AMP Research Controller", "2A", "#3", "ORN/BLK/BLK", "22", "A6", None, None),
    ("OUT12", "8A", "Windshield Wiper Motor", "6A", "#49", "PPL", "18", "A8", None, None),
    ("OUT13", "8A", "park_tail group (4 fixtures)", "1.6A", "#75,81,83,84", "BRN/*", "22", "A11", None, None),
    ("OUT14", "8A", "Horn", "5A", "#48", "ORN/ORG", "16", "A13", None, None),
    ("OUT15", "8A", "backup group (+3rd brake +camera)", "3.5A", "#76,89,93,97", "BRN/*,BLU/WHT", "22", "A15", None, None),
    ("OUT16", "8A", "A/C Compressor Clutch", "4A", "#23", "ORN/RED", "20", "A18",
     "BULKHEAD cavity A (sheet 1)", GRAY),
    ("OUT17", "8A", "LED Headlight L (-> dimmer COMMON)", "3.6A", "#85", "LT GRN", "20", "A20",
     "legs #85a/b 16 AWG = direct feed (sheet 1)", GRAY),
    ("OUT18", "8A", "LED Headlight R (-> dimmer COMMON)", "3.6A", "#86", "LT GRN/WHT", "20", "A22", None, None),
    ("OUT19", "8A", "markers_clearance group (8 fixtures)", "1.3A", "#77,78,79,87,88,90,91,92", "BRN/*", "22", "A24", None, None),
    ("OUT20", "8A", "Radio / Head Unit", "3A", "#31", "ORN/BLK", "22", "A25", None, None),
    ("OUT21", "8A", "Power Lock Actuator Left", "3A", "#38", "BLK", "20", "B1", None, None),
    ("OUT22", "8A", "Power Lock Actuator Right", "3A", "#47", "BLK/WHT", "20", "B2", None, None),
    ("OUT23", "8A", "Transmission Controller (T43)", "3A", "#58", "ORN/YEL", "22", "B4", None, None),
    ("OUT24", "8A", "Wideband Lambda Controller", "3A", "#64", "ORN/BLK", "22", "B6",
     "BULKHEAD cavity c (sheet 1)", GRAY),
    ("OUT25", "8A", "interior_courtesy group (5 fixtures)", "2.5A", "#67,68,69,73,74", "BRN/*", "22", "B8", None, None),
    ("OUT26", "8A", "Washer Pump", "2A", "#50", "ORN/BLK/RED", "22", "B10",
     "BULKHEAD cavity a (sheet 1)", GRAY),
    ("OUT27", "8A", "Turn Signal Left Front", "2A", "#80 (+#119 tap)", "LT BLU", "22", "B12", None, None),
    ("OUT28", "8A", "Turn Signal Right Front", "2A", "#82 (+#120 tap)", "DK BLU", "22", "B14", None, None),
    ("OUT29", "8A", "Display / Dash (MoTeC C125)", "1A", "#65 (+#124 splice)", "ORN/RED", "22", "B16",
     "#124 color collides #117 — fix at mockup", ORANGE),
    ("OUT30", "8A", "USB Charging Port", "1A", "#70", "ORN/YEL", "22", "B19", None, None),
]
PDM_FIXED = [
    ("VBATT-", "—", "Battery negative", "—", "—", "—", "—", "A26,B18", None, None),
    ("GND", "—", "0 V", "—", "—", "—", "—", "A28,B22", None, None),
    ("DIG1-16", "—", "Switch inputs (none assigned in v4)", "—", "—", "—", "—", "A19-34,B15-24",
     "keypad is CAN (#57); no DIG wires in v4", GRAY),
    ("CAN", "—", "CAN Hi / CAN Lo", "—", "#62 trunk", "WHT/GRN", "24", "B26,B25", None, None),
    ("C1 STUD", "—", "VBATT+ main feed (M6 stud)", "—", "— (not in v4)", "—", "—", "C1",
     "main B+ feed wire MISSING from v4 — sheet 1", ORANGE),
]

# PDM30 datasheet pin->function (for the face drawings)
PDM_A_PIN = {1: "OUT1", 2: "OUT9", 3: "OUT2", 4: "OUT10", 5: "OUT3", 6: "OUT11", 7: "OUT4",
             8: "OUT12", 9: "OUT5", 10: "OUT1", 11: "OUT13", 12: "OUT2", 13: "OUT14",
             14: "OUT3", 15: "OUT15", 16: "OUT4", 17: "OUT5", 18: "OUT16", 19: "DIG2",
             20: "OUT17", 21: "DIG4", 22: "OUT18", 23: "DIG7", 24: "OUT19", 25: "OUT20",
             26: "VBAT-", 27: "DIG1", 28: "GND", 29: "DIG3", 30: "DIG5", 31: "DIG6",
             32: "DIG8", 33: "DIG9", 34: "DIG10"}
PDM_B_PIN = {1: "OUT21", 2: "OUT22", 3: "OUT6", 4: "OUT23", 5: "OUT7", 6: "OUT24", 7: "OUT8",
             8: "OUT25", 9: "OUT6", 10: "OUT26", 11: "OUT7", 12: "OUT27", 13: "OUT8",
             14: "OUT28", 15: "DIG13", 16: "OUT29", 17: "DIG15", 18: "VBAT-", 19: "OUT30",
             20: "DIG11", 21: "DIG12", 22: "GND", 23: "DIG14", 24: "DIG16", 25: "CANLO",
             26: "CANHI"}
PDM_USED_OUTS = {r[0] for r in PDM}  # all 30


# ----------------------------------------------------------------------------- SVG primitives
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

    def circle(self, cx, cy, r, fill="none", stroke=INK, sw=1):
        self.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}"/>')

    def text(self, x, y, s, size=12, fill=INK, bold=False, anchor="start"):
        w = ' font-weight="bold"' if bold else ""
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}"'
                 f'{w} fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>')

    def svg(self):
        body = "\n".join(self.parts)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
                f'viewBox="0 0 {W} {H}">\n'
                f'<rect x="0" y="0" width="{W}" height="{H}" fill="#FFFFFF"/>\n{body}\n</svg>\n')


def frame(s):
    s.rect(24, 24, W - 48, H - 48, sw=3)
    s.rect(32, 32, W - 64, H - 64, sw=1)


def title_block(s, sheet_no, note):
    bw, bh = 620, 150
    x, y = W - 44 - bw, H - 44 - bh
    s.rect(x, y, bw, bh, fill="#FFFFFF", sw=2)
    for ry in (28, 54, 80, 106):
        s.line(x, y + ry, x + bw, y + ry, sw=1)
    s.text(x + 12, y + 20, "NUKE LTD / DESERT PERFORMANCE", 14, bold=True)
    s.text(x + 12, y + 46, "1977 CHEVROLET K5 BLAZER — VIN CKR187F127263", 12)
    s.text(x + 12, y + 72, "LS3 6.2L / MoTeC M130 + PDM30 — CONNECTOR BUILD SHEETS", 12)
    s.text(x + 12, y + 98, f"SHEET {sheet_no} OF 4   —   {DATE}   —   REV A", 12, bold=True)
    s.text(x + 12, y + 124, note[:78], 9.5)
    s.text(x + 12, y + 140, note[78:156], 9.5)


def legend(s, x, y, items):
    for label, color in items:
        s.rect(x, y - 11, 14, 14, fill=color, sw=1)
        s.text(x + 20, y, label, 10.5)
        x += 24 + 7.2 * len(label) + 26


def table(s, x0, y0, cols, header, rows, pitch=21, font=11, hdr_h=30):
    tw = sum(cols)
    s.rect(x0, y0, tw, hdr_h, fill=HDR_BG, sw=1.5)
    cx = x0
    for wcol, htxt in zip(cols, header):
        s.text(cx + 7, y0 + hdr_h - 10, htxt, font + 0.5, bold=True)
        cx += wcol
    y = y0 + hdr_h
    for i, row in enumerate(rows):
        cells, tint, txtcolor = row["cells"], row.get("tint"), row.get("color", INK)
        note = row.get("note")          # (text, color) second line under col index 2
        bg = tint or ("#FFFFFF" if i % 2 == 0 else STRIPE)
        s.rect(x0, y, tw, pitch, fill=bg, sw=0.6, stroke="#777777")
        cx = x0
        base = y + (pitch - 6 if not note else pitch - 14)
        for wcol, cell in zip(cols, cells):
            cellcolor = txtcolor
            celltext = cell
            if isinstance(cell, tuple):
                celltext, cellcolor = cell
            s.text(cx + 7, base, str(celltext), font, fill=cellcolor,
                   bold=(cellcolor == ORANGE))
            cx += wcol
        if note:
            ntxt, ncol2 = note
            s.text(x0 + cols[0] + cols[1] + 7, y + pitch - 4, ntxt, font - 2.2,
                   fill=ncol2, bold=(ncol2 == ORANGE))
        y += pitch
    cx = x0
    for wcol in cols[:-1]:
        cx += wcol
        s.line(cx, y0, cx, y, stroke="#777777", sw=0.6)
    s.rect(x0, y0, tw, y - y0, sw=1.5)
    return y


def wrap(txt, width):
    words, lines, cur = txt.split(" "), [], ""
    for wd in words:
        if len(cur) + len(wd) + 1 > width:
            lines.append(cur)
            cur = wd
        else:
            cur = (cur + " " + wd).strip()
    if cur:
        lines.append(cur)
    return lines


def write(fname, sheet):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, fname)
    with open(path, "w") as f:
        f.write(sheet.svg())
    print("wrote", os.path.relpath(path, REPO))


# ----------------------------------------------------------------------------- SHEET 1: bulkhead
def sheet_bulkhead(wires):
    assigned, spare = assign_bulkhead(wires)
    used = sum(1 for c in CAV_ORDER if c in assigned)

    s = Sheet()
    frame(s)
    s.text(W / 2, 74, "FIREWALL BULKHEAD — D38999 61-WAY (INSERT ARRANGEMENT 25-61)",
           28, bold=True, anchor="middle")
    s.text(W / 2, 102,
           f"RECEPTACLE D38999/24WJ61SN (FIREWALL) + PLUG D38999/26WJ61PN (ENGINE LOOM) — "
           f"{used}/61 CAVITIES USED, {len(spare)} SPARE, {len(OVERFLOW)} OVERFLOW", 13, anchor="middle")
    s.text(W / 2, 124,
           "spec PN “D38999/26WA98SN” (2026-04-13) IS MALFORMED — superseded by CONNECTOR_DATA_REPORT verified PNs above",
           11, fill=ORANGE, anchor="middle", bold=True)

    # ---- face drawing (left third) — engine-side view of receptacle = mirror of pin-face
    fcx, fcy, R = 392, 480, 312
    img_cx, img_cy, img_r = 520, 610, 360
    sc = R / img_r

    def fx(c):
        x, y = CAV_XY[c]
        return fcx - (x - img_cx) * sc, fcy + (y - img_cy) * sc  # MIRROR X

    s.circle(fcx, fcy, R + 26, sw=3)                      # shell
    s.circle(fcx, fcy, R + 2, sw=1.5)                     # insert
    # master keyway at 12 o'clock
    s.rect(fcx - 16, fcy - R - 44, 32, 22, fill="#EEEEEE", sw=2)
    s.text(fcx, fcy - R - 50, "MASTER KEYWAY (POS N) — 12 O'CLOCK", 10.5, anchor="middle")
    for c in CAV_ORDER:
        x, y = fx(c)
        wid = assigned.get(c)
        fill = wire_group(wid) if wid else C_SPARE
        s.circle(x, y, 21, fill=fill, sw=1.4)
        s.text(x, y + 4.5, c, 12 if len(c) == 1 else 10.5, bold=wid is not None, anchor="middle")
    s.text(fcx, fcy + R + 52, "VIEW: MATING FACE, ENGINE SIDE", 14, bold=True, anchor="middle")
    s.text(fcx, fcy + R + 70,
           "(socket-insert face = MIRROR of MIL-STD-1560 pin-insert drawing, MILNEC p. B-22)",
           10.5, fill=GRAY, anchor="middle")
    legend(s, 84, fcy + R + 96, [("SENSOR/SIG", C_SENSOR), ("INJ/COIL/ETB", C_DRIVE),
                                 ("PWR/LIGHTING", C_POWER), ("CAN (none)", C_CAN),
                                 ("SPARE", C_SPARE)])

    # ---- PN block
    py = fcy + R + 118
    s.rect(60, py, 660, 108, fill="#F7F7F7", sw=1.5)
    for i, ln in enumerate([
        "SHELL: D38999/24WJ61SN jam-nut receptacle (firewall) / D38999/26WJ61PN plug (engine loom)",
        "CONTACTS: M39029/56-351 socket (receptacle) + M39029/58-363 pin (plug) — size #20,",
        "  20-24 AWG, 7.5 A, gold/nickel. Crimp M22520/2-01 (AFM8). Seal plugs in spare cavities.",
        "INSERT 25-61 per MIL-STD-1560: 61 x #20, service rating I, shell 25 — verified MILNEC",
        "  insert-arrangement catalog p. B-20 + B-22 (milnec.com/.../d38999-contact-arrangements.pdf)",
        "JAM NUT 120-130 in-lb; couple hand-tight + 1/8 turn. CONNECTOR_DATA_REPORT.md 1.1-1.8",
    ]):
        s.text(72, py + 18 + i * 15, ln, 10)

    # ---- assignment rules note
    ry = py + 124
    s.text(60, ry, "CAVITY ASSIGNMENT RULES (full text: receipt 2026-06-10_connector-build-sheets.md):", 11, bold=True)
    rules = [
        "R1 SEED: 2026-04-13 bulkhead pins 1-54 -> designators in MIL-STD-1560 order (1=A..23=Z,24=a..47=z,48=AA..54=GG);",
        "   wire keeps seed cavity iff still in cut list v4, still crosses firewall, and 20-24 AWG.",
        "R2 GAUGE: #20 contact = 20-24 AWG ONLY. Crossing wires 18 AWG+ -> DOES-NOT-PASS block (right).",
        "R3 FILLS: new v4 + companion wires fill freed/spare cavities by run-critical priority, nearest free cavity to parent.",
        "R4 SHIELDED: CKP/CMP/knock cond-2 + drain adjacent to signal cavity.  R5 gnd+5V pairs are all-or-nothing.",
        "R6 OVER CAPACITY: 77 candidate crossings > 61 cavities -> 8 wires in OVERFLOW (below). DECISION REQUIRED.",
    ]
    for i, ln in enumerate(rules):
        s.text(60, ry + 17 + i * 15, ln, 9.8, fill=INK if not ln.startswith("R6") else ORANGE,
               bold=ln.startswith("R6"))

    # ---- overflow block
    oy = ry + 17 + len(rules) * 15 + 12
    s.rect(60, oy, 660, 24 + len(OVERFLOW) * 17 + 8, fill="#FDF1E3", stroke=ORANGE, sw=2)
    s.text(72, oy + 17, f"OVERFLOW — CROSSES FIREWALL, NO CAVITY ({len(OVERFLOW)} WIRES)", 11.5,
           fill=ORANGE, bold=True)
    for i, (wid, why) in enumerate(OVERFLOW):
        s.text(72, oy + 36 + i * 17, f"#{wid:<5} {why}"[:96], 9.6, fill=ORANGE)

    # ---- cut list table (right two-thirds)
    cols = [62, 84, 332, 128, 52, 64, 416, 142]
    header = ["CAV", "WIRE #", "CIRCUIT", "COLOR", "AWG", "LEN", "ENGINE-SIDE DEST", "CAB-SIDE PIN"]
    rows = []
    flagged = {"DD": "102", "y": "112"}  # signal landed, companions overflowed
    for c in CAV_ORDER:
        wid = assigned.get(c)
        if not wid:
            rows.append({"cells": [c, "—", "— SPARE —", "—", "—", "—", "—", "—"], "color": GRAY})
            continue
        wr = wires[wid]
        dest = ENG_DEST.get(wid, wr["label"])
        cab = CAB_PIN_TBD.get(wid, wr["from"])
        cabcell = (cab, ORANGE) if wid in CAB_PIN_TBD else cab
        row = {"cells": [c, "#" + wid, wr["label"][:40], wr["color"], wr["awg"],
                         wr["len"] + "ft", dest[:50], cabcell]}
        if c in flagged:
            row["tint"] = "#FDEBD0"
            row["cells"][6] = (dest[:30] + " | gnd+5V IN OVERFLOW", ORANGE)
        if wr["awg"] not in ("20", "22", "24"):
            row["cells"][4] = (wr["awg"], ORANGE)
        rows.append(row)
    ty = table(s, 760, 152, cols, header, rows, pitch=20.5, font=10.5)

    # ---- direct-feed block (bottom, under table, left of title block)
    dx, dy = 760, ty + 14
    s.rect(dx, dy, 760, 24 + ((len(DIRECT_FEED) + 1) // 2) * 16 + 10, fill="#F7F7F7", sw=1.5)
    s.text(dx + 12, dy + 17, "DOES NOT PASS BULKHEAD — DIRECT FEED (R2 gauge gate / battery-class)",
           11.5, bold=True)
    half = (len(DIRECT_FEED) + 1) // 2
    for i, (wid, awg, what) in enumerate(DIRECT_FEED):
        colx = dx + 12 + (0 if i < half else 380)
        rowy = dy + 34 + (i % half) * 16
        s.text(colx, rowy, f"#{wid:<8} {awg:>2} AWG  {what}"[:62], 9.2,
               fill=ORANGE if "ENGINE-CRITICAL" in what else INK,
               bold="ENGINE-CRITICAL" in what)
    s.text(dx, dy + 24 + ((len(DIRECT_FEED) + 1) // 2) * 16 + 24,
           "Direct-feed wires route via firewall grommets H1-H4 with protection per K5_harness_protection_catalog.md.",
           9.5, fill=GRAY)
    s.text(dx, dy + 24 + ((len(DIRECT_FEED) + 1) // 2) * 16 + 40,
           "#66 fuel pump / #32 amp (8 AWG) route via FLOOR to rear — they never cross the firewall.",
           9.5, fill=GRAY)

    title_block(s, 1, "FACE: MILNEC 25-61 drawing (transcribed). TABLE: K5_cut_list_v4 + 2026-04-13 seed reconciled per rules R1-R6.")
    write("K5_connector_FIREWALL_D38999.svg", s)
    return assigned, spare


# ----------------------------------------------------------------------------- SHEETS 2/3: M130
def superseal_face(s, x0, y0, rows_layout, numbering, used_pins, group_fn, label,
                   cell=52, gap=10):
    """rows_layout e.g. [9,8,8,9]; numbering: list of pin numbers row by row."""
    maxcols = max(rows_layout)
    gw = maxcols * cell + (maxcols - 1) * gap
    gh = len(rows_layout) * (cell + gap) - gap
    s.rect(x0 - 26, y0 - 26, gw + 52, gh + 52, sw=2.5)        # housing
    s.rect(x0 + gw / 2 - 34, y0 - 44, 68, 16, fill="#EEEEEE", sw=1.5)
    s.text(x0 + gw / 2, y0 - 32, "KEY 1", 10, anchor="middle")
    n_i = 0
    for r, ncols in enumerate(rows_layout):
        off = (maxcols - ncols) * (cell + gap) / 2
        for ccol in range(ncols):
            pin = numbering[n_i]
            n_i += 1
            px = x0 + off + ccol * (cell + gap)
            py = y0 + r * (cell + gap)
            used = pin in used_pins
            s.circle(px + cell / 2, py + cell / 2, cell / 2, fill=group_fn(pin, used), sw=1.4)
            s.text(px + cell / 2, py + cell / 2 + 4, str(pin), 12, bold=used, anchor="middle")
    by = y0 + gh + 36
    s.text(x0 + gw / 2, by, label, 12, bold=True, anchor="middle")
    return by


def sheet_m130(conn, pins, rows_layout, sheet_no, fname):
    s = Sheet()
    frame(s)
    total = len(pins)
    used = [p for p in pins if p[2] != "—"]
    s.text(W / 2, 74, f"M130 ECU — CONNECTOR {conn} ({total}-WAY TYCO SUPERSEAL 1.0)",
           28, bold=True, anchor="middle")
    te_pn = "TE 4-1437290-0 (MoTeC #65044)" if total == 34 else "TE 3-1437290-7 (MoTeC #65045)"
    s.text(W / 2, 102, f"PLUG {te_pn} — KEY 1 — {len(used)}/{total} PINS WIRED, "
                       f"{total - len(used)} SPARE", 13, anchor="middle")

    # face: left
    numbering = list(range(1, total + 1))
    used_nums = {int(p[0][1:]) for p in used}
    funcs = {int(p[0][1:]): p[1] for p in pins}

    def gf(pin, u):
        return m130_pin_group(funcs.get(pin, ""), u)

    by = superseal_face(s, 80, 220, rows_layout, numbering, used_nums, gf,
                        f"CONNECTOR {conn} — MATING FACE (HARNESS PLUG, WIRE-SIDE REAR)")
    s.text(80, by + 22, "Row split 9/8/8/9 (34-pos) / 7/6/6/7 (26-pos) per TE Superseal 1.0", 10, fill=GRAY)
    s.text(80, by + 38, "catalog config drawing (Dalroad mirror p.81). Pin numbers sequential per", 10, fill=GRAY)
    s.text(80, by + 54, "MoTeC M130 datasheet (Part 13130) p.4-5 tables — VERIFY MOLDED CAVITY", 10, fill=GRAY)
    s.text(80, by + 70, "NUMBERS ON HOUSING BEFORE PINNING.", 10, fill=GRAY, bold=True)
    legend(s, 80, by + 98, [("SENSOR/AV/AT", C_SENSOR), ("INJ/IGN/HB", C_DRIVE),
                            ("BAT", C_POWER), ("CAN/ETH", C_CAN), ("NO WIRE", C_SPARE)])

    # contacts PN block
    cy = by + 118
    s.rect(60, cy, 580, 96, fill="#F7F7F7", sw=1.5)
    for i, ln in enumerate([
        "CONTACTS (CONNECTOR_DATA_REPORT 2.3):",
        "  20-24 AWG signal: TE 3-1447221-4 (gold, small barrel)",
        "  16-18 AWG power:  TE 3-1447221-3 (gold, normal barrel)",
        "  solid alt: ProWireUSA SSC-N (16-24 AWG). Crimp HDT-48-00.",
        "  Sealed cavity plugs in all spare positions (IP67).",
    ]):
        s.text(72, cy + 17 + i * 15, ln, 10)

    # table: right
    cols = [64, 120, 248, 250, 112, 52, 408]
    header = ["PIN", "FUNCTION", "WIRE #", "CIRCUIT", "COLOR", "AWG", "DESTINATION / NOTE"]
    rows = []
    for (pin, func, wire, circ, color, awg, dest, note, ncol) in pins:
        spare_row = wire == "—" and note is None
        cells = [pin, func, wire, circ, color, awg, dest]
        row = {"cells": cells, "color": GRAY if spare_row else INK}
        if note:
            cells[6] = (f"{dest} | {note}"[:56] if dest != "—" else note[:56],
                        ncol or ORANGE)
        rows.append(row)
    pitch = 36 if total == 34 else 46
    table(s, 700, 152, cols, header, rows, pitch=pitch, font=11.5, hdr_h=32)

    title_block(s, sheet_no, "PIN FUNCTIONS: MoTeC M130 datasheet p.4-5. WIRES: K5_cut_list_v4 join (FROM column) + companion addendum.")
    write(fname, s)


# ----------------------------------------------------------------------------- SHEET 4: PDM30
def sheet_pdm():
    s = Sheet()
    frame(s)
    s.text(W / 2, 74, "PDM30 — POWER DISTRIBUTION (CONN A 34-WAY + CONN B 26-WAY + C STUD)",
           28, bold=True, anchor="middle")
    s.text(W / 2, 102, "PLUGS: TE 4-1437290-0 / #65044 (A) + TE 3-1437290-7 / #65045 (B) — "
                       "CHANNEL PLAN 2026-04-05 AUTHORITATIVE — 30/30 OUTPUTS USED", 13, anchor="middle")

    def gf_a(pin, used):
        f = PDM_A_PIN.get(pin, "")
        if f.startswith("OUT"):
            return C_POWER
        if f.startswith("DIG"):
            return C_SPARE  # no DIG wires in v4
        if f.startswith("CAN"):
            return C_CAN
        return C_SENSOR  # VBAT-/GND

    def gf_b(pin, used):
        f = PDM_B_PIN.get(pin, "")
        if f.startswith("OUT"):
            return C_POWER
        if f.startswith("DIG"):
            return C_SPARE
        if f.startswith("CAN"):
            return C_CAN
        return C_SENSOR

    # faces stacked left — used = OUT pins + VBAT/GND/CAN
    used_a = {p for p, f in PDM_A_PIN.items() if f.startswith("OUT") or f in ("VBAT-", "GND")}
    used_b = {p for p, f in PDM_B_PIN.items() if f.startswith("OUT") or f in ("VBAT-", "GND", "CANLO", "CANHI")}
    by = superseal_face(s, 76, 200, [9, 8, 8, 9], list(range(1, 35)), used_a, gf_a,
                        "CONN A — MATING FACE (A1-A34)", cell=46, gap=8)
    by2 = superseal_face(s, 76, by + 60, [7, 6, 6, 7], list(range(1, 27)), used_b, gf_b,
                         "CONN B — MATING FACE (B1-B26)", cell=46, gap=8)
    legend(s, 64, by2 + 28, [("OUTPUT", C_POWER), ("DIG (unused)", C_SPARE),
                             ("CAN", C_CAN), ("VBAT-/GND", C_SENSOR)])
    s.text(64, by2 + 54, "Pin->function map: PDM30 datasheet (Part 14103) via", 10, fill=GRAY)
    s.text(64, by2 + 70, "CONNECTOR_DATA_REPORT 2.5. 20A outputs use PAIRED pins —", 10, fill=GRAY)
    s.text(64, by2 + 86, "both wires routed together. C1 = M6 stud, VBATT+ main feed.", 10, fill=GRAY)
    s.text(64, by2 + 108, "DIG pin numbers shown gray: no discrete switch-input wires", 10, fill=GRAY)
    s.text(64, by2 + 124, "exist in cut list v4 (keypad is CAN).", 10, fill=GRAY)

    # channel table right
    cols = [88, 70, 348, 78, 188, 158, 52, 118]
    header = ["CH", "RATE", "DEVICE / GROUP", "AMPS", "WIRE #", "COLOR", "AWG", "PINS"]
    rows = []
    for (ch, rate, dev, amps, wirec, color, awg, pinsc, note, ncol) in PDM + PDM_FIXED:
        cells = [ch, rate, dev[:42], amps, wirec, color, awg, pinsc]
        row = {"cells": cells}
        if note:
            row["note"] = (note[:74], ncol or ORANGE)
        rows.append(row)
    ty = table(s, 660, 150, cols, header, rows, pitch=30, font=11, hdr_h=32)

    # TBD rails note
    fy = ty + 18
    s.text(660, fy, "POWER RAILS — PDM CHANNEL TBD (orange): #INJ_PWR (16 AWG, 8x EV6 @ rail), "
                    "#COIL_PWR (16 AWG, 8x D510C @ bracket)", 11, fill=ORANGE, bold=True)
    s.text(660, fy + 18, "PDM-FED, CHANNEL NOT IN v4: #55 t-case ind · #56 neutral sw · #57 reverse sw · "
                         "#71 Dakota cluster · #94 fuel pump rly · #95 iBooster rly", 10, fill=ORANGE)
    s.text(660, fy + 36, "Stale 2026-04-13 spec channel map (E-Stopp ch7/8, QTP cutouts, keypad ch30) superseded "
                         "by the 2026-04-05 authoritative plan above.", 9.5, fill=GRAY)

    title_block(s, 4, "CHANNELS: K5_pdm30_channel_plan.md (2026-04-05). PINS: PDM30 datasheet Part 14103. WIRES: K5_cut_list_v4.")
    write("K5_connector_PDM30.svg", s)


# ----------------------------------------------------------------------------- main
if __name__ == "__main__":
    wires = parse_cut_list_v4(CUT_LIST)
    for wid, ov in PARSE_OVERRIDES.items():
        cur = wires.get(wid, {})
        bad = (not cur or cur.get("awg") in (None, "?") or cur.get("color") in (None, "?")
               or len(cur.get("from", "")) > 14)
        if bad:
            ov = dict(ov, id=wid)
            wires[wid] = ov
    # integrity: every wire referenced by the bulkhead must exist
    needed = set(SEED_KEEP.values()) | {w for w, _ in FILLS} | {w for w, _ in OVERFLOW}
    missing = [w for w in needed if w not in wires]
    assert not missing, f"cut-list parse missing wires: {missing}"

    assigned, spare = sheet_bulkhead(wires)
    sheet_m130("A", M130A, [9, 8, 8, 9], 2, "K5_connector_M130A.svg")
    sheet_m130("B", M130B, [7, 6, 6, 7], 3, "K5_connector_M130B.svg")
    sheet_pdm()

    used = sum(1 for c in CAV_ORDER if c in assigned)
    print(f"bulkhead: {used}/61 used, {len(spare)} spare, {len(OVERFLOW)} overflow, "
          f"{len(DIRECT_FEED)} direct-feed rows")
