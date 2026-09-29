#!/usr/bin/env python3
"""power_v5.py — the DC primary section of the K5 harness manual, drawn from k5_registry.json.

Owner 2026-09-28: "id like to see the dc wiring primary... theres a lot missing"; 2026-09-27: "we need to know the
wiring schematic as priority. theres always a work around except if we forget to run a wire in the loom".
Pages (all data from the wire rows, their termination rows, catalog/endpoints.yaml and catalog/parts.yaml; the
drawing positions are this file's, the facts are the rows'):
  sheet  DC primary — batteries, isolator, distribution, charging, starting   (tabloid, GM booklet run style)
  sheet  Ground distribution — the three banks, the head ring, G1–G3, shield drains
  page   Power distribution — every PDM30 / PDM15 output (one or two pages)
  page   Protection — every fuse and every unfused primary
  page   Main cable schedule — every cable 8 AWG and heavier
A fact the rows do not carry prints as OPEN (orange) with what closes it. No purchase state, no prices.
Run standalone: python3 power_v5.py  (numbers from 1, into docs/wiring/output/manual/K5_power_<n>_<slug>.*)
"""
import json
import re
import subprocess
import sys
from collections import OrderedDict
from pathlib import Path

import yaml

CD = Path(__file__).resolve().parent
sys.path.insert(0, str(CD))
import kits_v5                                          # noqa: E402
import diagram_v5                                       # noqa: E402
import manual_v5                                        # noqa: E402
from diagram_v5 import wire_colours, tag_id, ORANGE, MAP_URL   # noqa: E402,F401
from manual_v5 import gm_colour, tw, FONT, PRODUCT_IMAGES      # noqa: E402

OUT = Path(__import__("os").environ.get("K5_BOOK_OUT") or CD.parent / "output" / "manual")   # K5_BOOK_OUT: build elsewhere
FIGS = CD.parent / "output" / "manual" / "figures"                   # the twin figures stay where figures_v5 wrote them
SW_, SH_, SM = diagram_v5.W, diagram_v5.H, diagram_v5.M        # tabloid landscape
PW, PH, PM = manual_v5.W, manual_v5.H, manual_v5.M              # US letter
SECTION = "DC Primary"
HEAVY = 4                                               # 4 AWG and heavier draw thick
BUY_WORDS = re.compile(r"\s*\b(when carted|carted|in the cart|cart\w*|lined up[^;,.]*|buy\w*|bought|order\w*|price\w*)\b|\s*\$[\d,.]+", re.I)


# ------------------------------------------------------------------ data
def load():
    reg, wires, ends = diagram_v5.load()
    eps_y = __import__("kits_v5")._y("endpoints.yaml")
    parts = yaml.safe_load((CD / "catalog" / "parts.yaml").read_text())
    return reg, wires, ends, eps_y, parts


def clean(s):
    """Endpoint 'open' text is written for the kits report; the book never carries purchase words (owner 2026-09-28)."""
    s = BUY_WORDS.sub("", str(s))
    s = re.sub(r"\(state[^)]*\)|\bstate §?\d+\w*|chapters/\S+|\S+\.(?:md|ya?ml|py|txt|json|pdf)\b", "", s)
    s = re.sub(r"\bUNKNOWN\b", "not on file", s)
    s = re.sub(r"\s+([:;,])", r"\1", s)
    return re.sub(r"\s{2,}", " ", s).strip(" :;,—-")


def awg_num(w):
    a = str(w.get("awg") or "")
    if "/" in a:
        return -int(a.split("/")[0]) + 1               # 1/0 -> 0, 2/0 -> -1
    try:
        return int(a)
    except ValueError:
        return 99


def end_text(v):
    if isinstance(v, dict):
        return f"{v.get('device') or ''} {v.get('pin') or ''}".strip()
    return str(v or "")


def fuse_of(w):
    """(kind, amps or None, text) from the wire's own from/to words: 'MEGA 125 A', 'MIDI 40 A', '10 A fuse', 'via MEGA'."""
    for side in ("frm", "to"):
        t = end_text(w.get(side))
        m = re.search(r"\b(MEGA|MIDI)\b(?:\s*(\d+)\s*A)?", t)
        if m:
            return m.group(1), (int(m.group(2)) if m.group(2) else None), side
        m = re.search(r"(\d+)\s*A fuse", t)
        if m:
            return "", int(m.group(1)), side
        if re.search(r"kit harness fuse", t):
            return "kit fuse", None, side
    return None


def plabel(w):
    """GM run label, 'gauge colour-circuit · length'. A wire with no colour set prints gauge and circuit only."""
    col = gm_colour(str(w.get("color") or "")).upper().replace("CABLE", "SHLD")
    L = w.get("length_ft")
    basis = str(w.get("length_basis") or "").lower()
    if L:
        tag = "" if re.search(r"measur|bench", basis) else " EST"
        ln = f"{L:.1f} FT{tag}"
    else:
        ln = "LENGTH OPEN"
    col = "" if re.fullmatch(r"[?\s]*", col or "") else col
    numbered = bool(re.fullmatch(r"\d+[A-Za-z]?", str(w["id"])))
    wid = str(w["id"]).upper()
    head = f"{col}-{wid}" if col else wid          # the circuit id always; never '?-'
    return " ".join(x for x in (awg_word(w), head) if x) + f" · {ln}"


def awg_word(w):
    """The gauge as printed: a kit's own lead says so; a missing gauge is OPEN, never 'None'."""
    g = manual_v5.gauge_word(w)                    # the wire list's gauge field: one cable, one gauge on every page
    if g != "?":
        return g
    return "KIT LEAD" if "kit" in str(w.get("spec") or "").lower() else "AWG OPEN"


class Notes:
    """Lettered OPEN notes: the same fact gets the same letter wherever it is stamped."""
    def __init__(self):
        self.items = OrderedDict()

    def tag(self, text):
        text = clean(text)
        if text not in self.items:
            self.items[text] = chr(97 + len(self.items)) if len(self.items) < 26 else f"a{len(self.items) - 25}"
        return self.items[text]

    def group(self, key, prefix, item):
        """One letter for many ends with the same gap; the note lists them all."""
        self.groups = getattr(self, "groups", OrderedDict())
        if key not in self.groups:
            self.groups[key] = [prefix, []]
            self.items[("group", key)] = chr(97 + len(self.items))
        if item not in self.groups[key][1]:
            self.groups[key][1].append(item)
        return self.items[("group", key)]

    def listed(self):
        out = []
        for text, letter in self.items.items():
            if isinstance(text, tuple):
                pre, its = self.groups[text[1]]
                text = f"{pre}: " + "; ".join(its)
            out.append((text, letter))
        return out


def ps_lugs(eps_y, wid, w):
    """(lug at frm, lug at to) from the stud lists (PS-STUDS, PDM30-STUD, PDM15-STUD); None where the list has none."""
    frm, to = None, None
    lugs = (eps_y.get("PS-STUDS") or {}).get("lugs", {}).get(str(wid))
    if lugs:
        if len(lugs) >= 2:
            frm, to = lugs[0], lugs[1]
        else:
            stud_side = "frm" if re.search(r"PS-STUDS|GND-BANK-ENG|[Dd]istribution stud", end_text(w.get("frm"))) else "to"
            frm, to = (lugs[0], None) if stud_side == "frm" else (None, lugs[0])
    for code, rx in (("PDM30-STUD", r"PDM30:STUD|PDM30 battery stud"), ("PDM15-STUD", r"PDM15:STUD|PDM15 battery stud")):
        lug = ((eps_y.get(code) or {}).get("lugs") or {}).get(str(wid))
        if lug:
            if re.search(rx, end_text(w.get("frm"))):
                frm = lug
            else:
                to = lug
    # every other end: the lug its termination row names (its part, or a lug from the endpoint's kit that the row's
    # cavity text names) — the same source on every page (review round 3: 1-49 said 210LTP, 1-53 said OPEN)
    for t in _term_rows().get(str(wid), []):
        lug = term_lug(t, eps_y)
        if not lug:
            continue
        e = t["endpoint"]
        if frm is None and e in end_text(w.get("frm")):
            frm = lug
        elif to is None and e in end_text(w.get("to")):
            to = lug
    return frm, to


_TERMS = None


def _term_rows():
    global _TERMS
    if _TERMS is None:
        _TERMS = {}
        for t in json.load(open(CD / "k5_registry.json"))["terminations"]:
            _TERMS.setdefault(str(t["wire"]), []).append(t)
    return _TERMS


def term_lug(t, eps_y):
    """The lug at one termination: a lug part on the row, else the one lug of the endpoint's kit the cavity text names."""
    parts_y = _parts()
    for code in str(t.get("part") or "").split(" + "):
        if (parts_y.get(code) or {}).get("kind") == "lug":
            return code
    kit = (eps_y.get(t["endpoint"]) or {}).get("kit") or {}
    for code in kit:
        if (parts_y.get(str(code)) or {}).get("kind") == "lug" and str(code) in str(t.get("cavity") or ""):
            return str(code)
    return None


_PARTS = None


def _parts():
    global _PARTS
    if _PARTS is None:
        _PARTS = yaml.safe_load((CD / "catalog" / "parts.yaml").read_text()) or {}
    return _PARTS


def term_part(ends, wid, endpoint):
    for t in ends.get(str(wid), []):
        if t["endpoint"] == endpoint:
            p = str(t.get("part") or "")
            if not p or p.startswith("open"):
                return None, t.get("cavity")
            if p == "RING-SMALL":
                return "RING", t.get("cavity")
            return p, t.get("cavity")
    return None, None


