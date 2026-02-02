#!/usr/bin/env python3
"""
Nuke Box Local Scanner
Scans local photos, classifies them using local LLM, organizes by vehicle.
"""

import os
import sys
import json
import hashlib
import base64
import argparse
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# Optional imports - will check availability
try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
    HAS_PIL = True
    # Register HEIC support if available
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass
except ImportError:
    HAS_PIL = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    import imagehash
    HAS_IMAGEHASH = True
except ImportError:
    HAS_IMAGEHASH = False

try:
    from rich.console import Console
    from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
    from rich.table import Table
    from rich.panel import Panel
    HAS_RICH = True
    console = Console()
except ImportError:
    HAS_RICH = False
    console = None

# ============================================================================
# Configuration
# ============================================================================

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llava:7b")  # Use llava:7b by default
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tiff', '.tif'}
MAX_IMAGE_SIZE = (1024, 1024)  # Resize for LLM analysis
BATCH_SIZE = 10

# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class ImageMetadata:
    path: str
    filename: str
    file_hash: str
    file_size: int
    created_at: Optional[str] = None
    taken_at: Optional[str] = None
    camera_make: Optional[str] = None
    camera_model: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    # Perceptual hashes for duplicate/similarity detection
    phash: Optional[str] = None      # Perceptual hash - best for photos
    dhash: Optional[str] = None      # Difference hash - good for crops
    device_fingerprint: Optional[str] = None  # Camera make+model hash

@dataclass
class ImageClassification:
    category: str  # vehicle, document, person, other
    is_vehicle_photo: bool
    is_document: bool
    document_type: Optional[str] = None  # title, registration, receipt, etc.
    vehicle_visible: bool = False
    vehicle_description: Optional[str] = None
    vehicle_color: Optional[str] = None
    vehicle_type: Optional[str] = None  # car, truck, motorcycle, etc.
    people_visible: bool = False
    location_type: Optional[str] = None  # garage, outdoor, showroom, etc.
    activity: Optional[str] = None  # restoration, driving, parked, etc.
    condition_notes: Optional[str] = None
    confidence: float = 0.0
    raw_response: Optional[str] = None

@dataclass
class ScannedImage:
    metadata: ImageMetadata
    classification: Optional[ImageClassification] = None
    vehicle_group: Optional[str] = None  # Assigned vehicle group ID
    upload_status: str = "pending"  # pending, queued, uploaded, failed

# ============================================================================
# EXIF Extraction
# ============================================================================

def extract_exif(image_path: str) -> ImageMetadata:
    """Extract EXIF metadata from image."""
    path = Path(image_path)
    stat = path.stat()

    # Basic metadata
    metadata = ImageMetadata(
        path=str(path.absolute()),
        filename=path.name,
        file_hash=hash_file(image_path),
        file_size=stat.st_size,
        created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
    )

    if not HAS_PIL:
        return metadata

    try:
        with Image.open(image_path) as img:
            metadata.width = img.width
            metadata.height = img.height

            # Extract EXIF
            exif_data = img._getexif()
            if exif_data:
                exif = {TAGS.get(k, k): v for k, v in exif_data.items()}

                # Camera info
                metadata.camera_make = exif.get('Make')
                metadata.camera_model = exif.get('Model')

                # Date taken
                date_taken = exif.get('DateTimeOriginal') or exif.get('DateTime')
                if date_taken:
                    try:
                        dt = datetime.strptime(date_taken, '%Y:%m:%d %H:%M:%S')
                        metadata.taken_at = dt.isoformat()
                    except:
                        pass

                # GPS
                gps_info = exif.get('GPSInfo')
                if gps_info:
                    gps = {GPSTAGS.get(k, k): v for k, v in gps_info.items()}
                    lat = gps.get('GPSLatitude')
                    lat_ref = gps.get('GPSLatitudeRef')
                    lon = gps.get('GPSLongitude')
                    lon_ref = gps.get('GPSLongitudeRef')

                    if lat and lon:
                        metadata.latitude = convert_gps_to_decimal(lat, lat_ref)
                        metadata.longitude = convert_gps_to_decimal(lon, lon_ref)

                # Device fingerprint from camera info
                if metadata.camera_make or metadata.camera_model:
                    device_str = f"{metadata.camera_make or ''}-{metadata.camera_model or ''}".strip('-')
                    metadata.device_fingerprint = hashlib.md5(device_str.encode()).hexdigest()[:16]

            # Perceptual hashes for duplicate detection
            if HAS_IMAGEHASH:
                try:
                    # pHash - best for general photo similarity
                    metadata.phash = str(imagehash.phash(img))
                    # dHash - good for detecting crops/edits
                    metadata.dhash = str(imagehash.dhash(img))
                except Exception as hash_err:
                    log(f"pHash failed for {path.name}: {hash_err}", "warning")

    except Exception as e:
        log(f"EXIF extraction failed for {path.name}: {e}", "warning")

    return metadata

