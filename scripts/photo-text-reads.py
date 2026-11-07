#!/usr/bin/env python3
"""
photo-text-reads.py: the box-side OCR pass for one user's photos.

Reads the lettering on a frame (badges, plates, VIN tags, paper) with RapidOCR on a 1600 px JPEG render of the stored
original and records it through record_image_text_reads as contributor agent:claude-box, method rapidocr_box_v1: the
same shape the capture-set scorer already consumes from the phone-relay reads (lines [[text, conf], ...], vin_candidates
[{vin, kind, conf, line, dist}]). A read is of particular bytes: the batch carries vehicle_images.file_hash and the writer
refuses a read whose bytes changed since. Reads are evidence for the scorer's vin, plate and badge legs; they never file a
photo by themselves (the contributor is on probation).

Work list: image_text_read_batch(p_user, p_limit), migration 20261111110000: admitted-source frames of the last two years
with no unrevoked read, newest first. Nothing is printed but counts: no text, no urls, no ids beyond the run id.

Run from the repo root (dotenvx finds .env there), with a Python that has rapidocr_onnxruntime, requests and pillow:
  dotenvx run -- ~/.nuke/ocr-venv/bin/python scripts/photo-text-reads.py --user <uuid> --limit 400 --workers 4
  dotenvx run -- ~/.nuke/ocr-venv/bin/python scripts/photo-text-reads.py --user <uuid> --all
"""
import argparse
import io
import os
import re
import sys
import time
import uuid
from multiprocessing import Pool

import requests

AP = argparse.ArgumentParser()
AP.add_argument("--user", required=True, help="the user whose frames are read")
AP.add_argument("--limit", type=int, default=200, help="frames per batch (at most 1000)")
AP.add_argument("--all", action="store_true", help="loop until the batch comes back empty")
AP.add_argument("--workers", type=int, default=4)
AP.add_argument("--width", type=int, default=1600)
AP.add_argument("--dry", action="store_true", help="read, count, record nothing")
args = AP.parse_args()

URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not URL or not KEY:
    print("missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
    sys.exit(1)
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
CONTRIBUTOR = "agent:claude-box"
METHOD = "rapidocr_box_v1"
RUN_ID = str(uuid.uuid4())

VIN17 = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
# A classic (pre-1981) serial as GM, Ford and Chrysler stamped them: 11 to 13 characters, letters and digits mixed.
CLASSIC = re.compile(r"^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{11,13}$")


def render_url(image_url: str) -> str:
    if "/storage/v1/object/public/" in image_url:
        u = image_url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")
        sep = "&" if "?" in u else "?"
        return f"{u}{sep}width={args.width}&quality=80&resize=contain"
    return image_url


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def roster_vins(user: str) -> list:
    r = requests.get(
        f"{URL}/rest/v1/vehicles",
        headers=H,
        params={"select": "vin", "or": f"(owner_id.eq.{user},user_id.eq.{user})", "deleted_at": "is.null", "vin": "not.is.null"},
        timeout=60,
    )
    r.raise_for_status()
    out = set()
    for row in r.json():
        v = re.sub(r"[^A-Z0-9]", "", (row.get("vin") or "").upper())
        if len(v) >= 8:
            out.add(v)
    return sorted(out)


def fetch_batch(user: str, n: int) -> list:
    r = requests.post(f"{URL}/rest/v1/rpc/image_text_read_batch", headers=H, json={"p_user": user, "p_limit": n}, timeout=90)
    r.raise_for_status()
    return r.json()


def vin_candidates(lines: list, roster: list) -> list:
    out = []
    for idx, (text, conf) in enumerate(lines):
        norm = re.sub(r"[^A-Z0-9]", "", text.upper())
        for token in {norm, *re.findall(r"[A-Z0-9]{11,17}", text.upper())}:
            if not token:
                continue
            kind = "vin17" if VIN17.match(token) else ("classic" if CLASSIC.match(token) else None)
            if kind is None:
                continue
            dist = min((levenshtein(token, v) for v in roster), default=None)
            if kind == "classic" and (dist is None or dist > 2):
                continue   # a bare classic serial is only a candidate when it is within two edits of a roster serial
            out.append({"vin": token, "kind": kind, "conf": round(float(conf), 3), "line": idx, "dist": dist})
    return out


_ocr = None


def _init():
    global _ocr
    from rapidocr_onnxruntime import RapidOCR
    _ocr = RapidOCR(intra_op_num_threads=1)


def _read(job):
    image_id, image_url = job
    try:
        rr = requests.get(render_url(image_url), timeout=60)
        if rr.status_code != 200 or not rr.content:
            rr = requests.get(image_url, timeout=90)
            rr.raise_for_status()
        res, _ = _ocr(rr.content)
        lines = [[r[1], round(float(r[2]), 3)] for r in (res or [])]
        return image_id, lines, None
    except Exception as e:  # noqa: BLE001 - one bad frame never stops the pass
        return image_id, None, type(e).__name__


def record(items: list) -> dict:
    r = requests.post(
        f"{URL}/rest/v1/rpc/record_image_text_reads",
        headers=H,
        json={"p_run_id": RUN_ID, "p_contributor_key": CONTRIBUTOR, "p_method": METHOD, "p_items": items},
        timeout=120,
    )
    r.raise_for_status()
    return r.json()


def main():
    roster = roster_vins(args.user)
    print(f"run {RUN_ID}: roster serials {len(roster)}", flush=True)
    totals = {"read": 0, "failed": 0, "recorded": 0, "skipped": 0, "with_vin": 0, "documents": 0}
    seen = set()
    with Pool(args.workers, initializer=_init) as pool:
        while True:
            batch = [b for b in fetch_batch(args.user, args.limit) if b["image_id"] not in seen]
            if not batch:
                break
            t0 = time.time()
            jobs = [(b["image_id"], b["image_url"]) for b in batch]
            hashes = {b["image_id"]: b.get("file_hash") for b in batch}
            items = []
            for image_id, lines, err in pool.imap_unordered(_read, jobs, chunksize=2):
                seen.add(image_id)
                if lines is None:
                    totals["failed"] += 1
                    continue
                totals["read"] += 1
                cands = vin_candidates(lines, roster)
                is_doc = len(lines) >= 20
                totals["with_vin"] += 1 if cands else 0
                totals["documents"] += 1 if is_doc else 0
                items.append({"image_id": image_id, "source_sha256": hashes.get(image_id), "is_document": is_doc,
                              "lines": lines, "vin_candidates": cands})
            if items and not args.dry:
                for i in range(0, len(items), 50):
                    res = record(items[i:i + 50])
                    totals["recorded"] += int(res.get("recorded", 0))
                    totals["skipped"] += int(res.get("skipped", 0))
            print(f"batch {len(batch)} in {time.time() - t0:.0f}s: {totals}", flush=True)
            if not args.all:
                break
    print(f"done run {RUN_ID}: {totals}", flush=True)


if __name__ == "__main__":
    main()
