#!/usr/bin/env python3
"""
NUKE PHOTO SYNC - Autonomous Vehicle Photo Organization & Upload

Capabilities:
1. Read photos from macOS Photos library
2. Match albums to vehicles in Nuke database
3. Analyze photos with local AI (LLaVA) for VIN reading and classification
4. Upload photos to Nuke with full metadata
5. Deduplicate using file hashes
"""

import os
import re
import json
import base64
import hashlib
import tempfile
import subprocess
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone
import time

import osxphotos
import requests
from PIL import Image
import pillow_heif

# Register HEIF opener
pillow_heif.register_heif_opener()

# Load environment
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
OLLAMA_URL = "http://localhost:11434"

# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class VehicleMatch:
    album_name: str
    photo_count: int
    year: Optional[int]
    make: Optional[str]
    model: Optional[str]
    vehicle_id: Optional[str] = None
    vehicle_title: Optional[str] = None
    confidence: float = 0.0
    photos_uploaded: int = 0
    photos_skipped: int = 0

@dataclass
class PhotoAnalysis:
    is_vehicle: bool = False
    vehicle_type: Optional[str] = None  # exterior, interior, engine, undercarriage, detail, document
    vin_detected: Optional[str] = None
    vin_confidence: float = 0.0
    description: Optional[str] = None
    raw_response: Optional[str] = None

# ============================================================================
# LOCAL AI (OLLAMA + LLAVA)
# ============================================================================

