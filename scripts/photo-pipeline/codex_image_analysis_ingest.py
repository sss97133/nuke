#!/usr/bin/env python3
"""codex_image_analysis_ingest.py: sign and write Codex's batched vision readings into image_observations.

Codex (ChatGPT subscription, no API key, no DB key) reads photos from manifest_codex.jsonl and emits one JSON line per
photo (schema in docs CONTRACT.md / below). This producer validates each line against the manifest and the enums,
signs it, and writes it. Provenance is what Codex reported for its own session (--model, --session), never assumed.

  python3 codex_image_analysis_ingest.py --in results.jsonl --manifest manifest_codex.jsonl \
      --model "<model Codex's session reported>" --session <codex thread/session id> [--run-id UUID] [--dry-run]
  python3 local_image_analysis.py --revert <run_id> --observer codex_image_analysis_v1
"""
import argparse, json, os, sys, uuid, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from local_image_analysis import http, with_retry, git_commit

OBSERVER = "codex_image_analysis_v1"
CONTRACT_VERSION = "codex-image-analysis-contract-v1"
VIEWS = {"exterior_front", "exterior_rear", "exterior_side", "interior", "engine", "undercarriage", "detail",
         "document", "screenshot", "person", "other"}
CATEGORIES = {"car", "pickup_truck", "suv", "van", "motorcycle", "boat", "heavy_equipment", "none"}
MATCH = {"yes", "no", "unsure", "not_applicable"}
QUALITY = {"good", "fair", "poor"}


def validate(r, manifest):
    e = []
    if r.get("image_id") not in manifest: e.append("image_id not in manifest")
    if not isinstance(r.get("is_vehicle"), bool): e.append("is_vehicle must be bool")
    if r.get("view") not in VIEWS: e.append("view")
    if r.get("category") not in CATEGORIES: e.append("category")
    if r.get("matches_filed_vehicle") not in MATCH: e.append("matches_filed_vehicle")
    if r.get("quality") not in QUALITY: e.append("quality")
    for k in ("confidence", "view_confidence", "match_confidence"):
        v = r.get(k)
        if v is not None and not (isinstance(v, (int, float)) and 0 <= v <= 1): e.append(k)
    if r.get("confidence") is None: e.append("confidence required")
    return e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--model", required=True, help="model name/version exactly as Codex's session reported it")
    ap.add_argument("--session", required=True, help="Codex thread or session id that produced the file")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--allow-image", action="append", default=[], help="test only: accept this image id outside the manifest")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    rid = str(uuid.UUID(a.run_id)) if a.run_id else str(uuid.uuid4())
    manifest = {json.loads(l)["image_id"]: json.loads(l) for l in open(a.manifest)}
    for i in a.allow_image:
        manifest.setdefault(i, {"image_id": i, "filed_vehicle_id": None})
    commit = git_commit()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    good, bad = [], []
    for n, line in enumerate(open(a.inp), 1):
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:  # noqa: BLE001
            bad.append({"line": n, "errors": ["not json"]}); continue
        err = validate(r, manifest)
        if err:
            bad.append({"line": n, "image_id": r.get("image_id"), "errors": err}); continue
        good.append(r)
    seen = set()
    if good and not a.dry_run:
        for i in range(0, len(good), 150):
            ids = ",".join(r["image_id"] for r in good[i:i + 150])
            have = with_retry(lambda: http("GET", f"/rest/v1/image_observations?observed_by=eq.{OBSERVER}&is_active=is.true&image_id=in.({ids})&select=image_id"))
            seen |= {h["image_id"] for h in have or []}
    out = []
    for r in good:
        if r["image_id"] in seen:
            continue
        m = manifest[r["image_id"]]
        reading = {k: r.get(k) for k in ("is_vehicle", "p_vehicle", "view", "view_confidence", "category", "body_cues", "make_cues",
                                          "matches_filed_vehicle", "match_confidence", "best_gallery_vehicle_id", "quality", "notes")}
        reading["filed_vehicle_id_at_read"] = m.get("filed_vehicle_id")
        sig = {"agent": "codex", "model": a.model, "codex_session": a.session, "code_commit": commit,
               "contract_version": CONTRACT_VERSION, "run_id": rid, "confidence": float(r["confidence"]),
               "ingested_at": now, "producer": "scripts/photo-pipeline/codex_image_analysis_ingest.py", "reading": reading}
        out.append({"image_id": r["image_id"], "vehicle_id": None, "observed_by": OBSERVER,
                    "role": "document" if r["view"] == "document" else "incidental",
                    "confidence": float(r["confidence"]), "confidence_basis": {OBSERVER: sig},
                    "layer_version": {"contract": CONTRACT_VERSION, "run_id": rid}, "agent_version": f"codex:{a.model}",
                    "is_active": True})
    if out and not a.dry_run:
        for i in range(0, len(out), 200):
            chunk = out[i:i + 200]
            with_retry(lambda: http("POST", "/rest/v1/image_observations", chunk, {"Prefer": "return=minimal"}))
    print(json.dumps({"run_id": rid, "observer": OBSERVER, "written": 0 if a.dry_run else len(out), "valid": len(good),
                      "already_present": len(seen), "rejected": len(bad), "rejected_sample": bad[:5], "dry_run": a.dry_run}))


if __name__ == "__main__":
    main()
