#!/usr/bin/env python3
"""
Comprehensive Image Scanner - Scans ALL images in database
Handles both vehicle_images and organization_images tables
Uses OpenAI and Anthropic APIs with failover
"""

import os
import json
import requests
import base64
import psycopg2
import time
from datetime import datetime
from typing import List, Dict, Optional, Tuple

class DatabaseImageScanner:
    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        # Check both ANTHROPIC_API_KEY and CLAUDE_API_KEY
        self.anthropic_api_key = os.getenv('ANTHROPIC_API_KEY') or os.getenv('CLAUDE_API_KEY') or os.getenv('NUKE_CLAUDE_API')
        self.db_password = os.getenv('SUPABASE_DB_PASSWORD')
        
        if not self.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY environment variable is required")
        if not self.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY (or CLAUDE_API_KEY) environment variable is required")
        if not self.db_password:
            raise RuntimeError("SUPABASE_DB_PASSWORD environment variable is required")
        
        self.db_config = {
            'host': 'aws-0-us-west-1.pooler.supabase.com',
            'port': '5432',
            'database': 'postgres',
            'user': 'postgres.qkgaybvrernstplzjaam',
            'password': self.db_password
        }
        
        # Stats tracking
        self.stats = {
            'vehicle_images': {'scanned': 0, 'failed': 0, 'skipped': 0},
            'org_images': {'scanned': 0, 'failed': 0, 'skipped': 0},
            'api_calls': {'openai': 0, 'anthropic': 0},
            'start_time': None,
            'errors': []
        }
    
    def get_db_connection(self):
        """Get fresh database connection"""
        return psycopg2.connect(**self.db_config)
    
    def get_unscanned_vehicle_images(self, limit: Optional[int] = None) -> List[Dict]:
        """Get unscanned vehicle images"""
        conn = self.get_db_connection()
        cursor = conn.cursor()
        
        query = """
        SELECT id, image_url, vehicle_id, category, is_document
        FROM vehicle_images
        WHERE ai_last_scanned IS NULL
        AND image_url IS NOT NULL
        AND image_url != ''
        ORDER BY created_at DESC
        """
        
        if limit:
            query += f" LIMIT {limit}"
        
        cursor.execute(query)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        
        return [
            {
                'id': row[0],
                'image_url': row[1],
                'vehicle_id': row[2],
                'category': row[3],
                'is_document': row[4]
            }
            for row in rows
        ]
    
    def get_unscanned_org_images(self, limit: Optional[int] = None) -> List[Dict]:
        """Get unscanned organization images"""
        conn = self.get_db_connection()
        cursor = conn.cursor()
        
        query = """
        SELECT id, image_url, organization_id, category
        FROM organization_images
        WHERE (ai_scanned IS NULL OR ai_scanned = false)
        AND image_url IS NOT NULL
        AND image_url != ''
        AND queued_for_analysis = false
        ORDER BY created_at DESC
        """
        
        if limit:
            query += f" LIMIT {limit}"
        
        cursor.execute(query)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        
        return [
            {
                'id': row[0],
                'image_url': row[1],
                'organization_id': row[2],
                'category': row[3]
            }
            for row in rows
        ]
    
    def scan_vehicle_image_with_openai(self, image_url: str) -> Optional[Dict]:
        """Scan vehicle image using OpenAI Vision API"""
        try:
            # Download image
            img_response = requests.get(image_url, timeout=30)
            img_response.raise_for_status()
            base64_image = base64.b64encode(img_response.content).decode('utf-8')
            
            prompt = """Analyze this vehicle image and extract all visible components, parts, and details.

Look for:
- Automotive components (engine parts, body panels, wheels, interior parts, etc.)
- Modifications and aftermarket parts
- Damage, wear, or condition issues
- Tools being used
- Work in progress indicators
- Document details if this is a title, receipt, registration, etc.

Return ONLY valid JSON in this exact format:
{
  "components": [
    {"name": "component name", "category": "engine|body|interior|suspension|etc", "confidence": 0.95, "condition": "excellent|good|fair|poor"}
  ],
  "tags": ["descriptive", "tags"],
  "description": "Brief description of what's shown",
  "is_document": true/false,
  "document_type": "receipt|title|registration|manual|etc" (if is_document=true),
  "overall_confidence": 0.85
}"""
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.openai_api_key}"
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
                "max_tokens": 1000,
                "temperature": 0.1
            }
            
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=60
            )
            
            self.stats['api_calls']['openai'] += 1
            
            if response.status_code == 200:
                result = response.json()
                ai_response = result['choices'][0]['message']['content']
                
                # Clean and parse JSON
                clean_response = ai_response.strip()
                if clean_response.startswith('```json'):
                    clean_response = clean_response[7:]
                if clean_response.endswith('```'):
                    clean_response = clean_response[:-3]
                clean_response = clean_response.strip()
                
                return json.loads(clean_response)
            else:
                print(f"   ❌ OpenAI API Error: {response.status_code}")
                return None
                
        except Exception as e:
            print(f"   ❌ OpenAI Error: {e}")
            return None
    
    def scan_org_image_with_anthropic(self, image_url: str) -> Optional[Dict]:
        """Scan organization image using Anthropic Claude API"""
        try:
            # Download image
            img_response = requests.get(image_url, timeout=30)
            img_response.raise_for_status()
            base64_image = base64.b64encode(img_response.content).decode('utf-8')
            
            # Detect mime type
            mime_type = img_response.headers.get('content-type', 'image/jpeg')
            
            prompt = """Analyze this automotive shop/organization image and extract intelligence.

Look for:
- Equipment and tools visible
- Facility capabilities (lifts, paint booth, dyno, alignment rack, etc.)
- Work in progress
- Team members and expertise
- Business stage indicators (startup, established, professional)
- Quality and organization level

Return ONLY valid JSON:
{
  "category": "facility_interior|facility_exterior|equipment|work_in_progress|team|event|other",
  "description": "What's shown in the image",
  "tags": ["descriptive", "tags"],
  "inventory": [
    {"name": "item name", "category": "tool|equipment|part|material|vehicle", "brand": "brand", "condition": "excellent|good|fair|poor", "confidence": 0.9}
  ],
  "capabilities": ["lift", "paint_booth", "fabrication", "etc"],
  "business_stage": "startup|growing|established|professional",
  "confidence": 0.85
}"""
            
            headers = {
                "x-api-key": self.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
            
            payload = {
                "model": "claude-3-5-sonnet-20241022",
                "max_tokens": 1000,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image", "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": base64_image
                        }}
                    ]
                }]
            }
            
            response = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
                timeout=60
            )
            
            self.stats['api_calls']['anthropic'] += 1
            
            if response.status_code == 200:
                result = response.json()
                ai_response = result['content'][0]['text']
                
                # Clean and parse JSON
                clean_response = ai_response.strip()
                if clean_response.startswith('```json'):
                    clean_response = clean_response[7:]
                if clean_response.endswith('```'):
                    clean_response = clean_response[:-3]
                clean_response = clean_response.strip()
                
                return json.loads(clean_response)
            else:
                print(f"   ❌ Anthropic API Error: {response.status_code}")
                return None
                
        except Exception as e:
            print(f"   ❌ Anthropic Error: {e}")
            return None
    
    def update_vehicle_image(self, image_id: str, analysis: Dict) -> bool:
        """Update vehicle_images table with scan results"""
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            # Extract data from analysis
            components = analysis.get('components', [])
            tags = analysis.get('tags', [])
            description = analysis.get('description', '')
            is_document = analysis.get('is_document', False)
            document_type = analysis.get('document_type')
            confidence = analysis.get('overall_confidence', 0)
            
            # Build metadata
            metadata = {
                'scan_timestamp': datetime.utcnow().isoformat(),
                'model': 'gpt-4o',
                'components_found': len(components),
                'tags': tags,
                'description': description,
                'raw_analysis': analysis
            }
            
            # Update query
            cursor.execute("""
                UPDATE vehicle_images
                SET 
                    ai_scan_metadata = %s::jsonb,
                    ai_last_scanned = NOW(),
                    ai_component_count = %s,
                    ai_avg_confidence = %s,
                    is_document = %s,
                    document_category = %s
                WHERE id = %s
            """, (
                json.dumps(metadata),
                len(components),
                confidence,
                is_document,
                document_type,
                image_id
            ))
            
            conn.commit()
            cursor.close()
            conn.close()
            return True
            
        except Exception as e:
            print(f"   ❌ Database update error: {e}")
            return False
    
    def update_org_image(self, image_id: str, analysis: Dict) -> bool:
        """Update organization_images table with scan results"""
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            
            # Extract data
            category = analysis.get('category', 'other')
            description = analysis.get('description', '')
            tags = analysis.get('tags', [])
            inventory = analysis.get('inventory', [])
            capabilities = analysis.get('capabilities', [])
            confidence = analysis.get('confidence', 0)
            
            # Build full analysis
            full_analysis = {
                'scan_timestamp': datetime.utcnow().isoformat(),
                'model': 'claude-3-5-sonnet',
                'description': description,
                'business_stage': analysis.get('business_stage'),
                'capabilities': capabilities,
                'inventory_count': len(inventory),
                'raw_analysis': analysis
            }
            
            # Update query
            cursor.execute("""
                UPDATE organization_images
                SET 
                    ai_analysis = %s::jsonb,
                    category = %s,
                    ai_tags = %s,
                    ai_description = %s,
                    ai_confidence = %s,
                    ai_scanned = true,
                    ai_scan_date = NOW(),
                    processed_at = NOW()
                WHERE id = %s
            """, (
                json.dumps(full_analysis),
                category,
                tags,
                description,
                confidence,
                image_id
            ))
            
            conn.commit()
            cursor.close()
            conn.close()
            return True
            
        except Exception as e:
            print(f"   ❌ Database update error: {e}")
            return False
    
    def scan_vehicle_images(self, batch_size: int = 50, max_images: Optional[int] = None):
        """Scan all unscanned vehicle images"""
        print("\n" + "=" * 80)
        print("🚗 SCANNING VEHICLE IMAGES")
        print("=" * 80)
        
        images = self.get_unscanned_vehicle_images(limit=max_images)
        total = len(images)
        
        print(f"Found {total} unscanned vehicle images")
        
        if total == 0:
            print("✅ All vehicle images already scanned!")
            return
        
        for idx, image in enumerate(images, 1):
            print(f"\n[{idx}/{total}] Vehicle Image: {image['id'][:8]}...")
            print(f"   URL: {image['image_url'][:60]}...")
            
            # Scan with OpenAI
            analysis = self.scan_vehicle_image_with_openai(image['image_url'])
            
            if analysis:
                # Save to database
                if self.update_vehicle_image(image['id'], analysis):
                    self.stats['vehicle_images']['scanned'] += 1
                    components = len(analysis.get('components', []))
                    print(f"   ✅ Scanned! Found {components} components")
                else:
                    self.stats['vehicle_images']['failed'] += 1
                    print(f"   ❌ Failed to save results")
            else:
                self.stats['vehicle_images']['failed'] += 1
                error_msg = f"Failed to scan vehicle image {image['id']}"
                self.stats['errors'].append(error_msg)
                print(f"   ❌ Scan failed")
            
            # Rate limiting
            if idx % batch_size == 0:
                print(f"\n   💤 Batch complete ({idx}/{total}). Sleeping 5s...")
                time.sleep(5)
            else:
                time.sleep(1)
            
            # Progress update every 10 images
            if idx % 10 == 0:
                self.print_progress_summary()
    
    def scan_org_images(self, batch_size: int = 50, max_images: Optional[int] = None):
        """Scan all unscanned organization images"""
        print("\n" + "=" * 80)
        print("🏢 SCANNING ORGANIZATION IMAGES")
        print("=" * 80)
        
        images = self.get_unscanned_org_images(limit=max_images)
        total = len(images)
        
        print(f"Found {total} unscanned organization images")
        
        if total == 0:
            print("✅ All organization images already scanned!")
            return
        
        for idx, image in enumerate(images, 1):
            print(f"\n[{idx}/{total}] Org Image: {image['id'][:8]}...")
            print(f"   URL: {image['image_url'][:60]}...")
            
            # Scan with Anthropic (better for business context)
            analysis = self.scan_org_image_with_anthropic(image['image_url'])
            
            if analysis:
                # Save to database
                if self.update_org_image(image['id'], analysis):
                    self.stats['org_images']['scanned'] += 1
                    inventory = len(analysis.get('inventory', []))
                    print(f"   ✅ Scanned! Found {inventory} inventory items")
                else:
                    self.stats['org_images']['failed'] += 1
                    print(f"   ❌ Failed to save results")
            else:
                self.stats['org_images']['failed'] += 1
                error_msg = f"Failed to scan org image {image['id']}"
                self.stats['errors'].append(error_msg)
                print(f"   ❌ Scan failed")
            
            # Rate limiting
            if idx % batch_size == 0:
                print(f"\n   💤 Batch complete ({idx}/{total}). Sleeping 5s...")
                time.sleep(5)
            else:
                time.sleep(1)
            
            # Progress update every 10 images
            if idx % 10 == 0:
                self.print_progress_summary()
    
    def print_progress_summary(self):
        """Print current progress"""
        elapsed = time.time() - self.stats['start_time']
        elapsed_mins = elapsed / 60
        
        total_scanned = self.stats['vehicle_images']['scanned'] + self.stats['org_images']['scanned']
        total_failed = self.stats['vehicle_images']['failed'] + self.stats['org_images']['failed']
        
        print(f"\n   📊 Progress Update:")
        print(f"      Time elapsed: {elapsed_mins:.1f} minutes")
        print(f"      Vehicle images: {self.stats['vehicle_images']['scanned']} scanned, {self.stats['vehicle_images']['failed']} failed")
        print(f"      Org images: {self.stats['org_images']['scanned']} scanned, {self.stats['org_images']['failed']} failed")
        print(f"      Total: {total_scanned} scanned, {total_failed} failed")
        print(f"      API calls: OpenAI={self.stats['api_calls']['openai']}, Anthropic={self.stats['api_calls']['anthropic']}")
    
    def print_final_summary(self):
        """Print final summary"""
        elapsed = time.time() - self.stats['start_time']
        elapsed_mins = elapsed / 60
        
        total_scanned = self.stats['vehicle_images']['scanned'] + self.stats['org_images']['scanned']
        total_failed = self.stats['vehicle_images']['failed'] + self.stats['org_images']['failed']
        
        print("\n" + "=" * 80)
        print("🏁 FINAL SCAN SUMMARY")
        print("=" * 80)
        print(f"⏱️  Total time: {elapsed_mins:.1f} minutes ({elapsed/3600:.2f} hours)")
        print(f"\n📸 Vehicle Images:")
        print(f"   ✅ Scanned: {self.stats['vehicle_images']['scanned']}")
        print(f"   ❌ Failed: {self.stats['vehicle_images']['failed']}")
        print(f"\n🏢 Organization Images:")
        print(f"   ✅ Scanned: {self.stats['org_images']['scanned']}")
        print(f"   ❌ Failed: {self.stats['org_images']['failed']}")
        print(f"\n🤖 API Usage:")
        print(f"   OpenAI calls: {self.stats['api_calls']['openai']}")
        print(f"   Anthropic calls: {self.stats['api_calls']['anthropic']}")
        print(f"\n📊 Overall:")
        print(f"   Total processed: {total_scanned + total_failed}")
        print(f"   Success rate: {(total_scanned/(total_scanned + total_failed)*100) if (total_scanned + total_failed) > 0 else 0:.1f}%")
        
        if self.stats['errors']:
            print(f"\n❌ Errors ({len(self.stats['errors'])}):")
            for error in self.stats['errors'][:10]:  # Show first 10 errors
                print(f"   - {error}")
        
        print("=" * 80)
    
    def run_full_scan(self, test_mode: bool = False):
        """Run complete scan of all images"""
        self.stats['start_time'] = time.time()
        
        print("\n" + "=" * 80)
        print("🚀 STARTING COMPREHENSIVE IMAGE SCAN")
        print("=" * 80)
        print(f"Mode: {'TEST (10 images per type)' if test_mode else 'FULL SCAN'}")
        print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)
        
        max_images = 10 if test_mode else None
        
        # Scan vehicle images with OpenAI
        self.scan_vehicle_images(max_images=max_images)
        
        # Scan organization images with Anthropic
        self.scan_org_images(max_images=max_images)
        
        # Print final summary
        self.print_final_summary()


def main():
    import sys
    
    # Check for test mode
    test_mode = '--test' in sys.argv or '-t' in sys.argv
    
    scanner = DatabaseImageScanner()
    scanner.run_full_scan(test_mode=test_mode)


if __name__ == "__main__":
    main()

