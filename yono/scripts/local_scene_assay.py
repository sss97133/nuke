#!/usr/bin/env python3
"""Bounded local pixel assay. Dry run by default; never writes to the database.

Manifest: {"images": [{"image_id": UUID, "vehicle_id": UUID, "public": true,
"path": "/private/cache/photo.jpg", "sha256": "...", "source_url": "https://...",
"source": "bat_import", "is_sensitive": false, "is_duplicate": false,
"is_superseded": false, "vision_gate_status": "pending",
"expected_image_type": "vehicle_exterior"}]}. At least three predeclared scene
controls are required. Classifications remain unaccepted model testimony.

python local_scene_assay.py --manifest private.json --out private-receipt.json
Add --run for up to 20 images / 300 seconds against an already running Ollama.
No model downloads, service starts, automatic retry, cloud fallback, or queue calls.
See https://docs.ollama.com/capabilities/structured-outputs .
"""

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import statistics
import time
import urllib.request
from urllib.parse import urlsplit
from uuid import UUID

from ollama_ocr_worker import resize_image_b64  # Pure helper; worker main is guarded.

QUESTIONNAIRE = Path(__file__).with_name("local_scene_questionnaire_v2.json")
QUESTIONNAIRE_HASH = "410c4289c01963b3df68b59b1f611da58fb33525b1c443c0f9ff6b31e7b1f826"
MODEL_DIGEST = "5ced39dfa4bac325dc183dd1e4febaa1c46b3ea28bce48896c8e69c1e79611cc"
LOCAL_URL = "http://127.0.0.1:11434"
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def load_questionnaire():
    packet = json.loads(QUESTIONNAIRE.read_text())
    declared = packet.pop("questionnaire_hash")
    actual = sha256(json.dumps(packet, sort_keys=True, separators=(",", ":")).encode())
    if actual != declared or actual != QUESTIONNAIRE_HASH:
        raise ValueError("questionnaire_integrity")
    return packet


def choices(packet, name):
    return packet["schema"]["properties"][name]["anyOf"][0]["enum"]


