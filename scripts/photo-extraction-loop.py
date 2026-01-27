#!/usr/bin/env python3
"""
PHOTO EXTRACTION LOOP - Robust 1-hour autonomous photo sync
Uses Ollama LLaVA for VIN detection and photo classification
Handles errors, batches uploads, resumes from checkpoints

Usage:
  python scripts/photo-extraction-loop.py --hours 1
  python scripts/photo-extraction-loop.py --hours 1 --no-ai  # Skip AI analysis
  python scripts/photo-extraction-loop.py --resume           # Resume from last checkpoint
  python scripts/photo-extraction-loop.py --dry-run          # Preview only
"""

import os
import re
import json
import base64
import hashlib
import tempfile
import time
import sys
import signal
import threading
from pathlib import Path
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, List, Tuple, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue
import traceback

# Third party
import osxphotos
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
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
USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4"

# Config
MAX_WORKERS = 4
BATCH_SIZE = 10
AI_TIMEOUT = 45
UPLOAD_TIMEOUT = 60
MAX_PHOTOS_PER_ALBUM = 100
CHECKPOINT_FILE = Path(__file__).parent / ".photo-extraction-checkpoint.json"
LOG_FILE = Path(__file__).parent.parent / ".ralph/logs/photo_extraction.log"

# Ensure log directory exists
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class PhotoResult:
    photo_id: str
    album: str
    filename: str
    status: str  # OK, DUPLICATE, SKIPPED, ERROR
    error: Optional[str] = None
    vehicle_id: Optional[str] = None
    ai_type: Optional[str] = None
    vin_detected: Optional[str] = None
    upload_url: Optional[str] = None

@dataclass
class SyncStats:
    started: str = ""
    albums_found: int = 0
    albums_processed: int = 0
    photos_found: int = 0
    photos_processed: int = 0
    uploaded: int = 0
    duplicates: int = 0
    skipped: int = 0
    errors: int = 0
    vins_detected: int = 0
    ai_analyzed: int = 0
    elapsed_seconds: float = 0
    errors_by_type: Dict[str, int] = field(default_factory=dict)

@dataclass
class Checkpoint:
    sync_id: str
    started: str
    last_album: str = ""
    last_photo_index: int = 0
    processed_albums: List[str] = field(default_factory=list)
    stats: SyncStats = field(default_factory=SyncStats)

# ============================================================================
# LOGGING
# ============================================================================

def log(msg: str, level: str = "INFO"):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] [{level}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + "\n")
    except:
        pass

# ============================================================================
# HTTP SESSION WITH RETRY
# ============================================================================

def create_session() -> requests.Session:
    """Create session with connection pooling and retry logic."""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "POST", "PUT", "DELETE"]
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Connection': 'keep-alive'
    })
    return session

SESSION = create_session()

# ============================================================================
# OLLAMA AI ANALYSIS
# ============================================================================

def analyze_photo_with_ai(image_path: Path) -> Optional[Dict]:
    """Use LLaVA to analyze a vehicle photo."""
    try:
        # Load and resize
        img = Image.open(image_path)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')

        max_size = 800
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        # Encode to base64
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
            img.save(f, 'JPEG', quality=80)
            temp_path = f.name

        with open(temp_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')

        os.unlink(temp_path)

        prompt = """Analyze this vehicle photo. Return ONLY valid JSON:
{
  "is_vehicle": true/false,
  "photo_type": "exterior" | "interior" | "engine" | "undercarriage" | "detail" | "document",
  "vin_visible": true/false,
  "vin": "17-char VIN or null",
  "brief": "2-5 word description"
}"""

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": "llava:7b",
                "prompt": prompt,
                "images": [image_data],
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 150}
            },
            timeout=AI_TIMEOUT
        )

        if response.status_code == 200:
            result = response.json()
            text = result.get('response', '')

            # Parse JSON from response
            json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())

    except requests.exceptions.Timeout:
        log(f"AI timeout for {image_path.name}", "WARN")
    except Exception as e:
        log(f"AI error: {e}", "WARN")

    return None

# ============================================================================
# VEHICLE MATCHING
# ============================================================================

VEHICLE_CACHE: Dict[str, Dict] = {}
HASH_CACHE: Set[str] = set()

