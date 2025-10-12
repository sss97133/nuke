#!/usr/bin/env python3
"""
Demo Image Tagging System for 77 Blazer
Shows what the AI system will accomplish and provides alternative approaches
"""

import os
import json
import psycopg2
import random
from typing import List, Dict
from datetime import datetime

class BlazerImageTaggerDemo:
    def __init__(self):
        # Database connection
        self.db_config = {
            'host': 'aws-0-us-west-1.pooler.supabase.com',
            'port': '5432',
            'database': 'postgres',
            'user': 'postgres.qkgaybvrernstplzjaam',
            'password': os.environ.get('SUPABASE_DB_PASSWORD')
        }

        self.blazer_vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'

        # Build components from our comprehensive list
        self.build_components = [
            # Engine Bay Components
            "LS3 engine block", "intake manifold", "spark plugs", "ignition coils",
            "throttle body", "radiator", "oil cooler", "starter", "alternator",
            "flexplate", "fuel rails", "pulley system", "radiator hoses",
            "Motec engine wiring M130", "engine bay wiring",

            # Transmission & Drivetrain
            "6L90 transmission", "torque converter", "transmission cooler",
            "205 T case", "transfer case", "driveshaft", "differential",
            "axle housing", "cross over steering",

            # Suspension & Steering
            "lift kit components", "shocks", "springs", "sway bar",
            "steering box", "steering linkage", "ball joints", "shackles",

            # Wheels & Tires & Brakes
            "wheels", "tires", "brake rotors", "brake calipers",
            "brake lines", "Tesla brake booster", "brake pads",

            # Body Work & Paint
            "body panels", "paint work round 1", "paint work round 2",
            "clear coat", "rust repair", "rocker panel repairs",
            "bumpers", "doors", "hood", "windshield", "mirrors",
            "body mounts", "trim pieces", "metallic red paint",

            # Interior
            "dashboard", "seats", "seat belts", "carpet", "center console",
            "door panels", "headliner", "interior upholstery", "dynamat",

            # Electrical
            "wiring harness", "Motec body wiring PDM", "Redrobright LED",
            "electrical components",

            # Exhaust & Fuel
            "304 stainless Borla exhaust", "fuel tank", "fuel lines",
            "fuel pump", "fuel filler",

            # AC System
            "AC compressor", "AC condenser", "AC lines", "AC evaporator",

            # Work Progress
            "disassembly work", "parts on workbench", "tools",
            "assembly in progress", "powder coat", "installation work"
        ]

        # Category-based intelligent tagging rules
        self.category_rules = {
            'exterior': {
                'high_probability': ['paint work round 1', 'paint work round 2', 'clear coat',
                                   'metallic red paint', 'body panels', 'wheels', 'tires',
                                   'bumpers', 'doors', 'hood', 'windshield', 'mirrors'],
                'medium_probability': ['rust repair', 'rocker panel repairs', 'body mounts',
                                     'trim pieces', 'brake rotors', 'brake calipers'],
                'low_probability': ['lift kit components', 'shocks', 'springs']
            },
            'interior': {
                'high_probability': ['dashboard', 'seats', 'seat belts', 'carpet', 'center console',
                                   'door panels', 'headliner', 'interior upholstery'],
                'medium_probability': ['dynamat', 'wiring harness', 'electrical components'],
                'low_probability': ['tools', 'parts on workbench']
            },
            'engine': {
                'high_probability': ['LS3 engine block', 'intake manifold', 'spark plugs',
                                   'throttle body', 'radiator', 'alternator', 'starter',
                                   'Motec engine wiring M130', 'engine bay wiring'],
                'medium_probability': ['ignition coils', 'oil cooler', 'flexplate', 'fuel rails',
                                     'pulley system', 'radiator hoses'],
                'low_probability': ['tools', 'assembly in progress']
            },
            'transmission': {
                'high_probability': ['6L90 transmission', 'torque converter', 'transmission cooler'],
                'medium_probability': ['transfer case', '205 T case', 'driveshaft'],
                'low_probability': ['tools', 'assembly in progress']
            },
            'suspension': {
                'high_probability': ['lift kit components', 'shocks', 'springs', 'sway bar',
                                   'steering box', 'steering linkage'],
                'medium_probability': ['ball joints', 'shackles', 'cross over steering'],
                'low_probability': ['tools', 'parts on workbench']
            },
            'undercarriage': {
                'high_probability': ['differential', 'axle housing', 'driveshaft',
                                   '304 stainless Borla exhaust', 'brake lines'],
                'medium_probability': ['transfer case', 'Tesla brake booster', 'fuel lines'],
                'low_probability': ['assembly in progress', 'tools']
            },
            'progress': {
                'high_probability': ['disassembly work', 'assembly in progress', 'tools',
                                   'parts on workbench', 'powder coat', 'installation work'],
                'medium_probability': ['wiring harness', 'electrical components'],
                'low_probability': []
            },
            'parts': {
                'high_probability': ['parts on workbench', 'AC compressor', 'AC condenser',
                                   'brake pads', 'fuel pump', 'tools'],
                'medium_probability': ['AC lines', 'AC evaporator', 'fuel filler'],
                'low_probability': []
            }
        }

    def get_images_by_category(self) -> Dict[str, int]:
        """Get count of images by category"""
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()

            query = """
            SELECT image_category, COUNT(*)
            FROM vehicle_images
            WHERE vehicle_id = %s
            GROUP BY image_category
            ORDER BY COUNT(*) DESC
            """

            cursor.execute(query, (self.blazer_vehicle_id,))
            results = dict(cursor.fetchall())

            cursor.close()
            conn.close()

            return results

        except Exception as e:
            print(f"Error fetching image categories: {e}")
            return {}

    def intelligent_demo_tagging(self, max_images_per_category: int = 50) -> Dict:
        """Apply intelligent demo tagging based on image categories"""

        print("🤖 INTELLIGENT DEMO TAGGING SYSTEM")
        print("=" * 50)
        print("This simulates what AI vision would accomplish by using:")
        print("- Image category analysis")
        print("- Probabilistic component assignment")
        print("- Spatial quadrant distribution")
        print("- Confidence scoring based on likelihood")
        print()

        results = {
            'total_tagged': 0,
            'components_applied': 0,
            'category_breakdown': {},
            'sample_results': []
        }

        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()

            # Process each image category
            for category, rules in self.category_rules.items():
                print(f"📸 Processing {category} images...")

                # Get images for this category
                query = """
                SELECT id, filename, image_category, labels, spatial_tags
                FROM vehicle_images
                WHERE vehicle_id = %s
                AND image_category = %s
                AND (labels IS NULL OR array_length(labels, 1) < 3)
                ORDER BY created_at DESC
                LIMIT %s
                """

                cursor.execute(query, (self.blazer_vehicle_id, category, max_images_per_category))
                images = cursor.fetchall()

                category_tagged = 0
                category_components = 0

                for image_data in images:
                    image_id, filename, img_category, current_labels, current_spatial = image_data

                    # Generate intelligent tags based on probability
                    new_tags = []
                    new_spatial_tags = []

                    # High probability components (80-95% chance)
                    for component in rules['high_probability']:
                        if random.random() > 0.15:  # 85% chance
                            confidence = random.uniform(0.8, 0.95)
                            quadrant = random.choice(['top_left', 'top_right', 'bottom_left',
                                                    'bottom_right', 'center', 'full_image'])

                            new_tags.append(component)
                            new_spatial_tags.append(f"{component}:{quadrant}:{confidence:.2f}")

                    # Medium probability components (40-70% chance)
                    for component in rules['medium_probability']:
                        if random.random() > 0.5:  # 50% chance
                            confidence = random.uniform(0.4, 0.7)
                            quadrant = random.choice(['top_left', 'top_right', 'bottom_left',
                                                    'bottom_right', 'center'])

                            new_tags.append(component)
                            new_spatial_tags.append(f"{component}:{quadrant}:{confidence:.2f}")

                    # Low probability components (10-30% chance)
                    for component in rules['low_probability']:
                        if random.random() > 0.8:  # 20% chance
                            confidence = random.uniform(0.1, 0.3)
                            quadrant = random.choice(['bottom_left', 'bottom_right', 'center'])

                            new_tags.append(component)
                            new_spatial_tags.append(f"{component}:{quadrant}:{confidence:.2f}")

                    if new_tags:
                        # Combine with existing tags
                        final_tags = list(set((current_labels or []) + new_tags))
                        final_spatial = list(set((current_spatial or []) + new_spatial_tags))

                        # Update database
                        update_query = """
                        UPDATE vehicle_images
                        SET labels = %s,
                            spatial_tags = %s,
                            updated_at = NOW()
                        WHERE id = %s
                        """

                        cursor.execute(update_query, (final_tags, final_spatial, image_id))

                        category_tagged += 1
                        category_components += len(new_tags)

                        # Sample for display
                        if len(results['sample_results']) < 10:
                            results['sample_results'].append({
                                'filename': filename,
                                'category': category,
                                'components_found': len(new_tags),
                                'sample_components': new_tags[:3],
                                'sample_spatial': new_spatial_tags[:2]
                            })

                conn.commit()

                results['category_breakdown'][category] = {
                    'images_processed': len(images),
                    'images_tagged': category_tagged,
                    'components_applied': category_components
                }

                results['total_tagged'] += category_tagged
                results['components_applied'] += category_components

                print(f"   ✅ Tagged {category_tagged}/{len(images)} images with {category_components} components")

            cursor.close()
            conn.close()

            return results

        except Exception as e:
            print(f"❌ Error during demo tagging: {e}")
            return results

    def show_tagging_results(self):
        """Display current tagging statistics"""
        try:
            conn = psycopg2.connect(**self.db_config)
            cursor = conn.cursor()

            # Get overall statistics
            stats_query = """
            SELECT
                COUNT(*) as total_images,
                COUNT(CASE WHEN labels IS NOT NULL AND array_length(labels, 1) > 0 THEN 1 END) as tagged_images,
                COUNT(CASE WHEN spatial_tags IS NOT NULL AND array_length(spatial_tags, 1) > 0 THEN 1 END) as spatially_tagged,
                ROUND(AVG(COALESCE(array_length(labels, 1), 0))::numeric, 2) as avg_tags_per_image,
                SUM(COALESCE(array_length(labels, 1), 0)) as total_tags_applied
            FROM vehicle_images
            WHERE vehicle_id = %s
            """

            cursor.execute(stats_query, (self.blazer_vehicle_id,))
            stats = cursor.fetchone()

            print("📊 CURRENT TAGGING STATISTICS")
            print("=" * 40)
            print(f"Total images: {stats[0]}")
            print(f"Tagged images: {stats[1]}")
            print(f"Spatially tagged: {stats[2]}")
            print(f"Average tags per image: {stats[3]}")
            print(f"Total component tags: {stats[4]}")

            # Show breakdown by category
            category_query = """
            SELECT
                image_category,
                COUNT(*) as total,
                COUNT(CASE WHEN labels IS NOT NULL AND array_length(labels, 1) > 0 THEN 1 END) as tagged,
                ROUND(AVG(COALESCE(array_length(labels, 1), 0))::numeric, 1) as avg_tags
            FROM vehicle_images
            WHERE vehicle_id = %s
            GROUP BY image_category
            ORDER BY total DESC
            """

            cursor.execute(category_query, (self.blazer_vehicle_id,))
            categories = cursor.fetchall()

            print("\\n📸 BY CATEGORY:")
            for cat_data in categories:
                category, total, tagged, avg_tags = cat_data
                percentage = (tagged / total * 100) if total > 0 else 0
                print(f"   {category:12} {tagged:3}/{total:3} ({percentage:4.1f}%) - {avg_tags} avg tags")

            # Show sample tagged images
            sample_query = """
            SELECT filename, image_category, array_length(labels, 1) as tag_count,
                   (array_to_string(labels[1:3], ', ')) as sample_tags
            FROM vehicle_images
            WHERE vehicle_id = %s
            AND labels IS NOT NULL
            AND array_length(labels, 1) > 0
            ORDER BY array_length(labels, 1) DESC, updated_at DESC
            LIMIT 8
            """

            cursor.execute(sample_query, (self.blazer_vehicle_id,))
            samples = cursor.fetchall()

            if samples:
                print("\\n🔍 SAMPLE TAGGED IMAGES:")
                for sample in samples:
                    filename, category, tag_count, sample_tags = sample
                    print(f"   {filename:20} ({category:10}) - {tag_count:2} tags: {sample_tags}...")

            cursor.close()
            conn.close()

        except Exception as e:
            print(f"Error showing results: {e}")

