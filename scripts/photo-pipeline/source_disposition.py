#!/usr/bin/env python3
"""Offline, source-scoped bridge from a frozen Photos snapshot to admission proposals.

No Photos access, network, model, upload, or vehicle filing. Input/output are JSON.
The input asset shape is LibraryCandidateDiscovery.Asset's Codable shape.
"""

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter

HEX64 = re.compile(r"^[0-9a-f]{64}$")
KINDS = {"image", "video", "screenshot"}
FILING = {"none", "partial", "disputed", "supported_complete"}
NEXT = {
    "unsupported_video": ["video_source_reader"],
    "privacy_hold": ["source_privacy_review"],
    "identity_ambiguous": ["exact_source_leaf_reconciliation"],
    "disputed": ["source_bound_relationship_decision"],
    "supported_complete": [],
    "admitted_unresolved": ["source_bound_relationship_review"],
    "original_unverified": ["current_original_byte_read"],
    "version_unverified": ["current_source_version"],
    "source_unavailable": ["source_original_availability"],
    "partial": ["complete_or_dispute_filing"],
    "candidate_unreviewed": ["explicit_source_selection"],
    "unselected_source": ["explicit_source_selection"],
    "ready_source_admission": ["existing_identity_first_intake_and_readback"],
    "withdrawn": ["new_permission_snapshot"],
}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(value):
    return isinstance(value, str) and bool(HEX64.fullmatch(value))


def source_key(asset):
    return (asset["id"], asset["sourceVersion"])


