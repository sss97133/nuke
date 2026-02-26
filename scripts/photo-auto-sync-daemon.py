#!/Library/Frameworks/Python.framework/Versions/3.13/bin/python3
"""
Nuke Photo Auto-Sync Daemon
============================
Always-running background service that watches Apple Photos for new images,
uploads them to Nuke, classifies with AI, matches to vehicles, manages albums,
and texts the user when clarification is needed.

Usage:
  python3 photo-auto-sync-daemon.py                  # Run daemon
  python3 photo-auto-sync-daemon.py --once            # Single poll cycle
  python3 photo-auto-sync-daemon.py --backfill 2      # Process last N days
  python3 photo-auto-sync-daemon.py --reprocess       # Reprocess stuck pending images
  python3 photo-auto-sync-daemon.py --status           # Show sync status

Runs as LaunchAgent: com.nuke.photo-auto-sync
"""

import os
import re
import sys
import json
import time
import uuid
import base64
import hashlib
import sqlite3
import signal
import subprocess
import tempfile
import logging
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field

import requests
from PIL import Image
import pillow_heif

# Register HEIF support
pillow_heif.register_heif_opener()

# Local modules
sys.path.insert(0, str(Path(__file__).parent))
from photo_sync_messenger import MessageDispatcher, create_dispatcher, build_clarification_message
from photo_sync_album_manager import (
    ensure_album_for_vehicle, add_photos_to_album,
    full_album_scan, parse_album_name, generate_album_name, list_albums
)

# Core Data epoch offset (2001-01-01 00:00:00 UTC - Unix epoch)
CORE_DATA_EPOCH = 978307200

PHOTOS_LIBRARY = Path.home() / "Pictures" / "Photos Library.photoslibrary"
PHOTOS_DB_PATH = PHOTOS_LIBRARY / "database" / "Photos.sqlite"
PHOTOS_DB_SNAPSHOT = Path.home() / ".nuke" / "photos-db-snapshot" / "Photos.sqlite"
PHOTOS_ORIGINALS = PHOTOS_LIBRARY / "originals"


@dataclass
class PhotoRecord:
    """Lightweight photo record from direct SQLite access to Photos.sqlite.
    Mirrors the osxphotos PhotoInfo interface used by the rest of the daemon."""
    uuid: str
    filename: str
    original_filename: str
    directory: str
    date: Optional[datetime]
    date_added: Optional[datetime]
    width: int
    height: int
    latitude: Optional[float]
    longitude: Optional[float]
    screenshot: bool
    uti: str
    album_names: List[str] = field(default_factory=list)
    _z_pk: int = 0  # internal primary key for joins

    @property
    def path(self) -> Optional[str]:
        """Resolve to file on disk within Photos library originals."""
        p = PHOTOS_ORIGINALS / self.directory / self.filename
        if p.exists():
            return str(p)
        return None

    @property
    def album_info(self):
        """Compatibility shim — returns objects with .title attribute."""
        @dataclass
        class _AlbumStub:
            title: str
        return [_AlbumStub(title=n) for n in self.album_names]

    @property
    def exif_info(self):
        return None  # Direct SQLite doesn't have parsed EXIF; PIL handles it later

# ============================================================================
# CONFIGURATION
# ============================================================================

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
USER_ID = os.getenv('NUKE_USER_ID', '0b9f107a-d124-49de-9ded-94698f63c1c4')  # Default: Skylar

POLL_INTERVAL = int(os.getenv('PHOTO_SYNC_POLL_INTERVAL', '60'))
BATCH_SIZE = int(os.getenv('PHOTO_SYNC_BATCH_SIZE', '10'))
MAX_IMAGE_DIM = 2000
JPEG_QUALITY = 90
STORAGE_BUCKET = 'vehicle-data'
STATE_DB = Path.home() / '.nuke' / 'photo-sync-state.db'
VISION_CLASSIFIER = Path(__file__).parent / 'apple-vision-classifier'  # Compiled Swift binary
VEHICLE_CONFIDENCE_THRESHOLD = float(os.getenv('PHOTO_SYNC_VEHICLE_THRESHOLD', '0.1'))
ENABLE_PREFILTER = os.getenv('PHOTO_SYNC_PREFILTER', '1') == '1'
VERSION = '1.2.0'

HEADERS = {
    'apikey': SUPABASE_KEY or '',
    'Authorization': f'Bearer {SUPABASE_KEY}' if SUPABASE_KEY else '',
    'Content-Type': 'application/json',
}

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('photo-auto-sync')

# Graceful shutdown
_running = True
def _signal_handler(sig, frame):
    global _running
    logger.info(f"Received signal {sig}, shutting down...")
    _running = False

signal.signal(signal.SIGTERM, _signal_handler)
signal.signal(signal.SIGINT, _signal_handler)


# ============================================================================
# LOCAL STATE (SQLite)
# ============================================================================

def init_state_db():
    """Initialize local SQLite state database."""
    STATE_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(STATE_DB))
    conn.execute('''CREATE TABLE IF NOT EXISTS watermark (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS processed_photos (
        photos_uuid TEXT PRIMARY KEY,
        date_added TEXT,
        sync_status TEXT DEFAULT 'detected',
        vehicle_image_id TEXT,
        vehicle_id TEXT,
        file_hash TEXT,
        processed_at TEXT
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS vision_classifications (
        photos_uuid TEXT PRIMARY KEY,
        is_vehicle INTEGER,
        max_core_confidence REAL,
        total_vehicle_confidence REAL,
        top_labels TEXT,
        classified_at TEXT
    )''')
    conn.commit()
    conn.close()


def get_watermark() -> Optional[datetime]:
    """Get the last processed date watermark."""
    conn = sqlite3.connect(str(STATE_DB))
    row = conn.execute("SELECT value FROM watermark WHERE key = 'last_processed_date'").fetchone()
    conn.close()
    if row and row[0]:
        return datetime.fromisoformat(row[0])
    return None


def set_watermark(dt: datetime):
    """Update the watermark."""
    conn = sqlite3.connect(str(STATE_DB))
    conn.execute(
        "INSERT OR REPLACE INTO watermark (key, value, updated_at) VALUES (?, ?, ?)",
        ('last_processed_date', dt.isoformat(), datetime.now(timezone.utc).isoformat())
    )
    conn.commit()
    conn.close()


def is_processed(photos_uuid: str) -> bool:
    """Check if a photo UUID was already processed."""
    conn = sqlite3.connect(str(STATE_DB))
    row = conn.execute(
        "SELECT sync_status FROM processed_photos WHERE photos_uuid = ?",
        (photos_uuid,)
    ).fetchone()
    conn.close()
    return row is not None and row[0] in ('complete', 'duplicate', 'ignored')


