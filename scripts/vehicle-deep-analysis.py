#!/Users/skylar/nuke/yono/.venv/bin/python3
"""
vehicle-deep-analysis.py

Complete vehicle image analysis pipeline.
Processes photos from Apple Photos library through YONO + Florence-2,
produces a per-zone condition report with coverage map.

Modes:
  Local-only (free):  Uses YONO zone classifier + Florence-2 vision heads
  Hybrid (--cloud):   YONO zones + Claude Haiku vision for arboreal damage/mod taxonomy

Usage:
  /Users/skylar/nuke/yono/.venv/bin/python3 scripts/vehicle-deep-analysis.py --album "1977 K5 Chevrolet Blazer" --sample 50
  /Users/skylar/nuke/yono/.venv/bin/python3 scripts/vehicle-deep-analysis.py --album "1968 Porsche 911" --sample 30 --cloud
  /Users/skylar/nuke/yono/.venv/bin/python3 scripts/vehicle-deep-analysis.py --album "1972 K10 Chevrolet SWB" --sample 20 --cloud --cloud-sample 2
"""

import argparse
import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from safetensors.torch import load_file

# Paths
NUKE_DIR = Path("/Users/skylar/nuke")
YONO_DIR = NUKE_DIR / "yono"
MODELS_DIR = YONO_DIR / "models"

sys.path.insert(0, str(NUKE_DIR))
from yono.yono import YONOClassifier, HierarchicalYONO, _preprocess, _softmax

# ---------------------------------------------------------------------------
# Zone classifier (Florence-2 based)
# ---------------------------------------------------------------------------

class ZoneClassifier:
    """
    Zone head architecture (from safetensors):
      net.0 = LayerNorm(768)
      net.1 = Linear(768 → 512)
      net.4 = Linear(512 → 256)
      net.7 = Linear(256 → 41)
    """
    def __init__(self):
        from transformers import AutoProcessor, AutoModelForCausalLM

        config_path = MODELS_DIR / "yono_zone_config.json"
        head_path = MODELS_DIR / "yono_zone_head.safetensors"

        with open(config_path) as f:
            self.config = json.load(f)

        self.zone_codes = self.config["zone_codes"]
        self.n_zones = self.config["n_zones"]
        hidden_size = self.config["hidden_size"]  # 768

        # Load Florence-2 base for feature extraction
        print("  Loading Florence-2 base model...")
        self.processor = AutoProcessor.from_pretrained(
            "microsoft/Florence-2-base", trust_remote_code=True
        )
        self.base_model = AutoModelForCausalLM.from_pretrained(
            "microsoft/Florence-2-base", trust_remote_code=True
        )
        self.base_model.eval()

        # Build zone MLP matching the trained architecture
        print("  Loading zone classification head...")
        self.zone_head = torch.nn.Sequential(
            torch.nn.LayerNorm(768),     # net.0
            torch.nn.Linear(768, 512),   # net.1
            torch.nn.GELU(),             # net.2 (assumed)
            torch.nn.Dropout(0.1),       # net.3
            torch.nn.Linear(512, 256),   # net.4
            torch.nn.GELU(),             # net.5
            torch.nn.Dropout(0.1),       # net.6
            torch.nn.Linear(256, 41),    # net.7
        )
        state = load_file(str(head_path))
        # Keys are prefixed with "net." — strip to match Sequential indices
        mapped = {k.replace("net.", ""): v for k, v in state.items()}
        self.zone_head.load_state_dict(mapped)
        self.zone_head.eval()

        print(f"  Zone classifier ready: {self.n_zones} zones, {self.config.get('best_val_acc', 0):.1%} val acc")

    def get_features(self, image_path: str) -> torch.Tensor:
        """Extract Florence-2 image features. Returns (1, 768) pooled tensor."""
        img = Image.open(image_path).convert("RGB")
        inputs = self.processor(text="<OD>", images=img, return_tensors="pt")
        with torch.no_grad():
            # _encode_image returns (1, N_tokens, 768)
            features = self.base_model._encode_image(inputs["pixel_values"])
            # Global average pool to (1, 768)
            pooled = features.mean(dim=1)
        return pooled

    def predict(self, image_path: str, features: torch.Tensor = None) -> dict:
        if features is None:
            features = self.get_features(image_path)

        with torch.no_grad():
            logits = self.zone_head(features)
            probs = torch.softmax(logits, dim=-1)[0]

        top_idx = probs.argmax().item()
        top_conf = probs[top_idx].item()

        top3_indices = probs.argsort(descending=True)[:3]
        top3 = [(self.zone_codes[i.item()], probs[i].item()) for i in top3_indices]

        return {
            "zone": self.zone_codes[top_idx],
            "confidence": top_conf,
            "top3": top3,
        }


# ---------------------------------------------------------------------------
# Vision analyzer (condition/damage/modifications)
# ---------------------------------------------------------------------------

class VisionAnalyzer:
    """
    Vision head architecture (from safetensors):
      bottleneck.0 = LayerNorm(768)
      bottleneck.1 = Linear(768 → 512)
      condition_head = Linear(512 → 5)
      damage_head = Linear(512 → 7)
      mod_head = Linear(512 → 8)
      photo_quality_head = Linear(512 → 5)
      photo_type_head = Linear(512 → 9)
      interior_quality_head = Linear(512 → 5)
    """
    def __init__(self):
        config_path = MODELS_DIR / "yono_vision_v2_config.json"
        head_path = MODELS_DIR / "yono_vision_v2_head.safetensors"

        with open(config_path) as f:
            self.config = json.load(f)

        self.damage_flags = self.config["damage_flags"]
        self.mod_flags = self.config["mod_flags"]

        # Bottleneck: LayerNorm(768) → Linear(768 → 512)
        self.bottleneck = torch.nn.Sequential(
            torch.nn.LayerNorm(768),
            torch.nn.Linear(768, 512),
            torch.nn.GELU(),
        )

        # Per-task heads (all from 512-dim bottleneck output)
        self.condition_head = torch.nn.Linear(512, 5)
        self.damage_head = torch.nn.Linear(512, 7)
        self.mod_head = torch.nn.Linear(512, 8)
        self.quality_head = torch.nn.Linear(512, 5)
        self.photo_type_head = torch.nn.Linear(512, 9)
        self.interior_quality_head = torch.nn.Linear(512, 5)

        # Load weights
        state = load_file(str(head_path))

        bn_state = {k.replace("bottleneck.", ""): v for k, v in state.items() if k.startswith("bottleneck.")}
        self.bottleneck.load_state_dict(bn_state)

        cond_state = {k.replace("condition_head.", ""): v for k, v in state.items() if k.startswith("condition_head.")}
        self.condition_head.load_state_dict(cond_state)

        damage_state = {k.replace("damage_head.", ""): v for k, v in state.items() if k.startswith("damage_head.")}
        self.damage_head.load_state_dict(damage_state)

        mod_state = {k.replace("mod_head.", ""): v for k, v in state.items() if k.startswith("mod_head.")}
        self.mod_head.load_state_dict(mod_state)

        quality_state = {k.replace("photo_quality_head.", ""): v for k, v in state.items() if k.startswith("photo_quality_head.")}
        self.quality_head.load_state_dict(quality_state)

        pt_state = {k.replace("photo_type_head.", ""): v for k, v in state.items() if k.startswith("photo_type_head.")}
        self.photo_type_head.load_state_dict(pt_state)

        iq_state = {k.replace("interior_quality_head.", ""): v for k, v in state.items() if k.startswith("interior_quality_head.")}
        self.interior_quality_head.load_state_dict(iq_state)

        for m in [self.bottleneck, self.condition_head, self.damage_head, self.mod_head,
                  self.quality_head, self.photo_type_head, self.interior_quality_head]:
            m.eval()

        print(f"  Vision analyzer ready: condition + {len(self.damage_flags)} damage + {len(self.mod_flags)} mod flags + photo_type + interior_quality")

    def predict(self, features: torch.Tensor) -> dict:
        with torch.no_grad():
            # Bottleneck: 768 → 512
            h = self.bottleneck(features)

            # Condition score (1-5)
            cond_logits = self.condition_head(h)
            cond_probs = torch.softmax(cond_logits, dim=-1)[0]
            cond_score = cond_probs.argmax().item() + 1
            cond_confidence = cond_probs[cond_score - 1].item()

            # Damage flags (multi-label, sigmoid)
            damage_logits = self.damage_head(h)
            damage_probs = torch.sigmoid(damage_logits)[0]
            detected_damage = [
                (self.damage_flags[i], damage_probs[i].item())
                for i in range(len(self.damage_flags))
                if damage_probs[i].item() > 0.3
            ]

            # Modification flags (multi-label, sigmoid)
            mod_logits = self.mod_head(h)
            mod_probs = torch.sigmoid(mod_logits)[0]
            detected_mods = [
                (self.mod_flags[i], mod_probs[i].item())
                for i in range(len(self.mod_flags))
                if mod_probs[i].item() > 0.3
            ]

            # Photo quality (1-5)
            quality_logits = self.quality_head(h)
            quality_probs = torch.softmax(quality_logits, dim=-1)[0]
            quality_score = quality_probs.argmax().item() + 1

        return {
            "condition_score": cond_score,
            "condition_confidence": cond_confidence,
            "damage": detected_damage,
            "modifications": detected_mods,
            "photo_quality": quality_score,
            "damage_probs": {f: damage_probs[i].item() for i, f in enumerate(self.damage_flags)},
            "mod_probs": {f: mod_probs[i].item() for i, f in enumerate(self.mod_flags)},
        }


