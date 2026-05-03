#!/usr/bin/env python3
"""
Apple Numbers Spreadsheet → vehicle_observations ingestion (WS-6).

Reads every .numbers file in ~/Library/Mobile Documents/com~apple~Numbers/Documents/
recursively, extracts non-trivial rows from each table, attempts vehicle
attribution via VIN regex, year+make+model match, and filename / sheet hints,
then submits each row through the canonical `ingest-observation` edge function.

Source slug: `numbers-spreadsheet` (registered via migration
20260503180000_observation_source_numbers_spreadsheet.sql).

Hard rules respected:
- No direct insert into vehicle_observations — single write path through
  ingest-observation.
- No mutation of the .numbers files.
- Errors during parsing log and continue; one bad file never aborts the run.

Usage:
  npm run numbers:ingest                # default: scan + submit
  npm run numbers:ingest -- --dry-run   # parse and log; no POSTs
  npm run numbers:ingest -- --limit 5   # process only the first N files
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

try:
    from numbers_parser import Document  # type: ignore
except ImportError:
    print(
        "numbers-parser not installed. Run: "
        "python3 -m venv scripts/.venv-numbers && "
        "scripts/.venv-numbers/bin/pip install numbers-parser requests",
        file=sys.stderr,
    )
    sys.exit(2)

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
NUMBERS_ROOT = Path.home() / "Library/Mobile Documents/com~apple~Numbers/Documents"
LOG_PATH = REPO_ROOT / "output" / "numbers-ingest-2026-05-03.log"

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b")
SHORT_VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{11,13}\b")  # pre-1981 VINs

# Curated filename → vehicle_id map. When the year+make+model search returns
# multiple candidates (very common — there are 5+ "1986 Chevrolet K10"s in DB),
# automatic year/make/model matching is too ambiguous to be honest about. So
# for the files Skylar has told us belong to specific vehicles, we attribute
# them deterministically here. Everything else falls through to VIN regex /
# unique-match year+make+model resolution and otherwise lands as no-vehicle
# (logged for human review).
#
# The K5 (`93119305-2a50-4886-b471-50e5aa3943a0`) is Skylar's 1977 Cheyenne
# Chalet. The recon notes "the K5 probably has hours/notes in one of these"
# but we DO NOT force-attribute K5 to any file unless filename or VIN proves
# it — guessing is worse than nothing.
FILENAME_VEHICLE_MAP: dict[str, str] = {
    # 1973 Dodge Charger (Hugo's red Charger restoration; VIN proven match)
    "C2020 1973 charger.numbers": "f05462f9-4901-4e02-bbed-8d2670de4646",
}

# Tokens we consider "a vehicle hint" in filenames / sheet names.
MAKE_HINTS = {
    "chevrolet": "Chevrolet",
    "chevy": "Chevrolet",
    "chev": "Chevrolet",
    "k5": "Chevrolet",
    "k10": "Chevrolet",
    "k20": "Chevrolet",
    "k30": "Chevrolet",
    "c10": "Chevrolet",
    "c20": "Chevrolet",
    "k1500": "Chevrolet",
    "k2500": "Chevrolet",
    "blazer": "Chevrolet",
    "suburban": "Chevrolet",
    "gmc": "GMC",
    "dodge": "Dodge",
    "charger": "Dodge",
    "ford": "Ford",
    "mustang": "Ford",
    "bronco": "Ford",
    "roadster": "Ford",
    "suzuki": "Suzuki",
    "jimny": "Suzuki",
}

# Words that, if they appear in the table/sheet name, hint at the kind of row.
HOURS_HINTS = ("hour", "hr", "labor", "labour", "heures")
COST_HINTS = ("cost", "price", "spent", "invoice", "expense", "$", "balance", "paid", "pay")
PARTS_HINTS = ("part", "product", "metal", "order", "kit")


@dataclass
class FileResult:
    path: str
    sheets: int = 0
    tables: int = 0
    rows_seen: int = 0
    rows_meaningful: int = 0
    submitted: int = 0
    duplicates: int = 0
    errors: int = 0
    no_vehicle: int = 0
    per_vehicle: dict[str, int] = field(default_factory=dict)
    error_messages: list[str] = field(default_factory=list)


@dataclass
class Stats:
    files_total: int = 0
    files_ok: int = 0
    files_errored: list[str] = field(default_factory=list)
    files_no_vehicle: list[str] = field(default_factory=list)
    submitted: int = 0
    duplicates: int = 0
    errors: int = 0
    per_vehicle: dict[str, int] = field(default_factory=dict)


def log(msg: str, fh) -> None:
    line = f"{dt.datetime.utcnow().isoformat(timespec='seconds')}Z  {msg}"
    print(line)
    fh.write(line + "\n")
    fh.flush()


# ---------- vehicle attribution -----------------------------------------------

def find_vins(text: str) -> list[str]:
    if not text:
        return []
    full = VIN_RE.findall(text.upper())
    if full:
        return list(dict.fromkeys(full))
    short = SHORT_VIN_RE.findall(text.upper())
    return list(dict.fromkeys(short))


def hint_make(name: str) -> str | None:
    low = name.lower()
    for token, make in MAKE_HINTS.items():
        if re.search(rf"\b{re.escape(token)}\b", low):
            return make
    return None


def hint_year(name: str) -> int | None:
    m = re.search(r"\b(19[3-9]\d|20[0-2]\d)\b", name)
    if m:
        return int(m.group(1))
    return None


def hint_model(name: str) -> str | None:
    low = name.lower()
    for token in (
        "k5",
        "k10",
        "k20",
        "k30",
        "c10",
        "k1500",
        "k2500",
        "blazer",
        "suburban",
        "charger",
        "mustang",
        "bronco",
        "roadster",
        "jimny",
    ):
        if re.search(rf"\b{re.escape(token)}\b", low):
            return token
    return None


def resolve_vehicle_id(
    *,
    vin_candidates: list[str],
    file_hints: dict[str, Any],
    sheet_hints: dict[str, Any],
    file_name: str,
    cell_text: str,
    cache: dict[str, str | None],
) -> tuple[str | None, dict[str, Any]]:
    """Return (vehicle_id, signals)."""
    # 0) Curated filename map — Skylar-confirmed.
    if file_name in FILENAME_VEHICLE_MAP:
        return FILENAME_VEHICLE_MAP[file_name], {
            "matched_by": "curated_filename_map",
            "file_name": file_name,
        }

    # 1) VIN — highest confidence.
    for vin in vin_candidates:
        cached = cache.get(f"vin:{vin}")
        if cached is not None:
            return cached, {"matched_by": "vin", "vin": vin}
        url = (
            f"{SUPABASE_URL}/rest/v1/vehicles?select=id&vin=eq.{vin}"
        )
        try:
            r = requests.get(url, headers=_supabase_headers(), timeout=10)
            r.raise_for_status()
            rows = r.json()
            if rows:
                cache[f"vin:{vin}"] = rows[0]["id"]
                return rows[0]["id"], {"matched_by": "vin", "vin": vin}
            cache[f"vin:{vin}"] = None
        except Exception:
            pass

    # 2) Year + make + model (combined hints).
    year = sheet_hints.get("year") or file_hints.get("year")
    make = sheet_hints.get("make") or file_hints.get("make")
    model = sheet_hints.get("model") or file_hints.get("model")
    if year and make:
        cache_key = f"ymm:{year}:{make}:{model or ''}"
        if cache_key in cache:
            cached = cache[cache_key]
            if cached:
                return cached, {
                    "matched_by": "year_make_model_hint",
                    "year": year,
                    "make": make,
                    "model": model,
                }
        params = [
            f"select=id,year,make,model",
            f"year=eq.{year}",
            f"make=ilike.%25{make}%25",
        ]
        if model:
            params.append(f"model=ilike.%25{model}%25")
        url = f"{SUPABASE_URL}/rest/v1/vehicles?" + "&".join(params) + "&limit=5"
        try:
            r = requests.get(url, headers=_supabase_headers(), timeout=10)
            r.raise_for_status()
            rows = r.json()
            if len(rows) == 1:
                cache[cache_key] = rows[0]["id"]
                return rows[0]["id"], {
                    "matched_by": "year_make_model_hint",
                    "year": year,
                    "make": make,
                    "model": model,
                }
            cache[cache_key] = None
        except Exception:
            pass

    return None, {
        "matched_by": None,
        "vin_candidates": vin_candidates,
        "file_hints": file_hints,
        "sheet_hints": sheet_hints,
    }


def _supabase_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_KEY or "",
        "Authorization": f"Bearer {SUPABASE_KEY or ''}",
        "Content-Type": "application/json",
    }


# ---------- row classification ------------------------------------------------

def classify_row_kind(row_dict: dict[str, Any], sheet_name: str, table_name: str) -> str:
    """Pick an observation_kind enum value for this row."""
    blob = " ".join(
        str(v) for v in (
            *row_dict.values(),
            sheet_name,
            table_name,
        )
        if v is not None
    ).lower()

    has_date = any(isinstance(v, (dt.date, dt.datetime)) for v in row_dict.values())
    has_hours = any(
        isinstance(v, (dt.timedelta, int, float)) and isinstance(v, dt.timedelta)
        for v in row_dict.values()
    ) or any(t in blob for t in HOURS_HINTS)
    has_cost = any(
        isinstance(v, (int, float)) and not isinstance(v, bool)
        for v in row_dict.values()
    ) and any(t in blob for t in COST_HINTS)
    has_parts = any(t in blob for t in PARTS_HINTS)

    if has_date and (has_hours or has_cost or has_parts):
        return "work_record"
    if has_parts and has_cost:
        return "specification"  # parts/cost catalog
    if has_cost:
        return "work_record"
    if has_parts:
        return "specification"
    return "comment"


def cell_to_jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return value.total_seconds()
    return str(value)


def row_observed_at(row_dict: dict[str, Any], file_mtime: dt.datetime) -> str:
    for v in row_dict.values():
        if isinstance(v, dt.datetime):
            return v.replace(tzinfo=dt.timezone.utc).isoformat()
        if isinstance(v, dt.date):
            return dt.datetime(v.year, v.month, v.day, tzinfo=dt.timezone.utc).isoformat()
    return file_mtime.replace(tzinfo=dt.timezone.utc).isoformat()


def row_is_meaningful(row_dict: dict[str, Any]) -> bool:
    """Skip rows that are all None or only formatting placeholders."""
    non_null = [v for v in row_dict.values() if v not in (None, "", [])]
    if not non_null:
        return False
    # Pure-numeric rows with all values < 0.001 are likely formula cruft.
    if all(isinstance(v, (int, float)) and abs(v) < 0.001 for v in non_null):
        return False
    return True


def row_to_text(row_dict: dict[str, Any]) -> str:
    parts = []
    for k, v in row_dict.items():
        if v in (None, ""):
            continue
        parts.append(f"{k}={cell_to_jsonable(v)}")
    return " | ".join(parts)


# ---------- ingest call -------------------------------------------------------

def submit_observation(payload: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    url = f"{SUPABASE_URL}/functions/v1/ingest-observation"
    try:
        r = requests.post(url, headers=_supabase_headers(), data=json.dumps(payload), timeout=30)
        body = {}
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text[:500]}
        if r.status_code >= 400:
            return False, {"status": r.status_code, **body}
        return True, body
    except Exception as e:
        return False, {"error": str(e)}


# ---------- main loop ---------------------------------------------------------

def iter_numbers_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    return sorted(root.rglob("*.numbers"))


def process_file(
    path: Path,
    *,
    dry_run: bool,
    cache: dict[str, str | None],
    fh,
) -> FileResult:
    res = FileResult(path=str(path))
    try:
        doc = Document(str(path))
    except Exception as e:
        msg = f"PARSE-FAIL {path.name}: {type(e).__name__}: {e}"
        log(msg, fh)
        res.errors += 1
        res.error_messages.append(msg)
        return res

    file_mtime = dt.datetime.utcfromtimestamp(path.stat().st_mtime)
    file_hints = {
        "year": hint_year(path.name),
        "make": hint_make(path.name),
        "model": hint_model(path.name),
    }

    for sheet in doc.sheets:
        res.sheets += 1
        sheet_hints = {
            "year": hint_year(sheet.name) or file_hints["year"],
            "make": hint_make(sheet.name) or file_hints["make"],
            "model": hint_model(sheet.name) or file_hints["model"],
        }
        for table in sheet.tables:
            res.tables += 1
            table_name = table.name
            try:
                rows = table.rows(values_only=True)
            except Exception as e:
                msg = f"TABLE-FAIL {path.name}::{sheet.name}::{table_name}: {e}"
                log(msg, fh)
                res.errors += 1
                res.error_messages.append(msg)
                continue

            if not rows:
                continue

            # Use first row that has >50% string cells as headers; else generic A,B,C..
            header_row = None
            for r in rows[:3]:
                non_null = [c for c in r if c not in (None, "")]
                if non_null and sum(1 for c in non_null if isinstance(c, str)) >= max(1, len(non_null) // 2):
                    header_row = r
                    break
            if header_row is not None:
                headers = [
                    str(c).strip() if c not in (None, "") else f"col_{i}"
                    for i, c in enumerate(header_row)
                ]
                data_rows = rows[rows.index(header_row) + 1:]
            else:
                headers = [f"col_{i}" for i in range(len(rows[0]))]
                data_rows = rows

            table_hints = {
                "year": hint_year(table_name) or sheet_hints["year"],
                "make": hint_make(table_name) or sheet_hints["make"],
                "model": hint_model(table_name) or sheet_hints["model"],
            }

            for ri, row in enumerate(data_rows):
                res.rows_seen += 1
                row_dict = {h: c for h, c in zip(headers, row)}
                if not row_is_meaningful(row_dict):
                    continue
                res.rows_meaningful += 1

                cell_text_parts = [str(c) for c in row if isinstance(c, str)]
                cell_text_parts.extend([str(c) for c in headers if isinstance(c, str)])
                cell_text_parts.append(table_name)
                cell_text = " ".join(cell_text_parts)

                vin_candidates = find_vins(cell_text + " " + table_name)

                vehicle_id, signals = resolve_vehicle_id(
                    vin_candidates=vin_candidates,
                    file_hints=file_hints,
                    sheet_hints=table_hints,
                    file_name=path.name,
                    cell_text=cell_text,
                    cache=cache,
                )

                if not vehicle_id:
                    res.no_vehicle += 1
                    continue

                kind = classify_row_kind(row_dict, sheet.name, table_name)
                content_text = row_to_text(row_dict)
                if not content_text:
                    continue

                stable_id = hashlib.sha1(
                    f"{path.name}|{sheet.name}|{table_name}|{ri}|{content_text}".encode()
                ).hexdigest()[:24]

                payload = {
                    "source_slug": "numbers-spreadsheet",
                    "kind": kind,
                    "observed_at": row_observed_at(row_dict, file_mtime),
                    "source_identifier": f"numbers:{path.name}:{sheet.name}:{table_name}:{ri}:{stable_id}",
                    "content_text": content_text[:4000],
                    "structured_data": {
                        "row": {k: cell_to_jsonable(v) for k, v in row_dict.items()},
                        "row_index": ri,
                        "sheet_name": sheet.name,
                        "table_name": table_name,
                        "file_path": str(path),
                        "file_name": path.name,
                        "file_mtime": file_mtime.isoformat(),
                        "vehicle_match_signals": signals,
                    },
                    "vehicle_id": vehicle_id,
                    "extraction_method": "numbers_parser",
                    "extractor_id": "ws-6-numbers-files-ingest",
                }

                if dry_run:
                    res.submitted += 1
                    res.per_vehicle[vehicle_id] = res.per_vehicle.get(vehicle_id, 0) + 1
                    continue

                ok, body = submit_observation(payload)
                if ok:
                    if body.get("duplicate"):
                        res.duplicates += 1
                    else:
                        res.submitted += 1
                    res.per_vehicle[vehicle_id] = res.per_vehicle.get(vehicle_id, 0) + 1
                else:
                    res.errors += 1
                    msg = f"INGEST-FAIL {path.name}::{table_name}::row{ri}: {body}"
                    res.error_messages.append(msg)
                    if res.errors <= 3:
                        log(msg, fh)

    return res


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="parse only, no POSTs")
    parser.add_argument("--limit", type=int, default=0, help="process at most N files")
    parser.add_argument("--only", type=str, default=None, help="substring match on filename")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
            "(run via dotenvx).",
            file=sys.stderr,
        )
        return 2

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    files = list(iter_numbers_files(NUMBERS_ROOT))
    if args.only:
        files = [f for f in files if args.only.lower() in f.name.lower()]
    if args.limit > 0:
        files = files[: args.limit]

    stats = Stats(files_total=len(files))
    cache: dict[str, str | None] = {}

    with LOG_PATH.open("a") as fh:
        log(
            f"=== numbers-files-ingest start  files={len(files)}  "
            f"dry_run={args.dry_run}  root={NUMBERS_ROOT}",
            fh,
        )

        for i, path in enumerate(files, 1):
            t0 = time.time()
            try:
                res = process_file(path, dry_run=args.dry_run, cache=cache, fh=fh)
            except Exception as e:
                msg = f"FILE-CRASH {path.name}: {type(e).__name__}: {e}"
                log(msg, fh)
                stats.files_errored.append(path.name)
                continue

            dur = time.time() - t0
            log(
                f"[{i}/{len(files)}] {path.name}  "
                f"sheets={res.sheets} tables={res.tables} "
                f"rows={res.rows_meaningful}/{res.rows_seen} "
                f"submitted={res.submitted} dup={res.duplicates} "
                f"no_vehicle={res.no_vehicle} errors={res.errors} "
                f"({dur:.1f}s)",
                fh,
            )
            if res.errors and res.error_messages:
                stats.files_errored.append(path.name)
            if res.rows_meaningful and res.submitted == 0 and res.duplicates == 0:
                stats.files_no_vehicle.append(path.name)
            if res.submitted == 0 and res.duplicates == 0 and res.errors == 0 and res.rows_meaningful == 0:
                pass  # empty/template file, count silently
            else:
                stats.files_ok += 1

            stats.submitted += res.submitted
            stats.duplicates += res.duplicates
            stats.errors += res.errors
            for vid, n in res.per_vehicle.items():
                stats.per_vehicle[vid] = stats.per_vehicle.get(vid, 0) + n

        log("=== summary ===", fh)
        log(f"files_total      = {stats.files_total}", fh)
        log(f"files_ok         = {stats.files_ok}", fh)
        log(f"files_errored    = {len(stats.files_errored)}", fh)
        log(f"files_no_vehicle = {len(stats.files_no_vehicle)}", fh)
        log(f"submitted        = {stats.submitted}", fh)
        log(f"duplicates       = {stats.duplicates}", fh)
        log(f"errors           = {stats.errors}", fh)
        log("per_vehicle (top 10):", fh)
        for vid, n in sorted(stats.per_vehicle.items(), key=lambda x: -x[1])[:10]:
            log(f"  {vid}  {n}", fh)
        if stats.files_errored:
            log(f"errored files: {stats.files_errored}", fh)
        if stats.files_no_vehicle:
            log(f"no-vehicle files: {stats.files_no_vehicle}", fh)

    return 0


if __name__ == "__main__":
    sys.exit(main())