# ------------------------------------------------------------------ drawing helpers (tabloid sheets)
class PSheet(diagram_v5.Sheet):
    """diagram_v5.Sheet with the DC primary header. Text and strokes drawn while a wire is being drawn belong to that
    wire (cur_owner), so the struck-text lint lets a label sit on its own run and flags it on anyone else's."""
    def __init__(self, number, title, subtitle):
        self.cur_owner = None
        super().__init__(number, title, subtitle, head="DC PRIMARY")

    def txt(self, x, y, s, size, bold=False, anchor="start", italic=False, colour="#000", href=None, owner=None):
        super().txt(x, y, s, size, bold=bold, anchor=anchor, italic=italic, colour=colour, href=href,
                    owner=owner if owner is not None else self.cur_owner)

    def line(self, pts, w=0.8, dash=None, colour="#000", stripe=None, owner=None):
        super().line(pts, w, dash, colour=colour, stripe=stripe, owner=owner if owner is not None else self.cur_owner)

    def fuse(self, x, y, value, is_open):
        """GM fuse symbol: a small box on the run with the element through it; value printed under it."""
        self.el.append(f'<rect x="{x - 8:.1f}" y="{y - 3.2:.1f}" width="16" height="6.4" fill="#fff" stroke="#000" stroke-width="0.9"/>')
        self.el.append(f'<path d="M{x - 8:.1f},{y:.1f} C{x - 4:.1f},{y - 3:.1f} {x + 4:.1f},{y + 3:.1f} {x + 8:.1f},{y:.1f}" fill="none" stroke="#000" stroke-width="0.8"/>')
        self.txt(x, y + 9.5, value, 4.8, bold=True, anchor="middle", colour=ORANGE if is_open else "#000")

    def image(self, x, y, w, h, path):
        import base64
        data = base64.b64encode(Path(path).read_bytes()).decode()
        self.el.append(f'<image x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,{data}"/>')


def pbox(s, reg, node, x, w, title, rows, code=None, note=None):
    """A device box. rows: [(y, mark, text, side)] — one row per wire end, pins on 'L' or 'R' (or 'LR').
    Returns {row index: (x_left, x_right, y)}. The title links to the plug's card on the truck's map."""
    ys = [r[0] for r in rows]
    top, bot = min(ys) - 9, max(ys) + 9
    s.rect(x, top, w, bot - top, sw=1.0, rx=3)
    href = (MAP_URL + code) if code and code in reg["endpoints"] else None
    s.txt(x + w / 2, top - 3, title.upper(), 6.2, bold=True, anchor="middle", href=href)
    if note:
        s.txt(x + w / 2, bot + 7, note, 4.8, anchor="middle", italic=True, colour="#333")
    pins = {}
    for i, (y, mark, text, side) in enumerate(rows):
        mw = max(9, tw(mark, 5.0, True) + 4)
        if "R" in side:
            s.rect(x + w - mw - 2, y - 3.4, mw, 6.8, sw=0.6, fill="#fff")
            s.txt(x + w - 2 - mw / 2, y + 2.0, mark, 5.0, bold=True, anchor="middle")
        if "L" in side:
            s.rect(x + 2, y - 3.4, mw, 6.8, sw=0.6, fill="#fff")
            s.txt(x + 2 + mw / 2, y + 2.0, mark, 5.0, bold=True, anchor="middle")
        tx = x + (mw + 6 if "L" in side else 4)
        room = w - (mw + 6) - (mw + 6 if "R" in side else 4) - (2 if "L" in side else 0)
        if text:
            s.txt(tx, y + 2.0, diagram_v5.fit(text, room, 5.0), 5.0)
        pins[i] = (x, x + w, y)
    return pins


def run(s, pts, w):
    base, stripe = wire_colours(w) if w.get("color") else ("#444444", None)
    s.line(pts, 3.0 if awg_num(w) <= HEAVY else 1.3, None, colour=base, stripe=stripe)


def end_tag(s, x, y, text, is_open, anchor="start"):
    s.txt(x, y + 6.8, text, 4.6, anchor=anchor, colour=ORANGE if is_open else "#000", italic=is_open)


# ------------------------------------------------------------------ sheet A: DC primary
# Node -> endpoint code for the map link and the termination rows
NODE_EP = {"ODY": "ODYSSEY", "ACC": "ACC-BATT", "ISO": "ISOLATOR", "DIST": "PS-STUDS", "START": "STARTER-S",
           "ALT": "ALTERNATOR-SENSE", "PDM15": "PDM15-A", "PDM30": "PDM30-B", "IBOOST": "IBOOSTER", "PCS": None, "STEP": "AMP-STEP-CTRL",
           "DCDC": "DCDC", "AMP": "AMP", "SW": "ISO-SWITCH", "M130": "M130-B", "STRIP": "FIREWALL-BODY-B", "STAR": "GND-BANK-ENG"}
RESOLVE = [                                             # (regex over an end's words, node) — first match wins
    (r"isolator stud A", "ISO:A"), (r"isolator stud B", "ISO:B"),
    (r"^ODYSSEY \(\+, 10 A", "ODY:+10"), (r"^ODYSSEY \(\+, 5 A", "ODY:+5"), (r"^ODYSSEY \(\+", "ODY:+"), (r"^ODYSSEY \(-", "ODY:-"),
    (r"^ACC-BATT \(\+", "ACC:+"), (r"^ACC-BATT \(-", "ACC:-"),
    (r"^DCDC \(IN", "DCDC:IN"), (r"^DCDC \(OUT", "DCDC:OUT"), (r"^DCDC \(-", "DCDC:-"),
    (r"starter B\+", "START:B+"), (r"STARTER-S", "START:S"), (r"alternator B\+", "ALT:B+"), (r"ALTERNATOR-SENSE", "ALT:L"),
    (r"PDM30:STUD", "PDM30:STUD"), (r"PDM15 battery stud", "PDM15:STUD"), (r"PDM15:OUT(\d+)", "PDM15:OUT"),
    (r"PDM30[: ]B6\b|PDM30:OUT24", "PDM30:OUT24"), (r"[Dd]istribution stud", "DIST:"), (r"^IBOOSTER", "IBOOST:1"),
    (r"PCS harness B\+|^PCS-TCM \(12 V battery\)", "PCS:B+"), (r"AMP-STEP-CTRL", "STEP:+"), (r"^AMP ", "AMP:+"), (r"AMP-BLOCK", "AMP:+"), (r"^ISOLATOR \((\w+)", "ISO:ctl"), (r"^ISO-SWITCH", "SW:"), (r"^SPL-ISO-YEL", "SW:"),
    (r"^M130:(\w+)", "M130:"), (r"GND-BANK-ENG", "STAR:"), (r"COIL_GND_STAR_ECM_HEAD|COIL-GROUND-RINGS|head ring|ring on the head", "HEAD:"),
]


def resolve(text):
    for rx, node in RESOLVE:
        if re.search(rx, text):
            return node.split(":")[0]
    return None


def sheet_a_wires(reg, wires, eps_y):
    """Every wire of the DC primary: the battery, isolator, switch, charger and stud endpoints, every cable whose words
    name the distribution stud, and the M130 lifelines (power from PDM30 OUT24, both grounds, the isolator shutdown)."""
    ids = OrderedDict()
    for code in ("ODYSSEY", "ACC-BATT", "ISOLATOR", "ISO-SWITCH", "DCDC", "PS-STUDS", "PDM30-STUD", "PDM15-STUD",
                 "STARTER-S", "ALTERNATOR-SENSE"):
        ep = reg["endpoints"].get(code) or eps_y.get(code) or {}
        for wid in (ep.get("wires") or []) if isinstance(ep.get("wires"), list) else []:
            w = wires.get(str(wid)) or {}
            if code in ("PDM30-STUD", "PDM15-STUD") and None in (resolve(end_text(w.get("frm"))), resolve(end_text(w.get("to")))):
                continue      # a small tap off a PDM stud to a plug of another sheet (DAK_CONST): drawn on that plug's sheet
            ids[str(wid)] = 1
        for wid in (ep.get("pins") or {}):
            ids[str(wid)] = 1
    for wid, w in wires.items():
        if re.search(r"[Dd]istribution stud", end_text(w.get("frm")) + " " + end_text(w.get("to"))):
            ids[wid] = 1
    for wid in ("ECU_PWR", "ECU_GND1", "ECU_GND2", "ISO_KILL"):
        ids[wid] = 1
    # ground returns that belong to sheet B (block, frame, strap, cab return) are drawn there, not here
    for wid in ("G1", "G2", "G3", "GND_RET_CAB", "AMP_GND", "IBOOST_GND"):
        ids.pop(wid, None)
    return [w for w in ids if w in wires]