# ---------------------------------------------------------------------------
# Cloud Vision Analyzer (Claude Haiku — arboreal taxonomy)
# ---------------------------------------------------------------------------

# The full arboreal taxonomy for damage and modifications
DAMAGE_TAXONOMY = {
    "structural": ["rust", "dent", "crack", "collision_damage"],
    "surface": ["paint_fade", "paint_chip", "scratch", "clear_coat_failure", "staining"],
    "missing_broken": ["broken_glass", "missing_trim", "missing_emblem", "broken_light", "missing_parts"],
    "wear": ["tire_wear", "seat_wear", "carpet_wear", "steering_wheel_wear"],
    "mechanical_visible": ["fluid_leak", "belt_wear", "hose_deterioration", "exhaust_damage"],
}

MODIFICATION_TAXONOMY = {
    "suspension": ["lift_kit", "lowered", "aftermarket_shocks"],
    "wheels_tires": ["aftermarket_wheels", "oversized_tires", "wheel_spacers"],
    "engine": ["engine_swap", "aftermarket_intake", "aftermarket_exhaust", "turbo_supercharger"],
    "body": ["body_kit", "widebody", "roll_cage", "brush_guard", "fender_flares"],
    "interior": ["custom_seats", "aftermarket_stereo", "aftermarket_gauges", "custom_steering_wheel"],
    "electrical": ["aftermarket_lights", "winch", "auxiliary_switches"],
}

ALL_DAMAGE_FLAGS = [flag for flags in DAMAGE_TAXONOMY.values() for flag in flags]
ALL_MOD_FLAGS = [flag for flags in MODIFICATION_TAXONOMY.values() for flag in flags]

# Zone-specific analysis focus hints
ZONE_ANALYSIS_HINTS = {
    "ext_front": "Focus on bumper/grille/headlight condition, front-end collision damage, chrome/trim condition",
    "ext_front_driver": "Check fender, A-pillar, door alignment, paint match across panels",
    "ext_front_passenger": "Check fender, A-pillar, door alignment, paint match across panels",
    "ext_driver_side": "Full profile - check rocker panels for rust, door dings, body line straightness, trim",
    "ext_passenger_side": "Full profile - check rocker panels for rust, door dings, body line straightness, trim",
    "ext_rear": "Bumper, taillights, trunk/tailgate alignment, exhaust tips, rear collision damage",
    "ext_rear_driver": "Quarter panel condition (common rust area), rear bumper corner, tail light",
    "ext_rear_passenger": "Quarter panel condition (common rust area), rear bumper corner, tail light",
    "ext_roof": "Roof condition, rain gutters, sunroof surround, rack mounts",
    "ext_undercarriage": "Frame rust, floor pan condition, exhaust routing, suspension components, fluid leaks",
    "panel_hood": "Hood hinges, hood pad, inner fender condition, any modifications visible",
    "panel_trunk": "Trunk floor, spare tire area, weatherstripping, water intrusion signs",
    "panel_fender_fl": "Fender rust (wheel well lip), paint condition, trim attachment",
    "panel_fender_fr": "Fender rust (wheel well lip), paint condition, trim attachment",
    "panel_fender_rl": "Quarter panel rust (common), wheel well rust, body filler signs",
    "panel_fender_rr": "Quarter panel rust (common), wheel well rust, body filler signs",
    "panel_door_fl": "Door skin dents, handle/lock condition, lower edge rust, weatherstrip",
    "panel_door_fr": "Door skin dents, handle/lock condition, lower edge rust, weatherstrip",
    "panel_door_rl": "Door skin dents, handle/lock condition, lower edge rust, weatherstrip",
    "panel_door_rr": "Door skin dents, handle/lock condition, lower edge rust, weatherstrip",
    "wheel_fl": "Tire tread depth/wear pattern, wheel finish, brake components visible",
    "wheel_fr": "Tire tread depth/wear pattern, wheel finish, brake components visible",
    "wheel_rl": "Tire tread depth/wear pattern, wheel finish, brake components visible",
    "wheel_rr": "Tire tread depth/wear pattern, wheel finish, brake components visible",
    "int_dashboard": "Dash cracks, gauge condition, steering wheel wear, aftermarket electronics",
    "int_front_seats": "Seat bolster wear, upholstery tears, seat adjustments, aftermarket seats",
    "int_rear_seats": "Rear seat condition, carpet, door panel condition",
    "int_cargo": "Cargo area condition, carpet/liner, spare tire, tool kit",
    "int_headliner": "Headliner sag, staining, sunroof leaks",
    "mech_engine_bay": "Engine type/swap, aftermarket intake/exhaust, fluid leaks, hose condition, wiring",
    "mech_transmission": "Transmission type, leaks, crossmember condition, shift linkage",
    "mech_suspension": "Shock type (stock/aftermarket), spring type, lift/lowering, bushings",
    "detail_vin": "VIN plate legibility, signs of tampering",
    "detail_badge": "Badge/emblem condition, trim level identification",
    "detail_damage": "Specific damage detail - describe exactly what damage is shown",
    "detail_odometer": "Mileage reading, warning lights, gauge condition",
}


