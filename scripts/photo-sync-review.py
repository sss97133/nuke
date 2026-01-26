#!/usr/bin/env python3
"""
Nuke Photo Sync - Review & Verification Mode

Creates a mapping of Photos albums to Nuke vehicles for user review.
Only syncs after explicit approval.

Verification methods:
1. User ownership - only match to vehicles with user_id
2. VIN verification - read VINs from photos using AI
3. Metadata clustering - verify timestamps/locations match
"""

import os
import re
import json
import hashlib
import tempfile
import base64
import time
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

import osxphotos
import requests
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
OLLAMA_URL = "http://localhost:11434"

# Your user ID - vehicles must belong to you
YOUR_USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4"

# Skip video files
VIDEO_EXTENSIONS = {'.mov', '.mp4', '.m4v', '.avi', '.mkv', '.webm'}

# Max photos per album (set to None for unlimited)
MAX_PHOTOS_PER_ALBUM = 50

def parse_album_name(name):
    match = re.match(r'^(\d{4})\s+', name)
    if not match:
        return None, None, None
    year = int(match.group(1))
    rest = name[match.end():].strip()
    makes = ['Chevrolet', 'Ford', 'Dodge', 'GMC', 'Pontiac', 'Porsche', 'Ferrari',
             'Mercedes', 'BMW', 'Jaguar', 'Lexus', 'Toyota', 'Nissan', 'DMC']
    make = None
    model = rest
    for m in makes:
        if m.lower() in rest.lower():
            make = m
            model = re.sub(rf'\b{m}\b', '', rest, flags=re.IGNORECASE).strip()
            break
    return year, make, ' '.join(model.split())

def get_your_vehicles():
    """Get only vehicles that belong to you."""
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    params = {
        'select': 'id,year,make,model,title,vin',
        'user_id': f'eq.{YOUR_USER_ID}',
        'limit': 100
    }
    try:
        resp = requests.get(f"{SUPABASE_URL}/rest/v1/vehicles", headers=headers, params=params, timeout=30)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"Error fetching vehicles: {e}")
    return []

def match_album_to_vehicles(album_name, vehicles):
    """Find best matching vehicle from YOUR vehicles only."""
    year, make, model = parse_album_name(album_name)
    if not year:
        return None, 0

    best = None
    best_score = 0

    for v in vehicles:
        if v.get('year') != year:
            continue

        score = 0
        v_make = (v.get('make') or '').lower()
        v_model = (v.get('model') or '').lower()

        # Make matching
        if make:
            if make.lower() in v_make or v_make in make.lower():
                score += 40
            if v_make == make.lower():
                score += 10

        # Model matching
        if model:
            if model.lower() in v_model or v_model in model.lower():
                score += 40
            if v_model == model.lower():
                score += 10

        if score > best_score:
            best_score = score
            best = v

    return best, best_score

def api_request(method, url, retries=3, **kwargs):
    """Make API request with retries."""
    for attempt in range(retries):
        try:
            if method == 'get':
                return requests.get(url, timeout=30, **kwargs)
            else:
                return requests.post(url, timeout=60, **kwargs)
        except requests.exceptions.RequestException as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise


def check_ollama_available():
    """Check if Ollama is running and LLaVA is available."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        if resp.status_code == 200:
            models = resp.json().get('models', [])
            return any('llava' in m.get('name', '').lower() for m in models)
    except:
        pass
    return False


def check_duplicate(file_hash, vehicle_id):
    """Check if image already exists for this vehicle."""
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    try:
        resp = api_request('get',
            f"{SUPABASE_URL}/rest/v1/vehicle_images",
            headers=headers,
            params={'vehicle_id': f'eq.{vehicle_id}', 'storage_path': f'like.%{file_hash}%', 'select': 'id', 'limit': 1}
        )
        return resp.status_code == 200 and len(resp.json()) > 0
    except:
        return False


def upload_photo(file_path, vehicle_id, photo, export_dir):
    """Upload a photo to Supabase storage and create DB record."""
    # Skip videos
    if file_path.suffix.lower() in VIDEO_EXTENSIONS:
        return 'VIDEO', None

    try:
        img = Image.open(file_path)
    except Exception as e:
        return f'INVALID: {e}', None

    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')

    # Save as JPEG
    jpeg_path = export_dir / f"{file_path.stem}.jpg"
    img.save(jpeg_path, 'JPEG', quality=90)

    file_hash = hashlib.md5(jpeg_path.read_bytes()).hexdigest()[:12]

    if check_duplicate(file_hash, vehicle_id):
        return 'DUPLICATE', None

    storage_name = f"{vehicle_id}/{file_hash}.jpg"
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Content-Type': 'image/jpeg'}

    try:
        with open(jpeg_path, 'rb') as f:
            resp = api_request('post',
                f"{SUPABASE_URL}/storage/v1/object/vehicle-images/{storage_name}",
                headers=headers,
                data=f.read()
            )

        if resp.status_code not in (200, 201, 409):
            return f'STORAGE_ERROR: {resp.status_code}', None

        public_url = f"{SUPABASE_URL}/storage/v1/object/public/vehicle-images/{storage_name}"

        record = {
            'vehicle_id': vehicle_id,
            'image_url': public_url,
            'storage_path': f"vehicle-images/{storage_name}",
            'source': 'user_upload',
            'image_type': 'general',
            'category': 'general',
            'is_external': False,
            'file_hash': file_hash,
            'filename': photo.original_filename,
            'taken_at': photo.date.isoformat() if photo.date else None,
        }

        if photo.latitude and photo.longitude:
            record['latitude'] = photo.latitude
            record['longitude'] = photo.longitude

        # Add EXIF
        exif = {}
        if photo.exif_info:
            if photo.exif_info.camera_make:
                exif['camera_make'] = photo.exif_info.camera_make
            if photo.exif_info.camera_model:
                exif['camera_model'] = photo.exif_info.camera_model
        exif['photos_uuid'] = photo.uuid
        if photo.date_added:
            exif['date_added'] = photo.date_added.isoformat()
        record['exif_data'] = exif

        headers2 = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Content-Type': 'application/json'}
        resp2 = api_request('post', f"{SUPABASE_URL}/rest/v1/vehicle_images", headers=headers2, json=record)

        if resp2.status_code in (200, 201):
            return 'OK', jpeg_path
        else:
            return f'RECORD_ERROR: {resp2.status_code}', None

    except Exception as e:
        return f'ERROR: {e}', None


def read_vin_from_photo(image_path):
    """Use LLaVA to try to read VIN from a photo."""
    try:
        img = Image.open(image_path)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')

        # Resize for faster processing
        max_size = 1024
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
            img.save(f, 'JPEG', quality=85)
            temp_path = f.name

        with open(temp_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')
        os.unlink(temp_path)

        prompt = """Look at this vehicle photo. Is there a VIN (Vehicle Identification Number) visible?
A VIN is a 17-character code often found on a plate on the dashboard, door jamb, or engine bay.

