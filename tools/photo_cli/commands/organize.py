from __future__ import annotations

from pathlib import Path

from ..db import connect
from ..util import move_or_copy, slugify


def cmd_organize(args) -> None:
    root: Path = args.root
    copy: bool = args.copy

    conn = connect(root)

    rows = conn.execute(
        """
        SELECT p.path, v.name
        FROM photos p
        JOIN vehicles v ON v.id = p.assigned_vehicle_id
        WHERE p.assigned_vehicle_id IS NOT NULL
        """
    ).fetchall()

    if not rows:
        print("No assigned photos to organize.")
        return

    dest_root = root / "Vehicles"
    count = 0
    for path, veh_name in rows:
        src = Path(path)
        slug = slugify(veh_name)
        dst = dest_root / slug / src.name
        move_or_copy(src, dst, copy=copy)
        count += 1

    print(f"Organized {count} photos into {dest_root}")