def mark_processed(photos_uuid: str, status: str, **kwargs):
    """Record a processed photo in local state."""
    conn = sqlite3.connect(str(STATE_DB))
    conn.execute(
        """INSERT OR REPLACE INTO processed_photos
           (photos_uuid, date_added, sync_status, vehicle_image_id, vehicle_id, file_hash, processed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            photos_uuid,
            kwargs.get('date_added'),
            status,
            kwargs.get('vehicle_image_id'),
            kwargs.get('vehicle_id'),
            kwargs.get('file_hash'),
            datetime.now(timezone.utc).isoformat()
        )
    )
    conn.commit()
    conn.close()


# ============================================================================
# APPLE VISION PRE-FILTER
# ============================================================================

# Vehicle-related labels from Apple Vision VNClassifyImageRequest
CORE_VEHICLE_LABELS = {
    "automobile", "car", "convertible", "engine_vehicle", "formula_one_car",
    "jeep", "motorcycle", "motorhome", "motorsport", "nascar",
    "sportscar", "suv", "truck", "van", "vehicle",
    "bus", "firetruck", "police_car", "semi_truck", "streetcar", "atv"
}
SUPPORTING_VEHICLE_LABELS = {
    "garage", "parking_lot", "road", "driveway", "dirt_road",
    "road_other", "road_safety_equipment", "tire", "wheel",
    "car_seat", "dashboard"
}
ALL_VEHICLE_LABELS = CORE_VEHICLE_LABELS | SUPPORTING_VEHICLE_LABELS


def _get_cached_classification(photos_uuid: str) -> Optional[Dict]:
    """Check if we already classified this photo."""
    try:
        conn = sqlite3.connect(str(STATE_DB))
        row = conn.execute(
            "SELECT is_vehicle, max_core_confidence, total_vehicle_confidence, top_labels FROM vision_classifications WHERE photos_uuid = ?",
            (photos_uuid,)
        ).fetchone()
        conn.close()
        if row:
            return {
                'is_vehicle': bool(row[0]),
                'max_core_confidence': row[1],
                'total_vehicle_confidence': row[2],
                'top_labels': json.loads(row[3]) if row[3] else [],
            }
    except Exception:
        pass
    return None


def _cache_classification(photos_uuid: str, is_vehicle: bool, max_core: float, total_vehicle: float, top_labels: list):
    """Cache classification result locally."""
    try:
        conn = sqlite3.connect(str(STATE_DB))
        conn.execute(
            """INSERT OR REPLACE INTO vision_classifications
               (photos_uuid, is_vehicle, max_core_confidence, total_vehicle_confidence, top_labels, classified_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (photos_uuid, int(is_vehicle), max_core, total_vehicle,
             json.dumps(top_labels), datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def classify_photos_batch(photos: List) -> Dict[str, Dict]:
    """Classify a batch of photos using Apple Vision via compiled Swift binary.

    Returns dict mapping photos_uuid -> classification result.
    Uses local cache to avoid re-classifying.
    """
    results = {}
    uncached = []

    # Check cache first
    for photo in photos:
        cached = _get_cached_classification(photo.uuid)
        if cached is not None:
            results[photo.uuid] = cached
        else:
            uncached.append(photo)

    if not uncached:
        return results

    # Build file list for Swift classifier
    paths_by_uuid = {}
    valid_photos = []
    for photo in uncached:
        path = photo.path
        if path:
            paths_by_uuid[path] = photo.uuid
            valid_photos.append((photo.uuid, path))

    if not valid_photos:
        return results

    # Write paths to temp file
    list_file = Path(tempfile.mktemp(suffix='.txt', prefix='nuke_classify_'))
    try:
        list_file.write_text('\n'.join(p for _, p in valid_photos))

        # Check for compiled binary, fall back to swift interpreter
        classifier_path = VISION_CLASSIFIER
        if classifier_path.exists():
            cmd = [str(classifier_path), '--classify', str(list_file), '--threshold', str(VEHICLE_CONFIDENCE_THRESHOLD), '--json']
        else:
            swift_src = Path(__file__).parent / 'apple-vision-classifier.swift'
            if not swift_src.exists():
                logger.warning("Apple Vision classifier not found, skipping pre-filter")
                for photo in uncached:
                    results[photo.uuid] = {'is_vehicle': True, 'max_core_confidence': 1.0, 'total_vehicle_confidence': 1.0, 'top_labels': []}
                return results
            cmd = ['swift', str(swift_src), '--classify', str(list_file), '--threshold', str(VEHICLE_CONFIDENCE_THRESHOLD), '--json']

        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if proc.returncode != 0:
            logger.warning(f"Vision classifier failed: {proc.stderr[:200]}")
            for photo in uncached:
                results[photo.uuid] = {'is_vehicle': True, 'max_core_confidence': 1.0, 'total_vehicle_confidence': 1.0, 'top_labels': []}
            return results

        # Parse JSONL output — one JSON object per line per image
        for line in proc.stdout.split('\n'):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            filename = obj.get('file', '')
            if obj.get('skip'):
                continue

            is_vehicle = obj.get('vehicle', False)
            max_core = obj.get('max_core', 0.0)
            total_vehicle = obj.get('total_vehicle', 0.0)
            auto_labels = obj.get('auto_labels', {})
            top3 = list(obj.get('top3', {}).items())

            # Match filename back to UUID
            for photo_uuid, photo_path in valid_photos:
                if Path(photo_path).name == filename:
                    result = {
                        'is_vehicle': is_vehicle,
                        'max_core_confidence': max_core,
                        'total_vehicle_confidence': total_vehicle,
                        'top_labels': top3,
                        'auto_labels': auto_labels,
                    }
                    results[photo_uuid] = result
                    _cache_classification(photo_uuid, is_vehicle, max_core, total_vehicle, top3)
                    break

        # Any photos not in results (parse failure) — pass through
        for photo in uncached:
            if photo.uuid not in results:
                results[photo.uuid] = {'is_vehicle': True, 'max_core_confidence': 1.0, 'total_vehicle_confidence': 1.0, 'top_labels': []}

    except subprocess.TimeoutExpired:
        logger.warning("Vision classifier timed out, passing all through")
        for photo in uncached:
            results[photo.uuid] = {'is_vehicle': True, 'max_core_confidence': 1.0, 'total_vehicle_confidence': 1.0, 'top_labels': []}
    except Exception as e:
        logger.warning(f"Vision classifier error: {e}")
        for photo in uncached:
            results[photo.uuid] = {'is_vehicle': True, 'max_core_confidence': 1.0, 'total_vehicle_confidence': 1.0, 'top_labels': []}
    finally:
        list_file.unlink(missing_ok=True)

    return results


# ============================================================================
# PHOTO PROCESSING
# ============================================================================

def _core_data_to_datetime(ts: float) -> Optional[datetime]:
    """Convert Apple Core Data timestamp to Python datetime (UTC)."""
    if ts is None or ts <= 0:
        return None
    return datetime.fromtimestamp(ts + CORE_DATA_EPOCH, tz=timezone.utc)


def _query_photos_db_direct(since_ts: Optional[float]) -> Tuple[List[dict], Dict[int, List[str]]]:
    """Query Photos.sqlite using Python's sqlite3 module (works from Terminal)."""
    conn = sqlite3.connect(f"file:{PHOTOS_DB_PATH}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row

    where_clauses = [
        "a.ZKIND = 0",
        "a.ZTRASHEDSTATE = 0",
        "a.ZISDETECTEDSCREENSHOT = 0",
    ]
    params = []
    if since_ts is not None:
        where_clauses.append("a.ZADDEDDATE > ?")
        params.append(since_ts)

    sql = f"""
        SELECT a.Z_PK, a.ZUUID, a.ZFILENAME, a.ZDIRECTORY,
               a.ZADDEDDATE, a.ZDATECREATED,
               a.ZWIDTH, a.ZHEIGHT, a.ZLATITUDE, a.ZLONGITUDE,
               a.ZUNIFORMTYPEIDENTIFIER,
               b.ZORIGINALFILENAME
        FROM ZASSET a
        LEFT JOIN ZADDITIONALASSETATTRIBUTES b ON b.ZASSET = a.Z_PK
        WHERE {' AND '.join(where_clauses)}
        ORDER BY a.ZADDEDDATE ASC
    """
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]

    # Album map
    album_rows = conn.execute("""
        SELECT ja.Z_3ASSETS, g.ZTITLE
        FROM Z_33ASSETS ja
        JOIN ZGENERICALBUM g ON g.Z_PK = ja.Z_33ALBUMS
        WHERE g.ZKIND = 2 AND g.ZTITLE IS NOT NULL
    """).fetchall()
    conn.close()

    album_map: Dict[int, List[str]] = {}
    for asset_pk, title in album_rows:
        album_map.setdefault(asset_pk, []).append(title)

    return rows, album_map


def _query_photos_db_cli(since_ts: Optional[float]) -> Tuple[List[dict], Dict[int, List[str]]]:
    """Query Photos.sqlite using /usr/bin/sqlite3 CLI (works from launchd).

    When Python's sqlite3 module blocks on TCC, the system sqlite3 binary
    can still access the Photos library as it has implicit Full Disk Access.
    """
    db = str(PHOTOS_DB_PATH)

    where = "a.ZKIND = 0 AND a.ZTRASHEDSTATE = 0 AND a.ZISDETECTEDSCREENSHOT = 0"
    if since_ts is not None:
        where += f" AND a.ZADDEDDATE > {since_ts}"

    photo_sql = f"""
        SELECT a.Z_PK, a.ZUUID, a.ZFILENAME, a.ZDIRECTORY,
               a.ZADDEDDATE, a.ZDATECREATED,
               a.ZWIDTH, a.ZHEIGHT, a.ZLATITUDE, a.ZLONGITUDE,
               a.ZUNIFORMTYPEIDENTIFIER,
               b.ZORIGINALFILENAME
        FROM ZASSET a
        LEFT JOIN ZADDITIONALASSETATTRIBUTES b ON b.ZASSET = a.Z_PK
        WHERE {where}
        ORDER BY a.ZADDEDDATE ASC;
    """

    album_sql = """
        SELECT ja.Z_3ASSETS, g.ZTITLE
        FROM Z_33ASSETS ja
        JOIN ZGENERICALBUM g ON g.Z_PK = ja.Z_33ALBUMS
        WHERE g.ZKIND = 2 AND g.ZTITLE IS NOT NULL;
    """

    # Run both queries via sqlite3 CLI with JSON output
    result = subprocess.run(
        ['/usr/bin/sqlite3', '-json', db, photo_sql],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        logger.error(f"sqlite3 CLI photo query failed: {result.stderr[:200]}")
        return None  # Signal failure so fallback chain continues

    rows = json.loads(result.stdout) if result.stdout.strip() else []

    # Album query
    album_result = subprocess.run(
        ['/usr/bin/sqlite3', '-json', db, album_sql],
        capture_output=True, text=True, timeout=15
    )
    album_map: Dict[int, List[str]] = {}
    if album_result.returncode == 0 and album_result.stdout.strip():
        for row in json.loads(album_result.stdout):
            pk = row.get('Z_3ASSETS')
            title = row.get('ZTITLE')
            if pk and title:
                album_map.setdefault(pk, []).append(title)

    return rows, album_map


def _query_photos_db_via_helper(since_ts: Optional[float]) -> Tuple[List[dict], Dict[int, List[str]]]:
    """Query Photos.sqlite via photos-db-query.sh helper (uses Terminal.app TCC context).

    This is the last resort when both direct Python sqlite3 and sqlite3 CLI are
    blocked by TCC (which happens when running from launchd).
    """
    helper = Path(__file__).parent / 'photos-db-query.sh'
    cache_dir = Path.home() / '.nuke'
    cache_dir.mkdir(parents=True, exist_ok=True)

    db = str(PHOTOS_DB_PATH)

    # Photo query
    where = "a.ZKIND = 0 AND a.ZTRASHEDSTATE = 0 AND a.ZISDETECTEDSCREENSHOT = 0"
    if since_ts is not None:
        where += f" AND a.ZADDEDDATE > {since_ts}"

    photo_sql = (
        f"SELECT a.Z_PK, a.ZUUID, a.ZFILENAME, a.ZDIRECTORY, "
        f"a.ZADDEDDATE, a.ZDATECREATED, a.ZWIDTH, a.ZHEIGHT, "
        f"a.ZLATITUDE, a.ZLONGITUDE, a.ZUNIFORMTYPEIDENTIFIER, "
        f"b.ZORIGINALFILENAME "
        f"FROM ZASSET a LEFT JOIN ZADDITIONALASSETATTRIBUTES b ON b.ZASSET = a.Z_PK "
        f"WHERE {where} ORDER BY a.ZADDEDDATE ASC"
    )

    photo_cache = cache_dir / 'photos-query-cache.json'
    result = subprocess.run(
        [str(helper), photo_sql, str(photo_cache)],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        logger.error(f"photos-db-query.sh failed (rc={result.returncode})")
        return [], {}

    rows = json.loads(photo_cache.read_text()) if photo_cache.exists() and photo_cache.stat().st_size > 0 else []

    # Album query
    album_sql = (
        "SELECT ja.Z_3ASSETS, g.ZTITLE FROM Z_33ASSETS ja "
        "JOIN ZGENERICALBUM g ON g.Z_PK = ja.Z_33ALBUMS "
        "WHERE g.ZKIND = 2 AND g.ZTITLE IS NOT NULL"
    )
    album_cache = cache_dir / 'albums-query-cache.json'
    subprocess.run(
        [str(helper), album_sql, str(album_cache)],
        capture_output=True, text=True, timeout=30
    )
    album_map: Dict[int, List[str]] = {}
    if album_cache.exists() and album_cache.stat().st_size > 0:
        for row in json.loads(album_cache.read_text()):
            pk = row.get('Z_3ASSETS')
            title = row.get('ZTITLE')
            if pk and title:
                album_map.setdefault(pk, []).append(title)

    return rows, album_map


def _query_photos_db_snapshot(since_ts: Optional[float]) -> Optional[Tuple[List[dict], Dict[int, List[str]]]]:
    """Query the Photos.sqlite snapshot at ~/.nuke/photos-db-snapshot/.

    The snapshot is created by photos-db-snapshot.sh running from a context
    with Full Disk Access (cron/Terminal). This avoids all TCC issues.
    """
    if not PHOTOS_DB_SNAPSHOT.exists():
        return None

    # Check freshness — skip if snapshot is more than 5 minutes old
    last_snapshot = PHOTOS_DB_SNAPSHOT.parent / "last-snapshot"
    if last_snapshot.exists():
        try:
            ts = datetime.fromisoformat(last_snapshot.read_text().strip())
            age = (datetime.now(timezone.utc) - ts).total_seconds()
            if age > 300:
                logger.info(f"  Snapshot is {int(age)}s old, refreshing...")
                # Try to refresh the snapshot
                try:
                    subprocess.run(
                        [str(Path(__file__).parent / 'photos-db-snapshot.sh')],
                        capture_output=True, timeout=30
                    )
                except Exception:
                    pass
        except Exception:
            pass

    try:
        conn = sqlite3.connect(f"file:{PHOTOS_DB_SNAPSHOT}?mode=ro", uri=True, timeout=10)
        conn.row_factory = sqlite3.Row

        where_clauses = [
            "a.ZKIND = 0",
            "a.ZTRASHEDSTATE = 0",
            "a.ZISDETECTEDSCREENSHOT = 0",
        ]
        params = []
        if since_ts is not None:
            where_clauses.append("a.ZADDEDDATE > ?")
            params.append(since_ts)

        sql = f"""
            SELECT a.Z_PK, a.ZUUID, a.ZFILENAME, a.ZDIRECTORY,
                   a.ZADDEDDATE, a.ZDATECREATED,
                   a.ZWIDTH, a.ZHEIGHT, a.ZLATITUDE, a.ZLONGITUDE,
                   a.ZUNIFORMTYPEIDENTIFIER,
                   b.ZORIGINALFILENAME
            FROM ZASSET a
            LEFT JOIN ZADDITIONALASSETATTRIBUTES b ON b.ZASSET = a.Z_PK
            WHERE {' AND '.join(where_clauses)}
            ORDER BY a.ZADDEDDATE ASC
        """
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]

        album_rows = conn.execute("""
            SELECT ja.Z_3ASSETS, g.ZTITLE
            FROM Z_33ASSETS ja
            JOIN ZGENERICALBUM g ON g.Z_PK = ja.Z_33ALBUMS
            WHERE g.ZKIND = 2 AND g.ZTITLE IS NOT NULL
        """).fetchall()
        conn.close()

        album_map: Dict[int, List[str]] = {}
        for asset_pk, title in album_rows:
            album_map.setdefault(asset_pk, []).append(title)

        return rows, album_map
    except Exception as e:
        logger.warning(f"  Snapshot query error: {e}")
        return None


_tcc_direct_works = None  # Cached after first attempt

def _query_photos_db(since_ts: Optional[float]) -> Tuple[List[dict], Dict[int, List[str]]]:
    """Query Photos.sqlite — tries snapshot, direct access, CLI, then osascript helper.

    Caches whether direct access works to avoid 5s timeout on every poll cycle.
    """
    global _tcc_direct_works
    import threading

    # Fastest path: read from snapshot (no TCC issues)
    snapshot_result = _query_photos_db_snapshot(since_ts)
    if snapshot_result is not None:
        rows, album_map = snapshot_result
        logger.info(f"  Query (snapshot): {len(rows)} candidates")
        return rows, album_map

    # If we already know direct access works (or haven't tested yet), try it
    if _tcc_direct_works is not False:
        result_holder = [None]

        def _try_direct():
            try:
                result_holder[0] = _query_photos_db_direct(since_ts)
            except Exception:
                pass

        t = threading.Thread(target=_try_direct, daemon=True)
        t.start()
        t.join(timeout=5)

        if result_holder[0] is not None:
            _tcc_direct_works = True
            rows, album_map = result_holder[0]
            logger.info(f"  Query: {len(rows)} candidates")
            return rows, album_map

        if _tcc_direct_works is None:
            _tcc_direct_works = False
            logger.info("  Photos library access blocked by TCC")
            logger.info("  Run: python3 scripts/photo-auto-sync-daemon.py --setup")

    # Direct access blocked — try CLI with short timeout
    try:
        cli_holder = [None]

        def _try_cli():
            try:
                cli_holder[0] = _query_photos_db_cli(since_ts)
            except Exception:
                pass

        t2 = threading.Thread(target=_try_cli, daemon=True)
        t2.start()
        t2.join(timeout=10)

        if cli_holder[0] is not None:
            rows, album_map = cli_holder[0]
            logger.info(f"  Query (CLI): {len(rows)} candidates")
            return rows, album_map
    except Exception:
        pass

    # Third fallback: helper script using osascript (inherits user's TCC grants)
    try:
        helper_holder = [None]

        def _try_helper():
            try:
                helper_holder[0] = _query_photos_db_via_helper(since_ts)
            except Exception:
                pass

        t3 = threading.Thread(target=_try_helper, daemon=True)
        t3.start()
        t3.join(timeout=30)

        if helper_holder[0] is not None:
            rows, album_map = helper_holder[0]
            logger.info(f"  Query (osascript): {len(rows)} candidates")
            return rows, album_map
    except Exception:
        pass

    # All methods failed — log guidance once every 10 minutes
    if not hasattr(_query_photos_db, '_last_warn') or \
       time.time() - _query_photos_db._last_warn > 600:
        logger.error("  Cannot access Photos library. Grant Full Disk Access to Python.app:")
        logger.error("  System Settings > Privacy & Security > Full Disk Access")
        logger.error("  Path: /Library/Frameworks/Python.framework/Versions/3.13/Resources/Python.app")
        _query_photos_db._last_warn = time.time()

    return [], {}


def get_new_photos(since: Optional[datetime] = None, limit: int = 200) -> List[PhotoRecord]:
    """Get new photos from Apple Photos library since watermark.

    Uses direct SQLite access to Photos.sqlite — works from launchd without
    TCC Photos permission (which osxphotos requires but can't get from launchd).
    """
    logger.info("Scanning Photos library...")

    if not PHOTOS_DB_PATH.exists():
        logger.error(f"Photos database not found: {PHOTOS_DB_PATH}")
        return []

    # Convert watermark to Core Data timestamp for SQL filter
    since_ts = None
    if since:
        since_ts = since.timestamp() - CORE_DATA_EPOCH

    # Try direct Python sqlite3 first (works from Terminal), fall back to
    # sqlite3 CLI subprocess (works from launchd where TCC blocks direct access)
    rows, album_map = _query_photos_db(since_ts)

    new_photos = []
    for row in rows:
        date_added = _core_data_to_datetime(row['ZADDEDDATE'])
        if not date_added:
            continue

        photo_uuid = row['ZUUID']

        # Skip already processed
        if is_processed(photo_uuid):
            continue

        # Build file path and check it exists locally (not iCloud-only)
        directory = row['ZDIRECTORY'] or ''
        filename = row['ZFILENAME'] or ''
        file_path = PHOTOS_ORIGINALS / directory / filename
        if not file_path.exists():
            continue

        # Lat/lon: Apple uses -180.0 as sentinel for "no location"
        lat = row['ZLATITUDE']
        lon = row['ZLONGITUDE']
        if lat is not None and abs(lat) >= 180:
            lat = None
        if lon is not None and abs(lon) >= 180:
            lon = None

        photo = PhotoRecord(
            uuid=photo_uuid,
            filename=filename,
            original_filename=row['ZORIGINALFILENAME'] or filename,
            directory=directory,
            date=_core_data_to_datetime(row['ZDATECREATED']),
            date_added=date_added,
            width=row['ZWIDTH'] or 0,
            height=row['ZHEIGHT'] or 0,
            latitude=lat,
            longitude=lon,
            screenshot=False,  # Already filtered in SQL
            uti=row['ZUNIFORMTYPEIDENTIFIER'] or '',
            album_names=album_map.get(row['Z_PK'], []),
            _z_pk=row['Z_PK'],
        )

        new_photos.append(photo)
        if len(new_photos) >= limit:
            break

    logger.info(f"Found {len(new_photos)} new photos")
    return new_photos


def get_photo_albums(photo) -> List[str]:
    """Get album names for a photo."""
    try:
        return [a.title for a in photo.album_info if a.title]
    except Exception:
        return []


def export_and_convert(photo, export_dir: Path) -> Optional[Tuple[Path, Dict]]:
    """Read photo directly from Photos library and convert to JPEG if needed."""
    try:
        src_path = photo.path
        if not src_path or not Path(src_path).exists():
            logger.warning(f"No local file for {photo.uuid}")
            return None

        file_path = Path(src_path)

        # Convert to JPEG — copy to export_dir first
        jpeg_name = f"{photo.uuid}.jpg"
        jpeg_path = export_dir / jpeg_name

        try:
            img = Image.open(file_path)
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            # Resize if too large
            if max(img.size) > MAX_IMAGE_DIM:
                ratio = MAX_IMAGE_DIM / max(img.size)
                new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                img = img.resize(new_size, Image.Resampling.LANCZOS)

            img.save(jpeg_path, 'JPEG', quality=JPEG_QUALITY)
            file_path = jpeg_path
        except Exception as e:
            logger.warning(f"Convert error for {photo.uuid}: {e}")
            # If conversion fails but file exists, copy it directly
            if Path(src_path).suffix.lower() in ['.jpg', '.jpeg']:
                import shutil
                shutil.copy2(src_path, export_dir / Path(src_path).name)
                file_path = export_dir / Path(src_path).name
            else:
                return None

        metadata = {
            'uuid': photo.uuid,
            'original_filename': photo.original_filename or photo.filename,
            'date_taken': photo.date.isoformat() if photo.date else None,
            'date_added': photo.date_added.isoformat() if photo.date_added else None,
            'width': photo.width,
            'height': photo.height,
            'latitude': photo.latitude,
            'longitude': photo.longitude,
            'albums': get_photo_albums(photo),
        }

        if photo.exif_info:
            metadata['camera_make'] = photo.exif_info.camera_make
            metadata['camera_model'] = photo.exif_info.camera_model

        return file_path, metadata

    except Exception as e:
        logger.error(f"Export error: {e}")
        return None


def compute_hash(file_path: Path) -> str:
    """Compute SHA-256 hash of file."""
    h = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            h.update(chunk)
    return h.hexdigest()


def check_duplicate(file_hash: str) -> bool:
    """Check if file hash already exists in Supabase."""
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/vehicle_images",
            headers=HEADERS,
            params={
                'file_hash': f'eq.{file_hash}',
                'select': 'id',
                'limit': '1'
            },
            timeout=10
        )
        if resp.status_code == 200:
            return len(resp.json()) > 0
    except Exception:
        pass

    # Also check photo_sync_items
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/photo_sync_items",
            headers=HEADERS,
            params={
                'file_hash_sha256': f'eq.{file_hash}',
                'select': 'id',
                'limit': '1'
            },
            timeout=10
        )
        if resp.status_code == 200:
            return len(resp.json()) > 0
    except Exception:
        pass

    return False


def upload_to_storage(file_path: Path, file_hash: str) -> Optional[str]:
    """Upload file to Supabase Storage. Returns public URL."""
    ext = file_path.suffix.lower() or '.jpg'
    storage_name = f"users/{USER_ID}/auto-sync/{file_hash[:12]}{ext}"
    storage_url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_name}"

    try:
        content_type = 'image/jpeg' if ext in ['.jpg', '.jpeg'] else f'image/{ext.lstrip(".")}'
        public_url = f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{storage_name}"
        with open(file_path, 'rb') as f:
            file_data = f.read()

        # Try upsert first (x-upsert header)
        resp = requests.post(
            storage_url,
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': content_type,
                'x-upsert': 'true',
            },
            data=file_data,
            timeout=60
        )

        if resp.status_code in (200, 201):
            return public_url
        elif resp.status_code in (400, 409) and 'Duplicate' in resp.text:
            # Already exists — that's fine
            return public_url
        else:
            logger.warning(f"Storage upload failed ({resp.status_code}): {resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"Upload error: {e}")
        return None


def create_vehicle_image_record(
    image_url: str, file_hash: str, metadata: Dict,
    vehicle_id: str = None
) -> Optional[str]:
    """Create vehicle_images record via direct SQL (bypasses heavy triggers).

    The vehicle_images table has 17+ triggers including refresh_tier_on_image_upload
    which computes platform tiers by joining 4 large tables. Using direct SQL with
    triggers disabled makes inserts instant instead of timing out.
    """
    taken_at = metadata.get('date_taken') or 'NULL'
    if taken_at != 'NULL':
        taken_at = f"'{taken_at}'"

    vid = f"'{vehicle_id}'" if vehicle_id else 'NULL'
    lat = str(metadata.get('latitude')) if metadata.get('latitude') else 'NULL'
    lon = str(metadata.get('longitude')) if metadata.get('longitude') else 'NULL'
    org_status = 'organized' if vehicle_id else 'unorganized'

    # Build exif JSON in structured format expected by the system
    exif = {}

    # Camera info — nested format (exif.camera.make / exif.camera.model)
    camera = {}
    if metadata.get('camera_make'):
        camera['make'] = metadata['camera_make']
    if metadata.get('camera_model'):
        camera['model'] = metadata['camera_model']
    if camera:
        exif['camera'] = camera

    # Apple Photos UUID for traceability
    if metadata.get('uuid'):
        exif['photos_uuid'] = metadata['uuid']

    # Real photo date from Photos library
    if metadata.get('date_taken'):
        exif['DateTimeOriginal'] = metadata['date_taken']
        exif['exif_status'] = 'synced_from_photos'
    else:
        exif['exif_status'] = 'unknown'

    # GPS — nested format (exif.location.latitude / longitude)
    if metadata.get('latitude') and metadata.get('longitude'):
        exif['location'] = {
            'latitude': metadata['latitude'],
            'longitude': metadata['longitude'],
        }

    exif_json = json.dumps(exif).replace("'", "''") if exif else None
    exif_val = f"'{exif_json}'::jsonb" if exif_json else 'NULL'

    # Escape strings for SQL
    safe_url = image_url.replace("'", "''")
    safe_hash = file_hash.replace("'", "''")
    safe_filename = (metadata.get('original_filename') or '').replace("'", "''")

    insert_sql = (
        f"INSERT INTO vehicle_images ("
        f"user_id, vehicle_id, image_url, source, is_external, file_hash, filename, "
        f"taken_at, latitude, longitude, exif_data, "
        f"ai_processing_status, organization_status"
        f") VALUES ("
        f"'{USER_ID}', {vid}, '{safe_url}', 'photo_auto_sync', false, '{safe_hash}', '{safe_filename}', "
        f"{taken_at}, {lat}, {lon}, {exif_val}, "
        f"'pending', '{org_status}'"
        f") RETURNING id;"
    )

    try:
        db_password = os.getenv('SUPABASE_DB_PASSWORD', 'RbzKq32A0uhqvJMQ')
        result = subprocess.run(
            ['psql', '-h', 'aws-0-us-west-1.pooler.supabase.com', '-p', '6543',
             '-U', 'postgres.qkgaybvrernstplzjaam', '-d', 'postgres',
             '-t', '-A',
             '-c', "SET statement_timeout = '15s';",
             '-c', 'ALTER TABLE vehicle_images DISABLE TRIGGER USER;',
             '-c', insert_sql,
             '-c', 'ALTER TABLE vehicle_images ENABLE TRIGGER USER;'],
            capture_output=True, text=True, timeout=20,
            env={**os.environ, 'PGPASSWORD': db_password}
        )
        if result.returncode == 0:
            # Parse the UUID from output — filter out SET/ALTER TABLE noise
            output = result.stdout.strip()
            for line in output.split('\n'):
                line = line.strip()
                if len(line) == 36 and line.count('-') == 4:
                    return line
            # If we get here, the insert succeeded but we couldn't parse the UUID
            # Check stderr for clues
            if result.stderr:
                logger.warning(f"psql stderr: {result.stderr[:200]}")
            logger.warning(f"Could not parse UUID from psql output: {output[:100]}")
        else:
            logger.warning(f"psql error: {result.stderr[:200]}")
    except subprocess.TimeoutExpired:
        logger.warning("psql insert timed out")
    except Exception as e:
        logger.error(f"Record insert error: {e}")

    return None


def record_sync_item(
    photos_uuid: str, metadata: Dict, file_hash: str,
    status: str, image_url: str = None, vehicle_image_id: str = None
):
    """Record sync item in Supabase for tracking."""
    try:
        record = {
            'user_id': USER_ID,
            'photos_uuid': photos_uuid,
            'photos_filename': metadata.get('original_filename'),
            'photos_date_added': metadata.get('date_added'),
            'photos_date_taken': metadata.get('date_taken'),
            'photos_album_names': metadata.get('albums', []),
            'file_hash_sha256': file_hash,
            'sync_status': status,
            'storage_url': image_url,
            'vehicle_image_id': vehicle_image_id,
        }
        requests.post(
            f"{SUPABASE_URL}/rest/v1/photo_sync_items",
            headers={**HEADERS, 'Prefer': 'resolution=merge-duplicates'},
            json=record,
            timeout=10
        )
    except Exception as e:
        logger.warning(f"Sync item record error: {e}")


# ============================================================================
# ORCHESTRATION
# ============================================================================

def try_album_match(metadata: Dict) -> Optional[Dict]:
    """Try to match photo to a vehicle via its album names."""
    albums = metadata.get('albums', [])
    for album_name in albums:
        year, make, model = parse_album_name(album_name)
        if year and (make or model):
            # Search vehicle
            try:
                params = {
                    'select': 'id,year,make,model,title,color,user_id',
                    'year': f'eq.{year}',
                    'deleted_at': 'is.null',
                    'limit': '20',
                }
                resp = requests.get(
                    f"{SUPABASE_URL}/rest/v1/vehicles",
                    headers=HEADERS, params=params, timeout=10
                )
                if resp.status_code != 200:
                    continue

                for v in resp.json():
                    v_make = (v.get('make') or '').lower()
                    v_model = (v.get('model') or '').lower()
                    s_make = (make or '').lower()
                    s_model = (model or '').lower()

                    score = 0
                    if s_make and (s_make in v_make or v_make in s_make):
                        score += 40
                    if s_model and (s_model in v_model or v_model in s_model):
                        score += 40
                    if v.get('user_id') == USER_ID:
                        score += 20

                    if score >= 60:
                        return {
                            'vehicle_id': v['id'],
                            'vehicle_title': v.get('title') or f"{v.get('year')} {v.get('make')} {v.get('model')}",
                            'confidence': score / 100.0,
                            'method': 'album_match',
                            'album_name': album_name,
                        }
            except Exception:
                continue
    return None


def trigger_orchestrator(image_ids: List[str], photos_metadata: List[Dict]) -> Optional[Dict]:
    """Call the photo-sync-orchestrator edge function. Falls back to local Ollama if cloud fails."""
    try:
        resp = requests.post(
            f"{SUPABASE_URL}/functions/v1/photo-sync-orchestrator",
            headers={**HEADERS},
            json={
                'user_id': USER_ID,
                'image_ids': image_ids,
                'photos_metadata': photos_metadata,
            },
            timeout=120
        )
        if resp.status_code == 200:
            result = resp.json()
            # Check if the orchestrator actually classified anything (vs all errors from no API keys)
            if result.get('errors', 0) < result.get('total', 1):
                return result
            logger.warning(f"Orchestrator returned mostly errors ({result.get('errors')}/{result.get('total')}), falling back to Ollama")
        else:
            logger.warning(f"Orchestrator failed ({resp.status_code}): {resp.text[:300]}")
    except Exception as e:
        logger.error(f"Orchestrator error: {e}")

    # Fallback: try local Ollama classification
    return classify_with_ollama(photos_metadata)


def classify_with_ollama(photos_metadata: List[Dict]) -> Optional[Dict]:
    """Classify photos using local Ollama (llama3.2-vision). Free, no API keys needed."""
    try:
        # Check if Ollama is running
        resp = requests.get("http://localhost:11434/api/tags", timeout=3)
        if resp.status_code != 200:
            logger.warning("Ollama not available, skipping local classification")
            return None
    except Exception:
        logger.warning("Ollama not reachable at localhost:11434")
        return None

    logger.info(f"Classifying {len(photos_metadata)} photos with local Ollama...")
    results = {'total': len(photos_metadata), 'matched': 0, 'ignored': 0, 'errors': 0, 'pending_clarification': 0}

    ALWAYS_AUTOMOTIVE = {
        "vehicle_exterior", "vehicle_interior", "engine_bay", "undercarriage",
        "detail_shot", "parts", "receipt", "documentation", "shop_environment", "progress_shot",
    }

    for photo in photos_metadata:
        image_url = photo.get('image_url') or photo.get('storage_url')
        image_id = photo.get('image_id')
        if not image_url or not image_id:
            results['errors'] += 1
            continue

        try:
            # Download image
            img_resp = requests.get(image_url, timeout=15)
            if img_resp.status_code != 200:
                logger.warning(f"  Failed to download {image_id}: HTTP {img_resp.status_code}")
                results['errors'] += 1
                continue

            b64_data = base64.b64encode(img_resp.content).decode('utf-8')

            # Call Ollama
            ollama_resp = requests.post("http://localhost:11434/api/chat", json={
                "model": "llama3.2-vision:11b",
                "messages": [
                    {"role": "system", "content": "You classify vehicle photos. Respond ONLY with JSON."},
                    {
                        "role": "user",
                        "content": (
                            'Classify this photo for an automotive inventory system. JSON only:\n'
                            '{"is_automotive": bool, "category": "vehicle_exterior|vehicle_interior|engine_bay|'
                            'documentation|receipt|parts|shop_environment|not_automotive", '
                            '"confidence": 0.0-1.0, "vehicle_hints": {"make": null, "model": null, '
                            '"year_range": null, "color": null, "body_style": null}, '
                            '"text_detected": ["visible text"]}'
                        ),
                        "images": [b64_data],
                    }
                ],
                "stream": False,
                "format": "json",
            }, timeout=90)

            if ollama_resp.status_code != 200:
                logger.warning(f"  Ollama error for {image_id}: HTTP {ollama_resp.status_code}")
                results['errors'] += 1
                continue

            content = ollama_resp.json().get('message', {}).get('content', '{}')
            classification = json.loads(content)

            # Safety net
            category = classification.get('category', 'not_automotive')
            if category in ALWAYS_AUTOMOTIVE:
                classification['is_automotive'] = True

            is_auto = classification.get('is_automotive', False)
            conf = classification.get('confidence', 0)
            logger.info(f"  {image_id}: {category} ({conf:.0%}) {'auto' if is_auto else 'skip'} [ollama]")

            # Update photo_sync_items
            sync_status = 'pending_clarification' if is_auto else 'ignored'
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/photo_sync_items?vehicle_image_id=eq.{image_id}",
                headers={**HEADERS, 'Prefer': 'return=minimal'},
                json={
                    'sync_status': sync_status,
                    'is_automotive': is_auto,
                    'classification_category': category,
                    'classification_confidence': conf,
                    'vehicle_hints': classification.get('vehicle_hints'),
                    'classified_at': time.strftime('%Y-%m-%dT%H:%M:%S+00:00'),
                },
                timeout=10
            )

            # Update vehicle_images
            img_update = {
                'category': category,
                'ai_processing_status': 'completed',
                'organization_status': 'organized' if is_auto else 'ignored',
            }
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/vehicle_images?id=eq.{image_id}",
                headers={**HEADERS, 'Prefer': 'return=minimal'},
                json=img_update,
                timeout=10
            )

            if is_auto:
                results['pending_clarification'] += 1
            else:
                results['ignored'] += 1

        except json.JSONDecodeError as e:
            logger.warning(f"  Bad JSON from Ollama for {image_id}: {e}")
            results['errors'] += 1
        except Exception as e:
            logger.warning(f"  Ollama classification error for {image_id}: {e}")
            results['errors'] += 1

    logger.info(f"Ollama results: {results}")
    return results


