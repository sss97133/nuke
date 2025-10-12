#!/usr/bin/env python3
"""
Database Integration for Blazer Image Scanning
Fetches images from Supabase, scans them with AI, updates database with results
"""

import os
import json
import psycopg2
import requests
from typing import List, Dict, Tuple
from image_scanner_system import BlazierImageScanner, ImageScanResult
import tempfile
from urllib.parse import urlparse

class BlazerDatabaseScanner:
    def __init__(self):
        # Database connection details
        self.db_config = {
            'host': 'aws-0-us-west-1.pooler.supabase.com',
            'port': '5432',
            'database': 'postgres',
            'user': 'postgres.qkgaybvrernstplzjaam',
            'password': os.environ.get('SUPABASE_DB_PASSWORD')
        }

        self.blazer_vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
        self.scanner = BlazierImageScanner()

    def get_blazer_images_from_db(self, limit: int = 50) -> List[Dict]:
        """Fetch Blazer images from database with their metadata"""
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()

            query = """
            SELECT
                id,
                image_url,
                filename,
                image_category,
                area,
                part,
                operation,
                labels,
                caption,
                created_at
            FROM vehicle_images
            WHERE vehicle_id = %s
            AND image_url IS NOT NULL
            ORDER BY created_at DESC
            LIMIT %s
            """

            cursor.execute(query, (self.blazer_vehicle_id, limit))
            results = cursor.fetchall()

            columns = [desc[0] for desc in cursor.description]
            images = []

            for row in results:
                image_data = dict(zip(columns, row))
                images.append(image_data)

            cursor.close()
            conn.close()

            print(f"Fetched {len(images)} images from database")
            return images

        except Exception as e:
            print(f"Database error: {str(e)}")
            return []

    def download_image(self, image_url: str, temp_dir: str) -> str:
        """Download image from URL to temporary file"""
        try:
            response = requests.get(image_url, stream=True, timeout=30)
            response.raise_for_status()

            # Get filename from URL or use a default
            parsed_url = urlparse(image_url)
            filename = os.path.basename(parsed_url.path) or "image.jpg"

            temp_path = os.path.join(temp_dir, filename)

            with open(temp_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            return temp_path

        except Exception as e:
            print(f"Failed to download {image_url}: {str(e)}")
            return None

    def update_image_tags_in_db(self, image_id: str, scan_result: ImageScanResult):
        """Update database with AI scan results"""
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()

            # Prepare tags and spatial data
            component_tags = [det.component_name for det in scan_result.detections]
            spatial_tags = []

            for det in scan_result.detections:
                spatial_tag = f"{det.component_name}:{det.quadrant.value}:{det.confidence:.2f}"
                spatial_tags.append(spatial_tag)

            # Update the image record
            update_query = """
            UPDATE vehicle_images
            SET
                labels = %s,
                spatial_tags = %s,
                updated_at = NOW()
            WHERE id = %s
            """

            cursor.execute(update_query, (component_tags, spatial_tags, image_id))
            conn.commit()

            cursor.close()
            conn.close()

            print(f"Updated image {image_id} with {len(component_tags)} component tags")

        except Exception as e:
            print(f"Failed to update database for image {image_id}: {str(e)}")

    def scan_blazer_images_batch(self, batch_size: int = 10) -> Dict:
        """Main method to scan Blazer images and update database"""
        print(f"Starting AI-powered scan of 77 Blazer images (batch size: {batch_size})")

        # Fetch images from database
        images_metadata = self.get_blazer_images_from_db(limit=batch_size)

        if not images_metadata:
            print("No images found in database")
            return {"success": False, "error": "No images found"}

        scan_results = []
        successful_scans = 0
        failed_scans = 0

        # Create temporary directory for downloaded images
        with tempfile.TemporaryDirectory() as temp_dir:
            print(f"Using temporary directory: {temp_dir}")

            for i, img_metadata in enumerate(images_metadata):
                print(f"\\nProcessing image {i+1}/{len(images_metadata)}")
                print(f"Image ID: {img_metadata['id']}")
                print(f"Filename: {img_metadata['filename']}")
                print(f"Category: {img_metadata['image_category']}")

                # Download image
                image_path = self.download_image(img_metadata['image_url'], temp_dir)

                if not image_path:
                    print("Failed to download image, skipping...")
                    failed_scans += 1
                    continue

                try:
                    # Scan with AI
                    print("Scanning with AI vision...")
                    scan_results_batch = self.scanner.batch_scan_images([image_path], batch_size=1)

                    if scan_results_batch:
                        scan_result = scan_results_batch[0]
                        scan_result.image_id = img_metadata['id']  # Use database ID

                        # Update database with results
                        self.update_image_tags_in_db(img_metadata['id'], scan_result)

                        scan_results.append(scan_result)
                        successful_scans += 1

                        print(f"✅ Found {scan_result.total_components_found} components")
                        for det in scan_result.detections:
                            print(f"   - {det.component_name} ({det.confidence:.2f}) in {det.quadrant.value}")

                    else:
                        print("❌ AI scan failed")
                        failed_scans += 1

                except Exception as e:
                    print(f"❌ Error processing image: {str(e)}")
                    failed_scans += 1

        # Save comprehensive results
        results_summary = {
            "success": True,
            "total_images_processed": len(images_metadata),
            "successful_scans": successful_scans,
            "failed_scans": failed_scans,
            "total_components_found": sum(r.total_components_found for r in scan_results),
            "scan_results": scan_results
        }

        # Save to file
        output_file = f"../data/blazer_ai_scan_results_{len(images_metadata)}_images.json"
        self.scanner.save_scan_results(scan_results, output_file)

        print(f"\\n🎯 SCAN COMPLETE!")
        print(f"✅ Successfully scanned: {successful_scans} images")
        print(f"❌ Failed scans: {failed_scans} images")
        print(f"🔍 Total components found: {results_summary['total_components_found']}")
        print(f"📄 Results saved to: {output_file}")

        return results_summary

    def get_scanning_statistics(self) -> Dict:
        """Get current scanning statistics from database"""
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()

            stats_query = """
            SELECT
                COUNT(*) as total_images,
                COUNT(CASE WHEN labels IS NOT NULL AND array_length(labels, 1) > 0 THEN 1 END) as tagged_images,
                COUNT(CASE WHEN spatial_tags IS NOT NULL AND array_length(spatial_tags, 1) > 0 THEN 1 END) as spatially_tagged,
                ROUND(AVG(COALESCE(array_length(labels, 1), 0))::numeric, 2) as avg_tags_per_image
            FROM vehicle_images
            WHERE vehicle_id = %s
            """

            cursor.execute(stats_query, (self.blazer_vehicle_id,))
            result = cursor.fetchone()

            stats = {
                "total_images": result[0],
                "ai_tagged_images": result[1],
                "spatially_tagged": result[2],
                "avg_tags_per_image": float(result[3])
            }

            cursor.close()
            conn.close()

            return stats

        except Exception as e:
            print(f"Error getting statistics: {str(e)}")
            return {}

if __name__ == "__main__":
    # Check for required environment variables
    if not os.getenv('OPENAI_API_KEY'):
        print("❌ OPENAI_API_KEY environment variable required")
        exit(1)

    scanner = BlazerDatabaseScanner()

    # Show current stats
    print("Current scanning statistics:")
    stats = scanner.get_scanning_statistics()
    for key, value in stats.items():
        print(f"  {key}: {value}")

    print("\\n" + "="*60)
    print("77 BLAZER AI IMAGE SCANNER")
    print("="*60)

    # Start with a small test batch
    print("\\n🚀 Starting AI-powered image scanning...")
    print("This will:")
    print("1. Fetch Blazer images from database")
    print("2. Download images temporarily")
    print("3. Scan with OpenAI Vision API")
    print("4. Update database with component tags + spatial locations")

    # Uncomment to run a test batch
    # results = scanner.scan_blazer_images_batch(batch_size=5)

    print("\\n⚠️  Ready to scan! Uncomment the batch scan line to start.")