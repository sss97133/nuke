#!/usr/bin/env python3
"""
YONO inference server — FastAPI sidecar for edge function integration.

Runs locally on port 8472. Edge functions call this before hitting Gemini/GPT-4o.
If YONO is confident, cloud call is skipped entirely. Saves $0.0001–$0.004/image.

Usage:
  python server.py                    # start on :8472
  python server.py --port 8473        # custom port
  python server.py --host 0.0.0.0     # bind all interfaces

Endpoints:
  GET  /health          → {status, model_version, tier1, tier2_families, flat, uptime_s, vision_available}
  POST /classify        → {image_url} → {make, confidence, family, family_confidence, top5, source, is_vehicle, ms}
  POST /classify/batch  → [{image_url},...] → [{...},...]
  GET  /labels          → full list of known makes / families

  POST /analyze         → {image_url} → {vehicle_zone, zone_confidence, condition_score,
                                          damage_flags, modification_flags, interior_quality,
                                          photo_quality, surface_coord_u, surface_coord_v, ms, model}
  POST /analyze/batch   → {images: [{image_url},...]} → {results: [...], count: N}

  POST /condition/context    → {image_id, vehicle_id} → 5W context (free metadata)
  POST /condition/bridge     → {vehicle_id?, limit?} → bridge YONO v1 flags → taxonomy observations
  POST /condition/score      → {vehicle_id} → 0-100 score with tier, percentiles, rarity
  POST /condition/contextual → {vehicle_id} → Phase 3C contextual pass (Y/M/M knowledge signals)
  POST /condition/sequence   → {vehicle_id} → Phase 3D sequence cross-reference pass
  POST /condition/pipeline   → {vehicle_id} → full multipass: bridge → contextual → sequence → score → distribute
  POST /condition/distribute → {ymm_key? | all?} → recompute per-Y/M/M distributions
"""

import argparse
import json
import os
import time
import tempfile
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

import sys
sys.path.insert(0, str(Path(__file__).parent))
from yono import HierarchicalYONO, YONOClassifier

# === Paths ===
YONO_DIR = Path(__file__).parent
MODELS_DIR = YONO_DIR / "models"
VISION_HEAD_PATH = MODELS_DIR / "yono_vision_v2_head.safetensors"
VISION_CONFIG_PATH = MODELS_DIR / "yono_vision_v2_config.json"
ZONE_HEAD_PATH = MODELS_DIR / "yono_zone_head.safetensors"
ZONE_CONFIG_PATH = MODELS_DIR / "yono_zone_config.json"
STAGE_HEAD_PATH = MODELS_DIR / "yono_stage_head.safetensors"
STAGE_CONFIG_PATH = MODELS_DIR / "yono_stage_config.json"

# Loaded at startup
_hier: Optional[HierarchicalYONO] = None
_flat: Optional[YONOClassifier] = None
_vision_analyzer: Optional["VisionAnalyzer"] = None
_zone_classifier: Optional["ZoneClassifier"] = None
_stage_classifier: Optional["StageClassifier"] = None
_started_at = time.time()


# ============================================================
# ZoneClassifier — Florence-2 based zone prediction
# ============================================================

class ZoneClassifier:
    """
    Zone classifier: image → vehicle_zone (41-class).

    Loads fine-tuned head from yono_zone_head.safetensors.
    Falls back to zone extraction from VisionAnalyzer zero-shot caption
    if fine-tuned model not available.
    """

    # Photo-type → zone mapping for zero-shot fallback (from old photo_type field)
    PHOTO_TYPE_TO_ZONE = {
        "exterior_front": "ext_front",
        "exterior_rear": "ext_rear",
        "exterior_side": "ext_driver_side",
        "interior": "int_dashboard",
        "engine": "mech_engine_bay",
        "wheel": "wheel_fl",
        "detail": "detail_damage",
        "undercarriage": "ext_undercarriage",
        "other": "other",
    }

    def __init__(self, model, processor, device):
        self.model = model
        self.processor = processor
        self.device = device
        self._head = None
        self._zone_codes = None
        self._loaded = False

        if ZONE_HEAD_PATH.exists() and ZONE_CONFIG_PATH.exists():
            self._load_head()

    def _load_head(self):
        """Load fine-tuned zone head."""
        try:
            import torch
            from torch import nn
            from safetensors.torch import load_file as safetensors_load

            with open(ZONE_CONFIG_PATH) as f:
                config = json.load(f)

            self._zone_codes = config["zone_codes"]
            n_zones = config["n_zones"]
            hidden_size = config.get("hidden_size", 768)

            class ZoneHead(nn.Module):
                def __init__(self, hidden_size, n_zones):
                    super().__init__()
                    self.net = nn.Sequential(
                        nn.LayerNorm(hidden_size),
                        nn.Linear(hidden_size, 512),
                        nn.GELU(),
                        nn.Dropout(0.2),
                        nn.Linear(512, 256),
                        nn.GELU(),
                        nn.Dropout(0.1),
                        nn.Linear(256, n_zones),
                    )
                def forward(self, x):
                    return self.net(x.mean(dim=1))

            head = ZoneHead(hidden_size, n_zones)
            state = safetensors_load(ZONE_HEAD_PATH)
            head.load_state_dict(state)
            self._head = head.to(self.device)
            self._head.eval()
            self._loaded = True
            print(f"ZoneClassifier: fine-tuned head loaded (val_acc={config.get('best_val_acc', '?'):.1%})")
        except Exception as e:
            print(f"ZoneClassifier: head load failed: {e} — using caption fallback")

    def classify(self, image_path: str) -> dict:
        """
        Classify zone for an image.

        Returns:
          {vehicle_zone: str, zone_confidence: float, surface_coord_u: null, surface_coord_v: null}
        """
        import torch
        from PIL import Image

        image = Image.open(image_path).convert("RGB")
        inputs = self.processor(text="<DETAILED_CAPTION>", images=image, return_tensors="pt").to(self.device)

        if self._loaded and self._head is not None:
            with torch.no_grad():
                features = self.model._encode_image(inputs["pixel_values"])
                logits = self._head(features)
                probs = logits.softmax(dim=-1)[0]
                top_idx = int(probs.argmax().item())
                zone = self._zone_codes[top_idx]
                confidence = float(probs[top_idx].item())
        else:
            # Fallback: generate caption and extract zone via keyword matching
            zone, confidence = self._caption_to_zone(inputs)

        return {
            "vehicle_zone": zone,
            "zone_confidence": round(confidence, 3),
            "surface_coord_u": None,  # populated by COLMAP Phase 1
            "surface_coord_v": None,
        }

    def _caption_to_zone(self, inputs) -> tuple:
        """Zero-shot zone inference from Florence-2 caption."""
        import torch
        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=80,
                do_sample=False,
                num_beams=2,
            )
        text = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0].lower()

        # Zone keyword matching (ordered from most to least specific)
        zone_keywords = [
            ("detail_vin", ["vin plate", "vin number", "vehicle identification"]),
            ("detail_odometer", ["odometer", "mileage reading", "instrument cluster"]),
            ("detail_badge", ["badge", "emblem", "logo", "nameplate"]),
            ("detail_damage", ["damage close", "rust close", "dent close"]),
            ("ext_undercarriage", ["undercarriage", "underneath", "frame"]),
            ("ext_roof", ["roof", "top down", "aerial", "overhead"]),
            ("ext_front_driver", ["front driver", "front left", "front 3/4"]),
            ("ext_front_passenger", ["front passenger", "front right"]),
            ("ext_rear_driver", ["rear driver", "rear left"]),
            ("ext_rear_passenger", ["rear passenger", "rear right"]),
            ("ext_front", ["front", "grille", "headlight"]),
            ("ext_rear", ["rear", "taillight", "trunk lid", "back"]),
            ("ext_driver_side", ["driver side", "left side", "profile"]),
            ("ext_passenger_side", ["passenger side", "right side"]),
            ("panel_hood", ["hood open", "hood surface", "bonnet"]),
            ("panel_trunk", ["trunk open", "boot open", "tailgate"]),
            ("panel_door_fl", ["driver door", "front left door"]),
            ("panel_door_fr", ["passenger door", "front right door"]),
            ("panel_fender_rl", ["rear left fender", "rear left quarter"]),
            ("panel_fender_rr", ["rear right fender", "rear right quarter"]),
            ("panel_fender_fl", ["front left fender"]),
            ("panel_fender_fr", ["front right fender"]),
            ("wheel_fl", ["wheel", "tire", "rim", "brake"]),
            ("int_dashboard", ["dashboard", "interior", "steering wheel", "gauges"]),
            ("int_front_seats", ["front seat", "driver seat"]),
            ("int_rear_seats", ["rear seat", "back seat"]),
            ("int_cargo", ["cargo", "trunk interior", "boot interior"]),
            ("mech_engine_bay", ["engine", "motor", "engine bay"]),
            ("mech_transmission", ["transmission", "gearbox"]),
            ("mech_suspension", ["suspension", "axle", "differential"]),
        ]

        for zone, keywords in zone_keywords:
            if any(kw in text for kw in keywords):
                return zone, 0.6  # 0.6 = moderate confidence for caption-derived

        return "other", 0.4