P = 22                                                   # row pitch on sheet A
# (node, wire) -> (row y, mark, side). The drawing's positions; every wire the rows put on this sheet must have one.
LAYOUT_A = {
    ("ODY", "63"): (120, "+", "R"), ("ODY", "ISO_PWR"): (142, "+", "R"), ("ODY", "ISO_SW_PWR"): (164, "+", "L"),
    ("ODY", "ODY_NEG"): (186, "−", "R"),
    ("ISO", "63"): (120, "A", "L"), ("ISO", "ISO_OUT"): (142, "B", "R"), ("ISO", "ISO_PWR"): (164, "RED", "L"),
    ("ISO", "ISO_GND"): (186, "BLK", "R"), ("ISO", "ISO_CLOSE"): (208, "BRN", "R"), ("ISO", "ISO_OPEN"): (230, "ORN", "R"),
    ("ISO", "ISO_LED"): (252, "YEL", "R"),
    ("DIST", "ISO_OUT"): (142, "IN", "L"), ("DIST", "6"): (164, "1", "R"), ("DIST", "59"): (186, "2", "R"),
    ("DIST", "PDM15_BPOS"): (208, "3", "R"), ("DIST", "52"): (230, "4", "R"), ("DIST", "PCS_BATT"): (252, "5", "R"),
    ("DIST", "PDM_BPOS"): (274, "6", "R"), ("DIST", "DCDC_IN"): (296, "7", "R"), ("DIST", "3"): (318, "8", "R"),
    ("DIST", "IBOOST_PERM"): (340, "9", "R"),
    ("STEP", "3"): (576, "RED", "L"),
    ("START", "6"): (164, "B+", "L"), ("START", "START_TRIG"): (186, "S", "R"),
    ("ALT", "59"): (224, "B+", "L"), ("ALT", "ALT_L"): (246, "L", "R"),
    ("PDM15", "PDM15_BPOS"): (284, "C1", "L"), ("PDM15", "ALT_L"): (306, "A2", "R"), ("PDM15", "START_TRIG"): (328, "A7+A16", "R"),
    ("IBOOST", "52"): (366, "1", "L"), ("IBOOST", "IBOOST_PERM"): (384, "17", "L"), ("PCS", "PCS_BATT"): (410, "B+", "L"),
    ("PDM30", "PDM_BPOS"): (438, "C1", "L"), ("PDM30", "ECU_PWR"): (460, "B6", "R"),
    ("DCDC", "DCDC_IN"): (498, "IN+", "L"), ("DCDC", "DCDC_OUT"): (520, "OUT+", "L"), ("DCDC", "DCDC_GND"): (542, "−", "L"),
    ("ACC", "DCDC_OUT"): (520, "+", "R"), ("ACC", "32"): (542, "+", "R"), ("ACC", "ACC_NEG"): (564, "−", "R"),
    ("AMP", "32"): (542, "+12V", "L"),
    ("M130", "ECU_PWR"): (460, "A26", "L"), ("M130", "ISO_KILL"): (482, "B14", "L"),
    ("M130", "ECU_GND1"): (504, "A10", "R"), ("M130", "ECU_GND2"): (526, "A11", "R"),
    ("STRIP", "ISO_CLOSE"): (612, "9", "LR"), ("STRIP", "ISO_OPEN"): (628, "10", "LR"), ("STRIP", "ISO_LED"): (644, "11", "LR"),
    ("STRIP", "ISO_SW_PWR"): (660, "12", "LR"),
    ("SW", "ISO_CLOSE"): (612, "3", "L"), ("SW", "ISO_OPEN"): (628, "1", "L"), ("SW", "ISO_LED"): (644, "7", "L"),
    ("SW", "ISO_SW_PWR"): (660, "2+8", "L"), ("SW", "ISO_KILL"): (644, "7", "R"),
}
COLS_A = {"ODY": (50, 120), "ACC": (50, 120), "ISO": (290, 120), "AMP": (290, 120), "DIST": (520, 110),
          "START": (860, 120), "ALT": (860, 120), "PDM15": (860, 120), "IBOOST": (860, 120), "PCS": (860, 120),
          "PDM30": (860, 120), "DCDC": (860, 120), "STEP": (860, 120), "M130": (1066, 110), "STRIP": (640, 44), "SW": (860, 120)}


def label_lines(s, x0, y, text, width, size=5.0):
    """A row label wrapped onto lines centred on its run (never cut short)."""
    lines = manual_v5.wrap_text(text, width, size)
    for k, ln in enumerate(lines):
        s.txt(x0, y + 1.8 + (k - (len(lines) - 1) / 2) * (size + 0.7), ln, size)


