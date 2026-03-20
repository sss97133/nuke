"""
Phase 3: Album parsing + Supabase vehicle matching.

1. Parse album names -> vehicle identity (year/make/model)
2. Query Supabase vehicles table for matching records
3. Group sessions by album membership -> vehicle profiles
4. Orphan sessions get tentative profiles from YONO results (Phase 4 backfill)
"""

import json
import os
import re
import time
import uuid as uuid_mod

from .db import get_db, count, log_run

MAKES = [
    'Chevrolet', 'GMC', 'Ford', 'Dodge', 'Pontiac', 'Jaguar', 'Porsche',
    'Ferrari', 'Mercedes', 'Nissan', 'Lexus', 'Lincoln', 'Buick', 'DMC',
    'DeLorean', 'Toyota', 'Honda', 'BMW', 'Audi', 'Volkswagen', 'Volvo',
    'Cadillac', 'Oldsmobile', 'Plymouth', 'Chrysler', 'Jeep', 'Land Rover',
    'Alfa Romeo', 'Maserati', 'Lamborghini', 'Aston Martin', 'Lotus',
    'Triumph', 'MG', 'Austin-Healey', 'Datsun', 'Subaru', 'Mazda',
    'International', 'Scout', 'Bronco', 'Willys',
]


def parse_album_name(name: str) -> dict | None:
    """Parse album name into year/make/model. Port of iphoto-intake.mjs parseAlbumName."""
    name = name.strip()
    m = re.match(r'^(\d{4})\s+(.+)$', name)
    if not m:
        return None
    year = int(m.group(1))
    rest = m.group(2).strip()

    make = None
    parts = rest.split()
    for mk in MAKES:
        for i, p in enumerate(parts):
            if p.lower() == mk.lower():
                make = mk
                parts.pop(i)
                break
        if make:
            break

    if not make:
        make = 'Unknown'

    model = ' '.join(parts).strip()
    return {"year": year, "make": make, "model": model}


_vehicle_cache = None


def _load_vehicle_cache():
    """Load user's iphoto-linked vehicles (same strategy as iphoto-intake.mjs)."""
    global _vehicle_cache
    if _vehicle_cache is not None:
        return

    try:
        from supabase import create_client
    except ImportError:
        _vehicle_cache = []
        return

    url = os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        _vehicle_cache = []
        return

    sb = create_client(url, key)

    # Get vehicle IDs that already have iphoto images
    vehicle_ids = set()
    offset = 0
    while True:
        result = sb.table("vehicle_images").select("vehicle_id").eq(
            "source", "iphoto"
        ).range(offset, offset + 999).execute()
        if not result.data:
            break
        for r in result.data:
            vehicle_ids.add(r["vehicle_id"])
        if len(result.data) < 1000:
            break
        offset += 1000

    # Fetch full details
    _vehicle_cache = []
    ids = list(vehicle_ids)
    for i in range(0, len(ids), 50):
        batch = ids[i:i+50]
        result = sb.table("vehicles").select("id, year, make, model, vin").in_("id", batch).execute()
        if result.data:
            _vehicle_cache.extend(result.data)

    print(f"    Vehicle cache: {len(_vehicle_cache)} user vehicles (iphoto-linked)")


