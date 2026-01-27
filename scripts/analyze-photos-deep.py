#!/usr/bin/env python3
"""
DEEP photo analysis with structured database storage
Extracts EVERYTHING possible from detail photos
"""

import os
import json
import sqlite3
import tempfile
from pathlib import Path
from datetime import datetime
import osxphotos
import requests

from img import img_to_base64

OLLAMA_URL = "http://localhost:11434"
DB_FILE = Path(__file__).parent / "photo_analysis.db"
LOG_FILE = Path(__file__).parent.parent / ".ralph/logs/photo_analysis.log"

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + "\n")

def init_db():
    """Create database with full schema."""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS photo_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        album_name TEXT,
        started_at TEXT,
        photo_count INTEGER DEFAULT 0,
        vins_detected INTEGER DEFAULT 0
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,

        -- File info
        filename TEXT,
        photos_uuid TEXT UNIQUE,
        file_path TEXT,

        -- EXIF data
        date_taken TEXT,
        latitude REAL,
        longitude REAL,
        altitude REAL,
        camera_make TEXT,
        camera_model TEXT,
        focal_length REAL,
        aperture REAL,
        iso INTEGER,
        shutter_speed TEXT,

        -- AI Classification
        is_vehicle BOOLEAN,
        photo_type TEXT,  -- exterior, interior, engine, undercarriage, detail, document, vin_plate, door_jamb, window_sticker
        confidence REAL,

        -- Vehicle identification
        vin TEXT,
        vin_confidence REAL,
        year_visible TEXT,
        make_visible TEXT,
        model_visible TEXT,
        trim_visible TEXT,
        color_visible TEXT,

        -- Detail photo data (door jambs, engine bay tags, etc)
        manufacture_date TEXT,
        paint_code TEXT,
        trim_code TEXT,
        engine_code TEXT,
        transmission_code TEXT,
        axle_code TEXT,
        build_sheet_data TEXT,  -- JSON
        certification_labels TEXT,  -- JSON array

        -- Condition assessment
        condition_notes TEXT,
        modifications_visible TEXT,
        damage_visible TEXT,

        -- Visual features (from visual_features in analysis)
        vehicle_color_detected TEXT,
        body_style TEXT,
        wheels_visible TEXT,
        lift_status TEXT,
        assembly_state TEXT,
        location_context TEXT,
        people_visible BOOLEAN,
        tools_visible TEXT,  -- JSON array
        work_activity TEXT,

        -- Raw AI response
        ai_analysis_full TEXT,  -- Full JSON

        -- Metadata
        analyzed_at TEXT,

        FOREIGN KEY (session_id) REFERENCES photo_sessions(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS image_clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cluster_name TEXT,

        -- Clustering criteria
        vin TEXT,
        location_lat REAL,
        location_lon REAL,
        date_range_start TEXT,
        date_range_end TEXT,

        -- Stats
        photo_count INTEGER,
        confidence_score REAL,

        -- Extracted vehicle data
        year INTEGER,
        make TEXT,
        model TEXT,
        trim TEXT,
        color TEXT,
        mileage INTEGER,

        created_at TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS cluster_photos (
        cluster_id INTEGER,
        photo_id INTEGER,
        PRIMARY KEY (cluster_id, photo_id),
        FOREIGN KEY (cluster_id) REFERENCES image_clusters(id),
        FOREIGN KEY (photo_id) REFERENCES photos(id)
    )''')

    conn.commit()
    conn.close()
    log("✓ Database initialized")

def analyze_photo_deep(image_path: Path) -> dict:
    """Deep analysis with Ollama - extract ALL possible data."""
    try:
        image_data = img_to_base64(image_path, max_size=800)

        prompt = """Analyze this vehicle photo for VISUAL SEARCH. Return ONLY valid JSON:
{
  "is_vehicle": true/false,
  "photo_type": "exterior|interior|engine|undercarriage|detail|document|vin_plate|door_jamb|window_sticker|engine_tag|build_sheet",
  "confidence": 0.0-1.0,

  "vin": "17-char VIN if readable, else null",
  "vin_confidence": 0.0-1.0,

  "vehicle_visible": {
    "full_vehicle": true/false,
    "body_style": "truck|suv|sedan|coupe|convertible|wagon|van",
    "color": "color if full vehicle visible",
    "year": "YYYY if identifiable",
    "make": "Make if identifiable",
    "model": "Model if identifiable"
  },

  "visual_features": {
    "wheels_visible": "stock|aftermarket|chrome|steelies|none",
    "lift_status": "on_ground|on_lift|on_jack_stands|on_trailer|none",
    "assembly_state": "complete|partial_disassembly|engine_out|bare_chassis|in_pieces",
    "location_context": "garage|driveway|car_show|road|dealership|shop|outdoor",
    "people_visible": true/false,
    "tools_visible": ["any tools visible"],
    "work_activity": "welding|painting|assembly|disassembly|cleaning|inspection|driving|parked|none"
  },

  "detail_data": {
    "manufacture_date": "MM/YYYY from sticker",
    "paint_code": "code from jamb",
    "trim_code": "trim code",
    "engine_code": "engine code",
    "certification_labels": ["readable labels"],
    "part_numbers": ["any part numbers"]
  },

  "condition": {
    "modifications": "any mods visible",
    "damage": "damage/wear visible"
  },

  "text_visible": "ALL text readable in image",
  "brief": "3-5 words"
}

CRITICAL: Only fill fields for what's ACTUALLY visible. Close-up of door jamb = no full vehicle data. Engine bay photo = no exterior color."""

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": "llava:7b",
                "prompt": prompt,
                "images": [image_data],
                "stream": False,
                "options": {"temperature": 0.05, "num_predict": 400}
            },
            timeout=60
        )

        if response.status_code == 200:
            result = response.json()
            text = result.get('response', '')

            import re
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group())
                parsed['_raw_response'] = text
                return parsed

        return {"error": "analysis_failed", "status": response.status_code}

    except Exception as e:
        return {"error": str(e)}

def save_photo_analysis(conn, session_id, photo, file_path, analysis):
    """Save photo analysis to database."""
    c = conn.cursor()

    # Extract all fields
    detail = analysis.get('detail_data', {}) or {}
    condition = analysis.get('condition', {}) or {}
    vehicle = analysis.get('vehicle_visible', {}) or {}
    visual = analysis.get('visual_features', {}) or {}

    c.execute('''INSERT INTO photos (
        session_id, filename, photos_uuid, file_path,
        date_taken, latitude, longitude, altitude,
        camera_make, camera_model,
        is_vehicle, photo_type, confidence,
        vin, vin_confidence,
        year_visible, make_visible, model_visible, trim_visible, color_visible,
        manufacture_date, paint_code, trim_code, engine_code, transmission_code, axle_code,
        build_sheet_data, certification_labels,
        condition_notes, modifications_visible, damage_visible,
        vehicle_color_detected, body_style, wheels_visible, lift_status, assembly_state,
        location_context, people_visible, tools_visible, work_activity,
        ai_analysis_full, analyzed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
    (
        session_id,
        photo.original_filename,
        photo.uuid,
        str(file_path),
        photo.date.isoformat() if photo.date else None,
        photo.latitude,
        photo.longitude,
        getattr(photo, 'altitude', None),
        photo.exif_info.camera_make if photo.exif_info else None,
        photo.exif_info.camera_model if photo.exif_info else None,
        analysis.get('is_vehicle'),
        analysis.get('photo_type'),
        analysis.get('confidence'),
        analysis.get('vin'),
        analysis.get('vin_confidence'),
        vehicle.get('year'),
        vehicle.get('make'),
        vehicle.get('model'),
        None,  # trim_visible
        vehicle.get('color'),
        detail.get('manufacture_date'),
        detail.get('paint_code'),
        detail.get('trim_code'),
        detail.get('engine_code'),
        None,  # transmission_code
        None,  # axle_code
        None,  # build_sheet_data
        json.dumps(detail.get('certification_labels', [])),
        None,  # condition_notes
        condition.get('modifications'),
        condition.get('damage'),
        vehicle.get('color'),
        vehicle.get('body_style'),
        visual.get('wheels_visible'),
        visual.get('lift_status'),
        visual.get('assembly_state'),
        visual.get('location_context'),
        visual.get('people_visible'),
        json.dumps(visual.get('tools_visible', [])),
        visual.get('work_activity'),
        json.dumps(analysis),
        datetime.now().isoformat()
    ))

    conn.commit()
    return c.lastrowid

def main():
    log("="*70)
    log("DEEP PHOTO ANALYSIS")
    log(f"Started: {datetime.now()}")
    log(f"Database: {DB_FILE}")
    log("="*70)

    # Initialize database
    init_db()
    conn = sqlite3.connect(DB_FILE)

    # Load Photos library
    log("Loading Photos library...")
    db = osxphotos.PhotosDB()

    # Get all albums
    albums = [a for a in db.album_info if a.title and not a.folder_names]
    log(f"Found {len(albums)} albums")

    total_analyzed = 0
    total_vins = 0

    for album in albums:
        log(f"\n{'='*50}")
        log(f"Album: {album.title} ({len(album.photos)} photos)")

        # Create session
        c = conn.cursor()
        c.execute('''INSERT INTO photo_sessions (album_name, started_at, photo_count)
                     VALUES (?, ?, ?)''',
                  (album.title, datetime.now().isoformat(), len(album.photos)))
        session_id = c.lastrowid
        conn.commit()

        export_dir = Path(tempfile.mkdtemp())
        vins_in_album = 0

        for i, photo in enumerate(album.photos):
            try:
                # Export
                paths = photo.export(str(export_dir), use_photos_export=True)
                if not paths:
                    continue

                file_path = Path(paths[0])

                # Skip videos
                if file_path.suffix.lower() in ['.mov', '.mp4', '.m4v', '.avi']:
                    file_path.unlink(missing_ok=True)
                    continue

                # Deep analysis
                log(f"  [{i+1}/{len(album.photos)}] {photo.original_filename}...")
                analysis = analyze_photo_deep(file_path)

                # Save to DB
                photo_id = save_photo_analysis(conn, session_id, photo, file_path, analysis)
                total_analyzed += 1

                # Log findings
                if analysis.get('vin'):
                    log(f"    🎯 VIN: {analysis['vin']} (confidence: {analysis.get('vin_confidence', 0):.2f})")
                    vins_in_album += 1
                    total_vins += 1

                if analysis.get('detail_data'):
                    detail = analysis['detail_data']
                    if detail.get('paint_code'):
                        log(f"    🎨 Paint code: {detail['paint_code']}")
                    if detail.get('manufacture_date'):
                        log(f"    📅 Mfg date: {detail['manufacture_date']}")
                    if detail.get('engine_code'):
                        log(f"    🔧 Engine: {detail['engine_code']}")

                # Cleanup
                file_path.unlink(missing_ok=True)

                # Progress save every 10 photos
                if (i + 1) % 10 == 0:
                    log(f"  Progress: {i+1}/{len(album.photos)} analyzed")

            except Exception as e:
                log(f"  ✗ Error: {e}")

        # Update session stats
        c.execute('''UPDATE photo_sessions
                     SET photo_count = ?, vins_detected = ?
                     WHERE id = ?''',
                  (total_analyzed, vins_in_album, session_id))
        conn.commit()

        # Cleanup temp dir
        try:
            for f in export_dir.iterdir():
                f.unlink()
            export_dir.rmdir()
        except:
            pass

        log(f"Album complete: {vins_in_album} VINs detected")

    conn.close()

    log(f"\n{'='*70}")
    log(f"COMPLETE")
    log(f"Photos analyzed: {total_analyzed}")
    log(f"VINs detected: {total_vins}")
    log(f"Database: {DB_FILE}")
    log(f"Finished: {datetime.now()}")
    log(f"{'='*70}")

    # Generate summary report
    generate_summary_report()

def generate_summary_report():
    """Generate markdown summary report."""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()

    report_file = Path(__file__).parent / "photo_analysis_report.md"

    with open(report_file, 'w') as f:
        f.write("# Photo Analysis Report\n\n")
        f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")

        # VINs found
        f.write("## VINs Detected\n\n")
        c.execute("SELECT DISTINCT vin, COUNT(*) as count FROM photos WHERE vin IS NOT NULL GROUP BY vin ORDER BY count DESC")
        vins = c.fetchall()
        if vins:
            for vin, count in vins:
                f.write(f"- **{vin}** ({count} photos)\n")
        else:
            f.write("*No VINs detected*\n")

        f.write("\n## Photos by Type\n\n")
        c.execute("SELECT photo_type, COUNT(*) FROM photos GROUP BY photo_type ORDER BY COUNT(*) DESC")
        for ptype, count in c.fetchall():
            f.write(f"- {ptype or 'unknown'}: {count}\n")

        f.write("\n## Detail Data Extracted\n\n")
        c.execute("SELECT COUNT(*) FROM photos WHERE paint_code IS NOT NULL")
        paint_codes = c.fetchone()[0]
        f.write(f"- Paint codes: {paint_codes}\n")

        c.execute("SELECT COUNT(*) FROM photos WHERE manufacture_date IS NOT NULL")
        mfg_dates = c.fetchone()[0]
        f.write(f"- Manufacture dates: {mfg_dates}\n")

        c.execute("SELECT COUNT(*) FROM photos WHERE engine_code IS NOT NULL")
        engine_codes = c.fetchone()[0]
        f.write(f"- Engine codes: {engine_codes}\n")

        f.write("\n## Next Steps\n\n")
        f.write("1. Review VINs and match to vehicles in Nuke database\n")
        f.write("2. Create image clusters for vehicles without VINs\n")
        f.write("3. Manual review of high-confidence matches\n")

    conn.close()
    log(f"✓ Summary report: {report_file}")

if __name__ == '__main__':
    main()
