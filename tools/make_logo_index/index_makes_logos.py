#!/usr/bin/env python3
"""
Vehicle makes + logos indexer (historical).

Data source:
- Wikidata SPARQL for the list of makes/manufacturers (including defunct)
- Wikimedia Commons for logo downloads (logo image property P154)

Outputs (under --out):
- index.json
- index.csv
- logos/ (optional, if --download)

Notes:
- Logos are often trademarks. This tool is for internal design reference and provenance.
- Always review licensing/usage rules before shipping brand marks publicly.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote, unquote

import requests


WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
COMMONS_FILE_PREFIX = "https://commons.wikimedia.org/wiki/File:"
COMMONS_SPECIAL_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/"


DEFAULT_CLASS_LABELS = [
    # Brands/makes
    "automobile marque",
    # Manufacturers
    "automobile manufacturer",
    "motorcycle manufacturer",
    "truck manufacturer",
    "bus manufacturer",
]


def utc_now_iso() -> str:
    # Use timezone-aware UTC time (Python 3.12+ prefers this over utcnow()).
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]+", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-{2,}", "-", text)
    return text.strip("-") or "unknown"


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_wikidata_date(value: Optional[str]) -> Tuple[Optional[str], Optional[int]]:
    """
    Wikidata SPARQL JSON may return xsd:dateTime literals like:
      1903-01-01T00:00:00Z
    We normalize to ISO date (YYYY-MM-DD) and extract start_year.
    """
    if not value:
        return None, None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value)
    if not m:
        return value, None
    yyyy, mm, dd = m.group(1), m.group(2), m.group(3)
    try:
        year_int = int(yyyy)
    except ValueError:
        year_int = None
    return f"{yyyy}-{mm}-{dd}", year_int


def decade_bucket(year: Optional[int]) -> Optional[str]:
    if year is None:
        return None
    decade = (year // 10) * 10
    return f"{decade}s"


def commons_file_page(filename: str) -> str:
    # Commons File pages use spaces, but URLs commonly use underscores.
    safe = filename.replace(" ", "_")
    return COMMONS_FILE_PREFIX + quote(safe)


def commons_special_filepath(filename: str, width: Optional[int] = None) -> str:
    safe = filename.replace(" ", "_")
    url = COMMONS_SPECIAL_FILEPATH + quote(safe)
    if width:
        url += f"?width={int(width)}"
    return url


def http_get_json(url: str, params: Dict[str, str], headers: Dict[str, str], timeout_s: int = 60) -> Dict[str, Any]:
    resp = requests.get(url, params=params, headers=headers, timeout=timeout_s)
    resp.raise_for_status()
    return resp.json()


def sparql_query_page(
    class_labels: List[str],
    limit: int,
    offset: int,
    user_agent: str,
) -> List[Dict[str, Any]]:
    # We avoid hardcoding Q-IDs by filtering on English class labels.
    values = " ".join([f"\"{lbl}\"@en" for lbl in class_labels])
    query = f"""
SELECT DISTINCT
  ?item ?itemLabel ?itemAltLabel
  ?classLabel
  ?logo
  ?inception
  ?dissolved
  ?countryLabel
  ?officialWebsite