# ============================================================================
# MAIN LOOP
# ============================================================================

def process_batch(photos: List) -> Dict:
    """Process a batch of photos: pre-filter, export, hash, dedup, upload, match."""
    export_dir = Path(tempfile.mkdtemp(prefix='nuke_auto_sync_'))
    results = {'uploaded': 0, 'duplicates': 0, 'matched': 0, 'errors': 0, 'ignored': 0, 'filtered': 0}
    image_ids = []
    batch_metadata = []
    matched_vehicles = {}  # vehicle_id -> [photos_uuids]

    # Pre-filter with Apple Vision (skip non-vehicle images before uploading)
    if ENABLE_PREFILTER:
        classifications = classify_photos_batch(photos)
        filtered_photos = []
        for photo in photos:
            cls = classifications.get(photo.uuid, {})
            if cls.get('is_vehicle', True):
                filtered_photos.append(photo)
            else:
                results['filtered'] += 1
                mark_processed(photo.uuid, 'ignored',
                             date_added=photo.date_added.isoformat() if photo.date_added else None)
                core_conf = cls.get('max_core_confidence', 0)
                total_conf = cls.get('total_vehicle_confidence', 0)
                logger.info(f"  Filtered (not vehicle): {photo.original_filename} [core={core_conf:.3f} total={total_conf:.3f}]")
        if results['filtered'] > 0:
            logger.info(f"Pre-filter: {len(filtered_photos)} vehicle candidates, {results['filtered']} non-vehicle skipped")
        photos = filtered_photos

    for idx, photo in enumerate(photos):
        try:
            # Throttle: delay only between actual uploads (not dupes/errors)
            if idx > 0 and results['uploaded'] > 0:
                time.sleep(0.5)

            # Export
            export_result = export_and_convert(photo, export_dir)
            if not export_result:
                results['errors'] += 1
                mark_processed(photo.uuid, 'error', date_added=photo.date_added.isoformat() if photo.date_added else None)
                continue

            file_path, metadata = export_result

            # Hash
            file_hash = compute_hash(file_path)

            # Dedup
            if check_duplicate(file_hash):
                logger.info(f"  Duplicate: {metadata.get('original_filename', photo.uuid[:8])}")
                results['duplicates'] += 1
                mark_processed(photo.uuid, 'duplicate', file_hash=file_hash,
                             date_added=photo.date_added.isoformat() if photo.date_added else None)
                file_path.unlink(missing_ok=True)
                continue

            # Upload to storage
            image_url = upload_to_storage(file_path, file_hash)
            if not image_url:
                results['errors'] += 1
                mark_processed(photo.uuid, 'error', file_hash=file_hash)
                file_path.unlink(missing_ok=True)
                continue

            # Try album-based match first (fast, no AI needed)
            album_match = try_album_match(metadata)
            vehicle_id = album_match['vehicle_id'] if album_match else None

            # Create vehicle_images record
            image_id = create_vehicle_image_record(image_url, file_hash, metadata, vehicle_id)

            if image_id:
                results['uploaded'] += 1
                image_ids.append(image_id)
                batch_metadata.append({**metadata, 'image_id': image_id, 'image_url': image_url})

                if album_match:
                    results['matched'] += 1
                    vid = album_match['vehicle_id']
                    if vid not in matched_vehicles:
                        matched_vehicles[vid] = {'title': album_match.get('vehicle_title', ''), 'uuids': []}
                    matched_vehicles[vid]['uuids'].append(photo.uuid)
                    logger.info(f"  Matched: {metadata.get('original_filename', '?')} -> {album_match.get('vehicle_title', vid[:8])}")

                mark_processed(
                    photo.uuid, 'complete' if vehicle_id else 'uploaded',
                    file_hash=file_hash, vehicle_image_id=image_id, vehicle_id=vehicle_id,
                    date_added=photo.date_added.isoformat() if photo.date_added else None
                )
                record_sync_item(photo.uuid, metadata, file_hash,
                               'matched' if vehicle_id else 'uploaded',
                               image_url, image_id)
            else:
                results['errors'] += 1
                mark_processed(photo.uuid, 'error', file_hash=file_hash)

            # Cleanup
            file_path.unlink(missing_ok=True)

        except Exception as e:
            logger.error(f"Photo processing error: {e}")
            results['errors'] += 1

    # Cleanup export dir
    try:
        for f in export_dir.iterdir():
            f.unlink(missing_ok=True)
        export_dir.rmdir()
    except Exception:
        pass

    # If we have unmatched uploads, trigger the orchestrator for AI classification
    unmatched_ids = [m['image_id'] for m in batch_metadata if not any(
        m.get('image_id') == uid for vdata in matched_vehicles.values() for uid in vdata.get('uuids', [])
    )]

    if unmatched_ids and SUPABASE_URL:
        logger.info(f"Triggering orchestrator for {len(unmatched_ids)} unmatched photos...")
        orch_result = trigger_orchestrator(
            [m['image_id'] for m in batch_metadata],
            batch_metadata
        )
        if orch_result:
            results['matched'] += orch_result.get('matched', 0)
            logger.info(f"Orchestrator: {orch_result}")

    # Update album management for matched vehicles
    for vid, vdata in matched_vehicles.items():
        try:
            vehicle = {'id': vid, 'title': vdata['title']}
            album_result = ensure_album_for_vehicle(USER_ID, vehicle)
            if album_result and vdata['uuids']:
                add_photos_to_album(album_result['apple_album_id'], vdata['uuids'])
        except Exception as e:
            logger.warning(f"Album update error: {e}")

    return results


