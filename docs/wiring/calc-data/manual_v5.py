#!/usr/bin/env python3
"""manual_v5.py — the K5 harness manual in GM factory-service-manual layout, generated from k5_registry.json.

The layout is copied from the GM books in reference_documents/, not invented:
  1977 Light Truck Service Manual p.595-596 (6D-9 / 6D-10): running header — section title centred, page number on
    the outside edge; line-art figure with 'Fig. 6D-2C—' caption; bold centred section heading; two-column justified
    text; 'NOTE:' call-outs; bold capital sub-heads.
  1977 LTSM p.275 (3B-79 'Special Tools'): boxed plate, numbered tools, two-column number list.
  ST-352-78 C-K wiring booklet p.8 ('Circuit Tabulation'): circuit number | colour | circuit name, two blocks per page.
  1987 LD truck manual p.880 (6E8-5): numbered component call-outs with a legend; figure number under the box.
Words follow the build book's rules (kits_v5.dave_name / book_lint): Dave's names, stamps, no repo paths.
Output: docs/wiring/output/manual/*.svg, *.png (150 dpi) and K5_Harness_Manual.pdf.
"""
import json
import re
import subprocess
from html import escape
from pathlib import Path

from PIL import ImageFont

import kits_v5

CD = Path(__file__).resolve().parent
OUT = CD.parent / "output" / "manual"
W, H, M = 612, 792, 48                      # US letter in points, like the LTSM; 2/3 in margins
GUT = 14                                     # column gutter
COLW = (W - 2 * M - GUT) / 2
FONT = "Helvetica, Arial, sans-serif"
_TTC = "/System/Library/Fonts/Helvetica.ttc"
_F = {False: ImageFont.truetype(_TTC, 100, index=0), True: ImageFont.truetype(_TTC, 100, index=1)}


def tw(s, size, bold=False):
    return _F[bold].getlength(s) * size / 100.0


