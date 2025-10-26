from __future__ import annotations

from pathlib import Path

from ..db import connect
from ..util import slugify


def cmd_review(args) -> None:
    conn = connect(args.root)

    rows = conn.execute(
        """
        SELECT p.id, p.path, v.id, v.name, s.score
        FROM photos p
        JOIN (
          SELECT photo_id, vehicle_id, score,
                 ROW_NUMBER() OVER (PARTITION BY photo_id ORDER BY score DESC) AS rn
          FROM suggestions
        ) s ON s.photo_id = p.id AND s.rn = 1
        LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE p.assigned_vehicle_id IS NULL
        ORDER BY s.score DESC
        LIMIT ?
        """,
        (args.limit,),
    ).fetchall()

    if not rows:
        print("No suggestions to review.")
        return

    print("Review suggestions: [enter] accept, 'n' new vehicle name, 's' skip, 'q' quit")
    for pid, path, veh_id, veh_name, score in rows:
        print(f"\nPhoto {pid}: {path}")
        print(f"Top suggestion: {veh_name} (score={score:.3f})")
        choice = input("> ").strip()
        if choice == "q":
            break
        elif choice == "":
            assign_vehicle(conn, pid, veh_id)
            print(f"Assigned to {veh_name}")
        elif choice == "s":
            continue
        else:
            # Treat input as vehicle name
            name = choice
            slug = slugify(name)
            with conn:
                cur = conn.execute("SELECT id FROM vehicles WHERE slug=?", (slug,))
                row = cur.fetchone()
                if row:
                    new_vid = int(row[0])
                else:
                    cur = conn.execute(
                        "INSERT INTO vehicles (name, slug) VALUES (?, ?)", (name, slug)
                    )
                    new_vid = int(cur.lastrowid)
            assign_vehicle(conn, pid, new_vid)
            print(f"Assigned to new vehicle {name}")


def assign_vehicle(conn, photo_id: int, vehicle_id: int) -> None:
    with conn:
        conn.execute(
            "UPDATE photos SET assigned_vehicle_id=? WHERE id=?", (vehicle_id, photo_id)
        )
