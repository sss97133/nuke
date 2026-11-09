#!/usr/bin/env python3
"""Land works found in a holder's own Photos library through the sanctioned writer (propose_held_assets). Owner, 2026-11-08:
"art is an analysis not a declaration done manually. humans arent for manual data input." Case ledger §21.1.

Pipeline (all local; no pixels leave the machine):
  1. osxphotos query --json for the on-device art labels (Painting, Drawing, Sketch, Billboards, Mural, Modern Art, Acrylic
     Paint, Art Gallery, Street Art, Sculpture) -> candidates.json
  2. score_candidates(): the holder's own work vs art photographed or saved, from camera EXIF, place, albums, image size, labels
  3. osxphotos export --preview-if-missing for the in-scope uuids -> previews/
  4. featureprint.swift (Apple Vision VNGenerateImageFeaturePrintRequest) -> featureprints.jsonl
  5. cluster_works.py: cosine similarity, union-find, one work per component -> works.json
  6. this script: works.json -> propose_held_assets(person, proposals), 100 a call, idempotent on the work key

    dotenvx run -- python3 scripts/extractors/art_photos/propose_art_from_photos.py works.json --person <user uuid> [--dry-run] [--limit N]
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Lives in scripts/extractors (scripts/data is gitignored).
"""
import argparse, json, os, sys, urllib.error, urllib.request

LABELLER = "apple_photos_on_device_v1"


def to_proposal(w, method):
    photos = [{"uuid": p["uuid"], "taken_at": p["taken_at"], "filename": p.get("filename"), "labels": p.get("labels"), "width": p.get("width"),
               "height": p.get("height"), "latitude": p.get("latitude"), "longitude": p.get("longitude"), "camera": p.get("camera"),
               "caption": p.get("caption"), "place": p.get("place")} for p in w["photos"] if p.get("uuid") and p.get("taken_at")][:200]
    if not photos:
        return None
    return {"proposal_key": w["key"].replace(":", "-"), "kind": w["kind"], "labels": w.get("labels") or [], "labeller": LABELLER, "method": method,
            "confidence": 0.6, "sittings": w.get("sittings"), "captions": (w.get("captions") or [])[:3], "places": w.get("places") or [],
            "place": (w.get("places") or [[None]])[0][0] if w.get("places") else None, "photos": photos}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("works", help="works JSON from cluster_works.py")
    ap.add_argument("--person", required=True)
    ap.add_argument("--method", default="apple_vision_featureprint_cos0.90")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    works = json.load(open(a.works))
    proposals = [p for p in (to_proposal(w, a.method) for w in works) if p]
    if a.limit:
        proposals = proposals[: a.limit]
    by_kind = {}
    for p in proposals:
        by_kind[p["kind"]] = by_kind.get(p["kind"], 0) + 1
    summary = {"works": len(works), "proposals": len(proposals), "photos": sum(len(p["photos"]) for p in proposals), "by_kind": by_kind,
               "multi_day": sum(1 for p in proposals if (p.get("sittings") or 1) > 1)}
    if a.dry_run:
        # The receipt names counts and the first work's key and kind; photo coordinates and places stay in the file, not in a log.
        first = proposals[0] if proposals else None
        print(json.dumps({**summary, "first": {"proposal_key": first["proposal_key"], "kind": first["kind"], "photos": len(first["photos"]), "sittings": first.get("sittings")} if first else None}, indent=1, default=str)); return
    base = os.environ.get("SUPABASE_URL", "").rstrip("/"); key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run under dotenvx)")
    totals = {}
    for i in range(0, len(proposals), 100):
        batch = proposals[i:i + 100]
        req = urllib.request.Request(f"{base}/rest/v1/rpc/propose_held_assets", data=json.dumps({"p_person": a.person, "p_proposals": batch}).encode(), method="POST",
                                     headers={"Authorization": "Bearer " + key, "apikey": key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                receipt = json.loads(r.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"propose_held_assets failed: HTTP {e.code} {e.read().decode(errors='replace')[:400]}")
        for k in ("in", "proposals_new", "proposals_existing", "photo_sightings_new", "refused"):
            totals[k] = totals.get(k, 0) + int(receipt.get(k) or 0)
        if receipt.get("refused_keys"):
            totals.setdefault("refused_keys", []).extend(receipt["refused_keys"][:5])
    print(json.dumps({**summary, **totals}, indent=1, default=str))


if __name__ == "__main__":
    main()
