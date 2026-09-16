#!/usr/bin/env python3
"""
scan_archive.py — Walk ~/Documents/Archives/ and ~/DUPLICATES_FOR_SSD/,
catalog every file, parse filenames for structured production metadata,
and write results to ~/email_intelligence.db (production_files table).

Two-phase approach:
  Phase 1: Fast catalog — stat + metadata parse, no hashing (very fast).
  Phase 2: Hash pass — compute SHA-256 for files <= 50MB (optional).

Resumable: skips files whose path is already in the database.
Usage:
  python3 ~/tools/scan_archive.py           # catalog only (fast)
  python3 ~/tools/scan_archive.py --hash    # catalog + hash pass
"""

import hashlib
import os
import re
import signal
import sqlite3
import sys
import time
from collections import Counter
from datetime import datetime, timezone

# ── Config ───────────────────────────────────────────────────────────────────

HOME = os.path.expanduser("~")
DB_PATH = os.path.join(HOME, "email_intelligence.db")
SCAN_DIRS = [
    (os.path.join(HOME, "Documents", "Archives"), "archives"),
    (os.path.join(HOME, "DUPLICATES_FOR_SSD"), "duplicates_ssd"),
]
MIN_FILE_SIZE = 1024                      # skip files < 1 KB
LARGE_FILE_THRESHOLD = 50 * 1024 * 1024   # 50 MB — skip hashing entirely
HASH_MAX = 10 * 1024 * 1024              # 10 MB — full hash; above = partial
HASH_TIMEOUT = 10                         # seconds max per file hash
PROGRESS_INTERVAL = 500
BATCH_SIZE = 500
HASH_BATCH = 100


def log(msg=""):
    print(msg, flush=True)


# ── Extension -> file_type mapping ───────────────────────────────────────────

EXT_MAP = {
    ".indd": "indesign", ".idml": "indesign",
    ".pdf": "pdf",
    ".psd": "photoshop",
    ".ai": "illustrator",
    ".jpg": "image_processed", ".jpeg": "image_processed",
    ".tif": "image_processed", ".tiff": "image_processed",
    ".png": "image_processed", ".heic": "image_processed",
    ".nef": "image_raw", ".cr2": "image_raw", ".arw": "image_raw",
    ".dng": "image_raw", ".raw": "image_raw",
    ".doc": "document", ".docx": "document",
    ".xls": "spreadsheet", ".xlsx": "spreadsheet", ".csv": "spreadsheet",
    ".otf": "font", ".ttf": "font", ".woff": "font",
    ".mov": "video", ".mp4": "video",
}

# ── Publication code patterns ────────────────────────────────────────────────

PUB_CODES = ["LOFSBH", "LOFRIV", "LOFFICIEL", "LOSBH", "OFSBH"]
PUB_RE = re.compile(
    r"(?P<pub>" + "|".join(PUB_CODES) + r")[\s_-]*(?P<issue>\d{1,3})?",
    re.IGNORECASE,
)
STORY_RE = re.compile(
    r"(?:" + "|".join(PUB_CODES) + r")\d{0,3}[\s_-]+(?P<story>[A-Za-z\u00C0-\u024F ]+)",
    re.IGNORECASE,
)
VERSION_RE = re.compile(
    r"(?:(?P<v>v\d+)|(?P<edit>edit\s*\d+)|(?P<final>FINAL)|(?P<sr>SR)|(?P<last>last))",
    re.IGNORECASE,
)
STAGE_KEYWORDS = ["BAT", "MAQUETTE", "RETOUCHE", "PRINT", "PROOF", "CDF", "PUB"]
STAGE_RE = re.compile(r"\b(" + "|".join(STAGE_KEYWORDS) + r")\b", re.IGNORECASE)

# ── Production role from path ────────────────────────────────────────────────

def classify_production_role(path_upper):
    if re.search(r'\bBAT\b', path_upper):
        return "bat"
    if "MAQUETTE" in path_upper:
        return "layout"
    if "RETOUCHE" in path_upper:
        return "source"
    if re.search(r'\bPRINT\b', path_upper):
        return "print_ready"
    if "0 PDFS" in path_upper or re.search(r'\bPDFS\b', path_upper):
        return "final"
    if re.search(r'\bPUB\b', path_upper):
        return "ad_creative"
    if "KIT" in path_upper and "MEDIA" in path_upper:
        return "brand_asset"
    if "FLATPLAN" in path_upper or re.search(r'\bCDF\b', path_upper):
        return "reference"
    return None


