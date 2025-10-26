from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Tuple

from ..db import connect
from ..util import haversine_m, parse_exif_datetime


SECONDS_PER_MIN = 60.0


def cmd_cluster(args) -> None:
    conn = connect(args.root)

    rows = conn.execute(
        "SELECT id, taken_at_utc, gps_lat, gps_lon FROM photos ORDER BY taken_at_utc"
    ).fetchall()

    # Preprocess: parse timestamps
    photos = []
    for r in rows:
        dt = parse_exif_datetime(r[1])
        photos.append((r[0], dt, r[2], r[3]))

    sessions: List[List[int]] = []
    current: List[int] = []
    last_dt = None
    last_lat = None
    last_lon = None

    time_window_s = args.time_mins * SECONDS_PER_MIN
    dist_window_m = args.dist_m

    for pid, dt, lat, lon in photos:
        if not dt or lat is None or lon is None:
            # No GPS or time: treat as break between sessions
            if current:
                sessions.append(current)
                current = []
            last_dt = None
            last_lat = None
            last_lon = None
            continue

        if not current:
            current = [pid]
            last_dt, last_lat, last_lon = dt, lat, lon
            continue

        time_gap = (dt - last_dt).total_seconds() if last_dt else 1e9
        dist_gap = haversine_m(last_lat, last_lon, lat, lon) if (last_lat is not None and last_lon is not None) else 1e9

        if time_gap <= time_window_s and dist_gap <= dist_window_m:
            current.append(pid)
        else:
            sessions.append(current)
            current = [pid]
        last_dt, last_lat, last_lon = dt, lat, lon

    if current:
        sessions.append(current)

    # Persist sessions
    with conn:
        for sess in sessions:
            pts = conn.execute(
                "SELECT taken_at_utc, gps_lat, gps_lon FROM photos WHERE id IN (%s) ORDER BY taken_at_utc"
                % ",".join(str(x) for x in sess)
            ).fetchall()
            dts = [parse_exif_datetime(p[0]) for p in pts if p[0]]
            lats = [p[1] for p in pts if p[1] is not None]
            lons = [p[2] for p in pts if p[2] is not None]
            if not dts or not lats or not lons:
                continue
            start = min(dts).isoformat()
            end = max(dts).isoformat()
            center_lat = sum(lats) / len(lats)
            center_lon = sum(lons) / len(lons)
            cur = conn.execute(
                "INSERT INTO sessions (start_utc, end_utc, center_lat, center_lon) VALUES (?, ?, ?, ?)",
                (start, end, center_lat, center_lon),
            )
            session_id = cur.lastrowid
            conn.execute(
                "UPDATE photos SET session_id=? WHERE id IN (%s)"
                % ",".join(str(x) for x in sess),
                (session_id,),
            )

    print(f"Created {len(sessions)} sessions")