def sheet_dc_primary(reg, wires, ends, eps_y, parts, number, next_sheet):
    notes = Notes()
    wids = sheet_a_wires(reg, wires, eps_y)
    # which node each end of each wire lands on (from the wire's own words; the switch leads also pass bulkhead B)
    conn = OrderedDict()
    for wid in wids:
        w = wires[wid]
        a, b = resolve(end_text(w.get("frm"))), resolve(end_text(w.get("to")))
        if a is None or b is None:
            raise SystemExit(f"DC primary: cannot place wire {wid}: {w.get('frm')} -> {w.get('to')}")
        nodes = [a, b]
        if any(t["endpoint"] == "FIREWALL-BODY-B" for t in ends.get(wid, [])):
            nodes = [a, "STRIP", b]
        conn[wid] = nodes
    missing = [(n, wid) for wid, ns in conn.items() for n in ns if n not in ("STAR", "HEAD") and (n, wid) not in LAYOUT_A]
    if missing:
        raise SystemExit(f"DC primary: rows with no place on the sheet: {missing}")

    s = PSheet(number, "DC primary — batteries, isolator, distribution, charging, starting",
               f"{len(wids)} circuits from the wire list · label = gauge colour-circuit · length · heavy line = 4 AWG and heavier · "
               f"part under each end = its lug or terminal · orange = OPEN, lettered notes at the foot")
    s.txt(SW_ / 2, SM + 40, "CABLES SIZED FROM PHYSICS (cable_sizing_v5): 2 AWG M22759/16 THROUGHOUT THE SPINE; 2×2 AWG IN PARALLEL, EQUAL LENGTH, EACH IN ITS OWN SLEEVE "
          "WHERE ONE CABLE CANNOT CARRY THE FUSE — SEE THE CABLE SCHEDULE", 6.0, bold=True, anchor="middle")

    # ---- boxes
    titles = {"ODY": "Odyssey — running battery", "ACC": "YellowTop — accessory battery",
              "ISO": "isolator — Blue Sea 7700 ML-RBS", "DIST": "distribution stud — Blue Sea 2019",
              "START": "starter", "ALT": "alternator — Holley 197-302", "PDM15": "engine PDM15",
              "IBOOST": "iBooster", "PCS": "PCS TCM-2650 (transmission)", "PDM30": "body PDM30 (cab)",
              "DCDC": "DC-DC charger — Victron Orion-Tr 12/12-30", "AMP": "amp reducing block, 2 to 4 AWG (JL VX700/5i beyond)",
              "M130": "MoTeC M130", "STRIP": "body bulkhead B", "SW": "dash switch — Blue Sea 2145",
              "STEP": "AMP Research step controller"}
    box_notes = {"ISO": "studs A/B 3/8-16, 140 in-lb max · 1,000 A 30 s cranking on 2/0",
                 "DIST": "2 × 3/8 in studs · holders: MEGA M8, MIDI M5",
                 "PDM15": "C1 = M6 battery stud · 80 A total", "PDM30": "C1 = M6 battery stud · 100 A total",
                 "SW": "momentary: tap ON closes, OFF opens · LED lit = closed", "STRIP": "DT 12-way, B key"}
    text_for = {
        "ODY": {"63": "post, to isolator", "ISO_PWR": "fused tap, 24 h", "ISO_SW_PWR": "fused tap, 24 h", "ODY_NEG": "post"},
        "ACC": {"DCDC_OUT": "post, charge in", "32": "post, amp feed", "ACC_NEG": "post"},
        "ISO": {"63": "stud A, battery", "ISO_OUT": "stud B, load", "ISO_PWR": "24 h power", "ISO_GND": "ground",
                "ISO_CLOSE": "+12 V to close", "ISO_OPEN": "+12 V to open", "ISO_LED": "LED output"},
        "DIST": {"ISO_OUT": "from isolator B", "6": "starter", "59": "alternator", "PDM15_BPOS": "engine PDM15",
                 "52": "iBooster", "PCS_BATT": "PCS TCM", "PDM_BPOS": "body PDM30", "DCDC_IN": "DC-DC charger",
                 "3": "power steps", "IBOOST_PERM": "iBooster (2nd feed)"},
        "START": {"6": "battery stud", "START_TRIG": "solenoid S"}, "ALT": {"59": "B+ stud", "ALT_L": "L lead (197-400)"},
        "PDM15": {"PDM15_BPOS": "battery +", "ALT_L": "OUT9", "START_TRIG": "OUT4"},
        "IBOOST": {"52": "constant 12 V", "IBOOST_PERM": "second always-hot, 5 A"}, "PCS": {"PCS_BATT": "constant 12 V"},
        "PDM30": {"PDM_BPOS": "battery +", "ECU_PWR": "OUT24, on in RUN"}, "STEP": {"3": "red lead, +12 V"},
        "DCDC": {"DCDC_IN": "input +", "DCDC_OUT": "output +", "DCDC_GND": "negative"}, "AMP": {"32": "power"},
        "M130": {"ECU_PWR": "battery +", "ISO_KILL": "UDIG7 shutdown", "ECU_GND1": "battery − 1", "ECU_GND2": "battery − 2"},
        "STRIP": {}, "SW": {"ISO_CLOSE": "CLOSE", "ISO_OPEN": "OPEN", "ISO_LED": "LED ground", "ISO_SW_PWR": "common + LED"},
    }
    pin_at = {}
    for node, (x, w) in COLS_A.items():
        rows = [(y, mark, text_for.get(node, {}).get(wid, ""), side, wid)
                for (n, wid), (y, mark, side) in LAYOUT_A.items() if n == node and wid in conn]
        rows.sort()
        if not rows:
            continue
        pins = pbox(s, reg, node, x, w, titles[node], [r[:4] for r in rows], NODE_EP.get(node), box_notes.get(node))
        for i, r in enumerate(rows):
            pin_at[(node, r[4])] = pins[i]

    # ---- the part at each end of a wire, and whether it is OPEN (with its letter)
    def part_at(wid, node, side_word):
        w = wires[wid]
        f_lug, t_lug = ps_lugs(eps_y, wid, w)
        lug = f_lug if side_word == "frm" else t_lug
        if lug and str(lug) == "RING-SMALL":
            return f"ring · OPEN {notes.tag('small ring terminals carry no part number (stud size and gauge not set)')}", True
        if lug:
            if str(lug) == "DL214" and awg_num(w) != 2:
                g = awg_word(w)
                return f"DL214 · OPEN {notes.tag(f'{wid}: the DL214 in the stud list is a 2 AWG lug, the cable is {g} AWG; closes with a lug for that gauge on an M6 stud')}", True
            return str(lug), False
        code = NODE_EP.get(node)
        if node == "M130":
            code = "M130-A" if any(t["endpoint"] == "M130-A" for t in ends.get(wid, [])) else "M130-B"
        if node == "PDM30" and wid == "ECU_PWR":
            code = "PDM30-B"
        part, _cav = term_part(ends, wid, code) if code else (None, None)
        if part == "RING":
            return f"ring · OPEN {notes.tag('small ring terminals carry no part number (stud size and gauge not set)')}", True
        if part:
            return part, False
        ep = reg["endpoints"].get(code or "", {})
        why = [clean(o) for o in (ep.get("open") or []) if clean(o)]
        why = [x for x in why if re.search(r"terminal|post|tap|holder|model|tray|pigtail|pin-out|harness", x, re.I)]
        if code and not any(t["endpoint"] == code for t in ends.get(wid, [])):
            return f"OPEN {notes.group('noterm', 'no termination row at this end, though the wire row names it; closes with the lug or terminal row', wid + ' at the ' + titles.get(node, node).split(' — ')[0])}", True
        if why:
            reason = f"{titles.get(node, node).split(' — ')[0]}: " + "; ".join(why[:2])
        else:
            reason = f"{titles.get(node, node).split(' — ')[0]} terminal part not named"
        return f"OPEN {notes.tag(reason)}", True

    def fuse_mark(wid):
        f = fuse_of(wires[wid])
        if not f:
            return None
        kind, amps, side = f
        if amps is None:
            return f"{kind} · OPEN {notes.tag(fuse_open_note(wid, kind, parts))}", True, side
        return f"{kind + ' ' if kind else ''}{amps} A", False, side

    # ---- runs
    count = {"cables": 0, "fuses": 0, "grounds": 0}
    lane_x = {"59": 842, "PDM15_BPOS": 826, "52": 810, "PCS_BATT": 794, "PDM_BPOS": 778, "DCDC_IN": 762, "3": 746, "IBOOST_PERM": 730,
              "ISO_CLOSE": 470, "ISO_OPEN": 458, "ISO_LED": 446, "ISO_PWR": 236, "ALT_L": 1012, "START_TRIG": 1030, "ISO_KILL": 1058}
    for wid, nodes in conn.items():
        w = wires[wid]
        s.cur_owner = wid
        lab = plabel(w)
        count["cables"] += 1
        fz = fuse_mark(wid)
        a, b = nodes[0], nodes[-1]
        if b in ("STAR", "HEAD"):                      # a return: stub, ground symbol, the bank it lands on
            xl, xr, y = pin_at[(a, wid)]
            side = LAYOUT_A[(a, wid)][2]
            p_a, o_a = part_at(wid, a, "frm")
            p_b, o_b = part_at(wid, "STAR", "to") if b == "STAR" else (f"OPEN {notes.tag(head_ring_note())}", True)
            dest = f"to ground star (sheet {next_sheet})" if b == "STAR" else f"to head ring (sheet {next_sheet})"
            if a == "M130":
                run(s, [(xr, y), (xr + 10, y)], w)
                s.ground(xr + 10, y)
                k = ["ECU_GND1", "ECU_GND2"].index(wid) if wid in ("ECU_GND1", "ECU_GND2") else 0
                yy = 546 + k * 16
                s.txt(xl, yy, f"{LAYOUT_A[(a, wid)][1]}: {lab}", 4.8)
                s.txt(xl, yy + 6.6, f"{dest} · {p_b}", 4.6, italic=True, colour=ORANGE if o_b else "#333")
            elif side == "R":
                run(s, [(xr, y), (xr + 20, y)], w)
                s.ground(xr + 20, y)
                s.txt(xr + 4, y - 1.8, lab, 4.8)
                s.txt(xr + 28, y + 3.4, dest, 4.6, italic=True, colour="#333" if b == "STAR" else ORANGE)
                s.txt(xr + 28, y + 9.6, f"bank end: {p_b}", 4.6, italic=o_b, colour=ORANGE if o_b else "#000")
            else:
                run(s, [(xl, y), (xl - 20, y)], w)
                s.ground(xl - 20, y)
                s.txt(xl - 4, y - 1.8, lab, 4.8, anchor="end")
                s.txt(xl - 28, y + 3.4, f"{dest} · {p_b}", 4.6, italic=True, anchor="end", colour=ORANGE if o_b else "#333")
            count["grounds"] += 1
            continue
        pts_path = [pin_at[(n, wid)] for n in nodes]
        # choose the edge each end leaves from
        def edge(n, pin):
            xl, xr, y = pin
            side = LAYOUT_A[(n, wid)][2]
            return (xr if "R" in side and not (n == "STRIP") else xl, y, side)
        if len(nodes) == 3:                             # isolator / battery -> bulkhead B -> dash switch
            ax, ay, aside = edge(a, pts_path[0])
            sx_l, sx_r, sy = pts_path[1]
            bx, by, _ = edge(b, pts_path[2])
            if aside == "L":                            # the Odyssey tap leaves on the left and runs under the sheet
                lane = sy
                run(s, [(ax, ay), (SM + 4, ay), (SM + 4, lane), (sx_l, lane)], w)
                s.txt(SM + 40, lane - 1.8, lab, 4.8)
                s.txt(SM + 40 + tw(lab, 4.8) + 6, lane - 1.8, "runs under the sheet to bulkhead B", 4.6, italic=True, colour="#333")
                pa0, oa0 = part_at(wid, a, "frm")
                s.txt(SM + 40, lane + 6.8, f"battery end: {pa0}", 4.6, italic=oa0, colour=ORANGE if oa0 else "#000")
            else:
                xc = lane_x[wid]
                run(s, [(ax, ay), (xc, ay), (xc, sy), (sx_l, sy)], w)
                s.txt(xc + 4, sy - 1.8, lab, 4.8)
            run(s, [(sx_r, sy), (bx, by)], w)
            pa, oa = part_at(wid, a, "frm")
            if aside == "R":
                end_tag(s, ax + 3, ay, pa, oa)
            pb, ob = part_at(wid, b, "to")
            s.txt(bx - 3, by - 1.8, pb, 4.6, anchor="end", colour=ORANGE if ob else "#000", italic=ob)
            ps_, os_ = part_at(wid, "STRIP", "to")
            if os_:
                s.txt(sx_r + 3, sy - 1.8, ps_, 4.6, colour=ORANGE, italic=True)
            continue
        ax, ay, aside = edge(a, pts_path[0])
        bx, by, bside = edge(b, pts_path[1])
        pa, oa = part_at(wid, a, "frm")
        pb, ob = part_at(wid, b, "to")
        if aside == "L" and "R" in bside and bx < ax:   # the row runs load -> stud: draw it from the stud
            ax, ay, aside, bx, by, bside = bx, by, bside, ax, ay, aside
            pa, oa, pb, ob = pb, ob, pa, oa
        if wid in ("ALT_L", "START_TRIG"):              # engine PDM outputs up the right side to the solenoid / L lead
            xc = lane_x[wid]
            run(s, [(ax, ay), (xc, ay), (xc, by), (bx, by)], w)
            lx = max(lane_x["ALT_L"], lane_x["START_TRIG"]) + 6
            s.txt(lx, by + 2.0, lab, 4.8)
            end_tag(s, ax + 3, ay, pa, oa)
            s.txt(lx, by + 8.6, pb, 4.6, colour=ORANGE if ob else "#000", italic=ob)
        elif wid == "ISO_KILL":                         # switch pin 7 splice up to the M130 shutdown input
            xc = lane_x[wid]
            run(s, [(ax, ay), (xc, ay), (xc, by), (bx, by)], w)
            s.txt(ax + 4, ay - 1.8, lab, 4.8)
            end_tag(s, ax + 3, ay, f"{pa} · M130 end: {pb}", oa or ob)
        elif ay == by and bx < ax:                      # straight across, leaving to the left (charger -> YellowTop)
            run(s, [(ax, ay), (bx, by)], w)
            s.txt(ax - 4, ay - 1.8, lab, 4.8, anchor="end")
            end_tag(s, ax - 3, ay, pa, oa, anchor="end")
            end_tag(s, bx + 3, by, pb, ob)
        elif ay == by:                                  # straight across
            run(s, [(ax, ay), (bx, by)], w)
            s.txt(ax + 4, ay - 1.8, lab, 4.8)
            end_tag(s, ax + 3, ay, pa, oa)
            end_tag(s, bx - 3, by, pb, ob, anchor="end")
            if fz:
                fx = ax + 4 + tw(lab, 4.8) + 16
                s.fuse(fx, ay, fz[0], fz[1])
                count["fuses"] += 1
        else:
            xc = lane_x.get(wid, (ax + bx) / 2)
            run(s, [(ax, ay), (xc, ay), (xc, by), (bx, by)], w)
            s.txt(ax + 4, ay - 1.8, lab, 4.8)
            end_tag(s, ax + 3, ay, pa, oa)
            end_tag(s, bx - 3, by, pb, ob, anchor="end")
            if fz:
                fx = ax + 4 + tw(lab, 4.8) + 16
                s.fuse(fx, ay, fz[0], fz[1])
                count["fuses"] += 1
        if wid == "6":
            s.txt(ax + 4 + tw(lab, 4.8) + 8, ay - 1.8, "NO FUSE — cranking cable", 4.6, bold=True)
    s.cur_owner = None
    # ---- the Odyssey taps are fused at the post (their rows say '10 A fuse' / '5 A fuse')
    for wid in ("ISO_PWR", "ISO_SW_PWR"):
        if wid in conn:
            f = fuse_mark(wid)
            s.cur_owner = wid
            if f and (("ODY", wid) in pin_at):
                xl, xr, y = pin_at[("ODY", wid)]
                side = LAYOUT_A[("ODY", wid)][2]
                if side == "R":
                    continue                            # drawn on its run
                else:                                   # the switch feed leaves left and runs the foot lane
                    s.fuse(SM + 24, LAYOUT_A[("STRIP", wid)][0], f[0], f[1])
                count["fuses"] += 1

    s.cur_owner = None
    # ---- notes at the foot
    inl = OrderedDict()
    for wid in conn:
        pp_ = (wires[wid].get("protection_parts") or {})
        if pp_.get("holder") and pp_.get("fuse"):
            inl.setdefault((pp_["holder"], pp_["fuse"]), []).append(wid.upper())
    if inl:
        s.txt(SM, 680, "IN-LINE FUSES: " + " · ".join(f"{', '.join(v)}: holder {h}, fuse {f_}" for (h, f_), v in inl.items()), 5.6)
    s.txt(SM, 689, "NOTES — OPEN ITEMS ON THIS SHEET (each letter is stamped where it applies)", 6.2, bold=True)
    notes_foot(s, notes.listed(), 698, 5)
    s.txt(SM, SH_ - SM + 10, f"{count['cables']} circuits · {count['fuses']} fuses · {count['grounds']} returns to the banks (drawn in full on sheet {next_sheet}) · "
          f"{len(notes.items)} OPEN notes · a label with no colour = colour not yet set · lengths are estimates until measured on the truck", 6)
    s.footer = getattr(s, "footer", []) + [s.boxes[-1][4]]   # the sheet's own footer line
    return s, count, notes