def strict_json(text):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError("duplicate_json_key")
            out[key] = value
        return out
    return json.loads(text, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite_json")))


def validate_scene(content, packet):
    result = strict_json(content)
    if type(result) is not dict or set(result) != {"image_type", "visible_evidence"}:
        raise ValueError("scene_shape")
    for key, value in result.items():
        if value is not None and (type(value) is not str or value not in choices(packet, key)):
            raise ValueError("scene_enum")
    return result


def validate_manifest(manifest, packet):
    rows = manifest.get("images")
    if type(rows) is not list or not 3 <= len(rows) <= 20:
        raise ValueError("cohort_size")
    seen = set()
    total = 0
    for row in rows:
        if type(row) is not dict or row.get("public") is not True:
            raise ValueError("public_source_required")
        for key in ["image_id", "vehicle_id"]:
            if str(UUID(row[key])) != row[key]:
                raise ValueError("source_identity")
        if row["image_id"] in seen:
            raise ValueError("duplicate_image")
        seen.add(row["image_id"])
        for key in ["is_sensitive", "is_duplicate", "is_superseded"]:
            if row.get(key) is not False:
                raise ValueError("image_eligibility")
        if row.get("vision_gate_status") not in ["pending", "approved"]:
            raise ValueError("image_gate")
        url = urlsplit(row.get("source_url", ""))
        bat = url.hostname == "bringatrailer.com" or (url.hostname or "").endswith(".bringatrailer.com")
        craigslist = url.hostname == "images.craigslist.org"
        if (url.scheme != "https" or url.username or url.password or url.query or url.fragment
                or url.port not in [None, 443]
                or not ((bat and row.get("source") in ["bat", "bat_import"])
                        or (craigslist and row.get("source") == "external_import"))):
            raise ValueError("public_source_url")
        expected = row.get("expected_image_type")
        if expected is not None and expected not in choices(packet, "image_type"):
            raise ValueError("control_label")
        if not re.fullmatch(r"[0-9a-f]{64}", row.get("sha256", "")):
            raise ValueError("source_hash_missing")
        path = Path(row["path"])
        if not path.is_file() or not 1 <= path.stat().st_size <= MAX_IMAGE_BYTES:
            raise ValueError("image_byte_budget")
        raw = path.read_bytes()
        total += len(raw)
        if total > MAX_TOTAL_BYTES or sha256(raw) != row["sha256"]:
            raise ValueError("source_hash_or_total_budget")
    controls = [row for row in rows if row.get("expected_image_type") is not None]
    if len(controls) < 3:
        raise ValueError("three_predeclared_controls_required")
    return controls + [row for row in rows if row.get("expected_image_type") is None], total


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("redirect_forbidden")


def local_request(path, payload=None, timeout=5):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(LOCAL_URL + path, data=data,
                                     headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=timeout) as response:
        body = response.read(1024 * 1024 + 1)
        if len(body) > 1024 * 1024:
            raise ValueError("response_byte_budget")
        return strict_json(body)


def validate_response(response, packet):
    if (response.get("model") != packet["model"] or response.get("done") is not True
            or response.get("done_reason") != "stop"):
        raise ValueError("incomplete_model_response")
    clock = datetime.fromisoformat(response["created_at"].replace("Z", "+00:00"))
    if clock.tzinfo is None:
        raise ValueError("response_clock_missing_zone")
    for key in ["total_duration", "load_duration", "prompt_eval_count", "eval_count"]:
        if type(response.get(key)) is not int or response[key] < 0:
            raise ValueError("response_usage")
    message = response.get("message", {})
    if message.get("role") != "assistant" or type(message.get("content")) is not str:
        raise ValueError("response_message")
    return validate_scene(message["content"], packet)


def run_assay(manifest, *, run=False, max_seconds=300, request=local_request,
              clock=time.perf_counter, record_completed=None):
    if type(max_seconds) is not int or not 1 <= max_seconds <= 300:
        raise ValueError("run_budget")
    packet = load_questionnaire()
    rows, total_bytes = validate_manifest(manifest, packet)
    summary = {"questionnaire_version": packet["version"], "questionnaire_hash": QUESTIONNAIRE_HASH,
               "requested": len(rows), "source_bytes": total_bytes, "attempted": 0,
               "schema_valid": 0, "model_calls": 0, "hosted_calls": 0,
               "model_api_spend_usd": 0, "database_writes": 0,
               "schema_validity_is_not_accuracy": True, "claims_beyond_scene_held": True,
               "classifications_are_unaccepted_testimony": True, "dry_run": not run}
    receipt = {"summary": summary, "model_digest": MODEL_DIGEST, "results": []}
    if not run:
        return receipt
    start = clock()
    models = request("/api/tags", timeout=min(5, max_seconds))["models"]
    model = next((m for m in models if m.get("name") == packet["model"]), None)
    if not model or model.get("digest") != MODEL_DIGEST:
        raise ValueError("installed_model_digest_mismatch")
    receipt["model_details"] = model.get("details")
    from PIL import Image
    for index, source in enumerate(rows):
        remaining = max_seconds - (clock() - start)
        if remaining <= 1:
            summary["stopped_reason"] = "run_budget"
            break
        raw = Path(source["path"]).read_bytes()
        if sha256(raw) != source["sha256"]:
            summary["stopped_reason"] = "source_changed"
            break
        before = clock()
        encoded = resize_image_b64(base64.b64encode(raw).decode(), max_dim=768)
        sent = base64.b64decode(encoded, validate=True)
        original_pixels = list(Image.open(io.BytesIO(raw)).size)
        sent_pixels = list(Image.open(io.BytesIO(sent)).size)
        if max(sent_pixels) > 768:
            raise ValueError("resize_contract")
        result = {"image_id": source["image_id"], "vehicle_id": source["vehicle_id"],
                  "position": source.get("position"), "source_url": source["source_url"],
                  "original_sha256": sha256(raw), "sent_sha256": sha256(sent),
                  "original_pixels": original_pixels, "sent_pixels": sent_pixels,
                  "preprocess_ms": round((clock() - before) * 1000, 3),
                  "questionnaire_version": packet["version"], "questionnaire_hash": QUESTIONNAIRE_HASH,
                  "schema_valid": False, "semantic_review": "unreviewed",
                  "request_started_at": datetime.now(timezone.utc).isoformat()}
        payload = {"model": packet["model"], "messages": [{"role": "user", "content": packet["prompt"],
                   "images": [encoded]}], "format": packet["schema"], "stream": False,
                   "options": packet["options"], "keep_alive": 0 if index == len(rows) - 1 else 30}
        remaining = max_seconds - (clock() - start)
        if remaining <= 1:
            summary["stopped_reason"] = "run_budget"
            break
        before = clock()
        summary["model_calls"] += 1
        try:
            response = request("/api/chat", payload, timeout=min(60, remaining))
            result["response"] = response
            result["parsed"] = validate_response(response, packet)
            result["schema_valid"] = True
            if source.get("expected_image_type") is not None:
                result["control_expected"] = source["expected_image_type"]
                result["control_agreement"] = result["parsed"]["image_type"] == source["expected_image_type"]
        except Exception as error:
            result["error_type"] = type(error).__name__  # No raw body/private quote logs.
        result["wall_ms"] = round((clock() - before) * 1000, 3)
        receipt["results"].append(result)
        if record_completed:
            record_completed(result)
        if not result["schema_valid"] or result.get("control_agreement") is False:
            summary["stopped_reason"] = "schema_or_control_failure"
            break
    results = receipt["results"]
    summary.update(attempted=len(results), schema_valid=sum(r["schema_valid"] for r in results),
                   elapsed_ms=round((clock() - start) * 1000, 3),
                   completed=len(results) == len(rows) and all(
                       r["schema_valid"] and r.get("control_agreement") is not False for r in results))
    warm = [r["wall_ms"] for r in results[1:] if r["schema_valid"]]
    summary["warm_p50_ms"] = statistics.median(warm) if warm else None
    summary["warm_p95_ms"] = sorted(warm)[math.ceil(len(warm) * .95) - 1] if warm else None
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--max-seconds", type=int, default=300)
    args = parser.parse_args(argv)
    if args.out.exists() or args.out.with_suffix(args.out.suffix + ".rows.jsonl").exists():
        raise ValueError("receipt_already_exists")
    manifest = strict_json(args.manifest.read_text())
    journal = None
    try:
        if args.run:
            journal = os.fdopen(os.open(args.out.with_suffix(args.out.suffix + ".rows.jsonl"),
                                os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w")
        def completed(row):
            journal.write(json.dumps(row) + "\n")
            journal.flush()
        result = run_assay(manifest, run=args.run, max_seconds=args.max_seconds,
                           record_completed=completed if journal else None)
        with os.fdopen(os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
            json.dump(result, output, indent=2)
        print(json.dumps(result["summary"], indent=2))
        return 0 if not args.run or result["summary"].get("completed") else 1
    finally:
        if journal:
            journal.close()


if __name__ == "__main__":
    raise SystemExit(main())