def poll_cycle():
    """Run a single poll cycle."""
    watermark = get_watermark()
    if watermark:
        logger.info(f"Watermark: {watermark.isoformat()}")
    else:
        logger.info("No watermark - first run, processing last 24 hours")
        watermark = datetime.now(timezone.utc) - timedelta(hours=24)

    new_photos = get_new_photos(since=watermark, limit=BATCH_SIZE * 5)
    if not new_photos:
        return

    # Process in batches
    for i in range(0, len(new_photos), BATCH_SIZE):
        batch = new_photos[i:i + BATCH_SIZE]
        logger.info(f"Processing batch {i // BATCH_SIZE + 1} ({len(batch)} photos)...")
        results = process_batch(batch)

        logger.info(
            f"Batch done: {results['uploaded']} uploaded, "
            f"{results['matched']} matched, {results['duplicates']} dupes, "
            f"{results['errors']} errors"
        )

        # Update watermark to latest processed
        if batch:
            latest = max(p.date_added for p in batch if p.date_added)
            if latest:
                set_watermark(latest)

    # Update sync state in Supabase
    update_sync_state(len(new_photos))


def update_sync_state(photos_processed: int):
    """Update daemon health/state in Supabase."""
    if not SUPABASE_URL:
        return
    try:
        import socket
        requests.post(
            f"{SUPABASE_URL}/rest/v1/photo_sync_state",
            headers={**HEADERS, 'Prefer': 'resolution=merge-duplicates'},
            json={
                'user_id': USER_ID,
                'last_poll_at': datetime.now(timezone.utc).isoformat(),
                'daemon_version': VERSION,
                'daemon_hostname': socket.gethostname(),
                'daemon_started_at': _daemon_started.isoformat(),
            },
            timeout=10
        )
        # Increment counters
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/photo_sync_state",
            headers=HEADERS,
            params={'user_id': f'eq.{USER_ID}'},
            json={
                'last_poll_at': datetime.now(timezone.utc).isoformat(),
                'photos_processed_total': photos_processed,  # TODO: use rpc for increment
            },
            timeout=10
        )
    except Exception as e:
        logger.warning(f"State update error: {e}")


