from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import List

from ..db import connect
from ..util import iter_images, sha1_of_file
from ..exif import extract_exif


def cmd_ingest(args) -> None:
    root: Path = args.root
    inbox: Path = args.inbox
    recursive: bool = args.recursive

    conn = connect(root)

    photos_to_insert: List[tuple] = []
    for img in iter_images(inbox, recursive=recursive):
        dt_str, lat, lon, width, height, orientation = extract_exif(img)
        sha1 = sha1_of_file(img)
        photos_to_insert.append(
            (
                str(img.resolve()),
                dt_str,
                lat,
                lon,
                sha1,
                width,
                height,
                orientation,
            )
        )

    with conn:
        conn.executemany(
            """
            INSERT OR IGNORE INTO photos (path, taken_at_utc, gps_lat, gps_lon, hash_sha1, width, height, orientation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            photos_to_insert,
        )

    cur = conn.execute("SELECT COUNT(1) FROM photos")
    total = cur.fetchone()[0]
    print(f"Ingested {len(photos_to_insert)} images. Total images in DB: {total}")
