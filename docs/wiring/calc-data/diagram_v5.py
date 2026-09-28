#!/usr/bin/env python3
"""diagram_v5.py — wiring diagram foldouts in the GM booklet style, drawn from k5_registry.json, for the whole truck.

Conventions copied from ST-352-78 'Cab, Engine and Chassis Wiring — C,K-10 thru 35' (reference_documents/
wiring_diagram_booklets, sheets A-1/A-2, 2448 x 836 pt foldouts): every device is a box seen from its plug with the
cavity markings; every wire is an orthogonal run labelled gauge · colour · circuit ("18 BRN-9F"); in-line connectors
are drawn as a strip of cavities the runs pass through; grounds end at a ground symbol; a run that leaves the sheet
ends in an arrow tag naming the plug, cavity and sheet it goes to. Nothing is drawn that is not a row: a wire end
without a cavity is drawn dashed and stamped OPEN.

Sheets (11 x 17 landscape) follow the section plan in diagram_sections_v5.py: every plug is owned by one sheet.
Layout 'engine': plugs, ground star, rails and the engine PDM on the left; the crossing (61-pin face drawn to its
insert arrangement, body bulkheads as cavity strips, the grommet) in the middle; the cab computers and off-sheet tags
on the right. Layout 'cab': plugs on the left; computers, ground banks, bulkhead strips and tags on the right.
Plug boxes are pin maps, not the plug's shape. Output: docs/wiring/output/manual/K5_diagram_<sheet>.svg/.png/.pdf;
the manual's build() appends them.
"""
import json
import math
import re
import subprocess
import sys
from collections import OrderedDict, defaultdict
from html import escape
from pathlib import Path

CD = Path(__file__).resolve().parent
sys.path.insert(0, str(CD))
import kits_v5                                         # noqa: E402
from manual_v5 import gm_colour, tw, FONT              # noqa: E402
import diagram_sections_v5 as P                        # noqa: E402

OUT = CD.parent / "output" / "manual"
W, H, M = 1224, 792, 36                                # tabloid landscape, points
ROW = 12.0                                             # one wire row: run label above the run, circuit label below
MAP_URL = "https://nuke.ag/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring?tab=map&node="   # the plug's card on the truck's map
ORANGE = "#E67300"                                     # OPEN stamps (the sheet convention since 2026-06-09)
HEX = {"white": "#f2f2f2", "black": "#111111", "red": "#d3222a", "orange": "#f28c28", "yellow": "#e8c31c", "green": "#1f8a3b",
       "blue": "#2457c5", "brown": "#7a4a1d", "gray": "#8a8a8a", "grey": "#8a8a8a", "violet": "#7b3fa0", "purple": "#7b3fa0",
       "pink": "#e58fb6", "tan": "#c8a675", "cable": "#555555", "shld": "#555555"}
DARK = ("#111111", "#7a4a1d", "#2457c5", "#1f8a3b", "#7b3fa0", "#d3222a", "#555555", "#8a8a8a", "#333333")
BOX_W = 150
LBL, LBL2 = 4.4, 3.8                                   # run label and circuit-label sizes
TOP = M + 58                                           # first box top on every column


def wire_colours(w):
    """(base hex, stripe hex or None) from the registry colour words ('white/red' = white with a red stripe)."""
    col = str(w.get("color") or "").lower().split("+")[0]
    parts = [x.strip() for x in col.split("/") if x.strip()]
    base = HEX.get(parts[0], "#333333") if parts else "#333333"
    stripe = HEX.get(parts[1]) if len(parts) > 1 else None
    return base, stripe


# Dave's words for plug titles (the book's rule: no cut-list codes on a page)
TITLES = {"CKP": "crank sensor", "CMP": "cam sensor", "MAP": "MAP sensor", "CLT-ECU": "coolant temp sensor",
          "OILP-ECU": "oil pressure sensor", "IAT": "inlet air temp sensor", "KNOCK-1": "knock sensor 1",
          "KNOCK-2": "knock sensor 2", "TB": "throttle body", "APS": "gas pedal", "FPS": "fuel pressure sensor",
          "FUELP": "fuel pressure sensor", "OILT": "oil temp sensor", "LTCD": "lambda module", "OTS": "oil temp sensor",
          "WIDEBAND": "lambda module (LTCD)", "M130-A": "MoTeC M130, connector A",
          "M130-B": "MoTeC M130, connector B", "PDM30-A": "MoTeC PDM30, connector A", "PDM30-B": "MoTeC PDM30, connector B",
          "PDM15-A": "engine PDM15, connector A", "PDM15-B": "engine PDM15, connector B", "GND-BANK-ENG": "ground star",
          "PS-STUDS": "power studs and lugs", "RAIL-COIL_PWR": "coil +12 V rail", "RAIL-INJ_PWR": "injector +12 V rail",
          "COIL-GROUND-RINGS": "coil ground ring terminals", "GND-BANK-CAB": "cab ground bank",
          "GND-SPLICE-REAR": "rear ground bus", "PDM15-STUD": "PDM15 battery stud", "PDM30-STUD": "PDM30 battery stud",
          "DAKOTA-VHX": "Dakota VHX control box", "DAK-CTS": "Dakota coolant temp sender", "DAK-OILP": "Dakota oil pressure sender",
          "ALTERNATOR-SENSE": "alternator (L terminal)", "STARTER-S": "starter solenoid S", "FAN": "radiator fan",
          "AC-CLUTCH": "A/C compressor clutch", "AC-HP-SW": "A/C high-pressure switch", "AC-LP-SW": "A/C low-pressure switch",
          "ODYSSEY": "running battery (Odyssey)", "ACC-BATT": "accessory battery (YellowTop)", "ISOLATOR": "battery isolator",
          "DCDC": "DC-DC charger", "IBOOSTER": "brake booster (iBooster)", "CAN-BUS": "CAN bus trunk",
          "PORT-ETH": "M130 laptop port (RJ45)", "PORT-UTC": "PDM30 laptop port (XLR)", "FIREWALL-GROMMET": "firewall grommet",
          "FIREWALL-BODY-A": "body bulkhead A", "FIREWALL-BODY-B": "body bulkhead B", "FIREWALL-BODY-P": "body bulkhead P",
          "FIREWALL-ENGINE": "61-pin firewall connector", "FIREWALL-CABIN": "61-pin firewall connector",
          "HEADLIGHT-L": "left headlight", "HEADLIGHT-R": "right headlight", "PARK-TURN-LF": "left front park/turn lamp",
          "PARK-TURN-RF": "right front park/turn lamp", "MARKER-LF": "left front marker", "MARKER-RF": "right front marker",
          "MARKER-LR": "left rear marker", "MARKER-RR": "right rear marker", "HORN": "horn", "UNDERHOOD-LAMP": "underhood lamp",
          "WIPER-MOTOR": "wiper motor", "WASHER-PUMP": "washer pump", "BLOWER-MOTOR": "blower motor",
          "BLOWER-RES": "blower resistor", "IGN-SWITCH": "ignition switch", "ISO-SWITCH": "isolator dash switch",
          "HL-SW": "headlight switch", "FLOOR-DIMMER": "floor dimmer switch", "TURN-SW": "turn/hazard switch",
          "BRAKE-SW": "brake light switch", "HORN-SW": "horn button", "WIPER-SW": "wiper/washer switch",
          "BLOWER-SW": "blower switch", "RADIO": "radio", "OUTLET-12V": "12 V outlet", "USB-PORT": "USB port",
          "DOOR-L-PASS": "driver door pass-through (locks, speaker)", "DOOR-R-PASS": "passenger door pass-through (locks, speaker)",
          "DOOR-L-PASS-P": "driver door pass-through (window power)",
          "SPL-ISO-YEL": "isolator switch yellow-wire stub splice (M130 shutdown tap)", "DOOR-R-PASS-P": "passenger door pass-through (window power)",
          "WIN-SW-L": "driver window switches", "WIN-SW-R": "passenger window switch", "LOCK-SW-L": "driver lock switch",
          "LOCK-SW-R": "passenger lock switch", "window_motor_DS": "driver window motor",
          "window_motor_PS": "passenger window motor", "lock_actuator_DS": "driver lock actuator",
          "lock_actuator_PS": "passenger lock actuator", "SPK-FL": "driver door speaker", "SPK-FR": "passenger door speaker",
          "TG-SW-DASH": "tailgate window dash switch", "TG-SW-KEY": "tailgate key switch", "TG-CUTOUT": "tailgate-closed cutout switch",
          "rear_window_motor": "tailgate window motor", "Backup_Camera": "rear camera", "MIRROR-MON": "mirror display",
          "DOME-LAMP": "dome lamp", "FOOTWELL-LAMPS": "footwell lamps", "UNDERDASH-LAMPS": "under-dash lamps",
          "CARGO-LAMP": "cargo lamp", "DOOR-JAMB-L": "driver door jamb switch", "DOOR-JAMB-R": "passenger door jamb switch",
          "AMP-STEP-CTRL": "power steps controller", "AMP": "amplifier", "AMP-BLOCK": "amplifier reducing block (2 to 4 AWG)", "SUB": "woofer 1", "SUB-2": "woofer 2",
          "SPK-RL": "left rear speaker", "SPK-RR": "right rear speaker", "FUEL-PUMP": "fuel pump", "FUEL-LEVEL": "fuel level sender",
          "Tail_Light_Left": "left tail lamp", "Tail_Light_Right": "right tail lamp", "Backup_Light_Left": "left backup lamp",
          "Backup_Light_Right": "right backup lamp", "CHMSL": "third brake lamp", "LICENSE-LAMP": "license lamp",
          "CLEARANCE-L": "left roof clearance lamp", "CLEARANCE-C": "centre roof clearance lamp",
          "CLEARANCE-R": "right roof clearance lamp", "TCASE-4WD-SW": "4WD indicator switch", "VSS": "road-speed source",
          "VSS-SENDER": "Dakota speed sender", "GSS-3000": "Dakota gear sender box", "GSS-SENSOR": "gear sender sensor",
          "E-STOPP": "electric parking brake (E-Stopp)"}
CODE_WORDS = [(r"\bCKP\b", "crank"), (r"\bCMP\b", "cam"), (r"\bCLT\b", "coolant temp"), (r"\bIAT\b", "inlet air temp"),
              (r"\bOPS\b", "oil PSI"), (r"\bETB\b", "throttle body"), (r"\bAPS\b", "gas pedal"), (r"\bOTS\b", "oil temp"),
              (r"\bTAC\b", "throttle")]
