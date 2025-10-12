#!/usr/bin/env python3
"""
AI-Powered Image Scanner for 77 Blazer Build Components
Uses OpenAI Vision API to scan images and identify automotive parts
"""

import os
import json
import time
import requests
from typing import List, Dict, Tuple, Optional
import base64
from dataclasses import dataclass
from enum import Enum

class Quadrant(Enum):
    TOP_LEFT = "top_left"
    TOP_RIGHT = "top_right"
    BOTTOM_LEFT = "bottom_left"
    BOTTOM_RIGHT = "bottom_right"
    CENTER = "center"
    FULL_IMAGE = "full_image"

@dataclass
class ComponentDetection:
    component_name: str
    confidence: float  # 0-1
    quadrant: Quadrant
    reasoning: str

@dataclass
class ImageScanResult:
    image_id: str
    image_url: str
    detections: List[ComponentDetection]
    scan_timestamp: str
    total_components_found: int

class BlazierImageScanner:
    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable required")

        # Define the 77 Blazer build components to scan for
        self.build_components = [
            # Engine Components
            "LS3 engine block", "intake manifold", "spark plugs", "ignition coils",
            "throttle body", "radiator", "oil cooler", "starter", "alternator",
            "flexplate", "fuel rails", "pulley system", "radiator hoses",
            "Motec ECU wiring", "engine bay wiring",

            # Transmission & Drivetrain
            "6L90 transmission", "torque converter", "transmission cooler",
            "transfer case", "driveshaft", "differential", "axle housing",

            # Suspension & Steering
            "lift kit components", "shocks/struts", "springs", "sway bar",
            "steering box", "steering linkage", "ball joints", "shackles",

            # Wheels & Tires
            "wheels/rims", "tires", "brake rotors", "brake calipers",
            "brake lines", "brake booster", "brake pads",

            # Body Work
            "body panels", "paint work", "rust repair", "rocker panels",
            "bumpers", "doors", "hood", "windshield", "mirrors",
            "body mounts", "trim pieces",

            # Interior
            "dashboard", "seats", "seat belts", "carpet", "center console",
            "door panels", "headliner", "interior trim", "upholstery work",

            # Electrical
            "wiring harness", "LED lights", "electrical components",
            "fuse box", "battery", "electrical connections",

            # Exhaust & Fuel
            "exhaust system", "muffler", "exhaust pipes", "fuel tank",
            "fuel lines", "fuel pump", "fuel filler",

            # AC/Climate
            "AC compressor", "AC condenser", "AC lines", "heater core",

            # Tools & Work in Progress
            "disassembly work", "parts on workbench", "tools",
            "assembly in progress", "paint booth", "welding work"
        ]

    def encode_image(self, image_path: str) -> str:
        """Encode image to base64 for API"""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    def create_scanning_prompt(self, components_subset: List[str]) -> str:
        """Create a systematic prompt for component detection"""
        components_list = "\n".join([f"- {comp}" for comp in components_subset])

        return f"""You are an expert automotive technician analyzing a 1977 Chevrolet K5 Blazer restoration project image.

TASK: Scan this image and identify any of these specific build components:
{components_list}

For each component you can clearly identify, provide:
1. Component name (exact match from list)
2. Confidence level (0.1-1.0, where 1.0 is absolutely certain)
3. Location quadrant (top_left, top_right, bottom_left, bottom_right, center, or full_image)
4. Brief reasoning (what visual cues confirm this component)

IMPORTANT GUIDELINES:
- Only identify components you can clearly see and are confident about
- Don't guess or assume - if you can't clearly see it, don't include it
- Consider partial views, close-ups, and components in various stages of assembly/disassembly
- Look for both installed components and parts laying on workbenches/floor
- Consider painted/unpainted, new/used, assembled/disassembled states

Respond in this exact JSON format:
{{
  "detections": [
    {{
      "component_name": "exact component name from list",
      "confidence": 0.8,
      "quadrant": "top_left",
      "reasoning": "Clear view of component with distinctive features"
    }}
  ],
  "total_found": 0
}}"""

    def scan_image_with_openai(self, image_path: str, components_subset: List[str]) -> Dict:
        """Scan a single image using OpenAI Vision API"""
        try:
            base64_image = self.encode_image(image_path)

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.openai_api_key}"
            }

            payload = {
                "model": "gpt-4o",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": self.create_scanning_prompt(components_subset)
                            },
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
                "max_tokens": 1000,
                "temperature": 0.1  # Low temperature for consistent results
            }

            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                content = result['choices'][0]['message']['content']

                # Parse JSON response
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    print(f"Failed to parse JSON response for {image_path}")
                    return {"detections": [], "total_found": 0}
            else:
                print(f"API error for {image_path}: {response.status_code}")
                return {"detections": [], "total_found": 0}

        except Exception as e:
            print(f"Error scanning {image_path}: {str(e)}")
            return {"detections": [], "total_found": 0}

    def batch_scan_images(self, image_paths: List[str], batch_size: int = 20) -> List[ImageScanResult]:
        """Scan multiple images in batches to avoid rate limits"""
        results = []
        total_images = len(image_paths)

        # Split components into smaller subsets for more focused scanning
        component_batches = [
            self.build_components[i:i+15] for i in range(0, len(self.build_components), 15)
        ]

        print(f"Starting batch scan of {total_images} images...")
        print(f"Component batches: {len(component_batches)}")

        for i, image_path in enumerate(image_paths):
            print(f"Scanning image {i+1}/{total_images}: {os.path.basename(image_path)}")

            all_detections = []

            # Scan with each component batch
            for batch_idx, components_subset in enumerate(component_batches):
                print(f"  Component batch {batch_idx+1}/{len(component_batches)}")

                scan_result = self.scan_image_with_openai(image_path, components_subset)

                if scan_result.get('detections'):
                    all_detections.extend(scan_result['detections'])

                # Rate limiting - pause between API calls
                time.sleep(1)

            # Create final result
            result = ImageScanResult(
                image_id=os.path.basename(image_path),
                image_url=image_path,
                detections=[ComponentDetection(**det) for det in all_detections],
                scan_timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
                total_components_found=len(all_detections)
            )

            results.append(result)

            print(f"  Found {result.total_components_found} components")

            # Pause between images to respect rate limits
            if i < total_images - 1:
                time.sleep(2)

        return results

    def save_scan_results(self, results: List[ImageScanResult], output_file: str):
        """Save scan results to JSON file"""
        serializable_results = []
        for result in results:
            serializable_results.append({
                'image_id': result.image_id,
                'image_url': result.image_url,
                'detections': [
                    {
                        'component_name': det.component_name,
                        'confidence': det.confidence,
                        'quadrant': det.quadrant.value,
                        'reasoning': det.reasoning
                    } for det in result.detections
                ],
                'scan_timestamp': result.scan_timestamp,
                'total_components_found': result.total_components_found
            })

        with open(output_file, 'w') as f:
            json.dump(serializable_results, f, indent=2)

        print(f"Scan results saved to {output_file}")

if __name__ == "__main__":
    scanner = BlazierImageScanner()

    # Test with a small batch first
    test_images = [
        # Add actual image paths here
        "/path/to/test/image1.jpg",
        "/path/to/test/image2.jpg"
    ]

    # Uncomment to run test
    # results = scanner.batch_scan_images(test_images)
    # scanner.save_scan_results(results, "blazer_scan_results.json")

    print("Image scanner system ready!")
    print("Next steps:")
    print("1. Set OPENAI_API_KEY environment variable")
    print("2. Provide list of image paths to scan")
    print("3. Run batch_scan_images() method")
    print("4. Results will include component detection with spatial quadrants")