def fuse_open_note(wid, kind, parts):
    if kind == "MEGA":
        pn = [p for p in parts.values() if isinstance(p, dict) and p.get("kind") == "fuse" and "alternator" in str(p.get("name"))]
        return (f"fuse value for {wid}: its row says MEGA with no rating; the parts list carries "
                f"{pn[0]['name'] if pn else 'no candidate'}; closes with the alternator's rated output")
    return f"fuse value for {wid}: its row says {kind} with no rating; closes when the value is read off the kit harness"


def head_ring_note():
    try:
        eps = __import__("kits_v5")._y("endpoints.yaml")
        op = [clean(o) for o in (eps.get("COIL-GROUND-RINGS") or {}).get("open") or [] if re.search(r"ground point|stud", str(o))]
        if op:
            return "head ring (16 coil grounds, the coil rail, M130 A10/A11): " + op[0]
    except Exception:
        pass
    return ("head ring: the 16 coil grounds, the coil rail and the M130 battery − pins A10/A11 end on a 'head ring terminal' with no stud, "
            "ring count or location named; closes when the ground point on the head is named with its ring part numbers")


def notes_foot(s, items, y0, ncol, size=4.9, lead=6.0):
    colw = (SW_ - 2 * SM) / ncol
    col, y = 0, y0
    for text, letter in items:
        lines = wrap_words(f"{letter}. {text}", colw - 10, size)
        if y + len(lines) * lead > SH_ - SM + 1:
            col, y = col + 1, y0
        if col >= ncol:
            raise SystemExit("sheet notes do not fit the foot")
        for i, ln in enumerate(lines):
            s.txt(SM + col * colw + (0 if i == 0 else 6), y, ln, size, colour=ORANGE if i == 0 else "#000")
            y += lead
        y += 1.0


def wrap_words(s, width, size):
    words, lines, cur = manual_v5.no_purchase(s).split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if tw(t, size) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


# ------------------------------------------------------------------ sheet B: ground distribution
def bank_rows(reg, wires, ends, eps_y, bank):
    """Every return landing on a bank: its endpoint list plus the stud-list cables whose words name the bank."""
    ids = OrderedDict((str(w), 1) for w in (reg["endpoints"].get(bank, {}).get("wires") or []))
    if bank == "GND-BANK-ENG":
        for wid in ((eps_y.get("PS-STUDS") or {}).get("wires") or []):
            w = wires.get(str(wid))
            if w and re.search(r"GND-BANK-ENG", end_text(w.get("frm")) + end_text(w.get("to"))):
                ids[str(wid)] = 1
    return [w for w in ids if w in wires]


def sheet_grounds(reg, wires, ends, eps_y, parts, number, prev_sheet):
    notes = Notes()
    s = PSheet(number, "Ground distribution — ground star, cab bank, rear bus, head ring",
               "grounds run in the loom to three banks; the ground star is the only place the harness meets the chassis · "
               "label = gauge colour-circuit · length · heavy line = 4 AWG and heavier · part at the bank = lug or ring")
    count = {"returns": 0, "OPEN": 0}
    ring_note = notes.tag("small ring terminals carry no part number: stud size and gauge per ring not set; the ring numbers are "
                          "positions on the bank")
    banks = [("GND-BANK-ENG", "ground star — engine bay, beside the batteries", 40),
             ("GND-BANK-CAB", "cab ground bank — insulated bus by the PDM30", 330),
             ("GND-SPLICE-REAR", "rear ground bus — where the rear harness branches", 620)]
    RP = 19.2
    bus_at = {}
    returns = {"GND_RET_CAB", "GND_RET_REAR"}
    for bank, title, x0 in banks:
        rows = [wid for wid in bank_rows(reg, wires, ends, eps_y, bank) if wid not in returns]
        if bank == "GND-BANK-ENG":                      # heavy lugs first (battery negatives, block, frame), then rings
            rows.sort(key=lambda wid: (awg_num(wires[wid]), wid) if awg_num(wires[wid]) <= 8 else (99, 0))
        bx = x0 + 262
        y0 = 118
        yN = y0 + (len(rows) - 1) * RP
        s.el.append(f'<line x1="{bx:.1f}" y1="{y0 - 8:.1f}" x2="{bx:.1f}" y2="{yN + 8:.1f}" stroke="#000" stroke-width="4"/>')
        s.txt(bx, y0 - 20, title.upper(), 6.2, bold=True, anchor="end", href=MAP_URL + bank)
        cap = reg.get("capacity", {}).get("resources", {}).get(f"ground bank {bank}", {})
        stud_note = notes.tag(f"{title.split(' — ')[0]}: stud count and bus part not set ({cap.get('used', len(rows))} ends land here)")
        s.txt(bx, y0 - 12, f"studs · OPEN {stud_note}", 4.8, anchor="end", italic=True, colour=ORANGE)
        for i, wid in enumerate(rows):
            w = wires[wid]
            s.cur_owner = wid
            y = y0 + i * RP
            far = w["frm"] if bank not in end_text(w.get("frm")) else w["to"]
            label_lines(s, x0, y, w.get("label") or wid, 118)
            run(s, [(x0 + 122, y), (bx, y)], w)
            s.txt(x0 + 124, y - 1.8, plabel(w), 4.8)
            f_lug, t_lug = ps_lugs(eps_y, wid, w)
            lug = t_lug if bank in end_text(w.get("to")) else f_lug
            part, cav = term_part(ends, wid, bank)
            if lug and str(lug) != "RING-SMALL":
                txt, op = str(lug), False
            elif part == "RING":
                txt, op = f"{cav or 'ring'} · OPEN {ring_note}", True
            elif part:
                txt, op = part, False
            else:
                txt, op = f"OPEN {notes.tag(f'{wid}: no end row at the bank')}", True
            s.txt(bx - 3, y + 6.6, txt, 4.6, anchor="end", colour=ORANGE if op else "#000", italic=op)
            # the far end: a chassis point for G1/G2, else the device (its own sheet)
            if wid in ("G1", "G2"):
                s.ground(x0 + 122, y)
            count["returns"] += 1
        s.cur_owner = None
        bus_at[bank] = (bx, y0, yN)
    # ---- the returns between banks, along the foot of the columns
    lane_y = {"GND_RET_CAB": 650, "GND_RET_REAR": 664}
    for wid, (src, dst) in (("GND_RET_CAB", ("GND-BANK-CAB", "GND-BANK-ENG")), ("GND_RET_REAR", ("GND-SPLICE-REAR", "GND-BANK-CAB"))):
        w = wires.get(wid)
        if not w:
            continue
        s.cur_owner = wid
        sx, _, sy = bus_at[src]
        dx, _, dy = bus_at[dst]
        ly = lane_y[wid]
        run(s, [(sx, sy + 8), (sx, ly), (dx, ly), (dx, dy + 8)], w)
        s.txt(dx + 8, ly - 1.8, plabel(w) + f" · {w.get('label')}", 4.8)
        f_lug, t_lug = ps_lugs(eps_y, wid, w)
        pa, ca = term_part(ends, wid, src)
        pb, cb = term_part(ends, wid, dst)
        ta = f_lug or (f"{ca} · OPEN {ring_note}" if pa == "RING" else pa)
        tb = t_lug or (f"{cb} · OPEN {ring_note}" if pb == "RING" else pb)
        s.txt(sx - 3, ly + 6.6, str(ta), 4.6, anchor="end", colour=ORANGE if "OPEN" in str(ta) else "#000")
        s.txt(dx + 8, ly + 6.6, str(tb), 4.6, colour=ORANGE if "OPEN" in str(tb) else "#000")
        count["returns"] += 1
    s.cur_owner = None
    # ---- head ring column
    x0 = 910
    hr = [str(w) for w in (reg["endpoints"].get("COIL-GROUND-RINGS", {}).get("wires") or [])]
    hr += [wid for wid, w in wires.items() if re.search(r"head ring|COIL_GND_STAR_ECM_HEAD|COIL-GROUND-RINGS", end_text(w.get("frm")) + " " + end_text(w.get("to"))) and wid not in hr]
    hr = [w for w in hr if w in wires]
    bx, y0 = x0 + 262, 118
    rp = 15.6
    yN = y0 + (len(hr) - 1) * rp
    s.el.append(f'<line x1="{bx:.1f}" y1="{y0 - 8:.1f}" x2="{bx:.1f}" y2="{yN + 8:.1f}" stroke="{ORANGE}" stroke-width="4" stroke-dasharray="6 3"/>')
    hn = notes.tag(head_ring_note())
    s.txt(bx, y0 - 20, "HEAD RING TERMINALS — ENGINE", 6.2, bold=True, anchor="end", href=MAP_URL + "COIL-GROUND-RINGS")
    s.txt(bx, y0 - 12, f"no stud, count or location · OPEN {hn}", 4.8, anchor="end", italic=True, colour=ORANGE)
    for i, wid in enumerate(hr):
        w = wires[wid]
        s.cur_owner = wid
        y = y0 + i * rp
        label_lines(s, x0, y, kits_v5.dave_name(w) if re.match(r"COIL\d", wid) else (w.get("label") or wid), 112)
        run(s, [(x0 + 116, y), (bx, y)], w)
        s.txt(x0 + 118, y - 1.8, plabel(w), 4.8)
        part, cav = term_part(ends, wid, "COIL-GROUND-RINGS")
        txt = f"ring · OPEN {ring_note}" if part == "RING" else f"OPEN {hn}"
        s.txt(bx - 3, y + 5.8, txt, 4.4, anchor="end", colour=ORANGE, italic=True)
        count["returns"] += 1
    # ---- G3: the engine-to-cab strap, on no bank
    s.cur_owner = "G3"
    w = wires.get("G3")
    gy = yN + 40
    if w:
        s.txt(x0, gy - 12, "G3 — ENGINE TO FIREWALL STRAP (ON NO BANK)", 6.2, bold=True)
        s.ground(x0 + 14, gy)
        run(s, [(x0 + 14, gy), (bx - 14, gy)], w)
        s.ground(bx - 14, gy)
        s.txt(x0 + 24, gy - 1.8, plabel(w), 4.8)
        f_lug, t_lug = ps_lugs(eps_y, "G3", w)
        s.txt(x0 + 24, gy + 7.0, f"engine head/block · {f_lug}", 4.6)
        s.txt(bx - 24, gy + 7.0, f"firewall bond stud · {t_lug}", 4.6, anchor="end")
        count["returns"] += 1
    s.cur_owner = None
    # ---- shield drains: the rule the rows state, and where each drain lands
    drains = [(wid, w) for wid, w in wires.items() if re.fullmatch(r"\d+s", wid)]
    dy = gy + 34
    s.txt(x0, dy, "SHIELD DRAINS — GROUNDED AT THE ECU END ONLY", 6.2, bold=True)
    s.txt(x0, dy + 9, "each drain floats at the sensor end (the rows' rule); lands on an M130 0 V pin:", 5.0, italic=True)
    for i, (wid, w) in enumerate(drains):
        pin = str(w.get("frm") or "").replace("M130:", "M130 ")
        s.txt(x0, dy + 19 + i * 8.4, f"{kits_v5.dave_name(w)} → {pin} (sensor 0 V)", 5.0)
        count["returns"] += 1
    # ---- notes
    s.txt(SM, 689, "NOTES — OPEN ITEMS ON THIS SHEET", 6.2, bold=True)
    notes_foot(s, notes.listed(), 698, 3)
    s.txt(SM, SH_ - SM + 10, f"{count['returns']} returns drawn · power returns and sensor 0 V stay separate · the DC primary sheet "
          f"{prev_sheet} carries the battery negatives in context · lengths are estimates until measured on the truck", 6)
    s.footer = getattr(s, "footer", []) + [s.boxes[-1][4]]   # the sheet's own footer line
    count["OPEN"] = len(notes.items)
    return s, count, notes


