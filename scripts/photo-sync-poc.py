#!/usr/bin/env python3
"""
Nuke Photo Sync - Proof of Concept

Syncs photos from macOS Photos library to Nuke vehicle profiles.

Flow:
1. Read albums from Photos (using osxphotos)
2. Parse album names to extract year/make/model
3. Match to vehicles in Nuke database
4. Export and upload photos to Supabase Storage
5. Create vehicle_images records
"""

import os
import re
import json
import tempfile
import hashlib
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass
from datetime import datetime

import osxphotos
import requests
from PIL import Image
import pillow_heif

# Register HEIF opener with PIL
pillow_heif.register_heif_opener()

# Load environment
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

@dataclass
class AlbumMatch:
    album_name: str
    photo_count: int
    year: Optional[int]
    make: Optional[str]
    model: Optional[str]
    vehicle_id: Optional[str] = None
    vehicle_title: Optional[str] = None
    confidence: float = 0.0

def parse_album_name(name: str) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    """
    Parse album names like:
    - "1977 K5 Chevrolet Blazer" -> (1977, "Chevrolet", "K5 Blazer")
    - "1966 Ford Mustang Cpe Blk" -> (1966, "Ford", "Mustang Cpe Blk")
    - "1973 Dodge Charger" -> (1973, "Dodge", "Charger")
    """
    # Extract year (4 digits at start)
    year_match = re.match(r'^(\d{4})\s+', name)
    if not year_match:
        return None, None, None

    year = int(year_match.group(1))
    rest = name[year_match.end():].strip()

    # Known makes to look for
    makes = [
        'Chevrolet', 'Ford', 'Dodge', 'GMC', 'Pontiac', 'Plymouth',
        'Porsche', 'Ferrari', 'Mercedes', 'BMW', 'Jaguar', 'Lexus',
        'Toyota', 'Nissan', 'Jeep', 'Bronco', 'Mustang'
    ]

    make = None
    model = rest

    for m in makes:
        if m.lower() in rest.lower():
            make = m
            # Try to extract model as what's left
            model = re.sub(rf'\b{m}\b', '', rest, flags=re.IGNORECASE).strip()
            break

    # Handle patterns like "K5 Chevrolet Blazer" -> model should be "K5 Blazer"
    if make and model:
        # Clean up model
        model = ' '.join(model.split())  # Remove extra spaces

    return year, make, model

