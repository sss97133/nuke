#!/usr/bin/env python3
"""
Organize a PhotosExport tree into vehicle-profile folders using local YONO.

Non-destructive:
  - Leaves originals in place
  - Creates symlinks into an organizing root (reversible)
  - Writes a CSV report of all actions

How it works:
  - Scans /Volumes/NukePortable/PhotosExport/YYYY/YYYY-MM/*
  - For each image (HEIC/JPEG/PNG), calls YONO sidecar using file:// URLs
    - POST /classify (make + is_vehicle)
    - POST /analyze  (zone + condition + flags)
  - If it looks like a vehicle, symlinks into:
      <dest_root>/<make>/<zone>/<YYYY>/<YYYY-MM>/<filename>

Usage:
  python3 nuke/scripts/yono-organize-photoexport.py \
    --source "/Volumes/NukePortable/PhotosExport" \
    --dest "/Volumes/NukePortable/VehicleProfiles" \
    --sidecar "http://127.0.0.1:8472" \
    --dry-run

Tip: Start the sidecar first:
  /Users/skylar/nuke/scripts/yono-server-start.sh
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


IMAGE_EXTS = {".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}


def _http_json(url: str, payload: dict[str, Any], timeout_s: int = 180) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def _http_get_json(url: str, timeout_s: int = 30) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout_s) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def _sanitize_component(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return "Unknown"
    bad = '<>:"/\\|?*'
    for ch in bad:
        s = s.replace(ch, "_")
    return s.strip(" .") or "Unknown"


@dataclass(frozen=True)
class YonoDecision:
    is_vehicle: bool
    make: str
    make_confidence: float
    zone: Optional[str]
    zone_confidence: Optional[float]
    condition_score: Optional[int]
    fabrication_stage: Optional[str]
    stage_confidence: Optional[float]


def _yono_decide(sidecar: str, file_path: Path, min_make_conf: float) -> YonoDecision:
    file_url = file_path.resolve().as_uri()

    cls = _http_json(f"{sidecar}/classify", {"image_url": file_url, "top_k": 5}, timeout_s=180)
    make = cls.get("make") or "Unknown"
    make_conf = float(cls.get("confidence") or 0.0)
    is_vehicle = bool(cls.get("is_vehicle")) and make_conf >= min_make_conf

    if not is_vehicle:
        return YonoDecision(
            is_vehicle=False,
            make=_sanitize_component(make),
            make_confidence=make_conf,
            zone=None,
            zone_confidence=None,
            condition_score=None,
            fabrication_stage=None,
            stage_confidence=None,
        )

    # Analyze can be heavier (loads Florence-2). If it fails, keep make-only results
    # and route into unknown_zone so the organizer can still proceed.
    zone = None
    zone_conf = None
    cond = None
    stage = None
    stage_conf = None
    try:
        ana = _http_json(f"{sidecar}/analyze", {"image_url": file_url}, timeout_s=180)
        zone = ana.get("vehicle_zone")
        zone_conf = ana.get("zone_confidence")
        cond = ana.get("condition_score")
        stage = ana.get("fabrication_stage")
        stage_conf = ana.get("stage_confidence")
    except Exception:
        pass

    return YonoDecision(
        is_vehicle=True,
        make=_sanitize_component(make),
        make_confidence=make_conf,
        zone=_sanitize_component(zone) if zone else None,
        zone_confidence=float(zone_conf) if zone_conf is not None else None,
        condition_score=int(cond) if cond is not None else None,
        fabrication_stage=_sanitize_component(stage) if stage else None,
        stage_confidence=float(stage_conf) if stage_conf is not None else None,
    )


def _iter_images(source_root: Path) -> list[Path]:
    out: list[Path] = []
    for root, _dirs, files in os.walk(source_root):
        for name in files:
            p = Path(root) / name
            if p.suffix.lower() in IMAGE_EXTS:
                out.append(p)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="PhotosExport root (e.g. /Volumes/NukePortable/PhotosExport)")
    ap.add_argument("--dest", required=True, help="VehicleProfiles root (e.g. /Volumes/NukePortable/VehicleProfiles)")
    ap.add_argument("--sidecar", default="http://127.0.0.1:8472", help="YONO sidecar base URL")
    ap.add_argument("--min-make-confidence", type=float, default=0.35, help="Minimum make confidence to treat as vehicle")
    ap.add_argument("--limit", type=int, default=0, help="Process at most N images (0 = no limit)")
    ap.add_argument("--dry-run", action="store_true", help="Do not write symlinks, only report decisions")
    args = ap.parse_args()

    source_root = Path(args.source).expanduser()
    dest_root = Path(args.dest).expanduser()
    sidecar = args.sidecar.rstrip("/")

    if not source_root.exists():
        print(f"Source not found: {source_root}", file=sys.stderr)
        return 2

    try:
        health = _http_get_json(f"{sidecar}/health", timeout_s=10)
    except Exception as e:
        print(f"Sidecar not reachable at {sidecar}: {e}", file=sys.stderr)
        return 2

    if health.get("status") not in ("ok", "loading"):
        print(f"Unexpected sidecar health: {health}", file=sys.stderr)
        return 2

    images = _iter_images(source_root)
    images.sort()

    if args.limit and args.limit > 0:
        images = images[: args.limit]

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_dir = dest_root / "_reports"
    report_path = report_dir / f"yono_organize_{ts}.csv"

    # Always write a report (even in dry-run) so we can audit errors and decisions.
    report_dir.mkdir(parents=True, exist_ok=True)
    if not args.dry_run:
        dest_root.mkdir(parents=True, exist_ok=True)

    classified = 0
    linked = 0
    skipped = 0
    errors = 0

    t0 = time.time()

    def rel_year_month(p: Path) -> tuple[str, str]:
        # Expect .../<YYYY>/<YYYY-MM>/<filename>
        try:
            month = p.parent.name
            year = p.parent.parent.name
            if len(year) == 4 and month.startswith(year + "-"):
                return year, month
        except Exception:
            pass
        return "unknown", "unknown"

    with open(report_path, "w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "source_path",
                "source_file_url",
                "is_vehicle",
                "make",
                "make_confidence",
                "zone",
                "zone_confidence",
                "condition_score",
                "fabrication_stage",
                "stage_confidence",
                "dest_link_path",
                "action",
                "error",
            ],
        )
        writer.writeheader()

        for idx, img in enumerate(images, start=1):
            if idx % 100 == 0:
                elapsed = time.time() - t0
                rate = idx / max(1e-6, elapsed)
                print(f"Progress {idx}/{len(images)} ({rate:.1f} imgs/s) linked={linked} skipped={skipped} errors={errors}")

            try:
                decision = _yono_decide(sidecar, img, min_make_conf=args.min_make_confidence)
                classified += 1

                year, month = rel_year_month(img)
                make = decision.make
                zone = decision.zone or "unknown_zone"

                dest_link = (
                    dest_root
                    / make
                    / zone
                    / year
                    / month
                    / img.name
                )

                action = "skip_non_vehicle"
                if decision.is_vehicle:
                    action = "would_link" if args.dry_run else "link"
                    if not args.dry_run:
                        dest_link.parent.mkdir(parents=True, exist_ok=True)
                        if dest_link.exists():
                            action = "exists"
                        else:
                            dest_link.symlink_to(img)
                            linked += 1
                    else:
                        skipped += 1
                else:
                    skipped += 1

                writer.writerow(
                    {
                        "source_path": str(img),
                        "source_file_url": img.resolve().as_uri(),
                        "is_vehicle": decision.is_vehicle,
                        "make": decision.make,
                        "make_confidence": f"{decision.make_confidence:.4f}",
                        "zone": decision.zone or "",
                        "zone_confidence": f"{decision.zone_confidence:.4f}" if decision.zone_confidence is not None else "",
                        "condition_score": decision.condition_score if decision.condition_score is not None else "",
                        "fabrication_stage": decision.fabrication_stage or "",
                        "stage_confidence": f"{decision.stage_confidence:.4f}" if decision.stage_confidence is not None else "",
                        "dest_link_path": str(dest_link),
                        "action": action,
                        "error": "",
                    }
                )

            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as e:
                errors += 1
                writer.writerow(
                    {
                        "source_path": str(img),
                        "source_file_url": img.resolve().as_uri(),
                        "is_vehicle": "",
                        "make": "",
                        "make_confidence": "",
                        "zone": "",
                        "zone_confidence": "",
                        "condition_score": "",
                        "fabrication_stage": "",
                        "stage_confidence": "",
                        "dest_link_path": "",
                        "action": "error",
                        "error": str(e),
                    }
                )
            except Exception as e:
                errors += 1
                writer.writerow(
                    {
                        "source_path": str(img),
                        "source_file_url": img.resolve().as_uri(),
                        "is_vehicle": "",
                        "make": "",
                        "make_confidence": "",
                        "zone": "",
                        "zone_confidence": "",
                        "condition_score": "",
                        "fabrication_stage": "",
                        "stage_confidence": "",
                        "dest_link_path": "",
                        "action": "error",
                        "error": f"{type(e).__name__}: {e}",
                    }
                )

    elapsed = time.time() - t0
    print(f"Done in {elapsed:.1f}s. classified={classified} linked={linked} skipped={skipped} errors={errors}")
    if args.dry_run:
        print("Dry-run: no symlinks written.")
        print(f"Report: {report_path}")
    else:
        print(f"Report: {report_path}")
        print(f"Vehicle profiles root: {dest_root}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