STRIP_FAMILY = {"FIREWALL-BODY-A": ("Deutsch DT 12-way, A key", 12), "FIREWALL-BODY-B": ("Deutsch DT 12-way, B key", 12),
                "FIREWALL-BODY-P": ("Deutsch DTP 4-way", 4)}


def plug_title(e, ep):
    m = re.match(r"^(COIL|INJ)-(\d+)$", e)
    if m:
        return f"{'coil' if m.group(1) == 'COIL' else 'injector'} {m.group(2)}"
    t = TITLES.get(e) or (ep.get("device") or e).split("(")[0].split(" — ")[0][:40].strip()
    for rx, word in CODE_WORDS:
        t = re.sub(rx, word, t)
    return t


def words(s):
    """A registry phrase as page text: cut-list codes become Dave's words, underscores become spaces."""
    t = str(s or "").replace("_", " ")
    for rx, word in CODE_WORDS:
        t = re.sub(rx, word, t)
    return t


def load():
    reg = json.load((CD / "k5_registry.json").open())
    wires = {str(w["id"]): w for w in reg["wires"] if not w.get("retired")}
    wires.update({str(w["id"]): w for w in reg["implied"]})
    ends = defaultdict(list)
    for t in reg["terminations"]:
        ends[str(t["wire"])].append(t)
    return reg, wires, ends


class Sheet:
    def __init__(self, number, title, subtitle, head="ENGINE HARNESS"):
        self.el, self.number, self.boxes, self.runs, self.rects = [], number, [], [], []
        self.txt(W / 2, M - 8, f"{head} — WIRING DIAGRAM", 9, bold=True, anchor="middle")
        self.txt(W - M, M - 8, number, 9, bold=True, anchor="end")
        self.txt(W / 2, M + 14, title.upper(), 14, bold=True, anchor="middle")
        self.txt(W / 2, M + 26, subtitle, 7, anchor="middle")

    def txt(self, x, y, s, size, bold=False, anchor="start", italic=False, colour="#000", href=None, owner=None):
        w_ = tw(str(s), size, bold)
        x0 = x - (w_ if anchor == "end" else w_ / 2 if anchor == "middle" else 0)
        self.boxes.append((x0, y - size * 0.78, x0 + w_, y + 0.2, str(s), href, owner))
        st = ' font-style="italic"' if italic else ""
        t = (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" fill="{colour}" '
             f'font-weight="{"bold" if bold else "normal"}" text-anchor="{anchor}"{st}>{escape(str(s))}</text>')
        self.el.append(f'<a href="{escape(href)}">{t}</a>' if href else t)

    def line(self, pts, w=0.8, dash=None, colour="#000", stripe=None, owner=None):
        """A run (owner = its wire id) or a symbol stroke. Stripe = a thin solid centre line in the stripe colour."""
        d = f' stroke-dasharray="{dash}"' if dash else ""
        P_ = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        if colour != "#000":                     # a coloured run: thin black edge so white wire shows on white paper
            self.el.append(f'<polyline points="{P_}" fill="none" stroke="#000" stroke-width="{w + 0.9}" stroke-linejoin="round"{d}/>')
        self.el.append(f'<polyline points="{P_}" fill="none" stroke="{colour}" stroke-width="{w}" stroke-linejoin="round"{d}/>')
        if stripe:
            self.el.append(f'<polyline points="{P_}" fill="none" stroke="{stripe}" stroke-width="{max(w * 0.36, 0.4):.2f}" stroke-linejoin="round"{d}/>')
        self.runs.append((owner, list(pts)))

    def rect(self, x, y, w, h, sw=0.9, rx=0, fill="none", dash=None, colour="#000"):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.rects.append((x, y, x + w, y + h))
        self.el.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" stroke="{colour}" stroke-width="{sw}"{d}/>')

    def dot(self, x, y, r=1.6):
        self.el.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#000"/>')

    def arrow(self, x, y, left=False):
        s = -1 if left else 1
        self.el.append(f'<polygon points="{x:.1f},{y:.1f} {x - s * 4:.1f},{y - 2:.1f} {x - s * 4:.1f},{y + 2:.1f}" fill="#000"/>')

    def ground(self, x, y, owner=None):
        self.line([(x, y), (x, y + 6)], 0.8, owner=owner)
        for i, hw in enumerate((6, 4, 2)):
            self.line([(x - hw, y + 6 + i * 2.2), (x + hw, y + 6 + i * 2.2)], 0.8, owner=owner)

    def svg(self):
        body = "".join(self.el)
        body = re.sub(r"&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)", "&amp;", body)      # a bare & (a map URL's &node=) breaks the SVG
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}pt" height="{H}pt" viewBox="0 0 {W} {H}">'
                f'<rect width="{W}" height="{H}" fill="#fff"/>' + body + "</svg>")


def overlaps(sheet):
    """Pairs of text boxes that intersect: the page cannot ship with overprinted text (owner 2026-09-28)."""
    B = sheet.boxes
    out = []
    for i in range(len(B)):
        ax0, ay0, ax1, ay1, at = B[i][:5]
        for j in range(i + 1, len(B)):
            bx0, by0, bx1, by1, bt = B[j][:5]
            if ax0 < bx1 - 0.5 and bx0 < ax1 - 0.5 and ay0 < by1 - 0.5 and by0 < ay1 - 0.5:
                out.append((at, bt))
    return out


def run_strikes(sheet):
    """Text struck by a run that is not its own (review C22: labels struck through by runs). A text box counts as hit
    when any run segment passes through it (0.4 pt inside its edges); a label may sit on its own run."""
    out = []
    for x0, y0, x1, y1, t, _h, owner in sheet.boxes:
        x0, y0, x1, y1 = x0 + 0.4, y0 + 0.4, x1 - 0.4, y1 - 0.4
        for rowner, pts in sheet.runs:
            if rowner is not None and rowner == owner:
                continue
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                if min(ax, bx) < x1 and max(ax, bx) > x0 and min(ay, by) < y1 and max(ay, by) > y0:
                    out.append((t, rowner))
                    break
            else:
                continue
            break
    return out


def tag_id(cav):
    return "".join(ch if ch.isalnum() else "_" for ch in str(cav)) + ("U" if str(cav)[:1].isupper() else "l")


def cav_mark(cav):
    c = str(cav)
    if cav is None or c.startswith("?") or c == "None":
        return "?"                                    # cavity not settled: the run is dashed and counted OPEN
    if re.match(r"^[A-Za-z]{1,4}$|^[A-Z]?\d{1,3}$|^[+-]$", c):
        return c
    return "○"                                        # ring, lug, splice, stud, lead: a terminal, not a moulded cavity


def fit(text, width, size):
    t = str(text)
    while tw(t, size) > width and len(t) > 3:
        t = t[:-2].rstrip() + "…"
        t = t.replace("……", "…")
    return t


def fit_tail(text, width, size):
    """Shorten the middle of a line, never its ' · sheet 1-N' tail (an off-sheet tag must keep its sheet number)."""
    t = str(text)
    head, sep, tail = t.rpartition(" · sheet ")
    if not sep or tw(t, size) <= width:
        return fit(t, width, size)
    return fit(head, width - tw(sep + tail, size), size) + sep + tail


def wire_label(w):
    """GM style 'gauge colour-circuit', then the length: '22 WHT/ORN-99R · 4.6 FT EST' (estimate until measured)."""
    col = gm_colour(str(w.get("color") or "?").upper()).replace("CABLE", "SHLD").replace(" + ", "+")
    L = w.get("length_ft")
    basis = str(w.get("length_basis") or "").lower()
    if L:
        tag = "" if re.search(r"measur|bench", basis) else " EST"
        return f"{w.get('awg') or '?'} {col}-{str(w['id']).upper()} · {L:.1f} FT{tag}"
    return f"{w.get('awg') or '?'} {col}-{str(w['id']).upper()} · LENGTH OPEN"


def circuit_label(w):
    """The printed sleeve text until Dave names the circuits: the circuit id (review B17)."""
    return f"LABEL: {str(w['id']).upper()}"


def plug_part_lines(reg, e, parts):
    """The plug's kit, terminals and seals as printed under its box: part number ×n and what it is. No purchase state."""
    ep = reg["endpoints"].get(e) or {}
    out = []
    for code, qty, _s, _w in kits_v5.kit_stamps(reg, ep):
        out.append((f"{code} {qty}", (parts.get(str(code)) or {}).get("name", "plug kit")))
    for code, kind, n, n_all, _s, _w in kits_v5.plug_parts(reg, e):
        out.append((f"{code} ×{n}", (parts.get(str(code)) or {}).get("name", kind)))
    return out


def sheet_parts(reg, eps_on_sheet, parts, junction_wires=None):
    """Every part the sheet's plugs use: (part number, name, kind, qty on this sheet, plugs it is used on). A kit shared
    between plugs (the endpoint kit map gives it as a fraction, e.g. one M800 kit for both M130 plugs) counts whole."""
    rows = OrderedDict()
    frac = {}
    for e in eps_on_sheet:
        ep = reg["endpoints"].get(e) or {}
        for code, q in (ep.get("kit") or {}).items():
            r = rows.setdefault(code, [code, (parts.get(code) or {}).get("name", ""), (parts.get(code) or {}).get("kind", "kit"), 0, []])
            r[3] += q
            if q < 1:
                frac[code] = round(1 / q)
            r[4].append(plug_title(e, ep))
        pp = kits_v5.plug_parts(reg, e)
        if junction_wires is not None and e in junction_wires:
            # a ground bank or stud strip counts only the terminals of the runs on this sheet
            diff = {d["item"]: d for d in reg["diff"] if d["kind"] != "wire"}
            cnt = OrderedDict()
            for t in reg["terminations"]:
                if t["endpoint"] == e and str(t["wire"]) in junction_wires[e]:
                    for code in str(t.get("part") or "").split(" + "):
                        if code in diff:
                            cnt[code] = cnt.get(code, 0) + 1
            pp = [(code, diff[code]["kind"], n, 0, None, None) for code, n in cnt.items()]
        for code, kind, n, n_all, _s, _w in pp:
            r = rows.setdefault(code, [code, (parts.get(code) or {}).get("name", ""), kind, 0, []])
            r[3] += n
            if plug_title(e, ep) not in r[4]:
                r[4].append(plug_title(e, ep))
    out = []
    for code, name, kind, q, used in rows.values():
        qs = str(int(round(q))) if abs(q - round(q)) < 1e-6 and q >= 1 else f"{math.ceil(q)} (1 kit serves {frac.get(code, 1)} plugs)"
        out.append((code, name, kind, qs, used))
    return out


