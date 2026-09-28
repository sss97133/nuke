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
import sys
import yaml
import re
import subprocess
from html import escape
from pathlib import Path

from PIL import ImageFont

import kits_v5

CD = Path(__file__).resolve().parent
OUT = CD.parent / "output" / "manual"
W, H, M = 612, 792, 48
import datetime as _dt
import subprocess as _sp
_sha = _sp.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent)).stdout.strip() or "local"
REVISION = f"K5 harness book · wire list v5 · rev {_dt.date.today().isoformat()} · {_sha}"
HEXC = {"white": "#f2f2f2", "black": "#111", "red": "#d3222a", "orange": "#f28c28", "yellow": "#e8c31c", "green": "#1f8a3b",
        "blue": "#2457c5", "brown": "#7a4a1d", "gray": "#8a8a8a", "grey": "#8a8a8a", "violet": "#7b3fa0", "purple": "#7b3fa0",
        "pink": "#e58fb6", "tan": "#c8a675", "cable": "#555", "shld": "#555"}                      # US letter in points, like the LTSM; 2/3 in margins
GUT = 14                                     # column gutter
COLW = (W - 2 * M - GUT) / 2
FONT = "Helvetica, Arial, sans-serif"
_TTC = "/System/Library/Fonts/Helvetica.ttc"
_F = {False: ImageFont.truetype(_TTC, 100, index=0), True: ImageFont.truetype(_TTC, 100, index=1)}


def tw(s, size, bold=False):
    return _F[bold].getlength(s) * size / 100.0


def wrap_text(s, width, size, bold=False):
    """Words onto lines no wider than width. A word wider than the line is split at a '/', ',' or '-' where it can
    be, else between characters: never cut short, never an ellipsis (review 2026-09-28: truncation hid facts)."""
    def pieces(word):
        if tw(word, size, bold) <= width:
            return [word]
        out, cur = [], ""
        for tok in re.split(r"(?<=[/,\-])", word):
            if tw(cur + tok, size, bold) <= width or not cur:
                cur += tok
            else:
                out.append(cur)
                cur = tok
        fixed = []
        for part in out + [cur]:
            while tw(part, size, bold) > width and len(part) > 1:
                k = len(part)
                while k > 1 and tw(part[:k], size, bold) > width:
                    k -= 1
                fixed.append(part[:k])
                part = part[k:]
            fixed.append(part)
        return [f for f in fixed if f]
    lines, cur = [], ""
    for w0 in str(s).split():
        for w_ in pieces(w0):
            t = (cur + " " + w_).strip()
            if tw(t, size, bold) <= width or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = w_
    if cur:
        lines.append(cur)
    return lines or [""]


def open_word(s):
    """The book's word for a fact not yet known is OPEN (a wire-list 'unknown' reads OPEN on the page)."""
    return re.sub(r"\bUNKNOWN\b", "OPEN", re.sub(r"\bunknown\b", "OPEN", str(s)))


_SOURCES = None


def source_strings():
    """Every registry text a page may print a piece of: endpoint devices, wire labels and notes, Dave's names."""
    global _SOURCES
    if _SOURCES is None:
        r = json.load(open(CD / "k5_registry.json"))
        src = set()
        for ep in r["endpoints"].values():
            for v in (ep.get("device"),) + tuple((ep.get("cavities") or {}).values() if isinstance(ep.get("cavities"), dict) else ()):
                if v:
                    src.add(str(v))
        for w in r["wires"] + r["implied"]:
            for v in (w.get("label"), w.get("notes"), kits_v5.dave_name(w)):
                if v:
                    src.add(str(v))
        _SOURCES = [x for x in src if len(x) > 20]
    return _SOURCES


def fragment_faults(boxes):
    """A printed text that stops in the middle of a word of the registry string it came from (review round 3: 'at the
    das', 'SECOND reve master UP'): the page must print the whole string, or whole words and wrap."""
    bad = []
    heads = {}
    for d in source_strings():
        heads.setdefault(d[:14].lower(), []).append(d.lower())
    for b in boxes:
        t = str(b[4])
        tl = t.lower()
        hit = None
        for i in range(0, max(1, len(tl) - 13)):
            for dl in heads.get(tl[i:i + 14], ()):
                rest = tl[i:]
                n = 0
                while n < len(rest) and n < len(dl) and rest[n] == dl[n]:
                    n += 1
                ends_word_here = n == len(rest) or not rest[n].isalnum()
                # 24 characters in common before the cut: a short shared phrase is a coincidence, not a slice
                if n >= 24 and n < len(dl) and dl[n - 1].isalnum() and dl[n].isalnum() and ends_word_here:
                    hit = dl
                    break
            if hit:
                break
        if hit:
            bad.append(f"word cut from the wire list's text: '{t[:70]}' (source: '{hit[:70]}')")
    return bad


def layout_faults(boxes, page_w, page_h, margin, footer=()):
    """Text a reader cannot read whole (review 2026-09-28): any text box past the bottom margin (into the footer) or
    past the left/right margin, and any label cut short with an ellipsis. footer = the texts allowed below the margin."""
    bad = []
    for b in boxes:
        x0, y0, x1, y1, t = b[:5]
        if t in footer or not str(t).strip():
            continue
        if y1 > page_h - margin + 1:
            bad.append(f"text below the bottom margin (into the footer): '{t[:60]}'")
        if x1 > page_w - margin + 1 or x0 < margin - 1:
            bad.append(f"text past the {'right' if x1 > page_w - margin + 1 else 'left'} margin: '{t[:60]}'")
        if re.search(r"\w…(\s|$)|…$", str(t)):
            bad.append(f"label cut short: '{t[:60]}'")
    return bad


class Page:
    def __init__(self, number, section, odd):
        self.number, self.section, self.odd, self.el, self.boxes = number, section, odd, [], []
        self.y = M + 24
        num_x, num_anchor = (W - M, "end") if odd else (M, "start")
        self.txt(W / 2, M - 12, section.upper(), 9, bold=True, anchor="middle")
        self.txt(num_x, M - 12, number, 9, bold=True, anchor=num_anchor)

    def txt(self, x, y, s, size, bold=False, anchor="start", length=None, italic=False, href=None):
        w_ = length or tw(str(s), size, bold)
        x0 = x - (w_ if anchor == "end" else w_ / 2 if anchor == "middle" else 0)
        self.boxes.append((x0, y - size * 0.78, x0 + w_, y + 0.2, str(s), href))
        extra = f' textLength="{length:.1f}" lengthAdjust="spacing"' if length else ""
        style = ' font-style="italic"' if italic else ""
        t = (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" '
             f'font-weight="{"bold" if bold else "normal"}" text-anchor="{anchor}"{style}{extra}>{escape(s)}</text>')
        self.el.append(f'<a href="{escape(href)}">{t}</a>' if href else t)

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
        return wrap_text(s, width, size, bold)

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

    BOTTOM = H - M - 6                                # the lowest baseline a body line may take (footer below)

    def cont(self):
        """The next page, same section: text that does not fit continues there (never runs into the footer)."""
        n = self.number.split("-")
        nxt = Page(f"{n[0]}-{int(n[1]) + 1}", self.section, odd=not self.odd)
        nxt.txt(W / 2, M + 12, "(continued)", 7, italic=True, anchor="middle")
        nxt.y = M + 22
        root = getattr(self, "root", self)
        nxt.root = root
        root.__dict__.setdefault("extra_pages", []).append(nxt)
        return nxt

    def _col_line(self, x, y, kind, ln, last, first, pre, size):
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

    def columns(self, blocks, size=8.2, lead=9.8, top=None):
        """Two justified columns, balanced like the LTSM. blocks: ('p'|'h'|'note', text). Text that does not fit
        above the footer fills both columns and continues on the next page. Returns the page the text ended on."""
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
        high = lambda part: sum(3.5 if f[0] == "gap" else lead for f in part)
        total = len(flat)
        split = (total + 1) // 2
        while split < total and flat[split - 1][0] in ("h", "gap") and flat[max(split - 2, 0)][0] in ("h", "gap"):
            split -= 1                                   # a heading never ends a column: it moves down with its text
        while split < total and flat[split - 1][0] == "h":
            split -= 1
        if y0 + max(high(flat[:split]), high(flat[split:])) <= self.BOTTOM:
            ymax = y0
            for col, part in ((0, flat[:split]), (1, flat[split:])):
                x, y = M + col * (COLW + GUT), y0
                for kind, ln, last, first, pre in part:
                    if kind == "gap":
                        y += 3.5
                        continue
                    y += lead
                    self._col_line(x, y, kind, ln, last, first, pre, size)
                ymax = max(ymax, y)
            self.y = ymax + 6
            return self
        # too long for this page: fill column by column, then continue on the next page
        page, col, top_, y, ymax = self, 0, y0, y0, y0
        for i, (kind, ln, last, first, pre) in enumerate(flat):
            need = 3.5 if kind == "gap" else lead
            keep = lead * 3 if kind == "h" else need            # a heading keeps two lines of its text with it
            if y + keep > page.BOTTOM:
                col += 1
                if col == 2:
                    page, col = page.cont(), 0
                    top_ = page.y
                y = top_
                if kind == "gap":
                    continue
            if kind == "gap":
                y += 3.5
                continue
            y += lead
            page._col_line(M + col * (COLW + GUT), y, kind, ln, last, first, pre, size)
            ymax = y if page is not self else ymax
        page.y = y + 6
        return page

    def table(self, x, y, widths, header, rows, size=7.0, lead=9.4, head_size=7.0):
        """A ruled table. Cells wrap (never cut); rows that would run into the footer continue on the next page
        under a repeated header. Returns the y under the table; self.tail is the page it ended on."""
        total = sum(widths)
        sub = size + 1.4                              # a wrapped cell's next line
        page = self

        def frame_open(pg, y_):
            top_ = y_
            y_ += lead + 1
            cx = x
            for w_, h_ in zip(widths, header):
                pg.txt(cx + w_ / 2, y_ - 2.6, h_.upper(), head_size, bold=True, anchor="middle")
                cx += w_
            pg.line(x, y_ + 1.5, x + total, y_ + 1.5, 0.7)
            return top_, y_ + 1.5 + max(0.0, size + 1.0 - (lead - 2.6))    # the first row clears the header rule

        def frame_close(pg, top_, y_):
            y_ += 2.5
            pg.rect(x, top_, total, y_ - top_, sw=0.9)
            cx = x
            for w_ in widths[:-1]:
                cx += w_
                pg.line(cx, top_, cx, y_, 0.5)
            return y_

        top, y = frame_open(page, y)
        for r in rows:
            cells = [wrap_text(str(v), w_ - 4.5, size) for w_, v in zip(widths, r)]
            high = lead + (max(len(c) for c in cells) - 1) * sub
            if y + high + 2.5 > page.BOTTOM:
                frame_close(page, top, y)
                page = page.cont()
                top, y = frame_open(page, page.y + 4)
            y += lead
            cx = x
            for w_, lines in zip(widths, cells):
                for k, ln in enumerate(lines):
                    page.txt(cx + 2.5, y - 2.6 + k * sub, ln, size)
                cx += w_
            y += high - lead
        y = frame_close(page, top, y)
        self.tail = page
        page.y = max(page.y, y) if page is not self else page.y
        return y

    def caption(self, cx, y, s):
        self.txt(cx, y, s, 7.5, anchor="middle")

    def svg(self):
        self.txt(W - M, H - M + 14, REVISION, 5.6, anchor="end")
        body = "".join(self.el)
        body = re.sub(r"&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)", "&amp;", body)      # a bare & (a map URL's &node=) breaks the SVG
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}pt" height="{H}pt" viewBox="0 0 {W} {H}">'
                f'<rect width="{W}" height="{H}" fill="#fff"/>' + body + "</svg>")


