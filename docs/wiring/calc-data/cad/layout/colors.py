#!/usr/bin/env python3
"""Dominant product colors from the part photos (part_media.yaml): per host one request every 10.5 s, cached.
Background (near white / transparent) is dropped; the two largest remaining color clusters are reported."""
import io, json, os, subprocess, time
from urllib.parse import urlparse
from PIL import Image

D = os.path.dirname(os.path.abspath(__file__))
C = os.path.join(D, "colcache"); os.makedirs(C, exist_ok=True)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
SKIP = ("odysseybattery.com", "te.com")
photos = json.load(open(os.path.join(D, "fp_photos.json")))
last = {}
out = {}


def kmeans(px, k=3, it=12):
    import random
    random.seed(1)
    cs = random.sample(px, k)
    for _ in range(it):
        groups = [[] for _ in cs]
        for p in px:
            j = min(range(len(cs)), key=lambda i: sum((a - b) ** 2 for a, b in zip(p, cs[i])))
            groups[j].append(p)
        cs = [tuple(sum(c) / len(g) for c in zip(*g)) if g else cs[i] for i, g in enumerate(groups)]
    res = sorted(((len(g), cs[i]) for i, g in enumerate(groups)), reverse=True)
    return res


for code, r in photos.items():
    u = r.get("url")
    hh = urlparse(u).netloc.lower() if u else ""
    if not u or any(hh == s or hh.endswith("." + s) for s in SKIP):
        continue
    h = urlparse(u).netloc
    fn = os.path.join(C, code + ".img")
    if not os.path.exists(fn):
        wait = last.get(h, 0) + 10.5 - time.time()
        if wait > 0:
            time.sleep(wait)
        subprocess.run(["curl", "-s", "-L", "--max-time", "40", "-A", UA, "-H", "Accept: image/jpeg,image/png,image/webp,image/*", "-o", fn, u])
        last[h] = time.time()
    try:
        im = Image.open(fn)
        im = im.convert("RGBA")
    except Exception as e:
        out[code] = {"error": str(e)}
        continue
    im.thumbnail((80, 80))
    px = []
    for (r_, g, b, a) in im.getdata():
        if a < 200:
            continue
        if r_ > 232 and g > 232 and b > 232:
            continue
        px.append((r_, g, b))
    if len(px) < 30:
        out[code] = {"error": "no foreground"}
        continue
    res = kmeans(px, 3)
    tot = sum(n for n, _ in res)
    out[code] = {"clusters": [{"hex": "#%02x%02x%02x" % tuple(int(round(c)) for c in col), "share": round(n / tot, 2)} for n, col in res],
                 "photo": u}
    print(code, [(c["hex"], c["share"]) for c in out[code]["clusters"]])
json.dump(out, open(os.path.join(D, "colors.json"), "w"), indent=1)