def build(document):
    require(document.get("schemaVersion") == 1, "schemaVersion must be 1")
    intended_use = document.get("intendedUse")
    require(isinstance(intended_use, str) and intended_use, "intendedUse is required")
    snapshot = document.get("snapshot")
    require(isinstance(snapshot, dict), "snapshot is required")
    require(isinstance(snapshot.get("snapshotId"), str) and snapshot["snapshotId"], "snapshotId is required")
    require(isinstance(snapshot.get("sourceNamespace"), str) and snapshot["sourceNamespace"],
            "sourceNamespace is required")
    require(snapshot.get("accessScope") in ("full", "limited", "sample"), "accessScope must be explicit")
    require(isinstance(snapshot.get("observedAt"), str) and snapshot["observedAt"], "observedAt is required")
    assets = snapshot.get("assets")
    require(isinstance(assets, list), "assets must be an array")
    coverage = snapshot.get("mediaCoverage")
    require(isinstance(coverage, dict) and isinstance(coverage.get("imagesEnumerated"), bool)
            and isinstance(coverage.get("videosEnumerated"), bool), "mediaCoverage must declare image/video enumeration")
    require(isinstance(coverage.get("knownVideosOutsideSelector"), int)
            and coverage["knownVideosOutsideSelector"] >= 0, "knownVideosOutsideSelector must be a count")
    declared = snapshot.get("declaredAssetCount")
    require(type(declared) is int and declared == len(assets), "declaredAssetCount differs from assets")

    seen = set()
    seen_ids = set()
    for asset in assets:
        require(isinstance(asset, dict), "each asset must be an object")
        require(isinstance(asset.get("id"), str) and asset["id"], "asset id is required")
        require("sourceVersion" in asset and (asset["sourceVersion"] is None or
                isinstance(asset["sourceVersion"], str) and bool(asset["sourceVersion"])),
                "sourceVersion must be a nonempty string or null")
        require(asset.get("mediaKind", "image") in KINDS, "unsupported mediaKind")
        key = source_key(asset)
        require(key not in seen, "duplicate source id/version")
        require(key[0] not in seen_ids, "same source id appears twice in one snapshot")
        seen.add(key)
        seen_ids.add(key[0])
    frozen = {**snapshot, "assets": sorted(assets, key=source_key)}
    snapshot_hash = digest(frozen)
    if "expectedSnapshotSha256" in document:
        require(document["expectedSnapshotSha256"] == snapshot_hash, "snapshot hash mismatch")

    candidates = document.get("candidates", [])
    require(isinstance(candidates, list), "candidates must be an array")
    versions_by_id = {asset["id"]: asset["sourceVersion"] for asset in assets}
    candidate_by_id = {}
    for candidate in candidates:
        require(isinstance(candidate, dict) and isinstance(candidate.get("id"), str), "candidate id required")
        require(candidate["id"] not in candidate_by_id, "duplicate candidate id")
        require(isinstance(candidate.get("reasons", []), list), "candidate reasons must be an array")
        require(candidate["id"] in versions_by_id and candidate.get("sourceVersion") == versions_by_id[candidate["id"]],
                "candidate source version mismatch")
        candidate_by_id[candidate["id"]] = candidate

    facts = document.get("sourceFacts", {})
    require(isinstance(facts, dict) and set(facts).issubset({a["id"] for a in assets}), "sourceFacts outside snapshot")
    prior = document.get("priorSourceIds", [])
    require(isinstance(prior, list) and len(prior) == len(set(prior)), "priorSourceIds must be unique")
    require(all(isinstance(x, str) and x for x in prior), "priorSourceIds must be strings")
    withdrawn = document.get("withdrawnSources", [])
    require(isinstance(withdrawn, list), "withdrawnSources must be an array")
    current_ids = {a["id"] for a in assets}
    withdrawn_by_id = {}
    for item in withdrawn:
        require(isinstance(item, dict) and isinstance(item.get("id"), str)
                and isinstance(item.get("evidenceId"), str) and item["evidenceId"]
                and item.get("kind") == "photokit_removed_from_permission_scope"
                and item.get("sourceNamespace") == snapshot["sourceNamespace"],
                "withdrawal requires source-bound PhotoKit removal evidence")
        require(item["id"] not in current_ids and item["id"] not in withdrawn_by_id,
                "withdrawn source is current or duplicated")
        withdrawn_by_id[item["id"]] = item

    rows, proposals = [], []
    for asset in frozen["assets"]:
        sid, version = source_key(asset)
        fact = facts.get(sid, {})
        require(isinstance(fact, dict), "source fact must be an object")
        require(not fact or fact.get("sourceVersion") == version, "source fact version mismatch")
        kind = asset.get("mediaKind", "image")
        gps = (asset.get("latitude"), asset.get("longitude"))
        has_gps = (type(gps[0]) in (int, float) and math.isfinite(gps[0]) and -90 <= gps[0] <= 90
                   and type(gps[1]) in (int, float) and math.isfinite(gps[1]) and -180 < gps[1] <= 180)
        original = fact.get("original")
        rendition = fact.get("rendition")
        leaf = fact.get("existingLeaf")
        filing = fact.get("filing", {"status": "none"})
        privacy = fact.get("privacy", {"status": "unknown"})
        media_policy = fact.get("mediaPolicy", {"status": "unknown"})
        selected = fact.get("selectedForAdmission") is True
        require(isinstance(filing, dict) and filing.get("status", "none") in FILING, "invalid filing status")
        require(isinstance(privacy, dict) and privacy.get("status", "unknown") in ("unknown", "clear", "hold"), "invalid privacy status")
        require(isinstance(media_policy, dict) and media_policy.get("status", "unknown") in ("unknown", "clear", "hold"), "invalid media policy")
        for name, item in (("original", original), ("rendition", rendition)):
            if item is not None:
                require(isinstance(item, dict) and item.get("sourceVersion") == version
                        and sha(item.get("sha256")) and type(item.get("byteSize")) is int
                        and item["byteSize"] > 0 and isinstance(item.get("mimeType"), str)
                        and item["mimeType"].startswith("image/"),
                        f"{name} requires current sourceVersion, SHA-256, byteSize and image MIME")
        exact_leaf = False
        if leaf is not None:
            require(isinstance(leaf, dict) and isinstance(leaf.get("imageId"), str)
                    and leaf["imageId"] and sha(leaf.get("sha256")), "existingLeaf requires imageId and SHA-256")
            source_bytes = original if leaf.get("byteRole") == "original" else rendition if leaf.get("byteRole") == "rendition" else None
            exact_leaf = bool(source_bytes and leaf.get("sourceNamespace") == snapshot["sourceNamespace"]
                              and leaf.get("sourceId") == sid and leaf.get("sourceVersion") == version
                              and leaf["sha256"] == source_bytes["sha256"]
                              and leaf.get("visibility") == "current" and leaf.get("isSuperseded") is False
                              and "supersededBy" in leaf and leaf["supersededBy"] is None
                              and isinstance(leaf.get("sourceBindingId"), str) and leaf["sourceBindingId"])
        filing_status = filing.get("status", "none")
        filing_current = filing.get("sourceVersion") == version
        privacy_clear = (privacy.get("status") == "clear" and privacy.get("sourceVersion") == version
                         and privacy.get("intendedUse") == intended_use
                         and isinstance(privacy.get("decisionId"), str) and bool(privacy["decisionId"]))
        media_clear = (media_policy.get("status") == "clear" and media_policy.get("sourceVersion") == version
                       and media_policy.get("intendedUse") == intended_use
                       and isinstance(media_policy.get("decisionId"), str) and bool(media_policy["decisionId"]))
        personal_control = asset.get("isPersonal") is True or "personal_review" in candidate_by_id.get(sid, {}).get("reasons", [])
        sensitive_media = kind == "screenshot" or personal_control
        complete_filing = (kind != "video" and version is not None and
                           filing_status == "supported_complete" and filing_current and exact_leaf
                           and privacy_clear and (not sensitive_media or media_clear)
                           and filing.get("sourceNamespace") == snapshot["sourceNamespace"]
                           and filing.get("sourceId") == sid and filing.get("imageId") == leaf.get("imageId")
                           and isinstance(filing.get("decisionId"), str) and bool(filing["decisionId"])
                           and isinstance(filing.get("witnessId"), str) and bool(filing["witnessId"])
                           and filing.get("intendedUse") == intended_use)
        reasons = []
        if kind == "video":
            disposition = "unsupported_video"
            reasons.append("video_outside_image_admission")
        elif sensitive_media and not media_clear:
            disposition = "privacy_hold"
            reasons.append("sensitive_media_requires_current_policy_decision")
        elif version is None:
            disposition = "version_unverified"
            reasons.append("current_source_version_unavailable")
        elif leaf is not None and not exact_leaf:
            disposition = "identity_ambiguous"
            reasons.append("existing_leaf_not_exact_source_bytes")
        elif filing_status == "supported_complete" and not privacy_clear:
            disposition = "privacy_hold"
            reasons.append("complete_filing_privacy_not_current_clear")
        elif filing_status == "disputed" or (filing_status == "supported_complete" and not complete_filing):
            disposition = "disputed"
            reasons.append("complete_filing_proof_missing_or_disputed")
        elif complete_filing:
            disposition = "supported_complete"
        elif exact_leaf:
            disposition = "admitted_unresolved"
            reasons.append("no_complete_current_filing")
        elif not original:
            disposition = "source_unavailable" if fact.get("originalStatus") == "unavailable" else "original_unverified"
            reasons.append("current_original_unavailable" if disposition == "source_unavailable"
                           else "current_original_bytes_not_supplied")
        elif filing_status == "partial":
            disposition = "partial"
            reasons.append("partial_filing_requires_review")
        elif not privacy_clear:
            disposition = "privacy_hold"
            reasons.append("privacy_not_current_clear")
        elif not selected:
            disposition = "candidate_unreviewed" if sid in candidate_by_id else "unselected_source"
            reasons.append("no_explicit_admission_selection")
        else:
            disposition = "ready_source_admission"
            proposal = {"sourceNamespace": snapshot["sourceNamespace"], "sourceId": sid, "sourceVersion": version,
                        "intendedUse": intended_use,
                        "sourceSha256": original["sha256"], "byteSize": original["byteSize"],
                        "mimeType": original["mimeType"],
                        "mediaKind": kind, "captureAt": asset.get("captureAt"),
                        "captureClockBasis": asset.get("captureClockBasis"),
                        "vehicleId": None, "writer": "ingest_image_identity_first"}
            proposals.append(proposal)
        if not has_gps:
            reasons.append("missing_gps_context_only")
        if sid in candidate_by_id:
            reasons.append("discovery_candidate_not_filing")
        rows.append({"sourceId": sid, "sourceVersion": version, "mediaKind": kind,
                     "captureAt": asset.get("captureAt"), "hasGPS": has_gps,
                     "candidateReasons": sorted(set(candidate_by_id.get(sid, {}).get("reasons", []))),
                     "recordedFilingStatus": filing_status if filing_current else "unverified",
                     "qualifiedCompleteFiling": bool(complete_filing),
                     "originalSha256": original["sha256"] if original else None,
                     "renditionSha256": rendition["sha256"] if rendition else None,
                     "existingLeafImageId": leaf["imageId"] if exact_leaf else None,
                     "sourceFactSha256": digest(fact),
                     "privacyDecisionId": privacy.get("decisionId"),
                     "mediaPolicyDecisionId": media_policy.get("decisionId"),
                     "filingDecisionId": filing.get("decisionId"),
                     "filingWitnessId": filing.get("witnessId"),
                     "disposition": disposition, "reasons": sorted(set(reasons)),
                     "requiredNext": NEXT[disposition]})
    for sid, withdrawal in sorted(withdrawn_by_id.items()):
        rows.append({"sourceId": sid, "sourceVersion": None, "mediaKind": None,
                     "captureAt": None, "hasGPS": False, "candidateReasons": [],
                     "recordedFilingStatus": "unverified", "qualifiedCompleteFiling": False,
                     "originalSha256": None, "renditionSha256": None,
                     "existingLeafImageId": None, "disposition": "withdrawn",
                     "sourceFactSha256": digest(withdrawal), "withdrawalEvidenceId": withdrawal["evidenceId"],
                     "reasons": ["not_in_current_permission_snapshot"],
                     "requiredNext": NEXT["withdrawn"]})
    rows.sort(key=lambda r: r["sourceId"])
    proposals.sort(key=lambda p: p["sourceId"])
    counts = dict(sorted(Counter(row["disposition"] for row in rows).items()))
    result = {"schemaVersion": 1, "snapshotId": snapshot["snapshotId"], "intendedUse": intended_use,
              "sourceNamespace": snapshot["sourceNamespace"],
              "snapshotSha256": snapshot_hash, "accessScope": snapshot["accessScope"],
              "mediaCoverage": coverage, "counts": counts, "rows": rows, "sourceProposals": proposals,
              "priorAbsenceUnknown": sorted(set(prior) - current_ids - set(withdrawn_by_id))}
    result["manifestSha256"] = digest(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="private frozen snapshot JSON")
    parser.add_argument("output", help="private output manifest JSON")
    args = parser.parse_args()
    try:
        with open(args.input, encoding="utf-8") as stream:
            result = build(json.load(stream))
        with open(args.output, "w", encoding="utf-8") as stream:
            json.dump(result, stream, sort_keys=True, indent=2)
            stream.write("\n")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"source disposition: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
