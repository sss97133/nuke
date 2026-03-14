#!/usr/bin/env python3
"""
Sync YONO organize report (CSV) to Supabase: create vehicles with
profile_origin = 'local_photos' and upload images to Storage + vehicle_images.

All data originates from the user's photos. Requires SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, and USER_ID (or --user-id).

Usage:
  python3 nuke/scripts/sync-photos-to-supabase.py \\
    --report "/Volumes/NukePortable/VehicleProfiles/_reports/yono_organize_20250101-120000.csv" \\
    --user-id "<your-auth-uuid>"
  # Or use latest report in a directory:
  python3 nuke/scripts/sync-photos-to-supabase.py \\
    --reports-dir "/Volumes/NukePortable/VehicleProfiles/_reports" \\
    --user-id "$USER_ID"

See README-photos-to-supabase.md for full flow (Photos export → YONO organize → this script).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import os
import sys
from pathlib import Path
from typing import Any

try:
    from supabase import create_client
except ImportError:
    print("Install supabase: pip install supabase", file=sys.stderr)
    sys.exit(2)


def get_supabase(user_id: str):
    url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(2)
    return create_client(url, key), user_id


def file_hash(path: Path, size_limit: int = 10 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            if size_limit and f.tell() > size_limit:
                break
    return h.hexdigest()


def load_report(path: Path) -> list[dict[str, Any]]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("is_vehicle") in ("True", "true", "1") and
                r.get("action") in ("link", "exists", "would_link")):
                rows.append(r)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync YONO organize CSV to Supabase (local_photos profiles).")
    ap.add_argument("--report", help="Path to a single yono_organize_*.csv")
    ap.add_argument("--reports-dir", help="Use latest yono_organize_*.csv in this directory")
    ap.add_argument("--user-id", default=os.environ.get("USER_ID"), help="Supabase auth user UUID (owner of vehicles)")
    ap.add_argument("--dry-run", action="store_true", help="Do not insert or upload")
    args = ap.parse_args()

    if not args.user_id:
        print("Set USER_ID or pass --user-id", file=sys.stderr)
        return 2

    report_path: Path | None = None
    if args.report:
        report_path = Path(args.report).expanduser()
    elif args.reports_dir:
        d = Path(args.reports_dir).expanduser()
        candidates = sorted(d.glob("yono_organize_*.csv"), reverse=True)
        if candidates:
            report_path = candidates[0]
    if not report_path or not report_path.exists():
        print("No report CSV found (use --report or --reports-dir)", file=sys.stderr)
        return 2

    rows = load_report(report_path)
    if not rows:
        print("No vehicle rows in report (need is_vehicle and action link/exists/would_link)")
        return 0

    # Group by (make, zone)
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        make = (r.get("make") or "").strip() or "Unknown"
        zone = (r.get("zone") or "").strip() or "unknown_zone"
        key = (make, zone)
        groups.setdefault(key, []).append(r)

    sb, user_id = get_supabase(args.user_id)
    bucket = "vehicle-data"
    created = 0
    uploaded = 0

    for (make, zone), group_rows in groups.items():
        if args.dry_run:
            print(f"[dry-run] Would create vehicle make={make} zone={zone} with {len(group_rows)} images")
            created += 1
            uploaded += len(group_rows)
            continue

        # Insert vehicle
        ins = sb.table("vehicles").insert({
            "make": make,
            "model": None,
            "year": None,
            "profile_origin": "local_photos",
            "discovery_source": "photos_export",
            "user_id": user_id,
            "uploaded_by": user_id,
        }).execute()
        if not ins.data or len(ins.data) == 0:
            print(f"Failed to insert vehicle {make} / {zone}", file=sys.stderr)
            continue
        vehicle_id = ins.data[0]["id"]
        created += 1

        for r in group_rows:
            src = Path((r.get("source_path") or "").strip())
            if not src.exists():
                src = src.resolve()  # follow symlink
            if not src.exists():
                print(f"Skip missing: {src}", file=sys.stderr)
                continue
            try:
                h = file_hash(src)
            except Exception as e:
                print(f"Skip hash {src}: {e}", file=sys.stderr)
                continue
            ext = src.suffix.lower() or ".jpg"
            storage_path = f"users/{user_id}/local_photos/{h[:16]}{ext}"

            # Upload to storage
            with open(src, "rb") as f:
                data = f.read()
            content_type = "image/jpeg" if ext in (".jpg", ".jpeg") else f"image/{ext.lstrip('.')}"
            try:
                sb.storage.from_(bucket).upload(
                    path=storage_path,
                    file=io.BytesIO(data),
                    file_options={"content-type": content_type, "upsert": "true"},
                )
            except Exception as e:
                print(f"Storage upload failed {src}: {e}", file=sys.stderr)
                continue
            try:
                public_url = sb.storage.from_(bucket).get_public_url(storage_path)
            except Exception:
                url_base = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
                public_url = f"{url_base.rstrip('/')}/storage/v1/object/public/{bucket}/{storage_path}"
            uploaded += 1

            # Insert vehicle_images
            try:
                sb.table("vehicle_images").insert({
                    "vehicle_id": vehicle_id,
                    "user_id": user_id,
                    "image_url": public_url,
                    "storage_path": storage_path,
                    "vehicle_zone": zone,
                    "source": "photos_export",
                }).execute()
            except Exception as e:
                print(f"vehicle_images insert failed: {e}", file=sys.stderr)

    print(f"Created {created} vehicles, uploaded {uploaded} images.")
    if args.dry_run:
        print("(dry-run; no changes written)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
