import contextlib
import io
import json
import os
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from PIL import Image, UnidentifiedImageError

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import clip_embed_image_source as source

URL = "https://fixture.supabase.test/storage/v1/object/public/photos/example.HEIC"
UNSUPPORTED = "The source image is invalid or unsupported for rendering"


def response(status, content=b"", message=None):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps({"message": message}).encode() if message else content
    result.url = "https://fixture.invalid/"
    return result


def jpeg():
    out = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(out, format="JPEG")
    return out.getvalue()


class ImageSourceTest(unittest.TestCase):
    def test_defers_only_specific_failed_render_and_unreadable_original(self):
        with patch.object(source.requests, "get", side_effect=[response(400, message=UNSUPPORTED), response(200, b"HEIC bytes")]):
            with self.assertRaises(source.RenderAndOriginalUnreadable):
                source.load_image(URL, "")

    def test_readable_original_still_works_after_failed_render(self):
        with patch.object(source.requests, "get", side_effect=[response(400, message=UNSUPPORTED), response(200, jpeg())]):
            self.assertEqual(source.load_image(URL, "").size, (2, 2))

    def test_transient_or_other_render_errors_are_not_deferred(self):
        for failure in (response(500), response(400, message="another error")):
            with self.subTest(status=failure.status_code), patch.object(source.requests, "get", side_effect=[failure, response(200, b"HEIC bytes")]):
                with self.assertRaises(UnidentifiedImageError):
                    source.load_image(URL, "")
        with patch.object(source.requests, "get", side_effect=requests.Timeout()):
            with self.assertRaises(requests.Timeout):
                source.load_image(URL, "")

    def test_valid_render_uses_no_original_request(self):
        with patch.object(source.requests, "get", return_value=response(200, jpeg())) as get:
            self.assertEqual(source.load_image(URL, "").size, (2, 2))
            self.assertEqual(get.call_count, 1)

    def test_worker_defers_across_runs_without_calling_source_gone(self):
        row = {"obs_id": "synthetic-observation", "image_url": URL, "storage_path": ""}
        rpc = response(200, json.dumps([row]).encode())
        with tempfile.TemporaryDirectory() as temp:
            memo = os.path.join(temp, "memo.json")
            args = ["clip-embed-image-observations.py", "--all", "--batch", "1", "--dead-file", memo]
            with patch.dict(os.environ, {"SUPABASE_URL": "https://fixture.invalid", "SUPABASE_SERVICE_ROLE_KEY": "fixture"}), \
                 patch.object(sys, "argv", args), patch.object(requests, "post", return_value=rpc), \
                 patch.object(requests, "get", side_effect=[response(400, message=UNSUPPORTED), response(200, b"HEIC bytes")]) as get:
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    runpy.run_path(str(SCRIPTS / "clip-embed-image-observations.py"), run_name="__main__")
                    runpy.run_path(str(SCRIPTS / "clip-embed-image-observations.py"), run_name="__main__")
                self.assertEqual(get.call_count, 2)
                self.assertIn('"source_gone": 0', output.getvalue())
                self.assertIn('"render_unreadable_deferred": 1', output.getvalue())
                self.assertIn("synthetic-observation", json.loads(Path(memo).read_text()))


if __name__ == "__main__":
    unittest.main()