class Page:
    def __init__(self, number, section, odd):
        self.number, self.section, self.odd, self.el = number, section, odd, []
        self.y = M + 24
        num_x, num_anchor = (W - M, "end") if odd else (M, "start")
        self.txt(W / 2, M - 12, section.upper(), 9, bold=True, anchor="middle")
        self.txt(num_x, M - 12, number, 9, bold=True, anchor=num_anchor)

    def txt(self, x, y, s, size, bold=False, anchor="start", length=None, italic=False):
        extra = f' textLength="{length:.1f}" lengthAdjust="spacing"' if length else ""
        style = ' font-style="italic"' if italic else ""
        self.el.append(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" '
                       f'font-weight="{"bold" if bold else "normal"}" text-anchor="{anchor}"{style}{extra}>{escape(s)}</text>')

    def line(self, x1, y1, x2, y2, w=0.6, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.el.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#000" stroke-width="{w}"{d}/>')

    def rect(self, x, y, w, h, sw=0.8, rx=0, fill="none"):
        self.el.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" '
                       f'fill="{fill}" stroke="#000" stroke-width="{sw}"/>')

    def heading(self, s, size=15):
        self.y += size + 4
        self.txt(W / 2, self.y, s.upper(), size, bold=True, anchor="middle")
        self.y += 12

    def wrap(self, s, width, size, bold=False):
        words, lines, cur = s.split(), [], ""
        for w_ in words:
            t = (cur + " " + w_).strip()
            if tw(t, size, bold) <= width or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = w_
        if cur:
            lines.append(cur)
        return lines

    def justify(self, x, y, line, width, size, bold=False):
        words = line.split()
        if len(words) < 2:
            self.txt(x, y, line, size, bold=bold)
            return
        gap = (width - sum(tw(w_, size, bold) for w_ in words)) / (len(words) - 1)
        cx = x
        for w_ in words:
            self.txt(cx, y, w_, size, bold=bold)
            cx += tw(w_, size, bold) + gap

    def columns(self, blocks, size=8.2, lead=9.8, top=None):
        """Two justified columns, balanced like the LTSM. blocks: ('p'|'h'|'note', text)."""
        y0 = self.y if top is None else top
        flat = []
        for b in blocks:
            kind, s = b[0], b[1]
            pre = b[2] if len(b) > 2 else "NOTE:"
            if kind == "note":
                lines = self.wrap(pre + " " + s, COLW, size)
            else:
                lines = self.wrap(s.upper() if kind == "h" else s, COLW, size, kind == "h")
            for i, ln in enumerate(lines):
                flat.append((kind, ln, i == len(lines) - 1, i == 0, pre))
            flat.append(("gap", "", True, False, ""))
        total = len(flat)
        split = (total + 1) // 2
        while split < total and flat[split - 1][0] == "h":
            split += 1
        ymax = y0
        for col, part in ((0, flat[:split]), (1, flat[split:])):
            x, y = M + col * (COLW + GUT), y0
            for kind, ln, last, first, pre in part:
                if kind == "gap":
                    y += 3.5
                    continue
                y += lead
                if kind == "note" and first:
                    self.txt(x, y, pre, size, bold=True)
                    rest = ln[len(pre) + 1:]
                    off = tw(pre + " ", size, True)
                    if last:
                        self.txt(x + off, y, rest, size)
                    else:
                        self.justify(x + off, y, rest, COLW - off, size)
                elif kind == "h":
                    self.txt(x, y, ln, size, bold=True)
                elif last:
                    self.txt(x, y, ln, size)
                else:
                    self.justify(x, y, ln, COLW, size)
            ymax = max(ymax, y)
        self.y = ymax + 6
        return self.y

    def table(self, x, y, widths, header, rows, size=7.0, lead=9.4, head_size=7.0):
        total, top = sum(widths), y
        y += lead + 1
        cx = x
        for w_, h_ in zip(widths, header):
            self.txt(cx + w_ / 2, y - 2.6, h_.upper(), head_size, bold=True, anchor="middle")
            cx += w_
        self.line(x, y + 1.5, x + total, y + 1.5, 0.7)
        y += 1.5
        for r in rows:
            y += lead
            cx = x
            for w_, v in zip(widths, r):
                s = str(v)
                while tw(s, size) > w_ - 3.5 and len(s) > 3:
                    s = s[:-2].rstrip() + "…"
                    s = s.replace("……", "…")
                self.txt(cx + 2.5, y - 2.6, s, size)
                cx += w_
        y += 2.5
        self.rect(x, top, total, y - top, sw=0.9)
        cx = x
        for w_ in widths[:-1]:
            cx += w_
            self.line(cx, top, cx, y, 0.5)
        return y

    def caption(self, cx, y, s):
        self.txt(cx, y, s, 7.5, anchor="middle")

    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}pt" height="{H}pt" viewBox="0 0 {W} {H}">'
                f'<rect width="{W}" height="{H}" fill="#fff"/>' + "".join(self.el) + "</svg>")


def connector_face(p, x, y, labels, title, pitch=26, cav=15, round_=False):
    """An in-line harness connector seen from the mating face: housing, lock tab, one cavity per terminal with the
    moulded cavity marking above it (GM booklet end-view style). Positions are indicative; the moulded letters rule."""
    n = len(labels)
    w = n * pitch + 16
    h = cav + 30
    if round_:
        r = n * pitch / 2 + 4
        cy = y + 10 + h / 2 + 4
        p.el.append(f'<circle cx="{x + w / 2:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="none" stroke="#000" stroke-width="1.1"/>')
        p.rect(x + w / 2 - 6, cy - r - 6, 12, 7, sw=1.0, rx=1.5)   # key
        h = (cy + r) - (y + 10) + 2
    else:
        p.rect(x, y + 10, w, h, sw=1.1, rx=4)
        p.rect(x + w / 2 - 14, y + 2, 28, 8, sw=1.0, rx=1.5)            # lock tab
    for i, lab in enumerate(labels):
        cx = x + 8 + i * pitch + (pitch - cav) / 2
        cyy = y + 26 + (4 if round_ else 0)
        p.rect(cx, cyy, cav, cav, sw=0.9, fill="#fff")
        p.txt(cx + cav / 2, cyy - 4, str(lab).upper(), 7.5, bold=True, anchor="middle")
    p.txt(x + w / 2, y + h + 22, title.upper(), 6.8, bold=True, anchor="middle")
    return w, h + 26