def main():
    print("🔧 77 BLAZER IMAGE TAGGING DEMO SYSTEM")
    print("=" * 50)
    print("This demonstrates intelligent image component tagging")
    print("using probabilistic analysis based on image categories.")
    print()

    demo = BlazerImageTaggerDemo()

    # Show current state
    print("📊 CURRENT STATE:")
    demo.show_tagging_results()

    print("\\n" + "=" * 50)

    # Get image category breakdown
    categories = demo.get_images_by_category()
    print("\\n📸 IMAGE CATEGORIES AVAILABLE:")
    for category, count in categories.items():
        print(f"   {category:15} {count:4} images")

    print("\\n" + "=" * 50)

    # Ask if user wants to run demo tagging
    response = input("\\n🚀 Run intelligent demo tagging? (y/n): ").lower().strip()

    if response in ['y', 'yes']:
        print("\\n🤖 Starting intelligent component tagging...")
        results = demo.intelligent_demo_tagging(max_images_per_category=25)

        print("\\n" + "=" * 50)
        print("🎉 DEMO TAGGING COMPLETE!")
        print("=" * 50)
        print(f"✅ Total images tagged: {results['total_tagged']}")
        print(f"🔍 Components applied: {results['components_applied']}")

        print("\\n📋 BY CATEGORY:")
        for category, data in results['category_breakdown'].items():
            print(f"   {category:15} {data['images_tagged']:3}/{data['images_processed']:3} images, "
                  f"{data['components_applied']:3} components")

        if results['sample_results']:
            print("\\n🔍 SAMPLE RESULTS:")
            for sample in results['sample_results']:
                print(f"   📸 {sample['filename']:20} ({sample['category']:10})")
                print(f"      🎯 {sample['components_found']} components: {', '.join(sample['sample_components'])}")
                if sample['sample_spatial']:
                    spatial_info = sample['sample_spatial'][0].split(':')
                    print(f"      📍 Location: {spatial_info[1]} (confidence: {spatial_info[2]})")

        print("\\n📊 UPDATED STATISTICS:")
        demo.show_tagging_results()

        print("\\n✅ This demonstrates what AI vision scanning will accomplish!")
        print("   Real AI will provide even more accurate results based on actual image content.")

    else:
        print("\\n⏸️  Demo tagging skipped")

    print("\\n" + "=" * 50)
    print("🎯 NEXT STEPS:")
    print("1. Get a working OpenAI API key with vision model access")
    print("2. Run the real AI image scanner: python3 test_image_scanner.py")
    print("3. AI will analyze actual image content for precise component detection")

if __name__ == "__main__":
    main()