def _find_vehicle_supabase(year: int, make: str, model: str) -> dict | None:
    """Find matching vehicle from user's iphoto vehicle cache, falling back to full DB search."""
    _load_vehicle_cache()

    model_first = model.split()[0].lower() if model else ""
    make_lower = make.lower()

    # Search cache first (user's own vehicles — much more accurate)
    matches = [v for v in _vehicle_cache
               if v["year"] == year
               and make_lower in (v.get("make") or "").lower()
               and model_first in (v.get("model") or "").lower()]

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        print(f"    Ambiguous cache: {len(matches)} vehicles match {year} {make} {model}")
        return None

    # Fall back to full DB search (only if cache miss)
    try:
        from supabase import create_client
        url = os.environ.get("VITE_SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return None
        sb = create_client(url, key)
        result = sb.table("vehicles").select("id, year, make, model, vin").eq(
            "year", year
        ).ilike("make", f"%{make}%").ilike("model", f"%{model_first}%").limit(5).execute()
        if result.data and len(result.data) == 1:
            return result.data[0]
    except Exception:
        pass
    return None


def build_profiles(on_progress=None) -> int:
    """
    Build vehicle profiles from album names and Supabase matching.

    Returns:
        Number of profiles created
    """
    db = get_db()
    t0 = time.time()

    existing = count(db, "vehicle_profiles")
    if existing > 0:
        print(f"  Profiles: {existing} already exist (reset to re-run)")
        if on_progress:
            on_progress(existing, existing)
        return existing

    # Get all distinct vehicle albums from photos
    rows = db.execute(
        "SELECT DISTINCT albums FROM photos WHERE is_vehicle=1 AND albums IS NOT NULL"
    ).fetchall()

    # Collect all album names that look like vehicles
    album_set = set()
    for row in rows:
        try:
            albums = json.loads(row["albums"])
        except (json.JSONDecodeError, TypeError):
            continue
        for a in albums:
            if re.match(r'^\d{4}\s', a.strip()):
                album_set.add(a.strip())

    profiles = []
    for album_name in sorted(album_set):
        parsed = parse_album_name(album_name)
        if not parsed:
            continue

        pid = str(uuid_mod.uuid4())[:8]

        # Try Supabase match
        vehicle = _find_vehicle_supabase(parsed["year"], parsed["make"], parsed["model"])
        supabase_id = vehicle["id"] if vehicle else None
        if vehicle:
            print(f"    {album_name} -> {vehicle['year']} {vehicle['make']} {vehicle['model']} ({vehicle.get('vin', 'no VIN')})")
        else:
            print(f"    {album_name} -> {parsed['year']} {parsed['make']} {parsed['model']} (no DB match)")

        profiles.append({
            "id": pid,
            "album_name": album_name,
            "year": parsed["year"],
            "make": parsed["make"],
            "model": parsed["model"],
            "supabase_vehicle_id": supabase_id,
        })

    # Insert profiles
    for p in profiles:
        db.execute(
            "INSERT OR REPLACE INTO vehicle_profiles (id, album_name, year, make, model, supabase_vehicle_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [p["id"], p["album_name"], p["year"], p["make"], p["model"], p["supabase_vehicle_id"]]
        )

    # Assign photos to profiles based on album membership
    assigned = 0
    for p in profiles:
        # Find all photos in this album
        # Photos can have multiple albums, so we need JSON contains check
        # SQLite doesn't have native JSON array contains, use LIKE
        escaped = p["album_name"].replace("'", "''").replace("%", "\\%").replace('"', '\\"')
        photo_uuids = db.execute(
            f'SELECT uuid FROM photos WHERE is_vehicle=1 AND albums LIKE \'%"{escaped}"%\''
        ).fetchall()

        for row in photo_uuids:
            db.execute("UPDATE photos SET profile_id=? WHERE uuid=?", [p["id"], row["uuid"]])
            assigned += 1

        # Update profile photo count
        pc = len(photo_uuids)
        db.execute("UPDATE vehicle_profiles SET photo_count=? WHERE id=?", [pc, p["id"]])

        # Assign sessions that belong to this profile
        session_ids = db.execute(
            "SELECT DISTINCT session_id FROM photos WHERE profile_id=? AND session_id IS NOT NULL",
            [p["id"]]
        ).fetchall()
        for s in session_ids:
            db.execute("UPDATE sessions SET profile_id=? WHERE id=?", [p["id"], s["session_id"]])
        db.execute("UPDATE vehicle_profiles SET session_count=? WHERE id=?", [len(session_ids), p["id"]])

        # Date range
        dates = db.execute(
            "SELECT MIN(date) as first, MAX(date) as last FROM photos WHERE profile_id=?",
            [p["id"]]
        ).fetchone()
        if dates["first"]:
            db.execute(
                "UPDATE vehicle_profiles SET first_photo=?, last_photo=? WHERE id=?",
                [dates["first"], dates["last"], p["id"]]
            )

    db.commit()

    # Count orphan vehicle photos (no album match)
    orphan_count = count(db, "photos", "is_vehicle=1 AND profile_id IS NULL")
    if orphan_count > 0:
        print(f"    {orphan_count} vehicle photos not in any vehicle album (orphans)")

    duration = time.time() - t0
    log_run(db, "profiles", len(album_set), len(profiles), duration, f"{assigned} photos assigned, {orphan_count} orphans")
    if on_progress:
        on_progress(len(profiles), len(profiles))
    print(f"  Profiles: {len(profiles)} created, {assigned} photos assigned in {duration:.1f}s")
    db.close()
    return len(profiles)
