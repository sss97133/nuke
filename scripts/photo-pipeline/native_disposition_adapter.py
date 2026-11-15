#!/usr/bin/env python3
"""Convert the existing LibraryCandidateDiscovery JSON replay into a held source manifest.

This reads metadata only. It does not invent original bytes, filing, privacy decisions or videos.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from source_disposition import build, digest, require


def adapt(native_input, native_output, *, snapshot_id, observed_at, source_namespace,
          access_scope, videos_outside_selector, input_bytes, source_snapshot=None, retained_disposition=None):
    require(json.loads(input_bytes) == native_input, "native parsed input differs from frozen bytes")
    require(native_output.get("inputSha256") == hashlib.sha256(input_bytes).hexdigest(),
            "native output input fingerprint missing or changed; replay discovery on exact input")
    assets = native_input.get("assets")
    require(isinstance(assets, list), "native input assets required")
    require(native_output.get("mediaScope") == "images_only", "native output must declare image-only scope")
    require(native_output.get("sourceImages") == len(assets), "native input/output source count mismatch")
    require(isinstance(videos_outside_selector, int) and videos_outside_selector >= 0,
            "videos outside selector must be a nonnegative count")
    versions = {asset["id"]: asset.get("sourceVersion") for asset in assets}
    require(len(versions) == len(assets), "native input has duplicate source IDs")
    unplaced = native_output.get("unplaced")
    require(isinstance(unplaced, list), "native full-source controls required")
    controls = {item["id"]: item.get("reasons", []) for item in unplaced}
    require(len(controls) == len(unplaced) and set(controls) == set(versions),
            "native full-source controls do not cover snapshot")
    assets = [{**asset, "sourceVersion": asset.get("sourceVersion"),
               "discoveryControls": controls[asset["id"]]} for asset in assets]
    candidates = native_output.get("candidates")
    require(isinstance(candidates, list), "native output candidates required")
    bound = []
    for candidate in candidates:
        sid = candidate.get("id")
        require(sid in versions, "native candidate outside source snapshot")
        bound.append({"id": sid, "sourceVersion": versions[sid],
                      "reasons": candidate.get("reasons", [])})
    snapshot = {"snapshotId": snapshot_id, "sourceNamespace": source_namespace,
                "nativeInputSha256": native_output["inputSha256"],
                "observedAt": observed_at, "accessScope": access_scope,
                "declaredAssetCount": len(assets),
                "mediaCoverage": {"imagesEnumerated": True, "videosEnumerated": False,
                                  "knownVideosOutsideSelector": videos_outside_selector},
                "assets": assets}
    if source_snapshot is not None:
        original = source_snapshot.get("snapshot", {})
        require(original.get("sourceScope") == "local_photos_database", "unsupported source snapshot scope")
        require(all(original.get(key) == snapshot[key] for key in
                    ("snapshotId", "sourceNamespace", "observedAt", "accessScope")),
                "source snapshot identity or scope differs")
        original_assets = original.get("assets", [])
        images = [a for a in original_assets if a.get("mediaKind") == "image"]
        require(images == native_input["assets"], "native input differs from exact source snapshot images")
        require(original.get("mediaCoverage", {}).get("knownVideosOutsideSelector") == videos_outside_selector,
                "source snapshot video coverage differs")
        # Videos remain in the source denominator even though the existing
        # native selector only retrieves images. No source facts are invented.
        snapshot = {**original, "nativeInputSha256": native_output["inputSha256"],
                    "assets": [{**a, "discoveryControls": controls.get(a["id"], [])} for a in original_assets]}
    document = {"schemaVersion": 1, "intendedUse": "vehicle_gallery", "snapshot": snapshot,
                "candidates": bound, "sourceFacts": source_snapshot.get("sourceFacts", {}) if source_snapshot else {},
                "priorSourceIds": []}
    if retained_disposition is not None:
        retained = {k: v for k, v in retained_disposition.items() if k != "manifestSha256"}
        require(retained_disposition.get("manifestSha256") == digest(retained), "retained disposition fingerprint changed")
        require(retained.get("sourceScope") == "retained_capture" and retained.get("sourceProposals") == [],
                "retained disposition must be a non-admitting retained capture readback")
        by_uuid = {a["id"].lower(): a["id"] for a in snapshot["assets"]}
        references = {}
        for row in retained.get("rows", []):
            sid = by_uuid.get(row["sourceId"].lower())
            if sid and row.get("existingLeafImageId"):
                references.setdefault(sid, []).append({
                    "relation": "same_asset_uuid_candidate", "currentSourceVersionVerified": False,
                    "sourceNamespace": retained["sourceNamespace"], "sourceVersion": row["sourceVersion"],
                    "imageId": row["existingLeafImageId"], "retainedDisposition": row["disposition"],
                    "observedAt": retained.get("observedAt"), "manifestSha256": retained_disposition["manifestSha256"]})
        # These references keep already retained evidence discoverable without
        # rebinding its version, proving local-library ownership or filing a source.
        document["retainedCaptureReferences"] = references
    return document, build(document)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native_input", type=Path)
    parser.add_argument("native_output", type=Path)
    parser.add_argument("manifest_output", type=Path)
    parser.add_argument("--source-snapshot", type=Path, help="exact local metadata snapshot from iphoto-census")
    parser.add_argument("--retained-disposition", type=Path, help="optional frozen retained-capture readback; UUID links are candidates only")
    parser.add_argument("--snapshot-id")
    parser.add_argument("--observed-at", help="time the source export was observed, supplied by its exporter")
    parser.add_argument("--source-namespace", help="stable owner library/device namespace")
    parser.add_argument("--access-scope", choices=("full", "limited", "sample"))
    parser.add_argument("--videos-outside-selector", type=int)
    parser.add_argument("--input-output", type=Path, help="save the exact intermediate frozen input privately")
    args = parser.parse_args()
    try:
        input_bytes = args.native_input.read_bytes()
        native_input = json.loads(input_bytes)
        native_output = json.loads(args.native_output.read_text(encoding="utf-8"))
        source = json.loads(args.source_snapshot.read_text()) if args.source_snapshot else None
        meta = source.get("snapshot", {}) if source else {}
        videos = args.videos_outside_selector if args.videos_outside_selector is not None else meta.get("mediaCoverage", {}).get("knownVideosOutsideSelector")
        document, result = adapt(native_input, native_output, snapshot_id=args.snapshot_id or meta.get("snapshotId"),
                                 observed_at=args.observed_at or meta.get("observedAt"),
                                 source_namespace=args.source_namespace or meta.get("sourceNamespace"),
                                 access_scope=args.access_scope or meta.get("accessScope"),
                                 videos_outside_selector=videos, input_bytes=input_bytes, source_snapshot=source,
                                 retained_disposition=json.loads(args.retained_disposition.read_text()) if args.retained_disposition else None)
        if args.input_output:
            args.input_output.write_text(json.dumps(document, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        args.manifest_output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"native disposition adapter: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