class CloudVisionAnalyzer:
    """Uses Claude Haiku vision for comprehensive arboreal damage/modification analysis."""

    def __init__(self, vehicle_context: str = ""):
        import anthropic
        # Load API key from dotenvx environment
        api_key = os.environ.get("NUKE_CLAUDE_API") or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY")
        if not api_key or not api_key.startswith("sk-ant-"):
            raise RuntimeError("NUKE_CLAUDE_API or ANTHROPIC_API_KEY must be set (sk-ant-*). Run with: dotenvx run -- python3 ...")
        self.client = anthropic.Anthropic(api_key=api_key)
        self.vehicle_context = vehicle_context
        self.model = "claude-haiku-4-5-20251001"
        self.call_count = 0
        self.total_cost = 0.0
        print(f"  Cloud vision analyzer ready (model: {self.model})")

    def analyze(self, image_path: str, zone: str = "unknown", zone_confidence: float = 0.0) -> dict:
        """Send image to Claude Haiku for arboreal analysis. Returns structured findings."""
        # Encode image as base64
        b64 = image_to_base64_thumbnail(image_path, max_width=800)
        if not b64:
            return {"error": "Could not encode image"}

        # Extract the raw base64 data and media type
        # Format: data:image/jpeg;base64,xxxxx
        media_type = "image/jpeg"
        b64_data = b64.split(",", 1)[1] if "," in b64 else b64

        zone_hint = ZONE_ANALYSIS_HINTS.get(zone, "Analyze what you see in detail.")

        prompt = f"""Analyze this vehicle image. Report ONLY what you can clearly see — do not guess or speculate.

Vehicle: {self.vehicle_context}
Image zone: {zone} (confidence: {zone_confidence:.0%})
Zone focus: {zone_hint}

Return a JSON object with these fields:

{{
  "condition_score": <1-5 integer, 1=parts car, 2=rough, 3=driver quality, 4=good, 5=excellent>,
  "condition_notes": "<brief description of overall visible condition>",
  "damage": [
    {{
      "type": "<damage type from list below>",
      "severity": <1-5, 1=minor/cosmetic, 3=significant, 5=critical/structural>,
      "subtype": "<specific subtype if applicable, e.g. 'bubbling' for rust, 'crease' for dent>",
      "location": "<where on this zone, e.g. 'lower edge', 'wheel well lip', 'center'>",
      "description": "<brief description of what you see>"
    }}
  ],
  "modifications": [
    {{
      "type": "<modification type from list below>",
      "description": "<what specifically, e.g. 'American Racing AR-23 wheels' or '4-inch suspension lift'>",
      "confidence": <0.0-1.0>
    }}
  ],
  "photo_quality": <1-5, 1=unusable, 3=acceptable, 5=professional>
}}

DAMAGE TYPES: rust, dent, crack, collision_damage, paint_fade, paint_chip, scratch, clear_coat_failure, staining, broken_glass, missing_trim, missing_emblem, broken_light, missing_parts, tire_wear, seat_wear, carpet_wear, steering_wheel_wear, fluid_leak, belt_wear, hose_deterioration, exhaust_damage

MODIFICATION TYPES: lift_kit, lowered, aftermarket_shocks, aftermarket_wheels, oversized_tires, wheel_spacers, engine_swap, aftermarket_intake, aftermarket_exhaust, turbo_supercharger, body_kit, widebody, roll_cage, brush_guard, fender_flares, custom_seats, aftermarket_stereo, aftermarket_gauges, custom_steering_wheel, aftermarket_lights, winch, auxiliary_switches

If the image is not of a vehicle or is too blurry to analyze, return {{"condition_score": null, "damage": [], "modifications": [], "photo_quality": 1, "condition_notes": "not analyzable"}}.

Return ONLY the JSON object, no other text."""

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64_data,
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        }
                    ]
                }]
            )

            self.call_count += 1
            # Estimate cost: ~$0.001 input + ~$0.002 output for Haiku with image
            self.total_cost += 0.003

            # Parse JSON from response
            text = response.content[0].text.strip()
            # Handle markdown code blocks
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            result = json.loads(text)
            return result

        except json.JSONDecodeError as e:
            return {"error": f"JSON parse error: {e}", "raw": text[:200]}
        except Exception as e:
            return {"error": f"API error: {e}"}


# ---------------------------------------------------------------------------
# Full analysis pipeline
# ---------------------------------------------------------------------------

