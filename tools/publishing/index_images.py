#!/usr/bin/env python3
"""
Image Indexing Tool
Scans a directory of images, computes perceptual hashes and content hashes,
extracts EXIF/IPTC metadata, and writes structured records to ~/email_intelligence.db.

Usage: python3 ~/tools/index_images.py /path/to/images
"""

import sys
import os
import hashlib
import sqlite3
import mimetypes
import struct
import math
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Optional imports
# ---------------------------------------------------------------------------
try:
    from PIL import Image, ExifTags
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

try:
    import imagehash
    HAS_IMAGEHASH = True
except ImportError:
    HAS_IMAGEHASH = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    from iptcinfo3 import IPTCInfo
    HAS_IPTC = True
except ImportError:
    HAS_IPTC = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
IMAGE_EXTENSIONS = {
    '.jpg', '.jpeg', '.tif', '.tiff', '.png', '.psd',
    '.raw', '.nef', '.cr2', '.arw', '.dng', '.heic',
}

DB_PATH = os.path.expanduser('~/email_intelligence.db')

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS image_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  directory TEXT NOT NULL,
  file_size_bytes INTEGER,
  content_hash_sha256 TEXT NOT NULL,
  phash_hex TEXT,
  width_px INTEGER,
  height_px INTEGER,
  mime_type TEXT,
  camera_make TEXT,
  camera_model TEXT,
  focal_length_mm REAL,
  aperture TEXT,
  shutter_speed TEXT,
  iso INTEGER,
  taken_at TEXT,
  gps_latitude REAL,
  gps_longitude REAL,
  photographer_name TEXT,
  copyright_notice TEXT,
  credit_line TEXT,
  caption TEXT,
  keywords TEXT,
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(content_hash_sha256)
);
"""

INSERT_SQL = """
INSERT OR IGNORE INTO image_index (
  file_path, filename, directory, file_size_bytes, content_hash_sha256,
  phash_hex, width_px, height_px, mime_type,
  camera_make, camera_model, focal_length_mm, aperture, shutter_speed, iso,
  taken_at, gps_latitude, gps_longitude,
  photographer_name, copyright_notice, credit_line, caption, keywords
) VALUES (
  :file_path, :filename, :directory, :file_size_bytes, :content_hash_sha256,
  :phash_hex, :width_px, :height_px, :mime_type,
  :camera_make, :camera_model, :focal_length_mm, :aperture, :shutter_speed, :iso,
  :taken_at, :gps_latitude, :gps_longitude,
  :photographer_name, :copyright_notice, :credit_line, :caption, :keywords
)
"""

# ---------------------------------------------------------------------------
# Perceptual hash (pHash) via DCT — fallback when imagehash is unavailable
# ---------------------------------------------------------------------------
def _dct2_naive(block):
    """Compute 2D DCT on an NxN numpy array using scipy if available, else numpy approximation."""
    try:
        from scipy.fftpack import dct
        return dct(dct(block.T, norm='ortho').T, norm='ortho')
    except ImportError:
        pass
    # Pure numpy fallback using DFT-based approximation
    N = block.shape[0]
    result = np.zeros_like(block, dtype=float)
    for k in range(N):
        for n in range(N):
            result[k] += block[n] * math.cos(math.pi * k * (2 * n + 1) / (2 * N))
    return result


def compute_phash_pil(img, hash_size=8, highfreq_factor=4):
    """Compute perceptual hash using PIL + numpy DCT."""
    if not HAS_NUMPY:
        return None
    img_size = hash_size * highfreq_factor
    img_gray = img.convert('L').resize((img_size, img_size), Image.LANCZOS)
    pixels = np.array(img_gray, dtype=float)
    dct_result = _dct2_naive(pixels)
    dctlowfreq = dct_result[:hash_size, :hash_size]
    med = np.median(dctlowfreq)
    diff = dctlowfreq > med
    # Convert boolean array to hex string
    hash_int = 0
    for bit in diff.flatten():
        hash_int = (hash_int << 1) | int(bit)
    return format(hash_int, '016x')


def compute_phash(img):
    """Compute perceptual hash, using imagehash if available."""
    if HAS_IMAGEHASH:
        h = imagehash.phash(img)
        return str(h)
    return compute_phash_pil(img)


# ---------------------------------------------------------------------------
# SHA-256 content hash
# ---------------------------------------------------------------------------
def compute_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# EXIF extraction
# ---------------------------------------------------------------------------
def _convert_to_degrees(value):
    """Convert GPS coordinates stored as IFDRational tuples to decimal degrees."""
    try:
        d = float(value[0])
        m = float(value[1])
        s = float(value[2])
        return d + (m / 60.0) + (s / 3600.0)
    except (TypeError, IndexError, ZeroDivisionError, ValueError):
        return None


def _rational_to_str(val):
    """Convert an IFDRational or tuple to a readable string."""
    if val is None:
        return None
    try:
        # PIL IFDRational
        num = val.numerator
        den = val.denominator
        if den == 0:
            return str(val)
        if den == 1:
            return str(num)
        return f"{num}/{den}"
    except AttributeError:
        return str(val)


def _rational_to_float(val):
    """Convert an IFDRational to float."""
    if val is None:
        return None
    try:
        return float(val.numerator) / float(val.denominator) if val.denominator else None
    except (AttributeError, ZeroDivisionError):
        try:
            return float(val)
        except (TypeError, ValueError):
            return None


def extract_exif(img):
    """Extract EXIF metadata from a PIL Image. Returns a dict."""
    result = {
        'camera_make': None, 'camera_model': None,
        'focal_length_mm': None, 'aperture': None,
        'shutter_speed': None, 'iso': None,
        'taken_at': None, 'gps_latitude': None, 'gps_longitude': None,
        'width_px': None, 'height_px': None,
    }
    try:
        result['width_px'] = img.width
        result['height_px'] = img.height
    except Exception:
        pass

    try:
        exif_data = img._getexif()
    except Exception:
        return result

    if not exif_data:
        return result

    # Build tag name lookup
    tag_names = {v: k for k, v in ExifTags.TAGS.items()}

    def get_tag(name):
        tag_id = tag_names.get(name)
        if tag_id is not None:
            return exif_data.get(tag_id)
        return None

    result['camera_make'] = _clean_str(get_tag('Make'))
    result['camera_model'] = _clean_str(get_tag('Model'))
    result['focal_length_mm'] = _rational_to_float(get_tag('FocalLength'))
    result['aperture'] = _rational_to_str(get_tag('FNumber'))
    result['shutter_speed'] = _rational_to_str(get_tag('ExposureTime'))

    iso = get_tag('ISOSpeedRatings')
    if isinstance(iso, (list, tuple)):
        iso = iso[0] if iso else None
    result['iso'] = int(iso) if iso else None

    # Date taken
    for tag_name in ('DateTimeOriginal', 'DateTimeDigitized', 'DateTime'):
        dt = get_tag(tag_name)
        if dt:
            result['taken_at'] = str(dt).strip()
            break

    # GPS
    gps_info = get_tag('GPSInfo')
    if gps_info and isinstance(gps_info, dict):
        gps_tag_names = {v: k for k, v in ExifTags.GPSTAGS.items()}
        lat_key = gps_tag_names.get('GPSLatitude')
        lat_ref_key = gps_tag_names.get('GPSLatitudeRef')
        lon_key = gps_tag_names.get('GPSLongitude')
        lon_ref_key = gps_tag_names.get('GPSLongitudeRef')

        lat = gps_info.get(lat_key)
        lat_ref = gps_info.get(lat_ref_key)
        lon = gps_info.get(lon_key)
        lon_ref = gps_info.get(lon_ref_key)

        if lat:
            lat_deg = _convert_to_degrees(lat)
            if lat_deg is not None and lat_ref and lat_ref.upper() == 'S':
                lat_deg = -lat_deg
            result['gps_latitude'] = lat_deg

        if lon:
            lon_deg = _convert_to_degrees(lon)
            if lon_deg is not None and lon_ref and lon_ref.upper() == 'W':
                lon_deg = -lon_deg
            result['gps_longitude'] = lon_deg

    return result


def _clean_str(val):
    """Clean a string value from EXIF — strip null bytes and whitespace."""
    if val is None:
        return None
    s = str(val).strip().rstrip('\x00').strip()
    return s if s else None


# ---------------------------------------------------------------------------
# IPTC extraction
# ---------------------------------------------------------------------------
def extract_iptc(filepath):
    """Extract IPTC metadata. Returns a dict."""
    result = {
        'photographer_name': None, 'copyright_notice': None,
        'credit_line': None, 'caption': None, 'keywords': None,
    }

    if HAS_IPTC:
        try:
            info = IPTCInfo(filepath, force=True)
            result['photographer_name'] = _decode_iptc(info.get('by-line'))
            result['copyright_notice'] = _decode_iptc(info.get('copyright notice'))
            result['credit_line'] = _decode_iptc(info.get('credit'))
            result['caption'] = _decode_iptc(info.get('caption/abstract'))
            kw = info.get('keywords')
            if kw:
                decoded = [_decode_iptc(k) for k in kw if k]
                result['keywords'] = ', '.join([k for k in decoded if k])
        except Exception:
            pass
        return result

    # Fallback: try to read IPTC from PIL's IptcImagePlugin
    try:
        from PIL import IptcImagePlugin
        with open(filepath, 'rb') as f:
            iptc_data = IptcImagePlugin.getiptcinfo(Image.open(f))
        if iptc_data:
            result['photographer_name'] = _decode_iptc(iptc_data.get((2, 80)))
            result['copyright_notice'] = _decode_iptc(iptc_data.get((2, 116)))
            result['credit_line'] = _decode_iptc(iptc_data.get((2, 110)))
            result['caption'] = _decode_iptc(iptc_data.get((2, 120)))
            kw = iptc_data.get((2, 25))
            if kw:
                if isinstance(kw, list):
                    decoded = [_decode_iptc(k) for k in kw if k]
                    result['keywords'] = ', '.join([k for k in decoded if k])
                else:
                    result['keywords'] = _decode_iptc(kw)
    except Exception:
        pass

    return result


def _decode_iptc(val):
    """Decode an IPTC value to string."""
    if val is None:
        return None
    if isinstance(val, bytes):
        try:
            return val.decode('utf-8').strip()
        except UnicodeDecodeError:
            return val.decode('latin-1').strip()
    if isinstance(val, list):
        return _decode_iptc(val[0]) if val else None
    return str(val).strip() or None


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(CREATE_TABLE_SQL)
    conn.commit()
    return conn


def get_existing_hashes(conn):
    """Load all existing SHA-256 hashes for resumability."""
    cursor = conn.execute("SELECT content_hash_sha256 FROM image_index")
    return {row[0] for row in cursor.fetchall()}


# ---------------------------------------------------------------------------
# Main scan
# ---------------------------------------------------------------------------
def scan_directory(root_dir):
    if not HAS_PIL:
        print("ERROR: Pillow (PIL) is required. Install with: pip3 install Pillow")
        sys.exit(1)

    root_dir = os.path.abspath(os.path.expanduser(root_dir))
    if not os.path.isdir(root_dir):
        print(f"ERROR: {root_dir} is not a directory")
        sys.exit(1)

    print(f"Image Indexing Tool")
    print(f"===================")
    print(f"Scanning: {root_dir}")
    print(f"Database: {DB_PATH}")
    print(f"Libraries: PIL={HAS_PIL}, imagehash={HAS_IMAGEHASH}, iptcinfo3={HAS_IPTC}, numpy={HAS_NUMPY}")
    print()

    conn = init_db()
    existing_hashes = get_existing_hashes(conn)
    print(f"Existing records in database: {len(existing_hashes)}")

    total_files = 0
    indexed = 0
    skipped_existing = 0
    skipped_error = 0
    total_size = 0
    dates = []

    for dirpath, dirnames, filenames in os.walk(root_dir):
        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in IMAGE_EXTENSIONS:
                continue

            filepath = os.path.join(dirpath, filename)
            total_files += 1

            if total_files % 100 == 0:
                print(f"  Progress: {total_files} files found, {indexed} indexed, "
                      f"{skipped_existing} duplicates, {skipped_error} errors")

            try:
                file_size = os.path.getsize(filepath)
                content_hash = compute_sha256(filepath)

                # Resumability: skip if already indexed
                if content_hash in existing_hashes:
                    skipped_existing += 1
                    total_size += file_size
                    continue

                # Try to open with PIL
                phash_hex = None
                exif = {
                    'camera_make': None, 'camera_model': None,
                    'focal_length_mm': None, 'aperture': None,
                    'shutter_speed': None, 'iso': None,
                    'taken_at': None, 'gps_latitude': None, 'gps_longitude': None,
                    'width_px': None, 'height_px': None,
                }

                try:
                    img = Image.open(filepath)
                    exif = extract_exif(img)
                    try:
                        phash_hex = compute_phash(img)
                    except Exception:
                        pass
                except Exception:
                    # Can't open with PIL — still record basic file info
                    pass

                # IPTC
                iptc = extract_iptc(filepath)

                # MIME type
                mime_type, _ = mimetypes.guess_type(filepath)

                record = {
                    'file_path': filepath,
                    'filename': filename,
                    'directory': dirpath,
                    'file_size_bytes': file_size,
                    'content_hash_sha256': content_hash,
                    'phash_hex': phash_hex,
                    'width_px': exif.get('width_px'),
                    'height_px': exif.get('height_px'),
                    'mime_type': mime_type,
                    'camera_make': exif.get('camera_make'),
                    'camera_model': exif.get('camera_model'),
                    'focal_length_mm': exif.get('focal_length_mm'),
                    'aperture': exif.get('aperture'),
                    'shutter_speed': exif.get('shutter_speed'),
                    'iso': exif.get('iso'),
                    'taken_at': exif.get('taken_at'),
                    'gps_latitude': exif.get('gps_latitude'),
                    'gps_longitude': exif.get('gps_longitude'),
                    'photographer_name': iptc.get('photographer_name'),
                    'copyright_notice': iptc.get('copyright_notice'),
                    'credit_line': iptc.get('credit_line'),
                    'caption': iptc.get('caption'),
                    'keywords': iptc.get('keywords'),
                }

                conn.execute(INSERT_SQL, record)
                indexed += 1
                total_size += file_size
                existing_hashes.add(content_hash)

                if exif.get('taken_at'):
                    dates.append(exif['taken_at'])

                # Commit every 50 records
                if indexed % 50 == 0:
                    conn.commit()

            except Exception as e:
                skipped_error += 1
                print(f"  ERROR: {filepath}: {e}")

    conn.commit()
    conn.close()

    # Summary
    print()
    print(f"=== Indexing Complete ===")
    print(f"Total image files found: {total_files}")
    print(f"Newly indexed:           {indexed}")
    print(f"Duplicates (skipped):    {skipped_existing}")
    print(f"Errors (skipped):        {skipped_error}")
    print(f"Total size:              {_format_size(total_size)}")

    if dates:
        dates_sorted = sorted(dates)
        print(f"EXIF date range:         {dates_sorted[0]} to {dates_sorted[-1]}")
    else:
        print(f"EXIF date range:         (no dates found)")


def _format_size(size_bytes):
    """Format bytes to human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 ~/tools/index_images.py /path/to/images")
        sys.exit(1)

    scan_directory(sys.argv[1])
