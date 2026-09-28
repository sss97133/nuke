#!/usr/bin/env python3
"""diagram_v5.py — wiring diagram foldouts in the GM booklet style, drawn from k5_registry.json.

Conventions copied from ST-352-78 'Cab, Engine and Chassis Wiring — C,K-10 thru 35' (reference_documents/
wiring_diagram_booklets, sheets A-1/A-2, 2448 x 836 pt foldouts): every device is a box seen from its plug with the
cavity markings; every wire is an orthogonal run labelled gauge · colour · circuit ("18 BRN-9F"); in-line connectors
are drawn as a strip of cavities the runs pass through; grounds end at a ground symbol. Nothing is drawn that is not
a row: a wire end without a cavity is drawn dashed and stamped OPEN.
Sheets (11 x 17 landscape): one per wire group of a harness section. Run after options_v5.py.
Output: docs/wiring/output/manual/K5_diagram_<sheet>.svg/.png/.pdf; the manual's build() appends them.
"""
import json
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

OUT = CD.parent / "output" / "manual"
W, H, M = 1224, 792, 36                                # tabloid landscape, points
ROW = 9.2                                              # one wire row
ORANGE = "#E67300"                                     # OPEN stamps (the sheet convention since 2026-06-09)
HEX = {"white": "#f2f2f2", "black": "#111111", "red": "#d3222a", "orange": "#f28c28", "yellow": "#e8c31c", "green": "#1f8a3b",
       "blue": "#2457c5", "brown": "#7a4a1d", "gray": "#8a8a8a", "grey": "#8a8a8a", "violet": "#7b3fa0", "purple": "#7b3fa0",
       "pink": "#e58fb6", "tan": "#c8a675", "cable": "#555555", "shld": "#555555"}


def wire_colours(w):
    """(base hex, stripe hex or None) from the registry colour words ('white/red' = white with a red stripe)."""
    col = str(w.get("color") or "").lower().split("+")[0]
    parts = [x.strip() for x in col.split("/") if x.strip()]
    base = HEX.get(parts[0], "#333333") if parts else "#333333"
    stripe = HEX.get(parts[1]) if len(parts) > 1 else None
    return base, stripe
TRACK = 3.6                                            # channel spacing between vertical runs
BOX_W = 150

# ------------------------------------------------ sheet plan: engine harness (section 1)
# (key, title, device regex). Junctions (rails, ground bank, studs, engine PDM) are drawn in their own column on every
# sheet where a wire reaches them. Engine plugs on no sheet are listed by build() so nothing goes missing silently.
ENGINE_SHEETS = [
    ("sensors", "Engine sensors", r"^(CKP|CMP|MAP|IAT|CLT-ECU|OILP-ECU|OILT|OTS|FPS|KNOCK-\d|LTCD|WIDEBAND)$"),
    ("coils", "Ignition coils", r"^COIL-\d$"),
    ("injectors", "Fuel injectors", r"^INJ-\d$"),
    ("throttle-power", "Throttle body, engine PDM, charging and CAN", r"^(TB|ALT|ALTERNATOR|STARTER.*|ISOLATOR|ODYSSEY|ACC-BATT|DCDC|DC-.*|RADIATOR.*|FAN|AC-.*|PCS.*|CAN-.*|PORT-.*)$"),
    ("front-body", "Front lamps, horn, wipers, blower, brake booster and fuel pump (engine side of the body harness)", r".*"),
]
JUNCTION_RX = r"^(RAIL-.*|GND-BANK-ENG|PS-STUDS|PDM15-.*|COIL-GROUND.*|GND-SPLICE.*|PDM15.*)$"
CAB_BOXES = ("M130-A", "M130-B", "PDM30-A", "PDM30-B")
# Dave's words for plug titles (the book's rule: no cut-list codes on a page)
TITLES = {"CKP": "crank sensor", "CMP": "cam sensor", "MAP": "MAP sensor", "CLT-ECU": "coolant temp sensor",
          "OILP-ECU": "oil pressure sensor", "IAT": "inlet air temp sensor", "KNOCK-1": "knock sensor 1",
          "KNOCK-2": "knock sensor 2", "TB": "throttle body", "APS": "gas pedal", "FPS": "fuel pressure sensor",
          "OILT": "oil temp sensor", "LTCD": "lambda module", "OTS": "oil temp sensor", "M130-A": "MoTeC M130, connector A",
          "M130-B": "MoTeC M130, connector B", "PDM30-A": "MoTeC PDM30, connector A", "PDM30-B": "MoTeC PDM30, connector B",
          "PDM15-A": "engine PDM15, connector A", "PDM15-B": "engine PDM15, connector B", "GND-BANK-ENG": "ground star",
          "PS-STUDS": "power studs and lugs", "RAIL-COIL_PWR": "coil +12 V rail", "RAIL-INJ_PWR": "injector +12 V rail"}
