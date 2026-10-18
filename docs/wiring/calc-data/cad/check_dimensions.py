#!/usr/bin/env python3
"""Check dimensions.yaml: every entry well formed, every conversion right, every printed value on its page.

What it checks
  1. shape      each entry has id, what, value_mm, original {value, unit}, points, src, pdf_page, years,
                applies_to_1977, confidence; ids are unique; confidence is high | medium | low
  2. units      value_mm equals original converted (1 in = 25.4 mm exactly), within 0.05 mm
  3. on page    for a source with a text layer (the GM manuals), the printed value is on the cited PDF page
                (docs/library/_extracted/<slug>/page-NNNN.txt); when the entry names a table row, the value is on
                that row's line. Scans with no text layer (Mitchell, KLM, GM TX000469) are marked BY-EYE: read the
                figure named in the entry.
  4. closure    the Mitchell 1988 frame figure gives each point three ways (width, length, height); rebuild the
                points in 3D and compare with the printed point-to-point and diagonal values. Same for the
                engine-compartment, windshield and tailgate quadrilaterals. The residual is the source's own
                margin of error.
  5. cross      the same feature in two sources (Mitchell vs KLM vs GM) -- the difference is the between-source margin.

Usage: python3 check_dimensions.py [--points]      (--points prints the rebuilt Mitchell frame points)
Exit status 1 if any shape, unit or on-page check fails.
"""
import math
import re
import sys
from collections import Counter
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
# The extracted page text is gitignored; in a worktree fall back to the main checkout.
EXTRACTED_CANDIDATES = [REPO / "docs/library/_extracted", Path.home() / "nuke/docs/library/_extracted"]
EXTRACTED = next((p for p in EXTRACTED_CANDIDATES if p.exists()), None)

REQUIRED = ["id", "what", "value_mm", "original", "points", "src", "pdf_page", "years", "applies_to_1977",
            "confidence"]


def inches(text):
    """'13-3/8' -> 13.375, '69-5/8' -> 69.625, '46' -> 46.0, 27.75 -> 27.75."""
    if isinstance(text, (int, float)):
        return float(text)
    s = str(text).strip()
    m = re.fullmatch(r"(\d+)(?:[- ](\d+)/(\d+))?", s)
    if m:
        whole = float(m.group(1))
        return whole + (float(m.group(2)) / float(m.group(3)) if m.group(2) else 0.0)
    m = re.fullmatch(r"(\d+)/(\d+)", s)
    if m:
        return float(m.group(1)) / float(m.group(2))
    return float(s)


def to_mm(orig):
    unit = orig["unit"]
    if unit == "mm":
        return float(orig["value"])
    if unit == "in":
        return inches(orig["value"]) * 25.4
    raise ValueError(f"unknown unit {unit}")


def value_pattern(orig):
    """Regex tolerant of OCR spacing: '13-3/8' matches '13-3/8', '13 3/8', '1 3 -3 /8'."""
    s = str(orig.get("printed", orig["value"]))
    parts = []
    for ch in s:
        if ch.isdigit():
            parts.append(ch + r"\s*")
        elif ch in "-":
            parts.append(r"[-\s]?\s*")
        elif ch == "/":
            parts.append(r"[/,]\s*")
        elif ch == ".":
            parts.append(r"\.\s*")
        elif ch == " ":
            parts.append(r"[-\s]?\s*")
        else:
            parts.append(re.escape(ch))
    return r"(?<![\d/])" + "".join(parts).rstrip("\\s*") + r"(?![\d/])"


def page_text(slug, pdf_page):
    if EXTRACTED is None:
        return None
    f = EXTRACTED / slug / f"page-{int(pdf_page):04d}.txt"
    return f.read_text(errors="replace") if f.exists() else None


