"""
SQLite schema + helpers for photo-intel pipeline.
Persistent at tools/photo-intel/photo-intel.db.
Crash-resumable: each phase reads unprocessed rows, updates on completion.
"""

import sqlite3
import json
import time
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "photo-intel.db"


def get_db(path: str = None) -> sqlite3.Connection:
    db = sqlite3.connect(str(path or DB_PATH))
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(db)
    return db


def _ensure_schema(db: sqlite3.Connection):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS photos (
        uuid TEXT PRIMARY KEY,
        filename TEXT,
        original_filename TEXT,
        date TEXT,
        latitude REAL,
        longitude REAL,
        labels TEXT,          -- JSON array
        ai_caption TEXT,
        score_overall REAL,
        albums TEXT,          -- JSON array
        path TEXT,            -- NULL if iCloud-only
        ismissing INTEGER,
        height INTEGER,
        width INTEGER,
        place TEXT,           -- JSON object or string
        -- Pipeline state
        vehicle_score REAL,   -- Phase 1 score
        is_vehicle INTEGER,   -- Phase 1 pass/fail (1/0)
        session_id TEXT,      -- Phase 2
        profile_id TEXT,      -- Phase 3
        classified INTEGER DEFAULT 0, -- Phase 4 done
        uploaded INTEGER DEFAULT 0    -- Phase 8 done
    );

    CREATE INDEX IF NOT EXISTS idx_photos_vehicle ON photos(is_vehicle);
    CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id);
    CREATE INDEX IF NOT EXISTS idx_photos_profile ON photos(profile_id);
    CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(date);

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        start_time TEXT,
        end_time TEXT,
        photo_count INTEGER,
        center_lat REAL,
        center_lng REAL,
        location_name TEXT,
        profile_id TEXT       -- assigned in Phase 3
    );

    CREATE TABLE IF NOT EXISTS vehicle_profiles (
        id TEXT PRIMARY KEY,
        album_name TEXT,      -- source album (NULL for orphan groups)
        year INTEGER,
        make TEXT,
        model TEXT,
        supabase_vehicle_id TEXT,  -- matched vehicle UUID
        photo_count INTEGER DEFAULT 0,
        session_count INTEGER DEFAULT 0,
        first_photo TEXT,     -- earliest date
        last_photo TEXT,      -- latest date
        hero_photo_uuid TEXT, -- highest score exterior
        yono_consensus TEXT,  -- JSON: top make + agreement %
        story TEXT            -- JSON: assembled narrative
    );

    CREATE TABLE IF NOT EXISTS classifications (
        photo_uuid TEXT PRIMARY KEY,
        make TEXT,
        confidence REAL,
        family TEXT,
        family_confidence REAL,
        top5 TEXT,            -- JSON array
        source TEXT,          -- hierarchical / flat_fallback
        classified_at TEXT,
        FOREIGN KEY (photo_uuid) REFERENCES photos(uuid)
    );

    CREATE TABLE IF NOT EXISTS upload_state (
        photo_uuid TEXT PRIMARY KEY,
        vehicle_id TEXT,
        storage_path TEXT,
        image_url TEXT,
        uploaded_at TEXT,
        error TEXT,
        FOREIGN KEY (photo_uuid) REFERENCES photos(uuid)
    );

    CREATE TABLE IF NOT EXISTS run_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT,
        completed_at TEXT,
        phase TEXT,
        input_count INTEGER,
        output_count INTEGER,
        duration_s REAL,
        notes TEXT
    );
    """)
    db.commit()


def log_run(db: sqlite3.Connection, phase: str, input_count: int, output_count: int,
            duration_s: float, notes: str = None):
    db.execute(
        "INSERT INTO run_log (started_at, completed_at, phase, input_count, output_count, duration_s, notes) "
        "VALUES (datetime('now','-' || ? || ' seconds'), datetime('now'), ?, ?, ?, ?, ?)",
        [int(duration_s), phase, input_count, output_count, duration_s, notes]
    )
    db.commit()


def upsert_photo(db: sqlite3.Connection, row: dict):
    cols = list(row.keys())
    placeholders = ", ".join(["?"] * len(cols))
    updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "uuid"])
    sql = f"INSERT INTO photos ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(uuid) DO UPDATE SET {updates}"
    db.execute(sql, [row[c] for c in cols])


def upsert_photos_batch(db: sqlite3.Connection, rows: list[dict]):
    if not rows:
        return
    cols = list(rows[0].keys())
    placeholders = ", ".join(["?"] * len(cols))
    updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "uuid"])
    sql = f"INSERT INTO photos ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(uuid) DO UPDATE SET {updates}"
    db.executemany(sql, [[r[c] for c in cols] for r in rows])
    db.commit()


def count(db: sqlite3.Connection, table: str, where: str = "1=1") -> int:
    return db.execute(f"SELECT count(*) FROM {table} WHERE {where}").fetchone()[0]


def reset_phase(db: sqlite3.Connection, phase: str):
    """Reset a phase for re-run."""
    if phase == "filter":
        db.execute("UPDATE photos SET vehicle_score=NULL, is_vehicle=NULL")
    elif phase == "sessions":
        db.execute("UPDATE photos SET session_id=NULL")
        db.execute("DELETE FROM sessions")
    elif phase == "profiles":
        db.execute("UPDATE photos SET profile_id=NULL")
        db.execute("UPDATE sessions SET profile_id=NULL")
        db.execute("DELETE FROM vehicle_profiles")
    elif phase == "classify":
        db.execute("UPDATE photos SET classified=0")
        db.execute("DELETE FROM classifications")
    elif phase == "upload":
        db.execute("UPDATE photos SET uploaded=0")
        db.execute("DELETE FROM upload_state")
    db.commit()
