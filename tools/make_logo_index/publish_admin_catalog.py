#!/usr/bin/env python3
"""
Publish the vehicle make + logo index into the frontend admin catalog.

Reads:
  - A make/logo index JSON produced by tools/make_logo_index/index_makes_logos.py

Writes:
  - nuke_frontend/public/admin_catalog/vehicle_make_logos.json
  - nuke_frontend/public/admin_catalog/vehicle_make_logos.csv

This keeps the admin UI simple: it can fetch static files from /admin_catalog/*.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
from typing import Any, Dict, List, Optional
from urllib.parse import quote


COMMONS_SPECIAL_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/"


def utc_now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def commons_thumb_url(filename: str, width: int) -> str:
    safe = filename.replace(" ", "_")
    return f"{COMMONS_SPECIAL_FILEPATH}{quote(safe)}?width={int(width)}"


def main() -> int:
    p = argparse.ArgumentParser(description="Publish make/logo index to frontend admin catalog.")
    p.add_argument(
        "--input",
        default="/Users/skylar/nuke/tmp/make_logo_index_10k/index.json",
        help="Path to make_logo_index index.json",
    )
    p.add_argument(
        "--out-dir",
        default="/Users/skylar/nuke/nuke_frontend/public/admin_catalog",
        help="Output directory under frontend public/",
    )
    p.add_argument("--thumb-width", type=int, default=128, help="Thumbnail width (px) for logo preview URLs")
    args = p.parse_args()

    input_path = os.path.abspath(args.input)
    out_dir = os.path.abspath(args.out_dir)
    ensure_dir(out_dir)

    with open(input_path, "r", encoding="utf-8") as f:
        src = json.load(f)

    items: List[Dict[str, Any]] = src.get("items") or []
    out_items: List[Dict[str, Any]] = []

    for it in items:
        label = it.get("label")
        wikidata_id = it.get("wikidata_id")
        wikidata_url = it.get("wikidata_url")
        status = it.get("status")
        start_year = it.get("start_year")
        end_year = it.get("end_year")
        start_decade = it.get("start_decade")
        country = it.get("country")
        types = it.get("types") or []
        alt_labels = it.get("alt_labels") or []
        official_website = it.get("official_website")

        logo = it.get("logo") or {}
        commons_filename: Optional[str] = logo.get("commons_filename")
        commons_file_page: Optional[str] = logo.get("commons_file_page")
        commons_download_url: Optional[str] = logo.get("commons_download_url")

        thumb_url = commons_thumb_url(commons_filename, args.thumb_width) if commons_filename else None

        out_items.append(
            {
                "label": label,
                "alt_labels": alt_labels,
                "status": status,
                "start_year": start_year,
                "end_year": end_year,
                "start_decade": start_decade,
                "country": country,
                "types": types,
                "wikidata_id": wikidata_id,
                "wikidata_url": wikidata_url,
                "official_website": official_website,
                "commons_logo_filename": commons_filename,
                "commons_logo_file_page": commons_file_page,
                "commons_logo_download_url": commons_download_url,
                "logo_thumb_url": thumb_url,
            }
        )

    json_out_path = os.path.join(out_dir, "vehicle_make_logos.json")
    csv_out_path = os.path.join(out_dir, "vehicle_make_logos.csv")

    payload = {
        "generated_at": utc_now_iso(),
        "source_index": os.path.basename(input_path),
        "thumb_width": int(args.thumb_width),
        "count": len(out_items),
        "items": out_items,
    }

    with open(json_out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    fieldnames = [
        "label",
        "status",
        "start_year",
        "end_year",
        "start_decade",
        "country",
        "types",
        "alt_labels",
        "wikidata_id",
        "wikidata_url",
        "official_website",
        "commons_logo_filename",
        "commons_logo_file_page",
        "commons_logo_download_url",
        "logo_thumb_url",
    ]

    with open(csv_out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for it in out_items:
            row = dict(it)
            row["types"] = ";".join(it.get("types") or [])
            row["alt_labels"] = ";".join(it.get("alt_labels") or [])
            w.writerow({k: row.get(k) for k in fieldnames})

    print(f"Wrote {json_out_path}")
    print(f"Wrote {csv_out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