# ============================================================
# StageClassifier — Florence-2 based fabrication stage prediction
# ============================================================

class StageClassifier:
    """
    Fabrication stage classifier: image → fabrication_stage (10-class).

    10-stage taxonomy:
      raw → disassembled → stripped → fabricated → primed →
      blocked → basecoated → clearcoated → assembled → complete

    Loads fine-tuned head from yono_stage_head.safetensors.
    Falls back to caption-based stage inference if head not available.
    """

    STAGE_KEYWORDS = {
        "raw": ["barn find", "neglected", "abandoned", "untouched", "as found", "original condition", "sitting for years", "patina"],
        "disassembled": ["disassembled", "taken apart", "engine removed", "doors off", "gutted", "pulling", "removed"],
        "stripped": ["stripped", "bare metal", "media blasted", "sandblasted", "paint removed", "bare steel", "shell"],
        "fabricated": ["welded", "patch panel", "metal work", "fabricat", "cut out", "new panel", "rust repair"],
        "primed": ["primer", "primed", "epoxy", "etch primer", "high build", "gray primer", "red oxide"],
        "blocked": ["body filler", "bondo", "block sand", "filler", "sanded smooth", "guide coat"],
        "basecoated": ["base coat", "basecoat", "color applied", "painted flat", "matte paint", "base color"],
        "clearcoated": ["clear coat", "clearcoat", "glossy", "wet look", "shiny paint", "fresh paint", "just painted"],
        "assembled": ["reassembl", "installing", "trim", "weatherstrip", "wiring", "putting back", "fitting"],
        "complete": ["finished", "complete", "ready to drive", "restored", "concours", "show quality", "fully assembled"],
    }

    def __init__(self, model, processor, device):
        self.model = model
        self.processor = processor
        self.device = device
        self._head = None
        self._stage_codes = None
        self._loaded = False

        if STAGE_HEAD_PATH.exists() and STAGE_CONFIG_PATH.exists():
            self._load_head()

    def _load_head(self):
        """Load fine-tuned stage head."""
        try:
            import torch
            from torch import nn
            from safetensors.torch import load_file as safetensors_load

            with open(STAGE_CONFIG_PATH) as f:
                config = json.load(f)

            self._stage_codes = config["stage_codes"]
            n_stages = config["n_stages"]
            hidden_size = config.get("hidden_size", 768)

            class StageHead(nn.Module):
                def __init__(self, hidden_size, n_stages):
                    super().__init__()
                    self.net = nn.Sequential(
                        nn.LayerNorm(hidden_size),
                        nn.Linear(hidden_size, 512),
                        nn.GELU(),
                        nn.Dropout(0.2),
                        nn.Linear(512, n_stages),
                    )
                def forward(self, x):
                    return self.net(x.mean(dim=1))

            head = StageHead(hidden_size, n_stages)
            state = safetensors_load(STAGE_HEAD_PATH)
            head.load_state_dict(state)
            self._head = head.to(self.device)
            self._head.eval()
            self._loaded = True
            print(f"StageClassifier: fine-tuned head loaded (val_acc={config.get('best_val_acc', '?'):.1%})")
        except Exception as e:
            print(f"StageClassifier: head load failed: {e} — using caption fallback")

    def classify(self, image_path: str) -> dict:
        """
        Classify fabrication stage for an image.

        Returns:
          {fabrication_stage: str, stage_confidence: float}
        """
        import torch
        from PIL import Image

        image = Image.open(image_path).convert("RGB")
        inputs = self.processor(text="<DETAILED_CAPTION>", images=image, return_tensors="pt").to(self.device)

        if self._loaded and self._head is not None:
            with torch.no_grad():
                features = self.model._encode_image(inputs["pixel_values"])
                logits = self._head(features)
                probs = logits.softmax(dim=-1)[0]
                top_idx = int(probs.argmax().item())
                stage = self._stage_codes[top_idx]
                confidence = float(probs[top_idx].item())
        else:
            stage, confidence = self._caption_to_stage(inputs)

        return {
            "fabrication_stage": stage,
            "stage_confidence": round(confidence, 3),
        }

    def _caption_to_stage(self, inputs) -> tuple:
        """Zero-shot stage inference from Florence-2 caption."""
        import torch
        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=80,
                do_sample=False,
                num_beams=2,
            )
        text = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0].lower()

        # Score each stage by keyword hits
        best_stage = "raw"
        best_score = 0

        for stage, keywords in self.STAGE_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in text)
            if score > best_score:
                best_score = score
                best_stage = stage

        # Confidence: 0.5 base + 0.1 per keyword match, cap at 0.8
        confidence = min(0.8, 0.5 + best_score * 0.1) if best_score > 0 else 0.3

        return best_stage, confidence


