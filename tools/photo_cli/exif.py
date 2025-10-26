from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

try:
    from PIL import Image, ExifTags
except Exception:  # Pillow not installed yet
    Image = None  # type: ignore
    ExifTags = None  # type: ignore


def extract_exif(path: Path) -> Tuple[Optional[str], Optional[float], Optional[float], Optional[int], Optional[int], Optional[str]]:
    """
    Returns: (datetime_str, lat, lon, width, height, orientation)
    """
    if Image is None:
        return None, None, None, None, None, None
    try:
        with Image.open(path) as img:
            width, height = img.size
            exif = img.getexif()
            dt_str: Optional[str] = None
            lat = lon = None
            orientation = None
            if exif:
                # Map EXIF tag names
                tag_map = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
                dt_str = tag_map.get("DateTimeOriginal") or tag_map.get("DateTime")
                # GPS info
                gps_info = tag_map.get("GPSInfo")
                if gps_info:
                    # GPSInfo is a dict mapping numeric keys to values
                    gps = {}
                    for k, v in gps_info.items():
                        name = ExifTags.GPSTAGS.get(k, k)
                        gps[name] = v
                    lat = _convert_gps_coord(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef"))
                    lon = _convert_gps_coord(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"))
                orientation = str(tag_map.get("Orientation")) if tag_map.get("Orientation") else None
            return dt_str, lat, lon, width, height, orientation
    except Exception:
        return None, None, None, None, None, None


def _convert_gps_coord(value, ref) -> Optional[float]:
    if not value or not ref:
        return None
    try:
        def to_float(x):
            if isinstance(x, tuple) and len(x) == 2 and x[1] != 0:
                return float(x[0]) / float(x[1])
            return float(x)
        d = to_float(value[0])
        m = to_float(value[1])
        s = to_float(value[2])
        sign = -1 if ref in ("S", "W") else 1
        return sign * (d + m / 60.0 + s / 3600.0)
    except Exception:
        return None