# ── Helpers ──────────────────────────────────────────────────────────────────

class HashTimeout(Exception):
    pass

def _timeout_handler(signum, frame):
    raise HashTimeout()

def sha256_file(filepath, file_size=0):
    """SHA-256 with timeout. Partial hash for files > HASH_MAX."""
    old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(HASH_TIMEOUT)
    try:
        h = hashlib.sha256()
        if file_size > HASH_MAX:
            with open(filepath, "rb") as f:
                h.update(f.read(1 << 20))          # first 1 MB
                h.update(str(file_size).encode())   # include size
                f.seek(-min(1 << 20, file_size), 2)
                h.update(f.read(1 << 20))           # last 1 MB
        else:
            with open(filepath, "rb") as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    h.update(chunk)
        return h.hexdigest()
    except (HashTimeout, OSError, PermissionError):
        return None
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)


def parse_filename(filename, full_path):
    publication = issue_number = story = version = stage = None

    m = PUB_RE.search(full_path)
    if m:
        publication = m.group("pub").upper()
        if m.group("issue"):
            issue_number = str(int(m.group("issue")))

    m = STORY_RE.search(filename)
    if m:
        raw = m.group("story").strip()
        raw = re.sub(r"\s+(v\d+|edit\s*\d+|FINAL|SR|last|BAT|PRINT|PROOF).*$",
                     "", raw, flags=re.IGNORECASE)
        if raw and len(raw) > 1:
            story = raw.strip()

    m = VERSION_RE.search(filename)
    if m:
        version = (m.group("v") or m.group("edit") or m.group("final")
                   or m.group("sr") or m.group("last"))

    m = STAGE_RE.search(full_path)
    if m:
        stage = m.group(1).upper()

    return publication, issue_number, story, version, stage


# ── Database ─────────────────────────────────────────────────────────────────

def init_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS production_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            filename TEXT NOT NULL,
            directory TEXT,
            file_extension TEXT,
            file_size_bytes INTEGER,
            content_hash_sha256 TEXT,
            file_modified_at TEXT,
            file_type TEXT,
            production_role TEXT,
            parsed_publication TEXT,
            parsed_issue_number TEXT,
            parsed_story TEXT,
            parsed_version TEXT,
            parsed_stage TEXT,
            source_directory TEXT,
            indexed_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pf_hash ON production_files(content_hash_sha256)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pf_path ON production_files(file_path)")
    conn.commit()


def load_existing_paths(conn):
    cur = conn.execute("SELECT file_path FROM production_files")
    return set(row[0] for row in cur.fetchall())


# ── Phase 1: Fast catalog ───────────────────────────────────────────────────

