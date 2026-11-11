#!/usr/bin/env python3
"""codex_image_analysis_ingest.py: sign and write Codex's batched vision readings into image_observations.

Codex reads photos in its subscription session without a model API key and from manifest_codex.jsonl and emits one JSON line per
photo (see CODEX_ANALYSIS.md). This producer validates each line against the manifest and the enums,
signs it, and writes it. Provenance is what Codex reported for its own session (--model, --session), never assumed.

  python3 codex_image_analysis_ingest.py --in results.jsonl --manifest manifest_codex.jsonl \
      --model "<model Codex's session reported>" --session <codex thread/session id> --run-id UUID [--dry-run]
  Repeat this command with --revert and the same --run-id to withdraw only these image readings.
"""
import argparse, json, os, sys, uuid, datetime
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from codex_analysis_transport import http, with_retry, git_commit

OBSERVER = "codex_image_analysis_v1"
CONTRACT_VERSION = "codex-image-analysis-contract-v1"
VIEWS = {"exterior_front", "exterior_rear", "exterior_side", "interior", "engine", "undercarriage", "detail",
         "document", "screenshot", "person", "other"}
CATEGORIES = {"car", "pickup_truck", "suv", "van", "motorcycle", "boat", "heavy_equipment", "none", "unknown"}
MATCH = {"yes", "no", "unsure", "not_applicable"}
QUALITY = {"good", "fair", "poor"}
READING_FIELDS = ("is_vehicle", "p_vehicle", "view", "view_confidence", "category", "body_cues", "make_cues",
                  "matches_filed_vehicle", "match_confidence", "best_gallery_vehicle_id", "quality", "notes")


def reading_for(r, manifest):
    return {**{k: r.get(k) for k in READING_FIELDS},
            "filed_vehicle_id_at_read": manifest[r["image_id"]].get("filed_vehicle_id")}


def active_readings(ids):
    fields = "id,image_id,vehicle_id,role,confidence,confidence_basis,layer_version"
    return with_retry(lambda: http("GET", f"/rest/v1/image_observations?observed_by=eq.{OBSERVER}"
        f"&is_active=is.true&image_id=in.({','.join(ids)})&select={fields}")) or []


def reconcile(rows, expected, manifest, run_id, model, session):
    """An existing image ID is not proof that this reading was saved."""
    verified, conflicts = {}, []
    for row in rows:
        image_id = row.get("image_id")
        sig = (row.get("confidence_basis") or {}).get(OBSERVER) or {}
        layer = row.get("layer_version") or {}
        r = expected.get(image_id)
        if (r is None or image_id in verified or not row.get("id")
                or row.get("vehicle_id") is not None or row.get("role") != "incidental"
                or sig.get("run_id") != run_id or layer.get("run_id") != run_id
                or sig.get("contract_version") != CONTRACT_VERSION or layer.get("contract") != CONTRACT_VERSION
                or sig.get("model") != model or sig.get("codex_session") != session
                or sig.get("confidence") != r["confidence"] or row.get("confidence") != r["confidence"]
                or sig.get("reading") != reading_for(r, manifest)):
            conflicts.append(image_id)
        else:
            verified[image_id] = row["id"]
    if conflicts:
        raise ValueError("Active reading conflict for image IDs: " + json.dumps(conflicts)
                         + "; inspect and use the bounded withdrawal path before correcting")
    return verified


