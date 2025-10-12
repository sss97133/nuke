#!/usr/bin/env python3
"""
Simple test of OpenAI Vision API with a direct automotive component scan
"""

import os
import json
import requests
import base64
import tempfile
import psycopg2

def test_simple_ai_vision():
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required")

    # Get a Blazer image from database
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

        query = """
        SELECT id, image_url, filename
        FROM vehicle_images
        WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
        ORDER BY created_at DESC
        LIMIT 1
        """

        cursor.execute(query)
        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if not result:
            print("No images found")
            return

        image_id, image_url, filename = result
        print(f"📸 Testing AI vision on: {filename}")
        print(f"🔗 Image URL: {image_url[:50]}...")

        # Download image
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()

        # Encode to base64
        base64_image = base64.b64encode(response.content).decode('utf-8')

        # Simple, direct AI prompt
        prompt = """You are an automotive expert analyzing a 1977 Chevrolet K5 Blazer restoration photo.

Look at this image and identify ANY automotive components you can see. This could include:
- Engine parts (LS3 engine, intake, radiator, etc.)
- Body work (paint, panels, doors, hood, etc.)
- Wheels, tires, brakes
- Interior components
- Tools, parts, or work in progress

For each component you identify, respond with:
- Component name
- Your confidence level (0.1 to 1.0)
- Brief reason why you identified it

Respond in simple JSON format:
{
  "components": [
    {"name": "component name", "confidence": 0.8, "reason": "why you see this"}
  ]
}

If you see no clear automotive components, return {"components": []}"""

        # Make API call
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }

        payload = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 800,
            "temperature": 0.1
        }

        print("🤖 Calling OpenAI Vision API...")
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=60
        )

        if response.status_code == 200:
            result = response.json()
            ai_response = result['choices'][0]['message']['content']

            print("\\n🎯 RAW AI RESPONSE:")
            print("-" * 50)
            print(ai_response)
            print("-" * 50)

            # Try to parse JSON (handle markdown code blocks)
            try:
                # Remove markdown code blocks if present
                clean_response = ai_response.strip()
                if clean_response.startswith('```json'):
                    clean_response = clean_response[7:]  # Remove ```json
                if clean_response.endswith('```'):
                    clean_response = clean_response[:-3]  # Remove ```
                clean_response = clean_response.strip()

                parsed = json.loads(clean_response)
                components = parsed.get('components', [])

                print(f"\\n✅ AI ANALYSIS COMPLETE!")
                print(f"🔍 Components found: {len(components)}")

                if components:
                    print("\\n🎯 DETECTED AUTOMOTIVE COMPONENTS:")
                    for comp in components:
                        print(f"   • {comp['name']}")
                        print(f"     Confidence: {comp['confidence']:.1%}")
                        print(f"     AI Reasoning: {comp['reason']}")
                        print()
                else:
                    print("\\n❌ No automotive components detected in this image")

            except json.JSONDecodeError as e:
                print(f"\\n⚠️  JSON parse error: {e}")
                print("AI returned valid response but not in expected JSON format")

        else:
            print(f"❌ API Error: {response.status_code}")
            print(response.text)

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    print("🔧 SIMPLE AI VISION TEST FOR 77 BLAZER")
    print("=" * 45)
    test_simple_ai_vision()