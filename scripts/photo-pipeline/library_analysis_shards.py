#!/usr/bin/env python3
"""library_analysis_shards.py: split the owner's eligible library photos between the local CPU pass and Codex.

Eligible = vehicle_images of the owner whose bytes are in our storage (image_url under /storage/v1/object/), not
is_sensitive, no sensitive_type, not vision_gate_status=rejected_personal. Rows without an uploaded file (the iOS
rows with no bytes, the privacy hold) are excluded because their image_url is not in our storage.

Codex shard: non-duplicate photos filed to the owner's garage vehicles, worst-first (most held / misattributed).
Local shard: every other eligible photo (unfiled, held, other vehicles, duplicates).
Writes ids-only shard files plus a manifest with short-lived signed URLs for Codex. No keys are written.

  SUPABASE_SECRET_KEY=... python3 library_analysis_shards.py --out /workspace/codex_handoff --expires 86400
"""
import argparse, json, os, sys, urllib.parse, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from local_image_analysis import http, with_retry, URL, AST

ELIGIBLE_SELECT = "id,vehicle_id,image_url,storage_path,is_duplicate,vision_gate_status,taken_at,is_primary,is_sensitive,sensitive_type"
PREFIX = f"{URL}/storage/v1/object/"


def bucket_path(u):
    rest = u[len(PREFIX):].split("?", 1)[0]
    for m in ("public/", "sign/", "authenticated/"):
        if rest.startswith(m):
            rest = rest[len(m):]
    b, p = rest.split("/", 1)
    return b, urllib.parse.unquote(p)


def page(path):
    out, off = [], 0
    while True:
        rows = with_retry(lambda: http("GET", f"{path}&limit=1000&offset={off}"))
        out += rows
        if len(rows) < 1000:
            return out
        off += 1000


def sign(bucket, paths, expires):
    res = []
    for i in range(0, len(paths), 500):
        chunk = paths[i:i + 500]
        res += with_retry(lambda: http("POST", f"/storage/v1/object/sign/{bucket}", {"expiresIn": expires, "paths": chunk}))
    return {r["path"]: (f"{URL}/storage/v1{r['signedURL']}" if r.get("signedURL") else None) for r in res}


def privacy_hold_ids(owner):
    """The privacy hold: the owner's iOS capture rows with no uploaded bytes (empty image_url). Never read or sent."""
    rows = page(f"/rest/v1/vehicle_images?user_id=eq.{owner}&source=eq.capture_relay_ios&image_url=eq.&select=id&order=id.asc")
    return {r["id"] for r in rows}