def run_daemon():
    """Main daemon loop."""
    global _daemon_started
    _daemon_started = datetime.now(timezone.utc)

    logger.info("=" * 60)
    logger.info(f"Nuke Photo Auto-Sync Daemon v{VERSION}")
    logger.info(f"User: {USER_ID}")
    logger.info(f"Poll interval: {POLL_INTERVAL}s")
    logger.info(f"Batch size: {BATCH_SIZE}")
    logger.info(f"State DB: {STATE_DB}")
    logger.info("=" * 60)

    init_state_db()

    # Initial album scan — uses JXA which may timeout from launchd context
    # If it fails, album matching still works via Photos.sqlite album data
    logger.info("Running initial album scan (skipping if JXA unavailable)...")
    try:
        import threading
        scan_done = threading.Event()
        scan_result_holder = [None]
        def _do_scan():
            try:
                scan_result_holder[0] = full_album_scan(USER_ID)
            except Exception:
                pass
            scan_done.set()
        t = threading.Thread(target=_do_scan, daemon=True)
        t.start()
        if scan_done.wait(timeout=15):
            sr = scan_result_holder[0]
            if sr:
                logger.info(f"Albums: {sr.get('matched', 0)} mapped, {len(sr.get('unmatched', []))} unmatched")
            else:
                logger.info("Album scan returned no results (JXA may be unavailable)")
        else:
            logger.info("Album scan timed out (JXA not available from launchd) — using SQLite album data instead")
    except Exception as e:
        logger.warning(f"Album scan error: {e}")

    while _running:
        try:
            poll_cycle()
        except Exception as e:
            logger.error(f"Poll cycle error: {e}", exc_info=True)

        # Sleep in small increments for responsive shutdown
        for _ in range(POLL_INTERVAL):
            if not _running:
                break
            time.sleep(1)

    logger.info("Daemon stopped cleanly.")


