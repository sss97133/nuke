#!/usr/bin/env python3
"""Where each box goes, and where each end is: catalog/mounts.yaml -> nuke_frontend/public/wiring/k5-mounts.json.

The wiring map's WHERE EACH BOX GOES panel reads `boxes`. `ends` has one entry per registry endpoint
(keyed by its id, the map's node code) saying where on the truck that end is. The build fails when a
reason has no source, a status is outside the set, a flagged/open entry doesn't say what's open (or what
else it could be), an end's id is not a registry endpoint, or an end follows a box that doesn't exist.
Run: python3 docs/wiring/calc-data/mounts_v5.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SRC = HERE / "catalog" / "mounts.yaml"
OUT = REPO / "nuke_frontend" / "public" / "wiring" / "k5-mounts.json"
REGISTRY = HERE / "k5_registry.json"
STATUSES = {"decided", "proposed", "open", "flag"}
# ends add fixed_by_engine: the LS3, transmission or transfer case has one place the part fits
END_STATUSES = {"fixed_by_engine", "decided", "proposed", "open", "flag"}


def lint(boxes, statuses=STATUSES, kind="box"):
    errors = []
    seen = set()
    for b in boxes:
        bid = b.get("id") or "?"
        if bid in seen:
            errors.append(f"{bid}: duplicate id")
        seen.add(bid)
        for key in ("what", "where", "zone", "status"):
            if not b.get(key):
                errors.append(f"{bid}: missing {key}")
        if b.get("status") not in statuses:
            errors.append(f"{bid}: status {b.get('status')!r} not in {sorted(statuses)}")
        if not b.get("why"):
            errors.append(f"{bid}: no reasons")
        for i, w in enumerate(b.get("why") or []):
            if not (w.get("text") and w.get("source")):
                errors.append(f"{bid}: reason {i + 1} has no text or no source")
        if b.get("status") in ("flag", "open") and not (b.get("open") or b.get("instead")):
            errors.append(f"{bid}: {b['status']} {kind} must say what is open or what else it could be")
    return errors


def lint_ends(ends, boxes):
    errors = lint(ends, END_STATUSES, "end")
    live = set(json.loads(REGISTRY.read_text())["endpoints"]) if REGISTRY.exists() else None
    box_ids = {b.get("id") for b in boxes}
    for e in ends:
        eid = e.get("id") or "?"
        if live is not None and eid not in live:
            errors.append(f"{eid}: not a registry endpoint (k5_registry.json)")
        if e.get("follows") and e["follows"] not in box_ids and (live is None or e["follows"] not in live):
            errors.append(f"{eid}: follows {e['follows']!r}, which is neither a box nor an endpoint")
    missing = sorted(live - {e.get("id") for e in ends}) if live is not None else []
    return errors, missing


def main():
    data = yaml.safe_load(SRC.read_text())
    boxes = data.get("boxes") or []
    ends = data.get("ends") or []
    errors = lint(boxes)
    end_errors, missing = lint_ends(ends, boxes)
    errors += end_errors
    if errors:
        print("mounts lint FAILED:\n  " + "\n  ".join(errors))
        sys.exit(1)
    out = {
        "vehicle_id": "e08bf694-970f-4cbe-8a74-8715158a0f2e",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source": "docs/wiring/calc-data/catalog/mounts.yaml",
        "boxes": boxes,
        "ends": {e["id"]: e for e in ends},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    counts = {s: sum(1 for b in boxes if b["status"] == s) for s in sorted(STATUSES)}
    end_counts = {s: sum(1 for e in ends if e["status"] == s) for s in sorted(END_STATUSES)}
    print(f"{len(boxes)} boxes -> {OUT.relative_to(REPO)} {counts}")
    print(f"{len(ends)} ends {end_counts}")
    if missing:
        print(f"WARNING: {len(missing)} registry endpoints have no end yet: {', '.join(missing)}")


if __name__ == "__main__":
    main()