# ---------------------------------------------------------------- content
def load():
    reg = json.load(open(CD / "k5_registry.json"))
    wires = {str(w["id"]): w for w in reg["wires"] + reg["implied"] if not w.get("retired")}
    return reg, wires


def colour(w):
    c = (w.get("color") or "").strip()
    if not c and "Cat5" in str(w.get("spec")):
        return "CAT5 PAIR"
    return "SHIELDED CABLE" if (not c or c == "cable") and "M27500" in str(w.get("spec")) else c.upper()


def gauge(w):
    return f'{w.get("awg")}'


def page_contents(reg, wires, toc, shown, notes):
    p = Page("1-1", "Engine Harness", odd=True)
    p.y += 20
    p.txt(W / 2, p.y, "SECTION 1", 22, bold=True, anchor="middle")
    p.y += 26
    p.txt(W / 2, p.y, "ENGINE HARNESS", 18, bold=True, anchor="middle")
    p.y += 14
    p.txt(W / 2, p.y, "1977 CHEVROLET K5 BLAZER · LS3 6.2L · MOTEC M130 ECU · MOTEC PDM30", 8, anchor="middle")
    p.y += 30
    p.txt(W / 2, p.y, "CONTENTS", 11, bold=True, anchor="middle")
    p.y += 8
    rows = [("General Description", "1-1")] + toc
    x0, x1 = M + 120, W - M - 120
    for s, pg in rows:
        p.y += 13
        p.txt(x0, p.y, s, 9)
        p.txt(x1, p.y, pg, 9, anchor="end")
        dots_from, dots_to = x0 + tw(s, 9) + 6, x1 - tw(pg, 9) - 6
        p.line(dots_from, p.y - 1, dots_to, p.y - 1, 0.6, dash="1 3")
    p.y += 28
    p.heading("General Description", 13)
    solved = sum(1 for e in shown if reg["dossiers"].get(e, {}).get("status") == "design-complete")
    blocks = [
        ("p", "The engine harness connects the LS3 engine sensors, coils, injectors and throttle body to the MoTeC M130 "
              "engine computer. Every engine wire crosses the "
              "firewall through one 61-pin bulkhead connector (D38999 series, insert 25-61), so the engine harness "
              "can be removed with the engine without cutting a wire."),
        ("p", f"Wire is Tefzel throughout. {spec_sentence(wires)} The crank, cam and knock sensor runs are "
              "two-conductor shielded cable (M27500). Each shield drain ends in a solder sleeve; every other "
              "joint is crimped."),
        ("p", "Wire colors follow Dave's M130 sheet: orange for 5 volt feeds, brown for 0 volt returns, white for "
              "injector and coil drives, green and yellow for sensor signals. Circuit numbers are this build's wire "
              "numbers. The text printed on each wire label is still open; it waits on Dave's names."),
        ("h", "Connector identification"),
        ("p", f"Each plug is shown from its mating face with the cavity letters molded on the connector. "
              f"{solved} of the {len(shown)} plugs in this section are complete down to terminal, seal and crimp tool. "
              f"Under each figure: the kit, terminals and seals to buy, then anything still open, stamped BUY NOW, "
              f"YOUR PICK or LATER. Open items shared by several plugs are the numbered notes below."),
    ] + readiness_blocks(reg) + [
        ("note", "The M130 mount spot is still open. This section is drawn for a cab mount."),
        ("note", "Cut lengths, twist and which wires share a sleeve are set on the formboard, not in this section."),
        ("note", "Match wires to the molded cavity letters, not to the position in the drawing."),
    ] + [("note", text, pre) for pre, text in notes]
    p.columns(blocks)
    return p