def connector_face(p, x, y, labels, title, pitch=26, cav=15, round_=False, href=None, colours=None):
    """A plug's PIN MAP: one square per cavity with the moulded marking above it, no housing outline. The housing's true
    shape is drawn only from the maker's drawing (owner 2026-09-28: an inaccurate plug shape is worse than none)."""
    n = len(labels)
    w = n * pitch + 16
    h = cav + 30
    for i, lab in enumerate(labels):
        cx = x + 8 + i * pitch + (pitch - cav) / 2
        cyy = y + 26
        wire_ = {"color": colours[i]} if colours and i < len(colours) else None
        p.el.append(pin_symbol(cx, cyy, cav, cav, wire_ if wire_ is not None else None))   # the book's one set of symbols
        p.txt(cx + cav / 2, cyy - 4, str(lab), 7.5, bold=True, anchor="middle")
    p.txt(x + w / 2, y + h + 22, title.upper(), 6.8, bold=True, anchor="middle", href=href)
    p.txt(x + w / 2, y + h + 30, "pin map — cavity order as moulded; housing shape not drawn", 5.6, anchor="middle", italic=True)
    return w, h + 34


# ---------------------------------------------------------------- content
def load():
    reg = json.load(open(CD / "k5_registry.json"))
    wires = {str(w["id"]): w for w in reg["wires"] + reg["implied"] if not w.get("retired")}
    return reg, wires


def colour(w):
    c = (w.get("color") or "").strip()
    if not c and "Cat5" in str(w.get("spec")):
        return "CAT5 PAIR"
    if "M27500" in str(w.get("spec")):
        # a conductor of the shielded cable prints its own colour; until the wire list gives one it says so
        own = [q.strip() for q in c.lower().split("/") if q.strip() and q.strip() not in ("cable", "shld")]
        return f"{'/'.join(own).upper()} (SHIELDED)" if own else "SHIELDED, COLOUR OPEN"
    return c.upper()


def gauge_word(w):
    """The gauge as the book prints it, from the wire list's own gauge field ('2 x 2 AWG' -> '2×2': two conductors in
    parallel), so one cable shows one gauge on every page; the bare awg only when the row has no gauge field."""
    g = str((w or {}).get("gauge") or "").strip()
    if g:
        g = re.sub(r"\s*AWG\s*$", "", g, flags=re.I)
        return re.sub(r"\s*[x×]\s*", "×", g)
    a = (w or {}).get("awg")
    return str(a) if a not in (None, "") else "?"


def gauge(w):
    return gauge_word(w)


def circuit_word(w):
    """How a circuit is named on a page: this build's circuit number when it is one ('13', '103G', '85a'), else the
    builder's name for the wire (kits_v5.dave_name) — never a cut-list code like COIL1_SGND (review round 3)."""
    wid = str((w or {}).get("id") or "")
    if re.fullmatch(r"\d+[A-Za-z]?", wid):
        return wid.upper()
    return kits_v5.dave_name(w) if w else wid


