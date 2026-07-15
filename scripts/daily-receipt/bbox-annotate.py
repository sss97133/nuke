#!/usr/bin/env python3
"""bbox-annotate.py — render a draft verdict's TWVP bboxes back onto downscaled
copies of the frames, for the teacher pass of the v1→annotate→teacher→v2 loop
(docs/library/technical/engineering-manual/18-deep-image-analysis.md).

The model draws its own boxes, then Reads the overlays and grades every rectangle:
does the label match what's inside? The overlay is a DIFFERENT input modality than
the raw frame — that's what surfaces the coordinate-mapping errors the first pass
can't see in its own numbers (y-normalized-by-width, raw-pixel coords, axis shifts).

Local-only: no network. Safe inside the claude --print Bash sandbox.

Usage:
  python3 scripts/daily-receipt/bbox-annotate.py \
    --worklist /tmp/dia/<run>/work.jsonl \
    --verdicts /tmp/dia/<run>/verdicts_v1.jsonl \
    --imgdir   /tmp/dia/<run>/img \
    --outdir   /tmp/dia/<run>/overlay

Box colors: green=components_seen (C#), blue=text_regions (T#), red=damage_localized (D#).
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageOps

LONG_SIDE = 1024
# A box this small (TWVP units) is ungradeable on the downscaled overlay — small text
# misses survived the teacher pass at 1024px (observed on the 2024-10-03 acceptance run).
# Small boxes additionally get a full-res ZOOM inset (box drawn inside 2.5× context)
# named <id8>_<TAG>_zoom.jpg so the teacher can actually see whether the box hits.
SMALL_TWVP = 90
ARRAYS = [  # (verdict key, index prefix, RGB)
    ("components_seen", "C", (0, 200, 0)),
    ("text_regions", "T", (40, 90, 255)),
    ("damage_localized", "D", (230, 30, 30)),
]


def valid_box(b):
    return (
        isinstance(b, list) and len(b) == 4
        and all(isinstance(n, (int, float)) and 0 <= n <= 999 for n in b)
        and b[0] < b[2] and b[1] < b[3]
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worklist", required=True)
    ap.add_argument("--verdicts", required=True)
    ap.add_argument("--imgdir", required=True)
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()

    file_by_id = {}
    with open(args.worklist) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            file_by_id[r["image_id"]] = r["file_name"]

    os.makedirs(args.outdir, exist_ok=True)
    done = bad = 0
    with open(args.verdicts) as f:
        for line in f:
            if not line.strip():
                continue
            try:
                v = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"SKIP unparseable verdict line: {e}")
                bad += 1
                continue
            iid = str(v.get("image_id", ""))
            fname = file_by_id.get(iid)
            if not fname:
                print(f"SKIP {iid[:8]}: image_id not in worklist")
                bad += 1
                continue
            src = os.path.join(args.imgdir, fname)
            if not os.path.exists(src):
                print(f"SKIP {iid[:8]}: missing local file {fname}")
                bad += 1
                continue
            try:
                # RAW stored orientation, NO exif_transpose: the Read tool does NOT apply
                # EXIF rotation (observed live on orientation=6 frame 6f02dcfb, 2026-07-11),
                # and TWVP coords are defined over the frame AS SHOWN by Read. Transposing
                # here would draw the overlay in a different frame than the coordinates.
                im = Image.open(src).convert("RGB")
            except Exception as e:
                print(f"SKIP {iid[:8]}: cannot open ({e})")
                bad += 1
                continue
            full = im  # full-res, for zoom insets
            fw, fh = full.size
            w, h = fw, fh
            scale = LONG_SIDE / max(w, h)
            if scale < 1:
                im = full.resize((round(w * scale), round(h * scale)))
            w, h = im.size
            draw = ImageDraw.Draw(im)
            counts = {}
            zooms = 0
            for key, prefix, color in ARRAYS:
                for i, el in enumerate(v.get(key) or [], start=1):
                    tag = f"{prefix}{i}"
                    b = el.get("bbox") if isinstance(el, dict) else None
                    if not valid_box(b):
                        print(f"  {iid[:8]} {tag}: INVALID bbox {b} — not drawn (treat as wrong)")
                        continue
                    x1, y1 = b[0] / 999 * w, b[1] / 999 * h
                    x2, y2 = b[2] / 999 * w, b[3] / 999 * h
                    draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
                    label = str(el.get("label") or el.get("text") or "")[:28]
                    ty = y1 - 14 if y1 >= 14 else y2 + 2
                    draw.text((x1 + 2, ty), f"{tag} {label}", fill=color)
                    counts[prefix] = counts.get(prefix, 0) + 1
                    if (b[2] - b[0]) < SMALL_TWVP or (b[3] - b[1]) < SMALL_TWVP:
                        # zoom inset: the box drawn inside 2.5× context, cropped full-res
                        bx1, by1 = b[0] / 999 * fw, b[1] / 999 * fh
                        bx2, by2 = b[2] / 999 * fw, b[3] / 999 * fh
                        cx, cy = (bx1 + bx2) / 2, (by1 + by2) / 2
                        hw = max(bx2 - bx1, 40) * 1.25
                        hh = max(by2 - by1, 40) * 1.25
                        zx1, zy1 = max(0, cx - hw), max(0, cy - hh)
                        zx2, zy2 = min(fw, cx + hw), min(fh, cy + hh)
                        zoom = full.crop((round(zx1), round(zy1), round(zx2), round(zy2)))
                        zd = ImageDraw.Draw(zoom)
                        zd.rectangle([bx1 - zx1, by1 - zy1, bx2 - zx1, by2 - zy1], outline=color, width=3)
                        if max(zoom.size) < 500:
                            s = 500 / max(zoom.size)
                            zoom = zoom.resize((round(zoom.size[0] * s), round(zoom.size[1] * s)))
                        zpath = os.path.join(args.outdir, f"{iid[:8]}_{tag}_zoom.jpg")
                        zoom.save(zpath, quality=85)
                        zooms += 1
            out = os.path.join(args.outdir, f"{iid[:8]}.jpg")
            im.save(out, quality=82)
            done += 1
            summary = " ".join(f"{p}:{n}" for p, n in counts.items()) or "no boxes"
            zn = f", {zooms} zoom insets" if zooms else ""
            print(f"ANNOTATED {iid[:8]} → {out} ({summary}{zn})")
    print(f"annotate: {done} overlays written, {bad} skipped")
    sys.exit(0 if done or not bad else 1)


if __name__ == "__main__":
    main()