def on_page(entry, sources):
    src = sources[entry["src"]]
    if not src.get("text_layer"):
        return "BY-EYE", src.get("figure_note", "scan, no text layer")
    slug = src["library_slug"]
    pages = [entry["pdf_page"]] + [p["pdf_page"] for p in entry.get("also_in", []) if p.get("src") == entry["src"]]
    text = page_text(slug, entry["pdf_page"])
    if text is None:
        return "NO-TEXT", f"{slug} page {entry['pdf_page']} not extracted here"
    pat = value_pattern(entry["original"])
    row = entry.get("row")
    if row:
        rowpat = re.compile(r"\s*".join(re.escape(c) for c in row.replace(" ", "")))
        lines = [ln for ln in text.splitlines() if rowpat.search(ln.replace(" ", ""))
                 or rowpat.search(ln)]
        if not lines:
            return "FAIL", f"row {row!r} not on page {entry['pdf_page']}"
        if any(re.search(pat, ln) for ln in lines):
            return "OK", f"on row {row} p{entry['pdf_page']}"
        return "FAIL", f"{entry['original']['value']} not on row {row} p{entry['pdf_page']}"
    if re.search(pat, text):
        return "OK", f"p{entry['pdf_page']}"
    return "FAIL", f"{entry['original']['value']} not on p{entry['pdf_page']}"


def also_in_checks(entry, sources):
    """Other manuals that print the same row value (e.g. the 1975-81 KA105 frame row)."""
    out = []
    for a in entry.get("also_in", []):
        src = sources[a["src"]]
        text = page_text(src["library_slug"], a["pdf_page"])
        if text is None:
            out.append((a["src"], "NO-TEXT"))
            continue
        pat = value_pattern(entry["original"])
        row = entry.get("row")
        lines = text.splitlines()
        if row:
            rp = re.compile(r"\s*".join(re.escape(c) for c in row.replace(" ", "")))
            lines = [ln for ln in lines if rp.search(ln)]
        out.append((a["src"], "OK" if any(re.search(pat, ln) for ln in lines) else "FAIL"))
    return out


def fr88_frame(d):
    """Rebuild the Mitchell 1988 frame points (x = from centreline, +driver; y = from G along the datum, +rear;
    z = above the datum line). Returns {point: (x, y, z)} for driver (no suffix) and passenger ('p') sides."""
    v = lambda k: d[k]["value_mm"]
    half = {"A": v("fr88.frame.width.A-A") / 2, "B": v("fr88.frame.width.B-B") / 2,
            "E": v("fr88.frame.width.E-E") / 2, "F": v("fr88.frame.width.F-F") / 2,
            "G": v("fr88.frame.width.G-G") / 2, "H": v("fr88.frame.width.H-H") / 2,
            "I": v("fr88.frame.width.I-I") / 2, "J": v("fr88.frame.width.J-J") / 2,
            "K": v("fr88.frame.width.K-K") / 2, "M": v("fr88.frame.width.M-M") / 2,
            "N": v("fr88.frame.width.N-N") / 2}
    y = {"A": -v("fr88.frame.len.A-G"), "B": -v("fr88.frame.len.B-G"), "C": -v("fr88.frame.len.C-G"),
         "D": -v("fr88.frame.len.D-G"), "E": -v("fr88.frame.len.E-G"), "F": -v("fr88.frame.len.F-G"),
         "G": 0.0, "H": v("fr88.frame.len.G-H"), "I": v("fr88.frame.len.G-I"), "J": v("fr88.frame.len.G-J")}
    for p in "KLMN":
        key = {"K": "fr88.frame.len.J-K", "L": "fr88.frame.len.J-L", "M": "fr88.frame.len.J-M",
               "N": "fr88.frame.len.J-N"}[p]
        y[p] = y["J"] + v(key)
    z = {p: v(f"fr88.frame.height.{p}") for p in "ABCDEFGHIJKLM"}
    z["N"] = v("fr88.frame.height.N-bolt")
    pts = {}
    for p in half:
        pts[p] = (half[p], y[p], z[p])
        pts[p + "p"] = (-half[p], y[p], z[p])
    pts["C"] = (v("fr88.frame.cl.C"), y["C"], z["C"])          # C is driver-side only
    pts["Dp"] = (-v("fr88.frame.cl.D"), y["D"], z["D"])        # D is passenger-side only
    pts["L"] = (v("fr88.frame.cl.L"), y["L"], z["L"])          # L driver, L' passenger
    pts["Lp"] = (-v("fr88.frame.cl.Lprime"), y["L"], z["L"])
    return pts


def dist(a, b):
    return math.dist(a, b)