CODE_WORDS = [(r"\bCKP\b", "crank"), (r"\bCMP\b", "cam"), (r"\bCLT\b", "coolant temp"), (r"\bIAT\b", "inlet air temp"),
              (r"\bOPS\b", "oil PSI"), (r"\bETB\b", "throttle body"), (r"\bAPS\b", "gas pedal"), (r"\bOTS\b", "oil temp"),
              (r"\bTAC\b", "throttle")]


def plug_title(e, ep):
    m = re.match(r"^(COIL|INJ)-(\d+)$", e)
    if m:
        return f"{'coil' if m.group(1) == 'COIL' else 'injector'} {m.group(2)}"
    t = TITLES.get(e) or (ep.get("device") or e).split("(")[0].split(" — ")[0][:40]
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
    def __init__(self, number, title, subtitle):
        self.el, self.number = [], number
        self.txt(W / 2, M - 8, "ENGINE HARNESS — WIRING DIAGRAM", 9, bold=True, anchor="middle")
        self.txt(W - M, M - 8, number, 9, bold=True, anchor="end")
        self.txt(W / 2, M + 14, title.upper(), 14, bold=True, anchor="middle")
        self.txt(W / 2, M + 26, subtitle, 7, anchor="middle")

    def txt(self, x, y, s, size, bold=False, anchor="start", italic=False, colour="#000"):
        st = ' font-style="italic"' if italic else ""
        self.el.append(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" fill="{colour}" '
                       f'font-weight="{"bold" if bold else "normal"}" text-anchor="{anchor}"{st}>{escape(str(s))}</text>')

    def line(self, pts, w=0.8, dash=None, colour="#000", stripe=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        P = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        if colour != "#000":                     # a coloured run: thin black edge so white wire shows on white paper
            self.el.append(f'<polyline points="{P}" fill="none" stroke="#000" stroke-width="{w + 0.9}" stroke-linejoin="round"{d}/>')
        self.el.append(f'<polyline points="{P}" fill="none" stroke="{colour}" stroke-width="{w}" stroke-linejoin="round"{d}/>')
        if stripe:
            self.el.append(f'<polyline points="{P}" fill="none" stroke="{stripe}" stroke-width="{w}" stroke-linejoin="round" stroke-dasharray="2.2 3.2"/>')

    def rect(self, x, y, w, h, sw=0.9, rx=0, fill="none"):
        self.el.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" stroke="#000" stroke-width="{sw}"/>')

    def dot(self, x, y, r=1.6):
        self.el.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="#000"/>')

    def ground(self, x, y):
        self.line([(x, y), (x, y + 6)], 0.8)
        for i, hw in enumerate((6, 4, 2)):
            self.line([(x - hw, y + 6 + i * 2.2), (x + hw, y + 6 + i * 2.2)], 0.8)

    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}pt" height="{H}pt" viewBox="0 0 {W} {H}">'
                f'<rect width="{W}" height="{H}" fill="#fff"/>' + "".join(self.el) + "</svg>")


def cav_mark(cav):
    c = str(cav)
    if re.match(r"^[A-Za-z]{1,2}$|^[A-Z]?\d{1,3}$", c):
        return c
    return "○"                                        # ring, lug, splice, stud: a terminal, not a moulded cavity


def fit(text, width, size):
    t = str(text)
    while tw(t, size) > width and len(t) > 3:
        t = t[:-2].rstrip() + "…"
        t = t.replace("……", "…")
    return t