# ------------------------------------------------------------------------------------------------ the page model
class Box:
    """A column item: a plug, junction, computer, off-sheet tag list or bulkhead strip. pins 'right' = the left stack
    (runs leave to the right), 'left' = the right stack. rows: dicts {cav, text, wires, mark, far}."""
    def __init__(self, kind, code, title, rows, width=BOX_W, pins="right"):
        self.kind, self.code, self.title, self.rows, self.w, self.pins = kind, code, title, rows, width, pins
        self.x = self.y = 0.0
        self.foot = []                     # part lines printed under a plug box

    @property
    def h(self):
        return len(self.rows) * ROW + 8

    def span(self):                        # vertical space the item takes in its stack (title + box + foot + gap)
        return 12 + self.h + (len(self.foot) * 5.4 + 4 if self.foot else 0) + 12

    def pin(self, i):
        yy = self.y + 4 + i * ROW + ROW / 2
        return (self.x + self.w if self.pins == "right" else self.x, yy)


def sort_key(c):
    c = str(c)
    return (1 if c.startswith("?") or c == "None" else 0, re.sub(r"\d+", lambda m: m.group().zfill(3), c))


def norm_pin(c):
    return re.sub(r"^([AB])0?(\d+)$", lambda m_: m_.group(1) + m_.group(2), str(c))


class Ctx:
    """Everything shared by all sheets: rows, designations, splice ids, the plan and the owner of each plug."""
    def __init__(self):
        self.reg, self.wires, self.ends = load()
        self.eps = self.reg["endpoints"]
        import yaml
        self.parts = yaml.safe_load((CD / "catalog" / "parts.yaml").read_text())
        import manual_v5
        self.desig = manual_v5.DESIG
        # splices: S-01 … numbered in the order of the splice list
        self.splices, self.inline, self.pigtail_of = [], {}, {}
        for i, sp in enumerate(self.reg.get("splices") or []):
            e, _, cav = str(sp.get("at") or "").partition(" ")
            rec = {"id": f"S-{i + 1:02d}", "endpoint": e, "cav": norm_pin(cav), **sp}
            self.splices.append(rec)
            if sp.get("type") == "in-line" and sp.get("sides") and len(sp["sides"]) == 2:
                # an in-line splice joining pigtails (side 1) to one run (side 2): drawn as a dot on that run
                main = [str(x) for x in sp["sides"][1]]
                if len(main) == 1:
                    self.inline[e] = rec
                    for pt in sp["sides"][0]:
                        self.pigtail_of[str(pt)] = (main[0], rec)
        # the shield rule, as the wire rows state it
        self.shield_rule = None
        for w in self.wires.values():
            m = re.search(r"drain grounded at the ECU end only[^|]*", str(w.get("notes") or ""))
            if m:
                self.shield_rule = m.group(0).strip().rstrip(";")
                break
        self.owner = {}                    # plug -> sheet number (filled per numbering pass)

    def wire_ends(self, wid):
        """(endpoint, cavity) per end, the 61-pin counted once; an endpoint that lists the wire without an end row gets
        a cavity-less end (drawn dashed)."""
        out = []
        for t in self.ends.get(wid, []):
            if t["endpoint"] == "FIREWALL-CABIN":
                continue
            k = (t["endpoint"], t.get("cavity"))
            if k not in out:
                out.append(k)
        seen = {e for e, _ in out}
        for e, ep in self.eps.items():
            if e not in seen and e != "FIREWALL-CABIN" and wid in [str(x) for x in ep.get("wires") or []]:
                out.append((e, None))
        return out

    def side(self, e):
        if e in P.ENGINE_COMPUTERS:
            return "engine"
        if e in P.CAB_JUNCTIONS:
            return "cab"
        wh = (self.eps.get(e) or {}).get("where")
        return "engine" if wh == "engine" else "x" if wh == "firewall" else "cab"


def plan(ctx):
    """[{section, key, title, layout, devs, extra}] — one row per sheet of the plan (pages come later)."""
    owned, sheets = {}, []
    for row in P.SHEET_PLAN:
        section, key, title, layout, rx = row[:5]
        also = row[5] if len(row) > 5 else None
        free = lambda e: e not in owned and e not in P.COMPUTERS and e not in P.JUNCTIONS and e not in P.CROSSINGS
        if isinstance(rx, list):
            devs = []
            for r_ in rx:
                devs += sorted([e for e in ctx.eps if re.match(r_, e) and free(e) and e not in devs])
        else:
            devs = sorted([e for e in ctx.eps if re.match(rx, e) and free(e)],
                          key=lambda e: re.sub(r"\d+", lambda m: m.group().zfill(3), e))
        for e in devs:
            owned[e] = key
        sheets.append({"section": section, "key": key, "title": title, "layout": layout, "devs": devs, "extra": [],
                       "also": also})
    by_key = {s["key"]: s for s in sheets}
    ctx.power_wires = []                           # drawn on the DC primary / ground distribution sheets (power_v5)
    # wires with no plug end of their own
    for wid, w in ctx.wires.items():
        ends = [e for e, _ in ctx.wire_ends(wid)]
        if any(e in owned for e in ends):
            continue
        if wid in ctx.pigtail_of:
            continue                               # a pigtail rides with the run it is spliced to
        home = None
        m = re.fullmatch(r"(\d+)s", wid)
        if m and m.group(1) in ctx.wires and any(e in owned for e, _ in ctx.wire_ends(m.group(1))):
            continue                               # a shield drain rides with its cable (page_wires adds it)
        for rx, k in P.WIRE_HOME:
            if home is None and re.search(rx, wid):
                home = k
        if home is None:
            home = next((P.JUNCTION_HOME[e] for e in ends if e in P.JUNCTION_HOME), None)
        if home is None and any((e in P.JUNCTIONS and e not in P.CAB_JUNCTIONS) or e == "FIREWALL-GROMMET" for e in ends):
            home = "power"
        if home is None:
            sec = SUB2SECTION.get(w.get("subsystem"))
            home = next((s["key"] for s in sheets if s["section"] == sec), "power")
        if home not in by_key:
            ctx.power_wires.append(wid)
            continue
        by_key[home]["extra"].append(wid)
    # a sheet may also draw wires another sheet owns (the comms sheet draws the whole CAN trunk)
    for sp in sheets:
        if sp["also"]:
            sp["extra"] += [wid for wid in ctx.wires if re.match(sp["also"], wid) and wid not in sp["extra"]
                            and wid not in ctx.pigtail_of]
    return sheets, owned


SUB2SECTION = {"CORE_ENGINE": "engine", "TRANS_6L80E": "powertrain_chassis", "FUEL": "body_convenience",
               "CHARGING_STARTING": "power_spine", "HARNESS_INFRA": "power_spine", "COOLING": "engine",
               "EPARKING_BRAKE": "powertrain_chassis", "DASH_CLUSTER_DAKOTA": "dash_cabin", "LIGHTING_EXTERIOR": "dash_cabin",
               "LIGHTING_INTERIOR": "body_convenience", "POWER_WINDOWS": "body_convenience", "POWER_LOCKS": "body_convenience",
               "AUDIO": "body_convenience", "CAMERA_REAR": "body_convenience", "WIPERS_WASHER": "body_convenience",
               "HVAC_AC": "dash_cabin", "BRAKES_IBOOSTER": "powertrain_chassis", "ACCESSORY_12V": "body_convenience",
               "AMP_STEPS": "body_convenience", "DOME_COURTESY": "body_convenience"}


def page_wires(ctx, devs, extra):
    ws = OrderedDict()
    for e in devs:
        ids = [str(x) for x in ctx.eps[e].get("wires") or []]
        ids += [str(t["wire"]) for t in ctx.reg["terminations"] if t["endpoint"] == e]
        for wid in ids:
            if wid in ctx.wires:
                ws[wid] = ctx.wires[wid]
    for wid in extra:
        ws[wid] = ctx.wires[wid]
    # a cable's drain rides on the sheet of the cable
    for wid in list(ws):
        if (wid + "s") in ctx.wires and (wid + "s") not in ws and re.fullmatch(r"\d+", wid):
            ws[wid + "s"] = ctx.wires[wid + "s"]
    return ws


