#!/usr/bin/env python3
"""
Session Detector — Automatic photo session grouping for vehicle images.

Groups chronologically adjacent photos into named sessions, classifies
session types using rule-based heuristics (bootstrap for YONO head training),
and persists as auto-sessions in image_sets.

Algorithm:
  1. Fetch all images for vehicle, ordered by COALESCE(taken_at, created_at) ASC
  2. Temporal clustering — configurable gap (default 30 min)
  3. GPS sub-splitting — within temporal cluster, split if GPS distance > 500m
  4. Source-batch grouping — scraped images without taken_at, same source + created_at within 5s
  5. Singleton handling — 1-image sessions merge into nearest or mark casual_lifestyle
  6. Rule-based type classification (bootstrap)
  7. Persist — create/update image_sets with is_auto_session=true, link members

Usage:
  cd /Users/skylar/nuke

  # Detect sessions for a single vehicle
  python3 -m yono.session_detector detect --vehicle-id UUID [--gap-minutes 30]

  # Detect sessions for all vehicles with images
  python3 -m yono.session_detector detect-all --limit 500

  # Reclassify existing sessions (update type without re-detecting)
  python3 -m yono.session_detector reclassify --vehicle-id UUID

  # Show session stats
  python3 -m yono.session_detector stats
"""

import os
import math
import json
import time
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor

NUKE_DIR = Path("/Users/skylar/nuke")

DETECTION_VERSION = "v1_2026_03"

# ─── DB Connection ──────────────────────────────────────────────────

def get_connection():
    """Get database connection (same pattern as condition_spectrometer)."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if not db_pass:
            for line in (NUKE_DIR / ".env").read_text().splitlines():
                if line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip('"').strip("'"))
            db_pass = os.environ.get("SUPABASE_DB_PASSWORD")
        if db_pass:
            db_url = (
                f"postgresql://postgres.qkgaybvrernstplzjaam:{db_pass}"
                f"@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
                f"?sslmode=require"
            )
        else:
            raise RuntimeError("SUPABASE_DB_PASSWORD not set")
    elif "sslmode" not in db_url:
        db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"
    return psycopg2.connect(db_url, connect_timeout=30)


# ─── Helpers ────────────────────────────────────────────────────────

def _haversine_m(lat1, lon1, lat2, lon2):
    """Haversine distance in meters between two GPS coordinates."""
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _get_profile_id(conn):
    """Get a system/service profile ID for created_by on image_sets."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    # Try to find an existing service account or use the first profile
    cur.execute("""
        SELECT id FROM profiles
        WHERE email ILIKE '%service%' OR email ILIKE '%system%' OR email ILIKE '%nuke%'
        LIMIT 1
    """)
    row = cur.fetchone()
    if row:
        cur.close()
        return str(row["id"])
    # Fallback: first profile
    cur.execute("SELECT id FROM profiles LIMIT 1")
    row = cur.fetchone()
    cur.close()
    return str(row["id"]) if row else None


# ─── Step 1: Fetch images ──────────────────────────────────────────