def closures(d):
    rows = []
    if all(k in d for k in ["fr88.frame.width.A-A", "fr88.frame.len.J-N", "fr88.frame.height.N-bolt"]):
        P = fr88_frame(d)
        for key, a, b in [("fr88.frame.p2p.A-G.driver", "A", "G"), ("fr88.frame.p2p.A-G.passenger", "Ap", "Gp"),
                          ("fr88.frame.p2p.G-J.driver", "G", "J"), ("fr88.frame.p2p.G-J.passenger", "Gp", "Jp"),
                          ("fr88.frame.p2p.J-N.driver", "J", "N"), ("fr88.frame.p2p.J-N.passenger", "Jp", "Np"),
                          ("fr88.frame.diag.A-G", "A", "Gp"), ("fr88.frame.diag.G-J", "G", "Jp"),
                          ("fr88.frame.diag.J-N", "J", "Np")]:
            if key in d:
                calc = dist(P[a], P[b])
                rows.append((key, d[key]["value_mm"], calc, calc - d[key]["value_mm"]))
    def quad(prefix, front, rear, side, diag):
        if all(prefix + k in d for k in (front, rear, side, diag)):
            wf, wr, s = d[prefix + front]["value_mm"], d[prefix + rear]["value_mm"], d[prefix + side]["value_mm"]
            h = math.sqrt(s ** 2 - ((wr - wf) / 2) ** 2)
            calc = math.sqrt(h ** 2 + ((wr + wf) / 2) ** 2)
            rows.append((prefix + diag, d[prefix + diag]["value_mm"], calc, calc - d[prefix + diag]["value_mm"]))
    quad("fr88.body.engcomp.", "front-width", "rear-width", "side.driver", "diag")
    quad("fr88.body.windshield.", "top-A-B", "bottom-D-C", "side-A-D", "diag-A-C")
    quad("fr88.body.tailgate.", "top-A-B", "bottom-D-C", "side-A-D", "diag-A-C")
    # KLM body-mount block: fore-aft length and two widths predict the diagonals
    k = "klm84.frame.bodymount."
    if all(k + s in d for s in ("A-B.driver", "A.width", "B.width", "diag-1", "diag-2")):
        L, wa, wb = d[k + "A-B.driver"]["value_mm"], d[k + "A.width"]["value_mm"], d[k + "B.width"]["value_mm"]
        calc = math.sqrt(L ** 2 + ((wa + wb) / 2) ** 2)
        for s in ("diag-1", "diag-2"):
            rows.append((k + s, d[k + s]["value_mm"], calc, calc - d[k + s]["value_mm"]))
    return rows


def cross(d):
    """(a, factor_a, b, factor_b): a half-width counts twice against a full width."""
    pairs = [("klm84.body.underhood.front-width", 1, "fr88.body.engcomp.front-width", 1),
             ("klm84.body.underhood.rear-width", 1, "fr88.body.engcomp.rear-width", 1),
             ("klm84.body.underhood.diag", 1, "fr88.body.engcomp.diag", 1),
             ("gm87.frame.width.points-1-2", 1, "fr88.frame.width.A-A", 1),
             ("gm77.frame.KA105.V", 2, "gm87.frame.width.points-1-2", 1),
             ("gm77.frame.KA105.V", 2, "fr88.frame.width.A-A", 1),
             ("gm77.frame.KA105.T", 2, "gm87.frame.width.points-11-12", 1),
             ("gm77.frame.KA105.T", 2, "fr88.frame.width.K-K", 1),
             ("gm73.frame.KA105.P", 1, "gm77.frame.KA105.V", 1),
             ("gm73.frame.KA105.S", 1, "gm77.frame.KA105.T", 1)]
    out = []
    for a, fa, b, fb in pairs:
        if a in d and b in d:
            va, vb = d[a]["value_mm"] * fa, d[b]["value_mm"] * fb
            out.append((a + (f" x{fa}" if fa != 1 else ""), b + (f" x{fb}" if fb != 1 else ""), va, vb, va - vb))
    # KLM rear spring hangers vs Mitchell I to M fore-aft (G-J + J-M - G-I)
    if all(k in d for k in ("klm84.frame.rear-spring-hangers", "fr88.frame.len.G-I", "fr88.frame.len.G-J",
                            "fr88.frame.len.J-M")):
        im = d["fr88.frame.len.G-J"]["value_mm"] + d["fr88.frame.len.J-M"]["value_mm"] - d["fr88.frame.len.G-I"]["value_mm"]
        va = d["klm84.frame.rear-spring-hangers"]["value_mm"]
        out.append(("klm84.frame.rear-spring-hangers", "fr88 I-M fore-aft (G-J + J-M - G-I)", va, im, va - im))
    return out