def assemble(ctx, sp, devs, extra, owned, num_of):
    """The page model: boxes in the left stack, the crossing items, boxes in the right stack, and per wire its ends
    sorted into those places. num_of(sheet key) -> the number of the sheet that owns a plug."""
    eng = sp["layout"] == "engine"
    ws = page_wires(ctx, devs, extra)
    wends = {wid: ctx.wire_ends(wid) for wid in ws}
    # in-line splices: the pigtails' far ends join their run's net; the splice endpoint itself becomes a dot
    pigtail_at, merged = {}, {}
    for wid in list(ws):
        for e, cav in list(wends[wid]):
            rec = ctx.inline.get(e)
            if not rec:
                continue
            wends[wid] = [x for x in wends[wid] if x[0] != e]
            merged[wid] = rec
            for pt in rec["sides"][0]:
                for pe, pc in ctx.wire_ends(str(pt)):
                    if pe != e:
                        wends[wid].append((pe, pc))
                        pigtail_at[(pe, pc)] = (str(pt), rec["id"])
    cls = {}
    L_j, R_j, R_c, L_c, X, L_tag, R_tag = OrderedDict(), OrderedDict(), OrderedDict(), OrderedDict(), OrderedDict(), [], []
    strip_far = defaultdict(list)                  # (strip, cav) -> far ends (cab layout)
    for wid, ends in wends.items():
        crosses = [e for e, _ in ends if e in P.CROSSINGS]
        for e, cav in ends:
            if e in devs:
                cls[(wid, e, cav)] = "own"
            elif e in P.CROSSINGS:
                cls[(wid, e, cav)] = "x"
                X.setdefault(e, []).append((wid, cav))
            elif e in P.COMPUTERS:
                where = "L" if (eng and e in P.ENGINE_COMPUTERS) else "R"
                cls[(wid, e, cav)] = "comp" + where
                (L_c if where == "L" else R_c).setdefault(e, []).append((wid, cav))
            elif e in P.JUNCTIONS:
                where = "L" if (eng and ctx.side(e) == "engine") else "R"
                cls[(wid, e, cav)] = "jun" + where
                (L_j if where == "L" else R_j).setdefault(e, []).append((wid, cav))
            else:
                far_side = ctx.side(e)
                if not eng and crosses and far_side == "engine":
                    cls[(wid, e, cav)] = "far"                   # printed beside the bulkhead strip
                    continue
                where = "L" if (eng and far_side == "engine") else "R"
                cls[(wid, e, cav)] = "tag" + where
                (L_tag if where == "L" else R_tag).append((wid, e, cav))
    # ---- boxes
    left, right, xitems = [], [], []
    for e in devs:
        if eng and ctx.side(e) == "cab":
            b = dev_box(ctx, e, ws, wends)
            b.pins = "left"
            right.append(b)
        else:
            left.append(dev_box(ctx, e, ws, wends))
    for e in P.ENGINE_COMPUTERS:
        if e in L_c:
            left.append(comp_box(ctx, e, L_c[e], "right"))
    for e in P.JUNCTIONS:
        if e in L_j:
            left.append(jun_box(ctx, e, L_j[e], "right"))
    if L_tag:
        left.append(tag_box(ctx, L_tag, owned, num_of, "right"))
    for e in P.COMPUTERS:
        if e in R_c:
            right.append(comp_box(ctx, e, R_c[e], "left"))
    for e in P.JUNCTIONS:
        if e in R_j:
            right.append(jun_box(ctx, e, R_j[e], "left"))
    for e in ("FIREWALL-ENGINE", "FIREWALL-BODY-A", "FIREWALL-BODY-B", "FIREWALL-BODY-P", "FIREWALL-GROMMET"):
        if e not in X:
            continue
        if e == "FIREWALL-ENGINE":
            xitems.append(("face", X[e]))
            continue
        far = {}
        if not eng:
            for wid, cav in X[e]:
                far[(wid, cav)] = [(fe, fc) for fe, fc in wends[wid] if cls.get((wid, fe, fc)) == "far"]
        b = strip_box(ctx, e, X[e], far, owned, num_of, "right" if eng else "left", eng)
        if eng:
            xitems.append(("strip", b))
        else:
            right.append(b)
    if R_tag:
        right.append(tag_box(ctx, R_tag, owned, num_of, "left"))
    return {"ws": ws, "wends": wends, "cls": cls, "left": left, "right": right, "x": xitems, "eng": eng,
            "pigtail_at": pigtail_at, "merged": merged}


def dev_box(ctx, e, ws, wends):
    rows = []
    at = [(wid, cav) for wid in ws for (ee, cav) in wends[wid] if ee == e]
    at.sort(key=lambda p: (sort_key(p[1] if p[1] is not None else f"?{p[0]}"), p[0]))
    for wid, cav in at:
        text = kits_v5.dave_name(ws[wid])
        if cav is not None and cav_mark(cav) == "○" and words(cav).lower() not in text.lower():
            text = f"{words(cav)}: {text}"
        rows.append({"cav": cav, "text": text, "wires": [wid], "mark": cav_mark(cav)})
    # shielded cables: the drain gets its own row under the cable's conductors (no cavity: it floats at this end)
    out = []
    for i, r in enumerate(rows):
        out.append(r)
        wid = r["wires"][0]
        m = re.fullmatch(r"(\d+)g?", wid)
        if not m:
            continue
        base = m.group(1)
        drain = base + "s"
        conds = [q for q in (base, base + "g") if q in ws and any(ee == e for ee, _ in wends[q])]
        nxt = rows[i + 1]["wires"][0] if i + 1 < len(rows) else None
        if drain in ws and len(conds) == 2 and wid in conds and nxt not in conds:
            out.append({"cav": None, "text": "shield drain (floats at this end)", "wires": [drain], "mark": "",
                        "shield": conds})
    b = Box("dev", e, plug_title(e, ctx.eps[e]), out)
    pl = plug_part_lines(ctx.reg, e, ctx.parts)
    b.foot = []                                    # the sheet's parts table carries each plug's kit, terminals and seals
    return b


def comp_box(ctx, e, items, pins):
    per = OrderedDict()
    for wid, cav in sorted(items, key=lambda p: sort_key(p[1] if p[1] is not None else f"?{p[0]}")):
        per.setdefault(cav, [])
        if wid not in per[cav]:
            per[cav].append(wid)
    dev = e.split("-")[0]
    rows = []
    for cav, wl in per.items():
        d = ctx.desig.get((dev, norm_pin(cav))) if cav else None
        text = f"{d[0]} — {d[1]}" if d else (words(cav) if cav and not re.match(r"^[AB]\d+$", str(cav)) else "pin function not on file")
        mark = cav_mark(norm_pin(cav)) if cav else "?"
        rows.append({"cav": cav, "text": text, "wires": wl, "mark": mark})
    return Box("comp", e, plug_title(e, ctx.eps.get(e, {})), rows, pins=pins)


def jun_box(ctx, e, items, pins):
    rows = []
    for wid, cav in sorted(items, key=lambda p: (sort_key(p[1] if p[1] is not None else f"?{p[0]}"), p[0])):
        rows.append({"cav": cav, "text": f"{words(cav) if cav else 'terminal OPEN'} — {kits_v5.dave_name(ctx.wires[wid])}",
                     "wires": [wid], "mark": cav_mark(cav)})
    return Box("jun", e, plug_title(e, ctx.eps.get(e, {})), rows, pins=pins)


def dest_text(ctx, e, cav, owned, num_of):
    t = plug_title(e, ctx.eps.get(e, {}))
    c = f" {words(cav)}" if cav else " (cavity OPEN)"
    n = num_of(owned[e]) if e in owned else None
    return f"→ {t}{c} · sheet {n}" if n else f"→ {t}{c} · on no sheet: OPEN"


def tag_box(ctx, items, owned, num_of, pins):
    rows = [{"cav": None, "text": f"{wid.upper()} {dest_text(ctx, e, cav, owned, num_of)}", "wires": [wid], "mark": ""}
            for wid, e, cav in items]
    return Box("tag", "", "TO OTHER SHEETS", rows, pins=pins)


def strip_box(ctx, e, items, far, owned, num_of, pins, eng):
    """A crossing drawn as a numbered cavity strip (not the housing's shape): every cavity, lit where this sheet uses it."""
    fam, n = STRIP_FAMILY.get(e, ("pass-through, no cavities", 0))
    rows = []
    if n:
        used = defaultdict(list)
        for wid, cav in items:
            used[str(cav)].append(wid)
        for c in range(1, n + 1):
            wl = used.get(str(c), [])
            rows.append({"cav": str(c), "text": "", "wires": wl, "mark": str(c), "lit": bool(wl)})
    else:
        for wid, cav in items:
            rows.append({"cav": cav, "text": "", "wires": [wid], "mark": "○", "lit": True})
    for r in rows:
        r["far"] = []
        for wid in r["wires"]:
            for fe, fc in far.get((wid, r["cav"] if n else r["cav"]), []):
                r["far"].append(dest_text(ctx, fe, fc, owned, num_of))
    b = Box("strip", e, plug_title(e, ctx.eps.get(e, {})), rows, width=34, pins=pins)
    b.family = fam
    return b


# ------------------------------------------------------------------------------------------------ drawing
def stack(boxes, x, y0):
    y = y0
    for b in boxes:
        b.x, b.y = x, y
        y += b.span()
    return y


def draw_column_box(s, b):
    """A box of the left or right stack. Plug and computer titles link to the plug's card on the map."""
    href = (MAP_URL + b.code) if b.code and b.kind in ("dev", "comp", "jun", "strip") else None
    if b.kind == "strip":
        s.txt(b.x, b.y - 13, f"{b.title.upper()} · {b.family.upper()}", 5.6, bold=True, href=href)
        s.txt(b.x, b.y - 4, "CAVITY MAP · left: cab side · right: engine side", 4.6)
    else:
        s.txt(b.x + b.w / 2, b.y - 3, b.title.upper(), 6.4, bold=True, anchor="middle", href=href)
    if b.kind == "tag":
        s.rect(b.x, b.y, b.w, b.h, sw=0.6, rx=3, dash="2 1.5")
    else:
        s.rect(b.x, b.y, b.w, b.h, sw=1.0, rx=3 if b.kind != "strip" else 1)
    for i, r in enumerate(b.rows):
        px, yy = b.pin(i)
        if b.kind == "strip":
            lit = r.get("lit")
            fill = "#fff"
            if lit and r["wires"]:
                fill = wire_colours(CTX.wires[r["wires"][0]])[0]
            s.rect(b.x + 3, yy - 4.2, b.w - 6, 8.4, sw=0.5, fill=fill if lit else "#fff", colour="#000" if lit else "#bbb")
            s.txt(b.x + b.w / 2, yy + 2.2, r["mark"], 5.4, bold=bool(lit), anchor="middle",
                  colour=("#fff" if lit and fill in DARK else "#000") if lit else "#bbb")
            for k, ftxt in enumerate(r.get("far") or []):
                s.txt(b.x + b.w + 4, yy + 2.0, fit_tail(ftxt, W - M - (b.x + b.w + 4), 4.8), 4.8, colour="#000",
                      owner=r["wires"][0] if r["wires"] else None)
                break
            continue
        if b.pins == "right":
            mw = max(9, tw(r["mark"], 5.2, True) + 3) if r["mark"] else 0
            if r["mark"]:
                s.rect(b.x + b.w - 3 - mw, yy - 3.4, mw, 6.8, sw=0.6, fill="#fff")
                s.txt(b.x + b.w - 3 - mw / 2, yy + 2.2, r["mark"], 5.2, bold=True, anchor="middle")
            s.txt(b.x + 4, yy + 2.2, fit_tail(r["text"], b.w - 12 - mw, 5.4), 5.4, italic=b.kind == "tag" or bool(r.get("shield")))
        else:
            mw = max(9, tw(r["mark"], 5.2, True) + 3) if r["mark"] else 0
            if r["mark"]:
                s.rect(b.x + 3, yy - 3.4, mw, 6.8, sw=0.6, fill="#fff")
                s.txt(b.x + 3 + mw / 2, yy + 2.2, r["mark"], 5.2, bold=True, anchor="middle")
            s.txt(b.x + (mw + 7 if r["mark"] else 4), yy + 2.2, fit_tail(r["text"], b.w - 12 - mw, 5.4), 5.4, italic=b.kind == "tag")
    yy = b.y + b.h + 6
    for ln in b.foot:
        s.txt(b.x + 2, yy + 2, ln, 4.6, colour="#333", italic=ln.startswith("+"))
        yy += 5.4


