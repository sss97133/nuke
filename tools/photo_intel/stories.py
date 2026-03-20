"""
Phase 7: Story assembly from observations.

Per vehicle profile, assemble:
- Timeline: sessions sorted by date, grouped into work blocks
- Photo count by inferred type (exterior/interior/engine/detail from Apple labels + YONO)
- Geographic footprint (unique locations)
- Temporal span (first photo -> last photo, active months)
- YONO classification consensus (primary make, agreement %)
- Hero shot (highest score.overall from exterior photos)
"""

import json
import time
from collections import Counter

from .db import get_db, count, log_run
from .filter import VEHICLE_LABELS

# Label groups for photo type inference
EXTERIOR_LABELS = {'Automobile', 'Car', 'Vehicle', 'Truck', 'SUV', 'Pickup Truck', 'Van', 'Jeep',
                   'Grille', 'Headlight', 'Taillight', 'Bumper', 'Motor Vehicle', 'Land Vehicle'}
INTERIOR_LABELS = {'Dashboard', 'Steering Wheel', 'Speedometer', 'Gauge'}
ENGINE_LABELS = {'Engine'}
DETAIL_LABELS = {'Tire', 'Wheel', 'Rim', 'License Plate'}


def _infer_photo_type(labels: list[str]) -> str:
    """Infer photo type from Apple ML labels."""
    label_set = set(labels) if labels else set()
    if label_set & INTERIOR_LABELS:
        return "interior"
    if label_set & ENGINE_LABELS:
        return "engine"
    if label_set & DETAIL_LABELS:
        return "detail"
    if label_set & EXTERIOR_LABELS:
        return "exterior"
    return "other"


def assemble_stories(on_progress=None) -> int:
    """
    Assemble vehicle stories for all profiles.

    Returns:
        Number of stories assembled
    """
    db = get_db()
    t0 = time.time()

    profiles = db.execute("SELECT * FROM vehicle_profiles").fetchall()
    if not profiles:
        print("  Stories: no profiles to assemble")
        return 0

    assembled = 0
    for pi, profile in enumerate(profiles):
        pid = profile["id"]

        # Get all photos for this profile
        photos = db.execute(
            "SELECT p.uuid, p.date, p.latitude, p.longitude, p.labels, p.score_overall, p.place, "
            "p.session_id, p.path, c.make, c.confidence, c.family "
            "FROM photos p LEFT JOIN classifications c ON p.uuid = c.photo_uuid "
            "WHERE p.profile_id=? ORDER BY p.date",
            [pid]
        ).fetchall()

        if not photos:
            continue

        # Photo types
        type_counts = Counter()
        for p in photos:
            labels = json.loads(p["labels"]) if p["labels"] else []
            ptype = _infer_photo_type(labels)
            type_counts[ptype] += 1

        # Geographic footprint
        locations = set()
        for p in photos:
            if p["place"]:
                try:
                    place = json.loads(p["place"])
                    if isinstance(place, dict):
                        loc = place.get("address_str") or place.get("name")
                    elif isinstance(place, str):
                        loc = place
                    else:
                        loc = None
                    if loc:
                        locations.add(loc)
                except (json.JSONDecodeError, TypeError):
                    pass

        # Temporal span
        dates = [p["date"] for p in photos if p["date"]]
        first_date = min(dates) if dates else None
        last_date = max(dates) if dates else None

        # Active months
        months = set()
        for d in dates:
            if d and len(d) >= 7:
                months.add(d[:7])  # YYYY-MM

        # Sessions
        session_ids = set(p["session_id"] for p in photos if p["session_id"])
        sessions = []
        for sid in sorted(session_ids):
            sess = db.execute("SELECT * FROM sessions WHERE id=?", [sid]).fetchone()
            if sess:
                sessions.append({
                    "id": sess["id"],
                    "start": sess["start_time"],
                    "end": sess["end_time"],
                    "photos": sess["photo_count"],
                    "location": sess["location_name"],
                })

        # YONO consensus
        make_counts = Counter()
        total_classified = 0
        for p in photos:
            if p["make"] and p["confidence"]:
                make_counts[p["make"]] += 1
                total_classified += 1
        if make_counts:
            top_make = make_counts.most_common(1)[0]
            consensus = {
                "make": top_make[0],
                "count": top_make[1],
                "total": total_classified,
                "agreement": round(top_make[1] / total_classified * 100, 1) if total_classified else 0,
            }
        else:
            consensus = None

        # Hero shot: highest score.overall among exterior photos
        hero = None
        best_score = -1
        for p in photos:
            labels = json.loads(p["labels"]) if p["labels"] else []
            ptype = _infer_photo_type(labels)
            if ptype == "exterior" and p["score_overall"] and p["score_overall"] > best_score:
                best_score = p["score_overall"]
                hero = p["uuid"]

        # Assemble story
        story = {
            "photo_count": len(photos),
            "type_breakdown": dict(type_counts),
            "locations": sorted(locations),
            "first_date": first_date,
            "last_date": last_date,
            "active_months": sorted(months),
            "sessions": sessions,
            "yono_consensus": consensus,
            "local_paths": sum(1 for p in photos if p["path"]),
            "icloud_only": sum(1 for p in photos if not p["path"]),
        }

        # Update profile
        db.execute(
            "UPDATE vehicle_profiles SET "
            "photo_count=?, session_count=?, first_photo=?, last_photo=?, "
            "hero_photo_uuid=?, yono_consensus=?, story=? "
            "WHERE id=?",
            [
                len(photos), len(sessions), first_date, last_date,
                hero, json.dumps(consensus), json.dumps(story), pid
            ]
        )
        assembled += 1

        if on_progress:
            on_progress(pi + 1, len(profiles))

    db.commit()

    duration = time.time() - t0
    log_run(db, "stories", len(profiles), assembled, duration)
    if on_progress:
        on_progress(len(profiles), len(profiles))
    print(f"  Stories: {assembled} assembled in {duration:.1f}s")
    db.close()
    return assembled