def readiness_blocks(reg):
    """Where the whole harness stands, by layer, from options_v5 (empty when it has not run)."""
    rd = reg.get("readiness")
    if not rd:
        return []
    c = rd["configuration"]["buildable (base + decided)"]
    L = c["length"]
    opts = reg.get("options", {})
    dec = [o["name"].split(" — ")[0].split(",")[0] for o in opts.values() if o["status"] == "decided"]
    cand = [o["name"].split(" — ")[0].split(",")[0].split(" (")[0] for o in opts.values() if o["status"] == "candidate"]
    return [
        ("h", "Where the harness stands"),
        ("p", f"The buildable harness is the base truck plus every option the owner has decided: {c['wires']} wires. "
              f"Of those, {c['L2 wire']} have both ends named, {c['L3 crossing']} have their firewall crossing settled, "
              f"{c['L4 ends']} have a terminal part number at both ends, and {c['L5 material']} are covered by a "
              f"captured cart. Lengths: {L.get('measured', 0)} measured, {L.get('estimated', 0)} estimated, "
              f"{L.get('unknown', 0)} unknown. The Specifications page carries the count per option and per section, "
              f"and the fill of every connector and PDM channel."),
        ("p", ("Decided options: " + ", ".join(dec) + ". " if dec else "") +
              ("Candidates, not yet decided: " + ", ".join(cand) + ". Their wires are carried in the composite design "
               "and are not in the buildable count." if cand else "")),
    ]


def page_specs(reg, number, odd):
    """SPECIFICATIONS — options, readiness by section, connector and channel fill (LTSM specifications-page layout)."""
    p = Page(number, "Engine Harness", odd=odd)
    p.heading("Specifications")
    rd, cap, opts = reg["readiness"], reg["capacity"], reg["options"]
    p.txt(M, p.y + 6, "OPTIONS", 8.5, bold=True)
    rows = [(code, o["name"][:70], o["status"].upper(), len(o["wires"])) for code, o in opts.items()]
    p.y = p.table(M, p.y + 10, [40, 340, 70, 66], ["Code", "Option", "Status", "Wires"], rows, size=6.6, lead=9.2)
    p.txt(M, p.y + 14, "READINESS BY SECTION (WIRES PASSING EACH LAYER / WIRES)", 8.5, bold=True)
    hdr = ["Section", "Wires", "Both ends", "Crossing", "Terminals", "Material", "Measured", "No length"]
    rows = []
    for g, r in rd["by_section"].items():
        rows.append((g.replace("_", " "), r["wires"], r["L2 wire"], r["L3 crossing"], r["L4 ends"], r["L5 material"],
                     r["length"].get("measured", 0), r["length"].get("unknown", 0)))
    c = rd["configuration"]["buildable (base + decided)"]
    rows.append(("BUILDABLE HARNESS", c["wires"], c["L2 wire"], c["L3 crossing"], c["L4 ends"], c["L5 material"],
                 c["length"].get("measured", 0), c["length"].get("unknown", 0)))
    p.y = p.table(M, p.y + 18, [126, 50, 70, 64, 66, 62, 64, 60], hdr, rows, size=6.6, lead=9.2)
    p.txt(M, p.y + 14, "CONNECTOR AND CHANNEL FILL", 8.5, bold=True)
    rows = []
    for k, r in cap["resources"].items():
        if "lines" in r:
            continue
        sp = r["spare"]
        sp = ", ".join(sp) if isinstance(sp, list) else ("—" if sp is None else sp)
        rows.append((k, "—" if r["capacity"] is None else r["capacity"], r["used"], sp))
    p.y = p.table(M, p.y + 18, [200, 80, 80, 156], ["Resource", "Capacity", "Used", "Spare"], rows, size=6.6, lead=9.2)
    notes = [("note", v) for v in cap["verdict"].values()]
    p.y += 8
    p.columns([("h", "What the candidate options would take")] + notes, top=p.y)
    return p