CTX = None
DRAWN = set()
LABELLED = {}


def render(ctx, sp, page_devs, extra, number, title, owned, num_of):
    """One diagram sheet (and its facing parts/notes pages). Returns (sheet, [facing], n_wires, n_open)."""
    model = assemble(ctx, sp, page_devs, extra, owned, num_of)
    DRAWN.update(model["ws"])
    eng = model["eng"]
    ws, wends, cls = model["ws"], model["wends"], model["cls"]
    head = P.SECTION_HEAD.get(sp["section"], sp["section"].upper())
    sub = (f"{len(page_devs)} plugs · {len(ws)} circuits · label = gauge colour-circuit · length; LABEL = sleeve text · "
           f"dashed = an end or a cavity not settled · plug boxes are pin maps, not the plug's shape"
           + ("; the 61-pin is drawn to its insert arrangement" if any(k == "face" for k, _ in model["x"]) else ""))
    s = Sheet(number, title, sub, head)

    # ---- left stack
    left, right = model["left"], model["right"]
    # box widths follow their text (Dave's names are not cut short: 'UP' and 'DN' differ at the end of the line)
    def need(bs):
        return max([tw(r["text"], 5.4) + max(9, tw(r.get("mark") or "", 5.2, True) + 3) + 22
                    for b in bs if b.kind != "strip" for r in b.rows] + [BOX_W])
    wL = min(need(left), 240 if not eng else 200)
    for b in left:
        b.w = wL
    L_x = M + 10
    stack(left, L_x, TOP)
    L_r = L_x + wL
    # ---- right stack
    has_strip_right = any(b.kind == "strip" for b in right)
    wR = min(need(right), 250)
    R_w = max(wR, 210 if has_strip_right else 0)
    R_x = W - M - R_w
    for b in right:
        if b.kind != "strip":
            b.w = R_w
    stack(right, R_x, TOP)

    # label widths decide where the lanes start
    labels = {wid: wire_label(w) for wid, w in ws.items()}
    lab_w = max([tw(labels[w], LBL) for w in ws] + [60])
    zoneL = min(lab_w, 128) + 16 + (14 if any(b.kind == "comp" for b in left) else 0)
    xa0 = L_r + zoneL
    xo = L_r + zoneL - 6                           # shield ovals sit here, after the labels, before the lanes
    pts = defaultdict(list)                        # wid -> [(x, y, 'L'|'R', row, box)]
    for b in left:
        for i, r in enumerate(b.rows):
            for wid in r["wires"]:
                x_, y_ = b.pin(i)
                pts[wid].append((xo if r.get("shield") else x_, y_, "L", r, b))
    for b in right:
        for i, r in enumerate(b.rows):
            for wid in r["wires"]:
                pts[wid].append((*b.pin(i), "R", r, b))

    pig_w = [tw(wire_label(ctx.wires[pt]), LBL) for pt, _ in model["pigtail_at"].values()]
    # ---- the crossing column (engine layout)
    xin, xout, face, strips_x = {}, {}, None, []
    open_notes = []
    n_left_lanes = sum(1 for wid in ws if [p for p in pts[wid] if p[2] == "L"])
    step = 2.9
    if eng:
        laneA = (xa0, xa0 + max(n_left_lanes, 1) * step)
        X0 = laneA[1] + 26
        face_items = [it for k, it in model["x"] if k == "face"]
        strip_items = [it for k, it in model["x"] if k == "strip"]
        ybot = TOP
        if face_items:
            face = draw_face(s, ctx, face_items[0], X0 + 20, ws)
            for wid, v in face["in"].items():
                xin[wid] = v
            for wid, v in face["out"].items():
                xout[wid] = v
            ybot = face["bottom"] + 30
            xcol_r = face["right"]
        else:
            xcol_r = X0 + 60
        sx = X0 + 30
        for b in strip_items:
            b.x, b.y = sx, ybot + 14
            draw_strip_engine(s, b)
            for i, r in enumerate(b.rows):
                yy = b.pin(i)[1]
                for wid in r["wires"]:
                    xin.setdefault(wid, (b.x, yy, r["mark"], b))
                    xout.setdefault(wid, (b.x + b.w, yy, r["mark"], b))
            ybot = b.y + b.h + 22
            xcol_r = max(xcol_r, sx + b.w + 4)
        # cab-side labels after the crossing, then lane C, then the right stack
        cab_lab_w = max([tw(labels[w], LBL) for w in xout] + [0])
        xc0 = xcol_r + min(cab_lab_w, 150) + 12
        r_lab = max([tw(labels[w], LBL) for w in ws if anchor_of(w, pts, xout) == "R"] + pig_w + [0])
        xc1 = R_x - (min(r_lab, 110) + 10 if r_lab else 8)
        laneC = (xc0, xc1)
        if laneA[1] > X0 - 10 or xc0 > xc1:
            raise SystemExit(f"sheet {number}: columns do not fit ({laneA}, {laneC})")
    else:
        r_lab = max([tw(labels[w], LBL) for w in ws if anchor_of(w, pts, xout) == "R"] + pig_w + [0])
        xc1 = R_x - (min(r_lab, 110) + 10 if r_lab else 8)
        laneA = (xa0, xc1)
        laneC = None

    # ---- draw the boxes
    for b in left + right:
        draw_column_box(s, b)

    # ---- runs
    order = sorted(ws, key=lambda wid: min([p[1] for p in pts[wid]] + [9999]))
    iA = iC = 0
    nA = max(sum(1 for wid in ws if lane_needed(wid, pts, model, "L", xin)), 1)
    nC = max(sum(1 for wid in ws if lane_needed(wid, pts, model, "R", xin)), 1)
    stepA = min(3.2 if eng else 7.0, (laneA[1] - laneA[0]) / nA)
    stepC = min(3.2, (laneC[1] - laneC[0]) / nC) if laneC else 0
    open_runs, band_k = 0, 0
    splice_rows = OrderedDict()
    for wid in order:
        w = ws[wid]
        base, stripe = wire_colours(w)
        ends = wends[wid]
        unsettled = [e for e, c in ends if c is None and e != "FIREWALL-GROMMET"]
        Lp = [p for p in pts[wid] if p[2] == "L"]
        Rp = [p for p in pts[wid] if p[2] == "R"]
        n_points = len(Lp) + len(Rp) + (1 if wid in xin else 0)
        dashed = "3 2" if (unsettled or n_points < 2 or not ends) else None
        if dashed:
            open_runs += 1
        lw = 1.1
        draw = lambda P_: s.line(P_, lw, dashed, colour=base, stripe=stripe, owner=wid)
        if not Lp and not Rp and wid not in xin:
            open_notes.append((wid.upper(), "no end rows at all", endpoint_words(w)))
            continue
        if eng and wid in xin:
            # engine side: left-stack pins -> lane A -> crossing; cab side: crossing -> lane C -> right-stack pins
            xl, yl, mk, it = xin[wid]
            xr, yr, _, _ = xout[wid]
            if Lp:
                xa = laneA[0] + (iA % nA) * stepA + 1
                iA += 1
                for x_, y_, *_ in Lp:
                    draw([(x_, y_), (xa, y_)])
                ys = [p[1] for p in Lp] + [yl]
                draw([(xa, min(ys)), (xa, max(ys))])
                draw([(xa, yl), (xl, yl)])
                if len(Lp) > 1:
                    for x_, y_, *_ in Lp:
                        s.dot(xa, y_, 1.2)
                pig = [p[1] for p in Lp if (p[4].code, p[3].get("cav")) in model["pigtail_at"]]
                if wid in model["merged"] and pig:
                    s.dot(xa, (min(pig) + max(pig)) / 2, 2.4)
            if Rp:
                xc = laneC[0] + (iC % nC) * stepC + 1
                iC += 1
                draw([(xr, yr), (xc, yr)])
                ys = [p[1] for p in Rp] + [yr]
                draw([(xc, min(ys)), (xc, max(ys))])
                for x_, y_, *_ in Rp:
                    draw([(xc, y_), (x_, y_)])
                if len(Rp) > 1:
                    for x_, y_, *_ in Rp:
                        s.dot(xc, y_, 1.2)
                pig = [p[1] for p in Rp if (p[4].code, p[3].get("cav")) in model["pigtail_at"]]
                if wid in model["merged"] and pig:
                    s.dot(xc, (min(pig) + max(pig)) / 2, 2.4)   # the in-line splice (id on the pigtails and in the table)
            else:
                draw([(xr, yr), (xr + 10, yr)])
            # the cab side carries the same label
            s.txt(xr + 4, yr - 1.4, fit(labels[wid], laneC[0] - xr - 10, LBL), LBL, owner=wid)
        elif eng and Lp and Rp:
            # no crossing cavity: over the top of the sheet, dashed, stamped
            xa = laneA[0] + (iA % nA) * stepA + 1
            iA += 1
            xc = laneC[0] + (iC % nC) * stepC + 1
            iC += 1
            yb = TOP - 16 - (band_k % 4) * 3
            band_k += 1
            for x_, y_, *_ in Lp:
                draw([(x_, y_), (xa, y_)])
            draw([(xa, max(p[1] for p in Lp)), (xa, yb), (xc, yb), (xc, max(p[1] for p in Rp))])
            for x_, y_, *_ in Rp:
                draw([(xc, y_), (x_, y_)])
            if not dashed:
                open_runs += 1
                dashed = "3 2"
            open_notes.append((wid.upper(), "crosses the firewall with no crossing cavity", endpoint_words(w)))
        else:
            allp = Lp + Rp
            sides = {ctx.side(e) for e, _ in ends if e not in P.CROSSINGS} - {"x"}
            if not eng and len(sides) == 2 and not any(e in P.CROSSINGS for e, _ in ends):
                open_notes.append((wid.upper(), "crosses the firewall with no crossing cavity", endpoint_words(w)))
                if not dashed:
                    dashed = "3 2"
                    open_runs += 1
                    draw = lambda P_: s.line(P_, lw, dashed, colour=base, stripe=stripe, owner=wid)
            if len(allp) >= 2:
                if eng and not Lp:
                    xa = laneC[0] + (iC % nC) * stepC + 1
                    iC += 1
                else:
                    xa = laneA[0] + (iA % nA) * stepA + 1
                    iA += 1
                for x_, y_, *_ in allp:
                    draw([(x_, y_), (xa, y_)])
                ys = [p[1] for p in allp]
                draw([(xa, min(ys)), (xa, max(ys))])
                if len(allp) > 2:
                    for x_, y_, *_ in allp:
                        s.dot(xa, y_, 1.2)
                if wid in model["merged"]:
                    pig = [p[1] for p in allp if (p[4].code, p[3].get("cav")) in model["pigtail_at"]] or [allp[0][1]]
                    s.dot(xa, (min(pig) + max(pig)) / 2, 2.4)   # between the pigtails: never on another run's row
            else:
                x_, y_, where, r, b = allp[0]
                d = 10 if where == "L" else -10
                draw([(x_, y_), (x_ + d, y_)])
                open_notes.append((wid.upper(), "one end drawn; the other end has no end row", endpoint_words(w)))
                if not dashed:
                    open_runs += 1
        # labels: at every plug end in the left stack, else at the first left-stack end, else at the first right-stack end
        notpig = lambda p: (p[4].code, p[3].get("cav")) not in model["pigtail_at"]
        # a pin several runs share takes one label; the others are labelled at their other end
        taken = LABELLED.setdefault(id(s), set())
        free_pt = lambda p: (p[4].code, p[3].get("cav"), p[1]) not in taken
        anc = [p for p in Lp if p[4].kind == "dev"] or sorted([p for p in Lp if notpig(p) and free_pt(p)],
                                                               key=lambda p: len(p[3]["wires"]))[:1]
        for p in anc:
            taken.add((p[4].code, p[3].get("cav"), p[1]))
        for x_, y_, _w, r_, b_ in anc:
            x_ = b_.x + b_.w + (14 if b_.kind == "comp" else 0)     # clear of a splice dot at a computer pin
            s.txt(x_ + 4, y_ - 1.4, fit(labels[wid], zoneL - 14 - (x_ - b_.x - b_.w), LBL), LBL, owner=wid)
            s.txt(x_ + 4, y_ + 4.6, circuit_label(w), LBL2, colour="#333", owner=wid)
        rp_ = sorted([p for p in Rp if notpig(p) and free_pt(p)], key=lambda p: (p[4].kind != "dev", len(p[3]["wires"])))
        if not anc and rp_:
            x_, y_ = rp_[0][0], rp_[0][1]
            taken.add((rp_[0][4].code, rp_[0][3].get("cav"), y_))
            s.txt(x_ - 18, y_ - 1.4, fit(labels[wid], 100, LBL), LBL, anchor="end", owner=wid)
            s.txt(x_ - 18, y_ + 4.6, circuit_label(w), LBL2, colour="#333", anchor="end", owner=wid)
    # shields: dashed oval around the cable's conductors near the plug; the drain leaves the oval (its run is drawn
    # with the others from the oval's point)
    for b in left:
        for i, r in enumerate(b.rows):
            if not r.get("shield"):
                continue
            ys = [b.pin(k)[1] for k, rr in enumerate(b.rows) if rr["wires"] and rr["wires"][0] in r["shield"]]
            drain = r["wires"][0]
            y_top, y_bot = min(ys) - 3.5, max(ys) + 3.5
            s.el.append(f'<ellipse cx="{xo:.1f}" cy="{(y_top + y_bot) / 2:.1f}" rx="3.2" ry="{(y_bot - y_top) / 2:.1f}" '
                        f'fill="none" stroke="#000" stroke-width="0.6" stroke-dasharray="1.6 1.2"/>')
            base, stripe = wire_colours(ws[drain])
            s.line([(xo, y_bot), (xo, b.pin(i)[1])], 1.1, None, colour=base, stripe=stripe, owner=drain)
    # splice dots at computer pins (registry splice list, S-nn), or an OPEN dot where wires share a pin without one
    for b in right + left:
        if b.kind != "comp":
            continue
        for i, r in enumerate(b.rows):
            sps = [sp_ for sp_ in ctx.splices if sp_["endpoint"] == b.code and sp_["cav"] == norm_pin(r["cav"])]
            if len(r["wires"]) < 2 and not sps:
                continue
            px, py = b.pin(i)
            dx = -8 if b.pins == "left" else 8
            s.dot(px + dx, py, 2.0)
            ids = "/".join(x["id"] for x in sps) or "S-?"
            s.txt(px + dx, py + 6.2, ids, 4.2, bold=True, anchor="middle", colour="#000" if sps else ORANGE)
            for x in sps:
                splice_rows[x["id"]] = (x["id"], f"{b.code} {r['cav']}", ", ".join(str(q).upper() for q in x["wires"]),
                                        str(x.get("splice") or "OPEN"), "formboard: OPEN")
            if not sps:
                splice_rows[f"?{b.code}{r['cav']}"] = ("S-?", f"{b.code} {r['cav']}", ", ".join(q.upper() for q in r["wires"]),
                                                        "OPEN: not in the splice list", "formboard: OPEN")
    # in-line splices: each pigtail labelled at its computer pin with the splice id
    for b in right + left:
        if b.kind != "comp":
            continue
        for i, r in enumerate(b.rows):
            hit = model["pigtail_at"].get((b.code, r["cav"]))
            if not hit:
                continue
            pt, sid = hit
            px, py = b.pin(i)
            pw = ctx.wires[pt]
            if b.pins == "left":
                s.txt(px - 18, py - 1.4, fit(wire_label(pw), 100, LBL), LBL, anchor="end", owner=r["wires"][0])
                s.txt(px - 18, py + 4.6, f"{circuit_label(pw)} · {sid}", LBL2, colour="#333", anchor="end", owner=r["wires"][0])
            else:
                s.txt(px + 4, py - 1.4, fit(wire_label(pw), zoneL - 14, LBL), LBL, owner=r["wires"][0])
                s.txt(px + 4, py + 4.6, f"{circuit_label(pw)} · {sid}", LBL2, colour="#333", owner=r["wires"][0])
    for wid, rec in model["merged"].items():
        pts_ = [str(x).upper() for x in rec["sides"][0]]
        splice_rows[rec["id"]] = (rec["id"], "in-line", f"{' + '.join(pts_)} → {wid.upper()}", str(rec.get("splice") or "OPEN"),
                                  "formboard: OPEN")
    if sp["key"] == "data":
        draw_can_topology(s, ctx, open_notes)
    # ---- tables: parts, splices, ends not recorded, shield rule
    lowest = max([b.y + b.span() for b in left + right] + [TOP] + [face["bottom"] if face else TOP] +
                 [b.y + b.h + 20 for k, b in model["x"] if k == "strip"])
    eps_on = [b.code for b in left + right if b.kind in ("dev", "jun") and b.code]
    jw = {b.code: {w_ for r in b.rows for w_ in r["wires"]} for b in left + right if b.kind == "jun"}
    plist = sheet_parts(ctx.reg, eps_on, ctx.parts, jw)
    shield_line = None
    if any(r.get("shield") for b in left for r in b.rows):
        shield_line = ("SHIELDS: " + ctx.shield_rule) if ctx.shield_rule else "SHIELDS: drain grounding end OPEN"
    facing = place_tables(s, ctx, number, title, head, lowest, plist, list(splice_rows.values()), open_notes, shield_line)
    s.txt(M, H - M + 8, f"{len(ws)} circuits drawn from the wire list · {open_runs} stamped OPEN (an end or a cavity not settled) · "
          f"cavity marks are the moulded letters; positions are indicative · lengths are estimates until measured on the truck", 6)
    return s, facing, len(ws) + len(model["pigtail_at"]), open_runs