WHERE {{
  ?item wdt:P31/wdt:P279* ?class .
  ?class rdfs:label ?classLabel .
  VALUES ?classLabel {{ {values} }}

  OPTIONAL {{
    ?item skos:altLabel ?itemAltLabel .
    FILTER(LANG(?itemAltLabel) = "en")
  }}
  OPTIONAL {{ ?item wdt:P154 ?logo . }}
  OPTIONAL {{ ?item wdt:P571 ?inception . }}
  OPTIONAL {{ ?item wdt:P576 ?dissolved . }}
  OPTIONAL {{ ?item wdt:P17 ?country . }}
  OPTIONAL {{ ?item wdt:P856 ?officialWebsite . }}

  SERVICE wikibase:label {{
    bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en" .
  }}
}}
LIMIT {int(limit)}
OFFSET {int(offset)}
"""
    headers = {
        "Accept": "application/sparql-results+json",
        "User-Agent": user_agent,
    }
    data = http_get_json(
        WIKIDATA_SPARQL_ENDPOINT,
        params={"format": "json", "query": query},
        headers=headers,
        timeout_s=90,
    )
    bindings = data.get("results", {}).get("bindings", [])
    return bindings


def safe_get(binding: Dict[str, Any], key: str) -> Optional[str]:
    v = binding.get(key)
    if not v:
        return None
    # SPARQL JSON format: {"type":"uri","value":"..."} / {"type":"literal","value":"..."}
    return v.get("value")


@dataclass
class MakeRecord:
    wikidata_id: str
    wikidata_url: str
    label: str
    alt_labels: List[str]
    types: List[str]

    inception: Optional[str]
    start_year: Optional[int]
    dissolved: Optional[str]
    end_year: Optional[int]

    status: str  # "active" | "defunct" | "unknown"
    country: Optional[str]
    official_website: Optional[str]

    commons_logo_filename: Optional[str]
    commons_logo_page: Optional[str]
    commons_logo_download_url: Optional[str]

    local_logo_path: Optional[str]
    local_logo_sha256: Optional[str]
    local_logo_bytes: Optional[int]

    @property
    def start_decade(self) -> Optional[str]:
        return decade_bucket(self.start_year)


def extract_qid(wikidata_url: str) -> str:
    # e.g. https://www.wikidata.org/entity/Q12345
    return wikidata_url.rstrip("/").split("/")[-1]


def parse_commons_filename_from_logo_value(logo_value: str) -> Optional[str]:
    """
    Wikidata P154 returns a Commons media URL like:
      http://commons.wikimedia.org/wiki/Special:FilePath/Ford%20logo.svg
    We want the original filename ("Ford logo.svg") if possible.
    """
    if not logo_value:
        return None
    if "/Special:FilePath/" in logo_value:
        tail = logo_value.split("/Special:FilePath/", 1)[1]
        tail = tail.split("?", 1)[0]
        tail = unquote(tail)
        return tail.replace("_", " ")
    return None


def merge_alt_labels(existing: List[str], new_label: Optional[str]) -> List[str]:
    if not new_label:
        return existing
    if new_label not in existing:
        existing.append(new_label)
    return existing


def download_logo(
    commons_filename: str,
    out_dir: str,
    make_slug: str,
    width: Optional[int],
    user_agent: str,
    sleep_s: float,
    retries: int,
    timeout_s: int,
) -> Tuple[Optional[str], Optional[str], Optional[int], Optional[str]]:
    """
    Returns (local_path, sha256, bytes, error) where error is None on success.
    Uses Special:FilePath with optional width for rasterization.
    """
    ensure_dir(out_dir)
    logo_dir = os.path.join(out_dir, "logos", make_slug)
    ensure_dir(logo_dir)

    url = commons_special_filepath(commons_filename, width=width)
    headers = {"User-Agent": user_agent}

    # Respect existing file if already present.
    if width is None:
        ext = os.path.splitext(commons_filename)[1].lower()
        local_name = f"logo{ext or ''}"
        local_path = os.path.join(logo_dir, local_name)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            return local_path, sha256_file(local_path), os.path.getsize(local_path), None
    else:
        # Thumbnails may be served as PNG/JPEG/WebP regardless of the original file type.
        for candidate in ["logo.png", "logo.jpg", "logo.jpeg", "logo.webp"]:
            candidate_path = os.path.join(logo_dir, candidate)
            if os.path.exists(candidate_path) and os.path.getsize(candidate_path) > 0:
                return candidate_path, sha256_file(candidate_path), os.path.getsize(candidate_path), None

    retryable_statuses = {429, 500, 502, 503, 504}
    last_error: Optional[str] = None

    for attempt in range(max(0, int(retries)) + 1):
        try:
            with requests.get(url, headers=headers, stream=True, timeout=timeout_s, allow_redirects=True) as resp:
                if resp.status_code in retryable_statuses:
                    retry_after = resp.headers.get("Retry-After")
                    if retry_after:
                        try:
                            wait_s = float(retry_after)
                        except ValueError:
                            wait_s = 2.0
                    else:
                        wait_s = min(2.0 * (2 ** attempt), 60.0)
                    last_error = f"HTTP {resp.status_code} (retryable), waiting {wait_s:.1f}s"
                    time.sleep(wait_s)
                    continue

                resp.raise_for_status()
                content_type = (resp.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
                if width is None:
                    ext = os.path.splitext(commons_filename)[1].lower()
                    local_name = f"logo{ext or ''}"
                else:
                    ext_by_type = {
                        "image/png": ".png",
                        "image/jpeg": ".jpg",
                        "image/webp": ".webp",
                        "image/svg+xml": ".svg",
                    }
                    local_name = "logo" + ext_by_type.get(content_type, ".png")
                local_path = os.path.join(logo_dir, local_name)

                with open(local_path, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=1024 * 128):
                        if chunk:
                            f.write(chunk)

            if sleep_s > 0:
                time.sleep(sleep_s)
            return local_path, sha256_file(local_path), os.path.getsize(local_path), None

        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            # Backoff for network-y failures.
            if attempt < int(retries):
                time.sleep(min(2.0 * (2 ** attempt), 60.0))
                continue
            break

    # Don't crash the whole run; caller will record missing local file.
    try:
        if "local_path" in locals() and local_path and os.path.exists(local_path):
            os.remove(local_path)
    except Exception:
        pass
    return None, None, None, last_error or "download_failed"


def write_json(path: str, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=False)


def write_csv(path: str, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in fieldnames})


def records_to_jsonable(records: List[MakeRecord]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in records:
        out.append(
            {
                "wikidata_id": r.wikidata_id,
                "wikidata_url": r.wikidata_url,
                "label": r.label,
                "alt_labels": r.alt_labels,
                "types": r.types,
                "inception": r.inception,
                "start_year": r.start_year,
                "start_decade": r.start_decade,
                "dissolved": r.dissolved,
                "end_year": r.end_year,
                "status": r.status,
                "country": r.country,
                "official_website": r.official_website,
                "logo": {
                    "commons_filename": r.commons_logo_filename,
                    "commons_file_page": r.commons_logo_page,
                    "commons_download_url": r.commons_logo_download_url,
                    "local_path": r.local_logo_path,
                    "sha256": r.local_logo_sha256,
                    "bytes": r.local_logo_bytes,
                },
            }
        )
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="Index vehicle makes + logos (historical) from Wikidata/Commons.")
    p.add_argument("--out", required=True, help="Output directory (recommended: /Users/skylar/nuke/tmp/make_logo_index)")
    p.add_argument("--limit", type=int, default=2000, help="Max total items to fetch from Wikidata")
    p.add_argument("--page-size", type=int, default=250, help="SPARQL page size")
    p.add_argument("--class-label", action="append", default=[], help="Override/add a class label filter (English)")
    p.add_argument("--download", action="store_true", help="Download logo files from Wikimedia Commons")
    p.add_argument("--max-downloads", type=int, default=500, help="Cap number of logo downloads")
    p.add_argument("--width", type=int, default=None, help="Optional pixel width for logo download (rasterized via Commons)")
    p.add_argument("--sleep", type=float, default=0.2, help="Sleep seconds between downloads (politeness)")
    p.add_argument("--retries", type=int, default=4, help="Retries per logo download for transient errors")
    p.add_argument("--timeout", type=int, default=90, help="Per-request timeout in seconds")
    p.add_argument("--user-agent", default="NukeLogoIndexer/1.0 (internal design indexing)", help="HTTP User-Agent")
    args = p.parse_args()

    out_dir = os.path.abspath(args.out)
    ensure_dir(out_dir)

    class_labels = args.class_label[:] if args.class_label else DEFAULT_CLASS_LABELS[:]

    # Fetch bindings with pagination
    all_bindings: List[Dict[str, Any]] = []
    offset = 0
    remaining = max(0, int(args.limit))
    page_size = max(1, min(int(args.page_size), 1000))

    while remaining > 0:
        this_page = min(page_size, remaining)
        bindings = sparql_query_page(
            class_labels=class_labels,
            limit=this_page,
            offset=offset,
            user_agent=args.user_agent,
        )
        if not bindings:
            break
        all_bindings.extend(bindings)
        offset += this_page
        remaining -= this_page
        # Minimal throttling for SPARQL endpoint
        time.sleep(0.1)

    # Aggregate by item
    by_qid: Dict[str, MakeRecord] = {}

    for b in all_bindings:
        item_url = safe_get(b, "item")
        if not item_url:
            continue
        qid = extract_qid(item_url)

        label = safe_get(b, "itemLabel") or qid
        alt = safe_get(b, "itemAltLabel")
        class_label = safe_get(b, "classLabel")

        logo_value = safe_get(b, "logo")
        inception_raw = safe_get(b, "inception")
        dissolved_raw = safe_get(b, "dissolved")
        country = safe_get(b, "countryLabel")
        website = safe_get(b, "officialWebsite")

        inception, start_year = parse_wikidata_date(inception_raw)
        dissolved, end_year = parse_wikidata_date(dissolved_raw)

        status = "unknown"
        if dissolved or end_year is not None:
            status = "defunct"
        elif inception or start_year is not None:
            status = "active"

        commons_filename = parse_commons_filename_from_logo_value(logo_value) if logo_value else None
        commons_page = commons_file_page(commons_filename) if commons_filename else None
        commons_download = commons_special_filepath(commons_filename, width=args.width) if commons_filename else None

        if qid not in by_qid:
            by_qid[qid] = MakeRecord(
                wikidata_id=qid,
                wikidata_url=item_url,
                label=label,
                alt_labels=[alt] if alt else [],
                types=[class_label] if class_label else [],
                inception=inception,
                start_year=start_year,
                dissolved=dissolved,
                end_year=end_year,
                status=status,
                country=country,
                official_website=website,
                commons_logo_filename=commons_filename,
                commons_logo_page=commons_page,
                commons_logo_download_url=commons_download,
                local_logo_path=None,
                local_logo_sha256=None,
                local_logo_bytes=None,
            )
        else:
            rec = by_qid[qid]
            rec.alt_labels = merge_alt_labels(rec.alt_labels, alt)
            if class_label and class_label not in rec.types:
                rec.types.append(class_label)
            # Prefer keeping existing logo if present; otherwise adopt.
            if not rec.commons_logo_filename and commons_filename:
                rec.commons_logo_filename = commons_filename
                rec.commons_logo_page = commons_page
                rec.commons_logo_download_url = commons_download

    records = list(by_qid.values())
    records.sort(key=lambda r: (r.start_year or 9999, r.label.lower()))

    # Optional downloads
    downloaded = 0
    download_failures: List[Dict[str, Any]] = []
    if args.download:
        for r in records:
            if downloaded >= int(args.max_downloads):
                break
            if not r.commons_logo_filename:
                continue
            make_slug = slugify(r.label)
            local_path, digest, size_b, err = download_logo(
                commons_filename=r.commons_logo_filename,
                out_dir=out_dir,
                make_slug=make_slug,
                width=args.width,
                user_agent=args.user_agent,
                sleep_s=float(args.sleep),
                retries=int(args.retries),
                timeout_s=int(args.timeout),
            )
            if local_path:
                r.local_logo_path = os.path.relpath(local_path, out_dir)
                r.local_logo_sha256 = digest
                r.local_logo_bytes = size_b
                downloaded += 1
            else:
                download_failures.append(
                    {
                        "label": r.label,
                        "wikidata_id": r.wikidata_id,
                        "commons_logo_filename": r.commons_logo_filename,
                        "commons_logo_download_url": r.commons_logo_download_url,
                        "error": err,
                    }
                )

    json_path = os.path.join(out_dir, "index.json")
    csv_path = os.path.join(out_dir, "index.csv")

    json_payload = {
        "generated_at": utc_now_iso(),
        "source": {
            "wikidata_sparql_endpoint": WIKIDATA_SPARQL_ENDPOINT,
            "commons_file_prefix": COMMONS_FILE_PREFIX,
            "commons_special_filepath_prefix": COMMONS_SPECIAL_FILEPATH,
            "class_label_filters": class_labels,
        },
        "options": {
            "limit": int(args.limit),
            "page_size": int(args.page_size),
            "download": bool(args.download),
            "max_downloads": int(args.max_downloads),
            "width": args.width,
            "retries": int(args.retries),
            "timeout": int(args.timeout),
        },
        "stats": {
            "total_items": len(records),
            "items_with_commons_logo": sum(1 for r in records if r.commons_logo_filename),
            "logos_downloaded": downloaded,
            "logo_download_failures": len(download_failures),
        },
        "items": records_to_jsonable(records),
    }

    write_json(json_path, json_payload)

    if args.download and download_failures:
        failures_path = os.path.join(out_dir, "download_failures.csv")
        write_csv(
            failures_path,
            download_failures,
            fieldnames=["label", "wikidata_id", "commons_logo_filename", "commons_logo_download_url", "error"],
        )
        print(f"Wrote {failures_path}")

    csv_rows: List[Dict[str, Any]] = []
    for r in records:
        csv_rows.append(
            {
                "label": r.label,
                "wikidata_id": r.wikidata_id,
                "wikidata_url": r.wikidata_url,
                "types": ";".join(r.types),
                "status": r.status,
                "inception": r.inception,
                "start_year": r.start_year,
                "start_decade": r.start_decade,
                "dissolved": r.dissolved,
                "end_year": r.end_year,
                "country": r.country,
                "official_website": r.official_website,
                "commons_logo_filename": r.commons_logo_filename,
                "commons_logo_page": r.commons_logo_page,
                "commons_logo_download_url": r.commons_logo_download_url,
                "local_logo_path": r.local_logo_path,
                "local_logo_sha256": r.local_logo_sha256,
                "local_logo_bytes": r.local_logo_bytes,
            }
        )

    write_csv(
        csv_path,
        csv_rows,
        fieldnames=list(csv_rows[0].keys()) if csv_rows else ["label"],
    )

    print(f"Wrote {json_path}")
    print(f"Wrote {csv_path}")
    if args.download:
        print(f"Downloaded {downloaded} logo files into {os.path.join(out_dir, 'logos')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


