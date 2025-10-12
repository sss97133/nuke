#!/usr/bin/env python3
"""
Test script for the Blazer Image Scanner
Run this to test the AI image scanning system with a small batch
"""

import os
import sys
from blazer_image_database_scanner import BlazerDatabaseScanner

def main():
    print("🔧 77 BLAZER AI IMAGE SCANNER - TEST MODE")
    print("=" * 50)

    # Check environment
    if not os.getenv('OPENAI_API_KEY'):
        print("❌ Error: OPENAI_API_KEY environment variable not set")
        print("Please set it with: export OPENAI_API_KEY='your-key-here'")
        return False

    try:
        scanner = BlazerDatabaseScanner()

        print("✅ Scanner initialized successfully")
        print("✅ Database connection configured")
        print("✅ OpenAI API key found")

        # Get current statistics
        print("\\n📊 Current Database Statistics:")
        stats = scanner.get_scanning_statistics()
        if stats:
            print(f"   Total images: {stats.get('total_images', 0)}")
            print(f"   AI-tagged images: {stats.get('ai_tagged_images', 0)}")
            print(f"   Spatially tagged: {stats.get('spatially_tagged', 0)}")
            print(f"   Avg tags per image: {stats.get('avg_tags_per_image', 0)}")
        else:
            print("   Unable to fetch statistics")

        print("\\n🎯 READY TO SCAN!")
        print("The system will:")
        print("1. Fetch a small batch of Blazer images from Supabase")
        print("2. Download them temporarily for AI processing")
        print("3. Use OpenAI Vision API to identify automotive components")
        print("4. Tag each component with confidence score and quadrant location")
        print("5. Update the database with AI-generated tags")

        # Ask user if they want to proceed
        response = input("\\nProceed with AI scanning? (y/n): ").lower().strip()

        if response == 'y' or response == 'yes':
            print("\\n🚀 Starting AI image scan...")

            # Run a small test batch (5 images)
            results = scanner.scan_blazer_images_batch(batch_size=5)

            if results.get('success'):
                print("\\n🎉 SUCCESS! AI Scanning Complete")
                print(f"✅ Images processed: {results['total_images_processed']}")
                print(f"✅ Successful scans: {results['successful_scans']}")
                print(f"✅ Components found: {results['total_components_found']}")

                # Show some example detections
                if results['scan_results']:
                    print("\\n🔍 Sample Detections:")
                    for i, scan_result in enumerate(results['scan_results'][:3]):
                        if scan_result.detections:
                            print(f"\\n   Image {i+1}: {scan_result.image_id}")
                            for det in scan_result.detections[:3]:  # Show first 3
                                print(f"      - {det.component_name}")
                                print(f"        Confidence: {det.confidence:.1%}")
                                print(f"        Location: {det.quadrant.value}")
                                print(f"        Reason: {det.reasoning}")

                print("\\n📄 Detailed results saved to JSON file")
                print("📊 Database updated with AI-generated tags")

            else:
                print("❌ Scanning failed")
                print(f"Error: {results.get('error', 'Unknown error')}")

        else:
            print("\\n⏸️  Scan cancelled by user")

        return True

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

if __name__ == "__main__":
    success = main()
    if not success:
        sys.exit(1)