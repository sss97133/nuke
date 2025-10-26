from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable, Optional


SCHEMA = r"""
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  taken_at_utc TEXT,
  gps_lat REAL,
  gps_lon REAL,
  hash_sha1 TEXT,
  width INTEGER,
  height INTEGER,
  orientation TEXT,
  ocr_text TEXT,
  clip_vec BLOB,
  tags TEXT,
  session_id INTEGER,
  assigned_vehicle_id INTEGER,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(assigned_vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  start_utc TEXT,
  end_utc TEXT,
  center_lat REAL,
  center_lon REAL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  primary_color TEXT,
  plate TEXT,
  vin TEXT
);

CREATE TABLE IF NOT EXISTS vehicle_images (
  vehicle_id INTEGER,
  photo_id INTEGER,
  PRIMARY KEY (vehicle_id, photo_id),
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY(photo_id) REFERENCES photos(id)
);

CREATE TABLE IF NOT EXISTS suggestions (
  photo_id INTEGER,
  vehicle_id INTEGER,
  score REAL,
  PRIMARY KEY (photo_id, vehicle_id),
  FOREIGN KEY(photo_id) REFERENCES photos(id),
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
);
"""


def db_path(root: Path) -> Path:
    return root / "photo_cli.sqlite3"


def connect(root: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(root))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(root: Path) -> None:
    conn = connect(root)
    with conn:
        conn.executescript(SCHEMA)


def executemany(conn: sqlite3.Connection, sql: str, rows: Iterable[tuple]) -> None:
    with conn:
        conn.executemany(sql, rows)


def ensure_vehicle(conn: sqlite3.Connection, name: str, slug: str) -> int:
    cur = conn.execute("SELECT id FROM vehicles WHERE slug=?", (slug,))
    row = cur.fetchone()
    if row:
        return int(row[0])
    cur = conn.execute(
        "INSERT INTO vehicles (name, slug) VALUES (?, ?)", (name, slug)
    )
    return int(cur.lastrowid)
