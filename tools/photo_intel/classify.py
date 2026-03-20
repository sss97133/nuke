"""
Phase 4: YONO ONNX classification with CoreML acceleration.

Imports HierarchicalYONO from yono package. Processes photos where path is not None
(skips iCloud-only). Stores results in classifications table.
"""

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .db import get_db, count, log_run

YONO_DIR = str(Path(__file__).parent.parent.parent / "yono")


def _load_yono():
    """Import and initialize HierarchicalYONO."""
    if YONO_DIR not in sys.path:
        sys.path.insert(0, YONO_DIR)
    from yono import HierarchicalYONO
    hier = HierarchicalYONO()
    if not hier.available:
        raise RuntimeError("No YONO models available. Check yono/models/ directory.")
    print(f"    YONO: {hier}")
    return hier


def classify_photos(on_progress=None) -> int:
    """
    Run YONO classification on all unclassified vehicle photos with local paths.

    Returns:
        Number of photos classified
    """
    db = get_db()
    t0 = time.time()

    # Get unclassified photos that have local paths
    rows = db.execute(
        "SELECT uuid, path FROM photos "
        "WHERE is_vehicle=1 AND classified=0 AND path IS NOT NULL AND ismissing=0"
    ).fetchall()

    if not rows:
        already = count(db, "classifications")
        print(f"  Classify: nothing to classify ({already} already done)")
        if on_progress:
            on_progress(already, already)
        return 0

    total = len(rows)
    print(f"  Classify: {total} photos to process")

    hier = _load_yono()
    classified = 0
    errors = 0

    for i, row in enumerate(rows):
        try:
            result = hier.predict(row["path"])

            db.execute(
                "INSERT OR REPLACE INTO classifications "
                "(photo_uuid, make, confidence, family, family_confidence, top5, source, classified_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                [
                    row["uuid"],
                    result.get("make"),
                    result.get("confidence"),
                    result.get("family"),
                    result.get("family_confidence"),
                    json.dumps(result.get("top5", [])),
                    result.get("source"),
                ]
            )
            db.execute("UPDATE photos SET classified=1 WHERE uuid=?", [row["uuid"]])
            classified += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"    Error classifying {row['uuid']}: {e}")

        if (i + 1) % 100 == 0:
            db.commit()
            elapsed = time.time() - t0
            rate = classified / elapsed if elapsed > 0 else 0
            eta = (total - i - 1) / rate if rate > 0 else 0
            print(f"    {i+1}/{total} ({classified} ok, {errors} err, {rate:.0f}/s, ETA {eta:.0f}s)")
            if on_progress:
                on_progress(i + 1, total)

    db.commit()

    duration = time.time() - t0
    log_run(db, "classify", total, classified, duration, f"{errors} errors")
    if on_progress:
        on_progress(total, total)
    rate = classified / duration if duration > 0 else 0
    print(f"  Classify complete: {classified}/{total} in {duration:.1f}s ({rate:.1f}/s, {errors} errors)")
    db.close()
    return classified
