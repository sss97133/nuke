#!/usr/bin/env python3
"""library_gallery_refs.py: verified reference photos per garage vehicle, for comparing library photos to a vehicle.

Candidates: the vehicle's vision-gate-approved, non-sensitive, non-duplicate exterior photos (plus its hero), spread
over distinct days. Pollution guard: every candidate is embedded with the pinned CLIP B/32 and a candidate whose mean
cosine to the vehicle's other candidates is below --min-cohesion (or more than --mad-k MADs below the vehicle median)
is dropped as an outlier, e.g. another car that slipped into the gallery. --exclude-file adds hand-confirmed bad refs.
Writes gallery_refs.jsonl with short-lived signed URLs (no keys).
"""
import argparse, json, os, sys, datetime, collections
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from local_image_analysis import http, with_retry, URL, AST, object_path
from library_analysis_shards import page, sign, bucket_path, PREFIX
import local_image_analysis_model as M


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", default="0b9f107a-d124-49de-9ded-94698f63c1c4")
    ap.add_argument("--out", default="/workspace/codex_handoff/gallery_refs.jsonl")
    ap.add_argument("--per-vehicle", type=int, default=8)
    ap.add_argument("--candidates", type=int, default=14)
    ap.add_argument("--min-cohesion", type=float, default=0.62)
    ap.add_argument("--mad-k", type=float, default=3.0)
    ap.add_argument("--exclude-file", default="")
    ap.add_argument("--expires", type=int, default=86400)
    a = ap.parse_args()
    o = a.owner
    excl = set(l.strip() for l in open(a.exclude_file)) if a.exclude_file and os.path.exists(a.exclude_file) else set()
    garage = page(f"/rest/v1/vehicles?or=(user_id.eq.{o},owner_id.eq.{o},uploaded_by.eq.{o})&deleted_at=is.null"
                  f"&merged_into_vehicle_id=is.null&select=id,year,make,model,primary_image_url&order=id.asc")
    R = M.Reader(threads=4, label_model="b32")
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(6)
    lines, report = [], []
    for v in garage:
        rows = with_retry(lambda: http("GET", f"/rest/v1/vehicle_images?vehicle_id=eq.{v['id']}&vision_gate_status=eq.approved"
                                               f"&is_sensitive=is.false&or=(is_duplicate.is.null,is_duplicate.is.false)"
                                               f"&select=id,image_url,storage_path,taken_at,is_primary,ai_scan_metadata->classification->>image_type"
                                               f"&order=is_primary.desc,taken_at.asc.nullslast&limit=400"))
        rows = [r for r in rows if (r["image_url"] or "").startswith(PREFIX) and r["id"] not in excl
                and (r["is_primary"] or r.get("image_type") in ("vehicle_exterior", None))]
        if not rows:
            continue
        ext = [r for r in rows if r["is_primary"] or r.get("image_type") == "vehicle_exterior"] or rows
        days = collections.OrderedDict()
        for r in ext:
            days.setdefault((r["taken_at"] or "")[:10], []).append(r)
        cands, i = [], 0
        while len(cands) < min(a.candidates, len(ext)):
            for d in list(days):
                if i < len(days[d]):
                    cands.append(days[d][i])
            i += 1
        cands = cands[:a.candidates]
        def get(r):
            try:
                return r, http("GET", object_path(r), raw=True, timeout=120)
            except Exception:  # noqa: BLE001
                return r, None
        got = [(r, b) for r, b in pool.map(get, cands) if b]
        ims, keep = [], []
        for r, b in got:
            try:
                ims.append(M.load_image(b)[0]); keep.append(r)
            except Exception:  # noqa: BLE001
                pass
        if not keep:
            continue
        E = np.array([x["embedding"] for x in R.read(ims)])
        S = E @ E.T
        n = len(keep)
        coh = (S.sum(1) - 1) / max(1, n - 1) if n > 1 else np.ones(1)
        med = float(np.median(coh)); mad = float(np.median(np.abs(coh - med))) or 0.01
        ok = [k for k in range(n) if n < 3 or (coh[k] >= a.min_cohesion and coh[k] >= med - a.mad_k * mad)]
        ok = sorted(ok, key=lambda k: (not keep[k]["is_primary"], -coh[k]))[:a.per_vehicle]
        dropped = [keep[k]["id"] for k in range(n) if k not in ok]
        report.append({"vehicle_id": v["id"], "candidates": n, "kept": len(ok), "dropped_outliers": dropped,
                       "cohesion_median": round(med, 3)})
        for k in ok:
            r = keep[k]
            lines.append({"vehicle_id": v["id"], "ymm": " ".join(str(x) for x in (v["year"], v["make"], v["model"]) if x),
                          "image_id": r["id"], "is_hero": bool(r["is_primary"]), "taken_at": r["taken_at"],
                          "cohesion": round(float(coh[k]), 3), "_bp": bucket_path(r["image_url"])})
    by_b = collections.defaultdict(list)
    for l in lines:
        by_b[l["_bp"][0]].append(l["_bp"][1])
    signed = {}
    for b, ps in by_b.items():
        for p, u in sign(b, ps, a.expires).items():
            signed[(b, p)] = u
    exp = (datetime.datetime.now(AST) + datetime.timedelta(seconds=a.expires)).isoformat()
    with open(a.out, "w") as f:
        for l in lines:
            bp = l.pop("_bp")
            l["format"] = os.path.splitext(bp[1])[1].lower().lstrip(".")
            l["signed_url"] = signed.get(tuple(bp)); l["url_expires_at"] = exp
            f.write(json.dumps(l) + "\n")
    json.dump(report, open(a.out.replace(".jsonl", "_report.json"), "w"), indent=1)
    print(json.dumps({"vehicles": len(report), "refs": len(lines), "outliers_dropped": sum(len(r["dropped_outliers"]) for r in report)}))


if __name__ == "__main__":
    main()