def convert_gps_to_decimal(coords, ref):
    """Convert GPS coordinates to decimal degrees."""
    try:
        degrees = float(coords[0])
        minutes = float(coords[1])
        seconds = float(coords[2])
        decimal = degrees + minutes/60 + seconds/3600
        if ref in ['S', 'W']:
            decimal = -decimal
        return round(decimal, 6)
    except:
        return None

def hash_file(path: str, chunk_size: int = 8192) -> str:
    """Generate SHA256 hash of file."""
    sha256 = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(chunk_size), b''):
            sha256.update(chunk)
    return sha256.hexdigest()[:16]  # First 16 chars for brevity

# ============================================================================
# Local LLM Classification (Ollama + LLaVA)
# ============================================================================

def classify_image_ollama(image_path: str) -> Optional[ImageClassification]:
    """Classify image using local Ollama LLaVA model."""
    if not HAS_REQUESTS:
        return None

    if not HAS_PIL:
        return None

    try:
        # Resize and encode image
        with Image.open(image_path) as img:
            # Convert to RGB if needed
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            # Resize for efficiency
            img.thumbnail(MAX_IMAGE_SIZE, Image.Resampling.LANCZOS)

            # Save to bytes
            import io
            buffer = io.BytesIO()
            img.save(buffer, format='JPEG', quality=85)
            image_bytes = buffer.getvalue()

        image_base64 = base64.b64encode(image_bytes).decode('utf-8')

        # Classification prompt
        prompt = """Analyze this image and classify it. Return a JSON object with:

{
  "category": "vehicle" | "document" | "person" | "other",
  "is_vehicle_photo": true/false (is this a photo OF a vehicle or vehicle parts?),
  "is_document": true/false (is this a document like title, receipt, registration?),
  "document_type": null | "title" | "registration" | "receipt" | "invoice" | "insurance" | "window_sticker" | "other",
  "vehicle_visible": true/false,
  "vehicle_description": "brief description if vehicle visible" | null,
  "vehicle_color": "color" | null,
  "vehicle_type": "car" | "truck" | "motorcycle" | "boat" | "other" | null,
  "people_visible": true/false,
  "location_type": "garage" | "outdoor" | "showroom" | "driveway" | "road" | "shop" | null,
  "activity": "restoration" | "maintenance" | "driving" | "parked" | "display" | null,
  "condition_notes": "any observations about vehicle condition" | null,
  "confidence": 0.0-1.0
}

IMPORTANT:
- If you see a vehicle TITLE (Certificate of Title), set document_type to "title"
- If you see text that looks like legal/DMV documents, it's probably a document
- Return ONLY valid JSON, no other text."""

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "images": [image_base64],
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 500
                }
            },
            timeout=60
        )

        if response.status_code != 200:
            log(f"Ollama error: {response.status_code}", "warning")
            return None

        result = response.json()
        response_text = result.get('response', '')

        # Parse JSON from response
        try:
            # Try to extract JSON from response
            import re
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                data = json.loads(json_match.group())
                return ImageClassification(
                    category=data.get('category', 'other'),
                    is_vehicle_photo=data.get('is_vehicle_photo', False),
                    is_document=data.get('is_document', False),
                    document_type=data.get('document_type'),
                    vehicle_visible=data.get('vehicle_visible', False),
                    vehicle_description=data.get('vehicle_description'),
                    vehicle_color=data.get('vehicle_color'),
                    vehicle_type=data.get('vehicle_type'),
                    people_visible=data.get('people_visible', False),
                    location_type=data.get('location_type'),
                    activity=data.get('activity'),
                    condition_notes=data.get('condition_notes'),
                    confidence=data.get('confidence', 0.5),
                    raw_response=response_text
                )
        except json.JSONDecodeError:
            log(f"Failed to parse LLM response as JSON", "warning")
            return ImageClassification(
                category='other',
                is_vehicle_photo=False,
                is_document=False,
                confidence=0.0,
                raw_response=response_text
            )

    except requests.exceptions.ConnectionError:
        log(f"Cannot connect to Ollama at {OLLAMA_URL}", "error")
        return None
    except Exception as e:
        log(f"Classification error: {e}", "warning")
        return None