def spec_sentence(wires):
    """Which Tefzel slash goes on which gauge, read from the master list (never typed)."""
    by = {}
    for w in wires.values():
        g, s = str(w.get("awg") or ""), str(w.get("spec") or "")
        if g.isdigit() and s.startswith("M22759/"):
            by.setdefault(s.split()[0], set()).add(int(g))
    order = sorted({g for gs in by.values() for g in gs}, reverse=True)    # thin to thick
    parts = []
    for s, gs in sorted(by.items(), key=lambda kv: -max(kv[1])):
        runs, run = [], []
        for g in order:
            if g in gs:
                run.append(g)
            elif run:
                runs.append(run); run = []
        if run:
            runs.append(run)
        words = [f"{r[0]} gauge and heavier" if r[-1] == order[-1] and len(r) > 1 else
                 f"{r[0]} gauge" if len(r) == 1 else f"{r[0]} to {r[-1]} gauge" for r in runs]
        parts.append((", and ".join(words) + ("," if len(words) > 1 else "")) + f" is {s}")
    s = "; ".join(parts) + "."
    return s[0].upper() + s[1:]


GM_ABBR = [("SHIELDED CABLE", "SHLD CABLE"), ("THROTTLE MOTOR", "THROT MOTOR"), ("GROUND", "GND"), ("SIGNAL", "SIG"),
           ("TRIGGER", "TRIG"), ("REFERENCE", "REF"), ("PRESSURE", "PRESS")]
GM_COLOUR = [("WHITE", "WHT"), ("BROWN", "BRN"), ("ORANGE", "ORN"), ("BLACK", "BLK"), ("GREEN", "GRN"),
             ("YELLOW", "YEL"), ("VIOLET", "VIO"), ("GRAY", "GRY"), ("BLUE", "BLU"), ("RED", "RED")]


def gm_colour(s):
    """Wire colours the way the 1987 booklets print them: BLK/WHT, DK GRN."""
    for long_, short in GM_COLOUR:
        s = s.replace(long_, short)
    return s
SHORT_END = {"head ring terminal, chassis ground": "HEAD RING", "head ring terminal, signal ground": "HEAD RING",
             "coil power rail (splice)": "COIL PWR SPL", "injector power rail (splice)": "INJ PWR SPL"}


def fit(s, width, size):
    """GM-style abbreviations only when a cell overflows (the 1987 booklets use GND, SIG, SHLD)."""
    for long_, short in GM_ABBR:
        if tw(s, size) <= width - 3.5:
            break
        s = s.replace(long_, short)
    return s


def other_end(w, eid):
    frm, to = str(w.get("frm") or ""), w.get("to") if isinstance(w.get("to"), str) else ""
    if frm.startswith("M130:"):
        return frm.replace("M130:", "M130 ")
    stem = eid.split("-")[0] + "-" + eid.split("-")[1] if "-" in eid else eid
    for cand in (frm, to):
        if cand and not cand.upper().startswith(stem.upper()) and not cand.upper().startswith(eid.upper()):
            word = kits_v5.end_word(cand)
            return SHORT_END.get(word, word)
    return "—"


def stamped(p, x, y, stamp, words, width, size=6.6, lead=8.2):
    """'BUY NOW: plug kit … in the ProWire cart' — bold stamp, wrapped words; returns the next baseline."""
    head = f"{stamp}: "
    hw = tw(head, size, bold=True)
    lines = p.wrap(words, width - hw, size)
    p.txt(x, y, head.strip(), size, bold=True)
    for i, ln in enumerate(lines):
        p.txt(x + hw, y + i * lead, ln, size)
    return y + max(1, len(lines)) * lead