# ------------------------------------------------------------------ text pages (US letter)
class CPage(manual_v5.Page):
    """manual_v5.Page with a text colour (orange OPEN cells)."""
    def ctxt(self, x, y, s, size, bold=False, anchor="start", colour="#000", italic=False):
        self.txt(x, y, s, size, bold=bold, anchor=anchor, italic=italic)
        if colour != "#000":
            self.el[-1] = self.el[-1].replace("<text ", f'<text fill="{colour}" ', 1)

    def grid(self, x, y, widths, header, rows, size=6.0, lead=8.2):
        """A GM table; a cell starting 'OPEN' prints orange. Cells wrap onto more lines, never cut short."""
        total, top = sum(widths), y
        y += lead + 1
        cx = x
        for w_, h_ in zip(widths, header):
            self.ctxt(cx + w_ / 2, y - 2.4, h_.upper(), size, bold=True, anchor="middle")
            cx += w_
        self.line(x, y + 1.4, x + total, y + 1.4, 0.7)
        y += 1.4 + max(0.0, size + 1.2 - (lead - 2.4))      # the first row clears the header rule
        for r in rows:
            cells = [manual_v5.wrap_text(str(v), w_ - 4, size) for w_, v in zip(widths, r)]
            y += lead
            cx = x
            for w_, v, lines in zip(widths, r, cells):
                op = str(v).startswith("OPEN")
                for k, ln in enumerate(lines):
                    self.ctxt(cx + 2.2, y - 2.4 + k * (size + 1.3), ln, size, colour=ORANGE if op else "#000", italic=op)
                cx += w_
            y += (max(len(c) for c in cells) - 1) * (size + 1.3)
        y += 2.4
        self.rect(x, top, total, y - top, sw=0.9)
        cx = x
        for w_ in widths[:-1]:
            cx += w_
            self.line(cx, top, cx, y, 0.4)
        return y

    def notes_block(self, notes, y):
        self.ctxt(PM, y, "NOTES", 7.5, bold=True)
        y += 10
        for text, letter in notes.listed():
            lines = wrap_words(text, PW - 2 * PM - 14, 6.6)
            self.ctxt(PM, y, f"{letter}.", 6.6, bold=True, colour=ORANGE)
            for ln in lines:
                self.ctxt(PM + 12, y, ln, 6.6)
                y += 8.0
            y += 1.5
        return y


PDM_DESIG = {}
for _f, _k in (("pdm30_designations.txt", "PDM30"), ("pdm15_designations.txt", "PDM15")):
    _seen = set()
    for _l in (CD / _f).read_text().splitlines():
        _p = _l.split("|")
        if len(_p) < 3:
            continue
        if _p[0].strip() in _seen:                     # the PDM15 file repeats a second (PDM30) table from line 61: stop
            break
        _seen.add(_p[0].strip())
        if _p[1].startswith("OUT"):
            PDM_DESIG.setdefault((_k, int(_p[1][3:])), []).append(_p[0].strip())


def num(wid):
    """A circuit column: the circuit's number, blank when it has none (the Load / Protects column names it; a registry
    code never prints as a circuit, review round 4)."""
    return str(wid).upper()


def cable_name(w):
    """The cable schedule's first column: the circuit number, else the builder's name for the cable."""
    return manual_v5.circuit_word(w)


def pigtail_sentence(box, out, wires):
    """What the paired 20 A outputs actually take, counted from this PDM's own rows (review round 3, N4: the header said
    'two 16 AWG pigtails' while the fan's are four 18 AWG and #93's 20 AWG)."""
    from collections import Counter
    per_out = []
    for (b, n), wids in out.items():
        if b != box:
            continue
        pig = [w for w in wids if re.search(r"_PT\d+$", w)]
        if pig:
            per_out.append((n, pig))
    if not per_out:
        return "No output here uses pigtails."
    g = Counter(awg_word(wires[w]) for _n, ps in per_out for w in ps)
    kinds = ", ".join(f"{k} × {v} AWG" for v, k in sorted(g.items(), key=lambda kv: -kv[1]))
    return (f"{len(per_out)} outputs take pigtails, one per pin, joined in an in-line splice toward the load: "
            f"{kinds} in all (each row below gives its gauge).")


def pdm_outputs(reg, wires, ends):
    """{(box, output number): [wire ids]} from the termination rows, plus wires whose own row names 'PDMxx:OUTn' or
    '(OUTn' when no termination row carries it (ECU_PWR's PDM30 end)."""
    out = OrderedDict()
    for (box, n), pins in sorted(PDM_DESIG.items()):
        out[(box, n)] = []
    for t in reg["terminations"]:
        m = re.match(r"(PDM30|PDM15)-[AB]$", t["endpoint"])
        if not m or not t.get("cavity"):
            continue
        for c in str(t["cavity"]).split("+"):
            for (box, n), pins in PDM_DESIG.items():
                if box == m.group(1) and c.strip() in pins and str(t["wire"]) in wires and str(t["wire"]) not in out[(box, n)]:
                    out[(box, n)].append(str(t["wire"]))
    missing_term = []
    for wid, w in wires.items():
        for side in ("frm", "to"):
            txt = end_text(w.get(side))
            m = re.search(r"(PDM30|PDM15)[^;]{0,16}?\bOUT(\d+)", txt)
            if m and (m.group(1), int(m.group(2))) in out and wid not in out[(m.group(1), int(m.group(2)))]:
                out[(m.group(1), int(m.group(2)))].append(wid)
                missing_term.append((wid, f"{m.group(1)} OUT{m.group(2)}"))
    return out, missing_term


_PDM_SET = None


def pdm_setting(box, n):
    """(limit A or None, source or what closes it) for one output, from the registry's pdm_settings (registry-fixes,
    round 4): an entry names its output(s) as 'PDM30 OUT13' or 'PDM15 OUT1 + OUT6'."""
    global _PDM_SET
    if _PDM_SET is None:
        _PDM_SET = {}
        for e in json.load(open(CD / "k5_registry.json")).get("pdm_settings") or []:
            m = re.match(r"(PDM\d+)\s+(.*)", str(e.get("output") or ""))
            if not m:
                continue
            for o in re.findall(r"OUT(\d+)", m.group(2)):
                _PDM_SET[(m.group(1), int(o))] = e
    e = _PDM_SET.get((box, n))
    if not e:
        return None, None
    if e.get("limit_a") is not None and str(e.get("status") or "").lower().startswith("set"):
        return e["limit_a"], str(e.get("source") or "").split(" (")[0].split(";")[0].strip()
    return None, re.sub(r"^OPEN:\s*", "", str(e.get("status") or "")).split(" (")[0].strip()


def setting_cell(box, n, wires, wids, notes, generic):
    lim, why = pdm_setting(box, n)
    if lim is not None:
        return f"{lim:g} A set · {why}"
    if why:
        if why.upper().startswith("CONFLICT"):
            return f"CONFLICT {notes.tag(why)}"          # the data disagrees with itself: not merely unknown
        return f"OPEN {notes.tag(why)}"
    return out_setting(wires, wids) or f"OPEN {generic}"


def out_setting(wires, wids):
    """The output's maximum-current setting when a wire row's 'protection' field states one ('… setting, 8 A')."""
    for wid in wids:
        m = re.search(r"setting,?\s*(\d+)\s*A\b", str(wires[wid].get("protection") or ""))
        if m:
            return f"{m.group(1)} A (set)"
    return None


def load_word(w, box):
    to = w.get("to")
    other = w.get("frm") if str(w.get("frm") or "").startswith(box) is False and not str(w.get("frm") or "").startswith("PDM") else to
    return w.get("label") or end_text(other)