def lane_needed(wid, pts, model, side, xin=None):
    Lp = [p for p in pts[wid] if p[2] == "L"]
    Rp = [p for p in pts[wid] if p[2] == "R"]
    if not model["eng"]:
        return side == "L" and len(Lp) + len(Rp) >= 2
    crossing = xin is not None and wid in xin
    if side == "L":
        return bool(Lp) and (crossing or bool(Rp) or len(Lp) >= 2)
    return bool(Rp) and (crossing or bool(Lp) or len(Rp) >= 2)


def anchor_of(wid, pts, xout):
    Lp = [p for p in pts[wid] if p[2] == "L"]
    return "L" if Lp else ("R" if [p for p in pts[wid] if p[2] == "R"] else "-")


def endpoint_words(w):
    def one(v):
        if isinstance(v, dict):
            return f"{v.get('device') or ''} {v.get('pin') or ''}".strip()
        return str(v or "not recorded")
    return words(f"from {one(w.get('frm'))} to {one(w.get('to'))}")


def draw_strip_engine(s, b):
    href = MAP_URL + b.code
    s.txt(b.x + b.w / 2, b.y - 22, b.title.upper(), 5.6, bold=True, anchor="middle", href=href)
    s.txt(b.x + b.w / 2, b.y - 13, b.family.upper() + " · CAVITY MAP", 4.6, anchor="middle")
    s.txt(b.x + b.w / 2, b.y - 4, "engine side | cab side", 4.2, anchor="middle")
    s.rect(b.x, b.y, b.w, b.h, sw=1.0, rx=1)
    for i, r in enumerate(b.rows):
        yy = b.pin(i)[1]
        lit = r.get("lit")
        fill = wire_colours(CTX.wires[r["wires"][0]])[0] if lit and r["wires"] else "#fff"
        s.rect(b.x + 3, yy - 4.2, b.w - 6, 8.4, sw=0.5, fill=fill, colour="#000" if lit else "#bbb")
        s.txt(b.x + b.w / 2, yy + 2.2, r["mark"], 5.4, bold=bool(lit), anchor="middle",
              colour=("#fff" if fill in DARK else "#000") if lit else "#bbb")