def search_vehicle(year: int, make: str, model: str) -> Optional[Dict]:
    """Search Nuke database for matching vehicle."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Missing Supabase credentials")
        return None

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json'
    }

    # Build query - search for year + make containing model or vice versa
    # This is a simple approach; could be improved with fuzzy matching
    query = f"{SUPABASE_URL}/rest/v1/vehicles"
    params = {
        'select': 'id,year,make,model,title,primary_image_url',
        'year': f'eq.{year}',
        'limit': 10
    }

    try:
        resp = requests.get(query, headers=headers, params=params)
        if resp.status_code == 200:
            vehicles = resp.json()

            # Score matches
            best_match = None
            best_score = 0

            for v in vehicles:
                score = 0
                v_make = (v.get('make') or '').lower()
                v_model = (v.get('model') or '').lower()
                search_make = (make or '').lower()
                search_model = (model or '').lower()

                # Check make match
                if search_make in v_make or v_make in search_make:
                    score += 40

                # Check model match
                if search_model in v_model or v_model in search_model:
                    score += 40

                # Bonus for exact matches
                if v_make == search_make:
                    score += 10
                if v_model == search_model:
                    score += 10

                if score > best_score:
                    best_score = score
                    best_match = v
                    best_match['match_score'] = score

            return best_match
    except Exception as e:
        print(f"Error searching: {e}")

    return None

def get_albums_with_matches() -> List[AlbumMatch]:
    """Get all albums and find matching vehicles."""
    print("Loading Photos library...")
    photosdb = osxphotos.PhotosDB()

    albums = []
    album_info = photosdb.album_info

    print(f"Found {len(album_info)} albums")

    for album in album_info:
        name = album.title
        if not name or album.folder_names:  # Skip folders
            continue

        photo_count = len(album.photos)
        year, make, model = parse_album_name(name)

        match = AlbumMatch(
            album_name=name,
            photo_count=photo_count,
            year=year,
            make=make,
            model=model
        )

        # Try to find matching vehicle
        if year and (make or model):
            vehicle = search_vehicle(year, make or '', model or '')
            if vehicle:
                match.vehicle_id = vehicle.get('id')
                match.vehicle_title = vehicle.get('title') or f"{vehicle.get('year')} {vehicle.get('make')} {vehicle.get('model')}"
                match.confidence = vehicle.get('match_score', 0) / 100.0

        albums.append(match)

    return albums

def export_album_photos(album_name: str, limit: int = 5) -> List[Tuple[Path, Dict]]:
    """Export photos from an album to temp directory with metadata."""
    photosdb = osxphotos.PhotosDB()

    # Find the album
    for album in photosdb.album_info:
        if album.title == album_name:
            # Filter to local photos only (not in iCloud)
            local_photos = [p for p in album.photos if not p.iscloudasset or p.incloud]
            photos = local_photos[:limit]  # Limit for POC

            if len(local_photos) < len(album.photos):
                print(f"  Note: {len(album.photos) - len(local_photos)} photos are in iCloud only (not downloaded)")

            export_dir = Path(tempfile.mkdtemp(prefix='nuke_photo_sync_'))
            exported = []

            for photo in photos:
                try:
                    # Export original (use_photos_export handles iCloud photos)
                    paths = photo.export(str(export_dir), use_photos_export=True)
                    if paths:
                        # Collect metadata for verification
                        metadata = {
                            'original_filename': photo.original_filename,
                            'date_taken': photo.date.isoformat() if photo.date else None,
                            'date_added': photo.date_added.isoformat() if photo.date_added else None,
                            'uuid': photo.uuid,
                            'width': photo.width,
                            'height': photo.height,
                            'location': (photo.latitude, photo.longitude) if photo.latitude else None,
                            'camera_make': photo.exif_info.camera_make if photo.exif_info else None,
                            'camera_model': photo.exif_info.camera_model if photo.exif_info else None,
                        }
                        exported.append((Path(paths[0]), metadata))
                except Exception as e:
                    print(f"  Error exporting {photo.filename}: {e}")

            return exported

    return []

def convert_to_jpeg(file_path: Path) -> Path:
    """Convert HEIC/other formats to JPEG for upload."""
    ext = file_path.suffix.lower()
    if ext in ['.jpg', '.jpeg']:
        return file_path

    # Convert to JPEG
    jpeg_path = file_path.with_suffix('.jpg')
    try:
        img = Image.open(file_path)
        # Convert to RGB if needed (removes alpha channel)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        img.save(jpeg_path, 'JPEG', quality=90)
        print(f"    Converted {file_path.name} → {jpeg_path.name}")
        return jpeg_path
    except Exception as e:
        print(f"    Convert error: {e}")
        return file_path

def check_duplicate(file_hash: str, vehicle_id: str) -> bool:
    """Check if image already exists for this vehicle by hash."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    }

    # Check by file_hash or storage_path containing the hash
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/vehicle_images",
            headers=headers,
            params={
                'vehicle_id': f'eq.{vehicle_id}',
                'storage_path': f'like.%{file_hash}%',
                'select': 'id',
                'limit': 1
            }
        )
        if resp.status_code == 200:
            return len(resp.json()) > 0
    except:
        pass
    return False