def wire_label(w):
    col = gm_colour(str(w.get("color") or "?")).upper().replace("CABLE", "SHLD")
    return f"{w.get('awg') or '?'} {col}-{str(w['id']).upper()}"


def end_on(ends, eid_rx):
    return [t for t in ends if re.match(eid_rx, t["endpoint"])]


def draw_box(s, x, y, title, rows, width=BOX_W, side="right"):
    """A device seen from its plug: title, one row per cavity. rows: [(cavity, text)]. Returns {cavity: (x_edge, y)}."""
    h = len(rows) * ROW + 8
    s.rect(x, y, width, h, sw=1.0, rx=3)
    s.txt(x + width / 2, y - 3, title.upper(), 6.4, bold=True, anchor="middle")
    pins = {}
    for i, (cav, text) in enumerate(rows):
        yy = y + 6 + i * ROW + ROW / 2
        if side == "right":
            s.rect(x + width - 12, yy - 3.4, 9, 6.8, sw=0.6, fill="#fff")
            s.txt(x + width - 7.5, yy + 2.2, cav_mark(cav), 5.2, bold=True, anchor="middle")
            s.txt(x + 4, yy + 2.2, fit(text, width - 20, 5.4), 5.4)
            pins[str(cav)] = (x + width, yy)
        else:
            s.rect(x + 3, yy - 3.4, 9, 6.8, sw=0.6, fill="#fff")
            s.txt(x + 7.5, yy + 2.2, cav_mark(cav), 5.2, bold=True, anchor="middle")
            s.txt(x + 16, yy + 2.2, fit(text, width - 20, 5.4), 5.4)
            pins[str(cav)] = (x, yy)
    return pins, h


def plug_part_lines(reg, e, parts):
    """The plug's kit, terminals and seals as printed under its box: code ×n, and where each stands against the carts."""
    ep = reg["endpoints"].get(e) or {}
    out = []
    for code, qty, stamp, where in kits_v5.kit_stamps(reg, ep):
        out.append((f"{code} {qty}", where))
    for code, kind, n, n_all, stamp, where in kits_v5.plug_parts(reg, e):
        out.append((f"{code} ×{n}", where))
    return out


def sheet_parts(reg, devs, junctions, parts):
    """Every part the sheet's plugs use: (code, name, kind, qty on this sheet, vendor, price, where)."""
    rows = OrderedDict()
    diff = {d["item"]: d for d in reg["diff"] if d["kind"] != "wire"}
    for e in list(devs) + list(junctions):
        ep = reg["endpoints"].get(e) or {}
        for code, q in (ep.get("kit") or {}).items():
            r = rows.setdefault(code, [code, (parts.get(code) or {}).get("name", ""), (parts.get(code) or {}).get("kind", "kit"), 0,
                                       (parts.get(code) or {}).get("vendor", ""), (parts.get(code) or {}).get("price"), kits_v5._where(diff.get(code))])
            r[3] += q if q >= 1 else 0
        for code, kind, n, n_all, stamp, where in kits_v5.plug_parts(reg, e):
            r = rows.setdefault(code, [code, (parts.get(code) or {}).get("name", ""), kind, 0, (parts.get(code) or {}).get("vendor", ""),
                                       (parts.get(code) or {}).get("price"), where])
            r[3] += n
    return list(rows.values())


def rows_for(eps, e, wires, ends):
    """One row per cavity of plug e, in cavity order; text = Dave's name of the first wire on it (+ count)."""
    per = OrderedDict()
    for wid in eps[e].get("wires") or []:
        w = wires.get(str(wid))
        if not w:
            continue
        for t in ends.get(str(wid), []):
            if t["endpoint"] == e:
                per.setdefault(str(t.get("cavity") or "?"), []).append(w)
    def key(c):
        return re.sub(r"\d+", lambda m: m.group().zfill(3), c)
    rows = []
    for cav in sorted(per, key=key):
        ws = per[cav]
        txt = kits_v5.dave_name(ws[0])
        if len(ws) > 1:
            txt = f"{txt} (+{len(ws) - 1})"
        rows.append((cav, txt))
    return rows