def load_hash_cache(vehicle_ids: List[str]):
    """Pre-load existing file hashes to avoid duplicate API calls."""
    global HASH_CACHE
    if not vehicle_ids:
        return

    try:
        # Load in batches
        for i in range(0, len(vehicle_ids), 50):
            batch = vehicle_ids[i:i+50]
            ids_filter = ','.join(batch)
            resp = SESSION.get(
                f"{SUPABASE_URL}/rest/v1/vehicle_images",
                params={
                    'vehicle_id': f'in.({ids_filter})',
                    'select': 'file_hash'
                },
                timeout=30
            )
            if resp.status_code == 200:
                for row in resp.json():
                    if row.get('file_hash'):
                        HASH_CACHE.add(row['file_hash'])

        log(f"Loaded {len(HASH_CACHE)} existing file hashes")
    except Exception as e:
        log(f"Failed to load hash cache: {e}", "WARN")

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
        'Toyota', 'Nissan', 'Jeep', 'DMC', 'Rolls-Royce', 'Buick',
        'Cadillac', 'Oldsmobile', 'Lincoln', 'Mercury', 'AMC'
    ]

    make = None
    model = rest

    for m in makes:
        if m.lower() in rest.lower():
            make = m
            model = re.sub(rf'\b{m}\b', '', rest, flags=re.IGNORECASE).strip()
            break

    # Handle K5, K10, K20 prefix (e.g., "K5 Chevrolet Blazer")
    k_match = re.match(r'^(K\d+|C\d+|V\d+)\s+', rest, re.IGNORECASE)
    if k_match and not make:
        prefix = k_match.group(1)
        rest_after = rest[k_match.end():].strip()
        for m in makes:
            if m.lower() in rest_after.lower():
                make = m
                model = f"{prefix} {re.sub(rf'{m}', '', rest_after, flags=re.IGNORECASE).strip()}"
                break

    if make and model:
        model = ' '.join(model.split())

    return year, make, model

def search_vehicle(year: int, make: str, model: str) -> Optional[Dict]:
    """Search for vehicle in database."""
    cache_key = f"{year}:{make}:{model}"
    if cache_key in VEHICLE_CACHE:
        return VEHICLE_CACHE[cache_key]

    try:
        resp = SESSION.get(
            f"{SUPABASE_URL}/rest/v1/vehicles",
            params={
                'select': 'id,year,make,model,title,vin',
                'year': f'eq.{year}',
                'limit': 20
            },
            timeout=15
        )

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
                if search_model:
                    # Check model parts
                    model_parts = search_model.split()
                    for part in model_parts:
                        if len(part) > 2 and part.lower() in v_model:
                            score += 20
                if v_make == search_make:
                    score += 10

                if score > best_score:
                    best_score = score
                    best_match = v
                    best_match['match_score'] = score

            if best_score >= 40:
                VEHICLE_CACHE[cache_key] = best_match
                return best_match

    except Exception as e:
        log(f"Vehicle search error: {e}", "WARN")

    return None

# ============================================================================
# PHOTO PROCESSING
# ============================================================================

def get_photo_metadata(photo) -> Dict:
    """Extract metadata from osxphotos photo object."""
    return {
        'original_filename': photo.original_filename or photo.filename,
        'date_taken': photo.date.isoformat() if photo.date else None,
        'uuid': photo.uuid,
        'width': photo.width,
        'height': photo.height,
        'latitude': photo.latitude,
        'longitude': photo.longitude,
        'camera_make': photo.exif_info.camera_make if photo.exif_info else None,
        'camera_model': photo.exif_info.camera_model if photo.exif_info else None,
    }

def convert_to_jpeg(file_path: Path) -> Tuple[Path, bytes]:
    """Convert image to JPEG and return path + bytes."""
    img = Image.open(file_path)
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')

    # Resize if huge
    max_size = 2048
    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    jpeg_path = file_path.with_suffix('.jpg')
    img.save(jpeg_path, 'JPEG', quality=88)

    with open(jpeg_path, 'rb') as f:
        data = f.read()

    return jpeg_path, data

