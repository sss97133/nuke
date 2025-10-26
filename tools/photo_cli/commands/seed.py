from __future__ import annotations

from pathlib import Path

from ..db import connect, ensure_vehicle
from ..util import slugify


def cmd_seed(args) -> None:
    root: Path = args.root
    name: str = args.vehicle
    images: list[Path] = args.images

    slug = slugify(name)
    conn = connect(root)
    vehicle_id = ensure_vehicle(conn, name, slug)

    # Insert photos by path if present
    with conn:
        for img in images:
            row = conn.execute("SELECT id FROM photos WHERE path=?", (str(img.resolve()),)).fetchone()
            if not row:
                print(f"Warning: image not ingested: {img}")
                continue
            photo_id = int(row[0])
            conn.execute(
                "INSERT OR IGNORE INTO vehicle_images (vehicle_id, photo_id) VALUES (?, ?)",
                (vehicle_id, photo_id),
            )
            conn.execute("UPDATE photos SET assigned_vehicle_id=? WHERE id=?", (vehicle_id, photo_id))

    print(f"Seeded vehicle '{name}' ({slug}) with {len(images)} images")
