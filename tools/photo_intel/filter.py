"""
Phase 1: Apple ML label filtering.

Two paths to qualify:
1. Photo is in a vehicle-named album (starts with 4-digit year) -> automatic include
2. Photo has vehicle label score > 0.3 after scoring
"""

import json
import re
import time

from .db import get_db, count, log_run

VEHICLE_LABELS = {
    'Automobile', 'Car', 'Vehicle', 'Truck', 'SUV', 'Pickup Truck',
    'Tire', 'Wheel', 'Bumper', 'Engine', 'Rim', 'Van', 'Jeep',
    'Dashboard', 'Steering Wheel', 'Speedometer', 'Gauge',
    'Grille', 'Headlight', 'Taillight', 'License Plate',
    'Motor Vehicle', 'Land Vehicle', 'Automotive', 'Transportation',
}

REJECT_LABELS = {
    'Selfie', 'Portrait', 'Food', 'Meal', 'Screenshot', 'Text',
    'Receipt', 'Document', 'Cat', 'Dog', 'Baby', 'Child', 'Face',
}

VEHICLE_ALBUM_RE = re.compile(r'^\d{4}\s')
SCORE_THRESHOLD = 0.3


def score_photo(labels: list[str]) -> float:
    """Score photo based on Apple ML labels. Returns 0-1."""
    if not labels:
        return 0.0

    score = 0.0
    reject_score = 0.0

    for label in labels:
        if label in VEHICLE_LABELS:
            score += 0.3
        if label in REJECT_LABELS:
            reject_score += 0.4

    vehicle_count = sum(1 for l in labels if l in VEHICLE_LABELS)
    if vehicle_count >= 2:
        score += 0.2

    return max(0.0, min(1.0, score - reject_score))


def _is_vehicle_album(albums: list[str]) -> bool:
    """Check if any album looks like a vehicle album (starts with year)."""
    return any(VEHICLE_ALBUM_RE.match(a) for a in albums)


def filter_photos(on_progress=None) -> tuple[int, int]:
    """
    Score and filter all photos. Updates photos.vehicle_score and photos.is_vehicle.

    Returns:
        (passed_count, total_count)
    """
    db = get_db()
    t0 = time.time()

    # Check if already filtered
    already = count(db, "photos", "is_vehicle IS NOT NULL")
    total = count(db, "photos")
    if already == total and total > 0:
        passed = count(db, "photos", "is_vehicle=1")
        print(f"  Filter: already done ({passed}/{total} passed)")
        if on_progress:
            on_progress(total, total, passed)
        return passed, total

    cursor = db.execute("SELECT uuid, labels, albums FROM photos WHERE is_vehicle IS NULL")
    processed = 0
    passed = 0
    batch = []

    for row in cursor:
        labels = json.loads(row["labels"]) if row["labels"] else []
        albums = json.loads(row["albums"]) if row["albums"] else []

        # Path 1: vehicle-named album = automatic include
        if _is_vehicle_album(albums):
            score = max(score_photo(labels), SCORE_THRESHOLD)  # ensure passes
            is_vehicle = 1
        else:
            # Path 2: label scoring
            score = score_photo(labels)
            is_vehicle = 1 if score >= SCORE_THRESHOLD else 0

        batch.append((score, is_vehicle, row["uuid"]))
        processed += 1
        if is_vehicle:
            passed += 1

        if len(batch) >= 1000:
            db.executemany(
                "UPDATE photos SET vehicle_score=?, is_vehicle=? WHERE uuid=?",
                batch
            )
            db.commit()
            batch = []
            if on_progress:
                on_progress(processed, total, passed)

    if batch:
        db.executemany(
            "UPDATE photos SET vehicle_score=?, is_vehicle=? WHERE uuid=?",
            batch
        )
        db.commit()

    # Add back already-processed count
    total_passed = count(db, "photos", "is_vehicle=1")

    duration = time.time() - t0
    log_run(db, "filter", total, total_passed, duration)
    if on_progress:
        on_progress(total, total, total_passed)
    print(f"  Filter complete: {total_passed}/{total} vehicle candidates in {duration:.1f}s")
    db.close()
    return total_passed, total