class VehicleAnalyzer:
    def __init__(self, cloud_mode: bool = False, cloud_sample: int = 1, vehicle_context: str = ""):
        print("Loading YONO models...")
        self.make_clf = HierarchicalYONO()
        print(f"  Make classifier: {self.make_clf}")

        print("Loading zone classifier...")
        self.zone_clf = ZoneClassifier()

        print("Loading vision analyzer...")
        self.vision = VisionAnalyzer()

        self.cloud_mode = cloud_mode
        self.cloud_sample = max(1, cloud_sample)
        self.cloud_analyzer = None
        self._image_counter = 0

        if cloud_mode:
            print("Loading cloud vision analyzer...")
            self.cloud_analyzer = CloudVisionAnalyzer(vehicle_context=vehicle_context)

        print("All models loaded.\n")

    def analyze_image(self, image_path: str, metadata: dict = None) -> dict:
        """Full analysis of a single image."""
        path = Path(image_path)

        # Handle HEIC conversion
        actual_path = image_path
        if path.suffix.lower() == ".heic":
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tmp.close()
            subprocess.run(
                ["sips", "-s", "format", "jpeg", "-Z", "1024", str(path), "--out", tmp.name],
                capture_output=True, check=True, timeout=30
            )
            actual_path = tmp.name

        result = {
            "file": path.name,
            "path": str(path),
        }

        # Add metadata
        if metadata:
            result["latitude"] = metadata.get("latitude")
            result["longitude"] = metadata.get("longitude")
            result["taken_at"] = metadata.get("date")
            result["device"] = metadata.get("camera_model")

        try:
            # 1. Make classification (ONNX, 4ms)
            make_result = self.make_clf.predict(actual_path)
            result["make_prediction"] = make_result["make"]
            result["make_confidence"] = make_result["confidence"]
            result["make_family"] = make_result.get("family")
            result["is_vehicle"] = make_result["is_vehicle"]

            # 2. Extract Florence-2 features once (shared by zone + vision heads)
            features = self.zone_clf.get_features(actual_path)

            # 3. Zone classification
            zone_result = self.zone_clf.predict(actual_path, features=features)
            result["zone"] = zone_result["zone"]
            result["zone_confidence"] = zone_result["confidence"]
            result["zone_top3"] = zone_result["top3"]

            # 4. Condition/damage/modification analysis (reuses same features)
            vision_result = self.vision.predict(features)
            result["condition_score"] = vision_result["condition_score"]
            result["condition_confidence"] = vision_result["condition_confidence"]
            result["photo_quality"] = vision_result["photo_quality"]
            result["damage_detected"] = vision_result["damage"]
            result["modifications_detected"] = vision_result["modifications"]
            result["damage_probs"] = vision_result["damage_probs"]
            result["mod_probs"] = vision_result["mod_probs"]

            # 5. Cloud vision analysis (arboreal taxonomy)
            self._image_counter += 1
            send_to_cloud = (self._image_counter % self.cloud_sample == 0) if self.cloud_sample > 1 else True
            if (self.cloud_analyzer and send_to_cloud):
                cloud_result = self.cloud_analyzer.analyze(
                    image_path,  # Use original path (cloud handler does its own encoding)
                    zone=zone_result["zone"],
                    zone_confidence=zone_result["confidence"],
                )
                if "error" not in cloud_result:
                    result["cloud_analysis"] = cloud_result
                    # Override condition score with cloud assessment (more accurate)
                    if cloud_result.get("condition_score"):
                        result["condition_score"] = cloud_result["condition_score"]
                        result["condition_notes"] = cloud_result.get("condition_notes", "")
                    # Merge cloud damage findings into damage_detected
                    cloud_damage = []
                    for d in cloud_result.get("damage", []):
                        cloud_damage.append((d["type"], d.get("severity", 3) / 5.0))
                    if cloud_damage:
                        result["damage_detected"] = cloud_damage
                        result["damage_detail"] = cloud_result["damage"]
                    # Merge cloud modification findings
                    cloud_mods = []
                    for m in cloud_result.get("modifications", []):
                        cloud_mods.append((m["type"], m.get("confidence", 0.8)))
                    if cloud_mods:
                        result["modifications_detected"] = cloud_mods
                        result["modification_detail"] = cloud_result["modifications"]
                    if cloud_result.get("photo_quality"):
                        result["photo_quality"] = cloud_result["photo_quality"]
                else:
                    result["cloud_error"] = cloud_result.get("error", "unknown")

        except Exception as e:
            result["error"] = str(e)

        # Cleanup temp file
        if actual_path != image_path and Path(actual_path).exists():
            os.unlink(actual_path)

        return result

    def analyze_album(self, album_name: str, sample_size: int = 50) -> dict:
        """Analyze a full album with stratified sampling."""
        print(f"Querying photos from album: {album_name}")

        raw = subprocess.run(
            ["osxphotos", "query", "--album", album_name, "--json"],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, "PATH": os.environ.get("PATH", "")}
        ).stdout

        photos = json.loads(raw)
        print(f"  Found {len(photos)} photos in album")

        # Filter to photos with local paths
        available = [p for p in photos if p.get("path")]
        print(f"  {len(available)} available locally")

        if not available:
            return {"error": "No locally available photos"}

        # Stratified sample by date (spread across timeline)
        dated = sorted(
            [p for p in available if p.get("date")],
            key=lambda p: p["date"]
        )

        if len(dated) > sample_size:
            # Take evenly spaced samples across timeline
            step = len(dated) / sample_size
            sampled = [dated[int(i * step)] for i in range(sample_size)]
        else:
            sampled = dated if dated else available[:sample_size]

        print(f"  Analyzing {len(sampled)} stratified samples\n")

        # Analyze each photo
        results = []
        for i, photo in enumerate(sampled):
            pct = int(100 * (i + 1) / len(sampled))
            sys.stdout.write(f"\r  [{pct:3d}%] Analyzing {i+1}/{len(sampled)}: {Path(photo['path']).name[:40]:40s}")
            sys.stdout.flush()

            metadata = {
                "latitude": photo.get("latitude"),
                "longitude": photo.get("longitude"),
                "date": photo.get("date"),
                "camera_model": photo.get("camera_model"),
            }

            t0 = time.time()
            result = self.analyze_image(photo["path"], metadata)
            result["analysis_ms"] = int((time.time() - t0) * 1000)
            results.append(result)

        print(f"\n\n  Analysis complete: {len(results)} photos processed")
        if self.cloud_analyzer:
            print(f"  Cloud API calls: {self.cloud_analyzer.call_count} (~${self.cloud_analyzer.total_cost:.3f})")

        # Build aggregate report
        return self.build_report(album_name, results, len(photos))

    def build_report(self, album_name: str, results: list, total_photos: int) -> dict:
        """Build comprehensive vehicle condition report from analyzed images."""

        # Zone distribution
        zone_counts = Counter()
        zone_conditions = defaultdict(list)
        zone_damages = defaultdict(lambda: defaultdict(list))
        zone_mods = defaultdict(lambda: defaultdict(list))
        zone_images = defaultdict(list)

        condition_scores = []
        quality_scores = []
        all_damage = defaultdict(list)
        all_mods = defaultdict(list)
        # Cloud detail aggregation (severity-based)
        damage_detail_all = []  # flat list of all cloud damage findings
        mod_detail_all = []     # flat list of all cloud mod findings
        zone_worst_severity = defaultdict(int)  # zone → worst severity seen
        has_cloud = False

        for r in results:
            if "error" in r:
                continue

            zone = r.get("zone", "other")
            zone_counts[zone] += 1
            zone_images[zone].append(r)

            cs = r.get("condition_score")
            if cs:
                zone_conditions[zone].append(cs)
                condition_scores.append(cs)

            qs = r.get("photo_quality")
            if qs:
                quality_scores.append(qs)

            for dmg, conf in r.get("damage_detected", []):
                zone_damages[zone][dmg].append(conf)
                all_damage[dmg].append(conf)

            for mod, conf in r.get("modifications_detected", []):
                zone_mods[zone][mod].append(conf)
                all_mods[mod].append(conf)

            # Aggregate cloud detail findings
            for d in r.get("damage_detail", []):
                has_cloud = True
                d_copy = dict(d)
                d_copy["zone"] = zone
                d_copy["image_file"] = r.get("file", "")
                damage_detail_all.append(d_copy)
                sev = d.get("severity", 0)
                if sev > zone_worst_severity[zone]:
                    zone_worst_severity[zone] = sev

            for m in r.get("modification_detail", []):
                has_cloud = True
                m_copy = dict(m)
                m_copy["zone"] = zone
                m_copy["image_file"] = r.get("file", "")
                mod_detail_all.append(m_copy)

        # Zone coverage analysis
        all_zones = [
            "ext_front", "ext_front_driver", "ext_front_passenger",
            "ext_driver_side", "ext_passenger_side",
            "ext_rear", "ext_rear_driver", "ext_rear_passenger",
            "ext_roof", "ext_undercarriage",
            "panel_hood", "panel_trunk",
            "panel_door_fl", "panel_door_fr", "panel_door_rl", "panel_door_rr",
            "panel_fender_fl", "panel_fender_fr", "panel_fender_rl", "panel_fender_rr",
            "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr",
            "int_dashboard", "int_front_seats", "int_rear_seats", "int_cargo",
            "int_headliner",
            "mech_engine_bay", "mech_transmission", "mech_suspension",
            "detail_vin", "detail_badge", "detail_damage", "detail_odometer",
        ]

        covered_zones = [z for z in all_zones if zone_counts.get(z, 0) > 0]
        missing_zones = [z for z in all_zones if zone_counts.get(z, 0) == 0]
        coverage_pct = len(covered_zones) / len(all_zones) if all_zones else 0

        # Temporal analysis
        dates = [r["taken_at"] for r in results if r.get("taken_at")]
        date_range = None
        if dates:
            sorted_dates = sorted(dates)
            date_range = {
                "first": sorted_dates[0][:10],
                "last": sorted_dates[-1][:10],
                "span_days": (datetime.fromisoformat(sorted_dates[-1][:19]) -
                             datetime.fromisoformat(sorted_dates[0][:19])).days
            }

        # GPS analysis
        gps_points = [(r["latitude"], r["longitude"]) for r in results
                      if r.get("latitude") and r.get("longitude")]

        # Per-zone detail
        zone_details = {}
        for zone in all_zones:
            if zone_counts.get(zone, 0) == 0:
                zone_details[zone] = {"covered": False, "image_count": 0}
                continue

            conds = zone_conditions.get(zone, [])
            zone_details[zone] = {
                "covered": True,
                "image_count": zone_counts[zone],
                "avg_condition": round(sum(conds) / len(conds), 1) if conds else None,
                "min_condition": min(conds) if conds else None,
                "max_condition": max(conds) if conds else None,
                "worst_severity": zone_worst_severity.get(zone, 0),
                "damage_flags": {
                    dmg: round(sum(confs) / len(confs), 2)
                    for dmg, confs in zone_damages.get(zone, {}).items()
                },
                "modification_flags": {
                    mod: round(sum(confs) / len(confs), 2)
                    for mod, confs in zone_mods.get(zone, {}).items()
                },
            }

        return {
            "album_name": album_name,
            "total_photos_in_album": total_photos,
            "photos_analyzed": len(results),
            "errors": sum(1 for r in results if "error" in r),
            "generated_at": datetime.now().isoformat(),

            # Overall scores
            "overall_condition": round(sum(condition_scores) / len(condition_scores), 2) if condition_scores else None,
            "avg_photo_quality": round(sum(quality_scores) / len(quality_scores), 2) if quality_scores else None,

            # Coverage
            "coverage": {
                "total_zones": len(all_zones),
                "covered_zones": len(covered_zones),
                "coverage_pct": round(coverage_pct * 100, 1),
                "covered": covered_zones,
                "missing": missing_zones,
            },

            # Damage summary
            "damage_summary": {
                dmg: {
                    "occurrences": len(confs),
                    "avg_confidence": round(sum(confs) / len(confs), 2),
                    "max_confidence": round(max(confs), 2),
                }
                for dmg, confs in sorted(all_damage.items(), key=lambda x: -len(x[1]))
            },

            # Modification summary
            "modification_summary": {
                mod: {
                    "occurrences": len(confs),
                    "avg_confidence": round(sum(confs) / len(confs), 2),
                }
                for mod, confs in sorted(all_mods.items(), key=lambda x: -len(x[1]))
            },

            # Zone breakdown
            "zone_details": zone_details,
            "zone_distribution": dict(zone_counts.most_common()),

            # Temporal
            "date_range": date_range,

            # GPS
            "gps_points": len(gps_points),

            # Cloud analysis detail (arboreal taxonomy)
            "has_cloud_analysis": has_cloud,
            "damage_detail": damage_detail_all,
            "modification_detail": mod_detail_all,
            "zone_worst_severity": dict(zone_worst_severity),

            # Raw results for HTML rendering
            "image_results": results,
        }