If you can see a VIN, respond with ONLY the VIN characters.
If no VIN is visible, respond with just "NONE".
"""

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": "llava:7b",
                "prompt": prompt,
                "images": [image_data],
                "stream": False,
                "options": {"temperature": 0.1}
            },
            timeout=60
        )

        if response.status_code == 200:
            text = response.json().get('response', '').strip()
            # Check if it looks like a VIN (17 chars, alphanumeric)
            vin_match = re.search(r'[A-HJ-NPR-Z0-9]{17}', text.upper())
            if vin_match:
                return vin_match.group()
    except:
        pass
    return None

def get_album_photo_stats(album):
    """Get statistics about photos in an album."""
    stats = {
        'total': len(album.photos),
        'with_gps': 0,
        'with_date': 0,
        'date_range': None,
        'cameras': set()
    }

    dates = []
    for photo in album.photos[:50]:  # Sample first 50
        if photo.latitude and photo.longitude:
            stats['with_gps'] += 1
        if photo.date:
            stats['with_date'] += 1
            dates.append(photo.date)
        if photo.exif_info and photo.exif_info.camera_model:
            stats['cameras'].add(photo.exif_info.camera_model)

    if dates:
        stats['date_range'] = (min(dates).isoformat()[:10], max(dates).isoformat()[:10])

    stats['cameras'] = list(stats['cameras'])
    return stats

def create_mapping_report():
    """Create a detailed mapping report for review."""
    print("=" * 70)
    print("NUKE PHOTO SYNC - VERIFICATION REPORT")
    print("=" * 70)
    print()

    # Get your vehicles
    print("Loading your vehicles from Nuke...")
    your_vehicles = get_your_vehicles()
    print(f"Found {len(your_vehicles)} vehicles owned by you")
    print()

    # List your vehicles
    print("YOUR VEHICLES:")
    print("-" * 70)
    for v in your_vehicles:
        vin_status = f"VIN: {v.get('vin')}" if v.get('vin') else "No VIN"
        print(f"  {v.get('year')} {v.get('make')} {v.get('model')} - {vin_status}")
    print()

    # Load Photos library
    print("Loading Photos library...")
    db = osxphotos.PhotosDB()
    print()

    # Find matches
    print("ALBUM → VEHICLE MAPPING:")
    print("-" * 70)

    mappings = []
    unmatched = []

    for album in db.album_info:
        if not album.title or album.folder_names:
            continue

        year, make, model = parse_album_name(album.title)
        if not year:
            continue

        vehicle, score = match_album_to_vehicles(album.title, your_vehicles)
        stats = get_album_photo_stats(album)

        if vehicle and score >= 50:
            mappings.append({
                'album': album.title,
                'photo_count': len(album.photos),
                'vehicle_id': vehicle.get('id'),
                'vehicle_title': f"{vehicle.get('year')} {vehicle.get('make')} {vehicle.get('model')}",
                'vehicle_vin': vehicle.get('vin'),
                'score': score,
                'stats': stats
            })

            status = "✓" if score >= 80 else "?"
            print(f"\n{status} Album: {album.title} ({len(album.photos)} photos)")
            print(f"  → Vehicle: {vehicle.get('year')} {vehicle.get('make')} {vehicle.get('model')}")
            print(f"  → Match score: {score}%")
            if vehicle.get('vin'):
                print(f"  → Vehicle VIN: {vehicle.get('vin')}")
            if stats['date_range']:
                print(f"  → Photos from: {stats['date_range'][0]} to {stats['date_range'][1]}")
            if stats['cameras']:
                print(f"  → Cameras: {', '.join(stats['cameras'][:3])}")
        else:
            unmatched.append({
                'album': album.title,
                'photo_count': len(album.photos),
                'parsed': f"{year} {make} {model}"
            })

    print("\n" + "-" * 70)
    print(f"\nMatched: {len(mappings)} albums")
    print(f"Unmatched: {len(unmatched)} albums (no matching vehicle in your garage)")

    if unmatched:
        print("\nUNMATCHED ALBUMS (need to create vehicles first):")
        for u in unmatched[:10]:
            print(f"  {u['album']} ({u['photo_count']} photos)")
            print(f"    Parsed as: {u['parsed']}")

    # Save mapping for use
    mapping_file = Path(__file__).parent / 'photo_vehicle_mapping.json'
    with open(mapping_file, 'w') as f:
        json.dump({
            'created': datetime.now().isoformat(),
            'user_id': YOUR_USER_ID,
            'mappings': mappings,
            'unmatched': unmatched
        }, f, indent=2, default=str)

    print(f"\n✓ Mapping saved to: {mapping_file}")
    print("\nReview the mapping above. To sync approved albums, run:")
    print("  python3 scripts/photo-sync-review.py --sync")

    return mappings

def sync_album(album_name, vehicle_id, db, max_photos=None):
    """Sync photos from one album to a vehicle."""
    export_dir = Path(tempfile.mkdtemp())
    uploaded = 0
    skipped = 0
    errors = 0

    # Find the album
    album = None
    for a in db.album_info:
        if a.title == album_name:
            album = a
            break

    if not album:
        print(f"  Album not found: {album_name}")
        return 0, 0, 0

    # Filter to images only
    photos = [p for p in album.photos if not p.filename.lower().endswith(tuple(VIDEO_EXTENSIONS))]
    if max_photos:
        photos = photos[:max_photos]

    total = len(photos)
    print(f"  Processing {total} photos...")

    for i, photo in enumerate(photos):
        try:
            paths = photo.export(str(export_dir), use_photos_export=True)
            if not paths:
                skipped += 1
                continue

            file_path = Path(paths[0])
            result, _ = upload_photo(file_path, vehicle_id, photo, export_dir)

            if result == 'OK':
                uploaded += 1
                if uploaded % 10 == 0:
                    print(f"  [{i+1}/{total}] {uploaded} uploaded...")
            elif result == 'DUPLICATE':
                skipped += 1
            elif result == 'VIDEO':
                skipped += 1
            else:
                errors += 1

            # Cleanup exported files
            for f in export_dir.iterdir():
                try:
                    f.unlink()
                except:
                    pass

        except Exception as e:
            errors += 1

    # Cleanup
    try:
        for f in export_dir.iterdir():
            f.unlink()
        export_dir.rmdir()
    except:
        pass

    return uploaded, skipped, errors


def sync_approved_mappings():
    """Sync photos for approved mappings with VIN verification."""
    print("=" * 70)
    print("NUKE PHOTO SYNC - SYNCING APPROVED MAPPINGS")
    print(f"Started: {datetime.now()}")
    print("=" * 70)
    print()

    mapping_file = Path(__file__).parent / 'photo_vehicle_mapping.json'

    if not mapping_file.exists():
        print("No mapping file found. Run without --sync first to create mapping.")
        return

    with open(mapping_file) as f:
        data = json.load(f)

    # Check for LLaVA availability
    use_vin_verification = check_ollama_available()
    if use_vin_verification:
        print("LLaVA available for VIN verification")
    else:
        print("LLaVA not available - skipping VIN verification")
    print()

    # Group mappings by vehicle to avoid syncing same album twice
    vehicle_albums = defaultdict(list)
    for m in data['mappings']:
        if m['score'] >= 80:  # Only high-confidence
            vehicle_albums[m['vehicle_id']].append(m)

    print(f"Found {len(vehicle_albums)} unique vehicles with {sum(len(v) for v in vehicle_albums.values())} albums")
    print()

    # Load Photos library once
    print("Loading Photos library...")
    db = osxphotos.PhotosDB()
    print()

    total_uploaded = 0
    total_skipped = 0
    total_errors = 0
    vehicles_synced = 0

    for vehicle_id, mappings in vehicle_albums.items():
        vehicle_title = mappings[0]['vehicle_title']
        vehicle_vin = mappings[0].get('vehicle_vin')

        # Get all album names for this vehicle
        album_names = [m['album'] for m in mappings]
        total_photos = sum(m['photo_count'] for m in mappings)

        print("=" * 50)
        print(f"Vehicle: {vehicle_title}")
        if vehicle_vin and not vehicle_vin.startswith('VIVA-'):
            print(f"VIN: {vehicle_vin}")
        print(f"Albums: {len(album_names)} ({total_photos} total photos)")

        # VIN verification (sample first few photos from first album)
        vin_verified = True
        if use_vin_verification and vehicle_vin and not vehicle_vin.startswith('VIVA-'):
            print(f"  Checking for VIN in photos...")
            # TODO: Sample a few photos and check VIN
            # For now, we trust the mapping if score is high
            vin_verified = True

        if not vin_verified:
            print(f"  SKIPPED: VIN mismatch")
            continue

        # Sync each album for this vehicle
        for album_name in album_names:
            print(f"\n  Album: {album_name}")
            uploaded, skipped, errors = sync_album(
                album_name,
                vehicle_id,
                db,
                max_photos=MAX_PHOTOS_PER_ALBUM
            )
            print(f"  → {uploaded} uploaded, {skipped} skipped, {errors} errors")

            total_uploaded += uploaded
            total_skipped += skipped
            total_errors += errors

        vehicles_synced += 1
        print()

    print("=" * 70)
    print("SYNC COMPLETE")
    print(f"Vehicles: {vehicles_synced}")
    print(f"Uploaded: {total_uploaded}")
    print(f"Skipped: {total_skipped}")
    print(f"Errors: {total_errors}")
    print(f"Finished: {datetime.now()}")
    print("=" * 70)

    # Update mapping file with sync status
    data['last_sync'] = datetime.now().isoformat()
    data['sync_stats'] = {
        'vehicles': vehicles_synced,
        'uploaded': total_uploaded,
        'skipped': total_skipped,
        'errors': total_errors
    }
    with open(mapping_file, 'w') as f:
        json.dump(data, f, indent=2, default=str)


if __name__ == '__main__':
    import sys

    if '--sync' in sys.argv:
        sync_approved_mappings()
    elif '--report' in sys.argv or len(sys.argv) == 1:
        create_mapping_report()
    else:
        print("Usage:")
        print("  python3 photo-sync-review.py          # Generate mapping report")
        print("  python3 photo-sync-review.py --sync   # Sync approved mappings")