def run_backfill(days: int):
    """Process photos from the last N days."""
    logger.info(f"Backfilling last {days} days...")
    init_state_db()

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    new_photos = get_new_photos(since=cutoff, limit=500)
    logger.info(f"Found {len(new_photos)} photos to process")

    for i in range(0, len(new_photos), BATCH_SIZE):
        batch = new_photos[i:i + BATCH_SIZE]
        logger.info(f"Batch {i // BATCH_SIZE + 1}/{(len(new_photos) + BATCH_SIZE - 1) // BATCH_SIZE}...")
        results = process_batch(batch)
        logger.info(f"  {results}")


def run_reprocess():
    """Reprocess images stuck with ai_processing_status='pending' by re-calling the orchestrator."""
    logger.info("Reprocessing stuck pending images...")
    init_state_db()

    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")
        return

    # Query vehicle_images for stuck pending items from photo_auto_sync
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/vehicle_images",
        headers=HEADERS,
        params={
            'source': 'eq.photo_auto_sync',
            'ai_processing_status': 'eq.pending',
            'select': 'id,image_url,filename,taken_at,latitude,longitude',
            'order': 'created_at.asc',
            'limit': '500',
        },
        timeout=30
    )
    if resp.status_code != 200:
        logger.error(f"Failed to query pending images: {resp.status_code} {resp.text[:200]}")
        return

    pending = resp.json()
    if not pending:
        logger.info("No pending images to reprocess.")
        return

    logger.info(f"Found {len(pending)} pending images to reprocess")

    # Process in batches of 5 (matches orchestrator batch size)
    batch_size = 5
    total_results = {'matched': 0, 'created': 0, 'ignored': 0, 'pending_clarification': 0, 'errors': 0}

    for i in range(0, len(pending), batch_size):
        batch = pending[i:i + batch_size]
        image_ids = [img['id'] for img in batch]
        photos_metadata = []
        for img in batch:
            photos_metadata.append({
                'image_id': img['id'],
                'image_url': img['image_url'],
                'original_filename': img.get('filename'),
                'date_taken': img.get('taken_at'),
                'latitude': img.get('latitude'),
                'longitude': img.get('longitude'),
            })

        batch_num = i // batch_size + 1
        total_batches = (len(pending) + batch_size - 1) // batch_size
        logger.info(f"Batch {batch_num}/{total_batches} ({len(batch)} images)...")

        result = trigger_orchestrator(image_ids, photos_metadata)
        if result:
            for key in total_results:
                total_results[key] += result.get(key, 0)
            logger.info(f"  Result: matched={result.get('matched', 0)}, ignored={result.get('ignored', 0)}, "
                        f"pending_clarification={result.get('pending_clarification', 0)}, errors={result.get('errors', 0)}")
        else:
            total_results['errors'] += len(batch)
            logger.warning(f"  Batch {batch_num} failed")

        # Small delay between batches to avoid rate limits
        if i + batch_size < len(pending):
            time.sleep(2)

    logger.info(f"\nReprocess complete:")
    logger.info(f"  Matched: {total_results['matched']}")
    logger.info(f"  Created: {total_results['created']}")
    logger.info(f"  Ignored: {total_results['ignored']}")
    logger.info(f"  Pending clarification: {total_results['pending_clarification']}")
    logger.info(f"  Errors: {total_results['errors']}")