def check_ollama_available() -> bool:
    """Check if Ollama is running and model is available."""
    if not HAS_REQUESTS:
        return False
    try:
        response = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        if response.status_code == 200:
            models = response.json().get('models', [])
            model_names = [m.get('name', '') for m in models]
            # Check if our model or a variant is available
            for name in model_names:
                if 'llava' in name.lower():
                    return True
            log(f"LLaVA model not found. Available: {model_names}", "warning")
            return False
        return False
    except:
        return False

# ============================================================================
# Vehicle Grouping
# ============================================================================

class VehicleGrouper:
    """Groups images by detected vehicle."""

    def __init__(self):
        self.groups: Dict[str, List[ScannedImage]] = {}
        self.ungrouped: List[ScannedImage] = []
        self.documents: List[ScannedImage] = []
        self.other: List[ScannedImage] = []

    def add_image(self, image: ScannedImage):
        """Add image to appropriate group."""
        if image.classification is None:
            self.ungrouped.append(image)
            return

        cls = image.classification

        # Documents go to special bucket
        if cls.is_document:
            self.documents.append(image)
            image.vehicle_group = "_documents"
            return

        # Non-vehicle photos
        if not cls.is_vehicle_photo and not cls.vehicle_visible:
            self.other.append(image)
            image.vehicle_group = "_other"
            return

        # Try to group by vehicle description
        group_key = self._generate_group_key(cls)
        if group_key:
            if group_key not in self.groups:
                self.groups[group_key] = []
            self.groups[group_key].append(image)
            image.vehicle_group = group_key
        else:
            self.ungrouped.append(image)

    def _generate_group_key(self, cls: ImageClassification) -> Optional[str]:
        """Generate a group key based on vehicle characteristics."""
        parts = []

        if cls.vehicle_type:
            parts.append(cls.vehicle_type.lower())
        if cls.vehicle_color:
            parts.append(cls.vehicle_color.lower())
        if cls.vehicle_description:
            # Extract key words from description
            desc_lower = cls.vehicle_description.lower()
            # Look for year
            import re
            year_match = re.search(r'\b(19|20)\d{2}\b', desc_lower)
            if year_match:
                parts.append(year_match.group())
            # Look for make/model keywords
            for keyword in ['ford', 'chevy', 'chevrolet', 'gmc', 'dodge', 'toyota',
                           'honda', 'bmw', 'mercedes', 'porsche', 'mustang', 'corvette',
                           'camaro', 'f-100', 'f100', 'c10', 'k10', 'blazer', 'bronco']:
                if keyword in desc_lower:
                    parts.append(keyword)
                    break

        if len(parts) >= 2:
            return "_".join(parts[:4])  # Max 4 parts
        return None

    def get_summary(self) -> Dict[str, Any]:
        """Get grouping summary."""
        return {
            "vehicle_groups": len(self.groups),
            "grouped_images": sum(len(g) for g in self.groups.values()),
            "documents": len(self.documents),
            "ungrouped": len(self.ungrouped),
            "other": len(self.other),
            "groups": {k: len(v) for k, v in self.groups.items()}
        }

# ============================================================================
# Scanner
# ============================================================================