# ---------------------------------------------------------------------------
# Image thumbnail helper
# ---------------------------------------------------------------------------

def image_to_base64_thumbnail(image_path: str, max_width: int = 400) -> str:
    """Convert an image to a base64 JPEG thumbnail data URI."""
    try:
        path = Path(image_path)
        if not path.exists():
            return ""

        # Handle HEIC via sips conversion
        if path.suffix.lower() in (".heic", ".heif"):
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tmp.close()
            subprocess.run(
                ["sips", "-s", "format", "jpeg", "-Z", str(max_width), str(path), "--out", tmp.name],
                capture_output=True, timeout=10
            )
            with open(tmp.name, "rb") as f:
                data = f.read()
            os.unlink(tmp.name)
            return f"data:image/jpeg;base64,{base64.b64encode(data).decode()}"

        img = Image.open(path)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        ratio = max_width / img.width if img.width > max_width else 1
        if ratio < 1:
            img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}"
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# HTML Report Generator
# ---------------------------------------------------------------------------

def generate_html_report(report: dict) -> str:
    """Generate a detailed HTML condition report."""

    album = report["album_name"]

    # Zone coverage grid
    zone_grid_rows = []
    zone_categories = {
        "Exterior": ["ext_front", "ext_front_driver", "ext_front_passenger",
                     "ext_driver_side", "ext_passenger_side", "ext_rear",
                     "ext_rear_driver", "ext_rear_passenger", "ext_roof", "ext_undercarriage"],
        "Panels": ["panel_hood", "panel_trunk", "panel_door_fl", "panel_door_fr",
                   "panel_door_rl", "panel_door_rr", "panel_fender_fl", "panel_fender_fr",
                   "panel_fender_rl", "panel_fender_rr"],
        "Wheels": ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"],
        "Interior": ["int_dashboard", "int_front_seats", "int_rear_seats", "int_cargo", "int_headliner"],
        "Mechanical": ["mech_engine_bay", "mech_transmission", "mech_suspension"],
        "Detail": ["detail_vin", "detail_badge", "detail_damage", "detail_odometer"],
    }

    for cat_name, zones in zone_categories.items():
        cells = []
        for zone in zones:
            d = report["zone_details"].get(zone, {})
            if d.get("covered"):
                cond = d.get("avg_condition")
                count = d.get("image_count", 0)
                dmg = d.get("damage_flags", {})
                worst_sev = d.get("worst_severity", 0)

                # Color by worst severity if available, else by condition
                if worst_sev >= 4: color = "#6b1010"
                elif worst_sev >= 3: color = "#6b3410"
                elif worst_sev >= 2: color = "#5c4a1e"
                elif cond and cond >= 4: color = "#2d5016"
                elif cond and cond >= 3: color = "#5c4a1e"
                elif cond and cond >= 2: color = "#6b3410"
                else: color = "#6b1010"

                dmg_text = ", ".join(dmg.keys()) if dmg else ""
                label = zone.replace("ext_", "").replace("panel_", "").replace("int_", "").replace("mech_", "").replace("detail_", "").replace("wheel_", "whl_")

                cells.append(f'''<div class="zone-cell covered" style="background:{color}">
                    <div class="zone-label">{label}</div>
                    <div class="zone-score">{cond or "?"}/5</div>
                    <div class="zone-count">{count} img</div>
                    {f'<div class="zone-damage">{dmg_text}</div>' if dmg_text else ''}
                </div>''')
            else:
                label = zone.replace("ext_", "").replace("panel_", "").replace("int_", "").replace("mech_", "").replace("detail_", "").replace("wheel_", "whl_")
                cells.append(f'''<div class="zone-cell missing">
                    <div class="zone-label">{label}</div>
                    <div class="zone-score">NO DATA</div>
                </div>''')

        zone_grid_rows.append(f'''
            <div class="zone-category">
                <h3>{cat_name}</h3>
                <div class="zone-grid">{"".join(cells)}</div>
            </div>
        ''')

    # Damage table
    damage_rows = []
    for dmg, info in report.get("damage_summary", {}).items():
        damage_rows.append(f'''<tr>
            <td>{dmg.upper().replace("_", " ")}</td>
            <td>{info["occurrences"]}</td>
            <td>{info["avg_confidence"]:.0%}</td>
            <td>{info["max_confidence"]:.0%}</td>
        </tr>''')

    # Modification table
    mod_rows = []
    for mod, info in report.get("modification_summary", {}).items():
        mod_rows.append(f'''<tr>
            <td>{mod.upper().replace("_", " ")}</td>
            <td>{info["occurrences"]}</td>
            <td>{info["avg_confidence"]:.0%}</td>
        </tr>''')

    # Build arboreal damage tree HTML (if cloud analysis available)
    damage_tree_html = ""
    mod_inventory_html = ""
    damage_detail_list = report.get("damage_detail", [])
    mod_detail_list = report.get("modification_detail", [])

    if damage_detail_list:
        # Group damage by category from DAMAGE_TAXONOMY
        cat_lookup = {}
        for cat, flags in DAMAGE_TAXONOMY.items():
            for f in flags:
                cat_lookup[f] = cat
        cat_names = {"structural": "Structural", "surface": "Surface", "missing_broken": "Missing / Broken",
                     "wear": "Wear", "mechanical_visible": "Mechanical (Visible)"}

        by_category = defaultdict(list)
        for d in damage_detail_list:
            cat = cat_lookup.get(d.get("type", ""), "other")
            by_category[cat].append(d)

        tree_items = []
        for cat_key in ["structural", "surface", "missing_broken", "wear", "mechanical_visible"]:
            items = by_category.get(cat_key, [])
            if not items:
                continue
            # Group by type within category
            by_type = defaultdict(list)
            for d in items:
                by_type[d["type"]].append(d)

            type_rows = []
            for dtype, findings in sorted(by_type.items(), key=lambda x: -max(f.get("severity", 0) for f in x[1])):
                worst_sev = max(f.get("severity", 0) for f in findings)
                sev_colors = {1: "#2d5016", 2: "#5c4a1e", 3: "#8b6914", 4: "#6b3410", 5: "#6b1010"}
                sev_color = sev_colors.get(worst_sev, "#333")
                locations = set(f.get("location", "") for f in findings if f.get("location"))
                zones = set(f.get("zone", "") for f in findings if f.get("zone"))
                desc = findings[0].get("description", "") if findings else ""
                subtype = findings[0].get("subtype", "") if findings else ""

                type_rows.append(f'''<div class="tree-item">
                    <div class="tree-type">
                        <span class="sev-dot" style="background:{sev_color}"></span>
                        {dtype.upper().replace("_", " ")}
                        {f'<span class="tree-subtype">({subtype})</span>' if subtype else ''}
                    </div>
                    <div class="tree-detail">
                        <span class="sev-badge" style="background:{sev_color}">{worst_sev}/5</span>
                        {f'<span class="tree-loc">{", ".join(sorted(locations))}</span>' if locations else ''}
                        <span class="tree-zones">{", ".join(sorted(zones))}</span>
                        <span class="tree-count">{len(findings)}x</span>
                    </div>
                    {f'<div class="tree-desc">{desc}</div>' if desc else ''}
                </div>''')

            tree_items.append(f'''<div class="tree-category">
                <div class="tree-cat-header">{cat_names.get(cat_key, cat_key)}</div>
                {"".join(type_rows)}
            </div>''')

        damage_tree_html = f'''<div class="section">
            <h2>Damage Tree (Arboreal Analysis)</h2>
            <div class="damage-tree">{"".join(tree_items)}</div>
        </div>'''

    if mod_detail_list:
        # Group mods by category from MODIFICATION_TAXONOMY
        mod_cat_lookup = {}
        for cat, flags in MODIFICATION_TAXONOMY.items():
            for f in flags:
                mod_cat_lookup[f] = cat
        mod_cat_names = {"suspension": "Suspension", "wheels_tires": "Wheels / Tires",
                         "engine": "Engine", "body": "Body", "interior": "Interior", "electrical": "Electrical"}

        by_cat = defaultdict(list)
        for m in mod_detail_list:
            cat = mod_cat_lookup.get(m.get("type", ""), "other")
            by_cat[cat].append(m)

        inv_items = []
        for cat_key in ["suspension", "wheels_tires", "engine", "body", "interior", "electrical"]:
            items = by_cat.get(cat_key, [])
            if not items:
                continue
            by_type = defaultdict(list)
            for m in items:
                by_type[m["type"]].append(m)

            mod_items = []
            for mtype, findings in sorted(by_type.items()):
                best_conf = max(f.get("confidence", 0) for f in findings)
                desc = findings[0].get("description", "") if findings else ""
                zones = set(f.get("zone", "") for f in findings if f.get("zone"))
                mod_items.append(f'''<div class="mod-item">
                    <div class="mod-type">{mtype.upper().replace("_", " ")}</div>
                    <div class="mod-detail">
                        <span class="mod-conf">{best_conf:.0%}</span>
                        <span class="mod-desc">{desc}</span>
                    </div>
                    <div class="mod-zones">{", ".join(sorted(zones))}</div>
                </div>''')

            inv_items.append(f'''<div class="mod-category">
                <div class="mod-cat-header">{mod_cat_names.get(cat_key, cat_key)}</div>
                {"".join(mod_items)}
            </div>''')

        mod_inventory_html = f'''<div class="section">
            <h2>Modification Inventory</h2>
            <div class="mod-inventory">{"".join(inv_items)}</div>
        </div>'''

    # Image gallery by zone
    gallery_sections = []
    for zone, images in sorted(
        {z: report["zone_details"][z] for z in report["zone_details"] if report["zone_details"][z].get("covered")}.items()
    ):
        zone_imgs = [r for r in report["image_results"] if r.get("zone") == zone and not r.get("error")][:6]
        if not zone_imgs:
            continue

        img_cards = []
        for img in zone_imgs:
            dmg_tags = " ".join(f'<span class="tag damage">{d[0]}</span>' for d in img.get("damage_detected", []))
            mod_tags = " ".join(f'<span class="tag mod">{m[0]}</span>' for m in img.get("modifications_detected", []))
            date_str = img.get("taken_at", "")[:10] if img.get("taken_at") else ""
            cond_notes = img.get("condition_notes", "")

            # Build cloud detail list for this image
            detail_html = ""
            if img.get("damage_detail"):
                detail_items = []
                for dd in img["damage_detail"]:
                    sev = dd.get("severity", 0)
                    sev_colors = {1: "#2d5016", 2: "#5c4a1e", 3: "#8b6914", 4: "#6b3410", 5: "#6b1010"}
                    sc = sev_colors.get(sev, "#333")
                    detail_items.append(
                        f'<div class="finding"><span class="sev-dot" style="background:{sc}"></span>'
                        f'{dd.get("type", "?").replace("_", " ")} '
                        f'({dd.get("subtype", "")}) sev:{sev}/5'
                        f'{" — " + dd.get("location", "") if dd.get("location") else ""}'
                        f'</div>'
                    )
                detail_html = f'<div class="findings">{"".join(detail_items)}</div>'
            if img.get("modification_detail"):
                mod_items = []
                for md in img["modification_detail"]:
                    mod_items.append(
                        f'<div class="finding mod-finding">'
                        f'{md.get("type", "?").replace("_", " ")}: {md.get("description", "")}'
                        f'</div>'
                    )
                detail_html += f'<div class="findings">{"".join(mod_items)}</div>'

            # Embed image as base64 thumbnail
            b64 = image_to_base64_thumbnail(img.get("path", ""))
            img_src = b64 if b64 else f"file://{img.get('path', '')}"

            img_cards.append(f'''<div class="img-card">
                <img src="{img_src}" loading="lazy" />
                <div class="img-meta">
                    <div>Condition: {img.get("condition_score", "?")}/5 | Quality: {img.get("photo_quality", "?")}/5</div>
                    <div>Zone: {img.get("zone", "?")} ({img.get("zone_confidence", 0):.0%})</div>
                    {f'<div class="condition-notes">{cond_notes}</div>' if cond_notes else ''}
                    <div>{date_str}</div>
                    <div>{dmg_tags} {mod_tags}</div>
                    {detail_html}
                </div>
            </div>''')

        gallery_sections.append(f'''
            <div class="gallery-section">
                <h3>{zone.upper().replace("_", " ")}</h3>
                <div class="gallery-grid">{"".join(img_cards)}</div>
            </div>
        ''')

    # Timeline chart data
    timeline_data = []
    for r in sorted(report["image_results"], key=lambda x: x.get("taken_at", "")):
        if r.get("taken_at") and r.get("condition_score"):
            timeline_data.append({
                "date": r["taken_at"][:10],
                "condition": r["condition_score"],
                "zone": r.get("zone", "other"),
            })

    dr = report.get("date_range") or {}
    cov = report.get("coverage", {})

    html = f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Vehicle Analysis: {album}</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: Arial, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; }}