def show_status():
    """Show current sync status."""
    init_state_db()

    conn = sqlite3.connect(str(STATE_DB))
    watermark = conn.execute("SELECT value FROM watermark WHERE key = 'last_processed_date'").fetchone()
    total = conn.execute("SELECT COUNT(*) FROM processed_photos").fetchone()[0]
    by_status = conn.execute(
        "SELECT sync_status, COUNT(*) FROM processed_photos GROUP BY sync_status ORDER BY COUNT(*) DESC"
    ).fetchall()
    conn.close()

    print(f"\nPhoto Auto-Sync Status")
    print(f"{'=' * 40}")
    print(f"State DB: {STATE_DB}")
    print(f"Watermark: {watermark[0] if watermark else 'None (first run)'}")
    print(f"Total processed: {total}")
    print(f"\nBy status:")
    for status, count in by_status:
        print(f"  {status}: {count}")


# ============================================================================
# CLI
# ============================================================================

_daemon_started = datetime.now(timezone.utc)

if __name__ == '__main__':
    if '--once' in sys.argv:
        init_state_db()
        poll_cycle()
    elif '--backfill' in sys.argv:
        idx = sys.argv.index('--backfill')
        days = int(sys.argv[idx + 1]) if idx + 1 < len(sys.argv) else 2
        run_backfill(days)
    elif '--reprocess' in sys.argv:
        run_reprocess()
    elif '--status' in sys.argv:
        show_status()
    elif '--albums' in sys.argv:
        init_state_db()
        result = full_album_scan(USER_ID)
        print(json.dumps(result, indent=2, default=str))
    elif '--setup' in sys.argv:
        print("\nNuke Photo Auto-Sync — Setup")
        print("=" * 50)
        print()
        print("The daemon needs Full Disk Access to read the Photos")
        print("library when running as a background LaunchAgent.")
        print()
        print("Steps:")
        print("  1. Open System Settings > Privacy & Security > Full Disk Access")
        print("  2. Click + and press Cmd+Shift+G")
        print("  3. Paste this path:")
        print("     /Library/Frameworks/Python.framework/Versions/3.13/Resources/Python.app")
        print("  4. Select it and click Open")
        print("  5. Make sure the toggle is ON")
        print()
        print("After granting access, restart the daemon:")
        print("  launchctl unload ~/Library/LaunchAgents/com.nuke.photo-auto-sync.plist")
        print("  launchctl load ~/Library/LaunchAgents/com.nuke.photo-auto-sync.plist")
        print()
        import subprocess
        subprocess.run(['open', 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'])
    else:
        run_daemon()