def pages_distribution(reg, wires, ends, eps_y, parts, first, notes):
    out, missing_term = pdm_outputs(reg, wires, ends)
    setting = notes.tag("output current setting (over-current shutdown, 1 A steps): not in the design data for this output; set in the "
                        "PDM configuration from the load's measured draw, below the wire's limit")
    pages = []
    widths = [34, 40, 58, 176, 24, 88, 96]
    head = ["Output", "Pins", "Circuit", "Load", "AWG", "Rating", "Setting"]
    for box, title, feed, total in (("PDM30", "Body PDM30 (cab)", "PDM_BPOS", "100 A"), ("PDM15", "Engine PDM15 (engine bay)", "PDM15_BPOS", "80 A")):
        rows = []
        used = used_base = used_cand = 0
        for (b, n), wids in out.items():
            if b != box:
                continue
            rating = "20 A · 115 A transient" if n <= 8 else "8 A · 60 A transient"
            pins = "+".join(PDM_DESIG[(b, n)])
            if not wids:
                rows.append((f"OUT{n}", pins, "—", "spare", "—", rating, "—"))
                continue
            used += 1
            base_here = any(wires[w_].get("option_status") != "candidate" for w_ in wids)
            if base_here:
                used_base += 1
            else:
                used_cand += 1
            for i, wid in enumerate(wids):
                w = wires[wid]
                cand = f"CANDIDATE: {w.get('option')} — " if w.get("option_status") == "candidate" else ""
                rows.append((f"OUT{n}" if i == 0 else "", pins if i == 0 else "", num(wid), cand + (w.get("label") or ""),
                             awg_word(w), rating if i == 0 else "", setting_cell(b, n, wires, wids, notes, setting) if i == 0 else ""))
        # rows go on pages by their measured height (cells wrap), each page followed by the notes its rows cite
        def row_h(r):
            return 7.6 + (max(len(manual_v5.wrap_text(str(v), w_ - 4, 5.6)) for w_, v in zip(widths, r)) - 1) * 6.9

        def letters(rs):
            return sorted({m_ for r in rs for m_ in re.findall(r"OPEN ([a-z]{1,2})\b", str(r[6]))})

        def notes_h(rs):
            return sum(8 * len(wrap_words(t, PW - 2 * PM - 14, 6.6)) + 1.5 for t, l in notes.listed() if l in letters(rs)) + 14

        chunks, cur = [], []
        top_guess = 150
        for r in rows:
            if cur and top_guess + 16 + sum(row_h(x) for x in cur + [r]) + notes_h(cur + [r]) > PH - PM - 12:
                chunks.append(cur)
                cur = []
            cur.append(r)
        if cur:
            chunks.append(cur)
        for k, chunk in enumerate(chunks):
            n_ = first + len(pages)
            p = CPage(f"1-{n_}", SECTION, odd=n_ % 2 == 1)
            p.heading("Power Distribution" + (" (cont.)" if k else ""), 13)
            fw = wires.get(feed, {})
            f = fuse_of(fw) if fw else None
            lead_in = (f"{title}: battery feed {awg_word(fw)} AWG from the distribution stud through a "
                       f"{(f[0] + ' ' + str(f[1]) + ' A') if f and f[1] else 'fuse of OPEN value'}; total output {total} continuous; "
                       f"both battery − pins to the ground star in 20 AWG. {used_base} base{f' + {used_cand} candidate-option' if used_cand else ''} of {len([1 for (b, _n) in out if b == box])} outputs carry a circuit "
                       f"(a candidate-option output is used only if that option is chosen). "
                       "Outputs are high-side, software-fused; a set limit prints with its source. " + pigtail_sentence(box, out, wires))
            if k == 0:
                for i, ln in enumerate(wrap_words(lead_in, PW - 2 * PM, 7.2)):
                    p.ctxt(PM, p.y + i * 9, ln, 7.2)
                p.y += len(wrap_words(lead_in, PW - 2 * PM, 7.2)) * 9 + 2
            p.y = p.grid(PM, p.y, widths, head, chunk, size=5.6, lead=7.6) + 10
            y_ = p.y
            for t, l in notes.listed():
                if l in letters(chunk):
                    lines = wrap_words(t, PW - 2 * PM - 14, 6.6)
                    p.ctxt(PM, y_, f"{l}.", 6.6, bold=True, colour=ORANGE)
                    for ln in lines:
                        p.ctxt(PM + 12, y_, ln, 6.6)
                        y_ += 8.0
                    y_ += 1.5
            p.y = y_
            pages.append((p, "Power distribution — " + box))
    return pages, missing_term


def page_protection(reg, wires, ends, eps_y, parts, number, notes, page=None):
    p = page or CPage(number, SECTION, odd=True)
    p.heading("Protection", 13)
    lead_in = ("Every fuse on the DC primary, what it protects and the cable it protects; then the cables with no fuse. "
               "A fuse protects the wire: rated above the load and at or under the cable's limit, within 7 in of the stud "
               "where it can be. PDM outputs carry no fuse: the PDM's programmed shutdown is the fuse (Power Distribution pages).")
    for i, ln in enumerate(wrap_words(lead_in, PW - 2 * PM, 7.2)):
        p.ctxt(PM, p.y + i * 9, ln, 7.2)
    p.y += len(wrap_words(lead_in, PW - 2 * PM, 7.2)) * 9 + 2
    fuse_pn = {}
    for code, pt in parts.items():                      # 'MEGA 125 A', 'MIDI 40 A, M5 (…)', 'MEGA 100 A (PDM15 feed)'
        m = re.match(r"(MEGA|MIDI) (\d+) A\b", str((pt or {}).get("name") or "")) if isinstance(pt, dict) and pt.get("kind") == "fuse" else None
        if m:
            fuse_pn.setdefault((m.group(1), int(m.group(2))), code)
    holder = {}
    for code, pt in parts.items():
        if isinstance(pt, dict) and pt.get("kind") == "holder":
            for k in ("MEGA", "MIDI"):
                if k in str(pt.get("name")):
                    holder.setdefault(k, code)
    no_pn = []
    rows = []
    fused = []
    for wid, w in wires.items():
        f = fuse_of(w)
        if not f:
            continue
        kind, amps, side = f
        fused.append(wid)
        at = end_text(w.get(side)).split("(")[0].strip()
        at = "distribution stud" if re.search(r"istribution stud", end_text(w.get(side))) else at
        at = {"PS-STUDS": "distribution stud", "Distribution stud": "distribution stud", "ODYSSEY": "Odyssey +",
              "ACC-BATT": "YellowTop +"}.get(at, at)
        f_lug, t_lug = ps_lugs(eps_y, wid, w)
        fp = [p_ for p_, _c in [term_part(ends, wid, t["endpoint"]) for t in ends.get(wid, [])]]
        val = f"{kind + ' ' if kind else ''}{amps} A" if amps else f"OPEN {notes.tag(fuse_open_note(wid, kind, parts))}"
        # the wire's own protection record first (registry-fixes round 5: protection_parts {holder, fuse}); a kit fuse is
        # the kit's; only a circuit whose record truly lacks a part is named as missing
        pp = w.get("protection_parts") or {}
        kit = bool(re.search(r"\bin the kit\b|kit harness fuse", str(w.get("protection") or ""), re.I))
        pn = pp.get("fuse") or ("in the kit" if kit else fuse_pn.get((kind, amps)))
        if not pn:
            if amps:
                no_pn.append(f"{kind + ' ' if kind else ''}{amps} A ({wid})")
                pn = f"OPEN {notes.group('fusepn', 'fuse part number not in the parts list for', no_pn[-1])}"
            else:
                pn = "—"
        hd = pp.get("holder") or ("in the kit" if kit else holder.get(kind)) or \
            f"OPEN {notes.group('holder', 'fuse holder not named in the parts list for', wid.upper())}"
        def lugcell(lug):
            if lug == "RING-SMALL":
                return f"OPEN {notes.tag('small ring terminals carry no part number (stud size and gauge not set)')}"
            return lug or f"OPEN {notes.tag('lug or terminal at this end not in the stud list or the termination rows')}"
        la, lb = lugcell(f_lug), lugcell(t_lug)
        rows.append((val, pn, hd, at, num(wid), w.get("label") or "", awg_word(w).replace("KIT LEAD", "kit"), la, lb))
    rows.sort(key=lambda r: (0 if r[0].startswith("MEGA") else 1 if r[0].startswith("MIDI") else 2, r[4]))
    widths = [42, 50, 48, 56, 52, 152, 20, 48, 48]
    p.y = p.grid(PM, p.y, widths, ["Fuse", "Fuse PN", "Holder", "At", "Circuit", "Protects", "AWG", "Lug, from", "Lug, to"], rows, size=5.6, lead=8.2) + 12
    # unfused primaries
    p.ctxt(PM, p.y, "CABLES WITH NO FUSE", 7.5, bold=True)
    p.y += 4
    unf = []
    for wid in ("63", "ISO_OUT", "6"):
        w = wires.get(wid)
        if not w:
            continue
        f_lug, t_lug = ps_lugs(eps_y, wid, w)
        why = {"63": "battery post to isolator stud A: the only unprotected cable; keep it shortest, sheathed and clamped",
               "ISO_OUT": "isolator stud B to the distribution stud: upstream of every fuse; sheathed and clamped",
               "6": "cranking-motor exemption: a fuse that survives cranking cannot protect it; the isolator kills it"}[wid]
        unf.append((num(wid), w.get("label"), awg_word(w), f_lug or "OPEN", t_lug or "OPEN", why))
    p.y = p.grid(PM, p.y, [40, 110, 22, 44, 44, 256], ["Circuit", "Cable", "AWG", "Lug, from", "Lug, to", "Why no fuse"], unf, size=5.6, lead=8.2) + 12
    return p, len(rows), len(unf)