KIND_WORD = {"kit": "plug kit", "housing": "housing", "tpa": "TPA", "terminal": "terminal", "seal": "seal"}


def legend(reg, eid, typical):
    """Everything it takes to build this plug, stamped: kits, terminals and seals, then what is still open."""
    parts = kits_v5._y("parts.yaml")
    ep, out = reg["endpoints"].get(eid, {}), []
    for code, qty, stamp, where in kits_v5.kit_stamps(reg, ep):
        kind = KIND_WORD.get((parts.get(str(code)) or {}).get("kind"), "part")
        out.append((stamp, f"{kind} {code}{'' if qty == '×1' else ' ' + qty}, {where}", False))
    for code, kind, n, need, stamp, where in kits_v5.plug_parts(reg, eid):
        here = n * (typical or 1)
        count = f"×{here}" + (f" ({n} per plug)" if typical else f" ({need} in all)" if need != here else "")
        out.append((stamp, f"{KIND_WORD.get(kind, kind)} {code} {count}, {where}", False))
    for stamp, words in kits_v5.plug_opens(ep, reg["dossiers"].get(eid)):
        out.append((stamp, words, True))
    return out


def siblings(reg, wires, eid):
    """For a typical plug: each identical plug's signal wire, M130 pin and firewall cavity (GM's cylinder table)."""
    stem = eid.rsplit("-", 1)[0]
    eps = sorted((e for e in reg["endpoints"] if re.fullmatch(re.escape(stem) + r"-\d+", e)), key=lambda e: int(e.rsplit("-", 1)[1]))
    fw = {t["wire"]: t.get("cavity") for t in reg["terminations"] if t["endpoint"] == "FIREWALL-ENGINE"}
    cols = []
    for e in eps:
        sig = [w for w in reg["endpoints"][e]["wires"] if str((wires.get(w) or {}).get("frm") or "").startswith("M130:")]
        if sig:
            w = sig[0]
            cols.append((e.rsplit("-", 1)[1], w.upper(), wires[w]["frm"].split(":")[1], fw.get(w) or "—"))
    return cols


