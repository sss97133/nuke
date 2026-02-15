#!/usr/bin/env python3
"""
Apple Photos Album Manager for Nuke Photo Auto-Sync.
Creates, renames, and populates albums via JXA (osascript).
Bidirectional sync with Nuke image_sets.
"""

import os
import re
import json
import subprocess
import logging
from typing import Optional, Dict, List, Tuple

import requests

logger = logging.getLogger('photo-sync-album-manager')

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

HEADERS = {
    'apikey': SUPABASE_KEY or '',
    'Authorization': f'Bearer {SUPABASE_KEY}' if SUPABASE_KEY else '',
    'Content-Type': 'application/json',
}


# ============================================================================
# JXA HELPERS
# ============================================================================

def run_jxa(script: str, timeout: int = 30) -> Optional[dict]:
    """Run a JXA script and return parsed JSON result."""
    try:
        result = subprocess.run(
            ['osascript', '-l', 'JavaScript', '-e', script],
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, 'LANG': 'en_US.UTF-8'}
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip())
        if result.stderr:
            logger.warning(f"JXA stderr: {result.stderr[:200]}")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("JXA script timed out")
        return None
    except json.JSONDecodeError as e:
        logger.warning(f"JXA JSON parse error: {e}")
        return None
    except Exception as e:
        logger.error(f"JXA error: {e}")
        return None


# ============================================================================
# ALBUM CRUD
# ============================================================================

def list_albums() -> List[Dict]:
    """List all Apple Photos albums with id, name, count."""
    script = '''
    (() => {
        const Photos = Application('Photos');
        Photos.includeStandardAdditions = true;
        const result = Photos.albums().map(a => ({
            id: String(a.id()),
            name: a.name(),
            count: a.mediaItems().length
        }));
        return JSON.stringify(result);
    })();
    '''
    result = run_jxa(script, timeout=60)
    return result if isinstance(result, list) else []


def create_album(name: str) -> Optional[Dict]:
    """Create a new Apple Photos album. Returns {id, name}."""
    safe_name = name.replace("'", "\\'").replace('"', '\\"')
    script = f'''
    (() => {{
        const Photos = Application('Photos');
        Photos.includeStandardAdditions = true;
        // Check if album already exists
        const existing = Photos.albums().filter(a => a.name() === '{safe_name}');
        if (existing.length > 0) {{
            return JSON.stringify({{id: String(existing[0].id()), name: existing[0].name(), existed: true}});
        }}
        const album = Photos.make({{new: 'album', withProperties: {{name: '{safe_name}'}}}});
        return JSON.stringify({{id: String(album.id()), name: album.name(), existed: false}});
    }})();
    '''
    result = run_jxa(script)
    if result:
        if result.get('existed'):
            logger.info(f"Album already exists: {name}")
        else:
            logger.info(f"Created album: {name}")
    return result


def rename_album(album_id: str, new_name: str) -> bool:
    """Rename an Apple Photos album."""
    safe_id = album_id.replace("'", "\\'")
    safe_name = new_name.replace("'", "\\'").replace('"', '\\"')
    script = f'''
    (() => {{
        const Photos = Application('Photos');
        const albums = Photos.albums().filter(a => String(a.id()) === '{safe_id}');
        if (albums.length === 0) return JSON.stringify({{ok: false, error: 'not found'}});
        albums[0].name = '{safe_name}';
        return JSON.stringify({{ok: true}});
    }})();
    '''
    result = run_jxa(script)
    return result.get('ok', False) if result else False


def add_photos_to_album(album_id: str, photo_uuids: List[str]) -> int:
    """Add photos to an album by their UUIDs. Returns count added."""
    if not photo_uuids:
        return 0

    safe_id = album_id.replace("'", "\\'")
    uuid_list = ','.join(f"'{u.replace(chr(39), '')}'" for u in photo_uuids)

    script = f'''
    (() => {{
        const Photos = Application('Photos');
        const albums = Photos.albums().filter(a => String(a.id()) === '{safe_id}');
        if (albums.length === 0) return JSON.stringify({{added: 0, error: 'album not found'}});
        const album = albums[0];
        const all = Photos.mediaItems();
        const items = all.filter(m => [{uuid_list}].includes(String(m.id())));
        if (items.length === 0) return JSON.stringify({{added: 0, error: 'no matching photos'}});
        Photos.add(items, {{to: album}});
        return JSON.stringify({{added: items.length}});
    }})();
    '''
    result = run_jxa(script, timeout=60)
    added = result.get('added', 0) if result else 0
    if added > 0:
        logger.info(f"Added {added} photos to album {safe_id}")
    return added