def sheet_engine(reg, wires, ends, number, key, title, devs, sheet_wires, junctions, parts):
    eps = reg["endpoints"]
    sub = f"{len(devs)} plugs · {len(sheet_wires)} circuits · label = gauge colour-circuit · dashed = an end or a cavity not settled"
    s = Sheet(number, title, sub)
    pin_at = {}                                    # (endpoint, cavity) -> (x, y)

    # ---- column 1: engine plugs (pins on the right)
    x_dev, y = M + 10, M + 48
    for e in devs:
        rows = rows_for(eps, e, wires, ends)
        pins, h = draw_box(s, x_dev, y, plug_title(e, eps[e]), rows)
        for cav, pt in pins.items():
            pin_at[(e, cav)] = pt
        pl = plug_part_lines(reg, e, parts)
        yy = y + h + 6
        for code_q, where in pl[:3]:
            s.txt(x_dev + 2, yy, fit(f"{code_q} — {where}", BOX_W - 4, 4.6), 4.6, colour="#333")
            yy += 5.0
        if len(pl) > 3:
            s.txt(x_dev + 2, yy, f"+{len(pl) - 3} more in the parts list", 4.6, italic=True, colour="#333")
            yy += 5.0
        y = yy + 14
    x1 = x_dev + BOX_W

    # ---- column 3: the 61-pin, rows ordered by where the runs arrive
    x_jun = x1 + 210
    x2 = x_jun + BOX_W
    bulk_x = x2 + 120
    bulk = OrderedDict()
    for wid in sheet_wires:
        for t in ends.get(wid, []):
            if t["endpoint"] == "FIREWALL-ENGINE" and t.get("cavity"):
                src = next(((u["endpoint"], str(u.get("cavity") or "?")) for u in ends[wid] if (u["endpoint"], str(u.get("cavity") or "?")) in pin_at), None)
                bulk.setdefault(t["cavity"], pin_at[src][1] if src else 1e9)
    cavs = sorted(bulk, key=lambda c: bulk[c])
    bulk_pins = {}
    if cavs:
        bp, bh = draw_box(s, bulk_x, M + 48, "61-pin firewall connector, engine side", [(c, "") for c in cavs], width=44, side="left")
        for cav, (px, py) in bp.items():
            bulk_pins[cav] = (px, py, px + 44)
        s.txt(bulk_x + 22, M + 48 + bh + 9, "D38999 61-WAY", 5.4, anchor="middle")
    bulk_bottom = (M + 48 + bh + 14) if cavs else (M + 48)

    # ---- column 2: engine-bay junctions (pins on the left), only the rows this sheet's wires use
    y = bulk_bottom + 10                           # below the bulkhead rows, so runs to the bulkhead cross no box
    for e in junctions:
        rows = [(c, t) for c, t in rows_for(eps, e, wires, ends)
                if any(str(t_["wire"]) in sheet_wires for t_ in ends_at(ends, e, c, sheet_wires))]
        if not rows:
            continue
        pins, h = draw_box(s, x_jun, y, plug_title(e, eps[e]), rows, side="left")
        for cav, pt in pins.items():
            pin_at[(e, cav)] = pt
        y += h + 22

    # ---- column 4: cab computers (pins on the left), one row per pin
    x_ecu = W - M - BOX_W
    y = M + 48
    for e in CAB_BOXES:
        rows = [(c, t) for c, t in rows_for(eps, e, wires, ends) if ends_at(ends, e, c, sheet_wires)]
        if not rows:
            continue
        pins, h = draw_box(s, x_ecu, y, plug_title(e, eps[e]), rows, side="left")
        for cav, pt in pins.items():
            pin_at[(e, cav)] = pt
        y += h + 22

    # ---- runs
    chA, chB, chC = x1 + 96, x2 + 14, bulk_x + 44 + 14     # channels: devices→junctions, →bulkhead, bulkhead→cab
    nA = nB = nC = 0
    open_runs = 0
    for wid, w in sheet_wires.items():
        te = ends.get(wid, [])
        at = [(t["endpoint"], str(t.get("cavity") or "?")) for t in te if (t["endpoint"], str(t.get("cavity") or "?")) in pin_at]
        dev = [k for k in at if k[0] in devs]
        jun = [k for k in at if k[0] in junctions]
        cab = [k for k in at if k[0] in CAB_BOXES]
        fw = [t["cavity"] for t in te if t["endpoint"] == "FIREWALL-ENGINE" and t.get("cavity") in bulk_pins]
        label = wire_label(w)
        base, stripe = wire_colours(w)
        dashed = None if (te and all(t.get("cavity") for t in te)) else "3 2"
        was_open = open_runs
        if dashed:
            open_runs += 1
        src = dev[0] if dev else (jun[0] if jun else None)
        if src is None:
            continue                               # nothing of this wire sits on the sheet's columns
        sx, sy = pin_at[src]
        if src in dev:
            s.txt(sx + 4, sy - 1.6, label, 4.8)
        else:
            s.txt(sx - 4, sy - 1.6, label, 4.8, anchor="end")
        if dev and jun:                            # plug -> junction (rail, ground bank, engine PDM)
            jx, jy = pin_at[jun[0]]
            xc = chA + (nA % 24) * TRACK
            nA += 1
            s.line([(sx, sy), (xc, sy), (xc, jy), (jx, jy)], 1.4, dashed, colour=base, stripe=stripe)
            src = jun[0]                            # a junction may carry on to the bulkhead below
            sx, sy = pin_at.get(("__none__", ""), (None, None))
        if fw:
            bx, by, bx2 = bulk_pins[fw[0]]
            ox, oy = pin_at[dev[0]] if dev else pin_at[jun[0]]
            xc = chB + ((nB % 40) * TRACK)
            nB += 1
            s.line([(ox, oy), (xc, oy), (xc, by), (bx, by)], 1.4, dashed, colour=base, stripe=stripe)
            if cab:
                cx, cy = pin_at[cab[0]]
                xc2 = chC + (nC % 40) * TRACK
                nC += 1
                s.line([(bx2, by), (xc2, by), (xc2, cy), (cx, cy)], 1.4, dashed, colour=base, stripe=stripe)
        elif cab and not jun:                      # to a cab computer with no bulkhead cavity yet: dashed, stamped
            ox, oy = pin_at[dev[0]]
            cx, cy = pin_at[cab[0]]
            xc = chB + (nB % 40) * TRACK
            nB += 1
            s.line([(ox, oy), (xc, oy), (xc, cy), (cx, cy)], 0.8, "3 2", colour=base, stripe=stripe)
            s.txt(ox + 4 + tw(label, 4.8) + 4, oy - 1.6, "OPEN: no bulkhead cavity", 4.8, italic=True, colour=ORANGE)
            open_runs = was_open + 1
        elif not jun and not fw:
            ox, oy = pin_at[dev[0]]
            other = [t["endpoint"] for t in te if t["endpoint"] != dev[0][0]]
            far = other[0] if other else "?"
            if re.search(r"GND|GROUND", far):
                s.line([(ox, oy), (ox + 18, oy)], 0.8, dashed, colour=base, stripe=stripe)
                s.ground(ox + 18, oy)
            else:
                s.line([(ox, oy), (ox + 24, oy)], 0.8, "3 2", colour=base, stripe=stripe)
                s.txt(ox + 4 + tw(label, 4.8) + 4, oy - 1.6, f"to {plug_title(far, eps.get(far, {}))}", 4.8, italic=True, colour=ORANGE)
                open_runs = was_open + 1
    # ---- parts list for this sheet (GM prints part numbers at the plugs; here every plug's kit, terminals and seals)
    plist = sheet_parts(reg, devs, [j for j in junctions if any((j, c) in pin_at for c in [k[1] for k in pin_at if k[0] == j])], parts)
    widths = [88, 200, 46, 30, 52, 40, 150]
    cab_bottom = max([y for (ee, _), (_, y) in pin_at.items() if ee in CAB_BOXES] or [M + 48])
    px, py = W - M - sum(widths), max(cab_bottom, bulk_bottom) + 26
    avail = int((H - M - 14 - py) / 8.2) - 2
    shown = plist[:max(avail, 0)]
    if shown:
        s.txt(px, py - 4, "PARTS ON THIS SHEET", 7, bold=True)
        rows = [(c, fit(n, 196, 5.2), k, q, v, (f"${p:.2f}" if isinstance(p, (int, float)) else ""), fit(w, 146, 5.2)) for c, n, k, q, v, p, w in shown]
        table(s, px, py, widths, ["Code", "Part", "Kind", "Qty", "Vendor", "Each", "Where it stands"], rows)
        if len(plist) > len(shown):
            s.txt(px, H - M - 2, f"+{len(plist) - len(shown)} more parts: see the kits report", 5.4, italic=True)
    s.txt(M, H - M + 8, f"{len(sheet_wires)} circuits drawn from the wire list · {open_runs} stamped OPEN (an end or a cavity not settled) · "
          f"cavity marks are the moulded letters; positions are indicative · wire colours are the ordered colours", 6)
    return s, len(sheet_wires), open_runs


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