def connector_pages(reg, wires, plugs, first, fig0):
    """Connector identification pages. plugs: (endpoint, title, typical count or None). Two columns,
    rows packed from the top; a new page starts when the next row won't fit. Open items shared by
    two or more plugs become numbered notes on page 1-1 (each fact once)."""
    dev = {}
    for t in reg["terminations"]:
        dev.setdefault(t["endpoint"], {})[t["wire"]] = t
    fw = {t["wire"]: t.get("cavity") for t in reg["terminations"] if t["endpoint"] == "FIREWALL-ENGINE"}
    widths = [17, 45, 52, 68, 21, 48]

    legends = {eid: legend(reg, eid, typ) for eid, _, typ in plugs}
    seen = {}
    for eid, title, _ in plugs:
        for stamp, words, is_open in legends[eid]:
            if is_open:
                seen.setdefault((stamp, words), []).append(title)
    shared = [(k, v) for k, v in seen.items() if len(v) > 1]
    number = {k: i + 1 for i, (k, _) in enumerate(shared)}
    notes = []
    for (stamp, words), titles in shared:
        who = ", ".join(t for t in titles[:-1]) + " and " + titles[-1]
        notes.append((f"NOTE {number[(stamp, words)]} — {stamp}:", f"{who[0].upper() + who[1:]}. {words[0].upper() + words[1:]}."))

    def draw(p, eid, title, typ, x, y, fig):
        ts = sorted(dev.get(eid, {}).values(), key=lambda t: str(t.get("cavity")))
        labels = [t.get("cavity") for t in ts]
        name = title.rsplit(" ", 1)[0] if typ else title
        _, fh = connector_face(p, x + (COLW - (len(labels) * 26 + 16)) / 2, y, labels,
                               f"{name} (typical)" if typ else title, round_=(eid == "OILP-ECU"))
        rows = []
        for t in ts:
            w = wires.get(t["wire"], {})
            rows.append((str(t.get("cavity")).upper(), t["wire"].upper(),
                         fit(gm_colour(f"{gauge(w)} {colour(w)}"), widths[2], 6.2), fit(kits_v5.dave_name(w).upper(), widths[3], 6.2),
                         fw.get(t["wire"]) or "—", fit(other_end(w, eid).upper(), widths[5], 6.2)))
        ty = p.table(x, y + fh + 4, widths, ["Cav", "Ckt", "Wire", "Function", "Bulk", "To"], rows, size=6.2, head_size=6.2, lead=8.6)
        if typ:
            sib = siblings(reg, wires, eid)
            first_w = 44
            cw = (COLW - first_w) / max(1, len(sib))
            head = [title.split()[0].upper()] + [s[0] for s in sib]
            body = [["CKT"] + [s[1] for s in sib], ["M130"] + [s[2] for s in sib], ["BULK"] + [s[3] for s in sib]]
            ty = p.table(x, ty + 4, [first_w] + [cw] * len(sib), head, body, size=6.2, head_size=6.2, lead=8.6)
        ky = ty + 10
        own = [(s, w) for s, w, is_open in legends[eid] if (s, w) not in number]
        refs = sorted(number[(s, w)] for s, w, is_open in legends[eid] if (s, w) in number)
        for stamp, words in own:
            ky = stamped(p, x, ky, stamp, words, COLW)
        if refs:
            stamps = {s for s, w, _ in legends[eid] if (s, w) in number}
            ky = stamped(p, x, ky, "/".join(sorted(stamps)), "see " + " and ".join(f"Note {n}" for n in refs) + ", page 1-1", COLW)
        cap = f"Fig. 1-{fig}—{name.title()} Connector" + (f" (Typical, {typ} Used)" if typ else "")
        p.caption(x + COLW / 2, ky + 6, cap)
        return ky + 10 - y

    scratch = Page("0", "", odd=True)
    hs = [draw(scratch, eid, title, typ, M, 0, 0) for eid, title, typ in plugs]
    rows = [list(range(i, min(i + 2, len(plugs)))) for i in range(0, len(plugs), 2)]
    pages, fig, k = [], fig0, first
    while rows:
        p = Page(f"1-{k}", "Engine Harness", odd=(k % 2 == 1))
        p.heading("Connector Identification")
        top, room, take = p.y + 6, H - M - p.y - 6, []
        while rows and sum(max(hs[i] for i in r) + 14 for r in take + [rows[0]]) <= room:
            take.append(rows.pop(0))
        if not take:                       # one row taller than a page: draw it anyway
            take.append(rows.pop(0))
        used = sum(max(hs[i] for i in r) for r in take)
        gap = max(14, min(40, (room - used) / len(take)))
        y = top
        for r in take:
            for c, i in enumerate(r):
                eid, title, typ = plugs[i]
                draw(p, eid, title, typ, M + c * (COLW + GUT), y, fig)
                fig += 1
            y += max(hs[i] for i in r) + gap
        pages.append(p)
        k += 1
    return pages, fig, notes