# ============================================================
# VisionAnalyzer — Florence-2 based condition assessment
# ============================================================

class VisionAnalyzer:
    """
    Vehicle condition analyzer using Florence-2-base.

    If fine-tuned head weights exist (yono_vision_v2_head.safetensors), uses
    the fine-tuned model. Otherwise falls back to zero-shot Florence-2 captioning
    + structured extraction.

    Outputs:
      condition_score (1-5), damage_flags (list), modification_flags (list),
      interior_quality (1-5 or null), photo_quality (1-5), photo_type (str)
    """

    DAMAGE_FLAGS = ["rust", "dent", "crack", "paint_fade", "broken_glass", "missing_parts", "accident_damage"]
    MOD_FLAGS = ["lift_kit", "lowered", "aftermarket_wheels", "roll_cage", "engine_swap", "body_kit", "exhaust_mod", "suspension_mod"]
    PHOTO_TYPES = ["exterior_front", "exterior_rear", "exterior_side", "interior", "engine", "wheel", "detail", "undercarriage", "other"]

    def __init__(self):
        import torch
        from transformers import AutoProcessor, AutoModelForCausalLM

        self.device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        self.torch = torch

        print(f"Loading Florence-2-base (device: {self.device})...")
        t0 = time.time()

        self.processor = AutoProcessor.from_pretrained(
            "microsoft/florence-2-base",
            trust_remote_code=True,
        )
        self.model = AutoModelForCausalLM.from_pretrained(
            "microsoft/florence-2-base",
            trust_remote_code=True,
            torch_dtype=torch.float32,
        ).to(self.device)
        self.model.eval()

        print(f"Florence-2 loaded in {time.time()-t0:.1f}s")

        # Try to load fine-tuned head + config
        self._head = None
        self._head_config = None
        self._vision_encoder = None
        self._finetuned = False

        if VISION_HEAD_PATH.exists() and VISION_CONFIG_PATH.exists():
            self._load_finetuned_head()

        if self._finetuned:
            self._mode = "finetuned"
            print("VisionAnalyzer: fine-tuned mode (yono_vision_v2)")
        else:
            self._mode = "zeroshot"
            print("VisionAnalyzer: zero-shot mode (Florence-2 captioning)")

    def _load_finetuned_head(self):
        """Load fine-tuned classification head."""
        try:
            import torch
            from safetensors.torch import load_file as safetensors_load

            with open(VISION_CONFIG_PATH) as f:
                config = json.load(f)
            self._head_config = config

            # Rebuild head architecture (matches train_florence2.py VehicleVisionHead)
            hidden_size = config["hidden_size"]
            n_damage = config["n_damage"]
            n_mods = config["n_mods"]
            n_photo_types = config["n_photo_types"]

            from torch import nn

            class VisionHead(nn.Module):
                """Matches VehicleVisionHead in train_florence2.py."""
                def __init__(self, hidden_size, n_damage, n_mods, n_photo_types):
                    super().__init__()
                    # Shared bottleneck: mean-pooled features → 512
                    self.bottleneck = nn.Sequential(
                        nn.LayerNorm(hidden_size),
                        nn.Linear(hidden_size, 512),
                        nn.GELU(),
                        nn.Dropout(0.2),
                    )
                    self.condition_head = nn.Linear(512, 5)
                    self.photo_quality_head = nn.Linear(512, 5)
                    self.interior_quality_head = nn.Linear(512, 5)
                    self.damage_head = nn.Linear(512, n_damage)
                    self.mod_head = nn.Linear(512, n_mods)
                    self.photo_type_head = nn.Linear(512, n_photo_types)

                def forward(self, image_features):
                    # Mean-pool over spatial tokens (same as training)
                    x = image_features.mean(dim=1)
                    x = self.bottleneck(x)
                    return {
                        "condition_score": self.condition_head(x),
                        "photo_quality": self.photo_quality_head(x),
                        "interior_quality": self.interior_quality_head(x),
                        "damage_flags": self.damage_head(x),
                        "mod_flags": self.mod_head(x),
                        "photo_type": self.photo_type_head(x),
                    }

            self._head = VisionHead(hidden_size, n_damage, n_mods, n_photo_types)
            state_dict = safetensors_load(VISION_HEAD_PATH)
            self._head.load_state_dict(state_dict)
            self._head = self._head.to(self.device)
            self._head.eval()

            self._finetuned = True
            print(f"Fine-tuned head loaded (val_loss={config.get('best_val_loss', '?'):.4f})")
        except Exception as e:
            print(f"Fine-tuned head load failed: {e} — using zero-shot mode")
            self._finetuned = False

    def analyze(self, image_path: str) -> dict:
        """
        Analyze a vehicle image.

        Returns:
          {
            condition_score: 1-5,
            damage_flags: [...],
            modification_flags: [...],
            interior_quality: 1-5 or null,
            photo_quality: 1-5,
            photo_type: str,
            model: "finetuned_v2" | "zeroshot_florence2"
          }
        """
        if self._finetuned:
            return self._analyze_finetuned(image_path)
        else:
            return self._analyze_zeroshot(image_path)

    def _analyze_finetuned(self, image_path: str) -> dict:
        """Use fine-tuned Florence-2 head for prediction."""
        import torch
        from PIL import Image

        image = Image.open(image_path).convert("RGB")
        # Florence-2 processor needs task prompt + image
        inputs = self.processor(
            text="<DETAILED_CAPTION>",
            images=image,
            return_tensors="pt",
        )
        pixel_values = inputs["pixel_values"].to(self.device)

        config = self._head_config

        with torch.no_grad():
            # Use Florence-2's internal image encoding
            # Returns (batch, 577, 768) spatial features
            features = self.model._encode_image(pixel_values)
            preds = self._head(features)

            cond_score = int(preds["condition_score"].argmax(dim=-1).item()) + 1
            photo_qual = int(preds["photo_quality"].argmax(dim=-1).item()) + 1

            iq_idx = int(preds["interior_quality"].argmax(dim=-1).item())
            # Determine if interior is visible by checking photo_type
            pt_idx = int(preds["photo_type"].argmax(dim=-1).item())
            photo_type = config["photo_types"][pt_idx]
            interior_quality = (iq_idx + 1) if photo_type == "interior" else None

            # Damage flags (threshold 0.4)
            dmg_probs = preds["damage_flags"].sigmoid()[0]
            damage_flags = [
                config["damage_flags"][i]
                for i, p in enumerate(dmg_probs.tolist())
                if p >= 0.4
            ]

            # Mod flags (threshold 0.4)
            mod_probs = preds["mod_flags"].sigmoid()[0]
            mod_flags = [
                config["mod_flags"][i]
                for i, p in enumerate(mod_probs.tolist())
                if p >= 0.4
            ]

        # Generate quick caption for medium detection
        caption = None
        try:
            with torch.no_grad():
                gen_ids = self.model.generate(
                    input_ids=inputs["input_ids"].to(self.device) if "input_ids" in inputs else self.processor(
                        text="<DETAILED_CAPTION>", images=image, return_tensors="pt"
                    )["input_ids"].to(self.device),
                    pixel_values=pixel_values,
                    max_new_tokens=100,
                    do_sample=False,
                    num_beams=2,
                )
            raw = self.processor.batch_decode(gen_ids, skip_special_tokens=False)[0]
            parsed = self.processor.post_process_generation(
                raw, task="<DETAILED_CAPTION>", image_size=(image.width, image.height)
            )
            caption = parsed.get("<DETAILED_CAPTION>", "")
        except Exception:
            pass

        image_medium = self._detect_medium(image_path, caption)

        return {
            "condition_score": cond_score,
            "damage_flags": damage_flags,
            "modification_flags": mod_flags,
            "interior_quality": interior_quality,
            "photo_quality": photo_qual,
            "photo_type": photo_type,
            "image_medium": image_medium,
            "model": "finetuned_v2",
        }

    def _analyze_zeroshot(self, image_path: str) -> dict:
        """
        Zero-shot Florence-2 analysis using structured captioning tasks.

        Uses Florence-2's built-in <DETAILED_CAPTION> prompt, then extracts
        structured condition fields via keyword matching on the generated caption.
        """
        import torch
        from PIL import Image

        image = Image.open(image_path).convert("RGB")

        # Detailed captioning task
        task_prompt = "<DETAILED_CAPTION>"
        inputs = self.processor(text=task_prompt, images=image, return_tensors="pt").to(self.device)

        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=200,
                do_sample=False,
                num_beams=3,
            )

        generated_text = self.processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = self.processor.post_process_generation(
            generated_text, task=task_prompt, image_size=(image.width, image.height)
        )
        caption = parsed.get("<DETAILED_CAPTION>", "").lower()

        # Extract structured fields from caption via keyword matching
        result = self._extract_from_caption(caption, image)
        result["image_medium"] = self._detect_medium(image_path, caption)
        result["model"] = "zeroshot_florence2"
        return result

    def _extract_from_caption(self, caption: str, image) -> dict:
        """Extract structured condition fields from Florence-2 caption text."""
        # Damage detection via keyword matching
        damage_keywords = {
            "rust": ["rust", "rusty", "rusted", "corrosion", "corroded", "oxidation"],
            "dent": ["dent", "dented", "ding", "crease", "creased", "deformation"],
            "crack": ["crack", "cracked", "fracture", "fissure", "split"],
            "paint_fade": ["faded", "paint fade", "weathered", "oxidized paint", "peeling", "chalking"],
            "broken_glass": ["broken glass", "cracked glass", "missing window", "broken windshield"],
            "missing_parts": ["missing", "absent", "no hood", "no bumper", "stripped"],
            "accident_damage": ["accident", "collision", "crash", "impact damage", "body damage", "damaged"],
        }

        modification_keywords = {
            "lift_kit": ["lift", "lifted", "raised suspension", "lifted suspension", "high clearance"],
            "lowered": ["lowered", "slammed", "low rider", "dropped", "stance"],
            "aftermarket_wheels": ["aftermarket wheel", "custom wheel", "alloy wheel", "chrome wheel", "bbs", "enkei", "rays"],
            "roll_cage": ["roll cage", "roll bar", "safety cage", "cage"],
            "engine_swap": ["engine swap", "v8 swap", "ls swap", "crate engine"],
            "body_kit": ["body kit", "front lip", "side skirt", "rear diffuser", "wide body"],
            "exhaust_mod": ["exhaust", "muffler delete", "catback", "side pipe", "straight pipe"],
            "suspension_mod": ["coilover", "lowering spring", "air suspension", "air bag", "air ride"],
        }

        damage_flags = [flag for flag, kws in damage_keywords.items() if any(kw in caption for kw in kws)]
        mod_flags = [flag for flag, kws in modification_keywords.items() if any(kw in caption for kw in kws)]

        # Photo type detection
        photo_type = "other"
        if any(w in caption for w in ["front", "grille", "headlight", "bumper front"]):
            photo_type = "exterior_front"
        elif any(w in caption for w in ["rear", "trunk", "taillight", "back of"]):
            photo_type = "exterior_rear"
        elif any(w in caption for w in ["side", "door", "quarter panel", "profile"]):
            photo_type = "exterior_side"
        elif any(w in caption for w in ["interior", "dashboard", "steering wheel", "seat", "cabin"]):
            photo_type = "interior"
        elif any(w in caption for w in ["engine", "motor", "under hood", "engine bay"]):
            photo_type = "engine"
        elif any(w in caption for w in ["wheel", "tire", "rim", "brake"]):
            photo_type = "wheel"

        # Condition score heuristic from caption
        condition_score = 3  # default: fair
        excellent_words = ["pristine", "perfect", "immaculate", "concours", "showroom", "mint", "flawless"]
        good_words = ["clean", "nice", "good condition", "well maintained", "solid"]
        poor_words = ["rough", "poor condition", "needs work", "project", "parts car", "junk", "rough"]

        if any(w in caption for w in excellent_words):
            condition_score = 5
        elif any(w in caption for w in good_words):
            condition_score = 4
        elif damage_flags:
            if len(damage_flags) >= 3 or "accident_damage" in damage_flags:
                condition_score = 2
            else:
                condition_score = 3
        elif any(w in caption for w in poor_words):
            condition_score = 2

        # Photo quality heuristic
        photo_quality = 3
        if any(w in caption for w in ["blurry", "out of focus", "dark", "poor lighting", "unclear"]):
            photo_quality = 2
        elif any(w in caption for w in ["clear", "sharp", "well-lit", "detailed", "professional"]):
            photo_quality = 4

        # Interior quality (only if visible)
        interior_quality = None
        if photo_type == "interior":
            if any(w in caption for w in ["clean interior", "nice interior", "good interior"]):
                interior_quality = 4
            elif any(w in caption for w in ["torn", "ripped", "worn", "damaged interior"]):
                interior_quality = 2
            else:
                interior_quality = 3

        return {
            "condition_score": condition_score,
            "damage_flags": damage_flags,
            "modification_flags": mod_flags,
            "interior_quality": interior_quality,
            "photo_quality": photo_quality,
            "photo_type": photo_type,
        }

    def _detect_medium(self, image_path: str, caption: str | None = None) -> str:
        """
        Detect image medium: photograph, render, drawing, or screenshot.

        Uses a combination of:
          1. Caption keywords (if available)
          2. Image statistics (color variance, edge patterns, noise)
          3. EXIF presence (real photos have EXIF, renders/drawings don't)

        Returns one of: 'photograph', 'render', 'drawing', 'screenshot'
        """
        from PIL import Image
        import numpy as np

        score = {"photograph": 0.0, "render": 0.0, "drawing": 0.0, "screenshot": 0.0}

        # --- 1. Caption-based detection ---
        if caption:
            c = caption.lower()

            render_kw = [
                "3d render", "3d model", "rendering", "cgi", "computer generated",
                "computer-generated", "digital render", "virtual", "ray trac",
                "unreal engine", "blender", "photorealistic render", "3d illustration",
                "studio render", "concept render", "white background", "grey background",
                "gray background", "isolated on", "floating", "no background",
            ]
            drawing_kw = [
                "sketch", "drawing", "illustration", "pencil", "ink drawing",
                "hand drawn", "hand-drawn", "blueprint", "technical drawing",
                "line art", "line drawing", "artwork", "painting", "watercolor",
                "charcoal", "pen and ink", "comic", "cartoon", "artistic",
                "graphite", "colored pencil",
            ]
            screenshot_kw = [
                "screenshot", "screen capture", "webpage", "browser", "catalog",
                "listing page", "price tag", "website", "ebay", "craigslist",
                "facebook", "text overlay", "watermark", "forum post", "ad ",
                "advertisement", "classified", "online listing", "product page",
                "shopping", "summit racing", "rockauto", "amazon",
            ]

            for kw in render_kw:
                if kw in c:
                    score["render"] += 3.0
            for kw in drawing_kw:
                if kw in c:
                    score["drawing"] += 3.0
            for kw in screenshot_kw:
                if kw in c:
                    score["screenshot"] += 3.0

        # --- 2. Image statistics ---
        try:
            img = Image.open(image_path).convert("RGB")
            arr = np.array(img, dtype=np.float32)

            # Check for EXIF data (real photos almost always have some)
            exif = img.getexif()
            has_exif = len(exif) > 3  # more than just basic orientation
            if has_exif:
                score["photograph"] += 2.0
            else:
                # No EXIF slightly favors non-photo
                score["render"] += 0.5
                score["drawing"] += 0.5
                score["screenshot"] += 0.5

            # Color channel statistics
            h, w = arr.shape[:2]

            # Noise estimation: real photos have sensor noise, renders are clean
            # Use Laplacian variance as noise proxy
            gray = np.mean(arr, axis=2)
            # Simple edge kernel approximation
            dx = np.diff(gray, axis=1)
            dy = np.diff(gray, axis=0)
            edge_var = float(np.var(dx) + np.var(dy))

            # Very low edge variance = smooth render or drawing
            if edge_var < 500:
                score["render"] += 1.5
                score["drawing"] += 1.0
            elif edge_var > 5000:
                score["photograph"] += 1.0

            # Unique color count (sample center crop for speed)
            ch, cw = h // 2, w // 2
            crop_size = min(100, ch, cw)
            if crop_size > 10:
                center = arr[ch-crop_size:ch+crop_size, cw-crop_size:cw+crop_size]
                # Quantize to reduce noise
                quantized = (center / 16).astype(np.uint8)
                flat = quantized.reshape(-1, 3)
                unique_colors = len(np.unique(flat, axis=0))
                total_pixels = flat.shape[0]
                color_ratio = unique_colors / total_pixels

                # Drawings: very few unique colors (line art)
                if color_ratio < 0.05:
                    score["drawing"] += 2.0
                # Screenshots: moderate colors, lots of flat regions
                elif color_ratio < 0.15:
                    score["screenshot"] += 1.0
                # Photos: rich, varied colors
                elif color_ratio > 0.4:
                    score["photograph"] += 1.5

            # Check for large uniform background regions (common in renders)
            # Sample corners
            corner_size = min(30, h // 8, w // 8)
            if corner_size > 5:
                corners = [
                    arr[:corner_size, :corner_size],
                    arr[:corner_size, -corner_size:],
                    arr[-corner_size:, :corner_size],
                    arr[-corner_size:, -corner_size:],
                ]
                uniform_corners = 0
                for corner in corners:
                    if np.std(corner) < 8.0:  # very uniform
                        uniform_corners += 1
                if uniform_corners >= 3:
                    score["render"] += 2.5  # isolated object on solid background
                elif uniform_corners == 0:
                    score["photograph"] += 1.0  # natural environment in all corners

            # Check for text-like patterns (horizontal runs of high contrast)
            # Screenshots have lots of horizontal sharp edges (text)
            if h > 50 and w > 50:
                # Sample horizontal line in upper third (where UI/titles usually are)
                sample_y = h // 5
                line = gray[sample_y, :]
                line_diff = np.abs(np.diff(line))
                sharp_transitions = np.sum(line_diff > 40)
                if sharp_transitions > w * 0.15:
                    score["screenshot"] += 1.5

        except Exception:
            pass  # Image stats failed, rely on caption alone

        # --- 3. Default bias toward photograph ---
        score["photograph"] += 1.5  # prior: most images are real photos

        # Pick highest scoring medium
        medium = max(score, key=score.get)
        return medium

    def analyze_batch(self, image_paths: list[str]) -> list[dict]:
        """Analyze multiple images."""
        return [self.analyze(p) for p in image_paths]


# ============================================================
# Startup
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _hier, _flat, _vision_analyzer, _zone_classifier
    print("Loading YONO models...")

    # Load make classifier (existing, unchanged)
    try:
        _hier = HierarchicalYONO()
        print(f"Hierarchical: {_hier}")
    except Exception as e:
        print(f"HierarchicalYONO load failed: {e}")
    if not (_hier and _hier.available):
        try:
            _flat = YONOClassifier()
            print(f"Flat fallback: {_flat}")
        except Exception as e:
            print(f"Flat model load failed: {e}")

    # Load vision analyzer (Florence-2) — also creates shared model for zone classifier
    try:
        _vision_analyzer = VisionAnalyzer()
        print(f"VisionAnalyzer: {_vision_analyzer._mode}")
    except Exception as e:
        print(f"VisionAnalyzer load failed: {e}")
        _vision_analyzer = None

    # Load zone classifier (shares Florence-2 model with VisionAnalyzer)
    try:
        if _vision_analyzer is not None:
            _zone_classifier = ZoneClassifier(
                model=_vision_analyzer.model,
                processor=_vision_analyzer.processor,
                device=_vision_analyzer.device,
            )
            print(f"ZoneClassifier: {'fine-tuned' if _zone_classifier._loaded else 'caption-fallback'}")
        else:
            print("ZoneClassifier: skipped (VisionAnalyzer not loaded)")
    except Exception as e:
        print(f"ZoneClassifier load failed: {e}")
        _zone_classifier = None

    # Load stage classifier (shares Florence-2 model with VisionAnalyzer)
    try:
        if _vision_analyzer is not None:
            _stage_classifier = StageClassifier(
                model=_vision_analyzer.model,
                processor=_vision_analyzer.processor,
                device=_vision_analyzer.device,
            )
            print(f"StageClassifier: {'fine-tuned' if _stage_classifier._loaded else 'caption-fallback'}")
        else:
            print("StageClassifier: skipped (VisionAnalyzer not loaded)")
    except Exception as e:
        print(f"StageClassifier load failed: {e}")
        _stage_classifier = None

    print("Ready.")
    yield


app = FastAPI(
    title="YONO",
    description="Vehicle image classifier and condition analyzer — zero API cost",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ============================================================
# Request/Response models
# ============================================================

class ClassifyRequest(BaseModel):
    image_url: str
    top_k: int = 5


class BatchRequest(BaseModel):
    images: List[ClassifyRequest]


class AnalyzeRequest(BaseModel):
    image_url: str
    image_id: Optional[str] = None     # if provided, writes observations to DB
    vehicle_id: Optional[str] = None   # required with image_id for observation writing


class AnalyzeBatchRequest(BaseModel):
    images: List[AnalyzeRequest]


class ContextualAnalyzeRequest(BaseModel):
    image_url: str
    year: int = None
    make: str = None
    model: str = None
    mileage: int = None
    sale_price: int = None
    damage_threshold: float = 0.4
    mod_threshold: float = 0.4


# ============================================================
# Helpers
# ============================================================

def _active_clf():
    """Return best available make classifier."""
    if _hier and _hier.available:
        return _hier
    if _flat:
        return _flat
    return None


def _download_image(image_url: str) -> str:
    """Download image URL to temp file. Returns temp file path."""
    ext = Path(image_url.split("?")[0]).suffix or ".jpg"
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp.close()
    urllib.request.urlretrieve(image_url, tmp.name)
    return tmp.name


def _run_classify(image_path: str, top_k: int) -> dict:
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Make classifier not loaded")
    if isinstance(clf, HierarchicalYONO):
        return clf.predict(image_path, top_k=top_k)
    result = clf.predict(image_path, top_k=top_k)
    return {**result, "family": None, "family_confidence": None, "source": "flat"}


# ============================================================
# Existing endpoints (UNCHANGED)
# ============================================================

@app.get("/health")
def health():
    clf = _active_clf()
    hier_info = None
    if _hier:
        hier_info = {
            "tier1": _hier._tier1 is not None,
            "tier2_families": _hier.tier2_families,
            "flat_fallback": _hier._flat is not None,
        }
    return {
        "status": "ok" if clf or _vision_analyzer else "loading",
        "model": str(clf) if clf else "loading",
        "hierarchical": hier_info,
        "vision_available": _vision_analyzer is not None,
        "vision_mode": _vision_analyzer._mode if _vision_analyzer else None,
        "zone_available": _zone_classifier is not None,
        "zone_mode": "finetuned" if (_zone_classifier and _zone_classifier._loaded) else "caption_fallback",
        "stage_available": _stage_classifier is not None,
        "stage_mode": "finetuned" if (_stage_classifier and _stage_classifier._loaded) else "caption_fallback",
        "uptime_s": round(time.time() - _started_at, 1),
    }


@app.get("/labels")
def labels():
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Model not loaded")
    if isinstance(clf, HierarchicalYONO):
        return {
            "families": clf._family_labels if clf._tier1 else [],
            "tier2": {fam: clf._tier2_labels[fam] for fam in clf._tier2.keys()},
            "flat_makes": clf._flat.labels if clf._flat else [],
        }
    return {"makes": clf.labels, "count": len(clf.labels)}


@app.post("/classify")
def classify(req: ClassifyRequest):
    clf = _active_clf()
    if not clf:
        raise HTTPException(503, "Model not loaded")

    t0 = time.perf_counter()
    tmp_path = None
    try:
        tmp_path = _download_image(req.image_url)
        result = _run_classify(tmp_path, req.top_k)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Failed to classify: {e}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    return {**result, "ms": elapsed_ms, "image_url": req.image_url}


@app.post("/classify/batch")
def classify_batch(req: BatchRequest):
    if not _active_clf():
        raise HTTPException(503, "Model not loaded")
    if len(req.images) > 50:
        raise HTTPException(400, "Max 50 images per batch")

    results = []
    for item in req.images:
        try:
            results.append(classify(item))
        except HTTPException as e:
            results.append({"image_url": item.image_url, "error": e.detail})

    return {"results": results, "count": len(results)}


# ============================================================
# New vision analysis endpoints
# ============================================================

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    """
    Analyze vehicle image for zone, condition, damage, modifications.

    Returns:
      vehicle_zone: Zone from 41-zone taxonomy (VISION_ARCHITECTURE.md)
      zone_confidence: 0-1 confidence in zone prediction
      surface_coord_u: null (populated after COLMAP Phase 1)
      surface_coord_v: null (populated after COLMAP Phase 1)
      condition_score (1-5): Overall exterior condition
      damage_flags: List of detected damage types
      modification_flags: List of detected modifications
      interior_quality (1-5 or null): Interior condition if visible
      photo_quality (1-5): Photo usefulness score
      ms: Inference time in milliseconds
      model: Which model was used
    """
    if not _vision_analyzer:
        raise HTTPException(503, "Vision analyzer not loaded")

    t0 = time.perf_counter()
    tmp_path = None
    try:
        tmp_path = _download_image(req.image_url)

        # Run zone classification first (Phase 1 in VISION_ARCHITECTURE.md)
        zone_result = {}
        if _zone_classifier:
            zone_result = _zone_classifier.classify(tmp_path)

        # Run stage classification (fabrication stage)
        stage_result = {}
        if _stage_classifier:
            stage_result = _stage_classifier.classify(tmp_path)

        # Run condition/damage analysis (Phase 2)
        condition_result = _vision_analyzer.analyze(tmp_path)

        # Merge: zone info takes precedence, condition/damage fills in the rest
        result = {
            "vehicle_zone": zone_result.get("vehicle_zone", "other"),
            "zone_confidence": zone_result.get("zone_confidence", None),
            "fabrication_stage": stage_result.get("fabrication_stage", None),
            "stage_confidence": stage_result.get("stage_confidence", None),
            "surface_coord_u": None,  # null until COLMAP Phase 1
            "surface_coord_v": None,
            **condition_result,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Failed to analyze: {e}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    # Auto-write observations if image_id + vehicle_id provided
    observations_written = 0
    if req.image_id and req.vehicle_id:
        try:
            from condition_spectrometer import bridge_yono_output, get_connection
            conn = get_connection()
            observations_written = bridge_yono_output(
                conn, req.image_id, req.vehicle_id, result,
                source="yono_v2", source_version="server_live",
            )
            conn.close()
        except Exception as e:
            print(f"Auto-observation write failed: {e}")

    return {**result, "ms": elapsed_ms, "image_url": req.image_url,
            "observations_written": observations_written}


@app.post("/analyze/batch")
def analyze_batch(req: AnalyzeBatchRequest):
    """
    Batch vehicle image analysis.

    Max 20 images per request.
    """
    if not _vision_analyzer:
        raise HTTPException(503, "Vision analyzer not loaded")
    if len(req.images) > 20:
        raise HTTPException(400, "Max 20 images per batch for /analyze/batch")

    results = []
    for item in req.images:
        try:
            results.append(analyze(item))
        except HTTPException as e:
            results.append({"image_url": item.image_url, "error": e.detail})

    return {"results": results, "count": len(results)}


# ============================================================
# Condition Spectrometer endpoints
# ============================================================

class ConditionScoreRequest(BaseModel):
    vehicle_id: str


class ConditionContextRequest(BaseModel):
    image_id: str
    vehicle_id: str


class ConditionBridgeRequest(BaseModel):
    vehicle_id: Optional[str] = None
    limit: int = 1000


class ConditionDistributeRequest(BaseModel):
    ymm_key: Optional[str] = None
    all: bool = False


@app.post("/condition/context")
def condition_context(req: ConditionContextRequest):
    """
    Get 5W context (who/what/where/when/which) for an image.
    Free metadata — costs zero inference. Informs all subsequent passes.
    """
    try:
        from condition_spectrometer import get_5w_context, get_connection
        conn = get_connection()
        ctx = get_5w_context(conn, req.image_id, req.vehicle_id)
        conn.close()
        return ctx
    except Exception as e:
        raise HTTPException(500, f"Context failed: {e}")


@app.post("/condition/bridge")
def condition_bridge(req: ConditionBridgeRequest):
    """
    Bridge existing YONO v1 output → condition observations.
    Maps damage_flags/modification_flags to the expandable condition_taxonomy.
    """
    try:
        from condition_spectrometer import bridge_vehicle_images, get_connection
        conn = get_connection()
        result = bridge_vehicle_images(conn, vehicle_id=req.vehicle_id, limit=req.limit)
        conn.close()
        return result
    except Exception as e:
        raise HTTPException(500, f"Bridge failed: {e}")


@app.post("/condition/score")
def condition_score(req: ConditionScoreRequest):
    """
    Compute 0-100 condition score for a vehicle from all observations.

    Rubric: exterior(30) + interior(20) + mechanical(20) + provenance(15) + structural(15) = 100
    Includes distribution-relative percentile within Y/M/M and globally.
    """
    try:
        from condition_spectrometer import compute_condition_score, save_condition_score, get_connection
        conn = get_connection()
        score_data = compute_condition_score(conn, req.vehicle_id)
        if not score_data:
            conn.close()
            raise HTTPException(404, "No observations found for this vehicle")
        save_condition_score(conn, score_data)
        conn.close()
        return score_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Score computation failed: {e}")


@app.post("/condition/contextual")
def condition_contextual(req: ConditionScoreRequest):
    """
    Run contextual pass (Phase 3C) — Y/M/M knowledge-informed observations.
    Loads the vehicle's Y/M/M profile and generates signals about rarity,
    unexpected conditions, and coverage gaps.
    """
    try:
        from condition_spectrometer import contextual_pass, get_connection
        conn = get_connection()
        result = contextual_pass(conn, req.vehicle_id)
        conn.close()
        return result
    except Exception as e:
        raise HTTPException(500, f"Contextual pass failed: {e}")


@app.post("/condition/sequence")
def condition_sequence(req: ConditionScoreRequest):
    """
    Run sequence cross-reference pass (Phase 3D).
    Analyzes photo sequences for zone imbalance, multi-angle damage confirmation,
    sequence patterns, and coverage completeness.
    """
    try:
        from condition_spectrometer import sequence_pass, get_connection
        conn = get_connection()
        result = sequence_pass(conn, req.vehicle_id)
        conn.close()
        return result
    except Exception as e:
        raise HTTPException(500, f"Sequence pass failed: {e}")


@app.post("/condition/pipeline")
def condition_pipeline(req: ConditionScoreRequest):
    """
    Run the full multipass pipeline for a vehicle:
    bridge → contextual → sequence → score → distribute.
    Returns all results from each pass.
    """
    try:
        from condition_spectrometer import (
            bridge_vehicle_images, contextual_pass, sequence_pass,
            compute_condition_score, save_condition_score,
            compute_distribution, get_connection,
        )
        conn = get_connection()

        bridge = bridge_vehicle_images(conn, vehicle_id=req.vehicle_id)
        ctx = contextual_pass(conn, req.vehicle_id)
        seq = sequence_pass(conn, req.vehicle_id)

        score_data = compute_condition_score(conn, req.vehicle_id)
        if score_data:
            save_condition_score(conn, score_data)
            dist = compute_distribution(conn, ymm_key=score_data["ymm_key"], group_type="ymm")
        else:
            dist = None

        conn.close()
        return {
            "bridge": bridge,
            "contextual": ctx,
            "sequence": seq,
            "score": score_data,
            "distribution": dist,
        }
    except Exception as e:
        raise HTTPException(500, f"Pipeline failed: {e}")


@app.post("/condition/distribute")
def condition_distribute(req: ConditionDistributeRequest):
    """
    Recompute condition distributions for Y/M/M groups.
    Distributions enable rarity signals: rarity = 1 - CDF(score, ymm_distribution).
    """
    try:
        from condition_spectrometer import compute_distribution, recompute_all_distributions, get_connection
        conn = get_connection()
        if req.all:
            result = recompute_all_distributions(conn)
        elif req.ymm_key:
            dist = compute_distribution(conn, ymm_key=req.ymm_key, group_type="ymm")
            result = dist if dist else {"error": "Not enough data (need >= 3 scored vehicles)"}
        else:
            raise HTTPException(400, "Provide ymm_key or set all=true")
        conn.close()
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Distribution compute failed: {e}")


# ============================================================
# Contextual analysis (V3 — Y/M/M knowledge-aware)
# ============================================================

_contextual_clf = None

@app.post("/analyze/contextual")
def analyze_contextual(req: ContextualAnalyzeRequest):
    """
    Contextual vehicle image analysis using Y/M/M knowledge profiles.

    Unlike /analyze (which uses Florence-2 zero-shot), this endpoint uses the
    ContextualModelV3 trained on Y/M/M knowledge from 24K+ expert commentators.
    Zero API calls — pure local ONNX inference.

    Requires the v3 model: yono/models/yono_contextual_v3.onnx
    Falls back to /analyze if model not available.
    """
    global _contextual_clf

    # Lazy load contextual classifier
    if _contextual_clf is None:
        try:
            from yono import ContextualYONOClassifier
            _contextual_clf = ContextualYONOClassifier()
        except (FileNotFoundError, ImportError) as e:
            # Fall back to regular analyze
            return analyze(AnalyzeRequest(image_url=req.image_url))

    t0 = time.perf_counter()
    tmp_path = None
    try:
        tmp_path = _download_image(req.image_url)

        vehicle_row = {}
        if req.mileage:
            vehicle_row["mileage"] = req.mileage
        if req.sale_price:
            vehicle_row["sale_price"] = req.sale_price

        result = _contextual_clf.analyze(
            tmp_path,
            year=req.year,
            make=req.make,
            model=req.model,
            vehicle_row=vehicle_row,
            damage_threshold=req.damage_threshold,
            mod_threshold=req.mod_threshold,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"Contextual analysis failed: {e}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    return {**result, "ms": elapsed_ms, "image_url": req.image_url, "model": "contextual_v3"}


# ============================================================
# Session Detection endpoints
# ============================================================

class SessionDetectRequest(BaseModel):
    vehicle_id: str
    gap_minutes: float = 30


class SessionClassifyRequest(BaseModel):
    session_id: str


class SessionNarrativeRequest(BaseModel):
    session_id: str


@app.post("/session/detect")
def session_detect(req: SessionDetectRequest):
    """
    Detect photo sessions for a vehicle.
    Groups chronologically adjacent images into named sessions,
    classifies session types, and persists as auto-sessions.
    """
    try:
        from session_detector import detect_sessions, get_connection
        conn = get_connection()
        result = detect_sessions(conn, req.vehicle_id, req.gap_minutes)
        conn.close()
        return result
    except Exception as e:
        raise HTTPException(500, f"Session detection failed: {e}")


@app.post("/session/classify")
def session_classify(req: SessionClassifyRequest):
    """
    Reclassify an existing session's type without re-detecting.
    """
    try:
        from session_detector import get_connection
        conn = get_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SET statement_timeout = '15s'")

        # Get session + its images
        cur.execute("""
            SELECT s.vehicle_id, ARRAY_AGG(m.image_id ORDER BY m.display_order) AS image_ids
            FROM image_sets s
            JOIN image_set_members m ON m.image_set_id = s.id
            WHERE s.id = %s
            GROUP BY s.vehicle_id
        """, (req.session_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            raise HTTPException(404, "Session not found")

        # Fetch image details
        cur.execute("""
            SELECT id, vehicle_zone, damage_flags, modification_flags,
                   source, latitude, longitude,
                   COALESCE(taken_at, created_at) AS effective_time
            FROM vehicle_images WHERE id = ANY(%s)
            ORDER BY COALESCE(taken_at, created_at) ASC
        """, (row["image_ids"],))
        images = [dict(r) for r in cur.fetchall()]

        from session_detector import classify_session_type
        session_type_key, confidence = classify_session_type(images)

        cur.execute("SELECT id, display_label FROM session_type_taxonomy WHERE canonical_key = %s",
                     (session_type_key,))
        type_row = cur.fetchone()

        cur.execute("""
            UPDATE image_sets
            SET session_type_key = %s, session_type_id = %s, session_type_confidence = %s
            WHERE id = %s
        """, (session_type_key, str(type_row["id"]) if type_row else None, confidence, req.session_id))
        conn.commit()
        cur.close()
        conn.close()

        return {
            "session_id": req.session_id,
            "session_type_key": session_type_key,
            "confidence": confidence,
            "display_label": type_row["display_label"] if type_row else session_type_key,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Session classification failed: {e}")


@app.post("/session/narrative")
def session_narrative(req: SessionNarrativeRequest):
    """
    Generate a narrative for a session.
    Uses descriptions + condition observations to build a story.
    """
    try:
        from description_generator import generate_session_narrative, get_connection
        conn = get_connection()
        result = generate_session_narrative(conn, req.session_id)
        conn.close()
        return result
    except ImportError:
        raise HTTPException(501, "description_generator module not available")
    except Exception as e:
        raise HTTPException(500, f"Narrative generation failed: {e}")


# ============================================================
# Entry point
# ============================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8472)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--no-vision", action="store_true", help="Skip loading VisionAnalyzer (faster startup for classify-only)")
    args = parser.parse_args()

    if args.no_vision:
        # Monkey-patch to skip vision loading
        original_lifespan = lifespan
        async def lifespan_no_vision(app):
            global _hier, _flat
            _hier = HierarchicalYONO()
            if not (_hier and _hier.available):
                _flat = YONOClassifier()
            yield
        app.router.lifespan_context = lifespan_no_vision

    print(f"Starting YONO server on {args.host}:{args.port}")
    uvicorn.run("server:app", host=args.host, port=args.port, reload=args.reload)