def draw_face(s, ctx, items, x_left, ws):
    """The 61-pin drawn to its insert arrangement (MILNEC 25-61, transcribed in scripts/generate_connector_build_sheets.py
    CAV_XY), engine-side mating face (the mirror of the insert's front face). Only this sheet's cavities are lit; runs end
    at the rim at the cavity's height with the cavity letter, never crossing the face."""
    sheets = kits_v5._load_sheets()
    xy = sheets.CAV_XY
    xs_ = [v[0] for v in xy.values()]; ys_ = [v[1] for v in xy.values()]
    cx0, cy0 = (min(xs_) + max(xs_)) / 2, (min(ys_) + max(ys_)) / 2
    span = max(max(xs_) - min(xs_), max(ys_) - min(ys_))
    R = 92.0
    scale = (2 * R - 22) / span
    bulk_cx, bulk_cy = x_left + 16 + R, TOP + 30 + R
    lit = {}
    for wid, cav in items:
        if cav in xy and wid in ws:
            lit.setdefault(cav, wid)
    slot, prev = {}, None
    for cav in sorted(lit, key=lambda c: xy[c][1]):
        y_ = bulk_cy + (xy[cav][1] - cy0) * scale
        if prev is not None and y_ - prev < 6.5:
            y_ = prev + 6.5
        slot[cav] = y_
        prev = y_
    s.el.append(f'<circle cx="{bulk_cx:.1f}" cy="{bulk_cy:.1f}" r="{R:.1f}" fill="none" stroke="#000" stroke-width="1.1"/>')
    s.rects.append((bulk_cx - R, bulk_cy - R, bulk_cx + R, bulk_cy + R))
    s.rect(bulk_cx - 6, bulk_cy - R - 6, 12, 7, sw=0.9, rx=1.5)
    for cav, (px_, py_) in xy.items():
        X = bulk_cx - (px_ - cx0) * scale
        Y = bulk_cy + (py_ - cy0) * scale
        if cav in lit:
            base_, stripe_ = wire_colours(ws[lit[cav]])
            s.el.append(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="6.4" fill="{base_}" stroke="#000" stroke-width="0.9"/>')
            if stripe_:
                cid = f"clip_{tag_id(cav)}_{len(s.el)}"
                s.el.append(f'<clipPath id="{cid}"><circle cx="{X:.1f}" cy="{Y:.1f}" r="6.4"/></clipPath>'
                            f'<rect x="{X - 7:.1f}" y="{Y + 1.6:.1f}" width="14" height="2.4" fill="{stripe_}" clip-path="url(#{cid})"/>')
            s.txt(X, Y + 2.1, cav, 5.4, bold=True, anchor="middle", colour="#fff" if base_ in DARK else "#000")
        else:
            s.el.append(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="6.4" fill="none" stroke="#bbb" stroke-width="0.5"/>')
            s.txt(X, Y + 2.1, cav, 5.0, anchor="middle", colour="#bbb")
    s.txt(bulk_cx, bulk_cy - R - 20, "61-PIN FIREWALL CONNECTOR", 6.4, bold=True, anchor="middle", href=MAP_URL + "FIREWALL-ENGINE")
    s.txt(bulk_cx, bulk_cy - R - 11, "ENGINE SIDE, MATING FACE (SOCKETS, FEMALE)", 5.6, bold=True, anchor="middle")
    s.txt(bulk_cx, bulk_cy + R + 11, "D38999/24WJ61SN receptacle · insert 25-61", 5.4, anchor="middle")
    s.txt(bulk_cx, bulk_cy + R + 18, "lit = on this sheet, in the wire's colour", 5.4, anchor="middle")
    out_in, out_out = {}, {}
    right = bulk_cx + R + 4
    for cav, wid in lit.items():
        by = slot[cav]
        dy = min(abs(by - bulk_cy), R - 0.5)
        half = (R * R - dy * dy) ** 0.5
        rim_l, rim_r = bulk_cx - half, bulk_cx + half
        tw_ = tw(cav, 5.2, True)
        s.txt(rim_l - 3, by + 1.9, cav, 5.2, bold=True, anchor="end", owner=wid)
        s.txt(rim_r + 3, by + 1.9, cav, 5.2, bold=True, owner=wid)
        right = max(right, rim_r + tw_ + 8)
        for w2, c2 in items:
            if c2 == cav and w2 in ws:
                out_in[w2] = (rim_l - tw_ - 8, by, cav, None)
                out_out[w2] = (rim_r + tw_ + 8, by, cav, None)
    # every run to a cavity on the right leaves at the same x so the cab labels line up
    for w2 in out_out:
        out_out[w2] = (right, *out_out[w2][1:])
    for w2, (x_, y_, cav, _) in list(out_out.items()):
        dy = min(abs(y_ - bulk_cy), R - 0.5)
        rim_r = bulk_cx + (R * R - dy * dy) ** 0.5 + tw(cav, 5.2, True) + 8
        s.line([(rim_r, y_), (right, y_)], 1.1, None, colour=wire_colours(ws[w2])[0], stripe=wire_colours(ws[w2])[1], owner=w2)
    return {"in": out_in, "out": out_out, "bottom": bulk_cy + R + 22, "right": right}


def draw_can_topology(s, ctx, open_notes):
    """The CAN trunk as the CAN-BUS row gives it (MoTeC PDM manual p.49-50): nodes in trunk order, a 100R where a node's
    role says so, the UTC stub, and the rules (twist, stub length, cable). The OPEN items print as they stand."""
    cb = ctx.eps.get("CAN-BUS") or {}
    topo = cb.get("topology")
    if not topo:
        open_notes.append(("CAN-BUS", "trunk order and terminators not in the wire list", "CAN bus topology: OPEN"))
        return
    x0, x1 = M + 20, W - M - 20
    y0 = free_below(s, M, W - M) + 34
    s.txt(M, y0 - 16, "CAN BUS TRUNK — ORDER, TERMINATORS AND STUBS (FROM THE CAN BUS ROW)", 7, bold=True)
    nodes = topo.get("order") or []
    n = len(nodes)
    gap = (x1 - x0) / max(n, 1)
    yh, yl = y0 + 8, y0 + 16                        # CAN Hi (yellow) above CAN Lo (green), as the trunk is coloured
    xs = [x0 + gap * (i + 0.5) for i in range(n)]
    s.line([(xs[0], yh), (xs[-1], yh)], 1.4, None, colour=HEX["yellow"], owner="can-topology")
    s.line([(xs[0], yl), (xs[-1], yl)], 1.4, None, colour=HEX["green"], owner="can-topology")
    s.txt(xs[0] + 30, yh - 3, "CAN HI", 4.6, bold=True, owner="can-topology")
    s.txt(xs[0] + 30, yl + 7, "CAN LO", 4.6, bold=True, owner="can-topology")
    bw = min(gap - 16, 200)
    for i, nd in enumerate(nodes):
        x = xs[i]
        s.line([(x, yh), (x, y0 + 34)], 0.8, None, owner="can-topology")
        s.dot(x, yh, 1.4)
        s.line([(x + 4, yl), (x + 4, y0 + 34)], 0.8, None, owner="can-topology")
        s.dot(x + 4, yl, 1.4)
        if "100R" in str(nd.get("role") or ""):
            tx = x - 14 if i == 0 else x + 14
            s.line([(tx, yh), (tx, yh + 1.5)], 0.8, None, owner="can-topology")
            s.rect(tx - 2, yh + 1.5, 4, 5, sw=0.8, fill="#fff")
            s.line([(tx, yh + 6.5), (tx, yl)], 0.8, None, owner="can-topology")
            s.txt(tx + (-4 if i == 0 else 4), y0 - 2, "100R", 4.8, bold=True, anchor="end" if i == 0 else "start")
        s.rect(x - bw / 2, y0 + 34, bw, 30, sw=0.9, rx=2)
        s.txt(x, y0 + 43, str(nd.get("node") or "").upper(), 5.6, bold=True, anchor="middle")
        s.txt(x, y0 + 51, fit(str(nd.get("pins") or ""), bw - 6, 4.6), 4.6, anchor="middle")
        s.txt(x, y0 + 59, fit(str(nd.get("role") or ""), bw - 6, 4.6), 4.6, italic=True, anchor="middle")
    y = y0 + 78
    for st in topo.get("stubs") or []:
        s.txt(M, y, fit(f"STUB: {st.get('node')} · {st.get('pins')} · {st.get('rule')}", W - 2 * M, 5.4), 5.4)
        y += 8
    for k, lab in (("terminators", "TERMINATORS"), ("twist", "TWIST"), ("cable", "CABLE")):
        if topo.get(k):
            s.txt(M, y, f"{lab}: {topo[k]}", 5.4)
            y += 8
    if topo.get("stub_max_mm"):
        s.txt(M, y, f"STUB LENGTH: {topo['stub_max_mm']} mm max off the trunk; UTC stub within {topo.get('utc_within_mm_of_end', 'OPEN')} mm "
              f"of a trunk end; whole bus {topo.get('bus_max_m', 'OPEN')} m max", 5.4)
        y += 8
    srcs = [x for x in topo.get("sources") or [] if not kits_v5.book_lint(x)]
    if srcs:
        s.txt(M, y, fit("From: " + " · ".join(srcs), W - 2 * M, 5.0), 5.0, italic=True)
        y += 8
    for o in cb.get("open") or []:
        s.txt(M, y, fit(f"OPEN: {o}", W - 2 * M, 5.4), 5.4, colour=ORANGE)
        y += 8
    s.rects.append((M, y0 - 24, W - M, y))


def free_below(s, x0, x1):
    """The lowest drawn thing (text, run, box) over the column x0..x1: a table may start below it."""
    y = TOP
    for bx0, by0, bx1, by1, *_ in s.boxes:
        if bx0 < x1 and bx1 > x0 and by0 > M + 30:
            y = max(y, by1)
    for _o, pts in s.runs:
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            if min(ax, bx) < x1 and max(ax, bx) > x0:
                y = max(y, ay, by)
    for rx0, ry0, rx1, ry1 in s.rects:
        if rx0 < x1 and rx1 > x0:
            y = max(y, ry1)
    return y


def place_tables(s, ctx, number, title, head, lowest, plist, splices, open_notes, shield_line):
    """Parts, splices and ends not recorded go in the clear space under the drawing (searched column by column); what
    does not fit goes on facing pages. The shield rule prints at the foot of the sheet."""
    blocks = []
    rows_of = lambda L: [(c, fit(n, 206, 5.2), k, q, fit(", ".join(u), 224, 5.2)) for c, n, k, q, u in L]
    if plist:
        blocks.append(("PARTS ON THIS SHEET", [92, 210, 46, 66, 228], ["Part number", "Part", "Kind", "Qty", "Used on"], rows_of(plist)))
    if splices:
        blocks.append(("SPLICES ON THIS SHEET", [34, 70, 300, 110, 70], ["Id", "At pin", "Wires joined", "Splice part", "Position"],
                       [(a, b, fit(c, 296, 5.2), d, e) for a, b, c, d, e in splices]))
    if open_notes:
        blocks.append(("ENDS NOT RECORDED (OPEN)", [70, 170, 300], ["Circuit", "What is missing", "As the wire list gives it"],
                       [(a, b, fit(c, 296, 5.2)) for a, b, c in open_notes]))
    floor = H - M - 14
    rest = []
    for name, widths, hdr, rows in blocks:
        tw_ = sum(widths)
        need = 12 + (len(rows) + 1) * 8.2 + 6
        best = None
        x0 = M
        while x0 + tw_ <= W - M:
            y0 = free_below(s, x0 - 6, x0 + tw_ + 6) + 26
            if y0 + need <= floor and (best is None or y0 < best[1] - 0.1):
                best = (x0, y0)
            x0 += 24
        if best:
            s.txt(best[0], best[1] - 4, name, 7, bold=True)
            table(s, best[0], best[1], widths, hdr, rows)
        else:
            rest.append((name, widths, hdr, rows))
    if shield_line:
        s.txt(M, H - M - 2, shield_line, 5.6, bold=True)
    facing = []
    if rest:
        s.txt(W - M, H - M - 2, f"continued on the facing page: {', '.join(b[0].lower() for b in rest)}", 5.4, italic=True, anchor="end")
        per = int((H - M - 90) / 8.2) - 2
        pages, cur, used = [], [], 0
        for name, widths, hdr, rows in rest:
            for i in range(0, len(rows), per):
                chunk = rows[i:i + per]
                if used + len(chunk) + 4 > per and cur:
                    pages.append(cur)
                    cur, used = [], 0
                cur.append((name, widths, hdr, chunk))
                used += len(chunk) + 4
        if cur:
            pages.append(cur)
        for pg in pages:
            e = Sheet("", title + " — parts and notes", "for the sheet before this one", head)
            yy = M + 58
            for name, widths, hdr, rows in pg:
                e.txt(M, yy - 4, name, 7, bold=True)
                yy = table(e, M, yy, widths, hdr, rows) + 22
            facing.append(e)
    return facing


def table(s, x, y, widths, header, rows, size=5.2, lead=8.2):
    total, top = sum(widths), y
    y += lead + 1
    cx = x
    for w_, h_ in zip(widths, header):
        s.txt(cx + 2.5, y - 2.4, h_.upper(), size, bold=True)
        cx += w_
    s.line([(x, y + 1.2), (x + total, y + 1.2)], 0.7)
    y += 1.2
    for r in rows:
        y += lead
        cx = x
        for w_, v in zip(widths, r):
            s.txt(cx + 2.5, y - 2.4, str(v), size)
            cx += w_
    y += 2.5
    s.rect(x, top, total, y - top, sw=0.8)
    return y


def paginate(ctx, sp, owned, budget=H - TOP - M - 14):
    """Split a sheet's plugs into pages whose left and right stacks each fit one column (no wrapping), as evenly as the
    fit allows."""
    devs = sp["devs"]
    num_of = lambda k: "1-0"

    def fits(page, first):
        m = assemble(ctx, sp, page, sp["extra"] if first else [], owned, num_of)
        return max(sum(b.span() for b in m["left"]), sum(b.span() for b in m["right"])) <= budget

    for k in range(1, len(devs) + 1):
        size = math.ceil(len(devs) / k)
        pages = [devs[i:i + size] for i in range(0, len(devs), size)]
        if all(fits(pg, i == 0) for i, pg in enumerate(pages)):
            return pages
    return [[e] for e in devs] or [[]]


def set_number(sh, number):
    """Facing pages are numbered after their sheet: the header text is rewritten in place."""
    old = sh.number
    sh.number = number
    for i, e in enumerate(sh.el):
        if f">{escape(old)}</text>" in e and 'text-anchor="end"' in e and 'font-size="9"' in e:
            sh.el[i] = e.replace(f">{escape(old)}</text>", f">{escape(number)}</text>")
            break
    sh.boxes = [(b[0], b[1], b[2], b[3], number if b[4] == old else b[4], b[5], b[6]) for b in sh.boxes]


def add_links(pdf_path, boxes, page_h):
    """rsvg-convert drops SVG links; write them back as PDF link annotations from the recorded text boxes."""
    try:
        from pypdf import PdfReader, PdfWriter
        from pypdf.annotations import Link
    except ImportError:
        return 0
    links = [b for b in boxes if len(b) > 5 and b[5]]
    if not links:
        return 0
    r = PdfReader(str(pdf_path)); w = PdfWriter(); w.append(r)
    for b in links:
        x0, y0, x1, y1, _t, href = b[:6]
        w.add_annotation(page_number=0, annotation=Link(rect=(x0 - 1, page_h - y1 - 1, x1 + 1, page_h - y0 + 1), url=href))
    w.write(str(pdf_path))
    return len(links)


def build(first_number=6):
    global CTX
    ctx = CTX = Ctx()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("K5_diagram_*"):          # sheet numbers move when the plan changes: no stale sheets left behind
        old.unlink()
    sheets, owned = plan(ctx)
    pages = []                                     # (sheet plan row, devs on the page, extra wires, page index, n pages)
    for sp in sheets:
        pg = paginate(ctx, sp, owned)
        for i, devs in enumerate(pg):
            pages.append((sp, devs, sp["extra"] if i == 0 else [], i, len(pg)))
    # numbering: pass 1 counts the facing pages, pass 2 draws with the final numbers (tags need the owner's number)
    n_facing = [0] * len(pages)
    for attempt in range(3):
        nums, n = [], first_number
        for k in range(len(pages)):
            nums.append(n)
            n += 1 + n_facing[k]
        page_of = {}
        for k, (sp, devs, _x, _i, _n) in enumerate(pages):
            for e in devs:
                page_of[e] = f"1-{nums[k]}"
        key_first = {}
        for k, (sp, devs, _x, _i, _n) in enumerate(pages):
            key_first.setdefault(sp["key"], f"1-{nums[k]}")
        owner_page = dict(page_of)
        for e, off in P.POWER_PLUGS.items():       # power_v5's sheets follow these (manual_v5.build numbers them so)
            owner_page[e] = f"1-{n + off}"
        rendered, changed = [], False
        for k, (sp, devs, extra, i, npg) in enumerate(pages):
            t = sp["title"] + (f" ({i + 1} of {npg})" if npg > 1 else "")
            s, facing, nw, nopen = render(ctx, sp, devs, extra, f"1-{nums[k]}", t, owned_pages(owned, owner_page),
                                          lambda code: code)
            if len(facing) != n_facing[k]:
                n_facing[k] = len(facing)
                changed = True
            rendered.append((sp, s, facing, nw, nopen, t))
        if not changed:
            break
    made, bad_all, sections = [], [], []
    for k, (sp, s, facing, nw, nopen, t) in enumerate(rendered):
        for j, sh in enumerate([s] + facing):
            number = f"1-{nums[k] + j}"
            if j:
                set_number(sh, number)
            text = " ".join(re.sub(r"<[^>]+>", " ", e) for e in sh.el)
            bad = [b for b in kits_v5.book_lint(text) if not b.startswith("unstamped")]
            bad += [f"overprint: '{a}' over '{b}'" for a, b in overlaps(sh)]
            bad += [f"run {r} strikes text '{t_}'" for t_, r in run_strikes(sh)]
            if bad:
                bad_all += [f"{number} {sp['key']}: {b}" for b in bad]
            stem = OUT / f"K5_diagram_{number}_{sp['key']}{'' if j == 0 else '_parts'}"
            stem.with_suffix(".svg").write_text(sh.svg())
            subprocess.run(["rsvg-convert", "-d", "150", "-p", "150", "-o", str(stem.with_suffix(".png")), str(stem.with_suffix(".svg"))], check=True)
            subprocess.run(["rsvg-convert", "-f", "pdf", "-o", str(stem.with_suffix(".pdf")), str(stem.with_suffix(".svg"))], check=True)
            add_links(stem.with_suffix(".pdf"), sh.boxes, H)
            made.append((number, t if j == 0 else t + " — parts and notes", nw if j == 0 else 0, nopen if j == 0 else 0,
                         str(stem.with_suffix(".pdf"))))
            sections.append(sp["section"])
    if bad_all:
        raise SystemExit(f"diagrams break the book's rules ({len(bad_all)}):\n  " + "\n  ".join(bad_all[:40]))
    # leftovers: every plug owned by exactly one sheet; every other endpoint drawn somewhere
    left = [e for e, ep in ctx.eps.items() if ep.get("wires") and e not in owned and e not in P.COMPUTERS
            and e not in P.JUNCTIONS and e not in P.CROSSINGS and e not in ctx.inline and e not in P.POWER_PLUGS]
    undrawn_splices = [e for e, rec in ctx.inline.items() if str(rec["sides"][1][0]) not in DRAWN]
    for (num, t, nw, nopen, pdf), sec in zip(made, sections):
        print(f"{num} [{sec}] {t}: {nw} circuits, {nopen} open -> {Path(pdf).name}")
    by_sec = defaultdict(list)
    for e in left:
        by_sec[SUB2SECTION.get(next((ctx.wires[str(w)].get("subsystem") for w in ctx.eps[e]["wires"] if str(w) in ctx.wires), None), "?")].append(e)
    print(f"plugs on no sheet ({len(left)}): " + ("; ".join(f"{k}: {', '.join(v)}" for k, v in by_sec.items()) or "none"))
    print(f"in-line splices drawn as dots on their runs: {len(ctx.inline)}; on no sheet: {', '.join(undrawn_splices) or 'none'}")
    nowhere = [wid for wid in ctx.wires if not ctx.ends.get(wid)]
    undrawn = [wid for wid in ctx.wires if wid not in DRAWN and wid not in ctx.pigtail_of and ctx.ends.get(wid)
               and wid not in ctx.power_wires]
    print(f"wires left to the DC primary / ground sheets ({len(ctx.power_wires)}): {', '.join(ctx.power_wires)}")
    print(f"plugs drawn on the DC primary sheet: {', '.join(P.POWER_PLUGS)}")
    print(f"wires with end rows drawn on no sheet ({len(undrawn)}): {', '.join(undrawn) or 'none'}")
    print(f"wires with no end rows ({len(nowhere)}): {', '.join(nowhere)}")
    return made


def owned_pages(owned, owner_page):
    """owned plug -> the number of the page that draws it (the tags' 'sheet 1-N')."""
    return {e: owner_page.get(e) for e in list(owned) + list(P.POWER_PLUGS)}


if __name__ == "__main__":
    build()