def process_photo(
    photo,
    album_name: str,
    vehicle_id: str,
    export_dir: Path,
    use_ai: bool = True
) -> PhotoResult:
    """Process a single photo: export, analyze, upload."""
    filename = photo.original_filename or photo.filename or photo.uuid
    result = PhotoResult(
        photo_id=photo.uuid,
        album=album_name,
        filename=filename,
        status="PENDING",
        vehicle_id=vehicle_id
    )

    try:
        # Export from Photos library
        paths = photo.export(str(export_dir), use_photos_export=True)
        if not paths:
            result.status = "SKIPPED"
            result.error = "Export failed"
            return result

        file_path = Path(paths[0])

        # Skip videos
        if file_path.suffix.lower() in ['.mov', '.mp4', '.m4v', '.avi', '.webm']:
            result.status = "SKIPPED"
            result.error = "Video file"
            file_path.unlink(missing_ok=True)
            return result

        # Convert to JPEG
        jpeg_path, file_data = convert_to_jpeg(file_path)

        # Compute hash
        file_hash = hashlib.md5(file_data).hexdigest()[:12]

        # Check duplicate (local cache first)
        if file_hash in HASH_CACHE:
            result.status = "DUPLICATE"
            jpeg_path.unlink(missing_ok=True)
            if jpeg_path != file_path:
                file_path.unlink(missing_ok=True)
            return result

        # AI analysis (optional)
        ai_result = None
        if use_ai:
            ai_result = analyze_photo_with_ai(jpeg_path)
            if ai_result:
                result.ai_type = ai_result.get('photo_type')
                if ai_result.get('vin') and len(ai_result.get('vin', '')) == 17:
                    result.vin_detected = ai_result['vin']

        # Upload to storage
        storage_name = f"{vehicle_id}/{file_hash}.jpg"
        storage_url = f"{SUPABASE_URL}/storage/v1/object/vehicle-images/{storage_name}"

        resp = SESSION.post(
            storage_url,
            headers={'Content-Type': 'image/jpeg'},
            data=file_data,
            timeout=UPLOAD_TIMEOUT
        )

        if resp.status_code not in (200, 201, 409):
            result.status = "ERROR"
            result.error = f"Storage: {resp.status_code}"
            return result

        public_url = f"{SUPABASE_URL}/storage/v1/object/public/vehicle-images/{storage_name}"

        # Get metadata
        metadata = get_photo_metadata(photo)

        # Build DB record
        record = {
            'vehicle_id': vehicle_id,
            'user_id': USER_ID,
            'image_url': public_url,
            'storage_path': f"vehicle-images/{storage_name}",
            'source': 'apple_photos',
            'source_url': f"apple_album:{album_name}",
            'image_type': result.ai_type or 'general',
            'is_external': False,
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
        if ai_result:
            exif['ai_analysis'] = ai_result
        if exif:
            record['exif_data'] = json.dumps(exif)

        # Insert record
        resp2 = SESSION.post(
            f"{SUPABASE_URL}/rest/v1/vehicle_images",
            headers={'Content-Type': 'application/json', 'Prefer': 'return=minimal'},
            json=record,
            timeout=30
        )

        if resp2.status_code in (200, 201):
            result.status = "OK"
            result.upload_url = public_url
            HASH_CACHE.add(file_hash)
        elif resp2.status_code == 409:
            result.status = "DUPLICATE"
            HASH_CACHE.add(file_hash)
        else:
            result.status = "ERROR"
            result.error = f"DB: {resp2.status_code} - {resp2.text[:100]}"

        # Cleanup
        jpeg_path.unlink(missing_ok=True)
        if jpeg_path != file_path:
            file_path.unlink(missing_ok=True)

    except Exception as e:
        result.status = "ERROR"
        result.error = str(e)[:100]

    return result

# ============================================================================
# ALBUM PROCESSING
# ============================================================================

def process_album(
    album,
    vehicle: Dict,
    stats: SyncStats,
    use_ai: bool = True,
    max_photos: int = MAX_PHOTOS_PER_ALBUM,
    start_index: int = 0
) -> List[PhotoResult]:
    """Process all photos in an album."""
    results = []
    album_name = album.title
    vehicle_id = vehicle['id']
    vehicle_title = vehicle.get('title') or f"{vehicle.get('year')} {vehicle.get('make')} {vehicle.get('model')}"

    photos = album.photos[start_index:start_index + max_photos]
    total = len(photos)

    log(f"Processing album: {album_name} ({total} photos) -> {vehicle_title}")

    export_dir = Path(tempfile.mkdtemp(prefix='nuke_photos_'))

    # Process with thread pool
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {}
        for i, photo in enumerate(photos):
            future = executor.submit(
                process_photo, photo, album_name, vehicle_id, export_dir, use_ai
            )
            futures[future] = (i, photo)

        for future in as_completed(futures):
            i, photo = futures[future]
            try:
                result = future.result(timeout=120)
                results.append(result)

                # Update stats
                stats.photos_processed += 1
                if result.status == "OK":
                    stats.uploaded += 1
                    if result.vin_detected:
                        stats.vins_detected += 1
                    if result.ai_type:
                        stats.ai_analyzed += 1
                elif result.status == "DUPLICATE":
                    stats.duplicates += 1
                elif result.status == "SKIPPED":
                    stats.skipped += 1
                else:
                    stats.errors += 1
                    err_type = result.error.split(':')[0] if result.error else 'Unknown'
                    stats.errors_by_type[err_type] = stats.errors_by_type.get(err_type, 0) + 1

                # Progress log
                if (i + 1) % 10 == 0 or i == total - 1:
                    log(f"  [{i+1}/{total}] OK:{stats.uploaded} DUP:{stats.duplicates} ERR:{stats.errors}")

            except Exception as e:
                log(f"  Photo {i} failed: {e}", "ERROR")
                stats.errors += 1

    # Cleanup
    try:
        for f in export_dir.iterdir():
            f.unlink(missing_ok=True)
        export_dir.rmdir()
    except:
        pass

    return results

# ============================================================================
# CHECKPOINT MANAGEMENT
# ============================================================================

def save_checkpoint(checkpoint: Checkpoint):
    """Save checkpoint for resume."""
    try:
        with open(CHECKPOINT_FILE, 'w') as f:
            json.dump(asdict(checkpoint), f, indent=2, default=str)
    except Exception as e:
        log(f"Failed to save checkpoint: {e}", "WARN")

def load_checkpoint() -> Optional[Checkpoint]:
    """Load checkpoint if exists."""
    if not CHECKPOINT_FILE.exists():
        return None

    try:
        with open(CHECKPOINT_FILE, 'r') as f:
            data = json.load(f)

        stats = SyncStats(**data.get('stats', {}))
        return Checkpoint(
            sync_id=data['sync_id'],
            started=data['started'],
            last_album=data.get('last_album', ''),
            last_photo_index=data.get('last_photo_index', 0),
            processed_albums=data.get('processed_albums', []),
            stats=stats
        )
    except Exception as e:
        log(f"Failed to load checkpoint: {e}", "WARN")
        return None

def clear_checkpoint():
    """Clear checkpoint after successful completion."""
    try:
        CHECKPOINT_FILE.unlink(missing_ok=True)
    except:
        pass

# ============================================================================
# MAIN LOOP
# ============================================================================

RUNNING = True

def signal_handler(sig, frame):
    global RUNNING
    log("Received interrupt signal, finishing current photo...")
    RUNNING = False

def run_extraction_loop(
    hours: float = 1.0,
    use_ai: bool = True,
    dry_run: bool = False,
    resume: bool = False
):
    """Run the main extraction loop."""
    global RUNNING

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    end_time = datetime.now() + timedelta(hours=hours)

    # Load or create checkpoint
    checkpoint = None
    if resume:
        checkpoint = load_checkpoint()
        if checkpoint:
            log(f"Resuming from checkpoint: {checkpoint.sync_id}")
            stats = checkpoint.stats
        else:
            log("No checkpoint found, starting fresh")

    if not checkpoint:
        checkpoint = Checkpoint(
            sync_id=datetime.now().strftime("%Y%m%d_%H%M%S"),
            started=datetime.now().isoformat(),
            stats=SyncStats(started=datetime.now().isoformat())
        )
        stats = checkpoint.stats

    log("="*60)
    log("PHOTO EXTRACTION LOOP")
    log(f"  Sync ID: {checkpoint.sync_id}")
    log(f"  Duration: {hours} hours (until {end_time.strftime('%H:%M:%S')})")
    log(f"  AI Analysis: {'ON' if use_ai else 'OFF'}")
    log(f"  Dry Run: {dry_run}")
    log("="*60)

    # Load Photos library
    log("Loading Photos library...")
    photosdb = osxphotos.PhotosDB()

    # Find vehicle albums
    albums_to_process = []

    for album in photosdb.album_info:
        name = album.title
        if not name or album.folder_names:
            continue

        # Skip already processed
        if name in checkpoint.processed_albums:
            continue

        year, make, model = parse_album_name(name)
        if not year:
            continue

        # Search for matching vehicle
        vehicle = search_vehicle(year, make or '', model or '')
        if vehicle and vehicle.get('match_score', 0) >= 40:
            photo_count = len(album.photos)
            albums_to_process.append({
                'album': album,
                'name': name,
                'photo_count': photo_count,
                'vehicle': vehicle,
                'score': vehicle.get('match_score', 0)
            })

    stats.albums_found = len(albums_to_process) + len(checkpoint.processed_albums)

    # Sort by score and photo count
    albums_to_process.sort(key=lambda x: (-x['score'], -x['photo_count']))

    log(f"Found {len(albums_to_process)} albums to process")
    for a in albums_to_process[:10]:
        log(f"  [{a['score']}%] {a['name']} ({a['photo_count']} photos) -> {a['vehicle'].get('title', 'Unknown')}")

    if dry_run:
        log("Dry run complete - no photos processed")
        return stats

    # Pre-load hash cache
    vehicle_ids = list(set(a['vehicle']['id'] for a in albums_to_process))
    load_hash_cache(vehicle_ids)

    # Count total photos
    stats.photos_found = sum(a['photo_count'] for a in albums_to_process)

    # Process albums
    for album_info in albums_to_process:
        if not RUNNING:
            log("Stopping due to interrupt signal")
            break

        if datetime.now() >= end_time:
            log("Time limit reached")
            break

        album = album_info['album']
        vehicle = album_info['vehicle']

        # Determine start index
        start_index = 0
        if checkpoint.last_album == album.title:
            start_index = checkpoint.last_photo_index

        # Update checkpoint
        checkpoint.last_album = album.title
        checkpoint.last_photo_index = 0

        # Process album
        results = process_album(
            album, vehicle, stats,
            use_ai=use_ai,
            max_photos=MAX_PHOTOS_PER_ALBUM,
            start_index=start_index
        )

        # Mark as processed
        checkpoint.processed_albums.append(album.title)
        stats.albums_processed += 1

        # Save checkpoint
        checkpoint.stats = stats
        save_checkpoint(checkpoint)

        # Log progress
        elapsed = (datetime.now() - datetime.fromisoformat(stats.started)).total_seconds()
        rate = stats.uploaded / max(elapsed / 60, 1)
        log(f"Album complete. Total: {stats.uploaded} uploaded, {stats.duplicates} dups, {stats.errors} errors ({rate:.1f}/min)")

    # Final stats
    stats.elapsed_seconds = (datetime.now() - datetime.fromisoformat(stats.started)).total_seconds()

    log("="*60)
    log("EXTRACTION COMPLETE")
    log(f"  Albums processed: {stats.albums_processed}/{stats.albums_found}")
    log(f"  Photos processed: {stats.photos_processed}/{stats.photos_found}")
    log(f"  Uploaded: {stats.uploaded}")
    log(f"  Duplicates: {stats.duplicates}")
    log(f"  Skipped: {stats.skipped}")
    log(f"  Errors: {stats.errors}")
    if stats.vins_detected:
        log(f"  VINs detected: {stats.vins_detected}")
    if stats.ai_analyzed:
        log(f"  AI analyzed: {stats.ai_analyzed}")
    log(f"  Duration: {stats.elapsed_seconds/60:.1f} minutes")
    log(f"  Rate: {stats.uploaded / max(stats.elapsed_seconds/60, 1):.1f} photos/min")
    if stats.errors_by_type:
        log(f"  Errors by type: {stats.errors_by_type}")
    log("="*60)

    # Clear checkpoint on success
    if stats.errors == 0 or not RUNNING:
        clear_checkpoint()

    return stats

# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Photo Extraction Loop')
    parser.add_argument('--hours', type=float, default=1.0, help='Duration in hours')
    parser.add_argument('--no-ai', action='store_true', help='Disable AI analysis')
    parser.add_argument('--dry-run', action='store_true', help='Preview only')
    parser.add_argument('--resume', action='store_true', help='Resume from checkpoint')

    args = parser.parse_args()

    # Check Ollama if using AI
    if not args.no_ai:
        try:
            resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            if resp.status_code != 200:
                log("Ollama not responding, disabling AI", "WARN")
                args.no_ai = True
        except:
            log("Ollama not available, disabling AI", "WARN")
            args.no_ai = True

    stats = run_extraction_loop(
        hours=args.hours,
        use_ai=not args.no_ai,
        dry_run=args.dry_run,
        resume=args.resume
    )

    sys.exit(0 if stats.errors == 0 else 1)