def remove_photos_from_album(album_id: str, photo_uuids: List[str]) -> int:
    """Remove photos from an album (doesn't delete the photo)."""
    if not photo_uuids:
        return 0

    safe_id = album_id.replace("'", "\\'")
    uuid_list = ','.join(f"'{u.replace(chr(39), '')}'" for u in photo_uuids)

    script = f'''
    (() => {{
        const Photos = Application('Photos');
        const albums = Photos.albums().filter(a => String(a.id()) === '{safe_id}');
        if (albums.length === 0) return JSON.stringify({{removed: 0}});
        const album = albums[0];
        const items = album.mediaItems().filter(m => [{uuid_list}].includes(String(m.id())));
        if (items.length === 0) return JSON.stringify({{removed: 0}});
        Photos.remove(items, {{from: album}});
        return JSON.stringify({{removed: items.length}});
    }})();
    '''
    result = run_jxa(script, timeout=60)
    return result.get('removed', 0) if result else 0


def get_album_photos(album_id: str, limit: int = 500) -> List[Dict]:
    """Get photo UUIDs and metadata from an album."""
    safe_id = album_id.replace("'", "\\'")
    script = f'''
    (() => {{
        const Photos = Application('Photos');
        const albums = Photos.albums().filter(a => String(a.id()) === '{safe_id}');
        if (albums.length === 0) return JSON.stringify([]);
        const items = albums[0].mediaItems().slice(0, {limit});
        return JSON.stringify(items.map(m => ({{
            id: String(m.id()),
            filename: m.filename(),
            date: m.date() ? m.date().toISOString() : null
        }})));
    }})();
    '''
    result = run_jxa(script, timeout=60)
    return result if isinstance(result, list) else []


# ============================================================================
# ALBUM NAMING
# ============================================================================

MAKES = [
    'Chevrolet', 'Ford', 'Dodge', 'GMC', 'Pontiac', 'Plymouth',
    'Porsche', 'Ferrari', 'Mercedes-Benz', 'BMW', 'Jaguar', 'Lexus',
    'Toyota', 'Nissan', 'Jeep', 'DMC', 'Rolls-Royce', 'Cadillac',
    'Oldsmobile', 'Buick', 'Lincoln', 'Mercury', 'AMC',
    'Volkswagen', 'Mazda', 'Honda', 'Subaru', 'Mitsubishi',
    'Austin', 'YAMAHA', 'FLEETWOOD', 'INFINITI',
]


def generate_album_name(vehicle: Dict) -> str:
    """Generate a standard album name from vehicle data."""
    parts = []

    year = vehicle.get('year')
    make = vehicle.get('make')
    model = vehicle.get('model')
    trim = vehicle.get('trim') or vehicle.get('trim_level')
    color = vehicle.get('color')
    body = vehicle.get('body_style') or vehicle.get('cab_config')

    if year:
        parts.append(str(year))
    if make:
        parts.append(make)
    if model:
        parts.append(model)
    if body:
        parts.append(body)
    if color and not model:
        parts.append(color)

    return ' '.join(parts) if parts else f"Vehicle {vehicle.get('id', 'Unknown')[:8]}"


def parse_album_name(name: str) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    """Parse album name to extract year/make/model."""
    year_match = re.match(r'^(\d{4})\s+', name)
    if not year_match:
        return None, None, None

    year = int(year_match.group(1))
    rest = name[year_match.end():].strip()

    make = None
    model = rest

    for m in MAKES:
        if m.lower() in rest.lower():
            make = m
            model = re.sub(rf'\b{re.escape(m)}\b', '', rest, flags=re.IGNORECASE).strip()
            break

    if make and model:
        model = ' '.join(model.split())

    return year, make, model


# ============================================================================
# NUKE <-> APPLE PHOTOS SYNC
# ============================================================================

def ensure_album_for_vehicle(user_id: str, vehicle: Dict) -> Optional[Dict]:
    """
    Ensure an Apple Photos album exists for a vehicle.
    Creates album if needed, updates album_sync_map.
    Returns {apple_album_id, apple_album_name, vehicle_id}.
    """
    vehicle_id = vehicle.get('id')
    if not vehicle_id:
        return None

    # Check if we already have a mapping
    existing = _get_album_mapping(user_id, vehicle_id)
    if existing:
        return existing

    # Generate album name and create
    album_name = generate_album_name(vehicle)
    result = create_album(album_name)
    if not result:
        return None

    # Save mapping to Supabase
    mapping = {
        'user_id': user_id,
        'apple_album_id': result['id'],
        'apple_album_name': result['name'],
        'vehicle_id': vehicle_id,
    }
    _save_album_mapping(mapping)

    return mapping


