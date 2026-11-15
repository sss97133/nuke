#!/usr/bin/env python3
"""Convert the existing LibraryCandidateDiscovery JSON replay into a held source manifest.

This reads metadata only. It does not invent original bytes, filing, privacy decisions or videos.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

from source_disposition import build, require


def adapt(native_input, native_output, *, snapshot_id, observed_at, source_namespace,
          access_scope, videos_outside_selector, input_bytes):
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
    document = {"schemaVersion": 1, "intendedUse": "vehicle_gallery", "snapshot": snapshot,
                "candidates": bound, "sourceFacts": {}, "priorSourceIds": []}
    return document, build(document)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("native_input", type=Path)
    parser.add_argument("native_output", type=Path)
    parser.add_argument("manifest_output", type=Path)
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--observed-at", required=True, help="time the source export was observed, supplied by its exporter")
    parser.add_argument("--source-namespace", required=True, help="stable owner library/device namespace")
    parser.add_argument("--access-scope", choices=("full", "limited", "sample"), required=True)
    parser.add_argument("--videos-outside-selector", type=int, required=True)
    parser.add_argument("--input-output", type=Path, help="save the exact intermediate frozen input privately")
    args = parser.parse_args()
    try:
        input_bytes = args.native_input.read_bytes()
        native_input = json.loads(input_bytes)
        native_output = json.loads(args.native_output.read_text(encoding="utf-8"))
        document, result = adapt(native_input, native_output, snapshot_id=args.snapshot_id,
                                 observed_at=args.observed_at, source_namespace=args.source_namespace,
                                 access_scope=args.access_scope,
                                 videos_outside_selector=args.videos_outside_selector, input_bytes=input_bytes)
        if args.input_output:
            args.input_output.write_text(json.dumps(document, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        args.manifest_output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"native disposition adapter: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
