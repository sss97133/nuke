#!/usr/bin/env python3
"""Isometric grid paper generator for harness sketching.

Output: SVG (print via browser / Preview). Iso grid = vertical lines + 30°/150° lines.
Margins are real-print safe (0.25" all sides). Colors are light enough to draw over in pen.

Usage:
    python iso_grid.py                       # generate the standard set
    python iso_grid.py --size letter --orient portrait --spacing 0.25
"""
import argparse
import math
from pathlib import Path

PAGES = {
    "letter": (8.5, 11.0),
    "tabloid": (11.0, 17.0),
    "a4":     (8.27, 11.69),
    "a3":     (11.69, 16.54),
}

DPI = 96  # SVG user units = px @ 96 DPI for browser print

def page_size(name: str, orient: str):
    w, h = PAGES[name]
    if orient == "landscape":
        w, h = h, w
    return w, h

def emit(out: Path, page: str, orient: str, spacing_in: float,
         major_every: int = 5, margin_in: float = 0.25,
         minor_color: str = "#cfd6e0", major_color: str = "#7a8696",
         minor_w: float = 0.4, major_w: float = 0.7):
    """Write an SVG iso grid. spacing_in = horizontal step between vertical lines."""
    Wpx, Hpx = (v * DPI for v in page_size(page, orient))
    m = margin_in * DPI
    s = spacing_in * DPI                # horizontal step (vertical line gap)
    # iso lines run at ±30° from horizontal. vertical spacing between iso intercepts
    # on the verticals = s * tan(30°). Equivalently, along the slope, step = s / cos(30°).
    tan30 = math.tan(math.radians(30))
    # vertical grid step for iso intersections on a vertical line:
    v_step = s * tan30
    # clip rect
    x0, y0, x1, y1 = m, m, Wpx - m, Hpx - m

    lines = []
    def line(x1_, y1_, x2_, y2_, w, c):
        lines.append(
            f'<line x1="{x1_:.2f}" y1="{y1_:.2f}" x2="{x2_:.2f}" y2="{y2_:.2f}" '
            f'stroke="{c}" stroke-width="{w}" stroke-linecap="butt"/>'
        )

    # --- vertical lines ---
    n = 0
    x = x0
    while x <= x1 + 0.01:
        major = (n % major_every == 0)
        line(x, y0, x, y1, major_w if major else minor_w,
             major_color if major else minor_color)
        x += s; n += 1

    # --- 30° lines (slope +tan30, going up-right). Parameterize by y-intercept at x=x0.
    # iso intercepts on the left edge are every v_step. extend offsets so the whole page is covered.
    # line: y = y_b + tan30 * (x - x0); but for visual symmetry with verticals,
    # we anchor "major" lines at every major_every-th intersection.
    def iso_lines(slope: float):
        # we draw lines anchored at evenly spaced points along the left edge AND bottom edge
        # to fill the page. Equivalent: iterate y-intercepts at x=x0 from
        # (y0 - slope*(x1 - x0)) up to (y1).
        intercept_lo = y0 - abs(slope) * (x1 - x0)
        intercept_hi = y1 + abs(slope) * (x1 - x0)
        # snap intercept_lo to a multiple of v_step measured from y0
        k_lo = math.floor((intercept_lo - y0) / v_step)
        k_hi = math.ceil((intercept_hi - y0) / v_step)
        for k in range(k_lo, k_hi + 1):
            yb = y0 + k * v_step
            # endpoints clipped to bbox
            # line: y = yb + slope*(x - x0)
            # solve for x at y=y0 and y=y1
            pts = []
            # intersect left edge
            yl = yb
            if y0 - 1e-6 <= yl <= y1 + 1e-6:
                pts.append((x0, yl))
            # intersect right edge
            yr = yb + slope * (x1 - x0)
            if y0 - 1e-6 <= yr <= y1 + 1e-6:
                pts.append((x1, yr))
            # intersect top edge (y=y0): x = x0 + (y0 - yb)/slope
            if slope != 0:
                xt = x0 + (y0 - yb) / slope
                if x0 - 1e-6 <= xt <= x1 + 1e-6:
                    pts.append((xt, y0))
                xb = x0 + (y1 - yb) / slope
                if x0 - 1e-6 <= xb <= x1 + 1e-6:
                    pts.append((xb, y1))
            if len(pts) >= 2:
                # pick the two extreme points by x
                pts.sort()
                (xa, ya), (xz, yz) = pts[0], pts[-1]
                major = (k % major_every == 0)
                line(xa, ya, xz, yz, major_w if major else minor_w,
                     major_color if major else minor_color)

    iso_lines(+tan30)  # 30° lines (rises to the right in screen coords -> y increases? we use +tan30 here for visual /, since SVG y is down. Both directions get drawn either way.)
    iso_lines(-tan30)  # -30° lines (the other diagonal)

    # --- page border (very light) ---
    border = (f'<rect x="{x0:.2f}" y="{y0:.2f}" '
              f'width="{(x1-x0):.2f}" height="{(y1-y0):.2f}" '
              f'fill="none" stroke="#e3e7ec" stroke-width="0.5"/>')

    # --- footer label ---
    label = (f'Iso grid · {page} {orient} · {spacing_in}" spacing · '
             f'major every {major_every} · print at 100% / actual size')
    footer = (f'<text x="{x0:.2f}" y="{(Hpx - margin_in*DPI/2):.2f}" '
              f'font-family="ui-monospace, Menlo, monospace" font-size="8" '
              f'fill="#9aa3ad">{label}</text>')

    svg = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{Wpx:.2f}" height="{Hpx:.2f}" '
        f'viewBox="0 0 {Wpx:.2f} {Hpx:.2f}">\n'
        f'  <rect width="100%" height="100%" fill="white"/>\n'
        f'  {border}\n'
        f'  {"".join(lines)}\n'
        f'  {footer}\n'
        f'</svg>\n'
    )
    out.write_text(svg)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent))
    ap.add_argument("--size", choices=list(PAGES), default=None)
    ap.add_argument("--orient", choices=["portrait", "landscape"], default=None)
    ap.add_argument("--spacing", type=float, default=None, help="inches between verticals")
    ap.add_argument("--major-every", type=int, default=5)
    args = ap.parse_args()

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.size or args.orient or args.spacing:
        size = args.size or "letter"
        orient = args.orient or "portrait"
        sp = args.spacing or 0.25
        name = f"iso_{size}_{orient}_{sp:g}in.svg"
        path = emit(outdir / name, size, orient, sp, major_every=args.major_every)
        print(path)
        return

    # default set: the common combos for harness sketching
    sets = [
        ("letter",  "portrait",  0.25, 5),
        ("letter",  "portrait",  0.20, 5),
        ("letter",  "landscape", 0.25, 5),
        ("tabloid", "landscape", 0.25, 5),
        ("tabloid", "landscape", 0.50, 4),  # coarse — for whole-harness layout
    ]
    for size, orient, sp, maj in sets:
        name = f"iso_{size}_{orient}_{sp:g}in.svg"
        path = emit(outdir / name, size, orient, sp, major_every=maj)
        print(path)

if __name__ == "__main__":
    main()