class NukeBoxScanner:
    """Main scanner class."""

    def __init__(self, source_dir: str, output_dir: Optional[str] = None):
        self.source_dir = Path(source_dir)
        self.output_dir = Path(output_dir) if output_dir else self.source_dir / ".nuke-box"
        self.images: List[ScannedImage] = []
        self.grouper = VehicleGrouper()
        self.use_ollama = False
        self.stats = {
            "total_files": 0,
            "images_found": 0,
            "exif_extracted": 0,
            "classified": 0,
            "errors": 0
        }

    def scan(self, use_llm: bool = True, max_images: Optional[int] = None):
        """Scan directory for images."""
        log(f"Scanning: {self.source_dir}", "info")

        # Check Ollama availability
        if use_llm:
            self.use_ollama = check_ollama_available()
            if self.use_ollama:
                log(f"Ollama available at {OLLAMA_URL}", "success")
            else:
                log("Ollama not available - skipping LLM classification", "warning")

        # Find all images
        image_paths = []
        for ext in IMAGE_EXTENSIONS:
            image_paths.extend(self.source_dir.rglob(f"*{ext}"))
            image_paths.extend(self.source_dir.rglob(f"*{ext.upper()}"))

        image_paths = list(set(image_paths))  # Dedupe
        self.stats["images_found"] = len(image_paths)

        if max_images:
            image_paths = image_paths[:max_images]

        log(f"Found {len(image_paths)} images", "info")

        if not image_paths:
            return

        # Process images
        if HAS_RICH:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TaskProgressColumn(),
                console=console
            ) as progress:
                task = progress.add_task("Processing images...", total=len(image_paths))

                for path in image_paths:
                    self._process_image(str(path))
                    progress.update(task, advance=1)
        else:
            for i, path in enumerate(image_paths):
                if i % 10 == 0:
                    print(f"Processing {i+1}/{len(image_paths)}...")
                self._process_image(str(path))

        # Group images
        log("Grouping images by vehicle...", "info")
        for img in self.images:
            self.grouper.add_image(img)

        self._print_summary()

    def _process_image(self, path: str):
        """Process a single image."""
        try:
            # Extract EXIF
            metadata = extract_exif(path)
            self.stats["exif_extracted"] += 1

            # Classify with LLM
            classification = None
            if self.use_ollama:
                classification = classify_image_ollama(path)
                if classification:
                    self.stats["classified"] += 1

            # Create scanned image record
            scanned = ScannedImage(
                metadata=metadata,
                classification=classification
            )
            self.images.append(scanned)

        except Exception as e:
            self.stats["errors"] += 1
            log(f"Error processing {path}: {e}", "error")

    def _print_summary(self):
        """Print scan summary."""
        log("\n" + "="*60, "info")
        log("SCAN COMPLETE", "success")
        log("="*60, "info")

        # Stats
        log(f"Images found: {self.stats['images_found']}", "info")
        log(f"EXIF extracted: {self.stats['exif_extracted']}", "info")
        log(f"Classified: {self.stats['classified']}", "info")
        log(f"Errors: {self.stats['errors']}", "warning" if self.stats['errors'] > 0 else "info")

        # Grouping summary
        summary = self.grouper.get_summary()
        log(f"\nVehicle groups detected: {summary['vehicle_groups']}", "success")
        log(f"Images in groups: {summary['grouped_images']}", "info")
        log(f"Documents found: {summary['documents']}", "info")
        log(f"Ungrouped: {summary['ungrouped']}", "info")
        log(f"Other (non-vehicle): {summary['other']}", "info")

        if summary['groups']:
            log("\nDetected vehicle groups:", "info")
            for group_name, count in summary['groups'].items():
                log(f"  - {group_name}: {count} images", "info")

        # Documents breakdown
        if self.grouper.documents:
            doc_types = {}
            for doc in self.grouper.documents:
                if doc.classification and doc.classification.document_type:
                    dt = doc.classification.document_type
                    doc_types[dt] = doc_types.get(dt, 0) + 1
            if doc_types:
                log("\nDocument types found:", "info")
                for dt, count in doc_types.items():
                    log(f"  - {dt}: {count}", "info")

    def save_manifest(self) -> str:
        """Save scan results to manifest file."""
        self.output_dir.mkdir(parents=True, exist_ok=True)

        manifest = {
            "scan_time": datetime.now().isoformat(),
            "source_dir": str(self.source_dir),
            "stats": self.stats,
            "grouping_summary": self.grouper.get_summary(),
            "images": [
                {
                    "metadata": asdict(img.metadata),
                    "classification": asdict(img.classification) if img.classification else None,
                    "vehicle_group": img.vehicle_group,
                    "upload_status": img.upload_status
                }
                for img in self.images
            ]
        }

        manifest_path = self.output_dir / "manifest.json"
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)

        log(f"\nManifest saved to: {manifest_path}", "success")
        return str(manifest_path)

    def get_upload_queue(self) -> List[Dict[str, Any]]:
        """Get images ready for upload, prioritized."""
        queue = []

        # Priority 1: Documents (especially titles)
        for img in self.grouper.documents:
            priority = 1
            if img.classification and img.classification.document_type == 'title':
                priority = 0  # Highest priority
            queue.append({
                "path": img.metadata.path,
                "priority": priority,
                "type": "document",
                "document_type": img.classification.document_type if img.classification else None,
                "metadata": asdict(img.metadata)
            })

        # Priority 2: Grouped vehicle images
        for group_name, images in self.grouper.groups.items():
            for img in images:
                queue.append({
                    "path": img.metadata.path,
                    "priority": 2,
                    "type": "vehicle",
                    "vehicle_group": group_name,
                    "metadata": asdict(img.metadata)
                })

        # Priority 3: Ungrouped
        for img in self.grouper.ungrouped:
            queue.append({
                "path": img.metadata.path,
                "priority": 3,
                "type": "ungrouped",
                "metadata": asdict(img.metadata)
            })

        # Sort by priority
        queue.sort(key=lambda x: x["priority"])
        return queue

