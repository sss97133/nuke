"""Fetch CLIP input without repeatedly retrying a known failed render."""
import io
import os

import requests
from PIL import Image, UnidentifiedImageError


class RenderAndOriginalUnreadable(Exception):
    """A specific unsupported render and an unreadable original; retry later."""


def render_url(image_url: str) -> str:
    if "/storage/v1/object/public/" in image_url:
        u = image_url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")
        sep = "&" if "?" in u else "?"
        return f"{u}{sep}width=336&height=336&resize=contain"
    return image_url


def unsupported_render(response) -> bool:
    if response.status_code != 400:
        return False
    try:
        return response.json().get("message") == "The source image is invalid or unsupported for rendering"
    except (ValueError, AttributeError):
        return False


def load_image(image_url, storage_path):
    if image_url:
        rendered = requests.get(render_url(image_url), timeout=60)
        response = rendered
        if response.status_code != 200 or not response.content:
            response = requests.get(image_url, timeout=90)
            response.raise_for_status()
        try:
            return Image.open(io.BytesIO(response.content)).convert("RGB")
        except UnidentifiedImageError as error:
            # An HEIC original may simply need the render service; defer only a
            # confirmed unsupported render AND unreadable fallback. Never call
            # an original gone or defer a timeout, 5xx, or a successful render.
            if response is not rendered and unsupported_render(rendered):
                raise RenderAndOriginalUnreadable("render unsupported and original not locally decodable") from error
            raise
    if storage_path and os.path.exists(storage_path):
        return Image.open(storage_path).convert("RGB")
    raise FileNotFoundError("no usable source (url empty, local path missing)")
