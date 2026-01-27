"""
img.py - Universal image handler. One import, HEIC just works.

Usage:
    from img import img_to_base64, open_any

    # For Ollama/vision APIs - always returns JPEG base64
    b64 = img_to_base64("photo.heic")
    b64 = img_to_base64(path_object)
    b64 = img_to_base64(pil_image)
    b64 = img_to_base64(raw_bytes)

    # For PIL operations - opens anything
    img = open_any("photo.heic")
"""

import base64
import io
from pathlib import Path

# Auto-register HEIC support on import
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass  # No HEIC support, will fail gracefully on HEIC files

from PIL import Image


def open_any(source) -> Image.Image:
    """Open any image format. Returns PIL Image."""
    if isinstance(source, Image.Image):
        return source
    if isinstance(source, (bytes, bytearray)):
        return Image.open(io.BytesIO(source))
    if isinstance(source, (str, Path)):
        return Image.open(source)
    raise TypeError(f"Cannot open image from {type(source)}")


def img_to_base64(source, max_size: int = 1024, quality: int = 85) -> str:
    """
    Convert any image to base64 JPEG. Handles HEIC, PNG, WebP, whatever.

    Args:
        source: Path, PIL Image, or bytes
        max_size: Max dimension (default 1024, set to None to skip resize)
        quality: JPEG quality (default 85)

    Returns:
        Base64 encoded JPEG string ready for vision APIs
    """
    img = open_any(source)

    # Convert to RGB (handles RGBA, P, etc.)
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')

    # Resize if needed
    if max_size and max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    # Encode as JPEG
    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', quality=quality)

    return base64.b64encode(buffer.getvalue()).decode('utf-8')


def img_to_bytes(source, max_size: int = 1024, quality: int = 85) -> bytes:
    """Same as img_to_base64 but returns raw bytes."""
    img = open_any(source)

    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')

    if max_size and max(img.size) > max_size:
        ratio = max_size / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', quality=quality)
    return buffer.getvalue()