def validate(r, manifest):
    e = []
    if not isinstance(r, dict): return ["reading must be an object"]
    if not isinstance(r.get("image_id"), str) or r.get("image_id") not in manifest: e.append("image_id not in manifest")
    try:
        if str(uuid.UUID(r.get("image_id"))) != r.get("image_id"): e.append("image_id must be canonical UUID")
    except (ValueError, TypeError, AttributeError):
        e.append("image_id must be canonical UUID")
    if not isinstance(r.get("is_vehicle"), bool): e.append("is_vehicle must be bool")
    if r.get("view") not in VIEWS: e.append("view")
    if r.get("category") not in CATEGORIES: e.append("category")
    if r.get("matches_filed_vehicle") not in MATCH: e.append("matches_filed_vehicle")
    if r.get("quality") not in QUALITY: e.append("quality")
    for k in ("confidence", "p_vehicle", "view_confidence", "match_confidence"):
        v = r.get(k)
        if v is not None and not (type(v) in (int, float) and 0 <= v <= 1): e.append(k)
    if r.get("confidence") is None: e.append("confidence required")
    return e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--revert", action="store_true", help="withdraw this run for the input image IDs through the bounded RPC")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--model", required=True, help="model name/version exactly as Codex's session reported it")
    ap.add_argument("--session", required=True, help="Codex thread or session id that produced the file")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not a.run_id: ap.error("--run-id is required so admission/reversion are repeatable")
    rid = str(uuid.UUID(a.run_id))
    manifest = {r["image_id"]: r for r in (json.loads(l) for l in Path(a.manifest).read_text().splitlines() if l.strip())}
    commit = git_commit()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    good, bad = [], []
    for n, line in enumerate(Path(a.inp).read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:  # noqa: BLE001
            bad.append({"line": n, "errors": ["not json"]}); continue
        err = validate(r, manifest)
        if err:
            bad.append({"line": n, "image_id": r.get("image_id") if isinstance(r, dict) else None, "errors": err}); continue
        good.append(r)
    if bad:
        sys.exit(json.dumps({"rejected": bad, "written": 0}))
    if len(good) > 50 or len({r["image_id"] for r in good}) != len(good):
        sys.exit("Require at most 50 distinct image readings")
    if a.revert:
        count = 0 if a.dry_run or not good else with_retry(lambda: http("POST", "/rest/v1/rpc/revert_codex_image_analysis_batch",
            {"p_run_id": rid, "p_image_ids": [r["image_id"] for r in good]}))
        print(json.dumps({"run_id": rid, "rows_deactivated": count, "dry_run": a.dry_run}))
        return
    expected = {r["image_id"]: r for r in good}
    seen = {}
    if good and not a.dry_run:
        try:
            seen = reconcile(active_readings(expected), expected, manifest, rid, a.model, a.session)
        except ValueError as error:
            sys.exit(str(error) + "; no rows written")
    # Recheck privacy immediately before admission. The frozen manifest remains the
    # source of scope; it cannot overrule a newer privacy disposition.
    if good and not a.dry_run:
        ids = ",".join(r["image_id"] for r in good)
        current = with_retry(lambda: http("GET", "/rest/v1/vehicle_images?id=in.(" + ids + ")&select=id,is_sensitive,sensitive_type,vision_gate_status,image_url"))
        allowed = {r["id"] for r in current or [] if not r.get("is_sensitive") and not r.get("sensitive_type")
                   and r.get("vision_gate_status") != "rejected_personal" and r.get("image_url")}
        if allowed != {r["image_id"] for r in good}:
            sys.exit("Current privacy/source check rejected batch; no rows written")
    out = []
    for r in good:
        if r["image_id"] in seen:
            continue
        reading = reading_for(r, manifest)
        sig = {"agent": "codex", "model": a.model, "codex_session": a.session, "code_commit": commit,
               "contract_version": CONTRACT_VERSION, "run_id": rid, "confidence": float(r["confidence"]),
               "confidence_kind": "subjective_uncalibrated",
               "ingested_at": now, "producer": "scripts/photo-pipeline/codex_image_analysis_ingest.py", "reading": reading}
        out.append({"image_id": r["image_id"], "vehicle_id": None, "observed_by": OBSERVER,
                    "role": "incidental",
                    "confidence": float(r["confidence"]), "confidence_basis": {OBSERVER: sig},
                    "layer_version": {"contract": CONTRACT_VERSION, "run_id": rid}, "agent_version": f"codex:{a.model}",
                    "is_active": True})
    admitted_ids = []
    if out and not a.dry_run:
        for row in out:
            payload = {"p_" + k: v for k, v in row.items() if k != "is_active"}
            # Stable payload per retry: the sanctioned RPC returns an existing
            # identical reading instead of duplicating an uncertain POST.
            admitted_ids.append(with_retry(lambda: http("POST", "/rest/v1/rpc/ingest_image_observation", payload)))
    verified = {}
    if good and not a.dry_run:
        try:
            verified = reconcile(active_readings(expected), expected, manifest, rid, a.model, a.session)
            if set(verified) != set(expected) or any(verified[row["image_id"]] != returned
                    for row, returned in zip(out, admitted_ids)):
                raise ValueError("Persisted rows or returned observation IDs do not match the requested batch")
        except ValueError as error:
            sys.exit(str(error) + "; admission unverified, inspect this run before retrying")
    print(json.dumps({"run_id": rid, "observer": OBSERVER, "written": 0 if a.dry_run else len(out), "valid": len(good),
                      "observation_ids": list(verified.values()), "already_present": len(seen), "verified": len(verified),
                      "rejected": len(bad), "rejected_sample": bad[:5], "dry_run": a.dry_run}))


if __name__ == "__main__":
    main()
