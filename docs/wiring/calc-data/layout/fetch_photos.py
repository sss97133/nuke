#!/usr/bin/env python3
"""Fetch every device photo named in part_media.yaml (one request every 10.5 s per host, hosts in parallel),
reusing the colours pass's cache (../loc/colcache) where the URL is the same. Writes photos/raw/<sha1>.<ext> and
photos/manifest.json {url: {file, status, bytes, content_type}}. Re-running skips what is already fetched."""
import hashlib, json, os, subprocess, threading, time, shutil
from urllib.parse import urlparse
import yaml

D = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(D, "photos", "raw"); os.makedirs(RAW, exist_ok=True)
MAN = os.path.join(D, "photos", "manifest.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
pm = yaml.safe_load(open(os.path.join(D, "part_media.yaml")))
fp = json.load(open(os.path.join(D, "..", "loc", "fp_photos.json")))
cache_by_url = {r["url"]: os.path.join(D, "..", "loc", "colcache", code + ".img") for code, r in fp.items() if r.get("url")}

urls = {}
for k, v in pm.items():
    if (v or {}).get("entry") != "device":
        continue
    u = ((v or {}).get("photo") or {}).get("url")
    if u:
        urls.setdefault(u, []).append(k)
man = json.load(open(MAN)) if os.path.exists(MAN) else {}
lock = threading.Lock()


def sniff(path):
    b = open(path, "rb").read(16)
    if b.startswith(b"\x89PNG"): return "png"
    if b[:3] == b"\xff\xd8\xff": return "jpg"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP": return "webp"
    if b[:4] in (b"GIF8",): return "gif"
    if b.lstrip()[:1] == b"<": return "html"
    return "bin"


def one(u):
    h = hashlib.sha1(u.encode()).hexdigest()[:16]
    tmp = os.path.join(RAW, h + ".tmp")
    src = cache_by_url.get(u)
    if src and os.path.exists(src) and os.path.getsize(src) > 1000:
        shutil.copy(src, tmp); status = "cache"
    else:
        r = subprocess.run(["curl", "-s", "-L", "--max-time", "40", "-A", UA, "-H", "Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                            "-H", "Accept-Language: en-US,en;q=0.9", "-o", tmp, "-w", "%{http_code} %{content_type}", u], capture_output=True, text=True)
        status = r.stdout.strip() or "curl-fail"
    ext = sniff(tmp) if os.path.exists(tmp) else "none"
    rec = {"status": status, "kind": ext, "codes": urls[u]}
    if ext in ("png", "jpg", "webp", "gif"):
        fn = h + "." + ext
        os.replace(tmp, os.path.join(RAW, fn))
        rec.update(file=fn, bytes=os.path.getsize(os.path.join(RAW, fn)))
    elif os.path.exists(tmp):
        os.remove(tmp)
    with lock:
        man[u] = rec
        json.dump(man, open(MAN, "w"), indent=1)
    print(status, ext, u[:100], flush=True)
    return status != "cache"


by_host = {}
for u in urls:
    if u in man and man[u].get("file"):
        continue
    by_host.setdefault(urlparse(u).netloc.lower(), []).append(u)


def worker(host, us):
    for i, u in enumerate(us):
        hit_network = one(u)
        if hit_network and i < len(us) - 1:
            time.sleep(10.5)


ts = [threading.Thread(target=worker, args=(h, us)) for h, us in by_host.items()]
for t in ts: t.start()
for t in ts: t.join()
ok = sum(1 for r in man.values() if r.get("file"))
print("done:", ok, "of", len(urls), "photos on disk")