# ============================================================================
# Utility Functions
# ============================================================================

def log(message: str, level: str = "info"):
    """Log message with optional rich formatting."""
    if HAS_RICH and console:
        colors = {
            "info": "white",
            "success": "green",
            "warning": "yellow",
            "error": "red"
        }
        color = colors.get(level, "white")
        console.print(f"[{color}]{message}[/{color}]")
    else:
        prefix = {"info": "", "success": "[OK]", "warning": "[WARN]", "error": "[ERR]"}
        print(f"{prefix.get(level, '')} {message}")

def check_dependencies():
    """Check required dependencies."""
    missing = []
    if not HAS_PIL:
        missing.append("pillow")
    if not HAS_REQUESTS:
        missing.append("requests")

    if missing:
        log(f"Missing dependencies: {', '.join(missing)}", "warning")
        log(f"Install with: pip install {' '.join(missing)}", "info")
        return False
    return True

# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Nuke Box Local Scanner - Scan and classify vehicle photos"
    )
    parser.add_argument(
        "source",
        nargs="?",
        default=".",
        help="Directory to scan (default: current directory)"
    )
    parser.add_argument(
        "-o", "--output",
        help="Output directory for manifest (default: .nuke-box in source)"
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Skip LLM classification (EXIF only)"
    )
    parser.add_argument(
        "--max",
        type=int,
        help="Maximum number of images to process"
    )
    parser.add_argument(
        "--ollama-url",
        default=OLLAMA_URL,
        help=f"Ollama API URL (default: {OLLAMA_URL})"
    )
    parser.add_argument(
        "--model",
        default=OLLAMA_MODEL,
        help=f"Ollama model to use (default: {OLLAMA_MODEL})"
    )

    args = parser.parse_args()

    # Check dependencies
    if not check_dependencies():
        sys.exit(1)

    # Run scanner
    scanner = NukeBoxScanner(args.source, args.output)
    scanner.scan(use_llm=not args.no_llm, max_images=args.max)

    # Save manifest
    manifest_path = scanner.save_manifest()

    # Show upload queue summary
    queue = scanner.get_upload_queue()
    if queue:
        log(f"\nUpload queue: {len(queue)} images ready", "info")
        titles = [q for q in queue if q.get('document_type') == 'title']
        if titles:
            log(f"  - TITLES FOUND: {len(titles)} (high priority!)", "success")

if __name__ == "__main__":
    main()