def sync_album_to_nuke(user_id: str, apple_album_id: str) -> Dict:
    """Sync an Apple Photos album's contents to Nuke."""
    photos = get_album_photos(apple_album_id)
    mapping = _get_album_mapping_by_apple_id(user_id, apple_album_id)

    if not mapping or not mapping.get('vehicle_id'):
        return {'synced': 0, 'error': 'no vehicle mapping'}

    # Update photo count
    _update_album_count(user_id, apple_album_id, len(photos))

    return {'synced': len(photos), 'vehicle_id': mapping['vehicle_id']}


def full_album_scan(user_id: str) -> Dict:
    """
    Scan all Apple Photos albums, match to vehicles, create mappings.
    Returns summary of matches.
    """
    albums = list_albums()
    matched = 0
    created = 0
    unmatched = []

    for album in albums:
        name = album['name']
        album_id = album['id']

        # Check if already mapped
        existing = _get_album_mapping_by_apple_id(user_id, album_id)
        if existing and existing.get('vehicle_id'):
            matched += 1
            continue

        # Try to parse and match
        year, make, model = parse_album_name(name)
        if not year:
            continue

        vehicle = _search_vehicle(year, make, model, user_id)
        if vehicle:
            mapping = {
                'user_id': user_id,
                'apple_album_id': album_id,
                'apple_album_name': name,
                'vehicle_id': vehicle['id'],
                'photo_count_apple': album['count'],
            }
            _save_album_mapping(mapping)
            matched += 1
            created += 1
            logger.info(f"Mapped album '{name}' -> {vehicle.get('title', vehicle['id'][:8])}")
        else:
            unmatched.append({'name': name, 'year': year, 'make': make, 'model': model, 'count': album['count']})

    return {'matched': matched, 'created': created, 'unmatched': unmatched}


# ============================================================================
# SUPABASE HELPERS
# ============================================================================

def _get_album_mapping(user_id: str, vehicle_id: str) -> Optional[Dict]:
    if not SUPABASE_URL:
        return None
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/album_sync_map",
            headers=HEADERS,
            params={'user_id': f'eq.{user_id}', 'vehicle_id': f'eq.{vehicle_id}', 'limit': '1'},
            timeout=10
        )
        if resp.status_code == 200 and resp.json():
            return resp.json()[0]
    except Exception as e:
        logger.error(f"Get album mapping error: {e}")
    return None


def _get_album_mapping_by_apple_id(user_id: str, apple_album_id: str) -> Optional[Dict]:
    if not SUPABASE_URL:
        return None
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/album_sync_map",
            headers=HEADERS,
            params={'user_id': f'eq.{user_id}', 'apple_album_id': f'eq.{apple_album_id}', 'limit': '1'},
            timeout=10
        )
        if resp.status_code == 200 and resp.json():
            return resp.json()[0]
    except Exception as e:
        logger.error(f"Get album mapping error: {e}")
    return None


def _save_album_mapping(mapping: Dict):
    if not SUPABASE_URL:
        return
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/album_sync_map",
            headers={**HEADERS, 'Prefer': 'resolution=merge-duplicates'},
            json=mapping,
            timeout=10
        )
    except Exception as e:
        logger.error(f"Save album mapping error: {e}")


def _update_album_count(user_id: str, apple_album_id: str, count: int):
    if not SUPABASE_URL:
        return
    try:
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/album_sync_map",
            headers=HEADERS,
            params={'user_id': f'eq.{user_id}', 'apple_album_id': f'eq.{apple_album_id}'},
            json={'photo_count_apple': count, 'last_synced_at': 'now()'},
            timeout=10
        )
    except Exception as e:
        logger.error(f"Update album count error: {e}")


def _search_vehicle(year: int, make: str, model: str, user_id: str) -> Optional[Dict]:
    """Search for a matching vehicle in Nuke. Prioritizes user's own vehicles."""
    if not SUPABASE_URL:
        return None
    try:
        params = {
            'select': 'id,year,make,model,title,vin,color,user_id',
            'year': f'eq.{year}',
            'deleted_at': 'is.null',
            'limit': '20',
        }
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/vehicles",
            headers=HEADERS,
            params=params,
            timeout=10
        )
        if resp.status_code != 200:
            return None

        vehicles = resp.json()
        best = None
        best_score = 0

        for v in vehicles:
            score = 0
            v_make = (v.get('make') or '').lower()
            v_model = (v.get('model') or '').lower()
            s_make = (make or '').lower()
            s_model = (model or '').lower()

            if s_make and (s_make in v_make or v_make in s_make):
                score += 40
            if s_model and (s_model in v_model or v_model in s_model):
                score += 40
            if v_make == s_make:
                score += 10
            if v_model == s_model:
                score += 10
            # Boost user's own vehicles
            if v.get('user_id') == user_id:
                score += 20

            if score > best_score:
                best_score = score
                best = v

        return best if best_score >= 40 else None
    except Exception as e:
        logger.error(f"Vehicle search error: {e}")
    return None