def page_contents(reg, wires, toc, shown, notes):
    p = Page("1-1", "K5 Harness", odd=True)
    p.y += 20
    p.txt(W / 2, p.y, "SECTION 1", 22, bold=True, anchor="middle")
    p.y += 26
    p.txt(W / 2, p.y, "K5 HARNESS", 18, bold=True, anchor="middle")
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
        ("p", f"Each plug is shown as a pin map: one square per cavity with the marking moulded on the connector, in moulded order, "
              f"and no housing outline until the maker's drawing is on file. "
              f"{solved} of the {len(shown)} plugs in this section are complete down to terminal, seal and crimp tool. "
              f"Under each figure: the plug kit, terminal and seal part numbers, then DESIGN COMPLETE or OPEN with the fact "
              f"still missing. Open items shared by several plugs are the numbered notes below. Nothing in this book says "
              f"whether a part has been bought; that lives on the truck's map."),
    ] + readiness_blocks(reg) + [
        ("note", "The M130 mount spot is still open. This section is drawn for a cab mount."),
        ("note", "Lengths printed on the wiring diagram sheets are estimates from the twin and the cut list until measured on the truck; "
                 "twist and which wires share a sleeve are set on the formboard."),
        ("note", "Match wires to the molded cavity letters, not to the position in the drawing."),
        ("note", "Every plug title is a link to that plug's card on the truck's map: the part being installed, its proof and photos."),
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
    if sum(L.values()) != c["wires"]:
        raise SystemExit(f"readiness: lengths {dict(L)} add to {sum(L.values())}, not the {c['wires']} buildable wires")
    opts = reg.get("options", {})
    dec = [o["name"].split(" — ")[0].split(",")[0] for o in opts.values() if o["status"] == "decided"]
    cand = [o["name"].split(" — ")[0].split(",")[0].split(" (")[0] for o in opts.values() if o["status"] == "candidate"]
    return [
        ("h", "Where the harness stands"),
        ("p", f"The buildable harness is the base truck plus every option the owner has decided: {c['wires']} wires. "
              f"Of those, {c['L2 wire']} have both ends named, {c['L3 crossing']} have their firewall crossing settled, "
              f"{c['L4 ends']} have a terminal part number at both ends. Lengths: {L.get('measured', 0)} measured, {L.get('twin', 0)} from the "
              f"digital twin, {L.get('estimated', 0)} estimated, {L.get('unknown', 0)} unknown. The Specifications page carries the count per option and per section, "
              f"and the fill of every connector and PDM channel."),
        ("p", ("Decided options: " + ", ".join(dec) + ". " if dec else "") +
              ("Candidates, not yet decided: " + ", ".join(cand) + ". Their wires are carried in the composite design "
               "and are not in the buildable count." if cand else "")),
    ]


# twin object -> registry plug (only plugs that exist in the registry get a call-out; the twin insert's boxes are
# placeholders, so the figure locates, it does not depict — figures_v5.py docstring)
TWIN_PLUG = {"K5H_CKP": "CKP", "K5H_CMP": "CMP", "K5H_CLT": "CLT-ECU", "K5H_IAT": "IAT", "K5H_MAP": "MAP",
             "K5H_OilPress": "OILP-ECU", "K5H_OilTemp": "OILT", "K5H_FuelPress": "FUELP", "K5H_KS1": "KNOCK-1", "K5H_KS2": "KNOCK-2",
             "K5H_ThrottleBody_12605109": "TB", "K5H_Alternator": "ALTERNATOR-SENSE", "K5H_Starter": "STARTER-S", "K5H_Battery": "ODYSSEY",
             "K5H_RadFan_1": "FAN", "K5H_AC_Compressor": "AC-CLUTCH", "K5H_iBooster": "IBOOSTER", "K5H_Wideband_Ctrl": "WIDEBAND",
             "K5H_FuelPump_Sender": "FUELP", "K5H_VSS": "VSS-SENDER", "K5H_MoTeC_PDM30": "PDM30-A", "K5H_MoTeC_M130": "M130-A"}
TWIN_PLUG.update({f"K5H_Coil_{i}": f"COIL-{i}" for i in range(1, 9)})
TWIN_PLUG.update({f"K5H_Injector_{i}": f"INJ-{i}" for i in range(1, 9)})
TWIN_PLUG.update({"K5H_EStopp_Actuator": "ESTOPP", "K5H_Subwoofer": "SUB-1", "K5H_Amplifier": "AMP", "K5H_TransferCase": "TCASE-4WD-SW", "K5H_6L80E": "PCS-TCM"})
OPEN_POSITION = {"M130-A": "mount not decided", "PDM30-A": "mount not decided"}


def extra_locations():
    """Plugs with no twin object: (3-D point, why there) from the map's working-assumption anchors."""
    import load_map_rows as L
    batt = json.load(open(CD / "twin_centers.json")).get("K5H_Battery")
    out = {"FIREWALL-ENGINE": (L.ANCHORS["FWG_MAIN"][0], "firewall hole H3"),
           "GND-BANK-CAB": (L.ANCHORS["PDM30"][0], "beside the body PDM30, under the dash")}
    if batt:
        out["PDM15-A"] = (tuple(batt), "beside the batteries")
        out["GND-BANK-ENG"] = (tuple(batt), "the stud bank beside the batteries")
    return out


def project_bay(view, xyz):
    """The figure's camera, recovered by a least-squares fit (DLT) of the twin object centres to their image positions;
    None when the fit is poor (over 0.2 % of the image), so nothing is placed on a guess."""
    import numpy as np
    posf = OUT / "figures" / f"fig_bay_{view}_positions.json"
    t = json.load(open(CD / "twin_centers.json"))
    pos = json.load(posf.open())
    common = [k for k in pos if k in t]
    if len(common) < 8:
        return None
    A = []
    for k in common:
        (x, y, z), (u, v) = t[k], pos[k]
        A.append([x, y, z, 1, 0, 0, 0, 0, -u * x, -u * y, -u * z, -u])
        A.append([0, 0, 0, 0, x, y, z, 1, -v * x, -v * y, -v * z, -v])
    P = np.linalg.svd(np.array(A, float))[2][-1].reshape(3, 4)
    pr = lambda p: (P @ np.r_[p, 1])[:2] / (P @ np.r_[p, 1])[2]
    if max(np.linalg.norm(pr(np.array(t[k], float)) - np.array(pos[k], float)) for k in common) > 0.002:
        return None
    return tuple(float(c) for c in pr(np.array(xyz, float)))


def page_locations(reg, number, odd, view="top"):
    """COMPONENT LOCATION — the engine bay from the twin with the hood cut away, numbered call-outs, legend."""
    import base64
    fig = OUT / "figures" / f"fig_bay_{view}.png"
    posf = OUT / "figures" / f"fig_bay_{view}_positions.json"
    if not (fig.exists() and posf.exists()):
        return None
    pos = json.load(posf.open())
    p = Page(number, "Engine Harness", odd=odd)
    p.heading("Component Location — Engine Bay")
    p.txt(W / 2, p.y + 2, "View from above the driver's front quarter (azimuth −20°, elevation 62°), hood cut away. From the digital twin.", 7.5, anchor="middle")
    fw = W - 2 * M - 80                                # the figure leaves room for the call-out tables under it
    fh = fw * 1100 / 1600
    fx, fy = M + 40, p.y + 10
    data = base64.b64encode(fig.read_bytes()).decode()
    p.el.append(f'<image x="{fx}" y="{fy}" width="{fw:.1f}" height="{fh:.1f}" href="data:image/png;base64,{data}"/>')
    p.rect(fx, fy, fw, fh, sw=0.8)
    items = []
    eps = reg["endpoints"]
    pts = []
    for obj, code in TWIN_PLUG.items():
        if obj not in pos or code not in eps:
            continue
        x, y = pos[obj]
        if 0 <= x <= 1 and 0 <= y <= 1:
            pts.append((fx + x * fw, fy + y * fh, code))
    # plugs that are not twin objects, placed from the working-assumption anchors (load_map_rows.ANCHORS; PDM15 and the
    # engine ground bank beside the batteries = the twin battery's centre), projected with the figure's own camera
    # recovered from the twin objects it drew (review round 3: the page lacked PDM15, the 61-pin and the ground banks)
    assumed = {}
    for code, (xyz, why) in extra_locations().items():
        if code in eps:
            uv = project_bay(view, xyz)
            if uv is not None and 0 <= uv[0] <= 1 and 0 <= uv[1] <= 1:
                pts.append((fx + uv[0] * fw, fy + uv[1] * fh, code))
                assumed[code] = why
    # GM call-outs: the number sits clear of the cluster on a ring around it, a leader runs to the part (0A-5 Fig. 7)
    import math as _m
    cxm = sum(x for x, _, _ in pts) / max(len(pts), 1)
    cym = sum(y for _, y, _ in pts) / max(len(pts), 1)
    ring = max((_m.hypot(x - cxm, y - cym) for x, y, _ in pts), default=0) + 42
    order = sorted(pts, key=lambda t: _m.atan2(t[1] - cym, t[0] - cxm))
    angles = [_m.atan2(y - cym, x - cxm) for x, y, _ in order]
    # numbers sit evenly around the ring in the order of their parts' bearings (GM plate practice): no two can touch
    n_ = len(angles)
    ring = max(ring, 15.0 * n_ / (2 * _m.pi) + 6)
    a0 = angles[0] if angles else 0.0
    angles = [a0 + i_ * 2 * _m.pi / n_ for i_ in range(n_)]
    n = 0
    for (x, y, code), a in zip(order, angles):
        n += 1
        lx, ly = cxm + ring * _m.cos(a), cym + ring * _m.sin(a)
        lx = min(max(lx, fx + 8), fx + fw - 8); ly = min(max(ly, fy + 8), fy + fh - 8)
        p.line(lx, ly, x, y, 0.6)
        p.el.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.4" fill="#000"/>')
        p.el.append(f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="5.4" fill="#fff" stroke="#000" stroke-width="0.9"/>')
        p.txt(lx, ly + 2.4, str(n), 6.2, bold=True, anchor="middle")
        name = (eps[code].get("device") or code).split("(")[0].split(" — ")[0].strip()
        items.append((n, name, OPEN_POSITION.get(code, "") or (f"working assumption, not a twin object: {assumed[code]}"
                                                               if code in assumed else "")))
    p.y = fy + fh + 10
    half = (len(items) + 1) // 2
    widths = [18, 140, COLW - 158]
    y1 = p.table(M, p.y, widths, ["No.", "Component", "Note"], items[:half], size=6.0, lead=7.8)
    t1 = p.tail
    y2 = p.table(M + COLW + GUT, p.y, widths, ["No.", "Component", "Note"], items[half:], size=6.0, lead=7.8)
    if t1 is not p or p.tail is not p:
        p.faults = ["component-location tables run past the page: shrink the figure or the rows"]
    p.y = max(y1, y2) + 10
    for ln in p.wrap("Call-outs sit at the twin's component positions; the twin insert draws each component as a placeholder "
                     "outline until its vendor CAD is added.", W - 2 * M, 6.4):
        p.txt(M, p.y, ln, 6.4)
        p.y += 8
    return p


DESIG = {}
for _f, _key in (("m130_designations.txt", "M130"), ("pdm30_designations.txt", "PDM30"), ("pdm15_designations.txt", "PDM15")):
    _p = CD / _f
    if _p.exists():
        for _l in _p.read_text().splitlines():
            _parts = _l.split("|")
            if len(_parts) >= 3:
                DESIG[(_key, re.sub(r"^([AB])0?(\d+)$", lambda m_: m_.group(1) + m_.group(2), _parts[0]))] = (_parts[1], _parts[2])


TECHSPEC = CD.parents[2] / "reference_documents" / "component_drawings" / "motec_m1_hardware_techspec.pdf"


def designation_faults():
    """m130_designations.txt checked against the MoTeC M1 hardware techspec pinout pages (p.15-18): every pin of both
    connectors present, the designation equal, and any '1k pull up to SEN_5V_x' note equal to the maker's."""
    if not TECHSPEC.exists():
        return [f"M130 techspec not on file ({TECHSPEC.name}): designations cannot be checked"]
    txt = subprocess.run(["pdftotext", "-layout", "-f", "15", "-l", "18", str(TECHSPEC), "-"], capture_output=True, text=True).stdout
    maker = {}
    for m in re.finditer(r"^\s*([AB]\d{2})\s+(\S+)\s+(.*)$", txt, re.M):
        pull = re.search(r"Pull up to (SEN_5V_[AB])", m.group(3))
        maker[m.group(1)] = (m.group(2), pull.group(1) if pull else None)
    ours = {}
    for ln in (CD / "m130_designations.txt").read_text().splitlines():
        f = ln.split("|")
        if len(f) >= 3:
            pull = re.search(r"Pull up to (SEN_5V_[AB])", f[2])
            ours[f[0]] = (f[1], pull.group(1) if pull else None)
    bad = []
    for pin in [f"A{i:02d}" for i in range(1, 35)] + [f"B{i:02d}" for i in range(1, 27)]:
        if pin not in ours:
            bad.append(f"M130 {pin}: not in the designation file (techspec gives {maker.get(pin, ('?',))[0]})")
        elif pin in maker and ours[pin] != maker[pin]:
            bad.append(f"M130 {pin}: file says {ours[pin]}, techspec says {maker[pin]}")
    return bad


def page_pinout(reg, wires, number, odd, dev, conn, n_pins, title, mating, source):
    """A computer connector, full page, in colour: every pin in moulded order (a pin map, not the housing's shape: the
    TE drawing with the cavity arrangement is not on file yet), the wire in it coloured as ordered, and the table
    pin · MoTeC designation · circuit · wire · goes to."""
    eid = f"{dev}-{conn}"
    ends = {}
    for tm in reg["terminations"]:
        if tm["endpoint"] == eid and tm.get("cavity"):
            ends.setdefault(tm["cavity"], []).append(tm["wire"])
    def norm(c):
        return re.sub(r"^([AB])0?(\d+)$", lambda m_: m_.group(1) + m_.group(2), str(c))
    used = {norm(c): v for c, v in ends.items()}
    p = Page(number, PIN_SECTION[dev], odd=odd)
    p.heading(title)
    p.txt(W / 2, p.y + 2, f"Mating connector {mating}.", 7, anchor="middle")
    p.txt(W / 2, p.y + 11, f"Pin map in moulded order; the housing shape and row layout wait for the TE drawing. Pin functions: {source}.", 7, anchor="middle")
    p.y += 9
    # the map: pins in rows of 12 (a print order, not the housing's rows)
    per_row = 12
    cw, ch = 40, 30
    x0 = M + (W - 2 * M - per_row * cw) / 2
    y0 = p.y + 16
    for i in range(1, n_pins + 1):
        pin = f"{conn}{i}"
        r_, c_ = divmod(i - 1, per_row)
        X, Y = x0 + c_ * cw, y0 + r_ * (ch + 26)
        ws = used.get(pin, [])
        w = wires.get(ws[0]) if ws else None
        p.el.append(pin_symbol(X + 3, Y, cw - 6, ch, w))       # the book's one set of symbols (see LEGEND_KEYS)
        p.txt(X + cw / 2, Y - 3, pin, 6.6, bold=True, anchor="middle")
        if ws:
            # the first circuit, whole, and how many more share the pin (the table lists every one of them)
            size_ = 5.6
            while tw(str(ws[0]).upper(), size_) > cw - 2 and size_ > 3.8:
                size_ -= 0.3                                # a long id shrinks to fit its cell; it never overprints its neighbour
            lines_ = wrap_text(str(ws[0]).upper(), cw - 2, size_) + ([f"+{len(ws) - 1} more"] if len(ws) > 1 else [])
            for k_, ln_ in enumerate(lines_):
                p.txt(X + cw / 2, Y + ch + 8 + k_ * (size_ + 1), ln_, size_, anchor="middle")
        else:
            desig = DESIG.get((dev, pin), ("", ""))[0]
            p.txt(X + cw / 2, Y + ch + 8, "spare" if desig not in ("-", "") else "n/c", 5.2, anchor="middle", italic=True)
    rows_n = (n_pins + per_row - 1) // per_row
    p.y = y0 + rows_n * (ch + 26) + 2
    p.txt(W / 2, p.y, "Fill = the wire's colour, a band = its stripe · black with a white frame = shielded-cable conductor · "
          "dotted orange edge = colour not set (OPEN) · white, 'spare' = no wire", 6.0, anchor="middle", italic=True)
    p.y += 8
    # the table
    rows = []
    for i in range(1, n_pins + 1):
        pin = f"{conn}{i}"
        d_ = DESIG.get((dev, pin), ("", ""))
        ws = used.get(pin, [])
        if ws:
            w = wires.get(ws[0]) or {}
            far = kits_v5.dave_name(w) + (f" (+{len(ws) - 1} spliced)" if len(ws) > 1 else "")
            rows.append((pin, d_[0], ", ".join(x_.upper() for x_ in ws), gm_colour(f"{gauge(w)} {colour(w)}"), far.upper()))
            listed = len([x_ for x_ in rows[-1][2].split(", ") if x_])
            if listed != len(ws):                       # every member printed: the count shown must match the list
                p.__dict__.setdefault("faults", []).append(f"{pin}: circuit column lists {listed} of {len(ws)} wires")
        else:
            rows.append((pin, d_[0], "—", "", ("NOT USED" if d_[0] == "-" else "SPARE") if d_ != ("", "") else "SPARE"))
    widths = [30, 66, 110, 70, W - 2 * M - 276]
    p.table(M, p.y, widths, ["Pin", "MoTeC", "Circuit", "Size, Color", "Goes To"], rows, size=5.6, lead=7.2)
    if dev not in p.section:
        p.__dict__.setdefault("faults", []).append(f"pinout of {dev} under the header '{p.section}'")
    return p


PIN_SECTION = {"M130": "Engine Computer — M130", "PDM30": "Body Harness — PDM30", "PDM15": "Engine Bay — PDM15"}


PINOUTS = [("M130", "A", 34, "M130 Connector A — 34-Way Pinout", "TE Superseal 1.0 34-way key 1, TE 4-1437290-0 (MoTeC 65044)", "M130 datasheet p.3"),
           ("M130", "B", 26, "M130 Connector B — 26-Way Pinout", "TE Superseal 1.0 26-way key 1, TE 3-1437290-7 (MoTeC 65045)", "M130 datasheet p.4"),
           ("PDM30", "A", 34, "PDM30 Connector A — 34-Way Pinout", "TE Superseal 1.0 34-way, MoTeC 65044", "PDM30 datasheet p.2"),
           ("PDM30", "B", 26, "PDM30 Connector B — 26-Way Pinout", "TE Superseal 1.0 26-way, MoTeC 65045", "PDM30 datasheet p.2"),
           ("PDM15", "A", 34, "Engine PDM15 Connector A — 34-Way Pinout", "TE Superseal 1.0 34-way, MoTeC 65044", "PDM user manual p.42"),
           ("PDM15", "B", 26, "Engine PDM15 Connector B — 26-Way Pinout", "TE Superseal 1.0 26-way, MoTeC 65045", "PDM user manual p.42")]


SPARE_HATCH = ('<pattern id="sparehatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
               '<line x1="0" y1="0" x2="0" y2="2.4" stroke="#888" stroke-width="0.6"/></pattern>')
SHIELD_FILL, UNSET_STROKE = "#111", "#E67300"
DARK_FILLS = ("#111", "#7a4a1d", "#2457c5", "#1f8a3b", "#7b3fa0", "#d3222a", "#555", "#8a8a8a")


def cavity_fill(w):
    """The fill a cavity gets: the wire's first colour; a shielded-cable conductor is black with a white shield ring;
    a wire with no colour set is white with a dotted orange ring; a spare is hatched (never plain white)."""
    if not w:
        return "url(#sparehatch)"
    col = str(w.get("color") or "").lower().split("+")[0]
    parts_ = [q.strip() for q in col.split("/") if q.strip()]
    if not parts_:
        return "#fff"
    if parts_[0] in ("cable", "shld"):
        return SHIELD_FILL
    return HEXC.get(parts_[0], "#fff")


def cavity_symbol(X, Y, r, w, cid):
    """One cavity drawn the book's one way (firewall faces, the legend page): see cavity_fill."""
    fill = cavity_fill(w)
    if not w:
        return (SPARE_HATCH + f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{r}" fill="url(#sparehatch)" stroke="#666" '
                f'stroke-width="0.6" stroke-dasharray="1.6 1.2"/>')
    col = str(w.get("color") or "").lower().split("+")[0]
    parts_ = [q.strip() for q in col.split("/") if q.strip()]
    unset = not parts_ or parts_[0] not in HEXC
    out = f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{r}" fill="{fill}" stroke="{UNSET_STROKE if unset else "#000"}" ' \
          f'stroke-width="{1.1 if unset else 0.8}"{" stroke-dasharray=\"1.2 1.2\"" if unset else ""}/>'
    if parts_ and parts_[0] in ("cable", "shld"):
        out += f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{r * 0.72:.2f}" fill="none" stroke="#fff" stroke-width="0.7"/>'
    stripe = HEXC.get(parts_[1]) if len(parts_) > 1 and parts_[0] not in ("cable", "shld") else None
    if stripe:
        out += (f'<clipPath id="{cid}"><circle cx="{X:.1f}" cy="{Y:.1f}" r="{r}"/></clipPath>'
                f'<rect x="{X - r - 0.4:.1f}" y="{Y + r * 0.32:.1f}" width="{2 * r + 0.8:.1f}" height="{r * 0.37:.1f}" '
                f'fill="{stripe}" clip-path="url(#{cid})"/>')
    return out


def pin_symbol(x, y, w_, h_, w):
    """A computer pin drawn with the same rules as a firewall cavity: wire colour fill and stripe band; shielded-cable
    conductor = black with a white inner frame; colour not set = white with a dotted orange edge; no wire = white."""
    if not w:
        return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w_:.1f}" height="{h_:.1f}" fill="#fff" stroke="#000" stroke-width="0.9"/>'
    col = str(w.get("color") or "").lower().split("+")[0]
    parts_ = [q.strip() for q in col.split("/") if q.strip()]
    unset = not parts_ or parts_[0] not in HEXC
    shield = bool(parts_) and parts_[0] in ("cable", "shld")
    fill = "#fff" if unset else (SHIELD_FILL if shield else HEXC[parts_[0]])
    out = (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w_:.1f}" height="{h_:.1f}" fill="{fill}" '
           f'stroke="{UNSET_STROKE if unset else "#000"}" stroke-width="{1.2 if unset else 0.9}"'
           f'{" stroke-dasharray=\"1.4 1.2\"" if unset else ""}/>')
    if shield:
        out += f'<rect x="{x + 3:.1f}" y="{y + 3:.1f}" width="{w_ - 6:.1f}" height="{h_ - 6:.1f}" fill="none" stroke="#fff" stroke-width="0.8"/>'
    stripe = HEXC.get(parts_[1]) if len(parts_) > 1 and not shield else None
    if stripe:
        out += f'<rect x="{x:.1f}" y="{y + h_ * 0.4:.1f}" width="{w_:.1f}" height="{h_ * 0.2:.1f}" fill="{stripe}"/>'
    return out