h1 {{ font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }}
h2 {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin: 20px 0 10px 0; }}
h3 {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; margin-bottom: 8px; }}
.header {{ display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px; }}
.stat {{ background: #111; border: 2px solid #222; padding: 12px; }}
.stat-value {{ font-size: 20px; font-weight: 700; font-family: 'Courier New', monospace; color: #fff; }}
.stat-label {{ font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin-top: 4px; }}
.condition-bar {{ height: 4px; margin-top: 8px; }}
.zone-category {{ margin-bottom: 16px; }}
.zone-grid {{ display: flex; flex-wrap: wrap; gap: 4px; }}
.zone-cell {{ width: 90px; padding: 6px; border: 2px solid #333; font-size: 8px; text-align: center; }}
.zone-cell.covered {{ border-color: #444; }}
.zone-cell.missing {{ border-color: #1a1a1a; color: #333; background: #0d0d0d; }}
.zone-label {{ font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }}
.zone-score {{ font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; }}
.zone-count {{ color: #666; }}
.zone-damage {{ color: #c44; font-size: 7px; margin-top: 2px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 9px; }}
th {{ text-align: left; padding: 6px; background: #111; border-bottom: 2px solid #333; text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; color: #666; }}
td {{ padding: 6px; border-bottom: 1px solid #1a1a1a; }}
.gallery-section {{ margin-bottom: 20px; }}
.gallery-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }}
.img-card {{ background: #111; border: 2px solid #222; overflow: hidden; }}
.img-card img {{ width: 100%; height: 180px; object-fit: cover; display: block; }}
.img-meta {{ padding: 6px; font-size: 8px; color: #888; }}
.img-meta div {{ margin-bottom: 2px; }}
.tag {{ display: inline-block; padding: 1px 4px; font-size: 7px; text-transform: uppercase; border: 1px solid; margin-right: 2px; }}
.tag.damage {{ border-color: #c44; color: #c44; }}
.tag.mod {{ border-color: #48c; color: #48c; }}
.section {{ margin-bottom: 32px; }}
.two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
.timeline {{ display: flex; gap: 2px; align-items: flex-end; height: 60px; padding: 4px 0; }}
.timeline-bar {{ flex: 1; background: #333; min-width: 3px; position: relative; }}
.cond-1 {{ background: #6b1010; }} .cond-2 {{ background: #6b3410; }}
.cond-3 {{ background: #5c4a1e; }} .cond-4 {{ background: #2d5016; }}
.cond-5 {{ background: #1a6b10; }}
.damage-tree, .mod-inventory {{ margin-top: 8px; }}
.tree-category, .mod-category {{ margin-bottom: 12px; border: 2px solid #222; background: #0d0d0d; }}
.tree-cat-header, .mod-cat-header {{ padding: 6px 10px; background: #111; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; border-bottom: 1px solid #222; }}
.tree-item, .mod-item {{ padding: 6px 10px; border-bottom: 1px solid #1a1a1a; }}
.tree-type {{ font-size: 10px; font-weight: 700; color: #ddd; display: flex; align-items: center; gap: 6px; }}
.tree-subtype {{ font-weight: 400; color: #888; font-size: 9px; }}
.tree-detail {{ display: flex; gap: 8px; align-items: center; margin-top: 3px; font-size: 8px; color: #666; }}
.tree-desc {{ font-size: 8px; color: #777; margin-top: 2px; font-style: italic; }}
.tree-loc {{ color: #c90; }}
.tree-zones {{ color: #666; }}
.tree-count {{ color: #555; }}
.sev-dot {{ width: 8px; height: 8px; border-radius: 0; display: inline-block; flex-shrink: 0; }}
.sev-badge {{ padding: 1px 5px; font-size: 8px; font-weight: 700; font-family: 'Courier New', monospace; color: #fff; }}
.mod-type {{ font-size: 10px; font-weight: 700; color: #6cf; }}
.mod-detail {{ font-size: 8px; color: #888; margin-top: 2px; display: flex; gap: 8px; }}
.mod-conf {{ color: #6cf; font-family: 'Courier New', monospace; }}
.mod-desc {{ color: #aaa; }}
.mod-zones {{ font-size: 7px; color: #555; margin-top: 1px; }}
.findings {{ margin-top: 4px; }}
.finding {{ font-size: 7px; color: #999; display: flex; align-items: center; gap: 4px; margin-bottom: 1px; }}
.mod-finding {{ color: #6cf; }}
.condition-notes {{ color: #aaa; font-style: italic; font-size: 8px; }}
.cloud-badge {{ display: inline-block; padding: 1px 4px; font-size: 7px; background: #1a3a5c; color: #6cf; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 6px; }}
</style>
</head>
<body>

<h1>Vehicle Condition Analysis — {album}</h1>

<div class="header">
    <div class="stat">
        <div class="stat-value">{report.get("overall_condition", "?")}/5</div>
        <div class="stat-label">Overall Condition</div>
        <div class="condition-bar" style="background: linear-gradient(90deg, #6b1010 0%, #5c4a1e 50%, #2d5016 100%); width: {((report.get('overall_condition') or 3) / 5) * 100}%"></div>
    </div>
    <div class="stat">
        <div class="stat-value">{cov.get("coverage_pct", 0)}%</div>
        <div class="stat-label">Zone Coverage ({cov.get("covered_zones", 0)}/{cov.get("total_zones", 36)} zones)</div>
    </div>
    <div class="stat">
        <div class="stat-value">{report["photos_analyzed"]}</div>
        <div class="stat-label">Photos Analyzed (of {report["total_photos_in_album"]})</div>
    </div>
    <div class="stat">
        <div class="stat-value">{dr.get("span_days", "?")}d</div>
        <div class="stat-label">Date Range: {dr.get("first", "?")} → {dr.get("last", "?")}</div>
    </div>
</div>

<div class="section">
    <h2>Zone Coverage Map</h2>
    {"".join(zone_grid_rows)}
</div>

<div class="section two-col">
    <div>
        <h2>Damage Detection</h2>
        <table>
            <tr><th>Type</th><th>Count</th><th>Avg Conf</th><th>Max Conf</th></tr>
            {"".join(damage_rows) if damage_rows else "<tr><td colspan='4' style='color:#333'>No damage detected</td></tr>"}
        </table>
    </div>
    <div>
        <h2>Modifications Detected</h2>
        <table>
            <tr><th>Type</th><th>Count</th><th>Avg Conf</th></tr>
            {"".join(mod_rows) if mod_rows else "<tr><td colspan='3' style='color:#333'>No modifications detected</td></tr>"}
        </table>
    </div>
</div>

{damage_tree_html}
{mod_inventory_html}

<div class="section">
    <h2>Condition Timeline</h2>
    <div class="timeline">
        {"".join(f'<div class="timeline-bar cond-{d["condition"]}" style="height:{d["condition"]*20}%" title="{d["date"]} — {d["zone"]} — {d["condition"]}/5"></div>' for d in timeline_data)}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#444;margin-top:2px">
        <span>{timeline_data[0]["date"] if timeline_data else ""}</span>
        <span>{timeline_data[-1]["date"] if timeline_data else ""}</span>
    </div>
</div>

<div class="section">
    <h2>Photo Gallery by Zone</h2>
    {"".join(gallery_sections)}
</div>

<div class="section">
    <h2>Zone Distribution</h2>
    <table>
        <tr><th>Zone</th><th>Photos</th><th>Avg Condition</th><th>Damage</th><th>Modifications</th></tr>
        {"".join(
            f'<tr><td>{zone}</td><td>{info.get("image_count", 0)}</td>'
            f'<td>{info.get("avg_condition", "?")}</td>'
            f'<td>{", ".join(info.get("damage_flags", {}).keys())}</td>'
            f'<td>{", ".join(info.get("modification_flags", {}).keys())}</td></tr>'
            for zone, info in sorted(report["zone_details"].items(), key=lambda x: -x[1].get("image_count", 0))
            if info.get("covered")
        )}
    </table>
</div>

</body>
</html>'''

    return html


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def analyze_and_report(analyzer, album_name: str, sample_size: int, output_dir: Path) -> dict:
    """Analyze one album and write HTML + JSON reports. Returns the report."""
    safe_name = album_name.strip().replace(" ", "-").replace("/", "_").lower()

    report = analyzer.analyze_album(album_name, sample_size)

    # Save JSON
    json_path = output_dir / f"{safe_name}.json"
    with open(json_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nJSON report: {json_path}")

    # Generate HTML with embedded thumbnails
    html = generate_html_report(report)
    html_path = output_dir / f"{safe_name}.html"
    with open(html_path, "w") as f:
        f.write(html)
    print(f"HTML report: {html_path}")

    # Print summary
    print(f"\n{'='*60}")
    print(f"VEHICLE ANALYSIS: {album_name}")
    print(f"{'='*60}")
    print(f"Overall Condition: {report.get('overall_condition', '?')}/5")
    cov = report.get("coverage", {})
    print(f"Zone Coverage: {cov.get('coverage_pct', 0)}% ({cov.get('covered_zones', 0)}/{cov.get('total_zones', 0)})")
    print(f"Photos Analyzed: {report['photos_analyzed']} of {report['total_photos_in_album']}")

    if report.get("damage_summary"):
        print(f"\nDamage Detected:")
        for dmg, info in report["damage_summary"].items():
            print(f"  {dmg}: {info['occurrences']}x (avg {info['avg_confidence']:.0%} conf)")

    if report.get("modification_summary"):
        print(f"\nModifications Detected:")
        for mod, info in report["modification_summary"].items():
            print(f"  {mod}: {info['occurrences']}x (avg {info['avg_confidence']:.0%} conf)")

    print(f"\nMissing Zones: {', '.join(cov.get('missing', []))}")
    return report


def generate_index_html(reports: list, output_dir: Path):
    """Generate an index page linking all vehicle reports."""
    rows = []
    for r in sorted(reports, key=lambda x: x.get("overall_condition") or 0, reverse=True):
        name = r["album_name"]
        safe = name.strip().replace(" ", "-").replace("/", "_").lower()
        cov = r.get("coverage", {})
        dmg_list = ", ".join(r.get("damage_summary", {}).keys()) or "none"
        mod_list = ", ".join(r.get("modification_summary", {}).keys()) or "none"

        cond = r.get("overall_condition") or 0
        if cond >= 4: cond_color = "#2d5016"
        elif cond >= 3: cond_color = "#5c4a1e"
        elif cond >= 2: cond_color = "#6b3410"
        else: cond_color = "#6b1010"

        rows.append(f'''<tr>
            <td><a href="{safe}.html" style="color:#6cf;text-decoration:none">{name}</a></td>
            <td style="background:{cond_color};text-align:center;font-family:'Courier New',monospace;font-weight:700">{r.get("overall_condition", "?")}/5</td>
            <td>{cov.get("coverage_pct", 0)}% ({cov.get("covered_zones", 0)}/{cov.get("total_zones", 36)})</td>
            <td>{r["photos_analyzed"]}/{r["total_photos_in_album"]}</td>
            <td style="color:#c44">{dmg_list}</td>
            <td style="color:#48c">{mod_list}</td>
        </tr>''')

    html = f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Vehicle Analysis Index — Nuke</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: Arial, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; }}
h1 {{ font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 10px; }}
th {{ text-align: left; padding: 8px; background: #111; border-bottom: 2px solid #333; text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; color: #666; }}
td {{ padding: 8px; border-bottom: 1px solid #1a1a1a; }}
tr:hover {{ background: #111; }}
.summary {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }}
.stat {{ background: #111; border: 2px solid #222; padding: 12px; }}
.stat-value {{ font-size: 20px; font-weight: 700; font-family: 'Courier New', monospace; color: #fff; }}
.stat-label {{ font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin-top: 4px; }}
</style>
</head>
<body>
<h1>Vehicle Analysis Index — {len(reports)} Vehicles</h1>

<div class="summary">
    <div class="stat">
        <div class="stat-value">{len(reports)}</div>
        <div class="stat-label">Vehicles Analyzed</div>
    </div>
    <div class="stat">
        <div class="stat-value">{sum(r["photos_analyzed"] for r in reports)}</div>
        <div class="stat-label">Total Photos Processed</div>
    </div>
    <div class="stat">
        <div class="stat-value">{sum(1 for r in reports if (r.get("overall_condition") or 0) >= 3)}</div>
        <div class="stat-label">Condition 3+ (Fair or Better)</div>
    </div>
    <div class="stat">
        <div class="stat-value">{round(sum(r.get("overall_condition") or 0 for r in reports) / len(reports), 1) if reports else 0}/5</div>
        <div class="stat-label">Average Condition</div>
    </div>
</div>

<table>
    <tr><th>Vehicle</th><th>Condition</th><th>Zone Coverage</th><th>Photos</th><th>Damage</th><th>Modifications</th></tr>
    {"".join(rows)}
</table>
</body>
</html>'''

    with open(output_dir / "index.html", "w") as f:
        f.write(html)
    print(f"\nIndex page: {output_dir / 'index.html'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--album", help="Single album name")
    parser.add_argument("--albums", nargs="+", help="Multiple album names")
    parser.add_argument("--sample", type=int, default=50, help="Photos per album")
    parser.add_argument("--output-dir", default=None, help="Output directory for reports")
    parser.add_argument("--cloud", action="store_true", help="Enable Claude Haiku vision for arboreal analysis (~$0.003/image)")
    parser.add_argument("--cloud-sample", type=int, default=1, help="Send every Nth image to cloud (cost control, e.g., 2 = every other image)")
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else NUKE_DIR / "analysis-reports"
    output_dir.mkdir(exist_ok=True)

    albums = []
    if args.album:
        albums = [args.album]
    elif args.albums:
        albums = args.albums
    else:
        print("Error: provide --album or --albums")
        sys.exit(1)

    # Use first album name as vehicle context hint
    vehicle_context = albums[0] if albums else ""

    analyzer = VehicleAnalyzer(
        cloud_mode=args.cloud,
        cloud_sample=args.cloud_sample,
        vehicle_context=vehicle_context,
    )

    reports = []
    for i, album in enumerate(albums):
        print(f"\n{'#'*60}")
        print(f"# [{i+1}/{len(albums)}] {album}")
        print(f"{'#'*60}\n")

        # Update cloud analyzer context for each album
        if analyzer.cloud_analyzer:
            analyzer.cloud_analyzer.vehicle_context = album

        try:
            report = analyze_and_report(analyzer, album, args.sample, output_dir)
            reports.append(report)
        except Exception as e:
            print(f"\nERROR analyzing {album}: {e}")

    # Generate index if multiple reports
    if len(reports) > 1:
        generate_index_html(reports, output_dir)

    print(f"\n\nAll reports saved to: {output_dir}")


if __name__ == "__main__":
    main()