def fetch_vehicle_images(conn, vehicle_id: str) -> list[dict]:
    """Fetch all images for a vehicle, ordered chronologically."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")
    cur.execute("""
        SELECT
            id, vehicle_id, image_url,
            taken_at, created_at,
            COALESCE(taken_at, created_at) AS effective_time,
            latitude, longitude,
            source, vehicle_zone, zone_confidence,
            condition_score, damage_flags, modification_flags,
            photo_quality_score, interior_quality,
            ai_processing_status
        FROM vehicle_images
        WHERE vehicle_id = %s
          AND image_url IS NOT NULL
        ORDER BY COALESCE(taken_at, created_at) ASC
    """, (vehicle_id,))
    rows = cur.fetchall()
    cur.close()
    return [dict(r) for r in rows]


# ─── Step 2: Temporal clustering ───────────────────────────────────

def temporal_cluster(images: list[dict], gap_minutes: float = 30) -> list[list[dict]]:
    """Split images into clusters based on time gaps."""
    if not images:
        return []

    gap = timedelta(minutes=gap_minutes)
    clusters = []
    current = [images[0]]

    for img in images[1:]:
        prev_time = current[-1]["effective_time"]
        curr_time = img["effective_time"]

        if prev_time and curr_time and (curr_time - prev_time) > gap:
            clusters.append(current)
            current = [img]
        else:
            current.append(img)

    if current:
        clusters.append(current)

    return clusters


# ─── Step 3: GPS sub-splitting ─────────────────────────────────────

def gps_subsplit(cluster: list[dict], max_distance_m: float = 500) -> list[list[dict]]:
    """Within a temporal cluster, split if GPS distance > threshold.

    Includes velocity sanity check: if consecutive photos show impossible
    travel speed (> 200 m/s ≈ 720 km/h), GPS data is unreliable — skip split.
    Also validates overall GPS quality: if median consecutive distance exceeds
    5km for photos taken within minutes, the GPS data is junk — skip entirely.
    """
    if len(cluster) <= 1:
        return [cluster]

    # Only split if enough images have GPS
    gps_images = [img for img in cluster if img.get("latitude") and img.get("longitude")]
    if len(gps_images) < 2:
        return [cluster]

    # GPS quality check: compute median consecutive distance vs time span
    # If photos span < 30 min but median distance is > 5km, GPS is unreliable
    time_span = 0
    distances = []
    for i in range(1, len(gps_images)):
        p, c = gps_images[i - 1], gps_images[i]
        if p.get("effective_time") and c.get("effective_time"):
            time_span = max(time_span, abs((c["effective_time"] - p["effective_time"]).total_seconds()))
        try:
            d = _haversine_m(float(p["latitude"]), float(p["longitude"]),
                             float(c["latitude"]), float(c["longitude"]))
            distances.append(d)
        except (ValueError, TypeError):
            pass

    if distances:
        sorted_d = sorted(distances)
        median_d = sorted_d[len(sorted_d) // 2]
        # If photos span < 30 min but median jump is > 5km, GPS is bogus
        if time_span < 1800 and median_d > 5000:
            return [cluster]
        # If > 50% of consecutive pairs show > 2km jumps, GPS is unreliable
        big_jumps = sum(1 for d in distances if d > 2000)
        if big_jumps > len(distances) * 0.5:
            return [cluster]

    subclusters = []
    current = [cluster[0]]

    MAX_VELOCITY_MS = 200  # 720 km/h — faster than commercial aviation

    for img in cluster[1:]:
        prev = current[-1]
        if (prev.get("latitude") and prev.get("longitude") and
                img.get("latitude") and img.get("longitude")):
            try:
                dist = _haversine_m(
                    float(prev["latitude"]), float(prev["longitude"]),
                    float(img["latitude"]), float(img["longitude"])
                )
            except (ValueError, TypeError):
                current.append(img)
                continue

            # Velocity sanity check
            dt = 0
            if prev.get("effective_time") and img.get("effective_time"):
                dt = abs((img["effective_time"] - prev["effective_time"]).total_seconds())
            if dt > 0 and dist / dt > MAX_VELOCITY_MS:
                # Impossible velocity — GPS data is unreliable, don't split
                current.append(img)
                continue

            if dist > max_distance_m:
                subclusters.append(current)
                current = [img]
                continue
        current.append(img)

    if current:
        subclusters.append(current)

    return subclusters


# ─── Step 4: Source-batch grouping ─────────────────────────────────

def source_batch_group(clusters: list[list[dict]]) -> list[list[dict]]:
    """
    For scraped images without taken_at, group by source + created_at within 5s.
    This handles batch-imported images that were all created at nearly the same time.
    """
    result = []
    for cluster in clusters:
        # Check if this cluster is all scraped (no taken_at)
        has_taken_at = any(img.get("taken_at") for img in cluster)
        if has_taken_at or len(cluster) <= 1:
            result.append(cluster)
            continue

        # Group by source, then split by >5s gap in created_at
        by_source = defaultdict(list)
        for img in cluster:
            by_source[img.get("source", "unknown")].append(img)

        for source, imgs in by_source.items():
            imgs.sort(key=lambda x: x["created_at"])
            sub = [imgs[0]]
            for img in imgs[1:]:
                if (img["created_at"] - sub[-1]["created_at"]).total_seconds() > 5:
                    result.append(sub)
                    sub = [img]
                else:
                    sub.append(img)
            if sub:
                result.append(sub)

    return result


# ─── Step 5: Singleton handling ────────────────────────────────────

def merge_singletons(clusters: list[list[dict]], max_merge_gap_minutes: float = 120) -> list[list[dict]]:
    """
    Merge 1-image clusters into nearest neighbor if within max_merge_gap.
    Otherwise mark as standalone casual_lifestyle.
    """
    if len(clusters) <= 1:
        return clusters

    merged = []
    i = 0
    while i < len(clusters):
        cluster = clusters[i]
        if len(cluster) == 1:
            # Try merging with previous or next cluster
            img = cluster[0]
            img_time = img.get("effective_time")

            best_target = None
            best_gap = float("inf")

            # Check previous
            if merged and img_time:
                prev = merged[-1]
                prev_end = max((x.get("effective_time") for x in prev if x.get("effective_time")), default=None)
                if prev_end:
                    gap = abs((img_time - prev_end).total_seconds()) / 60
                    if gap < max_merge_gap_minutes and gap < best_gap:
                        best_target = "prev"
                        best_gap = gap

            # Check next
            if i + 1 < len(clusters) and img_time:
                nxt = clusters[i + 1]
                nxt_start = min((x.get("effective_time") for x in nxt if x.get("effective_time")), default=None)
                if nxt_start:
                    gap = abs((nxt_start - img_time).total_seconds()) / 60
                    if gap < best_gap:
                        best_target = "next"
                        best_gap = gap

            if best_target == "prev" and best_gap < max_merge_gap_minutes:
                merged[-1].append(img)
            elif best_target == "next" and best_gap < max_merge_gap_minutes:
                clusters[i + 1].insert(0, img)
            else:
                # Keep as standalone
                merged.append(cluster)
        else:
            merged.append(cluster)
        i += 1

    return merged


# ─── Step 5B: Same-day consolidation ─────────────────────────────

def merge_same_day(clusters: list[list[dict]], max_intraday_gap_hours: float = 4) -> list[list[dict]]:
    """
    Merge clusters that fall on the same calendar day (local timezone).
    Sessions spanning midnight with < max_intraday_gap_hours are merged.
    This prevents over-fragmentation from GPS noise or tight temporal gaps.
    """
    if len(clusters) <= 1:
        return clusters

    def _day_key(img):
        """Get calendar date key (local time, not UTC)."""
        t = img.get("effective_time")
        if not t:
            return None
        # Use local timezone approximation (UTC offset doesn't matter for grouping)
        return t.strftime("%Y-%m-%d")

    def _cluster_day_keys(cluster):
        """Get set of unique day keys for a cluster."""
        keys = set()
        for img in cluster:
            k = _day_key(img)
            if k:
                keys.add(k)
        return keys

    def _cluster_end_time(cluster):
        times = [img["effective_time"] for img in cluster if img.get("effective_time")]
        return max(times) if times else None

    def _cluster_start_time(cluster):
        times = [img["effective_time"] for img in cluster if img.get("effective_time")]
        return min(times) if times else None

    max_gap = timedelta(hours=max_intraday_gap_hours)
    merged = []

    for cluster in clusters:
        if not merged:
            merged.append(cluster)
            continue

        prev = merged[-1]
        prev_days = _cluster_day_keys(prev)
        curr_days = _cluster_day_keys(cluster)

        # Same day: merge unconditionally
        if prev_days & curr_days:
            merged[-1] = prev + cluster
            continue

        # Adjacent days: merge if gap < max_intraday_gap_hours (midnight spanning)
        prev_end = _cluster_end_time(prev)
        curr_start = _cluster_start_time(cluster)
        if prev_end and curr_start:
            gap = curr_start - prev_end
            if timedelta(0) <= gap <= max_gap:
                # Check if they're on adjacent calendar days
                prev_max_day = max(prev_days) if prev_days else ""
                curr_min_day = min(curr_days) if curr_days else ""
                if prev_max_day and curr_min_day:
                    from datetime import date as date_cls
                    try:
                        d1 = date_cls.fromisoformat(prev_max_day)
                        d2 = date_cls.fromisoformat(curr_min_day)
                        if (d2 - d1).days <= 1:
                            merged[-1] = prev + cluster
                            continue
                    except ValueError:
                        pass

        merged.append(cluster)

    return merged


# ─── Step 6: Rule-based type classification ────────────────────────

def classify_session_type(cluster: list[dict], vehicle_info: dict = None) -> tuple[str, float]:
    """
    Rule-based session type classification.
    Returns (session_type_key, confidence).
    """
    n = len(cluster)
    zones = [img.get("vehicle_zone") for img in cluster if img.get("vehicle_zone")]
    zone_counter = Counter(zones)
    sources = [img.get("source") for img in cluster if img.get("source")]
    source_counter = Counter(sources)

    damage_count = sum(
        1 for img in cluster
        if img.get("damage_flags") and len(img["damage_flags"]) > 0
    )

    ext_zones = {"ext_front", "ext_rear", "ext_driver_side", "ext_passenger_side",
                 "ext_front_quarter_driver", "ext_front_quarter_passenger",
                 "ext_rear_quarter_driver", "ext_rear_quarter_passenger",
                 "ext_front_driver", "ext_front_passenger",
                 "ext_rear_driver", "ext_rear_passenger"}
    int_zones = {"int_dashboard", "int_front_seats", "int_rear_seats",
                 "int_steering_wheel", "int_center_console", "int_door_panel",
                 "int_door_panel_fl", "int_door_panel_fr", "int_door_panel_rl", "int_door_panel_rr",
                 "int_headliner", "int_trunk", "int_cargo"}
    mech_zones = {"mech_engine_bay", "mech_underside", "mech_suspension"}
    detail_zones = {"detail_badge", "detail_damage", "detail_vin", "detail_tire",
                    "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr",
                    "ext_undercarriage"}

    zone_set = set(zones)
    ext_coverage = len(ext_zones & zone_set)
    int_coverage = len(int_zones & zone_set)
    mech_coverage = len(mech_zones & zone_set)
    detail_coverage = len(detail_zones & zone_set)
    total_zone_diversity = len(zone_set)

    # Has GPS movement over time? (with quality validation)
    gps_imgs = []
    for img in cluster:
        if img.get("latitude") and img.get("longitude") and img.get("effective_time"):
            try:
                gps_imgs.append((float(img["latitude"]), float(img["longitude"]), img["effective_time"]))
            except (ValueError, TypeError):
                pass

    has_gps_movement = False
    gps_reliable = False
    if len(gps_imgs) >= 2:
        # Check GPS quality: if consecutive pairs show impossible velocity, GPS is junk
        impossible_count = 0
        for i in range(1, min(len(gps_imgs), 20)):
            d = _haversine_m(gps_imgs[i-1][0], gps_imgs[i-1][1], gps_imgs[i][0], gps_imgs[i][1])
            dt = abs((gps_imgs[i][2] - gps_imgs[i-1][2]).total_seconds())
            if dt > 0 and d / dt > 200:  # > 720 km/h
                impossible_count += 1
        total_checked = min(len(gps_imgs) - 1, 19)
        gps_reliable = impossible_count < total_checked * 0.3  # < 30% impossible

        if gps_reliable:
            first = gps_imgs[0]
            last = gps_imgs[-1]
            dist = _haversine_m(first[0], first[1], last[0], last[1])
            time_diff = (last[2] - first[2]).total_seconds()
            if dist > 1000 and time_diff > 300:  # 1km+ over 5+ min
                has_gps_movement = True

    # Time span of session
    times = [img["effective_time"] for img in cluster if img.get("effective_time")]
    session_span_hours = 0
    if len(times) >= 2:
        session_span_hours = (max(times) - min(times)).total_seconds() / 3600

    # Classification rules (ordered by specificity)

    # Auction listing: source is bat/cab/mecum/etc + systematic + many photos
    auction_sources = {"bat", "cars_and_bids", "mecum", "rm_sothebys", "pcarmarket", "hagerty"}
    if source_counter and any(s in auction_sources for s in source_counter):
        return ("auction_listing", 0.9)

    # Walkaround: many photos in short time + diverse zones (takes priority over GPS)
    # A burst of 10+ photos in < 30 min with diverse zone coverage is a walkaround
    if n >= 10 and session_span_hours < 0.5 and total_zone_diversity >= 3:
        return ("walkaround", 0.85)
    # Slightly fewer photos but still systematic coverage
    if n >= 5 and session_span_hours < 1 and ext_coverage >= 2 and total_zone_diversity >= 4:
        return ("walkaround", 0.75)

    # GPS movement + extended time span → driving/road trip
    if has_gps_movement and session_span_hours > 1:
        return ("road_trip_driving", 0.8)

    # Multi-day session → likely a road trip or extended documentation
    if session_span_hours > 12:
        return ("road_trip_driving", 0.7)

    # Damage documentation: >50% images have damage flags
    if n >= 2 and damage_count / n > 0.5:
        return ("damage_documentation", 0.75)

    # Engine/mechanical: mostly mech zones
    if mech_coverage >= 1 and len([z for z in zones if z in mech_zones]) / max(len(zones), 1) > 0.4:
        return ("engine_rebuild", 0.7)

    # Interior restoration: mostly interior zones
    if int_coverage >= 2 and len([z for z in zones if z in int_zones]) / max(len(zones), 1) > 0.5:
        return ("interior_restoration", 0.7)

    # Walkaround: good exterior coverage + 5+ images
    if (ext_coverage >= 2 and n >= 5) or (total_zone_diversity >= 4 and n >= 5):
        return ("walkaround", 0.75)

    # Before-after: exactly 2 images with matching zones
    if n == 2 and len(zones) == 2 and zones[0] == zones[1]:
        return ("comparison_before_after", 0.6)

    # Detail close-ups: many detail_* zones
    detail_zones = [z for z in zones if z and z.startswith("detail_")]
    if len(detail_zones) >= 2 and len(detail_zones) / max(len(zones), 1) > 0.4:
        return ("detail_closeup", 0.65)

    # Parts reference: source is 'other' zone dominant
    if zone_counter.get("other", 0) / max(len(zones), 1) > 0.6 and n <= 20:
        return ("parts_reference", 0.5)

    # Casual lifestyle: small session, mixed zones, no strong pattern
    if n <= 3:
        return ("casual_lifestyle", 0.5)

    # Default: unknown
    return ("unknown", 0.3)


# ─── Step 7: Persist sessions ──────────────────────────────────────

def persist_sessions(conn, vehicle_id: str, clusters: list[list[dict]],
                     profile_id: str, vehicle_info: dict = None) -> list[dict]:
    """
    Create/update image_sets rows with is_auto_session=true.
    Links members, sets predecessor/successor chain.
    """
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '60s'")

    # Clear existing auto-sessions for this vehicle
    cur.execute("""
        DELETE FROM image_set_members
        WHERE image_set_id IN (
            SELECT id FROM image_sets
            WHERE vehicle_id = %s AND is_auto_session = true
        )
    """, (vehicle_id,))
    cur.execute("""
        DELETE FROM image_sets
        WHERE vehicle_id = %s AND is_auto_session = true
    """, (vehicle_id,))

    created_sessions = []
    prev_session_id = None

    for idx, cluster in enumerate(clusters):
        if not cluster:
            continue

        # Classify
        session_type_key, confidence = classify_session_type(cluster, vehicle_info)

        # Get session type ID
        cur.execute("SELECT id, display_label FROM session_type_taxonomy WHERE canonical_key = %s",
                     (session_type_key,))
        type_row = cur.fetchone()
        session_type_id = str(type_row["id"]) if type_row else None
        type_label = type_row["display_label"] if type_row else session_type_key

        # Time range
        times = [img["effective_time"] for img in cluster if img.get("effective_time")]
        session_start = min(times) if times else None
        session_end = max(times) if times else None
        duration_minutes = None
        if session_start and session_end:
            duration_minutes = round((session_end - session_start).total_seconds() / 60, 1)

        # Location (centroid of GPS points)
        gps_points = [(img["latitude"], img["longitude"])
                      for img in cluster
                      if img.get("latitude") and img.get("longitude")]
        session_location = None
        if gps_points:
            avg_lat = sum(float(p[0]) for p in gps_points) / len(gps_points)
            avg_lng = sum(float(p[1]) for p in gps_points) / len(gps_points)
            session_location = json.dumps({"lat": round(avg_lat, 6), "lng": round(avg_lng, 6),
                                           "point_count": len(gps_points)})

        # Session name
        date_str = session_start.strftime("%b %d, %Y") if session_start else "Unknown date"
        name = f"{type_label} — {date_str}"

        # Insert session
        cur.execute("""
            INSERT INTO image_sets (
                vehicle_id, created_by, name, is_auto_session,
                session_type_id, session_type_key, session_type_confidence,
                session_start, session_end, session_duration_minutes,
                session_location, detection_method, detection_version,
                predecessor_session_id
            ) VALUES (
                %s, %s, %s, true,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s
            )
            RETURNING id
        """, (
            vehicle_id, profile_id, name,
            session_type_id, session_type_key, confidence,
            session_start, session_end, duration_minutes,
            session_location, "temporal_gps_rule_v1", DETECTION_VERSION,
            prev_session_id,
        ))
        session_id = str(cur.fetchone()["id"])

        # Update predecessor's successor
        if prev_session_id:
            cur.execute("""
                UPDATE image_sets SET successor_session_id = %s WHERE id = %s
            """, (session_id, prev_session_id))

        # Insert members
        for order_idx, img in enumerate(cluster):
            role = "cover" if order_idx == 0 else None
            cur.execute("""
                INSERT INTO image_set_members (image_set_id, image_id, display_order, role, added_by)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (image_set_id, image_id) DO NOTHING
            """, (session_id, str(img["id"]), order_idx, role, profile_id))

        created_sessions.append({
            "session_id": session_id,
            "name": name,
            "session_type_key": session_type_key,
            "confidence": confidence,
            "image_count": len(cluster),
            "session_start": session_start.isoformat() if session_start else None,
            "session_end": session_end.isoformat() if session_end else None,
            "duration_minutes": duration_minutes,
        })

        prev_session_id = session_id

    conn.commit()
    cur.close()
    return created_sessions


# ─── Main detection pipeline ───────────────────────────────────────

def detect_sessions(conn, vehicle_id: str, gap_minutes: float = 30) -> dict:
    """
    Full session detection pipeline for a vehicle.
    Returns detection results summary.
    """
    t0 = time.time()

    # Fetch images
    images = fetch_vehicle_images(conn, vehicle_id)
    if not images:
        return {"vehicle_id": vehicle_id, "status": "no_images", "sessions": []}

    # Get vehicle info for classification context
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '15s'")
    cur.execute("""
        SELECT year, make, model, sale_price, condition_rating
        FROM vehicles WHERE id = %s
    """, (vehicle_id,))
    vehicle_info = cur.fetchone()
    cur.close()

    # Get profile ID for session creation
    profile_id = _get_profile_id(conn)
    if not profile_id:
        return {"vehicle_id": vehicle_id, "status": "no_profile", "sessions": []}

    # Pipeline
    clusters = temporal_cluster(images, gap_minutes)
    expanded = []
    for c in clusters:
        expanded.extend(gps_subsplit(c))
    clusters = source_batch_group(expanded)
    clusters = merge_singletons(clusters)
    clusters = merge_same_day(clusters)

    # Persist
    sessions = persist_sessions(conn, vehicle_id, clusters, profile_id,
                                dict(vehicle_info) if vehicle_info else None)

    elapsed = round(time.time() - t0, 2)

    return {
        "vehicle_id": vehicle_id,
        "status": "detected",
        "total_images": len(images),
        "sessions_detected": len(sessions),
        "sessions": sessions,
        "elapsed_s": elapsed,
        "detection_version": DETECTION_VERSION,
    }


def reclassify_sessions(conn, vehicle_id: str) -> dict:
    """Re-run classification on existing auto-sessions without re-detecting."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    # Get existing auto-sessions
    cur.execute("""
        SELECT s.id, ARRAY_AGG(m.image_id ORDER BY m.display_order) AS image_ids
        FROM image_sets s
        JOIN image_set_members m ON m.image_set_id = s.id
        WHERE s.vehicle_id = %s AND s.is_auto_session = true
        GROUP BY s.id
        ORDER BY s.session_start ASC NULLS LAST
    """, (vehicle_id,))
    sessions = cur.fetchall()

    if not sessions:
        cur.close()
        return {"vehicle_id": vehicle_id, "reclassified": 0}

    updated = 0
    for session in sessions:
        # Fetch image details for classification
        cur.execute("""
            SELECT id, vehicle_zone, damage_flags, modification_flags,
                   source, latitude, longitude,
                   COALESCE(taken_at, created_at) AS effective_time
            FROM vehicle_images
            WHERE id = ANY(%s)
            ORDER BY COALESCE(taken_at, created_at) ASC
        """, (session["image_ids"],))
        images = [dict(r) for r in cur.fetchall()]

        session_type_key, confidence = classify_session_type(images)

        cur.execute("SELECT id, display_label FROM session_type_taxonomy WHERE canonical_key = %s",
                     (session_type_key,))
        type_row = cur.fetchone()
        session_type_id = str(type_row["id"]) if type_row else None

        # Get session start for name
        cur.execute("SELECT session_start FROM image_sets WHERE id = %s", (str(session["id"]),))
        s_row = cur.fetchone()
        date_str = s_row["session_start"].strftime("%b %d, %Y") if s_row and s_row["session_start"] else "Unknown date"
        type_label = type_row["display_label"] if type_row else session_type_key
        name = f"{type_label} — {date_str}"

        cur.execute("""
            UPDATE image_sets
            SET session_type_id = %s, session_type_key = %s,
                session_type_confidence = %s, name = %s
            WHERE id = %s
        """, (session_type_id, session_type_key, confidence, name, str(session["id"])))
        updated += 1

    conn.commit()
    cur.close()
    return {"vehicle_id": vehicle_id, "reclassified": updated}