def verify(out_dir, local_path, owner, expect=276):
    """Hard check: no privacy-hold id appears in the Codex manifest or the local shard; records the count."""
    hold = privacy_hold_ids(owner)
    codex = {json.loads(l)["image_id"] for l in open(os.path.join(out_dir, "manifest_codex.jsonl"))}
    local = {l.strip() for l in open(local_path) if l.strip()}
    leak_c, leak_l, overlap = hold & codex, hold & local, codex & local
    if leak_c or leak_l or overlap:
        raise SystemExit(f"SHARD CHECK FAILED: hold in codex={len(leak_c)} hold in local={len(leak_l)} codex/local overlap={len(overlap)}")
    if len(hold) != expect:
        print(f"warning: privacy hold has {len(hold)} ids, expected {expect}", file=sys.stderr)
    sp = os.path.join(out_dir, "shards_summary.json")
    summ = json.load(open(sp))
    summ.update({"privacy_hold_excluded": len(hold), "privacy_hold_in_codex": 0, "privacy_hold_in_local": 0,
                 "codex_local_overlap": 0, "verified_at": datetime.datetime.now(AST).isoformat()})
    json.dump(summ, open(sp, "w"), indent=1)
    return len(hold)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", default="0b9f107a-d124-49de-9ded-94698f63c1c4")
    ap.add_argument("--out", default="/workspace/codex_handoff")
    ap.add_argument("--local-out", default="/workspace/sortrun/analysis/local_shard.txt")
    ap.add_argument("--expires", type=int, default=86400)
    ap.add_argument("--verify-only", action="store_true", help="check existing shard files against the privacy hold")
    a = ap.parse_args()
    o = a.owner
    if a.verify_only:
        print(json.dumps({"privacy_hold_excluded": verify(a.out, a.local_out, o)}))
        return
    allrows = page(f"/rest/v1/vehicle_images?user_id=eq.{o}&order=id.asc&select={ELIGIBLE_SELECT}")
    garage = page(f"/rest/v1/vehicles?or=(user_id.eq.{o},owner_id.eq.{o},uploaded_by.eq.{o})&deleted_at=is.null"
                  f"&merged_into_vehicle_id=is.null&select=id,year,make,model&order=id.asc")
    gids = {v["id"]: v for v in garage}
    excl = {"not_in_storage": 0, "sensitive": 0, "personal": 0}
    elig = []
    for r in allrows:
        if not (r["image_url"] or "").startswith(PREFIX):
            excl["not_in_storage"] += 1
        elif r["is_sensitive"] or r["sensitive_type"]:
            excl["sensitive"] += 1
        elif r["vision_gate_status"] == "rejected_personal":
            excl["personal"] += 1
        else:
            elig.append(r)
    score = {}
    for r in elig:
        if r["vehicle_id"] in gids:
            s = score.setdefault(r["vehicle_id"], [0, 0])
            s[0] += r["vision_gate_status"] in ("pending", "review_needed", "rejected_misattributed")
            s[1] += 1
    vorder = sorted(score, key=lambda v: (-score[v][0], -score[v][1]))
    vrank = {v: k for k, v in enumerate(vorder)}
    codex = sorted([r for r in elig if r["vehicle_id"] in gids and not r["is_duplicate"]],
                   key=lambda r: (vrank[r["vehicle_id"]], r["vision_gate_status"] not in ("pending", "review_needed"), r["taken_at"] or "", r["id"]))
    cids = {r["id"] for r in codex}
    local = [r for r in elig if r["id"] not in cids]
    # sign codex urls per bucket
    by_b = {}
    for r in codex:
        b, p = bucket_path(r["image_url"]); by_b.setdefault(b, []).append(p); r["_bp"] = (b, p)
    signed = {}
    for b, ps in by_b.items():
        for p, u in sign(b, ps, a.expires).items():
            signed[(b, p)] = u
    exp = (datetime.datetime.now(AST) + datetime.timedelta(seconds=a.expires)).isoformat()
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "manifest_codex.jsonl"), "w") as f:
        for k, r in enumerate(codex):
            v = gids[r["vehicle_id"]]
            f.write(json.dumps({"seq": k, "image_id": r["id"], "filed_vehicle_id": r["vehicle_id"],
                                "filed_vehicle_ymm": " ".join(str(x) for x in (v["year"], v["make"], v["model"]) if x),
                                "vehicle_priority": vrank[r["vehicle_id"]], "gate_status": r["vision_gate_status"],
                                "is_primary": bool(r["is_primary"]), "taken_at": r["taken_at"],
                                "format": os.path.splitext(r["_bp"][1])[1].lower().lstrip("."),
                                "signed_url": signed.get(r["_bp"]), "url_expires_at": exp}) + "\n")
    os.makedirs(os.path.dirname(a.local_out), exist_ok=True)
    with open(a.local_out, "w") as f:
        for r in local:
            f.write(r["id"] + "\n")
    summ = {"generated_at": datetime.datetime.now(AST).isoformat(), "owner_photos": len(allrows), "excluded": excl,
            "excluded_total": sum(excl.values()), "eligible": len(elig), "codex": len(codex), "local": len(local),
            "codex_unsigned": sum(1 for r in codex if not signed.get(r["_bp"])),
            "garage_vehicles": len(gids), "garage_vehicles_with_photos": len(vorder),
            "vehicle_order": [{"vehicle_id": v, "ymm": " ".join(str(x) for x in (gids[v]["year"], gids[v]["make"], gids[v]["model"]) if x),
                               "held_or_misattributed": score[v][0], "photos": score[v][1]} for v in vorder]}
    json.dump(summ, open(os.path.join(a.out, "shards_summary.json"), "w"), indent=1)
    verify(a.out, a.local_out, o)
    print(json.dumps({k: v for k, v in summ.items() if k != "vehicle_order"}))


if __name__ == "__main__":
    main()
