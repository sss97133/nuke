#!/usr/bin/env python3
"""Split Mecum's public lot index pull into 100-lot batch files for land_index_lots.

usage: build_batches.py <index.ndjson> <out dir> <pulled_at ISO> [held.ndjson]

Keeps vehicle-type lots only (Auto, Motorcycle, Tractor, Boat); the function re-checks every gate. With held.ndjson (one JSON
object per line with source_url), lots whose lot id is already held are left out, which saves the function its lookups.
Writes batch_00001.json ... each {"lots": [...], "pulled_at": "..."}. Re-running over the same input rewrites the same batches.
"""
import json, os, re, sys

VEHICLE_TYPES = {"Auto", "Motorcycle", "Tractor", "Boat"}


def first(t, key):
    v = (t or {}).get(key)
    x = v[0] if isinstance(v, list) and v else None
    return x.get("name") if isinstance(x, dict) else x


def lot_id(url):
    m = re.search(r"/lots/([A-Za-z0-9-]+)/", url or "")
    return m.group(1) if m else None


def main():
    src, out, pulled = sys.argv[1], sys.argv[2], sys.argv[3]
    held = set()
    if len(sys.argv) > 4:
        for line in open(sys.argv[4]):
            try:
                i = lot_id((json.loads(line).get("source_url") or "").rstrip("/") + "/")
            except ValueError:
                continue
            if i:
                held.add(i)
    os.makedirs(out, exist_ok=True)
    batch, n, kept, seen = [], 0, 0, set()

    def flush():
        nonlocal batch, n
        if not batch:
            return
        n += 1
        with open(os.path.join(out, "batch_%05d.json" % n), "w") as f:
            json.dump({"lots": batch, "pulled_at": pulled}, f, separators=(",", ":"))
        batch = []

    for line in open(src):
        try:
            hit = json.loads(line)
        except ValueError:
            continue
        t = hit.get("taxonomies")
        i = lot_id(hit.get("permalink"))
        if not isinstance(t, dict) or not i or i in held or i in seen or first(t, "lot_type") not in VEHICLE_TYPES:
            continue
        seen.add(i)
        for k in ("_highlightResult", "_snippetResult", "content"):
            hit.pop(k, None)
        batch.append(hit)
        kept += 1
        if len(batch) == 100:
            flush()
    flush()
    print("batches", n, "lots", kept, "held_skipped", len(held))


main()