def ends_at(ends, e, cav, sheet_wires):
    return [t for wid in sheet_wires for t in ends.get(wid, []) if t["endpoint"] == e and str(t.get("cavity") or "?") == str(cav)]


def paginate(reg, wires, ends, devs, budget=H - 2 * M - 70):
    """Split a sheet's plugs into pages that fit one device column (no wrapping into a second column), by drawn height."""
    eps = reg["endpoints"]
    pages, cur, used = [], [], 0
    for e in devs:
        n_rows = len(rows_for(eps, e, wires, ends))
        n_parts = min(len(plug_part_lines(reg, e, {})), 4)
        h = n_rows * ROW + 8 + 6 + n_parts * 5.0 + 14 + 10
        if cur and used + h > budget:
            pages.append(cur)
            cur, used = [], 0
        cur.append(e)
        used += h
    if cur:
        pages.append(cur)
    return pages


def build(first_number=6):
    reg, wires, ends = load()
    eps = reg["endpoints"]
    import yaml
    parts = yaml.safe_load((CD / "catalog" / "parts.yaml").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    engine_plugs = [e for e, ep in eps.items() if ep.get("where") == "engine" and ep.get("wires") and not e.startswith("FIREWALL")]
    junctions = [e for e in engine_plugs if re.match(JUNCTION_RX, e)]
    taken, made = set(), []
    n = first_number
    for key, title, rx in ENGINE_SHEETS:
        devs = sorted([e for e in engine_plugs if re.match(rx, e) and e not in junctions and e not in taken],
                      key=lambda e: re.sub(r"\d+", lambda m: m.group().zfill(3), e))
        taken.update(devs)
        pages = paginate(reg, wires, ends, devs)
        for i, page in enumerate(pages):
            sheet_wires = OrderedDict()
            for e in page:
                for wid in eps[e]["wires"]:
                    if str(wid) in wires:
                        sheet_wires[str(wid)] = wires[str(wid)]
            t = title + (f" ({i + 1} of {len(pages)})" if len(pages) > 1 else "")
            s, nw, nopen = sheet_engine(reg, wires, ends, f"1-{n}", key, t, page, sheet_wires, junctions, parts)
            text = " ".join(re.sub(r"<[^>]+>", " ", e) for e in s.el)
            bad = [b for b in kits_v5.book_lint(text) if not b.startswith("unstamped")]
            if bad:
                raise SystemExit(f"diagram {key} breaks the book's rules:\n  " + "\n  ".join(bad[:10]))
            stem = OUT / f"K5_diagram_1-{n}_{key}{'' if len(pages) == 1 else chr(96 + i + 1)}"
            stem.with_suffix(".svg").write_text(s.svg())
            subprocess.run(["rsvg-convert", "-d", "150", "-p", "150", "-o", str(stem.with_suffix(".png")), str(stem.with_suffix(".svg"))], check=True)
            subprocess.run(["rsvg-convert", "-f", "pdf", "-o", str(stem.with_suffix(".pdf")), str(stem.with_suffix(".svg"))], check=True)
            made.append((f"1-{n}", t, nw, nopen, str(stem.with_suffix(".pdf"))))
            n += 1
    left = [e for e in engine_plugs if e not in taken and e not in junctions]
    for num, t, nw, nopen, pdf in made:
        print(f"{num} {t}: {nw} circuits, {nopen} open -> {Path(pdf).name}")
    print(f"engine plugs on no sheet ({len(left)}): {', '.join(left)}")
    return made


if __name__ == "__main__":
    build()
