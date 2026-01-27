#!/usr/bin/env python3
"""
Upload analyzed vehicle photos to Supabase
Creates vehicle records and uploads images
"""

import os
import json
import sqlite3
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import requests
from dotenv import load_dotenv

# Load environment
load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DB_FILE = Path(__file__).parent / "photo_analysis.db"
LOG_FILE = Path(__file__).parent.parent / ".ralph/logs/supabase_upload.log"

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + "\n")

def get_or_create_user():
    """Get the first user from Supabase (for now - can be parameterized later)."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    # Get first profile
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/profiles?select=id,email&limit=1",
        headers=headers
    )

    if resp.status_code == 200:
        profiles = resp.json()
        if profiles:
            user_id = profiles[0]['id']
            email = profiles[0].get('email', 'unknown')
            log(f"✓ Using user: {email} ({user_id})")
            return user_id

    log("✗ No user profiles found in Supabase")
    return None

def cluster_photos_by_vin(conn):
    """Group photos by VIN."""
    c = conn.cursor()
    c.execute("""
        SELECT vin,
               COUNT(*) as photo_count,
               GROUP_CONCAT(id) as photo_ids,
               MAX(year_visible) as year,
               MAX(make_visible) as make,
               MAX(model_visible) as model,
               MAX(color_visible) as color
        FROM photos
        WHERE vin IS NOT NULL AND vin != ''
        GROUP BY vin
    """)

    clusters = []
    for row in c.fetchall():
        clusters.append({
            'vin': row[0],
            'photo_count': row[1],
            'photo_ids': [int(x) for x in row[2].split(',')],
            'year': row[3],
            'make': row[4],
            'model': row[5],
            'color': row[6]
        })

    return clusters

def cluster_photos_by_similarity(conn):
    """Group photos without VINs by location + date proximity."""
    c = conn.cursor()
    c.execute("""
        SELECT id, date_taken, latitude, longitude,
               year_visible, make_visible, model_visible,
               color_visible, body_style
        FROM photos
        WHERE (vin IS NULL OR vin = '')
        AND is_vehicle = 1
        AND latitude IS NOT NULL
        ORDER BY date_taken
    """)

    photos = c.fetchall()
    clusters = []
    current_cluster = []

    for photo in photos:
        if not current_cluster:
            current_cluster.append(photo)
            continue

        # Check if similar to current cluster
        last_photo = current_cluster[-1]

        # Within same day and close proximity (100m)
        if (photo[1] and last_photo[1] and
            abs((photo[1] - last_photo[1]).total_seconds()) < 86400 and
            photo[2] and last_photo[2] and photo[3] and last_photo[3]):

            # Simple distance check
            lat_diff = abs(photo[2] - last_photo[2])
            lon_diff = abs(photo[3] - last_photo[3])

            if lat_diff < 0.001 and lon_diff < 0.001:  # ~100m
                current_cluster.append(photo)
            else:
                # Start new cluster
                if len(current_cluster) >= 3:  # Min 3 photos
                    clusters.append(current_cluster)
                current_cluster = [photo]
        else:
            if len(current_cluster) >= 3:
                clusters.append(current_cluster)
            current_cluster = [photo]

    if len(current_cluster) >= 3:
        clusters.append(current_cluster)

    return [{
        'photo_ids': [p[0] for p in cluster],
        'photo_count': len(cluster),
        'year': cluster[0][4],
        'make': cluster[0][5],
        'model': cluster[0][6],
        'color': cluster[0][7],
        'body_style': cluster[0][8]
    } for cluster in clusters]

def create_vehicle_in_supabase(user_id, cluster):
    """Create vehicle record in Supabase."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    vehicle_data = {
        "user_id": user_id,
        "year": int(cluster['year']) if cluster.get('year') and str(cluster['year']).isdigit() else None,
        "make": cluster.get('make'),
        "model": cluster.get('model'),
        "vin": cluster.get('vin'),
        "color": cluster.get('color'),
        "body_style": cluster.get('body_style'),
        "discovery_source": "apple_photos_analysis",
        "notes": f"Imported from {cluster['photo_count']} photos",
        "is_public": True
    }

    # Remove None values
    vehicle_data = {k: v for k, v in vehicle_data.items() if v is not None}

    # Ensure required fields
    if not vehicle_data.get('make') or not vehicle_data.get('model'):
        log(f"  ⚠ Skipping - missing make/model: {vehicle_data}")
        return None

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/vehicles",
        headers=headers,
        json=vehicle_data
    )

    if resp.status_code in [200, 201]:
        vehicle = resp.json()[0] if isinstance(resp.json(), list) else resp.json()
        return vehicle['id']
    else:
        log(f"  ✗ Error creating vehicle: {resp.status_code} - {resp.text}")
        return None