def phase1_catalog(conn, existing_paths):
    """Walk directories, stat files, parse metadata. No hashing."""
    log("=" * 65)
    log("  PHASE 1: Cataloging files (no hashing)")
    log("=" * 65)

    total_scanned = 0
    total_skipped_small = 0
    total_skipped_existing = 0
    total_inserted = 0
    total_size = 0
    type_counter = Counter()
    pub_counter = Counter()
    stage_counter = Counter()

    batch = []
    t_start = time.time()

    for scan_root, source_label in SCAN_DIRS:
        if not os.path.isdir(scan_root):
            log(f"  WARNING: {scan_root} does not exist, skipping.")
            continue
        log(f"  Scanning: {scan_root}  (source: {source_label})")

        for dirpath, dirnames, filenames in os.walk(scan_root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]

            for fname in filenames:
                if fname.startswith("."):
                    continue

                full_path = os.path.join(dirpath, fname)
                total_scanned += 1

                if total_scanned % PROGRESS_INTERVAL == 0:
                    elapsed = time.time() - t_start
                    rate = total_scanned / elapsed if elapsed > 0 else 0
                    log(f"    ... {total_scanned:,} files walked "
                        f"({total_inserted:,} new, {total_skipped_existing:,} existing) "
                        f"[{rate:.0f} files/s]")

                if full_path in existing_paths:
                    total_skipped_existing += 1
                    continue

                try:
                    st = os.stat(full_path)
                except (OSError, PermissionError):
                    continue

                size = st.st_size
                if size < MIN_FILE_SIZE:
                    total_skipped_small += 1
                    continue

                total_size += size

                _, ext = os.path.splitext(fname)
                ext_lower = ext.lower()
                file_type = EXT_MAP.get(ext_lower, "other")

                # Tag large files in file_type
                if size > LARGE_FILE_THRESHOLD:
                    file_type_db = file_type + " (large, no hash)"
                else:
                    file_type_db = file_type

                try:
                    mtime = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
                except (OSError, ValueError):
                    mtime = None

                path_upper = full_path.upper()
                production_role = classify_production_role(path_upper)
                publication, issue_number, story, version, stage = parse_filename(fname, full_path)

                type_counter[file_type] += 1
                if publication:
                    pub_counter[publication] += 1
                if stage:
                    stage_counter[stage] += 1

                batch.append((
                    full_path, fname, dirpath, ext_lower, size,
                    None,  # hash computed in phase 2
                    mtime, file_type_db, production_role,
                    publication, issue_number, story, version, stage,
                    source_label,
                ))
                total_inserted += 1

                if len(batch) >= BATCH_SIZE:
                    _insert_batch(conn, batch)
                    batch.clear()

    if batch:
        _insert_batch(conn, batch)
        batch.clear()

    elapsed = time.time() - t_start
    log()
    log(f"  Phase 1 done in {elapsed:.1f}s")
    log(f"  Files walked: {total_scanned:,}  |  New: {total_inserted:,}  |  "
        f"Existing: {total_skipped_existing:,}  |  Small: {total_skipped_small:,}")
    log(f"  Total size of new files: {total_size / (1024**3):.2f} GB")
    log()

    return type_counter, pub_counter, stage_counter, total_scanned, total_inserted, total_size


# ── Phase 2: Hash pass ──────────────────────────────────────────────────────

def phase2_hash(conn):
    """Compute SHA-256 for files that don't have one yet (skip >50MB)."""
    log("=" * 65)
    log("  PHASE 2: Computing SHA-256 hashes")
    log("=" * 65)

    cur = conn.execute("""
        SELECT id, file_path, file_size_bytes
        FROM production_files
        WHERE content_hash_sha256 IS NULL
          AND file_size_bytes <= ?
        ORDER BY file_size_bytes ASC
    """, (LARGE_FILE_THRESHOLD,))
    rows = cur.fetchall()
    total = len(rows)
    log(f"  {total:,} files to hash (skipping {_count_large(conn):,} files > 50MB)")

    hashed = 0
    failed = 0
    dup_counter = 0
    hash_set = {}
    t_start = time.time()

    for i, (row_id, fpath, fsize) in enumerate(rows):
        if (i + 1) % PROGRESS_INTERVAL == 0:
            elapsed = time.time() - t_start
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            log(f"    ... {i+1:,}/{total:,} hashed [{rate:.0f} files/s]")

        h = sha256_file(fpath, file_size=fsize)
        if h:
            conn.execute("UPDATE production_files SET content_hash_sha256=? WHERE id=?", (h, row_id))
            hashed += 1
            if h in hash_set:
                dup_counter += 1
            else:
                hash_set[h] = fpath
        else:
            # Mark as failed
            conn.execute(
                "UPDATE production_files SET file_type = file_type || ' (hash failed)' WHERE id=?",
                (row_id,)
            )
            failed += 1

        if (i + 1) % HASH_BATCH == 0:
            conn.commit()

    conn.commit()
    elapsed = time.time() - t_start
    log()
    log(f"  Phase 2 done in {elapsed:.1f}s")
    log(f"  Hashed: {hashed:,}  |  Failed: {failed:,}  |  Duplicates: {dup_counter:,}")
    log()
    return dup_counter


