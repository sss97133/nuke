#!/usr/bin/env python3
"""
Just analyze photos with Ollama - NO UPLOADS
Saves all analysis to JSON for manual review later
"""

import os
import json
import base64
import tempfile
from pathlib import Path
from datetime import datetime
from PIL import Image
import pillow_heif
import osxphotos
import requests

pillow_heif.register_heif_opener()

OLLAMA_URL = "http://localhost:11434"
OUTPUT_FILE = Path(__file__).parent / "photo_analysis_results.json"

def analyze_photo(image_path: Path) -> dict:
    """Run Ollama analysis on one photo."""
    try:
        img = Image.open(image_path)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')

        # Resize for Ollama
        max_size = 800
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
            img.save(f, 'JPEG', quality=80)
            temp_path = f.name

        with open(temp_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')

        os.unlink(temp_path)

        prompt = """Analyze this vehicle photo. Return ONLY valid JSON:
{
  "is_vehicle": true/false,
  "photo_type": "exterior" | "interior" | "engine" | "undercarriage" | "detail" | "document" | "vin_plate",
  "vin_visible": true/false,
  "vin": "17-char VIN or null",
  "year_visible": "YYYY or null",
  "make_visible": "Make or null",
  "model_visible": "Model or null",
  "brief": "2-5 word description"
}"""

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": "llava:7b",
                "prompt": prompt,
                "images": [image_data],
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 200}
            },
            timeout=45
        )

        if response.status_code == 200:
            result = response.json()
            text = result.get('response', '')

            # Parse JSON
            import re
            json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())

        return {"error": "analysis_failed"}

    except Exception as e:
        return {"error": str(e)}

def main():
    print("="*70)
    print("PHOTO ANALYSIS ONLY - NO UPLOADS")
    print(f"Started: {datetime.now()}")
    print("="*70)

    db = osxphotos.PhotosDB()
    results = []

    # Get all albums
    albums = [a for a in db.album_info if a.title and not a.folder_names]
    print(f"\nFound {len(albums)} albums")

    processed = 0
    for album in albums:
        print(f"\n{'='*50}")
        print(f"Album: {album.title} ({len(album.photos)} photos)")

        export_dir = Path(tempfile.mkdtemp())

        for i, photo in enumerate(album.photos[:20]):  # Limit 20 per album for testing
            try:
                # Export
                paths = photo.export(str(export_dir), use_photos_export=True)
                if not paths:
                    continue

                file_path = Path(paths[0])

                # Skip videos
                if file_path.suffix.lower() in ['.mov', '.mp4', '.m4v']:
                    file_path.unlink(missing_ok=True)
                    continue

                # Analyze with Ollama
                print(f"  [{i+1}/{len(album.photos)}] Analyzing {photo.original_filename}...")
                analysis = analyze_photo(file_path)

                # Save result
                result = {
                    'album': album.title,
                    'filename': photo.original_filename,
                    'photos_uuid': photo.uuid,
                    'date_taken': photo.date.isoformat() if photo.date else None,
                    'latitude': photo.latitude,
                    'longitude': photo.longitude,
                    'camera_make': photo.exif_info.camera_make if photo.exif_info else None,
                    'camera_model': photo.exif_info.camera_model if photo.exif_info else None,
                    'analysis': analysis
                }
                results.append(result)

                if analysis.get('vin'):
                    print(f"    ✓ VIN DETECTED: {analysis['vin']}")
                elif analysis.get('vin_visible'):
                    print(f"    ⚠ VIN visible but couldn't read")

                # Cleanup
                file_path.unlink(missing_ok=True)
                processed += 1

            except Exception as e:
                print(f"  Error: {e}")

        # Cleanup temp dir
        try:
            for f in export_dir.iterdir():
                f.unlink()
            export_dir.rmdir()
        except:
            pass

    # Save results
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n{'='*70}")
    print(f"COMPLETE - {processed} photos analyzed")
    print(f"Results saved: {OUTPUT_FILE}")
    print(f"Finished: {datetime.now()}")
    print(f"{'='*70}")

    # Summary
    vins_found = [r for r in results if r['analysis'].get('vin')]
    print(f"\n📊 Summary:")
    print(f"  VINs detected: {len(vins_found)}")
    for v in vins_found:
        print(f"    {v['analysis']['vin']} in {v['album']}/{v['filename']}")

if __name__ == '__main__':
    main()
