#!/usr/bin/env python3
"""
Nuke Photo Sync - Robust Version
Syncs photos from macOS Photos to Nuke vehicle profiles.
"""

import os
import re
import hashlib
import tempfile
import time
from pathlib import Path
from datetime import datetime, timezone

import osxphotos
import requests
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

# Skip video files
VIDEO_EXTENSIONS = {'.mov', '.mp4', '.m4v', '.avi', '.mkv', '.webm'}

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
                print(f"    Retry {attempt + 1}/{retries}...")
                time.sleep(2 ** attempt)
            else:
                raise

def search_vehicle(year, make, model):
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    params = {'select': 'id,year,make,model,title', 'year': f'eq.{year}', 'limit': 20}

    try:
        resp = api_request('get', f"{SUPABASE_URL}/rest/v1/vehicles", headers=headers, params=params)
        if resp.status_code == 200:
            best = None
            best_score = 0
            for v in resp.json():
                score = 0
                v_make = (v.get('make') or '').lower()
                v_model = (v.get('model') or '').lower()
                if make and (make.lower() in v_make or v_make in make.lower()):
                    score += 40
                if model and (model.lower() in v_model or v_model in model.lower()):
                    score += 40
                if v_make == (make or '').lower():
                    score += 10
                if v_model == (model or '').lower():
                    score += 10
                if score > best_score:
                    best_score = score
                    best = v
                    best['score'] = score
            return best if best_score >= 80 else None
    except Exception as e:
        print(f"    Search error: {e}")
    return None

def check_duplicate(file_hash, vehicle_id):
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

def upload_photo(file_path, vehicle_id, photo):
    # Skip videos
    if file_path.suffix.lower() in VIDEO_EXTENSIONS:
        return 'VIDEO'

    try:
        img = Image.open(file_path)
    except Exception as e:
        return f'INVALID: {e}'

    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')
    jpeg_path = file_path.with_suffix('.jpg')
    img.save(jpeg_path, 'JPEG', quality=90)

    file_hash = hashlib.md5(jpeg_path.read_bytes()).hexdigest()[:12]

    if check_duplicate(file_hash, vehicle_id):
        return 'DUPLICATE'

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
            return f'STORAGE_ERROR: {resp.status_code}'

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
            return 'OK'
        else:
            return f'RECORD_ERROR: {resp2.status_code}'

    except Exception as e:
        return f'ERROR: {e}'

def sync_album(album, vehicle, max_photos=20):
    """Sync one album to a vehicle."""
    export_dir = Path(tempfile.mkdtemp())
    uploaded = 0
    skipped = 0

    # Filter to images only
    photos = [p for p in album.photos if not p.filename.lower().endswith(tuple(VIDEO_EXTENSIONS))][:max_photos]

    for i, photo in enumerate(photos):
        try:
            paths = photo.export(str(export_dir), use_photos_export=True)
            if not paths:
                print(f"  [{i+1}/{len(photos)}] export failed")
                skipped += 1
                continue

            file_path = Path(paths[0])
            result = upload_photo(file_path, vehicle['id'], photo)

            if result == 'OK':
                print(f"  [{i+1}/{len(photos)}] ✓ {photo.original_filename}")
                uploaded += 1
            elif result == 'DUPLICATE':
                print(f"  [{i+1}/{len(photos)}] dup")
                skipped += 1
            elif result == 'VIDEO':
                print(f"  [{i+1}/{len(photos)}] skip video")
                skipped += 1
            else:
                print(f"  [{i+1}/{len(photos)}] {result}")
                skipped += 1

            # Cleanup
            file_path.unlink(missing_ok=True)
            jpg = file_path.with_suffix('.jpg')
            if jpg.exists():
                jpg.unlink()

        except Exception as e:
            print(f"  [{i+1}/{len(photos)}] error: {e}")
            skipped += 1

    # Cleanup
    try:
        for f in export_dir.iterdir():
            f.unlink()
        export_dir.rmdir()
    except:
        pass

    return uploaded, skipped

def main():
    import sys

    max_photos = 20
    for arg in sys.argv[1:]:
        if arg.startswith('--max='):
            max_photos = int(arg.split('=')[1])

    print("=" * 70)
    print("NUKE PHOTO SYNC")
    print(f"Started: {datetime.now()}")
    print(f"Max photos per album: {max_photos}")
    print("=" * 70)

    db = osxphotos.PhotosDB()

    total_uploaded = 0
    total_skipped = 0
    albums_processed = 0

    # Get all vehicle albums with matches
    matches = []
    for album in db.album_info:
        if not album.title or album.folder_names:
            continue
        year, make, model = parse_album_name(album.title)
        if not year:
            continue
        vehicle = search_vehicle(year, make, model)
        if vehicle and vehicle.get('score', 0) >= 80:
            matches.append((album, vehicle))

    print(f"\nFound {len(matches)} albums with high-confidence matches")

    for album, vehicle in matches:
        title = vehicle.get('title') or f"{vehicle.get('year')} {vehicle.get('make')} {vehicle.get('model')}"
        print(f"\n{'='*50}")
        print(f"Album: {album.title} ({len(album.photos)} total)")
        print(f"Vehicle: {title} ({vehicle.get('score')}%)")

        uploaded, skipped = sync_album(album, vehicle, max_photos)

        print(f"Result: {uploaded} uploaded, {skipped} skipped")
        total_uploaded += uploaded
        total_skipped += skipped
        albums_processed += 1

    print("\n" + "=" * 70)
    print("COMPLETE")
    print(f"Albums: {albums_processed}")
    print(f"Uploaded: {total_uploaded}")
    print(f"Skipped: {total_skipped}")
    print(f"Finished: {datetime.now()}")
    print("=" * 70)

if __name__ == '__main__':
    main()