LEGEND_KEYS = [({"color": "white"}, "white fill = a white wire"),
               ({"color": "white/blue"}, "a band = the wire's stripe (white/blue)"),
               ({"color": "gray"}, "grey fill = a grey wire, nothing else"),
               ({"color": "cable"}, "black with a white ring = shielded-cable conductor"),
               ({"color": ""}, "dotted orange ring = colour not set yet (OPEN)"),
               (None, "hatched, dashed ring = spare cavity")]


def symbol_faults():
    """The status symbols must not look like any wire colour (review 2026-09-28: 'white = spare' vs white wires; grey
    meaning both a grey wire and a shielded cable). Compares the drawn symbol, not just the fill."""
    wire_syms = {cavity_symbol(0, 0, 5, {"color": c}, "k") for c in HEXC if c not in ("cable", "shld")}
    bad = []
    for w_, words_ in LEGEND_KEYS:
        status = w_ is None or not w_.get("color") or w_.get("color") in ("cable", "shld")
        if status and cavity_symbol(0, 0, 5, w_, "k") in wire_syms:
            bad.append(f"legend: '{words_}' is drawn the same as a wire colour")
    return bad


def page_firewall(reg, wires, number, odd):
    """FIREWALL CONNECTOR — the 61-pin seen from both sides. Cavity positions: MILNEC insert arrangement 25-61 (front
    face of the pin insert), transcribed in scripts/generate_connector_build_sheets.py CAV_XY; the receptacle's mating
    face seen from the engine side is its mirror. Each cavity carries its circuit and wire."""
    sheets = kits_v5._load_sheets()
    xy = sheets.CAV_XY
    cav_wire = {t.get("cavity"): t["wire"] for t in reg["terminations"] if t["endpoint"] == "FIREWALL-ENGINE" and t.get("cavity")}
    p = Page(number, "Engine Harness — Firewall", odd=odd)
    p.heading("Firewall Connector — 61-Pin, Both Faces")
    fw = reg["endpoints"].get("FIREWALL-ENGINE", {})
    intro = ("D38999/24WJ61SN wall receptacle on the firewall (socket contacts, female); D38999/26WJ61PN plug on the engine harness "
             "(pin contacts, male). Every engine circuit crosses here; body circuits never do. Where on the firewall it mounts is not "
             "decided: the M130 mount (state §4) sets it. Positions are the insert arrangement, not a measurement.")
    for i_, ln_ in enumerate(p.wrap(intro, W - 2 * M, 7.2)):
        p.txt(W / 2, p.y + 2 + i_ * 9, ln_, 7.2, anchor="middle")
    p.y += 9 * (len(p.wrap(intro, W - 2 * M, 7.2)) - 2)
    xs = [v[0] for v in xy.values()]; ys = [v[1] for v in xy.values()]
    cx0, cy0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    R = (COLW - 30) / 2
    scale = (2 * R - 30) / span
    dev_end, cab_end = {}, {}
    for tm in reg["terminations"]:
        wid = str(tm["wire"])
        if tm["endpoint"] in ("FIREWALL-ENGINE", "FIREWALL-CABIN"):
            continue
        e_ = reg["endpoints"].get(tm["endpoint"], {})
        if e_.get("where") == "engine":
            import diagram_v5 as D
            dev_end[wid] = f"{D.plug_title(tm['endpoint'], e_)} {tm.get('cavity') or '?'}"
        elif tm["endpoint"].startswith(("M130", "PDM30", "PDM15")):
            cab_end[wid] = f"{tm['endpoint'].replace('-', ' ')} {tm.get('cavity') or '?'}"
        elif e_.get("side") == "cab" and wid not in cab_end:
            # any other cab-side end (the Dakota VHX terminals): the plug and its terminal, from the termination row
            import diagram_v5 as D
            cab_end[wid] = f"{D.plug_title(tm['endpoint'], e_)} {tm.get('cavity') or '?'}"
    # a shield drain has no engine-end termination: print what the wire list says happens there (it floats)
    for wid, w in wires.items():
        m_ = re.search(r"[^|;]*(?:floats|cut back|sleeved)[^|;]*", str(w.get("notes") or ""), re.I)
        if m_ and wid not in dev_end:
            dev_end[wid] = "none: " + m_.group(0).strip()
    def face(x_c, y_c, mirror, title, sub):
        p.el.append(f'<circle cx="{x_c:.1f}" cy="{y_c:.1f}" r="{R:.1f}" fill="none" stroke="#000" stroke-width="1.2"/>')
        p.rect(x_c - 7, y_c - R - 7, 14, 8, sw=1.0, rx=1.5)                   # master key
        for cav, (px_, py_) in xy.items():
            dx, dy = (px_ - cx0) * scale, (py_ - cy0) * scale
            if mirror:
                dx = -dx
            X, Y = x_c + dx, y_c + dy
            wid = cav_wire.get(cav)
            w = wires.get(wid) if wid else None
            p.el.append(cavity_symbol(X, Y, 7.6, w, f"fw{'m' if mirror else 'c'}_{cav}{'U' if cav[:1].isupper() else 'l'}"))
            fill = cavity_fill(w)
            p.txt(X, Y + 2.2, cav, 6.2, bold=True, anchor="middle", italic=False)
            if fill in DARK_FILLS:
                p.el[-1] = p.el[-1].replace('<text ', '<text fill="#fff" ', 1)
        p.txt(x_c, y_c + R + 14, title.upper(), 7.2, bold=True, anchor="middle")
        for i_, ln_ in enumerate(p.wrap(sub, COLW - 6, 6.2)):
            p.txt(x_c, y_c + R + 24 + i_ * 8, ln_, 6.2, anchor="middle")
    yc = p.y + 34 + R
    # one orientation through the whole book: cab on the left, engine on the right (review 2026-09-28, bulkhead maps)
    face(M + COLW / 2, yc, False, "Cab side — rear, wire entry (sockets crimped here)",
         "the cab wires enter from this side; same view as the engine-harness plug's pin face (D38999/26WJ61PN, male)")
    face(M + COLW + GUT + COLW / 2, yc, True, "Engine side — mating face (sockets, female)",
         "D38999/24WJ61SN on the firewall, seen from the engine bay; the harness plug's pins (male) enter here")
    p.y = yc + R + 46
    # ---- the parts: receptacle, plug, contacts, backshells, boots, tools (photos where a vendor photo is on file)
    import base64
    bom = reg["bom"]["parts"]
    parts_y = yaml.safe_load((CD / "catalog" / "parts.yaml").read_text())
    tools_y = {t_["id"]: t_ for t_ in reg["tools"]}
    strip = [("D38999/24WJ61SN", "D38999-24WJ61SN", "jam-nut wall receptacle, shell 25, insert 61, sockets (female), on the firewall", None),
             ("D38999/26WJ61PN", "D38999-26WJ61PN", "straight plug, shell 25, insert 61, pins (male), on the engine harness", None),
             ("M39029/56-351", "M39029-56-351", "size-20 socket contact, crimp, 20–24 AWG — receptacle, cab side", None),
             ("M39029/58-363", "M39029-58-363", "size-20 pin contact, crimp, 20–24 AWG — plug, engine side", None),
             ("M85049/69-25N", "M85049-69-25N", "accessory adapter, shell 25 (boot seat), one per side", None),
             ("202K163-25-0", None, "Raychem straight shrink boot, one per side", None),
             ("M22520/2-01", "AFM8", "DMC AFM8 crimp frame (tool)", None),
             ("M22520/2-10", "K43", "DMC K43 positioner for the size-20 contacts (tool)", None),
             ("M81969/14-10", "M81969-14-10", "size-20 insertion/removal tool (tool)", None)]
    p.txt(M, p.y, "PARTS — THE CONNECTOR, ITS CONTACTS, BACKSHELLS, BOOTS AND TOOLS", 8.5, bold=True)
    p.y += 6
    cell_w = (W - 2 * M) / len(strip)
    ph = 46
    for i_, (pn, img, what, note) in enumerate(strip):
        x_ = M + i_ * cell_w
        f = PRODUCT_IMAGES / f"{img}.png" if img else None
        if f and f.exists():
            uri = "data:image/png;base64," + base64.b64encode(f.read_bytes()).decode()
            p.el.append(f'<image x="{x_ + (cell_w - ph) / 2:.1f}" y="{p.y:.1f}" width="{ph}" height="{ph}" preserveAspectRatio="xMidYMid meet" href="{uri}"/>')
        else:
            p.txt(x_ + cell_w / 2, p.y + ph / 2 + 2, "no photo on file", 5.2, anchor="middle", italic=True)
        qty = bom.get(pn) or bom.get(pn.replace("M22520/2-01", "AFM8")) or ""
        p.txt(x_ + cell_w / 2, p.y + ph + 9, pn, 6.2, bold=True, anchor="middle")
        p.txt(x_ + cell_w / 2, p.y + ph + 16, f"×{qty}" if qty else "tool", 5.6, anchor="middle")
        for j_, ln_ in enumerate(p.wrap(what + (f" ({note})" if note else ""), cell_w - 4, 4.8)):
            p.txt(x_ + cell_w / 2, p.y + ph + 23 + j_ * 5.8, ln_, 4.8, anchor="middle")
    p.y += ph + 52
    ly = p.y
    for k_, (w_, words_) in enumerate(LEGEND_KEYS):
        lx = M + (k_ % 3) * ((W - 2 * M) / 3)
        yy = ly + (k_ // 3) * 13
        p.el.append(cavity_symbol(lx + 5, yy - 2.4, 4.6, w_, f"fwkey{k_}"))
        p.txt(lx + 13, yy, words_, 6.0)
    p.y = ly + 13 * ((len(LEGEND_KEYS) + 2) // 3) + 2
    p.faults = symbol_faults()
    for ln_ in p.wrap("Photos are the vendors' product photos of the exact part numbers (DigiKey, DMC). The two shells lined up are "
                      "eBay surplus of the same numbers.", W - 2 * M, 6.2):
        p.txt(M, p.y, ln_, 6.2, italic=True)
        p.y += 8
    # ---- the cavity table, on the facing page
    p2 = Page(f"1-{int(number.split('-')[1]) + 1}", "Engine Harness — Firewall", odd=not odd)
    p2.heading("Firewall Connector — Cavity Table")
    p2.txt(W / 2, p2.y + 2, "Cavity · circuit · size, colour · function · ENGINE END (the plug and cavity in the engine bay) · CAB END (the computer pin). Spares are marked.", 6.6, anchor="middle")
    p2.y += 8
    rows = []
    for cav in sheets.CAV_ORDER:
        wid = cav_wire.get(cav)
        w = wires.get(wid) if wid else None
        rows.append((cav, (wid or "—").upper(), gm_colour(f"{gauge(w)} {colour(w)}") if w else "spare",
                     kits_v5.dave_name(w).upper() if w else "", open_word((dev_end.get(wid) or "").upper()) if w else "",
                     open_word((cab_end.get(wid) or "").upper()) if w else ""))
    widths = [24, 62, 72, 124, 150, W - 2 * M - 432]
    blank = [r[0] for r in rows if r[1] != "—" and (not r[4] or not r[5])]
    if blank:
        p.__dict__.setdefault("faults", []).append(f"61-pin cavity table: an end left blank at {', '.join(blank)}")
    p2.table(M, p2.y, widths, ["Cav", "Ckt", "Size, Color", "Function", "Engine End", "Cab End"], rows, size=5.6, lead=7.0)
    p.extra_pages = [p2] + p2.__dict__.pop("extra_pages", [])
    return p


# ---------------------------------------------------------------- legend, wire specification, special tools, terminal procedures
def page_legend(number, odd):
    """SYMBOLS — what every mark in this book means (IEEE 315 practice: a legend page, not a footnote)."""
    p = Page(number, "Harness Standards", odd=odd)
    p.heading("Symbols and Conventions")
    x, y = M, p.y + 10
    def row(draw, text):
        nonlocal y
        draw(x + 6, y)
        for i_, ln_ in enumerate(p.wrap(text, W - 2 * M - 70, 7.4)):
            p.txt(x + 64, y + 4 + i_ * 9.4, ln_, 7.4)
        y += max(22, 9.4 * len(p.wrap(text, W - 2 * M - 70, 7.4)) + 10)
    def sq(x_, y_):
        p.rect(x_, y_ - 6, 13, 13, sw=0.9, fill="#1f8a3b"); p.rect(x_, y_ - 6 + 13 * 0.4, 13, 13 * 0.2, sw=0, fill="#d3222a")
        p.txt(x_ + 6.5, y_ - 9, "3", 6.5, bold=True, anchor="middle")
    row(sq, "PIN MAP — one square per cavity, in the order the marking is moulded on the plug, filled in the ordered wire colour; a band across it is the stripe colour. The housing's shape is not drawn unless the maker's drawing is on file.")
    def cav(x_, y_):
        p.el.append(f'<circle cx="{x_ + 8}" cy="{y_}" r="7.6" fill="#7a4a1d" stroke="#000" stroke-width="0.8"/>'); p.txt(x_ + 8, y_ + 2.2, "AA", 6.2, bold=True, anchor="middle")
        p.el[-1] = p.el[-1].replace('<text ', '<text fill="#fff" ', 1)
        p.el.append(f'<circle cx="{x_ + 30}" cy="{y_}" r="7.6" fill="#fff" stroke="#bbb" stroke-width="0.5"/>'); p.txt(x_ + 30, y_ + 2.2, "c", 6.0, anchor="middle")
    row(cav, "61-PIN FIREWALL CONNECTOR — drawn to its insert arrangement (MIL-DTL-38999 insert 25-61), each cavity filled in the wire's colour. "
             "Hatched with a dashed ring = spare; faint = not on this sheet; dotted orange ring = colour not set; black with a white ring = "
             "shielded-cable conductor (grey is only ever a grey wire). Every bulkhead view in the book is drawn cab side left, engine side right.")
    def run(x_, y_):
        p.el.append(f'<polyline points="{x_},{y_} {x_ + 44},{y_}" fill="none" stroke="#000" stroke-width="2.3"/>')
        p.el.append(f'<polyline points="{x_},{y_} {x_ + 44},{y_}" fill="none" stroke="#f2f2f2" stroke-width="1.4"/>')
        p.el.append(f'<polyline points="{x_},{y_} {x_ + 44},{y_}" fill="none" stroke="#f28c28" stroke-width="0.5"/>')
        p.txt(x_, y_ - 4, "22 WHT/ORN-99R · TOTAL RUN 4.6 FT EST", 4.8)
    row(run, "RUN — a wire, drawn in its ordered colour with a thin centre line for the stripe; a shielded-cable conductor is black with a white "
             "centre line; a run with an orange edge has no colour set yet. Label = gauge, colour, circuit, then the run's total length, printed "
             "once per sheet (the same wire labelled again, past a connector, carries no length): EST until measured with a tape on the truck.")
    def dashed(x_, y_):
        p.el.append(f'<polyline points="{x_},{y_} {x_ + 44},{y_}" fill="none" stroke="#000" stroke-width="1.4" stroke-dasharray="3 2"/>')
        p.txt(x_ + 22, y_ + 9, "OPEN", 5.4, italic=True, anchor="middle"); p.el[-1] = p.el[-1].replace('<text ', '<text fill="#E67300" ', 1)
    row(dashed, "DASHED RUN and orange text — OPEN: an end, a cavity, a length or a part is not settled. The orange words say which fact closes it. Nothing dashed is built.")
    def gnd(x_, y_):
        p.line(x_ + 8, y_ - 6, x_ + 8, y_); [p.line(x_ + 8 - hw, y_ + i_ * 2.2, x_ + 8 + hw, y_ + i_ * 2.2, 0.8) for i_, hw in enumerate((6, 4, 2))]
    row(gnd, "GROUND — a return to a ground bank (in the loom, never a body stud). The bank is named on the run.")
    def dot(x_, y_):
        p.el.append(f'<polyline points="{x_},{y_} {x_ + 44},{y_}" fill="none" stroke="#000" stroke-width="1.4"/>'); p.el.append(f'<circle cx="{x_ + 22}" cy="{y_}" r="2.6" fill="#000"/>'); p.txt(x_ + 22, y_ - 5, "S-3", 5.4, bold=True, anchor="middle")
    row(dot, "SPLICE — a dot with its number; the splice table on the sheet gives the wires joined and the splice part. Its position on the loom is set on the formboard.")
    def shield(x_, y_):
        p.el.append(f'<polyline points="{x_},{y_} {x_ + 44},{y_}" fill="none" stroke="#111" stroke-width="1.4"/>'); p.el.append(f'<polyline points="{x_},{y_} {x_ + 44},{y_}" fill="none" stroke="#fff" stroke-width="0.5"/>'); p.el.append(f'<ellipse cx="{x_ + 22}" cy="{y_}" rx="16" ry="5" fill="none" stroke="#000" stroke-width="0.6" stroke-dasharray="2 1.5"/>')
    row(shield, "SHIELDED CABLE — a dashed oval around the run; the drain wire leaves it to its splice. Rule: the drain is grounded at the ECU end only; the sensor end floats.")
    def arrow(x_, y_):
        p.el.append(f'<polyline points="{x_},{y_} {x_ + 30},{y_} {x_ + 26},{y_ - 3} {x_ + 30},{y_} {x_ + 26},{y_ + 3}" fill="none" stroke="#000" stroke-width="0.9"/>'); p.txt(x_ + 15, y_ + 9, "plug · cav · sheet", 4.8, anchor="middle")
    row(arrow, "OFF-SHEET — the run continues on another sheet; the tag names the plug, its cavity and the sheet number.")
    def box(x_, y_):
        p.rect(x_, y_ - 7, 40, 14, sw=1.0, rx=3); p.rect(x_ + 30, y_ - 3.4, 8, 6.8, sw=0.6, fill="#fff"); p.txt(x_ + 34, y_ + 2, "2", 5.2, bold=True, anchor="middle")
    row(box, "PLUG BOX — a device seen at its plug: one row per cavity with the moulded mark and the wire's function in the builder's words. The title links to the plug's card on the truck's map (part, proof, photos).")
    p.y = y + 6
    p.columns([("h", "Stamps"),
               ("p", "DESIGN COMPLETE — every wire end, terminal and seal at this plug is named and cited. OPEN — one fact is missing; it is named. Nothing in this book says whether a part has been bought; that lives on the truck's map."),
               ("h", "Words"),
               ("p", "Wires are named the way the builder names them: TPS, oil PSI, crank sensor, 0 V for a return, 5 V for a reference; never a cut-list code. Circuit numbers are this build's wire numbers and are the provisional label text until the builder's label list exists.")], top=p.y)
    return p


# MoTeC PDM user manual p.48 (PDF p.51), 'Wire Specification', M22759/16: current rating [A] at 80 °C ambient (6, 4, 2 AWG:
# single wire in free air). Transcribed 2026-09-28; the page prints these and fails the build if a row differs.
PDM_P48 = {24: 4.5, 22: 6, 20: 8, 18: 11, 16: 15, 14: 22, 6: 90, 4: 120, 2: 150}
# Size-20 M39029 contact pull minimums, Checkline 'Wire pull test standards' contact table, barrel size 20:
# 24 / 22 / 20 AWG = 36 / 57 / 92 N (8 / 13 / 21 lbf) — the Dave-sheet receipt addendum, 2026-09-26.
SIZE20_PULL = "24 AWG ≥ 8 lbf · 22 ≥ 13 · 20 ≥ 21 (size-20 contact minimums, Checkline contact table: 36 / 57 / 92 N)"


SUBSYSTEM_WORDS = {"CORE_ENGINE": "engine", "LIGHTING_EXTERIOR": "exterior lamps", "POWER_WINDOWS": "power windows",
                   "DASH_CLUSTER_DAKOTA": "Dakota gauges", "CHARGING_STARTING": "charging and starting", "AUDIO": "audio",
                   "HVAC_AC": "heater and A/C", "HARNESS_INFRA": "power spine and grounds", "TRANS_6L80E": "6L80E transmission",
                   "ACCESSORY_12V": "12 V accessories", "LIGHTING_INTERIOR": "interior lamps", "COOLING": "cooling fan",
                   "POWER_LOCKS": "power locks", "WIPERS_WASHER": "wipers and washer", "CAMERA_REAR": "rear camera",
                   "EPARKING_BRAKE": "parking brake", "AMP_STEPS": "power steps", "FUEL": "fuel", "BRAKES_IBOOSTER": "iBooster",
                   "DOME_COURTESY": "dome and courtesy lamps"}


def used_for(ws):
    """What a wire size carries, read from the wire list (review round 3: the typed 'blower, fan, iBooster' list had gone
    stale): up to four wires by their own labels, else their subsystems, most wires first."""
    from collections import Counter
    if len(ws) <= 4:
        return "; ".join(dict.fromkeys(str(w.get("label") or w["id"]) for w in ws))
    c = Counter(SUBSYSTEM_WORDS.get(w.get("subsystem"), str(w.get("subsystem") or "other").replace("_", " ").lower()) for w in ws)
    return ", ".join(f"{k} ({n})" for k, n in c.most_common())


def page_wire_spec(reg, wires, number, odd):
    """WIRE SIZE AND SPECIFICATION — every wire type in the build, by spec and gauge, with its rating source."""
    p = Page(number, "Harness Standards", odd=odd)
    p.heading("Wire Size and Specification")
    # one list for every count in the book: the buildable harness (base truck + decided options), as options_v5 counts it
    build = [w for w in wires.values() if w.get("option_status") in ("base", "decided")]
    live = [w for w in build if isinstance(w.get("awg"), int)]
    no_gauge = [w for w in build if not isinstance(w.get("awg"), int)]
    from collections import Counter
    cnt = Counter((w.get("spec"), w["awg"], gauge_word(w)) for w in live)       # a parallel pair is its own row
    ft = reg["bom"]["wire_ft"]
    rows = []
    RATING = {a: (f"{v:g} A" + ("‡" if a <= 6 else "*")) for a, v in PDM_P48.items()}
    for (spec, awg, gw), n in sorted(cnt.items(), key=lambda kv: (str(kv[0][0]), -kv[0][1], kv[0][2])):
        feet = sum(v for k, v in ft.items() if k.startswith(f"{spec} {awg} AWG")) if gw == str(awg) else 0
        use = used_for([w for w in live if (w.get("spec"), w["awg"], gauge_word(w)) == (spec, awg, gw)])
        rate = RATING.get(awg, "not in the p.48 table")
        rows.append((str(spec), f"{gw} AWG", n, f"{feet:.0f} ft" if feet else "—", rate + (" each" if "×" in gw and awg in RATING else ""), use))
    p.faults = [f"wire rating {r[1]} printed {r[4]}, PDM manual p.48 gives {PDM_P48.get(int(r[1].split()[0].split('×')[-1]))} A"
                for r in rows if r[4].replace(" each", "") != RATING.get(int(r[1].split()[0].split("×")[-1]), "not in the p.48 table")]
    target = (reg.get("readiness") or {}).get("configuration", {}).get("buildable (base + decided)", {}).get("wires")
    if sum(r[2] for r in rows) + len(no_gauge) != (target if target is not None else len(build)):
        p.faults.append(f"wire spec rows ({sum(r[2] for r in rows)}) + leads with no gauge ({len(no_gauge)}) do not add up to the "
                        f"{target} buildable wires")
    if no_gauge:
        rows.append(("kit lead or cable", "no gauge", len(no_gauge), "—", "—", used_for(no_gauge)))
    widths = [96, 44, 40, 48, 60, W - 2 * M - 288]
    p.y = p.table(M, p.y + 6, widths, ["Specification", "Size", "Wires", "Est. length", "Rating", "Used for"], rows, size=6.4, lead=8.4) + 14
    p.columns([("h", "The wire"),
               ("p", "Tefzel only. M22759/32 (150 °C, thin wall) for 12–20 AWG; M22759/16 (150 °C) for 22 AWG, where the /32's 1.09 mm outside diameter is under the 1.20 mm seal minimum of the GT150 terminals, and for 2–10 AWG. Crank, cam and knock run in M27500 two-conductor shielded cable. CAN is a twisted pair, one twist per 50 mm or better."),
               ("h", "Ratings"),
               ("p", "Ratings are the MoTeC PDM manual's wire table (p.48, M22759/16 Tefzel, 150 °C maximum): *current rating at 80 °C ambient, "
                     "which the manual calls an indication only; ‡ the 6, 4 and 2 AWG ratings are for a single wire in free air. The table lists "
                     "24–14 AWG and 6–2 AWG only: 12, 10 and 8 AWG are not in it and print as such. The design keeps every wire under its PDM output "
                     "setting and derates a wire inside a bundle. A wire is protected at its source by the PDM output setting or by the fuse at the "
                     "stud, never by the load."),
               ("h", "Colours"),
               ("p", "Colours follow the builder's M130 sheet: orange 5 V feeds, brown 0 V returns, white injector and coil drives, green and yellow sensor signals, red +12 V, black grounds. A stripe is the second colour after the slash.")], top=p.y)
    return p


def page_tools(reg, number, odd):
    """SPECIAL TOOLS — the GM plate: numbered tools with photos, the two-column number list under it."""
    import base64
    p = Page(number, "Harness Standards", odd=odd)
    p.heading("Special Tools")
    tools = [t_ for t_ in reg["tools"] if t_.get("status") != "alt"]
    photo_for = {"AFM8": "AFM8", "K43": "K43", "K1S": "K1S", "GT150_CRIMPER": "15359996", "MP150_CRIMPER": "12155975",
                 "MINISEAL_CRIMPER": "3137CT", "STRIP_26_16": "STRIPMASTER-45-1987", "M81969_14_10": "M81969-14-10"}
    cols, cw, ph = 5, (W - 2 * M) / 5, 58
    FAM = {"ssc": "Superseal", "d38999_20": "61-pin firewall", "gt150": "GT150", "mp150": "Metri-Pack 150", "ev1": "injector plugs",
           "kit_terminal": "kit terminals", "te_amp_plug": "throttle body, pedal", "miniseal": "splices", "solder_sleeve": "shield drains",
           "lug": "cable lugs", "ring_small": "ring terminals", "xlr_solder": "laptop port", "dt": "Deutsch DT", "gm_blade": "GM blade plugs",
           "screw_terminal": "screw terminals", "contura": "Contura switch"}
    cells = []
    for t_ in tools:
        name_l = p.wrap(t_.get("name") or t_["id"], cw - 8, 5.6)
        fams = ", ".join(FAM.get(f_, f_) for f_ in (t_.get("families") or []))
        fam_l = p.wrap("for: " + fams, cw - 8, 5.0) if fams else []
        pn_l = p.wrap(t_.get("pn") or "—", cw - 18, 6.6, bold=True)
        cells.append((t_, pn_l, name_l, fam_l, 9 + len(pn_l) * 7.4 + len(name_l) * 6.6 + len(fam_l) * 6.0 + 6))
    x0, Y = M, p.y + 8
    for r0 in range(0, len(cells), cols):
        row = cells[r0:r0 + cols]
        high = ph + max(c[4] for c in row)
        if Y + high > p.BOTTOM - 12:                   # the plate continues on the next page, never off the bottom
            p = p.cont()
            Y = p.y + 8
        for c_, (t_, pn_l, name_l, fam_l, _h) in enumerate(row):
            i_ = r0 + c_
            X = x0 + c_ * cw
            f = PRODUCT_IMAGES / f"{photo_for.get(t_['id'], '')}.png"
            if f.exists():
                uri = "data:image/png;base64," + base64.b64encode(f.read_bytes()).decode()
                p.el.append(f'<image x="{X + (cw - ph) / 2:.1f}" y="{Y:.1f}" width="{ph}" height="{ph}" preserveAspectRatio="xMidYMid meet" href="{uri}"/>')
            else:
                p.rect(X + (cw - ph) / 2, Y, ph, ph, sw=0.5); p.txt(X + cw / 2, Y + ph / 2 + 2, "no photo on file", 5.4, anchor="middle", italic=True)
            yy = Y + ph + 9
            p.txt(X + 4, yy, f"{i_ + 1}.", 6.6, bold=True)
            for ln_ in pn_l:
                p.txt(X + 14, yy, ln_, 6.6, bold=True, href=part_url(t_.get("pn")))
                yy += 7.4
            for ln_ in name_l:
                p.txt(X + 4, yy, ln_, 5.6)
                yy += 6.6
            for ln_ in fam_l:
                p.txt(X + 4, yy, ln_, 5.0, italic=True)
                yy += 6.0
        Y += high
    for ln_ in p.wrap("Numbers are this book's; part numbers are the makers'. A tool the build owns already is not distinguished here: "
                      "the book states what the job needs.", W - 2 * M, 6.2):
        Y += 8
        p.txt(M, Y, ln_, 6.2, italic=True)
    return getattr(p, "root", p)


def fw_spares(reg):
    sheets = kits_v5._load_sheets()
    used = {str(t.get("cavity")) for t in reg["terminations"] if t["endpoint"] == "FIREWALL-ENGINE" and t.get("cavity")}
    return [c for c in sheets.CAV_ORDER if c not in used]


def page_procedures(reg, number, odd, families):
    """TERMINAL REPAIR AND CRIMPING — one block per connector family: the steps, the tool and setting, the pull test."""
    p = Page(number, "Harness Standards", odd=odd)
    p.heading("Crimping and Terminal Procedures")
    blocks = []
    by_id = {t_["id"]: t_ for t_ in reg["tools"]}
    NAMES = {"ssc": "Superseal 1.0 (M130, PDM30, PDM15)", "d38999_20": "D38999 size-20 contacts (61-pin firewall)", "gt150": "GT150 (coolant temp, inlet air temp, oil pressure)",
             "mp150": "Metri-Pack 150 (crank, cam, MAP, knock)", "ev1": "EV1 injector plugs", "kit_terminal": "kit terminals (coils and other kits)", "te_amp_plug": "TE AMP (throttle body, pedal)",
             "miniseal": "MiniSeal stub splices", "solder_sleeve": "shield-drain solder sleeves", "lug": "cable lugs (2–8 AWG)", "ring_small": "small ring terminals", "xlr_solder": "XLR laptop port",
             "dt": "Deutsch DT (door pass-throughs, body bulkheads)", "dtp": "Deutsch DTP", "gm_blade": "GM blade plugs (Packard 56: factory switches)",
             "screw_terminal": "screw terminals", "contura": "Contura switch (0.250 in tabs)"}
    for fam, f_ in families.items():
        steps = f_.get("steps") or []
        if not steps:
            continue
        blocks.append(("h", NAMES.get(fam, fam)))
        for st in steps:
            tool = st.get("tool")
            ids = tool if isinstance(tool, list) else ([tool] if tool else [])
            names = []
            for tid in ids:
                if tid in ("hand", "by_endpoint"):
                    continue
                t_ = by_id.get(tid)
                names.append((f"{t_.get('name')} ({t_['pn']})" if t_.get("pn") else t_.get("name")) if t_ else tid.replace("_", " ").lower())
            val = str(st.get("value") or "")
            if fam == "d38999_20" and st["do"] in ("pull test", "pull + look"):
                val = SIZE20_PULL                         # the contact's own minimums, not the generic crimp values
            if fam == "d38999_20" and re.search(r"empty cavit", st["do"] + " " + val, re.I):
                sp_ = fw_spares(reg)                      # counted from the 61-pin fill, never typed (review round 3)
                val = re.sub(r"\s*\(none if all 61 are used\)", "", val) + (
                    f" — {len(sp_)} needed now: cavities {', '.join(sp_)} are spare" if sp_ else " — none needed: all 61 are used")
            val = val.replace("UNKNOWN:", "OPEN:").replace("UNKNOWN", "OPEN").replace("SEN_0V", "sensor 0 V")
            part = f" part {st['part']}" if st.get("part") else ""
            blocks.append(("p", f"{st['do'].upper()}{part}{(' — ' + ', '.join(names)) if names else ''}{(': ' + val) if val else ''}"))
    fw_pull = [b[1] for b in blocks if b[0] == "p" and b[1].startswith("PULL TEST") and "size-20" in b[1]]
    p.faults = [] if fw_pull and "20 ≥ 21" in fw_pull[0] else ["firewall size-20 pull test is not the contact table's 8 / 13 / 21 lbf"]
    p.columns(blocks, size=7.0, lead=8.6, top=p.y + 4)
    return p


def page_specs(reg, number, odd):
    """SPECIFICATIONS — options, readiness by section, connector and channel fill (LTSM specifications-page layout)."""
    p = Page(number, "Harness Standards", odd=odd)
    p.heading("Specifications")
    rd, cap, opts = reg["readiness"], reg["capacity"], reg["options"]
    p.txt(M, p.y + 6, "OPTIONS", 8.5, bold=True)
    rows = [(code, o["name"], o["status"].upper(), len(o["wires"])) for code, o in opts.items()]
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
    p.y = p.table(M, p.y + 18, [120, 46, 56, 56, 60, 60, 60, 58], hdr, rows, size=6.6, lead=9.2)
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
    """What it takes to build this plug, as part numbers, then its design state: DESIGN COMPLETE, or OPEN with the
    one fact still missing. Purchase state never prints here (owner 2026-09-28: the manual states done or not done)."""
    parts = kits_v5._y("parts.yaml")
    ep, out = reg["endpoints"].get(eid, {}), []
    for code, qty, _stamp, _where in kits_v5.kit_stamps(reg, ep):
        kind = KIND_WORD.get((parts.get(str(code)) or {}).get("kind"), "part")
        out.append(("PART", f"{kind} {code}{'' if qty == '×1' else ' ' + qty}", False))
    for code, kind, n, need, _stamp, _where in kits_v5.plug_parts(reg, eid):
        here = n * (typical or 1)
        count = f"×{here}" + (f" ({n} per plug)" if typical else "")
        out.append(("PART", f"{KIND_WORD.get(kind, kind)} {code} {count}", False))
    opens = [(st, words) for st, words in kits_v5.plug_opens(ep, reg["dossiers"].get(eid))
             if not re.search(r"\bcart\b|order|buy|price|\$", words, re.I)]
    if opens:
        for st, words in opens:
            out.append(("OPEN", words, True))
    else:
        out.append(("DESIGN COMPLETE", "every wire end, terminal and seal is named", False))
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


PRODUCT_IMAGES = Path("/Users/skylar/nuke/reference_documents/product_images")
SNAPSHOTS = PRODUCT_IMAGES.parent / "web_snapshots"
_PART_URLS = None


def part_urls():
    """part number -> the vendor's page for it: a fetched vendor page whose address carries the part number (the
    snapshot headers and the fetch list), else a URL in the part's own catalog sources, else the vendor photo's
    address (product_images/sources.json). Built once per run."""
    global _PART_URLS
    if _PART_URLS is not None:
        return _PART_URLS
    pages = []
    for f in sorted(SNAPSHOTS.glob("*.md")) if SNAPSHOTS.exists() else []:
        m = re.match(r"<!-- source: (\S+)", f.read_text(errors="ignore")[:400])
        if m:
            pages.append(m.group(1))
    try:
        import fetch_sources
        pages += [u for u in fetch_sources.URLS if u not in pages]
    except Exception:
        pass
    parts_y = yaml.safe_load((CD / "catalog" / "parts.yaml").read_text()) or {}
    photos = {}
    try:
        photos = json.load(open(PRODUCT_IMAGES / "sources.json"))
    except Exception:
        pass
    codes = set(parts_y) | set(photos) | {t_.get("pn") for t_ in (json.load(open(CD / "k5_registry.json")).get("tools") or []) if t_.get("pn")}
    out = {}
    for code in codes:
        if not code or len(str(code)) < 4:
            continue
        key = re.sub(r"[^a-z0-9]+", "-", str(code).lower()).strip("-")
        hit = next((u for u in pages if key and re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])",
                                                          re.sub(r"[^a-z0-9]+", "-", u.lower()))), None)
        if not hit:
            src = " ".join(map(str, (parts_y.get(code) or {}).get("sources") or []))
            m = re.search(r"https?://\S+", src)
            hit = m.group(0) if m else None
        if not hit and code in photos:
            hit = photos[code]
        if hit:
            out[str(code)] = hit
    _PART_URLS = out
    return out