def page_tabulation(reg, wires, number, odd):
    p = Page(number, "Engine Harness", odd=odd)
    p.heading("Circuit Tabulation")
    ids = [w for w in reg["endpoints"]["FIREWALL-ENGINE"]["wires"]]
    for e in ("CAN-BUS", "PORT-UTC", "PORT-ETH"):
        ids += [w for w in reg["endpoints"][e]["wires"] if w not in ids]
    rows = []
    for wid in ids:
        w = wires.get(wid)
        if w:
            rows.append((wid.upper(), gm_colour(f"{gauge(w)} {colour(w)}"), kits_v5.dave_name(w).upper()))
    def key(r):
        m = re.match(r"^(\d+)(.*)$", r[0])
        return (0, int(m.group(1)), m.group(2)) if m else (1, 0, r[0])
    rows.sort(key=key)
    half = (len(rows) + 1) // 2
    widths = [46, 84, 121]
    lead_in = ("Every circuit through the 61-pin firewall connector, plus the CAN bus and the two laptop ports. "
               "Power feeds and grounds through the firewall grommet are not in this table.")
    for i, ln in enumerate(p.wrap(lead_in, W - 2 * M, 8.2)):
        p.txt(M, p.y + 4 + i * 10, ln, 8.2)
    p.y += 4 + len(p.wrap(lead_in, W - 2 * M, 8.2)) * 10
    p.table(M, p.y + 4, widths, ["Circuit", "Size, Color", "Circuit Name"], rows[:half], size=6.6, lead=9.4)
    p.table(M + COLW + GUT, p.y + 4, widths, ["Circuit", "Size, Color", "Circuit Name"], rows[half:], size=6.6, lead=9.4)
    return p


def build():
    reg, wires = load()
    OUT.mkdir(parents=True, exist_ok=True)
    plugs = [("TB", "throttle body"), ("CKP", "crank sensor"), ("CMP", "cam sensor"), ("MAP", "MAP sensor"),
             ("CLT-ECU", "coolant temp sensor"), ("OILP-ECU", "oil pressure sensor"), ("KNOCK-1", "knock sensor 1"),
             ("KNOCK-2", "knock sensor 2"), ("COIL-1", "coil 1"), ("INJ-1", "injector 1"), ("APS", "gas pedal")]
    typical = {"COIL-1", "INJ-1"}              # one drawing stands for all eight, with the cylinder table under it
    plugs = [(e, t, len(siblings(reg, wires, e)) if e in typical else None) for e, t in plugs]
    conn, fig, notes = connector_pages(reg, wires, plugs, 2, 1)
    pages = [None] + conn
    toc = [("Connector Identification", conn[0].number)]
    pages.append(page_tabulation(reg, wires, f"1-{len(pages) + 1}", odd=(len(pages) + 1) % 2 == 1))
    toc.append(("Circuit Tabulation", pages[-1].number))
    if reg.get("readiness"):
        pages.append(page_specs(reg, f"1-{len(pages) + 1}", odd=(len(pages) + 1) % 2 == 1))
        toc.append(("Specifications", pages[-1].number))
    pages[0] = page_contents(reg, wires, toc, [e for e, _, _ in plugs], notes)
    bad = []
    for p in pages:
        text = " ".join(re.sub(r"<[^>]+>", " ", e) for e in p.el)
        bad += [f"{p.number}: {b}" for b in kits_v5.book_lint(text) if not b.startswith("unstamped")]
    if bad:
        raise SystemExit("manual breaks the book's rules:\n  " + "\n  ".join(bad[:20]))
    pdfs = []
    for p in pages:
        stem = OUT / f"K5_manual_{p.number}"
        stem.with_suffix(".svg").write_text(p.svg())
        subprocess.run(["rsvg-convert", "-d", "150", "-p", "150", "-o", str(stem.with_suffix(".png")), str(stem.with_suffix(".svg"))], check=True)
        subprocess.run(["rsvg-convert", "-f", "pdf", "-o", str(stem.with_suffix(".pdf")), str(stem.with_suffix(".svg"))], check=True)
        pdfs.append(str(stem.with_suffix(".pdf")))
    subprocess.run(["pdfunite", *pdfs, str(OUT / "K5_Harness_Manual.pdf")], check=True)
    print(f"manual: {len(pages)} pages -> {OUT}")


if __name__ == "__main__":
    build()
