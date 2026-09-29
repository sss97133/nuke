#!/usr/bin/env python3
"""Where each box goes: catalog/mounts.yaml -> nuke_frontend/public/wiring/k5-mounts.json.

The wiring map's WHERE EACH BOX GOES panel reads the JSON. The build fails when a reason has no
source, a status is outside the set, or a flagged/open box doesn't say what's open or what else it could be.
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
STATUSES = {"decided", "proposed", "open", "flag"}


def lint(boxes):
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
        if b.get("status") not in STATUSES:
            errors.append(f"{bid}: status {b.get('status')!r} not in {sorted(STATUSES)}")
        if not b.get("why"):
            errors.append(f"{bid}: no reasons")
        for i, w in enumerate(b.get("why") or []):
            if not (w.get("text") and w.get("source")):
                errors.append(f"{bid}: reason {i + 1} has no text or no source")
        if b.get("status") in ("flag", "open") and not (b.get("open") or b.get("instead")):
            errors.append(f"{bid}: {b['status']} box must say what is open or what else it could be")
    return errors


def main():
    data = yaml.safe_load(SRC.read_text())
    boxes = data.get("boxes") or []
    errors = lint(boxes)
    if errors:
        print("mounts lint FAILED:\n  " + "\n  ".join(errors))
        sys.exit(1)
    out = {
        "vehicle_id": "e08bf694-970f-4cbe-8a74-8715158a0f2e",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source": "docs/wiring/calc-data/catalog/mounts.yaml",
        "boxes": boxes,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    counts = {s: sum(1 for b in boxes if b["status"] == s) for s in sorted(STATUSES)}
    print(f"{len(boxes)} boxes -> {OUT.relative_to(REPO)} {counts}")


if __name__ == "__main__":
    main()
