#!/usr/bin/env python3
"""
Test AI Vision on multiple Blazer images to find automotive components
"""

import os
import json
import requests
import base64
import psycopg2
import time

def scan_multiple_images():
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required")

    # Get multiple Blazer images from database
    db_config = {
        'host': 'aws-0-us-west-1.pooler.supabase.com',
        'port': '5432',
        'database': 'postgres',
        'user': 'postgres.qkgaybvrernstplzjaam',
        'password': os.environ.get('SUPABASE_DB_PASSWORD')
    }

    try:
        conn = psycopg2.connect(**db_config)
        cursor = conn.cursor()

        # Get a variety of images
        query = """
        SELECT id, image_url, filename, image_category
        FROM vehicle_images
        WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
        ORDER BY created_at DESC
        LIMIT 5
        """

        cursor.execute(query)
        images = cursor.fetchall()
        cursor.close()
        conn.close()

        print(f"🚀 TESTING AI VISION ON {len(images)} BLAZER IMAGES")
        print("=" * 60)

        successful_detections = 0
        total_components = 0

        for i, (image_id, image_url, filename, category) in enumerate(images):
            print(f"\\n📸 Image {i+1}/5: {filename} ({category})")

            try:
                # Download image
                response = requests.get(image_url, timeout=30)
                response.raise_for_status()
                base64_image = base64.b64encode(response.content).decode('utf-8')

                # AI prompt focused on automotive components
                prompt = """Analyze this 1977 Chevrolet K5 Blazer photo for automotive components.

Look for ANY visible car parts including:
- Engine parts (engine block, intake, radiator, belts, hoses)
- Body parts (doors, hood, fenders, bumpers, paint work)
- Wheels, tires, brake components
- Interior parts (dashboard, seats, steering wheel)
- Suspension parts (shocks, springs, leaf springs)
- Work in progress (tools, parts, disassembly)

Respond in JSON:
{"components": [{"name": "part name", "confidence": 0.8, "reason": "why visible"}]}

Be specific about what you actually see in the image."""

                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }

                payload = {
                    "model": "gpt-4o",
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}",
                                "detail": "high"
                            }}
                        ]
                    }],
                    "max_tokens": 500,
                    "temperature": 0.1
                }

                print(f"   🤖 AI analyzing...")
                response = requests.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=60
                )

                if response.status_code == 200:
                    result = response.json()
                    ai_response = result['choices'][0]['message']['content']

                    # Clean JSON response
                    clean_response = ai_response.strip()
                    if clean_response.startswith('```json'):
                        clean_response = clean_response[7:]
                    if clean_response.endswith('```'):
                        clean_response = clean_response[:-3]
                    clean_response = clean_response.strip()

                    try:
                        parsed = json.loads(clean_response)
                        components = parsed.get('components', [])

                        if components:
                            print(f"   ✅ Found {len(components)} components:")
                            for comp in components:
                                print(f"      • {comp['name']} ({comp['confidence']:.1%})")
                                print(f"        {comp['reason']}")
                            successful_detections += 1
                            total_components += len(components)
                        else:
                            print("   ❌ No components detected")

                    except json.JSONDecodeError:
                        print("   ⚠️  JSON parse error")
                        print(f"   Raw: {ai_response[:100]}...")

                else:
                    print(f"   ❌ API Error: {response.status_code}")

                # Rate limiting
                time.sleep(2)

            except Exception as e:
                print(f"   ❌ Error: {e}")

        print("\\n" + "=" * 60)
        print("🎯 SCAN SUMMARY:")
        print(f"✅ Images with detections: {successful_detections}/5")
        print(f"🔍 Total components found: {total_components}")

        if total_components > 0:
            print("\\n🎉 AI VISION IS WORKING! Found automotive components!")
            print("   Ready to scale up to all 752 Blazer images.")
        else:
            print("\\n🤔 No components found in this sample.")
            print("   May need different images or refined prompts.")

    except Exception as e:
        print(f"❌ Database error: {e}")

if __name__ == "__main__":
    scan_multiple_images()