def upload_to_supabase(file_path: Path, vehicle_id: str, metadata: Dict = None) -> Optional[str]:
    """Upload image to Supabase Storage and create vehicle_images record."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    # Convert HEIC to JPEG
    file_path = convert_to_jpeg(file_path)

    # Generate hash for duplicate detection
    file_hash = hashlib.md5(file_path.read_bytes()).hexdigest()[:12]

    # Check for duplicates
    if check_duplicate(file_hash, vehicle_id):
        print(f"    Skipping duplicate (hash: {file_hash})")
        return None

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    }

    # Generate unique filename using the pre-computed hash
    ext = file_path.suffix.lower()
    storage_name = f"{vehicle_id}/{file_hash}{ext}"

    # Upload to storage
    storage_url = f"{SUPABASE_URL}/storage/v1/object/vehicle-images/{storage_name}"

    mime_types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.heic': 'image/heic',
        '.webp': 'image/webp'
    }
    content_type = mime_types.get(ext, 'image/jpeg')

    try:
        with open(file_path, 'rb') as f:
            resp = requests.post(
                storage_url,
                headers={**headers, 'Content-Type': content_type},
                data=f.read()
            )

        if resp.status_code in (200, 201) or (resp.status_code == 409):
            # Get public URL (409 means already exists, which is fine)
            public_url = f"{SUPABASE_URL}/storage/v1/object/public/vehicle-images/{storage_name}"
            if resp.status_code == 409:
                print(f"    (already uploaded, skipping)")

            # Create vehicle_images record with full metadata
            # source='user_upload' is an allowed value per vehicle_images_attribution_check
            record = {
                'vehicle_id': vehicle_id,
                'image_url': public_url,
                'storage_path': f"vehicle-images/{storage_name}",
                'source': 'user_upload',
                'image_type': 'general',
                'category': 'general',
                'is_external': False,
                'uploaded_at': datetime.utcnow().isoformat(),
                'file_hash': file_hash,
                'filename': metadata.get('original_filename') if metadata else None,
                'taken_at': metadata.get('date_taken') if metadata else None,
            }

            # Add GPS coordinates if available (for auto-matching future photos)
            if metadata and metadata.get('location'):
                lat, lon = metadata['location']
                if lat and lon:
                    record['latitude'] = lat
                    record['longitude'] = lon

            # Add EXIF data for camera info
            if metadata:
                exif = {}
                if metadata.get('camera_make'):
                    exif['camera_make'] = metadata['camera_make']
                if metadata.get('camera_model'):
                    exif['camera_model'] = metadata['camera_model']
                if metadata.get('date_added'):
                    exif['date_added'] = metadata['date_added']
                if metadata.get('uuid'):
                    exif['photos_uuid'] = metadata['uuid']
                if metadata.get('width') and metadata.get('height'):
                    exif['dimensions'] = f"{metadata['width']}x{metadata['height']}"
                if exif:
                    record['exif_data'] = exif

            resp2 = requests.post(
                f"{SUPABASE_URL}/rest/v1/vehicle_images",
                headers={**headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation'},
                json=record
            )

            if resp2.status_code in (200, 201):
                return public_url
            else:
                print(f"  Failed to create record: {resp2.text}")
        else:
            print(f"  Failed to upload: {resp.text}")

    except Exception as e:
        print(f"  Upload error: {e}")

    return None

def main():
    print("=" * 60)
    print("NUKE PHOTO SYNC - Proof of Concept")
    print("=" * 60)
    print()

    # Get albums and matches
    print("Scanning Photos library for vehicle albums...")
    albums = get_albums_with_matches()

    # Filter to vehicle albums (those with year parsed)
    vehicle_albums = [a for a in albums if a.year]
    matched_albums = [a for a in vehicle_albums if a.vehicle_id]

    print(f"\nFound {len(vehicle_albums)} vehicle albums")
    print(f"Matched {len(matched_albums)} to Nuke vehicles")
    print()

    # Show matches
    print("MATCHED ALBUMS:")
    print("-" * 60)
    for m in sorted(matched_albums, key=lambda x: -x.confidence):
        status = "✓" if m.confidence >= 0.5 else "?"
        print(f"{status} {m.album_name} ({m.photo_count} photos)")
        print(f"  → {m.vehicle_title} (confidence: {m.confidence:.0%})")
        print()

    # Show unmatched
    unmatched = [a for a in vehicle_albums if not a.vehicle_id]
    if unmatched:
        print("\nUNMATCHED ALBUMS (no vehicle found in Nuke):")
        print("-" * 60)
        for m in unmatched[:10]:
            print(f"  {m.album_name} ({m.photo_count} photos)")
            print(f"    Parsed: {m.year} {m.make} {m.model}")

    # Demo upload for highest confidence album with local photos
    if matched_albums:
        print("\n" + "=" * 60)
        print("DEMO: Uploading from highest confidence match with local photos")
        print("=" * 60)

        # Pick from albums that have local photos
        # Check which matched albums have photos available locally
        photosdb = osxphotos.PhotosDB()
        albums_with_local = []
        for m in matched_albums:
            for album in photosdb.album_info:
                if album.title == m.album_name:
                    local_photos = [p for p in album.photos if not p.iscloudasset or p.incloud]
                    if local_photos:
                        m.local_count = len(local_photos)
                        albums_with_local.append(m)
                    break

        if not albums_with_local:
            print("No matched albums have local photos available.")
            return

        # Pick the highest confidence match with local photos
        demo = max(albums_with_local, key=lambda x: (x.confidence, x.local_count))
        print(f"\nAlbum: {demo.album_name}")
        print(f"Vehicle: {demo.vehicle_title}")
        print(f"Exporting first 3 photos...")

        exported = export_album_photos(demo.album_name, limit=3)
        print(f"Exported {len(exported)} photos")

        for path, metadata in exported:
            print(f"\n  Uploading {path.name}...")
            if metadata.get('date_taken'):
                print(f"    Date: {metadata['date_taken']}")
            if metadata.get('location'):
                print(f"    GPS: {metadata['location']}")

            url = upload_to_supabase(path, demo.vehicle_id, metadata)
            if url:
                print(f"  ✓ Uploaded: {url}")

            # Cleanup
            path.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