def main():
    data = yaml.safe_load((HERE / "dimensions.yaml").read_text())
    sources = data["sources"]
    dims = data["dimensions"]
    fails = 0
    ids = Counter(e.get("id") for e in dims)
    for i, n in ids.items():
        if n > 1:
            print(f"SHAPE FAIL duplicate id {i}")
            fails += 1
    status = Counter()
    for e in dims:
        miss = [k for k in REQUIRED if k not in e]
        if miss:
            print(f"SHAPE FAIL {e.get('id')}: missing {miss}")
            fails += 1
            continue
        if e["src"] not in sources:
            print(f"SHAPE FAIL {e['id']}: unknown src {e['src']}")
            fails += 1
            continue
        if e["confidence"] not in ("high", "medium", "low"):
            print(f"SHAPE FAIL {e['id']}: confidence {e['confidence']}")
            fails += 1
        mm = to_mm(e["original"])
        if abs(mm - float(e["value_mm"])) > 0.05:
            print(f"UNIT FAIL {e['id']}: {e['original']} = {mm:.2f} mm, file says {e['value_mm']}")
            fails += 1
        st, why = on_page(e, sources)
        status[st] += 1
        if st == "FAIL":
            print(f"PAGE FAIL {e['id']}: {why}")
            fails += 1
        for src, st2 in also_in_checks(e, sources):
            status["also_in " + st2] += 1
            if st2 == "FAIL":
                print(f"PAGE FAIL {e['id']} also_in {src}")
                fails += 1
    # tolerances and routing rules: the quoted sentence's first number must be on the cited page
    for block in ("tolerances", "rules"):
        for t in data.get(block, []):
            src = sources.get(t.get("src"), {})
            if not src.get("text_layer"):
                continue
            text = page_text(src["library_slug"], t["pdf_page"])
            num = re.search(r"\d+(?:/\d+)?(?:\.\d+)?", t["text"]).group(0)
            if text is None or not re.search(r"\s*".join(re.escape(c) for c in num), text):
                print(f"PAGE FAIL {block} {t['id']}: {num} not on p{t['pdf_page']}")
                fails += 1
    d = {e["id"]: e for e in dims}
    print(f"\n{len(dims)} dimensions; sources: {dict(Counter(e['src'] for e in dims))}")
    print(f"{len(data.get('tolerances', []))} tolerances, {len(data.get('rules', []))} routing rules")
    print(f"confidence: {dict(Counter(e['confidence'] for e in dims))}; "
          f"applies_to_1977: {dict(Counter(str(e['applies_to_1977']) for e in dims))}")
    print(f"on-page: {dict(status)}  (BY-EYE = scanned figure, read by eye; OK = value found on the cited page text)")
    rows = closures(d)
    if rows:
        print("\nclosure (source checked against itself; residual = calc - printed, mm)")
        for key, printed, calc, res in rows:
            print(f"  {key:34s} printed {printed:8.1f}  rebuilt {calc:8.1f}  residual {res:+6.1f}")
    xs = cross(d)
    if xs:
        print("\ncross-source (same feature, two sources; a - b, mm)")
        for a, b, va, vb, diff in xs:
            print(f"  {a} {va:.1f}  vs  {b} {vb:.1f}  -> {diff:+.1f}")
    if "--points" in sys.argv and "fr88.frame.width.A-A" in d:
        print("\nMitchell 1988 frame points rebuilt (mm; x from centreline +driver, y from G +rear, z above datum)")
        for p, (x, y, z) in fr88_frame(d).items():
            print(f"  {p:3s} x {x:+7.1f}  y {y:+7.1f}  z {z:6.1f}")
    print(f"\n{'FAIL' if fails else 'PASS'}: {fails} failing checks")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
