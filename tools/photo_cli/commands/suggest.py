from __future__ import annotations

import math
from typing import Dict, List, Tuple

from ..db import connect
from ..util import haversine_m


# Minimal baseline scorer without embeddings/OCR yet
# Score components:
# - Session proximity to any session with that vehicle's assigned photos
# - Same-session majority vote


def cmd_suggest(args) -> None:
    conn = connect(args.root)

    # Gather vehicles
    vehicles = conn.execute("SELECT id, name, slug FROM vehicles").fetchall()
    if not vehicles:
        print("No vehicles found. Seed some vehicles first.")
        return

    # Preload sessions for each vehicle
    veh_sessions: Dict[int, List[Tuple[float, float]]] = {}
    for v in vehicles:
        rows = conn.execute(
            """
            SELECT DISTINCT s.center_lat, s.center_lon
            FROM photos p
            JOIN sessions s ON s.id = p.session_id
            WHERE p.assigned_vehicle_id = ? AND p.session_id IS NOT NULL
            """,
            (v[0],),
        ).fetchall()
        veh_sessions[v[0]] = [(r[0], r[1]) for r in rows]

    # For each unassigned photo, compute simple score
    unassigned = conn.execute(
        "SELECT id, session_id FROM photos WHERE assigned_vehicle_id IS NULL"
    ).fetchall()

    to_upsert = []
    for pid, session_id in unassigned:
        # Same-session vote
        scores: Dict[int, float] = {v[0]: 0.0 for v in vehicles}
        if session_id is not None:
            rows = conn.execute(
                "SELECT assigned_vehicle_id, COUNT(1) FROM photos WHERE session_id=? AND assigned_vehicle_id IS NOT NULL GROUP BY assigned_vehicle_id",
                (session_id,),
            ).fetchall()
            for veh_id, cnt in rows:
                if veh_id is not None:
                    scores[int(veh_id)] += float(cnt)  # majority within session

        # Spatial proximity to vehicle sessions
        if session_id is not None:
            srow = conn.execute("SELECT center_lat, center_lon FROM sessions WHERE id=?", (session_id,)).fetchone()
            if srow:
                slat, slon = srow[0], srow[1]
                for v in vehicles:
                    for vlat, vlon in veh_sessions.get(v[0], []):
                        d = haversine_m(slat, slon, vlat, vlon)
                        # Inverse distance scoring within 1km cap
                        if d < 1000:
                            scores[v[0]] += (1000.0 - d) / 1000.0

        # Persist top-N
        topn = sorted(scores.items(), key=lambda x: x[1], reverse=True)[: args.topn]
        for veh_id, score in topn:
            to_upsert.append((pid, veh_id, score))

    with conn:
        for pid, veh_id, score in to_upsert:
            conn.execute(
                "INSERT INTO suggestions (photo_id, vehicle_id, score) VALUES (?, ?, ?) ON CONFLICT(photo_id, vehicle_id) DO UPDATE SET score=excluded.score",
                (pid, veh_id, score),
            )

    print(f"Generated suggestions for {len(unassigned)} photos")