def _count_large(conn):
    cur = conn.execute(
        "SELECT COUNT(*) FROM production_files WHERE file_size_bytes > ?",
        (LARGE_FILE_THRESHOLD,)
    )
    return cur.fetchone()[0]


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    log(f"Archive scanner starting at {datetime.now().isoformat()}")
    log(f"Database: {DB_PATH}")
    log()

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    init_db(conn)

    existing_paths = load_existing_paths(conn)
    log(f"Already indexed: {len(existing_paths):,} files")
    log()

    # Phase 1: catalog
    type_counter, pub_counter, stage_counter, total_walked, total_new, total_size = \
        phase1_catalog(conn, existing_paths)

    # Phase 2: hashing (optional — only with --hash flag)
    dup_counter = 0
    if "--hash" in sys.argv:
        dup_counter = phase2_hash(conn)
    else:
        log("  Skipping hash phase (run with --hash to compute SHA-256 hashes)")
        log()

    conn.close()

    # Cross-source duplicates
    dup_cross = _count_cross_duplicates()

    # Final summary
    # Re-query for accurate totals
    conn2 = sqlite3.connect(DB_PATH)
    total_db = conn2.execute("SELECT COUNT(*) FROM production_files").fetchone()[0]

    # Merge in existing data for type counts
    for row in conn2.execute("SELECT file_type, COUNT(*) FROM production_files GROUP BY file_type"):
        pass  # type_counter already has this run's data

    type_rows = conn2.execute(
        "SELECT CASE WHEN file_type LIKE '%(large%' OR file_type LIKE '%(hash%' "
        "THEN SUBSTR(file_type, 1, INSTR(file_type, ' (') - 1) "
        "ELSE file_type END AS base_type, COUNT(*) "
        "FROM production_files GROUP BY base_type ORDER BY COUNT(*) DESC"
    ).fetchall()

    pub_rows = conn2.execute(
        "SELECT parsed_publication, COUNT(*) FROM production_files "
        "WHERE parsed_publication IS NOT NULL GROUP BY parsed_publication ORDER BY COUNT(*) DESC"
    ).fetchall()

    stage_rows = conn2.execute(
        "SELECT parsed_stage, COUNT(*) FROM production_files "
        "WHERE parsed_stage IS NOT NULL GROUP BY parsed_stage ORDER BY COUNT(*) DESC"
    ).fetchall()

    total_size_db = conn2.execute("SELECT SUM(file_size_bytes) FROM production_files").fetchone()[0] or 0

    conn2.close()
    conn2_reopen = sqlite3.connect(DB_PATH)

    log("=" * 65)
    log("  ARCHIVE SCAN COMPLETE — FINAL SUMMARY")
    log("=" * 65)
    log(f"  Total files in DB:  {total_db:,}")
    log(f"  Total size:         {total_size_db / (1024**3):.2f} GB")
    log()
    log("  FILES BY TYPE:")
    for t, c in type_rows:
        log(f"    {t:<20s} {c:>7,}")
    log()
    log("  FILES BY PUBLICATION:")
    if pub_rows:
        for p, c in pub_rows:
            log(f"    {p:<20s} {c:>7,}")
    else:
        log("    (none matched)")
    log()
    log("  FILES BY PRODUCTION STAGE:")
    if stage_rows:
        for s, c in stage_rows:
            log(f"    {s:<20s} {c:>7,}")
    else:
        log("    (none matched)")
    log()
    # Size-based potential duplicates (files with same name + size in different dirs)
    dup_size = conn2_reopen.execute("""
        SELECT COUNT(*) FROM (
            SELECT filename, file_size_bytes
            FROM production_files
            GROUP BY filename, file_size_bytes
            HAVING COUNT(DISTINCT directory) > 1
        )
    """).fetchone()[0]
    conn2_reopen.close()

    if dup_counter > 0:
        log(f"  Duplicates (same hash, different path): {dup_counter:,}")
    log(f"  Potential duplicates (same name+size):  {dup_size:,}")
    log(f"  Cross-source duplicates in DB:          {dup_cross:,}")
    log("=" * 65)


def _insert_batch(conn, batch):
    conn.executemany("""
        INSERT OR IGNORE INTO production_files (
            file_path, filename, directory, file_extension, file_size_bytes,
            content_hash_sha256, file_modified_at, file_type, production_role,
            parsed_publication, parsed_issue_number, parsed_story,
            parsed_version, parsed_stage, source_directory
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, batch)
    conn.commit()


def _count_cross_duplicates():
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT content_hash_sha256
                FROM production_files
                WHERE content_hash_sha256 IS NOT NULL
                GROUP BY content_hash_sha256
                HAVING COUNT(DISTINCT source_directory) > 1
            )
        """)
        n = cur.fetchone()[0]
        conn.close()
        return n
    except Exception:
        return 0


if __name__ == "__main__":
    main()