def page_cable_schedule(reg, wires, ends, eps_y, parts, number):
    notes = Notes()
    p = CPage(number, SECTION, odd=True)
    p.heading("Main Cable Schedule", 13)
    cables = [wid for wid, w in wires.items() if awg_num(w) <= 8]
    cables.sort(key=lambda wid: (awg_num(wires[wid]), wid))
    lead_in = (f"Every cable 8 AWG and heavier: {len(cables)} cables. Lengths are the twin's polylines or zone estimates (EST) "
               "until measured; spine cables are prototyped at maximum length and cut on the truck. Lugs are tinned seamless copper, "
               "red adhesive shrink on positives, a black band on negatives.")
    for i, ln in enumerate(wrap_words(lead_in, PW - 2 * PM, 7.2)):
        p.ctxt(PM, p.y + i * 9, ln, 7.2)
    p.y += len(wrap_words(lead_in, PW - 2 * PM, 7.2)) * 9 + 2
    sleeve = notes.tag("sleeve: DR-25, sized per bundle at the formboard; no size is set per cable")
    t1, t2 = [], []
    for wid in cables:
        w = wires[wid]
        L = w.get("length_ft")
        basis = str(w.get("length_basis") or "")
        bword = "twin" if "twin" in basis else "zone est." if "zone" in basis else "ordering est." if "ordering" in basis else ""
        length = f"{L:.1f} ft {bword}".strip() if L else f"OPEN {notes.tag('length: no length on the row; set at the mock-up (prototype at maximum length, then cut)')}"
        frm = re.sub(r"\s*\(ground star[^)]*\)", " (ground star)", end_text(w.get("frm")))
        to = re.sub(r"\s*\(ground star[^)]*\)", " (ground star)", end_text(w.get("to")))
        spec = str(w.get("spec") or "OPEN")
        t1.append((cable_name(w), clean(frm.replace("PS-STUDS", "stud")), clean(to.replace("PS-STUDS", "stud")), awg_word(w), spec, length))
        f_lug, t_lug = ps_lugs(eps_y, wid, w)
        state = []
        def far(lug, side):
            if lug == "RING-SMALL":
                return f"OPEN {notes.tag('small rings carry no part number yet')}"
            if lug:
                if str(lug) == "DL214" and awg_num(w) != 2:
                    g = awg_word(w)
                    return f"OPEN {notes.tag(f'{wid}: DL214 is a 2 AWG lug; the cable is {g} AWG; closes with a lug for that gauge on an M6 stud')}"
                return str(lug)
            words = end_text(w.get(side))
            code = NODE_EP.get(resolve(words) or "", "") or ""
            if re.search(r"[Dd]istribution stud", words):
                code = "PS-STUDS"
            part, cav = term_part(ends, wid, code) if code else (None, None)
            if part == "RING":
                return f"{cav or 'ring'} · OPEN {notes.tag('small rings carry no part number yet')}"
            if part:
                return part
            ep = reg["endpoints"].get(code, {})
            why = [clean(o) for o in (ep.get("open") or []) if clean(o) and re.search(r"terminal|post|tap|holder|model|tray|pigtail|pin-out", o, re.I)]
            if code == "PS-STUDS":
                return f"OPEN {notes.group('nolug', 'no lug in the stud list at the distribution-stud end', wid)}"
            name = code or words.split("(")[0].strip()
            return f"OPEN {notes.tag(name + ': ' + (why[0] if why else 'terminal part not named'))}"
        la, lb = far(f_lug, "frm"), far(t_lug, "to")
        pos = awg_num(w) <= 8 and not re.search(r"GND|NEG|^G\d", wid)
        boot = "MS25171-3S" if wid in ("59", "PDM_BPOS") else (f"OPEN {notes.tag('stud boots MS25171-3S: Dave boots the alternator B+ and the PDM stud; the other positive stud ends are not assigned')}" if pos else "— (neg.)")
        for c in (la, lb, boot, f"OPEN {sleeve}", spec, length):
            if str(c).startswith("OPEN"):
                state.append(str(c).split()[1])
        st = "DESIGN COMPLETE" if not state else "OPEN " + ",".join(dict.fromkeys(state))
        t2.append((cable_name(w), la, lb, boot, f"OPEN {sleeve}", st))
    p.y = p.grid(PM, p.y, [110, 104, 104, 22, 76, 100], ["Cable", "From", "To", "AWG", "Spec", "Length"], t1, size=5.6, lead=8.0) + 10
    p.y = p.grid(PM, p.y, [110, 90, 90, 76, 50, 100], ["Cable", "Lug, from end", "Lug, to end", "Boot", "Sleeve", "State"], t2, size=5.6, lead=8.0) + 10
    p.notes_block(notes, p.y)
    done = sum(1 for r in t2 if r[-1] == "DESIGN COMPLETE")
    return p, len(cables), done, notes


# ------------------------------------------------------------------ build
def publish(page, stem, height):
    text = " ".join(re.sub(r"<[^>]+>", " ", e) for e in page.el)
    bad = [b for b in kits_v5.book_lint(text) if not b.startswith("unstamped")]
    bad += [f"overprint: '{a}' over '{b}'" for a, b in diagram_v5.overlaps(page)]
    if hasattr(page, "runs") and hasattr(diagram_v5, "run_strikes"):
        bad += [f"text struck by run {r}: '{t}'" for t, r in diagram_v5.run_strikes(page)]
    pw = diagram_v5.W if isinstance(page, diagram_v5.Sheet) else manual_v5.W
    pm = diagram_v5.M if isinstance(page, diagram_v5.Sheet) else manual_v5.M
    bad += manual_v5.layout_faults(page.boxes, pw, height, pm, footer=(manual_v5.REVISION, *getattr(page, "footer", [])))
    bad += [f"text over a pin box: '{t_}'" for t_ in diagram_v5.mark_overprints(page)]
    bad += getattr(page, "faults", [])
    bad += manual_v5.fragment_faults(page.boxes)
    bad += manual_v5.id_faults(page.boxes)
    bad += manual_v5.gauge_faults(page.boxes)
    bad += manual_v5.word_faults(page.boxes)
    bad += manual_v5.purchase_faults(page.boxes)
    if re.search(r"\$\d|\bcart\b|\bbuy\b|\bbought\b|\border(ed)?\b|lined up", text, re.I):
        bad.append("purchase language on the page")
    if bad:
        raise SystemExit(f"{stem.name} breaks the book's rules ({len(bad)}):\n  " + "\n  ".join(bad[:16]))
    stem.with_suffix(".svg").write_text(page.svg())
    subprocess.run(["rsvg-convert", "-d", "150", "-p", "150", "-o", str(stem.with_suffix(".png")), str(stem.with_suffix(".svg"))], check=True)
    subprocess.run(["rsvg-convert", "-f", "pdf", "-o", str(stem.with_suffix(".pdf")), str(stem.with_suffix(".svg"))], check=True)
    diagram_v5.add_links(stem.with_suffix(".pdf"), manual_v5.link_parts(page.boxes), height)
    return str(stem.with_suffix(".pdf"))


def build(first_number=1):
    reg, wires, ends, eps_y, parts = load()
    OUT.mkdir(parents=True, exist_ok=True)
    made, report = [], {}
    n = first_number
    a, ca, na = sheet_dc_primary(reg, wires, ends, eps_y, parts, f"1-{n}", f"1-{n + 1}")
    made.append((f"1-{n}", "DC primary — batteries, isolator, distribution, charging, starting", "sheet",
                 publish(a, OUT / f"K5_power_{n}_dc-primary", SH_)))
    report["dc primary"] = (ca, na.listed())
    n += 1
    b, cb, nb = sheet_grounds(reg, wires, ends, eps_y, parts, f"1-{n}", f"1-{n - 1}")
    made.append((f"1-{n}", "Ground distribution", "sheet", publish(b, OUT / f"K5_power_{n}_grounds", SH_)))
    report["grounds"] = (cb, nb.listed())
    n += 1
    notes_c = Notes()
    dist, missing_term = pages_distribution(reg, wires, ends, eps_y, parts, n, notes_c)
    n += len(dist)
    prot, nf, nu = page_protection(reg, wires, ends, eps_y, parts, f"1-{n}", notes_c)
    prot.notes_block(notes_c, prot.y)                   # the setting note and the fuse notes, once, on the protection page
    for p, title in dist:
        made.append((p.number, title, "page", publish(p, OUT / f"K5_power_{p.number.split('-')[1]}_distribution", PH)))
    made.append((prot.number, "Protection", "page", publish(prot, OUT / f"K5_power_{n}_protection", PH)))
    report["protection"] = (nf, nu)
    n += 1
    d, ncab, ndone, nd = page_cable_schedule(reg, wires, ends, eps_y, parts, f"1-{n}")
    made.append((d.number, "Main cable schedule", "page", publish(d, OUT / f"K5_power_{n}_cable-schedule", PH)))
    report["cables"] = (ncab, ndone, nd.listed())
    report["missing_term"] = missing_term
    report["dist_notes"] = notes_c.listed()
    build.report = report
    for num, t, kind, pdf in made:
        print(f"{num} [{kind}] {t} -> {Path(pdf).name}")
    return [(num, t, kind, pdf) for num, t, kind, pdf in made]


if __name__ == "__main__":
    build(1)
    r = build.report
    ca = r["dc primary"][0]
    print(f"DC primary: {ca['cables']} circuits, {ca['fuses']} fuses, {ca['grounds']} returns; OPEN notes {len(r['dc primary'][1])}")
    print(f"grounds: {r['grounds'][0]['returns']} returns; OPEN notes {len(r['grounds'][1])}")
    print(f"protection: {r['protection'][0]} fuses, {r['protection'][1]} unfused primaries")
    print(f"cables >= 8 AWG: {r['cables'][0]}, design complete {r['cables'][1]}")
    print("PDM circuits named only by the wire row (no termination row):", r["missing_term"])
    for sec in ("dc primary", "grounds"):
        for text, letter in r[sec][1]:
            print(f"  [{sec}] {letter}: {text}")
    for text, letter in r["dist_notes"] + r["cables"][2]:
        print(f"  [pages] {letter}: {text}")