def analyze_photo_with_ai(image_path: Path) -> Optional[PhotoAnalysis]:
    """Use LLaVA to analyze a vehicle photo."""
    try:
        # Convert to JPEG if needed and resize for faster processing
        img = Image.open(image_path)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')

        # Resize to max 1024px for faster processing
        max_size = 1024
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        # Save to temp and encode
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
            img.save(f, 'JPEG', quality=85)
            temp_path = f.name

        with open(temp_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')

        os.unlink(temp_path)

        # Call Ollama
        prompt = """Analyze this vehicle photo. Respond in this exact JSON format:
{
  "is_vehicle": true/false,
  "photo_type": "exterior" | "interior" | "engine" | "undercarriage" | "detail" | "document" | "other",
  "vin_visible": true/false,
  "vin_text": "VIN if visible, or null",
  "description": "Brief description of what's shown"
}

If you can see a VIN plate or VIN sticker, try to read the 17-character VIN.
Only output valid JSON, nothing else."""

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
            result = response.json()
            text = result.get('response', '')

            # Parse JSON from response
            try:
                # Find JSON in response
                json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
                if json_match:
                    data = json.loads(json_match.group())
                    return PhotoAnalysis(
                        is_vehicle=data.get('is_vehicle', False),
                        vehicle_type=data.get('photo_type'),
                        vin_detected=data.get('vin_text') if data.get('vin_visible') else None,
                        vin_confidence=0.8 if data.get('vin_visible') else 0.0,
                        description=data.get('description'),
                        raw_response=text
                    )
            except json.JSONDecodeError:
                pass

            return PhotoAnalysis(raw_response=text)

    except Exception as e:
        print(f"    AI analysis error: {e}")

    return None

# ============================================================================
# PHOTO LIBRARY
# ============================================================================

def parse_album_name(name: str) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    """Parse album name to extract year/make/model."""
    year_match = re.match(r'^(\d{4})\s+', name)
    if not year_match:
        return None, None, None

    year = int(year_match.group(1))
    rest = name[year_match.end():].strip()

    makes = [
        'Chevrolet', 'Ford', 'Dodge', 'GMC', 'Pontiac', 'Plymouth',
        'Porsche', 'Ferrari', 'Mercedes', 'BMW', 'Jaguar', 'Lexus',
        'Toyota', 'Nissan', 'Jeep', 'DMC', 'Rolls-Royce'
    ]

    make = None
    model = rest

    for m in makes:
        if m.lower() in rest.lower():
            make = m
            model = re.sub(rf'\b{m}\b', '', rest, flags=re.IGNORECASE).strip()
            break

    if make and model:
        model = ' '.join(model.split())

    return year, make, model

def get_photo_metadata(photo) -> Dict:
    """Extract full metadata from a photo."""
    return {
        'original_filename': photo.original_filename,
        'date_taken': photo.date.isoformat() if photo.date else None,
        'date_added': photo.date_added.isoformat() if photo.date_added else None,
        'uuid': photo.uuid,
        'width': photo.width,
        'height': photo.height,
        'latitude': photo.latitude,
        'longitude': photo.longitude,
        'camera_make': photo.exif_info.camera_make if photo.exif_info else None,
        'camera_model': photo.exif_info.camera_model if photo.exif_info else None,
    }

def export_photo(photo, export_dir: Path) -> Optional[Tuple[Path, Dict]]:
    """Export a single photo with metadata."""
    try:
        paths = photo.export(str(export_dir), use_photos_export=True)
        if paths:
            return (Path(paths[0]), get_photo_metadata(photo))
    except Exception as e:
        print(f"    Export error: {e}")
    return None

# ============================================================================
# NUKE DATABASE
# ============================================================================

def search_vehicle(year: int, make: str, model: str) -> Optional[Dict]:
    """Search Nuke database for matching vehicle."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json'
    }

    params = {
        'select': 'id,year,make,model,title,vin,primary_image_url',
        'year': f'eq.{year}',
        'limit': 20
    }

    try:
        resp = requests.get(f"{SUPABASE_URL}/rest/v1/vehicles", headers=headers, params=params)
        if resp.status_code == 200:
            vehicles = resp.json()
            best_match = None
            best_score = 0

            for v in vehicles:
                score = 0
                v_make = (v.get('make') or '').lower()
                v_model = (v.get('model') or '').lower()
                search_make = (make or '').lower()
                search_model = (model or '').lower()

                if search_make and (search_make in v_make or v_make in search_make):
                    score += 40
                if search_model and (search_model in v_model or v_model in search_model):
                    score += 40
                if v_make == search_make:
                    score += 10
                if v_model == search_model:
                    score += 10

                if score > best_score:
                    best_score = score
                    best_match = v
                    best_match['match_score'] = score

            return best_match if best_score >= 40 else None
    except Exception as e:
        print(f"Search error: {e}")
    return None

def check_existing_image(file_hash: str, vehicle_id: str) -> bool:
    """Check if image already uploaded."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    }

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

def convert_to_jpeg(file_path: Path) -> Path:
    """Convert image to JPEG."""
    if file_path.suffix.lower() in ['.jpg', '.jpeg']:
        return file_path

    jpeg_path = file_path.with_suffix('.jpg')
    try:
        img = Image.open(file_path)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        img.save(jpeg_path, 'JPEG', quality=90)
        return jpeg_path
    except Exception as e:
        print(f"    Convert error: {e}")
        return file_path

def upload_photo(file_path: Path, vehicle_id: str, metadata: Dict, analysis: PhotoAnalysis = None) -> Optional[str]:
    """Upload photo to Supabase Storage and create record."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    # Convert to JPEG
    file_path = convert_to_jpeg(file_path)

    # Generate hash
    file_hash = hashlib.md5(file_path.read_bytes()).hexdigest()[:12]

    # Check duplicate
    if check_existing_image(file_hash, vehicle_id):
        return "DUPLICATE"

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    }

    # Upload to storage
    storage_name = f"{vehicle_id}/{file_hash}.jpg"
    storage_url = f"{SUPABASE_URL}/storage/v1/object/vehicle-images/{storage_name}"

    try:
        with open(file_path, 'rb') as f:
            resp = requests.post(
                storage_url,
                headers={**headers, 'Content-Type': 'image/jpeg'},
                data=f.read()
            )

        if resp.status_code not in (200, 201, 409):
            print(f"    Storage error: {resp.text}")
            return None

        public_url = f"{SUPABASE_URL}/storage/v1/object/public/vehicle-images/{storage_name}"

        # Build record
        record = {
            'vehicle_id': vehicle_id,
            'image_url': public_url,
            'storage_path': f"vehicle-images/{storage_name}",
            'source': 'user_upload',
            'image_type': analysis.vehicle_type if analysis else 'general',
            'category': analysis.vehicle_type if analysis else 'general',
            'is_external': False,
            'uploaded_at': datetime.now(timezone.utc).isoformat(),
            'file_hash': file_hash,
            'filename': metadata.get('original_filename'),
            'taken_at': metadata.get('date_taken'),
        }

        # Add GPS
        if metadata.get('latitude') and metadata.get('longitude'):
            record['latitude'] = metadata['latitude']
            record['longitude'] = metadata['longitude']

        # Add EXIF
        exif = {}
        if metadata.get('camera_make'):
            exif['camera_make'] = metadata['camera_make']
        if metadata.get('camera_model'):
            exif['camera_model'] = metadata['camera_model']
        if metadata.get('uuid'):
            exif['photos_uuid'] = metadata['uuid']
        if analysis and analysis.description:
            exif['ai_description'] = analysis.description
        if analysis and analysis.vin_detected:
            exif['ai_vin_detected'] = analysis.vin_detected
            record['vehicle_vin'] = analysis.vin_detected
        if exif:
            record['exif_data'] = exif

        # Create record
        resp2 = requests.post(
            f"{SUPABASE_URL}/rest/v1/vehicle_images",
            headers={**headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation'},
            json=record
        )

        if resp2.status_code in (200, 201):
            return public_url
        else:
            print(f"    Record error: {resp2.text[:200]}")

    except Exception as e:
        print(f"    Upload error: {e}")

    return None

# ============================================================================
# MAIN SYNC LOGIC
# ============================================================================

def sync_album(album_name: str, vehicle_id: str, vehicle_title: str,
               max_photos: int = 50, analyze_photos: bool = False) -> Tuple[int, int]:
    """Sync photos from an album to a vehicle profile."""
    print(f"\n{'='*60}")
    print(f"SYNCING: {album_name}")
    print(f"TO: {vehicle_title}")
    print(f"{'='*60}")

    photosdb = osxphotos.PhotosDB()

    for album in photosdb.album_info:
        if album.title == album_name:
            photos = album.photos[:max_photos]
            uploaded = 0
            skipped = 0

            export_dir = Path(tempfile.mkdtemp(prefix='nuke_sync_'))

            for i, photo in enumerate(photos):
                print(f"\n[{i+1}/{len(photos)}] {photo.original_filename or photo.filename}")

                # Export
                result = export_photo(photo, export_dir)
                if not result:
                    print("    Export failed")
                    skipped += 1
                    continue

                file_path, metadata = result

                # Optional AI analysis
                analysis = None
                if analyze_photos:
                    print("    Analyzing with AI...")
                    analysis = analyze_photo_with_ai(file_path)
                    if analysis:
                        print(f"    Type: {analysis.vehicle_type}")
                        if analysis.vin_detected:
                            print(f"    VIN: {analysis.vin_detected}")

                # Upload
                print("    Uploading...")
                url = upload_photo(file_path, vehicle_id, metadata, analysis)

                if url == "DUPLICATE":
                    print("    Skipped (duplicate)")
                    skipped += 1
                elif url:
                    print(f"    ✓ Done")
                    uploaded += 1
                else:
                    print("    ✗ Failed")
                    skipped += 1

                # Cleanup
                file_path.unlink(missing_ok=True)
                # Also cleanup converted jpg if different
                jpg_path = file_path.with_suffix('.jpg')
                if jpg_path.exists() and jpg_path != file_path:
                    jpg_path.unlink(missing_ok=True)

            # Cleanup export dir
            try:
                export_dir.rmdir()
            except:
                pass

            return uploaded, skipped

    return 0, 0

def get_all_matches() -> List[VehicleMatch]:
    """Get all photo albums matched to vehicles."""
    print("Loading Photos library...")
    photosdb = osxphotos.PhotosDB()

    matches = []

    for album in photosdb.album_info:
        name = album.title
        if not name or album.folder_names:
            continue

        photo_count = len(album.photos)
        year, make, model = parse_album_name(name)

        if not year:
            continue

        match = VehicleMatch(
            album_name=name,
            photo_count=photo_count,
            year=year,
            make=make,
            model=model
        )

        # Search for vehicle
        if make or model:
            vehicle = search_vehicle(year, make or '', model or '')
            if vehicle:
                match.vehicle_id = vehicle.get('id')
                match.vehicle_title = vehicle.get('title') or f"{vehicle.get('year')} {vehicle.get('make')} {vehicle.get('model')}"
                match.confidence = vehicle.get('match_score', 0) / 100.0

        matches.append(match)

    return matches

def run_autonomous_sync(max_photos_per_album: int = 20, analyze: bool = False):
    """Run autonomous sync for all matched albums."""
    print("="*70)
    print("NUKE PHOTO SYNC - AUTONOMOUS MODE")
    print("="*70)
    print(f"Started: {datetime.now()}")
    print()

    # Get matches
    matches = get_all_matches()

    vehicle_albums = [m for m in matches if m.year]
    matched_albums = [m for m in vehicle_albums if m.vehicle_id and m.confidence >= 0.8]

    print(f"Total albums: {len(matches)}")
    print(f"Vehicle albums: {len(vehicle_albums)}")
    print(f"Matched (≥80% confidence): {len(matched_albums)}")
    print()

    # Sort by confidence and photo count
    matched_albums.sort(key=lambda x: (-x.confidence, -x.photo_count))

    total_uploaded = 0
    total_skipped = 0

    for match in matched_albums:
        uploaded, skipped = sync_album(
            match.album_name,
            match.vehicle_id,
            match.vehicle_title,
            max_photos=max_photos_per_album,
            analyze_photos=analyze
        )

        match.photos_uploaded = uploaded
        match.photos_skipped = skipped
        total_uploaded += uploaded
        total_skipped += skipped

        print(f"\nAlbum complete: {uploaded} uploaded, {skipped} skipped")

    # Summary
    print("\n" + "="*70)
    print("SYNC COMPLETE")
    print("="*70)
    print(f"Albums processed: {len(matched_albums)}")
    print(f"Photos uploaded: {total_uploaded}")
    print(f"Photos skipped: {total_skipped}")
    print(f"Finished: {datetime.now()}")

# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == '--scan':
        # Just scan and show matches
        matches = get_all_matches()
        matched = [m for m in matches if m.vehicle_id]

        print(f"\nMatched albums ({len(matched)}):")
        for m in sorted(matched, key=lambda x: -x.confidence):
            print(f"  [{m.confidence:.0%}] {m.album_name} ({m.photo_count} photos)")
            print(f"      → {m.vehicle_title}")

        unmatched = [m for m in matches if m.year and not m.vehicle_id]
        print(f"\nUnmatched ({len(unmatched)}):")
        for m in unmatched[:15]:
            print(f"  {m.album_name}: {m.year} {m.make} {m.model}")

    elif len(sys.argv) > 1 and sys.argv[1] == '--sync':
        # Run full sync
        analyze = '--analyze' in sys.argv
        max_photos = 20

        for arg in sys.argv:
            if arg.startswith('--max='):
                max_photos = int(arg.split('=')[1])

        run_autonomous_sync(max_photos_per_album=max_photos, analyze=analyze)

    else:
        print("Usage:")
        print("  python nuke-photo-sync.py --scan              # Show album matches")
        print("  python nuke-photo-sync.py --sync              # Sync all matched albums")
        print("  python nuke-photo-sync.py --sync --analyze    # Sync with AI analysis")
        print("  python nuke-photo-sync.py --sync --max=50     # Sync up to 50 photos per album")
