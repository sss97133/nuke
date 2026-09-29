#!/usr/bin/env python3
"""Turn the fetched part_media photos into page files: site/ph/<hash>.jpg (fits 560 px, on white), a 72 px thumbnail
as a data URI, and the photo's dominant product colour (k-means of the non-background pixels, the colours.py method).
Writes photos/processed.json {url: {src, thumb, w, h, colors: [{hex, share}]}}."""
import base64, io, json, os, random
from PIL import Image

D = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(D, "photos", "raw")
OUT = os.path.join(D, "site", "ph"); os.makedirs(OUT, exist_ok=True)
man = json.load(open(os.path.join(D, "photos", "manifest.json")))


def flat(im):
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    return bg.convert("RGB"), im


def kmeans(px, k=3, it=12):
    random.seed(1)
    cs = random.sample(px, k)
    for _ in range(it):
        groups = [[] for _ in cs]
        for p in px:
            j = min(range(len(cs)), key=lambda i: sum((a - b) ** 2 for a, b in zip(p, cs[i])))
            groups[j].append(p)
        cs = [tuple(sum(c) / len(g) for c in zip(*g)) if g else cs[i] for i, g in enumerate(groups)]
    return sorted(((len(g), cs[i]) for i, g in enumerate(groups)), reverse=True)


out = {}
for url, r in man.items():
    fn = r.get("file")
    if not fn:
        continue
    try:
        im0 = Image.open(os.path.join(RAW, fn))
        im0.load()
    except Exception as e:
        out[url] = {"error": str(e)}
        continue
    rgb, rgba = flat(im0)
    h = fn.split(".")[0]
    big = rgb.copy(); big.thumbnail((560, 560), Image.LANCZOS)
    big.save(os.path.join(OUT, h + ".jpg"), quality=84, optimize=True, progressive=True)
    th = rgb.copy(); th.thumbnail((72, 72), Image.LANCZOS)
    b = io.BytesIO(); th.save(b, "JPEG", quality=78, optimize=True)
    small = rgba.copy(); small.thumbnail((90, 90))
    px = [(r_, g, b_) for (r_, g, b_, a) in small.getdata() if a >= 200 and not (r_ > 232 and g > 232 and b_ > 232)]
    cols = []
    if len(px) >= 30:
        res = kmeans(px, 3)
        tot = sum(n for n, _ in res)
        cols = [{"hex": "#%02x%02x%02x" % tuple(int(round(c)) for c in col), "share": round(n / tot, 2)} for n, col in res]
    out[url] = {"src": "ph/" + h + ".jpg", "thumb": "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode(),
                "w": big.size[0], "h": big.size[1], "colors": cols}
json.dump(out, open(os.path.join(D, "photos", "processed.json"), "w"), indent=0)
print(len(out), "photos processed;", sum(len(v.get("thumb", "")) for v in out.values()) // 1024, "KB of thumbnails")