def upload_image_to_supabase(vehicle_id, photo_path, is_primary=False):
    """Upload image to Supabase storage and link to vehicle."""
    # For now, just create the metadata link
    # TODO: Actually upload files to Supabase storage
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    image_data = {
        "vehicle_id": vehicle_id,
        "url": str(photo_path),  # Local path for now
        "is_primary": is_primary,
        "source": "apple_photos",
        "uploaded_by": "photo_analysis_script"
    }

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/vehicle_images",
        headers=headers,
        json=image_data
    )

    return resp.status_code in [200, 201]

def main():
    log("="*70)
    log("UPLOAD VEHICLES TO SUPABASE")
    log(f"Started: {datetime.now()}")
    log("="*70)

    if not SUPABASE_URL or not SUPABASE_KEY:
        log("✗ Missing Supabase credentials in .env")
        return

    if not DB_FILE.exists():
        log(f"✗ Database not found: {DB_FILE}")
        log("  Run analyze-photos-deep.py first")
        return

    # Get user
    user_id = get_or_create_user()
    if not user_id:
        return

    # Connect to local DB
    conn = sqlite3.connect(DB_FILE)

    # Cluster photos by VIN
    log("\n📊 Clustering photos by VIN...")
    vin_clusters = cluster_photos_by_vin(conn)
    log(f"Found {len(vin_clusters)} vehicles with VINs")

    # Cluster photos by similarity
    log("\n📊 Clustering photos without VINs...")
    similar_clusters = cluster_photos_by_similarity(conn)
    log(f"Found {len(similar_clusters)} potential vehicles by similarity")

    all_clusters = vin_clusters + similar_clusters

    # Create vehicles
    log(f"\n🚗 Creating {len(all_clusters)} vehicles in Supabase...")
    created = 0
    skipped = 0

    for i, cluster in enumerate(all_clusters):
        log(f"\n[{i+1}/{len(all_clusters)}] Processing cluster:")
        log(f"  Photos: {cluster['photo_count']}")
        log(f"  Vehicle: {cluster.get('year')} {cluster.get('make')} {cluster.get('model')}")
        if cluster.get('vin'):
            log(f"  VIN: {cluster['vin']}")

        vehicle_id = create_vehicle_in_supabase(user_id, cluster)

        if vehicle_id:
            log(f"  ✓ Created vehicle: {vehicle_id}")
            created += 1

            # Link photos
            c = conn.cursor()
            for photo_id in cluster['photo_ids'][:5]:  # Limit to 5 images per vehicle
                c.execute("SELECT file_path FROM photos WHERE id = ?", (photo_id,))
                row = c.fetchone()
                if row:
                    upload_image_to_supabase(vehicle_id, row[0], is_primary=(photo_id == cluster['photo_ids'][0]))

            log(f"  ✓ Linked {min(5, len(cluster['photo_ids']))} images")
        else:
            skipped += 1

    conn.close()

    log(f"\n{'='*70}")
    log(f"COMPLETE")
    log(f"Vehicles created: {created}")
    log(f"Skipped: {skipped}")
    log(f"Finished: {datetime.now()}")
    log(f"{'='*70}")

if __name__ == '__main__':
    main()