def part_url(code):
    return part_urls().get(str(code)) if code else None


def link_parts(boxes):
    """Every text box that prints a part number with a vendor page gets that page as its link (the PDF link pass
    reads the boxes). A box that already links somewhere keeps its link."""
    urls = part_urls()
    if not urls:
        return boxes
    pat = re.compile(r"(?<![\w/-])(" + "|".join(sorted((re.escape(c) for c in urls), key=len, reverse=True)) + r")(?![\w/-])")
    out = []
    for b in boxes:
        if len(b) > 5 and not b[5]:
            m = pat.search(str(b[4]))
            if m:
                b = tuple(b[:5]) + (urls[m.group(1)],) + tuple(b[6:])
        out.append(b)
    return out


def kit_photo(reg, eid):
    """The plug kit's vendor product photo, if one is on file (reference_documents/product_images, gitignored; the
    source URL of each is in sources.json there)."""
    import base64
    for code in (reg["endpoints"].get(eid, {}).get("kit") or {}):
        f = PRODUCT_IMAGES / (str(code).replace("/", "-") + ".png")
        if f.exists():
            return code, "data:image/png;base64," + base64.b64encode(f.read_bytes()).decode()
    return None, None


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
    notes = [n_ for n_ in notes if not re.search(r"\bcart\b|order|buy|price", n_[1], re.I)]

    def draw(p, eid, title, typ, x, y, fig):
        ts = sorted(dev.get(eid, {}).values(), key=lambda t: str(t.get("cavity")))
        labels = [t.get("cavity") for t in ts]
        name = title.rsplit(" ", 1)[0] if typ else title
        code, uri = kit_photo(reg, eid)
        face_w = len(labels) * 26 + 16
        photo_w = 58 if uri else 0
        fx = x + (COLW - face_w - (photo_w + 10 if uri else 0)) / 2
        _, fh = connector_face(p, fx, y, labels,
                               f"{name} (typical)" if typ else title, round_=(eid == "OILP-ECU"),
                               colours=[wires.get(t_["wire"], {}).get("color") for t_ in ts],
                               href="https://nuke.ag/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring?tab=map&node=" + eid)
        if uri:
            px_ = fx + face_w + 10
            p.el.append(f'<image x="{px_:.1f}" y="{y + 2:.1f}" width="{photo_w}" height="{photo_w}" preserveAspectRatio="xMidYMid meet" href="{uri}"/>')
            p.txt(px_ + photo_w / 2, y + photo_w + 9, "plug kit, vendor photo", 5.2, anchor="middle", italic=True)
        rows = []
        for t in ts:
            w = wires.get(t["wire"], {})
            rows.append((str(t.get("cavity")), circuit_word(w) if w else t["wire"].upper(),   # the cavity as moulded (coil a-d)
                         gm_colour(f"{gauge(w)} {colour(w)}"), kits_v5.dave_name(w).upper(),
                         fw.get(t["wire"]) or "—", other_end(w, eid).upper()))
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
    idw = max(tw(r[0], 6.6) for r in rows) + 8                     # ids never break mid-word
    widths = [idw, 78, COLW - idw - 78]
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
    fwp = page_firewall(reg, wires, f"1-{len(pages) + 1}", odd=(len(pages) + 1) % 2 == 1)
    pages.append(fwp)
    toc.append(("Firewall Connector, Both Faces", pages[-1].number))
    pages += fwp.__dict__.pop("extra_pages", [])
    toc.append(("Firewall Connector, Cavity Table", pages[-1].number))
    first_pin = None
    for dev, conn, n_pins, ttl, mating, src in PINOUTS:
        pg = page_pinout(reg, wires, f"1-{len(pages) + 1}", (len(pages) + 1) % 2 == 1, dev, conn, n_pins, ttl, mating, src)
        pages.append(pg)
        pages += pg.__dict__.pop("extra_pages", [])
        first_pin = first_pin or pg.number
    toc.append(("Computer Pinouts, in Colour", first_pin))
    fams = yaml.safe_load((CD / "catalog" / "families.yaml").read_text())
    for maker, ttl in ((lambda n, o: page_legend(n, o), "Symbols and Conventions"),
                       (lambda n, o: page_wire_spec(reg, wires, n, o), "Wire Size and Specification"),
                       (lambda n, o: page_tools(reg, n, o), "Special Tools"),
                       (lambda n, o: page_procedures(reg, n, o, fams), "Crimping and Terminal Procedures")):
        pg = maker(f"1-{len(pages) + 1}", (len(pages) + 1) % 2 == 1)
        pages.append(pg)
        toc.append((ttl, pg.number))
        pages += pg.__dict__.pop("extra_pages", [])
    if not reg.get("readiness"):
        # the specifications page silently vanished when the registry was rebuilt without options_v5 (2026-09-28)
        sys.exit("manual: k5_registry.json has no options/readiness — run options_v5.py after reconcile_v5.py, then rebuild")
    if reg.get("readiness"):
        pg = page_specs(reg, f"1-{len(pages) + 1}", odd=(len(pages) + 1) % 2 == 1)
        pages.append(pg)
        toc.append(("Specifications", pg.number))
        pages += pg.__dict__.pop("extra_pages", [])
    loc = page_locations(reg, f"1-{len(pages) + 1}", odd=(len(pages) + 1) % 2 == 1)
    if loc:
        pages.append(loc)
        pages += loc.__dict__.pop("extra_pages", [])
        toc.append(("Component Location", loc.number))
    import diagram_v5
    sheets = [] if "--pages-only" in sys.argv else diagram_v5.build(first_number=len(pages) + 1)
    if sheets:
        toc.append(("Wiring Diagrams", sheets[0][0]))

    pages[0] = page_contents(reg, wires, toc, [e for e, _, _ in plugs], notes)
    bad = []
    for p in pages:
        text = " ".join(re.sub(r"<[^>]+>", " ", e) for e in p.el)
        bad += [f"{p.number}: {b}" for b in kits_v5.book_lint(text) if not b.startswith("unstamped")]
        bad += [f"{p.number}: overprint '{a}' over '{b}'" for a, b in diagram_v5.overlaps(p)]
        bad += [f"{p.number}: {b}" for b in layout_faults(p.boxes, W, H, M, footer=(REVISION,))]
        bad += [f"{p.number}: {b}" for b in fragment_faults(p.boxes)]
        bad += [f"{p.number}: {b}" for b in getattr(p, "faults", [])]
        if any(b[4] == "(continued)" for b in p.boxes):
            body = [b for b in p.boxes if b[1] > M + 16 and b[4] not in ("(continued)", REVISION)]
            if len({round(b[1]) for b in body}) < 8:
                bad.append(f"{p.number}: continuation page with {len({round(b[1]) for b in body})} lines: fit the content on its page")
    bad += designation_faults()
    if bad:
        raise SystemExit(f"manual breaks the book's rules ({len(bad)}):\n  " + "\n  ".join(bad[:60]))
    pdfs = []
    for p in pages:
        stem = OUT / f"K5_manual_{p.number}"
        stem.with_suffix(".svg").write_text(p.svg())
        subprocess.run(["rsvg-convert", "-d", "150", "-p", "150", "-o", str(stem.with_suffix(".png")), str(stem.with_suffix(".svg"))], check=True)
        subprocess.run(["rsvg-convert", "-f", "pdf", "-o", str(stem.with_suffix(".pdf")), str(stem.with_suffix(".svg"))], check=True)
        diagram_v5.add_links(stem.with_suffix(".pdf"), link_parts(p.boxes), H)
        pdfs.append(str(stem.with_suffix(".pdf")))
    pdfs += [s_[4] for s_ in sheets]
    # Section 2 — DC primary (batteries, isolator, distribution, grounds, protection, cable schedule): power_v5
    power = []
    if "--pages-only" not in sys.argv:
        import power_v5
        power = power_v5.build(first_number=len(pages) + len(sheets) + 1)
        pdfs += [p_[3] for p_ in power]
        toc.append(("DC Primary and Grounds", power[0][0]))
    subprocess.run(["pdfunite", *pdfs, str(OUT / "K5_Harness_Manual.pdf")], check=True)
    # outputs this run did not write are stale pages of an earlier numbering (review 2026-09-28: K5_power_45..50
    # PNGs beside the book, in no PDF): delete them, then fail if any file beside the book is not a page of it
    if "--pages-only" not in sys.argv:
        keep = {Path(x).with_suffix(e).name for x in pdfs for e in (".pdf", ".svg", ".png")} | {"K5_Harness_Manual.pdf"}
        stale = [f for f in OUT.glob("K5_*") if f.is_file() and f.name not in keep]
        for f in stale:
            f.unlink()
        left = [f.name for f in OUT.glob("K5_*") if f.is_file() and f.name not in keep]
        if left:
            raise SystemExit(f"outputs beside the book that are not in it: {left[:10]}")
        print(f"stale outputs removed: {len(stale)}" + (f" ({', '.join(sorted(f.name for f in stale)[:8])}…)" if stale else ""))
    print(f"manual: {len(pages)} pages + {len(sheets)} diagram sheets + {len(power)} DC primary pages -> {OUT}")


if __name__ == "__main__":
    build()