def get_session_stats(conn) -> dict:
    """Get global session detection statistics."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SET statement_timeout = '30s'")

    cur.execute("""
        SELECT
            COUNT(*) AS total_sessions,
            COUNT(*) FILTER (WHERE is_auto_session = true) AS auto_sessions,
            COUNT(*) FILTER (WHERE is_auto_session = false OR is_auto_session IS NULL) AS manual_sessions,
            COUNT(DISTINCT vehicle_id) AS vehicles_with_sessions
        FROM image_sets
    """)
    overview = dict(cur.fetchone())

    cur.execute("""
        SELECT session_type_key, COUNT(*) AS count
        FROM image_sets
        WHERE is_auto_session = true AND session_type_key IS NOT NULL
        GROUP BY session_type_key
        ORDER BY count DESC
    """)
    type_dist = {r["session_type_key"]: r["count"] for r in cur.fetchall()}

    cur.execute("""
        SELECT
            COUNT(*) AS total_vehicles_with_images,
            COUNT(*) FILTER (WHERE image_count >= 5) AS vehicles_5plus_images
        FROM (
            SELECT vehicle_id, COUNT(*) AS image_count
            FROM vehicle_images
            WHERE image_url IS NOT NULL
            GROUP BY vehicle_id
        ) sub
    """)
    image_stats = dict(cur.fetchone())

    cur.close()
    return {**overview, "type_distribution": type_dist, **image_stats}


# ─── CLI ────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="YONO Session Detector")
    sub = parser.add_subparsers(dest="command", required=True)

    # detect
    p_detect = sub.add_parser("detect", help="Detect sessions for a vehicle")
    p_detect.add_argument("--vehicle-id", required=True)
    p_detect.add_argument("--gap-minutes", type=float, default=30)

    # detect-all
    p_all = sub.add_parser("detect-all", help="Detect sessions for all vehicles")
    p_all.add_argument("--limit", type=int, default=500)
    p_all.add_argument("--gap-minutes", type=float, default=30)
    p_all.add_argument("--min-images", type=int, default=3)

    # reclassify
    p_reclass = sub.add_parser("reclassify", help="Reclassify existing sessions")
    p_reclass.add_argument("--vehicle-id", required=True)

    # stats
    sub.add_parser("stats", help="Show session detection statistics")

    args = parser.parse_args()
    conn = get_connection()

    if args.command == "detect":
        print(f"Detecting sessions for vehicle {args.vehicle_id} (gap={args.gap_minutes}min)...")
        result = detect_sessions(conn, args.vehicle_id, args.gap_minutes)
        print(f"\nResult: {result['status']}")
        print(f"  Total images: {result.get('total_images', 0)}")
        print(f"  Sessions detected: {result.get('sessions_detected', 0)}")
        print(f"  Elapsed: {result.get('elapsed_s', 0)}s")
        for s in result.get("sessions", []):
            print(f"\n  [{s['session_type_key']}] {s['name']} ({s['image_count']} photos, conf={s['confidence']})")
            if s.get("session_start"):
                print(f"    Time: {s['session_start']} → {s.get('session_end', '?')}")
            if s.get("duration_minutes"):
                print(f"    Duration: {s['duration_minutes']} min")

    elif args.command == "detect-all":
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SET statement_timeout = '30s'")
        cur.execute("""
            SELECT vehicle_id, COUNT(*) AS img_count
            FROM vehicle_images
            WHERE image_url IS NOT NULL
            GROUP BY vehicle_id
            HAVING COUNT(*) >= %s
            ORDER BY COUNT(*) DESC
            LIMIT %s
        """, (args.min_images, args.limit))
        vehicles = cur.fetchall()
        cur.close()

        print(f"Detecting sessions for {len(vehicles)} vehicles (gap={args.gap_minutes}min, min_images={args.min_images})...")
        total_sessions = 0
        errors = 0

        for i, v in enumerate(vehicles):
            vid = str(v["vehicle_id"])
            try:
                result = detect_sessions(conn, vid, args.gap_minutes)
                n = result.get("sessions_detected", 0)
                total_sessions += n
                if (i + 1) % 50 == 0 or i == 0:
                    print(f"  [{i+1}/{len(vehicles)}] {vid}: {n} sessions ({v['img_count']} images)")
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  Error for {vid}: {e}")

        print(f"\nBatch complete: {total_sessions} sessions across {len(vehicles)} vehicles, {errors} errors")

    elif args.command == "reclassify":
        print(f"Reclassifying sessions for vehicle {args.vehicle_id}...")
        result = reclassify_sessions(conn, args.vehicle_id)
        print(f"Reclassified: {result['reclassified']} sessions")

    elif args.command == "stats":
        stats = get_session_stats(conn)
        print("Session Detection Stats:")
        print(f"  Total sessions: {stats['total_sessions']}")
        print(f"    Auto-detected: {stats['auto_sessions']}")
        print(f"    Manual: {stats['manual_sessions']}")
        print(f"  Vehicles with sessions: {stats['vehicles_with_sessions']}")
        print(f"  Vehicles with images: {stats['total_vehicles_with_images']}")
        print(f"  Vehicles with 5+ images: {stats['vehicles_5plus_images']}")
        if stats.get("type_distribution"):
            print("\n  Session Type Distribution:")
            for k, v in stats["type_distribution"].items():
                print(f"    {k}: {v}")

    conn.close()


if __name__ == "__main__":
    main()
