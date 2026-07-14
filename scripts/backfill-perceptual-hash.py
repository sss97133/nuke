#!/usr/bin/env python3
"""
backfill-perceptual-hash.py — fill vehicle_images.phash/dhash from the source pixels.

A load-bearing field the pipeline never populated: phash/dhash were 0% filled, so dedup
was impossible (is_duplicate=0 even where bursts obviously exist). This computes them — a
free, deterministic, no-AI step (source #2 in the extraction contract, Ch.19) — so the
burst-dedup organ (flag_image_burst_duplicates) has an input.

Perceptual hashing is resolution-independent: the same shot at different sizes hashes the
same, so it also catches genuine re-uploads. (Note: it is NOT a library-halving 2x dedup —
the HD-archive and capture-relay copies were shown to be distinct shoots; this mainly
collapses bursts. See Ch.19.)

Storage: phash + dhash as 16-char hex (64-bit). Idempotent: only rows where phash IS NULL.

Usage:
  python3 scripts/backfill-perceptual-hash.py --vehicle-id <uuid> [--limit N]
  python3 scripts/backfill-perceptual-hash.py --all [--limit N]

Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
Deps: pip install pillow pillow-heif imagehash requests
"""
import os, sys, io, argparse, requests, imagehash
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()

URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not URL or not KEY:
    sys.exit("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
H = {"apikey": KEY, "authorization": f"Bearer {KEY}", "content-type": "application/json"}

ap = argparse.ArgumentParser()
ap.add_argument("--vehicle-id"); ap.add_argument("--all", action="store_true")
ap.add_argument("--limit", type=int, default=500)
a = ap.parse_args()
if not a.vehicle_id and not a.all:
    sys.exit("need --vehicle-id <uuid> or --all")

sess = requests.Session()

def fetch_pending(limit):
    q = (f"{URL}/rest/v1/vehicle_images?select=id,image_url"
         f"&phash=is.null&image_url=not.is.null&is_superseded=eq.false&limit={limit}")
    if not a.all:
        q += f"&vehicle_id=eq.{a.vehicle_id}"
    r = sess.get(q, headers=H, timeout=60); r.raise_for_status()
    return r.json()

def hashes(url):
    # EXIF/whole-image needed for perceptual hash — pull the file (cap at a sane size).
    resp = sess.get(url, timeout=60); resp.raise_for_status()
    im = Image.open(io.BytesIO(resp.content)).convert("RGB")
    return str(imagehash.phash(im)), str(imagehash.dhash(im))

done = err = 0
rows = fetch_pending(a.limit)
print(f"to hash: {len(rows)}")
for r in rows:
    try:
        ph, dh = hashes(r["image_url"])
        u = sess.patch(f"{URL}/rest/v1/vehicle_images?id=eq.{r['id']}&phash=is.null",
                       headers={**H, "prefer": "return=minimal"},
                       json={"phash": ph, "dhash": dh}, timeout=60)
        u.raise_for_status(); done += 1
    except Exception as e:
        err += 1; print("ERR", r["id"][:8], str(e)[:80])
print(f"phash backfill: filled={done} errors={err}")
