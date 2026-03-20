"""
Phase 2: Time-gap + GPS session clustering.

Sort filtered photos by date. Walk sequentially:
- Gap > 30 min -> new session
- GPS delta > 500m within a session -> split
"""

import json
import math
import time
import uuid as uuid_mod

from .db import get_db, count, log_run

SESSION_GAP_S = 30 * 60  # 30 minutes
GPS_SPLIT_M = 500  # meters


def _haversine(lat1, lon1, lat2, lon2) -> float:
    """Distance in meters between two GPS points."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _parse_iso(s: str) -> float:
    """Parse ISO datetime to epoch seconds. Handles various formats."""
    if not s:
        return 0
    # Strip timezone suffix for simple parsing
    s = s.replace("Z", "+00:00")
    try:
        from datetime import datetime, timezone
        # Try ISO format first
        if "T" in s:
            dt = datetime.fromisoformat(s)
        else:
            dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0


def _extract_location_name(place_json: str) -> str | None:
    """Extract readable location from place JSON."""
    if not place_json:
        return None
    try:
        place = json.loads(place_json)
    except (json.JSONDecodeError, TypeError):
        return None
    if isinstance(place, str):
        return place
    if isinstance(place, dict):
        return place.get("address_str") or place.get("name")
    return None


def detect_sessions(on_progress=None) -> int:
    """
    Cluster vehicle photos into sessions based on time gaps and GPS.

    Returns:
        Number of sessions created
    """
    db = get_db()
    t0 = time.time()

    # Check existing
    existing = count(db, "sessions")
    if existing > 0:
        print(f"  Sessions: {existing} already detected (reset to re-run)")
        if on_progress:
            on_progress(existing, existing)
        return existing

    # Get all vehicle photos sorted by date
    rows = db.execute(
        "SELECT uuid, date, latitude, longitude, place "
        "FROM photos WHERE is_vehicle=1 ORDER BY date"
    ).fetchall()

    if not rows:
        print("  Sessions: no vehicle photos to cluster")
        return 0

    total = len(rows)
    sessions = []
    current_photos = [rows[0]]
    prev_ts = _parse_iso(rows[0]["date"])
    prev_lat = rows[0]["latitude"]
    prev_lng = rows[0]["longitude"]

    def _finalize_session(photos):
        sid = str(uuid_mod.uuid4())[:8]
        lats = [p["latitude"] for p in photos if p["latitude"]]
        lngs = [p["longitude"] for p in photos if p["longitude"]]
        places = [_extract_location_name(p["place"]) for p in photos]
        places = [p for p in places if p]

        # Most common place
        place_freq = {}
        for p in places:
            place_freq[p] = place_freq.get(p, 0) + 1
        top_place = max(place_freq, key=place_freq.get) if place_freq else None

        return {
            "id": sid,
            "start_time": photos[0]["date"],
            "end_time": photos[-1]["date"],
            "photo_count": len(photos),
            "center_lat": sum(lats) / len(lats) if lats else None,
            "center_lng": sum(lngs) / len(lngs) if lngs else None,
            "location_name": top_place,
            "photo_uuids": [p["uuid"] for p in photos],
        }

    for i in range(1, total):
        row = rows[i]
        ts = _parse_iso(row["date"])
        lat = row["latitude"]
        lng = row["longitude"]

        # Time gap check
        gap = ts - prev_ts if ts and prev_ts else 0
        split = gap > SESSION_GAP_S

        # GPS distance check (only if both points have GPS)
        if not split and lat and lng and prev_lat and prev_lng:
            dist = _haversine(prev_lat, prev_lng, lat, lng)
            if dist > GPS_SPLIT_M:
                split = True

        if split:
            sessions.append(_finalize_session(current_photos))
            current_photos = [row]
        else:
            current_photos.append(row)

        prev_ts = ts
        if lat:
            prev_lat = lat
        if lng:
            prev_lng = lng

        if on_progress and i % 1000 == 0:
            on_progress(i, total)

    # Finalize last session
    if current_photos:
        sessions.append(_finalize_session(current_photos))

    # Write sessions and update photos
    for sess in sessions:
        db.execute(
            "INSERT OR REPLACE INTO sessions (id, start_time, end_time, photo_count, center_lat, center_lng, location_name) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [sess["id"], sess["start_time"], sess["end_time"], sess["photo_count"],
             sess["center_lat"], sess["center_lng"], sess["location_name"]]
        )
        # Update photos with session_id
        for puuid in sess["photo_uuids"]:
            db.execute("UPDATE photos SET session_id=? WHERE uuid=?", [sess["id"], puuid])

    db.commit()

    duration = time.time() - t0
    log_run(db, "sessions", total, len(sessions), duration)
    if on_progress:
        on_progress(total, total)
    print(f"  Sessions: {len(sessions)} detected from {total} photos in {duration:.1f}s")
    db.close()
    return len(sessions)
